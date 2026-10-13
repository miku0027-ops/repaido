"""One explicitly requested console release, using an operator's Cloud Shell login.

No ADC file, private key or password is required. Default mode is an offline plan.
This never invokes the customer app release pipeline or creates a build trigger.
"""
import argparse
import hashlib
import io
import json
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

PROJECT = 'repaido'
REGION = 'us-central1'
SERVICE = 'repaido-engineering'
RUNTIME = f'{SERVICE}@{PROJECT}.iam.gserviceaccount.com'
BUILDER = f'firebase-adminsdk-fbsvc@{PROJECT}.iam.gserviceaccount.com'
REPOSITORY = f'{REGION}-docker.pkg.dev/{PROJECT}/cloud-run-source-deploy'
IMAGE = f'{REPOSITORY}/{SERVICE}'
ROLE_ID = 'repaidoEngineeringViewer'
PERMISSIONS = sorted([
    'cloudasset.assets.listResource', 'monitoring.timeSeries.list',
    'logging.logEntries.list', 'cloudtrace.traces.list', 'cloudtrace.traces.get',
    'firebaseauth.users.get', 'serviceusage.services.use',
])
APIS = ['run', 'cloudbuild', 'artifactregistry', 'iam', 'cloudasset',
        'monitoring', 'logging', 'cloudtrace', 'identitytoolkit']
REQUIRED_SOURCE = {
    'engineering/Dockerfile', 'engineering/Dockerfile.dockerignore',
    'engineering/cloudbuild.yaml', 'engineering/upload.ignore',
    'engineering/release.py', 'engineering/server/app.py',
    'engineering/web/package.json', 'engineering/web/pnpm-lock.yaml',
    'engineering/requirements.txt', 'backend/main.py', 'web/src/firebase.ts',
    'firebase.json', 'firestore.rules', 'cloudbuild.yaml',
}
ROOT = Path(__file__).resolve().parents[1]


class ReleaseError(Exception):
    pass


def command(args, *, cwd=ROOT):
    result = subprocess.run(args, cwd=cwd, text=True, capture_output=True)
    if result.returncode:
        # Commands never carry tokens or secret values. OAuth stdout is never
        # included in exceptions, logs, files or shell command arguments.
        raise ReleaseError(result.stderr.strip() or f'{args[0]} failed.')
    return result.stdout.strip()


def gcloud(*args, cwd=ROOT):
    output = command(['gcloud', *args, '--quiet', '--format=json'], cwd=cwd)
    return json.loads(output) if output else None


def google_request(path, *, body=None, method=None):
    token = command(['gcloud', 'auth', 'print-access-token'])
    request = urllib.request.Request('https://identitytoolkit.googleapis.com/' + path,
        data=json.dumps(body).encode() if body is not None else None,
        method=method, headers={'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json', 'X-Goog-User-Project': PROJECT})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise ReleaseError(f'Firebase operator request returned HTTP {error.code}. '
            'Check the Cloud Shell account has Firebase Authentication administration access.') from None


def resolve_engineers(emails):
    accounts = []
    for email in dict.fromkeys(address.lower() for address in emails):
        response = google_request(f'v1/projects/{PROJECT}/accounts:lookup', body={'email': [email]})
        matches = [user for user in response.get('users', [])
                   if user.get('email', '').lower() == email]
        if len(matches) != 1 or matches[0].get('disabled'):
            raise ReleaseError(f'{email}: one active existing Repaido account is required. '
                'No account was created and no access was granted.')
        uid = matches[0].get('localId', '')
        if not re.fullmatch(r'[A-Za-z0-9_:\-]{1,128}', uid):
            raise ReleaseError('The account UID cannot be safely encoded for release verification.')
        accounts.append(matches[0])
    return accounts


