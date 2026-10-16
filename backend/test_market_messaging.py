"""Native marketplace messaging transactions, privacy and pagination regressions."""
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import main
import market_messaging as messaging
from test_operations import api, auth, ADMIN, PIN

BASE = '/operations/market/chats'


def listing(uid='worker', mode='second_hand', **changes):
    row = dict(id=uuid.uuid4().hex, owner_id=uid, owner_name='Seller member', mode=mode,
               status='published', expires_at=time.time() + 86400 * 30, created_at=time.time(),
               photo_id=uuid.uuid4().hex, name='Fixture camera', value_paise=100000,
               city='Balasore', contact_phone='+919876543210', location=PIN,
               product_type='camera', brand='Test', fee_status='paid',
               desired_type='phone', desired_product='Smartphone')
    row.update(changes)
    main.operations_store.run(lambda u: u.put('market_listings', row['id'], row))
    return row


def open_chat(api, row, uid='worker2', **changes):
    body = dict(listing_id=row['id'], request_id=str(uuid.uuid4()), body='Is it available?')
    body.update(changes)
    response = api.post(BASE, headers=auth(uid), json=body)
    assert response.status_code == 200, response.text
    return response.json(), body


def send(api, cid, uid='worker2', status=200, **changes):
    body = dict(request_id=str(uuid.uuid4()), kind='text', body='Can we arrange an inspection?')
    body.update(changes)
    response = api.post(f'{BASE}/{cid}/messages', headers=auth(uid), json=body)
    assert response.status_code == status, response.text
    return response.json(), body


def test_membership_verified_phone_and_no_sensitive_snapshots(api):
    row = listing()
    assert api.get(BASE).status_code == 401
    assert api.post(BASE, headers=auth('customer'), json=dict(listing_id=row['id'], request_id=str(uuid.uuid4()))).status_code == 403
    assert api.post(BASE, headers=auth('worker'), json=dict(listing_id=row['id'], request_id=str(uuid.uuid4()))).status_code == 409
    response, _ = open_chat(api, row)
    cid = response['chat']['id']
    assert response['chat']['side'] == 'buying' and response['chat']['access']['active']
    for path in (BASE, f'{BASE}/{cid}/messages'):
        private = api.get(path, headers=auth('worker2')).json()
        assert all(term not in str(private) for term in ('contact_phone', 'owner_id', '+919876543210', '86.9135'))
    assert api.get(f'{BASE}/{cid}/messages', headers=auth('stranger')).status_code == 404
    assert api.post(f'{BASE}/{cid}/read', headers=auth('stranger'), json={'through_seq': 1}).status_code == 404
    assert api.post(f'{BASE}/{cid}/block', headers=auth('stranger'), json={'blocked': True}).status_code == 404
    assert api.post(f'{BASE}/{cid}/report', headers=auth('stranger'), json={'reason': 'Please review this message.'}).status_code == 404
    notifications = main.operations_store.run(lambda u: u.find('notifications', 'user_id', 'worker'))
    assert len(notifications) == 1 and notifications[0]['market_chat_id'] == cid and notifications[0]['market_message_seq'] == 1
    assert 'Is it available?' not in str(notifications)


def test_only_public_active_ids_open_and_history_survives_close(api):
    for status in ('awaiting_fee', 'closed', 'suspended', 'expired'):
        row = listing(status=status)
        assert api.post(BASE, headers=auth('worker2'), json=dict(listing_id=row['id'], request_id=str(uuid.uuid4()))).status_code == 404
    row = listing(expires_at=time.time() - 1)
    assert api.post(BASE, headers=auth('worker2'), json=dict(listing_id=row['id'], request_id=str(uuid.uuid4()))).status_code == 404
    row = listing()
    opened, command = open_chat(api, row)
    cid = opened['chat']['id']
    main.operations_store.run(lambda u: u.put('market_listings', row['id'], {**row, 'status': 'closed'}))
    history = api.get(f'{BASE}/{cid}/messages', headers=auth('worker2')).json()
    assert len(history['messages']) == 1 and not history['chat']['can_send']
    send(api, cid, status=409)
    assert api.post(BASE, headers=auth('worker2'), json=command).status_code == 200
    assert api.post(BASE, headers=auth('worker2'), json=dict(listing_id=row['id'], request_id=str(uuid.uuid4()))).json()['chat']['id'] == cid


