import time
from datetime import datetime
import main
from test_operations import api, auth, onboard, PIN
from worker_records import IST, calendar_record, profile_progress

def seed_task(uid='worker', **changes):
    j=dict(id='calendar-task',worker_id=uid,service_name='Fixture service',category='ac',state='completed',starts_at='2026-09-30T18:40:00+00:00',created_at=1790784000,completed_at=datetime(2026,10,1,0,20,tzinfo=IST).timestamp(),events=[],penalties=[],review={'rating':5,'text':'Test'},payment_status='unverified',payout_status='held',points_awarded=10)
    j.update(changes)
    main.operations_store.run(lambda u:u.put('jobs',j['id'],j))
    return j

def test_calendar_ownership_month_and_no_invented_offline(api):
    onboard(api)
    seed_task()
    assert api.get('/operations/worker/calendar?month=2026-10',headers=auth('customer')).status_code==403
    assert api.get('/operations/worker/calendar?month=2026-13',headers=auth('worker')).status_code==422
    data=api.get('/operations/worker/calendar?month=2026-10',headers=auth('worker')).json()
    assert data['days'][0]['points']==10 and data['summary']['completed']==1
    assert data['days'][0]['earned_paise']==0 and data['summary']['paid_paise']==0
    assert data['score']==100 and len(data['components'])==1
    assert any(d['tone']=='unknown' and not d['offline_recorded'] for d in data['days'])
    onboard(api,'worker2')
    other=api.get('/operations/worker/calendar?month=2026-10',headers=auth('worker2')).json()
    assert not any(d['tasks'] for d in other['days'])
    assert other['score'] is None

def test_calculated_earnings_payout_date_and_real_deductions(api):
    onboard(api);seed_task(review={'rating':4,'text':'Fixture'})
    def insert(u):
        u.put('settlements','calendar-task',dict(gross_paise=10000,deduction_paise=1000,net_paise=9000,status='paid'))
        u.put('payouts','calendar-task',dict(status='processed',amount_paise=9000,checked_at=datetime(2026,10,3,10,tzinfo=IST).timestamp()))
    main.operations_store.run(insert)
    data=api.get('/operations/worker/calendar?month=2026-10',headers=auth('worker')).json()
    assert data['days'][0]['tone']=='mixed'
    assert data['days'][0]['paid_paise']==0 and data['days'][2]['paid_paise']==9000
    assert data['summary']['deduction_paise']==1000 and data['score']==32
    assert any('Dispute' in s for s in data['suggestions'])

def test_rescheduled_task_keeps_both_dates_and_no_unearned_points(api):
    onboard(api)
    seed_task(state='offered',completed_at=None,points_awarded=0,review=None,schedule_history=[{'from':'2026-10-01T10:00:00+05:30','to':'2026-10-06T10:00:00+05:30','at':1790784000}],starts_at='2026-10-06T10:00:00+05:30')
    data=api.get('/operations/worker/calendar?month=2026-10',headers=auth('worker')).json()
    assert data['days'][0]['tasks'][0]['state']=='offered'
    assert data['days'][5]['tasks'][0]['schedule_history']
    assert data['summary']['points']==0 and data['score'] is None

def test_profile_completion_is_not_self_verification(api):
    onboard(api,approve=False)
    def fill(u):
        u.put('worker_profiles','worker',dict(bio='AC professional',languages=['Odia'],portrait_id='p1'))
        u.put('worker_media','p1',dict(worker_id='worker',kind='portrait'))
    main.operations_store.run(fill)
    progress=api.get('/operations/worker/profile-progress',headers=auth('worker')).json()
    assert progress['percent']<100 and not progress['verified']
    assert progress['missing']==[dict(id='identity',label='Identity review',target='verification')]
    def approve(u):
        u.put('verification','worker',{'identity_status':'approved'})
        w=u.get('workers','worker');w['status']='approved';u.put('workers','worker',w)
    main.operations_store.run(approve)
    assert api.get('/operations/worker/profile-progress',headers=auth('worker')).json()['verified']
    assert api.get('/operations/worker/profile-progress',headers=auth('customer')).status_code==403

def test_explicit_presence_changes_are_recorded_not_heartbeats(api):
    onboard(api)
    before=main.operations_store.run(lambda u:u.all('availability_events'))
    api.post('/operations/worker/availability',headers=auth('worker'),json={'online':True,'heartbeat':True,'position':{**PIN,'accuracy':5,'captured_at':time.time()}})
    assert len(main.operations_store.run(lambda u:u.all('availability_events')))==len(before)
    api.post('/operations/worker/availability',headers=auth('worker'),json={'online':False})
    rows=main.operations_store.run(lambda u:u.all('availability_events'))
    assert len(rows)==len(before)+1 and any(not r['online'] for r in rows)
