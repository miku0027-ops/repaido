"""HTTP authorization, concurrent budgets and real native statement projections."""
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import main
import business_accounts as business
from test_operations import api, auth


def create(api, uid='customer', **changes):
    body = dict(name='Test apartment association', kind='apartment', request_id=str(uuid.uuid4()))
    body.update(changes)
    r = api.post('/operations/business-accounts', headers=auth(uid), json=body)
    assert r.status_code == 201, r.text
    return r.json(), body


def endpoint(aid, suffix=''):
    return '/operations/business-accounts/' + aid + suffix


def invite(api, aid, uid, role='staff'):
    r = api.post(endpoint(aid, '/invitations'), headers=auth('customer'), json={'role': role})
    assert r.status_code == 201, r.text
    token = r.json()
    r = api.post('/operations/business-accounts/invitations/accept', headers=auth(uid), json={'token': token['token']})
    assert r.status_code == 200, r.text
    return token


def setup(api, budget=100000):
    d, _ = create(api)
    aid = d['account']['id']
    invite(api, aid, 'worker')
    invite(api, aid, 'worker2', 'manager')
    body = dict(name='North building', address='A real service address at the north building', city='Balasore', monthly_budget_paise=budget)
    r = api.post(endpoint(aid, '/properties'), headers=auth('customer'), json=body)
    assert r.status_code == 201, r.text
    return aid, r.json()


def request(api, aid, prop, uid='worker', **changes):
    body = dict(request_id=str(uuid.uuid4()), property_id=prop['id'], title='Repair entrance light', description='Repair the entrance light and inspect its fittings.', category='repair', estimated_paise=40000, needed_on=(business.today() + timedelta(days=1)).isoformat())
    body.update(changes)
    r = api.post(endpoint(aid, '/requests'), headers=auth(uid), json=body)
    assert r.status_code == 201, r.text
    return r.json(), body


def decide(api, aid, row, action='approve', uid='customer', status=200):
    r = api.post(endpoint(aid, '/requests/' + row['id'] + '/decision'), headers=auth(uid), json=dict(expected_version=row['version'], action=action, reason='Reviewed property maintenance allowance.'))
    assert r.status_code == status, r.text
    return r.json()


def link(api, aid, row, kind='job', key='native-job', uid='worker', status=200):
    r = api.post(endpoint(aid, '/requests/' + row['id'] + '/link'), headers=auth(uid), json=dict(expected_version=row['version'], kind=kind, id=key))
    assert r.status_code == status, r.text
    return r.json()


def get(api, aid, uid='customer'):
    r = api.get(endpoint(aid), headers=auth(uid))
    assert r.status_code == 200, r.text
    return r.json()


def test_account_retry_privacy_and_member_roles(api):
    d, body = create(api)
    aid = d['account']['id']
    assert api.post('/operations/business-accounts', headers=auth('customer'), json=body).json()['account']['id'] == aid
    assert api.post('/operations/business-accounts', headers=auth('customer'), json={**body, 'name': 'Changed name'}).status_code == 409
    assert api.get(endpoint(aid), headers=auth('stranger')).status_code == 404
    assert api.get('/operations/business-accounts', headers=auth('stranger')).json()['accounts'] == []
    invite(api, aid, 'worker', 'viewer')
    assert get(api, aid, 'worker')['role'] == 'viewer'
    assert not get(api, aid, 'worker')['invitations']
    assert api.post(endpoint(aid, '/invitations'), headers=auth('worker'), json={'role': 'manager'}).status_code == 403
    assert api.post(endpoint(aid, '/properties'), headers=auth('worker'), json=dict(name='Site', address='Address for a building', city='Balasore', monthly_budget_paise=10)).status_code == 403
    owner = next(m for m in get(api, aid)['members'] if m['role'] == 'owner')
    assert api.put(endpoint(aid, '/members/customer'), headers=auth('customer'), json=dict(role='staff', status='revoked', expected_version=owner['version'])).status_code == 409
    member = next(m for m in get(api, aid)['members'] if m['user_id'] == 'worker')
    body = dict(role='staff', status='revoked', expected_version=member['version'])
    assert api.put(endpoint(aid, '/members/worker'), headers=auth('customer'), json=body).status_code == 200
    assert api.put(endpoint(aid, '/members/worker'), headers=auth('customer'), json=body).status_code == 409
    assert api.get(endpoint(aid), headers=auth('worker')).status_code == 404
    assert api.get('/operations/business-accounts', headers=auth('worker')).json()['accounts'] == []


