"""Bike taxi reservations, server quotes and a finite, funded launch promotion.

A private verified-mobile quota and the existing mobility resource locks serialize all
bookings. An ordered Pub/Sub stream transports requests; its consumer owns the slot transaction.
Cash receipts and operator-recorded transfers are explicitly not gateway proof.
"""
import calendar
import copy
import hashlib
import hmac
import re
import json
import math
import os
import secrets
import time
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Literal

from fastapi import APIRouter, Depends, Response, Query
from pydantic import Field, model_validator
from operations import Input, Pin, Position, fail, metres
from local_business import digest, fingerprint, partner_profile, reservation_guard

INDIA = ZoneInfo('Asia/Kolkata')
CLOSED = {'completed', 'cancelled', 'declined', 'expired', 'unavailable'}
ACTIVE = ('dispatch_pending', 'offered', 'queued', 'accepted', 'on_the_way', 'arrived', 'in_progress', 'completion_pending', 'payment_due', 'payment_reported', 'disputed')
TRAVELLING = {'on_the_way', 'arrived', 'in_progress'}
DEFAULT = dict(version=0, enabled=False, cash_enabled=False, base_paise=800, per_km_paise=500,
               per_minute_paise=0, minimum_paise=0, gst_bps=0,
               service_radius_metres=4000, pickup_radius_metres=4000, promo_enabled=False,
               promo_started_at=None, free_distance_metres=2000, weekly_free_limit=3,
               cooldown_hours=36, promo_planning_budget_paise=0, promo_terms_reviewed=False, tax_reviewed=False, service_center=None, service_area_radius_metres=8000, service_area_reviewed=False, demand_surcharge_cap_bps=2500,
               terms='', evidence_reference='')
HEADERS = {'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer'}


class Policy(Input):
    expected_version: int = Field(ge=0)
    enabled: bool = False
    cash_enabled: bool = False
    base_paise: int = Field(default=800, ge=0, le=100000, strict=True)
    per_km_paise: int = Field(default=500, ge=0, le=100000, strict=True)
    per_minute_paise: Literal[0] = 0
    minimum_paise: int = Field(default=0, ge=0, le=100000, strict=True)
    gst_bps: int = Field(default=0, ge=0, le=3000, strict=True)
    service_radius_metres: int = Field(default=4000, ge=1000, le=8000, strict=True)
    pickup_radius_metres: int = Field(default=4000, ge=1000, le=4000, strict=True)
    promo_enabled: bool = False
    promo_started_at: float | None = Field(default=None, ge=0, le=4102444800)
    free_distance_metres: int = Field(default=2000, ge=1000, le=4000, strict=True)
    weekly_free_limit: int = Field(default=3, ge=1, le=3, strict=True)
    cooldown_hours: Literal[36] = 36
    promo_planning_budget_paise: int = Field(default=0, ge=0, le=1000000000, strict=True)
    promo_terms_reviewed: bool = False
    tax_reviewed: bool = False
    service_center: Pin | None = None
    service_area_radius_metres: int = Field(default=8000, ge=1000, le=50000, strict=True)
    service_area_reviewed: bool = False
    demand_surcharge_cap_bps: int = Field(default=2500, ge=0, le=2500, strict=True)
    terms: str = Field(min_length=20, max_length=2000)
    evidence_reference: str = Field(min_length=8, max_length=200)

    @model_validator(mode='after')
    def finite(self):
        if self.promo_started_at is not None and (not math.isfinite(self.promo_started_at) or self.promo_started_at < 0):
            raise ValueError('Choose a valid launch date.')
        if self.free_distance_metres > self.service_radius_metres:
            raise ValueError('Free ride distance cannot exceed the service distance.')
        return self


class Search(Input):
    pickup: Pin
    dropoff: Pin


class Booking(Input):
    quote_id: str = Field(min_length=1, max_length=100)
    request_id: str = Field(min_length=16, max_length=100)
    pickup_address: str = Field(min_length=5, max_length=300)
    dropoff_address: str = Field(min_length=5, max_length=300)
    rider_name: str = Field(min_length=2, max_length=100)
    rider_phone: str = Field(pattern=r'^\+?[0-9]{10,15}$')
    for_someone_else: bool = False
    consent: Literal[True]


class Availability(Input):
    vehicle_id: str = Field(min_length=1, max_length=100)
    online: bool
    position: Position | None = None


class Command(Input):
    command_id: str = Field(min_length=16, max_length=100)
    expected_version: int = Field(ge=1)
    action: Literal['accept', 'decline', 'depart', 'arrive', 'start', 'complete', 'confirm', 'cancel', 'cash_reported', 'cash_received', 'dispute']
    otp: str = Field(default='', max_length=6)
    position: Position | None = None
    note: str = Field(default='', max_length=1000)


class Resolve(Input):
    expected_version: int = Field(ge=1)
    action: Literal['cancel', 'complete']
    note: str = Field(min_length=10, max_length=1500)
    reference: str = Field(min_length=8, max_length=200)
    amount_paise: int = Field(default=0, ge=0, strict=True)


def months_after(epoch, months=6):
    current = datetime.fromtimestamp(epoch, INDIA)
    month = current.month - 1 + months
    year, month = current.year + month // 12, month % 12 + 1
    return current.replace(year=year, month=month, day=min(current.day, calendar.monthrange(year, month)[1])).timestamp()


def iso_week(epoch):
    year, week, _ = datetime.fromtimestamp(epoch, INDIA).isocalendar()
    return f'{year}-W{week:02}'


def policy(u):
    return {**DEFAULT, **(u.get('bike_policy', 'current') or {})}


def promo_quota_secret():
    value = os.getenv('REPAIDO_BIKE_PROMO_QUOTA_SECRET', '').encode('utf-8')
    return value if len(value) >= 32 and value.strip() else None


def promo_key_version():
    secret = promo_quota_secret()
    return hashlib.sha256(secret).hexdigest()[:16] if secret else None


def promo_identity(user):
    """Only the authenticated booker's provider-verified phone owns free quota.

    A passenger contact is never evidence. The dedicated stable key makes the
    identifier survive account deletion/recreation without storing raw phones.
    """
    secret = promo_quota_secret()
    phone = user.get('phone')
    if not secret or user.get('phone_verified') is not True or not isinstance(phone, str): return None
    phone = phone.strip()
    if not re.fullmatch(r'\+[1-9][0-9]{7,14}', phone): return None
    return hmac.new(secret, b'repaido-bike-promo-v1:'+phone.encode('ascii'), hashlib.sha256).hexdigest()


def readiness(p, now=None):
    now = time.time() if now is None else now
    end = months_after(p['promo_started_at']) if p.get('promo_started_at') is not None else None
    paid = p['tax_reviewed'] and p['cash_enabled'] and max(p['base_paise'], p['per_km_paise'], p['per_minute_paise'], p['minimum_paise']) > 0 and bool(p['terms'])
    promo = bool(p['promo_enabled'] and end and p['promo_started_at'] <= now < end and p['promo_terms_reviewed'] and promo_quota_secret())
    return dict(paid_ready=paid, promo_ready=promo, routing_ready=bool(os.getenv('GOOGLE_ROUTES_API_KEY', '').strip()),
                promo_identity_ready=bool(promo_quota_secret()), promo_ends_at=end, promo_months=6, arrival_radius_metres=300, payment_method='cash',
                geography_ready=bool(p.get('service_area_reviewed') and p.get('service_center')), city='Balasore')


