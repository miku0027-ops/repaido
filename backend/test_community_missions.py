"""Real mission API ownership, evidence, deadlines and shared points tests."""
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import main
from test_operations import api, auth, ADMIN
from test_local_business import doc

BASE='/operations/local-business/missions'


def mission(api, **changes):
    mid=uuid.uuid4().hex
    body=dict(title='Repair and reuse workshop',kind='repair_knowledge',city='Balasore',
              instructions='Document a repair you carried out with clear safety limits and manufacturer instructions.',
              evidence_requirements='Upload your own repair photo and explain the verified result.',
              starts_at=time.time()-60,ends_at=time.time()+86400,active=True,expected_version=0)
    body.update(changes)
    result=api.put(BASE+'/admin/'+mid,headers=ADMIN,json=body)
    assert result.status_code==200,result.text
    return result.json(),body


def join(api,mid,uid='customer'):
    response=api.post(BASE+'/'+mid+'/join',headers=auth(uid),json={})
    assert response.status_code==200,response.text
    return response.json()


def submit(api,row,uid='customer',status=200,**changes):
    body=dict(request_id=str(uuid.uuid4()),expected_version=row['version'],
              note='I completed the specified repair and recorded the condition and safe checks in the attached evidence.',
              document_ids=[doc(uid)],knowledge_text='Always isolate the power and follow the manufacturer instructions. I cleaned the removable filter and checked its condition. Electrical faults require a qualified professional.',publish_knowledge=False)
    if row['kind']=='reuse_drive':body.update(knowledge_text='',publish_knowledge=False)
    body.update(changes)
    result=api.post(BASE+'/contributions/'+row['id']+'/submit',headers=auth(uid),json=body)
    assert result.status_code==status,result.text
    return result.json(),body


def review(api,row,decision='verified',status=200,**changes):
    body=dict(request_id=str(uuid.uuid4()),expected_version=row['version'],decision=decision,
              note='Independently checked the original evidence and confirmed the mission requirements.',evidence_reference='review-receipt-123')
    body.update(changes)
    result=api.post(BASE+'/admin/contributions/'+row['id']+'/review',headers=ADMIN,json=body)
    assert result.status_code==status,result.text
    return result.json(),body


def test_real_mission_review_points_knowledge_consent_and_withdrawal(api):
    assert api.get(BASE).json()['missions']==[]
    m,_=mission(api)
    row=join(api,m['id'])
    assert join(api,m['id'])['id']==row['id']
    assert main.operations_store.run(lambda u:u.find('cleanup_points','user_id','customer'))==[]
    submitted,body=submit(api,row,publish_knowledge=True)
    assert api.post(BASE+'/contributions/'+row['id']+'/submit',headers=auth('customer'),json=body).json()['version']==submitted['version']
    assert api.get(BASE+'/'+m['id']+'/knowledge').json()['contributions']==[]
    saved,decision=review(api,submitted)
    assert saved['state']=='verified' and saved['points']==10
    again=api.post(BASE+'/admin/contributions/'+row['id']+'/review',headers=ADMIN,json=decision)
    assert again.status_code==200
    awards=main.operations_store.run(lambda u:u.find('cleanup_points','user_id','customer'))
    assert len(awards)==1 and awards[0]['source']=='repair_knowledge'
    public=api.get(BASE+'/'+m['id']+'/knowledge').json()['contributions']
    assert len(public)==1 and 'user_id' not in public[0] and 'document_ids' not in public[0]
    assert api.delete(BASE+'/contributions/'+row['id']+'/knowledge',headers=auth('stranger')).status_code==404
    assert api.delete(BASE+'/contributions/'+row['id']+'/knowledge',headers=auth('customer')).status_code==200
    assert api.get(BASE+'/'+m['id']+'/knowledge').json()['contributions']==[]
    assert len(main.operations_store.run(lambda u:u.find('cleanup_points','user_id','customer')))==1


def test_scope_snapshot_deadline_owned_fresh_evidence_and_admin_boundary(api):
    m,body=mission(api)
    row=join(api,m['id'])
    assert api.put(BASE+'/admin/'+m['id'],headers=auth('customer'),json=body).status_code==403
    changed={**body,'expected_version':1,'instructions':'New instructions that should not rewrite the already accepted mission scope.'}
    assert api.put(BASE+'/admin/'+m['id'],headers=ADMIN,json=changed).status_code==200
    own=api.get(BASE+'/mine',headers=auth('customer')).json()['contributions'][0]
    assert own['mission']['instructions']==body['instructions']
    submit(api,row,document_ids=[doc('worker')],status=422)
    submitted,payload=submit(api,row)
    another,_=mission(api)
    second=join(api,another['id'])
    submit(api,second,document_ids=payload['document_ids'],status=409)
    assert api.post(BASE+'/contributions/'+row['id']+'/submit',headers=auth('stranger'),json=payload).status_code==404
    late=join(api,another['id'],uid='worker')
    main.operations_store.run(lambda u:u.put('community_contributions',late['id'],{**late,'submit_by':time.time()-1}))
    submit(api,late,uid='worker',status=409)


def test_rework_and_appeal_preserve_history_and_require_independent_review(api):
    m,_=mission(api,kind='reuse_drive')
    row=join(api,m['id'])
    row,_=submit(api,row)
    review(api,row,decision='rework',status=422)
    row,_=review(api,row,decision='rework',resubmit_by=time.time()+86400)
    assert row['state']=='rework' and row['points']==0
    row,_=submit(api,row)
    row,_=review(api,row,decision='rejected')
    payload=dict(request_id=str(uuid.uuid4()),expected_version=row['version'],reason='The recipient receipt confirms the reused item handover and needs review.')
    response=api.post(BASE+'/contributions/'+row['id']+'/appeal',headers=auth('customer'),json=payload)
    assert response.status_code==200,response.text
    row=response.json()
    assert row['state']=='appealed'
    # An operator cannot verify their own contribution even when authenticated.
    main.app.dependency_overrides[main.operator]=lambda:{'id':'customer'}
    review(api,row,status=403)
    main.app.dependency_overrides.pop(main.operator)
    row,_=review(api,row)
    assert row['points']==10 and len(row['history'])==6
    assert api.get(BASE+'/'+m['id']+'/knowledge').json()['contributions']==[]


def test_shared_daily_limit_is_atomic_across_racing_mission_awards(api):
    def existing(u):
        for index in range(4):
            u.put('cleanup_points','earlier-'+str(index),dict(id='earlier-'+str(index),source='cleanup',user_id='customer',points=10,created_at=time.time()))
    main.operations_store.run(existing)
    rows=[]
    for _ in range(2):
        m,_=mission(api,kind='reuse_drive')
        row=join(api,m['id'])
        rows.append(submit(api,row)[0])
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda row:review(api,row)[0],rows))
    assert sorted(row['points'] for row in results)==[0,10]
    awards=main.operations_store.run(lambda u:u.find('cleanup_points','user_id','customer'))
    assert sum(row['points'] for row in awards)==50


def test_board_and_queue_bounded_without_global_scans(api,monkeypatch):
    m,_=mission(api)
    row=join(api,m['id'])
    submit(api,row)
    import operations
    monkeypatch.setattr(operations.Unit,'all',lambda *_:(_ for _ in ()).throw(AssertionError('No global collection scan')))
    assert len(api.get(BASE).json()['missions'])==1
    assert len(api.get(BASE+'/mine',headers=auth('customer')).json()['contributions'])==1
    assert len(api.get(BASE+'/admin/contributions',headers=ADMIN).json()['contributions'])==1
