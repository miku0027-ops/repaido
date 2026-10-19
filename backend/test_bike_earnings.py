"""Actual isolated HTTP salary/per-ride coexistence and accounting races."""
import copy
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
import main
import bike_earnings as earnings
from test_bike_rides import api, setup_bike, search, book, latest, command, gps, DROP, BASE
from test_operations import auth, ADMIN
from test_local_business import vehicle


def independent(api, uid='worker2', funding=1200):
    p = api.get(BASE+'/earnings/admin', headers=ADMIN).json()['policy']
    if not p['enabled']:
        response = api.put(BASE+'/earnings/policy', headers=ADMIN, json={
            'expected_version':p['version'], 'enabled':True, 'paid_payout_bps':8000,
            'promo_payout_paise':1200, 'reviewed':True,
            'terms':'Fixture only: 80 percent of fare before tax; fixed launch earning; company cash is remitted separately.',
            'reference':'FIXTURE-PAID-REVIEW'})
        assert response.status_code == 200, response.text
        p = response.json()
    identifier = vehicle(api, uid=uid, vehicle_kind='bike', seats=1)
    own = api.get(BASE+'/driver/earnings', headers=auth(uid)).json()
    response = api.post(BASE+'/driver/earnings/enrollment', headers=auth(uid), json={
        'expected_version':own['enrollment']['version'] if own['enrollment'] else 0,
        'terms_version':p['terms_version'], 'consent':True})
    assert response.status_code == 200, response.text
    enrollment = response.json()['enrollment']
    response = api.post(BASE+'/earnings/riders/'+uid+'/review', headers=ADMIN, json={
        'expected_version':enrollment['version'], 'status':'approved', 'reference':'FIXTURE-RIDER-REVIEW',
        'evidence':'Fixture only original rider and bike documents reviewed.'})
    assert response.status_code == 200, response.text
    if funding:
        body = {'request_id':str(uuid.uuid4()), 'amount_paise':funding, 'reference':'FUNDING-'+str(uuid.uuid4()),
                'evidence':'Fixture only company promotion reserve received.', 'received':True}
        response = api.post(BASE+'/earnings/funding', headers=ADMIN, json=body)
        assert response.status_code == 201, response.text
    response = api.put(BASE+'/driver/availability', headers=auth(uid), json={'vehicle_id':identifier,'online':True,'position':gps()})
    assert response.status_code == 200, response.text
    return identifier


def quote(api, vid, uid='customer'):
    return next(row for row in search(api, uid)['quotes'] if row['vehicle_id'] == vid)


def finish(api, row, uid='worker2', customer='customer'):
    row=command(api,row,'accept',uid)
    row=command(api,row,'depart',uid,position=gps())
    row=command(api,row,'start',uid,otp=latest(api,row,customer)['otp'],position=gps())
    row=command(api,row,'complete',uid,position=gps(DROP))
    return command(api,row,'confirm',customer)


def test_default_unconfigured_and_approval_cannot_assign_unpaid_independent_riders(api, setup_bike):
    assert not api.get(BASE+'/driver/earnings',headers=auth('worker2')).json()['approved']
    assert api.post(BASE+'/driver/earnings/enrollment',headers=auth('worker2'),json={'expected_version':0,'terms_version':1,'consent':True}).status_code==409
    assert api.put(BASE+'/earnings/policy',headers=auth('customer'),json={'expected_version':0,'terms':'Fixture reviewed terms, not a real agreement.','reference':'FIXTURE-REF'}).status_code==403
    body={'expected_version':0,'enabled':True,'paid_payout_bps':0,'reviewed':True,'terms':'Fixture reviewed terms, not a real agreement.','reference':'FIXTURE-REF'}
    assert api.put(BASE+'/earnings/policy',headers=ADMIN,json=body).status_code==422
    body.update(paid_payout_bps=8000)
    assert api.put(BASE+'/earnings/policy',headers=ADMIN,json=body).status_code==200
    assert api.post(BASE+'/driver/earnings/enrollment',headers=auth('worker'),json={'expected_version':0,'terms_version':1,'consent':True}).status_code==409


def test_suspended_rider_requires_company_reopen_and_explicit_new_consent(api, setup_bike):
    independent(api)
    data=api.get(BASE+'/driver/earnings',headers=auth('worker2')).json()
    def decision(status, version):
        return api.post(BASE+'/earnings/riders/worker2/review',headers=ADMIN,json={
            'expected_version':version,'status':status,'reference':'FIXTURE-REOPEN-REVIEW',
            'evidence':'Fixture only: company reviewed the application decision.'})
    response=decision('suspended',data['enrollment']['version']); assert response.status_code==200
    p=api.get(BASE+'/earnings/admin',headers=ADMIN).json()['policy']
    p.update(expected_version=p.pop('version'),terms=p['terms']+' Updated fixture terms.');p.pop('terms_version')
    assert api.put(BASE+'/earnings/policy',headers=ADMIN,json=p).status_code==200
    terms=api.get(BASE+'/driver/earnings',headers=auth('worker2')).json()['policy']['terms_version']
    assert api.post(BASE+'/driver/earnings/enrollment',headers=auth('worker2'),json={
        'expected_version':response.json()['version'],'terms_version':terms,'consent':True}).status_code==409
    reopened=decision('pending',response.json()['version']); assert reopened.status_code==200
    assert decision('approved',reopened.json()['version']).status_code==409
    consent=api.post(BASE+'/driver/earnings/enrollment',headers=auth('worker2'),json={
        'expected_version':reopened.json()['version'],'terms_version':terms,'consent':True})
    assert consent.status_code==200 and not consent.json()['approved']
    assert decision('approved',consent.json()['enrollment']['version']).status_code==200


