"""Legacy booking parity; repeat against a loopback emulator when configured."""
import copy
import hashlib
import hmac
import os
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
import main
import legacy_bookings
import integrations


class Snapshot:
    def __init__(self, ref, data):
        self.id, self.reference, self.exists = ref.id, ref, data is not None
        self.data = copy.deepcopy(data)
    def to_dict(self):
        return copy.deepcopy(self.data)


class Ref:
    def __init__(self, database, kind, key):
        self.database, self.kind, self.id = database, kind, key
        self.path = kind + '/' + key
    def get(self, transaction=None):
        return Snapshot(self, self.database.rows.get(self.path))
    def set(self, data):
        self.database.rows[self.path] = copy.deepcopy(data)
    def update(self, data):
        self.database.rows[self.path].update(copy.deepcopy(data))
    def delete(self):
        self.database.rows.pop(self.path, None)
    def collection(self, name):
        return Query(self.database, self.path + '/' + name)


class Query:
    def __init__(self, database, kind, filters=(), maximum=None):
        self.database, self.kind, self.filters, self.maximum = database, kind, filters, maximum
    def document(self, key):
        return Ref(self.database, self.kind, key)
    def where(self, field, op, value):
        assert op == '=='
        return Query(self.database, self.kind, (*self.filters, (field, value)), self.maximum)
    def limit(self, count):
        return Query(self.database, self.kind, self.filters, count)
    def stream(self, transaction=None):
        rows = [Snapshot(self.document(path.rsplit('/', 1)[1]), data) for path, data in self.database.rows.items()
                if path.rsplit('/', 1)[0] == self.kind and all(data.get(key) == value for key, value in self.filters)]
        return iter(rows[:self.maximum])


class Database:
    def __init__(self):
        self.rows = {}
        self.lock = threading.RLock()
    def collection(self, kind):
        return Query(self, kind)
    def transaction(self):
        return self
    def set(self, ref, data):
        ref.set(data)
    def update(self, ref, data):
        ref.update(data)


@pytest.fixture(params=['double', 'emulator'])
def store(request, monkeypatch):
    if request.param == 'emulator':
        endpoint = os.getenv('FIRESTORE_EMULATOR_HOST', '')
        if not endpoint:
            pytest.skip('Set FIRESTORE_EMULATOR_HOST to run real server transaction regressions.')
        assert endpoint.startswith(('127.0.0.1:', 'localhost:')), 'Tests only use a loopback emulator.'
        from google.auth.credentials import AnonymousCredentials
        from google.cloud.firestore import Client
        database = Client(project='demo-repaido-booking-' + uuid.uuid4().hex[:10], credentials=AnonymousCredentials())
    else:
        database = Database()
        def transactional(callback):
            def apply(tx):
                with tx.lock:
                    before = copy.deepcopy(tx.rows)
                    try:
                        return callback(tx)
                    except BaseException:
                        tx.rows = before
                        raise
            return apply
        monkeypatch.setattr(legacy_bookings.firestore, 'transactional', transactional)
    monkeypatch.setattr(main, 'USE_FIRESTORE', True)
    monkeypatch.setattr(main, 'fb_db', database)
    # Touching SQLite in Firestore mode must fail the test.
    monkeypatch.setattr(main, 'db', lambda: pytest.fail('Firestore booking touched ephemeral SQLite.'))
    main.fs_doc('services', 'ac-service').set({'id': 'ac-service', 'name': 'AC service', 'category': 'ac', 'price_paise': 59900, 'duration_minutes': 60})
    yield database
    if request.param == 'emulator':
        database.close()


def body(**changes):
    return main.BookingInput(**{'service_id': 'ac-service', 'city': 'Bengaluru', 'address': 'Flat 12, Lake Road, Indiranagar', 'phone': '9876543210', 'starts_at': main.candidates()[0].isoformat(), 'idempotency_key': str(uuid.uuid4()), **changes})


def create(value=None, user='customer'):
    return main.create_booking(value or body(), user={'id': user})


def status(call):
    for attempt in range(4):
        try:
            call()
            return 201
        except HTTPException as error:
            if error.status_code == 409 and 'changed concurrently' in error.detail and attempt < 3:
                time.sleep(0.02 * (attempt + 1))
                continue
            return error.status_code


