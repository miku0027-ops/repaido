import time,uuid
import main,marketplace
from test_operations import api,auth,ADMIN,PIN,onboard,book

def draft(api,uid='worker',trial=False,**changes):
 pid='photo-'+uid
 main.operations_store.run(lambda u:u.put('market_photos',pid,dict(id=pid,owner_id=uid,object='private',created_at=time.time())))
 body=dict(request_id=str(uuid.uuid4()),mode='exchange',name='Samsung phone',brand='Samsung',product_type='phone',desired_type='computer',desired_product='Laptop',value_paise=1000000,purchase_paise=2000000,age_months=12,manufacture_year=2025,warranty='No warranty',condition='Used, screen has a small scratch',reason='Need a laptop',photo_id=pid,city='Balasore',location=PIN,radius_km=10,share_contact=True)
 body.update(changes)
 if not trial:
  key=marketplace.trial_key(uid,body['mode'])
  main.operations_store.run(lambda u:u.put('market_trials',key,dict(id=key,listing_id='previous-fixture-listing',claimed_at=time.time())))
 r=api.post('/operations/market/listings',headers=auth(uid),json=body);assert r.status_code==200,r.text
 return r.json(),body

def paid(api,monkeypatch,lid):
 monkeypatch.setenv('REPAIDO_PAYMENTS_ENABLED','true')
 for key in ('RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET'):monkeypatch.setenv(key,'test-only')
 orders={};calls=[]
 def gateway(path,body=None):
  calls.append(path)
  if path=='orders':orders['order_'+lid]=body;return {'id':'order_'+lid}
  if path.endswith('/payments'):return {'items':[dict(id='pay_'+lid,order_id='order_'+lid,status='captured',amount=orders['order_'+lid]['amount'],currency='INR',amount_refunded=0)]}
  raise AssertionError(path)
 monkeypatch.setattr(marketplace,'razorpay',gateway)
 return calls

def test_draft_fees_private_no_provider(api,monkeypatch):
 monkeypatch.setenv('REPAIDO_PAYMENTS_ENABLED','false')
 a,body=draft(api)
 assert a['fee_paise']==100000 and a['status']=='awaiting_fee'
 assert api.post('/operations/market/listings',headers=auth('worker'),json=body).json()['id']==a['id']
 assert api.post('/operations/market/listings',headers=auth('worker'),json={**body,'name':'Changed item'}).status_code==409
 assert api.post('/operations/market/search',json={'location':PIN}).json()['items']==[]
 assert api.post('/operations/market/'+a['id']+'/payment-order',headers=auth('worker')).status_code==503
 assert api.get('/operations/market/'+a['id']+'/contact',headers=auth('worker2')).status_code==404
 b,_=draft(api,'worker2',mode='second_hand');assert b['fee_paise']==50000
 assert api.get('/operations/market/mine',headers=auth('stranger')).json()['listings']==[]
 assert api.post('/operations/market/'+a['id']+'/close',headers=auth('worker2')).status_code==404

def test_verified_payment_matching_privacy_and_close(api,monkeypatch):
 a,_=draft(api);b,_=draft(api,'worker2',name='Laptop',brand='Dell',product_type='computer',desired_type='phone',desired_product='Samsung phone',value_paise=1150000)
 for row,uid in ((a,'worker'),(b,'worker2')):
  calls=paid(api,monkeypatch,row['id']);url='/operations/market/'+row['id']
  assert api.post(url+'/payment-order',headers=auth(uid)).status_code==200
  assert api.post(url+'/payment-order',headers=auth(uid)).status_code==200
  assert calls.count('orders')==1
  assert api.post(url+'/payment-check',headers=auth(uid)).json()['status']=='paid'
  assert api.post(url+'/payment-check',headers=auth(uid)).json()['status']=='paid'
 result=api.get('/operations/market/mine',headers=auth('worker')).json()['listings'][0]
 assert result['matches'][0]['id']==b['id'] and result['matches'][0]['value_difference_percent']==15
 assert api.get('/operations/market/'+b['id']+'/contact',headers=auth('worker')).status_code==200
 assert api.get('/operations/market/'+b['id']+'/contact',headers=auth('stranger')).status_code==403
 public=api.post('/operations/market/search',json={'location':PIN}).json()['items']
 assert all(not {'location','contact_phone','owner_id','owner_name'} & set(x) for x in public)
 notifications=main.operations_store.run(lambda u:[n for n in u.all('notifications') if n.get('destination')=='exchange']);assert len(notifications)==2
 assert api.post('/operations/market/'+b['id']+'/close',headers=auth('worker2')).status_code==200
 assert not api.get('/operations/market/mine',headers=auth('worker')).json()['listings'][0]['matches']

