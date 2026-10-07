"""Real HTTP/transaction/media integration against an isolated durable store."""
import io
import sqlite3
import time
import uuid
from contextlib import contextmanager
from datetime import datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI, Header, HTTPException
from fastapi.testclient import TestClient
from PIL import Image

import repaidians as social
from operations import Store, Unit


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.delenv('REPAIDO_COMMUNITY_BUCKET', raising=False)
    monkeypatch.delenv('REPAIDO_KYC_BUCKET', raising=False)
    monkeypatch.setenv('REPAIDO_COMMUNITY_MEDIA_DIR', str(tmp_path / 'private-media'))
    path = str(tmp_path / 'social.db')
    @contextmanager
    def db():
        c = sqlite3.connect(path)
        c.row_factory = sqlite3.Row
        try:
            yield c
            c.commit()
        finally:
            c.close()
    def current_user(authorization: str = Header(default='')):
        uid = authorization.removeprefix('Bearer ')
        if uid not in ('alice', 'bob', 'carol', 'customer'):
            raise HTTPException(401, 'Invalid test session')
        return {'id': uid, 'name': uid.title() + ' Professional'}
    def operator(x_admin_key: str = Header(default='')):
        if x_admin_key != 'test-community-operator':
            raise HTTPException(403, 'Operator required')
        return {'id': 'test-operator'}
    core = SimpleNamespace(DB_PATH=path, USE_FIRESTORE=False, db=db, current_user=current_user, operator=operator, app=FastAPI())
    core.operations_store = Store(core)
    core.operations_store.init()
    # Social mutations use the canonical approved partner record, never a
    # self-selected profile role. Keep a fourth account as a real customer.
    def approved_professionals(u):
        for uid in ('alice', 'bob', 'carol'):
            u.put('workers', uid, {'id': uid, 'name': uid.title() + ' Professional',
                    'status': 'approved', 'role': 'technician', 'categories': ['electrician'],
                    'city': 'Balasore', 'skills': [], 'experience_years': 0})
    core.operations_store.run(approved_professionals)
    social.initialize(core)
    social.install(core)
    with TestClient(core.app) as client:
        client.core = core
        yield client


def auth(uid='alice'):
    return {'Authorization': 'Bearer ' + uid}


def grant(api, uid='alice'):
    stamp = int(time.time() * 1000)
    api.core.operations_store.run(lambda u: u.put('rp_subscriptions', uid, {
        'userId': uid, 'status': 'active', 'plan': 'pro', 'provider': 'razorpay',
        'amountPaise': 19900, 'startsAt': stamp - 1000, 'endsAt': stamp + 86400000,
    }))


def expire(api, uid='alice'):
    stamp = social.now_ms()
    api.core.operations_store.run(lambda u: u.put('rp_trials', uid, {
        'userId': uid, 'startsAt': stamp - 31 * 86400000, 'endsAt': stamp - 86400000,
        'policy': 'repaidians-trial-30d-v1',
    }))


def profile(api, uid='alice', trade='electrician'):
    r = api.patch('/repaidians/profile', headers=auth(uid), json={'trade': trade})
    assert r.status_code == 200, r.text
    return r.json()['member']


def photo(api, uid='alice'):
    output = io.BytesIO()
    Image.new('RGB', (24, 24), '#ad1575').save(output, format='JPEG')
    r = api.post('/repaidians/media', headers={**auth(uid), 'Content-Type': 'image/jpeg'}, content=output.getvalue())
    assert r.status_code == 201, r.text
    return {k: r.json()[k] for k in ('url', 'kind', 'alt')}


def post(api, uid='alice', media=None, visibility='public', kind='post', **kwargs):
    body = {'kind': kind, 'caption': 'Real completed installation', 'trade': 'electrician',
            'visibility': visibility, 'media': [] if kind == 'tender' else [media or photo(api, uid)]}
    body.update(kwargs)
    r = api.post('/repaidians/publications', headers=auth(uid), json=body)
    assert r.status_code == 201, r.text
    return r.json()['item']


def test_empty_genuine_feed_guests_cookie_auth_and_pro_gate(api):
    r = api.get('/repaidians/state')
    assert r.status_code == 200
    snapshot = r.json()
    assert snapshot['authenticated'] is False and snapshot['remainingMs'] == 900000
    assert snapshot['data']['members'] == snapshot['data']['posts'] == snapshot['data']['stories'] == []
    assert 'HttpOnly' in r.headers['set-cookie'] and 'SameSite=lax' in r.headers['set-cookie']
    assert r.headers['set-cookie'].startswith('__session=')
    assert api.get('/repaidians/state', headers=auth('forged')).status_code == 401
    assert api.post('/repaidians/publications', json={
        'kind': 'post', 'caption': 'Forged', 'trade': 'electrician', 'visibility': 'public', 'media': [],
    }).status_code == 401
    assert api.post('/repaidians/media', headers={**auth(), 'Content-Type': 'image/jpeg'}, content=b'invalid').status_code == 422
    assert api.patch('/repaidians/profile', headers=auth(), json={'reviewed': True}).status_code == 422
    assert api.get('/repaidians/state', headers=auth()).json()['member']['reviewed'] is True


def test_guest_heartbeat_shared_budget_no_client_time_and_ist_reset(api, monkeypatch):
    clock = [int(datetime(2026, 10, 6, 23, 58, tzinfo=ZoneInfo('Asia/Kolkata')).timestamp() * 1000)]
    monkeypatch.setattr(social, 'now_ms', lambda: clock[0])
    first = api.get('/repaidians/state')
    token = first.cookies['__session']
    assert api.post('/repaidians/usage', json={'active': True}).json()['remainingMs'] == 900000
    clock[0] += 7000
    assert api.post('/repaidians/usage', json={'active': True}).json()['remainingMs'] == 893000
    assert api.post('/repaidians/usage', json={'active': True}).json()['remainingMs'] == 893000
    assert api.post('/repaidians/usage', json={'active': True, 'durationMs': -900000}).status_code == 422
    # Pausing stops renewal but never refunds a prepaid 15-second slice.
    clock[0] += 60000
    assert api.post('/repaidians/usage', json={'active': False}).json()['remainingMs'] == 885000
    subject = 'guest_' + social.digest(token)
    day = datetime.fromtimestamp(clock[0] / 1000, social.IST).date().isoformat()
    api.core.operations_store.run(lambda u: u.put('rp_usage', subject, {'day': day, 'usedMs': 900000, 'leaseUntil': clock[0] - 1}))
    assert api.get('/repaidians/feed').status_code == 402
    assert api.get('/repaidians/state').json()['data']['posts'] == []
    # A different preview cookie has its own authoritative counter.
    with TestClient(api.core.app) as other:
        assert other.get('/repaidians/state').json()['remainingMs'] == 900000
    clock[0] = int(datetime(2026, 10, 7, 0, 0, tzinfo=social.IST).timestamp() * 1000)
    assert api.get('/repaidians/state').json()['remainingMs'] == 900000


