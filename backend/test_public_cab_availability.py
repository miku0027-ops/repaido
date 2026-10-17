"""Real isolated HTTP tests: public opt-in never reuses private journey tracking."""
import json
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import pytest
import main
import public_cab_availability as public_cabs
from test_operations import api, auth, PIN
from test_local_business import BASE, vehicle, register, quote, request, act, route


def uid():
    return str(uuid.uuid4())


def mine(api, user='worker'):
    response = api.get(BASE + '/transport/public-availability', headers=auth(user))
    assert response.status_code == 200, response.text
    return response.json()


def start(api, vid, user='worker', version=None, status=200):
    if version is None:
        version = next(row for row in mine(api, user)['vehicles'] if row['id'] == vid)['sharing']['version']
    response = api.post(f'{BASE}/vehicles/{vid}/public-availability', headers=auth(user),
                        json={'enabled': True, 'consent': True, 'expected_version': version, 'request_id': uid()})
    assert response.status_code == status, response.text
    return response.json()


def stop(api, vid, session, user='worker', **extra):
    return api.post(f'{BASE}/vehicles/{vid}/public-availability', headers=auth(user),
                    json={'enabled': False, 'session_token': session['session_token'], **extra})


def ping(api, vid, session, user='worker', status=200, **extra):
    body = {**PIN, 'accuracy': 5, 'captured_at': time.time(), 'sequence': 1,
            'session_token': session['session_token'], **extra}
    response = api.post(f'{BASE}/vehicles/{vid}/public-availability/position', headers=auth(user), json=body)
    assert response.status_code == status, response.text
    return response


def public(api, pin=PIN):
    response = api.get(BASE + '/transport/available-cabs', params=pin)
    assert response.status_code == 200, response.text
    assert response.headers['cache-control'] == 'private, no-store'
    assert response.headers['referrer-policy'] == 'no-referrer'
    return response.json()


def mutate(kind, key, **changes):
    def save(u):
        row = u.get(kind, key)
        row.update(changes)
        u.put(kind, key, row)
    main.operations_store.run(save)


def test_default_off_explicit_consent_and_private_gps_are_independent(api):
    vid = vehicle(api)
    assert public(api)['available_cabs'] == []
    private = {'lat': 1.23456, 'lng': 5.6789, 'received_at': time.time()}
    main.operations_store.run(lambda u: u.put('journey_locations', 'rides:secret-passenger-trip', private))
    assert mine(api)['vehicles'][0]['sharing'] == {'enabled': False, 'expires_at': 0, 'last_received_at': 0, 'position_expires_at': 0, 'location_status': 'ended', 'version': 0}
    for changes in ({'consent': False}, {'expected_version': None}, {'request_id': ''}):
        body = {'enabled': True, 'consent': True, 'expected_version': 0, 'request_id': uid(), **changes}
        assert api.post(f'{BASE}/vehicles/{vid}/public-availability', headers=auth('worker'), json=body).status_code in (409, 422)
    session = start(api, vid)
    assert session['session_token'] and session['expires_at'] > time.time()
    assert public(api)['available_cabs'] == []
    assert main.operations_store.run(lambda u: u.get('journey_locations', 'rides:secret-passenger-trip')) == private


def test_public_projection_is_coarse_aggregated_and_has_no_identity_or_exact_gps(api):
    a = vehicle(api)
    b = vehicle(api, 'worker2')
    ping(api, a, start(api, a))
    ping(api, b, start(api, b, 'worker2'), user='worker2')
    result = public(api)
    assert len(result['available_cabs']) == 1
    marker = result['available_cabs'][0]
    assert marker['available_count'] == 2
    assert set(marker) == {'id', 'position', 'available_count', 'updated_at', 'expires_at', 'approximation_metres'}
    assert marker['position'] != PIN
    assert public_cabs.metres(marker['position'], PIN) < marker['approximation_metres']
    assert marker['approximation_metres'] >= 300
    assert marker['updated_at'] % 15 == 0
    encoded = json.dumps(result)
    assert all(secret not in encoded for secret in ('worker', a, b, 'Test sedan', 'token_hash', 'captured_at', 'phone', 'registration'))
    stored = main.operations_store.run(lambda u: u.get('public_cab_availability', a))
    assert stored['position'] == marker['position']
    assert 'lat' not in stored and 'lng' not in stored and 'accuracy' not in stored