def test_invites_hash_only_single_use_revoke_and_expiry(api, monkeypatch):
    d, _ = create(api)
    aid = d['account']['id']
    token = invite(api, aid, 'worker')
    stored = main.operations_store.run(lambda u: u.get(business.lane('invitations', aid), token['id']))
    assert token['token'] not in str(stored) and 'token_hash' in stored
    assert 'token_hash' not in str(get(api, aid))
    same = api.post('/operations/business-accounts/invitations/accept', headers=auth('worker'), json={'token': token['token']})
    assert same.status_code == 200
    assert api.post('/operations/business-accounts/invitations/accept', headers=auth('stranger'), json={'token': token['token']}).status_code == 404
    revoked = api.post(endpoint(aid, '/invitations'), headers=auth('customer'), json={'role': 'staff'}).json()
    assert api.post(endpoint(aid, '/invitations/' + revoked['id'] + '/revoke'), headers=auth('customer')).status_code == 200
    assert api.post('/operations/business-accounts/invitations/accept', headers=auth('stranger'), json={'token': revoked['token']}).status_code == 404
    expiring = api.post(endpoint(aid, '/invitations'), headers=auth('customer'), json={'role': 'manager'}).json()
    monkeypatch.setattr(business.time, 'time', lambda: expiring['expires_at'] + 1)
    assert api.post('/operations/business-accounts/invitations/accept', headers=auth('stranger'), json={'token': expiring['token']}).status_code == 404


def test_spend_requires_independent_approval_and_transactional_monthly_budget(api):
    aid, prop = setup(api, budget=60000)
    row, body = request(api, aid, prop)
    assert api.post(endpoint(aid, '/requests'), headers=auth('worker'), json=body).json()['id'] == row['id']
    assert api.post(endpoint(aid, '/requests'), headers=auth('worker'), json={**body, 'estimated_paise': 1}).status_code == 409
    own, _ = request(api, aid, prop, uid='customer', estimated_paise=30000)
    decide(api, aid, own, uid='customer', status=403)
    decide(api, aid, row, uid='worker', status=403)
    other, _ = request(api, aid, prop)
    def approve(r):
        return api.post(endpoint(aid, '/requests/' + r['id'] + '/decision'), headers=auth('customer'), json=dict(expected_version=1, action='approve', reason='Independently checked allowance.'))
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(approve, [row, other]))
    assert sorted(r.status_code for r in results) == [200, 409]
    d = get(api, aid)
    assert d['summary']['approved_estimate_paise'] == 40000
    assert d['statement']['total_paid_paise'] == 0 and d['statement']['rows'] == []
    approved = next(r for r in d['requests'] if r['status'] == 'approved')
    decide(api, aid, approved, action='cancel', uid='customer', status=403)
    cancelled = decide(api, aid, approved, action='cancel', uid='worker')
    assert cancelled['status'] == 'cancelled'
    own = decide(api, aid, own, uid='worker2')
    assert own['status'] == 'approved'


