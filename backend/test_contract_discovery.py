"""Bounded public opportunity summaries never fetch protected tender payloads."""
import base64
import json
import time
import uuid
from types import SimpleNamespace

import contract_work
import main
from operations import Unit
from test_operations import api, auth


def publish(api, **changes):
    now = time.time()
    body = dict(request_id=str(uuid.uuid4()), title='Electrical inspection project',
                scope='Confidential detailed installation scope', site='Private customer site entrance',
                starts_at=now + 5000, ends_at=now + 10000, budget_paise=900000,
                sector='Electrical', city='Balasore', opens_at=now - 100,
                deadline=now + 1000, manpower_needed=2,
                terms='Confidential commercial requirements and joining conditions')
    body.update(changes)
    response = api.post('/operations/contractor/tenders', headers=auth('shop'), json=body)
    assert response.status_code == 200, response.text
    return response.json()


def test_public_discovery_empty_actual_and_private_boundaries(api):
    empty = api.get('/operations/contractor/published').json()
    assert empty['tenders'] == [] and empty['total'] is None and empty['next_cursor'] is None and empty['has_more'] is False
    tender = publish(api)
    response = api.get('/operations/contractor/published')
    assert response.status_code == 200
    result = response.json()
    assert result['total'] is None and result['tenders'][0]['id'] == tender['id']
    assert result['tenders'][0]['phase'] == 'bidding'
    assert set(result['tenders'][0]) == {
        'id', 'title', 'sector', 'city', 'budget_paise', 'manpower_needed',
        'opens_at', 'deadline', 'starts_at', 'ends_at', 'status', 'phase'}
    for private in ('Confidential', 'Private customer', 'owner_id', 'bids', 'registrations', 'request_hash'):
        assert private not in response.text
    assert api.get('/operations/contractor/opportunities').status_code == 401
    assert api.get('/operations/contractor/opportunities', headers=auth('shop')).status_code == 403
    owner = api.get('/operations/contractor/workspace', headers=auth('shop')).json()
    assert owner['tenders'][0]['scope'] == tender['scope']


def test_public_keyset_filters_pagination_closed_and_expired_records(api, monkeypatch):
    now = time.time()
    first = publish(api, title='Campus electrical inspection', deadline=now + 1000)
    second = publish(api, title='Hotel plumbing maintenance', sector='Plumbing', opens_at=now + 100, deadline=now + 2000)
    third = publish(api, title='Workshop electrical checks', deadline=now + 3000)
    expected = sorted([first['id'],second['id'],third['id']])
    cursor='';collected=[]
    for page_number in range(3):
        page=api.get('/operations/contractor/published',params={'limit':1,'cursor':cursor}).json()
        assert page['total'] is None
        collected += [row['id'] for row in page['tenders']]
        if page_number<2:
            assert page['has_more'] and page['next_cursor'] not in expected
        else:
            assert not page['has_more'] and page['next_cursor'] is None
        cursor=page['next_cursor'] or ''
    assert collected==expected
    electrical=api.get('/operations/contractor/published?sector=electrical&query=campus').json()
    assert [row['id'] for row in electrical['tenders']]==[first['id']]
    upcoming=api.get('/operations/contractor/published?phase=upcoming').json()
    assert [row['id'] for row in upcoming['tenders']]==[second['id']]
    assert api.get('/operations/contractor/published?limit=65').status_code==422
    assert api.get('/operations/contractor/published?cursor=missing').status_code==422
    closed=api.post('/operations/contractor/tenders/'+first['id']+'/commands',headers=auth('shop'),json={'expected_version':first['version'],'action':'close'})
    assert closed.status_code==200
    assert len(api.get('/operations/contractor/published').json()['tenders'])==2
    monkeypatch.setattr(time,'time',lambda:now+2500)
    deciding=api.get('/operations/contractor/published?phase=decision').json()
    assert [row['id'] for row in deciding['tenders']]==[second['id']]
    main.operations_store.run(lambda u:u.put('contract_tenders',third['id'],{**third,'status':'awarded'}))
    assert len(api.get('/operations/contractor/published').json()['tenders'])==1
    monkeypatch.setattr(time,'time',lambda:now+11000)
    assert api.get('/operations/contractor/published').json()['tenders']==[]


def test_cursor_is_bound_to_filters_and_survives_source_closure(api):
    tenders=[publish(api,title=f'Test electrical project {index}') for index in range(3)]
    page=api.get('/operations/contractor/published?limit=1&sector=Electrical').json()
    cursor=page['next_cursor'];boundary=page['tenders'][0]['id']
    for change in [{'sector':'Plumbing'},{'query':'Test'},{'phase':'decision'}]:
        response=api.get('/operations/contractor/published',params={'cursor':cursor,'sector':'Electrical',**change})
        assert response.status_code==422
    main.operations_store.run(lambda u:u.put('contract_tenders',boundary,{**u.get('contract_tenders',boundary),'status':'closed'}))
    continuation=api.get('/operations/contractor/published',params={'cursor':cursor,'sector':' electrical ','limit':3})
    assert continuation.status_code==200,continuation.text
    assert [row['id'] for row in continuation.json()['tenders']]==sorted(t['id'] for t in tenders if t['id']>boundary)
    token=json.loads(base64.urlsafe_b64decode(cursor+'='*(-len(cursor)%4)))
    token['k']='nested/invalid/key'
    forged=base64.urlsafe_b64encode(json.dumps(token).encode()).decode().rstrip('=')
    assert api.get('/operations/contractor/published',params={'cursor':forged,'sector':'Electrical'}).status_code==422


