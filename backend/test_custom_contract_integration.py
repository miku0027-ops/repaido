"""Cross-module award, financial ceiling and customer privacy regressions.

All people, provider responses, photos and payments are isolated test records.
The award goes through the real canonical tender command before finance starts.
"""
import copy
import io
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from PIL import Image

import contract_records as records
import custom_contracts as custom
import integrations
import main
from test_operations import api, auth, ADMIN, PIN
from test_contract_work import seed, project, invite, cmd
from test_worker_network import get, put
from test_worker_network import notice, apply, decision


@pytest.fixture
def finance_api(api, monkeypatch, tmp_path):
    assert main.contract_records is records
    monkeypatch.delenv('REPAIDO_COMMUNITY_BUCKET', raising=False)
    monkeypatch.delenv('REPAIDO_KYC_BUCKET', raising=False)
    monkeypatch.setenv('REPAIDO_COMMUNITY_MEDIA_DIR', str(tmp_path / 'private-contract-media'))
    monkeypatch.setattr(records, 'payments_ready', lambda: True)
    monkeypatch.setattr(records, 'configured', lambda *names: True)
    orders, payments, calls = {}, {}, []
    def provider(path, body=None, **kwargs):
        calls.append(path)
        if path == 'orders':
            key = 'order_Contract' + str(len(orders) + 1)
            row = dict(id=key, **copy.deepcopy(body)); orders[key] = row
            return copy.deepcopy(row)
        if path.startswith('orders?receipt='):
            return {'items': [copy.deepcopy(row) for row in orders.values() if row['receipt'] == path.split('=', 1)[1]]}
        if path.startswith('payments/'):
            return copy.deepcopy(payments[path.split('/')[1]])
        raise AssertionError('Unexpected external request: ' + path)
    monkeypatch.setattr(records, 'razorpay', provider)
    api.contract_gateway = dict(orders=orders, payments=payments, calls=calls)
    return api


@pytest.fixture
def custom_api(finance_api):
    assert main.custom_contracts is custom
    seed(finance_api)
    put('workers', 'worker2', {**get('workers', 'worker2'), 'contractor_verified': True})
    for uid in ('worker', 'worker2', 'shop'):
        assert finance_api.get('/repaidians/state', headers=auth(uid)).status_code == 200
    return finance_api


def custom_query(api):
    now = time.time()
    body = dict(request_id=str(uuid.uuid4()), title='PRIVATE customer campus cooling project', sector='Education',
        work_trade='ac', city='Balasore', area='Customer-selected neighbourhood', site='PRIVATE exact customer entrance',
        location=PIN, scope='PRIVATE Detailed campus cooling installation and inspection requirements.', skills=['AC service'],
        minimum_experience=2, workforce_requirements=[{'worker_type': 'ac_installer', 'count': 2}],
        starts_at=now + 86400, ends_at=now + 7 * 86400, deadline=now + 3600, budget_paise=900000,
        terms='Provide the complete agreed installation with site safety and inspected milestones.')
    response = api.post('/operations/custom-contracts/queries', headers=auth('shop'), json=body)
    assert response.status_code == 201, response.text
    return response.json()['query']


def custom_bid(api, q, uid='worker', amount=800000):
    response = api.post('/operations/custom-contracts/queries/' + q['id'] + '/bids', headers=auth(uid),
        json=dict(request_id=str(uuid.uuid4()), expected_version=q['version'], amount_paise=amount,
            proposal='Deliver the agreed cooling work with safety inspections and a recorded team.', accepted_terms=True))
    assert response.status_code == 200, response.text
    return response.json()['query']


def custom_award(api, q, bid_id, request_id=None):
    return api.post('/operations/custom-contracts/queries/' + q['id'] + '/commands', headers=auth('shop'),
        json=dict(request_id=request_id or str(uuid.uuid4()), expected_version=q['version'], action='award', bid_id=bid_id))


def awarded_project(api, monkeypatch, amount=900000):
    seed(api)
    assert api.get('/repaidians/state', headers=auth('worker')).status_code == 200
    now = time.time()
    body = dict(request_id=str(uuid.uuid4()), title='Private awarded electrical contract',
        scope='PRIVATE Awarded wiring inspection and installation scope', site='PRIVATE Customer exact work site',
        starts_at=now + 1000, ends_at=now + 5000, budget_paise=1000000, sector='Electrical', city='Balasore',
        opens_at=now - 100, deadline=now + 500, manpower_needed=1,
        terms='Perform the agreed scope with safety equipment and independently inspected milestones.')
    response = api.post('/operations/contractor/tenders', headers=auth('shop'), json=body)
    assert response.status_code == 200, response.text
    tender = response.json()
    p, _ = project(api, tender_id=tender['id'], starts_at=body['starts_at'], ends_at=body['ends_at'])
    p = invite(api, p)
    p = cmd(api, p, 'accept', uid='worker2', target_id=p['team'][0]['id']).json()
    response = api.post('/operations/contractor/tenders/' + tender['id'] + '/bid', headers=auth('worker'), json=dict(
        request_id=str(uuid.uuid4()), expected_version=tender['version'], project_id=p['id'], amount_paise=amount,
        proposal='Detailed proposal for safe inspection and complete installation.', accepted_terms=True))
    assert response.status_code == 200, response.text
    tender = response.json()
    monkeypatch.setattr(time, 'time', lambda: now + 600)
    response = api.post('/operations/contractor/tenders/' + tender['id'] + '/commands', headers=auth('shop'),
        json=dict(expected_version=tender['version'], action='award', bid_id=tender['bids'][0]['id']))
    assert response.status_code == 200, response.text
    return get('contract_projects', p['id'])


