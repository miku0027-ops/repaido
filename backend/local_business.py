"""Local transport and scrap collection. Server quotes, exclusive assignments and verified receipts.

Amounts are integer paise; scrap weight is integer grams. Provider calls happen
outside storage transactions. No browser flag can confirm a gateway payment.
"""
import copy, hashlib, json, math, os, time, uuid
from datetime import datetime
from typing import Literal
from fastapi import APIRouter, Depends, Request, Response
from pydantic import Field, model_validator
from operations import Input, Pin, Position, fail, metres
from integrations import audit, configured, PaymentCheck
from hiring import route_metres
from rentals import payments_ready
from workspace import photo_body
from evidence import upload_object, download_object

ADVANCE=50000
CLOSED={'completed','cancelled','expired'}
class Partner(Input):
    expected_version:int=Field(default=0,ge=0)
    name:str=Field(min_length=2,max_length=100)
    role:Literal['cab_owner','driver','scrap_owner']
    city:str=Field(min_length=2,max_length=80)
    address:str=Field(min_length=10,max_length=500)
    location:Pin
    document_ids:list[str]=Field(min_length=1,max_length=8)
    terms:Literal[True]
class DocumentReview(Input):
    approved:bool
    expected_version:int=Field(ge=1)
    reason:str=Field(min_length=10,max_length=500)
    evidence_reference:str=Field(min_length=8,max_length=200)
    valid_until:float
class Reconciliation(Input):
    expected_version:int=Field(ge=1)
    action:Literal['resume','cancel','record_settlement']
    note:str=Field(min_length=10,max_length=1500)
    reference:str=Field(min_length=8,max_length=150)
    amount_paise:int=Field(default=0,ge=0,strict=True)

class Vehicle(Input):
    expected_version:int=Field(default=0,ge=0)
    name:str=Field(min_length=3,max_length=100)
    registration:str=Field(min_length=5,max_length=20,pattern=r'^[A-Za-z0-9 -]+$')
    mode:Literal['cab','rental','both']='cab'
    vehicle_kind:Literal['car','bike']='car'
    seats:int=Field(ge=1,le=12)
    transmission:Literal['manual','automatic']='manual'
    fuel:Literal['petrol','diesel','electric','hybrid','cng']='petrol'
    location:Pin
    origin_address:str=Field(min_length=10,max_length=500)
    base_paise:int=Field(ge=0,le=10000000,strict=True)
    per_km_paise:int=Field(gt=0,le=100000,strict=True)
    daily_paise:int=Field(ge=0,le=10000000,strict=True)
    included_daily_km:int=Field(default=0,ge=0,le=2000)
    gst_bps:int=Field(default=0,ge=0,le=3000,strict=True)
    terms:str=Field(min_length=20,max_length=2000)
    document_ids:list[str]=Field(min_length=1,max_length=8)
    active:bool=False
    @model_validator(mode='after')
    def rates(self):
        if self.vehicle_kind=='bike' and self.seats!=1:raise ValueError('A bike may offer one passenger seat.')
        if self.mode in ('rental','both') and not self.daily_paise:raise ValueError('Set a daily rental rate.')
        return self
class Search(Input):
    pickup:Pin
    starts_at:float
    ends_at:float
    mode:Literal['cab','rental']='cab'
class Quote(Search):
    vehicle_id:str=Field(min_length=1,max_length=100)
    dropoff:Pin
    trip:Literal['one_way','round_trip']='one_way'
class RideRequest(Input):
    quote_ids:list[str]=Field(min_length=1,max_length=3)
    pickup_address:str=Field(min_length=10,max_length=500)
    dropoff_address:str=Field(min_length=5,max_length=500)
    phone:str=Field(pattern=r'^\+?[0-9]{10,15}$')
    request_id:str=Field(min_length=16,max_length=100)
    license_document_id:str|None=None
    consent:Literal[True]
class Command(Input):
    position:Position|None=None
    action:Literal['accept','decline','depart','start','complete','confirm','cancel','dispute','inspect','agree','paid','received','settlement_received']
    expected_version:int=Field(ge=1)
    command_id:str=Field(min_length=16,max_length=100)
    note:str=Field(default='',max_length=1500)
    reference:str=Field(default='',max_length=100)
    odometer_km:int|None=Field(default=None,ge=0,le=3000000,strict=True)
class ScrapRequest(Input):
    material:Literal['paper','metal','plastic','electronics','mixed']
    description:str=Field(min_length=10,max_length=1500)
    estimated_kg:int=Field(ge=1,le=20000)
    location:Pin
    address:str=Field(min_length=10,max_length=500)
    city:str=Field(min_length=2,max_length=80)
    starts_at:float
    phone:str=Field(pattern=r'^\+?[0-9]{10,15}$')
    request_id:str=Field(min_length=16,max_length=100)
class ScrapLine(Input):
    material:str=Field(min_length=2,max_length=100)
    grade:str=Field(min_length=2,max_length=200)
    gross_grams:int=Field(gt=0,le=20000000,strict=True)
    tare_grams:int=Field(ge=0,le=20000000,strict=True)
    price_paise_per_kg:int=Field(gt=0,le=10000000,strict=True)
    @model_validator(mode='after')
    def weight(self):
        if self.tare_grams>=self.gross_grams:raise ValueError('Net weight must be positive.')
        return self
class Evaluation(Input):
    expected_version:int=Field(ge=1)
    command_id:str=Field(min_length=16,max_length=100)
    lines:list[ScrapLine]=Field(min_length=1,max_length=30)
    note:str=Field(min_length=10,max_length=1500)
    scale_reference:str=Field(min_length=3,max_length=150)
    weighing_document_id:str

def digest(value):return hashlib.sha256(value.encode()).hexdigest()
def fingerprint(body):return digest(json.dumps(body.model_dump(),sort_keys=True,separators=(',',':')))
def phone(user):
    if not user.get('phone_verified'):fail('PHONE_REQUIRED','Use your verified mobile account to register this business.',403)
def current(u,uid,role=None):
    p=u.get('business_partners',uid)
    if not p or p['status']!='approved' or p.get('valid_until',0)<=time.time() or (role and p['role'] not in role):fail('APPROVAL_REQUIRED','A currently approved business profile is required.',403)
    return p
def document(u,identifier,uid):
    row=u.get('business_documents',identifier)
    if not row or row['owner_id']!=uid:fail('DOCUMENT_REQUIRED','Upload your own private supporting document.',422)
    return row
