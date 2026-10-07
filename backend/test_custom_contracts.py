"""Real custom-contract routes with isolated reviewed people and private sites."""
import time
import uuid
import json
from concurrent.futures import ThreadPoolExecutor

import pytest
import main
import custom_contracts as contracts
import repaidians as social
from operations import Unit
from test_operations import api, auth, onboard, PIN
from test_worker_network import get, put

PREFIX = '/operations/custom-contracts'


@pytest.fixture
def ready(api):
    onboard(api, 'worker'); onboard(api, 'worker2')
    put('workers', 'worker', {**get('workers', 'worker'), 'contractor_verified': True})
    assert api.get('/repaidians/state', headers=auth('worker')).status_code == 200
    assert api.get('/repaidians/state', headers=auth('worker2')).status_code == 200
    return api


def query(api, **changes):
    now = time.time()
    body = dict(request_id=str(uuid.uuid4()), title='Campus cooling upgrade', sector='Education', work_trade='ac',
        city='Balasore', area='Campus neighbourhood', site='PRIVATE exact campus entrance', location=PIN,
        scope='Install and inspect air conditioning equipment across the customer campus.', skills=['AC service'],
        minimum_experience=2, workforce_requirements=[{'worker_type': 'AC Installer', 'count': 2}],
        starts_at=now+86400, ends_at=now+7*86400, deadline=now+3600, budget_paise=900000,
        terms='Complete the agreed installation safely, with customer-reviewed completion milestones.')
    body.update(changes)
    response = api.post(PREFIX+'/queries', headers=auth('shop'), json=body)
    assert response.status_code == 201, response.text
    return response.json()['query'], body


def bid(api, q, uid='worker', **changes):
    body = dict(request_id=str(uuid.uuid4()), expected_version=q['version'], amount_paise=800000,
        proposal='Install the agreed equipment and inspect all commissioning and safety milestones.', accepted_terms=True)
    body.update(changes)
    response = api.post(PREFIX+'/queries/'+q['id']+'/bids', headers=auth(uid), json=body)
    assert response.status_code == 200, response.text
    return response.json()['query'], body


def command(api, q, action, status=200, uid='shop', **changes):
    body = dict(request_id=str(uuid.uuid4()), expected_version=q['version'], action=action)
    body.update(changes)
    response = api.post(PREFIX+'/queries/'+q['id']+'/commands', headers=auth(uid), json=body)
    assert response.status_code == status, response.text
    return response.json()


def location():
    return {'location': {**PIN, 'accuracy': 5, 'captured_at': time.time()}, 'location_consent': True}


def test_customer_post_is_idempotent_normalized_and_only_indexed_matches_can_read(ready):
    q, body = query(ready)
    assert ready.post(PREFIX+'/queries', headers=auth('shop'), json=body).json()['query']['id'] == q['id']
    assert ready.post(PREFIX+'/queries', headers=auth('shop'), json={**body, 'title':'Changed campus'}).status_code == 409
    assert q['requirements']['sector'] == 'education' and q['requirements']['skill_terms'] == ['ac', 'service']
    assert q['workforce_requirements'] == [{'worker_type':'ac_installer','count':2}]
    response = ready.get(PREFIX+'/queries?scope=matched', headers=auth('worker'))
    assert response.status_code == 200 and 'no-store' in response.headers['cache-control']
    visible = response.json()['items'][0]
    assert visible['id'] == q['id'] and 'site' not in visible and 'location' not in visible
    assert visible['terms'] == body['terms'] and visible['permissions']['can_bid']
    assert visible['match']['eligible'] and visible['match']['reasons']
    assert ready.get(PREFIX+'/queries/'+q['id'], headers=auth('stranger')).status_code == 404
    assert ready.post(PREFIX+'/queries', headers=auth('customer'), json={**body,'request_id':str(uuid.uuid4())}).status_code == 403


