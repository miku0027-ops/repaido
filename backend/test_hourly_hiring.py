"""Real local HTTP/ledger tests; simulated gateway and clock, never live payments."""
import copy
import time
from datetime import datetime, timezone
import pytest
import main, hiring, hourly_hiring, integrations
from test_operations import api, auth, onboard, command, PIN, ADMIN
from test_hiring_records import request, decide


def setup_hourly(api, monkeypatch, minutes=120):
    monkeypatch.setenv('GOOGLE_ROUTES_API_KEY','test-only')
    monkeypatch.setenv('REPAIDO_PAYMENTS_ENABLED','true')
    monkeypatch.setenv('REPAIDO_OTP_SECRET','test-only')
    for key in ('RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET'):monkeypatch.setenv(key,'test-only')
    monkeypatch.setattr(hiring,'route_metres',lambda a,b:3000)
    p={**hiring.HOURLY_DEFAULT,'enabled':True,'gst_bps':0,'membership_paise':9900}
    r=api.put('/operations/admin/hiring-policy',headers=ADMIN,json=p);assert r.status_code==200,r.text
    onboard(api)
    def seed(u):
        u.put('hire_memberships','worker',dict(id='worker',status='active',expires_at=time.time()+86400,policy_version=p['version'],radius_km=10))
        w=u.get('workers','worker');w['settlement_policy_version']='hourly-earn';u.put('workers','worker',w)
        u.put('policies','current',dict(version='hourly-earn',worker_share_bps=7500,bonus_reserve_bps=1000,penalty_cap_bps=10000,stack_penalties=False,penalty_mode='highest_single'))
    main.operations_store.run(seed)
    gateway={'orders':[],'payments':[]}
    def fake(path,body=None,**kwargs):
        if path=='orders':
            order={**body,'id':'order_hourly_'+str(len(gateway['orders']))};gateway['orders'].append(order);return order
        if path.endswith('/payments'):return {'items':gateway['payments']}
        raise AssertionError(path)
    monkeypatch.setattr(integrations,'razorpay',fake)
    return p,gateway


def reserve(api,p,minutes=120,**extra):
    h,_=request(api,p,planned_minutes=minutes,**extra)
    r=decide(api,h,'accept',position={**PIN,'accuracy':5,'captured_at':time.time()});assert r.status_code==200,r.text
    quoted=r.json();r=decide(api,quoted,'confirm','customer');assert r.status_code==200,r.text
    h=r.json();assert h['state']=='awaiting_payment'
    j=api.get('/operations/jobs/'+h['job_id'],headers=auth('customer')).json()
    return h,j


def pay(api,j,gateway):
    path='/operations/jobs/'+j['id']+'/hire-base'
    r=api.post(path+'/payment-order',headers=auth('customer'));assert r.status_code==200,r.text
    order=r.json();assert api.post(path+'/payment-order',headers=auth('customer')).json()['order_id']==order['order_id']
    gateway['payments']=[dict(id='pay_'+j['id'],order_id=order['order_id'],amount=order['amount'],currency='INR',captured=True,status='captured')]
    r=api.post(path+'/payment-check',headers=auth('customer'));assert r.status_code==200,r.text
    assert r.json()['status']=='captured' and r.json()['allocated']
    return api.get('/operations/jobs/'+j['id'],headers=auth('worker')).json()


def start(api,j,monkeypatch):
    clock=[j['starts_epoch']]
    monkeypatch.setattr(time,'time',lambda:clock[0])
    j=api.get('/operations/jobs/'+j['id'],headers=auth('worker')).json()
    if 'ack_reminder' in j['allowed_actions']:j=command(api,j,'ack_reminder')
    j=command(api,j,'depart');j=command(api,j,'position',payload={**PIN,'accuracy':5,'captured_at':time.time()})
    code=api.get(f"/operations/jobs/{j['id']}/arrival-code",headers=auth('customer'));assert code.status_code==200,code.text
    r=api.post(f"/operations/jobs/{j['id']}/verify-arrival",headers=auth('worker'),json={'code':code.json()['code']});assert r.status_code==200,r.text
    j=api.get('/operations/jobs/'+j['id'],headers=auth('worker')).json()
    return command(api,j,'start'),clock


