"""Recurring domain/HTTP tests, isolated SQLite and stubbed external providers only."""
import time, uuid
from datetime import datetime,timedelta,date
from concurrent.futures import ThreadPoolExecutor
import pytest
from fastapi import HTTPException
import main,home_plans,promotions,integrations
from test_operations import api,auth,ADMIN,onboard,PIN
from test_promotions import POLICY,campaign,feed

def command(api,j,action,uid='worker',payload=None,status=200):
    r=api.post('/operations/jobs/'+j['id']+'/commands',headers=auth(uid),json={'action':action,'expected_version':j['version'],'command_id':str(uuid.uuid4()),'payload':payload or {}})
    assert r.status_code==status,r.text
    return r.json()

def setup_worker(api):
    onboard(api)
    main.operations_store.run(lambda u:u.put('policies','current',POLICY))
    def accept(u):
        w=u.get('workers','worker');w['settlement_policy_version']=POLICY['version'];u.put('workers','worker',w)
    main.operations_store.run(accept)
    body=dict(version=0,services=['maid','caretaker','renovation'],weekdays=list(range(7)),start_time='00:00',end_time='23:59',off_dates=[],experience='Test-only home care and cleaning training reviewed.')
    r=api.put('/operations/home/worker-availability',headers=auth('worker'),json=body);assert r.status_code==200,r.text
    r=api.post('/operations/admin/home/workers/worker/review',headers=ADMIN,json=dict(expected_version=1,approved_services=body['services'],reason='Test-only identity and relevant training evidence checked.'));assert r.status_code==200,r.text

def request(api,**changes):
    body=dict(service_id='maid',duration='trial7',start_date=(home_plans.iso_today()+timedelta(days=1)).isoformat(),time='09:00',minutes=60,weekdays=list(range(7)),off_dates=[],city='Balasore',address='Private recipient address, test 123',location=PIN,phone='9876543210',recipient_name='Recipient',relationship='parent',consent=True,instructions='Clean agreed household surfaces and use agreed hygiene supplies.',request_id=str(uuid.uuid4()))
    body.update(changes);body.setdefault('requirements_version',__import__('home_briefs').VERSION);body.setdefault('requirements',{f['id']:(f['options'][0] if f.get('options') else 'Detailed test customer requirements') for f in __import__('home_briefs').SCHEMAS[body['service_id']]});r=api.post('/operations/home/plans',headers=auth('customer'),json=body);assert r.status_code==201,r.text;return r.json(),body

def quote(api,p,**changes):
    body=dict(expected_version=p['version'],worker_id='worker',period_price_paise=70000,gst_bps=1800,checklist=['Agreed cleaning tasks','Supplies and surfaces checked'],exclusions='No nursing, medicines or heavy lifting.',terms='Test-only agreed scope. No charge for unserved visits. Future cancellation is free before work begins.');body.update(changes)
    r=api.post('/operations/admin/home/plans/'+p['id']+'/quote',headers=ADMIN,json=body);assert r.status_code==200,r.text;return r.json()

def decision(api,p,action,uid='customer',**extra):
    r=api.post('/operations/home/plans/'+p['id']+'/decision',headers=auth(uid),json=dict(expected_version=p['version'],action=action,**extra));assert r.status_code==200,r.text;return r.json()

def active(api,**kwargs):
    setup_worker(api);p,_=request(api,**kwargs);p=quote(api,p);p=decision(api,p,'accept');p=decision(api,p,'accept','worker');assert p['state']=='active';return p

def view(api,uid='customer'):return api.get('/operations/home/plans',headers=auth(uid)).json()['plans']

def test_calendar_month_boundaries_and_slots(api):
    p,body=request(api,duration='month6',start_date=(home_plans.iso_today()+timedelta(days=3)).isoformat(),weekdays=[0,2,4])
    assert len(p['periods'])==6 and len({v['date'] for v in p['visits']})==len(p['visits'])
    assert all(home_plans.day(v['date']).weekday() in (0,2,4) for v in p['visits'])
    assert home_plans.add_months(date(2028,1,31),1)==date(2028,2,29)
    assert home_plans.add_months(date(2028,1,31),2)==date(2028,3,31)
    for change in ({'city':'Outside'},{'consent':False},{'weekdays':[7]},{'time':'23:50'},{'duration':'project'}):
        assert api.post('/operations/home/plans',headers=auth('customer'),json={**body,**change,'request_id':str(uuid.uuid4())}).status_code==422
    assert api.get('/operations/admin/home',headers=auth('worker')).status_code==403
    assert view(api,'stranger')==[]

