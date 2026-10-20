#!/usr/bin/env python3
"""Read-only, exact-account inventory for the first Repaido bike pilot.

Run in Google Cloud Shell with the existing project operator account. OAuth is
captured in memory. Inventory and plan never write. The explicit
--create-account-if-missing flag can create only the exact unverified email auth
account; it never supplies a name, phone, password or role. No mode reads secret
payloads, changes approvals, or writes a Firestore document. Supporting photos, legal
names, telephone numbers, addresses and bank details are not included in output.
"""

import argparse
import datetime as dt
import json
import math
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

PROJECT = 'repaido'
FIRESTORE = f'https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents'
IDENTITY = f'https://identitytoolkit.googleapis.com/v1/projects/{PROJECT}'
MAX_RESPONSE_BYTES = 2 * 1024 * 1024


class InventoryError(RuntimeError):
    pass


class AccountAlreadyExists(InventoryError):
    pass


class AccountCreationOutcomeUnknown(InventoryError):
    pass


def validate_email(value):
    value = value.strip().casefold() if isinstance(value, str) else ''
    if len(value) > 254 or not re.fullmatch(r'[^@\s]{1,64}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}', value):
        raise InventoryError('Supply one complete account email with --email.')
    return value


def validate_registration(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9 -]{5,20}', value) or value != value.strip():
        raise InventoryError('Supply one confirmed literal registration (5–20 letters, digits, spaces or hyphens).')
    return value


def email_argument(value):
    try:
        return validate_email(value)
    except InventoryError as error:
        raise argparse.ArgumentTypeError(str(error)) from None


def registration_argument(value):
    try:
        return validate_registration(value)
    except InventoryError as error:
        raise argparse.ArgumentTypeError(str(error)) from None


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class CloudReader:
    """A bounded read-only adapter; Firestore runQuery is a read using POST."""

    def __init__(self, token, opener=None, *, allow_account_creation=False):
        if not token or any(c.isspace() for c in token):
            raise InventoryError('Google Cloud OAuth token is missing or malformed.')
        self._token = token
        self._opener = opener or urllib.request.build_opener(NoRedirect())
        self._allow_account_creation = allow_account_creation

    def read(self, url, body=None, *, missing_ok=False):
        host = urllib.parse.urlsplit(url).netloc
        if not ((url.startswith(FIRESTORE + '/') and body is None) or url == FIRESTORE + ':runQuery'
                or url == IDENTITY + '/accounts:lookup') or host not in {
                    'firestore.googleapis.com', 'identitytoolkit.googleapis.com'}:
            raise InventoryError('Refusing an endpoint outside this account inventory.')
        return self._request(url, body, missing_ok=missing_ok)

    def _request(self, url, body=None, *, missing_ok=False, creating=False):
        request = urllib.request.Request(
            url, data=json.dumps(body).encode() if body is not None else None,
            headers={'Authorization': 'Bearer ' + self._token, 'Content-Type': 'application/json'},
            method='POST' if body is not None else 'GET')
        try:
            with self._opener.open(request, timeout=30) as response:
                payload = response.read(MAX_RESPONSE_BYTES + 1)
                if len(payload) > MAX_RESPONSE_BYTES:
                    raise InventoryError('Cloud response exceeded the inventory size limit.')
                return json.loads(payload)
        except urllib.error.HTTPError as error:
            if error.code == 404 and missing_ok:
                return None
            if creating and error.code in (400, 409):
                try:
                    detail = json.loads(error.read(4096))
                    if detail.get('error', {}).get('message') == 'EMAIL_EXISTS':
                        raise AccountAlreadyExists('The exact email already exists; reusing its account lookup.') from None
                except (ValueError, AttributeError):
                    pass
            # Provider error bodies can contain private account data. Do not echo.
            raise InventoryError(f'Cloud read failed (HTTP {error.code}); check the current Cloud Shell account and project access.') from None
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            raise InventoryError('Cloud read failed or returned invalid JSON; no changes were made.') from None

    def auth_email(self, email):
        return self._users(self.read(IDENTITY + '/accounts:lookup', {'email': [email]}))

    def auth_uid(self, uid):
        return self._users(self.read(IDENTITY + '/accounts:lookup', {'localId': [uid]}))

    @staticmethod
    def _users(value):
        users = value.get('users', []) if isinstance(value, dict) else None
        if not isinstance(users, list) or not all(isinstance(row, dict) for row in users):
            raise InventoryError('Firebase returned an unexpected account response.')
        return users

    def create_auth_account(self, email):
        if not self._allow_account_creation:
            raise InventoryError('Account creation requires the explicit --create-account-if-missing flag.')
        # Firebase Admin SDK uses this same accounts endpoint. No password,
        # verified phone/email, custom claim, provider or role is invented.
        response = self._request(IDENTITY + '/accounts', {'email': validate_email(email), 'emailVerified': False}, creating=True)
        uid = response.get('localId') if isinstance(response, dict) else None
        if not valid_identifier(uid):
            raise InventoryError('Firebase account creation returned no valid UID. Run read-only inventory before retrying.')
        return uid

    def document(self, collection, identifier):
        if not re.fullmatch(r'ops_[a-z_]+', collection) or not valid_identifier(identifier):
            raise InventoryError('Invalid inventory document identifier.')
        raw = self.read(FIRESTORE + '/' + collection + '/' + urllib.parse.quote(identifier, safe=''), missing_ok=True)
        return decode_document(raw) if raw else None

    def query(self, collection, field, value, fields, limit=21):
        if not re.fullmatch(r'ops_[a-z_]+', collection) or not re.fullmatch(r'[a-z_]+', field) or not 1 <= limit <= 100:
            raise InventoryError('Invalid inventory query.')
        rows = self.read(FIRESTORE + ':runQuery', {'structuredQuery': {
            'from': [{'collectionId': collection}],
            'select': {'fields': [{'fieldPath': key} for key in fields]},
            'where': {'fieldFilter': {'field': {'fieldPath': field}, 'op': 'EQUAL', 'value': {'stringValue': value}}},
            'limit': limit}})
        if not isinstance(rows, list):
            raise InventoryError('Firestore returned an unexpected inventory response.')
        return [decode_document(row['document']) for row in rows if isinstance(row, dict) and row.get('document')]


