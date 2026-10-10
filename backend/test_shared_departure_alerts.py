import time
from unittest.mock import patch

import main
import shared_departure_alerts as alerts
import work_push
from test_mobility_journeys import api, auth, make, join, command, latest, position, PIN, END, uid
from test_local_business import BASE, register


def accepted(api,monkeypatch):
    row,_=make(api,monkeypatch,seats=3)
    p=join(api,row).json();command(api,row,'accept',p)
    return latest(api,row),p


def notes(user):
    return main.operations_store.run(lambda u:u.find('notifications','user_id',user))


def test_reminders_due_once_with_real_geofence_and_no_idle_writes(api,monkeypatch):
    row,p=accepted(api,monkeypatch)
    assert alerts.process_departures(main)['notifications']==0
    with patch('time.time',return_value=row['starts_at']-900):
        result=alerts.process_departures(main)
        assert result['notifications']==2
        assert len([n for n in notes('customer') if n['event_type']=='departure_reminder'])==1
        assert 'arrival location has not been confirmed' in notes('customer')[-1]['body']
        assert alerts.process_departures(main)['notifications']==0
    with patch('time.time',return_value=row['starts_at']-840):
        assert alerts.process_departures(main)['notifications']==0
    with patch('time.time',return_value=row['starts_at']):
        assert alerts.process_departures(main)['notifications']==0
        due=main.operations_store.run(lambda u:u.get('shared_departure_due',row['id']))
        assert due['done'] and due['sortKey'].startswith('0000000000000:')


def test_arrival_is_private_fresh_and_uses_latest_cab_position(api,monkeypatch):
    row,p=accepted(api,monkeypatch);path=BASE+'/shared/'+row['id']
    with patch('time.time',return_value=row['starts_at']-900):
        position(api,row)
        assert api.post(path+'/arrival-position',headers=auth('customer'),json={**PIN,'accuracy':5,'captured_at':time.time()}).json()['location_status']=='inside'
        assert api.get(path+'/arrival',headers=auth('stranger')).status_code==404
        assert alerts.process_departures(main)['notifications']==1
    with patch('time.time',return_value=row['starts_at']-840):
        position(api,row,END)
        response=api.post(path+'/arrival-position',headers=auth('customer'),json={**PIN,'accuracy':5,'captured_at':time.time()})
        assert response.json()['location_status']=='outside'
        assert response.json()['cab_position']['lat']==END['lat']
        assert alerts.process_departures(main)['notifications']==1
    with patch('time.time',return_value=row['starts_at']-700):
        assert api.get(path+'/arrival',headers=auth('customer')).json()['location_status']=='unknown'
        assert api.get(path+'/arrival',headers=auth('customer')).json()['cab_position'] is None


def test_inaccurate_or_stale_arrival_cannot_suppress_reminder(api,monkeypatch):
    row,p=accepted(api,monkeypatch);path=BASE+'/shared/'+row['id']+'/arrival-position'
    with patch('time.time',return_value=row['starts_at']-900):
        assert api.post(path,headers=auth('customer'),json={**PIN,'accuracy':101,'captured_at':time.time()}).status_code==422
        assert api.post(path,headers=auth('customer'),json={**PIN,'accuracy':5,'captured_at':time.time()-300}).status_code==422
        assert alerts.process_departures(main)['notifications']==2


def test_reschedule_preserves_seats_fare_notifies_exact_time_and_rearms(api,monkeypatch):
    row,p=accepted(api,monkeypatch)
    with patch('time.time',return_value=row['starts_at']-900):
        alerts.process_departures(main)
        command(api,row,'reschedule',user='customer',p=p,status=409,starts_at=row['starts_at']+1800,ends_at=row['ends_at']+1800,reason='Waiting for the remaining seats')
        changed=command(api,row,'reschedule',starts_at=row['starts_at']+1800,ends_at=row['ends_at']+1800,reason='Waiting for the remaining seats')
        assert changed['reschedule']['previous_starts_at']==row['starts_at']
        assert changed['price_paise']==row['price_paise'] and changed['available_seats']==2
        passenger=latest(api,row)['passengers'][0]
        assert passenger['state']=='accepted' and passenger['price_paise']==p['price_paise']
        n=next(n for n in notes('customer') if n['event_type']=='rescheduled')
        assert alerts.india_time(changed['starts_at']) in n['body'] and 'Waiting for the remaining seats' in n['body']
        assert 'No response is needed' in n['body']
        received=api.get('/operations/notifications',headers=auth('customer')).json()['notifications']
        assert next(x for x in received if x['id']==n['id'])['event_type']=='rescheduled'
        nearby=api.get(BASE+'/transport/nearby',params=PIN).json()['departures']
        assert next(x for x in nearby if x['id']==row['id'])['starts_at']==changed['starts_at']
        assert all('reschedule' not in x for x in nearby)
        assert latest(api,row)['reschedule']['reason']=='Waiting for the remaining seats'
        assert alerts.process_departures(main)['notifications']==0
    with patch('time.time',return_value=changed['starts_at']-900):
        assert alerts.process_departures(main)['notifications']==2


