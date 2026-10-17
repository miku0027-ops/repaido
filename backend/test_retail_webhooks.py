"""Authenticated retail provider reconciliation without browser participation."""
import hashlib
import hmac
import json

import pytest
from fastapi import HTTPException

import integrations
import main
import retail_checkout
import retail_resolution
from test_operations import api, auth, ADMIN
from test_retail_checkout import seed, body, gateway


def enqueue(api,monkeypatch,payment,event='capture'):
    monkeypatch.setenv('RAZORPAY_WEBHOOK_SECRET','isolated-retail-webhook')
    # The payload deliberately lies about the amount. Only provider GET is proof.
    raw=json.dumps({'event':event,'payload':{'payment':{'entity':{'id':payment['id'],'amount':1}}}}).encode()
    signature=hmac.new(b'isolated-retail-webhook',raw,hashlib.sha256).hexdigest()
    response=api.post('/operations/webhooks/razorpay/payments',content=raw,headers={'X-Razorpay-Signature':signature})
    assert response.status_code==200,response.text


def test_malformed_webhook_signature_and_signed_structure_do_not_write_inbox(api,monkeypatch):
    monkeypatch.setenv('RAZORPAY_WEBHOOK_SECRET','isolated-retail-webhook')
    url='/operations/webhooks/razorpay/payments'
    assert api.post(url,content=b'{}',headers=[(b'X-Razorpay-Signature',b'\xff')]).status_code==401
    for value in ({'payload':[]},{'payload':{'payment':{'entity':[1]}}}):
        raw=json.dumps(value).encode()
        signature=hmac.new(b'isolated-retail-webhook',raw,hashlib.sha256).hexdigest()
        assert api.post(url,content=raw,headers={'X-Razorpay-Signature':signature}).status_code==400
    assert not main.operations_store.run(lambda u:u.all('webhooks'))


def purchase(api,monkeypatch):
    seed();_,payment=gateway(monkeypatch)
    response=api.post('/operations/retail/orders',headers=auth('customer'),json=body())
    assert response.status_code==201,response.text
    return response.json(),payment


def test_signed_webhook_completes_abandoned_checkout_once_without_financial_scan(api,monkeypatch):
    order,payment=purchase(api,monkeypatch)
    from operations import Unit
    original=Unit.all
    def bounded(self,kind):
        assert kind!='retail_orders','Retail webhook must use its direct provider-order lookup'
        return original(self,kind)
    monkeypatch.setattr(Unit,'all',bounded)
    calls=[]
    def provider(path,body=None):
        calls.append(path)
        assert path=='payments/'+payment['id']
        return payment
    monkeypatch.setattr(integrations,'razorpay',provider)
    for event in ('capture','capture-retry'):
        enqueue(api,monkeypatch,payment,event)
        assert main.integrations_reconcile()=={'errors':0}
    saved=main.operations_store.run(lambda u:u.get('retail_orders',order['id']))
    assert saved['state']=='paid' and saved['payment_id']==payment['id']
    assert len(main.operations_store.run(lambda u:u.all('journals')))==1
    assert len(main.operations_store.run(lambda u:u.all('shop_payables')))==2
    assert len(main.operations_store.run(lambda u:u.all('receipts')))==1
    assert calls==['payments/'+payment['id']]*2


