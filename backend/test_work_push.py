"""FCM relay privacy, bounded queues, leases, partial receipts and retry safety."""
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from firebase_admin import messaging

import main
import operations
import repaidians_work
import work_push
import work_runtime


@pytest.fixture
def relay(tmp_path, monkeypatch):
    monkeypatch.setattr(main, 'DB_PATH', str(tmp_path / 'work-relay.db'))
    monkeypatch.setattr(main, 'USE_FIRESTORE', False)
    monkeypatch.setattr(main, 'fb_db', None)
    monkeypatch.setenv('REPAIDO_STORAGE', 'sqlite')
    monkeypatch.setenv('REPAIDO_PUSH_ENABLED', 'true')
    work_runtime.initialize(main)
    monkeypatch.setattr(work_push, '_messaging_app', lambda: None)
    # Eligibility is separately exercised by native discovery privacy tests.
    # A mutable gate here verifies the relay rechecks it at send time.
    allowed = {'value': True}
    monkeypatch.setattr(repaidians_work, 'delivery_allowed', lambda u, row: allowed['value'])
    monkeypatch.setattr(operations.Unit, 'all', lambda *args: (_ for _ in ()).throw(AssertionError('Unbounded collection scan')))
    return allowed


def seed(delivery_id='delivery', device_ids=('one', 'two'), **changes):
    now = time.time()
    def write(u):
        for key in device_ids:
            device = {'id': key, 'user_id': 'member', 'token': 'local-test-token-' + key,
                      'updated_at': now, 'active': True, 'platform': 'android', 'audience': 'agent'}
            u.put('devices', key, device)
            work_push.index_record(u, 'devices', key, device)
        row = {'id': delivery_id, 'sortKey': delivery_id, 'recipient_id': 'member', 'sender_id': 'owner',
               'notification_id': 'note-' + delivery_id, 'event': 'contract_update', 'target_id': 'contract',
               'delivery_status': 'pending', 'created_at': now, 'title': 'PRIVATE TITLE', 'body': 'PRIVATE SALARY', **changes}
        u.put('rp_work_delivery', delivery_id, row)
        work_push.index_record(u, 'rp_work_delivery', delivery_id, row)
    main.operations_store.run(write)


def row(key='delivery'):
    return main.operations_store.run(lambda u: u.get('rp_work_delivery', key))


def due_now(key='delivery'):
    def due(u):
        current = u.get('rp_work_delivery', key)
        current['next_attempt_at'] = 0
        u.put('rp_work_delivery', key, current)
        work_push.index_record(u, 'rp_work_delivery', key, current)
    main.operations_store.run(due)


def test_successful_delivery_has_stable_ids_no_private_payload_and_no_resend(relay, monkeypatch):
    seed()
    sent = []
    monkeypatch.setattr(messaging, 'send', lambda message, **kwargs: sent.append(message))
    assert work_push.process_deliveries(main)['sent'] == 2
    assert row()['delivery_status'] == 'sent'
    assert len(sent) == 2 and sent[0].data['notification_id'] == 'note-delivery'
    assert sent[0].android.notification.tag == 'delivery'
    assert 'PRIVATE' not in str(sent[0].data) + sent[0].notification.title + sent[0].notification.body
    assert work_push.process_deliveries(main)['attempted'] == 0


def test_partial_failure_retries_only_failed_device_and_backoff(relay, monkeypatch):
    seed()
    calls = []
    fail = {'value': True}
    def send(message, **kwargs):
        calls.append(message.token)
        if message.token.endswith('two') and fail['value']:
            raise RuntimeError('Transient provider failure')
    monkeypatch.setattr(messaging, 'send', send)
    work_push.process_deliveries(main)
    assert row()['delivery_status'] == 'retry' and row()['next_attempt_at'] > time.time()
    assert work_push.process_deliveries(main)['attempted'] == 0
    fail['value'] = False
    due_now()
    assert work_push.process_deliveries(main)['sent'] == 1
    assert row()['delivery_status'] == 'sent'
    assert calls.count('local-test-token-one') == 1 and calls.count('local-test-token-two') == 2