def schedule(start,end):
    if not all(isinstance(v,(int,float)) and math.isfinite(v) for v in (start,end)) or not time.time()+300<=start<=time.time()+180*86400 or not start+900<=end<=start+30*86400:fail('INVALID_DATES','Choose a pickup at least five minutes ahead and an end at least 15 minutes later, within 180 days.',422)
def conflicts(u,vehicle,start,end,ignore=''):
    rows=u.find('mobility_rides','owner_id',vehicle['owner_id'])+u.find('shared_departures','owner_id',vehicle['owner_id'])
    if vehicle.get('driver_id'):
        rows+=u.find('mobility_rides','driver_id',vehicle['driver_id'])+u.find('shared_departures','driver_id',vehicle['driver_id'])
    return any(r['id']!=ignore and r['state'] not in CLOSED and (r['starts_at']<end and r['ends_at']>start or r['state'] in ('on_the_way','in_progress','disputed') and r['ends_at']<time.time()) for r in rows)
def reservation_guard(u,vehicle):
    # A shared document serializes reservations even when both transaction queries
    # originally returned no bookings (Firestore has no predicate write lock).
    for resource in {'owner:'+vehicle['owner_id'],'vehicle:'+vehicle['id'],*(['driver:'+vehicle['driver_id']] if vehicle.get('driver_id') else [])}:
        old=u.get('mobility_availability',resource) or {'generation':0}
        u.put('mobility_availability',resource,{'generation':old['generation']+1})
def live_vehicle(u,v,mode,start,end,ignore=''):
    if not v or not v.get('active') or v.get('status')!='approved' or v.get('valid_until',0)<end or v['mode'] not in (mode,'both'):return False
    p=u.get('business_partners',v['owner_id']) or {}
    driver=u.get('business_partners',v['driver_id']) if v.get('driver_id') else None
    if v.get('driver_id') and (not driver or driver.get('role')!='driver' or driver.get('status')!='approved' or driver.get('valid_until',0)<end):return False
    return p.get('status')=='approved' and p.get('valid_until',0)>=end and p.get('role') in ('cab_owner','driver') and not conflicts(u,v,start,end,ignore)
def vehicle_public(u,v):
    p=u.get('business_partners',v['owner_id']) or {}
    return {**{k:v[k] for k in ('id','name','mode','seats','transmission','fuel','base_paise','per_km_paise','daily_paise','included_daily_km','gst_bps','terms','version')},'owner_name':p.get('name','Vehicle owner'),'city':p.get('city','')}
def event(u,row,kind,actor):
    row['version']+=1;row['updated_at']=time.time();row.setdefault('events',[]).append({'action':kind,'actor':actor,'at':time.time(),'version':row['version']})
    audit(u,'LocalBusiness'+kind,actor,record_id=row['id'])
def notice(u,uid,row,title):
    nid=digest('business:'+row['id']+':'+str(row['version'])+':'+uid+':'+title)
    u.put('notifications',nid,{'id':nid,'user_id':uid,'title':title,'body':'Open your Repaido transport or scrap workspace for the current details.','kind':'local_business','destination':'mobility' if 'quotes' in row else 'scrap','business_id':row['id'],'created_at':time.time(),'read':False})
def replay(u,uid,body):
    key=digest(uid+':business:'+body.command_id);old=u.get('business_commands',key)
    if old and old['fingerprint']!=fingerprint(body):fail('IDEMPOTENCY_CONFLICT','Use a new action key for a changed action.',409)
    return key,old
def view(row,uid):
    result=copy.deepcopy(row)
    mine=uid in (row['customer_id'],row.get('owner_id'),row.get('driver_id'))
    result.pop('candidate_owner_ids',None)
    if not mine:
        # Candidates see service area and scope, never the customer's address/contact.
        for key in ('phone','pickup_address','dropoff_address','address','pickup','dropoff','location','license_document_id','documents','events','quotes'):
            result.pop(key,None)
        if row.get('quotes'):
            own=next((q for q in row['quotes'] if q['owner_id']==uid),None)
            result['quote']={k:v for k,v in own.items() if k not in ('pickup','dropoff','origin','customer_id')} if own else None
    if uid==row.get('owner_id') and result.get('quotes'):result['quotes']=[q for q in result['quotes'] if q['owner_id']==uid]
    for field in ('request_hash','license_document_id'):result.pop(field,None)
    if uid==row.get('owner_id') and row.get('license_document_id'):result['has_license_document']=True
    if uid==row['customer_id']:
        result.pop('candidate_owner_ids',None)
        for q in result.get('quotes',[]):q.pop('origin',None)
        if result.get('quote'):result['quote'].pop('origin',None)
    return result

def inbox(u,kind,row):
    for uid in set([row['customer_id'],*row['candidate_owner_ids']]):
        key=digest(kind+':'+row['id']+':'+uid)
        u.put('business_inbox',key,{'id':key,'kind':kind,'record_id':row['id'],'user_id':uid,'created_at':row['created_at']})
def own_records(u,kind,uid):
    refs=sorted((r for r in u.find('business_inbox','user_id',uid) if r['kind']==kind),key=lambda r:r['created_at'],reverse=True)[:100]
    collection='mobility_rides' if kind=='rides' else 'scrap_collections'
    u.prefetch([(collection,r['record_id']) for r in refs])
    rows=[u.get(collection,r['record_id']) for r in refs]
    return [r for r in rows if r and (uid in (r['customer_id'],r.get('owner_id')) or (r['state']=='requested' and uid in r['candidate_owner_ids']))]

