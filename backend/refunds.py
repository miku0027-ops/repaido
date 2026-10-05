"""Refund intents are reserved before I/O; uncertain POSTs are never repeated.
Receipt lookup reconciles a lost response. A failed refund needs a new reviewed intent.
"""
import hashlib
import time
from fastapi import APIRouter, Depends
from pydantic import Field
from operations import Input, fail
from integrations import razorpay, enabled, configured, apply_payment, audit

class Refund(Input):
    payment_record_id: str | None = Field(default=None,max_length=100)
    amount_paise: int=Field(gt=0)
    reason: str=Field(min_length=20,max_length=1000)
    request_id: str=Field(min_length=16,max_length=100)

def install(core):
    store=core.operations_store;r=APIRouter(prefix='/operations',tags=['Refund reconciliation'])
    def reconcile(record,result):
        if result.get('payment_id')!=record['payment_id'] or result.get('amount')!=record['amount_paise'] or result.get('receipt')!=record['receipt']:
            fail('REFUND_MISMATCH','Provider refund does not match the reserved intent.')
        payment=razorpay('payments/'+record['payment_id'])
        def save(u):
            saved=u.get('refunds',record['id'])
            if saved.get('provider_id') and saved['provider_id']!=result['id']:fail('REFUND_CONFLICT','Multiple refunds require reconciliation.')
            if saved['status']=='processed' and result['status']!='processed':return saved
            saved.update(provider_id=result['id'],status=result['status'],checked_at=time.time())
            u.put('refunds',saved['id'],saved);apply_payment(u,payment)
            if saved['status']=='processed' and not u.get('journals','refund_'+saved['id']):
                u.put('journals','refund_'+saved['id'],dict(id='refund_'+saved['id'],job_id=saved['job_id'],status='posted',posted_at=time.time(),lines=[{'account':'customer_parts_advances' if saved.get('payment_kind')=='parts' else 'customer_refunds','debit':saved['amount_paise'],'credit':0},{'account':'payment_clearing','debit':0,'credit':saved['amount_paise']}]))
            audit(u,'RefundReconciled','provider',refund_id=saved['id'],status=saved['status']);return saved
        return store.run(save)
    def check(record):
        if record.get('provider_id'):return reconcile(record,razorpay('refunds/'+record['provider_id']))
        # Never infer failure from absence. A timed-out refund can appear later.
        for skip in range(0,1000,100):
            items=razorpay('payments/'+record['payment_id']+'/refunds?count=100&skip='+str(skip)).get('items',[])
            matches=[x for x in items if x.get('receipt')==record['receipt']]
            if len(matches)>1:fail('REFUND_CONFLICT','Multiple provider records require manual review.')
            if matches:return reconcile(record,matches[0])
            if len(items)<100:break
        return {**record,'recovery':'Provider outcome is still unknown. Reconciliation will retry lookup; no additional refund is submitted.'}
    @r.post('/admin/jobs/{job_id}/refund')
    def refund(job_id:str,body:Refund,admin=Depends(core.operator)):
        if not enabled('REPAIDO_PAYMENTS_ENABLED') or not configured('RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET'):fail('PAYMENTS_UNAVAILABLE','Configure and activate Razorpay before refund testing.',503)
        key=hashlib.sha256((job_id+':'+(body.payment_record_id or job_id)+':'+body.request_id).encode()).hexdigest()
        def reserve(u):
            old=u.get('refunds',key)
            if old:
                if old['amount_paise']!=body.amount_paise or old['reason']!=body.reason:fail('KEY_REUSED','Refund retry differs from the original intent.')
                return old,False
            j=u.get('jobs',job_id);payment=u.get('payments',body.payment_record_id or job_id)
            if not j or not payment or payment.get('job_id')!=job_id or not payment.get('payment_id') or payment['status'] not in ('captured','partially_refunded'):fail('CAPTURE_REQUIRED','A verified captured payment is required.')
            # Transferred earnings need an explicit recovery/adjustment, not a negative wallet.
            if u.get('payouts',job_id) or any(p.get('batch_id') and p['job_id']==job_id for p in u.all('shop_payables')):fail('PAYOUT_ADJUSTMENT_REQUIRED','Resolve the existing payout and ledger recovery before refunding. No refund was sent.')
            previous=[x for x in u.all('refunds') if x['job_id']==job_id]
            if any(x['status'] not in ('processed','failed') for x in previous):fail('REFUND_PENDING','Reconcile the pending refund before another intent.')
            if body.amount_paise>payment['amount_paise']-payment.get('amount_refunded',0):fail('REFUND_EXCEEDS_PAYMENT','Amount exceeds the remaining captured balance.',422)
            record=dict(id=key,job_id=job_id,payment_kind=payment.get('kind','final'),payment_id=payment['payment_id'],receipt='rf_'+key[:32],amount_paise=body.amount_paise,reason=body.reason,status='submitting',created_at=time.time())
            u.put('refunds',key,record);j['parts_refund_hold' if payment.get('kind')=='parts' and not payment.get('allocated') else 'financial_hold']=True;j['payout_status']='held';u.put('jobs',job_id,j)
            audit(u,'RefundAuthorized',admin['id'],refund_id=key,job_id=job_id,amount_paise=body.amount_paise,reason=body.reason)
            return record,True
        record,created=store.run(reserve)
        if not created:return check(record)
        return reconcile(record,razorpay('payments/'+record['payment_id']+'/refund',dict(amount=record['amount_paise'],receipt=record['receipt'],speed='normal',notes={'repaido_refund':record['id']})))
    @r.get('/admin/refunds',dependencies=[Depends(core.operator)])
    def refunds():return store.run(lambda u:{'refunds':u.all('refunds')})
    @r.post('/admin/refunds/{refund_id}/reconcile',dependencies=[Depends(core.operator)])
    def retry(refund_id:str):
        record=store.run(lambda u:u.get('refunds',refund_id))
        if not record:fail('NOT_FOUND','Refund intent not found.',404)
        return check(record)
    def tick():
        if not enabled('REPAIDO_PAYMENTS_ENABLED'):return {'status':'disabled'}
        rows=store.run(lambda u:[x for x in u.all('refunds') if x['status'] not in ('processed','failed') and x.get('checked_at',0)<time.time()-300])[:20]
        errors=0
        for row in rows:
            try:check(row)
            except Exception:errors+=1
        return {'checked':len(rows),'pending_errors':errors}
    core.refunds_tick=tick;core.app.include_router(r)
