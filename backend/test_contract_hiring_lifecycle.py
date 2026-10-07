"""Transactional hiring actions using isolated accounts, never live records."""
import time, uuid
from concurrent.futures import ThreadPoolExecutor
from fastapi import Header
import main, contract_work as cw
from test_operations import api, auth
from test_contract_work import seed, project, cmd
from test_worker_network import notice, apply, decision, get, put


def view(api,a,action='profile_viewed',uid='worker',**extra):
    body=dict(expected_version=a['version'],action=action,request_id=str(uuid.uuid4()));body.update(extra)
    return api.post('/operations/contractor/hiring/applications/'+a['id']+'/view',headers=auth(uid),json=body),body


def rows(api,uid='worker2',**params):
    return api.get('/operations/contractor/hiring/applications',headers=auth(uid),params=params)


def private(api,uid='shop',**extra):
    now=time.time();body=dict(request_id=str(uuid.uuid4()),title='Home electrical repair',scope='Private home repair and installation',site='Private home site address',starts_at=now+3600,ends_at=now+86400,budget_paise=400000);body.update(extra)
    return api.post('/operations/contractor/projects/private',headers=auth(uid),json=body),body


def private_notice(api,p,uid='shop'):
    body=dict(expected_version=p['version'],status='open',city='Balasore',area='Station Road',sector='Electrical',summary='Private home wiring repair work with safety checks',skills=['AC service'],worker_role='any',openings=1,minimum_experience=0,daily_rate_paise=100000,hours_per_day=8,deadline=time.time()+3000,terms='Eight hours daily with weekly payment after inspection.')
    response=api.put('/operations/contractor/projects/'+p['id']+'/hiring',headers=auth(uid),json=body)
    assert response.status_code==200,response.text
    return response.json()


def test_explicit_views_auth_retry_and_get_has_no_side_effect(api):
    seed(api);p,_=project(api);p,_=notice(api,p);a=apply(api,p).json();original=get('project_applications',a['id'])
    assert rows(api,'worker').status_code==200 and get('project_applications',a['id'])==original
    assert view(api,a,uid='worker2')[0].status_code==403
    response,body=view(api,a);assert response.status_code==200;a=response.json()
    assert a['profile_viewed_at'] and a['events'][-1]['action']=='profile_viewed'
    assert api.post('/operations/contractor/hiring/applications/'+a['id']+'/view',headers=auth('worker'),json=body).json()['version']==a['version']
    assert view(api,a,expected_version=1)[0].json()['version']==a['version']
    assert view(api,a,'application_viewed',expected_version=1)[0].status_code==409
    response,_=view(api,a,'application_viewed');assert response.status_code==200;a=response.json()
    response,_=view(api,a,'reviewed');assert response.status_code==200;a=response.json()
    own=rows(api).json()['applications'][0]
    assert [e['action'] for e in own['events']]==['applied','profile_viewed','application_viewed','reviewed']
    notices=main.operations_store.run(lambda u:u.find('notifications','user_id','worker2'))
    assert len([n for n in notices if n.get('kind')=='application_update'])==3
    assert 'command_receipts' not in own


def test_hold_idempotency_receipt_reason_and_versions(api):
    seed(api);p,_=project(api);p,_=notice(api,p);a=apply(api,p).json()
    assert decision(api,a,p,'hold',note='').status_code==422
    request=str(uuid.uuid4());response=decision(api,a,p,'hold',note='Waiting for site readiness.',request_id=request)
    assert response.status_code==200;held=response.json();assert held['status']=='on_hold'
    assert decision(api,a,p,'hold',note='Waiting for site readiness.',request_id=request).json()['version']==held['version']
    assert decision(api,a,p,'hold',note='Different reason',request_id=request).status_code==409
    assert decision(api,a,p,'shortlist').status_code==409
    shortlisted=decision(api,held,p,'shortlist').json()
    assert decision(api,shortlisted,p,'reject',note='Too').status_code==422
    rejected=decision(api,shortlisted,p,'reject',note='Project needs another work schedule.').json()
    assert rejected['status']=='rejected' and rejected['events'][-1]['note'].startswith('Project needs')
    assert apply(api,p).status_code==409


