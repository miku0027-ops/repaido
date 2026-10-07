"""Actual saved lifecycle emails, isolated contacts and provider fixtures only."""
import hashlib
import time
import uuid

import pytest
from fastapi import Header, HTTPException

import main
import operations
import transactional_mail as mail
from test_operations import api, auth, onboard, book, command, PIN
from test_custom_contracts import ready, query, bid, command as custom_command, PREFIX
from test_contract_work import seed as seed_contract, project, cmd
from test_worker_network import notice, apply, get, put
from test_retail_checkout import seed as seed_retail, body as retail_body, gateway
from test_shops import BODY as SHOP_APPLICATION
from test_hiring_records import setup_hire, request as hire_request, decide as hire_decision
from test_integrations import completed, payment_fixture


@pytest.fixture(autouse=True)
def disabled_transport(monkeypatch):
    monkeypatch.setenv('REPAIDO_TRANSACTIONAL_EMAIL_ENABLED','false')


def deliveries(kind=None, record=None):
    rows=main.operations_store.run(lambda u:u.all('transactional_mail_delivery'))
    return [row for row in rows if (not kind or row['kind']==kind)
            and (not record or row['payload'].get('record_id')==record)]


def expand_saved_email():
    for _ in range(64):
        if mail.dispatch(main,limit=1)['fanout_expanded']==0:return
    raise AssertionError('The isolated saved event did not finish bounded expansion.')


def contacts(*uids):
    for uid in uids:
        put('account_contacts',uid,dict(id=uid,name=uid,email=uid+'@example.com',email_verified=True,version=7))


def without_email(monkeypatch,*uids):
    for uid in uids:put('account_contacts',uid,dict(id=uid,name=uid,email=None,email_verified=False,version=8))
    def actor(authorization:str=Header(default='')):
        uid=authorization.removeprefix('Bearer ')
        if uid not in ('customer','worker','worker2','shop','stranger'):raise HTTPException(401)
        return dict(id=uid,name=uid,phone='+919876543210',phone_verified=uid.startswith('worker') or uid=='shop',
                    phone_authenticated=uid.startswith('worker') or uid=='shop')
    monkeypatch.setitem(main.app.dependency_overrides,main.current_user,actor)


def test_booking_assignment_replay_and_no_private_payload(api):
    contacts('customer','worker');onboard(api)
    job,body=book(api)
    rows=deliveries(record=job['id'])
    assert {(row['kind'],row['recipient_id']) for row in rows}=={
        ('booking_requested','customer'),('task_assignment','worker')}
    assert {row['event_id'] for row in rows} <= {event['event_id'] for event in job['events']}
    for row in rows:
        assert row['payload']==dict(record_type='booking',record_id=job['id'],path='/')
        uid=row['recipient_id']
        assert row['contact_fingerprint']==hashlib.sha256((uid+'@example.com:7').encode()).hexdigest()
        assert row['attempts']==0 and row['status']=='blocked' # SMTP is disabled in these fixtures.
    replay=api.post('/operations/bookings',headers=auth('customer'),json=body)
    assert replay.status_code==201 and len(deliveries(record=job['id']))==2
    accepted=command(api,job,'accept')
    assert {row['recipient_id'] for row in deliveries('booking_confirmed',job['id'])}=={'customer','worker'}
    unchanged=len(deliveries())
    api.get('/operations/jobs/'+job['id'],headers=auth('customer'))
    api.get('/operations/notifications',headers=auth('worker'))
    assert len(deliveries())==unchanged
    assert accepted['state']=='accepted'


def test_new_email_guard_keeps_existing_replay_and_accepted_work_access(api,monkeypatch):
    onboarding=onboard(api);job,body=book(api)
    without_email(monkeypatch,'customer','worker','worker2','shop')
    existing=api.post('/operations/bookings',headers=auth('customer'),json=body)
    assert existing.status_code==201 and existing.json()['id']==job['id']
    rejected=api.post('/operations/bookings',headers=auth('customer'),json={**body,'idempotency_key':str(uuid.uuid4())})
    assert rejected.status_code==422 and rejected.json()['detail']['code']=='EMAIL_REQUIRED'
    assert api.post('/operations/worker/onboarding',headers=auth('worker2'),json=onboarding).json()['detail']['code']=='EMAIL_REQUIRED'
    assert api.post('/operations/shop/application',headers=auth('shop'),json=SHOP_APPLICATION).json()['detail']['code']=='EMAIL_REQUIRED'
    assert api.get('/operations/worker/me',headers=auth('worker')).status_code==200
    accepted=command(api,job,'accept')
    assert accepted['state']=='accepted'
    cancelled=command(api,accepted,'cancel',uid='customer')
    assert cancelled['state']=='cancelled'
    assert {row['recipient_id'] for row in deliveries('booking_cancelled',job['id'])}=={'customer','worker'}


