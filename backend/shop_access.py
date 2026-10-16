"""Shop registration access: one 90-day interval, then manual calendar months.

A commercial entitlement never verifies a shop. Missing historical registration
metadata uses a fixed migration epoch, never the time of a status read. Historical
paid Prime intervals retain their original visibility rights, independently of the
new ₹499 access plan. New registrations use their immutable created_at timestamp.
"""
import hashlib
import os
import re
import time
import uuid
from fastapi import APIRouter, Depends
from pydantic import Field
from operations import Input, fail
from integrations import audit, razorpay
from rentals import payments_ready
from shop_prime import month_after

PRICE = 49900
TRIAL_DAYS = 90
POLICY = 'shop-registration-90d-499-month-v1'
LEGACY_MIGRATION_AT = 1792108800  # 2026-10-16 00:00:00 UTC, fixed forever.
MAX_PREPAID_PERIODS = 12


class Purchase(Input):
    request_id: str = Field(min_length=16, max_length=100)


class Check(Input):
    attempt_id: str | None = Field(default=None, pattern=r'^[a-f0-9-]{36}$')


class Settings(Input):
    default_offer_enabled: bool
    expected_version: int = Field(ge=0)


def verified(shop):
    v = shop.get('verification') or {}
    return bool(shop.get('status') == 'approved' and shop.get('reviewed_by')
                and shop['reviewed_by'] != shop.get('owner_id')
                and all(v.get(k) is True for k in ('identity_checked','business_checked','address_checked')))


def registration_start(shop):
    for key in ('created_at', 'submitted_at', 'reviewed_at'):
        value = shop.get(key)
        if type(value) in (int, float) and value >= 0:
            return value
    return LEGACY_MIGRATION_AT


def _grants(u, sid):
    return (u.get('shop_access_members', sid) or {}).get('grants', [])


def _period(grants, now):
    ordered = sorted(grants, key=lambda g: g['starts_at'])
    current = next((g for g in ordered if g['starts_at'] <= now < g['ends_at']), None)
    if not current:
        return None
    end = current['ends_at']
    for g in ordered:
        if g['starts_at'] <= end < g['ends_at']:
            end = g['ends_at']
    return end


def access_status(u, shop, now=None):
    now = time.time() if now is None else now
    start = registration_start(shop)
    trial_end = start + TRIAL_DAYS * 86400
    grants = _grants(u, shop['id'])
    paid_end = _period(grants, now)
    trial = start <= now < trial_end
    # Legacy Prime bought a separate paid-placement plan before this policy.
    # Honour its original interval, without granting a new access month or badge.
    prime = u.get('shop_prime', shop['id']) or {}
    prime_end = prime.get('ends_at') if prime.get('status') == 'active' and prime.get('starts_at',0) <= now < prime.get('ends_at',0) else None
    end = max(paid_end or 0, prime_end or 0, trial_end if trial else 0) or None
    if end:
        for grant in sorted(grants, key=lambda g:g['starts_at']):
            if grant['starts_at'] <= end < grant['ends_at']:
                end = grant['ends_at']
    settings = u.get('shop_access_settings', shop['id']) or {}
    account = u.get('shop_access_accounts', shop['id']) or {}
    attempt = u.get('shop_access_payments', account.get('attempt_id','')) if account.get('attempt_id') else None
    return dict(shop_id=shop['id'], active=bool(trial or paid_end or prime_end),
                status='paid' if paid_end or prime_end else 'trial' if trial else 'expired',
                trial_started_at=start, trial_ends_at=trial_end, current_period_ends_at=end,
                amount_paise=PRICE, currency='INR', trial_days=TRIAL_DAYS, auto_renew=False,
                payments_ready=payments_ready(), server_now=now,
                default_offer_enabled=(True if trial else settings.get('default_offer_enabled',True)) if type(shop.get('created_at')) in (int,float) else settings.get('default_offer_enabled',False),
                trial_source='registration' if type(shop.get('created_at')) in (int,float) else 'historical_date' if any(type(shop.get(k)) in (int,float) for k in ('submitted_at','reviewed_at')) else 'legacy_migration',
                settings_version=settings.get('version',0),
                payment_status=attempt.get('status') if attempt and attempt.get('owner_id') == shop.get('owner_id') else None,
                legacy_registration_date=not any(type(shop.get(k)) in (int,float) for k in ('created_at','submitted_at','reviewed_at')))