def test_offer_privacy_accept_and_decline_propagate(api):
    seed(api);p,_=project(api);p,_=notice(api,p);a=apply(api,p).json();offered=decision(api,a,p,daily_rate_paise=123400).json()
    assert offered['status']=='offered' and '123400' not in str(cw.public_hiring(get('contract_projects',p['id'])))
    assert rows(api,'shop',project_id=p['id'],scope='owned').status_code==403
    current=get('contract_projects',p['id']);response=cmd(api,current,'accept',uid='worker2',target_id=offered['invitation_id'])
    assert response.status_code==200,response.text;placed=rows(api).json()['applications'][0]
    assert placed['status']=='hired' and placed['events'][-1]['action']=='accept'
    assert placed['invitation']['daily_rate_paise']==123400 and placed['invitation_status']=='accepted'
    assert cmd(api,current,'accept',uid='worker2',target_id=offered['invitation_id']).status_code==409
    current=get('contract_projects',p['id']);assert cmd(api,current,'leave_team',uid='worker2').status_code==200
    assert rows(api).json()['applications'][0]['status']=='ended'
    other,_=project(api,starts_at=time.time()+90000,ends_at=time.time()+180000);other,_=notice(api,other);a=apply(api,other).json();offered=decision(api,a,other).json()
    current=get('contract_projects',other['id']);assert cmd(api,current,'decline',uid='worker2',target_id=offered['invitation_id']).status_code==200
    assert get('project_applications',a['id'])['status']=='declined'
    reapplied=apply(api,other);assert reapplied.status_code==200 and [e['action'] for e in reapplied.json()['events']][-2:]==['decline','applied']


def test_changed_notice_requires_reconfirmation_and_stale_offer_can_decline(api):
    seed(api);p,_=project(api);p,_=notice(api,p);a=apply(api,p).json();changed,_=notice(api,p,daily_rate_paise=200000)
    assert decision(api,a,changed).status_code==409
    confirmed=apply(api,changed);assert confirmed.status_code==200;a=confirmed.json();assert a['events'][-1]['action']=='reconfirmed'
    offered=decision(api,a,changed).json();current=get('contract_projects',p['id']);changed,_=notice(api,current,daily_rate_paise=300000)
    assert cmd(api,changed,'accept',uid='worker2',target_id=offered['invitation_id']).status_code==409
    assert get('project_applications',a['id'])['status']=='offered'
    assert cmd(api,changed,'decline',uid='worker2',target_id=offered['invitation_id']).status_code==200
    assert get('project_applications',a['id'])['status']=='declined'


def test_private_customer_request_preserves_commercial_gate_and_public_privacy(api):
    seed(api);assert private(api,'customer')[0].status_code==403
    actor=main.app.dependency_overrides[main.current_user]
    def verified(authorization:str=Header(default='')):
        user=actor(authorization);return {**user,'phone_verified':True,'phone_authenticated':True} if user['id']=='customer' else user
    main.app.dependency_overrides[main.current_user]=verified
    response,body=private(api,'customer');assert response.status_code==200,response.text;p=response.json()
    assert p['source_kind']=='private_request' and p['owner_phone_verified']
    assert private(api,'customer',**body)[0].json()['id']==p['id']
    assert private(api,'customer',**{**body,'title':'Changed repair'})[0].status_code==409
    assert api.post('/operations/contractor/projects',headers=auth('customer'),json=body).status_code==403
    assert private(api,'customer',tender_id='commercial-tender')[0].status_code==422
    p=private_notice(api,p,'customer');a=apply(api,p).json();assert a['source_kind']=='private_request'
    assert rows(api,'customer',scope='owned',project_id=p['id']).json()['applications'][0]['worker_id']=='worker2'
    response,_=view(api,a,uid='customer');assert response.status_code==200;a=response.json()
    offered=decision(api,a,p,uid='customer');assert offered.status_code==200,offered.text
    current=get('contract_projects',p['id']);assert cmd(api,current,'accept',uid='worker2',target_id=offered.json()['invitation_id']).status_code==200
    projection=cw.public_hiring(current);assert projection['source_kind']=='private_request' and 'Private home site' not in str(projection)
    assert 'scope' not in projection and 'owner_phone_verified' not in projection
    put('network_suspensions','customer',{'active':True});assert main.operations_store.run(lambda u:cw.hiring_source_authorized(u,current)) is False


