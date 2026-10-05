"""Isolated real endpoint tests. Provider fixtures never grant live memberships."""
import time,uuid
from datetime import datetime,timezone
import main,hiring
from test_operations import api,auth,onboard,command,ADMIN,PIN
from integrations import settlement

def setup_hire(api,monkeypatch):
    monkeypatch.setenv('GOOGLE_ROUTES_API_KEY','test-only')
    monkeypatch.setattr(hiring,'route_metres',lambda a,b:3000)
    p={**hiring.DEFAULT,'enabled':True,'gst_bps':1800,'membership_paise':9900,'day_hours':8,'terms':'Test-only day hire scope, eight hours with customer approval required for all extras.'}
    r=api.put('/operations/admin/hiring-policy',headers=ADMIN,json=p);assert r.status_code==200,r.text
    onboard(api)
    def seed(u):
        u.put('hire_memberships','worker',dict(id='worker',status='active',expires_at=time.time()+86400,policy_version=p['version'],radius_km=10))
        w=u.get('workers','worker');w['settlement_policy_version']='earn-test';u.put('workers','worker',w)
        u.put('policies','current',dict(version='earn-test',worker_share_bps=7500,bonus_reserve_bps=1000,penalty_cap_bps=10000,stack_penalties=False,penalty_mode='highest_single'))
    main.operations_store.run(seed)
    return p

def request(api,p,**changes):
    b=dict(worker_id='worker',category='ac',location=PIN,radius_km=10,address='Test customer work address 123',city='Balasore',phone='9876543210',starts_at=datetime.fromtimestamp(time.time()+5000,timezone.utc).isoformat(),notes='Repair and inspect AC for the agreed day scope.',policy_version=p['version'],request_id=str(uuid.uuid4()))
    b.update(changes);r=api.post('/operations/hiring/requests',headers=auth('customer'),json=b);assert r.status_code==201,r.text;return r.json(),b
def decide(api,h,action,uid='worker',**extra):
    return api.post('/operations/hiring/requests/'+h['id']+'/decision',headers=auth(uid),json={'expected_version':h['version'],'action':action,**extra})

def test_hire_complete_lifecycle_reports_and_privacy(api,monkeypatch,tmp_path):
    p=setup_hire(api,monkeypatch)
    assert api.put('/operations/admin/hiring-policy',headers=auth('worker'),json=p).status_code==403
    h,b=request(api,p)
    assert api.post('/operations/hiring/requests',headers=auth('customer'),json=b).json()['id']==h['id']
    assert 'address' not in h and 'location' not in h
    assert decide(api,h,'accept','customer').status_code==403
    assert decide(api,h,'accept',position={**PIN,'accuracy':5,'captured_at':time.time()-180}).status_code==422
    r=decide(api,h,'accept',position={**PIN,'accuracy':5,'captured_at':time.time()});assert r.status_code==200,r.text;h=r.json()
    assert h['quote']['travel_paise']==6000 and h['quote']['gst_paise']==10062
    assert 'accepted_position' not in h
    r=decide(api,h,'confirm','customer');assert r.status_code==200,r.text
    jid=r.json()['job_id'];assert decide(api,h,'confirm','customer').json()['job_id']==jid
    j=api.get('/operations/jobs/'+jid,headers=auth('worker')).json()
    assert 'hire_origin' not in j
    j=command(api,j,'ack_reminder');j=command(api,j,'depart')
    j=command(api,j,'position',payload={**PIN,'accuracy':5,'captured_at':time.time()})
    # Real OTP endpoint, with only its deterministic code generator replaced by the test environment.
    monkeypatch.setenv('REPAIDO_OTP_SECRET','test-only-code-secret')
    code=api.get(f'/operations/jobs/{jid}/arrival-code',headers=auth('customer'));assert code.status_code==200,code.text
    r=api.post(f'/operations/jobs/{jid}/verify-arrival',headers=auth('worker'),json={'code':code.json()['code']});assert r.status_code==200,r.text
    j=api.get('/operations/jobs/'+jid,headers=auth('worker')).json()
    j=command(api,j,'start');j=command(api,j,'submit_completion',payload={'notes':'Completed repair and tested the AC.'});j=command(api,j,'accept_completion','customer');j=command(api,j,'review','customer',{'rating':3,'text':'Work completed, arrival took longer.'})
    # Payment/ledger fixture only. No live financial provider is called.
    def paid(u):
        row=u.get('jobs',jid);row['payment_status']='verified';u.put('jobs',jid,row);return settlement(u,jid)
    s=main.operations_store.run(paid)
    assert s['net_paise']==43425 and s['gst_payable_paise']==10062
    assert s['parts_payable_paise']==0
    report=api.get(f'/operations/worker/tasks/{jid}/report',headers=auth('worker'));assert report.status_code==200
    assert report.json()['review']['rating']==3 and report.json()['completion_notes']
    assert api.get(f'/operations/worker/tasks/{jid}/report',headers=auth('customer')).status_code==403
    assert api.get(f'/operations/worker/tasks/{jid}/report',headers=auth('stranger')).status_code==403
    pdf=api.get(f'/operations/worker/tasks/{jid}/report.pdf',headers=auth('worker'));assert pdf.status_code==200 and pdf.content.startswith(b'%PDF-')
    (tmp_path/'report.pdf').write_bytes(pdf.content)
    profile=api.get('/operations/professionals/worker').json();assert profile['rating']==3
    assert not {'phone','location','home_address','dob','bank'}&profile.keys()

