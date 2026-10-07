"""Work discovery correctness, consent revocation and concurrent durable quotas."""
import json
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest

import main
import operations
import repaidians
import repaidians_work as work
from test_operations import api, auth, onboard


@pytest.fixture
def work_api(api, monkeypatch):
    if not any(getattr(route, 'path', '') == '/repaidians/work/jobs' for route in main.app.routes):
        work.install(main)
    if 'repaidians_work' not in operations.Unit.put.__code__.co_names:
        original = operations.Unit.put
        def put(u, kind, key, row):
            original(u, kind, key, row)
            if kind in ('contract_projects', 'contract_tenders', 'contract_profiles', 'rp_members', 'workers', 'rp_follows'):
                work.index_record(u, kind, key, row)
        monkeypatch.setattr(operations.Unit, 'put', put)
    work.initialize(main)
    # Authentication and trial grants use actual community state commands.
    for uid in ('customer', 'worker', 'worker2', 'stranger', 'shop'):
        assert api.get('/repaidians/state', headers=auth(uid)).status_code == 200
    return api


def seed_job(key='job1', trade='Electrical', city='Balasore', owner='worker', **changes):
    now = time.time()
    hiring = dict(status='open', sector=trade, city=city, area='Published neighbourhood', skills=['Electrical installation'],
                  minimum_experience=2, worker_role='any', summary='Published work and safety requirements.',
                  daily_rate_paise=80000, openings=3, deadline=now + 4 * 86400, terms='Published fair work terms.', version=1)
    hiring.update(changes.pop('hiring', {}))
    row = dict(id=key, owner_id=owner, owner_name='Registered contractor', title='Electrical installation project',
               source_kind='commercial_project', status='planning', starts_at=now + 5 * 86400, ends_at=now + 30 * 86400,
               team=[], goals=[], hiring=hiring, created_at=now, site='PRIVATE EXACT SITE', scope='PRIVATE CONTRACT SCOPE',
               budget_paise=999999999, version=1)
    row.update(changes)
    def save(u):
        u.put('workers', owner, {'id': owner, 'name': 'Registered contractor', 'status': 'approved', 'role': 'technician', 'contractor_verified': True, 'categories': ['electrician']})
        u.put('contract_projects', key, row)
    main.operations_store.run(save)
    return row


def profile(uid='customer', **changes):
    def save(u):
        member = u.get('rp_members', uid)
        member.update(trade='electrician', skills=['Electrical installation'], city='Balasore', experienceYears=4, workStatus='open_to_work')
        member.update(changes)
        u.put('rp_members', uid, member)
    main.operations_store.run(save)


def get_jobs(api, uid='customer', **filters):
    response = api.get('/repaidians/work/jobs', headers=auth(uid), params=filters)
    assert response.status_code == 200, response.text
    return response.json()


def test_native_jobs_strict_relevance_privacy_and_filters(work_api, monkeypatch):
    profile(); seed_job(); seed_job('job2', trade='Plumbing', hiring={'skills': ['Pipe repairs']})
    monkeypatch.setattr(operations.Unit, 'all', lambda *args: (_ for _ in ()).throw(AssertionError('Hot collection scan')))
    page = get_jobs(work_api)
    assert [card['id'] for card in page['items']] == ['job1']
    assert page['items'][0]['match']['reasons'] == ['Matches your profile trade', 'Matches your listed skills', 'In your profile city', 'Experience requirement met']
    assert 'PRIVATE' not in json.dumps(page) and 'budget_paise' not in json.dumps(page)
    assert get_jobs(work_api, city='Another city')['items'] == []
    assert get_jobs(work_api, minimumPayPaise=90000)['items'] == []
    assert get_jobs(work_api, experience=1)['items'] == []
    assert get_jobs(work_api, trade='plumber')['items'][0]['id'] == 'job2'
    assert get_jobs(work_api, query='installation')['items'][0]['id'] == 'job1'
    assert get_jobs(work_api, closesWithinDays=7)['items'][0]['id'] == 'job1'
    assert 'no-store' in work_api.get('/repaidians/work/jobs', headers=auth('customer')).headers['cache-control']


