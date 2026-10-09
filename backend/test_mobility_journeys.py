"""Isolated real HTTP workflows; no production routing, GPS, payments or accounts."""
import time,uuid
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor
import pytest
import main,mobility_journeys as journeys
from test_operations import api,auth,ADMIN,PIN,onboard
from test_local_business import vehicle,register,quote,request,act,pay,route,gateway,BASE
END={'lat':PIN['lat']+.1,'lng':PIN['lng']}

def uid():return str(uuid.uuid4())
def make(api,monkeypatch,**changes):
    vid=vehicle(api)
    monkeypatch.setattr(journeys,'road_route',lambda a,b:{'points':[a,b],'distance_metres':11132})
    data=dict(request_id=uid(),vehicle_id=vid,origin=PIN,destination=END,origin_address='Public starting point',destination_address='Public destination point',starts_at=time.time()+7200,ends_at=time.time()+18000,seats=1,price_paise=15000,pickup_mode='meeting_point',terms='Pay the owner directly after the agreed journey.')
    data.update(changes);r=api.post(BASE+'/shared',headers=auth('worker'),json=data);assert r.status_code==201,r.text
    return r.json(),data

def join(api,row,user='customer',**changes):
    body=dict(request_id=uid(),expected_version=row['version'],pickup=PIN,dropoff=END,seats=1,consent=True);body.update(changes)
    return api.post(f'{BASE}/shared/{row["id"]}/join',headers=auth(user),json=body)
def latest(api,row):return next(x for x in api.get(BASE+'/shared',headers=auth('worker')).json()['departures'] if x['id']==row['id'])
def command(api,row,action,p=None,user='worker',status=200,**changes):
    data=dict(command_id=uid(),expected_version=latest(api,row)['version'],action=action,passenger_id=p['id'] if p else None);data.update(changes)
    r=api.post(f'{BASE}/shared/{row["id"]}/commands',headers=auth(user),json=data);assert r.status_code==status,r.text
    return r.json()
def position(api,row,pin=PIN,user='worker',kind='shared',status=200):
    path=f'{BASE}/journeys/{kind}/{row["id"]}'
    r=api.post(path+'/consent',headers=auth(user),json={'enabled':True});assert r.status_code==200,r.text
    r=api.post(path+'/position',headers=auth(user),json={**pin,'accuracy':5,'captured_at':time.time()});assert r.status_code==status,r.text;return r

def test_route_direction_capacity_and_atomic_acceptance(api,monkeypatch):
    row,body=make(api,monkeypatch)
    search=dict(pickup=PIN,dropoff=END,starts_at=time.time(),until=time.time()+86400,seats=1)
    assert len(api.post(BASE+'/shared/search',json=search).json()['departures'])==1
    assert api.post(BASE+'/shared/search',json={**search,'pickup':END,'dropoff':PIN}).json()['departures']==[]
    assert api.post(BASE+'/shared/search',json={**search,'pickup':{'lat':0,'lng':0}}).json()['departures']==[]
    a=join(api,row).json();b=join(api,row,'stranger').json()
    def accept(p):return api.post(f'{BASE}/shared/{row["id"]}/commands',headers=auth('worker'),json=dict(command_id=uid(),expected_version=1,action='accept',passenger_id=p['id']))
    with ThreadPoolExecutor(2) as pool:codes=list(pool.map(lambda p:accept(p).status_code,[a,b]))
    assert sorted(codes)==[200,409]
    assert api.post(BASE+'/shared/search',json=search).json()['departures']==[]
    assert api.post(BASE+'/shared',headers=auth('worker'),json=body).json()['id']==row['id']
    assert api.post(BASE+'/shared',headers=auth('worker'),json={**body,'price_paise':1}).status_code==409

