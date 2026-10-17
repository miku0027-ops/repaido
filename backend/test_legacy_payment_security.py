"""Synthetic legacy checkout records; no provider, cloud or credential access."""
import copy
import hashlib
import hmac
import json
import threading
import time

import pytest

import integrations
import main
from test_operations import api, auth


@pytest.fixture(autouse=True)
def isolated_checkout_scheduler(monkeypatch):
    # These endpoint tests use a narrow store double, without scheduler queries.
    monkeypatch.setattr(main, 'operations_tick', lambda: None)


class MemoryFirestore:
    def __init__(self):
        self.rows = {}
        self.writes = []
        self.lock = threading.RLock()

    def collection(self, name):
        return MemoryCollection(self, name)

    def document(self, name, key):
        return MemoryDocument(self, name, key)

    def transaction(self):
        return self

    def set(self, reference, value):
        reference.set(value)

    def update(self, reference, value):
        reference.update(value)


class MemoryDocument:
    def __init__(self, store, name, key):
        self.store, self.name, self.id = store, name, key
        self.path = name + '/' + key

    def get(self, transaction=None):
        value = self.store.rows.get((self.name, self.id))
        return type('Snapshot', (), {'exists': value is not None, 'id': self.id,
            'to_dict': lambda _: copy.deepcopy(value)})()

    def set(self, value):
        self.store.writes.append((self.name, self.id))
        self.store.rows[self.name, self.id] = copy.deepcopy(value)

    def update(self, value):
        self.store.writes.append((self.name, self.id))
        self.store.rows[self.name, self.id].update(copy.deepcopy(value))

    def collection(self, name):
        return MemoryCollection(self.store, self.name + '/' + self.id + '/' + name)


class MemoryCollection:
    def __init__(self, store, name, filters=(), maximum=None):
        self.store, self.name, self.filters, self.maximum = store, name, filters, maximum

    def document(self, key):
        return MemoryDocument(self.store, self.name, key)

    def where(self, field, comparison, value):
        assert comparison == '=='
        return MemoryCollection(self.store, self.name, (*self.filters, (field, value)), self.maximum)

    def limit(self, maximum):
        return MemoryCollection(self.store, self.name, self.filters, maximum)

    def stream(self, transaction=None):
        rows = [self.document(key).get() for (name, key), value in self.store.rows.items()
                if name == self.name and all(value.get(field) == expected for field, expected in self.filters)]
        return iter(rows[:self.maximum])


@pytest.fixture
def legacy(api, monkeypatch):
    store = MemoryFirestore()
    def transactional(callback):
        def apply(tx):
            with tx.lock:
                before, writes = copy.deepcopy(tx.rows), list(tx.writes)
                try:
                    return callback(tx)
                except BaseException:
                    tx.rows, tx.writes = before, writes
                    raise
        return apply
    monkeypatch.setattr(main.firestore, 'transactional', transactional)
    monkeypatch.setattr(main, 'USE_FIRESTORE', True)
    monkeypatch.setattr(main, 'fb_db', store)
    monkeypatch.setattr(main, 'fs_doc', store.document)
    monkeypatch.setattr(main, 'fs_collection', store.collection)
    monkeypatch.setenv('RAZORPAY_KEY_SECRET', 'synthetic-legacy-checkout-secret')
    provider = dict(id='pay_saved', order_id='order_saved', amount=15000, currency='INR',
                    status='captured', captured=True, amount_refunded=0)
    reads = []
    def get(path, body=None, **kwargs):
        assert body is None, 'Verification must never create provider state.'
        reads.append(path)
        return copy.deepcopy(provider)
    monkeypatch.setattr(integrations, 'razorpay', get)
    store.rows['services', 'ac-service'] = dict(id='ac-service', name='Synthetic service', duration_minutes=60, category='ac')
    return api, store, provider, reads


def request(store, kind, **changes):
    metadata = dict(service_id='ac-service', city='Balasore', address='Synthetic service address', phone='9876543210',
                    notes='', starts_at=main.candidates()[0].isoformat(), idempotency_key='synthetic-booking-key',
                    recipient_name='Synthetic customer', recipient_phone='9876543210', delivery_address='Synthetic address',
                    items=[dict(product_id='synthetic-part', product_name='Synthetic part', quantity=1, unit_price_paise=15000)])
    payment = dict(id='saved-payment', user_id='customer', purpose='booking' if kind == 'booking' else 'spare_order',
                   razorpay_order_id='order_saved', amount_paise=15000, currency='INR', status='created', metadata=metadata)
    store.rows['payment_orders', payment['id']] = payment
    body = dict(payment_order_id=payment['id'], razorpay_order_id='order_saved', razorpay_payment_id='pay_saved')
    body.update(changes)
    body['razorpay_signature'] = hmac.new(b'synthetic-legacy-checkout-secret',
        (body['razorpay_order_id'] + '|' + body['razorpay_payment_id']).encode(), hashlib.sha256).hexdigest()
    return '/checkout/' + kind + '/verify', body, payment