def visible(u, shop, now=None):
    # Pre-application records were approved through the independently operator-
    # protected legacy endpoint. They retain access, but never receive the new
    # independently-verified badge without all three recorded checks.
    if not approved(shop):return False
    now=time.time() if now is None else now
    start=registration_start(shop)
    if start <= now < start+TRIAL_DAYS*86400:return True
    if _period(_grants(u,shop['id']),now):return True
    # Public eligibility needs only entitlement intervals. Never fetch owner
    # checkout attempts, settings or provider readiness for every catalogue card.
    prime=u.get('shop_prime',shop['id']) or {}
    return bool(prime.get('status')=='active' and prime.get('starts_at',0) <= now < prime.get('ends_at',0))


def approved(shop):
    return bool(shop and shop.get('status') == 'approved' and
                (verified(shop) or not shop.get('verification') and not shop.get('submitted_at')))


def _save_grants(u, sid, grants, now):
    u.put('shop_access_members',sid,dict(id=sid,grants=sorted(grants,key=lambda g:g['starts_at']),policy=POLICY,updated_at=now))


def _reflow(u, attempt, grants, start, end, now):
    result=[]
    for grant in sorted(grants,key=lambda g:g['starts_at']):
        if grant['starts_at'] > now and grant['ends_at'] > start and grant['starts_at'] < end:
            old=u.get('shop_access_payments',grant['attempt_id'])
            if (not old or old.get('shop_id') != attempt['shop_id'] or old.get('owner_id') != attempt['owner_id'] or old.get('status') != 'captured'
                    or old.get('payment_id') != grant['payment_id'] or old.get('grant_starts_at') != grant['starts_at']
                    or old.get('grant_ends_at') != grant['ends_at']):
                fail('PAYMENT_REVIEW_REQUIRED','An earlier prepaid month needs reconciliation.')
            previous_start,previous_end=grant['starts_at'],grant['ends_at']
            grant={**grant,'starts_at':end,'ends_at':month_after(end)}
            audit(u,'ShopPrepaidMonthMoved','razorpay',shop_id=attempt['shop_id'],attempt_id=old['id'],previous_starts_at=previous_start,previous_ends_at=previous_end,starts_at=grant['starts_at'],ends_at=grant['ends_at'])
            old.update(grant_starts_at=grant['starts_at'],grant_ends_at=grant['ends_at'])
            u.put('shop_access_payments',old['id'],old)
            end=grant['ends_at']
        result.append(grant)
    return result


