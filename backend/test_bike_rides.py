"""Bike booking HTTP lifecycle and actual transactional contention, no cloud I/O."""
import copy
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest
from fastapi import Header
import main
import bike_rides as bikes
import bike_dispatch as dispatch
from test_operations import api, auth, ADMIN, PIN
from test_local_business import vehicle

BASE = '/operations/bike-rides'
DROP = {**PIN, 'lat': PIN['lat']+.008}
PHONES = {'customer': '+919111111111', 'stranger': '+919222222222', 'worker': '+919333333333', 'worker2': '+919444444444', 'shop': '+919555555555'}

def quota_key(uid):
    return bikes.promo_identity({'phone_verified': True, 'phone': PHONES[uid]})


@pytest.fixture
def setup_bike(api, monkeypatch):
    monkeypatch.setenv('REPAIDO_BIKE_PROMO_QUOTA_SECRET', 'fixture-bike-quota-key-at-least-32-bytes')
    original_actor = main.app.dependency_overrides[main.current_user]
    def verified_actor(authorization: str=Header(default='')):
        actor = original_actor(authorization)
        return {**actor, 'phone_verified': True, 'phone': PHONES[actor['id']]}
    main.app.dependency_overrides[main.current_user] = verified_actor
    monkeypatch.setenv('REPAIDO_ENV', 'test')
    monkeypatch.setenv('REPAIDO_BIKE_DISPATCH_MODE', 'direct')
    monkeypatch.setenv('REPAIDO_BIKE_DIRECT_DEV_ENABLED', 'true')
    monkeypatch.setattr(bikes, 'verified_route', lambda a,b: dict(distance_metres=1500, duration_seconds=360, points=[a,b], provider='fixture'))
    monkeypatch.setattr(dispatch, 'google_pickup_route', lambda a,b: dict(distance_metres=10, duration_seconds=60, provider='google_routes'))
    identifier = vehicle(api, vehicle_kind='bike', seats=1, name='Fixture bike')
    p = {**bikes.DEFAULT, 'version': 1, 'enabled': True, 'cash_enabled': True, 'base_paise': 800, 'per_km_paise': 500,
         'tax_reviewed': True, 'service_center': PIN, 'service_area_reviewed': True,
         'promo_enabled': True, 'promo_terms_reviewed': True, 'promo_started_at': time.time()-86400, 'promo_planning_budget_paise': 1000000, 'terms': 'Fixture approved route and cancellation terms.'}
    main.operations_store.run(lambda u: u.put('bike_policy', 'current', p))
    import bike_payroll
    response = api.put(BASE+'/payroll', headers=ADMIN, json=dict(expected_version=0, enabled=True, monthly_funding_paise=700000, funding_period=bike_payroll.period_at(), funding_reference='test-funding-ledger-001', funding_evidence='Fixture only verified salary reserve.', funding_acknowledged=True, roster=[{'driver_id':'worker','active':True}]))
    assert response.status_code == 200, response.text
    response = api.put(BASE+'/driver/availability', headers=auth('worker'), json={'vehicle_id':identifier,'online':True,'position':{**PIN,'accuracy':5,'captured_at':time.time()}})
    assert response.status_code == 200, response.text
    return identifier


def search(api, uid='customer', **extra):
    response = api.post(BASE+'/search', headers=auth(uid), json={'pickup':PIN,'dropoff':DROP,**extra})
    assert response.status_code == 200, response.text
    return response.json()


def book(api, quote, uid='customer', **extra):
    body = dict(quote_id=quote['id'],request_id=str(uuid.uuid4()),pickup_address='Fixture pickup entrance',dropoff_address='Fixture destination gate',rider_name='Fixture passenger',rider_phone='9876543210',for_someone_else=False,consent=True)
    body.update(extra)
    response = api.post(BASE+'/bookings', headers=auth(uid), json=body)
    assert response.status_code == 201, response.text
    return response.json(), body


def latest(api, row, uid='customer'):
    response = api.get(BASE+'/bookings/'+row['id'], headers=auth(uid))
    assert response.status_code == 200, response.text
    return response.json()


def command(api, row, action, uid='worker', status=200, **extra):
    row = latest(api, row, uid)
    response = api.post(BASE+'/bookings/'+row['id']+'/commands', headers=auth(uid), json=dict(action=action,command_id=str(uuid.uuid4()),expected_version=row['version'],**extra))
    assert response.status_code == status, response.text
    return response.json()


def gps(pin=PIN): return {**pin,'accuracy':5,'captured_at':time.time()}


def start(api, row):
    row = command(api,row,'accept')
    row = command(api,row,'depart',position=gps())
    otp = latest(api,row)['otp']
    with patch('time.time', return_value=time.time()+6):
        row = command(api,row,'start',otp=otp,position=gps())
    return row


def test_default_closed_and_no_private_public_policy(api):
    response = api.get(BASE+'/policy')
    assert response.status_code == 200
    p = response.json()
    assert p['enabled'] is False and p['service_radius_metres'] == 4000
    assert not ({'promo_planning_budget_paise','evidence_reference','promo_compensation_paise','base_paise','per_km_paise','platform_fee_bps'} & p.keys())
    assert api.get(BASE+'/admin/policy',headers=auth('customer')).status_code == 403
    assert api.post(BASE+'/search',headers=auth('customer'),json={'pickup':PIN,'dropoff':DROP}).json()['reason'] == 'service_not_enabled'


