"""Customer-owned recovery, support, receipts and profile lifecycle.
No administrative action impersonates customer consent to price or scope changes.
"""
import copy
import hashlib
import json
import time
import uuid
from datetime import datetime,timezone
from typing import Literal
from fastapi import APIRouter,Depends
from pydantic import Field
from operations import Input,Pin,fail,event,assign,public_job
from integrations import audit

class Address(Input):
    label: Literal['Home','Work','Other']
    address: str=Field(min_length=10,max_length=500)
    city: str=Field(min_length=2,max_length=80)
    location: Pin
    confirmed: Literal[True]
    landmark: str=Field(default='',max_length=200)
    accuracy: float|None=Field(default=None,ge=0,le=10000)
class Profile(Input):
    name: str=Field(min_length=2,max_length=100)
    language: Literal['en','hi','or']='en'
    theme: Literal['auto','light','dark']='auto'
    reduced_motion: bool=False
    larger_text: bool=False
class Ticket(Input):
    job_id: str|None=None
    category: Literal['general','booking','warranty','payment','penalty','safety']
    message: str=Field(min_length=5,max_length=3000)
    request_id: str=Field(min_length=16,max_length=100)
class Message(Input):
    message: str=Field(min_length=1,max_length=3000)
    request_id: str=Field(min_length=16,max_length=100)
class TicketAction(Input):
    action: Literal['escalate','resolve','reopen']
    reason: str=Field(min_length=10,max_length=1000)
    expected_version: int
class Recovery(Input):
    action: Literal['resume','follow_up','reassign','partial_close']
    reason: str=Field(min_length=10,max_length=1000)
    starts_at: str|None=None
    final_paise: int|None=Field(default=None,ge=0)
    final_base_paise: int|None=Field(default=None,ge=0)
    expected_version: int
    request_id: str=Field(min_length=16,max_length=100)
class Decision(Input):
    accept: bool
    expected_version: int
class Reason(Input):
    reason: str=Field(min_length=5,max_length=1000)
class ReviewReply(Input):
    text: str=Field(min_length=2,max_length=2000)
class PenaltyReview(Input):
    decision: Literal['uphold','waive']
    reason: str=Field(min_length=20,max_length=1000)
    code: Literal['MISSED_REMINDER','LATE_DEPARTURE']
    visit_id: str
class MetricCorrection(Input):
    source_kind: Literal['assignment','acknowledgement']
    source_id: str
    reason: str=Field(min_length=20,max_length=1000)
    exclude: bool


def identify(user,*parts):return hashlib.sha256(':'.join([user,*parts]).encode()).hexdigest()
def read_community_discovery(u, notification, uid):
    """Acknowledge the matching discovery in this account's community lane."""
    if notification.get('kind') != 'job_discovery' or notification.get('destination') != 'repaidians':
        return
    from repaidians import lane
    row = u.get(lane('rp_notifications', uid), notification['id'])
    project_id = notification.get('community_job_id') or notification.get('project_id')
    if row and row.get('type') == 'job_discovery' and project_id and row.get('jobId') == project_id and not row.get('read'):
        row['read'] = True
        u.put(lane('rp_notifications', uid), row['id'], row)

def scoped_job(u,jid,uid):
    j=u.get('jobs',jid)
    if not j or uid not in (j['customer_id'],j.get('worker_id')):fail('NOT_FOUND','Booking not found.',404)
    return j

def receipt(j):
    return dict(id=j['id'],service=j['service_name'],outcome=j.get('outcome','fulfilled' if j['state']=='completed' else j['state']),
        currency='INR',vendor_discount_paise=j.get('vendor_discount_paise',0),coupon=j.get('coupon'),promotion_discount_paise=j.get('promotion_discount_paise',0),base_paise=j['base_price_paise'],approved_parts_paise=sum(s.get('quote',{}).get('amount_paise',0) for s in j['scopes']),
        final_total_paise=j['total_paise'],payment_status=j['payment_status'],completed_at=j.get('completed_at'),
        scope_history=[{k:s[k] for k in ('version','price_paise','accepted_at') if k in s} for s in j['scopes']],
        document_type='payment_receipt' if j['payment_status']=='verified' else 'service_statement',
        tax_note='Amounts are the agreed catalogue charges. This service statement is not a GST tax invoice.')


