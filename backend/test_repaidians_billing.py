"""Gateway-boundary tests: fake provider only, never external orders or charges."""
import copy
import hashlib
import hmac
import json
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
import main
import integrations
import repaidians_billing as billing
from test_operations import api, auth


@pytest.fixture
def gateway(monkeypatch):
    monkeypatch.setenv('REPAIDO_PAYMENTS_ENABLED', 'true')
    monkeypatch.setenv('RAZORPAY_KEY_ID', 'rzp_test_fixture')
    monkeypatch.setenv('RAZORPAY_KEY_SECRET', 'fixture-secret')
    monkeypatch.setenv('RAZORPAY_WEBHOOK_SECRET', 'fixture-webhook')
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