def test_boarding_geofence_live_guest_revocation_and_end(api,monkeypatch):
    row,_=make(api,monkeypatch);p=join(api,row).json();command(api,row,'accept',p)
    with patch('time.time',return_value=row['starts_at']):
        command(api,row,'start',status=409)
        command(api,row,'board',p,status=409)
        position(api,row,END);command(api,row,'board',p,status=409)
    with patch('time.time',return_value=row['starts_at']+15):
        position(api,row);command(api,row,'board',p);command(api,row,'start')
        path=f'{BASE}/journeys/shared/{row["id"]}'
        assert api.get(path+'/tracking',headers=auth('stranger')).status_code==404
        assert api.post(path+'/share',headers=auth('worker'),json={'passenger_id':p['id']}).status_code==409
        def share():
            r=api.post(path+'/share',headers=auth('customer'),json={'passenger_id':p['id']});assert r.status_code==200,r.text;return r.json()['token']
        token=share();guest=api.get(BASE+'/guest-tracking/'+token);assert guest.status_code==200 and guest.json()['position']
        assert guest.headers['cache-control']=='private, no-store'
        assert 'customer_name' not in guest.text and 'phone' not in guest.text
        token2=share();assert api.get(BASE+'/guest-tracking/'+token).status_code==404
        api.delete(path+'/share',headers=auth('customer'));assert api.get(BASE+'/guest-tracking/'+token2).status_code==404
        token=share();command(api,row,'dropoff',p,status=409)
    with patch('time.time',return_value=row['starts_at']+100):
        assert api.get(BASE+'/guest-tracking/'+token).json()['position'] is None
        position(api,row,END);command(api,row,'dropoff',p)
        assert api.get(BASE+'/guest-tracking/'+token).status_code==404
        command(api,row,'complete');assert latest(api,row)['state']=='completed'
        position(api,row,END,status=409)

def test_private_position_consent_precision_and_native_session(api,monkeypatch):
    row,_=make(api,monkeypatch);path=f'{BASE}/journeys/shared/{row["id"]}'
    with patch('time.time',return_value=row['starts_at']):
        data={**PIN,'accuracy':5,'captured_at':time.time()}
        assert api.post(path+'/position',headers=auth('worker'),json=data).status_code==409
        assert api.post(path+'/consent',headers=auth('stranger'),json={'enabled':True}).status_code==404
        session=api.post(path+'/tracking-session',headers=auth('worker'),json={'enabled':True});assert session.status_code==200,session.text
        headers=auth(session.json()['token']);ping={**data,'sequence':1}
        assert api.post('/operations/tracking/position',headers=headers,json={**ping,'accuracy':200}).status_code==422
        assert api.post('/operations/tracking/position',headers=headers,json=ping).status_code==200
        assert api.post('/operations/tracking/position',headers=headers,json=ping).json()['status']=='already_received'
        api.post(path+'/consent',headers=auth('worker'),json={'enabled':False})
        assert api.post('/operations/tracking/position',headers=headers,json={**ping,'sequence':2}).status_code==410

def test_driver_assignment_and_owner_only_tariffs(api,monkeypatch):
    vid=vehicle(api);register(api,'worker2','driver')
    before=api.get(BASE+'/partner',headers=auth('worker')).json()['vehicles'][0]
    assert api.put(BASE+'/vehicles/'+vid+'/driver',headers=auth('worker'),json={'driver_id':'worker2'}).status_code==200
    assert api.get(BASE+'/driver-invitations',headers=auth('stranger')).json()['invitations']==[]
    answer=api.post(BASE+'/driver-invitations/'+vid,headers=auth('worker2'),json={'accept':True});assert answer.status_code==200,answer.text
    assert main.operations_store.run(lambda u:u.get('mobility_vehicles',vid))['driver_id']=='worker2'
    from local_business import Vehicle
    data={k:before[k] for k in Vehicle.model_fields if k in before};data['expected_version']=before['version']
    assert api.put(BASE+'/vehicles/'+vid,headers=auth('worker2'),json=data).status_code==403
    assert api.get('/operations/worker/me',headers=auth('worker2')).json()['registered_role']=='driver'

def test_profile_versions_cannot_overwrite_another_business(api):
    register(api);p=api.get(BASE+'/partner',headers=auth('worker')).json()['partner']
    data={k:p[k] for k in ('name','city','address','location','document_ids','terms')};data.update(role='driver',expected_version=p['version'])
    assert api.put(BASE+'/partner',headers=auth('worker'),json=data).status_code==409
    onboard(api,'worker2')
    from test_local_business import doc
    data.update(expected_version=0,document_ids=[doc('worker2')])
    application=api.put(BASE+'/partner',headers=auth('worker2'),json=data)
    assert application.status_code==200 and application.json()['status']=='pending'
    me=api.get('/operations/worker/me',headers=auth('worker2')).json()
    assert me['worker']['status']=='approved' and set(me['registered_roles'])=={'technician','driver'}