@pytest.mark.parametrize('seconds,work',[(0,0),(1,4),(30,125),(60,250),(61,254),(3600,15000),(21600,90000),(99999,90000)])
def test_actual_time_integer_paise_and_six_hour_ceiling(seconds,work):
    bill=hourly_hiring.price(seconds)
    assert bill['work_paise']==work and bill['total_paise']==15000+work
    assert bill['booking_advance_paise']==15000


def test_surcharge_applies_to_base_and_work_with_locked_tax():
    b=hourly_hiring.price(90*60,surcharge_bps=2500,gst_bps=1800)
    assert b['work_paise']==22500 and b['surcharge_paise']==9375
    assert b['booking_advance_paise']==22125 and b['total_paise']==55313
    assert hourly_hiring.price(36000,limit_minutes=90)['work_paise']==22500
    with pytest.raises(ValueError):hourly_hiring.price(1,surcharge_bps=2501)


def test_upfront_break_actual_bill_credit_and_settlement(api,monkeypatch):
    p,gateway=setup_hourly(api,monkeypatch);h,j=reserve(api,p)
    assert h['quote']['total_paise']==45000 and h['quote']['work_paise']==30000
    assert h['quote']['travel_paise']==0
    assert 'depart' not in api.get('/operations/jobs/'+j['id'],headers=auth('worker')).json()['allowed_actions']
    assert api.post('/operations/jobs/'+j['id']+'/hire-base/payment-order',headers=auth('worker')).status_code==404
    j=pay(api,j,gateway)
    assert len(gateway['orders'])==1 and j['hire_base_paid_paise']==15000
    assert api.get('/operations/hiring/requests',headers=auth('customer')).json()['requests'][0]['state']=='booked'
    # Duplicate provider observations do not create duplicate credits/journals.
    api.post('/operations/jobs/'+j['id']+'/hire-base/payment-check',headers=auth('customer'))
    assert len(main.operations_store.run(lambda u:u.all('journals')))==1
    j,clock=start(api,j,monkeypatch);clock[0]+=20*60
    j=command(api,j,'start_meal_break')
    assert j['hourly_bill']['billable_seconds']==1200 and not j['hourly_bill']['timer_running']
    command(api,j,'resume_after_break',status=409)
    assert 'submit_completion' not in j['allowed_actions']
    clock[0]+=35*60
    j=api.get('/operations/jobs/'+j['id'],headers=auth('worker')).json()
    assert j['hourly_bill']['billable_seconds']==1200
    j=command(api,j,'resume_after_break');assert 'start_meal_break' not in j['allowed_actions']
    clock[0]+=10*60+30
    j=command(api,j,'submit_completion',payload={'notes':'Completed agreed hourly task and verified operation.'})
    assert j['hourly_bill']['billable_seconds']==1830
    assert j['total_paise']==22625 and j['hourly_bill']['remaining_service_paise']==7625
    j=command(api,j,'accept_completion','customer')
    final=api.post('/operations/jobs/'+j['id']+'/payment-order',headers=auth('customer'))
    assert final.status_code==200,final.text
    assert final.json()['amount']==7625
    payment=dict(id='pay_final',order_id=final.json()['order_id'],amount=7625,currency='INR',captured=True,status='captured')
    main.operations_store.run(lambda u:integrations.apply_payment(u,payment))
    s=main.operations_store.run(lambda u:integrations.settlement(u,j['id']))
    assert s['gross_paise']>0 and s['gst_payable_paise']==0
    assert s['net_paise']+s['company_earnings_paise']+s['bonus_reserve_paise']==22625


