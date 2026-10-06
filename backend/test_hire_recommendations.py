"""Real recommendation endpoints: consent, scope, eligibility and category facts."""
import json
import time
import uuid
from unittest.mock import patch

import pytest

import main
import hiring
from operations import Unit
from test_hiring_records import setup_hire
from test_home_plans import setup_worker
from test_operations import api, auth, onboard, PIN


PATH = '/operations/hiring/recommendations'


def recommend(api, uid='customer', **values):
    response = api.post(PATH, headers=auth(uid), json={'city': 'Balasore', **values})
    assert response.status_code == 200, response.text
    return response.json()


def interest(api, uid='customer', category='ac', score=8, visits=3, age=0, version=2, enabled=True):
    main.operations_store.run(lambda u: u.put('discovery_preferences', uid, {
        'enabled': enabled,
        'consent_version': version,
        'categories': {category: visits},
        'signals': {category: {'score': score, 'visits': visits, 'at': time.time() - age}},
    }))


def member(u, uid, policy):
    u.put('hire_memberships', uid, {
        'id': uid, 'status': 'active', 'expires_at': time.time() + 86400,
        'policy_version': policy['version'], 'radius_km': 10,
    })


def completed(u, uid, ratings, category='ac'):
    for rating in ratings:
        jid = str(uuid.uuid4())
        row = {
            'id': jid, 'worker_id': uid, 'customer_id': 'PRIVATE-CUSTOMER',
            'category': category, 'service_id': category + '-service',
            'service_name': category + ' fixture work', 'state': 'completed',
            'completed_at': time.time(), 'address': 'PRIVATE-ADDRESS',
            'location': PIN, 'phone': '9876543210',
        }
        if rating is not None:
            row['review'] = {'rating': rating, 'text': 'Call 9876543210 or private@example.test', 'created_at': time.time()}
        u.put('jobs', jid, row)


def test_recommendations_require_authentication_and_reject_actor_override(api):
    assert api.post(PATH, json={'city': 'Balasore'}).status_code == 401
    response = api.post(PATH, headers=auth('customer'), json={'city': 'Balasore', 'user_id': 'stranger'})
    assert response.status_code == 422


@pytest.mark.parametrize('values', [
    {'city': 'x' * 81}, {'radius_km': 0}, {'radius_km': 51},
    {'location': {'lat': 91, 'lng': 0}}, {'role': 'administrator'},
    {'category': 'nonexistent-category'}, {'radius_km': 0.5},
    {'compare_ids': ['private/path']}, {'compare_ids': ['x' * 129]},
    {'min_rating': 6}, {'min_experience': -1},
])
def test_recommendation_inputs_are_bounded_and_catalog_validated(api, values):
    response = api.post(PATH, headers=auth('customer'), json={'city': 'Balasore', **values})
    assert response.status_code == 422, response.text


@pytest.mark.parametrize('values', [
    {'strict_nearby': True, 'radius_km': 11, 'location': PIN},
    {'limit': 0}, {'limit': 9}, {'query': 'x' * 101},
    {'budget_paise': -1}, {'compare_ids': ['a', 'b', 'c', 'd', 'e']},
])
def test_recommendation_radius_result_and_comparison_limits(api, values):
    response = api.post(PATH, headers=auth('customer'), json={'city': 'Balasore', **values})
    assert response.status_code == 422, response.text


def test_no_consent_or_interest_has_truthful_cold_start(api, monkeypatch):
    setup_hire(api, monkeypatch)
    result = recommend(api)
    assert result['professionals'] == []
    assert result['cold_start'] and result['consent_required']
    assert not result['personalised']
    explicit = recommend(api, category='ac')
    assert [row['id'] for row in explicit['professionals']] == ['worker']
    assert explicit['consent_required'] and not explicit['personalised']
    facts = explicit['professionals'][0]['comparison']['verified_work']
    assert facts['completed'] == 0 and facts['review_count'] == 0 and facts['rating'] is None
    assert explicit['professionals'][0]['comparison']['hire_readiness']['quote_required']


