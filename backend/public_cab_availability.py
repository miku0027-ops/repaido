"""Explicit, short-lived public cab availability; never reads private journey GPS.

Only coarse cells are retained, and public markers aggregate those cells. A
public marker is therefore neither a vehicle identity nor a tracking trail.
"""
import math
import secrets
import time

from fastapi import APIRouter, Depends, Query, Response
from pydantic import Field

from operations import Input, Position, fail, metres
from local_business import digest, partner_profile

POSITION_TTL = 75
SESSION_SECONDS = 1800
APPROXIMATION_METRES = 450
CELL_METRES = 600
RADIUS_METRES = 8000
HEADERS = {'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
           'X-Robots-Tag': 'noindex, nofollow'}


class Consent(Input):
    enabled: bool
    consent: bool = False
    expected_version: int | None = Field(default=None, ge=0)
    request_id: str = Field(default='', max_length=100)
    session_token: str = Field(default='', max_length=100)


class PublicPosition(Position):
    session_token: str = Field(min_length=32, max_length=100)
    sequence: int = Field(ge=1, strict=True)


def coarse_cell(pin):
    """600 m cells, including wrap-around and poles; max radius <450 m."""
    bands = math.ceil(180 * 111320 / CELL_METRES)
    band = min(bands - 1, max(0, int((pin['lat'] + 90) / 180 * bands)))
    latitude = -90 + (band + .5) * 180 / bands
    edge = max(0, abs(latitude) - 90 / bands)
    columns = max(1, math.ceil(360 * 111320 * math.cos(math.radians(edge)) / CELL_METRES))
    col = int(((pin['lng'] + 180) % 360) / 360 * columns) % columns
    return f'{band}:{col}', {'lat': latitude, 'lng': -180 + (col + .5) * 360 / columns}


def operator(v):
    return v.get('driver_id') or v['owner_id']


def resources(v):
    return sorted({'owner:' + v['owner_id'], 'vehicle:' + v['id'], 'operator:' + operator(v)})


def guard_versions(u, v):
    # These same documents serialize new reservations and driver assignment.
    return {key: (u.get('mobility_availability', key) or {}).get('generation', 0)
            for key in resources(v)}


def approval(u, v, now):
    if not v or not v.get('active') or v.get('status') != 'approved' or v.get('mode') not in ('cab', 'both') or v.get('valid_until', 0) <= now:
        return None
    owner = partner_profile(u, v['owner_id'], 'cab_owner') or {}
    driver = partner_profile(u, v['driver_id'], 'driver') if v.get('driver_id') else owner
    if any(not p or p.get('status') != 'approved' or p.get('valid_until', 0) <= now for p in (owner, driver)):
        return None
    return {'owner': owner.get('version', 0), 'driver': driver.get('version', 0),
            'valid_until': min(v['valid_until'], owner['valid_until'], driver['valid_until'])}


def busy(u, v):
    """A reserved cab/operator is not advertised as an available public cab."""
    who = operator(v)
    for kind in ('mobility_rides', 'shared_departures'):
        rows = u.find(kind, 'owner_id', v['owner_id']) + u.find(kind, 'driver_id', who)
        if who != v['owner_id']:
            rows += u.find(kind, 'owner_id', who)
        for row in rows:
            if row.get('state') in ('requested', 'completed', 'cancelled', 'expired'):
                continue
            same_vehicle = row.get('vehicle_id') == v['id']
            same_operator = row.get('mode', 'cab') != 'rental' and (row.get('driver_id') or row.get('owner_id')) == who
            if same_vehicle or same_operator:
                return True
    return False


def valid(u, v, row, now):
    if not row or not row.get('enabled') or row.get('expires_at', 0) <= now or not v:
        return False
    session = u.get('public_cab_operators', operator(v)) or {}
    return (session.get('vehicle_id') == v['id'] and session.get('token_hash') == row.get('token_hash')
            and row.get('operator_id') == operator(v)
            and row.get('vehicle_version') == v.get('version')
            and row.get('approvals') == approval(u, v, now)
            and row.get('approvals') is not None
            and row.get('guards') == guard_versions(u, v))


def state(u, v, row, now):
    enabled = valid(u, v, row, now)
    last = row.get('last_received_at', 0) if enabled else 0
    until = min(row['expires_at'], last + POSITION_TTL, row.get('last_captured_at', 0) + POSITION_TTL) if enabled and last else 0
    return {'version': (row or {}).get('version', 0), 'enabled': enabled,
            'expires_at': row.get('expires_at', 0) if enabled else 0,
            'last_received_at': last,
            'position_expires_at': until,
            'location_status': 'live' if until > now else 'waiting' if enabled else 'ended'}


def delete_reference(u, row):
    """Call last, after every transactional read; retain no heartbeat history."""
    ref = row.get('reference')
    if ref:
        if u.tx is not None:
            u.tx.delete(u.core.fs_doc('ops_' + ref['lane'], ref['key']))
        else:
            u.conn.execute('DELETE FROM operation_records WHERE kind=? AND id=?', (ref['lane'], ref['key']))


