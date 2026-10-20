"""Invitation consent, contractor joining review and roster confirmation are distinct."""
import copy
import json
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import main
import contract_work as cw
from test_operations import api, auth, onboard
from test_contract_work import seed, project, cmd, invite, confirm_team


def get(pid):
    return main.operations_store.run(lambda u:u.get('contract_projects',pid))


def put(p):
    main.operations_store.run(lambda u:u.put('contract_projects',p['id'],p))


def view(api,p,uid='worker2'):
    return next(row for row in api.get('/operations/contractor/workspace',headers=auth(uid)).json()['projects'] if row['id']==p['id'])


def accepted(api,live=False):
    seed(api)
    p,_=project(api,starts_at=time.time()-30 if live else time.time()+3600)
    p=invite(api,p)
    response=cmd(api,p,'accept',uid='worker2',target_id=p['team'][0]['id'])
    assert response.status_code==200,response.text
    return get(p['id'])


def two_members(api,live=False):
    p=accepted(api,live)
    onboard(api,'shop')
    main.operations_store.run(lambda u:u.put('workers','shop',{**u.get('workers','shop'),'name':'Distinct Teammate Name'}))
    response=api.post('/operations/contractor/projects/'+p['id']+'/invitations',headers=auth('worker'),json=dict(
        expected_version=p['version'],worker_id='shop',role='member',daily_rate_paise=123400,
        terms='Private teammate joining terms containing a confidential negotiated rate.'))
    assert response.status_code==200,response.text
    p=response.json();invitation=next(m for m in p['team'] if m['worker_id']=='shop')
    response=cmd(api,p,'accept',uid='shop',target_id=invitation['id'])
    assert response.status_code==200,response.text
    return get(p['id'])


def test_accepted_offer_is_private_and_hr_commands_require_explicit_joining(api):
    p=two_members(api,live=True)
    p['team'][1].update(phone='+919999999999',email='private-team@example.test',bank_account='PRIVATE BANK')
    p['goals']=[dict(id='planned-goal',title='Private milestone for Distinct Teammate Name',assignee_id='shop',due_at=p['ends_at'],status='planned',note='Contact private-team@example.test or +919999999999',evidence='PRIVATE EVIDENCE')]
    p['attendance']=[dict(id='other-attendance',worker_id='shop',in_at=time.time()-10,out_at=None)]
    p['leave']=[dict(id='other-leave',worker_id='shop',starts_at=time.time()+100,ends_at=time.time()+200,note='PRIVATE MEDICAL NOTE',status='pending')]
    put(p)
    worker=view(api,p)
    assert worker['membership']['joining_status']=='accepted'
    assert len(worker['team'])==1 and worker['team'][0]['worker_id']=='worker2'
    assert worker['team'][0]['reports_to'] is None
    assert worker['goals']==[] # free-form milestone titles/notes can contain peer identity/contact data
    assert worker['attendance']==worker['leave']==[]
    for key in ('can_view_team','can_view_attendance','can_view_leave','can_record_attendance','can_request_leave','can_manage_goals','can_submit_goals'):
        assert worker['capabilities'][key] is False,key
    serialized=json.dumps(worker)
    for private in ('Distinct Teammate Name','private-team@example.test','+919999999999','PRIVATE BANK','PRIVATE EVIDENCE','PRIVATE MEDICAL NOTE'):
        assert private not in serialized
    for action,extra in [('check_in',{}),('leave_request',dict(starts_at=time.time()+500,ends_at=time.time()+1000,note='Personal appointment'))]:
        result=cmd(api,p,action,uid='worker2',**extra)
        assert result.status_code==409,result.text
        assert result.json()['detail']['code']=='JOINING_REQUIRED'
    assert cmd(api,p,'goal_add',uid='worker2',title='Private goal',due_at=p['ends_at']).status_code==403
    assert cmd(api,p,'confirm_joining',uid='worker2',target_id='worker2').status_code==403
    assert cmd(api,p,'confirm_team',uid='worker2').status_code==403


def test_joining_then_team_confirmation_unlocks_only_permitted_stage(api):
    p=two_members(api,live=True)
    p=cmd(api,p,'confirm_joining',target_id='worker2').json()
    member=view(api,p)
    assert member['membership']['joining_status']=='confirmed'
    assert member['membership']['confirmed_at']
    assert not member['capabilities']['can_request_leave']
    assert not member['capabilities']['can_view_team']
    rejected=cmd(api,p,'confirm_team')
    assert rejected.status_code==409 and rejected.json()['detail']['code']=='TEAM_NOT_READY'
    p=cmd(api,p,'confirm_joining',target_id='shop').json()
    assert p['team_confirmation']['can_confirm']
    p=cmd(api,p,'confirm_team').json()
    assert p['team_confirmation']['confirmed']
    assert p['team_confirmation']['confirmation_id']
    member=view(api,p)
    assert member['capabilities']['can_view_team'] and member['capabilities']['can_request_leave']
    assert not member['capabilities']['can_check_in']
    assert cmd(api,p,'check_in',uid='worker2').status_code==409
    p=cmd(api,p,'start').json()
    assert view(api,p)['capabilities']['can_check_in']
    result=cmd(api,p,'check_in',uid='worker2')
    assert result.status_code==200,result.text


