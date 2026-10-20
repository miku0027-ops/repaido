"""Durable compatibility checkout intents and unfulfilled-payment recovery.

Provider I/O is outside retryable database transactions. A refund reservation
and booking fulfillment share the same native transaction read set. Uncertain
provider POSTs are looked up by a stable receipt, never submitted a second time.
"""
import hashlib
import hmac
import json
import os
import re
import time
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import Field

from operations import Input
import integrations
from integrations import audit

CASES = 'legacy_checkout_cases'
INTENTS = 'legacy_checkout_intents'
HOLD = {'refund_submitting', 'refund_pending', 'refunded', 'refund_failed'}
PRIVATE = {'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer'}


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def razorpay(path, body=None):
    return integrations.razorpay(path, body)


def normalized(payment):
    payment = dict(payment) if payment else None
    if payment and isinstance(payment.get('metadata'), str):
        payment['metadata'] = json.loads(payment['metadata'])
    return payment


def raw_payment(u, key):
    if u.tx is not None:
        snapshot = u.core.fs_doc('payment_orders', key).get(transaction=u.tx)
        return normalized(snapshot.to_dict()) if snapshot.exists else None
    return normalized(u.conn.execute('SELECT * FROM payment_orders WHERE id=?', (key,)).fetchone())


def update_payment(u, key, changes):
    if set(changes)-{'status', 'metadata', 'razorpay_payment_id', 'paid_at'}:
        raise ValueError('Unsupported compatibility payment update')
    if u.tx is not None:
        u.tx.update(u.core.fs_doc('payment_orders', key), changes)
    else:
        values = {field: json.dumps(value) if field == 'metadata' else value for field, value in changes.items()}
        u.conn.execute('UPDATE payment_orders SET '+','.join(field+'=?' for field in values)+' WHERE id=?', (*values.values(), key))


def same_payment(current, expected):
    expected = normalized(expected)
    fields = ('user_id', 'purpose', 'razorpay_order_id', 'amount_paise', 'currency', 'metadata')
    return bool(current and all(current.get(field) == expected.get(field) for field in fields))


def allocation_guard(case):
    if case and case.get('state') in HOLD:
        raise HTTPException(409, 'This unconfirmed payment is being refunded. Do not start another payment.')


def completed_case(case, booking_id):
    if not case or case.get('state') == 'fulfilled': return case
    return {**case,'state':'fulfilled','booking_id':booking_id,'active':False,
            'version':case['version']+1,'updated_at':time.time()}


def response_order(intent):
    return {'payment_order_id': intent['payment_order_id'], 'razorpay_order_id': intent['order_id'],
            'key_id': os.getenv('RAZORPAY_KEY_ID', ''), 'amount_paise': intent['amount_paise'], 'currency': 'INR'}


def provider_order(order, intent):
    if (not isinstance(order, dict) or not re.fullmatch(r'order_[A-Za-z0-9]+', str(order.get('id', '')))
            or order.get('receipt') != intent['receipt'] or order.get('currency') != 'INR'
            or type(order.get('amount')) is not int or order['amount'] != intent['amount_paise']):
        raise HTTPException(409, 'The payment order needs provider reconciliation. Do not start another payment.')


