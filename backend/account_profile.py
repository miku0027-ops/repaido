"""Private account contacts and one-use, signed email ownership challenges.

Auth provider identities remain separate. Saving an address is not verification;
only a verified provider claim or the current UID's emailed challenge proves it.
"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Response
from pydantic import Field, field_validator

from operations import Input, fail
from integrations import audit
import repaidians as social

CHALLENGE_SECONDS = 30 * 60
RESEND_SECONDS = 60


def normalize_email(value):
    if not isinstance(value,str) or any(ord(char)<32 or ord(char)==127 for char in value):
        raise ValueError('Enter a valid email address.')
    value=value.strip()
    if len(value)>254 or value.count('@')!=1 or any(char.isspace() for char in value):
        raise ValueError('Enter a valid email address.')
    local,domain=value.rsplit('@',1)
    if not local or len(local.encode('utf-8'))>64 or not re.fullmatch(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+",local):
        raise ValueError('Enter a valid email address.')
    if local.startswith('.') or local.endswith('.') or '..' in local:
        raise ValueError('Enter a valid email address.')
    try: domain=domain.encode('idna').decode('ascii').lower()
    except UnicodeError: raise ValueError('Enter a valid email address.') from None
    labels=domain.split('.')
    if (len(labels)<2 or any(not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?',label) for label in labels)
            or labels[-1].isdigit() or len(labels[-1])<2 or domain=='repaido.user'
            or labels[-1] in ('invalid','localhost','local')):
        raise ValueError('Enter an actual email address for your account.')
    value=local.lower()+'@'+domain
    if len(value.encode('utf-8'))>254:raise ValueError('Enter a valid email address.')
    return value


def actual_email(value):
    try:return normalize_email(value)
    except ValueError:return None


class Request(Input):
    request_id:str=Field(min_length=16,max_length=100,pattern=r'^[A-Za-z0-9_-]+$')


class Change(Request):
    expected_version:int=Field(ge=0,strict=True)
    email:str=Field(min_length=3,max_length=254)

    @field_validator('email')
    @classmethod
    def clean(cls,value):return normalize_email(value)


class Challenge(Request):
    expected_version:int=Field(ge=1,strict=True)


class Confirm(Request):
    challenge_id:str=Field(min_length=24,max_length=100,pattern=r'^[A-Za-z0-9_-]+$')
    token:str=Field(min_length=40,max_length=100,pattern=r'^[A-Za-z0-9_-]+$')


class Session(Request):
    mode:str=Field(default='login',pattern=r'^(login|register)$')
    email:str|None=Field(default=None,min_length=3,max_length=254)

    @field_validator('email')
    @classmethod
    def clean(cls,value):return normalize_email(value) if value is not None else None


def initialize(core):
    # All primary lookups use the signed UID or random challenge document key.
    return None


def ensure(u,user):
    uid=user['id'];saved=u.get('account_contacts',uid)
    claimed=actual_email(user.get('auth_email',user.get('email')))
    proved=claimed and user.get('auth_provider')=='firebase' and user.get('auth_email_verified',False) is True
    if not saved:
        if not claimed:return dict(id=uid,name=user.get('name','Repaido Member'),email=None,email_verified=False,version=0)
        saved=dict(id=uid,name=user.get('name','Repaido Member'),email=claimed,email_verified=bool(proved),
            email_verified_source='firebase' if proved else None,version=1,created_at=time.time(),updated_at=time.time())
        u.put('account_contacts',uid,saved)
    elif proved and saved.get('email')==claimed and not saved.get('email_verified'):
        saved.update(email_verified=True,email_verified_source='firebase',verified_at=time.time(),version=saved['version']+1,updated_at=time.time())
        u.put('account_contacts',uid,saved)
    return saved


def require_email(u,user,verified=False):
    contact=ensure(u,user);email=actual_email(contact.get('email'))
    if not email:fail('EMAIL_REQUIRED','Add an email address to your account profile before continuing.',422)
    if verified and not contact.get('email_verified'):fail('EMAIL_VERIFICATION_REQUIRED','Verify your account email before continuing.',403)
    return email


def transactional_email_recipient(u,uid):
    contact=u.get('account_contacts',uid) or {};email=actual_email(contact.get('email'))
    if not email or contact.get('email_verified') is not True:return None
    return dict(email=email,email_verified=True,version=contact['version'],disabled=bool(contact.get('email_delivery_disabled')))


def _secret():
    secret=os.getenv('REPAIDO_EMAIL_CHALLENGE_SECRET','')
    if len(secret.encode())<32:fail('EMAIL_VERIFICATION_UNAVAILABLE','Email verification is not configured yet.',503)
    return secret.encode()


def _origin():
    value=os.getenv('REPAIDO_PUBLIC_WEB_URL','').rstrip('/')
    parsed=urlsplit(value)
    if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password or parsed.path not in ('','/') or parsed.query or parsed.fragment:
        fail('EMAIL_VERIFICATION_UNAVAILABLE','Email verification is not configured yet.',503)
    return value


def _token(challenge):
    message=json.dumps([challenge['id'],challenge['user_id'],challenge['email'],challenge['email_version'],challenge['expires_at']],separators=(',',':')).encode()
    return base64.urlsafe_b64encode(hmac.new(_secret(),message,hashlib.sha256).digest()).decode().rstrip('=')


def verification_delivery(u,uid,challenge_id):
    challenge=u.get('account_email_challenges',challenge_id);contact=u.get('account_contacts',uid)
    if (not challenge or challenge.get('user_id')!=uid or challenge.get('status')!='pending' or challenge.get('expires_at',0)<=time.time()
            or not contact or contact.get('email_verified') or contact.get('email')!=challenge['email']
            or contact.get('version')!=challenge['email_version'] or contact.get('current_challenge_id')!=challenge_id):return None
    token=_token(challenge)
    if not hmac.compare_digest(challenge['token_hash'],hashlib.sha256(token.encode()).hexdigest()):return None
    fragment=base64.urlsafe_b64encode(json.dumps({'challenge_id':challenge_id,'token':token},separators=(',',':')).encode()).decode().rstrip('=')
    return dict(email=challenge['email'],email_version=challenge['email_version'],expires_at=challenge['expires_at'],
        link=_origin()+'/?view=account#email-verification='+fragment)


def readiness():
    try:
        _secret();_origin()
        import transactional_mail
        state=transactional_mail.readiness()
        return {'ready':bool(state.get('ready')),'reason':None if state.get('ready') else state.get('reason','Email verification is unavailable.')}
    except Exception:
        return {'ready':False,'reason':'Email verification is not configured yet.'}


def profile(u,user):
    contact=ensure(u,user);email=actual_email(contact.get('email'));verified=bool(email and contact.get('email_verified') is True)
    challenge=u.get('account_email_challenges',contact['current_challenge_id']) if contact.get('current_challenge_id') else None
    pending=challenge and challenge.get('status')=='pending' and challenge.get('expires_at',0)>time.time() and challenge.get('email_version')==contact['version']
    return dict(id=user['id'],name=contact.get('name',user.get('name','Repaido Member')),email=email,email_verified=verified,
        email_verified_source=contact.get('email_verified_source') if verified else None,email_required=not bool(email),version=contact['version'],
        verification_status='verified' if verified else 'unverified' if email else 'missing',
        verification={**readiness(),'next_request_at':contact.get('next_verification_at',0),
            'challenge_id':challenge['id'] if pending else None,'expires_at':challenge['expires_at'] if pending else None})


def _receipt(u,uid,body,action):
    key=social.digest(uid+':'+body.request_id)
    signature=hashlib.sha256(json.dumps([action,body.model_dump(mode='json')],sort_keys=True).encode()).hexdigest()
    old=u.get('account_profile_commands',key)
    if old and old.get('signature')!=signature:fail('REQUEST_REUSED','Use a new request reference for changed account details.',409)
    return key,signature,old


def _remember(u,key,signature,result_id):
    u.put('account_profile_commands',key,dict(signature=signature,result_id=result_id,created_at=time.time()))


def _version(contact,expected):
    if contact['version']!=expected:fail('VERSION_CONFLICT','Your account profile changed. Refresh and try again.',409)


def save_email(u,user,body):
    uid=user['id'];contact=ensure(u,user);key,signature,old=_receipt(u,uid,body,'save-email')
    if old:return profile(u,user)
    _version(contact,body.expected_version);social.rate(u,uid,'account-email-change',limit=10)
    if contact.get('email')!=body.email:
        if contact.get('current_challenge_id'):
            previous=u.get('account_email_challenges',contact['current_challenge_id'])
            if previous and previous.get('status')=='pending':previous['status']='revoked';u.put('account_email_challenges',previous['id'],previous)
        claimed=actual_email(user.get('auth_email',user.get('email')));proved=claimed==body.email and user.get('auth_provider')=='firebase' and user.get('auth_email_verified',False) is True
        contact.update(email=body.email,email_verified=bool(proved),email_verified_source='firebase' if proved else None,
            version=contact['version']+1,updated_at=time.time(),current_challenge_id=None,next_verification_at=0)
        contact.pop('verified_at',None);u.put('account_contacts',uid,contact)
        audit(u,'AccountEmailSaved',uid,email_version=contact['version'],verified=bool(proved))
    _remember(u,key,signature,uid);return profile(u,user)


def establish_session(u,user,body):
    uid=user['id'];key,signature,old=_receipt(u,uid,body,'establish-session')
    if old:return profile(u,user)
    contact=ensure(u,user)
    if body.mode=='register':
        if body.email:
            contact=save_email(u,user,Change(request_id=social.digest('session-email:'+body.request_id),expected_version=contact['version'],email=body.email))
        require_email(u,user)
    stamp=user.get('auth_time')
    event_id='account-session-'+social.digest(uid+':'+str(stamp)) if user.get('auth_provider')=='firebase' and stamp is not None else 'account-session-'+social.digest(uid+':'+body.request_id)
    if not u.get('account_session_events',event_id):
        from transactional_mail import enqueue
        kind='registration' if body.mode=='register' else 'login'
        enqueue(u,event_id,kind,[uid],{})
        u.put('account_session_events',event_id,dict(id=event_id,user_id=uid,kind=kind,created_at=time.time()))
    _remember(u,key,signature,uid);return profile(u,user)


def install(core):
    router=APIRouter(prefix='/account',tags=['Private account profile']);store=core.operations_store

    @router.get('/profile')
    def get_profile(response:Response,user=Depends(core.current_user)):
        response.headers['Cache-Control']='private, no-store';return store.run(lambda u:profile(u,user))

    @router.patch('/profile')
    def change_profile(body:Change,user=Depends(core.current_user)):
        return store.run(lambda u:save_email(u,user,body))

    @router.post('/profile/email-verification')
    def request_verification(body:Challenge,user=Depends(core.current_user)):
        def save(u):
            uid=user['id'];contact=ensure(u,user);key,signature,old=_receipt(u,uid,body,'email-verification')
            if old:return profile(u,user)
            _version(contact,body.expected_version)
            if contact.get('email_verified'):return profile(u,user)
            require_email(u,user);_secret();_origin()
            if not readiness()['ready']:fail('EMAIL_VERIFICATION_UNAVAILABLE','Email verification is not configured yet.',503)
            if contact.get('next_verification_at',0)>time.time():fail('EMAIL_RESEND_WAIT','Please wait one minute before requesting another verification email.',429)
            social.rate(u,uid,'account-email-verification',limit=5)
            if contact.get('current_challenge_id'):
                previous=u.get('account_email_challenges',contact['current_challenge_id'])
                if previous and previous.get('status')=='pending':previous['status']='revoked';u.put('account_email_challenges',previous['id'],previous)
            challenge_id=secrets.token_urlsafe(24);stamp=time.time()
            challenge=dict(id=challenge_id,user_id=uid,email=contact['email'],email_version=contact['version'],expires_at=stamp+CHALLENGE_SECONDS,status='pending',created_at=stamp)
            challenge['token_hash']=hashlib.sha256(_token(challenge).encode()).hexdigest()
            u.put('account_email_challenges',challenge_id,challenge)
            contact.update(current_challenge_id=challenge_id,next_verification_at=stamp+RESEND_SECONDS);u.put('account_contacts',uid,contact)
            from transactional_mail import enqueue
            enqueue(u,'email-verification-'+challenge_id,'email_verification',[uid],{'challenge_id':challenge_id})
            _remember(u,key,signature,challenge_id);return profile(u,user)
        return store.run(save)

    @router.post('/profile/email-verification/confirm')
    def confirm_verification(body:Confirm,user=Depends(core.current_user)):
        def save(u):
            uid=user['id'];key,signature,old=_receipt(u,uid,body,'confirm-email')
            if old:return profile(u,user)
            contact=ensure(u,user);challenge=u.get('account_email_challenges',body.challenge_id)
            social.rate(u,uid,'account-email-confirm',limit=20)
            if (not challenge or challenge.get('user_id')!=uid or challenge.get('status')!='pending'
                    or challenge.get('expires_at',0)<=time.time() or contact.get('current_challenge_id')!=body.challenge_id
                    or contact.get('email')!=challenge.get('email') or contact.get('version')!=challenge.get('email_version')
                    or not hmac.compare_digest(challenge.get('token_hash',''),hashlib.sha256(body.token.encode()).hexdigest())):
                # Return the denial so failed proof attempts still commit their
                # bounded rate counter; the HTTP error is raised after commit.
                return {'challenge_invalid':True}
            challenge.update(status='consumed',consumed_at=time.time());u.put('account_email_challenges',body.challenge_id,challenge)
            contact.update(email_verified=True,email_verified_source='challenge',verified_at=time.time(),version=contact['version']+1,updated_at=time.time(),current_challenge_id=None)
            u.put('account_contacts',uid,contact);audit(u,'AccountEmailVerified',uid,email_version=contact['version'])
            _remember(u,key,signature,uid);return profile(u,user)
        result=store.run(save)
        if result.get('challenge_invalid'):fail('EMAIL_CHALLENGE_INVALID','This verification link has expired, changed, or belongs to another signed-in account.',403)
        return result

    core.app.include_router(router)
