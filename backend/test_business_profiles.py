"""Independent business memberships under the same verified phone identity."""
import time,uuid
import main,local_business
from test_operations import api,auth,onboard,PIN,ADMIN
from test_local_business import doc,approve,vehicle,quote,act,route,register
BASE='/operations/local-business'
def apply(api,role,uid='worker',**changes):
    body=dict(name='Fixture '+role,role=role,city='Balasore',address='Fixture private business base 123',location=PIN,document_ids=[doc(uid)],terms=True,expected_version=0);body.update(changes)
    return api.put(BASE+'/partner',headers=auth(uid),json=body)
def profile(api,role,uid='worker'):
    response=api.get(BASE+'/partner?role='+role,headers=auth(uid));assert response.status_code==200,response.text;return response.json()
def test_contractor_adds_independently_reviewed_profiles(api):
    onboard(api)
    def contractor(u):
        w=u.get('workers','worker');w['contractor_verified']=True;u.put('workers','worker',w)
    main.operations_store.run(contractor);before=api.get('/operations/worker/me',headers=auth('worker')).json()['worker'];ids=[]
    for role in local_business.BUSINESS_ROLES:
        response=apply(api,role);assert response.status_code==200,response.text
        row=response.json();assert row['user_id']=='worker' and row['status']=='pending';ids.append(row['id']);approve(api,'partner',row['id'])
    assert len(set(ids))==3
    me=api.get('/operations/worker/me',headers=auth('worker')).json()
    assert me['worker']==before and me['registered_role']=='contractor' and set(me['registered_roles'])=={'contractor','cab_owner','driver','scrap_owner'}
    for role in local_business.BUSINESS_ROLES:
        result=profile(api,role);assert result['partner']['role']==role and result['partner']['status']=='approved' and len(result['profiles'])==3
        assert profile(api,role,'worker2')['partner'] is None

def test_pending_scrap_never_inherits_cab_approval_and_routing_uses_auth_uid(api,route):
    vid=vehicle(api);response=apply(api,'scrap_owner');assert response.status_code==200,response.text
    application=response.json();assert application['id']=='worker:scrap_owner'
    assert quote(api,vid)['vehicle']['owner_name']=='Test owner'
    assert profile(api,'scrap_owner')['partner']['status']=='pending' and profile(api,'cab_owner')['partner']['status']=='approved'
    assert profile(api,'scrap_owner')['vehicles']==[] and profile(api,'driver')['vehicles']==[]
    body=dict(material='metal',description='Fixture household metal scrap',estimated_kg=10,location=PIN,address='Fixture private collection address',city='Balasore',starts_at=time.time()+7200,phone='9876543210',request_id=str(uuid.uuid4()))
    assert api.post(BASE+'/scrap',headers=auth('customer'),json=body).status_code==409
    approve(api,'partner',application['id']);r=api.post(BASE+'/scrap',headers=auth('customer'),json=body);assert r.status_code==201,r.text
    row=r.json();candidate=api.get(BASE+'/scrap',headers=auth('worker')).json()['collections'][0]
    assert candidate['id']==row['id'] and 'address' not in candidate and 'location' not in candidate
    accepted=act(api,row,'accept','worker','scrap');assert accepted['owner_id']=='worker' and accepted['buyer_name']=='Fixture scrap_owner'
    assert 'Scrap collection requested' in str(api.get('/operations/notifications',headers=auth('worker')).json())
    assert api.get(BASE+'/scrap',headers=auth('worker2')).json()['collections']==[]

def test_scrap_first_then_cab_uses_its_own_profile_and_expiry(api,route):
    register(api,role='scrap_owner');row=apply(api,'cab_owner').json();approve(api,'partner',row['id'])
    vid=str(uuid.uuid4());data=dict(name='Fixture sedan',registration='OD01AB1234',mode='both',seats=4,transmission='manual',fuel='petrol',location=PIN,origin_address='Fixture vehicle pickup address',base_paise=0,per_km_paise=5000,daily_paise=150000,terms='Fixture rental and cab conditions.',document_ids=[doc('worker')],active=True)
    r=api.put(BASE+'/vehicles/'+vid,headers=auth('worker'),json=data);assert r.status_code==200,r.text;approve(api,'vehicle',vid)
    assert quote(api,vid)['vehicle']['owner_name']=='Fixture cab_owner'
    def expire(u):
        p=u.get('business_partners',row['id']);p['valid_until']=time.time()-1;u.put('business_partners',row['id'],p)
        assert local_business.current(u,'worker',('scrap_owner',))['id']=='worker'
    main.operations_store.run(expire)
    body=dict(pickup=PIN,starts_at=time.time()+7200,ends_at=time.time()+18000,mode='cab')
    assert api.post(BASE+'/vehicles/search',json=body).json()['vehicles']==[] and profile(api,'scrap_owner')['vehicles']==[]

