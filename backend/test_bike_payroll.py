"""Salary accounting uses real HTTP transactions, never cloud or bank mocks."""
import copy
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest
import main
import bike_payroll as payroll
from test_operations import api as sqlite_api, auth, ADMIN

BASE = '/operations/bike-rides'
INDIA = ZoneInfo('Asia/Kolkata')


@pytest.fixture(autouse=True)
def quiet_scheduler(monkeypatch):
    monkeypatch.setattr(main, 'operations_tick', lambda: None)


@pytest.fixture(params=['sqlite', 'native'])
def api(sqlite_api, monkeypatch, request):
    database = None
    if request.param == 'native':
        host = os.getenv('FIRESTORE_EMULATOR_HOST', '')
        if not host:
            pytest.skip('Requires an explicit loopback Firestore emulator')
        assert host.startswith(('127.0.0.1:', 'localhost:'))
        from google.auth.credentials import AnonymousCredentials
        from google.cloud.firestore import Client
        database = Client(project='demo-repaido-cash-'+uuid.uuid4().hex[:10], credentials=AnonymousCredentials())
        monkeypatch.setattr(main, 'USE_FIRESTORE', True)
        monkeypatch.setattr(main, 'fb_db', database)
        assert main.operations_store.core.USE_FIRESTORE
    try:
        yield sqlite_api
    finally:
        if database is not None:
            database.close()


def approved(uid, role='driver', city='Balasore', valid_until=None):
    now = time.time()
    doc = 'salary-document-' + uid
    main.operations_store.run(lambda u: (
        u.put('business_documents', doc, {'id': doc, 'owner_id': uid, 'created_at': now}),
        u.put('business_partners', uid, dict(id=uid, user_id=uid, role=role,
              city=city, name='Payroll rider ' + uid, status='approved', document_ids=[doc],
              valid_until=now+86400*365 if valid_until is None else valid_until))))


def enroll(api, ids=('worker',), **extra):
    data = dict(expected_version=0, enabled=True, monthly_funding_paise=len(ids)*payroll.SALARY_PAISE,
                funding_period=payroll.period_at(), funding_reference='fixture-payroll-reserve',
                funding_evidence='Fixture reserve recorded by the company accountant.',
                funding_acknowledged=True, roster=[dict(driver_id=uid, active=True) for uid in ids])
    data.update(extra)
    return api.put(BASE+'/payroll', headers=ADMIN, json=data)


def update_body(result, **extra):
    p = result['policy']
    body = {key: p[key] for key in ('enabled', 'monthly_funding_paise', 'funding_period',
            'funding_reference', 'funding_evidence', 'funding_acknowledged')}
    body.update(expected_version=p['version'], roster=[{'driver_id': row['driver_id'], 'active': row['active']} for row in p['roster']])
    body.update(extra)
    return body


def report(api, driver='worker', period=None, version=1, reference='UTR1234567890', **extra):
    body = dict(expected_version=version, amount_paise=payroll.SALARY_PAISE,
                transfer_reference=reference, evidence='Company bank transfer evidence reviewed.')
    body.update(extra)
    return api.post(f'{BASE}/payroll/{driver}/{period or payroll.period_at()}/payment', headers=ADMIN, json=body)


def test_default_closed_roles_alias_and_no_invented_staff_or_funding(api):
    for prefix in ('/operations', '/api/operations'):
        response = api.get(prefix+'/bike-rides/payroll', headers=ADMIN)
        assert response.status_code == 200, response.text
        data = response.json()
        assert data['policy']['enabled'] is False
        assert data['policy']['roster'] == [] and data['obligations'] == []
        assert data['readiness']['monthly_funding_paise'] == 0
        assert data['readiness']['monthly_salary_liability_paise'] == 0
        assert not data['readiness']['payroll_ready']
        assert response.headers['cache-control'] == 'private, no-store'
    for method, path in [('get', '/payroll'), ('get', '/payroll/candidates'), ('put', '/payroll')]:
        response = getattr(api, method)(BASE+path, headers=auth('worker'), **({'json':{}} if method == 'put' else {}))
        assert response.status_code == 403
    assert api.get(BASE+'/driver/payroll').status_code == 401
    own = api.get(BASE+'/driver/payroll', headers=auth('customer')).json()
    assert not own['rostered'] and own['obligations'] == []
    assert not {'monthly_funding_paise', 'funding_reference', 'funding_evidence', 'candidates'} & own.keys()