def public_policy(p, u):
    fields = ('version', 'enabled', 'service_radius_metres', 'pickup_radius_metres', 'promo_enabled',
              'promo_started_at', 'free_distance_metres', 'weekly_free_limit', 'terms', 'demand_surcharge_cap_bps', 'service_center', 'service_area_radius_metres')
    from bike_dispatch import engine_health
    from bike_earnings import operations_readiness as policy_readiness
    runtime = readiness(p); staffing = policy_readiness(u, p, time.time(), funding_detail=True); dispatch = engine_health(u)
    runtime['paid_ready'] = bool(runtime['paid_ready'] and staffing.get('payroll_ready') and staffing.get('funding_ready'))
    runtime['promo_ready'] = bool(runtime['promo_ready'] and staffing.get('promo_pool_ready'))
    runtime['bookings_available'] = bool(p['enabled'] and runtime['geography_ready'] and p['tax_reviewed'] and runtime['routing_ready'] and dispatch['ready'] and runtime['paid_ready'])
    return {**{k: copy.deepcopy(p[k]) for k in fields}, **runtime, 'dispatch_ready': dispatch['ready'], 'dispatch_mode': dispatch['mode']}


def admin_policy_view(u, p):
    from bike_dispatch import engine_health
    from bike_earnings import operations_readiness as policy_readiness
    return {**copy.deepcopy(p), **readiness(p), **policy_readiness(u, p, time.time(), funding_detail=True), 'dispatch_ready': engine_health(u)['ready']}


def customer_pricing(pricing):
    # Internal tariffs are visible only to company administrators. Employees see
    # the customer invoice total; their salary never depends on individual fares.
    return {k: pricing[k] for k in ('total_paise', 'customer_total_paise', 'free', 'surcharge_bps', 'payment_method')}


def promotion(u, uid, distance, p, now=None, ignore=None, quota_key=None):
    now = time.time() if now is None else now
    quota = (u.get('bike_quota', quota_key) if quota_key else None) or {'entries': {}}
    entries = [v for key, v in quota['entries'].items() if key != ignore and v['state'] in ('reserved', 'used')]
    weekly = sum(v['week'] == iso_week(now) for v in entries)
    recent = max((v.get('used_at', v.get('planned_at', v['reserved_at'])) for v in entries), default=0)
    next_at = recent + p['cooldown_hours'] * 3600 if recent else now
    ready = readiness(p, now)
    from bike_earnings import operations_readiness as policy_readiness
    ready.update(policy_readiness(u, p, now))
    reason = 'available'
    if not ready['promo_ready'] or not ready.get('promo_pool_ready'): reason = 'promotion_unavailable'
    elif not quota_key: reason = 'phone_verification_required'
    elif distance > p['free_distance_metres']: reason = 'distance_outside_free_offer'
    elif weekly >= p['weekly_free_limit']: reason = 'weekly_limit_reached'
    elif next_at > now: reason = 'next_offer_not_ready'
    messages = {'phone_verification_required': 'Verify your mobile number to use free bike ride offers.', 'available': 'A free ride is available for this route.', 'promotion_unavailable': 'The free ride offer is currently unavailable.', 'distance_outside_free_offer': 'This route is outside the free ride offer.', 'weekly_limit_reached': 'Your free rides for this week have been used.', 'next_offer_not_ready': 'Your next free ride offer is not available yet.'}
    return dict(eligible=reason == 'available', message=messages[reason], remaining=max(0, p['weekly_free_limit'] - weekly),
                next_eligible_at=next_at if next_at > now else None, reason=reason)


def fare(p, distance, duration, surcharge_bps=0, free=False):
    base = p['base_paise']; dist = math.ceil(distance * p['per_km_paise'] / 1000)
    elapsed = math.ceil(duration * p['per_minute_paise'] / 60)
    subtotal = max(p['minimum_paise'], base + dist + elapsed)
    surcharge = (subtotal * min(surcharge_bps, p['demand_surcharge_cap_bps']) + 5000) // 10000
    gst = ((subtotal + surcharge) * p['gst_bps'] + 5000) // 10000
    total = subtotal + surcharge + gst
    return dict(base_paise=base, distance_paise=dist, time_paise=elapsed,
                minimum_adjustment_paise=subtotal-base-dist-elapsed, surcharge_bps=surcharge_bps,
                surcharge_paise=surcharge, gst_paise=gst, total_paise=total,
                customer_total_paise=0 if free else total, free=free,
                payment_method='cash')


def verified_route(origin, destination):
    from routing_cache import JOURNEYS, cache_key
    secret = os.getenv('GOOGLE_ROUTES_API_KEY', '').strip()
    if not secret: fail('ROUTING_UNAVAILABLE', 'Bike routes are temporarily unavailable.', 503)
    key = cache_key('bike-journey', origin, destination, hashlib.sha256(secret.encode()).hexdigest())
    try:
        return JOURNEYS.read(key, lambda: _provider_route(origin, destination))
    except Exception:
        fail('ROUTING_UNAVAILABLE', 'Bike routes are busy or unavailable. Please retry shortly.', 503)


def _provider_route(origin, destination):
    """Both distance and time come from the server's TWO_WHEELER provider quote."""
    key = os.getenv('GOOGLE_ROUTES_API_KEY', '').strip()
    if not key: fail('ROUTING_UNAVAILABLE', 'Bike routes are temporarily unavailable.', 503)
    point = lambda p: {'location': {'latLng': {'latitude': p['lat'], 'longitude': p['lng']}}}
    request = urllib.request.Request('https://routes.googleapis.com/directions/v2:computeRoutes',
        data=json.dumps({'origin': point(origin), 'destination': point(destination), 'travelMode': 'TWO_WHEELER',
                         'polylineEncoding': 'GEO_JSON_LINESTRING'}).encode(),
        headers={'Content-Type': 'application/json', 'X-Goog-Api-Key': key,
                 'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.geoJsonLinestring'})
    try:
        with urllib.request.urlopen(request, timeout=8) as response: row = json.load(response)['routes'][0]
        distance = row['distanceMeters']; duration = math.ceil(float(row['duration'].removesuffix('s')))
        points = [{'lat': float(p[1]), 'lng': float(p[0])} for p in row['polyline']['geoJsonLinestring']['coordinates']]
        if type(distance) is not int or not 100 <= distance <= 100000 or not 30 <= duration <= 14400 or not 2 <= len(points) <= 10000: raise ValueError()
        if any(not math.isfinite(p['lat']) or not math.isfinite(p['lng']) or not -90 <= p['lat'] <= 90 or not -180 <= p['lng'] <= 180 for p in points): raise ValueError()
        if metres(origin, points[0]) > 300 or metres(destination, points[-1]) > 300: raise ValueError()
        return dict(distance_metres=distance, duration_seconds=duration, points=points, provider='google_routes_two_wheeler')
    except OSError:
        raise
    except Exception: fail('ROUTE_FAILED', 'This bike route could not be confirmed. Check both pins and retry.', 503)


def fresh_position(position, now=None):
    now = time.time() if now is None else now
    if not position or not all(math.isfinite(position.get(k, float('nan'))) for k in ('lat', 'lng', 'accuracy', 'captured_at')) or not -90 <= position['lat'] <= 90 or not -180 <= position['lng'] <= 180 or not 0 < position['accuracy'] <= 100 or abs(now-position['captured_at']) > 120:
        fail('PRECISE_LOCATION_REQUIRED', 'Send a fresh GPS reading with accuracy within 100 metres.', 422)
    return {**position, 'received_at': now}


def authorized_vehicle(u, vehicle_id, driver_id=None, until=None, committed_ride=None):
    now = time.time(); until = until or now + 1800
    v = u.get('mobility_vehicles', vehicle_id)
    if not v or v.get('vehicle_kind') != 'bike' or v.get('seats') != 1 or v.get('mode') not in ('cab', 'both') or not v.get('active') or v.get('status') != 'approved' or v.get('valid_until', 0) <= until:
        fail('APPROVED_BIKE_REQUIRED', 'Choose an active bike with current approval.', 403)
    operator = v.get('driver_id') or v['owner_id']
    from bike_earnings import compensated_driver
    existing = bool(committed_ride and committed_ride.get('accepted_by_driver') and committed_ride.get('assigned_at')
                    and committed_ride['driver_id'] == operator and committed_ride['vehicle_id'] == vehicle_id)
    if not existing and not compensated_driver(u, operator, now): fail('RIDER_AGREEMENT_REQUIRED', 'This bike needs an approved salary or per-ride earning agreement.', 403)
    if driver_id and driver_id != operator: fail('NOT_ASSIGNED', 'Only this bike’s assigned rider can go online.', 403)
    owner = partner_profile(u, v['owner_id'], 'cab_owner') or {}
    driver = partner_profile(u, operator, 'driver') if v.get('driver_id') else owner
    if owner.get('status') != 'approved' or owner.get('valid_until', 0) <= until or not driver or driver.get('status') != 'approved' or driver.get('valid_until', 0) <= until:
        fail('APPROVAL_REQUIRED', 'Current vehicle-owner and rider approvals are required.', 403)
    return v, operator, driver


