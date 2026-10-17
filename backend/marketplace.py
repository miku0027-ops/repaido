"""Paid peer listings, mutual exchange matching and versioned service terms."""
import hashlib,os,time,uuid
from datetime import datetime,timezone
from typing import Literal
from fastapi import APIRouter,Depends,Request,Response
from pydantic import Field,model_validator
from operations import Input,Pin,fail,metres
from integrations import audit,razorpay,enabled,configured
from workspace import photo_body
from evidence import upload_object,download_object
from market_access import access_status,require_access,start_trial,sync_listings,POLICY as ACCESS_POLICY,TRIAL_DAYS

TYPES=('phone','computer','television','appliance','camera','audio','tools','other')
FREE_DAYS=TRIAL_DAYS
SELLER_FREE_DAYS=TRIAL_DAYS
def active(row):
 return row['status']=='published' and (not row.get('expires_at') or row['expires_at']>time.time())
def trial_key(uid,mode):return hashlib.sha256((uid+':'+mode).encode()).hexdigest()
def eligible(u,uid,mode,lid=None):
 state=access_status(u,uid)
 return state['status'] in ('trial','not_started')
def grant_trial(u,row,state=None):
 state=state or start_trial(u,row['owner_id'])
 if not state['active']:fail('MARKET_ACCESS_REQUIRED','Renew marketplace access for ₹99 per month to publish this listing.',402)
 row.update(status='published',fee_paise=0,fee_status='access_paid' if state['status']=='paid' else 'free_trial',
            trial_started_at=state['trial_started_at'],expires_at=state['current_period_ends_at'],access_policy=ACCESS_POLICY)
 audit(u,'MarketplaceAccessListingPublished',row['owner_id'],listing_id=row['id'],expires_at=row['expires_at'])
def refresh_access_rows(u):
 # Search/expiry already visit published records. Keep legacy 30-day offers and
 # exact public expiry projections consistent after the shared-plan migration.
 rows=u.all('market_listings')
 for uid in {row['owner_id'] for row in rows if row.get('fee_status') in ('free_trial','access_paid')}:
  sync_listings(u,uid)
def expire_trials(u):
 count=0;now=time.time();refresh_access_rows(u)
 for row in u.all('market_listings'):
  if row['status']!='published' or not row.get('expires_at'):continue
  expired=row['expires_at']<=now
  if expired:
   row['status']='expired';u.put('market_listings',row['id'],row);count+=1
   audit(u,'MarketplaceFreeListingExpired','system',listing_id=row['id'])
  if expired or row['expires_at']-now<=3*86400:
   nid='market-'+('expired-' if expired else 'expiring-')+row['id']
   if not u.get('notifications',nid):u.put('notifications',nid,dict(id=nid,user_id=row['owner_id'],title='Your marketplace access has expired' if expired else 'Your marketplace access ends soon',body='Your item is hidden from public results. Renew marketplace access for ₹99 per month to publish it again.' if expired else 'Your marketplace access ends in 3 days or less. Renew for ₹99 per month to keep listings visible and send messages. There is no automatic charge.',destination='exchange' if row['mode']=='exchange' else 'second_hand',created_at=now))
 return count
class MarketplacePin(Pin):
 # Older apps submit the location picker metadata together with coordinates.
 address:str=Field(default="",max_length=500)
 city:str=Field(default="",max_length=80)

class Listing(Input):
 request_id:str=Field(min_length=16,max_length=100)
 mode:Literal['exchange','second_hand']
 name:str=Field(min_length=3,max_length=120)
 brand:str=Field(min_length=2,max_length=80)
 product_type:Literal['phone','computer','television','appliance','camera','audio','tools','other']
 desired_type:Literal['phone','computer','television','appliance','camera','audio','tools','other']|None=None
 desired_product:str=Field(default='',max_length=200)
 value_paise:int=Field(ge=10000,le=100000000)
 purchase_paise:int=Field(gt=0,le=100000000)
 age_months:int=Field(ge=0,le=600)
 manufacture_year:int=Field(ge=1970)
 warranty:str=Field(min_length=3,max_length=500)
 condition:str=Field(min_length=10,max_length=1500)
 reason:str=Field(min_length=5,max_length=500)
 photo_id:str
 city:str=Field(min_length=2,max_length=80)
 location:MarketplacePin
 radius_km:int=Field(default=10,ge=1,le=100)
 share_contact:Literal[True]
 @model_validator(mode='after')
 def valid(self):
  if self.manufacture_year>datetime.now(timezone.utc).year:raise ValueError('Manufacture year cannot be in the future.')
  if self.mode=='exchange' and (not self.desired_type or len(self.desired_product.strip())<3):raise ValueError('Describe the product you want in exchange.')
  return self
