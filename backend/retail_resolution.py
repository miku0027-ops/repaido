"""Owned retail returns and disputes with independently reconciled refunds.

Seller disclosures are frozen at purchase. Requests never create an entitlement
or transfer money. Unsent allocations are held; transferred allocations require
separate financial recovery. A timed-out refund POST is never repeated.
"""
import hashlib
import re
import time
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from pydantic import Field

from operations import Input, fail
from integrations import audit, razorpay
from rentals import payments_ready, post
from local_business import document
from evidence import download_object

TERMINAL={'resolved','rejected'}


class RequestCase(Input):
    request_id: str = Field(min_length=16,max_length=100)
    product_id: str = Field(min_length=1,max_length=100)
    quantity: int = Field(ge=1,le=50,strict=True)
    kind: Literal['return','refund','complaint']
    reason: str = Field(min_length=20,max_length=2000)
    document_ids: list[str] = Field(default_factory=list,max_length=3)


class Action(Input):
    request_id: str = Field(min_length=16,max_length=100)
    expected_version: int = Field(ge=1,strict=True)
    action: Literal['reply','authorize_return','return_sent','return_received','appeal']
    note: str = Field(min_length=10,max_length=2000)
    document_ids: list[str] = Field(default_factory=list,max_length=3)
    return_by: float | None = Field(default=None,ge=0,allow_inf_nan=False)


class Decision(Input):
    request_id: str = Field(min_length=16,max_length=100)
    expected_version: int = Field(ge=1,strict=True)
    decision: Literal['approve_refund','reject','resolve']
    note: str = Field(min_length=20,max_length=2000)
    evidence_reference: str = Field(min_length=8,max_length=300)
    refund_amount_paise: int = Field(default=0,ge=0,strict=True)


def key(*parts):
    return hashlib.sha256('\0'.join(parts).encode()).hexdigest()


def return_policy(product):
    terms=product.get('refurbishment') or {}
    days=terms.get('return_days')
    return dict(version=1,return_days=days if type(days) is int and 0<=days<=365 else None,
                return_terms=str(terms.get('return_terms') or '')[:1000],
                warranty_days=terms.get('warranty_days'),
                warranty_terms=str(terms.get('warranty_terms') or product.get('warranty') or '')[:1000],
                source='seller_disclosure_at_checkout')


def policy_window(order,line,now):
    snapshot=line.get('return_policy') or {}
    days=snapshot.get('return_days')
    if not snapshot or type(days) is not int or not snapshot.get('return_terms'):
        return dict(deadline_at=None,status='manual_review',note='No return window was recorded at purchase. Support must review the applicable terms.')
    if not order.get('received_at'):
        return dict(deadline_at=None,status='not_received',note='Receipt has not been confirmed. Support will review the issue before any return instructions.')
    deadline=order['received_at']+days*86400
    return dict(deadline_at=deadline,status='within_window' if days>0 and now<=deadline else 'outside_window',
                note='Seller disclosure window only. Eligibility and statutory rights require review; this date does not automatically approve or deny your request.')


def view(row,admin=False,role='customer'):
    hidden={'fingerprint','customer_id','shop_owner_id','evidence_reference','reviewer_id','refund_intent_id'}
    actions=[]
    if not admin:
        if row['state'] not in TERMINAL:actions.append('reply')
        if role=='shop' and row['state'] in ('open','merchant_replied','appealed'):actions.append('authorize_return')
        if role=='customer' and row['state']=='return_authorized':actions.append('return_sent')
        if role=='shop' and row['state'] in ('return_authorized','return_sent'):actions.append('return_received')
        if role=='customer' and row['state'] in TERMINAL and not row.get('appeal_reason') and row.get('refund_status')!='processed':actions.append('appeal')
    decisions=['reject','resolve'] if admin and row['state'] not in TERMINAL|{'refund_pending'} else []
    if decisions and (row['kind']!='return' or row.get('return_receipt_at')):decisions.insert(0,'approve_refund')
    return {k:v for k,v in row.items() if k not in hidden or admin and k not in {'fingerprint'}} | {
        'viewer_role':'operator' if admin else role,'allowed_actions':actions,'allowed_decisions':decisions,
        'can_refund':bool(admin and row.get('refund_intent_id') and row.get('refund_status')!='failed' and row['state'] in ('refund_approved','refund_pending','resolved'))}