def test_three_fixed_salaries_enrollment_is_audited_and_versioned(api):
    for uid in ('worker', 'worker2', 'shop'):
        approved(uid, role='cab_owner' if uid == 'worker' else 'driver')
    response = enroll(api, ('worker', 'worker2', 'shop'))
    assert response.status_code == 200, response.text
    data = response.json()
    assert data['readiness']['payroll_ready'] and data['readiness']['funding_ready']
    assert data['readiness']['approved_rider_count'] == 3
    assert data['readiness']['monthly_salary_liability_paise'] == 2100000
    assert {row['amount_paise'] for row in data['obligations']} == {700000}
    assert {row['status'] for row in data['obligations']} == {'owed'}
    assert len({row['id'] for row in data['obligations']}) == 3
    assert enroll(api, ('worker',)).status_code == 409
    forbidden = update_body(data, monthly_salary_paise=100)
    assert api.put(BASE+'/payroll', headers=ADMIN, json=forbidden).status_code == 422
    assert main.operations_store.run(lambda u: payroll.approved_salaried_driver(u, 'worker', time.time()))
    rows = main.operations_store.run(lambda u: u.all('audit'))
    assert len([row for row in rows if row['action'] == 'BikeSalaryObligationCreated']) == 3
    assert len([row for row in rows if row['action'] == 'BikePayrollPolicyUpdated']) == 1


def test_roster_approval_city_documents_maximum_and_duplicate_checks(api):
    for uid in ('worker', 'worker2', 'shop', 'stranger'):
        approved(uid)
    assert enroll(api, ('worker', 'worker2', 'shop', 'stranger')).status_code == 422
    assert enroll(api, ('worker', 'worker')).status_code == 422
    assert enroll(api, ('unknown-person',)).status_code == 422
    approved('worker', city='Bhubaneswar')
    assert enroll(api).status_code == 422
    approved('worker', role='scrap_owner')
    assert enroll(api).status_code == 422
    approved('worker', valid_until=time.time()-1)
    assert enroll(api).status_code == 422
    approved('worker')
    main.operations_store.run(lambda u: u.put('business_documents', 'salary-document-worker', {'id':'salary-document-worker', 'owner_id':'worker2'}))
    assert enroll(api).status_code == 422
    assert api.get(BASE+'/payroll', headers=ADMIN).json()['policy']['version'] == 0
    assert main.operations_store.run(lambda u: u.all('bike_salary_obligations')) == []


def test_insufficient_unacknowledged_or_unreferenced_funding_never_enables(api):
    approved('worker')
    for extra in ({'monthly_funding_paise':699999}, {'monthly_funding_paise':0},
                  {'funding_acknowledged':False}, {'funding_reference':'bad'},
                  {'funding_evidence':'   '}, {'funding_period':'2020-01'}):
        response = enroll(api, **extra)
        assert response.status_code == 422, response.text
    data = api.get(BASE+'/payroll', headers=ADMIN).json()
    assert data['policy']['version'] == 0 and not data['policy']['roster']
    assert main.operations_store.run(lambda u: u.all('bike_salary_roster')) == []


def test_approval_expiry_stops_work_without_erasing_earned_salary(api):
    approved('worker')
    assert enroll(api).status_code == 200
    main.operations_store.run(lambda u: u.put('business_partners', 'worker', {**u.get('business_partners', 'worker'), 'valid_until':time.time()-1}))
    data = api.get(BASE+'/payroll', headers=ADMIN).json()
    assert not data['readiness']['payroll_ready'] and data['readiness']['approved_rider_count'] == 0
    assert data['obligations'][0]['amount_paise'] == 700000
    assert not main.operations_store.run(lambda u: payroll.approved_salaried_driver(u, 'worker'))
    assert report(api).status_code == 200
    response = api.post(BASE+'/driver/payroll/'+payroll.period_at()+'/confirm', headers=auth('worker'), json={'expected_version':2,'received':True})
    assert response.status_code == 200 and response.json()['status'] == 'driver_received'


