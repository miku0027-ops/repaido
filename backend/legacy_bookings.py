"""Transactional persistence for the legacy Firestore booking endpoints."""
import hashlib
import json
import uuid
from datetime import datetime

from fastapi import HTTPException
from firebase_admin import firestore
from google.api_core.exceptions import Aborted


def run_transaction(core, callback):
    """Return a retryable conflict when Firestore exhausts bounded retries."""
    try:
        return callback(core.fb_db.transaction())
    except Aborted as error:
        raise HTTPException(409, 'This request changed concurrently. Please retry.') from error
    except ValueError as error:
        # The SDK wraps exhausted commit retries, preserving Aborted as its cause.
        if isinstance(error.__cause__, Aborted):
            raise HTTPException(409, 'This request changed concurrently. Please retry.') from error
        raise


def _key(*parts):
    return hashlib.sha256(json.dumps(parts, separators=(',', ':')).encode()).hexdigest()


def _request_ref(core, booking):
    return core.fs_doc('booking_requests', _key(booking['user_id'], booking['idempotency_key']))


def _slot_ref(core, booking):
    return core.fs_doc('booking_slots', _key(booking['service_id'], booking['city'], booking['starts_at']))


def _read_guards(core, tx, *bookings):
    refs = {_slot_ref(core, booking).path: _slot_ref(core, booking) for booking in bookings}
    result = []
    for _, ref in sorted(refs.items()):
        snapshot = ref.get(transaction=tx)
        result.append((ref, (snapshot.to_dict() or {}).get('version', 0)))
    return result


def _write_guards(tx, guards):
    for ref, version in guards:
        tx.set(ref, {'version': version + 1})


def _existing(core, tx, booking):
    request = _request_ref(core, booking).get(transaction=tx)
    if request.exists:
        return core.fs_doc('bookings', request.to_dict()['booking_id']).get(transaction=tx)
    # Retain idempotency for records written before request markers existed.
    rows = core.fs_collection('bookings').where('user_id', '==', booking['user_id']).where('idempotency_key', '==', booking['idempotency_key']).limit(1).stream(transaction=tx)
    return next(iter(rows), None)


def _same_request(existing, booking):
    fields = ('service_id', 'city', 'address', 'phone', 'notes', 'starts_at')
    if any(existing.get(field, '') != booking.get(field, '') for field in fields):
        raise HTTPException(409, 'This request key was already used for a different booking.')


def _capacity(core, tx, booking, excluding=None):
    rows = core.fs_collection('bookings').where('service_id', '==', booking['service_id']).where('city', '==', booking['city']).where('starts_at', '==', booking['starts_at']).stream(transaction=tx)
    used = sum(1 for row in rows if row.id != excluding and row.to_dict().get('status') != 'cancelled')
    if used >= 3:
        raise HTTPException(409, 'This time just filled up. Choose another slot.')


def create(core, body, user, canonical_start):
    booking = {'id': str(uuid.uuid4()), 'user_id': user['id'], 'service_id': body.service_id,
               'city': body.city, 'address': body.address.strip(), 'phone': body.phone,
               'notes': body.notes.strip(), 'starts_at': canonical_start,
               'idempotency_key': body.idempotency_key, 'status': 'requested',
               'professional_name': None, 'tracking_status': 'requested',
               'created_at': core.fs_now(), 'updated_at': core.fs_now()}

    @firestore.transactional
    def apply(tx):
        existing = _existing(core, tx, booking)
        if existing and existing.exists:
            _same_request(existing.to_dict(), booking)
            return existing.id
        service = core.fs_doc('services', body.service_id).get(transaction=tx)
        if not service.exists:
            raise HTTPException(404, 'Service not found.')
        if canonical_start not in {d.isoformat() for d in core.candidates()}:
            raise HTTPException(409, 'This time is no longer available. Choose another slot.')
        guards = _read_guards(core, tx, booking)
        _capacity(core, tx, booking)
        record = {**booking, 'price_paise': service.to_dict()['price_paise']}
        tx.set(core.fs_doc('bookings', record['id']), record)
        tx.set(_request_ref(core, record), {'booking_id': record['id']})
        _write_guards(tx, guards)
        return record['id']

    return core.firestore_booking_output(run_transaction(core, apply))


