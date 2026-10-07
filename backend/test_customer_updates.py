"""Customer inbox and booking regressions against real isolated HTTP/storage."""
import time
import main
import repaidians
from operations import Unit
from test_operations import api,auth,onboard,book


def test_notifications_only_real_events_and_reads_survive_reopen(api,monkeypatch):
    assert api.get('/operations/notifications',headers=auth('customer')).json()['notifications']==[]
    onboard(api);job,_=book(api)
    main.integrations_relay()
    rows=api.get('/operations/notifications',headers=auth('customer')).json()['notifications']
    assert rows and all(n.get('event_id') and n['job_id']==job['id'] for n in rows)
    assert any(n['title']=='Booking requested' for n in rows)
    row=rows[0]
    main.operations_store.run(lambda u:u.put('notifications',row['id'],{**row,'read_at':None}))
    path='/operations/notifications/'+row['id']+'/read'
    assert api.post(path,headers=auth('stranger')).status_code==404
    result=api.post(path,headers=auth('customer')).json()
    assert result['read_at']>0
    assert api.post(path,headers=auth('customer')).json()['read_at']==result['read_at']
    assert next(n for n in api.get('/operations/notifications',headers=auth('customer')).json()['notifications'] if n['id']==row['id'])['read_at']==result['read_at']
    main.operations_store.run(lambda u:u.put('notifications','other',{'id':'other','user_id':'stranger','created_at':time.time(),'read_at':None}))
    assert api.post('/operations/notifications/read-all',headers=auth('customer')).status_code==200
    assert all(n.get('read_at') for n in api.get('/operations/notifications',headers=auth('customer')).json()['notifications'])
    assert main.operations_store.run(lambda u:u.get('notifications','other'))['read_at'] is None


def test_customer_reads_do_not_scan_global_collections(api,monkeypatch):
    onboard(api);job,_=book(api);main.integrations_relay()
    original=Unit.all
    def guarded(self,kind):
        assert kind not in ('notifications','jobs'),'Customer reads must use account indexes'
        return original(self,kind)
    monkeypatch.setattr(Unit,'all',guarded)
    mine=api.get('/operations/jobs',headers=auth('customer'))
    assert mine.status_code==200 and [j['id'] for j in mine.json()['jobs']]==[job['id']]
    assert api.get('/operations/jobs',headers=auth('stranger')).json()['jobs']==[]
    assert api.get('/operations/notifications',headers=auth('customer')).status_code==200
    assert api.post('/operations/notifications/read-all',headers=auth('customer')).status_code==200


def test_discovery_read_mirrors_only_same_account_and_native_project(api):
    def seed(u):
        for uid in ('customer', 'stranger'):
            u.put(repaidians.lane('rp_notifications', uid), 'match',
                  {'id':'match', 'type':'job_discovery', 'jobId':'project-one', 'read':False})
        u.put('notifications', 'match', {'id':'match', 'user_id':'customer', 'kind':'job_discovery',
              'destination':'repaidians', 'community_job_id':'project-one', 'created_at':time.time(), 'read_at':None})
    main.operations_store.run(seed)
    path='/operations/notifications/match/read'
    assert api.post(path, headers=auth('stranger')).status_code==404
    stamp=api.post(path, headers=auth('customer')).json()['read_at']
    assert stamp>0
    assert api.post(path, headers=auth('customer')).json()['read_at']==stamp
    assert main.operations_store.run(lambda u:u.get(repaidians.lane('rp_notifications','customer'),'match'))['read'] is True
    assert main.operations_store.run(lambda u:u.get(repaidians.lane('rp_notifications','stranger'),'match'))['read'] is False


def test_discovery_mark_all_preserves_other_types_and_source_identity(api,monkeypatch):
    def seed(u):
        rows=[('match','job_discovery','project-one',None),('mismatch','job_discovery','other-project',None),
              ('booking','booking_update','project-one',None),('already','job_discovery','project-one',123)]
        for key,kind,project,read_at in rows:
            u.put('notifications',key,{'id':key,'user_id':'customer','kind':kind,'destination':'repaidians',
                  'community_job_id':project,'created_at':time.time(),'read_at':read_at})
            u.put(repaidians.lane('rp_notifications','customer'),key,
                  {'id':key,'type':'job_discovery','jobId':'project-one','read':False})
    main.operations_store.run(seed)
    original=Unit.all
    def guarded(self,kind):
        assert kind!='notifications' and not kind.startswith('rp_notifications'), 'Inbox acknowledgement must use account indexes'
        return original(self,kind)
    monkeypatch.setattr(Unit,'all',guarded)
    assert api.post('/operations/notifications/read-all',headers=auth('customer')).status_code==200
    social=main.operations_store.run(lambda u:{key:u.get(repaidians.lane('rp_notifications','customer'),key) for key in ('match','mismatch','booking','already')})
    assert social['match']['read'] and social['already']['read']
    assert not social['mismatch']['read'] and not social['booking']['read']
    assert main.operations_store.run(lambda u:u.get('notifications','already'))['read_at']==123


def test_community_discovery_read_acknowledges_matching_native_mirror(api):
    onboard(api)
    for uid in ('worker','stranger'):
        assert api.get('/repaidians/state',headers=auth(uid)).status_code==200
    def seed(u):
        for key,owner,project,stamp in [('match','worker','project-one',None),('mismatch','worker','other-project',None),
                                       ('foreign','stranger','project-one',None),('already','worker','project-one',123)]:
            u.put(repaidians.lane('rp_notifications','worker'),key,
                  {'id':key,'type':'job_discovery','jobId':'project-one','read':False})
            u.put('notifications',key,{'id':key,'user_id':owner,'kind':'job_discovery','destination':'repaidians',
                  'community_job_id':project,'created_at':time.time(),'read_at':stamp})
    main.operations_store.run(seed)
    path='/repaidians/notifications/read'
    assert api.post(path,headers=auth('stranger'),json={'ids':['match']}).status_code==200
    assert main.operations_store.run(lambda u:u.get('notifications','match'))['read_at'] is None
    assert api.post(path,headers=auth('worker'),json={'ids':['match','mismatch','foreign','already']}).status_code==200
    native=main.operations_store.run(lambda u:{key:u.get('notifications',key) for key in ('match','mismatch','foreign','already')})
    assert native['match']['read_at']>0 and native['already']['read_at']==123
    assert native['mismatch']['read_at'] is None and native['foreign']['read_at'] is None
    stamp=native['match']['read_at']
    assert api.post(path,headers=auth('worker'),json={'ids':['match']}).status_code==200
    assert main.operations_store.run(lambda u:u.get('notifications','match'))['read_at']==stamp
