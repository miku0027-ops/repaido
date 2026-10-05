"""Private, visit-scoped camera evidence. Device GPS/time is not hardware attestation."""
import hashlib,json,os,time,uuid,io
from PIL import Image
Image.MAX_IMAGE_PIXELS=20_000_000
from fastapi import APIRouter,Depends,Request,Response
from pydantic import Field
from typing import Literal
from operations import Input,Position,fail,event,metres
from integrations import audit

class Capture(Input):
    kind:Literal['before','after']
class Metadata(Position):
    source:Literal['repaido_camera_v1','repaido_web_camera_v1']

def require_evidence(u,j,kind,now):
    rows=[u.get('evidence',eid) for eid in j.get('evidence_ids',[])]
    valid=[e for e in rows if e and e['status']=='ready' and e['visit_id']==j['visit_id'] and e['worker_id']==j.get('worker_id') and e['kind']==kind]
    if kind=='before':valid=[e for e in valid if e.get('visit_id')==j['visit_id']]
    if kind=='after':valid=[e for e in valid if e['captured_at']>=j.get('started_at',now)]
    if not valid:fail('CAMERA_EVIDENCE_REQUIRED',f'Capture and upload a {kind} photo for this visit using the Repaido Agent camera before continuing.')

def upload_object(key,data):
    from google.cloud import storage
    blob=storage.Client().bucket(os.environ['REPAIDO_KYC_BUCKET']).blob(key)
    blob.cache_control='no-store';blob.upload_from_string(data,content_type='image/jpeg',if_generation_match=0)
def download_object(key):
    from google.cloud import storage
    return storage.Client().bucket(os.environ['REPAIDO_KYC_BUCKET']).blob(key).download_as_bytes()