def test_source_failure_rolls_back_booking_and_email_together(api,monkeypatch):
    original=mail.enqueue
    def fail_after_queue(u,event_id,kind,recipients,payload):
        result=original(u,event_id,kind,recipients,payload)
        if kind=='booking_requested':raise RuntimeError('Isolated rollback boundary')
        return result
    monkeypatch.setattr(mail,'enqueue',fail_after_queue)
    with pytest.raises(RuntimeError,match='Isolated rollback boundary'):book(api)
    assert main.operations_store.run(lambda u:u.all('booking_keys'))==[]
    assert main.operations_store.run(lambda u:u.all('jobs'))==[]
    assert deliveries()==[]


def test_custom_post_proposal_award_mail_has_only_actual_participants_and_replays(ready):
    contacts('shop','worker','worker2','stranger')
    contract,create_body=query(ready)
    assert {row['recipient_id'] for row in deliveries('contract_posted',contract['id'])}=={'shop'}
    contract,proposal_body=bid(ready,contract)
    assert {row['recipient_id'] for row in deliveries('contract_proposal_submitted',contract['id'])}=={'shop','worker'}
    before=len(deliveries())
    assert ready.post(PREFIX+'/queries/'+contract['id']+'/bids',headers=auth('worker'),json=proposal_body).status_code==200
    assert ready.post(PREFIX+'/queries',headers=auth('shop'),json=create_body).status_code==201
    assert len(deliveries())==before
    owner=ready.get(PREFIX+'/queries/'+contract['id'],headers=auth('shop')).json()['query']
    awarded=custom_command(ready,owner,'award',bid_id=owner['bids'][0]['id'])
    assert awarded['project']['contract_value_paise']==800000
    assert {row['recipient_id'] for row in deliveries('contract_awarded',contract['id'])}=={'shop','worker'}
    for row in deliveries(record=contract['id']):
        assert set(row['payload'])=={'record_type','record_id','path'}
        assert row['recipient_id'] not in ('worker2','stranger')


def test_application_offer_and_acceptance_each_queue_one_pair(api):
    contacts('worker','worker2');seed_contract(api)
    p,_=project(api);p,_=notice(api,p)
    application=apply(api,p).json()
    assert {row['recipient_id'] for row in deliveries('hiring_application_applied',p['id'])}=={'worker','worker2'}
    body=dict(request_id=str(uuid.uuid4()),expected_version=application['version'],project_version=p['version'],action='offer',
              daily_rate_paise=100000,terms='Eight hours with weekly recorded payment and safety equipment.')
    path='/operations/contractor/hiring/applications/'+application['id']+'/decision'
    result=api.post(path,headers=auth('worker'),json=body)
    assert result.status_code==200,result.text
    offered=result.json()
    assert len(deliveries('hiring_application_offer',p['id']))==2
    assert deliveries('contract_agent_invited',p['id'])==[]
    assert api.post(path,headers=auth('worker'),json=body).status_code==200
    assert len(deliveries('hiring_application_offer',p['id']))==2
    current=get('contract_projects',p['id'])
    joined=cmd(api,current,'accept',uid='worker2',target_id=offered['invitation_id'])
    assert joined.status_code==200,joined.text
    assert len(deliveries('hiring_application_accept',p['id']))==2
    assert deliveries('contract_accept',p['id'])==[]
    envelope=next(row for row in main.operations_store.run(lambda u:u.all('rp_work_delivery'))
        if row.get('application_id')==application['id'] and row.get('status')=='hired')
    cancelled=cmd(api,joined.json(),'cancel')
    assert cancelled.status_code==200,cancelled.text
    assert len(deliveries('contract_cancel',p['id']))==2
    assert deliveries('hiring_application_cancel',p['id'])==[]
    import repaidians_work
    assert main.operations_store.run(lambda u:repaidians_work.delivery_allowed(u,envelope)) is False
    assert main.operations_store.run(lambda u:repaidians_work.delivery_allowed(u,{k:v for k,v in envelope.items() if k!='status'})) is False
    repaidians_work.process_updates(main,limit=1)
    closure=next(row for row in main.operations_store.run(lambda u:u.all('rp_work_delivery'))
        if row.get('application_id')==application['id'] and row.get('status')=='cancelled')
    assert main.operations_store.run(lambda u:repaidians_work.delivery_allowed(u,closure)) is True


