"""Compatibility checkout recovery through real HTTP and native transactions.

Provider responses are synthetic. No payment provider or production database is
contacted; native runs require an explicitly configured loopback emulator.
"""
import copy
import hashlib
import hmac
import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import HTTPException

import integrations
import legacy_checkout
import main
from test_operations import api, auth


@pytest.fixture(autouse=True)
def quiet_scheduler(monkeypatch):
    # Apply before TestClient starts. Patching after api yields can leave its
    # initial background sweep running while the fixture switches databases.
    monkeypatch.setattr(main,'operations_tick',lambda:None)


class Provider:
    def __init__(self):
        self.orders = {}
        self.payments = {}
        self.refunds = {}
        self.calls = []
        self.lose_order = self.lose_refund = False
        self.refund_status = 'processed'
        self.lock = threading.RLock()

    def __call__(self,path,body=None,**kwargs):
        with self.lock:
            self.calls.append((path,copy.deepcopy(body)))
            if path == 'orders' and body:
                order = dict(body,id='order_'+uuid.uuid4().hex,status='created')
                self.orders[order['id']] = order
                if self.lose_order: raise HTTPException(503,'Synthetic response lost after order creation')
                return copy.deepcopy(order)
            if path.startswith('orders?receipt='):
                return {'items':[copy.deepcopy(order) for order in self.orders.values() if order['receipt']==path.split('=',1)[1]]}
            if path.startswith('orders/') and path.endswith('/payments'):
                return {'items':[copy.deepcopy(payment) for payment in self.payments.values() if payment['order_id']==path.split('/')[1]]}
            if path.startswith('payments/') and path.endswith('/refund'):
                payment_id = path.split('/')[1]
                refund = dict(body,id='rfnd_'+uuid.uuid4().hex,payment_id=payment_id,currency='INR',status=self.refund_status)
                self.refunds[refund['id']] = refund
                if self.refund_status == 'processed':
                    self.payments[payment_id].update(status='refunded',amount_refunded=body['amount'])
                if self.lose_refund: raise HTTPException(503,'Synthetic response lost after refund submission')
                return copy.deepcopy(refund)
            if path.startswith('payments/') and '/refunds?' in path:
                payment_id = path.split('/')[1]
                return {'items':[copy.deepcopy(refund) for refund in self.refunds.values() if refund['payment_id']==payment_id]}
            if path.startswith('refunds/'):
                return copy.deepcopy(self.refunds[path.split('/')[1]])
            if path.startswith('payments/'):
                return copy.deepcopy(self.payments[path.split('/')[1]])
            raise AssertionError(path)

    def capture(self,order):
        key = 'pay_'+uuid.uuid4().hex
        self.payments[key] = dict(id=key,order_id=order['razorpay_order_id'],amount=order['amount_paise'],
            amount_refunded=0,currency='INR',status='captured',captured=True)
        return key


@pytest.fixture(params=['sqlite','native'])
def checkout(api,monkeypatch,request):
    if request.param == 'native':
        host = os.getenv('FIRESTORE_EMULATOR_HOST','')
        if not host: pytest.skip('Requires a loopback Firestore emulator')
        assert host.startswith(('127.0.0.1:','localhost:'))
        from google.auth.credentials import AnonymousCredentials
        from google.cloud.firestore import Client
        database = Client(project='demo-repaido-legacy-recovery-'+uuid.uuid4().hex[:10],credentials=AnonymousCredentials())
        monkeypatch.setattr(main,'USE_FIRESTORE',True)
        monkeypatch.setattr(main,'fb_db',database)
        main.fs_doc('services','ac-service').set(dict(id='ac-service',name='AC service',category='ac',price_paise=59900,duration_minutes=60))
    else:
        with main.db() as connection:
            for uid in ('customer','stranger'):
                connection.execute('INSERT OR IGNORE INTO users VALUES(?,?,?,?,?)',(uid,uid,uid+'@example.test','unused',0))
    monkeypatch.setenv('RAZORPAY_KEY_ID','synthetic-public-key')
    monkeypatch.setenv('RAZORPAY_KEY_SECRET','synthetic-recovery-secret')
    provider = Provider()
    monkeypatch.setattr(integrations,'razorpay',provider)
    yield api,provider
    if request.param == 'native': database.close()


def details(**changes):
    return dict(service_id='ac-service',city='Balasore',address='Private synthetic address',phone='9876543210',
        starts_at=main.candidates()[0].isoformat(),idempotency_key=str(uuid.uuid4()),**changes)


