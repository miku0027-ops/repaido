import time
import uuid
import main
from test_operations import api,auth,ADMIN

def create(api):
    pid=str(uuid.uuid4());lid=str(uuid.uuid4())
    main.operations_store.run(lambda u:u.put('home_photos',pid,{'id':pid,'owner_id':'worker','object':'test-only'}))
    body=dict(expected_version=0,title='Sunny two bedroom home',city='Balasore',locality='Station Road',property_type='apartment',bedrooms=2,furnishing='unfurnished',rent_paise=1200000,deposit_paise=2400000,description='Two bedrooms with parking and a balcony. Maintenance extra.',available_from='2026-11-01',photo_id=pid,authority_confirmed=True)
    response=api.put('/operations/homes/listings/'+lid,headers=auth('worker'),json=body)
    assert response.status_code==200,response.text
    return response.json(),body

def approve(api,row):
    response=api.post('/operations/admin/homes/'+row['id']+'/review',headers=ADMIN,json={'expected_version':row['version'],'decision':'published','reason':'Photo and locality reviewed by staff.'})
    assert response.status_code==200,response.text
    return response.json()

def test_review_privacy_owner_lifecycle(api):
    row,body=create(api)
    assert api.get('/operations/homes/catalog').json()['items']==[]
    assert api.get('/operations/admin/homes').status_code in (401,403)
    row=approve(api,row)
    public=api.get('/operations/homes/catalog?city=BALASORE&bedrooms=2&max_rent=1200000').json()['items']
    assert len(public)==1 and 'owner_id' not in public[0]
    assert api.get('/operations/homes/catalog?max_rent=1000').json()['items']==[]
    assert api.post('/operations/homes/listings/'+row['id']+'/state',headers=auth('stranger'),json={'expected_version':row['version'],'state':'let'}).status_code==404
    assert api.post('/operations/homes/listings/'+row['id']+'/state',headers=auth('worker'),json={'expected_version':row['version'],'state':'let'}).status_code==200
    assert api.get('/operations/homes/catalog').json()['items']==[]
    assert api.post('/operations/homes/listings/'+row['id']+'/state',headers=auth('worker'),json={'expected_version':row['version'],'state':'paused'}).status_code==409

def test_photo_ownership_edit_returns_to_review(api):
    row,body=create(api);row=approve(api,row);body['expected_version']=row['version']
    assert api.put('/operations/homes/listings/'+str(uuid.uuid4()),headers=auth('worker2'),json={**body,'expected_version':0}).status_code==422
    response=api.put('/operations/homes/listings/'+row['id'],headers=auth('worker'),json=body)
    assert response.status_code==200,response.text
    assert response.json()['status']=='pending_review'
    assert api.get('/operations/homes/catalog').json()['items']==[]

def test_enquiry_authorization_retries_viewing(api):
    row,_=create(api);row=approve(api,row);path='/operations/homes/listings/'+row['id']+'/enquiry'
    body={'message':'Can I visit tomorrow afternoon?','viewing_at':time.time()+86400}
    response=api.post(path,headers=auth('worker2'),json=body)
    assert response.status_code==200,response.text
    enquiry=response.json();assert 'owner_id' not in enquiry and 'customer_id' not in enquiry
    assert api.post(path,headers=auth('worker2'),json=body).json()['id']==enquiry['id']
    assert api.get('/operations/homes/enquiries',headers=auth('stranger')).json()['items']==[]
    reply='/operations/homes/enquiries/'+enquiry['id']+'/reply';payload={'expected_version':1,'action':'confirm_viewing','message':'Yes, this time works.','request_id':str(uuid.uuid4())}
    assert api.post(reply,headers=auth('worker2'),json=payload).status_code==403
    assert api.post(reply,headers=auth('stranger'),json=payload).status_code==404
    assert api.post(reply,headers=auth('worker'),json=payload).status_code==200
    assert api.post(reply,headers=auth('worker'),json=payload).status_code==200
    data=api.get('/operations/homes/enquiries',headers=auth('worker2')).json()['items'][0]
    assert data['state']=='confirmed' and len(data['messages'])==2
    assert api.post(reply,headers=auth('worker'),json={**payload,'message':'Changed payload'}).status_code==409
    assert api.post(reply,headers=auth('worker'),json={**payload,'expected_version':2,'action':'complete','request_id':str(uuid.uuid4())}).status_code==409
    assert api.post(reply,headers=auth('worker2'),json={**payload,'expected_version':2,'action':'cancel','request_id':str(uuid.uuid4())}).status_code==200

