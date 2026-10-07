"""One canonical vacancy ledger across manual invitations and applications."""
import copy
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import main
import contract_work as cw
from test_operations import api, auth, onboard
from test_contract_work import seed, project, cmd
from test_worker_network import notice, apply, decision, get, put


def manual_invite(api, p, worker='worker2', **fields):
    body = dict(expected_version=p['version'], worker_id=worker, role='member',
                daily_rate_paise=100000, terms='Eight hours daily with safety equipment and agreed weekly payment.')
    body.update(fields)
    return api.post('/operations/contractor/projects/' + p['id'] + '/invitations',
                    headers=auth('worker'), json=body)


def test_manual_reservation_blocks_application_offer_and_full_team_closes_notice(api):
    seed(api); onboard(api, 'shop')
    p, _ = project(api); p, _ = notice(api, p)
    application = apply(api, p, uid='shop').json()
    reserved = manual_invite(api, p)
    assert reserved.status_code == 200, reserved.text
    p = reserved.json()
    rejected = decision(api, application, p)
    assert rejected.status_code == 409, rejected.text
    capacity = cw.team_capacity(get('contract_projects', p['id']))
    assert (capacity['accepted'], capacity['pendingOffers'], capacity['vacancies'], capacity['availableToOffer']) == (0, 1, 1, 0)
    accepted = cmd(api, p, 'accept', uid='worker2', target_id=p['team'][0]['id'])
    assert accepted.status_code == 200, accepted.text
    current = get('contract_projects', p['id'])
    assert current['hiring']['status'] == 'closed'
    assert cw.team_capacity(current)['vacancies'] == 0
    assert get('project_applications', application['id'])['status'] == 'applied'


def test_manual_invite_and_application_offer_race_reserves_exactly_one_place(api):
    seed(api); onboard(api, 'shop')
    p, _ = project(api); p, _ = notice(api, p)
    application = apply(api, p, uid='shop').json()
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(manual_invite, api, p), pool.submit(decision, api, application, p)]
        responses = [future.result() for future in futures]
    assert sorted(response.status_code for response in responses) == [200, 409]
    current = get('contract_projects', p['id'])
    assert current['version'] == p['version'] + 1
    assert cw.team_capacity(current)['pendingOffers'] == 1
    assert cw.team_capacity(current)['accepted'] == 0
    app = get('project_applications', application['id'])
    assert (app['status'] == 'offered') == (responses[1].status_code == 200)


def test_role_places_cannot_be_removed_or_reduced_below_reservations(api):
    seed(api); onboard(api, 'shop')
    p, _ = project(api)
    roles = [{'worker_type': 'electrical_installer', 'count': 1}, {'worker_type': 'site_supervisor', 'count': 1}]
    p, _ = notice(api, p, openings=2, role_requirements=roles)
    missing_type = manual_invite(api, p)
    assert missing_type.status_code == 422
    response = manual_invite(api, p, worker_type='Electrical installer')
    assert response.status_code == 200, response.text
    p = response.json()
    full_role = manual_invite(api, p, worker='shop', worker_type='Electrical installer')
    assert full_role.status_code == 409
    response = manual_invite(api, p, worker='shop', worker_type='Site supervisor')
    assert response.status_code == 200, response.text
    p = response.json()
    _, body = notice(api, p, openings=2, role_requirements=roles)
    current = get('contract_projects', p['id'])
    path = '/operations/contractor/projects/' + p['id'] + '/hiring'
    reduce_total = {**body, 'expected_version': current['version'], 'openings': 1,
                    'role_requirements': [{'worker_type': 'Electrical installer', 'count': 1}]}
    assert api.put(path, headers=auth('worker'), json=reduce_total).status_code == 409
    change_roles = {**body, 'expected_version': current['version'],
                    'role_requirements': [{'worker_type': 'Electrical installer', 'count': 2}]}
    assert api.put(path, headers=auth('worker'), json=change_roles).status_code == 409
    assert get('contract_projects', p['id'])['hiring']['role_requirements'] == roles


