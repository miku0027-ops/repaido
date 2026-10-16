"""Owner stock imports and statements from native commerce records.

Preview is read-only. A commit revalidates every row in one transaction and
retains an owner-scoped idempotency receipt. Statements never move money.
"""
import csv
import hashlib
import io
import json
import statistics
import time
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import Field, ValidationError
from operations import Input, fail
from procurement import Stock, prepare_stock_item
from integrations import audit

MAX_ROWS = 25  # Includes worst-case old/new discovery lanes for every edited row.
MAX_CSV = 120_000
MAX_SKU_CHECK = 2_000
REQUIRED = ('product_id','expected_version','name','sku','category','compatibility','price_paise','on_hand')
COLUMNS = (*REQUIRED,'low_stock','gst_bps','condition','status','image_url','warranty','refurbishment_details','refurbishment')


class CsvPreview(Input):
    csv_text: str = Field(min_length=1,max_length=MAX_CSV)


class CsvCommit(CsvPreview):
    expected_shop_version: int = Field(ge=0)
    preview_digest: str = Field(pattern=r'^[a-f0-9]{64}$')
    request_id: str = Field(min_length=16,max_length=100)


def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()


def owner_shop(u,user):
    shops=u.find('shops','owner_id',user['id'],limit=50)
    shop=next((s for s in shops if s.get('status')=='approved'),None)
    if not shop:fail('SHOP_APPROVAL_REQUIRED','An approved shop owned by this account is required.',403)
    return shop


def csv_rows(raw):
    """Reject ambiguous headers, surplus cells and oversized batches explicitly."""
    if len(raw.encode('utf-8'))>MAX_CSV:fail('CSV_TOO_LARGE','Choose a UTF-8 CSV smaller than 120 KB.',422)
    try:
        reader=csv.DictReader(io.StringIO(raw.lstrip('\ufeff'),newline=''),strict=True)
        headers=reader.fieldnames or []
        if len(set(headers))!=len(headers) or any(name not in COLUMNS for name in headers):
            fail('CSV_HEADERS','Use unique columns from the inventory template; unexpected columns are not accepted.',422)
        missing=[key for key in REQUIRED if key not in headers]
        if missing:fail('CSV_HEADERS','Missing required columns: '+', '.join(missing),422)
        result=[]
        for row in reader:
            if len(result)>=MAX_ROWS:fail('CSV_ROW_LIMIT',f'Import at most {MAX_ROWS} products per file.',422)
            result.append((reader.line_num,row))
        if not result:fail('CSV_EMPTY','Add at least one product row beneath the header.',422)
        return result
    except (csv.Error,UnicodeError):fail('CSV_INVALID','The CSV could not be read. Check quotes and use UTF-8.',422)


