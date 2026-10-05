import time
import main
from test_operations import api,auth,ADMIN,onboard
from rewards import calculate,performance,next_milestone
from integrations import settlement


def seed(u,now,count=5,rating=5):
    for n in range(count):
        jid='rewardjob'+str(n)
        u.put('jobs',jid,dict(id=jid,worker_id='worker',state='completed',payment_status='verified',created_at=now-1000,accepted_at=now-900,completed_at=now-100,completion_notes='Customer confirmed tested work',review={'rating':rating},reminder_sent_at=now-850,reminder_at=now-850,reminder_ack_at=now-800))
        u.put('assignment_metrics',jid,dict(id=jid,worker_id='worker',offered_at=now-1000,responded_at=now-990))
        u.put('bonus_reserves',jid,dict(id=jid,worker_id='worker',status='funded',amount_paise=1000,source_job_id=jid))


def test_reward_math_and_no_duplicate_awards(api,monkeypatch):
    onboard(api);now=time.time();main.operations_store.run(lambda u:seed(u,now))
    result=main.operations_store.run(lambda u:calculate(u,'worker'))
    assert result['eligible'] and result['score']>=75
    main.operations_store.run(lambda u:calculate(u,'worker'))
    awards=main.operations_store.run(lambda u:u.all('bonus_awards'))
    assert len(awards)==1 and awards[0]['amount_paise']==5000 and awards[0]['unlock_at_tasks']==10
    assert awards[0]['status']=='locked'
    assert api.get('/operations/worker/wallet',headers=auth('worker')).json()['available_paise']==0
    assert api.get('/operations/worker/wallet',headers=auth('customer')).status_code==403
    assert next_milestone(20)==30 and next_milestone(10)==15
    # New work plus elapsed time is required, not just opening the wallet repeatedly.
    future=now+8*86400
    main.operations_store.run(lambda u:seed(u,future,10))
    monkeypatch.setattr('rewards.time.time',lambda:future)
    main.operations_store.run(lambda u:calculate(u,'worker'))
    old=main.operations_store.run(lambda u:u.get('bonus_awards',awards[0]['id']))
    assert old['status']=='available'


def test_low_quality_missing_evidence_and_refund_hold(api):
    onboard(api);now=time.time();main.operations_store.run(lambda u:seed(u,now,rating=2))
    metric=main.operations_store.run(lambda u:calculate(u,'worker'))
    assert not metric['eligible'] and not main.operations_store.run(lambda u:u.all('bonus_awards'))
    main.operations_store.run(lambda u:seed(u,now,rating=5));main.operations_store.run(lambda u:calculate(u,'worker'))
    def refund(u):
        j=u.get('jobs','rewardjob0');j['payment_status']='refunded';u.put('jobs',j['id'],j)
    main.operations_store.run(refund);main.operations_store.run(lambda u:calculate(u,'worker'))
    assert main.operations_store.run(lambda u:u.all('bonus_awards'))[0]['status']=='reconciliation_hold'


def test_metric_review_holds_without_deleting_awards(api):
    onboard(api);now=time.time();main.operations_store.run(lambda u:seed(u,now))
    assert api.post('/operations/worker/wallet/review-request',headers=auth('worker')).status_code==200
    assert not main.operations_store.run(lambda u:calculate(u,'worker'))['eligible']
    assert api.post('/operations/admin/rewards/worker/review',headers=auth('worker'),json={'decision':'resolved_no_change','reason':'Cannot self approve a review'}).status_code==403
    assert api.post('/operations/admin/rewards/worker/review',headers=ADMIN,json={'decision':'resolved_no_change','reason':'Verified source metrics are accurate; explanation supplied.'}).status_code==200
    assert main.operations_store.run(lambda u:calculate(u,'worker'))['eligible']


def test_highest_single_and_company_bonus_accounting(api):
    def calculate_case(u):
        p=dict(version='v2',worker_share_bps=7500,bonus_reserve_bps=1000,penalty_cap_bps=10000,stack_penalties=False,penalty_mode='highest_single')
        u.put('jobs','case',dict(id='case',worker_id='worker',visit_id='visit',state='completed',payment_status='verified',settlement_policy=p,base_price_paise=100000,total_paise=120000,penalties=[{'worker_id':'worker','visit_id':'visit','current_percent':10},{'worker_id':'worker','visit_id':'visit','current_percent':20}]))
        return settlement(u,'case')
    s=main.operations_store.run(calculate_case)
    assert s['gross_paise']==75000 and s['deduction_paise']==25000 and s['net_paise']==50000
    assert s['company_earnings_paise']==40000 and s['bonus_reserve_paise']==10000 and s['parts_payable_paise']==20000
    assert s['net_paise']+s['company_earnings_paise']+s['bonus_reserve_paise']+s['parts_payable_paise']==120000


def test_bonus_withdrawal_is_gated_and_repeat_safe(api,monkeypatch):
    import integrations
    onboard(api);now=time.time();main.operations_store.run(lambda u:seed(u,now))
    main.operations_store.run(lambda u:u.put('bonus_awards','award',dict(id='award',worker_id='worker',status='available',amount_paise=1000,source_jobs=['rewardjob0'])))
    assert api.post('/operations/worker/bonus/withdraw',headers=auth('worker'),json={'consent':True}).status_code==503
    for key in ('RAZORPAYX_KEY_ID','RAZORPAYX_KEY_SECRET','RAZORPAYX_ACCOUNT_NUMBER'):monkeypatch.setenv(key,'test')
    monkeypatch.setenv('REPAIDO_PAYOUTS_ENABLED','true')
    calls=[]
    def provider(path,body=None,**kw):
        calls.append(kw.get('key'))
        if len(calls)==1:integrations.fail('UNKNOWN','Timeout',503)
        record=main.operations_store.run(lambda u:u.all('bonus_payouts'))[0]
        return dict(id='pout_bonus',reference_id=record['id'],amount=1000,fund_account_id='fa_test',currency='INR',status='processed')
    monkeypatch.setattr(integrations,'razorpay',provider)
    url='/operations/worker/bonus/withdraw'
    assert api.post(url,headers=auth('customer'),json={'consent':True}).status_code==403
    assert api.post(url,headers=auth('worker'),json={'consent':True}).status_code==503
    assert api.post(url,headers=auth('worker'),json={'consent':True}).status_code==200
    assert calls[0]==calls[1]
    assert main.operations_store.run(lambda u:u.get('bonus_awards','award'))['status']=='paid'
    assert api.post(url,headers=auth('worker'),json={'consent':True}).status_code==409