@pytest.mark.parametrize('corrupt',[None,'receipt','notes','amount','id'])
def test_webhook_recovers_create_response_lost_before_order_index(api,monkeypatch,corrupt):
    seed();monkeypatch.setattr(retail_checkout,'payments_ready',lambda:True)
    provider_order={}
    def lost(path,body=None):
        assert path=='orders'
        provider_order.update(body,id='order_recovered')
        raise TimeoutError('Provider created the order, response was lost')
    monkeypatch.setattr(retail_checkout,'razorpay',lost)
    assert api.post('/operations/retail/orders',headers=auth('customer'),json=body()).status_code==503
    saved=main.operations_store.run(lambda u:u.all('retail_orders'))[0]
    payment=dict(id='pay_recovered',order_id='order_recovered',amount=22600,currency='INR',status='captured',captured=True,amount_refunded=0)
    if corrupt=='receipt':provider_order['receipt']='another-receipt'
    if corrupt=='notes':provider_order['notes']={'retail_order':'another-checkout'}
    if corrupt=='amount':provider_order['amount']=22599
    if corrupt=='id':provider_order['id']='order_different'
    calls=[]
    def provider(path,body=None):
        calls.append(path)
        return payment if path=='payments/pay_recovered' else provider_order
    monkeypatch.setattr(integrations,'razorpay',provider)
    enqueue(api,monkeypatch,payment)
    assert main.integrations_reconcile()=={'errors':int(bool(corrupt))}
    current=main.operations_store.run(lambda u:u.get('retail_orders',saved['id']))
    assert current['state']==('creating' if corrupt else 'paid')
    assert bool(main.operations_store.run(lambda u:u.get('retail_gateway_orders','order_recovered')))==(not corrupt)
    assert len(main.operations_store.run(lambda u:u.all('journals')))==(0 if corrupt else 1)
    assert calls==['payments/pay_recovered','orders/order_recovered']


def test_external_partial_refund_is_monotonic_and_holds_without_inventing_journals(api,monkeypatch):
    order,payment=purchase(api,monkeypatch)
    def apply(value):return main.operations_store.run(lambda u:integrations.apply_payment(u,value))
    apply(payment)
    journals=main.operations_store.run(lambda u:u.all('journals'))
    for value in ({**payment,'amount_refunded':100},{**payment,'amount_refunded':100},payment,
                  {**payment,'id':'pay_failed','status':'failed','captured':False}):
        apply(value)
    saved=main.operations_store.run(lambda u:u.get('retail_orders',order['id']))
    assert saved['provider_amount_refunded']==100 and saved.get('amount_refunded',0)==0
    assert saved['financial_hold'] and saved['allocation_review_required'] and saved['external_refund_review_required']
    assert saved['payment_id']==payment['id'] and saved['state']=='paid'
    payables=main.operations_store.run(lambda u:u.all('shop_payables'))
    assert sum(row['amount_paise'] for row in payables)==22600
    assert all(row['financial_hold'] and row['status']=='retail_refund_review' for row in payables)
    assert main.operations_store.run(lambda u:u.all('journals'))==journals
    assert api.post('/operations/retail/orders/'+order['id']+'/verify',headers=auth('customer'),json={'payment_id':payment['id']}).status_code==409


def test_refund_before_capture_never_creates_entitlement_or_accepts_another_payment(api,monkeypatch):
    order,payment=purchase(api,monkeypatch)
    for value in ({**payment,'status':'refunded','amount_refunded':22600},payment):
        main.operations_store.run(lambda u:integrations.apply_payment(u,value))
    saved=main.operations_store.run(lambda u:u.get('retail_orders',order['id']))
    assert saved['state']=='payment_pending' and saved['provider_amount_refunded']==22600 and saved['financial_hold']
    assert not main.operations_store.run(lambda u:u.all('shop_payables'))
    assert not main.operations_store.run(lambda u:u.all('journals'))
    assert api.post('/operations/retail/orders/'+order['id']+'/payment',headers=auth('customer')).status_code==409
    with pytest.raises(HTTPException):
        main.operations_store.run(lambda u:integrations.apply_payment(u,{**payment,'id':'pay_duplicate'}))


