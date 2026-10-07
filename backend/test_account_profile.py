"""Signed email capture, real ownership proof, replay and identity boundaries."""
import base64
import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, Header, HTTPException
from fastapi.testclient import TestClient

import account_profile as accounts
import transactional_mail as mail
from operations import Store


@pytest.fixture
def identity(tmp_path,monkeypatch):
    path=str(tmp_path/'accounts.db')
    @contextmanager
    def db():
        conn=sqlite3.connect(path);conn.row_factory=sqlite3.Row
        try:yield conn;conn.commit()
        except Exception:conn.rollback();raise
        finally:conn.close()
    actors={'one':{'id':'one','name':'First account','email':None},'two':{'id':'two','name':'Second account','email':None}}
    def actor(authorization:str=Header(default='')):
        uid=authorization.removeprefix('Bearer ')
        if uid not in actors:raise HTTPException(401)
        return actors[uid]
    core=SimpleNamespace(db=db,USE_FIRESTORE=False,fb_db=None,DB_PATH=path,app=FastAPI(),current_user=actor)
    core.operations_store=Store(core);core.operations_store.init();accounts.install(core)
    monkeypatch.setenv('REPAIDO_EMAIL_CHALLENGE_SECRET','test-only-random-ownership-key-0123456789')
    monkeypatch.setenv('REPAIDO_PUBLIC_WEB_URL','https://repaido.web.app')
    monkeypatch.setattr(mail,'readiness',lambda:{'ready':True,'enabled':True,'reason':None})
    def enqueue(u,event_id,kind,recipient_ids,payload):
        key=event_id+':'+kind
        if not u.get('fixture_mail',key):u.put('fixture_mail',key,dict(id=key,kind=kind,recipients=recipient_ids,payload=payload))
    monkeypatch.setattr(mail,'enqueue',enqueue)
    with TestClient(core.app) as client:yield client,core,actors


def auth(uid='one'):return {'Authorization':'Bearer '+uid}
def rid():return str(uuid.uuid4())
def profile(client,uid='one'):
    result=client.get('/account/profile',headers=auth(uid));assert result.status_code==200,result.text
    return result.json()
def save(client,email='owner@example.com',uid='one',**changes):
    body=dict(request_id=rid(),expected_version=profile(client,uid)['version'],email=email);body.update(changes)
    result=client.patch('/account/profile',headers=auth(uid),json=body);assert result.status_code==200,result.text
    return result.json(),body
def challenge(client,**changes):
    body=dict(request_id=rid(),expected_version=profile(client)['version']);body.update(changes)
    result=client.post('/account/profile/email-verification',headers=auth(),json=body);assert result.status_code==200,result.text
    return result.json(),body
def proof(core,challenge_id,uid='one'):
    delivery=core.operations_store.run(lambda u:accounts.verification_delivery(u,uid,challenge_id));assert delivery
    fragment=delivery['link'].split('#email-verification=')[1]
    data=json.loads(base64.urlsafe_b64decode(fragment+'='*((4-len(fragment)%4)%4)))
    return {**data,'request_id':rid()},delivery


@pytest.mark.parametrize('email',['uid@repaido.user','a@example.invalid','a@example.com\r\nBcc:evil@malicious.com','a@localhost','.a@example.com','a..b@example.com','a@example..com','a@example.com\x00','a@-example.com','a@host.12','a'*65+'@example.com'])
def test_invalid_placeholder_and_header_injection_email_is_rejected(email):
    with pytest.raises(ValueError):accounts.normalize_email(email)


def test_saved_email_is_required_private_and_not_self_verified(identity):
    client,core,actors=identity
    missing=profile(client);assert missing['email_required'] and missing['version']==0
    with pytest.raises(HTTPException) as error:core.operations_store.run(lambda u:accounts.require_email(u,actors['one']))
    assert error.value.detail['code']=='EMAIL_REQUIRED'
    current,body=save(client,'  Owner@EXAMPLE.com  ')
    assert current['email']=='owner@example.com' and not current['email_verified'] and not current['email_required']
    assert core.operations_store.run(lambda u:accounts.require_email(u,actors['one']))=='owner@example.com'
    assert core.operations_store.run(lambda u:accounts.transactional_email_recipient(u,'one')) is None
    assert client.patch('/account/profile',headers=auth(),json=body).json()==current
    assert client.patch('/account/profile',headers=auth(),json={**body,'email':'another@example.com'}).status_code==409
    assert client.patch('/account/profile',headers=auth(),json={**body,'request_id':rid(),'email_verified':True}).status_code==422
    assert profile(client,'two')['email'] is None and client.get('/account/profile').status_code==401


def test_verified_provider_claim_proves_only_the_same_saved_email(identity):
    client,core,actors=identity
    actors['one'].update(auth_provider='firebase',auth_email='Owner@Example.com',auth_email_verified=True)
    verified=profile(client);assert verified['email_verified'] and verified['email_verified_source']=='firebase'
    assert core.operations_store.run(lambda u:accounts.transactional_email_recipient(u,'one'))['email']=='owner@example.com'
    changed,_=save(client,'customer-chosen@example.com')
    assert not changed['email_verified'] and changed['email_verified_source'] is None
    assert profile(client)['email']=='customer-chosen@example.com' and not profile(client)['email_verified']
    assert actors['one']['auth_email']=='Owner@Example.com'


