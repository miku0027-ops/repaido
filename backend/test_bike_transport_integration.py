"""Bike-specific entry points retain the existing shared journey lifecycle."""
import time
import uuid

import mobility_journeys
import main
import local_business
from test_operations import api, auth, PIN
from test_local_business import vehicle, BASE


def test_shared_kind_filter_does_not_offer_car_seats_as_bike_rides(api, monkeypatch):
    destination = {'lat': PIN['lat'] + .03, 'lng': PIN['lng']}
    monkeypatch.setattr(mobility_journeys, 'road_route', lambda a, b, vehicle_kind='car':
                        {'points': [a, b], 'distance_metres': 3340})
    start = time.time() + 7200
    for owner, kind, seats in [('worker', 'car', 4), ('worker2', 'bike', 1)]:
        identifier = vehicle(api, uid=owner, vehicle_kind=kind, seats=seats)
        response = api.post(BASE + '/shared', headers=auth(owner), json={
            'vehicle_id': identifier, 'request_id': str(uuid.uuid4()),
            'origin': PIN, 'destination': destination, 'origin_address': 'Public station entrance',
            'destination_address': 'Public market entrance', 'starts_at': start, 'ends_at': start + 3600,
            'seats': seats, 'price_paise': 1500, 'terms': 'Meet safely at the agreed public pickup point.'})
        assert response.status_code == 201, response.text
    body = {'pickup': PIN, 'dropoff': destination, 'starts_at': time.time(), 'until': start + 600, 'seats': 1}
    for kind in ('car', 'bike'):
        response = api.post(BASE + '/shared/search', json={**body, 'vehicle_kind': kind})
        assert response.status_code == 200, response.text
        assert [row['vehicle_kind'] for row in response.json()['departures']] == [kind]
    assert len(api.post(BASE + '/shared/search', json=body).json()['departures']) == 2
    assert api.post(BASE + '/shared/search', json={**body, 'vehicle_kind': 'bike', 'seats': 2}).json()['departures'] == []
    assert api.post(BASE + '/shared/search', json={**body, 'vehicle_kind': 'aircraft'}).status_code == 422


def test_legacy_cab_quotes_cannot_bypass_bike_launch_policy(api, monkeypatch):
    bike = vehicle(api, vehicle_kind='bike', seats=1)
    starts_at = time.time() + 7200
    search = {'pickup': PIN, 'starts_at': starts_at, 'ends_at': starts_at + 3600, 'mode': 'cab'}
    assert api.post(BASE + '/vehicles/search', json=search).json()['vehicles'] == []
    assert api.get(BASE + '/transport/nearby', params=PIN).json()['vehicles'] == []
    fleet = api.get(BASE + '/transport/public-availability', headers=auth('worker')).json()['vehicles']
    assert all(not row['eligible'] for row in fleet if row['id'] == bike)
    def forbidden_route(*args, **kwargs):
        raise AssertionError('Legacy car routing must not quote a bike')
    monkeypatch.setattr(local_business, 'route_metres', forbidden_route)
    response = api.post(BASE + '/quotes', headers=auth('customer'), json={
        **search, 'vehicle_id': bike, 'dropoff': PIN, 'trip': 'one_way'})
    assert response.status_code == 409, response.text
    assert response.json()['detail']['code'] == 'BIKE_FLOW_REQUIRED'
    assert main.operations_store.run(lambda u: u.all('mobility_quotes')) == []


def test_old_car_quote_cannot_create_new_booking_after_vehicle_becomes_bike(api, monkeypatch):
    from test_local_business import quote
    identifier = vehicle(api)
    monkeypatch.setattr(local_business, 'route_metres', lambda *args: 1000)
    old_quote = quote(api, identifier)
    def change_kind(u):
        row = u.get('mobility_vehicles', identifier)
        row.update(vehicle_kind='bike', seats=1)
        u.put('mobility_vehicles', identifier, row)
    main.operations_store.run(change_kind)
    response = api.post(BASE + '/rides', headers=auth('customer'), json={
        'quote_ids': [old_quote['id']], 'request_id': str(uuid.uuid4()), 'consent': True,
        'pickup_address': 'Public station entrance', 'dropoff_address': 'Public market entrance',
        'phone': '9876543210'})
    assert response.status_code == 409, response.text
    assert response.json()['detail']['code'] == 'BIKE_FLOW_REQUIRED'
    assert main.operations_store.run(lambda u: u.all('mobility_rides')) == []
