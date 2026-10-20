"""Owner-delegated office-cash setup through native policy/payroll handlers."""
import importlib.util
from pathlib import Path
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import HTTPException
import bike_payroll
import bike_rides
import main
from test_bike_payroll import api, quiet_scheduler, sqlite_api, approved, enroll
from test_local_business import vehicle

spec = importlib.util.spec_from_file_location('office_cash_setup', Path(__file__).resolve().parents[1]/'scripts/activate-bike-office-cash.py')
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


@pytest.fixture
def pilot(api, monkeypatch):
    monkeypatch.setenv('REPAIDO_ENV','test')
    monkeypatch.setenv('REPAIDO_BIKE_DISPATCH_MODE','direct')
    monkeypatch.setenv('REPAIDO_BIKE_DIRECT_DEV_ENABLED','true')
    monkeypatch.setenv('GOOGLE_ROUTES_API_KEY','synthetic-test-key-not-a-credential')
    monkeypatch.setenv('REPAIDO_BIKE_PROMO_QUOTA_SECRET','synthetic-office-cash-quota-key-at-least-32-bytes')
    identifier = vehicle(api,vehicle_kind='bike',seats=1,name='Office cash pilot bike')
    main.operations_store.run(lambda u:(
        u.put('bike_policy','current',{**bike_rides.DEFAULT,'version':2,'enabled':False,
            'cash_enabled':True,'tax_reviewed':True,'service_center':setup.CENTRE,
            'service_area_reviewed':False,'service_area_radius_metres':8000,
            'promo_enabled':True,'promo_started_at':time.time()-86400,'promo_terms_reviewed':True,
            'terms':'Existing reviewed test customer fare and cancellation terms.',
            'evidence_reference':'existing-reviewed-test-policy'}),
        u.put('bike_payroll_policy','current',{**bike_payroll.DEFAULT,'version':1,'funding_period':bike_payroll.period_at()})))
    return api,identifier


def apply(identifier):
    return main.operations_store.run(lambda u:setup.activate(u,driver_id='worker',vehicle_id=identifier,
        period=bike_payroll.period_at(),policy_version=2,payroll_version=1,actor='cloud-shell:synthetic-operator'))


def test_cash_pilot_setup_is_atomic_idempotent_and_never_records_salary_paid(pilot):
    api,identifier=pilot
    result=apply(identifier)
    assert result['bookings_available'] and not result['salary_paid'] and not result['rider_online_created']
    snapshot=main.operations_store.run(lambda u:(bike_rides.policy(u),bike_payroll.policy(u),
        u.all('bike_salary_obligations'),u.all('bike_salary_transfer_references'),u.all('bike_rider_presence')))
    p,payroll,obligations,references,presence=snapshot
    assert p['enabled'] and p['service_area_reviewed']
    assert payroll['salary_payment_method']=='office_cash' and payroll['monthly_funding_paise']==700000
    assert len(obligations)==1 and obligations[0]['status']=='owed' and obligations[0]['transfer'] is None
    assert references==[] and presence==[]
    again=apply(identifier)
    assert again['status']=='already_saved' and not again['mutations_performed']
    assert main.operations_store.run(lambda u:(bike_rides.policy(u),bike_payroll.policy(u),
        u.all('bike_salary_obligations'),u.all('bike_salary_transfer_references'),u.all('bike_rider_presence')))==snapshot
    if main.USE_FIRESTORE:
        assert main.fb_db.collection('ops_bike_policy').document('current').get().to_dict()['enabled']


def test_concurrent_cash_pilot_requests_create_one_coverage_and_one_salary_obligation(pilot):
    _,identifier=pilot
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda _:apply(identifier),range(2)))
    assert sorted(row['status'] for row in results)==['activated','already_saved']
    p,payroll,obligations=main.operations_store.run(lambda u:(bike_rides.policy(u),bike_payroll.policy(u),u.all('bike_salary_obligations')))
    assert p['version']==3 and payroll['version']==2
    assert len(obligations)==1 and obligations[0]['status']=='owed'


@pytest.mark.parametrize('fault',['dispatch','vehicle','area','stale','other_salary'])
def test_failed_cash_pilot_preserves_all_policy_salary_and_payment_records(pilot,monkeypatch,fault):
    api,identifier=pilot
    if fault=='dispatch':
        monkeypatch.setenv('REPAIDO_BIKE_DISPATCH_MODE','pubsub')
        monkeypatch.setenv('REPAIDO_BIKE_PUBSUB_TOPIC','projects/repaido/topics/repaido-bike-dispatch-v1')
        monkeypatch.setenv('REPAIDO_BIKE_PUBSUB_SUBSCRIPTION','projects/repaido/subscriptions/repaido-bike-dispatch-worker-v1')
    def change(u):
        if fault=='vehicle':
            row=u.get('mobility_vehicles',identifier);row['status']='pending';u.put('mobility_vehicles',identifier,row)
        if fault in ('area','stale'):
            row=bike_rides.policy(u);row['service_area_radius_metres' if fault=='area' else 'version']=9000 if fault=='area' else 3;u.put('bike_policy','current',row)
        if fault=='other_salary':u.put('bike_salary_periods',bike_payroll.period_at(),{'driver_ids':['other-rider']})
    main.operations_store.run(change)
    def snapshot(u):return {kind:u.all(kind) for kind in ('bike_policy','bike_payroll_policy','bike_salary_roster','bike_salary_obligations','bike_salary_transfer_references','bike_launch_maintenance')}
    before=main.operations_store.run(snapshot)
    with pytest.raises(HTTPException):apply(identifier)
    assert main.operations_store.run(snapshot)==before


