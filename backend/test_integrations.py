"""Provider failure contracts. Provider calls are stubbed; no real charges."""
import hashlib,hmac,json,time
import pytest
import main
import integrations as integration
from test_operations import api, auth, ADMIN, onboard, started, command, book, PIN


def completed(api):
    j=started(api);j=command(api,j,'submit_completion',payload={'notes':'Test completion'})
    return command(api,j,'accept_completion','customer')

def payment_fixture(j):
    a=dict(id=j['id'],job_id=j['id'],customer_id='customer',amount_paise=j['total_paise'],order_id='order_test',status='created',created_at=time.time())
    main.operations_store.run(lambda u:u.put('payments',a['id'],a))
    return dict(id='pay_test',order_id='order_test',amount=j['total_paise'],currency='INR',status='captured',captured=True,amount_refunded=0)

def test_approval_requires_private_verification(api):
    onboard(api,approve=False)
    assert api.post('/operations/admin/workers/worker/review',headers=ADMIN,json=dict(decision='approved',role='technician',reason='Cannot bypass checks',evidence_reference='arbitrary-reference')).status_code==409
    body=dict(decision='approved',reason='Client cannot approve',evidence_reference='client-reference',checks=[])
    assert api.post('/operations/admin/verification/worker/identity',headers=auth('worker'),json=body).status_code==403
    assert api.post('/operations/admin/verification/worker/identity',headers=ADMIN,json=body).status_code==409

def test_provider_missing_and_document_privacy(api,monkeypatch):
    monkeypatch.delenv('REPAIDO_KYC_BUCKET',raising=False);onboard(api,approve=False)
    assert api.post('/operations/worker/documents/identity',headers={**auth('worker'),'Content-Type':'application/pdf','X-Verification-Consent':'private-review-v1'},content=b'%PDF-test').status_code==503
    assert api.get('/operations/admin/documents/missing',headers=auth('worker')).status_code==403
    assert api.get('/operations/worker/verification',headers=auth('customer')).status_code==403

def test_tracking_scope_replay_and_revocation(api):
    j=started(api);url=f"/operations/jobs/{j['id']}/tracking-session"
    assert api.post(url,headers=auth('customer'),json={'consent':True}).status_code==403
    token=api.post(url,headers=auth('worker'),json={'consent':True}).json()['token'];headers={'Authorization':'Bearer '+token}
    ping={**PIN,'accuracy':5,'captured_at':time.time(),'sequence':1}
    assert api.post('/operations/tracking/position',headers=headers,json=ping).status_code==200
    assert api.post('/operations/tracking/position',headers=headers,json=ping).json()['status']=='already_received'
    assert api.get('/operations/jobs',headers=headers).status_code==401
    assert api.post('/operations/tracking/stop',headers=headers).status_code==200
    assert api.post('/operations/tracking/position',headers=headers,json={**ping,'sequence':2}).status_code==410
    job=api.get(f"/operations/jobs/{j['id']}",headers=auth('customer')).json()
    assert 'position' not in job and 'tracking_generation' not in job

def test_completion_revokes_tracking(api):
    j=started(api)
    token=api.post(f"/operations/jobs/{j['id']}/tracking-session",headers=auth('worker'),json={'consent':True}).json()['token']
    command(api,j,'submit_completion',payload={'notes':'Test completion'})
    assert api.post('/operations/tracking/position',headers={'Authorization':'Bearer '+token},json={**PIN,'accuracy':5,'captured_at':time.time(),'sequence':1}).status_code==410

def test_duplicate_capture_refund_out_of_order_and_amount(api):
    j=completed(api);p=payment_fixture(j)
    for _ in range(2):main.operations_store.run(lambda u:integration.apply_payment(u,p))
    assert len(main.operations_store.run(lambda u:u.all('receipts')))==1
    with pytest.raises(Exception):main.operations_store.run(lambda u:integration.apply_payment(u,{**p,'amount':1}))
    main.operations_store.run(lambda u:integration.apply_payment(u,{**p,'amount_refunded':100}))
    main.operations_store.run(lambda u:integration.apply_payment(u,p))
    r=main.operations_store.run(lambda u:u.get('jobs',j['id']))
    assert r['payment_status']=='partially_refunded' and r['payout_status']=='held'