def test_unavailable_and_invalid_viewing_time(api):
    row,_=create(api);row=approve(api,row);path='/operations/homes/listings/'+row['id']+'/enquiry'
    assert api.post(path,headers=auth('worker2'),json={'message':'Please arrange a viewing','viewing_at':time.time()-10}).status_code==422
    api.post('/operations/homes/listings/'+row['id']+'/state',headers=auth('worker'),json={'expected_version':row['version'],'state':'paused'})
    assert api.post(path,headers=auth('worker2'),json={'message':'Please arrange a viewing','viewing_at':time.time()+1000}).status_code==404


def test_public_details_hide_unpublished_and_owner_data(api):
    row,_=create(api);path='/operations/homes/listings/'+row['id']
    assert api.get(path).status_code==404
    row=approve(api,row)
    response=api.get(path)
    assert response.status_code==200
    assert 'no-store' in response.headers['cache-control']
    assert 'owner_id' not in response.json() and 'authority_confirmed' not in response.json()
    assert api.post(path+'/state',headers=auth('worker'),json={'expected_version':row['version'],'state':'paused'}).status_code==200
    assert api.get(path).status_code==404


def test_listing_and_state_retry_do_not_repeat_mutations(api):
    row,body=create(api);path='/operations/homes/listings/'+row['id']
    assert api.put(path,headers=auth('worker'),json=body).json()['version']==1
    row=approve(api,row)
    payload={'expected_version':row['version'],'state':'paused'}
    first=api.post(path+'/state',headers=auth('worker'),json=payload)
    again=api.post(path+'/state',headers=auth('worker'),json=payload)
    assert first.status_code==again.status_code==200
    assert first.json()==again.json()
    assert api.post('/operations/admin/homes/'+row['id']+'/review',headers=ADMIN,json={'expected_version':first.json()['version'],'decision':'published','reason':'Trying to bypass owner submission.'}).status_code==409
    assert api.get('/operations/homes/catalog').json()['items']==[]


def test_enquiry_retries_and_new_request_after_closure(api):
    row,_=create(api);row=approve(api,row);path='/operations/homes/listings/'+row['id']+'/enquiry'
    body={'message':'Can I visit tomorrow afternoon?','viewing_at':time.time()+86400,'request_id':str(uuid.uuid4())}
    first=api.post(path,headers=auth('worker2'),json=body)
    assert first.status_code==200,first.text
    enquiry=first.json();reply='/operations/homes/enquiries/'+enquiry['id']+'/reply'
    assert api.post(path,headers=auth('worker2'),json=body).json()==enquiry
    assert api.post(path,headers=auth('worker2'),json={**body,'message':'A different message under the same ID.'}).status_code==409
    assert api.post(path,headers=auth('worker2'),json={**body,'request_id':str(uuid.uuid4())}).status_code==409
    assert api.post(reply,headers=auth('worker2'),json={'expected_version':1,'action':'cancel','message':'Need to rearrange.','request_id':str(uuid.uuid4())}).status_code==200
    assert api.post(path,headers=auth('worker2'),json=body).json()['state']=='cancelled'
    followup={**body,'request_id':str(uuid.uuid4()),'viewing_at':time.time()+172800,'message':'May I visit the following day instead?'}
    reopened=api.post(path,headers=auth('worker2'),json=followup)
    assert reopened.status_code==200,reopened.text
    assert reopened.json()['id']==enquiry['id'] and reopened.json()['state']=='requested'
    assert reopened.json()['viewing_at']==followup['viewing_at'] and reopened.json()['version']==3
    assert len(reopened.json()['messages'])==3
    assert api.post(path,headers=auth('worker2'),json=followup).json()==reopened.json()
    assert api.get('/operations/homes/enquiries',headers=auth('worker')).json()['items'][0]['is_owner'] is True


