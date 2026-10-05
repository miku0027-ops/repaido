"""Private recurring home plans, negotiated scope and per-visit work orders.
IST calendar periods; customer and worker acceptance precede scheduling. No auto debit.
"""
import calendar, copy, hashlib, os, time, uuid
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
from typing import Literal
from fastapi import APIRouter, Depends, Response
import home_briefs
from pydantic import Field, model_validator
from operations import Input, Pin, fail, metres, event, at_site
from integrations import audit, snapshot_policy, razorpay, enabled, configured

IST=ZoneInfo('Asia/Kolkata')
OFFERINGS=[
    dict(id='maid',name='Maid & daily home help',category='cleaning',recurring=True,description='Agreed cleaning and household tasks, with a shared visit calendar.'),
    dict(id='caretaker',name='Non-medical caretaker',category='care',recurring=True,description='Companionship and agreed everyday assistance for an adult at home. No nursing, medicine administration or emergency monitoring.'),
    dict(id='interior-design',name='Interior design',category='interiors',recurring=False,description='Room planning, finishes and a written design scope.'),
    dict(id='floor-plan',name='Home floor plans',category='civil',recurring=False,description='Discuss layout and drawings. Statutory approvals and structural sign-off require appropriately licensed professionals.'),
    dict(id='renovation',name='Home renovation & repairs',category='renovation',recurring=False,description='Define the work, milestones, materials and exclusions before approving an estimate.'),
    dict(id='decor',name='Home decor specialist',category='interiors',recurring=False,description='Furniture, lighting and decor guidance for your space.'),
    dict(id='civil-engineer',name='Civil engineer consultation',category='civil',recurring=False,description='A reviewed professional for planning and technical assessment, subject to qualification review.'),
    dict(id='contractor',name='Construction contractor',category='construction',recurring=False,description='Compare an agreed scope, timeline and itemised estimate before work.'),
]
BY_ID={o['id']:o for o in OFFERINGS}
DURATIONS={'trial7':0,'month1':1,'month3':3,'month6':6,'project':0}
CLOSED=('completed','cancelled')
PRESTART=('searching','offered','accepted','follow_up_scheduled')

def iso_today():return datetime.now(IST).date()
def day(value):
    try:return date.fromisoformat(value)
    except (ValueError,TypeError):fail('INVALID_DATE','Use a valid calendar date.',422)
def epoch(value,clock):return datetime.fromisoformat(value+'T'+clock).replace(tzinfo=IST).timestamp()
def add_months(d,n):
    y,m=divmod(d.year*12+d.month-1+n,12);return date(y,m+1,min(d.day,calendar.monthrange(y,m+1)[1]))
def service(sid):
    if sid not in BY_ID:fail('UNKNOWN_SERVICE','Choose a Repaido Home service.',422)
    return BY_ID[sid]
def distinct(values):return len(values)==len(set(values))

class Availability(Input):
    version:int=Field(default=0,ge=0)
    services:list[str]=Field(min_length=1,max_length=8)
    weekdays:list[int]=Field(min_length=1,max_length=7)
    start_time:str=Field(pattern=r'^([01]\d|2[0-3]):[0-5]\d$')
    end_time:str=Field(pattern=r'^([01]\d|2[0-3]):[0-5]\d$')
    off_dates:list[str]=Field(default_factory=list,max_length=90)
    experience:str=Field(min_length=10,max_length=1000)
    @model_validator(mode='after')
    def check(self):
        if not distinct(self.services) or any(s not in BY_ID for s in self.services) or not distinct(self.weekdays) or any(d not in range(7) for d in self.weekdays) or self.start_time>=self.end_time:raise ValueError('Choose valid services, days and working hours.')
        for d in self.off_dates:day(d)
        return self
class RequestPlan(Input):
    coupon_code:str|None=Field(default=None,max_length=30)
    service_id:str
    duration:Literal['trial7','month1','month3','month6','project']
    start_date:str
    time:str=Field(pattern=r'^([01]\d|2[0-3]):[0-5]\d$')
    minutes:int=Field(ge=30,le=480)
    weekdays:list[int]=Field(min_length=1,max_length=7)
    off_dates:list[str]=Field(default_factory=list,max_length=90)
    city:str
    address:str=Field(min_length=10,max_length=500)
    location:Pin
    phone:str=Field(pattern=r'^\+?[0-9]{10,15}$')
    recipient_name:str=Field(min_length=2,max_length=100)
    relationship:Literal['self','parent','family','authorised representative']
    consent:Literal[True]
    instructions:str=Field(min_length=10,max_length=1000)
    request_id:str=Field(min_length=16,max_length=100)
    requirements_version:str
    requirements:dict[str,str]
    @model_validator(mode="after")
    def validate_brief(self):
        self.requirements=home_briefs.validate(self.service_id,self.requirements_version,self.requirements)
        return self
    preferred_worker_id:str|None=Field(default=None,max_length=128)
class Quote(Input):
    expected_version:int
    worker_id:str
    period_price_paise:int=Field(gt=0,le=100000000)
    gst_bps:int=Field(ge=0,le=3000)
    checklist:list[str]=Field(min_length=1,max_length=12)
    exclusions:str=Field(min_length=10,max_length=1500)
    terms:str=Field(min_length=20,max_length=3000)
    @model_validator(mode='after')
    def check(self):
        if any(not 3<=len(t.strip())<=180 for t in self.checklist) or not distinct(self.checklist):raise ValueError('Use distinct, specific tasks, each 3–180 characters.')
        return self
