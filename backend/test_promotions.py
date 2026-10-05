"""Real HTTP/transactional checks with isolated data; no live sends or money."""
import time,uuid
from datetime import datetime
from zoneinfo import ZoneInfo
import main,promotions
from integrations import settlement
from test_operations import api,auth,ADMIN,book,onboard,command,PIN
POLICY=dict(version='promo-test',worker_share_bps=7500,bonus_reserve_bps=1000,penalty_cap_bps=10000,stack_penalties=False,penalty_mode='highest_single',base='worker_share_of_base_service_excluding_parts',reason='Test approved normal earnings split')
def campaign(api,cid='test-offer',**overrides):
    main.operations_store.run(lambda u:u.put('policies','current',POLICY))
    body=dict(version=0,title='AC care this week',body='Check the package and choose your visit.',service_id='ac-service',icon='wrench',tone='blue',placements=['home','explore','checkout','launch','push'],cities=['Balasore'],starts_at=time.time()-100,ends_at=time.time()+7*86400,active=True,audience='all',min_paid_spend_paise=0,discount_paise=2000,budget_paise=20000,per_user_limit=1,terms='INR 20 discount on AC service. Parts and extra work excluded. One booking per customer.')
    body.update(overrides);r=api.put('/operations/admin/campaigns/'+cid,headers=ADMIN,json=body);assert r.status_code==200,r.text;return r.json()
def prefs(api,**changes):
    body=dict(consent_version=1,personalised=True,push=True,launch=True,daily_cap=3,city='Balasore');body.update(changes)
    r=api.put('/operations/campaigns/preferences',headers=auth('customer'),json=body);assert r.status_code==200,r.text
    return r.json()
def feed(api,personal=False,**changes):return api.post('/operations/campaigns/feed'+('/personal' if personal else ''),headers=auth('customer') if personal else {},json={'city':'Balasore',**changes})

def test_campaign_roles_budget_and_fixed_price(api):
    c=campaign(api)
    assert api.get('/operations/admin/campaigns',headers=auth('customer')).status_code==403
    assert api.get('/operations/campaigns/preferences').status_code==401
    p=feed(api).json()['cards'][0];assert p['price_paise']==59900 and p['offer_price_paise']==57900
    assert not {'reserved_paise','_score','user_id','min_paid_spend_paise'}&p.keys()
    body={k:v for k,v in c.items() if k not in ('id','updated_at','reserved_paise','redemptions','opens','impressions')};body.update(discount_paise=10000)
    assert api.put('/operations/admin/campaigns/test-offer',headers=ADMIN,json=body).status_code==422
    body['version']=99;assert api.put('/operations/admin/campaigns/test-offer',headers=ADMIN,json=body).status_code==409
    assert feed(api,city='Outside').json()['cards']==[]

def test_discount_reservation_retry_limit_and_settlement(api):
    campaign(api,budget_paise=2000);onboard(api)
    def accept(u):
        w=u.get('workers','worker');w['settlement_policy_version']=POLICY['version'];u.put('workers','worker',w)
    main.operations_store.run(accept)
    j,body=book(api,promotion_id='test-offer');assert j['base_price_paise']==59900 and j['total_paise']==57900
    retry=api.post('/operations/bookings',headers=auth('customer'),json=body);assert retry.status_code==201 and retry.json()['id']==j['id']
    assert feed(api,True).json()['cards']==[]
    body['idempotency_key']=str(uuid.uuid4());assert api.post('/operations/bookings',headers=auth('customer'),json=body).status_code==409
    j=command(api,j,'accept');j=command(api,j,'ack_reminder');j=command(api,j,'depart');j=command(api,j,'position',payload={**PIN,'accuracy':5,'captured_at':time.time()});j=command(api,j,'start');j=command(api,j,'submit_completion',payload={'notes':'Test repair complete'});j=command(api,j,'accept_completion','customer')
    def finish(u):
        row=u.get('jobs',j['id']);row['payment_status']='verified';u.put('jobs',j['id'],row);return settlement(u,j['id'])
    s=main.operations_store.run(finish)
    assert s['gross_paise']==44925 and s['bonus_reserve_paise']==5990 and s['parts_payable_paise']==0
    assert s['company_base_commission_paise']==6985
    assert s['net_paise']+s['bonus_reserve_paise']+s['company_base_commission_paise']==57900
    receipt=api.get('/operations/jobs/'+j['id']+'/receipt',headers=auth('customer'));assert receipt.status_code==200 and receipt.json()['promotion_discount_paise']==2000