def test_contract_cancellation_includes_actual_crew_with_bounded_fanout(api,monkeypatch):
    from operations import Unit
    seed_contract(api);p,_=project(api)
    crew=['assigned-'+str(index) for index in range(60)]
    p['team']=[dict(id=str(uuid.uuid4()),worker_id=uid,status='accepted',role='member',worker_type='technician',
        name='Fixture assigned professional',daily_rate_paise=10000,terms='Saved joining terms for this actual fixture placement.') for uid in crew]
    p['team'].extend([dict(p['team'][0],id=str(uuid.uuid4())),
        dict(id=str(uuid.uuid4()),worker_id='worker2',status='pending',role='member',worker_type='technician'),
        dict(id=str(uuid.uuid4()),worker_id='stranger',status='removed',role='member',worker_type='technician')])
    p['client_id']='shop';put('contract_projects',p['id'],p)
    writes=[];original=Unit.flush
    def capture(u):writes.append(len(u.pending));return original(u)
    monkeypatch.setattr(Unit,'flush',capture)
    result=cmd(api,p,'cancel')
    assert result.status_code==200,result.text
    assert deliveries('contract_cancel',p['id'])==[]
    expand_saved_email()
    rows=deliveries('contract_cancel',p['id'])
    assert {row['recipient_id'] for row in rows}=={'worker','worker2','shop',*crew}
    assert len(rows)==len(crew)+3 and 'stranger' not in {row['recipient_id'] for row in rows}
    assert max(writes)<100


@pytest.mark.parametrize('action,status',[('cancel','cancelled'),('complete','completed')])
def test_maximum_linked_crew_ends_from_one_project_source_without_application_fanout(api,monkeypatch,action,status):
    from operations import Unit
    import repaidians_work
    seed_contract(api);p,_=project(api,starts_at=time.time()-60)
    p.update(status='active',client_id='shop',goals=[dict(id='goal_saved',title='Completed fixture milestone',status='approved',
        note='Saved agreed scope',assignee_id=None,due_at=p['ends_at']-1,evidence='Saved inspection evidence')],team=[])
    immutable_event=dict(id='saved-joining-event',action='accept',status='hired',actor='worker2',at=time.time()-30)
    for start in range(0,500,40):
        def seed(u,start=start):
            for index in range(start,min(start+40,500)):
                uid='worker2' if index==499 else 'assigned-'+str(index)
                aid='assigned-application-'+str(index);iid='assigned-invitation-'+str(index)
                pending=index==499
                p['team'].append(dict(id=iid,worker_id=uid,application_id=aid,status='pending' if pending else 'accepted',
                    role='member',worker_type='technician',name='Fixture professional',terms='Saved work terms',daily_rate_paise=10000))
                u.put('project_applications',aid,dict(id=aid,project_id=p['id'],owner_id='worker',worker_id=uid,
                    invitation_id=iid,status='offered' if pending else 'hired',version=1,events=[immutable_event],
                    created_at=time.time()-40,updated_at=time.time()-30))
        main.operations_store.run(seed)
    put('contract_projects',p['id'],p)
    writes=[];original=Unit.flush
    def capture(u):writes.append(len(u.pending));return original(u)
    monkeypatch.setattr(Unit,'flush',capture)
    result=cmd(api,p,action)
    assert result.status_code==200,result.text
    source_writes=max(writes)
    saved=get('project_applications','assigned-application-499')
    assert saved['status']=='offered' and saved['events']==[immutable_event]
    aid=saved['id'];path='/operations/contractor/hiring/applications/'+aid
    detail=api.get(path,headers=auth('worker2'))
    assert detail.status_code==200,detail.text
    projection=detail.json()
    assert projection['status']==projection['project_status']==status
    assert projection['events'][:-1]==[immutable_event]
    assert projection['events'][-1]['id']==result.json()['events'][-1]['id']
    assert projection['events'][-1]['source']=='project' and projection['events'][-1]['action']==action
    listing=api.get('/operations/contractor/hiring/applications?scope=mine',headers=auth('worker2')).json()['applications']
    assert len(listing)==1 and listing[0]['status']==status
    assert cmd(api,result.json(),'accept',uid='worker2',target_id=saved['invitation_id']).status_code==409
    decision=api.post(path+'/decision',headers=auth('worker'),json=dict(
        request_id=str(uuid.uuid4()),expected_version=1,project_version=result.json()['version'],action='reject',note='The project has ended.'))
    assert decision.status_code==409 and decision.json()['detail']['code']=='CLOSED'
    assert main.operations_store.run(lambda u:repaidians_work.delivery_allowed(u,dict(event='application_update',
        recipient_id='worker2',sender_id='worker',application_id=aid,status='offered'))) is False
    assert source_writes<100 and max(writes)<500
    for _ in range(52):repaidians_work.process_updates(main,limit=1)
    notices=main.operations_store.run(lambda u:[row for row in u.all('notifications')
        if row.get('project_id')==p['id'] and row.get('title')=='Project '+status])
    assert len(notices)==500 and len({row['user_id'] for row in notices})==500
    envelope=next(row for row in main.operations_store.run(lambda u:u.all('rp_work_delivery'))
        if row.get('application_id')==aid and row.get('status')==status)
    assert main.operations_store.run(lambda u:repaidians_work.delivery_allowed(u,envelope)) is True
    repaidians_work.process_updates(main,limit=1)
    assert main.operations_store.run(lambda u:len([row for row in u.all('notifications')
        if row.get('project_id')==p['id'] and row.get('title')=='Project '+status]))==500
    assert get('project_applications',aid)['events']==[immutable_event]
    assert max(writes)<500
    expand_saved_email()
    rows=deliveries('contract_'+action,p['id'])
    assert len(rows)==502 and {row['recipient_id'] for row in rows}=={'worker','worker2','shop',*(
        'assigned-'+str(index) for index in range(499))}