def test_reported_salary_is_not_paid_until_own_receipt_and_retries_are_safe(api):
    approved('worker')
    data = enroll(api).json()
    period = data['period']
    assert api.post(f'{BASE}/driver/payroll/{period}/confirm', headers=auth('worker'), json={'expected_version':1,'received':True}).status_code == 409
    assert report(api, amount_paise=699999).status_code == 422
    assert report(api, amount_paise=True).status_code == 422
    assert report(api, version=9).status_code == 409
    first = report(api)
    assert first.status_code == 200, first.text
    assert first.json()['status'] == 'transfer_reported' and first.json()['received_at'] is None
    assert report(api).json() == first.json()
    assert report(api, reference='OTHER-TRANSFER-123').status_code == 409
    assert api.post(f'{BASE}/driver/payroll/{period}/confirm', headers=auth('stranger'), json={'expected_version':2,'received':True}).status_code == 404
    assert api.post(f'{BASE}/driver/payroll/{period}/confirm', headers=auth('worker'), json={'expected_version':1,'received':True}).status_code == 409
    response = api.post(f'{BASE}/driver/payroll/{period}/confirm', headers=auth('worker'), json={'expected_version':2,'received':True})
    assert response.status_code == 200, response.text
    row = response.json()
    assert row['status'] == 'driver_received' and row['receipt_source'] == 'driver_confirmed_receipt'
    assert row['received_by'] == 'worker'
    assert api.post(f'{BASE}/driver/payroll/{period}/confirm', headers=auth('worker'), json={'expected_version':2,'received':True}).json() == row
    audits = main.operations_store.run(lambda u: u.all('audit'))
    assert len([r for r in audits if r['action'] == 'BikeSalaryTransferReported']) == 1
    assert len([r for r in audits if r['action'] == 'BikeSalaryReceiptConfirmed']) == 1


def test_office_cash_salary_is_reported_once_and_requires_the_riders_receipt(api):
    approved('worker')
    data = enroll(api, salary_payment_method='office_cash', cash_collection_point='Company office').json()
    assert data['policy']['salary_payment_method'] == 'office_cash'
    assert data['obligations'][0]['status'] == 'owed'
    first = report(api, payment_method='office_cash', reference='OFFICE-CASH-2026-001',
                   evidence='Full salary counted and handed over against the office cash voucher.')
    assert first.status_code == 200, first.text
    row = first.json()
    assert row['transfer']['payment_method'] == 'office_cash'
    assert row['transfer']['source'] == 'company_reported_cash_handover'
    assert row['status'] == 'transfer_reported' and row['received_at'] is None
    assert report(api, payment_method='office_cash', reference='OFFICE-CASH-2026-001',
                  evidence='Full salary counted and handed over against the office cash voucher.').json() == row
    assert report(api, payment_method='bank_transfer', reference='OFFICE-CASH-2026-001',
                  evidence='Full salary counted and handed over against the office cash voucher.').status_code == 409
    own = api.get(BASE+'/driver/payroll', headers=auth('worker')).json()
    assert own['salary_payment_method'] == 'office_cash' and own['cash_collection_point'] == 'Company office'
    confirm = BASE+'/driver/payroll/'+data['period']+'/confirm'
    assert api.post(confirm, headers=auth('stranger'), json={'expected_version':2,'received':True}).status_code == 404
    response = api.post(confirm, headers=auth('worker'), json={'expected_version':2,'received':True})
    assert response.status_code == 200 and response.json()['status'] == 'driver_received'
    assert response.json()['transfer']['payment_method'] == 'office_cash'


def test_cash_reserve_still_needs_real_funding_acknowledgement(api):
    approved('worker')
    response = enroll(api, salary_payment_method='office_cash', funding_acknowledged=False)
    assert response.status_code == 422
    data = api.get(BASE+'/payroll', headers=ADMIN).json()
    assert not data['policy']['enabled'] and data['policy']['monthly_funding_paise'] == 0
    assert data['obligations'] == []


def test_cash_and_bank_salary_references_share_one_duplicate_guard(api):
    for uid in ('worker', 'worker2'):
        approved(uid)
    assert enroll(api, ('worker','worker2')).status_code == 200
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda item: report(api, driver=item[0], payment_method=item[1],
            reference='OFFICE-CASH-SHARED-001'), [('worker','office_cash'),('worker2','bank_transfer')]))
    assert sorted(response.status_code for response in responses) == [200,409]
    assert main.operations_store.run(lambda u: len(u.all('bike_salary_transfer_references'))) == 1