def test_trade_visibility_owner_media_and_verified_identity(api):
    grant(api)
    grant(api, 'bob')
    alice = profile(api)
    profile(api, 'bob', 'electrician')
    profile(api, 'carol', 'cleaning')
    asset = photo(api)
    item = post(api, media=asset, visibility='trade')
    assert api.get('/repaidians/feed').json()['items'] == []
    assert api.get('/repaidians/feed', headers=auth('carol')).json()['items'] == []
    assert api.get('/repaidians/feed', headers=auth('bob')).json()['items'][0]['id'] == item['id']
    path = asset['url'].removeprefix('/api')
    assert api.get(path).status_code == 404
    assert api.get(path, headers=auth('carol')).status_code == 404
    assert api.get(path, headers=auth('bob')).status_code == 200
    assert api.get('/repaidians/members/alice', headers=auth('carol')).json()['stats']['posts'] == 0
    assert api.get('/repaidians/members/alice', headers=auth('bob')).json()['stats']['posts'] == 1
    stolen = api.post('/repaidians/publications', headers=auth('bob'), json={
        'kind': 'post', 'caption': 'Stolen', 'trade': 'electrician', 'visibility': 'public', 'media': [asset],
    })
    assert stolen.status_code == 422
    api.core.operations_store.run(lambda u: u.put('workers', 'bob', {'id': 'bob', 'name': alice['name'], 'status': 'approved', 'role': 'specialist', 'completed_tasks': 9, 'rating_sum': 18, 'rating_count': 4}))
    # Revocation leaves existing public work readable, but no name-based
    # badge transfer or old approval should survive in the public profile.
    api.core.operations_store.run(lambda u: u.put('workers', 'alice', {**u.get('workers', 'alice'), 'status': 'pending'}))
    assert api.get('/repaidians/members/alice').json()['member']['reviewed'] is False
    bob = api.get('/repaidians/members/bob').json()['member']
    assert bob['reviewed'] is True and bob['completedTasks'] == 9 and bob['rating'] == 4.5


def test_transactional_likes_follow_comments_notifications_and_retry(api):
    grant(api)
    profile(api)
    profile(api, 'bob')
    item = post(api)
    path = '/repaidians/activity/likes/' + item['id']
    assert api.put(path, headers=auth('bob'), json={'active': True}).json()['likeCount'] == 1
    assert api.put(path, headers=auth('bob'), json={'active': True}).json()['likeCount'] == 1
    feed = api.get('/repaidians/feed', headers=auth('bob')).json()['items'][0]
    assert feed['liked'] is True and feed['saved'] is False
    assert api.put('/repaidians/activity/saved/' + item['id'], headers=auth('bob'), json={'active': True}).status_code == 200
    assert api.get('/repaidians/feed?mode=saved', headers=auth('bob')).json()['items'][0]['id'] == item['id']
    body = {'text': 'Great installation', 'clientId': str(uuid.uuid4())}
    first = api.post('/repaidians/comments/' + item['id'], headers=auth('bob'), json=body)
    again = api.post('/repaidians/comments/' + item['id'], headers=auth('bob'), json=body)
    assert first.status_code == 201 and again.json() == first.json()
    assert api.post('/repaidians/comments/' + item['id'], headers=auth('bob'), json={**body, 'text': 'Changed'}).status_code == 409
    assert len(api.get('/repaidians/comments/' + item['id']).json()['comments']) == 1
    assert api.put('/repaidians/follow/alice', headers=auth('bob'), json={'active': True}).json()['followersCount'] == 1
    assert api.put('/repaidians/follow/alice', headers=auth('bob'), json={'active': True}).json()['followersCount'] == 1
    assert api.get('/repaidians/feed?mode=following', headers=auth('bob')).json()['items'][0]['id'] == item['id']
    notifications = api.get('/repaidians/notifications', headers=auth()).json()['notifications']
    assert {row['type'] for row in notifications} == {'like', 'comment', 'follow'}
    assert api.get('/repaidians/notifications', headers=auth('carol')).json()['notifications'] == []
    assert api.post('/repaidians/notifications/read', headers=auth(), json={'ids': [row['id'] for row in notifications]}).status_code == 200
    assert all(row['read'] for row in api.get('/repaidians/notifications', headers=auth()).json()['notifications'])
    assert api.put(path, headers=auth('bob'), json={'active': False}).json()['likeCount'] == 0


def test_interests_require_identity_and_recheck_activity_privacy_and_blocks(api):
    profile(api)
    profile(api, 'bob')
    item = post(api, visibility='trade')
    path = '/repaidians/activity/likes/' + item['id']
    assert api.get('/repaidians/feed?mode=liked').status_code == 401
    assert api.put(path, headers=auth('bob'), json={'active': True}).status_code == 200
    assert api.get('/repaidians/feed?mode=liked', headers=auth('bob')).json()['items'][0]['id'] == item['id']
    # Interest never overrides a later trade change or member block.
    profile(api, 'bob', 'plumber')
    assert api.get('/repaidians/feed?mode=liked', headers=auth('bob')).json()['items'] == []
    profile(api, 'bob')
    assert api.put('/repaidians/blocks/alice', headers=auth('bob'), json={'active': True}).status_code == 200
    assert api.get('/repaidians/feed?mode=liked', headers=auth('bob')).json()['items'] == []


def test_ready_status_partial_patch_preserves_identity_and_professional_fields(api):
    initial = api.patch('/repaidians/profile', headers=auth(), json={
        'name': 'Alice Electrical', 'handle': 'alice.electrical', 'trade': 'electrician',
        'city': 'Balasore', 'skills': ['Wiring'], 'headline': 'Electrical installations',
    }).json()['member']
    changed = api.patch('/repaidians/profile', headers=auth(), json={'workStatus': 'open_to_work'}).json()['member']
    assert changed['workStatus'] == 'open_to_work'
    for field in ('name', 'handle', 'trade', 'city', 'skills', 'headline'):
        assert changed[field] == initial[field]
    assert api.get('/repaidians/members?workStatus=open_to_work').json()['members'][0]['id'] == 'alice'


def test_real_two_sided_messages_pro_send_thread_isolation_and_blocks(api):
    grant(api)
    profile(api)
    profile(api, 'bob')
    profile(api, 'carol')
    payload = {'text': 'Can we work on this project?', 'clientId': str(uuid.uuid4())}
    first = api.post('/repaidians/messages/bob', headers=auth(), json=payload)
    assert first.status_code == 201, first.text
    assert api.post('/repaidians/messages/bob', headers=auth(), json=payload).json() == first.json()
    message = api.get('/repaidians/messages/alice', headers=auth('bob')).json()['messages'][0]
    assert message['senderId'] == 'alice' and message['recipientId'] == 'bob'
    assert api.get('/repaidians/messages/bob', headers=auth('carol')).json()['messages'] == []
    assert api.get('/repaidians/threads', headers=auth('bob')).json()['threads'][0]['recipientId'] == 'alice'
    assert api.post('/repaidians/messages/alice', headers=auth('bob'), json={'text': 'Trial member reply'}).status_code == 201
    assert api.put('/repaidians/blocks/alice', headers=auth('bob'), json={'active': True}).status_code == 200
    assert api.get('/repaidians/messages/alice', headers=auth('bob')).status_code == 404
    assert api.post('/repaidians/messages/bob', headers=auth(), json={'text': 'Blocked'}).status_code == 404
    assert api.get('/repaidians/threads', headers=auth()).json()['threads'] == []
    assert api.get('/repaidians/members/alice', headers=auth('bob')).status_code == 404


