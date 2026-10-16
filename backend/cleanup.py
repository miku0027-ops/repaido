"""Private public-place reports, authorised cleanups and Repaido-funded cash rewards.

A report is not a claim of ownership. No automated municipal dispatch or payment.
Points are earned once, only after independent completion review.
"""
import copy
import time
from typing import Literal
from fastapi import APIRouter, Depends, Response, Query
from pydantic import Field
from operations import Input, Pin, Position, fail, metres
from local_business import current, document, digest, fingerprint, event, notice
from evidence import download_object

STATES=('reported','approved','assigned','verification','completed','rejected','referred','cancelled')
OPEN={'reported','approved','assigned','verification'}
POINTS=10
CAPTAIN=100
class Report(Input):
    request_id:str=Field(min_length=16,max_length=100)
    category:Literal['dry_recyclables','mixed_litter','bulky_waste','hazardous']
    description:str=Field(min_length=10,max_length=1500)
    address:str=Field(min_length=10,max_length=500)
    city:str=Field(min_length=2,max_length=80)
    location:Pin
    document_ids:list[str]=Field(min_length=1,max_length=3)
    public_place:Literal[True]
class Action(Input):
    action:Literal['approve','reject','refer','accept','self_accept','release','reassign','submit','verify','rework','cancel','record_cash','received','payment_concern','resolve_payment']
    expected_version:int=Field(ge=1)
    command_id:str=Field(min_length=16,max_length=100)
    note:str=Field(default='',max_length=1500)
    reference:str=Field(default='',max_length=200)
    reward_paise:int=Field(default=0,ge=0,le=100000,strict=True)
    allow_independent:bool=False
    funding_reference:str=Field(default='',max_length=200)
    document_ids:list[str]=Field(default_factory=list,max_length=3)
    position:Position|None=None


def exposed(row,admin=False):
    result=copy.deepcopy(row)
    for field in ('request_hash','funding_reference','authority_reference'):
        if not admin:result.pop(field,None)
    result.pop('request_hash',None)
    return result

def report_row(u,identifier):
    row=u.get('cleanup_reports',identifier)
    if not row:fail('NOT_FOUND','Report not found.',404)
    return row

def evidence(u,ids,uid,report_id):
    if len(set(ids))!=len(ids):fail('DUPLICATE_PHOTO','Choose different evidence photos.',422)
    for identifier in ids:
        document(u,identifier,uid)
        if (u.get('captain_profiles',uid) or {}).get('photo_id')==identifier:fail('PROFILE_PHOTO','Upload a separate evidence photo.',422)
        old=u.get('cleanup_evidence_claims',identifier)
        if old:fail('PHOTO_USED','Upload fresh photos for this report.',409)
    for identifier in ids:u.put('cleanup_evidence_claims',identifier,{'report_id':report_id,'user_id':uid})

