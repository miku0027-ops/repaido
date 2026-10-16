"""Cross-surface price contracts through native managed-job parts payments.

The only synthetic inputs are an historical migration quote and local provider
responses. No gateway or cloud calls occur.
"""
import time

import main
import integrations
from test_operations import api, auth, command
from test_procurement import setup_shop, start, visit, get
from test_parts_advances import pay


def dated_shop(api):
    setup_shop(api)
    def date_registration(u):
        shop=u.get('shops','shop1')
        shop['created_at']=time.time()-86400
        u.put('shops','shop1',shop)
    main.operations_store.run(date_registration)


def proposed_parts(api):
    j=start(api,visit(api))
    def upgrade(u):
        saved=u.get('jobs',j['id']);saved['procurement_version']=3;u.put('jobs',saved['id'],saved)
    main.operations_store.run(upgrade)
    return command(api,get(api,j),'propose_parts',payload={'items':[{'product_id':'cap35','quantity':2}]})


def approve(api,j):
    return command(api,j,'approve_parts','customer',{'proposal_id':j['proposal']['id']})


def journal_for(j):
    return main.operations_store.run(lambda u:u.get('journals','parts-advance-'+j['proposal']['id']))


def assert_advance(j,amount):
    journal=journal_for(j)
    assert journal['status']=='posted'
    assert journal['lines']==[
        {'account':'payment_clearing','debit':amount,'credit':0},
        {'account':'customer_parts_advances','debit':0,'credit':amount},
    ]
    assert sum(line['debit']-line['credit'] for line in journal['lines'])==0


def test_dated_trial_catalog_to_managed_parts_capture_reserves_exact_discounted_value(api,monkeypatch):
    dated_shop(api)
    catalog=api.get('/operations/products/catalog').json()['items']
    product=next(p for p in catalog if p['id']=='cap35')
    assert product['base_price_paise']==5000 and product['price_paise']==4750
    assert product['discount_paise']==250 and product['offer_source']=='trial_default'
    inventory=api.get('/operations/inventory',headers=auth('worker')).json()['items']
    assert next(p for p in inventory if p['id']=='cap35')['price_paise']==4750
    j=proposed_parts(api);base=j['total_paise'];line=j['proposal']['items'][0]
    assert line['price_policy']=='shop-offers-v1' and line['unit_price_paise']==4750
    assert line['base_unit_price_paise']==5000 and j['proposal']['amount_paise']==9500
    j=approve(api,j)
    for name in ('RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET'):monkeypatch.setenv(name,'local-fixture')
    monkeypatch.setenv('REPAIDO_PAYMENTS_ENABLED','true')
    payment=dict(id='pay_discountedparts',order_id='order_discountedparts',amount=9500,currency='INR',status='captured',captured=True)
    requests=[]
    def provider(path,body=None,**kwargs):
        requests.append((path,body))
        if path=='orders':return {'id':'order_discountedparts'}
        if path=='payments/pay_discountedparts':return payment
        raise AssertionError(path)
    monkeypatch.setattr(integrations,'razorpay',provider)
    url=f"/operations/jobs/{j['id']}/parts/{j['proposal']['id']}"
    for _ in range(2):
        order=api.post(url+'/payment-order',headers=auth('customer'))
        assert order.status_code==200,order.text
        assert order.json()['amount']==9500 and order.json()['currency']=='INR'
    sent=[body for path,body in requests if path=='orders']
    assert len(sent)==1 and sent[0]['amount']==9500 and sent[0]['currency']=='INR'
    for _ in range(2):
        response=api.post(url+'/payment-check',headers=auth('customer'),json={'payment_id':payment['id']})
        assert response.status_code==200,response.text
    saved=get(api,j);assert saved['total_paise']==base+9500 and saved['parts_paid_paise']==9500
    assert saved['proposal']['status']=='approved' and not saved['parts_refund_hold']
    purchase=main.operations_store.run(lambda u:u.get('parts_orders',j['proposal']['id']))
    assert purchase['amount_paise']==9500 and purchase['items'][0]['unit_price_paise']==4750
    stock=main.operations_store.run(lambda u:u.get('inventory','cap35'))
    assert stock['price_paise']==5000 and stock['stock']==2 and stock['reserved']==2
    assert_advance(j,9500)
    assert len(main.operations_store.run(lambda u:u.all('journals')))==1