def record_state(api, p, uid='shop'):
    response = api.get('/operations/contracts/projects/' + p['id'] + '/records', headers=auth(uid))
    assert response.status_code == 200, response.text
    return response.json()


def payment_request(api, p, amount, uid='worker', method='gateway', body=None):
    body = body or dict(request_id=str(uuid.uuid4()), expected_version=record_state(api, p, uid)['version'],
                        amount_paise=amount, method=method)
    return api.post('/operations/contracts/projects/' + p['id'] + '/payments', headers=auth(uid), json=body), body


def approve_payment(api, p, row, approved=True):
    response = api.post('/operations/contracts/projects/' + p['id'] + '/payments/' + row['id'] + '/approve',
        headers=auth('shop'), json=dict(request_id=str(uuid.uuid4()), expected_version=record_state(api, p)['version'], approved=approved))
    assert response.status_code == 200, response.text
    return response.json()


def capture_payment(api, p, row, payment_id='pay_Contract1'):
    response = api.post('/operations/contracts/projects/' + p['id'] + '/payments/' + row['id'] + '/order', headers=auth('shop'))
    assert response.status_code == 200, response.text
    order = response.json()
    api.contract_gateway['payments'][payment_id] = dict(id=payment_id, order_id=order['order_id'],
        amount=row['amount_paise'], currency='INR', captured=True, status='captured', amount_refunded=0)
    response = api.post('/operations/contracts/projects/' + p['id'] + '/payments/' + row['id'] + '/check',
                        headers=auth('shop'), json={'payment_id': payment_id})
    assert response.status_code == 200, response.text
    return response.json()


def test_canonical_award_finance_records_are_not_available_to_team_or_other_customer(finance_api, monkeypatch):
    p = awarded_project(finance_api, monkeypatch)
    public = record_state(finance_api, p)
    assert public['project']['customer_id'] == 'shop' and public['project']['contractor_id'] == 'worker'
    assert public['financials']['agreed_deal_paise'] == p['contract_value_paise'] == 900000
    for uid in ('worker2', 'customer', 'stranger'):
        for suffix in ('records', 'report.pdf', 'bank-instructions'):
            response = finance_api.get('/operations/contracts/projects/' + p['id'] + '/' + suffix, headers=auth(uid))
            assert response.status_code == 404, (uid, suffix, response.text)
            assert 'PRIVATE' not in response.text
    assert finance_api.get('/operations/contracts/projects/' + p['id'] + '/report.pdf').status_code == 401
    for uid in ('shop', 'worker'):
        pdf = finance_api.get('/operations/contracts/projects/' + p['id'] + '/report.pdf', headers=auth(uid))
        assert pdf.status_code == 200 and pdf.content.startswith(b'%PDF')
        assert 'no-store' in pdf.headers['cache-control']


def test_parallel_payment_requests_and_pending_reservations_never_exceed_deal(finance_api, monkeypatch):
    p = awarded_project(finance_api, monkeypatch)
    version = record_state(finance_api, p)['version']
    bodies = [dict(request_id=str(uuid.uuid4()), expected_version=version, amount_paise=600000, method='gateway') for _ in range(2)]
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda body: payment_request(finance_api, p, 600000, body=body)[0], bodies))
    assert sorted(response.status_code for response in responses) == [200, 409]
    state = record_state(finance_api, p)
    assert state['financials']['pending_reserved_paise'] == 600000 and len(state['payments']) == 1
    denied, _ = payment_request(finance_api, p, 300001)
    assert denied.status_code == 409 and denied.json()['detail']['code'] == 'DEAL_CEILING'
    allowed, _ = payment_request(finance_api, p, 300000)
    assert allowed.status_code == 200
    assert record_state(finance_api, p)['financials']['available_to_request_paise'] == 0


@pytest.mark.parametrize('amount', [True, False, '100', 100.5, 0, -1])
def test_financial_requests_use_strict_positive_integer_paise(finance_api, monkeypatch, amount):
    p = awarded_project(finance_api, monkeypatch)
    response, _ = payment_request(finance_api, p, amount)
    assert response.status_code == 422
    assert record_state(finance_api, p)['payments'] == []
    assert finance_api.contract_gateway['calls'] == []