def test_hire_expiry_choice_rematch_and_bonus(api,monkeypatch):
    p=setup_hire(api,monkeypatch);onboard(api,'worker2')
    def member(u):u.put('hire_memberships','worker2',dict(id='worker2',status='active',expires_at=time.time()+86400,policy_version=p['version'],radius_km=10))
    main.operations_store.run(member)
    h,_=request(api,p)
    def expire(u):
        old=u.get('hires',h['id']);old['offer_expires_at']=time.time()-1;u.put('hires',h['id'],old)
    main.operations_store.run(expire)
    rows=api.get('/operations/hiring/requests',headers=auth('customer')).json()['requests'];h=rows[0];assert h['state']=='awaiting_choice'
    assert h['assessment']['deduction_paise']==0
    r=decide(api,h,'wait','customer');assert r.status_code==200;h=r.json();assert h['wait_used']
    main.operations_store.run(expire);h=api.get('/operations/hiring/requests',headers=auth('customer')).json()['requests'][0]
    assert decide(api,h,'wait','customer').status_code==409
    r=decide(api,h,'rematch','customer');assert r.status_code==200,r.text;h=r.json();assert h['worker_id']=='worker2' and h['bonus_paise']==4990
    assert not api.get('/operations/hiring/requests',headers=auth('worker')).json()['requests']
    assert decide(api,h,'accept','worker',position={**PIN,'accuracy':5,'captured_at':time.time()}).status_code==404
    assert decide(api,h,'cancel','customer').json()['state']=='cancelled'

def test_search_membership_and_route_failure_boundaries(api,monkeypatch):
    monkeypatch.setattr(hiring,'free_listing',lambda:False)
    import hire_discovery
    monkeypatch.setattr(hire_discovery,'free_listing',lambda:False)
    p=setup_hire(api,monkeypatch)
    b={'location':PIN,'radius_km':10}
    assert len(api.post('/operations/hiring/search',json=b).json()['professionals'])==1
    assert not api.post('/operations/hiring/search',json={**b,'min_rating':4.5}).json()['professionals']
    h,_=request(api,p)
    monkeypatch.setattr(hiring,'route_metres',lambda a,b:hiring.fail('ROUTE_FAILED','Route unavailable.',503))
    assert decide(api,h,'accept',position={**PIN,'accuracy':5,'captured_at':time.time()}).status_code==503
    h=api.get('/operations/hiring/requests',headers=auth('worker')).json()['requests'][0];assert h['state']=='offered'
    assert not main.operations_store.run(lambda u:u.all('jobs'))
    assert api.post('/operations/worker/hire-membership/payment-order',headers=auth('worker')).status_code==503
    assert api.put('/operations/worker/public-profile',headers=auth('worker'),json={'bio':'Good repair work','role':'specialist'}).status_code==422
    assert api.put('/operations/worker/public-profile',headers=auth('worker'),json={'bio':'Good repair work','portrait_id':'someone-elses-image'}).status_code==422
    assert api.put('/operations/worker/public-profile',headers=auth('worker'),json={'bio':'Reliable repair work','languages':['Odia'],'specialties':['AC cleaning']}).status_code==200
    assert api.get('/operations/professionals/worker').json()['bio']=='Reliable repair work'
    def refund(u):m=u.get('hire_memberships','worker');m['status']='refunded';u.put('hire_memberships','worker',m)
    main.operations_store.run(refund)
    assert not api.post('/operations/hiring/search',json=b).json()['professionals']