def test_consent_targeting_events_history(api):
    campaign(api,audience='returning',min_paid_spend_paise=50000)
    assert feed(api).json()['cards']==[] and feed(api,True).json()['cards']==[]
    main.operations_store.run(lambda u:u.put('jobs','past',dict(id='past',customer_id='customer',state='completed',payment_status='verified',category='plumber',completed_at=time.time()-30*86400,total_paise=70000)))
    prefs(api);assert len(feed(api,True).json()['cards'])==1 and feed(api).json()['cards']==[]
    body={'kind':'open','event_id':str(uuid.uuid4())}
    assert api.post('/operations/campaigns/test-offer/events',headers=auth('customer'),json=body).json()['recorded']
    assert not api.post('/operations/campaigns/test-offer/events',headers=auth('customer'),json=body).json()['recorded']
    api.post('/operations/campaigns/test-offer/events',headers=auth('customer'),json={**body,'kind':'dismiss'})
    assert feed(api,True).json()['cards']==[]
    prefs(api,personalised=False);assert feed(api,True).json()['cards']==[]

def test_india_schedule_max_three_retry_revoke_expiry(api,monkeypatch):
    clock=[datetime(2026,9,28,8,30,tzinfo=ZoneInfo('Asia/Kolkata')).timestamp()];monkeypatch.setattr(promotions.time,'time',lambda:clock[0])
    for i in range(3):campaign(api,'offer-'+str(i))
    prefs(api)
    device=api.post('/operations/devices',headers=auth('customer'),json={'token':'test-fixture-token-customer-only','platform':'android','audience':'customer','promotional_capable':True});assert device.status_code==200
    for hour in (8,14,20):
        clock[0]=datetime(2026,9,28,hour,30,tzinfo=ZoneInfo('Asia/Kolkata')).timestamp();assert main.promotions_tick()['queued']==1;assert main.promotions_tick()['queued']==0
    rows=main.operations_store.run(lambda u:u.all('notifications'));assert len(rows)==3
    n=max(rows,key=lambda n:n['created_at']);d=main.operations_store.run(lambda u:u.get('devices',device.json()['id']))
    assert main.operations_store.run(lambda u:promotions.delivery_allowed(u,n,d,clock[0]))
    cfg=api.get('/operations/admin/campaigns',headers=ADMIN).json()['controls']
    changed=api.put('/operations/admin/campaign-controls',headers=ADMIN,json={**cfg,'daily_cap':1}).json()
    assert not main.operations_store.run(lambda u:promotions.delivery_allowed(u,n,d,clock[0]))
    api.put('/operations/admin/campaign-controls',headers=ADMIN,json={**changed,'daily_cap':3})
    prefs(api,push=False);assert not main.operations_store.run(lambda u:promotions.delivery_allowed(u,n,d,clock[0]))
    clock[0]=datetime(2026,9,29,23,0,tzinfo=ZoneInfo('Asia/Kolkata')).timestamp();assert main.promotions_tick()['queued']==0
    prefs(api);assert not main.operations_store.run(lambda u:promotions.delivery_allowed(u,n,d,clock[0]))

def test_earnings_guard_pause_and_agent_exclusion(api,monkeypatch):
    campaign(api);prefs(api);book(api,promotion_id='test-offer');monkeypatch.setenv('REPAIDO_FINANCIAL_POLICY_APPROVED','true')
    assert api.post('/operations/admin/settlement-policy',headers=ADMIN,json={**POLICY,'version':'too-generous','worker_share_bps':9000}).status_code==409
    cfg=api.get('/operations/admin/campaigns',headers=ADMIN).json()['controls']
    assert api.put('/operations/admin/campaign-controls',headers=ADMIN,json={**cfg,'slots':[479,800,1200]}).status_code==422
    assert api.put('/operations/admin/campaign-controls',headers=ADMIN,json={**cfg,'enabled':False}).status_code==200
    assert feed(api).json()['cards']==[]
    assert api.put('/operations/admin/campaign-controls',headers=ADMIN,json=cfg).status_code==409
    n={'user_id':'customer','campaign_id':'test-offer','campaign_version':1,'expires_at':time.time()+1000}
    assert not main.operations_store.run(lambda u:promotions.delivery_allowed(u,n,{'audience':'agent'},time.time()))

