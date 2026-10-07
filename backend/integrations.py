"""Private verification, provider reconciliation and durable notification delivery.
External calls are deliberately outside retryable database transactions.
"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
import uuid
import urllib.request
from typing import Literal
from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import Response
from pydantic import Field
from operations import Input, Position, fail, event, metres, at_site


def digest(value): return hashlib.sha256(value.encode()).hexdigest()
def enabled(name): return os.getenv(name, '').lower() == 'true'
def configured(*names): return all(os.getenv(n) for n in names)
def audit(u, action, actor, **fields):
    key = str(uuid.uuid4())
    u.put('audit', key, dict(id=key, action=action, actor_id=actor, at=time.time(), **fields))


def razorpay(path, body=None, payout=False, key=None):
    prefix = 'RAZORPAYX' if payout else 'RAZORPAY'
    if not configured(prefix+'_KEY_ID', prefix+'_KEY_SECRET'):
        fail('PROVIDER_NOT_CONFIGURED', 'This payment provider is not connected. No money has been moved.', 503)
    auth = base64.b64encode(f"{os.environ[prefix+'_KEY_ID']}:{os.environ[prefix+'_KEY_SECRET']}".encode()).decode()
    headers = {'Authorization': 'Basic '+auth, 'Content-Type':'application/json'}
    if key: headers['X-Payout-Idempotency'] = key
    request = urllib.request.Request('https://api.razorpay.com/v1/'+path,
        data=json.dumps(body).encode() if body is not None else None, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=20) as response: return json.load(response)
    except Exception:
        # Never include request bodies, bank data, provider responses or credentials in errors.
        fail('PROVIDER_OUTCOME_UNKNOWN', 'Provider response unavailable. Check status before trying again; do not start another payment.', 503)


class Device(Input):
    token: str = Field(min_length=20, max_length=4096)
    platform: Literal['android', 'web']
    audience: Literal['customer','agent','unspecified'] = 'unspecified'
    promotional_capable: bool = False
class Consent(Input):
    consent: Literal[True]
class BankLink(Input):
    validation_id: str = Field(pattern=r'^fav_[A-Za-z0-9]+$')
    reason: str = Field(min_length=10, max_length=500)
class IdentityDecision(Input):
    decision: Literal['approved','rejected']
    reason: str = Field(min_length=10, max_length=500)
    evidence_reference: str = Field(min_length=8, max_length=200)
    document_ids: list[str] = Field(default_factory=list, max_length=100)
    checks: list[Literal['identity','date_of_birth','address','pan','tools','one_to_one_identity_match']]
class PaymentCheck(Input):
    payment_id: str = Field(pattern=r'^pay_[A-Za-z0-9]+$')
class Policy(Input):
    version: str = Field(pattern=r'^[a-zA-Z0-9_-]{3,80}$')
    worker_share_bps: int = Field(ge=0, le=10000)
    penalty_cap_bps: int = Field(ge=0, le=10000)
    stack_penalties: bool
    base: Literal['worker_share_of_base_service_excluding_parts']
    bonus_reserve_bps: int = Field(default=1000, ge=0, le=10000)
    penalty_mode: Literal['legacy_percentages', 'highest_single'] = 'highest_single'
    reason: str = Field(min_length=20, max_length=500)
class PolicyConsent(Input):
    version: str
    consent: Literal[True]
class PayoutApproval(Input):
    expected_net_paise: int = Field(ge=0)
    reason: str = Field(min_length=10, max_length=500)
class TrackingPing(Position):
    sequence: int = Field(ge=1)


def apply_payment(u, payment):
    """Only called with an authenticated provider GET, never browser/webhook claims."""
    from contract_records import apply_provider_payment as apply_contract_payment
    contract = apply_contract_payment(u, payment)
    if contract is not None: return contract
    attempts = [a for a in u.all('payments') if a.get('order_id') == payment.get('order_id')]
    if not attempts:
        from repaidians_billing import apply_provider_payment
        community = apply_provider_payment(u, payment)
        if community is not None: return community
        from rentals import apply_payment as apply_rental_payment
        rental = apply_rental_payment(u, payment)
        if rental is not None: return rental
    if len(attempts) != 1: fail('ORDER_NOT_FOUND', 'Payment does not belong to a Repaido invoice.', 404)
    a = attempts[0]
    if a.get('kind')=='shop_prime':
        from shop_prime import apply_capture
        return apply_capture(u,a,payment)
    if a.get('kind')=='home_plan':
        from home_plans import apply_capture
        return apply_capture(u,a,payment)
    if a.get('kind')=='parts':
        from parts_payments import apply_capture
        return apply_capture(u,a,payment)
    if payment.get('currency') != 'INR' or payment.get('amount') != a['amount_paise']:
        fail('AMOUNT_MISMATCH', 'Payment needs reconciliation. No settlement was released.')
    j = u.get('jobs', a['job_id'])
    recipients=list(filter(None,[j.get('customer_id'),j.get('worker_id')]))
    pid = payment['id']
    existing = u.get('receipts', pid)
    if existing and existing['job_id'] != j['id']: fail('PAYMENT_ALREADY_USED', 'Payment already linked.')
    previous_refund=a.get('amount_refunded',0)
    refund = max(int(payment.get('amount_refunded') or 0), previous_refund)
    a['amount_refunded'] = refund
    if refund or payment.get('status') == 'refunded':
        a.update(status='refunded' if refund >= a['amount_paise'] else 'partially_refunded', payment_id=pid)
        j.update(payment_status=a['status'], payout_status='held')
        j.setdefault('invoice', {})['status'] = a['status']
        audit(u, 'RefundReconciled', 'razorpay', job_id=j['id'], payment_id=pid, refunded_paise=refund)
        if refund>previous_refund and recipients:
            from transactional_mail import enqueue
            enqueue(u,digest('booking-refund:'+pid+':'+str(refund)),'booking_refund_recorded',
                    recipients,
                    {'record_type':'payment','record_id':j['id'],'path':'/'})
    elif payment.get('status') == 'captured' and payment.get('captured') is True:
        # A stale captured notification cannot roll back a refund already observed.
        if a.get('status') in ('refunded','partially_refunded'): return a
        if a.get('payment_id') and a['payment_id'] != pid:
            fail('DUPLICATE_COLLECTION_REVIEW', 'A second payment needs refund review.')
        a.update(status='captured', payment_id=pid)
        j['payment_status'] = 'verified' if j['state'] == 'completed' else 'refund_review'
        j.setdefault('invoice', {})['status'] = 'paid' if j['state'] == 'completed' else 'refund_review'
        if not existing:
            u.put('receipts', pid, dict(id=pid, job_id=j['id'], amount_paise=a['amount_paise'], currency='INR', verified_at=time.time()))
            audit(u, 'PaymentCaptured', 'razorpay', job_id=j['id'], payment_id=pid)
            if recipients:
                from transactional_mail import enqueue
                enqueue(u,pid,'booking_payment_recorded',recipients,
                        {'record_type':'payment','record_id':j['id'],'path':'/'})
    elif a.get('status') not in ('captured','refunded','partially_refunded'):
        # Failed attempts do not close an order; the same order can have a later success.
        a['last_attempt_status'] = payment.get('status', 'unknown')
    a['checked_at'] = time.time()
    u.put('payments', a['id'], a)
    u.put('jobs', j['id'], j)
    return a


def settlement(u, job_id):
    old = u.get('settlements', job_id)
    if old and not old.get('invalidated'): return old
    j = u.get('jobs', job_id)
    if not j or j.get('financial_hold') or j.get('parts_refund_hold') or j.get('allocation_review_required') or j['state'] != 'completed' or j['payment_status'] != 'verified':
        fail('SETTLEMENT_HELD', 'A completed, undisputed job and captured payment are required.')
    policy = j.get('settlement_policy')
    if not policy: fail('POLICY_NOT_ACCEPTED', 'No earnings and deduction policy was accepted for this assignment.')
    worker_id = j['worker_id']
    base=j.get('settlement_base_paise',j['base_price_paise'])
    promotion=j.get('promotion_discount_paise',0)
    vendor_discount=j.get('vendor_discount_paise',0)
    if base>j['total_paise']+promotion+vendor_discount:fail('INVALID_ALLOCATION','Review the final service and parts allocation.')
    gross = base * policy['worker_share_bps'] // 10000
    # Next-task obligations are pinned to the next *accepted* assignment, not settlement order.
    selected = [p for p in j['penalties'] if p.get('worker_id') == worker_id and (p.get('visit_id') == j['visit_id'] or any(v.get('visit_id')==p.get('visit_id') and v.get('worker_id')==worker_id for v in j.get('visit_history',[]))) and p.get('status')!='waived']
    rates = [p['current_percent']*100 for p in selected]
    carry = [o for o in u.all('penalty_obligations') if o.get('target_job_id') == job_id and o['worker_id'] == worker_id and not o.get('waived')]
    rates += [o['bps'] for o in carry]
    bps = min(policy['penalty_cap_bps'], sum(rates) if policy['stack_penalties'] else max(rates, default=0))
    deduction = min(gross, max([max(0,gross-base//2), *[gross*r//10000 for r in rates]])) if rates and policy.get('penalty_mode')=='highest_single' else gross*bps//10000
    orders=[u.get('parts_orders',oid) for oid in j.get('parts_order_ids',[])]
    if any(o and o.get('assessment_paise',0)>0 and o.get('assessment_status')=='review_required' for o in orders): fail('RETURN_ASSESSMENT_REVIEW','Review pickup-return assessments before settlement.')
    return_deduction=sum(o.get('assessment_paise',0) for o in orders if o and o.get('worker_id')==worker_id and o.get('assessment_status')=='approved')
    deduction=min(gross,max(deduction,return_deduction))
    bonus = base*policy.get('bonus_reserve_bps',0)//10000
    hire_bonus=j.get('hire_bonus_paise',0)
    travel=j.get('hire_travel_paise',0);gst=j.get('hire_gst_paise',0)+j.get('home_gst_paise',0)
    company = base-gross-bonus-hire_bonus-promotion
    if company<0:fail('BONUS_UNFUNDED','Company margin cannot fund this hire bonus.')
    if vendor_discount>gross-deduction:fail('COUPON_ALLOCATION_REVIEW','Vendor-funded discount exceeds available vendor earnings; review before settlement.')
    record = dict(id=job_id, worker_id=worker_id, gross_paise=gross, deduction_paise=deduction,vendor_discount_paise=vendor_discount,
                  net_paise=gross-deduction-vendor_discount+travel+hire_bonus, hire_bonus_paise=hire_bonus, travel_reimbursement_paise=travel, gst_payable_paise=gst, bonus_reserve_paise=bonus, company_base_commission_paise=company, company_earnings_paise=company+deduction, promotion_discount_paise=promotion, parts_payable_paise=j['total_paise']+promotion+vendor_discount-base-travel-gst, policy=policy, obligations=[o['id'] for o in carry],
                  status='review_required', created_at=time.time(), currency='INR')
    u.put('settlements', job_id, record)
    audit(u, 'SettlementCalculated', 'settlement', job_id=job_id, gross_paise=gross, deduction_paise=deduction)
    return record


def snapshot_policy(u, job, worker):
    policy = u.get('policies', 'current')
    if policy and worker.get('settlement_policy_version') != policy['version']:
        fail('EARNINGS_POLICY_REQUIRED','Review and accept the current earnings policy in Profile before accepting a new task.')
    if policy and worker.get('settlement_policy_version') == policy['version']:
        job['settlement_policy'] = policy
        for obligation in u.all('penalty_obligations'):
            if obligation['worker_id'] == worker['id'] and not obligation.get('target_job_id') and obligation['source_job_id'] != job['id']:
                obligation['target_job_id'] = job['id']
                u.put('penalty_obligations', obligation['id'], obligation)


def penalty_obligation(u, job, penalty):
    if not job.get('settlement_policy') or not penalty.get('next_task_percent'): return
    oid = digest(f"{job['id']}:{penalty['visit_id']}:{penalty['code']}")
    if not u.get('penalty_obligations', oid):
        u.put('penalty_obligations', oid, dict(id=oid, worker_id=penalty['worker_id'], source_job_id=job['id'], source_visit_id=penalty['visit_id'], bps=penalty['next_task_percent']*100, created_at=time.time()))


def install(core):
    store = core.operations_store
    router = APIRouter(prefix='/operations', tags=['Production integrations'])

    def worker(user=Depends(core.current_user)):
        w = store.run(lambda u: u.get('workers', user['id']))
        if not user.get('phone_verified') or not w: fail('WORKER_REQUIRED', 'Complete phone sign-in and your worker profile first.', 403)
        return user

    @router.get('/integrations/status')
    def status():
        return dict(payments=enabled('REPAIDO_PAYMENTS_ENABLED') and configured('RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET'),
            payouts=enabled('REPAIDO_PAYOUTS_ENABLED') and configured('RAZORPAYX_KEY_ID','RAZORPAYX_KEY_SECRET','RAZORPAYX_ACCOUNT_NUMBER'),
            private_documents=bool(os.getenv('REPAIDO_KYC_BUCKET')), identity_mode='manual_review', biometric_provider=False,
            background_push=enabled('REPAIDO_PUSH_ENABLED'), native_tracking=True)

    def onboarding_status(u, uid):
        w=u.get('workers',uid) or {}
        v=u.get('verification',uid) or {'identity_status':'not_submitted','bank_status':'not_verified'}
        docs=[d for d in u.all('documents') if d['worker_id']==uid]
        current=[d for d in docs if d['status']=='pending_review' and d['expires_at']>time.time()]
        missing=[k for k in ('identity','pan','address','tools') if k not in {d['kind'] for d in current}]
        approved=w.get('status')=='approved'
        submitted=v.get('submitted_document_ids')==sorted(d['id'] for d in current) and bool(v.get('submitted_at')) and w.get('status')!='rejected'
        return dict(documents=[{k:value for k,value in d.items() if k not in ('object','sha256')} for d in docs],
            verification={k:v.get(k) for k in ('identity_status','bank_status','review_reason','bank_last4','submitted_at','manual_identity_requested')},
            onboarding={'missing_documents':[] if approved else missing,'completed_documents':4-len(missing),'required_documents':4,
                'state':'approved' if approved else 'needs_changes' if w.get('status')=='rejected' else 'missing_documents' if missing else 'in_review' if submitted else 'ready_to_submit',
                'can_submit':not approved and not missing, 'review_reason':w.get('review_reason') or v.get('review_reason'),
                'has_selfie':any(d['kind']=='selfie' for d in current)}, **status())

    def onboarding_note(u, uid, result=None):
        if not u.get('workers',uid):return
        result=result or onboarding_status(u,uid)
        state=result['onboarding'];missing=state['missing_documents']
        text=('Complete your application: upload '+', '.join(missing)+'.') if missing else {'approved':'Joining approved. Open your worker account and go online to receive matching tasks.','needs_changes':'Your application needs changes. Open it to read the reviewer’s note.','in_review':'Your application is with the Repaido team. Track its status here.','ready_to_submit':'Your documents are saved. Submit your application for review.'}.get(state['state'],'Continue your saved application.')
        nid='onboarding-'+digest(uid);old=u.get('notifications',nid)
        if not old or old.get('body')!=text:
            u.put('notifications',nid,dict(id=nid,user_id=uid,title='Worker application update',body=text,destination='onboarding',created_at=time.time()))

    @router.get('/worker/verification')
    def verification(user=Depends(worker)):
        def read(u):
            result=onboarding_status(u,user['id']);onboarding_note(u,user['id'],result);return result
        return store.run(read)

    @router.post('/worker/verification/submit')
    def submit_verification(user=Depends(worker)):
        def save(u):
            result=onboarding_status(u,user['id']);w=u.get('workers',user['id'])
            if w['status']=='approved':return {'status':'approved'}
            if not result['onboarding']['can_submit']:fail('DOCUMENTS_REQUIRED','Upload the missing documents before sending your application for review.',422)
            docs=[d for d in result['documents'] if d['status']=='pending_review' and d['expires_at']>time.time()]
            if any(d['status']=='uploading' and d['created_at']>time.time()-600 for d in result['documents']):fail('UPLOAD_IN_PROGRESS','Wait for your uploads to finish, then submit again.')
            v=u.get('verification',user['id']) or {'bank_status':'not_verified'}
            ids=sorted(d['id'] for d in docs)
            if result['onboarding']['state']=='in_review':return {'status':'in_review','submitted_at':v['submitted_at']}
            v.update(identity_status='pending_review',submitted_at=time.time(),submitted_document_ids=ids)
            w.update(status='pending_verification',online=False)
            u.put('verification',user['id'],v);u.put('workers',user['id'],w)
            audit(u,'OnboardingSubmittedForReview',user['id'],document_ids=ids)
            from transactional_mail import enqueue
            enqueue(u,'worker-review-submit:'+user['id']+':'+str(v['submitted_at']),'worker_review_submitted',[user['id']],
                    {'record_type':'account','record_id':user['id'],'path':'/worker'})
            return {'status':'in_review','submitted_at':v['submitted_at']}
        return store.run(save)

    @router.post('/worker/documents/{kind}')
    async def upload(kind: Literal['identity','pan','address','tools'], request: Request, user=Depends(worker), x_verification_consent: str = Header(default='')):
        bucket_name = os.getenv('REPAIDO_KYC_BUCKET')
        if not bucket_name: fail('PRIVATE_STORAGE_UNAVAILABLE', 'Private document storage is unavailable. Retry later; do not send documents in chat.', 503)
        if x_verification_consent != 'private-review-v1': fail('CONSENT_REQUIRED', 'Agree to private document review before uploading.', 422)
        mime = request.headers.get('content-type','')
        if mime not in ('image/jpeg','image/png','application/pdf'): fail('UNSUPPORTED_FILE', 'Use a JPEG, PNG or PDF file.', 422)
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > 5*1024*1024: fail('FILE_TOO_LARGE', 'Each file must be smaller than 5 MB.', 413)
        valid = (mime=='image/jpeg' and data[:3]==b'\xff\xd8\xff') or (mime=='image/png' and data[:8]==b'\x89PNG\r\n\x1a\n') or (mime=='application/pdf' and data[:5]==b'%PDF-')
        if not valid: fail('INVALID_FILE', 'File content does not match its type.', 422)
        def reserve(u):
            now=time.time()
            recent=[d for d in u.all('documents') if d['worker_id']==user['id'] and d['created_at']>now-86400]
            if len(recent)>=12: fail('UPLOAD_LIMIT','Daily upload limit reached. Contact support for help.',429)
            v=u.get('verification',user['id']) or {}
            if v.get('identity_status')=='approved': fail('REVIEW_LOCKED','Contact support to change approved identity documents.')
            did=str(uuid.uuid4())
            d=dict(id=did, worker_id=user['id'], kind=kind, content_type=mime, size=len(data), created_at=now, expires_at=now+30*86400,
                object=f'verification/{digest(user["id"])}/{did}', sha256=hashlib.sha256(data).hexdigest(), status='uploading',consent_version='private-review-v1')
            u.put('documents',did,d)
            return d
        d=store.run(reserve)
        from google.cloud import storage
        try:
            blob=storage.Client().bucket(bucket_name).blob(d['object'])
            blob.cache_control='no-store'
            blob.upload_from_string(bytes(data),content_type=mime,if_generation_match=0)
        except Exception: fail('UPLOAD_FAILED','Private upload failed. Retry the file; nothing has been approved.',503)
        def finish(u):
            d['status']='pending_review'
            u.put('documents',d['id'],d)
            from transactional_mail import enqueue
            enqueue(u,d['id'],'verification_document_saved',[user['id']],
                    {'record_type':'account','record_id':user['id'],'path':'/worker'})
            v=u.get('verification',user['id']) or {'bank_status':'not_verified'}
            v['identity_status']='pending_review';u.put('verification',user['id'],v)
            audit(u,'PrivateDocumentUploaded',user['id'],document_id=d['id'],kind=kind)
        store.run(finish)
        return {'id':d['id'],'status':'pending_review'}

    @router.get('/admin/verification/{worker_id}')
    def verification_queue(worker_id: str, admin=Depends(core.operator)):
        def read(u):
            audit(u,'VerificationCaseAccessed',admin['id'],worker_id=worker_id)
            return {'verification':u.get('verification',worker_id), 'documents':[{k:v for k,v in d.items() if k not in ('object','sha256')} for d in u.all('documents') if d['worker_id']==worker_id]}
        return store.run(read)

    @router.get('/admin/documents/{document_id}')
    def document(document_id: str, admin=Depends(core.operator)):
        def read(u):
            d=u.get('documents',document_id)
            if not d or d['expires_at']<=time.time() or d['status']!='pending_review': fail('DOCUMENT_UNAVAILABLE','Document expired or unavailable. Request a new upload.',404)
            audit(u,'PrivateDocumentDownloaded',admin['id'],document_id=document_id)
            return d
        d=store.run(read)
        from google.cloud import storage
        try: data=storage.Client().bucket(os.environ['REPAIDO_KYC_BUCKET']).blob(d['object']).download_as_bytes()
        except Exception: fail('DOCUMENT_UNAVAILABLE','Private document unavailable. Retry later.',503)
        # Attachment only: uploaded PDFs are never rendered with the app's origin.
        return Response(data,media_type='application/octet-stream',headers={'Content-Disposition':f'attachment; filename="{document_id}.bin"','Cache-Control':'no-store','Content-Security-Policy':"sandbox; default-src 'none'"})

    @router.post('/admin/verification/{worker_id}/identity')
    def identity_review(worker_id: str, body: IdentityDecision, admin=Depends(core.operator)):
        def save(u):
            w=u.get('workers',worker_id)
            if not w: fail('NOT_FOUND','Worker not found.',404)
            required={'identity','date_of_birth','address','pan','tools','one_to_one_identity_match'}
            documents=[d for d in u.all('documents') if d['worker_id']==worker_id and d['status']=='pending_review' and d['expires_at']>time.time()]
            docs={d['kind'] for d in documents}
            if body.decision=='approved' and (set(body.document_ids)!={d['id'] for d in documents} or any(d['worker_id']==worker_id and d['status']=='uploading' and d['created_at']>time.time()-600 for d in u.all('documents'))):
                fail('DOCUMENTS_CHANGED','Refresh and review the current document set before approving.')
            if body.decision=='approved' and (set(body.checks)!=required or not {'identity','pan','address','tools'}<=docs):
                fail('CHECKS_REQUIRED','Review all private documents and complete a one-to-one manual identity check before approval.')
            v=u.get('verification',worker_id) or {'bank_status':'not_verified'}
            v.update(identity_status=body.decision,review_reason=body.reason,identity_reviewed_by=admin['id'],identity_reviewed_at=time.time(),identity_evidence=body.evidence_reference,reviewed_document_ids=body.document_ids)
            u.put('verification',worker_id,v)
            if body.decision=='rejected':
                w.update(status='rejected',online=False);u.put('workers',worker_id,w)
            audit(u,'IdentityManuallyReviewed',admin['id'],worker_id=worker_id,**body.model_dump())
            from transactional_mail import enqueue
            enqueue(u,'identity-review:'+worker_id+':'+str(v['identity_reviewed_at']),'worker_identity_'+body.decision,[worker_id],
                    {'record_type':'account','record_id':worker_id,'path':'/worker'})
            return {'identity_status':body.decision}
        return store.run(save)

    @router.post('/admin/verification/{worker_id}/bank')
    def bank_review(worker_id: str, body: BankLink, admin=Depends(core.operator)):
        # Bank details are captured in the provider dashboard, never in public profiles.
        result=razorpay('fund_accounts/validations/'+body.validation_id,payout=True)
        fund=result.get('fund_account') or {}
        contact=razorpay('contacts/'+str(fund.get('contact_id','')),payout=True)
        account=result.get('validation_results') or result.get('results') or {}
        if result.get('status')!='completed' or account.get('account_status')!='active' or contact.get('reference_id')!=worker_id:
            fail('BANK_NOT_VERIFIED','Provider must confirm an active account tied to this worker reference.')
        def save(u):
            w=u.get('workers',worker_id)
            if not w: fail('NOT_FOUND','Worker not found.',404)
            normalize=lambda s: re.sub(r'[^a-z0-9]','',s.casefold())
            if normalize(account.get('registered_name',''))!=normalize(w['name']): fail('BANK_NAME_MISMATCH','Account holder name needs a provider-supported correction or manual escalation.')
            if any(v.get('fund_account_id')==fund['id'] and v.get('worker_id')!=worker_id for v in u.all('verification')):
                fail('BANK_ALREADY_LINKED','This bank reference is linked to another worker.')
            v=u.get('verification',worker_id) or {'identity_status':'not_submitted'}
            v.update(worker_id=worker_id,bank_status='verified',fund_account_id=fund['id'],validation_id=body.validation_id,
                     bank_last4=str(fund.get('bank_account',{}).get('account_number',''))[-4:],bank_verified_at=time.time())
            u.put('verification',worker_id,v)
            audit(u,'BankProviderVerified',admin['id'],worker_id=worker_id,validation_id=body.validation_id,reason=body.reason)
            return {'bank_status':'verified','bank_last4':v['bank_last4']}
        return store.run(save)

    @router.post('/devices')
    def register_device(body: Device,user=Depends(core.current_user)):
        did=digest(body.token)
        store.run(lambda u:u.put('devices',did,dict(id=did,user_id=user['id'],token=body.token,platform=body.platform,audience=body.audience,promotional_capable=body.promotional_capable,updated_at=time.time(),active=True)))
        return {'id':did,'user_id':user['id']}

    @router.delete('/devices/{device_id}')
    def remove_device(device_id: str,user=Depends(core.current_user)):
        def remove(u):
            d=u.get('devices',device_id)
            if d and d['user_id']==user['id']:
                d.update(active=False,token='');u.put('devices',device_id,d)
            return {'status':'disabled'}
        return store.run(remove)

    @router.get('/notifications')
    def notifications(user=Depends(core.current_user)):
        def read(u):
            from repaidians_work import notification_visible, prefetch_notification_targets
            onboarding_note(u,user['id'])
            rows=sorted(u.find('notifications','user_id',user['id']),key=lambda n:n['created_at'],reverse=True)[:100]
            prefetch_notification_targets(u,rows,user['id'])
            return {'notifications':[row for row in rows if notification_visible(u,row,user['id'])]}
        return store.run(read)

    @router.get('/jobs/{job_id}/tracking')
    def customer_tracking(job_id:str,user=Depends(core.current_user)):
        def read(u):
            j=u.get('jobs',job_id)
            if not j or user['id'] not in (j['customer_id'],j.get('worker_id')):fail('NOT_FOUND','Booking not found.',404)
            now=time.time();p=j.get('position');active=j['state'] in ('en_route','arrived','in_progress','collecting_parts')
            result={'phase':j['state'],'position':None,'status':'not_sharing','interval_seconds':15,'server_time':now}
            if active and j.get('tracking_consent'):
                result['status']='waiting_for_location'
                if p and now-p.get('received_at',0)<=60 and abs(now-p.get('captured_at',0))<=120:
                    result.update(status='live',position={k:p[k] for k in ('lat','lng','accuracy','captured_at','received_at')})
                elif p:result['status']='stale'
            if j['state']=='collecting_parts':
                order=u.get('parts_orders',j.get('proposal',{}).get('id',''))
                result['phase']='returning_from_shop' if order and order['status']=='picked_up' else 'travelling_to_shop'
            return result
        return store.run(read)

    @router.post('/jobs/{job_id}/tracking-session')
    def tracking_session(job_id: str,body: Consent,user=Depends(worker)):
        token=secrets.token_urlsafe(32)
        def save(u):
            j=u.get('jobs',job_id);w=u.get('workers',user['id'])
            if not j or j.get('worker_id')!=user['id'] or w['status']!='approved' or j['state'] not in ('en_route','arrived','in_progress','collecting_parts'):
                fail('TRACKING_NOT_ALLOWED','Tracking is available only during your assigned active visit.',403)
            # One session per job; issuing another revokes the previous token.
            j.update(tracking_consent=True,tracking_generation=str(uuid.uuid4()))
            u.put('jobs',job_id,j)
            u.put('tracking',digest(token),dict(job_id=job_id,worker_id=user['id'],generation=j['tracking_generation'],expires_at=time.time()+8*3600,sequence=0))
            audit(u,'BackgroundTrackingConsented',user['id'],job_id=job_id)
        store.run(save)
        return {'token':token,'expires_in':8*3600,'interval_seconds':15}

    def tracking_auth(u,authorization):
        session=u.get('tracking',digest(authorization.removeprefix('Bearer ')))
        if not session or session['expires_at']<=time.time(): fail('TRACKING_EXPIRED','Reopen the app to renew tracking.',401)
        j=u.get('jobs',session['job_id']);w=u.get('workers',session['worker_id'])
        if not j or not w or w['status']!='approved' or j.get('worker_id')!=session['worker_id'] or j.get('tracking_generation')!=session['generation'] or not j.get('tracking_consent') or j['state'] not in ('en_route','arrived','in_progress','collecting_parts'):
            fail('TRACKING_ENDED','Location sharing has ended.',410)
        return session,j

    @router.post('/tracking/position')
    def tracking_position(body: TrackingPing,authorization: str=Header(default='')):
        def save(u):
            session,j=tracking_auth(u,authorization);now=time.time()
            if body.sequence<=session['sequence']: return {'status':'already_received'}
            if now-session.get('last_at',0)<10: fail('POSITION_RATE_LIMIT','Wait before sending another reading.',429)
            if abs(now-body.captured_at)>120: fail('STALE_POSITION','A fresh location is required.',422)
            session.update(sequence=body.sequence,last_at=now)
            w=u.get('workers',session['worker_id'])
            w['position']={**body.model_dump(exclude={'sequence'}),'received_at':now};u.put('workers',w['id'],w)
            if w.get('online'):
                sample=f"{w['id']}_{int(now//300)}";u.put('availability_samples',sample,dict(id=sample,worker_id=w['id'],at=now))
            j['position']={**body.model_dump(exclude={'sequence'}),'received_at':now}
            distance=metres(j['position'],j['location'])
            j['geofence_zone']='at_site' if at_site(j,now) else 'nearby' if distance<=300 else 'travelling'
            if j['state']=='en_route' and at_site(j,now):
                j['state']='arrived';j['version']+=1;event(u,j,'WorkerArrived',session['worker_id'])
            from procurement import movement
            movement(u,j,now)
            from operations import monitor_worksite
            monitor_worksite(u,j,now,session['worker_id'])
            u.put('tracking',digest(authorization.removeprefix('Bearer ')),session);u.put('jobs',j['id'],j)
            return {'status':'received','zone':j['geofence_zone']}
        return store.run(save)

    @router.post('/tracking/stop')
    def tracking_stop(authorization: str=Header(default='')):
        def save(u):
            session,j=tracking_auth(u,authorization)
            j.update(tracking_consent=False);j.pop('position',None);j.pop('tracking_generation',None)
            u.put('jobs',j['id'],j);audit(u,'BackgroundTrackingStopped',session['worker_id'],job_id=j['id'])
            return {'status':'stopped'}
        return store.run(save)

    @router.get('/worker/earnings')
    def earnings(user=Depends(worker)):
        return store.run(lambda u:{'settlements':[s for s in u.all('settlements') if s['worker_id']==user['id']], 'bonus_withdrawable_paise':0, 'policy':u.get('policies','current')})

    @router.post('/admin/settlement-policy')
    def policy(body: Policy,admin=Depends(core.operator)):
        if not enabled('REPAIDO_FINANCIAL_POLICY_APPROVED'): fail('BUSINESS_POLICY_REQUIRED','Owner approval of earnings base, stacking and cap is required before activation.')
        if body.worker_share_bps+body.bonus_reserve_bps>10000: fail('INVALID_SPLIT','Worker share and bonus reserve exceed the base fee.',422)
        def save(u):
            previous=u.get('policy_versions',body.version)
            if previous and previous!=body.model_dump(): fail('IMMUTABLE_POLICY','Use a new version; accepted policies are immutable.')
            for j in u.all('jobs'):
                if j.get('promotion_discount_paise') and not j.get('settlement_policy') and j['state'] not in ('cancelled','completed'):
                    base=j['base_price_paise'];promo=j['promotion'];committed=base*body.worker_share_bps//10000+base*body.bonus_reserve_bps//10000+j['promotion_discount_paise']
                    if base-committed < (base*(promo['minimum_margin_bps']+promo['risk_cost_bps'])+9999)//10000:
                        fail('PROMOTIONS_COMMITTED','This earnings change would underfund a previously agreed customer offer. Resolve open promotional bookings first.')
            u.put('policy_versions',body.version,body.model_dump());u.put('policies','current',body.model_dump())
            audit(u,'SettlementPolicyPublished',admin['id'],version=body.version)
            return body.model_dump()
        return store.run(save)

    @router.post('/worker/settlement-policy/accept')
    def accept_policy(body: PolicyConsent,user=Depends(worker)):
        def save(u):
            p=u.get('policies','current')
            if not p or p['version']!=body.version: fail('POLICY_CHANGED','Review the current policy before accepting.')
            w=u.get('workers',user['id']);w['settlement_policy_version']=p['version'];u.put('workers',w['id'],w)
            audit(u,'SettlementPolicyAccepted',user['id'],version=body.version)
            return {'status':'accepted'}
        return store.run(save)

    @router.post('/jobs/{job_id}/payment-order')
    def payment_order(job_id: str,user=Depends(core.current_user)):
        if not status()['payments']: fail('PAYMENTS_UNAVAILABLE','Online payments are not yet enabled. No charge was made.',503)
        def reserve(u):
            j=u.get('jobs',job_id)
            if not j or j['customer_id']!=user['id']: fail('NOT_FOUND','Booking not found.',404)
            if j['state']!='completed' or j['payment_status'] in ('verified','refunded','partially_refunded'): fail('PAYMENT_NOT_DUE','This booking cannot take another payment.')
            if j.get('financial_hold') or j.get('parts_refund_hold'):fail('FINANCIAL_REVIEW_REQUIRED','Support must resolve the payment or refund hold before collecting a final balance.')
            if j.get('home_plan_id'):fail('MONTHLY_INVOICE','Pay this visit through the monthly invoice in your Home plan.')
            old=u.get('payments',job_id)
            if old: return old,False
            from parts_payments import advance_total
            balance=j['total_paise']-advance_total(u,job_id)
            if balance<=0:fail('PAYMENT_NOT_DUE','No remaining balance is due. Contact support for reconciliation.')
            a=dict(id=job_id,job_id=job_id,customer_id=user['id'],amount_paise=balance,status='creating',receipt=job_id,created_at=time.time())
            u.put('payments',job_id,a);return a,True
        a,create=store.run(reserve)
        if create:
            # Ambiguous order creation stays creating; reconcile by unique receipt. Never blindly POST again.
            result=razorpay('orders',dict(amount=a['amount_paise'],currency='INR',receipt=a['receipt'],notes={'repaido_job':job_id}))
            def finish(u):
                saved=u.get('payments',job_id);saved.update(order_id=result['id'],status='created');u.put('payments',job_id,saved);return saved
            a=store.run(finish)
        if not a.get('order_id'): fail('ORDER_RECONCILING','Payment setup is being checked. Retry status shortly; do not create another payment.',409)
        return {'key_id':os.environ['RAZORPAY_KEY_ID'],'order_id':a['order_id'],'amount':a['amount_paise'],'currency':'INR','status':a['status']}

    @router.post('/jobs/{job_id}/payment-check')
    def payment_check(job_id: str,body: PaymentCheck,user=Depends(core.current_user)):
        def authorize(u):
            a=u.get('payments',job_id)
            if not a or a['customer_id']!=user['id']: fail('NOT_FOUND','Payment not found.',404)
            return a
        a=store.run(authorize);p=razorpay('payments/'+body.payment_id)
        if p.get('order_id')!=a.get('order_id'): fail('WRONG_ORDER','Payment is not for this invoice.',403)
        return store.run(lambda u:apply_payment(u,p))

    @router.get('/jobs/{job_id}/payment')
    def payment_status(job_id: str,user=Depends(core.current_user)):
        def read(u):
            j=u.get('jobs',job_id)
            if not j or user['id'] not in (j['customer_id'],j.get('worker_id')): fail('NOT_FOUND','Booking not found.',404)
            a=u.get('payments',job_id)
            return {'payment':{k:a.get(k) for k in ('status','amount_paise','payment_id','checked_at')} if a else None,'settlement':u.get('settlements',job_id) if user['id']==j.get('worker_id') else None}
        return store.run(read)

    @router.post('/webhooks/razorpay/{channel}')
    async def webhook(channel: Literal['payments','payouts'],request: Request,x_razorpay_signature: str=Header(default='')):
        secret=os.getenv('RAZORPAY_WEBHOOK_SECRET' if channel=='payments' else 'RAZORPAYX_WEBHOOK_SECRET')
        if not secret: fail('WEBHOOK_NOT_CONFIGURED','Webhook unavailable.',503)
        data=bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data)>256*1024: fail('PAYLOAD_TOO_LARGE','Webhook too large.',413)
        if not hmac.compare_digest(hmac.new(secret.encode(),bytes(data),hashlib.sha256).hexdigest(),x_razorpay_signature): fail('INVALID_SIGNATURE','Invalid signature.',401)
        try:
            payload=json.loads(data);kind='payment' if channel=='payments' else 'payout'
            entity=payload['payload'].get(kind,{}).get('entity',{})
            if not entity and kind=='payment': entity=payload['payload'].get('refund',{}).get('entity',{});entity={'id':entity.get('payment_id')}
            ref=entity.get('id','')
            if not re.fullmatch('pay_[A-Za-z0-9]+' if kind=='payment' else 'pout_[A-Za-z0-9]+',ref): return {'status':'ignored'}
        except (ValueError,KeyError,TypeError): fail('INVALID_EVENT','Malformed webhook.',400)
        eid=digest(channel+bytes(data).hex())
        def enqueue(u):
            if not u.get('webhooks',eid): u.put('webhooks',eid,dict(id=eid,kind=kind,reference=ref,status='pending',created_at=time.time()))
            return {'status':'accepted'}
        return store.run(enqueue)

    @router.post('/admin/settlements/{job_id}/calculate')
    def calculate(job_id: str,admin=Depends(core.operator)):
        return store.run(lambda u:settlement(u,job_id))

    @router.get('/admin/finance',dependencies=[Depends(core.operator)])
    def finance():
        return store.run(lambda u:{'settlements':u.all('settlements'),'payments':u.all('payments'),'payouts':u.all('payouts'), 'policy':u.get('policies','current'), 'journals':u.all('journals'), 'payout_attempts':u.all('payout_attempts'), 'bonus_reserves':u.all('bonus_reserves')})

    @router.post('/admin/settlements/{job_id}/release')
    def release(job_id: str,body: PayoutApproval,admin=Depends(core.operator)):
        if not status()['payouts']: fail('PAYOUTS_UNAVAILABLE','Payout account, static outbound IP and live provider activation are required.',503)
        def reserve(u):
            s=settlement(u,job_id);j=u.get('jobs',job_id);v=u.get('verification',s['worker_id']) or {};w=u.get('workers',s['worker_id'])
            if j.get('financial_hold') or j.get('parts_refund_hold') or j.get('allocation_review_required') or j['state']!='completed' or j['payment_status']!='verified' or v.get('bank_status')!='verified' or v.get('identity_status')!='approved' or w['status']!='approved': fail('PAYOUT_HELD','Payment, identity, bank account and completion must be verified.')
            if body.expected_net_paise!=s['net_paise']: fail('SETTLEMENT_CHANGED','Review the current net amount.')
            if s['net_paise']<100: fail('BELOW_PAYOUT_MINIMUM','Net earnings are below the provider minimum; manual carry-forward review is required.')
            old=u.get('payouts',job_id)
            if old: return old
            p=dict(id=job_id,worker_id=s['worker_id'],amount_paise=s['net_paise'],fund_account_id=v['fund_account_id'],idempotency_key=str(uuid.uuid4()),status='submitting',created_at=time.time())
            u.put('payouts',job_id,p);s['status']='processing';u.put('settlements',job_id,s)
            # Balanced immutable allocation. Bonus is a liability, never spendable company revenue.
            from parts_payments import advance_total
            prepaid=advance_total(u,job_id)
            lines=[{'account':'payment_clearing','debit':j['total_paise']-prepaid,'credit':0},
                   {'account':'customer_parts_advances','debit':prepaid,'credit':0},
                   {'account':'worker_payable','debit':0,'credit':s['net_paise']},
                   {'account':'company_commission','debit':0,'credit':s['company_base_commission_paise']},
                   {'account':'company_penalty_income','debit':0,'credit':s['deduction_paise']},
                   {'account':'locked_bonus_reserve','debit':0,'credit':s['bonus_reserve_paise']},
                   {'account':'parts_payable','debit':0,'credit':s['parts_payable_paise']},
                   {'account':'gst_payable','debit':0,'credit':s.get('gst_payable_paise',0)}]
            if sum(l['debit']-l['credit'] for l in lines)!=0: fail('UNBALANCED_LEDGER','Accounting allocation needs review.')
            u.put('journals',job_id,dict(id=job_id,job_id=job_id,worker_id=s['worker_id'],lines=lines,posted_at=time.time(),status='posted'))
            u.put('bonus_reserves',job_id,dict(id=job_id,amount_paise=s['bonus_reserve_paise'],status='awaiting_payout',worker_id=s['worker_id'],source_job_id=job_id))
            audit(u,'PayoutAuthorized',admin['id'],job_id=job_id,net_paise=s['net_paise'],reason=body.reason)
            return p
        p=store.run(reserve)
        return send_payout(p)

    @router.post('/worker/bonus/withdraw')
    def withdraw_bonus(body: Consent,user=Depends(worker)):
        if not status()['payouts']: fail('PAYOUTS_UNAVAILABLE','Bank withdrawals are not yet enabled. Your bonus stays in the wallet.',503)
        def reserve(u):
            w=u.get('workers',user['id']);v=u.get('verification',user['id']) or {}
            if w['status']!='approved' or v.get('identity_status')!='approved' or v.get('bank_status')!='verified':fail('VERIFICATION_REQUIRED','Identity and bank verification are required.')
            existing=[p for p in u.all('bonus_payouts') if p['worker_id']==user['id'] and p['status'] not in ('processed','reversed')]
            if existing:return existing[0]
            awards=[a for a in u.all('bonus_awards') if a['worker_id']==user['id'] and a['status']=='available']
            amount=sum(a['amount_paise'] for a in awards)
            if amount<100:fail('NO_WITHDRAWABLE_BONUS','At least ₹1 of unlocked bonus is required.')
            for a in awards:
                for source in a['source_jobs']:
                    job=u.get('jobs',source)
                    if not job or job['payment_status']!='verified':fail('BONUS_HELD','A source payment is under reconciliation.')
            pid=str(uuid.uuid4());p=dict(id=pid,worker_id=user['id'],amount_paise=amount,fund_account_id=v['fund_account_id'],award_ids=[a['id'] for a in awards],idempotency_key=str(uuid.uuid4()),status='submitting',created_at=time.time())
            for a in awards:a['status']='withdrawing';u.put('bonus_awards',a['id'],a)
            u.put('bonus_payouts',pid,p);audit(u,'BonusWithdrawalRequested',user['id'],withdrawal_id=pid,amount_paise=amount)
            return p
        return send_bonus(store.run(reserve))

    def bonus_result(result):
        def save(u):
            rows=[p for p in u.all('bonus_payouts') if p.get('provider_id')==result.get('id') or p.get('reference_id',p['id'])==result.get('reference_id')]
            if len(rows)!=1:fail('PAYOUT_NOT_FOUND','Payout not found.',404)
            p=rows[0]
            if result.get('amount')!=p['amount_paise'] or result.get('fund_account_id')!=p['fund_account_id'] or result.get('currency')!='INR':fail('PAYOUT_MISMATCH','Bonus payout requires review.')
            state=result.get('status','unknown')
            if p['status']=='reversed' or (p['status']=='processed' and state not in ('processed','reversed')):return p
            p.update(provider_id=result['id'],status=state,checked_at=time.time());u.put('bonus_payouts',p['id'],p)
            for aid in p['award_ids']:
                a=u.get('bonus_awards',aid)
                a['status']='paid' if state=='processed' else 'reconciliation_hold' if state in ('reversed','failed','rejected','cancelled') else 'withdrawing'
                u.put('bonus_awards',aid,a)
            jid='bonus_'+p['id']
            if state=='processed' and not u.get('journals',jid):
                u.put('journals',jid,dict(id=jid,worker_id=p['worker_id'],lines=[{'account':'locked_bonus_reserve','debit':p['amount_paise'],'credit':0},{'account':'payment_clearing','debit':0,'credit':p['amount_paise']}],status='posted',posted_at=time.time()))
            if state=='reversed' and u.get('journals',jid) and not u.get('journals','reverse_'+jid):
                old=u.get('journals',jid);u.put('journals','reverse_'+jid,dict(id='reverse_'+jid,lines=[{'account':l['account'],'debit':l['credit'],'credit':l['debit']} for l in old['lines']],status='posted',posted_at=time.time()))
            return p
        return store.run(save)

    def send_bonus(p):
        if p.get('provider_id'):return bonus_result(razorpay('payouts/'+p['provider_id'],payout=True))
        def eligible(u):
            v=u.get('verification',p['worker_id']) or {};w=u.get('workers',p['worker_id']) or {}
            if w.get('status')!='approved' or v.get('bank_status')!='verified' or v.get('fund_account_id')!=p['fund_account_id']:fail('BONUS_HELD','Payout eligibility changed. Reconciliation is required.')
            for aid in p['award_ids']:
                for source in u.get('bonus_awards',aid)['source_jobs']:
                    if u.get('jobs',source)['payment_status']!='verified':fail('BONUS_HELD','A source payment needs review.')
        store.run(eligible)
        return bonus_result(razorpay('payouts',dict(account_number=os.environ['RAZORPAYX_ACCOUNT_NUMBER'],fund_account_id=p['fund_account_id'],amount=p['amount_paise'],currency='INR',mode='IMPS',purpose='payout',queue_if_low_balance=False,reference_id=p['id'],narration='Repaido bonus'),payout=True,key=p['idempotency_key']))

    def reconcile_payout(result):
        shop_match=store.run(lambda u:any(b['id']==result.get('reference_id') or b.get('provider_id')==result.get('id') for b in u.all('shop_batches')))
        if shop_match:return core.shop_payouts_apply(result)
        archived=store.run(lambda u:next((p for p in u.all('payout_attempts') if p.get('provider_id')==result.get('id')),None))
        if archived:
            def record(u):
                if result.get('status')!=archived['status']:
                    j=u.get('jobs',archived['id']);j.update(financial_hold=True,payout_status='held');u.put('jobs',j['id'],j)
                    audit(u,'ArchivedPayoutStatusConflict','provider',job_id=j['id'],provider_id=result['id'])
                    return {**archived,'reconciliation_error':'PAYOUT_HISTORY_CONFLICT'}
                return archived
            return store.run(record)
        normal=store.run(lambda u:any(p.get('provider_id')==result.get('id') or p.get('reference_id',p['id'])==result.get('reference_id') for p in u.all('payouts')))
        if not normal:return bonus_result(result)
        def save(u):
            matches=[p for p in u.all('payouts') if p.get('provider_id')==result.get('id') or p.get('reference_id',p['id'])==result.get('reference_id')]
            if len(matches)!=1: fail('PAYOUT_NOT_FOUND','Payout not found.',404)
            p=matches[0]
            if result.get('amount')!=p['amount_paise'] or result.get('fund_account_id')!=p['fund_account_id'] or result.get('currency')!='INR': fail('PAYOUT_MISMATCH','Provider payout requires reconciliation.')
            state=result.get('status','unknown')
            if p['status']=='reversed' or (p['status']=='processed' and state not in ('processed','reversed')): return p
            p.update(provider_id=result['id'],status=state,checked_at=time.time(),utr=result.get('utr'));u.put('payouts',p['id'],p)
            s=u.get('settlements',p['id']);j=u.get('jobs',p['id'])
            if state=='processed':
                s['status']='paid';j['payout_status']='paid'
                if not u.get('journals','payout_'+p['id']):
                    u.put('journals','payout_'+p['id'],dict(id='payout_'+p['id'],job_id=p['id'],lines=[{'account':'worker_payable','debit':p['amount_paise'],'credit':0},{'account':'payment_clearing','debit':0,'credit':p['amount_paise']}],posted_at=time.time(),status='posted'))
                reserve=u.get('bonus_reserves',p['id'])
                if reserve and reserve['status']=='awaiting_payout':reserve['status']='funded';u.put('bonus_reserves',p['id'],reserve)
                # The immutable deduction changes payable earnings, never debits a worker bank.
                if not u.get('deductions',p['id']):
                    u.put('deductions',p['id'],dict(id=p['id'],worker_id=s['worker_id'],amount_paise=s['deduction_paise'],status='applied',applied_at=time.time()))
                    audit(u,'EarningsDeductionApplied','razorpayx',job_id=p['id'],amount_paise=s['deduction_paise'])
            elif state in ('reversed','failed','rejected','cancelled'):
                s['status']='held';j['payout_status']='held'
                d=u.get('deductions',p['id'])
                if d and state=='reversed':
                    d['status']='reversed';u.put('deductions',p['id'],d)
                    for journal_id in (p['id'],'payout_'+p['id']):
                        original=u.get('journals',journal_id)
                        shop_reserved=any(p.get('batch_id') and p['job_id']==j['id'] for p in u.all('shop_payables'))
                        if journal_id==p['id'] and shop_reserved:
                            j['financial_hold']=True;j['allocation_review_required']=True
                            audit(u,'WorkerReversalShopAllocationHeld','provider',job_id=j['id'])
                            continue
                        if original and not u.get('journals','reverse_'+journal_id):
                            u.put('journals','reverse_'+journal_id,dict(id='reverse_'+journal_id,job_id=p['id'],lines=[{'account':l['account'],'debit':l['credit'],'credit':l['debit']} for l in original['lines']],posted_at=time.time(),status='posted'))
                    reserve=u.get('bonus_reserves',p['id'])
                    if reserve:reserve['status']='reversed';u.put('bonus_reserves',p['id'],reserve)
            else: j['payout_status']='processing'
            u.put('settlements',s['id'],s);u.put('jobs',j['id'],j);return p
        return store.run(save)

    def send_payout(p):
        if p.get('provider_id'): return reconcile_payout(razorpay('payouts/'+p['provider_id'],payout=True))
        def eligible(u):
            j=u.get('jobs',p['id']);v=u.get('verification',p['worker_id']) or {};w=u.get('workers',p['worker_id']) or {}
            if not j or j.get('financial_hold') or j.get('parts_refund_hold') or j.get('allocation_review_required') or j['state']!='completed' or j['payment_status']!='verified' or v.get('fund_account_id')!=p['fund_account_id'] or v.get('bank_status')!='verified' or v.get('identity_status')!='approved' or w.get('status')!='approved':
                fail('PAYOUT_RECONCILIATION_HOLD','Payout eligibility changed. Reconcile the existing provider attempt before any further transfer.')
        store.run(eligible)
        result=razorpay('payouts',dict(account_number=os.environ['RAZORPAYX_ACCOUNT_NUMBER'],fund_account_id=p['fund_account_id'],amount=p['amount_paise'],currency='INR',mode='IMPS',purpose='payout',queue_if_low_balance=False,reference_id=p.get('reference_id',p['id']),narration='Repaido earnings'),payout=True,key=p['idempotency_key'])
        return reconcile_payout(result)

    @router.post('/admin/payouts/{job_id}/retry-failed')
    def retry_failed(job_id: str,body: PayoutApproval,admin=Depends(core.operator)):
        if not status()['payouts']:fail('PAYOUTS_UNAVAILABLE','Activate the payout provider before retrying.',503)
        old=store.run(lambda u:u.get('payouts',job_id))
        if not old or not old.get('provider_id'):fail('OUTCOME_UNKNOWN','Reconcile the existing attempt; an unknown payout cannot be reissued.')
        checked=reconcile_payout(razorpay('payouts/'+old['provider_id'],payout=True))
        if checked['status'] not in ('failed','rejected','cancelled'):fail('PAYOUT_NOT_FAILED','Only a provider-confirmed failed payout can receive a new attempt. Reversals need ledger recovery.')
        def reserve(u):
            p=u.get('payouts',job_id);j=u.get('jobs',job_id);v=u.get('verification',p['worker_id']) or {}
            if p.get('provider_id')!=checked['provider_id'] or p['status']!=checked['status']:fail('PAYOUT_CHANGED','Refresh the current attempt.')
            if j.get('financial_hold') or j.get('parts_refund_hold') or j.get('allocation_review_required') or j['state']!='completed' or j['payment_status']!='verified' or v.get('bank_status')!='verified':fail('PAYOUT_HELD','Resolve the payment, booking and bank checks first.')
            if body.expected_net_paise!=p['amount_paise']:fail('AMOUNT_CHANGED','Review the current earnings amount.')
            u.put('payout_attempts',p['provider_id'],p)
            fresh={k:p[k] for k in ('id','worker_id','amount_paise')}
            fresh.update(fund_account_id=v['fund_account_id'],reference_id=str(uuid.uuid4()),idempotency_key=str(uuid.uuid4()),status='submitting',created_at=time.time())
            u.put('payouts',job_id,fresh);audit(u,'FailedPayoutReissued',admin['id'],job_id=job_id,previous_provider_id=p['provider_id'],reason=body.reason)
            return fresh
        return send_payout(store.run(reserve))

    def claim(kind,key):
        def take(u):
            r=u.get(kind,key);now=time.time()
            if (kind=='deliveries' and r.get('status')!='pending') or r.get('lease_until',0)>now or r.get('retry_at',0)>now: return None
            r.update(lease_until=now+120,attempts=r.get('attempts',0)+1);u.put(kind,key,r);return r
        return store.run(take)

    def finish(kind,key,success):
        def save(u):
            r=u.get(kind,key);r['lease_until']=0
            if success:r.update(status='done',done_at=time.time())
            else:r.update(retry_at=time.time()+min(3600,30*2**min(r.get('attempts',1),7)),last_error='DELIVERY_OR_PROVIDER_UNAVAILABLE')
            u.put(kind,key,r)
        store.run(save)

    def relay():
        def materialize(u):
            count=0
            for e in u.all('outbox'):
                if e['delivery_status']!='pending':continue
                j=u.get('jobs',e['aggregate_id'])
                if not j:continue
                # Assignment recipients are snapshotted at event creation; recheck current access before delivery.
                recipients=e.get('recipient_ids') or [j['customer_id'],j.get('worker_id')]
                if e['event_type'] not in ('position','stop_tracking','review','schedule_follow_up'):
                    for uid in set(filter(None,recipients)):
                        nid=digest(e['event_id']+uid)
                        n=dict(id=nid,user_id=uid,job_id=j['id'],event_id=e['event_id'],event_type=e['event_type'],destination='booking',created_at=e['occurred_at_server_time'],title='Repaido task update',body='Open Repaido to view your latest task update.')
                        if e['event_type']=='BookingRequested':
                            n.update(title='Booking requested',body=f"Your request for {j['service_name']} has been received. Open your booking to follow its progress.")
                        elif e['event_type']=='depart':
                            n.update(title='Your professional is on the way' if uid==j['customer_id'] else 'Travel started',body=f"Open your {j['service_name']} booking for travel updates.")
                        elif e['event_type']=='submit_completion':
                            n.update(title='Your review is needed' if uid==j['customer_id'] else 'Completion submitted',body=f"Open your {j['service_name']} booking to review the completion status.")
                        if e['event_type']=='AssignmentOffered' and uid!=j['customer_id']:
                            if uid!=j.get('worker_id') or j['state']!='offered' or j['offer_expires_at']<=time.time():continue
                            if e.get('payload',{}).get('offer_expires_at',j['offer_expires_at'])!=j['offer_expires_at']:continue
                            n.update(title='New task request — respond now',body='A task is waiting for your response. Open the Agent app to accept or decline.',alert_kind='assignment',offer_expires_at=j['offer_expires_at'],destination='task')
                        if e['event_type']=='WorkerArrived' and uid in (j['customer_id'],j.get('worker_id')):
                            if j['state']!='arrived' or e.get('visit_id')!=j.get('visit_id') or e['occurred_at_server_time']<time.time()-300:continue
                            n.update(visit_id=j.get('visit_id'),offer_expires_at=e['occurred_at_server_time']+300)
                            n.update(title='Arrival area reached',body='Your professional is almost there. Open the booking for arrival verification.' if uid==j['customer_id'] else 'You are almost there. Continue with customer arrival verification.',alert_kind='arrival',destination='task')
                        u.put('notifications',nid,n)
                        for d in u.all('devices'):
                            if d['user_id']==uid and d['active'] and d['updated_at']>time.time()-60*86400:
                                did=digest(nid+d['id']);u.put('deliveries',did,dict(id=did,notification_id=nid,device_id=d['id'],status='pending',created_at=time.time()))
                e['delivery_status']='materialized';u.put('outbox',e['event_id'],e);count+=1
                if count>=25:break
            return count
        count=store.run(materialize)
        if not enabled('REPAIDO_PUSH_ENABLED'): return {'materialized':count,'push':'disabled'}
        from firebase_admin import messaging
        rows=store.run(lambda u:[d for d in u.all('deliveries') if d['status']=='pending'])[:50]
        promotion_catalog=core.catalog() if any(d.get('kind')=='promotion' for d in rows) else None
        for row in rows:
            d=claim('deliveries',row['id'])
            if not d:continue
            def read(u):
                n=u.get('notifications',d['notification_id']);device=u.get('devices',d['device_id']);j=u.get('jobs',n['job_id']) if n.get('job_id') else None
                h=u.get('hires',n['hire_id']) if n.get('hire_id') else None
                access=n['user_id'] in (j['customer_id'],j.get('worker_id')) if j else n['user_id'] in (h['customer_id'],h['worker_id']) if h else n.get('destination')=='wallet'
                if n.get('alert_kind')=='hiring':access=access and h is not None and h['state']=='offered' and h['offer_expires_at']>time.time() and h['offer_expires_at']==n.get('offer_expires_at')
                if n.get('destination')=='home_plan':
                    plan=u.get('home_plans',n.get('plan_id',''));access=bool(plan and n['user_id'] in (plan['customer_id'],plan.get('worker_id')))
                if n.get('destination')=='promotion':
                    from promotions import delivery_allowed,recommendations,Feed,prefs
                    access=delivery_allowed(u,n,device,time.time())
                    if access:access=any(c['id']==n['campaign_id'] for c in recommendations(u,promotion_catalog,Feed(placement='push',city=prefs(u,n['user_id'])['city']),n['user_id']))
                valid=device['active'] and device['user_id']==n['user_id'] and access and n['created_at']>time.time()-86400
                if n.get('alert_kind')=='assignment':valid=valid and j is not None and j['state']=='offered' and j.get('offer_expires_at')==n.get('offer_expires_at') and j['offer_expires_at']>time.time()
                if n.get('alert_kind')=='arrival':valid=valid and j is not None and j['state']=='arrived' and j.get('visit_id')==n.get('visit_id') and n.get('offer_expires_at',0)>time.time()
                return n,device,valid
            n,device,valid=store.run(read)
            if not valid:finish('deliveries',d['id'],True);continue
            try:
                urgent=n.get('alert_kind') in ('assignment','hiring','arrival')
                ttl=max(1,min(900,int(n.get('offer_expires_at',time.time()+900)-time.time())))
                data={'notification_id':n['id'],'job_id':n.get('job_id',''),'destination':n.get('destination','task'),'alert_kind':n.get('alert_kind','update'),'expires_at':str(int(n.get('offer_expires_at',0)))}
                if n.get('destination')=='home_plan':data['plan_id']=n.get('plan_id','')
                if n.get('destination')=='promotion':
                    data.update(campaign_id=n['campaign_id'],title=n['title'],body=n['body'],expires_at=str(int(n['expires_at'])))
                    messaging.send(messaging.Message(token=device['token'],data=data,android=messaging.AndroidConfig(priority='normal',ttl=__import__('datetime').timedelta(seconds=max(1,int(n['expires_at']-time.time()))),collapse_key='repaido-promotion')))
                else:
                    messaging.send(messaging.Message(token=device['token'],data=data,notification=messaging.Notification(title=n['title'],body=n['body']),android=messaging.AndroidConfig(priority='high',ttl=__import__('datetime').timedelta(seconds=ttl),notification=messaging.AndroidNotification(channel_id='repaido_requests_v2' if urgent else 'repaido_tasks',sound='repaido_task_bell' if urgent else 'default',tag=n['id'],visibility='private'))))
                finish('deliveries',d['id'],True)
            except messaging.UnregisteredError:
                def disable(u):
                    device.update(active=False,token='');u.put('devices',device['id'],device)
                store.run(disable);finish('deliveries',d['id'],True)
            except Exception:finish('deliveries',d['id'],False)
        return {'materialized':count,'attempted':len(rows)}

    def reconcile():
        errors=0
        hooks=store.run(lambda u:[h for h in u.all('webhooks') if h['status']=='pending'])[:30]
        for row in hooks:
            h=claim('webhooks',row['id'])
            if not h:continue
            try:
                if h['kind']=='payment':
                    p=razorpay('payments/'+h['reference']);store.run(lambda u:apply_payment(u,p))
                else:reconcile_payout(razorpay('payouts/'+h['reference'],payout=True))
                finish('webhooks',h['id'],True)
            except Exception:errors+=1;finish('webhooks',h['id'],False)
        payments=store.run(lambda u:[a for a in u.all('payments') if a.get('checked_at',0)<time.time()-300])[:30]
        for a in payments:
            if not claim('payments',a['id']):continue
            try:
                if not a.get('order_id'):
                    matches=razorpay('orders?receipt='+a['receipt']).get('items',[])
                    matches=[r for r in matches if r.get('receipt')==a['receipt'] and r.get('amount')==a['amount_paise'] and r.get('currency')=='INR']
                    if len(matches)!=1:continue
                    def attach(u):
                        saved=u.get('payments',a['id']);saved.update(order_id=matches[0]['id'],status='created');u.put('payments',a['id'],saved)
                    store.run(attach);a['order_id']=matches[0]['id']
                for p in razorpay('orders/'+a['order_id']+'/payments').get('items',[]):store.run(lambda u:apply_payment(u,p))
            except Exception:errors+=1
        if status()['payouts']:
            for p in store.run(lambda u:[p for p in u.all('payouts') if p['status'] not in ('failed','rejected','cancelled','reversed') and p.get('checked_at',0)<time.time()-300])[:20]:
                if not claim('payouts',p['id']):continue
                try:send_payout(p)
                except Exception:errors+=1
        if status()['payouts']:
            for p in store.run(lambda u:[p for p in u.all('bonus_payouts') if p['status'] not in ('failed','rejected','cancelled','reversed') and p.get('checked_at',0)<time.time()-300])[:20]:
                if not claim('bonus_payouts',p['id']):continue
                try:send_bonus(p)
                except Exception:errors+=1
        return {'errors':errors}

    def scheduler_auth(authorization: str=Header(default='')):
        audience=os.getenv('REPAIDO_SCHEDULER_AUDIENCE');email=os.getenv('REPAIDO_SCHEDULER_EMAIL')
        if not audience or not email:fail('SCHEDULER_UNCONFIGURED','Scheduler not configured.',503)
        try:
            from google.oauth2 import id_token
            from google.auth.transport.requests import Request as GoogleRequest
            claims=id_token.verify_oauth2_token(authorization.removeprefix('Bearer '),GoogleRequest(),audience=audience)
            if claims.get('email')!=email or not claims.get('email_verified'):raise ValueError()
        except Exception:fail('FORBIDDEN','Scheduler authentication required.',403)

    @router.post('/internal/tick',dependencies=[Depends(scheduler_auth)])
    def scheduler():return {'network':core.network_tick(),'partner_program':core.partner_program_tick(),'home_plans':core.home_plans_tick(),'operations':core.operations_tick(),'procurement':core.procurement_tick(),'rentals':core.rentals_tick(),'shop_payouts':core.shop_payouts_tick(),'rewards':core.rewards_tick(),'refunds':core.refunds_tick(),'promotions':core.promotions_tick(),'notifications':relay(),'reconciliation':reconcile(),'marketplace':core.market_tick(),'hiring':core.hiring_tick()}

    core.integrations_relay=relay
    core.integrations_reconcile=reconcile
    core.integrations_apply_payment=apply_payment
    core.integrations_reconcile_payout=reconcile_payout
    core.app.include_router(router)
