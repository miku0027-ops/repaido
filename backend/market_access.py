"""Shared exchange/used-item access, with server-owned trial and paid intervals.

Status reads never enroll a member. Provider calls remain outside transactions;
only authenticated provider reads can grant a calendar month or revoke a grant.
"""
import hashlib
import os
import re
import time
import uuid

from fastapi import APIRouter, Depends
from pydantic import Field

from integrations import audit, razorpay
from operations import Input, fail
from rentals import payments_ready
from shop_prime import month_after

PRICE = 9900
TRIAL_DAYS = 90
POLICY = 'market-shared-90d-99-month-v1'
MAX_PREPAID_PERIODS = 12


class Empty(Input):
    pass


class Purchase(Input):
    request_id: str = Field(min_length=16, max_length=100)


class Check(Input):
    attempt_id: str | None = Field(default=None, pattern=r'^[a-f0-9-]{36}$')


def _legacy_start(u, uid):
    dates = []
    for mode in ('exchange', 'second_hand'):
        key = hashlib.sha256((uid + ':' + mode).encode()).hexdigest()
        trial = u.get('market_trials', key)
        if trial and type(trial.get('claimed_at')) in (int, float) and trial['claimed_at'] >= 0:
            dates.append(trial['claimed_at'])
    for row in u.find('market_listings', 'owner_id', uid):
        if row.get('mode') in ('exchange', 'second_hand'):
            for start in (row.get('created_at'), row.get('trial_started_at')):
                if type(start) in (int, float) and start >= 0:
                    dates.append(start)
    return min(dates) if dates else None


def _trial_start(u, uid):
    trial = u.get('market_access_trials', uid)
    return trial['starts_at'] if trial else _legacy_start(u, uid)


def _grants(u, uid):
    return (u.get('market_access_members', uid) or {}).get('grants', [])


def _period(grants, now):
    ordered = sorted(grants, key=lambda g: g['starts_at'])
    current = next((g for g in ordered if g['starts_at'] <= now < g['ends_at']), None)
    if not current:
        return None
    end = current['ends_at']
    for grant in ordered:
        if grant['starts_at'] <= end < grant['ends_at']:
            end = grant['ends_at']
    return end


def access_status(u, uid, now=None):
    """Sanitized read-only status, including legacy dates without writing them."""
    now = time.time() if now is None else now
    start = _trial_start(u, uid)
    trial_end = start + TRIAL_DAYS * 86400 if start is not None else None
    grants = _grants(u, uid)
    paid_end = _period(grants, now)
    trial_active = start is not None and start <= now < trial_end
    end = paid_end
    if trial_active:
        end = trial_end
        for grant in sorted(grants, key=lambda g: g['starts_at']):
            if grant['starts_at'] <= end < grant['ends_at']:
                end = grant['ends_at']
    account = u.get('market_access_accounts', uid) or {}
    attempt = u.get('market_access_payments', account['attempt_id']) if account.get('attempt_id') else None
    return dict(active=bool(paid_end or trial_active),
                status='paid' if paid_end else 'trial' if trial_active else 'expired' if start is not None or grants else 'not_started',
                trial_started_at=start, trial_ends_at=trial_end,
                current_period_ends_at=end, amount_paise=PRICE, currency='INR', trial_days=TRIAL_DAYS,
                payments_ready=payments_ready(), auto_renew=False, server_now=now,
                payment_status=attempt.get('status') if attempt else None)


def activate_trial(u, uid, now=None):
    now = time.time() if now is None else now
    if not u.get('market_access_trials', uid):
        original = _legacy_start(u, uid)
        starts = now if original is None else original
        u.put('market_access_trials', uid, dict(id=uid, starts_at=starts, policy=POLICY))
        audit(u, 'MarketplaceAccessTrialStarted' if original is None else 'MarketplaceAccessTrialMigrated', uid,
              starts_at=starts, ends_at=starts + TRIAL_DAYS * 86400)
    state = access_status(u, uid, now)
    sync_listings(u, uid, state)
    return state