def preview(u,shop,raw):
    parsed=csv_rows(raw)
    catalogue=u.find('inventory','shop_id',shop['id'],limit=MAX_SKU_CHECK+1)
    if len(catalogue)>MAX_SKU_CHECK:
        fail('CATALOGUE_TOO_LARGE','CSV imports support shops with up to 2,000 products. Edit individual products for this catalogue.',422)
    ids=[(row.get('product_id') or '').strip() for _,row in parsed]
    u.prefetch([('inventory',key) for key in ids if 1<=len(key)<=100 and all(c.isalnum() or c in '-_' for c in key)])
    rows=[];candidates=[];seen_ids=set();seen_skus=set();now=time.time()
    for number,row in parsed:
        pid=(row.get('product_id') or '').strip()
        item={'line':number,'product_id':pid,'name':(row.get('name') or '').strip(),'errors':[]}
        try:
            if None in row or any(value is None for value in row.values()):
                fail('CSV_CELLS','Every row must have the same number of cells as the header.',422)
            values={key:value.strip() for key,value in row.items() if key!='product_id' and value.strip()}
            if 'refurbishment' in values:
                try:values['refurbishment']=json.loads(values['refurbishment'])
                except (ValueError,TypeError):fail('REFURBISHMENT_JSON','Refurbishment must contain the structured inspection JSON.',422)
            body=Stock.model_validate(values)
            if pid in seen_ids:fail('DUPLICATE_PRODUCT','Each product ID may occur only once per import.',422)
            if body.sku.casefold() in seen_skus:fail('DUPLICATE_SKU','Each SKU may occur only once per import.',422)
            seen_ids.add(pid);seen_skus.add(body.sku.casefold())
            candidate=prepare_stock_item(u,shop,pid,body,now=now,catalogue=catalogue)
            existing=u.get('inventory',pid)
            item.update(action='update' if existing else 'create',expected_version=body.expected_version,
                        old_on_hand=(existing or {}).get('stock',0)+(existing or {}).get('reserved',0),
                        on_hand=body.on_hand,available=candidate['stock'],reserved=candidate['reserved'],
                        old_price_paise=(existing or {}).get('price_paise'),price_paise=body.price_paise,
                        sku=body.sku,status=body.status)
            candidates.append(candidate)
        except ValidationError as exc:
            item['errors']=[{'code':'INVALID_FIELD','field':'.'.join(map(str,e['loc'])),'message':e['msg']} for e in exc.errors(include_url=False,include_input=False)]
        except HTTPException as exc:
            item['errors']=[exc.detail if isinstance(exc.detail,dict) else {'code':'INVALID_ROW','message':str(exc.detail)}]
        rows.append(item)
    errors=sum(bool(row['errors']) for row in rows)
    fingerprint=None
    if not errors:
        fingerprint=digest({'shop_id':shop['id'],'shop_version':shop.get('version',0),'csv':raw,
                            'items':[{k:v for k,v in p.items() if k!='stock_confirmed_at'} for p in candidates]})
    return {'shop_id':shop['id'],'shop_version':shop.get('version',0),'rows':rows,'error_rows':errors,
            'can_commit':not errors,'preview_digest':fingerprint,'max_rows':MAX_ROWS},candidates


def csv_cell(value):
    if value is None:return ''
    if isinstance(value,(dict,list)):return json.dumps(value,ensure_ascii=False,separators=(',',':'))
    text=str(value)
    # Quoting alone does not stop spreadsheet formula execution.
    return "'"+text if text.lstrip().startswith(('=','+','-','@','\t','\r')) else text


def csv_text(columns,rows):
    result=io.StringIO(newline='');writer=csv.writer(result)
    writer.writerow(columns)
    for row in rows:writer.writerow([csv_cell(row.get(key)) for key in columns])
    return result.getvalue()


def page(u,kind,shop_id,after,limit):
    if '/' in after or after in ('.','..'):fail('INVALID_CURSOR','Refresh this report before continuing.',422)
    rows=u.find(kind,'shop_id',shop_id,limit=limit+1,after=after or None)
    return rows[:limit],rows[limit-1]['id'] if len(rows)>limit else None


def payout_evidence(u,batch):
    """Check the complete bounded batch once, even across many statement rows."""
    cache=getattr(u,'_shop_statement_batch_evidence',None)
    if cache is None:cache={};u._shop_statement_batch_evidence=cache
    if batch['id'] in cache:return cache[batch['id']]
    flags=[];ids=batch.get('order_ids',[]);amount=batch.get('amount_paise')
    if not isinstance(ids,list) or not ids or len(ids)>200 or len(set(ids))!=len(ids):
        flags.append('payout_allocation_review')
    else:
        u.prefetch([('shop_payables',key) for key in ids]);allocations=[u.get('shop_payables',key) for key in ids]
        if any(not row or row.get('shop_id')!=batch['shop_id'] or row.get('batch_id')!=batch['id'] for row in allocations):flags.append('payout_allocation_mismatch')
        elif sum(row.get('amount_paise',0) for row in allocations)!=amount:flags.append('payout_amount_mismatch')
    if batch.get('status')=='processed':
        journal=u.get('journals','shop-payout-'+batch['id']) or {};lines=journal.get('lines',[])
        if journal.get('status')!='posted' or not batch.get('provider_id'):flags.append('payout_confirmation_missing')
        elif (sum(line.get('debit',0) for line in lines if line.get('account')=='parts_payable')!=amount
              or sum(line.get('credit',0) for line in lines if line.get('account')=='payment_clearing')!=amount
              or sum(line.get('debit',0)-line.get('credit',0) for line in lines)!=0):flags.append('payout_journal_mismatch')
        if u.get('journals','reverse-shop-payout-'+batch['id']):flags.append('payout_reversal_recorded')
    cache[batch['id']]=flags
    return flags