def cancel(core, booking_id, body, user):
    @firestore.transactional
    def apply(tx):
        ref = core.fs_doc('bookings', booking_id)
        snapshot = ref.get(transaction=tx)
        data = snapshot.to_dict() or {}
        if not snapshot.exists or data.get('user_id') != user['id']:
            raise HTTPException(404, 'Booking not found.')
        if data.get('status') == 'cancelled':
            return
        if data.get('status') not in ('requested', 'confirmed') or datetime.fromisoformat(data['starts_at']) <= datetime.now(core.IST):
            raise HTTPException(409, 'This booking can no longer be cancelled in the app. Contact support.')
        guards = _read_guards(core, tx, data)
        tx.update(ref, {'status': 'cancelled', 'cancellation_reason': body.reason.strip() if body else 'Customer requested cancellation', 'tracking_status': 'cancelled', 'updated_at': core.fs_now()})
        _write_guards(tx, guards)

    run_transaction(core, apply)
    return core.firestore_booking_output(booking_id)


def reschedule(core, booking_id, body, user, canonical_start):
    @firestore.transactional
    def apply(tx):
        ref = core.fs_doc('bookings', booking_id)
        snapshot = ref.get(transaction=tx)
        data = snapshot.to_dict() or {}
        if not snapshot.exists or data.get('user_id') != user['id']:
            raise HTTPException(404, 'Booking not found.')
        if data.get('status') not in ('requested', 'confirmed'):
            raise HTTPException(409, 'This booking cannot be rescheduled now.')
        destination = {**data, 'starts_at': canonical_start}
        guards = _read_guards(core, tx, data, destination)
        _capacity(core, tx, destination, excluding=booking_id)
        tx.update(ref, {'starts_at': canonical_start, 'reschedule_reason': body.reason.strip(), 'tracking_status': 'requested', 'updated_at': core.fs_now()})
        _write_guards(tx, guards)

    run_transaction(core, apply)
    return core.firestore_booking_output(booking_id)


def complete_paid_booking(core, payment_id, expected_payment, booking, updates):
    """Commit a captured payment and its capacity reservation in one transaction.

    Provider verification is performed by the caller before entering this retryable
    transaction. Re-reading immutable order fields prevents a stale proof from
    authorizing a changed order. Every booking writer shares the same slot guard.
    """
    @firestore.transactional
    def apply(tx):
        ref = core.fs_doc('payment_orders', payment_id)
        snapshot = ref.get(transaction=tx)
        payment = snapshot.to_dict() or {}
        immutable = ('user_id', 'purpose', 'razorpay_order_id', 'amount_paise', 'currency', 'metadata')
        if not snapshot.exists or any(payment.get(field) != expected_payment.get(field) for field in immutable):
            raise HTTPException(409, 'This payment changed and requires reconciliation.')
        if payment.get('status') not in ('created', 'paid') or payment.get('razorpay_payment_id') not in (None, updates['razorpay_payment_id']):
            raise HTTPException(409, 'This payment requires reconciliation before it can be confirmed.')
        existing = _existing(core, tx, booking)
        if existing and existing.exists:
            data = existing.to_dict()
            # A request paid via another order must never silently consume this payment.
            if (payment.get('status') != 'paid' or data.get('user_id') != booking['user_id']
                    or data.get('payment_status') != 'paid'
                    or data.get('payment_order_id') != payment_id or data.get('payment_id') != updates['razorpay_payment_id']):
                raise HTTPException(409, 'This booking request already belongs to another payment.')
            return existing.id
        if payment.get('status') == 'paid':
            raise HTTPException(409, 'This payment requires reconciliation before it can be confirmed.')
        if booking['starts_at'] not in {d.isoformat() for d in core.candidates()}:
            raise HTTPException(409, 'This appointment requires reconciliation. Choose an available future time.')
        guards = _read_guards(core, tx, booking)
        _capacity(core, tx, booking)
        tx.set(core.fs_doc('bookings', booking['id']), booking)
        tx.set(_request_ref(core, booking), {'booking_id': booking['id']})
        tx.update(ref, updates)
        _write_guards(tx, guards)
        return booking['id']

    return run_transaction(core, apply)