def grant_engineers(accounts):
    for user in accounts:
        # Re-read immediately before changing claims, preserving other roles.
        current = google_request(f'v1/projects/{PROJECT}/accounts:lookup',
            body={'localId': [user['localId']]})['users'][0]
        if current.get('disabled') or current.get('email', '').lower() != user['email'].lower():
            raise ReleaseError('Account identity changed during release. Access was not granted.')
        claims = json.loads(current.get('customAttributes') or '{}')
        if claims.get('engineer') is True:
            continue
        claims['engineer'] = True
        encoded = json.dumps(claims, separators=(',', ':'))
        if len(encoded.encode()) > 1000:
            raise ReleaseError('Existing custom claims leave insufficient room for the engineering role.')
        google_request(f'v1/projects/{PROJECT}/accounts:update', body={
            'localId': user['localId'], 'customAttributes': encoded,
            'validSince': str(int(time.time())),
        })
    print('Engineer claims configured for the requested existing accounts. Sign in again after release.', flush=True)


def authorize_domain(url):
    domain = urllib.parse.urlsplit(url).hostname
    if not domain or not domain.endswith('.run.app'):
        raise ReleaseError('The console did not return a valid Cloud Run HTTPS origin.')
    path = f'v2/projects/{PROJECT}/config'
    config = google_request(path)
    domains = config.get('authorizedDomains', [])
    if domain not in domains:
        google_request(path + '?updateMask=authorizedDomains', method='PATCH',
            body={'name': f'projects/{PROJECT}/config', 'authorizedDomains': [*domains, domain]})
    verified = google_request(path).get('authorizedDomains', [])
    if domain not in verified or not set(domains).issubset(verified):
        raise ReleaseError('Firebase authorised-domain verification failed.')


def included_source(path):
    file = Path(path)
    if any(part.startswith('.env') or part in {'.git', '.venv', 'node_modules',
            '__pycache__', 'dist', 'build', 'generated', 'test-results', '.terraform',
            '.pytest_cache'} for part in file.parts):
        return False
    if re.search(r'(?i)(firebase-adminsdk|service.account|keystore|\.jks$|\.pem$|\.key$|'
                 r'\.tfstate|\.tfvars|google-services\.json|local\.properties|\.db($|[.-]))', path):
        return False
    return (path in REQUIRED_SOURCE or path.startswith('engineering/') or
        (file.parent == Path('backend') and file.suffix == '.py') or
        path.startswith('web/src/') or
        (path.startswith('android/app/src/') and file.suffix in {'.kt', '.java', '.xml'}) or
        (path.startswith('infra/') and file.suffix == '.tf'))


def stage_source(commit, target):
    entries = subprocess.check_output(['git', 'ls-tree', '-rz', commit], cwd=ROOT).split(b'\0')
    selected = []
    for entry in entries:
        if not entry:
            continue
        metadata, raw = entry.split(b'\t', 1)
        name = raw.decode()
        if not included_source(name):
            continue
        if metadata.split()[0] not in {b'100644', b'100755'}:
            raise ReleaseError('Release source must not contain symlinks or submodules: ' + name)
        selected.append(name)
    missing = REQUIRED_SOURCE - set(selected)
    if missing or not any(name.startswith('infra/') for name in selected):
        raise ReleaseError('Required release source is missing: ' + ', '.join(sorted(missing)))
    data = subprocess.check_output(['git', 'archive', '--format=tar', commit, '--', *selected], cwd=ROOT)
    manifest = {}
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        for entry in archive:
            if entry.isdir():
                continue
            if not entry.isfile() or entry.name not in selected:
                raise ReleaseError('Unexpected archive member: ' + entry.name)
            destination = target / entry.name
            destination.parent.mkdir(parents=True, exist_ok=True)
            content = archive.extractfile(entry).read()
            destination.write_bytes(content)
            manifest[entry.name] = hashlib.sha256(content).hexdigest()
    if set(manifest) != set(selected):
        raise ReleaseError('The staged source is incomplete.')
    (target / 'engineering/release-source.json').write_text(json.dumps({
        'commit': commit, 'files': manifest}, indent=2) + '\n')
    print(f'Staged {len(manifest)} reviewed source files; credentials and local outputs excluded.', flush=True)


