"""Workspace media, private onboarding selfie and transparent local rankings."""
import io,json,math,os,time,uuid,hashlib
from fastapi import APIRouter,Depends,Request,Response
from PIL import Image,ImageOps
from operations import fail,Input,Pin,metres
from integrations import audit
from evidence import upload_object,download_object

class Claim(Input):
    expected_version:int
    release:bool=False

class Area(Input):
    location:Pin
    category:str=''

def image_bytes(data):
    try:
        with Image.open(io.BytesIO(data)) as im:
            if im.format not in ('JPEG','PNG') or im.width*im.height>20_000_000:raise ValueError()
            im=ImageOps.exif_transpose(im);im.thumbnail((1600,1600));out=io.BytesIO();im.convert('RGB').save(out,format='JPEG',quality=85)
            return out.getvalue()
    except Exception:fail('INVALID_IMAGE','Choose a valid JPEG or PNG photo under 5 MB.',422)

async def photo_body(request):
    if request.headers.get('content-type') not in ('image/jpeg','image/png'):fail('IMAGE_REQUIRED','Choose a JPG or PNG photo.',422)
    data=bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data)>5*1024*1024:fail('IMAGE_TOO_LARGE','Choose an image smaller than 5 MB.',413)
    return image_bytes(bytes(data))

def validate_media(u,url,shop_id):
    if not url.startswith('/api/operations/media/'):return
    row=u.get('listing_media',url.rsplit('/',1)[-1])
    if not row or row['shop_id']!=shop_id:fail('INVALID_PHOTO','Choose a photo uploaded by your shop.',422)