def test_private_bids_concurrent_owner_award_uses_one_canonical_price_and_no_payment(ready):
    put('workers','worker2',{**get('workers','worker2'),'contractor_verified':True})
    q,_=query(ready);q,first=bid(ready,q);q,_=bid(ready,q,'worker2',amount_paise=700000)
    first_view=ready.get(PREFIX+'/queries/'+q['id'],headers=auth('worker')).json()['query']
    assert len(first_view['bids'])==1 and first_view['bids'][0]['amount_paise']==800000
    assert ready.post(PREFIX+'/queries/'+q['id']+'/bids',headers=auth('worker'),json=first).status_code==200
    full=ready.get(PREFIX+'/queries/'+q['id'],headers=auth('shop')).json()['query'];assert len(full['bids'])==2
    command(ready,full,'award',status=403,uid='worker',bid_id=full['bids'][0]['id'])
    def accept(proposal):
        return ready.post(PREFIX+'/queries/'+q['id']+'/commands',headers=auth('shop'),json=dict(
            request_id=str(uuid.uuid4()),expected_version=full['version'],action='award',bid_id=proposal['id']))
    with ThreadPoolExecutor(max_workers=2) as pool: outcomes=list(pool.map(accept,full['bids']))
    assert sorted(r.status_code for r in outcomes)==[200,409]
    saved=get('contract_tenders',q['id']);p=get('contract_projects',saved['winning_project_id'])
    accepted=next(b for b in saved['bids'] if b['id']==saved['winning_bid_id'])
    assert p['owner_id']==accepted['contractor_id'] and p['client_id']=='shop'
    assert p['contract_value_paise']==accepted['amount_paise'] and p['tender_id']==q['id']
    assert p['source_kind']==contracts.SOURCE and p['team']==[] and not p.get('hiring')
    assert not any(key in p for key in ('paid','paid_paise','payments','deposit_paise'))


def test_query_engagement_is_real_exclusive_scoped_and_owner_can_disable(ready):
    q,_=query(ready);url=PREFIX+'/queries/'+q['id']
    for choice in ('interested','useful','support'):
        response=ready.put(url+'/reaction',headers=auth('worker'),json={'request_id':str(uuid.uuid4()),'reaction':choice})
        assert response.status_code==200,response.text
    assert response.json()['query']['stats']['reactions']=={'interested':0,'useful':0,'support':1}
    for uid,expected in (('worker',True),('worker',False),('shop',False)):
        result=ready.post(url+'/view',headers=auth(uid),json={'request_id':str(uuid.uuid4())})
        assert result.json()['recorded'] is expected
    assert result.json()['views']==1
    post={'request_id':str(uuid.uuid4()),'text':'The campus has three accessible installation rooms.'}
    root=ready.post(url+'/comments',headers=auth('shop'),json=post);assert root.status_code==201,root.text
    assert ready.post(url+'/comments',headers=auth('shop'),json=post).json()==root.json()
    reply=ready.post(url+'/comments',headers=auth('worker'),json={'request_id':str(uuid.uuid4()),'text':'That fits the proposed team scope.','parent_id':root.json()['item']['id']})
    assert reply.status_code==201,reply.text
    assert ready.post(url+'/comments',headers=auth('worker'),json={'request_id':str(uuid.uuid4()),'text':'Nested reply rejected.','parent_id':reply.json()['item']['id']}).status_code==422
    current=ready.get(url,headers=auth('shop')).json()['query'];assert current['stats']['comments']==2
    updated=command(ready,current,'engagement',comments_enabled=False,reactions_enabled=False)['query']
    assert not updated['permissions']['can_comment'] and not updated['permissions']['can_react']
    assert ready.post(url+'/comments',headers=auth('shop'),json={'request_id':str(uuid.uuid4()),'text':'Disabled comment'}).status_code==403
    assert ready.put(url+'/reaction',headers=auth('worker'),json={'request_id':str(uuid.uuid4()),'reaction':'useful'}).status_code==403


