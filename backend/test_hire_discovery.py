"""Public leaderboards never reveal private locations or invent review scores."""
import json,time,uuid
import main,hiring
from test_operations import api,onboard,auth,PIN
from test_hiring_records import setup_hire
from test_home_plans import setup_worker,request

def browse(api,**values):
    r=api.post('/operations/hiring/leaderboard',json={'city':'Balasore',**values});assert r.status_code==200,r.text;return r.json()

def seed_reviews(u,worker,ratings,category='ac'):
    for rating in ratings:
        jid=str(uuid.uuid4());u.put('jobs',jid,dict(id=jid,worker_id=worker,customer_id='private-customer',category=category,service_id='ac-service',service_name='AC care',state='completed',completed_at=time.time(),location=PIN,address='NEVER PUBLIC',phone='9876543210',review=dict(rating=rating,text='Real fixture feedback, call 9876543210 or me@example.test',created_at=time.time())))

def test_genuine_ranking_privacy_and_membership(api,monkeypatch):
    monkeypatch.setattr(hiring,'free_listing',lambda:False)
    import hire_discovery
    monkeypatch.setattr(hire_discovery,'free_listing',lambda:False)
    p=setup_hire(api,monkeypatch);onboard(api,'worker2')
    def seed(u):
        u.put('hire_memberships','worker2',dict(id='worker2',status='active',expires_at=time.time()+86400,policy_version=p['version'],radius_km=6))
        seed_reviews(u,'worker',[5]);seed_reviews(u,'worker2',[4]*10)
        u.put('worker_profiles','worker',{'bio':'Call +91 98765 43210 or me@example.test','languages':['Odia'],'specialties':['AC cleaning']})
    main.operations_store.run(seed)
    r=browse(api,category='ac');assert [p['id'] for p in r['professionals']]==['worker2','worker']
    assert [p['rank'] for p in r['professionals']]==[1,2]
    assert r['professionals'][0]['rating']==4 and r['professionals'][1]['rating']==5
    assert next(c for c in r['categories'] if c['id']=='ac')['leader']['id']=='worker2'
    encoded=json.dumps(r)
    assert '98765' not in encoded and 'me@example.test' not in encoded and 'NEVER PUBLIC' not in encoded and 'private-customer' not in encoded
    for row in r['professionals']:
        assert not {'city','radius_km','location','phone','home_address','dob','position','bank','email','distance_km'}&row.keys()
    assert browse(api,category='ac',sort='rating')['professionals'][0]['id']=='worker'
    assert [p['id'] for p in browse(api,min_rating=4.5)['professionals']]==['worker']
    assert [p['id'] for p in browse(api,language='Odia',query='cleaning')['professionals']]==['worker']
    assert [p['id'] for p in browse(api,min_completed=5)['professionals']]==['worker2']
    def refund(u):
        m=u.get('hire_memberships','worker2');m['status']='refunded';u.put('hire_memberships','worker2',m)
    main.operations_store.run(refund)
    assert len(browse(api)['professionals'])==1

def test_unreviewed_coverage_filters_availability_and_policy(api,monkeypatch):
    monkeypatch.setattr(hiring,'free_listing',lambda:False)
    import hire_discovery
    monkeypatch.setattr(hire_discovery,'free_listing',lambda:False)
    setup_hire(api,monkeypatch)
    row=browse(api)['professionals'][0];assert row['rating'] is None and row['rank'] is None and row['review_count']==0
    assert not browse(api,min_rating=4)['professionals']
    assert not browse(api,role='specialist')['professionals']
    assert not browse(api,location={**PIN,'lat':PIN['lat']+.2},radius_km=6)['professionals']
    def relocate(u):
        w=u.get('workers','worker');w['location']={**PIN,'lat':PIN['lat']+.029};w['online']=False;u.put('workers','worker',w)
    main.operations_store.run(relocate)
    assert not browse(api,location=PIN,radius_km=3)['professionals']
    assert len(browse(api,location=PIN,radius_km=3,allow_buffer=True)['professionals'])==1
    assert not browse(api,available_only=True)['professionals']
    assert api.post('/operations/hiring/leaderboard',json={'city':'Balasore','radius_km':0}).status_code==422
    assert api.post('/operations/hiring/leaderboard',json={'city':'Balasore','category':'unlisted'}).status_code==422
    def stale_policy(u):
        m=u.get('hire_memberships','worker');m['policy_version']='old';u.put('hire_memberships','worker',m)
    main.operations_store.run(stale_policy)
    assert not browse(api)['professionals']

def test_reviewed_home_preference_is_preserved_without_auto_assignment(api):
    setup_worker(api)
    def member(u):u.put('hire_memberships','worker',dict(id='worker',status='active',expires_at=time.time()+86400,policy_version=hiring.DEFAULT['version'],radius_km=6))
    main.operations_store.run(member)
    r=browse(api,category='home:maid');assert r['professionals'][0]['home_services']==['maid','caretaker','renovation']
    p,b=request(api,preferred_worker_id='worker');assert p['preferred_worker_id']=='worker' and p['preferred_worker_name']=='Test professional'
    assert p['state']=='requested' and not p.get('worker_id')
    b.update(preferred_worker_id='unreviewed',request_id=str(uuid.uuid4()))
    assert api.post('/operations/home/plans',headers=auth('customer'),json=b).status_code==422

def test_strict_nearby_radius_no_city_fallback_and_contractors(api,monkeypatch):
    setup_hire(api,monkeypatch)
    for values in ({'strict_nearby':True},{'strict_nearby':True,'location':PIN,'radius_km':11},{'strict_nearby':True,'location':PIN,'radius_km':10,'allow_buffer':True}):
        assert api.post('/operations/hiring/leaderboard',json={'city':'Balasore',**values}).status_code==422
    def move(delta,city='Bhadrak'):
        def change(u):
            w=u.get('workers','worker');w.update(location={**PIN,'lat':PIN['lat']+delta},city=city,radius_km=20,contractor_verified=True);u.put('workers','worker',w)
            m=u.get('hire_memberships','worker') or {};m['radius_km']=20;u.put('hire_memberships','worker',m)
        main.operations_store.run(change)
    move(.081) # About nine kilometres, across a city label boundary.
    assert not browse(api,strict_nearby=True,location=PIN,radius_km=8)['professionals']
    row=browse(api,strict_nearby=True,location=PIN,radius_km=10,role='contractor')['professionals'][0]
    assert 8<row['distance_km']<10 and row['contractor_verified'] and row['service_packages']
    assert not {'location','position','home_address','phone'}&row.keys()
    move(.1) # More than ten kilometres; never expands automatically.
    assert not browse(api,strict_nearby=True,location=PIN,radius_km=10)['professionals']
    main.operations_store.run(lambda u:u.put('workers','worker',{**u.get('workers','worker'),'location':None}))
    assert not browse(api,strict_nearby=True,location=PIN,radius_km=10)['professionals']
