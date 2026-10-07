"""Live, safe references to native listings; bounded discovery and purchase proof.

Indexes contain references only. Every card rechecks its source and owner. Legacy
native records remain discoverable through bounded document-key scans while their
indexes are filled; modern writes use audience lanes without composite indexes.
"""
import base64
import hashlib
import json
import re
import time
from typing import Literal

from fastapi import APIRouter, Depends, Header, Request, Response
from pydantic import Field

from operations import Input, fail

SOURCE_KINDS = {'contract': 'contract_tenders', 'career': 'contract_projects',
                'inventory': 'inventory', 'second_hand': 'market_listings'}
NATIVE_SOURCES = {value: key for key, value in SOURCE_KINDS.items()}
SCAN = 12
PROOF_SCAN = 16
REFURB_FIELDS = ('grade', 'cosmetic_condition', 'tested_functions', 'tested_on', 'repairs', 'known_defects',
                 'accessories', 'battery_health_percent', 'warranty_days', 'warranty_terms', 'return_days', 'return_terms')


class Reference(Input):
    source: Literal['contract', 'career', 'inventory', 'second_hand']
    id: str = Field(min_length=1, max_length=100, pattern=r'^[A-Za-z0-9_-]+$')


class Saved(Input):
    active: bool


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def lane(source, mode='all', uid='', trade='all', city=''):
    return 'rp_opportunities_' + digest(json.dumps([source, mode, uid, trade, city.casefold()], separators=(',', ':')))


def ref_key(source, key):
    return source + ':' + key


def actor_user(actor):
    return actor.get('user') or (actor if actor.get('id') else {})


def reference_pairs(refs):
    return list(dict.fromkeys((SOURCE_KINDS[r['source']], r['id']) for r in refs if r.get('source') in SOURCE_KINDS and r.get('id')))[:200]


def trade_for(text):
    value = str(text or '').casefold()
    for trade, words in [('electrician', ('electric', 'solar', 'wire')), ('plumber', ('plumb', 'pipe', 'water')),
                         ('ac', ('hvac', 'air condition', 'ac ', 'ac-', 'appliance')), ('carpenter', ('carpent', 'wood', 'furniture')),
                         ('cleaning', ('clean', 'maid')), ('pest', ('pest',)), ('civil', ('construct', 'civil', 'interior', 'real estate'))]:
        if value == trade or any(word in value for word in words):
            return trade
    return 'spares'


def native_scan(u, kind, after='', limit=SCAN + 1, customer=None):
    """Document-key keysets work for old records without migration fields."""
    if u.tx is not None:
        from google.cloud.firestore_v1.field_path import FieldPath
        q = u.core.fs_collection('ops_' + kind)
        if customer is not None:
            q = q.where('customer_id', '==', customer)
        q = q.order_by(FieldPath.document_id()).limit(limit)
        if after:
            q = q.start_after({FieldPath.document_id(): u.core.fs_doc('ops_' + kind, after)})
        rows = {s.id: s.to_dict() for s in q.stream(transaction=u.tx)}
    else:
        sql = 'SELECT id,body FROM operation_records WHERE kind=? AND id>?'
        args = [kind, after]
        if customer is not None:
            sql += " AND json_extract(body,'$.customer_id')=?"
            args.append(customer)
        sql += ' ORDER BY id LIMIT ?'
        rows = {r['id']: json.loads(r['body']) for r in u.conn.execute(sql, [*args, limit])}
    for (k, key), row in u.pending.items():
        if k == kind and key > after and (customer is None or row.get('customer_id') == customer):
            rows[key] = row
    chosen = sorted(rows.items())[:limit]
    u.fetched.update({(kind, key): row for key, row in chosen})
    return [(key, row) for key, row in chosen]


def index_query(u, kind, after='', limit=SCAN + 1):
    from repaidians import query
    return query(u, kind, limit, after or None, descending=False)


def _fields(source, row, u):
    if source == 'contract':
        return row.get('owner_id', ''), trade_for(row.get('sector')), row.get('city', '')
    if source == 'career':
        from contract_work import hiring_trade
        hiring = row.get('hiring') or {}
        return row.get('owner_id', ''), hiring_trade(hiring, row.get('title', '')), hiring.get('city', '')
    if source == 'inventory':
        shop = u.get('shops', row.get('shop_id', '')) or {}
        return shop.get('owner_id', ''), trade_for(row.get('category')), shop.get('city', '')
    return row.get('owner_id', ''), trade_for(row.get('product_type')), row.get('city', '')