def install(core):
    store=core.operations_store;r=APIRouter(prefix='/operations',tags=['Private task evidence'])
    def job_access(u,jid,user,worker=False):
        j=u.get('jobs',jid);w=u.get('workers',user['id'])
        if not j or user['id'] not in (j['customer_id'],j.get('worker_id')):fail('NOT_FOUND','Task not found.',404)
        if worker and (user['id']!=j.get('worker_id') or not user.get('phone_verified') or not w or w['status']!='approved'):fail('WORKER_REQUIRED','Assigned approved worker required.',403)
        return j
    def capture_state(j,kind):
        if j.get('home_log_required'):fail('USE_DAILY_LOG','This home-help visit uses private arrival and daily checklists. Do not photograph the recipient.',422)
        if (kind=='before' and j['state'] not in ('arrived', 'in_progress')) or (kind=='after' and j['state']!='in_progress'):fail('CAPTURE_NOT_AVAILABLE','Before photos require arrival or active work; after photos require work in progress.')
    @r.post('/jobs/{job_id}/capture-session')
    def challenge(job_id:str,body:Capture,user=Depends(core.current_user)):
        if not os.getenv('REPAIDO_KYC_BUCKET'):fail('STORAGE_UNAVAILABLE','Private evidence storage is unavailable. Retry or contact support.',503)
        def save(u):
            j=job_access(u,job_id,user,True);capture_state(j,body.kind)
            if len([c for c in u.all('capture_sessions') if c['worker_id']==user['id'] and c['issued_at']>time.time()-3600])>=30:fail('CAPTURE_LIMIT','Too many capture attempts. Contact support if the camera keeps failing.',429)
            c=dict(id=str(uuid.uuid4()),job_id=job_id,visit_id=j['visit_id'],worker_id=user['id'],kind=body.kind,issued_at=time.time(),expires_at=time.time()+600,
                   task_name=j['service_name'],customer_name=j.get('customer_name','Customer name not recorded'),status='issued')
            u.put('capture_sessions',c['id'],c);return c
        return store.run(save)
    @r.post('/capture-sessions/{capture_id}/photo')
    async def upload(capture_id:str,request:Request,user=Depends(core.current_user)):
        if request.headers.get('content-type')!='image/jpeg':fail('JPEG_REQUIRED','Use the in-app camera JPEG.',422)
        try:metadata=Metadata.model_validate(json.loads(request.headers.get('x-capture-metadata','{}')))
        except (ValueError,TypeError):fail('INVALID_METADATA','Fresh camera time and accurate location are required.',422)
        data=bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data)>5*1024*1024:fail('PHOTO_TOO_LARGE','Photo exceeds 5 MB. Retake at a smaller resolution.',413)
        if len(data)<100 or data[:3]!=b'\xff\xd8\xff' or data[-2:]!=b'\xff\xd9':fail('INVALID_JPEG','Camera photo is incomplete. Retake it.',422)
        try:
            with Image.open(io.BytesIO(data)) as image:
                if image.format!='JPEG' or image.width<32 or image.height<32 or image.width*image.height>20_000_000:raise ValueError()
                exif=image.getexif();comment=exif.get(0x9286) or exif.get_ifd(0x8769).get(0x9286)
                if isinstance(comment,bytes):
                    if comment.startswith(b'ASCII\x00\x00\x00'):comment=comment[8:].decode('utf-8')
                    elif comment.startswith(b'UNICODE\x00'):comment=comment[8:].decode('utf-16')
                    else:comment=comment.decode('utf-8')
                embedded=json.loads(comment.rstrip('\x00'));image.verify()
        except Exception:fail('INVALID_CAMERA_PHOTO','Use a complete photo from the Repaido camera with its embedded capture metadata.',422)
        if embedded.get('capture_id')!=capture_id or any(embedded.get(k)!=v for k,v in metadata.model_dump().items()):fail('CAMERA_METADATA_MISMATCH','Image metadata differs from this capture. Retake it in the Repaido camera.',422)
        checksum=hashlib.sha256(data).hexdigest()
        def reserve(u):
            c=u.get('capture_sessions',capture_id)
            if not c or c['worker_id']!=user['id']:fail('NOT_FOUND','Capture session not found.',404)
            j=job_access(u,c['job_id'],user,True)
            if embedded.get('job_id')!=j['id'] or embedded.get('visit_id')!=c['visit_id']:fail('CAMERA_METADATA_MISMATCH','Photo belongs to another task or visit.',422)
            old=u.get('evidence',capture_id)
            if old:
                if old['sha256']!=checksum:fail('CAPTURE_REUSED','A different image requires a new camera session.')
                if old['status']=='ready':return old,False
            now=time.time();capture_state(j,c['kind'])
            if c['expires_at']<now or c['visit_id']!=j['visit_id']:fail('CAPTURE_EXPIRED','This camera session expired or belongs to an earlier visit. Retake the photo.')
            if abs(now-metadata.captured_at)>180 or metadata.captured_at<c['issued_at']-5:fail('STALE_CAPTURE','Use a new photo with your device clock set automatically.',422)
            if metadata.accuracy>50 or metres(metadata.model_dump(),j['location'])+metadata.accuracy>150:fail('EVIDENCE_LOCATION_REQUIRED','Capture an accurate GPS fix at the service location (within 150 m). Retry outside near the entrance.',422)
            if old and old.get('lease_until',0)>now:fail('UPLOAD_PENDING','Upload is already pending. Retry shortly.')
            e=dict(id=capture_id,job_id=j['id'],visit_id=j['visit_id'],worker_id=user['id'],customer_id=j['customer_id'],kind=c['kind'],task_name=c['task_name'],customer_name=c['customer_name'],
                   **metadata.model_dump(),status='uploading',object=f'task-evidence/{j["id"]}/{capture_id}',sha256=checksum,size=len(data),server_received_at=now,expires_at=now+30*86400,lease_until=now+60,
                   provenance='Authenticated capture session; device-reported GPS and time, not hardware attested')
            u.put('evidence',capture_id,e);return e,True
        e,send=store.run(reserve)
        if not send:return {'id':e['id'],'status':'ready','kind':e['kind']}
        try:
            upload_object(e['object'],bytes(data))
        except Exception:
            # A lost upload response is reconciled by content hash, not a new object.
            try:
                if hashlib.sha256(download_object(e['object'])).hexdigest()!=checksum:raise ValueError()
            except Exception:fail('UPLOAD_UNCERTAIN','Upload could not be confirmed. Keep this screen open and retry the same photo.',503)
        def finish(u):
            j=job_access(u,e['job_id'],user,True);capture_state(j,e['kind'])
            if j['visit_id']!=e['visit_id']:fail('VISIT_CHANGED','The visit changed. Capture evidence for the new visit.')
            e.update(status='ready',lease_until=0);u.put('evidence',e['id'],e)
            j['evidence_ids']=list(dict.fromkeys([*j.get('evidence_ids',[]),e['id']]))
            j['version']+=1;event(u,j,'VisitEvidenceUploaded',user['id'],{'kind':e['kind'],'evidence_id':e['id']});u.put('jobs',j['id'],j)
            audit(u,'TaskEvidenceUploaded',user['id'],job_id=j['id'],visit_id=j['visit_id'],evidence_id=e['id']);return {'id':e['id'],'status':'ready','kind':e['kind']}
        return store.run(finish)
    def evidence_list(u,j):
        return [{k:v for k,v in e.items() if k not in ('object','lease_until','customer_id','worker_id')} for e in u.all('evidence') if e['job_id']==j['id'] and e['status']=='ready']
    @r.get('/jobs/{job_id}/evidence')
    def listing(job_id:str,user=Depends(core.current_user)):
        return store.run(lambda u:{'evidence':evidence_list(u,job_access(u,job_id,user))})
    @r.get('/admin/jobs/{job_id}/evidence')
    def admin_listing(job_id:str,admin=Depends(core.operator)):
        def read(u):
            j=u.get('jobs',job_id)
            if not j:fail('NOT_FOUND','Task not found.',404)
            audit(u,'TaskEvidenceAccessed',admin['id'],job_id=job_id);return {'evidence':evidence_list(u,j)}
        return store.run(read)
    def photo(eid,user,admin=False):
        def read(u):
            e=u.get('evidence',eid)
            if not e or e['status']!='ready' or e['expires_at']<time.time():fail('EVIDENCE_UNAVAILABLE','Photo expired after 30 days or is unavailable.',404)
            if not admin:job_access(u,e['job_id'],user)
            audit(u,'TaskEvidenceViewed',user['id'],evidence_id=eid);return e
        e=store.run(read)
        try:data=download_object(e['object'])
        except Exception:fail('EVIDENCE_UNAVAILABLE','Photo is temporarily unavailable. Retry later.',503)
        return Response(data,media_type='image/jpeg',headers={'Cache-Control':'no-store','Content-Disposition':f'attachment; filename="{eid}.jpg"','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"})
    @r.get('/evidence/{evidence_id}/photo')
    def get_photo(evidence_id:str,user=Depends(core.current_user)):return photo(evidence_id,user)
    @r.get('/admin/evidence/{evidence_id}/photo')
    def admin_photo(evidence_id:str,admin=Depends(core.operator)):return photo(evidence_id,admin,True)
    core.app.include_router(r)