def test_inbox_skips_unavailable_participants_without_hiding_older_conversations(api, monkeypatch):
    profile(api)
    profile(api, 'bob')
    profile(api, 'carol')
    stamp = social.now_ms()
    monkeypatch.setattr(social, 'now_ms', lambda: stamp)
    assert api.post('/repaidians/messages/bob', headers=auth(), json={'text': 'Older available conversation'}).status_code == 201
    monkeypatch.setattr(social, 'now_ms', lambda: stamp + 1000)
    assert api.post('/repaidians/messages/carol', headers=auth(), json={'text': 'Recent unavailable conversation'}).status_code == 201
    api.core.operations_store.run(lambda u: u.put('workers', 'carol', {**u.get('workers', 'carol'), 'status': 'pending'}))

    # A removed approval must not leave a visible inbox that opens a 404, nor
    # consume the first display slot and conceal an older available peer.
    assert api.get('/repaidians/messages/carol', headers=auth()).status_code == 404
    response = api.get('/repaidians/threads?limit=1', headers=auth())
    assert response.status_code == 200, response.text
    data = response.json()
    assert [thread['recipientId'] for thread in data['threads']] == ['bob']
    assert [member['id'] for member in data['members']] == ['bob']
    assert data['nextCursor'] is None
    assert response.headers['cache-control'] == 'private, no-store'
    conversation = api.get('/repaidians/messages/bob', headers=auth())
    assert conversation.headers['cache-control'] == 'private, no-store'
    assert conversation.json()['messages'][0]['text'] == 'Older available conversation'

    # Filtering the list never deletes the private conversation. Reapproval
    # restores the same messages; another signed identity cannot read them.
    api.core.operations_store.run(lambda u: u.put('workers', 'carol', {**u.get('workers', 'carol'), 'status': 'approved'}))
    restored = api.get('/repaidians/threads?limit=1', headers=auth()).json()
    assert [thread['recipientId'] for thread in restored['threads']] == ['carol']
    assert restored['nextCursor']
    second = api.get('/repaidians/threads?limit=1&cursor=' + restored['nextCursor'], headers=auth()).json()
    assert [thread['recipientId'] for thread in second['threads']] == ['bob']
    assert api.get('/repaidians/messages/carol', headers=auth()).json()['messages'][0]['text'] == 'Recent unavailable conversation'
    assert api.get('/repaidians/messages/alice', headers=auth('bob')).json()['messages'][0]['text'] == 'Older available conversation'
    assert api.get('/repaidians/messages/bob', headers=auth('carol')).json()['messages'] == []


def test_legacy_customer_inbox_rows_never_open_generic_customer_messages(api):
    profile(api)
    profile(api, 'bob')
    assert api.get('/repaidians/state', headers=auth('customer')).status_code == 200
    assert api.post('/repaidians/messages/bob', headers=auth(), json={'text': 'Available professional message'}).status_code == 201
    stamp = social.now_ms() + 1000
    def legacy(u):
        # Launch-era memberships allowed customer DMs. Keeping such a durable
        # summary after the professional-role policy changed cannot authorize it.
        u.put(social.lane('rp_threads', 'alice'), 'customer', {
            'id': 'customer', 'recipientId': 'customer', 'lastMessage': 'Legacy private customer message',
            'lastSenderId': 'customer', 'updatedAt': stamp, 'sortKey': social.sort_key(stamp, 'customer'),
        })
        bob = u.get('rp_members', 'bob')
        bob['settings'] = None
        u.put('rp_members', 'bob', bob)
    api.core.operations_store.run(legacy)
    response = api.get('/repaidians/threads', headers=auth())
    assert [row['recipientId'] for row in response.json()['threads']] == ['bob']
    assert 'Legacy private customer message' not in response.text
    assert all(member['id'] != 'customer' for member in response.json()['members'])
    assert api.get('/repaidians/messages/customer', headers=auth()).status_code == 404
    assert api.post('/repaidians/messages/customer', headers=auth(), json={'text': 'Forbidden generic DM'}).status_code == 404
    # Old profile settings omitted or stored as null use the established default
    # privacy policy instead of causing a server error in a valid conversation.
    assert api.post('/repaidians/messages/bob', headers=auth(), json={'text': 'A real professional reply'}).status_code == 201


def test_tender_contact_never_in_public_snapshot_bids_durable_owner_only(api):
    grant(api)
    profile(api)
    profile(api, 'bob')
    tender = post(api, kind='tender',
                  title='Apartment rewiring', location='Balasore', budgetRupees=24000, slots=3,
                  deadline=int(time.time() * 1000) + 86400000, contact='+919876543210')
    assert tender['contact'] == '' and '+919876543210' not in api.get('/repaidians/state').text
    expire(api, 'bob')
    assert api.get('/repaidians/tenders/' + tender['id'] + '/contact', headers=auth('bob')).status_code == 402
    assert api.post('/repaidians/bids/' + tender['id'], headers=auth('bob'), json={}).status_code == 402
    grant(api, 'bob')
    assert api.get('/repaidians/tenders/' + tender['id'] + '/contact', headers=auth('bob')).json()['contact'] == '+919876543210'
    body = {'note': 'Experienced electrician crew', 'clientId': str(uuid.uuid4())}
    bid = api.post('/repaidians/bids/' + tender['id'], headers=auth('bob'), json=body)
    assert bid.status_code == 201
    assert api.post('/repaidians/bids/' + tender['id'], headers=auth('bob'), json=body).json() == bid.json()
    assert api.get('/repaidians/bids/' + tender['id'], headers=auth('bob')).status_code == 404
    assert len(api.get('/repaidians/bids/' + tender['id'], headers=auth()).json()['bids']) == 1
    assert api.get('/repaidians/feed?kind=tender').json()['items'][0]['bidCount'] == 1
    # A refunded/expired entitlement immediately gates sending and contact.
    api.core.operations_store.run(lambda u: u.put('rp_subscriptions', 'bob', {'status': 'refunded'}))
    assert api.get('/repaidians/tenders/' + tender['id'] + '/contact', headers=auth('bob')).status_code == 402


def test_publication_retry_delete_story_expiry_and_private_media(api, monkeypatch):
    grant(api)
    profile(api)
    asset = photo(api)
    payload = {'kind': 'post', 'caption': 'Install', 'trade': 'electrician', 'visibility': 'public', 'media': [asset], 'clientId': str(uuid.uuid4())}
    first = api.post('/repaidians/publications', headers=auth(), json=payload)
    assert first.status_code == 201
    assert api.post('/repaidians/publications', headers=auth(), json=payload).json() == first.json()
    assert api.post('/repaidians/publications', headers=auth(), json={**payload, 'caption': 'Changed'}).status_code == 409
    path = asset['url'].removeprefix('/api')
    assert api.get(path).status_code == 200
    item_id = first.json()['item']['id']
    assert api.delete('/repaidians/publications/' + item_id, headers=auth('bob')).status_code == 404
    assert api.delete('/repaidians/publications/' + item_id, headers=auth()).status_code == 200
    assert api.get('/repaidians/feed').json()['items'] == []
    assert api.get(path).status_code == 404
    story = post(api, media=asset, kind='story')
    assert api.get('/repaidians/feed?kind=story').json()['items'][0]['id'] == story['id']
    monkeypatch.setattr(social, 'now_ms', lambda: story['expiresAt'] + 1)
    assert api.get('/repaidians/feed?kind=story').json()['items'] == []
    assert api.get(path).status_code == 404
    assert api.get(path, headers=auth()).status_code == 200


