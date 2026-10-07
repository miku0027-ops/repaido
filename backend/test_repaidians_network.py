"""Real HTTP/transaction checks for professional relationships and private proof."""
import json
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest

import repaidians as social
import repaidians_network as network
from operations import Unit
from test_repaidians import api, auth, expire, profile


@pytest.fixture
def network_api(api):
    network.initialize(api.core)
    network.install(api.core)
    for uid in ('alice', 'bob', 'carol'):
        profile(api, uid)
    return api


def command(api, actor, other, action, version=None, client_id=None, **fields):
    if version is None:
        version = api.get('/repaidians/network/members/' + other + '/connection', headers=auth(actor)).json()['connection']['version']
    body = dict(action=action, expectedVersion=version, clientId=client_id or str(uuid.uuid4()), **fields)
    return api.post('/repaidians/network/members/' + other + '/connection', headers=auth(actor), json=body)


def connect(api, sender='alice', recipient='bob'):
    response = command(api, sender, recipient, 'request')
    assert response.status_code == 200, response.text
    response = command(api, recipient, sender, 'accept')
    assert response.status_code == 200, response.text
    assert response.json()['connection']['status'] == 'connected'


def rich_profile():
    return dict(expectedVersion=0, clientId=str(uuid.uuid4()), about='Professional installation and quality assurance.',
        experience=[dict(id='role-1', title='Installation supervisor', organization='Actual member employer', city='Balasore',
                         startMonth='2020-05', current=True, description='Supervised installations and documented safety checks.')],
        education=[dict(id='school-1', institution='Member-listed college', qualification='Electrical diploma',
                        fieldOfStudy='Electrical engineering', startMonth='2016-06', endMonth='2019-05', current=False)],
        certifications=[dict(id='cert-1', name='Electrical safety', issuer='Member-listed institution', issuedMonth='2021-01',
                             credentialId='MEMBER-SHARED-123', credentialUrl='https://example.org/certificates/123')],
        featured=[dict(id='link-1', title='Completed project portfolio', url='https://example.org/portfolio', description='Published project outcomes.')])


def test_resume_persists_strict_dates_public_links_retry_and_version(network_api):
    body = rich_profile()
    path = '/repaidians/network/profile'
    first = network_api.patch(path, headers=auth(), json=body)
    assert first.status_code == 200, first.text
    assert first.json()['profile']['version'] == 1
    assert network_api.patch(path, headers=auth(), json=body).json() == first.json()
    assert network_api.patch(path, headers=auth(), json={**body, 'about': 'Changed retry payload'}).status_code == 409
    assert network_api.patch(path, headers=auth(), json={**body, 'clientId': str(uuid.uuid4())}).status_code == 409
    saved = network_api.get('/repaidians/network/members/alice/profile').json()
    assert saved['profile']['experience'][0]['organization'] == 'Actual member employer'
    assert saved['profileInfoSource'] == 'member'
    assert 'private, no-store' in network_api.get(path, headers=auth()).headers['cache-control']
    assert network_api.patch(path, headers=auth(), json={**rich_profile(), 'verified': True}).status_code == 422
    bad = rich_profile(); bad['experience'][0].update(endMonth='2019-03', current=False)
    assert network_api.patch(path, headers=auth(), json=bad).status_code == 422
    bad = rich_profile(); bad['education'][0]['startMonth'] = '2020-13'
    assert network_api.patch(path, headers=auth(), json=bad).status_code == 422
    bad = rich_profile(); bad['experience'] *= 11
    assert network_api.patch(path, headers=auth(), json=bad).status_code == 422
    for url in ('javascript:alert(1)', 'http://example.org', 'https://user:password@example.org', 'https://127.0.0.1/private', 'https://localhost/secret'):
        bad = rich_profile(); bad['featured'][0]['url'] = url
        assert network_api.patch(path, headers=auth(), json=bad).status_code == 422, url