def test_retail_confirmations_wait_for_verified_capture_and_saved_supplier_owners(api,monkeypatch):
    contacts('customer','shop','worker2');seed_retail();_,payment=gateway(monkeypatch)
    put('shops','second',dict(id='second',owner_id='worker2',status='approved',name='Second fixture supplier'))
    item=get('inventory','new');item['shop_id']='second';put('inventory','new',item)
    response=api.post('/operations/retail/orders',headers=auth('customer'),json=retail_body())
    assert response.status_code==201,response.text
    order=response.json();path='/operations/retail/orders/'+order['id']
    assert {row['recipient_id'] for row in deliveries('shop_order_saved',order['id'])}=={'customer'}
    payment['captured']=False
    assert api.post(path+'/verify',headers=auth('customer'),json={'payment_id':payment['id']}).status_code==409
    assert deliveries('shop_order_paid',order['id'])==[]
    payment['captured']=True
    for _ in range(2):assert api.post(path+'/verify',headers=auth('customer'),json={'payment_id':payment['id']}).status_code==200
    expand_saved_email()
    assert {row['recipient_id'] for row in deliveries('shop_order_paid',order['id'])}=={'customer','shop','worker2'}
    assert len(deliveries('shop_order_paid',order['id']))==3
    for _ in range(2):assert api.post(path+'/received',headers=auth('customer')).status_code==200
    expand_saved_email()
    assert len(deliveries('shop_order_received',order['id']))==3
    assert {row['recipient_id'] for row in deliveries('shop_order_received',order['id'])}=={'customer','shop','worker2'}


def test_day_hire_replay_quote_and_cancel_confirm_saved_participants(api,monkeypatch):
    contacts('customer','worker');policy=setup_hire(api,monkeypatch)
    hire,body=hire_request(api,policy)
    assert {row['recipient_id'] for row in deliveries(record=hire['id'])}=={'customer','worker'}
    count=len(deliveries(record=hire['id']))
    assert api.post('/operations/hiring/requests',headers=auth('customer'),json=body).status_code==201
    assert len(deliveries(record=hire['id']))==count
    quote=hire_decision(api,hire,'accept',position={**PIN,'accuracy':5,'captured_at':time.time()})
    assert quote.status_code==200,quote.text
    assert {row['recipient_id'] for row in deliveries('hire_request_quoted',hire['id'])}=={'customer'}
    cancelled=hire_decision(api,quote.json(),'cancel',uid='customer')
    assert cancelled.status_code==200 and cancelled.json()['state']=='cancelled'
    assert {row['recipient_id'] for row in deliveries('hire_request_cancelled',hire['id'])}=={'customer','worker'}