def test_offer_change_before_capture_holds_money_without_stock_or_parts_order(api,monkeypatch):
    dated_shop(api);j=approve(api,proposed_parts(api));base=j['total_paise']
    assert j['proposal']['amount_paise']==9500
    changed=api.put('/operations/shop/products/cap35/offer',headers=auth('shop'),json={'expected_version':1,'discount_bps':2000,'active':True})
    assert changed.status_code==200,changed.text
    assert changed.json()['product']['price_paise']==4000
    p,_=pay(api,j,monkeypatch)
    assert p['amount']==9500
    saved=get(api,j);assert saved['parts_refund_hold'] and saved['total_paise']==base and saved['parts_paid_paise']==0
    assert not main.operations_store.run(lambda u:u.all('parts_orders'))
    stock=main.operations_store.run(lambda u:u.get('inventory','cap35'))
    assert stock['stock']==4 and stock['reserved']==0
    attempt=main.operations_store.run(lambda u:u.get('payments',j['proposal']['id']))
    assert attempt['status']=='captured' and not attempt['allocated'] and attempt['recovery']=='refund_review'
    assert_advance(j,9500)


def test_pre_policy_approved_quote_retains_its_original_base_price_during_new_trial(api,monkeypatch):
    dated_shop(api);j=proposed_parts(api)
    def historical_quote(u):
        saved=u.get('jobs',j['id']);quote=saved['proposal'];line=quote['items'][0]
        for key in ('price_policy','base_unit_price_paise','offer_source'):line.pop(key,None)
        line['unit_price_paise']=5000;quote['amount_paise']=10000
        u.put('jobs',saved['id'],saved)
    main.operations_store.run(historical_quote)
    j=approve(api,get(api,j));base=j['total_paise']
    # Current public catalogue can advertise the newly introduced offer while
    # an already agreed pre-policy command keeps its historical snapshot.
    catalog=api.get('/operations/products/catalog').json()['items']
    assert next(p for p in catalog if p['id']=='cap35')['price_paise']==4750
    p,_=pay(api,j,monkeypatch);assert p['amount']==10000
    saved=get(api,j);assert saved['total_paise']==base+10000 and saved['parts_paid_paise']==10000
    assert not saved['parts_refund_hold']
    order=main.operations_store.run(lambda u:u.get('parts_orders',j['proposal']['id']))
    assert order['amount_paise']==10000 and order['items'][0]['unit_price_paise']==5000
    assert 'price_policy' not in order['items'][0]
    assert_advance(j,10000)


def test_mismatched_persisted_parts_attempt_holds_capture_without_funding_proposal(api):
    dated_shop(api);j=approve(api,proposed_parts(api));base=j['total_paise']
    assert j['proposal']['amount_paise']==9500
    # Simulate reconciliation of a historical/corrupt payment attempt whose
    # own provider amount matches, but differs from the customer's agreed quote.
    attempt=dict(id=j['proposal']['id'],kind='parts',job_id=j['id'],customer_id='customer',
                 order_id='order_badamount',amount_paise=10000,status='created',created_at=time.time())
    main.operations_store.run(lambda u:u.put('payments',attempt['id'],attempt))
    payment=dict(id='pay_badamount',order_id='order_badamount',amount=10000,currency='INR',status='captured',captured=True)
    main.operations_store.run(lambda u:integrations.apply_payment(u,payment))
    saved=get(api,j)
    assert saved['total_paise']==base and saved['parts_paid_paise']==0 and saved['parts_refund_hold']
    assert not main.operations_store.run(lambda u:u.all('parts_orders'))
    stock=main.operations_store.run(lambda u:u.get('inventory','cap35'))
    assert stock['stock']==4 and stock['reserved']==0
    reconciled=main.operations_store.run(lambda u:u.get('payments',attempt['id']))
    assert reconciled['status']=='captured' and not reconciled['allocated'] and reconciled['recovery']=='refund_review'
    assert_advance(j,10000)
