"""Real HTTP shared-bike lifecycle, with isolated accounts/routes/database only.

Scheduled peer sharing intentionally keeps its published fare and approvals;
it does not borrow the company on-demand bike promotion or salary policy.
"""
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import pytest

import main
import mobility_journeys as journeys
from test_operations import api, auth, PIN
from test_local_business import BASE, vehicle, register

END = {**PIN, 'lat': PIN['lat'] + .018}


@pytest.fixture(autouse=True)
def quiet_scheduler(monkeypatch):
    # Whole-record idempotence assertions must exclude the independent scheduler.
    monkeypatch.setattr(main, 'operations_tick', lambda: None)


def publish(client, monkeypatch, *, assigned=False, vehicle_id=None, **changes):
    identifier = vehicle_id or vehicle(client, vehicle_kind='bike', seats=1)
    if assigned:
        register(client, 'worker2', 'driver')
        assert client.put(BASE+'/vehicles/'+identifier+'/driver', headers=auth('worker'),
                          json={'driver_id': 'worker2'}).status_code == 200
        response = client.post(BASE+'/driver-invitations/'+identifier, headers=auth('worker2'),
                               json={'accept': True})
        assert response.status_code == 200, response.text
    calls = []
    def road(a, b, vehicle_kind='car'):
        calls.append(vehicle_kind)
        return {'points': [a, b], 'distance_metres': 2004, 'provider': 'fixture'}
    monkeypatch.setattr(journeys, 'road_route', road)
    body = dict(request_id=str(uuid.uuid4()), vehicle_id=identifier, origin=PIN, destination=END,
                origin_address='Public station entrance', destination_address='Public market gate',
                starts_at=time.time()+7200, ends_at=time.time()+10800, seats=1,
                price_paise=2500, terms='The published fare is paid directly to the owner after this shared journey.')
    body.update(changes)
    response = client.post(BASE+'/shared', headers=auth('worker'), json=body)
    assert response.status_code == 201, response.text
    assert calls == ['bike']
    return response.json(), body


def read(client, row, uid='worker'):
    response = client.get(BASE+'/shared', headers=auth(uid))
    assert response.status_code == 200, response.text
    return next(x for x in response.json()['departures'] if x['id'] == row['id'])


def join(client, row, uid='customer', **changes):
    body = dict(request_id=str(uuid.uuid4()), expected_version=read(client, row)['version'],
                pickup=PIN, dropoff=END, seats=1, consent=True)
    body.update(changes)
    response = client.post(BASE+'/shared/'+row['id']+'/join', headers=auth(uid), json=body)
    assert response.status_code == 201, response.text
    return response.json(), body


def command(client, row, action, p=None, uid='worker', status=200, **extra):
    body = dict(command_id=str(uuid.uuid4()), expected_version=read(client, row)['version'],
                action=action, passenger_id=p['id'] if p else None, **extra)
    response = client.post(BASE+'/shared/'+row['id']+'/commands', headers=auth(uid), json=body)
    assert response.status_code == status, response.text
    return response, body


def position(client, row, pin=PIN, uid='worker', status=200):
    path=BASE+'/journeys/shared/'+row['id']
    response=client.post(path+'/consent', headers=auth(uid), json={'enabled': True})
    assert response.status_code == 200, response.text
    response=client.post(path+'/position', headers=auth(uid), json={**pin, 'accuracy':5, 'captured_at':time.time()})
    assert response.status_code == status, response.text
    return response


def native_snapshot(row, p):
    return main.operations_store.run(lambda u: {
        'departure': u.get('shared_departures', row['id']),
        'passenger': u.get('shared_passengers', p['id']),
        'notifications': u.all('notifications'),
        'commands': u.all('business_commands'),
        'push': u.all('shared_push_outbox')})