def test_future_reservation_while_working_and_public_privacy(api,monkeypatch):
    p,gateway=setup_hourly(api,monkeypatch);h,j=reserve(api,p,minutes=60);j=pay(api,j,gateway);j,clock=start(api,j,monkeypatch)
    clock[0]+=600
    api.post('/operations/worker/availability',headers=auth('worker'),json={'online':True,'position':{**PIN,'accuracy':5,'captured_at':time.time()}})
    status=api.get('/operations/hiring/availability/worker');assert status.status_code==200
    assert status.headers['cache-control']=='no-store'
    a=status.json()['availability'];assert a['state']=='at_work' and a['estimated']
    assert a['available_at']>=j['starts_epoch']+120*60
    assert not {'job_id','location','address','customer_id','phone'}&a.keys()
    assert api.get('/operations/professionals/worker').json()['hire_availability']['state']=='at_work'
    search=api.post('/operations/hiring/search',json={'location':PIN,'planned_minutes':60}).json()
    assert search['professionals'][0]['id']=='worker'
    # A second customer may reserve a genuinely later slot, with a turnaround buffer.
    later=datetime.fromtimestamp(a['available_at']+60,timezone.utc).isoformat()
    h2,j2=reserve(api,p,minutes=60,starts_at=later)
    assert j2['worker_id']==j['worker_id'] and j2['id']!=j['id']
    overlap=api.post('/operations/hiring/search',json={'location':PIN,'planned_minutes':60,'starts_at':later}).json()
    assert not overlap['professionals']
    # Physical travel/start remains locked while the first task is in progress.
    j2=pay(api,j2,gateway)
    if 'ack_reminder' in j2['allowed_actions']:j2=command(api,j2,'ack_reminder')
    command(api,j2,'depart',status=409)


def test_expired_and_cancelled_payments_do_not_reopen_booking(api,monkeypatch):
    p,gateway=setup_hourly(api,monkeypatch);h,j=reserve(api,p)
    path='/operations/jobs/'+j['id']+'/hire-base'
    order=api.post(path+'/payment-order',headers=auth('customer')).json()
    command(api,j,'cancel','customer')
    gateway['payments']=[dict(id='late',order_id=order['order_id'],amount=order['amount'],currency='INR',captured=True,status='captured')]
    r=api.post(path+'/payment-check',headers=auth('customer'));assert r.status_code==200,r.text
    assert not r.json()['allocated'] and r.json()['recovery']=='refund_review'
    saved=api.get('/operations/jobs/'+j['id'],headers=auth('customer')).json()
    assert saved['state']=='cancelled' and saved['hire_base_paid_paise']==0 and saved['financial_hold']
    assert api.post(path+'/payment-order',headers=auth('customer')).status_code==409
    assert len(gateway['orders'])==1


def test_payment_binding_refund_monotonicity_and_unknown_order(api,monkeypatch):
    p,gateway=setup_hourly(api,monkeypatch);h,j=reserve(api,p)
    path='/operations/jobs/'+j['id']+'/hire-base'
    # Ambiguous provider POST keeps the stable record for reconciliation, not a second order.
    original=integrations.razorpay
    def timeout(path,body=None):raise TimeoutError('test unknown outcome')
    monkeypatch.setattr(integrations,'razorpay',timeout)
    with pytest.raises(TimeoutError):api.post(path+'/payment-order',headers=auth('customer'))
    monkeypatch.setattr(integrations,'razorpay',original)
    assert api.post(path+'/payment-order',headers=auth('customer')).status_code==409
    assert not gateway['orders']
    def reconcile_order(u):
        row=u.get('payments',j['hire_base_payment_id']);row.update(order_id='recovered',status='created');u.put('payments',row['id'],row)
    main.operations_store.run(reconcile_order)
    wrong=dict(id='p1',order_id='recovered',amount=15001,currency='INR',captured=True,status='captured')
    gateway['payments']=[wrong]
    assert api.post(path+'/payment-check',headers=auth('customer')).status_code==409
    wrong['amount']=15000;wrong['currency']='USD'
    assert api.post(path+'/payment-check',headers=auth('customer')).status_code==409
    wrong['currency']='INR'
    assert api.post(path+'/payment-check',headers=auth('customer')).json()['allocated']
    wrong.update(amount_refunded=100,status='captured')
    assert api.post(path+'/payment-check',headers=auth('customer')).json()['status']=='partially_refunded'
    wrong.pop('amount_refunded')
    assert api.post(path+'/payment-check',headers=auth('customer')).json()['amount_refunded']==100
    saved=api.get('/operations/jobs/'+j['id'],headers=auth('customer')).json()
    assert saved['financial_hold'] and saved['hire_base_paid_paise']==14900
    wrong['id']='p2'
    assert api.post(path+'/payment-check',headers=auth('customer')).status_code==409


