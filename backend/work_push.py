"""Bounded FCM relay for the durable Repaidians work outbox.

External FCM I/O occurs outside transactions. Delivery claims are durable leases;
per-device receipts survive retries. FCM itself is at-least-once: a process crash
after FCM accepts a message and before its receipt commits can repeat that message.
The stable notification ID and Android tag let clients suppress duplicate alerts.
"""
import os
import time
import uuid
from datetime import timedelta

from repaidians import digest, lane, query, sort_key

MAX_DEVICES = 8
LEASE_SECONDS = 120
MAX_ATTEMPTS = 5
DEVICE_MAX_AGE = 60 * 86400
MAX_SENDS_PER_DISPATCH = 64
DISPATCH_SECONDS = 30


def _messaging_app():
    import firebase_admin
    from firebase_admin import credentials
    try:
        return firebase_admin.get_app('repaido-work-push')
    except ValueError:
        return firebase_admin.initialize_app(credentials.ApplicationDefault(),
            {'projectId': os.getenv('GOOGLE_CLOUD_PROJECT', 'repaido'), 'httpTimeout': 10}, name='repaido-work-push')


def initialize(core):
    # Audience lanes use the existing operation_social_sort single-field index.
    from repaidians import initialize as initialize_social
    initialize_social(core)


def index_record(u, kind, key, row, historical=False):
    if kind == 'rp_work_delivery':
        active = row.get('delivery_status') not in ('sent', 'skipped', 'failed')
        due = (row.get('lease_until', 0) if row.get('delivery_status') == 'leased'
               else row.get('next_attempt_at', 0) or row.get('created_at', 0)) if active else 0
        u.put('rp_work_push_queue', key, {'id': key, 'sortKey': sort_key(int(due * 1000), key), 'active': active})
        return
    if kind != 'devices':
        return
    old = u.get('rp_work_device_index', key) or {}
    uid = row.get('user_id')
    previous = old.get('user_id')
    token_digest = digest(row['token']) if row.get('token') else None
    old_digest = old.get('token_digest')
    # Read ownership before buffering writes, including the previous token for
    # deactivation. Existing device IDs are stable token digests; the account can
    # change when the same browser registers after switching identity.
    current_owner = u.get('rp_work_token_owners', token_digest) if token_digest else None
    old_owner = u.get('rp_work_token_owners', old_digest) if old_digest else None
    if old_digest and (old_digest != token_digest or not row.get('active')):
        if old_owner and old_owner.get('device_id') == key and old_owner.get('user_id') == previous:
            u.put('rp_work_token_owners', old_digest, {**old_owner, 'active': False})
    if uid and token_digest and row.get('active'):
        # Live registrations establish the current browser account atomically.
        # Historical keyset migration can never overwrite a newer registration.
        incoming = (float(row.get('updated_at', 0)), key)
        current = (float((current_owner or {}).get('updated_at', 0)), (current_owner or {}).get('device_id', ''))
        if not historical or not current_owner or incoming > current:
            u.put('rp_work_token_owners', token_digest,
                  {'device_id': key, 'user_id': uid, 'updated_at': row.get('updated_at', 0),
                   'active': True, 'provenance': 'historical' if historical else 'live'})
    if previous and previous != uid:
        u.put(lane('rp_work_devices', previous), key,
              {'id': key, 'sortKey': sort_key(0, key), 'active': False})
    if uid:
        active = bool(row.get('active') and row.get('token'))
        stamp = int(max(0, row.get('updated_at', 0)) * 1000) if active else 0
        u.put(lane('rp_work_devices', uid), key,
              {'id': key, 'sortKey': sort_key(stamp, key), 'active': active})
    u.put('rp_work_device_index', key, {'user_id': uid, 'token_digest': token_digest})


def backfill_devices(core, limit=20):
    """One bounded historical device page, outside startup and public reads."""
    from repaidians_opportunities import native_scan
    limit = max(1, min(int(limit), 40))
    def select(u):
        checkpoint = u.get('rp_work_backfill', 'devices') or {}
        return checkpoint, [] if checkpoint.get('complete') else native_scan(u, 'devices', checkpoint.get('after', ''), limit + 1)
    checkpoint, rows = core.operations_store.run(select)
    for key, _ in rows[:limit]:
        def index(u, key=key):
            row = u.get('devices', key)
            if row:
                index_record(u, 'devices', key, row, historical=True)
        core.operations_store.run(index)
    if not checkpoint.get('complete'):
        after = rows[min(limit, len(rows)) - 1][0] if rows else checkpoint.get('after', '')
        def remember(u):
            latest = u.get('rp_work_backfill', 'devices') or {}
            if latest.get('after', '') <= after:
                u.put('rp_work_backfill', 'devices', {'after': after, 'complete': len(rows) <= limit})
        core.operations_store.run(remember)
    return {'indexed': min(limit, len(rows)), 'complete': checkpoint.get('complete', False) or len(rows) <= limit}