def test_empty_and_closed_sources_are_never_filled_with_random_jobs(work_api):
    profile(); seed_job('wrong', trade='Plumbing', hiring={'skills': ['Pipe repairs']})
    assert get_jobs(work_api)['items'] == []
    p = seed_job('right')
    assert get_jobs(work_api)['items']
    p['hiring']['status'] = 'closed'
    main.operations_store.run(lambda u: u.put('contract_projects', p['id'], p))
    assert get_jobs(work_api)['items'] == []


def test_private_customer_job_uses_server_verified_authorization(work_api):
    profile()
    p = seed_job('privatejob', owner='shop', source_kind='private_request', owner_phone_verified=True)
    main.operations_store.run(lambda u: u.put('workers', 'shop', {'id': 'shop', 'status': 'pending'}))
    assert get_jobs(work_api, workType='private_request')['items'][0]['id'] == 'privatejob'
    assert get_jobs(work_api, workType='project')['items'] == []
    p['owner_phone_verified'] = False
    main.operations_store.run(lambda u: u.put('contract_projects', p['id'], p))
    assert get_jobs(work_api)['items'] == []


def test_cursor_is_account_and_filter_bound_and_stale_entries_advance(work_api):
    profile(); profile('stranger')
    for index in range(70):
        p = seed_job(f'j{index:03d}')
        if index < 64:
            p['hiring']['status'] = 'closed'
            # Simulate a missed historical projection write; stale references
            # must advance safely rather than trusting indexed availability.
            with main.db() as conn:
                conn.execute('UPDATE operation_records SET body=? WHERE kind=? AND id=?', (json.dumps(p), 'contract_projects', p['id']))
    page = get_jobs(work_api, limit=2)
    assert page['items'] == [] and page['nextCursor']
    second = get_jobs(work_api, cursor=page['nextCursor'], limit=2)
    assert len(second['items']) == 2
    assert work_api.get('/repaidians/work/jobs', headers=auth('stranger'), params={'cursor': page['nextCursor']}).status_code == 422
    assert work_api.get('/repaidians/work/jobs', headers=auth('customer'), params={'cursor': page['nextCursor'], 'city': 'Other'}).status_code == 422


def test_behavior_consent_retry_bounds_decay_and_account_isolation(work_api, monkeypatch):
    profile()
    event = {'eventId': str(uuid.uuid4()), 'trade': 'plumber', 'type': 'search', 'query': 'Pipe repairs'}
    assert work_api.post('/repaidians/work/behavior', headers=auth('customer'), json=event).json() == {'recorded': False}
    assert work_api.patch('/repaidians/work/preferences', headers=auth('customer'), json={'personalizedDiscovery': True}).status_code == 200
    event['eventId'] = str(uuid.uuid4())
    for _ in range(4):
        assert work_api.post('/repaidians/work/behavior', headers=auth('customer'), json=event).json() == {'recorded': True}
    signals = main.operations_store.run(lambda u: u.get('rp_work_signals', 'customer'))
    assert signals['trades']['plumber']['weight'] == 1 and len(signals['terms']) == 1
    assert work_api.post('/repaidians/work/behavior', headers=auth('customer'), json={**event, 'trade': 'ac'}).status_code == 409
    assert main.operations_store.run(lambda u: u.get('rp_work_signals', 'stranger')) is None
    stamp = work.now_ms()
    before = main.operations_store.run(lambda u: work.interests(u, 'customer', stamp))
    after = main.operations_store.run(lambda u: work.interests(u, 'customer', stamp + work.HALF_LIFE_MS))
    assert next(r['weight'] for r in after['trades'] if r['trade'] == 'plumber') == pytest.approx(next(r['weight'] for r in before['trades'] if r['trade'] == 'plumber') / 2, abs=.001)
    work_api.patch('/repaidians/work/preferences', headers=auth('customer'), json={'personalizedDiscovery': False})
    assert main.operations_store.run(lambda u: u.get('rp_work_signals', 'customer')) == {'trades': {}, 'terms': []}