def create_order(core, body, user):
    if not integrations.configured('RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'):
        raise HTTPException(503, 'The payment provider is not configured. No payment order was submitted.')
    if body.city not in core.CITIES:
        raise HTTPException(422, 'Choose a supported city.')
    if len(body.address.strip()) < 10:
        raise HTTPException(422, 'Enter your complete service address.')
    try:
        start = datetime.fromisoformat(body.starts_at)
        if start.tzinfo is None: raise ValueError()
        start = start.astimezone(core.IST).isoformat()
    except (ValueError, TypeError):
        raise HTTPException(422, 'Choose a valid future appointment time.') from None
    metadata = {'service_id': body.service_id, 'city': body.city, 'address': body.address.strip(),
                'phone': body.phone, 'notes': body.notes.strip(), 'starts_at': start,
                'idempotency_key': body.idempotency_key, 'specialist_id': body.specialist_id}
    fingerprint = digest(json.dumps(metadata, sort_keys=True, separators=(',', ':')))
    key = digest(user['id']+':'+body.idempotency_key)
    payment_id = str(uuid.uuid5(uuid.NAMESPACE_URL, 'repaido-booking-checkout:'+key))
    def reserve(u):
        old = u.get(INTENTS, key)
        if old:
            if old['fingerprint'] != fingerprint:
                raise HTTPException(409, 'This checkout request was already used for different booking details.')
            return old, False
        if start not in {candidate.isoformat() for candidate in core.candidates()}:
            raise HTTPException(409, 'Choose an available future appointment before payment.')
        if u.tx is not None:
            service = core.fs_doc('services', body.service_id).get(transaction=u.tx)
            if not service.exists: raise HTTPException(404, 'Service not found.')
            from legacy_bookings import _capacity
            _capacity(core, u.tx, metadata)
        else:
            core.service_by_id(u.conn, body.service_id)
            used = u.conn.execute("SELECT count(*) FROM bookings WHERE service_id=? AND city=? AND starts_at=? AND status!='cancelled'", (body.service_id, body.city, start)).fetchone()[0]
            if used >= 3: raise HTTPException(409, 'This time is full. Choose another time before payment.')
        intent = {'id': key, 'customer_id': user['id'], 'fingerprint': fingerprint,
                  'payment_order_id': payment_id, 'metadata': metadata,
                  'amount_paise': core.CITY_BASE_FARES_PAISE[body.city], 'currency': 'INR',
                  'receipt': 'book_'+key[:32], 'state': 'creating', 'created_at': time.time()}
        u.put(INTENTS, key, intent)
        return intent, True
    intent, created = core.operations_store.run(reserve)
    if intent.get('order_id'):
        return response_order(intent)
    if created:
        order = razorpay('orders', {'amount': intent['amount_paise'], 'currency': 'INR',
                                   'receipt': intent['receipt'], 'notes': {'purpose': 'booking', 'user_id': user['id']}})
    else:
        result = razorpay('orders?receipt='+intent['receipt'])
        items = result.get('items') if isinstance(result, dict) else None
        if not isinstance(items, list) or len(items) > 100:
            raise HTTPException(503, 'The earlier payment order is still being checked. Do not start another payment.')
        matches = [row for row in items if isinstance(row, dict) and row.get('receipt') == intent['receipt']]
        if len(matches) != 1:
            raise HTTPException(503, 'The earlier payment order is still being checked. No new order was submitted.')
        order = matches[0]
    provider_order(order, intent)
    def attach(u):
        saved = u.get(INTENTS, key)
        current = raw_payment(u, payment_id)
        case = u.get(CASES, payment_id)
        if saved.get('order_id') not in (None, order['id']):
            raise HTTPException(409, 'This checkout has a conflicting payment order.')
        payment = {'id': payment_id, 'user_id': user['id'], 'purpose': 'booking',
                   'razorpay_order_id': order['id'], 'amount_paise': intent['amount_paise'],
                   'currency': 'INR', 'status': 'created', 'metadata': metadata, 'created_at': int(time.time())}
        if current and not same_payment(current, payment):
            raise HTTPException(409, 'This checkout order changed and needs reconciliation.')
        if not current:
            if u.tx is not None:
                u.tx.set(core.fs_doc('payment_orders', payment_id), payment)
            else:
                u.conn.execute('INSERT INTO payment_orders(id,user_id,purpose,amount_paise,currency,razorpay_order_id,status,metadata,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
                    (payment_id,user['id'],'booking',payment['amount_paise'],'INR',order['id'],'created',json.dumps(metadata),payment['created_at']))
        saved.update(state='created', order_id=order['id'])
        u.put(INTENTS, key, saved)
        if not case:
            u.put(CASES, payment_id, {'id': payment_id, 'customer_id': user['id'], 'order_id': order['id'],
                'amount_paise': payment['amount_paise'], 'service_id': body.service_id, 'starts_at': start,
                'state': 'checking_payment', 'version': 1, 'active': False, 'next_check_at': time.time()+30,
                'created_at': time.time(), 'updated_at': time.time()})
        return saved
    return response_order(core.operations_store.run(attach))