@pytest.fixture
def saved_two_rider_pilot(pilot):
    api,identifier=pilot
    approved('second-rider')
    result=enroll(api,ids=('worker','second-rider'),expected_version=1,
                  enabled=False,monthly_funding_paise=700000)
    assert result.status_code==200,result.text
    def review(u):
        p=bike_rides.policy(u)
        u.put('bike_policy','current',{**p,'version':3,'service_area_reviewed':True})
    main.operations_store.run(review)
    return identifier


def apply_saved_roster(identifier, **extra):
    args=dict(driver_id='worker',vehicle_id=identifier,period=bike_payroll.period_at(),
              policy_version=3,payroll_version=2,actor='cloud-shell:synthetic-operator',
              coverage_paise=1400000,preserve_saved_roster=True,expected_active_riders=2)
    args.update(extra)
    return main.operations_store.run(lambda u:setup.activate(u,**args))


def financial_snapshot(u):
    return {kind:u.all(kind) for kind in ('bike_policy','bike_payroll_policy','bike_salary_roster',
        'bike_salary_obligations','bike_salary_transfer_references','bike_launch_maintenance','audit')}


def test_saved_two_rider_cash_setup_preserves_obligations_and_private_funding_history(saved_two_rider_pilot):
    identifier=saved_two_rider_pilot
    before=main.operations_store.run(financial_snapshot)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda _:apply_saved_roster(identifier),range(2)))
    assert sorted(row['status'] for row in results)==['activated','already_saved']
    assert all(row['active_rider_count']==2 and not row['salary_paid'] and
               'previous_funding' not in row for row in results)
    after=main.operations_store.run(financial_snapshot)
    assert after['bike_salary_obligations']==before['bike_salary_obligations']
    assert all(row['status']=='owed' and row['transfer'] is None for row in after['bike_salary_obligations'])
    assert after['bike_salary_transfer_references']==[]
    old=before['bike_payroll_policy'][0]
    saved=after['bike_payroll_policy'][0]
    assert saved['enabled'] and saved['version']==3 and saved['monthly_funding_paise']==1400000
    assert saved['roster']==old['roster']
    assert saved['salary_payment_method']=='office_cash'
    history=after['bike_launch_maintenance'][0]['previous_funding']
    assert all(history[name]==old[name] for name in ('version','funding_reference','funding_evidence','monthly_funding_paise'))
    assert after['bike_policy'][0]['version']==4 and after['bike_policy'][0]['enabled']
    again=apply_saved_roster(identifier)
    assert again['status']=='already_saved'
    assert main.operations_store.run(financial_snapshot)==after
    if main.USE_FIRESTORE:
        actual=main.fb_db.collection('ops_bike_payroll_policy').document('current').get().to_dict()
        assert actual['monthly_funding_paise']==1400000 and len(actual['roster'])==2


@pytest.mark.parametrize('fault',['underfunded','wrong_count','extra_earned_salary','stale',
                                  'unapproved_second_rider','higher_existing_coverage','dispatch'])
def test_saved_roster_failure_rolls_back_every_salary_and_policy_write(saved_two_rider_pilot,monkeypatch,fault):
    identifier=saved_two_rider_pilot
    extra={}
    if fault=='underfunded':extra['coverage_paise']=700000
    if fault=='wrong_count':extra.update(expected_active_riders=1,coverage_paise=700000)
    if fault=='stale':extra['payroll_version']=1
    if fault=='dispatch':monkeypatch.setenv('REPAIDO_BIKE_DISPATCH_MODE','pubsub')
    def change(u):
        if fault=='extra_earned_salary':
            row=u.get('bike_salary_periods',bike_payroll.period_at())
            row['driver_ids'].append('offboarded-rider')
            u.put('bike_salary_periods',bike_payroll.period_at(),row)
        if fault=='unapproved_second_rider':
            row=u.get('business_partners','second-rider');row['status']='pending'
            u.put('business_partners','second-rider',row)
        if fault=='higher_existing_coverage':
            row=bike_payroll.policy(u);row['monthly_funding_paise']=2100000
            u.put('bike_payroll_policy','current',row)
    main.operations_store.run(change)
    before=main.operations_store.run(financial_snapshot)
    with pytest.raises(HTTPException):apply_saved_roster(identifier,**extra)
    assert main.operations_store.run(financial_snapshot)==before
