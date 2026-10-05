"""Versioned, explainable incentive policy. No inference about a person's character.
Only verified completed jobs and server timestamps count. No speed-only incentives.
"""
import time
import uuid
from fastapi import APIRouter, Depends
from operations import Input
from pydantic import Field
from typing import Literal
from operations import fail

POLICY = {'version':'retention-v1','minimum_tasks':5,'minimum_reviews':3,'minimum_rating':4.2,
          'minimum_response_rate':.8,'minimum_ack_rate':.9,'minimum_score':75,
          'award_cooldown_days':7,'unlock_minimum_days':7,
          'weights':{'quality':.50,'response':.2,'acknowledgement':.15,'completion_checks':.1},
          'availability_weight':.05,'speed_bonus':False}


def next_milestone(count):
    return ((count//5)+1)*5 if count<20 else ((count//10)+1)*10


def performance(u, worker_id, now):
    jobs=[j for j in u.all('jobs') if j.get('worker_id')==worker_id]
    exclusions=[x for x in u.all('metric_exclusions') if x['worker_id']==worker_id and x['exclude']]
    excluded_offers={x['source_id'] for x in exclusions if x['source_kind']=='assignment'}
    excluded_acks={x['source_id'] for x in exclusions if x['source_kind']=='acknowledgement'}
    recent=[j for j in jobs if j.get('accepted_at',j['created_at'])>now-30*86400]
    completed=[j for j in jobs if j['state']=='completed' and j['payment_status']=='verified' and j.get('outcome')!='partial']
    recent_done=[j for j in completed if j.get('completed_at',0)>now-30*86400]
    reviews=[j['review']['rating'] for j in recent_done if j.get('review')]
    rating=sum(reviews)/len(reviews) if reviews else None
    # Stabilize small samples. This is an explicit prior, not a fabricated review.
    quality=(sum(reviews)+5*4)/(len(reviews)+5)/5
    offers=[n for n in u.all('assignment_metrics') if n['worker_id']==worker_id and n['id'] not in excluded_offers and n['offered_at']>now-30*86400]
    mature=[o for o in offers if o.get('responded_at') or o['offered_at']+900<now]
    response=sum(1 for o in mature if o.get('responded_at') and o['responded_at']<=o['offered_at']+900)/len(mature) if mature else None
    reminded=[j for j in recent if j['id'] not in excluded_acks and j.get('reminder_sent_at') and j.get('reminder_at',now)+600<now]
    ack=sum(1 for j in reminded if j.get('reminder_ack_at',float('inf'))<=j['reminder_at']+600)/len(reminded) if reminded else None
    accuracy=sum(1 for j in recent_done if j.get('completion_notes') and (not j.get('review') or j['review']['rating']>=4))/len(recent_done) if recent_done else 0
    reasons=[]
    if len(completed)<5:reasons.append('Complete five paid, customer-confirmed tasks.')
    if len(reviews)<3:reasons.append('At least three verified reviews in the last 30 days are needed; missing reviews are not negative ratings.')
    if rating is not None and rating<4.2:reasons.append('Recent verified rating is below 4.2 out of 5.')
    if response is None:reasons.append('Not enough measured assignment responses yet.')
    elif response<.8:reasons.append('Respond to at least 80% of offers within 15 minutes; timely declines also count.')
    if ack is not None and ack<.9:reasons.append('Acknowledge at least 90% of visit reminders within the grace period.')
    if any(j['state'] in ('disputed','stop_requested') or j.get('financial_hold') for j in recent):reasons.append('An unresolved dispute needs review; it is not treated as proven poor performance.')
    samples=[s for s in u.all('availability_samples') if s['worker_id']==worker_id and s['at']>now-7*86400]
    # Only distinct server-observed 5-minute windows count. No inferred all-day uptime.
    availability=min(1,len(samples)/120) if samples else .5
    score=round(100*(quality*.50+availability*.05+(response or 0)*.2+(ack if ack is not None else 1)*.15+accuracy*.1),2)
    if score<75:reasons.append('The evidence-based score is below the 75-point award threshold.')
    corrections=[r for r in u.all('metric_corrections') if r['worker_id']==worker_id and r['status']=='pending']
    # Corrections suspend allocation for human adjudication instead of silently fabricating metrics.
    if corrections:reasons.append('A metric correction is under review. Awards are held, not forfeited.')
    return {'completed_paid_tasks':len(completed),'recent_review_count':len(reviews),'recent_rating':rating,
            'response_rate':response,'acknowledgement_rate':ack,'quality_check_rate':accuracy,'observed_availability_windows':len(samples),'score':score,
            'eligible':not reasons,'reasons':reasons,'policy':POLICY}


def calculate(u, worker_id):
    now=time.time();metrics=performance(u,worker_id,now)
    awards=[a for a in u.all('bonus_awards') if a['worker_id']==worker_id]
    jobs={j['id']:j for j in u.all('jobs')}
    for award in awards:
        if award['status'] not in ('locked','available'):continue
        sources=[jobs.get(i) for i in award['source_jobs']]
        if any(not j or j['payment_status']!='verified' or j['state']!='completed' for j in sources):
            award['status']='reconciliation_hold';u.put('bonus_awards',award['id'],award);continue
        if award['status']=='locked' and metrics['eligible'] and metrics['completed_paid_tasks']>=award['unlock_at_tasks'] and now>=award['unlock_after']:
            award.update(status='available',unlocked_at=now);u.put('bonus_awards',award['id'],award)
            notify(u,worker_id,'Your achievement bonus is unlocked. Review your wallet to withdraw.',award['id']+'unlock')
    count=metrics['completed_paid_tasks'];last=max([a['milestone'] for a in awards],default=0)
    target=next_milestone(last)
    last_at=max([a['awarded_at'] for a in awards],default=0)
    sources=[r for r in u.all('bonus_reserves') if r.get('worker_id')==worker_id and r['status']=='funded' and jobs.get(r['source_job_id'],{}).get('payment_status')=='verified']
    if metrics['eligible'] and count>=target and now-last_at>=7*86400 and sources:
        aid=str(uuid.uuid4());amount=sum(r['amount_paise'] for r in sources)
        award=dict(id=aid,worker_id=worker_id,amount_paise=amount,status='locked',awarded_at=now,milestone=target,
                   unlock_at_tasks=next_milestone(count),unlock_after=now+7*86400,source_jobs=[r['source_job_id'] for r in sources],evidence=metrics,policy_version=POLICY['version'])
        u.put('bonus_awards',aid,award)
        for r in sources:r.update(status='awarded',award_id=aid);u.put('bonus_reserves',r['id'],r)
        notify(u,worker_id,'Congratulations! A bonus was awarded. Open your wallet to see the next milestone and unlock date.',aid)
    return metrics


def notify(u,worker_id,message,key):
    u.put('notifications',key,dict(id=key,user_id=worker_id,title='Repaido achievement',body=message,created_at=time.time(),destination='wallet'))
    for d in u.all('devices'):
        if d['active'] and d['user_id']==worker_id:
            did=key+'_'+d['id'];u.put('deliveries',did,dict(id=did,notification_id=key,device_id=d['id'],status='pending',created_at=time.time()))


class Resolution(Input):
    reason: str = Field(min_length=20,max_length=1000)
    decision: Literal['resolved_no_change','hold_for_evidence']

def install(core):
    router=APIRouter(prefix='/operations',tags=['Achievement wallet'])
    store=core.operations_store
    @router.get('/worker/wallet')
    def wallet(user=Depends(core.current_user)):
        def read(u):
            w=u.get('workers',user['id'])
            if not w or not user.get('phone_verified'):fail('WORKER_REQUIRED','Sign in to your worker account.',403)
            metrics=performance(u,user['id'],time.time())
            awards=[a for a in u.all('bonus_awards') if a['worker_id']==user['id']]
            return {'metrics':metrics,'awards':awards,'locked_paise':sum(a['amount_paise'] for a in awards if a['status']=='locked'),
                    'available_paise':sum(a['amount_paise'] for a in awards if a['status']=='available'),
                    'policy':POLICY,'availability_note':'Observed availability contributes at most five points. No activity is inferred between samples; missing samples use a neutral value. Quality and response reliability carry most weight.'}
        return store.run(read)
    @router.post('/worker/wallet/review-request')
    def correction(user=Depends(core.current_user)):
        def save(u):
            if not u.get('workers',user['id']) or not user.get('phone_verified'):fail('WORKER_REQUIRED','Worker account required.',403)
            old=u.get('metric_corrections',user['id'])
            if old and old['status']=='pending':return old
            r=dict(id=user['id'],worker_id=user['id'],status='pending',created_at=time.time(),expires_at=time.time()+30*86400)
            u.put('metric_corrections',r['id'],r);return r
        return store.run(save)
    @router.get('/admin/rewards',dependencies=[Depends(core.operator)])
    def rewards():return store.run(lambda u:{'policy':POLICY,'corrections':u.all('metric_corrections'),'awards':u.all('bonus_awards')})
    @router.post('/admin/rewards/{worker_id}/review')
    def resolve(worker_id: str,body: Resolution,admin=Depends(core.operator)):
        def save(u):
            r=u.get('metric_corrections',worker_id)
            if not r:fail('NOT_FOUND','Review request not found.',404)
            r.update(status='resolved' if body.decision=='resolved_no_change' else 'pending',reason=body.reason,reviewed_by=admin['id'],reviewed_at=time.time())
            u.put('metric_corrections',worker_id,r)
            from integrations import audit
            audit(u,'RewardMetricReview',admin['id'],worker_id=worker_id,**body.model_dump())
            return r
        return store.run(save)
    def tick():
        if not __import__('os').getenv('REPAIDO_REWARDS_ENABLED')=='true':return {'status':'disabled'}
        ids=store.run(lambda u:[w['id'] for w in u.all('workers') if w['status']=='approved'])
        for wid in ids:store.run(lambda u:calculate(u,wid))
        return {'workers_checked':len(ids)}
    core.rewards_tick=tick
    core.app.include_router(router)