def test_invalid_token_is_disabled_without_mutating_a_replaced_token(relay, monkeypatch):
    seed(device_ids=('one',))
    monkeypatch.setattr(messaging, 'send', lambda *args, **kwargs: (_ for _ in ()).throw(messaging.UnregisteredError('Not registered')))
    assert work_push.process_deliveries(main)['invalid'] == 1
    device = main.operations_store.run(lambda u: u.get('devices', 'one'))
    assert device['active'] is False and device['token'] == ''
    assert row()['delivery_status'] == 'skipped'

    seed('replaced', device_ids=('two',))
    def replace_and_fail(message, **kwargs):
        def replace(u):
            current = u.get('devices', 'two'); current['token'] = 'replacement-token'; u.put('devices', 'two', current)
        main.operations_store.run(replace)
        raise messaging.UnregisteredError('Old token no longer registered')
    monkeypatch.setattr(messaging, 'send', replace_and_fail)
    work_push.process_deliveries(main)
    device = main.operations_store.run(lambda u: u.get('devices', 'two'))
    assert device['active'] is True and device['token'] == 'replacement-token'


def test_access_revoked_after_claim_prevents_send(relay, monkeypatch):
    seed(device_ids=('one',))
    claim = main.operations_store.run(lambda u: work_push._claim(u, 'delivery', time.time()))
    relay['value'] = False
    assert main.operations_store.run(lambda u: work_push._prepare(u, 'delivery', claim['lease_token'], 'one', time.time())) is None
    assert row()['device_states']['one'] == 'skipped'


def test_only_one_concurrent_lease_and_expired_lease_recovers(relay):
    seed(device_ids=('one',))
    def claim():
        return main.operations_store.run(lambda u: work_push._claim(u, 'delivery', time.time()))
    with ThreadPoolExecutor(max_workers=4) as executor:
        claimed = list(executor.map(lambda _: claim(), range(4)))
    assert sum(value is not None for value in claimed) == 1
    old = next(value for value in claimed if value)
    future = time.time() + work_push.LEASE_SECONDS + 1
    recovered = main.operations_store.run(lambda u: work_push._claim(u, 'delivery', future))
    assert recovered and recovered['lease_token'] != old['lease_token']
    main.operations_store.run(lambda u: work_push._receipt(u, 'delivery', old['lease_token'], 'one', 'sent'))
    assert not row()['device_states']


def test_terminal_and_future_delivery_rows_cannot_starve_due_work(relay, monkeypatch):
    for index in range(150):
        seed(f'terminal-{index}', device_ids=(), delivery_status='sent')
    seed('future', device_ids=('one',), delivery_status='retry', next_attempt_at=time.time() + 10000)
    seed('due', device_ids=('two',))
    sent = []
    monkeypatch.setattr(messaging, 'send', lambda message, **kwargs: sent.append(message.data['notification_id']))
    assert work_push.process_deliveries(main, limit=1)['sent'] == 2
    assert sent == ['note-due', 'note-due']
    assert 'attempts' not in row('future')
    assert row('future')['delivery_status'] == 'retry'


def test_retry_exhaustion_and_push_disabled_leave_safe_durable_state(relay, monkeypatch):
    seed(device_ids=('one',), attempts=work_push.MAX_ATTEMPTS)
    assert work_push.process_deliveries(main)['attempted'] == 0
    assert row()['delivery_status'] == 'failed'
    seed('disabled', device_ids=('two',))
    monkeypatch.setenv('REPAIDO_PUSH_ENABLED', 'false')
    assert work_push.process_deliveries(main)['enabled'] is False
    assert row('disabled')['delivery_status'] == 'pending'


