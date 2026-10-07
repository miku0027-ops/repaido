"""Customer and professional HTTP projections share one server-owned trial."""
import json
import uuid

import pytest

import main
import repaidians_billing as billing
from operations import Unit
from test_operations import api, auth, onboard, PIN


@pytest.mark.parametrize('contractor,kind', [(False, 'agent'), (True, 'contractor')])
def test_customer_and_professional_badges_share_join_date_and_exact_expiry(api, monkeypatch, contractor, kind):
    clock = [1800000000.0]
    monkeypatch.setattr(billing.time, 'time', lambda: clock[0])
    onboard(api)
    def reviewed_role(u):
        worker = u.get('workers', 'worker')
        worker['contractor_verified'] = contractor
        u.put('workers', 'worker', worker)
    main.operations_store.run(reviewed_role)
    assert main.operations_store.run(lambda u: u.get('rp_members', 'worker')) is None

    # Browsing a real approved professional from the customer side enrolls the
    # worker once, without creating a community account or a payment record.
    customer = api.get('/operations/professionals/worker')
    assert customer.status_code == 200, customer.text
    badge = customer.json()['repaidianBadge']
    assert badge == dict(label='Repaidian', kind='membership', status='active', source='trial',
                        professionalType=kind, startsAt=1800000000000,
                        endsAt=1800000000000 + 60 * 86400000)
    public = json.dumps(customer.json())
    for private in ('home_address', 'bank_account', 'fund_account_id', 'paymentId', 'attemptId'):
        assert private not in public
    assert main.operations_store.run(lambda u: u.get('rp_members', 'worker')) is None
    assert main.operations_store.run(lambda u: u.all('rp_payments')) == []
    assert api.get('/operations/worker/me', headers=auth('worker')).json()['worker']['repaidianBadge'] == badge

    # Joining later, changing a self-declared role, and reading the public
    # community profile all reuse the customer's original entitlement dates.
    clock[0] += 10 * 86400
    joined = api.get('/repaidians/state', headers=auth('worker')).json()
    assert joined['member']['repaidianBadge'] == badge
    assert joined['trial']['startsAt'] == badge['startsAt']
    assert joined['trial']['endsAt'] == badge['endsAt']
    changed = api.patch('/repaidians/profile', headers=auth('worker'),
                        json={'professionalType': 'member' if contractor else 'contractor'})
    assert changed.status_code == 200, changed.text
    assert changed.json()['member']['repaidianBadge'] == badge
    community = api.get('/repaidians/members/worker')
    assert community.status_code == 200, community.text
    assert community.json()['member']['repaidianBadge'] == badge

    clock[0] = badge['endsAt'] / 1000
    assert api.get('/operations/professionals/worker').json()['repaidianBadge'] is None
    assert api.get('/operations/worker/me', headers=auth('worker')).json()['worker']['repaidianBadge'] is None
    expired = api.get('/repaidians/state', headers=auth('worker')).json()
    assert expired['member']['repaidianBadge'] is None and expired['remainingMs'] == 0
    assert expired['trial']['startsAt'] == badge['startsAt']
    assert expired['trial']['status'] == 'expired'
    assert api.patch('/repaidians/profile', headers=auth('worker'), json={'bio': 'Cannot restart the trial.'}).status_code == 402
    assert main.operations_store.run(lambda u: u.get('rp_trials', 'worker'))['endsAt'] == badge['endsAt']


def test_pending_worker_and_self_declared_contractor_cannot_mint_public_badge(api, monkeypatch):
    monkeypatch.setattr(billing.time, 'time', lambda: 1800000000.0)
    onboard(api, approve=False)
    assert api.get('/operations/professionals/worker').status_code == 404
    own = api.get('/operations/worker/me', headers=auth('worker')).json()['worker']
    assert own['repaidianBadge'] is None
    assert main.operations_store.run(lambda u: u.get('rp_trials', 'worker')) is None
    declared = api.patch('/repaidians/profile', headers=auth('worker'), json={'professionalType': 'contractor'})
    assert declared.status_code == 200, declared.text
    assert declared.json()['member']['professionalType'] == 'contractor'
    assert declared.json()['member']['reviewed'] is False
    assert declared.json()['member']['repaidianBadge'] is None
    assert api.get('/repaidians/members/worker').json()['member']['repaidianBadge'] is None


