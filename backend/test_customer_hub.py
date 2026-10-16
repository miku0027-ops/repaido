import main
from test_operations import api,auth
from test_housing import create,approve

def test_saved_home_price_drop_unavailable_account_isolation(api):
    row,_=create(api);row=approve(api,row)
    saved=api.post('/operations/customer-hub/saved',headers=auth('worker2'),json={'kind':'home','reference':row['id'],'label':row['title']})
    assert saved.status_code==200,saved.text
    assert api.get('/operations/customer-hub/saved',headers=auth('customer')).json()['items']==[]
    def cheaper(u):
        home=u.get('home_listings',row['id']);home['rent_paise']-=10000;u.put('home_listings',home['id'],home)
    main.operations_store.run(cheaper)
    item=api.get('/operations/customer-hub/saved',headers=auth('worker2')).json()['items'][0]
    assert item['price_drop_paise']==10000 and item['available']
    api.post('/operations/homes/listings/'+row['id']+'/state',headers=auth('worker'),json={'expected_version':row['version'],'state':'let'})
    item=api.get('/operations/customer-hub/saved',headers=auth('worker2')).json()['items'][0]
    assert not item['available'] and item['home'] is None
    api.delete('/operations/customer-hub/saved/'+saved.json()['id'],headers=auth('customer'))
    assert len(api.get('/operations/customer-hub/saved',headers=auth('worker2')).json()['items'])==1

def test_activity_account_privacy(api):
    main.operations_store.run(lambda u:u.put('jobs','private-job',{'id':'private-job','customer_id':'worker','service_name':'Private job','state':'requested','address':'Private address'}))
    def related(u):
        u.put('community_contributions','mission-private',{'id':'mission-private','user_id':'worker','mission':{'title':'Neighbourhood reuse'},'state':'submitted','document_ids':['private-photo']})
        u.put('retail_resolution_cases','return-private',{'id':'return-private','customer_id':'worker','state':'review','reason':'Private dispute text'})
    main.operations_store.run(related)
    assert api.get('/operations/customer-hub/activity',headers=auth('customer')).json()['items']==[]
    result=api.get('/operations/customer-hub/activity',headers=auth('worker'))
    assert result.status_code==200,result.text
    assert result.json()['items'][0]['title']=='Private job'
    assert 'address' not in result.json()['items'][0]
    by_kind={row['kind']:row for row in result.json()['items']}
    assert by_kind['community_contributions']['title']=='Neighbourhood reuse'
    assert by_kind['retail_resolution_cases']['destination']=='purchases'
    assert 'document_ids' not in by_kind['community_contributions']
    assert 'reason' not in by_kind['retail_resolution_cases']

def test_saved_search_matching_and_limit(api):
    row,_=create(api);row=approve(api,row)
    for n in range(5):
        assert api.post('/operations/customer-hub/saved',headers=auth('customer'),json={'kind':'home_search','label':str(n),'city':'Balasore','bedrooms':2}).status_code==200
    result=api.get('/operations/customer-hub/saved',headers=auth('customer')).json()['items']
    assert len(result)==5 and result[0]['matches'][0]['id']==row['id']
    assert api.post('/operations/customer-hub/saved',headers=auth('customer'),json={'kind':'home_search','label':'sixth'}).status_code==409

def test_follow_product_compatibility_and_reorder_use_current_truth(api):
    from test_shop_discovery import seed,order
    seed();order()
    for kind,reference in [('shop','s1'),('product','wire')]:
        response=api.post('/operations/customer-hub/saved',headers=auth('customer'),json={'kind':kind,'reference':reference,'label':'User supplied title'})
        assert response.status_code==200,response.text
        status=api.get('/operations/customer-hub/saved/status',headers=auth('customer'),params={'kind':kind,'reference':reference}).json()
        assert status['id']==response.json()['id']
    def declare(u):
        row=u.get('inventory','wire');row['compatibility']='ACME X200 model only';u.put('inventory','wire',row)
    main.operations_store.run(declare)
    data=api.get('/operations/customer-hub/compatibility?category=electrical&model=ACME%20X200').json()
    assert not data['verified_compatibility'] and len(data['items'])==1
    assert api.get('/operations/customer-hub/compatibility?category=electrical&model=X20').json()['items']==[]
    reorder=api.get('/operations/retail/orders/receipt/reorder',headers=auth('customer'))
    assert reorder.status_code==200,reorder.text
    assert reorder.json()['items'][0]['price_paise']==9500
    assert api.get('/operations/retail/orders/receipt/reorder',headers=auth('stranger')).status_code==404
    def hide(u):
        row=u.get('shops','s1');row['status']='suspended';u.put('shops','s1',row)
    main.operations_store.run(hide)
    assert api.get('/operations/customer-hub/compatibility?category=electrical&model=ACME%20X200').json()['items']==[]
    data=api.get('/operations/customer-hub/saved',headers=auth('customer')).json()['items']
    assert all(not x['available'] for x in data)
