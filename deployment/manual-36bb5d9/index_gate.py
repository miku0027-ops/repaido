"""Add only reviewed Firestore composite indexes and require fresh READY state.

Standalone release support; all credentials stay in memory. No DELETE, PATCH,
rules publication, database creation, application data, or IAM writes exist.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


class GateError(RuntimeError):
    pass


class AlreadyExists(GateError):
    pass


def normalized_spec(spec):
    if not isinstance(spec, dict):
        raise GateError('Index definition must be an object.')
    group = spec.get('collectionGroup')
    if not isinstance(group, str) or not group or '/' in group:
        raise GateError('Index has an invalid collection group.')
    scope = spec.get('queryScope')
    if scope not in ('COLLECTION', 'COLLECTION_GROUP'):
        raise GateError('Index has an unsupported query scope.')
    fields = spec.get('fields')
    if not isinstance(fields, list) or len(fields) < 2:
        raise GateError('A composite index must have at least two fields.')
    normalized = []
    for field in fields:
        if not isinstance(field, dict) or set(field) != {'fieldPath', 'order'}:
            raise GateError('Only reviewed ordered index fields are supported.')
        if not isinstance(field['fieldPath'], str) or not field['fieldPath']:
            raise GateError('Index has an invalid field path.')
        if field['order'] not in ('ASCENDING', 'DESCENDING'):
            raise GateError('Index has an invalid field order.')
        normalized.append((field['fieldPath'], field['order']))
    names = [name for name, _ in normalized]
    if len(set(names)) != len(names) or ('__name__' in names and names[-1] != '__name__'):
        raise GateError('Index fields repeat or have an invalid document-ID position.')
    # Firestore appends document ID in the last ordered field's direction.
    if names[-1] != '__name__':
        normalized.append(('__name__', normalized[-1][1]))
    return (group, scope, tuple(normalized))


def canonical_definition(key):
    group, scope, fields = key
    return {'collectionGroup': group, 'queryScope': scope,
            'fields': [{'fieldPath': name, 'order': order} for name, order in fields]}


def unrelated_special_index(spec):
    """Recognize valid array/vector definitions, which cannot match our ordered ones."""
    fields = spec.get('fields')
    if not isinstance(fields, list) or not any(isinstance(field, dict) and
            ('arrayConfig' in field or 'vectorConfig' in field) for field in fields):
        return False
    if len(fields) < 2 or spec.get('queryScope') not in ('COLLECTION', 'COLLECTION_GROUP'):
        raise GateError('Unrelated Firestore index metadata is malformed.')
    names = []
    for field in fields:
        if not isinstance(field, dict) or not isinstance(field.get('fieldPath'), str) or not field['fieldPath']:
            raise GateError('Unrelated Firestore index has an invalid field.')
        names.append(field['fieldPath'])
        modes = set(field) - {'fieldPath'}
        if modes == {'order'} and field['order'] in ('ASCENDING', 'DESCENDING'):
            continue
        if modes == {'arrayConfig'} and field['arrayConfig'] == 'CONTAINS':
            continue
        vector = field.get('vectorConfig')
        if modes == {'vectorConfig'} and isinstance(vector, dict) and set(vector) == {'dimension', 'flat'} and type(vector['dimension']) is int and vector['dimension'] > 0 and vector['flat'] == {}:
            continue
        raise GateError('Unrelated Firestore index has invalid ordering/vector metadata.')
    if len(set(names)) != len(names):
        raise GateError('Unrelated Firestore index repeats a field.')
    return True


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise GateError('Firestore redirects are refused.')


def access_token():
    try:
        result = subprocess.run(['gcloud', 'auth', 'print-access-token'],
                                capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        raise GateError('Cloud Build access-token acquisition failed or timed out.') from None
    token = result.stdout.strip()
    if result.returncode or not token or any(c.isspace() for c in token):
        raise GateError('Cloud Build could not acquire an access token; refresh authorization.')
    return token


class FirestoreAPI:
    def __init__(self, project='repaido', database='(default)', token_provider=access_token,
                 opener=None, timeout=20):
        if not re.fullmatch(r'[a-z][a-z0-9-]{4,61}[a-z0-9]', project):
            raise GateError('Invalid project ID.')
        if not database or '/' in database:
            raise GateError('Invalid database ID.')
        self.project, self.database = project, database
        self.token_provider = token_provider
        self.opener = opener or urllib.request.build_opener(NoRedirect()).open
        self.timeout = timeout
        self.prefix = '/v1/projects/' + project + '/databases/' + urllib.parse.quote(database, safe='()')

    def request(self, method, path, payload=None):
        if method not in ('GET', 'POST') or not path.startswith(self.prefix + '/collectionGroups/'):
            raise GateError('Unapproved Firestore operation or resource.')
        token = self.token_provider()
        body = None if payload is None else json.dumps(payload, separators=(',', ':')).encode()
        request = urllib.request.Request('https://firestore.googleapis.com' + path,
            data=body, method=method,
            headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
        try:
            with self.opener(request, timeout=self.timeout) as response:
                raw = response.read(4 * 1024 * 1024 + 1)
                if len(raw) > 4 * 1024 * 1024:
                    raise GateError('Firestore response exceeds the bounded size.')
        except urllib.error.HTTPError as error:
            # Provider bodies and request objects may contain credentials. Do not log them.
            error.close()
            if error.code == 409:
                raise AlreadyExists('Index already exists; fresh metadata verification required.') from None
            raise GateError('Firestore request failed (HTTP %d).' % error.code) from None
        except (urllib.error.URLError, OSError):
            raise GateError('Firestore metadata request failed; no credential details logged.') from None
        try:
            result = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            raise GateError('Firestore returned invalid JSON.') from None
        if not isinstance(result, dict):
            raise GateError('Firestore returned an invalid response object.')
        return result

    def list_indexes(self, collection):
        path = self.prefix + '/collectionGroups/' + urllib.parse.quote(collection, safe='') + '/indexes'
        rows, seen = [], set()
        token = ''
        for _ in range(100):
            # Firestore Admin currently accepts only the default page size (0).
            query = ('?pageToken=' + urllib.parse.quote(token, safe='')) if token else ''
            result = self.request('GET', path + query)
            batch = result.get('indexes', [])
            if not isinstance(batch, list) or any(not isinstance(row, dict) for row in batch):
                raise GateError('Firestore index listing is malformed.')
            rows.extend(batch)
            token = result.get('nextPageToken', '')
            if not token:
                return rows
            if not isinstance(token, str) or token in seen:
                raise GateError('Firestore index pagination is invalid.')
            seen.add(token)
        raise GateError('Firestore index listing exceeded the page limit.')

    def create_index(self, spec):
        key = normalized_spec(spec)
        definition = canonical_definition(key)
        collection = definition.pop('collectionGroup')
        path = self.prefix + '/collectionGroups/' + urllib.parse.quote(collection, safe='') + '/indexes'
        return self.request('POST', path, definition)


def ensure_indexes(api, desired, *, timeout=1200, poll_seconds=10,
                   clock=time.monotonic, sleep=time.sleep, check_only=False,
                   approved_missing=None):
    if not 0 < timeout <= 1800 or not 0 < poll_seconds <= 30:
        raise GateError('Use a timeout up to 1800 seconds and polling up to 30 seconds.')
    keys = [normalized_spec(spec) for spec in desired]
    if not keys or len(set(keys)) != len(keys):
        raise GateError('Desired indexes must be nonempty and unique.')
    allowed = set(approved_missing or ())
    if not allowed <= set(keys):
        raise GateError('Creation approval includes an index outside the desired file.')
    attempted = set()
    groups = sorted({key[0] for key in keys})
    deadline = clock() + timeout
    first = True
    while True:
        if not first and clock() >= deadline:
            raise GateError('Timed out waiting for exact Firestore indexes to become READY.')
        first = False
        found = {}
        for group in groups:
            rows = api.list_indexes(group)
            if not isinstance(rows, list):
                raise GateError('Firestore index listing is malformed.')
            prefix = f'projects/{api.project}/databases/{api.database}/collectionGroups/{group}/indexes/'
            for row in rows:
                if not isinstance(row, dict):
                    raise GateError('Firestore index record is malformed.')
                name = row.get('name', '')
                if not isinstance(name, str) or not name.startswith(prefix) or not name[len(prefix):] or '/' in name[len(prefix):]:
                    raise GateError('Firestore returned an index outside the requested collection/database.')
                if row.get('collectionGroup', group) != group:
                    raise GateError('Firestore index collection metadata does not match its resource.')
                if unrelated_special_index(row):
                    continue
                key = normalized_spec({**row, 'collectionGroup': group})
                if key not in keys:
                    continue
                state = row.get('state')
                if state not in ('READY', 'CREATING', 'NEEDS_REPAIR'):
                    raise GateError('Firestore returned an unknown index state.')
                found.setdefault(key, []).append({'name': name, 'state': state})
        missing = [key for key in keys if key not in found]
        if clock() >= deadline:
            raise GateError('Timed out during fresh Firestore index metadata verification.')
        # Check every desired definition before any write; missing baseline data
        # is a separate infrastructure problem, not permission to recreate it.
        if missing and (check_only or any(key not in allowed for key in missing)):
            raise GateError('A required index is missing; it is not approved for creation in this release.')
        ready = {}
        for key, rows in found.items():
            matching = next((row for row in rows if row['state'] == 'READY'), None)
            if matching:
                ready[key] = matching
            elif any(row['state'] == 'NEEDS_REPAIR' for row in rows):
                raise GateError('A required Firestore index NEEDS_REPAIR; no destructive repair is attempted.')
        if len(ready) == len(keys):
            return {'project': api.project, 'database': api.database,
                    'verified_at_utc': datetime.now(timezone.utc).isoformat(),
                    'check_only': check_only, 'created_or_raced': len(attempted),
                    'indexes': [{'definition': canonical_definition(key), **ready[key]} for key in keys]}
        if check_only:
            raise GateError('Every required Firestore index must be READY in a fresh read.')
        for key in missing:
            if key in attempted:
                continue
            if clock() >= deadline:
                raise GateError('Timed out before creating reviewed Firestore indexes.')
            attempted.add(key)
            try:
                api.create_index(canonical_definition(key))
            except AlreadyExists:
                pass  # A concurrent creator is safe only after an exact fresh read.
        remaining = deadline - clock()
        if remaining <= 0:
            raise GateError('Timed out waiting for exact Firestore indexes to become READY.')
        sleep(min(poll_seconds, remaining))


def reviewed_documents(index_file, baseline_file, expected_index_hash, expected_baseline_hash):
    values = []
    for path, expected in ((index_file, expected_index_hash), (baseline_file, expected_baseline_hash)):
        raw = Path(path).read_bytes()
        if hashlib.sha256(raw).hexdigest() != expected:
            raise GateError('An index source file differs from the reviewed hash.')
        document = json.loads(raw)
        if set(document) != {'indexes', 'fieldOverrides'} or document['fieldOverrides']:
            raise GateError('This release supports only composite indexes and no field overrides.')
        if not isinstance(document['indexes'], list):
            raise GateError('Reviewed index source is malformed.')
        keys = [normalized_spec(spec) for spec in document['indexes']]
        if len(set(keys)) != len(keys):
            raise GateError('Reviewed index source contains duplicate definitions.')
        values.append((document['indexes'], set(keys)))
    desired, baseline = values
    if not baseline[1] <= desired[1]:
        raise GateError('Index removals/changes are outside this additive release.')
    return desired[0], desired[1] - baseline[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--approved', required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--expected-commit', required=True)
    parser.add_argument('--baseline', required=True)
    parser.add_argument('--project', default='repaido')
    parser.add_argument('--database', default='(default)')
    parser.add_argument('--indexes', default='firestore.indexes.json')
    parser.add_argument('--baseline-indexes', default='release_support/baseline-firestore.indexes.json')
    parser.add_argument('--indexes-sha256', required=True)
    parser.add_argument('--baseline-sha256', required=True)
    parser.add_argument('--receipt', required=True)
    parser.add_argument('--check-only', action='store_true')
    parser.add_argument('--timeout', type=float, default=1200)
    parser.add_argument('--poll-seconds', type=float, default=10)
    args = parser.parse_args()
    try:
        if args.approved != 'true' or args.commit != args.expected_commit or not re.fullmatch(r'[0-9a-f]{40}', args.commit):
            raise GateError('Explicit approval and the exact reviewed commit are required.')
        if not re.fullmatch(r'[0-9a-f]{40}', args.baseline):
            raise GateError('The actual deployed baseline must be a full commit SHA.')
        if args.project != 'repaido' or args.database != '(default)':
            raise GateError('This reviewed release targets repaido/(default) only.')
        desired, allowed = reviewed_documents(args.indexes, args.baseline_indexes,
                                              args.indexes_sha256, args.baseline_sha256)
        receipt = ensure_indexes(FirestoreAPI(args.project, args.database), desired,
            timeout=args.timeout, poll_seconds=args.poll_seconds,
            check_only=args.check_only, approved_missing=allowed)
        receipt.update(commit=args.commit, deployed_baseline=args.baseline,
                       indexes_sha256=args.indexes_sha256,
                       approved_additions=[canonical_definition(key) for key in sorted(allowed)])
        target = Path(args.receipt)
        temporary = target.with_name(target.name + '.tmp')
        with temporary.open('w') as output:
            os.chmod(temporary, 0o600)
            json.dump(receipt, output, indent=2)
            output.write('\n')
        os.replace(temporary, target)
        print(json.dumps(receipt, sort_keys=True))
    except (GateError, OSError, ValueError, TypeError) as error:
        print('Index release gate failed: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