def test_properties_cannot_cross_accounts_or_reduce_committed_allowance(api):
    aid, prop = setup(api)
    row, _ = request(api, aid, prop)
    decide(api, aid, row)
    body = {k: prop[k] for k in ('name', 'address', 'city', 'monthly_budget_paise')}
    body.update(expected_version=prop['version'], archived=False, monthly_budget_paise=1)
    assert api.put(endpoint(aid, '/properties/' + prop['id']), headers=auth('customer'), json=body).status_code == 409
    other, _ = create(api)
    assert api.put(endpoint(other['account']['id'], '/properties/' + prop['id']), headers=auth('customer'), json=body).status_code == 404
    invite(api, aid, 'stranger', 'viewer')
    bad = dict(request_id=str(uuid.uuid4()), property_id=prop['id'], title='Need repair', description='Review property work request.', category='repair', estimated_paise=100, needed_on=business.today().isoformat())
    assert api.post(endpoint(aid, '/requests'), headers=auth('stranger'), json=bad).status_code == 403
    assert api.post(endpoint(aid, '/requests'), headers=auth('worker'), json={**bad, 'needed_on': '2026-02-31'}).status_code == 422
    assert api.post(endpoint(aid, '/requests'), headers=auth('worker'), json={**bad, 'estimated_paise': True}).status_code == 422
    assert api.post(endpoint(aid, '/requests'), headers=auth('worker'), json={**bad, 'title': '     '}).status_code == 422
    assert business.digest('a:b', 'c') != business.digest('a', 'b:c')


def test_linking_requires_requester_native_ownership_kind_quote_and_unique_record(api):
    aid, prop = setup(api)
    row, _ = request(api, aid, prop)
    job = dict(id='native-job', customer_id='worker', service_name='Entrance repair', state='accepted', total_paise=35000, payment_status='pay_after_service', address='Not exposed by workspace linking', phone='9999999999')
    main.operations_store.run(lambda u: u.put('jobs', job['id'], job))
    link(api, aid, row, status=409)
    row = decide(api, aid, row)
    link(api, aid, row, uid='customer', status=403)
    link(api, aid, row, key='missing', status=404)
    link(api, aid, row, kind='retail', status=422)
    main.operations_store.run(lambda u: u.put('jobs', job['id'], {**job, 'customer_id': 'stranger'}))
    link(api, aid, row, status=404)
    main.operations_store.run(lambda u: u.put('jobs', job['id'], {**job, 'total_paise': 50000}))
    link(api, aid, row, status=409)
    main.operations_store.run(lambda u: u.put('jobs', job['id'], job))
    linked = link(api, aid, row)
    assert linked['record']['id'] == job['id']
    assert main.operations_store.run(lambda u: u.get('jobs', job['id'])) == job
    assert 'Not exposed' not in str(get(api, aid)) and '9999999999' not in str(get(api, aid))
    again, _ = request(api, aid, prop)
    again = decide(api, aid, again)
    link(api, aid, again, status=409)
    decide(api, aid, linked, action='cancel', uid='worker', status=409)
    assert api.get(endpoint(aid, '/linkable'), headers=auth('worker')).json()['records'] == []


def test_statement_tracks_native_issued_paid_refunded_and_variance(api):
    aid, prop = setup(api)
    row, _ = request(api, aid, prop)
    row = decide(api, aid, row)
    job = dict(id='native-job', customer_id='worker', service_name='=Unsafe spreadsheet formula', state='accepted', total_paise=35000, payment_status='pay_after_service')
    main.operations_store.run(lambda u: u.put('jobs', job['id'], job))
    link(api, aid, row)
    assert not get(api, aid)['statement']['rows']
    job.update(state='completed', completed_at=time.time(), invoice=dict(id=job['id'], total_paise=35000, status='payment_due'))
    main.operations_store.run(lambda u: u.put('jobs', job['id'], job))
    s = get(api, aid)['statement']
    assert s['total_issued_paise'] == s['outstanding_paise'] == 35000 and s['total_paid_paise'] == 0
    assert s['estimate_paise'] == 5000
    job.update(payment_status='verified')
    job['invoice']['status'] = 'paid'
    def paid(u):
        u.put('jobs', job['id'], job)
        u.put('payments', job['id'], dict(id=job['id'], job_id=job['id'], amount_paise=35000, payment_id='pay_real_native_test', status='captured'))
    main.operations_store.run(paid)
    assert get(api, aid)['statement']['total_paid_paise'] == 35000
    job['invoice']['total_paise'] = 45000
    main.operations_store.run(lambda u: u.put('jobs', job['id'], job))
    assert get(api, aid)['statement']['rows'][0]['exceeds_approval']
    job['invoice']['total_paise'] = 35000
    job.update(payment_status='partially_refunded')
    job['invoice']['status'] = 'partially_refunded'
    def refund(u):
        u.put('jobs', job['id'], job)
        u.put('payments', job['id'], dict(id=job['id'], job_id=job['id'], amount_paise=35000, amount_refunded=10000, payment_id='pay_real_native_test', status='partially_refunded'))
    main.operations_store.run(refund)
    s = get(api, aid)['statement']
    assert s['total_paid_paise'] == 25000 and s['refunded_paise'] == 10000 and s['outstanding_paise'] == 0
    export = api.get(endpoint(aid, '/statement.csv'), headers=auth('customer'))
    assert export.status_code == 200 and "'=Unsafe" in export.text
    assert api.get(endpoint(aid, '/statement.csv'), headers=auth('stranger')).status_code == 404


