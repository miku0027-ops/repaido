"""Camera, GPS, quote and storage failures through the real isolated HTTP API."""
import io,json,time,uuid,hashlib
from unittest.mock import patch
import pytest
from PIL import Image
import main,local_business,scrap_experience
from test_operations import api,auth,PIN
from test_local_business import register,act,doc,BASE

@pytest.fixture
def media(monkeypatch):
    monkeypatch.setenv('REPAIDO_KYC_BUCKET','fixture-private')
    objects={}
    def upload(key,data):
        if key in objects:raise RuntimeError('Fixture generation conflict')
        objects[key]=data
    def download(key):return objects[key]
    for module in [scrap_experience,local_business]:
        monkeypatch.setattr(module,'upload_object',upload);monkeypatch.setattr(module,'download_object',download)
    return objects

def jpeg(embedded=None):
    output=io.BytesIO();image=Image.new('RGB',(640,480),'#598b64');exif=Image.Exif()
    if embedded is not None:exif[0x9286]=json.dumps(embedded).encode()
    image.save(output,format='JPEG',exif=exif);return output.getvalue()

def capture(api,request_id,uid='customer'):
    response=api.post(BASE+'/scrap/capture-sessions',headers=auth(uid),json={'request_id':request_id,'location':PIN})
    assert response.status_code==201,response.text;return response.json()

def upload(api,session,uid='customer',**changes):
    metadata={**PIN,'accuracy':5,'captured_at':time.time(),'source':'repaido_web_camera_v1'};metadata.update(changes)
    image=jpeg({**metadata,'capture_id':session['id'],'request_id':session['request_id']})
    headers={**auth(uid),'Content-Type':'image/jpeg','X-Capture-Metadata':json.dumps(metadata),'Origin':'https://repaido.com'}
    return api.post(BASE+'/scrap/capture-sessions/'+session['id']+'/photo',headers=headers,content=image),image,headers

def collection(api):
    register(api,role='scrap_owner');key=str(uuid.uuid4());session=capture(api,key);uploaded,_,_=upload(api,session);assert uploaded.status_code==200,uploaded.text
    body={'material':'metal','description':'Dry household metal scrap ready for collection','estimated_kg':10,'location':PIN,'address':'Private collection entrance 123','city':'Balasore','starts_at':time.time()+7200,'phone':'9876543210','request_id':key,'photo_document_id':uploaded.json()['id']}
    response=api.post(BASE+'/scrap',headers=auth('customer'),json=body);assert response.status_code==201,response.text
    return response.json(),body

def test_camera_is_required_and_gallery_cannot_create_a_receipt(api,media):
    register(api,role='scrap_owner');key=str(uuid.uuid4());session=capture(api,key)
    response=api.post(BASE+'/scrap/capture-sessions/'+session['id']+'/photo',headers={**auth('customer'),'Content-Type':'image/jpeg','X-Capture-Metadata':json.dumps({**PIN,'accuracy':5,'captured_at':time.time(),'source':'repaido_web_camera_v1'})},content=jpeg())
    assert response.status_code==422 and response.json()['detail']['code']=='INVALID_CAMERA_PHOTO'
    body={'material':'metal','description':'Household metal scrap for pickup','estimated_kg':10,'location':PIN,'address':'Private collection entrance 123','city':'Balasore','starts_at':time.time()+7200,'phone':'9876543210','request_id':key}
    assert api.post(BASE+'/scrap',headers=auth('customer'),json=body).status_code==422
    body['photo_document_id']=doc('customer')
    assert api.post(BASE+'/scrap',headers=auth('customer'),json=body).json()['detail']['code']=='CAMERA_PHOTO_REQUIRED'

def test_malformed_embedded_camera_metadata_is_a_readable_validation_error(api,media):
    session=capture(api,str(uuid.uuid4()))
    headers={**auth('customer'),'Content-Type':'image/jpeg','Origin':'https://repaido.com','X-Capture-Metadata':json.dumps({**PIN,'accuracy':5,'captured_at':time.time(),'source':'repaido_web_camera_v1'})}
    response=api.post(BASE+'/scrap/capture-sessions/'+session['id']+'/photo',headers=headers,content=jpeg([]))
    assert response.status_code==422 and response.json()['detail']['code']=='INVALID_CAMERA_PHOTO'
    assert response.headers['Access-Control-Allow-Origin']=='https://repaido.com' and not media