def test_personalisation_is_account_scoped_and_reset_or_opt_out_takes_effect(api, monkeypatch):
    setup_hire(api, monkeypatch)
    interest(api)
    personalised = recommend(api)
    assert personalised['personalised'] and not personalised['consent_required']
    assert [row['id'] for row in personalised['professionals']] == ['worker']
    stranger = recommend(api, uid='stranger')
    assert not stranger['personalised'] and stranger['professionals'] == []
    assert stranger['cold_start']
    reset = api.post('/operations/discovery/preferences/reset', headers=auth('customer'))
    assert reset.status_code == 200
    assert recommend(api)['professionals'] == []
    interest(api)
    assert recommend(api)['professionals']
    disable = api.put('/operations/discovery/preferences', headers=auth('customer'), json={'enabled': False})
    assert disable.status_code == 200
    after = recommend(api)
    assert after['professionals'] == [] and after['consent_required']
    assert not after['personalised']
    stored = main.operations_store.run(lambda u: u.get('discovery_preferences', 'customer'))
    assert not {'signals', 'seen', 'recent'} & stored.keys()


@pytest.mark.parametrize('values', [
    {'version': 1}, {'enabled': False}, {'age': 31 * 86400}, {'visits': 1},
    {'age': -60}, {'category': 'unknown-category'},
])
def test_legacy_disabled_expired_or_single_visit_signals_do_not_infer_a_category(api, monkeypatch, values):
    setup_hire(api, monkeypatch)
    interest(api, **values)
    result = recommend(api)
    assert result['professionals'] == [] and result['cold_start']
    explicit = recommend(api, category='ac')
    assert [row['id'] for row in explicit['professionals']] == ['worker']


def test_explicit_category_wins_over_learned_interests(api, monkeypatch):
    setup_hire(api, monkeypatch)
    interest(api, category='ac')
    result = recommend(api, category='plumber')
    assert not result['professionals']
    assert not recommend(api, city='Outside coverage', category='ac')['professionals']


def test_comparison_and_ranking_use_verified_selected_category_work(api, monkeypatch):
    policy = setup_hire(api, monkeypatch)
    onboard(api, 'worker2')

    def seed(u):
        member(u, 'worker2', policy)
        for uid in ('worker', 'worker2'):
            row = u.get('workers', uid)
            row['categories'] = ['ac', 'plumber']
            u.put('workers', uid, row)
        completed(u, 'worker', [2], 'ac')
        completed(u, 'worker', [5] * 10, 'plumber')
        completed(u, 'worker2', [4] * 3, 'ac')
        u.put('jobs', 'unfinished-review', {'id': 'unfinished-review', 'worker_id': 'worker', 'state': 'cancelled', 'category': 'ac', 'service_id': 'ac-service', 'service_name': 'Cancelled AC fixture', 'review': {'rating': 5}})

    main.operations_store.run(seed)
    result = recommend(api, category='ac')
    assert [row['id'] for row in result['professionals']] == ['worker2', 'worker']
    comparisons = {row['id']: row['comparison'] for row in result['professionals']}
    assert comparisons['worker']['category'] == 'ac'
    assert comparisons['worker']['verified_work']['completed'] == 1
    assert comparisons['worker']['verified_work']['review_count'] == 1
    assert comparisons['worker']['verified_work']['rating'] == 2
    assert comparisons['worker2']['verified_work']['completed'] == 3
    assert comparisons['worker2']['verified_work']['review_count'] == 3
    assert comparisons['worker2']['verified_work']['rating'] == 4
    plumbing = recommend(api, category='plumber')
    assert plumbing['professionals'][0]['id'] == 'worker'
    assert plumbing['professionals'][0]['comparison']['verified_work']['rating'] == 5


def test_comparisons_keep_catalogue_prices_separate_from_actual_quotes_and_privacy(api, monkeypatch):
    setup_hire(api, monkeypatch)
    main.operations_store.run(lambda u: completed(u, 'worker', [4, None]))
    result = recommend(api, category='ac', budget_paise=1, location=PIN)
    row = result['professionals'][0]
    facts = row['comparison']['verified_work']
    assert facts['completed'] == 2 and facts['review_count'] == 1 and facts['rating'] == 4
    references = row['comparison']['catalogue_references']
    assert references and all(item['basis'] == 'catalogue_reference' for item in references)
    assert all('price_paise' in item and 'included' in item and 'excluded' in item for item in references)
    assert row['comparison']['budget_status'] == 'above_catalogue_reference'
    assert row['comparison']['hire_readiness']['quote_required'] is True
    assert not {'phone', 'email', 'home_address', 'location', 'position', 'bank', 'dob'} & row.keys()
    encoded = json.dumps(result)
    assert all(secret not in encoded for secret in ('9876543210', 'private@example.test', 'PRIVATE-CUSTOMER', 'PRIVATE-ADDRESS'))