def test_contract_receipts_exclude_reports_and_retail_pending_orders(api):
    aid, prop = setup(api, budget=1000000)
    contract, _ = request(api, aid, prop, category='contract', estimated_paise=300000)
    contract = decide(api, aid, contract)
    retail, _ = request(api, aid, prop, category='retail', estimated_paise=40000)
    retail = decide(api, aid, retail)
    def seed(u):
        u.put('contract_projects', 'native-contract', dict(id='native-contract', owner_id='shop', client_id='worker', title='Roof repairs', status='active', contract_value_paise=250000))
        u.put('contract_payments', 'unverified', dict(id='unverified', project_id='native-contract', amount_paise=100000, status='transfer_reported', created_at=time.time()))
        u.put('contract_payments', 'confirmed', dict(id='confirmed', project_id='native-contract', amount_paise=50000, confirmed_amount_paise=50000, status='confirmed', source='operator_verified_external_transfer', created_at=time.time(), confirmed_at=time.time()))
        u.put('retail_orders', 'native-retail', dict(id='native-retail', customer_id='worker', state='payment_pending', total_paise=35000))
    main.operations_store.run(seed)
    link(api, aid, contract, kind='contract', key='native-contract')
    link(api, aid, retail, kind='retail', key='native-retail')
    s = get(api, aid)['statement']
    assert len(s['rows']) == 1 and s['total_paid_paise'] == 50000 and s['outstanding_paise'] == 0
    assert s['rows'][0]['source'] == 'operator_verified_external_transfer'
    main.operations_store.run(lambda u: u.put('retail_orders', 'native-retail', dict(id='native-retail', customer_id='worker', state='paid', total_paise=35000, payment_id='pay_verified_test', paid_at=time.time())))
    assert get(api, aid)['statement']['total_paid_paise'] == 85000
    main.operations_store.run(lambda u: u.put('retail_orders', 'native-retail', dict(id='native-retail', customer_id='worker', state='paid', total_paise=35000, payment_id='pay_verified_test', paid_at=time.time(), amount_refunded=5000)))
    s = get(api, aid)['statement']
    assert s['total_paid_paise'] == 80000 and s['refunded_paise'] == 5000
    main.operations_store.run(lambda u: u.put('retail_orders', 'native-retail', dict(id='native-retail', customer_id='worker', state='refunded', total_paise=35000, payment_id='pay_verified_test', paid_at=time.time(), amount_refunded=35000)))
    s = get(api, aid)['statement']
    assert len(s['rows']) == 2 and s['total_paid_paise'] == 50000 and s['refunded_paise'] == 35000
    # Contractor receipts are income for the contractor, never their procurement spend.
    assert api.get(endpoint(aid, '/linkable'), headers=auth('customer')).json()['records'] == []