def test_retries_do_not_reserve_twice_and_rejection_releases_capacity(finance_api, monkeypatch):
    p = awarded_project(finance_api, monkeypatch)
    first, body = payment_request(finance_api, p, 900000)
    assert first.status_code == 200
    retried, _ = payment_request(finance_api, p, 900000, body=body)
    assert retried.status_code == 200 and len(retried.json()['payments']) == 1
    changed, _ = payment_request(finance_api, p, 899999, body={**body, 'amount_paise': 899999})
    assert changed.status_code == 409
    rejected = approve_payment(finance_api, p, first.json()['payments'][0], approved=False)
    assert rejected['financials']['pending_reserved_paise'] == 0
    second, _ = payment_request(finance_api, p, 900000)
    assert second.status_code == 200


def test_verified_capture_and_pending_request_share_one_ceiling_and_private_receipt(finance_api, monkeypatch):
    p = awarded_project(finance_api, monkeypatch)
    response, _ = payment_request(finance_api, p, 600000)
    row = response.json()['payments'][0]
    approve_payment(finance_api, p, row)
    state = capture_payment(finance_api, p, row)
    assert state['financials']['confirmed_paid_paise'] == state['financials']['gateway_collected_paise'] == 600000
    assert state['financials']['contractor_received_paise'] == state['financials']['pending_reserved_paise'] == 0
    row = state['payments'][0]
    report = finance_api.get('/operations/contracts/reports/' + row['report_id'] + '.pdf', headers=auth('shop'))
    assert report.status_code == 200 and report.content.startswith(b'%PDF') and 'no-store' in report.headers['cache-control']
    for uid in ('worker2', 'stranger', 'customer'):
        assert finance_api.get('/operations/contracts/reports/' + row['report_id'] + '.pdf', headers=auth(uid)).status_code == 404
    response = finance_api.post('/operations/contracts/projects/' + p['id'] + '/payments/' + row['id'] + '/check',
        headers=auth('shop'), json={'payment_id': row['payment_id']})
    assert response.status_code == 200 and response.json()['financials']['confirmed_paid_paise'] == 600000
    denied, _ = payment_request(finance_api, p, 300001)
    assert denied.status_code == 409
    allowed, _ = payment_request(finance_api, p, 300000)
    assert allowed.status_code == 200


@pytest.mark.parametrize('change', [
    {'currency': 'USD'}, {'amount': 1}, {'amount': True}, {'order_id': 'order_Other'},
    {'captured': False, 'status': 'authorized'}, {'captured': False, 'status': 'failed'},
])
def test_only_fetched_provider_capture_can_confirm_approved_customer_request(finance_api, monkeypatch, change):
    p = awarded_project(finance_api, monkeypatch)
    state, _ = payment_request(finance_api, p, 500000); row = state.json()['payments'][0]
    approve_payment(finance_api, p, row)
    response = finance_api.post('/operations/contracts/projects/' + p['id'] + '/payments/' + row['id'] + '/order', headers=auth('shop'))
    order = response.json()
    provider = dict(id='pay_ContractWrong', order_id=order['order_id'], amount=500000, currency='INR', captured=True, status='captured', amount_refunded=0)
    provider.update(change); finance_api.contract_gateway['payments'][provider['id']] = provider
    checked = finance_api.post('/operations/contracts/projects/' + p['id'] + '/payments/' + row['id'] + '/check',
        headers=auth('shop'), json={'payment_id': provider['id']})
    assert checked.status_code in (200, 409)
    latest = record_state(finance_api, p)
    assert latest['financials']['confirmed_paid_paise'] == 0 and latest['financials']['pending_reserved_paise'] == 500000
    for uid in ('worker', 'worker2', 'stranger'):
        before = len(finance_api.contract_gateway['calls'])
        denied = finance_api.post('/operations/contracts/projects/' + p['id'] + '/payments/' + row['id'] + '/check',
            headers=auth(uid), json={'payment_id': provider['id']})
        assert denied.status_code in (403, 404)
        assert len(finance_api.contract_gateway['calls']) == before
    forged = finance_api.post('/operations/contracts/projects/' + p['id'] + '/payments/' + row['id'] + '/check',
        headers=auth('shop'), json={'payment_id': provider['id'], 'status': 'captured', 'amount_paise': 500000})
    assert forged.status_code == 422