def check_build(commit, approved, root=ROOT):
    if approved != 'true' or not re.fullmatch(r'[a-f0-9]{40}', commit or ''):
        raise ReleaseError('An explicitly approved, immutable source revision is required.')
    manifest = json.loads((root / 'engineering/release-source.json').read_text())
    if manifest['commit'] != commit or not REQUIRED_SOURCE.issubset(manifest['files']):
        raise ReleaseError('Build input does not match the reviewed release.')
    for path, digest in manifest['files'].items():
        if not included_source(path) or Path(path).is_absolute() or '..' in Path(path).parts:
            raise ReleaseError('Unexpected file in the release manifest.')
        if hashlib.sha256((root / path).read_bytes()).hexdigest() != digest:
            raise ReleaseError('Build input changed or was filtered out: ' + path)


def bootstrap():
    print('Configuring the dedicated read-only runtime identity.', flush=True)
    gcloud('services', 'enable', *[api + '.googleapis.com' for api in APIS], f'--project={PROJECT}')
    accounts = gcloud('iam', 'service-accounts', 'list', f'--project={PROJECT}', f'--filter=email={RUNTIME}')
    if not accounts:
        gcloud('iam', 'service-accounts', 'create', SERVICE, f'--project={PROJECT}',
            '--display-name=Repaido Engineering read-only runtime')
    elif accounts[0].get('disabled'):
        raise ReleaseError('The dedicated runtime identity is disabled; deployment stopped.')
    role_name = f'projects/{PROJECT}/roles/{ROLE_ID}'
    roles = gcloud('iam', 'roles', 'list', f'--project={PROJECT}', f'--filter=name={role_name}')
    if roles:
        role = gcloud('iam', 'roles', 'describe', ROLE_ID, f'--project={PROJECT}')
        if sorted(role.get('includedPermissions', [])) != PERMISSIONS or role.get('deleted'):
            raise ReleaseError('The existing engineering role differs from the reviewed read-only permissions.')
    else:
        gcloud('iam', 'roles', 'create', ROLE_ID, f'--project={PROJECT}',
            '--title=Repaido Engineering observations', '--stage=GA',
            '--permissions=' + ','.join(PERMISSIONS))
    gcloud('projects', 'add-iam-policy-binding', PROJECT, f'--member=serviceAccount:{RUNTIME}',
        f'--role={role_name}', '--condition=None')
    # The build account only builds/pushes. The authenticated operator deploys;
    # no extra project-wide roles or token-creation rights are granted to it.


def build_image(commit, source):
    print('Submitting one console-only Cloud Build.', flush=True)
    build = gcloud('builds', 'submit', '.', f'--project={PROJECT}', f'--region={REGION}',
        '--config=engineering/cloudbuild.yaml', '--ignore-file=engineering/upload.ignore',
        f'--service-account=projects/{PROJECT}/serviceAccounts/{BUILDER}',
        f'--substitutions=_RELEASE_APPROVED=true,COMMIT_SHA={commit}', '--async', cwd=source)
    build_id = build['id']
    print(f'Build: https://console.cloud.google.com/cloud-build/builds;region={REGION}/{build_id}?project={PROJECT}', flush=True)
    deadline = time.monotonic() + 1500
    last_status = None
    while time.monotonic() < deadline:
        status = gcloud('builds', 'describe', build_id, f'--project={PROJECT}', f'--region={REGION}')
        state = status.get('status')
        if state != last_status:
            print('Build status: ' + str(state), flush=True)
            last_status = state
        if state == 'SUCCESS':
            digest = next((image['digest'] for image in status.get('results', {}).get('images', [])
                           if image['name'] == IMAGE + ':' + build_id), '')
            if not re.fullmatch(r'sha256:[a-f0-9]{64}', digest):
                raise ReleaseError('The successful build did not return the expected image digest.')
            return build_id, IMAGE + '@' + digest
        if state not in {'QUEUED', 'WORKING', 'PENDING'}:
            # Include useful failures without issuing another paid build.
            logs = gcloud('logging', 'read', f'resource.type="build" AND resource.labels.build_id="{build_id}"',
                f'--project={PROJECT}', '--order=desc', '--limit=60')
            for row in reversed(logs or []):
                if row.get('textPayload'):
                    print(row['textPayload'])
            raise ReleaseError(f'Console build {build_id} ended with {state}. No deployment was attempted.')
        time.sleep(5)
    raise ReleaseError('Build status is still pending. Check the existing build before trying another release.')


