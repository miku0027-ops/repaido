"""Paid-profile day hiring. Fresh acceptance GPS -> real route -> customer price approval.
Unknown provider outcomes never create a second order or a fabricated paid entitlement.
"""
import copy,hashlib,json,os,time,uuid,urllib.request
from datetime import datetime,timezone
from typing import Literal
from fastapi import APIRouter,Depends
from pydantic import Field
from operations import Input,Pin,Position,fail,metres,event
from integrations import audit,razorpay,enabled,configured,snapshot_policy
from worker_records import public_profile

DEFAULT={'version':'hire-v1','enabled':False,'base_paise':49900,'gst_bps':None,'travel_paise_per_km':1000,'minimum_travel_paise':2000,'day_hours':None,'membership_paise':None,'membership_days':30,'radius_buffer_bps':1500,'response_seconds':300,'rematch_bonus_bps':1000,'terms':'','missed_response_policy':'Review required; no automatic monetary deduction.'}
class Policy(Input):
    version:str=Field(min_length=3,max_length=80)
    enabled:bool=False
    base_paise:Literal[49900]=49900
    gst_bps:int=Field(ge=0,le=3000)
    travel_paise_per_km:int=Field(gt=0,le=100000)
    minimum_travel_paise:int=Field(ge=0,le=100000)
    day_hours:int=Field(ge=1,le=12)
    membership_paise:int=Field(gt=0,le=10000000)
    membership_days:int=Field(ge=1,le=365)
    radius_buffer_bps:int=Field(default=1500,ge=1000,le=1500)
    response_seconds:Literal[300]=300
    rematch_bonus_bps:Literal[1000]=1000
    terms:str=Field(min_length=30,max_length=4000)
    missed_response_policy:Literal['Review required; no automatic monetary deduction.']='Review required; no automatic monetary deduction.'
class Area(Input):
    location:Pin
    radius_km:float=Field(default=10,gt=0,le=50)
    category:str=''
    role:Literal['all','technician','specialist']='all'
    min_rating:float=Field(default=0,ge=0,le=5)
    sort:Literal['recommended','rating','distance','experience']='recommended'
    query:str=Field(default='',max_length=100)
    allow_buffer:bool=True
class MemberConsent(Input):
    version:str
    radius_km:float=Field(gt=0,le=50)
    consent:Literal[True]
class HireRequest(Input):
    coupon_code:str|None=Field(default=None,max_length=30)
    worker_id:str
    category:str
    location:Pin
    radius_km:float=Field(default=10,gt=0,le=50)
    allow_buffer:bool=True
    address:str=Field(min_length=10,max_length=500)
    city:str
    phone:str=Field(pattern=r'^\+?[0-9]{10,15}$')
    starts_at:str
    notes:str=Field(min_length=10,max_length=1000)
    policy_version:str
    request_id:str=Field(min_length=16,max_length=100)
class Decision(Input):
    action:Literal['accept','decline','wait','rematch','confirm','cancel']
    expected_version:int=Field(ge=1)
    position:Position|None=None

def policy(u):return u.get('hire_policy','current') or DEFAULT
def paid(u,wid):
    m=u.get('hire_memberships',wid) or {}
    return m.get('status')=='active' and m.get('expires_at',0)>time.time()
# Fixed campaign window: three calendar months in India; never renews on login.
FREE_START=datetime.fromisoformat('2026-09-29T00:00:00+05:30').timestamp()
FREE_END=datetime.fromisoformat('2026-12-29T00:00:00+05:30').timestamp()
def free_listing():return FREE_START<=time.time()<FREE_END
def listing_eligible(u,wid):
    entitlement=u.get('partner_entitlements',wid) or {}
    return free_listing() or entitlement.get('starts_at',0)<=time.time()<entitlement.get('ends_at',0) or paid(u,wid)
