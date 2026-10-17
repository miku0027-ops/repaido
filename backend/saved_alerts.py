"""Opt-in saved-item updates, with bounded durable checks and fresh visibility.

The private worker schedules this module. Saves never enable notification or push
permission. Each due item advances independently, including each catalogue page.
"""
import hashlib
import json
import logging
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import Depends
from pydantic import Field, model_validator
from operations import Input, fail

PAGE = 24
INTERVAL = 900
QUEUE = 'saved_alert_checks'
FLAGS = ('saved_searches', 'price_drops', 'following')
logger = logging.getLogger('repaido.saved_updates')
DEFAULTS = dict(saved_searches=False, price_drops=False, following=False,
                quiet_enabled=False, quiet_start='22:00', quiet_end='08:00', timezone='Asia/Kolkata')


class Preferences(Input):
    expected_version: int = Field(ge=0)
    saved_searches: bool
    price_drops: bool
    following: bool
    quiet_enabled: bool = False
    quiet_start: str = Field(default='22:00', pattern=r'^(?:[01]\d|2[0-3]):[0-5]\d$')
    quiet_end: str = Field(default='08:00', pattern=r'^(?:[01]\d|2[0-3]):[0-5]\d$')
    timezone: str = Field(default='Asia/Kolkata', min_length=1, max_length=80)

    @model_validator(mode='after')
    def valid(self):
        try:
            ZoneInfo(self.timezone)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError('Choose a valid timezone.') from None
        if self.quiet_enabled and self.quiet_start == self.quiet_end:
            raise ValueError('Quiet hours must have different start and end times.')
        return self


def digest(*parts):
    return hashlib.sha256(':'.join(str(x) for x in parts).encode()).hexdigest()


def preferences(u, uid):
    return {**DEFAULTS, 'version': 0, **(u.get('notification_preferences', uid) or {})}


def preference_view(row):
    return {key: row[key] for key in (*DEFAULTS, 'version')}


def channel(kind):
    if kind == 'home_search':
        return 'saved_searches'
    if kind in ('home', 'product', 'second_hand', 'exchange'):
        return 'price_drops'
    if kind in ('shop', 'professional'):
        return 'following'
    return None


def generation(saved, prefs):
    flag = channel(saved['kind'])
    return digest(saved.get('save_generation', saved['created_at']),
                  prefs.get('enabled_versions', {}).get(flag, prefs.get('enabled_since', {}).get(flag, 0)))


def _quiet(prefs, stamp):
    local = datetime.fromtimestamp(stamp, ZoneInfo(prefs['timezone'])).strftime('%H:%M')
    start, end = prefs['quiet_start'], prefs['quiet_end']
    return start <= local < end if start < end else local >= start or local < end


