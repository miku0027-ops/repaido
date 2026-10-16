"""Native presence: TTL, privacy, stale tabs, no chat delivery side effects."""
import uuid
from datetime import datetime, timezone

import main
import market_presence as presence
from test_operations import api, auth
from test_market_messaging import listing, open_chat, BASE


def heartbeat(api, cid, uid='worker', session=None, sequence=1, online=True, typing=False, status=200):
    body = dict(session_id=session or str(uuid.uuid4()), sequence=sequence, online=online, typing=typing)
    response = api.post(f'{BASE}/{cid}/presence', headers=auth(uid), json=body)
    assert response.status_code == status, response.text
    return response.json(), body


def view(api, cid, uid='worker2'):
    response = api.get(f'{BASE}/{cid}/presence', headers=auth(uid))
    assert response.status_code == 200, response.text
    return response.json()


def test_presence_unknown_then_exact_ttl_without_client_cleanup(api, monkeypatch):
    now = [1800000000.0]
    monkeypatch.setattr(presence.time, 'time', lambda: now[0])
    opened, _ = open_chat(api, listing())
    cid = opened['chat']['id']
    assert view(api, cid) == dict(other_online=False, other_typing=False, last_seen_at=None, server_now=now[0], expires_at=None, typing_expires_at=None)
    heartbeat(api, cid, typing=True)
    assert view(api, cid)['other_typing']
    now[0] += presence.TYPING_TTL
    assert view(api, cid)['other_online'] and not view(api, cid)['other_typing']
    now[0] += presence.ONLINE_TTL - presence.TYPING_TTL
    expired = view(api, cid)
    assert not expired['other_online'] and expired['expires_at'] is None and expired['last_seen_at'] == 1800000000.0
    assert api.get(f'{BASE}/{cid}/messages', headers=auth('worker2')).json()['presence'] == expired


def test_sessions_sequences_and_late_offline_do_not_hide_other_tab(api, monkeypatch):
    now = [1800000000.0]
    monkeypatch.setattr(presence.time, 'time', lambda: now[0])
    opened, _ = open_chat(api, listing())
    cid = opened['chat']['id']
    first, second = str(uuid.uuid4()), str(uuid.uuid4())
    heartbeat(api, cid, session=first, sequence=2, typing=True)
    now[0] += 2
    heartbeat(api, cid, session=second, sequence=1)
    heartbeat(api, cid, session=first, sequence=1, online=False)
    assert view(api, cid)['other_typing']
    heartbeat(api, cid, session=first, sequence=3, online=False)
    assert view(api, cid)['other_online'] and not view(api, cid)['other_typing']
    heartbeat(api, cid, session=second, sequence=2, online=False)
    assert not view(api, cid)['other_online']
    # A replayed online packet cannot resurrect an explicitly closed tab.
    heartbeat(api, cid, session=first, sequence=2, typing=True)
    assert not view(api, cid)['other_online']


def test_participant_only_blocked_redaction_and_strict_payload(api):
    opened, _ = open_chat(api, listing())
    cid = opened['chat']['id']
    assert api.get(f'{BASE}/{cid}/presence').status_code == 401
    assert api.get(f'{BASE}/{cid}/presence', headers=auth('stranger')).status_code == 404
    heartbeat(api, cid, uid='stranger', status=404)
    heartbeat(api, 'missing', status=404)
    heartbeat(api, cid, typing=True)
    for changes in ({'session_id': 'not-a-uuid'}, {'sequence': True}, {'sequence': 0}, {'online': 'true'}, {'online': False, 'typing': True}):
        body = dict(session_id=str(uuid.uuid4()), sequence=1, online=True, typing=False)
        assert api.post(f'{BASE}/{cid}/presence', headers=auth('worker'), json={**body, **changes}).status_code == 422
    api.post(f'{BASE}/{cid}/block', headers=auth('worker2'), json={'blocked': True})
    heartbeat(api, cid, typing=True)
    for uid in ('worker','worker2'):
        result = view(api, cid, uid)
        assert not result['other_online'] and not result['other_typing'] and result['last_seen_at'] is None
        assert 'session' not in str(result) and 'worker' not in str(result)


