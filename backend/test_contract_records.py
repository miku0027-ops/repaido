"""Real private-contract HTTP/transaction tests; payment providers are fake."""
import copy
import hashlib
import hmac
import io
import json
import sqlite3
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, Header, HTTPException
from fastapi.testclient import TestClient
from PIL import Image

import contract_records as records
from test_operations import api as operations_api
from operations import Store

BASE = '/operations/contracts/projects/project-one'


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.delenv('REPAIDO_COMMUNITY_BUCKET', raising=False)
    monkeypatch.delenv('REPAIDO_KYC_BUCKET', raising=False)
    monkeypatch.setenv('REPAIDO_COMMUNITY_MEDIA_DIR', str(tmp_path / 'private-media'))
    path = str(tmp_path / 'contracts.db')
    @contextmanager
    def db():
        conn = sqlite3.connect(path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()
    def user(authorization: str = Header(default='')):
        uid = authorization.removeprefix('Bearer ')
        if uid not in ('customer', 'contractor', 'teammate', 'stranger'):
            raise HTTPException(401)
        return dict(id=uid, name=uid.title(), phone_verified=True)
    def operator(x_admin_key: str = Header(default='')):
        if x_admin_key != 'fixture-operator':
            raise HTTPException(403)
        return dict(id='operator')
    core = SimpleNamespace(DB_PATH=path, USE_FIRESTORE=False, db=db, current_user=user, operator=operator, app=FastAPI())
    core.operations_store = Store(core); core.operations_store.init(); records.initialize(core); records.install(core)
    now = time.time()
    def seed(u):
        u.put('workers', 'contractor', dict(id='contractor', status='approved', contractor_verified=True))
        u.put('rp_members', 'contractor', dict(id='contractor', createdAt=int(now * 1000)))
        u.put('verification', 'contractor', dict(worker_id='contractor', bank_status='verified', fund_account_id='fa_fixture', bank_last4='9999'))
        u.put('contract_tenders', 'tender-one', dict(id='tender-one', owner_id='customer', status='awarded', winning_project_id='project-one', winning_bid_id='bid-one',
            bids=[dict(id='bid-one', contractor_id='contractor', project_id='project-one', status='awarded', amount_paise=100000)]))
        u.put('contract_projects', 'project-one', dict(id='project-one', owner_id='contractor', client_id='customer', title='Electrical contract', scope='Repair the recorded electrical installation',
            site='Private site entrance', starts_at=now - 3600, ends_at=now + 86400, status='active', awarded_at=now - 7200, tender_id='tender-one', contract_value_paise=100000,
            team=[dict(worker_id='teammate', name='Crew Professional', role='member', status='accepted', daily_rate_paise=9900)],
            goals=[dict(id='goal-one', title='Inspect circuits', status='planned', due_at=now + 4000)], attendance=[], events=[], version=1))
    core.operations_store.run(seed)
    with TestClient(core.app) as client:
        client.core = core
        yield client


def auth(uid='customer'):
    return {'Authorization': 'Bearer ' + uid}


@pytest.fixture
def gateway(monkeypatch):
    for name, value in {'REPAIDO_PAYMENTS_ENABLED': 'true', 'RAZORPAY_KEY_ID': 'rzp_fixture', 'RAZORPAY_KEY_SECRET': 'fixture', 'RAZORPAY_WEBHOOK_SECRET': 'fixture',
                        'RAZORPAYX_KEY_ID': 'x_fixture', 'RAZORPAYX_KEY_SECRET': 'fixture'}.items():
        monkeypatch.setenv(name, value)
    state = dict(orders=[], payments={}, creates=0, calls=[], unknown=False)
    def provider(path, body=None, payout=False, **kwargs):
        state['calls'].append((path, copy.deepcopy(body), payout))
        if path == 'orders' and body:
            state['creates'] += 1
            order = {**body, 'id': 'order_fixture' + str(state['creates'])}
            state['orders'].append(order)
            if state['unknown']:
                raise RuntimeError('Simulated lost gateway response')
            return copy.deepcopy(order)
        if path.startswith('orders?receipt='):
            return dict(items=[copy.deepcopy(o) for o in state['orders'] if o['receipt'] == path.split('=', 1)[1]])
        if path.startswith('payments/'):
            return copy.deepcopy(state['payments'][path.split('/')[1]])
        if path == 'fund_accounts/fa_fixture':
            return dict(id='fa_fixture', contact_id='cont_fixture', bank_account=dict(name='Approved Contractor', account_number='123456789999', ifsc='TEST0123456', bank_name='Fixture Bank'))
        if path == 'contacts/cont_fixture':
            return dict(id='cont_fixture', reference_id='contractor')
        raise AssertionError('Unexpected provider call ' + path)
    monkeypatch.setattr(records, 'razorpay', provider)
    return state


def snapshot(api, uid='customer'):
    response = api.get(BASE + '/records', headers=auth(uid))
    assert response.status_code == 200, response.text
    return response.json()


def request(api, amount=40000, method='gateway', uid='contractor', body=None):
    before = snapshot(api, uid)
    data = body or dict(request_id=str(uuid.uuid4()), expected_version=before['version'], amount_paise=amount, method=method, note='Agreed milestone payment', milestone_id='goal-one')
    response = api.post(BASE + '/payments', headers=auth(uid), json=data)
    assert response.status_code == 200, response.text
    result = response.json()
    old = {row['id'] for row in before['payments']}
    return result, next(row for row in result['payments'] if row['id'] not in old), data


def approve(api, row, approved=True):
    body = dict(request_id=str(uuid.uuid4()), expected_version=snapshot(api)['version'], approved=approved)
    response = api.post(BASE + '/payments/' + row['id'] + '/approve', headers=auth(), json=body)
    assert response.status_code == 200, response.text
    return response.json(), body


def checkout(api, row):
    response = api.post(BASE + '/payments/' + row['id'] + '/order', headers=auth())
    assert response.status_code == 200, response.text
    return response.json()


def capture(api, row, gateway, **changes):
    order = checkout(api, row)
    payment = dict(dict(id='pay_fixture' + str(len(gateway['payments']) + 1), order_id=order['order_id'], amount=row['amount_paise'], currency='INR', status='captured', captured=True, amount_refunded=0), **changes)
    gateway['payments'][payment['id']] = payment
    response = api.post(BASE + '/payments/' + row['id'] + '/check', headers=auth(), json=dict(payment_id=payment['id']))
    return response, payment


def image(api, purpose='payment', uid='customer'):
    out = io.BytesIO(); Image.new('RGB', (80, 80), '#224c65').save(out, format='JPEG')
    response = api.post(BASE + '/attachments?purpose=' + purpose, headers={**auth(uid), 'Content-Type': 'image/jpeg'}, content=out.getvalue())
    assert response.status_code == 200, response.text
    return response.json()


def test_award_party_privacy_and_authentic_price(api, gateway):
    assert api.get(BASE + '/records').status_code == 401
    assert api.get(BASE + '/records', headers=auth('stranger')).status_code == 404
    assert api.get(BASE + '/records', headers=auth('teammate')).status_code == 404
    customer = snapshot(api); contractor = snapshot(api, 'contractor')
    assert customer['financials']['agreed_deal_paise'] == 100000
    assert customer['actions']['can_approve'] and not customer['actions']['can_progress']
    assert contractor['actions']['can_progress'] and not contractor['actions']['can_approve']
    api.core.operations_store.run(lambda u: u.put('contract_tenders', 'tender-one', {**u.get('contract_tenders', 'tender-one'), 'status': 'open'}))
    assert api.get(BASE + '/records', headers=auth()).status_code == 409


@pytest.mark.parametrize('changes', [{'amount_paise': 1.5}, {'amount_paise': True}, {'amount_paise': '100'}, {'status': 'paid'}, {'payment_id': 'pay_fake'}, {'amount_paise': -1}])
def test_request_rejects_fractional_money_and_payment_claims(api, gateway, changes):
    body = dict(dict(request_id=str(uuid.uuid4()), expected_version=1, amount_paise=100, method='gateway'), **changes)
    assert api.post(BASE + '/payments', headers=auth('contractor'), json=body).status_code == 422
    assert snapshot(api)['financials']['pending_reserved_paise'] == 0


def test_cumulative_pending_paid_ceiling_and_idempotent_approval(api, gateway):
    state, row, body = request(api, 60000)
    assert state['financials']['pending_reserved_paise'] == 60000
    replay = api.post(BASE + '/payments', headers=auth('contractor'), json=body)
    assert replay.status_code == 200 and len(replay.json()['payments']) == 1
    assert api.post(BASE + '/payments', headers=auth('contractor'), json={**body, 'amount_paise': 70000}).status_code == 409
    assert api.post(BASE + '/payments/' + row['id'] + '/order', headers=auth()).status_code == 409
    bad_approval = dict(request_id=str(uuid.uuid4()), expected_version=state['version'], approved=True)
    assert api.post(BASE + '/payments/' + row['id'] + '/approve', headers=auth('contractor'), json=bad_approval).status_code == 403
    state, accepted = approve(api, row)
    assert api.post(BASE + '/payments/' + row['id'] + '/approve', headers=auth(), json=accepted).status_code == 200
    paid, payment = capture(api, row, gateway)
    assert paid.status_code == 200, paid.text
    totals = paid.json()['financials']
    assert totals['confirmed_paid_paise'] == totals['gateway_collected_paise'] == 60000
    assert totals['contractor_received_paise'] == totals['pending_reserved_paise'] == 0
    assert totals['balance_paise'] == 40000
    assert api.post(BASE + '/payments', headers=auth('contractor'), json=dict(request_id=str(uuid.uuid4()), expected_version=paid.json()['version'], amount_paise=40001, method='gateway')).status_code == 409
    again = api.post(BASE + '/payments/' + row['id'] + '/check', headers=auth(), json=dict(payment_id=payment['id']))
    assert again.json()['financials'] == totals and again.json()['version'] == paid.json()['version']
    assert len(api.core.operations_store.run(lambda u: u.all('contract_reports'))) == 1


def test_simultaneous_requests_cannot_overreserve_the_deal(api, gateway):
    def reserve(_):
        return api.post(BASE + '/payments', headers=auth('contractor'), json=dict(request_id=str(uuid.uuid4()), expected_version=1, amount_paise=70000, method='gateway')).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(reserve, range(2)))
    assert sorted(results) == [200, 409]
    assert snapshot(api)['financials']['pending_reserved_paise'] == 70000