def test_requests_unique_conflicts_and_replay_after_expiry_or_block(api):
    row = listing()
    opened, command = open_chat(api, row)
    cid = opened['chat']['id']
    assert api.post(BASE, headers=auth('worker2'), json=command).json()['messages'][0]['seq'] == 1
    assert api.post(BASE, headers=auth('worker2'), json={**command, 'body': 'Changed'}).status_code == 409
    again, _ = open_chat(api, row, body='')
    assert again['chat']['id'] == cid and again['chat']['latest_seq'] == 1
    sent, payload = send(api, cid)
    assert sent['message']['seq'] == 2
    api.post(f'{BASE}/{cid}/block', headers=auth('worker'), json={'blocked': True})
    assert api.post(f'{BASE}/{cid}/messages', headers=auth('worker2'), json=payload).json()['message']['seq'] == 2
    assert api.post(f'{BASE}/{cid}/messages', headers=auth('worker2'), json={**payload, 'body': 'Different'}).status_code == 409
    main.operations_store.run(lambda u: u.put('market_access_trials', 'worker2', dict(id='worker2', starts_at=time.time() - 91 * 86400)))
    assert api.post(BASE, headers=auth('worker2'), json=command).status_code == 200
    assert api.post(f'{BASE}/{cid}/messages', headers=auth('worker2'), json=payload).status_code == 200
    assert api.get(f'{BASE}/{cid}/messages', headers=auth('worker2')).json()['chat']['latest_seq'] == 2


def test_read_counts_exact_partial_monotonic_and_no_read_side_effects(api):
    opened, _ = open_chat(api, listing())
    cid = opened['chat']['id']
    send(api, cid, uid='worker', body='Yes, it is available.')
    send(api, cid, body='I can come today.')
    seller = api.get(BASE, headers=auth('worker')).json()
    assert seller['unread_count'] == 2 and seller['chats'][0]['unread_count'] == 2
    assert api.get(BASE + '?side=buying', headers=auth('worker')).json()['unread_count'] == 0
    before = main.operations_store.run(lambda u: u.all('market_chats'))
    for _ in range(2):
        api.get(f'{BASE}/{cid}/messages', headers=auth('worker'))
        api.get(BASE, headers=auth('worker'))
    assert main.operations_store.run(lambda u: u.all('market_chats')) == before
    assert api.post(f'{BASE}/{cid}/read', headers=auth('worker'), json={'through_seq': 4}).status_code == 422
    partial = api.post(f'{BASE}/{cid}/read', headers=auth('worker'), json={'through_seq': 2}).json()['chat']
    assert partial['unread_count'] == 1 and partial['read_seq'] == 2
    assert api.post(f'{BASE}/{cid}/read', headers=auth('worker'), json={'through_seq': 1}).json()['chat']['read_seq'] == 2
    api.post(f'{BASE}/{cid}/read', headers=auth('worker'), json={'through_seq': 3})
    assert api.get(BASE, headers=auth('worker')).json()['unread_count'] == 0
    assert api.get(BASE, headers=auth('worker2')).json()['unread_count'] == 1
    receipt = api.get(f'{BASE}/{cid}/messages', headers=auth('worker2')).json()['chat']
    assert receipt['other_read_seq'] == 3


def test_blocking_requires_each_actor_to_unblock_and_expiry_keeps_safety_controls(api):
    opened, _ = open_chat(api, listing())
    cid = opened['chat']['id']
    for uid in ('worker', 'worker2'):
        assert api.post(f'{BASE}/{cid}/block', headers=auth(uid), json={'blocked': True}).status_code == 200
    api.post(f'{BASE}/{cid}/block', headers=auth('worker'), json={'blocked': False})
    send(api, cid, uid='worker', status=409)
    api.post(f'{BASE}/{cid}/block', headers=auth('worker2'), json={'blocked': False})
    send(api, cid)
    main.operations_store.run(lambda u: u.put('market_access_trials', 'worker2', dict(id='worker2', starts_at=time.time() - 91 * 86400)))
    send(api, cid, status=402)
    assert api.get(f'{BASE}/{cid}/messages', headers=auth('worker2')).status_code == 200
    assert api.post(f'{BASE}/{cid}/read', headers=auth('worker2'), json={'through_seq': 2}).status_code == 200
    assert api.post(f'{BASE}/{cid}/block', headers=auth('worker2'), json={'blocked': True}).status_code == 200
    assert api.post(f'{BASE}/{cid}/report', headers=auth('worker2'), json={'reason': 'This conversation needs review.'}).status_code == 200