def test_pages_bounded_to_ownership_with_cursor_filter_binding(api,monkeypatch):
    seed(api);p,_=project(api);p,_=notice(api,p);a=apply(api,p).json()
    def fill(u):
        for n in range(91):
            key=f'application-owned-{n:03d}';u.put('project_applications',key,{**a,'id':key})
            key=f'application-other-{n:03d}';u.put('project_applications',key,{**a,'id':key,'owner_id':'shop','worker_id':'stranger'})
    main.operations_store.run(fill)
    from operations import Unit
    original=Unit.all
    def no_scan(self,kind):
        assert kind!='project_applications';return original(self,kind)
    monkeypatch.setattr(Unit,'all',no_scan);cursor='';seen=set()
    while True:
        response=rows(api,scope='mine',limit=7,cursor=cursor);assert response.status_code==200;page=response.json()
        for row in page['applications']:
            assert row['worker_id']=='worker2' and row['id'] not in seen;seen.add(row['id'])
        if not page['has_more']:break
        cursor=page['next_cursor'];assert cursor
        assert rows(api,'worker',scope='mine',limit=7,cursor=cursor).status_code==422
        assert rows(api,scope='owned',limit=7,cursor=cursor).status_code==422
    assert len(seen)==92
    assert rows(api,'worker2',scope='owned',project_id=p['id']).status_code==403


def test_concurrent_decisions_have_single_outcome(api):
    seed(api);p,_=project(api);p,_=notice(api,p);a=apply(api,p).json()
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses=list(pool.map(lambda action:decision(api,a,p,action,note='Another work scope is needed.'),['offer','reject']))
    assert sorted(r.status_code for r in responses)==[200,409]
    current=get('project_applications',a['id']);team=get('contract_projects',p['id'])['team']
    assert len(current['events'])==2 and len(team)==(1 if current['status']=='offered' else 0)


def test_fit_explains_recorded_skills_geography_and_fifo_only_for_ties(api):
    seed(api);p,_=project(api);p,_=notice(api,p);a=apply(api,p).json();worker=get('workers','worker2');fit=cw.application_fit(worker,p['hiring'])
    assert fit['eligible'] and fit['components']['skills']==1 and fit['components']['city']==1
    unrelated=cw.application_fit({**worker,'city':'Mumbai','skills':['Painting'],'categories':['painting']},p['hiring'])
    assert fit['score']>unrelated['score']
    assert cw.application_fit({**worker,'experience_years':0},{**p['hiring'],'minimum_experience':3})['eligible'] is False
    put('project_applications','application-earlier',{**a,'id':'application-earlier','created_at':a['created_at']-100})
    page=rows(api,'worker',scope='owned',project_id=p['id']).json()['applications']
    assert page[0]['id']=='application-earlier' and page[0]['queue_position']==1 and page[0]['rank_scope']=='page'
    assert page[0]['tie_break']=='first_applied' and page[1]['queue_position']==2