def install(core):
    store=core.operations_store
    r=APIRouter(prefix='/operations/local-business/cleanup',tags=['Community cleanup'])
    @r.post('/reports',status_code=201)
    def report(body:Report,user=Depends(core.current_user)):
        uid=user['id'];identifier=digest(uid+':cleanup:'+body.request_id)
        def save(u):
            old=u.get('cleanup_reports',identifier)
            if old:
                if old['request_hash']!=fingerprint(body):fail('IDEMPOTENCY_CONFLICT','Use a new request key for changed details.',409)
                return exposed(old)
            mine=u.find('cleanup_reports','customer_id',uid)
            if sum(x['created_at']>time.time()-86400 for x in mine)>=5:fail('REPORT_LIMIT','You can submit up to five reports each day.',429)
            # Serialise same-city checks and per-user limits across concurrent requests.
            for key in ('city:'+body.city.strip().casefold(),'user:'+uid):
                guard=u.get('cleanup_guards',digest(key)) or {'version':0};u.put('cleanup_guards',digest(key),{'version':guard['version']+1})
            nearby=u.find('cleanup_reports','city_key',body.city.strip().casefold())
            if any(x['state'] in OPEN and metres(x['location'],body.location.model_dump())<30 for x in nearby):fail('ALREADY_REPORTED','An open report already covers this spot. No duplicate report or points were created.',409)
            evidence(u,body.document_ids,uid,identifier)
            row={**body.model_dump(exclude={'request_id'}),'id':identifier,'customer_id':uid,'city_key':body.city.strip().casefold(),'request_hash':fingerprint(body),'version':1,'created_at':time.time(),'updated_at':time.time(),'state':'reported','queue':'active','owner_id':None,'reward_paise':0,'payment_state':'not_offered','points':0,'events':[]}
            u.put('cleanup_reports',identifier,row);return exposed(row)
        return store.run(save)

    @r.get('/reports')
    def reports(user=Depends(core.current_user)):
        def read(u):
            rows=sorted(u.find('cleanup_reports','customer_id',user['id']),key=lambda row:row['created_at'],reverse=True)
            from captain_rewards import totals
            return {'reports':[exposed(x) for x in rows[:100]],**totals(u.find('cleanup_points','user_id',user['id']))}
        return store.run(read)

    @r.get('/collector')
    def collector(user=Depends(core.current_user)):
        def read(u):
            partner=current(u,user['id'],('scrap_owner',))
            own=u.find('cleanup_reports','owner_id',user['id'])
            nearby=[x for x in u.find('cleanup_reports','state','approved') if x['customer_id']!=user['id'] and metres(partner['location'],x['location'])<=8000]
            return {'reports':[exposed(x) for x in sorted(own+nearby,key=lambda x:x['updated_at'],reverse=True)[:100]]}
        return store.run(read)

    @r.get('/admin')
    def queue(history:bool=False,cursor:str=Query(default='',max_length=64,pattern=r'^[a-f0-9]*$'),admin=Depends(core.operator)):
        def read(u):
            rows=u.find('cleanup_reports','queue','history' if history else 'active',limit=51,after=cursor)
            return {'reports':[exposed(x,True) for x in rows[:50]],'next_cursor':rows[49]['id'] if len(rows)>50 else None}
        return store.run(read)

    def change(identifier,body,actor,admin=False):
        uid=actor['id']
        def save(u):
            row=report_row(u,identifier);key=digest(uid+':cleanup:'+body.command_id)
            old=u.get('cleanup_commands',key)
            if old:
                if old['report_id']!=identifier or old['fingerprint']!=fingerprint(body):fail('IDEMPOTENCY_CONFLICT','Use a new action key for changed details.',409)
                return exposed(row,admin)
            if body.expected_version!=row['version']:fail('STALE_VERSION','This report changed. Refresh before continuing.',409)
            previous_owner=row.get('owner_id');a=body.action;state=row['state'];customer=uid==row['customer_id'];owner=uid==row.get('owner_id')
            def require(ok,message='This action is not available at this stage.'):
                if not ok:fail('INVALID_ACTION',message,409)
            if admin:
                require(uid not in (row['customer_id'],row.get('owner_id')),'An independent administrator must review this report.')
                require(len(body.note.strip())>=10,'Add a clear review note.')
                if a=='approve':
                    require(state=='reported' and row['category']!='hazardous','Hazardous waste must be referred to a specialist authority.')
                    require(len(body.reference.strip())>=8,'Record site-owner or public-authority collection permission.')
                    require(not body.reward_paise or len(body.funding_reference.strip())>=8,'Record the approved Repaido cash budget reference.')
                    row.update(allow_independent=body.allow_independent,state='approved',authority_reference=body.reference,reward_paise=body.reward_paise,funding_reference=body.funding_reference,payment_state='approved' if body.reward_paise else 'not_offered')
                elif a in ('reject','refer'):
                    require(state in ('reported','approved','assigned','verification'))
                    if a=='refer':require(len(body.reference.strip())>=8,'Record the authority referral or case reference.')
                    row.update(state='referred' if a=='refer' else 'rejected',resolution_note=body.note,referral_reference=body.reference if a=='refer' else '',payment_state='not_offered',reward_paise=0)
                elif a=='reassign':
                    require(state in ('assigned','verification'));row.update(state='approved',owner_id=None,collector_name=None,after_document_ids=[],review_note=body.note)
                elif a=='rework':
                    require(state=='verification');row.update(state='assigned',review_note=body.note)
                elif a=='verify':
                    require(state=='verification' and bool(row.get('after_document_ids')))
                    row.update(state='completed',completed_at=time.time(),review_note=body.note,points=POINTS)
                    from captain_rewards import award
                    points=award(u,row,uid,time.time());row['points']=points['points'];row['points_note']=points.get('reason','')
                elif a=='record_cash':
                    require(state=='completed' and row['payment_state']=='approved' and row['reward_paise']>0)
                    require(len(body.reference.strip())>=8,'Record the actual cash disbursement receipt reference.')
                    row.update(payment_state='reported',cash_reference=body.reference,cash_reported_at=time.time())
                elif a=='resolve_payment':
                    require(row['payment_state']=='disputed');require(len(body.reference.strip())>=8,'Record the payment investigation reference.')
                    row.update(payment_state='reported',payment_resolution=body.note,payment_resolution_reference=body.reference)
                else:require(False)
            elif a=='self_accept':
                require(customer and state=='approved' and row.get('allow_independent',False),'Independent collection must be approved for this spot first.')
                row.update(state='assigned',owner_id=uid,collector_name='Independent contributor')
            elif a=='accept':
                partner=current(u,uid,('scrap_owner',))
                require(state=='approved' and not customer and metres(partner['location'],row['location'])<=8000)
                row.update(state='assigned',owner_id=uid,collector_name=partner['name'])
            elif a=='release':
                require(owner and state=='assigned' and len(body.note.strip())>=10,'Add a reason before releasing this task.')
                row.update(state='approved',owner_id=None,collector_name=None,review_note=body.note)
            elif a=='submit':
                if not (customer and row.get('allow_independent',False)):current(u,uid,('scrap_owner',))
                require(owner and state=='assigned')
                require(bool(body.document_ids) and len(body.note.strip())>=10,'Add after photos and the authorised disposal or recycling destination.')
                pos=body.position
                require(pos is not None and 0<pos.accuracy<=100 and -10<=time.time()-pos.captured_at<=120 and metres(row['location'],pos.model_dump())<=300,'Confirm your current location within 300 metres of the reported spot with location accuracy within 100 metres.')
                evidence(u,body.document_ids,uid,identifier)
                row.update(submitted_at=time.time(),state='verification',after_document_ids=body.document_ids,disposal_note=body.note,completion_position=pos.model_dump())
            elif a=='cancel':
                require(customer and state in ('reported','approved'));row.update(state='cancelled',reward_paise=0,payment_state='not_offered')
            elif a=='received':
                require(customer and state=='completed' and row['payment_state']=='reported')
                row.update(payment_state='received',cash_received_at=time.time())
            elif a=='payment_concern':
                require(customer and state=='completed' and row['payment_state']=='reported' and len(body.note.strip())>=10)
                row.update(payment_state='disputed',payment_concern=body.note)
            else:require(False)
            row['queue']='history' if row['state'] in ('rejected','referred','cancelled') or row['state']=='completed' and row['payment_state'] in ('not_offered','received') else 'active'
            event(u,row,a,uid);u.put('cleanup_reports',identifier,row)
            u.put('cleanup_commands',key,{'report_id':identifier,'fingerprint':fingerprint(body)})
            for recipient in {row['customer_id'],row.get('owner_id'),previous_owner} - {None,uid}:notice(u,recipient,row,'Cleanup report updated')
            return exposed(row,admin)
        return store.run(save)
    @r.post('/reports/{identifier}/actions')
    def act(identifier:str,body:Action,user=Depends(core.current_user)):return change(identifier,body,user)
    @r.post('/admin/{identifier}/actions')
    def review(identifier:str,body:Action,admin=Depends(core.operator)):return change(identifier,body,admin,True)

    def photo(identifier,document_id,uid,admin=False):
        def read(u):
            row=report_row(u,identifier)
            if not admin and uid not in (row['customer_id'],row.get('owner_id')):
                p=current(u,uid,('scrap_owner',))
                if row['state']!='approved' or metres(p['location'],row['location'])>8000:fail('NOT_FOUND','Photo unavailable.',404)
            if document_id not in row['document_ids']+row.get('after_document_ids',[]):fail('NOT_FOUND','Photo unavailable.',404)
            return u.get('business_documents',document_id)
        doc=store.run(read)
        if not doc:fail('NOT_FOUND','Photo unavailable.',404)
        return Response(download_object(doc['object']),media_type='image/jpeg',headers={'Cache-Control':'private, no-store'})
    @r.get('/reports/{identifier}/photos/{document_id}')
    def user_photo(identifier:str,document_id:str,user=Depends(core.current_user)):return photo(identifier,document_id,user['id'])
    @r.get('/admin/{identifier}/photos/{document_id}')
    def admin_photo(identifier:str,document_id:str,admin=Depends(core.operator)):return photo(identifier,document_id,admin['id'],True)
    core.app.include_router(r)
