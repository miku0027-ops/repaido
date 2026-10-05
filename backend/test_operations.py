"""Real HTTP/domain tests against an isolated database; no cloud or gateway calls."""
import time
import uuid
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
import pytest
from fastapi import Header, HTTPException
from fastapi.testclient import TestClient
import main

PIN = {'lat': 21.4934, 'lng': 86.9135}
ADMIN = {'X-Admin-Key': 'test-operator-key'}


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.setattr(main, 'DB_PATH', str(tmp_path/'operations.db'))
    monkeypatch.setattr(main, 'USE_FIRESTORE', False)
    monkeypatch.setattr(main, 'fb_db', None)
    monkeypatch.setenv('REPAIDO_ADMIN_KEY', 'test-operator-key')
    def actor(authorization: str = Header(default='')):
        uid = authorization.removeprefix('Bearer ')
        if uid not in ('customer', 'worker', 'worker2', 'stranger', 'shop'): raise HTTPException(401)
        return {'id': uid, 'name': uid, 'phone': '+919876543210', 'phone_verified': uid.startswith('worker') or uid=='shop', 'phone_authenticated': uid.startswith('worker') or uid=='shop'}
    main.app.dependency_overrides[main.current_user] = actor
    with TestClient(main.app) as client:
        yield client
    main.app.dependency_overrides.clear()


def auth(uid): return {'Authorization': 'Bearer '+uid}


def onboard(api, uid='worker', approve=True, pin=PIN):
    body = dict(name='Test professional', dob='1995-01-01', city='Balasore', home_address='Private test home address', location=pin,
                requested_role='specialist', categories=['ac'], skills=['AC service'], tools=['Service toolkit'], experience_years=4, radius_km=6, terms_version='field-service-v1')
    p=api.get('/operations/partner-policy').json();body.update(partner_policy_version=p['version'],partner_policy_sections=[s['id'] for s in p['sections']])
    r = api.post('/operations/worker/onboarding', headers=auth(uid), json=body)
    assert r.status_code == 200, r.text
    assert r.json()['worker']['role'] == 'technician'
    if approve:
        # Test-only evidence. Production approval requires real private review.
        main.operations_store.run(lambda u: u.put('verification', uid, {'worker_id':uid, 'identity_status':'approved', 'bank_status':'verified', 'fund_account_id':'fa_test'}))
        r = api.post(f'/operations/admin/workers/{uid}/review', headers=ADMIN, json={'decision':'approved','role':'technician','reason':'Test fixture manual verification','evidence_reference':'test-only-evidence'})
        assert r.status_code == 200, r.text
        online = api.post('/operations/worker/availability', headers=auth(uid), json={'online':True,'position':{**pin,'accuracy':5,'captured_at':time.time()}})
        assert online.status_code == 200, online.text
    return body


def book(api, **changes):
    body=dict(service_id='ac-service', city='Balasore', address='Customer service address 123', phone='9876543210', location=PIN,
              starts_at=datetime.fromtimestamp(time.time()+4000,timezone.utc).isoformat(), idempotency_key=str(uuid.uuid4()))
    body.update(changes)
    r=api.post('/operations/bookings', headers=auth('customer'), json=body)
    assert r.status_code == 201, r.text
    # Legacy regression fixtures retain v1 procurement. New v2 tests exercise real OTP/order gates separately.
    j=r.json()
    def legacy(u):
        row=u.get('jobs',j['id']);row['procurement_version']=1;u.put('jobs',j['id'],row)
    main.operations_store.run(legacy)
    j['procurement_version']=1
    return j, body


def command(api, job, action, uid='worker', payload=None, key=None, status=200):
    if status==200 and action in ('start','submit_completion'):
        def seed_evidence(u):
            j=u.get('jobs',job['id']);eid=str(uuid.uuid4());kind='before' if action=='start' else 'after'
            u.put('evidence',eid,dict(id=eid,kind=kind,status='ready',job_id=j['id'],visit_id=j['visit_id'],worker_id=j['worker_id'],captured_at=time.time(),test_fixture=True))
            j.setdefault('evidence_ids',[]).append(eid);u.put('jobs',j['id'],j)
        main.operations_store.run(seed_evidence)
    r=api.post(f"/operations/jobs/{job['id']}/commands", headers=auth(uid), json={'action':action,'expected_version':job['version'],'command_id':key or str(uuid.uuid4()),'payload':payload or {}})
    assert r.status_code == status, r.text
    return r.json()


def started(api):
    onboard(api)
    j,_=book(api)
    j=command(api,j,'accept')
    j=command(api,j,'ack_reminder')
    j=command(api,j,'depart')
    j=command(api,j,'position',payload={**PIN,'accuracy':5,'captured_at':time.time()})
    assert j['state']=='arrived' and 'phone' in j
    return command(api,j,'start')


