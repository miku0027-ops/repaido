"""Gateway-boundary tests: fake provider only, never external orders or charges."""
import copy
import hashlib
import hmac
import json
import time
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException
import main
import integrations
import repaidians_billing as billing
from test_operations import api, auth


@pytest.fixture
def gateway(api, monkeypatch):
    monkeypatch.setenv('REPAIDO_PAYMENTS_ENABLED', 'true')
    monkeypatch.setenv('RAZORPAY_KEY_ID', 'rzp_test_fixture')
    monkeypatch.setenv('RAZORPAY_KEY_SECRET', 'fixture-secret')
    monkeypatch.setenv('RAZORPAY_WEBHOOK_SECRET', 'fixture-webhook')
    # Existing members whose one-time free trial has expired isolate paid-flow tests.
    stamp = int((time.time() - 90 * 86400) * 1000)
    def members(u):
        for uid in ('customer', 'stranger', 'worker'):
            u.put('rp_members', uid, {'id': uid, 'createdAt': stamp})
    main.operations_store.run(members)
    state = dict(orders=[], payments={}, creates=0, unknown=False, requests=[])

    def request(path, body=None):
        state['requests'].append(path)
        if path == 'orders' and body:
            state['creates'] += 1
            row = {**copy.deepcopy(body), 'id': 'order_' + str(state['creates'])}
            state['orders'].append(row)
            if state['unknown']:
                raise RuntimeError('Fixture timeout after creating order')
            return copy.deepcopy(row)
        if path.startswith('orders?receipt='):
            return {'items': [copy.deepcopy(o) for o in state['orders'] if o['receipt'] == path.split('=', 1)[1]]}
        if path.startswith('orders/') and path.endswith('/payments'):
            return {'items': [copy.deepcopy(p) for p in state['payments'].values() if p.get('order_id') == path.split('/')[1]]}
        if path.startswith('payments/'):
            return copy.deepcopy(state['payments'][path.split('/')[1]])
        raise AssertionError(path)
    monkeypatch.setattr(billing, 'razorpay', request)
    return state


def order(api, uid='customer'):
    response = api.post('/repaidians/subscription/order', headers=auth(uid))
    assert response.status_code == 200, response.text
    row = response.json()
    assert row['amount'] == 19900 and row['currency'] == 'INR'
    return row


def payment(gateway, row, **changes):
    data = dict(id='pay_' + str(gateway['creates']), order_id=row['order_id'],
                amount=19900, currency='INR', status='captured', captured=True, amount_refunded=0)
    data.update(changes)
    gateway['payments'][data['id']] = data
    return data


def check(api, uid='customer', **body):
    response = api.post('/repaidians/subscription/check', headers=auth(uid), json=body)
    assert response.status_code == 200, response.text
    return response.json()


def signed_hook(api, pid, path='/repaidians/webhooks/razorpay', **claims):
    body = json.dumps({'event': 'payment.captured', 'payload': {'payment': {'entity': {'id': pid, **claims}}}}).encode()
    signature = hmac.new(b'fixture-webhook', body, hashlib.sha256).hexdigest()
    return api.post(path, content=body, headers={'X-Razorpay-Signature': signature, 'Content-Type': 'application/json'})


def test_auth_no_key_readiness_and_no_client_entitlement(api, gateway, monkeypatch):
    assert api.get('/repaidians/subscription').status_code == 401
    assert api.post('/repaidians/subscription/order').status_code == 401
    assert api.post('/repaidians/subscription/check').status_code == 401
    state = api.get('/repaidians/subscription', headers=auth('customer')).json()
    assert state['paymentsReady'] and not state['active'] and state['subscription'] is None
    assert api.post('/repaidians/subscription/order', headers=auth('customer'), json={'active': True}).status_code == 422
    assert api.post('/repaidians/subscription/check', headers=auth('customer'), json={'razorpay_signature': 'fake', 'plan': 'pro'}).status_code == 422
    monkeypatch.delenv('RAZORPAY_KEY_SECRET')
    assert not api.get('/repaidians/subscription', headers=auth('customer')).json()['paymentsReady']
    assert api.post('/repaidians/subscription/order', headers=auth('customer')).status_code == 503
    assert gateway['creates'] == 0


def test_pending_order_reuse_unknown_outcome_and_duplicate_receipt(api, gateway):
    gateway['unknown'] = True
    with pytest.raises(RuntimeError):
        api.post('/repaidians/subscription/order', headers=auth('customer'))
    gateway['unknown'] = False
    first = order(api)
    assert order(api)['order_id'] == first['order_id']
    assert gateway['creates'] == 1
    gateway['orders'].append({**gateway['orders'][0], 'id': 'order_duplicate'})
    main.operations_store.run(lambda u: u.put('rp_payments', first['attempt_id'],
        {k: v for k, v in u.get('rp_payments', first['attempt_id']).items() if k != 'orderId'}))
    assert api.post('/repaidians/subscription/order', headers=auth('customer')).status_code == 503
    assert gateway['creates'] == 1


@pytest.mark.parametrize('changes', [
    {'amount': 1}, {'currency': 'USD'}, {'order_id': 'order_wrong'}, {'id': 'untrusted-id'},
])
def test_provider_validation_before_entitlement(api, gateway, changes):
    row = order(api)
    p = payment(gateway, row, **changes)
    # A signed delivery still cannot make an invalid provider payment valid.
    if changes.get('id'):
        assert signed_hook(api, p['id']).json()['status'] == 'ignored'
    elif changes.get('order_id'):
        assert signed_hook(api, p['id']).json()['status'] == 'ignored'
    else:
        assert signed_hook(api, p['id']).status_code == 409
        assert api.post('/repaidians/subscription/check', headers=auth('customer')).status_code == 409
    assert not api.get('/repaidians/subscription', headers=auth('customer')).json()['active']


