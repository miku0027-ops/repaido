import main
from test_operations import api,auth,ADMIN

def test_campaign_report_distinguishes_reservations_verified_money_and_returns(api):
    def seed(u):
        u.put('campaigns','c',{'id':'c','title':'Fixture offer','budget_paise':10000,'reserved_paise':3000})
        for jid in ['a','b','c']:
            u.put('campaign_redemptions',jid,{'id':jid,'campaign_id':'c','discount_paise':1000})
            u.put('jobs',jid,{'id':jid,'customer_id':'customer','state':'completed' if jid!='c' else 'cancelled'})
            u.put('payments',jid,{'id':jid,'status':'captured' if jid!='c' else 'created','payment_id':'pay-'+jid if jid!='c' else None,'amount_paise':10000})
            u.put('settlements',jid,{'id':jid,'status':'paid','company_earnings_paise':1500})
        u.put('refunds','r',{'id':'r','job_id':'a','status':'processed','provider_id':'rf_fixture','amount_paise':10000})
        u.put('refunds','unknown',{'id':'unknown','job_id':'b','status':'submitting','amount_paise':3000})
        u.put('support_cases','s',{'id':'s','job_id':'b','customer_id':'customer','state':'open','category':'warranty'})
    main.operations_store.run(seed)
    assert api.get('/operations/admin/campaigns/c/outcomes',headers=auth('customer')).status_code in (401,403)
    result=api.get('/operations/admin/campaigns/c/outcomes',headers=ADMIN)
    assert result.status_code==200,result.text
    totals=result.json()['totals']
    assert totals['reservations']==3 and totals['completed']==2 and totals['cancelled']==1
    assert totals['verified_payments']==2 and totals['captured_paise']==20000
    assert totals['processed_refund_paise']==10000 and totals['confirmed_refunds']==1
    assert totals['settled_company_allocation_paise']==0 and totals['complaint_cases']==1
    assert 'customer_id' not in result.text

def test_paid_allocation_requires_matching_ledger_and_no_reversal(api):
    from campaign_outcomes import allocation
    def seed(u):
        u.put('payouts','j',{'id':'j','status':'processed','provider_id':'pout_fixture','amount_paise':8000})
        u.put('journals','j',{'id':'j','status':'posted','lines':[{'account':'payment_clearing','debit':10000,'credit':0},{'account':'company_commission','debit':0,'credit':2000},{'account':'worker_payable','debit':0,'credit':8000}]})
        u.put('journals','payout_j',{'id':'payout_j','status':'posted','lines':[{'account':'worker_payable','debit':8000,'credit':0},{'account':'payment_clearing','debit':0,'credit':8000}]})
    main.operations_store.run(seed)
    job={'state':'completed','payment_status':'verified'};payment={'status':'captured','payment_id':'pay_fixture'};settlement={'status':'paid','company_earnings_paise':2000,'net_paise':8000}
    assert main.operations_store.run(lambda u:allocation(u,'j',job,payment,settlement,[]))==2000
    assert main.operations_store.run(lambda u:allocation(u,'j',{**job,'parts_refund_hold':True},payment,settlement,[]))==0
    main.operations_store.run(lambda u:u.put('journals','reverse_j',{'id':'reverse_j','status':'posted'}))
    assert main.operations_store.run(lambda u:allocation(u,'j',job,payment,settlement,[]))==0