def install(core):
    store=core.operations_store
    r=APIRouter(prefix='/operations/retail',tags=['Retail returns and resolutions'])

    def owned_order(u,oid,uid):
        row=u.get('retail_orders',oid)
        if not row or row['customer_id']!=uid:fail('NOT_FOUND','Order not found.',404)
        return row

    def case(u,cid,user,admin=False):
        row=u.get('retail_resolution_cases',cid)
        if not row:fail('NOT_FOUND','Resolution case not found.',404)
        shop=u.get('shops',row['shop_id'])
        role='operator' if admin else 'customer' if row['customer_id']==user['id'] else 'shop' if shop and shop.get('owner_id')==user['id'] else None
        if not role:fail('NOT_FOUND','Resolution case not found.',404)
        return row,role

    def command(u,uid,request_id,payload):
        cid=key('retail-resolution-command',uid,request_id)
        fp=key(payload)
        old=u.get('retail_resolution_commands',cid)
        if old and old['fingerprint']!=fp:fail('KEY_REUSED','This retry changed. Refresh the case before making a new request.',409)
        return cid,fp,old

    def record(u,cid,fp):
        u.put('retail_resolution_commands',cid,dict(id=cid,fingerprint=fp))

    def evidence(u,ids,uid,cid):
        if len(ids)!=len(set(ids)):fail('DUPLICATE_EVIDENCE','Choose distinct evidence photos.',422)
        for did in ids:
            doc=document(u,did,uid)
            claimed=u.get('cleanup_evidence_claims',did)
            if not doc.get('object') or doc.get('kind')=='scrap_camera' or doc.get('weighing_collection_id') or (u.get('captain_profiles',uid) or {}).get('photo_id')==did or claimed and claimed.get('report_id')!='retail:'+cid:
                fail('PRIVATE_EVIDENCE_REQUIRED','Upload separate evidence for this resolution case.',409)
        for did in ids:u.put('cleanup_evidence_claims',did,dict(report_id='retail:'+cid,user_id=uid))

    def append(u,row,role,action,text,ids=(),*,provider_outcome=False):
        # A provider outcome is authoritative even when the conversation has
        # reached its reply cap. Never roll back a money reconciliation merely
        # because its final fixed-size status note is the 151st event.
        if len(row['events'])>=150 and not provider_outcome:fail('CASE_HISTORY_LIMIT','Contact support to continue this long-running case.',409)
        now=time.time()
        row['events'].append(dict(id=str(len(row['events'])+1),role=role,action=action,text=text,document_ids=list(ids),at=now))
        row.update(version=row['version']+1,updated_at=now)
        u.put('retail_resolution_cases',row['id'],row)

    def allocation(u,row):
        order=u.get('retail_orders',row['order_id'])
        payable=u.get('shop_payables',row['order_id']+':'+row['product_id'])
        if not order or not payable:fail('ALLOCATION_REQUIRED','The original shop allocation needs financial review.',409)
        line=next((item for item in order['items'] if item['product_id']==row['product_id']),None)
        funded=(order.get('coupon') or {}).get('funded_by')=='repaido'
        valid_items=all(type(item.get('total_paise')) is int and type(item.get('discount_paise',0)) is int and 0<=item.get('discount_paise',0)<=item['total_paise'] for item in order['items'])
        original=line['total_paise']-(0 if funded else line.get('discount_paise',0)) if line and valid_items else -1
        if (not line or not valid_items or payable.get('retail_order_id')!=order['id']
            or payable.get('shop_id')!=row['shop_id'] or line['shop_id']!=row['shop_id']
            or type(payable.get('amount_paise')) is not int or payable['amount_paise']<0
            or type(payable.get('refund_paise',0)) is not int or payable.get('refund_paise',0)<0
            or payable['amount_paise']+payable.get('refund_paise',0)!=original):
            fail('ALLOCATION_MISMATCH','The shop allocation no longer matches the purchased item. Financial reconciliation is required.',409)
        journal_id='retail:'+order['id']
        journal=u.get('journals',journal_id) or {}
        lines=journal.get('lines') or []
        subsidy=sum(item.get('discount_paise',0) for item in order['items']) if funded else 0
        customer_total=sum(item['total_paise']-item.get('discount_paise',0) for item in order['items'])
        expected={'payment_clearing':(order['total_paise'],0),'parts_payable':(0,order['total_paise']+subsidy)}
        if subsidy:expected['community_reward_expense']=(subsidy,0)
        actual={}
        for entry in lines:
            if not isinstance(entry,dict) or type(entry.get('debit')) is not int or type(entry.get('credit')) is not int or min(entry['debit'],entry['credit'])<0:
                fail('CAPTURE_JOURNAL_REQUIRED','The original captured-payment journal needs financial review.',409)
            account=entry.get('account');debit,credit=actual.get(account,(0,0));actual[account]=(debit+entry['debit'],credit+entry['credit'])
        if (journal.get('status')!='posted' or journal.get('retail_order_id')!=order['id'] or journal.get('reversed_at')
            or customer_total!=order['total_paise'] or actual!=expected
            or u.get('journals','reverse_'+journal_id) or u.get('journals','reverse-'+journal_id)):
            fail('CAPTURE_JOURNAL_REQUIRED','A balanced, unreversed capture journal matching this order is required before refunding.',409)
        if payable.get('batch_id') or payable.get('transfer_status') in ('reserved','submitting','processed','paid') or payable.get('status')=='paid':
            fail('PAYOUT_ADJUSTMENT_REQUIRED','The shop transfer needs a separate recovery or adjustment before a refund. No refund was sent.',409)
        return payable

    def holds(u,row):
        order=u.get('retail_orders',row['order_id'])
        rows=u.find('retail_resolution_cases','order_id',row['order_id'],limit=101)
        active_ids=[item['id'] for item in rows if item['state'] not in TERMINAL]
        if active_ids and not order.get('resolution_open_case_ids'):
            order['before_resolution_financial_hold']=bool(order.get('financial_hold'))
        order['resolution_open_case_ids']=active_ids
        order['financial_hold']=bool(active_ids or order.get('before_resolution_financial_hold') or order.get('allocation_review_required'))
        order['complaint_count']=len(rows)
        order['return_requested']=any(item['kind']=='return' for item in rows)
        payable=u.get('shop_payables',row['order_id']+':'+row['product_id'])
        if payable:
            active=row['state'] not in TERMINAL
            if active:
                if not payable.get('resolution_case_open'):
                    payable.update(before_resolution_status=payable['status'],before_resolution_financial_hold=bool(payable.get('financial_hold')))
                payable.update(financial_hold=True,status='recovery_review_required' if payable.get('batch_id') else 'retail_resolution_hold')
            else:
                payable['financial_hold']=bool(payable.get('before_resolution_financial_hold'))
                payable['status']='refund_completed' if payable['amount_paise']==0 else 'recovery_review_required' if payable.get('batch_id') else payable.get('before_resolution_status','retail_receipt_review') if payable['financial_hold'] else 'retail_receipt_review' if order.get('received_at') else 'awaiting_fulfillment'
            payable['resolution_case_open']=active
            u.put('shop_payables',payable['id'],payable)
        u.put('retail_orders',order['id'],order)

    @r.get('/orders/{oid}/resolutions')
    def order_cases(oid:str,user=Depends(core.current_user)):
        def read(u):
            owned_order(u,oid,user['id'])
            return {'cases':[view(row) for row in u.find('retail_resolution_cases','order_id',oid,limit=101)]}
        return store.run(read)

    @r.post('/orders/{oid}/resolutions')
    def request(oid:str,body:RequestCase,user=Depends(core.current_user)):
        def save(u):
            order=owned_order(u,oid,user['id'])
            if order['state']!='paid' or not order.get('payment_id'):fail('PAID_ORDER_REQUIRED','A verified paid order is required. Contact payment support for an unconfirmed charge.',409)
            line=next((item for item in order['items'] if item['product_id']==body.product_id),None)
            if not line or body.quantity>line['quantity']:fail('ITEM_REQUIRED','Select an item and quantity from this purchase.',422)
            if len(body.reason.strip())<20:fail('REASON_REQUIRED','Describe the issue in at least 20 characters.',422)
            cid=key('retail-resolution',oid,body.product_id)
            cmd,fp,old=command(u,user['id'],body.request_id,oid+':open:'+body.model_dump_json())
            current=u.get('retail_resolution_cases',cid)
            if old:return view(current)
            if current:fail('CASE_EXISTS','A case already exists for this item. Open its history to reply or appeal.',409)
            evidence(u,body.document_ids,user['id'],cid)
            from lifecycle import support_targets
            now=time.time()
            row=dict(id=cid,order_id=oid,product_id=body.product_id,shop_id=line['shop_id'],customer_id=user['id'],
                     kind=body.kind,quantity=body.quantity,reason=body.reason.strip(),item={k:v for k,v in line.items() if k in ('product_id','name','quantity','return_policy','condition')},
                     max_refund_paise=(line['total_paise']-line.get('discount_paise',0))*body.quantity//line['quantity'],
                     policy_window=policy_window(order,line,now),state='open',version=0,events=[],created_at=now,updated_at=now,**support_targets(now))
            append(u,row,'customer','opened',body.reason.strip(),body.document_ids)
            holds(u,row);record(u,cmd,fp)
            audit(u,'RetailResolutionOpened',user['id'],case_id=cid,order_id=oid)
            return view(row)
        return store.run(save)

    @r.get('/resolutions/shop')
    def shop_cases(shop_id:str='',cursor:str|None=Query(default=None,max_length=100),user=Depends(core.current_user)):
        def read(u):
            shops=u.find('shops','owner_id',user['id'],limit=51)
            selected=shop_id or (shops[0]['id'] if shops else '')
            shop=u.get('shops',selected) if selected else None
            if selected and (not shop or shop['owner_id']!=user['id']):fail('NOT_FOUND','Shop not found.',404)
            rows=u.find('retail_resolution_cases','shop_id',selected,limit=51,after=cursor) if selected else []
            return dict(cases=[view(row,role='shop') for row in rows[:50]],shops=[dict(id=s['id'],name=s['name']) for s in shops[:50]],selected_shop_id=selected,next_cursor=rows[49]['id'] if len(rows)>50 else None)
        return store.run(read)

    @r.get('/admin/resolutions')
    def admin_cases(state:Literal['open','merchant_replied','return_authorized','return_sent','return_received','refund_approved','refund_pending','resolved','rejected','appealed']='open',cursor:str|None=Query(default=None,max_length=100),admin=Depends(core.operator)):
        def read(u):
            rows=u.find('retail_resolution_cases','state',state,limit=51,after=cursor)
            return dict(cases=[view(row,True) for row in rows[:50]],next_cursor=rows[49]['id'] if len(rows)>50 else None)
        return store.run(read)

    @r.get('/resolutions/{cid}')
    def detail(cid:str,user=Depends(core.current_user)):
        def read(u):
            row,role=case(u,cid,user)
            return view(row,role=role)
        return store.run(read)

    @r.get('/admin/resolutions/{cid}')
    def admin_detail(cid:str,admin=Depends(core.operator)):
        return store.run(lambda u:view(case(u,cid,admin,True)[0],True))

    def photo(cid,did,user,admin=False):
        def read(u):
            row,_=case(u,cid,user,admin)
            if not any(did in item['document_ids'] for item in row['events']):fail('NOT_FOUND','Evidence not found.',404)
            doc=u.get('business_documents',did)
            if not doc or (u.get('cleanup_evidence_claims',did) or {}).get('report_id')!='retail:'+cid:fail('NOT_FOUND','Evidence not found.',404)
            return doc
        doc=store.run(read)
        return Response(download_object(doc['object']),media_type='image/jpeg',headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'})

    @r.get('/resolutions/{cid}/evidence/{did}')
    def private_photo(cid:str,did:str,user=Depends(core.current_user)):return photo(cid,did,user)

    @r.get('/admin/resolutions/{cid}/evidence/{did}')
    def admin_photo(cid:str,did:str,admin=Depends(core.operator)):return photo(cid,did,admin,True)

    @r.post('/resolutions/{cid}/actions')
    def action(cid:str,body:Action,user=Depends(core.current_user)):
        def save(u):
            row,role=case(u,cid,user)
            cmd,fp,old=command(u,user['id'],body.request_id,cid+':action:'+body.model_dump_json())
            if old:return view(row,role=role)
            if row['version']!=body.expected_version:fail('STALE_VERSION','Refresh the case before replying.',409)
            if len(body.note.strip())<10:fail('NOTE_REQUIRED','Describe the update in at least 10 characters.',422)
            if row['state'] in TERMINAL and body.action!='appeal':fail('CASE_CLOSED','Use an appeal to request another review of a closed case.',409)
            if body.action=='appeal':
                if role!='customer' or row['state'] not in TERMINAL or row.get('appeal_reason') or row.get('refund_status')=='processed':fail('APPEAL_UNAVAILABLE','A closed decision can be appealed once. Contact support for a processed refund concern.',409)
                row.update(state='appealed',appeal_reason=body.note.strip(),appealed_at=time.time(),resolved_at=None)
            elif body.action=='authorize_return':
                if role!='shop' or row['state'] not in ('open','merchant_replied','appealed') or not body.return_by or not time.time()<body.return_by<=time.time()+90*86400:fail('RETURN_AUTHORIZATION_REQUIRED','Only this shop can give return instructions and a deadline within the next 90 days.',409)
                row.update(state='return_authorized',return_by=body.return_by)
            elif body.action=='return_sent':
                if role!='customer' or row['state']!='return_authorized':fail('RETURN_NOT_AUTHORIZED','Wait for the shop’s return instructions before marking items sent.',409)
                row.update(state='return_sent',return_sent_at=time.time())
            elif body.action=='return_received':
                if role!='shop' or row['state'] not in ('return_authorized','return_sent') or not body.document_ids:fail('RETURN_RECEIPT_REQUIRED','The shop must attach evidence of the returned items before confirming receipt.',409)
                row.update(state='return_received',return_receipt_at=time.time())
            elif role=='shop' and row['state']=='open':row['state']='merchant_replied'
            evidence(u,body.document_ids,user['id'],cid)
            if role=='shop' and not row.get('response_received_at'):row['response_received_at']=time.time()
            append(u,row,role,body.action,body.note.strip(),body.document_ids)
            holds(u,row);record(u,cmd,fp)
            return view(row,role=role)
        return store.run(save)

    @r.post('/admin/resolutions/{cid}/decision')
    def decision(cid:str,body:Decision,admin=Depends(core.operator)):
        def save(u):
            row,_=case(u,cid,admin,True)
            cmd,fp,old=command(u,admin['id'],body.request_id,cid+':decision:'+body.model_dump_json())
            if old:return view(row,True)
            if row['version']!=body.expected_version:fail('STALE_VERSION','Refresh the case before recording a decision.',409)
            if row['customer_id']==admin['id'] or (u.get('shops',row['shop_id']) or {}).get('owner_id')==admin['id']:fail('INDEPENDENT_REVIEW_REQUIRED','Another operator must decide a case involving your account.',403)
            if row['state'] in TERMINAL or row['state']=='refund_pending':fail('CASE_NOT_REVIEWABLE','Review an open case or reconcile its pending refund first.',409)
            if len(body.note.strip())<20 or len(body.evidence_reference.strip())<8:fail('REVIEW_REQUIRED','Record the evidence reviewed and your decision reason.',422)
            now=time.time()
            if body.decision=='approve_refund':
                if not 0<body.refund_amount_paise<=row['max_refund_paise']:fail('INVALID_REFUND_AMOUNT','Choose an amount within this case’s purchased quantity and customer-paid total.',422)
                if row['kind']=='return' and not row.get('return_receipt_at'):fail('RETURN_RECEIPT_REQUIRED','The shop must record actual returned-item receipt before a return refund is approved.',409)
                allocation(u,row)
                row.update(state='refund_approved',refund_amount_paise=body.refund_amount_paise,refund_status='approved',refund_attempt=row.get('refund_attempt',0)+1)
                row['refund_intent_id']=key('retail-refund',cid,str(row['refund_attempt']))
            else:
                if body.refund_amount_paise:fail('INVALID_REFUND_AMOUNT','Only an approved refund decision can specify a refund amount.',422)
                row.update(state='rejected' if body.decision=='reject' else 'resolved',resolved_at=now)
            row.update(decision_note=body.note.strip(),evidence_reference=body.evidence_reference.strip(),reviewer_id=admin['id'],response_received_at=row.get('response_received_at') or now)
            append(u,row,'operator',body.decision,body.note.strip())
            holds(u,row);record(u,cmd,fp)
            audit(u,'RetailResolutionDecided',admin['id'],case_id=cid,decision=body.decision,amount_paise=body.refund_amount_paise)
            return view(row,True)
        return store.run(save)

    def payment_matches(payment,order):
        return (payment.get('id')==order.get('payment_id') and payment.get('order_id')==order.get('order_id')
                and type(payment.get('amount')) is int and payment['amount']==order['total_paise'] and payment.get('currency')=='INR'
                and payment.get('status') in ('captured','refunded') and payment.get('captured') is True
                and type(payment.get('amount_refunded')) is int
                and order.get('provider_amount_refunded',0)<=payment['amount_refunded']<=payment['amount'])

    def reconcile(intent,result):
        if (result.get('payment_id')!=intent['payment_id'] or type(result.get('amount')) is not int
            or result['amount']!=intent['amount_paise'] or result.get('receipt')!=intent['receipt']
            or result.get('currency')!='INR' or not re.fullmatch(r'rfnd_[A-Za-z0-9]+',str(result.get('id','')))
            or result.get('status') not in ('pending','processed','failed')):
            fail('REFUND_MISMATCH','The provider refund does not match this approved intent. Financial review is required.',409)
        payment=razorpay('payments/'+intent['payment_id'])
        def save(u):
            saved=u.get('retail_refund_intents',intent['id']);row=u.get('retail_resolution_cases',saved['case_id']);order=u.get('retail_orders',row['order_id'])
            if not payment_matches(payment,order):fail('PAYMENT_MISMATCH','The provider payment does not match this order.',409)
            if saved.get('provider_id') and saved['provider_id']!=result['id']:fail('REFUND_CONFLICT','Multiple provider refunds require financial review.',409)
            if saved['status']=='processed' or saved['status']=='failed' and result['status']=='failed':return view(row,True)
            if result['status']=='processed' and payment['amount_refunded']!=saved['previous_refunded_paise']+saved['amount_paise']:
                fail('REFUND_UNCONFIRMED','The payment’s refunded balance does not match this exact approved refund. Financial reconciliation is required.',409)
            saved.update(status=result['status'],provider_id=result['id'],checked_at=time.time())
            row['refund_status']=result['status']
            if result['status']=='processed':
                payable=allocation(u,row)
                if payable['amount_paise']<saved['allocation_reduction_paise']:fail('ALLOCATION_CHANGED','The shop allocation changed and needs financial review.',409)
                payable.update(amount_paise=payable['amount_paise']-saved['allocation_reduction_paise'],refund_paise=payable.get('refund_paise',0)+saved['allocation_reduction_paise'])
                u.put('shop_payables',payable['id'],payable)
                lines=[dict(account='parts_payable',debit=saved['allocation_reduction_paise'],credit=0),dict(account='payment_clearing',debit=0,credit=saved['amount_paise'])]
                if saved['subsidy_reversal_paise']:lines.append(dict(account='community_reward_expense',debit=0,credit=saved['subsidy_reversal_paise']))
                post(u,'retail-refund:'+saved['id'],lines,retail_order_id=order['id'])
                order['amount_refunded']=max(order.get('amount_refunded',0),payment['amount_refunded'])
                order.update(refunded_at=time.time(),refund_pending=False)
                if order['amount_refunded']==order['total_paise']:order['state']='refunded'
                row.update(state='resolved',resolved_at=time.time(),refund_provider_id=result['id'])
                append(u,row,'operator','refund_processed','The payment provider confirmed the approved refund.',provider_outcome=True)
            elif result['status']=='failed':
                order['refund_pending']=False
                row['state']='refund_approved'
                append(u,row,'operator','refund_failed','The provider marked this refund failed. A new reviewed approval is required before another refund intent.',provider_outcome=True)
            else:
                row.update(updated_at=time.time(),version=row['version']+1)
                u.put('retail_resolution_cases',row['id'],row)
            u.put('retail_refund_intents',saved['id'],saved)
            u.put('retail_orders',order['id'],order)
            holds(u,row)
            audit(u,'RetailRefundReconciled','provider',case_id=row['id'],refund_id=saved['id'],status=saved['status'])
            return view(row,True)
        return store.run(save)

    def check(intent):
        if intent.get('provider_id'):return reconcile(intent,razorpay('refunds/'+intent['provider_id']))
        matches=[]
        for skip in range(0,1000,100):
            rows=razorpay('payments/'+intent['payment_id']+'/refunds?count=100&skip='+str(skip)).get('items',[])
            matches.extend(item for item in rows if item.get('receipt')==intent['receipt'])
            if len(rows)<100:break
        if len(matches)>1:fail('REFUND_CONFLICT','Multiple provider records match this intent. Financial review is required.',409)
        if matches:return reconcile(intent,matches[0])
        row=store.run(lambda u:u.get('retail_resolution_cases',intent['case_id']))
        return {**view(row,True),'recovery':'Provider outcome is still unknown. No second refund was sent.'}

    @r.post('/admin/resolutions/{cid}/refund')
    def refund(cid:str,admin=Depends(core.operator)):
        if not payments_ready():fail('PAYMENTS_UNAVAILABLE','Provider refunds are not activated. No refund was sent.',503)
        def read(u):
            row,_=case(u,cid,admin,True)
            if row['state'] not in ('refund_approved','refund_pending','resolved') or not row.get('refund_intent_id'):fail('REFUND_APPROVAL_REQUIRED','Record an independent refund approval first.',409)
            return row,u.get('retail_refund_intents',row['refund_intent_id']),u.get('retail_orders',row['order_id'])
        row,intent,order=store.run(read)
        if intent:return check(intent)
        payment=razorpay('payments/'+order['payment_id'])
        if not payment_matches(payment,order):fail('PAYMENT_MISMATCH','Verify the captured order payment before sending a refund.',409)
        def reserve(u):
            current,_=case(u,cid,admin,True);order=u.get('retail_orders',current['order_id'])
            previous=u.get('retail_refund_intents',row['refund_intent_id'])
            if previous:return previous,False
            if current.get('refund_intent_id')!=row['refund_intent_id'] or current['state']!='refund_approved':fail('APPROVAL_CHANGED','Refresh the changed refund decision.',409)
            if order.get('refund_pending'):fail('REFUND_PENDING','Reconcile the order’s existing refund before another refund.',409)
            if not payment_matches(payment,order):fail('PAYMENT_MISMATCH','A newer provider refund needs reconciliation before this refund can be sent.',409)
            if order.get('amount_refunded',0)!=payment['amount_refunded']:fail('EXTERNAL_REFUND_REVIEW','A provider refund outside this record requires financial reconciliation first.',409)
            amount=current['refund_amount_paise']
            if amount>order['total_paise']-payment['amount_refunded']:fail('REFUND_EXCEEDS_PAYMENT','The refund exceeds the captured balance.',409)
            payable=allocation(u,current)
            line=next(item for item in order['items'] if item['product_id']==current['product_id'])
            subsidy=line.get('discount_paise',0) if (order.get('coupon') or {}).get('funded_by')=='repaido' else 0
            customer_paid=line['total_paise']-line.get('discount_paise',0)
            reversal=subsidy*amount//max(1,customer_paid)
            if payable['amount_paise']<amount+reversal:fail('ALLOCATION_CHANGED','The original shop allocation does not cover this refund.',409)
            saved=dict(id=current['refund_intent_id'],case_id=cid,order_id=order['id'],payment_id=order['payment_id'],receipt='rr_'+current['refund_intent_id'][:32],amount_paise=amount,allocation_reduction_paise=amount+reversal,subsidy_reversal_paise=reversal,previous_refunded_paise=payment['amount_refunded'],status='submitting',created_at=time.time())
            u.put('retail_refund_intents',saved['id'],saved)
            order['refund_pending']=True;u.put('retail_orders',order['id'],order)
            current.update(state='refund_pending',refund_status='submitting')
            append(u,current,'operator','refund_submitted','The approved refund was submitted for provider processing. A confirmation is still required.')
            return saved,True
        intent,created=store.run(reserve)
        if not created:return check(intent)
        try:
            result=razorpay('payments/'+intent['payment_id']+'/refund',dict(amount=intent['amount_paise'],receipt=intent['receipt'],speed='normal',notes={'retail_resolution':cid}))
        except Exception:
            fail('REFUND_RECONCILING','The refund outcome is unknown. Check this same case to reconcile; no additional refund will be sent.',503)
        return reconcile(intent,result)

    core.app.include_router(r)
