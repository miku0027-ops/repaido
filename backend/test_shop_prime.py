import copy
import time
from datetime import datetime
from zoneinfo import ZoneInfo
import pytest
import main
import shop_prime
import integrations
from test_operations import api, auth, ADMIN
from test_procurement import setup_shop, STOCK

REFURB = dict(grade='B', cosmetic_condition='Small scratch on casing', tested_functions='Power, charging and buttons passed bench testing',
              tested_on='2026-01-01', repairs='Charging port replaced', known_defects='Small scratch only', accessories='Charger and cable',
              battery_health_percent=86, warranty_days=90, warranty_terms='Shop repair warranty for electrical faults', return_days=7, return_terms='Return to shop for a disclosed fault mismatch')

@pytest.fixture
def gateway(monkeypatch):
    monkeypatch.setenv('REPAIDO_PAYMENTS_ENABLED','true')
    monkeypatch.setenv('RAZORPAY_KEY_ID','rzp_test_fixture')
    monkeypatch.setenv('RAZORPAY_KEY_SECRET','fixture-secret')
    monkeypatch.setenv('RAZORPAY_WEBHOOK_SECRET','fixture-webhook')
    state={'orders':[], 'payments':[], 'creates':0, 'unknown':False}
    def request(path,body=None):
        if path=='orders' and body:
            state['creates']+=1
            row={**body,'id':'order_'+str(state['creates'])};state['orders'].append(row)
            if state['unknown']:raise RuntimeError('Provider timed out after creating order')
            return row
        if path.startswith('orders?receipt='):
            return {'items':[o for o in state['orders'] if o['receipt']==path.split('=',1)[1]]}
        if path.startswith('orders/') and path.endswith('/payments'):
            return {'items':[p for p in state['payments'] if p['order_id']==path.split('/')[1]]}
        raise AssertionError(path)
    monkeypatch.setattr(shop_prime,'razorpay',request)
    return state

def purchase(api,gateway):
    r=api.post('/operations/shop/prime/order',headers=auth('shop'));assert r.status_code==200,r.text
    order=r.json();assert order['amount']==149900 and order['shop_id']=='shop1'
    p=dict(id='pay_prime'+str(gateway['creates']),order_id=order['order_id'],amount=149900,currency='INR',status='captured',captured=True,amount_refunded=0)
    gateway['payments'].append(p)
    r=api.post('/operations/shop/prime/check',headers=auth('shop'));assert r.status_code==200,r.text
    return r.json(),p

def test_prime_capture_ownership_expiry_refund_and_badges(api,gateway):
    setup_shop(api)
    assert api.get('/operations/shop/prime',headers=auth('customer')).status_code==403
    assert api.post('/operations/shop/prime/order',headers=auth('worker')).status_code==403
    assert not api.get('/operations/products/catalog').json()['items'][0]['prime']['active']
    data,p=purchase(api,gateway);assert data['active']
    end=data['ends_at'];assert api.get('/operations/products/catalog').json()['items'][0]['prime']['active']
    assert api.get('/operations/products/catalog').json()['shops'][0]['prime']['active']
    assert api.post('/operations/shop/prime/order',headers=auth('shop')).status_code==409
    assert api.post('/operations/shop/prime/check',headers=auth('shop')).json()['ends_at']==end
    assert gateway['creates']==1
    from unittest.mock import patch
    with patch('shop_prime.time.time',return_value=end):
        assert not api.get('/operations/shop/prime',headers=auth('shop')).json()['active']
    p.update(amount_refunded=1)
    data=api.post('/operations/shop/prime/check',headers=auth('shop')).json();assert not data['active']
    assert not api.get('/operations/products/catalog').json()['items'][0]['prime']['active']
    p.update(amount_refunded=0)
    assert not api.post('/operations/shop/prime/check',headers=auth('shop')).json()['active']
    assert gateway['creates']==1