def seed_tender(tid='tender1'):
    now = time.time()
    row = dict(id=tid, owner_id='shop', title='Electrical published contract', sector='Electrical', city='Balasore',
               status='open', opens_at=now - 100, deadline=now + 86400, starts_at=now + 172800, ends_at=now + 7 * 86400,
               budget_paise=1000000, manpower_needed=3, version=1, scope='PRIVATE CONTRACT REQUIREMENTS', site='PRIVATE SITE')
    main.operations_store.run(lambda u: u.put('contract_tenders', tid, row))
    return row


def test_watch_requires_consent_and_daily_three_cap_survives_concurrency(work_api):
    profile()
    for i in range(5):
        seed_tender(f't{i}')
    assert work_api.put('/repaidians/work/contracts/t0/watch', headers=auth('customer'), json={'active': True}).status_code == 409
    assert work_api.patch('/repaidians/work/preferences', headers=auth('customer'), json={'contractUpdates': True}).status_code == 200
    for i in range(5):
        assert work_api.put(f'/repaidians/work/contracts/t{i}/watch', headers=auth('customer'), json={'active': True}).json() == {'watched': True}
    assert work_api.get('/repaidians/work/contracts/t0/watch', headers=auth('customer')).json() == {'watched': True}
    with ThreadPoolExecutor(max_workers=8) as pool:
        counts = list(pool.map(lambda _: main.operations_store.run(lambda u: work.deliver_contract_updates(u, 'customer')), range(16)))
    assert sum(counts) == 3
    notes = main.operations_store.run(lambda u: repaidians.query(u, repaidians.lane('rp_notifications', 'customer'), 50))
    contract_notes = [note for note in notes if note['type'] == 'contract_update']
    assert len(contract_notes) == len({n['targetId'] for n in contract_notes}) == 3
    assert all('PRIVATE' not in json.dumps(note) for note in notes)
    day = work.datetime.fromtimestamp(time.time(), work.IST).date().isoformat()
    quota = main.operations_store.run(lambda u: u.get('rp_work_daily', repaidians.digest('customer:' + day)))
    assert len(quota['contracts']) == 3


def test_contract_push_rechecks_optout_block_and_withdrawal(work_api):
    profile(); row = seed_tender()
    work_api.patch('/repaidians/work/preferences', headers=auth('customer'), json={'contractUpdates': True})
    work_api.put('/repaidians/work/contracts/tender1/watch', headers=auth('customer'), json={'active': True})
    assert main.operations_store.run(lambda u: work.deliver_contract_updates(u, 'customer')) == 1
    delivery = main.operations_store.run(lambda u: repaidians.query(u, 'rp_work_delivery', 5)[0])
    assert main.operations_store.run(lambda u: work.delivery_allowed(u, delivery))
    work_api.patch('/repaidians/work/preferences', headers=auth('customer'), json={'contractUpdates': False})
    assert not main.operations_store.run(lambda u: work.delivery_allowed(u, delivery))
    work_api.patch('/repaidians/work/preferences', headers=auth('customer'), json={'contractUpdates': True})
    row['status'] = 'withdrawn'; main.operations_store.run(lambda u: u.put('contract_tenders', 'tender1', row))
    assert not main.operations_store.run(lambda u: work.delivery_allowed(u, delivery))


def test_accepted_placements_only_and_independent_salary_consent(work_api):
    profile('worker2'); seed_job()
    def seat(u, status='pending'):
        p = u.get('contract_projects', 'job1')
        p['team'] = [{'id': 'seat1', 'worker_id': 'worker2', 'role': 'member', 'status': status, 'daily_rate_paise': 90000, 'terms': 'PRIVATE OFFER TERMS'}]
        u.put('contract_projects', 'job1', p)
    main.operations_store.run(seat)
    work_api.patch('/repaidians/work/preferences', headers=auth('worker2'), json={'sharePlacements': True})
    work.process_updates(main)
    pid = repaidians.digest('job1:seat1')
    assert work_api.get('/repaidians/placements/' + pid, headers=auth('customer')).status_code == 404
    main.operations_store.run(lambda u: seat(u, 'accepted'))
    work.process_updates(main)
    card = work_api.get('/repaidians/placements/' + pid, headers=auth('customer'))
    assert card.status_code == 200, card.text
    assert 'dailyRatePaise' not in card.json() and 'PRIVATE' not in card.text
    work_api.patch('/repaidians/work/preferences', headers=auth('worker2'), json={'shareSalary': True})
    assert work_api.get('/repaidians/placements/' + pid, headers=auth('customer')).json()['dailyRatePaise'] == 90000
    work_api.patch('/repaidians/work/preferences', headers=auth('worker2'), json={'sharePlacements': False})
    assert work_api.get('/repaidians/placements/' + pid, headers=auth('customer')).status_code == 404
    assert work_api.get('/repaidians/work/preferences', headers=auth('worker2')).json()['preferences']['shareSalary'] is False


