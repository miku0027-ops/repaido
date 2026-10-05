"""HTTP journeys against isolated SQLite. Provider fixtures never transfer money."""
import time,uuid
from datetime import datetime,timezone
import main,integrations,refunds
from test_operations import api,auth,ADMIN,started,command,onboard,book
from test_integrations import completed,payment_fixture


def test_support_conversation_ownership_and_hold(api):
    j=completed(api);body=dict(job_id=j['id'],category='warranty',message='Repair needs another inspection',request_id=str(uuid.uuid4()))
    url='/operations/support';r=api.post(url,headers=auth('customer'),json=body);assert r.status_code==201,r.text
    c=r.json();assert api.post(url,headers=auth('customer'),json=body).json()['id']==c['id']
    assert api.post(url,headers=auth('customer'),json={**body,'message':'Different issue'}).status_code==409
    path=url+'/'+c['id']
    assert api.get(path,headers=auth('stranger')).status_code==404
    assert api.post(path+'/actions',headers=auth('customer'),json=dict(action='resolve',reason='Customer cannot approve',expected_version=1)).status_code==403
    assert main.operations_store.run(lambda u:u.get('jobs',j['id']))['financial_hold']
    message=dict(message='We will inspect your repair.',request_id=str(uuid.uuid4()))
    assert api.post('/operations/admin/support/'+c['id']+'/messages',headers=ADMIN,json=message).status_code==200
    result=api.get(path,headers=auth('customer')).json();assert len(result['messages'])==2
    assert api.post('/operations/admin/support/'+c['id']+'/actions',headers=ADMIN,json=dict(action='resolve',reason='Inspection completed and accepted.',expected_version=2)).status_code==200
    assert not main.operations_store.run(lambda u:u.get('jobs',j['id']))['financial_hold']
    assert api.post(path+'/messages',headers=auth('customer'),json=message).status_code==409


def test_manual_arrival_and_pause_recovery(api):
    onboard(api);j,_=book(api);j=command(api,j,'accept');j=command(api,j,'ack_reminder');j=command(api,j,'depart')
    path=f"/operations/jobs/{j['id']}"
    assert api.post(path+'/confirm-arrival',headers=auth('worker'),json={'reason':'I am outside'}).status_code==403
    r=api.post(path+'/confirm-arrival',headers=auth('customer'),json={'reason':'I can see my professional at the door'});assert r.status_code==200,r.text
    j=command(api,r.json(),'start')
    j=api.post(path+'/stop-request',headers=auth('customer'),json={'reason':'The repair needs clarification'}).json();assert j['state']=='stop_requested'
    proposal=dict(action='resume',reason='Clarified the agreed repair scope',expected_version=j['version'],request_id=str(uuid.uuid4()))
    r=api.post(f"/operations/admin/jobs/{j['id']}/resolution",headers=ADMIN,json=proposal);assert r.status_code==200,r.text
    pid=r.json()['id'];decision=f'/operations/resolutions/{pid}/decision'
    assert api.post(decision,headers=auth('worker'),json={'accept':True,'expected_version':j['version']}).status_code==403
    r=api.post(decision,headers=auth('customer'),json={'accept':True,'expected_version':j['version']});assert r.status_code==200,r.text
    assert r.json()['state']=='en_route' and 'start' not in r.json()['allowed_actions']
    assert api.post(decision,headers=auth('customer'),json={'accept':True,'expected_version':j['version']}).status_code==200


def test_partial_close_preserves_scope_and_balanced_allocation(api):
    j=started(api);j=command(api,j,'submit_completion',payload={'notes':'Partial service completed'});j=command(api,j,'dispute','customer',{'reason':'Only some work is complete'})
    body=dict(action='partial_close',reason='Customer pays only for work accepted',expected_version=j['version'],final_paise=10000,final_base_paise=10000,request_id=str(uuid.uuid4()))
    r=api.post(f"/operations/admin/jobs/{j['id']}/resolution",headers=ADMIN,json=body);assert r.status_code==200,r.text
    pid=r.json()['id'];r=api.post(f'/operations/resolutions/{pid}/decision',headers=auth('customer'),json={'accept':True,'expected_version':j['version']});assert r.status_code==200,r.text
    j=r.json();assert j['total_paise']==10000 and j['outcome']=='partial' and len(j['scopes'])==2
    p=payment_fixture(j);main.operations_store.run(lambda u:integrations.apply_payment(u,p))
    def policy(u):
        row=u.get('jobs',j['id']);row['settlement_policy']={'worker_share_bps':7500,'bonus_reserve_bps':1000,'penalty_cap_bps':5000,'stack_penalties':False,'penalty_mode':'highest_single'};row['penalties']=[];u.put('jobs',j['id'],row)
    main.operations_store.run(policy)
    s=api.post(f"/operations/admin/settlements/{j['id']}/calculate",headers=ADMIN).json()
    assert s['net_paise']==7500 and s['company_earnings_paise']==1500 and s['bonus_reserve_paise']==1000 and s['parts_payable_paise']==0
    statement=api.get(f"/operations/jobs/{j['id']}/receipt",headers=auth('customer')).json();assert statement['document_type']=='payment_receipt'
    assert api.get(f"/operations/jobs/{j['id']}/receipt",headers=auth('stranger')).status_code==404


