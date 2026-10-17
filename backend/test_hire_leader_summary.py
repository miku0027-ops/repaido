"""Fast public overviews preserve exact directory leaders and coverage rules."""
import json
import time
from unittest.mock import patch

import hire_discovery
import main
from operations import Unit
from test_hire_discovery import seed_reviews
from test_hiring_records import setup_hire
from test_operations import api, onboard, PIN


def browse(api, **values):
    result = api.post('/operations/hiring/leaderboard', json={'city': 'Balasore', **values})
    assert result.status_code == 200, result.text
    return result.json()


def test_summary_uses_identical_verified_leaders_filters_and_private_boundaries(api, monkeypatch):
    setup_hire(api, monkeypatch)
    onboard(api, 'worker2')

    def seed(u):
        worker = u.get('workers', 'worker')
        worker.update(name='First professional 9876543210', contractor_verified=True)
        u.put('workers', 'worker', worker)
        other = u.get('workers', 'worker2')
        other.update(role='specialist', categories=['ac', 'plumber'])
        u.put('workers', 'worker2', other)
        u.put('hire_memberships', 'worker2', u.get('hire_memberships', 'worker'))
        u.put('worker_profiles', 'worker', {'languages': ['Odia'], 'specialties': ['Air conditioner cleaning'], 'portrait_id': 'public-portrait'})
        u.put('home_availability', 'worker', {'approved_services': ['maid']})
        seed_reviews(u, 'worker', [5])
        seed_reviews(u, 'worker2', [4] * 8)
        seed_reviews(u, 'worker2', [5, 5], category='plumber')
        u.put('jobs', 'completed-home', dict(id='completed-home', worker_id='worker', category='cleaning',
              service_id='home-maid', service_name='Daily care', state='completed', home_plan_id='private-plan',
              completed_at=time.time(), review={'rating': 5, 'text': 'Private fixture review'}))
    main.operations_store.run(seed)
    cases = [{}, {'category': 'ac'}, {'category': 'home:maid'}, {'role': 'specialist'},
             {'role': 'contractor'}, {'min_rating': 4.5}, {'min_completed': 5},
             {'language': 'Odia', 'query': 'cleaning'}, {'available_only': True},
             {'location': PIN, 'radius_km': 3}, {'location': {**PIN, 'lat': PIN['lat'] + .2}, 'radius_km': 6},
             {'strict_nearby': True, 'location': PIN, 'radius_km': 8}, {'city': 'Bhadrak'}]
    for values in cases:
        full = browse(api, **values)
        summary = browse(api, summary_only=True, **values)
        assert summary['professionals'] == []
        for field in ('categories', 'total', 'scope', 'covered', 'method'):
            assert summary[field] == full[field], (values, field)
        for category in summary['categories']:
            if category['leader']:
                assert set(category['leader']) == {'id', 'name', 'portrait_url', 'role', 'repaidianBadge'}
        encoded = json.dumps(summary)
        for private in ('9876543210', 'private-customer', 'NEVER PUBLIC', 'private-plan', 'Private fixture review'):
            assert private not in encoded
    assert next(c for c in browse(api, summary_only=True)['categories'] if c['id'] == 'ac')['leader']['id'] == 'worker2'


def test_summary_skips_rich_profiles_offers_and_package_recommendations(api, monkeypatch):
    setup_hire(api, monkeypatch)
    main.operations_store.run(lambda u: seed_reviews(u, 'worker', [5]))
    calls = []
    original = Unit.for_workers
    def read(self, kind, *args, **kwargs):
        calls.append(kind)
        assert kind != 'professional_offers', 'Category leaders do not display offers'
        return original(self, kind, *args, **kwargs)
    def unnecessary(*args, **kwargs):
        raise AssertionError('Overview hydrated unused professional histories or recommendations')
    with patch.object(Unit, 'for_workers', read), patch.object(hire_discovery, 'profile', unnecessary), patch.object(hire_discovery, 'profile_recommendation', unnecessary):
        summary = browse(api, summary_only=True)
    assert calls == ['jobs']
    assert next(c for c in summary['categories'] if c['id'] == 'ac')['leader']['id'] == 'worker'


def test_summary_size_and_work_for_a_large_real_city_fixture(api, monkeypatch):
    setup_hire(api, monkeypatch)
    def seed(u):
        worker = u.get('workers', 'worker')
        membership = u.get('hire_memberships', 'worker')
        for index in range(45):
            uid = f'city-worker-{index:03d}'
            u.put('workers', uid, {**worker, 'id': uid, 'name': f'City professional {index}'})
            u.put('hire_memberships', uid, {**membership, 'id': uid})
            u.put('worker_profiles', uid, {'bio': 'Reviewed service scope. ' * 30, 'languages': ['Odia', 'Hindi']})
            seed_reviews(u, uid, [4, 5])
    main.operations_store.run(seed)
    original = Unit.for_workers
    reads = []
    def read(self, kind, *args, **kwargs):
        rows = original(self, kind, *args, **kwargs)
        reads.append((kind, len(rows)))
        return rows
    with patch.object(Unit, 'for_workers', read):
        started = time.perf_counter();full = browse(api);full_seconds = time.perf_counter() - started
        full_reads = list(reads);reads.clear()
        started = time.perf_counter();summary = browse(api, summary_only=True);summary_seconds = time.perf_counter() - started
        summary_reads = list(reads)
    full_bytes, summary_bytes = (len(json.dumps(row).encode()) for row in (full, summary))
    assert len(full['professionals']) == 40 and summary['total'] == full['total'] == 46
    assert summary['categories'] == full['categories']
    assert summary_bytes < full_bytes / 10
    assert [kind for kind, _ in full_reads] == ['jobs', 'professional_offers']
    assert [kind for kind, _ in summary_reads] == ['jobs']
    print(json.dumps({'fixture_professionals': 46, 'full_bytes': full_bytes, 'summary_bytes': summary_bytes,
                      'full_ms': round(full_seconds * 1000, 2), 'summary_ms': round(summary_seconds * 1000, 2),
                      'full_worker_reads': full_reads, 'summary_worker_reads': summary_reads}))


def test_summary_still_rechecks_current_approval_and_online_coverage(api, monkeypatch):
    setup_hire(api, monkeypatch)
    main.operations_store.run(lambda u: seed_reviews(u, 'worker', [5]))
    assert browse(api, summary_only=True, available_only=True)['total'] == 1
    def change(u):
        worker = u.get('workers', 'worker');worker['online'] = False
        u.put('workers', 'worker', worker)
    main.operations_store.run(change)
    assert browse(api, summary_only=True, available_only=True)['total'] == 0
    def revoke(u):
        worker = u.get('workers', 'worker');worker['status'] = 'suspended'
        u.put('workers', 'worker', worker)
    main.operations_store.run(revoke)
    summary = browse(api, summary_only=True)
    assert summary['total'] == 0 and not any(c['leader'] for c in summary['categories'])
