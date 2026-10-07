"""Deploy bounded work services using the existing API's runtime identity/config.

Cloud Build supplies ADC. Runtime secret references are preserved without reading
secret values or writing them to logs. No credentials are generated or exported.
"""
import argparse
import json
import os
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

REQUIRED_WORK_APIS = ('cloudscheduler.googleapis.com', 'fcm.googleapis.com',
                      'fcmregistrations.googleapis.com', 'firebaseinstallations.googleapis.com')


def gcloud(*args, data=False):
    result = subprocess.check_output(['gcloud', *args, '--quiet', '--format=json'], text=True)
    return json.loads(result) if data and result.strip() else result


def exists(*args):
    result = subprocess.run(['gcloud', *args, '--format=json'], text=True, capture_output=True)
    if result.returncode == 0:
        return json.loads(result.stdout)
    if 'NOT_FOUND' in result.stderr or 'not found' in result.stderr.lower() or 'does not exist' in result.stderr.lower():
        return None
    raise RuntimeError('GCP resource check failed: ' + result.stderr)


def ensure_required_apis(project):
    """Reuse enabled APIs without requiring an API-enablement role each release."""
    enabled = gcloud('services', 'list', '--enabled', '--project=' + project, data=True)
    if not isinstance(enabled, list):
        raise RuntimeError('Could not determine the project enabled APIs; refusing an unverified setup change.')
    names = {service.get('config', {}).get('name') for service in enabled}
    missing = [service for service in REQUIRED_WORK_APIS if service not in names]
    if missing:
        gcloud('services', 'enable', *missing, '--project=' + project)
    else:
        print('Required work APIs are already enabled.')


def request_health(url, build_id, token, service):
    for attempt in range(12):
        try:
            request = urllib.request.Request(url + '/health', headers={'Authorization': 'Bearer ' + token})
            with urllib.request.urlopen(request, timeout=20) as response:
                health = json.load(response)
            assert health['status'] == 'ok' and health['storage'] == 'firestore' and health['build_id'] == build_id and health['service'] == service
            if service == 'repaido-work-worker':
                assert health['push_enabled'] and health['scheduler_configured'], 'Work delivery configuration is incomplete.'
            if service == 'repaido-work-api':
                probe = urllib.request.Request(url + '/repaidians/work/jobs', headers={'X-Serverless-Authorization': 'Bearer ' + token})
                try:
                    urllib.request.urlopen(probe, timeout=20)
                    raise AssertionError('Work discovery must require a member identity.')
                except urllib.error.HTTPError as error:
                    assert error.code == 401, 'Work discovery route/auth boundary failed.'
            return
        except Exception:
            if attempt == 11:
                raise
            time.sleep(5)


