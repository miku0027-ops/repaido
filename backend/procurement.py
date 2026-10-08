"""Reserved stock, private in-app OTPs and verified parts procurement."""
import copy,hashlib,hmac,secrets,time,uuid
from datetime import datetime,timezone,timedelta
from typing import Literal
from fastapi import APIRouter,Depends,Query
from pydantic import Field, model_validator
from datetime import date
from operations import Input,fail,event,metres,at_site,fresh_position,public_job
from integrations import audit

POLICY='pickup-return-v1'
class Refurbishment(Input):
    model_config={"extra":"forbid","str_strip_whitespace":True}
    grade:Literal['A+','A','B']
    cosmetic_condition:str=Field(min_length=5,max_length=500)
    tested_functions:str=Field(min_length=10,max_length=1500)
    tested_on:date
    repairs:str=Field(min_length=4,max_length=1000)
    known_defects:str=Field(min_length=4,max_length=1000)
    accessories:str=Field(min_length=4,max_length=500)
    battery_health_percent:int|None=Field(default=None,ge=0,le=100)
    warranty_days:int=Field(ge=0,le=1825)
    warranty_terms:str=Field(min_length=5,max_length=1000)
    return_days:int=Field(ge=0,le=365)
    return_terms:str=Field(min_length=5,max_length=1000)

    @model_validator(mode='after')
    def past_test(self):
        if self.tested_on>datetime.now(timezone(timedelta(hours=5,minutes=30))).date():
            raise ValueError('Inspection date cannot be in the future')
        return self

class Stock(Input):
    model_config={"extra":"forbid","str_strip_whitespace":True}
    expected_version:int=Field(ge=0)
    name:str=Field(min_length=3,max_length=150)
    image_url:str=Field(default='',max_length=500)
    sku:str=Field(min_length=1,max_length=80)
    category:str=Field(min_length=2,max_length=80)
    gst_bps:int|None=Field(default=None,ge=0,le=3000)
    condition:Literal['new','refurbished']='new'
    warranty:str=Field(default='',max_length=500)
    refurbishment_details:str=Field(default='',max_length=1500)
    refurbishment:Refurbishment|None=None
    compatibility:str=Field(min_length=2,max_length=300)
    price_paise:int=Field(gt=0,le=100000000)
    on_hand:int=Field(ge=0,le=100000)
    low_stock:int=Field(default=3,ge=0,le=1000)
    status:Literal['approved','suspended']='approved'
class Decision(Input):
    expected_version:int=Field(ge=1)
    decision:Literal['accept','reject']
    reason:str=Field(default='',max_length=500)
class Code(Input):
    code:str=Field(pattern=r'^\d{6}$')
class Assessment(Input):
    decision:Literal['approved','waived']
    expected_amount_paise:int=Field(ge=0)
    reason:str=Field(min_length=10,max_length=500)

def live_product(u,p,now):
    shop=u.get('shops',p['shop_id']) if p else None
    return bool(p and p.get('status')=='approved' and shop and shop['status']=='approved' and now-p.get('stock_confirmed_at',0)<=86400)

def create_order(u,j,now):
    q=j['proposal'];shop_ids={i['shop_id'] for i in q['items']}
    if len(shop_ids)!=1:fail('ONE_SHOP_PER_ORDER','Request parts from one shop at a time. Additional shops can be requested after this order is installed.')
    for i in q['items']:
        p=u.get('inventory',i['product_id'])
        if not live_product(u,p,now):fail('STALE_INVENTORY','Shop must confirm its stock within the last 24 hours.')
        p['reserved']=p.get('reserved',0)+i['quantity'];p['version']=p.get('version',0)+1;u.put('inventory',p['id'],p)
    order=dict(id=q['id'],job_id=j['id'],visit_id=j['visit_id'],worker_id=j['worker_id'],worker_name=j['worker_name'],shop_id=next(iter(shop_ids)),items=copy.deepcopy(q['items']),amount_paise=q['amount_paise'],status='requested',version=1,created_at=now,expires_at=now+1800)
    u.put('parts_orders',order['id'],order);j.setdefault('parts_order_ids',[]).append(order['id']);event(u,j,'PartsOrderRequested',j['customer_id'],{'order_id':order['id']})