def test_phone_and_approval_boundaries(api):
    assert api.get('/operations/worker/me',headers=auth('customer')).status_code==403
    body=onboard(api,approve=False)
    assert api.post('/operations/worker/onboarding',headers=auth('worker'),json={**body,'status':'approved'}).status_code==422
    assert api.post('/operations/worker/availability',headers=auth('worker'),json={'online':True}).status_code==403
    assert api.get('/operations/admin/workers',headers=auth('worker')).status_code==403
    assert api.get('/operations/professionals').json()['professionals']==[]


def test_no_candidate_retry_and_no_fabricated_assignment(api):
    j,body=book(api)
    assert j['state']=='searching' and j['worker_id'] is None
    again=api.post('/operations/bookings',headers=auth('customer'),json=body)
    assert again.json()['id']==j['id']
    assert api.post('/operations/bookings',headers=auth('customer'),json={**body,'address':'Changed street address'}).status_code==409
    onboard(api)
    j=api.get(f"/operations/jobs/{j['id']}",headers=auth('customer')).json()
    assert j['worker_id']=='worker'


def test_radius_privacy_and_rejection_rematching(api):
    onboard(api,pin={'lat':22,'lng':87})
    j,_=book(api)
    assert j['state']=='searching'
    onboard(api,'worker2')
    j=api.get(f"/operations/jobs/{j['id']}",headers=auth('customer')).json()
    offered=api.get(f"/operations/jobs/{j['id']}",headers=auth('worker2')).json()
    assert 'phone' not in offered and 'address' not in offered and 'location' not in offered
    assert api.get(f"/operations/jobs/{j['id']}",headers=auth('stranger')).status_code==404
    j=command(api,j,'decline','worker2')
    assert j['state']=='released'
    assert api.get(f"/operations/jobs/{j['id']}",headers=auth('customer')).json()['state']=='searching'


def test_complete_loop_approval_gps_completion_review(api):
    j=started(api)
    command(api,j,'review','customer',{'rating':5},status=409)
    j=command(api,j,'submit_completion',payload={'notes':'Cleaned and checked operation.'})
    command(api,j,'accept_completion','worker',status=409)
    j=command(api,j,'accept_completion','customer')
    assert j['state']=='completed' and j['payout_status']=='held'
    assert 'position' not in j
    j=command(api,j,'review','customer',{'rating':2,'text':'Arrived late but completed the work.'})
    command(api,j,'review','customer',{'rating':5},status=409)
    w=api.get('/operations/worker/me',headers=auth('worker')).json()['worker']
    assert w['rating_sum']==2 and w['rating_count']==1 and w['completed_tasks']==1
    assert w['role']=='technician' and not w['has_specialist_kit']


def test_gps_accuracy_freshness_and_wrong_actor(api):
    onboard(api);j,_=book(api);j=command(api,j,'accept');j=command(api,j,'ack_reminder');j=command(api,j,'depart')
    command(api,j,'position',payload={**PIN,'accuracy':5,'captured_at':time.time()-200},status=409)
    j=command(api,j,'position',payload={**PIN,'accuracy':90,'captured_at':time.time()})
    assert 'phone' not in j and 'start' not in j['allowed_actions']
    command(api,j,'start',status=409)
    command(api,j,'position','customer',{**PIN,'accuracy':5,'captured_at':time.time()},status=409)


def test_simultaneous_accept_and_idempotent_replay(api):
    onboard(api);j,_=book(api)
    body={'action':'accept','expected_version':j['version'],'command_id':str(uuid.uuid4()),'payload':{}}
    def accept(_):return api.post(f"/operations/jobs/{j['id']}/commands",headers=auth('worker'),json=body)
    with ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(accept,range(2)))
    assert all(r.status_code==200 for r in results)
    assert results[0].json()['version']==results[1].json()['version']==2
    assert api.post(f"/operations/jobs/{j['id']}/commands",headers=auth('worker'),json={**body,'action':'decline'}).status_code==409


def test_parts_need_approval_inventory_and_shop_handover(api):
    j=started(api)
    assert api.post('/operations/admin/shops',headers=ADMIN,json={'id':'shop1','owner_id':'shop','name':'Test fixture shop','location':PIN,'status':'approved','evidence_reference':'test-only-verified-shop'}).status_code==200
    assert api.post('/operations/admin/inventory',headers=ADMIN,json={'id':'part1','name':'Test capacitor','shop_id':'shop1','price_paise':5000,'stock':2,'status':'approved'}).status_code==200
    j=command(api,j,'propose_parts',payload={'items':[{'product_id':'part1','quantity':1}]})
    assert j['total_paise']==59900
    command(api,j,'collect_parts',status=409)
    command(api,j,'approve_parts','worker',{'proposal_id':j['proposal']['id']},status=409)
    j=command(api,j,'approve_parts','customer',{'proposal_id':j['proposal']['id']})
    assert j['total_paise']==64900 and len(j['scopes'])==2
    command(api,j,'collect_parts',status=409)
    assert api.post(f"/operations/shop/orders/{j['id']}/handover",headers=auth('stranger')).status_code==403
    assert api.post(f"/operations/shop/orders/{j['id']}/handover",headers=auth('shop')).status_code==200
    j=api.get(f"/operations/jobs/{j['id']}",headers=auth('worker')).json()
    j=command(api,j,'collect_parts')
    j=command(api,j,'position',payload={**PIN,'accuracy':5,'captured_at':time.time()})
    j=command(api,j,'return_to_site')
    assert j['proposal']['status']=='received'
    command(api,j,'submit_completion',payload={'notes':'Cannot complete uninstalled work'},status=409)
    j=command(api,j,'install_parts')
    assert j['proposal']['status']=='installed'
    assert api.get('/operations/inventory',headers=auth('worker')).json()['items'][0]['stock']==1