def apply_payment(u, attempt, payment, now=None):
    """Only authenticated provider GET data may reach this entry point."""
    now=time.time() if now is None else now
    if not attempt or attempt.get('kind') != 'shop_access':
        fail('ORDER_NOT_FOUND','Shop access payment not found.',404)
    if (payment.get('order_id') != attempt.get('order_id') or payment.get('currency') != 'INR'
            or type(payment.get('amount')) is not int or payment['amount'] != PRICE
            or not re.fullmatch(r'pay_[A-Za-z0-9]+',str(payment.get('id','')))):
        fail('PAYMENT_MISMATCH','This payment does not match shop access.')
    linked=u.get('shop_access_orders',attempt['order_id'])
    if not linked or linked.get('attempt_id') != attempt['id'] or linked.get('shop_id') != attempt['shop_id'] or linked.get('owner_id') != attempt['owner_id']:
        fail('ORDER_MISMATCH','Shop payment needs reconciliation.')
    pid=payment['id'];refund=payment.get('amount_refunded',0)
    refund=0 if refund is None else refund
    if type(refund) is not int or not 0 <= refund <= PRICE or payment.get('status') == 'refunded' and not refund:
        fail('PAYMENT_MISMATCH','The provider refund needs reconciliation.')
    if (payment.get('status') in ('captured','refunded') or refund) and attempt.get('payment_id') and attempt['payment_id'] != pid:
        fail('DUPLICATE_COLLECTION_REVIEW','Another payment on this order needs reconciliation.')
    receipt=u.get('receipts',pid)
    if receipt and (receipt.get('kind') != 'shop_access' or receipt.get('shop_access_attempt_id') != attempt['id'] or receipt.get('shop_id') != attempt['shop_id'] or receipt.get('owner_id') != attempt['owner_id']):
        fail('PAYMENT_ALREADY_USED','This payment belongs to another purchase.')
    refund=max(refund,attempt.get('amount_refunded',0));grants=_grants(u,attempt['shop_id'])
    if refund:
        attempt.update(status='refunded',amount_refunded=refund,payment_id=pid)
        _save_grants(u,attempt['shop_id'],[g for g in grants if g['attempt_id'] != attempt['id']],now)
    elif payment.get('status') == 'captured' and payment.get('captured') is True and attempt['status'] not in ('captured','refunded'):
        shop=u.get('shops',attempt['shop_id'])
        if not shop or shop.get('owner_id') != attempt['owner_id']:
            fail('PAYMENT_REVIEW_REQUIRED','This shop ownership changed; contact support to reconcile payment.')
        state=access_status(u,shop,now);start=max(now,state['current_period_ends_at'] or 0);end=month_after(start)
        grants=_reflow(u,attempt,grants,start,end,now)
        grant=dict(attempt_id=attempt['id'],payment_id=pid,starts_at=start,ends_at=end)
        _save_grants(u,attempt['shop_id'],[*grants,grant],now)
        attempt.update(status='captured',payment_id=pid,grant_starts_at=start,grant_ends_at=end)
        audit(u,'ShopAccessPaid','razorpay',shop_id=shop['id'],amount_paise=PRICE,payment_id=pid,ends_at=end)
    elif attempt['status'] not in ('captured','refunded'):
        attempt['last_payment_status']=payment.get('status','unknown')
    if attempt['status'] in ('captured','refunded') and not receipt:
        u.put('receipts',pid,dict(id=pid,kind='shop_access',shop_access_attempt_id=attempt['id'],shop_id=attempt['shop_id'],owner_id=attempt['owner_id'],amount_paise=PRICE,currency='INR',verified_at=now))
    attempt['checked_at']=now;u.put('shop_access_payments',attempt['id'],attempt)
    return attempt


def apply_provider_payment(u,payment):
    linked=u.get('shop_access_orders',payment.get('order_id',''))
    if not linked:return None
    attempt=u.get('shop_access_payments',linked['attempt_id'])
    if not attempt or attempt.get('owner_id') != linked['owner_id'] or attempt.get('shop_id') != linked['shop_id']:
        fail('ORDER_MISMATCH','Shop payment needs reconciliation.')
    return apply_payment(u,attempt,payment)


