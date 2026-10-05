"""Isolated API tests: no live people, posts, subscriptions or gateway calls."""
import time,uuid
import pytest
import main,worker_network as nw
from test_operations import api,auth,onboard,ADMIN
from test_contract_work import seed,project,cmd

def req(api,path,uid='worker',body=None,method=None):
    return api.request(method or ('POST' if body is not None else 'GET'),'/operations/network'+path,headers=auth(uid),json=body)
def put(kind,key,row):main.operations_store.run(lambda u:u.put(kind,key,row))
def get(kind,key):return main.operations_store.run(lambda u:u.get(kind,key))
def paid(uid='worker',role='technician',**changes):
    now=time.time();fee=dict(id=uid+'fee',worker_id=uid,role=role,days=365,amount=nw.PLAN_PRICES[role],status='paid',payment_id='pay_'+uid,paid_at=now);put('network_fees',fee['id'],fee)
    e=dict(worker_id=uid,role=role,fee_id=fee['id'],starts_at=now-1,ends_at=now+86400,status='active');e.update(changes);put('network_memberships',uid,e)
def connect(api):
    assert req(api,'/connections/worker2',body={'action':'request'}).status_code==200
    assert req(api,'/connections/worker','worker2',{'action':'accept'}).status_code==200

def notice(api,p,**extra):
    h=dict(expected_version=p['version'],status='open',city='Balasore',area='Station Road',sector='Electrical',summary='Public electrical project requiring installation and service skills',skills=['AC service'],worker_role='any',openings=1,minimum_experience=0,daily_rate_paise=100000,hours_per_day=8,deadline=time.time()+3000,terms='Eight hours daily. Payment weekly after approved attendance.',benefits='Safety equipment provided.');h.update(extra)
    r=api.put('/operations/contractor/projects/'+p['id']+'/hiring',headers=auth('worker'),json=h);assert r.status_code==200,r.text
    return r.json(),h

def apply(api,p,uid='worker2',**extra):
    body=dict(hiring_version=p['hiring']['version'],note='Experienced with the required electrical service work.',available=True);body.update(extra)
    return api.post('/operations/contractor/projects/'+p['id']+'/apply',headers=auth(uid),json=body)
def decision(api,a,p,action='offer',uid='worker',**extra):
    body=dict(expected_version=a['version'],project_version=p['version'],action=action,daily_rate_paise=100000,terms='Eight hours daily, weekly payment and safety equipment included.');body.update(extra)
    return api.post('/operations/contractor/hiring/applications/'+a['id']+'/decision',headers=auth(uid),json=body)

def test_search_and_profiles_allowlist_private_records(api):
    assert api.get('/operations/network/search').status_code==401
    assert req(api,'/search','customer').status_code==403
    seed(api);p,_=project(api);p,_=notice(api,p)
    for uid in ['worker','worker2']:
        put('jobs',uid+'job',dict(id=uid+'job',worker_id=uid,service_name='AC repair',state='completed',starts_at='2026-10-01T10:00:00Z',completed_at=time.time(),address='SECRET HOME',phone='SECRET PHONE',location={'lat':1,'lng':2},review=dict(rating=5,text='Good service',created_at=time.time())))
    r=req(api,'/search');assert r.status_code==200;r=r.json()
    assert [t['id'] for t in r['tasks']]==['workerjob']
    assert [x['id'] for x in r['people']]==['worker2']
    public=r['projects'][0];assert 'site' not in public and 'budget_paise' not in public and 'scope' not in public
    assert set(public['team'])=={'total','members','supervisors'}
    r=req(api,'/people/worker2').json()['profile'];assert r['reviews'][0]['rating']==5
    for secret in ['home_address','phone','location','verification','bank','tools']:assert secret not in r
    assert 'SECRET' not in str(r)
    assert req(api,'/search?kind=contractors','worker2').json()['people'][0]['id']=='worker'
    assert not req(api,'/search?city=Mumbai').json()['people']
    assert req(api,'/search?kind=tasks').json()['people']==[]

def test_connection_consent_blocking_and_throttle(api,monkeypatch):
    seed(api)
    assert req(api,'/connections/worker2',body={'action':'request'}).status_code==200
    assert req(api,'/connections/worker2',body={'action':'request'}).json()['status']=='pending'
    assert req(api,'/connections/worker2',body={'action':'accept'}).status_code==409
    assert req(api,'/messages/worker2').status_code==403
    assert req(api,'/connections/worker','worker2',{'action':'accept'}).status_code==200
    assert req(api,'/blocks/worker2',body={}).status_code==200
    assert req(api,'/messages/worker','worker2').status_code==403
    assert req(api,'/people/worker','worker2').status_code==404
    assert not req(api,'/search','worker2').json()['people']
    assert req(api,'/blocks/worker2',method='DELETE').status_code==200
    assert req(api,'/messages/worker2').status_code==200
    assert req(api,'/connections/worker2',body={'action':'remove'}).status_code==200
    assert req(api,'/connections/worker2',body={'action':'request'}).status_code==429
    old=time.time();monkeypatch.setattr(time,'time',lambda:old+86401)
    assert req(api,'/connections/worker2',body={'action':'request'}).status_code==200