def test_matching_both_radii_price_categories_and_self():
 base=dict(id='a',owner_id='a',mode='exchange',status='published',product_type='phone',desired_type='computer',desired_product='Laptop',name='Phone',brand='Brand',value_paise=100000,location=PIN,radius_km=10)
 b={**base,'id':'b','owner_id':'b','product_type':'computer','desired_type':'phone','name':'Laptop','desired_product':'Phone'}
 assert marketplace.pair(base,b)
 assert marketplace.pair(base,{**b,'value_paise':115001}) is None
 assert marketplace.pair(base,{**b,'owner_id':'a'}) is None
 assert marketplace.pair(base,{**b,'desired_type':'audio'}) is None
 assert marketplace.pair(base,{**b,'location':{'lat':21.52,'lng':86.9135},'radius_km':1}) is None
 assert marketplace.pair(base,{**b,'status':'awaiting_fee'}) is None

def test_terms_authorization_version_snapshot(api):
 onboard(api)
 with main.db() as c:sid=c.execute('SELECT id FROM services LIMIT 1').fetchone()['id']
 path='/operations/admin/service-terms/'+sid
 assert api.put(path,headers=auth('customer'),json={'expected_version':0,'text':'Customer must approve additional work.'}).status_code==403
 assert api.put(path,headers=ADMIN,json={'expected_version':0,'text':'Customer must approve additional work.'}).status_code==200
 assert api.put(path,headers=ADMIN,json={'expected_version':0,'text':'Stale change is not accepted.'}).status_code==409
 j,_=book(api,service_id=sid,service_terms_version=1)
 assert main.operations_store.run(lambda u:u.get('jobs',j['id']))['service_terms']['version']==1
 assert api.put(path,headers=ADMIN,json={'expected_version':1,'text':'New terms apply to future bookings only.'}).status_code==200
 assert main.operations_store.run(lambda u:u.get('jobs',j['id']))['service_terms']['version']==1

def test_pending_wrong_amount_refund_and_unknown_order(api,monkeypatch):
 a,_=draft(api);url='/operations/market/'+a['id'];calls=paid(api,monkeypatch,a['id'])
 assert api.post(url+'/payment-order',headers=auth('worker')).status_code==200
 def provider(path,body=None):return {'items':[{'id':'pay','order_id':'order_'+a['id'],'amount':1,'currency':'INR','status':'captured'}]}
 monkeypatch.setattr(marketplace,'razorpay',provider)
 assert api.post(url+'/payment-check',headers=auth('worker')).json()['listing_status']=='awaiting_fee'
 def refund(path,body=None):return {'items':[{'id':'pay','order_id':'order_'+a['id'],'amount':a['fee_paise'],'currency':'INR','status':'refunded','amount_refunded':a['fee_paise']}]}
 monkeypatch.setattr(marketplace,'razorpay',refund)
 assert api.post(url+'/payment-check',headers=auth('worker')).json()['listing_status']=='closed'
 assert api.post(url+'/payment-order',headers=auth('worker')).status_code==409
 b,_=draft(api,'worker2');url='/operations/market/'+b['id']
 def timeout(path,body=None):marketplace.fail('UNKNOWN','Provider outcome unknown',503)
 monkeypatch.setattr(marketplace,'razorpay',timeout)
 assert api.post(url+'/payment-order',headers=auth('worker2')).status_code==503
 assert api.post(url+'/payment-order',headers=auth('worker2')).status_code==409

def test_refurbished_requires_details_and_is_in_catalog(api):
 from test_procurement import setup_shop,STOCK
 p=setup_shop(api)
 body={**STOCK,'expected_version':p['version'],'condition':'refurbished'}
 assert api.put('/operations/shop/inventory/cap35',headers=auth('shop'),json=body).status_code==422
 from test_shop_prime import REFURB
 body.update(warranty='30-day shop warranty',refurbishment_details='Tested and cleaned, casing replaced.',refurbishment=REFURB)
 assert api.put('/operations/shop/inventory/cap35',headers=auth('shop'),json=body).status_code==200
 row=api.get('/operations/products/catalog').json()['items'][0]
 assert row['condition']=='refurbished' and row['warranty']==body['warranty']

