"""Customers may browse real public work; professional commands require approval."""
import io
import time
import uuid

import pytest
from PIL import Image

import repaidians_network as network
from test_repaidians import api, auth, grant, photo, post, profile


@pytest.fixture
def role_api(api):
    network.initialize(api.core)
    network.install(api.core)
    profile(api)
    profile(api, 'bob')
    # This identity has no canonical worker record. Creating community state,
    # possessing a paid receipt, or choosing a profile label cannot approve it.
    response = api.get('/repaidians/state', headers=auth('customer'))
    assert response.status_code == 200
    return api


def customer_command(api, method, path, body=None, **kwargs):
    return api.request(method, path, headers=auth('customer'), json=body, **kwargs)


def test_customer_can_read_public_work_and_save_without_professional_identity(role_api):
    item = post(role_api)
    feed = role_api.get('/repaidians/feed', headers=auth('customer'))
    assert feed.status_code == 200 and [row['id'] for row in feed.json()['items']] == [item['id']]
    detail = role_api.get('/repaidians/publications/' + item['id'], headers=auth('customer'))
    assert detail.status_code == 200 and detail.json()['item']['caption'] == item['caption']
    assert role_api.get('/repaidians/members/alice', headers=auth('customer')).status_code == 200
    assert role_api.get(item['media'][0]['url'].removeprefix('/api'), headers=auth('customer')).status_code == 200
    saved = customer_command(role_api, 'PUT', '/repaidians/activity/saved/' + item['id'], {'active': True})
    assert saved.status_code == 200
    assert role_api.get('/repaidians/feed?mode=saved', headers=auth('customer')).json()['items'][0]['id'] == item['id']
    state = role_api.get('/repaidians/state', headers=auth('customer')).json()
    assert state['capabilities'] == {'professional': False, 'role': 'customer', 'communityWrite': False}
    assert state['member']['reviewed'] is False


@pytest.mark.parametrize('method,path,body', [
    ('PATCH', '/repaidians/profile', {'professionalType': 'contractor', 'headline': 'Self-claimed contractor'}),
    ('PUT', '/repaidians/activity/likes/{post}', {'active': True}),
    ('PUT', '/repaidians/follow/alice', {'active': True}),
    ('POST', '/repaidians/comments/{post}', {'text': 'Ordinary public social comment'}),
    ('POST', '/repaidians/messages/alice', {'text': 'This must be scoped to an awarded contract.'}),
    ('GET', '/repaidians/messages/alice', None),
    ('GET', '/repaidians/threads', None),
    ('POST', '/repaidians/bids/{tender}', {'note': 'Customer self-declared bid'}),
    ('GET', '/repaidians/tenders/{tender}/contact', None),
    ('POST', '/repaidians/publications', {'kind': 'tender', 'caption': 'Customer social advertising',
        'trade': 'electrician', 'visibility': 'public', 'media': [], 'title': 'Private electrical project',
        'location': 'Balasore', 'budgetRupees': 1000, 'slots': 1, 'deadline': int(time.time() * 1000) + 86400000}),
    ('PATCH', '/repaidians/network/profile', {'expectedVersion': 0, 'clientId': str(uuid.uuid4()),
        'about': 'Self-declared professional identity'}),
    ('POST', '/repaidians/network/members/alice/connection', {'action': 'request', 'expectedVersion': 0,
        'clientId': str(uuid.uuid4())}),
    ('PUT', '/repaidians/network/members/alice/endorsements', {'active': True, 'skill': 'Wiring',
        'clientId': str(uuid.uuid4())}),
])
def test_customer_trial_or_paid_subscription_never_grants_professional_commands(role_api, method, path, body):
    item = post(role_api)
    tender = post(role_api, kind='tender', title='Actual contractor work', location='Balasore', budgetRupees=1000,
                  slots=1, deadline=int(time.time() * 1000) + 86400000, contact='+919123456789')
    path = path.replace('{post}', item['id']).replace('{tender}', tender['id'])
    for paid in (False, True):
        if paid:
            grant(role_api, 'customer')
        response = customer_command(role_api, method, path, body)
        assert response.status_code == 403, (method, path, paid, response.text)
        assert response.json()['detail']['code'] == 'professional_required'
    assert role_api.core.operations_store.run(lambda u: u.get('workers', 'customer')) is None


