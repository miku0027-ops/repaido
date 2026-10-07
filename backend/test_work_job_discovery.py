"""Actual worker discoveries and both bell projections; no cloud or push sends."""
import json
import time
from concurrent.futures import ThreadPoolExecutor

import pytest

import main
import operations
import repaidians as social
import repaidians_work as work
from contract_work import identifier
from test_operations import api, auth
from test_repaidians_work import approve_follower, profile, seed_job, work_api


def ready(client, uid='worker2', contractor=False):
    approve_follower(uid)
    if contractor:
        def review(u):
            worker = u.get('workers', uid)
            worker['contractor_verified'] = True
            u.put('workers', uid, worker)
        main.operations_store.run(review)
    profile(uid)
    result = client.patch('/repaidians/work/preferences', headers=auth(uid), json={'jobDiscovery': True})
    assert result.status_code == 200, result.text


def notes(uid='worker2'):
    return main.operations_store.run(lambda u: social.query(u, social.lane('rp_notifications', uid), 50))


def change_worker(**changes):
    def save(u):
        worker = u.get('workers', 'worker2')
        worker.update(changes)
        u.put('workers', 'worker2', worker)
    main.operations_store.run(save)


def test_discoveries_are_default_off_worker_only_and_reads_do_not_notify(work_api, monkeypatch):
    approve_follower('worker2'); profile('worker2'); seed_job()
    assert work_api.get('/repaidians/work/preferences', headers=auth('worker2')).json()['preferences']['jobDiscovery'] is False
    for _ in range(2):
        assert work_api.get('/repaidians/work/jobs', headers=auth('worker2')).status_code == 200
        assert work_api.get('/repaidians/work/jobs/job1', headers=auth('worker2')).status_code == 200
        assert work_api.get('/repaidians/notifications', headers=auth('worker2')).json()['notifications'] == []
    assert work.process_updates(main)['jobNotifications'] == 0
    assert notes() == []
    ready(work_api)
    monkeypatch.setattr(operations.Unit, 'all', lambda *a: (_ for _ in ()).throw(AssertionError('Unbounded discovery scan')))
    assert work.process_updates(main)['jobNotifications'] == 1
    notice = notes()[0]
    assert notice['type'] == 'job_discovery'
    assert notice['jobId'] == notice['projectId'] == notice['targetId'] == 'job1'
    assert notice['authorId'] == 'worker'
    native = main.operations_store.run(lambda u: u.get('notifications', notice['id']))
    assert native['id'] == notice['id'] and native['user_id'] == 'worker2'
    assert native['community_job_id'] == native['project_id'] == 'job1' and 'job_id' not in native
    assert native['kind'] == 'job_discovery' and native['destination'] == 'repaidians'
    assert 'PRIVATE' not in json.dumps(notice) + json.dumps(native)
    page = work_api.get('/repaidians/notifications', headers=auth('worker2')).json()
    assert [n['id'] for n in page['notifications']] == [notice['id']]
    assert work_api.get('/repaidians/state', headers=auth('worker2')).json()['unreadCount'] == 1
    assert work_api.post('/repaidians/notifications/read', headers=auth('worker2'), json={'ids': [notice['id']]}).status_code == 200
    assert work.process_updates(main)['jobNotifications'] == 0
    assert len(notes()) == 1


@pytest.mark.parametrize('contractor', [False, True])
def test_actual_approved_agent_or_contractor_receives_matching_discovery(work_api, contractor):
    ready(work_api, contractor=contractor); seed_job()
    assert main.operations_store.run(lambda u: work.deliver_job_discoveries(u, 'worker2')) == 1
    assert work_api.get('/repaidians/work/jobs/job1', headers=auth('worker2')).json()['id'] == 'job1'


@pytest.mark.parametrize('case', ['pending', 'wrong_role', 'suspended', 'wrong_trade', 'wrong_city', 'experience', 'not_looking', 'blocked', 'expired_trial', 'already_applied'])
def test_ineligible_saved_recipient_never_receives_discovery(work_api, case):
    ready(work_api); seed_job()
    if case == 'pending': change_worker(status='pending')
    elif case == 'wrong_role': change_worker(role='customer')
    elif case == 'suspended': main.operations_store.run(lambda u: u.put('network_suspensions', 'worker2', {'active': True}))
    elif case == 'wrong_trade': change_worker(categories=['plumber'])
    elif case == 'wrong_city': change_worker(city='Another city')
    elif case == 'experience':
        profile('worker2', experienceYears=60); change_worker(experience_years=0)
    elif case == 'not_looking': profile('worker2', workStatus='not_looking')
    elif case == 'blocked': main.operations_store.run(lambda u: u.put('rp_blocks', social.digest('worker2:worker'), {'active': True}))
    elif case == 'expired_trial':
        def expire(u):
            trial = u.get('rp_trials', 'worker2'); trial['endsAt'] = work.now_ms() - 1
            u.put('rp_trials', 'worker2', trial)
        main.operations_store.run(expire)
    elif case == 'already_applied':
        key = identifier('application', 'worker2', 'job1')
        main.operations_store.run(lambda u: u.put('project_applications', key, {'id': key, 'worker_id': 'worker2', 'project_id': 'job1', 'status': 'applied'}))
    assert main.operations_store.run(lambda u: work.deliver_job_discoveries(u, 'worker2')) == 0
    assert notes() == []
    if case == 'experience':
        assert work_api.get('/repaidians/work/jobs/job1', headers=auth('worker2')).status_code == 404