def public_read(url, *, headers=None):
    request = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            return response.status, response.read(), response.headers
    except urllib.error.HTTPError as error:
        return error.code, error.read(), error.headers


def verify_release(url, commit, build_id, read=public_read):
    status, raw, headers = read(url + '/health')
    if status != 200:
        raise ReleaseError('Console health is unavailable.')
    health = json.loads(raw)
    if health.get('source_revision') != commit or health.get('build_id') != build_id:
        raise ReleaseError('The console is not serving the requested release.')
    checks = health.get('release_checks') or {}
    if checks.get('engineer_accounts') is not True:
        raise ReleaseError('The runtime could not verify the requested engineer accounts.')
    states = checks.get('collectors', {})
    if set(states) != {'inventory', 'metrics', 'events', 'traces'} or any(v != 'connected' for v in states.values()):
        raise ReleaseError('Live cloud checks are incomplete: ' + json.dumps(states))
    if headers.get('X-Frame-Options') != 'DENY':
        raise ReleaseError('Console security headers are missing.')
    status, raw, _ = read(url + '/engineering-api/config')
    config = json.loads(raw)
    if status != 200 or config.get('local_preview') or config.get('firebase', {}).get('projectId') != PROJECT:
        raise ReleaseError('Firebase configuration or production preview protection failed.')
    if not all(config.get('firebase', {}).get(key) for key in ('apiKey', 'authDomain', 'appId')):
        raise ReleaseError('The public sign-in configuration is incomplete.')
    for path in ('blueprint', 'snapshot', 'source?node=module:main', 'stream'):
        for auth_headers in ({}, {'Authorization': 'Bearer invalid-release-test-token'}):
            if read(url + '/engineering-api/' + path, headers=auth_headers)[0] != 401:
                raise ReleaseError('An engineering endpoint did not reject an unauthenticated request.')
    status, page, _ = read(url + '/')
    if status != 200 or b'<script' not in page:
        raise ReleaseError('The built sign-in screen is unavailable.')