def test_shared_bike_full_lifecycle_requires_private_otp_and_real_pickup_gps(api, monkeypatch):
    row, _ = publish(api, monkeypatch)
    passenger, join_body = join(api, row)
    assert passenger['price_paise'] == 2500 and 'pickup_otp' not in passenger
    assert read(api, row, 'customer')['passengers'][0]['state'] == 'requested'
    command(api, row, 'accept', passenger)
    customer = read(api, row, 'customer')
    otp = customer['passengers'][0]['otp']
    assert len(otp) == 6 and otp.isascii() and otp.isdigit()
    owner = read(api, row)
    assert owner['can_operate'] and owner['physical_operator_id'] == 'worker'
    assert 'otp' not in owner['passengers'][0]
    assert 'pickup_otp' not in str(owner) and 'pickup_otp_attempts' not in str(customer)
    assert owner['passengers'][0]['pickup_code_required']
    replay=api.post(BASE+'/shared/'+row['id']+'/join', headers=auth('customer'), json=join_body)
    assert replay.json()['otp'] == otp and replay.headers['cache-control']=='private, no-store'
    assert api.get(BASE+'/shared',headers=auth('customer')).headers['cache-control']=='private, no-store'
    assert api.get(BASE+'/shared', headers=auth('stranger')).json()['departures'] == []
    assert main.operations_store.run(lambda u: u.get('bike_policy', 'current')) is None

    with patch('time.time', return_value=row['starts_at']):
        command(api, row, 'board', passenger, status=409, otp=otp)
        position(api, row, END)
        command(api, row, 'board', passenger, status=409, otp=otp)
    with patch('time.time', return_value=row['starts_at']+6):
        position(api, row)
        command(api, row, 'board', passenger, otp=otp)
        assert 'otp' not in read(api, row, 'customer')['passengers'][0]
        command(api, row, 'start')
        path = BASE+'/journeys/shared/'+row['id']
        shared = api.post(path+'/share', headers=auth('customer'), json={'passenger_id': passenger['id']})
        assert shared.status_code == 200, shared.text
        guest=api.get(BASE+'/guest-tracking/'+shared.json()['token'])
        assert guest.status_code == 200 and guest.json()['position']
        assert otp not in guest.text and 'pickup_otp' not in guest.text and 'customer_name' not in guest.text
        assert api.get(path+'/tracking', headers=auth('stranger')).status_code == 404
        command(api, row, 'complete', status=409)
    with patch('time.time', return_value=row['starts_at']+60):
        position(api, row, END)
        assert read(api, row)['stop_status']['destination']['status'] == 'inside'
        command(api, row, 'dropoff', passenger)
        command(api, row, 'complete')
        assert read(api, row)['state'] == 'completed'
        assert api.get(BASE+'/guest-tracking/'+shared.json()['token']).status_code == 404
        position(api, row, END, status=409)
        command(api, row, 'payment_reported', passenger, uid='customer')
        command(api, row, 'payment_received', passenger)
    final=read(api, row, 'customer')['passengers'][0]
    assert final['payment_source'] == 'owner_confirmed_receipt'
    assert final['price_paise'] == 2500 and not final.get('refund_review_required')


def test_pickup_code_attempts_are_bounded_and_retry_is_idempotent(api, monkeypatch):
    row, _=publish(api, monkeypatch)
    passenger, _=join(api, row)
    command(api, row, 'accept', passenger)
    code=read(api, row, 'customer')['passengers'][0]['otp']
    wrong='999999' if code != '999999' else '000000'
    with patch('time.time', return_value=row['starts_at']):
        position(api, row)
        response, body=command(api, row, 'board', passenger, status=409, otp=wrong)
        assert response.json()['detail']['code'] == 'PICKUP_CODE_INVALID'
        before=native_snapshot(row, passenger)
        retry=api.post(BASE+'/shared/'+row['id']+'/commands', headers=auth('worker'), json=body)
        assert retry.status_code == 409 and retry.json() == response.json()
        assert native_snapshot(row, passenger) == before
        assert before['passenger']['pickup_otp_attempts'] == 1
        command(api, row, 'board', passenger, status=422, otp='１２３４５６')
        assert native_snapshot(row, passenger) == before
        for _ in range(4): command(api, row, 'board', passenger, status=409, otp=wrong)
        locked=read(api, row)['passengers'][0]
        assert locked['pickup_code_locked'] and 'otp' not in locked
        response, _=command(api, row, 'board', passenger, status=409, otp=code)
        assert response.json()['detail']['code'] == 'PICKUP_CODE_LOCKED'
        assert main.operations_store.run(lambda u:u.get('shared_passengers', passenger['id']))['pickup_otp_attempts'] == 5