def test_postconfirmation_roster_allowlist_never_shares_contacts_terms_or_peer_hr(api):
    p=two_members(api,live=True)
    p['team'][1].update(phone='+919999999999',email='private-team@example.test',bank_account='PRIVATE BANK',document_ids=['PRIVATE DOC'])
    put(p);p=confirm_team(api,p);p=cmd(api,p,'start').json()
    p=get(p['id']);p['attendance']=[dict(id='peer-attendance',worker_id='shop',in_at=time.time()-1,out_at=None)]
    p['leave']=[dict(id='peer-leave',worker_id='shop',starts_at=time.time()+10,ends_at=time.time()+20,note='PRIVATE LEAVE',status='pending')]
    put(p)
    worker=view(api,p)
    assert worker['team_confirmation']['confirmed'] and len(worker['team'])==2
    peer=next(m for m in worker['team'] if m['worker_id']=='shop')
    assert peer['name']=='Distinct Teammate Name' and peer['role']=='member'
    assert not set(peer)&{'phone','email','bank_account','document_ids','terms','daily_rate_paise','application_id'}
    assert worker['attendance']==worker['leave']==[] # supervisor is not a peer-HR privacy grant
    assert 'PRIVATE LEAVE' not in json.dumps(worker)


def test_confirmation_replay_is_idempotent_and_conflicting_request_is_rejected(api):
    p=accepted(api)
    request=str(uuid.uuid4())
    first=cmd(api,p,'confirm_joining',target_id='worker2',request_id=request)
    assert first.status_code==200,first.text
    replay=cmd(api,p,'confirm_joining',target_id='worker2',request_id=request)
    assert replay.status_code==200,replay.text
    assert first.json()['version']==replay.json()['version']
    assert cmd(api,p,'confirm_joining',target_id='different-worker',request_id=request).status_code==409
    p=first.json();team_request=str(uuid.uuid4())
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses=list(pool.map(lambda _:cmd(api,p,'confirm_team',request_id=team_request),range(2)))
    assert [r.status_code for r in responses]==[200,200]
    current=get(p['id'])
    assert len([e for e in current['events'] if e['action']=='confirm_team'])==1
    assert len([e for e in current['events'] if e['action']=='confirm_joining'])==1
    notes=main.operations_store.run(lambda u:[n for n in u.find('notifications','user_id','worker2') if n.get('event')=='joining_confirmed'])
    assert len(notes)==1 and notes[0]['joining_confirmed_at']
    assert notes[0]['invitation_id']==current['team'][0]['id']
    assert notes[0]['project_id']==p['id'] and notes[0]['kind']=='project_team'


def test_roster_change_requires_new_confirmation_and_never_inherits_new_joining(api):
    p=accepted(api,live=True);p=confirm_team(api,p);p=cmd(api,p,'start').json()
    old_confirmation=p['team_confirmation']['confirmation_id']
    onboard(api,'shop')
    response=api.post('/operations/contractor/projects/'+p['id']+'/invitations',headers=auth('worker'),json=dict(
        expected_version=p['version'],worker_id='shop',role='member',daily_rate_paise=100000,
        terms='Agreed safety and daily joining terms for this actual project.'))
    assert response.status_code==200,response.text
    p=response.json()
    assert not p['team_confirmation']['confirmed']
    invitation=next(m for m in p['team'] if m['worker_id']=='shop')
    p=cmd(api,p,'accept',uid='shop',target_id=invitation['id']).json()
    assert p['membership']['joining_status']=='accepted'
    assert not p['capabilities']['can_record_attendance']
    assert not p['capabilities']['can_view_team']
    p=get(p['id']);p=cmd(api,p,'confirm_joining',target_id='shop').json();p=cmd(api,p,'confirm_team').json()
    assert p['team_confirmation']['confirmed'] and p['team_confirmation']['confirmation_id']!=old_confirmation