def test_free_nearby_interest_requires_real_opening_and_never_becomes_application(ready):
    q,_=query(ready);url=PREFIX+'/queries/'+q['id'];position=location()
    assert ready.post(PREFIX+'/agent-opportunities',headers=auth('worker2'),json={}).status_code==422
    response=ready.post(PREFIX+'/agent-opportunities',headers=auth('worker2'),json=position)
    assert response.status_code==200,response.text
    item=response.json()['items'][0];assert item['phase']=='pending_award' and item['interest_access']=='nearby_trial'
    assert item['distance_km']==0 and 'site' not in item and 'location' not in item
    body=dict(request_id=str(uuid.uuid4()),note='I can install cooling equipment safely during the requested dates.',available=True,worker_type='AC Installer',**position)
    response=ready.post(url+'/interest',headers=auth('worker2'),json=body);assert response.status_code==200,response.text
    receipt=response.json()['interest'];assert receipt['status']=='pending_award' and receipt['worker_type']=='ac_installer'
    assert 'location' not in receipt and 'position' not in receipt
    assert ready.post(url+'/interest',headers=auth('worker2'),json=body).json()['interest']['id']==receipt['id']
    assert ready.get(url,headers=auth('worker2')).json()['query']['my_interest']['id']==receipt['id']
    assert get('project_applications',social.digest(q['id']+':worker2')) is None
    assert ready.get(url+'/interests',headers=auth('shop')).json()['items'][0]['worker_id']=='worker2'
    far={**body,'request_id':str(uuid.uuid4()),'location':{**position['location'],'lat':22}}
    assert ready.post(url+'/interest',headers=auth('worker2'),json=far).status_code==403
    stale={**body,'request_id':str(uuid.uuid4()),'location':{**position['location'],'captured_at':time.time()-901}}
    assert ready.post(url+'/interest',headers=auth('worker2'),json=stale).status_code==422
    empty,_=query(ready,workforce_requirements=[])
    assert ready.post(PREFIX+'/queries/'+empty['id']+'/interest',headers=auth('worker2'),json={**body,'request_id':str(uuid.uuid4())}).status_code==404


def test_paid_agent_interest_uses_registered_trade_city_without_location(ready):
    q,_=query(ready,location=None)
    now=int(time.time()*1000)
    put('rp_trials','worker2',{'userId':'worker2','startsAt':now-61*86400000,'endsAt':now-86400000,'policy':'repaidians-full-social-trial-60-days-v2'})
    assert ready.post(PREFIX+'/agent-opportunities',headers=auth('worker2'),json={}).status_code==402
    put('rp_subscriptions','worker2',{'userId':'worker2','plan':'pro','amountPaise':19900,'provider':'razorpay','startsAt':now-1000,'endsAt':now+86400000,'status':'active'})
    response=ready.post(PREFIX+'/agent-opportunities',headers=auth('worker2'),json={});assert response.status_code==200,response.text
    assert response.json()['items'][0]['interest_access']=='membership'
    body=dict(request_id=str(uuid.uuid4()),note='Available for the stated cooling upgrade and safety checks.',available=True,worker_type='ac_installer')
    result=ready.post(PREFIX+'/queries/'+q['id']+'/interest',headers=auth('worker2'),json=body)
    assert result.status_code==200,result.text
    assert result.json()['interest']['approx_distance_km'] is None


def test_agent_opening_messages_use_real_thread_trial_privacy_and_actual_vacancies(ready):
    q,_=query(ready);q,_=bid(ready,q);url=PREFIX+'/queries/'+q['id']
    body=dict(request_id=str(uuid.uuid4()),text='I am available as a cooling installer for this pending project.',recipient_id='worker',**location())
    result=ready.post(url+'/agent-messages',headers=auth('worker2'),json=body);assert result.status_code==201,result.text
    assert result.json()['message']['openingContext']=='pending_award_availability'
    assert ready.post(url+'/agent-messages',headers=auth('worker2'),json=body).json()==result.json()
    thread=ready.get('/repaidians/messages/worker',headers=auth('worker2'));assert thread.status_code==200,thread.text
    assert thread.json()['messages'][0]['id']==result.json()['message']['id']
    assert ready.post(url+'/agent-messages',headers=auth('shop'),json={**body,'request_id':str(uuid.uuid4())}).status_code==403
    assert ready.post(url+'/agent-messages',headers=auth('worker2'),json={**body,'request_id':str(uuid.uuid4()),'recipient_id':'shop'}).status_code==404
    owner=ready.get(url,headers=auth('shop')).json()['query'];awarded=command(ready,owner,'award',bid_id=owner['bids'][0]['id'])
    assert ready.post(url+'/agent-messages',headers=auth('worker2'),json={**body,'request_id':str(uuid.uuid4())}).status_code==404
    p=get('contract_projects',awarded['project']['id']);p['hiring']=dict(status='open',deadline=time.time()+3600,openings=2,skills=['AC service'],work_trade='ac',city='Balasore',worker_role='any',minimum_experience=1)
    put('contract_projects',p['id'],p)
    assert ready.post(url+'/agent-messages',headers=auth('worker2'),json={**body,'request_id':str(uuid.uuid4())}).status_code==201
    member=get('rp_members','worker');member.setdefault('settings',{})['messagePrivacy']='nobody';put('rp_members','worker',member)
    assert ready.post(url+'/agent-messages',headers=auth('worker2'),json={**body,'request_id':str(uuid.uuid4())}).status_code==403