def create(api,body=None,status=201):
    response=api.post('/checkout/booking/order',headers=auth('customer'),json=body or details())
    assert response.status_code==status,response.text
    return response.json()


def proof(order,payment_id):
    return dict(payment_order_id=order['payment_order_id'],razorpay_order_id=order['razorpay_order_id'],
        razorpay_payment_id=payment_id,razorpay_signature=hmac.new(b'synthetic-recovery-secret',
            (order['razorpay_order_id']+'|'+payment_id).encode(),hashlib.sha256).hexdigest())


def fill_slot(api,starts_at):
    for _ in range(3):
        body=details();body['starts_at']=starts_at
        response=api.post('/bookings',headers=auth('customer'),json=body)
        assert response.status_code==201,response.text


def waiting(checkout):
    api,provider=checkout
    body=details();order=create(api,body)
    fill_slot(api,body['starts_at'])
    payment_id=provider.capture(order)
    response=api.post('/checkout/booking/verify',headers=auth('customer'),json=proof(order,payment_id))
    assert response.status_code==409,response.text
    case=legacy_checkout.case_for(main,order['payment_order_id'],'customer')
    assert case['state']=='action_required'
    return order,payment_id,case


def action(api,key,action,body=None,uid='customer',status=200):
    response=api.post('/operations/booking-checkout/'+key+'/'+action,headers=auth(uid),json=body)
    assert response.status_code==status,response.text
    return response.json()


def test_order_retry_reuses_one_provider_order_and_rejects_changed_details(checkout):
    api,provider=checkout;body=details()
    first=create(api,body)
    assert create(api,body)==first
    changed={**body,'address':'A different private address'}
    create(api,changed,status=409)
    assert sum(path=='orders' and body is not None for path,body in provider.calls)==1


def test_lost_order_response_is_reconciled_without_another_post(checkout):
    api,provider=checkout;body=details();provider.lose_order=True
    create(api,body,status=503)
    provider.lose_order=False
    result=create(api,body)
    assert result['razorpay_order_id'] in provider.orders
    assert sum(path=='orders' and body is not None for path,body in provider.calls)==1


def test_known_full_slot_is_rejected_before_provider_order_creation(checkout):
    api,provider=checkout;body=details();fill_slot(api,body['starts_at'])
    create(api,body,status=409)
    assert provider.calls==[]


def test_captured_payment_recovers_to_another_time_without_recharging(checkout):
    api,provider=checkout;order,payment_id,case=waiting(checkout)
    checked=action(api,order['payment_order_id'],'check')
    assert checked['available_starts']
    other=next(value for value in checked['available_starts'] if value!=case['starts_at'])
    result=action(api,case['id'],'reschedule',dict(expected_version=checked['version'],starts_at=other))
    assert result['state']=='fulfilled' and result['booking_id']
    assert main.operations_store.run(lambda u:legacy_checkout.raw_payment(u,case['id']))['status']=='paid'
    assert sum(path=='orders' and body is not None for path,body in provider.calls)==1
    assert not provider.refunds
    assert action(api,case['id'],'check')['booking_id']==result['booking_id']


def test_lost_refund_response_reconciles_once_and_cannot_fulfill_again(checkout):
    api,provider=checkout;order,payment_id,case=waiting(checkout)
    provider.lose_refund=True
    action(api,case['id'],'refund',dict(expected_version=case['version']),status=503)
    result=action(api,case['id'],'check')
    assert result['state']=='refunded'
    assert action(api,case['id'],'refund',dict(expected_version=case['version']))['state']=='refunded'
    response=api.post('/checkout/booking/verify',headers=auth('customer'),json=proof(order,payment_id))
    assert response.status_code==409
    assert sum(path.endswith('/refund') and body is not None for path,body in provider.calls)==1
    assert main.operations_store.run(lambda u:legacy_checkout.raw_payment(u,case['id']))['status']=='refunded'


def test_unknown_refund_outcome_does_not_submit_another_refund(checkout):
    api,provider=checkout;_,_,case=waiting(checkout)
    provider.lose_refund=True
    action(api,case['id'],'refund',dict(expected_version=case['version']),status=503)
    provider.refunds.clear()
    assert action(api,case['id'],'check')['state']=='refund_submitting'
    assert action(api,case['id'],'refund',dict(expected_version=case['version']))['state']=='refund_submitting'
    assert sum(path.endswith('/refund') and body is not None for path,body in provider.calls)==1