def test_resume_connections_only_does_not_expose_private_sections(network_api):
    body = rich_profile(); body['visibility'] = 'connections'
    assert network_api.patch('/repaidians/network/profile', headers=auth(), json=body).status_code == 200
    guest = network_api.get('/repaidians/network/members/alice/profile').json()
    assert guest['profile'] is None and guest['endorsements']['items'] == guest['recommendations']['items'] == []
    outsider = network_api.get('/repaidians/network/members/alice/profile', headers=auth('bob')).json()
    assert outsider['profile'] is None and outsider['connection']['canRequest'] is True
    connect(network_api)
    assert network_api.get('/repaidians/network/members/alice/profile', headers=auth('bob')).json()['profile']['about'] == body['about']
    assert command(network_api, 'bob', 'alice', 'remove').status_code == 200
    assert network_api.get('/repaidians/network/members/alice/profile', headers=auth('bob')).json()['profile'] is None


def test_mutual_connection_requests_roles_retry_counts_and_private_lists(network_api):
    key = str(uuid.uuid4())
    first = command(network_api, 'alice', 'bob', 'request', version=0, client_id=key, note='We worked on a maintenance project.')
    assert first.status_code == 200 and first.json()['connection']['status'] == 'outgoing'
    again = command(network_api, 'alice', 'bob', 'request', version=0, client_id=key, note='We worked on a maintenance project.')
    assert again.json() == first.json()
    notes = network_api.get('/repaidians/notifications', headers=auth('bob')).json()['notifications']
    assert len([row for row in notes if row['type'] == 'connection']) == 1
    assert command(network_api, 'alice', 'bob', 'accept').status_code == 403
    assert command(network_api, 'carol', 'bob', 'accept', version=0).status_code == 409
    incoming = network_api.get('/repaidians/network/connections?mode=incoming', headers=auth('bob')).json()
    assert [row['memberId'] for row in incoming['items']] == ['alice']
    assert incoming['items'][0]['note'] == 'We worked on a maintenance project.'
    public = network_api.get('/repaidians/network/members/bob/profile').json()
    assert public['connection']['status'] == 'anonymous' and 'maintenance project' not in json.dumps(public)
    assert network_api.get('/repaidians/network/connections').status_code == 401
    accept_key = str(uuid.uuid4())
    accepted = command(network_api, 'bob', 'alice', 'accept', version=1, client_id=accept_key)
    assert accepted.status_code == 200
    assert command(network_api, 'bob', 'alice', 'accept', version=1, client_id=accept_key).json() == accepted.json()
    for uid in ('alice', 'bob'):
        own = network_api.get('/repaidians/network/connections', headers=auth(uid)).json()
        assert len(own['items']) == own['connectionsCount'] == 1
    assert command(network_api, 'alice', 'bob', 'remove').status_code == 200
    assert network_api.get('/repaidians/network/connections', headers=auth('bob')).json()['connectionsCount'] == 0


def test_decline_cancel_and_privacy_epoch_do_not_resurrect_invitations(network_api, monkeypatch):
    assert command(network_api, 'alice', 'bob', 'request').status_code == 200
    assert command(network_api, 'bob', 'alice', 'cancel').status_code == 403
    assert command(network_api, 'bob', 'alice', 'decline').status_code == 200
    assert command(network_api, 'alice', 'bob', 'request').status_code == 429
    clock = social.now_ms() + 86400001
    monkeypatch.setattr(social, 'now_ms', lambda: clock)
    assert command(network_api, 'alice', 'bob', 'request').status_code == 200
    assert command(network_api, 'alice', 'bob', 'cancel').status_code == 200
    assert command(network_api, 'alice', 'bob', 'request').status_code == 200
    prefs = '/repaidians/network/preferences'
    assert network_api.patch(prefs, headers=auth('bob'), json={'connectionPrivacy': 'nobody'}).status_code == 200
    assert network_api.get('/repaidians/network/connections?mode=incoming', headers=auth('bob')).json()['items'] == []
    assert command(network_api, 'bob', 'alice', 'accept').status_code == 409
    assert command(network_api, 'carol', 'bob', 'request').status_code == 403
    assert network_api.patch(prefs, headers=auth('bob'), json={'connectionPrivacy': 'everyone'}).status_code == 200
    assert network_api.get('/repaidians/network/members/alice/connection', headers=auth('bob')).json()['connection']['status'] == 'none'
    assert command(network_api, 'alice', 'bob', 'request').status_code == 200