def start_trial(u, uid, now=None):
    return activate_trial(u, uid, now)


def require_access(u, user, start_trial=False):
    uid = user['id']
    state = activate_trial(u, uid) if start_trial else access_status(u, uid)
    if not state['active']:
        fail('MARKET_ACCESS_REQUIRED', 'Your marketplace access has ended. Renew for ₹99 per calendar month to publish, contact sellers or send messages. Browsing and your conversation history remain available.', 402)
    return state


def sync_listings(u, uid, state=None):
    """Extend only access-managed rows; closed/moderated/refunded rows stay hidden."""
    state = state or access_status(u, uid)
    for row in u.find('market_listings', 'owner_id', uid):
        # Historical per-listing captures retain their original visibility rights.
        if row.get('fee_status') in ('paid', 'refunded', 'review_required') or u.get('market_fees', row['id']):
            continue
        if row.get('status') not in ('published', 'expired'):
            continue
        before = dict(row)
        row['access_policy'] = POLICY
        row['expires_at'] = state['current_period_ends_at'] if state['active'] else state['trial_ends_at']
        row['fee_paise'] = 0
        if state['active']:
            row.update(status='published', fee_status='access_paid' if state['status'] == 'paid' else 'free_trial')
        elif row['status'] == 'published':
            # Scheduler emits the expiry notice and changes state after the exact
            # timestamp gates have already hidden it on every public surface.
            row['expires_at'] = row.get('expires_at') or state['server_now']
        if row != before:
            u.put('market_listings', row['id'], row)


def _save_grants(u, uid, grants, now):
    # Keep expired grants as financial history; status projection selects current
    # intervals. A refund removes only the affected attempt's entitlement.
    u.put('market_access_members', uid, dict(id=uid, grants=sorted(grants, key=lambda g: g['starts_at']),
                                             policy=POLICY, updated_at=now))
    sync_listings(u, uid)


def _reflow_future_grants(u, uid, grants, new_start, new_end, now):
    """Keep complete prepaid months when a new purchase fills a refund gap.

    A refund leaves every other grant in place. Only a later purchase can move
    an overlapping, not-yet-started grant forward; started time is immutable.
    The linked verified attempt and entitlement update atomically together.
    """
    rows = sorted(grants, key=lambda g: g['starts_at'])
    boundary = new_end
    result = []
    for grant in rows:
        if grant['starts_at'] > now and grant['ends_at'] > new_start and grant['starts_at'] < boundary:
            old = u.get('market_access_payments', grant['attempt_id'])
            if (not old or old.get('user_id') != uid or old.get('status') != 'captured'
                    or old.get('payment_id') != grant['payment_id']
                    or old.get('grant_starts_at') != grant['starts_at']
                    or old.get('grant_ends_at') != grant['ends_at']):
                fail('PAYMENT_REVIEW_REQUIRED', 'An earlier prepaid month needs reconciliation before renewal.')
            moved = {**grant, 'starts_at': boundary, 'ends_at': month_after(boundary)}
            old.update(grant_starts_at=moved['starts_at'], grant_ends_at=moved['ends_at'])
            u.put('market_access_payments', old['id'], old)
            audit(u, 'MarketplacePrepaidMonthMoved', 'razorpay', user_id=uid, attempt_id=old['id'],
                  previous_starts_at=grant['starts_at'], previous_ends_at=grant['ends_at'],
                  starts_at=moved['starts_at'], ends_at=moved['ends_at'])
            grant = moved
            boundary = moved['ends_at']
        result.append(grant)
    return result


