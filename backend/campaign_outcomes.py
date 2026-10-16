"""Read-only downstream campaign outcomes from native financial/lifecycle records.

An offer reservation is not revenue. No causal attribution or profit is inferred.
"""
from fastapi import APIRouter,Depends,Query
from operations import fail

def allocation(u,jid,job,payment,settlement,refunds):
    if job.get('state')!='completed' or job.get('payment_status')!='verified' or any(job.get(k) for k in ('financial_hold','parts_refund_hold','allocation_review_required')):return 0
    if payment.get('status')!='captured' or not payment.get('payment_id') or payment.get('amount_refunded',0):return 0
    if len(refunds)>20 or any(x.get('status')!='failed' for x in refunds):return 0
    if settlement.get('status')!='paid' or settlement.get('invalidated'):return 0
    payout=u.get('payouts',jid) or {};journal=u.get('journals',jid) or {};paid=u.get('journals','payout_'+jid) or {}
    if payout.get('status')!='processed' or not payout.get('provider_id') or journal.get('status')!='posted' or paid.get('status')!='posted':return 0
    if u.get('journals','reverse_'+jid) or u.get('journals','reverse_payout_'+jid):return 0
    lines=journal.get('lines',[])
    if not lines or any(type(x.get(k)) is not int or x[k]<0 for x in lines for k in ('debit','credit')) or sum(x['debit']-x['credit'] for x in lines):return 0
    value=sum(x['credit']-x['debit'] for x in lines if x.get('account') in ('company_commission','company_penalty_income'))
    if value!=settlement.get('company_earnings_paise') or payout.get('amount_paise')!=settlement.get('net_paise'):return 0
    paid_lines=paid.get('lines',[])
    if not paid_lines or any(type(x.get(k)) is not int or x[k]<0 for x in paid_lines for k in ('debit','credit')) or sum(x['debit']-x['credit'] for x in paid_lines):return 0
    if sum(x['debit']-x['credit'] for x in paid_lines if x.get('account')=='worker_payable')!=payout['amount_paise']:return 0
    if sum(x['credit']-x['debit'] for x in paid_lines if x.get('account')=='payment_clearing')!=payout['amount_paise'] or value<0:return 0
    return value

def install(core):
    r=APIRouter(prefix='/operations/admin',dependencies=[Depends(core.operator)])
    @r.get('/campaigns/{cid}/outcomes')
    def outcomes(cid:str,cursor:str=Query(default='',max_length=128)):
        def read(u):
            campaign=u.get('campaigns',cid)
            if not campaign:fail('NOT_FOUND','Campaign not found.',404)
            rows=u.find('campaign_redemptions','campaign_id',cid,limit=25,after=cursor)
            u.prefetch([(kind,row['id']) for row in rows for kind in ('jobs','payments','settlements')])
            totals=dict(reservations=len(rows),bookings=0,completed=0,cancelled=0,verified_payments=0,confirmed_refunds=0,complaint_cases=0,open_complaints=0,repeat_customers_in_page=0,captured_paise=0,processed_refund_paise=0,discount_reserved_paise=0,settled_company_allocation_paise=0)
            customers={};details=[];partial=False
            for redemption in rows:
                jid=redemption['id'];job=u.get('jobs',jid)
                totals['discount_reserved_paise']+=redemption.get('discount_paise',0)
                if not job:continue
                totals['bookings']+=1
                completed=job.get('state')=='completed';totals['completed']+=int(completed)
                totals['cancelled']+=int(job.get('state') in ('cancelled','expired','rejected'))
                payment=u.get('payments',jid) or {};settlement=u.get('settlements',jid) or {}
                captured=payment.get('status') in ('captured','partially_refunded','refunded') and bool(payment.get('payment_id'))
                totals['verified_payments']+=int(captured)
                totals['captured_paise']+=payment.get('amount_paise',0) if captured else 0
                refunds=u.find('refunds','job_id',jid,limit=21)
                cases=u.find('support_cases','job_id',jid,limit=21)
                partial=partial or len(refunds)>20 or len(cases)>20
                confirmed=[x for x in refunds[:20] if x.get('status')=='processed' and x.get('provider_id') and x.get('payment_kind','final')!='parts']
                totals['confirmed_refunds']+=len(confirmed);totals['processed_refund_paise']+=sum(x.get('amount_paise',0) for x in confirmed)
                complaints=[x for x in cases[:20] if x.get('category') in ('warranty','payment','penalty','safety','booking')]
                totals['complaint_cases']+=len(complaints);totals['open_complaints']+=sum(x.get('state')!='resolved' for x in complaints)
                if captured and completed:customers[job['customer_id']]=customers.get(job['customer_id'],0)+1
                totals['settled_company_allocation_paise']+=allocation(u,jid,job,payment,settlement,refunds)
                details.append(dict(id=jid,state=job.get('state'),payment_status=payment.get('status','not_confirmed'),confirmed_refund_paise=sum(x.get('amount_paise',0) for x in confirmed),complaints=len(complaints),discount_paise=redemption.get('discount_paise',0)))
            totals['repeat_customers_in_page']=sum(n>1 for n in customers.values())
            return dict(campaign={'id':cid,'title':campaign['title'],'budget_paise':campaign.get('budget_paise',0),'reserved_paise':campaign.get('reserved_paise',0),'impressions':campaign.get('impressions',0),'opens':campaign.get('opens',0)},totals=totals,items=details,next_cursor=rows[-1]['id'] if len(rows)==25 else None,related_records_truncated=partial,scope='This page covers up to 25 campaign reservations. Repeat customers are counted within this page only. Refunds and support cases are limited to 20 per booking.',financial_note='Captured amounts cover final-balance payments only, excluding separate parts advances; processed refunds cover service/final payments only. Settled company allocation excludes refunded or held bookings and is not net profit. Offer reservations are not sales; results do not prove that a recommendation caused a purchase.')
        return core.operations_store.run(read)
    core.app.include_router(r)
