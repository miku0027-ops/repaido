"""Real durable store tests with a fake SMTP server; no email leaves the test."""
import base64
import hashlib
import json
import smtplib
import sqlite3
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from types import SimpleNamespace
from pathlib import Path

import pytest
from fastapi import HTTPException

import account_profile
import transactional_mail as mail
from operations import Store, Unit


@pytest.fixture
def core(tmp_path, monkeypatch):
    path = str(tmp_path / 'mail.db')
    @contextmanager
    def db():
        conn = sqlite3.connect(path); conn.row_factory = sqlite3.Row
        try:
            yield conn; conn.commit()
        finally:
            conn.close()
    core = SimpleNamespace(DB_PATH=path, USE_FIRESTORE=False, db=db)
    core.operations_store = Store(core); core.operations_store.init(); mail.initialize(core)
    for name,value in {'REPAIDO_TRANSACTIONAL_EMAIL_ENABLED':'true','REPAIDO_SMTP_HOST':'smtp.fixture.test','REPAIDO_SMTP_PORT':'465',
                       'REPAIDO_SMTP_USERNAME':'support@repaido.com','REPAIDO_SMTP_PASSWORD':'fixture-private-password',
                       'REPAIDO_PUBLIC_WEB_URL':'https://repaido.web.app','REPAIDO_EMAIL_CHALLENGE_SECRET':'fixture-challenge-secret-at-least-32-characters'}.items():
        monkeypatch.setenv(name,value)
    monkeypatch.delenv('REPAIDO_SMTP_FROM',raising=False)
    core.operations_store.run(lambda u:u.put('account_contacts','customer',dict(id='customer',email='customer@fixture.test',email_verified=True,version=1)))
    monkeypatch.setattr(Unit,'all',lambda *args: (_ for _ in ()).throw(AssertionError('Unbounded collection scan')))
    return core


@pytest.fixture
def smtp(monkeypatch):
    state = dict(messages=[],calls=[],error=None,on_login=None,refused={})
    class Client:
        def __init__(self,host,port,**kwargs):
            state['calls'].append(('connect',host,port,kwargs))
            if state['error']=='connect':raise OSError('fixture-private-password customer@fixture.test')
        def ehlo(self):state['calls'].append(('ehlo',))
        def starttls(self,context):state['calls'].append(('starttls',context.verify_mode,context.check_hostname))
        def login(self,username,password):
            state['calls'].append(('login',))
            if state['on_login']:state['on_login']()
            if state['error']=='auth':raise smtplib.SMTPAuthenticationError(535,b'fixture-private-password')
        def send_message(self,message,from_addr,to_addrs):
            state['calls'].append(('data',))
            if state['error']=='temporary':raise smtplib.SMTPDataError(451,b'fixture-private-password')
            if state['error']=='permanent':raise smtplib.SMTPRecipientsRefused({to_addrs[0]:(550,b'customer@fixture.test')})
            if state['error']=='unknown':raise smtplib.SMTPServerDisconnected('fixture-private-password')
            state['messages'].append((message,from_addr,to_addrs))
            return state['refused']
        def close(self):state['calls'].append(('close',))
    monkeypatch.setattr(mail.smtplib,'SMTP_SSL',Client);monkeypatch.setattr(mail.smtplib,'SMTP',Client)
    return state


def enqueue(core,event='event-one',kind='booking_confirmed',recipients=('customer',),payload=None):
    return core.operations_store.run(lambda u:mail.enqueue(u,event,kind,list(recipients),payload if payload is not None else dict(record_type='booking',record_id='booking-one',path='/?view=booking&reference=booking-one')))


def row(core,key=None):
    if key:return core.operations_store.run(lambda u:u.get('transactional_mail_delivery',key))
    with core.db() as conn:
        return json.loads(conn.execute("SELECT body FROM operation_records WHERE kind='transactional_mail_delivery' ORDER BY id LIMIT 1").fetchone()['body'])


def due(core,key=None):
    current=row(core,key)
    def update(u):
        latest=u.get('transactional_mail_delivery',current['id']);latest['next_attempt_at']=0;latest['lease_until']=0;mail._save(u,latest)
    core.operations_store.run(update)