def test_membership_gateway_capture_retry_and_refund(api,monkeypatch):
    monkeypatch.setattr(hiring,'free_listing',lambda:False)
    import hire_discovery
    monkeypatch.setattr(hire_discovery,'free_listing',lambda:False)
    p=setup_hire(api,monkeypatch)
    def unpaid(u):
        m=u.get('hire_memberships','worker');m.update(status='unpaid',expires_at=0);u.put('hire_memberships','worker',m)
    main.operations_store.run(unpaid)
    monkeypatch.setenv('REPAIDO_PAYMENTS_ENABLED','true')
    for key in ('RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET'):monkeypatch.setenv(key,'test-only')
    created=[];payments=[]
    def gateway(path,body=None,**kwargs):
        if path=='orders':created.append(body);return {'id':'order_fixture'}
        if path=='orders/order_fixture/payments':return {'items':payments}
        raise AssertionError(path)
    monkeypatch.setattr(hiring,'razorpay',gateway)
    r=api.post('/operations/worker/hire-membership/payment-order',headers=auth('worker'));assert r.status_code==200,r.text
    assert api.post('/operations/worker/hire-membership/payment-order',headers=auth('worker')).json()['order_id']=='order_fixture'
    assert len(created)==1
    payments.append({'id':'pay_fixture','order_id':'order_fixture','amount':9900,'currency':'INR','captured':True,'status':'captured'})
    r=api.post('/operations/worker/hire-membership/payment-check',headers=auth('worker'));assert r.json()['membership']['status']=='active'
    expiry=r.json()['membership']['expires_at']
    assert api.post('/operations/worker/hire-membership/payment-check',headers=auth('worker')).json()['membership']['expires_at']==expiry
    payments[0]['amount_refunded']=9900;payments[0]['status']='refunded'
    assert api.post('/operations/worker/hire-membership/payment-check',headers=auth('worker')).json()['membership']['status']=='refunded'
    assert not api.post('/operations/hiring/search',json={'location':PIN}).json()['professionals']

def test_current_acceptance_origin_and_bonus_allocation(api,monkeypatch):
    p=setup_hire(api,monkeypatch);h,_=request(api,p)
    calls=[]
    def route(a,b):calls.append((a,b));return 4000
    monkeypatch.setattr(hiring,'route_metres',route)
    origin={**PIN,'lat':PIN['lat']+.001,'accuracy':5,'captured_at':time.time()}
    r=decide(api,h,'accept',position=origin);assert r.status_code==200,r.text
    assert calls[0][0]==origin and calls[1][1]==origin
    h=r.json();r=decide(api,h,'confirm','customer');assert r.status_code==200,r.text;jid=r.json()['job_id']
    def calc(u):
        j=u.get('jobs',jid);j.update(state='completed',payment_status='verified',hire_bonus_paise=4990);u.put('jobs',jid,j);return settlement(u,jid)
    s=main.operations_store.run(calc)
    assert s['hire_bonus_paise']==4990 and s['company_base_commission_paise']==2495
    j=main.operations_store.run(lambda u:u.get('jobs',jid))
    assert s['net_paise']+s['company_earnings_paise']+s['bonus_reserve_paise']+s['gst_payable_paise']+s['parts_payable_paise']==j['total_paise']