def test_offer_reservation_privacy_otp_and_complete(api, setup_bike):
    result = search(api); assert result['promotion']['eligible'] and len(result['quotes']) == 1
    q = result['quotes'][0]; assert q['pricing']['customer_total_paise'] == 0
    assert not ({'owner_id','driver_id','location','position'} & q.keys())
    row,body = book(api,q,for_someone_else=True,rider_name='Other passenger')
    assert row['state'] == 'offered' and row['for_someone_else']
    replay = api.post(BASE+'/bookings',headers=auth('customer'),json=body)
    assert replay.json()['id'] == row['id']
    assert api.get(BASE+'/bookings/'+row['id'],headers=auth('stranger')).status_code == 404
    worker = latest(api,row,'worker'); assert 'otp' not in worker and 'otp_value' not in worker
    assert worker['passenger_name'] == 'Other passenger'
    row = start(api,row); assert row['state'] == 'in_progress'
    with patch('time.time', return_value=time.time()+20):
        row = command(api,row,'complete',position=gps(DROP))
    row = command(api,row,'confirm','customer'); assert row['state'] == 'completed'
    quota = main.operations_store.run(lambda u:u.get('bike_quota',quota_key('customer')))
    assert quota['entries'][row['id']]['state'] == 'used'
    assert main.operations_store.run(lambda u:dispatch.engine_health(u)['mode']) == 'direct'
    events = main.operations_store.run(lambda u:u.all('bike_dispatch_consumed'))
    assert any(x['result'].get('status') == 'reserved' for x in events)


def test_cancel_before_start_releases_quota_and_slot(api, setup_bike):
    q = search(api)['quotes'][0]; row,_ = book(api,q)
    assert search(api,'stranger')['quotes'] == []
    command(api,row,'cancel','customer')
    assert search(api)['promotion']['eligible']
    assert search(api)['quotes']
    assert main.operations_store.run(lambda u:u.get('bike_quota',quota_key('customer')))['entries'] == {}


def test_verified_rider_contact_is_only_in_active_customer_booking_views(api, setup_bike):
    result = search(api)
    assert PHONES['worker'] not in str(result) and 'rider_phone' not in result['quotes'][0]
    row, _ = book(api, result['quotes'][0], rider_phone='9876543210')
    assert 'rider_phone' not in row
    # Acceptance saves the authenticated rider's verified number privately;
    # the passenger-supplied booking phone is never a contact source.
    row = command(api, row, 'accept')
    assert 'rider_phone' not in row
    current = latest(api, row)
    assert current['rider_phone'] == PHONES['worker']
    assert api.get(BASE+'/bookings', headers=auth('customer')).json()['rides'][0]['rider_phone'] == PHONES['worker']
    assert all('rider_phone' not in ride for ride in api.get(BASE+'/driver/rides', headers=auth('worker')).json()['rides'])
    assert api.get(BASE+'/bookings/'+row['id'], headers=auth('stranger')).status_code == 404
    records = main.operations_store.run(lambda u: {
        kind: u.all(kind) for kind in ('bike_rides', 'bike_quotes', 'bike_dispatch_outbox', 'notifications')})
    assert PHONES['worker'] not in str(records)
    command(api, row, 'cancel', 'customer')
    assert 'rider_phone' not in latest(api, row)
    assert all('rider_phone' not in ride for ride in api.get(BASE+'/bookings', headers=auth('customer')).json()['rides'])


@pytest.mark.parametrize('verified,phone', [(False, '+919333333333'), (True, 'not-a-phone'), (True, '9876543210')])
def test_rider_contact_never_trusts_an_unverified_or_malformed_phone(api, setup_bike, verified, phone):
    row, _ = book(api, search(api)['quotes'][0])
    original_actor = main.app.dependency_overrides[main.current_user]
    def changed_actor(authorization: str=Header(default='')):
        actor = original_actor(authorization)
        return {**actor, 'phone_verified': verified, 'phone': phone} if actor['id'] == 'worker' else actor
    main.app.dependency_overrides[main.current_user] = changed_actor
    command(api, row, 'accept')
    assert 'rider_phone' not in latest(api, row)
    assert main.operations_store.run(lambda u:u.get('bike_ride_contacts', row['id'])) is None


def test_rider_contact_accept_retry_keeps_original_verified_phone(api, setup_bike):
    row, _ = book(api, search(api)['quotes'][0])
    body = dict(action='accept', command_id=str(uuid.uuid4()), expected_version=row['version'])
    assert api.post(BASE+'/bookings/'+row['id']+'/commands', headers=auth('worker'), json=body).status_code == 200
    saved = main.operations_store.run(lambda u:u.get('bike_ride_contacts', row['id']))
    original_actor = main.app.dependency_overrides[main.current_user]
    def changed_actor(authorization: str=Header(default='')):
        actor = original_actor(authorization)
        return {**actor, 'phone': PHONES['worker2']} if actor['id'] == 'worker' else actor
    main.app.dependency_overrides[main.current_user] = changed_actor
    response = api.post(BASE+'/bookings/'+row['id']+'/commands', headers=auth('worker'), json=body)
    assert response.status_code == 200 and 'rider_phone' not in response.json()
    assert main.operations_store.run(lambda u:u.get('bike_ride_contacts', row['id'])) == saved
    assert latest(api, row)['rider_phone'] == PHONES['worker']


def test_queued_rider_contact_is_hidden_until_promoted_and_revoked_at_dropoff(api, setup_bike):
    first, _ = book(api, search(api)['quotes'][0]); first = start(api, first)
    assert latest(api, first)['rider_phone'] == PHONES['worker']
    with patch('time.time', return_value=time.time()+12):
        second, _ = book(api, search(api, 'stranger')['quotes'][0], 'stranger')
        command(api, second, 'accept')
        assert 'rider_phone' not in latest(api, second, 'stranger')
        assert all('rider_phone' not in ride for ride in api.get(BASE+'/bookings', headers=auth('stranger')).json()['rides'])
    with patch('time.time', return_value=time.time()+25):
        first = command(api, first, 'complete', position=gps(DROP))
    assert 'rider_phone' not in latest(api, first)
    assert latest(api, second, 'stranger')['rider_phone'] == PHONES['worker']
    command(api, first, 'confirm', 'customer')
    assert 'rider_phone' not in latest(api, first)


