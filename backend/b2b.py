"""Authenticated wholesale catalogue, private inquiries and saved supplier quotations.

A quotation acceptance is an agreement only: this module never collects payments,
reserves retail inventory, certifies tax details or promises dispatch/escrow.
"""
import base64
import copy
import hashlib
import inspect
import io
import json
import re
import time
import uuid
from datetime import datetime, timezone
from html import escape
from typing import Literal

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from pydantic import Field, StrictInt, model_validator
from starlette.concurrency import run_in_threadpool
from operations import Input as OperationInput, fail
from evidence import upload_object, download_object
from workspace import photo_body


class Input(OperationInput):
    model_config = {'extra': 'forbid', 'str_strip_whitespace': True}

Category = Literal['hvac', 'electrical', 'plumbing', 'tools', 'refrigerants', 'appliances', 'hardware']
UnitName = Literal['Boxes', 'Pieces', 'Rolls', 'Meters', 'Bundles', 'Kg', 'Sets', 'Cartons', 'Packs']
PHOTO_PREFIX = '/api/operations/b2b/photos/'
SCAN_BUDGET = 160
MAX_MONEY = 100_000_000
POLICY = dict(payments_ready=False, escrow_available=False,
    acceptance_note='Accepting a quotation records your agreement with the supplier. Repaido does not collect B2B payments, hold escrow, reserve stock or confirm dispatch in this flow.',
    price_note='Catalogue and slab prices are per unit in INR, excluding tax and freight. The supplier explicitly declares product GST and freight in the quotation; freight is added after product GST. Confirm applicable tax and payment terms with the supplier.')


class PriceSlabInput(Input):
    min_qty: StrictInt = Field(ge=1, le=100_000)
    max_qty: StrictInt | None = Field(default=None, ge=1, le=100_000)
    price_paise: StrictInt = Field(ge=1, le=MAX_MONEY)
    discount_label: str = Field(default='', max_length=60)


class ListingFields(Input):
    title: str = Field(min_length=3, max_length=200)
    category: Category
    part_number: str = Field(default='', max_length=100)
    hsn_code: str = Field(default='', max_length=8, pattern=r'^(?:[0-9]{4}|[0-9]{6}|[0-9]{8})?$')
    unit: UnitName
    moq: StrictInt = Field(ge=1, le=100_000)
    base_price_paise: StrictInt = Field(ge=1, le=MAX_MONEY)
    mrp_paise: StrictInt | None = Field(default=None, ge=1, le=MAX_MONEY)
    bulk_slabs: list[PriceSlabInput] = Field(default_factory=list, max_length=12)
    stock: StrictInt = Field(ge=0, le=100_000)
    lead_time_days: StrictInt = Field(ge=1, le=90)
    supply_capacity: str = Field(default='', max_length=120)
    description: str = Field(min_length=3, max_length=3000)
    specifications: dict[str, str] = Field(default_factory=dict, max_length=30)
    image: str | None = Field(default=None, max_length=250)

    @model_validator(mode='after')
    def valid_prices(self):
        if self.mrp_paise is not None and self.mrp_paise < self.base_price_paise:
            raise ValueError('MRP must be at least the listed base price.')
        previous_end = 0
        for slab in sorted(self.bulk_slabs, key=lambda s: s.min_qty):
            if slab.min_qty < self.moq or slab.min_qty <= previous_end or slab.price_paise > self.base_price_paise:
                raise ValueError('Quantity slabs must not overlap, start below MOQ or exceed the base price.')
            if slab.max_qty is not None and slab.max_qty < slab.min_qty:
                raise ValueError('A slab maximum cannot be below its minimum.')
            previous_end = slab.max_qty if slab.max_qty is not None else 100_000
        if any(not k.strip() or len(k) > 80 or len(v) > 500 for k, v in self.specifications.items()):
            raise ValueError('Specifications require short names and values.')
        return self


class B2BListingInput(ListingFields):
    shop_id: str = Field(min_length=1, max_length=100, pattern=r'^[A-Za-z0-9_-]+$')
    request_id: str = Field(min_length=16, max_length=100)


class ListingUpdate(ListingFields):
    expected_version: StrictInt = Field(ge=1)


class ListingStatus(Input):
    status: Literal['active', 'paused']
    expected_version: StrictInt = Field(ge=1)