def deploy(args):
    common = ['--project=' + args.project, '--region=' + args.region]
    parent = gcloud('run', 'services', 'describe', args.parent, *common, data=True)
    spec = parent['spec']['template']['spec']
    runtime = spec['serviceAccountName']
    environment, secrets = {}, []
    for entry in spec['containers'][0].get('env', []):
        if 'value' in entry:
            environment[entry['name']] = entry['value']
        elif 'valueFrom' in entry:
            secret = entry['valueFrom']['secretKeyRef']
            secrets.append(entry['name'] + '=' + secret['name'] + ':' + secret['key'])
    aliases = dict(item.split(':', 1) for item in parent['spec']['template'].get('metadata', {}).get('annotations', {}).get('run.googleapis.com/secrets', '').split(',') if ':' in item)
    secrets = [name + '=' + aliases.get(reference.rsplit(':', 1)[0], reference.rsplit(':', 1)[0]) + ':' + reference.rsplit(':', 1)[1]
               for name, reference in (binding.split('=', 1) for binding in secrets)]
    mounts = {mount['name']: mount['mountPath'] for mount in spec['containers'][0].get('volumeMounts', [])}
    for volume in spec.get('volumes', []):
        if volume['name'] not in mounts:
            continue
        if 'secret' not in volume:
            raise RuntimeError('The parent API has a non-secret volume that needs an explicit work-service mount configuration.')
        secret = volume['secret']
        reference = aliases.get(secret['secretName'], secret['secretName'])
        for item in secret.get('items', []):
            secrets.append(mounts[volume['name']].rstrip('/') + '/' + item['path'] + '=' + reference + ':' + item['key'])
    environment.update(REPAIDO_STORAGE='firestore', GOOGLE_CLOUD_PROJECT=args.project, REPAIDO_BUILD_ID=args.build)
    caller = 'repaido-work-scheduler@' + args.project + '.iam.gserviceaccount.com'
    # Provision the dedicated scheduling caller before introducing Hosting routes.
    ensure_required_apis(args.project)
    gcloud('firestore', 'fields', 'ttls', 'update', 'expiresAt',
           '--collection-group=ops_rp_work_behavior_commands', '--enable-ttl', '--async', '--project=' + args.project)
    if not exists('iam', 'service-accounts', 'describe', caller, '--project=' + args.project):
        gcloud('iam', 'service-accounts', 'create', 'repaido-work-scheduler',
               '--display-name=Repaido work update scheduler', '--project=' + args.project)
    candidates = []
    tag = 'b-' + args.build.replace('-', '')[:20]
    for name, module, worker in [('repaido-work-api', 'work_service', False), ('repaido-work-worker', 'work_worker', True)]:
        previous = exists('run', 'services', 'describe', name, *common)
        values = dict(environment)
        if worker:
            values['REPAIDO_WORK_SCHEDULER_EMAIL'] = caller
            values['REPAIDO_PUSH_ENABLED'] = 'true'
            if previous:
                values['REPAIDO_WORK_WORKER_AUDIENCE'] = previous['status']['url'].rstrip('/')
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json') as config:
            os.chmod(config.name, 0o600)
            json.dump(values, config)
            config.flush()
            command = ['run', 'deploy', name, *common, '--image=' + args.image,
                       '--service-account=' + runtime, '--command=uvicorn',
                       '--args=' + module + ':app,--host,0.0.0.0,--port,8080,--no-proxy-headers',
                       '--port=8080', '--env-vars-file=' + config.name,
                       '--concurrency=' + ('1' if worker else '64'), '--cpu=1', '--memory=512Mi',
                       '--timeout=' + ('240' if worker else '60'), '--min-instances=0',
                       '--max-instances=' + ('2' if worker else '20'),
                       '--no-allow-unauthenticated' if worker else '--allow-unauthenticated', '--tag=' + tag]
            if previous:
                command.append('--no-traffic')
            if secrets:
                command.append('--set-secrets=' + ','.join(secrets))
            service = gcloud(*command, data=True)
        stable = service['status']['url'].rstrip('/')
        if worker and not previous:
            service = gcloud('run', 'services', 'update', name, *common,
                             '--update-env-vars=REPAIDO_WORK_WORKER_AUDIENCE=' + stable,
                             '--no-traffic', '--tag=' + tag, data=True)
        traffic = next(traffic for traffic in service['status']['traffic'] if traffic.get('tag') == tag)
        tagged = traffic['url']
        token = subprocess.check_output(['gcloud', 'auth', 'print-identity-token', '--audiences=' + stable], text=True).strip()
        request_health(tagged, args.build, token, name)
        candidates.append({'name': name, 'revision': traffic['revisionName'], 'url': stable})
        if worker:
            gcloud('run', 'services', 'add-iam-policy-binding', name, *common,
                   '--member=serviceAccount:' + caller, '--role=roles/run.invoker')
    # Configure the schedule only after both independent services passed health.
    worker_url = candidates[1]['url']
    scheduler = ['--project=' + args.project, '--location=' + args.region]
    action = 'update' if exists('scheduler', 'jobs', 'describe', 'repaido-work-updates', *scheduler) else 'create'
    gcloud('scheduler', 'jobs', action, 'http', 'repaido-work-updates', *scheduler,
           '--schedule=* * * * *', '--time-zone=Asia/Kolkata',
           '--uri=' + worker_url + '/internal/work/dispatch', '--http-method=POST',
           '--oidc-service-account-email=' + caller, '--oidc-token-audience=' + worker_url,
           ('--update-headers=' if action == 'update' else '--headers=') + 'Content-Type=application/json', '--message-body={"limit":40}',
           '--attempt-deadline=240s', '--max-retry-attempts=3', '--min-backoff=30s', '--max-backoff=300s')
    gcloud('scheduler', 'jobs', 'pause', 'repaido-work-updates', *scheduler)
    with open(args.receipt, 'w') as output:
        json.dump(candidates, output)
    print('Independent work API and private worker passed candidate health; Scheduler configured with a dedicated caller.')


