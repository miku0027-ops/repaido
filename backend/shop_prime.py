"""Shop-owned monthly Prime; only authenticated gateway captures grant benefits."""
import calendar
import os
import time
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends
from integrations import audit, razorpay
from operations import fail
from rentals import payments_ready

PRICE = 149900
POLICY = 'shop-prime-monthly-v1'


def month_after(epoch):
    start = datetime.fromtimestamp(epoch, ZoneInfo('Asia/Kolkata'))
    year, month = (start.year + 1, 1) if start.month == 12 else (start.year, start.month + 1)
    return start.replace(year=year, month=month, day=min(start.day, calendar.monthrange(year, month)[1])).timestamp()


def public_prime(u, shop, now=None):
    now = time.time() if now is None else now
    membership = u.get('shop_prime', shop['id']) or {}
    active = shop.get('status') == 'approved' and membership.get('status') == 'active' and membership.get('starts_at', 0) <= now < membership.get('ends_at', 0)
    return {'active': bool(active), 'paid_placement': bool(active), 'ends_at': membership.get('ends_at') if active else None}


def apply_capture(u, attempt, payment):
    if payment.get('order_id') != attempt.get('order_id') or payment.get('currency') != 'INR' or payment.get('amount') != PRICE:
        fail('PAYMENT_MISMATCH', 'Payment does not match this shop membership.')
    pid = payment['id']
    if attempt.get('payment_id') and attempt['payment_id'] != pid:
        fail('DUPLICATE_COLLECTION_REVIEW', 'Another payment on this order needs reconciliation.')
    receipt = u.get('receipts', pid)
    if receipt and receipt.get('prime_attempt_id') != attempt['id']:
        fail('PAYMENT_ALREADY_USED', 'Payment already belongs to another purchase.')
    refunded = max(int(payment.get('amount_refunded') or 0), attempt.get('amount_refunded', 0))
    if refunded or payment.get('status') == 'refunded':
        attempt.update(status='refunded', amount_refunded=refunded, payment_id=pid)
        membership = u.get('shop_prime', attempt['shop_id'])
        if membership and membership.get('payment_id') == pid:
            membership['status'] = 'revoked'
            u.put('shop_prime', attempt['shop_id'], membership)
    elif payment.get('status') == 'captured' and payment.get('captured') is True and attempt.get('status') != 'refunded':
        if attempt.get('status') != 'captured':
            starts = time.time()
            membership = dict(shop_id=attempt['shop_id'], owner_id=attempt['owner_id'], payment_id=pid,
                              starts_at=starts, ends_at=month_after(starts), status='active', policy=POLICY)
            u.put('shop_prime', attempt['shop_id'], membership)
            u.put('receipts', pid, dict(id=pid, prime_attempt_id=attempt['id'], shop_id=attempt['shop_id'], amount_paise=PRICE))
            audit(u, 'ShopPrimeActivated', 'razorpay', shop_id=attempt['shop_id'], payment_id=pid, ends_at=membership['ends_at'])
        attempt.update(status='captured', payment_id=pid)
    attempt['checked_at'] = time.time()
    u.put('payments', attempt['id'], attempt)
    return attempt