def test_home_monthly_statement_does_not_duplicate_individual_visits(api):
    aid, prop = setup(api, budget=500000)
    row, _ = request(api, aid, prop, category='home', estimated_paise=118000)
    row = decide(api, aid, row)
    yesterday = (business.today() - timedelta(days=1)).isoformat()
    def seed(u):
        u.put('home_plans', 'native-home', dict(id='native-home', customer_id='worker', state='active', service_id='maid', quote=dict(period_price_paise=100000, gst_bps=1800), periods=[dict(index=0, start=yesterday, end=yesterday)], visits=[dict(id='visit', date=yesterday, period=0, status='scheduled', job_id='home-visit')]))
        u.put('jobs', 'home-visit', dict(id='home-visit', customer_id='worker', home_plan_id='native-home', state='completed', total_paise=118000, base_price_paise=100000, home_gst_paise=18000, payment_status='monthly_invoice', invoice=dict(id='home-visit', total_paise=118000, status='payment_due')))
    main.operations_store.run(seed)
    available = api.get(endpoint(aid, '/linkable'), headers=auth('worker')).json()['records']
    assert [r['kind'] for r in available] == ['home_plan']
    link(api, aid, row, kind='home_plan', key='native-home')
    s = get(api, aid)['statement']
    assert len(s['rows']) == 1 and s['total_issued_paise'] == 118000 and s['total_paid_paise'] == 0
    main.operations_store.run(lambda u: u.put('payments', 'home-native-home:0', dict(id='home-native-home:0', status='captured', amount_paise=118000, payment_id='pay_home_verified_test')))
    assert get(api, aid)['statement']['total_paid_paise'] == 118000


def test_maintenance_permissions_recurrence_anchor_and_duplicate_completion(api):
    aid, prop = setup(api)
    assert api.post(endpoint(aid, '/maintenance'), headers=auth('customer'), json=dict(property_id=prop['id'], title='Invalid future recurrence', due_on='9999-12-31', repeat_months=1)).status_code == 422
    r = api.post(endpoint(aid, '/maintenance'), headers=auth('customer'), json=dict(property_id=prop['id'], title='Inspect fire exit lighting', due_on='2028-01-31', repeat_months=1, assigned_to='worker'))
    assert r.status_code == 201, r.text
    task = r.json()
    invite(api, aid, 'stranger')
    body = dict(expected_version=task['version'], note='Inspected lighting and recorded the result.')
    url = endpoint(aid, '/maintenance/' + task['id'] + '/complete')
    assert api.post(url, headers=auth('stranger'), json=body).status_code == 403
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: api.post(url, headers=auth('worker'), json=body), range(2)))
    assert sorted(r.status_code for r in results) == [200, 409]
    tasks = get(api, aid)['maintenance']
    assert len(tasks) == 2
    upcoming = next(r for r in tasks if r['status'] == 'open')
    assert upcoming['due_on'] == '2028-02-29'
    assert api.post(endpoint(aid, '/maintenance/' + upcoming['id'] + '/complete'), headers=auth('worker'), json=body).status_code == 200
    assert next(r for r in get(api, aid)['maintenance'] if r['status'] == 'open')['due_on'] == '2028-03-31'
    upcoming = next(r for r in get(api, aid)['maintenance'] if r['status'] == 'open')
    url = endpoint(aid, '/maintenance/' + upcoming['id'] + '/cancel')
    assert api.post(url, headers=auth('worker'), json=body).status_code == 403
    assert api.post(url, headers=auth('customer'), json=body).status_code == 200
    assert not [r for r in get(api, aid)['maintenance'] if r['status'] == 'open']
    update = {k: prop[k] for k in ('name', 'address', 'city', 'monthly_budget_paise')}
    update.update(expected_version=prop['version'], archived=True)
    assert api.put(endpoint(aid, '/properties/' + prop['id']), headers=auth('customer'), json=update).status_code == 200
    assert not main.operations_store.run(lambda u: u.all('jobs'))


def test_revocation_blocks_native_links_and_request_actions_immediately(api):
    aid, prop = setup(api)
    row, _ = request(api, aid, prop)
    row = decide(api, aid, row)
    member = next(m for m in get(api, aid)['members'] if m['user_id'] == 'worker')
    r = api.put(endpoint(aid, '/members/worker'), headers=auth('customer'), json=dict(expected_version=member['version'], role='staff', status='revoked'))
    assert r.status_code == 200
    link(api, aid, row, status=404)
    decide(api, aid, row, action='cancel', uid='worker', status=404)
    assert api.get(endpoint(aid, '/linkable'), headers=auth('worker')).status_code == 404