def test_addresses_and_profile_are_owned(api):
    body=dict(label='Home',address='Private home address 234',city='Balasore',location={'lat':21.49,'lng':86.91},confirmed=True)
    assert api.put('/operations/addresses/home',headers=auth('customer'),json=body).status_code==200
    assert api.get('/operations/addresses',headers=auth('stranger')).json()['addresses']==[]
    assert api.put('/operations/addresses/home',headers=auth('customer'),json={**body,'city':'Unsupported'}).status_code==422
    assert api.delete('/operations/addresses/home',headers=auth('customer')).status_code==200
    assert api.get('/operations/addresses',headers=auth('customer')).json()['addresses']==[]
    assert api.put('/operations/profile',headers=auth('customer'),json={'name':'Real customer','theme':'dark'}).status_code==200
    assert api.get('/operations/profile',headers=auth('customer')).json()['profile']['theme']=='dark'


def test_refund_unknown_does_not_post_again_and_reconciles(api,monkeypatch):
    j=completed(api);payment=payment_fixture(j);main.operations_store.run(lambda u:integrations.apply_payment(u,payment))
    for key in ('RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET'):monkeypatch.setenv(key,'test-only')
    monkeypatch.setenv('REPAIDO_PAYMENTS_ENABLED','true');calls=[];found=[]
    def provider(path,body=None):
        if body:
            calls.append(body);integrations.fail('PROVIDER_OUTCOME_UNKNOWN','Lost provider response',503)
        if '/refunds?' in path:return {'items':found}
        if path=='payments/pay_test':return {**payment,'amount_refunded':100}
        raise AssertionError(path)
    monkeypatch.setattr(refunds,'razorpay',provider)
    body=dict(amount_paise=100,reason='Approved refund for an overcollection',request_id=str(uuid.uuid4()))
    path=f"/operations/admin/jobs/{j['id']}/refund"
    assert api.post(path,headers=auth('customer'),json=body).status_code==403
    assert api.post(path,headers=ADMIN,json=body).status_code==503
    r=api.post(path,headers=ADMIN,json=body);assert r.status_code==200,r.text
    assert len(calls)==1 and r.json()['status']=='submitting'
    assert api.post(path,headers=ADMIN,json={**body,'request_id':str(uuid.uuid4())}).status_code==409
    found.append(dict(id='rfnd_test',payment_id='pay_test',amount=100,receipt=calls[0]['receipt'],status='processed'))
    r=api.post(path,headers=ADMIN,json=body);assert r.status_code==200,r.text
    assert r.json()['status']=='processed' and len(calls)==1
    assert main.operations_store.run(lambda u:u.get('jobs',j['id']))['payment_status']=='partially_refunded'


def test_failed_payout_new_attempt_keeps_history_and_unknown_key(api,monkeypatch):
    j=completed(api);payment=payment_fixture(j)
    def prepare(u):
        integrations.apply_payment(u,payment);row=u.get('jobs',j['id']);row['settlement_policy']={'worker_share_bps':7500,'bonus_reserve_bps':1000,'penalty_cap_bps':5000,'stack_penalties':False};row['penalties']=[];u.put('jobs',j['id'],row)
    main.operations_store.run(prepare)
    s=api.post(f"/operations/admin/settlements/{j['id']}/calculate",headers=ADMIN).json()
    for key in ('RAZORPAYX_KEY_ID','RAZORPAYX_KEY_SECRET','RAZORPAYX_ACCOUNT_NUMBER'):monkeypatch.setenv(key,'test-only')
    monkeypatch.setenv('REPAIDO_PAYOUTS_ENABLED','true');calls=[]
    first=dict(id='pout_first',reference_id=j['id'],status='failed',currency='INR',amount=s['net_paise'],fund_account_id='fa_test')
    def provider(path,body=None,**kwargs):
        if not body:return first
        calls.append((body,kwargs['key']))
        if len(calls)==1:return first
        return {**first,'id':'pout_second','reference_id':body['reference_id'],'status':'processed'}
    monkeypatch.setattr(integrations,'razorpay',provider)
    body=dict(expected_net_paise=s['net_paise'],reason='Reviewed terminal provider failure')
    assert api.post(f"/operations/admin/settlements/{j['id']}/release",headers=ADMIN,json=body).status_code==200
    r=api.post(f"/operations/admin/payouts/{j['id']}/retry-failed",headers=ADMIN,json=body);assert r.status_code==200,r.text
    assert r.json()['status']=='processed' and calls[0][1]!=calls[1][1]
    main.integrations_reconcile_payout(first)
    assert main.operations_store.run(lambda u:u.get('payouts',j['id']))['provider_id']=='pout_second'
    assert len(main.operations_store.run(lambda u:u.all('deductions')))==1
    assert len(main.operations_store.run(lambda u:u.all('payout_attempts')))==1