def _live_devices(u, uid, now):
    references = query(u, lane('rp_work_devices', uid), MAX_DEVICES * 2)
    u.prefetch([('devices', ref['id']) for ref in references if ref.get('active')])
    result = []
    for ref in references:
        device = u.get('devices', ref['id']) if ref.get('active') else None
        if (device and device.get('active') and device.get('token') and device.get('user_id') == uid
                and device.get('updated_at', 0) > now - DEVICE_MAX_AGE and _owns_token(u, device)):
            result.append(device['id'])
    return result[:MAX_DEVICES]


def _owns_token(u, device):
    if not device.get('token'):
        return False
    owner = u.get('rp_work_token_owners', digest(device['token'])) or {}
    migrated = (u.get('rp_work_backfill', 'devices') or {}).get('complete', False)
    return bool(owner.get('active') and owner.get('device_id') == device['id']
                and owner.get('user_id') == device.get('user_id')
                and (owner.get('provenance') == 'live' or migrated))


def _claim(u, key, now):
    from repaidians_work import delivery_allowed
    row = u.get('rp_work_delivery', key)
    if not row or row.get('delivery_status') in ('sent', 'skipped', 'failed'):
        return None
    if row.get('lease_until', 0) > now or row.get('next_attempt_at', 0) > now:
        return None
    if row.get('created_at', 0) + 86400 <= now or not delivery_allowed(u, row):
        row.update(delivery_status='skipped', reason='expired_or_no_access', lease_until=0)
        u.put('rp_work_delivery', key, row)
        return None
    attempts = int(row.get('attempts', 0))
    if attempts >= MAX_ATTEMPTS:
        row.update(delivery_status='failed', reason='retry_exhausted', lease_until=0)
        u.put('rp_work_delivery', key, row)
        return None
    if 'device_ids' not in row:
        row['device_ids'] = _live_devices(u, row['recipient_id'], now)
    if not row['device_ids']:
        if not (u.get('rp_work_backfill', 'devices') or {}).get('complete', False):
            row.pop('device_ids', None)
            row.update(delivery_status='retry', reason='device_index_pending', next_attempt_at=now + 60, lease_until=0)
            u.put('rp_work_delivery', key, row)
            return None
        row.update(delivery_status='skipped', reason='no_registered_device', lease_until=0)
        u.put('rp_work_delivery', key, row)
        return None
    row.update(delivery_status='leased', lease_until=now + LEASE_SECONDS,
               lease_token=str(uuid.uuid4()), attempts=attempts + 1)
    row.setdefault('device_states', {})
    u.put('rp_work_delivery', key, row)
    return row


def _prepare(u, key, lease, device_id, now):
    from repaidians_work import delivery_allowed
    row = u.get('rp_work_delivery', key)
    if not row or row.get('lease_token') != lease or row.get('delivery_status') != 'leased':
        return None
    if row.get('device_states', {}).get(device_id) in ('sent', 'invalid', 'skipped'):
        return None
    device = u.get('devices', device_id)
    if (row.get('created_at', 0) + 86400 <= now or not delivery_allowed(u, row)
            or not device or not device.get('active') or not device.get('token')
            or device.get('user_id') != row['recipient_id'] or device.get('updated_at', 0) <= now - DEVICE_MAX_AGE
            or not _owns_token(u, device)):
        row['device_states'][device_id] = 'skipped'
        u.put('rp_work_delivery', key, row)
        return None
    row['lease_until'] = now + LEASE_SECONDS
    u.put('rp_work_delivery', key, row)
    return row, device


def _receipt(u, key, lease, device_id, state, token=None):
    row = u.get('rp_work_delivery', key)
    if not row or row.get('lease_token') != lease or row.get('delivery_status') != 'leased':
        return
    # Do not disable a newly replaced token because a stale send failed.
    device = u.get('devices', device_id) if state == 'invalid' else None
    if device and device.get('token') == token and device.get('user_id') == row['recipient_id']:
        device.update(active=False, token='')
        u.put('devices', device_id, device)
        index_record(u, 'devices', device_id, device)
    row['device_states'][device_id] = state
    u.put('rp_work_delivery', key, row)


