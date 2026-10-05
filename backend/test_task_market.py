import time
import main
from test_operations import api,auth,PIN
from test_procurement import setup_shop,visit
from test_rentals import LISTING

def test_task_market_scope_radius_and_stock(api):
    setup_shop(api);j=visit(api)
    assert api.put('/operations/shop/rental-inventory/drill',headers=auth('shop'),json=LISTING).status_code==200
    url=f"/operations/jobs/{j['id']}/market"
    for who in ('stranger','worker2','customer','shop'):
        assert api.get(url,headers=auth(who)).status_code==404
    assert api.get(url+'?radius_km=9',headers=auth('worker')).status_code==422
    d=api.get(url,headers=auth('worker')).json()
    assert len(d['items'])==len(d['rentals'])==1 and d['shop_count']==1
    assert d['distance_basis']=='work_location' and d['radius_km']==6
    assert d['items'][0]['distance_km']<1
    def move(u):
        s=u.get('shops','shop1');s['location']={**PIN,'lat':PIN['lat']+.063};u.put('shops','shop1',s)
    main.operations_store.run(move)
    assert api.get(url,headers=auth('worker')).json()['items']==[]
    d=api.get(url+'?radius_km=8',headers=auth('worker')).json()
    assert len(d['items'])==len(d['rentals'])==1
    def unavailable(u):
        p=u.get('inventory','cap35');p['stock_confirmed_at']=time.time()-90000;u.put('inventory','cap35',p)
        r=u.get('rental_inventory','drill');r['reserved']=r['total_units'];u.put('rental_inventory','drill',r)
    main.operations_store.run(unavailable)
    d=api.get(url+'?radius_km=8',headers=auth('worker')).json()
    assert d['items']==d['rentals']==[]
