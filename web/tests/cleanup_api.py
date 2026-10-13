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
uvicorn.run(main.app,host='127.0.0.1',port=int(sys.argv[2]))