def test_recommendations_recheck_approval_membership_city_and_category(api, monkeypatch):
    monkeypatch.setattr(hiring, 'free_listing', lambda: False)
    setup_hire(api, monkeypatch)
    assert recommend(api, category='ac')['professionals']

    def change_membership(u):
        row = u.get('hire_memberships', 'worker')
        row['status'] = 'refunded'
        u.put('hire_memberships', 'worker', row)

    main.operations_store.run(change_membership)
    assert not recommend(api, category='ac', compare_ids=['worker'])['professionals']
    policy = main.operations_store.run(lambda u: u.get('hire_policy', 'current'))
    main.operations_store.run(lambda u: member(u, 'worker', policy))
    for changes in ({'status': 'suspended'}, {'city': 'Bhadrak'}, {'categories': ['plumber']}):
        previous = main.operations_store.run(lambda u: u.get('workers', 'worker'))
        main.operations_store.run(lambda u: u.put('workers', 'worker', {**previous, **changes}))
        assert not recommend(api, category='ac', compare_ids=['worker'])['professionals']
        main.operations_store.run(lambda u: u.put('workers', 'worker', previous))


def test_recommendations_avoid_global_worker_history_or_preference_scans(api, monkeypatch):
    setup_hire(api, monkeypatch)
    with main.db() as connection:
        rows = []
        for i in range(10000):
            uid = f'elsewhere-{i}'
            rows.extend([
                ('workers', uid, json.dumps({'id': uid, 'city': 'Elsewhere', 'status': 'approved'})),
                ('jobs', 'job-' + uid, json.dumps({'id': 'job-' + uid, 'worker_id': uid, 'state': 'completed'})),
            ])
        connection.executemany('INSERT INTO operation_records(kind,id,body) VALUES(?,?,?)', rows)
    original = Unit.all

    def no_scans(self, kind):
        if kind in ('workers', 'jobs', 'hires', 'professional_offers', 'discovery_preferences'):
            raise AssertionError('Recommendation scanned the whole ' + kind)
        return original(self, kind)

    with patch.object(Unit, 'all', no_scans), patch.object(Unit, 'find', side_effect=AssertionError('Unbounded indexed read')), patch.object(Unit, 'for_workers', side_effect=AssertionError('Unbounded history read')):
        result = recommend(api, category='ac')
    assert [row['id'] for row in result['professionals']] == ['worker']
    assert result['candidate_window']['limit'] == 64
    assert result['candidate_window']['examined'] <= 64
    assert 'Elsewhere' not in json.dumps(result)


@pytest.mark.parametrize('state', ['offline', 'stale', 'future', 'inaccurate', 'busy_job', 'busy_hire'])
def test_unavailable_directory_profiles_are_never_advertised_as_available_now(api, monkeypatch, state):
    setup_hire(api, monkeypatch)
    assert recommend(api, category='ac', location=PIN)['professionals'][0]['available_now']

    def unavailable(u):
        row = u.get('workers', 'worker')
        if state == 'offline':
            row['online'] = False
        elif state == 'stale':
            row['position']['received_at'] = time.time() - 301
        elif state == 'future':
            row['position']['received_at'] = time.time() + 60
        elif state == 'inaccurate':
            row['position']['accuracy'] = 101
        elif state == 'busy_job':
            u.put('jobs', 'live-work', {'id': 'live-work', 'worker_id': 'worker', 'state': 'in_progress', 'category': 'ac', 'service_id': 'ac-service', 'service_name': 'Active work'})
        else:
            u.put('hires', 'live-hire', {'id': 'live-hire', 'worker_id': 'worker', 'state': 'offered', 'offer_expires_at': time.time() + 300})
        u.put('workers', 'worker', row)

    main.operations_store.run(unavailable)
    result = recommend(api, category='ac', location=PIN)
    assert [row['id'] for row in result['professionals']] == ['worker']
    assert result['professionals'][0]['available_now'] is False


def test_explicit_comparison_can_reach_beyond_bounded_window_without_bypassing_eligibility(api, monkeypatch):
    policy = setup_hire(api, monkeypatch)

    def populate(u):
        base = u.get('workers', 'worker')
        for i in range(70):
            uid = f'candidate-{i:03}'
            u.put('workers', uid, {**base, 'id': uid, 'name': 'Real fixture professional ' + str(i)})
            member(u, uid, policy)
        u.put('workers', 'zz-outside-window', {**base, 'id': 'zz-outside-window', 'name': 'Known comparison professional'})
        member(u, 'zz-outside-window', policy)
        u.put('workers', 'private-other-city', {**base, 'id': 'private-other-city', 'city': 'Elsewhere', 'home_address': 'PRIVATE-OTHER-CITY-ADDRESS'})
        member(u, 'private-other-city', policy)

    main.operations_store.run(populate)
    result = recommend(api, category='ac', limit=2, compare_ids=['zz-outside-window', 'private-other-city', 'unknown'])
    assert len(result['professionals']) <= 2
    assert result['candidate_window']['examined'] <= 64
    assert result['candidate_window']['has_more']
    assert [row['id'] for row in result['comparisons']] == ['zz-outside-window']
    assert set(result['missing_compare_ids']) == {'private-other-city', 'unknown'}
    assert 'PRIVATE-OTHER-CITY-ADDRESS' not in json.dumps(result)