@pytest.mark.parametrize('change', ['tender_closed', 'wrong_winner', 'wrong_amount', 'wrong_customer'])
def test_later_canonical_award_mismatch_revokes_private_financial_routes(finance_api, monkeypatch, change):
    p = awarded_project(finance_api, monkeypatch)
    if change in ('tender_closed', 'wrong_winner'):
        tender = get('contract_tenders', p['tender_id'])
        tender['status' if change == 'tender_closed' else 'winning_project_id'] = 'closed' if change == 'tender_closed' else 'other'
        put('contract_tenders', tender['id'], tender)
    else:
        p['contract_value_paise' if change == 'wrong_amount' else 'client_id'] = 123 if change == 'wrong_amount' else 'stranger'
        put('contract_projects', p['id'], p)
    for suffix in ('records', 'report.pdf'):
        response = finance_api.get('/operations/contracts/projects/' + p['id'] + '/' + suffix, headers=auth('shop'))
        assert response.status_code == 409 and response.json()['detail']['code'] == 'AWARD_REQUIRED'
    assert finance_api.contract_gateway['calls'] == []


def test_private_photos_are_contract_scoped_and_not_visible_in_public_social_media(finance_api, monkeypatch):
    p = awarded_project(finance_api, monkeypatch)
    image = io.BytesIO(); Image.new('RGB', (20, 30), 'blue').save(image, format='JPEG')
    uploaded = finance_api.post('/operations/contracts/projects/' + p['id'] + '/attachments?purpose=progress',
        headers={**auth('worker'), 'Content-Type': 'image/jpeg'}, content=image.getvalue())
    assert uploaded.status_code == 200, uploaded.text
    attachment = uploaded.json()
    for uid in ('shop', 'worker'):
        photo = finance_api.get(attachment['url'].removeprefix('/api'), headers=auth(uid))
        assert photo.status_code == 200 and 'no-store' in photo.headers['cache-control']
    for uid in ('worker2', 'customer', 'stranger'):
        assert finance_api.get(attachment['url'].removeprefix('/api'), headers=auth(uid)).status_code == 404
    assert finance_api.get(attachment['url'].removeprefix('/api')).status_code == 401
    assert finance_api.get('/repaidians/media/' + attachment['id'], headers=auth('shop')).status_code == 404
    state = record_state(finance_api, p)
    assert finance_api.post('/operations/contracts/projects/' + p['id'] + '/progress', headers=auth('shop'),
        json=dict(request_id=str(uuid.uuid4()), expected_version=state['version'], percent=75,
                  note='Customer cannot report contractor progress', evidence_ids=[attachment['id']])).status_code == 403


def test_external_transfer_report_stays_pending_until_independent_operator_verification(finance_api, monkeypatch):
    p = awarded_project(finance_api, monkeypatch)
    response, _ = payment_request(finance_api, p, 200000, method='neft'); row = response.json()['payments'][0]
    approve_payment(finance_api, p, row)
    image = io.BytesIO(); Image.new('RGB', (20, 20), 'green').save(image, format='JPEG')
    uploaded = finance_api.post('/operations/contracts/projects/' + p['id'] + '/attachments?purpose=payment',
        headers={**auth('shop'), 'Content-Type': 'image/jpeg'}, content=image.getvalue()).json()
    report = finance_api.post('/operations/contracts/projects/' + p['id'] + '/payments/' + row['id'] + '/reported',
        headers=auth('shop'), json=dict(request_id=str(uuid.uuid4()), expected_version=record_state(finance_api, p)['version'],
            reference='UTR-REAL-1234', evidence_ids=[uploaded['id']]))
    assert report.status_code == 200
    assert report.json()['financials']['confirmed_paid_paise'] == report.json()['financials']['contractor_received_paise'] == 0
    body = dict(approved=True, reason='Independently checked the bank transaction against the original reference.',
        verified_reference='UTR-REAL-1234', evidence_reference='manual-bank-reference-test')
    path = '/operations/contracts/admin/payments/' + row['id'] + '/verify-external'
    assert finance_api.post(path, headers=auth('shop'), json=body).status_code == 403
    verified = finance_api.post(path, headers=ADMIN, json=body)
    assert verified.status_code == 200, verified.text
    state = record_state(finance_api, p)
    assert state['financials']['confirmed_paid_paise'] == state['financials']['contractor_received_paise'] == 200000
    assert state['financials']['gateway_collected_paise'] == state['financials']['pending_reserved_paise'] == 0
    assert finance_api.post(path, headers=ADMIN, json=body).status_code == 200
    assert record_state(finance_api, p)['financials']['confirmed_paid_paise'] == 200000