class Area(Input):
 location:MarketplacePin
 radius_km:int=Field(default=10,ge=1,le=100)
 mode:Literal['exchange','second_hand']='exchange'
 query:str=Field(default='',max_length=120)
class Radius(Input):
 radius_km:int=Field(ge=1,le=100)
class Report(Input):
 reason:str=Field(min_length=10,max_length=500)
class Terms(Input):
 expected_version:int=Field(ge=0)
 text:str=Field(min_length=10,max_length=6000)

PUBLIC=('id','mode','name','brand','product_type','desired_type','desired_product','value_paise','purchase_paise','age_months','manufacture_year','warranty','condition','reason','city','radius_km','status','created_at','expires_at','trial_started_at')
def view(row):return {**{k:row.get(k) for k in PUBLIC},'status':'expired' if row['status']=='published' and not active(row) else row['status'],'image_url':'/api/operations/market/photos/'+row['photo_id']}
def pair(a,b):
 if a['id']==b['id'] or a['owner_id']==b['owner_id'] or any(not active(x) or x['mode']!='exchange' for x in (a,b)):return None
 if a['desired_type']!=b['product_type'] or b['desired_type']!=a['product_type']:return None
 delta=abs(a['value_paise']-b['value_paise'])/min(a['value_paise'],b['value_paise'])
 distance=metres(a['location'],b['location'])/1000
 if delta>0.15 or distance>min(a['radius_km'],b['radius_km']):return None
 # Exact wanted model words improve order; categories and reciprocal radius are hard gates.
 words=lambda s:set(s.lower().split())
 relevance=len(words(a['desired_product']) & words(b['name']+' '+b['brand']))+len(words(b['desired_product']) & words(a['name']+' '+a['brand']))
 return dict(distance_km=round(distance,1),value_difference_percent=round(delta*100,1),match_label='Close value match' if delta>0.10 else 'Best value match',score=round(80*(1-delta/.15)+15*(1-distance/min(a['radius_km'],b['radius_km']))+min(5,relevance*2),2))
def matches(u,listing):
 rows=[]
 for other in u.all('market_listings'):
  match=pair(listing,other)
  if match:rows.append({**view(other),**match})
 return sorted(rows,key=lambda x:(-x['score'],x['id']))
def notify_matches(u):
 rows=[x for x in u.all('market_listings') if active(x) and x['mode']=='exchange']
 for i,a in enumerate(rows):
  for b in rows[i+1:]:
   if not pair(a,b):continue
   key='exchange-'+hashlib.sha256(':'.join(sorted([a['id'],b['id']])).encode()).hexdigest()
   for own,other in ((a,b),(b,a)):
    nid=key+own['id']
    if not u.get('notifications',nid):u.put('notifications',nid,dict(id=nid,user_id=own['owner_id'],title='An exchange match is available',body='A nearby listing fits your exchange category and value range. Review the details before contacting its owner.',destination='exchange',created_at=time.time()))

