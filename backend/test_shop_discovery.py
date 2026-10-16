"""Actual local HTTP/domain checks; no cloud identity, payments or storage calls."""
import json
import time
import uuid
import pytest
import main
import operations
import shop_discovery as discovery
from test_operations import api, auth, ADMIN, PIN


def seed():
    now=time.time()
    def save(u):
        for sid,owner in [('s1','shop'),('s2','worker')]:
            u.put('shops',sid,{'id':sid,'owner_id':owner,'name':'Fixture '+sid,'city':'Balasore','categories':'electrical, plumbing','address':'Public verified business address','phone':'PRIVATE_PHONE','owner_name':'PRIVATE_OWNER','business_reference':'PRIVATE_REF','location':PIN,'status':'approved','created_at':now-86400,'reviewed_by':'independent-reviewer','verification':{'identity_checked':True,'business_checked':True,'address_checked':True,'evidence_reference':'PRIVATE_EVIDENCE'}})
        for pid,sid,price,category in [('wire','s1',10000,'electrical'),('switch','s1',5000,'electrical'),('pipe','s2',8000,'plumbing'),('lamp','s2',9000,'electrical')]:
            u.put('inventory',pid,{'id':pid,'shop_id':sid,'name':'Fixture '+pid,'sku':pid,'category':category,'price_paise':price,'stock':10,'reserved':0,'stock_confirmed_at':now,'status':'approved','condition':'new','version':1,'private_supplier':'PRIVATE_SUPPLIER'})
        u.put('rental_inventory','drill',{'id':'drill','shop_id':'s1','name':'Drill rental','active':True,'total_units':4,'reserved':1,'quarantined':0,'daily_paise':10000,'weekly_paise':50000,'monthly_paise':150000,'deposit_paise':10000,'owner_id':'PRIVATE_OWNER'})
    main.operations_store.run(save)


def order(oid='receipt',customer='customer',state='paid',received=True,products=('wire','switch'),quantity=1):
    value={'id':oid,'customer_id':customer,'state':state,'payment_id':'pay_actual_fixture','received_at':time.time() if received else None,'recipient_phone':'PRIVATE_PHONE','delivery_address':'PRIVATE_HOME','items':[{'product_id':pid,'shop_id':'s1','quantity':quantity,'name':'Fixture '+pid} for pid in products]}
    main.operations_store.run(lambda u:u.put('retail_orders',oid,value));return value


def profile(api,sid='s1',**params):
    result=api.get('/operations/shops/'+sid+'/profile',params=params)
    assert result.status_code==200,result.text
    return result.json()


def consent(version=3,enabled=True,updated=None):
    row={'id':'customer','enabled':enabled,'consent_version':version,'updated_at':updated or time.time()}
    main.operations_store.run(lambda u:u.put('discovery_preferences','customer',row));return row


def test_public_profile_is_read_only_sanitized_precise_and_native_priced(api,monkeypatch):
    seed()
    before=main.operations_store.run(lambda u:len(u.all('shop_access_members')))
    # The discovery request cannot use an unbounded native collection scan.
    monkeypatch.setattr(operations.Unit,'all',lambda *a:(_ for _ in ()).throw(AssertionError('unbounded scan')))
    result=profile(api)
    encoded=json.dumps(result)
    assert 'PRIVATE_' not in encoded and 'owner_id' not in encoded and 'location' not in result['shop']
    assert result['shop']['verified'] and result['shop']['rating']['mean'] is None and result['shop']['rating']['count']==0
    assert result['shop']['quality']['version']=='commerce-evidence-v1'
    assert result['shop']['rank']['sampled'] and result['shop']['rank']['cohort_size']==2
    assert result['shop']['activity']['status']=='unknown'
    assert result['rentals'][0]['daily_paise']==10000 and result['rentals'][0]['available_units']==3
    assert {p['id']:p['price_paise'] for p in result['catalogue']}=={'switch':4750,'wire':9500}
    assert before==0


def test_hidden_suspended_expired_and_unverified_application_profiles(api):
    seed()
    for updates in ({'status':'suspended'},{'created_at':time.time()-91*86400},{'verification':{'identity_checked':True,'business_checked':False,'address_checked':True}}):
        main.operations_store.run(lambda u:u.put('shops','s1',{**u.get('shops','s1'),**updates}))
        assert api.get('/operations/shops/s1/profile').status_code==404
        result=api.post('/operations/shop-discovery/recommendations',json={'category':'electrical'}).json()
        assert all(p['shop_id']!='s1' for p in result['products'])
        seed()


