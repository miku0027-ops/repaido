"""Authoritative new-spare owner-funded pricing; no client-computed discounts."""
import time
import pytest
import main,shop_pricing,retail_checkout
from test_operations import api,auth
from test_shop_access import seed


def product(*,condition='new',base=11800,offer=None):
    p=dict(id='priced-item',shop_id='access-shop',name='Fixture spare',sku='TEST',category='AC parts',compatibility='fixture',condition=condition,price_paise=base,status='approved',stock=8,reserved=0,stock_confirmed_at=time.time(),gst_bps=1800,version=1)
    if offer is not None:p['shop_offer']=offer
    main.operations_store.run(lambda u:u.put('inventory',p['id'],p));return p


def read(p):return main.operations_store.run(lambda u:shop_pricing.price(u,p))


def test_real_registration_default5_is_integer_and_not_applied_to_refurbished(api):
    seed();p=product(base=10101);q=read(p)
    assert q['base_price_paise']==10101 and q['discount_paise']==505 and q['price_paise']==9596
    assert q['offer_source']=='trial_default' and q['valid_until']
    ref=product(condition='refurbished');assert read(ref)['discount_paise']==0


def test_owner_offer_replaces_default_and_respects_floor(api):
    seed();p=product(offer=dict(active=True,discount_bps=1000,min_price_paise=11000));q=read(p)
    assert q['price_paise']==11000 and q['discount_paise']==800 and q['offer_source']=='shop'
    p['shop_offer']['active']=False;assert read(p)['price_paise']==11210
    p['shop_offer'].update(active=True,discount_bps=0);assert read(p)['price_paise']==11210


def test_legacy_undated_never_receives_automatic_merchant_discount(api):
    s=dict(id='access-shop',owner_id='shop',status='approved',name='Legacy')
    main.operations_store.run(lambda u:u.put('shops',s['id'],s));assert read(product())['discount_paise']==0


def test_expired_default_can_be_disabled_and_catalog_snapshot_has_no_private_fields(api):
    seed(days=91);p=product()
    assert read(p)['price_paise']==11210
    api.put('/operations/shop/access/settings',headers=auth('shop'),json={'expected_version':0,'default_offer_enabled':False})
    assert read(p)['price_paise']==11800
    p.update(owner_id='private',phone='private',supplier_cost=1000)
    safe=main.operations_store.run(lambda u:shop_pricing.effective_product(u,p))
    assert not {'owner_id','phone','supplier_cost','shop_offer'} & safe.keys()


def test_offer_edit_ownership_version_and_cap(api):
    seed();p=product();url='/operations/shop/products/'+p['id']+'/offer'
    body=dict(expected_version=1,discount_bps=1000,active=True,min_price_paise=10000)
    assert api.put(url,headers=auth('worker'),json=body).status_code==404
    assert api.put(url,headers=auth('shop'),json={**body,'discount_bps':2501}).status_code==422
    a=api.put(url,headers=auth('shop'),json=body);assert a.status_code==200,a.text
    assert a.json()['product']['price_paise']==10620 and a.json()['version']==2
    assert api.put(url,headers=auth('shop'),json=body).status_code==409


def test_stock_edit_retains_offer_and_quote_matches_projection(api):
    seed();p=product(offer=dict(active=True,discount_bps=1000,min_price_paise=0))
    body=dict(expected_version=1,name=p['name'],sku=p['sku'],category=p['category'],compatibility=p['compatibility'],price_paise=11800,on_hand=8,gst_bps=1800)
    a=api.put('/operations/shop/inventory/'+p['id'],headers=auth('shop'),json=body)
    assert a.status_code==200,a.text
    assert a.json()['shop_offer']['discount_bps']==1000
    quote=api.post('/operations/retail/quote',headers=auth('customer'),json={'items':[{'product_id':p['id'],'quantity':2}]}).json()
    assert quote['subtotal_paise']==21240 and quote['total_paise']==21240
    assert quote['base_subtotal_paise']==23600 and quote['shop_discount_paise']==2360 and quote['discount_paise']==0
    assert quote['items'][0]['unit_price_paise']==10620 and quote['items'][0]['base_paise']==18000


def test_owner_funded5_is_not_repaido_coupon_subsidy_and_paid_snapshot_is_immutable(api,monkeypatch):
    seed();p=product();gateway_orders={}
    monkeypatch.setattr(retail_checkout,'payments_ready',lambda:True)
    def gateway(path,body=None):
        if path=='orders':
            gateway_orders['order_fixture']={**body,'id':'order_fixture'};return gateway_orders['order_fixture']
        if path=='payments/pay_fixture':return dict(id='pay_fixture',order_id='order_fixture',amount=11210,currency='INR',status='captured',captured=True,amount_refunded=0)
        raise AssertionError(path)
    monkeypatch.setattr(retail_checkout,'razorpay',gateway)
    body=dict(items=[{'product_id':p['id'],'quantity':1}],expected_total_paise=11210,recipient_name='Fixture Customer',recipient_phone='9876543210',delivery_address='Fixture test street, Balasore',request_id='native-shop-pricing-order-01')
    r=api.post('/operations/retail/orders',headers=auth('customer'),json=body);assert r.status_code==201,r.text
    order=r.json();oid=order['id']
    paid=api.post('/operations/retail/orders/'+oid+'/verify',headers=auth('customer'),json={'payment_id':'pay_fixture'});assert paid.status_code==200,paid.text
    assert paid.json()['total_paise']==11210 and paid.json()['shop_discount_paise']==590
    payable=main.operations_store.run(lambda u:u.get('shop_payables',oid+':'+p['id']));assert payable['amount_paise']==11210
    ledger=main.operations_store.run(lambda u:u.get('journals','retail:'+oid))
    assert not any(e['account']=='community_reward_expense' for e in ledger['lines'])
    api.put('/operations/shop/products/'+p['id']+'/offer',headers=auth('shop'),json={'expected_version':2,'discount_bps':2000,'active':True})
    assert main.operations_store.run(lambda u:u.get('retail_orders',oid))['total_paise']==11210