def test_actual_minute_route_cap_and_stale_gps(api, setup_bike, monkeypatch):
    monkeypatch.setattr(bikes,'verified_route',lambda a,b:dict(distance_metres=4001,duration_seconds=600,points=[a,b],provider='fixture'))
    response = api.post(BASE+'/search',headers=auth('customer'),json={'pickup':PIN,'dropoff':DROP})
    assert response.status_code == 422 and response.json()['detail']['code'] == 'ROUTE_OUTSIDE_SERVICE'
    with patch('time.time',return_value=time.time()+121):
        monkeypatch.setattr(bikes,'verified_route',lambda a,b:dict(distance_metres=1500,duration_seconds=360,points=[a,b],provider='fixture'))
        assert search(api)['quotes'] == []
    assert api.put(BASE+'/driver/availability',headers=auth('stranger'),json={'vehicle_id':setup_bike,'online':True,'position':gps()}).status_code == 403
    assert api.put(BASE+'/driver/availability',headers=auth('worker'),json={'vehicle_id':setup_bike,'online':True}).status_code == 422


def test_paid_cash_is_exact_quoted_total_and_not_gateway_verified(api, setup_bike):
    main.operations_store.run(lambda u:u.put('bike_policy','current',{**bikes.policy(u),'promo_enabled':False}))
    q = search(api)['quotes'][0]
    assert q['pricing']['customer_total_paise'] == 1550
    row,_ = book(api,q); row = start(api,row)
    with patch('time.time',return_value=time.time()+20): row = command(api,row,'complete',position=gps(DROP))
    row = command(api,row,'confirm','customer'); assert row['state'] == 'payment_due'
    command(api,row,'cash_received',status=409)
    row = command(api,row,'cash_reported','customer')
    row = command(api,row,'cash_received'); assert row['state'] == 'completed'
    assert row['payment_status'] == 'rider_confirmed_cash' and row['collected_paise'] == 1550


def test_cooldown_week_boundary_and_six_calendar_months(api, setup_bike):
    india = ZoneInfo('Asia/Kolkata')
    now = datetime(2026,10,19,0,5,tzinfo=india).timestamp()
    p = {**bikes.DEFAULT,'promo_enabled':True,'promo_terms_reviewed':True,'promo_started_at':now-86400,'promo_planning_budget_paise':100000}
    # The calendar/quota helper uses a funded fixture independently of the real current payroll month.
    from unittest.mock import patch as mock_patch
    payroll_ready = mock_patch('bike_payroll.policy_readiness', return_value={'payroll_ready':True,'funding_ready':True})
    payroll_ready.start()
    def check(u):
        u.put('bike_quota',quota_key('customer'),{'entries':{'last':dict(state='used',reserved_at=now-1800,used_at=now-1800,week=bikes.iso_week(now-1800))}})
        value = bikes.promotion(u,'customer',1500,p,now,quota_key=quota_key('customer'))
        assert not value['eligible'] and value['reason'] == 'next_offer_not_ready' and value['remaining'] == 3
        assert bikes.promotion(u,'customer',1500,p,now+36*3600,quota_key=quota_key('customer'))['eligible']
        u.put('bike_quota',quota_key('customer'),{'entries':{str(i):dict(state='used',reserved_at=now-40*3600,used_at=now-40*3600,week=bikes.iso_week(now)) for i in range(3)}})
        assert bikes.promotion(u,'customer',1500,p,now,quota_key=quota_key('customer'))['reason'] == 'weekly_limit_reached'
    try: main.operations_store.run(check)
    finally: payroll_ready.stop()
    august = datetime(2026,8,31,12,tzinfo=india).timestamp()
    assert datetime.fromtimestamp(bikes.months_after(august),india).isoformat().startswith('2027-02-28T12:00')


def test_wrong_otp_is_bounded_and_same_failed_request_idempotent(api, setup_bike):
    row,_ = book(api,search(api)['quotes'][0]); row=command(api,row,'accept');row=command(api,row,'depart',position=gps())
    with patch('time.time',return_value=time.time()+6):
        row=latest(api,row,'worker');body=dict(action='start',command_id=str(uuid.uuid4()),expected_version=row['version'],otp='000000' if latest(api,row)['otp']!='000000' else '111111',position=gps())
        first=api.post(BASE+'/bookings/'+row['id']+'/commands',headers=auth('worker'),json=body)
        second=api.post(BASE+'/bookings/'+row['id']+'/commands',headers=auth('worker'),json=body)
    assert first.status_code == second.status_code == 409
    assert latest(api,row,'worker')['otp_attempts'] == 1


def test_two_customers_one_slot_are_serialized_by_actual_consumer(api, setup_bike, monkeypatch):
    first=search(api)['quotes'][0];second=search(api,'stranger')['quotes'][0]
    # Queue both native intents without the direct adapter immediately consuming.
    monkeypatch.setattr(dispatch,'drain_direct',lambda *a,**k:None)
    a,_=book(api,first);b,_=book(api,second,'stranger')
    assert a['state'] == b['state'] == 'dispatch_pending'
    events=main.operations_store.run(lambda u:sorted((x for x in u.all('bike_dispatch_outbox') if x['event_type']=='booking_requested'),key=lambda x:x['sequence']))
    for raw in events:
        envelope={k:v for k,v in raw.items() if k not in ('active','published')}
        dispatch.apply_event(main.operations_store,envelope,bikes.consume_dispatch_event)
    assert latest(api,a)['state'] == 'offered'
    assert latest(api,b,'stranger')['state'] == 'unavailable'
    assert main.operations_store.run(lambda u:u.get('bike_quota',quota_key('stranger'))) is None


def test_geofence_blocks_far_start_and_completion(api,setup_bike):
    row,_=book(api,search(api)['quotes'][0]);row=command(api,row,'accept');row=command(api,row,'depart',position=gps())
    with patch('time.time',return_value=time.time()+6):
        command(api,row,'start',otp=latest(api,row)['otp'],position=gps(DROP),status=409)
    assert latest(api,row)['state'] == 'on_the_way'


