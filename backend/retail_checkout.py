"""Checkout against the live shop catalogue with reserved stock and coupon snapshots.
Unknown gateway outcomes are reconciled by receipt, never blindly resubmitted.
"""
import hashlib,time,uuid
from typing import Literal
from fastapi import APIRouter,Depends
from pydantic import Field
from operations import Input,fail
from integrations import razorpay
from rentals import payments_ready,next_weekly,post
from procurement import live_product
from coupons import reserve,validate
class Line(Input):
    product_id:str=Field(min_length=1,max_length=100)
    quantity:int=Field(ge=1,le=50)
class Basket(Input):
    items:list[Line]=Field(min_length=1,max_length=100)
    coupon_code:str|None=Field(default=None,max_length=30)
class Order(Basket):
    expected_total_paise:int=Field(gt=0)
    recipient_name:str=Field(min_length=2,max_length=80)
    recipient_phone:str=Field(pattern=r'^[6-9][0-9]{9}$')
    delivery_address:str=Field(min_length=10,max_length=500)
    request_id:str=Field(min_length=16,max_length=100)
class Verify(Input):
    payment_id:str=Field(min_length=5,max_length=100)
def mail_order(u,row,action,suppliers=False):
    """Bind confirmations to saved customer/shop owners, without order contents."""
    from transactional_mail import enqueue,enqueue_fanout
    recipients=[row['customer_id']]
    if suppliers:
        shops=sorted({item['shop_id'] for item in row['items']})
        u.prefetch([('shops',key) for key in shops])
        recipients.extend((u.get('shops',key) or {}).get('owner_id') for key in shops)
    recipients=list(dict.fromkeys(uid for uid in recipients if uid))
    # The source keeps one bounded receipt. Private workers expand supplier
    # deliveries separately so inventory indexing cannot exceed the write cap.
    queue=enqueue_fanout if suppliers else enqueue
    queue(u,'retail:'+row['id']+':'+action,'shop_order_'+action,recipients,
          {'record_type':'shop','record_id':row['id'],'path':'/'})
def quote(u,body,uid):
    rows=[];seen=set()
    for line in body.items:
        if line.product_id in seen:fail('DUPLICATE_ITEM','Combine quantities for each product.',422)
        seen.add(line.product_id);p=u.get('inventory',line.product_id)
        if not live_product(u,p,time.time()) or p['stock']<line.quantity:fail('STOCK_CHANGED','Refresh your cart: a price or available stock needs review.',409)
        total=p['price_paise']*line.quantity;gst=p.get('gst_bps');base=total*10000//(10000+gst) if gst is not None else None
        rows.append(dict(product_id=p['id'],shop_id=p['shop_id'],name=p['name'],quantity=line.quantity,unit_price_paise=p['price_paise'],total_paise=total,gst_bps=gst,base_paise=base,condition=p.get('condition','new'),version=p.get('version',1)))
    base=sum(row['base_paise'] or 0 for row in rows if row['condition']=='refurbished')
    discount=0;offer=None
    if body.coupon_code:
        if not base:fail('TAX_BREAKDOWN_REQUIRED','This coupon requires a refurbished item with a shop-declared tax breakdown.',422)
        offer=validate(u,uid,body.coupon_code,'refurbished');discount=base*offer['bps']//10000
    subtotal=sum(x['total_paise'] for x in rows)
    return dict(items=rows,subtotal_paise=subtotal,discount_paise=discount,eligible_base_paise=base,total_paise=subtotal-discount,coupon=offer,fulfillment='Shop confirmation required; delivery charges cannot be added without approval.',tax_note='Listed prices are inclusive. No unconfirmed 18% tax is added at checkout.')