def test_indexed_bounded_pagination_search_and_no_social_collection_scan(api, monkeypatch):
    grant(api)
    profile(api)
    profile(api, 'bob')
    asset = photo(api)
    ids = {post(api, media=asset, caption=f'Installation {i}')['id'] for i in range(11)}
    monkeypatch.setattr(Unit, 'all', lambda *_: (_ for _ in ()).throw(AssertionError('Unbounded collection scan')))
    seen, cursor = [], ''
    for _ in range(8):
        page = api.get('/repaidians/feed', params={'limit': 3, 'cursor': cursor}).json()
        seen += [item['id'] for item in page['items']]
        cursor = page['nextCursor']
        if not cursor:
            break
    assert len(seen) == len(set(seen)) == 11 and set(seen) == ids
    assert api.get('/repaidians/feed?limit=10000').status_code == 422
    assert api.get('/repaidians/feed?cursor=broken').status_code == 422
    search = api.get('/repaidians/members?search=alice').json()['members']
    assert [member['id'] for member in search] == ['alice']
    assert api.patch('/repaidians/profile', headers=auth(), json={'name': 'First Surname'}).status_code == 200
    assert api.get('/repaidians/members?search=first').json()['members'][0]['id'] == 'alice'
    assert api.patch('/repaidians/profile', headers=auth(), json={'name': 'Sipun Mahanta'}).status_code == 200
    assert api.get('/repaidians/members?search=first').json()['members'] == []
    # Stable handles remain searchable after a display-name change.
    assert api.get('/repaidians/members?search=alice').json()['members'][0]['name'] == 'Sipun Mahanta'
    assert api.get('/repaidians/members?search=mahanta').json()['members'][0]['name'] == 'Sipun Mahanta'
    with api.core.db() as c:
        plan = c.execute("EXPLAIN QUERY PLAN SELECT body FROM operation_records WHERE kind=? AND json_extract(body,'$.sortKey')<? ORDER BY json_extract(body,'$.sortKey') DESC LIMIT 20", ('rp_timeline_post_public_all', 'x')).fetchall()
    assert any('operation_social_sort' in row['detail'] for row in plan)


def test_blocks_remove_follow_counters_and_hide_feed_and_reports(api):
    grant(api)
    profile(api)
    profile(api, 'bob')
    item = post(api)
    api.put('/repaidians/follow/alice', headers=auth('bob'), json={'active': True})
    assert api.post('/repaidians/reports', headers=auth('bob'), json={'targetId': item['id'], 'reason': 'spam'}).status_code == 201
    assert api.put('/repaidians/blocks/alice', headers=auth('bob'), json={'active': True}).status_code == 200
    assert api.get('/repaidians/feed', headers=auth('bob')).json()['items'] == []
    assert api.get('/repaidians/state', headers=auth('bob')).json()['activity']['following'] == []
    assert api.get('/repaidians/members/alice', headers=auth()).json()['stats']['followers'] == 0
    assert api.get('/repaidians/comments/' + item['id'], headers=auth('bob')).status_code == 404


def test_missing_or_false_heartbeat_cannot_bypass_server_browse_leases(api, monkeypatch):
    clock = [int(datetime(2026, 10, 6, 10, 0, tzinfo=social.IST).timestamp() * 1000)]
    monkeypatch.setattr(social, 'now_ms', lambda: clock[0])
    for index in range(60):
        assert api.post('/repaidians/usage', json={'active': False}).status_code == 200
        r = api.get('/repaidians/feed')
        assert r.status_code == 200, (index, r.text)
        # Multiple tabs/refreshes in the same lease never double charge.
        assert api.get('/repaidians/feed').status_code == 200
        clock[0] += social.LEASE
    assert api.get('/repaidians/feed').status_code == 402
    assert api.get('/repaidians/state').json()['remainingMs'] == 0
    assert api.post('/repaidians/usage', json={'active': False}).json()['remainingMs'] == 0
    assert api.post('/repaidians/usage', json={'active': True}).json()['remainingMs'] == 0


def test_hosting_compatible_guest_cookie_persists_on_json_and_media_response(api, monkeypatch):
    clock = [int(datetime(2026, 10, 6, 10, 0, tzinfo=social.IST).timestamp() * 1000)]
    monkeypatch.setattr(social, 'now_ms', lambda: clock[0])
    first = api.get('/repaidians/state')
    token = first.cookies['__session']
    clock[0] += 20000
    # This is the only cookie Firebase Hosting retains for a Cloud Run rewrite.
    second = api.get('/repaidians/state', headers={'Cookie': '__session=' + token})
    assert second.json()['remainingMs'] == 885000
    assert 'set-cookie' not in second.headers
    assert api.core.operations_store.run(lambda u: u.get('rp_usage', 'guest_' + social.digest(token)))['usedMs'] == 30000
    grant(api)
    profile(api)
    asset = photo(api)
    post(api, media=asset)
    api.cookies.clear()
    media = api.get(asset['url'].removeprefix('/api'))
    assert media.status_code == 200 and media.headers['set-cookie'].startswith('__session=')
    assert 'HttpOnly' in media.headers['set-cookie']


def test_trial_media_is_bounded_and_entitled_time_does_not_spend_guest_quota(api, monkeypatch):
    asset = photo(api)
    assert api.patch('/repaidians/profile', headers=auth(), json={'avatarUrl': asset['url']}).status_code == 200
    assert api.post('/repaidians/media', headers={**auth(), 'Content-Type': 'video/mp4'}, content=b'video').status_code == 422
    assert api.post('/repaidians/media', headers={**auth(), 'Content-Type': 'image/jpeg'}, content=b'x' * (8 * 1024 * 1024 + 1)).status_code == 413
    expire(api)
    assert api.post('/repaidians/media', headers={**auth(), 'Content-Type': 'image/jpeg'}, content=b'photo').status_code == 402
    grant(api, 'bob')
    clock = [int(time.time() * 1000)]
    monkeypatch.setattr(social, 'now_ms', lambda: clock[0])
    for _ in range(65):
        assert api.post('/repaidians/usage', headers=auth('bob'), json={'active': True}).json()['remainingMs'] == 900000
        clock[0] += 15000
    assert api.core.operations_store.run(lambda u: u.get('rp_usage', 'user_' + social.digest('bob'))) is None
    api.core.operations_store.run(lambda u: u.put('rp_subscriptions', 'bob', {'status': 'refunded'}))
    assert api.get('/repaidians/state', headers=auth('bob')).json()['remainingMs'] == 900000