def active_reservations(u, vehicle, start, end, ignore='', mode='cab'):
    """Bounded physical resource lookups, shared with cab/rental/shared bookings."""
    operator = vehicle.get('driver_id') or vehicle['owner_id']
    operator_slot = _slot(u, operator) if mode != 'rental' else {}
    vehicle_slot = u.get('bike_vehicle_slots', vehicle['id']) or {}
    identifiers = {slot.get(key) for slot in (operator_slot, vehicle_slot) for key in ('current_id', 'next_id')} - {None, ignore}
    u.prefetch([('bike_rides', identifier) for identifier in identifiers])
    for identifier in identifiers:
        row = u.get('bike_rides', identifier)
        if not row or row['state'] in CLOSED or row['state'] in ('dispatch_pending', 'completion_pending', 'payment_due', 'payment_reported'): continue
        if row.get('vehicle_id') != vehicle['id'] and (mode == 'rental' or row.get('driver_id') != operator): continue
        if row['state'] in ('offered', 'queued', 'accepted') and row.get('expires_at', 0) <= time.time(): continue
        if row['state'] in ('in_progress', 'disputed', 'on_the_way', 'arrived') or row['starts_at'] < end and row['ends_at'] > start: return True
    return False


def _slot(u, operator):
    return u.get('bike_slots', digest(operator)) or {'driver_id': operator, 'current_id': None, 'next_id': None}


def _presence_live(presence, now):
    pos = (presence or {}).get('position') or {}
    return bool(presence and presence.get('online') and 0 <= now-pos.get('received_at', 0) <= 75 and 0 < pos.get('accuracy', 1000) <= 100 and abs(now-pos.get('captured_at', 0)) <= 120)


def _candidate(u, vehicle_id, pickup, p, now, duration):
    from local_business import conflicts
    try: v, operator, driver = authorized_vehicle(u, vehicle_id, until=now+duration+1800)
    except Exception as error:
        from fastapi import HTTPException
        if isinstance(error, HTTPException): return None
        raise
    from bike_runtime import rider_blocked
    if rider_blocked(u, operator): return None
    presence = u.get('bike_rider_presence', vehicle_id)
    if not _presence_live(presence, now) or presence['driver_id'] != operator: return None
    slot = _slot(u, operator)
    current = u.get('bike_rides', slot['current_id']) if slot.get('current_id') else None
    next_row = u.get('bike_rides', slot['next_id']) if slot.get('next_id') else None
    if next_row and next_row['state'] not in CLOSED and next_row.get('expires_at', now+1) > now: return None
    queued = bool(current and current['state'] not in CLOSED)
    if queued and current['vehicle_id'] != vehicle_id: return None
    if queued and (current['state'] != 'in_progress' or current['ends_at'] <= now or current['ends_at'] > now+900): return None
    origin = current['dropoff'] if queued else presence['position']
    distance = metres(origin, pickup)
    if distance > p['pickup_radius_metres']: return None
    available = current['ends_at'] if queued else now
    if conflicts(u, v, available, available+duration+1200, current['id'] if queued else ''): return None
    # Air distance is only a conservative discovery ordering; route quote follows.
    eta = max(60, math.ceil(distance / 4))
    return dict(id=v['id'], vehicle_id=v['id'], vehicle_name=v['name'], rider_name=driver.get('name', 'Repaido rider'),
                driver_id=operator, owner_id=v['owner_id'], queued=queued,
                parent_ride_id=current['id'] if queued else None, available_at=available,
                pickup_eta_seconds=eta+math.ceil(max(0, available-now)), location=origin,
                distance_metres=round(distance), position_version=presence.get('version', 1))


def _quota_release(u, row):
    if not row['pricing']['free']: return
    key = row.get('quota_key')
    if not key: return
    quota = u.get('bike_quota', key) or {'entries': {}}
    entry = quota['entries'].get(row['id'])
    if entry and entry['state'] == 'reserved':
        del quota['entries'][row['id']]; u.put('bike_quota', key, quota)


def _release_slot(u, row):
    if not row.get('assigned_at'): return
    slot = _slot(u, row['driver_id'])
    vehicle_slot = u.get('bike_vehicle_slots', row['vehicle_id']) or {}
    owns_operator = row['id'] in (slot.get('current_id'), slot.get('next_id'))
    owns_vehicle = row['id'] in (vehicle_slot.get('current_id'), vehicle_slot.get('next_id'))
    if not owns_operator:
        if owns_vehicle:
            for key in ('current_id', 'next_id'):
                if vehicle_slot.get(key) == row['id']: vehicle_slot[key] = None
            u.put('bike_vehicle_slots', row['vehicle_id'], vehicle_slot)
        return
    for key in ('current_id', 'next_id'):
        if slot.get(key) == row['id']: slot[key] = None
    if not slot.get('current_id') and slot.get('next_id'):
        queued = u.get('bike_rides', slot['next_id'])
        slot['next_id'] = None
        if queued and queued['state'] == 'queued':
            if queued['expires_at'] <= time.time():
                queued['state'] = 'expired'; _quota_release(u, queued); _save(u, queued, 'expired', 'system')
            else:
                slot['current_id'] = queued['id']; queued['queued'] = False
                queued['state'] = 'accepted' if queued.get('accepted_by_driver') else 'offered'
                queued['available_at'] = time.time(); queued['starts_at'] = time.time()
                presence = u.get('bike_rider_presence', queued['vehicle_id']) or {}
                origin = presence.get('position') or row['dropoff']
                queued['pickup_eta_seconds'] = max(60, math.ceil(metres(origin, queued['pickup'])/4))
                queued['ends_at'] = time.time()+queued['pickup_eta_seconds']+queued['route_duration_seconds']+300
                queued['expires_at'] = time.time()+180; _save(u, queued, 'next_slot_ready', 'system')
    u.put('bike_slots', digest(row['driver_id']), slot)
    if owns_vehicle: u.put('bike_vehicle_slots', row['vehicle_id'], copy.deepcopy(slot))


def _refresh_index(u, vehicle_id):
    from bike_dispatch import index_availability
    presence = u.get('bike_rider_presence', vehicle_id)
    if not presence: return
    pos = presence.get('position'); slot = _slot(u, presence['driver_id'])
    current = u.get('bike_rides', slot['current_id']) if slot.get('current_id') else None
    ongoing = current and current['vehicle_id'] == vehicle_id and current['state'] == 'in_progress'
    # A ride mutation cannot turn an old GPS measurement into a fresh heartbeat.
    seen = (pos or {}).get('received_at', 0)
    index_availability(u, vehicle_id, pos, presence.get('online', False), current['ends_at'] if ongoing else time.time(),
                       seen, driver_id=presence['driver_id'], version=presence['version'],
                       next_pickup_origin=current['dropoff'] if ongoing else None)


