"""Server-owned rental stock, time billing, custody, deposits and return review.

All amounts are integer paise. Provider responses, never client flags, release
custody/refunds. Each request and state command has an idempotency key.
"""
import copy
import hashlib
import math
import os
import time
import uuid
from typing import Literal
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends
from pydantic import Field, model_validator
from operations import Input, fail, event
from integrations import audit, razorpay, enabled, configured, PaymentCheck
from procurement import code_for, check_code

PERIODS = {'daily': 86400, 'weekly': 7*86400, 'monthly': 30*86400}
POLICY = 'rental-custody-v1'
TERMINAL = {'cancelled', 'rejected', 'expired', 'returned'}

class Listing(Input):
    expected_version: int = Field(ge=0)
    name: str = Field(min_length=3, max_length=150)
    category: str = Field(min_length=2, max_length=80)
    description: str = Field(min_length=10, max_length=1500)
    condition: str = Field(min_length=5, max_length=500)
    instructions: str = Field(min_length=5, max_length=1500)
    image_url: str = Field(default='', max_length=500)
    total_units: int = Field(ge=0, le=1000)
    gst_bps:int|None=Field(default=None,ge=0,le=3000)
    daily_paise: int = Field(default=0, ge=0, le=100000000)
    weekly_paise: int = Field(default=0, ge=0, le=100000000)
    monthly_paise: int = Field(default=0, ge=0, le=100000000)
    deposit_paise: int = Field(gt=0, le=100000000)
    replacement_value_paise: int = Field(gt=0, le=100000000)
    fulfillment: Literal['pickup', 'delivery', 'both'] = 'pickup'
    delivery_fee_paise: int = Field(default=0, ge=0, le=10000000)
    delivery_area: str = Field(default='', max_length=300)
    active: bool = True

    @model_validator(mode='after')
    def valid(self):
        if not any((self.daily_paise,self.weekly_paise,self.monthly_paise)): raise ValueError('Set at least one rental rate.')
        if self.deposit_paise > self.replacement_value_paise: raise ValueError('Deposit cannot exceed the declared replacement value.')
        if self.fulfillment != 'pickup' and len(self.delivery_area.strip()) < 3: raise ValueError('Describe the supported delivery area.')
        if self.image_url and not (self.image_url.startswith('https://') or self.image_url.startswith('/images/') or self.image_url.startswith('/api/operations/media/')): raise ValueError('Use an HTTPS product photo or a local image.')
        return self

class Request(Input):
    coupon_code: str | None = Field(default=None,max_length=30)
    listing_id: str = Field(min_length=1,max_length=100)
    listing_version: int = Field(ge=1)
    period: Literal['daily','weekly','monthly']
    expected_periods: int = Field(ge=1,le=365)
    fulfillment: Literal['pickup','delivery']
    delivery_address: str = Field(default='',max_length=500)
    job_id: str | None = None
    consent: Literal[True]
    request_id: str = Field(min_length=16,max_length=100)

class Command(Input):
    expected_version: int = Field(ge=1)
    command_id: str = Field(min_length=16,max_length=100)
    action: Literal['approve','accept','reject','cancel','handover','request_return','receive_return','inspect','dispute','accept_damage','restock']
    code: str = Field(default='',max_length=6)
    note: str = Field(default='',max_length=1500)
    damage_paise: int = Field(default=0,ge=0,le=100000000)

class Resolve(Input):
    expected_version: int = Field(ge=1)
    damage_paise: int = Field(ge=0,le=100000000)
    reason: str = Field(min_length=10,max_length=1500)
    evidence_reference: str = Field(min_length=8,max_length=300)
    custody: Literal['returned','lost','ongoing'] | None = None
    ended_at: float | None = None


def next_weekly(now):
    local=datetime.fromtimestamp(now,timezone(timedelta(hours=5,minutes=30)))
    return (local+timedelta(days=7-local.weekday())).replace(hour=0,minute=0,second=0,microsecond=0).timestamp()


def payments_ready():
    return enabled('REPAIDO_PAYMENTS_ENABLED') and configured('RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET')