def index_record(u, kind, key, row, origin='live'):
    """Central Unit.put hook; only native kinds enter, rp_* writes never recurse."""
    if kind == 'retail_orders':
        uid = row.get('customer_id')
        if not uid:
            return
        paid = row.get('state') == 'paid' and bool(re.fullmatch(r'pay_[A-Za-z0-9]+', str(row.get('payment_id', ''))))
        for item in row.get('items', [])[:100]:
            pid = item.get('product_id')
            if not isinstance(pid, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', pid):
                continue
            proof = dict(id=key, sortKey=key, orderId=key, productId=pid, active=paid)
            u.put('rp_purchase_' + digest(uid + ':' + pid), key, proof)
            if paid:
                existing = u.get(lane('inventory', 'purchased', uid), pid)
                if not existing or origin == 'live':
                    u.put(lane('inventory', 'purchased', uid), pid, dict(id=pid, sortKey=pid, source='inventory', active=True,
                        origin=origin, firstOrderId=(existing or {}).get('firstOrderId', key)))
        return
    source = NATIVE_SOURCES.get(kind)
    if not source or not isinstance(row, dict):
        return
    marker = u.get('rp_opportunity_refs', ref_key(source, key))
    if origin == 'legacy' and marker and marker.get('origin') == 'live':
        return
    owner, trade, city = _fields(source, row, u)
    modes = {('all', city.casefold()), ('all', '')}
    if trade:
        modes.update(((trade, city.casefold()), (trade, '')))
    channels = {lane(source, trade=t, city=c) for t, c in modes}
    if owner:
        channels.add(lane(source, 'mine', owner))
    if marker and marker.get('origin') == origin and set(marker.get('channels', [])) == channels:
        # Stock, price, withdrawal and payment changes are resolved live. Do not
        # multiply a 100-item native checkout into hundreds of redundant writes.
        return
    entry = dict(id=key, source=source, sortKey=key, origin=origin, active=True)
    for channel in (marker or {}).get('channels', []):
        if channel not in channels:
            u.put(channel, key, {**entry, 'active': False})
    for channel in channels:
        u.put(channel, key, entry)
    u.put('rp_opportunity_refs', ref_key(source, key), dict(origin=origin, channels=sorted(channels)))


def _blocks(u, uid, owner):
    if not uid or not owner or uid == owner:
        return False
    from repaidians import blocked
    return blocked(u, uid, owner) or any((u.get('network_blocks', a + ':' + b) or {}).get('active')
               for a, b in ((uid, owner), (owner, uid)))


def _purchased(u, uid, pid):
    if not uid:
        return False
    proofs = index_query(u, 'rp_purchase_' + digest(uid + ':' + pid), limit=PROOF_SCAN)
    for proof in proofs:
        order = u.get('retail_orders', proof.get('orderId', ''))
        if (order and order.get('customer_id') == uid and order.get('state') == 'paid'
                and re.fullmatch(r'pay_[A-Za-z0-9]+', str(order.get('payment_id', '')))
                and any(i.get('product_id') == pid and type(i.get('quantity')) is int and i['quantity'] > 0 for i in order.get('items', []))):
            return True
    return False


def _safe_image(value):
    return value if isinstance(value, str) and len(value) <= 600 and (value.startswith('/api/') or value.startswith('/images/') or value.startswith('https://')) else ''


def resolve(u, source, key, actor):
    if source not in SOURCE_KINDS or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', str(key)):
        return None
    row = u.get(SOURCE_KINDS[source], key)
    if not row:
        return None
    now = time.time()
    uid = actor_user(actor).get('id')
    owner, trade, city = _fields(source, row, u)
    if not owner or _blocks(u, uid, owner) or (u.get('network_suspensions', owner) or {}).get('active'):
        return None
    card = dict(source=source, id=key, trade=trade, city=city, ownerId=owner, saved=False,
                available=True, imageUrl='', action=dict(route='contracts' if source == 'contract' else 'careers' if source == 'career' else 'market', source=source, id=key))
    if source == 'contract':
        if row.get('source_kind') == 'customer_custom_query' or row.get('status') != 'open' or row.get('deadline', 0) <= now or row.get('ends_at', 0) <= now:
            return None
        card.update(kind='tender', status='open', title=row.get('title', ''), description=str(row.get('sector', ''))[:80],
                    budgetPaise=row.get('budget_paise'), deadline=int(row['deadline'] * 1000), ownerName=row.get('owner_name', ''),
                    manpowerNeeded=row.get('manpower_needed'))
    elif source == 'career':
        from contract_work import public_hiring, hiring_source_authorized, team_capacity
        if not trade:
            return None
        hiring = row.get('hiring') or {}
        worker = u.get('workers', owner) or {}
        if (not hiring_source_authorized(u, row)
                or row.get('status') not in ('planning', 'active') or row.get('ends_at', 0) <= now
                or hiring.get('status') != 'open' or hiring.get('deadline', 0) <= now
                or team_capacity(row)['vacancies'] <= 0):
            return None
        card.update(kind='job', status='open', title=row.get('title', ''), description=hiring.get('summary', '')[:3000],
                    pricePaise=hiring.get('daily_rate_paise'), deadline=int(hiring['deadline'] * 1000),
                    skills=hiring.get('skills', [])[:20], ownerName=worker.get('name', ''), openings=team_capacity(row)['vacancies'], rateUnit='day')
        card['details'] = public_hiring(row)
    elif source == 'inventory':
        from procurement import live_product
        from shop_prime import public_prime
        shop = u.get('shops', row.get('shop_id', '')) or {}
        if not live_product(u, row, now) or row.get('stock', 0) <= 0:
            return None
        prime = public_prime(u, shop, now)
        card.update(kind='product', status='available', title=row.get('name', ''), description=row.get('compatibility', '')[:300],
                    imageUrl=_safe_image(row.get('image_url')), pricePaise=row.get('price_paise'), condition=row.get('condition', 'new'),
                    ownerName=shop.get('name', ''), prime=dict(active=prime['active'], endsAt=int(prime['ends_at'] * 1000) if prime['ends_at'] else None))
        if row.get('condition') == 'refurbished':
            card['refurbishment'] = {k: row['refurbishment'][k] for k in REFURB_FIELDS if k in (row.get('refurbishment') or {})}
    else:
        if row.get('mode') != 'second_hand' or row.get('status') != 'published' or (row.get('expires_at') and row['expires_at'] <= now):
            return None
        card.update(kind='product', status='available', title=row.get('name', ''), description=row.get('condition', '')[:1500],
                    imageUrl='/api/operations/market/photos/' + str(row.get('photo_id', '')),
                    pricePaise=row.get('value_paise'), condition='second_hand', ownerName=row.get('owner_name', ''))
    if uid:
        card['saved'] = bool((u.get(lane(source, 'saved', uid), key) or {}).get('active'))
    card['shareable'] = bool(uid and (owner == uid or (source == 'inventory' and _purchased(u, uid, key))))
    return card


def hydrate(u, reference, actor):
    return resolve(u, reference.get('source'), reference.get('id'), actor)


def validate_reference(u, ref, actor):
    try:
        reference = Reference.model_validate(ref).model_dump()
    except ValueError:
        fail('INVALID_REFERENCE', 'Choose a genuine published Repaido listing.', 422)
    card = hydrate(u, reference, actor)
    if not card:
        fail('REFERENCE_UNAVAILABLE', 'This listing is no longer available.', 404)
    if not card['shareable']:
        fail('REFERENCE_FORBIDDEN', 'Share your own published listing or a product you actually purchased.', 403)
    return card


def authorizepublish(u, user, ref):
    return validate_reference(u, ref, {'user': user})


def _token_decode(cursor, filters):
    if not cursor:
        return {}
    try:
        value = json.loads(base64.urlsafe_b64decode(cursor + '=' * (-len(cursor) % 4)))
        if len(cursor) > 3000 or value.get('filter') != filters or not isinstance(value.get('positions'), dict):
            raise ValueError()
        for source, pos in value['positions'].items():
            if source not in SOURCE_KINDS or not isinstance(pos, dict):
                raise ValueError()
            for field in ('raw', 'index', 'purchased'):
                if pos.get(field) and not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', str(pos[field])):
                    raise ValueError()
            if pos.get('purchaseOrder') and not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', str(pos['purchaseOrder'])):
                raise ValueError()
            if type(pos.get('purchaseOffset', 0)) is not int or not 0 <= pos.get('purchaseOffset', 0) <= 100:
                raise ValueError()
        return value['positions']
    except (ValueError, TypeError, KeyError, AttributeError):
        fail('INVALID_CURSOR', 'This opportunity page cursor is invalid.', 422)


def _token_encode(positions, filters):
    data = json.dumps({'filter': filters, 'positions': positions}, separators=(',', ':')).encode()
    return base64.urlsafe_b64encode(data).decode().rstrip('=')


def _purchase_backfill(u, uid, pos, limit=SCAN):
    marker = u.get('rp_purchase_backfill', uid) or {'after': '', 'done': False}
    if pos.get('purchaseRawDone'):
        return []
    after = pos.get('purchaseOrder', '')
    rows = native_scan(u, 'retail_orders', after, limit=2, customer=uid)
    products = []
    count = min(SCAN, limit)
    if rows:
        key, row = rows[0]
        index_record(u, 'retail_orders', key, row, origin='legacy')
        offset = pos.get('purchaseOffset', 0)
        lines = row.get('items', [])[:100]
        for item in lines[offset:offset + count]:
            pid = item.get('product_id')
            reference = u.get(lane('inventory', 'purchased', uid), pid) if isinstance(pid, str) else None
            if reference and reference.get('origin') == 'legacy' and reference.get('firstOrderId') == key:
                products.append(pid)
        offset += min(count, max(0, len(lines) - offset))
        if offset >= len(lines):
            pos.update(purchaseOrder=key, purchaseOffset=0, purchaseRawDone=len(rows) <= 1)
            if marker['after'] == after:
                marker['after'] = key
                marker['done'] = len(rows) <= 1
        else:
            pos['purchaseOffset'] = offset
    else:
        pos['purchaseRawDone'] = True
        if marker['after'] == after:
            marker['done'] = True
    u.put('rp_purchase_backfill', uid, marker)
    return products


def page(u, actor, kind='all', trade='all', city='', mode='all', cursor=None, limit=20):
    from repaidians import browse, pro
    browse(u, actor)
    uid = actor_user(actor).get('id', '')
    if mode != 'all':
        pro(u, actor)
    filters = digest(json.dumps([kind, trade, city.casefold(), mode, uid if mode != 'all' else '']))
    positions = _token_decode(cursor, filters)
    sources = [s for s in SOURCE_KINDS if kind == 'all' or (kind == 'tenders' and s == 'contract')
               or (kind == 'jobs' and s == 'career') or (kind == 'products' and s in ('inventory', 'second_hand'))]
    items, more = [], False
    seen = set()
    if mode == 'shareable' and 'inventory' in sources:
        purchase_pos = positions.setdefault('inventory', {'raw': '', 'index': '', 'rawDone': False, 'indexDone': False, 'legacy': False})
        if not cursor and (u.get('rp_purchase_backfill', uid) or {}).get('done'):
            purchase_pos.update(purchaseRawDone=True, purchaseLegacy=True)
        for key in _purchase_backfill(u, uid, purchase_pos, limit):
            card = resolve(u, 'inventory', key, actor)
            if (card and card['shareable'] and (trade == 'all' or card['trade'] == trade)
                    and (not city or card['city'].casefold() == city.casefold()) and ref_key('inventory', key) not in seen):
                items.append(card)
                seen.add(ref_key('inventory', key))
        if len(items) >= limit:
            return {'items': items, 'nextCursor': _token_encode(positions, filters), 'indexing': True}
    for source in sources:
        pos = positions.setdefault(source, {'raw': '', 'index': '', 'rawDone': mode == 'saved', 'indexDone': False, 'legacy': False})
        marker = u.get('rp_opportunity_backfill', source) or {'after': '', 'done': False}
        if not cursor and marker['done']:
            pos.update(rawDone=True, legacy=True)
        streams = []
        if not pos.get('indexDone'):
            channel = lane(source, mode if mode in ('mine', 'saved') else 'mine' if mode == 'shareable' else 'all', uid if mode != 'all' else '', trade if mode == 'all' else 'all', city if mode == 'all' else '')
            streams.append(('index', index_query(u, channel, pos.get('index', ''))))
        if mode == 'shareable' and source == 'inventory' and not pos.get('purchaseDone'):
            streams.append(('purchased', index_query(u, lane(source, 'purchased', uid), pos.get('purchased', ''))))
        if not pos.get('rawDone'):
            streams.append(('raw', native_scan(u, SOURCE_KINDS[source], pos.get('raw', ''))))
        for stream, rows in streams:
            examined = 0
            for entry in rows[:SCAN]:
                key, row = entry if stream == 'raw' else (entry['id'], entry)
                previous = pos.get(stream, '')
                pos[stream] = key
                examined += 1
                if stream == 'raw':
                    index_record(u, SOURCE_KINDS[source], key, row, origin='legacy')
                    if previous == marker['after']:
                        marker['after'] = key
                    indexed = u.get('rp_opportunity_refs', ref_key(source, key)) or {}
                    if indexed.get('origin') == 'live':
                        continue
                elif (not row.get('active') or (stream == 'index' and mode != 'saved' and not pos.get('legacy') and row.get('origin') == 'legacy')
                      or (stream == 'purchased' and row.get('origin') == 'legacy' and not pos.get('purchaseLegacy'))):
                    continue
                card = resolve(u, source, key, actor)
                if (not card or (trade != 'all' and card['trade'] != trade) or (city and card['city'].casefold() != city.casefold())
                        or (mode == 'mine' and card['ownerId'] != uid) or (mode == 'shareable' and not card['shareable'])
                        or (mode == 'saved' and not card['saved']) or ref_key(source, key) in seen):
                    continue
                items.append(card)
                seen.add(ref_key(source, key))
                if len(items) >= limit:
                    break
            done = len(rows) <= SCAN and examined == len(rows)
            pos['rawDone' if stream == 'raw' else 'purchaseDone' if stream == 'purchased' else 'indexDone'] = done
            if stream == 'raw':
                if done and marker['after'] == pos['raw']:
                    marker['done'] = True
                u.put('rp_opportunity_backfill', source, marker)
            more |= not done
            if len(items) >= limit:
                break
        if len(items) >= limit:
            more = True
            break
    more |= any(not positions.get(s, {}).get('indexDone') or not positions.get(s, {}).get('rawDone')
                or (mode == 'shareable' and s == 'inventory' and not positions.get(s, {}).get('purchaseDone')) for s in sources)
    if mode == 'shareable':
        more |= 'inventory' in sources and not positions.get('inventory', {}).get('purchaseRawDone', False)
    return {'items': items, 'nextCursor': _token_encode(positions, filters) if more else None,
            'indexing': any(not (u.get('rp_opportunity_backfill', s) or {}).get('done', False) for s in sources)}


def initialize(core):
    if core.USE_FIRESTORE:
        return
    with core.db() as c:
        c.execute("CREATE INDEX IF NOT EXISTS operation_social_sort ON operation_records(kind,json_extract(body,'$.sortKey'))")
        c.execute("CREATE INDEX IF NOT EXISTS operation_retail_customer_key ON operation_records(json_extract(body,'$.customer_id'),id) WHERE kind='retail_orders'")


def install(core):
    router = APIRouter(prefix='/repaidians/opportunities', tags=['Shared Repaido opportunities'])
    store = core.operations_store

    def actor(request: Request, response: Response, authorization: str = Header(default='')):
        return core.repaidians_actor(request, response, authorization)

    @router.get('')
    def board(kind: Literal['all', 'tenders', 'jobs', 'products'] = 'all', trade: str = 'all', city: str = '',
              mode: Literal['all', 'mine', 'shareable', 'saved'] = 'all', cursor: str | None = None, limit: int = 20, a=Depends(actor)):
        from repaidians import TRADES
        if trade not in ('all', *TRADES) or len(city) > 80 or not 1 <= limit <= 50:
            fail('INVALID_FILTER', 'Choose a supported trade, city and page size.', 422)
        return store.run(lambda u: page(u, a, kind, trade, city.strip(), mode, cursor, limit))

    @router.get('/{source}/{key}')
    def detail(source: str, key: str, a=Depends(actor)):
        from repaidians import browse
        def read(u):
            browse(u, a)
            card = resolve(u, source, key, a)
            if not card:
                fail('REFERENCE_UNAVAILABLE', 'This listing is no longer available.', 404)
            return card
        return store.run(read)

    @router.put('/{source}/{key}/saved')
    def saved(source: str, key: str, body: Saved, a=Depends(actor)):
        from repaidians import pro
        def save(u):
            pro(u, a)
            if not resolve(u, source, key, a):
                fail('REFERENCE_UNAVAILABLE', 'This listing is no longer available.', 404)
            uid = actor_user(a)['id']
            u.put(lane(source, 'saved', uid), key, dict(id=key, source=source, sortKey=key, active=body.active))
            return {'saved': body.active}
        return store.run(save)

    core.app.include_router(router)
    native = APIRouter(prefix='/operations/market/listings', tags=['Public marketplace listing'])

    @native.get('/{key}')
    def public_market_listing(key: str):
        from marketplace import active, view
        def read(u):
            row = u.get('market_listings', key)
            if not row or not active(row):
                fail('NOT_FOUND', 'This listing is no longer available.', 404)
            return view(row)
        return store.run(read)
    core.app.include_router(native)