def test_presence_does_not_create_messages_notifications_unread_or_access_trial(api, monkeypatch):
    opened, _ = open_chat(api, listing())
    cid = opened['chat']['id']
    kinds = ('market_chats','market_chat_messages','market_chat_counts','notifications','market_access_trials')
    before = main.operations_store.run(lambda u: {kind:u.all(kind) for kind in kinds})
    heartbeat(api, cid, typing=True)
    for _ in range(2):
        view(api, cid)
    assert main.operations_store.run(lambda u: {kind:u.all(kind) for kind in kinds}) == before
    main.operations_store.run(lambda u:u.put('market_access_trials','worker',dict(id='worker',starts_at=presence.time.time()-91*86400)))
    session=str(uuid.uuid4())
    heartbeat(api, cid, session=session, typing=True)
    assert view(api,cid)['other_online'] and not view(api,cid)['other_typing']
    assert api.get(f'{BASE}/{cid}/presence',headers=auth('worker')).status_code==200


def test_offline_unknown_does_not_fabricate_activity_and_active_sessions_bounded(api, monkeypatch):
    now=[1800000000.0]
    monkeypatch.setattr(presence.time,'time',lambda:now[0])
    opened,_=open_chat(api,listing())
    cid=opened['chat']['id']
    heartbeat(api,cid,online=False)
    assert view(api,cid)['last_seen_at'] is None
    for _ in range(presence.MAX_SESSIONS):
        heartbeat(api,cid)
    heartbeat(api,cid,status=429)
    now[0]+=presence.ONLINE_TTL+1
    heartbeat(api,cid)
    record=main.operations_store.run(lambda u:u.get('market_chat_presence',presence._key(cid,'worker')))
    assert len(record['sessions'])==presence.MAX_SESSIONS


def test_activity_aggregate_uses_ist_month_and_observed_online_days_only(api, monkeypatch):
    # A shop day begins at 18:30 UTC. Native heartbeats call the same aggregate
    # as the owner console; simulated indexed shop lookup avoids onboarding.
    import operations
    original_find = operations.Unit.find
    def own_shop(unit, kind, field, value, **kwargs):
        if (kind, field, value) == ('shops', 'owner_id', 'worker'):
            return [dict(id='actual-owned-shop', owner_id='worker')]
        return original_find(unit, kind, field, value, **kwargs)
    monkeypatch.setattr(operations.Unit, 'find', own_shop)
    now = [datetime(2026, 10, 31, 18, 29, 58, tzinfo=timezone.utc).timestamp()]
    monkeypatch.setattr(presence.time, 'time', lambda: now[0])
    opened, _ = open_chat(api, listing())
    cid = opened['chat']['id']
    session = str(uuid.uuid4())
    heartbeat(api, cid, session=session, sequence=2)
    october = main.operations_store.run(lambda u:u.all('shop_presence_month'))
    assert len(october) == 1 and october[0]['month'] == '2026-10' and october[0]['active_days'] == [31]
    now[0] += 5
    # The prior month's delayed close, and an older online packet, create no
    # November activity. A real new foreground heartbeat does.
    heartbeat(api, cid, session=session, sequence=1, online=False)
    heartbeat(api, cid, session=session, sequence=1)
    assert len(main.operations_store.run(lambda u:u.all('shop_presence_month'))) == 1
    heartbeat(api, cid, session=session, sequence=3)
    months = main.operations_store.run(lambda u:u.all('shop_presence_month'))
    november = next(row for row in months if row['month'] == '2026-11')
    assert november['active_days'] == [1]
    now[0] += 20
    heartbeat(api, cid, session=session, sequence=4)
    assert next(row for row in main.operations_store.run(lambda u:u.all('shop_presence_month')) if row['month'] == '2026-11') == november


def test_presence_uses_no_global_scan_and_duplicate_pulses_do_not_write(api, monkeypatch):
    import operations
    now = [1800000000.0]
    monkeypatch.setattr(presence.time, 'time', lambda: now[0])
    opened, _ = open_chat(api, listing())
    cid = opened['chat']['id']
    def no_scan(unit, kind):
        raise AssertionError('Presence may not scan ' + kind)
    monkeypatch.setattr(operations.Unit, 'all', no_scan)
    session=str(uuid.uuid4())
    heartbeat(api,cid,session=session,sequence=1,typing=True)
    heartbeat(api,cid,session=session,sequence=2,typing=True,status=429)
    assert view(api,cid)['other_typing']
    # An explicit stop is immediate even within the same server second.
    heartbeat(api,cid,session=session,sequence=3,typing=False)
    assert not view(api,cid)['other_typing']