class ListingArchive(Input):
    expected_version: StrictInt = Field(ge=1)


class B2BRfqInput(Input):
    listing_id: str = Field(min_length=1, max_length=100, pattern=r'^[A-Za-z0-9_-]+$')
    customer_name: str = Field(min_length=2, max_length=100)
    customer_phone: str = Field(pattern=r'^\+?[0-9]{10,15}$')
    customer_email: str = Field(min_length=5, max_length=254, pattern=r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
    buyer_company_name: str | None = Field(default=None, max_length=200)
    buyer_gstin: str | None = Field(default=None, max_length=15, pattern=r'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$')
    delivery_address: str = Field(min_length=10, max_length=500)
    delivery_city: str = Field(min_length=2, max_length=80)
    delivery_pincode: str = Field(pattern=r'^[1-9][0-9]{5}$')
    quantity_requested: StrictInt = Field(ge=1, le=100_000)
    target_price_paise: StrictInt | None = Field(default=None, ge=1, le=MAX_MONEY)
    urgency: Literal['immediate', 'within_7_days', 'within_15_days', 'flexible'] = 'within_7_days'
    notes: str = Field(default='', max_length=2000)
    request_id: str = Field(min_length=16, max_length=100)


class B2BQuotationInput(Input):
    rfq_id: str = Field(min_length=1, max_length=100, pattern=r'^[A-Za-z0-9_-]+$')
    offered_rate_paise: StrictInt = Field(ge=1, le=MAX_MONEY)
    quantity: StrictInt = Field(ge=1, le=100_000)
    gst_bps: StrictInt = Field(ge=0, le=10_000)
    freight_charges_paise: StrictInt = Field(default=0, ge=0, le=MAX_MONEY)
    payment_terms: str = Field(min_length=3, max_length=1000)
    delivery_timeline: str = Field(min_length=3, max_length=500)
    warranty_terms: str = Field(min_length=3, max_length=1000)
    validity_days: StrictInt = Field(ge=1, le=90)
    authorized_signatory: str = Field(min_length=2, max_length=100)
    signatory_designation: str = Field(default='', max_length=100)
    special_notes: str = Field(default='', max_length=1500)
    request_id: str = Field(min_length=16, max_length=100)


class Decision(Input):
    quote_number: str = Field(min_length=1, max_length=100, pattern=r'^[A-Za-z0-9_-]+$')
    action: Literal['accept', 'decline']


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def signature(body):
    return digest(json.dumps(body, sort_keys=True, separators=(',', ':')))


def owned_shop(u, user, shop_id):
    if not user or not user.get('phone_authenticated'):
        fail('PHONE_AUTH_REQUIRED', 'Sign in with your verified phone to manage wholesale stock or quotations.', 403)
    shop = u.get('shops', shop_id)
    if not shop or shop.get('owner_id') != user['id'] or shop.get('status') != 'approved':
        fail('SHOP_REQUIRED', 'This action requires your approved shop account.', 403)
    return shop


def current_listing(u, lid, public=True):
    row = u.get('b2b_listings', lid)
    shop = u.get('shops', row.get('shop_id', '')) if row else None
    # Unauthenticated legacy examples never acquire a seller by merely naming a shop.
    if not row or not shop or not row.get('owner_id') or row['owner_id'] != shop.get('owner_id'):
        return None, None
    if public and (row.get('status') != 'active' or shop.get('status') != 'approved'):
        return None, None
    return row, shop


def listing_view(u, row, shop):
    fields = set(ListingFields.model_fields) | {'id', 'shop_id', 'status', 'created_at', 'updated_at', 'version'}
    value = {k: copy.deepcopy(row[k]) for k in fields if k in row}
    from shop_prime import public_prime
    value.update(shop_name=shop.get('name', ''), distributor_name=shop.get('name', ''), city=shop.get('city', ''),
                 verified_distributor=shop.get('status') == 'approved', prime=public_prime(u, shop))
    # Public catalogue deliberately omits exact shop address, phone, tax documents and owner identifiers.
    return value


def unit_price(row, quantity):
    price = row['base_price_paise']
    for slab in sorted(row.get('bulk_slabs', []), key=lambda s: s['min_qty']):
        if quantity >= slab['min_qty'] and (slab.get('max_qty') is None or quantity <= slab['max_qty']):
            price = slab['price_paise']
    return price


def check_quantity(row, quantity):
    if quantity < row['moq']:
        fail('MOQ_REQUIRED', f"This listing requires at least {row['moq']} {row['unit']}.", 422)
    if quantity > row['stock']:
        fail('STOCK_UNAVAILABLE', 'The requested quantity exceeds the supplier\'s currently listed stock.', 409)


def check_requested_item(listing, rfq):
    if any(listing.get(key) != rfq.get(key) for key in ('unit', 'part_number')):
        fail('LISTING_CHANGED', 'The supplier changed this item or its selling unit. Create a new inquiry for the current listing.', 409)


def scan(u, kind, after, limit, selector=None):
    """Bounded document-key scans, with equality scoping enforced at the store query."""
    if selector and selector[0] not in ('customer_id', 'shop_id'):
        raise ValueError('Unsupported wholesale selector')
    if u.tx is not None:
        from google.cloud.firestore_v1.field_path import FieldPath
        q = u.core.fs_collection('ops_' + kind)
        if selector:
            q = q.where(selector[0], '==', selector[1])
        q = q.order_by(FieldPath.document_id()).limit(limit)
        if after:
            q = q.start_after({FieldPath.document_id(): u.core.fs_doc('ops_' + kind, after)})
        rows = {s.id: s.to_dict() for s in q.stream(transaction=u.tx)}
    else:
        sql = 'SELECT id,body FROM operation_records WHERE kind=? AND id>?'
        args = [kind, after]
        if selector:
            sql += f" AND json_extract(body,'$.{selector[0]}')=?"
            args.append(selector[1])
        sql += ' ORDER BY id LIMIT ?'
        rows = {r['id']: json.loads(r['body']) for r in u.conn.execute(sql, [*args, limit])}
    for (k, key), value in u.pending.items():
        if k == kind and key > after and (not selector or value.get(selector[0]) == selector[1]):
            rows[key] = value
    result = sorted(rows.items())[:limit]
    u.fetched.update({(kind, key): copy.deepcopy(row) for key, row in result})
    return result


def page(u, kind, cursor, scope, limit, projection, selector=None):
    scope_hash = signature(scope)
    after = ''
    if cursor:
        try:
            token = json.loads(base64.urlsafe_b64decode(cursor + '=' * (-len(cursor) % 4)))
            if token['s'] != scope_hash or not isinstance(token['k'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', token['k']):
                raise ValueError()
            after = token['k']
        except Exception:
            fail('INVALID_CURSOR', 'This page cursor belongs to different wholesale filters.', 422)
    items, seen, more = [], 0, True
    while seen < SCAN_BUDGET and len(items) < limit:
        batch_size = min(40, SCAN_BUDGET - seen)
        rows = scan(u, kind, after, batch_size, selector)
        if not rows:
            more = False
            break
        if kind == 'b2b_listings':
            shop_ids = {row.get('shop_id') for _, row in rows if row.get('shop_id')}
            u.prefetch([(collection, sid) for sid in shop_ids for collection in ('shops', 'shop_prime')])
        elif kind == 'b2b_rfqs':
            u.prefetch([('b2b_quotations', row['quote_number']) for _, row in rows if row.get('quote_number')])
        for key, row in rows:
            after, seen = key, seen + 1
            value = projection(row)
            if value is not None:
                items.append(value)
            if len(items) == limit:
                break
        if len(items) < limit and len(rows) < batch_size:
            more = False
            break
    next_cursor = base64.urlsafe_b64encode(json.dumps({'s': scope_hash, 'k': after}).encode()).decode().rstrip('=') if more and after else None
    return items, next_cursor


def private_rfq(u, rid, user):
    row = u.get('b2b_rfqs', rid)
    if not row or not row.get('customer_id') or not row.get('owner_id'):
        fail('NOT_FOUND', 'Wholesale inquiry not found.', 404)
    if row['customer_id'] != user['id']:
        if row['owner_id'] != user['id']:
            fail('NOT_FOUND', 'Wholesale inquiry not found.', 404)
        owned_shop(u, user, row['shop_id'])
    return row


def quote_view(quote, rfq=None):
    internal = {'owner_id', 'customer_id', 'request_hash', 'request_id'}
    value = {k: copy.deepcopy(v) for k, v in quote.items() if k not in internal}
    value['status'] = ('superseded' if rfq.get('quote_number') != quote['quote_number'] else rfq['status']) if rfq else 'quoted'
    value['server_now'] = time.time()
    value['payment_status'] = 'not_collected'
    return value


def rfq_view(u, row):
    value = {k: copy.deepcopy(v) for k, v in row.items() if k not in {'customer_id', 'owner_id', 'request_hash', 'request_id'}}
    quote = u.get('b2b_quotations', row.get('quote_number', '')) if row.get('quote_number') else None
    value['quotation'] = quote_view(quote, row) if quote else None
    value['payment_status'] = 'not_collected'
    value['server_now'] = time.time()
    return value


def idempotent(u, kind, user, body):
    key = digest(f"{kind}:{user['id']}:{body['request_id']}")
    existing = u.get('b2b_requests', key)
    if existing and existing['request_hash'] != signature(body):
        fail('REQUEST_REUSED', 'This request ID was already used for different wholesale details.', 409)
    return key, existing


def remember(u, key, body, kind, row_id):
    u.put('b2b_requests', key, dict(request_hash=signature(body), kind=kind, row_id=row_id))


def bind_image(u, row, previous=None):
    image = row.get('image')
    if image:
        if not image.startswith(PHOTO_PREFIX) or '/' in image[len(PHOTO_PREFIX):]:
            fail('INVALID_PHOTO', 'Upload a real product photo from this shop account.', 422)
        media = u.get('b2b_media', image[len(PHOTO_PREFIX):])
        if not media or media.get('shop_id') != row['shop_id'] or media.get('owner_id') != row['owner_id']:
            fail('INVALID_PHOTO', 'Choose a photo uploaded by this shop.', 422)
        ids = set(media.get('listing_ids', []))
        ids.add(row['id'])
        if len(ids) > 20:
            fail('PHOTO_REFERENCE_LIMIT', 'Upload another product photo for this listing.', 422)
        media['listing_ids'] = sorted(ids)
        u.put('b2b_media', media['id'], media)
    if previous and previous.get('image') and previous['image'] != image:
        old = u.get('b2b_media', previous['image'][len(PHOTO_PREFIX):])
        if old:
            old['listing_ids'] = [lid for lid in old.get('listing_ids', []) if lid != row['id']]
            u.put('b2b_media', old['id'], old)


def generate_b2b_quotation_pdf(quote):
    """Render only saved canonical values; all declared text is escaped before markup."""
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    styles = getSampleStyleSheet()
    styles['BodyText'].fontSize, styles['BodyText'].leading = 9, 13
    styles['Heading1'].textColor = colors.HexColor('#142858')
    def p(value):
        return Paragraph(escape(str(value)).replace('\n', '<br/>'), styles['BodyText'])
    def money(value):
        return f'INR {value // 100:,}.{value % 100:02d}'
    out = io.BytesIO()
    doc = SimpleDocTemplate(out, pagesize=A4, rightMargin=36, leftMargin=36, topMargin=36, bottomMargin=36)
    expiry = datetime.fromtimestamp(quote['valid_until'], timezone.utc).strftime('%d %b %Y %H:%M UTC')
    blocks = [Paragraph('REPAIDO WHOLESALE QUOTATION', styles['Heading1']), p(quote['quote_number']), p('Valid until: ' + expiry), Spacer(1, 12)]
    supplier = [quote['shop_name']]
    for key, label in [('distributor_gstin','GSTIN'), ('shop_address','Address'), ('shop_phone','Phone'), ('shop_email','Email')]:
        if quote.get(key):
            supplier.append(label + ': ' + quote[key])
    buyer = [quote['customer_name']]
    for key, label in [('buyer_company_name','Company'), ('buyer_gstin','GSTIN'), ('customer_phone','Phone'), ('customer_email','Email')]:
        if quote.get(key):
            buyer.append(label + ': ' + quote[key])
    buyer.append('Delivery: ' + ', '.join(quote[k] for k in ['delivery_address', 'delivery_city', 'delivery_pincode']))
    parties = Table([[p('SUPPLIER'), p('BUYER')], [p('\n'.join(supplier)), p('\n'.join(buyer))]], colWidths=[260,260])
    parties.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BOX',(0,0),(-1,-1),.5,colors.HexColor('#CBD5E1')),('BACKGROUND',(0,0),(-1,0),colors.HexColor('#EFF3FA'))]))
    blocks += [parties, Spacer(1,12)]
    for label, value in [('Item', quote['item_title']), ('Part number', quote.get('part_number')), ('HSN declared by supplier', quote.get('hsn_code')), ('Quantity', f"{quote['quantity']} {quote['unit']}"), ('Rate per unit', money(quote['offered_rate_paise']))]:
        if value:
            blocks.append(p(label + ': ' + value))
    totals = Table([[p(label),p(value)] for label,value in [('Product subtotal',money(quote['taxable_paise'])), (f"Product GST ({quote['gst_bps']/100:g}%)",money(quote['gst_paise'])), ('Freight declared by supplier',money(quote['freight_charges_paise'])), ('QUOTATION TOTAL',money(quote['grand_total_paise']))]], colWidths=[350,170])
    totals.setStyle(TableStyle([('LINEABOVE',(0,-1),(-1,-1),1,colors.HexColor('#142858')),('VALIGN',(0,0),(-1,-1),'TOP')]))
    blocks += [Spacer(1,10),totals,Spacer(1,12)]
    for key,label in [('payment_terms','Payment terms'),('delivery_timeline','Delivery timeline'),('warranty_terms','Warranty / inspection terms'),('special_notes','Supplier notes'),('authorized_signatory','Supplier signatory'),('signatory_designation','Designation')]:
        if quote.get(key):
            blocks.append(p(label + ': ' + quote[key]))
    blocks += [Spacer(1,12),p(POLICY['acceptance_note']),p('This is a saved supplier quotation, not a tax invoice or a digitally certified document. Supplier declarations are not a Repaido tax certification.')]
    doc.build(blocks)
    return out.getvalue()


def install(core):
    router = APIRouter(prefix='/operations/b2b', tags=['Wholesale'])
    store = core.operations_store

    async def optional_user(request: Request, authorization: str = Header(default='')):
        if not authorization:
            return None
        # Protected operations retain FastAPI's standard dependency injection. The
        # public catalogue permits anonymous reads and uses the same trusted verifier.
        verifier = request.app.dependency_overrides.get(core.current_user, core.current_user)
        if inspect.iscoroutinefunction(verifier):
            return await verifier(authorization)
        return await run_in_threadpool(verifier, authorization)

    @router.get('/policy')
    def policy():
        return POLICY

    @router.get('/listings')
    def catalogue(shop_id: str | None = Query(default=None, max_length=100, pattern=r'^[A-Za-z0-9_-]+$'), cursor: str = '', limit: int = 20, search: str = '', category: str = 'all', user=Depends(optional_user)):
        if not 1 <= limit <= 40 or len(cursor) > 1024 or len(search) > 120 or category not in ('all', *Category.__args__):
            fail('INVALID_FILTER', 'Choose valid wholesale filters and a page size of 1–40.', 422)
        search = search.strip().casefold()
        def read(u):
            if shop_id:
                if not user:
                    fail('SIGN_IN_REQUIRED', 'Sign in to manage wholesale stock.', 401)
                owned_shop(u, user, shop_id)
            def project(row):
                current, shop = current_listing(u, row['id'], public=not bool(shop_id))
                if not current or (shop_id and row.get('shop_id') != shop_id):
                    return None
                if category != 'all' and row.get('category') != category:
                    return None
                haystack = (' '.join(str(row.get(k,'')) for k in ('title','part_number','category','description','hsn_code')) + ' ' + shop.get('name','')).casefold()
                if search and search not in haystack:
                    return None
                return listing_view(u, current, shop)
            values, next_cursor = page(u, 'b2b_listings', cursor, {'kind':'listings','shop':shop_id,'actor':user['id'] if shop_id else None,'search':search,'category':category}, limit, project, ('shop_id',shop_id) if shop_id else None)
            return dict(listings=values, next_cursor=next_cursor)
        return store.run(read)

    @router.get('/listings/{lid}')
    def listing_detail(lid: str):
        def read(u):
            row, shop = current_listing(u, lid)
            if not row:
                fail('NOT_FOUND', 'Wholesale listing is not currently available.', 404)
            return {'listing': listing_view(u,row,shop)}
        return store.run(read)

    @router.post('/listings')
    def create_listing(body: B2BListingInput, user=Depends(core.current_user)):
        value = body.model_dump()
        def execute(u):
            shop = owned_shop(u, user, body.shop_id)
            key, existing = idempotent(u, 'listing', user, value)
            if existing:
                row, current_shop = current_listing(u, existing['row_id'], public=False)
                if not row:
                    fail('NOT_FOUND','Saved wholesale listing is unavailable.',404)
                return {'listing':listing_view(u,row,current_shop)}
            now = time.time()
            row = {k:v for k,v in value.items() if k != 'request_id'}
            row.update(id='b2b-'+uuid.uuid4().hex, owner_id=user['id'], status='active', created_at=now, updated_at=now, version=1)
            bind_image(u,row)
            u.put('b2b_listings',row['id'],row)
            remember(u,key,value,'listing',row['id'])
            return {'listing':listing_view(u,row,shop)}
        return store.run(execute)

    def edit(u, lid, user, version):
        row, shop = current_listing(u,lid,public=False)
        if not row:
            fail('NOT_FOUND','Wholesale listing not found.',404)
        owned_shop(u,user,row['shop_id'])
        if row['owner_id'] != user['id']:
            fail('NOT_FOUND','Wholesale listing not found.',404)
        if row['version'] != version:
            fail('VERSION_CONFLICT','This listing changed. Reload it before saving.',409)
        if row['status'] == 'archived':
            fail('LISTING_ARCHIVED','An archived listing cannot be changed.',409)
        return row,shop

    @router.put('/listings/{lid}')
    def update_listing(lid: str, body: ListingUpdate, user=Depends(core.current_user)):
        def execute(u):
            previous, shop = edit(u,lid,user,body.expected_version)
            row = {**previous, **body.model_dump(exclude={'expected_version'}), 'version':previous['version']+1,'updated_at':time.time()}
            bind_image(u,row,previous)
            u.put('b2b_listings',lid,row)
            return {'listing':listing_view(u,row,shop)}
        return store.run(execute)

    @router.post('/listings/{lid}/status')
    def set_status(lid: str, body: ListingStatus, user=Depends(core.current_user)):
        def execute(u):
            row,shop = edit(u,lid,user,body.expected_version)
            row.update(status=body.status,version=row['version']+1,updated_at=time.time())
            u.put('b2b_listings',lid,row)
            return {'listing':listing_view(u,row,shop)}
        return store.run(execute)

    @router.delete('/listings/{lid}')
    def archive(lid: str, body: ListingArchive, user=Depends(core.current_user)):
        def execute(u):
            row,shop = edit(u,lid,user,body.expected_version)
            row.update(status='archived',version=row['version']+1,updated_at=time.time())
            u.put('b2b_listings',lid,row)
            return {'listing':listing_view(u,row,shop)}
        return store.run(execute)

    @router.post('/rfq')
    def create_rfq(body: B2BRfqInput,user=Depends(core.current_user)):
        value = body.model_dump()
        def execute(u):
            key, existing = idempotent(u,'rfq',user,value)
            if existing:
                return {'rfq':rfq_view(u,private_rfq(u,existing['row_id'],user))}
            listing,shop = current_listing(u,body.listing_id)
            if not listing:
                fail('LISTING_UNAVAILABLE','Choose a currently active approved supplier listing.',409)
            if shop['owner_id'] == user['id']:
                fail('OWN_LISTING','A supplier cannot send a buyer inquiry to their own listing.',409)
            check_quantity(listing,body.quantity_requested)
            now = time.time()
            row = {k:v for k,v in value.items() if k != 'request_id'}
            row.update(id='rfq-'+uuid.uuid4().hex,customer_id=user['id'],owner_id=shop['owner_id'],shop_id=shop['id'],shop_name=shop['name'],
                       item_title=listing['title'],category=listing['category'],hsn_code=listing['hsn_code'],part_number=listing['part_number'],unit=listing['unit'],
                       listing_version=listing['version'],listed_rate_paise=unit_price(listing,body.quantity_requested),status='pending',payment_status='not_collected',
                       created_at=now,updated_at=now,version=1)
            row['listed_subtotal_paise'] = row['listed_rate_paise'] * row['quantity_requested']
            u.put('b2b_rfqs',row['id'],row)
            remember(u,key,value,'rfq',row['id'])
            return {'rfq':rfq_view(u,row)}
        return store.run(execute)

    @router.get('/rfq')
    def inquiries(shop_id: str | None = Query(default=None, max_length=100, pattern=r'^[A-Za-z0-9_-]+$'),cursor: str = '',limit: int = 20,user=Depends(core.current_user)):
        if not 1 <= limit <= 40 or len(cursor)>1024:
            fail('INVALID_FILTER','Choose a page size of 1–40.',422)
        def read(u):
            if shop_id:
                owned_shop(u,user,shop_id)
            def project(row):
                if not row.get('customer_id') or not row.get('owner_id'):
                    return None
                if (shop_id and row.get('owner_id')!=user['id']) or (not shop_id and row.get('customer_id')!=user['id']):
                    return None
                return rfq_view(u,row)
            rows,next_cursor = page(u,'b2b_rfqs',cursor,{'kind':'rfq','actor':user['id'],'shop':shop_id},limit,project,('shop_id',shop_id) if shop_id else ('customer_id',user['id']))
            return dict(rfqs=rows,next_cursor=next_cursor,server_now=time.time())
        return store.run(read)

    @router.get('/rfq/{rid}')
    def inquiry_detail(rid: str,user=Depends(core.current_user)):
        return store.run(lambda u: {'rfq':rfq_view(u,private_rfq(u,rid,user))})

    @router.post('/quotation')
    def create_quote(body: B2BQuotationInput,user=Depends(core.current_user)):
        value = body.model_dump()
        def execute(u):
            rfq = private_rfq(u,body.rfq_id,user)
            shop = owned_shop(u,user,rfq['shop_id'])
            if rfq['owner_id']!=user['id']:
                fail('NOT_FOUND','This inquiry does not belong to your shop.',404)
            key,existing = idempotent(u,'quote',user,value)
            if existing:
                return {'quotation':quote_view(u.get('b2b_quotations',existing['row_id']),rfq)}
            if rfq['status'] not in ('pending','quoted'):
                fail('RFQ_FINAL','This inquiry already has a final buyer decision.',409)
            listing,current_shop = current_listing(u,rfq['listing_id'])
            if not listing or current_shop['owner_id']!=user['id']:
                fail('LISTING_UNAVAILABLE','The supplier listing is no longer active.',409)
            if body.quantity!=rfq['quantity_requested']:
                fail('QUANTITY_MISMATCH','Quote the exact quantity requested by the buyer.',422)
            check_requested_item(listing,rfq)
            check_quantity(listing,body.quantity)
            taxable = body.quantity * body.offered_rate_paise
            tax = (taxable * body.gst_bps + 5000)//10000
            if taxable+tax+body.freight_charges_paise > 100_000_000_000:
                fail('QUOTE_TOO_LARGE','This quotation exceeds the supported amount.',422)
            now = time.time()
            quote = {k:v for k,v in value.items() if k!='request_id'}
            for key_name in ('customer_name','customer_phone','customer_email','buyer_company_name','buyer_gstin','delivery_address','delivery_city','delivery_pincode','item_title','category','hsn_code','part_number','unit'):
                quote[key_name] = rfq.get(key_name)
            quote.update(quote_number='RP-B2B-'+uuid.uuid4().hex,owner_id=user['id'],customer_id=rfq['customer_id'],shop_id=shop['id'],shop_name=shop['name'],distributor_name=shop['name'],
                         distributor_gstin=shop.get('gstin') or '',shop_address=shop.get('address') or '',shop_phone=shop.get('phone') or '',shop_email=shop.get('email') or '',
                         taxable_paise=taxable,gst_paise=tax,grand_total_paise=taxable+tax+body.freight_charges_paise,gst_rate=body.gst_bps/10000,
                         created_at=now,valid_until=now+body.validity_days*86400,payment_status='not_collected')
            u.put('b2b_quotations',quote['quote_number'],quote)
            rfq.update(quote_number=quote['quote_number'],status='quoted',version=rfq['version']+1,updated_at=now)
            u.put('b2b_rfqs',rfq['id'],rfq)
            remember(u,key,value,'quote',quote['quote_number'])
            return {'quotation':quote_view(quote,rfq)}
        return store.run(execute)

    @router.post('/rfq/{rid}/decision')
    def decision(rid: str,body: Decision,user=Depends(core.current_user)):
        def execute(u):
            rfq = private_rfq(u,rid,user)
            if rfq['customer_id']!=user['id']:
                fail('BUYER_REQUIRED','Only this inquiry\'s buyer can decide the quotation.',403)
            if rfq.get('quote_number')!=body.quote_number:
                fail('QUOTE_SUPERSEDED','Review the supplier\'s latest saved quotation.',409)
            final = 'accepted' if body.action=='accept' else 'declined'
            if rfq['status']==final:
                return {'rfq':rfq_view(u,rfq)}
            if rfq['status']!='quoted':
                fail('RFQ_FINAL','This inquiry already has a final buyer decision.',409)
            quote = u.get('b2b_quotations',body.quote_number)
            if not quote or quote['rfq_id']!=rid or quote.get('customer_id')!=user['id']:
                fail('NOT_FOUND','Saved quotation not found.',404)
            if time.time()>=quote['valid_until']:
                fail('QUOTE_EXPIRED','The quotation expired. Ask the supplier for a new quotation.',409)
            listing,shop = current_listing(u,rfq['listing_id'])
            if not listing or shop['owner_id']!=rfq['owner_id']:
                fail('LISTING_UNAVAILABLE','The supplier listing is no longer active.',409)
            check_requested_item(listing,rfq)
            check_quantity(listing,quote['quantity'])
            rfq.update(status=final,decision_at=time.time(),version=rfq['version']+1,updated_at=time.time(),payment_status='not_collected')
            u.put('b2b_rfqs',rid,rfq)
            return {'rfq':rfq_view(u,rfq)}
        return store.run(execute)

    @router.get('/quotation/{number}/pdf')
    def pdf(number: str,user=Depends(core.current_user)):
        def read(u):
            quote = u.get('b2b_quotations',number)
            if not quote or not quote.get('rfq_id'):
                fail('NOT_FOUND','Saved quotation not found.',404)
            rfq = private_rfq(u,quote['rfq_id'],user)
            if quote.get('customer_id')!=rfq['customer_id'] or quote.get('owner_id')!=rfq['owner_id']:
                fail('NOT_FOUND','Saved quotation not found.',404)
            return quote
        quote = store.run(read)
        return Response(generate_b2b_quotation_pdf(quote),media_type='application/pdf',headers={'Content-Disposition':f'attachment; filename="{quote["quote_number"]}.pdf"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'})

    @router.post('/photos')
    async def photo(request: Request,shop_id: str = Query(max_length=100, pattern=r'^[A-Za-z0-9_-]+$'),user=Depends(core.current_user)):
        await run_in_threadpool(store.run, lambda u: owned_shop(u,user,shop_id))
        data = await photo_body(request)
        media_id = uuid.uuid4().hex
        object_key = 'b2b-media/'+media_id+'.jpg'
        try:
            await run_in_threadpool(upload_object, object_key, data)
        except Exception:
            fail('PHOTO_STORAGE_UNAVAILABLE','Product photo storage is unavailable. Try again later.',503)
        def save(u):
            owned_shop(u,user,shop_id)
            u.put('b2b_media',media_id,dict(id=media_id,shop_id=shop_id,owner_id=user['id'],object_key=object_key,listing_ids=[],created_at=time.time()))
        await run_in_threadpool(store.run, save)
        return {'image_url':PHOTO_PREFIX+media_id}

    @router.get('/photos/{media_id}')
    def public_photo(media_id: str):
        def read(u):
            media = u.get('b2b_media',media_id)
            if media:
                for lid in media.get('listing_ids',[])[:20]:
                    row,shop = current_listing(u,lid)
                    if row and row.get('image')==PHOTO_PREFIX+media_id and row['owner_id']==media['owner_id'] and row['shop_id']==media['shop_id']:
                        return media['object_key']
            fail('NOT_FOUND','Published product photo not found.',404)
        key = store.run(read)
        try:
            data = download_object(key)
        except Exception:
            fail('PHOTO_STORAGE_UNAVAILABLE','Product photo storage is unavailable.',503)
        return Response(data,media_type='image/jpeg',headers={'Cache-Control':'public, max-age=60','X-Content-Type-Options':'nosniff'})

    core.app.include_router(router)