def test_operator_reports_are_bounded_private_audited_and_delete_once(api, monkeypatch):
    grant(api)
    profile(api)
    profile(api, 'bob')
    profile(api, 'carol')
    asset = photo(api)
    item = post(api, media=asset)
    assert api.post('/repaidians/reports', headers=auth('bob'), json={'targetId': item['id'], 'reason': 'spam', 'details': 'Misleading installation description'}).status_code == 201
    assert api.post('/repaidians/reports', headers=auth('carol'), json={'targetId': item['id'], 'reason': 'unsafe'}).status_code == 201
    assert api.get('/repaidians/admin/reports', headers=auth('bob')).status_code == 403
    monkeypatch.setattr(Unit, 'all', lambda *_: (_ for _ in ()).throw(AssertionError('Unbounded report scan')))
    admin = {'X-Admin-Key': 'test-community-operator'}
    first = api.get('/repaidians/admin/reports?limit=1', headers=admin).json()
    assert len(first['reports']) == 1 and first['nextCursor']
    second = api.get('/repaidians/admin/reports', params={'limit': 1, 'cursor': first['nextCursor']}, headers=admin).json()
    assert len(second['reports']) == 1 and second['reports'][0]['id'] != first['reports'][0]['id']
    report_id = first['reports'][0]['id']
    url = '/repaidians/admin/reports/' + report_id + '/resolve'
    body = {'decision': 'remove', 'reason': 'Reviewed unsafe installation claims and removed this post.'}
    assert api.post(url, headers=auth('bob'), json=body).status_code == 403
    assert api.post(url, headers=admin, json={**body, 'reason': 'short'}).status_code == 422
    resolved = api.post(url, headers=admin, json=body)
    assert resolved.status_code == 200 and resolved.json()['report']['status'] == 'reviewed'
    assert api.post(url, headers=admin, json=body).json() == resolved.json()
    assert api.post(url, headers=admin, json={**body, 'decision': 'retain'}).status_code == 409
    assert api.get('/repaidians/feed').json()['items'] == []
    assert api.get(asset['url'].removeprefix('/api')).status_code == 404
    assert api.get('/repaidians/members/alice').json()['stats']['posts'] == 0
    # Independent reports and a later owner retry never subtract twice.
    second_url = '/repaidians/admin/reports/' + second['reports'][0]['id'] + '/resolve'
    assert api.post(second_url, headers=admin, json=body).status_code == 200
    assert api.delete('/repaidians/publications/' + item['id'], headers=auth()).status_code == 200
    assert api.get('/repaidians/members/alice').json()['stats']['posts'] == 0
    with api.core.db() as c:
        audits = [row['body'] for row in c.execute("SELECT body FROM operation_records WHERE kind='audit'")]
    import json
    outcomes = [json.loads(row) for row in audits if json.loads(row)['action'] == 'RepaidiansReportResolved']
    assert len(outcomes) == 2 and sum(row['publication_removed'] for row in outcomes) == 1
    assert all(row['reason'] == body['reason'] and row['actor_id'] == 'test-operator' for row in outcomes)


def test_operator_retain_does_not_change_content_or_private_contacts(api):
    grant(api)
    profile(api)
    profile(api, 'bob')
    tender = post(api, kind='tender', title='Rewiring', location='Balasore', budgetRupees=20000,
                  slots=2, deadline=int(time.time() * 1000) + 86400000, contact='+919123456789')
    api.post('/repaidians/reports', headers=auth('bob'), json={'targetId': tender['id'], 'reason': 'other'})
    admin = {'X-Admin-Key': 'test-community-operator'}
    listed = api.get('/repaidians/admin/reports', headers=admin)
    assert '+919123456789' not in listed.text
    report_id = listed.json()['reports'][0]['id']
    response = api.post('/repaidians/admin/reports/' + report_id + '/resolve', headers=admin,
                        json={'decision': 'retain', 'reason': 'The reported tender follows the community policy.'})
    assert response.status_code == 200
    assert api.get('/repaidians/feed?kind=tender').json()['items'][0]['id'] == tender['id']


def test_new_members_join_from_direct_api_and_get_full_60_day_social_trial(api, monkeypatch):
    stamp = int(time.time() * 1000)
    monkeypatch.setattr(social, 'now_ms', lambda: stamp)
    # The first interaction is a direct authenticated discovery request, with
    # no state fetch and no billing/test Pro grant to unlock the account.
    assert api.get('/repaidians/feed', headers=auth()).status_code == 200
    initial = api.get('/repaidians/state', headers=auth()).json()
    trial = initial['trial']
    assert trial == {'startsAt': stamp, 'endsAt': stamp + 60 * 86400000, 'status': 'active'}
    assert initial['serverNow'] == stamp and initial['subscription'] == {
        'plan': 'trial', 'provider': 'trial', 'amountPaise': 0,
        'startsAt': stamp, 'endsAt': stamp + 60 * 86400000,
    }
    profile(api)
    # A direct authenticated upload also joins the recipient before its first
    # state/profile request and provides the same complete media entitlement.
    bob_asset = photo(api, 'bob')
    assert bob_asset['kind'] == 'image'
    profile(api, 'bob')
    asset = photo(api)
    item = post(api, media=asset)
    story = post(api, media=asset, kind='story')
    import struct
    def box(kind, payload=b''):
        return struct.pack('>I4s', len(payload) + 8, kind) + payload
    video = box(b'ftyp', b'isom\x00\x00\x00\x00mp42') + box(b'moov') + box(b'mdat', b'video frame')
    uploaded = api.post('/repaidians/media', headers={**auth(), 'Content-Type': 'video/mp4'}, content=video)
    assert uploaded.status_code == 201
    reel_media = {key: uploaded.json()[key] for key in ('url', 'kind', 'alt')}
    reel = post(api, media=reel_media, kind='reel')
    assert api.get('/repaidians/feed?kind=reel', headers=auth('bob')).json()['items'][0]['id'] == reel['id']
    assert api.get('/repaidians/feed?kind=story', headers=auth('bob')).json()['items'][0]['id'] == story['id']
    assert api.put('/repaidians/activity/likes/' + item['id'], headers=auth('bob'), json={'active': True}).status_code == 200
    assert api.post('/repaidians/comments/' + item['id'], headers=auth('bob'), json={'text': 'Great work'}).status_code == 201
    assert api.put('/repaidians/follow/alice', headers=auth('bob'), json={'active': True}).status_code == 200
    assert api.post('/repaidians/messages/bob', headers=auth(), json={'text': 'Can your crew help?'}).status_code == 201
    assert api.post('/repaidians/messages/alice', headers=auth('bob'), json={'text': 'Yes, we are available'}).status_code == 201
    tender = post(api, kind='tender', title='Apartment wiring', location='Balasore', budgetRupees=24000,
                  slots=2, deadline=stamp + 86400000, contact='+919123456789')
    assert api.post('/repaidians/bids/' + tender['id'], headers=auth('bob'), json={'note': 'Crew ready'}).status_code == 201
    assert api.get('/repaidians/tenders/' + tender['id'] + '/contact', headers=auth('bob')).json()['contact'] == '+919123456789'
    assert api.get('/repaidians/notifications', headers=auth()).json()['notifications']
    assert api.core.operations_store.run(lambda u: u.get('rp_subscriptions', 'alice')) is None
    assert api.core.operations_store.run(lambda u: u.get('rp_usage', 'user_' + social.digest('alice'))) is None