def test_create_idempotency_payload_binding_and_foreign_owner(store):
    request = body()
    first = create(request)
    assert first['price_paise'] == 59900
    assert create(request)['id'] == first['id']
    assert status(lambda: create(request.model_copy(update={'address': 'Different service address'}))) == 409
    assert create(request, 'another-customer')['id'] != first['id']
    assert status(lambda: main.cancel(first['id'], user={'id': 'stranger'})) == 404
    assert status(lambda: main.reschedule(first['id'], main.BookingRescheduleInput(starts_at=main.candidates()[1].isoformat(), reason='New appointment'), user={'id': 'stranger'})) == 404


def test_concurrent_creation_capacity_and_duplicate_requests(store):
    request = body()
    with ThreadPoolExecutor(max_workers=6) as executor:
        results = list(executor.map(lambda _: status(lambda: create(request.model_copy(update={'idempotency_key': str(uuid.uuid4())}))), range(6)))
    assert results.count(201) == 3
    assert results.count(409) == 3
    second = body(starts_at=main.candidates()[1].isoformat())
    with ThreadPoolExecutor(max_workers=4) as executor:
        ids = list(executor.map(lambda _: create(second)['id'], range(4)))
    assert len(set(ids)) == 1


@pytest.mark.parametrize('state', ['requested', 'confirmed'])
def test_started_booking_cannot_cancel(store, state):
    booking = create()
    main.fs_doc('bookings', booking['id']).update({'status': state, 'starts_at': (datetime.now(main.IST) - timedelta(minutes=1)).isoformat()})
    assert status(lambda: main.cancel(booking['id'], user={'id': 'customer'})) == 409
    assert main.firestore_booking_output(booking['id'])['status'] == state


def test_cancel_is_idempotent_and_frees_capacity(store):
    request = body()
    bookings = [create(request.model_copy(update={'idempotency_key': str(uuid.uuid4())})) for _ in range(3)]
    assert status(lambda: create(request)) == 409
    cancelled = main.cancel(bookings[0]['id'], user={'id': 'customer'})
    assert cancelled['status'] == 'cancelled'
    assert main.cancel(bookings[0]['id'], user={'id': 'customer'}) == cancelled
    assert create(request)['status'] == 'requested'


def test_concurrent_reschedule_and_create_share_capacity(store):
    times = main.candidates()
    moving = [create(body(starts_at=times[index + 1].isoformat())) for index in range(3)]
    target = times[0].isoformat()
    actions = [lambda booking=booking: main.reschedule(booking['id'], main.BookingRescheduleInput(starts_at=target, reason='New appointment'), user={'id': 'customer'}) for booking in moving]
    actions += [lambda: create(body(starts_at=target)) for _ in range(3)]
    with ThreadPoolExecutor(max_workers=6) as executor:
        results = list(executor.map(status, actions))
    assert results.count(201) == 3
    assert results.count(409) == 3
    assert sum(row.to_dict()['starts_at'] == target for row in main.fs_collection('bookings').stream()) == 3


def paid_fixture():
    request = body()
    payment = {'id': 'local-order', 'user_id': 'customer', 'purpose': 'booking', 'razorpay_order_id': 'provider-order', 'amount_paise': 59900, 'currency': 'INR', 'status': 'created', 'metadata': request.model_dump()}
    main.fs_doc('payment_orders', payment['id']).set(payment)
    booking = {**request.model_dump(), 'id': str(uuid.uuid4()), 'user_id': 'customer', 'status': 'requested', 'price_paise': 59900, 'payment_status': 'paid', 'payment_order_id': payment['id'], 'payment_id': 'captured-payment'}
    updates = {'status': 'paid', 'razorpay_payment_id': 'captured-payment', 'razorpay_signature': 'proof', 'paid_at': main.fs_now()}
    return payment, booking, updates


def test_paid_booking_atomic_replay_and_changed_order(store):
    payment, booking, updates = paid_fixture()
    first = legacy_bookings.complete_paid_booking(main, payment['id'], payment, booking, updates)
    assert legacy_bookings.complete_paid_booking(main, payment['id'], payment, {**booking, 'id': str(uuid.uuid4())}, updates) == first
    assert len(list(main.fs_collection('bookings').stream())) == 1
    assert status(lambda: legacy_bookings.complete_paid_booking(main, payment['id'], payment, booking, {**updates, 'razorpay_payment_id': 'different-payment'})) == 409
    main.fs_doc('payment_orders', payment['id']).update({'amount_paise': 1})
    assert status(lambda: legacy_bookings.complete_paid_booking(main, payment['id'], payment, booking, updates)) == 409


