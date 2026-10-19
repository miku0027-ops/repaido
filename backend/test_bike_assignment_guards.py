"""HTTP assignment boundaries for active native bike resources.

Native fixtures avoid external routes, payroll activation or broker access. The
tests exercise the real invitation route, approvals and transactional store.
"""
import copy
import time
import uuid

import pytest

import main
from local_business import digest
from test_operations import api, auth, PIN
from test_local_business import BASE, approve, doc, vehicle


def approved_driver(client, uid='worker2'):
    response = client.put(BASE+'/partner', headers=auth(uid), json={
        'name': 'Fixture assigned rider', 'role': 'driver', 'city': 'Balasore',
        'address': 'Fixture private driver address', 'location': PIN,
        'document_ids': [doc(uid)], 'terms': True, 'expected_version': 0})
    assert response.status_code == 200, response.text
    approve(client, 'partner', response.json()['id'])


def invite(client, vehicle_id, driver='worker2', owner='worker'):
    response = client.put(BASE+'/vehicles/'+vehicle_id+'/driver', headers=auth(owner),
                          json={'driver_id': driver})
    assert response.status_code == 200, response.text
    return response.json()


def native_bike(vehicle_id, driver='worker', state='in_progress'):
    now = time.time()
    return {'id': str(uuid.uuid4()), 'vehicle_id': vehicle_id, 'driver_id': driver,
            'owner_id': driver, 'customer_id': 'customer', 'state': state,
            'starts_at': now-60 if state == 'in_progress' else now+120,
            'ends_at': now+900, 'expires_at': now+300, 'assigned_at': now-60,
            'version': 1, 'created_at': now-60}


def seed_resource(row, *, operator_slot=True, vehicle_slot=True, key='current_id'):
    def seed(u):
        u.put('bike_rides', row['id'], row)
        slots = {'driver_id': row['driver_id'], 'current_id': None, 'next_id': None, key: row['id']}
        if operator_slot:
            u.put('bike_slots', digest(row['driver_id']), slots)
        if vehicle_slot:
            u.put('bike_vehicle_slots', row['vehicle_id'], copy.deepcopy(slots))
    main.operations_store.run(seed)


def snapshot(vehicle_id, drivers):
    return main.operations_store.run(lambda u: {
        'vehicle': u.get('mobility_vehicles', vehicle_id),
        'invitation': u.get('driver_invitations', vehicle_id),
        'operator_slots': {uid: u.get('bike_slots', digest(uid)) for uid in drivers},
        'vehicle_slot': u.get('bike_vehicle_slots', vehicle_id)})


@pytest.mark.parametrize('state', ['in_progress', 'on_the_way', 'accepted'])
def test_active_bike_vehicle_cannot_be_reassigned_to_another_driver(api, state):
    bike = vehicle(api, vehicle_kind='bike', seats=1)
    approved_driver(api)
    invite(api, bike)
    row = native_bike(bike, state=state)
    seed_resource(row)
    before = snapshot(bike, ['worker', 'worker2'])

    response = api.post(BASE+'/driver-invitations/'+bike, headers=auth('worker2'),
                        json={'accept': True})

    assert response.status_code == 409, response.text
    assert response.json()['detail']['code'] == 'BOOKED'
    assert snapshot(bike, ['worker', 'worker2']) == before


def test_vehicle_slot_prevents_reassignment_even_when_current_driver_slot_is_absent(api):
    bike = vehicle(api, vehicle_kind='bike', seats=1)
    approved_driver(api)
    invite(api, bike)
    row = native_bike(bike)
    seed_resource(row, operator_slot=False)
    before = snapshot(bike, ['worker', 'worker2'])

    response = api.post(BASE+'/driver-invitations/'+bike, headers=auth('worker2'),
                        json={'accept': True})

    assert response.status_code == 409, response.text
    assert snapshot(bike, ['worker', 'worker2']) == before


