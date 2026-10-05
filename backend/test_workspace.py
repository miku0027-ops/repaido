import io,time
from PIL import Image
import main,workspace
from test_operations import api,auth,ADMIN,onboard,PIN
from test_procurement import setup_shop,STOCK

def photo():
 b=io.BytesIO();im=Image.new('RGB',(100,100),'blue');ex=Image.Exif();ex[0x9286]=b'private metadata';im.save(b,format='JPEG',exif=ex);return b.getvalue()

def storage(monkeypatch):
 monkeypatch.setenv('REPAIDO_KYC_BUCKET','test-private');items={};monkeypatch.setattr(workspace,'upload_object',lambda k,d:items.setdefault(k,d));monkeypatch.setattr(workspace,'download_object',lambda k:items[k]);return items

def test_photo_publication_ownership_and_metadata(api,monkeypatch):
 blobs=storage(monkeypatch);p=setup_shop(api)
 path='/operations/shop/photos';headers={**auth('shop'),'Content-Type':'image/jpeg'}
 assert api.post(path,headers={**auth('customer'),'Content-Type':'image/jpeg'},content=photo()).status_code==403
 assert api.post(path,headers=headers,content=b'not jpeg').status_code==422
 r=api.post(path,headers=headers,content=photo());assert r.status_code==200,r.text
 url=r.json()['image_url'];public=url.removeprefix('/api')
 assert api.get(public).status_code==404
 r=api.put('/operations/shop/inventory/cap35',headers=auth('shop'),json={**STOCK,'expected_version':p['version'],'image_url':url});assert r.status_code==200,r.text
 assert api.get(public).status_code==200
 with Image.open(io.BytesIO(api.get(public).content)) as im:assert not im.getexif()
 assert 'verification/' not in url
 bad=api.put('/operations/shop/inventory/cap35',headers=auth('shop'),json={**STOCK,'expected_version':r.json()['version'],'image_url':'/api/operations/media/not-owned'});assert bad.status_code==422

def test_selfie_consent_privacy_and_retry(api,monkeypatch):
 blobs=storage(monkeypatch);onboard(api,approve=False)
 s=api.post('/operations/worker/selfie-session',headers=auth('worker'));assert s.status_code==200
 url='/operations/worker/selfies/'+s.json()['id'];headers={**auth('worker'),'Content-Type':'image/jpeg','X-Verification-Consent':'private-review-v1'}
 assert api.post(url,headers={**auth('worker'),'Content-Type':'image/jpeg'},content=photo()).status_code==422
 assert api.post(url,headers={**headers,**auth('stranger')},content=photo()).status_code==404
 assert api.post(url,headers=headers,content=photo()).status_code==200
 assert api.post(url,headers=headers,content=photo()).status_code==200
 assert len(blobs)==1
 overview=api.get('/operations/admin/onboarding-overview',headers=ADMIN).json()['workers'][0]
 assert 'selfie' in overview['document_kinds'] and not overview['ready']
 assert api.get('/operations/admin/onboarding-overview',headers=auth('customer')).status_code==403

def test_local_rankings_real_reviews_no_contacts(api):
 onboard(api)
 body={'location':PIN}
 result=api.post('/operations/discovery/leaderboard',json=body);assert result.status_code==200,result.text
 data=result.json();a=data['agents'][0];assert a['rating'] is None and a['review_count']==0
 assert not {'phone','email','location','home_address'} & set(a)
 assert a['zone']=='0:0' and not data['services']
 assert api.post('/operations/discovery/leaderboard',json={'location':{'lat':0,'lng':0}}).json()['agents']==[]
 def old(u):
  w=u.get('workers','worker');w['position']['received_at']=time.time()-1000;u.put('workers','worker',w)
 main.operations_store.run(old)
 assert api.post('/operations/discovery/leaderboard',json=body).json()['agents']==[]

def test_product_catalog_only_confirmed_stock(api):
 p=setup_shop(api)
 data=api.get('/operations/products/catalog').json();assert data['items'][0]['id']==p['id']
 assert 'phone' not in data['shops'][0] and 'owner_id' not in data['shops'][0]
 def stale(u):
  row=u.get('inventory',p['id']);row['stock_confirmed_at']=0;u.put('inventory',p['id'],row)
 main.operations_store.run(stale)
 assert api.get('/operations/products/catalog').json()['items']==[]

def test_support_team_claim_version_and_isolation(api):
 main.operations_store.run(lambda u:u.put('support_cases','case',dict(id='case',state='open',version=1)))
 url='/operations/admin/support/case/claim'
 assert api.post(url,headers=auth('customer'),json={'expected_version':1}).status_code==403
 r=api.post(url,headers=ADMIN,json={'expected_version':1});assert r.status_code==200
 assert r.json()['assigned_to']=='server-operator'
 assert api.post(url,headers=ADMIN,json={'expected_version':1}).status_code==409
 assert api.post(url,headers=ADMIN,json={'expected_version':2,'release':True}).json()['assigned_to'] is None
 assert api.get('/operations/admin/audit-history',headers=auth('customer')).status_code==403
 assert api.get('/operations/admin/audit-history',headers=ADMIN).json()['entries']

