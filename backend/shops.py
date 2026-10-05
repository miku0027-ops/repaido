"""Phone-authenticated shop applications and auditable company review."""
import time
from typing import Literal
from fastapi import APIRouter, Depends
from pydantic import Field
from operations import Input, Pin, fail
from integrations import audit

class Application(Input):
    model_config = {'extra':'forbid','str_strip_whitespace':True}
    owner_name: str = Field(min_length=2, max_length=100)
    name: str = Field(min_length=3, max_length=200)
    address: str = Field(min_length=10, max_length=500)
    city: str = Field(min_length=2, max_length=80)
    postal_code: str = Field(pattern=r'^\d{6}$')
    location: Pin
    categories: str = Field(min_length=3, max_length=300)
    business_reference: str = Field(min_length=3, max_length=100)
    consent: Literal[True]

class Review(Input):
    expected_version: int = Field(ge=1)
    decision: Literal['approved','rejected','suspended']
    reason: str = Field(min_length=10, max_length=500)
    evidence_reference: str = Field(min_length=8, max_length=200)
    identity_checked: bool = False
    business_checked: bool = False
    address_checked: bool = False

def install(core):
    r=APIRouter(prefix='/operations');store=core.operations_store
    def owner(user=Depends(core.current_user)):
        if not user.get('phone_authenticated'):fail('PHONE_OTP_REQUIRED','Sign in with a mobile OTP to access your shop.',403)
        return user
    def owned(u,user):
        return next((s for s in u.all('shops') if s['owner_id']==user['id']),None)
    @r.get('/shop/me')
    def me(user=Depends(owner)):
        return store.run(lambda u:{'shop':owned(u,user)})
    @r.post('/shop/application')
    def apply(body:Application,user=Depends(owner)):
        def save(u):
            old=owned(u,user)
            if old and old['status'] in ('approved','suspended'):fail('REVIEW_REQUIRED','Contact the company team to change an approved or suspended shop.')
            values=body.model_dump()
            if old and old['status']=='pending_verification':
                if all(old.get(k)==v for k,v in values.items()):return {'shop':old}
                fail('APPLICATION_PENDING','Your application is already awaiting review. Contact the team for corrections.')
            s=dict(values,id=old['id'] if old else 'application_'+user['id'],owner_id=user['id'],phone=user['phone'],status='pending_verification',version=(old or {}).get('version',0)+1,created_at=(old or {}).get('created_at',time.time()),submitted_at=time.time())
            u.put('shops',s['id'],s);audit(u,'ShopApplicationSubmitted',user['id'],shop_id=s['id'],version=s['version']);return {'shop':s}
        return store.run(save)
    @r.get('/admin/shops')
    def queue(admin=Depends(core.operator)):
        def read(u):
            audit(u,'ShopApplicationsAccessed',admin['id']);return {'shops':u.all('shops')}
        return store.run(read)
    @r.post('/admin/shops/{shop_id}/review')
    def review(shop_id:str,body:Review,admin=Depends(core.operator)):
        def save(u):
            s=u.get('shops',shop_id)
            if not s:fail('NOT_FOUND','Shop not found.',404)
            if s['owner_id']==admin['id']:fail('INDEPENDENT_REVIEW_REQUIRED','Another company reviewer must review your shop.',403)
            if s.get('version',1)!=body.expected_version:fail('STALE_REVIEW','This application changed. Refresh before reviewing.')
            if body.decision=='approved' and not all((body.identity_checked,body.business_checked,body.address_checked)):fail('VERIFICATION_REQUIRED','Complete owner identity, business and shop address verification first.')
            if body.decision=='suspended' and s['status']!='approved':fail('INVALID_STATE','Only approved shops can be suspended.')
            if body.decision=='rejected' and s['status']!='pending_verification':fail('INVALID_STATE','Only pending applications can be rejected.')
            s.update(status=body.decision,version=body.expected_version+1,review_reason=body.reason,reviewed_at=time.time(),reviewed_by=admin['id'],verification=body.model_dump())
            u.put('shops',shop_id,s);audit(u,'ShopReviewed',admin['id'],shop_id=shop_id,decision=body.model_dump());return {'shop':s}
        return store.run(save)
    core.app.include_router(r)