@pytest.mark.parametrize('camera',[False,True])
def test_slow_photo_storage_does_not_block_the_api_event_loop(api,media,monkeypatch,camera):
    import asyncio,threading,httpx
    started,release=threading.Event(),threading.Event()
    module=scrap_experience if camera else local_business
    original=module.upload_object
    def slow(key,data):
        started.set();release.wait(timeout=3);original(key,data)
    monkeypatch.setattr(module,'upload_object',slow)
    headers={**auth('customer'),'Content-Type':'image/jpeg'};path=BASE+'/documents';image=jpeg()
    if camera:
        session=capture(api,str(uuid.uuid4()));path=BASE+'/scrap/capture-sessions/'+session['id']+'/photo'
        metadata={**PIN,'accuracy':5,'captured_at':time.time(),'source':'repaido_web_camera_v1'}
        headers['X-Capture-Metadata']=json.dumps(metadata);image=jpeg({**metadata,'capture_id':session['id'],'request_id':session['request_id']})
    async def exercise():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app),base_url='http://fixture') as client:
            began=time.monotonic();uploading=asyncio.create_task(client.post(path,headers=headers,content=image))
            try:
                assert await asyncio.to_thread(started.wait,2)
                assert time.monotonic()-began<2,'Storage blocked the API event loop.'
                assert (await asyncio.wait_for(client.get('/health'),timeout=1)).status_code==200
                assert not uploading.done(),'The storage fixture must still be waiting during the health check.'
            finally:release.set()
            assert (await uploading).status_code in (200,201)
    asyncio.run(exercise())

def test_server_stamp_binding_duplicate_request_and_private_photo(api,media):
    row,body=collection(api)
    assert row['has_pickup_photo'] and row['experience_version']==2
    assert api.post(BASE+'/scrap',headers=auth('customer'),json=body).json()['id']==row['id']
    photo=api.get(BASE+'/scrap/'+row['id']+'/pickup-photo',headers=auth('customer'))
    assert photo.status_code==200 and photo.headers['Cache-Control']=='private, no-store'
    with Image.open(io.BytesIO(photo.content)) as image:assert image.height>480 and not image.getexif()
    proof=main.operations_store.run(lambda u:u.get('business_documents',body['photo_document_id']))
    assert proof['claimed_by']==row['id'] and proof['sha256']==hashlib.sha256(photo.content).hexdigest()
    candidate=api.get(BASE+'/scrap',headers=auth('worker')).json()['collections'][0]
    assert 'photo_document_id' not in candidate and 'camera_receipt' not in candidate and 'location' not in candidate
    assert api.get(BASE+'/scrap/'+row['id']+'/pickup-photo',headers=auth('worker')).status_code==404
    accepted=act(api,row,'accept','worker','scrap')
    assert api.get(BASE+'/scrap/'+row['id']+'/pickup-photo',headers=auth('worker')).status_code==200
    assert api.get(BASE+'/scrap/'+row['id']+'/pickup-photo',headers=auth('stranger')).status_code==404
    reused={**body,'request_id':str(uuid.uuid4())}
    assert api.post(BASE+'/scrap',headers=auth('customer'),json=reused).status_code==409

@pytest.mark.parametrize('changes',[{'lat':PIN['lat']+1},{'accuracy':100,'lng':PIN['lng']+.01},{'captured_at':0}])
def test_camera_rejects_remote_or_stale_capture(api,media,changes):
    session=capture(api,str(uuid.uuid4()));response,_,_=upload(api,session,**changes)
    assert response.status_code==422 and not media

def test_photo_ticket_belongs_to_its_authenticated_account_and_expires(api,media):
    session=capture(api,str(uuid.uuid4()));response,_,_=upload(api,session,'stranger');assert response.status_code==404
    with patch('time.time',return_value=session['expires_at']+1):response,_,_=upload(api,session)
    assert response.status_code==422 and response.json()['detail']['code']=='STALE_CAPTURE'

def test_lost_photo_upload_response_reconciles_by_content_and_never_duplicates(api,media,monkeypatch):
    calls=[]
    def lost(key,data):calls.append(key);media[key]=data;raise RuntimeError('Fixture lost acknowledgement')
    monkeypatch.setattr(scrap_experience,'upload_object',lost)
    session=capture(api,str(uuid.uuid4()));response,image,headers=upload(api,session)
    assert response.status_code==200
    repeated=api.post(BASE+'/scrap/capture-sessions/'+session['id']+'/photo',headers=headers,content=image)
    assert repeated.status_code==200 and repeated.json()['id']==response.json()['id'] and len(calls)==1

def test_storage_failure_is_a_cors_readable_error_and_same_photo_can_retry(api,media,monkeypatch):
    original=scrap_experience.upload_object
    monkeypatch.setattr(scrap_experience,'upload_object',lambda *_:(_ for _ in ()).throw(RuntimeError('Fixture unavailable storage')))
    session=capture(api,str(uuid.uuid4()));response,image,headers=upload(api,session)
    assert response.status_code==503 and response.json()['detail']['code']=='UPLOAD_UNAVAILABLE'
    assert response.headers['Access-Control-Allow-Origin']=='https://repaido.com'
    monkeypatch.setattr(scrap_experience,'upload_object',original)
    retried=api.post(BASE+'/scrap/capture-sessions/'+session['id']+'/photo',headers=headers,content=image)
    assert retried.status_code==200 and len(media)==1