def test_bounded_worker_history_is_labelled_as_incomplete_evidence(api, monkeypatch):
    setup_hire(api, monkeypatch)
    main.operations_store.run(lambda u: completed(u, 'worker', [4] * 100))
    result = recommend(api, category='ac')
    row = result['professionals'][0]
    scope = row['recommendation']['evidence_scope']
    assert scope['kind'] == 'bounded_worker_records'
    assert scope['record_limit'] == 80 and scope['complete'] is False
    assert row['comparison']['verified_work']['completed'] <= 80
    assert row['comparison']['verified_work']['review_count'] <= 80


def test_recommendation_service_area_never_expands_or_invents_missing_origin(api, monkeypatch):
    setup_hire(api, monkeypatch)
    far = {**PIN, 'lat': PIN['lat'] + .2}
    assert not recommend(api, category='ac', location=far, radius_km=10)['professionals']
    main.operations_store.run(lambda u: u.put('workers', 'worker', {**u.get('workers', 'worker'), 'location': None}))
    assert not recommend(api, category='ac', location=PIN)['professionals']


def test_old_interests_lose_weight_before_the_retention_cutoff(api, monkeypatch):
    setup_hire(api, monkeypatch)
    interest(api, score=2.5, age=86400)
    fresh = recommend(api)
    assert fresh['personalised'] and fresh['selected_category'] == 'ac'
    interest(api, score=2.5, age=7 * 86400)
    decayed = recommend(api)
    assert decayed['professionals'] == [] and decayed['cold_start']
    assert not decayed['personalised']


def test_home_comparisons_distinguish_reviewed_services_and_do_not_mix_work_evidence(api, monkeypatch):
    setup_worker(api)

    def seed(u):
        completed(u, 'worker', [5] * 10, 'cleaning')
        for service, ratings in [('maid', [4, 5]), ('caretaker', [5, 5, 5])]:
            for rating in ratings:
                jid = str(uuid.uuid4())
                u.put('jobs', jid, {
                    'id': jid, 'worker_id': 'worker', 'state': 'completed',
                    'category': 'cleaning', 'service_id': 'home-' + service,
                    'home_plan_id': 'private-' + service + '-plan',
                    'service_name': service + ' recurring fixture',
                    'completed_at': time.time(),
                    'review': {'rating': rating, 'text': 'Completed reviewed Home visit', 'created_at': time.time()},
                })

    main.operations_store.run(seed)
    result = recommend(api, category='home:maid', budget_paise=100)
    comparison = result['professionals'][0]['comparison']
    assert comparison['category'] == 'home:maid'
    assert comparison['verified_work']['completed'] == 2
    assert comparison['verified_work']['review_count'] == 2
    assert comparison['verified_work']['rating'] == 4.5
    assert comparison['home_service']['id'] == 'maid'
    assert comparison['catalogue_references'] == []
    assert comparison['budget_status'] == 'unknown'
    assert comparison['hire_readiness']['quote_required']
    assert any(field['id'] == 'approved_service' for field in result['comparison_fields'])
    assert not recommend(api, category='home:interior-design')['professionals']


def test_compare_ids_do_not_bypass_customer_search_or_service_area(api, monkeypatch):
    setup_hire(api, monkeypatch)
    result = recommend(api, category='ac', query='completelyunmatchedskill', compare_ids=['worker'])
    assert not result['professionals'] and not result['comparisons']
    assert result['missing_compare_ids'] == ['worker']
    result = recommend(api, category='ac', location={**PIN, 'lat': PIN['lat'] + .2}, compare_ids=['worker'])
    assert not result['professionals'] and not result['comparisons']
    assert result['missing_compare_ids'] == ['worker']