def test_sales_projection_idempotency_refund_and_honest_sample_labels(api):
    seed();row=order()
    for _ in range(3):main.operations_store.run(lambda u:u.put('retail_orders','receipt',row))
    result=profile(api)
    assert result['metrics']['received_orders']==1 and result['metrics']['units_sold']==2
    assert result['metrics']['since'] and 'Observed' in result['metrics']['coverage']
    assert result['catalogue'][0]['received_units']==1
    main.operations_store.run(lambda u:u.put('retail_orders','receipt',{**row,'amount_refunded':100}))
    result=profile(api)
    assert result['metrics']['received_orders']==0 and result['metrics']['refunded_orders']==1
    assert all(p['received_units']==0 for p in result['catalogue'])


def test_verified_review_requires_exact_owned_received_purchase_and_never_paid_badges(api):
    seed();row=order(received=False)
    body={'order_id':'receipt','product_id':'wire','rating':5,'text':'Good received item','request_id':str(uuid.uuid4())}
    url='/operations/shops/s1/reviews'
    assert api.post(url,json=body).status_code==401
    assert api.post(url,headers=auth('stranger'),json=body).status_code==404
    assert api.post(url,headers=auth('customer'),json=body).status_code==409
    row=order()
    assert api.post(url,headers=auth('customer'),json={**body,'product_id':'pipe'}).status_code==422
    assert api.post(url,headers=auth('customer'),json={**body,'rating':True}).status_code==422
    assert api.get('/operations/shops/s1/reviewable-orders',headers=auth('customer')).json()['orders'][0]['id']=='receipt'
    first=api.post(url,headers=auth('customer'),json=body)
    assert first.status_code==201,first.text
    assert api.post(url,headers=auth('customer'),json=body).json()==first.json()
    assert api.post(url,headers=auth('customer'),json={**body,'rating':1}).status_code==409
    assert api.get('/operations/shops/s1/reviewable-orders',headers=auth('customer')).json()['orders']==[]
    result=profile(api)
    assert result['shop']['rating']['mean']==5 and result['shop']['rating']['count']==1 and result['shop']['rating']['bayesian']<5
    assert 'customer' not in json.dumps(result['reviews']) and 'receipt' not in json.dumps(result['reviews'])
    main.operations_store.run(lambda u:u.put('retail_orders','receipt',{**row,'state':'refunded'}))
    result=profile(api)
    assert result['shop']['rating']['count']==0 and result['reviews']==[]
    # Reactivating the same receipt after a refund reversal is also idempotent.
    main.operations_store.run(lambda u:u.put('retail_orders','receipt',row))
    assert profile(api)['shop']['rating']['count']==1


def test_shop_owner_cannot_review_self_even_with_received_purchase(api):
    seed();order(customer='shop')
    result=api.post('/operations/shops/s1/reviews',headers=auth('shop'),json={'order_id':'receipt','rating':4,'request_id':str(uuid.uuid4())})
    assert result.status_code==403


def test_recommendations_frequently_together_requires_real_received_sample(api):
    seed()
    endpoint='/operations/shop-discovery/recommendations'
    empty=api.post(endpoint,json={'product_id':'wire'}).json()
    assert empty['bought_together']['label']=='Related items'
    for n in range(5):order('receipt-'+str(n),products=('wire','switch') if n<3 else ('wire',))
    response=api.post(endpoint,json={'product_id':'wire'}).json()
    together=response['bought_together']
    assert together['label']=='Frequently bought together' and together['sample_orders']==5
    assert together['items'][0]['id']=='switch' and together['items'][0]['co_purchase_orders']==3 and together['confidence']==.6
    row=main.operations_store.run(lambda u:u.get('retail_orders','receipt-0'))
    main.operations_store.run(lambda u:u.put('retail_orders',row['id'],{**row,'state':'refunded'}))
    assert api.post(endpoint,json={'product_id':'wire'}).json()['bought_together']['label']=='Related items'
    assert not response['personalised']