@pytest.mark.parametrize('changes', [{'amount': 1}, {'currency': 'USD'}, {'order_id': 'order_foreign'}, {'captured': False}, {'amount_refunded': 1.5}, {'status': 'authorized', 'captured': False, 'amount_refunded': 1}])
def test_provider_get_validation_precedes_ledger_capture(api, gateway, changes):
    _, row, _ = request(api); approve(api, row)
    result, _ = capture(api, row, gateway, **changes)
    assert result.status_code in (200, 409)
    assert snapshot(api)['financials']['confirmed_paid_paise'] == 0
    assert snapshot(api)['financials']['pending_reserved_paise'] == 40000


def test_cross_purchase_receipt_reuse_rejected(api, gateway):
    _, row, _ = request(api); approve(api, row); order = checkout(api, row)
    api.core.operations_store.run(lambda u: u.put('receipts', 'pay_reused', dict(id='pay_reused', kind='other_purchase', userId='stranger')))
    gateway['payments']['pay_reused'] = dict(id='pay_reused', order_id=order['order_id'], amount=40000, currency='INR', status='captured', captured=True)
    assert api.post(BASE + '/payments/' + row['id'] + '/check', headers=auth(), json=dict(payment_id='pay_reused')).status_code == 409
    assert snapshot(api)['financials']['confirmed_paid_paise'] == 0