def test_joining_manual_review_without_bank_reference(api):
 onboard(api,approve=False)
 body={'decision':'approved','reason':'All identity evidence checked','identity_reviewed':True,'document_ids':['identity','pan','address','tools']}
 path='/operations/admin/workers/worker/review'
 assert api.post(path,headers=auth('customer'),json=body).status_code==403
 assert api.post(path,headers=ADMIN,json=body).status_code==409
 def seed(u):
  for kind in body['document_ids']:u.put('documents',kind,dict(id=kind,worker_id='worker',kind=kind,status='pending_review',expires_at=time.time()+1000,created_at=time.time()))
 main.operations_store.run(seed)
 assert api.post(path,headers=ADMIN,json={**body,'document_ids':['pan']}).status_code==409
 assert api.post(path,headers=ADMIN,json={**body,'identity_reviewed':False}).status_code==409
 r=api.post(path,headers=ADMIN,json=body);assert r.status_code==200,r.text
 v=main.operations_store.run(lambda u:u.get('verification','worker'))
 assert v['identity_status']=='approved' and v['bank_status']=='not_verified'
 assert api.get('/operations/admin/onboarding-overview',headers=ADMIN).json()['workers'][0]['ready']
 assert api.post(path,headers=ADMIN,json={'decision':'rejected','reason':'Evidence needs correction'}).status_code==200

def test_onboarding_resume_checklist_submit_and_rereview(api):
 onboard(api,approve=False)
 path='/operations/worker/verification'
 r=api.get(path,headers=auth('worker')).json()
 assert r['onboarding']['missing_documents']==['identity','pan','address','tools']
 assert r['onboarding']['state']=='missing_documents'
 assert api.post(path+'/submit',headers=auth('worker')).status_code==422
 assert api.post(path+'/submit',headers=auth('stranger')).status_code==403
 def documents(u):
  for kind in ['identity','pan','address','tools']:
   u.put('documents',kind,dict(id=kind,kind=kind,worker_id='worker',created_at=time.time(),expires_at=time.time()+3600,status='pending_review',object='private-key',sha256='private-hash'))
  u.put('documents','expired',dict(id='expired',kind='selfie',worker_id='worker',created_at=0,expires_at=1,status='pending_review'))
 main.operations_store.run(documents)
 r=api.get(path,headers=auth('worker')).json()
 assert r['onboarding']['state']=='ready_to_submit' and not r['onboarding']['has_selfie']
 assert all('object' not in d and 'sha256' not in d for d in r['documents'])
 first=api.post(path+'/submit',headers=auth('worker'));assert first.status_code==200,first.text
 second=api.post(path+'/submit',headers=auth('worker'));assert first.json()==second.json()
 assert api.get(path,headers=auth('worker')).json()['onboarding']['state']=='in_review'
 review='/operations/admin/workers/worker/review'
 assert api.post(review,headers=ADMIN,json={'decision':'rejected','reason':'Please provide clearer identity evidence'}).status_code==200
 status=api.get(path,headers=auth('worker')).json()['onboarding']
 assert status['state']=='needs_changes' and 'clearer' in status['review_reason']
 assert api.post(path+'/submit',headers=auth('worker')).status_code==200
 assert api.get('/operations/worker/me',headers=auth('worker')).json()['worker']['status']=='pending_verification'
 assert api.post(review,headers=ADMIN,json={'decision':'approved','reason':'Evidence and manual identity match checked','identity_reviewed':True,'document_ids':['identity','pan','address','tools']}).status_code==200
 assert api.get(path,headers=auth('worker')).json()['onboarding']['state']=='approved'
 assert main.operations_store.run(lambda u:u.get('verification','worker'))['bank_status']=='not_verified'

def test_pending_profile_edit_invalidates_old_identity_review(api):
 onboard(api,approve=False)
 main.operations_store.run(lambda u:u.put('verification','worker',dict(identity_status='approved',bank_status='verified',submitted_at=1)))
 saved=api.get('/operations/worker/me',headers=auth('worker')).json()['worker']
 body={k:saved[k] for k in ('name','dob','city','home_address','location','requested_role','categories','skills','tools','experience_years','radius_km','terms_version','partner_policy_version','partner_policy_sections')}
 body['name']='Updated worker name'
 r=api.post('/operations/worker/onboarding',headers=auth('worker'),json=body);assert r.status_code==200,r.text
 v=main.operations_store.run(lambda u:u.get('verification','worker'))
 assert v['identity_status']=='pending_review' and not v['submitted_at']
 assert api.post('/operations/admin/workers/worker/review',headers=ADMIN,json={'decision':'approved','reason':'Must not bypass fresh identity review'}).status_code==409

def test_onboarding_notification_is_private_and_not_duplicated(api):
 onboard(api,approve=False)
 path='/operations/notifications'
 rows=api.get(path,headers=auth('worker')).json()['notifications']
 assert len(rows)==1 and rows[0]['destination']=='onboarding' and 'identity' in rows[0]['body']
 assert api.get(path,headers=auth('worker')).json()['notifications']==rows
 assert api.get(path,headers=auth('stranger')).json()['notifications']==[]
 assert api.post('/operations/notifications/'+rows[0]['id']+'/read',headers=auth('worker')).status_code==200
 assert api.get(path,headers=auth('worker')).json()['notifications'][0]['read_at']>0