def test_older_clients_preserve_cash_preferences_and_legacy_transfer_retries(api):
    approved('worker')
    data = enroll(api, salary_payment_method='office_cash', cash_collection_point='Balasore company office').json()
    updated = api.put(BASE+'/payroll', headers=ADMIN, json=update_body(data))
    assert updated.status_code == 200
    assert updated.json()['policy']['salary_payment_method'] == 'office_cash'
    assert updated.json()['policy']['cash_collection_point'] == 'Balasore company office'
    first = report(api)
    assert first.status_code == 200
    row = first.json()
    row['transfer'].pop('payment_method')
    main.operations_store.run(lambda u: u.put('bike_salary_obligations', row['id'], row))
    assert report(api).json() == row
    assert report(api, payment_method='office_cash').status_code == 409


def test_transfer_reference_races_are_global_and_normalized(api):
    for uid in ('worker', 'worker2'):
        approved(uid)
    assert enroll(api, ('worker','worker2')).status_code == 200
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda uid: report(api, driver=uid), ('worker','worker2')))
    assert sorted(r.status_code for r in results) == [200,409]
    winner = next(r.json()['driver_id'] for r in results if r.status_code == 200)
    loser = 'worker2' if winner == 'worker' else 'worker'
    assert report(api, driver=loser, reference='utr-123 456 7890').status_code == 409
    assert main.operations_store.run(lambda u: len(u.all('bike_salary_transfer_references'))) == 1


def test_identical_salary_transfer_race_and_roster_race_are_idempotent(api):
    approved('worker')
    with ThreadPoolExecutor(max_workers=2) as pool:
        enrollment = list(pool.map(lambda _: enroll(api), range(2)))
    assert sorted(r.status_code for r in enrollment) == [200,409]
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: report(api), range(2)))
    assert [r.status_code for r in results] == [200,200]
    assert results[0].json() == results[1].json()
    assert main.operations_store.run(lambda u: len(u.all('bike_salary_obligations'))) == 1
    audits = main.operations_store.run(lambda u: u.all('audit'))
    assert len([r for r in audits if r['action'] == 'BikeSalaryTransferReported']) == 1


def test_offboarded_riders_keep_earned_salary_and_cannot_go_online(api):
    for uid in ('worker','worker2'):
        approved(uid)
    initial = enroll(api).json()
    body = update_body(initial, roster=[{'driver_id':'worker2','active':True}], monthly_funding_paise=700000)
    denied = api.put(BASE+'/payroll', headers=ADMIN, json=body)
    assert denied.status_code == 422, denied.text
    body['monthly_funding_paise'] = 1400000
    changed = api.put(BASE+'/payroll', headers=ADMIN, json=body)
    assert changed.status_code == 200, changed.text
    assert changed.json()['readiness']['monthly_salary_liability_paise'] == 1400000
    assert {row['driver_id'] for row in changed.json()['obligations']} == {'worker','worker2'}
    assert not main.operations_store.run(lambda u: payroll.approved_salaried_driver(u,'worker'))
    own = api.get(BASE+'/driver/payroll', headers=auth('worker')).json()
    assert own['rostered'] is False and own['roster']['active'] is False
    assert len(own['obligations']) == 1
    assert report(api).status_code == 200
    assert api.post(BASE+'/driver/payroll/'+initial['period']+'/confirm', headers=auth('worker'), json={'expected_version':2,'received':True}).status_code == 200


