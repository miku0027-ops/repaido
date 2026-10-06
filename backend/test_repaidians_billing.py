"""Gateway-boundary tests: fake provider only, never external orders or charges."""
import copy
import hashlib
import hmac
import json
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
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
    assert trial == {'startsAt': stamp, 'endsAt': stamp + 30 * 86400 * 1000, 'status': 'active'}
    state = api.get('/repaidians/subscription', headers=auth('customer')).json()
    assert state['active'] and state['trial'] == trial
    assert state['subscription'] == {'plan': 'trial', 'provider': 'trial', 'amountPaise': 0,
                                      'startsAt': stamp, 'endsAt': trial['endsAt']}
    stored = main.operations_store.run(lambda u: u.get('rp_trials', 'customer'))
    clock[0] += 40 * 86400

    def rejoin(u):
        u.put('rp_members', 'customer', {'id': 'customer', 'createdAt': int(clock[0] * 1000)})
        return billing.ensure_trial(u, 'customer', starts_at=int(clock[0] * 1000))
    assert main.operations_store.run(rejoin)['status'] == 'expired'
    assert main.operations_store.run(lambda u: u.get('rp_trials', 'customer')) == stored
    assert not api.get('/repaidians/subscription', headers=auth('customer')).json()['active']
    assert main.operations_store.run(lambda u: (u.all('rp_payments'), u.all('receipts'))) == ([], [])
    assert gateway['creates'] == 0
    assert api.get('/repaidians/subscription', headers=auth('stranger')).json()['trial'] is None


@pytest.mark.parametrize('offset_ms,active', [(-1, False), (0, True), (30 * 86400 * 1000 - 1, True), (30 * 86400 * 1000, False)])
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
    clock = [stamp / 1000 + 45 * 86400]
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
    assert datetime.fromtimestamp(attempt['grantEndsAt'] / 1000, ZoneInfo('Asia/Kolkata')).isoformat().startswith('2027-02-28T12:00')
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
