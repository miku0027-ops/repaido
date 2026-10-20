"""Monthly invoice recovery with real, isolated Firestore transactions.

Only an explicitly configured loopback emulator is accepted. Each test gets an
anonymous, unique demo project; provider responses are local test doubles and
are fetched outside the database transaction, including during SDK retries.
"""
import os
import re
import threading
import time
import uuid

import pytest
from google.api_core.exceptions import Aborted
from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore
from google.cloud.firestore_v1.transaction import Transaction

import integrations
import main
from operations import Unit
from test_operations import api as local_api


def loopback_emulator():
    match = re.fullmatch(r'(127\.0\.0\.1|localhost|\[::1\]):([0-9]{1,5})',
                         os.getenv('FIRESTORE_EMULATOR_HOST', ''))
    return bool(match and 1 <= int(match[2]) <= 65535)


pytestmark = pytest.mark.skipif(not loopback_emulator(), reason='Requires a loopback Firestore emulator')


@pytest.fixture(autouse=True)
def quiet_scheduler(monkeypatch):
    monkeypatch.setattr(main, 'operations_tick', lambda: None)


@pytest.fixture
def api(local_api, monkeypatch):
    assert loopback_emulator(), 'Refusing a non-loopback Firestore endpoint'
    client = firestore.Client(project='demo-repaido-home-invoice-' + uuid.uuid4().hex[:10],
                              credentials=AnonymousCredentials())
    monkeypatch.setattr(main, 'USE_FIRESTORE', True)
    monkeypatch.setattr(main, 'fb_db', client)
    assert main.operations_store.run(lambda unit: unit.tx is not None)
    try:
        yield local_api
    finally:
        client.close()


@pytest.mark.parametrize('during_create', ['none', 'capture', 'refund'])
def test_firestore_monthly_invoice_lifecycle_and_concurrent_checkout(api, monkeypatch, during_create):
    # Run the actual HTTP workflow and its provider-lookup concurrency barrier,
    # preserving its original no-double-order and both-checkouts-409 assertions.
    from test_home_plans import test_complete_visit_monthly_capture_and_no_duplicate_charge as workflow
    workflow(api, monkeypatch, during_create)


def test_firestore_future_visit_changes_pause_resume_and_cancel(api):
    # These visits intentionally have no materialized job yet: native reads
    # must preserve the same schedule-change and cancellation lifecycle.
    from test_home_plans import test_day_changes_need_other_party_preserve_price_and_pause as workflow
    workflow(api)


def seed_unattached_invoice():
    suffix = uuid.uuid4().hex
    key, job_id, order_id, payment_id = ('home-native-' + suffix + ':0', 'native-job-' + suffix,
                                          'order_native' + suffix, 'pay_native' + suffix)
    attempt = dict(id=key, kind='home_plan', plan_id='native-plan-' + suffix, period=0,
                   customer_id='customer', amount_paise=11800, lines=[{'job_id': job_id}],
                   receipt='hp-' + suffix, status='creating', created_at=time.time() - 600)
    job = dict(id=job_id, state='completed', customer_id='customer', worker_id='worker',
               payment_status='monthly_invoice', payout_status='held', invoice={'status': 'unpaid'})
    main.operations_store.run(lambda unit: (unit.put('payments', key, attempt), unit.put('jobs', job_id, job)))
    order = dict(id=order_id, receipt=attempt['receipt'], amount=11800, currency='INR')
    captured = dict(id=payment_id, order_id=order_id, amount=11800, currency='INR',
                    status='captured', captured=True, amount_refunded=0)
    refunded = {**captured, 'status': 'refunded', 'amount_refunded': 11800}
    return key, job_id, order, captured, refunded


def observe_transaction_scope(monkeypatch):
    original = main.operations_store.run
    scope = threading.local()
    scope.failures = []

    def tracked(callback):
        def invoke(unit):
            assert unit.tx is not None
            scope.active = True
            try:
                return callback(unit)
            finally:
                scope.active = False
        try:
            return original(invoke)
        except Exception as error:
            scope.failures.append((type(error).__name__, str(error)))
            raise

    monkeypatch.setattr(main.operations_store, 'run', tracked)
    return scope


