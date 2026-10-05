"""V3 payment gate tested with provider stubs; never makes live charges."""
import time
import main,integrations
from test_operations import api,auth,ADMIN,command,PIN
from test_procurement import setup_shop,start,visit,get,accept_shop,SHOP_PIN

def setup(api):
 setup_shop(api);j=start(api,visit(api))
 def upgrade(u):
  row=u.get('jobs',j['id']);row['procurement_version']=3;u.put('jobs',j['id'],row)
 main.operations_store.run(upgrade)
 j=command(api,get(api,j),'propose_parts',payload={'items':[{'product_id':'cap35','quantity':2}]})
 return command(api,j,'approve_parts','customer',{'proposal_id':j['proposal']['id']})
def pay(api,j,monkeypatch,capture=True):
 for name in ('RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET'):monkeypatch.setenv(name,'test')
 monkeypatch.setenv('REPAIDO_PAYMENTS_ENABLED','true')
 p=dict(id='pay_parts',order_id='order_parts',amount=j['proposal']['amount_paise'],currency='INR',status='captured' if capture else 'authorized',captured=capture)
 calls=[]
 def provider(path,body=None,**kw):
  calls.append(path);return {'id':'order_parts'} if path=='orders' else p
 monkeypatch.setattr(integrations,'razorpay',provider)
 url=f"/operations/jobs/{j['id']}/parts/{j['proposal']['id']}"
 for _ in range(2):assert api.post(url+'/payment-order',headers=auth('customer')).status_code==200
 assert calls.count('orders')==1
 assert api.post(url+'/payment-check',headers=auth('worker'),json={'payment_id':'pay_parts'}).status_code==404
 for _ in range(2):assert api.post(url+'/payment-check',headers=auth('customer'),json={'payment_id':'pay_parts'}).status_code==200
 return p,url

def test_paid_parts_to_pickup_return_completion_and_net_invoice(api,monkeypatch):
 j=setup(api);base=j['total_paise'];assert j['proposal']['status']=='awaiting_payment'
 assert not main.operations_store.run(lambda u:u.all('parts_orders'))
 p,url=pay(api,j,monkeypatch)
 j=get(api,j);assert j['parts_paid_paise']==10000 and j['total_paise']==base+10000
 assert len(main.operations_store.run(lambda u:u.all('parts_orders')))==1
 j,oid=accept_shop(api,j);j=command(api,j,'collect_parts',payload={'return_policy':'pickup-return-v1'})
 j=command(api,j,'position',payload={**SHOP_PIN,'accuracy':5,'captured_at':time.time()})
 code=api.get(f'/operations/shop/purchase-orders/{oid}/otp',headers=auth('shop')).json()['code']
 assert api.post(f"/operations/jobs/{j['id']}/purchase-orders/{oid}/verify-pickup",headers=auth('worker'),json={'code':code}).status_code==200
 j=command(api,get(api,j),'position',payload={**PIN,'accuracy':5,'captured_at':time.time()});j=command(api,j,'return_to_site');j=command(api,j,'install_parts')
 j=command(api,j,'submit_completion',payload={'notes':'Replaced capacitor and tested'});j=command(api,j,'accept_completion','customer')
 monkeypatch.setattr(integrations,'razorpay',lambda *a,**kw:{'id':'order_final'})
 r=api.post(f"/operations/jobs/{j['id']}/payment-order",headers=auth('customer'));assert r.status_code==200,r.text
 assert r.json()['amount']==base
 main.operations_store.run(lambda u:integrations.apply_payment(u,dict(id='pay_final',order_id='order_final',amount=base,currency='INR',status='captured',captured=True)))
 assert get(api,j)['payment_status']=='verified'

