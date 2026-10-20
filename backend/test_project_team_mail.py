"""Team-confirmation mail rechecks the actual formation before SMTP DATA."""
import time
import uuid

import pytest

import contract_work
import transactional_mail as mail
from test_transactional_mail import core, smtp, row


def prepare(core, kind):
    stamp = time.time()
    member = dict(id='real-invitation', worker_id='customer', status='accepted', role='member',
                  joining_status='confirmed', joining_confirmed_at=stamp)
    project = dict(id='crew-project', owner_id='owner', status='planning', team=[member],
                   hiring=dict(openings=1), attendance=[], events=[])
    project['team_confirmation'] = dict(id=str(uuid.uuid4()), confirmed_at=stamp,
        confirmed_by='owner', roster_fingerprint=contract_work.roster_fingerprint(project))
    event = project['team_confirmation']['id']
    if kind == 'contract_team_confirmed_pending_award':
        project['tender_id'] = 'pending-tender'
    notice = None
    if kind == 'contract_joining_confirmed':
        event = 'joining-notice'
        notice = dict(id=event, user_id='customer', kind='project_team', event='joining_confirmed',
            project_id=project['id'], invitation_id=member['id'], joining_confirmed_at=stamp)
    def write(u):
        u.put('contract_projects', project['id'], project)
        if notice:
            u.put('notifications', event, notice)
        mail.enqueue(u, event, kind, ['customer'],
            dict(record_type='contract', record_id=project['id'],
                 path='/worker?mode=technician&tab=projects&project=' + project['id']))
    core.operations_store.run(write)
    return project


@pytest.mark.parametrize('kind', ['contract_joining_confirmed', 'contract_team_confirmed_pending_award', 'contract_team_confirmed'])
def test_new_team_mail_templates_describe_actual_saved_stage(core, smtp, kind):
    prepare(core, kind)
    assert mail.dispatch(core)['accepted'] == 1
    sent = smtp['messages'][0][0]
    assert 'confirmed' in sent['Subject'].lower()
    text = sent.get_body(('plain',)).get_content()
    assert '/worker?mode=technician&tab=projects&project=crew-project' in text and 'PRIVATE' not in text
    if kind == 'contract_team_confirmed_pending_award':
        assert 'tender decision is still pending' in text
        assert 'awarded' not in sent['Subject'].lower()
    assert mail.dispatch(core)['attempted'] == 0


@pytest.mark.parametrize('kind', ['contract_joining_confirmed', 'contract_team_confirmed_pending_award', 'contract_team_confirmed'])
def test_member_removal_before_claim_skips_stale_congratulation(core, smtp, kind):
    project = prepare(core, kind)
    project['team'][0]['status'] = 'removed'
    core.operations_store.run(lambda u: u.put('contract_projects', project['id'], project))
    assert mail.dispatch(core)['attempted'] == 0
    assert row(core)['status'] == 'skipped' and row(core)['reason'] == 'project_team_event_obsolete'
    assert smtp['messages'] == []


def test_roster_change_after_smtp_login_prevents_team_message_data(core, smtp):
    project = prepare(core, 'contract_team_confirmed')
    def change():
        project['team'][0]['role'] = 'supervisor'
        core.operations_store.run(lambda u: u.put('contract_projects', project['id'], project))
    smtp['on_login'] = change
    mail.dispatch(core)
    assert smtp['messages'] == [] and row(core)['status'] == 'skipped'


def test_new_invitation_cannot_inherit_an_old_joining_mail(core, smtp):
    project = prepare(core, 'contract_joining_confirmed')
    project['team'][0]['id'] = 'a-different-invitation'
    project['team'][0]['joining_confirmed_at'] += 10
    core.operations_store.run(lambda u: u.put('contract_projects', project['id'], project))
    assert mail.dispatch(core)['attempted'] == 0
    assert row(core)['status'] == 'skipped' and smtp['messages'] == []