def test_bounded_cursor_and_background_notification_backfill_no_hot_full_scan(ready,monkeypatch):
    q,_=query(ready);other,_=query(ready,title='Second campus cooling project')
    def forbidden(*args,**kwargs):raise AssertionError('A full collection scan ran on a hot custom-contract read.')
    monkeypatch.setattr(Unit,'all',forbidden);monkeypatch.setattr(Unit,'find',forbidden)
    response=ready.get(PREFIX+'/queries?scope=matched&limit=1',headers=auth('worker'));assert response.status_code==200,response.text
    page=response.json();assert page['nextCursor']
    second=ready.get(PREFIX+'/queries?scope=matched&limit=1&cursor='+page['nextCursor'],headers=auth('worker'))
    assert second.status_code==200 and second.json()['items'][0]['id']!=page['items'][0]['id']
    assert ready.get(PREFIX+'/queries?scope=mine&cursor='+page['nextCursor'],headers=auth('shop')).status_code==422
    # Existing registered contractors may predate the new write hook; the worker repairs one bounded document-key page.
    state=contracts.process_notifications(main,limit=4);assert state['indexing']['complete']
    notices=main.operations_store.run(lambda u:social.query(u,social.lane('rp_notifications','worker'),20))
    matches=[n for n in notices if n['type']=='custom_contract_match'];assert {n['queryId'] for n in matches}=={q['id'],other['id']}
    assert all(get('notifications',n['id'])['query_id']==n['queryId'] for n in matches)
    assert contracts.process_notifications(main,limit=4)['delivered']==0


def test_customer_private_messages_and_enquiries_open_only_after_owner_acceptance(ready):
    q,_=query(ready);q,_=bid(ready,q);url=PREFIX+'/queries/'+q['id']
    owner=ready.get(url,headers=auth('shop')).json()['query'];winning=owner['bids'][0]['id']
    for kind in ('messages','enquiries'):
        for uid in ('shop','worker'):
            assert ready.get(url+'/'+kind,headers=auth(uid)).status_code==403
            body=dict(request_id=str(uuid.uuid4()),text='Private proposal discussion',**({'bid_id':winning} if kind=='enquiries' else {}))
            assert ready.post(url+'/'+kind,headers=auth(uid),json=body).status_code==403
    awarded=command(ready,owner,'award',bid_id=winning)
    response=ready.post(url+'/messages',headers=auth('shop'),json={'request_id':str(uuid.uuid4()),'text':'The accepted installation can begin at the agreed time.'})
    assert response.status_code==201,response.text
    assert ready.get(url+'/messages',headers=auth('worker')).json()['items'][0]['text']==response.json()['item']['text']
    notes=main.operations_store.run(lambda u:social.query(u,social.lane('rp_notifications','worker'),20))
    message=next(n for n in notes if n['type']=='custom_contract_message')
    assert message['bidId']==winning and message['projectId']==awarded['project']['id']
    assert ready.get(PREFIX+'/public/'+q['id']+'/progress').status_code==404
    visible=command(ready,awarded['query'],'public_progress',public_progress=True)
    progress=ready.get(PREFIX+'/public/'+q['id']+'/progress');assert progress.status_code==200,progress.text
    assert set(progress.json())=={'id','query_id','title','city','sector','status','progress'}
    command(ready,visible['query'],'public_progress',public_progress=False)
    assert ready.get(PREFIX+'/public/'+q['id']+'/progress').status_code==404