def install(core):
    r=APIRouter(prefix='/operations');store=core.operations_store
    def approved_shop(u,user):
        s=next((s for s in u.all('shops') if s.get('owner_id')==user['id'] and s.get('status')=='approved'),None)
        if not s:fail('SHOP_REQUIRED','An approved shop account is required.',403)
        return s
    @r.get('/products/catalog')
    def products():
        from procurement import live_product
        from shop_prime import public_prime
        def read(u):
            items=[];shops={}
            for p in u.all('inventory'):
                if not live_product(u,p,time.time()) or p['stock']<=0:continue
                shop=u.get('shops',p['shop_id']);shops[shop['id']]={k:shop.get(k) for k in ('id','name','address','city','location')}
                prime=public_prime(u,shop)
                shops[shop['id']]['prime']=prime
                items.append({'prime':prime,**{k:p.get(k) for k in ('id','shop_id','name','sku','category','compatibility','price_paise','stock','image_url','stock_confirmed_at','gst_bps','condition','warranty','refurbishment_details','refurbishment')}})
            return {'items':sorted(items,key=lambda p:not p['prime']['active']),'shops':sorted(shops.values(),key=lambda s:not s['prime']['active'])}
        return store.run(read)
    @r.post('/shop/photos')
    async def upload_photo(request:Request,user=Depends(core.current_user)):
        if not os.getenv('REPAIDO_KYC_BUCKET'):fail('STORAGE_UNAVAILABLE','Photo storage unavailable. Retry later.',503)
        if not user.get('phone_authenticated'):fail('PHONE_OTP_REQUIRED','Use shop mobile OTP sign-in before uploading.',403)
        s=store.run(lambda u:approved_shop(u,user))
        def quota(u):
            if sum(m.get('created_at',0)>time.time()-86400 and m.get('shop_id')==s['id'] for m in u.all('listing_media'))>=50:fail('PHOTO_LIMIT','Daily photo limit reached. Try again tomorrow.',429)
        store.run(quota);data=await photo_body(request);mid=str(uuid.uuid4());key='listing-media/'+mid
        try:upload_object(key,data)
        except Exception:fail('UPLOAD_FAILED','Photo could not upload. Your other fields are unchanged; retry.',503)
        row=dict(id=mid,shop_id=s['id'],object=key,created_at=time.time())
        store.run(lambda u:u.put('listing_media',mid,row))
        return {'image_url':'/api/operations/media/'+mid}
    @r.get('/media/{mid}')
    def media(mid:str):
        def read(u):
            m=u.get('listing_media',mid)
            if not m:fail('NOT_FOUND','Photo unavailable.',404)
            s=u.get('shops',m['shop_id']);url='/api/operations/media/'+mid
            published=any(p.get('image_url')==url and p.get('shop_id')==m['shop_id'] and p.get('status')=='approved' for p in u.all('inventory')) or any(p.get('image_url')==url and p.get('shop_id')==m['shop_id'] and p.get('active') for p in u.all('rental_inventory'))
            if not s or s['status']!='approved' or not published:fail('NOT_FOUND','Photo is not published.',404)
            return m
        m=store.run(read)
        try:data=download_object(m['object'])
        except Exception:fail('PHOTO_UNAVAILABLE','Photo unavailable.',503)
        return Response(data,media_type='image/jpeg',headers={'Cache-Control':'public,max-age=300','X-Content-Type-Options':'nosniff'})
    @r.post('/worker/selfie-session')
    def selfie_session(user=Depends(core.current_user)):
        def save(u):
            if not user.get('phone_verified') or not u.get('workers',user['id']):fail('WORKER_REQUIRED','Save your phone-verified worker profile first.',403)
            if sum(c.get('worker_id')==user['id'] and c.get('issued_at',0)>time.time()-3600 for c in u.all('selfie_sessions'))>=12:fail('CAPTURE_LIMIT','Too many selfie attempts. Retry later or contact support.',429)
            if sum(d.get('worker_id')==user['id'] and d.get('created_at',0)>time.time()-86400 for d in u.all('documents'))>=12:fail('UPLOAD_LIMIT','Daily private upload limit reached.',429)
            s=dict(id=str(uuid.uuid4()),worker_id=user['id'],issued_at=time.time(),expires_at=time.time()+600)
            u.put('selfie_sessions',s['id'],s);return {'id':s['id'],'expires_at':s['expires_at']}
        return store.run(save)
    @r.post('/worker/selfies/{sid}')
    async def selfie(sid:str,request:Request,user=Depends(core.current_user)):
        if request.headers.get('x-verification-consent')!='private-review-v1':fail('CONSENT_REQUIRED','Agree to private manual identity review first.',422)
        if not os.getenv('REPAIDO_KYC_BUCKET'):fail('STORAGE_UNAVAILABLE','Private photo storage unavailable.',503)
        def check(u):
            s=u.get('selfie_sessions',sid)
            if not s or s['worker_id']!=user['id'] or not user.get('phone_verified'):fail('NOT_FOUND','Capture session unavailable.',404)
            if s['expires_at']<time.time():fail('EXPIRED','Selfie session expired. Retake the photo.')
            if (u.get('verification',user['id']) or {}).get('identity_status')=='approved':fail('REVIEW_LOCKED','Contact support to change approved identity evidence.')
            return s
        session=store.run(check);data=await photo_body(request);checksum=hashlib.sha256(data).hexdigest()
        def reserve(u):
            check(u);old=u.get('documents',sid)
            if old and old.get('sha256')!=checksum:fail('CAPTURE_REUSED','Retake this selfie in a new session.')
            return old
        old=store.run(reserve)
        if old and old['status']=='pending_review':return {'id':sid,'status':'pending_review'}
        key='verification-selfies/'+user['id']+'/'+sid
        try:upload_object(key,data)
        except Exception:
            try:
                if hashlib.sha256(download_object(key)).hexdigest()!=checksum:raise ValueError()
            except Exception:fail('UPLOAD_FAILED','Selfie upload could not be confirmed. Retry this photo.',503)
        def finish(u):
            check(u);d=dict(id=sid,worker_id=user['id'],kind='selfie',content_type='image/jpeg',size=len(data),created_at=time.time(),capture_session_issued_at=session['issued_at'],expires_at=time.time()+30*86400,object=key,sha256=checksum,status='pending_review',consent_version='private-review-v1',provenance='Live browser camera flow; server receipt timestamp, not liveness or hardware attestation')
            u.put('documents',sid,d);v=u.get('verification',user['id']) or {'bank_status':'not_verified'};v['identity_status']='pending_review';u.put('verification',user['id'],v);audit(u,'SelfieSubmitted',user['id'],document_id=sid)
        store.run(finish);return {'id':sid,'status':'pending_review'}
    @r.post('/admin/support/{case_id}/claim')
    def claim(case_id:str,body:Claim,admin=Depends(core.operator)):
        def save(u):
            c=u.get('support_cases',case_id)
            if not c:fail('NOT_FOUND','Support case not found.',404)
            if c['version']!=body.expected_version:fail('CASE_CHANGED','Someone updated this case. Refresh before claiming it.')
            if c.get('assigned_to') not in (None,admin['id']):fail('CASE_ASSIGNED','Another teammate owns this case. Ask them to release it before taking over.')
            c.update(assigned_to=None if body.release else admin['id'],version=c['version']+1,updated_at=time.time());u.put('support_cases',case_id,c);audit(u,'SupportOwnershipChanged',admin['id'],case_id=case_id,release=body.release);return c
        return store.run(save)
    @r.get('/admin/audit-history')
    def history(admin=Depends(core.operator)):
        return store.run(lambda u:{'entries':[{k:a.get(k) for k in ('id','action','actor_id','at')} for a in sorted(u.all('audit'),key=lambda a:a.get('at',0),reverse=True)[:100]]})
    @r.get('/admin/onboarding-overview')
    def overview(admin=Depends(core.operator)):
        def read(u):
            rows=[]
            for w in u.all('workers'):
                v=u.get('verification',w['id']) or {};docs=[d for d in u.all('documents') if d['worker_id']==w['id'] and d['expires_at']>time.time() and d['status']=='pending_review']
                rows.append({**{k:w.get(k) for k in ('id','name','city','status','role','requested_role','skills','tools','experience_years','created_at','dob','home_address','phone','location','radius_km','categories','terms_version')},'identity_status':v.get('identity_status','not_submitted'),'bank_status':v.get('bank_status','not_verified'),'document_kinds':sorted(set(d['kind'] for d in docs)),'ready':(v.get('identity_status')=='approved' or {'identity','pan','address','tools'} <= {d['kind'] for d in docs})})
            audit(u,'OnboardingOverviewViewed',admin['id']);return {'workers':rows}
        return store.run(read)
    @r.post('/discovery/leaderboard')
    def leaderboard(body:Area):
        # Local equal-scale approximation; zones are navigation groupings, not service coverage.
        def read(u):
            rows=[]
            for w in u.all('workers'):
                if w['status']!='approved' or (body.category and body.category not in w['categories']):continue
                p=w.get('position')
                if not p or time.time()-p.get('received_at',0)>900:continue
                distance=metres(body.location.model_dump(),p)
                if distance>20000:continue
                x=(p['lng']-body.location.lng)*111.32*math.cos(math.radians(body.location.lat));y=(p['lat']-body.location.lat)*110.57
                q=(math.sqrt(3)/3*x-y/3)/8;rhex=(2*y/3)/8
                a,b,c=round(q),round(-q-rhex),round(rhex);da,db,dc=abs(a-q),abs(b+q+rhex),abs(c-rhex)
                if da>db and da>dc:a=-b-c
                elif dc>db:c=-a-b
                n=w.get('rating_count',0);avg=w.get('rating_sum',0)/n if n else None
                rows.append(dict(id=w['id'],name=w['name'],role=w['role'],categories=w['categories'],skills=w['skills'],completed_tasks=w.get('completed_tasks',0),rating=avg,review_count=n,zone=f'{a}:{c}',distance_km=round(distance/1000),online=w.get('online',False)))
            rows.sort(key=lambda w:(-(w['rating'] or 0),-w['review_count'],-w['completed_tasks'],w['distance_km'],w['id']))
            service_scores={}
            for j in u.all('jobs'):
                if j['state']!='completed' or not j.get('review') or not j.get('location') or metres(body.location.model_dump(),j['location'])>20000 or (body.category and j['category']!=body.category):continue
                key=j['service_id'];entry=service_scores.setdefault(key,dict(id=key,name=j['service_name'],ratings=[]));entry['ratings'].append(j['review']['rating'])
            services=sorted([dict(id=s['id'],name=s['name'],rating=sum(s['ratings'])/len(s['ratings']),review_count=len(s['ratings'])) for s in service_scores.values()],key=lambda s:(-s['rating'],-s['review_count'],s['id']))
            return {'agents':rows[:50],'services':services[:30],'radius_km':20,'zone_radius_km':8,'method':'Verified review average, review count, completed tasks, then straight-line distance. Unreviewed agents show New. Zones are approximate 8 km hexagons centered on this search; 20 km is discovery only.'}
        return store.run(read)
    core.app.include_router(r)