def test_ready_candidates_live_authorization_and_stale_lane_defense(api,monkeypatch):
    seed(api);p,_=project(api);p,_=notice(api,p,work_trade='electrician')
    import repaidians_work as rw
    profile=dict(id='worker2',name='Ready professional',trade='electrician',city='Balasore',workStatus='open_to_work',avatarUrl=None)
    def index(u,row):
        u.put('rp_members',row['id'],row);rw.index_record(u,'rp_members',row['id'],row)
    main.operations_store.run(lambda u:index(u,profile))
    url='/operations/contractor/projects/'+p['id']+'/candidates'
    assert api.get(url,headers=auth('worker2')).status_code==403
    response=api.get(url,headers=auth('worker'));assert response.status_code==200,response.text
    data=response.json();assert data['project_version']==p['version'] and data['candidates'][0]['worker_id']=='worker2'
    candidate=data['candidates'][0];assert candidate['ready_for_work'] and 'home_address' not in candidate and 'location' not in candidate and 'phone' not in candidate
    main.operations_store.run(lambda u:index(u,{**profile,'workStatus':'not_looking'}))
    assert api.get(url,headers=auth('worker')).json()['candidates']==[]
    main.operations_store.run(lambda u:index(u,profile))
    put('network_blocks','worker:worker2',{'active':True})
    assert api.get(url,headers=auth('worker')).json()['candidates']==[]
    put('network_blocks','worker:worker2',{'active':False})
    worker=get('workers','worker2');put('workers','worker2',{**worker,'status':'suspended'})
    assert api.get(url,headers=auth('worker')).json()['candidates']==[]
    put('workers','worker2',{**worker,'city':'Mumbai'})
    assert api.get(url,headers=auth('worker')).json()['candidates']==[]
    put('workers','worker2',worker)
    # Deliberately stale ready lane with a live status mismatch must not surface.
    put('rp_members','worker2',{**profile,'workStatus':'not_looking'})
    put(rw.channel('ready','electrician','Balasore'),'worker2',{'id':'worker2','sortKey':'worker2','active':True})
    assert api.get(url,headers=auth('worker')).json()['candidates']==[]


def test_ready_candidate_pages_are_bounded_without_global_profile_scan(api,monkeypatch):
    seed(api);p,_=project(api);p,_=notice(api,p,work_trade='electrician')
    import repaidians_work as rw
    worker=get('workers','worker2')
    def fill(u):
        for n in range(80):
            key=f'candidate-{n:03d}';u.put('workers',key,{**worker,'id':key})
            member=dict(id=key,name='Ready professional',trade='electrician',city='Balasore',workStatus='available',avatarUrl=None)
            u.put('rp_members',key,member);rw.index_record(u,'rp_members',key,member)
    main.operations_store.run(fill)
    from operations import Unit
    original=Unit.all
    def no_scan(self,kind):
        assert kind not in ('workers','rp_members');return original(self,kind)
    monkeypatch.setattr(Unit,'all',no_scan)
    url='/operations/contractor/projects/'+p['id']+'/candidates';seen=set();cursor=''
    while True:
        response=api.get(url,headers=auth('worker'),params={'limit':9,'cursor':cursor});assert response.status_code==200,response.text
        page=response.json();assert len(page['candidates'])<=9
        for row in page['candidates']:assert row['id'] not in seen;seen.add(row['id'])
        if not page['has_more']:break
        cursor=page['next_cursor'];assert cursor
    assert len(seen)==80


def test_firestore_application_keyset_scopes_and_binds_document_cursor(monkeypatch):
    from google.cloud.firestore_v1 import Client
    from google.auth.credentials import AnonymousCredentials
    from types import SimpleNamespace
    client=Client(project='hiring-test-only',credentials=AnonymousCredentials());queries=[]
    def stream(self,transaction=None,**kwargs):
        queries.append(self._to_protobuf());return iter(())
    from google.cloud.firestore_v1.query import Query
    monkeypatch.setattr(Query,'stream',stream)
    core=SimpleNamespace(fs_collection=lambda name:client.collection(name),fs_doc=lambda name,key:client.collection(name).document(key))
    unit=SimpleNamespace(tx=object(),core=core,pending={},fetched={})
    assert cw.application_keyset(unit,'candidate-001','mine',after='application-boundary',limit=999)==[]
    query=queries[0];assert query.limit==cw.APPLICATION_SCAN+1
    assert query.where.field_filter.field.field_path=='worker_id' and query.where.field_filter.value.string_value=='candidate-001'
    assert query.order_by[0].field.field_path=='__name__'
    assert query.start_at.values[0].reference_value.endswith('/ops_project_applications/application-boundary')


