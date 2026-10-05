"""HTTP visit/photo contracts with private blob storage stubbed. No real camera attestation."""
import time,uuid
from datetime import datetime,timezone
from unittest.mock import patch
import pytest
import main,evidence,operations
from test_operations import api,auth,ADMIN,onboard,book,command,PIN

def jpeg(c,meta,color='blue'):
    import io,json
    from PIL import Image
    image=Image.new('RGB',(320,240),color);exif=Image.Exif();exif[0x9286]=json.dumps({**meta,'capture_id':c['id'],'job_id':c['job_id'],'visit_id':c['visit_id']}).encode();buffer=io.BytesIO();image.save(buffer,format='JPEG',exif=exif);return buffer.getvalue()

def arrived(api):
    onboard(api);j,_=book(api);j=command(api,j,'accept');j=command(api,j,'ack_reminder');j=command(api,j,'depart')
    return command(api,j,'position',payload={**PIN,'accuracy':5,'captured_at':time.time()})

def raw(api,j,action,payload=None,status=200):
    body={'action':action,'expected_version':j['version'],'command_id':str(uuid.uuid4()),'payload':payload or {}}
    r=api.post(f"/operations/jobs/{j['id']}/commands",headers=auth('worker'),json=body);assert r.status_code==status,r.text
    return r.json()

@pytest.fixture
def blobs(monkeypatch):
    monkeypatch.setenv('REPAIDO_KYC_BUCKET','test-private-only');rows={}
    monkeypatch.setattr(evidence,'upload_object',lambda key,data:rows.setdefault(key,data))
    monkeypatch.setattr(evidence,'download_object',lambda key:rows[key])
    return rows

def capture(api,j,kind):
    r=api.post(f"/operations/jobs/{j['id']}/capture-session",headers=auth('worker'),json={'kind':kind});assert r.status_code==200,r.text
    c=r.json();meta={'source':'repaido_camera_v1',**PIN,'accuracy':5,'captured_at':time.time()}
    return c,meta

def upload(api,c,meta,uid='worker',data=None):
    import json
    return api.post(f"/operations/capture-sessions/{c['id']}/photo",headers={**auth(uid),'Content-Type':'image/jpeg','X-Capture-Metadata':json.dumps(meta)},content=data if data is not None else jpeg(c,meta))

def get(api,j):return api.get(f"/operations/jobs/{j['id']}",headers=auth('worker')).json()

def test_mandatory_before_after_and_private_photo(api,blobs):
    j=arrived(api);raw(api,j,'start',status=409)
    c,meta=capture(api,j,'before')
    assert upload(api,c,meta,'stranger').status_code==404
    assert upload(api,c,{**meta,'lat':0}).status_code==422
    assert upload(api,c,{**meta,'captured_at':time.time()-1000}).status_code==422
    assert upload(api,c,meta).status_code==200
    assert upload(api,c,meta).status_code==200
    assert upload(api,c,meta,data=jpeg(c,meta,'red')).status_code==409
    assert len(blobs)==1
    j=raw(api,get(api,j),'start');raw(api,j,'submit_completion',{'notes':'Finished safely'},409)
    a,meta=capture(api,j,'after');assert upload(api,a,meta).status_code==200
    j=raw(api,get(api,j),'submit_completion',{'notes':'Finished and checked'});assert j['state']=='completion_pending'
    url=f"/operations/evidence/{c['id']}/photo"
    assert api.get(url,headers=auth('stranger')).status_code==404
    assert api.get(url,headers=auth('customer')).content==next(v for k,v in blobs.items() if k.endswith(c['id']))
    assert api.get('/operations/admin/evidence/'+c['id']+'/photo',headers=auth('worker')).status_code==403
    assert api.get('/operations/admin/evidence/'+c['id']+'/photo',headers=ADMIN).status_code==200
    j=command(api,j,'accept_completion','customer');assert j['state']=='completed'
    command(api,j,'review','customer',{'rating':4,'text':'Verified work and evidence'})


