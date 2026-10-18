"""Versioned hourly work, public capacity summaries and a credited booking advance.

All amounts use integer paise. Browser clocks and payment callbacks are never
sources of elapsed work or verified funds. Legacy fixed-day records are unchanged.
"""
import math
import os
import time
from fastapi import APIRouter, Depends, Response
from operations import fail, event

MODEL = 'hourly-v1'
BASE = 15000
RATE = 15000
MAX_MINUTES = 360
BREAK_MINUTES = 30
MAX_SURCHARGE = 2500
JOB_FIELDS = ('id','worker_id','state','starts_epoch','duration_minutes','hourly_hire',
              'work_seconds','work_clock_started_at','started_at','hire_break','hire_base_status')


def is_hourly(policy):
    return policy.get('billing_model') == MODEL


def terms(planned_minutes=360):
    return dict(model=MODEL, base_paise=BASE, hourly_paise=RATE,
                planned_minutes=planned_minutes, maximum_work_minutes=MAX_MINUTES,
                meal_break_minutes=BREAK_MINUTES, surcharge_scope='base_and_work')


def price(seconds, *, surcharge_bps=0, gst_bps=0, travel_paise=0, limit_minutes=360):
    """Bill actual recorded seconds at 250 paise/minute, rounded once to paise.
    The quote's selected time limit is a ceiling, never a minimum-hour charge.
    """
    if not 0 <= surcharge_bps <= MAX_SURCHARGE or not 0 <= gst_bps <= 3000:
        raise ValueError('Invalid disclosed pricing factors')
    if not 1 <= limit_minutes <= MAX_MINUTES or travel_paise < 0:
        raise ValueError('Invalid work limit or travel charge')
    seconds = min(max(0, float(seconds)), limit_minutes * 60)
    # Round recorded time up to the next second; monetary rounding is half-up.
    billable_seconds = min(math.ceil(seconds), limit_minutes * 60)
    work = (billable_seconds * RATE + 1800) // 3600
    surcharge = ((BASE + work) * surcharge_bps + 5000) // 10000
    taxable = BASE + work + surcharge + travel_paise
    gst = (taxable * gst_bps + 5000) // 10000
    base_surcharge = (BASE * surcharge_bps + 5000) // 10000
    upfront = BASE + base_surcharge
    upfront_gst = (upfront * gst_bps + 5000) // 10000
    return dict(base_paise=BASE, work_paise=work, billable_seconds=billable_seconds,
                surcharge_bps=surcharge_bps, surcharge_paise=surcharge,
                travel_paise=travel_paise, gst_paise=gst, total_paise=taxable+gst,
                booking_advance_paise=upfront+upfront_gst,
                service_earnings_base_paise=BASE+work+surcharge)


def recorded_seconds(job, now=None):
    now = time.time() if now is None else now
    value = job.get('work_seconds', 0)
    if job.get('work_clock_started_at'):
        value += max(0, now-job['work_clock_started_at'])
    return min(max(0, value), job['hourly_hire']['planned_minutes']*60)


def advance_total(u, job_id):
    return sum(a['amount_paise']-a.get('amount_refunded',0)
               for a in u.find('payments','job_id',job_id)
               if a.get('kind')=='hire_base' and a.get('allocated')
               and a.get('status') in ('captured','partially_refunded'))


def current_bill(job, now=None):
    hourly=job['hourly_hire']
    result=price(recorded_seconds(job,now),surcharge_bps=hourly['surcharge_bps'],
                 gst_bps=hourly['gst_bps'],travel_paise=job.get('hire_travel_paise',0),
                 limit_minutes=hourly['planned_minutes'])
    return {**result,'advance_paid_paise':job.get('hire_base_paid_paise',0),
            'remaining_service_paise':max(0,result['total_paise']-job.get('hire_base_paid_paise',0)),
            'timer_running':bool(job.get('work_clock_started_at')) and recorded_seconds(job,now)<hourly['planned_minutes']*60,
            'limit_reached':recorded_seconds(job,now)>=hourly['planned_minutes']*60}