def listing_offer():return {'active':free_listing(),'starts_at':FREE_START,'ends_at':FREE_END}
def worker_listing_offer(u,wid):
    e=u.get('partner_entitlements',wid) or {}
    if e.get('starts_at',0)<=time.time()<e.get('ends_at',0):return {'active':True,'starts_at':e['starts_at'],'ends_at':e['ends_at'],'earned':True}
    return listing_offer()
def candidates(u,area,exclude=(),request_id=None):
    now=time.time();p=policy(u);out=[]
    busy={j.get('worker_id') for j in u.all('jobs') if j['state'] not in ('completed','cancelled','searching')}
    busy|={h.get('worker_id') for h in u.all('hires') if h['id']!=request_id and h['state'] in ('offered','awaiting_choice','quoting','quoted')}
    for w in u.all('workers'):
        m=u.get('hire_memberships',w['id']) or {};pos=w.get('position')
        if w['id'] in exclude or w['id'] in busy or w['status']!='approved' or not listing_eligible(u,w['id']) or not w.get('online') or not pos or not 0<=now-pos.get('received_at',0)<=300:continue
        if m.get('policy_version')!=p['version'] or (area.category and area.category not in w['categories']) or (area.role!='all' and w['role']!=area.role):continue
        distance=metres(area.location.model_dump(),pos)
        limit=min(area.radius_km,m.get('radius_km',w['radius_km']))*(1+p['radius_buffer_bps']/10000 if area.allow_buffer else 1)
        if distance+pos.get('accuracy',0)>limit*1000:continue
        profile=public_profile(u,w)
        if area.min_rating and (profile['rating'] or 0)<area.min_rating:continue
        if area.query and area.query.casefold() not in ' '.join([w['name'],*w['skills'],*w['categories'],*profile['specialties']]).casefold():continue
        profile.update(distance_km=round(distance/1000,1),outside_preferred_radius=distance>area.radius_km*1000,zone=w['city'],premium=True)
        out.append(profile)
    keys={'distance':lambda w:(w['distance_km'],w['id']),'rating':lambda w:(-(w['rating'] or 0),-w['review_count'],w['distance_km']),'experience':lambda w:(-(w['experience_years'] or 0),w['distance_km']),'recommended':lambda w:(-((w['rating'] or 0)*w['review_count']/(w['review_count']+5)),-(w['completed_tasks'] or 0),w['distance_km'])}
    return sorted(out,key=keys[area.sort])[:40]

def route_metres(origin,destination):
    key=os.getenv('GOOGLE_ROUTES_API_KEY')
    if not key:fail('ROUTING_UNAVAILABLE','Driving-distance quotes are unavailable. Retry later; no booking or charge was confirmed.',503)
    point=lambda p:{'location':{'latLng':{'latitude':p['lat'],'longitude':p['lng']}}}
    req=urllib.request.Request('https://routes.googleapis.com/directions/v2:computeRoutes',data=json.dumps({'origin':point(origin),'destination':point(destination),'travelMode':'DRIVE','routingPreference':'TRAFFIC_UNAWARE'}).encode(),headers={'Content-Type':'application/json','X-Goog-Api-Key':key,'X-Goog-FieldMask':'routes.distanceMeters'})
    try:
        with urllib.request.urlopen(req,timeout=15) as r:distance=json.load(r)['routes'][0]['distanceMeters']
        if not isinstance(distance,int) or not 0<=distance<=500000:raise ValueError()
        return distance
    except Exception:fail('ROUTE_FAILED','A driving route could not be confirmed. Retry with a fresh location.',503)

def notify(u,h,uid,title,body,urgent=False):
    nid=hashlib.sha256(f"hire:{h['id']}:{h['version']}:{uid}:{title}".encode()).hexdigest()
    n=dict(id=nid,user_id=uid,hire_id=h['id'],destination='hire',title=title,body=body,created_at=time.time(),alert_kind='hiring' if urgent else 'update',offer_expires_at=h.get('offer_expires_at',0))
    u.put('notifications',nid,n)
    for d in u.all('devices'):
        if d['user_id']==uid and d['active']:
            did=hashlib.sha256((nid+d['id']).encode()).hexdigest();u.put('deliveries',did,dict(id=did,notification_id=nid,device_id=d['id'],status='pending'))

