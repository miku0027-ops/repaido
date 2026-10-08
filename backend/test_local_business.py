"""Real isolated HTTP requests; gateway, documents and routes are test-only."""
import time,uuid
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
import pytest
import main,local_business
from test_operations import api,auth,ADMIN,PIN
BASE='/operations/local-business'
def doc(uid):
    mid=str(uuid.uuid4());main.operations_store.run(lambda u:u.put('business_documents',mid,dict(id=mid,owner_id=uid,object='test/'+mid,created_at=time.time())));return mid

def register(api,uid='worker',role='cab_owner'):
    r=api.put(BASE+'/partner',headers=auth(uid),json=dict(name='Test owner',role=role,city='Balasore',address='Private business address 123',location=PIN,document_ids=[doc(uid)],terms=True));assert r.status_code==200,r.text
    approve(api,'partner',uid)
def approve(api,kind,identifier):
    r=api.post(f'{BASE}/admin/{kind}/{identifier}/review',headers=ADMIN,json=dict(approved=True,expected_version=1,reason='Test original documents checked',evidence_reference='test-documents-reviewed',valid_until=time.time()+365*86400));assert r.status_code==200,r.text

def vehicle(api,uid='worker',**extra):
    register(api,uid);identifier=str(uuid.uuid4())
    data=dict(expected_version=0,name='Test sedan',registration='OD01AB1234',mode='cab',seats=4,transmission='manual',fuel='petrol',location=PIN,origin_address='Fixture vehicle pickup address 123',base_paise=0,per_km_paise=5000,daily_paise=150000,included_daily_km=100,gst_bps=0,terms='Test vehicle conditions and return terms.',document_ids=[doc(uid)],active=True);data.update(extra)
    r=api.put(BASE+'/vehicles/'+identifier,headers=auth(uid),json=data);assert r.status_code==200,r.text;approve(api,'vehicle',identifier);return identifier
@pytest.fixture
def route(monkeypatch):monkeypatch.setattr(local_business,'route_metres',lambda a,b:10000)
def quote(api,vid,**extra):
    data=dict(vehicle_id=vid,pickup=PIN,dropoff=dict(lat=PIN['lat']+.05,lng=PIN['lng']+.05),starts_at=time.time()+7200,ends_at=time.time()+18000,mode='cab',trip='one_way');data.update(extra)
    r=api.post(BASE+'/quotes',headers=auth('customer'),json=data);assert r.status_code==201,r.text;return r.json()
def request(api,quotes,**extra):
    data=dict(quote_ids=[q['id'] for q in quotes],pickup_address='Private pickup entrance 123',dropoff_address='Destination entrance 456',phone='9876543210',request_id=str(uuid.uuid4()),consent=True);data.update(extra)
    r=api.post(BASE+'/rides',headers=auth('customer'),json=data);assert r.status_code==201,r.text;return r.json(),data

def latest(api,row,uid='customer',kind='rides'):
    r=api.get(BASE+'/'+kind,headers=auth(uid));assert r.status_code==200,r.text
    return next(x for x in r.json()['rides' if kind=='rides' else 'collections'] if x['id']==row['id'])
def act(api,row,action,uid='customer',kind='rides',status=200,**extra):
    if action in ('start','complete') and kind=='rides' and 'position' not in extra:
        pin=row.get('vehicle_pickup_location',PIN) if row.get('mode')=='rental' else row.get('pickup',PIN) if action=='start' or row.get('trip')=='round_trip' else row.get('dropoff',PIN)
        extra['position']={**pin,'accuracy':5,'captured_at':time.time()}
    row=latest(api,row,uid,kind);r=api.post(f'{BASE}/{kind}/{row["id"]}/commands',headers=auth(uid),json=dict(action=action,expected_version=row['version'],command_id=str(uuid.uuid4()),**extra));assert r.status_code==status,r.text;return r.json()