def test_same_browser_token_new_account_suppresses_old_account_push_and_old_cleanup(relay, monkeypatch):
    seed(device_ids=('old-account-device',))
    claimed = main.operations_store.run(lambda u: work_push._claim(u, 'delivery', time.time()))
    token = 'local-test-token-old-account-device'
    def register_other(u):
        other = {'id': 'new-account-device', 'user_id': 'new-account', 'token': token,
                 'updated_at': time.time(), 'active': True, 'platform': 'web'}
        u.put('devices', other['id'], other)
        work_push.index_record(u, 'devices', other['id'], other)
    main.operations_store.run(register_other)
    assert main.operations_store.run(lambda u: work_push._prepare(u, 'delivery', claimed['lease_token'], 'old-account-device', time.time())) is None
    assert row()['device_states']['old-account-device'] == 'skipped'
    def deactivate_old(u):
        previous = u.get('devices', 'old-account-device'); previous.update(active=False, token='')
        u.put('devices', previous['id'], previous)
        work_push.index_record(u, 'devices', previous['id'], previous)
    main.operations_store.run(deactivate_old)
    owner = main.operations_store.run(lambda u: u.get('rp_work_token_owners', work_push.digest(token)))
    assert owner['active'] is True and owner['user_id'] == 'new-account' and owner['device_id'] == 'new-account-device'
    assert main.operations_store.run(lambda u: work_push._live_devices(u, 'new-account', time.time())) == ['new-account-device']


def test_actual_stable_device_id_transfer_blocks_old_send_and_stale_invalid_receipt(relay):
    seed(device_ids=('stable-token-device',))
    claimed = main.operations_store.run(lambda u: work_push._claim(u, 'delivery', time.time()))
    token = 'local-test-token-stable-token-device'
    def transfer(u):
        device = u.get('devices', 'stable-token-device')
        device.update(user_id='new-account', updated_at=time.time())
        u.put('devices', device['id'], device)
    main.operations_store.run(transfer)
    assert main.operations_store.run(lambda u: work_push._live_devices(u, 'member', time.time())) == []
    assert main.operations_store.run(lambda u: work_push._live_devices(u, 'new-account', time.time())) == ['stable-token-device']
    assert main.operations_store.run(lambda u: work_push._prepare(u, 'delivery', claimed['lease_token'], 'stable-token-device', time.time())) is None
    main.operations_store.run(lambda u: work_push._receipt(u, 'delivery', claimed['lease_token'], 'stable-token-device', 'invalid', token))
    device = main.operations_store.run(lambda u: u.get('devices', 'stable-token-device'))
    owner = main.operations_store.run(lambda u: u.get('rp_work_token_owners', work_push.digest(token)))
    assert device['user_id'] == 'new-account' and device['active'] is True
    assert owner['user_id'] == 'new-account' and owner['active'] is True


def test_historical_ownership_waits_for_complete_migration_and_cannot_overwrite_new_live_account(relay):
    now = time.time()
    historical = {'id': 'history', 'user_id': 'member', 'token': 'shared-token', 'updated_at': now - 300,
                  'active': True, 'platform': 'web'}
    def index_history(u):
        # Seed pre-migration records directly without the live registration hook.
        import json
        u.conn.execute('INSERT INTO operation_records VALUES(?,?,?)', ('devices', historical['id'], json.dumps(historical)))
        work_push.index_record(u, 'devices', historical['id'], historical, historical=True)
    main.operations_store.run(index_history)
    assert main.operations_store.run(lambda u: work_push._live_devices(u, 'member', now)) == []
    main.operations_store.run(lambda u: u.put('rp_work_backfill', 'devices', {'complete': True}))
    assert main.operations_store.run(lambda u: work_push._live_devices(u, 'member', now)) == ['history']
    latest = {'id': 'new-live', 'user_id': 'other', 'token': 'shared-token', 'updated_at': now, 'active': True}
    main.operations_store.run(lambda u: u.put('devices', latest['id'], latest))
    main.operations_store.run(lambda u: work_push.index_record(u, 'devices', historical['id'], historical, historical=True))
    owner = main.operations_store.run(lambda u: u.get('rp_work_token_owners', work_push.digest('shared-token')))
    assert owner['user_id'] == 'other' and owner['provenance'] == 'live'


def test_no_devices_during_migration_defers_without_consuming_provider_retries(relay):
    seed(device_ids=())
    assert work_push.process_deliveries(main)['attempted'] == 0
    assert row()['delivery_status'] == 'retry' and row()['reason'] == 'device_index_pending'
    assert 'attempts' not in row() and 'device_ids' not in row()