def apply_payment(u, attempt, payment, now=None):
    """Called only after authenticated provider GET, never browser payment claims."""
    now = time.time() if now is None else now
    if not attempt or attempt.get('kind') != 'market_access':
        fail('ORDER_NOT_FOUND', 'Marketplace access payment not found.', 404)
    if (payment.get('order_id') != attempt.get('order_id') or payment.get('currency') != 'INR'
            or type(payment.get('amount')) is not int or payment['amount'] != PRICE
            or not re.fullmatch(r'pay_[A-Za-z0-9]+', str(payment.get('id', '')))):
        fail('PAYMENT_MISMATCH', 'This payment does not match marketplace access.')
    linked = u.get('market_access_orders', attempt['order_id'])
    if not linked or linked.get('attempt_id') != attempt['id'] or linked.get('user_id') != attempt['user_id']:
        fail('ORDER_MISMATCH', 'Marketplace payment needs reconciliation.')
    pid = payment['id']
    refund = payment.get('amount_refunded', 0)
    refund = 0 if refund is None else refund
    if type(refund) is not int or not 0 <= refund <= PRICE or (payment.get('status') == 'refunded' and not refund):
        fail('PAYMENT_MISMATCH', 'The provider refund needs reconciliation.')
    final = payment.get('status') in ('captured', 'refunded') or refund
    if final and attempt.get('payment_id') and attempt['payment_id'] != pid:
        fail('DUPLICATE_COLLECTION_REVIEW', 'Another payment on this order needs reconciliation.')
    receipt = u.get('receipts', pid)
    if receipt and (receipt.get('market_attempt_id') != attempt['id'] or receipt.get('user_id') != attempt['user_id']):
        fail('PAYMENT_ALREADY_USED', 'This payment already belongs to another purchase.')
    refund = max(refund, attempt.get('amount_refunded', 0))
    grants = _grants(u, attempt['user_id'])
    if refund:
        attempt.update(status='refunded', amount_refunded=refund, payment_id=pid)
        _save_grants(u, attempt['user_id'], [g for g in grants if g['attempt_id'] != attempt['id']], now)
    elif payment.get('status') == 'captured' and payment.get('captured') is True:
        if attempt['status'] not in ('captured', 'refunded'):
            state = start_trial(u, attempt['user_id'], now)
            begins = max(now, state['current_period_ends_at'] or 0)
            grant = dict(attempt_id=attempt['id'], payment_id=pid, starts_at=begins, ends_at=month_after(begins))
            grants = _reflow_future_grants(u, attempt['user_id'], grants, begins, grant['ends_at'], now)
            _save_grants(u, attempt['user_id'], [*grants, grant], now)
            attempt.update(status='captured', payment_id=pid, grant_starts_at=begins, grant_ends_at=grant['ends_at'])
            audit(u, 'MarketplaceAccessPaid', 'razorpay', user_id=attempt['user_id'], payment_id=pid,
                  amount_paise=PRICE, ends_at=grant['ends_at'])
    elif attempt['status'] not in ('captured', 'refunded'):
        attempt['last_payment_status'] = payment.get('status', 'unknown')
    if attempt['status'] in ('captured', 'refunded') and not receipt:
        u.put('receipts', pid, dict(id=pid, kind='market_access', market_attempt_id=attempt['id'],
                                   user_id=attempt['user_id'], amount_paise=PRICE, currency='INR', verified_at=now))
    attempt['checked_at'] = now
    u.put('market_access_payments', attempt['id'], attempt)
    return attempt


def apply_provider_payment(u, payment):
    linked = u.get('market_access_orders', payment.get('order_id', ''))
    if not linked:
        return None
    attempt = u.get('market_access_payments', linked['attempt_id'])
    if not attempt or attempt.get('user_id') != linked['user_id']:
        fail('ORDER_MISMATCH', 'Marketplace payment needs reconciliation.')
    return apply_payment(u, attempt, payment)