def finalize_bill(job, now):
    result=current_bill(job,now)
    # Preserve separately approved parts; the old service estimate is replaced,
    # not added a second time. The original quote remains an immutable ceiling.
    original=job['hourly_hire']['quoted_service_total_paise']
    extras=job['total_paise']-job.get('hourly_final_total_paise',original)
    if extras < 0: fail('ALLOCATION_REVIEW','The service and parts allocation needs review.')
    job.update(total_paise=result['total_paise']+extras,
               hourly_final_total_paise=result['total_paise'],hourly_final_bill=result,
               settlement_base_paise=result['service_earnings_base_paise'],
               base_price_paise=result['service_earnings_base_paise'],hire_gst_paise=result['gst_paise'])


def expected_end(job, now=None):
    now=time.time() if now is None else now
    scheduled=job.get('starts_epoch',now)+job.get('duration_minutes',120)*60
    if job.get('hourly_hire') and job.get('started_at') and job['state'] in ('in_progress','collecting_parts'):
        remaining=max(0,job['hourly_hire']['planned_minutes']*60-recorded_seconds(job,now))
        meal=job.get('hire_break') or {}
        break_remaining=max(0,meal.get('until',0)-now) if meal.get('state')=='active' else (BREAK_MINUTES*60 if not meal else 0)
        return max(scheduled,now+remaining+break_remaining)
    return scheduled


def reservation_conflict(u, worker_id, start, minutes, *, request_id=None, job_id=None, now=None, context=None):
    from home_plans import intervals_overlap
    from datetime import datetime
    now=time.time() if now is None else now
    context=context or {'jobs':u.for_workers('jobs',[worker_id],JOB_FIELDS),'hires':u.find('hires','worker_id',worker_id),'plans':u.all('home_plans'),'projects':u.all('contract_projects')}
    for project in context['projects']:
        if project['status'] in ('completed','cancelled'):continue
        if any(m['worker_id']==worker_id and m['status']=='accepted' for m in project['team']) and start<project['ends_at'] and project['starts_at']<start+(minutes+BREAK_MINUTES)*60:return True
    for plan in context['plans']:
        if plan.get('worker_id')!=worker_id or plan['state'] not in ('offered','active') or (plan['state']=='offered' and plan.get('offer_expires_at',0)<=now):continue
        if any(v['status']=='scheduled' and intervals_overlap(start,minutes+BREAK_MINUTES,v['starts_epoch'],plan['minutes']) for v in plan['visits']):return True
    for job in context['jobs']:
        if job.get('worker_id')!=worker_id:continue
        if job.get('id')==job_id or job['state'] in ('completed','cancelled','searching'):continue
        if job.get('hire_base_status')=='expired':continue
        if intervals_overlap(start,minutes+BREAK_MINUTES,job.get('starts_epoch',now),job.get('duration_minutes',120)):return True
        if job['state'] in ('completion_pending','disputed','stop_requested','follow_up_required') and start<now+3600:return True
        if job['state'] in ('en_route','arrived','in_progress','collecting_parts') and expected_end(job,now)+1800>start:return True
    for hire in context['hires']:
        if hire.get('worker_id')!=worker_id:continue
        if hire['id']==request_id or hire['state'] not in ('offered','quoted','quoting'):continue
        deadline=hire.get('quote_lease_until',0) if hire['state']=='quoting' else hire.get('quote_expires_at',0) if hire['state']=='quoted' else hire.get('offer_expires_at',0)
        if deadline<=now:continue
        length=hire.get('planned_minutes',360)+BREAK_MINUTES if is_hourly(hire['policy']) else hire['policy']['day_hours']*60
        if intervals_overlap(start,minutes+BREAK_MINUTES,datetime.fromisoformat(hire['starts_at']).timestamp(),length):return True
    return False


ACTIVE_STATES=('offered','accepted','en_route','arrived','in_progress','collecting_parts','completion_pending','disputed','stop_requested','follow_up_required','follow_up_scheduled')