def test_paid_gate_private_and_community_messaging(api):
    seed(api);connect(api)
    msg=dict(request_id=str(uuid.uuid4()),text='Hello, let us discuss the project')
    assert req(api,'/messages/worker2',body=msg).status_code==403
    # Launch/earned listing entitlements never unlock network messaging.
    put('hire_memberships','worker',dict(status='active',ends_at=time.time()+86400))
    assert req(api,'/messages/worker2',body=msg).status_code==403
    paid();r=req(api,'/messages/worker2',body=msg);assert r.status_code==200,r.text
    assert req(api,'/messages/worker2',body=msg).json()['id']==r.json()['id']
    assert req(api,'/messages/worker2',body={**msg,'text':'changed'}).status_code==409
    assert len(req(api,'/messages/worker','worker2').json()['messages'])==1
    assert not req(api,'/messages/worker','worker2').json()['can_send']
    g=req(api,'/groups',body=dict(request_id=str(uuid.uuid4()),name='Electrical group',description='Professional electrical discussion',category='Electrical',city='Balasore')).json()
    assert req(api,f"/groups/{g['id']}/join",'worker2',{}).status_code==200
    topic=dict(request_id=str(uuid.uuid4()),title='Safety topic',text='Review the project safety requirements')
    post=req(api,f"/groups/{g['id']}/posts",body=topic);assert post.status_code==200,post.text
    assert req(api,f"/groups/{g['id']}/posts",'worker2',topic).status_code==403
    assert req(api,f"/posts/{post.json()['id']}/replies",'worker2',msg).status_code==403
    assert req(api,'/groups','worker2',dict(request_id=str(uuid.uuid4()),name='Other group',description='New group discussion',category='AC')).status_code==403
    paid('worker2');assert req(api,f"/posts/{post.json()['id']}/replies",'worker2',msg).status_code==200
    assert req(api,f"/posts/{post.json()['id']}/hide",'worker2',{}).status_code==403
    assert req(api,f"/posts/{post.json()['id']}/hide",body={}).status_code==200
    assert req(api,f"/groups/{g['id']}/posts").json()['posts']==[]

@pytest.mark.parametrize('mode',['expired','wrong_role','unpaid','missing_payment','wrong_amount'])
def test_no_false_paid_entitlement(api,mode):
    seed(api);connect(api);paid()
    if mode=='expired':e=get('network_memberships','worker');e['ends_at']=time.time()-1;put('network_memberships','worker',e)
    elif mode=='wrong_role':e=get('workers','worker');e['role']='specialist';put('workers','worker',e)
    else:
        f=get('network_fees','workerfee')
        if mode=='unpaid':f['status']='created'
        if mode=='missing_payment':f.pop('payment_id')
        if mode=='wrong_amount':f['amount']=1
        put('network_fees','workerfee',f)
    assert not req(api,'/plan').json()['active']
    assert req(api,'/messages/worker2',body=dict(request_id=str(uuid.uuid4()),text='Paid-only message')).status_code==403

def test_gateway_confirmed_plan_prices_retry_refund(api,monkeypatch):
    seed(api)
    for k in ['RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET']:monkeypatch.setenv(k,'test-only')
    monkeypatch.setenv('REPAIDO_PAYMENTS_ENABLED','false')
    body=dict(role='technician',version='network-annual-v1',accepted_terms=True)
    assert req(api,'/plan/order',body=body).status_code==503
    monkeypatch.setenv('REPAIDO_PAYMENTS_ENABLED','true')
    orders=[];pays=[]
    def provider(path,body=None):
        if path=='orders':orders.append({**body,'id':'order_fixture'});return orders[-1]
        if path.endswith('/payments'):return {'items':pays}
        if path.startswith('orders?'):return {'items':orders}
        raise AssertionError(path)
    monkeypatch.setattr(nw,'razorpay',provider)
    plan=req(api,'/plan').json();assert plan['prices']=={'technician':1200000,'specialist':1800000} and plan['gst_included']
    assert req(api,'/plan/order',body={**body,'role':'specialist'}).status_code==409
    order=req(api,'/plan/order',body=body);assert order.status_code==200,order.text
    assert req(api,'/plan/order',body=body).json()==order.json() and len(orders)==1
    pays.append(dict(id='pay_fixture',order_id='order_fixture',amount=1,currency='INR',status='captured',captured=True))
    assert not req(api,'/plan/check',body={}).json()['active']
    pays[0]['amount']=1200000;pays[0]['status']='authorized'
    assert not req(api,'/plan/check',body={}).json()['active']
    pays[0]['status']='captured';r=req(api,'/plan/check',body={}).json();assert r['active'];end=r['membership']['ends_at']
    assert round(end-r['membership']['starts_at'])==365*86400
    assert req(api,'/plan/check',body={}).json()['membership']['ends_at']==end
    pays[0]['amount_refunded']=1200000;pays[0]['status']='refunded'
    now=time.time();monkeypatch.setattr(time,'time',lambda:now+360)
    assert main.network_tick()['checked']==1
    assert not req(api,'/plan').json()['active']