def install(core):
 r=APIRouter(prefix='/operations');store=core.operations_store
 def owned(u,lid,user):
  row=u.get('market_listings',lid)
  if not row or row['owner_id']!=user['id']:fail('NOT_FOUND','Listing not found.',404)
  return row
 @r.get('/market/policy')
 def policy():return {'first_listing_free_days':TRIAL_DAYS,'free_listing_per_mode':False,'second_hand_free_days':TRIAL_DAYS,'second_hand_unlimited':True,'second_hand_daily_limit':10,'second_hand_offer_starts':'shared_marketplace_trial','exchange_fee_bps':0,'second_hand_fee_bps':0,'shared_access':True,'monthly_access_paise':9900,'auto_renew':False,'default_radius_km':10,'max_value_difference_percent':15,'payments_ready':enabled('REPAIDO_PAYMENTS_ENABLED') and configured('RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET')}
 @r.get('/market/eligibility')
 def eligibility(user=Depends(core.current_user)):
  def read(u):
   state=access_status(u,user['id']);free=state['status'] in ('trial','not_started')
   return {'exchange':free,'second_hand':free,'access':state}
  return store.run(read)
 @r.post('/market/photos')
 async def photo(request:Request,user=Depends(core.current_user)):
  if not user.get('phone_verified'):fail('PHONE_REQUIRED','Verify your mobile number before uploading an item photo.',403)
  def preflight(u):
   state=access_status(u,user['id'])
   if not state['active'] and state['status']!='not_started':require_access(u,user)
  store.run(preflight)
  if not os.getenv('REPAIDO_KYC_BUCKET'):fail('STORAGE_UNAVAILABLE','Photo storage is unavailable. Retry later.',503)
  if store.run(lambda u:sum(x['owner_id']==user['id'] and x['created_at']>time.time()-86400 for x in u.all('market_photos')))>=20:fail('LIMIT','Daily photo limit reached.',429)
  data=await photo_body(request);pid=str(uuid.uuid4());key='market-images/'+pid
  try:upload_object(key,data)
  except Exception:fail('UPLOAD_FAILED','Photo was not saved. Please retry.',503)
  def save(u):
   require_access(u,user,start_trial=True)
   u.put('market_photos',pid,dict(id=pid,owner_id=user['id'],object=key,created_at=time.time()))
  store.run(save)
  return {'id':pid}
 @r.get('/market/photos/{pid}')
 def public_photo(pid:str):
  def read(u):
   p=u.get('market_photos',pid)
   if p:sync_listings(u,p['owner_id'])
   if not p or not any(x['photo_id']==pid and active(x) for x in u.all('market_listings')):fail('NOT_FOUND','Photo unavailable.',404)
   return p
  p=store.run(read)
  try:data=download_object(p['object'])
  except Exception:fail('PHOTO_UNAVAILABLE','Photo unavailable. Retry later.',503)
  return Response(data,media_type='image/jpeg',headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'})
 @r.post('/market/listings')
 def create(body:Listing,user=Depends(core.current_user)):
  if not user.get('phone_verified'):fail('PHONE_REQUIRED','Verify your mobile number before listing an item.',403)
  lid=hashlib.sha256((user['id']+body.request_id).encode()).hexdigest();fingerprint=hashlib.sha256(body.model_dump_json().encode()).hexdigest()
  def save(u):
   old=u.get('market_listings',lid)
   if old:
    if old['fingerprint']!=fingerprint:fail('KEY_REUSED','This draft changed. Start a new listing request.')
    return old
   p=u.get('market_photos',body.photo_id)
   if not p or p['owner_id']!=user['id']:fail('PHOTO_REQUIRED','Upload your own product photo first.',422)
   if sum(x['owner_id']==user['id'] and x['created_at']>time.time()-86400 for x in u.all('market_listings'))>=10:fail('LIMIT','Daily listing limit reached.',429)
   state=require_access(u,user,start_trial=True)
   fee=0
   row=dict(body.model_dump(exclude={'request_id'}),id=lid,owner_id=user['id'],contact_phone=user['phone'],owner_name=user.get('name','Member'),fingerprint=fingerprint,fee_paise=fee,status='awaiting_fee',fee_status='unpaid',created_at=time.time())
   grant_trial(u,row,state)
   u.put('market_listings',lid,row);audit(u,'MarketplaceDraftCreated',user['id'],listing_id=lid);notify_matches(u);return row
  return store.run(save)
 @r.post('/market/{lid}/publish-free')
 def publish_free(lid:str,user=Depends(core.current_user)):
  def save(u):
   row=owned(u,lid,user)
   if row['status'] in ('closed','suspended','payment_review') or row.get('fee_status')=='refunded':fail('NOT_PUBLISHABLE','This listing cannot be published.',409)
   if row.get('fee_status')=='paid':return {'status':view(row)['status']}
   if u.get('market_fees',lid):fail('PAYMENT_RECONCILING','Reconcile the previous listing payment before publishing.',409)
   state=require_access(u,user,start_trial=True)
   grant_trial(u,row,state);u.put('market_listings',lid,row);notify_matches(u);return {'status':'published'}
  return store.run(save)
 @r.get('/market/mine')
 def mine(user=Depends(core.current_user)):
  def read(u):
   sync_listings(u,user['id']);expire_trials(u)
   return {'listings':[{**view(x),'free_eligible':x['status']=='awaiting_fee' and not u.get('market_fees',x['id']) and eligible(u,user['id'],x['mode'],x['id']),'fee_paise':x['fee_paise'],'fee_status':x['fee_status'],'matches':matches(u,x) if x['mode']=='exchange' else []} for x in u.all('market_listings') if x['owner_id']==user['id']]}
  return store.run(read)
 @r.post('/market/search')
 def search(body:Area):
  def read(u):
   refresh_access_rows(u);rows=[]
   for x in u.all('market_listings'):
    if not active(x) or x['mode']!=body.mode:continue
    distance=metres(body.location.model_dump(),x['location'])/1000
    if distance<=body.radius_km and body.query.casefold() in (x['name']+' '+x['brand']+' '+x['product_type']).casefold():rows.append({**view(x),'distance_km':round(distance,1)})
   return {'items':sorted(rows,key=lambda x:(x['distance_km'],x['id']))[:100]}
  return store.run(read)
 @r.post('/market/{lid}/radius')
 def radius(lid:str,body:Radius,user=Depends(core.current_user)):
  def save(u):
   x=owned(u,lid,user);require_access(u,user,start_trial=True);x['radius_km']=body.radius_km;u.put('market_listings',lid,x);notify_matches(u);return {'status':'saved'}
  return store.run(save)
 @r.post('/market/{lid}/close')
 def close(lid:str,user=Depends(core.current_user)):
  def save(u):
   x=owned(u,lid,user)
   claim=u.get('market_handover_claims',lid)
   if claim:
    handover=u.get('market_transactions',claim['chat_id'])
    if not handover or handover['state']!='completed':fail('HANDOVER_IN_PROGRESS','Complete the confirmed handover before closing this listing. Contact support if there is a handover concern.',409)
   x['status']='closed';u.put('market_listings',lid,x);audit(u,'MarketplaceListingClosed',user['id'],listing_id=lid);return {'status':'closed'}
  return store.run(save)
 @r.get('/market/{lid}/contact')
 def contact(lid:str,user=Depends(core.current_user)):
  def read(u):
   x=u.get('market_listings',lid)
   if x:sync_listings(u,x['owner_id']);x=u.get('market_listings',lid)
   if not x or not active(x):fail('NOT_FOUND','This listing is no longer available.',404)
   require_access(u,user,start_trial=True)
   if x['mode']=='exchange' and not any(a['owner_id']==user['id'] and pair(a,x) for a in u.all('market_listings')):fail('MATCH_REQUIRED','Contact details are available only for an active match to your published exchange listing.',403)
   audit(u,'MarketplaceContactViewed',user['id'],listing_id=lid)
   return {'name':x['owner_name'],'phone':x['contact_phone']}
  return store.run(read)
 @r.post('/market/{lid}/report')
 def report(lid:str,body:Report,user=Depends(core.current_user)):
  def save(u):
   if not u.get('market_listings',lid):fail('NOT_FOUND','Listing unavailable.',404)
   rid=hashlib.sha256((lid+user['id']).encode()).hexdigest();u.put('market_reports',rid,dict(id=rid,listing_id=lid,user_id=user['id'],reason=body.reason,created_at=time.time(),status='open'));return {'status':'reported'}
  return store.run(save)
 def check_payment(lid):
  p=store.run(lambda u:u.get('market_fees',lid))
  if not p:return {'status':'unpaid'}
  if not p.get('order_id'):
   orders=[x for x in razorpay('orders?receipt='+p['receipt']).get('items',[]) if x.get('receipt')==p['receipt']]
   if len(orders)!=1:return {'status':'reconciling'}
   if orders[0].get('amount')!=p['amount'] or orders[0].get('currency')!='INR':fail('PAYMENT_MISMATCH','Contact support to reconcile this fee.')
   def attach(u):
    current=u.get('market_fees',lid);current['order_id']=orders[0]['id'];u.put('market_fees',lid,current);return current
   p=store.run(attach)
  payments=razorpay('orders/'+p['order_id']+'/payments').get('items',[])
  valid=[x for x in payments if x.get('status') in ('captured','refunded') and x.get('order_id')==p['order_id'] and x.get('amount')==p['amount'] and x.get('currency')=='INR']
  def apply(u):
   x=u.get('market_listings',lid);saved=u.get('market_fees',lid)
   if len(valid)>1:x['fee_status']='review_required';x['status']='payment_review'
   elif valid:
    payment=valid[0];refunded=payment.get('amount_refunded',0)>0 or payment.get('status')=='refunded'
    if refunded or x.get('fee_status')=='refunded':x.update(fee_status='refunded',status='closed')
    else:
     x['fee_status']='paid'
     if x['status'] in ('awaiting_fee','expired') or x['status']=='published':x.update(status='published',expires_at=None)
     if not saved.get('payment_id'):audit(u,'MarketplaceFeeVerified','gateway',listing_id=lid,amount_paise=p['amount'],payment_id=payment['id'])
    saved['payment_id']=payment['id'];saved['status']=x['fee_status']
   saved['checked_at']=time.time();u.put('market_fees',lid,saved)
   u.put('market_listings',lid,x);notify_matches(u);return {'status':x['fee_status'],'listing_status':x['status']}
  return store.run(apply)
 @r.post('/market/{lid}/payment-order')
 def order(lid:str,user=Depends(core.current_user)):
  if not policy()['payments_ready']:fail('PAYMENTS_UNAVAILABLE','Paid listing checkout is not available yet. No charge was made. A free listing still ends on its displayed expiry date. Please contact support or retry later.',503)
  def reserve(u):
   x=owned(u,lid,user);old=u.get('market_fees',lid)
   if x['status'] in ('closed','suspended','payment_review') or x.get('fee_status') in ('paid','refunded'):fail('NOT_PAYABLE','This listing cannot take another payment.')
   if old:return old
   fail('SHARED_ACCESS_REQUIRED','Listing fees have been replaced by shared marketplace access. Start your free trial or renew for ₹99 per month.',402)
  p=store.run(reserve)
  if not p.get('order_id'):fail('RECONCILING','Check payment status before retrying. We will not create a duplicate fee order.')
  return {'key_id':os.environ['RAZORPAY_KEY_ID'],'order_id':p['order_id'],'amount':p['amount'],'currency':'INR'}
 @r.post('/market/{lid}/payment-check')
 def check(lid:str,user=Depends(core.current_user)):
  store.run(lambda u:owned(u,lid,user));return check_payment(lid)
 @r.get('/admin/market')
 def admin_market(admin=Depends(core.operator)):
  return store.run(lambda u:{'listings':[{**view(x),'fee_status':x['fee_status'],'fee_paise':x['fee_paise']} for x in u.all('market_listings')],'reports':u.all('market_reports')})
 @r.post('/admin/market/{lid}/hide')
 def hide(lid:str,body:Report,admin=Depends(core.operator)):
  def save(u):
   x=u.get('market_listings',lid)
   if not x:fail('NOT_FOUND','Listing unavailable.',404)
   x['status']='suspended';u.put('market_listings',lid,x);audit(u,'MarketplaceHidden',admin['id'],listing_id=lid,reason=body.reason);return {'status':'suspended'}
  return store.run(save)
 @r.get('/service-terms/{sid}')
 def terms(sid:str):return store.run(lambda u:u.get('service_terms',sid) or {'id':sid,'version':0,'text':'Company-specific terms have not been published for this service. Review the included work, exclusions and cancellation policy before requesting a visit.'})
 @r.put('/admin/service-terms/{sid}')
 def save_terms(sid:str,body:Terms,admin=Depends(core.operator)):
  def save(u):
   old=u.get('service_terms',sid) or {'version':0}
   if old['version']!=body.expected_version:fail('STALE_TERMS','Terms changed. Reload before saving.')
   row=dict(id=sid,version=old['version']+1,text=body.text,updated_at=time.time());u.put('service_terms',sid,row);audit(u,'ServiceTermsPublished',admin['id'],service_id=sid,version=row['version']);return row
  return store.run(save)
 def tick():
  access=core.market_access_tick() if hasattr(core,'market_access_tick') else {'attempted':0,'errors':0}
  failures=0;expired=store.run(expire_trials)
  if policy()['payments_ready']:
   for p in store.run(lambda u:sorted([p for p in u.all('market_fees') if p.get('checked_at',0)<time.time()-300],key=lambda p:p.get('checked_at',0)))[:30]:
    try:check_payment(p['id'])
    except Exception:failures+=1
  return {'reconciliation_failures':failures,'expired_listings':expired,'access_reconciliation':access}
 core.market_tick=tick;core.app.include_router(r)