def test_customer_cannot_upload_avatar_or_receive_generic_professional_dm(role_api):
    image = io.BytesIO(); Image.new('RGB', (16, 16), 'blue').save(image, format='JPEG')
    uploaded = role_api.post('/repaidians/media', headers={**auth('customer'), 'Content-Type': 'image/jpeg'}, content=image.getvalue())
    assert uploaded.status_code == 403 and uploaded.json()['detail']['code'] == 'professional_required'
    dm = role_api.post('/repaidians/messages/customer', headers=auth(), json={'text': 'Generic customer DM is prohibited'})
    assert dm.status_code in (403, 404), dm.text
    assert role_api.core.operations_store.run(lambda u: u.get('rp_threads', 'customer')) is None
    assert role_api.get('/repaidians/threads', headers=auth()).json()['threads'] == []


def test_customer_privacy_controls_and_reports_remain_available(role_api):
    item = post(role_api)
    reported = customer_command(role_api, 'POST', '/repaidians/reports', {'targetId': item['id'], 'reason': 'unsafe'})
    assert reported.status_code == 201
    assert customer_command(role_api, 'PATCH', '/repaidians/settings', {'messagePrivacy': 'nobody'}).status_code == 200
    assert customer_command(role_api, 'PUT', '/repaidians/blocks/alice', {'active': True}).status_code == 200
    assert role_api.get('/repaidians/feed', headers=auth('customer')).json()['items'] == []
    assert customer_command(role_api, 'PUT', '/repaidians/blocks/alice', {'active': False}).status_code == 200


def test_approval_revocation_updates_capabilities_and_closes_social_writes(role_api):
    item = post(role_api)
    state = role_api.get('/repaidians/state', headers=auth()).json()
    assert state['capabilities']['professional'] and state['capabilities']['role'] == 'agent'
    role_api.core.operations_store.run(lambda u: u.put('workers', 'alice', {**u.get('workers', 'alice'), 'status': 'pending'}))
    state = role_api.get('/repaidians/state', headers=auth()).json()
    assert state['capabilities']['role'] == 'customer' and not state['capabilities']['communityWrite']
    assert role_api.post('/repaidians/comments/' + item['id'], headers=auth(), json={'text': 'Revoked actor'}).status_code == 403
    # Removing own previously published work stays a privacy action.
    assert role_api.delete('/repaidians/publications/' + item['id'], headers=auth()).status_code == 200


@pytest.mark.parametrize('path', ['/repaidians/members/carol', '/repaidians/network/members/carol/profile'])
@pytest.mark.parametrize('status', ['approved', 'pending', 'paused'])
def test_clicked_registered_worker_profile_materializes_only_approved_safe_identity(role_api, path, status):
    assert role_api.core.operations_store.run(lambda u: u.get('rp_members', 'carol')) is None
    role_api.core.operations_store.run(lambda u: u.put('workers', 'carol', {**u.get('workers', 'carol'),
        'status': status, 'phone': '9998887776', 'home_address': 'SECRET registered worker home',
        'location': {'lat': 21.5, 'lng': 86.9}, 'fund_account_id': 'fa_SECRET_private_bank'}))
    response = role_api.get(path, headers=auth('customer'))
    if status != 'approved':
        assert response.status_code == 404, response.text
        assert role_api.core.operations_store.run(lambda u: u.get('rp_members', 'carol')) is None
        assert role_api.core.operations_store.run(lambda u: u.get('rp_trials', 'carol')) is None
    else:
        assert response.status_code == 200, response.text
        saved = role_api.core.operations_store.run(lambda u: u.get('rp_members', 'carol'))
        assert saved is not None and saved['id'] == 'carol'
        if path.startswith('/repaidians/network/'):
            assert response.json()['profile']['userId'] == 'carol'
        else:
            assert response.json()['member']['id'] == 'carol' and response.json()['member']['reviewed'] is True
        for secret in ('9998887776', 'SECRET', 'home_address', 'fund_account_id', '"location"'):
            assert secret not in response.text
