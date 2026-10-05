"""Versioned launch listing offer, explicit agreements and contractor review."""
import copy,time
from typing import Literal
from fastapi import APIRouter,Depends
from pydantic import Field
from operations import Input,fail
from integrations import audit
from hiring import FREE_START,FREE_END
YEAR_END=__import__('datetime').datetime(2027,12,29,tzinfo=__import__('zoneinfo').ZoneInfo('Asia/Kolkata')).timestamp()
SECTIONS=[dict(id='listing',title='Free launch listing & annual reward',text='Launch listing is free from 29 September to 29 December 2026. Approved professionals who meet the agreed performance criteria earn listing through 29 December 2027. No automatic charge, guaranteed jobs or guaranteed rank. Annual reference listing value: technician INR 12,000; specialist INR 18,000; verified contractor INR 24,000. This is a listing benefit, not a cash reward.'),dict(id='performance',title='Completion & performance',text='Only customer-confirmed, verified-paid work during the launch window counts. Meet the thresholds shown below; reviews must be genuine. Weekly rank uses actual category and city records. Missing evidence does not count as a pass. Open disputes pause the award for review; use support to challenge incorrect records.'),dict(id='conduct',title='Safety, scope & accountability',text='Follow the agreed scope, attendance, hygiene and platform work policies. Do not invent qualifications, reviews or completion records. Obtain approval before changes, extra parts or extra charges. Safeguard household privacy and report incidents. Team members must be authorised; the approved contractor remains responsible for agreed delivery.'),dict(id='verification',title='Verification & customer information',text='Contractor status requires separate company review of experience, qualifications and scope. Verification is not a blanket safety or statutory licence guarantee. Use private customer work briefs only to fulfil the agreed service; share with authorised team members only and delete copies when no longer needed.')]
DEFAULT=dict(version='partner-launch-v1',min_tasks=10,min_reviews=3,min_rating=4.2,min_on_time_percent=80,sections=SECTIONS,starts_at=FREE_START,ends_at=FREE_END,reward_ends_at=YEAR_END,annual_values={'technician':12000,'specialist':18000,'contractor':24000})
def policy(u):return u.get('partner_policy','current') or copy.deepcopy(DEFAULT)
def accept(u,wid,version,sections):
    p=policy(u)
    if version!=p['version'] or set(sections)!={s['id'] for s in p['sections']} or len(sections)!=len(p['sections']):fail('POLICY_REQUIRED','Read and acknowledge every current partner policy section.',422)
    old=u.get('partner_acceptances',wid)
    if old:return old # Never replace agreed thresholds for an existing participant.
    a=dict(worker_id=wid,policy=copy.deepcopy(p),accepted_sections=sections,accepted_at=time.time());u.put('partner_acceptances',wid,a);audit(u,'PartnerPolicyAccepted',wid,version=version);return a

def evaluate(u,wid):
    a=u.get('partner_acceptances',wid);w=u.get('workers',wid)
    if not a or not w:return {'status':'agreement_required'}
    p=a['policy'];now=time.time();start=max(p['starts_at'],a['accepted_at'])
    jobs=[j for j in u.all('jobs') if j.get('worker_id')==wid and start<=j.get('completed_at',0)<min(now,p['ends_at']) and j.get('state')=='completed' and j.get('payment_status')=='verified' and j.get('outcome')!='partial']
    ratings=[j['review']['rating'] for j in jobs if j.get('review')]
    measured=[j for j in jobs if j.get('starts_epoch') and j.get('started_at')]
    timely=sum(j['started_at']<=j['starts_epoch']+600 for j in measured)
    metrics=dict(completed=len(jobs),reviews=len(ratings),rating=round(sum(ratings)/len(ratings),2) if ratings else None,on_time_percent=round(100*timely/len(measured),2) if measured else None,measured_tasks=len(measured))
    hold=any(j.get('worker_id')==wid and (j.get('state') in ('disputed','stop_requested') or j.get('financial_hold') or j.get('review_pending')) for j in u.all('jobs'))
    checks=dict(approved=w.get('status')=='approved',completed=len(jobs)>=p['min_tasks'],reviews=len(ratings)>=p['min_reviews'],rating=bool(ratings) and sum(ratings)/len(ratings)>=p['min_rating'],on_time=len(measured)==len(jobs) and bool(measured) and 100*timely/len(measured)>=p['min_on_time_percent'],resolved=not hold)
    award=u.get('partner_entitlements',wid)
    if not award and p['ends_at']<=now<p['reward_ends_at'] and all(checks.values()):
        contractor=(u.get('contractor_applications',wid) or {}).get('status')=='approved';role='contractor' if contractor else w['role']
        award=dict(worker_id=wid,starts_at=p['ends_at'],ends_at=p['reward_ends_at'],awarded_at=now,policy_version=p['version'],reference_value=p['annual_values'][role],role=role,metrics=metrics,task_ids=[j['id'] for j in jobs]);u.put('partner_entitlements',wid,award);audit(u,'PartnerAnnualListingAwarded',wid,policy_version=p['version'])
    return dict(status='awarded' if award else 'review_hold' if hold else 'tracking' if now<p['ends_at'] else 'criteria_not_met',policy=p,metrics=metrics,checks=checks,award=award)