def test_refund_tombstone_survives_stale_capture_and_generates_report(api, gateway):
    _, row, _ = request(api); approve(api, row); result, payment = capture(api, row, gateway)
    assert result.status_code == 200
    gateway['payments'][payment['id']].update(status='refunded', amount_refunded=40000)
    refund = api.post(BASE + '/payments/' + row['id'] + '/check', headers=auth(), json=dict(payment_id=payment['id']))
    assert refund.status_code == 200 and refund.json()['financials']['confirmed_paid_paise'] == 0
    gateway['payments'][payment['id']].update(status='captured', amount_refunded=0)
    stale = api.post(BASE + '/payments/' + row['id'] + '/check', headers=auth(), json=dict(payment_id=payment['id']))
    assert stale.json()['financials']['confirmed_paid_paise'] == 0 and stale.json()['payments'][0]['status'] == 'refunded'
    reports = api.core.operations_store.run(lambda u: u.all('contract_reports'))
    assert len(reports) == 2 and reports[0]['record']['financials'] != reports[1]['record']['financials']


def test_unknown_order_creation_reuses_receipt_without_second_order(api, gateway):
    _, row, _ = request(api); approve(api, row)
    gateway['unknown'] = True
    with pytest.raises(RuntimeError):
        api.post(BASE + '/payments/' + row['id'] + '/order', headers=auth())
    gateway['unknown'] = False
    first = checkout(api, row); second = checkout(api, row)
    assert first['order_id'] == second['order_id'] and gateway['creates'] == 1
    assert snapshot(api)['financials']['pending_reserved_paise'] == 40000


def test_external_bank_reference_is_pending_until_operator_verification(api, gateway):
    state, row, _ = request(api, 25000, 'neft'); approve(api, row)
    bank = api.get(BASE + '/bank-instructions', headers=auth())
    assert bank.status_code == 200 and bank.json()['last4'] == '9999'
    assert api.get(BASE + '/bank-instructions', headers=auth('contractor')).status_code == 403
    photo = image(api)
    payload = dict(request_id=str(uuid.uuid4()), expected_version=snapshot(api)['version'], reference='UTR-REAL-FIXTURE-123', evidence_ids=[photo['id']])
    reported = api.post(BASE + '/payments/' + row['id'] + '/reported', headers=auth(), json=payload)
    assert reported.status_code == 200, reported.text
    assert reported.json()['financials']['confirmed_paid_paise'] == 0
    assert reported.json()['payments'][0]['status'] == 'reported_pending'
    decision = dict(approved=True, reason='Operator compared bank statement and saved transfer evidence', verified_reference=payload['reference'], evidence_reference='independent-bank-statement-fixture')
    path = '/operations/contracts/admin/payments/' + row['id'] + '/verify-external'
    assert api.post(path, headers=auth(), json=decision).status_code == 403
    result = api.post(path, headers={'X-Admin-Key': 'fixture-operator'}, json=decision)
    assert result.status_code == 200, result.text
    totals = snapshot(api)['financials']
    assert totals['confirmed_paid_paise'] == totals['contractor_received_paise'] == 25000
    assert totals['gateway_collected_paise'] == totals['pending_reserved_paise'] == 0
    again = api.post(path, headers={'X-Admin-Key': 'fixture-operator'}, json=decision)
    assert again.json()['report_id'] == result.json()['report_id']
    assert len(api.core.operations_store.run(lambda u: u.all('contract_reports'))) == 1


def test_progress_photo_private_review_and_report_anytime_after_award(api, gateway):
    before = api.get(BASE + '/report.pdf', headers=auth())
    assert before.status_code == 200 and before.content.startswith(b'%PDF')
    assert before.headers['cache-control'] == 'private, no-store'
    photo = image(api, 'progress', 'contractor')
    assert api.get(photo['url'].removeprefix('/api'), headers=auth('stranger')).status_code == 404
    assert api.get(photo['url'].removeprefix('/api'), headers=auth()).status_code == 200
    body = dict(request_id=str(uuid.uuid4()), expected_version=1, percent=45, note='Inspected circuits and replaced recorded damaged components', milestone_id='goal-one', evidence_ids=[photo['id']])
    assert api.post(BASE + '/progress', headers=auth(), json=body).status_code == 403
    result = api.post(BASE + '/progress', headers=auth('contractor'), json=body)
    assert result.status_code == 200, result.text
    progress = result.json()['progress'][0]
    assert progress['source'] == 'contractor_reported' and progress['status'] == 'reported'
    decision = dict(request_id=str(uuid.uuid4()), expected_version=result.json()['version'], approved=True, note='Customer inspected the recorded milestone')
    reviewed = api.post(BASE + '/progress/' + progress['id'] + '/review', headers=auth(), json=decision)
    assert reviewed.status_code == 200 and reviewed.json()['progress'][0]['status'] == 'customer_confirmed'
    report = api.get(BASE + '/report.pdf', headers=auth())
    assert report.status_code == 200 and report.content.startswith(b'%PDF') and len(report.content) > len(before.content)
    assert api.get(BASE + '/report.pdf', headers=auth('teammate')).status_code == 404
    canonical = api.core.operations_store.run(lambda u: u.get('contract_projects', 'project-one'))
    assert canonical['goals'][0]['status'] == 'planned' and canonical['status'] == 'active'
    snapshot_record = api.core.operations_store.run(lambda u: records._snapshot(u, canonical, records._ledger(u, canonical)))
    assert 'daily_rate_paise' not in str(snapshot_record['team'])