def active_worker_jobs(u, worker_id):
    """Bound the frequently refreshed presence query; do not reread work history."""
    limit=101
    if u.tx is not None:
        from google.cloud.firestore_v1.base_query import FieldFilter
        query=u.core.fs_collection('ops_jobs').where(filter=FieldFilter('worker_id','==',worker_id)).where(filter=FieldFilter('state','in',list(ACTIVE_STATES))).select(JOB_FIELDS).limit(limit)
        rows={s.id:s.to_dict() for s in query.stream(transaction=u.tx)}
    else:
        import json
        marks=','.join('?' for _ in ACTIVE_STATES)
        query="SELECT id,body FROM operation_records WHERE kind='jobs' AND json_extract(body,'$.worker_id')=? AND json_extract(body,'$.state') IN ("+marks+") LIMIT ?"
        rows={r['id']:json.loads(r['body']) for r in u.conn.execute(query,(worker_id,*ACTIVE_STATES,limit))}
    for (kind,key),row in u.pending.items():
        if kind=='jobs':
            if row.get('worker_id')==worker_id and row.get('state') in ACTIVE_STATES:rows[key]=row
            else:rows.pop(key,None)
    return list(rows.values())


def public_availability(u, worker, jobs=None, now=None):
    """Only a work-state and approximate availability; never a customer/location/id."""
    now=time.time() if now is None else now
    if worker.get('status')!='approved': return None
    rows=jobs if jobs is not None else active_worker_jobs(u,worker['id'])
    if jobs is None and len(rows)>100:return dict(state='not_confirmed',label='Check availability',available_at=None,estimated=True,checked_at=now)
    current=[j for j in rows if j.get('worker_id')==worker['id'] and j.get('state') not in ('completed','cancelled','searching')]
    active=[j for j in current if j.get('state') in ('en_route','arrived','in_progress','collecting_parts','completion_pending','disputed','stop_requested','follow_up_required')]
    # Pending review/dispute cannot promise a release time.
    if any(j['state'] in ('completion_pending','disputed','stop_requested','follow_up_required') for j in active):
        return dict(state='finishing_review',label='Finishing a visit',available_at=None,estimated=True,checked_at=now)
    job=max(active,key=lambda j:expected_end(j,now),default=None)
    upcoming=sorted(current,key=lambda j:j.get('starts_epoch',0))
    if not job and upcoming and upcoming[0].get('starts_epoch',0)<=now+1800: job=upcoming[0]
    if job:
        meal=job.get('hire_break') or {}
        state='reserved' if job.get('hire_base_status')=='pending' else 'meal_break' if meal.get('state')=='active' else 'at_work' if job['state']=='in_progress' else 'hired'
        until=expected_end(job,now)+1800  # existing travel/turnaround buffer
        for next_job in upcoming:
            if next_job is job: continue
            if next_job.get('starts_epoch',0)<=until:until=max(until,expected_end(next_job,now)+1800)
        return dict(state=state,label={'reserved':'Slot awaiting confirmation','meal_break':'On a meal break','at_work':'Working on a visit','hired':'Hired for a visit'}[state],
                    available_at=math.ceil(until/300)*300,estimated=True,checked_at=now)
    fresh=worker.get('online') and 0<=now-(worker.get('position') or {}).get('received_at',0)<=300 and (worker.get('position') or {}).get('accuracy',1000)<=100
    return dict(state='available' if fresh else 'not_confirmed',label='Accepting requests' if fresh else 'Check availability',
                available_at=math.ceil(now/300)*300 if fresh else None,estimated=True,checked_at=now)


def demand_rate(u, workers, *, starts_epoch, now=None, jobs=None):
    """Occupancy of real eligible nearby workers; small/early samples use base rates."""
    now=time.time() if now is None else now
    if starts_epoch-now>3600 or len(workers)<3:return dict(bps=0,reason='Standard advance-booking rate',sample_size=len(workers))
    ids={w['id'] for w in workers}
    jobs=jobs if jobs is not None else u.for_workers('jobs',list(ids),JOB_FIELDS)
    busy={j['worker_id'] for j in jobs if j['worker_id'] in ids and j['state'] not in ('completed','cancelled','searching')
          and (not j.get('hourly_hire') or j.get('hire_base_status')=='captured')
          and j.get('starts_epoch',0)<starts_epoch+3600 and expected_end(j,now)>starts_epoch-3600}
    ratio=len(busy)/len(ids)
    bps=2500 if ratio>=.95 else 2000 if ratio>=.8 else 1000 if ratio>=.6 else 0
    return dict(bps=bps,reason='High nearby booking demand' if bps else 'Standard rate',sample_size=len(ids))


