"""Real local HTTP/transaction regressions; no production accounts or payments."""
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
import pytest
import main
import captain_rewards as rewards
from captain_policy import OFFERS
from test_operations import api, auth, ADMIN, PIN
from test_local_business import register, doc, pickup_photo
from test_captain_rewards import grant

BASE='/operations/local-business'


def receipt_ready(api, customer='customer', collector='worker', legacy=False):
    if not main.operations_store.run(lambda u:__import__('local_business').partner_profile(u,collector,'scrap_owner')):
        register(api,collector,'scrap_owner')
    identifier=str(uuid.uuid4());photo=pickup_photo(customer,identifier);scale=doc(collector);now=time.time()
    row=dict(id=identifier,customer_id=customer,customer_name='Fixture seller',owner_id=collector,
             candidate_owner_ids=[collector],state='payment_reported',version=5,material='metal',
             description='Fixture dry household metal',estimated_kg=2,city='Balasore',address='PRIVATE PICKUP 123',
             phone='PRIVATE PHONE',location=PIN,created_at=now-1000,starts_at=now+3600,accepted_at=now-900,
             experience_version=1 if legacy else 2,travel_phase='arrived',photo_document_id=photo,agreed_paise=30000,
             payment_reference='PRIVATE PAYMENT REFERENCE',payment_source='buyer_reported',events=[],
             evaluation=dict(total_paise=30000,weighing_document_id=scale,scale_reference='Scale fixture',note='Inspected dry metal',
                             lines=[dict(material='metal',grade='Dry',gross_grams=2500,tare_grams=500,net_grams=2000,price_paise_per_kg=15000,amount_paise=30000)]))
    def seed(u):
        p=u.get('business_documents',photo);p['claimed_by']=identifier;u.put('business_documents',photo,p)
        p=u.get('business_documents',scale);p['weighing_collection_id']=identifier;u.put('business_documents',scale,p)
        u.put('scrap_collections',identifier,row)
    main.operations_store.run(seed)
    return row


def confirm(api,row):
    body=dict(action='received',expected_version=row['version'],command_id=str(uuid.uuid4()))
    result=api.post(BASE+'/scrap/'+row['id']+'/commands',headers=auth(row['customer_id']),json=body)
    assert result.status_code==200,result.text
    return result.json(),body


