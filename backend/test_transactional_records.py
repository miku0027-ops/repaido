"""Saved support/work records and their private transactional-email intents.

These journeys use the actual API/store. No SMTP connection is made; queued
records are inspected and rendered locally, never treated as inbox delivery.
"""
import io
import json
import uuid

import pytest
from fastapi import HTTPException
from PIL import Image

import main
import transactional_mail as mail
from test_operations import api, auth, ADMIN
from test_custom_contract_integration import (
    finance_api, custom_api, custom_query, custom_bid, custom_award,
    awarded_project, record_state, payment_request, approve_payment, capture_payment,
)


def deliveries(kind=None):
    rows=main.operations_store.run(lambda u:u.all('transactional_mail_delivery'))
    return [row for row in rows if kind is None or row['kind']==kind]


def assert_mail(kind, recipients, record_id, forbidden=()):
    rows=deliveries(kind)
    selected=[row for row in rows if row['payload'].get('record_id')==record_id]
    assert {row['recipient_id'] for row in selected}==set(recipients)
    assert len(selected)==len(set(recipients))
    for row in selected:
        assert set(row['payload'])=={'record_type','record_id','path'}
        assert row['status']!='accepted'
        assert main.operations_store.run(lambda u:u.get('transactional_mail_queue',row['id']))
        text='\n'.join(part.get_content() for part in mail.message(row,
            {'email':row['recipient_id']+'@example.com'},
            mail.SMTPSettings('smtp.example.com',465,'isolated-test','unused','https://repaido.web.app')).walk()
            if part.get_content_type() in ('text/plain','text/html'))
        encoded=json.dumps(row)
        for private in forbidden:
            assert private not in text and private not in encoded
        assert 'Private records require sign-in.' in text
    return selected


def support_body():
    return dict(name='Private Customer',phone='9876543210',subject='Private billing question',
        message='PRIVATE support account details and disputed work description.',request_id=str(uuid.uuid4()))


def test_legacy_ticket_is_canonical_private_and_idempotent_with_merged_history(api):
    with main.db() as connection:
        connection.execute('INSERT INTO support_tickets VALUES(?,?,?,?,?,?,?,?)',
            ('old-owner-ticket','customer','Old owner','9876543210','Older question','Prior saved issue.','open',1))
        connection.execute('INSERT INTO support_tickets VALUES(?,?,?,?,?,?,?,?)',
            ('old-outsider-ticket','stranger','Other owner','9876543210','Private question','Other private issue.','open',2))
    body=support_body()
    result=api.post('/support-tickets',headers=auth('customer'),json=body)
    assert result.status_code==201,result.text
    tid=result.json()['ticket_id']
    assert tid.startswith('REP-TICKET-')
    again=api.post('/support-tickets',headers=auth('customer'),json=body)
    assert again.json()==result.json()
    assert api.post('/support-tickets',headers=auth('customer'),json={**body,'message':'A changed support request.'}).status_code==409
    detail=api.get('/operations/support/'+tid,headers=auth('customer'))
    assert detail.status_code==200,detail.text
    assert detail.json()['case']['customer_id']=='customer'
    assert len(detail.json()['messages'])==1
    assert body['message'] in detail.json()['messages'][0]['message']
    assert api.get('/operations/support/'+tid,headers=auth('stranger')).status_code==404
    response=api.get('/support-tickets',headers=auth('customer'))
    assert 'no-store' in response.headers['cache-control']
    assert {row['id'] for row in response.json()['tickets']}=={tid,'old-owner-ticket'}
    row=next(row for row in response.json()['tickets'] if row['id']==tid)
    assert set(row)=={'id','user_id','name','phone','subject','message','status','created_at'}
    assert row['user_id']=='customer' and row['message']==body['message']
    assert {row['id'] for row in api.get('/support-tickets',headers=auth('stranger')).json()['tickets']}=={'old-outsider-ticket'}
    assert_mail('support_opened',{'customer'},tid,(body['phone'],body['message'],body['subject']))
    assert api.post('/support-tickets',headers=auth('customer'),json={**body,'user_id':'stranger'}).status_code==422


@pytest.mark.parametrize('legacy',[False,True])
def test_support_queue_failure_rolls_back_case_message_and_receipt(api,monkeypatch,legacy):
    original=mail.enqueue
    def fail_after_enqueue(u,*args,**kwargs):
        original(u,*args,**kwargs)
        raise HTTPException(503,'Isolated test enqueue failure')
    monkeypatch.setattr(mail,'enqueue',fail_after_enqueue)
    body=support_body() if legacy else dict(category='general',message='Private request to open an account issue.',request_id=str(uuid.uuid4()))
    result=api.post('/support-tickets' if legacy else '/operations/support',headers=auth('customer'),json=body)
    assert result.status_code==503,result.text
    for kind in ('support_cases','support_messages','legacy_support_ticket_commands','transactional_mail_delivery','transactional_mail_queue'):
        assert main.operations_store.run(lambda u:u.all(kind))==[]
    assert api.get('/support-tickets',headers=auth('customer')).json()['tickets']==[]