def test_idempotent_enqueue_and_smtp_acceptance_is_not_delivery(core,smtp):
    queued=enqueue(core);assert enqueue(core)==queued
    result=mail.dispatch(core)
    assert result['accepted']==1 and result['acceptance_is_delivery'] is False
    saved=row(core);assert saved['status']=='accepted' and saved['attempts']==1 and saved['accepted_at']>0
    message,sender,recipients=smtp['messages'][0]
    assert sender=='support@repaido.com' and recipients==['customer@fixture.test']
    assert message['Message-ID']==saved['message_id'] and message['Reply-To']=='support@repaido.com'
    assert message.get_body(('plain',)) and message.get_body(('html',))
    assert '&amp;' in message.get_body(('html',)).get_content()
    assert 'fixture-private-password' not in message.as_string()
    assert 'customer@fixture.test' not in json.dumps(saved)
    assert mail.dispatch(core)['attempted']==0 and len(smtp['messages'])==1
    with pytest.raises(HTTPException) as error:enqueue(core,payload=dict(record_type='booking',record_id='other-booking'))
    assert error.value.status_code==409


def test_concurrent_workers_share_one_durable_recipient_claim(core,smtp):
    enqueue(core)
    with ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(lambda _:mail.dispatch(core),range(4)))
    assert sum(result['accepted'] for result in results)==1 and len(smtp['messages'])==1
    assert row(core)['attempts']==1


@pytest.mark.parametrize('port',['465','587'])
def test_tls_and_certificate_validation_precede_credentials(core,smtp,monkeypatch,port):
    monkeypatch.setenv('REPAIDO_SMTP_PORT',port);enqueue(core);mail.dispatch(core)
    calls=[call[0] for call in smtp['calls']]
    assert smtp['calls'][0][3]['timeout']==15
    if port=='465':
        context=smtp['calls'][0][3]['context'];assert context.check_hostname and context.verify_mode==2
        assert 'starttls' not in calls
    else:
        assert calls.index('starttls')<calls.index('login')<calls.index('data')
        assert next(call for call in smtp['calls'] if call[0]=='starttls')[1:]==(2,True)


@pytest.mark.parametrize('name,value',[('REPAIDO_SMTP_PORT','25'),('REPAIDO_SMTP_FROM','attacker@fixture.test'),
    ('REPAIDO_SMTP_USERNAME','support@repaido.com\r\nBcc:attacker@fixture.test'),('REPAIDO_PUBLIC_WEB_URL','http://repaido.web.app'),
    ('REPAIDO_PUBLIC_WEB_URL','https://[invalid'),('REPAIDO_SMTP_HOST','smtp.fixture.test\ninvalid')])
def test_invalid_configuration_is_blocked_without_smtp(core,smtp,monkeypatch,name,value):
    monkeypatch.setenv(name,value);enqueue(core);state=mail.dispatch(core)
    assert not state['ready'] and state['attempted']==0 and not smtp['calls']
    assert row(core)['status']=='blocked' and row(core)['attempts']==0


def test_missing_config_and_unverified_placeholder_contacts_never_send(core,smtp,monkeypatch):
    monkeypatch.delenv('REPAIDO_SMTP_PASSWORD');enqueue(core);mail.dispatch(core)
    assert row(core)['status']=='blocked' and row(core)['reason']=='smtp_configuration_missing'
    assert not smtp['calls']
    monkeypatch.setenv('REPAIDO_SMTP_PASSWORD','fixture-private-password')
    core.operations_store.run(lambda u:u.put('account_contacts','other',dict(id='other',email='other@repaido.user',email_verified=True,version=1)))
    enqueue(core,'event-other',recipients=['other']);mail.dispatch(core)
    other=core.operations_store.run(lambda u:u.get('transactional_mail_delivery',mail._digest('event-other:booking_confirmed:other')))
    assert other['status']=='blocked' and not smtp['messages']


@pytest.mark.parametrize('payload',[{'password':'private-password'},{'token':'private-token'},{'otp':'123456'},
    {'proof':'private-bank-proof'},{'path':'https://attacker.test/'},{'path':'//attacker.test/'},
    {'path':'/?token=private-token'},{'path':'/?%74oken=private-token'},{'path':'/\r\nBcc:attacker@fixture.test'},
    {'record_id':'record\r\nBcc:attacker@fixture.test'}])
def test_credentials_proof_external_destinations_and_header_injection_are_rejected(core,smtp,payload):
    with pytest.raises(HTTPException) as error:enqueue(core,payload=payload)
    assert error.value.status_code==422 and not smtp['calls']
    with core.db() as conn:assert conn.execute("SELECT COUNT(*) FROM operation_records WHERE kind='transactional_mail_delivery'").fetchone()[0]==0