def endorse(api, uid='alice', other='bob', skill='Electrical installation', active=True, key=None):
    return api.put('/repaidians/network/members/' + other + '/endorsements', headers=auth(uid),
                   json={'skill': skill, 'active': active, 'clientId': key or str(uuid.uuid4())})


def test_endorsements_require_connection_real_listed_skill_and_revoke_on_reconnect(network_api):
    network_api.patch('/repaidians/profile', headers=auth('bob'), json={'skills': ['Electrical installation', 'Quality assurance']})
    assert endorse(network_api).status_code == 403
    connect(network_api)
    assert endorse(network_api, uid='bob', other='bob').status_code == 422
    assert endorse(network_api, skill='Invented leadership certification').status_code == 422
    key = str(uuid.uuid4())
    first = endorse(network_api, key=key)
    assert first.status_code == 200 and endorse(network_api, key=key).json() == first.json()
    public = network_api.get('/repaidians/network/members/bob/profile').json()
    assert [row['authorId'] for row in public['endorsements']['items']] == ['alice']
    own_view = network_api.get('/repaidians/network/members/bob/profile', headers=auth()).json()
    assert own_view['endorsements']['viewerEndorsed'] == ['Electrical installation']
    assert command(network_api, 'bob', 'alice', 'remove').status_code == 200
    assert network_api.get('/repaidians/network/members/bob/profile').json()['endorsements']['items'] == []
    connect(network_api)
    assert network_api.get('/repaidians/network/members/bob/profile').json()['endorsements']['items'] == []
    assert endorse(network_api).status_code == 200
    network_api.patch('/repaidians/profile', headers=auth('bob'), json={'skills': ['Quality assurance']})
    assert network_api.get('/repaidians/network/members/bob/profile').json()['endorsements']['items'] == []


def test_proof_consent_off_on_requires_new_endorsement_and_recommendation(network_api):
    network_api.patch('/repaidians/profile', headers=auth('bob'), json={'skills': ['Electrical installation']})
    connect(network_api)
    assert endorse(network_api).status_code == 200
    recommendation = network_api.post('/repaidians/network/members/bob/recommendations', headers=auth(),
        json={'text': 'We completed a project together with careful safety checks.', 'relationship': 'Project colleague', 'clientId': str(uuid.uuid4())}).json()['recommendation']
    prefs = '/repaidians/network/preferences'
    network_api.patch(prefs, headers=auth('bob'), json={'allowEndorsements': False, 'allowRecommendations': False})
    network_api.patch(prefs, headers=auth('bob'), json={'allowEndorsements': True, 'allowRecommendations': True})
    public = network_api.get('/repaidians/network/members/bob/profile').json()
    assert public['endorsements']['items'] == public['recommendations']['items'] == []
    assert network_api.put('/repaidians/network/recommendations/' + recommendation['id'], headers=auth('bob'),
        json={'action': 'approve', 'expectedVersion': recommendation['version'], 'clientId': str(uuid.uuid4())}).status_code == 409
    assert endorse(network_api).status_code == 200