def test_stop_tombstone_prevents_delayed_enable_and_positions(api):
    vid = vehicle(api)
    path = f'{BASE}/vehicles/{vid}/public-availability'
    stopped = api.post(path, headers=auth('worker'), json={'enabled': False, 'expected_version': 0})
    assert stopped.status_code == 200 and stopped.json()['version'] == 1
    start(api, vid, version=0, status=409)
    session = start(api, vid)
    ping(api, vid, session)
    assert stop(api, vid, session).json()['enabled'] is False
    ping(api, vid, session, sequence=2, status=410)
    assert public(api)['available_cabs'] == []


def test_new_session_rotates_token_and_old_scoped_stop_cannot_revoke_new_session(api):
    vid = vehicle(api)
    first = start(api, vid)
    second = start(api, vid)
    assert first['session_token'] != second['session_token']
    assert stop(api, vid, first).json()['status'] == 'superseded'
    ping(api, vid, first, status=410)
    ping(api, vid, second)
    assert mine(api)['vehicles'][0]['sharing']['enabled'] is True
    stored = main.operations_store.run(lambda u: u.get('public_cab_availability', vid))
    assert first['session_token'] not in json.dumps(stored) and second['session_token'] not in json.dumps(stored)


def test_only_assigned_driver_can_start_owner_can_revoke_and_reassignment_ends_session(api):
    vid = vehicle(api)
    register(api, 'worker2', 'driver')
    mutate('mobility_vehicles', vid, driver_id='worker2', version=3)
    start(api, vid, status=403)
    assert mine(api, 'worker')['vehicles'][0]['eligible'] is False
    session = start(api, vid, 'worker2')
    ping(api, vid, session, user='worker2')
    assert stop(api, vid, session, user='worker').status_code == 200
    session = start(api, vid, 'worker2')
    ping(api, vid, session, user='worker2')
    mutate('mobility_vehicles', vid, driver_id=None, version=4)
    assert public(api)['available_cabs'] == []
    ping(api, vid, session, user='worker2', sequence=2, status=410)
    assert api.post(f'{BASE}/vehicles/{vid}/public-availability', headers=auth('stranger'), json={'enabled': False, 'expected_version': 4}).status_code == 404


@pytest.mark.parametrize('change', [dict(active=False), dict(status='rejected'), dict(mode='rental'), dict(valid_until=1), dict(version=99)])
def test_vehicle_eligibility_changes_immediately_remove_marker(api, change):
    vid = vehicle(api)
    session = start(api, vid)
    ping(api, vid, session)
    mutate('mobility_vehicles', vid, **change)
    assert public(api)['available_cabs'] == []
    ping(api, vid, session, sequence=2, status=410)


def test_partner_revocation_and_reapproval_require_new_public_consent(api):
    vid = vehicle(api)
    session = start(api, vid)
    ping(api, vid, session)
    mutate('business_partners', 'worker', status='rejected', version=3)
    assert public(api)['available_cabs'] == []
    mutate('business_partners', 'worker', status='approved', version=4)
    assert public(api)['available_cabs'] == []
    ping(api, vid, session, sequence=2, status=410)


@pytest.mark.parametrize('changes', [dict(accuracy=0), dict(accuracy=101), dict(captured_at=1), dict(captured_at=999999999999), dict(sequence=0)])
def test_invalid_gps_readings_and_sequences_are_rejected(api, changes):
    vid = vehicle(api)
    session = start(api, vid)
    ping(api, vid, session, status=422, **changes)
    assert public(api)['available_cabs'] == []