def test_previously_accepted_bike_gets_one_private_pickup_code_without_new_fare_or_status(api,monkeypatch):
    row,_=publish(api,monkeypatch)
    passenger,join_body=join(api,row)
    command(api,row,'accept',passenger)
    def legacy(u):
        p=u.get('shared_passengers',passenger['id'])
        p.pop('pickup_otp');p.pop('pickup_otp_attempts')
        u.put('shared_passengers',p['id'],p)
    main.operations_store.run(legacy)
    version=read(api,row)['version']
    assert 'otp' not in read(api,row)['passengers'][0]
    with patch('time.time',return_value=row['starts_at']):
        position(api,row)
        response,_=command(api,row,'board',passenger,status=409,otp='123456')
        assert response.json()['detail']['code']=='PICKUP_CODE_REQUIRED'
    own=read(api,row,'customer')
    code=own['passengers'][0]['otp']
    assert own['version']==version and own['passengers'][0]['price_paise']==2500
    assert own['passengers'][0]['state']=='accepted'
    assert read(api,row,'customer')['passengers'][0]['otp']==code
    assert api.post(BASE+'/shared/'+row['id']+'/join',headers=auth('customer'),json=join_body).json()['otp']==code
    with patch('time.time',return_value=row['starts_at']):
        command(api,row,'board',passenger,otp=code)


def test_fleet_owner_retains_management_and_reading_but_only_assigned_driver_can_operate(api, monkeypatch):
    row, _=publish(api, monkeypatch, assigned=True)
    passenger, _=join(api, row)
    command(api, row, 'accept', passenger)
    assert not read(api, row)['can_operate'] and read(api, row,'worker2')['can_operate']
    otp=read(api, row,'customer')['passengers'][0]['otp']
    assert 'otp' not in read(api,row,'worker2')['passengers'][0]
    path=BASE+'/journeys/shared/'+row['id']
    with patch('time.time', return_value=row['starts_at']):
        assert api.post(path+'/consent', headers=auth('worker'), json={'enabled':True}).status_code == 404
        assert api.post(path+'/tracking-session', headers=auth('worker'), json={'enabled':True}).status_code == 403
        assert api.post(path+'/position', headers=auth('worker'), json={**PIN,'accuracy':5,'captured_at':time.time()}).status_code == 404
        position(api,row,uid='worker2')
        command(api,row,'board',passenger,status=409,otp=otp)
        command(api,row,'board',passenger,uid='worker2',otp=otp)
        command(api,row,'start',status=409)
        command(api,row,'start',uid='worker2')
        assert api.get(path+'/tracking',headers=auth('worker')).json()['position']
    with patch('time.time', return_value=row['starts_at']+15):
        position(api,row,END,uid='worker2')
        command(api,row,'dropoff',passenger,status=409)
        command(api,row,'dropoff',passenger,uid='worker2')
        command(api,row,'complete',status=409)
        command(api,row,'complete',uid='worker2')