def test_indian_month_boundary_ledger_funding_expiry_and_tick_are_exact(api):
    start = datetime(2026,10,31,23,50,tzinfo=INDIA).timestamp()
    next_month = datetime(2026,11,1,0,1,tzinfo=INDIA).timestamp()
    with patch('time.time', return_value=start):
        approved('worker', valid_until=next_month+86400*100)
        data = enroll(api).json()
        assert data['period'] == '2026-10'
    with patch('time.time', return_value=next_month):
        for _ in range(3):
            main.operations_store.run(lambda u: payroll.tick(u, next_month))
        data = api.get(BASE+'/payroll', headers=ADMIN).json()
        assert data['period'] == '2026-11' and not data['readiness']['funding_ready']
        assert not main.operations_store.run(lambda u: payroll.approved_salaried_driver(u,'worker',next_month))
        assert main.operations_store.run(lambda u: len(u.all('bike_salary_obligations'))) == 2
        body = update_body(data, funding_period='2026-11')
        assert api.put(BASE+'/payroll', headers=ADMIN, json=body).json()['readiness']['payroll_ready']
        rows = api.get(BASE+'/driver/payroll', headers=auth('worker')).json()['obligations']
        assert [r['period'] for r in rows] == ['2026-11','2026-10']
        assert report(api, period='2026-11').status_code == 200
        assert report(api, period='2026-10').status_code == 409
        assert api.get(BASE+'/payroll?period=2026-12', headers=ADMIN).status_code == 422
        assert api.get(BASE+'/payroll?period=2026-13', headers=ADMIN).status_code == 422


def test_private_driver_salary_view_never_exposes_other_staff_funding_or_documents(api):
    for uid in ('worker','worker2'):
        approved(uid)
    assert enroll(api, ('worker','worker2')).status_code == 200
    assert report(api, driver='worker2').status_code == 200
    data = api.get(BASE+'/driver/payroll', headers=auth('worker')).json()
    assert {r['driver_id'] for r in data['obligations']} == {'worker'}
    text = str(data)
    for private in ('worker2', 'fixture-payroll-reserve', 'funding_evidence', 'salary-document-', 'UTR1234567890'):
        assert private not in text
    assert api.post(BASE+'/payroll/worker2/'+payroll.period_at()+'/payment',headers=auth('worker'),json={}).status_code == 403


def test_candidates_are_approved_local_current_and_pagination_is_bounded(api):
    approved('worker')
    approved('worker2', city='Cuttack')
    approved('shop', role='scrap_owner')
    approved('stranger', valid_until=time.time()-1)
    data = api.get(BASE+'/payroll/candidates', headers=ADMIN).json()
    assert [r['driver_id'] for r in data['candidates']] == ['worker']
    assert data['next_cursor'] is None
    assert not {'document_ids','address','phone','location'} & data['candidates'][0].keys()
    class Bounded:
        def find(self, kind, field, value, **kwargs):
            assert kind == 'business_partners' and field == 'status' and value == 'approved'
            assert kwargs == {'limit':100,'after':'cursor-record'}
            return []
    assert payroll._candidates(Bounded(), time.time(), 'cursor-record') == {'candidates':[],'next_cursor':None}


def test_eligibility_uses_only_bounded_point_reads_not_global_or_driver_scans(api):
    approved('worker')
    assert enroll(api).status_code == 200
    class PointReads:
        def __init__(self, unit):
            self.unit = unit
        def get(self, *args):
            return self.unit.get(*args)
        def all(self, *args):
            raise AssertionError('No collection scan is allowed.')
        def find(self, *args, **kwargs):
            raise AssertionError('No query is needed for roster eligibility.')
    ready = main.operations_store.run(lambda u: payroll.policy_readiness(PointReads(u), {}, time.time()))
    assert ready['payroll_ready']
    assert main.operations_store.run(lambda u: payroll.approved_salaried_driver(PointReads(u), 'worker'))


def cash_collected(uid='worker', ride_id='paid-ride-1', amount=2500):
    row = dict(id=ride_id, driver_id=uid, customer_id='customer', state='completed',
               payment_status='rider_confirmed_cash', collected_paise=amount,
               company_cash_held_paise=amount, company_collection_status='held_by_rider',
               pricing={'free':False, 'customer_total_paise':amount})
    def save(u):
        u.put('bike_rides', ride_id, row)
        return payroll.record_company_cash(u, row)
    return main.operations_store.run(save)


def cash_report(api, uid='worker', ride_ids=None, amount=2500, reference='DEPOSIT123456789', **extra):
    import uuid
    account = api.get(BASE+'/driver/remittances', headers=auth(uid)).json()['company_cash']
    body = dict(expected_version=account['version'], request_id=str(uuid.uuid4()),
                ride_ids=ride_ids or ['paid-ride-1'], amount_paise=amount,
                deposit_reference=reference, evidence='External bank cash deposit receipt recorded.')
    body.update(extra)
    response = api.post(BASE+'/driver/remittances', headers=auth(uid), json=body)
    return response, body