def revoke_order(u,o,j,reason,now,invalidate_stock=False):
    if o['status'] not in ('requested','accepted'):fail('ORDER_LOCKED','Picked-up parts require a return/dispute review; they cannot be silently restocked.')
    for i in o['items']:
        p=u.get('inventory',i['product_id']);p['stock']+=i['quantity'];p['reserved']=max(0,p.get('reserved',0)-i['quantity']);p['version']=p.get('version',0)+1
        if invalidate_stock:p['stock_confirmed_at']=0
        u.put('inventory',p['id'],p)
    o.update(status='cancelled',reason=reason,version=o['version']+1,cancelled_at=now);u.put('parts_orders',o['id'],o)
    advance=u.get('payments',o['id'])
    if advance and advance.get('kind')=='parts' and advance.get('status')=='captured':
        advance.update(allocated=False,recovery='refund_review');u.put('payments',advance['id'],advance)
        from parts_payments import advance_total
        j.update(parts_refund_hold=True,payout_status='held',parts_paid_paise=advance_total(u,j['id']))
        event(u,j,'PartsAdvanceRefundRequired','procurement',{'payment_record_id':advance['id']})
    j['total_paise']-=o['amount_paise'];j['scope_version']+=1;j['scopes'].append({'version':j['scope_version'],'price_paise':j['total_paise'],'credit_paise':o['amount_paise'],'order_id':o['id'],'reason':reason})
    if j.get('proposal',{}).get('id')==o['id']:j['proposal']['status']='rejected'
    if j['state']=='collecting_parts':j['state']='follow_up_required';j['tracking_consent']=False;j.pop('position',None)
    j['version']+=1;event(u,j,'PartsOrderCancelled','procurement',{'order_id':o['id'],'reason':reason});u.put('jobs',j['id'],j)

def pause_timer(j,now):
    if j.get('work_clock_started_at'):j['work_seconds']=j.get('work_seconds',0)+max(0,now-j.pop('work_clock_started_at'))
def resume_timer(j,now):j['work_clock_started_at']=now

def otp_id(kind,j,oid=''):return hashlib.sha256(f'{kind}:{j["id"]}:{j["visit_id"]}:{j.get("worker_id")}:{oid}'.encode()).hexdigest()
def code_for(u,key,now):
    c=u.get('private_otps',key)
    if c and c.get('locked_until',0)>now:fail('OTP_LOCKED','Too many attempts. Wait 15 minutes and try again.',429)
    if c and c.get('used_at'):return {'verified':True}
    if not c or c['expires_at']<=now:
        c=dict(id=key,code=f'{secrets.randbelow(1000000):06d}',expires_at=now+300,attempts=0);u.put('private_otps',key,c)
    return {'code':c['code'],'expires_at':c['expires_at'],'warning':'Share only with the assigned professional physically present. No SMS is sent.'}
def check_code(u,key,code,now):
    c=u.get('private_otps',key)
    if not c or c.get('locked_until',0)>now or c['expires_at']<=now:return 'Code missing, locked or expired. Ask the customer/shop to open a fresh code.'
    if c.get('used_at'):return 'This code was already used.'
    if not hmac.compare_digest(c['code'],code):
        c['attempts']+=1
        if c['attempts']>=5:c['locked_until']=now+900
        u.put('private_otps',key,c);return 'Incorrect code. Five attempts lock verification for 15 minutes.'
    c.update(used_at=now);u.put('private_otps',key,c);return None