@pytest.mark.parametrize('native', [False, True])
def test_started_shared_bike_can_keep_tracking_and_finish_after_approval_pause(api, monkeypatch, native):
    row, _=publish(api,monkeypatch)
    passenger, _=join(api,row)
    command(api,row,'accept',passenger)
    otp=read(api,row,'customer')['passengers'][0]['otp']
    path=BASE+'/journeys/shared/'+row['id']
    with patch('time.time', return_value=row['starts_at']):
        position(api,row)
        command(api,row,'board',passenger,otp=otp)
        command(api,row,'start')
        def pause(u):
            partner=u.get('business_partners','worker');partner['status']='rejected'
            u.put('business_partners','worker',partner)
        main.operations_store.run(pause)
    with patch('time.time', return_value=row['starts_at']+15):
        if native:
            session=api.post(path+'/tracking-session',headers=auth('worker'),json={'enabled':True})
            assert session.status_code == 200,session.text
            response=api.post('/operations/tracking/position',headers=auth(session.json()['token']),json={**END,'accuracy':5,'captured_at':time.time(),'sequence':1})
            assert response.status_code == 200,response.text
        else:position(api,row,END)
        assert api.get(path+'/tracking',headers=auth('customer')).json()['position']
        command(api,row,'dropoff',passenger)
        command(api,row,'complete')
        assert read(api,row)['state'] == 'completed'


def test_cash_acknowledgements_do_not_mutate_again_and_cancel_flags_manual_refund_review(api,monkeypatch):
    row,_=publish(api,monkeypatch)
    passenger,_=join(api,row)
    command(api,row,'accept',passenger)
    command(api,row,'payment_reported',passenger,uid='customer')
    before=native_snapshot(row,passenger)
    command(api,row,'payment_reported',passenger,uid='customer')
    assert native_snapshot(row,passenger) == before
    command(api,row,'payment_received',passenger)
    before=native_snapshot(row,passenger)
    command(api,row,'payment_received',passenger)
    assert native_snapshot(row,passenger) == before
    command(api,row,'cancel',passenger,uid='customer')
    p=read(api,row,'customer')['passengers'][0]
    assert p['state']=='cancelled' and p['refund_review_required'] is True
    assert p['payment_source']=='owner_confirmed_receipt' and 'refunded_at' not in p


@pytest.mark.parametrize('mutation', ['kind','approval','driver','capacity'])
def test_changed_vehicle_cannot_remain_discoverable_or_accept_existing_passenger(api,monkeypatch,mutation):
    row,_=publish(api,monkeypatch)
    passenger,_=join(api,row)
    def change(u):
        departure=u.get('shared_departures',row['id']);v=u.get('mobility_vehicles',departure['vehicle_id'])
        key,value={'kind':('vehicle_kind','car'),'approval':('status','rejected'),'driver':('driver_id','worker2'),'capacity':('seats',2)}[mutation]
        v[key]=value;u.put('mobility_vehicles',v['id'],v)
    main.operations_store.run(change)
    body={'pickup':PIN,'dropoff':END,'starts_at':time.time(),'until':row['starts_at']+300,'seats':1,'vehicle_kind':'bike'}
    assert api.post(BASE+'/shared/search',json=body).json()['departures']==[]
    assert api.get(BASE+'/transport/nearby',params=PIN).json()['departures']==[]
    response,_=command(api,row,'accept',passenger,status=409)
    assert response.json()['detail']['code']=='UNAVAILABLE'
    assert api.post(BASE+'/shared/'+row['id']+'/join',headers=auth('stranger'),json={
        'request_id':str(uuid.uuid4()),'expected_version':read(api,row)['version'],
        'pickup':PIN,'dropoff':END,'seats':1,'consent':True}).status_code==409


def test_concurrent_distinct_requests_from_same_customer_reserve_only_one_request(api,monkeypatch):
    row,_=publish(api,monkeypatch)
    def attempt(_):
        return api.post(BASE+'/shared/'+row['id']+'/join',headers=auth('customer'),json={
            'request_id':str(uuid.uuid4()),'expected_version':row['version'],
            'pickup':PIN,'dropoff':END,'seats':1,'consent':True})
    with ThreadPoolExecutor(2) as pool:responses=list(pool.map(attempt,range(2)))
    assert sorted(r.status_code for r in responses)==[201,409]
    assert len(read(api,row)['passengers'])==1
    assert len(main.operations_store.run(lambda u:u.all('shared_participant_locks')))==1