def test_discovery_filters_preserve_selected_category_evidence_and_fresh_availability(api, monkeypatch):
    setup_hire(api, monkeypatch)

    def seed(u):
        completed(u, 'worker', [4, 4], 'ac')
        u.put('worker_profiles', 'worker', {'languages': ['Odia'], 'specialties': ['AC repair']})

    main.operations_store.run(seed)
    assert recommend(api, category='ac', role='technician', min_rating=4, min_experience=4, min_completed=2, language='Odia')['professionals']
    for filters in ({'role': 'specialist'}, {'min_rating': 4.1}, {'min_experience': 5}, {'min_completed': 3}, {'language': 'Japanese'}):
        assert not recommend(api, category='ac', compare_ids=['worker'], **filters)['professionals']
    main.operations_store.run(lambda u: u.put('workers', 'worker', {**u.get('workers', 'worker'), 'online': False}))
    assert recommend(api, category='ac')['professionals']
    assert not recommend(api, category='ac', available_only=True)['professionals']


def test_home_events_refresh_only_consented_specific_service_interest(api, monkeypatch):
    setup_worker(api)
    now=[time.time()]
    monkeypatch.setattr('discovery.time.time',lambda:now[0])
    headers=auth('customer')
    event=lambda:api.post('/operations/discovery/events',headers=headers,json={
        'event_id':str(uuid.uuid4()),'kind':'category_view','category':'home:maid'})
    assert event().status_code==403
    assert api.put('/operations/discovery/preferences',headers=headers,json={'enabled':True,'consent_version':2}).status_code==200
    assert event().json()['recorded']
    assert recommend(api)['selected_category']==''
    now[0]+=61
    assert event().json()['recorded']
    result=recommend(api)
    assert result['selected_category']=='home:maid' and result['personalised']
    assert result['preferences_updated_at']==now[0]
    assert recommend(api,uid='stranger')['selected_category']==''
    assert api.post('/operations/discovery/preferences/reset',headers=headers).status_code==200
    assert recommend(api)['selected_category']==''


def test_home_offers_and_catalogue_policy_remain_live_without_shared_personal_cache(api,monkeypatch):
    from test_professional_offers import publish
    setup_worker(api)
    headers=auth('customer')
    assert not recommend(api,category='home:maid')['professionals'][0]['offers']
    offer=publish(api).json()
    result=recommend(api,category='home:maid')
    assert result['professionals'][0]['offers'][0]['id']==offer['id']
    assert result['professionals'][0]['offers'][0]['bps']==1500
    assert 'discount_paise' not in result['professionals'][0]['offers'][0]
    assert not recommend(api,category='ac')['professionals'][0]['offers']
    assert api.delete('/operations/worker/home-offers/'+offer['id'],headers=auth('worker')).status_code==200
    assert not recommend(api,category='home:maid')['professionals'][0]['offers']
    response=api.post(PATH,headers=headers,json={'city':'Balasore','category':'ac'})
    assert 'no-store' in response.headers['cache-control']
    original=main.catalog(False)
    price=next(s['price_paise'] for s in original['services'] if s['category']=='ac')
    def update(u):
        u.put('hire_policy','current',{**hiring.DEFAULT,'enabled':False})
    main.operations_store.run(update)
    disabled=recommend(api,category='ac')['professionals'][0]['comparison']
    assert not disabled['hire_readiness']['enabled'] and disabled['hire_readiness']['base_paise'] is None
    changed={**original,'services':[{**s,'price_paise':price+1234} if s['category']=='ac' else s for s in original['services']]}
    monkeypatch.setattr(main,'catalog',lambda *args:changed)
    assert all(row['price_paise']==price+1234 for row in recommend(api,category='ac')['professionals'][0]['comparison']['catalogue_references'])


def test_firestore_recommendation_lookup_uses_only_single_field_equality_and_limit():
    from types import SimpleNamespace
    from hire_discovery import bounded_rows
    calls=[]
    class Query:
        def where(self,field,operator,value):
            calls.append(('where',field,operator,value));return self
        def limit(self,value):
            calls.append(('limit',value));return self
        def select(self,fields):
            calls.append(('select',fields));return self
        def stream(self,transaction):
            calls.append(('transaction',transaction))
            return [SimpleNamespace(id='worker',to_dict=lambda:{'id':'worker','city':'Balasore'})]
    transaction=object()
    unit=SimpleNamespace(tx=transaction,core=SimpleNamespace(fs_collection=lambda kind:Query()),pending={},fetched={})
    assert bounded_rows(unit,'workers','city','Balasore',65)==[{'id':'worker','city':'Balasore'}]
    assert calls==[('where','city','==','Balasore'),('limit',65),('transaction',transaction)]
    assert unit.fetched['workers','worker']['city']=='Balasore'