class Decision(Input):
    expected_version:int
    action:Literal['accept','decline','pause','resume','cancel']
    reason:str=Field(default='',max_length=600)
class Change(Input):
    expected_version:int
    visit_id:str
    new_date:str|None=None
    new_time:str|None=Field(default=None,pattern=r'^([01]\d|2[0-3]):[0-5]\d$')
    reason:str=Field(min_length=5,max_length=600)
class ReviewChange(Input):
    expected_version:int
    accept:bool
class VisitLog(Input):
    expected_version:int
    hygiene:Literal[True]
    checked:list[int]=Field(default_factory=list,max_length=12)
    note:str=Field(min_length=5,max_length=1000)
class Issue(Input):
    reason:str=Field(min_length=10,max_length=2000)
class WorkerReview(Input):
    expected_version:int
    approved_services:list[str]=Field(max_length=8)
    reason:str=Field(min_length=10,max_length=1000)
class Resolve(Input):
    response:str=Field(min_length=10,max_length=2000)
class CheckPayment(Input):
    payment_id:str=Field(pattern=r'^pay_[A-Za-z0-9]+$')


def periods(body):
    start=day(body.start_date);n=DURATIONS[body.duration]
    boundaries=[add_months(start,i) for i in range(n+1)] if n else [start,start+timedelta(days=7 if body.duration=='trial7' else 1)]
    out=[]
    for i,(a,b) in enumerate(zip(boundaries,boundaries[1:])):
        visits=[];d=a
        while d<b:
            if (body.duration=='project' or d.weekday() in body.weekdays) and d.isoformat() not in body.off_dates:
                visits.append(dict(id=d.isoformat(),date=d.isoformat(),time=body.time,starts_epoch=epoch(d.isoformat(),body.time),status='scheduled',period=i))
            d+=timedelta(days=1)
        if not visits:fail('EMPTY_PERIOD','Each billing period needs at least one visit. Change the days off.',422)
        out.append(dict(index=i,start=a.isoformat(),end=(b-timedelta(days=1)).isoformat(),visits=visits))
    return out

def notify(u,p,uid,title,body):
    if not uid:return
    nid=hashlib.sha256(f"home:{p['id']}:{p['version']}:{uid}:{title}".encode()).hexdigest()
    u.put('notifications',nid,dict(id=nid,user_id=uid,plan_id=p['id'],destination='home_plan',title=title,body=body,created_at=time.time()))
    for d in u.all('devices'):
        if d['user_id']==uid and d['active']:
            did=hashlib.sha256((nid+d['id']).encode()).hexdigest();u.put('deliveries',did,dict(id=did,notification_id=nid,device_id=d['id'],status='pending'))

def require_plan(u,pid,uid,admin=False):
    p=u.get('home_plans',pid)
    if not p or not admin and uid not in (p['customer_id'],p.get('worker_id')):fail('NOT_FOUND','Home plan not found for this account.',404)
    return p

def version(p,value):
    if p['version']!=value:fail('VERSION_CHANGED','This plan changed. Refresh before continuing.')

def public(u,p,uid,admin=False):
    result=copy.deepcopy(p);result.pop('request_fingerprint',None);result.pop('location',None);result.pop('phone',None);result.pop('address',None)
    if uid==p['customer_id'] or admin:
        for k in ('location','address','phone'):result[k]=p[k]
    else:
        result.pop('recipient_name',None)
    for v in result['visits']:
        j=u.get('jobs',v.get('job_id',''))
        if j:
            v.update(status=j['state'],acknowledged_at=j.get('reminder_ack_at'),arrived_at=next((e['occurred_at_server_time'] for e in j['events'] if e['event_type']=='WorkerArrived'),None),started_at=j.get('started_at'),completed_at=j.get('completed_at'),payment_status=j['payment_status'],review=j.get('review'),daily_log=j.get('home_daily_log'),worker_name=j.get('worker_name'))
    result['brief_rows']=home_briefs.rows(p)
    result['invoices']=invoices(u,p)
    result['issues']=[i for i in u.all('home_issues') if i['plan_id']==p['id']]
    return result

def intervals_overlap(start,minutes,other,other_minutes):return start<other+other_minutes*60+1800 and other<start+minutes*60+1800

def conflict(u,wid,start,minutes,exclude_plan=None,exclude_job=None,exclude_contract=None):
    for project in u.all('contract_projects'):
        if project['id']==exclude_contract or project['status'] in ('completed','cancelled'):continue
        if any(m['worker_id']==wid and m['status']=='accepted' for m in project['team']) and start<project['ends_at'] and project['starts_at']<start+minutes*60:return True
    for p in u.all('home_plans'):
        if p['id']==exclude_plan or p.get('worker_id')!=wid or p['state'] not in ('offered','active') or (p['state']=='offered' and p.get('offer_expires_at',0)<=time.time()):continue
        for v in p['visits']:
            if v['status']=='scheduled' and intervals_overlap(start,minutes,v['starts_epoch'],p['minutes']):return True
    for j in u.all('jobs'):
        if j['id']==exclude_job or (exclude_plan and j.get('home_plan_id')==exclude_plan) or j.get('worker_id')!=wid or j['state'] in ('cancelled','completed','searching'):continue
        if intervals_overlap(start,minutes,j['starts_epoch'],j.get('duration_minutes',120)):return True
    return False