def _save(u, row, action, actor):
    from bike_dispatch import enqueue
    from bike_earnings import sync_earning
    sync_earning(u, row)
    row['version'] += 1; row['updated_at'] = time.time()
    row.setdefault('events', []).append(dict(action=action, actor=actor, at=time.time(), version=row['version']))
    # Domain history is bounded; immutable dispatch sequence preserves event IDs.
    row['events'] = row['events'][-60:]
    u.put('bike_rides', row['id'], row)
    history_key = f"{9999999999999-int(row['created_at']*1000):013d}:"+row['id']
    u.put('bike_history_admin', history_key, {'id': history_key, 'ride_id': row['id'], 'active': True})
    for prefix, uid in [('customer', row['customer_id'])]+([('driver', row['driver_id'])] if row.get('assigned_at') else []):
        u.put('bike_history_'+prefix+'_'+digest(uid)[:32], history_key, {'id': history_key, 'ride_id': row['id'], 'active': True})
    _refresh_index(u, row['vehicle_id'])
    enqueue(u, row, action)
    recipients = {row['customer_id']}
    if row.get('assigned_at'): recipients.add(row['driver_id'])
    for uid in recipients:
        key = digest('bike:'+row['id']+':'+str(row['version'])+':'+uid)
        u.put('notifications', key, dict(id=key, user_id=uid, kind='local_business', destination='mobility', business_id=row['id'],
              bike_ride_id=row['id'], title={'offered': 'New bike request', 'next_slot_ready': 'Your next bike ride is ready',
              'arrive': 'Your rider has arrived', 'complete': 'Bike ride complete', 'start': 'Bike ride started'}.get(action, 'Bike ride updated'),
              body='Open your bike ride for the latest details.', created_at=time.time(), read=False))


def allowed_actions(row, uid):
    state = row['state']; customer = uid == row['customer_id']; driver = uid == row['driver_id']
    if state in CLOSED: return []
    if state == 'dispatch_pending': return ['cancel'] if customer else []
    actions = []
    if driver:
        if state in ('offered', 'queued') and not row.get('accepted_by_driver'): actions += ['accept', 'decline']
        if state == 'accepted': actions += ['depart']
        if state == 'on_the_way': actions += ['arrive']
        if state in ('on_the_way', 'arrived') and row.get('otp_attempts', 0) < 5: actions += ['start']
        if state == 'in_progress': actions += ['complete']
        if state == 'payment_reported': actions += ['cash_received']
    if customer:
        if state == 'completion_pending': actions += ['confirm']
        if state == 'payment_due': actions += ['cash_reported']
    if state in ('dispatch_pending', 'offered', 'queued', 'accepted', 'on_the_way', 'arrived'): actions += ['cancel']
    if state in ('in_progress', 'completion_pending', 'payment_due', 'payment_reported'): actions += ['dispute']
    return actions


def view(row, uid, now=None):
    from mobility_journeys import stop_proximity
    now = time.time() if now is None else now
    if uid not in (row['customer_id'], row['driver_id']) or uid == row['driver_id'] and not row.get('assigned_at'): fail('NOT_FOUND', 'Bike ride unavailable.', 404)
    result = {k: copy.deepcopy(v) for k, v in row.items() if k not in ('otp_value', 'request_hash', 'events', 'policy', 'promo_budget_closed', 'promo_reserved', 'quota_key', 'quota_key_version', 'compensation_offer', 'earning_fund_reserved_paise', 'earning_fund_allocations')}
    if uid == row['driver_id']:
        result['earnings_offer'] = copy.deepcopy(row.get('compensation_offer', {'model': 'monthly_salary', 'amount_paise': 0}))
    result['pricing'] = customer_pricing(row['pricing'])
    if uid == row['customer_id']:
        result.pop('passenger_phone', None)
        result.pop('parent_ride_id', None)
        if row['state'] in ('offered', 'queued', 'accepted', 'on_the_way', 'arrived'): result['otp'] = row['otp_value']
    result['allowed_actions'] = allowed_actions(row, uid)
    result['server_time'] = now
    live = row.get('position') if row['state'] in TRAVELLING else None
    result['position'] = live if live and 0 <= now-live.get('received_at', 0) <= 75 else None
    result['stop_status'] = {'pickup': stop_proximity(result['position'], row['pickup'], now),
                             'destination': stop_proximity(result['position'], row['dropoff'], now)}
    result['blockers'] = ['otp_locked_contact_support'] if row.get('otp_attempts', 0) >= 5 else []
    return result


def _expire(u, row, now):
    if row['state'] in ('dispatch_pending', 'offered', 'queued', 'accepted') and row.get('expires_at', now+1) <= now:
        row['state'] = 'expired'; _quota_release(u, row)
        _release_slot(u, row); _save(u, row, 'expired', 'system'); return True
    return False


