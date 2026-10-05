import time,uuid
import main
from test_operations import api,auth,onboard,PIN

def seed(api):
    onboard(api,'worker');onboard(api,'worker2')
    main.operations_store.run(lambda u:u.put('workers','worker',{**u.get('workers','worker'),'contractor_verified':True}))

def project(api,**changes):
    now=time.time();body=dict(request_id=str(uuid.uuid4()),title='Electrical project',scope='Inspect and repair the electrical circuits',site='Site entrance, Balasore',starts_at=now+3600,ends_at=now+86400,budget_paise=1000000);body.update(changes)
    r=api.post('/operations/contractor/projects',headers=auth('worker'),json=body);assert r.status_code==200,r.text
    return r.json(),body

def cmd(api,p,action,uid='worker',**extra):return api.post('/operations/contractor/projects/'+p['id']+'/commands',headers=auth(uid),json=dict(expected_version=p['version'],action=action,**extra))
def invite(api,p):
    r=api.post('/operations/contractor/projects/'+p['id']+'/invitations',headers=auth('worker'),json=dict(expected_version=p['version'],worker_id='worker2',role='supervisor',daily_rate_paise=100000,terms='Work 8 hours per day with site safety equipment.'))
    assert r.status_code==200,r.text
    return r.json()

def test_access_idempotency_acceptance_and_conflicts(api):
    assert api.get('/operations/contractor/workspace').status_code==401
    assert api.post('/operations/contractor/projects',headers=auth('worker'),json=dict(request_id=str(uuid.uuid4()),title='Test project',scope='Detailed service scope',site='Test work site',starts_at=time.time()+100,ends_at=time.time()+1000,budget_paise=10000)).status_code==403
    seed(api);p,body=project(api)
    assert api.post('/operations/contractor/projects',headers=auth('worker'),json=body).json()['id']==p['id']
    assert api.post('/operations/contractor/projects',headers=auth('worker'),json={**body,'title':'Changed title'}).status_code==409
    p=invite(api,p)
    assert api.get('/operations/contractor/workspace',headers=auth('stranger')).status_code==403
    assert cmd(api,p,'accept',uid='worker',target_id=p['team'][0]['id']).status_code==409
    assert cmd(api,p,'start',uid='worker2').status_code==403
    view=api.get('/operations/contractor/workspace',headers=auth('worker2')).json()['projects'][0]
    assert 'budget_paise' not in view and view['team'][0]['terms']
    r=cmd(api,p,'accept',uid='worker2',target_id=p['team'][0]['id']);assert r.status_code==200,r.text
    accepted=r.json();assert accepted['team'][0]['status']=='accepted'
    assert cmd(api,p,'accept',uid='worker2',target_id=p['team'][0]['id']).status_code==409
    other,_=project(api,starts_at=p['starts_at'],ends_at=p['ends_at'])
    assert api.post('/operations/contractor/projects/'+other['id']+'/invitations',headers=auth('worker'),json=dict(expected_version=1,worker_id='worker2',role='member',daily_rate_paise=10000,terms='Agreed work and safety terms for project')).status_code==409
    from home_plans import conflict
    assert main.operations_store.run(lambda u:conflict(u,'worker2',p['starts_at'],60))