def test_unavailable_gateway_never_reserves_or_creates_payment(api, gateway, monkeypatch):
    monkeypatch.delenv('RAZORPAY_KEY_SECRET')
    assert not snapshot(api)['payment_methods']['gateway']['available']
    assert api.post(BASE + '/payments', headers=auth('contractor'), json=dict(request_id=str(uuid.uuid4()), expected_version=1, amount_paise=100, method='gateway')).status_code == 503
    assert snapshot(api)['financials']['pending_reserved_paise'] == 0 and gateway['creates'] == 0


def test_public_progress_requires_owner_and_uploader_consents_and_revokes_live(api, gateway):
    public = '/operations/contracts/public/projects/project-one/progress'
    history = '/operations/contracts/public/contractors/contractor/projects'
    assert api.get(public).status_code == 404 and api.get(history).json()['projects'] == []
    out = io.BytesIO(); Image.new('RGB', (80, 80), '#335d81').save(out, format='JPEG')
    private_photo = image(api, 'progress', 'contractor')
    public_photo = api.post(BASE + '/attachments?purpose=progress&share_public=true', headers={**auth('contractor'), 'Content-Type': 'image/jpeg'}, content=out.getvalue()).json()
    note = 'Completed the electrical inspection and recorded circuit repairs'
    body = dict(request_id=str(uuid.uuid4()), expected_version=1, percent=40, note=note, evidence_ids=[private_photo['id'], public_photo['id']], public_share_consent=True)
    reported = api.post(BASE + '/progress', headers=auth('contractor'), json=body)
    assert reported.status_code == 200, reported.text
    consent = dict(request_id=str(uuid.uuid4()), expected_version=reported.json()['version'], enabled=True)
    assert api.put(BASE + '/public-progress', headers=auth('contractor'), json=consent).status_code == 403
    shared = api.put(BASE + '/public-progress', headers=auth(), json=consent)
    assert shared.status_code == 200, shared.text
    summary = api.get(public)
    assert summary.status_code == 200 and summary.json()['progress'][0]['note'] == note
    assert len(summary.json()['progress'][0]['evidence']) == 1
    assert summary.json()['progress_series'][0]['percent'] == 40
    assert len(summary.json()['calendar']) == 3
    assert 'Private site entrance' not in summary.text and 'amount_paise' not in summary.text
    assert 'customer_id' not in summary.text and 'daily_rate_paise' not in summary.text
    media = summary.json()['progress'][0]['evidence'][0]['url'].removeprefix('/api')
    assert api.get(media).status_code == 200
    assert api.get('/operations/contracts/public/attachments/' + private_photo['id']).status_code == 404
    assert len(api.get(history).json()['projects']) == 1
    revoked = api.put(BASE + '/public-progress', headers=auth(), json=dict(request_id=str(uuid.uuid4()), expected_version=shared.json()['version'], enabled=False))
    assert revoked.status_code == 200
    assert api.get(public).status_code == api.get(media).status_code == 404
    assert api.get(history).json()['projects'] == []


def test_bank_photos_never_publish_and_nonconsented_progress_note_stays_private(api, gateway):
    out = io.BytesIO(); Image.new('RGB', (80, 80), '#203c51').save(out, format='JPEG')
    forbidden = api.post(BASE + '/attachments?purpose=payment&share_public=true', headers={**auth(), 'Content-Type': 'image/jpeg'}, content=out.getvalue())
    assert forbidden.status_code == 422
    private_note = 'Private progress details and a customer discussion remain in the private record'
    reported = api.post(BASE + '/progress', headers=auth('contractor'), json=dict(request_id=str(uuid.uuid4()), expected_version=1, percent=25, note=private_note))
    assert reported.status_code == 200
    api.put(BASE + '/public-progress', headers=auth(), json=dict(request_id=str(uuid.uuid4()), expected_version=reported.json()['version'], enabled=True))
    result = api.get('/operations/contracts/public/projects/project-one/progress')
    assert result.status_code == 200 and result.json()['progress'][0]['note'] is None and private_note not in result.text
    assert snapshot(api)['progress'][0]['note'] == private_note


