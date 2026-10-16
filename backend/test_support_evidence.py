"""Case-scoped evidence and honest response targets, using HTTP and isolated storage."""
import io
import time
import uuid
from types import SimpleNamespace
import pytest
from PIL import Image
import main
import lifecycle
import support_evidence
from test_operations import api,auth,ADMIN
from test_support_crm import create


def png(color='red'):
    stream=io.BytesIO();Image.new('RGB',(12,12),color).save(stream,format='PNG');return stream.getvalue()


@pytest.fixture
def storage(monkeypatch):
    objects={};calls=[]
    monkeypatch.setenv('REPAIDO_KYC_BUCKET','test-only')
    def upload(key,data):
        calls.append(key)
        if key in objects:raise RuntimeError('Object already exists')
        objects[key]=data
    monkeypatch.setattr(support_evidence,'upload_object',upload)
    monkeypatch.setattr(support_evidence,'download_object',lambda key:objects[key])
    return objects,calls


def upload(api,case,headers=None,upload_id=None,color='red',admin=False):
    path=('/operations/admin/support/' if admin else '/operations/support/')+case['id']+'/attachments'
    return api.post(path,headers={**(headers or auth('customer')),'Content-Type':'image/png','X-Upload-ID':upload_id or str(uuid.uuid4())},content=png(color))


def send(api,case,ids,headers=None,admin=False,request_id=None):
    path=('/operations/admin/support/' if admin else '/operations/support/')+case['id']+'/messages'
    return api.post(path,headers=headers or auth('customer'),json={'message':'Supporting receipt and condition photo.','attachment_ids':ids,'request_id':request_id or str(uuid.uuid4())})


def test_evidence_is_private_until_shared_in_its_owned_case(api,storage):
    case,_=create(api);response=upload(api,case)
    assert response.status_code==200,response.text
    attachment=response.json();aid=attachment['id'];path='/operations/support/'+case['id']+'/attachments/'+aid
    assert len(aid)==64 and attachment['content_type']=='image/jpeg'
    assert 'object' not in attachment and 'owner_id' not in attachment and 'digest' not in attachment
    assert api.get(path).status_code==401
    assert api.get(path,headers=auth('stranger')).status_code==404
    assert api.get('/operations/admin/support/'+case['id']+'/attachments/'+aid,headers=ADMIN).status_code==404
    original=api.get(path,headers=auth('customer'))
    assert original.status_code==200 and original.headers['content-type']=='image/jpeg'
    assert 'no-store' in original.headers['cache-control'] and original.headers['x-content-type-options']=='nosniff'
    saved=send(api,case,[aid]);assert saved.status_code==200,saved.text
    assert saved.json()['attachments'][0]['url'].startswith('/api/operations/support/')
    company=api.get('/operations/admin/support/'+case['id'],headers=ADMIN).json()
    assert company['messages'][-1]['attachments'][0]['url'].startswith('/api/operations/admin/support/')
    assert api.get('/operations/admin/support/'+case['id']+'/attachments/'+aid,headers=ADMIN).status_code==200
    assert 'support-attachments/' not in str(company)


def test_attachment_cannot_cross_case_or_sender_or_message(api,storage):
    case,_=create(api);another,_=create(api);aid=upload(api,case).json()['id']
    assert send(api,another,[aid]).status_code==422
    assert send(api,case,[aid],headers=ADMIN,admin=True).status_code==422
    assert upload(api,case,headers=auth('stranger')).status_code==404
    request_id=str(uuid.uuid4());first=send(api,case,[aid],request_id=request_id)
    assert first.status_code==200
    assert send(api,case,[aid],request_id=request_id).json()==first.json()
    assert send(api,case,[],request_id=request_id).status_code==409
    assert send(api,case,[aid]).status_code==409
    assert send(api,case,[aid,aid]).status_code==422
    assert send(api,case,['x'*64]).status_code==422
    assert len(api.get('/operations/support/'+case['id'],headers=auth('customer')).json()['messages'])==2


def test_upload_retry_and_lost_storage_response_consume_one_budget(api,storage,monkeypatch):
    objects,calls=storage;case,_=create(api);upload_id=str(uuid.uuid4())
    def uncertain(key,data):calls.append(key);objects[key]=data;raise TimeoutError('Response lost after object creation')
    monkeypatch.setattr(support_evidence,'upload_object',uncertain)
    first=upload(api,case,upload_id=upload_id);assert first.status_code==200,first.text
    assert upload(api,case,upload_id=upload_id).json()==first.json()
    assert len(calls)==1
    assert upload(api,case,upload_id=upload_id,color='blue').status_code==409
    assert main.operations_store.run(lambda u:u.all('support_attachment_budget'))[0]['count']==1