def test_documents_versions_and_phone_cannot_cross_businesses(api):
    owner=apply(api,'cab_owner').json();approve(api,'partner',owner['id'])
    assert apply(api,'driver',expected_version=owner['version']).status_code==409
    assert apply(api,'driver',document_ids=[doc('worker2')]).status_code==422
    assert apply(api,'driver',uid='customer').status_code==403
    assert api.get(BASE+'/partner?role=driver',headers=auth('customer')).status_code==403
    assert profile(api,'cab_owner')['partner']['status']=='approved' and profile(api,'driver')['partner'] is None
    assert apply(api,'driver').status_code==200
    reviews=api.get(BASE+'/admin/reviews',headers=ADMIN).json()['partners'];assert len(reviews)==1 and reviews[0]['role']=='driver' and reviews[0]['user_id']=='worker'

def test_collectors_decline_without_cancelling_other_buyers_and_customer_gets_result(api):
    register(api,role='scrap_owner');register(api,'worker2','scrap_owner')
    body=dict(material='metal',description='Fixture steel scrap for collection',estimated_kg=10,location=PIN,address='Fixture private collection address',city='Balasore',starts_at=time.time()+7200,phone='9876543210',request_id=str(uuid.uuid4()))
    r=api.post(BASE+'/scrap',headers=auth('customer'),json=body);assert r.status_code==201,r.text
    row=r.json();command=dict(action='decline',expected_version=row['version'],command_id=str(uuid.uuid4()))
    r=api.post(BASE+'/scrap/'+row['id']+'/commands',headers=auth('worker'),json=command);assert r.status_code==200,r.text
    assert r.json()['state']=='requested' and api.get(BASE+'/scrap',headers=auth('worker')).json()['collections']==[]
    assert len(api.get(BASE+'/scrap',headers=auth('worker2')).json()['collections'])==1
    command.update(expected_version=r.json()['version'],command_id=str(uuid.uuid4()))
    r=api.post(BASE+'/scrap/'+row['id']+'/commands',headers=auth('worker2'),json=command);assert r.status_code==200,r.text
    assert r.json()['state']=='expired'
    assert 'No collector accepted' in str(api.get('/operations/notifications',headers=auth('customer')).json())

def fleet_vehicle(api,first,**changes):
    from local_business import Vehicle
    existing=next(v for v in profile(api,'cab_owner')['vehicles'] if v['id']==first)
    data={k:existing[k] for k in Vehicle.model_fields if k in existing};data.update(expected_version=0,registration='OD02CD9876',**changes)
    identifier=str(uuid.uuid4());r=api.put(BASE+'/vehicles/'+identifier,headers=auth('worker'),json=data);assert r.status_code==200,r.text;approve(api,'vehicle',identifier);return identifier

def assign(api,vid,driver):
    assert api.put(BASE+'/vehicles/'+vid+'/driver',headers=auth('worker'),json=dict(driver_id=driver)).status_code==200
    response=api.post(BASE+'/driver-invitations/'+vid,headers=auth(driver),json=dict(accept=True));assert response.status_code==200,response.text

def test_fleet_rental_only_reserves_its_vehicle_not_the_owner_or_a_driver(api,route):
    from test_local_business import request
    first=vehicle(api,mode='both');second=fleet_vehicle(api,first);third=fleet_vehicle(api,first)
    register(api,'worker2','driver');assign(api,first,'worker2')
    q=quote(api,first,mode='rental');rental,_=request(api,[q],license_document_id=doc('customer'));rental=act(api,rental,'accept','worker')
    assert rental['driver_id'] is None and api.get(BASE+'/rides',headers=auth('worker2')).json()['rides']==[]
    cabquote=quote(api,second,starts_at=q['starts_at'],ends_at=q['ends_at']);cab,_=request(api,[cabquote]);cab=act(api,cab,'accept','worker')
    assert rental['owner_id']==cab['owner_id']=='worker'
    scope=dict(pickup=PIN,starts_at=q['starts_at'],ends_at=q['ends_at'],mode='cab')
    assert api.post(BASE+'/vehicles/search',json=scope).json()['vehicles']==[]
    # The same car remains reserved, and another owner-driven cab would double-book the owner.
    assert api.post(BASE+'/quotes',headers=auth('customer'),json={**scope,'vehicle_id':third,'dropoff':PIN}).status_code==409
    assert api.post(BASE+'/quotes',headers=auth('customer'),json={**scope,'mode':'rental','vehicle_id':first,'dropoff':PIN}).status_code==409