def test_dispatch_failure_disables_new_bookings_without_changing_live_rides(api,setup_bike,monkeypatch):
    q=search(api)['quotes'][0]
    monkeypatch.delenv('REPAIDO_BIKE_DIRECT_DEV_ENABLED')
    assert search(api)['reason'] == 'dispatch_unavailable'
    response=api.post(BASE+'/bookings',headers=auth('customer'),json=dict(quote_id=q['id'],request_id=str(uuid.uuid4()),pickup_address='Fixture pickup',dropoff_address='Fixture dropoff',rider_name='Passenger',rider_phone='9876543210',consent=True))
    assert response.status_code == 503
    assert main.operations_store.run(lambda u:u.all('bike_rides')) == []


def test_exactly_one_next_slot_and_automatic_promotion_after_dropoff(api, setup_bike):
    first,_=book(api,search(api)['quotes'][0]); first=start(api,first)
    now=time.time()+12
    with patch('time.time',return_value=now):
        next_quote=search(api,'stranger')['quotes'][0]
        rival_quote=search(api,'shop')['quotes'][0]
        assert next_quote['queued'] and next_quote['available_at'] > now
        second,_=book(api,next_quote,'stranger')
        assert second['state']=='queued' and 'otp' in second
        second=command(api,second,'accept')
        assert second['accepted_by_driver'] and second['state']=='queued'
        command(api,second,'depart',status=409,position=gps())
        rival,_=book(api,rival_quote,'shop')
        assert rival['state']=='unavailable' and rival['failure_reason']=='RIDER_NO_LONGER_AVAILABLE'
        assert 'otp' not in rival and 'otp_value' not in rival
    with patch('time.time',return_value=now+10):
        first=command(api,first,'complete',position=gps(DROP))
        promoted=latest(api,second,'stranger')
        assert promoted['state']=='accepted' and promoted['queued'] is False
        driver=latest(api,second,'worker')
        assert 'depart' in driver['allowed_actions']
        assert api.get(BASE+'/bookings/'+rival['id'],headers=auth('worker')).status_code == 404


def test_expired_hold_restores_free_quota_and_is_not_a_cab_conflict(api, setup_bike):
    row,_=book(api,search(api)['quotes'][0])
    assert main.operations_store.run(lambda u:len(u.get('bike_quota',quota_key('customer'))['entries']))==1
    with patch('time.time',return_value=row['expires_at']+1):
        assert bikes.process_deadlines(main)['expired']==1
        assert latest(api,row)['state']=='expired'
        assert main.operations_store.run(lambda u:u.get('bike_quota',quota_key('customer')))['entries']=={}
        assert not main.operations_store.run(lambda u:bikes.active_reservations(u,u.get('mobility_vehicles',setup_bike),time.time(),time.time()+600))


def test_precise_arrival_alert_once_and_stale_tracking_hidden(api,setup_bike):
    row,_=book(api,search(api)['quotes'][0]);row=start(api,row)
    now=time.time()+15
    with patch('time.time',return_value=now):
        first=api.post(BASE+'/bookings/'+row['id']+'/position',headers=auth('worker'),json=gps(DROP))
        assert first.status_code==200,first.text
        assert latest(api,row)['stop_status']['destination']['status']=='inside'
        assert latest(api,row)['state']=='in_progress'
    with patch('time.time',return_value=now+10):
        assert api.post(BASE+'/bookings/'+row['id']+'/position',headers=auth('worker'),json=gps(DROP)).status_code==200
    events=main.operations_store.run(lambda u:[x for x in u.all('bike_dispatch_outbox') if x['event_type']=='destination_nearby'])
    assert len(events)==1
    with patch('time.time',return_value=now+86):
        assert latest(api,row)['position'] is None
        assert latest(api,row)['stop_status']['destination']['status']=='unknown'


def test_duplicate_actual_consumer_event_does_not_duplicate_quota(api, setup_bike):
    row,_=book(api,search(api)['quotes'][0])
    raw=main.operations_store.run(lambda u:next(e for e in u.all('bike_dispatch_outbox') if e['event_type']=='booking_requested'))
    event={k:v for k,v in raw.items() if k not in ('active','published')}
    result=dispatch.apply_event(main.operations_store,event,bikes.consume_dispatch_event)
    assert result['duplicate'] is True
    entries=main.operations_store.run(lambda u:u.get('bike_quota',quota_key('customer')))['entries']
    assert list(entries)==[row['id']]


def test_internal_rates_not_exposed_to_employees_or_customer(api,setup_bike):
    quote=search(api)['quotes'][0]
    assert not {'base_paise','distance_paise','time_paise','platform_fee_bps','per_km_paise'} & quote['pricing'].keys()
    row,_=book(api,quote)
    assert not {'base_paise','distance_paise','time_paise','platform_fee_bps','per_km_paise'} & latest(api,row,'worker')['pricing'].keys()
    admin=api.get(BASE+'/admin/policy',headers=ADMIN)
    assert admin.json()['base_paise']==800 and admin.json()['per_km_paise']==500


def test_explicit_lifecycle_gps_not_blocked_by_telemetry_rate_limit(api,setup_bike):
    row,_=book(api,search(api)['quotes'][0]);row=command(api,row,'accept')
    now=time.time()
    with patch('time.time',return_value=now): row=command(api,row,'depart',position=gps())
    with patch('time.time',return_value=now+.5): row=command(api,row,'arrive',position=gps())
    with patch('time.time',return_value=now+1): row=command(api,row,'start',otp=latest(api,row)['otp'],position=gps())
    assert row['state']=='in_progress'