def test_refund_hold_blocks_an_inflight_booking_confirmation(checkout,monkeypatch):
    api,provider=checkout;order=create(api);payment_id=provider.capture(order)
    arrived=threading.Event();release=threading.Event();original=main.fulfill_booking_payment
    def paused(*args):
        arrived.set();assert release.wait(15)
        return original(*args)
    monkeypatch.setattr(main,'fulfill_booking_payment',paused)
    with ThreadPoolExecutor(max_workers=1) as pool:
        confirming=pool.submit(lambda:api.post('/checkout/booking/verify',headers=auth('customer'),json=proof(order,payment_id)))
        try:
            assert arrived.wait(15)
            case=legacy_checkout.case_for(main,order['payment_order_id'],'customer')
            assert action(api,case['id'],'refund',dict(expected_version=case['version']))['state']=='refunded'
        finally:release.set()
        assert confirming.result().status_code==409
    assert legacy_checkout.case_for(main,order['payment_order_id'],'customer')['state']=='refunded'


def test_stranger_cannot_read_recover_reschedule_or_refund_an_owned_payment(checkout):
    api,provider=checkout;_,_,case=waiting(checkout);before=len(provider.calls)
    for endpoint,body in [('check',None),('reschedule',dict(expected_version=case['version'],starts_at=case['starts_at'])),('refund',dict(expected_version=case['version']))]:
        action(api,case['id'],endpoint,body,uid='stranger',status=404)
    response=api.get('/operations/booking-checkout',headers=auth('stranger'))
    assert response.status_code==200 and response.json()['cases']==[]
    assert len(provider.calls)==before
    own=api.get('/operations/booking-checkout',headers=auth('customer'))
    assert own.headers['cache-control']=='private, no-store'
    assert 'Private synthetic address' not in own.text and '9876543210' not in own.text and 'razorpay_signature' not in own.text


def test_external_full_refund_is_verified_without_reopening_checkout(checkout):
    api,provider=checkout;_,payment_id,case=waiting(checkout)
    provider.payments[payment_id].update(status='refunded',amount_refunded=case['amount_paise'])
    assert action(api,case['id'],'check')['state']=='refunded'
    assert provider.refunds=={}


def test_failed_refund_requires_review_without_releasing_fulfillment_hold(checkout):
    api,provider=checkout;order,payment_id,case=waiting(checkout);provider.refund_status='failed'
    assert action(api,case['id'],'refund',dict(expected_version=case['version']))['state']=='refund_failed'
    assert api.post('/checkout/booking/verify',headers=auth('customer'),json=proof(order,payment_id)).status_code==409
    assert action(api,case['id'],'refund',dict(expected_version=case['version']))['state']=='refund_failed'
    assert len(provider.refunds)==1


def test_confirmation_commit_survives_a_lost_response_without_another_capture(checkout,monkeypatch):
    api,provider=checkout;order=create(api);payment_id=provider.capture(order)
    original=main.fulfill_booking_payment
    def lost(*args):
        original(*args)
        raise HTTPException(503,'Synthetic response lost after booking commit')
    monkeypatch.setattr(main,'fulfill_booking_payment',lost)
    response=api.post('/checkout/booking/verify',headers=auth('customer'),json=proof(order,payment_id))
    assert response.status_code==503
    before=len(provider.calls)
    result=action(api,order['payment_order_id'],'check')
    assert result['state']=='fulfilled' and result['booking_id']
    assert len(provider.calls)==before


def test_mismatched_refund_response_keeps_hold_and_never_reports_refunded(checkout,monkeypatch):
    api,provider=checkout;order,payment_id,case=waiting(checkout)
    def wrong(path,body=None,**kwargs):
        result=provider(path,body,**kwargs)
        if path.endswith('/refund'):result['amount']-=1
        return result
    monkeypatch.setattr(integrations,'razorpay',wrong)
    action(api,case['id'],'refund',dict(expected_version=case['version']),status=409)
    assert legacy_checkout.case_for(main,case['id'],'customer')['state']=='refund_submitting'
    assert main.operations_store.run(lambda u:legacy_checkout.raw_payment(u,case['id']))['status']=='created'
    assert action(api,case['id'],'check')['state']=='refunded'
    assert len(provider.refunds)==1


def test_incomplete_address_cannot_open_a_payment_order(checkout):
    api,provider=checkout;body=details();body['address']=' '*12
    create(api,body,status=422)
    assert provider.calls==[]


def test_unconfigured_gateway_does_not_reserve_a_stuck_payment_intent(checkout,monkeypatch):
    api,provider=checkout;monkeypatch.delenv('RAZORPAY_KEY_SECRET')
    create(api,status=503)
    assert provider.calls==[]
    assert main.operations_store.run(lambda u:u.all(legacy_checkout.INTENTS))==[]