def install(core):
    r=APIRouter(prefix='/operations/retail',tags=['Retail checkout']);store=core.operations_store
    @r.post('/quote')
    def get_quote(body:Basket,user=Depends(core.current_user)):return store.run(lambda u:quote(u,body,user['id']))
    @r.post('/orders',status_code=201)
    def create(body:Order,user=Depends(core.current_user)):
        if not payments_ready():fail('PAYMENTS_UNAVAILABLE','Online payments are not activated. No stock, coupon or money was reserved.',503)
        key=hashlib.sha256((user['id']+body.request_id).encode()).hexdigest();fp=hashlib.sha256(body.model_dump_json().encode()).hexdigest()
        def save(u):
            old=u.get('retail_orders',key)
            if old:
                if old['fingerprint']!=fp:fail('KEY_REUSED','This retry differs from the original order.',409)
                return old,False
            from account_profile import require_email
            require_email(u,user)
            q=quote(u,body,user['id'])
            if q['total_paise']!=body.expected_total_paise:fail('PRICE_CHANGED','Review the refreshed checkout total before paying.',409)
            q['coupon']=reserve(u,user['id'],body.coupon_code,'refurbished',q['eligible_base_paise'],'retail:'+key) if body.coupon_code else None
            remaining=q['discount_paise'];eligible=[x for x in q['items'] if x['condition']=='refurbished' and x['base_paise']]
            for item in q['items']:
                amount=(remaining if item is eligible[-1] else q['discount_paise']*item['base_paise']//q['eligible_base_paise']) if item in eligible else 0
                item['discount_paise']=amount;remaining-=amount;p=u.get('inventory',item['product_id']);p['stock']-=item['quantity'];p['reserved']=p.get('reserved',0)+item['quantity'];p['version']=p.get('version',0)+1;u.put('inventory',p['id'],p)
            row=dict(**q,id=key,customer_id=user['id'],fingerprint=fp,state='creating',receipt='rt-'+key[:32],created_at=time.time(),recipient_name=body.recipient_name,recipient_phone=body.recipient_phone,delivery_address=body.delivery_address)
            u.put('retail_orders',key,row);mail_order(u,row,'saved');return row,True
        row,new=store.run(save)
        if row.get('order_id'):return {**row,'key_id':__import__('os').getenv('RAZORPAY_KEY_ID','')}
        if not new:
            matches=razorpay('orders?receipt='+row['receipt']).get('items',[])
            if len(matches)!=1:fail('ORDER_RECONCILING','Payment outcome is being reconciled. Keep this order; do not create another.',409)
            order=matches[0]
        else:
            try:order=razorpay('orders',{'amount':row['total_paise'],'currency':'INR','receipt':row['receipt'],'notes':{'retail_order':row['id']}})
            except Exception:fail('ORDER_RECONCILING','The provider outcome is unknown. Retry this same checkout to reconcile; no second order will be sent.',503)
        if order.get('amount')!=row['total_paise'] or order.get('currency')!='INR':fail('AMOUNT_MISMATCH','Provider order requires reconciliation.',409)
        def ready(u):
            saved=u.get('retail_orders',key);saved.update(order_id=order['id'],state='payment_pending');u.put('retail_orders',key,saved);return saved
        return {**store.run(ready),'key_id':__import__('os').getenv('RAZORPAY_KEY_ID','')}
    @r.post('/orders/{oid}/verify')
    def verify(oid:str,body:Verify,user=Depends(core.current_user)):
        row=store.run(lambda u:u.get('retail_orders',oid))
        if not row or row['customer_id']!=user['id']:fail('NOT_FOUND','Order not found.',404)
        payment=razorpay('payments/'+body.payment_id)
        if payment.get('order_id')!=row.get('order_id') or payment.get('amount')!=row['total_paise'] or payment.get('currency')!='INR' or payment.get('status')!='captured' or not payment.get('captured') or payment.get('amount_refunded',0):fail('PAYMENT_UNCONFIRMED','A captured payment matching this exact order is required.',409)
        def finish(u):
            saved=u.get('retail_orders',oid)
            if saved['state']=='paid':return saved
            saved.update(state='paid',payment_id=payment['id'],paid_at=time.time())
            for item in saved['items']:
                amount=item['total_paise']-item['discount_paise'];pid=oid+':'+item['product_id'];u.put('shop_payables',pid,dict(id=pid,retail_order_id=oid,job_id='',shop_id=item['shop_id'],amount_paise=amount,status='awaiting_fulfillment',weekly_due_at=next_weekly(time.time())))
            post(u,'retail:'+oid,[{'account':'payment_clearing','debit':saved['total_paise'],'credit':0},{'account':'parts_payable','debit':0,'credit':saved['total_paise']}],retail_order_id=oid)
            u.put('retail_orders',oid,saved);mail_order(u,saved,'paid',suppliers=True);return saved
        return store.run(finish)
    @r.post('/orders/{oid}/payment')
    def resume(oid:str,user=Depends(core.current_user)):
        row=store.run(lambda u:u.get('retail_orders',oid))
        if not row or row['customer_id']!=user['id']:fail('NOT_FOUND','Order not found.',404)
        if row['state']=='paid':return row
        if not row.get('order_id'):
            matches=razorpay('orders?receipt='+row['receipt']).get('items',[])
            if len(matches)!=1:fail('ORDER_RECONCILING','Payment setup is being reconciled. Contact support with the saved order ID; no second order will be sent.',409)
            gateway=matches[0]
            if gateway.get('amount')!=row['total_paise'] or gateway.get('currency')!='INR':fail('AMOUNT_MISMATCH','Provider order requires reconciliation.',409)
            def save(u):
                current=u.get('retail_orders',oid);current.update(order_id=gateway['id'],state='payment_pending');u.put('retail_orders',oid,current);return current
            row=store.run(save)
        payments=razorpay('orders/'+row['order_id']+'/payments').get('items',[])
        captured=next((p for p in payments if p.get('status')=='captured' and p.get('captured')),None)
        if captured:return verify(oid,Verify(payment_id=captured['id']),user)
        if any(p.get('status') in ('authorized','refunded') for p in payments):fail('PAYMENT_REVIEW','Payment is awaiting capture or refund review. Do not pay again.',409)
        return {**row,'key_id':__import__('os').getenv('RAZORPAY_KEY_ID','')}
    @r.get('/orders')
    def mine(user=Depends(core.current_user)):
        return store.run(lambda u:{'orders':[o for o in u.all('retail_orders') if o['customer_id']==user['id']]})
    @r.get('/shop-orders')
    def shops(user=Depends(core.current_user)):
        def read(u):
            ids={s['id'] for s in u.all('shops') if s['owner_id']==user['id']}
            return {'orders':[{k:v for k,v in o.items() if k in ('id','state','created_at','recipient_name','recipient_phone','delivery_address','received_at')}|{'items':[i for i in o['items'] if i['shop_id'] in ids]} for o in u.all('retail_orders') if o['state']=='paid' and any(i['shop_id'] in ids for i in o['items'])]}
        return store.run(read)
    @r.post('/orders/{oid}/received')
    def received(oid:str,user=Depends(core.current_user)):
        def save(u):
            row=u.get('retail_orders',oid)
            if not row or row['customer_id']!=user['id']:fail('NOT_FOUND','Order not found.',404)
            if row['state']!='paid':fail('NOT_PAID','Verified payment is required.',409)
            if row.get('received_at'):return row
            row['received_at']=time.time()
            for item in row['items']:
                p=u.get('inventory',item['product_id']);p['reserved']=max(0,p.get('reserved',0)-item['quantity']);u.put('inventory',p['id'],p)
                pid=oid+':'+item['product_id'];payable=u.get('shop_payables',pid)
                if payable and payable['status']=='awaiting_fulfillment':payable['status']='retail_receipt_review';u.put('shop_payables',pid,payable)
            u.put('retail_orders',oid,row);mail_order(u,row,'received',suppliers=True);return row
        return store.run(save)
    core.app.include_router(r)