def test_promo_window_expiring_before_projected_pickup_quotes_paid_instead(api,setup_bike):
    now=time.time()
    with patch('time.time',return_value=now):
        main.operations_store.run(lambda u:u.put('bike_policy','current',{**bikes.policy(u),'promo_started_at':bikes.months_after(now+5,-6)}))
        value=search(api)
        assert value['quotes'] and value['quotes'][0]['pricing']['free'] is False
        assert value['quotes'][0]['pricing']['customer_total_paise']==1550


def test_company_cash_is_not_reported_as_employee_earnings(api,setup_bike):
    main.operations_store.run(lambda u:u.put('bike_policy','current',{**bikes.policy(u),'promo_enabled':False}))
    row,_=book(api,search(api)['quotes'][0]);row=start(api,row)
    with patch('time.time',return_value=time.time()+20):row=command(api,row,'complete',position=gps(DROP))
    row=command(api,row,'confirm','customer');row=command(api,row,'cash_reported','customer');row=command(api,row,'cash_received')
    assert row['company_cash_held_paise']==1550 and row['company_collection_status']=='held_by_rider'
    assert 'earnings_paise' not in row and 'compensation_status' not in row


def test_deadline_cursor_passes_future_first_page_and_uses_small_transactions(api,setup_bike,monkeypatch):
    row,_=book(api,search(api)['quotes'][0])
    native=main.operations_store.run(lambda u:u.get('bike_rides',row['id']))
    def seed(u):
        for number in range(6):
            clone=copy.deepcopy(native);clone.update(id=f'a-future-{number}',state='dispatch_pending',expires_at=time.time()+900,assigned_at=None)
            u.put('bike_rides',clone['id'],clone)
        clone=copy.deepcopy(native);clone.update(id='z-expired',state='dispatch_pending',expires_at=time.time()-1,assigned_at=None)
        u.put('bike_rides',clone['id'],clone)
    main.operations_store.run(seed)
    calls=[];original_run=main.operations_store.run
    def measured(callback):
        def record(u):
            result=callback(u);calls.append(len(u.pending));return result
        return original_run(record)
    monkeypatch.setattr(main.operations_store,'run',measured)
    assert bikes.process_deadlines(main)['expired']==0
    assert bikes.process_deadlines(main)['expired']==1
    assert latest(api,{'id':'z-expired'})['state']=='expired'
    assert max(calls)<50


def test_preassignment_notifications_never_alert_unassigned_rider(api,setup_bike,monkeypatch):
    monkeypatch.setattr(dispatch,'drain_direct',lambda *a,**k:None)
    row,_=book(api,search(api)['quotes'][0])
    assert row['state']=='dispatch_pending'
    notes=main.operations_store.run(lambda u:[x for x in u.find('notifications','user_id','worker') if x.get('bike_ride_id')==row['id']])
    assert notes==[]


def test_paid_dispute_admin_resolution_books_cash_once_after_completed_state(api,setup_bike):
    main.operations_store.run(lambda u:u.put('bike_policy','current',{**bikes.policy(u),'promo_enabled':False}))
    row,_=book(api,search(api)['quotes'][0]);row=start(api,row)
    row=command(api,row,'dispute','customer',note='Fixture concern reviewed by company support.')
    response=api.post(BASE+'/admin/bookings/'+row['id']+'/resolve',headers=ADMIN,json={'expected_version':row['version'],'action':'complete','amount_paise':1550,'note':'Fixture exact external cash collection verified.','reference':'fixture-cash-reviewed-001'})
    assert response.status_code==200,response.text
    final=latest(api,row)
    assert final['state']=='completed' and final['payment_status']=='operator_reported_collection'
    import bike_payroll
    totals=main.operations_store.run(bike_payroll.company_cash_totals)
    assert totals['outstanding_held_paise']==1550
    duplicate=api.post(BASE+'/admin/bookings/'+row['id']+'/resolve',headers=ADMIN,json={'expected_version':response.json()['version'],'action':'complete','amount_paise':1550,'note':'Fixture exact external cash collection verified.','reference':'fixture-cash-reviewed-001'})
    assert duplicate.status_code==409
    assert main.operations_store.run(bike_payroll.company_cash_totals)==totals


def test_active_tracking_completion_and_offline_survive_payroll_pause(api,setup_bike):
    row,_=book(api,search(api)['quotes'][0]);row=start(api,row)
    def pause(u):
        p=u.get('bike_payroll_policy','current');p['enabled']=False;u.put('bike_payroll_policy','current',p)
    main.operations_store.run(pause)
    with patch('time.time',return_value=time.time()+15):
        response=api.post(BASE+'/bookings/'+row['id']+'/position',headers=auth('worker'),json=gps(DROP))
        assert response.status_code==200,response.text
        row=command(api,row,'complete',position={**gps(DROP),'captured_at':time.time()+.1})
    assert row['state']=='completion_pending'
    offline=api.put(BASE+'/driver/availability',headers=auth('worker'),json={'vehicle_id':setup_bike,'online':False})
    assert offline.status_code==200,offline.text
    assert offline.json()['availability']['online'] is False


def test_capacity_and_personal_history_never_scan_historical_bike_rows(api,setup_bike,monkeypatch):
    row,_=book(api,search(api)['quotes'][0])
    from operations import Unit
    original=Unit.find
    def bounded(unit,kind,field,value,**kwargs):
        if kind=='bike_rides': raise AssertionError('Historical native bike rows must not enter a capacity/history read.')
        return original(unit,kind,field,value,**kwargs)
    monkeypatch.setattr(Unit,'find',bounded)
    assert main.operations_store.run(lambda u:bikes.active_reservations(u,u.get('mobility_vehicles',setup_bike),time.time(),time.time()+600))
    customer=api.get(BASE+'/bookings',headers=auth('customer'))
    assert customer.status_code==200 and [r['id'] for r in customer.json()['rides']]==[row['id']]
    driver=api.get(BASE+'/driver/rides',headers=auth('worker'))
    assert driver.status_code==200 and [r['id'] for r in driver.json()['rides']]==[row['id']]


