"""Weekly shop transfers; no blind resend after an uncertain provider POST."""
import os,time,uuid,re
from datetime import datetime,timedelta,timezone
from fastapi import APIRouter,Depends
from pydantic import Field
from operations import Input,fail
from integrations import audit,razorpay,enabled,configured,BankLink

class ProviderReference(Input):
    provider_id:str=Field(pattern=r'^pout_[A-Za-z0-9]+$')

def active():return enabled('REPAIDO_SHOP_PAYOUTS_ENABLED') and enabled('REPAIDO_PAYOUTS_ENABLED') and configured('RAZORPAYX_KEY_ID','RAZORPAYX_KEY_SECRET','RAZORPAYX_ACCOUNT_NUMBER','RAZORPAYX_WEBHOOK_SECRET')

def install(core):
    store=core.operations_store;r=APIRouter(prefix='/operations')
    @r.post('/admin/shops/{sid}/bank')
    def bank(sid:str,body:BankLink,admin=Depends(core.operator)):
        s=store.run(lambda u:u.get('shops',sid))
        if not s or s['status']!='approved':fail('SHOP_APPROVAL_REQUIRED','Approve the shop first.')
        result=razorpay('fund_accounts/validations/'+body.validation_id,payout=True);fund=result.get('fund_account') or {};contact=razorpay('contacts/'+str(fund.get('contact_id','')),payout=True);check=result.get('validation_results') or result.get('results') or {}
        normalize=lambda name:re.sub('[^a-z0-9]','',name.casefold())
        if result.get('status')!='completed' or check.get('account_status')!='active' or contact.get('reference_id')!=sid or not normalize(check.get('registered_name','')) or normalize(check['registered_name']) not in {normalize(s['name']),normalize(s.get('owner_name',''))}:fail('BANK_NOT_VERIFIED','Provider must verify an active account and holder name linked to this exact shop reference.')
        def save(u):
            current=u.get('shops',sid)
            if not current or current['status']!='approved' or current.get('version')!=s.get('version'):fail('SHOP_CHANGED','Refresh the reviewed shop.')
            if any(v.get('fund_account_id')==fund['id'] and v['shop_id']!=sid for v in u.all('shop_banks')) or any(v.get('fund_account_id')==fund['id'] for v in u.all('verification')):fail('BANK_ALREADY_LINKED','Bank reference already linked to another payee.')
            u.put('shop_banks',sid,dict(id=sid,shop_id=sid,fund_account_id=fund['id'],validation_id=body.validation_id,status='verified',last4=str(fund.get('bank_account',{}).get('account_number',''))[-4:],at=time.time()));audit(u,'ShopBankVerified',admin['id'],shop_id=sid,validation_id=body.validation_id);return {'status':'verified'}
        return store.run(save)
    def apply(result):
        def save(u):
            batch=next((b for b in u.all('shop_batches') if b['id']==result.get('reference_id') or b.get('provider_id')==result.get('id')),None)
            if not batch:fail('SHOP_PAYOUT_NOT_FOUND','Shop payout not found.',404)
            if result.get('amount')!=batch['amount_paise'] or result.get('currency')!='INR' or result.get('fund_account_id')!=batch['fund_account_id']:fail('PAYOUT_MISMATCH','Payout amount or destination needs reconciliation.')
            state=result.get('status','unknown')
            if batch['status']=='reversed' or batch['status']=='processed' and state not in ('processed','reversed'):return batch
            batch.update(status=state,provider_id=result['id'],checked_at=time.time());u.put('shop_batches',batch['id'],batch)
            for oid in batch['order_ids']:
                p=u.get('shop_payables',oid);p['transfer_status']=state;p['status']='paid' if state=='processed' else 'payout_'+state;u.put('shop_payables',oid,p)
            key='shop-payout-'+batch['id'];posted=u.get('journals',key)
            if state=='processed' and not posted:u.put('journals',key,dict(id=key,batch_id=batch['id'],status='posted',posted_at=time.time(),lines=[{'account':'parts_payable','debit':batch['amount_paise'],'credit':0},{'account':'payment_clearing','debit':0,'credit':batch['amount_paise']}]))
            if state=='reversed' and posted and not u.get('journals','reverse-'+key):u.put('journals','reverse-'+key,dict(id='reverse-'+key,batch_id=batch['id'],status='posted',posted_at=time.time(),lines=[{'account':l['account'],'debit':l['credit'],'credit':l['debit']} for l in posted['lines']]))
            audit(u,'ShopPayoutReconciled','provider',batch_id=batch['id'],status=state);return batch
        return store.run(save)
    def eligible(u,p):
        if p.get('rental_id'):
            r=u.get('rentals',p['rental_id']);s=u.get('shops',p['shop_id']);payment=u.get('rental_payments',p['rental_id']+':'+p['payment_kind'])
            if not r or not s or s['status']!='approved' or r['state']!='returned' or r['inspection'] not in ('clear','resolved') or r.get('financial_hold') or not payment:return False
            if p['payment_kind']=='deposit':
                refund=u.get('rental_refunds',r['id']) or {}
                return refund.get('status') in ('processed','not_due') and bool(u.get('journals','rental-damage-'+r['id'])) and payment.get('amount_refunded',0)<=refund.get('amount_paise',0)
            return payment['status']=='captured' and not payment.get('amount_refunded') and bool(u.get('journals','rental-capture-'+payment['id']))
        j=u.get('jobs',p['job_id']);s=u.get('shops',p['shop_id'])
        journal=u.get('journals',j['id']) if j else None
        credit=sum(l['credit'] for l in (journal or {}).get('lines',[]) if l['account']=='parts_payable')
        liability=sum(row['amount_paise'] for row in u.all('shop_payables') if row['job_id']==p['job_id'])
        return j and s and s['status']=='approved' and j['state']=='completed' and j['payment_status']=='verified' and not j.get('financial_hold') and not j.get('parts_refund_hold') and not j.get('allocation_review_required') and journal and journal.get('status')=='posted' and credit>=liability and not u.get('journals','reverse_'+j['id']) and not any(x['job_id']==j['id'] and x['status']!='failed' for x in u.all('refunds'))

    def weekly():
        if not active():return {'status':'provider_disabled','transfers':0}
        now=time.time();local=datetime.fromtimestamp(now,timezone(timedelta(hours=5,minutes=30)));week=(local-timedelta(days=local.weekday())).strftime('%Y-%m-%d')
        def reserve(u):
            batches=[]
            for s in u.all('shops'):
                b=u.get('shop_banks',s['id'])
                if s['status']!='approved' or not b or b['status']!='verified' or any(x['shop_id']==s['id'] and x['week']==week for x in u.all('shop_batches')):continue
                rows=[p for p in u.all('shop_payables') if p['shop_id']==s['id'] and p.get('weekly_due_at') and p['weekly_due_at']<=now and not p.get('batch_id') and eligible(u,p)]
                amount=sum(p['amount_paise'] for p in rows)
                if amount<100:continue
                batch=dict(id=str(uuid.uuid4()),shop_id=s['id'],week=week,amount_paise=amount,fund_account_id=b['fund_account_id'],order_ids=[p['id'] for p in rows],idempotency_key=str(uuid.uuid4()),status='reserved',created_at=now)
                u.put('shop_batches',batch['id'],batch)
                for p in rows:p.update(batch_id=batch['id'],transfer_status='reserved');u.put('shop_payables',p['id'],p)
                batches.append(batch)
            return batches
        store.run(reserve)
        batches=store.run(lambda u:[b for b in u.all('shop_batches') if b['status']=='reserved'])
        sent=0
        for b in batches:
            # Refresh every source payment from the provider immediately before a transfer.
            refs=store.run(lambda u:[u.get('rental_payments',p['rental_id']+':'+p['payment_kind']) if p.get('rental_id') else u.get('payments',p['job_id']) for oid in b['order_ids'] for p in [u.get('shop_payables',oid)]])
            # Parts advances also fund these orders; reconcile every job collection.
            job_ids=store.run(lambda u:{u.get('shop_payables',oid).get('job_id') for oid in b['order_ids']})
            refs+=store.run(lambda u:[a for a in u.all('payments') if a.get('kind')=='parts' and a['job_id'] in job_ids and a.get('allocated')])
            if any(not ref or not ref.get('payment_id') for ref in refs):continue
            try:
                for ref in refs:
                    result=razorpay('payments/'+ref['payment_id'])
                    store.run(lambda u:core.integrations_apply_payment(u,result))
            except Exception:continue
            def claim(u):
                current=u.get('shop_batches',b['id']);bank=u.get('shop_banks',b['shop_id'])
                if current['status']!='reserved':return False
                if not bank or bank.get('fund_account_id')!=b['fund_account_id'] or not all(eligible(u,u.get('shop_payables',oid)) for oid in b['order_ids']):return False
                current['status']='submitting';u.put('shop_batches',b['id'],current);return True
            if not store.run(claim):continue
            try:
                apply(razorpay('payouts',dict(account_number=os.environ['RAZORPAYX_ACCOUNT_NUMBER'],fund_account_id=b['fund_account_id'],amount=b['amount_paise'],currency='INR',mode='IMPS',purpose='payout',queue_if_low_balance=False,reference_id=b['id'],narration='Repaido shop parts'),payout=True,key=b['idempotency_key']));sent+=1
            except Exception:
                # Persist submitting. Do not repeat POST; webhook/provider ID reconciliation is required.
                pass
        for b in store.run(lambda u:[b for b in u.all('shop_batches') if b.get('provider_id') and b['status'] not in ('processed','reversed','failed','rejected','cancelled')])[:30]:
            try:apply(razorpay('payouts/'+b['provider_id'],payout=True))
            except Exception:pass
        return {'status':'checked','transfers':sent}
    @r.get('/admin/shop-payouts')
    def batches(admin=Depends(core.operator)):
        return store.run(lambda u:{'batches':[{k:v for k,v in b.items() if k not in ('fund_account_id','idempotency_key')} for b in u.all('shop_batches')],'banks':[{'shop_id':b['shop_id'],'status':b['status'],'last4':b['last4']} for b in u.all('shop_banks')],'enabled':active()})
    @r.post('/admin/shop-payouts/{bid}/reconcile')
    def reconcile(bid:str,body:ProviderReference,admin=Depends(core.operator)):
        result=razorpay('payouts/'+body.provider_id,payout=True)
        if result.get('reference_id')!=bid:fail('REFERENCE_MISMATCH','Provider reference does not match this batch.')
        return apply(result)
    core.shop_payouts_tick=weekly;core.shop_payouts_apply=apply;core.app.include_router(r)