def test_shared_gateway_dispatch_reconciles_contract_before_any_legacy_payment_scan(finance_api, monkeypatch):
    p = awarded_project(finance_api, monkeypatch)
    response, _ = payment_request(finance_api, p, 500000); row = response.json()['payments'][0]
    approve_payment(finance_api, p, row)
    order = finance_api.post('/operations/contracts/projects/' + p['id'] + '/payments/' + row['id'] + '/order', headers=auth('shop')).json()
    payment = dict(id='pay_DispatchedContract', order_id=order['order_id'], currency='INR', amount=500000,
                   status='captured', captured=True, amount_refunded=0)
    from operations import Unit
    monkeypatch.setattr(Unit, 'all', lambda *args: (_ for _ in ()).throw(AssertionError('Contract payment must use indexed order dispatch')))
    first = main.operations_store.run(lambda u: integrations.apply_payment(u, payment))
    second = main.operations_store.run(lambda u: integrations.apply_payment(u, payment))
    assert first['id'] == second['id'] == row['id']
    state = record_state(finance_api, p)
    assert state['financials']['confirmed_paid_paise'] == 500000 and state['financials']['pending_reserved_paise'] == 0
    assert state['financials']['contractor_received_paise'] == 0


def test_neft_and_rtgs_cannot_confirm_the_same_bank_reference_twice(finance_api, monkeypatch):
    p = awarded_project(finance_api, monkeypatch)
    image = io.BytesIO(); Image.new('RGB', (20, 20), 'green').save(image, format='JPEG')
    photo = finance_api.post('/operations/contracts/projects/' + p['id'] + '/attachments?purpose=payment',
        headers={**auth('shop'), 'Content-Type': 'image/jpeg'}, content=image.getvalue()).json()
    seen = set()
    for index, method in enumerate(('neft', 'rtgs')):
        response, _ = payment_request(finance_api, p, 200000, method=method)
        row = next(row for row in response.json()['payments'] if row['id'] not in seen)
        seen.add(row['id']); approve_payment(finance_api, p, row)
        reported = finance_api.post('/operations/contracts/projects/' + p['id'] + '/payments/' + row['id'] + '/reported',
            headers=auth('shop'), json=dict(request_id=str(uuid.uuid4()), expected_version=record_state(finance_api, p)['version'],
                reference='UTR-ONE-PROVIDER-REFERENCE', evidence_ids=[photo['id']]))
        assert reported.status_code == 200, reported.text
        verified = finance_api.post('/operations/contracts/admin/payments/' + row['id'] + '/verify-external', headers=ADMIN,
            json=dict(approved=True, reason='Independent bank reconciliation of the actual provider reference.',
                verified_reference='UTR-ONE-PROVIDER-REFERENCE', evidence_reference='test-provider-bank-evidence'))
        assert verified.status_code == (200 if index == 0 else 409), verified.text
    state = record_state(finance_api, p)
    assert state['financials']['confirmed_paid_paise'] == state['financials']['contractor_received_paise'] == 200000
    assert state['financials']['pending_reserved_paise'] == 200000


def test_custom_query_cannot_escape_into_any_legacy_or_public_contract_channel(custom_api):
    q = custom_query(custom_api)
    routes = [('/operations/contractor/published', None), ('/operations/contractor/overview', None),
        ('/operations/contractor/opportunities', 'worker'), ('/operations/contractor/workspace', 'worker'),
        ('/repaidians/opportunities?kind=tenders', None),
        ('/repaidians/work/contracts', 'worker')]
    for path, uid in routes:
        response = custom_api.get(path, headers=auth(uid) if uid else {})
        assert response.status_code == 200, (path, response.text)
        assert q['id'] not in response.text and 'PRIVATE customer' not in response.text, (path, response.text)
    for path in ('/operations/contractor/published/' + q['id'], '/repaidians/opportunities/contract/' + q['id']):
        for uid in ((None,) if path.startswith('/repaidians/') else (None, 'worker', 'shop')):
            response = custom_api.get(path, headers=auth(uid) if uid else {})
            assert response.status_code == 404, (path, uid, response.text)
    paths = [('/operations/contractor/tenders/' + q['id'] + '/commands',
        {'expected_version': q['version'], 'action': 'close'}),
        ('/operations/contractor/tenders/' + q['id'] + '/bid',
        {'request_id': str(uuid.uuid4()), 'expected_version': q['version'], 'project_id': 'private-plan',
            'amount_paise': 800000, 'proposal': 'Must use the scoped custom contract proposal route.', 'accepted_terms': True}),
        ('/operations/contractor/projects', {'request_id': str(uuid.uuid4()), 'title': 'Bypass private query',
            'scope': 'Private query must not become a separate bidding plan.', 'site': 'Private site',
            'starts_at': q['starts_at'], 'ends_at': q['ends_at'], 'budget_paise': q['budget_paise'], 'tender_id': q['id']})]
    for path, body in paths:
        response = custom_api.post(path, headers=auth('worker'), json=body)
        assert response.status_code == 403, (path, response.text)
        assert response.json()['detail']['code'] == 'SCOPED_QUERY'