def test_history_next_cursor_reaches_more_than_fifty_records(api,setup_bike):
    row,_=book(api,search(api)['quotes'][0])
    native=main.operations_store.run(lambda u:u.get('bike_rides',row['id']))
    def seed(u):
        for index in range(51):
            clone=copy.deepcopy(native);clone.update(id=bikes.digest('history-'+str(index)),created_at=native['created_at']+index+1,state='completed')
            key=f"{9999999999999-int(clone['created_at']*1000):013d}:"+clone['id']
            u.put('bike_rides',clone['id'],clone)
            u.put('bike_history_customer_'+bikes.digest('customer')[:32],key,{'id':key,'ride_id':clone['id'],'active':True})
    main.operations_store.run(seed)
    first=api.get(BASE+'/bookings',headers=auth('customer')).json()
    assert len(first['rides'])==50 and first['next_cursor']
    second=api.get(BASE+'/bookings',headers=auth('customer'),params={'after':first['next_cursor']}).json()
    assert len(second['rides'])==2 and second['next_cursor'] is None
    assert len({item['id'] for item in first['rides']+second['rides']})==52


def test_old_dispute_resolution_never_overwrites_later_vehicle_assignments(api,setup_bike):
    old,_=book(api,search(api)['quotes'][0]);old=start(api,old)
    with patch('time.time',return_value=time.time()+20): old=command(api,old,'complete',position=gps(DROP))
    old=command(api,old,'dispute','customer',note='Fixture old invoice review after physical dropoff.')
    second_vehicle='fixture-bike-B'
    def next_assignments(u):
        template=u.get('bike_rides',old['id'])
        a=copy.deepcopy(template);a.update(id='later-A',driver_id='worker2',state='in_progress')
        b=copy.deepcopy(template);b.update(id='later-B',vehicle_id=second_vehicle,state='in_progress')
        u.put('bike_rides',a['id'],a);u.put('bike_rides',b['id'],b)
        slots_a={'driver_id':'worker2','current_id':a['id'],'next_id':None}
        slots_b={'driver_id':'worker','current_id':b['id'],'next_id':None}
        u.put('bike_slots',bikes.digest('worker2'),slots_a);u.put('bike_slots',bikes.digest('worker'),slots_b)
        u.put('bike_vehicle_slots',setup_bike,slots_a);u.put('bike_vehicle_slots',second_vehicle,slots_b)
        vehicle=u.get('mobility_vehicles',setup_bike);vehicle['driver_id']='worker2';u.put('mobility_vehicles',setup_bike,vehicle)
    main.operations_store.run(next_assignments)
    response=api.post(BASE+'/admin/bookings/'+old['id']+'/resolve',headers=ADMIN,json={'expected_version':old['version'],'action':'complete','amount_paise':0,'note':'Fixture old free invoice resolved after dropoff.','reference':'fixture-old-resolution-001'})
    assert response.status_code==200,response.text
    def verify(u):
        assert u.get('bike_slots',bikes.digest('worker'))['current_id']=='later-B'
        assert u.get('bike_slots',bikes.digest('worker2'))['current_id']=='later-A'
        assert u.get('bike_vehicle_slots',setup_bike)['current_id']=='later-A'
        assert u.get('bike_vehicle_slots',second_vehicle)['current_id']=='later-B'
        assert bikes.active_reservations(u,u.get('mobility_vehicles',setup_bike),time.time(),time.time()+600,mode='rental')
    main.operations_store.run(verify)


def test_concurrent_same_account_requests_reserve_only_one_intent_and_quota(api,setup_bike):
    quote=search(api)['quotes'][0]
    def submit(index):
        return api.post(BASE+'/bookings',headers=auth('customer'),json=dict(quote_id=quote['id'],request_id=str(uuid.uuid4()),pickup_address='Fixture pickup entrance',dropoff_address='Fixture dropoff entrance',rider_name='Passenger',rider_phone='9876543210',consent=True))
    with ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(submit,range(2)))
    assert sorted(response.status_code for response in results)==[201,409]
    quota=main.operations_store.run(lambda u:u.get('bike_quota',quota_key('customer')))
    assert len(quota['entries'])==1
    assert len(main.operations_store.run(lambda u:u.all('bike_rides')))==1


def test_concurrent_duplicate_consumer_delivery_allocates_once(api,setup_bike,monkeypatch):
    monkeypatch.setattr(dispatch,'drain_direct',lambda *a,**k:None)
    row,_=book(api,search(api)['quotes'][0])
    raw=main.operations_store.run(lambda u:next(e for e in u.all('bike_dispatch_outbox') if e['event_type']=='booking_requested'))
    event={k:v for k,v in raw.items() if k not in ('active','published')}
    def deliver(_):return dispatch.apply_event(main.operations_store,event,bikes.consume_dispatch_event)
    with ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(deliver,range(2)))
    assert sorted(result['duplicate'] for result in results)==[False,True]
    assert len(main.operations_store.run(lambda u:u.get('bike_quota',quota_key('customer')))['entries'])==1
    assert latest(api,row)['state']=='offered'


def test_live_unfrozen_server_clock_accepts_actual_received_gps(api,setup_bike):
    # No time mock: received_at must precede the geofence assessment, even when
    # processing takes only microseconds. This catches clock snapshots taken too early.
    row,_=book(api,search(api)['quotes'][0]);row=command(api,row,'accept')
    row=command(api,row,'depart',position=gps())
    row=command(api,row,'arrive',position=gps())
    row=command(api,row,'start',position=gps(),otp=latest(api,row)['otp'])
    row=command(api,row,'complete',position=gps(DROP))
    assert row['state']=='completion_pending'