@pytest.mark.parametrize('kind', ['booking', 'spare'])
@pytest.mark.parametrize('mismatch', ['order', 'purpose', 'customer'])
def test_firestore_checkout_requires_saved_order_purpose_and_customer(legacy, kind, mismatch):
    api, store, _, reads = legacy
    path, body, payment = request(store, kind, **({'razorpay_order_id': 'order_other'} if mismatch == 'order' else {}))
    if mismatch == 'purpose':
        payment['purpose'] = 'spare_order' if kind == 'booking' else 'booking'
    if mismatch == 'customer':
        payment['user_id'] = 'stranger'
    response = api.post(path, headers=auth('customer'), json=body)
    assert response.status_code == 404, response.text
    assert store.writes == [] and reads == []


@pytest.mark.parametrize('kind', ['booking', 'spare'])
@pytest.mark.parametrize('changes', [
    {'id': 'pay_other'}, {'order_id': 'order_other'}, {'amount': 1}, {'amount': 15000.0}, {'currency': 'USD'},
    {'status': 'authorized', 'captured': False}, {'status': 'failed', 'captured': False},
    {'captured': 1}, {'amount_refunded': 100}, {'amount_refunded': True},
])
def test_signed_checkout_still_requires_matching_captured_provider_payment(legacy, kind, changes):
    api, store, provider, reads = legacy
    path, body, _ = request(store, kind)
    provider.update(changes)
    response = api.post(path, headers=auth('customer'), json=body)
    assert response.status_code == 409, response.text
    assert reads == ['payments/pay_saved'] and store.writes == []


@pytest.mark.parametrize('kind', ['booking', 'spare'])
def test_verified_checkout_retains_exact_retry_without_duplicate_fulfillment(legacy, kind):
    api, store, _, reads = legacy
    path, body, payment = request(store, kind)
    first = api.post(path, headers=auth('customer'), json=body)
    assert first.status_code == 201, first.text
    again = api.post(path, headers=auth('customer'), json=body)
    assert again.status_code == 201 and again.json() == first.json()
    assert store.rows['payment_orders', payment['id']]['status'] == 'paid'
    collection = 'bookings' if kind == 'booking' else 'spare_orders'
    assert len([name for name, _ in store.rows if name == collection]) == 1
    assert reads == ['payments/pay_saved', 'payments/pay_saved']


@pytest.mark.parametrize('kind', ['booking', 'spare'])
def test_refunded_legacy_checkout_cannot_be_reopened_by_stale_capture(legacy, kind):
    api, store, _, reads = legacy
    path, body, payment = request(store, kind)
    payment.update(status='refunded', razorpay_payment_id='pay_saved')
    response = api.post(path, headers=auth('customer'), json=body)
    assert response.status_code == 409 and store.writes == [] and reads == []


@pytest.mark.parametrize('kind', ['booking', 'spare'])
def test_checkout_rejects_non_ascii_signature_without_provider_work(legacy, kind):
    api, store, _, reads = legacy
    path, body, _ = request(store, kind)
    response = api.post(path, headers=auth('customer'), json={**body, 'razorpay_signature': '\u00ff' * 64})
    assert response.status_code == 400 and store.writes == [] and reads == []


@pytest.mark.parametrize('kind', ['booking', 'spare'])
def test_paid_record_cannot_be_rebound_to_another_provider_payment(legacy, kind):
    api, store, _, reads = legacy
    path, body, payment = request(store, kind)
    payment.update(status='paid', razorpay_payment_id='pay_original')
    response = api.post(path, headers=auth('customer'), json=body)
    assert response.status_code == 409 and store.writes == [] and reads == []


@pytest.mark.parametrize('kind', ['booking', 'spare'])
@pytest.mark.parametrize('change', ['refund', 'amount', 'metadata', 'payment_id'])
def test_firestore_checkout_rechecks_payment_after_provider_read(legacy, monkeypatch, kind, change):
    api, store, provider, _ = legacy
    path, body, payment = request(store, kind)
    def changed_payment(route, payload=None, **kwargs):
        assert route == 'payments/pay_saved' and payload is None
        saved = store.rows['payment_orders', payment['id']]
        if change == 'refund':
            saved['status'] = 'refunded'
        elif change == 'amount':
            saved['amount_paise'] = 1
        elif change == 'metadata':
            saved['metadata']['address'] = 'Changed after the captured payment was read'
        else:
            saved['razorpay_payment_id'] = 'pay_other'
        return copy.deepcopy(provider)
    monkeypatch.setattr(integrations, 'razorpay', changed_payment)
    response = api.post(path, headers=auth('customer'), json=body)
    assert response.status_code == 409, response.text
    assert store.writes == []
    assert not any(name in ('bookings', 'spare_orders') for name, _ in store.rows)