def install(core):
    store=core.operations_store
    r=APIRouter(prefix='/operations',tags=['Customer lifecycle'])
    @r.get('/profile')
    def profile(user=Depends(core.current_user)):
        return store.run(lambda u:{'profile':u.get('profiles',user['id']) or {'name':user['name'],'theme':'auto','language':'en','reduced_motion':False,'larger_text':False}})
    @r.put('/profile')
    def update_profile(body:Profile,user=Depends(core.current_user)):
        store.run(lambda u:u.put('profiles',user['id'],body.model_dump()))
        return {'profile':body.model_dump()}
    @r.get('/addresses')
    def addresses(user=Depends(core.current_user)):
        return store.run(lambda u:{'addresses':[a for a in u.all('addresses') if a['user_id']==user['id'] and not a.get('deleted_at')]})
    @r.put('/addresses/{address_id}')
    def address(address_id:str,body:Address,user=Depends(core.current_user)):
        if len(address_id)>100 or '/' in address_id:fail('INVALID_ID','Invalid address reference.',422)
        if body.city not in core.CITIES:fail('OUTSIDE_COVERAGE','Choose a currently supported city.',422)
        key=identify(user['id'],address_id)
        a={**body.model_dump(), 'id':address_id,'user_id':user['id'],'updated_at':time.time()}
        store.run(lambda u:u.put('addresses',key,a));return {'address':a}
    @r.delete('/addresses/{address_id}')
    def delete_address(address_id:str,user=Depends(core.current_user)):
        # Booking address snapshots remain unchanged and remain role-protected.
        key=identify(user['id'],address_id)
        store.run(lambda u:u.put('addresses',key,dict(id=address_id,user_id=user['id'],deleted_at=time.time())))
        return {'status':'deleted'}

    @r.post('/support',status_code=201)
    def create_ticket(body:Ticket,user=Depends(core.current_user)):
        key=identify(user['id'],body.request_id);fingerprint=identify('',body.model_dump_json())
        def save(u):
            old=u.get('support_cases',key)
            if old:
                if old['fingerprint']!=fingerprint:fail('KEY_REUSED','Use a new request ID for a different issue.')
                return old
            j=scoped_job(u,body.job_id,user['id']) if body.job_id else None
            if body.category in ('warranty','payment','penalty','booking') and not j:fail('BOOKING_REQUIRED','Choose the related booking.',422)
            t=dict(id=key,customer_id=user['id'],job_id=body.job_id,category=body.category,state='open',version=1,created_at=time.time(),updated_at=time.time(),fingerprint=fingerprint)
            u.put('support_cases',key,t)
            u.put('support_messages',key,dict(id=key,case_id=key,actor_id=user['id'],actor_role='requester',message=body.message,created_at=time.time()))
            if j and body.category in ('warranty','payment','penalty','safety'):
                j['financial_hold']=True;j['payout_status']='held';u.put('jobs',j['id'],j)
            audit(u,'SupportCaseOpened',user['id'],case_id=key,job_id=body.job_id)
            from transactional_mail import enqueue
            enqueue(u,'support-opened:'+key,'support_opened',[t['customer_id']],{'record_type':'support_case','record_id':key,'path':'/?view=account&section=support'})
            return t
        return store.run(save)
    @r.get('/support')
    def tickets(user=Depends(core.current_user)):
        return store.run(lambda u:{'cases':sorted([t for t in u.all('support_cases') if t['customer_id']==user['id']],key=lambda t:t['updated_at'],reverse=True)})
    @r.get('/admin/support',dependencies=[Depends(core.operator)])
    def admin_tickets():return store.run(lambda u:{'cases':sorted(u.all('support_cases'),key=lambda t:t['updated_at'],reverse=True)})
    def case_access(u,case_id,uid,admin=False):
        t=u.get('support_cases',case_id)
        if not t or (not admin and t['customer_id']!=uid):fail('NOT_FOUND','Support case not found.',404)
        return t
    def messages(case_id,user,admin=False):
        def read(u):
            t=case_access(u,case_id,user['id'],admin)
            return {'case':t,'messages':sorted([m for m in u.all('support_messages') if m['case_id']==case_id],key=lambda m:m['created_at'])}
        return store.run(read)
    @r.get('/support/{case_id}')
    def customer_messages(case_id:str,user=Depends(core.current_user)):return messages(case_id,user)
    @r.get('/admin/support/{case_id}')
    def admin_messages(case_id:str,user=Depends(core.operator)):return messages(case_id,user,True)
    def post_message(case_id,body,user,admin=False):
        key=identify(user['id'],case_id,body.request_id)
        def save(u):
            t=case_access(u,case_id,user['id'],admin)
            old=u.get('support_messages',key)
            if old:
                if old['message']!=body.message:fail('KEY_REUSED','Message retry differs.')
                return old
            if t['state']=='resolved':fail('CASE_CLOSED','Reopen the case before replying.')
            m=dict(id=key,case_id=case_id,actor_id=user['id'],actor_role='support' if admin else 'requester',message=body.message,created_at=time.time())
            u.put('support_messages',key,m);t.update(updated_at=time.time(),version=t['version']+1);u.put('support_cases',case_id,t)
            if admin:
                from transactional_mail import enqueue
                enqueue(u,'support-reply:'+key,'support_reply',[t['customer_id']],{'record_type':'support_case','record_id':case_id,'path':'/?view=account&section=support'})
            return m
        return store.run(save)
    @r.post('/support/{case_id}/messages')
    def reply(case_id:str,body:Message,user=Depends(core.current_user)):return post_message(case_id,body,user)
    @r.post('/admin/support/{case_id}/messages')
    def admin_reply(case_id:str,body:Message,user=Depends(core.operator)):return post_message(case_id,body,user,True)
    def case_action(case_id,body,user,admin=False):
        def save(u):
            t=case_access(u,case_id,user['id'],admin)
            if t['version']!=body.expected_version:fail('STALE_VERSION','Refresh this support case.')
            if body.action=='resolve' and not admin:fail('ADMIN_REQUIRED','Support must record the resolution.',403)
            t.update(state={'escalate':'escalated','resolve':'resolved','reopen':'open'}[body.action],resolution=body.reason,version=t['version']+1,updated_at=time.time())
            u.put('support_cases',case_id,t)
            if t.get('job_id'):
                j=u.get('jobs',t['job_id'])
                other=any(c['job_id']==j['id'] and c['id']!=case_id and c['state']!='resolved' and c['category'] in ('warranty','payment','penalty','safety') for c in u.all('support_cases'))
                j['financial_hold']=other or (t['state']!='resolved' and t['category'] in ('warranty','payment','penalty','safety'))
                u.put('jobs',j['id'],j)
            audit(u,'SupportCase'+body.action,user['id'],case_id=case_id,reason=body.reason)
            from transactional_mail import enqueue
            enqueue(u,'support-state:'+case_id+':'+str(t['version']),'support_updated',[t['customer_id']],{'record_type':'support_case','record_id':case_id,'path':'/?view=account&section=support'})
            return t
        return store.run(save)
    @r.post('/support/{case_id}/actions')
    def customer_action(case_id:str,body:TicketAction,user=Depends(core.current_user)):return case_action(case_id,body,user)
    @r.post('/admin/support/{case_id}/actions')
    def admin_action(case_id:str,body:TicketAction,user=Depends(core.operator)):return case_action(case_id,body,user,True)

    @r.post('/jobs/{job_id}/stop-request')
    def stop_request(job_id:str,body:Reason,user=Depends(core.current_user)):
        def save(u):
            j=scoped_job(u,job_id,user['id'])
            if j['state']=='stop_requested':return public_job(u,j,user['id'])
            if j['state'] not in ('in_progress','collecting_parts','arrived','follow_up_required'):fail('NOT_ACTIVE','This visit is not active.')
            from procurement import pause_timer
            pause_timer(j,time.time())
            j.update(state='stop_requested',stop_reason=body.reason,financial_hold=True,payout_status='held',version=j['version']+1,tracking_consent=False)
            j.pop('position',None);event(u,j,'SafeStopRequested',user['id']);u.put('jobs',job_id,j);return public_job(u,j,user['id'])
        return store.run(save)
    @r.post('/jobs/{job_id}/confirm-arrival')
    def confirm_arrival(job_id:str,body:Reason,user=Depends(core.current_user)):
        def save(u):
            j=scoped_job(u,job_id,user['id'])
            if user['id']!=j['customer_id'] or j['state']!='en_route':fail('CUSTOMER_CONFIRMATION_REQUIRED','Only the customer can confirm physical arrival for this visit.',403)
            j.update(state='arrived',manual_arrival={'confirmed_by':user['id'],'at':time.time(),'reason':body.reason},version=j['version']+1)
            event(u,j,'CustomerConfirmedArrival',user['id']);u.put('jobs',job_id,j);return public_job(u,j,user['id'])
        return store.run(save)
    @r.post('/admin/jobs/{job_id}/resolution')
    def resolution(job_id:str,body:Recovery,admin=Depends(core.operator)):
        key=identify(admin['id'],job_id,body.request_id)
        def save(u):
            old=u.get('resolutions',key)
            if old:
                if old['proposal']!=body.model_dump():fail('KEY_REUSED','Resolution retry differs.')
                return old
            j=u.get('jobs',job_id)
            if not j or j['state'] not in ('disputed','stop_requested','follow_up_required','completion_pending'):fail('RECOVERY_NOT_REQUIRED','No recovery decision is pending.')
            if j['version']!=body.expected_version:fail('STALE_VERSION','Refresh the booking before proposing a resolution.')
            if any(x['job_id']==job_id and x['status']=='pending' for x in u.all('resolutions')):fail('PENDING_RESOLUTION','Withdraw or decide the existing proposal first.')
            if body.action in ('follow_up','reassign'):
                try:
                    date=datetime.fromisoformat(body.starts_at)
                    if date.tzinfo is None or not time.time()+3600<date.timestamp()<time.time()+30*86400:raise ValueError()
                except (TypeError,ValueError):fail('INVALID_SLOT','A future follow-up appointment is required.',422)
            if body.action=='partial_close' and (j.get('promotion_discount_paise') or j.get('vendor_discount_paise')):
                fail('PROMOTIONAL_SETTLEMENT_REVIEW','A discounted partial completion needs finance review. Use the dispute/refund route; do not remove an agreed discount or change worker earnings silently.')
            if body.action=='partial_close' and (body.final_paise is None or body.final_paise>j['total_paise'] or body.final_base_paise is None or body.final_base_paise>min(body.final_paise,j['base_price_paise']) or body.final_paise-body.final_base_paise>j['total_paise']-j['base_price_paise']):fail('INVALID_AMOUNT','Final amount must not exceed the customer-approved scope.',422)
            if any(a.get('job_id')==job_id for a in u.all('payments')) or u.get('payouts',job_id):fail('FINANCE_REVIEW_REQUIRED','Reconcile the existing payment before changing the final invoice.')
            proposal=dict(id=key,job_id=job_id,status='pending',proposal=body.model_dump(),created_at=time.time(),expires_at=time.time()+7*86400)
            u.put('resolutions',key,proposal);audit(u,'RecoveryProposed',admin['id'],job_id=job_id,resolution_id=key);return proposal
        return store.run(save)
    @r.get('/jobs/{job_id}/resolutions')
    def resolutions(job_id:str,user=Depends(core.current_user)):
        def read(u):
            scoped_job(u,job_id,user['id']);return {'resolutions':[x for x in u.all('resolutions') if x['job_id']==job_id]}
        return store.run(read)
    @r.post('/resolutions/{resolution_id}/decision')
    def decide_resolution(resolution_id:str,body:Decision,user=Depends(core.current_user)):
        def save(u):
            p=u.get('resolutions',resolution_id)
            if not p:fail('NOT_FOUND','Resolution not found.',404)
            j=scoped_job(u,p['job_id'],user['id'])
            if user['id']!=j['customer_id']:fail('CUSTOMER_REQUIRED','Only the customer decides the proposed resolution.',403)
            if p['status']!='pending':
                if p['status'] in ('accepted','rejected') and (p['status']=='accepted')==body.accept:return public_job(u,j,user['id'])
                fail('ALREADY_DECIDED','This proposal was already decided.')
            if j['version']!=body.expected_version or p['proposal']['expected_version']!=j['version'] or p['expires_at']<time.time():fail('STALE_RESOLUTION','Ask support to refresh the proposal.')
            p.update(status='accepted' if body.accept else 'rejected',decided_at=time.time(),decided_by=user['id'])
            if body.accept:
                proposal=p['proposal'];action=proposal['action']
                j['version']+=1;j['financial_hold']=any(c.get('job_id')==j['id'] and c['state']!='resolved' and c['category'] in ('warranty','payment','penalty','safety') for c in u.all('support_cases'))
                if action=='partial_close':
                    j.update(state='completed',outcome='partial',settlement_base_paise=proposal['final_base_paise'],total_paise=proposal['final_paise'],completed_at=time.time(),invoice={'id':j['id'],'total_paise':proposal['final_paise'],'status':'payment_due'})
                    if proposal['final_paise']==0:j['payment_status']='no_payment_due';j['invoice']['status']='no_payment_due'
                    j['scope_version']=len(j['scopes'])+1
                    j['scopes'].append({'version':j['scope_version'],'price_paise':proposal['final_paise'],'accepted_at':time.time(),'accepted_by':user['id'],'resolution_id':resolution_id})
                elif action=='resume':
                    j['state']='en_route';j.pop('manual_arrival',None)
                else:
                    if action=='reassign' and j.get('started_at'):j['allocation_review_required']=True
                    j.setdefault('visit_history',[]).append({k:copy.deepcopy(j.get(k)) for k in ('visit_id','worker_id','state','accepted_at','started_at','proposal','penalties')})
                    j.update(visit_id=str(uuid.uuid4()),starts_at=proposal['starts_at'],starts_epoch=datetime.fromisoformat(proposal['starts_at']).timestamp(),attempted_workers=[j['worker_id']] if action=='reassign' and j.get('worker_id') else [])
                    for field in ('completion_notes','started_at','accepted_at','reminder_ack_at','reminder_sent_at','departed_at','position','manual_arrival'):j.pop(field,None)
                    j['reminder_at']=j['starts_epoch']-7200
                    assign(u,j,time.time()) # new visit must be accepted; never fabricate acceptance
                j['tracking_consent']=False;j.pop('position',None)
                event(u,j,'RecoveryAccepted',user['id']);u.put('jobs',j['id'],j)
            u.put('resolutions',resolution_id,p);return public_job(u,j,user['id'])
        return store.run(save)
    @r.post('/admin/resolutions/{resolution_id}/withdraw')
    def withdraw(resolution_id:str,body:Reason,admin=Depends(core.operator)):
        def save(u):
            p=u.get('resolutions',resolution_id)
            if not p or p['status']!='pending':fail('NOT_PENDING','Proposal is no longer pending.')
            p.update(status='withdrawn',withdraw_reason=body.reason);u.put('resolutions',resolution_id,p);audit(u,'RecoveryWithdrawn',admin['id'],resolution_id=resolution_id);return p
        return store.run(save)
    @r.get('/jobs/{job_id}/receipt')
    def get_receipt(job_id:str,user=Depends(core.current_user)):
        return store.run(lambda u:receipt(scoped_job(u,job_id,user['id'])))
    @r.get('/jobs/{job_id}/rebook-draft')
    def rebook(job_id:str,user=Depends(core.current_user)):
        def read(u):
            j=scoped_job(u,job_id,user['id'])
            if user['id']!=j['customer_id']:fail('CUSTOMER_REQUIRED','Customer account required.',403)
            return {k:j[k] for k in ('service_id','service_name','category','city','address','phone','location','notes')}
        return store.run(read)
    @r.post('/jobs/{job_id}/review/reply')
    def review_reply(job_id:str,body:ReviewReply,user=Depends(core.current_user)):
        def save(u):
            j=scoped_job(u,job_id,user['id'])
            if user['id']!=j.get('worker_id') or not j.get('review'):fail('REVIEW_REQUIRED','Only the assigned worker can reply to an existing review.',403)
            j['review']['worker_reply']={'text':body.text,'at':time.time()};u.put('jobs',job_id,j);return j['review']
        return store.run(save)
    @r.post('/jobs/{job_id}/review/report')
    def report_review(job_id:str,body:Reason,user=Depends(core.current_user)):
        def save(u):
            j=scoped_job(u,job_id,user['id'])
            if not j.get('review'):fail('NO_REVIEW','No review exists.')
            key=identify(user['id'],job_id);u.put('review_reports',key,dict(id=key,job_id=job_id,reported_by=user['id'],reason=body.reason,state='pending',created_at=time.time()))
            return {'status':'reported','message':'The review remains visible during moderation.'}
        return store.run(save)
    @r.post('/admin/jobs/{job_id}/penalty-review')
    def penalty_review(job_id:str,body:PenaltyReview,admin=Depends(core.operator)):
        def save(u):
            j=u.get('jobs',job_id)
            if not j:fail('NOT_FOUND','Booking not found.',404)
            if u.get('payouts',job_id):fail('SETTLED_ADJUSTMENT_REQUIRED','A payout already exists. Resolve it before changing payable earnings.')
            matching=[p for p in j['penalties'] if p['code']==body.code and p['visit_id']==body.visit_id]
            if not matching:fail('NOT_FOUND','Penalty assessment not found.',404)
            p=matching[0];p.update(status='waived' if body.decision=='waive' else 'upheld',review_reason=body.reason,reviewed_by=admin['id'])
            for o in u.all('penalty_obligations'):
                if o['source_job_id']==job_id and o['id']==hashlib.sha256(f"{job_id}:{body.visit_id}:{body.code}".encode()).hexdigest() and body.code=='MISSED_REMINDER':
                    target=o.get('target_job_id')
                    if target and u.get('payouts',target):fail('SETTLED_ADJUSTMENT_REQUIRED','Next-task payout exists; adjustment needs settlement review.')
                    o['waived']=body.decision=='waive';u.put('penalty_obligations',o['id'],o)
                    if target:
                        s=u.get('settlements',target)
                        if s:s['invalidated']=True;u.put('settlements',target,s)
            s=u.get('settlements',job_id)
            if s:s['invalidated']=True;u.put('settlements',job_id,s)
            u.put('jobs',job_id,j);audit(u,'PenaltyReviewed',admin['id'],job_id=job_id,**body.model_dump());return {'penalty':p}
        return store.run(save)
    @r.post('/admin/reward-metrics/{worker_id}/correction')
    def correct_metric(worker_id:str,body:MetricCorrection,admin=Depends(core.operator)):
        def save(u):
            source=u.get('assignment_metrics' if body.source_kind=='assignment' else 'jobs',body.source_id)
            if not source or source.get('worker_id')!=worker_id:fail('SOURCE_NOT_FOUND','Metric is not associated with this worker.',404)
            key=identify(worker_id,body.source_kind,body.source_id)
            correction=dict(id=key,worker_id=worker_id,**body.model_dump(),reviewed_by=admin['id'],at=time.time())
            u.put('metric_exclusions',key,correction);audit(u,'MetricEvidenceCorrected',admin['id'],correction_id=key,worker_id=worker_id,**body.model_dump());return correction
        return store.run(save)
    @r.post('/notifications/{notification_id}/read')
    def read_notification(notification_id:str,user=Depends(core.current_user)):
        def save(u):
            n=u.get('notifications',notification_id)
            if not n or n['user_id']!=user['id']:fail('NOT_FOUND','Notification not found.',404)
            n['read_at']=n.get('read_at') or time.time();u.put('notifications',notification_id,n)
            read_community_discovery(u,n,user['id'])
            return {'status':'read','read_at':n['read_at']}
        return store.run(save)
    @r.post('/notifications/read-all')
    def read_notifications(user=Depends(core.current_user)):
        def save(u):
            stamp=time.time()
            # Matches the 100 most recent messages displayed by the inbox; keep
            # transaction writes below Firestore's per-commit limit.
            rows=sorted(u.find('notifications','user_id',user['id']),key=lambda n:n.get('created_at',0),reverse=True)[:100]
            for n in rows:
                if not n.get('read_at'):
                    n['read_at']=stamp;u.put('notifications',n['id'],n)
                read_community_discovery(u,n,user['id'])
            return {'status':'read','read_at':stamp}
        return store.run(save)
    @r.get('/admin/review-reports',dependencies=[Depends(core.operator)])
    def review_reports():return store.run(lambda u:{'reports':u.all('review_reports')})
    @r.post('/admin/review-reports/{report_id}/resolve')
    def resolve_report(report_id:str,body:Reason,admin=Depends(core.operator)):
        def save(u):
            report=u.get('review_reports',report_id)
            if not report:fail('NOT_FOUND','Report not found.',404)
            report.update(state='reviewed',reason_for_decision=body.reason,reviewed_by=admin['id'],reviewed_at=time.time())
            u.put('review_reports',report_id,report);audit(u,'ReviewReportResolved',admin['id'],report_id=report_id,reason=body.reason)
            return report # Reporting never deletes a negative rating or changes its aggregate.
        return store.run(save)
    core.app.include_router(r)