def test_sequence_capture_order_rate_limit_and_freshness_expiry(api):
    vid = vehicle(api)
    session = start(api, vid)
    now = time.time()
    with patch('time.time', return_value=now):
        ping(api, vid, session, captured_at=now - 29)
        ping(api, vid, session, sequence=1, captured_at=now, status=409)
        ping(api, vid, session, sequence=2, captured_at=now, status=429)
    with patch('time.time', return_value=now + 11):
        ping(api, vid, session, sequence=2, captured_at=now - 29, status=409)
    with patch('time.time', return_value=now + 47):
        # Received less than75secondsago, but sourcecapturealreadyexpired.
        assert public(api)['available_cabs'] == []
    with patch('time.time', return_value=session['expires_at'] + 1):
        ping(api, vid, session, sequence=3, status=410)


def test_live_location_cannot_bypass_registered_service_radius(api):
    vid = vehicle(api, location={'lat': PIN['lat'] + .2, 'lng': PIN['lng']})
    ping(api, vid, start(api, vid))
    assert public(api)['available_cabs'] == []
    assert public(api, {'lat': 0, 'lng': 0})['available_cabs'] == []


def test_new_real_reservation_atomically_hides_public_cab_and_ends_old_session(api, route):
    vid = vehicle(api)
    session = start(api, vid)
    ping(api, vid, session)
    row, _ = request(api, [quote(api, vid)])
    act(api, row, 'accept', 'worker')
    assert public(api)['available_cabs'] == []
    ping(api, vid, session, sequence=2, status=410)
    start(api, vid, status=409)


@pytest.mark.parametrize('state', ['accepted', 'reserved', 'on_the_way', 'in_progress', 'disputed', 'completion_pending'])
def test_existing_busy_vehicle_or_operator_cannot_start_public_availability(api, state):
    vid = vehicle(api)
    row = {'id': uid(), 'owner_id': 'worker', 'vehicle_id': vid, 'state': state, 'starts_at': time.time() - 10000, 'ends_at': time.time() - 9000}
    main.operations_store.run(lambda u: u.put('mobility_rides', row['id'], row))
    assert mine(api)['vehicles'][0]['eligible'] is False
    start(api, vid, status=409)


def test_operator_cannot_create_phantom_fleet_and_concurrent_starts_serialize(api):
    first = vehicle(api)
    original = main.operations_store.run(lambda u: u.get('mobility_vehicles', first))
    second = uid()
    main.operations_store.run(lambda u: u.put('mobility_vehicles', second, {**original, 'id': second}))
    def enable(vid):
        return api.post(f'{BASE}/vehicles/{vid}/public-availability', headers=auth('worker'),
                        json={'enabled': True, 'consent': True, 'expected_version': 0, 'request_id': uid()})
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(enable, (first, second)))
    assert sorted(response.status_code for response in responses) == [200, 409]
    assert sum(row['sharing']['enabled'] for row in mine(api)['vehicles']) == 1


def test_coarse_cells_bound_uncertainty_and_handle_poles_and_dateline():
    for latitude in (-90, -89.99, -60, 0, 21.4934, 60, 89.99, 90):
        for longitude in (-180, -179.999, 0, 179.999, 180):
            _, approximate = public_cabs.coarse_cell({'lat': latitude, 'lng': longitude})
            assert public_cabs.metres(approximate, {'lat': latitude, 'lng': longitude}) < public_cabs.APPROXIMATION_METRES
    # This equatorward corner of the northernmost band exceeded519metres
    # when longitude columns were sized from the cell centre instead of edge.
    corner = {'lat': 89.99461013295104, 'lng': -179.999999999999}
    assert public_cabs.metres(public_cabs.coarse_cell(corner)[1], corner) < 450


def test_repeated_heartbeats_retain_only_one_reference_and_stop_deletes_it(api):
    vid = vehicle(api)
    session = start(api, vid)
    now = time.time()
    for sequence in range(1, 12):
        with patch('time.time', return_value=now + sequence * 12):
            ping(api, vid, session, sequence=sequence, lat=PIN['lat'] + sequence * .001)
        with main.db() as conn:
            references = conn.execute("SELECT body FROM operation_records WHERE kind LIKE 'transport_public_cab_%'").fetchall()
        assert len(references) == 1
    assert stop(api, vid, session).status_code == 200
    with main.db() as conn:
        assert conn.execute("SELECT count(*) FROM operation_records WHERE kind LIKE 'transport_public_cab_%'").fetchone()[0] == 0
