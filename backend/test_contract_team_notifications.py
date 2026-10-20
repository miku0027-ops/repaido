"""Formation notices use real current membership; social sharing stays separate."""
import json
import time

import pytest

import main
import operations
import repaidians
import repaidians_work as work
import work_push
from firebase_admin import messaging
from test_operations import api, auth
from test_repaidians_work import (work_api, seed_job, profile, approve_follower,
                                  confirm_team_record)


def get(kind, key):
    return main.operations_store.run(lambda u: u.get(kind, key))


def save(project):
    main.operations_store.run(lambda u: u.put('contract_projects', project['id'], project))
    return project


def crew(*, confirmed=False, **changes):
    project = seed_job(**changes)
    project['team'] = [dict(id='crew-seat', worker_id='worker2', name='PRIVATE CREW NAME',
        status='accepted', role='member', worker_type='electrician', joining_status='awaiting_confirmation',
        daily_rate_paise=123456, terms='PRIVATE CONTACT TERMS')]
    if confirmed:
        confirm_team_record(project)
    return save(project)


def notes(uid='worker2'):
    return main.operations_store.run(lambda u: [note for note in u.find('notifications', 'user_id', uid)
        if note.get('kind') == 'project_team'])


def deliveries(uid='worker2'):
    return main.operations_store.run(lambda u: [row for row in repaidians.query(u, 'rp_work_delivery', 40)
        if row.get('recipient_id') == uid and row.get('event') == 'project_team_confirmed'])


def allowed(row):
    return main.operations_store.run(lambda u: work.delivery_allowed(u, row))


def award(project):
    project.update(tender_id='winning-tender', awarded_at=time.time(), client_id='shop', contract_value_paise=900000)
    tender = dict(id='winning-tender', owner_id='shop', status='awarded', winning_project_id=project['id'],
        winning_bid_id='winning-bid', bids=[dict(id='winning-bid', status='awarded',
        contractor_id=project['owner_id'], project_id=project['id'], amount_paise=900000)])
    main.operations_store.run(lambda u: u.put('contract_tenders', tender['id'], tender))
    save(project)
    return project, tender


def test_acceptance_cannot_publish_a_placement_or_send_a_congratulation(work_api):
    profile('worker2'); approve_follower()
    project = crew()
    work_api.patch('/repaidians/work/preferences', headers=auth('worker2'), json={'sharePlacements': True})
    work_api.put('/repaidians/follow/worker2', headers=auth('customer'), json={'active': True})
    work.process_updates(main)
    placement = repaidians.digest(project['id'] + ':crew-seat')
    assert work_api.get('/repaidians/placements/' + placement, headers=auth('customer')).status_code == 404
    assert notes() == [] and deliveries() == []


def test_confirmation_wakes_bounded_private_fanout_without_public_sharing(work_api):
    profile('worker2')
    project = crew()
    work.process_updates(main)
    old = get('rp_work_project_queue', project['id'])
    assert old['active'] is False
    save(confirm_team_record(project))
    queued = get('rp_work_project_queue', project['id'])
    assert queued['active'] is True and queued['fingerprint'] != old['fingerprint']
    work.process_updates(main); work.process_updates(main)
    assert len(notes()) == len(deliveries()) == 1
    notice, delivery = notes()[0], deliveries()[0]
    assert notice['kind'] == 'project_team' and notice['event'] == 'team_confirmed'
    assert notice['destination'] == 'contractor' and notice['project_id'] == project['id']
    assert notice['read_at'] is None and allowed(delivery)
    assert 'PRIVATE' not in json.dumps(notice) + json.dumps(delivery)
    assert get('rp_work_announcements', repaidians.digest(project['id'] + ':crew-seat')) is None
    assert work_api.get('/repaidians/placements/' + repaidians.digest(project['id'] + ':crew-seat'),
                        headers=auth('customer')).status_code == 404