def safe(h,uid):
    fields=('id','version','state','worker_id','worker_name','category','starts_at','city','notes','policy','offer_expires_at','quote','quote_expires_at','job_id','bonus_paise','assessment','wait_used','created_at')
    return {k:copy.deepcopy(h[k]) for k in fields if k in h}

def expire(u,h):
    now=time.time()
    if h['state']=='offered' and now>=h['offer_expires_at']:
        h.update(state='awaiting_choice',version=h['version']+1)
        aid=f"{h['id']}:{h['worker_id']}"
        a=dict(id=aid,hire_id=h['id'],worker_id=h['worker_id'],code='HIRE_RESPONSE_MISSED',status='review_required',assessed_at=now,deadline=h['offer_expires_at'],deduction_paise=0)
        u.put('hire_assessments',aid,a);h['assessment']=a
        notify(u,h,h['customer_id'],'Hire request needs your choice','No response within five minutes. Wait five more minutes, choose another professional, or cancel.')
        notify(u,h,h['worker_id'],'Missed hire response','The response deadline passed. An assessment is recorded for review; no deduction has been applied.')
        u.put('hires',h['id'],h)
    elif h['state']=='quoted' and now>=h.get('quote_expires_at',0):
        h.update(state='awaiting_choice',version=h['version']+1);h.pop('quote',None);u.put('hires',h['id'],h)
    elif h['state']=='quoting' and now>=h.get('quote_lease_until',0):
        h.update(state='offered',version=h['version']+1);u.put('hires',h['id'],h)
    return h