def test_firestore_recovered_order_and_facts_commit_together_after_sdk_retry(api, monkeypatch):
    key, job_id, order, captured, refunded = seed_unattached_invoice()
    scope = observe_transaction_scope(monkeypatch)
    calls, staged_statuses = [], []
    original_flush, original_commit = Unit.flush, Transaction._commit
    retry = {'injected': False}

    def provider(path, body=None):
        assert not getattr(scope, 'active', False), 'Provider call occurred inside a retryable transaction'
        calls.append(path)
        assert body is None, 'Recovery must never create another provider order'
        if path == 'orders?receipt=' + order['receipt']:
            return {'items': [order]}
        if path == 'orders/' + order['id'] + '/payments':
            return {'items': [captured, refunded]}
        raise AssertionError(path)

    def inspect_flush(unit):
        row = unit.pending.get(('payments', key))
        if row:
            staged_statuses.append(row['status'])
        return original_flush(unit)

    def transient_commit(transaction):
        recovery = any(write.update.name.endswith('/ops_payments/' + key) and
                       write.update.fields['status'].string_value == 'refunded'
                       for write in transaction._write_pbs)
        if recovery and not retry['injected']:
            retry['injected'] = True
            # Exercise the real SDK retry loop. All reads and the successful
            # commit still use the native emulator, rather than a fake Unit.
            # Release the emulator's pessimistic locks as a failed server
            # commit would; a client-only exception would leave an open
            # transaction holding locks and manufacture later lock timeouts.
            transaction._client._firestore_api.rollback(request={
                'database': transaction._client._database_string,
                'transaction': transaction.id})
            raise Aborted('Test-only transient commit abort')
        return original_commit(transaction)

    monkeypatch.setattr(integrations, 'razorpay', provider)
    monkeypatch.setattr(Unit, 'flush', inspect_flush)
    monkeypatch.setattr(Transaction, '_commit', transient_commit)
    assert main.integrations_reconcile() == {'errors': 0}, scope.failures
    assert retry['injected']
    assert calls == ['orders?receipt=' + order['receipt'], 'orders/' + order['id'] + '/payments']
    assert staged_statuses == ['creating', 'refunded', 'refunded']
    saved, job, receipts = main.operations_store.run(lambda unit: (
        unit.get('payments', key), unit.get('jobs', job_id), unit.all('receipts')))
    assert saved['order_id'] == order['id'] and saved['status'] == 'refunded'
    assert saved['amount_refunded'] == 11800 and saved['payment_id'] == refunded['id']
    assert job['financial_hold'] and job['payment_status'] == 'refund_review'
    assert len(receipts) == 1 and receipts[0]['id'] == captured['id']


def test_firestore_stale_provider_fetch_cannot_undo_a_concurrent_committed_refund(api, monkeypatch):
    key, job_id, order, captured, refunded = seed_unattached_invoice()
    scope = observe_transaction_scope(monkeypatch)
    calls = []

    def provider(path, body=None):
        assert not getattr(scope, 'active', False)
        calls.append(path)
        assert body is None
        if path == 'orders?receipt=' + order['receipt']:
            return {'items': [order]}
        if path == 'orders/' + order['id'] + '/payments':
            # Another native transaction may process a newer provider fact
            # while this earlier external GET is still in flight.
            def newer_fact(unit):
                integrations.attach_saved_order(unit, 'payments', key, order['id'])
                integrations.apply_payment(unit, refunded)
            main.operations_store.run(newer_fact)
            return {'items': [captured]}
        raise AssertionError(path)

    monkeypatch.setattr(integrations, 'razorpay', provider)
    assert main.integrations_reconcile() == {'errors': 0}, scope.failures
    saved, job = main.operations_store.run(lambda unit: (unit.get('payments', key), unit.get('jobs', job_id)))
    assert saved['status'] == 'refunded' and saved['amount_refunded'] == 11800
    assert job['financial_hold'] and job['payment_status'] == 'refund_review'
    assert calls == ['orders?receipt=' + order['receipt'], 'orders/' + order['id'] + '/payments']
