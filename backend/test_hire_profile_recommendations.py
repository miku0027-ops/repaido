"""Action suggestions use current approved scope and actual category evidence."""
import json
import time
from unittest.mock import patch

import main
from operations import Unit
from test_hiring_records import setup_hire
from test_home_plans import setup_worker
from test_hire_recommendations import completed
from test_operations import api


def details(api, category=''):
    response = api.get('/operations/professionals/worker', params={'category': category})
    assert response.status_code == 200, response.text
    assert 'no-store' in response.headers['cache-control']
    return response.json()


def test_profile_chooses_current_listed_package_and_selected_category_evidence(api, monkeypatch):
    setup_hire(api, monkeypatch)
    original = main.catalog(False)
    packages = [s for s in original['services'] if s['category'] == 'ac' and s.get('active', True)]
    selected = packages[-1]

    def seed(u):
        completed(u, 'worker', [5] * 12, 'plumber')
        u.put('jobs', 'package-history', {
            'id': 'package-history', 'worker_id': 'worker', 'state': 'completed',
            'category': 'ac', 'service_id': selected['id'], 'service_name': selected['name'],
            'completed_at': time.time(), 'review': {'rating': 2, 'text': 'Verified visit'},
            'verified_arrived_at': 1010, 'verified_arrival_starts_epoch': 1000})
    main.operations_store.run(seed)
    row = details(api, 'ac')
    rec = row['profile_recommendation']
    assert rec['action']['kind'] == 'service' and rec['action']['service_id'] == selected['id']
    assert rec['verified_work'] == {'completed': 1, 'review_count': 1, 'rating': 2}
    assert rec['engine_version'] == 'hire-evidence-v1'
    assert all(s['category'] == 'ac' for s in row['service_packages'])
    assert next(s for s in row['service_packages'] if s['id'] == selected['id'])['price_paise'] == selected['price_paise']
    assert row['performance']['scores']['punctuality']['score'] == 100
    assert details(api, 'plumber')['profile_recommendation'] is None
    changed = {**original, 'services': [{**s, 'active': False} if s['category'] == 'ac' else s for s in original['services']]}
    monkeypatch.setattr(main, 'catalog', lambda *args: changed)
    refreshed = details(api, 'ac')
    assert refreshed['service_packages'] == [] and refreshed['profile_recommendation'] is None


def test_home_suggestion_rechecks_approval_and_never_mixes_generic_category_work(api):
    setup_worker(api)
    def seed(u):
        completed(u, 'worker', [5] * 8, 'cleaning')
        for i, rating in enumerate([4, 5]):
            jid = 'home-evidence-' + str(i)
            u.put('jobs', jid, {'id': jid, 'worker_id': 'worker', 'state': 'completed',
                'category': 'cleaning', 'service_id': 'home-maid', 'home_plan_id': 'private-plan',
                'service_name': 'Reviewed Home visit', 'completed_at': time.time(), 'review': {'rating': rating}})
    main.operations_store.run(seed)
    rec = details(api, 'home:maid')['profile_recommendation']
    assert rec['action']['kind'] == 'home' and rec['action']['service_id'] == 'maid'
    assert rec['verified_work'] == {'completed': 2, 'review_count': 2, 'rating': 4.5}
    assert details(api, 'home:interior-design')['profile_recommendation'] is None
    main.operations_store.run(lambda u: u.put('home_availability', 'worker', {**u.get('home_availability', 'worker'), 'approved_services': ['caretaker']}))
    assert details(api, 'home:maid')['profile_recommendation'] is None


def test_bounded_profile_labels_sample_and_preserves_coherent_native_totals(api, monkeypatch):
    setup_hire(api, monkeypatch)
    row = details(api, 'ac')
    assert row['profile_recommendation']['verified_work'] == {'completed': 0, 'review_count': 0, 'rating': None}
    assert 'No verified' in ' '.join(row['profile_recommendation']['reasons'])
    main.operations_store.run(lambda u: completed(u, 'worker', [4] * 100))
    original = Unit.all
    def no_scans(self, kind):
        if kind in ('workers', 'jobs', 'professional_offers'):
            raise AssertionError('Profile scanned ' + kind)
        return original(self, kind)
    with patch.object(Unit, 'all', no_scans), patch.object(Unit, 'for_workers', side_effect=AssertionError('Unbounded work read')):
        row = details(api, 'ac')
    assert row['evidence_scope'] == {'kind': 'bounded_worker_records', 'record_limit': 80, 'complete': False}
    assert row['profile_recommendation']['verified_work']['completed'] == 80
    assert row['completed_tasks'] == 80 and not row['totals_scope']['complete']
    assert 'bounded sample' in ' '.join(row['profile_recommendation']['reasons'])
    assert not {'location', 'position', 'phone', 'email', 'home_address'} & row.keys()
    assert 'PRIVATE-CUSTOMER' not in json.dumps(row)
    def native_totals(u):
        w = u.get('workers', 'worker')
        u.put('workers', 'worker', {**w, 'completed_tasks': 120, 'rating_count': 100, 'rating_sum': 420})
    main.operations_store.run(native_totals)
    authoritative = details(api, 'ac')
    assert authoritative['completed_tasks'] == 120 and authoritative['review_count'] == 100
    assert authoritative['rating'] == 4.2 and authoritative['totals_scope'] == {'kind': 'verified_worker_totals', 'complete': True}
    assert authoritative['evidence_scope']['complete'] is False
    main.operations_store.run(lambda u: u.put('workers', 'worker', {**u.get('workers', 'worker'), 'rating_sum': 450}))
    assert details(api, 'ac')['totals_scope']['complete'] is False  # Cannot reconcile with the observed reviews.
    main.operations_store.run(lambda u: u.put('workers', 'worker', {**u.get('workers', 'worker'), 'status': 'suspended'}))
    assert api.get('/operations/professionals/worker').status_code == 404