def test_real_occupancy_rate_early_and_small_sample_are_standard():
    workers=[{'id':str(n)} for n in range(4)]
    jobs=[dict(worker_id=str(n),state='in_progress',starts_epoch=1000,duration_minutes=120) for n in range(4)]
    rate=lambda start,ws:hourly_hiring.demand_rate(None,ws,starts_epoch=start,now=1000,jobs=jobs)
    assert rate(3000,workers)['bps']==2500
    assert rate(5001,workers)['bps']==0
    assert rate(3000,workers[:2])['bps']==0
    jobs.pop();assert rate(3000,workers)['bps']==1000


def test_hard_limit_excludes_unpaid_break_and_zero_balance(api,monkeypatch):
    p,gateway=setup_hourly(api,monkeypatch);h,j=reserve(api,p,minutes=15);j=pay(api,j,gateway);j,clock=start(api,j,monkeypatch)
    clock[0]+=7200
    j=command(api,j,'submit_completion',payload={'notes':'Completed task; no work beyond the agreed cap was charged.'})
    assert j['hourly_bill']['billable_seconds']==900 and j['hourly_bill']['limit_reached']
    assert j['total_paise']==18750


def test_unpaid_expiry_frees_slot_without_worker_penalty(api,monkeypatch):
    p,gateway=setup_hourly(api,monkeypatch);h,j=reserve(api,p)
    monkeypatch.setattr(time,'time',lambda:j['hire_payment_expires_at']+1)
    main.hiring_tick();main.operations_tick()
    saved=api.get('/operations/jobs/'+j['id'],headers=auth('customer')).json()
    assert saved['state']=='cancelled' and saved['hire_base_status']=='expired' and not saved['penalties']
    assert api.post('/operations/jobs/'+j['id']+'/hire-base/payment-order',headers=auth('customer')).status_code==409


def test_fully_prepaid_zero_work_is_not_collected_twice(api,monkeypatch):
    p,gateway=setup_hourly(api,monkeypatch);h,j=reserve(api,p);j=pay(api,j,gateway);j,clock=start(api,j,monkeypatch)
    j=command(api,j,'submit_completion',payload={'notes':'Customer confirmed that no further work was required after arrival.'});j=command(api,j,'accept_completion','customer')
    assert j['payment_status']=='verified' and j['invoice']['status']=='paid' and j['total_paise']==15000
    assert api.post('/operations/jobs/'+j['id']+'/payment-order',headers=auth('customer')).status_code==409
    ledger=main.operations_store.run(lambda u:u.get('ledger',j['id']));assert ledger['payment_status']=='verified'