def test_consent_events_dedupe_without_raw_search_or_identity_leak(api):
    seed();url='/operations/shop-discovery/events';body={'request_id':str(uuid.uuid4()),'event':'search','category':'electrical','query':'private medical secret search'}
    assert api.post(url,json=body).status_code==401
    assert api.post(url,headers=auth('customer'),json=body).json()['recorded'] is False
    assert main.operations_store.run(lambda u:u.get('commerce_interest','customer')) is None
    consent(version=2)
    assert not api.post(url,headers=auth('customer'),json=body).json()['recorded']
    consent()
    first=api.post(url,headers=auth('customer'),json=body).json();assert first['recorded'] and not first['replayed']
    second=api.post(url,headers=auth('customer'),json=body).json();assert second['replayed']
    interest=main.operations_store.run(lambda u:u.get('commerce_interest','customer'))
    assert interest['categories']['electrical']['score']==1
    assert 'private medical' not in json.dumps(interest)
    assert api.post(url,headers=auth('customer'),json={**body,'event':'add_to_cart'}).status_code==409
    result=api.post('/operations/shop-discovery/personal',headers=auth('customer'),json={}).json()
    assert result['personalised'] and result['products'] and all(p['category']=='electrical' for p in result['products'])
    stranger=api.post('/operations/shop-discovery/personal',headers=auth('stranger'),json={}).json()
    assert not stranger['personalised'] and any(p['category']=='plumbing' for p in stranger['products'])
    consent(enabled=False)
    assert not api.post('/operations/shop-discovery/personal',headers=auth('customer'),json={}).json()['personalised']
    consent(updated=time.time()+1)
    result=api.post('/operations/shop-discovery/personal',headers=auth('customer'),json={}).json()
    assert any(p['category']=='plumbing' for p in result['products'])


def test_unknown_category_not_retained_and_expired_history_not_reused(api,monkeypatch):
    seed();prefs=consent();url='/operations/shop-discovery/events'
    bad={'request_id':str(uuid.uuid4()),'event':'search','category':'sensitive private trait'}
    assert not api.post(url,headers=auth('customer'),json=bad).json()['recorded']
    main.operations_store.run(lambda u:u.put('commerce_interest','customer',{'id':'customer','consent_updated_at':prefs['updated_at'],'categories':{'plumbing':{'score':20,'at':time.time()-31*86400}}}))
    assert any(p['category']=='electrical' for p in api.post('/operations/shop-discovery/personal',headers=auth('customer'),json={}).json()['products'])


def test_public_presence_multisession_sequence_expiry_and_days(api,monkeypatch):
    seed();url='/operations/shop-discovery/presence';a=str(uuid.uuid4());b=str(uuid.uuid4());now=[time.time()]
    monkeypatch.setattr(discovery.time,'time',lambda:now[0])
    def pulse(session,seq,online=True):return api.post(url,headers=auth('shop'),json={'session_id':session,'sequence':seq,'online':online})
    assert api.post(url,headers=auth('customer'),json={'session_id':a,'sequence':1,'online':True}).status_code==403
    assert pulse(a,1).status_code==200
    assert pulse(b,1).status_code==200
    assert pulse(a,2,False).json()['status']=='online'
    assert pulse(a,1,True).json()['ignored']
    current=profile(api)['shop']['activity']
    assert current['status']=='online' and current['active_days_this_month']==1
    pulse(b,2,False)
    assert profile(api)['shop']['activity']['status']=='offline'
    now[0]+=91
    assert profile(api)['shop']['activity']['status']=='unknown'


def test_profile_filters_sort_and_cursor_scope(api):
    seed()
    result=profile(api,category='electrical',sort='price_low')
    assert [p['id'] for p in result['catalogue']]==['switch','wire']
    assert result['shop']['rank']['category']=='electrical'
    assert profile(api,query='no matches')['catalogue']==[]
    assert api.get('/operations/shops/s1/profile',params={'cursor':'bad'}).status_code==422


def test_operator_reindex_bounded_idempotent_and_no_public_trigger(api):
    seed();row=order()
    # Simulate a historical native order written before projections existed.
    def drop(u):
        u.conn.execute("DELETE FROM operation_records WHERE kind LIKE 'commerce_%'")
    main.operations_store.run(drop)
    endpoint='/operations/admin/shop-discovery/reindex'
    assert api.post(endpoint,json={}).status_code==403
    assert api.post(endpoint,headers=ADMIN,json={'limit':21}).status_code==422
    for _ in range(2):
        r=api.post(endpoint,headers=ADMIN,json={});assert r.status_code==200,r.text
    assert profile(api)['metrics']['received_orders']==1