def test_authorization_is_not_capture_failed_retry_and_duplicate_payment(api, gateway):
    row = order(api)
    p = payment(gateway, row, status='authorized', captured=False)
    assert api.post('/repaidians/subscription/check', headers=auth('customer')).status_code == 409
    assert not api.get('/repaidians/subscription', headers=auth('customer')).json()['active']
    p.update(status='failed')
    assert not check(api)['active']
    captured = payment(gateway, row, id='pay_retry')
    first = check(api)
    assert first['active']
    assert check(api)['subscription'] == first['subscription']
    payment(gateway, row, id='pay_second')
    assert api.post('/repaidians/subscription/check', headers=auth('customer')).status_code == 409
    assert api.get('/repaidians/subscription', headers=auth('customer')).json()['subscription'] == first['subscription']
    assert 'payments/' + captured['id'] in gateway['requests']


def test_subscription_capture_ms_dates_account_isolation_and_check_ownership(api, gateway):
    row = order(api)
    payment(gateway, row)
    data = check(api)
    assert data['active'] and data['paymentStatus'] == 'captured'
    assert data['subscription']['plan'] == 'pro'
    assert data['subscription']['amountPaise'] == 19900
    assert data['subscription']['provider'] == 'razorpay'
    assert data['subscription']['startsAt'] > 1_000_000_000_000
    assert not api.get('/repaidians/subscription', headers=auth('stranger')).json()['active']
    assert api.post('/repaidians/subscription/check', headers=auth('stranger'), json={'attempt_id': row['attempt_id']}).status_code == 404
    assert check(api)['subscription'] == data['subscription']


def test_webhook_signature_bounds_provider_authority_refunds_and_stale_capture(api, gateway):
    row = order(api)
    p = payment(gateway, row, status='authorized', captured=False)
    forged = api.post('/repaidians/webhooks/razorpay', content=b'{}', headers={'X-Razorpay-Signature': 'f' * 64})
    assert forged.status_code == 401
    large = api.post('/repaidians/webhooks/razorpay', content=b'x' * (billing.MAX_WEBHOOK_BYTES + 1))
    assert large.status_code == 413
    assert signed_hook(api, p['id'], status='captured', captured=True).status_code == 200
    assert not api.get('/repaidians/subscription', headers=auth('customer')).json()['active']
    p.update(status='captured', captured=True)
    assert signed_hook(api, p['id'], amount=1).status_code == 200
    first = api.get('/repaidians/subscription', headers=auth('customer')).json()
    assert first['active']
    assert signed_hook(api, p['id']).status_code == 200
    assert check(api)['subscription'] == first['subscription']
    p.update(status='refunded', amount_refunded=19900)
    assert signed_hook(api, p['id'], status='captured').status_code == 200
    assert not check(api)['active']
    p.update(status='captured', amount_refunded=0)
    assert signed_hook(api, p['id']).status_code == 200
    assert not check(api)['active']
    attempt = main.operations_store.run(lambda u: u.get('rp_payments', row['attempt_id']))
    assert attempt['status'] == 'refunded' and attempt['amountRefunded'] == 19900


def test_refund_before_capture_and_partial_refund_are_monotonic(api, gateway):
    row = order(api)
    p = payment(gateway, row, status='refunded', amount_refunded=19900)
    assert not check(api)['active']
    p.update(status='captured', captured=True, amount_refunded=0)
    assert not check(api)['active']
    renewed = order(api)
    newer = payment(gateway, renewed)
    assert check(api)['active']
    newer['amount_refunded'] = 1
    assert not check(api)['active']
    newer['amount_refunded'] = 0
    assert not check(api)['active']


@pytest.mark.parametrize('changes', [
    {'amount_refunded': -1}, {'amount_refunded': 19901}, {'amount_refunded': True},
    {'amount_refunded': 1.5}, {'amount_refunded': '1'}, {'status': 'refunded', 'amount_refunded': 0},
    {'amount': 19900.0},
])
def test_invalid_provider_financial_fields_never_grant_membership(api, gateway, changes):
    row = order(api)
    payment(gateway, row, **changes)
    assert api.post('/repaidians/subscription/check', headers=auth('customer')).status_code == 409
    assert not api.get('/repaidians/subscription', headers=auth('customer')).json()['active']


def test_payment_replay_cannot_cross_account_or_other_purchase(api, gateway):
    first = order(api)
    p = payment(gateway, first)
    assert check(api)['active']
    second = order(api, 'stranger')
    payment(gateway, second, id=p['id'])
    assert api.post('/repaidians/subscription/check', headers=auth('stranger')).status_code == 409
    assert not api.get('/repaidians/subscription', headers=auth('stranger')).json()['active']
    other = order(api, 'worker')
    payment(gateway, other, id='pay_otherpurchase')
    main.operations_store.run(lambda u: u.put('receipts', 'pay_otherpurchase',
        dict(id='pay_otherpurchase', prime_attempt_id='prior-shop-purchase', shop_id='shop1')))
    assert api.post('/repaidians/subscription/check', headers=auth('worker')).status_code == 409
    assert not api.get('/repaidians/subscription', headers=auth('worker')).json()['active']


def test_unrelated_provider_payment_is_ignored_without_mutation(api, gateway):
    payment(gateway, {'order_id': 'order_booking'}, id='pay_booking')
    before = main.operations_store.run(lambda u: (u.all('rp_payments'), u.all('receipts')))
    assert signed_hook(api, 'pay_booking').json() == {'status': 'ignored'}
    after = main.operations_store.run(lambda u: (u.all('rp_payments'), u.all('receipts')))
    assert before == after


def test_shared_provider_dispatch_uses_same_authoritative_receipt_guard(api, gateway):
    row = order(api)
    p = payment(gateway, row)
    result = main.operations_store.run(lambda u: billing.apply_provider_payment(u, p))
    assert result['status'] == 'captured'
    assert api.get('/repaidians/subscription', headers=auth('customer')).json()['active']
    assert main.operations_store.run(lambda u: billing.apply_provider_payment(u, {**p, 'order_id': 'order_other'})) is None