def test_hourly_safety_stop_resume_keeps_clock_and_partial_close_credits_advance(api,monkeypatch):
    import uuid
    p,gateway=setup_hourly(api,monkeypatch);h,j=reserve(api,p);j=pay(api,j,gateway);j,clock=start(api,j,monkeypatch);clock[0]+=600
    def stop():
        r=api.post('/operations/jobs/'+j['id']+'/stop-request',headers=auth('customer'),json={'reason':'Pause the visit while checking the agreed task scope.'});assert r.status_code==200,r.text;return r.json()
    j=stop();assert not j['hourly_bill']['timer_running']
    clock[0]+=120
    def propose(action,**extra):
        return api.post('/operations/admin/jobs/'+j['id']+'/resolution',headers=ADMIN,json=dict(action=action,reason='Reviewed the customer and worker explanation of this interruption.',expected_version=j['version'],request_id=str(uuid.uuid4()),**extra))
    assert propose('reassign',starts_at=datetime.fromtimestamp(time.time()+7200,timezone.utc).isoformat()).status_code==409
    r=propose('resume');assert r.status_code==200,r.text
    r=api.post('/operations/resolutions/'+r.json()['id']+'/decision',headers=auth('customer'),json={'accept':True,'expected_version':j['version']});assert r.status_code==200,r.text;j=r.json()
    j=command(api,j,'position',payload={**PIN,'accuracy':5,'captured_at':time.time()});j=command(api,j,'start')
    assert j['hourly_bill']['billable_seconds']==600
    clock[0]+=60;j=stop();bill=j['hourly_bill'];assert bill['billable_seconds']==660
    assert propose('partial_close',final_paise=100,final_base_paise=100).status_code==409
    r=propose('partial_close',final_paise=bill['total_paise'],final_base_paise=bill['base_paise']+bill['work_paise']);assert r.status_code==200,r.text
    r=api.post('/operations/resolutions/'+r.json()['id']+'/decision',headers=auth('customer'),json={'accept':True,'expected_version':j['version']});assert r.status_code==200,r.text
    assert r.json()['state']=='completed' and r.json()['total_paise']==17750
    assert r.json()['hourly_bill']['remaining_service_paise']==2750


def test_finance_cancellation_refund_and_balanced_booking_advance_journal(api,monkeypatch):
    import refunds,uuid
    p,gateway=setup_hourly(api,monkeypatch);h,j=reserve(api,p);j=pay(api,j,gateway)
    command(api,j,'cancel','customer')
    def provider(path,body=None):
        if path.endswith('/refund'):
            gateway['payments'][0].update(status='refunded',amount_refunded=15000)
            return dict(id='rf_fixture',payment_id=gateway['payments'][0]['id'],amount=body['amount'],receipt=body['receipt'],status='processed')
        if path.startswith('payments/'):return gateway['payments'][0]
        raise AssertionError(path)
    monkeypatch.setattr(refunds,'razorpay',provider)
    r=api.post('/operations/admin/jobs/'+j['id']+'/refund',headers=ADMIN,json=dict(payment_record_id=j['hire_base_payment_id'],amount_paise=15000,reason='Cancelled visit; approved return of the unused booking advance.',request_id=str(uuid.uuid4())))
    assert r.status_code==200,r.text
    journals=main.operations_store.run(lambda u:u.all('journals'))
    assert len(journals)==2 and all(sum(x['debit']-x['credit'] for x in v['lines'])==0 for v in journals)
    account=sum(x['debit']-x['credit'] for v in journals for x in v['lines'] if x['account']=='customer_hire_advances')
    assert account==0
    saved=api.get('/operations/jobs/'+j['id'],headers=auth('customer')).json()
    assert saved['hire_base_status']=='refunded' and saved['hire_base_paid_paise']==0