def install(core):
    r = APIRouter(prefix='/operations/shop/prime')
    store = core.operations_store

    def owner(user=Depends(core.current_user)):
        if not user.get('phone_authenticated'):
            fail('PHONE_OTP_REQUIRED', 'Sign in with your shop mobile OTP.', 403)
        return user

    def owned(u, user):
        shop = next((s for s in u.all('shops') if s.get('owner_id') == user['id'] and s.get('status') == 'approved'), None)
        if not shop:
            fail('SHOP_APPROVAL_REQUIRED', 'Prime requires your approved shop account.', 403)
        return shop

    def state(u, user):
        s = owned(u, user)
        member = u.get('shop_prime', s['id']) or {}
        attempts = sorted((a for a in u.all('payments') if a.get('kind') == 'shop_prime' and a['shop_id'] == s['id'] and a['owner_id'] == user['id']), key=lambda a: a['created_at'], reverse=True)
        return dict(shop_id=s['id'], shop_name=s['name'], amount=PRICE, currency='INR', policy=POLICY,
                    active=public_prime(u, s)['active'], ends_at=member.get('ends_at'), payments_ready=payments_ready(),
                    payment_status=attempts[0]['status'] if attempts else None,
                    history=[{k: a.get(k) for k in ('id', 'status', 'amount_paise', 'payment_id', 'created_at')} for a in attempts[:12]])

    @r.get('')
    def status(user=Depends(owner)):
        return store.run(lambda u: state(u, user))

    def attach(attempt, order):
        if order.get('amount') != PRICE or order.get('currency') != 'INR' or order.get('receipt') != attempt['receipt'] or not order.get('id'):
            fail('ORDER_MISMATCH', 'Membership order needs reconciliation.')
        def save(u):
            a = u.get('payments', attempt['id'])
            if a.get('order_id') and a['order_id'] != order['id']:
                fail('ORDER_MISMATCH', 'Membership order needs reconciliation.')
            a['order_id'] = order['id']
            if a['status'] == 'creating': a['status'] = 'created'
            u.put('payments', a['id'], a)
            return a
        return store.run(save)

    def reconcile(attempt):
        if not attempt.get('order_id'):
            matches = [o for o in razorpay('orders?receipt=' + attempt['receipt']).get('items', []) if o.get('receipt') == attempt['receipt']]
            if len(matches) != 1:
                fail('PAYMENT_RECONCILING', 'The provider has not confirmed this order. Check status again; do not make a second payment.', 503)
            attempt = attach(attempt, matches[0])
        for payment in razorpay('orders/' + attempt['order_id'] + '/payments').get('items', []):
            if payment.get('status') in ('captured', 'refunded') or payment.get('amount_refunded'):
                attempt = store.run(lambda u: apply_capture(u, u.get('payments', attempt['id']), payment))
            elif payment.get('status') == 'authorized':
                fail('PAYMENT_PROCESSING', 'Payment is authorized and awaiting capture. Check status before retrying.')
        return attempt

    @r.post('/order')
    def order(user=Depends(owner)):
        if not payments_ready(): fail('PAYMENTS_UNAVAILABLE', 'Prime payments are not connected yet.', 503)
        def reserve(u):
            s = owned(u, user)
            if public_prime(u, s)['active']: fail('ALREADY_ACTIVE', 'Your shop Prime is active. Renew after the current month ends.')
            pending = next((a for a in u.all('payments') if a.get('kind') == 'shop_prime' and a['shop_id'] == s['id'] and a['status'] in ('creating', 'created')), None)
            if pending:
                if pending['owner_id'] != user['id']: fail('PAYMENT_REVIEW_REQUIRED', 'The previous shop owner has an unresolved payment. Contact support.')
                return pending, False
            aid = str(uuid.uuid4())
            a = dict(id=aid, receipt=aid, kind='shop_prime', shop_id=s['id'], owner_id=user['id'], amount_paise=PRICE,
                     status='creating', created_at=time.time(), policy=POLICY)
            u.put('payments', aid, a)
            return a, True
        attempt, fresh = store.run(reserve)
        if fresh:
            attempt = attach(attempt, razorpay('orders', dict(amount=PRICE, currency='INR', receipt=attempt['receipt'], notes={'shop_id': attempt['shop_id'], 'kind': 'shop_prime'})))
        else:
            attempt = reconcile(attempt)
            if attempt['status'] in ('captured', 'refunded'): return {'settled': True, **store.run(lambda u: state(u, user))}
        return dict(key_id=os.environ['RAZORPAY_KEY_ID'], order_id=attempt['order_id'], amount=PRICE, currency='INR', shop_id=attempt['shop_id'])

    @r.post('/check')
    def check(user=Depends(owner)):
        def latest(u):
            s = owned(u, user)
            rows = [a for a in u.all('payments') if a.get('kind') == 'shop_prime' and a['shop_id'] == s['id'] and a['owner_id'] == user['id']]
            return max(rows, key=lambda a: a['created_at']) if rows else None
        attempt = store.run(latest)
        if attempt: reconcile(attempt)
        return store.run(lambda u: state(u, user))

    core.app.include_router(r)