def reconciliation(u,p):
    """Evidence gaps are visible; an amount is never promoted into a payout."""
    flags=[];batch=None;source=None;invoice=None;journal=None;payment_reference=None
    if p.get('retail_order_id'):
        kind='retail';source=u.get('retail_orders',p['retail_order_id'])
        journal=u.get('journals','retail:'+p['retail_order_id'])
        if source:
            payment_reference=source.get('payment_id')
            line=next((i for i in source.get('items',[]) if i.get('shop_id')==p['shop_id'] and p['id']==source['id']+':'+str(i.get('product_id',''))),None)
            if not line:
                source=None;flags.append('source_shop_mismatch')
            else:
                expected=line.get('total_paise',0)-(0 if (source.get('coupon') or {}).get('funded_by')=='repaido' else line.get('discount_paise',0))
                if expected!=p.get('amount_paise'):flags.append('source_allocation_mismatch')
                if source.get('state')!='paid' or not payment_reference or source.get('amount_refunded') or source.get('refund_pending') or source.get('refunded_at'):
                    flags.append('payment_or_refund_review')
                elif not source.get('received_at'):flags.append('awaiting_customer_receipt')
                elif not p.get('batch_id'):flags.append('retail_settlement_review')
    elif p.get('rental_id'):
        kind='rental';source=u.get('rentals',p['rental_id'])
        payment=u.get('rental_payments',p['rental_id']+':'+p.get('payment_kind','usage')) or {}
        payment_reference=payment.get('payment_id')
        journal=u.get('journals','rental-damage-'+p['rental_id'] if p.get('payment_kind')=='deposit' else 'rental-capture-'+payment.get('id',''))
        if source and source.get('shop_id')!=p['shop_id']:source=None;flags.append('source_shop_mismatch')
        if source and (source.get('state')!='returned' or source.get('inspection') not in ('clear','resolved') or source.get('financial_hold')):flags.append('rental_return_or_damage_review')
        if payment.get('status')!='captured' or payment.get('amount_refunded') and p.get('payment_kind')!='deposit':flags.append('payment_or_refund_review')
    else:
        kind='parts';job_id=p.get('job_id');source=u.get('jobs',job_id) if job_id else None
        payment=(u.get('payments',job_id) or {}) if job_id else {};payment_reference=payment.get('payment_id')
        journal=u.get('journals',job_id) if job_id else None
        if source:
            invoice=source.get('invoice')
            if source.get('state')!='completed' or source.get('payment_status')!='verified':flags.append('customer_payment_pending')
            if any(source.get(key) for key in ('financial_hold','parts_refund_hold','allocation_review_required')):flags.append('financial_review')
            if u.get('journals','reverse_'+source['id']):flags.append('source_journal_reversed')
    if not source:flags.append('source_missing')
    if not journal or journal.get('status')!='posted':flags.append('source_journal_missing')
    if p.get('batch_id'):
        batch=u.get('shop_batches',p['batch_id'])
        if not batch or batch.get('shop_id')!=p['shop_id']:
            batch=None;flags.append('payout_batch_missing')
        else:
            if p['id'] not in batch.get('order_ids',[]):flags.append('payout_allocation_mismatch')
            flags.extend(payout_evidence(u,batch))
            if batch.get('status') in ('submitting','unknown'):flags.append('provider_reconciliation_required')
            elif batch.get('status') in ('reversed','failed','rejected','cancelled'):flags.append('payout_'+batch['status'])
    if p.get('status')=='paid' and (not batch or batch.get('status')!='processed'):flags.append('paid_status_mismatch')
    return {'id':p['id'],'source_kind':kind,'source_id':(source or {}).get('id'),
            'amount_paise':p.get('amount_paise',0),'status':p.get('status','unknown'),
            'weekly_due_at':p.get('weekly_due_at'),'batch_id':(batch or {}).get('id'),
            'transfer_status':(batch or {}).get('status',p.get('transfer_status','not_sent')),
            'provider_id':(batch or {}).get('provider_id'),'payment_reference':payment_reference if source else None,
            'invoice_id':(invoice or {}).get('id'),'invoice_status':(invoice or {}).get('status'),
            'source_created_at':(source or {}).get('created_at'),'flags':list(dict.fromkeys(flags))}