def test_trial_exact_expiry_locks_every_social_endpoint_and_paid_restores(api, monkeypatch):
    clock = [int(time.time() * 1000)]
    monkeypatch.setattr(social, 'now_ms', lambda: clock[0])
    profile(api)
    profile(api, 'bob')
    asset = photo(api)
    item = post(api, media=asset)
    tender = post(api, kind='tender', title='Future rewiring', location='Balasore', budgetRupees=20000,
                  slots=2, deadline=clock[0] + 60 * 86400000, contact='+919123456789')
    trial = api.get('/repaidians/state', headers=auth()).json()['trial']
    clock[0] = trial['endsAt'] - 1
    assert api.get('/repaidians/feed', headers=auth()).status_code == 200
    clock[0] += 1
    state = api.get('/repaidians/state', headers=auth()).json()
    assert state['trial']['status'] == 'expired' and state['serverNow'] == trial['endsAt']
    assert state['subscription'] is None and state['remainingMs'] == 0
    assert state['data']['posts'] == state['data']['stories'] == state['data']['reels'] == state['data']['tenders'] == []
    assert state['member']['id'] == 'alice'
    sync = api.post('/repaidians/usage', headers=auth(), json={'active': True}).json()
    assert sync['trial']['status'] == 'expired' and sync['remainingMs'] == 0 and sync['serverNow'] == clock[0]
    calls = [
        ('get', '/repaidians/feed', {}), ('get', '/repaidians/members', {}),
        ('get', '/repaidians/members/bob', {}), ('get', '/repaidians/publications/' + item['id'], {}),
        ('get', '/repaidians/comments/' + item['id'], {}), ('get', '/repaidians/messages/bob', {}),
        ('get', '/repaidians/threads', {}), ('get', '/repaidians/notifications', {}),
        ('get', asset['url'].removeprefix('/api'), {}),
        ('get', '/repaidians/tenders/' + tender['id'] + '/contact', {}),
        ('get', '/repaidians/bids/' + tender['id'], {}),
        ('patch', '/repaidians/profile', {'json': {'name': 'Changed Name'}}),
        ('put', '/repaidians/activity/likes/' + item['id'], {'json': {'active': True}}),
        ('put', '/repaidians/follow/bob', {'json': {'active': True}}),
        ('post', '/repaidians/comments/' + item['id'], {'json': {'text': 'Late'}}),
        ('post', '/repaidians/messages/bob', {'json': {'text': 'Late'}}),
        ('post', '/repaidians/bids/' + tender['id'], {'json': {}}),
        ('post', '/repaidians/publications', {'json': {'kind': 'post', 'caption': 'Late', 'trade': 'electrician', 'visibility': 'public', 'media': [asset]}}),
        ('post', '/repaidians/media', {'headers': {**auth(), 'Content-Type': 'image/jpeg'}, 'content': b'photo'}),
        ('post', '/repaidians/notifications/read', {'json': {'ids': []}}),
        ('post', '/repaidians/reports', {'json': {'targetId': item['id'], 'reason': 'other'}}),
    ]
    for method, url, kwargs in calls:
        kwargs.setdefault('headers', auth())
        response = getattr(api, method)(url, **kwargs)
        assert response.status_code == 402, (method, url, response.text)
        assert response.json()['detail']['code'] == 'TRIAL_EXPIRED'
    # Expiry never prevents owners removing their own content or using block
    # controls. These routes return acknowledgements, not social content.
    assert api.delete('/repaidians/publications/' + item['id'], headers=auth('bob')).status_code == 404
    assert api.delete('/repaidians/publications/' + item['id'], headers=auth()).status_code == 200
    assert api.put('/repaidians/blocks/bob', headers=auth(), json={'active': True}).status_code == 200
    assert api.get('/repaidians/messages/bob', headers=auth()).status_code == 402
    assert api.put('/repaidians/blocks/bob', headers=auth(), json={'active': False}).status_code == 200
    # Signed-out visitors still receive only the separate metered public preview.
    assert api.get('/repaidians/feed').status_code == 200
    assert api.get('/repaidians/state').json()['trial'] is None
    api.core.operations_store.run(lambda u: u.put('rp_subscriptions', 'alice', {
        'status': 'active', 'plan': 'pro', 'provider': 'razorpay', 'amountPaise': 19900,
        'startsAt': clock[0], 'endsAt': clock[0] + 86400000,
    }))
    assert api.get('/repaidians/feed', headers=auth()).status_code == 200
    restored = api.get('/repaidians/state', headers=auth()).json()
    assert restored['subscription']['plan'] == 'pro' and restored['trial']['status'] == 'expired'
    assert api.post('/repaidians/messages/bob', headers=auth(), json={'text': 'Paid again'}).status_code == 201


def test_trial_is_server_owned_once_per_uid_survives_devices_profile_and_backfill(api, monkeypatch):
    clock = [int(time.time() * 1000)]
    monkeypatch.setattr(social, 'now_ms', lambda: clock[0])
    first = api.get('/repaidians/state', headers=auth()).json()['trial']
    assert api.patch('/repaidians/profile', headers=auth(), json={'name': 'Sipun Mahanta'}).status_code == 200
    api.cookies.clear()
    clock[0] += 20 * 86400000
    with TestClient(api.core.app) as another_device:
        assert another_device.get('/repaidians/state', headers=auth()).json()['trial'] == first
        assert another_device.post('/repaidians/usage', headers=auth(), json={'active': True, 'endsAt': clock[0] + 999999999}).status_code == 422
        assert another_device.patch('/repaidians/profile', headers=auth(), json={'createdAt': clock[0]}).status_code == 422
    assert api.core.operations_store.run(lambda u: u.get('rp_usage', 'user_' + social.digest('alice'))) is None
    # Existing durable community profiles backfill from their original joining
    # date instead of receiving a fresh trial each time this release deploys.
    old_start = clock[0] - 61 * 86400000
    api.core.operations_store.run(lambda u: u.put('rp_members', 'bob', {
        'id': 'bob', 'name': 'Existing Professional', 'handle': 'existing.bob', 'trade': 'electrician',
        'role': 'Member', 'avatarUrl': '', 'bio': '', 'createdAt': old_start,
        'followersCount': 0, 'followingCount': 0,
    }))
    existing = api.get('/repaidians/state', headers=auth('bob')).json()
    assert existing['trial'] == {'startsAt': old_start, 'endsAt': old_start + 60 * 86400000, 'status': 'expired'}
    assert existing['remainingMs'] == 0
    clock[0] = first['endsAt']
    assert api.get('/repaidians/state', headers=auth()).json()['trial']['status'] == 'expired'
    assert api.get('/repaidians/feed', headers=auth()).status_code == 402