def install(core):
    r=APIRouter(prefix='/operations',tags=['Day hiring']);store=core.operations_store
    def worker(u,user):
        w=u.get('workers',user['id'])
        if not w or w['status']!='approved' or not user.get('phone_verified'):fail('APPROVAL_REQUIRED','An approved phone-verified worker account is required.',403)
        return w
    def available(u):
        p=policy(u)
        if not p['enabled']:fail('HIRE_NOT_READY','Day hiring is awaiting pricing and policy activation. Regular service booking is still available.',503)
        return p
    @r.get('/hiring/policy')
    def public_policy():
        p=store.run(policy);return {**p,'listing_offer':listing_offer(),'routing_ready':bool(os.getenv('GOOGLE_ROUTES_API_KEY')),'payments_ready':enabled('REPAIDO_PAYMENTS_ENABLED') and configured('RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET')}
    @r.put('/admin/hiring-policy')
    def update_policy(body:Policy,admin=Depends(core.operator)):
        def save(u):
            existing=u.get('hire_policy_versions',body.version)
            if existing and existing!=body.model_dump():fail('IMMUTABLE_VERSION','Use a new version for changed terms.')
            if body.enabled and not os.getenv('GOOGLE_ROUTES_API_KEY'):fail('ROUTING_REQUIRED','Connect the server-side route provider before activation.')
            u.put('hire_policy_versions',body.version,body.model_dump());u.put('hire_policy','current',body.model_dump());audit(u,'HiringPolicyUpdated',admin['id'],version=body.version);return body.model_dump()
        return store.run(save)
    @r.post('/hiring/search')
    def search(body:Area):return store.run(lambda u:{'professionals':candidates(u,body),'distance_type':'straight_line','radius_buffer_percent':policy(u)['radius_buffer_bps']/100,'ranking':'Launch offers, earned listing or paid membership control listing eligibility, not review scores. Match, verified-review confidence, completed work, then distance.'})
    @r.get('/worker/hire-membership')
    def membership(user=Depends(core.current_user)):
        def read(u):
            worker(u,user);return {'membership':u.get('hire_memberships',user['id']),'policy':{**policy(u),'listing_offer':worker_listing_offer(u,user['id'])}}
        return store.run(read)
    @r.post('/worker/hire-membership/accept')
    def consent(body:MemberConsent,user=Depends(core.current_user)):
        def save(u):
            worker(u,user);p=policy(u) if listing_eligible(u,user['id']) else available(u)
            if body.version!=p['version']:fail('POLICY_CHANGED','Review the latest Hire terms.')
            m=u.get('hire_memberships',user['id']) or dict(id=user['id'],status='unpaid')
            m.update(policy_version=p['version'],radius_km=body.radius_km,consented_at=time.time());u.put('hire_memberships',m['id'],m);return m
        return store.run(save)
    @r.post('/worker/hire-membership/payment-order')
    def member_order(user=Depends(core.current_user)):
        if free_listing():fail('FREE_LISTING_ACTIVE','Listing is free until 29 December 2026. No membership payment is required.')
        if not enabled('REPAIDO_PAYMENTS_ENABLED') or not configured('RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET'):fail('PAYMENT_UNAVAILABLE','Premium checkout is not enabled. No money was moved.',503)
        def reserve(u):
            worker(u,user);p=available(u);m=u.get('hire_memberships',user['id']) or {}
            if listing_eligible(u,user['id']):fail('ALREADY_ACTIVE','Your listing is already active. No membership payment is required.')
            if m.get('policy_version')!=p['version']:fail('TERMS_REQUIRED','Accept the current Hire terms and radius first.')
            key=f"{user['id']}:{m.get('expires_at',0)}";old=u.get('hire_fees',key)
            if old:return old,False
            fee=dict(id=key,worker_id=user['id'],amount=p['membership_paise'],receipt='hp_'+uuid.uuid4().hex[:30],status='creating',created_at=time.time(),days=p['membership_days'],policy_version=p['version'])
            u.put('hire_fees',key,fee);return fee,True
        fee,new=store.run(reserve)
        if new:
            result=razorpay('orders',{'amount':fee['amount'],'currency':'INR','receipt':fee['receipt'],'notes':{'hire_membership':user['id']}})
            def attach(u):
                f=u.get('hire_fees',fee['id']);f.update(order_id=result['id'],status='created');u.put('hire_fees',f['id'],f);return f
            fee=store.run(attach)
        if not fee.get('order_id'):fail('RECONCILING','The previous payment order is being checked. Use Check payment; no duplicate will be created.')
        return dict(key_id=os.environ['RAZORPAY_KEY_ID'],order_id=fee['order_id'],amount=fee['amount'],currency='INR')
    def reconcile_fee(fee):
        if not fee.get('order_id'):
            orders=[o for o in razorpay('orders?receipt='+fee['receipt']).get('items',[]) if o.get('receipt')==fee['receipt'] and o.get('amount')==fee['amount'] and o.get('currency')=='INR']
            if len(orders)!=1:return
            fee['order_id']=orders[0]['id'];store.run(lambda u:u.put('hire_fees',fee['id'],fee))
        payments=razorpay('orders/'+fee['order_id']+'/payments').get('items',[])
        for pay in payments:
            if pay.get('order_id')!=fee['order_id'] or pay.get('amount')!=fee['amount'] or pay.get('currency')!='INR':continue
            if pay.get('status') not in ('captured','refunded'):continue
            def apply(u):
                f=u.get('hire_fees',fee['id']);m=u.get('hire_memberships',fee['worker_id'])
                if pay.get('amount_refunded',0) or pay['status']=='refunded':
                    f['status']='refunded'
                    if m and m.get('fee_id')==fee['id']:m['status']='refunded'
                elif f['status']!='refunded' and pay.get('captured') is True:
                    if f.get('payment_id') and f['payment_id']!=pay['id']:fail('DUPLICATE_PAYMENT','A second payment needs support review.')
                    if f['status']!='paid':
                        f.update(status='paid',payment_id=pay['id'],paid_at=time.time());m.update(status='active',expires_at=time.time()+fee['days']*86400,fee_id=fee['id'])
                        audit(u,'HireMembershipPaid','razorpay',worker_id=fee['worker_id'],payment_id=pay['id'])
                f['checked_at']=time.time();u.put('hire_fees',f['id'],f)
                if m:u.put('hire_memberships',m['id'],m)
            store.run(apply)
    @r.post('/worker/hire-membership/payment-check')
    def member_check(user=Depends(core.current_user)):
        store.run(lambda u:worker(u,user))
        fees=store.run(lambda u:[f for f in u.all('hire_fees') if f['worker_id']==user['id']])
        for f in fees:reconcile_fee(f)
        return membership(user)
    @r.post('/hiring/requests',status_code=201)
    def request(body:HireRequest,user=Depends(core.current_user)):
        try:
            start=datetime.fromisoformat(body.starts_at)
            if start.tzinfo is None or not time.time()+1800<start.timestamp()<time.time()+30*86400:raise ValueError()
        except ValueError:fail('INVALID_TIME','Choose a visit at least 30 minutes and at most 30 days ahead.',422)
        if body.city not in core.CITIES:fail('COVERAGE','This city is not currently served.',422)
        key=hashlib.sha256((user['id']+body.request_id).encode()).hexdigest();fingerprint=hashlib.sha256(body.model_dump_json().encode()).hexdigest()
        def save(u):
            old=u.get('hire_keys',key)
            if old:
                if old['fingerprint']!=fingerprint:fail('KEY_REUSED','This retry key belongs to another request.')
                return safe(u.get('hires',old['id']),user['id'])
            p=available(u)
            if p['version']!=body.policy_version:fail('POLICY_CHANGED','Review the current hiring terms.')
            if len([h for h in u.all('hires') if h['customer_id']==user['id'] and h['state'] not in ('booked','cancelled')])>=3:fail('OPEN_REQUESTS','Finish or cancel an existing hire request first.')
            eligible=candidates(u,Area(location=body.location,radius_km=body.radius_km,category=body.category,allow_buffer=body.allow_buffer))
            chosen=next((w for w in eligible if w['id']==body.worker_id),None)
            if not chosen:fail('NO_LONGER_AVAILABLE','This professional is no longer eligible or available. Refresh results.')
            h={**body.model_dump(), 'id':str(uuid.uuid4()),'customer_id':user['id'],'customer_name':user.get('name','Customer'),'worker_name':chosen['name'],'policy':copy.deepcopy(p),'state':'offered','version':1,'offer_expires_at':time.time()+300,'attempted_workers':[body.worker_id],'created_at':time.time(),'bonus_paise':0}
            if body.coupon_code:
                from coupons import reserve
                h['coupon']=reserve(u,user['id'],body.coupon_code,'hire',p['base_paise'],'hire:'+h['id'])
            u.put('hires',h['id'],h);u.put('hire_keys',key,{'id':h['id'],'fingerprint':fingerprint});notify(u,h,body.worker_id,'New day-hire request','Respond within five minutes. Review scope and earnings before accepting.',True);return safe(h,user['id'])
        return store.run(save)
    @r.get('/hiring/requests')
    def requests(user=Depends(core.current_user)):
        def read(u):
            rows=[expire(u,h) for h in u.all('hires') if user['id'] in (h['customer_id'],h['worker_id'])]
            return {'requests':[safe(h,user['id']) for h in sorted(rows,key=lambda h:h['created_at'],reverse=True)]}
        return store.run(read)
    @r.post('/hiring/requests/{hid}/decision')
    def decide(hid:str,body:Decision,user=Depends(core.current_user)):
        def access(u):
            h=u.get('hires',hid)
            if not h or user['id'] not in (h['customer_id'],h['worker_id']):fail('NOT_FOUND','Hire request unavailable.',404)
            return h
        # Persist elapsed deadlines even when the subsequent stale command is rejected.
        store.run(lambda u:expire(u,access(u)))
        def save(u):
            h=access(u);now=time.time();a=body.action
            if h['state']=='booked' and a=='confirm' and user['id']==h['customer_id']:return h
            if h['version']!=body.expected_version:fail('STALE_VERSION','Request changed. Refresh and review it.')
            customer=user['id']==h['customer_id']
            if customer and a not in ('wait','rematch','confirm','cancel') or not customer and a not in ('accept','decline'):fail('FORBIDDEN','This action is not available to your role.',403)
            if a=='cancel':
                if h['state']=='booked':fail('BOOKING_CREATED','Manage cancellation from the confirmed booking.')
                h['state']='cancelled'
            elif a=='decline':
                if h['state']!='offered':fail('STATE_CHANGED','This request is no longer offered.')
                h['state']='awaiting_choice';notify(u,h,h['customer_id'],'Professional declined','Choose another professional or cancel. No booking was confirmed.')
            elif a=='wait':
                if h['state']!='awaiting_choice' or h.get('wait_used'):fail('WAIT_UNAVAILABLE','Choose another professional or cancel.')
                h.update(state='offered',wait_used=True,offer_expires_at=now+300);notify(u,h,h['worker_id'],'Customer extended the response window','Please respond within five minutes.',True)
            elif a=='rematch':
                if h['state']!='awaiting_choice':fail('CHOICE_NOT_DUE','Wait for the current response window or cancel.')
                area=Area(location=h['location'],radius_km=h['radius_km'],category=h['category'],allow_buffer=h['allow_buffer'])
                rows=candidates(u,area,exclude=h['attempted_workers'],request_id=h['id'])
                if not rows:fail('NO_MATCH','No alternative is available within your agreed radius. Retry later or cancel.')
                w=rows[0];h.update(worker_id=w['id'],worker_name=w['name'],state='offered',offer_expires_at=now+300,bonus_paise=h['policy']['base_paise']//10,wait_used=False)
                h['attempted_workers'].append(w['id']);notify(u,h,w['id'],'Priority reassignment · 10% base-fee bonus','A customer is waiting after an earlier request. Company-funded bonus applies after completed, paid work.',True)
            elif a=='accept':
                worker(u,user)
                if h['state']!='offered' or now>=h['offer_expires_at']:fail('EXPIRED','The response window ended.')
                pos=body.position
                if not pos or not -10<=now-pos.captured_at<=120 or pos.accuracy>50:fail('FRESH_LOCATION','A precise current location is required at acceptance.',422)
                m=u.get('hire_memberships',user['id']) or {}
                if not listing_eligible(u,user['id']) or m.get('policy_version')!=h['policy']['version']:fail('MEMBERSHIP_REQUIRED','Your paid membership or accepted policy is no longer valid.')
                limit=min(h['radius_km'],m['radius_km'])*(1+h['policy']['radius_buffer_bps']/10000 if h['allow_buffer'] else 1)*1000
                if metres(pos.model_dump(),h['location'])+pos.accuracy>limit:fail('OUTSIDE_RADIUS','Your current location is outside the agreed hiring range.')
                if any(j.get('worker_id')==user['id'] and j['state'] not in ('completed','cancelled','searching') for j in u.all('jobs')):fail('BUSY','Finish your active task before accepting a day hire.')
                h.update(state='quoting',accepted_position=pos.model_dump(),quote_lease_until=now+120)
            elif a=='confirm':
                if h['state']!='quoted' or now>=h['quote_expires_at']:fail('QUOTE_EXPIRED','Ask the professional to refresh the route quote.')
                w=u.get('workers',h['worker_id'])
                if not w or w['status']!='approved' or any(j.get('worker_id')==w['id'] and j['state'] not in ('completed','cancelled','searching') for j in u.all('jobs')):fail('CAPACITY_CHANGED','Professional availability changed. Cancel or choose another.')
                q=h['quote'];jid=str(uuid.uuid4());p=h['policy'];start=datetime.fromisoformat(h['starts_at'])
                from home_plans import conflict
                if conflict(u,w['id'],start.timestamp(),480):fail('CAPACITY_CHANGED','This agent has an overlapping project or home visit. Choose another time or professional.')
                j=dict(id=jid,booking_id=jid,work_order_id=str(uuid.uuid4()),visit_id=str(uuid.uuid4()),procurement_version=3,customer_id=h['customer_id'],customer_name=h['customer_name'],worker_id=w['id'],worker_name=w['name'],worker_role=w['role'],service_id='day-hire-'+h['category'],service_name=h['category']+' · day hire',category=h['category'],city=h['city'],address=h['address'],phone=h['phone'],location=h['location'],notes=h['notes'],starts_at=start.isoformat(),starts_epoch=start.timestamp(),state='accepted',version=1,scope_version=1,base_price_paise=p['base_paise'],total_paise=q['total_paise'],settlement_base_paise=p['base_paise'],hire_travel_paise=q['travel_paise'],hire_gst_paise=q['gst_paise'],hire_bonus_paise=h['bonus_paise'],hire_id=h['id'],hire_quote=q,hire_origin=h['accepted_position'],payment_status='pay_after_service',payout_status='held',events=[],penalties=[],scopes=[{'version':1,'price_paise':q['total_paise'],'accepted_by':user['id'],'accepted_at':now}],created_at=now,accepted_at=now,reminder_at=max(now,start.timestamp()-7200),attempted_workers=[w['id']],terms={'version':p['version'],'reminder_grace_seconds':600,'missed_reminder_current_percent':10,'late_departure_percent':20,'free_cancel_before_start':True},service_terms={'version':1,'text':p['terms']})
                if h.get("coupon"):
                    from coupons import attach_job
                    attach_job(j,h["coupon"])
                snapshot_policy(u,j,w)
                ep=j.get('settlement_policy')
                if not ep or p['base_paise']*(10000-ep['worker_share_bps']-ep.get('bonus_reserve_bps',0))//10000<h['bonus_paise']:fail('EARNINGS_POLICY','Agent must accept an earnings policy that funds the promised bonus before confirmation.')
                event(u,j,'HireBookingConfirmed',user['id']);u.put('jobs',jid,j);h.update(state='booked',job_id=jid)
            h['version']+=1;u.put('hires',h['id'],h);return h
        h=store.run(save)
        if h['state']=='quoting' and body.action=='accept':
            try:
                outbound=route_metres(h['accepted_position'],h['location']);inbound=route_metres(h['location'],h['accepted_position'])
            except Exception:
                def recover(u):
                    old=u.get('hires',hid)
                    if old['version']==h['version'] and old['state']=='quoting':old.update(state='offered',version=old['version']+1);u.put('hires',hid,old)
                store.run(recover);raise
            def quote(u):
                row=u.get('hires',hid)
                if row['version']!=h['version'] or row['state']!='quoting':fail('REQUEST_CHANGED','Request changed during route calculation. Refresh.')
                p=row['policy'];travel=max(p['minimum_travel_paise'],((outbound+inbound)*p['travel_paise_per_km']+500)//1000);gst=((p['base_paise']+travel)*p['gst_bps']+5000)//10000
                row.update(state='quoted',version=row['version']+1,quote_expires_at=time.time()+300,quote={'base_paise':p['base_paise'],'travel_paise':travel,'gst_paise':gst,'total_paise':p['base_paise']+travel+gst,'outbound_metres':outbound,'return_metres':inbound,'distance_source':'Google driving routes','origin_captured_at':row['accepted_position']['captured_at']})
                u.put('hires',hid,row);notify(u,row,row['customer_id'],'Review your day-hire quote','The professional responded. Review travel and tax before confirming.');return row
            h=store.run(quote)
        return safe(h,user['id'])
    def tick():
        def sweep(u):
            for h in u.all('hires'):expire(u,h)
        store.run(sweep)
        if enabled('REPAIDO_PAYMENTS_ENABLED'):
            fees=store.run(lambda u:[f for f in u.all('hire_fees') if f.get('checked_at',0)<time.time()-300 and f.get('status')!='refunded'])
            for f in fees[:20]:
                try:reconcile_fee(f)
                except Exception:pass
        return {'checked':True}
    core.hiring_tick=tick;core.app.include_router(r)