def test_signed_webhook_inbox_not_proof(api,monkeypatch):
    monkeypatch.setenv('RAZORPAY_WEBHOOK_SECRET','test-hook');j=completed(api);p=payment_fixture(j)
    raw=json.dumps({'payload':{'payment':{'entity':p}}}).encode();headers={'X-Razorpay-Signature':hmac.new(b'test-hook',raw,hashlib.sha256).hexdigest()};url='/operations/webhooks/razorpay/payments'
    assert api.post(url,content=raw,headers={'X-Razorpay-Signature':'fake'}).status_code==401
    for _ in range(2):assert api.post(url,content=raw,headers=headers).status_code==200
    assert len(main.operations_store.run(lambda u:u.all('webhooks')))==1
    assert main.operations_store.run(lambda u:u.get('jobs',j['id']))['payment_status']=='pay_after_service'
    monkeypatch.setattr(integration,'razorpay',lambda *a,**kw:p if a[0].startswith('payments/') else {'items':[]})
    main.integrations_reconcile()
    assert main.operations_store.run(lambda u:u.get('jobs',j['id']))['payment_status']=='verified'

def test_order_timeout_not_duplicated(api,monkeypatch):
    for name in ('RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET'):monkeypatch.setenv(name,'test')
    monkeypatch.setenv('REPAIDO_PAYMENTS_ENABLED','true');j=completed(api);calls=[]
    def timeout(*args,**kwargs):calls.append(args);integration.fail('UNKNOWN','Timed out',503)
    monkeypatch.setattr(integration,'razorpay',timeout);url=f"/operations/jobs/{j['id']}/payment-order"
    assert api.post(url,headers=auth('customer')).status_code==503
    assert api.post(url,headers=auth('customer')).status_code==409
    assert len(calls)==1
    assert api.post(url,headers=auth('stranger')).status_code==404

def test_bank_reference_binding(api,monkeypatch):
    onboard(api,approve=False)
    def provider(path,**kwargs):
        if path.startswith('contacts/'):return {'reference_id':'other-worker'}
        return {'status':'completed','fund_account':{'id':'fa_test','contact_id':'cont_test'},'results':{'account_status':'active','registered_name':'Test professional'}}
    monkeypatch.setattr(integration,'razorpay',provider)
    assert api.post('/operations/admin/verification/worker/bank',headers=ADMIN,json={'validation_id':'fav_test','reason':'Provider account review'}).status_code==409
    assert main.operations_store.run(lambda u:u.get('verification','worker')) is None

def test_settlement_payout_retry_and_reversal(api,monkeypatch):
    j=completed(api);p=payment_fixture(j)
    policy=dict(version='test-v1',worker_share_bps=8000,penalty_cap_bps=5000,stack_penalties=True,base='worker_share_of_base_service_excluding_parts')
    def prepare(u):
        integration.apply_payment(u,p);job=u.get('jobs',j['id']);job['settlement_policy']=policy;job['penalties']=[dict(code='LATE_DEPARTURE',worker_id='worker',visit_id=job['visit_id'],current_percent=20)];u.put('jobs',job['id'],job)
    main.operations_store.run(prepare)
    s=api.post(f"/operations/admin/settlements/{j['id']}/calculate",headers=ADMIN).json()
    assert (s['gross_paise'],s['deduction_paise'],s['net_paise'])==(47920,9584,38336)
    for n in ('RAZORPAYX_KEY_ID','RAZORPAYX_KEY_SECRET','RAZORPAYX_ACCOUNT_NUMBER'):monkeypatch.setenv(n,'test')
    monkeypatch.setenv('REPAIDO_PAYOUTS_ENABLED','true');calls=[]
    result=dict(id='pout_test',reference_id=j['id'],amount=s['net_paise'],fund_account_id='fa_test',currency='INR',status='processed')
    def provider(path,body=None,**kwargs):
        calls.append((path,kwargs.get('key')))
        if len(calls)==1:integration.fail('UNKNOWN','Timeout',503)
        return result
    monkeypatch.setattr(integration,'razorpay',provider)
    url=f"/operations/admin/settlements/{j['id']}/release";body=dict(expected_net_paise=s['net_paise'],reason='Test authorized payout')
    assert api.post(url,headers=ADMIN,json=body).status_code==503
    assert api.post(url,headers=ADMIN,json=body).status_code==200
    assert calls[0][1]==calls[1][1]
    assert len(main.operations_store.run(lambda u:u.all('deductions')))==1
    main.integrations_reconcile_payout({**result,'status':'reversed'})
    assert main.operations_store.run(lambda u:u.get('deductions',j['id']))['status']=='reversed'