def test_owner_sees_real_matches_before_bids_and_revocation_removes_suggestions(ready):
    q,_=query(ready)
    assert q['stats']['bids']==0 and len(q['matched_contractors'])==1
    candidate=q['matched_contractors'][0]
    assert candidate['contractor_id']=='worker' and candidate['member']['id']=='worker'
    assert candidate['fit']=={'score':100.0,'model':'custom-contract-fit-v1','components':{'trade':1.0,'city':1.0,'skills':1.0,'experience':1.0}}
    assert q['matches_state']['scope']=='bounded trade/city candidates' and not q['matches_state']['complete']
    contracts.process_notifications(main,limit=1)
    notes=main.operations_store.run(lambda u:social.query(u,social.lane('rp_notifications','shop'),10))
    recommendation=next(n for n in notes if n['type']=='custom_contract_recommendations')
    assert recommendation['queryId']==q['id'] and get('notifications',recommendation['id'])['destination']=='custom_contract'
    put('network_blocks','shop:worker',{'active':True})
    hidden=ready.get(PREFIX+'/queries/'+q['id'],headers=auth('shop')).json()['query']
    assert hidden['matched_contractors']==[] and hidden['matches_state']['shown']==0
    put('network_blocks','shop:worker',{'active':False})
    put('workers','worker',{**get('workers','worker'),'status':'rejected'})
    assert ready.get(PREFIX+'/queries/'+q['id'],headers=auth('shop')).json()['query']['matched_contractors']==[]


def test_existing_workers_backfill_has_bounded_checkpoint_before_match_queue_drains(ready):
    q,_=query(ready)
    template=get('workers','worker')
    # These older records deliberately precede Unit.put's new audience-index hook.
    with main.db() as conn:
        for index in range(40):
            uid='existing-'+str(index).zfill(2)
            conn.execute('INSERT INTO operation_records(kind,id,body) VALUES(?,?,?)',('workers',uid,json.dumps({**template,'id':uid})))
    first=contracts.process_notifications(main,limit=1)
    assert first['indexing']['indexed']==24 and not first['indexing']['complete'] and first['queries']==0
    assert get('custom_contract_match_queue',q['id'])['active'] is True
    second=contracts.process_notifications(main,limit=1)
    assert second['indexing']['complete'] and second['indexing']['indexed']==18
    assert get('custom_contract_index_state','contractors-v1')['after']=='worker2'
    assert ready.get(PREFIX+'/queries/'+q['id'],headers=auth('shop')).json()['query']['matches_state']['shown']<=6


def test_agent_feed_awarded_openings_disappear_when_actual_team_fills(ready):
    q,_=query(ready);q,_=bid(ready,q)
    owner=ready.get(PREFIX+'/queries/'+q['id'],headers=auth('shop')).json()['query']
    awarded=command(ready,owner,'award',bid_id=owner['bids'][0]['id']);pid=awarded['project']['id']
    assert ready.post(PREFIX+'/agent-opportunities',headers=auth('worker2'),json=location()).json()['items']==[]
    p=get('contract_projects',pid);p['hiring']=dict(status='open',deadline=time.time()+3600,openings=2,skills=['AC service'],work_trade='ac',city='Balasore',worker_role='any',minimum_experience=1)
    put('contract_projects',pid,p)
    response=ready.post(PREFIX+'/agent-opportunities',headers=auth('worker2'),json=location())
    assert response.status_code==200,response.text
    opening=response.json()['items'][0]
    assert opening['phase']=='jobs_open' and opening['opening_project_id']==pid and opening['message_recipient_id']=='worker'
    assert opening['permissions']['can_message_nearby'] and not opening['permissions']['can_interest']
    assert opening['message_recipients'][0]['id']=='worker' and opening['bids']==[]
    p['team']=[{'worker_id':'crew-1','status':'accepted','role':'member'},{'worker_id':'crew-2','status':'accepted','role':'member'}];put('contract_projects',pid,p)
    assert ready.post(PREFIX+'/agent-opportunities',headers=auth('worker2'),json=location()).json()['items']==[]