def test_followup_24h_ack_same_job_repeats_evidence(api,blobs):
    j=arrived(api);c,m=capture(api,j,'before');upload(api,c,m);j=raw(api,get(api,j),'start')
    original_id=j['id'];old_visit=j['visit_id'];total=j['total_paise'];when=time.time()+3*86400
    payload={'starts_at':datetime.fromtimestamp(when,timezone.utc).isoformat(),'purpose':'inspection','reason':'Part needs curing before the next inspection'}
    key=str(uuid.uuid4());body={'action':'schedule_follow_up','expected_version':j['version'],'command_id':key,'payload':payload};path=f"/operations/jobs/{j['id']}/commands"
    r=api.post(path,headers=auth('worker'),json=body);assert r.status_code==200,r.text;j=r.json()
    assert api.post(path,headers=auth('worker'),json=body).json()['visit_id']==j['visit_id']
    assert j['state']=='follow_up_scheduled' and j['id']==original_id and j['worker_id']=='worker' and j['visit_id']!=old_visit and j['total_paise']==total
    assert abs(j['reminder_at']-(when-86400))<1
    assert 'position' not in j and not j['tracking_consent']
    raw(api,j,'depart',status=409)
    with patch('time.time',return_value=when-86400+1):
        main.operations_tick();j=get(api,j);assert 'ack_reminder' in j['allowed_actions']
        assert len([e for e in j['events'] if e['event_type']=='PreparationReminderDue'])>=1
        before=len(j['events']);main.operations_tick();assert len(get(api,j)['events'])==before
        j=raw(api,j,'ack_reminder');raw(api,j,'depart',status=409)
    with patch('time.time',return_value=when-1800):
        def refresh(u):
            w=u.get('workers','worker');w['position']={**PIN,'accuracy':5,'received_at':time.time()};u.put('workers','worker',w)
        main.operations_store.run(refresh)
        j=raw(api,get(api,j),'depart');j=raw(api,j,'position',{**PIN,'accuracy':5,'captured_at':time.time()});raw(api,j,'start',status=409)
        c,m=capture(api,j,'before');assert upload(api,c,m).status_code==200;j=raw(api,get(api,j),'start')
        c,m=capture(api,j,'after');assert upload(api,c,m).status_code==200;j=raw(api,get(api,j),'submit_completion',{'notes':'Inspection passed and all checks complete'})
        j=command(api,j,'accept_completion','customer');assert j['id']==original_id and j['state']=='completed'
        assert main.operations_store.run(lambda u:u.get('workers','worker'))['completed_tasks']==1


def test_followup_short_notice_conflicts_and_capture_revocation(api,blobs):
    j=arrived(api);c,m=capture(api,j,'before');upload(api,c,m);j=raw(api,get(api,j),'start');after,m=capture(api,j,'after')
    when=time.time()+8000;payload={'starts_at':datetime.fromtimestamp(when,timezone.utc).isoformat(),'purpose':'repair','reason':'Waiting for approved repair materials'}
    # A customer cannot reschedule a worker's ongoing visit command.
    r=api.post(f"/operations/jobs/{j['id']}/commands",headers=auth('customer'),json={'action':'schedule_follow_up','expected_version':j['version'],'command_id':str(uuid.uuid4()),'payload':payload});assert r.status_code==409
    j=raw(api,j,'schedule_follow_up',payload);assert abs(j['reminder_at']-time.time())<5
    assert upload(api,after,m).status_code==409
    assert 'ack_reminder' in j['allowed_actions']
    raw(api,j,'schedule_follow_up',{**payload,'starts_at':'bad'},422)


def test_capture_storage_failure_retry_and_expiry(api,blobs,monkeypatch):
    j=arrived(api);c,m=capture(api,j,'before');real_upload=evidence.upload_object
    def lost(key,data):real_upload(key,data);raise OSError('lost response')
    monkeypatch.setattr(evidence,'upload_object',lost)
    assert upload(api,c,m).status_code==200 # recovered by matching stored hash
    with patch('time.time',return_value=time.time()+31*86400):
        assert api.get(f"/operations/evidence/{c['id']}/photo",headers=auth('customer')).status_code==404


def test_gallery_metadata_tamper_and_cross_visit_reuse_are_rejected(api,blobs):
    j=arrived(api);c,m=capture(api,j,'before');good=jpeg(c,m)
    assert upload(api,c,{**m,'lat':m['lat']+.001},data=good).status_code==422
    assert upload(api,c,m,data=b'\xff\xd8\xff'+b'not a photo'*100+b'\xff\xd9').status_code==422
    other,m2=capture(api,j,'before')
    assert upload(api,other,m2,data=good).status_code==422
    assert not blobs