def next_allowed(prefs, now):
    if not prefs['quiet_enabled'] or not _quiet(prefs, now):
        return now
    # Walk UTC minute boundaries so repeated/missing daylight-saving hours have
    # the same meaning as the visible local clock; no naive offset arithmetic.
    stamp = (int(now) // 60 + 1) * 60
    for _ in range(26 * 60):
        if not _quiet(prefs, stamp):
            return stamp
        stamp += 60
    return stamp


def target(u, saved, reference=None):
    from customer_hub import saved_target
    kind = saved['kind']
    reference = reference or saved.get('reference', '')
    if kind in ('home', 'home_search'):
        row = u.get('home_listings', reference)
        if not row or row.get('status') != 'published':
            return None
        if kind == 'home_search' and not matches(saved, row):
            return None
        return {'title': row['title'], 'price_paise': row['rent_paise'],
                'version': row.get('version', row.get('updated_at', 0))}
    if kind == 'shop' and reference != saved['reference']:
        item = u.get('inventory', reference)
        if not item or item.get('shop_id') != saved['reference']:
            return None
        return saved_target(u, 'product', reference)
    return saved_target(u, kind, reference)


def matches(saved, row):
    return (row.get('status') == 'published'
            and (not saved.get('city', '').strip() or row.get('city_key') == saved['city'].strip().casefold())
            and (not saved.get('max_rent') or row['rent_paise'] <= saved['max_rent'])
            and (saved.get('bedrooms', -1) < 0 or row['bedrooms'] == saved['bedrooms']))


def sync_saved(u, uid, sid, saved, prefs=None, reschedule=False):
    """Called in the same transaction as save/remove/preference changes."""
    prefs = prefs or preferences(u, uid)
    key = digest(uid, sid)
    old = u.get(QUEUE, key)
    flag = channel(saved['kind']) if saved else None
    enabled = bool(flag and prefs[flag])
    if not enabled:
        if old and old.get('active'):
            u.put(QUEUE, key, {**old, 'active': False})
        return
    version = generation(saved, prefs)
    if old and old.get('active') and old.get('generation') == version:
        if reschedule:
            u.put(QUEUE, key, {**old, 'next_check_at': min(old['next_check_at'], time.time())})
        return
    now = time.time()
    snapshot = target(u, saved) if saved['kind'] != 'home_search' else None
    u.put(QUEUE, key, dict(id=key, user_id=uid, saved_id=sid, active=True,
        generation=version, next_check_at=now, after='', seeded=False,
        since=max(saved['created_at'], prefs.get('enabled_since', {}).get(flag, 0)),
        snapshot=snapshot, lowest_price=(snapshot or {}).get('price_paise'), sequence=0))


def due(u, now, limit):
    if u.tx is not None:
        from google.cloud.firestore_v1.field_path import FieldPath
        query = (u.core.fs_collection('ops_' + QUEUE).where('active', '==', True)
                 .where('next_check_at', '<=', now).order_by('next_check_at')
                 .order_by(FieldPath.document_id()).limit(limit))
        return [snapshot.to_dict() for snapshot in query.stream(transaction=u.tx)]
    return [json.loads(row['body']) for row in u.conn.execute(
        "SELECT body FROM operation_records WHERE kind='saved_alert_checks' "
        "AND json_extract(body,'$.active')=1 AND json_extract(body,'$.next_check_at')<=? "
        "ORDER BY json_extract(body,'$.next_check_at'),id LIMIT ?", (now, limit))]


def notification_visible(u, row, uid):
    if row.get('kind') != 'saved_update':
        return True
    if row.get('user_id') != uid:
        return False
    saved = (u.get('customer_saved', uid) or {}).get('entries', {}).get(row.get('saved_id'))
    prefs = preferences(u, uid)
    if not saved or not prefs.get(channel(saved['kind'])):
        return False
    expected = generation(saved, prefs)
    if row.get('generation') != expected:
        return False
    if (u.get('network_suspensions', uid) or {}).get('active'):
        return False
    if saved['kind'] == 'shop' and not target(u, saved):
        return False
    return target(u, saved, row.get('reference')) is not None


def notify(u, check, saved, reference, reason, fingerprint, now):
    nid = 'saved-' + digest(check['user_id'], check['saved_id'], check['generation'], reference, reason, fingerprint)
    if u.get('notifications', nid):
        return 0
    titles = {'price_drop': 'A saved item has a lower price', 'home_match': 'A home matches your saved search',
              'profile_update': 'A followed profile has an update', 'catalogue_update': 'A followed shop has a catalogue update'}
    row = dict(id=nid, user_id=check['user_id'], kind='saved_update', destination='saved',
               saved_id=check['saved_id'], saved_kind=saved['kind'], reference=reference,
               generation=check['generation'], alert_reason=reason, title=titles[reason],
               body='Open your saved items to review current availability and details.', created_at=now)
    if not notification_visible(u, row, check['user_id']):
        return 0
    u.put('notifications', nid, row)
    return 1


def _page(u, check, saved, now):
    kind = saved['kind']
    if kind == 'home_search':
        field, value = ('city_key', saved['city'].strip().casefold()) if saved.get('city', '').strip() else ('status', 'published')
        rows = u.find('home_listings', field, value, limit=PAGE, after=check['after'])
    else:
        if not target(u, saved):
            return 0
        rows = u.find('inventory', 'shop_id', saved['reference'], limit=PAGE, after=check['after'])
    delivered = 0
    for row in rows:
        current = target(u, saved, row['id'])
        if not current:
            continue
        key = digest(check['id'], check['generation'], row['id'])
        seen = u.get('saved_alert_seen', key)
        fingerprint = digest(json.dumps(current, sort_keys=True))
        if kind == 'home_search':
            changed = row.get('updated_at', 0) > check['since'] and (not seen or seen['fingerprint'] != fingerprint)
            reason = 'home_match'
        else:
            changed = (seen and seen['fingerprint'] != fingerprint) or (not seen and check['seeded'])
            reason = 'catalogue_update'
        sequence = (seen or {}).get('sequence', 0)
        if changed:
            sequence += 1
            # A later restock can return to the exact same catalogue snapshot.
            # Keep each observed transition distinct, while the transaction's
            # cursor and receipt still make worker retries idempotent.
            event_fingerprint = digest(fingerprint, sequence) if kind == 'shop' else fingerprint
            delivered += notify(u, check, saved, row['id'], reason, event_fingerprint, now)
        u.put('saved_alert_seen', key, {'id': key, 'fingerprint': fingerprint, 'sequence': sequence})
    check['after'] = rows[-1]['id'] if len(rows) == PAGE else ''
    if not check['after']:
        check['seeded'] = True
    return delivered


def process_updates(core, limit=10, now=None):
    now = time.time() if now is None else now
    limit = max(1, min(20, limit))
    rows = core.operations_store.run(lambda u: due(u, now, limit))
    delivered = 0
    failed = 0
    for selected in rows:
        def process(u):
            check = u.get(QUEUE, selected['id'])
            if not check or not check.get('active') or check['next_check_at'] > now:
                return 0
            uid, sid = check['user_id'], check['saved_id']
            saved = (u.get('customer_saved', uid) or {}).get('entries', {}).get(sid)
            prefs = preferences(u, uid)
            if not saved or not prefs.get(channel(saved['kind'])):
                check['active'] = False
                u.put(QUEUE, check['id'], check)
                return 0
            expected = generation(saved, prefs)
            if expected != check['generation']:
                sync_saved(u, uid, sid, saved, prefs)
                return 0
            allowed = next_allowed(prefs, now)
            check['next_check_at'] = max(now + INTERVAL, allowed)
            if allowed > now or (u.get('network_suspensions', uid) or {}).get('active'):
                u.put(QUEUE, check['id'], check)
                return 0
            count = 0
            current = target(u, saved) if saved['kind'] != 'home_search' else None
            if saved['kind'] in ('home_search', 'shop'):
                count += _page(u, check, saved, now)
                if check['after']:
                    check['next_check_at'] = now + 60
            if current:
                if channel(saved['kind']) == 'price_drops':
                    price = current.get('price_paise')
                    lowest = check.get('lowest_price')
                    if price is not None and lowest is not None and price < lowest:
                        count += notify(u, check, saved, saved['reference'], 'price_drop', str(price), now)
                    if price is not None:
                        check['lowest_price'] = min(price, lowest) if lowest is not None else price
                elif check.get('snapshot') and current != check['snapshot']:
                    check['sequence'] += 1
                    count += notify(u, check, saved, saved['reference'], 'profile_update', str(check['sequence']), now)
                check['snapshot'] = current
            check['checked_at'] = now
            check['consecutive_failures'] = 0
            check.pop('last_error_code', None)
            u.put(QUEUE, check['id'], check)
            return count
        try:
            delivered += core.operations_store.run(process)
        except Exception as error:
            # Rollback already kept the cursor and delivery receipt atomic. A
            # malformed legacy target must not monopolize the oldest due slot.
            def retry(u):
                check = u.get(QUEUE, selected['id'])
                if not check or not check.get('active') or check['next_check_at'] > now:
                    return
                if check.get('generation') != selected.get('generation'):
                    return
                attempts = min(8, check.get('consecutive_failures', 0) + 1)
                check.update(consecutive_failures=attempts, last_error_code='CHECK_FAILED',
                             next_check_at=now + min(3600, 60 * 2 ** attempts))
                u.put(QUEUE, check['id'], check)
            core.operations_store.run(retry)
            failed += 1
            logger.warning('saved_update check failed check=%s error_type=%s', selected['id'], type(error).__name__)
    return {'checked': len(rows), 'delivered': delivered, 'failed': failed}


def install(core, router):
    @router.get('/notification-preferences')
    def read(user=Depends(core.current_user)):
        return core.operations_store.run(lambda u: preference_view(preferences(u, user['id'])))

    @router.put('/notification-preferences')
    def save(body: Preferences, user=Depends(core.current_user)):
        def write(u):
            uid = user['id']
            old = preferences(u, uid)
            if old['version'] != body.expected_version:
                fail('STALE', 'Notification preferences changed. Refresh and try again.', 409)
            now = time.time()
            enabled_since = dict(old.get('enabled_since', {}))
            enabled_versions = dict(old.get('enabled_versions', {}))
            for flag in FLAGS:
                if getattr(body, flag) and not old[flag]:
                    enabled_since[flag] = now
                    enabled_versions[flag] = old['version'] + 1
            row = dict(body.model_dump(exclude={'expected_version'}), id=uid,
                       version=old['version'] + 1, enabled_since=enabled_since, enabled_versions=enabled_versions, updated_at=now)
            u.put('notification_preferences', uid, row)
            for sid, saved in (u.get('customer_saved', uid) or {}).get('entries', {}).items():
                sync_saved(u, uid, sid, saved, row, reschedule=True)
            return preference_view(row)
        return core.operations_store.run(write)
