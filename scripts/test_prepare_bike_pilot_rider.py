"""Offline safeguards for the exact-account Cloud Shell inventory."""

import importlib.util
import io
import json
from pathlib import Path
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest.mock import patch
import urllib.error
import urllib.request

SPEC = importlib.util.spec_from_file_location('bike_pilot', Path(__file__).with_name('prepare-bike-pilot-rider.py'))
pilot = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pilot)
NOW = 1792454400
UID = 'pilot-account-uid'
EMAIL = 'pilot@example.test'
REGISTRATION = 'AAO1ZZ9999'


class FakeReader:
    def __init__(self, users=None, contacts=None, documents=None, vehicles=None):
        self.users = users if users is not None else [{'localId': UID, 'email': EMAIL, 'phoneNumber': '+919999999999', 'displayName': 'PRIVATE NAME'}]
        self.contacts = contacts or []
        self.documents = documents or {}
        self.vehicles = vehicles or []
        self.calls = []

    def auth_email(self, email):
        self.calls.append(('auth_email', email))
        return self.users

    def auth_uid(self, uid):
        self.calls.append(('auth_uid', uid))
        return [row for row in self.users if row.get('localId') == uid]

    def query(self, collection, field, value, fields, limit=21):
        self.calls.append(('query', collection, field, value, tuple(fields), limit))
        if collection == 'ops_account_contacts':
            return self.contacts
        return [row for row in self.vehicles if row.get(field) == value][:limit]

    def document(self, collection, identifier):
        self.calls.append(('document', collection, identifier))
        return self.documents.get((collection, identifier))


def partner():
    return {'_document_id': UID, 'id': UID, 'user_id': UID, 'name': 'PRIVATE NAME', 'city': 'Balasore',
            'address': 'PRIVATE ADDRESS', 'location': {'lat': 21, 'lng': 86}, 'role': 'cab_owner',
            'status': 'approved', 'version': 3, 'valid_until': NOW + 86400, 'document_ids': ['private-document-id']}


def vehicle(**changes):
    return {'_document_id': 'real-bike-id', 'id': 'real-bike-id', 'owner_id': UID,
            'registration': REGISTRATION, 'name': 'Existing bike model', 'vehicle_kind': 'bike',
            'active': True, 'mode': 'cab', 'seats': 1, 'status': 'approved', 'version': 2,
            'valid_until': NOW + 86400, 'document_ids': ['private-document-id'], **changes}


