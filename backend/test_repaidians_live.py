import base64,json,time,uuid
from unittest.mock import patch
import pytest
from cryptography.hazmat.primitives import serialization,hashes
from cryptography.hazmat.primitives.asymmetric import rsa,padding
import repaidians_live as live
from test_repaidians import api,auth,profile

@pytest.fixture
def provider_config(monkeypatch):
    key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
    pem=key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()).decode()
    monkeypatch.setenv('CLOUDFLARE_STREAM_ACCOUNT_ID','a'*32)
    monkeypatch.setenv('CLOUDFLARE_STREAM_API_TOKEN','test-provider-token')
    monkeypatch.setenv('CLOUDFLARE_STREAM_KEY_ID','b'*32)
    monkeypatch.setenv('CLOUDFLARE_STREAM_SIGNING_PEM',pem)
    calls=[]
    def provider(method,path='',body=None):
        calls.append((method,path,body))
        if method=='POST':return {'uid':'c'*32,'webRTC':{'url':'https://customer-test.cloudflarestream.com/PRIVATE_PUBLISH_SECRET/webRTC/publish'},'webRTCPlayback':{'url':'https://customer-test.cloudflarestream.com/'+'c'*32+'/webRTC/play'}}
        if method=='GET':return {'status':'connected'}
        return None
    monkeypatch.setattr(live,'provider',provider)
    return calls,key

def create(api,**fields):
    body={'title':'Electrical work in progress','visibility':'public','clientId':str(uuid.uuid4()),**fields}
    response=api.post('/repaidians/live',headers=auth(),json=body)
    assert response.status_code==200,response.text
    return response.json(),body

def activate(api,row):
    r=api.post('/repaidians/live/'+row['id']+'/activate',headers=auth());assert r.status_code==200,r.text
    return r.json()

def test_unconfigured_and_unapproved_cannot_start_fake_broadcast(api,monkeypatch):
    for name in ('CLOUDFLARE_STREAM_ACCOUNT_ID','CLOUDFLARE_STREAM_API_TOKEN','CLOUDFLARE_STREAM_SIGNING_PEM','CLOUDFLARE_STREAM_KEY_ID'):monkeypatch.delenv(name,raising=False)
    assert api.get('/repaidians/live/status').json()['ready'] is False
    body={'title':'My work','clientId':str(uuid.uuid4())}
    assert api.post('/repaidians/live',headers=auth(),json=body).status_code==503
    assert api.post('/repaidians/live',headers=auth('customer'),json=body).status_code==403
    assert api.get('/repaidians/live').json()['rooms']==[]

def test_create_replay_owner_access_and_confirmed_provider_only(api,provider_config,monkeypatch):
    calls,_=provider_config;row,body=create(api)
    assert len([c for c in calls if c[0]=='POST'])==1
    assert calls[0][2]['recording']['requireSignedURLs'] and calls[0][2]['recording']['mode']=='off'
    assert api.post('/repaidians/live',headers=auth(),json=body).json()['id']==row['id']
    assert len([c for c in calls if c[0]=='POST'])==1
    assert api.get('/repaidians/live').json()['rooms']==[]
    assert api.post('/repaidians/live/'+row['id']+'/activate',headers=auth('bob')).status_code==404
    original=live.provider;monkeypatch.setattr(live,'provider',lambda *args,**kwargs:{'status':'failed_to_connect'})
    assert api.post('/repaidians/live/'+row['id']+'/activate',headers=auth()).status_code==409
    monkeypatch.setattr(live,'provider',original);activate(api,row)
    listed=api.get('/repaidians/live').json();assert listed['rooms'][0]['state']=='active'
    assert 'PUBLISH_SECRET' not in str(listed) and 'play_url' not in str(listed)
    assert api.post('/repaidians/live',headers=auth(),json={**body,'clientId':str(uuid.uuid4())}).status_code==409

def test_signed_viewer_tokens_verified_locally_without_provider_api_per_view(api,provider_config):
    calls,key=provider_config;row,_=create(api);activate(api,row);count=len(calls)
    result=api.post('/repaidians/live/'+row['id']+'/watch').json()
    assert len(calls)==count
    token=result['play_url'].split('/')[3];header,payload,signature=token.split('.')
    decode=lambda value:base64.urlsafe_b64decode(value+'='*(-len(value)%4))
    claims=json.loads(decode(payload));assert claims['sub']=='c'*32 and claims['kid']=='b'*32
    assert time.time()-1<claims['exp']<=time.time()+90
    key.public_key().verify(decode(signature),(header+'.'+payload).encode(),padding.PKCS1v15(),hashes.SHA256())
    assert 'PUBLISH_SECRET' not in str(result) and 'provider-token' not in str(result)