def test_explicit_transient_rejection_backoff_and_attempt_exhaustion(core,smtp):
    enqueue(core);smtp['error']='temporary'
    for attempt in range(mail.MAX_ATTEMPTS):
        if attempt:due(core)
        state=mail.dispatch(core);saved=row(core)
        assert saved['attempts']==attempt+1
        if attempt<mail.MAX_ATTEMPTS-1:
            assert state['retry']==1 and saved['next_attempt_at']>time.time()
            assert mail.dispatch(core)['attempted']==0
    assert row(core)['status']=='failed' and row(core)['reason']=='retry_exhausted'
    assert not smtp['messages']


def test_unknown_data_outcome_and_expired_sending_lease_are_not_blindly_retried(core,smtp):
    enqueue(core);smtp['error']='unknown';mail.dispatch(core)
    assert row(core)['status']=='needs_review' and row(core)['reason']=='smtp_acceptance_unknown'
    assert mail.dispatch(core)['attempted']==0
    enqueue(core,'interrupted-event');key=mail._digest('interrupted-event:booking_confirmed:customer')
    claimed=core.operations_store.run(lambda u:mail._claim(u,key,time.time()))
    core.operations_store.run(lambda u:mail._before_data(u,key,claimed['lease_token'],time.time()))
    due(core,key);smtp['error']=None
    mail.dispatch(core)
    assert row(core,key)['status']=='needs_review' and not smtp['messages']


def test_connection_failure_retries_but_permanent_recipient_rejection_does_not(core,smtp):
    enqueue(core);smtp['error']='connect';mail.dispatch(core)
    assert row(core)['status']=='retry' and row(core)['reason']=='smtp_connection_unavailable'
    due(core);smtp['error']='permanent';mail.dispatch(core)
    assert row(core)['status']=='failed' and row(core)['reason']=='smtp_recipient_rejected'


def test_contact_change_during_authentication_is_rechecked_before_data(core,smtp):
    enqueue(core)
    def change():core.operations_store.run(lambda u:u.put('account_contacts','customer',dict(id='customer',email='new@fixture.test',email_verified=True,version=2)))
    smtp['on_login']=change;mail.dispatch(core)
    assert row(core)['status']=='skipped' and not smtp['messages']
    assert 'data' not in [call[0] for call in smtp['calls']]


def test_account_change_before_claim_and_expired_events_retire_without_send(core,smtp):
    queued=enqueue(core);key=queued['deliveries'][0]['id']
    core.operations_store.run(lambda u:u.put('account_contacts','customer',dict(id='customer',email='new@fixture.test',email_verified=True,version=2)))
    mail.dispatch(core);assert row(core,key)['reason']=='account_contact_changed'
    enqueue(core,'expired-event');other=mail._digest('expired-event:booking_confirmed:customer')
    def expire(u):current=u.get('transactional_mail_delivery',other);current['expires_at']=0;mail._save(u,current)
    core.operations_store.run(expire);mail.dispatch(core)
    assert row(core,other)['reason']=='event_expired' and not smtp['messages']


def test_per_recipient_status_and_terminal_rows_cannot_starve_due_email(core,smtp):
    core.operations_store.run(lambda u:u.put('account_contacts','other',dict(id='other',email='other@fixture.test',email_verified=False,version=1)))
    result=enqueue(core,recipients=['customer','other','customer']);assert len(result['deliveries'])==2
    mail.dispatch(core);assert len(smtp['messages'])==1
    for index in range(100):
        def tombstone(u,index=index):
            key=f'terminal-{index}';u.put('transactional_mail_queue',key,dict(id=key,sortKey=f'0000000000000:{key}'))
        core.operations_store.run(tombstone)
    enqueue(core,'fresh-event');assert mail.dispatch(core,limit=1)['accepted']==1