def test_secondhand_offers_seller_decisions_and_sequenced_status(api):
    opened, _ = open_chat(api, listing())
    cid = opened['chat']['id']
    for fields in ({'amount_paise': None}, {'amount_paise': 0}, {'amount_paise': True}, {'amount_paise': 100, 'exchange_listing_id': 'other'}):
        send(api, cid, kind='offer', body='', status=422, **fields)
    send(api, cid, uid='worker', kind='offer', amount_paise=90000, body='', status=403)
    result, _ = send(api, cid, kind='offer', amount_paise=90000, body='My offer')
    mid = result['message']['id']
    decision = f'{BASE}/{cid}/offers/{mid}'
    assert api.post(decision, headers=auth('worker2'), json={'decision': 'accepted'}).status_code == 403
    accepted = api.post(decision, headers=auth('worker'), json={'decision': 'accepted'})
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()['message']['offer']['status'] == 'accepted'
    polled = api.get(f'{BASE}/{cid}/messages?after=2', headers=auth('worker2')).json()
    assert polled['messages'][0]['kind'] == 'offer_update' and polled['messages'][0]['offer_message_id'] == mid
    assert 'no payment or reservation' in polled['messages'][0]['body']
    assert api.post(decision, headers=auth('worker'), json={'decision': 'accepted'}).json()['chat']['latest_seq'] == 3
    assert api.post(decision, headers=auth('worker'), json={'decision': 'declined'}).status_code == 409
    assert main.operations_store.run(lambda u: u.all('market_listings'))[0]['status'] == 'published'


def test_exchange_offer_must_be_own_active_exchange_and_revalidated_on_accept(api):
    opened, _ = open_chat(api, listing(mode='exchange'))
    cid = opened['chat']['id']
    own = listing(uid='worker2', mode='exchange')
    foreign = listing(uid='worker', mode='exchange')
    secondhand = listing(uid='worker2')
    closed = listing(uid='worker2', mode='exchange', status='closed')
    for candidate in ('missing', foreign['id'], secondhand['id'], closed['id']):
        send(api, cid, kind='offer', body='', exchange_listing_id=candidate, status=422)
    send(api, cid, kind='offer', body='', exchange_listing_id=own['id'], amount_paise=100, status=422)
    result, _ = send(api, cid, kind='offer', body='', exchange_listing_id=own['id'])
    assert set(result['message']['offer']['exchange_listing']) == {'id', 'name', 'image_url', 'status'}
    main.operations_store.run(lambda u: u.put('market_listings', own['id'], {**own, 'status': 'closed'}))
    assert api.post(f"{BASE}/{cid}/offers/{result['message']['id']}", headers=auth('worker'), json={'decision': 'accepted'}).status_code == 409
    assert api.post(f"{BASE}/{cid}/offers/{result['message']['id']}", headers=auth('worker'), json={'decision': 'declined'}).status_code == 200


def test_message_pages_exact_forward_and_backward_and_no_global_scan(api, monkeypatch):
    opened, _ = open_chat(api, listing())
    cid = opened['chat']['id']
    # Cross a page boundary without triggering a real sender's minute allowance.
    def seed(u):
        chat = u.get('market_chats', cid)
        for index in range(105):
            messaging._append(u, chat, 'seller' if index % 2 else 'buyer', body=f'Message {index}', now=time.time() + index / 1000)
    main.operations_store.run(seed)
    import operations
    def no_scan(self, kind):
        raise AssertionError('Messaging may not scan ' + kind)
    monkeypatch.setattr(operations.Unit, 'all', no_scan)
    latest = api.get(f'{BASE}/{cid}/messages', headers=auth('worker2')).json()
    assert [m['seq'] for m in latest['messages']] == list(range(57, 107))
    older = api.get(f"{BASE}/{cid}/messages?before={latest['next_cursor']}", headers=auth('worker2')).json()
    assert [m['seq'] for m in older['messages']] == list(range(7, 57))
    all_seq = []
    after = 0
    while True:
        page = api.get(f'{BASE}/{cid}/messages?after={after}', headers=auth('worker2')).json()
        all_seq += [m['seq'] for m in page['messages']]
        after = page['next_after']
        if not page['has_more']:
            break
    assert all_seq == list(range(1, 107))
    assert api.get(BASE, headers=auth('worker')).json()['unread_count'] == 54
    assert api.get(f'{BASE}/{cid}/messages?before=1', headers=auth('worker2')).json()['messages'] == []
    assert api.get(f'{BASE}/{cid}/messages?after=107', headers=auth('worker2')).status_code == 422
    assert api.get(f'{BASE}/{cid}/messages?after=1&before=5', headers=auth('worker2')).status_code == 422