def test_legacy_ongoing_membership_requires_recorded_work_evidence_not_status_alone():
    now=time.time()
    member=dict(id='old-offer',worker_id='old-agent',status='accepted',accepted_at=now-100,role='member')
    p=dict(id='legacy',owner_id='owner',status='active',team=[member],goals=[],attendance=[],leave=[],events=[dict(action='start',at=now-50)])
    assert cw.joining_confirmed(p,member) and cw.team_confirmation_current(p)
    late={**member,'id':'new-offer','worker_id':'new-agent','accepted_at':now,'joining_status':'accepted'}
    p['team'].append(late)
    assert not cw.joining_confirmed(p,late) and not cw.team_confirmation_current(p)
    del late['joining_status'] # corrupted/old shape still cannot infer joining after start
    assert not cw.joining_confirmed(p,late)
    missing={**p,'team':[member],'events':[]}
    assert not cw.joining_confirmed(missing,member) and not cw.team_confirmation_current(missing)
    missing['attendance']=[dict(worker_id='old-agent',in_at=now-40)]
    assert cw.joining_confirmed(missing,member) and cw.team_confirmation_current(missing)


def test_tender_awaiting_award_keeps_hr_locked_after_internal_confirmation(api):
    p=accepted(api,live=True);p=confirm_team(api,p)
    p=get(p['id']);p['tender_id']='unawarded-tender';put(p)
    worker=view(api,p)
    assert worker['team_confirmation']['confirmed'] and worker['capabilities']['can_view_team']
    assert not worker['capabilities']['can_request_leave'] and not worker['capabilities']['can_record_attendance']
    assert cmd(api,p,'start').status_code==409
    assert cmd(api,p,'leave_request',uid='worker2',starts_at=time.time()+500,ends_at=time.time()+1000,note='Personal appointment').status_code==409


def test_credibility_counts_recorded_outcomes_without_private_project_content(api):
    p=accepted(api)
    past=copy.deepcopy(p);past.update(id='past-private-project',status='completed',title='PRIVATE CUSTOMER PROJECT',site='PRIVATE CUSTOMER ADDRESS',client_id='PRIVATE CUSTOMER ID',budget_paise=999999999)
    past['goals']=[dict(id='approved',title='PRIVATE GOAL TITLE',status='approved'),dict(id='planned',status='planned')]
    put(past)
    worker=view(api,p);record=worker['contractor']
    assert record['completed_projects']==1 and record['approved_milestones']==1 and record['total_milestones']==2
    assert record['approved'] and record['verified']
    for private in ('PRIVATE CUSTOMER PROJECT','PRIVATE CUSTOMER ADDRESS','PRIVATE CUSTOMER ID','PRIVATE GOAL TITLE','999999999'):
        assert private not in json.dumps(record)


def test_multi_member_confirmation_reads_each_conflict_collection_once_per_transaction(api,monkeypatch):
    from operations import Unit
    p=two_members(api)
    for worker in ('worker2','shop'):
        p=cmd(api,p,'confirm_joining',target_id=worker).json()
    original=Unit.all;units=[]
    def tracked(unit,kind):
        if not hasattr(unit,'_scan_counts_for_test'):
            unit._scan_counts_for_test={};units.append(unit)
        unit._scan_counts_for_test[kind]=unit._scan_counts_for_test.get(kind,0)+1
        return original(unit,kind)
    monkeypatch.setattr(Unit,'all',tracked)
    response=cmd(api,p,'confirm_team')
    assert response.status_code==200,response.text
    sources=[u._scan_counts_for_test for u in units if 'home_plans' in u._scan_counts_for_test]
    assert len(sources)==1
    assert {kind:sources[0].get(kind) for kind in ('contract_projects','home_plans','jobs')}==dict(contract_projects=1,home_plans=1,jobs=1)


def test_last_members_new_schedule_conflict_rejects_team_confirmation_atomically(api):
    p=two_members(api)
    for worker in ('worker2','shop'):
        p=cmd(api,p,'confirm_joining',target_id=worker).json()
    # A different native writer can reserve work between joining and final
    # formation. The final review must re-read it, not reuse an earlier command.
    main.operations_store.run(lambda u:u.put('jobs','later-reserved-service',dict(
        id='later-reserved-service',worker_id='shop',customer_id='different-customer',
        service_id='site-service',state='accepted',starts_epoch=p['starts_at']+60,duration_minutes=120)))
    before=get(p['id'])
    response=cmd(api,p,'confirm_team')
    assert response.status_code==409,response.text
    assert response.json()['detail']['code']=='SCHEDULE_CONFLICT'
    after=get(p['id'])
    assert after['version']==before['version'] and not cw.team_confirmation_current(after)
    assert not any(e['action']=='confirm_team' for e in after['events'])