def test_verification_link_is_derived_transiently_and_bound_to_current_challenge(core,smtp):
    challenge_id='challenge-for-verified-owner-0001'
    def seed(u):
        contact=u.get('account_contacts','customer');contact.update(email_verified=False,current_challenge_id=challenge_id);u.put('account_contacts','customer',contact)
        challenge=dict(id=challenge_id,user_id='customer',email=contact['email'],email_version=contact['version'],expires_at=time.time()+1800,status='pending')
        challenge['token_hash']=hashlib.sha256(account_profile._token(challenge).encode()).hexdigest();u.put('account_email_challenges',challenge_id,challenge)
    core.operations_store.run(seed)
    enqueue(core,'verification-event',kind='email_verification',payload=dict(challenge_id=challenge_id))
    saved=row(core);assert saved['payload']==dict(challenge_id=challenge_id) and 'email-verification=' not in json.dumps(saved)
    assert mail.dispatch(core)['accepted']==1
    text=smtp['messages'][0][0].get_body(('plain',)).get_content()
    assert '#email-verification=' in text and 'SMS' not in text
    link=text.split('Verify email address: ',1)[1].split('\n',1)[0]
    fragment=link.split('#email-verification=',1)[1];data=json.loads(base64.urlsafe_b64decode(fragment+'='*(-len(fragment)%4)))
    assert set(data)=={'challenge_id','token'} and data['challenge_id']==challenge_id
    assert data['token'] not in json.dumps(row(core))
    enqueue(core,'verification-obsolete',kind='email_verification',payload=dict(challenge_id=challenge_id))
    def revoke(u):challenge=u.get('account_email_challenges',challenge_id);challenge['status']='revoked';u.put('account_email_challenges',challenge_id,challenge)
    core.operations_store.run(revoke);mail.dispatch(core)
    key=mail._digest('verification-obsolete:email_verification:customer')
    assert row(core,key)['status']=='skipped' and len(smtp['messages'])==1


def test_no_recipient_password_or_provider_response_is_logged(core,smtp,capsys,caplog):
    enqueue(core);smtp['error']='auth';mail.dispatch(core)
    output=capsys.readouterr();logs=output.out+output.err+caplog.text+json.dumps(row(core))
    assert 'fixture-private-password' not in logs and 'customer@fixture.test' not in logs
    assert row(core)['status']=='blocked' and row(core)['reason']=='smtp_authentication_unavailable'


def test_registration_and_contractor_links_do_not_expose_event_hashes(core,smtp):
    enqueue(core,'account-session-sensitive-hash',kind='login',payload={})
    enqueue(core,'contract-change',kind='contract_update',payload=dict(record_type='contract',record_id='project-one',path='/worker?mode=contractor'))
    assert mail.dispatch(core)['accepted']==2
    texts=[message.get_body(('plain',)).get_content() for message,_,_ in smtp['messages']]
    assert all('account-session-sensitive-hash' not in text for text in texts)
    assert any('/worker?mode=contractor' in text for text in texts)


def test_optional_participant_is_ignored_without_losing_customer_notice(core,smtp):
    queued=enqueue(core,recipients=['customer',None])
    assert len(queued['deliveries'])==1 and mail.dispatch(core)['accepted']==1
    assert enqueue(core,'no-participants',recipients=[None])==dict(deliveries=[])


def test_material_fanout_is_two_atomic_source_writes_and_expands_bounded_batches(core,smtp,monkeypatch):
    participants=['customer']+[f'supplier-{index:03d}' for index in range(100)]
    def contacts(u):
        for uid in participants[1:]:u.put('account_contacts',uid,dict(id=uid,email=uid+'@fixture.test',email_verified=True,version=1))
    core.operations_store.run(contacts)
    payload=dict(record_type='order',record_id='retail-one',path='/?view=booking&booking=booking-one')
    def source(u):
        queued=mail.enqueue_fanout(u,'retail-paid','payment_confirmed',participants,payload)
        assert len(u.pending)==2
        u.put('fixture_source','retail-one',dict(id='retail-one',status='paid'))
        return queued
    queued=core.operations_store.run(source)
    replay=core.operations_store.run(lambda u:mail.enqueue_fanout(u,'retail-paid','payment_confirmed',list(reversed(participants)),payload))
    assert replay==queued and queued['recipient_count']==101
    def rejected(u):
        mail.enqueue_fanout(u,'source-rolled-back','payment_confirmed',participants,payload)
        raise RuntimeError('source command rejected')
    with pytest.raises(RuntimeError):core.operations_store.run(rejected)
    assert core.operations_store.run(lambda u:u.get('transactional_mail_fanout',mail._digest('source-rolled-back:payment_confirmed:fanout'))) is None
    monkeypatch.setenv('REPAIDO_TRANSACTIONAL_EMAIL_ENABLED','false')
    writes=[]
    def expand(u):
        count=mail._expand_fanout(u,queued['fanout_id'],time.time());writes.append(len(u.pending));return count
    assert [core.operations_store.run(expand) for _ in range(6)]==[20,20,20,20,20,1]
    assert max(writes)==42
    fanout=core.operations_store.run(lambda u:u.get('transactional_mail_fanout',queued['fanout_id']))
    assert fanout['status']=='complete' and fanout['expanded_count']==101
    with core.db() as conn:
        deliveries=[json.loads(item['body']) for item in conn.execute("SELECT body FROM operation_records WHERE kind='transactional_mail_delivery'")]
    assert len(deliveries)==101 and {item['recipient_id'] for item in deliveries}==set(participants)
    assert all(item['created_at']==fanout['created_at'] and item['expires_at']==fanout['expires_at'] for item in deliveries)
    assert all(item['status']=='blocked' for item in deliveries) and smtp['messages']==[]
    assert '@fixture.test' not in json.dumps(fanout)
    with pytest.raises(HTTPException) as error:
        core.operations_store.run(lambda u:mail.enqueue_fanout(u,'retail-paid','payment_confirmed',participants[:-1],payload))
    assert error.value.status_code==409