def test_support_reply_resolution_are_only_queued_for_actual_owner(api):
    body=dict(category='general',message='PRIVATE request with sensitive account context.',request_id=str(uuid.uuid4()))
    response=api.post('/operations/support',headers=auth('customer'),json=body)
    assert response.status_code==201,response.text
    tid=response.json()['id']
    assert_mail('support_opened',{'customer'},tid,(body['message'],))
    message=dict(message='PRIVATE support reviewer response.',request_id=str(uuid.uuid4()))
    assert api.post('/operations/support/'+tid+'/messages',headers=auth('stranger'),json=message).status_code==404
    assert deliveries('support_reply')==[]
    for _ in range(2):
        result=api.post('/operations/admin/support/'+tid+'/messages',headers=ADMIN,json=message)
        assert result.status_code==200,result.text
    assert_mail('support_reply',{'customer'},tid,(message['message'],))
    case=api.get('/operations/support/'+tid,headers=auth('customer')).json()['case']
    result=api.post('/operations/admin/support/'+tid+'/actions',headers=ADMIN,
        json=dict(action='resolve',expected_version=case['version'],reason='PRIVATE resolution explanation after an actual review.'))
    assert result.status_code==200,result.text
    assert_mail('support_updated',{'customer'},tid,('PRIVATE resolution',))


def test_legacy_optional_request_id_and_signed_owner_are_preserved(api):
    body=support_body();body.pop('request_id')
    first=api.post('/support-tickets',headers=auth('customer'),json=body)
    assert first.status_code==201,first.text
    second=api.post('/support-tickets',headers=auth('customer'),json=body)
    assert second.status_code==201 and first.json()['ticket_id']!=second.json()['ticket_id']
    stable={**body,'request_id':'same-request-id-owned-by-each-account'}
    mine=api.post('/support-tickets',headers=auth('customer'),json=stable)
    other=api.post('/support-tickets',headers=auth('stranger'),json=stable)
    assert mine.status_code==other.status_code==201
    assert mine.json()['ticket_id']!=other.json()['ticket_id']
    assert api.get('/operations/support/'+other.json()['ticket_id'],headers=auth('customer')).status_code==404


def test_custom_proposal_award_email_uses_real_participants_and_saved_ids(custom_api):
    q=custom_query(custom_api)
    private=(q['site'],q['scope'])
    assert_mail('contract_posted',{'shop'},q['id'],private)
    q=custom_bid(custom_api,q)
    assert_mail('contract_proposal_submitted',{'shop','worker'},q['id'],private)
    request_id=str(uuid.uuid4())
    award=custom_award(custom_api,q,q['bids'][0]['id'],request_id)
    assert award.status_code==200,award.text
    assert main.operations_store.run(lambda u:u.get('contract_projects',award.json()['project']['id']))
    assert_mail('contract_awarded',{'shop','worker'},q['id'],private)
    replay=custom_award(custom_api,q,q['bids'][0]['id'],request_id)
    assert replay.status_code==200,replay.text
    assert_mail('contract_awarded',{'shop','worker'},q['id'])


