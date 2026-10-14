"""Disposable home integration store. No production accounts or credentials are used."""
import os, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
os.environ.update(REPAIDO_STORAGE='sqlite', REPAIDO_DB=sys.argv[1], REPAIDO_ADMIN_KEY='test-operator-key')
import main, uvicorn
from fastapi import Header, HTTPException
from fastapi.testclient import TestClient
from test_operations import onboard, auth, PIN
from test_procurement import setup_shop, STOCK
from test_rentals import LISTING
from test_marketplace import draft
from test_shop_prime import REFURB

def actor(authorization: str = Header(default='')):
    uid = authorization.removeprefix('Bearer ')
    if uid not in ('customer', 'stranger', 'worker', 'worker2', 'shop'): raise HTTPException(401)
    return dict(id=uid, name=uid, email=uid+'@elastic.fixture', phone='+919876543210', phone_verified=True, phone_authenticated=True)

main.app.dependency_overrides[main.current_user] = actor
with TestClient(main.app) as api:
    onboard(api); onboard(api, 'worker2')
    setup_shop(api)
    def profiles(u):
        technician=u.get('workers','worker'); technician.update(name='Asha repair agent', skills=['AC diagnostics', 'Appliance service']); u.put('workers','worker',technician)
        specialist=u.get('workers','worker2'); specialist.update(name='Ravi AC specialist', role='specialist', skills=['AC diagnostics', 'Cooling systems']); u.put('workers','worker2',specialist)
        u.put('workers','plumber-fixture',{**technician,'id':'plumber-fixture','name':'Priya plumbing agent','categories':['plumber'],'skills':['Tap and pipe repairs']})
        shop=u.get('shops','shop1'); shop.update(name='Elastic fixture shop', city='Balasore'); u.put('shops','shop1',shop)
    main.operations_store.run(profiles)
    response=api.put('/operations/shop/inventory/elastic-refurb',headers=auth('shop'),json={**STOCK,'name':'Refurbished desk fan','sku':'REFURB-01','category':'Appliances','condition':'refurbished','warranty':'30-day shop warranty','refurbishment':REFURB,'price_paise':180000,'on_hand':2}); assert response.status_code==200,response.text
    response=api.put('/operations/shop/rental-inventory/elastic-drill',headers=auth('shop'),json={**LISTING,'name':'Elastic drill kit'}); assert response.status_code==200,response.text
    item,_=draft(api,'worker',mode='second_hand',trial=True,name='Elastic used phone'); assert item['status']=='published',item
uvicorn.run(main.app,host='127.0.0.1',port=int(sys.argv[2]))