@pytest.fixture
def gateway(monkeypatch):
    for name in ('RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET'):monkeypatch.setenv(name,'test-only')
    monkeypatch.setenv('REPAIDO_PAYMENTS_ENABLED','true');orders={};payments={};refunds={}
    def provider(path,body=None,**kwargs):
        if path=='orders':
            identifier='order_'+str(len(orders)+1);orders[identifier]=dict(id=identifier,**body);return orders[identifier]
        if path.startswith('orders?receipt='):return {'items':[x for x in orders.values() if x['receipt']==path.split('=',1)[1]]}
        if path.endswith('/refund'):
            pid=path.split('/')[1];identifier='rfnd_'+str(len(refunds)+1);refunds[identifier]=dict(id=identifier,payment_id=pid,status='processed',**body);payments[pid].update(amount_refunded=body['amount'],status='refunded');return refunds[identifier]
        if '/refunds?' in path:return {'items':list(refunds.values())}
        if path.startswith('payments/'):return payments[path.split('/')[1]]
        raise AssertionError(path)
    monkeypatch.setattr('integrations.razorpay',provider);return orders,payments,refunds

def pay(api,row,gateway,kind='advance',**extra):
    r=api.post(f'{BASE}/rides/{row["id"]}/payment-order?kind={kind}',headers=auth('customer'));assert r.status_code==200,r.text
    order=r.json();pid='pay_'+str(len(gateway[1])+1);value=dict(id=pid,order_id=order['order_id'],amount=order['amount'],currency='INR',status='captured',captured=True,amount_refunded=0);value.update(extra);gateway[1][pid]=value
    return api.post(f'{BASE}/rides/{row["id"]}/payment-check',headers=auth('customer'),json=dict(payment_id=pid))

def test_full_cab_lifecycle_and_advance_gate(api,route,gateway):
    q=quote(api,vehicle(api));assert q['total_paise']==150000 and q['balance_paise']==100000 and 'origin' not in q
    row,body=request(api,[q]);assert api.post(BASE+'/rides',headers=auth('customer'),json=body).json()['id']==row['id']
    candidate=latest(api,row,'worker');assert 'pickup' not in candidate and 'phone' not in candidate and 'pickup' not in candidate['quote']
    row=act(api,row,'accept','worker');act(api,row,'depart','worker',status=409)
    assert pay(api,row,gateway).status_code==200
    row=act(api,row,'depart','worker')
    with patch('time.time',return_value=q['starts_at']):row=act(api,row,'start','worker',odometer_km=1000,note='Customer pickup condition checked')
    row=act(api,row,'complete','worker',odometer_km=1040,note='Journey and vehicle condition checked')
    assert row['state']=='completion_pending';row=act(api,row,'confirm');assert row['state']=='balance_due'
    assert pay(api,row,gateway,'balance').status_code==200
    assert latest(api,row)['state']=='completed' and sum(p['amount'] for p in gateway[1].values())==150000

def test_first_accept_is_atomic_and_driver_cannot_double_book(api,route):
    a=vehicle(api);b=vehicle(api,'worker2');q1=quote(api,a);q2=quote(api,b,starts_at=q1['starts_at'],ends_at=q1['ends_at']);row,_=request(api,[q1,q2])
    def accept(uid):return api.post(f'{BASE}/rides/{row["id"]}/commands',headers=auth(uid),json=dict(action='accept',expected_version=1,command_id=str(uuid.uuid4())))
    with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(accept,['worker','worker2']))
    assert sorted(r.status_code for r in results)==[200,409]
    winner=latest(api,row)['owner_id'];owner=latest(api,row,winner);assert all(q['owner_id']==winner for q in owner['quotes'])
    r=api.post(BASE+'/quotes',headers=auth('customer'),json=dict(vehicle_id=a if winner=='worker' else b,pickup=PIN,dropoff=PIN,starts_at=q1['starts_at'],ends_at=q1['ends_at'],mode='cab'));assert r.status_code==409

def test_minimum_fare_and_wrong_amount_rejected(api,route,gateway):
    q=quote(api,vehicle(api,per_km_paise=100));assert q['total_paise']==50000 and q['minimum_adjustment_paise']==47000
    row,_=request(api,[q]);row=act(api,row,'accept','worker');assert pay(api,row,gateway,amount=1).status_code==409
    assert latest(api,row)['advance_paid_paise']==0;act(api,row,'depart','worker',status=409)

def test_refund_and_payment_retries_do_not_duplicate_money(api,route,gateway):
    row,_=request(api,[quote(api,vehicle(api))]);row=act(api,row,'accept','worker')
    assert pay(api,row,gateway).status_code==200;row=act(api,row,'cancel');path=f'{BASE}/rides/{row["id"]}/refund'
    assert api.post(path,headers=auth('customer')).json()['status']=='processed'
    assert api.post(path,headers=auth('customer')).json()['status']=='processed'
    assert len(gateway[2])==1 and latest(api,row)['advance_paid_paise']==0
    act(api,row,'depart','worker',status=409)