def cash_receive(api, row, reference='COMPANYRECEIPT123456', **extra):
    body = dict(expected_version=row['version'], received=True,
                receipt_reference=reference, evidence='Company accountant checked actual receipt of this deposit.')
    body.update(extra)
    return api.post(BASE+'/payroll/remittances/'+row['id']+'/confirm', headers=ADMIN, json=body)


def test_company_fare_cash_is_separate_and_only_company_receipt_releases_hold(api):
    approved('worker')
    assert enroll(api).status_code == 200
    credit = cash_collected()
    private = api.get(BASE+'/driver/remittances', headers=auth('worker')).json()
    assert private['company_cash']['collected_paise'] == 2500
    assert private['company_cash']['outstanding_held_paise'] == 2500
    assert private['available_collections'] == [{key:credit[key] for key in ('ride_id','amount_paise','collected_at','period')}]
    response, body = cash_report(api)
    assert response.status_code == 201, response.text
    row = response.json()
    assert row['status'] == 'deposit_reported' and row['received_at'] is None
    account = api.get(BASE+'/driver/payroll', headers=auth('worker')).json()
    assert account['company_cash']['reported_remittance_paise'] == 2500
    assert account['company_cash']['outstanding_held_paise'] == 2500
    assert account['company_cash']['available_to_report_paise'] == 0
    assert account['obligations'][0]['status'] == 'owed'
    assert not api.get(BASE+'/driver/remittances', headers=auth('worker')).json()['available_collections']
    assert api.post(BASE+'/driver/remittances', headers=auth('worker'), json=body).json() == row
    assert 'request_fingerprint' not in row
    confirmed = cash_receive(api, row)
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()['status'] == 'company_received'
    assert confirmed.json()['receipt']['source'] == 'company_confirmed_receipt'
    assert cash_receive(api, row).json() == confirmed.json()
    summary = main.operations_store.run(payroll.company_cash_totals)
    assert summary['collected_paise'] == summary['confirmed_remittance_paise'] == 2500
    assert summary['outstanding_held_paise'] == summary['reported_remittance_paise'] == 0
    updated_ride = main.operations_store.run(lambda u:u.get('bike_rides','paid-ride-1'))
    assert updated_ride['company_cash_held_paise'] == 0 and updated_ride['company_collection_status'] == 'company_received'
    assert api.get(BASE+'/payroll', headers=ADMIN).json()['company_cash_accounts'] == []
    assert main.operations_store.run(lambda u:u.get('bike_salary_obligations',payroll.salary_key('worker',payroll.period_at())))['status'] == 'owed'
    audits = main.operations_store.run(lambda u:u.all('audit'))
    for kind in ('BikeCompanyFareCollected','BikeCompanyFareRemittanceReported','BikeCompanyFareRemittanceReceived'):
        assert len([row for row in audits if row['action'] == kind]) == 1


def test_cash_ownership_exact_amount_and_admin_receipt_authorization(api):
    cash_collected()
    assert cash_report(api, amount=2400)[0].status_code == 422
    assert cash_report(api, uid='stranger')[0].status_code == 404
    assert cash_report(api, ride_ids=['paid-ride-1','paid-ride-1'], amount=5000)[0].status_code == 422
    assert cash_report(api, expected_version=99)[0].status_code == 409
    assert main.operations_store.run(payroll.company_cash_totals)['reported_remittance_paise'] == 0
    response, body = cash_report(api)
    assert response.status_code == 201, response.text
    row = response.json()
    assert cash_report(api, reference='OTHERDEPOSIT12345')[0].status_code == 409
    assert cash_receive(api, row, expected_version=99).status_code == 409
    receipt = dict(expected_version=1,received=True,receipt_reference='COMPANYRECEIPT123456',evidence='Company accountant reviewed actual bank receipt.')
    assert api.post(BASE+'/payroll/remittances/'+row['id']+'/confirm', headers=auth('worker'), json=receipt).status_code == 403
    for path in ('/payroll/cash-accounts','/payroll/remittances'):
        assert api.get(BASE+path, headers=auth('worker')).status_code == 403
    stranger = api.get(BASE+'/driver/remittances',headers=auth('stranger')).json()
    assert stranger['items'] == [] and stranger['available_collections'] == []
    assert stranger['company_cash']['collected_paise'] == 0
    assert cash_receive(api,row).status_code == 200
    assert cash_receive(api,row,reference='ANOTHERRECEIPT123').status_code == 409