def test_placement_notifications_use_live_follow_edges_and_congratulate_once(work_api):
    profile('worker2'); seed_job()
    work_api.patch('/repaidians/work/preferences', headers=auth('worker2'), json={'sharePlacements': True})
    assert work_api.put('/repaidians/follow/worker2', headers=auth('customer'), json={'active': True}).status_code == 200
    def accept(u):
        p = u.get('contract_projects', 'job1'); p['team'] = [{'id': 's1', 'worker_id': 'worker2', 'status': 'accepted', 'role': 'member', 'daily_rate_paise': 70000}]
        u.put('contract_projects', 'job1', p)
    main.operations_store.run(accept)
    work.process_updates(main); work.process_updates(main)
    pid = repaidians.digest('job1:s1')
    notes = work_api.get('/repaidians/notifications', headers=auth('customer')).json()['notifications']
    assert len([n for n in notes if n['type'] == 'placement' and n['targetId'] == pid]) == 1
    body = {'clientId': str(uuid.uuid4()), 'message': 'congratulations'}
    for _ in range(3):
        assert work_api.post('/repaidians/placements/' + pid + '/congratulate', headers=auth('customer'), json=body).json() == {'ok': True, 'congratulated': True}
    notes = work_api.get('/repaidians/notifications', headers=auth('worker2')).json()['notifications']
    assert len([n for n in notes if n['type'] == 'congratulation']) == 1
    push = main.operations_store.run(lambda u: next(r for r in repaidians.query(u, 'rp_work_delivery', 30) if r['event'] == 'placement'))
    assert main.operations_store.run(lambda u: work.delivery_allowed(u, push))
    work_api.put('/repaidians/follow/worker2', headers=auth('customer'), json={'active': False})
    assert not main.operations_store.run(lambda u: work.delivery_allowed(u, push))


def test_registered_company_connections_and_ready_lanes(work_api, monkeypatch):
    profile('worker2'); seed_job()
    main.operations_store.run(lambda u: u.put('contract_profiles', 'worker', {'id': 'worker', 'name': 'Registered Electrical Co', 'city': 'Balasore', 'sector': 'Electrical', 'scope': 'Public registered company work scope.'}))
    monkeypatch.setattr(operations.Unit, 'all', lambda *args: (_ for _ in ()).throw(AssertionError('Company scan')))
    companies = work_api.get('/repaidians/companies', headers=auth('customer')).json()
    assert companies['items'][0]['name'] == 'Registered Electrical Co'
    refs = main.operations_store.run(lambda u: work.candidate_keyset(u, 'electrician', 'Balasore'))
    assert [r['id'] for r in refs if r['active']] == ['worker2']
    profile('worker2', workStatus='not_looking')
    refs = main.operations_store.run(lambda u: work.candidate_keyset(u, 'electrician', 'Balasore'))
    assert not [r for r in refs if r['active']]
    main.operations_store.run(lambda u: u.put('workers', 'worker', {'id': 'worker', 'status': 'pending', 'contractor_verified': True}))
    assert work_api.get('/repaidians/companies/worker', headers=auth('customer')).status_code == 404


def test_scheduler_bounded_backfill_and_no_hot_scans(work_api, monkeypatch):
    profile(); seed_job()
    def count(u):
        return len(u.all('rp_work_index'))
    assert main.operations_store.run(count) >= 1
    monkeypatch.setattr(operations.Unit, 'all', lambda *args: (_ for _ in ()).throw(AssertionError('Worker collection scan')))
    assert work.backfill(main, 1)['processed'] <= 5
    result = work.process_updates(main, 1)
    assert set(result) == {'placementsIndexed', 'placementNotifications', 'contractNotifications'}