class PilotInventoryTests(unittest.TestCase):
    def test_cli_requires_both_scope_arguments_before_obtaining_oauth(self):
        for arguments in ([], ['--email', EMAIL], ['--registration', REGISTRATION]):
            with patch.object(pilot, 'oauth_token') as token, redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as caught:
                    pilot.main(arguments)
                self.assertEqual(caught.exception.code, 2)
                token.assert_not_called()

    def test_cli_applies_only_the_supplied_account_and_literal_plate(self):
        email = 'another-pilot@example.test'
        registration = 'BBO2YY8888'
        reader = FakeReader(users=[{'localId': UID, 'email': email}], vehicles=[vehicle(registration=registration)])
        output = io.StringIO()
        with patch.object(pilot, 'oauth_token', return_value='test-token'), patch.object(pilot, 'CloudReader', return_value=reader), redirect_stdout(output):
            self.assertEqual(pilot.main(['--email', email, '--registration', registration]), 0)
        result = json.loads(output.getvalue())
        self.assertEqual(result['target_email'], email)
        self.assertEqual(result['confirmed_registration'], registration)
        self.assertEqual(reader.calls[0], ('auth_email', email))
        self.assertTrue(any(call[:4] == ('query', 'ops_account_contacts', 'email', email) for call in reader.calls))
        self.assertTrue(any(call[:4] == ('query', 'ops_mobility_vehicles', 'registration', registration) for call in reader.calls))
        self.assertTrue(result['bikes'][0]['registration_matches_requested'])

    def test_invalid_scope_is_rejected_before_cloud_access(self):
        for arguments in (['--email', 'incomplete', '--registration', REGISTRATION],
                          ['--email', EMAIL, '--registration', 'bad/plate']):
            with patch.object(pilot, 'oauth_token') as token, redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    pilot.main(arguments)
                token.assert_not_called()

    def test_existing_complete_inventory_is_read_only_and_redacted(self):
        reader = FakeReader(documents={('ops_business_partners', UID): partner(),
                            ('ops_business_documents', 'private-document-id'): {'owner_id': UID, 'object': 'PRIVATE PHOTO PATH'}},
                            vehicles=[vehicle()])
        result = pilot.inventory(reader, email=EMAIL, registration=REGISTRATION, now=NOW)
        self.assertEqual(result['identity']['uid'], UID)
        self.assertEqual(result['confirmed_registration'], REGISTRATION)
        self.assertEqual(result['blockers'], [])
        self.assertFalse(result['mutations_performed'])
        self.assertTrue(result['profiles'][0]['documents']['visual_review_required'])
        output = json.dumps(result)
        for private in ('PRIVATE NAME', 'PRIVATE ADDRESS', 'PRIVATE PHOTO PATH', '+919999999999', 'private-document-id'):
            self.assertNotIn(private, output)
        self.assertTrue(all(call[0] in ('auth_email', 'auth_uid', 'query', 'document') for call in reader.calls))

    def test_no_account_does_not_create_or_invent_identity_or_bike(self):
        reader = FakeReader(users=[])
        result = pilot.inventory(reader, email=EMAIL, registration=REGISTRATION, now=NOW)
        self.assertFalse(result['identity']['unique'])
        self.assertEqual(result['profiles'], [])
        self.assertEqual(result['bikes'], [])
        self.assertTrue(result['blockers'])
        self.assertFalse(any(call[0] == 'document' for call in reader.calls))

    def test_ambiguous_contact_prevents_target_scope_reads(self):
        reader = FakeReader(contacts=[{'_document_id': 'a-different-uid', 'email_verified': False}])
        result = pilot.inventory(reader, email=EMAIL, registration=REGISTRATION, now=NOW)
        self.assertFalse(result['identity']['unique'])
        self.assertFalse(any(call[0] == 'document' for call in reader.calls))
        self.assertEqual(result['identity']['uids'], ['a-different-uid', UID])

    def test_unverified_contact_is_not_treated_as_verified_account(self):
        reader = FakeReader(users=[], contacts=[{'_document_id': UID, 'email_verified': False}])
        result = pilot.inventory(reader, email=EMAIL, registration=REGISTRATION, now=NOW)
        self.assertFalse(result['identity']['auth_account_exists'])
        self.assertTrue(any('unverified app contact' in blocker for blocker in result['blockers']))

    def test_wrong_owner_or_expired_metadata_does_not_pass_document_checks(self):
        reader = FakeReader(documents={('ops_business_documents', 'private-document-id'):
                            {'owner_id': 'another-uid', 'expires_at': NOW - 1}})
        result = pilot.document_checks(reader, partner(), UID, NOW)
        self.assertFalse(result['owner_matches'])
        self.assertFalse(result['no_recorded_expiry_violation'])

    def test_absent_expiry_metadata_stays_unknown_for_human_review(self):
        reader = FakeReader(documents={('ops_business_documents', 'private-document-id'): {'owner_id': UID}})
        checks = pilot.document_checks(reader, partner(), UID, NOW)
        self.assertTrue(checks['no_recorded_expiry_violation'])
        self.assertEqual(checks['expiry_metadata_missing_count'], 1)
        self.assertTrue(checks['visual_review_required'])

    def test_foreign_plate_is_reported_without_private_owner_or_model(self):
        reader = FakeReader(vehicles=[vehicle(owner_id='PRIVATE FOREIGN OWNER', name='PRIVATE FOREIGN MODEL')])
        result = pilot.inventory(reader, email=EMAIL, registration=REGISTRATION, now=NOW)
        self.assertEqual(result['bikes'], [])
        self.assertEqual(result['plate_matches'][0]['vehicle_id'], 'real-bike-id')
        self.assertFalse(result['plate_matches'][0]['owner_matches_target'])
        output = json.dumps(result)
        self.assertNotIn('PRIVATE FOREIGN OWNER', output)
        self.assertNotIn('PRIVATE FOREIGN MODEL', output)

    def test_letter_o_plate_is_not_silently_changed_to_zero(self):
        reader = FakeReader(vehicles=[vehicle(registration='AA01ZZ9999')])
        result = pilot.inventory(reader, email=EMAIL, registration=REGISTRATION, now=NOW)
        self.assertEqual(result['plate_matches'], [])
        self.assertFalse(result['bikes'][0]['registration_matches_requested'])
        queries = [call for call in reader.calls if call[:3] == ('query', 'ops_mobility_vehicles', 'registration')]
        self.assertEqual(queries[0][3], REGISTRATION)

    def test_transport_does_not_allow_redirects_secrets_or_other_project(self):
        reader = pilot.CloudReader('test-token')
        for url in ('https://example.com', 'https://secretmanager.googleapis.com/v1/projects/repaido/secrets/key/versions/1:access',
                    pilot.FIRESTORE.replace('/repaido/', '/other-project/') + '/ops_business_partners/test'):
            with self.assertRaises(pilot.InventoryError):
                reader.read(url)
        self.assertIsNone(pilot.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://example.com'))

    def test_cloud_errors_do_not_echo_private_response_or_token(self):
        class FailingOpener:
            def open(self, req, timeout):
                raise urllib.error.HTTPError(req.full_url, 403, 'PRIVATE ERROR', {}, io.BytesIO(b'PRIVATE RESPONSE'))
        reader = pilot.CloudReader('PRIVATE_TOKEN', FailingOpener())
        with self.assertRaises(pilot.InventoryError) as caught:
            reader.auth_email(EMAIL)
        self.assertNotIn('PRIVATE', str(caught.exception))
        self.assertIn('HTTP 403', str(caught.exception))

    def test_user_oauth_requests_explicitly_select_the_quota_project(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self, count): return b'{"users":[]}'
        class Opener:
            def open(self, request, timeout):
                self.request = request
                return Response()
        opener = Opener()
        pilot.CloudReader('test-token', opener).auth_email(EMAIL)
        self.assertEqual(opener.request.get_header('X-goog-user-project'), 'repaido')

    def test_403_known_reasons_distinguish_quota_service_scope_and_iam(self):
        checks = {'USER_PROJECT_DENIED': 'serviceusage.services.use',
                  'SERVICE_DISABLED': 'API for this operation',
                  'ACCESS_TOKEN_SCOPE_INSUFFICIENT': 'OAuth session scopes',
                  'IAM_PERMISSION_DENIED': 'operation permissions'}
        for reason, hint in checks.items():
            with self.subTest(reason=reason):
                detail = {'error': {'status': 'PERMISSION_DENIED', 'message': 'PRIVATE PHONE AND TOKEN',
                          'details': [{'@type': 'type.googleapis.com/google.rpc.ErrorInfo',
                                       'domain': 'googleapis.com', 'reason': reason,
                                       'metadata': {'subject': 'PRIVATE USER', 'resource': 'PRIVATE DOCUMENT'}}]}}
                diagnostic = pilot.error_diagnostic(pilot.IDENTITY + '/accounts:lookup', 403, detail)
                self.assertEqual(diagnostic['operation'], 'identitytoolkit.accounts.lookup')
                self.assertEqual(diagnostic['google_status'], 'PERMISSION_DENIED')
                self.assertEqual(diagnostic['google_reasons'], [reason])
                self.assertEqual(diagnostic['required_resource_permissions'], ['firebaseauth.users.get'])
                self.assertIn(hint, diagnostic['next_check'])
                self.assertNotIn('PRIVATE', json.dumps(diagnostic))

    def test_unrecognized_error_strings_and_metadata_are_never_echoed(self):
        detail = {'error': {'status': 'PRIVATE STATUS', 'message': EMAIL, 'details': [
            {'@type': 'type.googleapis.com/google.rpc.ErrorInfo', 'domain': 'googleapis.com', 'reason': 'PRIVATE_REASON'},
            {'@type': 'PRIVATE TYPE', 'domain': 'googleapis.com', 'reason': 'SERVICE_DISABLED'},
            {'@type': 'type.googleapis.com/google.rpc.ErrorInfo', 'domain': 'PRIVATE DOMAIN', 'reason': 'USER_PROJECT_DENIED'},
            {'@type': 'type.googleapis.com/google.rpc.ErrorInfo', 'domain': 'googleapis.com', 'reason': ['PRIVATE MALFORMED']}]}}
        diagnostic = pilot.error_diagnostic(pilot.FIRESTORE + ':runQuery', 403, detail)
        self.assertEqual(diagnostic['google_reasons'], [])
        self.assertNotIn('google_status', diagnostic)
        self.assertNotIn('PRIVATE', json.dumps(diagnostic))
        self.assertNotIn(EMAIL, json.dumps(diagnostic))

    def test_operation_permissions_are_specific_without_resource_identifiers(self):
        for endpoint, expected, permissions in (
                (pilot.IDENTITY + '/accounts', 'identitytoolkit.accounts.create', ['firebaseauth.users.create']),
                (pilot.FIRESTORE + ':runQuery', 'firestore.documents.runQuery', ['datastore.entities.get', 'datastore.entities.list']),
                (pilot.FIRESTORE + '/ops_business_partners/private-account-id', 'firestore.documents.get', ['datastore.entities.get'])):
            diagnostic = pilot.error_diagnostic(endpoint, 403)
            self.assertEqual(diagnostic['operation'], expected)
            self.assertEqual(diagnostic['required_resource_permissions'], permissions)
            self.assertNotIn('private-account-id', json.dumps(diagnostic))

    def test_cli_403_reports_diagnostic_and_never_reaches_creation(self):
        class Opener:
            def __init__(self): self.calls = []
            def open(self, request, timeout):
                self.calls.append(request)
                payload = {'error': {'status': 'PERMISSION_DENIED', 'message': 'PRIVATE RESPONSE', 'details': [
                    {'@type': 'type.googleapis.com/google.rpc.ErrorInfo', 'domain': 'googleapis.com', 'reason': 'USER_PROJECT_DENIED'}]}}
                raise urllib.error.HTTPError(request.full_url, 403, 'PRIVATE ERROR', {}, io.BytesIO(json.dumps(payload).encode()))
        opener = Opener()
        reader = pilot.CloudReader('PRIVATE_TOKEN', opener, allow_account_creation=True)
        output = io.StringIO()
        with patch.object(pilot, 'oauth_token', return_value='PRIVATE_TOKEN'), patch.object(pilot, 'CloudReader', return_value=reader), redirect_stderr(output):
            self.assertEqual(pilot.main(['--email', EMAIL, '--registration', REGISTRATION, '--create-account-if-missing']), 1)
        result = json.loads(output.getvalue())
        self.assertEqual(result['diagnostic']['operation'], 'identitytoolkit.accounts.lookup')
        self.assertEqual(result['diagnostic']['google_reasons'], ['USER_PROJECT_DENIED'])
        self.assertFalse(result['mutations_performed'])
        self.assertEqual(len(opener.calls), 1)
        self.assertEqual(opener.calls[0].full_url, pilot.IDENTITY + '/accounts:lookup')
        self.assertNotIn('PRIVATE', output.getvalue())
        self.assertNotIn(EMAIL, output.getvalue())

    def test_invalid_or_oversized_error_body_still_identifies_operation(self):
        for payload in (b'PRIVATE INVALID JSON', b'x' * (pilot.MAX_ERROR_BYTES + 1)):
            class Opener:
                def open(self, request, timeout):
                    raise urllib.error.HTTPError(request.full_url, 403, 'PRIVATE ERROR', {}, io.BytesIO(payload))
            with self.assertRaises(pilot.CloudOperationError) as caught:
                pilot.CloudReader('test-token', Opener()).auth_email(EMAIL)
            self.assertEqual(caught.exception.diagnostic['operation'], 'identitytoolkit.accounts.lookup')
            self.assertEqual(caught.exception.diagnostic['google_reasons'], [])
            self.assertNotIn('PRIVATE', str(caught.exception))

    def test_default_adapter_cannot_create_account_or_write_firestore(self):
        reader = pilot.CloudReader('test-token')
        with self.assertRaises(pilot.InventoryError):
            reader.create_auth_account(EMAIL)
        with self.assertRaises(pilot.InventoryError):
            reader.read(pilot.FIRESTORE + '/ops_business_partners/test', {'status': 'approved'})

    def test_creation_only_supplies_exact_unverified_email(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self, count): return json.dumps({'localId': UID}).encode()
        class Opener:
            calls = []
            def open(self, request, timeout):
                self.calls.append(request)
                return Response()
        opener = Opener()
        reader = pilot.CloudReader('test-token', opener, allow_account_creation=True)
        self.assertEqual(reader.create_auth_account(EMAIL), UID)
        self.assertEqual(opener.calls[0].full_url, pilot.IDENTITY + '/accounts')
        self.assertEqual(json.loads(opener.calls[0].data), {'email': EMAIL, 'emailVerified': False})

    def test_existing_account_is_reused_without_altering_claims_or_providers(self):
        reader = FakeReader()
        result = pilot.create_account_if_missing(reader, email=EMAIL, registration=REGISTRATION, now=NOW)
        self.assertFalse(result['mutations_performed'])
        self.assertEqual(result['account_creation']['status'], 'existing_account_reused')
        self.assertFalse(any(call[0] == 'create' for call in reader.calls))

    def test_contact_only_or_ambiguous_identity_cannot_create_duplicate(self):
        for reader in (FakeReader(users=[], contacts=[{'_document_id': UID, 'email_verified': False}]),
                       FakeReader(contacts=[{'_document_id': 'different-uid', 'email_verified': True}])):
            with self.assertRaises(pilot.InventoryError):
                pilot.create_account_if_missing(reader, email=EMAIL, registration=REGISTRATION, now=NOW)

    def test_missing_account_can_be_created_but_profile_approval_stays_pending(self):
        class CreatingReader(FakeReader):
            def create_auth_account(self, email):
                self.calls.append(('create',))
                self.assert_scoped_email = email
                self.users.append({'localId': UID, 'email': email, 'emailVerified': False})
                return UID
        reader = CreatingReader(users=[])
        result = pilot.create_account_if_missing(reader, email=EMAIL, registration=REGISTRATION, now=NOW)
        self.assertTrue(result['mutations_performed'])
        self.assertEqual(result['account_creation']['uid'], UID)
        self.assertEqual(reader.assert_scoped_email, EMAIL)
        self.assertFalse(result['account_creation']['profile_approved'])
        self.assertFalse(result['account_creation']['vehicle_approved'])
        self.assertFalse(result['identity']['phone_linked'])
        self.assertEqual(sum(call[0] == 'create' for call in reader.calls), 1)
        again = pilot.create_account_if_missing(reader, email=EMAIL, registration=REGISTRATION, now=NOW)
        self.assertFalse(again['mutations_performed'])
        self.assertEqual(sum(call[0] == 'create' for call in reader.calls), 1)

    def test_concurrent_email_creation_is_looked_up_without_overwrite(self):
        class RacingReader(FakeReader):
            def create_auth_account(self, email):
                self.assert_scoped_email = email
                self.users.append({'localId': UID, 'email': email})
                raise pilot.AccountAlreadyExists('already exists')
        result = pilot.create_account_if_missing(RacingReader(users=[]), email=EMAIL, registration=REGISTRATION, now=NOW)
        self.assertEqual(result['account_creation']['status'], 'existing_account_reused')
        self.assertFalse(result['mutations_performed'])

    def test_uncertain_creation_is_not_reported_as_no_change(self):
        class UncertainReader(FakeReader):
            def create_auth_account(self, email):
                raise pilot.InventoryError('timeout after request was sent')
        with self.assertRaises(pilot.AccountCreationOutcomeUnknown) as caught:
            pilot.create_account_if_missing(UncertainReader(users=[]), email=EMAIL, registration=REGISTRATION, now=NOW)
        self.assertIn('Run read-only inventory', str(caught.exception))

    def test_email_exists_http_response_is_safely_reused(self):
        class Opener:
            def open(self, req, timeout):
                raise urllib.error.HTTPError(req.full_url, 400, '', {},
                                            io.BytesIO(b'{"error":{"message":"EMAIL_EXISTS"}}'))
        reader = pilot.CloudReader('test-token', Opener(), allow_account_creation=True)
        with self.assertRaises(pilot.AccountAlreadyExists):
            reader.create_auth_account(EMAIL)


if __name__ == '__main__':
    unittest.main()
