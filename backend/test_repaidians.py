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
        if uid not in ('alice', 'bob', 'carol'):
            raise HTTPException(401, 'Invalid test session')
        return {'id': uid, 'name': uid.title() + ' Professional'}
    def operator(x_admin_key: str = Header(default='')):
        if x_admin_key != 'test-community-operator':
            raise HTTPException(403, 'Operator required')
        return {'id': 'test-operator'}
    core = SimpleNamespace(DB_PATH=path, USE_FIRESTORE=False, db=db, current_user=current_user, operator=operator, app=FastAPI())
    core.operations_store = Store(core)
    core.operations_store.init()
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
    assert api.get('/repaidians/state', headers=auth()).json()['member']['reviewed'] is False


def test_server_heartbeat_shared_budget_no_client_time_and_ist_reset(api, monkeypatch):
    clock = [int(datetime(2026, 10, 6, 23, 58, tzinfo=ZoneInfo('Asia/Kolkata')).timestamp() * 1000)]
    monkeypatch.setattr(social, 'now_ms', lambda: clock[0])
    api.get('/repaidians/state', headers=auth())
    assert api.post('/repaidians/usage', headers=auth(), json={'active': True}).json()['remainingMs'] == 900000
    clock[0] += 7000
    assert api.post('/repaidians/usage', headers=auth(), json={'active': True}).json()['remainingMs'] == 893000
    assert api.post('/repaidians/usage', headers=auth(), json={'active': True}).json()['remainingMs'] == 893000
    assert api.post('/repaidians/usage', headers=auth(), json={'active': True, 'durationMs': -900000}).status_code == 422
    # Pausing stops renewal but never refunds a prepaid 15-second slice.
    clock[0] += 60000
    assert api.post('/repaidians/usage', headers=auth(), json={'active': False}).json()['remainingMs'] == 885000
    subject = 'user_' + social.digest('alice')
    day = datetime.fromtimestamp(clock[0] / 1000, social.IST).date().isoformat()
    api.core.operations_store.run(lambda u: u.put('rp_usage', subject, {'day': day, 'usedMs': 900000, 'leaseUntil': clock[0] - 1}))
    assert api.get('/repaidians/feed', headers=auth()).status_code == 402
    assert api.get('/repaidians/state', headers=auth()).json()['data']['posts'] == []
    # A different authenticated user has its own authoritative counter.
    assert api.get('/repaidians/state', headers=auth('bob')).json()['remainingMs'] == 900000
    clock[0] = int(datetime(2026, 10, 7, 0, 0, tzinfo=social.IST).timestamp() * 1000)
    assert api.get('/repaidians/state', headers=auth()).json()['remainingMs'] == 900000


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
    assert api.post('/repaidians/messages/alice', headers=auth('bob'), json={'text': 'Unpaid reply'}).status_code == 402
    assert api.put('/repaidians/blocks/alice', headers=auth('bob'), json={'active': True}).status_code == 200
    assert api.get('/repaidians/messages/alice', headers=auth('bob')).status_code == 404
    assert api.post('/repaidians/messages/bob', headers=auth(), json={'text': 'Blocked'}).status_code == 404
    assert api.get('/repaidians/threads', headers=auth()).json()['threads'] == []
    assert api.get('/repaidians/members/alice', headers=auth('bob')).status_code == 404


def test_tender_contact_never_in_public_snapshot_bids_durable_owner_only(api):
    grant(api)
    profile(api)
    profile(api, 'bob')
    tender = post(api, kind='tender',
                  title='Apartment rewiring', location='Balasore', budgetRupees=24000, slots=3,
                  deadline=int(time.time() * 1000) + 86400000, contact='+919876543210')
    assert tender['contact'] == '' and '+919876543210' not in api.get('/repaidians/state').text
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
        assert api.post('/repaidians/usage', headers=auth(), json={'active': False}).status_code == 200
        r = api.get('/repaidians/feed', headers=auth())
        assert r.status_code == 200, (index, r.text)
        # Multiple tabs/refreshes in the same lease never double charge.
        assert api.get('/repaidians/feed', headers=auth()).status_code == 200
        clock[0] += social.LEASE
    assert api.get('/repaidians/feed', headers=auth()).status_code == 402
    assert api.get('/repaidians/state', headers=auth()).json()['remainingMs'] == 0
    assert api.post('/repaidians/usage', headers=auth(), json={'active': False}).json()['remainingMs'] == 0
    assert api.post('/repaidians/usage', headers=auth(), json={'active': True}).json()['remainingMs'] == 0


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


def test_free_profile_media_is_bounded_and_paid_time_does_not_spend_free_quota(api, monkeypatch):
    asset = photo(api)
    assert api.patch('/repaidians/profile', headers=auth(), json={'avatarUrl': asset['url']}).status_code == 200
    assert api.post('/repaidians/media', headers={**auth(), 'Content-Type': 'video/mp4'}, content=b'video').status_code == 402
    assert api.post('/repaidians/media', headers={**auth(), 'Content-Type': 'image/jpeg'}, content=b'x' * (2 * 1024 * 1024 + 1)).status_code == 413
    for _ in range(3):
        photo(api)
    output = io.BytesIO()
    Image.new('RGB', (8, 8)).save(output, format='JPEG')
    assert api.post('/repaidians/media', headers={**auth(), 'Content-Type': 'image/jpeg'}, content=output.getvalue()).status_code == 429
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