def test_public_directory_loads_only_live_summaries_without_progress_or_media_reads(api, gateway, monkeypatch):
    from operations import Unit
    out = io.BytesIO(); Image.new('RGB', (80, 80), '#335d81').save(out, format='JPEG')
    photo = api.post(BASE + '/attachments?purpose=progress&share_public=true', headers={**auth('contractor'), 'Content-Type':'image/jpeg'}, content=out.getvalue()).json()
    reported = api.post(BASE + '/progress', headers=auth('contractor'), json=dict(request_id=str(uuid.uuid4()), expected_version=1,
                        percent=40, note='Inspected and recorded the completed electrical work', evidence_ids=[photo['id']], public_share_consent=True))
    assert reported.status_code == 200
    def approve_milestone(u):
        project = u.get('contract_projects', 'project-one'); project['goals'][0]['status'] = 'approved'
        u.put('contract_projects', project['id'], project)
    api.core.operations_store.run(approve_milestone)
    consent = api.put(BASE + '/public-progress', headers=auth(), json=dict(request_id=str(uuid.uuid4()), expected_version=reported.json()['version'], enabled=True))
    assert consent.status_code == 200
    row_reads, media_reads = [], []
    original_rows, original_get = records._rows, Unit.get
    def traced_rows(u, kind, pid):
        row_reads.append((kind,pid)); return original_rows(u,kind,pid)
    def traced_get(u, kind, key):
        if kind == 'contract_attachments': media_reads.append(key)
        return original_get(u,kind,key)
    monkeypatch.setattr(records, '_rows', traced_rows); monkeypatch.setattr(Unit, 'get', traced_get)
    history = '/operations/contracts/public/contractors/contractor/projects'
    public = '/operations/contracts/public/projects/project-one/progress'
    result = api.get(history)
    assert result.status_code == 200 and len(result.json()['projects']) == 1
    summary = result.json()['projects'][0]
    assert summary['project']['id'] == 'project-one' and summary['contractor']['id'] == 'contractor'
    assert summary['verified_milestone_progress'] == dict(approved=1,total=1)
    assert summary['progress'] == summary['milestones'] == summary['calendar'] == summary['progress_series'] == []
    assert row_reads == media_reads == []
    detail = api.get(public)
    assert detail.status_code == 200 and detail.json()['progress'][0]['evidence'][0]['id'] == photo['id']
    assert row_reads == [('contract_progress','project-one')] and media_reads == [photo['id']]
    revoked = api.put(BASE + '/public-progress', headers=auth(), json=dict(request_id=str(uuid.uuid4()), expected_version=consent.json()['version'], enabled=False))
    assert revoked.status_code == 200
    row_reads.clear(); media_reads.clear()
    assert api.get(history).json()['projects'] == [] and api.get(public).status_code == 404
    assert row_reads == media_reads == []


def test_progress_report_pdf_embeds_private_thumbnails_and_honest_missing_preview(api, gateway, monkeypatch):
    photo = image(api, 'progress', 'contractor')
    api.post(BASE + '/progress', headers=auth('contractor'), json=dict(request_id=str(uuid.uuid4()), expected_version=1, percent=55, note='Finished circuit repairs with a private uploaded photo', evidence_ids=[photo['id']]))
    available = api.get(BASE + '/report.pdf', headers=auth())
    assert available.status_code == 200 and b'/Subtype /Image' in available.content
    import repaidians_media
    monkeypatch.setattr(repaidians_media, 'read', lambda *args: (_ for _ in ()).throw(RuntimeError('Storage temporarily unavailable')))
    unavailable = api.get(BASE + '/report.pdf', headers=auth())
    assert unavailable.status_code == 200 and unavailable.content.startswith(b'%PDF')
    assert b'/Subtype /Image' not in unavailable.content


def test_public_consent_is_canonical_across_query_and_record_controls(api, gateway):
    def establish_query(u):
        tender = u.get('contract_tenders', 'tender-one')
        tender.update(version=7, controls={'public_progress': True}, events=[])
        u.put('contract_tenders', tender['id'], tender)
        project = u.get('contract_projects', 'project-one')
        records.set_public_consent(u, project, 'customer', True)
        records.set_public_consent(u, project, 'customer', True)
    api.core.operations_store.run(establish_query)
    canonical, ledger = api.core.operations_store.run(lambda u: (u.get('contract_tenders', 'tender-one'), u.get('contract_project_records', 'project-one')))
    assert canonical['version'] == 7 and canonical['events'] == []
    assert ledger['public_progress_enabled'] and ledger['version'] == 2
    assert ledger['confirmed_paid_paise'] == ledger['pending_reserved_paise'] == 0
    public = '/operations/contracts/public/projects/project-one/progress'
    assert api.get(public).status_code == 200
    # A canonical query revocation must hide public records even before a stale
    # projection flag is synchronized, and the signed DTO uses the same truth.
    def query_revocation(u):
        tender = u.get('contract_tenders', 'tender-one')
        tender['controls']['public_progress'] = False
        u.put('contract_tenders', tender['id'], tender)
    api.core.operations_store.run(query_revocation)
    assert api.get(public).status_code == 404
    assert not snapshot(api)['public_progress']['enabled']
    assert api.get('/operations/contracts/public/contractors/contractor/projects').json()['projects'] == []
    # Toggling through private records updates the query authority as well.
    body = dict(request_id=str(uuid.uuid4()), expected_version=ledger['version'], enabled=True)
    shared = api.put(BASE + '/public-progress', headers=auth(), json=body)
    assert shared.status_code == 200, shared.text
    canonical = api.core.operations_store.run(lambda u: u.get('contract_tenders', 'tender-one'))
    assert canonical['controls']['public_progress'] is True and canonical['version'] == 8
    assert canonical['events'][-1]['actor'] == 'customer'
    assert api.put(BASE + '/public-progress', headers=auth(), json=body).json()['version'] == shared.json()['version']