def test_missing_pending_and_late_capture_no_order(api,monkeypatch):
 j=setup(api);monkeypatch.setenv('REPAIDO_PAYMENTS_ENABLED','false')
 url=f"/operations/jobs/{j['id']}/parts/{j['proposal']['id']}"
 assert api.post(url+'/payment-order',headers=auth('customer')).status_code==503
 p,_=pay(api,j,monkeypatch,False)
 assert not main.operations_store.run(lambda u:u.all('parts_orders'))
 command(api,get(api,j),'reject_parts','customer',{'proposal_id':j['proposal']['id']})
 main.operations_store.run(lambda u:integrations.apply_payment(u,{**p,'status':'captured','captured':True}))
 assert not main.operations_store.run(lambda u:u.all('parts_orders'))
 assert get(api,j)['parts_refund_hold']
 main.operations_store.run(lambda u:integrations.apply_payment(u,{**p,'status':'refunded','captured':True,'amount_refunded':10000}))
 assert not get(api,j)['parts_refund_hold']

def test_shop_rejection_requests_refund_and_releases_stock(api,monkeypatch):
 j=setup(api);p,_=pay(api,j,monkeypatch);oid=j['proposal']['id']
 assert api.post(f'/operations/shop/purchase-orders/{oid}/decision',headers=auth('shop'),json={'expected_version':1,'decision':'reject','reason':'Physical stock unavailable'}).status_code==200
 row=get(api,j);assert row['total_paise']==j['total_paise'] and row['parts_paid_paise']==0 and row['parts_refund_hold']
 assert main.operations_store.run(lambda u:u.get('inventory','cap35'))['stock']==4

def test_stale_stock_capture_held_no_partial_reservation(api,monkeypatch):
 j=setup(api)
 def unavailable(u):
  row=u.get('inventory','cap35');row['stock']=0;u.put('inventory','cap35',row)
 main.operations_store.run(unavailable);pay(api,j,monkeypatch)
 assert get(api,j)['parts_refund_hold']
 assert not main.operations_store.run(lambda u:u.all('parts_orders'))

def test_uncertain_order_creation_retries_never_create_another_charge(api,monkeypatch):
 j=setup(api)
 for name in ('RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET'):monkeypatch.setenv(name,'test')
 monkeypatch.setenv('REPAIDO_PAYMENTS_ENABLED','true');calls=[]
 def timeout(*a,**kw):calls.append(a);integrations.fail('UNKNOWN','Provider outcome unknown',503)
 monkeypatch.setattr(integrations,'razorpay',timeout)
 url=f"/operations/jobs/{j['id']}/parts/{j['proposal']['id']}/payment-order"
 assert api.post(url,headers=auth('customer')).status_code==503
 assert api.post(url,headers=auth('customer')).status_code==409
 assert len(calls)==1

def test_parts_refund_endpoint_and_full_refund_recovery(api,monkeypatch):
 import refunds
 j=setup(api);p,_=pay(api,j,monkeypatch);oid=j['proposal']['id']
 api.post(f'/operations/shop/purchase-orders/{oid}/decision',headers=auth('shop'),json={'expected_version':1,'decision':'reject','reason':'Stock unavailable'})
 calls=[];result={}
 def provider(path,body=None,**kw):
  calls.append(path)
  if path.endswith('/refund'):
   result.update(id='rf_test',payment_id=p['id'],amount=body['amount'],receipt=body['receipt'],status='processed');return result
  if path=='refunds/rf_test':return result
  return {**p,'amount_refunded':p['amount'],'status':'refunded'}
 monkeypatch.setattr(refunds,'razorpay',provider)
 body=dict(payment_record_id=oid,request_id='parts-refund-retry-unique',amount_paise=10000,reason='Approved full refund for rejected shop order')
 for _ in range(2):
  r=api.post(f"/operations/admin/jobs/{j['id']}/refund",headers=ADMIN,json=body);assert r.status_code==200,r.text
 assert calls.count('payments/pay_parts/refund')==1
 assert not get(api,j)['parts_refund_hold']


def test_advance_is_balanced_and_not_booked_as_revenue(api,monkeypatch):
 j=setup(api);pay(api,j,monkeypatch)
 journals=main.operations_store.run(lambda u:u.all('journals'))
 assert len(journals)==1
 lines=journals[0]['lines'];assert sum(x['debit']-x['credit'] for x in lines)==0
 assert lines==[{'account':'payment_clearing','debit':10000,'credit':0},{'account':'customer_parts_advances','debit':0,'credit':10000}]