def valid_identifier(value):
    return isinstance(value, str) and 0 < len(value) <= 160 and '/' not in value and not any(ord(c) < 32 for c in value)


def decode_value(value):
    for field in ('stringValue', 'booleanValue', 'nullValue'):
        if field in value:
            return value[field]
    if 'integerValue' in value:
        return int(value['integerValue'])
    if 'doubleValue' in value:
        return float(value['doubleValue'])
    if 'timestampValue' in value:
        return value['timestampValue']
    if 'arrayValue' in value:
        return [decode_value(item) for item in value['arrayValue'].get('values', [])]
    if 'mapValue' in value:
        return {key: decode_value(item) for key, item in value['mapValue'].get('fields', {}).items()}
    return None


def decode_document(document):
    if not isinstance(document, dict) or not isinstance(document.get('name'), str) or not isinstance(document.get('fields', {}), dict):
        raise InventoryError('Firestore returned an unexpected document response.')
    return {**{key: decode_value(value) for key, value in document.get('fields', {}).items()},
            '_document_id': document['name'].rsplit('/', 1)[-1]}


def finite_epoch(value):
    return value if type(value) in (int, float) and math.isfinite(value) and value > 0 else None


def timestamp(value):
    epoch = finite_epoch(value)
    return dt.datetime.fromtimestamp(epoch, dt.timezone.utc).isoformat() if epoch and epoch < 253402300800 else None


def document_checks(reader, row, owner_id, now):
    identifiers = row.get('document_ids') or []
    if not isinstance(identifiers, list) or not 1 <= len(identifiers) <= 8 or not all(valid_identifier(item) for item in identifiers):
        return {'count': len(identifiers) if isinstance(identifiers, list) else 0, 'metadata_complete': False,
                'owner_matches': False, 'no_recorded_expiry_violation': False, 'expiry_metadata_missing_count': 0,
                'visual_review_required': True}
    documents = [reader.document('ops_business_documents', identifier) for identifier in identifiers]
    complete = all(documents)
    owned = complete and all(doc.get('owner_id') == owner_id for doc in documents)
    current = complete and all(not doc.get('expires_at') or (finite_epoch(doc['expires_at']) or 0) > now for doc in documents)
    return {'count': len(identifiers), 'metadata_complete': bool(complete), 'owner_matches': bool(owned),
            'no_recorded_expiry_violation': bool(current),
            'expiry_metadata_missing_count': sum(1 for doc in documents if doc and not doc.get('expires_at')),
            'visual_review_required': True}