def _finish(u, key, lease, now):
    row = u.get('rp_work_delivery', key)
    if not row or row.get('lease_token') != lease or row.get('delivery_status') != 'leased':
        return
    states = row.get('device_states', {})
    pending = any(states.get(key) not in ('sent', 'invalid', 'skipped') for key in row['device_ids'])
    if pending:
        exhausted = row['attempts'] >= MAX_ATTEMPTS
        row.update(delivery_status='failed' if exhausted else 'retry',
                   reason='retry_exhausted' if exhausted else 'provider_retry',
                   next_attempt_at=now + min(900, 30 * 2 ** (row['attempts'] - 1)) + int(digest(key)[:2], 16) % 10)
    else:
        row.update(delivery_status='sent' if 'sent' in states.values() else 'skipped', completed_at=now)
    row.update(lease_until=0, lease_token='')
    u.put('rp_work_delivery', key, row)


def process_deliveries(core, limit=50):
    if os.getenv('REPAIDO_PUSH_ENABLED', '').lower() != 'true':
        return {'enabled': False, 'scanned': 0, 'attempted': 0, 'sent': 0, 'invalid': 0, 'retry': 0}
    from firebase_admin import messaging
    limit = max(1, min(int(limit), 100))
    def select(u):
        # Both ranges and ordering use one indexed field. Terminal tombstones and
        # future retries are excluded before applying the page bound.
        floor = '0000000000001:'
        ceiling = f'{int(time.time() * 1000):013d}:~'
        if u.tx is not None:
            q = (u.core.fs_collection('ops_rp_work_push_queue').where('sortKey', '>=', floor)
                 .where('sortKey', '<=', ceiling).order_by('sortKey').limit(limit))
            rows = [snapshot.to_dict() for snapshot in q.stream(transaction=u.tx)]
        else:
            import json
            rows = [json.loads(record['body']) for record in u.conn.execute(
                "SELECT body FROM operation_records WHERE kind='rp_work_push_queue' "
                "AND json_extract(body,'$.sortKey')>=? AND json_extract(body,'$.sortKey')<=? "
                "ORDER BY json_extract(body,'$.sortKey') LIMIT ?", (floor, ceiling, limit))]
        return rows
    rows = core.operations_store.run(select)
    result = {'enabled': True, 'scanned': len(rows), 'attempted': 0, 'sent': 0, 'invalid': 0, 'retry': 0}
    started = time.monotonic()
    for reference in rows:
        if result['attempted'] >= MAX_SENDS_PER_DISPATCH or time.monotonic() - started >= DISPATCH_SECONDS:
            break
        claimed = core.operations_store.run(lambda u: _claim(u, reference['id'], time.time()))
        if not claimed:
            continue
        key, lease = claimed['id'], claimed['lease_token']
        for device_id in claimed['device_ids']:
            if result['attempted'] >= MAX_SENDS_PER_DISPATCH or time.monotonic() - started >= DISPATCH_SECONDS:
                break
            prepared = core.operations_store.run(lambda u: _prepare(u, key, lease, device_id, time.time()))
            if not prepared:
                continue
            row, device = prepared
            result['attempted'] += 1
            state = 'sent'
            try:
                ttl = max(1, min(900, int(row['created_at'] + 86400 - time.time())))
                data = {'notification_id': row['notification_id'], 'destination': 'repaidians',
                        'work_event': row.get('event', row.get('type', '')),
                        'target_id': row['target_id'], 'recipient_id': row['recipient_id'],
                        'expires_at': str(int(time.time() + ttl))}
                # Source details are loaded after authorization on tap; salary,
                # full addresses and private contract terms never enter the push.
                messaging.send(messaging.Message(token=device['token'], data=data,
                    notification=messaging.Notification(title='Repaidians work update', body='Open Repaidians to view your latest work update.'),
                    android=messaging.AndroidConfig(priority='normal', ttl=timedelta(seconds=ttl),
                        notification=messaging.AndroidNotification(channel_id='repaido_tasks', tag=key, visibility='private'))),
                    app=_messaging_app())
            except messaging.UnregisteredError:
                state = 'invalid'
            except Exception:
                state = 'retry'
            result[state] += 1
            core.operations_store.run(lambda u: _receipt(u, key, lease, device_id, state, device['token']))
        core.operations_store.run(lambda u: _finish(u, key, lease, time.time()))
    return result
