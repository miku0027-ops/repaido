import time
from concurrent.futures import ThreadPoolExecutor
import main
from test_operations import api,auth,onboard,book,PIN,command

def worker_update(**fields):
 def save(u):
  w=u.get('workers','worker');w.update(fields);u.put('workers','worker',w)
 main.operations_store.run(save)

def online(api):
 return api.post('/operations/worker/availability',headers=auth('worker'),json={'online':True,'position':{**PIN,'accuracy':5,'captured_at':time.time()}})

def test_waiting_pest_dispatched_immediately_on_online_once(api,monkeypatch):
 onboard(api);worker_update(categories=['pest'],skills=['pest control'],online=False,position=None)
 j,_=book(api,service_id='pest-control');assert j['state']=='searching'
 assert api.get('/operations/jobs',headers=auth('worker')).json()['jobs']==[]
 assert online(api).json()['new_assignments']==1
 for _ in range(2):assert online(api).json()['new_assignments']==0
 offered=api.get('/operations/jobs/'+j['id'],headers=auth('worker')).json()
 assert offered['state']=='offered' and 'accept' in offered['allowed_actions']
 assert offered['version']==j['version']+1
 assert not {'address','location','phone'}&set(offered)
 assert len([e for e in offered['events'] if e['event_type']=='AssignmentOffered'])==1
 monkeypatch.setenv('REPAIDO_PUSH_ENABLED','false');main.integrations_relay();main.integrations_relay()
 alerts=main.operations_store.run(lambda u:[n for n in u.all('notifications') if n.get('alert_kind')=='assignment'])
 assert len(alerts)==1 and alerts[0]['user_id']=='worker'
 assert alerts[0]['offer_expires_at']==offered['offer_expires_at']
 accepted=command(api,offered,'accept');assert accepted['state']=='accepted'

def test_scheduler_retries_searching_but_preserves_eligibility(api):
 onboard(api);worker_update(categories=['pest'],skills=['pest'],online=False)
 j,_=book(api,service_id='pest-control')
 for changes in [dict(online=False),dict(online=True,position=None),dict(position={**PIN,'accuracy':5,'received_at':time.time()-901}),dict(position={**PIN,'accuracy':5,'received_at':time.time()},categories=['ac']),dict(categories=['pest'],position={'lat':22,'lng':87,'accuracy':5,'received_at':time.time()}),dict(position={**PIN,'accuracy':5,'received_at':time.time()},status='pending_verification')]:
  worker_update(**changes);main.operations_tick()
  assert api.get('/operations/jobs/'+j['id'],headers=auth('customer')).json()['state']=='searching'
 worker_update(status='approved');main.operations_tick()
 assert api.get('/operations/jobs/'+j['id'],headers=auth('worker')).json()['state']=='offered'

def test_concurrent_presence_reserves_only_one_job_and_decline_not_reoffered(api):
 onboard(api);worker_update(categories=['pest'],online=False)
 a,_=book(api,service_id='pest-control');b,_=book(api,service_id='pest-control')
 with ThreadPoolExecutor(max_workers=2) as pool:responses=list(pool.map(lambda _:online(api),range(2)))
 assert all(r.status_code==200 for r in responses)
 jobs=api.get('/operations/jobs',headers=auth('worker')).json()['jobs'];assert len(jobs)==1 and jobs[0]['id']==a['id']
 command(api,jobs[0],'decline');main.operations_tick()
 a=api.get('/operations/jobs/'+a['id'],headers=auth('customer')).json();assert a['state']=='searching'
 b=api.get('/operations/jobs/'+b['id'],headers=auth('worker')).json();assert b['state']=='offered'

def test_expired_assignment_never_emits_incoming_request_notification(api,monkeypatch):
 onboard(api);j,_=book(api)
 def expire(u):
  x=u.get('jobs',j['id']);x['offer_expires_at']=time.time()-1;u.put('jobs',j['id'],x)
 main.operations_store.run(expire);monkeypatch.setenv('REPAIDO_PUSH_ENABLED','false');main.integrations_relay()
 assert not main.operations_store.run(lambda u:[n for n in u.all('notifications') if n.get('alert_kind')=='assignment'])