def test_retry_concurrent_accept_and_privacy(api):
    setup_worker(api);p,b=request(api)
    with ThreadPoolExecutor(max_workers=3) as pool:res=list(pool.map(lambda _:api.post('/operations/home/plans',headers=auth('customer'),json=b),range(3)))
    assert all(r.status_code==201 and r.json()['id']==p['id'] for r in res)
    assert api.post('/operations/home/plans',headers=auth('customer'),json={**b,'minutes':90}).status_code==409
    p=quote(api,p);worker=view(api,'worker')[0];assert not {'phone','address','location','recipient_name'}&worker.keys()
    assert api.post('/operations/home/plans/'+p['id']+'/decision',headers=auth('stranger'),json={'expected_version':p['version'],'action':'accept'}).status_code==404
    p=decision(api,p,'accept');p=decision(api,p,'accept','worker')
    assert api.post('/operations/home/plans/'+p['id']+'/decision',headers=auth('customer'),json={'expected_version':1,'action':'cancel','reason':'Changed plans'}).status_code==409
    assert 'location' in view(api)[0]

def test_candidate_radius_training_overlap_and_quote_lock(api):
    setup_worker(api);p,_=request(api)
    def move(u):
        w=u.get('workers','worker');w['location']={'lat':24,'lng':88};u.put('workers','worker',w)
    main.operations_store.run(move)
    assert api.get('/operations/admin/home',headers=ADMIN).json()['candidates'][p['id']]==[]
    def back(u):
        w=u.get('workers','worker');w['location']=PIN;u.put('workers','worker',w)
    main.operations_store.run(back);p=quote(api,p);p=decision(api,p,'accept');p=decision(api,p,'accept','worker')
    q,_=request(api);assert api.get('/operations/admin/home',headers=ADMIN).json()['candidates'][q['id']]==[]
    a=api.get('/operations/home/worker-availability',headers=auth('worker')).json()['availability']
    body={k:a[k] for k in ('version','services','weekdays','start_time','end_time','experience','off_dates')};body['off_dates']=[p['visits'][0]['date']]
    assert api.put('/operations/home/worker-availability',headers=auth('worker'),json=body).status_code==409

def test_day_changes_need_other_party_preserve_price_and_pause(api):
    p=active(api);v=p['visits'][0];base=v['base_paise'];url='/operations/home/plans/'+p['id']
    b=dict(expected_version=p['version'],visit_id=v['id'],new_date=v['date'],new_time='12:00',reason='Agreed alternative time requested')
    r=api.post(url+'/changes',headers=auth('worker'),json=b);assert r.status_code==200,r.text;p=r.json();c=p['changes'][0]
    assert api.post(url+'/changes/'+c['id'],headers=auth('worker'),json={'expected_version':p['version'],'accept':True}).status_code==409
    r=api.post(url+'/changes/'+c['id'],headers=auth('customer'),json={'expected_version':p['version'],'accept':True});assert r.status_code==200,r.text;p=r.json();assert p['visits'][0]['time']=='12:00' and p['visits'][0]['base_paise']==base
    p=decision(api,p,'pause',reason='Away for a short trip');assert p['state']=='paused'
    p=decision(api,p,'resume');assert p['state']=='active'
    p=decision(api,p,'cancel',reason='No longer need future visits');assert p['state']=='cancelled'

def test_complete_visit_monthly_capture_and_no_duplicate_charge(api,monkeypatch):
    p=active(api);v=p['visits'][0];clock=[v['starts_epoch']-3600]
    monkeypatch.setattr(home_plans.time,'time',lambda:clock[0]);monkeypatch.setattr(home_plans,'iso_today',lambda:datetime.fromtimestamp(clock[0],home_plans.IST).date())
    assert main.home_plans_tick()['visits_created']==1
    assert main.home_plans_tick()['visits_created']==0
    p=view(api)[0];jid=p['visits'][0]['job_id'];url='/operations/jobs/'+jid
    j=api.get(url,headers=auth('worker')).json();assert 'phone' not in j
    j=command(api,j,'ack_reminder');j=command(api,j,'depart');clock[0]=v['starts_epoch'];j=command(api,j,'position',payload={**PIN,'accuracy':5,'captured_at':clock[0]})
    code=api.get(url+'/arrival-code',headers=auth('customer')).json()['code'];assert api.post(url+'/verify-arrival',headers=auth('worker'),json={'code':code}).status_code==200
    j=api.get(url,headers=auth('worker')).json()
    command(api,j,'start',status=409)
    def log(checked):
        nonlocal j
        r=api.post('/operations/home/jobs/'+jid+'/log',headers=auth('worker'),json={'expected_version':j['version'],'hygiene':True,'checked':checked,'note':'Agreed checks recorded without personal health details.'});assert r.status_code==200,r.text;j=api.get(url,headers=auth('worker')).json()
    log([]);j=command(api,j,'start');command(api,j,'submit_completion',payload={'notes':'Done'},status=409)
    log([0,1]);j=command(api,j,'submit_completion',payload={'notes':'Household service completed and checked.'});j=command(api,j,'accept_completion','customer');assert j['state']=='completed'
    j=command(api,j,'review','customer',{'rating':4,'text':'Good visit and clear daily report.'})
    assert not j['penalties']
    clock[0]=home_plans.epoch(p['periods'][0]['end'],'23:59')+120
    main.home_plans_tick();p=view(api)[0];inv=p['invoices'][0];assert inv['status']=='ready' and inv['total_paise']==11800 and len(inv['rows'])==1
    monkeypatch.setenv('REPAIDO_PAYMENTS_ENABLED','true');monkeypatch.setenv('RAZORPAY_KEY_ID','test_key');monkeypatch.setenv('RAZORPAY_KEY_SECRET','test-secret');monkeypatch.setenv('RAZORPAY_WEBHOOK_SECRET','test-webhook')
    calls=[]
    def provider(path,body=None):calls.append((path,body));return {'id':'order_home_test'}
    monkeypatch.setattr(home_plans,'razorpay',provider)
    orderurl='/operations/home/plans/'+p['id']+'/invoices/0/order'
    with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda _:api.post(orderurl,headers=auth('customer')),range(2)))
    assert len(calls)==1 and any(r.status_code==200 for r in results)
    assert api.post(url+'/payment-order',headers=auth('customer')).status_code==409
    payment=dict(id='pay_home_test',order_id='order_home_test',currency='INR',amount=11800,status='failed',captured=False)
    assert main.operations_store.run(lambda u:integrations.apply_payment(u,payment))['status']=='created'
    payment.update(status='captured',captured=True)
    for _ in range(2):assert main.operations_store.run(lambda u:integrations.apply_payment(u,payment))['status']=='captured'
    settled=main.operations_store.run(lambda u:integrations.settlement(u,jid));assert settled['net_paise']==7500 and settled['gst_payable_paise']==1800 and settled['parts_payable_paise']==0
    assert api.post(orderurl,headers=auth('customer')).status_code==409
    payment['amount_refunded']=1000;main.operations_store.run(lambda u:integrations.apply_payment(u,payment))
    j=api.get(url,headers=auth('customer')).json();assert j['financial_hold'] and j['payment_status']=='refund_review'
    assert main.operations_store.run(lambda u:u.get('settlements',jid))['invalidated']
    with pytest.raises(HTTPException) as held:main.operations_store.run(lambda u:integrations.settlement(u,jid))
    assert held.value.detail['code']=='SETTLEMENT_HELD'