def movement(u,j,now):
    if j['state']!='collecting_parts':return
    for oid in j.get('parts_order_ids',[]):
        o=u.get('parts_orders',oid)
        if not o or o['status']!='picked_up' or o.get('return_monitor_ended'):continue
        pos=j.get('position');last=o.get('last_fix');o['last_fix']=copy.deepcopy(pos)
        if not pos or pos['accuracy']>20 or abs(now-pos['captured_at'])>60:
            o.pop('still_since',None);o.pop('still_anchor',None);o['tracking_note']='Accurate location unavailable; no charge for unobserved time.'
        elif at_site(j,now):o['return_monitor_ended']=now
        elif last:
            dt=pos['received_at']-last['received_at'];d=metres(pos,last);low=max(0,d-pos['accuracy']-last['accuracy'])
            if not 10<=dt<=90 or last['accuracy']>20 or d/dt>45:
                o.pop('still_since',None);o.pop('still_anchor',None);o['tracking_note']='Location gap or unreliable movement; interval excluded.'
            elif low/dt>=10/3.6:
                o['return_monitor_ended']=now;o['tracking_note']='Return movement confirmed.'
            else:
                anchor=o.get('still_anchor') or last
                stationary=metres(pos,anchor)+pos['accuracy']+anchor['accuracy']<=35
                if stationary and not o.get('still_since'):
                    o['still_since']=last['received_at'];o['still_anchor']=copy.deepcopy(last)
                if not stationary and not o.get('charging'):
                    o.pop('still_since',None);o.pop('still_anchor',None)
                if o.get('still_since') and pos['received_at']-o['still_since']>=600 and not o.get('charging'):
                    o['charging']=True;event(u,j,'ReturnDelayAssessmentStarted','procurement',{'order_id':oid,'policy':POLICY})
                if o.get('charging'):
                    seconds=max(0,min(dt,pos['received_at']-o.get('still_since',pos['received_at'])-600))
                    o['chargeable_seconds']=o.get('chargeable_seconds',0)+seconds
                    o['assessment_paise']=int(o['chargeable_seconds']//60)*500;o['assessment_status']='review_required'
        u.put('parts_orders',oid,o)

def install(core):
    store=core.operations_store;r=APIRouter(prefix='/operations')
    @r.get('/jobs/{job_id}/market')
    def task_market(job_id:str,radius_km:float=Query(default=6,ge=6,le=8),user=Depends(core.current_user)):
        def read(u):
            j=u.get('jobs',job_id);w=u.get('workers',user['id'])
            if not j or j.get('worker_id')!=user['id'] or not w or w['status']!='approved':fail('NOT_FOUND','Assigned task not found.',404)
            origin=j.get('location')
            if not origin:fail('LOCATION_REQUIRED','This task needs a confirmed work location before finding nearby shops.',409)
            shops={s['id']:(s,metres(origin,s['location'])) for s in u.all('shops') if s.get('status')=='approved' and s.get('location')}
            shops={k:v for k,v in shops.items() if v[1]<=radius_km*1000}
            items=[]
            for p in u.all('inventory'):
                if p['shop_id'] not in shops or not live_product(u,p,time.time()) or p['stock']<=0:continue
                shop,distance=shops[p['shop_id']]
                items.append({**{k:p.get(k) for k in ('id','shop_id','name','sku','category','compatibility','price_paise','stock','version','image_url','condition','warranty','refurbishment_details')},'shop_name':shop['name'],'distance_km':round(distance/1000,2)})
            from rentals import public_listing
            rentals=[]
            for p in u.all('rental_inventory'):
                if p['shop_id'] not in shops:continue
                v=public_listing(u,p)
                if v and v['available_units']>0:rentals.append({**v,'distance_km':round(shops[p['shop_id']][1]/1000,2)})
            return {'items':sorted(items,key=lambda p:(p['distance_km'],p['name'])),'rentals':sorted(rentals,key=lambda p:(p['distance_km'],p['name'])),'radius_km':radius_km,'distance_basis':'work_location','shop_count':len({p['shop_id'] for p in items+rentals})}
        return store.run(read)

    def shop_user(user=Depends(core.current_user)):
        if not user.get('phone_authenticated'):fail('PHONE_OTP_REQUIRED','Use mobile OTP sign-in.',403)
        return user
    def shop(u,user):
        s=next((s for s in u.all('shops') if s['owner_id']==user['id'] and s['status']=='approved'),None)
        if not s:fail('SHOP_APPROVAL_REQUIRED','Your shop must be approved.',403)
        return s
    def job(u,jid,user):
        j=u.get('jobs',jid)
        if not j or user['id'] not in (j['customer_id'],j.get('worker_id')):fail('NOT_FOUND','Task not found.',404)
        return j
    def assigned(u,j,user):
        w=u.get('workers',user['id'])
        if not w or w['status']!='approved':fail('WORKER_APPROVAL_REQUIRED','Worker approval is required.',403)
        if j.get('worker_id')!=user['id'] or not user.get('phone_verified'):fail('ASSIGNED_WORKER_REQUIRED','Assigned phone-verified professional required.',403)
    def near_shop(u,j,o,now):
        s=u.get('shops',o['shop_id'])
        return s and s['status']=='approved' and fresh_position(j,now) and metres(j['position'],s['location'])+j['position']['accuracy']<=100
    @r.get('/shop/inventory')
    def stock_list(user=Depends(shop_user)):
        def read(u):
            s=shop(u,user);return {'items':[p for p in u.all('inventory') if p['shop_id']==s['id']]}
        return store.run(read)
    @r.put('/shop/inventory/{product_id}')
    def stock_write(product_id:str,body:Stock,user=Depends(shop_user)):
        if not 1<=len(product_id)<=100 or not all(c.isalnum() or c in '-_' for c in product_id):fail('INVALID_ID','Invalid product ID.',422)
        def save(u):
            s=shop(u,user);p=u.get('inventory',product_id)
            if p and p['shop_id']!=s['id']:fail('NOT_FOUND','Product not found.',404)
            if (p or {}).get('version',0)!=body.expected_version:fail('STOCK_CHANGED','Refresh stock before saving.')
            from workspace import validate_media
            validate_media(u,body.image_url,s['id'])
            reserved=(p or {}).get('reserved',0)
            if body.on_hand<reserved:fail('RESERVED_STOCK','Physical count is below reserved quantity. Reject pending orders or contact support before adjusting.')
            if any(x['id']!=product_id and x['shop_id']==s['id'] and x.get('sku','').casefold()==body.sku.casefold() for x in u.all('inventory')):fail('SKU_EXISTS','Edit the existing SKU instead of adding a duplicate.')
            if body.condition=='refurbished' and not body.refurbishment:fail('DETAILS_REQUIRED','Complete the refurbished condition, inspection, repairs, warranty and return details.',422)
            if body.condition=='new' and body.refurbishment:fail('INVALID_CONDITION','Refurbishment details belong in the Refurbished inventory section.',422)
            item=dict(body.model_dump(mode='json',exclude={'expected_version','on_hand'}),id=product_id,shop_id=s['id'],stock=body.on_hand-reserved,reserved=reserved,version=body.expected_version+1,stock_confirmed_at=time.time())
            u.put('inventory',product_id,item);audit(u,'ShopStockAdjusted',user['id'],product_id=product_id,old_available=(p or {}).get('stock',0),available=item['stock'],reserved=reserved);return item
        return store.run(save)
    @r.get('/shop/purchase-orders')
    def orders(user=Depends(shop_user)):
        def read(u):
            s=shop(u,user);rows=[];now=time.time()
            for o in u.all('parts_orders'):
                if o['shop_id']!=s['id']:continue
                item={k:v for k,v in o.items() if k not in ('last_fix','still_anchor','still_since','chargeable_seconds')};j=u.get('jobs',o['job_id'])
                if o['status']=='accepted' and j.get('worker_id')==o['worker_id'] and j['state']=='collecting_parts' and j.get('tracking_consent') and fresh_position(j,now):
                    item['worker_location']={k:j['position'][k] for k in ('lat','lng','accuracy','received_at')};audit(u,'ShopPickupTrackingViewed',user['id'],order_id=o['id'])
                item['pickup_nearby']=bool(o['status']=='accepted' and j['state']=='collecting_parts' and near_shop(u,j,o,now));rows.append(item)
            return {'orders':rows}
        return store.run(read)
    @r.post('/shop/purchase-orders/{oid}/decision')
    def decision(oid:str,body:Decision,user=Depends(shop_user)):
        def save(u):
            s=shop(u,user);o=u.get('parts_orders',oid)
            if not o or o['shop_id']!=s['id']:fail('NOT_FOUND','Order not found.',404)
            if o['version']!=body.expected_version or o['status']!='requested':fail('ORDER_CHANGED','Refresh the order before deciding.')
            j=u.get('jobs',o['job_id']);now=time.time()
            if o['worker_id']!=j.get('worker_id') or o['visit_id']!=j['visit_id'] or j['state']!='in_progress':fail('ASSIGNMENT_CHANGED','The assignment changed. Refresh after the reservation sweep.')
            if body.decision=='reject':revoke_order(u,o,j,body.reason or 'Shop cannot supply these parts',now,True)
            else:
                if o['expires_at']<=now:fail('ORDER_EXPIRED','Reservation expired. Refresh after the inventory sweep.')
                o.update(status='accepted',version=o['version']+1,accepted_at=now,expires_at=now+7200);u.put('parts_orders',oid,o);j['version']+=1;event(u,j,'ShopOrderAccepted',user['id'],{'order_id':oid});u.put('jobs',j['id'],j)
            return {'status':o['status']}
        return store.run(save)
    @r.get('/shop/purchase-orders/{oid}/otp')
    def pickup_code(oid:str,user=Depends(shop_user)):
        def read(u):
            s=shop(u,user);o=u.get('parts_orders',oid)
            if not o or o['shop_id']!=s['id']:fail('NOT_FOUND','Order not found.',404)
            j=u.get('jobs',o['job_id']);now=time.time()
            if o['status']!='accepted' or o['expires_at']<=now or j['state']!='collecting_parts' or j['worker_id']!=o['worker_id'] or not near_shop(u,j,o,now):fail('PICKUP_NOT_READY','Assigned professional must share an accurate location within 100 m of your shop.')
            audit(u,'PickupCodeViewed',user['id'],order_id=oid);return code_for(u,otp_id('pickup',j,oid),now)
        return store.run(read)
    @r.get('/jobs/{jid}/arrival-code')
    def arrival_code(jid:str,user=Depends(core.current_user)):
        def read(u):
            j=job(u,jid,user);now=time.time()
            if user['id'] != j['customer_id']:fail('CUSTOMER_ONLY','Only this customer can view the arrival code.',403)
            if j['state'] not in ('arrived', 'in_progress'):fail('NOT_NEARBY','The assigned professional has not arrived at the site yet.')
            return code_for(u,otp_id('arrival',j),now)
        return store.run(read)
    @r.post('/jobs/{jid}/verify-arrival')
    def arrival_verify(jid:str,body:Code,user=Depends(core.current_user)):
        def save(u):
            j=job(u,jid,user);assigned(u,j,user);now=time.time()
            if j.get('arrival_verified_visit')==j['visit_id']:return {'status':'verified'}
            if j['state'] not in ('arrived', 'in_progress'):fail('NOT_AT_SITE','Job must be in arrived stage before verifying arrival.')
            err=check_code(u,otp_id('arrival',j),body.code,now)
            if err:return {'error':err}
            j['arrival_verified_visit']=j['visit_id'];j.update(verified_arrived_at=now,verified_arrival_starts_epoch=j.get('starts_epoch'));j['version']+=1;event(u,j,'CustomerArrivalVerified',user['id']);u.put('jobs',jid,j);return {'status':'verified'}
        result=store.run(save)
        if result.get('error'):fail('INVALID_OTP',result['error'],422)
        return result
    @r.post('/jobs/{jid}/purchase-orders/{oid}/verify-pickup')
    def pickup(jid:str,oid:str,body:Code,user=Depends(core.current_user)):
        def save(u):
            j=job(u,jid,user);assigned(u,j,user);o=u.get('parts_orders',oid);now=time.time()
            if not o or o['job_id']!=jid or o['worker_id']!=user['id']:fail('NOT_FOUND','Order not found.',404)
            if o['status']=='picked_up':return {'status':'picked_up'}
            if o['status']!='accepted' or o['expires_at']<=now or j['state']!='collecting_parts' or o['visit_id']!=j['visit_id'] or not near_shop(u,j,o,now):fail('PICKUP_NOT_READY','Accepted order and accurate location at this shop are required.')
            err=check_code(u,otp_id('pickup',j,oid),body.code,now)
            if err:return {'error':err}
            for i in o['items']:
                p=u.get('inventory',i['product_id']);p['reserved']-=i['quantity'];p['version']=p.get('version',0)+1;u.put('inventory',p['id'],p)
            o.update(status='picked_up',version=o['version']+1,picked_up_at=now,last_fix=copy.deepcopy(j['position']),bill_id='PARTS-'+o['id'],assessment_paise=0,assessment_status='not_assessed');u.put('parts_orders',oid,o)
            j['version']+=1;event(u,j,'VerifiedShopPickupCompleted',user['id'],{'order_id':oid,'bill_id':o['bill_id']});u.put('jobs',jid,j);return {'status':'picked_up','bill_id':o['bill_id']}
        result=store.run(save)
        if result.get('error'):fail('INVALID_OTP',result['error'],422)
        return result
    @r.get('/jobs/{jid}/procurement')
    def task_orders(jid:str,user=Depends(core.current_user)):
        def read(u):
            j=job(u,jid,user);orders=[u.get('parts_orders',oid) for oid in j.get('parts_order_ids',[])];now=time.time()
            return {'arrival_verified':j.get('arrival_verified_visit')==j['visit_id'],'work_seconds':j.get('work_seconds',0)+(max(0,now-j['work_clock_started_at']) if j.get('work_clock_started_at') else 0),'timer_running':bool(j.get('work_clock_started_at')),'orders':[{k:v for k,v in o.items() if k not in ('last_fix','still_anchor','still_since','chargeable_seconds')} for o in orders if o]}
        return store.run(read)
    @r.get('/shop/payables')
    def payables(user=Depends(shop_user)):
        from shop_payouts import active
        def read(u):
            sid=shop(u,user)['id'];bank=u.get('shop_banks',sid) or {}
            return {'payables':[p for p in u.all('shop_payables') if p['shop_id']==sid], 'provider_enabled':active(),'bank_status':bank.get('status','not_verified'),'message':'No agent payment. Weekly release requires completed work, captured customer payment, an undisputed posted allocation, an approved shop and provider-verified bank account.'}
        return store.run(read)
    @r.get('/admin/procurement')
    def admin_queue(admin=Depends(core.operator)):
        def read(u):
            audit(u,'ProcurementReviewAccessed',admin['id'])
            return {'orders':u.all('parts_orders'),'payables':u.all('shop_payables')}
        return store.run(read)
    @r.post('/admin/purchase-orders/{oid}/assessment')
    def assess(oid:str,body:Assessment,admin=Depends(core.operator)):
        def save(u):
            o=u.get('parts_orders',oid)
            if not o:fail('NOT_FOUND','Order not found.',404)
            if o.get('assessment_paise',0)!=body.expected_amount_paise or (not o.get('return_monitor_ended') and u.get('jobs',o['job_id'])['state']=='collecting_parts'):fail('ASSESSMENT_CHANGED','Wait until return monitoring ends and refresh the amount.')
            j=u.get('jobs',o['job_id'])
            if u.get('payouts',j['id']) or u.get('journals',j['id']):fail('FINANCIAL_ADJUSTMENT_REQUIRED','Existing payout requires a separate financial adjustment.')
            o.update(assessment_status=body.decision,assessment_reason=body.reason);u.put('parts_orders',oid,o)
            settlement=u.get('settlements',j['id'])
            if settlement:settlement['invalidated']=True;u.put('settlements',j['id'],settlement)
            audit(u,'PickupReturnAssessmentReviewed',admin['id'],order_id=oid,decision=body.model_dump());return {'status':body.decision}
        return store.run(save)
    def sweep():
        def save(u):
            now=time.time();count=0
            for o in u.all('parts_orders'):
                j=u.get('jobs',o['job_id'])
                if o['status'] in ('requested','accepted') and (o['expires_at']<=now or j['state'] in ('cancelled','stop_requested') or j.get('worker_id')!=o['worker_id'] or j['visit_id']!=o['visit_id']):revoke_order(u,o,j,'Reservation expired or assignment changed',now);count+=1
                if o['status']=='picked_up':
                    eligible=j['state']=='completed' and j['payment_status']=='verified' and not j.get('financial_hold') and not j.get('allocation_review_required')
                    old=u.get('shop_payables',o['id']);first=(old or {}).get('eligible_at') or (now if eligible else None)
                    due=None
                    if first:
                        local=datetime.fromtimestamp(first,timezone(timedelta(hours=5,minutes=30)))
                        due=(local+timedelta(days=7-local.weekday())).replace(hour=0,minute=0,second=0,microsecond=0).timestamp()
                    p=dict(id=o['id'],order_id=o['id'],job_id=j['id'],shop_id=o['shop_id'],amount_paise=o['amount_paise'],eligible_at=first,weekly_due_at=due,status='eligible_for_weekly_review' if eligible else 'held_until_completed_paid_undisputed',transfer_status='not_sent')
                    if old and old.get('batch_id'):
                        p.update(batch_id=old['batch_id'],transfer_status=old.get('transfer_status','reserved'),status=old['status'] if eligible else 'recovery_review_required')
                    u.put('shop_payables',o['id'],p)
            return {'expired_orders':count}
        return store.run(save)
    core.procurement_tick=sweep;core.app.include_router(r)