def test_concurrent_fanout_expansion_preserves_contact_binding_and_one_delivery_per_uid(core,smtp):
    participants=['customer']+[f'supplier-{index:03d}' for index in range(80)]
    def seed(u):
        for uid in participants[1:]:u.put('account_contacts',uid,dict(id=uid,email=uid+'@fixture.test',email_verified=True,version=1))
        return mail.enqueue_fanout(u,'retail-received','order_received',participants,dict(record_type='order',record_id='retail-one'))
    queued=core.operations_store.run(seed)
    core.operations_store.run(lambda u:u.put('account_contacts','supplier-079',dict(id='supplier-079',email='new-address@fixture.test',email_verified=True,version=2)))
    with ThreadPoolExecutor(max_workers=4) as pool:
        counts=list(pool.map(lambda _:core.operations_store.run(lambda u:mail._expand_fanout(u,queued['fanout_id'],time.time())),range(6)))
    assert sum(counts)==81 and max(counts)<=mail.FANOUT_BATCH
    changed_key=mail._digest('retail-received:order_received:supplier-079')
    assert row(core,changed_key)['status']=='skipped' and row(core,changed_key)['reason']=='account_contact_changed'
    for _ in range(4):mail.dispatch(core,limit=40)
    assert len(smtp['messages'])==80
    assert len({str(message['Message-ID']) for message,_,_ in smtp['messages']})==80
    assert all(recipients!=['new-address@fixture.test'] for _,_,recipients in smtp['messages'])
    assert mail.dispatch(core)['attempted']==0


def test_dispatch_fanout_uses_due_index_and_does_not_refresh_expired_events(core,smtp,monkeypatch):
    def seed(u):
        for index in range(100):
            key=f'terminal-{index}';u.put('transactional_mail_fanout_queue',key,dict(id=key,sortKey=f'0000000000000:{key}'))
        return mail.enqueue_fanout(u,'expired-fanout','payment_confirmed',['customer'],{})
    queued=core.operations_store.run(seed)
    def expire(u):
        saved=u.get('transactional_mail_fanout',queued['fanout_id']);saved['expires_at']=time.time()-1;mail._save_fanout(u,saved)
    core.operations_store.run(expire)
    result=mail.dispatch(core)
    assert result['fanout_expanded']==0 and result['attempted']==0 and smtp['messages']==[]
    saved=core.operations_store.run(lambda u:u.get('transactional_mail_fanout',queued['fanout_id']))
    assert saved['status']=='skipped' and saved['reason']=='event_expired'
    fresh=core.operations_store.run(lambda u:mail.enqueue_fanout(u,'fresh-fanout','booking_confirmed',['customer'],{}))
    assert mail.dispatch(core)['accepted']==1
    assert core.operations_store.run(lambda u:u.get('transactional_mail_fanout',fresh['fanout_id']))['status']=='complete'


def test_fanout_rejects_excessive_or_challenge_participants_before_writes(core):
    for kind,ids,payload in [('booking_confirmed',['user']*1001,{}),('email_verification',['customer'],dict(challenge_id='challenge'))]:
        def invalid(u):return mail.enqueue_fanout(u,'invalid-fanout',kind,ids,payload)
        with pytest.raises(HTTPException):core.operations_store.run(invalid)
    with core.db() as conn:assert conn.execute("SELECT COUNT(*) FROM operation_records WHERE kind='transactional_mail_fanout'").fetchone()[0]==0