def test_project_cancellation_propagates_to_pending_candidate_and_cannot_accept(api):
    seed(api);p,_=project(api);p,_=notice(api,p);a=apply(api,p).json();offered=decision(api,a,p).json()
    current=get('contract_projects',p['id']);cancelled=cmd(api,current,'cancel',note='The customer cancelled the work.')
    assert cancelled.status_code==200
    application=rows(api).json()['applications'][0]
    assert application['status']=='cancelled' and application['project_status']=='cancelled'
    assert application['events'][-1]['action']=='cancel'
    assert cmd(api,cancelled.json(),'accept',uid='worker2',target_id=offered['invitation_id']).status_code==409


def test_individual_application_detail_authorized_with_current_private_offer(api):
    seed(api);p,_=project(api);p,_=notice(api,p);a=apply(api,p).json();offered=decision(api,a,p,daily_rate_paise=987600).json()
    url='/operations/contractor/hiring/applications/'+a['id']
    candidate=api.get(url,headers=auth('worker2'));assert candidate.status_code==200,candidate.text
    assert candidate.json()['invitation']['daily_rate_paise']==987600
    assert candidate.json()['project_version']==get('contract_projects',p['id'])['version']
    assert api.get(url,headers=auth('shop')).status_code==404
    assert api.get(url).status_code==401
    assert 'command_receipts' not in candidate.json()
    assert api.get(url,headers=auth('worker')).json()['fit']['eligible']


def test_accepted_offer_rechecks_live_role_approval_and_social_block(api):
    seed(api);p,_=project(api);p,_=notice(api,p,worker_role='technician');a=apply(api,p).json();offered=decision(api,a,p).json();current=get('contract_projects',p['id'])
    worker=get('workers','worker2');put('workers','worker2',{**worker,'role':'specialist'})
    assert cmd(api,current,'accept',uid='worker2',target_id=offered['invitation_id']).status_code==409
    put('workers','worker2',worker)
    import repaidians
    put('rp_blocks',repaidians.digest('worker:worker2'),{'active':True})
    assert cmd(api,current,'accept',uid='worker2',target_id=offered['invitation_id']).status_code==403
    assert get('project_applications',a['id'])['status']=='offered'
    assert cmd(api,current,'decline',uid='worker2',target_id=offered['invitation_id']).status_code==200


def test_workspace_membership_revocation_drops_private_scope_but_retains_accepted_history(api):
    from test_contract_work import invite
    seed(api);p,_=project(api,scope='CONFIDENTIAL work specification',site='CONFIDENTIAL private site address');p=invite(api,p)
    url='/operations/contractor/workspace'
    pending=api.get(url,headers=auth('worker2'))
    assert pending.status_code==200 and pending.json()['projects'][0]['id']==p['id']
    declined=cmd(api,p,'decline',uid='worker2',target_id=p['team'][0]['id']);assert declined.status_code==200
    assert 'scope' not in declined.json() and 'site' not in declined.json() and 'CONFIDENTIAL' not in declined.text
    revoked=api.get(url,headers=auth('worker2'));assert revoked.json()['projects']==[] and 'CONFIDENTIAL' not in revoked.text
    assert cmd(api,declined.json(),'accept',uid='worker2',target_id=p['team'][0]['id']).status_code==403
    # A new invitation restores only its current grant; old declined rows alone do not.
    p=invite(api,declined.json());accepted=cmd(api,p,'accept',uid='worker2',target_id=p['team'][-1]['id']);assert accepted.status_code==200
    current=get('contract_projects',p['id']);removed=cmd(api,current,'remove',target_id='worker2');assert removed.status_code==200
    revoked=api.get(url,headers=auth('worker2'));assert revoked.json()['projects']==[] and 'CONFIDENTIAL' not in revoked.text
    assert cmd(api,removed.json(),'check_in',uid='worker2').status_code==403
    p=invite(api,removed.json());accepted=cmd(api,p,'accept',uid='worker2',target_id=p['team'][-1]['id']);assert accepted.status_code==200
    current=get('contract_projects',p['id']);left=cmd(api,current,'leave_team',uid='worker2');assert left.status_code==200
    assert 'scope' not in left.json() and 'site' not in left.json() and 'CONFIDENTIAL' not in left.text
    assert api.get(url,headers=auth('worker2')).json()['projects']==[]
    assert cmd(api,left.json(),'check_in',uid='worker2').status_code==403
    # Ended projects retain legitimate accepted members' work history and own terms.
    p=invite(api,left.json());accepted=cmd(api,p,'accept',uid='worker2',target_id=p['team'][-1]['id']);assert accepted.status_code==200
    current=get('contract_projects',p['id']);put('contract_projects',p['id'],{**current,'status':'completed'})
    history=api.get(url,headers=auth('worker2')).json()['projects']
    assert history[0]['status']=='completed' and history[0]['team'][-1]['terms']
    owner=api.get(url,headers=auth('worker')).json()['projects'];assert owner[0]['scope']=='CONFIDENTIAL work specification'


