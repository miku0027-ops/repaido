"""Server-owned Repaidians access: one trial per member UID, verified paid grants.

Provider calls run outside database transactions. Per-user pointers and per-order
indexes keep reads bounded; a receipt cannot be used by another Repaido purchase.
"""
import copy
import hashlib
import hmac
import json
import os
import re
import time
import uuid

from fastapi import APIRouter, Depends, Header, Request
from pydantic import Field

from integrations import audit, razorpay
from operations import Input, fail
from rentals import payments_ready
from shop_prime import month_after

PRICE = 19900
POLICY = 'repaidians-pro-monthly-v1'
MAX_WEBHOOK_BYTES = 256 * 1024
MAX_PREPAID_PERIODS = 12
TRIAL_MS = 60 * 86400 * 1000
TRIAL_POLICY = 'repaidians-full-social-trial-60-days-v2'
LEGACY_TRIAL_POLICY = 'repaidians-full-social-trial-30-days-v1'
LEGACY_TRIAL_MS = 30 * 86400 * 1000


class Empty(Input):
    pass


class Check(Input):
    attempt_id: str | None = Field(default=None, pattern=r'^[a-f0-9-]{36}$')


def _legacy_trial(trial):
    return bool(trial and trial.get('policy') == LEGACY_TRIAL_POLICY
                and type(trial.get('startsAt')) is int and trial['startsAt'] >= 0
                and type(trial.get('endsAt')) is int
                and trial['endsAt'] == trial['startsAt'] + LEGACY_TRIAL_MS)


def _extend_prepaid_trial_grants(u, user_id, old_end, persist=True):
    """Preserve paid time queued at the old trial boundary, once with migration.

    Only a proved captured Repaidians grant chain is moved. Unrelated existing
    paid periods, refund tombstones, provider receipts and interval durations
    are preserved. The trial write and these updates share the store transaction.
    Public badge projections use ``persist=False`` to compute the same intervals
    on copies without multiplying billing writes in a bulk profile transaction.
    """
    member = copy.deepcopy(u.get('rp_subscriptions', user_id))
    if not member or member.get('status') != 'active' or member.get('policy') != POLICY or not member.get('grants'):
        return member
    grants = sorted(member['grants'], key=lambda g: g['startsAt'])
    delta, next_start, moved = TRIAL_MS - LEGACY_TRIAL_MS, old_end, {}
    for grant in grants:
        if grant.get('startsAt') != next_start:
            if moved:
                break
            continue
        attempt = copy.deepcopy(u.get('rp_payments', grant.get('attemptId', '')))
        if (not attempt or attempt.get('kind') != 'repaidians_pro' or attempt.get('userId') != user_id
                or attempt.get('status') != 'captured' or attempt.get('paymentId') != grant.get('paymentId')
                or attempt.get('grantStartsAt') != grant['startsAt'] or attempt.get('grantEndsAt') != grant['endsAt']
                or (not moved and attempt.get('createdAt', old_end) >= old_end)):
            break
        next_start = grant['endsAt']
        grant.update(startsAt=grant['startsAt'] + delta, endsAt=grant['endsAt'] + delta)
        attempt.update(grantStartsAt=grant['startsAt'], grantEndsAt=grant['endsAt'])
        if persist:
            u.put('rp_payments', attempt['id'], attempt)
        moved[grant['attemptId']] = grant
    if not moved:
        return member
    member['grants'] = [moved.get(grant['attemptId'], grant) for grant in member['grants']]
    if member.get('attemptId') in moved:
        member['startsAt'] += delta
        # The stored end spans the contiguous queued chain, including only the
        # proved shifted intervals when an unrelated interval follows it.
        old_member_end = member['endsAt']
        if old_member_end <= next_start:
            member['endsAt'] += delta
    if persist:
        u.put('rp_subscriptions', user_id, member)
    return member


