"""Parts advances: a provider-verified capture precedes stock reservation/order release."""
import copy,time,os
from fastapi import APIRouter,Depends
from operations import fail,event

def advance_total(u,job_id):
    return sum(a['amount_paise']-a.get('amount_refunded',0) for a in u.all('payments') if a.get('kind')=='parts' and a['job_id']==job_id and a.get('allocated') and a['status'] in ('captured','partially_refunded'))

def apply_capture(u,a,p):
    from integrations import audit
    from procurement import live_product,create_order
    j=u.get('jobs',a['job_id']);now=time.time()
    if p.get('currency')!='INR' or p.get('amount')!=a['amount_paise']:fail('AMOUNT_MISMATCH','Parts payment needs reconciliation.')
    if a.get('payment_id') and a['payment_id']!=p['id']:fail('DUPLICATE_COLLECTION_REVIEW','A second payment needs refund review.')
    refund=max(a.get('amount_refunded',0),int(p.get('amount_refunded') or 0))
    if refund or p.get('status')=='refunded':
        a.update(amount_refunded=refund,status='refunded' if refund>=a['amount_paise'] else 'partially_refunded',payment_id=p['id'])
        j.update(parts_refund_hold=True,payout_status='held')
    elif p.get('status')=='captured' and p.get('captured') is True and a['status'] not in ('captured','refunded','partially_refunded'):
        q=j.get('proposal',{})
        valid=j['state']=='in_progress' and q.get('id')==a['id'] and q.get('status')=='awaiting_payment' and q['expires_at']>now and q['base_scope_version']==j['scope_version']
        if valid:
            for line in q['items']:
                product=u.get('inventory',line['product_id'])
                if not live_product(u,product,now) or product['stock']<line['quantity'] or product['price_paise']!=line['unit_price_paise']:valid=False;break
        a.update(status='captured',payment_id=p['id'],allocated=bool(valid))
        if valid:
            for line in q['items']:
                product=u.get('inventory',line['product_id']);product['stock']-=line['quantity'];u.put('inventory',product['id'],product)
            q.update(status='approved',payment_status='captured');j['scope_version']+=1;j['total_paise']+=q['amount_paise']
            j['scopes'].append(dict(version=j['scope_version'],quote=copy.deepcopy(q),accepted_by=j['customer_id'],accepted_at=q['accepted_at'],price_paise=j['total_paise']))
            create_order(u,j,now)
        else:
            a['recovery']='refund_review';j.update(parts_refund_hold=True,payout_status='held')
            if q.get('id')==a['id']:q.update(status='rejected',payment_status='refund_review')
            event(u,j,'PartsAdvanceRefundRequired','payments',{'payment_record_id':a['id']})
        u.put('receipts',p['id'],dict(id=p['id'],job_id=j['id'],kind='parts',amount_paise=a['amount_paise'],currency='INR',verified_at=now))
        journal_id='parts-advance-'+a['id']
        if not u.get('journals',journal_id):u.put('journals',journal_id,dict(id=journal_id,job_id=j['id'],status='posted',posted_at=now,lines=[{'account':'payment_clearing','debit':a['amount_paise'],'credit':0},{'account':'customer_parts_advances','debit':0,'credit':a['amount_paise']}]))
        j['version']+=1;event(u,j,'PartsPaymentCaptured','payments',{'payment_record_id':a['id'],'order_released':bool(valid)})
        audit(u,'PartsAdvanceCaptured','razorpay',job_id=j['id'],payment_record_id=a['id'],allocated=bool(valid))
    else:a['last_attempt_status']=p.get('status','unknown')
    a['checked_at']=now;u.put('payments',a['id'],a)
    if refund and a.get('allocated'):j['financial_hold']=True  # Refunding installed/active parts needs an allocation review.
    j['parts_refund_hold']=any(x.get('kind')=='parts' and x['job_id']==j['id'] and x.get('recovery')=='refund_review' and x.get('amount_refunded',0)<x['amount_paise'] for x in u.all('payments'))
    j['parts_paid_paise']=advance_total(u,j['id']);u.put('jobs',j['id'],j)
    return a

def install(core):
    import integrations as gateway
    from integrations import enabled,configured,PaymentCheck,apply_payment
    store=core.operations_store;r=APIRouter(prefix='/operations',tags=['Parts advance payments'])
    @r.post('/jobs/{job_id}/parts/{quote_id}/payment-order')
    def order(job_id:str,quote_id:str,user=Depends(core.current_user)):
        if not enabled('REPAIDO_PAYMENTS_ENABLED') or not configured('RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET'):fail('PAYMENTS_UNAVAILABLE','Parts payment is not enabled. No charge or shop order was made. You can decline the request or contact support.',503)
        def reserve(u):
            j=u.get('jobs',job_id)
            if not j or j['customer_id']!=user['id']:fail('NOT_FOUND','Booking not found.',404)
            q=j.get('proposal',{})
            if j['state']!='in_progress' or q.get('id')!=quote_id or q.get('status')!='awaiting_payment' or q['expires_at']<=time.time():fail('QUOTE_STALE','This parts request is no longer payable. Ask for a fresh quote.')
            old=u.get('payments',quote_id)
            if old:return old,False
            a=dict(id=quote_id,kind='parts',job_id=job_id,customer_id=user['id'],amount_paise=q['amount_paise'],receipt=quote_id,status='creating',created_at=time.time())
            u.put('payments',quote_id,a);return a,True
        a,create=store.run(reserve)
        if create:
            result=gateway.razorpay('orders',dict(amount=a['amount_paise'],currency='INR',receipt=a['receipt'],notes={'repaido_job':job_id,'parts_quote':quote_id}))
            def save(u):
                row=u.get('payments',quote_id);row.update(order_id=result['id'],status='created');u.put('payments',quote_id,row);return row
            a=store.run(save)
        if not a.get('order_id'):fail('ORDER_RECONCILING','Payment setup is being reconciled. Do not start another payment.',409)
        return dict(key_id=os.environ['RAZORPAY_KEY_ID'],order_id=a['order_id'],amount=a['amount_paise'],currency='INR')
    @r.post('/jobs/{job_id}/parts/{quote_id}/payment-check')
    def check(job_id:str,quote_id:str,body:PaymentCheck,user=Depends(core.current_user)):
        a=store.run(lambda u:u.get('payments',quote_id))
        if not a or a['job_id']!=job_id or a['customer_id']!=user['id']:fail('NOT_FOUND','Payment not found.',404)
        p=gateway.razorpay('payments/'+body.payment_id)
        if p.get('order_id')!=a.get('order_id'):fail('WRONG_ORDER','This payment is for a different order.',403)
        return store.run(lambda u:apply_payment(u,p))
    core.app.include_router(r)