def test_existing_standard_webhook_reconciles_community_capture_and_refund(api, gateway, monkeypatch):
    monkeypatch.setattr(integrations, 'razorpay', billing.razorpay)
    row = order(api)
    p = payment(gateway, row)
    endpoint = '/operations/webhooks/razorpay/payments'
    assert signed_hook(api, p['id'], path=endpoint, status='authorized').status_code == 200
    result = main.integrations_reconcile()
    assert result['errors'] == 0
    assert api.get('/repaidians/subscription', headers=auth('customer')).json()['active']
    p.update(status='refunded', amount_refunded=19900)
    assert signed_hook(api, p['id'], path=endpoint, status='captured').status_code == 200
    assert main.integrations_reconcile()['errors'] == 0
    assert not api.get('/repaidians/subscription', headers=auth('customer')).json()['active']
    p.update(status='captured', amount_refunded=0)
    assert signed_hook(api, p['id'], path=endpoint, status='captured', fixture_sequence=3).status_code == 200
    assert main.integrations_reconcile()['errors'] == 0
    assert not api.get('/repaidians/subscription', headers=auth('customer')).json()['active']


def test_advance_renewal_is_bounded_before_creating_another_charge(api, gateway, monkeypatch):
    frozen = datetime(2027, 1, 15, 12, tzinfo=ZoneInfo('Asia/Kolkata')).timestamp()
    monkeypatch.setattr(billing.time, 'time', lambda: frozen)
    for _ in range(billing.MAX_PREPAID_PERIODS):
        row = order(api)
        payment(gateway, row)
        assert check(api)['active']
    creates = gateway['creates']
    response = api.post('/repaidians/subscription/order', headers=auth('customer'))
    assert response.status_code == 409 and response.json()['detail']['code'] == 'RENEWAL_TOO_EARLY'
    assert gateway['creates'] == creates == billing.MAX_PREPAID_PERIODS


def test_early_renewal_calendar_clamp_expiry_and_refund_preserves_other_month(api, gateway, monkeypatch):
    zone = ZoneInfo('Asia/Kolkata')
    clock = [datetime(2027, 1, 31, 12, tzinfo=zone).timestamp()]
    monkeypatch.setattr(billing.time, 'time', lambda: clock[0])
    first = order(api)
    p = payment(gateway, first)
    state = check(api)
    original_end = state['subscription']['endsAt']
    assert datetime.fromtimestamp(original_end / 1000, zone).isoformat().startswith('2027-02-28T12:00')
    clock[0] = datetime(2027, 2, 20, 12, tzinfo=zone).timestamp()
    second = order(api)
    p2 = payment(gateway, second)
    renewed = check(api)
    assert renewed['subscription']['startsAt'] == state['subscription']['startsAt']
    assert datetime.fromtimestamp(renewed['subscription']['endsAt'] / 1000, zone).isoformat().startswith('2027-03-28T12:00')
    assert check(api)['subscription'] == renewed['subscription']
    # Refund the renewal while the first paid month is still valid.
    p2.update(status='refunded', amount_refunded=19900)
    assert signed_hook(api, p2['id']).status_code == 200
    kept = check(api)
    assert kept['active'] and kept['subscription']['endsAt'] == original_end
    clock[0] = original_end / 1000
    assert not api.get('/repaidians/subscription', headers=auth('customer')).json()['active']
    # An expired capture event never manufactures another month.
    assert signed_hook(api, p['id']).status_code == 200
    assert not api.get('/repaidians/subscription', headers=auth('customer')).json()['active']


def test_refunding_prior_month_does_not_revoke_paid_future_renewal(api, gateway, monkeypatch):
    zone = ZoneInfo('Asia/Kolkata')
    clock = [datetime(2028, 1, 31, 12, tzinfo=zone).timestamp()]
    monkeypatch.setattr(billing.time, 'time', lambda: clock[0])
    first = order(api)
    p = payment(gateway, first)
    original = check(api)
    assert datetime.fromtimestamp(original['subscription']['endsAt'] / 1000, zone).day == 29
    second = order(api)
    payment(gateway, second)
    final = check(api)['subscription']['endsAt']
    p.update(status='refunded', amount_refunded=19900)
    assert signed_hook(api, p['id']).status_code == 200
    assert not api.get('/repaidians/subscription', headers=auth('customer')).json()['active']
    clock[0] = original['subscription']['endsAt'] / 1000
    state = api.get('/repaidians/subscription', headers=auth('customer')).json()
    assert state['active'] and state['subscription']['endsAt'] == final


def test_passive_state_transitions_across_refunded_gap_without_gateway_calls(api, gateway, monkeypatch):
    zone = ZoneInfo('Asia/Kolkata')
    clock = [datetime(2027, 1, 31, 12, tzinfo=zone).timestamp()]
    monkeypatch.setattr(billing.time, 'time', lambda: clock[0])
    first = order(api)
    payment(gateway, first)
    initial = check(api)['subscription']
    middle = order(api)
    middle_payment = payment(gateway, middle)
    middle_end = check(api)['subscription']['endsAt']
    last = order(api)
    payment(gateway, last)
    last_end = check(api)['subscription']['endsAt']
    middle_payment.update(status='refunded', amount_refunded=19900)
    assert signed_hook(api, middle_payment['id']).status_code == 200
    assert api.get('/repaidians/subscription', headers=auth('customer')).json()['subscription']['endsAt'] == initial['endsAt']
    clock[0] = initial['endsAt'] / 1000
    assert not api.get('/repaidians/subscription', headers=auth('customer')).json()['active']
    before = len(gateway['requests'])
    clock[0] = middle_end / 1000
    state = api.get('/repaidians/subscription', headers=auth('customer')).json()
    assert state['active'] and state['subscription']['endsAt'] == last_end
    assert len(gateway['requests']) == before


