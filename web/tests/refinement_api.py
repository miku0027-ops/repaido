"""Isolated local browser API. No production credentials, routes or payment calls."""
import os,sys,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'backend'))
os.environ.update(REPAIDO_STORAGE='sqlite',REPAIDO_DB=sys.argv[1],REPAIDO_ADMIN_KEY='test-operator-key',REPAIDO_KYC_BUCKET='test-only')
import main,local_business,mobility_journeys,pytest,uvicorn
from fastapi import Header,HTTPException
from fastapi.testclient import TestClient
from test_operations import onboard,book,command,PIN
from test_hiring_records import setup_hire
from test_local_business import vehicle,register

def actor(authorization:str=Header(default='')):
    uid=authorization.removeprefix('Bearer ')
    if uid not in ('customer','worker','worker2','shop'):raise HTTPException(401)
    return dict(id=uid,name=uid,email=uid+'@example.test',phone='+919876543210',phone_verified=True,phone_authenticated=True)
main.app.dependency_overrides[main.current_user]=actor
patch=pytest.MonkeyPatch();local_business.route_metres=lambda a,b:10000
mobility_journeys.road_route=lambda a,b:{'points':[a,b],'distance_metres':11132}
photos={}
local_business.upload_object=lambda key,data:photos.update({key:data})
local_business.download_object=lambda key:photos[key]
with TestClient(main.app) as api:
    setup_hire(api,patch)
    vehicle(api,'worker2',mode='both')
    register(api,'shop','scrap_owner')
    j,_=book(api);j=command(api,j,'accept');j=command(api,j,'ack_reminder');j=command(api,j,'depart')
    def seed(u):
        j['id']='tracking-fixture';j['state']='en_route';j['tracking_consent']=True;j['position']={**PIN,'lat':PIN['lat']+.002,'accuracy':5,'captured_at':time.time(),'received_at':time.time()};j['worker_name']='Fixture technician';u.put('jobs',j['id'],j)
        w=u.get('workers','worker');w.update(name='Fixture technician',rating_count=1,rating_sum=5,completed_tasks=1);u.put('workers','worker',w)
        u.put('worker_profiles','worker',dict(bio='Fixture professional with verified task records.',languages=['Odia','Hindi'],specialties=['AC inspection']))
        done={**j,'id':'completed-fixture','state':'completed','completed_at':time.time()-3*86400,'review':dict(rating=5,text='Fixture verified review of completed work.',at=time.time()-3*86400,dimensions=dict(behavior=5,work_quality=4,skills=5))}
        u.put('jobs',done['id'],done)
    main.operations_store.run(seed)
@main.app.post('/test-only/position')
def move():
    def save(u):
        row=u.get('jobs','tracking-fixture');row['position'].update(lat=PIN['lat']+.003,captured_at=time.time(),received_at=time.time());u.put('jobs',row['id'],row)
    main.operations_store.run(save);return {'ok':True}
uvicorn.run(main.app,host='127.0.0.1',port=int(sys.argv[2]))