def test_trade_privacy_end_expiry_and_suspension(api,provider_config):
    profile(api,'alice','electrician');profile(api,'bob','plumber')
    row,_=create(api,visibility='trade');activate(api,row)
    assert api.get('/repaidians/live').json()['rooms']==[]
    assert api.post('/repaidians/live/'+row['id']+'/watch',headers=auth('bob')).status_code==404
    assert api.post('/repaidians/live/'+row['id']+'/watch',headers=auth()).status_code==200
    assert api.post('/repaidians/live/'+row['id']+'/end',headers=auth('bob')).status_code==404
    api.core.operations_store.run(lambda u:u.put('network_suspensions','alice',{'active':True}))
    assert api.post('/repaidians/live/'+row['id']+'/heartbeat',headers=auth()).status_code==403
    assert api.get('/repaidians/live',headers=auth()).json()['rooms']==[]
    with patch('time.time',return_value=time.time()+91):
        assert live.expire(api.core)['processed']==1
        assert api.core.operations_store.run(lambda u:u.get('rp_lives',row['id']))['state']=='ended'
    assert api.post('/repaidians/live/'+row['id']+'/watch',headers=auth()).status_code==404

def test_failed_input_response_cleanup_and_no_false_live(api,provider_config,monkeypatch):
    calls,_=provider_config
    monkeypatch.setattr(live,'provider',lambda method,path='',body=None: {'uid':'c'*32,'webRTC':{'url':'https://attacker.test/publish'},'webRTCPlayback':{'url':'https://attacker.test/play'}} if method=='POST' else calls.append((method,path,body)))
    result=api.post('/repaidians/live',headers=auth(),json={'title':'My live work','clientId':str(uuid.uuid4())})
    assert result.status_code==503 and ('DELETE','/'+'c'*32,None) in calls
    assert api.get('/repaidians/live').json()['rooms']==[]

def test_provider_stop_failure_is_queued_and_not_reported_as_ended(api,provider_config,monkeypatch):
    row,_=create(api);activate(api,row);original=live.provider
    def down(method,*args,**kwargs):
        if method=='DELETE':raise RuntimeError('provider temporarily unavailable')
        return original(method,*args,**kwargs)
    monkeypatch.setattr(live,'provider',down)
    assert api.post('/repaidians/live/'+row['id']+'/end',headers=auth()).json()['state']=='stopping'
    assert api.get('/repaidians/live').json()['rooms']==[]
    monkeypatch.setattr(live,'provider',original)
    with patch('time.time',return_value=time.time()+61):assert live.expire(api.core)['processed']==1
    assert api.core.operations_store.run(lambda u:u.get('rp_lives',row['id']))['state']=='ended'


def test_reviewed_cab_business_can_publish_without_becoming_a_service_agent(api,provider_config):
    def seed(u):
        u.put('business_partners','customer',{'id':'customer','user_id':'customer','role':'cab_owner','status':'approved','valid_until':time.time()+86400})
    api.core.operations_store.run(seed)
    state=api.get('/repaidians/state',headers=auth('customer')).json()
    assert state['capabilities']['professional']
    result=api.post('/repaidians/live',headers=auth('customer'),json={'title':'Fleet care today','clientId':str(uuid.uuid4())})
    assert result.status_code==200,result.text
    assert api.core.operations_store.run(lambda u:u.get('workers','customer')) is None
    api.core.operations_store.run(lambda u:u.put('business_partners','customer',{**u.get('business_partners','customer'),'valid_until':time.time()-1}))
    assert not api.get('/repaidians/state',headers=auth('customer')).json()['capabilities']['professional']

def test_provider_delete_of_an_already_removed_input_finishes_cleanup(monkeypatch):
    import urllib.error
    monkeypatch.setenv('CLOUDFLARE_STREAM_ACCOUNT_ID','a'*32);monkeypatch.setenv('CLOUDFLARE_STREAM_API_TOKEN','fixture-token')
    def gone(*args,**kwargs):raise urllib.error.HTTPError('https://api.cloudflare.com',404,'Not found',{},None)
    monkeypatch.setattr(live.urllib.request,'urlopen',gone)
    assert live.provider('DELETE','/'+'c'*32) is None
    from fastapi import HTTPException
    with pytest.raises(HTTPException):live.provider('GET','/'+'c'*32)