def test_consent_reset_physically_erases_private_activity_and_core_events_preserve_it(api):
    seed();settings='/operations/discovery/preferences';headers=auth('customer')
    assert api.put(settings,headers=headers,json={'enabled':True,'consent_version':3}).status_code==200
    event={'request_id':str(uuid.uuid4()),'event':'view_product','product_id':'wire'}
    assert api.post('/operations/shop-discovery/events',headers=headers,json=event).json()['recorded']
    original=main.operations_store.run(lambda u:u.get('commerce_interest','customer'))
    assert api.post('/operations/discovery/events',headers=headers,json={'event_id':str(uuid.uuid4()),'kind':'category_view','category':'ac'}).status_code==200
    assert main.operations_store.run(lambda u:u.get('commerce_interest','customer'))['categories']==original['categories']
    assert api.post(settings+'/reset',headers=headers,json={}).status_code==200
    assert main.operations_store.run(lambda u:u.get('commerce_interest','customer'))['categories']=={}
    assert main.operations_store.run(lambda u:u.get('commerce_event_dedup','customer'))['events']=={}
    assert api.post('/operations/shop-discovery/events',headers=headers,json=event).json()['recorded']
    assert api.put(settings,headers=headers,json={'enabled':False}).status_code==200
    assert main.operations_store.run(lambda u:u.get('commerce_interest','customer'))['categories']=={}
    assert main.operations_store.run(lambda u:u.get('commerce_event_dedup','customer'))['events']=={}


def test_presence_replay_after_expiry_cannot_resurrect_a_closed_session(api,monkeypatch):
    seed();now=[time.time()];monkeypatch.setattr(discovery.time,'time',lambda:now[0])
    url='/operations/shop-discovery/presence';body={'session_id':str(uuid.uuid4()),'sequence':1,'online':True}
    assert api.post(url,headers=auth('shop'),json=body).json()['status']=='online'
    assert api.post(url,headers=auth('shop'),json={**body,'sequence':2,'online':False}).json()['status']=='offline'
    now[0]+=86401
    replay=api.post(url,headers=auth('shop'),json=body).json()
    assert replay['ignored'] and replay['status']=='unknown'
    assert profile(api)['shop']['activity']['active_days_this_month']==1


def test_large_catalogue_keyset_pages_reach_every_item_without_unbounded_reads(api):
    seed()
    def add(u):
        base=u.get('inventory','wire')
        for n in range(105):
            pid='many-'+str(n).zfill(3);u.put('inventory',pid,{**base,'id':pid,'name':'Extra '+str(n)})
    main.operations_store.run(add)
    seen=[];cursor=''
    for _ in range(10):
        page=profile(api,cursor=cursor);seen.extend(p['id'] for p in page['catalogue'])
        cursor=page['next_cursor']
        if not cursor:break
    assert not cursor and len(seen)==107 and len(set(seen))==107


def test_closed_shop_sessions_do_not_consume_active_capacity(api):
    seed();url='/operations/shop-discovery/presence';first=None
    for n in range(10):
        session=str(uuid.uuid4());body={'session_id':session,'sequence':1,'online':True}
        if first is None:first=body
        opened=api.post(url,headers=auth('shop'),json=body)
        assert opened.status_code==200,opened.text
        assert opened.json()['status']=='online'
        closed=api.post(url,headers=auth('shop'),json={**body,'sequence':2,'online':False})
        assert closed.status_code==200,closed.text
        assert closed.json()['status']=='offline'
    replay=api.post(url,headers=auth('shop'),json=first)
    assert replay.status_code==200 and replay.json()['ignored']
    assert replay.json()['status']=='offline'
    # Bounded closed tombstones must not prevent ordinary repeated navigation.
    for _ in range(10):
        body={'session_id':str(uuid.uuid4()),'sequence':1,'online':True}
        assert api.post(url,headers=auth('shop'),json=body).status_code==200
        assert api.post(url,headers=auth('shop'),json={**body,'sequence':2,'online':False}).status_code==200
    state=main.operations_store.run(lambda u:u.get('shop_public_presence','s1'))
    assert len(state['sessions'])<=16


def drain_commerce():
    for _ in range(30):
        if discovery.process_updates(main,limit=10)['processed']==0:return
    raise AssertionError('Bounded commerce projection drain did not finish.')