def test_professional_profile_persistence_filters_validation_and_badge_boundary(api):
    fields = {'headline': 'Electrical installations and fault diagnosis', 'city': ' Balasore ',
              'skills': [' Wiring ', 'Troubleshooting', 'Wiring'], 'experienceYears': 7,
              'workStatus': 'open_to_work', 'professionalType': 'specialist'}
    updated = api.patch('/repaidians/profile', headers=auth(), json=fields)
    assert updated.status_code == 200, updated.text
    member = updated.json()['member']
    assert member['headline'] == fields['headline'] and member['city'] == 'Balasore'
    assert member['skills'] == ['Wiring', 'Troubleshooting'] and member['experienceYears'] == 7
    assert member['workStatus'] == 'open_to_work' and member['professionalType'] == 'specialist'
    assert member['professionalInfoSource'] == 'profile'
    assert member['reviewed'] is True and member['role'] == 'Technician'
    assert api.patch('/repaidians/profile', headers=auth(), json={'experienceYears': '7'}).status_code == 422
    assert api.patch('/repaidians/profile', headers=auth(), json={'experienceYears': 61}).status_code == 422
    assert api.patch('/repaidians/profile', headers=auth(), json={'skills': ['Skill'] * 13}).status_code == 422
    assert api.patch('/repaidians/profile', headers=auth(), json={'skills': ['x' * 61]}).status_code == 422
    assert api.patch('/repaidians/profile', headers=auth(), json={'headline': 'x' * 141}).status_code == 422
    assert api.patch('/repaidians/profile', headers=auth(), json={'professionalType': 'verified_specialist'}).status_code == 422
    assert api.patch('/repaidians/profile', headers=auth(), json={'reviewed': True}).status_code == 422
    with TestClient(api.core.app) as another_device:
        saved = another_device.get('/repaidians/state', headers=auth()).json()['member']
        assert saved['skills'] == member['skills'] and saved['headline'] == member['headline']
    filters = {'city': 'balasore', 'workStatus': 'open_to_work', 'professionalType': 'specialist'}
    found = api.get('/repaidians/members', params=filters).json()
    assert [row['id'] for row in found['members']] == ['alice']
    assert api.get('/repaidians/members', params={**filters, 'search': 'alice'}).json()['members'][0]['id'] == 'alice'
    assert api.get('/repaidians/members?city=Bhadrak').json()['members'] == []
    assert api.get('/repaidians/members?workStatus=imaginary').status_code == 422
    assert api.patch('/repaidians/profile', headers=auth(), json={'city': 'Bhadrak', 'workStatus': 'hiring'}).status_code == 200
    assert api.get('/repaidians/members', params=filters).json()['members'] == []
    assert api.get('/repaidians/members?city=bhadrak&workStatus=hiring').json()['members'][0]['id'] == 'alice'


def test_professional_worker_defaults_backfill_and_bounded_filter_pagination(api, monkeypatch):
    stamp = social.now_ms() - 5 * 86400000
    original_trial_end = stamp + 60 * 86400000
    def seed(u):
        for index in range(12):
            uid = 'old-professional-' + str(index)
            member = {'id': uid, 'name': 'Registered Worker ' + str(index), 'handle': 'worker.' + str(index),
                      'trade': 'electrician', 'role': 'Member', 'avatarUrl': '', 'bio': '',
                      'followersCount': 0, 'followingCount': 0, 'createdAt': stamp + index}
            u.put('rp_members', uid, member)
            u.put('rp_member_directory', uid, {'id': uid, 'sortKey': social.sort_key(stamp + index, uid)})
            u.put('workers', uid, {'id': uid, 'status': 'approved', 'role': 'specialist', 'city': 'Balasore',
                                    'skills': ['Safe rewiring', 'Fault diagnosis'], 'experience_years': 9, 'online': True,
                                    'home_address': 'Private residence', 'phone': '9876543210'})
    api.core.operations_store.run(seed)
    monkeypatch.setattr(Unit, 'all', lambda *_: (_ for _ in ()).throw(AssertionError('Unbounded profile scan')))
    first = api.get('/repaidians/members?city=balasore&trade=electrician&professionalType=specialist&limit=2').json()
    assert first['indexing'] is True and len(first['members']) == 2
    for _ in range(4):
        latest = api.get('/repaidians/members?city=Balasore&trade=electrician&professionalType=specialist&limit=2').json()
        if not latest['indexing']:
            break
    assert latest['indexing'] is False
    seen = []
    cursor = ''
    for _ in range(10):
        page = api.get('/repaidians/members', params={'city': 'BALASORE', 'trade': 'electrician', 'professionalType': 'specialist', 'limit': 2, 'cursor': cursor}).json()
        seen += [member['id'] for member in page['members']]
        assert all(member['experienceYears'] == 9 and member['skills'] == ['Safe rewiring', 'Fault diagnosis'] and member['reviewed'] for member in page['members'])
        assert 'Private residence' not in str(page) and '9876543210' not in str(page)
        cursor = page['nextCursor']
        if not cursor:
            break
    assert len(seen) == len(set(seen)) == 12
    member = api.core.operations_store.run(lambda u: u.get('rp_members', 'old-professional-0'))
    trial = api.core.operations_store.run(lambda u: u.get('rp_trials', 'old-professional-0'))
    assert member['createdAt'] == stamp and trial['startsAt'] == stamp and trial['endsAt'] == original_trial_end


def seed_native_references(api):
    stamp = time.time()
    def seed(u):
        u.put('contract_tenders', 'contract-alice', {
            'id': 'contract-alice', 'owner_id': 'alice', 'owner_name': 'Alice', 'status': 'open',
            'title': 'Apartment rewiring', 'scope': 'Install and inspect electrical circuits', 'sector': 'Electrical',
            'city': 'Balasore', 'budget_paise': 2400000, 'manpower_needed': 3,
            'deadline': stamp + 86400, 'ends_at': stamp + 10 * 86400,
            'site_address': 'Private tender worksite', 'contact_phone': '9876543210',
            'bids': [{'private_proposal': 'Private competing bid'}], 'events': [{'secret': 'Internal action'}],
        })
        u.put('shops', 'shop-bob', {'id': 'shop-bob', 'owner_id': 'bob', 'status': 'approved', 'name': 'Bob Electrical', 'city': 'Balasore'})
        u.put('inventory', 'product-bob', {'id': 'product-bob', 'shop_id': 'shop-bob', 'name': 'Surge protector',
              'category': 'electrical', 'status': 'approved', 'price_paise': 49000, 'stock': 10,
              'stock_confirmed_at': stamp, 'condition': 'new', 'reserved': 0})
        u.put('retail_orders', 'purchase-alice', {'id': 'purchase-alice', 'customer_id': 'alice', 'state': 'paid',
                                               'payment_id': 'pay_testcapture', 'items': [{'product_id': 'product-bob', 'quantity': 1}]})
        u.put('workers', 'alice', {'id': 'alice', 'status': 'approved', 'role': 'specialist', 'contractor_verified': True})
        u.put('contract_projects', 'career-alice', {'id': 'career-alice', 'owner_id': 'alice', 'owner_name': 'Alice',
              'title': 'Wiring crew opening', 'status': 'planning', 'starts_at': stamp + 86400, 'ends_at': stamp + 10 * 86400,
              'team': [], 'goals': [], 'site_address': 'Private customer site',
              'hiring': {'status': 'open', 'sector': 'Electrical', 'city': 'Balasore', 'summary': 'Experienced installers wanted',
                         'skills': ['Wiring'], 'openings': 2, 'daily_rate_paise': 120000, 'deadline': stamp + 86400}})
        u.put('market_listings', 'second-alice', {'id': 'second-alice', 'owner_id': 'alice', 'owner_name': 'Alice',
              'name': 'Pre-owned drill', 'product_type': 'Power tools', 'mode': 'second_hand', 'status': 'published',
              'city': 'Balasore', 'value_paise': 120000, 'condition': 'Used, tested and functional', 'photo_id': 'photo-safe',
              'location': {'lat': 21.2, 'lng': 86.5}, 'contact': '9876543210'})
        u.put('jobs', 'private-task', {'id': 'private-task', 'customer_id': 'bob', 'phone': '9876543210',
                                     'address': 'Private customer service address', 'state': 'in_progress'})
    api.core.operations_store.run(seed)