def ensure_trial(u, user_id, starts_at=None, now=None, worker=None):
    """Issue once after joining. ``starts_at`` is trusted server milliseconds.

    This is never a browser endpoint. The original joining date never changes,
    even if the community profile is updated, deleted and rejoined. The known
    30-day launch policy is extended once to 60 days from that original date;
    expired trials outside the enlarged interval remain expired. Approved
    registered workers also enroll once on their first projection, without
    creating a community profile; a later community join reuses that trial.
    """
    now = time.time() if now is None else now
    member = u.get('rp_members', user_id) if user_id else None
    if not member:
        worker = u.get('workers', user_id) if worker is None and user_id else worker
        if not worker or worker.get('id') != user_id or worker.get('status') != 'approved':
            return None
    trial = u.get('rp_trials', user_id)
    if not trial:
        starts = (starts_at if starts_at is not None else member.get('createdAt', int(now * 1000))) if member else int(now * 1000)
        if type(starts) is not int or starts < 0:
            fail('MEMBER_DATE_REQUIRED', 'Your community joining date needs review.')
        trial = dict(userId=user_id, startsAt=starts, endsAt=starts + TRIAL_MS, policy=TRIAL_POLICY)
        u.put('rp_trials', user_id, trial)
    elif _legacy_trial(trial):
        _extend_prepaid_trial_grants(u, user_id, trial['endsAt'])
        trial.update(endsAt=trial['startsAt'] + TRIAL_MS, policy=TRIAL_POLICY,
                     extendedFromPolicy=LEGACY_TRIAL_POLICY)
        u.put('rp_trials', user_id, trial)
    if (type(trial.get('startsAt')) is not int or trial['startsAt'] < 0
            or type(trial.get('endsAt')) is not int or trial['endsAt'] <= trial['startsAt']):
        fail('MEMBER_DATE_REQUIRED', 'Your community joining date needs review.')
    return dict(startsAt=trial['startsAt'], endsAt=trial['endsAt'],
                status='active' if trial['startsAt'] <= now * 1000 < trial['endsAt'] else 'expired')


def _current_period(member, now):
    if not member or member.get('status') != 'active':
        return None
    if 'grants' not in member:
        # Supports existing paid memberships without a migration to interval records.
        return (member['startsAt'], member['endsAt']) if member.get('startsAt', 0) <= now * 1000 < member.get('endsAt', 0) else None
    grants = sorted(member['grants'], key=lambda g: g['startsAt'])
    current = next((g for g in grants if g['startsAt'] <= now * 1000 < g['endsAt']), None)
    if not current:
        return None
    starts, ends = current['startsAt'], current['endsAt']
    for grant in grants:
        if grant['startsAt'] <= ends and grant['endsAt'] > ends:
            ends = grant['endsAt']
    return starts, ends


def membership_badge(u, user_id, worker=None, now=None):
    """Public membership proof, separate from identity or contractor review.

    Registered approved worker records determine the agent/contractor role;
    profile declarations never do. A customer card enrolls an approved worker
    once without a community profile, and cannot restart an existing trial or
    expose billing accounts or payments. Existing legacy grants are projected
    read-only here; own-account subscription and payment commands persist their
    atomic migration without adding prepaid-chain writes to bulk public reads.
    """
    now = time.time() if now is None else now
    worker = u.get('workers', user_id) if worker is None and user_id else worker
    if not worker or worker.get('id') != user_id or worker.get('status') != 'approved':
        return None
    stored_trial = u.get('rp_trials', user_id)
    if _legacy_trial(stored_trial):
        starts, ends = stored_trial['startsAt'], stored_trial['startsAt'] + TRIAL_MS
        trial = dict(startsAt=starts, endsAt=ends,
                     status='active' if starts <= now * 1000 < ends else 'expired')
        member = _extend_prepaid_trial_grants(u, user_id, stored_trial['endsAt'], persist=False)
    else:
        trial = ensure_trial(u, user_id, now=now, worker=worker)
        member = u.get('rp_subscriptions', user_id)
    if not trial:
        return None
    period = _current_period(member, now)
    if period:
        source, starts, ends = 'paid', *period
    elif trial['status'] == 'active':
        source, starts, ends = 'trial', trial['startsAt'], trial['endsAt']
    else:
        return None
    return dict(label='Repaidian', kind='membership', status='active', source=source,
                professionalType='contractor' if worker.get('contractor_verified') else 'agent',
                startsAt=starts, endsAt=ends)


def subscription(u, user_id, now=None):
    """Public, sanitized state. ``now`` is server seconds; API timestamps are ms."""
    now = time.time() if now is None else now
    trial = ensure_trial(u, user_id, now=now)
    member = u.get('rp_subscriptions', user_id)
    period = _current_period(member, now)
    account = u.get('rp_billing_accounts', user_id) or {}
    attempt = u.get('rp_payments', account['currentAttemptId']) if account.get('currentAttemptId') else None
    public = {k: member[k] for k in ('plan', 'amountPaise', 'provider')} if period else None
    if public:
        public.update(startsAt=period[0], endsAt=period[1])
    elif trial and trial['status'] == 'active':
        public = dict(plan='trial', amountPaise=0, provider='trial', startsAt=trial['startsAt'], endsAt=trial['endsAt'])
    return dict(active=bool(public), subscription=public, trial=trial, serverNow=int(now * 1000),
                paymentsReady=payments_ready(), amount=PRICE, currency='INR',
                paymentStatus=attempt.get('status') if attempt else None)


