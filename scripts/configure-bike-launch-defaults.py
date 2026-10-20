#!/usr/bin/env python3
"""Preview or explicitly save editable, paused Balasore launch defaults.

Uses the authenticated Cloud Shell operator. It fills only a missing centre and
an absent disabled payroll template. It never enrolls a rider, records funding,
changes fares, approves a boundary, or opens bookings. Conditional writes and a
maintenance audit commit together; an uncertain result is never retried here.
"""
import argparse
import datetime as dt
import importlib.util
import json
from pathlib import Path
import time
import urllib.parse
import uuid
from zoneinfo import ZoneInfo

SPEC = importlib.util.spec_from_file_location('launch_defaults_cloud', Path(__file__).with_name('prepare-bike-pilot-rider.py'))
cloud = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cloud)
BASE = cloud.FIRESTORE
DOCS = 'projects/repaido/databases/(default)/documents/'
# Existing Balasore default used by PartnerRegistration; editable in company admin.
CENTRE = {'lat': 21.4934, 'lng': 86.9135}
POLICY = 'ops_bike_policy/current'
PAYROLL = 'ops_bike_payroll_policy/current'
ACTOR = 'cloud-release-operator'


def encode(value):
    if value is None: return {'nullValue': None}
    if type(value) is bool: return {'booleanValue': value}
    if type(value) is int: return {'integerValue': str(value)}
    if type(value) is float: return {'doubleValue': value}
    if isinstance(value, str): return {'stringValue': value}
    if isinstance(value, list): return {'arrayValue': {'values': [encode(item) for item in value]}}
    if isinstance(value, dict): return {'mapValue': {'fields': {key: encode(item) for key, item in value.items()}}}
    raise cloud.InventoryError('Unsupported default field type.')


def document(path, fields):
    return {'name': DOCS + path, 'fields': {key: encode(value) for key, value in fields.items()}}


def read_document(reader, path, fields):
    query = urllib.parse.urlencode([('mask.fieldPaths', field) for field in fields])
    raw = reader.read(BASE + '/' + path + '?' + query, missing_ok=True)
    return raw, cloud.decode_document(raw) if raw else None


def plan(reader, now=None):
    now = time.time() if now is None else now
    raw, policy = read_document(reader, POLICY, ('version', 'enabled', 'service_center', 'service_area_reviewed'))
    if not policy or type(policy.get('version')) is not int or policy['version'] < 0 or not raw.get('updateTime'):
        raise cloud.InventoryError('A saved, versioned bike policy is required before preparing defaults.')
    if policy.get('enabled') is not False:
        raise cloud.InventoryError('Defaults can be prepared only while bike bookings are paused.')
    _, payroll = read_document(reader, PAYROLL, ('version',))
    writes, changes = [], []
    centre = policy.get('service_center')
    if centre is None:
        fields = {'service_center': CENTRE, 'service_area_reviewed': False,
                  'version': policy['version'] + 1, 'updated_by': ACTOR, 'updated_at': now}
        writes.append({'update': document(POLICY, fields), 'updateMask': {'fieldPaths': list(fields)},
                       'currentDocument': {'updateTime': raw['updateTime']}})
        changes.append('missing_balasore_centre')
    else:
        # Preserve any subsequently saved location, including its review state.
        writes.append({'verify': DOCS + POLICY, 'currentDocument': {'updateTime': raw['updateTime']}})
    if payroll is None:
        fields = {'version': 1, 'enabled': False, 'service_city': 'Balasore',
                  'compensation_model': 'monthly_salary', 'monthly_salary_paise': 700000,
                  'monthly_funding_paise': 0,
                  'funding_period': dt.datetime.fromtimestamp(now, ZoneInfo('Asia/Kolkata')).strftime('%Y-%m'),
                  'funding_reference': '', 'funding_evidence': '', 'funding_acknowledged': False,
                  'roster': [], 'updated_by': ACTOR, 'updated_at': now}
        writes.append({'update': document(PAYROLL, fields), 'currentDocument': {'exists': False}})
        changes.append('disabled_salary_template')
    if not changes:
        writes = []
    else:
        key = str(uuid.uuid4())
        writes.append({'update': document('ops_audit/' + key, {'id': key,
            'action': 'BikeLaunchDefaultsPrepared', 'actor_id': ACTOR, 'at': now,
            'source': 'explicit_cloud_shell_maintenance', 'changes': changes,
            'boundary_review_required': centre is None, 'funding_recorded': False,
            'riders_enrolled': False, 'bookings_enabled': False}), 'currentDocument': {'exists': False}})
    summary = {'project': 'repaido', 'changes': changes,
               'centre': CENTRE if centre is None else 'existing_location_preserved',
               'boundary_review_required': centre is None or policy.get('service_area_reviewed') is not True,
               'salary_template': 'create_disabled_unfunded_template' if payroll is None else 'existing_policy_preserved',
               'monthly_salary_paise': 700000, 'funding_recorded': False,
               'riders_enrolled': False, 'bookings_enabled': False}
    return writes, summary


class Writer(cloud.CloudReader):
    def commit_defaults(self, writes):
        # This is the only added write endpoint; normal inventory remains read-only.
        try:
            return self._request(BASE + ':commit', {'writes': writes})
        except cloud.CloudOperationError as error:
            raise cloud.CloudOperationError({**error.diagnostic, 'operation': 'firestore.documents.commit',
                'required_resource_permissions': ['datastore.entities.get', 'datastore.entities.create', 'datastore.entities.update']}) from None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Save only the missing paused defaults shown by the preview.')
    args = parser.parse_args(argv)
    committing = False
    try:
        reader = Writer(cloud.oauth_token())
        writes, summary = plan(reader)
        if args.apply and writes:
            committing = True
            result = reader.commit_defaults(writes)
            if not result.get('commitTime') or len(result.get('writeResults', [])) != len(writes):
                raise cloud.InventoryError('The provider returned incomplete commit metadata; inspect before retrying.')
        print(json.dumps({**summary, 'status': 'saved' if args.apply else 'preview',
                          'mutations_performed': bool(args.apply and writes)}, indent=2))
        return 0
    except (cloud.InventoryError, OSError, ValueError) as error:
        # A transport/response failure during commit cannot establish rollback.
        print(json.dumps({'status': 'outcome_unknown_check_before_retry' if committing else 'stopped',
                          'reason': str(error), 'mutations_performed': None if committing else False}), file=__import__('sys').stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