def test_missing_gateway_and_concern_resolution(api):
    p=active(api);url='/operations/home/plans/'+p['id']
    assert api.post(url+'/invoices/0/order',headers=auth('customer')).status_code==503
    r=api.post(url+'/issues',headers=auth('customer'),json={'reason':'Please confirm safe access instructions with the professional.'});assert r.status_code==200
    iid=r.json()['id'];assert api.post('/operations/admin/home/issues/'+iid+'/resolve',headers=auth('worker'),json={'response':'An unauthorised reply'}).status_code==403
    assert api.post('/operations/admin/home/issues/'+iid+'/resolve',headers=ADMIN,json={'response':'Contacted both parties and confirmed the agreed entrance and service scope.'}).status_code==200
    assert view(api)[0]['issues'][0]['status']=='resolved'

def test_event_campaign_home_target_and_image_guards(api):
    c=campaign(api,service_id='home:renovation',discount_paise=0,event_name='Durga Puja',layout='editorial',tone='festive')
    card=feed(api).json()['cards'][0];assert card['home_service']=='renovation' and card['event_name']=='Durga Puja' and card['offer_price_paise']==0
    body={k:v for k,v in c.items() if k not in ('id','updated_at','reserved_paise','redemptions','opens','impressions')};body.update(image_id=str(uuid.uuid4()),image_alt='A welcoming home')
    assert api.put('/operations/admin/campaigns/'+c['id'],headers=ADMIN,json=body).status_code==422
    body.update(image_id='',image_alt='',discount_paise=1000)
    assert api.put('/operations/admin/campaigns/'+c['id'],headers=ADMIN,json=body).status_code==422
    assert api.post('/operations/admin/campaign-media',headers=auth('customer'),content=b'bad').status_code==403
    assert api.get('/operations/campaign-media/not-published').status_code==404

def test_home_discovery_preserves_consent_and_quote_boundary(api):
    search=lambda **kwargs:api.post('/operations/discovery/search',json={'city':'Balasore','query':'maid',**kwargs}).json()
    assert [s['id'] for s in search()['home_services']]==['maid']
    assert not search(max_price_paise=10000)['home_services']  # No invented budget/price for quote-only plans.
    event={'event_id':str(uuid.uuid4()),'kind':'service_view','service_id':'home:renovation'}
    assert api.post('/operations/discovery/events',headers=auth('customer'),json=event).status_code==403
    assert api.put('/operations/discovery/preferences',headers=auth('customer'),json={'enabled':True,'consent_version':2}).status_code==200
    assert api.post('/operations/discovery/events',headers=auth('customer'),json=event).json()['categories']==['renovation']
    saved=main.operations_store.run(lambda u:u.get('discovery_preferences','customer'))
    assert saved['signals']['renovation']['visits']==1 and 'query' not in saved
    assert api.post('/operations/discovery/events',headers=auth('customer'),json=event).json()['reason']=='duplicate'