def test_zero_work_payout_consumes_booking_advance_once(api,monkeypatch):
    p,gateway=setup_hourly(api,monkeypatch);h,j=reserve(api,p);j=pay(api,j,gateway);j,clock=start(api,j,monkeypatch)
    j=command(api,j,'submit_completion',payload={'notes':'No billable work needed; customer checked the agreed booking base.'});j=command(api,j,'accept_completion','customer')
    s=api.post('/operations/admin/settlements/'+j['id']+'/calculate',headers=ADMIN);assert s.status_code==200,s.text
    for n in ('RAZORPAYX_KEY_ID','RAZORPAYX_KEY_SECRET','RAZORPAYX_ACCOUNT_NUMBER'):monkeypatch.setenv(n,'test')
    monkeypatch.setenv('REPAIDO_PAYOUTS_ENABLED','true')
    result=dict(id='pout_hourly',reference_id=j['id'],amount=s.json()['net_paise'],fund_account_id='fa_test',currency='INR',status='processed')
    monkeypatch.setattr(integrations,'razorpay',lambda *args,**kwargs:result)
    r=api.post('/operations/admin/settlements/'+j['id']+'/release',headers=ADMIN,json=dict(expected_net_paise=result['amount'],reason='Independent fixture review of completed and paid hourly work.'));assert r.status_code==200,r.text
    journal=main.operations_store.run(lambda u:u.get('journals',j['id']))
    assert sum(x['debit']-x['credit'] for x in journal['lines'])==0
    assert next(x for x in journal['lines'] if x['account']=='customer_hire_advances')['debit']==15000
    assert next(x for x in journal['lines'] if x['account']=='payment_clearing')['debit']==0


def test_parts_extra_is_preserved_when_estimate_becomes_actual():
    job=dict(hourly_hire={**hourly_hiring.terms(120),'surcharge_bps':0,'gst_bps':0,'quoted_service_total_paise':45000},total_paise=50000,work_seconds=600,hire_base_paid_paise=15000)
    hourly_hiring.finalize_bill(job,1000)
    assert job['total_paise']==22500 and job['settlement_base_paise']==17500
    hourly_hiring.finalize_bill(job,2000)
    assert job['total_paise']==22500


def test_server_work_limit_stops_abandoned_clock_and_notifies_once(api,monkeypatch):
    p,gateway=setup_hourly(api,monkeypatch);h,j=reserve(api,p,minutes=15);j=pay(api,j,gateway);j,clock=start(api,j,monkeypatch)
    clock[0]+=1000;main.operations_tick();main.operations_tick()
    saved=api.get('/operations/jobs/'+j['id'],headers=auth('worker')).json()
    assert saved['work_seconds']==900 and not saved.get('work_clock_started_at')
    assert saved['hourly_bill']['limit_reached'] and saved['state']=='in_progress'
    assert 'submit_completion' in saved['allowed_actions'] and 'propose_parts' not in saved['allowed_actions']
    assert sum(e['event_type']=='HourlyWorkLimitReached' for e in saved['events'])==1


def test_concurrent_requests_reserve_one_worker_slot(api,monkeypatch):
    import uuid
    from concurrent.futures import ThreadPoolExecutor
    p,gateway=setup_hourly(api,monkeypatch)
    h,b=request(api,p,planned_minutes=60);assert decide(api,h,'cancel','customer').status_code==200
    def attempt(_):return api.post('/operations/hiring/requests',headers=auth('customer'),json={**b,'request_id':str(uuid.uuid4())})
    with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(attempt,range(2)))
    assert sorted(r.status_code for r in results)==[201,409]


def test_public_presence_reads_active_jobs_without_completed_history(api,monkeypatch):
    p,gateway=setup_hourly(api,monkeypatch);h,j=reserve(api,p)
    def seed(u):
        for n in range(110):u.put('jobs','historic-'+str(n),dict(id='historic-'+str(n),worker_id='worker',state='completed',starts_epoch=1))
    main.operations_store.run(seed)
    rows=main.operations_store.run(lambda u:hourly_hiring.active_worker_jobs(u,'worker'))
    assert len(rows)==1 and rows[0]['id']==j['id']


