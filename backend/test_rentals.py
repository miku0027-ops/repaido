"""Isolated HTTP lifecycles with a fake gateway; no real money or customer data."""
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
import pytest
import main
import rentals
from test_operations import api, auth, ADMIN, command
from test_procurement import setup_shop, visit, start, get

LISTING=dict(expected_version=0,name='Rotary drill kit',category='Power tools',description='Rotary drill with safety grip and three bits',condition='Inspected, fully working',instructions='Wear eye protection. Do not drill live circuits.',image_url='',total_units=2,daily_paise=10000,weekly_paise=50000,monthly_paise=150000,deposit_paise=100000,replacement_value_paise=200000,fulfillment='both',delivery_fee_paise=5000,delivery_area='Balasore city',active=True)

@pytest.fixture
def gateway(monkeypatch):
    for key in ('RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET'):monkeypatch.setenv(key,'test-only')
    monkeypatch.setenv('REPAIDO_PAYMENTS_ENABLED','true')
    orders={};payments={};refunds={};counts={'orders':0,'refunds':0}
    def provider(path,body=None,**kwargs):
        if path=='orders':
            counts['orders']+=1;oid='order_'+str(counts['orders']);orders[oid]={'id':oid,**body};return orders[oid]
        if path.startswith('orders?receipt='):return {'items':[o for o in orders.values() if o['receipt']==path.split('=',1)[1]]}
        if path.startswith('orders/') and path.endswith('/payments'):return {'items':[p for p in payments.values() if p['order_id']==path.split('/')[1]]}
        if path.startswith('payments/') and path.endswith('/refund'):
            counts['refunds']+=1;fid='rfnd_'+str(counts['refunds']);refunds[fid]={'id':fid,'payment_id':path.split('/')[1],'status':'processed',**body};return refunds[fid]
        if path.startswith('payments/') and '/refunds?' in path:return {'items':[r for r in refunds.values() if r['payment_id']==path.split('/')[1]]}
        if path.startswith('refunds/'):return refunds[path.split('/')[1]]
        if path.startswith('payments/'):return payments[path.split('/')[1]]
        raise AssertionError(path)
    monkeypatch.setattr(rentals,'razorpay',provider)
    return orders,payments,refunds,counts

def listing(api,**changes):
    setup_shop(api)
    response=api.put('/operations/shop/rental-inventory/drill',headers=auth('shop'),json={**LISTING,**changes})
    assert response.status_code==200,response.text
    return response.json()

def request(api,uid='customer',**changes):
    p=api.get('/operations/rentals/catalog').json()['items'][0]
    body=dict(listing_id=p['id'],listing_version=p['version'],period='daily',expected_periods=2,fulfillment='pickup',consent=True,request_id=str(uuid.uuid4()))
    body.update(changes)
    r=api.post('/operations/rentals',headers=auth(uid),json=body)
    assert r.status_code==201,r.text
    return r.json(),body

def latest(api,r,uid='customer'):
    return next(x for x in api.get('/operations/rentals',headers=auth(uid)).json()['rentals'] if x['id']==r['id'])

def act(api,r,action,uid='customer',status=200,**kwargs):
    r=latest(api,r,uid)
    response=api.post('/operations/rentals/'+r['id']+'/commands',headers=auth(uid),json=dict(expected_version=r['version'],command_id=str(uuid.uuid4()),action=action,**kwargs))
    assert response.status_code==status,response.text
    return response.json()

def pay(api,r,gateway,kind='deposit',uid='customer'):
    result=api.post('/operations/rentals/'+r['id']+'/payment-order?kind='+kind,headers=auth(uid))
    assert result.status_code==200,result.text
    order=result.json();orders,payments,refunds,counts=gateway
    pid='pay_'+str(len(payments)+1)
    payments[pid]=dict(id=pid,order_id=order['order_id'],currency='INR',amount=order['amount'],status='captured',captured=True,amount_refunded=0)
    response=api.post('/operations/rentals/'+r['id']+'/payment-check?kind='+kind,headers=auth(uid))
    assert response.status_code==200,response.text
    return latest(api,r,uid)

def handover(api,r,uid='customer'):
    response=api.get('/operations/rentals/'+r['id']+'/code?kind=handover',headers=auth(uid));assert response.status_code==200,response.text
    return act(api,r,'handover','shop',code=response.json()['code'],note='Good condition checked together')