def remember_capture(core, payment, body, captured):
    def save(u):
        current = raw_payment(u, body.payment_order_id)
        case = u.get(CASES, body.payment_order_id)
        core.checkout_payment_record(current, body, payment['user_id'], 'booking')
        if not same_payment(current, payment) or current.get('status') not in ('created', 'paid'):
            raise HTTPException(409, 'This payment changed and requires reconciliation.')
        if case and case.get('payment_id') not in (None, body.razorpay_payment_id):
            raise HTTPException(409, 'This checkout already belongs to another payment.')
        if case and case.get('state') in HOLD: allocation_guard(case)
        if case and case.get('payment_id') == body.razorpay_payment_id:
            return case
        metadata = current['metadata']
        if not case:
            case = {'id': body.payment_order_id, 'customer_id': current['user_id'], 'order_id': current['razorpay_order_id'],
                    'amount_paise': current['amount_paise'], 'service_id': metadata['service_id'],
                    'starts_at': metadata['starts_at'], 'version': 0, 'created_at': time.time()}
        if case.get('state') != 'fulfilled':
            case.update(state='confirmation_pending', payment_id=body.razorpay_payment_id,
                        captured_paise=captured['amount'], active=True, next_check_at=time.time()+30,
                        version=case['version']+1, updated_at=time.time())
            u.put(CASES, case['id'], case)
        return case
    return core.operations_store.run(save)


def mark_result(core, key, user_id, booking_id=None):
    def save(u):
        case = u.get(CASES, key)
        if not case or case['customer_id'] != user_id or case.get('state') in HOLD: return
        if case.get('state') == 'fulfilled': return
        if booking_id: case.update(state='fulfilled', booking_id=booking_id, active=False)
        elif case.get('payment_id'): case.update(state='action_required', active=False)
        else: return
        case.update(version=case['version']+1, updated_at=time.time())
        u.put(CASES, key, case)
    core.operations_store.run(save)


def payment_for(core, key, user_id):
    payment = core.operations_store.run(lambda u: raw_payment(u, key))
    if not payment or payment.get('purpose') != 'booking' or payment.get('user_id') != user_id:
        raise HTTPException(404, 'Booking payment not found.')
    return payment


def verify(core, body, user):
    payment = core.checkout_payment_record(payment_for(core, body.payment_order_id, user['id']), body, user['id'], 'booking')
    captured = core.checkout_payment_capture(payment, body)
    remember_capture(core, payment, body, captured)
    try:
        booking = core.fulfill_booking_payment(body, user, payment)
    except HTTPException as error:
        if error.status_code == 409:
            mark_result(core, body.payment_order_id, user['id'])
        raise
    mark_result(core, body.payment_order_id, user['id'], booking['id'])
    return booking


def signed_proof(core, payment, provider_payment):
    # Ownership is checked before any provider request. Provider GET, not this
    # internal signature, proves that the exact saved order was captured.
    payment_id = provider_payment.get('id', '')
    if not re.fullmatch(r'pay_[A-Za-z0-9]+', payment_id):
        raise HTTPException(409, 'This payment needs provider reconciliation.')
    secret = os.getenv('RAZORPAY_KEY_SECRET', '')
    if not secret: raise HTTPException(503, 'The payment provider is not configured.')
    signature = hmac.new(secret.encode(), (payment['razorpay_order_id']+'|'+payment_id).encode(), hashlib.sha256).hexdigest()
    return core.PaymentVerificationInput(payment_order_id=payment['id'], razorpay_order_id=payment['razorpay_order_id'],
        razorpay_payment_id=payment_id, razorpay_signature=signature)


