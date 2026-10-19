"""Native bike transactions against a loopback-only Firestore emulator.

Run with FIRESTORE_EMULATOR_HOST=127.0.0.1:8793. Each test uses an isolated
demo project with anonymous credentials; this suite cannot select production.
"""
import copy
import os
import re
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import pytest
from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore

import main
import bike_dispatch as dispatch
import bike_payroll as payroll
import bike_rides as bikes
import bike_earnings as earnings
from test_operations import api as local_api, auth, ADMIN, PIN
from test_bike_rides import (BASE, DROP, setup_bike, search, book, start, command,
                             latest, gps, quota_key)
from test_bike_earnings import independent, quote as independent_quote, finish as independent_finish


def test_firestore_independent_free_funding_and_exact_earning_credit(api, setup_bike):
    vehicle_id = independent(api)
    row, body = book(api, independent_quote(api, vehicle_id))
    assert row['state'] == 'offered' and row['pricing']['free']
    assert 'earning_fund_allocations' not in row and 'compensation_offer' not in row
    value = main.operations_store.run(earnings.fund)
    assert value['funded_paise'] == 1200 and value['reserved_paise'] == 1200
    row = independent_finish(api, row)
    own = api.get(BASE+'/driver/earnings', headers=auth('worker2')).json()
    assert row['state'] == 'completed' and len(own['credits']) == 1
    assert own['account']['payable_paise'] == 1200
    main.operations_store.run(lambda u: earnings.sync_earning(u, u.get('bike_rides', row['id'])))
    assert main.operations_store.run(earnings.fund)['committed_paise'] == 1200
    assert api.get(BASE+'/driver/earnings', headers=auth('worker2')).json()['account']['earned_paise'] == 1200


def test_firestore_competing_independent_riders_cannot_overspend_promo_funds(api, setup_bike):
    first = independent(api); other = independent(api, 'shop', funding=0)
    quotes = [(independent_quote(api, first), 'customer'), (independent_quote(api, other, 'stranger'), 'stranger')]
    with ThreadPoolExecutor(max_workers=2) as pool:
        rows = list(pool.map(lambda pair: book(api, pair[0], pair[1])[0], quotes))
    assert sorted(row['state'] for row in rows) == ['offered', 'unavailable']
    assert all(row['pricing']['customer_total_paise'] == 0 for row in rows)
    value = main.operations_store.run(earnings.fund)
    assert value['reserved_paise'] == 1200 and earnings.available_fund(value) == 0


def loopback_emulator():
    match = re.fullmatch(r'(127\.0\.0\.1|localhost|\[::1\]):([0-9]{1,5})',
                         os.getenv('FIRESTORE_EMULATOR_HOST', ''))
    return bool(match and 1 <= int(match[2]) <= 65535)


pytestmark = pytest.mark.skipif(not loopback_emulator(), reason='Requires a loopback Firestore emulator')


@pytest.fixture(autouse=True)
def quiet_scheduler(monkeypatch):
    monkeypatch.setattr(main, 'operations_tick', lambda: None)


@pytest.fixture
def api(local_api, monkeypatch):
    assert loopback_emulator(), 'Refusing a non-loopback Firestore endpoint'
    project = 'demo-repaido-bike-' + uuid.uuid4().hex[:10]
    client = firestore.Client(project=project, credentials=AnonymousCredentials())
    monkeypatch.setattr(main, 'USE_FIRESTORE', True)
    monkeypatch.setattr(main, 'fb_db', client)
    assert main.operations_store.run(lambda u: u.tx is not None)
    yield local_api
    client.close()


def envelopes():
    records = main.operations_store.run(lambda u: u.all('bike_dispatch_outbox'))
    return sorted(({k:v for k,v in row.items() if k not in {'active', 'published'}}
                   for row in records if row['event_type'] == 'booking_requested'),
                  key=lambda row: row['sequence'])


def finish(api, row):
    row = start(api, row)
    with patch('time.time', return_value=time.time()+20):
        row = command(api, row, 'complete', position=gps(DROP))
    return command(api, row, 'confirm', 'customer')


def test_firestore_free_lifecycle_commits_hmac_quota_once(api, setup_bike):
    row, body = book(api, search(api)['quotes'][0])
    assert row['state'] == 'offered'
    replay = api.post(BASE+'/bookings', headers=auth('customer'), json=body)
    assert replay.status_code == 201 and replay.json()['id'] == row['id']
    row = finish(api, row)
    assert row['state'] == 'completed'
    quota = main.operations_store.run(lambda u: u.get('bike_quota', quota_key('customer')))
    assert list(quota['entries']) == [row['id']]
    assert quota['entries'][row['id']]['state'] == 'used'
    assert not main.operations_store.run(lambda u: u.get('bike_quota', bikes.digest('customer')))
    result = dispatch.apply_event(main.operations_store, envelopes()[0], bikes.consume_dispatch_event)
    assert result['duplicate'] is True