def test_admin_recent_history_keeps_completed_and_cancelled_without_active_count_inflation(api,setup_bike):
    completed,_=book(api,search(api)['quotes'][0]);completed=start(api,completed)
    with patch('time.time',return_value=time.time()+20): completed=command(api,completed,'complete',position=gps(DROP))
    completed=command(api,completed,'confirm','customer')
    with patch('time.time',return_value=time.time()+21):
        current,_=book(api,search(api,'stranger')['quotes'][0],'stranger')
    overview=api.get(BASE+'/admin/overview',headers=ADMIN)
    assert overview.status_code==200,overview.text
    data=overview.json();records={row['id']:row for row in data['recent_rides']}
    assert records[completed['id']]['state']=='completed' and records[current['id']]['state']=='offered'
    assert data['metrics']['offers']==1 and data['metrics']['active_rides']==0
    assert data['recent_rides_scope']=='all_booking_states'
    for row in records.values():
        assert not {'otp','otp_value','passenger_phone','pickup','dropoff','position','policy','request_hash'} & row.keys()
    current=command(api,current,'cancel','stranger')
    again=api.get(BASE+'/admin/overview',headers=ADMIN).json()
    assert again['metrics']['offers']==0
    assert any(row['id']==current['id'] and row['state']=='cancelled' for row in again['recent_rides'])
    assert api.get(BASE+'/admin/bookings',headers=auth('customer')).status_code==403


def test_admin_closed_history_cursor_is_bounded_and_covers_all_records(api,setup_bike,monkeypatch):
    row,_=book(api,search(api)['quotes'][0])
    native=main.operations_store.run(lambda u:u.get('bike_rides',row['id']))
    def seed(u):
        for index in range(54):
            clone=copy.deepcopy(native);clone.update(id=bikes.digest('admin-history-'+str(index)),created_at=native['created_at']+index+1,state='completed')
            key=f"{9999999999999-int(clone['created_at']*1000):013d}:"+clone['id']
            u.put('bike_rides',clone['id'],clone)
            u.put('bike_history_admin',key,{'id':key,'ride_id':clone['id'],'active':True})
    main.operations_store.run(seed)
    from operations import Unit
    original=Unit.find
    def bounded(unit,kind,field,value,**kwargs):
        if kind=='bike_rides': raise AssertionError('Admin historical pages must only resolve bounded history references.')
        return original(unit,kind,field,value,**kwargs)
    monkeypatch.setattr(Unit,'find',bounded)
    first=api.get(BASE+'/admin/bookings',headers=ADMIN).json()
    assert len(first['rides'])==50 and first['next_cursor']
    second=api.get(BASE+'/admin/bookings',headers=ADMIN,params={'after':first['next_cursor']}).json()
    assert len(second['rides'])==5 and second['next_cursor'] is None
    assert len({r['id'] for r in first['rides']+second['rides']})==55


def test_verified_booker_phone_quota_survives_different_account_uid(api,setup_bike):
    original_actor=main.app.dependency_overrides[main.current_user]
    def same_phone(authorization: str=Header(default='')):
        actor=original_actor(authorization)
        if actor['id']=='stranger': actor={**actor,'phone':PHONES['customer']}
        return actor
    main.app.dependency_overrides[main.current_user]=same_phone
    first,_=book(api,search(api)['quotes'][0]);first=start(api,first)
    with patch('time.time',return_value=time.time()+20):first=command(api,first,'complete',position=gps(DROP))
    command(api,first,'confirm','customer')
    with patch('time.time',return_value=time.time()+21):
        other=search(api,'stranger')
        assert other['promotion']['reason']=='next_offer_not_ready'
        assert other['quotes'] and other['quotes'][0]['pricing']['free'] is False
        assert other['quotes'][0]['pricing']['customer_total_paise']==1550
    records=main.operations_store.run(lambda u:u.all('bike_quota'))
    assert len(records)==1 and len(records[0]['entries'])==1


def test_unverified_booker_gets_paid_quotes_without_using_passenger_phone_as_proof(api,setup_bike):
    original_actor=main.app.dependency_overrides[main.current_user]
    def unverified(authorization: str=Header(default='')):
        actor=original_actor(authorization)
        return {**actor,'phone_verified':False} if actor['id']=='customer' else actor
    main.app.dependency_overrides[main.current_user]=unverified
    result=search(api)
    assert result['promotion']['reason']=='phone_verification_required'
    assert 'Verify your mobile number' in result['promotion']['message']
    quote=result['quotes'][0]
    assert quote['pricing']['free'] is False and quote['pricing']['customer_total_paise']==1550
    row,_=book(api,quote,rider_phone=PHONES['customer'],for_someone_else=True)
    assert row['state']=='offered' and row['pricing']['free'] is False
    assert main.operations_store.run(lambda u:u.all('bike_quota'))==[]


def test_missing_or_short_dedicated_quota_secret_disables_only_free_offers(api,setup_bike,monkeypatch):
    for value in ('', 'too-short', ' '*40):
        monkeypatch.setenv('REPAIDO_BIKE_PROMO_QUOTA_SECRET',value)
        policy=api.get(BASE+'/policy').json()
        assert policy['promo_ready'] is False and policy['paid_ready'] is True
        result=search(api)
        assert result['promotion']['reason']=='promotion_unavailable'
        assert result['quotes'][0]['pricing']['free'] is False
    monkeypatch.setenv('REPAIDO_BIKE_PROMO_QUOTA_SECRET','fixture-bike-quota-key-at-least-32-bytes')
    assert search(api)['quotes'][0]['pricing']['free'] is True