def profile_summary(reader, row, uid, now):
    owner_matches = row.get('user_id', row.get('id', row['_document_id'])) == uid
    checks = document_checks(reader, row, uid, now) if owner_matches else None
    valid_until = finite_epoch(row.get('valid_until')) or 0
    return {'record_id': row['_document_id'], 'role': row.get('role'), 'status': row.get('status'),
            'version': row.get('version'), 'account_matches_target': owner_matches,
            'balasore': str(row.get('city', '')).strip().casefold() == 'balasore',
            'required_fields_present': {'name': bool(row.get('name')), 'address': bool(row.get('address')),
                                        'location': isinstance(row.get('location'), dict)},
            'review_valid_until': timestamp(valid_until), 'review_current': valid_until > now,
            'documents': checks}


VEHICLE_FIELDS = ['id', 'owner_id', 'driver_id', 'vehicle_kind', 'status', 'version', 'active',
                  'valid_until', 'registration', 'name', 'mode', 'seats', 'document_ids']


def inventory(reader, *, email, registration, now=None):
    email = validate_email(email)
    registration = validate_registration(registration)
    now = time.time() if now is None else now
    users = reader.auth_email(email)
    users = [user for user in users if str(user.get('email', '')).casefold() == email]
    contacts = reader.query('ops_account_contacts', 'email', email, ['email_verified'], limit=3)
    identities = {user.get('localId') for user in users} | {row['_document_id'] for row in contacts}
    identities.discard(None)
    if any(not valid_identifier(uid) for uid in identities):
        raise InventoryError('Account lookup returned an invalid UID; inspect this account through company administration.')
    plate_rows = reader.query('ops_mobility_vehicles', 'registration', registration, VEHICLE_FIELDS, limit=3)
    result = {'mode': 'inventory', 'project': PROJECT, 'target_email': email,
              'confirmed_registration': registration, 'mutations_performed': False,
              'identity': {'firebase_email_matches': len(users), 'app_email_matches': len(contacts),
                           'uids': sorted(identities), 'unique': len(identities) == 1,
                           'app_email_verified': any(row.get('email_verified') is True for row in contacts)},
              'profiles': [], 'bikes': [], 'plate_matches': [], 'blockers': [],
              'next_actions': {'rider_onboarding': '/worker?mode=cab_owner&tab=bikes',
                               'company_review': '/company-admin → Transport & scrap → Reviews',
                               'vehicle_onboarding': 'Bikes → Open fleet → Add vehicle → Bike',
                               'salary_setup': '/company-admin → Transport & scrap → Salaried rider team',
                               'launch_setup': '/company-admin → Transport & scrap → Launch & pricing policy'}}
    uid = next(iter(identities)) if len(identities) == 1 else None
    if not uid:
        result['blockers'].append('No unique existing account. Resolve the exact-email account before creating or approving any profile.')
    else:
        auth = next((user for user in users if user.get('localId') == uid), None)
        if auth is None:
            matches = reader.auth_uid(uid)
            auth = next((user for user in matches if user.get('localId') == uid), None)
        result['identity'].update(uid=uid, auth_account_exists=bool(auth),
                                  disabled=bool(auth and auth.get('disabled')),
                                  phone_linked=bool(auth and auth.get('phoneNumber')),
                                  firebase_email_matches_target=bool(auth and str(auth.get('email', '')).casefold() == email))
        if not auth or auth.get('disabled') or not auth.get('phoneNumber'):
            result['blockers'].append('The rider must sign in with their real verified mobile account before business registration; no phone or identity will be invented.')
        if not users and not any(row.get('email_verified') is True for row in contacts):
            result['blockers'].append('The target email is only an unverified app contact. Confirm account ownership before approving it.')
        rows = [reader.document('ops_business_partners', identifier) for identifier in (uid, uid + ':cab_owner', uid + ':driver')]
        profiles = {row['_document_id']: row for row in rows if row and row.get('role') in ('cab_owner', 'driver')}
        result['profiles'] = [profile_summary(reader, row, uid, now) for row in profiles.values()]
        if not profiles:
            result['blockers'].append('No rider/owner business profile exists. Complete the real owner-rider application and private supporting documents first.')
        elif not any(row['status'] == 'approved' and row['review_current'] and row['account_matches_target'] and
                     row['balasore'] and row['documents'] and row['documents']['metadata_complete'] and
                     row['documents']['owner_matches'] and row['documents']['no_recorded_expiry_violation'] for row in result['profiles']):
            result['blockers'].append('The business profile needs a current evidence-based company review or corrected documents/city.')
        vehicles = reader.query('ops_mobility_vehicles', 'owner_id', uid, VEHICLE_FIELDS)
        assigned = reader.query('ops_mobility_vehicles', 'driver_id', uid, VEHICLE_FIELDS)
        result['vehicle_lists_complete'] = len(vehicles) < 21 and len(assigned) < 21
        for row in {row['_document_id']: row for row in vehicles + assigned + plate_rows}.values():
            target_owned = row.get('owner_id') == uid
            target_assigned = row.get('driver_id') == uid
            matches_plate = row.get('registration') == registration
            summary = {'vehicle_id': row['_document_id'], 'registration_matches_requested': matches_plate,
                       'owner_matches_target': target_owned, 'assigned_to_target': target_assigned,
                       'vehicle_kind': row.get('vehicle_kind', 'car'), 'status': row.get('status'),
                       'version': row.get('version'), 'active': row.get('active') is True,
                       'one_passenger': row.get('seats') == 1, 'cab_mode': row.get('mode') in ('cab', 'both'),
                       'review_valid_until': timestamp(row.get('valid_until')),
                       'review_current': (finite_epoch(row.get('valid_until')) or 0) > now + 1800}
            if target_owned or target_assigned:
                summary['model'] = row.get('name')
                summary['documents'] = document_checks(reader, row, row.get('owner_id'), now)
                result['bikes'].append(summary)
            if matches_plate:
                result['plate_matches'].append({key: value for key, value in summary.items() if key not in ('documents', 'model')})
    if not uid:
        result['plate_matches'] = [{'vehicle_id': row['_document_id'], 'vehicle_kind': row.get('vehicle_kind', 'car'),
                                   'status': row.get('status'), 'version': row.get('version'),
                                   'registration_matches_requested': True, 'target_account_unresolved': True} for row in plate_rows]
    matching = [row for row in result['bikes'] if row['registration_matches_requested']]
    if not matching:
        result['blockers'].append('The confirmed bike is not registered to or assigned to this account. Supply its real model and private vehicle documents through Fleet; do not invent registration data or change another owner.')
    elif len(plate_rows) != 1:
        result['blockers'].append('The confirmed registration is not unique. Resolve duplicate vehicle records before approval.')
    elif not any(row['vehicle_kind'] == 'bike' and row['status'] == 'approved' and row['active'] and row['one_passenger'] and
                 row['cab_mode'] and row['review_current'] and row['documents']['metadata_complete'] and
                 row['documents']['owner_matches'] and row['documents']['no_recorded_expiry_violation'] for row in matching):
        result['blockers'].append('The bike requires valid owned documents, one passenger, active cab mode and a current company vehicle review.')
    result['operational_note'] = ('This checks account and registration only. One real approved rider can start; the salaried team is capped at three at ₹7,000/month each. '
                                  'Real salary funding, reviewed geography/tax/cash/terms, routing, dispatch and fresh rider GPS remain separate launch checks. '
                                  'No account, role, profile, vehicle, approval or funding was changed. Document metadata does not replace a human licence/vehicle-evidence review.')
    return result


