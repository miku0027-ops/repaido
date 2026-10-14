import time
import main
from test_operations import api, auth, onboard, PIN


def search(api, **kwargs):
    return api.post('/operations/discovery/search', json={'city': 'Balasore', **kwargs})


def test_catalog_filter_and_no_location(api):
    result = search(api, query='AC', max_price_paise=50000).json()
    assert result['services'] and all(s['price_paise'] <= 50000 for s in result['services'])
    assert result['location_required'] and result['professionals'] == []
    assert result['offers'] == []
    assert search(api, query='nonsenseunavailable').json()['services'] == []
    assert search(api, radius_km=9).status_code == 422
    assert search(api, location={'lat': 91, 'lng': 0}).status_code == 422
    assert search(api, city='Outside coverage').json()['covered'] is False
    rows = search(api, sort='price').json()['services']
    assert [s['price_paise'] for s in rows] == sorted(s['price_paise'] for s in rows)


def test_inactive_catalog_and_legacy_ratings_are_not_advertised(api, monkeypatch):
    original = main.catalog()
    original['services'][0]['active'] = False
    original['services'][1]['rating'] = 5
    monkeypatch.setattr(main, 'catalog', lambda: original)
    rows = search(api).json()['services']
    assert original['services'][0]['id'] not in [s['id'] for s in rows]
    assert all('rating' not in s for s in rows)


def test_worker_freshness_privacy_filters_and_travel_limits(api):
    onboard(api)
    result = search(api, location=PIN, query='AC', radius_km=8).json()
    assert len(result['professionals']) == 1
    w = result['professionals'][0]
    assert w['rating'] is None
    assert not {'location','position','phone','home_address','dob','bank_account','_rank'} & w.keys()
    assert search(api, location=PIN, role='specialist').json()['professionals'] == []
    assert search(api, location={'lat': PIN['lat']+.065, 'lng': PIN['lng']}).json()['professionals'] == []
    def stale(u):
        w = u.get('workers','worker'); w['position']['received_at'] = time.time()-901;u.put('workers','worker',w)
    main.operations_store.run(stale)
    assert search(api, location=PIN).json()['professionals'] == []


def test_personalisation_consent_isolation_clear_and_bounded_events(api):
    base='/operations/discovery'
    assert api.get(base+'/preferences').status_code == 401
    assert api.post(base+'/interest',headers=auth('customer'),json={'service_id':'ac-service'}).status_code == 403
    assert api.put(base+'/preferences',headers=auth('customer'),json={'enabled':True,'consent_version':2}).status_code == 200
    for _ in range(3):
        assert api.post(base+'/interest',headers=auth('customer'),json={'service_id':'ac-service'}).status_code == 200
    prefs = api.get(base+'/preferences',headers=auth('customer')).json()
    assert prefs['categories'] == {'ac':1}
    assert api.get(base+'/preferences',headers=auth('stranger')).json()['enabled'] is False
    assert api.post(base+'/interest',headers=auth('customer'),json={'service_id':'missing'}).status_code == 404
    assert api.put(base+'/preferences',headers=auth('customer'),json={'enabled':False}).json()['categories'] == {}
    assert api.get(base+'/preferences',headers=auth('customer')).json().get('last_interest_at') is None