def install(core):
    router = APIRouter(prefix='/operations/market/access', tags=['Marketplace access'])
    store = core.operations_store

    def attach(attempt, order):
        notes = order.get('notes') or {}
        if (type(order.get('amount')) is not int or order['amount'] != PRICE or order.get('currency') != 'INR'
                or order.get('receipt') != attempt['receipt']
                or not re.fullmatch(r'order_[A-Za-z0-9]+', str(order.get('id', '')))
                or notes.get('kind') != 'market_access' or notes.get('user_id') != attempt['user_id']):
            fail('ORDER_MISMATCH', 'Marketplace access order needs reconciliation.')
        def save(u):
            current = u.get('market_access_payments', attempt['id'])
            linked = u.get('market_access_orders', order['id'])
            if (not current or current['user_id'] != attempt['user_id']
                    or (current.get('order_id') and current['order_id'] != order['id'])
                    or (linked and (linked.get('attempt_id') != attempt['id'] or linked.get('user_id') != attempt['user_id']))):
                fail('ORDER_MISMATCH', 'Marketplace access order needs reconciliation.')
            current['order_id'] = order['id']
            if current['status'] == 'creating':
                current['status'] = 'created'
            u.put('market_access_orders', order['id'], dict(attempt_id=current['id'], user_id=current['user_id']))
            u.put('market_access_payments', current['id'], current)
            return current
        return store.run(save)

    def reconcile(attempt):
        if not attempt.get('order_id'):
            rows = razorpay('orders?receipt=' + attempt['receipt']).get('items', [])
            matches = [row for row in rows if row.get('receipt') == attempt['receipt']]
            if len(matches) != 1:
                fail('PAYMENT_RECONCILING', 'The provider has not confirmed this order. Check status before starting another payment.', 503)
            attempt = attach(attempt, matches[0])
        rows = razorpay('orders/' + attempt['order_id'] + '/payments').get('items', [])
        authorized = False
        for row in rows:
            pid = row.get('id', '')
            if not re.fullmatch(r'pay_[A-Za-z0-9]+', str(pid)):
                fail('PAYMENT_MISMATCH', 'The provider payment needs reconciliation.')
            payment = razorpay('payments/' + pid)
            if payment.get('id') != pid:
                fail('PAYMENT_MISMATCH', 'The provider payment needs reconciliation.')
            attempt = store.run(lambda u: apply_payment(u, u.get('market_access_payments', attempt['id']), payment))
            authorized |= payment.get('status') == 'authorized'
        if authorized and attempt['status'] not in ('captured', 'refunded'):
            fail('PAYMENT_PROCESSING', 'Payment is authorized and awaiting capture. Check status before retrying.')
        return attempt

    @router.get('')
    def status(user=Depends(core.current_user)):
        return store.run(lambda u: access_status(u, user['id']))

    @router.post('/trial')
    def trial(body: Empty | None = None, user=Depends(core.current_user)):
        return store.run(lambda u: start_trial(u, user['id']))

    @router.post('/order')
    def order(body: Purchase, user=Depends(core.current_user)):
        if not payments_ready():
            fail('PAYMENTS_UNAVAILABLE', 'Marketplace payments are not connected yet. No charge was made.', 503)
        def reserve(u):
            request_key = hashlib.sha256((user['id'] + ':' + body.request_id).encode()).hexdigest()
            previous = u.get('market_access_requests', request_key)
            if previous:
                attempt = u.get('market_access_payments', previous['attempt_id'])
                if not attempt or attempt['user_id'] != user['id']:
                    fail('PAYMENT_REVIEW_REQUIRED', 'Your earlier purchase needs reconciliation.')
                return attempt, False
            state = access_status(u, user['id'])
            if state['status'] == 'not_started':
                fail('TRIAL_NOT_STARTED', 'Start your free 90-day marketplace trial before purchasing a month.', 409)
            account = u.get('market_access_accounts', user['id']) or {}
            pending = u.get('market_access_payments', account['attempt_id']) if account.get('attempt_id') else None
            if pending and pending['status'] in ('creating', 'created'):
                if pending['user_id'] != user['id']:
                    fail('PAYMENT_REVIEW_REQUIRED', 'Your earlier payment needs reconciliation.')
                u.put('market_access_requests', request_key, {'id':request_key,'user_id':user['id'],'attempt_id':pending['id']})
                return pending, False
            if sum(g['ends_at'] > time.time() for g in _grants(u, user['id'])) >= MAX_PREPAID_PERIODS:
                fail('RENEWAL_TOO_EARLY', 'You already have twelve paid months. Renew when a paid period ends.')
            aid = str(uuid.uuid4())
            attempt = dict(id=aid, receipt='ma_' + aid.replace('-', ''), user_id=user['id'],
                           kind='market_access', amount_paise=PRICE, currency='INR', status='creating',
                           created_at=time.time(), policy=POLICY)
            u.put('market_access_payments', aid, attempt)
            u.put('market_access_accounts', user['id'], dict(id=user['id'], attempt_id=aid))
            u.put('market_access_requests', request_key, {'id':request_key,'user_id':user['id'],'attempt_id':aid})
            return attempt, True
        attempt, fresh = store.run(reserve)
        if fresh:
            attempt = attach(attempt, razorpay('orders', dict(amount=PRICE, currency='INR', receipt=attempt['receipt'],
                             notes={'kind': 'market_access', 'user_id': user['id']})))
        else:
            if attempt['status'] not in ('captured', 'refunded'):
                attempt = reconcile(attempt)
            if attempt['status'] in ('captured', 'refunded'):
                return {'settled': True, **store.run(lambda u: access_status(u, user['id']))}
        return dict(key_id=os.environ['RAZORPAY_KEY_ID'], order_id=attempt['order_id'],
                    amount=PRICE, currency='INR', attempt_id=attempt['id'])

    @router.post('/check')
    def check(body: Check | None = None, user=Depends(core.current_user)):
        def attempts(u):
            account = u.get('market_access_accounts', user['id']) or {}
            ids = [g['attempt_id'] for g in _grants(u, user['id']) if g['ends_at'] > time.time()]
            if account.get('attempt_id'):
                ids.append(account['attempt_id'])
            if body and body.attempt_id:
                ids.append(body.attempt_id)
            rows = [u.get('market_access_payments', aid) for aid in dict.fromkeys(ids)]
            if any(not row or row['user_id'] != user['id'] for row in rows):
                fail('NOT_FOUND', 'Marketplace payment not found.', 404)
            return rows
        for attempt in store.run(attempts):
            reconcile(attempt)
        return store.run(lambda u: access_status(u, user['id']))

    def tick():
        """At most 25 indexed pending rows; advance cursors even when throttled.

        Claim the retry timestamp durably before network I/O, so overlapping
        scheduler invocations cannot both call the provider for the same attempt.
        Captured orders are not polled: signed webhook/check handles refunds.
        """
        if not payments_ready():
            return {'attempted': 0, 'errors': 0}
        def claim(u):
            now = time.time()
            claimed = []
            remaining = 25
            for status in ('creating', 'created'):
                limit = min(13, remaining)
                pointer = u.get('market_access_reconcile', status) or {}
                after = pointer.get('after_id')
                rows = u.find('market_access_payments', 'status', status, limit=limit, after=after)
                if not rows and after:
                    rows = u.find('market_access_payments', 'status', status, limit=limit)
                remaining -= len(rows)
                next_id = rows[-1]['id'] if len(rows) == limit else None
                if next_id != after:
                    u.put('market_access_reconcile', status, {'id': status, 'after_id': next_id})
                for attempt in rows:
                    if attempt.get('next_check_at', 0) > now:
                        continue
                    attempt['next_check_at'] = now + 300
                    u.put('market_access_payments', attempt['id'], attempt)
                    claimed.append(attempt)
            return claimed
        attempts = store.run(claim)
        errors = 0
        for attempt in attempts:
            try:
                reconcile(attempt)
            except Exception:
                errors += 1
        return {'attempted': len(attempts), 'errors': errors}

    core.market_access_tick = tick
    core.app.include_router(router)