def test_reschedule_enforces_time_reason_seats_and_operator(api,monkeypatch):
    row,p=accepted(api,monkeypatch)
    command(api,row,'reschedule',status=409,starts_at=row['starts_at']+900,ends_at=row['ends_at']+900,reason='Wait for other passengers')
    with patch('time.time',return_value=row['starts_at']-600):
        command(api,row,'reschedule',status=422,starts_at=row['starts_at']+900,ends_at=row['ends_at']+900,reason='short')
        register(api,'worker2','driver')
        main.operations_store.run(lambda u:u.put('shared_departures',row['id'],{**u.get('shared_departures',row['id']),'driver_id':'worker2'}))
        changed=command(api,row,'reschedule',user='worker2',starts_at=row['starts_at']+900,ends_at=row['ends_at']+900,reason='Waiting for remaining passengers')
        assert changed['starts_at']==row['starts_at']+900
    with patch('time.time',return_value=changed['starts_at']):
        position(api,changed);command(api,changed,'board',p)
        command(api,changed,'reschedule',status=409,starts_at=changed['starts_at']+900,ends_at=changed['ends_at']+900,reason='Waiting for remaining passengers')


def test_push_checks_schedule_and_arrival_again_and_uses_private_sound_payload(api,monkeypatch):
    from firebase_admin import messaging
    row,p=accepted(api,monkeypatch)
    monkeypatch.setenv('REPAIDO_PUSH_ENABLED','true');monkeypatch.setattr(work_push,'_messaging_app',lambda:None)
    sent=[];monkeypatch.setattr(messaging,'send',lambda message,**kwargs:sent.append(message))
    with patch('time.time',return_value=row['starts_at']-900):
        main.operations_store.run(lambda u:u.put('devices','test-device',{'id':'test-device','user_id':'customer','token':'test-fcm-token','active':True,'updated_at':time.time(),'platform':'android'}))
        alerts.process_departures(main)
        assert work_push.process_deliveries(main)['sent']>=1
        reminder=next(m for m in sent if m.data['transport_event']=='departure_reminder')
        assert reminder.data['destination']=='mobility' and reminder.data['business_id']==row['id']
        assert reminder.android.priority=='high' and reminder.android.notification.sound=='repaido_task_bell'
        assert 'lat' not in reminder.data and 'reason' not in reminder.data
        envelope=main.operations_store.run(lambda u:next(x for x in u.find('notifications','user_id','customer') if x['event_type']=='departure_reminder'))
        delivery=main.operations_store.run(lambda u:u.get('rp_work_delivery',envelope['id']))
        assert main.operations_store.run(lambda u:alerts.delivery_allowed(u,delivery))
        position(api,row)
        api.post(BASE+'/shared/'+row['id']+'/arrival-position',headers=auth('customer'),json={**PIN,'accuracy':5,'captured_at':time.time()})
        assert not main.operations_store.run(lambda u:alerts.delivery_allowed(u,delivery))
        changed=command(api,row,'reschedule',starts_at=row['starts_at']+900,ends_at=row['ends_at']+900,reason='Wait for other passengers')
        assert not main.operations_store.run(lambda u:alerts.delivery_allowed(u,delivery))


def test_old_departures_backfill_is_bounded(api,monkeypatch):
    row,_=make(api,monkeypatch)
    with main.db() as c:
        c.execute("DELETE FROM operation_records WHERE kind='shared_departure_due'")
    assert alerts.backfill(main,limit=1)['indexed']==1
    assert main.operations_store.run(lambda u:u.get('shared_departure_due',row['id']))


