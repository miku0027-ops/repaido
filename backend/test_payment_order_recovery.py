"""Lost provider responses recover atomically; no real provider or charge calls."""
import copy
import time

import pytest

import integrations
import main
from test_integrations import completed, payment_fixture
from test_operations import api


@pytest.fixture(autouse=True)
def quiet_scheduler(monkeypatch):
    monkeypatch.setattr(main, 'operations_tick', lambda: None)
    monkeypatch.setenv('REPAIDO_PAYOUTS_ENABLED', 'false')


def recovery(api, monkeypatch, observations):
    job = completed(api)
    payment = payment_fixture(job)
    key = job['id']
    def prepare(u):
        attempt = u.get('payments', key)
        attempt.update(status='creating', receipt='recovery-' + key[:20])
        attempt.pop('order_id')
        u.put('payments', key, attempt)
        return attempt
    attempt = main.operations_store.run(prepare)
    calls = []
    def provider(path, body=None, **kwargs):
        assert body is None, 'Recovery must never create another provider order'
        calls.append(path)
        if path == 'orders?receipt=' + attempt['receipt']:
            return {'items': [{'id': payment['order_id'], 'receipt': attempt['receipt'],
                               'amount': attempt['amount_paise'], 'currency': 'INR'}]}
        assert path == 'orders/' + payment['order_id'] + '/payments'
        saved = main.operations_store.run(lambda u: u.get('payments', key))
        assert saved['status'] == 'creating' and 'order_id' not in saved
        return observations(payment)
    monkeypatch.setattr(integrations, 'razorpay', provider)
    return key, payment, calls


@pytest.mark.parametrize('state', ['empty', 'captured', 'refunded'])
def test_recovery_attaches_only_after_payment_observation_and_preserves_terminal_state(api, monkeypatch, state):
    def observations(payment):
        fact = {**payment, 'status': state,
                'amount_refunded': payment['amount'] if state == 'refunded' else 0}
        return {'items': [] if state == 'empty' else [fact]}
    key, payment, calls = recovery(api, monkeypatch, observations)
    assert main.integrations_reconcile()['errors'] == 0
    saved = main.operations_store.run(lambda u: u.get('payments', key))
    assert saved['order_id'] == payment['order_id']
    assert saved['status'] == ('created' if state == 'empty' else state)
    assert len(calls) == 2
    if state == 'refunded':
        main.operations_store.run(lambda u: integrations.apply_payment(u, payment))
        assert main.operations_store.run(lambda u: u.get('payments', key))['status'] == 'refunded'


def test_failed_payment_read_retains_creating_receipt_and_recovers_without_another_order(api, monkeypatch):
    unavailable = [True]
    def observations(payment):
        if unavailable[0]:
            integrations.fail('PROVIDER_OUTCOME_UNKNOWN', 'Test-only provider timeout', 503)
        return {'items': [payment]}
    key, payment, calls = recovery(api, monkeypatch, observations)
    assert main.integrations_reconcile()['errors'] == 1
    saved = main.operations_store.run(lambda u: u.get('payments', key))
    assert saved['status'] == 'creating' and 'order_id' not in saved and saved['receipt']
    unavailable[0] = False
    resumed_at = time.time() + 121
    monkeypatch.setattr(integrations.time, 'time', lambda: resumed_at)
    assert main.integrations_reconcile()['errors'] == 0
    saved = main.operations_store.run(lambda u: u.get('payments', key))
    assert saved['status'] == 'captured' and saved['order_id'] == payment['order_id']
    assert len(calls) == 4


@pytest.mark.parametrize('invalid', ['wrong_amount', 'wrong_order', 'malformed', 'missing', 'oversized'])
def test_invalid_provider_facts_do_not_publish_a_recovered_order_or_partial_capture(api, monkeypatch, invalid):
    def observations(payment):
        if invalid == 'malformed':
            return {'items': None}
        if invalid == 'missing':
            return {}
        if invalid == 'oversized':
            return {'items': [copy.deepcopy(payment) for _ in range(101)]}
        fact = {**payment, **({'amount': 1} if invalid == 'wrong_amount' else {'order_id': 'order_other'})}
        return {'items': [payment, fact]}
    key, _, _ = recovery(api, monkeypatch, observations)
    assert main.integrations_reconcile()['errors'] == 1
    saved = main.operations_store.run(lambda u: u.get('payments', key))
    assert saved['status'] == 'creating' and 'order_id' not in saved
    assert main.operations_store.run(lambda u: u.get('receipts', 'pay_test')) is None
    assert main.operations_store.run(lambda u: u.get('jobs', key))['payment_status'] == 'pay_after_service'