def test_progress_video_is_vetted_private_and_only_published_with_all_consents(api, gateway):
    from test_repaidians_media import mp4
    video = mp4()  # Complete ISO-BMFF framing fixture; no codec is executed.
    headers = {**auth('contractor'), 'Content-Type': 'video/mp4'}
    assert api.post(BASE + '/attachments?purpose=payment', headers=headers, content=video).status_code == 422
    assert api.post(BASE + '/attachments?purpose=progress', headers=headers, content=b'<html>not a video</html>').status_code == 422
    uploaded = api.post(BASE + '/attachments?purpose=progress&share_public=true', headers=headers, content=video)
    assert uploaded.status_code == 200, uploaded.text
    evidence = uploaded.json()
    assert evidence['kind'] == 'video' and evidence['mime'] == 'video/mp4'
    private = evidence['url'].removeprefix('/api')
    assert api.get(private).status_code == 401
    assert api.get(private, headers=auth()).content == video
    assert api.get(private, headers=auth('teammate')).status_code == 404
    reported = api.post(BASE + '/progress', headers=auth('contractor'), json=dict(request_id=str(uuid.uuid4()), expected_version=1,
                        percent=60, note='Recorded progress video showing the completed circuit inspection', evidence_ids=[evidence['id']], public_share_consent=True))
    assert reported.status_code == 200, reported.text
    assert reported.json()['progress'][0]['evidence'][0]['kind'] == 'video'
    public = '/operations/contracts/public/projects/project-one/progress'
    assert api.get(public).status_code == 404
    consent = api.put(BASE + '/public-progress', headers=auth(), json=dict(request_id=str(uuid.uuid4()), expected_version=reported.json()['version'], enabled=True))
    assert consent.status_code == 200, consent.text
    public_evidence = api.get(public).json()['progress'][0]['evidence'][0]
    assert public_evidence['kind'] == 'video' and public_evidence['mime'] == 'video/mp4'
    media = public_evidence['url'].removeprefix('/api')
    response = api.get(media)
    assert response.content == video and response.headers['content-type'] == 'video/mp4'
    assert response.headers['x-content-type-options'] == 'nosniff'
    report = api.get(BASE + '/report.pdf', headers=auth())
    assert report.status_code == 200 and report.content.startswith(b'%PDF') and b'/Subtype /Image' not in report.content
    snapshot_record = api.core.operations_store.run(lambda u: records._snapshot(u, u.get('contract_projects', 'project-one'), u.get('contract_project_records', 'project-one')))
    assert snapshot_record['progress'][0]['evidence'][0]['kind'] == 'video'
    revoked = api.put(BASE + '/public-progress', headers=auth(), json=dict(request_id=str(uuid.uuid4()), expected_version=consent.json()['version'], enabled=False))
    assert revoked.status_code == 200 and api.get(media).status_code == 404


def test_multi_year_daily_history_exceeds_one_hundred_without_truncated_reports(api, gateway):
    count = 1100  # More than three years of daily progress, with a one-year deal.
    now = time.time()
    def seed_history(u):
        project = u.get('contract_projects', 'project-one')
        project['ends_at'] = project['starts_at'] + 366 * 86400
        project['team'][0]['responded_at'] = now - 10
        u.put('contract_projects', project['id'], project)
        ledger = records._ledger(u, project)
        ledger['progress_count'] = count
        u.put('contract_project_records', project['id'], ledger)
        for index in range(count):
            key = 'daily-' + str(index).zfill(5)
            u.put('contract_progress', key, dict(id=key, project_id=project['id'], percent=index % 101,
                  note='Recorded daily circuit inspection ' + str(index), evidence=[], milestone_id=None,
                  status='reported', source='contractor_reported', created_at=now - (count-index) * 86400, actor_id='contractor'))
    api.core.operations_store.run(seed_history)
    current = snapshot(api, 'contractor')
    assert len(current['progress']) == count and current['team'][0]['accepted_at'] == now - 10
    added = api.post(BASE + '/progress', headers=auth('contractor'), json=dict(request_id=str(uuid.uuid4()), expected_version=current['version'],
                     percent=80, note='Recorded the next daily progress entry after three years of reports'))
    assert added.status_code == 200 and len(added.json()['progress']) == count + 1
    record = api.core.operations_store.run(lambda u: records._snapshot(u, u.get('contract_projects', 'project-one'), u.get('contract_project_records', 'project-one')))
    assert len(record['progress']) == count + 1
    assert record['progress'][0]['id'] == 'daily-00000' and record['progress'][-1]['note'].startswith('Recorded the next')
    exported = api.get(BASE + '/report.pdf', headers=auth())
    assert exported.status_code == 200 and exported.content.startswith(b'%PDF')
    assert records.MAX_ATTACHMENTS >= 366 * 2 and records.LIMIT >= 2000


def test_large_payment_report_is_bounded_and_hydrates_immutable_history(api, gateway):
    count = 2500
    now = time.time()
    original_note = 'Detailed contractor observation. ' * 60
    assert len(original_note) <= 2000
    def seed_history(u):
        project = u.get('contract_projects', 'project-one')
        ledger = records._ledger(u, project); ledger['progress_count'] = count
        u.put('contract_project_records', project['id'], ledger)
        for index in range(count):
            key = 'daily-' + str(index).zfill(5)
            u.put('contract_progress', key, dict(id=key, project_id=project['id'], percent=index % 101,
                  note=original_note, evidence=[], milestone_id='m' * 100, public_share_consent=False,
                  status='reported', source='contractor_reported', created_at=now - (count-index)*86400, actor_id='contractor'))
    api.core.operations_store.run(seed_history)
    _, row, _ = request(api, 10000); approve(api, row)
    captured, _ = capture(api, row, gateway)
    assert captured.status_code == 200, captured.text
    reports, pages = api.core.operations_store.run(lambda u: (u.all('contract_reports'), u.all('contract_report_pages')))
    assert len(reports) == 1 and pages
    saved = reports[0]
    assert records._json_bytes(saved) <= records.REPORT_DOCUMENT_BYTES
    assert all(records._json_bytes(page) <= records.REPORT_DOCUMENT_BYTES for page in pages)
    assert records._json_bytes(saved) + sum(records._json_bytes(page) for page in pages) <= records.REPORT_TRANSACTION_BYTES
    complete = api.core.operations_store.run(lambda u: records._load_report(u, saved))
    assert len(complete['progress']) == count and complete['progress'][0]['note'] == original_note
    assert complete['financials']['confirmed_paid_paise'] == 10000
    assert records._json_bytes(complete) > 1024 * 1024
    # Review updates preserve the original report's status and immutable content.
    def review_entry(u):
        source = u.get('contract_progress', 'daily-00000'); source['status'] = 'customer_confirmed'
        u.put('contract_progress', source['id'], source)
    api.core.operations_store.run(review_entry)
    complete = api.core.operations_store.run(lambda u: records._load_report(u, saved))
    assert complete['progress'][0]['status'] == 'reported'
    def corrupt_original_content(u):
        source = u.get('contract_progress', 'daily-00000'); source['note'] = 'Unexpected changed original evidence'
        u.put('contract_progress', source['id'], source)
    api.core.operations_store.run(corrupt_original_content)
    with pytest.raises(HTTPException) as error:
        api.core.operations_store.run(lambda u: records._load_report(u, saved))
    assert error.value.status_code == 503