def test_trial_requires_join_and_is_immutable_once_per_uid(api, gateway, monkeypatch):
    clock = [datetime(2027, 1, 15, 12, tzinfo=ZoneInfo('Asia/Kolkata')).timestamp()]
    monkeypatch.setattr(billing.time, 'time', lambda: clock[0])
    with main.db() as c:
        c.execute("DELETE FROM operation_records WHERE kind IN ('rp_members', 'rp_trials')")
    before = api.get('/repaidians/subscription', headers=auth('customer')).json()
    assert not before['active'] and before['trial'] is None
    rejected = api.post('/repaidians/subscription/order', headers=auth('customer'))
    assert rejected.status_code == 403 and rejected.json()['detail']['code'] == 'MEMBER_REQUIRED'
    assert gateway['creates'] == 0 and gateway['requests'] == []
    assert main.operations_store.run(lambda u: billing.ensure_trial(u, 'customer')) is None
    assert main.operations_store.run(lambda u: u.get('rp_trials', 'customer')) is None
    stamp = int(clock[0] * 1000)

    def join(u):
        u.put('rp_members', 'customer', {'id': 'customer', 'createdAt': stamp})
        return billing.ensure_trial(u, 'customer', starts_at=stamp)
    trial = main.operations_store.run(join)
    assert trial == {'startsAt': stamp, 'endsAt': stamp + 60 * 86400 * 1000, 'status': 'active'}
    state = api.get('/repaidians/subscription', headers=auth('customer')).json()
    assert state['active'] and state['trial'] == trial
    assert state['subscription'] == {'plan': 'trial', 'provider': 'trial', 'amountPaise': 0,
                                      'startsAt': stamp, 'endsAt': trial['endsAt']}
    stored = main.operations_store.run(lambda u: u.get('rp_trials', 'customer'))
    clock[0] += 70 * 86400

    def rejoin(u):
        u.put('rp_members', 'customer', {'id': 'customer', 'createdAt': int(clock[0] * 1000)})
        return billing.ensure_trial(u, 'customer', starts_at=int(clock[0] * 1000))
    assert main.operations_store.run(rejoin)['status'] == 'expired'
    assert main.operations_store.run(lambda u: u.get('rp_trials', 'customer')) == stored
    assert not api.get('/repaidians/subscription', headers=auth('customer')).json()['active']
    assert main.operations_store.run(lambda u: (u.all('rp_payments'), u.all('receipts'))) == ([], [])
    assert gateway['creates'] == 0
    assert api.get('/repaidians/subscription', headers=auth('stranger')).json()['trial'] is None


@pytest.mark.parametrize('offset_ms,active', [(-1, False), (0, True), (60 * 86400 * 1000 - 1, True), (60 * 86400 * 1000, False)])
def test_trial_uses_exact_server_time_boundary(api, gateway, monkeypatch, offset_ms, active):
    stamp = 1800000000000
    clock = (stamp + offset_ms) / 1000
    monkeypatch.setattr(billing.time, 'time', lambda: clock)
    main.operations_store.run(lambda u: u.put('rp_members', 'customer', {'id': 'customer', 'createdAt': stamp}))
    state = api.get('/repaidians/subscription', headers=auth('customer')).json()
    assert state['active'] is active
    assert state['serverNow'] == stamp + offset_ms
    assert state['trial'] == {'startsAt': stamp, 'endsAt': stamp + billing.TRIAL_MS, 'status': 'active' if active else 'expired'}
    assert (state['subscription'] or {}).get('plan') == ('trial' if active else None)
    assert gateway['creates'] == 0


def test_trial_backfill_preserves_original_join_date_even_when_expired(api, gateway, monkeypatch):
    stamp = 1800000000000
    clock = [stamp / 1000 + 75 * 86400]
    monkeypatch.setattr(billing.time, 'time', lambda: clock[0])
    main.operations_store.run(lambda u: u.put('rp_members', 'customer', {'id': 'customer', 'createdAt': stamp}))
    state = api.get('/repaidians/subscription', headers=auth('customer')).json()
    assert not state['active'] and state['subscription'] is None
    assert state['trial'] == {'startsAt': stamp, 'endsAt': stamp + billing.TRIAL_MS, 'status': 'expired'}
    clock[0] += 100 * 86400
    assert api.get('/repaidians/subscription', headers=auth('customer')).json()['trial'] == state['trial']
    assert main.operations_store.run(lambda u: u.all('rp_payments')) == []


def test_paid_capture_during_trial_preserves_free_days_then_activates_paid_month(api, gateway, monkeypatch):
    clock = [datetime(2027, 1, 1, 12, tzinfo=ZoneInfo('Asia/Kolkata')).timestamp()]
    monkeypatch.setattr(billing.time, 'time', lambda: clock[0])
    stamp = int(clock[0] * 1000)
    main.operations_store.run(lambda u: u.put('rp_members', 'customer', {'id': 'customer', 'createdAt': stamp}))
    trial = api.get('/repaidians/subscription', headers=auth('customer')).json()['trial']
    clock[0] += 7 * 86400
    row = order(api)
    p = payment(gateway, row)
    state = check(api)
    assert state['paymentStatus'] == 'captured' and state['subscription']['plan'] == 'trial'
    attempt = main.operations_store.run(lambda u: u.get('rp_payments', row['attempt_id']))
    assert attempt['grantStartsAt'] == trial['endsAt']
    assert datetime.fromtimestamp(attempt['grantEndsAt'] / 1000, ZoneInfo('Asia/Kolkata')).isoformat().startswith('2027-04-02T12:00')
    assert signed_hook(api, p['id']).status_code == 200
    assert main.operations_store.run(lambda u: u.get('rp_payments', row['attempt_id']))['grantEndsAt'] == attempt['grantEndsAt']
    clock[0] = trial['endsAt'] / 1000 - .001
    assert api.get('/repaidians/subscription', headers=auth('customer')).json()['subscription']['plan'] == 'trial'
    clock[0] = trial['endsAt'] / 1000
    paid = api.get('/repaidians/subscription', headers=auth('customer')).json()
    assert paid['active'] and paid['subscription']['plan'] == 'pro'
    assert paid['subscription']['startsAt'] == trial['endsAt']
    assert paid['trial']['status'] == 'expired'
    clock[0] = attempt['grantEndsAt'] / 1000
    assert not api.get('/repaidians/subscription', headers=auth('customer')).json()['active']