def apply_provider_payment(u,payment):
    link=u.get('business_orders',payment.get('order_id',''))
    if not link:return None
    pay=u.get('business_payments',link['payment_id']);ride=u.get('mobility_rides',pay['ride_id'])
    if (payment.get('currency')!='INR' or type(payment.get('amount')) is not int or payment['amount']!=pay['amount_paise'] or payment.get('order_id')!=pay.get('order_id')):fail('PAYMENT_MISMATCH','This payment does not match the approved transport invoice.',409)
    pid=str(payment.get('id') or '')
    if not pid.startswith('pay_') or (pay.get('provider_payment_id') and pay['provider_payment_id']!=pid):fail('PAYMENT_REVIEW','This collection needs reconciliation.',409)
    refund=payment.get('amount_refunded',0) or 0
    if type(refund) is not int or not 0<=refund<=pay['amount_paise']:fail('PAYMENT_MISMATCH','Refund amount needs reconciliation.',409)
    if not ((payment.get('status')=='captured' and payment.get('captured') is True) or (payment.get('status')=='refunded' and refund)):return pay
    refund=max(refund,pay.get('refunded_paise',0));net=pay['amount_paise']-refund
    if pay.get('provider_payment_id')==pid and pay.get('net_paise')==net:return pay
    receipt=u.get('receipts',pid)
    if receipt and receipt.get('business_payment_id')!=pay['id']:fail('PAYMENT_ALREADY_USED','Receipt belongs to another purchase.',409)
    pay.update(provider_payment_id=pid,status='refunded' if not net else 'partially_refunded' if refund else 'captured',net_paise=net,refunded_paise=refund,verified_at=time.time())
    ride[pay['kind']+'_paid_paise']=net
    if refund:ride['financial_hold']=True
    if pay['kind']=='advance' and net==ADVANCE and ride['state']=='accepted':ride['state']='reserved'
    if ride['state']=='balance_due' and (ride.get('advance_paid_paise',0)+ride.get('balance_paid_paise',0))>=ride['total_paise']:ride['state']='completed'
    if ride['state'] in ('cancelled','expired') and net:ride['refund_due_paise']=net
    event(u,ride,'PaymentVerified','gateway')
    u.put('business_payments',pay['id'],pay);u.put('mobility_rides',ride['id'],ride)
    u.put('receipts',pid,{'id':pid,'business_payment_id':pay['id'],'customer_id':ride['customer_id'],'amount_paise':pay['amount_paise'],'currency':'INR','verified_at':time.time()})
    return pay