def test_unknown_order_recovery_does_not_double_charge(api,monkeypatch):
    seed(api)
    for k in ['RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET']:monkeypatch.setenv(k,'test-only')
    monkeypatch.setenv('REPAIDO_PAYMENTS_ENABLED','true');orders=[]
    def provider(path,body=None):
        if path=='orders':orders.append({**body,'id':'unknown_order'});raise RuntimeError('timeout after order created')
        if path.startswith('orders?'):return {'items':orders}
        if path.endswith('/payments'):return {'items':[]}
    monkeypatch.setattr(nw,'razorpay',provider)
    body=dict(role='technician',version='network-annual-v1',accepted_terms=True)
    with pytest.raises(RuntimeError):req(api,'/plan/order',body=body)
    assert req(api,'/plan/order',body=body).status_code==409 and len(orders)==1
    assert req(api,'/plan/check',body={}).status_code==200
    assert req(api,'/plan/order',body=body).json()['order_id']=='unknown_order' and len(orders)==1

def test_hiring_apply_shortlist_offer_and_agent_accepts(api):
    seed(api);p,_=project(api);p,h=notice(api,p)
    r=apply(api,p);assert r.status_code==200,r.text;a=r.json()
    assert apply(api,p).json()['id']==a['id']
    assert get('contract_projects',p['id'])['team']==[]
    assert decision(api,a,p,uid='worker2').status_code==403
    r=decision(api,a,p,'shortlist');assert r.status_code==200;r=r.json()
    assert decision(api,a,p).status_code==409
    r=decision(api,r,p);assert r.status_code==200,r.text
    current=get('contract_projects',p['id']);assert current['team'][0]['status']=='pending'
    own=api.get('/operations/contractor/hiring/applications',headers=auth('worker2')).json()['applications'][0]
    assert own['invitation_status']=='pending'
    accepted=cmd(api,current,'accept',uid='worker2',target_id=current['team'][0]['id']);assert accepted.status_code==200
    assert api.get('/operations/contractor/hiring/applications',headers=auth('worker2')).json()['applications'][0]['invitation_status']=='accepted'

def test_hiring_stale_terms_closed_role_and_private_permissions(api):
    seed(api);p,_=project(api);p,h=notice(api,p)
    assert apply(api,p,hiring_version=999).status_code==409
    assert apply(api,p,available=False).status_code==422
    assert apply(api,p,uid='worker').status_code==403
    assert api.put('/operations/contractor/projects/'+p['id']+'/hiring',headers=auth('worker2'),json={**h,'expected_version':p['version']}).status_code==403
    old=p;p,_=notice(api,p,worker_role='specialist')
    assert apply(api,old).status_code==409
    assert apply(api,p).status_code==409
    p,_=notice(api,p,worker_role='any',status='paused');assert apply(api,p).status_code==409
    p,_=notice(api,p,status='open');assert apply(api,p).status_code==200
    assert api.get('/operations/contractor/hiring/applications',headers=auth('stranger')).status_code==403
    assert api.put('/operations/contractor/projects/'+p['id']+'/hiring',headers=auth('worker'),json={**h,'expected_version':p['version'],'deadline':time.time()-1}).status_code==422

def test_hiring_capacity_and_conflict_rechecked_at_offer(api):
    seed(api);p,_=project(api);p,_=notice(api,p);a=apply(api,p).json()
    other,_=project(api);from test_contract_work import invite
    other=invite(api,other);cmd(api,other,'accept',uid='worker2',target_id=other['team'][0]['id'])
    assert decision(api,a,p).status_code==409
    current=get('contract_projects',p['id']);assert current['team']==[]
    assert get('project_applications',a['id'])['status']=='applied'

def test_reports_and_operator_moderation(api):
    seed(api);connect(api);paid();m=req(api,'/messages/worker2',body=dict(request_id=str(uuid.uuid4()),text='Reportable message')).json()
    r=req(api,'/reports','worker2',dict(kind='message',target_id=m['id'],reason='Please review this message')).json()
    assert req(api,'/admin/reports').status_code==403
    url='/operations/network/admin/reports/'+r['id'];body=dict(action='hide',reason='Operator reviewed the reported content')
    assert api.post(url,headers=ADMIN,json=body).status_code==200
    assert req(api,'/messages/worker','worker2').json()['messages']==[]
    r=req(api,'/reports','worker2',dict(kind='person',target_id='worker',reason='Account conduct review')).json()
    assert api.post('/operations/network/admin/reports/'+r['id'],headers=ADMIN,json=dict(action='suspend',reason='Suspended after operator review')).status_code==200
    assert req(api,'/search').status_code==403
    assert req(api,'/people/worker','worker2').status_code==404

def test_plan_without_membership_avoids_empty_firestore_document(api,monkeypatch):
    seed(api)
    from operations import Unit
    original=Unit.get
    def checked(self,kind,key):
        assert key, 'Firestore document IDs must not be empty'
        return original(self,kind,key)
    monkeypatch.setattr(Unit,'get',checked)
    assert req(api,'/plan').json()['active'] is False
    put('network_memberships','worker',dict(status='active'))
    assert req(api,'/plan').json()['active'] is False