def test_refund_does_not_erase_or_restart_remaining_trial(api, gateway, monkeypatch):
    clock = [1800000000.0]
    monkeypatch.setattr(billing.time, 'time', lambda: clock[0])
    main.operations_store.run(lambda u: u.put('rp_members', 'customer', {'id': 'customer', 'createdAt': int(clock[0] * 1000)}))
    initial = api.get('/repaidians/subscription', headers=auth('customer')).json()['trial']
    stored = main.operations_store.run(lambda u: u.get('rp_trials', 'customer'))
    row = order(api)
    p = payment(gateway, row)
    assert check(api)['subscription']['plan'] == 'trial'
    p.update(status='refunded', amount_refunded=19900)
    state = check(api)
    assert state['active'] and state['subscription']['plan'] == 'trial' and state['trial'] == initial
    assert state['paymentStatus'] == 'refunded'
    p.update(status='captured', amount_refunded=0)
    assert check(api)['subscription']['plan'] == 'trial'
    assert main.operations_store.run(lambda u: u.get('rp_trials', 'customer')) == stored
    clock[0] = initial['endsAt'] / 1000
    assert not api.get('/repaidians/subscription', headers=auth('customer')).json()['active']


def test_existing_paid_period_has_priority_and_trial_remains_independent(api, gateway, monkeypatch):
    clock = [1800000000.0]
    monkeypatch.setattr(billing.time, 'time', lambda: clock[0])
    row = order(api)
    p = payment(gateway, row)
    # Paid records from before the trial policy may already overlap a joining trial.
    starts = int(clock[0] * 1000)
    ends = int(billing.month_after(clock[0]) * 1000)
    def legacy_paid(u):
        attempt = u.get('rp_payments', row['attempt_id'])
        attempt.update(status='captured', paymentId=p['id'], grantStartsAt=starts, grantEndsAt=ends)
        u.put('rp_payments', attempt['id'], attempt)
        billing._save_grants(u, 'customer', [{'attemptId': attempt['id'], 'paymentId': p['id'], 'startsAt': starts, 'endsAt': ends}], clock[0])
        u.put('receipts', p['id'], {'id': p['id'], 'rpAttemptId': attempt['id'], 'userId': 'customer'})
    main.operations_store.run(legacy_paid)
    paid = {'plan': 'pro', 'provider': 'razorpay', 'amountPaise': 19900, 'startsAt': starts, 'endsAt': ends}
    clock[0] += 10 * 86400
    stamp = int(clock[0] * 1000)
    main.operations_store.run(lambda u: u.put('rp_members', 'customer', {'id': 'customer', 'createdAt': stamp}))
    combined = api.get('/repaidians/subscription', headers=auth('customer')).json()
    assert combined['subscription'] == paid and combined['trial']['status'] == 'active'
    p.update(status='refunded', amount_refunded=19900)
    fallback = check(api)
    assert fallback['active'] and fallback['subscription']['plan'] == 'trial'
    assert fallback['trial'] == combined['trial']
    assert main.operations_store.run(lambda u: u.get('rp_subscriptions', 'customer'))['status'] == 'refunded'


@pytest.mark.parametrize('days,active', [(20, True), (45, True), (60, False), (90, False)])
def test_known_launch_trial_extends_once_from_original_start(api, gateway, monkeypatch, days, active):
    stamp = 1800000000000
    clock = [stamp / 1000 + days * 86400]
    monkeypatch.setattr(billing.time, 'time', lambda: clock[0])
    old_trial = {'userId': 'customer', 'startsAt': stamp,
                 'endsAt': stamp + 30 * 86400000, 'policy': billing.LEGACY_TRIAL_POLICY}
    def legacy(u):
        # A changed community profile cannot restart the original grant.
        u.put('rp_members', 'customer', {'id': 'customer', 'createdAt': int(clock[0] * 1000)})
        u.put('rp_trials', 'customer', old_trial)
    main.operations_store.run(legacy)
    state = api.get('/repaidians/subscription', headers=auth('customer')).json()
    assert state['active'] is active
    assert state['trial'] == {'startsAt': stamp, 'endsAt': stamp + 60 * 86400000,
                             'status': 'active' if active else 'expired'}
    stored = main.operations_store.run(lambda u: u.get('rp_trials', 'customer'))
    assert stored == {**old_trial, 'endsAt': stamp + 60 * 86400000,
                      'policy': billing.TRIAL_POLICY, 'extendedFromPolicy': billing.LEGACY_TRIAL_POLICY}
    clock[0] += 365 * 86400
    state = api.get('/repaidians/subscription', headers=auth('customer')).json()
    assert not state['active'] and state['trial']['endsAt'] == stamp + 60 * 86400000
    assert main.operations_store.run(lambda u: u.get('rp_trials', 'customer')) == stored
    assert main.operations_store.run(lambda u: (u.all('rp_payments'), u.all('receipts'))) == ([], [])
    assert gateway['creates'] == 0 and gateway['requests'] == []


@pytest.mark.parametrize('changes', [
    {'policy': 'manual-reviewed-trial'}, {'endsAt': 1800000000001},
    {'startsAt': '1800000000000'}, {'endsAt': '1802592000000'},
])
def test_trial_extension_does_not_rewrite_unknown_or_malformed_grants(api, gateway, changes):
    row = {'userId': 'customer', 'startsAt': 1800000000000,
           'endsAt': 1800000000000 + 30 * 86400000, 'policy': billing.LEGACY_TRIAL_POLICY, **changes}
    # Malformed timestamps must never be treated as valid active access.
    main.operations_store.run(lambda u: u.put('rp_trials', 'customer', row))
    if isinstance(row['startsAt'], str) or isinstance(row['endsAt'], str):
        with pytest.raises(HTTPException) as rejected:
            main.operations_store.run(lambda u: billing.ensure_trial(u, 'customer', now=1800000000))
        assert rejected.value.detail['code'] == 'MEMBER_DATE_REQUIRED'
    else:
        main.operations_store.run(lambda u: billing.ensure_trial(u, 'customer', now=1800000000))
    assert main.operations_store.run(lambda u: u.get('rp_trials', 'customer')) == row