def test_firestore_concurrent_same_account_cannot_create_two_active_holds(api, setup_bike):
    quote = search(api)['quotes'][0]
    def request(_):
        return api.post(BASE+'/bookings', headers=auth('customer'), json={
            'quote_id': quote['id'], 'request_id': str(uuid.uuid4()),
            'pickup_address': 'Firestore fixture pickup entrance',
            'dropoff_address': 'Firestore fixture destination entrance',
            'rider_name': 'Fixture passenger', 'rider_phone': '9876543210',
            'for_someone_else': False, 'consent': True})
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(request, range(2)))
    assert sorted(response.status_code for response in responses) == [201, 409]
    quota = main.operations_store.run(lambda u: u.get('bike_quota', quota_key('customer')))
    assert len(quota['entries']) == 1
    assert len(envelopes()) == 1


def test_firestore_competing_customers_reserve_one_slot_in_committed_sequence(api, setup_bike, monkeypatch):
    first_quote, second_quote = search(api)['quotes'][0], search(api, 'stranger')['quotes'][0]
    monkeypatch.setattr(dispatch, 'drain_direct', lambda *args, **kwargs: None)
    first, _ = book(api, first_quote)
    second, _ = book(api, second_quote, 'stranger')
    ordered = envelopes()
    assert len(ordered) == 2 and ordered[0]['sequence'] < ordered[1]['sequence']
    def consume(event):
        for _ in range(20):
            try:
                return dispatch.apply_event(main.operations_store, event, bikes.consume_dispatch_event)
            except dispatch.RetryDispatch:
                time.sleep(.02)
        raise AssertionError('The preceding committed rider event did not finish')
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(consume, ordered))
    assert latest(api, first)['state'] == 'offered'
    assert latest(api, second, 'stranger')['state'] == 'unavailable'
    assert main.operations_store.run(lambda u: u.get('bike_quota', quota_key('stranger'))) is None
    slot = main.operations_store.run(lambda u: u.get('bike_slots', bikes.digest('worker')))
    assert slot['current_id'] == first['id'] and slot['next_id'] is None


def test_firestore_next_slot_promotes_and_old_invoice_cannot_overwrite_other_vehicle(api, setup_bike):
    first, _ = book(api, search(api)['quotes'][0]); first = start(api, first)
    with patch('time.time', return_value=time.time()+12):
        second, _ = book(api, search(api, 'stranger')['quotes'][0], 'stranger')
        second = command(api, second, 'accept')
        assert second['state'] == 'queued'
    with patch('time.time', return_value=time.time()+25):
        first = command(api, first, 'complete', position=gps(DROP))
    assert latest(api, second, 'stranger')['state'] == 'accepted'
    # Model a later vehicle assignment while the old physically finished invoice
    # remains open. Resolving it must not overwrite another operator's bike.
    old = main.operations_store.run(lambda u: u.get('bike_rides', first['id']))
    other_bike, other_ride = 'fixture-other-bike', 'fixture-other-ride'
    operator_slot = {'driver_id': 'worker', 'current_id': other_ride, 'next_id': None}
    original_vehicle_slot = {'driver_id': 'worker2', 'current_id': 'fixture-reassigned-ride', 'next_id': None}
    def arrange(u):
        u.put('bike_slots', bikes.digest('worker'), operator_slot)
        u.put('bike_vehicle_slots', other_bike, copy.deepcopy(operator_slot))
        u.put('bike_vehicle_slots', setup_bike, original_vehicle_slot)
    main.operations_store.run(arrange)
    main.operations_store.run(lambda u: bikes._release_slot(u, old))
    assert main.operations_store.run(lambda u: u.get('bike_slots', bikes.digest('worker'))) == operator_slot
    assert main.operations_store.run(lambda u: u.get('bike_vehicle_slots', setup_bike)) == original_vehicle_slot
    assert main.operations_store.run(lambda u: u.get('bike_vehicle_slots', other_bike)) == operator_slot


def test_firestore_paid_collection_remittance_and_salary_stay_separate(api, setup_bike):
    main.operations_store.run(lambda u: u.put('bike_policy', 'current', {**bikes.policy(u), 'promo_enabled': False}))
    row, _ = book(api, search(api)['quotes'][0]); row = finish(api, row)
    row = command(api, row, 'cash_reported', 'customer')
    row = command(api, row, 'cash_received')
    assert row['company_cash_held_paise'] == 1550 and row['state'] == 'completed'
    ledger = api.get(BASE+'/driver/remittances', headers=auth('worker')).json()
    account = ledger['company_cash']
    deposit = api.post(BASE+'/driver/remittances', headers=auth('worker'), json={
        'expected_version': account['version'], 'request_id': str(uuid.uuid4()),
        'ride_ids': [row['id']], 'amount_paise': 1550,
        'deposit_reference': 'FIRESTORE-DEPOSIT-001', 'evidence': 'Emulator-only external deposit evidence.'})
    assert deposit.status_code == 201, deposit.text
    receipt = api.post(BASE+'/payroll/remittances/'+deposit.json()['id']+'/confirm', headers=ADMIN, json={
        'expected_version': deposit.json()['version'], 'received': True,
        'receipt_reference': 'FIRESTORE-RECEIPT-001', 'evidence': 'Emulator-only company receipt evidence.'})
    assert receipt.status_code == 200, receipt.text
    assert receipt.json()['status'] == 'company_received'
    own = api.get(BASE+'/driver/payroll', headers=auth('worker')).json()
    assert own['monthly_salary_paise'] == 700000
    assert own['obligations'][0]['amount_paise'] == 700000
    assert own['obligations'][0]['status'] == 'owed'
    assert latest(api, row)['company_cash_held_paise'] == 0
