"""Disposable hourly hiring API. Payment, identity and clock fixtures are local only."""
import os,sys,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'backend'))
os.environ.update(NO_GCE_CHECK='true',REPAIDO_STORAGE='sqlite',REPAIDO_DB=sys.argv[1],REPAIDO_ADMIN_KEY='test-operator-key')
import main,uvicorn,hiring,integrations,pytest
from fastapi import Header,HTTPException
from fastapi.testclient import TestClient
from test_operations import auth,command,PIN
from test_hourly_hiring import setup_hourly
from test_hiring_records import request,decide
clock=[time.time()];mp=pytest.MonkeyPatch();mp.setattr(time,'time',lambda:clock[0])
def actor(authorization:str=Header(default='')):
    uid=authorization.removeprefix('Bearer ')
    if uid not in ('customer','worker','worker2','admin-a'):raise HTTPException(401)
    return dict(id=uid,name=uid,email=uid+'@example.test',phone='+919876543210',phone_verified=True,phone_authenticated=True)
main.app.dependency_overrides[main.current_user]=actor
with TestClient(main.app) as api:
    policy,gateway=setup_hourly(api,mp)
    h,_=request(api,policy,planned_minutes=120)
    h=decide(api,h,'accept',position={**PIN,'accuracy':5,'captured_at':time.time()}).json()
def provider(path,body=None,**kwargs):
    if path=='orders':
        order={**body,'id':'order_test'+str(len(gateway['orders']))};gateway['orders'].append(order);return order
    if path.startswith('orders/') and path.endswith('/payments'):return {'items':[p for p in gateway['payments'] if p['order_id']==path.split('/')[1]]}
    if path.startswith('payments/'):return next(p for p in gateway['payments'] if p['id']==path.split('/')[1])
    raise AssertionError(path)
mp.setattr(integrations,'razorpay',provider)
@main.app.get('/_fixture/info')
def info():return {'hire_id':h['id'],'orders':gateway['orders'],'now':clock[0]}
@main.app.post('/_fixture/capture')
def capture(body:dict):
    order=next(o for o in gateway['orders'] if o['id']==body['order_id'])
    p=dict(id='pay_test'+str(len(gateway['payments'])),order_id=order['id'],amount=order['amount'],currency='INR',captured=True,status='captured')
    gateway['payments'].append(p);return p
@main.app.post('/_fixture/clock')
def tick(body:dict):clock[0]+=body['seconds'];return {'now':clock[0]}
@main.app.post('/_fixture/start')
def start():
    with TestClient(main.app) as api:
        hire=api.get('/operations/hiring/requests',headers=auth('worker')).json()['requests'][0];jid=hire['job_id']
        j=api.get('/operations/jobs/'+jid,headers=auth('worker')).json();clock[0]=j['starts_epoch']
        j=command(api,j,'ack_reminder');j=command(api,j,'depart');j=command(api,j,'position',payload={**PIN,'accuracy':5,'captured_at':time.time()})
        code=api.get(f'/operations/jobs/{jid}/arrival-code',headers=auth('customer')).json()['code']
        r=api.post(f'/operations/jobs/{jid}/verify-arrival',headers=auth('worker'),json={'code':code});assert r.status_code==200,r.text
        j=api.get('/operations/jobs/'+jid,headers=auth('worker')).json();return command(api,j,'start')
@main.app.post('/_fixture/after-photo')
def after_photo():
    def seed(u):
        j=next(j for j in u.all('jobs') if j.get('hire_id')==h['id']);eid='test-after'
        u.put('evidence',eid,dict(id=eid,kind='after',status='ready',job_id=j['id'],visit_id=j['visit_id'],worker_id=j['worker_id'],captured_at=time.time(),test_fixture=True));j.setdefault('evidence_ids',[]).append(eid);u.put('jobs',j['id'],j)
    main.operations_store.run(seed);return {'ready':True}
uvicorn.run(main.app,host='127.0.0.1',port=int(sys.argv[2]))
