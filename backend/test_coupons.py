import time,uuid
import pytest
import main,coupons
from test_operations import api,auth,book
from rentals import usage

def test_wallet_expiry_is_fixed_and_identity_bound(api,monkeypatch):
    clock=[2000000000.0];monkeypatch.setattr(coupons.time,'time',lambda:clock[0])
    first=api.get('/operations/coupons/wallet',headers=auth('customer')).json()['coupons']
    assert {c['code'] for c in first}=={'WELCOME20','RENT20'}
    clock[0]+=86400
    assert api.get('/operations/coupons/wallet',headers=auth('customer')).json()['coupons'][0]['expires_at']==first[0]['expires_at']
    clock[0]+=30*86400
    assert api.get('/operations/coupons/wallet',headers=auth('customer')).json()['coupons']==[]
    assert len(api.get('/operations/coupons/wallet',headers=auth('stranger')).json()['coupons'])==2
    assert api.get('/operations/coupons/wallet').status_code==401

def test_service_reservation_no_stacking_or_reuse(api):
    j,b=book(api,coupon_code='WELCOME20')
    assert j['vendor_discount_paise']==11980 and j['total_paise']==47920 and j['base_price_paise']==59900
    assert api.post('/operations/bookings',headers=auth('customer'),json=b).json()['id']==j['id']
    b['idempotency_key']=str(uuid.uuid4());assert api.post('/operations/bookings',headers=auth('customer'),json=b).status_code==409
    assert api.post('/operations/coupons/check',headers=auth('customer'),json={'code':'RENT20','scope':'service'}).status_code==409
    b.update(coupon_code='RENT20',promotion_id='fake');assert api.post('/operations/bookings',headers=auth('customer'),json=b).status_code==422

def test_return_choice_and_two_day_reminder(api,monkeypatch):
    main.operations_store.run(lambda u:u.put('jobs','done',dict(id='done',customer_id='customer',state='completed',payment_status='verified')))
    clock=[time.time()];monkeypatch.setattr(coupons.time,'time',lambda:clock[0])
    def launch():return api.post('/operations/coupons/launch',headers=auth('customer')).json()
    first=launch();assert first['show'] and {'AGAIN10','RENEW10'}<={c['code'] for c in first['coupons']}
    assert not launch()['show'];clock[0]+=2*86400;assert launch()['show']
    r=api.post('/operations/coupons/choose',headers=auth('customer'),json={'code':'RENEW10'});assert r.status_code==200
    assert api.post('/operations/coupons/choose',headers=auth('customer'),json={'code':'AGAIN10'}).status_code==409
    assert api.post('/operations/coupons/check',headers=auth('stranger'),json={'code':'RENEW10','scope':'refurbished'}).status_code==409

def test_actual_rental_discount_is_percentage_only_without_rupee_cap():
    r=dict(started_at=100,period='daily',rate_paise=11800,gst_bps=1800,delivery_fee_paise=500,coupon=dict(bps=2000,discount_paise=4000))
    assert usage(r,101)==(1,10300) # 20% of 10000 net; tax and delivery untouched.
    assert usage(r,100+3*86400)==(3,29900) # 20% of actual base; no separate rupee cap.

def test_vendor_discount_balances_without_taking_tax_or_parts(api):
    from integrations import settlement
    j=dict(id='settle',state='completed',payment_status='verified',worker_id='worker',base_price_paise=10000,total_paise=11300,vendor_discount_paise=2000,hire_gst_paise=1800,hire_travel_paise=500,visit_id='v',penalties=[],settlement_policy=dict(worker_share_bps=7500,bonus_reserve_bps=1000,penalty_cap_bps=10000,stack_penalties=False,penalty_mode='highest_single'))
    def run(u):u.put('jobs',j['id'],j);return settlement(u,j['id'])
    s=main.operations_store.run(run)
    assert s['net_paise']==6000 and s['company_base_commission_paise']==1500 and s['parts_payable_paise']==1000
    assert sum(s[k] for k in ['net_paise','company_base_commission_paise','bonus_reserve_paise','gst_payable_paise','parts_payable_paise'])==11300

def test_atomic_one_use_under_concurrent_reservations(api):
    from concurrent.futures import ThreadPoolExecutor
    def claim(n):
        try:return main.operations_store.run(lambda u:coupons.reserve(u,'customer','WELCOME20','service',10000,'test:'+str(n)))
        except Exception:return None
    with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(claim,range(2)))
    assert sum(r is not None for r in results)==1

def test_banner_interests_require_consent_and_clear_on_opt_out(api):
    assert api.post('/operations/opportunities/open',headers=auth('customer'),json={'category':'rentals'}).json()=={'saved':False}
    assert main.operations_store.run(lambda u:u.get('opportunity_interests','customer')) is None
    prefs=dict(consent_version=1,personalised=True,push=False,launch=True,daily_cap=3,city='Balasore')
    assert api.put('/operations/campaigns/preferences',headers=auth('customer'),json=prefs).status_code==200
    assert api.post('/operations/opportunities/open',headers=auth('customer'),json={'category':'rentals'}).json()['saved']
    assert api.get('/operations/opportunities/order',headers=auth('customer')).json()['ids'][0]=='rentals'
    prefs['personalised']=False;api.put('/operations/campaigns/preferences',headers=auth('customer'),json=prefs)
    assert main.operations_store.run(lambda u:u.get('opportunity_interests','customer'))['signals']=={}

def test_home_first_period_discount_preserves_tax_and_later_period(api):
    from test_home_plans import active
    from home_plans import make_job
    p=active(api,coupon_code='WELCOME20',duration='month3')
    first=next(v for v in p['visits'] if v['period']==0);later=next(v for v in p['visits'] if v['period']==1)
    def make(u):
        plan=u.get('home_plans',p['id']);make_job(u,plan,first,time.time());make_job(u,plan,later,time.time());return u.get('jobs',first['job_id']),u.get('jobs',later['job_id'])
    a,b=main.operations_store.run(make)
    assert a['vendor_discount_paise']==a['base_price_paise']*2000//10000
    assert a['total_paise']==a['base_price_paise']+a['home_gst_paise']-a['vendor_discount_paise']
    assert not b.get('vendor_discount_paise') and b['total_paise']==b['base_price_paise']+b['home_gst_paise']

def test_hire_coupon_excludes_travel_and_gst_and_survives_confirm_retry(api,monkeypatch):
    from test_hiring_records import setup_hire,request,decide,PIN
    policy=setup_hire(api,monkeypatch);h,_=request(api,policy,coupon_code='WELCOME20')
    r=decide(api,h,'accept',position={**PIN,'accuracy':5,'captured_at':time.time()});assert r.status_code==200,r.text;h=r.json()
    r=decide(api,h,'confirm','customer');assert r.status_code==200,r.text
    jid=r.json()['job_id'];j=api.get('/operations/jobs/'+jid,headers=auth('customer')).json()
    assert j['total_paise']==h['quote']['total_paise']-h['quote']['base_paise']*2000//10000
    assert j['hire_gst_paise']==h['quote']['gst_paise'] and j['hire_travel_paise']==h['quote']['travel_paise']
    assert decide(api,h,'confirm','customer').json()['job_id']==jid