def candidate(u,p,w):
    if not w:return False
    a=u.get('home_availability',w['id']) or {}
    if w['status']!='approved' or p['service_id'] not in a.get('approved_services',[]) or w['city']!=p['city']:return False
    origin=w.get('location')
    # This checks the worker's contracted service area, not a fabricated travel ETA.
    if not origin or metres(origin,p['location'])>min(6,w['radius_km'])*1000:return False
    for v in p['visits']:
        if v['status']!='scheduled' or v['starts_epoch']<time.time():continue
        end=datetime.fromtimestamp(v['starts_epoch']+p['minutes']*60,IST)
        if day(v['date']).weekday() not in a['weekdays'] or v['date'] in a['off_dates'] or v['time']<a['start_time'] or end.date()!=day(v['date']) or end.strftime('%H:%M')>a['end_time'] or conflict(u,w['id'],v['starts_epoch'],p['minutes'],p['id']):return False
    return True

def allocate(p):
    for period in p['periods']:
        rows=[v for v in p['visits'] if v['period']==period['index']];q=p['quote'];net=q['period_price_paise'];tax=(net*q['gst_bps']+5000)//10000
        for i,v in enumerate(rows):v.update(base_paise=net//len(rows)+(i<net%len(rows)),tax_paise=tax//len(rows)+(i<tax%len(rows)))

def make_job(u,p,v,now):
    w=u.get('workers',p['worker_id']);jid=str(uuid.uuid5(uuid.NAMESPACE_URL,'repaido-home:'+p['id']+':'+v['id']));old=u.get('jobs',jid)
    if old:v['job_id']=jid;return
    if not w or w['status']!='approved':return
    j=dict(id=jid,booking_id=jid,work_order_id=jid,visit_id=str(uuid.uuid4()),procurement_version=3,customer_id=p['customer_id'],customer_name=p['customer_name'],worker_id=w['id'],worker_name=w['name'],worker_role=w['role'],service_id='home-'+p['service_id'],service_name=service(p['service_id'])['name'],category=service(p['service_id'])['category'],city=p['city'],address=p['address'],phone=p['phone'],location=p['location'],notes=p['instructions'],starts_at=datetime.fromtimestamp(v['starts_epoch'],IST).isoformat(),starts_epoch=v['starts_epoch'],duration_minutes=p['minutes'],state='accepted',version=1,scope_version=1,base_price_paise=v['base_paise'],total_paise=v['base_paise']+v['tax_paise'],home_gst_paise=v['tax_paise'],home_plan_id=p['id'],home_brief_rows=home_briefs.rows(p),home_visit_id=v['id'],home_checklist=p['quote']['checklist'],home_log_required=service(p['service_id'])['recurring'],payment_status='monthly_invoice',payout_status='held',events=[],penalties=[],scopes=[{'version':1,'price_paise':v['base_paise']+v['tax_paise'],'accepted_by':p['customer_id'],'accepted_at':p['customer_accepted_at']}],created_at=now,accepted_at=now,reminder_at=max(now,v['starts_epoch']-86400),attempted_workers=[w['id']],terms={'version':'home-plan-v1','reminder_grace_seconds':600,'missed_reminder_current_percent':0,'late_departure_percent':0,'free_cancel_before_start':True},service_terms={'version':p['quote_version'],'text':p['quote']['terms']+' Exclusions: '+p['quote']['exclusions']})
    if p.get('coupon') and v['period']==p['periods'][0]['index']:
        from coupons import attach_job
        discount=v['base_paise']*p['coupon']['bps']//10000
        attach_job(j,{**p['coupon'],'discount_paise':discount,'eligible_base_paise':v['base_paise']})
    j['settlement_policy']=copy.deepcopy(p['earnings_policy'])
    event(u,j,'RecurringVisitScheduled','scheduler');u.put('jobs',jid,j);v['job_id']=jid

def invoices(u,p):
    result=[]
    for period in p['periods']:
        key=p['id']+':'+str(period['index']);frozen=u.get('payments','home-'+key)
        rows=[];unresolved=False
        for v in p['visits']:
            if v['period']!=period['index']:continue
            j=u.get('jobs',v.get('job_id',''))
            if j and j['state']=='completed':
                from parts_payments import advance_total
                rows.append(dict(job_id=j['id'],date=v['date'],amount_paise=j['total_paise']-advance_total(u,j['id']),base_paise=j['base_price_paise'],gst_paise=j.get('home_gst_paise',0)))
            elif j and j['state'] not in ('cancelled',):unresolved=True
            elif v['status']=='scheduled':unresolved=True
        due=day(period['end'])<iso_today() and not unresolved
        result.append(dict(id=key,index=period['index'],start=period['start'],end=period['end'],rows=rows,total_paise=sum(r['amount_paise'] for r in rows),status=frozen['status'] if frozen else 'ready' if due else 'accruing',unresolved=unresolved,payment_id=frozen.get('payment_id') if frozen else None,scheduled_price_paise=p.get('quote',{}).get('period_price_paise'),billing_note='Only completed, customer-confirmed visits are collected. Unserved visits are not billed. Approved extras and tax are itemised. No automatic renewal or debit.'))
    return result

def apply_capture(u,a,payment):
    if payment.get('amount')!=a['amount_paise'] or payment.get('currency')!='INR':fail('AMOUNT_MISMATCH','Monthly payment needs reconciliation.')
    pid=payment['id'];existing=u.get('receipts',pid)
    if existing and existing.get('plan_invoice_id')!=a['id']:fail('PAYMENT_ALREADY_USED','This payment is already linked.')
    if a.get('payment_id') and a['payment_id']!=pid:fail('DUPLICATE_COLLECTION_REVIEW','A second payment needs finance review.')
    refund=max(int(payment.get('amount_refunded') or 0),a.get('amount_refunded',0));a['amount_refunded']=refund
    if refund or payment.get('status')=='refunded':
        a.update(status='refunded' if refund>=a['amount_paise'] else 'partially_refunded',payment_id=pid)
        for line in a['lines']:
            j=u.get('jobs',line['job_id']);j.update(payment_status='refund_review',payout_status='held',financial_hold=True)
            j.setdefault('invoice',{})['status']='refund_review';u.put('jobs',j['id'],j)
            settled=u.get('settlements',j['id'])
            if settled:
                settled.update(invalidated=True,status='refund_review',invalidated_at=time.time())
                u.put('settlements',j['id'],settled)
        audit(u,'HomePlanRefundNeedsAllocation','razorpay',plan_id=a['plan_id'],payment_id=pid)
    elif payment.get('status')=='captured' and payment.get('captured') is True and a.get('status') not in ('refunded','partially_refunded'):
        a.update(status='captured',payment_id=pid)
        for line in a['lines']:
            j=u.get('jobs',line['job_id']);j['payment_status']='verified' if j['state']=='completed' and not j.get('financial_hold') else 'refund_review';j['invoice']['status']='paid' if j['payment_status']=='verified' else 'refund_review';u.put('jobs',j['id'],j)
        if not existing:u.put('receipts',pid,dict(id=pid,plan_invoice_id=a['id'],amount_paise=a['amount_paise'],verified_at=time.time()))
    else:a['last_attempt_status']=payment.get('status','unknown')
    a['checked_at']=time.time();u.put('payments',a['id'],a);return {'status':a['status'],'payment_id':a.get('payment_id')}

def install(core):
    r=APIRouter(prefix='/operations',tags=['Repaido Home']);store=core.operations_store
    @r.get('/home/catalog')
    def catalog():return {'services':[{**s,'requirements':home_briefs.SCHEMAS[s['id']],'requirements_version':home_briefs.VERSION} for s in OFFERINGS],'durations':[{'id':'trial7','label':'7-day starter'},{'id':'month1','label':'1 month'},{'id':'month3','label':'3 months'},{'id':'month6','label':'6 months'}],'cities':core.CITIES,'timezone':'Asia/Kolkata','assurance':'Identity review, agreed hygiene checks, visit records and issue escalation. Availability and scope are confirmed before activation; no absolute safety or work guarantee.'}
    @r.post('/home/plans',status_code=201)
    def request(body:RequestPlan,user=Depends(core.current_user)):
        s=service(body.service_id);start=day(body.start_date);now=time.time()
        if body.city not in core.CITIES:fail('OUTSIDE_COVERAGE','Choose a supported service city.',422)
        if s['recurring']==(body.duration=='project'):fail('INVALID_DURATION','Choose a plan duration supported by this service.',422)
        if not distinct(body.weekdays) or any(d not in range(7) for d in body.weekdays):fail('INVALID_DAYS','Select distinct weekdays.',422)
        if not iso_today()<start<=iso_today()+timedelta(days=90):fail('INVALID_START','Choose a start date from tomorrow through the next 90 days.',422)
        if int(body.time[:2])*60+int(body.time[3:])+body.minutes>1440:fail('INVALID_HOURS','A visit must end on the same day.',422)
        for d in body.off_dates:day(d)
        spans=periods(body);key=hashlib.sha256((user['id']+body.request_id).encode()).hexdigest();fp=hashlib.sha256(body.model_dump_json().encode()).hexdigest()
        def save(u):
            old=u.get('home_request_keys',key)
            if old:
                if old['fingerprint']!=fp:fail('KEY_REUSED','This request key was used for different details.')
                return public(u,u.get('home_plans',old['id']),user['id'])
            preferred=u.get('workers',body.preferred_worker_id) if body.preferred_worker_id else None
            if body.preferred_worker_id and (not preferred or preferred['status']!='approved' or body.service_id not in (u.get('home_availability',body.preferred_worker_id) or {}).get('approved_services',[])):
                fail('PREFERRED_WORKER_UNAVAILABLE','This professional is not reviewed for that Home service. Return to Hire to choose another professional, or request a plan without a preference.',422)
            if sum(p['customer_id']==user['id'] and p['state'] not in CLOSED for p in u.all('home_plans'))>=12:fail('PLAN_LIMIT','Contact support to manage more than 12 open plans.',429)
            p={**body.model_dump(exclude={'request_id'}),'id':str(uuid.uuid4()),'customer_id':user['id'],'customer_name':user.get('name','Customer'),'version':1,'state':'requested','created_at':now,'periods':[{k:v for k,v in p.items() if k!='visits'} for p in spans],'visits':[v for p in spans for v in p['visits']],'changes':[],'quote_version':0}
            if preferred:p['preferred_worker_name']=preferred['name']
            if body.coupon_code:
                from coupons import reserve
                p['coupon']=reserve(u,user['id'],body.coupon_code,'home',0,'home:'+p['id'],now)
            u.put('home_plans',p['id'],p);u.put('home_request_keys',key,dict(id=p['id'],fingerprint=fp));audit(u,'HomePlanRequested',user['id'],plan_id=p['id']);notify(u,p,user['id'],'Home plan requested','Your scope and availability are awaiting team review. No booking or payment is confirmed.');return public(u,p,user['id'])
        return store.run(save)
    @r.get('/home/plans')
    def plans(user=Depends(core.current_user)):
        return store.run(lambda u:{'plans':[public(u,p,user['id']) for p in u.all('home_plans') if user['id'] in (p['customer_id'],p.get('worker_id'))]})
    @r.get('/home/plans/{pid}/brief.pdf')
    def brief(pid:str,user=Depends(core.current_user)):
        p=store.run(lambda u:require_plan(u,pid,user['id']))
        return Response(home_briefs.pdf(p),media_type='application/pdf',headers={'Content-Disposition':'attachment; filename="Repaido-work-brief.pdf"','Cache-Control':'no-store'})
    @r.get('/admin/home/plans/{pid}/brief.pdf')
    def admin_brief(pid:str,admin=Depends(core.operator)):
        p=store.run(lambda u:require_plan(u,pid,admin['id'],True))
        return Response(home_briefs.pdf(p),media_type='application/pdf',headers={'Content-Disposition':'attachment; filename="Repaido-work-brief.pdf"','Cache-Control':'no-store'})
    @r.get('/home/worker-availability')
    def get_availability(user=Depends(core.current_user)):
        return store.run(lambda u:{'availability':u.get('home_availability',user['id'])})
    @r.put('/home/worker-availability')
    def availability(body:Availability,user=Depends(core.current_user)):
        def save(u):
            w=u.get('workers',user['id']);old=u.get('home_availability',user['id']) or {'version':0}
            if not w or not user.get('phone_verified'):fail('WORKER_REQUIRED','Sign in to your verified mobile worker account first.',403)
            version(old,body.version)
            a={**body.model_dump(),'worker_id':w['id'],'name':w['name'],'version':body.version+1,'approved_services':[s for s in old.get('approved_services',[]) if s in body.services],'updated_at':time.time()}
            for p in u.all('home_plans'):
                if p.get('worker_id')!=w['id'] or p['state'] not in ('active','offered'):continue
                for v in p['visits']:
                    if v['status']=='scheduled' and v['starts_epoch']>time.time() and (p['service_id'] not in a['services'] or day(v['date']).weekday() not in a['weekdays'] or v['date'] in a['off_dates'] or v['time']<a['start_time'] or datetime.fromtimestamp(v['starts_epoch']+p['minutes']*60,IST).strftime('%H:%M')>a['end_time']):fail('COMMITTED_VISIT','Request an agreed day change in your plan before changing committed hours or days off.')
            u.put('home_availability',w['id'],a);audit(u,'HomeAvailabilitySaved',w['id']);return a
        return store.run(save)
    @r.get('/admin/home')
    def admin_home(admin=Depends(core.operator)):
        def read(u):
            audit(u,'HomePlanOperationsAccess',admin['id'])
            ps=u.all('home_plans');workers=u.all('workers')
            return {'plans':[public(u,p,admin['id'],True) for p in ps],'availability':u.all('home_availability'),'candidates':{p['id']:[{'id':w['id'],'name':w['name'],'rating':w.get('rating_sum',0)/w['rating_count'] if w.get('rating_count') else None,'review_count':w.get('rating_count',0)} for w in workers if candidate(u,p,w)] for p in ps if p['state'] in ('requested','offered')},'issues':u.all('home_issues')}
        return store.run(read)
    @r.post('/admin/home/workers/{wid}/review')
    def review(wid:str,body:WorkerReview,admin=Depends(core.operator)):
        def save(u):
            a=u.get('home_availability',wid);w=u.get('workers',wid)
            if not a or not w or w['status']!='approved':fail('APPROVAL_REQUIRED','Complete worker identity approval before reviewing home-service skills.')
            version(a,body.expected_version)
            if not set(body.approved_services)<=set(a['services']):fail('INVALID_SKILL','Only requested services can be approved.',422)
            a.update(approved_services=body.approved_services,review_reason=body.reason,reviewed_by=admin['id'],version=a['version']+1);u.put('home_availability',wid,a);audit(u,'HomeSkillsReviewed',admin['id'],worker_id=wid,services=body.approved_services);return a
        return store.run(save)
    @r.post('/admin/home/plans/{pid}/quote')
    def quote(pid:str,body:Quote,admin=Depends(core.operator)):
        def save(u):
            p=require_plan(u,pid,admin['id'],True);version(p,body.expected_version);w=u.get('workers',body.worker_id)
            if p['state'] not in ('requested','offered') or p.get('customer_accepted_at') or p.get('worker_accepted_at'):fail('QUOTE_LOCKED','Accepted quotes cannot change silently. Cancel and create a new request for a new scope.')
            if not w or not candidate(u,p,w):fail('NO_CANDIDATE','This worker cannot cover the entire schedule, service, city or travel radius. Choose another eligible professional.')
            if p['visits'][0]['starts_epoch']<=time.time():fail('START_PASSED','The start date passed. Ask the customer to request a future schedule.')
            p.update(quote=body.model_dump(exclude={'expected_version','worker_id'}),worker_id=w['id'],worker_name=w['name'],quote_version=p['quote_version']+1,offer_expires_at=min(time.time()+48*3600,p['visits'][0]['starts_epoch']-3600),state='offered',version=p['version']+1)
            allocate(p);u.put('home_plans',pid,p);audit(u,'HomeQuoteIssued',admin['id'],plan_id=pid);notify(u,p,p['customer_id'],'Review your home plan','Review the worker, schedule, monthly price, tax and terms before accepting.');notify(u,p,w['id'],'Home plan invitation','Review the full calendar, work and earnings terms. Accept only if you can fulfil the schedule.');return public(u,p,admin['id'],True)
        return store.run(save)
    @r.post('/home/plans/{pid}/decision')
    def decide(pid:str,body:Decision,user=Depends(core.current_user)):
        def save(u):
            p=require_plan(u,pid,user['id']);version(p,body.expected_version);owner=user['id']==p['customer_id'];a=body.action;now=time.time()
            if a in ('accept','decline'):
                if p['state']!='offered' or p.get('offer_expires_at',0)<=now:fail('NOT_OFFERED','This plan is not awaiting acceptance.')
                if a=='decline':
                    if len(body.reason.strip())<5:fail('REASON_REQUIRED','Explain why this plan needs revision.',422)
                    old_worker=p.get('worker_id');p.update(state='requested',decline_reason=body.reason);p.pop('worker_accepted_at',None);p.pop('customer_accepted_at',None);notify(u,p,old_worker,'Plan needs a new quote','The invitation is no longer active.');p.pop('worker_id',None);p.pop('worker_name',None)
                else:
                    w=u.get('workers',p['worker_id'])
                    if not w or not candidate(u,p,w) or p['visits'][0]['starts_epoch']<=now:fail('AVAILABILITY_CHANGED','The schedule or worker availability changed. Ask the team for a new quote.')
                    if not owner:
                        if not user.get('phone_verified'):fail('PHONE_REQUIRED','Use your phone-verified worker account.',403)
                        dummy={'id':p['id']};snapshot_policy(u,dummy,w)
                        if not dummy.get('settlement_policy'):fail('POLICY_REQUIRED','An approved earnings policy must be accepted before a plan can start.')
                        p['earnings_policy']=dummy['settlement_policy'];p['worker_accepted_at']=now
                    else:p['customer_accepted_at']=now
                    if p.get('customer_accepted_at') and p.get('worker_accepted_at'):p['state']='active'
            elif a in ('pause','cancel','resume'):
                if not owner:fail('OWNER_REQUIRED','Only the booking customer can pause, resume or cancel. Workers can propose day changes.',403)
                if a=='resume':
                    if p['state']!='paused' or not candidate(u,p,u.get('workers',p['worker_id'])):fail('RESUME_REVIEW','Availability must be reconfirmed before resuming.')
                    p['state']='active'
                else:
                    if p['state'] in CLOSED:fail('CLOSED','This plan is already closed.')
                    if len(body.reason.strip())<5:fail('REASON_REQUIRED','Add a short reason.',422)
                    for v in p['visits']:
                        j=u.get('jobs',v.get('job_id',''))
                        if j and j['state'] not in (*CLOSED,*PRESTART):fail('VISIT_OPEN','Finish or resolve the current visit before pausing or cancelling.')
                    for v in p['visits']:
                        if v['status']!='scheduled':continue
                        j=u.get('jobs',v.get('job_id',''))
                        if j and j['state'] in CLOSED:continue
                        if a=='cancel' or v['starts_epoch']<now+86400:
                            v['status']='cancelled' if a=='cancel' else 'paused'
                            if j:j.update(state='cancelled',version=j['version']+1,tracking_consent=False);j.pop('position',None);event(u,j,'PlanVisitCancelled',user['id']);u.put('jobs',j['id'],j)
                    p['state']='cancelled' if a=='cancel' else 'paused';p['pause_reason']=body.reason
            p['version']+=1;u.put('home_plans',pid,p);audit(u,'HomePlanDecision',user['id'],plan_id=pid,decision=a)
            notify(u,p,p['customer_id'],'Home plan updated','Open your calendar to review the latest plan status.');notify(u,p,p.get('worker_id'),'Home plan updated','Your agreed schedule has an update.');return public(u,p,user['id'])
        return store.run(save)
    @r.post('/home/plans/{pid}/changes')
    def propose(pid:str,body:Change,user=Depends(core.current_user)):
        def save(u):
            p=require_plan(u,pid,user['id']);version(p,body.expected_version)
            if p['state'] not in ('active','paused'):fail('NOT_ACTIVE','Only accepted plans can request day changes.')
            v=next((v for v in p['visits'] if v['id']==body.visit_id),None);j=u.get('jobs',v.get('job_id','')) if v else None
            if not v or v['status']!='scheduled' or j and j['state'] not in PRESTART or v['starts_epoch']<=time.time():fail('VISIT_STARTED','Only future, unstarted visits can be changed.')
            if any(c['status']=='pending' and c['visit_id']==v['id'] for c in p['changes']):fail('CHANGE_PENDING','This visit already has a pending change.')
            if body.new_date:
                d=day(body.new_date);period=p['periods'][v['period']]
                if not day(period['start'])<=d<=day(period['end']) or epoch(body.new_date,body.new_time or v['time'])<=time.time()+3600:fail('INVALID_ALTERNATIVE','Choose a future day within the same billing period.',422)
            c=dict(id=str(uuid.uuid4()),visit_id=v['id'],new_date=body.new_date,new_time=body.new_time or v['time'],reason=body.reason,proposer=user['id'],status='pending',created_at=time.time());p['changes'].append(c);p['version']+=1;u.put('home_plans',pid,p);notify(u,p,p['worker_id'] if user['id']==p['customer_id'] else p['customer_id'],'Day change requested','Review a requested day off or alternative visit. The current schedule remains until you accept.');return public(u,p,user['id'])
        return store.run(save)
    @r.post('/home/plans/{pid}/changes/{cid}')
    def change_review(pid:str,cid:str,body:ReviewChange,user=Depends(core.current_user)):
        def save(u):
            p=require_plan(u,pid,user['id']);version(p,body.expected_version);c=next((c for c in p['changes'] if c['id']==cid),None)
            if not c or c['status']!='pending' or c['proposer']==user['id']:fail('OTHER_PARTY_REQUIRED','The other party must review this pending change.')
            v=next(v for v in p['visits'] if v['id']==c['visit_id']);j=u.get('jobs',v.get('job_id',''))
            if j and j['state'] not in PRESTART or v['starts_epoch']<=time.time():fail('VISIT_STARTED','The visit has already begun or passed. Contact support.')
            if body.accept:
                if c['new_date']:
                    proposed=epoch(c['new_date'],c['new_time']);w=u.get('workers',p['worker_id']);a=u.get('home_availability',w['id']) or {}
                    if not w or w['status']!='approved' or p['service_id'] not in a.get('approved_services',[]) or c['new_date'] in a.get('off_dates',[]) or day(c['new_date']).weekday() not in a.get('weekdays',[]) or c['new_time']<a.get('start_time','24:00') or datetime.fromtimestamp(proposed+p['minutes']*60,IST).strftime('%H:%M')>a.get('end_time','00:00') or conflict(u,w['id'],proposed,p['minutes'],pid,j['id'] if j else None) or any(o['id']!=v['id'] and o['status']=='scheduled' and intervals_overlap(proposed,p['minutes'],o['starts_epoch'],p['minutes']) for o in p['visits']):fail('SLOT_CONFLICT','Choose an alternative within the worker’s available hours without another visit.')
                    v.update(date=c['new_date'],time=c['new_time'],starts_epoch=proposed)
                    if j:
                        j.update(starts_at=datetime.fromtimestamp(proposed,IST).isoformat(),starts_epoch=proposed,reminder_at=max(time.time(),proposed-86400),version=j['version']+1)
                        for k in ('reminder_ack_at','reminder_sent_at'):j.pop(k,None)
                else:
                    v['status']='off'
                    if j:j.update(state='cancelled',version=j['version']+1,tracking_consent=False)
                if j:event(u,j,'AgreedPlanDayChange',user['id']);u.put('jobs',j['id'],j)
            c.update(status='accepted' if body.accept else 'declined',decided_at=time.time());p['version']+=1;u.put('home_plans',pid,p);notify(u,p,c['proposer'],'Day change reviewed','Open the calendar to see the agreed schedule.');return public(u,p,user['id'])
        return store.run(save)
    @r.post('/home/jobs/{jid}/log')
    def log(jid:str,body:VisitLog,user=Depends(core.current_user)):
        def save(u):
            j=u.get('jobs',jid);w=u.get('workers',user['id'])
            if not j or not j.get('home_plan_id') or j.get('worker_id')!=user['id'] or not w or w['status']!='approved' or not user.get('phone_verified'):fail('NOT_FOUND','Assigned visit not available.',404)
            if j['version']!=body.expected_version or j['state'] not in ('arrived','in_progress'):fail('VISIT_STATE_CHANGED','Refresh the current visit before saving checks.')
            if j['state']=='arrived' and not at_site(j,time.time()):fail('ARRIVAL_LOCATION_REQUIRED','Refresh the service location or ask the customer to confirm arrival before recording checks.')
            if not distinct(body.checked) or any(i not in range(len(j['home_checklist'])) for i in body.checked):fail('INVALID_CHECKLIST','Choose valid agreed tasks.',422)
            if j['state']=='arrived':j['home_arrival_log']={**body.model_dump(exclude={'expected_version'}),'at':time.time()}
            else:j['home_daily_log']={**body.model_dump(exclude={'expected_version'}),'at':time.time()}
            j['version']+=1;event(u,j,'HomeVisitChecksSaved',user['id']);u.put('jobs',jid,j);return {'saved':True}
        return store.run(save)
    @r.post('/home/plans/{pid}/issues')
    def issue(pid:str,body:Issue,user=Depends(core.current_user)):
        def save(u):
            p=require_plan(u,pid,user['id']);i=dict(id=str(uuid.uuid4()),plan_id=pid,author=user['id'],reason=body.reason,status='open',created_at=time.time());u.put('home_issues',i['id'],i);audit(u,'HomeConcernRaised',user['id'],plan_id=pid);return i
        return store.run(save)
    @r.post('/admin/home/issues/{iid}/resolve')
    def resolve(iid:str,body:Resolve,admin=Depends(core.operator)):
        def save(u):
            i=u.get('home_issues',iid)
            if not i:fail('NOT_FOUND','Concern not found.',404)
            i.update(status='resolved',response=body.response,resolved_at=time.time(),resolved_by=admin['id']);u.put('home_issues',iid,i);p=u.get('home_plans',i['plan_id']);p['version']+=1;u.put('home_plans',p['id'],p);notify(u,p,i['author'],'Home plan concern updated','The team has replied to your concern. Open your plan to review.');return i
        return store.run(save)
    @r.post('/home/plans/{pid}/invoices/{index}/order')
    def payment_order(pid:str,index:int,user=Depends(core.current_user)):
        if not (enabled('REPAIDO_PAYMENTS_ENABLED') and configured('RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET')):fail('PAYMENTS_UNAVAILABLE','Online payment is not enabled. No charge was made.',503)
        key='home-'+pid+':'+str(index)
        def reserve(u):
            p=require_plan(u,pid,user['id'])
            if p['customer_id']!=user['id']:fail('OWNER_REQUIRED','Only the booking customer can pay.',403)
            old=u.get('payments',key)
            if old:return old,False
            inv=next((i for i in invoices(u,p) if i['index']==index),None)
            if not inv or inv['status']!='ready' or inv['total_paise']<=0:fail('INVOICE_NOT_READY','The period must end and all visits must be confirmed or resolved before payment.')
            for row in inv['rows']:
                j=u.get('jobs',row['job_id'])
                if j.get('financial_hold') or j.get('parts_refund_hold') or j['payment_status']=='verified' or u.get('payments',j['id']):fail('FINANCE_REVIEW','A visit needs financial review before monthly collection.')
            a=dict(id=key,kind='home_plan',plan_id=pid,period=index,customer_id=user['id'],amount_paise=inv['total_paise'],lines=inv['rows'],receipt='hp-'+hashlib.sha256(key.encode()).hexdigest()[:32],status='creating',created_at=time.time());u.put('payments',key,a);return a,True
        a,create=store.run(reserve)
        if create:
            result=razorpay('orders',dict(amount=a['amount_paise'],currency='INR',receipt=a['receipt'],notes={'repaido_home_invoice':key}))
            def finish(u):
                a=u.get('payments',key);a.update(order_id=result['id'],status='created');u.put('payments',key,a);return a
            a=store.run(finish)
        if a['status'] in ('captured','refunded','partially_refunded'):fail('NOT_DUE','This invoice cannot take another payment.')
        if not a.get('order_id'):fail('ORDER_RECONCILING','Payment setup is being reconciled. Retry status later; no second order will be created.')
        return {'key_id':os.environ['RAZORPAY_KEY_ID'],'order_id':a['order_id'],'amount':a['amount_paise'],'currency':'INR'}
    @r.post('/home/plans/{pid}/invoices/{index}/check')
    def check_payment(pid:str,index:int,body:CheckPayment,user=Depends(core.current_user)):
        def read(u):
            a=u.get('payments','home-'+pid+':'+str(index))
            if not a or a['customer_id']!=user['id']:fail('NOT_FOUND','Invoice unavailable.',404)
            return a
        a=store.run(read);p=razorpay('payments/'+body.payment_id)
        if p.get('order_id')!=a.get('order_id'):fail('WRONG_ORDER','Payment is not for this invoice.',403)
        return store.run(lambda u:apply_capture(u,u.get('payments',a['id']),p))
    def tick():
        def run(u):
            count=0;now=time.time()
            for p in u.all('home_plans'):
                if p['state']=='offered' and p.get('offer_expires_at',0)<=now:
                    p.update(state='requested',version=p['version']+1);notify(u,p,p.get('worker_id'),'Home invitation expired','No schedule was activated. The team can issue a new quote.');notify(u,p,p['customer_id'],'Home quote expired','Request a revised quote and schedule from the team. No payment was taken.')
                    for k in ('customer_accepted_at','worker_accepted_at','worker_id','worker_name'):p.pop(k,None)
                    u.put('home_plans',p['id'],p)
                if p['state'] not in ('active','paused'):continue
                dirty=False
                for v in p['visits']:
                    if v['status']!='scheduled':continue
                    j=u.get('jobs',v.get('job_id',''))
                    if not j and v['starts_epoch']<now:
                        v['status']='paused' if p['state']=='paused' else 'missed';dirty=True
                    elif not j and p['state']=='active' and v['starts_epoch']<=now+86400:
                        if conflict(u,p['worker_id'],v['starts_epoch'],p['minutes'],p['id']):
                            if not v.get('conflict_notified'):
                                v['conflict_notified']=True;dirty=True;notify(u,p,p['customer_id'],'Visit needs schedule review','A schedule conflict needs team attention. The visit is not confirmed for travel.')
                            continue
                        make_job(u,p,v,now);dirty=True;count+=int('job_id' in v)
                    elif j and j['state'] in PRESTART and now>v['starts_epoch']+p['minutes']*60+3600:
                        j.update(state='cancelled',version=j['version']+1,tracking_consent=False);j.pop('position',None);event(u,j,'RecurringVisitMissed','scheduler');u.put('jobs',j['id'],j);v['status']='missed';dirty=True
                if dirty:
                    p['version']+=1;u.put('home_plans',p['id'],p);notify(u,p,p['customer_id'],'Home calendar updated','Open your plan for the next visit or an attendance exception.');notify(u,p,p.get('worker_id'),'Home calendar updated','Review upcoming visits and acknowledge reminders in Tasks.')
                if day(p['periods'][-1]['end'])<iso_today() and all(v['status']!='scheduled' or (u.get('jobs',v.get('job_id','')) or {}).get('state') in CLOSED for v in p['visits']):p.update(state='completed',version=p['version']+1);u.put('home_plans',p['id'],p)
            return {'visits_created':count}
        return store.run(run)
    core.home_plans_tick=tick;core.app.include_router(r)