def test_trial_extension_preserves_captured_paid_duration_and_refund_rules(api, gateway, monkeypatch):
    clock = [1800000000.0]
    monkeypatch.setattr(billing.time, 'time', lambda: clock[0])
    stamp = int(clock[0] * 1000)
    old_end = stamp + 30 * 86400000
    def legacy_trial(u):
        u.put('rp_members', 'customer', {'id': 'customer', 'createdAt': stamp})
        # Model an already captured paid month that starts at the old trial end.
        u.put('rp_trials', 'customer', {'userId': 'customer', 'startsAt': stamp,
                                      'endsAt': old_end, 'policy': billing.LEGACY_TRIAL_POLICY})
    main.operations_store.run(legacy_trial)
    row = order(api)
    p = payment(gateway, row)
    def legacy_paid(u):
        attempt = u.get('rp_payments', row['attempt_id'])
        end = int(billing.month_after(old_end / 1000) * 1000)
        attempt.update(status='captured', paymentId=p['id'], grantStartsAt=old_end, grantEndsAt=end)
        u.put('rp_payments', attempt['id'], attempt)
        billing._save_grants(u, 'customer', [{'attemptId': attempt['id'], 'paymentId': p['id'],
                                            'startsAt': old_end, 'endsAt': end}], clock[0])
        u.put('receipts', p['id'], {'id': p['id'], 'rpAttemptId': attempt['id'], 'userId': 'customer'})
        return attempt, u.get('rp_subscriptions', 'customer'), u.get('receipts', p['id'])
    original_paid = main.operations_store.run(legacy_paid)
    clock[0] += 40 * 86400
    current = api.get('/repaidians/subscription', headers=auth('customer')).json()
    assert current['subscription']['plan'] == 'trial'
    assert current['trial']['status'] == 'active' and current['trial']['endsAt'] == stamp + billing.TRIAL_MS
    updated_paid = main.operations_store.run(lambda u: (u.get('rp_payments', row['attempt_id']),
        u.get('rp_subscriptions', 'customer'), u.get('receipts', p['id'])))
    delta = 30 * 86400000
    assert updated_paid[0] == {**original_paid[0], 'grantStartsAt': original_paid[0]['grantStartsAt'] + delta,
                             'grantEndsAt': original_paid[0]['grantEndsAt'] + delta}
    original_grant = original_paid[1]['grants'][0]
    assert updated_paid[1] == {**original_paid[1], 'startsAt': original_paid[1]['startsAt'] + delta,
                              'endsAt': original_paid[1]['endsAt'] + delta,
                              'grants': [{**original_grant, 'startsAt': original_grant['startsAt'] + delta,
                                          'endsAt': original_grant['endsAt'] + delta}]}
    assert updated_paid[2] == original_paid[2]
    assert signed_hook(api, p['id']).status_code == 200
    assert main.operations_store.run(lambda u: u.get('rp_subscriptions', 'customer')) == updated_paid[1]
    p.update(status='refunded', amount_refunded=19900)
    refunded = check(api)
    assert refunded['paymentStatus'] == 'refunded' and refunded['subscription']['plan'] == 'trial'
    assert refunded['trial']['endsAt'] == stamp + billing.TRIAL_MS
    clock[0] = (stamp + billing.TRIAL_MS) / 1000
    assert not api.get('/repaidians/subscription', headers=auth('customer')).json()['active']


@pytest.mark.parametrize('contractor,professional_type', [(False, 'agent'), (True, 'contractor')])
def test_membership_badge_uses_registered_role_and_live_entitlement(api, gateway, monkeypatch, contractor, professional_type):
    clock = [1800000000.0]
    monkeypatch.setattr(billing.time, 'time', lambda: clock[0])
    stamp = int(clock[0] * 1000)
    worker = {'id': 'customer', 'status': 'approved', 'role': 'specialist', 'contractor_verified': contractor}
    def setup(u):
        u.put('rp_members', 'customer', {'id': 'customer', 'createdAt': stamp,
                                      'professionalType': 'contractor' if not contractor else 'member'})
        u.put('workers', 'customer', worker)
        return billing.membership_badge(u, 'customer')
    badge = main.operations_store.run(setup)
    assert badge == {'label': 'Repaidian', 'kind': 'membership', 'status': 'active', 'source': 'trial',
                     'professionalType': professional_type, 'startsAt': stamp, 'endsAt': stamp + billing.TRIAL_MS}
    assert 'verification' not in badge and gateway['creates'] == 0
    row = order(api)
    payment(gateway, row)
    paid = check(api)
    assert paid['subscription']['plan'] == 'trial'
    clock[0] = badge['endsAt'] / 1000
    paid_badge = main.operations_store.run(lambda u: billing.membership_badge(u, 'customer', worker=worker))
    assert paid_badge['source'] == 'paid' and paid_badge['startsAt'] == badge['endsAt']
    clock[0] = paid_badge['endsAt'] / 1000
    assert main.operations_store.run(lambda u: billing.membership_badge(u, 'customer')) is None
    clock[0] = stamp / 1000 + 86400
    main.operations_store.run(lambda u: u.put('workers', 'customer', {**worker, 'status': 'suspended'}))
    assert main.operations_store.run(lambda u: billing.membership_badge(u, 'customer')) is None
    assert main.operations_store.run(lambda u: billing.membership_badge(u, 'customer', worker={**worker, 'id': 'other'})) is None


def test_membership_badge_enrolls_approved_worker_once_without_a_community_profile(api, gateway, monkeypatch):
    clock = [1800000000.0]
    monkeypatch.setattr(billing.time, 'time', lambda: clock[0])
    with main.db() as c:
        c.execute("DELETE FROM operation_records WHERE kind='rp_members' AND id='customer'")
    def unjoined(u):
        u.put('workers', 'customer', {'id': 'customer', 'status': 'approved', 'contractor_verified': True})
        return billing.membership_badge(u, 'customer'), u.get('rp_trials', 'customer'), u.get('rp_members', 'customer')
    badge, stored, member = main.operations_store.run(unjoined)
    assert badge['source'] == 'trial' and badge['startsAt'] == 1800000000000
    assert badge['endsAt'] == 1800000000000 + billing.TRIAL_MS and member is None
    assert stored['policy'] == billing.TRIAL_POLICY
    clock[0] += 10 * 86400
    # Public re-projection and a later community join share the same one-time trial.
    assert main.operations_store.run(lambda u: billing.membership_badge(u, 'customer')) == badge
    main.operations_store.run(lambda u: u.put('rp_members', 'customer', {'id': 'customer', 'createdAt': int(clock[0] * 1000)}))
    assert api.get('/repaidians/subscription', headers=auth('customer')).json()['trial']['startsAt'] == badge['startsAt']
    assert main.operations_store.run(lambda u: u.get('rp_trials', 'customer')) == stored
    clock[0] = badge['endsAt'] / 1000
    assert main.operations_store.run(lambda u: billing.membership_badge(u, 'customer')) is None