def case_for(core, key, user_id):
    case = core.operations_store.run(lambda u: u.get(CASES, key))
    if not case or case.get('customer_id') != user_id:
        raise HTTPException(404, 'Booking payment not found.')
    return case


def public_case(case):
    return {field: case[field] for field in ('id','service_id','starts_at','state','version','amount_paise','booking_id','updated_at') if field in case}


def recover(core, key, user_id):
    payment = payment_for(core, key, user_id)
    case = case_for(core, key, user_id)
    if case['state'] in HOLD:
        return reconcile_refund(core, case)
    if case['state'] == 'fulfilled': return case
    if case.get('payment_id'):
        provider_payment = razorpay('payments/'+case['payment_id'])
    else:
        result = razorpay('orders/'+payment['razorpay_order_id']+'/payments')
        items = result.get('items') if isinstance(result, dict) else None
        if not isinstance(items, list) or len(items)>100:
            raise HTTPException(503, 'Payment status could not be verified. Do not start another payment.')
        captured = [item for item in items if isinstance(item, dict) and item.get('captured') is True and item.get('status') in ('captured','refunded')]
        if not captured: return case
        if len(captured) != 1: raise HTTPException(409, 'Multiple payments need provider review. Do not pay again.')
        provider_payment = captured[0]
    if (provider_payment.get('status') == 'refunded' and provider_payment.get('id')
            and provider_payment.get('order_id') == payment['razorpay_order_id']
            and provider_payment.get('currency') == 'INR'
            and type(provider_payment.get('amount')) is int and provider_payment['amount'] == payment['amount_paise']
            and type(provider_payment.get('amount_refunded')) is int and provider_payment['amount_refunded'] == payment['amount_paise']):
        def externally_refunded(u):
            current = raw_payment(u,key)
            saved = u.get(CASES,key)
            if not same_payment(current,payment) or current['status'] not in ('created','refunded') or saved.get('state') == 'fulfilled':
                raise HTTPException(409,'This refund requires booking reconciliation.')
            allocation_guard(saved)
            saved.update(state='refunded',active=False,version=saved['version']+1,updated_at=time.time())
            update_payment(u,key,{'status':'refunded','razorpay_payment_id':provider_payment['id']})
            u.put(CASES,key,saved)
            audit(u,'UnfulfilledBookingExternalRefundVerified','provider',payment_order_id=key)
            return saved
        return core.operations_store.run(externally_refunded)
    proof = signed_proof(core, payment, provider_payment)
    # verify performs the same exact amount/currency/capture and native
    # fulfillment checks as a gateway callback, and records any allocation gap.
    try:
        verify(core, proof, {'id': user_id})
    except HTTPException as error:
        if error.status_code != 409: raise
    return case_for(core, key, user_id)


class Recovery(Input):
    expected_version: int = Field(ge=1)
    starts_at: str = Field(max_length=100)


class Refund(Input):
    expected_version: int = Field(ge=1)


def reschedule(core, key, body, user_id):
    try:
        start = datetime.fromisoformat(body.starts_at)
        if start.tzinfo is None: raise ValueError()
        start = start.astimezone(core.IST).isoformat()
    except (ValueError, TypeError):
        raise HTTPException(422, 'Choose a valid future appointment time.') from None
    if start not in {candidate.isoformat() for candidate in core.candidates()}:
        raise HTTPException(409, 'Choose an available future time.')
    def change(u):
        case = u.get(CASES, key)
        payment = raw_payment(u, key)
        if not case or case.get('customer_id') != user_id or not payment or payment.get('user_id') != user_id:
            raise HTTPException(404, 'Booking payment not found.')
        allocation_guard(case)
        if case.get('state') != 'action_required' or not case.get('payment_id') or payment.get('status') != 'created':
            raise HTTPException(409, 'This checkout cannot change its appointment now.')
        if case['version'] != body.expected_version:
            raise HTTPException(409, 'Payment status changed. Refresh before choosing another time.')
        before = payment['metadata']['starts_at']
        payment['metadata']['starts_at'] = start
        case.update(starts_at=start, state='confirmation_pending', version=case['version']+1, active=True, next_check_at=time.time()+30, updated_at=time.time())
        update_payment(u, key, {'metadata': payment['metadata']})
        u.put(CASES, key, case)
        audit(u, 'UnfulfilledBookingRescheduled', user_id, payment_order_id=key, previous_start=before, starts_at=start)
    core.operations_store.run(change)
    return recover(core, key, user_id)