def install(core):
    store=core.operations_store;r=APIRouter(prefix='/operations/local-business',tags=['Transport and scrap'])
    @r.get('/policy')
    def policy():return {'radius_km':8,'minimum_total_paise':ADVANCE,'advance_paise':ADVANCE,'advance_credited':True,'payments_ready':payments_ready(),'routing_ready':configured('GOOGLE_ROUTES_API_KEY'),'offer_seconds':300,'tariffs':'Vehicle-owner defined; price snapshot requires customer approval.','scrap_payment':'Buyer pays the customer after inspection, weighing and customer acceptance. Customer confirms receipt; this is not gateway verification.'}
    @r.post('/documents',status_code=201)
    async def upload(request:Request,user=Depends(core.current_user)):
        if not configured('REPAIDO_KYC_BUCKET'):fail('STORAGE_UNAVAILABLE','Private document storage is unavailable.',503)
        data=await photo_body(request);identifier=str(uuid.uuid4());key='local-business/'+user['id']+'/'+identifier+'.jpg'
        count=store.run(lambda u:len([d for d in u.find('business_documents','owner_id',user['id']) if d['created_at']>time.time()-3600]))
        if count>=20:fail('UPLOAD_LIMIT','Try more document uploads later.',429)
        upload_object(key,data)
        store.run(lambda u:u.put('business_documents',identifier,{'id':identifier,'owner_id':user['id'],'object':key,'created_at':time.time()}))
        return {'id':identifier}
    @r.get('/documents/{identifier}')
    def read_document(identifier:str,user=Depends(core.current_user)):
        def read(u):
            doc=u.get('business_documents',identifier)
            if not doc or doc['owner_id']!=user['id']:fail('NOT_FOUND','Document unavailable.',404)
            return doc
        doc=store.run(read);return Response(download_object(doc['object']),media_type='image/jpeg',headers={'Cache-Control':'private, no-store'})
    @r.get('/partner')
    def partner(user=Depends(core.current_user)):
        return store.run(lambda u:{'partner':u.get('business_partners',user['id']),'vehicles':u.find('mobility_vehicles','owner_id',user['id'])})
    @r.put('/partner')
    def register(body:Partner,user=Depends(core.current_user)):
        phone(user)
        def save(u):
            old=u.get('business_partners',user['id']) or {'version':0}
            if not old['version'] and u.get('workers',user['id']):fail('ROLE_LOCKED','This account is registered for service work. Contact support to change its work category.',409)
            if old.get('role') and body.role!=old['role']:fail('ROLE_LOCKED','Your registered work category cannot be changed here. Contact support.',409)
            if old['version']!=body.expected_version:fail('STALE','Refresh your business profile before saving.',409)
            for identifier in body.document_ids:document(u,identifier,user['id'])
            if old.get('status')=='approved' and body.role!=old['role']:fail('ROLE_REVIEW','Contact support before changing an approved business role.',409)
            row={**body.model_dump(exclude={'expected_version'}),'id':user['id'],'status':'pending','version':old['version']+1,'created_at':old.get('created_at',time.time()),'updated_at':time.time()}
            u.put('business_partners',user['id'],row);audit(u,'BusinessApplication',user['id'],role=body.role)
            return row
        return store.run(save)
    @r.get('/admin/reviews')
    def reviews(admin=Depends(core.operator)):
        return store.run(lambda u:{'partners':u.find('business_partners','status','pending'),'vehicles':u.find('mobility_vehicles','status','pending')})
    @r.get('/admin/reconciliation')
    def reconciliation(admin=Depends(core.operator)):
        return store.run(lambda u:{'rides':[x for state in ('disputed','completed') for x in u.find('mobility_rides','state',state) if not x.get('settlement_received_at')], 'scrap':u.find('scrap_collections','state','disputed')})
    @r.post('/admin/reconciliation/{kind}/{identifier}')
    def reconcile(kind:Literal['rides','scrap'],identifier:str,body:Reconciliation,admin=Depends(core.operator)):
        def save(u):
            collection='mobility_rides' if kind=='rides' else 'scrap_collections';row=u.get(collection,identifier)
            if not row:fail('NOT_FOUND','Record unavailable.',404)
            if row['version']!=body.expected_version:fail('STALE','Refresh the reconciliation record.',409)
            if body.action=='record_settlement':
                if kind!='rides' or row['state']!='completed' or row.get('financial_hold') or row.get('settlement'):fail('NOT_SETTLEABLE','Only completed, collected, undisputed and unsettled rides can be reconciled.',409)
                collected=row.get('advance_paid_paise',0)+row.get('balance_paid_paise',0)
                if body.amount_paise!=collected or collected!=row['total_paise']:fail('AMOUNT_MISMATCH','Record the full collected invoice amount. Deductions require a separately agreed policy.',422)
                # This records an actual external transfer, never initiates or verifies one.
                row['settlement']={'amount_paise':collected,'reference':body.reference,'note':body.note,'recorded_by':admin['id'],'recorded_at':time.time(),'source':'operator_reported_transfer'}
            else:
                if row['state']!='disputed':fail('NOT_DISPUTED','Only disputed records can be resolved here.',409)
                previous=row.get('dispute_previous_state')
                if body.action=='resume':
                    if previous not in ('in_progress','completion_pending','balance_due','agreed','payment_reported'):fail('REVIEW_REQUIRED','This legacy concern needs a manual migration.',409)
                    row['state']=previous;row['financial_hold']=False
                else:
                    if kind=='scrap' and previous=='payment_reported':fail('RECEIPT_REQUIRED','Resolve the reported payment with the customer before closing this collection.',409)
                    row['state']='cancelled';row['refund_due_paise']=row.get('advance_paid_paise',0)
                row['resolution']={'action':body.action,'note':body.note,'reference':body.reference,'by':admin['id'],'at':time.time()}
            event(u,row,'Reconciled',admin['id']);u.put(collection,identifier,row)
            for uid in (row['customer_id'],row.get('owner_id')):
                if uid:notice(u,uid,row,'Business record reviewed')
            return row
        return store.run(save)
    @r.get('/admin/documents/{identifier}')
    def admin_document(identifier:str,admin=Depends(core.operator)):
        row=store.run(lambda u:u.get('business_documents',identifier))
        if not row:fail('NOT_FOUND','Document unavailable.',404)
        return Response(download_object(row['object']),media_type='image/jpeg',headers={'Cache-Control':'private, no-store'})
    @r.post('/admin/{kind}/{identifier}/review')
    def approve(kind:Literal['partner','vehicle'],identifier:str,body:DocumentReview,admin=Depends(core.operator)):
        def save(u):
            collection='business_partners' if kind=='partner' else 'mobility_vehicles';row=u.get(collection,identifier)
            if not row:fail('NOT_FOUND','Application unavailable.',404)
            if row['version']!=body.expected_version:fail('STALE','Reload the application before reviewing.',409)
            if body.approved and not time.time()<body.valid_until<=time.time()+5*366*86400:fail('VALIDITY_REQUIRED','Set the earliest expiry of the verified identity, licence, permit or vehicle documents.',422)
            for doc in row['document_ids']:document(u,doc,row['id'] if kind=='partner' else row['owner_id'])
            row.update(status='approved' if body.approved else 'rejected',valid_until=body.valid_until,review_reason=body.reason,review_reference=body.evidence_reference,reviewed_by=admin['id'],reviewed_at=time.time(),version=row['version']+1)
            u.put(collection,identifier,row);audit(u,'BusinessReview',admin['id'],kind=kind,record_id=identifier,approved=body.approved)
            return row
        return store.run(save)
    @r.put('/vehicles/{identifier}')
    def vehicle(identifier:str,body:Vehicle,user=Depends(core.current_user)):
        if len(identifier)>80 or not all(c.isalnum() or c=='-' for c in identifier):fail('INVALID_ID','Use a valid vehicle identifier.',422)
        def save(u):
            current(u,user['id'],('cab_owner',));old=u.get('mobility_vehicles',identifier)
            if old and old['owner_id']!=user['id']:fail('NOT_FOUND','Vehicle not found.',404)
            if (old or {}).get('version',0)!=body.expected_version:fail('STALE','Reload the vehicle before changing it.',409)
            if not old and len(u.find('mobility_vehicles','owner_id',user['id']))>=20:fail('VEHICLE_LIMIT','Contact support to add more vehicles.',422)
            for doc in body.document_ids:document(u,doc,user['id'])
            verification_changed=not old or any(old.get(k,'car' if k=='vehicle_kind' else None)!=body.model_dump()[k] for k in ('vehicle_kind','name','registration','document_ids','mode','seats','fuel','transmission'))
            row={**(old or {}),**body.model_dump(exclude={'expected_version'}),'id':identifier,'owner_id':user['id'],'status':'pending' if verification_changed else old['status'],'version':body.expected_version+1,'updated_at':time.time()}
            u.put('mobility_vehicles',identifier,row);return row
        return store.run(save)
    @r.post('/vehicles/search')
    def search(body:Search):
        schedule(body.starts_at,body.ends_at)
        def read(u):
            candidates=[]
            for v in u.find('mobility_vehicles','active',True):
                distance=metres(v['location'],body.pickup.model_dump())
                if distance<=8000 and live_vehicle(u,v,body.mode,body.starts_at,body.ends_at):candidates.append({**vehicle_public(u,v),'nearby_km':round(distance/1000,2)})
            return {'vehicles':sorted(candidates,key=lambda v:(v['nearby_km'],v['id']))[:30],'radius_km':8}
        return store.run(read)
    @r.post('/quotes',status_code=201)
    def quote(body:Quote,user=Depends(core.current_user)):
        schedule(body.starts_at,body.ends_at)
        def inspect(u):
            v=u.get('mobility_vehicles',body.vehicle_id)
            if not live_vehicle(u,v,body.mode,body.starts_at,body.ends_at) or metres(v['location'],body.pickup.model_dump())>8000:fail('UNAVAILABLE','This vehicle is no longer eligible within 8 km.',409)
            return v,vehicle_public(u,v)
        v,public=store.run(inspect);origin=v['location'];pickup=body.pickup.model_dump();drop=body.dropoff.model_dump()
        if body.mode=='rental':
            approach=route_metres(pickup,origin);travel=route_metres(origin,drop);returning=route_metres(drop,origin);to_origin=0
        else:
            approach=route_metres(origin,pickup);travel=route_metres(pickup,drop)
            returning=route_metres(drop,pickup if body.trip=='round_trip' else origin)
            to_origin=route_metres(pickup,origin) if body.trip=='round_trip' else 0
        days=max(1,math.ceil((body.ends_at-body.starts_at)/86400));distance=approach+travel+returning+to_origin
        if body.mode=='cab':usage=(distance*v['per_km_paise']+999)//1000;rate=v['base_paise'];included=0
        else:
            included=days*v['included_daily_km'];rate=days*v['daily_paise'];usage=(max(0,travel+returning-included*1000)*v['per_km_paise']+999)//1000
        subtotal=rate+usage;tax=(subtotal*v['gst_bps']+5000)//10000;total=max(ADVANCE,subtotal+tax)
        q={**body.model_dump(),'id':str(uuid.uuid4()),'customer_id':user['id'],'owner_id':v['owner_id'],'vehicle':public,'vehicle_version':v['version'],'origin':origin,'approach_metres':approach,'travel_metres':travel,'return_metres':returning,'depot_return_metres':to_origin,'base_paise':rate,'distance_paise':usage,'gst_paise':tax,'minimum_adjustment_paise':total-subtotal-tax,'total_paise':total,'advance_paise':ADVANCE,'balance_paise':total-ADVANCE,'rental_days':days,'included_km':included,'created_at':time.time(),'expires_at':time.time()+600}
        def save(u):
            latest=u.get('mobility_vehicles',v['id'])
            if latest['version']!=v['version'] or not live_vehicle(u,latest,body.mode,body.starts_at,body.ends_at):fail('QUOTE_CHANGED','Vehicle rates or availability changed. Request a fresh quote.',409)
            u.put('mobility_quotes',q['id'],q)
        store.run(save);return {k:value for k,value in q.items() if k!='origin'}
    @r.post('/rides',status_code=201)
    def ride(body:RideRequest,user=Depends(core.current_user)):
        key=digest(user['id']+':ride:'+body.request_id)
        def save(u):
            old=u.get('mobility_rides',key)
            if old:
                if old['request_hash']!=fingerprint(body):fail('IDEMPOTENCY_CONFLICT','This request key was used for different trip details.',409)
                return view(old,user['id'])
            quotes=[]
            for qid in dict.fromkeys(body.quote_ids):
                q=u.get('mobility_quotes',qid)
                if not q or q['customer_id']!=user['id'] or q['expires_at']<=time.time():fail('QUOTE_EXPIRED','Refresh your trip quote before requesting a vehicle.',409)
                schedule(q['starts_at'],q['ends_at']);v=u.get('mobility_vehicles',q['vehicle_id'])
                if not live_vehicle(u,v,q['mode'],q['starts_at'],q['ends_at']) or v['version']!=q['vehicle_version']:fail('UNAVAILABLE','A quoted vehicle changed. Refresh availability.',409)
                if quotes and any(q[k]!=quotes[0][k] for k in ('pickup','dropoff','mode','trip','starts_at','ends_at')):fail('TRIP_MISMATCH','All requested vehicles must use the same trip.',422)
                quotes.append(q)
            if quotes[0]['mode']=='rental':
                if not body.license_document_id:fail('LICENCE_REQUIRED','Upload your driving licence for owner review before a self-drive rental.',422)
                document(u,body.license_document_id,user['id'])
            q=quotes[0];row={**body.model_dump(exclude={'request_id','quote_ids'}),'id':key,'request_hash':fingerprint(body),'customer_id':user['id'],'customer_name':user.get('name','Customer'),'candidate_owner_ids':list(dict.fromkeys(x['owner_id'] for x in quotes)),'quotes':quotes,'state':'requested','owner_id':None,'starts_at':q['starts_at'],'ends_at':q['ends_at'],'mode':q['mode'],'trip':q['trip'],'pickup':q['pickup'],'dropoff':q['dropoff'],'offer_expires_at':time.time()+300,'created_at':time.time(),'version':1,'events':[],'geofencing':True,'advance_paid_paise':0,'balance_paid_paise':0}
            u.put('mobility_rides',key,row);inbox(u,'rides',row)
            for owner in row['candidate_owner_ids']:notice(u,owner,row,'New transport request')
            return view(row,user['id'])
        return store.run(save)
    @r.get('/rides')
    def rides(user=Depends(core.current_user)):
        def read(u):
            rows=list({x['id']:x for x in own_records(u,'rides',user['id'])+u.find('mobility_rides','driver_id',user['id'])}.values())
            for row in rows:
                if row['state']=='requested' and row['offer_expires_at']<=time.time():row['state']='expired';event(u,row,'RequestExpired','scheduler');u.put('mobility_rides',row['id'],row)
            return {'rides':[view(x,user['id']) for x in sorted(rows,key=lambda x:x['created_at'],reverse=True)[:100]],'server_time':time.time()}
        return store.run(read)
    @r.get('/rides/{identifier}/license')
    def rider_license(identifier:str,user=Depends(core.current_user)):
        def read(u):
            row=u.get('mobility_rides',identifier)
            if not row or user['id']!=row.get('owner_id') or not row.get('license_document_id'):fail('NOT_FOUND','Licence unavailable.',404)
            return document(u,row['license_document_id'],row['customer_id'])
        doc=store.run(read);return Response(download_object(doc['object']),media_type='image/jpeg',headers={'Cache-Control':'private, no-store'})
    @r.post('/rides/{identifier}/commands')
    def ride_command(identifier:str,body:Command,user=Depends(core.current_user)):
        def save(u):
            row=u.get('mobility_rides',identifier);uid=user['id']
            if not row or (uid not in (row['customer_id'],row.get('owner_id'),row.get('driver_id')) and uid not in row['candidate_owner_ids']):fail('NOT_FOUND','Ride unavailable.',404)
            key,old=replay(u,uid,body)
            if old:
                if old['record_id']!=identifier:fail('IDEMPOTENCY_CONFLICT','Action belongs to another record.',409)
                return view(row,uid)
            if row['version']!=body.expected_version:fail('STALE','This booking changed. Refresh before continuing.',409)
            owner=uid==row.get('owner_id');operator=owner or uid==row.get('driver_id');customer=uid==row['customer_id'];a=body.action;state=row['state']
            if a=='accept':
                current(u,uid,('cab_owner','driver'))
                if state!='requested' or uid not in row['candidate_owner_ids'] or row['offer_expires_at']<=time.time():fail('ALREADY_ASSIGNED','This request has expired or another owner accepted first.',409)
                q=next(x for x in row['quotes'] if x['owner_id']==uid);v=u.get('mobility_vehicles',q['vehicle_id'])
                if not v or q['expires_at']<=time.time() or v['version']!=q['vehicle_version'] or not live_vehicle(u,v,row['mode'],row['starts_at'],row['ends_at']):fail('UNAVAILABLE','This vehicle or driver is no longer available.',409)
                if uid==row['customer_id']:fail('SELF_BOOKING','Choose another customer booking.',422)
                reservation_guard(u,v)
                row.update(owner_id=uid,driver_id=v.get('driver_id'),quote=q,vehicle_id=v['id'],total_paise=q['total_paise'],state='accepted',accepted_at=time.time())
                if row['mode']=='rental':row.update(vehicle_pickup_location=v['location'],vehicle_pickup_address=v['origin_address'])
                notice(u,row['customer_id'],row,'Your vehicle owner accepted')
            elif a=='decline':
                if state!='requested' or uid not in row['candidate_owner_ids']:fail('INVALID_ACTION','This request cannot be declined.',409)
                row['candidate_owner_ids'].remove(uid)
                if not row['candidate_owner_ids']:row['state']='expired'
            elif a=='depart':
                if not operator or state!='reserved' or row['mode']!='cab' or row.get('advance_paid_paise')!=ADVANCE or row.get('financial_hold'):fail('ADVANCE_REQUIRED','A verified ₹500 advance is required before departure.',409)
                current(u,uid,('cab_owner','driver'))
                if not live_vehicle(u,u.get('mobility_vehicles',row['vehicle_id']),row['mode'],row['starts_at'],row['ends_at'],row['id']):fail('APPROVAL_REQUIRED','The assigned vehicle documents or availability need review.',409)
                if time.time()>row['ends_at']:fail('PICKUP_WINDOW','The booked journey window has ended. Cancel for an advance refund.',409)
                row.update(state='on_the_way',departed_at=time.time())
            elif a=='start':
                if not operator or state not in ('reserved','on_the_way') or row.get('advance_paid_paise')!=ADVANCE or row.get('financial_hold'):fail('ADVANCE_REQUIRED','Verify the advance before starting.',409)
                if not row['starts_at']-3600<=time.time()<=row['ends_at']:fail('PICKUP_WINDOW','Start within the booked pickup window.',409)
                if body.odometer_km is None or len(body.note.strip())<10:fail('INSPECTION_REQUIRED','Record the odometer and pickup condition; for rentals confirm the original driving licence.',422)
                current(u,uid,('cab_owner','driver'))
                if not live_vehicle(u,u.get('mobility_vehicles',row['vehicle_id']),row['mode'],row['starts_at'],row['ends_at'],row['id']):fail('APPROVAL_REQUIRED','The assigned vehicle documents or availability need review.',409)
                if row.get('geofencing'):
                    from mobility_journeys import fresh
                    if not body.position:fail('GEOFENCE_REQUIRED','Allow precise GPS to confirm pickup.',409)
                    fresh(body.position)
                    pin=row.get('vehicle_pickup_location') if row['mode']=='rental' else row['pickup']
                    if metres(body.position.model_dump(),pin)+body.position.accuracy>300:fail('GEOFENCE_REQUIRED','Confirm pickup within 300 metres of the agreed pin.',409)
                    row['boarding_position']=body.position.model_dump()
                row.update(state='in_progress',started_at=time.time(),start_odometer_km=body.odometer_km,pickup_condition=body.note)
            elif a=='complete':
                if not operator or state!='in_progress':fail('INVALID_ACTION','Only the assigned owner can submit an active journey for completion.',409)
                if body.odometer_km is None or body.odometer_km<row['start_odometer_km'] or len(body.note.strip())<10:fail('INSPECTION_REQUIRED','Record the final odometer and return condition.',422)
                if row.get('geofencing'):
                    from mobility_journeys import fresh
                    if not body.position:fail('GEOFENCE_REQUIRED','Allow precise GPS to confirm the final stop.',409)
                    fresh(body.position)
                    pin=row.get('vehicle_pickup_location') if row['mode']=='rental' else row['pickup'] if row['trip']=='round_trip' else row['dropoff']
                    if metres(body.position.model_dump(),pin)+body.position.accuracy>300:fail('GEOFENCE_REQUIRED','Confirm completion within 300 metres of the agreed return or drop-off pin.',409)
                    row['completion_position']=body.position.model_dump()
                row.update(state='completion_pending',submitted_at=time.time(),end_odometer_km=body.odometer_km,completion_note=body.note)
                if row['mode']=='rental':
                    q=row['quote'];days=max(q['rental_days'],math.ceil((time.time()-row['started_at'])/86400));km=body.odometer_km-row['start_odometer_km'];extra=max(0,km-days*q['vehicle']['included_daily_km']);subtotal=days*q['vehicle']['daily_paise']+extra*q['vehicle']['per_km_paise'];tax=(subtotal*q['vehicle']['gst_bps']+5000)//10000
                    row.update(total_paise=max(ADVANCE,subtotal+tax),final_breakdown={'days':days,'distance_km':km,'excess_km':extra,'subtotal_paise':subtotal,'gst_paise':tax})
            elif a=='confirm':
                if not customer or state!='completion_pending':fail('INVALID_ACTION','Review the submitted completion first.',409)
                row.update(state='completed' if row.get('advance_paid_paise',0)>=row['total_paise'] else 'balance_due',completion_accepted_at=time.time())
            elif a=='settlement_received':
                if not owner or state!='completed' or not row.get('settlement'):fail('SETTLEMENT_REQUIRED','Confirm only after receiving the recorded transfer.',409)
                row['settlement_received_at']=time.time();row['settlement']['source']='owner_confirmed_receipt'
            elif a=='cancel':
                if not (owner or customer) or state not in ('requested','accepted','reserved','on_the_way'):fail('INVALID_ACTION','This ride cannot be cancelled here.',409)
                row.update(state='cancelled',cancelled_at=time.time(),refund_due_paise=row.get('advance_paid_paise',0),cancel_reason=body.note)
            elif a=='dispute':
                if not customer or state not in ('in_progress','completion_pending','balance_due') or len(body.note.strip())<10:fail('INVALID_ACTION','Describe the concern with this active or submitted ride.',422)
                row.update(dispute_previous_state=row['state'],state='disputed',dispute_note=body.note,financial_hold=True)
            else:fail('INVALID_ACTION','Unsupported ride action.',422)
            event(u,row,a,uid);u.put('mobility_rides',identifier,row);u.put('business_commands',key,{'record_id':identifier,'fingerprint':fingerprint(body)})
            if row.get('owner_id'):
                for target in {row['customer_id'],row['owner_id'],row.get('driver_id')}:
                    if target and target!=uid:notice(u,target,row,'Transport booking updated')
            return view(row,uid)
        return store.run(save)
    @r.post('/rides/{identifier}/payment-order')
    def payment_order(identifier:str,kind:Literal['advance','balance']='advance',user=Depends(core.current_user)):
        if not payments_ready():fail('PAYMENTS_UNAVAILABLE','Online transport payments are not connected. No charge was made.',503)
        from integrations import razorpay
        payid=digest(identifier+':'+kind)
        def reserve(u):
            row=u.get('mobility_rides',identifier)
            if not row or row['customer_id']!=user['id']:fail('NOT_FOUND','Ride unavailable.',404)
            if row.get('financial_hold') or row['state']!=('accepted' if kind=='advance' else 'balance_due'):fail('NOT_PAYABLE','This booking is not ready for that payment.',409)
            old=u.get('business_payments',payid)
            if old:return old,False
            amount=ADVANCE if kind=='advance' else max(0,row['total_paise']-row.get('advance_paid_paise',0))
            if amount<=0:fail('NOT_PAYABLE','No balance is payable.',409)
            value={'id':payid,'ride_id':identifier,'customer_id':user['id'],'kind':kind,'amount_paise':amount,'status':'creating','receipt':'mob-'+payid[:32],'created_at':time.time()}
            u.put('business_payments',payid,value);return value,True
        pay,fresh=store.run(reserve)
        if fresh:
            order=razorpay('orders',{'amount':pay['amount_paise'],'currency':'INR','receipt':pay['receipt'],'notes':{'business_payment_id':payid}})
            if not order.get('id') or order.get('amount')!=pay['amount_paise'] or order.get('currency')!='INR':fail('ORDER_RECONCILING','The payment order needs reconciliation. Do not retry a new payment.',409)
            def save(u):
                current_pay=u.get('business_payments',payid);current_pay.update(order_id=order['id'],status='created');u.put('business_payments',payid,current_pay);u.put('business_orders',order['id'],{'payment_id':payid});return current_pay
            pay=store.run(save)
        elif not pay.get('order_id'):
            orders=razorpay('orders?receipt='+pay['receipt']).get('items',[])
            matching=[o for o in orders if o.get('receipt')==pay['receipt'] and o.get('amount')==pay['amount_paise'] and o.get('currency')=='INR']
            if len(matching)==1:
                def recover(u):
                    item=u.get('business_payments',payid)
                    if not item.get('order_id'):item.update(order_id=matching[0]['id'],status='created');u.put('business_payments',payid,item);u.put('business_orders',matching[0]['id'],{'payment_id':payid})
                    return item
                pay=store.run(recover)
        if not pay.get('order_id'):fail('ORDER_RECONCILING','Payment setup is being reconciled. No second order will be created.',409)
        return {'key_id':os.environ['RAZORPAY_KEY_ID'],'order_id':pay['order_id'],'amount':pay['amount_paise'],'currency':'INR'}
    @r.post('/rides/{identifier}/payment-check')
    def payment_check(identifier:str,body:PaymentCheck,user=Depends(core.current_user)):
        from integrations import razorpay
        row=store.run(lambda u:u.get('mobility_rides',identifier))
        if not row or row['customer_id']!=user['id']:fail('NOT_FOUND','Ride unavailable.',404)
        payment=razorpay('payments/'+body.payment_id)
        def save(u):
            linked=u.get('business_orders',payment.get('order_id',''));pay=u.get('business_payments',linked['payment_id']) if linked else None
            if not pay or pay['ride_id']!=identifier:fail('PAYMENT_MISMATCH','This payment belongs to another order.',409)
            return apply_provider_payment(u,payment)
        return store.run(save)
    @r.post('/rides/{identifier}/refund')
    def refund(identifier:str,user=Depends(core.current_user)):
        from integrations import razorpay
        payid=digest(identifier+':advance')
        def reserve(u):
            row=u.get('mobility_rides',identifier);pay=u.get('business_payments',payid)
            if not row or user['id'] not in (row['customer_id'],row.get('owner_id')):fail('NOT_FOUND','Ride unavailable.',404)
            if row['state'] not in ('cancelled','expired') or not pay or not pay.get('provider_payment_id'):fail('NOT_REFUNDABLE','A confirmed advance on a cancelled booking is required.',409)
            old=u.get('business_refunds',payid)
            if old:return old,pay,False
            value={'id':payid,'status':'creating','amount_paise':pay['amount_paise'],'receipt':'mrf-'+payid[:30],'created_at':time.time()};u.put('business_refunds',payid,value);return value,pay,True
        refund,pay,fresh=store.run(reserve)
        if refund['status']=='processed':return refund
        if fresh:
            result=razorpay('payments/'+pay['provider_payment_id']+'/refund',{'amount':refund['amount_paise'],'receipt':refund['receipt']})
        else:
            found=[x for x in razorpay('payments/'+pay['provider_payment_id']+'/refunds?count=100').get('items',[]) if x.get('receipt')==refund['receipt']]
            if len(found)!=1:fail('REFUND_RECONCILING','Refund status is being reconciled; no duplicate refund was sent.',409)
            result=found[0]
        if result.get('amount')!=refund['amount_paise'] or result.get('payment_id')!=pay['provider_payment_id']:fail('REFUND_MISMATCH','The refund needs provider reconciliation.',409)
        def save(u):
            item=u.get('business_refunds',payid);item.update(provider_id=result['id'],status=result.get('status','pending'));u.put('business_refunds',payid,item)
            row=u.get('mobility_rides',identifier);row['refund_status']=item['status']
            if item['status']=='processed':
                row.update(refund_due_paise=0,advance_paid_paise=0)
                paid=u.get('business_payments',payid);paid.update(status='refunded',net_paise=0,refunded_paise=paid['amount_paise'],refund_verified_at=time.time());u.put('business_payments',payid,paid)
            event(u,row,'RefundChecked','gateway');u.put('mobility_rides',identifier,row)
            return item
        return store.run(save)
    @r.post('/scrap',status_code=201)
    def scrap(body:ScrapRequest,user=Depends(core.current_user)):
        if not time.time()+300<body.starts_at<time.time()+30*86400:fail('INVALID_DATE','Choose a pickup within the next 30 days, at least five minutes ahead.',422)
        key=digest(user['id']+':scrap:'+body.request_id)
        def save(u):
            old=u.get('scrap_collections',key)
            if old:
                if old['request_hash']!=fingerprint(body):fail('IDEMPOTENCY_CONFLICT','This request key has different details.',409)
                return view(old,user['id'])
            owners=[p for p in u.find('business_partners','role','scrap_owner') if p['status']=='approved' and p.get('valid_until',0)>=body.starts_at and metres(p['location'],body.location.model_dump())<=8000 and p['id']!=user['id']]
            owners=sorted(owners,key=lambda p:(metres(p['location'],body.location.model_dump()),p['id']))[:20]
            if not owners:fail('NO_BUYERS','No approved scrap buyer is available within 8 km yet. No pickup was booked.',409)
            row={**body.model_dump(exclude={'request_id'}),'id':key,'customer_id':user['id'],'customer_name':user.get('name','Customer'),'owner_id':None,'request_hash':fingerprint(body),'candidate_owner_ids':[p['id'] for p in owners],'state':'requested','version':1,'events':[],'created_at':time.time()}
            u.put('scrap_collections',key,row);inbox(u,'scrap',row)
            for owner in owners:notice(u,owner['id'],row,'Scrap collection requested')
            return view(row,user['id'])
        return store.run(save)
    @r.get('/scrap')
    def scraps(user=Depends(core.current_user)):
        return store.run(lambda u:{'collections':[view(row,user['id']) for row in own_records(u,'scrap',user['id'])]})
    @r.post('/scrap/{identifier}/evaluation')
    def evaluate(identifier:str,body:Evaluation,user=Depends(core.current_user)):
        def save(u):
            current(u,user['id'],('scrap_owner',));row=u.get('scrap_collections',identifier)
            if not row or row.get('owner_id')!=user['id']:fail('NOT_FOUND','Collection unavailable.',404)
            key,old=replay(u,user['id'],body)
            if old:
                if old['record_id']!=identifier:fail('IDEMPOTENCY_CONFLICT','Action belongs to another collection.',409)
                return view(row,user['id'])
            if row['version']!=body.expected_version or row['state'] not in ('accepted','evaluated'):fail('STALE','Refresh the collection before submitting its evaluation.',409)
            document(u,body.weighing_document_id,user['id'])
            lines=[]
            for line in body.lines:
                net=line.gross_grams-line.tare_grams;lines.append({**line.model_dump(),'net_grams':net,'amount_paise':net*line.price_paise_per_kg//1000})
            total=sum(line['amount_paise'] for line in lines)
            if total<=0:fail('INVALID_AMOUNT','The weighed material must have a positive payable value.',422)
            row.update(state='evaluated',evaluation={'lines':lines,'total_paise':total,'scale_reference':body.scale_reference,'weighing_document_id':body.weighing_document_id,'note':body.note,'at':time.time()})
            event(u,row,'Evaluated',user['id']);u.put('scrap_collections',identifier,row);u.put('business_commands',key,{'record_id':identifier,'fingerprint':fingerprint(body)});notice(u,row['customer_id'],row,'Review your weighed scrap quote')
            return view(row,user['id'])
        return store.run(save)
    @r.get('/scrap/{identifier}/weighing-photo')
    def weighing_photo(identifier:str,user=Depends(core.current_user)):
        def read(u):
            row=u.get('scrap_collections',identifier)
            if not row or user['id'] not in (row['customer_id'],row.get('owner_id')) or not row.get('evaluation'):fail('NOT_FOUND','Weighing evidence unavailable.',404)
            return document(u,row['evaluation']['weighing_document_id'],row['owner_id'])
        doc=store.run(read);return Response(download_object(doc['object']),media_type='image/jpeg',headers={'Cache-Control':'private, no-store'})
    @r.post('/scrap/{identifier}/commands')
    def scrap_command(identifier:str,body:Command,user=Depends(core.current_user)):
        def save(u):
            row=u.get('scrap_collections',identifier);uid=user['id']
            if not row or (uid not in (row['customer_id'],row.get('owner_id'),row.get('driver_id')) and uid not in row['candidate_owner_ids']):fail('NOT_FOUND','Collection unavailable.',404)
            key,old=replay(u,uid,body)
            if old:
                if old['record_id']!=identifier:fail('IDEMPOTENCY_CONFLICT','Action belongs to another collection.',409)
                return view(row,uid)
            if row['version']!=body.expected_version:fail('STALE','Collection changed. Refresh first.',409)
            owner=uid==row.get('owner_id');operator=owner or uid==row.get('driver_id');customer=uid==row['customer_id'];a=body.action
            if a=='accept':
                current(u,uid,('scrap_owner',))
                if row['state']!='requested' or uid not in row['candidate_owner_ids'] or row['starts_at']<time.time():fail('ALREADY_ASSIGNED','This collection is expired or already assigned.',409)
                row.update(owner_id=uid,state='accepted',accepted_at=time.time(),buyer_name=current(u,uid)['name'])
            elif a=='agree':
                if not customer or row['state']!='evaluated':fail('INVALID_ACTION','Review the weighing quote before accepting.',409)
                row.update(state='agreed',agreed_at=time.time(),agreed_paise=row['evaluation']['total_paise'])
            elif a=='paid':
                if not owner or row['state']!='agreed' or len(body.reference.strip())<5:fail('REFERENCE_REQUIRED','Pay the accepted amount and record the payment reference.',422)
                row.update(state='payment_reported',payment_reference=body.reference,reported_paid_at=time.time(),payment_source='buyer_reported')
            elif a=='received':
                if not customer or row['state']!='payment_reported':fail('INVALID_ACTION','Confirm only after you have received the buyer’s payment.',409)
                row.update(state='completed',received_at=time.time(),payment_source='customer_confirmed_receipt')
            elif a=='cancel':
                if not (customer or owner) or row['state'] not in ('requested','accepted','evaluated'):fail('INVALID_ACTION','This collection can no longer be cancelled here.',409)
                row.update(state='cancelled',cancel_reason=body.note)
            elif a=='dispute':
                if not customer or row['state'] not in ('agreed','payment_reported') or len(body.note.strip())<10:fail('INVALID_ACTION','Describe your collection or payment concern.',422)
                row.update(dispute_previous_state=row['state'],state='disputed',dispute_note=body.note)
            else:fail('INVALID_ACTION','Unsupported collection action.',422)
            event(u,row,a,uid);u.put('scrap_collections',identifier,row);u.put('business_commands',key,{'record_id':identifier,'fingerprint':fingerprint(body)})
            if row.get('owner_id'):notice(u,row['customer_id'] if owner else row['owner_id'],row,'Scrap collection updated')
            return view(row,uid)
        return store.run(save)
    core.app.include_router(r)
