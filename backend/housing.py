"""Moderated home listings and private viewing enquiries; no tenancy/payment claims."""
import hashlib
import os
import time
import uuid
from typing import Literal
from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import Field, model_validator, field_validator
from operations import Input, fail
from integrations import audit
from workspace import photo_body
from evidence import upload_object, download_object

PUBLIC = ('id','version','title','city','locality','property_type','bedrooms','furnishing','rent_paise','deposit_paise','description','available_from','photo_id','status','updated_at')

def public(row):
    return {**{k:row.get(k) for k in PUBLIC},'image_url':'/api/operations/homes/photos/'+row['photo_id']}

def key(*parts):
    return hashlib.sha256(':'.join(parts).encode()).hexdigest()

class Listing(Input):
    expected_version:int=Field(ge=0)
    title:str=Field(min_length=5,max_length=100)
    city:str=Field(min_length=2,max_length=80)
    locality:str=Field(min_length=2,max_length=100)
    property_type:Literal['apartment','house','room']='apartment'
    bedrooms:int=Field(ge=0,le=20)
    furnishing:Literal['unfurnished','semi-furnished','furnished']='unfurnished'
    rent_paise:int=Field(gt=0,le=100000000)
    deposit_paise:int=Field(ge=0,le=1000000000)
    description:str=Field(min_length=20,max_length=2000)
    available_from:str=Field(pattern=r'^\d{4}-\d{2}-\d{2}$')
    photo_id:str=Field(min_length=1,max_length=100)
    authority_confirmed:Literal[True]
    @model_validator(mode='after')
    def valid(self):
        from datetime import date
        date.fromisoformat(self.available_from)
        for k in ('title','city','locality','description'):
            value=getattr(self,k).strip()
            if len(value)<({'description':20,'title':5}.get(k,2)):raise ValueError('Complete the property details.')
            setattr(self,k,value)
        return self

class Review(Input):
    expected_version:int=Field(ge=1)
    decision:Literal['published','rejected','paused']
    reason:str=Field(min_length=10,max_length=500)
    @field_validator('reason')
    @classmethod
    def valid_reason(cls,value):
        if len(value.strip())<10:raise ValueError('Describe the review findings.')
        return value.strip()

class State(Input):
    expected_version:int=Field(ge=1)
    state:Literal['paused','let','pending_review']

class Enquiry(Input):
    message:str=Field(min_length=5,max_length=1000)
    viewing_at:float=Field(gt=0)
    request_id:str|None=Field(default=None,min_length=16,max_length=100)
    @field_validator('message')
    @classmethod
    def valid_message(cls,value):
        if len(value.strip())<5:raise ValueError('Write a message to the owner.')
        return value.strip()

class Reply(Input):
    expected_version:int=Field(ge=1)
    action:Literal['reply','confirm_viewing','decline','cancel','complete']
    message:str=Field(min_length=1,max_length=1000)
    request_id:str=Field(min_length=16,max_length=100)
    @field_validator('message')
    @classmethod
    def valid_message(cls,value):
        if not value.strip():raise ValueError('Write a message.')
        return value.strip()