def apply_capture(u, advance, payment):
    from integrations import audit
    now=time.time();job=u.get('jobs',advance['job_id'])
    if not job or not payment.get('id') or payment.get('order_id')!=advance.get('order_id'):
        fail('PAYMENT_MISMATCH','Booking payment does not match the reserved order.')
    if type(payment.get('amount')) is not int or payment['amount']!=advance['amount_paise'] or payment.get('currency')!='INR':
        fail('AMOUNT_MISMATCH','Booking advance needs payment review.')
    if advance.get('payment_id') and advance['payment_id']!=payment['id']:
        fail('DUPLICATE_COLLECTION_REVIEW','A second collection needs refund review.')
    receipt=u.get('receipts',payment['id'])
    if receipt and receipt.get('job_id')!=job['id']:fail('PAYMENT_ALREADY_USED','Payment already belongs to another booking.')
    refunded=payment.get('amount_refunded') or 0
    if type(refunded) is not int or not 0<=refunded<=advance['amount_paise']:fail('REFUND_MISMATCH','Refund amount needs reconciliation.')
    refunded=max(refunded,advance.get('amount_refunded',0))
    if refunded or payment.get('status')=='refunded':
        if payment.get('status')=='refunded' and not refunded:fail('REFUND_MISMATCH','Provider refund total is missing.')
        advance.update(status='refunded' if refunded==advance['amount_paise'] else 'partially_refunded',amount_refunded=refunded,payment_id=payment['id'])
        job.update(financial_hold=True,hire_refund_hold=True,payout_status='held',hire_base_status=advance['status'])
    elif payment.get('status')=='captured' and payment.get('captured') is True:
        if advance.get('status') not in ('captured','refunded','partially_refunded'):
            worker=u.get('workers',job['worker_id']) or {}
            hire=u.get('hires',job['hire_id'])
            valid=(bool(hire) and hire['state']=='awaiting_payment' and job['state']=='accepted' and job.get('hire_base_status')=='pending' and
                   job.get('hire_payment_expires_at',0)>now and worker.get('status')=='approved' and not job.get('financial_hold'))
            valid=valid and not reservation_conflict(u,job['worker_id'],job['starts_epoch'],job['hourly_hire']['planned_minutes'],request_id=job['hire_id'],job_id=job['id'],now=now)
            advance.update(status='captured',payment_id=payment['id'],allocated=valid)
            if valid:
                job['hire_base_status']='captured'
                hire.update(state='booked',version=hire['version']+1);u.put('hires',hire['id'],hire)
                from hiring import notify
                notify(u,hire,job['worker_id'],'Hourly hire confirmed','The booking advance is verified. Review the reserved time before travelling.',True)
                notify(u,hire,job['customer_id'],'Booking advance verified','Your reserved hire is confirmed. Only actual work and the disclosed balance are due after completion.')
            else:
                advance['recovery']='refund_review';job.update(state='cancelled',hire_base_status='refund_review',financial_hold=True,hire_refund_hold=True,payout_status='held')
                if hire:
                    hire.update(state='cancelled',version=hire['version']+1);u.put('hires',hire['id'],hire)
                event(u,job,'HireAdvanceRefundRequired','payments',{'payment_record_id':advance['id']})
            u.put('receipts',payment['id'],dict(id=payment['id'],kind='hire_base',job_id=job['id'],amount_paise=advance['amount_paise'],currency='INR',verified_at=now))
            journal='hire-advance-'+advance['id']
            if not u.get('journals',journal):u.put('journals',journal,dict(id=journal,job_id=job['id'],status='posted',posted_at=now,lines=[{'account':'payment_clearing','debit':advance['amount_paise'],'credit':0},{'account':'customer_hire_advances','debit':0,'credit':advance['amount_paise']}]))
            job['version']+=1;audit(u,'HireAdvanceCaptured','razorpay',job_id=job['id'],payment_record_id=advance['id'],allocated=valid)
    else:advance['last_attempt_status']=payment.get('status','unknown')
    advance['checked_at']=now;u.put('payments',advance['id'],advance)
    job['hire_base_paid_paise']=advance_total(u,job['id']);u.put('jobs',job['id'],job)
    return advance