def available(u, pin, now=None):
    """Bounded recent area lookups; no global scan, new index or GPS history."""
    from repaidians_work import active_query
    from transport_discovery import nearby_lanes
    now = now or time.time()
    # Reuse the existing spherical 20 km lane cover, then apply the 8 km bound
    # to the coarse point itself. Probe radius can never reveal the raw GPS.
    refs = [ref for lane in nearby_lanes(pin)
            for ref in active_query(u, lane.replace('transport_shared_', 'transport_public_cab_'), 64,
                                    f'{int((now - POSITION_TTL) * 1000):016d}:')]
    ids = {ref['vehicle_id'] for ref in sorted(refs, key=lambda ref: ref['id'], reverse=True)[:64] if ref.get('vehicle_id')}
    u.prefetch([('public_cab_availability', key) for key in ids] + [('mobility_vehicles', key) for key in ids])
    related = set()
    for key in ids:
        v = u.get('mobility_vehicles', key)
        if not v:
            continue
        related.update(('mobility_availability', resource) for resource in resources(v))
        related.add(('public_cab_operators', operator(v)))
        related.update({('business_partners', v['owner_id']), ('business_partners', v['owner_id'] + ':cab_owner')})
        if v.get('driver_id'):
            related.update({('business_partners', v['driver_id']), ('business_partners', v['driver_id'] + ':driver')})
    u.prefetch(sorted(related))
    groups = {}
    for key in sorted(ids):
        row = u.get('public_cab_availability', key)
        v = u.get('mobility_vehicles', key)
        if not valid(u, v, row, now) or not row.get('position'):
            continue
        # Capture freshness independently prevents old readings extending a pin.
        until = min(row['expires_at'], row['last_received_at'] + POSITION_TTL,
                    row['last_captured_at'] + POSITION_TTL)
        # Public discovery cannot imply bookability outside the existing
        # registered pickup service area accepted by the quotation API.
        if until <= now or metres(pin, row['position']) > RADIUS_METRES or metres(pin, v['location']) > RADIUS_METRES:
            continue
        cell = row['cell']
        marker = groups.setdefault(cell, {'id': digest('public-cab-cell:' + cell)[:24],
            'position': row['position'], 'available_count': 0,
            'updated_at': math.floor(row['last_received_at'] / 15) * 15,
            'expires_at': until, 'approximation_metres': APPROXIMATION_METRES})
        marker['available_count'] += 1
        marker['expires_at'] = min(marker['expires_at'], until)
        marker['updated_at'] = min(marker['updated_at'], math.floor(row['last_received_at'] / 15) * 15)
    responded_at = time.time()
    return {'available_cabs': sorted((marker for marker in groups.values() if marker['expires_at'] > responded_at),
                                    key=lambda marker: (metres(pin, marker['position']), marker['id']))[:40],
            'server_time': responded_at, 'radius_km': 8, 'position_ttl_seconds': POSITION_TTL,
            'approximation_metres': APPROXIMATION_METRES}