def _save_grants(u, user_id, grants, now):
    """Retain paid periods separately, so refunding one never erases another."""
    grants = sorted((g for g in grants if g['endsAt'] > now * 1000), key=lambda g: g['startsAt'])
    current = next((g for g in grants if g['startsAt'] <= now * 1000 < g['endsAt']), None)
    chosen = current or (grants[0] if grants else None)
    starts, ends = (chosen['startsAt'], chosen['endsAt']) if chosen else (0, 0)
    if chosen:
        for grant in grants:
            if grant['startsAt'] <= ends and grant['endsAt'] > ends:
                ends = grant['endsAt']
    member = dict(userId=user_id, plan='pro', amountPaise=PRICE, provider='razorpay',
                  startsAt=starts, endsAt=ends, status='active' if grants else 'refunded',
                  grants=grants, policy=POLICY, updatedAt=int(now * 1000))
    if chosen:
        member.update(paymentId=chosen['paymentId'], attemptId=chosen['attemptId'])
    u.put('rp_subscriptions', user_id, member)
    return member


def apply_payment(u, attempt, payment, now=None):
    """Accept a fetched provider payment only; callers never pass browser claims."""
    now = time.time() if now is None else now
    if not attempt or attempt.get('kind') != 'repaidians_pro':
        fail('ORDER_NOT_FOUND', 'This payment does not belong to Repaidians.', 404)
    if (payment.get('order_id') != attempt.get('orderId')
            or payment.get('currency') != 'INR' or type(payment.get('amount')) is not int or payment.get('amount') != PRICE
            or not re.fullmatch(r'pay_[A-Za-z0-9]+', str(payment.get('id', '')))):
        fail('PAYMENT_MISMATCH', 'Payment does not match your Repaidians membership.')
    pid = payment['id']
    order = u.get('rp_orders', attempt['orderId'])
    if not order or order.get('attemptId') != attempt['id'] or order.get('userId') != attempt['userId']:
        fail('ORDER_MISMATCH', 'This order needs reconciliation.')
    final_payment = payment.get('status') in ('captured', 'refunded') or payment.get('amount_refunded')
    if final_payment and attempt.get('paymentId') and attempt['paymentId'] != pid:
        fail('DUPLICATE_COLLECTION_REVIEW', 'Another payment on this order needs reconciliation.')
    receipt = u.get('receipts', pid)
    if receipt and (receipt.get('rpAttemptId') != attempt['id'] or receipt.get('userId') != attempt['userId']):
        fail('PAYMENT_ALREADY_USED', 'Payment already belongs to another purchase.')
    raw_refund = payment.get('amount_refunded')
    raw_refund = 0 if raw_refund is None else raw_refund
    if type(raw_refund) is not int or not 0 <= raw_refund <= PRICE:
        fail('PAYMENT_MISMATCH', 'The provider payment needs reconciliation.')
    if payment.get('status') == 'refunded' and raw_refund == 0:
        fail('PAYMENT_MISMATCH', 'The provider refund needs reconciliation.')
    refunded = max(raw_refund, attempt.get('amountRefunded', 0))
    status = payment.get('status')
    # Resolve policy migration before reading paid grants. Capture/refund uses
    # the migrated intervals, so a stale local list cannot undo their extension.
    trial = ensure_trial(u, attempt['userId'], now=now) if final_payment else None
    attempt = u.get('rp_payments', attempt['id']) or attempt
    member = u.get('rp_subscriptions', attempt['userId']) or {}
    grants = member.get('grants', [])
    if refunded or status == 'refunded':
        # Persist the tombstone even if refund arrives before capture.
        attempt.update(status='refunded', amountRefunded=refunded, paymentId=pid)
        _save_grants(u, attempt['userId'], [g for g in grants if g['attemptId'] != attempt['id']], now)
    elif status == 'captured' and payment.get('captured') is True:
        if attempt.get('status') not in ('captured', 'refunded'):
            trial_end = trial['endsAt'] if trial and trial['status'] == 'active' else 0
            starts = max(int(now * 1000), trial_end, max((g['endsAt'] for g in grants), default=0))
            ends = int(month_after(starts / 1000) * 1000)
            grant = dict(attemptId=attempt['id'], paymentId=pid, startsAt=starts, endsAt=ends)
            _save_grants(u, attempt['userId'], [*grants, grant], now)
            attempt.update(status='captured', paymentId=pid, grantStartsAt=starts, grantEndsAt=ends)
            audit(u, 'RepaidiansProActivated', 'razorpay', user_id=attempt['userId'], payment_id=pid, ends_at=ends)
        # A stale capture cannot replace a refund or extend an already paid month.
    elif attempt.get('status') not in ('captured', 'refunded'):
        attempt['lastPaymentStatus'] = status or 'unknown'
    if attempt.get('status') in ('captured', 'refunded') and not receipt:
        u.put('receipts', pid, dict(id=pid, kind='repaidians_pro', rpAttemptId=attempt['id'],
                                  userId=attempt['userId'], amount_paise=PRICE, currency='INR', verified_at=now))
    attempt['checkedAt'] = int(now * 1000)
    u.put('rp_payments', attempt['id'], attempt)
    return attempt