def test_future_followup_preserves_prior_penalties_and_allows_nonoverlapping_work(api,blobs):
    j=arrived(api);c,m=capture(api,j,'before');upload(api,c,m);j=raw(api,get(api,j),'start')
    oldvisit=j['visit_id']
    def assess(u):
        row=u.get('jobs',j['id']);row['penalties']=[dict(code='LATE_DEPARTURE',worker_id='worker',visit_id=oldvisit,current_percent=20,status='pending_settlement_review')];u.put('jobs',j['id'],row)
    main.operations_store.run(assess)
    j=raw(api,j,'schedule_follow_up',{'starts_at':datetime.fromtimestamp(time.time()+4*86400,timezone.utc).isoformat(),'purpose':'repair','reason':'Waiting for the approved replacement part'})
    another,_=book(api);assert another['worker_id']=='worker'
    another=command(api,another,'accept');assert another['state']=='accepted'
    from integrations import settlement
    def payable(u):
        row=u.get('jobs',j['id']);row.update(state='completed',payment_status='verified',settlement_policy={'worker_share_bps':7500,'bonus_reserve_bps':1000,'penalty_cap_bps':5000,'stack_penalties':False,'penalty_mode':'highest_single'});u.put('jobs',j['id'],row)
        return settlement(u,row['id'])
    assert main.operations_store.run(payable)['deduction_paise']>0


def test_browser_camera_metadata_and_full_completion(api,blobs):
    # Exercise the browser's actual EXIF encoder, then the same private server gates.
    import subprocess,json,pathlib
    j=arrived(api)
    for kind in ('before','after'):
        c,m=capture(api,j,kind);m['source']='repaido_web_camera_v1'
        import base64,io
        from PIL import Image
        b=io.BytesIO();Image.new('RGB',(640,480),'green').save(b,format='JPEG')
        module=(pathlib.Path(__file__).resolve().parent.parent/'web/src/services/cameraMetadata.mjs').as_uri()
        script=f"import {{embedCameraMetadata}} from {json.dumps(module)};let input=JSON.parse(await new Promise(r=>{{let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>r(s));}}));process.stdout.write(Buffer.from(embedCameraMetadata(Buffer.from(input.image,'base64'),input.metadata)));"
        encoded=subprocess.run(['node','--input-type=module','-e',script],input=json.dumps({'image':base64.b64encode(b.getvalue()).decode(),'metadata':{**m,'capture_id':c['id'],'job_id':c['job_id'],'visit_id':c['visit_id']}}).encode(),capture_output=True,check=True).stdout
        assert upload(api,c,m,data=encoded).status_code==200
        assert upload(api,c,m,data=encoded).status_code==200
        j=raw(api,get(api,j),'start' if kind=='before' else 'submit_completion',{} if kind=='before' else {'notes':'Browser work checked and completed'})
    j=command(api,j,'accept_completion','customer');assert j['state']=='completed'
    j=command(api,j,'review','customer',{'rating':4,'text':'Completed using browser capture'})


def test_forgotten_before_photo_information_option(api,blobs):
    j=arrived(api)
    def set_v2(u):
        row=u.get('jobs',j['id']);row['procurement_version']=2;row['arrival_verified_visit']=row['visit_id'];u.put('jobs',j['id'],row)
    main.operations_store.run(set_v2)
    # New visits now require before evidence; retain recovery for already-running legacy work.
    blocked=raw(api,get(api,j),'start',status=409)
    assert blocked['detail']['code']=='CAMERA_EVIDENCE_REQUIRED'
    def legacy_active(u):
        row=u.get('jobs',j['id']);row.update(state='in_progress',started_at=time.time());u.put('jobs',j['id'],row)
    main.operations_store.run(legacy_active)
    j=get(api,j)

    # Take after photo only
    a,meta=capture(api,j,'after');assert upload(api,a,meta).status_code==200
    j=get(api,j)

    # Submitting completion without before photo and without forgotten_info fails 422
    r=api.post(f"/operations/jobs/{j['id']}/commands",headers=auth('worker'),json={
        'action':'submit_completion','expected_version':j['version'],'command_id':str(uuid.uuid4()),
        'payload':{'notes':'Repairs finished and unit tested'}
    })
    assert r.status_code==422
    assert 'Before inspection photo was omitted' in r.json()['detail']['message']

    # Submitting completion with compulsory forgotten_info succeeds!
    j=raw(api,get(api,j),'submit_completion',{
        'notes':'Repairs finished and unit tested',
        'forgotten_info':'Device initial condition: panel was already opened, fan wire loose, casing intact.'
    })
    assert j['state']=='completion_pending'
    assert j['evidence_summary']['has_before'] is False
    assert j['evidence_summary']['has_after'] is True
    assert j['evidence_summary']['has_forgotten_info'] is True
    assert 'panel was already opened' in j['evidence_summary']['before_omission_reason']