def test_simultaneous_enquiry_submission_is_one_thread(api):
    from concurrent.futures import ThreadPoolExecutor
    row,_=create(api);row=approve(api,row);path='/operations/homes/listings/'+row['id']+'/enquiry'
    body={'message':'Can I visit this home tomorrow?','viewing_at':time.time()+86400,'request_id':str(uuid.uuid4())}
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses=list(pool.map(lambda _:api.post(path,headers=auth('worker2'),json=body),range(2)))
    assert [r.status_code for r in responses]==[200,200]
    assert responses[0].json()==responses[1].json()
    assert len(responses[0].json()['messages'])==1


def test_photo_upload_retry_budget_and_private_moderation(api,monkeypatch):
    import io
    from PIL import Image
    import housing
    storage={};uploads=[]
    def upload(key,data):
        uploads.append(key);storage[key]=data
        raise TimeoutError('storage accepted bytes, response lost')
    def download(key):return storage[key]
    monkeypatch.setenv('REPAIDO_KYC_BUCKET','test-only')
    monkeypatch.setattr(housing,'upload_object',upload)
    monkeypatch.setattr(housing,'download_object',download)
    def photo(color):
        out=io.BytesIO();Image.new('RGB',(8,8),color).save(out,format='PNG');return out.getvalue()
    headers={**auth('worker'),'Content-Type':'image/png','X-Upload-ID':str(uuid.uuid4())}
    first=api.post('/operations/homes/photos',headers=headers,content=photo('red'))
    assert first.status_code==200,first.text
    pid=first.json()['id']
    assert api.post('/operations/homes/photos',headers=headers,content=photo('red')).json()==first.json()
    assert len(uploads)==1
    assert main.operations_store.run(lambda u:u.all('home_photo_budget'))[0]['count']==1
    assert api.post('/operations/homes/photos',headers=headers,content=photo('blue')).status_code==409
    assert api.get('/operations/homes/photos/'+pid).status_code==404
    assert api.get('/operations/admin/homes/photos/'+pid,headers=auth('worker')).status_code==403
    review=api.get('/operations/admin/homes/photos/'+pid,headers=ADMIN)
    assert review.status_code==200 and review.headers['content-type']=='image/jpeg'
    assert review.headers['cache-control']=='no-store'
    assert review.headers['x-content-type-options']=='nosniff'
    row,body=create(api)
    body['photo_id']=pid;body['expected_version']=row['version']
    saved=api.put('/operations/homes/listings/'+row['id'],headers=auth('worker'),json=body)
    row=approve(api,saved.json())
    assert api.get('/operations/homes/photos/'+pid).status_code==200
    assert api.post('/operations/homes/listings/'+row['id']+'/state',headers=auth('worker'),json={'expected_version':row['version'],'state':'let'}).status_code==200
    assert api.get('/operations/homes/photos/'+pid).status_code==404


def test_invalid_listing_and_whitespace_messages(api):
    row,body=create(api)
    for changes in ({'title':'    x    '},{'available_from':'2026-02-30'}):
        response=api.put('/operations/homes/listings/'+row['id'],headers=auth('worker'),json={**body,'expected_version':1,**changes})
        assert response.status_code==422,response.text
    row=approve(api,row)
    assert api.post('/operations/homes/listings/'+row['id']+'/enquiry',headers=auth('worker2'),json={'message':'      ','viewing_at':time.time()+1000}).status_code==422
    notifications=main.operations_store.run(lambda u:u.find('notifications','user_id','worker',limit=100))
    assert notifications[-1]['destination']=='homes' and notifications[-1]['homes_tab']=='mine'
