"""Presence concurrency/privacy regressions; real HTTP and isolated transactions."""
import time
from concurrent.futures import ThreadPoolExecutor
import pytest
import main
from test_bike_rides import api, setup_bike, auth, BASE, gps, search, book, command


def presence(api):
    response = api.get(BASE+'/driver/availability', headers=auth('worker'))
    assert response.status_code == 200, response.text
    return response.json()['availability']


def write(api, bike, online, version, **extra):
    return api.put(BASE+'/driver/availability', headers=auth('worker'), json={
        'vehicle_id': bike, 'online': online, 'expected_version': version,
        **({'position': gps()} if online else {}), **extra})


def test_delayed_heartbeat_cannot_resurrect_offline_rider(api, setup_bike):
    before = presence(api)
    assert write(api, setup_bike, False, before['version']).status_code == 200
    response = write(api, setup_bike, True, before['version'])
    assert response.status_code == 409, response.text
    assert response.json()['detail']['code'] == 'AVAILABILITY_CHANGED'
    assert presence(api)['online'] is False
    assert search(api)['quotes'] == []
    # Cached old browser tabs cannot bypass version fencing after upgrade.
    response = api.put(BASE+'/driver/availability', headers=auth('worker'), json={
        'vehicle_id': setup_bike, 'online': True, 'position': gps()})
    assert response.status_code == 409
    latest = presence(api)
    assert write(api, setup_bike, True, latest['version']).status_code == 200
    assert presence(api)['online'] is True
    assert search(api)['quotes']


def test_concurrent_same_version_presence_writes_have_one_winner(api, setup_bike):
    before = presence(api)
    with ThreadPoolExecutor(max_workers=8) as pool:
        responses = list(pool.map(lambda _: write(api, setup_bike, True, before['version']), range(8)))
    assert sorted(r.status_code for r in responses) == [200]+[409]*7
    assert presence(api)['version'] == before['version']+1


def test_reassigned_bike_does_not_expose_previous_operator_location(api, setup_bike):
    def reassign(u):
        vehicle = u.get('mobility_vehicles', setup_bike)
        vehicle['driver_id'] = 'worker2'
        u.put('mobility_vehicles', setup_bike, vehicle)
    main.operations_store.run(reassign)
    result = api.get(BASE+'/driver/availability', headers=auth('worker2')).json()
    assert result['vehicles'][0]['id'] == setup_bike
    assert result['availability'] is None
    assert presence(api) is None


@pytest.mark.parametrize('agent', ['Mozilla/5.0 (X11; Linux x86_64)', 'Mozilla/5.0 (iPhone)'])
def test_real_presence_is_device_independent_and_requires_valid_gps(api, setup_bike, agent):
    before = presence(api)
    assert write(api, setup_bike, False, before['version']).status_code == 200
    version = presence(api)['version']
    body = {'vehicle_id': setup_bike, 'online': True, 'expected_version': version, 'position': gps()}
    bad = api.put(BASE+'/driver/availability', headers={**auth('worker'), 'user-agent': agent}, json={**body, 'position': {**gps(), 'accuracy': 500}})
    assert bad.status_code == 422
    assert presence(api)['online'] is False
    response = api.put(BASE+'/driver/availability', headers={**auth('worker'), 'user-agent': agent}, json=body)
    assert response.status_code == 200, response.text
    assert presence(api)['online'] is True
    assert search(api)['quotes']


def test_trip_telemetry_after_offline_does_not_enable_new_requests(api, setup_bike):
    ride, _ = book(api, search(api)['quotes'][0])
    ride = command(api, ride, 'accept')
    ride = command(api, ride, 'depart', position=gps())
    assert write(api, setup_bike, False, presence(api)['version']).status_code == 200
    # Existing trip location must continue, without re-advertising availability.
    from unittest.mock import patch
    with patch('time.time', return_value=time.time()+6):
        response = api.post(BASE+'/bookings/'+ride['id']+'/position', headers=auth('worker'), json=gps())
    assert response.status_code == 200, response.text
    assert presence(api)['online'] is False

def test_heartbeat_cannot_start_a_new_shift_even_with_current_version(api, setup_bike):
    assert write(api, setup_bike, False, presence(api)['version']).status_code == 200
    version = presence(api)['version']
    response = write(api, setup_bike, True, version, heartbeat=True)
    assert response.status_code == 409
    assert presence(api)['online'] is False


def test_future_gps_cannot_establish_presence(api, setup_bike):
    response = write(api, setup_bike, True, presence(api)['version'], position={**gps(), 'captured_at': time.time()+60})
    assert response.status_code == 422

def test_switching_back_to_an_earlier_bike_uses_its_own_presence_version(api, setup_bike):
    # Seed a second reviewed vehicle without re-registering the same owner.
    other = 'fixture-second-bike'
    def seed(u):
        record = {**u.get('mobility_vehicles', setup_bike), 'id': other, 'name': 'Second fixture bike'}
        u.put('mobility_vehicles', other, record)
    main.operations_store.run(seed)
    assert write(api, other, True, 0).status_code == 200
    snapshot = api.get(BASE+'/driver/availability', headers=auth('worker')).json()
    assert snapshot['availability']['vehicle_id'] == other
    version = next(v['presence_version'] for v in snapshot['vehicles'] if v['id'] == setup_bike)
    assert version > 0
    assert write(api, setup_bike, True, version).status_code == 200
    snapshot = api.get(BASE+'/driver/availability', headers=auth('worker')).json()
    assert snapshot['availability']['vehicle_id'] == setup_bike
    assert main.operations_store.run(lambda u:u.get('bike_rider_presence', other))['online'] is False