def install(core):
    store = core.operations_store
    r = APIRouter(prefix='/operations/local-business', tags=['Opt-in public cab availability'])

    @r.get('/transport/available-cabs')
    def public_available(response: Response, lat: float = Query(ge=-90, le=90), lng: float = Query(ge=-180, le=180)):
        response.headers.update(HEADERS)
        if not math.isfinite(lat) or not math.isfinite(lng):
            fail('LOCATION_REQUIRED', 'Choose your pickup area on the map.', 422)
        return store.run(lambda u: available(u, {'lat': lat, 'lng': lng}))

    @r.get('/transport/public-availability')
    def mine(response: Response, user=Depends(core.current_user)):
        response.headers.update(HEADERS)
        def read(u):
            now = time.time()
            rows = {v['id']: v for v in u.find('mobility_vehicles', 'owner_id', user['id']) + u.find('mobility_vehicles', 'driver_id', user['id'])}
            out = []
            for v in rows.values():
                eligible = operator(v) == user['id'] and approval(u, v, now) is not None and not busy(u, v)
                out.append({**{key: v.get(key) for key in ('id', 'name', 'seats', 'vehicle_kind')},
                            'eligible': eligible,
                            'reason': '' if eligible else 'Only the approved assigned driver, or owner when no driver is assigned, may share an unreserved cab.',
                            'sharing': state(u, v, u.get('public_cab_availability', v['id']), now)})
            return {'vehicles': out, 'server_time': now, 'position_ttl_seconds': POSITION_TTL,
                    'session_duration_seconds': SESSION_SECONDS, 'approximation_metres': APPROXIMATION_METRES}
        return store.run(read)

    @r.post('/vehicles/{identifier}/public-availability')
    def consent(identifier: str, body: Consent, response: Response, user=Depends(core.current_user)):
        response.headers.update(HEADERS)
        token = secrets.token_urlsafe(32)
        def save(u):
            now = time.time()
            v = u.get('mobility_vehicles', identifier)
            if not v or user['id'] not in (v['owner_id'], operator(v)):
                fail('NOT_FOUND', 'Vehicle unavailable.', 404)
            old = u.get('public_cab_availability', identifier) or {'version': 0}
            if body.enabled:
                if operator(v) != user['id'] or approval(u, v, now) is None:
                    fail('APPROVAL_REQUIRED', 'Only the current approved operator may share this cab.', 403)
                if not body.consent or len(body.request_id) < 16:
                    fail('CONSENT_REQUIRED', 'Explicitly agree to show this approximate cab area publicly.', 422)
                if body.expected_version != old['version']:
                    fail('STALE', 'Availability changed. Refresh before enabling it again.', 409)
                if busy(u, v):
                    fail('CAB_BUSY', 'Finish this cab or operator’s reserved journeys before going available.', 409)
                other = u.get('public_cab_operators', user['id']) or {}
                if other.get('vehicle_id') and other['vehicle_id'] != identifier:
                    previous = u.get('public_cab_availability', other['vehicle_id'])
                    previous_vehicle = u.get('mobility_vehicles', other['vehicle_id'])
                    if valid(u, previous_vehicle, previous, now):
                        fail('OTHER_CAB_SHARING', 'Stop sharing your other cab before enabling this one.', 409)
                row = {'version': old['version'] + 1, 'enabled': True,
                       'request_hash': digest(body.request_id), 'operator_id': user['id'],
                       'vehicle_version': v['version'], 'approvals': approval(u, v, now),
                       'guards': guard_versions(u, v), 'token_hash': digest(token),
                       'expires_at': min(now + SESSION_SECONDS, approval(u, v, now)['valid_until']), 'sequence': 0}
                u.put('public_cab_availability', identifier, row)
                u.put('public_cab_operators', user['id'], {'vehicle_id': identifier, 'token_hash': row['token_hash']})
                delete_reference(u, old)
                return {'enabled': True, 'version': row['version'], 'session_token': token,
                        'expires_at': row['expires_at'], 'server_time': now, 'position_ttl_seconds': POSITION_TTL,
                        'approximation_metres': APPROXIMATION_METRES}
            if body.session_token:
                if not secrets.compare_digest(old.get('token_hash', ''), digest(body.session_token)):
                    return {'enabled': bool(old.get('enabled')), 'version': old['version'], 'status': 'superseded'}
            elif body.expected_version != old['version']:
                fail('STALE', 'Availability changed. Refresh before changing it.', 409)
            row = {'enabled': False, 'version': old['version'] + 1}
            u.put('public_cab_availability', identifier, row)
            session = u.get('public_cab_operators', old.get('operator_id', operator(v))) or {}
            if session.get('vehicle_id') == identifier and session.get('token_hash') == old.get('token_hash'):
                u.put('public_cab_operators', old['operator_id'], {})
            delete_reference(u, old)
            return {'enabled': False, 'version': row['version']}
        return store.run(save)

    @r.post('/vehicles/{identifier}/public-availability/position')
    def position(identifier: str, body: PublicPosition, response: Response, user=Depends(core.current_user)):
        response.headers.update(HEADERS)
        def save(u):
            now = time.time()
            v = u.get('mobility_vehicles', identifier)
            row = u.get('public_cab_availability', identifier)
            if not row or row.get('operator_id') != user['id'] or not valid(u, v, row, now) or not secrets.compare_digest(row.get('token_hash', ''), digest(body.session_token)):
                fail('PUBLIC_SHARING_ENDED', 'Public availability ended. Enable it again when this cab is free.', 410)
            if body.sequence <= row['sequence'] or body.captured_at <= row.get('last_captured_at', 0):
                fail('STALE_POSITION', 'A newer position has already arrived.', 409)
            if not all(math.isfinite(value) for value in (body.lat, body.lng, body.accuracy, body.captured_at)) or not 0 < body.accuracy <= 100 or not now - 30 <= body.captured_at <= now + 5:
                fail('PRECISE_LOCATION_REQUIRED', 'Allow a fresh GPS reading within 100 metres.', 422)
            if now - row.get('last_received_at', 0) < 10:
                fail('POSITION_RATE_LIMIT', 'Wait before another availability reading.', 429)
            cell, point = coarse_cell(body.model_dump())
            from transport_discovery import cell as lane_cell, lane
            channel = lane(*lane_cell(point)).replace('transport_shared_', 'transport_public_cab_')
            key = f'{int(now * 1000):016d}:{identifier}'
            previous = {'reference': row.get('reference')}
            row.update(position=point, cell=cell, last_received_at=now, last_captured_at=body.captured_at,
                       sequence=body.sequence, reference={'lane': channel, 'key': key})
            u.put(channel, key, {'id': key, 'active': True, 'vehicle_id': identifier})
            u.put('public_cab_availability', identifier, row)
            delete_reference(u, previous)
            return {'status': 'received', 'expires_at': row['expires_at'], 'server_time': now,
                    'position_expires_at': min(row['expires_at'], now + POSITION_TTL, body.captured_at + POSITION_TTL),
                    'location_status': 'live'}
        return store.run(save)

    core.app.include_router(r)