def test_inbox_bounded_sorted_cursor_side_and_total_unread_across_pages(api):
    now = time.time()
    def seed(u):
        for index in range(55):
            lid = f'fixture-{index}'
            row = dict(id=lid, owner_id='worker', owner_name='Seller', mode='second_hand', status='published', expires_at=now + 86400,
                       created_at=now, photo_id='photo', name=f'Camera {index}', value_paise=100000, city='Balasore', fee_status='paid')
            u.put('market_listings', lid, row)
            cid = messaging._key(lid, 'worker2')
            chat = dict(id=cid, listing_id=lid, listing=messaging._listing_view(row, {}), buyer_id='worker2', seller_id='worker', buyer_name='Buyer', seller_name='Seller', latest_seq=0, buyer_count=0, seller_count=0, created_at=now, updated_at=now)
            messaging._append(u, chat, 'buyer', body='Hello', now=now + index)
    main.operations_store.run(seed)
    first = api.get(BASE, headers=auth('worker')).json()
    assert len(first['chats']) == 50 and first['unread_count'] == 55 and first['next_cursor']
    assert first['chats'][0]['listing']['name'] == 'Camera 54'
    second = api.get(BASE + '?cursor=' + first['next_cursor'], headers=auth('worker')).json()
    assert len(second['chats']) == 5 and second['next_cursor'] is None and second['unread_count'] == 55
    assert not set(c['id'] for c in first['chats']) & set(c['id'] for c in second['chats'])
    assert [chat['id'] for chat in api.get(BASE + '?side=selling', headers=auth('worker')).json()['chats']] == [chat['id'] for chat in first['chats']]
    assert api.get(BASE + '?side=buying', headers=auth('worker')).json()['chats'] == []
    assert api.get(BASE + '?cursor=garbage', headers=auth('worker')).status_code == 422
    assert api.get(BASE + '?cursor=%%%notbase64', headers=auth('worker')).status_code == 422


def test_report_context_scoped_admin_and_idempotent_resolution(api):
    opened, _ = open_chat(api, listing(), body='Email fraud@example.com or call +919876543210 for help')
    cid = opened['chat']['id']
    unrelated, _ = open_chat(api, listing())
    foreign_mid = unrelated['messages'][0]['id']
    assert api.post(f'{BASE}/{cid}/report', headers=auth('worker2'), json={'reason': 'Please review this message.', 'message_id': foreign_mid}).status_code == 404
    payload = dict(reason='An advance payment was requested.', message_id=opened['messages'][0]['id'])
    report = api.post(f'{BASE}/{cid}/report', headers=auth('worker2'), json=payload).json()
    assert api.post(f'{BASE}/{cid}/report', headers=auth('worker2'), json=payload).json() == report
    path = '/operations/admin/market/chats/reports'
    assert api.get(path, headers=auth('worker')).status_code == 403
    cases = api.get(path, headers=ADMIN).json()['reports']
    assert len(cases) == 1 and 'phone removed' in cases[0]['message_context'] and 'email removed' in cases[0]['message_context']
    assert not {'user_id', 'buyer_id', 'seller_id', 'messages'} & cases[0].keys()
    resolution = dict(status='resolved', note='Reviewed the reported message and safety guidance.')
    for _ in range(2):
        assert api.post(path + '/' + report['id'] + '/resolve', headers=ADMIN, json=resolution).status_code == 200
    assert api.get(path, headers=ADMIN).json()['reports'] == []
    assert api.get(path + '?status=resolved', headers=ADMIN).json()['reports'][0]['id'] == report['id']


def test_concurrent_sends_are_gapless_and_replay_exactly_once(api):
    opened, _ = open_chat(api, listing(), body='')
    cid = opened['chat']['id']
    requests = [dict(request_id=str(uuid.uuid4()), kind='text', body=f'Concurrent {i}') for i in range(8)]
    with ThreadPoolExecutor(max_workers=4) as pool:
        responses = list(pool.map(lambda body: api.post(f'{BASE}/{cid}/messages', headers=auth('worker2'), json=body), requests + requests))
    assert all(response.status_code == 200 for response in responses)
    messages = api.get(f'{BASE}/{cid}/messages', headers=auth('worker')).json()['messages']
    assert [message['seq'] for message in messages] == list(range(1, 9))
    assert len({message['body'] for message in messages}) == 8
    assert api.get(BASE, headers=auth('worker')).json()['unread_count'] == 8


