import time
from unittest.mock import patch
import pytest
import main,shop_payouts
from test_operations import api,auth,ADMIN
from test_procurement import setup_shop

def payment():return dict(id='pay_test',order_id='order_test',amount=7000,currency='INR',status='captured',captured=True)

def eligible_fixture(api,monkeypatch):
    setup_shop(api)
    for key in ('REPAIDO_SHOP_PAYOUTS_ENABLED','REPAIDO_PAYOUTS_ENABLED'):monkeypatch.setenv(key,'true')
    for key in ('RAZORPAYX_KEY_ID','RAZORPAYX_KEY_SECRET','RAZORPAYX_ACCOUNT_NUMBER','RAZORPAYX_WEBHOOK_SECRET'):monkeypatch.setenv(key,'test-fixture')
    def seed(u):
        u.put('shop_banks','shop1',dict(id='shop1',shop_id='shop1',status='verified',fund_account_id='fa_test',last4='1234'))
        u.put('jobs','job1',dict(id='job1',state='completed',payment_status='verified',total_paise=7000))
        u.put('payments','job1',dict(id='job1',job_id='job1',status='captured',amount_paise=7000,payment_id='pay_test',order_id='order_test'))
        u.put('shop_payables','order1',dict(id='order1',job_id='job1',shop_id='shop1',amount_paise=5000,weekly_due_at=time.time()-86400,status='eligible_for_weekly_review'))
        u.put('journals','job1',dict(id='job1',status='posted',lines=[{'account':'payment_clearing','debit':7000,'credit':0},{'account':'parts_payable','debit':0,'credit':5000},{'account':'worker_payable','debit':0,'credit':2000}]))
    main.operations_store.run(seed)

def test_weekly_once_and_provider_verified_journal(api,monkeypatch):
    eligible_fixture(api,monkeypatch);calls=[]
    def provider(path,body=None,**kwargs):
        if path.startswith('payments/'):return payment()
        calls.append(path);return {**body,'id':'pout_test','status':'processed'}
    monkeypatch.setattr(shop_payouts,'razorpay',provider)
    main.shop_payouts_tick();main.shop_payouts_tick()
    assert calls==['payouts']
    batch=api.get('/operations/admin/shop-payouts',headers=ADMIN).json()['batches'][0];assert batch['status']=='processed'
    main.shop_payouts_apply(dict(id='pout_test',reference_id=batch['id'],amount=5000,currency='INR',fund_account_id='fa_test',status='processed'))
    rows=main.operations_store.run(lambda u:u.all('journals'));assert len([r for r in rows if r['id'].startswith('shop-payout-')])==1
    for r in rows:assert sum(l['debit']-l['credit'] for l in r['lines'])==0
    assert api.get('/operations/admin/shop-payouts',headers=auth('shop')).status_code==403

def test_unknown_transfer_never_blindly_resubmitted(api,monkeypatch):
    eligible_fixture(api,monkeypatch);calls=[]
    def uncertain(*a,**k):
        if a[0].startswith('payments/'):return payment()
        calls.append(a);raise TimeoutError()
    monkeypatch.setattr(shop_payouts,'razorpay',uncertain)
    main.shop_payouts_tick();main.shop_payouts_tick();assert len(calls)==1
    batch=api.get('/operations/admin/shop-payouts',headers=ADMIN).json()['batches'][0];assert batch['status']=='submitting'
    monkeypatch.setattr(shop_payouts,'razorpay',lambda *a,**k:dict(id='pout_test',reference_id=batch['id'],amount=5000,currency='INR',fund_account_id='fa_test',status='processed'))
    assert api.post(f"/operations/admin/shop-payouts/{batch['id']}/reconcile",headers=ADMIN,json={'provider_id':'pout_test'}).status_code==200
    main.shop_payouts_tick();assert len(main.operations_store.run(lambda u:u.all('shop_batches')))==1

def test_paid_customer_not_enough_without_allocation_and_bank(api,monkeypatch):
    eligible_fixture(api,monkeypatch)
    def hold(u):
        j=u.get('jobs','job1');j['financial_hold']=True;u.put('jobs','job1',j)
    main.operations_store.run(hold);main.shop_payouts_tick();assert not main.operations_store.run(lambda u:u.all('shop_batches'))
    monkeypatch.setenv('REPAIDO_SHOP_PAYOUTS_ENABLED','false');assert main.shop_payouts_tick()['status']=='provider_disabled'

def test_shop_bank_provider_reference_and_account_holder(api,monkeypatch):
    setup_shop(api)
    def provider(path,**kwargs):
        if path.startswith('contacts/'):return {'reference_id':'shop1'}
        return {'status':'completed','fund_account':{'id':'fa_shop','contact_id':'cont_shop','bank_account':{'account_number':'1234567890'}},'validation_results':{'account_status':'active','registered_name':'Test verified parts shop'}}
    monkeypatch.setattr(shop_payouts,'razorpay',provider)
    body={'validation_id':'fav_test','reason':'Approved shop bank check after provider review'}
    assert api.post('/operations/admin/shops/shop1/bank',headers=auth('shop'),json=body).status_code==403
    assert api.post('/operations/admin/shops/shop1/bank',headers=ADMIN,json=body).status_code==200
    monkeypatch.setattr(shop_payouts,'razorpay',lambda *a,**k:{'status':'pending'})
    assert api.post('/operations/admin/shops/shop1/bank',headers=ADMIN,json=body).status_code==409

def test_final_provider_refund_blocks_weekly_transfer(api,monkeypatch):
    eligible_fixture(api,monkeypatch);calls=[]
    def provider(path,body=None,**kwargs):
        calls.append(path);return {**payment(),'status':'refunded','amount_refunded':7000}
    monkeypatch.setattr(shop_payouts,'razorpay',provider);main.shop_payouts_tick()
    assert calls==['payments/pay_test']
    assert main.operations_store.run(lambda u:u.get('jobs','job1'))['payment_status']=='refunded'
    assert not any(b.get('provider_id') for b in main.operations_store.run(lambda u:u.all('shop_batches')))