def test_penalty_appeal_recalculates_unreleased_settlement(api):
    j=completed(api);payment=payment_fixture(j)
    def prepare(u):
        integrations.apply_payment(u,payment);row=u.get('jobs',j['id']);row['settlement_policy']={'worker_share_bps':7500,'bonus_reserve_bps':1000,'penalty_cap_bps':5000,'stack_penalties':False,'penalty_mode':'highest_single'};row['penalties']=[{'code':'LATE_DEPARTURE','worker_id':'worker','visit_id':row['visit_id'],'current_percent':20}];u.put('jobs',j['id'],row);return row
    row=main.operations_store.run(prepare);path=f"/operations/admin/settlements/{j['id']}/calculate"
    old=api.post(path,headers=ADMIN).json();assert old['deduction_paise']>0
    body=dict(code='LATE_DEPARTURE',visit_id=row['visit_id'],decision='waive',reason='Verified platform outage caused this delay.')
    assert api.post(f"/operations/admin/jobs/{j['id']}/penalty-review",headers=auth('worker'),json=body).status_code==403
    r=api.post(f"/operations/admin/jobs/{j['id']}/penalty-review",headers=ADMIN,json=body);assert r.status_code==200,r.text
    new=api.post(path,headers=ADMIN).json();assert new['deduction_paise']==0 and new['net_paise']>old['net_paise']


def test_followup_requires_new_acceptance_and_reassignment_revokes_old_access(api):
    j=started(api);onboard(api,'worker2')
    j=api.post(f"/operations/jobs/{j['id']}/stop-request",headers=auth('customer'),json={'reason':'A different professional is needed'}).json()
    body=dict(action='reassign',reason='Agreed reassignment after support investigation',expected_version=j['version'],starts_at=datetime.fromtimestamp(time.time()+8000,timezone.utc).isoformat(),request_id=str(uuid.uuid4()))
    p=api.post(f"/operations/admin/jobs/{j['id']}/resolution",headers=ADMIN,json=body).json()
    r=api.post(f"/operations/resolutions/{p['id']}/decision",headers=auth('customer'),json={'accept':True,'expected_version':j['version']});assert r.status_code==200,r.text
    assert r.json()['state']=='offered' and r.json()['worker_id']=='worker2'
    assert api.get(f"/operations/jobs/{j['id']}",headers=auth('worker')).status_code==404
    assert 'start' not in api.get(f"/operations/jobs/{j['id']}",headers=auth('worker2')).json()['allowed_actions']


def test_notification_read_cannot_change_other_users_state(api):
    onboard(api);book(api);main.integrations_relay()
    n=api.get('/operations/notifications',headers=auth('customer')).json()['notifications'][0]
    path=f"/operations/notifications/{n['id']}/read"
    assert api.post(path,headers=auth('stranger')).status_code==404
    assert api.post(path,headers=auth('customer')).status_code==200
    assert api.get('/operations/notifications',headers=auth('customer')).json()['notifications'][0]['read_at']>0


def test_metric_exclusion_requires_owned_source_and_preserves_review(api):
    j=started(api)
    row=main.operations_store.run(lambda u:u.get('jobs',j['id']))
    body=dict(source_kind='assignment',source_id=row['assignment_metric_id'],reason='Confirmed notification delivery outage',exclude=True)
    path='/operations/admin/reward-metrics/worker/correction'
    assert api.post(path,headers=auth('worker'),json=body).status_code==403
    assert api.post(path,headers=ADMIN,json=body).status_code==200
    assert api.post('/operations/admin/reward-metrics/worker2/correction',headers=ADMIN,json=body).status_code==404
    from rewards import performance
    result=main.operations_store.run(lambda u:performance(u,'worker',time.time()))
    assert result['response_rate'] is None and result['recent_review_count']==0