def test_guest_and_filter_validation(work_api):
    assert work_api.get('/repaidians/work/jobs').status_code == 401
    assert work_api.get('/repaidians/companies').status_code == 401
    assert work_api.get('/repaidians/work/jobs?experience=-1', headers=auth('customer')).status_code == 422
    assert work_api.get('/repaidians/work/jobs?trade=bogus', headers=auth('customer')).status_code == 422
    assert work_api.patch('/repaidians/work/preferences', headers=auth('customer'), json={'shareSalary': 'true'}).status_code == 422


def test_native_application_view_emits_one_owned_social_event_and_push(work_api):
    onboard(work_api, 'worker2')
    profile('worker2', trade='ac', skills=['AC service'])
    seed_job(trade='HVAC', hiring={'skills': ['AC service']})
    applied = work_api.post('/operations/contractor/projects/job1/apply', headers=auth('worker2'),
                            json={'hiring_version': 1, 'note': 'I can deliver the published air conditioning service safely.', 'available': True})
    assert applied.status_code == 200, applied.text
    application = applied.json()
    viewed = work_api.post('/operations/contractor/hiring/applications/' + application['id'] + '/view', headers=auth('worker'),
                           json={'expected_version': application['version'], 'action': 'profile_viewed', 'request_id': str(uuid.uuid4())})
    assert viewed.status_code == 200, viewed.text
    notes = work_api.get('/repaidians/notifications', headers=auth('worker2')).json()['notifications']
    assert len([n for n in notes if n.get('event') == 'profile_viewed' and n.get('applicationId') == application['id']]) == 1
    deliveries = main.operations_store.run(lambda u: repaidians.query(u, 'rp_work_delivery', 30))
    event = next(row for row in deliveries if row.get('application_id') == application['id'] and row['title'] == 'Your profile was viewed')
    assert main.operations_store.run(lambda u: work.delivery_allowed(u, event))
    assert not main.operations_store.run(lambda u: work.delivery_allowed(u, {**event, 'recipient_id': 'stranger'}))
    assert get_jobs(work_api, uid='worker2')['items'][0]['application'] == {'id': application['id'], 'status': 'applied'}
    preferences = work_api.patch('/repaidians/settings', headers=auth('worker2'), json={'applicationNotifications': False})
    assert preferences.status_code == 200, preferences.text
    assert not main.operations_store.run(lambda u: work.delivery_allowed(u, event))
    following_view = work_api.post('/operations/contractor/hiring/applications/' + application['id'] + '/view', headers=auth('worker'),
                                  json={'expected_version': viewed.json()['version'], 'action': 'application_viewed', 'request_id': str(uuid.uuid4())})
    assert following_view.status_code == 200, following_view.text
    after = work_api.get('/repaidians/notifications', headers=auth('worker2')).json()['notifications']
    assert not [row for row in after if row.get('applicationId') == application['id'] and row.get('event') == 'application_viewed']
    work_api.patch('/repaidians/settings', headers=auth('worker2'), json={'applicationNotifications': True})
    assert main.operations_store.run(lambda u: work.delivery_allowed(u, event))


def test_company_connections_require_live_accepted_share_and_relationship(work_api):
    profile('worker2'); profile(); seed_job()
    main.operations_store.run(lambda u: u.put('contract_profiles', 'worker', {'id': 'worker', 'name': 'Electrical company', 'city': 'Balasore', 'sector': 'Electrical', 'scope': 'Public company scope.'}))
    def accept(u):
        p = u.get('contract_projects', 'job1'); p['team'] = [{'id': 'joined', 'worker_id': 'worker2', 'status': 'accepted', 'role': 'member', 'daily_rate_paise': 50000}]
        u.put('contract_projects', 'job1', p)
    main.operations_store.run(accept)
    work.process_updates(main)
    path = '/repaidians/companies/worker'
    assert work_api.get(path, headers=auth('customer')).json()['connections'] == []
    work_api.patch('/repaidians/work/preferences', headers=auth('worker2'), json={'sharePlacements': True})
    assert work_api.get(path, headers=auth('customer')).json()['connections'] == []
    work_api.put('/repaidians/follow/worker2', headers=auth('customer'), json={'active': True})
    company = work_api.get(path, headers=auth('customer')).json()
    assert company['connections'][0]['member']['id'] == 'worker2' and 'dailyRatePaise' not in company['connections'][0]
    assert company['jobs'][0]['ownerId'] == 'worker'
    work_api.patch('/repaidians/work/preferences', headers=auth('worker2'), json={'sharePlacements': False})
    assert work_api.get(path, headers=auth('customer')).json()['connections'] == []


