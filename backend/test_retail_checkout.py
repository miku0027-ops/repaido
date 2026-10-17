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
 def send(path,body=None,payout=False,key=None):
  calls.append((path,dict(body=body,payout=payout,key=key)))
  if path=='orders':order.update(receipt=body['receipt'],notes=body['notes']);return order
  if path.startswith('orders?'):
   saved=main.operations_store.run(lambda u:next(row for row in u.all('retail_orders') if row['receipt']==path.split('=',1)[1]))
   return {'items':[{**order,'receipt':saved['receipt'],'notes':{'retail_order':saved['id']}}]}
  if path.endswith('/payments'):return {'items':[payment]}
  if path.startswith('payments/'):return payment
  raise AssertionError(path)
 monkeypatch.setattr(retail_checkout,'razorpay',send);monkeypatch.setattr(retail_checkout,'payments_ready',lambda:True)
 return calls,payment

def test_create_uses_real_gateway_signature_and_exact_saved_order(api,monkeypatch):
 seed();calls,_=gateway(monkeypatch)
 response=api.post('/operations/retail/orders',headers=auth('customer'),json=body())
 assert response.status_code==201,response.text
 saved=response.json()
 assert saved['state']=='payment_pending' and saved['order_id']=='order_fixture'
 creates=[details for path,details in calls if path=='orders']
 assert creates==[dict(body=dict(amount=saved['total_paise'],currency='INR',receipt=saved['receipt'],notes={'retail_order':saved['id']}),payout=False,key=None)]
 assert saved['total_paise']==22600

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
 def uncertain(path,body=None,payout=False,key=None):
  if path=='orders':raise TimeoutError('unknown')
  return real(path,body=body,payout=payout,key=key)
 monkeypatch.setattr(retail_checkout,'razorpay',uncertain);b=body()
 assert api.post('/operations/retail/orders',headers=auth('customer'),json=b).status_code==503
 r=api.post('/operations/retail/orders',headers=auth('customer'),json=b);assert r.status_code==201,r.text
 assert len([c for c in calls if c[0]=='orders'])==0
 assert api.post('/operations/retail/orders/'+r.json()['id']+'/payment',headers=auth('customer')).json()['state']=='paid'
 assert main.operations_store.run(lambda u:u.get('inventory','ref'))['stock']==4


def test_stale_capture_after_processed_refund_never_recreates_shop_liability(api,monkeypatch):
 from test_retail_resolution import order,open_case,decide,gateway as refund_gateway,BASE
 from test_operations import ADMIN
 purchase=order(funded=True)
 case,_=open_case(api,purchase,kind='refund');case,_=decide(api,case)
 refund_gateway(monkeypatch,purchase)
 assert api.post(BASE+'/admin/resolutions/'+case['id']+'/refund',headers=ADMIN,json={}).status_code==200
 before=main.operations_store.run(lambda u:(u.get('retail_orders',purchase['id']),u.all('shop_payables'),u.all('journals')))
 # A verification started before the refund may finish with an older provider snapshot.
 monkeypatch.setattr(retail_checkout,'razorpay',lambda path:dict(id=purchase['payment_id'],order_id=purchase['order_id'],amount=8000,currency='INR',status='captured',captured=True,amount_refunded=0))
 response=api.post(BASE+'/orders/'+purchase['id']+'/verify',headers=auth('customer'),json={'payment_id':purchase['payment_id']})
 assert response.status_code==409,response.text
 assert main.operations_store.run(lambda u:(u.get('retail_orders',purchase['id']),u.all('shop_payables'),u.all('journals')))==before


def test_provider_payment_identity_must_match_requested_payment(api,monkeypatch):
 seed();_,payment=gateway(monkeypatch)
 purchase=api.post('/operations/retail/orders',headers=auth('customer'),json=body()).json()
 payment['id']='pay_another'
 response=api.post('/operations/retail/orders/'+purchase['id']+'/verify',headers=auth('customer'),json={'payment_id':'pay_fixture'})
 assert response.status_code==409,response.text
 assert not main.operations_store.run(lambda u:u.all('shop_payables'))


@pytest.mark.parametrize('resume',[False,True])
def test_recovered_order_must_match_saved_receipt(api,monkeypatch,resume):
 seed();gateway(monkeypatch);request=body()
 def unknown(path,body=None):raise TimeoutError('unknown order outcome')
 monkeypatch.setattr(retail_checkout,'razorpay',unknown)
 assert api.post('/operations/retail/orders',headers=auth('customer'),json=request).status_code==503
 saved=main.operations_store.run(lambda u:u.all('retail_orders'))[0]
 monkeypatch.setattr(retail_checkout,'razorpay',lambda path:{'items':[dict(id='order_unrelated',amount=saved['total_paise'],currency='INR',receipt='rt_unrelated',notes={'retail_order':'unrelated'})]})
 path='/operations/retail/orders/'+saved['id']+'/payment' if resume else '/operations/retail/orders'
 response=api.post(path,headers=auth('customer'),json={} if resume else request)
 assert response.status_code==409,response.text
 assert not main.operations_store.run(lambda u:u.get('retail_orders',saved['id'])).get('order_id')