def test_cash_deposit_and_receipt_references_are_unique_across_riders(api):
    cash_collected()
    cash_collected('worker2','paid-ride-2',3000)
    a, _ = cash_report(api)
    assert a.status_code == 201
    bad, _ = cash_report(api, uid='worker2',ride_ids=['paid-ride-2'],amount=3000,reference='deposit-123 456789')
    assert bad.status_code == 409
    b, _ = cash_report(api, uid='worker2',ride_ids=['paid-ride-2'],amount=3000,reference='SECONDDEPOSIT12345')
    assert b.status_code == 201
    assert cash_receive(api,a.json()).status_code == 200
    assert cash_receive(api,b.json()).status_code == 409
    assert cash_receive(api,b.json(),reference='SECONDRECEIPT12345').status_code == 200
    totals = main.operations_store.run(payroll.company_cash_totals)
    assert totals['collected_paise'] == totals['confirmed_remittance_paise'] == 5500
    assert totals['outstanding_held_paise'] == 0


def test_concurrent_deposits_cannot_allocate_same_collected_ride_twice(api):
    import uuid
    cash_collected()
    body = dict(expected_version=1,request_id=str(uuid.uuid4()),ride_ids=['paid-ride-1'],amount_paise=2500,
                deposit_reference='ONCEDEPOSIT123456',evidence='Actual deposit receipt details recorded here.')
    with ThreadPoolExecutor(max_workers=2) as pool:
        same = list(pool.map(lambda _: api.post(BASE+'/driver/remittances',headers=auth('worker'),json=body),range(2)))
    assert [r.status_code for r in same] == [201,201]
    assert same[0].json() == same[1].json()
    changed = {**body, 'request_id':str(uuid.uuid4()), 'deposit_reference':'SECONDDEPOSIT123456', 'expected_version':2}
    assert api.post(BASE+'/driver/remittances',headers=auth('worker'),json=changed).status_code == 409
    receipt = same[0].json()
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _:cash_receive(api,receipt),range(2)))
    assert [r.status_code for r in results] == [200,200]
    assert main.operations_store.run(payroll.company_cash_totals)['confirmed_remittance_paise'] == 2500


def test_company_cash_credit_retries_and_two_different_deposits_are_atomic(api):
    import uuid
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: cash_collected(),range(2)))
    assert results[0]['id'] == results[1]['id']
    assert main.operations_store.run(payroll.company_cash_totals)['collected_paise'] == 2500
    row = dict(expected_version=1,ride_ids=['paid-ride-1'],amount_paise=2500,
               evidence='Actual completed cash deposit receipt evidence.')
    commands = [{**row,'request_id':str(uuid.uuid4()),'deposit_reference':ref} for ref in ('DEPOSITRACE12345','DEPOSITRACE67890')]
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda body:api.post(BASE+'/driver/remittances',headers=auth('worker'),json=body),commands))
    assert sorted(r.status_code for r in results) == [201,409]
    assert main.operations_store.run(payroll.company_cash_totals)['reported_remittance_paise'] == 2500


def test_free_unconfirmed_or_mismatched_ride_never_creates_company_cash(api):
    base = dict(id='invalidcashride',driver_id='worker',state='completed',payment_status='rider_confirmed_cash',
                collected_paise=2500,pricing={'free':False,'customer_total_paise':2500})
    from fastapi import HTTPException
    for changes in ({'state':'payment_reported'},{'payment_status':'customer_reported_cash'},
                    {'collected_paise':2400},{'collected_paise':True},
                    {'pricing':{'free':True,'customer_total_paise':0}}):
        with pytest.raises(HTTPException):
            main.operations_store.run(lambda u:payroll.record_company_cash(u,{**base,**changes}))
    assert main.operations_store.run(payroll.company_cash_totals)['collected_paise'] == 0
    assert main.operations_store.run(lambda u:u.all('bike_company_cash_credits')) == []