def create_account_if_missing(reader, *, email, registration, now=None):
    """Idempotent auth-account creation, following a successful full inventory.

    A contact-only UID is never duplicated or altered; a disabled existing auth
    account is never reenabled. Actual business and vehicle approval stay in the
    authenticated company workflow with real documents and review expiry.
    """
    before = inventory(reader, email=email, registration=registration, now=now)
    identity = before['identity']
    if identity['uids']:
        if not identity['unique'] or not identity.get('auth_account_exists'):
            raise InventoryError('Existing app/contact identities require resolution. Refusing to create a duplicate or change account ownership.')
        before['mode'] = 'create-account-if-missing'
        before['account_creation'] = {'status': 'existing_account_reused', 'uid': identity['uid'], 'changed': False}
        return before
    try:
        uid = reader.create_auth_account(email)
    except AccountAlreadyExists:
        reused = inventory(reader, email=email, registration=registration, now=now)
        if not reused['identity'].get('unique') or not reused['identity'].get('firebase_email_matches_target'):
            raise InventoryError('The email was created concurrently but its unique target UID could not be established. Run inventory; no account was overwritten.') from None
        reused['mode'] = 'create-account-if-missing'
        reused['account_creation'] = {'status': 'existing_account_reused', 'uid': reused['identity']['uid'], 'changed': False}
        return reused
    except InventoryError:
        # A timeout or malformed provider response can follow a successful
        # remote write. Never describe that as a confirmed no-change result.
        raise AccountCreationOutcomeUnknown('The account-creation outcome could not be confirmed. Run read-only inventory before retrying; no business or vehicle approval was attempted.') from None
    try:
        result = inventory(reader, email=email, registration=registration, now=now)
    except InventoryError:
        # Creation can succeed even if the follow-up read fails. Make this exact
        # outcome visible so an operator does not repeat blind mutations.
        result = {'mode': 'create-account-if-missing', 'project': PROJECT,
                  'target_email': email, 'confirmed_registration': registration,
                  'followup_inventory': 'unavailable; run inventory before further actions',
                  'blockers': ['Verified-mobile onboarding, real profile and bike documents, and company reviews remain pending.']}
    result.update(mode='create-account-if-missing', mutations_performed=True,
                  account_creation={'status': 'created_unverified_auth_account', 'uid': uid, 'changed': True,
                                    'profile_approved': False, 'vehicle_approved': False})
    result['operational_note'] = ('Only the exact email auth account was created. Email is unverified; no password, phone, name, role, claims, '
                                  'business profile, vehicle, document, funding or approval was invented. The rider must complete real verified-mobile '
                                  'onboarding and company document review before any production ride. No verification email or payment was sent.')
    return result