def test_departure_releases_place_but_does_not_reopen_hiring_without_owner_action(api):
    seed(api); p, _ = project(api); p, _ = notice(api, p)
    p = manual_invite(api, p).json()
    p = cmd(api, p, 'accept', uid='worker2', target_id=p['team'][0]['id']).json()
    assert p['hiring']['status'] == 'closed'
    response = cmd(api, p, 'leave_team', uid='worker2')
    assert response.status_code == 200, response.text
    p = get('contract_projects', p['id'])
    assert p['hiring']['status'] == 'closed' and cw.team_capacity(p)['vacancies'] == 1
    assert apply(api, p).status_code == 409
    p, _ = notice(api, p)
    assert apply(api, p).status_code == 200


def test_duplicate_historical_rows_do_not_inflate_capacity_or_public_counts(api):
    seed(api); p, _ = project(api); p, _ = notice(api, p, openings=2)
    p = manual_invite(api, p).json()
    p = cmd(api, p, 'accept', uid='worker2', target_id=p['team'][0]['id']).json()
    duplicate = copy.deepcopy(p['team'][0]); duplicate['id'] = 'legacy-duplicate-invitation'
    p['team'].append(duplicate); put('contract_projects', p['id'], p)
    capacity = cw.team_capacity(p)
    assert capacity['accepted'] == 1 and capacity['vacancies'] == 1
    public = cw.public_hiring(p)
    assert public['team']['total'] == 1
    assert public['team']['members'] + public['team']['supervisors'] == 1
    response = cmd(api, p, 'leave_team', uid='worker2')
    assert response.status_code == 200, response.text
    current = get('contract_projects', p['id'])
    assert not any(m['worker_id'] == 'worker2' and m['status'] in ('pending', 'accepted') for m in current['team'])
    assert cw.team_capacity(current)['accepted'] == 0


def test_acceptance_rechecks_legacy_overbooked_pending_rows(api):
    seed(api); onboard(api, 'shop')
    p, _ = project(api); p, _ = notice(api, p)
    p = manual_invite(api, p).json()
    original = p['team'][0]
    p['team'].append({**original, 'id': 'legacy-other-offer', 'worker_id': 'shop', 'name': 'Other worker'})
    put('contract_projects', p['id'], p)
    response = cmd(api, p, 'accept', uid='worker2', target_id=original['id'])
    assert response.status_code == 409, response.text
    assert cw.team_capacity(get('contract_projects', p['id']))['accepted'] == 0


def test_tender_manpower_counts_registered_workers_once(api):
    seed(api); now = time.time()
    body = dict(request_id=str(uuid.uuid4()), title='Distinct worker tender', scope='Real installation requiring two separate workers',
                site='Private work site', starts_at=now + 1000, ends_at=now + 5000, budget_paise=1000000,
                sector='Electrical', city='Balasore', opens_at=now - 100, deadline=now + 500,
                manpower_needed=2, terms='Two approved agents must perform the work safely with an agreed schedule.')
    tender = api.post('/operations/contractor/tenders', headers=auth('shop'), json=body).json()
    p, _ = project(api, tender_id=tender['id'], starts_at=body['starts_at'], ends_at=body['ends_at'])
    p = manual_invite(api, p).json()
    p = cmd(api, p, 'accept', uid='worker2', target_id=p['team'][0]['id']).json()
    duplicate = copy.deepcopy(p['team'][0]); duplicate['id'] = 'legacy-duplicate'
    p['team'].append(duplicate); put('contract_projects', p['id'], p)
    response = api.post('/operations/contractor/tenders/' + tender['id'] + '/bid', headers=auth('worker'),
        json=dict(request_id=str(uuid.uuid4()), expected_version=tender['version'], project_id=p['id'],
                  amount_paise=900000, proposal='Detailed installation proposal for two agents.', accepted_terms=True))
    assert response.status_code == 409, response.text
    assert response.json()['detail']['code'] == 'TEAM_REQUIRED'
    assert get('contract_tenders', tender['id'])['bids'] == []