def test_free_quote_revalidates_verified_booker_phone_before_request(api,setup_bike):
    quote=search(api)['quotes'][0];assert quote['pricing']['free']
    original_actor=main.app.dependency_overrides[main.current_user]
    def changed(authorization: str=Header(default='')):
        actor=original_actor(authorization)
        return {**actor,'phone':PHONES['stranger']} if actor['id']=='customer' else actor
    main.app.dependency_overrides[main.current_user]=changed
    response=api.post(BASE+'/bookings',headers=auth('customer'),json=dict(quote_id=quote['id'],request_id=str(uuid.uuid4()),pickup_address='Fixture pickup entrance',dropoff_address='Fixture destination gate',rider_name='Passenger',rider_phone=PHONES['customer'],consent=True))
    assert response.status_code==409 and response.json()['detail']['code']=='FREE_IDENTITY_CHANGED'
    assert main.operations_store.run(lambda u:u.all('bike_rides'))==[]
    assert main.operations_store.run(lambda u:u.all('bike_quota'))==[]


def test_promo_identity_is_private_hmac_and_never_enters_client_or_broker(api,setup_bike):
    value=quota_key('customer')
    import hashlib
    assert len(value)==64 and value!=hashlib.sha256(PHONES['customer'].encode()).hexdigest()
    quote=search(api)['quotes'][0]
    assert 'quota_key' not in quote and 'quota_key_version' not in quote
    row,_=book(api,quote)
    assert 'quota_key' not in row and 'quota_key_version' not in row
    driver=latest(api,row,'worker');assert 'quota_key' not in driver and 'quota_key_version' not in driver
    admin=api.get(BASE+'/admin/bookings',headers=ADMIN).json()['rides'][0]
    assert 'quota_key' not in admin and 'quota_key_version' not in admin
    raw=main.operations_store.run(lambda u:u.get('bike_rides',row['id']))
    assert raw['quota_key']==value
    broker=main.operations_store.run(lambda u:u.all('bike_dispatch_outbox'))
    assert all('quota_key' not in event and PHONES['customer'] not in str(event) for event in broker)


def test_same_verified_phone_cannot_reserve_free_slots_on_two_riders_concurrently(api,setup_bike,monkeypatch):
    second_vehicle=vehicle(api,uid='worker2',vehicle_kind='bike',seats=1,name='Second fixture bike')
    import bike_payroll
    payroll=api.get(BASE+'/payroll',headers=ADMIN).json()['policy']
    response=api.put(BASE+'/payroll',headers=ADMIN,json=dict(expected_version=payroll['version'],enabled=True,monthly_funding_paise=1400000,funding_period=bike_payroll.period_at(),funding_reference='fixture-two-rider-funding-001',funding_evidence='Fixture only verified two salary reserves.',funding_acknowledged=True,roster=[{'driver_id':'worker','active':True},{'driver_id':'worker2','active':True}]))
    assert response.status_code==200,response.text
    response=api.put(BASE+'/driver/availability',headers=auth('worker2'),json={'vehicle_id':second_vehicle,'online':True,'position':gps()})
    assert response.status_code==200,response.text
    original_actor=main.app.dependency_overrides[main.current_user]
    def same_phone(authorization: str=Header(default='')):
        actor=original_actor(authorization)
        return {**actor,'phone':PHONES['customer']} if actor['id']=='stranger' else actor
    main.app.dependency_overrides[main.current_user]=same_phone
    first=next(q for q in search(api)['quotes'] if q['vehicle_id']==setup_bike)
    second=next(q for q in search(api,'stranger')['quotes'] if q['vehicle_id']==second_vehicle)
    monkeypatch.setattr(dispatch,'drain_direct',lambda *a,**k:None)
    a,_=book(api,first);b,_=book(api,second,'stranger')
    events=main.operations_store.run(lambda u:[{k:v for k,v in event.items() if k not in ('active','published')} for event in u.all('bike_dispatch_outbox') if event['event_type']=='booking_requested'])
    def deliver(event):return dispatch.apply_event(main.operations_store,event,bikes.consume_dispatch_event)
    with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(deliver,events))
    assert sorted(result['result']['status'] for result in results)==['reserved','unavailable']
    rows=[latest(api,a),latest(api,b,'stranger')]
    assert sorted(row['state'] for row in rows)==['offered','unavailable']
    quota=main.operations_store.run(lambda u:u.get('bike_quota',quota_key('customer')))
    assert len(quota['entries'])==1


def test_free_request_fails_closed_if_secret_disappears_before_ordered_consumer(api,setup_bike,monkeypatch):
    quote=search(api)['quotes'][0]
    monkeypatch.setattr(dispatch,'drain_direct',lambda *a,**k:None)
    row,_=book(api,quote)
    raw=main.operations_store.run(lambda u:next(e for e in u.all('bike_dispatch_outbox') if e['event_type']=='booking_requested'))
    event={k:v for k,v in raw.items() if k not in ('active','published')}
    monkeypatch.delenv('REPAIDO_BIKE_PROMO_QUOTA_SECRET')
    result=dispatch.apply_event(main.operations_store,event,bikes.consume_dispatch_event)
    assert result['result']['status']=='unavailable'
    after=latest(api,row)
    assert after['state']=='unavailable' and after['pricing']['free'] and after['pricing']['customer_total_paise']==0
    assert main.operations_store.run(lambda u:u.all('bike_quota'))==[]


def test_free_confirmation_rejects_phone_verification_removed_after_quote(api,setup_bike):
    quote=search(api)['quotes'][0]
    original_actor=main.app.dependency_overrides[main.current_user]
    def unverified(authorization: str=Header(default='')):
        actor=original_actor(authorization)
        return {**actor,'phone_verified':False} if actor['id']=='customer' else actor
    main.app.dependency_overrides[main.current_user]=unverified
    response=api.post(BASE+'/bookings',headers=auth('customer'),json=dict(quote_id=quote['id'],request_id=str(uuid.uuid4()),pickup_address='Fixture pickup entrance',dropoff_address='Fixture destination gate',rider_name='Passenger',rider_phone=PHONES['customer'],consent=True))
    assert response.status_code==403 and response.json()['detail']['code']=='PHONE_VERIFICATION_REQUIRED'
    assert main.operations_store.run(lambda u:u.all('bike_rides'))==[]