def test_paused_salary_membership_cannot_also_earn_as_independent(api, setup_bike):
    independent(api)
    p=api.get(BASE+'/payroll',headers=ADMIN).json()['policy']
    response=api.put(BASE+'/payroll',headers=ADMIN,json={
        'expected_version':p['version'],'enabled':False,
        'roster':[{'driver_id':'worker','active':True}]})
    assert response.status_code==200, response.text
    response=api.post(BASE+'/driver/earnings/enrollment',headers=auth('worker'),json={
        'expected_version':0,'terms_version':1,'consent':True})
    assert response.status_code==409 and response.json()['detail']['code']=='SALARIED_ASSIGNMENT'
    # An earlier pending application cannot bypass the membership guard either.
    main.operations_store.run(lambda u:u.put('bike_independent_riders','worker',{
        'id':'worker','name':'Fixture salaried rider','status':'pending','version':1,'terms_version':1}))
    response=api.post(BASE+'/earnings/riders/worker/review',headers=ADMIN,json={
        'expected_version':1,'status':'approved','reference':'FIXTURE-COMPENSATION-REVIEW',
        'evidence':'Fixture only: a paused salary assignment remains active.'})
    assert response.status_code==409
    assert not main.operations_store.run(lambda u:earnings.approved(u,'worker'))


def test_cash_shard_migration_preserves_preexisting_cash_receipts(api, setup_bike):
    import bike_payroll as payroll
    def legacy(u):
        value={**payroll._empty_cash('worker'),'collected_paise':2500,'outstanding_held_paise':2500,'available_to_report_paise':2500,'outstanding':True}
        u.put('bike_company_cash_accounts',payroll.digest('worker'),value)
        u.put('bike_company_cash_totals','current',{**value,'driver_id':None})
    main.operations_store.run(legacy)
    def receipt(u):
        payroll._cash_change(u,'worker',time.time(),confirmed=1000)
        return payroll.company_cash_totals(u)
    value=main.operations_store.run(receipt)
    assert value['collected_paise']==2500 and value['confirmed_remittance_paise']==1000 and value['outstanding_held_paise']==1500
    baseline=main.operations_store.run(lambda u:u.get('bike_company_cash_totals','current'))
    assert baseline['confirmed_remittance_paise']==0, 'pre-sharding total remains an immutable baseline'


def test_independent_free_trip_reserves_funding_and_creates_one_payable_credit(api, setup_bike):
    vid=independent(api); q=quote(api,vid)
    assert q['pricing']['free'] and 'compensation_offer' not in q
    row,body=book(api,q)
    assert 'earnings_offer' not in row and 'earning_fund_reserved_paise' not in row
    assert latest(api,row,'worker2')['earnings_offer']['amount_paise']==1200
    assert main.operations_store.run(lambda u:earnings.fund(u))['reserved_paise']==1200
    row=finish(api,row)
    own=api.get(BASE+'/driver/earnings',headers=auth('worker2')).json()
    assert len(own['credits'])==1 and own['account']['payable_paise']==1200
    value=main.operations_store.run(lambda u:earnings.fund(u))
    assert value['reserved_paise']==0 and value['committed_paise']==1200
    main.operations_store.run(lambda u:earnings.sync_earning(u,u.get('bike_rides',row['id'])))
    assert api.get(BASE+'/driver/earnings',headers=auth('worker2')).json()['account']['earned_paise']==1200
    salary=api.get(BASE+'/driver/payroll',headers=auth('worker')).json()
    assert salary['monthly_salary_paise']==700000 and salary['obligations'][0]['status']=='owed'


def test_cancel_releases_free_funding_without_creating_earning_and_paid_fallback_is_reviewed(api, setup_bike):
    vid=independent(api)
    row,_=book(api,quote(api,vid)); row=command(api,row,'cancel','customer')
    assert main.operations_store.run(lambda u:earnings.available_fund(earnings.fund(u)))==1200
    assert api.get(BASE+'/driver/earnings',headers=auth('worker2')).json()['credits']==[]
    def exhaust_fixture_funds(u):
        for identifier in range(earnings.FUND_BUCKETS):
            value=earnings._fund_bucket(u, identifier)
            value['committed_paise']=value['funded_paise']
            u.put('bike_earnings_fund_buckets', str(identifier), value)
    main.operations_store.run(exhaust_fixture_funds)
    q=quote(api,vid)
    assert not q['pricing']['free'] and q['pricing']['customer_total_paise']==1550
    assert q['promotion']['reason']=='rider_offer_unavailable'