def test_reschedule_replay_does_not_repeat_notifications(api,monkeypatch):
    row,p=accepted(api,monkeypatch)
    with patch('time.time',return_value=row['starts_at']-600):
        body={'action':'reschedule','command_id':uid(),'expected_version':row['version'],'starts_at':row['starts_at']+600,'ends_at':row['ends_at']+600,'reason':'Wait for the remaining seats'}
        path=BASE+'/shared/'+row['id']+'/commands'
        first=api.post(path,headers=auth('worker'),json=body);assert first.status_code==200,first.text
        count=len(notes('customer'))
        assert api.post(path,headers=auth('worker'),json=body).json()['version']==first.json()['version']
        assert len(notes('customer'))==count


def test_full_vehicle_or_conflicting_booking_cannot_reschedule(api,monkeypatch):
    row,p=accepted(api,monkeypatch)
    with patch('time.time',return_value=row['starts_at']-600):
        vehicle=main.operations_store.run(lambda u:u.get('shared_departures',row['id']))['vehicle_id']
        main.operations_store.run(lambda u:u.put('mobility_rides','conflicting',{'id':'conflicting','owner_id':'worker','vehicle_id':vehicle,'mode':'cab','state':'reserved','starts_at':row['ends_at'],'ends_at':row['ends_at']+1800}))
        command(api,row,'reschedule',status=409,starts_at=row['starts_at']+600,ends_at=row['ends_at']+600,reason='Wait for the remaining seats')
        main.operations_store.run(lambda u:u.put('shared_departures',row['id'],{**u.get('shared_departures',row['id']),'seats':1}))
        command(api,row,'reschedule',status=409,starts_at=row['starts_at']+600,ends_at=row['ends_at']+600,reason='Wait for the remaining seats')


def test_assigned_driver_can_publish_without_owning_or_editing_vehicle(api,monkeypatch):
    row,body=make(api,monkeypatch)
    command(api,row,'cancel');register(api,'worker2','driver')
    vehicle=main.operations_store.run(lambda u:u.get('shared_departures',row['id']))['vehicle_id']
    assert api.put(BASE+'/vehicles/'+vehicle+'/driver',headers=auth('worker'),json={'driver_id':'worker2'}).status_code==200
    assert api.post(BASE+'/driver-invitations/'+vehicle,headers=auth('worker2'),json={'accept':True}).status_code==200
    cards=api.get(BASE+'/partner?role=driver',headers=auth('worker2')).json()['vehicles']
    assert cards[0]['id']==vehicle and 'document_ids' not in cards[0] and 'per_km_paise' not in cards[0]
    body['request_id']=uid()
    result=api.post(BASE+'/shared',headers=auth('worker2'),json=body);assert result.status_code==201,result.text
    stored=main.operations_store.run(lambda u:u.get('shared_departures',result.json()['id']))
    assert stored['owner_id']=='worker' and stored['driver_id']=='worker2' and stored['published_by']=='worker2'
    body['request_id']=uid()
    assert api.post(BASE+'/shared',headers=auth('stranger'),json=body).status_code==409


def test_accuracy_overlap_is_unconfirmed_and_departure_clears_private_arrival(api,monkeypatch):
    row,p=accepted(api,monkeypatch)
    with patch('time.time',return_value=row['starts_at']-600):
        position(api,row)
        near_boundary={**PIN,'lat':PIN['lat']+280/111320,'accuracy':80,'captured_at':time.time()}
        result=api.post(BASE+'/shared/'+row['id']+'/arrival-position',headers=auth('customer'),json=near_boundary)
        assert result.status_code==200 and result.json()['location_status']=='unknown'
        assert alerts.process_departures(main)['notifications']==2
        reminder=next(n for n in notes('customer') if n['event_type']=='departure_reminder')
        assert 'arrival location has not been confirmed' in reminder['body']
        assert 'You are outside' not in reminder['body']
    with patch('time.time',return_value=row['starts_at']):
        alerts.process_departures(main)
        assert main.operations_store.run(lambda u:u.get('shared_arrivals',p['id']))=={'received_at':0}