def test_prime_pending_retry_unknown_outcome_and_wrong_payment(api,gateway):
    setup_shop(api)
    gateway['unknown']=True
    with pytest.raises(RuntimeError):api.post('/operations/shop/prime/order',headers=auth('shop'))
    gateway['unknown']=False
    order=api.post('/operations/shop/prime/order',headers=auth('shop')).json()
    assert gateway['creates']==1
    assert api.post('/operations/shop/prime/order',headers=auth('shop')).json()['order_id']==order['order_id']
    p=dict(id='pay_wrong',order_id=order['order_id'],currency='INR',amount=1,status='captured',captured=True)
    gateway['payments'].append(p)
    assert api.post('/operations/shop/prime/check',headers=auth('shop')).status_code==409
    assert not api.get('/operations/shop/prime',headers=auth('shop')).json()['active']
    p.update(amount=149900,currency='USD')
    assert api.post('/operations/shop/prime/check',headers=auth('shop')).status_code==409
    p.update(currency='INR',status='authorized',captured=False)
    assert api.post('/operations/shop/prime/order',headers=auth('shop')).status_code==409
    assert not api.get('/operations/shop/prime',headers=auth('shop')).json()['active']

def test_prime_webhook_reconciliation_suspension_and_renewal(api,gateway,monkeypatch):
    setup_shop(api);data,p=purchase(api,gateway)
    def suspend(u):
        s=u.get('shops','shop1');s['status']='suspended';u.put('shops','shop1',s)
        assert not shop_prime.public_prime(u,s)['active']
    main.operations_store.run(suspend)
    assert api.get('/operations/products/catalog').json()['items']==[]
    def restore(u):
        s=u.get('shops','shop1');s['status']='approved';u.put('shops','shop1',s)
    main.operations_store.run(restore)
    from unittest.mock import patch
    with patch('shop_prime.time.time',return_value=data['ends_at']+1):
        newer,p2=purchase(api,gateway);assert newer['active'] and gateway['creates']==2
    oldrefund={**p,'amount_refunded':149900,'status':'refunded'}
    main.operations_store.run(lambda u:integrations.apply_payment(u,oldrefund))
    member=main.operations_store.run(lambda u:u.get('shop_prime','shop1'))
    assert member['payment_id']==p2['id'] and member['status']=='active'
    main.operations_store.run(lambda u:integrations.apply_payment(u,{**p2,'amount_refunded':149900,'status':'refunded'}))
    assert main.operations_store.run(lambda u:u.get('shop_prime','shop1'))['status']=='revoked'

def test_refurbishment_required_validation_public_data_and_badge_injection(api):
    setup_shop(api)
    body={**STOCK,'sku':'REF-1','condition':'refurbished'}
    assert api.put('/operations/shop/inventory/refurb1',headers=auth('shop'),json=body).status_code==422
    body['refurbishment']=REFURB
    assert api.put('/operations/shop/inventory/refurb1',headers=auth('shop'),json={**body,'prime':{'active':True}}).status_code==422
    assert api.put('/operations/shop/inventory/refurb1',headers=auth('shop'),json={**body,'refurbishment':{**REFURB,'tested_on':'2099-01-01'}}).status_code==422
    assert api.put('/operations/shop/inventory/refurb1',headers=auth('shop'),json={**body,'refurbishment':{**REFURB,'battery_health_percent':101}}).status_code==422
    r=api.put('/operations/shop/inventory/refurb1',headers=auth('shop'),json=body);assert r.status_code==200,r.text
    row=next(p for p in api.get('/operations/products/catalog').json()['items'] if p['id']=='refurb1')
    assert row['refurbishment']==REFURB and not row['prime']['active']
    assert api.put('/operations/shop/inventory/refurb1',headers=auth('worker'),json={**body,'expected_version':1}).status_code==403
    assert api.put('/operations/shop/inventory/newbad',headers=auth('shop'),json={**body,'condition':'new','sku':'NEWBAD'}).status_code==422

@pytest.mark.parametrize('date,expected',[('2028-01-31','2028-02-29'),('2027-01-31','2027-02-28'),('2026-12-31','2027-01-31')])
def test_calendar_month(date,expected):
    zone=ZoneInfo('Asia/Kolkata');start=datetime.fromisoformat(date).replace(tzinfo=zone)
    assert datetime.fromtimestamp(shop_prime.month_after(start.timestamp()),zone).date().isoformat()==expected
