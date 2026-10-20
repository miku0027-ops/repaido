"""Offline scoped-read, privacy and real readiness-boundary regression checks."""

import datetime as dt
import hashlib
import importlib.util
import io
import json
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.parse


SPEC = importlib.util.spec_from_file_location('pilot_readiness', Path(__file__).with_name('check-bike-pilot-readiness.py'))
ready = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ready)
UID = 'explicit-mobile-account'
VEHICLE = 'selected-bike-record'
NOW = dt.datetime(2026, 10, 20, 9, tzinfo=dt.timezone.utc).timestamp()
PRIVATE = 'PRIVATE_SENTINEL_phone_plate_reference_photo_name'


def encode(value):
    if value is None:
        return {'nullValue': None}
    if type(value) is bool:
        return {'booleanValue': value}
    if type(value) is int:
        return {'integerValue': str(value)}
    if type(value) is float:
        return {'doubleValue': value}
    if isinstance(value, str):
        return {'stringValue': value}
    if isinstance(value, list):
        return {'arrayValue': {'values': [encode(item) for item in value]}}
    return {'mapValue': {'fields': {key: encode(item) for key, item in value.items()}}}


class FakeReader:
    def __init__(self, documents=None, errors=None, auth_error=None):
        self.documents = documents or {}
        self.errors = errors or {}
        self.auth_error = auth_error
        self.calls = []

    def auth_uid(self, uid):
        self.calls.append(('auth_uid', uid))
        if self.auth_error:
            raise self.auth_error
        return [{'localId': uid, 'phoneNumber': PRIVATE, 'email': PRIVATE, 'displayName': PRIVATE}]

    def read(self, url, body=None, *, missing_ok=False):
        parsed = urllib.parse.urlsplit(url)
        collection, identifier = [urllib.parse.unquote(part) for part in parsed.path.rsplit('/', 2)[-2:]]
        fields = urllib.parse.parse_qs(parsed.query).get('mask.fieldPaths', [])
        self.calls.append(('get', collection, identifier, tuple(fields)))
        assert body is None and missing_ok and fields
        if (collection, identifier) in self.errors:
            raise self.errors[collection, identifier]
        row = self.documents.get((collection, identifier))
        if row is None:
            return None
        return {'name': url.split('?')[0], 'fields': {key: encode(value) for key, value in row.items() if key in fields}}


def fixtures():
    partner = {'id': UID, 'user_id': UID, 'role': 'cab_owner', 'status': 'approved', 'city': 'Balasore',
               'version': 3, 'valid_until': NOW + 86400, 'document_ids': ['private-doc'], 'name': PRIVATE}
    vehicle = {'id': VEHICLE, 'owner_id': UID, 'driver_id': None, 'vehicle_kind': 'bike', 'seats': 1,
               'status': 'approved', 'active': True, 'mode': 'cab', 'valid_until': NOW + 86400,
               'document_ids': ['private-doc'], 'name': PRIVATE, 'registration': PRIVATE}
    policy = {'version': 1, 'enabled': False, 'cash_enabled': True, 'base_paise': 800, 'per_km_paise': 500,
              'per_minute_paise': 0, 'minimum_paise': 0, 'gst_bps': 0, 'tax_reviewed': True, 'terms': PRIVATE,
              'service_center': {'lat': 21.5118, 'lng': 86.9252}, 'service_area_reviewed': True,
              'service_radius_metres': 4000, 'pickup_radius_metres': 4000, 'service_area_radius_metres': 8000,
              'promo_enabled': True, 'promo_started_at': NOW - 3600, 'promo_terms_reviewed': True,
              'free_distance_metres': 2000, 'weekly_free_limit': 3, 'cooldown_hours': 36}
    payroll = {'version': 2, 'enabled': True, 'monthly_salary_paise': 700000, 'monthly_funding_paise': 700000,
               'funding_period': '2026-10', 'funding_reference': PRIVATE, 'funding_evidence': PRIVATE,
               'funding_acknowledged': True, 'roster': [{'driver_id': UID, 'active': True, 'name': PRIVATE}]}
    roster_key = hashlib.sha256(UID.encode()).hexdigest()
    obligation = hashlib.sha256(('bike-salary:' + UID + ':2026-10').encode()).hexdigest()
    return {('ops_business_partners', UID): partner,
            ('ops_business_documents', 'private-doc'): {'owner_id': UID, 'expires_at': NOW + 86400, 'object': PRIVATE},
            ('ops_mobility_vehicles', VEHICLE): vehicle, ('ops_bike_policy', 'current'): policy,
            ('ops_bike_payroll_policy', 'current'): payroll,
            ('ops_bike_salary_periods', '2026-10'): {'period': '2026-10', 'driver_ids': [UID]},
            ('ops_bike_salary_roster', roster_key): {'driver_id': UID, 'active': True, 'enrollments': [{'started_at': NOW - 86400}], 'name': PRIVATE},
            ('ops_bike_salary_obligations', obligation): {'driver_id': UID, 'period': '2026-10', 'status': 'driver_received',
                'amount_paise': 700000, 'transfer': {'reference': PRIVATE}}}