def save_sqlite_payment(payment):
    with main.db() as connection:
        connection.execute('INSERT OR IGNORE INTO users VALUES(?,?,?,?,?)',
            ('customer', 'Synthetic customer', 'synthetic@example.com', 'provider-only', int(time.time())))
        connection.execute('INSERT INTO payment_orders (id,user_id,purpose,amount_paise,currency,razorpay_order_id,status,metadata,razorpay_payment_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
            (payment['id'], payment['user_id'], payment['purpose'], payment['amount_paise'], payment['currency'],
             payment['razorpay_order_id'], payment['status'], json.dumps(payment['metadata']),
             payment.get('razorpay_payment_id'), int(time.time())))


@pytest.fixture
def sqlite_checkout(api, monkeypatch):
    monkeypatch.setenv('RAZORPAY_KEY_SECRET', 'synthetic-legacy-checkout-secret')
    provider = dict(id='pay_saved', order_id='order_saved', amount=15000, currency='INR',
                    status='captured', captured=True, amount_refunded=0)
    def get(route, payload=None, **kwargs):
        assert route == 'payments/pay_saved' and payload is None
        return copy.deepcopy(provider)
    monkeypatch.setattr(integrations, 'razorpay', get)
    return api, provider


@pytest.mark.parametrize('kind', ['booking', 'spare'])
def test_sqlite_paid_without_fulfillment_requires_reconciliation(sqlite_checkout, kind):
    api, _ = sqlite_checkout
    path, body, payment = request(MemoryFirestore(), kind)
    payment.update(status='paid', razorpay_payment_id='pay_saved')
    save_sqlite_payment(payment)
    response = api.post(path, headers=auth('customer'), json=body)
    assert response.status_code == 409, response.text
    with main.db() as connection:
        saved = connection.execute('SELECT status,razorpay_payment_id FROM payment_orders WHERE id=?', (payment['id'],)).fetchone()
        assert tuple(saved) == ('paid', 'pay_saved')
        table = 'bookings' if kind == 'booking' else 'spare_orders'
        assert connection.execute('SELECT count(*) FROM ' + table).fetchone()[0] == 0


@pytest.mark.parametrize('starts_at', [None, 'not-a-time', '2030-10-20T09:00:00', '2000-01-01T09:00:00+05:30'])
def test_sqlite_paid_booking_requires_valid_available_future_slot(sqlite_checkout, starts_at):
    api, _ = sqlite_checkout
    path, body, payment = request(MemoryFirestore(), 'booking')
    payment['metadata']['starts_at'] = starts_at
    save_sqlite_payment(payment)
    response = api.post(path, headers=auth('customer'), json=body)
    assert response.status_code == 409, response.text
    with main.db() as connection:
        saved = connection.execute('SELECT status,razorpay_payment_id FROM payment_orders WHERE id=?', (payment['id'],)).fetchone()
        assert tuple(saved) == ('created', None)
        assert connection.execute('SELECT count(*) FROM bookings').fetchone()[0] == 0


def test_sqlite_paid_booking_capacity_failure_preserves_created_payment(sqlite_checkout):
    api, _ = sqlite_checkout
    path, body, payment = request(MemoryFirestore(), 'booking')
    save_sqlite_payment(payment)
    for index in range(3):
        booking = main.BookingInput(**{**payment['metadata'], 'idempotency_key': 'synthetic-occupant-' + str(index)})
        created = api.post('/bookings', headers=auth('customer'), json=booking.model_dump())
        assert created.status_code == 201, created.text
    response = api.post(path, headers=auth('customer'), json=body)
    assert response.status_code == 409, response.text
    with main.db() as connection:
        saved = connection.execute('SELECT status,razorpay_payment_id FROM payment_orders WHERE id=?', (payment['id'],)).fetchone()
        assert tuple(saved) == ('created', None)
        assert connection.execute('SELECT count(*) FROM bookings').fetchone()[0] == 3