def test_storage_outage_preserves_plain_message_workflow_and_retry(api,storage,monkeypatch):
    case,_=create(api);monkeypatch.delenv('REPAIDO_KYC_BUCKET')
    assert upload(api,case).status_code==503
    assert send(api,case,[]).status_code==200
    assert main.operations_store.run(lambda u:u.all('support_attachments'))==[]
    monkeypatch.setenv('REPAIDO_KYC_BUCKET','test-only');original=support_evidence.upload_object
    monkeypatch.setattr(support_evidence,'upload_object',lambda *args:(_ for _ in ()).throw(TimeoutError('Storage unavailable')))
    upload_id=str(uuid.uuid4());assert upload(api,case,upload_id=upload_id).status_code==503
    monkeypatch.setattr(support_evidence,'upload_object',original)
    assert upload(api,case,upload_id=upload_id).status_code==200
    assert main.operations_store.run(lambda u:u.all('support_attachment_budget'))[0]['count']==1


def test_expiry_closed_case_and_team_assignment_protect_uploads(api,storage):
    case,_=create(api);aid=upload(api,case).json()['id']
    def expire(u):
        row=u.get('support_attachments',aid);row['expires_at']=time.time()-1;u.put('support_attachments',aid,row)
    main.operations_store.run(expire)
    assert send(api,case,[aid]).status_code==409
    assert api.get('/operations/support/'+case['id']+'/attachments/'+aid,headers=auth('customer')).status_code==404
    def assign(u):
        row=u.get('support_cases',case['id']);row['assigned_to']='another-support-agent';u.put('support_cases',case['id'],row)
    main.operations_store.run(assign)
    assert upload(api,case,headers=ADMIN,admin=True).status_code==409
    def close(u):
        row=u.get('support_cases',case['id']);row['state']='resolved';u.put('support_cases',case['id'],row)
    main.operations_store.run(close)
    assert upload(api,case).status_code==409


def test_support_targets_reply_resolution_escalation_and_reopen(api,monkeypatch):
    clock={'now':1000};monkeypatch.setattr(lifecycle,'time',SimpleNamespace(time=lambda:clock['now']))
    monkeypatch.setenv('REPAIDO_SUPPORT_RESPONSE_TARGET_HOURS','24');monkeypatch.setenv('REPAIDO_SUPPORT_RESOLUTION_TARGET_HOURS','72')
    case,_=create(api)
    assert case['response_target_at']==1000+24*3600 and case['resolution_target_at']==1000+72*3600
    assert case['response_received_at'] is None and 'not guaranteed' in case['target_note']
    clock['now']=1100
    reply=send(api,case,[],headers=ADMIN,admin=True);assert reply.status_code==200
    path='/operations/support/'+case['id']
    saved=api.get(path,headers=auth('customer')).json()['case'];assert saved['response_received_at']==1100
    escalated=api.post(path+'/actions',headers=auth('customer'),json={'action':'escalate','reason':'Please review this case further.','expected_version':saved['version']}).json()
    assert escalated['response_target_at']==case['response_target_at'] and escalated['resolution_target_at']==case['resolution_target_at']
    clock['now']=1200
    resolved=api.post('/operations/admin/support/'+case['id']+'/actions',headers=ADMIN,json={'action':'resolve','reason':'Reviewed receipt and recorded findings.','expected_version':escalated['version']}).json()
    assert resolved['resolved_at']==1200 and resolved['response_received_at']==1100
    clock['now']=1300
    reopened=api.post(path+'/actions',headers=auth('customer'),json={'action':'reopen','reason':'The receipt still needs correction.','expected_version':resolved['version']}).json()
    assert reopened['state']=='open' and reopened['response_received_at'] is None and reopened['resolved_at'] is None
    assert reopened['response_target_at']==1300+24*3600 and reopened['resolution_target_at']==1300+72*3600


def test_target_configuration_is_finite_and_ordered(monkeypatch):
    monkeypatch.setenv('REPAIDO_SUPPORT_RESPONSE_TARGET_HOURS','NaN')
    monkeypatch.setenv('REPAIDO_SUPPORT_RESOLUTION_TARGET_HOURS','2')
    targets=lifecycle.support_targets(100)
    assert targets['response_target_at']==100+24*3600
    assert targets['resolution_target_at']>=targets['response_target_at']


def test_retail_support_link_requires_owned_order(api):
    main.operations_store.run(lambda u:u.put('retail_orders','owned-order',{'id':'owned-order','customer_id':'customer'}))
    body={'category':'market','message':'The delivered order needs review.','retail_order_id':'owned-order','request_id':str(uuid.uuid4())}
    denied=api.post('/operations/support',headers=auth('worker'),json=body);assert denied.status_code==404
    response=api.post('/operations/support',headers=auth('customer'),json=body);assert response.status_code==201,response.text
    assert response.json()['retail_order_id']=='owned-order'
    assert api.post('/operations/support',headers=auth('customer'),json=body).json()['id']==response.json()['id']
    assert api.post('/operations/support',headers=auth('customer'),json={**body,'category':'general','request_id':str(uuid.uuid4())}).status_code==422