def test_both_due_queues_use_native_range_indexes_before_limit(core):
    def inspect(u):
        queries=[];u.conn.set_trace_callback(queries.append)
        for kind in ('transactional_mail_queue','transactional_mail_fanout_queue'):
            mail._due_refs(u,kind,time.time(),1)
        u.conn.set_trace_callback(None)
        plans=[u.conn.execute('EXPLAIN QUERY PLAN '+query).fetchall() for query in queries if query.startswith('SELECT body')]
        assert len(plans)==2
        for plan in plans:
            detail=' '.join(item[3] for item in plan)
            assert 'USING INDEX operation_mail_' in detail and '<expr>>? AND <expr><?' in detail
            assert 'TEMP B-TREE' not in detail
    core.operations_store.run(inspect)


def test_setup_plan_is_offline_and_apply_passes_secret_references_without_values(tmp_path,monkeypatch):
    script=Path(__file__).resolve().parents[1]/'scripts'/'configure-transactional-email.sh'
    log=tmp_path/'gcloud-commands.log';fake=tmp_path/'gcloud'
    fake.write_text('''#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$REPAIDO_MAIL_TEST_COMMAND_LOG"
if [[ "$1 $2 $3" == "secrets versions list" ]]; then printf 'projects/repaido/secrets/fixture/versions/1\\n'; fi
if [[ "$1 $2 $3" == "run services describe" ]]; then printf 'runtime@repaido.iam.gserviceaccount.com\\n'; fi
''')
    fake.chmod(0o700)
    import os
    monkeypatch.setenv('PATH',str(tmp_path)+os.pathsep+os.environ['PATH']);monkeypatch.setenv('REPAIDO_MAIL_TEST_COMMAND_LOG',str(log))
    args=['bash',str(script),'--host','smtp.fixture.test','--port','587']
    plan=subprocess.run(args,capture_output=True,text=True,check=True)
    assert 'Offline plan only' in plan.stdout and not log.exists()
    secret=tmp_path/'private-password';secret.write_text('fixture-password-must-not-be-logged');secret.chmod(0o600)
    applied=subprocess.run([*args,'--apply','--password-file',str(secret)],capture_output=True,text=True,check=True)
    commands=log.read_text()
    assert '--data-file='+str(secret) in commands
    assert 'REPAIDO_SMTP_PASSWORD=repaido-smtp-password:1' in commands
    assert 'REPAIDO_EMAIL_CHALLENGE_SECRET=repaido-email-challenge-secret:1' in commands
    assert 'REPAIDO_TRANSACTIONAL_EMAIL_ENABLED=false' in commands
    assert 'run services update repaido-api' in commands and 'run services update repaido-work-worker' in commands
    assert 'fixture-password-must-not-be-logged' not in commands+applied.stdout+applied.stderr


def test_setup_reuses_numeric_enabled_secret_versions_when_latest_is_disabled(tmp_path,monkeypatch):
    script=Path(__file__).resolve().parents[1]/'scripts'/'configure-transactional-email.sh'
    log=tmp_path/'gcloud-commands.log';fake=tmp_path/'gcloud'
    fake.write_text('''#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$REPAIDO_MAIL_TEST_COMMAND_LOG"
if [[ "$1 $2 $3" == "secrets versions list" ]]; then
  # The newest version 9 is disabled. The filtered metadata result is version 2.
  [[ "$*" == *"--filter=state=ENABLED"* && "$*" == *"--sort-by=~createTime"* ]] || exit 9
  printf 'projects/repaido/secrets/fixture/versions/2\\n'
fi
if [[ "$1 $2 $3" == "run services describe" ]]; then printf 'runtime@repaido.iam.gserviceaccount.com\\n'; fi
''')
    fake.chmod(0o700)
    import os
    monkeypatch.setenv('PATH',str(tmp_path)+os.pathsep+os.environ['PATH']);monkeypatch.setenv('REPAIDO_MAIL_TEST_COMMAND_LOG',str(log))
    subprocess.run(['bash',str(script),'--host','smtp.fixture.test','--apply'],capture_output=True,text=True,check=True)
    commands=log.read_text()
    assert 'REPAIDO_SMTP_PASSWORD=repaido-smtp-password:2' in commands
    assert 'REPAIDO_EMAIL_CHALLENGE_SECRET=repaido-email-challenge-secret:2' in commands
    assert ':latest' not in commands and 'secrets versions access' not in commands and 'secrets versions add' not in commands