def test_first_free_each_mode_no_gateway_and_no_reset(api,monkeypatch):
 monkeypatch.setenv('REPAIDO_PAYMENTS_ENABLED','false')
 assert api.get('/operations/market/eligibility',headers=auth('worker')).json()=={'exchange':True,'second_hand':True}
 a,body=draft(api,trial=True)
 assert a['status']=='published' and a['fee_status']=='free_trial'
 assert a['expires_at']-a['trial_started_at']==30*86400
 assert api.post('/operations/market/listings',headers=auth('worker'),json=body).json()['expires_at']==a['expires_at']
 assert api.post('/operations/market/'+a['id']+'/publish-free',headers=auth('worker')).status_code==200
 b,_=draft(api,trial=True,mode='second_hand');assert b['fee_status']=='free_trial'
 assert api.get('/operations/market/eligibility',headers=auth('worker')).json()=={'exchange':False,'second_hand':True}
 assert api.post('/operations/market/'+a['id']+'/close',headers=auth('worker')).status_code==200
 c,_=draft(api,trial=True);assert c['status']=='awaiting_fee'
 assert api.post('/operations/market/'+c['id']+'/publish-free',headers=auth('worker')).status_code==409
 assert api.post('/operations/market/'+c['id']+'/payment-order',headers=auth('worker')).status_code==503
 assert not main.operations_store.run(lambda u:u.all('market_fees'))

def test_expiry_hides_every_public_surface_and_notifies_once(api,monkeypatch):
 monkeypatch.setenv('REPAIDO_PAYMENTS_ENABLED','false')
 a,_=draft(api,trial=True)
 b,_=draft(api,'worker2',trial=True,product_type='computer',desired_type='phone',desired_product='Samsung phone')
 assert api.get('/operations/market/'+b['id']+'/contact',headers=auth('worker')).status_code==200
 monkeypatch.setattr(marketplace.time,'time',lambda:a['expires_at']-86400)
 main.market_tick();main.market_tick()
 reminders=main.operations_store.run(lambda u:[n for n in u.all('notifications') if n['id']=='market-expiring-'+a['id']]);assert len(reminders)==1
 monkeypatch.setattr(marketplace.time,'time',lambda:a['expires_at'])
 # Boundary checks run BEFORE the expiry scheduler: stale published rows must not leak.
 assert not any(x['id']==a['id'] for x in api.post('/operations/market/search',json={'location':PIN}).json()['items'])
 assert api.get('/operations/market/'+a['id']+'/contact',headers=auth('worker2')).status_code==404
 assert api.get('/operations/market/photos/'+a['photo_id']).status_code==404
 assert api.get('/operations/market/'+b['id']+'/contact',headers=auth('worker')).status_code==403
 main.market_tick();main.market_tick()
 row=api.get('/operations/market/mine',headers=auth('worker')).json()['listings'][0]
 assert row['status']=='expired' and not row['matches']
 assert len(main.operations_store.run(lambda u:[n for n in u.all('notifications') if n['id']=='market-expired-'+a['id']]))==1
 assert api.post('/operations/market/'+a['id']+'/publish-free',headers=auth('worker')).json()['status']=='expired'

def test_expired_trial_paid_continuation_retries_and_refund(api,monkeypatch):
 a,_=draft(api,trial=True,mode='second_hand');url='/operations/market/'+a['id']
 def expire(u):
  row=u.get('market_listings',a['id']);row['expires_at']=time.time()-1;u.put('market_listings',a['id'],row)
 main.operations_store.run(expire);main.market_tick()
 calls=paid(api,monkeypatch,a['id'])
 for _ in range(2):assert api.post(url+'/payment-order',headers=auth('worker')).status_code==200
 assert calls.count('orders')==1
 for _ in range(2):assert api.post(url+'/payment-check',headers=auth('worker')).json()['listing_status']=='published'
 row=api.get('/operations/market/mine',headers=auth('worker')).json()['listings'][0]
 assert row['fee_status']=='paid' and row['expires_at'] is None and row['fee_paise']==50000
 assert api.post(url+'/payment-order',headers=auth('worker')).status_code==409
 monkeypatch.setattr(marketplace,'razorpay',lambda *args:{'items':[dict(id='pay',order_id='order_'+a['id'],status='refunded',amount=a['fee_paise'],currency='INR',amount_refunded=a['fee_paise'])]})
 assert api.post(url+'/payment-check',headers=auth('worker')).json()['listing_status']=='closed'

