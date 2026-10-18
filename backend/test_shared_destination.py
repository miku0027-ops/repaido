"""Arrival cues use the same real HTTP GPS gates as passenger drop-off."""
from unittest.mock import patch
import main
from test_operations import api, auth, PIN
from test_mobility_journeys import make, join, command, latest, position, END, BASE
from mobility_journeys import stop_proximity
from shared_departure_alerts import delivery_allowed


def test_accuracy_freshness_and_boundary_are_conservative():
    now=1000
    loc={**PIN,'accuracy':5,'captured_at':now,'received_at':now}
    assert stop_proximity(loc,PIN,now)['status']=='inside'
    assert stop_proximity(loc,PIN,now+76)['status']=='unknown'
    assert stop_proximity({**loc,'received_at':now+1},PIN,now)['status']=='unknown'
    assert stop_proximity({**loc,'captured_at':now-121},PIN,now)['status']=='unknown'
    assert stop_proximity({**loc,'accuracy':101},PIN,now)['status']=='unknown'
    pin={**PIN,'lat':PIN['lat']+0.0026}  # about 289 m, but ±30 m cannot confirm arrival
    assert stop_proximity({**loc,'accuracy':30},pin,now)['status']=='unknown'
    assert stop_proximity(loc,END,now)['status']=='outside'


def test_destination_cue_notifies_once_and_never_finishes_the_ride(api,monkeypatch):
    row,_=make(api,monkeypatch);p=join(api,row).json();command(api,row,'accept',p)
    with patch('time.time',return_value=row['starts_at']):
        position(api,row);command(api,row,'board',p);command(api,row,'start')
        assert latest(api,row)['stop_status']['passengers'][p['id']]['status']=='outside'
    with patch('time.time',return_value=row['starts_at']+10):
        position(api,row,END)
        active=latest(api,row)
        assert active['state']=='in_progress' and active['passengers'][0]['state']=='boarded'
        assert active['stop_status']['passengers'][p['id']]['status']=='inside'
        notes=main.operations_store.run(lambda u:[n for n in u.all('notifications') if n.get('event_type')=='destination_arrival'])
        assert {n['user_id'] for n in notes}=={'worker','customer'}
        delivery=main.operations_store.run(lambda u:[n for n in u.all('rp_work_delivery') if n.get('transport_event')=='destination_arrival'])
        assert len(delivery)==2
        assert all(main.operations_store.run(lambda u:delivery_allowed(u,d)) for d in delivery)
    # Repeated GPS updates and crossing the boundary again cannot replay an alarm.
    for offset,pin in [(20,END),(30,PIN),(40,END)]:
        with patch('time.time',return_value=row['starts_at']+offset):position(api,row,pin)
    assert len(main.operations_store.run(lambda u:[n for n in u.all('notifications') if n.get('event_type')=='destination_arrival']))==2
    with patch('time.time',return_value=row['starts_at']+116):
        assert latest(api,row)['stop_status']['passengers'][p['id']]['status']=='unknown'
        assert not any(main.operations_store.run(lambda u:delivery_allowed(u,d)) for d in delivery)
        command(api,row,'dropoff',p,status=409)
    with patch('time.time',return_value=row['starts_at']+120):
        position(api,row,END);command(api,row,'dropoff',p)
        assert not any(main.operations_store.run(lambda u:delivery_allowed(u,d)) for d in delivery)
        customer=api.get(BASE+'/shared',headers=auth('customer'))
        assert customer.headers['cache-control']=='private, no-store'
        assert customer.json()['departures'][0]['stop_status'] is None


def test_each_passenger_only_receives_their_own_stop_state(api,monkeypatch):
    row,_=make(api,monkeypatch,seats=2)
    middle={**PIN,'lat':PIN['lat']+.05}
    first=join(api,row,dropoff=middle).json();second=join(api,row,'stranger').json()
    command(api,row,'accept',first);command(api,row,'accept',second)
    with patch('time.time',return_value=row['starts_at']):
        position(api,row);command(api,row,'board',first);command(api,row,'board',second);command(api,row,'start')
    with patch('time.time',return_value=row['starts_at']+10):
        position(api,row,middle)
        owner=latest(api,row)['stop_status']['passengers']
        assert owner[first['id']]['status']=='inside' and owner[second['id']]['status']=='outside'
        for uid,p in [('customer',first),('stranger',second)]:
            value=api.get(BASE+'/shared',headers=auth(uid)).json()['departures'][0]
            assert set(value['stop_status']['passengers'])=={p['id']}
        notifications=main.operations_store.run(lambda u:[n for n in u.all('notifications') if n.get('event_type')=='destination_arrival'])
        assert {n['user_id'] for n in notifications}=={'worker','customer'}
        path=f"{BASE}/journeys/shared/{row['id']}/consent"
        api.post(path,headers=auth('worker'),json={'enabled':False})
        assert latest(api,row)['stop_status']['passengers'][first['id']]['status']=='unknown'
        command(api,row,'dropoff',first,status=409)