def test_offboarded_driver_still_remits_company_cash_and_salary_does_not_offset_it(api):
    approved('worker')
    enrolled = enroll(api).json()
    cash_collected()
    assert report(api).status_code == 200
    assert api.post(BASE+'/driver/payroll/'+payroll.period_at()+'/confirm',headers=auth('worker'),json={'expected_version':2,'received':True}).status_code == 200
    assert main.operations_store.run(payroll.company_cash_totals)['outstanding_held_paise'] == 2500
    changed = api.put(BASE+'/payroll',headers=ADMIN,json=update_body(enrolled,enabled=False,roster=[]))
    assert changed.status_code == 200,changed.text
    assert changed.json()['company_cash_accounts'][0]['driver_id'] == 'worker'
    response,_ = cash_report(api)
    assert response.status_code == 201,response.text
    assert cash_receive(api,response.json()).status_code == 200
    assert api.get(BASE+'/driver/payroll',headers=auth('worker')).json()['obligations'][0]['status'] == 'driver_received'


def test_cross_month_cash_ledger_stays_with_collection_month_until_actual_company_receipt(api):
    october = datetime(2026,10,31,23,59,tzinfo=INDIA).timestamp()
    november = datetime(2026,11,1,0,5,tzinfo=INDIA).timestamp()
    with patch('time.time',return_value=october):
        cash_collected()
    with patch('time.time',return_value=november):
        response,_ = cash_report(api)
        assert response.status_code == 201,response.text
        assert cash_receive(api,response.json()).status_code == 200
        october_row = api.get(BASE+'/driver/payroll?period=2026-10',headers=auth('worker')).json()
        november_row = api.get(BASE+'/driver/payroll?period=2026-11',headers=auth('worker')).json()
        assert october_row['company_cash_monthly']['collected_paise'] == 2500
        assert october_row['company_cash_monthly']['confirmed_remittance_paise'] == 2500
        assert november_row['company_cash_monthly']['collected_paise'] == 0
        assert october_row['company_cash']['outstanding_held_paise'] == 0
        assert november_row['cash_scope'] == 'all_time_company_cash'


def test_rerecording_a_remitted_cash_ride_cannot_recreate_held_cash(api):
    cash_collected()
    response,_ = cash_report(api)
    assert cash_receive(api,response.json()).status_code == 200
    before = main.operations_store.run(payroll.company_cash_totals)
    ride = main.operations_store.run(lambda u:u.get('bike_rides','paid-ride-1'))
    ride['company_cash_held_paise'] = 2500
    ride['company_collection_status'] = 'held_by_rider'
    main.operations_store.run(lambda u:payroll.record_company_cash(u,ride))
    assert ride['company_cash_held_paise'] == 0 and ride['company_collection_status'] == 'company_received'
    assert main.operations_store.run(payroll.company_cash_totals) == before


def test_offboarding_catches_up_missed_salary_months_without_erasing_obligations(api):
    october = datetime(2026,10,10,12,tzinfo=INDIA).timestamp()
    december = datetime(2026,12,10,12,tzinfo=INDIA).timestamp()
    with patch('time.time',return_value=october):
        approved('worker',valid_until=december+86400*365)
        enrolled = enroll(api).json()
    with patch('time.time',return_value=december):
        body = update_body(enrolled,enabled=False,roster=[],monthly_funding_paise=0,
                           funding_period='',funding_reference='',funding_evidence='',funding_acknowledged=False)
        response = api.put(BASE+'/payroll',headers=ADMIN,json=body)
        assert response.status_code == 200,response.text
        for period in ('2026-10','2026-11','2026-12'):
            view = api.get(BASE+'/payroll?period='+period,headers=ADMIN).json()
            assert len(view['obligations']) == 1
            assert view['obligations'][0]['driver_id'] == 'worker'
            assert view['obligations'][0]['amount_paise'] == 700000
        assert main.operations_store.run(lambda u:len(u.all('bike_salary_obligations'))) == 3
        assert main.operations_store.run(lambda u:u.get('bike_salary_roster',payroll.digest('worker')))['active'] is False