def test_incoming_driver_busy_on_different_bike_cannot_accept_free_vehicle(api):
    offered_bike = vehicle(api, vehicle_kind='bike', seats=1)
    busy_bike = vehicle(api, uid='worker2', vehicle_kind='bike', seats=1)
    approved_driver(api)
    invite(api, offered_bike)
    row = native_bike(busy_bike, driver='worker2')
    seed_resource(row)
    before = snapshot(offered_bike, ['worker', 'worker2'])
    busy_before = snapshot(busy_bike, ['worker2'])

    response = api.post(BASE+'/driver-invitations/'+offered_bike, headers=auth('worker2'),
                        json={'accept': True})

    assert response.status_code == 409, response.text
    assert response.json()['detail']['code'] == 'BOOKED'
    assert snapshot(offered_bike, ['worker', 'worker2']) == before
    assert snapshot(busy_bike, ['worker2']) == busy_before


def test_free_fleet_vehicle_can_leave_operator_working_on_different_bike(api):
    offered_bike = vehicle(api, vehicle_kind='bike', seats=1)
    # An owner may keep another unreserved vehicle in the fleet while riding
    # their current bike. Reassigning that free vehicle does not alter the trip.
    busy_bike = str(uuid.uuid4())
    original = main.operations_store.run(lambda u: u.get('mobility_vehicles', offered_bike))
    main.operations_store.run(lambda u: u.put('mobility_vehicles', busy_bike,
        {**original, 'id': busy_bike, 'name': 'Fixture other fleet bike'}))
    approved_driver(api)
    invite(api, offered_bike)
    row = native_bike(busy_bike)
    seed_resource(row)
    busy_before = snapshot(busy_bike, ['worker'])

    response = api.post(BASE+'/driver-invitations/'+offered_bike, headers=auth('worker2'),
                        json={'accept': True})

    assert response.status_code == 200, response.text
    assert response.json()['state'] == 'accepted'
    changed = main.operations_store.run(lambda u: u.get('mobility_vehicles', offered_bike))
    assert changed['driver_id'] == 'worker2'
    assert snapshot(busy_bike, ['worker']) == busy_before


def test_queued_next_bike_reservation_also_prevents_reassignment(api):
    bike = vehicle(api, vehicle_kind='bike', seats=1)
    approved_driver(api)
    invite(api, bike)
    # The next reservation must be checked independently of an already-finished
    # current reference while cleanup is pending.
    current = native_bike(bike, state='completion_pending')
    queued = native_bike(bike, state='queued')
    def seed(u):
        for row in (current, queued):
            u.put('bike_rides', row['id'], row)
        slot = {'driver_id': 'worker', 'current_id': current['id'], 'next_id': queued['id']}
        u.put('bike_slots', digest('worker'), slot)
        u.put('bike_vehicle_slots', bike, copy.deepcopy(slot))
    main.operations_store.run(seed)
    before = snapshot(bike, ['worker', 'worker2'])

    response = api.post(BASE+'/driver-invitations/'+bike, headers=auth('worker2'),
                        json={'accept': True})

    assert response.status_code == 409, response.text
    assert snapshot(bike, ['worker', 'worker2']) == before


@pytest.mark.parametrize('state', ['completion_pending', 'payment_due', 'payment_reported', 'completed'])
def test_physically_finished_financial_history_does_not_block_new_driver_assignment(api, state):
    bike = vehicle(api, vehicle_kind='bike', seats=1)
    approved_driver(api)
    invite(api, bike)
    old_ride = native_bike(bike, state=state)
    # Normal dropoff already released physical slots. The historical financial
    # obligation must not keep the vehicle or its former operator reserved.
    seed_resource(old_ride, operator_slot=False, vehicle_slot=False)
    before = main.operations_store.run(lambda u: u.get('mobility_vehicles', bike))

    response = api.post(BASE+'/driver-invitations/'+bike, headers=auth('worker2'),
                        json={'accept': True})

    assert response.status_code == 200, response.text
    assert response.json()['state'] == 'accepted'
    after = main.operations_store.run(lambda u: u.get('mobility_vehicles', bike))
    assert after['driver_id'] == 'worker2' and after['version'] == before['version']+1
    assert main.operations_store.run(lambda u: u.get('bike_rides', old_ride['id'])) == old_ride
