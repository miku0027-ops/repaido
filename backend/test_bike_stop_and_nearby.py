import time
import uuid
from unittest.mock import patch
from test_bike_rides import api, setup_bike, search, book, start, command, latest, gps, PIN, DROP, BASE, auth


def test_finish_requires_150_metres_and_customer_can_request_early_stop(api, setup_bike):
    row, _ = book(api, search(api)['quotes'][0]); row = start(api, row)
    with patch('time.time', return_value=time.time()+20):
        assert 'complete' not in latest(api, row, 'worker')['allowed_actions']
        outside = {**DROP, 'lat': DROP['lat'] + .0018}
        command(api, row, 'complete', position=gps(outside), status=409)
        command(api, row, 'request_stop', uid='worker', status=409)
        response = api.post(BASE+'/bookings/'+row['id']+'/commands', headers=auth('stranger'), json={'action':'request_stop','expected_version':row['version'],'command_id':str(uuid.uuid4())})
        assert response.status_code == 404
        row = command(api, row, 'request_stop', uid='customer')
        assert row['early_dropoff']['requested_by'] == 'customer'
        assert 'complete' in latest(api, row, 'worker')['allowed_actions']
        row = command(api, row, 'complete', position=gps(PIN))
        assert row['state'] == 'completion_pending'
        assert row['actual_dropoff']['lat'] == PIN['lat']
        row = command(api, row, 'confirm', uid='customer')
        assert row['state'] == 'completed'


def test_finish_boundary_and_expired_gps(api, setup_bike):
    row, _ = book(api, search(api)['quotes'][0]); row = start(api, row)
    with patch('time.time', return_value=time.time()+20):
        r=api.post(BASE+'/bookings/'+row['id']+'/position',headers=auth('worker'),json=gps(DROP))
        assert r.status_code == 200, r.text
        assert r.json()['stop_status']['destination']['radius_metres'] == 150
        assert 'complete' in r.json()['allowed_actions']
    with patch('time.time', return_value=time.time()+200):
        assert 'complete' not in latest(api,row,'worker')['allowed_actions']
        command(api,row,'complete',position={**gps(DROP),'captured_at':time.time()-150},status=422)
        row=command(api,row,'complete',position=gps(DROP))
        assert row['state']=='completion_pending'


def test_nearby_is_authenticated_approximate_and_hides_occupied_riders(api, setup_bike):
    path=BASE+f"/nearby?lat={PIN['lat']}&lng={PIN['lng']}"
    assert api.get(path).status_code==401
    value=api.get(path,headers=auth('customer')).json()
    assert len(value['riders'])==1
    assert set(value['riders'][0])=={'lat','lng','received_at'}
    assert value['riders'][0]['lat']==round(PIN['lat'],3)
    row,_=book(api,search(api)['quotes'][0]);start(api,row)
    assert api.get(path,headers=auth('customer')).json()['riders']==[]


def test_map_config_never_exposes_server_routing_key(api, monkeypatch):
    import main
    monkeypatch.setenv('GOOGLE_ROUTES_API_KEY','private-route-key')
    monkeypatch.delenv('GOOGLE_MAPS_BROWSER_KEY',raising=False)
    assert api.get(BASE+'/map-config').json()['browser_key'] is None
    main.operations_store.run(lambda u: u.put('public_maps_config', 'google', {'browser_key':'configured-website-key'}))
    assert api.get(BASE+'/map-config').json()['browser_key']=='configured-website-key'
    monkeypatch.setenv('GOOGLE_MAPS_BROWSER_KEY','restricted-browser-key')
    assert api.get(BASE+'/map-config').json()['browser_key']=='restricted-browser-key'


def test_accepted_rider_location_is_private_and_expires(api, setup_bike):
    row, _ = book(api, search(api)['quotes'][0])
    assert latest(api, row)['position'] is None
    row = command(api, row, 'accept')
    assert latest(api, row)['position']['lat'] == PIN['lat']
    assert api.get(BASE+'/bookings/'+row['id'], headers=auth('stranger')).status_code == 404
    with patch('time.time', return_value=time.time()+80):
        assert latest(api, row)['position'] is None


def test_early_stop_retry_is_idempotent_and_preserves_agreed_fare(api, setup_bike):
    row, _ = book(api, search(api)['quotes'][0])
    row = start(api, row)
    row = latest(api, row)
    pricing = row['pricing']
    body = {'action':'request_stop', 'command_id':str(uuid.uuid4()), 'expected_version':row['version']}
    url = BASE+'/bookings/'+row['id']+'/commands'
    first = api.post(url, headers=auth('customer'), json=body)
    second = api.post(url, headers=auth('customer'), json=body)
    assert first.status_code == second.status_code == 200
    assert first.json()['version'] == second.json()['version']
    assert first.json()['pricing'] == pricing
    assert latest(api, row)['state'] == 'in_progress'
