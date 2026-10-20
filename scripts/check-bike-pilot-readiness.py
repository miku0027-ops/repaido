#!/usr/bin/env python3
"""Read-only, redacted checks for one explicitly selected bike pilot account.

Run from the reviewed checkout in authenticated Google Cloud Shell. The selected
UID and vehicle ID have no saved defaults. This inspects metadata, never approves
an account, accrues payroll, changes a policy or claims that money was deposited.
The serving API's public readiness remains authoritative for booking availability.
"""

import argparse
import calendar
import datetime as dt
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import re
import sys
import time
import urllib.parse
from zoneinfo import ZoneInfo


def sibling(filename, name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


pilot = sibling('prepare-bike-pilot-rider.py', 'pilot_inventory_support')
launch = sibling('check-bike-launch.py', 'pilot_launch_support')
INDIA = ZoneInfo('Asia/Kolkata')
PROFILE_FIELDS = ('id', 'user_id', 'role', 'status', 'version', 'city', 'valid_until', 'document_ids')
VEHICLE_FIELDS = ('id', 'owner_id', 'driver_id', 'vehicle_kind', 'status', 'version', 'active',
                  'valid_until', 'mode', 'seats', 'document_ids')
POLICY_FIELDS = ('version', 'enabled', 'cash_enabled', 'base_paise', 'per_km_paise', 'per_minute_paise',
                 'minimum_paise', 'gst_bps', 'tax_reviewed', 'terms', 'service_center',
                 'service_area_reviewed', 'service_area_radius_metres', 'service_radius_metres',
                 'pickup_radius_metres', 'promo_enabled', 'promo_started_at', 'promo_terms_reviewed',
                 'free_distance_metres', 'weekly_free_limit', 'cooldown_hours')
PAYROLL_FIELDS = ('version', 'enabled', 'monthly_salary_paise', 'monthly_funding_paise',
                  'funding_period', 'funding_reference', 'funding_evidence', 'funding_acknowledged', 'roster')
DOCUMENT_FIELDS = ('owner_id', 'expires_at')


def identifier_argument(value):
    # Restrict document IDs further than the older email inventory: no escaped
    # query delimiters or path interpretation, and no secret/default selection.
    if not re.fullmatch(r'[A-Za-z0-9_:.@-]{1,128}', value) or value in ('.', '..'):
        raise argparse.ArgumentTypeError('Supply a valid exact account or vehicle record ID.')
    return value


def number(value):
    return value if type(value) in (int, float) and math.isfinite(value) else None


def integer(value):
    return value if type(value) is int and value >= 0 else None


def enum(value, allowed):
    return value if isinstance(value, str) and value in allowed else 'unknown'


def period_at(now):
    return dt.datetime.fromtimestamp(now, INDIA).strftime('%Y-%m')


def six_month_end(start):
    if pilot.finite_epoch(start) is None:
        return None
    try:
        source = dt.datetime.fromtimestamp(start, INDIA)
        month = source.year * 12 + source.month - 1 + 6
        year, month_index = divmod(month, 12)
        month_index += 1
        return source.replace(year=year, month=month_index,
                              day=min(source.day, calendar.monthrange(year, month_index)[1])).timestamp()
    except (OverflowError, ValueError, OSError):
        return None


def masked_document(reader, collection, identifier, fields):
    if not re.fullmatch(r'ops_[a-z_]+', collection) or not pilot.valid_identifier(identifier):
        raise pilot.InventoryError('Invalid readiness document scope.')
    if not fields or any(not re.fullmatch(r'[a-z_]+', field) for field in fields):
        raise pilot.InventoryError('Invalid readiness field mask.')
    query = urllib.parse.urlencode([('mask.fieldPaths', field) for field in fields])
    url = pilot.FIRESTORE + '/' + collection + '/' + urllib.parse.quote(identifier, safe='') + '?' + query
    value = reader.read(url, missing_ok=True)
    return pilot.decode_document(value) if value else None


class Snapshot:
    """Bounded, per-invocation reads, with redacted failures kept distinct from 404."""

    def __init__(self, reader):
        self.reader = reader
        self.cache = {}
        self.failures = {}

    def get(self, collection, identifier, fields):
        key = (collection, identifier, tuple(fields))
        if key not in self.cache:
            if len(self.cache) >= 100:
                raise pilot.InventoryError('Readiness metadata exceeded its bounded document budget.')
            try:
                self.cache[key] = masked_document(self.reader, collection, identifier, fields)
            except pilot.CloudOperationError as error:
                self.cache[key] = None
                # The existing reader emits only reviewed provider constants.
                self.failures[key] = error.diagnostic
        return self.cache[key]

    def state(self, collection, identifier, fields):
        key = (collection, identifier, tuple(fields))
        if key in self.failures:
            return 'read_failed'
        return 'ok' if self.cache.get(key) is not None else 'not_found'


def document_metadata(snapshot, row, owner, now):
    ids = row.get('document_ids') or []
    valid = isinstance(ids, list) and 1 <= len(ids) <= 8 and all(pilot.valid_identifier(key) for key in ids)
    if not valid:
        return {'count': len(ids) if isinstance(ids, list) else 0, 'metadata_complete': False,
                'owner_matches': False, 'no_recorded_expiry_violation': False,
                'visual_review_required': True}
    rows = [snapshot.get('ops_business_documents', key, DOCUMENT_FIELDS) for key in ids]
    complete = all(rows)
    return {'count': len(ids), 'metadata_complete': bool(complete),
            'owner_matches': bool(complete and all(doc.get('owner_id') == owner for doc in rows)),
            'no_recorded_expiry_violation': bool(complete and all(doc.get('expires_at') is None or
                (pilot.finite_epoch(doc.get('expires_at')) or 0) > now for doc in rows)),
            'visual_review_required': True}


def profile(snapshot, uid, role, now):
    if not pilot.valid_identifier(uid):
        return {'read_status': 'not_found', 'role': role, 'metadata_checks': {}}
    # Match partner_profile's exact role-specific-before-legacy precedence.
    specific = snapshot.get('ops_business_partners', uid + ':' + role, PROFILE_FIELDS)
    legacy = snapshot.get('ops_business_partners', uid, PROFILE_FIELDS)
    row = specific or (legacy if legacy and legacy.get('role') == role else None)
    failed = any(snapshot.state('ops_business_partners', key, PROFILE_FIELDS) == 'read_failed'
                 for key in (uid + ':' + role, uid))
    if failed:
        return {'read_status': 'read_failed', 'role': role, 'metadata_checks': {}}
    if not row:
        return {'read_status': 'not_found', 'role': role, 'metadata_checks': {}}
    docs = document_metadata(snapshot, row, uid, now)
    checks = {'account_matches_target': row.get('user_id', row.get('id', row['_document_id'])) == uid,
              'approved': row.get('status') == 'approved', 'review_current': (pilot.finite_epoch(row.get('valid_until')) or 0) > now,
              'approval_covers_next_30_minutes': (pilot.finite_epoch(row.get('valid_until')) or 0) > now + 1800,
              'balasore': str(row.get('city', '')).strip().casefold() == 'balasore',
              **{key: docs[key] for key in ('metadata_complete', 'owner_matches', 'no_recorded_expiry_violation')}}
    return {'read_status': 'ok', 'role': role, 'status': enum(row.get('status'), ('pending', 'approved', 'rejected', 'suspended')),
            'version': integer(row.get('version')), 'metadata_checks': checks, 'documents': docs}


def selected_vehicle(snapshot, driver_id, vehicle_id, now):
    row = snapshot.get('ops_mobility_vehicles', vehicle_id, VEHICLE_FIELDS)
    state = snapshot.state('ops_mobility_vehicles', vehicle_id, VEHICLE_FIELDS)
    if not row:
        return {'read_status': state, 'metadata_checks': {}}
    operator = row.get('driver_id') or row.get('owner_id')
    owner = profile(snapshot, row.get('owner_id'), 'cab_owner', now)
    rider = profile(snapshot, operator, 'driver', now) if row.get('driver_id') else owner
    docs = document_metadata(snapshot, row, row.get('owner_id'), now)
    checks = {'physical_operator_matches_selected_uid': operator == driver_id,
              'bike': row.get('vehicle_kind') == 'bike', 'one_passenger': type(row.get('seats')) is int and row['seats'] == 1,
              'cab_mode': row.get('mode') in ('cab', 'both'), 'active': row.get('active') is True,
              'approved': row.get('status') == 'approved',
              'approval_covers_next_30_minutes': (pilot.finite_epoch(row.get('valid_until')) or 0) > now + 1800,
              **{key: docs[key] for key in ('metadata_complete', 'owner_matches', 'no_recorded_expiry_violation')}}
    return {'read_status': state, 'version': integer(row.get('version')), 'metadata_checks': checks,
            'owner_profile': owner, 'operator_profile': rider, 'documents': docs}


def ride_policy(snapshot, now):
    row = snapshot.get('ops_bike_policy', 'current', POLICY_FIELDS)
    state = snapshot.state('ops_bike_policy', 'current', POLICY_FIELDS)
    if not row:
        return {'read_status': state, 'metadata_checks': {}}
    center = row.get('service_center')
    end = six_month_end(row.get('promo_started_at'))
    numeric = {key: number(row.get(key)) for key in ('base_paise', 'per_km_paise', 'per_minute_paise', 'minimum_paise',
        'gst_bps', 'service_radius_metres', 'pickup_radius_metres', 'service_area_radius_metres',
        'free_distance_metres', 'weekly_free_limit', 'cooldown_hours')}
    checks = {'tax_reviewed': row.get('tax_reviewed') is True, 'cash_enabled': row.get('cash_enabled') is True,
              'terms_present': bool(isinstance(row.get('terms'), str) and row['terms'].strip()),
              'nonzero_pricing': any((numeric[key] or 0) > 0 for key in ('base_paise', 'per_km_paise', 'per_minute_paise', 'minimum_paise')),
              'service_area_reviewed': row.get('service_area_reviewed') is True,
              'service_center_present': isinstance(center, dict) and number(center.get('lat')) is not None and number(center.get('lng')) is not None,
              'promo_terms_reviewed': row.get('promo_terms_reviewed') is True,
              'promo_start_recorded': end is not None,
              'promo_window_current': bool(end and row['promo_started_at'] <= now < end)}
    return {'read_status': state, 'version': integer(row.get('version')), 'enabled': row.get('enabled') is True,
            'promo_enabled': row.get('promo_enabled') is True, 'numeric_settings': numeric,
            'metadata_checks': checks, 'missing_inputs': [key for key, value in checks.items() if not value]}


def salary_metadata(snapshot, driver_id, now):
    current = period_at(now)
    row = snapshot.get('ops_bike_payroll_policy', 'current', PAYROLL_FIELDS)
    state = snapshot.state('ops_bike_payroll_policy', 'current', PAYROLL_FIELDS)
    month = snapshot.get('ops_bike_salary_periods', current, ('period', 'driver_ids'))
    roster_key = hashlib.sha256(driver_id.encode()).hexdigest()
    enrollment = snapshot.get('ops_bike_salary_roster', roster_key, ('driver_id', 'active', 'enrollments', 'salary_accounted_through'))
    obligation_key = hashlib.sha256(('bike-salary:' + driver_id + ':' + current).encode()).hexdigest()
    obligation = snapshot.get('ops_bike_salary_obligations', obligation_key,
                              ('driver_id', 'period', 'status', 'amount_paise', 'received_at', 'version'))
    if not row:
        return {'read_status': state, 'current_salary_period': current, 'metadata_checks': {}}
    roster = row.get('roster')
    valid_roster = isinstance(roster, list) and all(isinstance(item, dict) and pilot.valid_identifier(item.get('driver_id')) for item in roster)
    active = [item['driver_id'] for item in roster if item.get('active') is True] if valid_roster else []
    recorded = month.get('driver_ids', []) if month else []
    valid_recorded = isinstance(recorded, list) and len(recorded) <= 100 and all(pilot.valid_identifier(uid) for uid in recorded)
    month_readable = snapshot.state('ops_bike_salary_periods', current, ('period', 'driver_ids')) != 'read_failed'
    known_obligations = set(active) | set(recorded) if valid_roster and valid_recorded and month_readable else None
    funding = integer(row.get('monthly_funding_paise'))
    # This is only the existing policy's declared metadata threshold, not a
    # reconstruction of payments, ledger balances or a bank-funding attestation.
    checks = {'payroll_enabled': row.get('enabled') is True,
              'one_to_three_distinct_active_riders': valid_roster and 1 <= len(active) <= 3 and len(set(active)) == len(active),
              'selected_rider_active_in_policy': driver_id in active,
              'funding_period_is_current': row.get('funding_period') == current,
              'funding_acknowledged': row.get('funding_acknowledged') is True,
              'funding_reference_metadata_complete': isinstance(row.get('funding_reference'), str) and len(row['funding_reference'].strip()) >= 8,
              'funding_evidence_metadata_complete': isinstance(row.get('funding_evidence'), str) and len(row['funding_evidence'].strip()) >= 10,
              'funding_amount_covers_recorded_roster_metadata': bool(known_obligations and funding is not None and funding >= len(known_obligations) * 700000)}
    return {'read_status': state, 'version': integer(row.get('version')), 'current_salary_period': current,
            'active_rider_count': len(active) if valid_roster else None,
            'recorded_salary_obligation_count': len(set(recorded)) if valid_recorded else None,
            'declared_monthly_funding_paise': funding, 'monthly_salary_paise': integer(row.get('monthly_salary_paise')),
            'metadata_checks': checks, 'missing_inputs': [key for key, value in checks.items() if not value],
            'selected_enrollment': {'read_status': snapshot.state('ops_bike_salary_roster', roster_key, ('driver_id', 'active', 'enrollments', 'salary_accounted_through')),
                'account_matches_target': bool(enrollment and enrollment.get('driver_id') == driver_id),
                'active': bool(enrollment and enrollment.get('active') is True)},
            'selected_current_obligation': {'read_status': snapshot.state('ops_bike_salary_obligations', obligation_key, ('driver_id', 'period', 'status', 'amount_paise', 'received_at', 'version')),
                'account_matches_target': bool(obligation and obligation.get('driver_id') == driver_id),
                'period_matches_current': bool(obligation and obligation.get('period') == current),
                'status': enum((obligation or {}).get('status'), ('owed', 'transfer_reported', 'driver_received')),
                'amount_paise': integer((obligation or {}).get('amount_paise'))},
            'scope': 'Metadata only; funding acknowledgement is not bank verification. Other roster members, independent earnings, cash ledgers and available promotion funds are not evaluated.'}


def independent_metadata(snapshot, driver_id):
    fields = ('version', 'terms_version', 'enabled', 'reviewed', 'paid_payout_bps', 'promo_payout_paise', 'terms')
    rider_fields = ('id', 'version', 'status', 'terms_version')
    row = snapshot.get('ops_bike_earnings_policy', 'current', fields)
    rider = snapshot.get('ops_bike_independent_riders', driver_id, rider_fields)
    state = snapshot.state('ops_bike_earnings_policy', 'current', fields)
    rider_state = snapshot.state('ops_bike_independent_riders', driver_id, rider_fields)
    row, rider = row or {}, rider or {}
    paid_share = row.get('paid_payout_bps')
    version = row.get('terms_version')
    checks = {'company_policy_enabled': row.get('enabled') is True,
              'company_policy_reviewed': row.get('reviewed') is True,
              'company_paid_share_configured': type(paid_share) is int and 0 < paid_share <= 10000,
              'company_terms_present': bool(isinstance(row.get('terms'), str) and row['terms'].strip()),
              'selected_agreement_matches_account': rider.get('id') == driver_id,
              'selected_agreement_approved': rider.get('status') == 'approved',
              'selected_agreement_uses_current_terms': type(version) is int and version > 0 and rider.get('terms_version') == version}
    return {'policy_read_status': state, 'selected_agreement_read_status': rider_state,
            'policy_version': integer(row.get('version')), 'selected_agreement_version': integer(rider.get('version')),
            'selected_agreement_status': enum(rider.get('status'), ('pending', 'approved', 'rejected', 'suspended')),
            'metadata_checks': checks, 'metadata_matches': all(checks.values()),
            'scope': 'Agreement metadata only. This does not establish a funded salaried assignment, promotion funds, approval freshness, an available rider or a bookable quote. An approved independent agreement must be resolved through company admin before salary enrollment.'}


def diagnose(reader, *, driver_id, vehicle_id, now=None, public_policy=None):
    now = time.time() if now is None else now
    snapshot = Snapshot(reader)
    auth_failure = None
    try:
        users = reader.auth_uid(driver_id)
        auth = next((row for row in users if row.get('localId') == driver_id), None)
        account = {'read_status': 'ok', 'exists': bool(auth), 'disabled': bool(auth and auth.get('disabled')),
                   'phone_linked': bool(auth and auth.get('phoneNumber'))}
    except pilot.CloudOperationError as error:
        auth_failure = error.diagnostic
        account = {'read_status': 'read_failed'}
    result = {'project': pilot.PROJECT, 'read_only': True, 'mutations_performed': False,
              'selected_driver_id': driver_id, 'selected_vehicle_id': vehicle_id, 'account': account,
              'selected_vehicle': selected_vehicle(snapshot, driver_id, vehicle_id, now),
              'selected_salary_profile_candidates': [profile(snapshot, driver_id, role, now) for role in ('driver', 'cab_owner')],
              'saved_ride_policy': ride_policy(snapshot, now), 'saved_salary_metadata': salary_metadata(snapshot, driver_id, now),
              'saved_independent_metadata': independent_metadata(snapshot, driver_id),
              'serving_api_readiness': launch.policy_summary(public_policy) if public_policy is not None else launch.public_policy(),
              'operational_note': 'Only the serving API reports booking readiness. Metadata does not replace human document review, actual funding, dispatch health, real rider GPS or an end-to-end ground test. No native payroll GET or accrual was called.'}
    result['cloud_read_errors'] = ([auth_failure] if auth_failure else []) + list(snapshot.failures.values())
    result['status'] = 'inventory_partial' if result['cloud_read_errors'] else 'inventory_complete'
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--driver-id', type=identifier_argument, required=True)
    parser.add_argument('--vehicle-id', type=identifier_argument, required=True)
    args = parser.parse_args(argv)
    try:
        result = diagnose(pilot.CloudReader(pilot.oauth_token()), driver_id=args.driver_id, vehicle_id=args.vehicle_id)
        print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))
        return 1 if result['status'] == 'inventory_partial' else 0
    except pilot.InventoryError as error:
        print(json.dumps({'status': 'inventory_failed', 'reason': str(error), 'mutations_performed': False}), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
