"""Isolated cleanup browser fixture. No production storage, payment or authority calls."""
import os,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'backend'))
os.environ.update(REPAIDO_STORAGE='sqlite',REPAIDO_DB=sys.argv[1],REPAIDO_ADMIN_KEY='test-operator-key',REPAIDO_KYC_BUCKET='test-only')
import main,local_business,cleanup,captain_rewards,uvicorn
from fastapi import Header,HTTPException
from fastapi.testclient import TestClient
from test_local_business import register
objects={}
local_business.upload_object=lambda key,data:objects.__setitem__(key,data)
local_business.download_object=lambda key:objects[key]
cleanup.download_object=lambda key:objects[key]
captain_rewards.download_object=lambda key:objects[key]
def actor(authorization:str=Header(default='')):
    uid=authorization.removeprefix('Bearer ')
    if uid not in ('customer','worker','worker2','admin'):raise HTTPException(401)
    return {'id':uid,'phone_verified':True,'name':uid,'phone':'+919876543210'}
main.app.dependency_overrides[main.current_user]=actor
with TestClient(main.app) as api:register(api,'worker','scrap_owner')
@main.app.post('/fixture/gold')
def gold():
    import time
    def save(u):
        for i in range(10):u.put('cleanup_points','captain-fixture-'+str(i),{'id':'captain-fixture-'+str(i),'user_id':'customer','points':10,'created_at':time.time()})
    main.operations_store.run(save)
    return {'ok':True}
@main.app.post('/fixture/ecosystem')
def ecosystem():
    import time,uuid
    from test_scrap_rewards_ecosystem import receipt_ready,confirm
    from test_local_business import pickup_photo
    now=time.time()
    def gold_seed(u):
        for uid,points in [('customer',90),('worker',190)]:
            u.put('cleanup_points','existing-'+uid,dict(id='existing-'+uid,user_id=uid,points=points,created_at=now-86400))
    main.operations_store.run(gold_seed)
    client=TestClient(main.app)
    row=receipt_ready(client);completed,_=confirm(client,row)
    identifier=str(uuid.uuid4());photo=pickup_photo('customer',identifier)
    active={**row,'id':identifier,'state':'accepted','version':1,'travel_phase':'confirmed','tracking_consent':False,'evaluation':None,'agreed_paise':None,'payment_source':None,'photo_document_id':photo}
    def seed(u):
        proof=u.get('business_documents',photo);proof['claimed_by']=identifier;u.put('business_documents',photo,proof)
        u.put('scrap_collections',identifier,active)
        local_business.inbox(u,'scrap',u.get('scrap_collections',completed['id']));local_business.inbox(u,'scrap',active)
    main.operations_store.run(seed)
    return {'completed_id':row['id'],'active_id':identifier}

uvicorn.run(main.app,host='127.0.0.1',port=int(sys.argv[2]))