def test_one_use_challenge_is_hashed_not_returned_and_tied_to_signed_uid(identity):
    client,core,_=identity
    saved,_=save(client);requested,body=challenge(client);cid=requested['verification']['challenge_id']
    assert requested['version']==saved['version'] and 'token' not in json.dumps(requested)
    assert client.post('/account/profile/email-verification',headers=auth(),json=body).json()==requested
    data,delivery=proof(core,cid)
    row=core.operations_store.run(lambda u:u.get('account_email_challenges',cid))
    assert row['email']=='owner@example.com' and 'token' not in row and data['token'] not in json.dumps(row)
    events=core.operations_store.run(lambda u:u.all('fixture_mail'));assert events[0]['payload']=={'challenge_id':cid}
    assert delivery['link'].startswith('https://repaido.web.app/?view=account#email-verification=')
    assert client.post('/account/profile/email-verification/confirm',headers=auth('two'),json=data).status_code==403
    result=client.post('/account/profile/email-verification/confirm',headers=auth(),json=data);assert result.status_code==200,result.text
    assert result.json()['email_verified'] and result.json()['email_verified_source']=='challenge'
    assert client.post('/account/profile/email-verification/confirm',headers=auth(),json=data).json()==result.json()
    assert client.post('/account/profile/email-verification/confirm',headers=auth(),json={**data,'request_id':rid()}).status_code==403
    assert core.operations_store.run(lambda u:accounts.verification_delivery(u,'one',cid)) is None


def test_resend_email_change_expiry_and_version_revoke_old_challenge(identity,monkeypatch):
    client,core,_=identity
    now=time.time();clock=[now];monkeypatch.setattr(time,'time',lambda:clock[0])
    saved,_=save(client);requested,_=challenge(client);first,_=proof(core,requested['verification']['challenge_id'])
    assert client.post('/account/profile/email-verification',headers=auth(),json={'request_id':rid(),'expected_version':saved['version']}).status_code==429
    clock[0]+=61;resent,_=challenge(client)
    assert resent['verification']['challenge_id']!=first['challenge_id']
    assert client.post('/account/profile/email-verification/confirm',headers=auth(),json=first).status_code==403
    second,_=proof(core,resent['verification']['challenge_id']);save(client,'changed@example.com')
    assert client.post('/account/profile/email-verification/confirm',headers=auth(),json=second).status_code==403
    third,_=challenge(client);last,_=proof(core,third['verification']['challenge_id']);clock[0]+=accounts.CHALLENGE_SECONDS+1
    assert client.post('/account/profile/email-verification/confirm',headers=auth(),json=last).status_code==403
    assert not profile(client)['email_verified']


def test_invalid_proof_attempts_are_rate_limited_even_when_transaction_denies(identity):
    client,core,_=identity
    save(client);requested,_=challenge(client);body,_=proof(core,requested['verification']['challenge_id']);body['token']='x'*43
    for _ in range(20):
        assert client.post('/account/profile/email-verification/confirm',headers=auth(),json={**body,'request_id':rid()}).status_code==403
    result=client.post('/account/profile/email-verification/confirm',headers=auth(),json={**body,'request_id':rid()})
    assert result.status_code==429 and result.json()['detail']['code']=='RATE_LIMIT'


def test_missing_verification_configuration_is_honest_and_does_not_block_capture(identity,monkeypatch):
    client,core,actors=identity
    monkeypatch.delenv('REPAIDO_EMAIL_CHALLENGE_SECRET')
    saved,_=save(client);assert not saved['verification']['ready']
    assert core.operations_store.run(lambda u:accounts.require_email(u,actors['one']))=='owner@example.com'
    result=client.post('/account/profile/email-verification',headers=auth(),json={'request_id':rid(),'expected_version':saved['version']})
    assert result.status_code==503 and not core.operations_store.run(lambda u:u.all('account_email_challenges'))


def test_firebase_explicit_session_records_once_without_spamming_api_reads_and_handles_max_request_id(identity):
    client,core,actors=identity
    actors['one'].update(auth_provider='firebase',auth_email=None,auth_email_verified=False,auth_time=123456)
    body=accounts.Session(request_id='r'*100,mode='register',email='first@example.com')
    current=core.operations_store.run(lambda u:accounts.establish_session(u,actors['one'],body))
    assert current['email']=='first@example.com' and not current['email_verified']
    assert core.operations_store.run(lambda u:accounts.establish_session(u,actors['one'],body))==current
    for _ in range(5):profile(client)
    another=accounts.Session(request_id=rid(),mode='login')
    core.operations_store.run(lambda u:accounts.establish_session(u,actors['one'],another))
    assert len(core.operations_store.run(lambda u:u.all('fixture_mail')))==1


def test_real_firebase_identity_placeholder_is_hidden_and_reads_do_not_create_login_events(client,monkeypatch):
    import main
    class Provider:
        def verify_id_token(self,token,check_revoked=True):
            assert check_revoked
            return {'uid':'phone-only','name':'Phone account','phone_number':'+919876543210','auth_time':123456,
                'firebase':{'sign_in_provider':'phone'}}
    monkeypatch.setattr(main,'fb_auth_module',Provider())
    actor=main.current_user('Bearer verified-firebase-token')
    assert actor['email'] is None and actor['email_required'] and actor['phone_authenticated']
    assert actor['auth_email'] is None and not actor['auth_email_verified']
    for _ in range(3):main.current_user('Bearer verified-firebase-token')
    assert main.operations_store.run(lambda u:u.all('account_session_events'))==[]
    result=client.post('/auth/session',headers={'Authorization':'Bearer verified-firebase-token'},json={'request_id':rid(),'mode':'register','email':'actual@example.com'})
    assert result.status_code==200,result.text
    assert result.json()['user']['email']=='actual@example.com' and not result.json()['user']['email_verified']
    again=client.post('/auth/session',headers={'Authorization':'Bearer verified-firebase-token'},json={'request_id':rid(),'mode':'login'})
    assert again.status_code==200 and len(main.operations_store.run(lambda u:u.all('account_session_events')))==1


from test_api import client