def process_deadlines(core, limit=24):
    """Rotate every indexed state and expire each record in its own transaction.

    A busy first page cannot starve older reservations. Per-record transactions
    also bound the notification/index/outbox writes below Firestore's write cap.
    """
    store = core.operations_store
    per_state = max(1, min(6, int(limit)//4))
    def collect(u):
        identifiers = []
        for state in ('dispatch_pending', 'offered', 'queued', 'accepted'):
            cursor = u.get('bike_deadline_cursors', state) or {}
            rows = u.find('bike_rides', 'state', state, limit=per_state, after=cursor.get('after'))
            if not rows and cursor.get('after'):
                rows = u.find('bike_rides', 'state', state, limit=per_state)
            u.put('bike_deadline_cursors', state, {'after': rows[-1]['id'] if rows else None})
            identifiers.extend(row['id'] for row in rows)
        return identifiers
    count = 0
    for identifier in store.run(collect):
        def expire_one(u):
            row = u.get('bike_rides', identifier)
            return bool(row and _expire(u, row, time.time()))
        count += store.run(expire_one)
    return {'expired': count}


def consume_dispatch_event(u, event):
    """Apply one transport-ordered request under the same native reservation locks.

    Losing a race is a processed business result. Unexpected storage failures
    propagate, so the broker offset is never acknowledged before commit.
    """
    from fastapi import HTTPException
    row = u.get('bike_rides', event['ride_id'])
    if not row or row['driver_id'] != event['rider_id']:
        return {'status': 'record_unavailable'}
    if event['event_type'] != 'booking_requested' or row['state'] != 'dispatch_pending':
        return {'status': 'no_reservation_change', 'state': row['state']}
    now = time.time()
    try:
        p = policy(u); quote = u.get('bike_quotes', row['quote_id'])
        if not quote or quote['customer_id'] != row['customer_id'] or quote['expires_at'] <= now:
            fail('QUOTE_EXPIRED', 'The bike quote expired before dispatch could reserve it.', 409)
        if not p['enabled'] or p['version'] != quote['policy_version']:
            fail('POLICY_CHANGED', 'Bike availability changed. Search again.', 409)
        from bike_earnings import operations_readiness as policy_readiness
        if not all(policy_readiness(u, p, now).get(k) for k in ('payroll_ready', 'funding_ready')):
            fail('SERVICE_UNAVAILABLE', 'Company bike operations are temporarily unavailable.', 409)
        v, operator, _ = authorized_vehicle(u, row['vehicle_id'], until=now+row['route_duration_seconds']+2400)
        reservation_guard(u, v)
        slot = _slot(u, operator)
        for key in ('current_id', 'next_id'):
            previous = u.get('bike_rides', slot[key]) if slot.get(key) else None
            if previous: _expire(u, previous, now)
        slot = _slot(u, operator)
        candidate = _candidate(u, v['id'], row['pickup'], p, now, row['route_duration_seconds'])
        if not candidate or candidate['parent_ride_id'] != row['parent_ride_id']:
            fail('RIDER_NO_LONGER_AVAILABLE', 'This rider was reserved or their availability changed. Search again.', 409)
        slot_key = 'next_id' if candidate['queued'] else 'current_id'
        if slot.get(slot_key): fail('SLOT_TAKEN', 'Another booking reserved this rider first. Search again.', 409)
        quota = None
        if row['pricing']['free']:
            planned_start = now+candidate['pickup_eta_seconds']
            if not row.get('quota_key') or row.get('quota_key') != quote.get('quota_key') or row.get('quota_key_version') != promo_key_version():
                fail('FREE_IDENTITY_CHANGED', 'Your verified free ride identity changed. Search again to review your offer.', 409)
            offer = promotion(u, row['customer_id'], row['distance_metres'], p, planned_start, quota_key=row['quota_key'])
            if not offer['eligible']:
                fail('FREE_OFFER_CHANGED', 'This free offer is no longer available. Search again to review your fare.', 409)
            quota_key = row['quota_key']; quota = u.get('bike_quota', quota_key) or {'entries': {}}
            quota['entries'] = {k: e for k, e in quota['entries'].items()
                                if e.get('used_at', e['reserved_at']) > now-60*86400 or e['state'] == 'reserved'}
        elif not readiness(p, now)['paid_ready']:
            fail('PAID_RIDES_UNAVAILABLE', 'Paid bike rides are unavailable.', 409)
        from bike_earnings import reserve
        reserve(u, row)
        # All business validation precedes the actual allocation writes.
        if quota is not None:
            quota['entries'][row['id']] = dict(state='reserved', reserved_at=now, planned_at=planned_start, week=iso_week(planned_start))
            u.put('bike_quota', quota_key, quota)
            row['promo_reserved'] = True
        row.update(state='queued' if candidate['queued'] else 'offered', assigned_at=now, queued=candidate['queued'],
                   available_at=candidate['available_at'], pickup_eta_seconds=candidate['pickup_eta_seconds'],
                   starts_at=candidate['available_at'],
                   ends_at=now+candidate['pickup_eta_seconds']+row['route_duration_seconds']+300,
                   expires_at=min(now+1800, candidate['available_at']+300) if candidate['queued'] else now+180)
        slot[slot_key] = row['id']; u.put('bike_slots', digest(operator), slot)
        u.put('bike_vehicle_slots', row['vehicle_id'], copy.deepcopy(slot))
        _save(u, row, 'offered', 'dispatch')
        return {'status': 'reserved', 'state': row['state'], 'ride_id': row['id']}
    except HTTPException as error:
        detail = error.detail if isinstance(error.detail, dict) else {'code': 'BOOKING_UNAVAILABLE', 'message': str(error.detail)}
        row.update(state='unavailable', failure_reason=detail.get('code'), failure_message=detail.get('message'))
        _save(u, row, 'unavailable', 'dispatch')
        return {'status': 'unavailable', 'reason': detail.get('code'), 'ride_id': row['id']}


def admin_record(row):
    """Operational history projection; no pickup/contact/GPS or pickup secret."""
    fields = ('id', 'state', 'version', 'vehicle_name', 'rider_name', 'customer_id', 'driver_id',
              'pricing', 'created_at', 'updated_at', 'queued', 'available_at', 'financial_hold',
              'dispute_previous_state', 'dispute_note', 'completed_at', 'payment_status',
              'company_collection_status', 'company_cash_held_paise', 'refund_review_required',
              'failure_reason', 'failure_message', 'resolution')
    return {key: copy.deepcopy(row[key]) for key in fields if key in row}


def admin_history(u, limit=30, after=None):
    from repaidians_work import active_query
    limit = min(50, max(1, limit))
    refs = active_query(u, 'bike_history_admin', limit+1, after or '')
    u.prefetch([('bike_rides', reference['ride_id']) for reference in refs[:limit]])
    rows = [u.get('bike_rides', reference['ride_id']) for reference in refs[:limit]]
    return {'rides': [admin_record(row) for row in rows if row],
            'next_cursor': refs[limit-1]['id'] if len(refs)>limit else None,
            'scope': 'all_booking_states', 'order': 'created_descending', 'server_time': time.time()}


def install(core):
    store = core.operations_store
    r = APIRouter(prefix='/operations/bike-rides', tags=['Bike rides'])

    @r.get('/policy')
    def get_policy(response: Response):
        response.headers['Cache-Control'] = 'no-store'
        return store.run(lambda u: public_policy(policy(u), u))

    @r.get('/admin/policy')
    def admin_policy(response: Response, admin=Depends(core.operator)):
        response.headers.update(HEADERS)
        return store.run(lambda u: admin_policy_view(u, policy(u)))

    @r.put('/admin/policy')
    def update_policy(body: Policy, admin=Depends(core.operator)):
        from integrations import audit
        def update(u):
            old = policy(u)
            if old['version'] != body.expected_version: fail('STALE', 'Refresh bike policy before saving.', 409)
            p = {**old, **body.model_dump(exclude={'expected_version'}), 'version': old['version']+1,
                 'updated_by': admin['id'], 'updated_at': time.time()}
            if old.get('promo_started_at') is not None and body.promo_started_at != old['promo_started_at']:
                fail('PROMO_WINDOW_LOCKED', 'The launch window cannot restart after it is configured.', 409)
            ready = readiness(p)
            from bike_earnings import operations_readiness as policy_readiness
            ready.update(policy_readiness(u, p, time.time()))
            if p['enabled'] and (not ready.get('payroll_ready') or not ready.get('funding_ready')): fail('PAYROLL_REQUIRED', 'Approve the company rider roster and operating funding before activation.', 422)
            if p['enabled'] and not ready['geography_ready']: fail('SERVICE_AREA_REQUIRED', 'Review and confirm the operating centre and service-area circle before activation.', 422)
            from bike_dispatch import engine_health
            if p['enabled'] and not engine_health(u)['ready']: fail('DISPATCH_UNAVAILABLE', 'Connect and verify the continuous bike dispatch worker before activation.', 422)
            if p['enabled'] and not ready['routing_ready']: fail('ROUTING_UNAVAILABLE', 'Connect the server bike route provider before activation.', 422)
            if p['enabled'] and not ready['paid_ready']: fail('PRICING_REQUIRED', 'Set reviewed fares, terms and a collection method before enabling bike rides.', 422)
            if p['promo_enabled'] and (not p['promo_started_at'] or not p['promo_terms_reviewed']):
                fail('PROMO_FUNDING_REQUIRED', 'Set a fixed launch date and review the promotion terms before enabling the offer.', 422)
            u.put('bike_policy', 'current', p); audit(u, 'BikePolicyUpdated', admin['id'], policy_version=p['version'])
            return admin_policy_view(u, p)
        return store.run(update)

    def availability_view(u, uid):
        vehicles = {v['id']: v for v in u.find('mobility_vehicles', 'owner_id', uid)+u.find('mobility_vehicles', 'driver_id', uid)}
        vehicles = [v for v in vehicles.values() if v.get('vehicle_kind') == 'bike' and (v.get('driver_id') or v['owner_id']) == uid]
        presences = [u.get('bike_rider_presence', v['id']) for v in vehicles]
        presence = max((p for p in presences if p), key=lambda p: p.get('updated_at', 0), default=None)
        from bike_dispatch import engine_health
        health = engine_health(u)
        runtime = public_policy(policy(u), u)
        from bike_earnings import compensated_driver
        return {'dispatch_ready': health['ready'], 'service_ready': runtime['bookings_available'], 'availability_reason': None if runtime['bookings_available'] else 'Bike requests are currently paused.', 'vehicles': [{k: v.get(k) for k in ('id', 'name', 'status', 'active', 'vehicle_kind', 'valid_until')} for v in vehicles],
                'availability': presence, 'rider_approved': bool(compensated_driver(u, uid)), 'server_time': time.time()}

    @r.get('/driver/availability')
    def driver_availability(response: Response, user=Depends(core.current_user)):
        response.headers.update(HEADERS)
        return store.run(lambda u: availability_view(u, user['id']))

    @r.put('/driver/availability')
    def put_availability(body: Availability, user=Depends(core.current_user)):
        from bike_dispatch import index_availability
        def update(u):
            if body.online:
                v, operator, _ = authorized_vehicle(u, body.vehicle_id, user['id'])
                reservation_guard(u, v)
            else:
                v = u.get('mobility_vehicles', body.vehicle_id)
                previous = u.get('bike_rider_presence', body.vehicle_id)
                if not previous or previous.get('driver_id') != user['id']:
                    fail('NOT_FOUND', 'Rider availability unavailable.', 404)
                operator = user['id']
                if not v: v = {'id': body.vehicle_id, 'owner_id': operator}
            slot = _slot(u, operator)
            for key in ('current_id', 'next_id'):
                active = u.get('bike_rides', slot[key]) if slot.get(key) else None
                if body.online and active and active['state'] not in CLOSED and active['vehicle_id'] != v['id']:
                    fail('CURRENT_RIDE_ACTIVE', 'Finish or cancel existing bike reservations before switching vehicles.', 409)
            old = u.get('bike_rider_presence', v['id']) or {'version': 0}
            pos = fresh_position(body.position.model_dump() if body.position else None) if body.online else old.get('position')
            if body.online and old.get('position') and pos['captured_at'] <= old['position']['captured_at']:
                fail('STALE_POSITION', 'A newer rider location has already arrived.', 409)
            # One rider cannot advertise multiple bikes at the same time.
            for other in u.find('bike_rider_presence', 'driver_id', operator):
                if other['vehicle_id'] != v['id'] and other.get('online'):
                    other.update(online=False, updated_at=time.time(), version=other['version']+1)
                    u.put('bike_rider_presence', other['vehicle_id'], other)
                    index_availability(u, other['vehicle_id'], other.get('position'), False, time.time(), time.time(), driver_id=operator, version=other['version'])
            value = dict(vehicle_id=v['id'], driver_id=operator, online=body.online, position=pos,
                         version=old['version']+1, updated_at=time.time())
            u.put('bike_rider_presence', v['id'], value)
            _refresh_index(u, v['id'])
            return availability_view(u, user['id'])
        return store.run(update)

    @r.post('/search')
    def search(body: Search, response: Response, user=Depends(core.current_user)):
        from bike_dispatch import candidate_ids, rank_candidates, engine_health
        response.headers.update(HEADERS)
        p, health = store.run(lambda u: (policy(u), engine_health(u))); now = time.time()
        identity = promo_identity(user)
        if not p['enabled'] or not health['ready']:
            return {'quotes': [], 'reason': 'service_not_enabled' if not p['enabled'] else 'dispatch_unavailable',
                    'promotion': store.run(lambda u: promotion(u, user['id'], 0, p, quota_key=identity)), 'server_time': now}
        if not readiness(p)['geography_ready'] or any(metres(pin, p['service_center']) > p['service_area_radius_metres'] for pin in (body.pickup.model_dump(), body.dropoff.model_dump())):
            fail('OUTSIDE_SERVICE_AREA', 'Both stops must be inside the reviewed Balasore operating area.', 422)
        route = verified_route(body.pickup.model_dump(), body.dropoff.model_dump())
        if route['distance_metres'] > p['service_radius_metres']:
            fail('ROUTE_OUTSIDE_SERVICE', 'This route is outside the current bike ride service distance.', 422)
        def discover(u):
            candidates = []
            for identifier in candidate_ids(u, body.pickup.model_dump(), p['pickup_radius_metres'], now, policy_version=p['version']):
                item = _candidate(u, identifier, body.pickup.model_dump(), p, now, route['duration_seconds'])
                if item: candidates.append(item)
            return candidates
        now = time.time()  # Route provider latency must not age the candidate snapshot.
        candidates = store.run(discover)
        ranked = rank_candidates(candidates, body.pickup.model_dump(), now)  # Provider I/O outside transactions.
        def build(u):
            current_policy = policy(u)
            if current_policy['version'] != p['version'] or not current_policy['enabled'] or not engine_health(u)['ready']:
                fail('POLICY_CHANGED', 'Bike availability changed. Search again.', 409)
            offer = promotion(u, user['id'], route['distance_metres'], current_policy, now, quota_key=identity)
            free = offer['eligible']
            if not free and not readiness(p, now)['paid_ready']:
                return {'quotes': [], 'reason': 'paid_rides_unavailable', 'promotion': offer, 'server_time': now}
            occupancy = sum(c['queued'] for c in candidates)/len(candidates) if len(candidates) >= 3 else 0
            surcharge = min(p['demand_surcharge_cap_bps'], 2500 if occupancy >= .8 else 1000 if occupancy >= .6 else 0)
            quotes = []
            for item in ranked[:8]:
                identifier = secrets.token_hex(20)
                planned_offer = promotion(u, user['id'], route['distance_metres'], p, now+item['total_eta_seconds'], quota_key=identity)
                row = {**item, 'id': identifier, 'customer_id': user['id'], 'pickup': body.pickup.model_dump(),
                       'dropoff': body.dropoff.model_dump(), 'distance_metres': route['distance_metres'],
                       'route_duration_seconds': route['duration_seconds'], 'route': route,
                       'pricing': fare(p, route['distance_metres'], route['duration_seconds'], surcharge, planned_offer['eligible']), 'promotion': planned_offer,
                       'quota_key': identity if planned_offer['eligible'] else None,
                       'quota_key_version': promo_key_version() if planned_offer['eligible'] else None,
                       'terms': p['terms'], 'cancellation_terms': 'Cancel before pickup at no charge. Started-ride disputes require support review.',
                       'policy_version': p['version'], 'created_at': now, 'expires_at': now+90}
                from bike_earnings import quote_earnings
                compensation = quote_earnings(u, row['driver_id'], row['pricing'])
                if compensation is None and row['pricing']['free']:
                    row['pricing'] = fare(p, route['distance_metres'], route['duration_seconds'], surcharge, False)
                    row['promotion'] = {**planned_offer, 'eligible': False, 'reason': 'rider_offer_unavailable',
                                        'message': 'The launch offer is unavailable for this rider. Review the paid fare.'}
                    compensation = quote_earnings(u, row['driver_id'], row['pricing'])
                if compensation is None:
                    continue
                row['compensation_offer'] = compensation
                u.put('bike_quotes', identifier, row)
                quote = {k: copy.deepcopy(v) for k, v in row.items() if k not in ('location', 'driver_id', 'owner_id', 'customer_id', 'position_version', 'route', 'parent_ride_id', 'quota_key', 'quota_key_version', 'compensation_offer')}
                quote['pricing'] = customer_pricing(row['pricing']); quotes.append(quote)
            return {'quotes': quotes, 'reason': None if quotes else 'no_riders', 'promotion': offer, 'route': {'points': route['points']}, 'server_time': now}
        return store.run(build)

    @r.post('/bookings', status_code=201)
    def book(body: Booking, user=Depends(core.current_user)):
        from bike_dispatch import engine_health, drain_direct
        identifier = digest(user['id']+':bike:'+body.request_id)
        def request(u):
            old = u.get('bike_rides', identifier)
            if old:
                if old['request_hash'] != fingerprint(body): fail('IDEMPOTENCY_CONFLICT', 'Use a new request key for changed booking details.', 409)
                _expire(u, old, time.time()); return old
            quote = u.get('bike_quotes', body.quote_id); now = time.time(); p = policy(u)
            if not quote or quote['customer_id'] != user['id'] or quote['expires_at'] <= now: fail('QUOTE_EXPIRED', 'Search again for a fresh bike quote.', 409)
            if not p['enabled'] or p['version'] != quote['policy_version']: fail('POLICY_CHANGED', 'Bike fares changed. Search again.', 409)
            from bike_earnings import operations_readiness as policy_readiness
            if not all(policy_readiness(u, p, time.time()).get(k) for k in ('payroll_ready', 'funding_ready')): fail('SERVICE_UNAVAILABLE', 'Company bike operations are temporarily unavailable.', 503)
            if quote['pricing']['free']:
                identity = promo_identity(user)
                if not identity: fail('PHONE_VERIFICATION_REQUIRED', 'Verify your mobile number before confirming a free ride.', 403)
                if identity != quote.get('quota_key') or quote.get('quota_key_version') != promo_key_version():
                    fail('FREE_IDENTITY_CHANGED', 'Your verified mobile identity changed. Search again to review your offer.', 409)
            if not engine_health(u)['ready']: fail('DISPATCH_UNAVAILABLE', 'Bike dispatch is temporarily unavailable. Your ride has not been booked.', 503)
            intent_key = digest(user['id']); intent = u.get('bike_customer_intents', intent_key) or {}
            existing = u.get('bike_rides', intent['ride_id']) if intent.get('ride_id') else None
            if existing and existing['state'] not in CLOSED and not _expire(u, existing, now):
                fail('ACTIVE_RIDE_EXISTS', 'Finish or cancel your current bike request first.', 409)
            row = {**{k: copy.deepcopy(quote[k]) for k in ('vehicle_id', 'vehicle_name', 'driver_id', 'owner_id', 'rider_name', 'pickup', 'dropoff', 'pricing', 'distance_metres', 'route_duration_seconds', 'route', 'terms', 'cancellation_terms', 'quota_key', 'quota_key_version')},
                   'compensation_offer': copy.deepcopy(quote.get('compensation_offer', {'model': 'monthly_salary', 'amount_paise': 0})),
                   'id': identifier, 'customer_id': user['id'], 'quote_id': body.quote_id, 'request_id': body.request_id,
                   'request_hash': fingerprint(body), 'passenger_name': body.rider_name, 'passenger_phone': body.rider_phone,
                   'for_someone_else': body.for_someone_else, 'pickup_address': body.pickup_address, 'dropoff_address': body.dropoff_address,
                   'state': 'dispatch_pending', 'queued': quote['queued'], 'accepted_by_driver': False,
                   'parent_ride_id': quote['parent_ride_id'], 'available_at': quote['available_at'],
                   'pickup_eta_seconds': quote['total_eta_seconds'], 'starts_at': quote['available_at'],
                   'ends_at': now+quote['total_eta_seconds']+quote['route_duration_seconds']+300,
                   'expires_at': quote['expires_at'], 'promo_reserved': False,
                   'otp_value': f'{secrets.randbelow(1000000):06}', 'otp_attempts': 0,
                   'created_at': now, 'updated_at': now, 'version': 0, 'policy': copy.deepcopy(p)}
            u.put('bike_customer_intents', intent_key, {'ride_id': identifier, 'created_at': now})
            _save(u, row, 'booking_requested', user['id']); return row
        row = store.run(request)
        if store.run(lambda u: engine_health(u)['mode']) == 'direct':
            drain_direct(store, consume_dispatch_event, row['driver_id'])
            row = store.run(lambda u: u.get('bike_rides', identifier))
        return view(row, user['id'])

    def own_rows(u, uid, driver=False, after=None):
        from repaidians_work import active_query
        lane = 'bike_history_'+('driver' if driver else 'customer')+'_'+digest(uid)[:32]
        refs = active_query(u, lane, 51, after or '')
        u.prefetch([('bike_rides', reference['ride_id']) for reference in refs[:50]])
        result = []
        for reference in refs[:50]:
            row = u.get('bike_rides', reference['ride_id'])
            if not row: continue
            _expire(u, row, time.time())
            if driver and not row.get('assigned_at'): continue
            result.append(view(row, uid))
        return {'rides': result, 'next_cursor': refs[49]['id'] if len(refs)>50 else None, 'server_time': time.time()}

    @r.get('/bookings')
    def bookings(response: Response, after: str | None=Query(default=None, max_length=100), user=Depends(core.current_user)):
        response.headers.update(HEADERS); return store.run(lambda u: own_rows(u, user['id'], after=after))

    @r.get('/driver/rides')
    def driver_rides(response: Response, after: str | None=Query(default=None, max_length=100), user=Depends(core.current_user)):
        response.headers.update(HEADERS); return store.run(lambda u: own_rows(u, user['id'], True, after))

    @r.get('/bookings/{identifier}')
    def booking(identifier: str, response: Response, user=Depends(core.current_user)):
        response.headers.update(HEADERS)
        def read(u):
            row = u.get('bike_rides', identifier)
            if not row: fail('NOT_FOUND', 'Bike ride unavailable.', 404)
            if user['id'] not in (row['customer_id'], row['driver_id']): fail('NOT_FOUND', 'Bike ride unavailable.', 404)
            _expire(u, row, time.time()); return view(row, user['id'])
        return store.run(read)

    def update_position(u, row, position, throttle=True):
        pos = fresh_position(position.model_dump() if position else None); old = row.get('position')
        if old and pos['captured_at'] <= old['captured_at']: fail('STALE_POSITION', 'A newer rider location has already arrived.', 409)
        if throttle and old and time.time()-old['received_at'] < 5: fail('POSITION_RATE_LIMIT', 'Wait before sending another location.', 429)
        row['position'] = pos
        # Arrival is a cue; only an explicit command changes lifecycle state.
        from mobility_journeys import stop_proximity
        if row['state'] == 'in_progress' and stop_proximity(pos, row['dropoff'])['status'] == 'inside' and not row.get('destination_alerted_at'):
            row['destination_alerted_at'] = time.time(); _save(u, row, 'destination_nearby', row['driver_id'])
        else: u.put('bike_rides', row['id'], row)
        presence = u.get('bike_rider_presence', row['vehicle_id'])
        if presence and presence['driver_id'] == row['driver_id']:
            presence.update(position=pos, updated_at=time.time(), version=presence['version']+1)
            u.put('bike_rider_presence', row['vehicle_id'], presence); _refresh_index(u, row['vehicle_id'])
        return pos

    @r.post('/bookings/{identifier}/position')
    def position(identifier: str, body: Position, user=Depends(core.current_user)):
        def save(u):
            row = u.get('bike_rides', identifier)
            if not row or row['driver_id'] != user['id']: fail('NOT_FOUND', 'Bike ride unavailable.', 404)
            if row['state'] not in TRAVELLING: fail('NOT_ACTIVE', 'Location sharing is available during an active bike ride.', 409)
            vehicle = u.get('mobility_vehicles', row['vehicle_id'])
            if not vehicle or vehicle.get('vehicle_kind') != 'bike': fail('VEHICLE_REVIEW_REQUIRED', 'This active bike journey needs vehicle support review.', 409)
            update_position(u, row, body)
            return view(row, user['id'])
        return store.run(save)

    @r.post('/bookings/{identifier}/commands')
    def command(identifier: str, body: Command, user=Depends(core.current_user)):
        def change(u):
            row = u.get('bike_rides', identifier)
            if not row or user['id'] not in (row['customer_id'], row['driver_id']): fail('NOT_FOUND', 'Bike ride unavailable.', 404)
            key = digest(user['id']+':bike-command:'+body.command_id); old = u.get('bike_booking_commands', key)
            if old:
                if old['fingerprint'] != fingerprint(body) or old['ride_id'] != identifier: fail('IDEMPOTENCY_CONFLICT', 'Use a new key for a different action.', 409)
                if old.get('error'): return {'_error': old['error']}
                return view(row, user['id'])
            if _expire(u, row, time.time()): return {'_error': ('BOOKING_EXPIRED', 'The rider reservation expired. Search again.', 409)}
            if row['version'] != body.expected_version: fail('STALE', 'Refresh this bike ride before acting.', 409)
            if body.action not in allowed_actions(row, user['id']): fail('INVALID_ACTION', 'This action is not available for the current bike ride state.', 409)
            v = u.get('mobility_vehicles', row['vehicle_id']); reservation_guard(u, v)
            action = body.action; now = time.time(); driver = user['id'] == row['driver_id']
            if driver and action in ('accept', 'depart', 'arrive', 'start'):
                authorized_vehicle(u, row['vehicle_id'], user['id'], now+row['route_duration_seconds']+600,
                                   committed_ride=row if action != 'accept' else None)
            if action == 'accept':
                row['accepted_by_driver'] = True
                if row['state'] != 'queued': row['state'] = 'accepted'; row['expires_at'] = now+600
            elif action in ('decline', 'cancel'):
                row['state'] = 'declined' if action == 'decline' else 'cancelled'
                _quota_release(u, row); _release_slot(u, row)
            elif action == 'depart':
                slot = _slot(u, row['driver_id'])
                if slot.get('current_id') != row['id']: fail('CURRENT_RIDE_ACTIVE', 'Finish your current ride before the next pickup.', 409)
                update_position(u, row, body.position, throttle=False); row['state'] = 'on_the_way'; row['departed_at'] = now
            elif action in ('arrive', 'start', 'complete'):
                from mobility_journeys import stop_proximity
                update_position(u, row, body.position, throttle=False)
                pin = row['dropoff'] if action == 'complete' else row['pickup']
                now = time.time()  # Measure after the server has received this GPS reading.
                if stop_proximity(row['position'], pin, now)['status'] != 'inside': fail('GEOFENCE_REQUIRED', 'Send fresh GPS within 300 metres of the agreed stop.', 409)
                if action == 'arrive': row['state'] = 'arrived'; row['arrived_at'] = now
                elif action == 'start':
                    if not secrets.compare_digest(body.otp, row['otp_value']):
                        row['otp_attempts'] += 1; _save(u, row, 'otp_rejected', user['id'])
                        error = ('OTP_INVALID', 'Check the customer’s six-digit pickup code.', 409)
                        u.put('bike_booking_commands', key, dict(ride_id=identifier, fingerprint=fingerprint(body), error=error, created_at=now))
                        return {'_error': error}
                    if row['pricing']['free']:
                        p = row['policy']
                        window = p.get('promo_started_at') is not None and p['promo_started_at'] <= now < months_after(p['promo_started_at'])
                        quota_key = row.get('quota_key'); quota = u.get('bike_quota', quota_key) if quota_key else None
                        if not quota or row['id'] not in quota['entries']: fail('QUOTA_REVIEW_REQUIRED', 'The reserved free ride needs support review.', 409)
                        others = [entry for key_, entry in quota['entries'].items() if key_ != row['id'] and entry['state'] in ('reserved', 'used')]
                        weekly = sum(entry['week'] == iso_week(now) for entry in others)
                        recent = max((entry.get('used_at', entry['reserved_at']) for entry in others), default=0)
                        if not window or weekly >= p['weekly_free_limit'] or recent and now-recent < p['cooldown_hours']*3600:
                            fail('FREE_OFFER_CHANGED', 'The reserved free offer needs support review. Cancel before starting if it is no longer suitable.', 409)
                        quota['entries'][row['id']].update(state='used', used_at=now, week=iso_week(now)); u.put('bike_quota', quota_key, quota)
                    row['state'] = 'in_progress'; row['started_at'] = now
                    row['ends_at'] = now+row['route_duration_seconds']+300
                else:
                    row['state'] = 'completion_pending'; row['completed_work_at'] = now
                    # Physical capacity is released at dropoff; money remains a separate obligation.
                    _release_slot(u, row)
            elif action == 'confirm':
                if row['pricing']['free']:
                    row['state'] = 'completed'
                    row['completed_at'] = now
                else: row['state'] = 'payment_due'
            elif action == 'cash_reported':
                row.update(state='payment_reported', customer_cash_reported_at=now, payment_status='customer_reported_cash')
            elif action == 'cash_received':
                row.update(state='completed', completed_at=now, payment_status='rider_confirmed_cash', cash_received_at=now,
                           collected_paise=row['pricing']['customer_total_paise'],
                           company_cash_held_paise=row['pricing']['customer_total_paise'], company_collection_status='held_by_rider')
                from bike_payroll import record_company_cash
                record_company_cash(u, row, now)
            elif action == 'dispute':
                if len(body.note.strip()) < 10: fail('REASON_REQUIRED', 'Describe the concern so support can review it.', 422)
                row.update(dispute_previous_state=row['state'], state='disputed', financial_hold=True, dispute_note=body.note)
            _save(u, row, action, user['id'])
            u.put('bike_booking_commands', key, dict(ride_id=identifier, fingerprint=fingerprint(body), created_at=now))
            return view(row, user['id'])
        result = store.run(change)
        if '_error' in result: fail(*result['_error'])
        return result

    @r.get('/admin/overview')
    def overview(response: Response, admin=Depends(core.operator)):
        response.headers.update(HEADERS)
        def read(u):
            p = policy(u); rows = []; complete = True
            for state in ACTIVE:
                batch = u.find('bike_rides', 'state', state, limit=501)
                complete = complete and len(batch) < 501; rows.extend(batch[:500])
            presence = u.find('bike_rider_presence', 'online', True, limit=501)
            admin_p = admin_policy_view(u, p)
            from bike_economics import salary_scenarios
            history = admin_history(u)
            return {'policy': admin_p, 'economics': salary_scenarios(p, admin_p.get('approved_rider_count', 0), monthly_liability_paise=admin_p.get('monthly_salary_liability_paise', 0)), 'dispatch_health': __import__('bike_dispatch').engine_health(u), 'metrics': dict(scope='current_transaction', complete=complete and len(presence)<501,
                    online_riders=sum(_presence_live(x, time.time()) for x in presence[:500]), active_rides=sum(x['state'] in TRAVELLING for x in rows),
                    queued_rides=sum(x['state']=='queued' for x in rows), offers=sum(x['state']=='offered' for x in rows),
                    promo_planning_budget_paise=p['promo_planning_budget_paise']),
                    'recent_rides': history['rides'], 'recent_rides_next_cursor': history['next_cursor'],
                    'recent_rides_scope': history['scope']}
        return store.run(read)

    @r.get('/admin/bookings')
    def admin_bookings(response: Response, after: str | None=Query(default=None, max_length=100), admin=Depends(core.operator)):
        response.headers.update(HEADERS)
        return store.run(lambda u: admin_history(u, 50, after))

    @r.get('/admin/dispatch/incidents')
    def dispatch_incidents(response: Response, cursor: str | None=Query(default=None, max_length=64), admin=Depends(core.operator)):
        from repaidians_work import active_query
        response.headers.update(HEADERS)
        def read(u):
            rows = active_query(u, 'bike_dispatch_key_health', 51, cursor or '')
            return {'items': rows[:50], 'next_cursor': rows[49]['id'] if len(rows)>50 else None,
                    'recovery': 'automatic_redelivery', 'scope': 'currently_blocked_riders'}
        return store.run(read)

    @r.post('/admin/bookings/{identifier}/resolve')
    def resolve(identifier: str, body: Resolve, admin=Depends(core.operator)):
        from integrations import audit
        def change(u):
            row = u.get('bike_rides', identifier)
            if not row: fail('NOT_FOUND', 'Bike ride unavailable.', 404)
            if row['version'] != body.expected_version: fail('STALE', 'Refresh the bike ride before resolving.', 409)
            if row['state'] != 'disputed': fail('NOT_DISPUTED', 'Only a disputed ride can be resolved here.', 409)
            if body.action == 'complete':
                if body.amount_paise != row['pricing']['customer_total_paise']:
                    fail('COLLECTION_REVIEW_REQUIRED', 'Record the exact externally verified collection to close a paid ride.', 422)
                if not row['pricing']['free']: row.update(payment_status='operator_reported_collection', collected_paise=body.amount_paise, company_cash_held_paise=body.amount_paise, company_collection_status='held_by_rider')
                row['state'] = 'completed'; row['completed_at'] = time.time()
                if not row['pricing']['free']:
                    from bike_payroll import record_company_cash
                    record_company_cash(u, row, time.time())
            else:
                row['state'] = 'cancelled'; _quota_release(u, row)
                row['refund_review_required'] = bool(row.get('collected_paise') or row.get('customer_cash_reported_at'))
            row['financial_hold'] = False; _release_slot(u, row)
            row['resolution'] = dict(action=body.action, reference=body.reference, note=body.note, recorded_by=admin['id'], at=time.time())
            _save(u, row, 'admin_'+body.action, admin['id']); audit(u, 'BikeRideResolved', admin['id'], ride_id=identifier)
            return {'id': row['id'], 'state': row['state'], 'version': row['version']}
        return store.run(change)

    core.app.include_router(r, prefix='/api'); core.app.include_router(r)
