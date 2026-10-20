"""Company on-demand and peer shared bikes must reserve the same resources."""
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest

import main
import bike_dispatch as dispatch
import bike_rides as bikes
import mobility_journeys as journeys
from local_business import digest
from test_operations import api, auth, PIN
from test_local_business import BASE as SHARED_BASE
from test_bike_rides import BASE, DROP, setup_bike, search, book, command, latest, gps


@pytest.fixture(autouse=True)
def quiet_scheduler(monkeypatch):
    monkeypatch.setattr(main,'operations_tick',lambda:None)


def shared_body(vehicle_id):
    now=time.time()
    return dict(request_id=str(uuid.uuid4()),vehicle_id=vehicle_id,origin=PIN,destination=DROP,
                origin_address='Public station entrance',destination_address='Public market gate',
                starts_at=now+360,ends_at=now+1800,seats=1,price_paise=2500,
                terms='The published shared fare is paid directly to its owner after the journey.')


def shared_route(monkeypatch):
    def road(a,b,vehicle_kind='car'):
        assert vehicle_kind=='bike'
        return {'points':[a,b],'distance_metres':1500,'provider':'fixture'}
    monkeypatch.setattr(journeys,'road_route',road)


def test_ordinary_reservation_blocks_shared_and_cancel_releases_both_modes(api,setup_bike,monkeypatch):
    shared_route(monkeypatch)
    ordinary,_=book(api,search(api)['quotes'][0])
    body=shared_body(setup_bike)
    response=api.post(SHARED_BASE+'/shared',headers=auth('worker'),json=body)
    assert response.status_code==409,response.text
    assert main.operations_store.run(lambda u:u.all('shared_departures'))==[]
    command(api,ordinary,'cancel',uid='customer')
    response=api.post(SHARED_BASE+'/shared',headers=auth('worker'),json=body)
    assert response.status_code==201,response.text
    departure=response.json()
    assert search(api)['quotes']==[]
    cancelled=api.post(SHARED_BASE+'/shared/'+departure['id']+'/commands',headers=auth('worker'),json={
        'action':'cancel','expected_version':departure['version'],'command_id':str(uuid.uuid4())})
    assert cancelled.status_code==200,cancelled.text
    assert search(api)['quotes']


def test_actual_dispatch_and_shared_publication_cannot_both_reserve_same_bike(api,setup_bike,monkeypatch):
    shared_route(monkeypatch)
    monkeypatch.setattr(dispatch,'drain_direct',lambda *args,**kwargs:None)
    ordinary,_=book(api,search(api)['quotes'][0])
    assert ordinary['state']=='dispatch_pending'
    raw=main.operations_store.run(lambda u:next(x for x in u.all('bike_dispatch_outbox') if x['event_type']=='booking_requested'))
    envelope={k:v for k,v in raw.items() if k not in ('active','published')}
    body=shared_body(setup_bike)
    def consume():return dispatch.apply_event(main.operations_store,envelope,bikes.consume_dispatch_event)
    def publish():return api.post(SHARED_BASE+'/shared',headers=auth('worker'),json=body)
    with ThreadPoolExecutor(2) as pool:
        consumer=pool.submit(consume);publication=pool.submit(publish)
        consumer.result();response=publication.result()
    native=latest(api,ordinary)
    departures=main.operations_store.run(lambda u:u.all('shared_departures'))
    slot=main.operations_store.run(lambda u:u.get('bike_slots',digest('worker')))
    if response.status_code==201:
        assert native['state']=='unavailable' and len(departures)==1
        assert not slot or not slot.get('current_id')
        assert main.operations_store.run(lambda u:u.all('bike_quota'))==[]
    else:
        assert response.status_code==409,response.text
        assert native['state']=='offered' and departures==[]
        assert slot['current_id']==ordinary['id']
    assert main.operations_store.run(lambda u:u.get('mobility_availability','operator:worker'))


def test_ordinary_pickup_rejects_non_ascii_code_without_internal_error_or_attempt(api,setup_bike):
    ordinary,_=book(api,search(api)['quotes'][0])
    ordinary=command(api,ordinary,'accept')
    ordinary=command(api,ordinary,'depart',position=gps())
    before=main.operations_store.run(lambda u:u.get('bike_rides',ordinary['id']))
    response=api.post(BASE+'/bookings/'+ordinary['id']+'/commands',headers=auth('worker'),json={
        'action':'start','command_id':str(uuid.uuid4()),'expected_version':ordinary['version'],
        'otp':'１２３４５６','position':gps()})
    assert response.status_code==422,response.text
    assert main.operations_store.run(lambda u:u.get('bike_rides',ordinary['id']))==before