def test_paid_capacity_failure_preserves_payment(store):
    payment, booking, updates = paid_fixture()
    for _ in range(3):
        create(body(starts_at=booking['starts_at']))
    assert status(lambda: legacy_bookings.complete_paid_booking(main, payment['id'], payment, booking, updates)) == 409
    assert main.fs_doc('payment_orders', payment['id']).get().to_dict()['status'] == 'created'
    assert not main.fs_doc('bookings', booking['id']).get().exists


def test_paid_create_and_reschedule_share_capacity(store):
    payment, paid_booking, updates = paid_fixture()
    target = paid_booking['starts_at']
    moving = [create(body(starts_at=main.candidates()[index + 1].isoformat())) for index in range(2)]
    actions = [lambda: legacy_bookings.complete_paid_booking(main, payment['id'], payment, paid_booking, updates)]
    actions += [lambda: create(body(starts_at=target)) for _ in range(3)]
    actions += [lambda booking=booking: main.reschedule(booking['id'], main.BookingRescheduleInput(starts_at=target, reason='New appointment'), user={'id': 'customer'}) for booking in moving]
    with ThreadPoolExecutor(max_workers=6) as executor:
        results = list(executor.map(status, actions))
    assert results.count(201) == 3 and results.count(409) == 3
    assert sum(row.to_dict()['starts_at'] == target for row in main.fs_collection('bookings').stream()) == 3
    assert main.fs_doc('payment_orders', payment['id']).get().to_dict()['status'] == ('paid' if results[0] == 201 else 'created')


def test_exhausted_firestore_contention_has_retryable_response(monkeypatch):
    from google.api_core.exceptions import Aborted
    def retry_exhausted(tx):
        raise ValueError('Failed to commit transaction in 5 attempts.') from Aborted('Transaction lock timeout.')
    with pytest.raises(HTTPException) as caught:
        legacy_bookings.run_transaction(SimpleNamespace(fb_db=Database()), retry_exhausted)
    assert caught.value.status_code == 409
    assert 'retry' in caught.value.detail.lower()


@pytest.fixture
def checkout(store, monkeypatch):
    """Run production checkout handlers with only the provider GET stubbed."""
    monkeypatch.setenv('RAZORPAY_KEY_SECRET', 'synthetic-checkout-secret')
    captured = dict(id='pay_captured', order_id='order_saved', amount=59900,
                    currency='INR', status='captured', captured=True, amount_refunded=0)
    reads = []
    def provider(path, payload=None, **kwargs):
        assert path == 'payments/pay_captured' and payload is None
        reads.append(path)
        return copy.deepcopy(captured)
    monkeypatch.setattr(integrations, 'razorpay', provider)
    def prepare(kind):
        metadata = body().model_dump()
        metadata.update(recipient_name='Test customer', recipient_phone='9876543210',
                        delivery_address='Flat 12, Lake Road, Indiranagar',
                        items=[dict(product_id='part', product_name='Test part', quantity=1, unit_price_paise=59900)])
        payment = dict(id='local-payment', user_id='customer', purpose='booking' if kind == 'booking' else 'spare_order',
                       razorpay_order_id='order_saved', amount_paise=59900, currency='INR', status='created', metadata=metadata)
        main.fs_doc('payment_orders', payment['id']).set(payment)
        proof = main.PaymentVerificationInput(payment_order_id=payment['id'], razorpay_order_id='order_saved', razorpay_payment_id='pay_captured',
            razorpay_signature=hmac.new(b'synthetic-checkout-secret', b'order_saved|pay_captured', hashlib.sha256).hexdigest())
        handler = main.verify_booking_payment if kind == 'booking' else main.verify_spare_payment
        return payment, lambda: handler(proof, user={'id': 'customer'})
    return prepare, captured, reads


