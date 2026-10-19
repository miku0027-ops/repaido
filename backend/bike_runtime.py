"""Bounded worker membership, isolated rider incidents and safe recovery.

Membership is sharded so a departing worker never overwrites another worker's
health. Per-rider failures stop only that rider's new offers. Reservation truth
and event acknowledgement remain in the existing native transactions.
"""
import copy
import hashlib
import threading
import time
from collections import OrderedDict

SHARDS = 16
MEMBERS_PER_SHARD = 64
HEARTBEAT_TTL = 60
_SNAPSHOTS = OrderedDict()
_LOCK = threading.Lock()


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def shard(value):
    return int(digest(value)[:8], 16) % SHARDS


def fingerprint(config):
    from bike_dispatch import _configuration_fingerprint
    return _configuration_fingerprint(config)


def heartbeat(u, owner, config, *, connected, now=None, draining=False, backlog=None, partial=True):
    now = time.time() if now is None else now
    key = f'{shard(owner):02}'
    record = u.get('bike_dispatch_worker_registry', key) or {'members': {}}
    members = {key_: value for key_, value in record['members'].items()
               if -10 <= now-value.get('updated_at', 0) <= HEARTBEAT_TTL}
    if owner not in members and len(members) >= MEMBERS_PER_SHARD:
        raise RuntimeError('Dispatch membership capacity exceeded')
    members[owner] = {'updated_at': now, 'fingerprint': fingerprint(config),
                      'mode': config['mode'], 'connected': bool(connected), 'draining': bool(draining),
                      'outbox_backlog': backlog, 'outbox_backlog_is_lower_bound': bool(partial)}
    u.put('bike_dispatch_worker_registry', key, {'id': key, 'members': members})
    # Never retain a transaction's pending membership in a process cache.
    with _LOCK:
        _SNAPSHOTS.clear()


def pool_health(u, config, now=None):
    now = time.time() if now is None else now
    namespace = (id(u.core), str(getattr(u.core, 'DB_PATH', '')),
                 str(getattr(getattr(u.core, 'fb_db', None), 'project', '')))
    cache_key = (namespace, fingerprint(config))
    dirty = any(kind == 'bike_dispatch_worker_registry' for kind, _ in u.pending)
    with _LOCK:
        cached = _SNAPSHOTS.get(cache_key) if not dirty else None
        snapshot = copy.deepcopy(cached[1]) if cached and time.monotonic()-cached[0] < 2 else None
    if snapshot is None:
        keys = [f'{index:02}' for index in range(SHARDS)]
        u.prefetch([('bike_dispatch_worker_registry', key) for key in keys])
        snapshot = [value for key in keys for value in (u.get('bike_dispatch_worker_registry', key) or {}).get('members', {}).values()
                    if value.get('fingerprint') == fingerprint(config) and value.get('mode') == config['mode']]
        if not dirty:
            with _LOCK:
                _SNAPSHOTS[cache_key] = (time.monotonic(), copy.deepcopy(snapshot))
                while len(_SNAPSHOTS) > 32:
                    _SNAPSHOTS.popitem(last=False)
    live = [row for row in snapshot if -10 <= now-row.get('updated_at', 0) <= HEARTBEAT_TTL]
    healthy = [row for row in live if row.get('connected') and not row.get('draining')]
    backlogs = [row['outbox_backlog'] for row in healthy if isinstance(row.get('outbox_backlog'), int)]
    # Samples from multiple workers overlap; summing them would fabricate backlog.
    return {'ready': bool(healthy), 'mode': config['mode'], 'production_ready': bool(healthy), 'configured': True,
            'worker_online': bool(live), 'healthy_workers': len(healthy), 'online_workers': len(live),
            'degraded_workers': len(live)-len(healthy), 'worker_capacity': SHARDS*MEMBERS_PER_SHARD,
            'heartbeat_age_seconds': round(min((max(0, now-row['updated_at']) for row in live), default=0)) if live else None,
            'broker_connected': bool(healthy), 'outbox_backlog': max(backlogs) if backlogs else None,
            'outbox_backlog_is_lower_bound': True, 'consumer_lag': None,
            'reason': 'pool_degraded' if healthy and len(healthy) < len(live) else 'ready' if healthy else 'broker_unavailable' if live else 'worker_stale'}


def rider_blocked(u, rider):
    return bool((u.get('bike_dispatch_key_health', digest(rider)) or {}).get('blocked'))


def record_failure(store, rider, event_id, code, now=None):
    if not isinstance(rider, str) or not 1 <= len(rider) <= 128:
        return
    now = time.time() if now is None else now
    def save(u):
        key = digest(rider)
        old = u.get('bike_dispatch_key_health', key) or {}
        if old.get('event_id') == event_id and now-old.get('updated_at', 0) < 5:
            return  # Broker redelivery must not become a write storm.
        attempts = min(1000000, old.get('attempts', 0)+1) if old.get('event_id') == event_id else 1
        u.put('bike_dispatch_key_health', key, {'id': key, 'rider_id': rider, 'event_id': event_id,
              'blocked': True, 'active': True, 'error_code': code, 'attempts': attempts,
              'first_seen_at': old.get('first_seen_at', now) if old.get('event_id') == event_id else now,
              'updated_at': now, 'recovery': 'automatic_redelivery'})
    store.run(save)


def clear_failure(u, rider, event_id, now=None):
    key = digest(rider)
    old = u.get('bike_dispatch_key_health', key)
    # Completing a different preceding event cannot clear a later poisoned event.
    if old and old.get('blocked') and old.get('event_id') == event_id:
        u.put('bike_dispatch_key_health', key, {**old, 'blocked': False, 'active': False,
              'recovered_at': time.time() if now is None else now})


class RelayCursor:
    """Local fair progress only; rider leases and sequences are durable authority."""
    def __init__(self, owner):
        # Different instances start at different indexed ranges. A restart may
        # revisit ranges; durable per-rider leases and sequence prevent repeats.
        self.after = digest(owner)[:16]

    def references(self, u, limit):
        from repaidians_work import active_query
        rows = active_query(u, 'bike_dispatch_streams', min(32, max(1, limit)), self.after)
        if not rows and self.after:
            self.after = ''
            rows = active_query(u, 'bike_dispatch_streams', min(32, max(1, limit)))
        return rows


def maintenance(core, owner, now=None):
    """One bounded maintenance pass; replay is safe if a lease holder crashes."""
    now = time.time() if now is None else now
    store = core.operations_store
    def claim(u):
        lease = u.get('bike_dispatch_maintenance', 'lease') or {}
        if lease.get('until', 0) > now:
            return False
        u.put('bike_dispatch_maintenance', 'lease', {'owner': owner, 'until': now+30})
        return True
    if not store.run(claim):
        return False
    from bike_rides import process_deadlines
    from bike_payroll import tick
    from catalog_ratings import advance
    process_deadlines(core, limit=48)
    store.run(lambda u: tick(u, now))
    advance(core)
    return True