def test_membership_badge_never_enrolls_a_self_declared_or_unapproved_worker(api, gateway, monkeypatch):
    monkeypatch.setattr(billing.time, 'time', lambda: 1800000000.0)
    def declared(u):
        u.put('rp_members', 'stranger', {'id': 'stranger', 'createdAt': 1800000000000,
                                      'professionalType': 'contractor', 'reviewed': True})
        return billing.membership_badge(u, 'stranger'), u.get('rp_trials', 'stranger')
    assert main.operations_store.run(declared) == (None, None)
    with main.db() as c:
        c.execute("DELETE FROM operation_records WHERE kind='rp_members' AND id='customer'")
    for status in ('pending_verification', 'rejected', 'suspended'):
        def pending(u):
            u.put('workers', 'customer', {'id': 'customer', 'status': status, 'contractor_verified': True})
            return billing.membership_badge(u, 'customer'), u.get('rp_trials', 'customer')
        assert main.operations_store.run(pending) == (None, None)


def test_membership_badge_does_not_read_private_payment_records(api, gateway, monkeypatch):
    monkeypatch.setattr(billing.time, 'time', lambda: 1800000000.0)
    read_kinds = []
    def public(u):
        u.put('rp_members', 'customer', {'id': 'customer', 'createdAt': 1800000000000})
        u.put('workers', 'customer', {'id': 'customer', 'status': 'approved'})
        get = u.get
        def read(kind, key):
            read_kinds.append(kind)
            return get(kind, key)
        u.get = read
        return billing.membership_badge(u, 'customer')
    assert main.operations_store.run(public)['source'] == 'trial'
    assert set(read_kinds) == {'workers', 'rp_members', 'rp_trials', 'rp_subscriptions'}


@pytest.mark.parametrize('first_action', ['status', 'capture', 'refund'])
def test_legacy_prepaid_chain_migrates_atomically_before_provider_commands(api, gateway, monkeypatch, first_action):
    clock = [1800000000.0]
    monkeypatch.setattr(billing.time, 'time', lambda: clock[0])
    stamp, delta = int(clock[0] * 1000), 30 * 86400000
    old_end = stamp + delta
    # Set up provider-verified orders without invoking a new-policy capture.
    rows, payments, grants = [], [], []
    next_start = old_end
    for index in range(3):
        row = order(api)
        p = payment(gateway, row)
        rows.append(row)
        payments.append(p)
        end = int(billing.month_after(next_start / 1000) * 1000)
        grants.append({'attemptId': row['attempt_id'], 'paymentId': p['id'], 'startsAt': next_start, 'endsAt': end})
        next_start = end
        def captured(u):
            attempt = u.get('rp_payments', row['attempt_id'])
            attempt.update(status='captured', paymentId=p['id'], grantStartsAt=grants[-1]['startsAt'], grantEndsAt=end)
            u.put('rp_payments', attempt['id'], attempt)
            u.put('receipts', p['id'], {'id': p['id'], 'rpAttemptId': attempt['id'], 'userId': 'customer'})
        main.operations_store.run(captured)
    def legacy(u):
        u.put('rp_members', 'customer', {'id': 'customer', 'createdAt': stamp})
        u.put('rp_trials', 'customer', {'userId': 'customer', 'startsAt': stamp,
                                      'endsAt': old_end, 'policy': billing.LEGACY_TRIAL_POLICY})
        billing._save_grants(u, 'customer', grants, clock[0])
    main.operations_store.run(legacy)
    clock[0] += 40 * 86400
    if first_action == 'status':
        api.get('/repaidians/subscription', headers=auth('customer'))
    elif first_action == 'capture':
        # A new renewal must append after the shifted chain rather than restore
        # its old intervals from a list read before policy migration.
        renewed = order(api)
        payment(gateway, renewed)
        assert check(api)['paymentStatus'] == 'captured'
    else:
        payments[0].update(status='refunded', amount_refunded=19900)
        assert signed_hook(api, payments[0]['id']).status_code == 200
    shifted = main.operations_store.run(lambda u: u.get('rp_subscriptions', 'customer'))
    expected = [{**g, 'startsAt': g['startsAt'] + delta, 'endsAt': g['endsAt'] + delta} for g in grants]
    if first_action == 'refund':
        expected = expected[1:]
    assert shifted['grants'][:len(expected)] == expected
    if first_action == 'capture':
        assert shifted['grants'][-1]['startsAt'] == expected[-1]['endsAt']
    for original in grants:
        attempt = main.operations_store.run(lambda u: u.get('rp_payments', original['attemptId']))
        assert attempt['grantStartsAt'] == original['startsAt'] + delta
        assert attempt['grantEndsAt'] - attempt['grantStartsAt'] == original['endsAt'] - original['startsAt']
    before = copy.deepcopy(shifted)
    assert api.get('/repaidians/subscription', headers=auth('customer')).json()['trial']['endsAt'] == stamp + billing.TRIAL_MS
    assert main.operations_store.run(lambda u: u.get('rp_subscriptions', 'customer')) == before