def test_large_supplier_basket_defers_projection_with_idempotent_bounded_drain_and_refund(api,monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    writes=[];original=operations.Unit.flush
    def capture(unit):writes.append(len(unit.pending));return original(unit)
    monkeypatch.setattr(operations.Unit,'flush',capture)
    def seed_large(u,start):
        for n in range(start,min(start+20,100)):
            sid='supplier-'+str(n);pid='part-'+str(n)
            u.put('shops',sid,{'id':sid,'owner_id':sid,'status':'approved','name':'Fixture supplier','created_at':time.time()-60})
            u.put('inventory',pid,{'id':pid,'shop_id':sid,'name':'Fixture part','category':'electrical','status':'approved','condition':'new','stock':2,'stock_confirmed_at':time.time(),'price_paise':10000})
    for start in range(0,100,20):main.operations_store.run(lambda u,start=start:seed_large(u,start))
    large={'id':'large-receipt','customer_id':'customer','state':'paid','payment_id':'pay_confirmed','received_at':time.time(),
           'items':[{'product_id':'part-'+str(n),'shop_id':'supplier-'+str(n),'quantity':1} for n in range(100)]}
    def save_order(u):
        u.put('retail_orders',large['id'],large)
        envelopes=[v for (kind,_),v in u.pending.items() if kind=='commerce_projection_queue']
        assert len(envelopes)==1 and envelopes[0]['orders']==[large['id']]
        assert not any(kind=='commerce_shop_stats' for kind,_ in u.pending)
    main.operations_store.run(save_order)
    # Competing worker retries serialize on the saved envelope and projection.
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda _:drain_commerce(),range(2)))
    stats=main.operations_store.run(lambda u:u.all('commerce_shop_stats'))
    assert len(stats)==100 and all(s['received_orders']==1 and s['units_sold']==1 for s in stats)
    product_stats=main.operations_store.run(lambda u:u.all('commerce_product_stats'))
    assert len(product_stats)==100 and all(s['received_orders']==1 for s in product_stats)
    main.operations_store.run(save_order);drain_commerce()
    assert main.operations_store.run(lambda u:u.get('commerce_shop_stats','supplier-0'))['received_orders']==1
    # A stale queued receipt must rehydrate the latest refund, never replay its payload.
    main.operations_store.run(save_order)
    main.operations_store.run(lambda u:u.put('retail_orders',large['id'],{**large,'state':'refunded','amount_refunded':1000000}))
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda _:drain_commerce(),range(2)))
    stats=main.operations_store.run(lambda u:u.all('commerce_shop_stats'))
    assert all(s['received_orders']==0 and s['units_sold']==0 and s['refunded_orders']==1 for s in stats)
    assert all(s['received_orders']==0 and s['units_sold']==0 for s in main.operations_store.run(lambda u:u.all('commerce_product_stats')))
    assert max(writes)<500
    assert not main.operations_store.run(lambda u:u.find('commerce_projection_queue','active',True,limit=1))


def test_large_received_review_projects_authority_outside_payment_before_worker(api):
    seed()
    def save(u):
        template=u.get('inventory','wire')
        for n in range(10):u.put('inventory','review-part-'+str(n),{**template,'id':'review-part-'+str(n)})
    main.operations_store.run(save)
    value={'id':'large-review-receipt','customer_id':'customer','state':'paid','payment_id':'pay_actual','received_at':time.time(),
           'items':[{'product_id':'review-part-'+str(n),'shop_id':'s1','quantity':1} for n in range(10)]}
    main.operations_store.run(lambda u:u.put('retail_orders',value['id'],value))
    response=api.post('/operations/shops/s1/reviews',headers=auth('customer'),json={'order_id':value['id'],'rating':5,'request_id':str(uuid.uuid4())})
    assert response.status_code==201,response.text
    assert profile(api)['shop']['rating']['count']==1
    drain_commerce()
    result=profile(api)
    assert result['shop']['rating']['count']==1 and result['metrics']['received_orders']==1


def test_projection_failure_rolls_back_queue_deletion_and_retries_without_lost_work(api,monkeypatch):
    seed();original=operations.Unit.flush
    def fail_projection(unit):
        if any(kind=='commerce_shop_catalogue' for kind,_ in unit.pending):raise RuntimeError('isolated worker commit failure')
        return original(unit)
    monkeypatch.setattr(operations.Unit,'flush',fail_projection)
    with pytest.raises(RuntimeError,match='isolated worker commit failure'):discovery.process_updates(main,limit=1)
    assert main.operations_store.run(lambda u:u.find('commerce_projection_queue','active',True,limit=1))
    assert main.operations_store.run(lambda u:u.get('commerce_shop_catalogue','s1')) is None
    monkeypatch.setattr(operations.Unit,'flush',original)
    drain_commerce()
    assert main.operations_store.run(lambda u:u.get('commerce_shop_catalogue','s1'))['products']
    assert main.operations_store.run(lambda u:u.all('commerce_projection_queue'))==[]