def test_goals_attendance_leave_and_history(api):
    seed(api);now=time.time();p,_=project(api,starts_at=now-60,ends_at=now+86400);p=invite(api,p);p=cmd(api,p,'accept',uid='worker2',target_id=p['team'][0]['id']).json();p=cmd(api,p,'start').json()
    r=cmd(api,p,'check_in',uid='worker2');assert r.status_code==200,r.text;p=r.json()
    assert cmd(api,p,'check_in',uid='worker2').status_code==409
    p=cmd(api,p,'check_out',uid='worker2').json();assert p['attendance'][0]['out_at']>=p['attendance'][0]['in_at']
    p=cmd(api,p,'goal_add',title='Repair circuits',note='Complete safety inspection',assignee_id='worker2',due_at=now+80000).json();g=p['goals'][0]
    assert cmd(api,p,'goal_approve',target_id=g['id']).status_code==409
    p=cmd(api,p,'goal_submit',uid='worker2',target_id=g['id'],note='Repaired circuits, inspection record ABC-12').json()
    assert cmd(api,p,'goal_approve',uid='worker2',target_id=g['id']).status_code==403
    p=cmd(api,p,'goal_approve',target_id=g['id']).json()
    p=cmd(api,p,'leave_request',uid='worker2',starts_at=now+5000,ends_at=now+7000,note='Personal appointment').json()
    p=cmd(api,p,'leave_approve',target_id=p['leave'][0]['id']).json();assert p['leave'][0]['status']=='approved'
    p=cmd(api,p,'complete').json();assert p['status']=='completed' and len(p['events'])>=8
    assert cmd(api,p,'check_in',uid='worker2').status_code==409

def test_tender_register_bid_private_award(api,monkeypatch):
    seed(api);now=time.time();body=dict(request_id=str(uuid.uuid4()),title='New electrical tender',scope='Detailed inspection and installation work',site='Work site in Balasore',starts_at=now+1000,ends_at=now+5000,budget_paise=1000000,sector='Electrical',city='Balasore',opens_at=now-100,deadline=now+500,manpower_needed=1,terms='Work safely and deliver the full scope with all required inspections.')
    r=api.post('/operations/contractor/tenders',headers=auth('shop'),json=body);assert r.status_code==200,r.text;t=r.json()
    p,_=project(api,tender_id=t['id'],starts_at=t['starts_at'],ends_at=t['ends_at'])
    bid=dict(request_id=str(uuid.uuid4()),expected_version=t['version'],project_id=p['id'],amount_paise=900000,proposal='Detailed proposal to deliver the electrical scope',accepted_terms=True)
    url='/operations/contractor/tenders/'+t['id']
    assert api.post(url+'/bid',headers=auth('worker'),json=bid).status_code==409
    p=invite(api,p);p=cmd(api,p,'accept',uid='worker2',target_id=p['team'][0]['id']).json()
    r=api.post(url+'/bid',headers=auth('worker'),json=bid);assert r.status_code==200,r.text;t=r.json()
    assert api.post(url+'/bid',headers=auth('worker'),json=bid).json()['bids_count']==1
    hidden=api.get('/operations/contractor/workspace',headers=auth('worker2')).json()['tenders'];assert not hidden
    award=dict(expected_version=t['version'],action='award',bid_id=t['bids'][0]['id'])
    assert api.post(url+'/commands',headers=auth('worker'),json=award).status_code==403
    assert api.post(url+'/commands',headers=auth('shop'),json=award).status_code==409
    monkeypatch.setattr(time,'time',lambda:now+600)
    r=api.post(url+'/commands',headers=auth('shop'),json=award);assert r.status_code==200,r.text;assert r.json()['status']=='awarded'
    assert api.post(url+'/commands',headers=auth('shop'),json=award).status_code==409
    current=api.get('/operations/contractor/workspace',headers=auth('worker')).json()['projects'][0];assert current['contract_value_paise']==900000
    public=api.get('/operations/contractor/overview').json()
    assert len(public['contracts'])==1 and public['leaders']==[]
    assert set(public['contracts'][0])=={'id','title','sector','city','status'}
    main.operations_store.run(lambda u:u.put('contract_projects',current['id'],{**current,'status':'completed'}))
    public=api.get('/operations/contractor/overview').json()
    assert public['leaders'][0]['completed']==1
    assert set(public['leaders'][0])=={'id','name','city','completed'}