def test_recommendation_recipient_approval_writer_retraction_and_actor_authorization(network_api):
    connect(network_api)
    path = '/repaidians/network/members/bob/recommendations'
    body = {'text': 'We worked together on documented installations and safety reviews.', 'relationship': 'Project colleague', 'clientId': str(uuid.uuid4())}
    first = network_api.post(path, headers=auth(), json=body)
    assert first.status_code == 201
    assert network_api.post(path, headers=auth(), json=body).json() == first.json()
    row = first.json()['recommendation']
    assert network_api.get('/repaidians/network/members/bob/profile').json()['recommendations']['items'] == []
    assert network_api.get('/repaidians/network/recommendations?mode=pending', headers=auth('bob')).json()['items'][0]['id'] == row['id']
    command_path = '/repaidians/network/recommendations/' + row['id']
    approve = {'action': 'approve', 'expectedVersion': row['version'], 'clientId': str(uuid.uuid4())}
    assert network_api.put(command_path, headers=auth(), json=approve).status_code == 403
    assert network_api.put(command_path, headers=auth('carol'), json=approve).status_code == 404
    approved = network_api.put(command_path, headers=auth('bob'), json=approve)
    assert approved.status_code == 200
    assert network_api.put(command_path, headers=auth('bob'), json=approve).json() == approved.json()
    public = network_api.get('/repaidians/network/members/bob/recommendations').json()
    assert public['items'][0]['text'] == body['text'] and public['items'][0]['status'] == 'approved'
    assert network_api.post(path, headers=auth(), json={**body, 'clientId': str(uuid.uuid4())}).status_code == 409
    row = approved.json()['recommendation']
    retract = {'action': 'retract', 'expectedVersion': row['version'], 'clientId': str(uuid.uuid4())}
    assert network_api.put(command_path, headers=auth('bob'), json=retract).status_code == 403
    assert network_api.put(command_path, headers=auth(), json=retract).status_code == 200
    assert network_api.get('/repaidians/network/members/bob/recommendations').json()['items'] == []
    assert network_api.post(path, headers=auth(), json={**body, 'recipientId': 'carol'}).status_code == 422


def test_block_hides_proof_and_disconnect_cannot_be_restored_by_unblock(network_api):
    connect(network_api)
    network_api.patch('/repaidians/profile', headers=auth('bob'), json={'skills': ['Electrical installation']})
    assert endorse(network_api).status_code == 200
    assert network_api.put('/repaidians/blocks/alice', headers=auth('bob'), json={'active': True}).status_code == 200
    # A repeated block is harmless and cannot decrement counters twice.
    assert network_api.put('/repaidians/blocks/alice', headers=auth('bob'), json={'active': True}).status_code == 200
    assert network_api.get('/repaidians/network/members/bob/profile', headers=auth()).status_code == 404
    assert network_api.get('/repaidians/network/connections', headers=auth()).json()['items'] == []
    assert network_api.get('/repaidians/network/members/bob/profile').json()['endorsements']['items'] == []
    assert network_api.put('/repaidians/blocks/alice', headers=auth('bob'), json={'active': False}).status_code == 200
    assert network_api.get('/repaidians/network/members/bob/connection', headers=auth()).json()['connection']['status'] == 'none'
    assert network_api.get('/repaidians/network/connections', headers=auth('bob')).json()['connectionsCount'] == 0


def test_bounded_account_bound_network_cursors_advance_over_dead_entries(network_api, monkeypatch):
    clock = social.now_ms()
    def seed(u):
        for index in range(70):
            uid = 'fixture-' + str(index)
            social.member_ensure(u, {'id': uid, 'name': 'Persisted test professional'})
            row = dict(id=network.pair_key('alice', uid), senderId='alice', recipientId=uid, note='',
                       status='removed' if index < 64 else 'accepted', generation=1, version=1,
                       createdAt=clock - index, updatedAt=clock - index)
            network.save_connection(u, row)
    network_api.core.operations_store.run(seed)
    monkeypatch.setattr(Unit, 'all', lambda *args: (_ for _ in ()).throw(AssertionError('Unbounded scan')))
    monkeypatch.setattr(Unit, 'find', lambda *args: (_ for _ in ()).throw(AssertionError('Unbounded equality scan')))
    first = network_api.get('/repaidians/network/connections?limit=2', headers=auth()).json()
    assert first['items'] == [] and first['nextCursor']
    second = network_api.get('/repaidians/network/connections', params={'limit': 2, 'cursor': first['nextCursor']}, headers=auth()).json()
    assert len(second['items']) == 2
    assert network_api.get('/repaidians/network/connections', params={'cursor': first['nextCursor']}, headers=auth('bob')).status_code == 422
    assert network_api.get('/repaidians/network/connections', params={'cursor': first['nextCursor'], 'mode': 'incoming'}, headers=auth()).status_code == 422
    assert network_api.get('/repaidians/network/connections?limit=1000', headers=auth()).status_code == 422


