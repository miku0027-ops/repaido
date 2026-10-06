"""Customer inbox and booking regressions against real isolated HTTP/storage."""
import time
import main
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
