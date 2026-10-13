import time,uuid
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor
import main
from test_operations import api,auth,ADMIN,PIN
from test_local_business import register,doc
BASE='/operations/local-business/cleanup'
def report(api,uid='customer',**extra):
    body=dict(request_id=str(uuid.uuid4()),category='dry_recyclables',description='Discarded cardboard beside the public path',address='Public footpath near test park gate',city='Balasore',location=PIN,document_ids=[doc(uid)],public_place=True);body.update(extra)
    return api.post(BASE+'/reports',headers=auth(uid),json=body),body

def command(api,row,action,uid='customer',admin=False,**extra):
    body=dict(action=action,expected_version=row['version'],command_id=str(uuid.uuid4()),note='Test independent review and evidence checked');body.update(extra)
    return api.post(f'{BASE}/{"admin" if admin else "reports"}/{row["id"]}/actions',headers=ADMIN if admin else auth(uid),json=body),body

def stage(api,reward=5000):
    register(api,'worker','scrap_owner')
    r,_=report(api);assert r.status_code==201,r.text;row=r.json()
    r,_=command(api,row,'approve',admin=True,reference='municipal-permission-123',reward_paise=reward,funding_reference='repaido-budget-123');assert r.status_code==200,r.text
    r,_=command(api,r.json(),'accept','worker');assert r.status_code==200,r.text
    return r.json()

def submitted(api):
    row=stage(api)
    r,_=command(api,row,'submit','worker',document_ids=[doc('worker')],position={**PIN,'accuracy':5,'captured_at':time.time()},note='Cleaned and delivered to authorised recycling centre 123')
    assert r.status_code==200,r.text;return r.json()

def test_full_lifecycle_points_and_repaido_cash_receipt(api):
    row=submitted(api)
    assert api.get(BASE+'/reports',headers=auth('customer')).json()['points']==0
    r,body=command(api,row,'verify',admin=True);assert r.status_code==200,r.text;row=r.json()
    replay=api.post(f'{BASE}/admin/{row["id"]}/actions',headers=ADMIN,json=body);assert replay.status_code==200
    summary=api.get(BASE+'/reports',headers=auth('customer')).json();assert summary['points']==10 and summary['verified_cleanups']==1
    assert summary['reports'][0]['payment_state']=='approved'
    assert 'funding_reference' not in summary['reports'][0] and 'authority_reference' not in summary['reports'][0]
    r,_=command(api,row,'record_cash','worker',reference='cash-receipt-123');assert r.status_code==409
    r,_=command(api,row,'record_cash',admin=True,reference='cash-receipt-123');assert r.status_code==200,r.text;row=r.json()
    r,_=command(api,row,'received','stranger');assert r.status_code==409
    r,_=command(api,row,'received');assert r.status_code==200 and r.json()['payment_state']=='received'

def test_reporting_replay_duplicate_and_private_document_ownership(api):
    r,body=report(api);assert r.status_code==201
    assert api.post(BASE+'/reports',headers=auth('customer'),json=body).json()['id']==r.json()['id']
    changed={**body,'description':'Changed details of the same request'}
    assert api.post(BASE+'/reports',headers=auth('customer'),json=changed).status_code==409
    duplicate,_=report(api,'stranger');assert duplicate.status_code==409
    r,_=report(api,location={'lat':21.6,'lng':86.9},document_ids=[doc('worker')]);assert r.status_code==422

def test_unapproved_actor_and_no_self_collection(api):
    r,_=report(api);row=r.json()
    assert command(api,row,'approve')[0].status_code==409
    assert api.get(BASE+'/admin',headers=auth('customer')).status_code==403
    assert api.get(BASE+'/collector',headers=auth('customer')).status_code==403
    register(api,'worker','scrap_owner')
    assert command(api,row,'accept','worker')[0].status_code==409
    r,_=report(api,'worker',location={'lat':21.51,'lng':86.91});row=r.json()
    row=command(api,row,'approve',admin=True,reference='permission-case-123')[0].json()
    assert command(api,row,'accept','worker')[0].status_code==409

def test_hazardous_requires_authority_referral_and_no_rewards(api):
    r,_=report(api,category='hazardous');row=r.json()
    assert command(api,row,'approve',admin=True,reference='permission-123')[0].status_code==409
    r,_=command(api,row,'refer',admin=True,reference='authority-case-123');assert r.status_code==200
    assert r.json()['state']=='referred' and r.json()['points']==0 and r.json()['reward_paise']==0

def test_cash_requires_funding_reference_and_verified_cleanup(api):
    r,_=report(api);row=r.json()
    assert command(api,row,'approve',admin=True,reward_paise=1000,reference='permission-123')[0].status_code==409
    assert command(api,row,'record_cash',admin=True,reference='cash-case-123')[0].status_code==409
    assert command(api,row,'approve',admin=True,reference='permission-123')[0].json()['payment_state']=='not_offered'