def install(core):
    r=APIRouter(prefix='/operations');store=core.operations_store
    def phone(user):
        if not user.get('phone_verified'):fail('PHONE_REQUIRED','Verify your mobile number first.',403)
    def note(u,uid,rid,title,tab='enquiries'):
        nid=str(uuid.uuid4())
        u.put('notifications',nid,dict(id=nid,user_id=uid,title=title,body='Open Rentals → Homes → '+('My properties.' if tab=='mine' else 'My enquiries.'),destination='homes',homes_tab=tab,created_at=time.time(),record_id=rid))
    def owner(u,lid,user):
        row=u.get('home_listings',lid)
        if not row or row['owner_id']!=user['id']:fail('NOT_FOUND','Home not found.',404)
        return row
    @r.post('/homes/photos')
    async def upload(request:Request,user=Depends(core.current_user)):
        phone(user)
        if not os.getenv('REPAIDO_KYC_BUCKET'):fail('STORAGE_UNAVAILABLE','Photo storage is unavailable.',503)
        upload_id=request.headers.get('X-Upload-ID') or str(uuid.uuid4())
        try:upload_id=str(uuid.UUID(upload_id))
        except ValueError:fail('UPLOAD_ID','Use a valid upload ID.',422)
        data=await photo_body(request);digest=hashlib.sha256(data).hexdigest()
        now=time.time();budget_id=key(user['id'],str(int(now//86400)))
        pid=key(user['id'],upload_id);object_key='home-images/'+pid
        def reserve(u):
            previous=u.get('home_photo_commands',pid)
            if previous:
                if previous['digest']!=digest:fail('REUSED_KEY','Use a new upload ID for a different photo.',409)
                return bool(u.get('home_photos',pid))
            budget=u.get('home_photo_budget',budget_id) or {'count':0}
            if budget['count']>=20:fail('LIMIT','Daily photo upload limit reached.',429)
            budget['count']+=1;u.put('home_photo_budget',budget_id,budget)
            u.put('home_photo_commands',pid,dict(digest=digest,created_at=now))
            return False
        if store.run(reserve):return {'id':pid}
        try:upload_object(object_key,data)
        except Exception:
            # Object creation can succeed before a response is lost. Storage uses
            # create-only writes; accept the existing object only if it matches.
            try:stored=download_object(object_key)
            except Exception:fail('UPLOAD_FAILED','Photo upload failed. Retry later.',503)
            if hashlib.sha256(stored).hexdigest()!=digest:fail('UPLOAD_FAILED','Photo upload failed. Retry later.',503)
        store.run(lambda u:u.put('home_photos',pid,dict(id=pid,owner_id=user['id'],object=object_key,created_at=now)))
        return {'id':pid}
    @r.get('/admin/homes/photos/{pid}',dependencies=[Depends(core.operator)])
    def review_photo(pid:str):
        p=store.run(lambda u:u.get('home_photos',pid))
        if not p:fail('NOT_FOUND','Photo unavailable.',404)
        try:data=download_object(p['object'])
        except Exception:fail('UNAVAILABLE','Photo unavailable.',503)
        return Response(data,media_type='image/jpeg',headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'})
    @r.get('/homes/photos/{pid}')
    def image(pid:str):
        def read(u):
            p=u.get('home_photos',pid)
            if not p or not any(x['status']=='published' for x in u.find('home_listings','photo_id',pid,limit=100)):fail('NOT_FOUND','Photo unavailable.',404)
            return p
        p=store.run(read)
        try:data=download_object(p['object'])
        except Exception:fail('UNAVAILABLE','Photo unavailable.',503)
        return Response(data,media_type='image/jpeg',headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'})
    @r.get('/homes/catalog')
    def catalog(city:str=Query(default='',max_length=80),max_rent:int=Query(default=0,ge=0),bedrooms:int=Query(default=-1,ge=-1,le=20),cursor:str=Query(default='',max_length=100)):
        def read(u):
            rows=u.find('home_listings','city_key',city.strip().casefold(),limit=100,after=cursor) if city.strip() else u.find('home_listings','status','published',limit=100,after=cursor)
            items=[public(x) for x in rows if x['status']=='published' and (not max_rent or x['rent_paise']<=max_rent) and (bedrooms<0 or x['bedrooms']==bedrooms)]
            return {'items':items,'next_cursor':rows[-1]['id'] if len(rows)==100 else None}
        return store.run(read)
    @r.get('/homes/mine')
    def mine(user=Depends(core.current_user)):
        return store.run(lambda u:{'items':[{**public(x),'review_reason':x.get('review_reason','')} for x in u.find('home_listings','owner_id',user['id'],limit=100)]})
    @r.get('/homes/listings/{lid}')
    def details(lid:str):
        def read(u):
            row=u.get('home_listings',lid)
            if not row or row['status']!='published':fail('NOT_FOUND','This property is no longer available.',404)
            return public(row)
        return store.run(read)
    @r.put('/homes/listings/{lid}')
    def save(lid:uuid.UUID,body:Listing,user=Depends(core.current_user)):
        phone(user);lid=str(lid)
        def write(u):
            old=u.get('home_listings',lid)
            if old and old['owner_id']!=user['id']:fail('NOT_FOUND','Home not found.',404)
            if old and old['version']==body.expected_version+1 and old['status']=='pending_review' and all(old.get(k)==v for k,v in body.model_dump(exclude={'expected_version'}).items()):return public(old)
            if (old or {}).get('version',0)!=body.expected_version:fail('STALE','Refresh before editing.',409)
            if not old and len(u.find('home_listings','owner_id',user['id'],limit=100))>=100:fail('LIMIT','Maximum 100 properties per account.',409)
            p=u.get('home_photos',body.photo_id)
            if not p or p['owner_id']!=user['id']:fail('PHOTO_REQUIRED','Upload your own property photo.',422)
            row=dict(body.model_dump(exclude={'expected_version'}),id=lid,owner_id=user['id'],city_key=body.city.casefold(),version=body.expected_version+1,status='pending_review',updated_at=time.time())
            u.put('home_listings',lid,row);audit(u,'HomeSubmitted',user['id'],listing_id=lid)
            return public(row)
        return store.run(write)
    @r.post('/homes/listings/{lid}/state')
    def state(lid:str,body:State,user=Depends(core.current_user)):
        def write(u):
            row=owner(u,lid,user)
            if row['version']==body.expected_version+1 and row['status']==body.state:return public(row)
            if row['version']!=body.expected_version:fail('STALE','Refresh this property.',409)
            allowed={'pending_review':{'paused'},'published':{'paused','let'},'rejected':{'pending_review'},'paused':{'pending_review','let'},'let':{'pending_review'}}
            if body.state not in allowed.get(row['status'],set()):fail('INVALID_STATE','This property cannot make that change. Refresh it first.',409)
            row.update(status=body.state,version=row['version']+1,updated_at=time.time());u.put('home_listings',lid,row)
            audit(u,'HomeStateChanged',user['id'],listing_id=lid,state=body.state)
            return public(row)
        return store.run(write)
    @r.get('/admin/homes',dependencies=[Depends(core.operator)])
    def queue():return store.run(lambda u:{'items':[public(x) for x in u.find('home_listings','status','pending_review',limit=100)]})
    @r.post('/admin/homes/{lid}/review')
    def review(lid:str,body:Review,admin=Depends(core.operator)):
        def write(u):
            row=u.get('home_listings',lid)
            if not row:fail('NOT_FOUND','Home not found.',404)
            if row['version']==body.expected_version+1 and row['status']==body.decision and row.get('review_reason')==body.reason:return public(row)
            if row['version']!=body.expected_version:fail('STALE','Refresh this property.',409)
            if row['status']!=('published' if body.decision=='paused' else 'pending_review'):fail('INVALID_STATE','This listing is no longer awaiting this review.',409)
            if body.decision=='published' and not u.get('home_photos',row['photo_id']):fail('PHOTO_REQUIRED','The property photo is unavailable.',409)
            row.update(status=body.decision,review_reason=body.reason,version=row['version']+1,updated_at=time.time())
            u.put('home_listings',lid,row);audit(u,'HomeReviewed',str(admin),listing_id=lid,decision=body.decision,reason=body.reason)
            note(u,row['owner_id'],lid,'Property listing reviewed',tab='mine');return public(row)
        return store.run(write)
    @r.post('/homes/listings/{lid}/enquiry')
    def enquire(lid:str,body:Enquiry,user=Depends(core.current_user)):
        phone(user)
        def write(u):
            eid=key(lid,user['id']);old=u.get('home_enquiries',eid)
            command_id=key(eid,body.request_id) if body.request_id else None
            fingerprint=key(body.model_dump_json(exclude={'request_id'}))
            prior=u.get('home_enquiry_commands',command_id) if command_id else None
            if prior:
                if prior['fingerprint']!=fingerprint:fail('REUSED_KEY','Use a new request ID.',409)
                return old
            if old and (not command_id or old['state'] not in ('declined','cancelled','completed')):
                if command_id:fail('ACTIVE_ENQUIRY','You already have an active enquiry for this home. Open My enquiries to continue it.',409)
                return old
            row=u.get('home_listings',lid)
            if not row or row['status']!='published':fail('NOT_FOUND','This property is no longer available.',404)
            if row['owner_id']==user['id']:fail('OWN_PROPERTY','You cannot enquire about your own property.',409)
            if not time.time()<body.viewing_at<time.time()+90*86400:fail('VIEWING_TIME','Choose a viewing in the next 90 days.',422)
            if not old and len(u.find('home_enquiries','customer_id',user['id'],limit=100))>=100:fail('LIMIT','Enquiry limit reached.',429)
            messages=old['messages'] if old else []
            if len(messages)>=100:fail('LIMIT','Conversation limit reached.',409)
            messages.append(dict(side='customer',text=body.message,at=time.time(),kind='viewing_request',viewing_at=body.viewing_at))
            out=dict(id=eid,listing_id=lid,title=row['title'],owner_id=row['owner_id'],customer_id=user['id'],version=old['version']+1 if old else 1,state='requested',viewing_at=body.viewing_at,updated_at=time.time(),messages=messages)
            if command_id:u.put('home_enquiry_commands',command_id,dict(fingerprint=fingerprint))
            u.put('home_enquiries',eid,out);note(u,row['owner_id'],eid,'New property viewing enquiry');return out
        result=store.run(write)
        return {k:v for k,v in result.items() if k not in ('owner_id','customer_id')}
    @r.get('/homes/enquiries')
    def enquiries(user=Depends(core.current_user)):
        def read(u):
            rows={x['id']:x for field in ('owner_id','customer_id') for x in u.find('home_enquiries',field,user['id'],limit=100)}
            return {'items':[{**{k:v for k,v in x.items() if k not in ('owner_id','customer_id')},'is_owner':x['owner_id']==user['id']} for x in sorted(rows.values(),key=lambda x:x['updated_at'],reverse=True)]}
        return store.run(read)
    @r.post('/homes/enquiries/{eid}/reply')
    def reply(eid:str,body:Reply,user=Depends(core.current_user)):
        def write(u):
            row=u.get('home_enquiries',eid)
            if not row or user['id'] not in (row['owner_id'],row['customer_id']):fail('NOT_FOUND','Enquiry not found.',404)
            rid=key(eid,user['id'],body.request_id);prior=u.get('home_reply_commands',rid)
            fingerprint=key(body.model_dump_json())
            if prior:
                if prior['fingerprint']!=fingerprint:fail('REUSED_KEY','Use a new request ID.',409)
                return {'saved':True}
            if row['version']!=body.expected_version:fail('STALE','Refresh this enquiry before replying.',409)
            if row['state'] in ('declined','cancelled','completed'):fail('CLOSED','This enquiry is closed.',409)
            is_owner=row['owner_id']==user['id'];action=body.action
            if action in ('confirm_viewing','decline','complete') and not is_owner:fail('FORBIDDEN','Only the property owner can do this.',403)
            if action=='cancel' and is_owner:fail('FORBIDDEN','Use decline for owner cancellation.',403)
            if action=='confirm_viewing':
                if row['state']!='requested':fail('INVALID_STATE','This viewing has already been confirmed.',409)
                home=u.get('home_listings',row['listing_id'])
                if not home or home['status']!='published' or row['viewing_at']<=time.time():fail('UNAVAILABLE','Property or viewing time is no longer available.',409)
            if action=='complete' and (row['state']!='confirmed' or row['viewing_at']>time.time()):fail('NOT_READY','Complete a confirmed viewing after its scheduled time.',409)
            if len(row['messages'])>=100:fail('LIMIT','Conversation limit reached.',409)
            row['messages'].append(dict(side='owner' if is_owner else 'customer',text=body.message,at=time.time()))
            row.update(state={'confirm_viewing':'confirmed','decline':'declined','cancel':'cancelled','complete':'completed'}.get(action,row['state']),version=row['version']+1,updated_at=time.time())
            u.put('home_enquiries',eid,row);u.put('home_reply_commands',rid,{'fingerprint':fingerprint})
            note(u,row['customer_id'] if is_owner else row['owner_id'],eid,'Property enquiry updated')
            return {'saved':True}
        return store.run(write)
    core.app.include_router(r)