def test_competing_free_bookings_on_different_riders_cannot_overspend_last_reserve(api, setup_bike):
    a=independent(api); b=independent(api,'shop',funding=0)
    qa,qb=quote(api,a),quote(api,b,'stranger')
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda pair:book(api,pair[0],pair[1])[0],[(qa,'customer'),(qb,'stranger')]))
    assert sorted(row['state'] for row in results)==['offered','unavailable']
    assert all(row['pricing']['customer_total_paise']==0 for row in results)
    value=main.operations_store.run(lambda u:earnings.fund(u))
    assert value['reserved_paise']==1200 and earnings.available_fund(value)==0


def test_paid_earning_needs_company_cash_receipt_then_exact_nonduplicated_transfer(api, setup_bike):
    vid=independent(api)
    main.operations_store.run(lambda u:u.put('bike_policy','current',{**u.get('bike_policy','current'),'promo_enabled':False}))
    row,_=book(api,quote(api,vid)); row=finish(api,row)
    row=command(api,row,'cash_reported','customer');row=command(api,row,'cash_received','worker2')
    own=api.get(BASE+'/driver/earnings',headers=auth('worker2')).json();credit=own['credits'][0]
    assert credit['amount_paise']==1240 and credit['status']=='awaiting_remittance'
    transfer={'request_id':str(uuid.uuid4()),'driver_id':'worker2','credit_ids':[credit['id']],'amount_paise':1240,'reference':'FIXTURE-TRANSFER-001','evidence':'Fixture only bank payment evidence for selected earnings.'}
    assert api.post(BASE+'/earnings/transfers',headers=ADMIN,json=transfer).status_code==409
    cash=api.get(BASE+'/driver/remittances',headers=auth('worker2')).json()['company_cash']
    deposited=api.post(BASE+'/driver/remittances',headers=auth('worker2'),json={'expected_version':cash['version'],'request_id':str(uuid.uuid4()),'ride_ids':[row['id']],'amount_paise':1550,'deposit_reference':'FIXTURE-DEPOSIT-001','evidence':'Fixture only full customer collection deposited.'})
    assert deposited.status_code==201,deposited.text
    receipt=api.post(BASE+'/payroll/remittances/'+deposited.json()['id']+'/confirm',headers=ADMIN,json={'expected_version':deposited.json()['version'],'received':True,'receipt_reference':'FIXTURE-CASH-RECEIPT','evidence':'Fixture only exact company cash receipt evidence.'})
    assert receipt.status_code==200,receipt.text
    assert api.get(BASE+'/driver/earnings',headers=auth('worker2')).json()['account']['payable_paise']==1240
    other={**transfer,'request_id':str(uuid.uuid4()),'reference':'FIXTURE-TRANSFER-002'}
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses=list(pool.map(lambda body:api.post(BASE+'/earnings/transfers',headers=ADMIN,json=body),[transfer,other]))
    assert sorted(r.status_code for r in responses)==[201,409]
    saved=next(r.json() for r in responses if r.status_code==201)
    assert api.post(BASE+'/driver/earnings/transfers/'+saved['id']+'/receipt',headers=auth('customer'),json={'expected_version':saved['version'],'received':True}).status_code==404
    for _ in range(2):
        assert api.post(BASE+'/driver/earnings/transfers/'+saved['id']+'/receipt',headers=auth('worker2'),json={'expected_version':saved['version'],'received':True}).status_code==200
    own=api.get(BASE+'/driver/earnings',headers=auth('worker2')).json()
    assert own['account']['received_paise']==1240 and own['account']['transfer_reported_paise']==0
    assert api.get(BASE+'/driver/payroll',headers=auth('worker2')).json()['rostered'] is False


def test_accepted_ride_survives_policy_pause_and_pause_does_not_reset_terms_version(api, setup_bike):
    vid=independent(api)
    row,_=book(api,quote(api,vid)); row=command(api,row,'accept','worker2')
    p=api.get(BASE+'/earnings/admin',headers=ADMIN).json()['policy']
    body={key:value for key,value in p.items() if key not in ('version','terms_version')}
    body.update(expected_version=p['version'],enabled=False)
    paused=api.put(BASE+'/earnings/policy',headers=ADMIN,json=body)
    assert paused.status_code==200 and paused.json()['terms_version']==p['terms_version']
    row=command(api,row,'depart','worker2',position=gps())
    row=command(api,row,'start','worker2',otp=latest(api,row)['otp'],position=gps())
    assert row['state']=='in_progress'