def test_sqlite_bounded_filtered_progress_projects_before_application_reads(api,monkeypatch):
    actual=publish(api)
    def seed(u):
        source=u.get('contract_tenders',actual['id'])
        for number in range(140):
            row={**source,'id':f'public-{number:03d}','title':f'Open source project {number:03d}'}
            if number==139:row['title']='Rare matching source'
            u.put('contract_tenders',row['id'],row)
        for number in range(100):
            u.put('contract_tenders',f'closed-{number:03d}',{**source,'id':f'closed-{number:03d}','status':'closed'})
    main.operations_store.run(seed)
    statements=[]
    original=contract_work.published_keyset
    windows=[]
    def instrument(u,*args,**kwargs):
        u.conn.set_trace_callback(statements.append)
        rows=original(u,*args,**kwargs)
        windows.append(len(rows))
        return rows
    monkeypatch.setattr(contract_work,'published_keyset',instrument)
    monkeypatch.setattr(Unit,'all',lambda *a: (_ for _ in ()).throw(AssertionError('full collection read')))
    monkeypatch.setattr(Unit,'get',lambda *a: (_ for _ in ()).throw(AssertionError('private document read')))
    found=[];cursor='';pages=0
    while True:
        response=api.get('/operations/contractor/published',params={'query':'Rare matching','cursor':cursor})
        assert response.status_code==200,response.text
        data=response.json();found+=data['tenders'];pages+=1
        assert data['total'] is None
        assert data['has_more']==bool(data['next_cursor'])
        if pages==1:assert data['tenders']==[] and data['has_more']
        cursor=data['next_cursor']
        if not cursor:break
        assert pages<5
    assert pages==3 and [row['id'] for row in found]==['public-139']
    assert max(windows)<=64
    queries=[sql for sql in statements if 'SELECT id,' in sql]
    assert queries and all('LIMIT 64' in sql and "'$.status')='open'" in sql for sql in queries)
    assert all('SELECT body' not in sql and "'$.scope'" not in sql and "'$.site'" not in sql and "'$.terms'" not in sql and "'$.bids'" not in sql for sql in queries)
    detail=api.get('/operations/contractor/published/'+actual['id'])
    assert detail.status_code==200 and 'Confidential' not in detail.text


def test_summary_endpoint_is_live_projected_and_unavailable_when_withdrawn(api,monkeypatch):
    tender=publish(api)
    with monkeypatch.context() as isolated:
        isolated.setattr(Unit,'get',lambda *a: (_ for _ in ()).throw(AssertionError('private get')))
        response=api.get('/operations/contractor/published/'+tender['id'])
        assert response.status_code==200 and response.json()['tender']['id']==tender['id']
        assert 'scope' not in response.text and 'owner_id' not in response.text and 'terms' not in response.text
        assert api.get('/operations/contractor/published/unknown').status_code==404
    main.operations_store.run(lambda u:u.put('contract_tenders',tender['id'],{**u.get('contract_tenders',tender['id']),'status':'closed'}))
    assert api.get('/operations/contractor/published/'+tender['id']).status_code==404


def test_firestore_open_keyset_projection_bound_and_cursor_use_real_sdk(monkeypatch):
    from google.auth.credentials import AnonymousCredentials
    from google.cloud.firestore_v1 import Client, Query
    client=Client(project='contract-public-test-only',credentials=AnonymousCredentials())
    captured=[]
    def stream(query,transaction=None):
        captured.append(query._to_protobuf())
        return iter([])
    monkeypatch.setattr(Query,'stream',stream)
    core=SimpleNamespace(fs_collection=lambda name:client.collection(name),fs_doc=lambda name,key:client.collection(name).document(key))
    unit=SimpleNamespace(core=core,tx=object())
    assert contract_work.published_keyset(unit,'tender-boundary',limit=1000)==[]
    query=captured[0]
    assert query.limit==64 and query.order_by[0].field.field_path=='__name__'
    assert query.where.field_filter.field.field_path=='status' and query.where.field_filter.value.string_value=='open'
    assert query.start_at.values[0].reference_value.endswith('/ops_contract_tenders/tender-boundary')
    assert set(field.field_path for field in query.select.fields)==set(contract_work.PUBLIC_TENDER_FIELDS)
    assert not {'scope','site','terms','bids','registrations','owner_id'} & {field.field_path for field in query.select.fields}


def test_firestore_single_summary_reads_only_whitelisted_field_paths():
    calls=[]
    source={'id':'actual','title':'Current native record','scope':'PRIVATE','site':'PRIVATE','terms':'PRIVATE','bids':['PRIVATE']}
    class Document:
        def get(self,*,field_paths,transaction):
            calls.append((tuple(field_paths),transaction))
            return SimpleNamespace(exists=True,id='actual',to_dict=lambda:{field:source[field] for field in field_paths if field in source})
    unit=SimpleNamespace(tx=object(),core=SimpleNamespace(fs_doc=lambda kind,key:Document()))
    summary=contract_work.published_record(unit,'actual')
    assert summary=={'id':'actual','title':'Current native record'}
    assert calls==[(contract_work.PUBLIC_TENDER_FIELDS,unit.tx)]
    assert contract_work.published_record(unit,'invalid/path') is None
    assert len(calls)==1


def test_sqlite_open_window_uses_status_key_index_without_global_sort(api):
    publish(api)
    contract_work.initialize(main)
    with main.db() as conn:
        plan=conn.execute("EXPLAIN QUERY PLAN SELECT id,json_extract(body,'$.title') AS title FROM operation_records WHERE kind='contract_tenders' AND id>? AND json_extract(body,'$.status')=? ORDER BY id LIMIT ?",('','open',64)).fetchall()
    assert any('idx_contract_tenders_public_status_key' in row['detail'] for row in plan)
    assert not any('TEMP B-TREE' in row['detail'] for row in plan)