def test_allocated_parts_advances_reduce_balance_and_refunds_reduce_net_paid(api):
    aid, prop = setup(api)
    row, _ = request(api, aid, prop)
    row = decide(api, aid, row)
    job = dict(id='native-job', customer_id='worker', service_name='Entrance repair', state='in_progress', total_paise=40000, payment_status='pay_after_service')
    advance = dict(id='parts-record', job_id=job['id'], kind='parts', allocated=True, amount_paise=10000, payment_id='pay_parts_verified', status='captured')
    def seed(u):
        u.put('jobs', job['id'], job)
        u.put('payments', advance['id'], advance)
    main.operations_store.run(seed)
    link(api, aid, row)
    s = get(api, aid)['statement']
    assert s['total_paid_paise'] == 10000 and s['rows'][0]['document_type'] == 'payment_receipt'
    job.update(state='completed', invoice=dict(id=job['id'], total_paise=40000, status='payment_due'))
    main.operations_store.run(lambda u: u.put('jobs', job['id'], job))
    s = get(api, aid)['statement']
    assert len(s['rows']) == 1 and s['total_issued_paise'] == 40000 and s['total_paid_paise'] == 10000 and s['outstanding_paise'] == 30000
    job.update(payment_status='verified', financial_hold=True)
    job['invoice']['status'] = 'paid'
    advance.update(status='partially_refunded', amount_refunded=5000)
    def refund(u):
        seed(u)
        u.put('payments', job['id'], dict(id=job['id'], job_id=job['id'], amount_paise=30000, payment_id='pay_final_verified', status='captured'))
    main.operations_store.run(refund)
    s = get(api, aid)['statement']
    assert s['total_paid_paise'] == 35000 and s['refunded_paise'] == 5000 and s['outstanding_paise'] == 0 and s['rows'][0]['status'] == 'review'
    job['invoice'] = {'status': 'refund_review'}
    main.operations_store.run(lambda u: u.put('jobs', job['id'], job))
    s = get(api, aid)['statement']
    assert s['unavailable_request_ids'] == [row['id']] and s['rows'] == []


def test_home_monthly_totals_fold_parts_receipt_without_double_count(api):
    aid, prop = setup(api, budget=500000)
    row, _ = request(api, aid, prop, category='home', estimated_paise=118000)
    row = decide(api, aid, row)
    yesterday = (business.today() - timedelta(days=1)).isoformat()
    advance = dict(id='home-parts', job_id='home-visit', kind='parts', allocated=True, amount_paise=20000, payment_id='pay_home_parts', status='captured')
    def seed(u):
        u.put('home_plans', 'native-home', dict(id='native-home', customer_id='worker', state='active', service_id='maid', quote=dict(period_price_paise=100000, gst_bps=1800), periods=[dict(index=0, start=yesterday, end=yesterday)], visits=[dict(id='visit', date=yesterday, period=0, status='scheduled', job_id='home-visit')]))
        u.put('jobs', 'home-visit', dict(id='home-visit', customer_id='worker', home_plan_id='native-home', state='completed', total_paise=118000, base_price_paise=100000, home_gst_paise=18000, payment_status='monthly_invoice'))
        u.put('payments', advance['id'], advance)
    main.operations_store.run(seed)
    link(api, aid, row, kind='home_plan', key='native-home')
    s = get(api, aid)['statement']
    assert len(s['rows']) == 1 and s['total_issued_paise'] == 118000 and s['total_paid_paise'] == 20000 and s['outstanding_paise'] == 98000
    main.operations_store.run(lambda u: u.put('payments', 'home-native-home:0', dict(id='home-native-home:0', status='captured', amount_paise=98000, payment_id='pay_home_monthly')))
    assert get(api, aid)['statement']['total_paid_paise'] == 118000
    def refund(u):
        u.put('payments', advance['id'], {**advance, 'amount_refunded': 5000, 'status': 'partially_refunded'})
        job = u.get('jobs', 'home-visit'); job['financial_hold'] = True; u.put('jobs', job['id'], job)
    main.operations_store.run(refund)
    s = get(api, aid)['statement']
    assert s['total_issued_paise'] == 118000 and s['total_paid_paise'] == 113000 and s['refunded_paise'] == 5000 and s['outstanding_paise'] == 0
