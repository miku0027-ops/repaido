"""One-use, account-bound coupons; integer paise; no stacking or expiry resets."""
import hashlib,time
from typing import Literal
from fastapi import APIRouter,Depends
from pydantic import Field
from operations import Input,fail
DAY=86400
VERSION='welcome-v1'
TERMS='Vendor-funded discount on the eligible base only. Taxes, deposits, travel, delivery, parts and extra work excluded. One coupon per checkout; no stacking. Valid 30 days from issue. A reserved coupon cannot be used on another order.'
RULES={
 'WELCOME20':dict(family='welcome_service',scope='service',bps=2000,title='20% off your first service'),
 'RENT20':dict(family='welcome_rental',scope='rental',bps=2000,title='20% off your first rental'),
 'AGAIN10':dict(family='return_choice',scope='service',bps=1000,title='10% off your next service'),
 'RENEW10':dict(family='return_choice',scope='refurbished',bps=1000,title='10% off refurbished items'),
}
def key(uid,family):return hashlib.sha256((uid+'|'+family).encode()).hexdigest()
def paid_before(u,uid):
    if any(j.get('customer_id')==uid and j.get('state')=='completed' and j.get('payment_status')=='verified' for j in u.all('jobs')):return True
    rental_ids={r['id'] for r in u.all('rentals') if r.get('customer_id')==uid}
    if any(p.get('rental_id') in rental_ids and p.get('kind')=='usage' and p.get('status')=='captured' for p in u.all('rental_payments')):return True
    if any(o.get('customer_id')==uid and o.get('state')=='paid' for o in u.all('retail_orders')):return True
    if u.tx is not None:return any(s.to_dict().get('user_id')==uid and s.to_dict().get('payment_status')=='paid' for s in u.core.fs_collection('spare_orders').stream(transaction=u.tx))
    return bool(u.conn.execute("SELECT 1 FROM spare_orders WHERE user_id=? AND payment_status='paid' LIMIT 1",(uid,)).fetchone())
def first_eligible(u,uid,scope):
    if scope=='service':return not any(j.get('customer_id')==uid and j.get('state')!='cancelled' for j in u.all('jobs')) and not any(p.get('customer_id')==uid and p.get('state') not in ('cancelled','rejected') for p in u.all('home_plans')) and not any(h.get('customer_id')==uid and h.get('state') not in ('cancelled','expired','declined') for h in u.all('hires'))
    return not any(r.get('customer_id')==uid and r.get('state') not in ('cancelled','rejected','expired') for r in u.all('rentals'))
def wallet(u,uid,now=None):
    now=time.time() if now is None else now;paid=paid_before(u,uid);rows=[]
    for code,rule in RULES.items():
        cid=key(uid,rule['family']);row=u.get('coupons',cid)
        eligible=paid if rule['family']=='return_choice' else first_eligible(u,uid,rule['scope'])
        if not row and eligible:
            row=dict(id=cid,user_id=uid,family=rule['family'],issued_at=now,expires_at=now+30*DAY,status='available',version=VERSION)
            u.put('coupons',cid,row)
        if not row or row['status']!='available' or now>=row['expires_at'] or not eligible:continue
        if row.get('selected_code') and row['selected_code']!=code:continue
        rows.append({**rule,'id':cid,'code':code,'expires_at':row['expires_at'],'terms':TERMS,'funded_by':'vendor'})
    return rows

def validate(u,uid,code,scope,now=None):
    code=code.strip().upper();now=time.time() if now is None else now
    match=next((r for r in wallet(u,uid,now) if r['code']==code),None)
    normalized='service' if scope in ('service','hire','home') else scope
    if not match or match['scope']!=normalized:fail('COUPON_UNAVAILABLE','This code is not eligible for this checkout, is already reserved or has expired.',409)
    return match

def reserve(u,uid,code,scope,base,reference,now=None):
    now=time.time() if now is None else now;rule=RULES.get(code.strip().upper())
    if not rule:fail('COUPON_UNAVAILABLE','Check the promo code and its terms.',409)
    cid=key(uid,rule['family']);old=u.get('coupons',cid)
    if old and old.get('reference')==reference:
        if old.get('code')!=code.strip().upper():fail('COUPON_CHANGED','The reserved code cannot be changed.',409)
        return old['snapshot']
    offer=validate(u,uid,code,scope,now)
    if base<0 or (base==0 and scope!='home'):fail('COUPON_BASE_REQUIRED','A confirmed eligible base charge is required.',422)
    discount=base*offer['bps']//10000
    snapshot=dict(code=offer['code'],bps=offer['bps'],eligible_base_paise=base,discount_paise=discount,funded_by='vendor',terms=TERMS,version=VERSION,expires_at=offer['expires_at'])
    row=u.get('coupons',cid);row.update(status='reserved',code=offer['code'],reference=reference,reserved_at=now,snapshot=snapshot);u.put('coupons',cid,row)
    return snapshot

def attach_job(j,snapshot):
    j['coupon']=snapshot;j['vendor_discount_paise']=snapshot['discount_paise'];j['total_paise']-=snapshot['discount_paise']
    if j.get('scopes'):j['scopes'][0]['price_paise']=j['total_paise']

class Check(Input):
    code:str=Field(min_length=2,max_length=30)
    scope:Literal['service','rental','hire','home','refurbished','purchase','listing']
class Choose(Input):
    code:Literal['AGAIN10','RENEW10']
def install(core):
    r=APIRouter(prefix='/operations/coupons',tags=['Customer coupons']);store=core.operations_store
    @r.get('/wallet')
    def get_wallet(user=Depends(core.current_user)):
        return store.run(lambda u:{'coupons':wallet(u,user['id']),'server_time':time.time()})
    @r.post('/check')
    def check(body:Check,user=Depends(core.current_user)):
        return store.run(lambda u:validate(u,user['id'],body.code,body.scope))
    @r.post('/choose')
    def choose(body:Choose,user=Depends(core.current_user)):
        def save(u):
            rule=RULES[body.code];offer=validate(u,user['id'],body.code,rule['scope']);row=u.get('coupons',offer['id']);row['selected_code']=body.code;u.put('coupons',row['id'],row);return offer
        return store.run(save)
    @r.post('/launch')
    def launch(user=Depends(core.current_user)):
        def save(u):
            from promotions import prefs
            now=time.time();items=wallet(u,user['id'],now);p=prefs(u,user['id']);last=u.get('coupon_reminders',user['id']) or {}
            show=bool(items and p.get('launch',True) and now-last.get('shown_at',0)>=2*DAY)
            if show:u.put('coupon_reminders',user['id'],{'shown_at':now})
            return {'show':show,'coupons':items,'server_time':now}
        return store.run(save)
    core.app.include_router(r)