def returned(api,r,uid='customer'):
    r=act(api,r,'request_return',uid,note='Returning in person')
    code=api.get('/operations/rentals/'+r['id']+'/code?kind=return',headers=auth(uid)).json()['code']
    return act(api,r,'receive_return','shop',code=code,note='Received at the counter')

@pytest.mark.parametrize('period,seconds,rate',[('daily',86400,10000),('weekly',604800,50000),('monthly',2592000,150000)])
def test_customer_end_to_end(api,gateway,period,seconds,rate):
    listing(api);r,body=request(api,period=period)
    duplicate=api.post('/operations/rentals',headers=auth('customer'),json=body)
    assert duplicate.status_code==201 and duplicate.json()['id']==r['id']
    r=act(api,r,'accept','shop');act(api,r,'handover','shop',status=409,code='123456')
    r=pay(api,r,gateway);r=handover(api,r);started=r['started_at']
    with patch('time.time',return_value=started+seconds+1):r=returned(api,r)
    assert r['final_usage_paise']==2*rate and r['billed_periods']==2
    frozen=r['accrued_paise']
    with patch('time.time',return_value=started+10*seconds):assert latest(api,r)['accrued_paise']==frozen
    r=act(api,r,'inspect','shop',note='No damage, all accessories present')
    r=pay(api,r,gateway,'usage')
    path='/operations/rentals/'+r['id']+'/refund-deposit'
    assert api.post(path,headers=auth('customer')).json()['status']=='processed'
    assert api.post(path,headers=auth('customer')).json()['status']=='processed'
    assert gateway[3]=={'orders':2,'refunds':1}
    assert api.get('/operations/rentals/catalog').json()['items'][0]['available_units']==2
    journals=main.operations_store.run(lambda u:u.all('journals'))
    assert all(sum(x['debit'] for x in j['lines'])==sum(x['credit'] for x in j['lines']) for j in journals)


def test_task_customer_approval_and_final_bill(api,gateway):
    listing(api);j=start(api,visit(api));base=j['total_paise'];r,_=request(api,'worker',job_id=j['id'])
    assert r['state']=='approval_pending'
    act(api,r,'accept','shop',status=409);act(api,r,'approve','worker',status=403)
    r=act(api,r,'approve');r=act(api,r,'accept','shop');r=pay(api,r,gateway,uid='worker');r=handover(api,r,'worker')
    command(api,get(api,j),'submit_completion',status=409,payload={'notes':'Cannot close with outstanding rental'})
    r=returned(api,r,'worker')
    updated=get(api,j);assert updated['total_paise']==base+10000 and updated['rental_total_paise']==10000
    assert r['usage_payment_status']=='on_task_invoice'
    assert api.post('/operations/rentals/'+r['id']+'/payment-order?kind=usage',headers=auth('worker')).status_code==409
    assert api.get('/operations/rentals?job_id='+j['id'],headers=auth('customer')).json()['rentals'][0]['id']==r['id']


def test_permissions_stock_versions_and_terms(api,gateway):
    listing(api,total_units=1)
    assert api.put('/operations/shop/rental-inventory/evil',headers=auth('customer'),json=LISTING).status_code==403
    r,_=request(api)
    assert api.get('/operations/rentals',headers=auth('stranger')).json()['rentals']==[]
    assert api.get('/operations/rentals/'+r['id']+'/code?kind=handover',headers=auth('shop')).status_code==403
    assert api.get('/operations/admin/rentals',headers=auth('customer')).status_code==403
    p=api.get('/operations/shop/rental-inventory',headers=auth('shop')).json()['items'][0]
    assert api.put('/operations/shop/rental-inventory/drill',headers=auth('shop'),json={**LISTING,'expected_version':p['version'],'total_units':0}).status_code==409
    assert api.put('/operations/shop/rental-inventory/drill',headers=auth('shop'),json={**LISTING,'expected_version':p['version'],'daily_paise':99900}).status_code==200
    assert latest(api,r)['rate_paise']==10000
    r=act(api,r,'cancel');assert r['state']=='cancelled'


def test_expiry_late_capture_and_disabled_provider(api,gateway,monkeypatch):
    listing(api);r,_=request(api);r=act(api,r,'accept','shop')
    monkeypatch.setenv('REPAIDO_PAYMENTS_ENABLED','false')
    assert api.post('/operations/rentals/'+r['id']+'/payment-order?kind=deposit',headers=auth('customer')).status_code==503
    assert gateway[3]['orders']==0
    monkeypatch.setenv('REPAIDO_PAYMENTS_ENABLED','true');r=pay(api,r,gateway)
    with patch('time.time',return_value=r['expires_at']+1):main.rentals_tick()
    r=latest(api,r);assert r['state']=='expired'
    act(api,r,'handover','shop',status=409,code='123456')
    assert api.post('/operations/rentals/'+r['id']+'/refund-deposit',headers=auth('customer')).json()['status']=='processed'