def test_departure_blocks_conflicting_cab_or_rental(api,monkeypatch,route):
    row,_=make(api,monkeypatch);vid=main.operations_store.run(lambda u:u.get('shared_departures',row['id']))['vehicle_id']
    search=api.post(BASE+'/vehicles/search',json=dict(pickup=PIN,starts_at=row['starts_at'],ends_at=row['ends_at'],mode='cab'))
    assert search.status_code==200 and not search.json()['vehicles']
    command(api,row,'cancel');assert api.post(BASE+'/vehicles/search',json=dict(pickup=PIN,starts_at=row['starts_at'],ends_at=row['ends_at'],mode='cab')).json()['vehicles']

def test_rental_tracker_requires_consent_and_stops_at_completion(api,route,gateway):
    vid=vehicle(api,mode='rental');q=quote(api,vid,mode='rental');from test_local_business import doc
    row,_=request(api,[q],license_document_id=doc('customer'));row=act(api,row,'accept','worker');assert pay(api,row,gateway).status_code==200
    token=api.post(BASE+'/vehicles/'+vid+'/tracker',headers=auth('worker'),json={}).json()['token']
    with patch('time.time',return_value=row['starts_at']):
        row=act(api,row,'start','worker',odometer_km=100,note='Original licence and vehicle checked')
        ping={**PIN,'accuracy':5,'captured_at':time.time()};path=BASE+'/vehicles/'+vid+'/telemetry'
        assert api.post(path,headers={'X-Vehicle-Token':token},json=ping).status_code==409
        api.post(f'{BASE}/journeys/rides/{row["id"]}/consent',headers=auth('customer'),json={'enabled':True})
        assert api.post(path,headers={'X-Vehicle-Token':'wrong'},json=ping).status_code==404
        assert api.post(path,headers={'X-Vehicle-Token':token},json=ping).json()['source']=='vehicle_tracker'
        private=api.get(f'{BASE}/journeys/rides/{row["id"]}/tracking',headers=auth('worker'));assert private.json()['position']
        row=act(api,row,'complete','worker',odometer_km=110,note='Returned in checked condition')
        assert api.post(path,headers={'X-Vehicle-Token':token},json=ping).status_code==409

def test_cab_pickup_and_completion_need_precise_gps_at_agreed_pin(api,route,gateway):
    row,_=request(api,[quote(api,vehicle(api))]);row=act(api,row,'accept','worker');assert pay(api,row,gateway).status_code==200
    with patch('time.time',return_value=row['starts_at']):
        act(api,row,'start','worker',odometer_km=100,note='Customer is boarding the car',position={**END,'accuracy':5,'captured_at':time.time()},status=409)
        act(api,row,'start','worker',odometer_km=100,note='Customer is boarding the car',position=None,status=409)
        row=act(api,row,'start','worker',odometer_km=100,note='Customer is boarding the car')
        act(api,row,'complete','worker',odometer_km=110,note='Customer reached destination',position={**PIN,'accuracy':5,'captured_at':time.time()},status=409)
        row=act(api,row,'complete','worker',odometer_km=110,note='Customer reached destination');assert row['state']=='completion_pending'

def test_hire_confirmation_preserves_configured_workday_duration(api,monkeypatch):
    from test_hiring_records import setup_hire,request as hire_request,decide
    p=setup_hire(api,monkeypatch);p.update(version='configured-ten-hours',day_hours=10)
    assert api.put('/operations/admin/hiring-policy',headers=ADMIN,json=p).status_code==200
    assert api.post('/operations/worker/hire-membership/accept',headers=auth('worker'),json={'version':p['version'],'radius_km':8,'consent':True}).status_code==200
    h,_=hire_request(api,p);h=decide(api,h,'accept',position={**PIN,'accuracy':5,'captured_at':time.time()}).json()
    r=decide(api,h,'confirm','customer');assert r.status_code==200,r.text
    job=main.operations_store.run(lambda u:u.get('jobs',r.json()['job_id']));assert job['duration_minutes']==600

def test_competing_distinct_booking_requests_cannot_reserve_one_vehicle(api,route):
    q=quote(api,vehicle(api));a,_=request(api,[q]);b,_=request(api,[q])
    def accept(row):return api.post(f'{BASE}/rides/{row["id"]}/commands',headers=auth('worker'),json=dict(action='accept',command_id=uid(),expected_version=row['version'])).status_code
    with ThreadPoolExecutor(2) as pool:codes=list(pool.map(accept,[a,b]))
    assert sorted(codes)==[200,409]