def test_private_query_match_scope_and_bid_prices_are_actor_owned(custom_api):
    q = custom_query(custom_api)
    denied = custom_api.get('/operations/custom-contracts/queries/' + q['id'], headers=auth('stranger'))
    assert denied.status_code == 404 and 'PRIVATE' not in denied.text
    assert custom_api.get('/operations/custom-contracts/queries/' + q['id']).status_code == 401
    q = custom_bid(custom_api, q)
    q = custom_bid(custom_api, q, uid='worker2', amount=750000)
    for uid in ('worker', 'worker2'):
        response = custom_api.get('/operations/custom-contracts/queries/' + q['id'], headers=auth(uid))
        assert response.status_code == 200
        query = response.json()['query']
        assert all(bid['contractor_id'] == uid for bid in query['bids'])
        assert 'site' not in query and 'location' not in query
        assert 'PRIVATE exact customer entrance' not in response.text
    owned = custom_api.get('/operations/custom-contracts/queries/' + q['id'], headers=auth('shop')).json()['query']
    assert len(owned['bids']) == 2 and owned['site'] == 'PRIVATE exact customer entrance'
    # A stale lane or profile label does not grant a different city/trade access.
    worker = get('workers', 'worker2')
    put('workers', 'worker2', {**worker, 'city': 'Mumbai'})
    assert custom_api.get('/operations/custom-contracts/queries/' + q['id'], headers=auth('worker2')).status_code == 404
    put('workers', 'worker2', {**worker, 'status': 'pending'})
    assert custom_api.get('/operations/custom-contracts/queries/' + q['id'], headers=auth('worker2')).status_code == 404


def test_preaward_customer_and_bidder_have_no_freeform_message_bypass(custom_api):
    q = custom_bid(custom_api, custom_query(custom_api))
    proposal = q['bids'][0]
    for uid in ('shop', 'worker'):
        for section in ('messages', 'enquiries'):
            path = '/operations/custom-contracts/queries/' + q['id'] + '/' + section
            assert custom_api.get(path, headers=auth(uid)).status_code == 403
            body = dict(request_id=str(uuid.uuid4()), text='A private message must wait until the accepted award.')
            if section == 'enquiries':
                body['bid_id'] = proposal['id']
            response = custom_api.post(path, headers=auth(uid), json=body)
            assert response.status_code == 403, (uid, section, response.text)
    assert custom_api.post('/repaidians/messages/worker', headers=auth('shop'), json={'text': 'Generic customer DM'}).status_code == 403
    assert custom_api.post('/repaidians/messages/shop', headers=auth('worker'), json={'text': 'Generic customer DM from contractor'}).status_code in (403, 404)
    # Customer-owned discussion controls on this private advertisement are a
    # distinct authorized scope; they do not unlock either private message API.
    path = '/operations/custom-contracts/queries/' + q['id'] + '/comments'
    assert custom_api.post(path, headers=auth('shop'), json=dict(request_id=str(uuid.uuid4()), text='Owner clarifies advertised project scope.')).status_code == 201


def test_concurrent_custom_awards_create_one_project_and_unlock_only_winner_messages(custom_api):
    q = custom_bid(custom_api, custom_query(custom_api))
    q = custom_bid(custom_api, q, uid='worker2', amount=750000)
    q = custom_api.get('/operations/custom-contracts/queries/' + q['id'], headers=auth('shop')).json()['query']
    bids = q['bids']
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda bid: custom_award(custom_api, q, bid['id']), bids))
    assert sorted(response.status_code for response in responses) == [200, 409]
    success = next(response.json() for response in responses if response.status_code == 200)
    canonical = get('contract_projects', success['project']['id'])
    tender = get('contract_tenders', q['id'])
    winning_bid = next(bid for bid in tender['bids'] if bid['id'] == tender['winning_bid_id'])
    winner = winning_bid['contractor_id']; loser = 'worker2' if winner == 'worker' else 'worker'
    assert canonical['tender_id'] == q['id'] and canonical['owner_id'] == winner and canonical['client_id'] == 'shop'
    assert canonical['contract_value_paise'] == winning_bid['amount_paise']
    assert len([bid for bid in tender['bids'] if bid['status'] == 'awarded']) == 1
    private = record_state(custom_api, canonical)
    assert private['financials']['agreed_deal_paise'] == winning_bid['amount_paise']
    assert private['financials']['confirmed_paid_paise'] == private['financials']['pending_reserved_paise'] == 0
    path = '/operations/custom-contracts/queries/' + q['id'] + '/messages'
    for uid in ('shop', winner):
        response = custom_api.post(path, headers=auth(uid), json=dict(request_id=str(uuid.uuid4()), text='Award-scoped private work discussion.'))
        assert response.status_code == 201, response.text
        assert custom_api.get(path, headers=auth(uid)).status_code == 200
    for uid in (loser, 'stranger', 'customer'):
        assert custom_api.get(path, headers=auth(uid)).status_code in (403, 404)
        assert custom_api.post(path, headers=auth(uid), json=dict(request_id=str(uuid.uuid4()), text='Outsider cannot join private contract messages.')).status_code in (403, 404)
    assert custom_api.get('/operations/custom-contracts/public/' + q['id'] + '/progress').status_code == 404
    current = custom_api.get('/operations/custom-contracts/queries/' + q['id'], headers=auth('shop')).json()['query']
    published = custom_api.post('/operations/custom-contracts/queries/' + q['id'] + '/commands', headers=auth('shop'),
        json=dict(request_id=str(uuid.uuid4()), expected_version=current['version'], action='public_progress', public_progress=True))
    assert published.status_code == 200
    public = custom_api.get('/operations/custom-contracts/public/' + q['id'] + '/progress')
    assert public.status_code == 200
    for secret in ('site', 'location', 'scope', 'client_id', 'contract_value_paise', 'payments', 'attendance'):
        assert secret not in public.json()
    assert 'PRIVATE exact customer entrance' not in public.text