def test_shared_signed_webhook_fetches_provider_truth_refunds_and_replays(operations_api, gateway, monkeypatch):
    import integrations
    import main
    now = time.time()
    def seed(u):
        u.put('workers', 'worker', dict(id='worker', status='approved', contractor_verified=True))
        u.put('rp_members', 'worker', dict(id='worker', createdAt=int(now * 1000)))
        u.put('contract_tenders', 'tender-hook', dict(id='tender-hook', owner_id='shop', status='awarded', winning_project_id='project-hook', winning_bid_id='bid-hook',
            bids=[dict(id='bid-hook', contractor_id='worker', project_id='project-hook', status='awarded', amount_paise=100000)]))
        u.put('contract_projects', 'project-hook', dict(id='project-hook', owner_id='worker', client_id='shop', title='Provider webhook contract', scope='Recorded customer accepted work',
            site='Private work site', starts_at=now - 100, ends_at=now + 86400, status='active', awarded_at=now, tender_id='tender-hook', contract_value_paise=100000, team=[], goals=[], attendance=[], events=[], version=1))
    main.operations_store.run(seed)
    root = '/operations/contracts/projects/project-hook'
    requested = operations_api.post(root + '/payments', headers=auth('worker'), json=dict(request_id=str(uuid.uuid4()), expected_version=1, amount_paise=80000, method='gateway'))
    assert requested.status_code == 200, requested.text
    row = requested.json()['payments'][0]
    approved = operations_api.post(root + '/payments/' + row['id'] + '/approve', headers=auth('shop'), json=dict(request_id=str(uuid.uuid4()), expected_version=requested.json()['version'], approved=True))
    assert approved.status_code == 200
    order = operations_api.post(root + '/payments/' + row['id'] + '/order', headers=auth('shop')).json()
    payment = dict(id='pay_webhookfixture', order_id=order['order_id'], amount=80000, currency='INR', status='authorized', captured=False, amount_refunded=0)
    gateway['payments'][payment['id']] = payment
    monkeypatch.setattr(integrations, 'razorpay', records.razorpay)
    def send(entity):
        raw = json.dumps(dict(payload=dict(payment=dict(entity=entity)))).encode()
        signature = hmac.new(b'fixture', raw, hashlib.sha256).hexdigest()
        return operations_api.post('/operations/webhooks/razorpay/payments', content=raw, headers={'X-Razorpay-Signature': signature})
    assert send({**payment, 'status': 'captured', 'captured': True}).status_code == 200
    # The signed event entity is not capture proof; the fresh provider GET wins.
    main.integrations_reconcile()
    pending = operations_api.get(root + '/records', headers=auth('shop')).json()
    assert pending['financials']['confirmed_paid_paise'] == 0 and pending['financials']['pending_reserved_paise'] == 80000
    payment.update(status='captured', captured=True)
    assert send({**payment, 'event_nonce': 'capture-after-provider'}).status_code == 200
    main.integrations_reconcile()
    paid = operations_api.get(root + '/records', headers=auth('shop')).json()
    assert paid['financials']['confirmed_paid_paise'] == 80000 and paid['financials']['pending_reserved_paise'] == 0
    assert send({**payment, 'event_nonce': 'capture-after-provider'}).status_code == 200
    main.integrations_reconcile()
    assert operations_api.get(root + '/records', headers=auth('shop')).json()['version'] == paid['version']
    payment.update(status='refunded', amount_refunded=80000)
    assert send(payment).status_code == 200
    main.integrations_reconcile()
    refunded = operations_api.get(root + '/records', headers=auth('shop')).json()
    assert refunded['financials']['confirmed_paid_paise'] == refunded['financials']['pending_reserved_paise'] == 0
    assert refunded['payments'][0]['status'] == 'refunded'
    assert len(main.operations_store.run(lambda u: u.all('contract_reports'))) == 2


def purchase_body(api, **changes):
    return dict(request_id=str(uuid.uuid4()), expected_version=snapshot(api, 'contractor')['version'],
                title='Electrical cable', vendor='Recorded supplier', amount_paise=25000,
                purchased_at=int(time.time()) - 60, receipt_reference='INV-EXAMPLE-1', note='For the recorded wiring milestone', **changes)