def test_firestore_presence_query_is_scoped_projected_and_bounded(monkeypatch):
    from google.cloud import firestore
    from google.auth.credentials import AnonymousCredentials
    from google.cloud.firestore_v1.query import Query
    from types import SimpleNamespace
    client=firestore.Client(project='local-hourly-fixture',credentials=AnonymousCredentials())
    seen=[]
    def stream(self,transaction=None):seen.append((self._to_protobuf(),transaction));return iter([])
    monkeypatch.setattr(Query,'stream',stream)
    tx=object();u=SimpleNamespace(tx=tx,core=SimpleNamespace(fs_collection=lambda name:client.collection(name)),pending={})
    assert hourly_hiring.active_worker_jobs(u,'worker-fixture')==[]
    query,passed=seen[0];assert passed is tx and query.limit==101
    filters=query.where.composite_filter.filters
    assert filters[0].field_filter.field.field_path=='worker_id' and filters[0].field_filter.value.string_value=='worker-fixture'
    assert filters[1].field_filter.field.field_path=='state'
    assert {f.field_path for f in query.select.fields}==set(hourly_hiring.JOB_FIELDS)


def test_unpaid_reservations_cannot_inflate_demand():
    workers=[{'id':str(n)} for n in range(4)]
    jobs=[dict(worker_id=str(n),state='accepted',starts_epoch=1000,duration_minutes=120,hourly_hire={'model':'hourly-v1'},hire_base_status='pending') for n in range(4)]
    assert hourly_hiring.demand_rate(None,workers,starts_epoch=3000,now=1000,jobs=jobs)['bps']==0


def test_hourly_free_listing_does_not_require_an_invented_membership_price(api,monkeypatch):
    p,gateway=setup_hourly(api,monkeypatch)
    r=api.put('/operations/admin/hiring-policy',headers=ADMIN,json={**p,'version':'hourly-free-listing','membership_paise':None});assert r.status_code==200,r.text
    assert r.json()['enabled'] and r.json()['membership_paise'] is None
    monkeypatch.setattr(hiring,'free_listing',lambda:False)
    # Membership purchase fails before sending an unknown amount to the provider.
    main.operations_store.run(lambda u:u.put('hire_memberships','worker',dict(id='worker',status='unpaid',policy_version='hourly-free-listing')))
    r=api.post('/operations/worker/hire-membership/payment-order',headers=auth('worker'));assert r.status_code==409,r.text
    assert r.json()['detail']['code']=='MEMBERSHIP_PRICE_UNSET'
    assert not gateway['orders']


def test_support_resolution_cannot_release_an_uncertain_booking_refund(api,monkeypatch):
    import refunds,uuid
    p,gateway=setup_hourly(api,monkeypatch);h,j=reserve(api,p);j=pay(api,j,gateway);j,clock=start(api,j,monkeypatch)
    j=command(api,j,'submit_completion',payload={'notes':'Customer confirms the booking base after reviewing the visit.'});j=command(api,j,'accept_completion','customer')
    def provider(path,body=None):
        if path.endswith('/refund'):return dict(id='rf_pending',payment_id=gateway['payments'][0]['id'],amount=body['amount'],receipt=body['receipt'],status='pending')
        if path.startswith('payments/'):return gateway['payments'][0]
        raise AssertionError(path)
    monkeypatch.setattr(refunds,'razorpay',provider)
    r=api.post('/operations/admin/jobs/'+j['id']+'/refund',headers=ADMIN,json=dict(payment_record_id=j['hire_base_payment_id'],amount_paise=100,reason='Independent adjustment awaiting final provider confirmation.',request_id=str(uuid.uuid4())));assert r.status_code==200,r.text
    ticket=api.post('/operations/support',headers=auth('customer'),json=dict(job_id=j['id'],category='payment',message='Please explain the refund review.',request_id=str(uuid.uuid4())));assert ticket.status_code==201,ticket.text
    c=ticket.json();r=api.post('/operations/admin/support/'+c['id']+'/actions',headers=ADMIN,json=dict(action='resolve',reason='Explanation provided; provider reconciliation is still pending.',expected_version=c['version']));assert r.status_code==200,r.text
    saved=api.get('/operations/jobs/'+j['id'],headers=auth('customer')).json()
    assert saved['hire_base_status']=='captured' and saved['hire_refund_hold'] and saved['financial_hold']
    assert api.post('/operations/admin/settlements/'+j['id']+'/calculate',headers=ADMIN).status_code==409