def retry_confirmation(call):
    for attempt in range(4):
        try:
            return call()
        except HTTPException as error:
            if error.status_code != 409 or 'changed concurrently' not in error.detail or attempt == 3:
                raise
            time.sleep(0.02 * (attempt + 1))


@pytest.mark.parametrize('kind', ['booking', 'spare'])
def test_checkout_concurrent_replay_creates_one_fulfillment(checkout, kind):
    prepare, _, reads = checkout
    payment, confirm = prepare(kind)
    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(lambda _: retry_confirmation(confirm), range(4)))
    assert len({row.get('id', row.get('order_id')) for row in results}) == 1
    assert all(row == results[0] for row in results)
    collection = 'bookings' if kind == 'booking' else 'spare_orders'
    records = list(main.fs_collection(collection).stream())
    assert len(records) == 1
    if kind == 'spare':
        assert [item.to_dict() for item in records[0].reference.collection('items').stream()] == payment['metadata']['items']
    saved = main.fs_doc('payment_orders', payment['id']).get().to_dict()
    assert saved['status'] == 'paid' and saved['razorpay_payment_id'] == 'pay_captured'
    assert len(reads) >= 4


@pytest.mark.parametrize('kind', ['booking', 'spare'])
@pytest.mark.parametrize('change', [{'status': 'refunded'}, {'amount_paise': 1}, {'currency': 'USD'}, {'metadata': {'changed': True}}])
def test_checkout_rechecks_payment_changed_during_capture(checkout, monkeypatch, kind, change):
    prepare, captured, _ = checkout
    payment, confirm = prepare(kind)
    def raced_provider(path, payload=None, **kwargs):
        assert path == 'payments/pay_captured' and payload is None
        main.fs_doc('payment_orders', payment['id']).update(change)
        return copy.deepcopy(captured)
    monkeypatch.setattr(integrations, 'razorpay', raced_provider)
    assert status(confirm) == 409
    saved = main.fs_doc('payment_orders', payment['id']).get().to_dict()
    assert all(saved[key] == value for key, value in change.items())
    assert not list(main.fs_collection('bookings' if kind == 'booking' else 'spare_orders').stream())


@pytest.mark.parametrize('kind', ['booking', 'spare'])
def test_checkout_transaction_failure_preserves_created_payment_and_no_fulfillment(checkout, store, monkeypatch, kind):
    prepare, _, _ = checkout
    payment, confirm = prepare(kind)
    original = store.transaction
    def failed_transaction():
        transaction = original()
        update = transaction.update
        def fail_after_update(ref, values):
            update(ref, values)
            raise RuntimeError('Synthetic failure before commit')
        monkeypatch.setattr(transaction, 'update', fail_after_update)
        return transaction
    monkeypatch.setattr(store, 'transaction', failed_transaction)
    with pytest.raises(RuntimeError, match='Synthetic failure before commit'):
        confirm()
    assert main.fs_doc('payment_orders', payment['id']).get().to_dict() == payment
    assert not list(main.fs_collection('bookings' if kind == 'booking' else 'spare_orders').stream())
    assert not list(main.fs_collection('booking_requests').stream())


@pytest.mark.parametrize('kind', ['booking', 'spare'])
def test_paid_checkout_does_not_recreate_missing_fulfillment(checkout, kind):
    prepare, _, _ = checkout
    payment, confirm = prepare(kind)
    result = confirm()
    collection = 'bookings' if kind == 'booking' else 'spare_orders'
    main.fs_doc(collection, result.get('id', result.get('order_id'))).delete()
    saved = main.fs_doc('payment_orders', payment['id']).get().to_dict()
    assert status(confirm) == 409
    assert main.fs_doc('payment_orders', payment['id']).get().to_dict() == saved
    assert not list(main.fs_collection(collection).stream())


@pytest.mark.parametrize('kind', ['booking', 'spare'])
def test_paid_checkout_cannot_reopen_refunded_fulfillment(checkout, kind):
    prepare, _, _ = checkout
    payment, confirm = prepare(kind)
    result = confirm()
    collection = 'bookings' if kind == 'booking' else 'spare_orders'
    ref = main.fs_doc(collection, result.get('id', result.get('order_id')))
    ref.update({'payment_status': 'refunded'})
    assert status(confirm) == 409
    assert ref.get().to_dict()['payment_status'] == 'refunded'