def test_outside_eight_km_not_bookable(api,route):
    vid=vehicle(api,location=dict(lat=PIN['lat']+1,lng=PIN['lng']))
    body=dict(pickup=PIN,starts_at=time.time()+7200,ends_at=time.time()+18000,mode='cab')
    assert api.post(BASE+'/vehicles/search',json=body).json()['vehicles']==[]
    assert api.post(BASE+'/quotes',headers=auth('customer'),json=dict(**body,vehicle_id=vid,dropoff=PIN)).status_code==409

def test_rental_actual_odometer_requires_customer_review(api,route,gateway):
    start=time.time()+7200;q=quote(api,vehicle(api,mode='rental'),mode='rental',starts_at=start,ends_at=start+2*86400)
    row,_=request(api,[q],license_document_id=doc('customer'));row=act(api,row,'accept','worker');assert pay(api,row,gateway).status_code==200
    with patch('time.time',return_value=start):row=act(api,row,'start','worker',odometer_km=1000,note='Original licence and pickup checked')
    row=act(api,row,'complete','worker',odometer_km=1250,note='Return odometer and condition checked')
    assert row['state']=='completion_pending' and row['final_breakdown']['excess_km']==50 and row['total_paise']==550000
    assert api.post(f'{BASE}/rides/{row["id"]}/payment-order?kind=balance',headers=auth('customer')).status_code==409

def test_scrap_weight_quote_receipt_and_privacy(api):
    register(api,role='scrap_owner');body=dict(material='metal',description='Test household metal scrap',estimated_kg=10,location=PIN,address='Private collection address 123',city='Balasore',starts_at=time.time()+7200,phone='9876543210',request_id=str(uuid.uuid4()))
    r=api.post(BASE+'/scrap',headers=auth('customer'),json=body);assert r.status_code==201,r.text;row=r.json()
    candidate=latest(api,row,'worker','scrap');assert 'address' not in candidate and 'location' not in candidate
    row=act(api,row,'accept','worker','scrap');evaluation=dict(expected_version=row['version'],command_id=str(uuid.uuid4()),lines=[dict(material='Steel',grade='Clean dry metal',gross_grams=10500,tare_grams=500,price_paise_per_kg=2500)],note='Inspected and scale zeroed before weighing',scale_reference='test-scale-123',weighing_document_id=doc('worker'))
    r=api.post(f'{BASE}/scrap/{row["id"]}/evaluation',headers=auth('worker'),json=evaluation);assert r.status_code==200,r.text;row=r.json();assert row['evaluation']['total_paise']==25000
    act(api,row,'paid','worker','scrap',status=422,reference='test-transfer-1')
    row=act(api,row,'agree',kind='scrap');row=act(api,row,'paid','worker','scrap',reference='test-transfer-1');assert row['state']=='payment_reported'
    row=act(api,row,'received',kind='scrap');assert row['state']=='completed' and row['payment_source']=='customer_confirmed_receipt'
    assert api.get(BASE+'/scrap',headers=auth('stranger')).json()['collections']==[]

def test_invalid_weights_rejected():
    for gross,tare in [(10,11),(10.5,0)]:
        with pytest.raises(ValueError):local_business.ScrapLine(material='Steel',grade='Clean',gross_grams=gross,tare_grams=tare,price_paise_per_kg=100)

def test_legacy_reviews_do_not_invent_specific_scores():
    from worker_records import professional_performance
    scores=professional_performance([dict(state='completed',review=dict(rating=5))])['scores'];assert all(x['score'] is None for x in scores.values())
    scores=professional_performance([dict(state='completed',review=dict(rating=5,dimensions=dict(behavior=4,work_quality=5)),verified_arrived_at=1900,verified_arrival_starts_epoch=1000)])['scores']
    assert scores['behavior']['score']==80 and scores['work_quality']['score']==100 and scores['skills']['score'] is None and scores['punctuality']['score']==100

def test_vehicle_suspension_blocks_departure_and_expired_quote_accept(api,route,gateway):
    vid=vehicle(api);q=quote(api,vid);row,_=request(api,[q]);row=act(api,row,'accept','worker');assert pay(api,row,gateway).status_code==200
    def suspend(u):
        v=u.get('mobility_vehicles',vid);v['status']='rejected';u.put('mobility_vehicles',vid,v)
    main.operations_store.run(suspend);act(api,row,'depart','worker',status=409)
    assert latest(api,row)['state']=='reserved'