def test_cleared_profile_experience_uses_actual_registration_for_alert_and_detail(work_api):
    ready(work_api); profile('worker2', experienceYears=None); seed_job()
    assert work_api.get('/repaidians/work/jobs', headers=auth('worker2')).status_code == 200
    assert main.operations_store.run(lambda u: work.deliver_job_discoveries(u, 'worker2')) == 1
    assert work_api.get('/repaidians/work/jobs/job1', headers=auth('worker2')).status_code == 200


@pytest.mark.parametrize('case', ['closed', 'filled', 'deadline', 'ended', 'owner_unapproved', 'owner_suspended', 'blocked', 'optout', 'profile_city', 'registered_experience', 'applied'])
def test_actual_queued_alert_is_hidden_after_live_source_or_eligibility_change(work_api, case):
    ready(work_api); project = seed_job()
    assert main.operations_store.run(lambda u: work.deliver_job_discoveries(u, 'worker2')) == 1
    note = notes()[0]
    envelope = main.operations_store.run(lambda u: u.get('rp_work_delivery', note['id']))
    assert main.operations_store.run(lambda u: work.delivery_allowed(u, envelope))
    if case in ('closed', 'filled', 'deadline', 'ended'):
        if case == 'closed': project['hiring']['status'] = 'closed'
        elif case == 'filled': project['team'] = [{'id': 'seat'+str(i), 'worker_id': 'accepted'+str(i), 'status': 'accepted'} for i in range(3)]
        elif case == 'deadline': project['hiring']['deadline'] = time.time() - 1
        else: project['status'] = 'completed'
        main.operations_store.run(lambda u: u.put('contract_projects', 'job1', project))
    elif case == 'owner_unapproved': main.operations_store.run(lambda u: u.put('workers', 'worker', {'id': 'worker', 'status': 'pending', 'contractor_verified': True}))
    elif case == 'owner_suspended': main.operations_store.run(lambda u: u.put('network_suspensions', 'worker', {'active': True}))
    elif case == 'blocked': main.operations_store.run(lambda u: u.put('network_blocks', 'worker:worker2', {'active': True}))
    elif case == 'optout': work_api.patch('/repaidians/work/preferences', headers=auth('worker2'), json={'jobDiscovery': False})
    elif case == 'profile_city': profile('worker2', city='Another city')
    elif case == 'registered_experience': change_worker(experience_years=0)
    else:
        key = identifier('application', 'worker2', 'job1')
        main.operations_store.run(lambda u: u.put('project_applications', key, {'id': key, 'worker_id': 'worker2', 'project_id': 'job1', 'status': 'applied'}))
    native = main.operations_store.run(lambda u: u.get('notifications', note['id']))
    assert not main.operations_store.run(lambda u: work.notification_visible(u, native, 'worker2'))
    assert not main.operations_store.run(lambda u: work.delivery_allowed(u, envelope))
    assert work_api.get('/repaidians/notifications', headers=auth('worker2')).json()['notifications'] == []
    assert work_api.get('/repaidians/state', headers=auth('worker2')).json()['unreadCount'] == 0
    assert main.operations_store.run(lambda u: work.deliver_job_discoveries(u, 'worker2')) == 0


def test_daily_cap_retry_concurrency_and_next_day_never_repeat_same_job(work_api):
    ready(work_api)
    for index in range(5): seed_job('job'+str(index))
    stamp = time.time()
    with ThreadPoolExecutor(max_workers=8) as pool:
        counts = list(pool.map(lambda _: main.operations_store.run(lambda u: work.deliver_job_discoveries(u, 'worker2', stamp)), range(16)))
    assert sum(counts) == 3 and len(notes()) == 3
    assert main.operations_store.run(lambda u: work.deliver_job_discoveries(u, 'worker2', stamp + 86400)) == 2
    assert main.operations_store.run(lambda u: work.deliver_job_discoveries(u, 'worker2', stamp + 172800)) == 0
    rows = notes()
    assert len(rows) == len({note['jobId'] for note in rows}) == 5
    assert len(main.operations_store.run(lambda u: social.query(u, 'rp_work_delivery', 50))) == 5


def test_bounded_keyset_does_not_starve_jobs_after_seen_first_page(work_api, monkeypatch):
    ready(work_api)
    for index in range(35): seed_job('job'+str(index).zfill(3))
    def mark_seen(u):
        for index in range(32):
            key = 'job'+str(index).zfill(3)
            u.put(social.lane('rp_work_job_seen', 'worker2'), key, {'id': key, 'createdAt': work.now_ms()})
    main.operations_store.run(mark_seen)
    monkeypatch.setattr(operations.Unit, 'all', lambda *a: (_ for _ in ()).throw(AssertionError('Unbounded discovery scan')))
    assert work.process_updates(main, 1)['jobNotifications'] == 0
    # The shared recipient keyset wraps after its single full recipient page.
    assert sum(work.process_updates(main, 1)['jobNotifications'] for _ in range(2)) == 3
    assert {note['jobId'] for note in notes()} == {'job032', 'job033', 'job034'}


def test_notification_visibility_is_account_bound_and_other_events_unchanged(work_api):
    ready(work_api); seed_job()
    assert main.operations_store.run(lambda u: work.deliver_job_discoveries(u, 'worker2')) == 1
    key = notes()[0]['id']
    native = main.operations_store.run(lambda u: u.get('notifications', key))
    assert not main.operations_store.run(lambda u: work.notification_visible(u, native, 'stranger'))
    assert main.operations_store.run(lambda u: work.notification_visible(u, {'type': 'application_update'}, 'worker2'))
    assert work_api.get('/repaidians/work/jobs/job1', headers=auth('customer')).status_code == 403
    assert work_api.get('/repaidians/work/jobs/job1').status_code == 401