@pytest.mark.parametrize('mutation', ['remove', 'new_invitation', 'role_change', 'cancel', 'block', 'suspend', 'preference'])
def test_queued_private_push_rechecks_current_team_and_recipient_at_send(work_api, mutation):
    profile('worker2'); project = crew(confirmed=True)
    work.process_updates(main)
    delivery = deliveries()[0]
    notice = notes()[0]
    assert allowed(delivery)
    if mutation == 'remove': project['team'][0]['status'] = 'removed'
    elif mutation == 'new_invitation': project['team'].append(dict(id='new-offer', worker_id='shop', status='pending', role='member'))
    elif mutation == 'role_change': project['team'][0]['role'] = 'supervisor'
    elif mutation == 'cancel': project['status'] = 'cancelled'
    elif mutation == 'block':
        main.operations_store.run(lambda u: u.put('rp_blocks', repaidians.digest('worker2:worker'), dict(active=True)))
    elif mutation == 'suspend':
        main.operations_store.run(lambda u: u.put('network_suspensions', 'worker2', dict(active=True)))
    elif mutation == 'preference':
        def disable(u):
            member = u.get('rp_members', 'worker2'); member.setdefault('settings', {})['applicationNotifications'] = False
            u.put('rp_members', 'worker2', member)
        main.operations_store.run(disable)
    save(project)
    assert not allowed(delivery)
    if mutation != 'preference':
        assert not main.operations_store.run(lambda u: work.notification_visible(u, notice, 'worker2'))


def test_pending_award_is_not_a_winning_placement_and_award_notifies_once(work_api):
    profile('worker2'); project = crew(confirmed=True, tender_id='winning-tender')
    work_api.patch('/repaidians/work/preferences', headers=auth('worker2'), json={'sharePlacements': True})
    work.process_updates(main)
    assert [note['event'] for note in notes()] == ['team_confirmed']
    assert 'tender decision' in notes()[0]['body'].lower()
    placement = repaidians.digest(project['id'] + ':crew-seat')
    assert work_api.get('/repaidians/placements/' + placement, headers=auth('customer')).status_code == 404
    project, tender = award(project)
    work.process_updates(main); work.process_updates(main)
    assert sorted(note['event'] for note in notes()) == ['contract_awarded', 'team_confirmed']
    current = next(row for row in deliveries() if row['project_event'] == 'contract_awarded')
    assert allowed(current)
    assert work_api.get('/repaidians/placements/' + placement, headers=auth('customer')).status_code == 200
    tender['winning_project_id'] = 'another-project'
    main.operations_store.run(lambda u: u.put('contract_tenders', tender['id'], tender))
    assert not allowed(current)
    assert work_api.get('/repaidians/placements/' + placement, headers=auth('customer')).status_code == 404


@pytest.mark.parametrize('changes', [{'sender_id': 'another-contractor'}, {'target_id': 'another-project'},
                                    {'team_confirmation_id': 'superseded-formation'}, {'team_roster_fingerprint': 'old-roster'}])
def test_private_envelope_cannot_borrow_another_source_or_formation(work_api, changes):
    profile('worker2'); crew(confirmed=True)
    work.process_updates(main)
    delivery = deliveries()[0]
    assert allowed(delivery)
    assert not allowed({**delivery, **changes})


def test_social_notification_and_delivery_disappear_after_team_invalidation(work_api):
    profile('worker2'); approve_follower(); project = crew(confirmed=True)
    work_api.patch('/repaidians/work/preferences', headers=auth('worker2'), json={'sharePlacements': True})
    work_api.put('/repaidians/follow/worker2', headers=auth('customer'), json={'active': True})
    work.process_updates(main)
    public_notice = next(row for row in work_api.get('/repaidians/notifications', headers=auth('customer')).json()['notifications']
                         if row['type'] == 'placement')
    public_delivery = main.operations_store.run(lambda u: next(row for row in repaidians.query(u, 'rp_work_delivery', 40)
        if row.get('event') == 'placement' and row.get('recipient_id') == 'customer'))
    assert allowed(public_delivery)
    project['team'][0]['role'] = 'supervisor'; save(project)
    assert not allowed(public_delivery)
    assert not main.operations_store.run(lambda u: work.notification_visible(u, public_notice, 'customer'))
    assert public_notice['id'] not in [row['id'] for row in work_api.get('/repaidians/notifications', headers=auth('customer')).json()['notifications']]