def oauth_token():
    try:
        result = subprocess.run(['gcloud', 'auth', 'print-access-token'], stdin=subprocess.DEVNULL,
                                capture_output=True, text=True, check=True, timeout=45)
    except (subprocess.SubprocessError, OSError):
        raise InventoryError('Cannot obtain the existing Cloud Shell OAuth session. Sign in to your project account; do not paste tokens into chat.') from None
    return result.stdout.strip()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--email', required=True, type=email_argument, help='Exact account email for this single invocation; no saved default.')
    parser.add_argument('--registration', required=True, type=registration_argument, help='Confirmed literal registration; letters and zeros are never substituted.')
    parser.add_argument('--mode', choices=('inventory', 'plan'), default='inventory', help='Both modes are read-only; plan adds the same actionable missing-input checks.')
    parser.add_argument('--create-account-if-missing', action='store_true',
                        help='Explicitly create only the exact unverified email auth account if no Firebase/app-contact UID exists. No business/vehicle approval.')
    args = parser.parse_args(argv)
    if args.create_account_if_missing and args.mode == 'plan':
        parser.error('--mode plan is read-only; do not combine it with account creation')
    try:
        reader = CloudReader(oauth_token(), allow_account_creation=args.create_account_if_missing)
        result = create_account_if_missing(reader, email=args.email, registration=args.registration) if args.create_account_if_missing else inventory(reader, email=args.email, registration=args.registration)
        if not args.create_account_if_missing:
            result['mode'] = args.mode
        print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))
        return 0
    except AccountCreationOutcomeUnknown as error:
        print(json.dumps({'status': 'account_creation_outcome_unknown', 'reason': str(error),
                          'mutations_performed': None, 'next_action': 'Run --mode inventory before retrying.'}), file=sys.stderr)
        return 1
    except InventoryError as error:
        print(json.dumps({'status': 'inventory_failed', 'reason': str(error), 'mutations_performed': False}), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