def funded_policy(api, enabled=('CAPTAINREPAIR30','CAPTAINHIRE20','CAPTAINRENT10'), budget=100000, cap=10000):
    body=dict(expected_version=0,monthly_budget_paise=budget,funding_reference='fixture-approved-repaido-budget',
              offers={code:dict(enabled=code in enabled,gold_cap_paise=cap,max_cap_paise=min(100000,cap*3//2)) for code in OFFERS})
    result=api.post(BASE+'/captain/admin/policy',headers=ADMIN,json=body)
    assert result.status_code==200,result.text
    return result.json(),body


def test_sale_points_only_follow_customer_receipt_and_both_accounts_get_one_award(api):
    row=receipt_ready(api)
    assert api.get(BASE+'/captain/me',headers=auth('customer')).json()['qualifying_points']==0
    denied=api.post(BASE+'/scrap/'+row['id']+'/commands',headers=auth('worker'),json=dict(action='received',expected_version=5,command_id=str(uuid.uuid4())))
    assert denied.status_code==409
    saved,body=confirm(api,row)
    assert saved['customer_points']==saved['collector_points']==10
    again=api.post(BASE+'/scrap/'+row['id']+'/commands',headers=auth('customer'),json=body)
    assert again.json()['customer_points']==10
    for uid in ['customer','worker']:
        summary=api.get(BASE+'/captain/me',headers=auth(uid)).json()
        assert summary['qualifying_points']==10 and summary['verified_scrap_collections']==1
        assert summary['profile']['city']=='Balasore'
        assert summary['awards'][0]['source']=='scrap'
    assert api.get(BASE+'/captain/me',headers=auth('customer')).json()['scrap_received_paise']==30000
    buyer=api.get(BASE+'/captain/me',headers=auth('worker')).json()
    assert buyer['scrap_paid_paise']==30000 and buyer['scrap_received_paise']==0
    assert len(main.operations_store.run(lambda u:u.all('cleanup_points')))==2


def test_split_sales_between_the_same_pair_do_not_multiply_points(api):
    first,_=confirm(api,receipt_ready(api));second,_=confirm(api,receipt_ready(api))
    assert first['customer_points']==10 and second['customer_points']==second['collector_points']==0
    assert 'already earned' in second['customer_points_note']
    assert api.get(BASE+'/captain/me',headers=auth('customer')).json()['qualifying_points']==10


def test_daily_limit_is_shared_with_cleanup_points_and_old_collections_still_complete(api):
    grant(points=50)
    saved,_=confirm(api,receipt_ready(api))
    assert saved['customer_points']==0 and saved['collector_points']==10
    assert saved['customer_points_note']=='Daily points limit reached'
    old,_=confirm(api,receipt_ready(api,legacy=True))
    assert old['state']=='completed' and old['rewards_status']=='not_eligible'
    assert main.operations_store.run(lambda u:len(u.all('cleanup_points')))==3


def test_scale_or_pickup_evidence_cannot_become_public_profile_photos(api):
    row=receipt_ready(api)
    for identifier in [row['photo_document_id'],row['evaluation']['weighing_document_id']]:
        owner='customer' if identifier==row['photo_document_id'] else 'worker'
        result=api.post(BASE+'/captain/profile',headers=auth(owner),json=dict(expected_version=0,name='Private evidence',photo_id=identifier,public=True))
        assert result.status_code==422 and result.json()['detail']['code']=='PRIVATE_EVIDENCE'


@pytest.mark.parametrize('points,level,next_points',[(0,'contributor',30),(29,'contributor',30),(30,'bronze',60),(60,'silver',100),(100,'gold',200),(200,'platinum',400),(400,'diamond',None)])
def test_levels_use_qualifying_points_not_retained_or_future_awards(points,level,next_points):
    now=10000000
    summary=rewards.totals([dict(points=points,created_at=now),dict(points=1000,created_at=now-90*86400),dict(points=1000,created_at=now+1)],now)
    assert summary['qualifying_points']==points and summary['level']['id']==level
    assert (summary['next_level'] or {}).get('points')==next_points
    assert summary['ranking_points']==points+300


def test_zero_point_receipts_do_not_inflate_ranking_days_or_tiebreaks():
    now=10000000
    summary=rewards.totals([dict(points=10,created_at=now),dict(points=0,created_at=now-86400)],now)
    assert summary['verified_contributions']==2
    assert summary['scored_contributions']==summary['active_days']==1


def test_policy_requires_operator_explicit_funding_and_valid_caps(api):
    _,body=funded_policy(api)
    assert api.get(BASE+'/captain/admin/policy',headers=auth('customer')).status_code==403
    assert api.post(BASE+'/captain/admin/policy',headers=auth('customer'),json=body).status_code==403
    assert api.post(BASE+'/captain/admin/policy',headers=ADMIN,json=body).status_code==200  # identical retry
    changed={**body,'monthly_budget_paise':body['monthly_budget_paise']+1}
    assert api.post(BASE+'/captain/admin/policy',headers=ADMIN,json=changed).status_code==409
    changed={**body,'expected_version':1,'funding_reference':''}
    assert api.post(BASE+'/captain/admin/policy',headers=ADMIN,json=changed).status_code==422
    changed={**body,'expected_version':1,'offers':{**body['offers'],'CAPTAINREFURB25':dict(enabled=True,gold_cap_paise=100000,max_cap_paise=100001)}}
    assert api.post(BASE+'/captain/admin/policy',headers=ADMIN,json=changed).status_code==422


def test_earned_rewards_appear_in_checkout_and_level_cap_is_applied(api):
    funded_policy(api);grant(points=200)
    wallet=api.get('/operations/coupons/wallet',headers=auth('customer')).json()['coupons']
    earned=next(x for x in wallet if x['code']=='CAPTAINREPAIR30')
    assert earned['family']=='captain' and earned['level']=='Platinum' and earned['cap_paise']==12500
    check=api.post('/operations/coupons/check',headers=auth('customer'),json=dict(code='CAPTAINREPAIR30',scope='service'))
    assert check.status_code==200 and check.json()['cap_paise']==12500
    assert api.post('/operations/coupons/check',headers=auth('stranger'),json=dict(code='CAPTAINREPAIR30',scope='service')).status_code==409
    assert api.post('/operations/coupons/check',headers=auth('customer'),json=dict(code='CAPTAINREPAIR30',scope='hire')).status_code==409


def test_budget_race_and_replay_do_not_spend_the_same_money_twice(api):
    funded_policy(api,enabled=('CAPTAINREPAIR30',),budget=10000,cap=10000)
    grant('customer');grant('stranger')
    def redeem(uid):
        try:return main.operations_store.run(lambda u:rewards.reserve(u,uid,'CAPTAINREPAIR30','service',100000,'job:'+uid))
        except Exception:return None
    with ThreadPoolExecutor(2) as pool:values=list(pool.map(redeem,['customer','stranger']))
    assert sum(x is not None for x in values)==1
    winner='customer' if values[0] else 'stranger'
    assert redeem(winner)==next(x for x in values if x)
    from captain_policy import month
    assert main.operations_store.run(lambda u:u.get('captain_budget',month(time.time())))['reserved_paise']==10000
    assert main.operations_store.run(lambda u:len(u.all('captain_reward_ledger')))==1


def test_captain_hire_quote_is_discounted_once_and_preserves_tax_and_professional_pay(api,monkeypatch):
    from test_hiring_records import setup_hire,request,decide
    policy=setup_hire(api,monkeypatch);funded_policy(api);grant()
    h,_=request(api,policy,coupon_code='CAPTAINHIRE20')
    response=decide(api,h,'accept',position={**PIN,'accuracy':5,'captured_at':time.time()});assert response.status_code==200,response.text;h=response.json()
    assert h['quote']['coupon']['funded_by']=='repaido'
    assert h['quote']['total_paise']==h['quote']['base_paise']+h['quote']['travel_paise']+h['quote']['gst_paise']-9980
    response=decide(api,h,'confirm','customer');assert response.status_code==200,response.text
    job=main.operations_store.run(lambda u:u.get('jobs',response.json()['job_id']))
    assert job['total_paise']==h['quote']['total_paise'] and job['community_reward_paise']==9980
    assert job.get('vendor_discount_paise',0)==0
    assert decide(api,h,'confirm','customer').json()['job_id']==job['id']


def test_company_reward_settlement_keeps_worker_share_and_parts_allocation(api,monkeypatch):
    from test_integrations import completed
    from coupons import attach_job
    from integrations import settlement
    job=completed(api)
    def seed(u):
        saved=u.get('jobs',job['id'])
        attach_job(saved,dict(code='CAPTAINREPAIR30',funded_by='repaido',discount_paise=10000,bps=3000))
        saved.update(state='completed',payment_status='verified',settlement_policy=dict(worker_share_bps=7500,bonus_reserve_bps=1000,penalty_cap_bps=10000,stack_penalties=False))
        u.put('jobs',saved['id'],saved)
        return settlement(u,saved['id'])
    allocation=main.operations_store.run(seed)
    assert allocation['net_paise']==job['base_price_paise']*7500//10000
    assert allocation['community_reward_paise']==10000 and allocation['vendor_discount_paise']==0
    assert allocation['parts_payable_paise']==0
    for key in ('RAZORPAYX_KEY_ID','RAZORPAYX_KEY_SECRET','RAZORPAYX_ACCOUNT_NUMBER'):
        monkeypatch.setenv(key,'fixture-only')
    monkeypatch.setenv('REPAIDO_PAYOUTS_ENABLED','true')
    result=dict(id='pout_reward_fixture',reference_id=job['id'],amount=allocation['net_paise'],fund_account_id='fa_test',currency='INR',status='processed')
    monkeypatch.setattr('integrations.razorpay',lambda *args,**kwargs:result)
    response=api.post('/operations/admin/settlements/'+job['id']+'/release',headers=ADMIN,json=dict(expected_net_paise=allocation['net_paise'],reason='Fixture approved company-funded reward payout'))
    assert response.status_code==200,response.text
    journal=main.operations_store.run(lambda u:u.get('journals',job['id']))
    assert sum(line['debit']-line['credit'] for line in journal['lines'])==0
    assert next(line['credit'] for line in journal['lines'] if line['account']=='worker_payable')==allocation['net_paise']
    assert next(line['debit'] for line in journal['lines'] if line['account']=='community_reward_expense')==10000


def test_rental_reward_never_exceeds_reserved_cap_and_supplier_gets_subsidy(api):
    from rentals import usage,apply_payment
    now=time.time();row=dict(id='reward-rental',customer_id='customer',shop_id='fixture-shop',rate_paise=10000,period='daily',started_at=now-10*86400,returned_at=now,delivery_fee_paise=5000,gst_bps=0,billed_periods=10,coupon=dict(bps=1000,cap_paise=1500,discount_paise=1000,funded_by='repaido'))
    units,total=usage(row,now)
    assert units==10 and total==104000
    payment=dict(id='rental-usage',rental_id=row['id'],kind='usage',order_id='order_fixture',amount_paise=total,status='created')
    def pay(u):
        u.put('rentals',row['id'],row);u.put('rental_payments',payment['id'],payment)
        apply_payment(u,dict(id='pay_fixture',order_id='order_fixture',currency='INR',amount=total,status='captured',captured=True))
        return u.get('shop_payables','rental-'+payment['id']),u.get('journals','rental-capture-'+payment['id'])
    payable,journal=main.operations_store.run(pay)
    assert payable['amount_paise']==105000
    assert sum(x['debit']-x['credit'] for x in journal['lines'])==0
    assert any(x['account']=='community_reward_expense' and x['debit']==1000 for x in journal['lines'])


def test_coupon_wallet_uses_account_queries_instead_of_whole_collection_scans(api,monkeypatch):
    from operations import Unit
    original=Unit.all
    def bounded(u,kind,*args,**kwargs):
        assert kind not in ('jobs','rentals','rental_payments','retail_orders','hires','home_plans','scrap_collections','cleanup_points')
        return original(u,kind,*args,**kwargs)
    monkeypatch.setattr(Unit,'all',bounded)
    assert api.get('/operations/coupons/wallet',headers=auth('customer')).status_code==200
    assert api.get(BASE+'/captain/me',headers=auth('customer')).status_code==200