def test_future_registration_and_no_seed_data(api):
    seed(api);w=api.get('/operations/contractor/workspace',headers=auth('worker')).json();assert w['tenders']==[] and w['projects']==[]
    now=time.time();r=api.post('/operations/contractor/tenders',headers=auth('shop'),json=dict(request_id=str(uuid.uuid4()),title='Upcoming work tender',scope='Future work delivery and inspection',site='Site address Balasore',starts_at=now+5000,ends_at=now+10000,budget_paise=1000000,sector='Electrical',city='Balasore',opens_at=now+1000,deadline=now+4000,manpower_needed=1,terms='Upcoming work terms and required safety obligations'))
    t=r.json();url='/operations/contractor/tenders/'+t['id']+'/commands';r=api.post(url,headers=auth('worker'),json=dict(expected_version=1,action='register'));assert r.status_code==200 and r.json()['registered']
    assert r.json()['registrations_count']==1
    assert 'registrations' not in r.json()


def test_contractor_market_access_and_public_overview(api):
    assert api.get('/operations/contractor/opportunities').status_code==401
    seed(api)
    assert api.get('/operations/contractor/opportunities',headers=auth('worker2')).status_code==403
    assert api.get('/operations/contractor/opportunities',headers=auth('worker')).status_code==200
    now=time.time()
    tender=dict(request_id=str(uuid.uuid4()),title='Private tender',scope='Detailed confidential installation scope',site='Private site address',starts_at=now+1000,ends_at=now+5000,budget_paise=1000000,sector='Electrical',city='Balasore',opens_at=now-100,deadline=now+500,manpower_needed=1,terms='Private tender requirements and safety conditions.')
    assert api.post('/operations/contractor/tenders',headers=auth('shop'),json=tender).status_code==200
    assert not api.get('/operations/contractor/workspace',headers=auth('worker2')).json()['tenders']
    assert len(api.get('/operations/contractor/workspace',headers=auth('shop')).json()['tenders'])==1
    public=api.get('/operations/contractor/overview')
    assert public.status_code==200 and public.json()==dict(contracts=[],leaders=[])
    assert 'Private site' not in public.text

def test_shared_sector_catalog_registration_and_tender(api):
    seed(api)
    initial=api.get('/operations/contractor/sectors').json()['sectors']
    assert len(initial)==20 and 'Healthcare' in initial and 'Interior design' in initial
    payload=dict(name='Marine Works',city='Balasore',scope='Marine facility repair and maintenance',sector='  Marine   services  ')
    assert api.put('/operations/contractor/profile',json=payload).status_code==401
    r=api.put('/operations/contractor/profile',headers=auth('worker'),json=payload)
    assert r.status_code==200 and r.json()['sector']=='Marine services'
    assert 'Marine services' in api.get('/operations/contractor/sectors').json()['sectors']
    r=api.put('/operations/contractor/profile',headers=auth('worker2'),json={**payload,'sector':'MARINE SERVICES'})
    assert r.json()['sector']=='Marine services'
    assert len(api.get('/operations/contractor/sectors').json()['sectors'])==21
    now=time.time()
    tender=dict(request_id=str(uuid.uuid4()),title='Museum refurbishment',scope='Museum facility repair and maintenance',site='Museum site Balasore',starts_at=now+5000,ends_at=now+10000,budget_paise=1000000,sector='Museums',city='Balasore',opens_at=now+100,deadline=now+4000,manpower_needed=1,terms='Required work and safety obligations for this project.')
    r=api.post('/operations/contractor/tenders',headers=auth('shop'),json=tender)
    assert r.status_code==200,r.text
    assert api.post('/operations/contractor/tenders',headers=auth('shop'),json=tender).json()['id']==r.json()['id']
    assert 'Museums' in api.get('/operations/contractor/sectors').json()['sectors']
    for name in ['  ','<invalid>','x'*81]:
        assert api.put('/operations/contractor/profile',headers=auth('worker'),json={**payload,'sector':name}).status_code==422
    bad={**tender,'request_id':str(uuid.uuid4()),'sector':'Unpublished sector','deadline':now-1,'opens_at':now-2}
    assert api.post('/operations/contractor/tenders',headers=auth('shop'),json=bad).status_code==422
    assert 'Unpublished sector' not in api.get('/operations/contractor/sectors').json()['sectors']
    assert main.operations_store.run(lambda u:len(u.all('business_sectors')))==2
