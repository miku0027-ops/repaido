import time,uuid
import pytest
import main,retail_checkout
from test_operations import api,auth

def seed(paid=True,gst=1800):
 def save(u):
  u.put('shops','s',dict(id='s',name='Fixture shop',owner_id='shop',status='approved'))
  for ident,condition in [('ref','refurbished'),('new','new')]:u.put('inventory',ident,dict(id=ident,shop_id='s',name=ident,condition=condition,status='approved',stock_confirmed_at=time.time(),stock=5,reserved=0,price_paise=11800,gst_bps=gst,version=1))
  if paid:u.put('jobs','completed',dict(id='completed',customer_id='customer',state='completed',payment_status='verified'))
 main.operations_store.run(save)
def body(**kw):return dict(items=[dict(product_id='ref',quantity=1),dict(product_id='new',quantity=1)],coupon_code='RENEW10',expected_total_paise=22600,recipient_name='Fixture Buyer',recipient_phone='9876543210',delivery_address='Fixture address, no delivery',request_id=str(uuid.uuid4()),**kw)
def gateway(monkeypatch):
 calls=[]
 order=dict(id='order_fixture',amount=22600,currency='INR')
 payment=dict(id='pay_fixture',order_id='order_fixture',amount=22600,currency='INR',status='captured',captured=True,amount_refunded=0)
 def send(path,**kw):
  calls.append((path,kw))
  if path=='orders':return order
  if path.startswith('orders?'):return {'items':[order]}
  if path.endswith('/payments'):return {'items':[payment]}
  if path.startswith('payments/'):return payment
  raise AssertionError(path)
 monkeypatch.setattr(retail_checkout,'razorpay',send);monkeypatch.setattr(retail_checkout,'payments_ready',lambda:True)
 return calls,payment

def test_mixed_quote_excludes_tax_and_new_items(api):
 seed();b=body();r=api.post('/operations/retail/quote',headers=auth('customer'),json={k:b[k] for k in ['items','coupon_code']});assert r.status_code==200,r.text
 assert r.json()['eligible_base_paise']==10000 and r.json()['discount_paise']==1000 and r.json()['total_paise']==22600
 assert api.post('/operations/retail/quote',json={'items':b['items']}).status_code==401
 assert api.post('/operations/retail/quote',headers=auth('stranger'),json={'items':b['items'],'coupon_code':'RENEW10'}).status_code==409

def test_unknown_tax_and_stale_stock_fail_before_reserving(api):
 seed(gst=None);b=body();q={k:b[k] for k in ['items','coupon_code']}
 assert api.post('/operations/retail/quote',headers=auth('customer'),json=q).status_code==422
 q['coupon_code']=None;assert api.post('/operations/retail/quote',headers=auth('customer'),json=q).json()['total_paise']==23600
 main.operations_store.run(lambda u:u.put('inventory','ref',{**u.get('inventory','ref'),'stock_confirmed_at':0}))
 assert api.post('/operations/retail/quote',headers=auth('customer'),json=q).status_code==409

def test_unavailable_payment_does_not_lock_inventory_or_coupon(api,monkeypatch):
 seed();monkeypatch.setattr(retail_checkout,'payments_ready',lambda:False)
 assert api.post('/operations/retail/orders',headers=auth('customer'),json=body()).status_code==503
 assert main.operations_store.run(lambda u:u.get('inventory','ref'))['stock']==5
 assert main.operations_store.run(lambda u:u.all('retail_orders'))==[]

def test_payment_retry_stock_and_receipt_are_atomic(api,monkeypatch):
 seed();calls,payment=gateway(monkeypatch);b=body()
 r=api.post('/operations/retail/orders',headers=auth('customer'),json=b);assert r.status_code==201,r.text;o=r.json()
 assert api.post('/operations/retail/orders',headers=auth('customer'),json=b).json()['id']==o['id']
 assert len([c for c in calls if c[0]=='orders'])==1
 assert main.operations_store.run(lambda u:u.get('inventory','ref'))['stock']==4
 changed={**b,'expected_total_paise':23000};assert api.post('/operations/retail/orders',headers=auth('customer'),json=changed).status_code==409
 path='/operations/retail/orders/'+o['id']
 assert api.post(path+'/verify',headers=auth('stranger'),json={'payment_id':'pay_fixture'}).status_code==404
 payment['amount']=1;assert api.post(path+'/verify',headers=auth('customer'),json={'payment_id':'pay_fixture'}).status_code==409
 payment['amount']=22600
 for _ in range(2):assert api.post(path+'/verify',headers=auth('customer'),json={'payment_id':'pay_fixture'}).status_code==200
 rows=main.operations_store.run(lambda u:u.all('shop_payables'));assert len(rows)==2 and sum(p['amount_paise'] for p in rows)==22600
 assert {p['status'] for p in rows}=={'awaiting_fulfillment'}
 assert main.operations_store.run(lambda u:u.get('inventory','ref'))['reserved']==1
 assert api.get('/operations/retail/shop-orders',headers=auth('stranger')).json()['orders']==[]
 assert len(api.get('/operations/retail/shop-orders',headers=auth('shop')).json()['orders'])==1
 assert api.post(path+'/received',headers=auth('stranger')).status_code==404
 for _ in range(2):assert api.post(path+'/received',headers=auth('customer')).status_code==200
 assert {p['status'] for p in main.operations_store.run(lambda u:u.all('shop_payables'))}=={'retail_receipt_review'}
 assert main.operations_store.run(lambda u:u.get('inventory','ref'))['reserved']==0

def test_unknown_gateway_outcome_reconciles_without_second_create(api,monkeypatch):
 seed();calls,payment=gateway(monkeypatch);real=retail_checkout.razorpay
 def uncertain(path,**kw):
  if path=='orders':raise TimeoutError('unknown')
  return real(path,**kw)
 monkeypatch.setattr(retail_checkout,'razorpay',uncertain);b=body()
 assert api.post('/operations/retail/orders',headers=auth('customer'),json=b).status_code==503
 r=api.post('/operations/retail/orders',headers=auth('customer'),json=b);assert r.status_code==201,r.text
 assert len([c for c in calls if c[0]=='orders'])==0
 assert api.post('/operations/retail/orders/'+r.json()['id']+'/payment',headers=auth('customer')).json()['state']=='paid'
 assert main.operations_store.run(lambda u:u.get('inventory','ref'))['stock']==4