@pytest.mark.parametrize('resume',[False,True])
def test_late_order_attachment_preserves_concurrent_capture(api,monkeypatch,resume):
 seed();gateway(monkeypatch);request=body()
 monkeypatch.setattr(retail_checkout,'razorpay',lambda *a,**kw:(_ for _ in ()).throw(TimeoutError('unknown')))
 assert api.post('/operations/retail/orders',headers=auth('customer'),json=request).status_code==503
 saved=main.operations_store.run(lambda u:u.all('retail_orders'))[0]
 captured=dict(id='pay_fixture',order_id='order_fixture',amount=saved['total_paise'],currency='INR',status='captured',captured=True,amount_refunded=0);paid_at=[]
 def provider(path,body=None):
  if path.startswith('orders?'):
   main.operations_store.run(lambda u:u.put('retail_orders',saved['id'],{**u.get('retail_orders',saved['id']),'order_id':'order_fixture','state':'payment_pending'}))
   verified=api.post('/operations/retail/orders/'+saved['id']+'/verify',headers=auth('customer'),json={'payment_id':'pay_fixture'})
   assert verified.status_code==200
   paid_at.append(verified.json()['paid_at'])
   return {'items':[dict(id='order_fixture',amount=saved['total_paise'],currency='INR',receipt=saved['receipt'],notes={'retail_order':saved['id']})]}
  if path=='payments/pay_fixture':return captured
  if path.endswith('/payments'):return {'items':[captured]}
  raise AssertionError(path)
 monkeypatch.setattr(retail_checkout,'razorpay',provider)
 path='/operations/retail/orders/'+saved['id']+'/payment' if resume else '/operations/retail/orders'
 response=api.post(path,headers=auth('customer'),json={} if resume else request)
 assert response.status_code in (200,201),response.text
 assert main.operations_store.run(lambda u:u.get('retail_orders',saved['id']))['state']=='paid'
 assert main.operations_store.run(lambda u:u.get('retail_orders',saved['id']))['paid_at']==paid_at[0]
 assert len(main.operations_store.run(lambda u:u.all('shop_payables')))==2


def test_coupon_rounding_cannot_make_a_line_negative(api,monkeypatch):
 seed();monkeypatch.setattr(retail_checkout,'payments_ready',lambda:True)
 def stock(u):
  for number in range(20):
   product={**u.get('inventory','ref'),'id':'tiny-'+str(number),'price_paise':10001 if number<19 else 1,'gst_bps':0}
   u.put('inventory',product['id'],product)
 main.operations_store.run(stock)
 request={**body(),'items':[{'product_id':'tiny-'+str(number),'quantity':1} for number in range(20)],'expected_total_paise':171018}
 def provider(path,body=None):
  if path=='orders':return {**body,'id':'order_rounding'}
  return dict(id='pay_rounding',order_id='order_rounding',amount=171018,currency='INR',status='captured',captured=True,amount_refunded=0)
 monkeypatch.setattr(retail_checkout,'razorpay',provider)
 response=api.post('/operations/retail/orders',headers=auth('customer'),json=request)
 assert response.status_code==201,response.text
 purchase=response.json()
 assert sum(item['discount_paise'] for item in purchase['items'])==19002
 assert all(0<=item['discount_paise']<=item['base_paise'] for item in purchase['items'])
 assert api.post('/operations/retail/orders/'+purchase['id']+'/verify',headers=auth('customer'),json={'payment_id':'pay_rounding'}).status_code==200
 allocations=main.operations_store.run(lambda u:u.all('shop_payables'))
 assert all(item['amount_paise']>=0 for item in allocations)
 assert sum(item['amount_paise'] for item in allocations)==171018


def test_capture_rejects_global_receipt_already_used_by_another_purchase(api,monkeypatch):
 seed();gateway(monkeypatch)
 purchase=api.post('/operations/retail/orders',headers=auth('customer'),json=body()).json()
 main.operations_store.run(lambda u:u.put('receipts','pay_fixture',dict(id='pay_fixture',kind='shop_access',shop_access_attempt_id='another')))
 response=api.post('/operations/retail/orders/'+purchase['id']+'/verify',headers=auth('customer'),json={'payment_id':'pay_fixture'})
 assert response.status_code==409,response.text
 assert not main.operations_store.run(lambda u:u.all('shop_payables'))


def test_concurrent_checkout_and_capture_use_one_reservation_and_one_journal(api,monkeypatch):
 from concurrent.futures import ThreadPoolExecutor
 seed();calls,_=gateway(monkeypatch);request=body()
 def create(_):return api.post('/operations/retail/orders',headers=auth('customer'),json=request)
 with ThreadPoolExecutor(max_workers=4) as pool:responses=list(pool.map(create,range(4)))
 assert all(response.status_code==201 for response in responses)
 ids={response.json()['id'] for response in responses};assert len(ids)==1
 assert sum(path=='orders' for path,_ in calls)==1
 purchase_id=ids.pop()
 def verify(_):return api.post('/operations/retail/orders/'+purchase_id+'/verify',headers=auth('customer'),json={'payment_id':'pay_fixture'})
 with ThreadPoolExecutor(max_workers=4) as pool:responses=list(pool.map(verify,range(4)))
 assert all(response.status_code==200 for response in responses)
 assert len(main.operations_store.run(lambda u:u.all('shop_payables')))==2
 assert len(main.operations_store.run(lambda u:u.all('receipts')))==1
 journals=main.operations_store.run(lambda u:u.all('journals'))
 assert len(journals)==1 and sum(line['debit']-line['credit'] for line in journals[0]['lines'])==0
 assert main.operations_store.run(lambda u:u.get('inventory','ref'))['stock']==4