def refund(core, key, body, user_id):
    case = case_for(core, key, user_id)
    payment = payment_for(core, key, user_id)
    if case['state'] in HOLD: return reconcile_refund(core, case)
    if not case.get('payment_id') or case.get('state') not in ('action_required','confirmation_pending'):
        raise HTTPException(409, 'A verified unconfirmed payment is required for this refund.')
    proof = signed_proof(core, payment, {'id': case['payment_id']})
    core.checkout_payment_capture(payment, proof)
    def reserve(u):
        saved = u.get(CASES, key)
        current = raw_payment(u, key)
        if not saved or saved.get('customer_id') != user_id or not same_payment(current, payment):
            raise HTTPException(409, 'This payment changed. Refresh before requesting a refund.')
        if saved['state'] in HOLD: return saved, False
        if current.get('status') != 'created' or saved.get('state') not in ('action_required','confirmation_pending') or saved['version'] != body.expected_version:
            raise HTTPException(409, 'Booking status changed. A confirmed booking cannot use this refund flow.')
        saved.update(state='refund_submitting', active=True, refund_receipt='lb_'+digest(key)[:32],
                     version=saved['version']+1, next_check_at=time.time()+30, updated_at=time.time())
        u.put(CASES, key, saved)
        audit(u, 'UnfulfilledBookingRefundRequested', user_id, payment_order_id=key, amount_paise=payment['amount_paise'])
        return saved, True
    saved, created = core.operations_store.run(reserve)
    if created:
        result = razorpay('payments/'+saved['payment_id']+'/refund', {'amount': saved['amount_paise'],
            'receipt': saved['refund_receipt'], 'speed': 'normal', 'notes': {'repaido_checkout': key}})
        return save_refund(core, saved, result)
    return reconcile_refund(core, saved)


def save_refund(core, case, result):
    if (not isinstance(result, dict) or not re.fullmatch(r'rfnd_[A-Za-z0-9]+', str(result.get('id','')))
            or result.get('payment_id') != case['payment_id'] or result.get('receipt') != case['refund_receipt']
            or type(result.get('amount')) is not int or result['amount'] != case['amount_paise']
            or result.get('currency') != 'INR' or result.get('status') not in ('pending','processed','failed')):
        raise HTTPException(409, 'Refund details need provider reconciliation. No additional refund was submitted.')
    provider_payment = razorpay('payments/'+case['payment_id'])
    if (provider_payment.get('id') != case['payment_id'] or provider_payment.get('order_id') != case['order_id']
            or type(provider_payment.get('amount')) is not int or provider_payment['amount'] != case['amount_paise']
            or provider_payment.get('currency') != 'INR'):
        raise HTTPException(409, 'Refund payment details need provider reconciliation.')
    if result['status'] == 'processed' and (provider_payment.get('status') != 'refunded'
            or type(provider_payment.get('amount_refunded')) is not int or provider_payment['amount_refunded'] != case['amount_paise']):
        raise HTTPException(409, 'Refund settlement is still being verified.')
    def save(u):
        saved = u.get(CASES, case['id'])
        current = raw_payment(u, case['id'])
        if not saved or saved.get('state') not in HOLD or saved.get('payment_id') != case['payment_id'] or current.get('status') not in ('created','refunded'):
            raise HTTPException(409, 'Refund reservation changed and needs review.')
        if saved.get('refund_id') not in (None, result['id']):
            raise HTTPException(409, 'Multiple refunds need provider review.')
        if saved['state'] == 'refunded': return saved
        state = {'pending':'refund_pending','processed':'refunded','failed':'refund_failed'}[result['status']]
        saved.update(state=state, refund_id=result['id'], active=state=='refund_pending',
            version=saved['version']+1, updated_at=time.time(), next_check_at=time.time()+300)
        u.put(CASES, saved['id'], saved)
        if state == 'refunded':
            update_payment(u, saved['id'], {'status':'refunded','razorpay_payment_id':saved['payment_id']})
        audit(u, 'UnfulfilledBookingRefundReconciled', 'provider', payment_order_id=saved['id'], status=state, refund_id=result['id'])
        return saved
    return core.operations_store.run(save)