def test_rate_limit_and_validation_fail_without_partial_trial_or_message(api):
    opened, _ = open_chat(api, listing(), body='')
    cid = opened['chat']['id']
    now = time.time()
    key = messaging._key('worker2', 'messages_minute', int(now // 60))
    main.operations_store.run(lambda u: u.put('market_chat_limits', key, dict(id=key, count=60)))
    send(api, cid, status=429)
    assert api.get(f'{BASE}/{cid}/messages', headers=auth('worker')).json()['messages'] == []
    send(api, cid, body='', status=422)
    send(api, cid, body='x' * 2001, status=422)
    send(api, cid, kind='text', amount_paise=100, status=422)
    assert api.get(BASE + '/invalid/messages', headers=auth('worker2')).status_code == 404
    assert api.post(BASE, headers=auth('worker2'), json={'listing_id': 'private/document', 'request_id': str(uuid.uuid4())}).status_code == 422
    assert api.post(BASE + '/' + cid + '/report', headers=auth('worker2'), json={'reason': 'Please review this message.', 'message_id': 'private/document'}).status_code == 422


def test_firestore_inbox_keyset_is_account_bound_bounded_and_matches_indexes(monkeypatch):
    """Serialize the actual SDK query without contacting Firestore or using credentials."""
    import json
    from pathlib import Path
    from types import SimpleNamespace
    from google.auth.credentials import AnonymousCredentials
    from google.cloud.firestore_v1 import Client, Query

    client = Client(project='market-chat-query-test-only', credentials=AnonymousCredentials())
    captured = []
    transaction = object()

    def stream(query, transaction=None):
        captured.append((query._to_protobuf(), transaction))
        return iter([])

    monkeypatch.setattr(Query, 'stream', stream)
    core = SimpleNamespace(fs_collection=lambda name: client.collection(name),
                           fs_doc=lambda name, key: client.collection(name).document(key))
    unit = SimpleNamespace(core=core, tx=transaction, pending={}, fetched={})
    boundary = [1792147000.125, 'a' * 64]
    assert messaging._inbox_page(unit, 'private-buyer', 'all', None) == []
    assert messaging._inbox_page(unit, 'private-buyer', 'all', boundary) == []
    assert messaging._inbox_page(unit, 'private-buyer', 'selling', boundary) == []
    indexes = json.loads((Path(__file__).resolve().parents[1] / 'firestore.indexes.json').read_text())['indexes']

    for index, (query, actual_transaction) in enumerate(captured):
        assert actual_transaction is transaction
        assert query.limit == 51
        assert query.from_[0].collection_id == 'ops_market_chat_inbox'
        assert not query.from_[0].all_descendants
        assert [(order.field.field_path, int(order.direction)) for order in query.order_by] == [('updated_at', 2), ('__name__', 2)]
        filters = list(query.where.composite_filter.filters) if index == 2 else [query.where]
        assert [(value.field_filter.field.field_path, value.field_filter.value.string_value, int(value.field_filter.op)) for value in filters] == ([('user_id', 'private-buyer', 5), ('side', 'selling', 5)] if index == 2 else [('user_id', 'private-buyer', 5)])
        if index:
            assert not query.start_at.before  # Exclusive start_after, in descending order.
            assert len(query.start_at.values) == 2
            assert query.start_at.values[0].double_value == boundary[0]
            assert query.start_at.values[1].reference_value == f'projects/market-chat-query-test-only/databases/(default)/documents/ops_market_chat_inbox/{boundary[1]}'
        else:
            assert not query.start_at.values
        expected_fields = ([{'fieldPath': 'user_id', 'order': 'ASCENDING'}, {'fieldPath': 'side', 'order': 'ASCENDING'}] if index == 2 else [{'fieldPath': 'user_id', 'order': 'ASCENDING'}]) + [{'fieldPath': 'updated_at', 'order': 'DESCENDING'}, {'fieldPath': '__name__', 'order': 'DESCENDING'}]
        assert any(definition['collectionGroup'] == 'ops_market_chat_inbox' and definition['queryScope'] == 'COLLECTION' and definition['fields'] == expected_fields for definition in indexes)
