"""Checkout against the live shop catalogue with reserved stock and coupon snapshots.
Unknown gateway outcomes are reconciled by receipt, never blindly resubmitted.
"""
import hashlib,re,time,uuid
from typing import Literal
from fastapi import APIRouter,Depends
from pydantic import Field
from operations import Input,fail
from integrations import razorpay
from rentals import payments_ready,next_weekly,post
from procurement import live_product
from shop_pricing import price
from retail_resolution import return_policy
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
    payment_id:str=Field(pattern=r'^pay_[A-Za-z0-9]+$',max_length=100)
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
        pricing=price(u,p);total=pricing['price_paise']*line.quantity;gst=p.get('gst_bps');base=total*10000//(10000+gst) if gst is not None else None
        rows.append(dict(product_id=p['id'],shop_id=p['shop_id'],name=p['name'],quantity=line.quantity,unit_price_paise=pricing['price_paise'],base_unit_price_paise=pricing['base_price_paise'],shop_discount_paise=pricing['discount_paise']*line.quantity,shop_discount_bps=pricing['discount_bps'],offer_source=pricing['offer_source'],offer_valid_until=pricing['valid_until'],total_paise=total,gst_bps=gst,base_paise=base,condition=p.get('condition','new'),category=p.get('category',''),version=p.get('version',1),return_policy=return_policy(p)))
    captain=bool(body.coupon_code and body.coupon_code.strip().upper().startswith('CAPTAIN'))
    from captain_rewards import APPLIANCES
    for row in rows:row['reward_eligible']=row['condition']=='refurbished' and (not captain or row['category'].strip().casefold() in APPLIANCES)
    base=sum(row['base_paise'] or 0 for row in rows if row['reward_eligible'])
    discount=0;offer=None
    if body.coupon_code:
        if not base:fail('TAX_BREAKDOWN_REQUIRED','This coupon requires a refurbished item with a shop-declared tax breakdown.',422)
        offer=validate(u,uid,body.coupon_code,'refurbished');discount=min(base*offer['bps']//10000,offer.get('cap_paise') or base)
    subtotal=sum(x['total_paise'] for x in rows)
    return dict(items=rows,base_subtotal_paise=sum(x['base_unit_price_paise']*x['quantity'] for x in rows),shop_discount_paise=sum(x['shop_discount_paise'] for x in rows),subtotal_paise=subtotal,discount_paise=discount,eligible_base_paise=base,total_paise=subtotal-discount,coupon=offer,fulfillment='Shop confirmation required; delivery charges cannot be added without approval.',tax_note='Listed prices are inclusive. No unconfirmed 18% tax is added at checkout.')


def index_order(u,row):
    """A direct provider-order lookup, with no financial collection scan."""
    oid=row.get('order_id')
    if not re.fullmatch(r'order_[A-Za-z0-9]+',str(oid or '')):fail('ORDER_MISMATCH','The saved provider order needs reconciliation.',409)
    linked=u.get('retail_gateway_orders',oid)
    if linked and (linked.get('retail_order_id')!=row['id'] or linked.get('customer_id')!=row['customer_id']):
        fail('ORDER_MISMATCH','The provider order already belongs to another checkout.',409)
    if not linked:u.put('retail_gateway_orders',oid,dict(id=oid,retail_order_id=row['id'],customer_id=row['customer_id']))
    return row


def attach_order(u,row,order):
    notes=order.get('notes') or {}
    if (type(order.get('amount')) is not int or order['amount']!=row['total_paise']
            or order.get('currency')!='INR' or order.get('receipt')!=row['receipt']
            or not re.fullmatch(r'order_[A-Za-z0-9]+',str(order.get('id','')))
            or not isinstance(notes,dict) or notes.get('retail_order')!=row['id']):
        fail('ORDER_MISMATCH','Provider order does not match this saved checkout. Reconciliation is required.',409)
    if row.get('order_id') and row['order_id']!=order['id']:
        fail('ORDER_MISMATCH','This checkout already belongs to another provider order.',409)
    row['order_id']=order['id'];index_order(u,row)
    # A slow create/recovery response must not undo a concurrent capture/refund.
    if row['state']=='creating':row['state']='payment_pending'
    u.put('retail_orders',row['id'],row)
    return row


def apply_payment(u,row,payment):
    """Apply authenticated provider data; browser claims never reach this code."""
    pid=payment.get('id');refund=payment.get('amount_refunded',0)
    refund=0 if refund is None else refund
    if (not row.get('order_id') or payment.get('order_id')!=row['order_id']
            or not re.fullmatch(r'pay_[A-Za-z0-9]+',str(pid or ''))
            or type(payment.get('amount')) is not int or payment['amount']!=row['total_paise']
            or payment.get('currency')!='INR' or type(refund) is not int or not 0<=refund<=row['total_paise']
            or payment.get('status')=='refunded' and not refund):
        fail('PAYMENT_UNCONFIRMED','Provider payment does not match this saved checkout.',409)
    final=payment.get('status') in ('captured','refunded') or refund>0
    if final and payment.get('captured') is not True:fail('PAYMENT_UNCONFIRMED','A captured payment is required.',409)
    if final and row.get('payment_id') and row['payment_id']!=pid:
        fail('DUPLICATE_COLLECTION_REVIEW','Another payment on this order needs reconciliation.',409)
    receipt=u.get('receipts',pid)
    if receipt and (receipt.get('kind')!='retail' or receipt.get('retail_order_id')!=row['id']):
        fail('PAYMENT_ALREADY_USED','This payment already belongs to another purchase.',409)
    index_order(u,row)
    if not final:return row
    known=row.get('amount_refunded',0)
    observed=max(refund,known,row.get('provider_amount_refunded',0))
    if final and not receipt:
        u.put('receipts',pid,dict(id=pid,kind='retail',retail_order_id=row['id'],customer_id=row['customer_id'],amount_paise=row['total_paise'],currency='INR',verified_at=time.time()))
    if observed:
        # Owned resolution refunds have their own allocation/journal reconciler.
        # An external refund needs review; never fabricate a second refund entry
        # or replace the locally reconciled amount used by that reconciler.
        row.update(provider_amount_refunded=observed,payment_id=pid,payment_checked_at=time.time())
        if observed>known and not row.get('refund_pending'):
            row.update(financial_hold=True,allocation_review_required=True,external_refund_review_required=True)
            for item in row['items']:
                payable=u.get('shop_payables',row['id']+':'+item['product_id'])
                if payable:
                    payable.setdefault('before_external_refund_status',payable['status'])
                    payable.update(financial_hold=True,status='recovery_review_required' if payable.get('batch_id') or payable.get('status')=='paid' else 'retail_refund_review')
                    u.put('shop_payables',payable['id'],payable)
        u.put('retail_orders',row['id'],row)
        return row
    if payment.get('status')!='captured':return row
    if row['state']=='paid':return row
    if row['state']!='payment_pending' or row.get('refund_pending') or row.get('financial_hold'):
        fail('PAYMENT_REVIEW','This order is not awaiting payment. Reconciliation is required.',409)
    row.update(state='paid',payment_id=pid,paid_at=time.time())
    for item in row['items']:
        amount=item['total_paise']-(0 if (row.get('coupon') or {}).get('funded_by')=='repaido' else item['discount_paise'])
        aid=row['id']+':'+item['product_id']
        u.put('shop_payables',aid,dict(id=aid,retail_order_id=row['id'],job_id='',shop_id=item['shop_id'],amount_paise=amount,status='awaiting_fulfillment',weekly_due_at=next_weekly(time.time())))
    subsidy=row['discount_paise'] if (row.get('coupon') or {}).get('funded_by')=='repaido' else 0
    entries=[{'account':'payment_clearing','debit':row['total_paise'],'credit':0},{'account':'parts_payable','debit':0,'credit':row['total_paise']+subsidy}]
    if subsidy:entries.append({'account':'community_reward_expense','debit':subsidy,'credit':0})
    post(u,'retail:'+row['id'],entries,retail_order_id=row['id'])
    u.put('retail_orders',row['id'],row);mail_order(u,row,'paid',suppliers=True)
    return row


def apply_provider_payment(u,payment,provider_order=None):
    oid=payment.get('order_id')
    if not re.fullmatch(r'order_[A-Za-z0-9]+',str(oid or '')):return None
    linked=u.get('retail_gateway_orders',oid)
    if linked:
        row=u.get('retail_orders',linked['retail_order_id'])
        if not row or row.get('customer_id')!=linked.get('customer_id'):fail('ORDER_MISMATCH','Retail order ownership needs reconciliation.',409)
    elif provider_order is not None:
        notes=provider_order.get('notes') or {}
        rid=notes.get('retail_order') if isinstance(notes,dict) else None
        if not isinstance(rid,str) or not rid:return None
        row=u.get('retail_orders',rid)
        if not row or provider_order.get('id')!=oid:fail('ORDER_MISMATCH','Retail provider order needs reconciliation.',409)
        row=attach_order(u,row,provider_order)
    else:
        return None
    return apply_payment(u,row,payment)


def install(core):
    r=APIRouter(prefix='/operations/retail',tags=['Retail checkout']);store=core.operations_store
    def attach(row,order):
        return store.run(lambda u:attach_order(u,u.get('retail_orders',row['id']),order))
    @r.get('/orders/{oid}/reorder')
    def reorder(oid:str,user=Depends(core.current_user)):
        def read(u):
            old=u.get('retail_orders',oid)
            if not old or old['customer_id']!=user['id']:fail('NOT_FOUND','Order not found.',404)
            result=[];unavailable=[]
            for line in old['items']:
                p=u.get('inventory',line['product_id'])
                if not live_product(u,p,time.time()) or p['stock']<line['quantity']:
                    unavailable.append(line['name']);continue
                pricing=price(u,p)
                result.append(dict(id=p['id'],title=p['name'],price_paise=pricing['price_paise'],quantity=line['quantity'],shop_id=p['shop_id'],stock=p['stock'],category=p.get('category',''),condition=p.get('condition','new')))
            return {'items':result,'unavailable':unavailable,'note':'Current prices apply. Review the cart and confirm checkout; old coupons are not reused.'}
        return store.run(read)
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
            eligible=[x for x in q['items'] if x['reward_eligible'] and x['base_paise']]
            allocations={item['product_id']:q['discount_paise']*item['base_paise']//q['eligible_base_paise'] for item in eligible}
            remaining=q['discount_paise']-sum(allocations.values())
            # Allocate rounding paise by largest remainder. Putting every
            # remainder on the last item can exceed that item's entire price.
            for item in sorted(eligible,key=lambda item:q['discount_paise']*item['base_paise']%q['eligible_base_paise'],reverse=True)[:remaining]:
                allocations[item['product_id']]+=1
            for item in q['items']:
                item['discount_paise']=allocations.get(item['product_id'],0);p=u.get('inventory',item['product_id']);p['stock']-=item['quantity'];p['reserved']=p.get('reserved',0)+item['quantity'];p['version']=p.get('version',0)+1;u.put('inventory',p['id'],p)
            row=dict(**q,id=key,customer_id=user['id'],fingerprint=fp,state='creating',receipt='rt-'+key[:32],created_at=time.time(),recipient_name=body.recipient_name,recipient_phone=body.recipient_phone,delivery_address=body.delivery_address)
            u.put('retail_orders',key,row);mail_order(u,row,'saved');return row,True
        row,new=store.run(save)
        if row.get('provider_amount_refunded',0)>row.get('amount_refunded',0):fail('PAYMENT_REVIEW','This order has a provider refund requiring reconciliation.',409)
        if row.get('order_id'):return {**store.run(lambda u:index_order(u,u.get('retail_orders',row['id']))),'key_id':__import__('os').getenv('RAZORPAY_KEY_ID','')}
        if not new:
            matches=razorpay('orders?receipt='+row['receipt']).get('items',[])
            if len(matches)!=1:fail('ORDER_RECONCILING','Payment outcome is being reconciled. Keep this order; do not create another.',409)
            order=matches[0]
        else:
            try:order=razorpay('orders',{'amount':row['total_paise'],'currency':'INR','receipt':row['receipt'],'notes':{'retail_order':row['id']}})
            except Exception:fail('ORDER_RECONCILING','The provider outcome is unknown. Retry this same checkout to reconcile; no second order will be sent.',503)
        return {**attach(row,order),'key_id':__import__('os').getenv('RAZORPAY_KEY_ID','')}
    @r.post('/orders/{oid}/verify')
    def verify(oid:str,body:Verify,user=Depends(core.current_user)):
        row=store.run(lambda u:u.get('retail_orders',oid))
        if not row or row['customer_id']!=user['id']:fail('NOT_FOUND','Order not found.',404)
        payment=razorpay('payments/'+body.payment_id)
        if (payment.get('id')!=body.payment_id or not row.get('order_id') or payment.get('order_id')!=row['order_id']
                or type(payment.get('amount')) is not int or payment['amount']!=row['total_paise']
                or payment.get('currency')!='INR' or payment.get('status')!='captured'
                or payment.get('captured') is not True or payment.get('amount_refunded',0)):
            fail('PAYMENT_UNCONFIRMED','A captured payment matching this exact order is required.',409)
        def finish(u):
            saved=u.get('retail_orders',oid)
            if saved['state']=='refunded' or saved.get('amount_refunded') or saved.get('provider_amount_refunded') or saved.get('refund_pending'):
                fail('PAYMENT_REVIEW','This order has a refund in progress or already recorded. Its payment cannot be reapplied.',409)
            return apply_payment(u,saved,payment)
        return store.run(finish)
    @r.post('/orders/{oid}/payment')
    def resume(oid:str,user=Depends(core.current_user)):
        row=store.run(lambda u:u.get('retail_orders',oid))
        if not row or row['customer_id']!=user['id']:fail('NOT_FOUND','Order not found.',404)
        if row.get('order_id'):store.run(lambda u:index_order(u,u.get('retail_orders',oid)))
        if row.get('provider_amount_refunded',0)>row.get('amount_refunded',0):fail('PAYMENT_REVIEW','This order has a provider refund requiring reconciliation.',409)
        if row['state'] in ('paid','refunded'):return row
        if not row.get('order_id'):
            matches=razorpay('orders?receipt='+row['receipt']).get('items',[])
            if len(matches)!=1:fail('ORDER_RECONCILING','Payment setup is being reconciled. Contact support with the saved order ID; no second order will be sent.',409)
            row=attach(row,matches[0])
            if row['state'] in ('paid','refunded'):return row
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
    import retail_resolution
    retail_resolution.install(core)
