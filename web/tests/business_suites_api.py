"""Disposable SQLite fixtures; never contacts real storage, payments or routing."""
import os,sys,time,uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'backend'))
os.environ.update(REPAIDO_STORAGE='sqlite',REPAIDO_DB=sys.argv[1],REPAIDO_ADMIN_KEY='test-operator-key',REPAIDO_KYC_BUCKET='test-only')
import main,local_business,mobility_journeys,uvicorn
from fastapi import Header,HTTPException
from fastapi.testclient import TestClient
from test_operations import onboard,PIN,auth
from test_local_business import vehicle,doc,approve,quote,request,act,register
from test_business_profiles import apply
BASE='/operations/local-business'
def actor(authorization:str=Header(default='')):
    uid=authorization.removeprefix('Bearer ')
    if uid not in ('customer','worker','worker2','shop'):raise HTTPException(401)
    return dict(id=uid,name=uid,email=uid+'@example.test',phone='+919876543210',phone_verified=True,phone_authenticated=True)
main.app.dependency_overrides[main.current_user]=actor
local_business.route_metres=lambda a,b:10000
mobility_journeys.road_route=lambda a,b:{'points':[a,b],'distance_metres':11132}
photos={};local_business.upload_object=lambda key,data:photos.update({key:data});local_business.download_object=lambda key:photos.get(key,b'fixture')
with TestClient(main.app) as api:
    onboard(api);owner_vehicle=vehicle(api,'worker',mode='both');driver_vehicle=vehicle(api,'worker2')
    for role in ('driver','scrap_owner'):
        row=apply(api,role).json();approve(api,'partner',row['id'])
    register(api,'shop','driver')
    assert api.put(BASE+'/vehicles/'+owner_vehicle+'/driver',headers=auth('worker'),json=dict(driver_id='shop')).status_code==200
    assert api.post(BASE+'/driver-invitations/'+owner_vehicle,headers=auth('shop'),json=dict(accept=True)).status_code==200
    pending=apply(api,'scrap_owner',uid='worker2');assert pending.status_code==200
    assert api.put(BASE+'/vehicles/'+driver_vehicle+'/driver',headers=auth('worker2'),json=dict(driver_id='worker')).status_code==200
    assert api.post(BASE+'/driver-invitations/'+driver_vehicle,headers=auth('worker'),json=dict(accept=True)).status_code==200
    cab,_=request(api,[quote(api,owner_vehicle)])
    driven,_=request(api,[quote(api,driver_vehicle)]);driven=act(api,driven,'accept','worker2')
    rental_quote=quote(api,owner_vehicle,mode='rental',starts_at=time.time()+2*86400,ends_at=time.time()+3*86400)
    rental,_=request(api,[rental_quote],license_document_id=doc('customer'));rental=act(api,rental,'accept','worker')
    scrap_body=dict(material='metal',description='Fixture clean household steel scrap',estimated_kg=10,location=PIN,address='Fixture collection address 123',city='Balasore',starts_at=time.time()+7200,phone='9876543210',request_id=str(uuid.uuid4()))
    scrap=api.post(BASE+'/scrap',headers=auth('customer'),json=scrap_body);assert scrap.status_code==201,scrap.text
    def seed(u):
        w=u.get('workers','worker');w['contractor_verified']=True;u.put('workers','worker',w)
        r=u.get('mobility_rides',driven['id']);r.update(state='reserved',advance_paid_paise=50000);u.put('mobility_rides',r['id'],r)
    main.operations_store.run(seed)
uvicorn.run(main.app,host='127.0.0.1',port=int(sys.argv[2]))