@pytest.mark.parametrize('kind', ['booking', 'spare'])
@pytest.mark.parametrize('change', ['refund', 'amount', 'metadata'])
def test_sqlite_checkout_rechecks_payment_after_provider_read(sqlite_checkout, monkeypatch, kind, change):
    api, provider = sqlite_checkout
    path, body, payment = request(MemoryFirestore(), kind)
    save_sqlite_payment(payment)
    def changed_payment(route, payload=None, **kwargs):
        assert route == 'payments/pay_saved' and payload is None
        with main.db() as connection:
            if change == 'refund':
                connection.execute('UPDATE payment_orders SET status=? WHERE id=?', ('refunded', payment['id']))
            elif change == 'amount':
                connection.execute('UPDATE payment_orders SET amount_paise=? WHERE id=?', (1, payment['id']))
            else:
                metadata = {**payment['metadata'], 'address': 'Changed after the captured payment was read'}
                connection.execute('UPDATE payment_orders SET metadata=? WHERE id=?', (json.dumps(metadata), payment['id']))
        return copy.deepcopy(provider)
    monkeypatch.setattr(integrations, 'razorpay', changed_payment)
    response = api.post(path, headers=auth('customer'), json=body)
    assert response.status_code == 409, response.text
    with main.db() as connection:
        saved = connection.execute('SELECT status,razorpay_payment_id FROM payment_orders WHERE id=?', (payment['id'],)).fetchone()
        assert tuple(saved) == ('refunded' if change == 'refund' else 'created', None)
        table = 'bookings' if kind == 'booking' else 'spare_orders'
        assert connection.execute('SELECT count(*) FROM ' + table).fetchone()[0] == 0


@pytest.mark.parametrize('kind', ['booking', 'spare'])
@pytest.mark.parametrize('captured', [True, False])
def test_sqlite_checkout_uses_provider_capture_and_preserves_exact_retry(api, monkeypatch, kind, captured):
    path, body, payment = request(MemoryFirestore(), kind)
    monkeypatch.setenv('RAZORPAY_KEY_SECRET', 'synthetic-legacy-checkout-secret')
    reads = []
    def provider(route, payload=None, **kwargs):
        assert payload is None
        reads.append(route)
        return dict(id='pay_saved', order_id='order_saved', amount=15000, currency='INR',
                    status='captured' if captured else 'authorized', captured=captured, amount_refunded=0)
    monkeypatch.setattr(integrations, 'razorpay', provider)
    with main.db() as connection:
        connection.execute('INSERT INTO users VALUES(?,?,?,?,?)', ('customer', 'Synthetic customer', 'synthetic@example.com', 'provider-only', int(time.time())))
        connection.execute('INSERT INTO payment_orders (id,user_id,purpose,amount_paise,currency,razorpay_order_id,status,metadata,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
            (payment['id'], payment['user_id'], payment['purpose'], payment['amount_paise'], payment['currency'], payment['razorpay_order_id'], payment['status'], json.dumps(payment['metadata']), int(time.time())))
    response = api.post(path, headers=auth('customer'), json=body)
    assert response.status_code == (201 if captured else 409), response.text
    if captured:
        retry = api.post(path, headers=auth('customer'), json=body)
        assert retry.status_code == 201
        assert retry.json().get('id', retry.json().get('order_id')) == response.json().get('id', response.json().get('order_id'))
    with main.db() as connection:
        saved = connection.execute('SELECT status FROM payment_orders WHERE id=?', (payment['id'],)).fetchone()
        assert saved['status'] == ('paid' if captured else 'created')
        table = 'bookings' if kind == 'booking' else 'spare_orders'
        assert connection.execute('SELECT count(*) FROM ' + table).fetchone()[0] == int(captured)
    assert reads == ['payments/pay_saved'] * (2 if captured else 1)


@pytest.mark.parametrize('route,body', [
    ('order', {'plan': 'monthly', 'application_id': 'other-application'}),
    ('verify', {'order_id': 'order_saved', 'payment_id': 'pay_saved', 'application_id': 'other-application',
                'signature': hmac.new(b'synthetic-legacy-checkout-secret', b'order_saved|pay_saved', hashlib.sha256).hexdigest()}),
])
def test_retired_specialist_payment_routes_never_modify_historical_records(api, monkeypatch, route, body):
    monkeypatch.setenv('RAZORPAY_KEY_SECRET', 'synthetic-legacy-checkout-secret')
    monkeypatch.setenv('RAZORPAY_KEY_ID', 'synthetic-key-id')
    def forbidden(*args, **kwargs):
        pytest.fail('Retired specialist payments must never call a provider or Firestore.')
    monkeypatch.setattr(main.urllib.request, 'urlopen', forbidden)
    monkeypatch.setattr(main, 'fs_doc', forbidden)
    with main.db() as connection:
        connection.execute('INSERT INTO specialist_payments (id,application_id,plan,amount_paise,razorpay_order_id,status,created_at) VALUES (?,?,?,?,?,?,?)',
            ('historical', 'original-application', 'monthly', 149900, 'order_saved', 'created', int(time.time())))
    response = api.post('/specialist-payments/' + route, json=body)
    assert response.status_code == 409, response.text
    assert '/operations/worker/onboarding' in response.json()['detail']
    with main.db() as connection:
        saved = connection.execute('SELECT * FROM specialist_payments WHERE id=?', ('historical',)).fetchone()
        assert saved['status'] == 'created' and saved['application_id'] == 'original-application' and saved['razorpay_payment_id'] is None
