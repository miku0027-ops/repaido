"""Cloudflare-hosted WHIP/WHEP video. API traffic is control-plane only."""
import base64,hashlib,json,os,re,time,urllib.request,urllib.error,uuid
from functools import lru_cache
from urllib.parse import urlparse
from typing import Literal
from fastapi import Depends
from pydantic import Field
from operations import Input,fail

MAX_SECONDS=7200
LEASE_SECONDS=90
TOKEN_SECONDS=120

class Create(Input):
    clientId:uuid.UUID
    title:str=Field(min_length=3,max_length=120)
    visibility:Literal['public','trade']='public'

@lru_cache(maxsize=2)
def signing_key(encoded):
    from google.auth.crypt import RSASigner
    value=encoded.replace('\\n','\n').encode()
    if b'BEGIN' not in value:value=base64.b64decode(value,validate=True)
    return RSASigner.from_string(value)

def readiness():
    account=os.getenv('CLOUDFLARE_STREAM_ACCOUNT_ID','')
    kid=os.getenv('CLOUDFLARE_STREAM_KEY_ID','')
    ready=bool(re.fullmatch('[a-f0-9]{32}',account) and re.fullmatch('[a-f0-9]{32}',kid) and os.getenv('CLOUDFLARE_STREAM_API_TOKEN') and os.getenv('CLOUDFLARE_STREAM_SIGNING_PEM'))
    if ready:
        try:signing_key(os.environ['CLOUDFLARE_STREAM_SIGNING_PEM'])
        except Exception:ready=False
    return {'ready':ready,'provider':'cloudflare_stream','max_duration_seconds':MAX_SECONDS}