def test_payment_order_timeout_recovers_without_second_order(api,route,gateway,monkeypatch):
    import integrations
    row,_=request(api,[quote(api,vehicle(api))]);row=act(api,row,'accept','worker');real=integrations.razorpay
    def uncertain(path,body=None):
        result=real(path,body)
        if path=='orders':raise RuntimeError('test-only uncertain response')
        return result
    monkeypatch.setattr(integrations,'razorpay',uncertain)
    with pytest.raises(RuntimeError):api.post(f'{BASE}/rides/{row["id"]}/payment-order',headers=auth('customer'))
    r=api.post(f'{BASE}/rides/{row["id"]}/payment-order',headers=auth('customer'))
    assert r.status_code==200 and len(gateway[0])==1

def test_day_offer_is_funded_and_frozen_in_accepted_quote(api,monkeypatch):
    from test_hiring_records import setup_hire,request as hire_request,decide
    from integrations import settlement
    p=setup_hire(api,monkeypatch)
    offer=api.post('/operations/worker/home-offers',headers=auth('worker'),json=dict(service_id='day:ac',percent=10,ends_at=time.time()+45*86400));assert offer.status_code==200,offer.text
    h,_=hire_request(api,p);r=decide(api,h,'accept',position={**PIN,'accuracy':5,'captured_at':time.time()});assert r.status_code==200,r.text
    h=r.json();assert h['quote']['professional_offer']['discount_paise']==4990
    api.delete('/operations/worker/home-offers/'+offer.json()['id'],headers=auth('worker'))
    r=decide(api,h,'confirm','customer');assert r.status_code==200,r.text
    def complete(u):
        j=u.get('jobs',r.json()['job_id']);assert j['vendor_discount_paise']==4990 and j['total_paise']==60972
        j.update(state='completed',payment_status='verified');u.put('jobs',j['id'],j);return settlement(u,j['id'])
    paid=main.operations_store.run(complete);assert paid['vendor_discount_paise']==4990 and paid['net_paise']==paid['gross_paise']-4990+6000
    invalid=api.post('/operations/worker/home-offers',headers=auth('worker'),json=dict(service_id='day:ac',percent=10,ends_at=time.time()+70*86400));assert invalid.status_code==422

def test_admin_resolution_does_not_skip_customer_completion(api,route,gateway):
    row,_=request(api,[quote(api,vehicle(api))]);row=act(api,row,'accept','worker');assert pay(api,row,gateway).status_code==200
    with patch('time.time',return_value=row['starts_at']):row=act(api,row,'start','worker',odometer_km=100,note='Pickup condition was checked')
    row=act(api,row,'complete','worker',odometer_km=110,note='Return condition was checked');row=act(api,row,'dispute',note='Customer needs route details reviewed')
    data=dict(expected_version=row['version'],action='resume',reference='CASE-TEST-123',note='Reviewed with both parties; return for customer approval.')
    path=f'{BASE}/admin/reconciliation/rides/{row["id"]}'
    assert api.post(path,headers=auth('worker'),json=data).status_code==403
    r=api.post(path,headers=ADMIN,json=data);assert r.status_code==200,r.text
    assert r.json()['state']=='completion_pending' and not r.json()['financial_hold']
    assert api.post(f'{BASE}/rides/{row["id"]}/payment-order?kind=balance',headers=auth('customer')).status_code==409
    row=act(api,row,'confirm');assert pay(api,row,gateway,'balance').status_code==200;row=latest(api,row)
    data.update(expected_version=row['version'],action='record_settlement',amount_paise=1)
    assert api.post(path,headers=ADMIN,json=data).status_code==422
    data['amount_paise']=row['total_paise'];r=api.post(path,headers=ADMIN,json=data);assert r.status_code==200,r.text
    assert r.json()['settlement']['source']=='operator_reported_transfer'
    row=act(api,row,'settlement_received','worker');assert row['settlement']['source']=='owner_confirmed_receipt'

def test_offer_editor_lists_approved_day_categories(api,monkeypatch):
    from test_hiring_records import setup_hire
    setup_hire(api,monkeypatch)
    r=api.get('/operations/worker/home-offers',headers=auth('worker'));assert r.status_code==200,r.text
    assert any(s['id']=='day:ac' for s in r.json()['services'])