def install(core):
    import integrations as gateway
    r=APIRouter(prefix='/operations',tags=['Hourly hiring']);store=core.operations_store
    @r.get('/hiring/availability/{worker_id}')
    def availability(worker_id:str,response:Response):
        response.headers['Cache-Control']='no-store'
        def read(u):
            worker=u.get('workers',worker_id)
            if not worker or worker.get('status')!='approved':fail('NOT_FOUND','Professional unavailable.',404)
            return {'availability':public_availability(u,worker)}
        return store.run(read)
    @r.post('/jobs/{job_id}/hire-base/payment-order')
    def order(job_id:str,user=Depends(core.current_user)):
        if not (gateway.enabled('REPAIDO_PAYMENTS_ENABLED') and gateway.configured('RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET')):fail('PAYMENTS_UNAVAILABLE','Online booking payments are not enabled.',503)
        def reserve(u):
            job=u.get('jobs',job_id)
            if not job or job['customer_id']!=user['id'] or not job.get('hourly_hire'):fail('NOT_FOUND','Hourly booking unavailable.',404)
            if job['state']!='accepted' or job.get('hire_base_status')!='pending' or job['hire_payment_expires_at']<=time.time():fail('PAYMENT_NOT_DUE','This reservation is no longer payable. Check its status before retrying.')
            key=job['hire_base_payment_id'];old=u.get('payments',key)
            if old:return old,False
            record=dict(id=key,kind='hire_base',job_id=job_id,customer_id=user['id'],amount_paise=job['hourly_hire']['booking_advance_paise'],receipt=key,status='creating',created_at=time.time())
            u.put('payments',key,record);return record,True
        advance,create=store.run(reserve)
        if create:
            result=gateway.razorpay('orders',dict(amount=advance['amount_paise'],currency='INR',receipt=advance['receipt'],notes={'repaido_job':job_id,'hire_base':advance['id']}))
            if not result.get('id') or result.get('amount')!=advance['amount_paise'] or result.get('currency')!='INR' or result.get('receipt')!=advance['receipt']:
                fail('ORDER_MISMATCH','Provider setup requires reconciliation; do not pay another order.')
            def attach(u):
                current=u.get('payments',advance['id'])
                if current.get('order_id') and current['order_id']!=result['id']:fail('ORDER_CONFLICT','Multiple orders need payment review.')
                current['order_id']=result['id']
                if current['status']=='creating':current['status']='created'
                u.put('payments',current['id'],current);return current
            advance=store.run(attach)
        # A provider request may finish after the reservation expired or was cancelled.
        job=store.run(lambda u:u.get('jobs',job_id))
        if job['state']!='accepted' or job.get('hire_base_status')!='pending' or job['hire_payment_expires_at']<=time.time():fail('PAYMENT_NOT_DUE','Check this booking status before paying; the reservation is no longer pending.')
        if not advance.get('order_id'):fail('ORDER_RECONCILING','Payment setup is being checked. Reuse this reservation; do not pay again.',409)
        return dict(key_id=os.environ['RAZORPAY_KEY_ID'],order_id=advance['order_id'],amount=advance['amount_paise'],currency='INR')
    @r.post('/jobs/{job_id}/hire-base/payment-check')
    def check(job_id:str,user=Depends(core.current_user)):
        def access(u):
            job=u.get('jobs',job_id)
            if not job or job['customer_id']!=user['id'] or not job.get('hourly_hire'):fail('NOT_FOUND','Hourly booking unavailable.',404)
            advance=u.get('payments',job['hire_base_payment_id'])
            if not advance or not advance.get('order_id'):fail('ORDER_RECONCILING','The booking order is still being checked.',409)
            return advance
        advance=store.run(access)
        payments=gateway.razorpay('orders/'+advance['order_id']+'/payments').get('items',[])
        for row in payments:
            if row.get('order_id')!=advance['order_id']:fail('WRONG_ORDER','Payment belongs to another reservation.',403)
            store.run(lambda u:apply_capture(u,u.get('payments',advance['id']),row))
        saved=store.run(lambda u:u.get('payments',advance['id']))
        return {k:saved.get(k) for k in ('status','amount_paise','amount_refunded','recovery','allocated')}
    core.app.include_router(r)