def test_outbox_idempotence_and_private_notifications(api,monkeypatch):
    monkeypatch.setenv('REPAIDO_PUSH_ENABLED','false');onboard(api);book(api)
    main.integrations_relay();main.integrations_relay()
    rows=main.operations_store.run(lambda u:u.all('notifications'))
    assert rows and len(rows)==len({n['id'] for n in rows})
    assert all('address' not in n and 'location' not in n and 'phone' not in n for n in rows)
    assert api.get('/operations/notifications',headers=auth('stranger')).json()['notifications']==[]
    assert api.post('/operations/internal/tick',headers=auth('worker')).status_code in (403,503)


def test_firestore_falsey_transaction_uses_firestore_not_sqlite():
    from operations import Unit
    class Transaction:
        def __bool__(self):return False
        def set(self,reference,value):self.written=(reference,value)
    class Snapshot:
        exists=True
        def to_dict(self):return {'value':7}
    class Ref:
        def get(self,transaction):return Snapshot()
    class Core:
        def fs_doc(self,kind,key):return Ref()
    tx=Transaction();u=Unit(Core(),transaction=tx)
    assert u.get('probe','a')=={'value':7}
    u.put('probe','a',{'value':8});u.flush()
    assert tx.written[1]['value']==8


def test_travel_map_scope_geofence_and_single_arrival(api,monkeypatch):
    monkeypatch.setenv('REPAIDO_PUSH_ENABLED','false')
    onboard(api)
    j,_=book(api)
    for action in ('accept','ack_reminder','depart'):j=command(api,j,action)
    url=f"/operations/jobs/{j['id']}/tracking"
    assert api.get(url,headers=auth('stranger')).status_code==404
    assert api.get(url,headers=auth('worker2')).status_code==404
    assert api.get(url,headers=auth('worker')).status_code==200
    # Approximately 95 m away with 20 m uncertainty must not count as arrival.
    j=command(api,j,'position',payload={**PIN,'lat':PIN['lat']+0.00085,'accuracy':20,'captured_at':time.time()})
    assert j['state']=='en_route'
    j=command(api,j,'position',payload={**PIN,'accuracy':5,'captured_at':time.time()})
    assert j['state']=='arrived'
    for uid in ('worker','customer'):
        tracking=api.get(url,headers=auth(uid)).json()
        assert tracking['phase']=='arrived' and tracking['status']=='live'
    j=command(api,j,'position',payload={**PIN,'accuracy':5,'captured_at':time.time()})
    events=main.operations_store.run(lambda u:[e for e in u.all('outbox') if e['event_type']=='WorkerArrived'])
    assert len(events)==1
    main.integrations_relay()
    notes=main.operations_store.run(lambda u:[n for n in u.all('notifications') if n.get('alert_kind')=='arrival'])
    assert {n['user_id'] for n in notes}=={'customer','worker'}
    assert all(n['visit_id']==j['visit_id'] and n['offer_expires_at']>time.time() for n in notes)
    main.integrations_relay()
    assert len(main.operations_store.run(lambda u:[n for n in u.all('notifications') if n.get('alert_kind')=='arrival']))==2