def test_existing_unpaid_draft_can_claim_but_other_owner_cannot(api):
 a,_=draft(api)
 # Simulate the sole unpaid listing created before the free-offer release.
 with main.db() as c:c.execute('DELETE FROM operation_records WHERE kind=? AND id=?',('market_trials',marketplace.trial_key('worker','exchange')))
 url='/operations/market/'+a['id']+'/publish-free'
 assert api.post(url,headers=auth('worker2')).status_code==404
 assert api.get('/operations/market/mine',headers=auth('worker')).json()['listings'][0]['free_eligible']
 assert api.post(url,headers=auth('worker')).json()['status']=='published'
 assert api.post(url,headers=auth('worker')).json()['status']=='published'

def test_concurrent_seller_listings_share_one_offer_window(api):
 from concurrent.futures import ThreadPoolExecutor
 _,body=draft(api,trial=True)
 payloads=[{**body,'mode':'second_hand','request_id':str(uuid.uuid4())} for _ in range(2)]
 with ThreadPoolExecutor(max_workers=2) as pool:
  responses=list(pool.map(lambda b:api.post('/operations/market/listings',headers=auth('worker'),json=b),payloads))
 assert all(r.status_code==200 for r in responses)
 assert sorted(r.json()['status'] for r in responses)==['published','published']
 assert responses[0].json()['expires_at']==responses[1].json()['expires_at']

def test_early_continuation_and_closed_or_moderated_stay_hidden(api,monkeypatch):
 a,_=draft(api,trial=True);url='/operations/market/'+a['id'];paid(api,monkeypatch,a['id'])
 assert api.post(url+'/payment-order',headers=auth('worker')).status_code==200
 assert api.post(url+'/payment-check',headers=auth('worker')).json()['listing_status']=='published'
 row=api.get('/operations/market/mine',headers=auth('worker')).json()['listings'][0]
 assert row['expires_at'] is None and row['fee_status']=='paid'
 assert api.post('/operations/admin/market/'+a['id']+'/hide',headers=ADMIN,json={'reason':'Test moderation restriction'}).status_code==200
 assert api.post(url+'/payment-check',headers=auth('worker')).json()['listing_status']=='suspended'
 b,_=draft(api,'worker2',trial=True);url='/operations/market/'+b['id'];paid(api,monkeypatch,b['id'])
 assert api.post(url+'/payment-order',headers=auth('worker2')).status_code==200
 assert api.post(url+'/close',headers=auth('worker2')).status_code==200
 assert api.post(url+'/payment-check',headers=auth('worker2')).json()['listing_status']=='closed'

def test_second_hand_picker_metadata_and_search(api):
 a,body=draft(api,mode='second_hand',trial=True,location={**PIN,'address':'House 12, station road','city':'Balasore'})
 assert a['status']=='published'
 r=api.post('/operations/market/search',json={'mode':'second_hand','location':body['location']})
 assert r.status_code==200 and any(i['id']==a['id'] for i in r.json()['items'])
 bad={**body,'request_id':str(uuid.uuid4()),'location':{**PIN,'unexpected':'no'}}
 assert api.post('/operations/market/listings',headers=auth('worker'),json=bad).status_code==422

def test_new_seller_unlimited_window_does_not_reset(api,monkeypatch):
 a,_=draft(api,trial=True,mode='second_hand')
 assert abs(a['expires_at']-a['trial_started_at']-90*86400)<2
 b,_=draft(api,trial=True,mode='second_hand')
 assert b['status']=='published' and b['expires_at']==a['expires_at']
 assert api.get('/operations/market/eligibility',headers=auth('worker')).json()['second_hand']
 monkeypatch.setattr(marketplace.time,'time',lambda:a['expires_at']+1)
 c,_=draft(api,trial=True,mode='second_hand')
 assert c['status']=='awaiting_fee'
 assert not api.get('/operations/market/eligibility',headers=auth('worker')).json()['second_hand']

def test_legacy_seller_not_reenrolled(api):
 a,_=draft(api,mode='second_hand')
 assert a['status']=='awaiting_fee'
 b,_=draft(api,trial=True,mode='second_hand')
 assert b['status']=='awaiting_fee'

def test_new_seller_offer_preserves_daily_spam_limit(api):
 first,body=draft(api,trial=True,mode='second_hand')
 for _ in range(9):
  r=api.post('/operations/market/listings',headers=auth('worker'),json={**body,'request_id':str(uuid.uuid4())})
  assert r.status_code==200 and r.json()['expires_at']==first['expires_at']
 blocked=api.post('/operations/market/listings',headers=auth('worker'),json={**body,'request_id':str(uuid.uuid4())})
 assert blocked.status_code==429