def test_hydration_repeated_events_privacy_diversity_and_reset(api, monkeypatch):
    import uuid
    now=[int(time.time()//86400)*86400+1000];monkeypatch.setattr('discovery.time.time',lambda:now[0])
    base='/operations/discovery'
    assert api.get(base+'/feed/personal').status_code==401
    public=api.get(base+'/feed?city=Balasore').json()
    assert not public['personalised'] and len(public['cards'])==6
    assert len({c['category'] for c in public['cards']})==6
    assert api.get(base+'/feed?city=Outside').json()['covered'] is False
    body={'event_id':str(uuid.uuid4()),'kind':'search','query':'AC'}
    assert api.post(base+'/events',headers=auth('customer'),json=body).status_code==403
    api.put(base+'/preferences',headers=auth('customer'),json={'enabled':True,'consent_version':2})
    assert api.post(base+'/events',headers=auth('customer'),json=body).json()['recorded']
    assert not api.post(base+'/events',headers=auth('customer'),json=body).json()['recorded']
    assert all(not c['personalised'] for c in api.get(base+'/feed/personal',headers=auth('customer')).json()['cards'])
    now[0]+=61
    assert api.post(base+'/events',headers=auth('customer'),json={**body,'event_id':str(uuid.uuid4())}).json()['recorded']
    feed=api.get(base+'/feed/personal',headers=auth('customer')).json()
    assert feed['cards'][0]['category']=='ac' and feed['cards'][0]['personalised']
    assert any(not c['personalised'] for c in feed['cards'])
    assert api.get(base+'/feed/personal',headers=auth('stranger')).json()==public
    stored=main.operations_store.run(lambda u:u.get('discovery_preferences','customer'))
    assert not any(k in str(stored) for k in ('"query"','temporaryProof','location'))
    assert 'AC' not in str(stored)
    assert api.post(base+'/preferences/reset',headers=auth('customer')).json()['enabled']
    assert main.operations_store.run(lambda u:u.get('discovery_preferences','customer')).get('signals') is None
    assert all(not c['personalised'] for c in api.get(base+'/feed/personal',headers=auth('customer')).json()['cards'])


def test_hydration_signal_decay_validation_and_opt_out(api, monkeypatch):
    import uuid
    now=[int(time.time()//86400)*86400+1000];monkeypatch.setattr('discovery.time.time',lambda:now[0])
    base='/operations/discovery';headers=auth('customer')
    api.put(base+'/preferences',headers=headers,json={'enabled':True,'consent_version':2})
    def emit(**kw):return api.post(base+'/events',headers=headers,json={'event_id':str(uuid.uuid4()),**kw})
    assert emit(kind='service_view',service_id='missing').status_code==404
    assert emit(kind='category_view',category='nonexistent').status_code==404
    assert emit(kind='arbitrary_form',query='private').status_code==422
    assert not emit(kind='search',query='nonsenseunavailable').json()['recorded']
    for _ in range(2):
        assert emit(kind='service_view',service_id='ac-service').json()['recorded'];now[0]+=61
    assert api.get(base+'/feed/personal',headers=headers).json()['cards'][0]['personalised']
    now[0]+=31*86400
    assert all(not c['personalised'] for c in api.get(base+'/feed/personal',headers=headers).json()['cards'])
    assert api.put(base+'/preferences',headers=headers,json={'enabled':False}).json()['categories']=={}
    row=main.operations_store.run(lambda u:u.get('discovery_preferences','customer'))
    assert not {'signals','seen','recent'}&row.keys()
    assert emit(kind='service_view',service_id='ac-service').status_code==403


def test_old_consent_is_not_expanded_and_inactive_cards_are_excluded(api, monkeypatch):
    assert api.put('/operations/discovery/preferences',headers=auth('customer'),json={'enabled':True}).status_code==409
    main.operations_store.run(lambda u:u.put('discovery_preferences','customer',{'enabled':True,'categories':{'ac':90}}))
    assert not api.get('/operations/discovery/preferences',headers=auth('customer')).json()['enabled']
    original=main.catalog();original['services']=[{**s,'active':False} for s in original['services'] if s['category']=='ac']
    monkeypatch.setattr(main,'catalog',lambda:original)
    assert api.get('/operations/discovery/feed').json()['cards']==[]


def test_events_rate_limit_and_idempotence_bound_influence(api, monkeypatch):
    import uuid
    now=[int(time.time()//86400)*86400+1000];monkeypatch.setattr('discovery.time.time',lambda:now[0])
    base='/operations/discovery';h=auth('customer')
    api.put(base+'/preferences',headers=h,json={'enabled':True,'consent_version':2})
    for i in range(105):
        response=api.post(base+'/events',headers=h,json={'event_id':str(uuid.uuid4()),'kind':'service_view','service_id':'ac-service'})
        assert response.json()['recorded']==(i<100)
        now[0]+=61
    row=main.operations_store.run(lambda u:u.get('discovery_preferences','customer'))
    assert len(row['seen'])<=100 and row['signals']['ac']['score']<=30


def test_deep_filters_sorting_and_live_completion_catalog(api, monkeypatch):
    rows=search(api,min_price_paise=30000,max_price_paise=100000,max_duration_minutes=90,sort='price_desc').json()
    assert rows['services']
    assert all(30000<=s['price_paise']<=100000 and s['duration_minutes']<=90 for s in rows['services'])
    assert [s['price_paise'] for s in rows['services']]==sorted((s['price_paise'] for s in rows['services']),reverse=True)
    assert rows['home_services']==[]
    timed=search(api,sort='duration').json()['services']
    assert [s['duration_minutes'] for s in timed]==sorted(s['duration_minutes'] for s in timed)
    assert search(api,min_price_paise=100000,max_price_paise=10000).status_code==422
    for body in ({'min_rating':6},{'min_experience':-1},{'max_duration_minutes':0}):assert search(api,**body).status_code==422
    catalog=main.catalog();disabled=catalog['services'][0];disabled['active']=False
    monkeypatch.setattr(main,'catalog',lambda:catalog)
    completions=search(api,query='nothing-matches-here').json()['suggestion_catalog']
    assert completions and disabled['name'] not in [s['label'] for s in completions]
    assert all(set(s)=={'label','category','kind'} for s in completions)


def test_professional_rating_and_experience_filters(api):
    onboard(api)
    assert search(api,location=PIN,min_rating=4).json()['professionals']==[]
    def update(u):
        w=u.get('workers','worker');w.update(rating_count=4,rating_sum=18,experience_years=5);u.put('workers','worker',w)
    main.operations_store.run(update)
    assert len(search(api,location=PIN,min_rating=4.5,min_experience=5,sort='rating').json()['professionals'])==1
    assert not search(api,location=PIN,min_rating=4.6).json()['professionals']
    assert not search(api,location=PIN,min_experience=6,sort='experience').json()['professionals']


def test_transport_type_preference_obeys_consent_decay_and_reset(api,monkeypatch):
    import uuid
    now=[int(time.time())];monkeypatch.setattr('discovery.time.time',lambda:now[0])
    base='/operations/discovery';h=auth('customer')
    assert api.get(base+'/feed').json()['preferred_transport_mode'] is None
    api.put(base+'/preferences',headers=h,json={'enabled':True,'consent_version':2})
    def emit(mode):return api.post(base+'/events',headers=h,json={'event_id':str(uuid.uuid4()),'kind':'search','category':'transport_'+mode})
    assert emit('shared').json()['recorded']
    feed=api.get(base+'/feed/personal',headers=h).json()
    assert feed['transport_interest'] and feed['preferred_transport_mode']=='shared'
    assert api.get(base+'/feed/personal',headers=auth('stranger')).json()['preferred_transport_mode'] is None
    now[0]+=61;assert emit('self_drive').json()['recorded']
    assert api.get(base+'/feed/personal',headers=h).json()['preferred_transport_mode']=='self_drive'
    assert not emit('unknown').json()['recorded']
    api.post(base+'/preferences/reset',headers=h)
    assert api.get(base+'/feed/personal',headers=h).json()['preferred_transport_mode'] is None
    now[0]+=61;emit('cab');now[0]+=31*86400
    assert api.get(base+'/feed/personal',headers=h).json()['preferred_transport_mode'] is None
    api.put(base+'/preferences',headers=h,json={'enabled':False})
    assert emit('shared').status_code==403


def test_discovery_focus_uses_recent_explicit_intent_then_decayed_strength(api, monkeypatch):
    import uuid
    now=[int(time.time())];monkeypatch.setattr('discovery.time.time',lambda:now[0])
    base='/operations/discovery';h=auth('customer')
    def feed(headers=h):return api.get(base+'/feed/personal',headers=headers).json()
    def emit(**body):
        result=api.post(base+'/events',headers=h,json={'event_id':str(uuid.uuid4()),**body})
        assert result.status_code==200 and result.json()['recorded']
        now[0]+=61
        return result.json()
    public=api.get(base+'/feed').json()
    assert public['preferred_discovery_focus'] is None and public['preferred_repair_category'] is None
    api.put(base+'/preferences',headers=h,json={'enabled':True,'consent_version':2})
    for _ in range(6):emit(kind='search',category='transport_shared')
    assert feed()['preferred_discovery_focus']=='transport'
    emit(kind='search',query='AC')
    assert feed()['preferred_discovery_focus']=='repair'
    assert feed()['preferred_repair_category']=='ac'
    assert feed(auth('stranger'))['preferred_discovery_focus'] is None
    now[0]+=3*3600
    assert feed()['preferred_discovery_focus']=='transport'
    assert emit(kind='category_view',category='transport_self_drive')['categories']==['transport','transport_self_drive']
    assert feed()['preferred_discovery_focus']=='transport'
    assert feed()['preferred_transport_mode']=='self_drive'
    stored=main.operations_store.run(lambda u:u.get('discovery_preferences','customer'))
    assert 'query' not in stored and 'location' not in stored and 'AC' not in str(stored)
    api.post(base+'/preferences/reset',headers=h)
    assert feed()['preferred_discovery_focus'] is None and feed()['preferred_repair_category'] is None
    emit(kind='search',query='AC');now[0]+=31*86400
    assert feed()['preferred_discovery_focus'] is None
    api.put(base+'/preferences',headers=h,json={'enabled':False})
    assert feed()['preferred_discovery_focus'] is None and feed()['preferred_repair_category'] is None


def test_marketplace_scope_is_explicit_account_bound_and_resettable(api, monkeypatch):
    import uuid
    now=[int(time.time())];monkeypatch.setattr('discovery.time.time',lambda:now[0])
    base='/operations/discovery';headers=auth('customer')
    def emit(mode):
        response=api.post(base+'/events',headers=headers,json={'event_id':str(uuid.uuid4()),'kind':'category_view','category':'market_'+mode})
        now[0]+=61
        return response
    def feed():return api.get(base+'/feed/personal',headers=headers).json()
    api.put(base+'/preferences',headers=headers,json={'enabled':True,'consent_version':2})
    assert emit('refurbished').status_code==403
    assert not feed()['market_personalised'] and feed()['preferred_market_mode'] is None
    assert api.put(base+'/preferences',headers=headers,json={'enabled':True,'consent_version':3}).json()['market_enabled']
    for mode in ('refurbished','preowned','rentals','sell'):
        assert emit(mode).json()['recorded']
        assert feed()['preferred_discovery_focus']=='marketplace' and feed()['preferred_market_mode']==mode
    assert emit('unknown').status_code==404
    public=api.get(base+'/feed').json()
    stranger=api.get(base+'/feed/personal',headers=auth('stranger')).json()
    assert not public['market_personalised'] and public['preferred_market_mode'] is None
    assert stranger==public
    stored=main.operations_store.run(lambda u:u.get('discovery_preferences','customer'))
    assert not {'query','location','phone','listing_id'} & stored.keys()
    assert api.post(base+'/preferences/reset',headers=headers).json()['market_enabled']
    assert feed()['preferred_market_mode'] is None
    emit('sell');now[0]+=31*86400
    assert feed()['preferred_market_mode'] is None
    api.put(base+'/preferences',headers=headers,json={'enabled':False})
    assert emit('sell').status_code==403 and not feed()['market_personalised']


def test_scope_upgrade_preserves_service_interests_and_legacy_scope_never_reads_market_history(api):
    base='/operations/discovery';headers=auth('customer')
    main.operations_store.run(lambda u:u.put('discovery_preferences','customer',dict(enabled=True,consent_version=2,recent={'category:market_sell':time.time(),'category:ac':time.time()},signals={
        'ac':dict(score=4,visits=3,at=time.time()),'market_sell':dict(score=30,visits=20,at=time.time())})))
    old=api.get(base+'/feed/personal',headers=headers).json()
    assert old['preferred_discovery_focus']=='repair' and old['preferred_market_mode'] is None
    assert old['repair_category_visits']==3
    api.put(base+'/preferences',headers=headers,json={'enabled':True,'consent_version':3})
    assert api.get(base+'/feed/personal',headers=headers).json()['repair_category_visits']==3
    api.put(base+'/preferences',headers=headers,json={'enabled':True,'consent_version':2})
    assert not api.get(base+'/preferences',headers=headers).json()['market_enabled']
    row=main.operations_store.run(lambda u:u.get('discovery_preferences','customer'))
    assert 'market_sell' not in row['signals'] and 'ac' in row['signals']
    assert 'category:market_sell' not in row['recent'] and 'category:ac' in row['recent']


def test_category_discovery_isolates_agents_and_specialists_and_keeps_booking_fields_private(api):
    onboard(api)
    def specialists(u):
        worker=u.get('workers','worker')
        u.put('workers','specialist',{**worker,'id':'specialist','name':'Fixture specialist','role':'specialist'})
        u.put('workers','plumber-only',{**worker,'id':'plumber-only','name':'Fixture plumber','categories':['plumber']})
    main.operations_store.run(specialists)
    agents=search(api,location=PIN,category='ac',role='technician').json()
    specialists=search(api,location=PIN,category='ac',role='specialist').json()
    assert [p['id'] for p in agents['professionals']]==['worker']
    assert [p['id'] for p in specialists['professionals']]==['specialist']
    assert all(s['category']=='ac' for s in agents['services'])
    assert all(not {'phone','position','home_address','bank_account'} & p.keys() for p in agents['professionals']+specialists['professionals'])