def test_signal_storage_is_bounded_and_personalized_contracts_are_relevant(work_api):
    profile()
    seed_tender('electrical')
    row = seed_tender('plumbing'); row.update(sector='Plumbing', title='Pipe repairs contract')
    main.operations_store.run(lambda u: u.put('contract_tenders', 'plumbing', row))
    work_api.patch('/repaidians/work/preferences', headers=auth('customer'), json={'personalizedDiscovery': True, 'contractUpdates': True})
    for i in range(40):
        result = work_api.post('/repaidians/work/behavior', headers=auth('customer'), json={'eventId': str(uuid.uuid4()), 'trade': 'plumber', 'type': 'search', 'query': 'Pipe repairs ' + str(i)})
        assert result.status_code == 200
    signals = main.operations_store.run(lambda u: u.get('rp_work_signals', 'customer'))
    assert len(signals['terms']) == 24 and len(signals['trades']) <= len(repaidians.TRADES)
    assert signals['trades']['plumber']['weight'] <= 30
    interests = work_api.get('/repaidians/work/interests', headers=auth('customer')).json()
    assert interests['trades'][0]['trade'] == 'plumber'
    assert main.operations_store.run(lambda u: work.deliver_contract_updates(u, 'customer')) == 2
    notifications = work_api.get('/repaidians/notifications', headers=auth('customer')).json()['notifications']
    assert {n['contractId'] for n in notifications if n['type'] == 'contract_update'} == {'electrical', 'plumbing'}


def test_daily_discovery_prefers_actual_search_terms_and_honors_unwatch(work_api):
    profile()
    electric = seed_tender('electric'); electric['deadline'] = time.time() + 4 * 86400
    main.operations_store.run(lambda u: u.put('contract_tenders', electric['id'], electric))
    for i in range(4):
        row = seed_tender(f'pipe{i}')
        row.update(sector='Plumbing', title='Pipe repairs contract' if i < 3 else 'Water valve installation', deadline=time.time() + 4 * 86400)
        main.operations_store.run(lambda u, row=row: u.put('contract_tenders', row['id'], row))
    work_api.patch('/repaidians/work/preferences', headers=auth('customer'), json={'contractUpdates': True, 'personalizedDiscovery': True})
    for _ in range(10):
        work_api.post('/repaidians/work/behavior', headers=auth('customer'), json={'eventId': str(uuid.uuid4()), 'trade': 'plumber', 'type': 'search', 'query': 'Pipe repairs'})
    assert main.operations_store.run(lambda u: work.deliver_contract_updates(u, 'customer')) == 3
    notes = work_api.get('/repaidians/notifications', headers=auth('customer')).json()['notifications']
    assert {n['contractId'] for n in notes if n['type'] == 'contract_update'} == {'pipe0', 'pipe1', 'pipe2'}
    assert main.operations_store.run(lambda u: work.deliver_contract_updates(u, 'customer')) == 0
    assert work_api.put('/repaidians/work/contracts/pipe0/watch', headers=auth('customer'), json={'active': False}).json() == {'watched': False}
    assert main.operations_store.run(lambda u: work.deliver_contract_updates(u, 'customer', time.time() + 86400)) == 3
    deliveries = main.operations_store.run(lambda u: repaidians.query(u, 'rp_work_delivery', 20))
    assert len([row for row in deliveries if row['target_id'] == 'pipe0']) == 1


def test_own_jobs_are_excluded_and_registered_specialist_role_is_required(work_api):
    profile('worker'); seed_job()
    assert get_jobs(work_api, uid='worker')['items'] == []
    profile(); seed_job('specialist', hiring={'worker_role': 'specialist'})
    assert 'specialist' not in {row['id'] for row in get_jobs(work_api)['items']}