def test_legacy_ongoing_placement_keeps_its_history_without_new_celebration(work_api):
    profile('worker2'); project = crew()
    project['status'] = 'active'; project['hiring'].update(openings=1, status='closed')
    project['team'][0].pop('joining_status')
    project['attendance'] = [dict(id='actual-check-in', worker_id='worker2', in_at=time.time() - 60)]
    save(project)
    work_api.patch('/repaidians/work/preferences', headers=auth('worker2'), json={'sharePlacements': True})
    work.process_updates(main)
    placement = repaidians.digest(project['id'] + ':crew-seat')
    assert work_api.get('/repaidians/placements/' + placement, headers=auth('customer')).status_code == 200
    assert notes() == [] and deliveries() == []


def test_actual_typed_enqueue_and_relay_keep_private_data_out_of_fcm(work_api, monkeypatch):
    monkeypatch.setenv('REPAIDO_PUSH_ENABLED', 'true')
    monkeypatch.setattr(work_push, '_messaging_app', lambda: None)
    profile('worker2'); crew(confirmed=True)
    def device(u):
        row = dict(id='crew-device', user_id='worker2', token='test-fcm-device', active=True,
                   updated_at=time.time(), platform='android', audience='agent')
        u.put('devices', row['id'], row); work_push.index_record(u, 'devices', row['id'], row)
    main.operations_store.run(device)
    work.process_updates(main)
    sent = []
    monkeypatch.setattr(messaging, 'send', lambda message, **kwargs: sent.append(message))
    assert work_push.process_deliveries(main)['sent'] == 1
    assert sent[0].data['destination'] == 'contractor'
    assert sent[0].data['project_id'] == 'job1'
    assert sent[0].data['project_role'] == 'technician'
    assert 'PRIVATE' not in json.dumps(sent[0].data) + sent[0].notification.title + sent[0].notification.body
    assert work_push.process_deliveries(main)['attempted'] == 0


def test_large_confirmed_crew_fans_out_in_bounded_resumable_batches(work_api, monkeypatch):
    project = seed_job()
    project['team'] = [dict(id='seat-' + str(index), worker_id='worker-' + str(index), role='member',
        status='accepted', joining_status='awaiting_confirmation') for index in range(500)]
    save(confirm_team_record(project))
    written = set()
    original = operations.Unit.put
    def track(u, kind, key, value):
        written.add((kind, key))
        return original(u, kind, key, value)
    monkeypatch.setattr(operations.Unit, 'put', track)
    queue = get('rp_work_project_queue', project['id'])
    main.operations_store.run(lambda u: work._project_placements(u, queue))
    first = get('rp_work_project_queue', project['id'])
    assert first['active'] is True and first['offset'] == 20
    assert len([pair for pair in written if pair[0] == 'notifications']) == 20
    assert len([pair for pair in written if pair[0] == 'rp_work_delivery']) == 20
    assert len(written) < 250
    assert len(notes('worker-0')) == 1 and notes('worker-20') == []
    # A retried old page is idempotent, including its push envelope.
    main.operations_store.run(lambda u: work._project_placements(u, queue))
    assert len(notes('worker-0')) == 1 and len(deliveries('worker-0')) == 1
    main.operations_store.run(lambda u: work._project_placements(u, first))
    assert get('rp_work_project_queue', project['id'])['offset'] == 40
    assert len(notes('worker-20')) == 1