def test_expired_trial_stops_new_network_but_preserves_privacy_removal(network_api):
    connect(network_api)
    expire(network_api)
    assert network_api.get('/repaidians/network/connections', headers=auth()).status_code == 402
    assert command(network_api, 'alice', 'carol', 'request', version=0).status_code == 402
    assert network_api.patch('/repaidians/network/preferences', headers=auth(), json={'connectionPrivacy': 'nobody'}).status_code == 200
    assert command(network_api, 'alice', 'bob', 'remove', version=2).status_code == 200
    assert network_api.get('/repaidians/network/preferences', headers=auth()).status_code == 200


def test_expired_owner_can_read_and_hide_resume_but_cannot_publish_or_edit(network_api):
    assert network_api.patch('/repaidians/network/profile', headers=auth(), json=rich_profile()).status_code == 200
    expire(network_api)
    own = network_api.get('/repaidians/network/profile', headers=auth())
    assert own.status_code == 200 and own.json()['profile']['version'] == 1
    assert own.json()['profile']['experience'][0]['title'] == 'Installation supervisor'
    hidden = network_api.patch('/repaidians/network/profile', headers=auth(),
        json={'expectedVersion': 1, 'clientId': str(uuid.uuid4()), 'visibility': 'connections'})
    assert hidden.status_code == 200 and hidden.json()['profile']['version'] == 2
    assert network_api.get('/repaidians/network/members/alice/profile').json()['profile'] is None
    assert network_api.patch('/repaidians/network/profile', headers=auth(),
        json={'expectedVersion': 2, 'clientId': str(uuid.uuid4()), 'visibility': 'public'}).status_code == 402
    assert network_api.patch('/repaidians/network/profile', headers=auth(),
        json={'expectedVersion': 2, 'clientId': str(uuid.uuid4()), 'visibility': 'connections', 'about': 'Changing published career content'}).status_code == 402
    assert network_api.get('/repaidians/network/profile').status_code == 401


def test_concurrent_accept_retries_create_one_relationship_and_one_counter(network_api):
    assert command(network_api, 'alice', 'bob', 'request').status_code == 200
    key = str(uuid.uuid4())
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: command(network_api, 'bob', 'alice', 'accept', version=1, client_id=key), range(4)))
    assert all(response.status_code == 200 for response in results)
    assert len({json.dumps(response.json(), sort_keys=True) for response in results}) == 1
    for uid in ('alice', 'bob'):
        assert network_api.get('/repaidians/network/connections', headers=auth(uid)).json()['connectionsCount'] == 1


def test_connection_rate_limit_rolls_back_without_extra_invitations(network_api):
    def throttle(u):
        u.put('rp_rate', social.digest('alice:network-connection'), {'window': social.now_ms(), 'count': 30})
    network_api.core.operations_store.run(throttle)
    assert command(network_api, 'alice', 'bob', 'request').status_code == 429
    assert network_api.get('/repaidians/network/connections?mode=incoming', headers=auth('bob')).json()['items'] == []
    assert command(network_api, 'alice', 'alice', 'request', version=0).status_code == 422
    assert network_api.post('/repaidians/network/members/bob/connection', json={'action': 'request', 'expectedVersion': 0, 'clientId': str(uuid.uuid4())}).status_code == 401