def reconcile_refund(core, case):
    if case['state'] in ('refunded','refund_failed'): return case
    if case.get('refund_id'):
        return save_refund(core, case, razorpay('refunds/'+case['refund_id']))
    for skip in range(0,1000,100):
        result = razorpay('payments/'+case['payment_id']+'/refunds?count=100&skip='+str(skip))
        items = result.get('items') if isinstance(result, dict) else None
        if not isinstance(items, list) or len(items)>100: raise HTTPException(503, 'Refund status could not be checked.')
        matches = [item for item in items if isinstance(item, dict) and item.get('receipt') == case['refund_receipt']]
        if len(matches)>1: raise HTTPException(409, 'Multiple refund records need provider review.')
        if matches: return save_refund(core, case, matches[0])
        if len(items)<100: break
    return case


def install(core):
    router = APIRouter(prefix='/operations/booking-checkout', tags=['Booking payment recovery'])

    def output(case):
        value = public_case(case)
        if case['state'] == 'action_required':
            value['available_starts'] = [candidate.isoformat() for candidate in core.candidates()]
        return value

    @router.get('')
    def cases(response: Response, after: str = Query(default='', max_length=100, pattern=r'^[A-Za-z0-9_-]*$'), user=Depends(core.current_user)):
        response.headers.update(PRIVATE)
        rows = core.operations_store.run(lambda u: u.find(CASES, 'customer_id', user['id'], limit=26, after=after))
        return {'cases': [public_case(row) for row in rows[:25]], 'next': rows[24]['id'] if len(rows)>25 else None}

    @router.post('/{key}/check')
    def check(key: str, response: Response, user=Depends(core.current_user)):
        response.headers.update(PRIVATE)
        return output(recover(core, key, user['id']))

    @router.post('/{key}/reschedule')
    def change(key: str, body: Recovery, response: Response, user=Depends(core.current_user)):
        response.headers.update(PRIVATE)
        return output(reschedule(core, key, body, user['id']))

    @router.post('/{key}/refund')
    def request_refund(key: str, body: Refund, response: Response, user=Depends(core.current_user)):
        response.headers.update(PRIVATE)
        return public_case(refund(core, key, body, user['id']))

    def tick():
        if not integrations.configured('RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET'): return {'checked':0}
        def page(u):
            cursor = u.get('legacy_checkout_cursors','active') or {}
            rows = u.find(CASES,'active',True,limit=4,after=cursor.get('after'))
            if rows or cursor.get('after'):
                u.put('legacy_checkout_cursors','active',{'after':rows[-1]['id'] if len(rows)==4 else None})
            return rows
        rows = core.operations_store.run(page)
        due = [row for row in rows if row.get('next_check_at',0)<=time.time()]
        def check_due(row):
            try:
                recover(core,row['id'],row['customer_id'])
                return 0
            except Exception:
                return 1
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=2) as pool:
            errors = sum(pool.map(check_due,due))
        return {'checked':len(due),'pending_errors':errors}
    core.legacy_checkout_tick = tick
    core.app.include_router(router)