def test_geofence_fresh_evidence_and_rework(api):
    row=stage(api);photo=doc('worker')
    assert command(api,row,'submit','worker',document_ids=[photo])[0].status_code==409
    assert command(api,row,'submit','worker',document_ids=[photo],position={**PIN,'lat':22,'accuracy':5,'captured_at':time.time()})[0].status_code==409
    assert command(api,row,'submit','worker',document_ids=[photo],position={**PIN,'accuracy':5,'captured_at':time.time()-300})[0].status_code==409
    r,_=command(api,row,'submit','worker',document_ids=[photo],position={**PIN,'accuracy':5,'captured_at':time.time()});assert r.status_code==200
    r,_=command(api,r.json(),'rework',admin=True);assert r.status_code==200;row=r.json()
    assert command(api,row,'submit','worker',document_ids=[photo],position={**PIN,'accuracy':5,'captured_at':time.time()})[0].status_code==409
    assert api.get(BASE+'/reports',headers=auth('customer')).json()['points']==0

def test_exclusive_assignment_under_concurrency(api):
    register(api,'worker','scrap_owner');register(api,'worker2','scrap_owner')
    r,_=report(api);row=command(api,r.json(),'approve',admin=True,reference='permission-123')[0].json()
    with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda uid:command(api,row,'accept',uid)[0].status_code,['worker','worker2']))
    assert sorted(results)==[200,409]

def test_private_evidence_and_history_access(api):
    row=stage(api);path=f'{BASE}/reports/{row["id"]}/photos/{row["document_ids"][0]}'
    assert api.get(path,headers=auth('stranger')).status_code in (403,404)
    with patch('cleanup.download_object',return_value=b'photo'):
        assert api.get(path,headers=auth('customer')).content==b'photo'
        assert api.get(path,headers=auth('worker')).status_code==200
        assert api.get(f'{BASE}/admin/{row["id"]}/photos/{row["document_ids"][0]}',headers=ADMIN).status_code==200
    assert api.get(BASE+'/reports',headers=auth('stranger')).json()['reports']==[]

def test_payment_concern_cannot_be_confirmed_by_admin(api):
    row=submitted(api);row=command(api,row,'verify',admin=True)[0].json();row=command(api,row,'record_cash',admin=True,reference='cash-receipt-123')[0].json()
    row=command(api,row,'payment_concern',note='No cash was handed to me today')[0].json();assert row['payment_state']=='disputed'
    assert command(api,row,'received',admin=True)[0].status_code==409
    row=command(api,row,'resolve_payment',admin=True,reference='review-case-123')[0].json();assert row['payment_state']=='reported'
    assert command(api,row,'received')[0].json()['payment_state']=='received'

def test_cancel_and_photo_reuse_do_not_earn_points(api):
    r,body=report(api);row=r.json();assert command(api,row,'cancel')[0].json()['state']=='cancelled'
    r,_=report(api,document_ids=body['document_ids']);assert r.status_code==409
    assert api.get(BASE+'/reports',headers=auth('customer')).json()['points']==0

def test_captain_threshold_and_daily_report_limit(api):
    def seed(u):
        for i in range(10):u.put('cleanup_points',str(i),{'user_id':'customer','points':10,'created_at':time.time()})
    main.operations_store.run(seed)
    result=api.get(BASE+'/reports',headers=auth('customer')).json();assert result['badge']=='Swachh Bharat Captain · Gold' and result['points']==100
    for i in range(5):assert report(api,location={'lat':21.49+i*.01,'lng':86.91})[0].status_code==201
    assert report(api,location={'lat':21.9,'lng':86.91})[0].status_code==429

def test_admin_queue_is_bounded_and_cursor_keeps_reports_reachable(api):
    def seed(u):
        for i in range(55):
            identifier=f'{i:064x}'
            u.put('cleanup_reports',identifier,{'id':identifier,'state':'reported','queue':'active','customer_id':'customer','version':1})
        u.put('cleanup_reports','f'*64,{'id':'f'*64,'state':'cancelled','queue':'history','customer_id':'customer','version':1})
    main.operations_store.run(seed)
    first=api.get(BASE+'/admin',headers=ADMIN).json();assert len(first['reports'])==50
    second=api.get(BASE+'/admin?cursor='+first['next_cursor'],headers=ADMIN).json();assert len(second['reports'])==5 and second['next_cursor'] is None
    assert len({x['id'] for x in first['reports']+second['reports']})==55
    assert len(api.get(BASE+'/admin?history=true',headers=ADMIN).json()['reports'])==1

def test_concurrent_duplicate_reports_share_one_spot(api):
    with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda uid:report(api,uid)[0].status_code,['customer','stranger']))
    assert sorted(results)==[201,409]

def test_admin_cannot_verify_own_collection(api):
    row=submitted(api)
    main.app.dependency_overrides[main.operator]=lambda:{'id':'worker'}
    try:assert command(api,row,'verify',admin=True)[0].status_code==409
    finally:main.app.dependency_overrides.pop(main.operator)
    assert api.get(BASE+'/reports',headers=auth('customer')).json()['points']==0

def test_released_task_can_be_reassigned_without_reward_or_points_changes(api):
    row=stage(api);register(api,'worker2','scrap_owner')
    row=command(api,row,'release','worker',note='Unable to access site during current collection round')[0].json()
    assert row['state']=='approved' and row['owner_id'] is None and row['reward_paise']==5000
    row=command(api,row,'accept','worker2')[0].json();assert row['owner_id']=='worker2'
    row=command(api,row,'reassign',admin=True)[0].json();assert row['owner_id'] is None
    assert api.get(BASE+'/reports',headers=auth('customer')).json()['points']==0
