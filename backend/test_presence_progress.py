import time
from unittest.mock import patch
import main
from test_operations import api,auth,onboard,started,command,PIN
from test_dispatch import worker_update

def test_coarse_presence_and_delayed_heartbeat_does_not_reactivate(api):
 onboard(api)
 assert api.post('/operations/worker/availability',headers=auth('worker'),json={'online':True,'position':{**PIN,'accuracy':500,'captured_at':time.time()}}).status_code==200
 assert api.post('/operations/worker/availability',headers=auth('worker'),json={'online':False}).status_code==200
 r=api.post('/operations/worker/availability',headers=auth('worker'),json={'online':True,'heartbeat':True,'position':{**PIN,'accuracy':5,'captured_at':time.time()}})
 assert r.status_code==200 and r.json()['worker']['online'] is False
 assert api.post('/operations/worker/availability',headers=auth('worker'),json={'online':True,'position':{**PIN,'accuracy':1001,'captured_at':time.time()}}).status_code==422

def test_customer_tracking_privacy_staleness_and_stop(api):
 j=started(api);url=f"/operations/jobs/{j['id']}/tracking"
 for uid in ('stranger','shop','worker2'):assert api.get(url,headers=auth(uid)).status_code==404
 assert api.get(url,headers=auth('worker')).json()['position'] is not None
 assert api.get(url,headers=auth('customer')).json()['position'] is not None
 with patch('time.time',return_value=time.time()+61):
  r=api.get(url,headers=auth('customer')).json();assert r['status']=='stale' and r['position'] is None
 command(api,j,'stop_tracking')
 assert api.get(url,headers=auth('customer')).json()['position'] is None

def test_native_worksite_exit_one_event_and_accuracy_gate(api):
 j=started(api);t=time.time()
 token=api.post(f"/operations/jobs/{j['id']}/tracking-session",headers=auth('worker'),json={'consent':True}).json()['token']
 for seq,accuracy in [(1,100),(2,5),(3,5)]:
  with patch('time.time',return_value=t+seq*15):
   assert api.post('/operations/tracking/position',headers={'Authorization':'Bearer '+token},json={'lat':PIN['lat']+.01,'lng':PIN['lng'],'accuracy':accuracy,'captured_at':t+seq*15,'sequence':seq}).status_code==200
 events=main.operations_store.run(lambda u:u.all('outbox'))
 assert len([e for e in events if e['event_type']=='WorksiteExitNeedsReview'])==1