def test_cursor_rejects_profile_lane_or_personalization_revision_changes(work_api):
    profile(); seed_job('a'); seed_job('b')
    cursor = get_jobs(work_api, limit=1)['nextCursor']
    profile(trade='plumber')
    assert work_api.get('/repaidians/work/jobs', headers=auth('customer'), params={'cursor': cursor, 'limit': 1}).status_code == 422
    profile()
    work_api.patch('/repaidians/work/preferences', headers=auth('customer'), json={'personalizedDiscovery': True})
    cursor = get_jobs(work_api, limit=1)['nextCursor']
    work_api.post('/repaidians/work/behavior', headers=auth('customer'), json={'eventId': str(uuid.uuid4()), 'trade': 'electrician', 'type': 'view'})
    assert work_api.get('/repaidians/work/jobs', headers=auth('customer'), params={'cursor': cursor, 'limit': 1}).status_code == 422


def test_expired_members_can_revoke_work_privacy_without_new_entitlement(work_api):
    onboard(work_api, 'worker2'); profile('worker2'); seed_job(); seed_tender()
    enabled = {'personalizedDiscovery': True, 'contractUpdates': True, 'sharePlacements': True, 'shareSalary': True}
    assert work_api.patch('/repaidians/work/preferences', headers=auth('worker2'), json=enabled).status_code == 200
    work_api.put('/repaidians/follow/worker2', headers=auth('customer'), json={'active': True})
    work_api.put('/repaidians/work/contracts/tender1/watch', headers=auth('worker2'), json={'active': True})
    work_api.post('/repaidians/work/behavior', headers=auth('worker2'), json={'eventId': str(uuid.uuid4()), 'trade': 'electrician', 'type': 'search', 'query': 'Electrical installation'})
    def accepted(u):
        p = u.get('contract_projects', 'job1')
        p['team'] = [{'id': 'expired-seat', 'worker_id': 'worker2', 'role': 'member', 'status': 'accepted', 'daily_rate_paise': 80000}]
        u.put('contract_projects', 'job1', p)
    main.operations_store.run(accepted)
    work.process_updates(main)
    queued = main.operations_store.run(lambda u: repaidians.query(u, 'rp_work_delivery', 30))
    placement_push = next(row for row in queued if row['event'] == 'placement' and row['recipient_id'] == 'customer')
    contract_push = next(row for row in queued if row['event'] == 'contract_update' and row['recipient_id'] == 'worker2')
    assert main.operations_store.run(lambda u: work.delivery_allowed(u, placement_push))
    assert main.operations_store.run(lambda u: work.delivery_allowed(u, contract_push))
    def expire(u):
        member = u.get('rp_members', 'worker2'); trial = u.get('rp_trials', 'worker2')
        joined = int((time.time() - 62 * 86400) * 1000)
        member['createdAt'] = joined; trial.update(startsAt=joined, endsAt=joined + 60 * 86400000)
        u.put('rp_members', 'worker2', member); u.put('rp_trials', 'worker2', trial)
        return trial
    original_trial = main.operations_store.run(expire)
    assert work_api.get('/repaidians/work/jobs', headers=auth('worker2')).status_code == 402
    assert work_api.get('/repaidians/work/preferences', headers=auth('worker2')).json()['preferences'] == enabled
    result = work_api.patch('/repaidians/work/preferences', headers=auth('worker2'), json={key: False for key in enabled})
    assert result.status_code == 200, result.text
    assert not any(result.json()['preferences'].values())
    assert main.operations_store.run(lambda u: u.get('rp_trials', 'worker2')) == original_trial
    assert main.operations_store.run(lambda u: u.get('rp_subscriptions', 'worker2')) is None
    assert main.operations_store.run(lambda u: u.get('rp_work_signals', 'worker2')) == {'trades': {}, 'terms': []}
    assert not main.operations_store.run(lambda u: work.delivery_allowed(u, placement_push))
    assert not main.operations_store.run(lambda u: work.delivery_allowed(u, contract_push))
    assert work_api.get('/repaidians/work/interests', headers=auth('worker2')).status_code == 402