def test_damage_dispute_and_independent_resolution(api,gateway):
    listing(api);r,_=request(api);r=act(api,r,'accept','shop');r=pay(api,r,gateway);r=handover(api,r);r=returned(api,r)
    r=act(api,r,'inspect','shop',note='Cracked casing reported',damage_paise=120000)
    assert api.post('/operations/rentals/'+r['id']+'/refund-deposit',headers=auth('customer')).status_code==409
    r=act(api,r,'dispute',note='The casing was already cracked before collection')
    resolution=dict(expected_version=r['version'],damage_paise=10000,reason='Reviewed documented before and after condition',evidence_reference='test-private-evidence')
    assert api.post('/operations/admin/rentals/'+r['id']+'/resolve',headers=auth('shop'),json=resolution).status_code==403
    assert api.post('/operations/admin/rentals/'+r['id']+'/resolve',headers=ADMIN,json=resolution).status_code==200
    response=api.post('/operations/rentals/'+r['id']+'/refund-deposit',headers=auth('customer'));assert response.status_code==200,response.text
    assert response.json()['amount_paise']==90000
    p=api.get('/operations/rentals/catalog').json()['items'][0];assert p['available_units']==1
    act(api,r,'restock','shop',note='Repaired casing and safety-tested drill')
    assert api.get('/operations/rentals/catalog').json()['items'][0]['available_units']==2


def test_inventory_atomic_competition_and_command_retry(api,gateway):
    listing(api,total_units=1)
    p=api.get('/operations/rentals/catalog').json()['items'][0]
    def attempt(uid):
        return api.post('/operations/rentals',headers=auth(uid),json=dict(listing_id='drill',listing_version=p['version'],period='daily',expected_periods=1,fulfillment='pickup',consent=True,request_id=str(uuid.uuid4())))
    with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(attempt,['customer','stranger']))
    assert sorted(r.status_code for r in results)==[201,409]
    r=next(x.json() for x in results if x.status_code==201)
    body=dict(expected_version=r['version'],command_id=str(uuid.uuid4()),action='accept')
    first=api.post('/operations/rentals/'+r['id']+'/commands',headers=auth('shop'),json=body)
    second=api.post('/operations/rentals/'+r['id']+'/commands',headers=auth('shop'),json=body)
    assert first.status_code==second.status_code==200
    assert first.json()['version']==second.json()['version']


def test_payment_unknown_pending_and_retry_no_duplicate(api,gateway,monkeypatch):
    listing(api);r,_=request(api);r=act(api,r,'accept','shop');provider=rentals.razorpay
    def unknown(path,body=None,**kwargs):
        result=provider(path,body,**kwargs)
        if path=='orders':rentals.fail('UNKNOWN','Outcome unknown.',503)
        return result
    monkeypatch.setattr(rentals,'razorpay',unknown)
    url='/operations/rentals/'+r['id']
    assert api.post(url+'/payment-order?kind=deposit',headers=auth('customer')).status_code==503
    assert api.post(url+'/payment-order?kind=deposit',headers=auth('customer')).status_code==409
    assert gateway[3]['orders']==1
    assert api.post(url+'/payment-check?kind=deposit',headers=auth('customer')).status_code==200
    assert api.get(url+'/code?kind=handover',headers=auth('customer')).status_code==409
    monkeypatch.setattr(rentals,'razorpay',provider)
    pay(api,r,gateway)
    assert gateway[3]['orders']==1
    p=next(iter(gateway[1].values()))
    main.operations_store.run(lambda u:main.integrations_apply_payment(u,p))
    with pytest.raises(Exception):main.operations_store.run(lambda u:main.integrations_apply_payment(u,{**p,'amount':1}))


def test_delivery_private_and_return_code_lock(api,gateway):
    listing(api);r,_=request(api,fulfillment='delivery',delivery_address='Test apartment 12, test road')
    assert api.get('/operations/rentals/catalog').json()['items'][0].get('delivery_address') is None
    r=act(api,r,'accept','shop');r=pay(api,r,gateway);r=handover(api,r)
    code=api.get('/operations/rentals/'+r['id']+'/code?kind=return',headers=auth('customer')).json()['code']
    wrong='000000' if code!='000000' else '111111'
    for _ in range(5):act(api,r,'receive_return','shop',status=422,code=wrong)
    assert api.get('/operations/rentals/'+r['id']+'/code?kind=return',headers=auth('customer')).status_code==429
    assert latest(api,r)['accrued_paise']==15000