def test_configurable_cta_is_bounded_and_cannot_open_customer_chat_before_award(ready):
    q,body=query(ready,cta_label='  Review my requirement  ')
    assert q['controls']['cta_label']=='Review my requirement' and q['permissions']['can_use_cta']
    assert ready.post(PREFIX+'/queries',headers=auth('shop'),json={**body,'request_id':str(uuid.uuid4()),'cta_label':'x'*25}).status_code==422
    changed=command(ready,q,'engagement',cta_enabled=False,cta_label='Discuss accepted work')['query']
    assert not changed['permissions']['can_use_cta'] and changed['controls']['cta_label']=='Discuss accepted work'
    assert ready.post(PREFIX+'/queries/'+q['id']+'/messages',headers=auth('shop'),json={'request_id':str(uuid.uuid4()),'text':'This CTA must not bypass award.'}).status_code==403
    assert ready.post(PREFIX+'/queries/'+q['id']+'/commands',headers=auth('worker'),json={'request_id':str(uuid.uuid4()),'expected_version':changed['version'],'action':'engagement','cta_enabled':True}).status_code==403


def test_64_maximum_unicode_proposals_fit_compact_tender_without_losing_content(ready,monkeypatch):
    now=time.time();clock=[now];monkeypatch.setattr(time,'time',lambda:clock[0])
    proposal='\U0001f9f0'*4000;terms='\U0001f3d7'*4000
    q,_=query(ready,terms=terms,deadline=now+3*86400,starts_at=now+4*86400)
    first_body=None
    for index in range(64):
        clock[0]=now+(index//30)*3601
        q,body=bid(ready,q,proposal=proposal)
        if first_body is None:first_body=body
    saved=get('contract_tenders',q['id'])
    encoded=len(json.dumps(saved,ensure_ascii=False,separators=(',',':')).encode('utf-8'))
    assert encoded<contracts.TENDER_BYTE_BUDGET and len(saved['bids'])==64
    assert all('proposal' not in item and 'terms_snapshot' not in item for item in saved['bids'])
    assert all(get('custom_contract_bid_content',item['content_id'])['proposal']==proposal and
               get('custom_contract_bid_content',item['content_id'])['terms_snapshot']==terms for item in saved['bids'])
    owner=ready.get(PREFIX+'/queries/'+q['id'],headers=auth('shop')).json()['query']
    assert len(owner['bids'])==64 and all(item['proposal']==proposal for item in owner['bids'])
    assert ready.post(PREFIX+'/queries/'+q['id']+'/bids',headers=auth('worker'),json=first_body).status_code==200
    failed=ready.post(PREFIX+'/queries/'+q['id']+'/bids',headers=auth('worker'),json={**body,'request_id':str(uuid.uuid4()),'expected_version':q['version']})
    assert failed.status_code==409 and len(get('contract_tenders',q['id'])['bids'])==64
    awarded=command(ready,owner,'award',bid_id=owner['bids'][-1]['id'])
    assert awarded['project']['contract_value_paise']==800000 and awarded['query']['bids'][-1]['proposal']==proposal


def test_legacy_embedded_proposal_reads_and_tender_budget_rolls_back_mutations(ready):
    q,_=query(ready);q,body=bid(ready,q)
    saved=get('contract_tenders',q['id']);summary=saved['bids'][0]
    content=get('custom_contract_bid_content',summary.pop('content_id'))
    summary.update(proposal=content['proposal'],terms_snapshot=content['terms_snapshot']);put('contract_tenders',q['id'],saved)
    owner=ready.get(PREFIX+'/queries/'+q['id'],headers=auth('shop')).json()['query']
    assert owner['bids'][0]['proposal']==body['proposal']
    before=get('contract_tenders',q['id'])
    oversized={**before,'legacy_extra_detail':'\U0001f9f0'*(contracts.TENDER_BYTE_BUDGET//4)}
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as error:put('contract_tenders',q['id'],oversized)
    assert error.value.status_code==409 and get('contract_tenders',q['id'])==before