def test_purchase_log_is_private_scoped_idempotent_and_does_not_change_the_price(api):
    body = purchase_body(api)
    before = snapshot(api)['financials']
    for actor in ('customer', 'teammate', 'stranger'):
        assert api.post(BASE + '/purchases', headers=auth(actor), json=body).status_code == (403 if actor == 'customer' else 404)
    created = api.post(BASE + '/purchases', headers=auth('contractor'), json=body)
    assert created.status_code == 200, created.text
    result = created.json(); row = result['purchases'][0]
    assert row['status'] == 'reported' and not row['actions']['can_review']
    assert result['financials'] == before
    repeated = api.post(BASE + '/purchases', headers=auth('contractor'), json=body)
    assert repeated.status_code == 200 and repeated.json()['version'] == result['version']
    assert len(repeated.json()['purchases']) == 1
    changed = {**body, 'amount_paise':30000}
    assert api.post(BASE + '/purchases', headers=auth('contractor'), json=changed).status_code == 409
    assert api.get(BASE + '/records', headers=auth('stranger')).status_code == 404
    customer = snapshot(api)
    assert customer['purchases'][0]['actions']['can_review']
    assert not customer['actions']['can_record_purchase']


def test_purchase_review_uses_current_version_and_never_approves_an_extra_charge(api, gateway):
    added = api.post(BASE + '/purchases', headers=auth('contractor'), json=purchase_body(api))
    row = added.json()['purchases'][0]
    before = snapshot(api)['financials']
    review = dict(request_id=str(uuid.uuid4()), expected_version=added.json()['version'], approved=True, note='Receipt checked')
    assert api.post(BASE + '/purchases/' + row['id'] + '/review', headers=auth('contractor'), json=review).status_code == 403
    stale = {**review, 'expected_version':1}
    assert api.post(BASE + '/purchases/' + row['id'] + '/review', headers=auth(), json=stale).status_code == 409
    reviewed = api.post(BASE + '/purchases/' + row['id'] + '/review', headers=auth(), json=review)
    assert reviewed.status_code == 200, reviewed.text
    assert reviewed.json()['purchases'][0]['status'] == 'customer_confirmed'
    assert reviewed.json()['financials'] == before
    assert api.post(BASE + '/purchases/' + row['id'] + '/review', headers=auth(), json=review).json()['version'] == reviewed.json()['version']
    assert api.post(BASE + '/purchases/' + row['id'] + '/review', headers=auth(), json={**review,'request_id':str(uuid.uuid4()),'expected_version':reviewed.json()['version']}).status_code == 409
    # Purchases do not expand the canonical customer payment ceiling.
    _, _, _ = request(api, 100000)
    blocked = api.post(BASE + '/payments', headers=auth('contractor'), json=dict(request_id=str(uuid.uuid4()), expected_version=snapshot(api)['version'], amount_paise=1, method='gateway'))
    assert blocked.status_code == 409 and blocked.json()['detail']['code'] == 'DEAL_CEILING'


def test_purchase_validation_and_evidence_cannot_cross_projects_or_purposes(api):
    body = purchase_body(api)
    for changes in ({'purchased_at':int(time.time())+86400},{'amount_paise':-1},{'amount_paise':1.1},{'receipt_reference':'   '},{'evidence_ids':['not-authorized']}):
        response = api.post(BASE + '/purchases', headers=auth('contractor'), json={**body, **changes})
        assert response.status_code == 422, response.text
    def seed(u):
        u.put('contract_attachments','other-receipt',dict(id='other-receipt',project_id='another-project',uploaded_by='contractor',purpose='purchase',status='ready',mime='image/png'))
        u.put('contract_attachments','bank-proof',dict(id='bank-proof',project_id='project-one',uploaded_by='contractor',purpose='payment',status='ready',mime='image/png'))
        u.put('contract_purchases','other-purchase',dict(id='other-purchase',project_id='another-project',status='reported'))
    api.core.operations_store.run(seed)
    for evidence in ('other-receipt','bank-proof'):
        assert api.post(BASE + '/purchases', headers=auth('contractor'), json={**body,'evidence_ids':[evidence]}).status_code == 422
    review = dict(request_id=str(uuid.uuid4()),expected_version=1,approved=True)
    assert api.post(BASE + '/purchases/other-purchase/review', headers=auth(), json=review).status_code == 409
    assert not snapshot(api)['purchases']


def test_actual_purchase_receipts_and_calendar_records_are_in_private_reports(api):
    image = io.BytesIO(); Image.new('RGB',(10,10),'blue').save(image,format='PNG')
    upload = api.post(BASE + '/attachments?purpose=purchase',headers={**auth('contractor'),'Content-Type':'image/png'},content=image.getvalue())
    assert upload.status_code == 200, upload.text
    assert api.post(BASE + '/attachments?purpose=purchase&share_public=true',headers={**auth('contractor'),'Content-Type':'image/png'},content=image.getvalue()).status_code == 422
    body = purchase_body(api); body['evidence_ids']=[upload.json()['id']]
    added = api.post(BASE + '/purchases',headers=auth('contractor'),json=body)
    assert added.status_code == 200, added.text
    def seed(u):
        p=u.get('contract_projects','project-one');p['attendance']=[dict(worker_id='teammate',in_at=1000,out_at=2000,source='member_reported',private_lat=20)];p['events']=[dict(action='goal_submitted',at=3000,note='Inspection submitted')];u.put('contract_projects',p['id'],p)
    api.core.operations_store.run(seed)
    current=snapshot(api);assert current['attendance'][0]['in_at']==1000 and 'private_lat' not in str(current['attendance'])
    assert current['timeline'][0]['note']=='Inspection submitted'
    record=api.core.operations_store.run(lambda u:records._snapshot(u,u.get('contract_projects','project-one'),u.get('contract_project_records','project-one')))
    assert record['purchases'][0]['receipt_reference']=='INV-EXAMPLE-1'
    pdf=api.get(BASE+'/report.pdf',headers=auth());assert pdf.status_code==200 and pdf.content.startswith(b'%PDF')
    assert api.get(BASE+'/report.pdf',headers=auth('teammate')).status_code==404