def install(core):
    router=APIRouter(prefix='/operations/shop/access',tags=['Shop access']);store=core.operations_store
    def owner(user=Depends(core.current_user)):
        if not user.get('phone_authenticated'):fail('PHONE_OTP_REQUIRED','Sign in with your shop mobile OTP.',403)
        return user
    def owned(u,user):
        rows=u.find('shops','owner_id',user['id'])
        if len(rows) != 1:fail('SHOP_REQUIRED','A single registered shop account is required.',403)
        return rows[0]
    def state(u,user):return access_status(u,owned(u,user))
    def attach(attempt,order):
        notes=order.get('notes') or {}
        if (type(order.get('amount')) is not int or order['amount'] != PRICE or order.get('currency') != 'INR'
                or order.get('receipt') != attempt['receipt'] or not re.fullmatch(r'order_[A-Za-z0-9]+',str(order.get('id','')))
                or notes.get('kind') != 'shop_access' or notes.get('shop_id') != attempt['shop_id'] or notes.get('owner_id') != attempt['owner_id']):
            fail('ORDER_MISMATCH','Shop access order needs reconciliation.')
        def save(u):
            a=u.get('shop_access_payments',attempt['id']);linked=u.get('shop_access_orders',order['id'])
            if not a or a['owner_id'] != attempt['owner_id'] or a['shop_id'] != attempt['shop_id'] or (a.get('order_id') and a['order_id'] != order['id']) or linked and linked.get('attempt_id') != a['id']:
                fail('ORDER_MISMATCH','Shop access order needs reconciliation.')
            a['order_id']=order['id']
            if a['status']=='creating':a['status']='created'
            u.put('shop_access_orders',order['id'],dict(attempt_id=a['id'],shop_id=a['shop_id'],owner_id=a['owner_id']))
            u.put('shop_access_payments',a['id'],a);return a
        return store.run(save)
    def reconcile(attempt):
        if not attempt.get('order_id'):
            matches=[o for o in razorpay('orders?receipt='+attempt['receipt']).get('items',[]) if o.get('receipt')==attempt['receipt']]
            if len(matches)!=1:fail('PAYMENT_RECONCILING','The provider has not confirmed this order. Check again before another payment.',503)
            attempt=attach(attempt,matches[0])
        authorized=False
        for row in razorpay('orders/'+attempt['order_id']+'/payments').get('items',[]):
            pid=row.get('id','')
            if not re.fullmatch(r'pay_[A-Za-z0-9]+',str(pid)):fail('PAYMENT_MISMATCH','The provider payment needs reconciliation.')
            payment=razorpay('payments/'+pid)
            if payment.get('id') != pid:fail('PAYMENT_MISMATCH','The provider payment needs reconciliation.')
            attempt=store.run(lambda u:apply_payment(u,u.get('shop_access_payments',attempt['id']),payment))
            authorized |= payment.get('status')=='authorized'
        if authorized and attempt['status'] not in ('captured','refunded'):fail('PAYMENT_PROCESSING','Payment is authorized and awaiting capture. Check before retrying.')
        return attempt
    @router.get('')
    def status(user=Depends(owner)):return store.run(lambda u:state(u,user))
    @router.put('/settings')
    def settings(body:Settings,user=Depends(owner)):
        def save(u):
            shop=owned(u,user);current=u.get('shop_access_settings',shop['id']) or {'version':0}
            if current['version'] != body.expected_version:fail('SETTINGS_CHANGED','Refresh shop settings before saving.',409)
            if type(shop.get('created_at')) in (int,float) and time.time() < registration_start(shop)+TRIAL_DAYS*86400 and not body.default_offer_enabled:
                fail('TRIAL_OFFER_REQUIRED','The default 5% offer remains enabled during the registration trial.',409)
            row=dict(id=shop['id'],default_offer_enabled=body.default_offer_enabled,version=current['version']+1)
            u.put('shop_access_settings',shop['id'],row);audit(u,'ShopDefaultOfferChanged',user['id'],shop_id=shop['id'],enabled=body.default_offer_enabled)
            return state(u,user)
        return store.run(save)
    @router.post('/order')
    def order(body:Purchase,user=Depends(owner)):
        if not payments_ready():fail('PAYMENTS_UNAVAILABLE','Shop access payments are not connected. No charge was made.',503)
        def reserve(u):
            shop=owned(u,user);key=hashlib.sha256((user['id']+':'+shop['id']+':'+body.request_id).encode()).hexdigest()
            previous=u.get('shop_access_requests',key)
            if previous:
                a=u.get('shop_access_payments',previous['attempt_id'])
                if not a or a['owner_id'] != user['id'] or a['shop_id'] != shop['id']:fail('PAYMENT_REVIEW_REQUIRED','Your earlier purchase needs reconciliation.')
                return a,False
            if not approved(shop):fail('SHOP_APPROVAL_REQUIRED','Independent shop approval is required before paid visibility.',403)
            account=u.get('shop_access_accounts',shop['id']) or {};a=u.get('shop_access_payments',account.get('attempt_id','')) if account.get('attempt_id') else None
            if a and a['status'] in ('creating','created'):
                if a['owner_id'] != user['id']:fail('PAYMENT_REVIEW_REQUIRED','A previous owner payment needs reconciliation.')
                u.put('shop_access_requests',key,dict(id=key,owner_id=user['id'],shop_id=shop['id'],attempt_id=a['id']));return a,False
            if sum(g['ends_at']>time.time() for g in _grants(u,shop['id'])) >= MAX_PREPAID_PERIODS:fail('RENEWAL_TOO_EARLY','Twelve prepaid months are already recorded.')
            aid=str(uuid.uuid4());a=dict(id=aid,receipt='sa_'+aid.replace('-',''),kind='shop_access',shop_id=shop['id'],owner_id=user['id'],amount_paise=PRICE,currency='INR',status='creating',created_at=time.time(),policy=POLICY)
            u.put('shop_access_payments',aid,a);u.put('shop_access_accounts',shop['id'],dict(id=shop['id'],attempt_id=aid));u.put('shop_access_requests',key,dict(id=key,owner_id=user['id'],shop_id=shop['id'],attempt_id=aid));return a,True
        attempt,fresh=store.run(reserve)
        if fresh:attempt=attach(attempt,razorpay('orders',dict(amount=PRICE,currency='INR',receipt=attempt['receipt'],notes={'kind':'shop_access','shop_id':attempt['shop_id'],'owner_id':user['id']})))
        elif attempt['status'] not in ('captured','refunded'):attempt=reconcile(attempt)
        if attempt['status'] in ('captured','refunded'):return {'settled':True,**store.run(lambda u:state(u,user))}
        return dict(key_id=os.environ['RAZORPAY_KEY_ID'],order_id=attempt['order_id'],amount=PRICE,currency='INR',attempt_id=attempt['id'],shop_id=attempt['shop_id'])
    @router.post('/check')
    def check(body:Check|None=None,user=Depends(owner)):
        def attempts(u):
            shop=owned(u,user);account=u.get('shop_access_accounts',shop['id']) or {};ids=[g['attempt_id'] for g in _grants(u,shop['id']) if g['ends_at']>time.time()]
            if account.get('attempt_id'):ids.append(account['attempt_id'])
            if body and body.attempt_id:ids.append(body.attempt_id)
            rows=[u.get('shop_access_payments',aid) for aid in dict.fromkeys(ids)]
            if any(not a or a['owner_id'] != user['id'] or a['shop_id'] != shop['id'] for a in rows):fail('NOT_FOUND','Shop payment not found.',404)
            return rows
        for attempt in store.run(attempts):reconcile(attempt)
        return store.run(lambda u:state(u,user))
    def tick():
        if not payments_ready():return {'attempted':0,'errors':0}
        def claim(u):
            now=time.time();claimed=[]
            for status in ('creating','created'):
                pointer=u.get('shop_access_reconcile',status) or {};after=pointer.get('after_id')
                rows=u.find('shop_access_payments','status',status,limit=5,after=after)
                if not rows and after:rows=u.find('shop_access_payments','status',status,limit=5)
                next_id=rows[-1]['id'] if len(rows)==5 else None
                if next_id != after:u.put('shop_access_reconcile',status,dict(id=status,after_id=next_id))
                for attempt in rows:
                    if attempt.get('next_check_at',0)>now:continue
                    attempt['next_check_at']=now+300;u.put('shop_access_payments',attempt['id'],attempt);claimed.append(attempt)
            return claimed
        rows=store.run(claim);errors=0
        for attempt in rows:
            try:reconcile(attempt)
            except Exception:errors+=1
        return {'attempted':len(rows),'errors':errors}
    core.shop_access_tick=tick
    core.app.include_router(router)