def test_trial_agent_cold_contractor_dm_requires_live_nearby_opening_context(custom_api):
    put('workers', 'worker2', {**get('workers', 'worker2'), 'contractor_verified': False})
    q = custom_bid(custom_api, custom_query(custom_api))
    ordinary = custom_api.post('/repaidians/messages/worker', headers=auth('worker2'), json={'text': 'Cold generic trial message bypass'})
    assert ordinary.status_code == 403, ordinary.text
    path = '/operations/custom-contracts/queries/' + q['id'] + '/agent-messages'
    body = dict(request_id=str(uuid.uuid4()), recipient_id='worker', text='Interested in the actual nearby AC installation opening.',
        location={**PIN, 'accuracy': 5, 'captured_at': time.time()}, location_consent=True)
    sent = custom_api.post(path, headers=auth('worker2'), json=body)
    assert sent.status_code == 201, sent.text
    assert sent.json()['message']['queryId'] == q['id']
    assert sent.json()['message']['openingContext'] == 'pending_award_availability'
    again = custom_api.post(path, headers=auth('worker2'), json=body)
    assert again.status_code == 201 and again.json()['message']['id'] == sent.json()['message']['id']
    delivered = custom_api.get('/repaidians/messages/worker2', headers=auth('worker'))
    assert delivered.status_code == 200 and len(delivered.json()['messages']) == 1
    assert delivered.json()['messages'][0]['id'] == sent.json()['message']['id']
    for fields, expected in [({'location': {'lat': 22, 'lng': 87, 'accuracy': 5, 'captured_at': time.time()}}, 403),
                             ({'location_consent': False}, 422),
                             ({'recipient_id': 'shop'}, 404),
                             ({'location': {**PIN, 'accuracy': 5, 'captured_at': time.time() - 901}}, 422)]:
        response = custom_api.post(path, headers=auth('worker2'), json={**body, **fields, 'request_id': str(uuid.uuid4())})
        assert response.status_code == expected, (fields, response.text)
    assert len(custom_api.get('/repaidians/messages/worker2', headers=auth('worker')).json()['messages']) == 1


def test_accepted_professional_connection_and_paid_plan_keep_normal_message_permission(custom_api):
    put('workers', 'worker2', {**get('workers', 'worker2'), 'contractor_verified': False})
    path = '/repaidians/network/members/worker/connection'
    requested = custom_api.post(path, headers=auth('worker2'), json=dict(action='request', expectedVersion=0, clientId=str(uuid.uuid4())))
    assert requested.status_code == 200, requested.text
    assert custom_api.post('/repaidians/messages/worker', headers=auth('worker2'), json={'text': 'Pending connection is not accepted'}).status_code == 403
    accepted = custom_api.post('/repaidians/network/members/worker2/connection', headers=auth('worker'),
        json=dict(action='accept', expectedVersion=1, clientId=str(uuid.uuid4())))
    assert accepted.status_code == 200, accepted.text
    sent = custom_api.post('/repaidians/messages/worker', headers=auth('worker2'), json={'text': 'Accepted professional connection message'})
    assert sent.status_code == 201, sent.text
    removed = custom_api.post(path, headers=auth('worker2'), json=dict(action='remove', expectedVersion=2, clientId=str(uuid.uuid4())))
    assert removed.status_code == 200, removed.text
    assert custom_api.post('/repaidians/messages/worker', headers=auth('worker2'), json={'text': 'Revoked connection no longer grants cold trial messaging'}).status_code == 403
    stamp = int(time.time() * 1000)
    put('rp_subscriptions', 'worker2', dict(userId='worker2', status='active', plan='pro', provider='razorpay',
        amountPaise=19900, startsAt=stamp - 1000, endsAt=stamp + 86400000))
    paid = custom_api.post('/repaidians/messages/worker', headers=auth('worker2'), json={'text': 'Paid professional messaging with normal recipient privacy'})
    assert paid.status_code == 201, paid.text