def test_scale_upload_failure_preserves_json_cors_and_success_is_content_idempotent(api,media,monkeypatch):
    original=local_business.upload_object;headers={**auth('worker'),'Content-Type':'image/jpeg','Origin':'https://repaido.com'}
    monkeypatch.setattr(local_business,'upload_object',lambda *_:(_ for _ in ()).throw(RuntimeError('Fixture provider access failure')))
    failed=api.post(BASE+'/documents',headers=headers,content=jpeg())
    assert failed.status_code==503 and failed.headers['Access-Control-Allow-Origin']=='https://repaido.com'
    assert failed.json()['detail']['code']=='UPLOAD_UNAVAILABLE'
    monkeypatch.setattr(local_business,'upload_object',original)
    first=api.post(BASE+'/documents',headers=headers,content=jpeg());second=api.post(BASE+'/documents',headers=headers,content=jpeg())
    assert first.status_code==201 and second.status_code==201 and first.json()['id']==second.json()['id'] and len(media)==1

def test_tracking_geofence_quote_receipt_and_completion_clear_location(api,media):
    row,_=collection(api);row=act(api,row,'accept','worker','scrap')
    assert api.get(BASE+'/scrap/'+row['id']+'/tracking',headers=auth('stranger')).status_code==404
    assert api.post(BASE+'/scrap/'+row['id']+'/position/start',headers=auth('customer'),json={**PIN,'accuracy':5,'captured_at':time.time()}).status_code==404
    row=act(api,row,'depart','worker','scrap')
    track=api.get(BASE+'/scrap/'+row['id']+'/tracking',headers=auth('customer')).json();assert track['position'] and track['phase']=='en_route'
    version=row['version'];point={**PIN,'accuracy':5,'captured_at':time.time()}
    assert api.post(BASE+'/scrap/'+row['id']+'/position',headers=auth('worker'),json=point).status_code==200
    assert api.get(BASE+'/scrap/'+row['id'],headers=auth('worker')).json()['version']==version,'GPS telemetry must not invalidate a quote version.'
    act(api,row,'arrive','worker','scrap',status=422,position={**point,'lat':PIN['lat']+1})
    row=act(api,row,'arrive','worker','scrap')
    quote={'expected_version':row['version'],'command_id':str(uuid.uuid4()),'lines':[{'material':'Steel','grade':'Clean dry metal','gross_grams':10500,'tare_grams':500,'price_paise_per_kg':2500}],'note':'Scale zeroed and scrap checked at pickup','scale_reference':'scale-fixture-123','weighing_document_id':doc('worker')}
    response=api.post(BASE+'/scrap/'+row['id']+'/evaluation',headers=auth('worker'),json=quote);assert response.status_code==200,response.text
    row=response.json();assert row['evaluation_command_id']==quote['command_id'] and row['evaluation']['total_paise']==25000
    assert api.post(BASE+'/scrap/'+row['id']+'/evaluation',headers=auth('worker'),json=quote).status_code==200
    assert any(note['title']=='Review your weighed scrap quote' for note in main.operations_store.run(lambda u:u.find('notifications','user_id','customer')))
    row=act(api,row,'agree',kind='scrap');row=act(api,row,'paid','worker','scrap',reference='cash-fixture-123');row=act(api,row,'received',kind='scrap')
    track=api.get(BASE+'/scrap/'+row['id']+'/tracking',headers=auth('customer')).json();assert track['position'] is None and not track['sharing']
    assert api.post(BASE+'/scrap/'+row['id']+'/position/start',headers=auth('worker'),json=point).status_code==409

def test_position_pause_stale_read_and_old_packets_cannot_restore_tracking(api,media):
    row,_=collection(api);row=act(api,row,'accept','worker','scrap');row=act(api,row,'depart','worker','scrap')
    track=api.get(BASE+'/scrap/'+row['id']+'/tracking',headers=auth('customer')).json()
    with patch('time.time',return_value=track['server_time']+76):assert api.get(BASE+'/scrap/'+row['id']+'/tracking',headers=auth('customer')).json()['position'] is None
    assert api.post(BASE+'/scrap/'+row['id']+'/position/stop',headers=auth('worker')).status_code==200
    assert api.post(BASE+'/scrap/'+row['id']+'/position',headers=auth('worker'),json={**PIN,'accuracy':5,'captured_at':time.time()}).status_code==409
    assert api.get(BASE+'/scrap/'+row['id']+'/tracking',headers=auth('customer')).json()['position'] is None