def test_verified_booking_capture_and_monotonic_refund_queue_once(api):
    import integrations
    contacts('customer','worker');job=completed(api);payment=payment_fixture(job)
    for _ in range(2):main.operations_store.run(lambda u:integrations.apply_payment(u,payment))
    assert len(deliveries('booking_payment_recorded',job['id']))==2
    for amount in (100,100,50,0):
        main.operations_store.run(lambda u:integrations.apply_payment(u,{**payment,'amount_refunded':amount}))
    assert len(deliveries('booking_refund_recorded',job['id']))==2
    assert {row['recipient_id'] for row in deliveries('booking_refund_recorded',job['id'])}=={'customer','worker'}
    with pytest.raises(HTTPException):
        main.operations_store.run(lambda u:integrations.apply_payment(u,{**payment,'amount':1,'amount_refunded':200}))
    assert len(deliveries('booking_refund_recorded',job['id']))==2


def test_custom_new_posts_and_proposals_require_email_but_saved_replay_withdrawal_work(ready,monkeypatch):
    contract,create_body=query(ready);contract,proposal_body=bid(ready,contract)
    without_email(monkeypatch,'shop','worker')
    assert ready.post(PREFIX+'/queries',headers=auth('shop'),json=create_body).status_code==201
    assert ready.post(PREFIX+'/queries/'+contract['id']+'/bids',headers=auth('worker'),json=proposal_body).status_code==200
    new_post=ready.post(PREFIX+'/queries',headers=auth('shop'),json={**create_body,'request_id':str(uuid.uuid4())})
    assert new_post.status_code==422 and new_post.json()['detail']['code']=='EMAIL_REQUIRED'
    new_proposal=ready.post(PREFIX+'/queries/'+contract['id']+'/bids',headers=auth('worker'),json={
        **proposal_body,'request_id':str(uuid.uuid4()),'expected_version':contract['version']})
    assert new_proposal.status_code==422 and new_proposal.json()['detail']['code']=='EMAIL_REQUIRED'
    saved=ready.get(PREFIX+'/queries/'+contract['id'],headers=auth('worker')).json()['query']
    withdrawn=custom_command(ready,saved,'withdraw_bid',uid='worker',bid_id=saved['bids'][0]['id'])
    assert withdrawn['query']['bids'][0]['status']=='withdrawn'


def test_maximum_basket_supplier_email_fanout_stays_below_transaction_cap(api,monkeypatch):
    import retail_checkout
    from operations import Unit
    size=100
    def seed(u):
        for index in range(size):
            shop='supplier-'+str(index)
            u.put('shops',shop,dict(id=shop,owner_id=shop,status='approved',name='Fixture supplier'))
            u.put('inventory','item-'+str(index),dict(id='item-'+str(index),shop_id=shop,name='Fixture item',condition='new',
                  status='approved',stock_confirmed_at=time.time(),stock=1,reserved=0,price_paise=1,gst_bps=0,version=1))
    main.operations_store.run(seed)
    monkeypatch.setattr(retail_checkout,'payments_ready',lambda:True)
    def provider(path,body=None,payout=False,key=None):
        if path=='orders':return dict(id='order_many',amount=size,currency='INR')
        if path=='payments/pay_many':return dict(id='pay_many',order_id='order_many',amount=size,currency='INR',status='captured',captured=True)
        raise AssertionError(path)
    monkeypatch.setattr(retail_checkout,'razorpay',provider)
    writes=[];original=Unit.flush
    def capture(u):writes.append(len(u.pending));return original(u)
    monkeypatch.setattr(Unit,'flush',capture)
    body=dict(items=[dict(product_id='item-'+str(index),quantity=1) for index in range(size)],expected_total_paise=size,
              recipient_name='Fixture buyer',recipient_phone='9876543210',delivery_address='Private fixture delivery address',request_id=str(uuid.uuid4()))
    result=api.post('/operations/retail/orders',headers=auth('customer'),json=body)
    assert result.status_code==201,result.text
    oid=result.json()['id'];path='/operations/retail/orders/'+oid
    assert api.post(path+'/verify',headers=auth('customer'),json={'payment_id':'pay_many'}).status_code==200
    assert api.post(path+'/received',headers=auth('customer')).status_code==200
    source_writes=max(writes)
    expand_saved_email()
    assert len(deliveries('shop_order_paid',oid))==len(deliveries('shop_order_received',oid))==101
    assert {row['recipient_id'] for row in deliveries('shop_order_paid',oid)}=={'customer',*(
        'supplier-'+str(index) for index in range(size))}
    assert source_writes<=403 and source_writes>=400 and max(writes)<500
    initial_count=len(deliveries(record=oid))
    assert api.post(path+'/verify',headers=auth('customer'),json={'payment_id':'pay_many'}).status_code==200
    assert api.post(path+'/received',headers=auth('customer')).status_code==200
    expand_saved_email()
    assert len(deliveries(record=oid))==initial_count