def test_scheduler_penalties_exactly_once_and_outbox(api):
    onboard(api);j,_=book(api);j=command(api,j,'accept')
    def overdue(u):
        state=u.get('jobs',j['id']);state['reminder_at']=time.time()-601;state['starts_epoch']=time.time()+1700;u.put('jobs',state['id'],state)
    main.operations_store.run(overdue)
    main.operations_tick();main.operations_tick()
    j=api.get(f"/operations/jobs/{j['id']}",headers=auth('worker')).json()
    assert len(j['penalties'])==2
    assert j['penalties'][0]['current_percent']==10 and j['penalties'][0]['next_task_percent']==20
    outbox=main.operations_store.run(lambda u:u.all('outbox'))
    assert len([e for e in outbox if e['event_type']=='PenaltyAssessed'])==2
    assert all(e['delivery_status']=='pending' for e in outbox)


def test_reschedule_invalidates_old_commands_cancel_and_dispute(api):
    onboard(api);j,_=book(api);accepted=command(api,j,'accept')
    changed=command(api,accepted,'reschedule','customer',{'starts_at':datetime.fromtimestamp(time.time()+90000,timezone.utc).isoformat()})
    command(api,accepted,'depart',status=409)
    assert changed['visit_id']!=accepted['visit_id']
    j=command(api,changed,'cancel','customer')
    assert j['state']=='cancelled'
    command(api,j,'accept',status=409)


def test_storage_reinitialization_preserves_records(api):
    j,_=book(api)
    main.operations_store.init()
    assert api.get(f"/operations/jobs/{j['id']}",headers=auth('customer')).json()['id']==j['id']


def test_public_projection_omits_phone_home_and_identity(api):
    onboard(api)
    rows=api.get('/technicians',params={'city':'Balasore'}).json()['technicians']
    assert len(rows)==1
    for key in ('phone','location','home_address','dob','evidence_reference'):
        assert key not in rows[0]
    nearby=api.post('/operations/professionals/search',json={'location':PIN,'city':'Balasore','radius_km':6}).json()
    assert len(nearby['professionals'])==1 and nearby['distance_type']=='straight_line'
    assert 'location' not in nearby['professionals'][0]


def test_late_ack_before_scheduler_does_not_erase_penalty(api):
    onboard(api);j,_=book(api);j=command(api,j,'accept')
    def overdue(u):
        state=u.get('jobs',j['id']);state['reminder_at']=time.time()-601;u.put('jobs',state['id'],state)
    main.operations_store.run(overdue)
    j=command(api,j,'ack_reminder')
    assert [p['code'] for p in j['penalties']]==['MISSED_REMINDER']
    main.operations_tick()
    j=api.get(f"/operations/jobs/{j['id']}",headers=auth('worker')).json()
    assert len(j['penalties'])==1


def test_dispute_holds_work_without_completing_or_rating(api):
    j=started(api)
    j=command(api,j,'submit_completion',payload={'notes':'Finished inspection and cleaning.'})
    j=command(api,j,'dispute','customer',{'reason':'Cooling problem remains unresolved.'})
    assert j['state']=='disputed' and j['payout_status']=='held'
    command(api,j,'accept_completion','customer',status=409)
    command(api,j,'review','customer',{'rating':5},status=409)


def test_dispatch_does_not_prefer_junior_role_over_verified_quality(api):
    onboard(api);onboard(api,'worker2')
    def quality(u):
        w=u.get('workers','worker2');w.update(role='specialist',rating_count=8,rating_sum=36,completed_tasks=8);u.put('workers','worker2',w)
    main.operations_store.run(quality)
    j,_=book(api)
    assert j['worker_id']=='worker2'


@pytest.mark.parametrize('city',['Balasore','balasore',' BALASORE '])
def test_onboarding_normalizes_supported_city(api,city):
    body=onboard(api,approve=False)
    body['city']=city
    r=api.post('/operations/worker/onboarding',headers=auth('worker'),json=body)
    assert r.status_code==200,r.text
    assert r.json()['worker']['city']=='Balasore'
    assert r.json()['worker']['status']=='pending_verification'


def test_onboarding_rejects_unsupported_city_without_overwriting_profile(api):
    body=onboard(api,approve=False);body['city']='Not a supported city'
    r=api.post('/operations/worker/onboarding',headers=auth('worker'),json=body)
    assert r.status_code==422
    assert r.json()['detail']['code']=='OUTSIDE_COVERAGE'
    assert api.get('/operations/worker/me',headers=auth('worker')).json()['worker']['city']=='Balasore'