def test_verified_loss_and_replacement_balance(api,gateway):
    listing(api);r,_=request(api);r=act(api,r,'accept','shop');r=pay(api,r,gateway);r=handover(api,r)
    r=act(api,r,'dispute',note='Reported stolen equipment for independent review')
    data=dict(expected_version=r['version'],damage_paise=200000,reason='Test fixture loss established with evidence',evidence_reference='test-loss-evidence',custody='lost',ended_at=time.time())
    response=api.post('/operations/admin/rentals/'+r['id']+'/resolve',headers=ADMIN,json=data)
    assert response.status_code==200,response.text
    r=response.json();assert r['lost'] and r['damage_balance_paise']==100000
    assert api.get('/operations/rentals/catalog').json()['items'][0]['total_units']==1
    assert api.post('/operations/rentals/'+r['id']+'/refund-deposit',headers=auth('customer')).json()['status']=='not_due'
    r=pay(api,r,gateway,'damage');assert r['damage_payment_status']=='captured'


def test_standalone_rental_weekly_payout_does_not_include_deposit(api,gateway,monkeypatch):
    import shop_payouts
    listing(api);r,_=request(api);r=act(api,r,'accept','shop');r=pay(api,r,gateway);r=handover(api,r);r=returned(api,r);r=act(api,r,'inspect','shop',note='Undamaged with all accessories');r=pay(api,r,gateway,'usage')
    for key in ('REPAIDO_SHOP_PAYOUTS_ENABLED','REPAIDO_PAYOUTS_ENABLED'):monkeypatch.setenv(key,'true')
    for key in ('RAZORPAYX_KEY_ID','RAZORPAYX_KEY_SECRET','RAZORPAYX_ACCOUNT_NUMBER','RAZORPAYX_WEBHOOK_SECRET'):monkeypatch.setenv(key,'test-fixture')
    def seed(u):
        u.put('shop_banks','shop1',dict(id='shop1',shop_id='shop1',status='verified',fund_account_id='fa_test'))
        for p in u.all('shop_payables'):p['weekly_due_at']=time.time()-1;u.put('shop_payables',p['id'],p)
    main.operations_store.run(seed)
    calls=[]
    def provider(path,body=None,**kwargs):
        if path.startswith('payments/'):return gateway[1][path.split('/')[1]]
        calls.append(body);return {**body,'id':'pout_rental','status':'processed'}
    monkeypatch.setattr(shop_payouts,'razorpay',provider)
    main.shop_payouts_tick();main.shop_payouts_tick()
    assert len(calls)==1 and calls[0]['amount']==10000


def test_real_service_average_starts_with_actual_review(api):
    from test_operations import started
    j=started(api);j=command(api,j,'submit_completion',payload={'notes':'Verified completed service'});j=command(api,j,'accept_completion','customer');j=command(api,j,'review','customer',{'rating':3,'text':'Test verified review'})
    item=next(s for s in api.get('/catalog').json()['services'] if s['id']==j['service_id'])
    assert item['rating']==3 and item['review_count']==1
    command(api,j,'review','customer',{'rating':5},status=409)

def test_dispute_requires_custody_and_can_resume(api,gateway):
    listing(api);r,_=request(api)
    act(api,r,'dispute',status=409,note='Not collected; this must not hold a deposit')
    r=act(api,r,'accept','shop');r=pay(api,r,gateway);r=handover(api,r)
    r=act(api,r,'dispute',note='Please review this equipment concern')
    response=api.post('/operations/admin/rentals/'+r['id']+'/resolve',headers=ADMIN,json=dict(expected_version=r['version'],damage_paise=0,reason='Confirmed safe to continue with renter',evidence_reference='private-case-resume',custody='ongoing'))
    assert response.status_code==200,response.text
    assert response.json()['state']=='active' and not response.json()['financial_hold']
    r=returned(api,r);r=act(api,r,'inspect','shop',note='All accessories returned')
    assert api.post('/operations/rentals/'+r['id']+'/refund-deposit',headers=auth('customer')).status_code==200
    act(api,r,'dispute',status=409,note='Must use support after financial settlement')