def test_linked_publications_validate_native_owner_or_purchase_and_never_private_tasks(api):
    profile(api)
    profile(api, 'bob')
    seed_native_references(api)
    def publish(source, key, uid='alice', **extra):
        return api.post('/repaidians/publications', headers=auth(uid), json={
            'kind': 'post', 'caption': 'From my professional work', 'trade': 'electrician', 'visibility': 'public',
            'media': [], 'reference': {'source': source, 'id': key}, **extra,
        })
    for source, key, expected_kind in [('contract', 'contract-alice', 'tender'), ('career', 'career-alice', 'job'),
                                       ('inventory', 'product-bob', 'product'), ('second_hand', 'second-alice', 'product')]:
        response = publish(source, key)
        assert response.status_code == 201, response.text
        item = response.json()['item']
        assert item['media'] == [] and item['reference'] == {'source': source, 'id': key}
        assert item['referenceCard']['kind'] == expected_kind and item['referenceUnavailable'] is False
        assert 'Private customer' not in response.text and '9876543210' not in response.text
        assert 'Private competing' not in response.text and 'Internal action' not in response.text
    assert publish('contract', 'contract-alice', 'bob').status_code == 403
    assert publish('inventory', 'product-bob', 'carol').status_code == 403
    assert publish('career', 'private-task').status_code == 404
    assert publish('jobs', 'private-task').status_code == 422
    assert publish('contract', 'unknown-source').status_code == 404
    assert publish('contract', 'contract-alice', kind='story').status_code == 422
    assert publish('contract', 'contract-alice', reference={'source': 'contract', 'id': 'contract-alice', 'budgetPaise': 1}).status_code == 422


def test_linked_cards_rehydrate_latest_values_retries_and_source_withdrawal(api, monkeypatch):
    profile(api)
    profile(api, 'bob')
    seed_native_references(api)
    body = {'kind': 'post', 'caption': 'Project announcement', 'trade': 'electrician', 'visibility': 'public', 'media': [],
            'reference': {'source': 'contract', 'id': 'contract-alice'}, 'clientId': str(uuid.uuid4())}
    first = api.post('/repaidians/publications', headers=auth(), json=body)
    assert first.status_code == 201
    publication_id = first.json()['item']['id']
    assert first.json()['item']['referenceCard']['budgetPaise'] == 2400000
    def update(u):
        row = u.get('contract_tenders', 'contract-alice')
        row.update(title='Updated electrical project', budget_paise=3200000)
        u.put('contract_tenders', row['id'], row)
    api.core.operations_store.run(update)
    monkeypatch.setattr(Unit, 'all', lambda *_: (_ for _ in ()).throw(AssertionError('Unbounded linked source scan')))
    current = api.get('/repaidians/publications/' + publication_id).json()['item']
    assert current['referenceCard']['title'] == 'Updated electrical project' and current['referenceCard']['budgetPaise'] == 3200000
    retried = api.post('/repaidians/publications', headers=auth(), json=body)
    assert retried.json()['item']['id'] == publication_id and retried.json()['item']['referenceCard']['budgetPaise'] == 3200000
    primary = api.core.operations_store.run(lambda u: u.get('rp_publications', publication_id))
    assert 'referenceCard' not in primary and 'budgetPaise' not in primary and primary['reference'] == body['reference']
    def withdraw(u):
        row = u.get('contract_tenders', 'contract-alice')
        row['status'] = 'withdrawn'
        u.put('contract_tenders', row['id'], row)
    api.core.operations_store.run(withdraw)
    unavailable = api.get('/repaidians/feed').json()['items'][0]
    assert unavailable['id'] == publication_id and unavailable['referenceUnavailable'] is True
    assert unavailable['referenceCard'] is None and '3200000' not in str(unavailable)
    assert api.post('/repaidians/publications', headers=auth(), json={**body, 'clientId': str(uuid.uuid4())}).status_code == 404


def test_purchased_reference_rechecks_refund_stock_and_block_visibility(api):
    profile(api)
    profile(api, 'bob')
    profile(api, 'carol')
    seed_native_references(api)
    body = {'kind': 'post', 'caption': 'Purchased equipment', 'trade': 'electrician', 'visibility': 'public', 'media': [],
            'reference': {'source': 'inventory', 'id': 'product-bob'}}
    response = api.post('/repaidians/publications', headers=auth(), json=body)
    assert response.status_code == 201
    publication_id = response.json()['item']['id']
    assert api.get('/repaidians/publications/' + publication_id, headers=auth('carol')).json()['item']['referenceCard']['pricePaise'] == 49000
    assert api.put('/repaidians/blocks/bob', headers=auth('carol'), json={'active': True}).status_code == 200
    hidden_source = api.get('/repaidians/publications/' + publication_id, headers=auth('carol')).json()['item']
    assert hidden_source['referenceCard'] is None and hidden_source['referenceUnavailable'] is True
    def refund(u):
        row = u.get('retail_orders', 'purchase-alice')
        row['state'] = 'refunded'
        u.put('retail_orders', row['id'], row)
    api.core.operations_store.run(refund)
    assert api.post('/repaidians/publications', headers=auth(), json=body).status_code == 403
    current = api.get('/repaidians/publications/' + publication_id, headers=auth()).json()['item']
    assert current['referenceCard']['shareable'] is False
    def stock(u):
        row = u.get('inventory', 'product-bob')
        row.update(stock=0, price_paise=55000)
        u.put('inventory', row['id'], row)
    api.core.operations_store.run(stock)
    unavailable = api.get('/repaidians/publications/' + publication_id).json()['item']
    assert unavailable['referenceCard'] is None and unavailable['referenceUnavailable'] is True


def test_existing_work_network_blocks_apply_to_social_discovery_content_and_messages(api):
    profile(api)
    profile(api, 'bob')
    asset = photo(api)
    item = post(api, media=asset)
    assert api.get('/repaidians/feed', headers=auth('bob')).json()['items']
    api.core.operations_store.run(lambda u: u.put('network_blocks', 'bob:alice', {'active': True}))
    assert api.get('/repaidians/feed', headers=auth('bob')).json()['items'] == []
    assert api.get('/repaidians/members?search=alice', headers=auth('bob')).json()['members'] == []
    assert api.get('/repaidians/members?trade=electrician', headers=auth('bob')).json()['members'][0]['id'] == 'bob'
    assert api.get('/repaidians/members/alice', headers=auth('bob')).status_code == 404
    assert api.get(asset['url'].removeprefix('/api'), headers=auth('bob')).status_code == 404
    assert api.post('/repaidians/comments/' + item['id'], headers=auth('bob'), json={'text': 'Blocked'}).status_code == 404
    assert api.post('/repaidians/messages/alice', headers=auth('bob'), json={'text': 'Blocked'}).status_code == 404
    assert api.post('/repaidians/messages/bob', headers=auth(), json={'text': 'Other side blocked'}).status_code == 404
    assert api.put('/repaidians/follow/alice', headers=auth('bob'), json={'active': True}).status_code == 404
    api.core.operations_store.run(lambda u: u.put('network_blocks', 'bob:alice', {'active': False}))
    assert api.get('/repaidians/feed', headers=auth('bob')).json()['items'][0]['id'] == item['id']
