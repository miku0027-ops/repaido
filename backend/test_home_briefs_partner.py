import copy,time,uuid
import main,home_briefs,partner_program as partner
from test_operations import api,auth,ADMIN,onboard
from test_home_plans import request,setup_worker,quote

def test_service_brief_schemas_and_pdf_access(api):
    for sid in home_briefs.SCHEMAS:
        p,b=request(api,service_id=sid,duration='trial7' if sid in ('maid','caretaker') else 'project')
        assert len(p['brief_rows'])==len(home_briefs.SCHEMAS[sid])
        bad={**b,'request_id':str(uuid.uuid4()),'requirements':{}}
        assert api.post('/operations/home/plans',headers=auth('customer'),json=bad).status_code==422
        bad['requirements']={**b['requirements'],'unexpected':'wrong service field'}
        assert api.post('/operations/home/plans',headers=auth('customer'),json=bad).status_code==422
        path=f"/operations/home/plans/{p['id']}/brief.pdf"
        assert api.get(path,headers=auth('stranger')).status_code==404
        pdf=api.get(path,headers=auth('customer'));assert pdf.status_code==200 and pdf.content.startswith(b'%PDF') and pdf.headers['cache-control']=='no-store'
    setup_worker(api);p,b=request(api);p=quote(api,p)
    assert api.get(f"/operations/home/plans/{p['id']}/brief.pdf",headers=auth('worker')).status_code==200
    view=api.get('/operations/home/plans',headers=auth('worker')).json()['plans'][0]
    assert view['requirements']==b['requirements'] and view['instructions']==b['instructions']
    assert 'phone' not in view and 'address' not in view

def test_contractors_need_agreement_identity_review_and_versions(api):
    body=onboard(api,approve=False)
    body['partner_policy_sections']=[]
    assert api.post('/operations/worker/onboarding',headers=auth('worker'),json=body).status_code==422
    application=dict(expected_version=0,business_name='Test Builder',team_size=4,experience='Completed supervised projects and refurbishment work.',qualifications='Trade certifications reviewed through private evidence.',scope='Building works, finishing and supervised team coordination.')
    url='/operations/worker/contractor-application'
    assert api.post(url,headers=auth('customer'),json=application).status_code==403
    a=api.post(url,headers=auth('worker'),json=application);assert a.status_code==200
    assert api.post(url,headers=auth('worker'),json=application).status_code==409
    review=dict(expected_version=1,decision='approved',reason='Experience and evidence reviewed by authorised reviewer.',evidence_reference='private-test-evidence')
    path='/operations/admin/contractors/worker/review'
    assert api.post(path,headers=auth('worker'),json=review).status_code==403
    assert api.post(path,headers=ADMIN,json=review).status_code==409
    main.operations_store.run(lambda u:u.put('workers','worker',{**u.get('workers','worker'),'status':'approved'}))
    assert api.post(path,headers=ADMIN,json=review).status_code==200
    assert main.operations_store.run(lambda u:u.get('workers','worker'))['contractor_verified']
    assert api.post(path,headers=ADMIN,json=review).status_code==409

def test_annual_reward_snapshot_verified_work_and_idempotency(api,monkeypatch):
    onboard(api);now=time.time();p=copy.deepcopy(partner.DEFAULT);p.update(starts_at=now-10000,ends_at=now+1000,reward_ends_at=now+86400,min_tasks=2,min_reviews=2,min_rating=4,min_on_time_percent=80)
    def seed(u):
        u.put('partner_acceptances','worker',dict(worker_id='worker',accepted_at=now-9000,policy=p))
        for i in range(2):u.put('jobs',str(i),dict(id=str(i),worker_id='worker',state='completed',payment_status='verified',completed_at=now-100,starts_epoch=now-300,started_at=now-295,review={'rating':5}))
    main.operations_store.run(seed)
    assert main.operations_store.run(lambda u:partner.evaluate(u,'worker'))['status']=='tracking'
    monkeypatch.setattr(partner.time,'time',lambda:now+2000)
    main.operations_store.run(lambda u:u.put('jobs','1',{**u.get('jobs','1'),'payment_status':'pending'}))
    assert main.operations_store.run(lambda u:partner.evaluate(u,'worker'))['status']=='criteria_not_met'
    main.operations_store.run(lambda u:u.put('jobs','1',{**u.get('jobs','1'),'payment_status':'verified','financial_hold':True}))
    assert main.operations_store.run(lambda u:partner.evaluate(u,'worker'))['status']=='review_hold'
    main.operations_store.run(lambda u:u.put('jobs','1',{**u.get('jobs','1'),'financial_hold':False}))
    a=main.operations_store.run(lambda u:partner.evaluate(u,'worker'))
    assert a['status']=='awarded' and a['award']['reference_value']==12000
    assert main.operations_store.run(lambda u:partner.evaluate(u,'worker'))['award']==a['award']
    assert len(main.operations_store.run(lambda u:u.all('partner_entitlements')))==1
    import hiring
    assert main.operations_store.run(lambda u:hiring.worker_listing_offer(u,'worker'))['earned'] is True
    assert main.operations_store.run(lambda u:hiring.listing_eligible(u,'worker'))

def test_admin_new_policy_does_not_change_accepted_policy(api):
    onboard(api);before=main.operations_store.run(lambda u:u.get('partner_acceptances','worker'))
    p=api.get('/operations/partner-policy').json();body=dict(expected_version=p['version'],min_tasks=12,min_reviews=4,min_rating=4.3,min_on_time_percent=85)
    assert api.put('/operations/admin/partner-policy',headers=auth('worker'),json=body).status_code==403
    assert api.put('/operations/admin/partner-policy',headers=ADMIN,json=body).status_code==200
    assert main.operations_store.run(lambda u:u.get('partner_acceptances','worker'))==before
    assert api.put('/operations/admin/partner-policy',headers=ADMIN,json=body).status_code==409
