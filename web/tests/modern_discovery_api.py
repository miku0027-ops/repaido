"""Disposable browser integration store; media provider and route calls are fixtures."""
import os,sys,time,uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'backend'))
os.environ.update(REPAIDO_STORAGE='sqlite',REPAIDO_DB=sys.argv[1],REPAIDO_ADMIN_KEY='test-operator-key',REPAIDO_KYC_BUCKET='test-only')
import main,local_business,mobility_journeys,repaidians_live,uvicorn
from fastapi import Header,HTTPException
from fastapi.testclient import TestClient
from test_operations import onboard,PIN,auth
from test_local_business import vehicle
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
def actor(authorization:str=Header(default='')):
    uid=authorization.removeprefix('Bearer ')
    if uid not in ('customer','worker','worker2','shop'):raise HTTPException(401)
    return dict(id=uid,name=uid,email=uid+'@example.test',phone='+919876543210',phone_verified=True,phone_authenticated=True)
main.app.dependency_overrides[main.current_user]=actor
local_business.route_metres=lambda a,b:10000
mobility_journeys.road_route=lambda a,b:{'points':[a,b],'distance_metres':11132}
key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
os.environ.update(CLOUDFLARE_STREAM_ACCOUNT_ID='a'*32,CLOUDFLARE_STREAM_API_TOKEN='fixture-token',CLOUDFLARE_STREAM_KEY_ID='b'*32,CLOUDFLARE_STREAM_SIGNING_PEM=key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()).decode())
def provider(method,path='',body=None):
    if method=='POST':return {'uid':'c'*32,'webRTC':{'url':'https://customer-test.cloudflarestream.com/fixture-publish/webRTC/publish'},'webRTCPlayback':{'url':'https://customer-test.cloudflarestream.com/'+'c'*32+'/webRTC/play'}}
    if method=='GET':return {'status':'connected'}
repaidians_live.provider=provider
with TestClient(main.app) as api:
    onboard(api);vid=vehicle(api,'worker',mode='both')
    result=api.post('/operations/local-business/shared',headers=auth('worker'),json={'request_id':str(uuid.uuid4()),'vehicle_id':vid,'origin':PIN,'destination':{'lat':PIN['lat']+.1,'lng':PIN['lng']},'origin_address':'Fixture pickup station','destination_address':'Fixture destination station','starts_at':time.time()+86400,'ends_at':time.time()+90000,'seats':2,'price_paise':17500,'pickup_mode':'meeting_point','terms':'One bag per seat. Meet at the agreed pin and pay the agreed fare directly.'})
    assert result.status_code==201,result.text
uvicorn.run(main.app,host='127.0.0.1',port=int(sys.argv[2]))