def provider(method,path='',body=None):
    account=os.getenv('CLOUDFLARE_STREAM_ACCOUNT_ID','')
    token=os.getenv('CLOUDFLARE_STREAM_API_TOKEN','')
    if not re.fullmatch('[a-f0-9]{32}',account) or not token:fail('LIVE_NOT_CONNECTED','Live video is not open yet.',503)
    request=urllib.request.Request('https://api.cloudflare.com/client/v4/accounts/'+account+'/stream/live_inputs'+path,data=json.dumps(body).encode() if body is not None else None,method=method,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(request,timeout=12) as response:
            if response.status==204 and method=='DELETE':return None
            payload=json.load(response)
        if not payload.get('success'):raise ValueError()
        return payload.get('result')
    except urllib.error.HTTPError as error:
        if method=='DELETE' and error.code==404:return None
        fail('LIVE_PROVIDER_UNAVAILABLE','Live video could not connect. Please retry.',503)
    except Exception:fail('LIVE_PROVIDER_UNAVAILABLE','Live video could not connect. Please retry.',503)

def endpoint(value,suffix):
    parsed=urlparse(value or '')
    if parsed.scheme!='https' or not (parsed.hostname or '').endswith('.cloudflarestream.com') or parsed.port not in (None,443) or parsed.username or parsed.password or parsed.fragment or not parsed.path.endswith(suffix):fail('LIVE_PROVIDER_RESPONSE','Live video returned an invalid connection. Please retry.',503)
    return value

def signed_playback(value,input_id,expires):
    kid=os.environ['CLOUDFLARE_STREAM_KEY_ID']
    def encode(value):return base64.urlsafe_b64encode(json.dumps(value,separators=(',',':')).encode()).decode().rstrip('=')
    data=encode({'alg':'RS256','kid':kid})+'.'+encode({'sub':input_id,'kid':kid,'exp':int(expires),'nbf':int(time.time())-10})
    signature=signing_key(os.environ['CLOUDFLARE_STREAM_SIGNING_PEM']).sign(data.encode())
    token=data+'.'+base64.urlsafe_b64encode(signature).decode().rstrip('=')
    parsed=urlparse(endpoint(value,'/webRTC/play'))
    return parsed.scheme+'://'+parsed.netloc+'/'+token+'/webRTC/play'

def index(u,row):
    from repaidians import sort_key
    key=row['id'];active=row['state']=='active'
    u.put('rp_live_public',key,{'id':key,'sortKey':sort_key(int(row['created_at']*1000) if active else 0,key)})
    due=min(row['expires_at'],row.get('heartbeat_at',row['created_at'])+LEASE_SECONDS) if active else row['created_at']+180
    pending=row['state'] in ('starting','active','stopping')
    if row['state']=='stopping':due=row.get('cleanup_at',time.time())
    u.put('rp_live_due',key,{'id':key,'sortKey':sort_key(int(due*1000) if pending else 0,key)})

def available(u,row,a):
    from repaidians import blocked,capabilities,subscription_state
    if not row or row['state']!='active' or row['expires_at']<=time.time() or row.get('heartbeat_at',0)+LEASE_SECONDS<=time.time():return False
    uid=(a.get('user') or {}).get('id')
    if not capabilities(u,{'user':{'id':row['owner_id']}})['professional'] or not subscription_state(u,row['owner_id'])['active'] or (u.get('network_suspensions',row['owner_id']) or {}).get('active') or (u.get('rp_members',row['owner_id']) or {}).get('suspended'):return False
    if uid and blocked(u,uid,row['owner_id']):return False
    member=u.get('rp_members',uid) if uid else None
    return row['visibility']=='public' or bool(member and member['trade']==row['trade'])

def public(row):return {key:row[key] for key in ('id','owner_id','title','trade','visibility','state','created_at','expires_at')}

def close(core,identifier,uid=None,admin=False):
    def mark(u):
        row=u.get('rp_lives',identifier)
        if not row or not admin and uid!=row['owner_id']:fail('LIVE_UNAVAILABLE','This broadcast is not available.',404)
        if row['state'] not in ('ended','failed'):
            row.update(state='stopping',cleanup_at=time.time())
            u.put('rp_lives',identifier,row);index(u,row)
        return row,u.get('rp_live_provider',identifier)
    row,connection=core.operations_store.run(mark)
    if row['state'] in ('ended','failed'):return {'state':row['state']}
    try:
        if connection and connection.get('input_id'):provider('DELETE','/'+connection['input_id'])
    except Exception:
        def retry(u):
            current=u.get('rp_lives',identifier)
            if current and current['state']=='stopping':
                current.update(cleanup_at=time.time()+60);u.put('rp_lives',identifier,current);index(u,current)
        core.operations_store.run(retry)
        return {'state':'stopping'}
    def finish(u):
        current=u.get('rp_lives',identifier)
        if current and current['state']=='stopping':
            current.update(state='ended',ended_at=time.time());u.put('rp_lives',identifier,current);index(u,current)
            u.put('rp_live_provider',identifier,{'input_id':None})
    core.operations_store.run(finish)
    return {'state':'ended'}

def expire(core,limit=12):
    def due(u):
        floor='0000000000001:';ceiling=f'{int(time.time()*1000):013d}:~'
        if u.tx is not None:
            q=u.core.fs_collection('ops_rp_live_due').where('sortKey','>=',floor).where('sortKey','<=',ceiling).order_by('sortKey').limit(limit)
            return [s.to_dict() for s in q.stream(transaction=u.tx)]
        return [json.loads(r['body']) for r in u.conn.execute("SELECT body FROM operation_records WHERE kind='rp_live_due' AND json_extract(body,'$.sortKey')>=? AND json_extract(body,'$.sortKey')<=? ORDER BY json_extract(body,'$.sortKey') LIMIT ?",(floor,ceiling,limit))]
    refs=core.operations_store.run(due);processed=0;started=time.monotonic()
    for ref in refs:
        if time.monotonic()-started>15:break
        row=core.operations_store.run(lambda u:u.get('rp_lives',ref['id']))
        if row and (row['state']=='stopping' or row['state']=='starting' and row['created_at']+180<=time.time() or row['state']=='active' and min(row['expires_at'],row.get('heartbeat_at',0)+LEASE_SECONDS)<=time.time()):
            close(core,row['id'],admin=True);processed+=1
    return {'processed':processed}

def install(core,r,actor):
    from repaidians import professional,signed,pro,browse,rate,digest,sort_key,query
    store=core.operations_store
    def publisher(u,a):
        member=professional(u,a)
        if member.get('suspended') or (u.get('network_suspensions',member['id']) or {}).get('active'):fail('LIVE_UNAVAILABLE','Live publishing is unavailable for this account.',403)
        return member
    @r.get('/live/status')
    def status():return readiness()
    @r.get('/live')
    def listing(a=Depends(actor)):
        def read(u):
            browse(u,a)
            refs=query(u,'rp_live_public',40)
            u.prefetch([('rp_lives',ref['id']) for ref in refs if ref.get('sortKey','')>'0000000000000:~'])
            rows=[u.get('rp_lives',ref['id']) for ref in refs if ref.get('sortKey','')>'0000000000000:~']
            u.prefetch([(kind,row['owner_id']) for row in rows if row for kind in ('workers','rp_members','network_suspensions','rp_subscriptions','rp_trials')])
            return {'rooms':[public(row) for row in rows if available(u,row,a)][:20],'ready':readiness()['ready']}
        return store.run(read)
    @r.post('/live')
    def create(body:Create,a=Depends(actor)):
        user=signed(a);identifier=digest(user['id']+':live:'+str(body.clientId));fingerprint=digest(body.model_dump_json())
        def claim(u):
            member=publisher(u,a)
            if len(body.title.strip())<3:fail('LIVE_TITLE_REQUIRED','Give this broadcast a title of at least three characters.',422)
            if member.get('suspended') or (u.get('network_suspensions',user['id']) or {}).get('active'):fail('LIVE_UNAVAILABLE','Live publishing is unavailable for this account.',403)
            if not readiness()['ready']:fail('LIVE_NOT_CONNECTED','Live video is not open yet.',503)
            old=u.get('rp_lives',identifier)
            if old:
                if old['fingerprint']!=fingerprint:fail('LIVE_REQUEST_CHANGED','Use a new request for a different broadcast.',409)
                if old['state'] in ('starting','active'):
                    connection=u.get('rp_live_provider',identifier)
                    if connection:return old,connection
                    fail('LIVE_SETUP_PENDING','Your broadcast connection is still being prepared. Retry shortly.',409)
                fail('LIVE_ALREADY_ENDED','This broadcast has ended. Start a new broadcast.',409)
            lock=u.get('rp_live_owners',user['id']) or {}
            prior=u.get('rp_lives',lock.get('id','')) if lock.get('id') else None
            if prior and prior['state'] in ('starting','active','stopping'):fail('LIVE_ALREADY_OPEN','End your current broadcast before starting another.',409)
            rate(u,user['id'],'live-create',4)
            row={'id':identifier,'owner_id':user['id'],'title':body.title.strip(),'trade':member['trade'],'visibility':body.visibility,'state':'starting','created_at':time.time(),'expires_at':time.time()+MAX_SECONDS,'fingerprint':fingerprint}
            u.put('rp_lives',identifier,row);u.put('rp_live_owners',user['id'],{'id':identifier});index(u,row)
            return row,None
        row,connection=store.run(claim)
        if connection:return {**public(row),'publish_url':connection['publish_url']}
        created=None
        try:
            created=provider('POST',body={'meta':{'name':'Repaidians '+identifier},'recording':{'mode':'off','requireSignedURLs':True}})
            input_id=created['uid']
            if not re.fullmatch('[a-f0-9]{32}',input_id):raise ValueError()
            connection={'input_id':input_id,'publish_url':endpoint(created['webRTC']['url'],'/webRTC/publish'),'play_url':endpoint(created['webRTCPlayback']['url'],'/webRTC/play')}
            def commit(u):
                current=u.get('rp_lives',identifier)
                if not current or current['state']!='starting':fail('LIVE_ALREADY_ENDED','This broadcast has ended.',409)
                u.put('rp_live_provider',identifier,connection)
            store.run(commit)
            return {**public(row),'publish_url':connection['publish_url']}
        except Exception:
            if created and re.fullmatch('[a-f0-9]{32}',str(created.get('uid',''))):
                try:provider('DELETE','/'+created['uid'])
                except Exception:
                    store.run(lambda u:u.put('rp_live_provider',identifier,{'input_id':created['uid']}))
            def failed(u):
                current=u.get('rp_lives',identifier)
                current.update(state='stopping' if u.get('rp_live_provider',identifier) else 'failed',cleanup_at=time.time()+60)
                u.put('rp_lives',identifier,current);index(u,current)
            store.run(failed)
            fail('LIVE_CONNECTION_FAILED','The broadcast could not connect. Check your connection and retry.',503)
    @r.post('/live/{identifier}/activate')
    def activate(identifier:str,a=Depends(actor)):
        user=signed(a)
        def check(u):
            publisher(u,a);row=u.get('rp_lives',identifier);connection=u.get('rp_live_provider',identifier)
            if not row or row['owner_id']!=user['id'] or row['state'] not in ('starting','active') or not connection:fail('LIVE_UNAVAILABLE','This broadcast is not available.',404)
            return row,connection
        row,connection=store.run(check)
        data=provider('GET','/'+connection['input_id']) or {}
        state=data.get('status')
        if state not in ('connected','reconnected'):fail('LIVE_NOT_RECEIVING','Video has not reached the broadcast yet. Retry in a moment.',409)
        def confirm(u):
            current,_=check(u)
            if current['expires_at']<=time.time():fail('LIVE_ENDED','This broadcast has ended.',409)
            current.update(state='active',heartbeat_at=time.time());u.put('rp_lives',identifier,current);index(u,current)
            return public(current)
        return store.run(confirm)
    @r.post('/live/{identifier}/heartbeat')
    def heartbeat(identifier:str,a=Depends(actor)):
        user=signed(a)
        def update(u):
            publisher(u,a);row=u.get('rp_lives',identifier)
            if not row or row['owner_id']!=user['id'] or row['state']!='active' or row['expires_at']<=time.time():fail('LIVE_ENDED','This broadcast has ended.',409)
            row['heartbeat_at']=time.time();u.put('rp_lives',identifier,row);index(u,row)
            return {'state':'active','expires_at':row['expires_at']}
        return store.run(update)
    @r.post('/live/{identifier}/watch')
    def watch(identifier:str,a=Depends(actor)):
        def read(u):
            browse(u,a);row=u.get('rp_lives',identifier)
            if not available(u,row,a):fail('LIVE_UNAVAILABLE','This broadcast is no longer available.',404)
            rate(u,a['subject'],'live-watch',60,60000)
            connection=u.get('rp_live_provider',identifier)
            if not connection or not readiness()['ready']:fail('LIVE_UNAVAILABLE','This broadcast is no longer available.',404)
            expires=min(time.time()+TOKEN_SECONDS,row['expires_at'],row['heartbeat_at']+LEASE_SECONDS)
            return {'room':public(row),'play_url':signed_playback(connection['play_url'],connection['input_id'],expires),'expires_at':expires}
        return store.run(read)
    @r.post('/live/{identifier}/end')
    def end(identifier:str,a=Depends(actor)):return close(core,identifier,signed(a)['id'])
    @r.post('/admin/live/{identifier}/end',dependencies=[Depends(core.operator)])
    def admin_end(identifier:str):return close(core,identifier,admin=True)