def test_job_work_trade_and_business_industry_filters_are_independent(work_api, monkeypatch):
    profile()
    seed_job('school', trade='Education', hiring={'work_trade': 'electrician'})
    monkeypatch.setattr(operations.Unit, 'all', lambda *args: (_ for _ in ()).throw(AssertionError('Sector collection scan')))
    page = get_jobs(work_api, trade='electrician', sector='education', query='installation')
    assert [item['id'] for item in page['items']] == ['school']
    assert page['items'][0]['trade'] == 'electrician'
    assert page['items'][0]['details']['hiring']['sector'] == 'Education'
    assert get_jobs(work_api, trade='spares', sector='Education')['items'] == []
    assert get_jobs(work_api, trade='electrician', sector='Retail', query='installation')['items'] == []
    cards = work_api.get('/repaidians/opportunities', headers=auth('customer'), params={'kind': 'jobs', 'trade': 'electrician'}).json()['items']
    assert [item['id'] for item in cards] == ['school']
    tender = seed_tender('school-tender'); tender.update(sector='Education', title='Campus electrical installation')
    main.operations_store.run(lambda u: u.put('contract_tenders', tender['id'], tender))
    matched = work_api.get('/repaidians/work/contracts', headers=auth('customer'), params={'sector': 'Education', 'query': 'installation'})
    assert matched.status_code == 200, matched.text
    assert [item['id'] for item in matched.json()['items']] == ['school-tender']
    assert work_api.get('/repaidians/work/contracts', headers=auth('customer'), params={'sector': 'Retail', 'query': 'installation'}).json()['items'] == []
    assert work_api.get('/repaidians/work/contracts', headers=auth('customer'), params={'sector': 'x'}).status_code == 422


def test_versioned_background_migration_repairs_legacy_industry_misclassification(work_api, monkeypatch):
    import repaidians_opportunities as bridge
    profile()
    row = seed_job('legacy-school', trade='Education', hiring={'skills': ['Electrical installation']})
    row['title'] = 'Campus upgrade team'
    main.operations_store.run(lambda u: u.put('contract_projects', row['id'], row))
    def historical_projection(u):
        key = row['id']; marker = u.get('rp_work_index', 'jobs:' + key)
        for old in marker['channels']:
            u.put(old, key, {'id': key, 'sortKey': key, 'active': False})
        old_channels = {work.channel('jobs', 'spares'), work.channel('jobs')}
        for old in old_channels:
            u.put(old, key, {'id': key, 'sortKey': key, 'active': True})
        u.put('rp_work_index', 'jobs:' + key, {'channels': sorted(old_channels), 'active': True})
        u.put('rp_work_backfill', 'contract_projects', {'complete': True, 'after': 'zzz'})
        career_marker = u.get('rp_opportunity_refs', 'career:' + key)
        for old in career_marker['channels']:
            u.put(old, key, {'id': key, 'sortKey': key, 'source': 'career', 'origin': 'live', 'active': False})
        old_career_channels = {bridge.lane('career', trade='spares'), bridge.lane('career')}
        for old in old_career_channels:
            u.put(old, key, {'id': key, 'sortKey': key, 'source': 'career', 'origin': 'live', 'active': True})
        u.put('rp_opportunity_refs', 'career:' + key, {'channels': sorted(old_career_channels), 'origin': 'live'})
        u.put('rp_opportunity_backfill', 'career', {'done': True, 'after': 'zzz'})
    main.operations_store.run(historical_projection)
    monkeypatch.setattr(operations.Unit, 'all', lambda *args: (_ for _ in ()).throw(AssertionError('Migration collection scan')))
    assert get_jobs(work_api, trade='electrician')['items'] == []
    assert work.backfill(main, limit=2)['processed'] <= 10
    assert [item['id'] for item in get_jobs(work_api, trade='electrician')['items']] == ['legacy-school']
    cards = work_api.get('/repaidians/opportunities', headers=auth('customer'), params={'kind': 'jobs', 'trade': 'electrician'}).json()['items']
    assert [item['id'] for item in cards] == ['legacy-school']
    assert main.operations_store.run(lambda u: u.get('rp_work_backfill', 'contract_projects:' + work.WORK_TRADE_INDEX_VERSION))['complete']