def test_business_sector_and_work_category_are_distinct_with_legacy_skill_inference(api):
    seed(api);p,_=project(api,title='Campus maintenance opportunity')
    worker=get('workers','worker2');put('workers','worker2',{**worker,'skills':['Electrical wiring'],'categories':['electrician']})
    import repaidians_work as rw
    def ready(u,key,trade,skills):
        u.put('workers',key,{**worker,'id':key,'skills':skills,'categories':[trade]})
        member=dict(id=key,name='Ready professional',trade=trade,city='Balasore',workStatus='available',avatarUrl=None)
        u.put('rp_members',key,member);rw.index_record(u,'rp_members',key,member)
    main.operations_store.run(lambda u:(ready(u,'worker2','electrician',['Electrical wiring']),ready(u,'cleaner','cleaning',['Home cleaning']),ready(u,'shop-profile','spares',['Inventory management'])))
    p,_=notice(api,p,sector='Education',work_trade='electrician',skills=['Electrical wiring'])
    assert p['hiring']['sector']=='Education' and p['hiring']['work_trade']=='electrician'
    url='/operations/contractor/projects/'+p['id']+'/candidates'
    result=api.get(url,headers=auth('worker'));assert result.status_code==200,result.text
    assert [row['worker_id'] for row in result.json()['candidates']]==['worker2']
    assert result.json()['candidates'][0]['fit']['components']['category']==1
    assert cw.public_hiring(p)['hiring']['sector']=='Education'
    assert cw.public_hiring(p)['hiring']['work_trade']=='electrician'
    assert cw.hiring_trade({'sector':'Education','skills':['Electrical wiring']},'Campus maintenance')=='electrician'
    assert cw.hiring_trade({'sector':'Education','skills':['Generic assistance']},'Plumbing technician needed')=='plumber'
    assert cw.hiring_trade({'sector':'Electrical','skills':['Generic assistance']},'Maintenance')=='electrician'
    assert cw.hiring_trade({'sector':'Education','skills':['Generic assistance']},'Campus maintenance') is None
    assert cw.hiring_trade({'sector':'Education','skills':['Electrical wiring'],'work_trade':'plumber'})=='plumber'
    body=dict(p['hiring']);body.pop('version');body.pop('updated_at');body.update(expected_version=p['version'],work_trade='Education')
    assert api.put('/operations/contractor/projects/'+p['id']+'/hiring',headers=auth('worker'),json=body).status_code==422
    # An old client omitting the field still stores the clear skill-derived trade.
    p,_=notice(api,p,sector='Education',skills=['Electrical wiring'])
    assert p['hiring']['work_trade']=='electrician'
    # Unknown industry+generic skills require a deliberate category, not a bogus spares lane.
    body.update(work_trade=None,expected_version=p['version'],skills=['Generic assistance'],sector='Education')
    assert api.put('/operations/contractor/projects/'+p['id']+'/hiring',headers=auth('worker'),json=body).status_code==422