def apply_provider_payment(u, payment):
    """Dispatch a fetched payment from the existing shared Razorpay integration."""
    linked = u.get('rp_orders', payment.get('order_id', ''))
    if not linked:
        return None
    attempt = u.get('rp_payments', linked['attemptId'])
    if not attempt or attempt['userId'] != linked['userId']:
        fail('ORDER_MISMATCH', 'Membership order needs reconciliation.')
    return apply_payment(u, attempt, payment)


def install(core):
    router = APIRouter(prefix='/repaidians', tags=['Repaidians membership'])
    store = core.operations_store

    def attach(attempt, order):
        notes = order.get('notes') or {}
        if (type(order.get('amount')) is not int or order.get('amount') != PRICE or order.get('currency') != 'INR'
                or order.get('receipt') != attempt['receipt']
                or not re.fullmatch(r'order_[A-Za-z0-9]+', str(order.get('id', '')))
                or notes.get('kind') != 'repaidians_pro' or notes.get('user_id') != attempt['userId']):
            fail('ORDER_MISMATCH', 'Your membership order needs reconciliation.')

        def save(u):
            current = u.get('rp_payments', attempt['id'])
            linked = u.get('rp_orders', order['id'])
            if (not current or current['userId'] != attempt['userId']
                    or (current.get('orderId') and current['orderId'] != order['id'])
                    or (linked and (linked.get('attemptId') != attempt['id'] or linked.get('userId') != attempt['userId']))):
                fail('ORDER_MISMATCH', 'Your membership order needs reconciliation.')
            current['orderId'] = order['id']
            if current['status'] == 'creating':
                current['status'] = 'created'
            u.put('rp_orders', order['id'], dict(attemptId=current['id'], userId=current['userId']))
            u.put('rp_payments', current['id'], current)
            return current
        return store.run(save)

    def reconcile(attempt):
        if not attempt.get('orderId'):
            rows = razorpay('orders?receipt=' + attempt['receipt']).get('items', [])
            matches = [o for o in rows if o.get('receipt') == attempt['receipt']]
            if len(matches) != 1:
                fail('PAYMENT_RECONCILING', 'The provider has not confirmed this order. Check status before starting another payment.', 503)
            attempt = attach(attempt, matches[0])
        rows = razorpay('orders/' + attempt['orderId'] + '/payments').get('items', [])
        authorized = False
        for row in rows:
            # Fetch each payment, rather than trusting a browser ID or event entity.
            pid = row.get('id', '')
            if not re.fullmatch(r'pay_[A-Za-z0-9]+', str(pid)):
                fail('PAYMENT_MISMATCH', 'The provider payment needs reconciliation.')
            payment = razorpay('payments/' + pid)
            if payment.get('id') != pid:
                fail('PAYMENT_MISMATCH', 'The provider payment needs reconciliation.')
            attempt = store.run(lambda u: apply_payment(u, u.get('rp_payments', attempt['id']), payment))
            authorized |= payment.get('status') == 'authorized'
        if authorized and attempt['status'] not in ('captured', 'refunded'):
            fail('PAYMENT_PROCESSING', 'Payment is authorized and awaiting capture. Check status before retrying.')
        return attempt

    @router.get('/subscription')
    def status(user=Depends(core.current_user)):
        return store.run(lambda u: subscription(u, user['id']))

    @router.post('/subscription/order')
    def order(body: Empty | None = None, user=Depends(core.current_user)):
        if not payments_ready():
            fail('PAYMENTS_UNAVAILABLE', 'Repaidians payments are not connected yet. No charge was made.', 503)

        def reserve(u):
            if not u.get('rp_members', user['id']):
                fail('MEMBER_REQUIRED', 'Join Repaidians and start your free trial before purchasing a membership.', 403)
            account = u.get('rp_billing_accounts', user['id']) or {}
            pending = u.get('rp_payments', account['currentAttemptId']) if account.get('currentAttemptId') else None
            if pending and pending['status'] in ('creating', 'created'):
                if pending['userId'] != user['id']:
                    fail('PAYMENT_REVIEW_REQUIRED', 'Your previous payment needs reconciliation.')
                return pending, False
            member = u.get('rp_subscriptions', user['id']) or {}
            now = time.time() * 1000
            if sum(g['endsAt'] > now for g in member.get('grants', [])) >= MAX_PREPAID_PERIODS:
                fail('RENEWAL_TOO_EARLY', 'You already have twelve paid months. Renew when a paid period ends.')
            aid = str(uuid.uuid4())
            attempt = dict(id=aid, receipt=aid, kind='repaidians_pro', userId=user['id'],
                           amountPaise=PRICE, currency='INR', status='creating',
                           createdAt=int(time.time() * 1000), policy=POLICY)
            u.put('rp_payments', aid, attempt)
            u.put('rp_billing_accounts', user['id'], dict(userId=user['id'], currentAttemptId=aid))
            return attempt, True
        attempt, fresh = store.run(reserve)
        if fresh:
            attempt = attach(attempt, razorpay('orders', dict(amount=PRICE, currency='INR', receipt=attempt['receipt'],
                notes={'kind': 'repaidians_pro', 'user_id': user['id']})))
        else:
            attempt = reconcile(attempt)
            if attempt['status'] in ('captured', 'refunded'):
                return {'settled': True, **store.run(lambda u: subscription(u, user['id']))}
        return dict(key_id=os.environ['RAZORPAY_KEY_ID'], order_id=attempt['orderId'],
                    amount=PRICE, currency='INR', attempt_id=attempt['id'])

    @router.post('/subscription/check')
    def check(body: Check | None = None, user=Depends(core.current_user)):
        def attempts(u):
            member = u.get('rp_subscriptions', user['id']) or {}
            account = u.get('rp_billing_accounts', user['id']) or {}
            ids = [g['attemptId'] for g in member.get('grants', []) if g['endsAt'] > time.time() * 1000]
            if account.get('currentAttemptId'):
                ids.append(account['currentAttemptId'])
            if body and body.attempt_id:
                ids.append(body.attempt_id)
            rows = [u.get('rp_payments', aid) for aid in dict.fromkeys(ids)]
            if any(not a or a['userId'] != user['id'] for a in rows):
                fail('NOT_FOUND', 'Membership payment not found.', 404)
            return rows
        for attempt in store.run(attempts):
            reconcile(attempt)
        return store.run(lambda u: subscription(u, user['id']))

    @router.post('/webhooks/razorpay')
    async def webhook(request: Request, x_razorpay_signature: str = Header(default='')):
        secret = os.getenv('RAZORPAY_WEBHOOK_SECRET')
        if not secret:
            fail('WEBHOOK_NOT_CONFIGURED', 'Membership webhook is unavailable.', 503)
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > MAX_WEBHOOK_BYTES:
                fail('PAYLOAD_TOO_LARGE', 'Webhook too large.', 413)
        expected = hmac.new(secret.encode(), bytes(data), hashlib.sha256).hexdigest()
        if not re.fullmatch(r'[a-fA-F0-9]{64}', x_razorpay_signature) or not hmac.compare_digest(expected, x_razorpay_signature.lower()):
            fail('INVALID_SIGNATURE', 'Invalid webhook signature.', 401)
        try:
            payload = json.loads(data)
            entities = payload['payload']
            entity = entities.get('payment', {}).get('entity', {})
            pid = entity.get('id') or entities.get('refund', {}).get('entity', {}).get('payment_id')
            if not re.fullmatch(r'pay_[A-Za-z0-9]+', str(pid or '')):
                return {'status': 'ignored'}
        except (ValueError, KeyError, TypeError, AttributeError):
            fail('INVALID_EVENT', 'Malformed webhook.', 400)
        # HMAC authenticates delivery, not final financial state. GET wins over stale events.
        payment = razorpay('payments/' + pid)
        if payment.get('id') != pid:
            fail('PAYMENT_MISMATCH', 'The provider payment needs reconciliation.')
        def save(u):
            applied = apply_provider_payment(u, payment)
            return {'status': 'reconciled' if applied is not None else 'ignored'}
        return store.run(save)

    core.app.include_router(router)