class ReadinessTests(unittest.TestCase):
    def inspect(self, documents=None, **kwargs):
        reader = FakeReader(fixtures() if documents is None else documents, **kwargs)
        value = ready.diagnose(reader, driver_id=UID, vehicle_id=VEHICLE, now=NOW,
                               public_policy={'version': 1, 'bookings_available': False, 'dispatch_ready': False, 'terms': PRIVATE})
        return reader, value

    def test_complete_metadata_stays_redacted_scoped_and_does_not_claim_live_readiness(self):
        reader, value = self.inspect()
        output = json.dumps(value)
        for hidden in (PRIVATE, 'private-doc', '21.5118', '86.9252'):
            self.assertNotIn(hidden, output)
        self.assertEqual(value['status'], 'inventory_complete')
        self.assertTrue(all(value['selected_vehicle']['metadata_checks'].values()))
        self.assertEqual(value['saved_salary_metadata']['missing_inputs'], [])
        self.assertEqual(value['saved_ride_policy']['missing_inputs'], [])
        self.assertFalse(value['serving_api_readiness']['bookings_available'])
        self.assertFalse(value['mutations_performed'])
        self.assertNotIn('bookings_ready', value)
        self.assertEqual(reader.calls[0], ('auth_uid', UID))
        vehicle_calls = [call for call in reader.calls if call[:2] == ('get', 'ops_mobility_vehicles')]
        self.assertEqual([call[2] for call in vehicle_calls], [VEHICLE])
        self.assertTrue(all(call[0] in ('auth_uid', 'get') for call in reader.calls))
        self.assertFalse(any('transfer' in call[-1] or 'name' in call[-1] or 'registration' in call[-1] for call in reader.calls if call[0] == 'get'))
        self.assertEqual(value['saved_salary_metadata']['selected_current_obligation']['status'], 'driver_received')

    def test_owner_of_a_bike_assigned_elsewhere_cannot_be_reported_as_its_operator(self):
        documents = fixtures()
        documents['ops_mobility_vehicles', VEHICLE]['driver_id'] = 'different-private-operator'
        _, value = self.inspect(documents)
        self.assertFalse(value['selected_vehicle']['metadata_checks']['physical_operator_matches_selected_uid'])
        self.assertEqual(value['selected_vehicle']['operator_profile']['read_status'], 'not_found')
        self.assertNotIn('different-private-operator', json.dumps(value))

    def test_actual_missing_saved_policy_inputs_are_identified_without_echoing_terms_or_location(self):
        documents = fixtures()
        documents['ops_bike_policy', 'current'].update(cash_enabled=False, tax_reviewed=False, terms='',
            service_center=None, service_area_reviewed=False, promo_started_at=None, promo_terms_reviewed=False)
        _, value = self.inspect(documents)
        missing = value['saved_ride_policy']['missing_inputs']
        for key in ('cash_enabled', 'tax_reviewed', 'terms_present', 'service_center_present',
                    'service_area_reviewed', 'promo_start_recorded', 'promo_window_current', 'promo_terms_reviewed'):
            self.assertIn(key, missing)
        self.assertEqual(value['saved_ride_policy']['version'], 1)
        self.assertFalse(value['saved_ride_policy']['enabled'])

    def test_current_month_and_earned_offboarded_obligations_cannot_be_ignored(self):
        documents = fixtures()
        documents['ops_bike_salary_periods', '2026-10']['driver_ids'].append('offboarded-private-person')
        documents['ops_bike_payroll_policy', 'current'].update(funding_period='2026-09', funding_reference='short', funding_evidence='short')
        _, value = self.inspect(documents)
        salary = value['saved_salary_metadata']
        self.assertEqual(salary['recorded_salary_obligation_count'], 2)
        for key in ('funding_period_is_current', 'funding_reference_metadata_complete',
                    'funding_evidence_metadata_complete', 'funding_amount_covers_recorded_roster_metadata'):
            self.assertIn(key, salary['missing_inputs'])
        self.assertNotIn('offboarded-private-person', json.dumps(value))

    def test_month_boundaries_and_six_month_window_match_indian_calendar(self):
        boundary = dt.datetime(2026, 10, 31, 20, tzinfo=dt.timezone.utc).timestamp()
        self.assertEqual(ready.period_at(boundary), '2026-11')
        start = dt.datetime(2026, 3, 31, 1, 15, tzinfo=ready.INDIA).timestamp()
        expected = dt.datetime(2026, 9, 30, 1, 15, tzinfo=ready.INDIA).timestamp()
        self.assertEqual(ready.six_month_end(start), expected)
        self.assertIsNone(ready.six_month_end(float('nan')))

    def test_read_denial_is_partial_not_resource_absence_or_bank_verification(self):
        diagnostic = ready.pilot.error_diagnostic(ready.pilot.IDENTITY + '/accounts:lookup', 403,
            {'error': {'status': 'PERMISSION_DENIED', 'message': PRIVATE,
             'details': [{'@type': 'type.googleapis.com/google.rpc.ErrorInfo', 'domain': 'googleapis.com',
                          'reason': 'USER_PROJECT_DENIED', 'metadata': {'private': PRIVATE}}]}})
        denied = ready.pilot.CloudOperationError(diagnostic)
        _, value = self.inspect(auth_error=denied, errors={('ops_mobility_vehicles', VEHICLE): denied,
                                                          ('ops_bike_salary_periods', '2026-10'): denied})
        self.assertEqual(value['status'], 'inventory_partial')
        self.assertEqual(value['selected_vehicle']['read_status'], 'read_failed')
        self.assertEqual(value['account']['read_status'], 'read_failed')
        self.assertEqual(value['saved_ride_policy']['version'], 1)
        self.assertFalse(value['saved_salary_metadata']['metadata_checks']['funding_amount_covers_recorded_roster_metadata'])
        self.assertNotIn(PRIVATE, json.dumps(value))
        self.assertEqual(len(value['cloud_read_errors']), 3)

    def test_missing_policies_remain_missing_and_never_accrue_an_obligation(self):
        reader, value = self.inspect({})
        self.assertEqual(value['saved_ride_policy']['read_status'], 'not_found')
        self.assertEqual(value['saved_salary_metadata']['read_status'], 'not_found')
        self.assertEqual(value['selected_vehicle']['read_status'], 'not_found')
        self.assertTrue(all(call[0] in ('auth_uid', 'get') for call in reader.calls))

    def test_independent_company_configuration_does_not_imply_selected_rider_enrollment(self):
        documents = fixtures()
        documents.pop(('ops_bike_payroll_policy', 'current'))
        documents['ops_bike_earnings_policy', 'current'] = {'version': 2, 'terms_version': 1,
            'enabled': True, 'reviewed': True, 'paid_payout_bps': 7500,
            'promo_payout_paise': 1500, 'terms': PRIVATE, 'reference': PRIVATE}
        _, value = self.inspect(documents)
        independent = value['saved_independent_metadata']
        self.assertEqual(value['saved_salary_metadata']['read_status'], 'not_found')
        self.assertTrue(independent['metadata_checks']['company_policy_enabled'])
        self.assertEqual(independent['selected_agreement_read_status'], 'not_found')
        self.assertFalse(independent['metadata_matches'])
        self.assertNotIn(PRIVATE, json.dumps(value))
        self.assertNotIn('7500', json.dumps(independent))

    def test_approved_independent_terms_must_match_selected_account_and_current_policy(self):
        documents = fixtures()
        documents['ops_bike_earnings_policy', 'current'] = {'version': 3, 'terms_version': 2,
            'enabled': True, 'reviewed': True, 'paid_payout_bps': 7500, 'terms': PRIVATE}
        documents['ops_bike_independent_riders', UID] = {'id': UID, 'version': 4,
            'status': 'approved', 'terms_version': 1, 'name': PRIVATE}
        _, value = self.inspect(documents)
        self.assertFalse(value['saved_independent_metadata']['metadata_matches'])
        documents['ops_bike_independent_riders', UID]['terms_version'] = 2
        _, value = self.inspect(documents)
        self.assertTrue(value['saved_independent_metadata']['metadata_matches'])
        documents['ops_bike_independent_riders', UID]['id'] = 'another-private-person'
        _, value = self.inspect(documents)
        self.assertFalse(value['saved_independent_metadata']['metadata_matches'])
        self.assertNotIn('another-private-person', json.dumps(value))

    def test_expired_documents_and_approvals_are_reported_without_document_paths(self):
        documents = fixtures()
        documents['ops_business_documents', 'private-doc']['expires_at'] = NOW
        documents['ops_business_partners', UID]['valid_until'] = NOW + 60
        _, value = self.inspect(documents)
        self.assertFalse(value['selected_vehicle']['documents']['no_recorded_expiry_violation'])
        owner = value['selected_vehicle']['owner_profile']['metadata_checks']
        self.assertTrue(owner['review_current'])
        self.assertFalse(owner['approval_covers_next_30_minutes'])

    def test_malformed_source_text_cannot_enter_shareable_enum_or_numeric_output(self):
        documents = fixtures()
        documents['ops_business_partners', UID].update(status=PRIVATE, version=PRIVATE)
        documents['ops_bike_policy', 'current'].update(base_paise=float('inf'), gst_bps=PRIVATE)
        _, value = self.inspect(documents)
        owner = value['selected_vehicle']['owner_profile']
        self.assertEqual(owner['status'], 'unknown')
        self.assertIsNone(owner['version'])
        self.assertIsNone(value['saved_ride_policy']['numeric_settings']['base_paise'])
        self.assertNotIn(PRIVATE, json.dumps(value, allow_nan=False))

    def test_cli_scope_required_and_invalid_ids_fail_before_oauth(self):
        for arguments in ([], ['--driver-id', UID], ['--vehicle-id', VEHICLE],
                          ['--driver-id', 'bad/id', '--vehicle-id', VEHICLE],
                          ['--driver-id', UID, '--vehicle-id', '..']):
            with patch.object(ready.pilot, 'oauth_token') as token, redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    ready.main(arguments)
                token.assert_not_called()

    def test_real_reader_uses_masked_get_and_quota_header_never_firestore_write(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, size): return b'{"name":"projects/repaido/databases/(default)/documents/ops_bike_policy/current","fields":{}}'

        class Opener:
            def __init__(self): self.request = None
            def open(self, request, timeout):
                self.request = request
                return Response()

        opener = Opener()
        reader = ready.pilot.CloudReader('opaque-oauth-test', opener=opener)
        ready.masked_document(reader, 'ops_bike_policy', 'current', ('version', 'tax_reviewed'))
        request = opener.request
        self.assertEqual(request.get_method(), 'GET')
        self.assertIsNone(request.data)
        self.assertEqual(request.get_header('X-goog-user-project'), 'repaido')
        self.assertEqual(urllib.parse.parse_qs(urllib.parse.urlsplit(request.full_url).query),
                         {'mask.fieldPaths': ['version', 'tax_reviewed']})


if __name__ == '__main__':
    unittest.main()