def test_customer_search_directory_and_leader_projections_share_safe_badge(api, monkeypatch):
    # Use the real listing campaign window, and accept the actual published
    # Hire policy through its HTTP endpoint; this test never creates a charge.
    monkeypatch.setattr(billing.time, 'time', lambda: 1791331200.0)
    onboard(api)
    policy = api.get('/operations/hiring/policy').json()
    accepted = api.post('/operations/worker/hire-membership/accept', headers=auth('worker'),
                        json={'version': policy['version'], 'radius_km': 6, 'consent': True})
    assert accepted.status_code == 200, accepted.text
    def history(u):
        u.put('jobs', 'completed-badge-test', dict(id='completed-badge-test', worker_id='worker',
              customer_id='private-customer', category='ac', service_id='ac-service', service_name='AC service',
              state='completed', completed_at=1791331200.0,
              review={'rating': 5, 'text': 'Completed test installation.', 'created_at': 1791331200.0}))
    main.operations_store.run(history)
    badge = api.get('/operations/professionals/worker').json()['repaidianBadge']

    responses = [api.get('/technicians?city=Balasore'), api.get('/operations/professionals')]
    responses.extend(api.post(path, json=body) for path, body in (
        ('/operations/professionals/search', {'city': 'Balasore', 'category': 'ac', 'location': PIN, 'radius_km': 6}),
        ('/operations/discovery/search', {'city': 'Balasore', 'category': 'ac', 'location': PIN, 'radius_km': 6}),
        ('/operations/hiring/search', {'category': 'ac', 'location': PIN, 'radius_km': 6}),
        ('/operations/hiring/leaderboard', {'city': 'Balasore', 'category': 'ac'}),
    ))
    for response in responses:
        assert response.status_code == 200, response.text
        body = response.json()
        rows = body.get('professionals', body.get('technicians'))
        assert rows and rows[0]['id'] == 'worker', response.text
        assert rows[0]['repaidianBadge'] == badge, response.text
        for private in ('home_address', 'fund_account_id', 'paymentId', 'attemptId', 'private-customer'):
            assert private not in json.dumps(body)
    leader = next(category['leader'] for category in responses[-1].json()['categories'] if category['id'] == 'ac')
    assert leader['repaidianBadge'] == badge


def test_customer_profile_only_projects_member_public_career_sections(api):
    onboard(api)
    api.get('/repaidians/state', headers=auth('worker'))
    body = {'expectedVersion': 0, 'clientId': str(uuid.uuid4()), 'about': 'Public project installation history. Call 9876543210.',
            'experience': [{'id': 'actual-role', 'title': 'Installation lead', 'organization': 'Employer me@example.test',
                            'description': 'Call 9876543210 for work.', 'startMonth': '2020-01', 'current': True}],
            'education': [{'id': 'college', 'institution': 'Institute me@example.test', 'qualification': 'Diploma 9876543210',
                           'fieldOfStudy': 'Safety me@example.test', 'startMonth': '2017-01', 'endMonth': '2019-01'}],
            'certifications': [{'id': 'cert', 'name': 'Safety', 'issuer': 'Training school', 'issuedMonth': '2020-01',
                                'credentialUrl': 'https://example.org/credentials/9876543210'}],
            'featured': [{'id': 'portfolio', 'title': 'Project portfolio', 'url': 'https://example.org/portfolio/9876543210'}],
            'visibility': 'public'}
    written = api.patch('/repaidians/network/profile', headers=auth('worker'), json=body)
    assert written.status_code == 200, written.text
    customer = api.get('/operations/professionals/worker').json()['professionalNetwork']
    assert customer['profile']['about'].startswith('Public project installation history. Call [contact hidden]')
    projected_text = {key: customer['profile'][key] for key in ('about', 'experience', 'education')}
    assert '9876543210' not in json.dumps(projected_text) and 'me@example.test' not in json.dumps(projected_text)
    assert customer['profile']['certifications'][0]['credentialUrl'] == body['certifications'][0]['credentialUrl']
    assert customer['profile']['featured'][0]['url'] == body['featured'][0]['url']
    assert customer['profileInfoSource'] == 'member'
    assert customer['connection']['status'] == 'anonymous'
    assert customer['recommendations']['items'] == customer['endorsements']['items'] == []
    hidden = api.patch('/repaidians/network/profile', headers=auth('worker'),
                       json={'expectedVersion': 1, 'clientId': str(uuid.uuid4()), 'visibility': 'connections'})
    assert hidden.status_code == 200, hidden.text
    projected = api.get('/operations/professionals/worker').json()
    assert projected['professionalNetwork'] is None
    assert body['about'] not in json.dumps(projected)