def test_fleet_distinct_drivers_can_work_concurrently_but_one_driver_cannot(api,route):
    from test_local_business import request
    from concurrent.futures import ThreadPoolExecutor
    first=vehicle(api);second=fleet_vehicle(api,first);third=fleet_vehicle(api,first)
    register(api,'worker2','driver');register(api,'shop','driver');assign(api,first,'worker2');assign(api,second,'shop');assign(api,third,'worker2')
    q1=quote(api,first);q2=quote(api,second,starts_at=q1['starts_at'],ends_at=q1['ends_at'])
    a,_=request(api,[q1]);b,_=request(api,[q2])
    def accept(row):return api.post(BASE+'/rides/'+row['id']+'/commands',headers=auth('worker'),json=dict(action='accept',expected_version=row['version'],command_id=str(uuid.uuid4())))
    with ThreadPoolExecutor(max_workers=2) as pool:responses=list(pool.map(accept,[a,b]))
    assert [r.status_code for r in responses]==[200,200]
    assert {r.json()['driver_id'] for r in responses}=={'worker2','shop'}
    scope=dict(pickup=PIN,dropoff=PIN,starts_at=q1['starts_at'],ends_at=q1['ends_at'],mode='cab',vehicle_id=third)
    assert api.post(BASE+'/quotes',headers=auth('customer'),json=scope).status_code==409

def test_driver_can_join_free_fleet_vehicle_while_other_vehicle_is_booked(api,route):
    from test_local_business import request
    first=vehicle(api);second=fleet_vehicle(api,first)
    q=quote(api,first);row,_=request(api,[q]);act(api,row,'accept','worker')
    register(api,'worker2','driver');assign(api,second,'worker2')
    assert quote(api,second,starts_at=q['starts_at'],ends_at=q['ends_at'])['vehicle_id']==second

def test_owner_driver_also_assigned_to_another_owner_cannot_double_book(api,route):
    from test_local_business import request
    first=vehicle(api);other=vehicle(api,'worker2')
    membership=apply(api,'driver').json();approve(api,'partner',membership['id'])
    assert api.put(BASE+'/vehicles/'+other+'/driver',headers=auth('worker2'),json=dict(driver_id='worker')).status_code==200
    assert api.post(BASE+'/driver-invitations/'+other,headers=auth('worker'),json=dict(accept=True)).status_code==200
    q=quote(api,other);row,_=request(api,[q]);act(api,row,'accept','worker2')
    scope=dict(pickup=PIN,dropoff=PIN,starts_at=q['starts_at'],ends_at=q['ends_at'],mode='cab',vehicle_id=first)
    assert api.post(BASE+'/quotes',headers=auth('customer'),json=scope).status_code==409

def test_assigned_driver_sees_only_winning_quote_and_no_owner_transfer_details(api,route):
    from test_local_business import request
    first=vehicle(api);other=vehicle(api,'worker2');register(api,'shop','driver');assign(api,first,'shop')
    a=quote(api,first);b=quote(api,other,starts_at=a['starts_at'],ends_at=a['ends_at']);row,_=request(api,[a,b]);row=act(api,row,'accept','worker')
    def private_transfer(u):
        record=u.get('mobility_rides',row['id']);record['settlement']={'reference':'fixture-private-owner-transfer','amount_paise':50000};u.put('mobility_rides',row['id'],record)
    main.operations_store.run(private_transfer)
    driver=api.get(BASE+'/rides',headers=auth('shop')).json()['rides'][0]
    assert len(driver['quotes'])==1 and driver['quotes'][0]['owner_id']=='worker' and 'settlement' not in driver
    owner=api.get(BASE+'/rides',headers=auth('worker')).json()['rides'][0];assert owner['settlement']['reference']=='fixture-private-owner-transfer'