def test_concurrent_budget_claim_is_atomic(api):
    from concurrent.futures import ThreadPoolExecutor
    campaign(api,budget_paise=2000)
    body=dict(service_id='ac-service',city='Balasore',address='Isolated customer test address',phone='9876543210',location=PIN,
              starts_at=datetime.fromtimestamp(time.time()+4000,ZoneInfo('UTC')).isoformat(),promotion_id='test-offer')
    def submit(uid):
        return api.post('/operations/bookings',headers=auth(uid),json={**body,'idempotency_key':str(uuid.uuid4())}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:statuses=list(pool.map(submit,['customer','stranger']))
    assert sorted(statuses)==[201,409]
    saved=main.operations_store.run(lambda u:u.get('campaigns','test-offer'))
    assert saved['reserved_paise']==2000 and saved['redemptions']==1

def test_personalised_ranking_and_launch_preference(api):
    campaign(api,'ac-offer',discount_paise=0)
    cleaning=next(s for s in main.catalog()['services'] if s['category']=='cleaning')
    campaign(api,'cleaning-offer',service_id=cleaning['id'],discount_paise=0)
    prefs(api)
    main.operations_store.run(lambda u:u.put('discovery_preferences','customer',dict(enabled=True,consent_version=2,signals={'cleaning':{'score':10,'at':time.time()}})))
    assert feed(api,True).json()['cards'][0]['id']=='cleaning-offer'
    main.operations_store.run(lambda u:u.put('discovery_preferences','customer',dict(enabled=True,consent_version=2,signals={'ac':{'score':10,'at':time.time()}})))
    assert feed(api,True).json()['cards'][0]['id']=='ac-offer'
    campaign(api,'welcome-only',placements=['launch'],discount_paise=0)
    assert next(c for c in feed(api,True).json()['cards'] if c['id']=='welcome-only')['launch_only']
    prefs(api,launch=False)
    assert 'welcome-only' not in [c['id'] for c in feed(api,True).json()['cards']]
    assert feed(api,True,placement='launch').json()['cards']==[]

def test_push_relay_rechecks_budget_and_sends_data_only_once(api,monkeypatch):
    from firebase_admin import messaging
    clock=[datetime(2026,9,28,8,30,tzinfo=ZoneInfo('Asia/Kolkata')).timestamp()]
    monkeypatch.setattr(promotions.time,'time',lambda:clock[0]);monkeypatch.setenv('REPAIDO_PUSH_ENABLED','true')
    sent=[];monkeypatch.setattr(messaging,'send',lambda message:sent.append(message) or 'test-only-message')
    campaign(api);prefs(api)
    api.post('/operations/devices',headers=auth('customer'),json={'token':'test-fixture-token-customer-only','platform':'android','audience':'customer','promotional_capable':True})
    assert main.promotions_tick()['queued']==1
    main.integrations_relay();main.integrations_relay()
    assert len(sent)==1 and sent[0].notification is None
    assert sent[0].data['campaign_id']=='test-offer' and sent[0].android.priority=='normal'
    assert sent[0].android.collapse_key=='repaido-promotion'
    # A separately scheduled offer that becomes exhausted must be skipped before sending.
    campaign(api,'later-offer',budget_paise=2000)
    clock[0]+=6*3600;assert main.promotions_tick()['queued']==1
    def exhaust(u):
        c=u.get('campaigns','later-offer');c['reserved_paise']=c['budget_paise'];u.put('campaigns',c['id'],c)
    main.operations_store.run(exhaust);main.integrations_relay()
    assert len(sent)==1