def usage(r, now):
    if not r.get('started_at'): return 0, 0
    seconds = max(0,(r.get('returned_at') or now)-r['started_at'])
    units = max(1,math.ceil(seconds/PERIODS[r['period']]))
    discount=(units*r['rate_paise']*10000//(10000+r.get('gst_bps',0)))*r.get('coupon',{}).get('bps',0)//10000
    return units, units*r['rate_paise']+r['delivery_fee_paise']-discount

def public_listing(u,p):
    shop=u.get('shops',p['shop_id'])
    if not shop or shop['status']!='approved' or not p['active']: return None
    return {**p,'available_units':max(0,p['total_units']-p.get('reserved',0)-p.get('quarantined',0)),
            'shop':{k:shop.get(k) for k in ('id','name','address','city','location')}}

def rental_view(u,r,uid,admin=False):
    units,cost=usage(r,time.time())
    value=copy.deepcopy(r)
    value.update(billed_periods=units,accrued_paise=cost,server_time=time.time(),payments_available=payments_ready())
    shop=u.get('shops',r['shop_id']) or {}
    value['shop']={k:shop.get(k) for k in ('id','name','address','city','location')}
    value['is_owner']=shop.get('owner_id')==uid
    value['is_renter']=r['renter_id']==uid
    value['is_customer']=r['customer_id']==uid
    value['deposit_status']=(u.get('rental_payments',r['id']+':deposit') or {}).get('status','unpaid')
    value['usage_payment_status']=(u.get('rental_payments',r['id']+':usage') or {}).get('status','unpaid') if not r.get('job_id') else 'on_task_invoice'
    value['refund_status']=(u.get('rental_refunds',r['id']) or {}).get('status','not_requested')
    value['refund_paise']=max(0,r['deposit_paise']-r.get('damage_paise',0))
    value['damage_balance_paise']=max(0,r.get('damage_paise',0)-r['deposit_paise'])
    value['damage_payment_status']=(u.get('rental_payments',r['id']+':damage') or {}).get('status','unpaid')
    if uid not in (r['renter_id'],shop.get('owner_id')) and not admin: value.pop('delivery_address',None)
    return value

def release_stock(u,r,quarantine=False):
    if r.get('stock_released'): return
    p=u.get('rental_inventory',r['listing_id']);p['reserved']=max(0,p.get('reserved',0)-1)
    if quarantine:p['quarantined']=p.get('quarantined',0)+1
    p['version']+=1;u.put('rental_inventory',p['id'],p);r['stock_released']=True;r['quarantined']=quarantine

def post(u,key,lines,**fields):
    if not u.get('journals',key):u.put('journals',key,dict(id=key,status='posted',lines=lines,posted_at=time.time(),**fields))

def apply_payment(u,payment):
    rows=[p for p in u.all('rental_payments') if p.get('order_id') and p.get('order_id')==payment.get('order_id')]
    if not rows:return None
    if len(rows)!=1:fail('PAYMENT_CONFLICT','Rental payment needs reconciliation.')
    p=rows[0];r=u.get('rentals',p['rental_id'])
    if payment.get('currency')!='INR' or payment.get('amount')!=p['amount_paise']:fail('AMOUNT_MISMATCH','Rental payment amount does not match.')
    if p.get('payment_id') and p['payment_id']!=payment['id']:fail('DUPLICATE_PAYMENT','A second capture needs refund review.')
    if payment.get('amount_refunded',0) or payment.get('status')=='refunded':
        refunded=max(p.get('amount_refunded',0),payment.get('amount_refunded',0))
        p.update(status='refunded' if refunded>=p['amount_paise'] else 'partially_refunded',amount_refunded=refunded)
        if p['kind']!='deposit':r['financial_hold']=True
    elif payment.get('status')=='captured' and payment.get('captured') is True and p['status'] not in ('refunded','partially_refunded'):
        p.update(status='captured',payment_id=payment['id'])
        account='rental_deposits' if p['kind']=='deposit' else 'parts_payable'
        post(u,'rental-capture-'+p['id'],[{'account':'payment_clearing','debit':p['amount_paise'],'credit':0},{'account':account,'debit':0,'credit':p['amount_paise']}],rental_id=r['id'])
        if p['kind']!='deposit':
            oid='rental-'+p['id']
            u.put('shop_payables',oid,u.get('shop_payables',oid) or dict(id=oid,rental_id=r['id'],payment_kind=p['kind'],job_id='',shop_id=r['shop_id'],amount_paise=p['amount_paise'],status='payment_confirmed',weekly_due_at=next_weekly(time.time())))
    else:p['last_attempt_status']=payment.get('status','unknown')
    p['checked_at']=time.time();u.put('rental_payments',p['id'],p);u.put('rentals',r['id'],r)
    return p

def close_usage(u,r,now,lost=False):
    r['billed_periods'],r['final_usage_paise']=usage(r,now)
    release_stock(u,r,quarantine=not lost)
    if lost:
        p=u.get('rental_inventory',r['listing_id']);p['total_units']=max(0,p['total_units']-1);p['version']+=1;u.put('rental_inventory',p['id'],p)
    if r.get('job_id'):
        j=u.get('jobs',r['job_id'])
        j['total_paise']+=r['final_usage_paise'];j['rental_total_paise']=j.get('rental_total_paise',0)+r['final_usage_paise'];j['scope_version']+=1
        j['scopes'].append({'version':j['scope_version'],'price_paise':j['total_paise'],'rental_id':r['id'],'rental_charge_paise':r['final_usage_paise'],'name':r['listing_name']});u.put('jobs',j['id'],j)
        u.put('shop_payables','rental-'+r['id'],dict(id='rental-'+r['id'],job_id=j['id'],shop_id=r['shop_id'],amount_paise=r['final_usage_paise'],status='awaiting_customer_payment',weekly_due_at=next_weekly(now)))


def install(core):
    router=APIRouter(prefix='/operations');store=core.operations_store
    def owned_shop(u,user):
        if not user.get('phone_authenticated'):fail('PHONE_OTP_REQUIRED','Use mobile OTP sign-in.',403)
        s=next((s for s in u.all('shops') if s['owner_id']==user['id'] and s['status']=='approved'),None)
        if not s:fail('SHOP_APPROVAL_REQUIRED','Your shop must be approved before listing rentals.',403)
        return s
    def authorized(u,rid,user):
        r=u.get('rentals',rid)
        s=u.get('shops',r['shop_id']) if r else None
        if not r or user['id'] not in (r['renter_id'],r['customer_id'],s.get('owner_id') if s else None):fail('NOT_FOUND','Rental not found.',404)
        return r,s
    def notify(u,r,action,actor):
        audit(u,'Rental'+action,actor,rental_id=r['id'])
        if r.get('job_id'):
            j=u.get('jobs',r['job_id']);j['version']+=1;event(u,j,'Rental'+action,actor,{'rental_id':r['id']});u.put('jobs',j['id'],j)

    @router.get('/rentals/catalog')
    def catalog():
        return store.run(lambda u:{'items':[v for p in u.all('rental_inventory') if (v:=public_listing(u,p)) is not None], 'periods':PERIODS,'policy_version':POLICY})

    @router.get('/shop/rental-inventory')
    def inventory(user=Depends(core.current_user)):
        def read(u):
            s=owned_shop(u,user);return {'items':[p for p in u.all('rental_inventory') if p['shop_id']==s['id']]}
        return store.run(read)

    @router.put('/shop/rental-inventory/{pid}')
    def listing(pid:str,body:Listing,user=Depends(core.current_user)):
        if not 1<=len(pid)<=100 or not all(c.isalnum() or c in '-_' for c in pid):fail('INVALID_ID','Invalid item ID.',422)
        def save(u):
            s=owned_shop(u,user);old=u.get('rental_inventory',pid)
            if old and old['shop_id']!=s['id']:fail('NOT_FOUND','Item not found.',404)
            if (old or {}).get('version',0)!=body.expected_version:fail('STALE_INVENTORY','Refresh inventory before saving.')
            from workspace import validate_media
            validate_media(u,body.image_url,s['id'])
            used=(old or {}).get('reserved',0)+(old or {}).get('quarantined',0)
            if body.total_units<used:fail('ITEMS_IN_CUSTODY','Count cannot be below reserved, rented or quarantined units.')
            p=dict(body.model_dump(exclude={'expected_version'}),id=pid,shop_id=s['id'],version=body.expected_version+1,reserved=(old or {}).get('reserved',0),quarantined=(old or {}).get('quarantined',0))
            u.put('rental_inventory',pid,p);audit(u,'RentalInventorySaved',user['id'],listing_id=pid);return p
        return store.run(save)

    @router.post('/rentals',status_code=201)
    def request(body:Request,user=Depends(core.current_user)):
        key=hashlib.sha256((user['id']+body.request_id).encode()).hexdigest();fingerprint=hashlib.sha256(body.model_dump_json().encode()).hexdigest()
        def save(u):
            previous=u.get('rental_keys',key)
            if previous:
                if previous['fingerprint']!=fingerprint:fail('KEY_REUSED','This retry differs from the original rental request.')
                return rental_view(u,u.get('rentals',previous['rental_id']),user['id'])
            p=u.get('rental_inventory',body.listing_id);public=public_listing(u,p) if p else None
            if not public or public['available_units']<1:fail('UNAVAILABLE','This item is not available. Try another item or shop.')
            if p['version']!=body.listing_version:fail('PRICE_CHANGED','The listing changed. Refresh and review the current terms.')
            if p['fulfillment'] not in (body.fulfillment,'both'):fail('FULFILLMENT_UNAVAILABLE','Choose a supported collection method.')
            if body.fulfillment=='delivery' and len(body.delivery_address.strip())<10:fail('ADDRESS_REQUIRED','Enter a delivery address; the shop must confirm coverage.',422)
            rate=p[body.period+'_paise']
            if not rate:fail('PERIOD_UNAVAILABLE','This shop does not offer that rental period.')
            customer=user['id'];state='requested'
            if body.job_id:
                j=u.get('jobs',body.job_id);w=u.get('workers',user['id'])
                if not j or j.get('worker_id')!=user['id'] or j['state']!='in_progress' or not w or w['status']!='approved':fail('TASK_NOT_AVAILABLE','Only the assigned approved agent can request a rental during work.',403)
                customer=j['customer_id'];state='approval_pending'
            rid=str(uuid.uuid4());now=time.time()
            r=dict(id=rid,listing_id=p['id'],listing_name=p['name'],shop_id=p['shop_id'],renter_id=user['id'],renter_name=user.get('name','Renter'),customer_id=customer,job_id=body.job_id,period=body.period,rate_paise=rate,deposit_paise=p['deposit_paise'],replacement_value_paise=p['replacement_value_paise'],expected_periods=body.expected_periods,fulfillment=body.fulfillment,delivery_address=body.delivery_address if body.fulfillment=='delivery' else '',delivery_fee_paise=p['delivery_fee_paise'] if body.fulfillment=='delivery' else 0,terms=copy.deepcopy(p),policy_version=POLICY,state=state,version=1,created_at=now,expires_at=now+1800,inspection='pending',damage_paise=0,consent_at=now)
            if body.coupon_code:
                if body.job_id:fail('CUSTOMER_COUPON_ONLY','Customer coupons apply to direct customer rentals.',422)
                if p.get('gst_bps') is None:fail('TAX_BREAKDOWN_REQUIRED','The shop must declare the included tax before this coupon can be applied.',422)
                r['gst_bps']=p['gst_bps']
                from coupons import reserve
                r['coupon']=reserve(u,user['id'],body.coupon_code,'rental',rate*body.expected_periods*10000//(10000+p['gst_bps']),'rental:'+rid,now)
            p['reserved']+=1;p['version']+=1;u.put('rental_inventory',p['id'],p);u.put('rentals',rid,r);u.put('rental_keys',key,{'fingerprint':fingerprint,'rental_id':rid});notify(u,r,'Requested',user['id'])
            return rental_view(u,r,user['id'])
        return store.run(save)

    @router.get('/rentals')
    def mine(job_id:str|None=None,user=Depends(core.current_user)):
        def read(u):
            shops={s['id'] for s in u.all('shops') if s['owner_id']==user['id']}
            return {'rentals':[rental_view(u,r,user['id']) for r in u.all('rentals') if (user['id'] in (r['renter_id'],r['customer_id']) or r['shop_id'] in shops) and (not job_id or r.get('job_id')==job_id)]}
        return store.run(read)

    @router.get('/rentals/{rid}/code')
    def code(rid:str,kind:Literal['handover','return'],user=Depends(core.current_user)):
        def save(u):
            r,s=authorized(u,rid,user)
            if user['id']!=r['renter_id']:fail('RENTER_ONLY','Only the renter can show their handover code.',403)
            if (kind=='handover' and r['state']!='accepted') or (kind=='return' and r['state'] not in ('active','return_requested')):fail('NOT_READY','No handover is available in this state.')
            if kind=='handover' and (u.get('rental_payments',rid+':deposit') or {}).get('status')!='captured':fail('DEPOSIT_REQUIRED','Pay and verify the security deposit first.')
            return code_for(u,'rental:'+rid+':'+kind,time.time())
        return store.run(save)

    @router.post('/rentals/{rid}/commands')
    def command(rid:str,body:Command,user=Depends(core.current_user)):
        key=hashlib.sha256((user['id']+rid+body.command_id).encode()).hexdigest();fingerprint=hashlib.sha256(body.model_dump_json().encode()).hexdigest()
        def save(u):
            r,s=authorized(u,rid,user);old=u.get('rental_commands',key)
            if old:
                if old['fingerprint']!=fingerprint:fail('KEY_REUSED','This retry has different details.')
                return rental_view(u,r,user['id'])
            if r['version']!=body.expected_version:fail('RENTAL_CHANGED','Rental changed. Refresh before trying again.')
            a=body.action;now=time.time();owner=user['id']==s['owner_id'];renter=user['id']==r['renter_id'];customer=user['id']==r['customer_id']
            if a in ('accept','reject','handover','receive_return','inspect','restock'):
                owned_shop(u,user)
                if not owner:fail('OWNER_ONLY','Only this rental’s shop can perform this action.',403)
            if a=='approve':
                if not customer or r['state']!='approval_pending':fail('CUSTOMER_APPROVAL_REQUIRED','The task customer must approve the rental terms.',403)
                if r['expires_at']<=now:fail('EXPIRED','This request expired.')
                r.update(state='requested',customer_approved_at=now)
            elif a=='accept':
                if r['state']!='requested' or r['expires_at']<=now:fail('NOT_REQUESTED','This request is no longer available.')
                r.update(state='accepted',expires_at=now+7200)
            elif a in ('reject','cancel'):
                if r['state'] not in ('approval_pending','requested','accepted') or (a=='cancel' and not (renter or customer)):fail('CANNOT_CANCEL','An item already handed over must be returned.',403)
                r.update(state='rejected' if a=='reject' else 'cancelled',closed_at=now,reason=body.note);release_stock(u,r)
            elif a=='handover':
                if r['state']!='accepted' or r['expires_at']<=now:fail('NOT_READY','The accepted reservation expired or changed.')
                if (u.get('rental_payments',rid+':deposit') or {}).get('status')!='captured':fail('DEPOSIT_REQUIRED','Gateway-confirmed deposit required before handover.')
                if r.get('job_id'):
                    j=u.get('jobs',r['job_id'])
                    if j.get('worker_id')!=r['renter_id'] or j['state']!='in_progress':fail('ASSIGNMENT_CHANGED','The agent or task changed. Cancel and create a new approved request.')
                error=check_code(u,'rental:'+rid+':handover',body.code,now)
                if error:return {'code_error':error}
                r.update(state='active',started_at=now,expected_return_at=now+PERIODS[r['period']]*r['expected_periods'],handover_condition=body.note)
            elif a=='request_return':
                if not renter or r['state']!='active':fail('RENTER_ONLY','Only the renter can request a return for an active item.',403)
                r.update(state='return_requested',return_requested_at=now,return_note=body.note)
            elif a=='receive_return':
                if r['state'] not in ('active','return_requested'):fail('NOT_ACTIVE','This item is not on rent.')
                error=check_code(u,'rental:'+rid+':return',body.code,now)
                if error:return {'code_error':error}
                r.update(state='returned',returned_at=now,return_condition=body.note)
                close_usage(u,r,now)
            elif a=='inspect':
                if r['state']!='returned' or r['inspection']!='pending':fail('NOT_RETURNED','Inspect a newly returned item.')
                if len(body.note.strip())<5 or body.damage_paise>r['replacement_value_paise']:fail('INVALID_INSPECTION','Describe condition and keep the claim within replacement value.',422)
                r.update(inspection='claim_pending' if body.damage_paise else 'clear',damage_proposed_paise=body.damage_paise,inspection_note=body.note)
                if not body.damage_paise:unquarantine(u,r)
            elif a=='restock':
                if r['state']!='returned' or r['inspection'] not in ('clear','resolved') or not r.get('quarantined') or len(body.note.strip())<10:fail('REPAIR_REQUIRED','Complete damage review and record repair/safety checks before restocking.')
                unquarantine(u,r);r['restock_note']=body.note
            elif a=='accept_damage':
                if not renter or r['inspection']!='claim_pending':fail('NO_CLAIM','No damage claim awaits your response.',403)
                r.update(damage_paise=r['damage_proposed_paise'],inspection='resolved',damage_accepted_at=now)
            elif a=='dispute':
                if r['state'] not in ('active','return_requested','returned'):fail('CUSTODY_REQUIRED','Cancel an uncollected reservation; rental review applies after handover.')
                if u.get('rental_refunds',rid):fail('ADJUSTMENT_REQUIRED','Refund processing has started. Contact support for a separate financial adjustment.')
                if not (renter or customer or owner) or len(body.note.strip())<10:fail('REASON_REQUIRED','Describe the issue for company review.',422)
                r.update(dispute_reason=body.note,inspection='disputed',financial_hold=True)
            r['version']+=1;u.put('rentals',rid,r);notify(u,r,a.title(),user['id']);u.put('rental_commands',key,{'fingerprint':fingerprint})
            return rental_view(u,r,user['id'])
        result=store.run(save)
        if result.get('code_error'):fail('INVALID_CODE',result['code_error'],422)
        return result

    @router.get('/admin/rentals',dependencies=[Depends(core.operator)])
    def admin_list():return store.run(lambda u:{'rentals':[rental_view(u,r,'admin',True) for r in u.all('rentals')]})

    @router.post('/admin/rentals/{rid}/resolve')
    def resolve(rid:str,body:Resolve,admin=Depends(core.operator)):
        def save(u):
            r=u.get('rentals',rid)
            if not r or r['state'] not in ('active','return_requested','returned') or r['version']!=body.expected_version or r['inspection'] not in ('disputed','claim_pending'):fail('REVIEW_CHANGED','Refresh the returned rental needing review.')
            if u.get('rental_refunds',rid):fail('ADJUSTMENT_REQUIRED','A refund/allocation already exists. Finance must reconcile before changing this decision.')
            s=u.get('shops',r['shop_id'])
            if admin['id'] in (r['renter_id'],r['customer_id'],s['owner_id']):fail('INDEPENDENT_REVIEW','An independent admin must review this case.',403)
            if body.damage_paise>r['replacement_value_paise']:fail('EXCESS_CLAIM','Claim exceeds the agreed replacement value.',422)
            if r['state']!='returned' and body.custody=='ongoing':
                if body.damage_paise:fail('RETURN_REVIEW_REQUIRED','Damage must wait for return or documented loss.',422)
                r.update(inspection='pending',financial_hold=False,resolution=body.model_dump(),version=r['version']+1)
                u.put('rentals',rid,r);notify(u,r,'ReviewClosedCustodyOngoing',admin['id']);return rental_view(u,r,admin['id'],True)
            if r['state']!='returned':
                if body.custody is None or body.ended_at is None or not r['started_at']<=body.ended_at<=time.time():fail('CUSTODY_EVIDENCE_REQUIRED','Record verified return or reviewed loss and a valid custody end time.',422)
                r.update(state='returned',returned_at=body.ended_at,lost=body.custody=='lost')
                close_usage(u,r,body.ended_at,lost=r['lost'])
            r.update(inspection='resolved',damage_paise=body.damage_paise,financial_hold=False,resolution=body.model_dump(),version=r['version']+1)
            if not body.damage_paise:unquarantine(u,r)
            u.put('rentals',rid,r);notify(u,r,'Resolved',admin['id']);return rental_view(u,r,admin['id'],True)
        return store.run(save)

    def reconcile_payment(p):
        if not p.get('order_id'):
            rows=[x for x in razorpay('orders?receipt='+p['receipt']).get('items',[]) if x.get('receipt')==p['receipt']]
            if len(rows)!=1: return {'status':'reconciling','message':'Order outcome unknown. No duplicate order was created.'}
            if rows[0].get('amount')!=p['amount_paise'] or rows[0].get('currency')!='INR':fail('ORDER_MISMATCH','Provider order needs review.')
            def attach(u):
                saved=u.get('rental_payments',p['id']);saved.update(order_id=rows[0]['id'],status='created');u.put('rental_payments',p['id'],saved);return saved
            p=store.run(attach)
        for payment in razorpay('orders/'+p['order_id']+'/payments').get('items',[]):store.run(lambda u:apply_payment(u,payment))
        return store.run(lambda u:u.get('rental_payments',p['id']))

    @router.post('/rentals/{rid}/payment-order')
    def payment_order(rid:str,kind:Literal['deposit','usage','damage'],user=Depends(core.current_user)):
        if not payments_ready():fail('PAYMENTS_UNAVAILABLE','Razorpay is not activated. No deposit or rental charge was taken. Your request remains visible.',503)
        def reserve(u):
            r,s=authorized(u,rid,user)
            if user['id']!=r['renter_id']:fail('RENTER_ONLY','Only the renter pays this separate rental invoice.',403)
            if kind=='deposit':
                if r['state']!='accepted' or r['expires_at']<=time.time():fail('NOT_READY','The shop must accept an unexpired reservation first.')
                amount=r['deposit_paise']
            elif kind=='usage':
                if r['state']!='returned' or r.get('job_id'):fail('NOT_DUE','Task rental charges are included in the customer’s final task bill.')
                amount=r['final_usage_paise']
            else:
                if r['inspection'] not in ('clear','resolved'):fail('REVIEW_REQUIRED','Damage must be accepted or independently reviewed first.')
                amount=max(0,r.get('damage_paise',0)-r['deposit_paise'])
            if r.get('financial_hold') or amount<=0:fail('NOT_DUE','No payable invoice is available; check any open review.')
            pid=rid+':'+kind;p=u.get('rental_payments',pid)
            if p:
                if p['status'] in ('captured','refunded','partially_refunded'):fail('ALREADY_PAID','This invoice already has a payment; refresh its status.')
                return p,False
            p=dict(id=pid,rental_id=rid,kind=kind,customer_id=user['id'],amount_paise=amount,status='creating',receipt='r_'+hashlib.sha256(pid.encode()).hexdigest()[:32],created_at=time.time())
            u.put('rental_payments',pid,p);return p,True
        p,new=store.run(reserve)
        if new:
            result=razorpay('orders',{'amount':p['amount_paise'],'currency':'INR','receipt':p['receipt'],'notes':{'rental_id':rid,'kind':kind}})
            def attach(u):
                saved=u.get('rental_payments',p['id']);saved.update(order_id=result['id'],status='created');u.put('rental_payments',p['id'],saved);return saved
            p=store.run(attach)
        if not p.get('order_id'):fail('RECONCILING','Order creation is being checked. Use Check payment; do not create another order.')
        return {'key_id':os.environ['RAZORPAY_KEY_ID'],'order_id':p['order_id'],'amount':p['amount_paise'],'currency':'INR'}

    @router.post('/rentals/{rid}/payment-check')
    def payment_check(rid:str,kind:Literal['deposit','usage','damage'],user=Depends(core.current_user)):
        def read(u):
            r,s=authorized(u,rid,user)
            if user['id']!=r['renter_id']:fail('RENTER_ONLY','Only the renter can reconcile their payment.',403)
            return u.get('rental_payments',rid+':'+kind)
        p=store.run(read)
        if not p:return {'status':'not_started'}
        return reconcile_payment(p)

    def refund_check(record):
        if record.get('provider_id'):result=razorpay('refunds/'+record['provider_id'])
        else:
            matches=[]
            for skip in range(0,1000,100):
                rows=razorpay('payments/'+record['payment_id']+'/refunds?count=100&skip='+str(skip)).get('items',[])
                matches.extend(x for x in rows if x.get('receipt')==record['receipt'])
                if len(rows)<100:break
            if len(matches)!=1:return {'status':'reconciling','message':'Refund outcome unknown. No second refund was sent.'}
            result=matches[0]
        return save_refund(record,result)

    def save_refund(record,result):
        if result.get('payment_id')!=record['payment_id'] or result.get('amount')!=record['amount_paise']:fail('REFUND_MISMATCH','Refund needs financial review.')
        def save(u):
            old=u.get('rental_refunds',record['id'])
            if old['status']=='processed':return old
            old.update(status=result['status'],provider_id=result['id'],checked_at=time.time());u.put('rental_refunds',old['id'],old)
            if old['status']=='processed':post(u,'rental-refund-'+old['id'],[{'account':'rental_deposits','debit':old['amount_paise'],'credit':0},{'account':'payment_clearing','debit':0,'credit':old['amount_paise']}],rental_id=old['id'])
            return old
        return store.run(save)

    @router.post('/rentals/{rid}/refund-deposit')
    def refund(rid:str,user=Depends(core.current_user)):
        if not payments_ready():fail('PAYMENTS_UNAVAILABLE','Gateway refunds are not enabled. No refund was sent.',503)
        def reserve(u):
            r,s=authorized(u,rid,user);p=u.get('rental_payments',rid+':deposit')
            if r.get('financial_hold') or (r['state']=='returned' and r['inspection'] not in ('clear','resolved')) or r['state'] not in TERMINAL:fail('RETURN_REVIEW_REQUIRED','Return and inspection or confirmed cancellation is required first.')
            if not p or p['status'] not in ('captured','partially_refunded','refunded'):fail('DEPOSIT_UNPAID','No verified deposit to refund.')
            previous=u.get('rental_refunds',rid)
            if previous:return previous,False
            if p.get('amount_refunded',0):fail('EXTERNAL_REFUND_REVIEW','An external refund needs review before another refund can be sent.')
            damage=min(r['deposit_paise'],r.get('damage_paise',0));amount=r['deposit_paise']-damage
            if damage:
                post(u,'rental-damage-'+rid,[{'account':'rental_deposits','debit':damage,'credit':0},{'account':'parts_payable','debit':0,'credit':damage}],rental_id=rid)
                u.put('shop_payables','rental-damage-'+rid,dict(id='rental-damage-'+rid,rental_id=rid,payment_kind='deposit',job_id='',shop_id=r['shop_id'],amount_paise=damage,status='reviewed_damage_payable',weekly_due_at=next_weekly(time.time())))
            record=dict(id=rid,payment_id=p['payment_id'],amount_paise=amount,receipt='rr_'+rid.replace('-',''),status='submitting' if amount else 'not_due',created_at=time.time());u.put('rental_refunds',rid,record);return record,bool(amount)
        record,new=store.run(reserve)
        if record['status'] in ('processed','not_due'):return record
        if not new:return refund_check(record)
        return save_refund(record,razorpay('payments/'+record['payment_id']+'/refund',{'amount':record['amount_paise'],'receipt':record['receipt'],'speed':'normal'}))

    def tick():
        now=time.time()
        def expire(u):
            count=0
            for r in u.all('rentals'):
                if r['state'] in ('approval_pending','requested','accepted') and r['expires_at']<=now:
                    r.update(state='expired',version=r['version']+1);release_stock(u,r);u.put('rentals',r['id'],r);notify(u,r,'Expired','scheduler');count+=1
            return count
        expired=store.run(expire);errors=0
        if payments_ready():
            rows=store.run(lambda u:[p for p in u.all('rental_payments') if p.get('status') in ('creating','created')])[:20]
            for p in rows:
                try:reconcile_payment(p)
                except Exception:errors+=1
            rows=store.run(lambda u:[r for r in u.all('rental_refunds') if r['status'] not in ('processed','not_due','failed')])[:20]
            for r in rows:
                try:refund_check(r)
                except Exception:errors+=1
        return {'expired':expired,'reconciliation_errors':errors}
    core.rentals_tick=tick;core.app.include_router(router)


def unquarantine(u,r):
    if r.get('quarantined'):
        p=u.get('rental_inventory',r['listing_id']);p['quarantined']=max(0,p.get('quarantined',0)-1);p['version']+=1;u.put('rental_inventory',p['id'],p);r['quarantined']=False
