"""Real bike commands and the durable push relay, without provider/network I/O."""
import time
import pytest
from firebase_admin import messaging
import main
import ride_alerts
import work_push
from test_operations import api, auth
from test_bike_rides import setup_bike, search, book, command, gps


def deliveries():
    return main.operations_store.run(lambda u:[r for r in u.all('rp_work_delivery') if r.get('event')=='ride_update'])


def connect(api, uid, capable=True, audience=None, token=None):
    token=token or 'fixture-ride-device-token-'+uid
    response=api.post('/operations/devices',headers=auth(uid),json={
        'token':token,'platform':'android','audience':audience or ('customer' if uid=='customer' else 'agent'),
        'ride_push_capable':capable})
    assert response.status_code==200,response.text
    return response.json()['id']


@pytest.fixture
def relay(api,monkeypatch):
    monkeypatch.setenv('REPAIDO_PUSH_ENABLED','true')
    monkeypatch.setattr(work_push,'_messaging_app',lambda:None)
    sent=[]
    monkeypatch.setattr(messaging,'send',lambda message,**kwargs:sent.append(message))
    return sent


def test_bike_request_push_is_private_data_only_and_not_repeated(api,setup_bike,relay):
    connect(api,'worker')
    ride,_=book(api,search(api)['quotes'][0])
    assert any(r['target_id']==ride['id'] and r['recipient_id']=='worker' for r in deliveries())
    work_push.process_deliveries(main)
    offers=[m for m in relay if m.data.get('alert_kind')=='request']
    assert len(offers)==1
    alert=offers[0]
    assert alert.notification is None and alert.android.notification is None
    assert alert.data['ride_id']==ride['id'] and alert.data['ride_role']=='driver'
    assert alert.data['recipient_id']=='worker' and alert.android.priority=='high'
    assert not any(k in alert.data for k in ('pickup','dropoff','phone','otp','rider_name','fare','token'))
    assert 'Fixture' not in str(alert.data)
    work_push.process_deliveries(main)
    assert len([m for m in relay if m.data.get('alert_kind')=='request'])==1


@pytest.mark.parametrize('change',['accepted','expired','new_account','old_app','wrong_audience'])
def test_stale_unowned_and_unsupported_devices_never_receive_request(api,setup_bike,relay,change):
    connect(api,'worker',capable=change!='old_app',audience='customer' if change=='wrong_audience' else 'agent')
    ride,_=book(api,search(api)['quotes'][0])
    if change=='accepted':command(api,ride,'accept')
    elif change=='expired':
        def expire(u):
            row=u.get('bike_rides',ride['id']);row['expires_at']=time.time()-1;u.put('bike_rides',ride['id'],row)
        main.operations_store.run(expire)
    elif change=='new_account':connect(api,'stranger',token='fixture-ride-device-token-worker')
    work_push.process_deliveries(main)
    assert not [m for m in relay if m.data.get('alert_kind')=='request']


def test_pickup_arrival_targets_customer_and_becomes_stale_on_start(api,setup_bike,relay):
    connect(api,'customer')
    ride,_=book(api,search(api)['quotes'][0])
    ride=command(api,ride,'accept');ride=command(api,ride,'depart',position=gps())
    ride=command(api,ride,'arrive',position=gps())
    queued=[r for r in deliveries() if r['alert_kind']=='arrival']
    assert len(queued)==1 and queued[0]['recipient_id']=='customer'
    work_push.process_deliveries(main)
    assert len([m for m in relay if m.data.get('alert_kind')=='arrival'])==1
    def change(u):
        row=u.get('bike_rides',ride['id']);row.update(state='in_progress',version=row['version']+1);u.put('bike_rides',ride['id'],row)
    main.operations_store.run(change)
    assert not main.operations_store.run(lambda u:ride_alerts.delivery_allowed(u,queued[0]))


def test_cab_offer_owner_access_is_rechecked_after_another_owner_accepts(api):
    row={'id':'a'*64,'customer_id':'customer','driver_id':None,'owner_id':None,'candidate_owner_ids':['shop','other'],
         'mode':'cab','state':'requested','version':1,'offer_expires_at':time.time()+300,'events':[]}
    def seed(u):
        u.put('mobility_rides',row['id'],row)
        ride_alerts.enqueue(u,row,'shop','b'*64,'cab')
    main.operations_store.run(seed)
    note=deliveries()[0]
    assert note['ride_role']=='cab_owner'
    assert main.operations_store.run(lambda u:ride_alerts.delivery_allowed(u,note))
    main.operations_store.run(lambda u:u.put('mobility_rides',row['id'],{**row,'owner_id':'other','state':'accepted','version':2}))
    assert not main.operations_store.run(lambda u:ride_alerts.delivery_allowed(u,note))