def test_large_customer_leaderboard_enrolls_only_returned_profiles_and_unique_leaders(api, monkeypatch):
    monkeypatch.setattr(billing.time, 'time', lambda: 1791331200.0)
    onboard(api)
    def candidates(u):
        template = u.get('workers', 'worker')
        for index in range(520):
            uid = f'candidate-{index:04d}'
            u.put('workers', uid, {**template, 'id': uid, 'name': 'Approved fixture professional'})
        u.put('workers', 'plumbing-leader', {**template, 'id': 'plumbing-leader', 'name': 'Approved fixture leader',
                                          'categories': ['plumber'], 'skills': ['Plumbing installation']})
        u.put('jobs', 'plumbing-leader-review', dict(id='plumbing-leader-review', worker_id='plumbing-leader',
              customer_id='private-customer', category='plumber', service_id='plumbing', service_name='Plumbing',
              state='completed', completed_at=1791331200.0,
              review={'rating': 5, 'text': 'Completed test installation.', 'created_at': 1791331200.0}))
        return {row['userId'] for row in u.all('rp_trials')}
    before = main.operations_store.run(candidates)
    response = api.post('/operations/hiring/leaderboard', json={'city': 'Balasore', 'category': 'ac'})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body['total'] > 500 and len(body['professionals']) == 40
    visible = {row['id'] for row in body['professionals']}
    leaders = {category['leader']['id'] for category in body['categories'] if category['leader']}
    assert 'plumbing-leader' in leaders and 'plumbing-leader' not in visible
    expected = visible | leaders
    persisted = main.operations_store.run(lambda u: {row['userId'] for row in u.all('rp_trials')})
    assert persisted - before == expected - before
    assert len(persisted - before) <= 41
    for row in body['professionals']:
        assert row['repaidianBadge']['status'] == 'active'
    for category in body['categories']:
        if category['leader']:
            assert category['leader']['repaidianBadge']['status'] == 'active'
    repeated = api.post('/operations/hiring/leaderboard', json={'city': 'Balasore', 'category': 'ac'})
    assert repeated.status_code == 200
    assert main.operations_store.run(lambda u: {row['userId'] for row in u.all('rp_trials')}) == persisted


def test_worker_availability_and_delayed_heartbeat_keep_badge_and_portrait(api, monkeypatch):
    monkeypatch.setattr(billing.time, 'time', lambda: 1791331200.0)
    onboard(api)
    main.operations_store.run(lambda u: u.put('worker_profiles', 'worker', {'portrait_id': 'fixture-portrait'}))
    own = api.get('/operations/worker/me', headers=auth('worker')).json()['worker']
    assert own['repaidianBadge']['status'] == 'active'
    assert own['portrait_url'] == '/api/operations/professional-media/fixture-portrait'
    offline = api.post('/operations/worker/availability', headers=auth('worker'), json={'online': False})
    assert offline.status_code == 200, offline.text
    delayed = api.post('/operations/worker/availability', headers=auth('worker'),
                       json={'online': True, 'heartbeat': True, 'position': {**PIN, 'accuracy': 5, 'captured_at': 1791331200.0}})
    assert delayed.status_code == 200, delayed.text
    for response in (offline, delayed):
        worker = response.json()['worker']
        assert worker['online'] is False
        assert worker['repaidianBadge'] == own['repaidianBadge']
        assert worker['portrait_url'] == own['portrait_url']
    assert main.operations_store.run(lambda u: u.get('workers', 'worker'))['online'] is False


@pytest.mark.parametrize('surface', ['technicians', 'directory', 'professionals-search', 'discovery-search'])
def test_customer_pages_only_enroll_and_prefetch_returned_24_workers(api, monkeypatch, surface):
    monkeypatch.setattr(billing.time, 'time', lambda: 1791331200.0)
    onboard(api)
    def candidates(u):
        template = u.get('workers', 'worker')
        for index in range(60):
            uid = f'paged-candidate-{index:03d}'
            u.put('workers', uid, {**template, 'id': uid, 'name': 'Approved fixture professional'})
        return {row['userId'] for row in u.all('rp_trials')}
    before = main.operations_store.run(candidates)
    prefetched = []
    original_prefetch = Unit.prefetch
    def trace_prefetch(unit, pairs):
        pairs = list(pairs)
        prefetched.extend(pair for pair in pairs if pair[0] in ('rp_members', 'rp_trials', 'rp_subscriptions'))
        return original_prefetch(unit, pairs)
    monkeypatch.setattr(Unit, 'prefetch', trace_prefetch)
    if surface == 'technicians':
        response = api.get('/technicians?city=Balasore')
        collection = 'technicians'
    elif surface == 'directory':
        response = api.get('/operations/professionals')
        collection = 'professionals'
    else:
        path = '/operations/professionals/search' if surface == 'professionals-search' else '/operations/discovery/search'
        response = api.post(path, json={'city': 'Balasore', 'category': 'ac', 'location': PIN, 'radius_km': 6})
        collection = 'professionals'
    assert response.status_code == 200, response.text
    rows = response.json()[collection]
    assert len(rows) == 24
    visible = {row['id'] for row in rows}
    assert len(prefetched) <= 24 * 3 and {uid for _, uid in prefetched} == visible
    persisted = main.operations_store.run(lambda u: {row['userId'] for row in u.all('rp_trials')})
    assert persisted - before == visible - before
    assert all(row['repaidianBadge']['status'] == 'active' for row in rows)
