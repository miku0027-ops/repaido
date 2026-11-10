"""Release main using GitHub OIDC credentials; compare actual deployed components."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
PROJECT = 'repaido'
REGION = 'us-central1'
BUILD_ACCOUNT = 'firebase-adminsdk-fbsvc@repaido.iam.gserviceaccount.com'
SOURCE_BUCKET = 'gs://repaido-github-build-source/source'
API_ORIGINS = (
    'https://repaido-api-133610574058.us-central1.run.app',
    'https://repaido-work-api-133610574058.us-central1.run.app',
)


def command(*args):
    return subprocess.check_output(args, cwd=ROOT, text=True).strip()


def gcloud(*args):
    return json.loads(command('gcloud', *args, '--project=' + PROJECT, '--format=json'))


def read_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'Cache-Control': 'no-cache'}), timeout=30) as response:
        return json.load(response)


def require_main(env):
    if (env.get('GITHUB_REPOSITORY_ID') != '1404280702'
            or env.get('GITHUB_REPOSITORY_OWNER_ID') != '332603370'
            or env.get('GITHUB_REF') != 'refs/heads/main'
            or env.get('GITHUB_EVENT_NAME') not in ('push', 'workflow_dispatch')
            or not re.fullmatch(r'[a-f0-9]{40}', env.get('GITHUB_SHA', ''))):
        raise ValueError('Only this repository\'s main workflow can release production.')


def changes(base, head):
    if not re.fullmatch(r'[a-f0-9]{40}', base):
        raise ValueError('Production did not report a full source commit.')
    command('git', 'merge-base', '--is-ancestor', base, head)
    return command('git', 'diff', '--name-only', '--no-renames', base, head).splitlines()


def components(web_paths, api_paths, force_api=False):
    # CI/bootstrap/docs changes alone do not rebuild the runtime image.
    def classify(path):
        if path == 'firestore.indexes.json':
            raise ValueError('Changed Firestore indexes require a reviewed index deployment first.')
        if path.startswith('engineering/'):
            raise ValueError('Engineering console changes require its separate release workflow.')
        if path.startswith('web/') or path.startswith('deployment/cpanel/'):
            return 'web'
        if path.startswith('backend/'):
            return 'api'
        if path in ('firestore.rules', 'firebase.security-tests.json', 'scripts/test-firestore-security.mjs'):
            return 'rules'
        if path.startswith(('docs/', 'android/', '.github/')) or path in (
            'README.md', 'AGENTS.md', '.gitignore', 'scripts/production-release.py',
            'scripts/bootstrap-github-production.py', 'scripts/publish-cpanel-release.py',
            'scripts/cpanel_client.py', 'scripts/test-production-release.py',
            'scripts/package-cpanel-release.py', 'scripts/verify-cpanel-release.py',
        ):
            return None
        return 'shared'
    web = {classify(p) for p in web_paths}
    api = {classify(p) for p in api_paths}
    deploy_api = force_api or bool(api & {'api', 'shared'})
    return {'api': deploy_api, 'rules': bool(web & {'rules', 'shared'} or api & {'shared'}),
            'web': deploy_api or bool(web & {'web', 'rules', 'shared'})}


def serving_build(service):
    info = gcloud('run', 'services', 'describe', service, '--region=' + REGION)
    active = [row for row in info['status']['traffic'] if row.get('percent', 0)]
    if len(active) != 1 or active[0]['percent'] != 100 or not active[0].get('revisionName'):
        raise ValueError('Resolve split or unknown Cloud Run traffic before releasing ' + service)
    revision = gcloud('run', 'revisions', 'describe', active[0]['revisionName'], '--region=' + REGION)
    env = revision['spec']['containers'][0].get('env', [])
    build = next((row.get('value', '') for row in env if row['name'] == 'REPAIDO_BUILD_ID'), '')
    if not re.fullmatch(r'[a-f0-9-]{36}', build):
        raise ValueError('The serving revision has no recognized Cloud Build ID: ' + service)
    return build


def build_record(build):
    # Earlier approved builds were global; new runs use us-central1.
    for region in (REGION, 'global'):
        try:
            return gcloud('builds', 'describe', build, '--region=' + region)
        except subprocess.CalledProcessError:
            if region == 'global':
                raise


def healthy(build):
    for origin in API_ORIGINS:
        health = read_json(origin + '/api/health')
        if health.get('status') != 'ok' or health.get('build_id') != build:
            raise ValueError('The production API health/build check failed: ' + origin)


def submit(config, commit, evidence):
    for region in ('global', REGION):
        active = gcloud('builds', 'list', '--region=' + region, '--filter=status=(QUEUED WORKING PENDING)')
        if active:
            raise ValueError('Another Cloud Build release is active; wait for it to finish.')
    subprocess.run(['python3', 'scripts/generate-selective-builds.py', '--check'], cwd=ROOT, check=True)
    inventory = command('gcloud', 'meta', 'list-files-for-upload')
    inventory_path = evidence / 'source-inventory.txt'
    inventory_path.write_text(inventory + '\n')
    subprocess.run(['python3', 'scripts/check-build-source.py', '--inventory', str(inventory_path)], cwd=ROOT, check=True)
    build = gcloud('builds', 'submit', '.', '--region=' + REGION, '--config=' + config,
                   '--substitutions=_RELEASE_APPROVED=true,COMMIT_SHA=' + commit,
                   '--service-account=projects/' + PROJECT + '/serviceAccounts/' + BUILD_ACCOUNT,
                   '--gcs-source-staging-dir=' + SOURCE_BUCKET, '--async', '--quiet')
    build_id = build['id']
    print('Cloud Build:', build_id, flush=True)
    (evidence / (config + '.submitted.json')).write_text(json.dumps({'id': build_id, 'commit': commit}) + '\n')
    # Do not cancel a remote deployment if the GitHub runner disappears. A later
    # run reads its actual serving revision and refuses overlapping active builds.
    for _ in range(230):
        result = gcloud('builds', 'describe', build_id, '--region=' + REGION)
        status = result['status']
        if status == 'SUCCESS':
            return build_id
        if status not in ('QUEUED', 'WORKING', 'PENDING', 'STATUS_UNKNOWN'):
            raise ValueError('Cloud Build ' + build_id + ' ended with ' + status + '. Review its logs before retrying.')
        time.sleep(10)
    raise ValueError('Build wait timed out. Inspect ' + build_id + ' before another release.')


def release(evidence, phase, force_api=False):
    require_main(os.environ)
    commit = os.environ['GITHUB_SHA']
    if command('git', 'rev-parse', 'HEAD') != commit or command('git', 'status', '--porcelain'):
        raise ValueError('Release requires a clean checkout of the workflow commit.')
    evidence.mkdir(parents=True, exist_ok=True)
    plan_path = evidence / 'plan.json'
    if phase == 'plan':
        remote = command('git', 'ls-remote', 'origin', 'refs/heads/main').split()[0]
        if remote != commit:
            raise ValueError('A newer main commit is available. Its queued workflow will release it.')
        site = read_json('https://repaido.com/build-info.json')
        website_commit = site['commit']
        builds = [serving_build(name) for name in ('repaido-api', 'repaido-work-api')]
        if len(set(builds)) != 1:
            raise ValueError('The public APIs serve different builds. Resolve the partial release first.')
        api_build = builds[0]
        record = build_record(api_build)
        api_commit = record.get('substitutions', {}).get('COMMIT_SHA', '')
        if record.get('status') != 'SUCCESS':
            raise ValueError('The current API build is not a successful release.')
        plan = components(changes(website_commit, commit), changes(api_commit, commit), force_api)
        report = {'commit': commit, 'previous_website_commit': website_commit,
                  'previous_api_commit': api_commit, 'previous_api_build': api_build,
                  'api_commit': api_commit, 'api_build': api_build, 'plan': plan}
        plan_path.write_text(json.dumps(report, indent=2) + '\n')
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            for name, enabled in plan.items():
                output.write(name + '=' + str(enabled).lower() + '\n')
        print(json.dumps(report, indent=2), flush=True)
        return
    report = json.loads(plan_path.read_text())
    if report['commit'] != commit or not report['plan'].get(phase):
        raise ValueError('This phase was not planned for this exact commit.')
    api_build, api_commit = report['api_build'], report['api_commit']
    if phase == 'rules':
        report['rules_build'] = submit('cloudbuild-rules.yaml', commit, evidence)
    elif phase == 'api':
        api_build = submit('cloudbuild-api.yaml', commit, evidence)
        api_commit = commit
        report.update(api_build=api_build, api_commit=api_commit)
    elif phase == 'web':
        healthy(api_build)
        subprocess.run(['npm', 'test'], cwd=ROOT / 'web', check=True)
        archive = evidence / ('repaido-' + commit + '.zip')
        subprocess.run(['python3', 'scripts/package-cpanel-release.py', '--release', commit,
                        '--required-api-commit', api_commit, '--output', str(archive)], cwd=ROOT, check=True)
        # The one cPanel credential lives in Secret Manager, not GitHub or source.
        token = command('gcloud', 'secrets', 'versions', 'access', 'latest',
                        '--secret=repaido-cpanel-api-token', '--project=' + PROJECT)
        env = dict(os.environ, CPANEL_HOST='cpanel.repaido.com', CPANEL_USERNAME='repaidoc', CPANEL_API_TOKEN=token)
        subprocess.run(['python3', 'scripts/publish-cpanel-release.py', '--archive', str(archive),
                        '--baseline', report['previous_website_commit'], '--api-build', api_build],
                       cwd=ROOT, env=env, check=True)
        subprocess.run(['python3', 'scripts/verify-cpanel-release.py', '--release', commit,
                        '--api-build', api_build], cwd=ROOT, check=True)
    report[phase + '_verified'] = True
    plan_path.write_text(json.dumps(report, indent=2) + '\n')
    (evidence / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--phase', choices=('plan', 'rules', 'api', 'web'), required=True)
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--force-api', action='store_true', help='Explicit recovery: redeploy the API through its candidate checks.')
    args = parser.parse_args()
    release(args.evidence.resolve(), args.phase, args.force_api)