def deploy(commit, image, build_id, accounts, temp):
    services = gcloud('run', 'services', 'list', f'--project={PROJECT}', f'--region={REGION}')
    previous = next((service for service in services if service.get('metadata', {}).get('name') == SERVICE), None)
    if previous:
        template = previous.get('spec', {}).get('template', {}).get('spec', {})
        if template.get('serviceAccountName') != RUNTIME:
            raise ReleaseError('A service with this name uses a different identity; deployment stopped.')
    runtime = temp / 'runtime.json'
    runtime.write_text(json.dumps({'ENGINEERING_PROJECT': PROJECT,
        'ENGINEERING_CLOUD_ENABLED': 'true', 'ENGINEERING_BUILD_ID': build_id,
        'ENGINEERING_RELEASE_CHECK_UIDS': ','.join(user['localId'] for user in accounts)}))
    tag = 'r-' + commit[:12]
    print('Deploying the dedicated console service with bounded capacity.', flush=True)
    service = gcloud('run', 'deploy', SERVICE, f'--project={PROJECT}', f'--region={REGION}',
        '--image=' + image, '--service-account=' + RUNTIME, '--env-vars-file=' + str(runtime),
        '--min-instances=0', '--max-instances=1', '--concurrency=40', '--cpu=1',
        '--memory=512Mi', '--cpu-throttling', '--timeout=180', '--allow-unauthenticated',
        '--ingress=all', '--port=8080', '--tag=' + tag,
        '--labels=app=repaido-engineering', *(['--no-traffic'] if previous else []))
    base = service['status']['url']
    traffic = next(item for item in service['status']['traffic'] if item.get('tag') == tag)
    verify_release(traffic['url'], commit, build_id)
    authorize_domain(base)
    gcloud('run', 'services', 'update-traffic', SERVICE, f'--project={PROJECT}', f'--region={REGION}',
        '--to-revisions=' + traffic['revisionName'] + '=100', '--clear-tags')
    verify_release(base, commit, build_id)
    print('\nConsole released and verified: ' + base, flush=True)
    print('Use either authorised Repaido account to sign in again. Existing sessions were revoked only when their role changed.', flush=True)
    print('Live read checks passed. Complete one interactive Google/phone sign-in to verify the browser authentication flow.', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', metavar='FULL_COMMIT_SHA')
    parser.add_argument('--engineer-email', action='append', default=[])
    parser.add_argument('--check-build', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--commit', help=argparse.SUPPRESS)
    parser.add_argument('--approved', default='false', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.check_build:
        check_build(args.commit, args.approved)
        return
    if not args.release:
        print(json.dumps({'mode': 'offline plan', 'service': SERVICE, 'project': PROJECT,
            'region': REGION, 'runtime_identity': RUNTIME, 'permissions': PERMISSIONS,
            'idle_instances': 0, 'max_instances_per_revision': 1,
            'engineer_emails': args.engineer_email, 'builds': 1,
            'customer_deployment': False, 'creates_accounts': False}, indent=2))
        return
    if not re.fullmatch(r'[a-f0-9]{40}', args.release):
        parser.error('--release requires a full immutable commit SHA.')
    if not 1 <= len(args.engineer_email) <= 10 or any(not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', e) for e in args.engineer_email):
        parser.error('Provide the explicitly authorised existing accounts with --engineer-email.')
    if command(['git', 'rev-parse', 'HEAD']) != args.release or command(['git', 'status', '--porcelain']):
        raise ReleaseError('Use a clean checkout of the exact reviewed release commit.')
    if not shutil.which('gcloud'):
        raise ReleaseError('Run this release from authenticated Google Cloud Shell. No cloud credentials are available here.')
    for region in ('global', REGION):
        if gcloud('builds', 'list', f'--project={PROJECT}', '--region=' + region,
                  '--filter=status=(QUEUED WORKING PENDING)'):
            raise ReleaseError('Another build is active. Wait for it to finish before this release.')
    accounts = resolve_engineers(args.engineer_email)
    # Validate current Firebase config and the existing image repository before
    # creating resources or starting a paid build.
    google_request(f'v2/projects/{PROJECT}/config')
    gcloud('artifacts', 'repositories', 'describe', 'cloud-run-source-deploy',
        f'--project={PROJECT}', f'--location={REGION}')
    with tempfile.TemporaryDirectory(prefix='repaido-engineering-release-') as directory:
        temp = Path(directory)
        source = temp / 'source'
        source.mkdir()
        stage_source(args.release, source)
        check_build(args.release, 'true', source)
        bootstrap()
        grant_engineers(accounts)
        build_id, image = build_image(args.release, source)
        deploy(args.release, image, build_id, accounts, temp)


if __name__ == '__main__':
    try:
        main()
    except (ReleaseError, subprocess.CalledProcessError, OSError, ValueError, KeyError) as error:
        print('Release stopped: ' + str(error), file=sys.stderr)
        sys.exit(1)