def test_contract_progress_and_payment_request_do_not_claim_verified_payment(finance_api,monkeypatch):
    p=awarded_project(finance_api,monkeypatch)
    path='/operations/contracts/projects/'+p['id']
    body=dict(request_id=str(uuid.uuid4()),expected_version=record_state(finance_api,p,'worker')['version'],
        percent=20,note='PRIVATE progress notes with exact site instructions.')
    result=finance_api.post(path+'/progress',headers=auth('worker'),json=body)
    assert result.status_code==200,result.text
    assert_mail('contract_progress',{'shop','worker'},p['id'],(body['note'],p['site'],p['scope']))
    assert finance_api.post(path+'/progress',headers=auth('worker'),json=body).status_code==200
    assert_mail('contract_progress',{'shop','worker'},p['id'])
    progress=result.json()['progress'][0]
    review=dict(request_id=str(uuid.uuid4()),expected_version=record_state(finance_api,p)['version'],approved=True,note='PRIVATE inspection review.')
    checked=finance_api.post(path+'/progress/'+progress['id']+'/review',headers=auth('shop'),json=review)
    assert checked.status_code==200,checked.text
    assert_mail('contract_progress_reviewed',{'shop','worker'},p['id'],(review['note'],))
    result,request=payment_request(finance_api,p,300000)
    assert result.status_code==200,result.text
    assert_mail('contract_payment_requested',{'shop','worker'},p['id'],(p['site'],))
    assert finance_api.post(path+'/payments',headers=auth('worker'),json=request).status_code==200
    assert_mail('contract_payment_requested',{'shop','worker'},p['id'])
    row=result.json()['payments'][0]
    assert deliveries('payment_confirmed')==[]
    approved=approve_payment(finance_api,p,row)
    assert approved['financials']['confirmed_paid_paise']==0
    assert_mail('contract_payment_decided',{'shop','worker'},p['id'])
    assert deliveries('payment_confirmed')==[]
    captured=capture_payment(finance_api,p,row)
    assert captured['financials']['confirmed_paid_paise']==300000
    report_id=captured['payments'][0]['report_id']
    saved=main.operations_store.run(lambda u:u.get('contract_reports',report_id))
    assert saved and saved['project_id']==p['id']
    assert_mail('payment_confirmed',{'shop','worker'},report_id,(p['site'],p['scope'],body['note']))
    assert finance_api.post(path+'/payments/'+row['id']+'/check',headers=auth('shop'),json={'payment_id':'pay_Contract1'}).status_code==200
    assert_mail('payment_confirmed',{'shop','worker'},report_id)


def test_reported_bank_transfer_email_stays_distinct_from_verified_confirmation(finance_api,monkeypatch):
    p=awarded_project(finance_api,monkeypatch);path='/operations/contracts/projects/'+p['id']
    result,_=payment_request(finance_api,p,200000,method='neft')
    assert result.status_code==200,result.text
    row=result.json()['payments'][0];approve_payment(finance_api,p,row)
    out=io.BytesIO();Image.new('RGB',(20,20),'green').save(out,format='JPEG')
    uploaded=finance_api.post(path+'/attachments?purpose=payment',headers={**auth('shop'),'Content-Type':'image/jpeg'},content=out.getvalue())
    assert uploaded.status_code==200,uploaded.text
    body=dict(request_id=str(uuid.uuid4()),expected_version=record_state(finance_api,p)['version'],
        reference='PRIVATE-UTR-REFERENCE',evidence_ids=[uploaded.json()['id']],note='PRIVATE bank transfer description.')
    response=finance_api.post(path+'/payments/'+row['id']+'/reported',headers=auth('shop'),json=body)
    assert response.status_code==200,response.text
    assert response.json()['financials']['confirmed_paid_paise']==0
    assert_mail('contract_transfer_reported',{'shop','worker'},p['id'],(body['reference'],body['note']))
    assert deliveries('payment_confirmed')==[]
    proof=dict(approved=True,verified_reference=body['reference'],evidence_reference='isolated-bank-review-proof',
        reason='Independent operator verification of the actual transfer and matching reference.')
    denied=finance_api.post('/operations/contracts/admin/payments/'+row['id']+'/verify-external',headers=auth('shop'),json=proof)
    assert denied.status_code==403
    assert deliveries('payment_confirmed')==[]
    checked=finance_api.post('/operations/contracts/admin/payments/'+row['id']+'/verify-external',headers=ADMIN,json=proof)
    assert checked.status_code==200,checked.text
    assert_mail('contract_transfer_reviewed',{'shop','worker'},p['id'],(body['reference'],))
    report_id=record_state(finance_api,p)['payments'][0]['report_id']
    assert_mail('payment_confirmed',{'shop','worker'},report_id,(body['reference'],body['note']))


def test_contract_queue_failure_cannot_leave_saved_progress_or_money_reservation(finance_api,monkeypatch):
    p=awarded_project(finance_api,monkeypatch);path='/operations/contracts/projects/'+p['id']
    before=record_state(finance_api,p,'worker');rows=deliveries()
    original=mail.enqueue
    def fail_after_enqueue(u,*args,**kwargs):
        original(u,*args,**kwargs)
        raise HTTPException(503,'Isolated test queue failure')
    monkeypatch.setattr(mail,'enqueue',fail_after_enqueue)
    for suffix,body in [('progress',dict(percent=10,note='Actual private progress requiring an atomic notification.')),
                        ('payments',dict(amount_paise=10000,method='gateway'))]:
        response=finance_api.post(path+'/'+suffix,headers=auth('worker'),json=dict(request_id=str(uuid.uuid4()),expected_version=before['version'],**body))
        assert response.status_code==503,response.text
        current=record_state(finance_api,p,'worker')
        assert current['version']==before['version']
        assert current['payments']==[] and current['progress']==[]
        assert current['financials']['pending_reserved_paise']==0
        assert deliveries()==rows