def test_legacy_trial_does_not_shift_paid_period_unrelated_to_trial_end(api, gateway, monkeypatch):
    clock = [1800000000.0]
    monkeypatch.setattr(billing.time, 'time', lambda: clock[0])
    stamp = int(clock[0] * 1000)
    row = order(api)
    p = payment(gateway, row)
    def existing_paid(u):
        end = int(billing.month_after(clock[0]) * 1000)
        attempt = u.get('rp_payments', row['attempt_id'])
        attempt.update(status='captured', paymentId=p['id'], grantStartsAt=stamp, grantEndsAt=end)
        u.put('rp_payments', attempt['id'], attempt)
        u.put('rp_members', 'customer', {'id': 'customer', 'createdAt': stamp})
        u.put('rp_trials', 'customer', {'userId': 'customer', 'startsAt': stamp,
                                      'endsAt': stamp + 30 * 86400000, 'policy': billing.LEGACY_TRIAL_POLICY})
        billing._save_grants(u, 'customer', [{'attemptId': attempt['id'], 'paymentId': p['id'],
                                            'startsAt': stamp, 'endsAt': end}], clock[0])
        return u.get('rp_subscriptions', 'customer'), attempt
    before = main.operations_store.run(existing_paid)
    assert api.get('/repaidians/subscription', headers=auth('customer')).json()['subscription']['plan'] == 'pro'
    assert main.operations_store.run(lambda u: (u.get('rp_subscriptions', 'customer'),
        u.get('rp_payments', row['attempt_id']))) == before


def test_concurrent_worker_projections_share_one_trial_and_one_legacy_extension(api, gateway):
    stamp = 1800000000000
    with main.db() as c:
        c.execute("DELETE FROM operation_records WHERE kind='rp_members' AND id='customer'")
    main.operations_store.run(lambda u: u.put('workers', 'customer', {'id': 'customer', 'status': 'approved'}))
    def project(seconds):
        return main.operations_store.run(lambda u: billing.membership_badge(u, 'customer', now=seconds))
    with ThreadPoolExecutor(max_workers=2) as pool:
        badges = list(pool.map(project, [stamp / 1000, stamp / 1000]))
    assert badges[0] == badges[1]
    start = badges[0]['startsAt']
    assert start == stamp
    assert badges[0]['endsAt'] == start + billing.TRIAL_MS
    assert main.operations_store.run(lambda u: u.get('rp_members', 'customer')) is None
    main.operations_store.run(lambda u: u.put('rp_trials', 'customer', {
        'userId': 'customer', 'startsAt': stamp, 'endsAt': stamp + 30 * 86400000,
        'policy': billing.LEGACY_TRIAL_POLICY}))
    with ThreadPoolExecutor(max_workers=2) as pool:
        migrated = list(pool.map(project, [stamp / 1000 + 45 * 86400, stamp / 1000 + 45 * 86400 + 1]))
    assert migrated[0] == migrated[1] and migrated[0]['startsAt'] == stamp
    assert migrated[0]['endsAt'] == stamp + billing.TRIAL_MS
    assert main.operations_store.run(lambda u: u.get('rp_trials', 'customer'))['policy'] == billing.LEGACY_TRIAL_POLICY
    main.operations_store.run(lambda u: billing.subscription(u, 'customer', now=stamp / 1000 + 45 * 86400))
    assert main.operations_store.run(lambda u: u.get('rp_trials', 'customer'))['policy'] == billing.TRIAL_POLICY


@pytest.mark.parametrize('days,source', [(45, 'trial'), (65, 'paid')])
def test_public_badge_projects_legacy_trial_and_paid_chain_without_billing_writes(api, gateway, days, source):
    stamp = 1800000000000
    delta = 30 * 86400000
    def legacy(u):
        u.put('workers', 'customer', {'id': 'customer', 'status': 'approved', 'contractor_verified': True})
        u.put('rp_members', 'customer', {'id': 'customer', 'createdAt': stamp})
        u.put('rp_trials', 'customer', {'userId': 'customer', 'startsAt': stamp,
                                      'endsAt': stamp + delta, 'policy': billing.LEGACY_TRIAL_POLICY})
        grants = []
        for index in range(12):
            aid, pid = f'legacy-attempt-{index}', f'pay_legacy{index}'
            starts = stamp + (index + 1) * delta
            grant = {'attemptId': aid, 'paymentId': pid, 'startsAt': starts, 'endsAt': starts + delta}
            grants.append(grant)
            u.put('rp_payments', aid, {'id': aid, 'userId': 'customer', 'kind': 'repaidians_pro',
                                     'status': 'captured', 'paymentId': pid, 'createdAt': stamp,
                                     'grantStartsAt': starts, 'grantEndsAt': starts + delta})
            u.put('receipts', pid, {'id': pid, 'rpAttemptId': aid, 'userId': 'customer'})
        billing._save_grants(u, 'customer', grants, stamp / 1000)
    main.operations_store.run(legacy)
    def records(u):
        return {kind: u.all(kind) for kind in ('rp_trials', 'rp_subscriptions', 'rp_payments', 'receipts')}
    before = main.operations_store.run(records)
    now = stamp / 1000 + days * 86400
    def public(u):
        put = u.put
        writes = []
        def track(kind, key, row):
            writes.append((kind, key))
            return put(kind, key, row)
        u.put = track
        badge = billing.membership_badge(u, 'customer', now=now)
        assert writes == [] and not u.pending
        return badge
    badge = main.operations_store.run(public)
    assert badge['source'] == source
    assert badge['startsAt'] == stamp + (billing.TRIAL_MS if source == 'paid' else 0)
    assert badge['endsAt'] == stamp + (14 * delta if source == 'paid' else billing.TRIAL_MS)
    assert main.operations_store.run(records) == before
    # The owner persists precisely the effective public intervals, once.
    own = main.operations_store.run(lambda u: billing.subscription(u, 'customer', now=now))
    assert own['trial']['endsAt'] == stamp + billing.TRIAL_MS
    assert own['subscription']['startsAt'] == badge['startsAt'] and own['subscription']['endsAt'] == badge['endsAt']
    after = main.operations_store.run(records)
    assert after['receipts'] == before['receipts'] and after['rp_trials'][0]['policy'] == billing.TRIAL_POLICY
    assert after != before
    main.operations_store.run(public)
    assert main.operations_store.run(records) == after