@pytest.mark.parametrize('amount',[4000,8000])
def test_owned_refund_webhook_race_keeps_resolution_accounting_and_release_rules(api,monkeypatch,amount):
    from test_retail_resolution import order,open_case,decide,gateway as refund_gateway,BASE
    saved=order(funded=True)
    main.operations_store.run(lambda u:retail_checkout.index_order(u,saved))
    case,_=open_case(api,saved,kind='refund');case,_=decide(api,case,amount=amount)
    state=refund_gateway(monkeypatch,saved)
    original=retail_resolution.razorpay
    def provider(path,body=None):
        result=original(path,body)
        if body is not None:
            payment=original('payments/'+saved['payment_id'])
            main.operations_store.run(lambda u:integrations.apply_payment(u,payment))
        return result
    monkeypatch.setattr(retail_resolution,'razorpay',provider)
    response=api.post(BASE+'/admin/resolutions/'+case['id']+'/refund',headers=ADMIN,json={})
    assert response.status_code==200,response.text
    assert response.json()['refund_status']=='processed' and state['posts']==1
    current=main.operations_store.run(lambda u:u.get('retail_orders',saved['id']))
    assert current['amount_refunded']==current['provider_amount_refunded']==amount
    assert not current['financial_hold'] and not current.get('external_refund_review_required')
    assert current['state']==('refunded' if amount==8000 else 'paid')
    journals=main.operations_store.run(lambda u:u.all('journals'))
    assert len(journals)==2
    for value in (original('payments/'+saved['payment_id']),dict(id=saved['payment_id'],order_id=saved['order_id'],amount=8000,currency='INR',status='captured',captured=True,amount_refunded=0)):
        main.operations_store.run(lambda u:integrations.apply_payment(u,value))
    assert main.operations_store.run(lambda u:u.all('journals'))==journals
    assert not main.operations_store.run(lambda u:u.get('retail_orders',saved['id']))['financial_hold']


def test_external_refund_during_owned_refund_cannot_be_hidden_by_stale_provider_get(api,monkeypatch):
    from test_retail_resolution import order,open_case,decide,gateway as refund_gateway,BASE
    saved=order(funded=True)
    main.operations_store.run(lambda u:retail_checkout.index_order(u,saved))
    case,_=open_case(api,saved,kind='refund');case,_=decide(api,case,amount=4000)
    refund_gateway(monkeypatch,saved)
    original=retail_resolution.razorpay
    def provider(path,body=None):
        result=original(path,body)
        if body is not None:
            payment={**original('payments/'+saved['payment_id']),'amount_refunded':4500}
            main.operations_store.run(lambda u:integrations.apply_payment(u,payment))
        # The following GET still reports only the owned 4000-paise refund.
        return result
    monkeypatch.setattr(retail_resolution,'razorpay',provider)
    response=api.post(BASE+'/admin/resolutions/'+case['id']+'/refund',headers=ADMIN,json={})
    assert response.status_code==409,response.text
    current=main.operations_store.run(lambda u:u.get('retail_orders',saved['id']))
    assert current['provider_amount_refunded']==4500 and current.get('amount_refunded',0)==0
    assert current['financial_hold'] and current['refund_pending']
    assert len(main.operations_store.run(lambda u:u.all('journals')))==1


def test_refund_reservation_rechecks_provider_high_water_after_network_read(api,monkeypatch):
    from test_retail_resolution import order,open_case,decide,gateway as refund_gateway,BASE
    saved=order(funded=True)
    main.operations_store.run(lambda u:retail_checkout.index_order(u,saved))
    case,_=open_case(api,saved,kind='refund');case,_=decide(api,case,amount=4000)
    state=refund_gateway(monkeypatch,saved)
    original=retail_resolution.razorpay
    def provider(path,body=None):
        result=original(path,body)
        if path=='payments/'+saved['payment_id']:
            main.operations_store.run(lambda u:integrations.apply_payment(u,{**result,'amount_refunded':100}))
        return result
    monkeypatch.setattr(retail_resolution,'razorpay',provider)
    response=api.post(BASE+'/admin/resolutions/'+case['id']+'/refund',headers=ADMIN,json={})
    assert response.status_code==409,response.text
    assert state['posts']==0
    current=main.operations_store.run(lambda u:u.get('retail_orders',saved['id']))
    assert current['provider_amount_refunded']==100 and current['financial_hold']
    assert not current.get('refund_pending')


@pytest.mark.parametrize('changes',[{'amount':22600.0},{'currency':'USD'},{'captured':False},{'amount_refunded':-1},{'amount_refunded':22601},{'amount_refunded':True},{'id':'pay_bad/path'}])
def test_shared_handler_rechecks_provider_amount_identity_and_refund_bounds(api,monkeypatch,changes):
    order,payment=purchase(api,monkeypatch)
    with pytest.raises(HTTPException):
        main.operations_store.run(lambda u:integrations.apply_payment(u,{**payment,**changes}))
    assert main.operations_store.run(lambda u:u.get('retail_orders',order['id']))['state']=='payment_pending'
    assert not main.operations_store.run(lambda u:u.all('journals'))