def test_query_and_finance_public_progress_controls_share_live_owner_consent(custom_api):
    q = custom_bid(custom_api, custom_query(custom_api))
    awarded = custom_award(custom_api, q, q['bids'][0]['id'])
    assert awarded.status_code == 200, awarded.text
    p = get('contract_projects', awarded.json()['project']['id'])
    query_path = '/operations/custom-contracts/public/' + q['id'] + '/progress'
    finance_path = '/operations/contracts/public/projects/' + p['id'] + '/progress'
    assert custom_api.get(query_path).status_code == custom_api.get(finance_path).status_code == 404
    q = custom_api.get('/operations/custom-contracts/queries/' + q['id'], headers=auth('shop')).json()['query']
    published = custom_api.post('/operations/custom-contracts/queries/' + q['id'] + '/commands', headers=auth('shop'),
        json=dict(request_id=str(uuid.uuid4()), expected_version=q['version'], action='public_progress', public_progress=True))
    assert published.status_code == 200, published.text
    assert record_state(custom_api, p)['public_progress']['enabled'] is True
    assert custom_api.get(query_path).status_code == custom_api.get(finance_path).status_code == 200
    for uid in ('worker', 'worker2', 'stranger'):
        denied = custom_api.put('/operations/contracts/projects/' + p['id'] + '/public-progress', headers=auth(uid),
            json=dict(request_id=str(uuid.uuid4()), expected_version=record_state(custom_api, p)['version'], enabled=False))
        assert denied.status_code in (403, 404), denied.text
    disabled = custom_api.put('/operations/contracts/projects/' + p['id'] + '/public-progress', headers=auth('shop'),
        json=dict(request_id=str(uuid.uuid4()), expected_version=record_state(custom_api, p)['version'], enabled=False))
    assert disabled.status_code == 200, disabled.text
    assert get('contract_tenders', q['id'])['controls']['public_progress'] is False
    assert custom_api.get(query_path).status_code == custom_api.get(finance_path).status_code == 404


def test_preaward_interest_becomes_one_native_application_and_shared_team_placement(custom_api):
    put('workers', 'worker2', {**get('workers', 'worker2'), 'contractor_verified': False})
    q = custom_query(custom_api)
    body = dict(request_id=str(uuid.uuid4()), note='Available for the real nearby AC installation and inspection.',
        available=True, worker_type='ac_installer', location={**PIN, 'accuracy': 5, 'captured_at': time.time()}, location_consent=True)
    interest = custom_api.post('/operations/custom-contracts/queries/' + q['id'] + '/interest', headers=auth('worker2'), json=body)
    assert interest.status_code == 200, interest.text
    first = interest.json()['interest']
    assert first['status'] == 'pending_award'
    assert get('project_applications', first['id']) is None
    assert get('contract_tenders', q['id']).get('winning_project_id') is None
    q = custom_bid(custom_api, q)
    awarded = custom_award(custom_api, q, q['bids'][0]['id'])
    assert awarded.status_code == 200, awarded.text
    p = get('contract_projects', awarded.json()['project']['id'])
    p, _ = notice(custom_api, p, openings=2, work_trade='ac', sector='Education',
                  role_requirements=[{'worker_type': 'ac_installer', 'count': 2}])
    response = apply(custom_api, p, worker_type='ac_installer')
    assert response.status_code == 200, response.text
    a = response.json()
    assert a['first_interest_at'] == first['created_at']
    assert a['worker_id'] == 'worker2' and a['project_id'] == p['id']
    offered = decision(custom_api, a, p, worker_type='ac_installer')
    assert offered.status_code == 200, offered.text
    p = get('contract_projects', p['id'])
    page = custom_api.get('/repaidians/work/jobs?trade=ac', headers=auth('worker2'))
    assert page.status_code == 200, page.text
    card = next(card for card in page.json()['items'] if card['id'] == p['id'])
    assert card['application']['id'] == a['id'] and card['application']['status'] == 'offered'
    assert card['openings'] == 2 and card['pendingOffers'] == 1 and card['availableToOffer'] == 1
    accepted = cmd(custom_api, p, 'accept', uid='worker2', target_id=offered.json()['invitation_id'])
    assert accepted.status_code == 200, accepted.text
    current = get('contract_projects', p['id'])
    assert get('project_applications', a['id'])['status'] == 'hired'
    page = custom_api.get('/repaidians/work/jobs?trade=ac', headers=auth('worker2')).json()
    card = next(card for card in page['items'] if card['id'] == p['id'])
    assert card['application']['status'] == 'hired' and card['openings'] == 1 and card['pendingOffers'] == 0
    native = custom_api.get('/operations/contractor/workspace', headers=auth('worker')).json()
    project_card = next(row for row in native['projects'] if row['id'] == p['id'])
    assert project_card['capacity']['accepted'] == 1 and project_card['capacity']['vacancies'] == card['openings']