class Agreement(Input):
    version:str
    sections:list[str]=Field(max_length=10)
class Application(Input):
    expected_version:int=Field(ge=0)
    business_name:str=Field(min_length=2,max_length=120)
    team_size:int=Field(ge=1,le=500)
    experience:str=Field(min_length=30,max_length=2000)
    qualifications:str=Field(min_length=20,max_length=2000)
    scope:str=Field(min_length=20,max_length=2000)
class Review(Input):
    expected_version:int
    decision:Literal['approved','rejected']
    reason:str=Field(min_length=20,max_length=2000)
    evidence_reference:str=Field(min_length=10,max_length=500)
class Criteria(Input):
    expected_version:str
    min_tasks:int=Field(ge=1,le=100)
    min_reviews:int=Field(ge=1,le=100)
    min_rating:float=Field(ge=1,le=5)
    min_on_time_percent:int=Field(ge=1,le=100)

def install(core):
    r=APIRouter(prefix='/operations');store=core.operations_store
    def worker(u,user):
        w=u.get('workers',user['id'])
        if not w or not user.get('phone_verified'):fail('WORKER_REQUIRED','Use your verified worker account.',403)
        return w
    @r.get('/partner-policy')
    def get_policy():return store.run(policy)
    @r.get('/worker/partner-program')
    def status(user=Depends(core.current_user)):
        def read(u):
            worker(u,user);return dict(policy=policy(u),progress=evaluate(u,user['id']),application=u.get('contractor_applications',user['id']))
        return store.run(read)
    @r.post('/worker/partner-program/agree')
    def agree(body:Agreement,user=Depends(core.current_user)):
        def save(u):worker(u,user);accept(u,user['id'],body.version,body.sections);return evaluate(u,user['id'])
        return store.run(save)
    @r.post('/worker/contractor-application')
    def apply(body:Application,user=Depends(core.current_user)):
        def save(u):
            w=worker(u,user);old=u.get('contractor_applications',w['id']) or {'version':0}
            if not u.get('partner_acceptances',w['id']):fail('POLICY_REQUIRED','Agree to the partner rules first.')
            if old['version']!=body.expected_version:fail('VERSION_CHANGED','Refresh your application.')
            if old.get('status')=='approved':fail('ALREADY_APPROVED','Contact support to change verified contractor details.')
            a=dict(**body.model_dump(exclude={'expected_version'}),id=w['id'],name=w['name'],status='pending',version=old['version']+1,submitted_at=time.time());u.put('contractor_applications',w['id'],a);audit(u,'ContractorApplicationSubmitted',w['id']);return a
        return store.run(save)
    @r.get('/admin/partner-program')
    def admin_status(admin=Depends(core.operator)):
        return store.run(lambda u:dict(policy=policy(u),applications=u.all('contractor_applications'),awards=u.all('partner_entitlements')))
    @r.put('/admin/partner-policy')
    def update(body:Criteria,admin=Depends(core.operator)):
        def save(u):
            p=policy(u)
            if p['version']!=body.expected_version:fail('VERSION_CHANGED','Refresh the current policy.')
            if time.time()>=FREE_END:fail('CAMPAIGN_ENDED','The launch campaign is closed.')
            p={**p,**body.model_dump(exclude={'expected_version'}),'version':'partner-'+str(time.time_ns())};u.put('partner_policy','current',p);audit(u,'PartnerPolicyPublished',admin['id'],version=p['version']);return p
        return store.run(save)
    @r.post('/admin/contractors/{wid}/review')
    def review(wid:str,body:Review,admin=Depends(core.operator)):
        def save(u):
            a=u.get('contractor_applications',wid);w=u.get('workers',wid)
            if not a or not w:fail('NOT_FOUND','Application not found.',404)
            if a['version']!=body.expected_version:fail('VERSION_CHANGED','Refresh the application.')
            if body.decision=='approved' and w['status']!='approved':fail('IDENTITY_REQUIRED','Complete base identity approval first.')
            a.update(status=body.decision,reason=body.reason,evidence_reference=body.evidence_reference,reviewed_at=time.time(),reviewed_by=admin['id'],version=a['version']+1);u.put('contractor_applications',wid,a);w['contractor_verified']=body.decision=='approved';u.put('workers',wid,w);audit(u,'ContractorReviewed',admin['id'],worker_id=wid,decision=body.decision);return a
        return store.run(save)
    def tick():
        def run(u):
            ids=[a['worker_id'] for a in u.all('partner_acceptances')]
            return {'evaluated':len(ids),'awarded':sum(evaluate(u,wid)['status']=='awarded' for wid in ids)}
        return store.run(run)
    core.partner_program_tick=tick;core.app.include_router(r)