def install(core):
    router=APIRouter(prefix='/operations/shop/tools',tags=['Shop business tools']);store=core.operations_store

    def shop_user(user=Depends(core.current_user)):
        if not user.get('phone_authenticated'):fail('PHONE_OTP_REQUIRED','Sign in using your shop mobile OTP.',403)
        return user

    @router.get('/inventory/template')
    def template(user=Depends(shop_user)):
        store.run(lambda u:owner_shop(u,user))
        return {'csv_text':csv_text(COLUMNS,[]),'max_rows':MAX_ROWS,'required_columns':REQUIRED,
                'note':'Use integer paise. expected_version is 0 for a new product; export current stock to update existing products.'}

    @router.get('/inventory/export')
    def export(after:str=Query(default='',max_length=100),user=Depends(shop_user)):
        def read(u):
            s=owner_shop(u,user);rows,cursor=page(u,'inventory',s['id'],after,MAX_ROWS)
            return {'csv_text':csv_text(COLUMNS,[{**p,'product_id':p['id'],'expected_version':p.get('version',0),'on_hand':p.get('stock',0)+p.get('reserved',0)} for p in rows]),'next_cursor':cursor,'count':len(rows)}
        return store.run(read)

    @router.post('/inventory/preview')
    def inventory_preview(body:CsvPreview,user=Depends(shop_user)):
        return store.run(lambda u:preview(u,owner_shop(u,user),body.csv_text)[0])

    @router.post('/inventory/commit')
    def inventory_commit(body:CsvCommit,user=Depends(shop_user)):
        def save(u):
            s=owner_shop(u,user);key=digest([user['id'],s['id'],body.request_id]);fingerprint=digest(body.model_dump(exclude={'request_id'}))
            old=u.get('shop_inventory_imports',key)
            if old:
                if old['fingerprint']!=fingerprint:fail('KEY_REUSED','This import retry differs from the saved request. Preview the new file.',409)
                return old['result']
            if s.get('version',0)!=body.expected_shop_version:fail('SHOP_CHANGED','Your shop changed. Preview the file again.',409)
            result,candidates=preview(u,s,body.csv_text)
            if not result['can_commit']:
                raise HTTPException(409,{'code':'IMPORT_CHANGED','message':'One or more rows need attention. Preview the file again. No rows were saved.','rows':result['rows']})
            if result['preview_digest']!=body.preview_digest:fail('PREVIEW_CHANGED','Stock or product details changed. Preview the file again; no rows were saved.',409)
            for product in candidates:u.put('inventory',product['id'],product)
            committed={'import_id':key,'shop_id':s['id'],'count':len(candidates),'committed_at':time.time(),
                       'products':[{'id':p['id'],'version':p['version']} for p in candidates]}
            u.put('shop_inventory_imports',key,{'id':key,'shop_id':s['id'],'owner_id':user['id'],'fingerprint':fingerprint,'result':committed})
            audit(u,'ShopInventoryCsvImported',user['id'],shop_id=s['id'],import_id=key,product_ids=[p['id'] for p in candidates])
            # Also protects against future discovery hooks growing beyond today's budget.
            if len(u.pending)>450:fail('IMPORT_WRITE_LIMIT','This import exceeds the safe transaction limit. Use fewer rows.',409)
            return committed
        return store.run(save)

    @router.get('/stock-alerts')
    def stock_alerts(after:str=Query(default='',max_length=100),user=Depends(shop_user)):
        def read(u):
            s=owner_shop(u,user);rows,cursor=page(u,'inventory',s['id'],after,100);now=time.time();alerts=[]
            for p in rows:
                reasons=[]
                if p.get('status')!='approved':continue
                if p.get('stock',0)<=p.get('low_stock',3):reasons.append('out_of_stock' if p.get('stock',0)<=0 else 'low_stock')
                if not 0<=now-p.get('stock_confirmed_at',0)<=86400:reasons.append('stock_confirmation_due')
                if reasons:alerts.append({k:p.get(k) for k in ('id','name','sku','stock','reserved','low_stock','version','stock_confirmed_at')}|{'reasons':reasons})
            return {'items':alerts,'scanned':len(rows),'next_cursor':cursor,'as_of':now,
                    'note':'Alerts use available stock after reservations. Confirm physical stock through the inventory editor or a reviewed import.'}
        return store.run(read)

    @router.get('/statement')
    def statement(after:str=Query(default='',max_length=200),user=Depends(shop_user)):
        def read(u):
            s=owner_shop(u,user);rows,cursor=page(u,'shop_payables',s['id'],after,50)
            values=[reconciliation(u,p) for p in rows]
            bank=u.get('shop_banks',s['id']) or {}
            return {'shop_id':s['id'],'shop_name':s['name'],'entries':values,'next_cursor':cursor,'as_of':time.time(),
                    'bank':{'status':bank.get('status','not_linked'),'last4':bank.get('last4')},
                    'page_totals':{'recorded_paise':sum(p['amount_paise'] for p in values),
                                   'confirmed_paid_paise':sum(p['amount_paise'] for p in values if p['status']=='paid' and p['transfer_status']=='processed' and not any(f.startswith(('payout_','paid_')) for f in p['flags'])),
                                   'review_count':sum(bool(p['flags']) for p in values)},
                    'csv_text':csv_text(('id','source_kind','source_id','amount_paise','status','invoice_id','invoice_status','batch_id','transfer_status','provider_id','payment_reference','flags'),values),
                    'note':'Amounts are recorded shop allocations in INR, not profit. Only provider-confirmed transfers with a posted payout journal count as paid. Retail receipt review remains subject to settlement review.'}
        return store.run(read)

    @router.get('/documents/{payable_id}')
    def document(payable_id:str,user=Depends(shop_user)):
        def read(u):
            s=owner_shop(u,user);p=u.get('shop_payables',payable_id)
            if not p or p.get('shop_id')!=s['id']:fail('NOT_FOUND','Statement entry not found.',404)
            entry=reconciliation(u,p);items=[];source=None;title='Shop allocation record'
            if p.get('retail_order_id'):
                source=u.get('retail_orders',p['retail_order_id'])
                if source:
                    items=[{k:i.get(k) for k in ('product_id','name','quantity','unit_price_paise','total_paise','gst_bps','base_paise','discount_paise')} for i in source.get('items',[]) if i.get('shop_id')==s['id'] and p['id']==source['id']+':'+str(i.get('product_id',''))]
                    title='Retail payment allocation'
            elif p.get('rental_id'):
                source=u.get('rentals',p['rental_id']);title='Rental payment allocation'
                if source and source.get('shop_id')==s['id']:
                    items=[{'name':source.get('listing_name',source.get('name','Rental')),'quantity':1,'total_paise':p['amount_paise']}]
            else:
                order=u.get('parts_orders',p['id'])
                if order and order.get('shop_id')==s['id']:
                    items=[{k:i.get(k) for k in ('product_id','name','quantity','unit_price_paise')} for i in order.get('items',[])];title='Parts order allocation'
            return {'title':title,'shop_name':s['name'],'entry':entry,'items':items,'currency':'INR',
                    'note':'This statement reproduces saved order and payment records. A linked job invoice reference is not a supplier tax invoice. Obtain the supplier-issued tax invoice separately when applicable.'}
        return store.run(read)

    @router.get('/response-report')
    def response_report(after:str=Query(default='',max_length=100),user=Depends(shop_user)):
        def read(u):
            s=owner_shop(u,user);rows,cursor=page(u,'parts_orders',s['id'],after,100);now=time.time()
            timed=[o['accepted_at']-o['created_at'] for o in rows if isinstance(o.get('accepted_at'),(int,float)) and isinstance(o.get('created_at'),(int,float)) and o['created_at']<=o['accepted_at']<=now]
            return {'sample_size':len(rows),'accepted_count':sum(bool(o.get('accepted_at')) for o in rows),
                    'measured_acceptances':len(timed),'median_accept_seconds':statistics.median(timed) if timed else None,
                    'pending_count':sum(o.get('status')=='requested' and o.get('expires_at',0)>now for o in rows),
                    'expired_pending_count':sum(o.get('status')=='requested' and o.get('expires_at',0)<=now for o in rows),
                    'cancelled_count':sum(o.get('status')=='cancelled' for o in rows),'next_cursor':cursor,
                    'note':'This page uses recorded parts orders. Acceptance time uses saved request and acceptance timestamps; cancellations are not assumed to be shop rejections. No rating or margin is inferred.'}
        return store.run(read)

    core.app.include_router(router)