def promote(args):
    for service in json.load(open(args.receipt)):
        gcloud('run', 'services', 'update-traffic', service['name'],
               '--project=' + args.project, '--region=' + args.region,
               '--to-revisions=' + service['revision'] + '=100')
    gcloud('scheduler', 'jobs', 'resume', 'repaido-work-updates',
           '--project=' + args.project, '--location=' + args.region)
    print('Verified work candidates promoted.')


def check_build_access(args):
    """Fail before expensive work if the later release-order reads are denied."""
    if not args.build:
        raise ValueError('--build is required for the build-history access check.')
    build_region = getattr(args, 'build_region', 'global')
    common = ['--project=' + args.project, '--region=' + build_region]
    for operation in [('builds', 'describe', args.build, *common),
                      ('builds', 'list', *common, '--limit=1')]:
        try:
            # Capture the JSON without printing build environment/configuration.
            gcloud(*operation, data=True)
        except subprocess.CalledProcessError as error:
            raise RuntimeError(
                'Cloud Build history read access failed before tests. The active build service account needs '
                'cloudbuild.builds.get and cloudbuild.builds.list, included in roles/cloudbuild.builds.viewer, '
                f'on project {args.project} for build location {build_region}. '
                'Check the gcloud error above, verify the account binding, then retry. '
                'This check does not grant permissions or change resources.'
            ) from error
    print('Cloud Build history read access verified; tests can proceed.')


def await_release(args):
    """Order releases from the same trigger so an older build cannot roll back a new one."""
    from datetime import datetime
    def stamp(value):
        return datetime.fromisoformat(value.replace('Z', '+00:00'))
    build_region = getattr(args, 'build_region', 'global')
    own = gcloud('builds', 'describe', args.build, '--project=' + args.project, '--region=' + build_region, data=True)
    trigger = own.get('buildTriggerId')
    if not trigger:
        return
    started = time.monotonic()
    while True:
        active = gcloud('builds', 'list', '--project=' + args.project, '--region=' + build_region, '--limit=100',
                        '--filter=buildTriggerId=' + trigger + ' AND (status=WORKING OR status=QUEUED)', data=True)
        earlier = [build for build in active if build['id'] != args.build and stamp(build['createTime']) < stamp(own['createTime'])]
        if not earlier:
            print('Earlier builds from this trigger have completed; release can proceed.')
            return
        if time.monotonic() - started >= 900:
            raise RuntimeError('An earlier build is still active; refusing an overlapping production release.')
        print('Waiting for an earlier build from this trigger before promoting.', flush=True)
        time.sleep(10)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['deploy', 'promote', 'await-release', 'check-build-access'])
    parser.add_argument('--project', required=True)
    parser.add_argument('--region', default='us-central1')
    parser.add_argument('--build-region', default='global', help='Cloud Build location, separate from the Cloud Run service region.')
    parser.add_argument('--parent', default='repaido-api')
    parser.add_argument('--image')
    parser.add_argument('--build')
    parser.add_argument('--receipt', default='/workspace/work-candidates.json')
    arguments = parser.parse_args()
    {'deploy': deploy, 'promote': promote, 'await-release': await_release,
     'check-build-access': check_build_access}[arguments.action](arguments)
