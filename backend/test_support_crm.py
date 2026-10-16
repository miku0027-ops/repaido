"""Support remains private, retry-safe and bounded as the company queue grows."""
import uuid
import pytest
import main
from test_operations import api,auth,ADMIN
from operations import Unit

def create(api,category='scrap'):
    body=dict(category=category,message='Please help with this collection receipt.',request_id=str(uuid.uuid4()))
    response=api.post('/operations/support',headers=auth('customer'),json=body)
    assert response.status_code==201,response.text
    return response.json(),body

@pytest.mark.parametrize('category',['market','rental','scrap','rewards','hiring','account'])
def test_platform_topics_use_the_same_private_ticket_lifecycle(api,category):
    case,body=create(api,category)
    assert case['customer_name']=='customer' and case['priority']=='normal' and case['preview']==body['message']
    assert api.get('/operations/support/'+case['id'],headers=auth('worker')).status_code==404
    assert api.get('/operations/support',headers=auth('worker')).json()['cases']==[]
    assert api.post('/operations/support',headers=auth('customer'),json=body).json()['id']==case['id']

def test_support_reply_creates_one_private_notification_even_when_retried(api):
    case,_=create(api);body=dict(message='We have checked your weighing receipt.',request_id=str(uuid.uuid4()))
    for _ in range(2):assert api.post('/operations/admin/support/'+case['id']+'/messages',headers=ADMIN,json=body).status_code==200
    saved=api.get('/operations/support/'+case['id'],headers=auth('customer')).json()
    assert saved['case']['message_count']==2 and saved['case']['last_actor_role']=='support'
    assert len(saved['messages'])==2
    notes=api.get('/operations/notifications',headers=auth('customer')).json()['notifications']
    notes=[note for note in notes if note.get('destination')=='support']
    assert len(notes)==1 and notes[0]['case_id']==case['id']
    assert body['message'] not in str(notes)

def test_assignment_prevents_another_teammate_reply_and_resolution(api):
    case,_=create(api)
    def own(u):
        row=u.get('support_cases',case['id']);row['assigned_to']='other-company-agent';u.put('support_cases',row['id'],row)
    main.operations_store.run(own);path='/operations/admin/support/'+case['id']
    assert api.post(path+'/messages',headers=ADMIN,json=dict(message='A conflicting reply',request_id=str(uuid.uuid4()))).status_code==409
    assert api.post(path+'/actions',headers=ADMIN,json=dict(action='resolve',reason='A conflicting resolution.',expected_version=1)).status_code==409

def test_actions_are_retry_safe_and_cannot_reopen_an_already_open_case(api):
    case,_=create(api);path='/operations/support/'+case['id']+'/actions'
    body=dict(action='escalate',reason='Please review the conflicting collection amounts.',expected_version=1)
    for _ in range(2):
        response=api.post(path,headers=auth('customer'),json=body);assert response.status_code==200,response.text
        assert response.json()['version']==2 and response.json()['priority']=='high'
    assert api.post(path,headers=auth('customer'),json=dict(action='reopen',reason='This case remains open already.',expected_version=2)).status_code==409

def test_customer_threads_and_lists_never_scan_other_accounts(api,monkeypatch):
    case,_=create(api);original=Unit.all
    def bounded(u,kind,*args,**kwargs):
        assert kind not in ('support_cases','support_messages')
        return original(u,kind,*args,**kwargs)
    monkeypatch.setattr(Unit,'all',bounded)
    assert api.get('/operations/support',headers=auth('customer')).status_code==200
    assert api.get('/operations/support/'+case['id'],headers=auth('customer')).status_code==200
    assert api.get('/operations/admin/support',headers=ADMIN).status_code==200

def test_company_keyset_pages_are_recent_bounded_and_do_not_lose_equal_timestamps(api):
    def seed(u):
        for number in range(105):
            key='fixture-case-'+str(number).zfill(3)
            u.put('support_cases',key,dict(id=key,customer_id='customer',category='general',state='open',version=1,created_at=1000,updated_at=1000+number//3))
    main.operations_store.run(seed);ids=[];cursor=''
    while True:
        response=api.get('/operations/admin/support',headers=ADMIN,params=dict(limit=20,cursor=cursor));assert response.status_code==200,response.text
        page=response.json();assert len(page['cases'])<=20;ids.extend(row['id'] for row in page['cases']);cursor=page['next_cursor']
        if not cursor:break
    assert len(ids)==len(set(ids))==105 and ids==sorted(ids,reverse=True)
    assert api.get('/operations/admin/support',headers=auth('customer')).status_code==403
    assert api.get('/operations/admin/support?cursor=invalid',headers=ADMIN).status_code==422
    assert api.get('/operations/admin/support?limit=10000',headers=ADMIN).status_code==422

def test_safety_priority_is_honest(api):
    case,_=create(api,'safety');assert case['priority']=='urgent'
    saved=api.get('/operations/support/'+case['id'],headers=auth('customer')).json()
    assert saved['case']['state']=='open' and saved['messages'][0]['actor_role']=='requester'

def test_native_queue_cursor_is_bounded_and_uses_the_real_firestore_document_reference(monkeypatch):
    import base64,json
    from types import SimpleNamespace
    from google.auth.credentials import AnonymousCredentials
    from google.cloud.firestore_v1 import Client,Query
    from lifecycle import support_page
    client=Client(project='support-test-only',credentials=AnonymousCredentials());captured=[]
    def stream(query,transaction=None):
        captured.append(query._to_protobuf());return iter([])
    monkeypatch.setattr(Query,'stream',stream)
    core=SimpleNamespace(fs_collection=lambda kind:client.collection(kind),fs_doc=lambda kind,key:client.collection(kind).document(key))
    unit=SimpleNamespace(core=core,tx=object())
    cursor=base64.urlsafe_b64encode(json.dumps([1000,'case-fixture']).encode()).decode().rstrip('=')
    assert support_page(unit,cursor,20)['cases']==[]
    query=captured[0]
    assert query.limit==21
    assert [item.field.field_path for item in query.order_by]==['updated_at','__name__']
    assert query.start_at.values[0].integer_value==1000
    assert query.start_at.values[1].reference_value.endswith('/ops_support_cases/case-fixture')

def test_legacy_conversations_get_their_actual_message_count_on_the_next_reply(api):
    case,_=create(api)
    def legacy(u):
        row=u.get('support_cases',case['id']);row.pop('message_count');row['version']=3;u.put('support_cases',row['id'],row)
        for index in range(2):
            key='legacy-message-'+str(index)
            u.put('support_messages',key,dict(id=key,case_id=case['id'],actor_role='requester',message='Earlier saved message',created_at=1000+index))
    main.operations_store.run(legacy)
    response=api.post('/operations/admin/support/'+case['id']+'/messages',headers=ADMIN,json=dict(message='We have reviewed the conversation history.',request_id=str(uuid.uuid4())))
    assert response.status_code==200,response.text
    saved=api.get('/operations/support/'+case['id'],headers=auth('customer')).json()
    assert saved['case']['message_count']==len(saved['messages'])==4
