"""One-time setup in Google Cloud Shell. Creates no Google service-account keys."""
import argparse
import getpass
import json
from pathlib import Path
import subprocess
import urllib.request

PROJECT = 'repaido'
PROJECT_NUMBER = '133610574058'
REPOSITORY_ID = '1404280702'
OWNER_ID = '332603370'
POOL = 'repaido-github-production'
ACCOUNT = 'github-production@repaido.iam.gserviceaccount.com'
BUILD_ACCOUNT = 'firebase-adminsdk-fbsvc@repaido.iam.gserviceaccount.com'
SECRET = 'repaido-cpanel-api-token'
BUCKET = 'gs://repaido-github-build-source'
PROVIDER_CONDITION = (
    "assertion.repository_id == '1404280702' && "
    "assertion.repository_owner_id == '332603370' && "
    "assertion.ref == 'refs/heads/main' && "
    "assertion.sub == 'repo:miku0027-ops/repaido:environment:production' && "
    "assertion.workflow_ref == 'miku0027-ops/repaido/.github/workflows/production.yml@refs/heads/main' && "
    "(assertion.event_name == 'push' || assertion.event_name == 'workflow_dispatch')"
)


def gcloud(*args, data=None):
    result = subprocess.run(['gcloud', *args, '--project=' + PROJECT, '--quiet', '--format=json'],
                            input=data, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    return json.loads(result.stdout) if result.stdout.strip() else None


def absent(*args):
    result = subprocess.run(['gcloud', *args, '--project=' + PROJECT, '--format=json'], capture_output=True, text=True)
    if result.returncode == 0:
        return False
    if any(message in result.stderr for message in ('NOT_FOUND', 'HTTPError 404', 'does not exist')):
        return True
    raise RuntimeError(result.stderr.strip())


def role(name, permissions):
    verb = 'create' if absent('iam', 'roles', 'describe', name) else 'update'
    gcloud('iam', 'roles', verb, name, '--title=' + name, '--stage=GA', '--permissions=' + ','.join(permissions))
    return 'projects/' + PROJECT + '/roles/' + name


def matches_legacy_trigger(trigger):
    github = trigger.get('github', {})
    return (github.get('owner') == 'miku0027-ops' and github.get('name') == 'repaido'
            and bool(github.get('push')) and not trigger.get('disabled')
            and trigger.get('filename') in ('cloudbuild.yaml', 'cloudbuild-api.yaml', 'cloudbuild-web.yaml', 'cloudbuild-rules.yaml'))


def setup(replace_token=False):
    info = gcloud('projects', 'describe', PROJECT)
    if str(info['projectNumber']) != PROJECT_NUMBER:
        raise ValueError('The project number does not match the reviewed Repaido project.')
    # Reuse the existing, provisioned build identity and runtime permissions.
    gcloud('iam', 'service-accounts', 'describe', BUILD_ACCOUNT)
    gcloud('services', 'enable', 'iam.googleapis.com', 'iamcredentials.googleapis.com',
           'sts.googleapis.com', 'cloudbuild.googleapis.com', 'secretmanager.googleapis.com',
           'run.googleapis.com', 'storage.googleapis.com')
    if absent('iam', 'service-accounts', 'describe', ACCOUNT):
        gcloud('iam', 'service-accounts', 'create', 'github-production', '--display-name=GitHub production release')
    if absent('iam', 'workload-identity-pools', 'describe', POOL, '--location=global'):
        gcloud('iam', 'workload-identity-pools', 'create', POOL, '--location=global', '--display-name=Repaido main deployment')
    provider_args = ('--workload-identity-pool=' + POOL, '--location=global')
    verb = 'create-oidc' if absent('iam', 'workload-identity-pools', 'providers', 'describe', 'github', *provider_args) else 'update-oidc'
    gcloud('iam', 'workload-identity-pools', 'providers', verb, 'github', *provider_args,
           '--issuer-uri=https://token.actions.githubusercontent.com',
           '--attribute-mapping=google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id',
           '--attribute-condition=' + PROVIDER_CONDITION)
    member = ('principalSet://iam.googleapis.com/projects/' + PROJECT_NUMBER +
              '/locations/global/workloadIdentityPools/' + POOL + '/attribute.repository_id/' + REPOSITORY_ID)
    gcloud('iam', 'service-accounts', 'add-iam-policy-binding', ACCOUNT,
           '--role=roles/iam.workloadIdentityUser', '--member=' + member)
    submit_role = role('githubProductionRelease', [
        'cloudbuild.builds.create', 'cloudbuild.builds.get', 'cloudbuild.builds.list',
        'run.services.get', 'run.revisions.get', 'serviceusage.services.use', 'resourcemanager.projects.get',
    ])
    gcloud('projects', 'add-iam-policy-binding', PROJECT, '--member=serviceAccount:' + ACCOUNT,
           '--role=' + submit_role, '--condition=None')
    gcloud('iam', 'service-accounts', 'add-iam-policy-binding', BUILD_ACCOUNT,
           '--member=serviceAccount:' + ACCOUNT, '--role=roles/iam.serviceAccountUser')
    if absent('storage', 'buckets', 'describe', BUCKET):
        gcloud('storage', 'buckets', 'create', BUCKET, '--location=us-central1',
               '--uniform-bucket-level-access', '--public-access-prevention')
    bucket = gcloud('storage', 'buckets', 'describe', BUCKET)
    if str(bucket.get('project_number', bucket.get('projectNumber', ''))) != PROJECT_NUMBER:
        raise ValueError('The source bucket belongs to another project; do not change its IAM.')
    source_role = role('githubProductionSource', [
        'storage.buckets.get', 'storage.objects.create', 'storage.objects.get', 'storage.objects.list',
    ])
    gcloud('storage', 'buckets', 'add-iam-policy-binding', BUCKET,
           '--member=serviceAccount:' + ACCOUNT, '--role=' + source_role)
    gcloud('storage', 'buckets', 'add-iam-policy-binding', BUCKET,
           '--member=serviceAccount:' + BUILD_ACCOUNT, '--role=roles/storage.objectViewer')
    if absent('secrets', 'describe', SECRET):
        gcloud('secrets', 'create', SECRET, '--replication-policy=automatic')
    versions = gcloud('secrets', 'versions', 'list', SECRET, '--sort-by=~createTime', '--limit=1')
    if replace_token or not versions or versions[0].get('state') != 'ENABLED':
        token = getpass.getpass('cPanel API token (saved once in Google Secret Manager; input hidden): ').strip()
        if not token:
            raise ValueError('An existing cPanel API token is required to publish repaido.com.')
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args): return None
        request = urllib.request.Request(
            'https://cpanel.repaido.com/execute/DomainInfo/single_domain_data?domain=repaido.com',
            headers={'Authorization': 'cpanel repaidoc:' + token})
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=30) as response:
            domain = json.load(response)
        if domain.get('status') != 1 or domain.get('data', {}).get('documentroot') != '/home/repaidoc/public_html':
            raise ValueError('The cPanel token did not confirm the production document root; it was not saved.')
        gcloud('secrets', 'versions', 'add', SECRET, '--data-file=-', data=token)
        del token
    gcloud('secrets', 'add-iam-policy-binding', SECRET, '--member=serviceAccount:' + ACCOUNT,
           '--role=roles/secretmanager.secretAccessor')
    # Use one deploy controller. Leave unrelated/engineering triggers alone.
    for region in ('global', 'us-central1'):
        for trigger in gcloud('builds', 'triggers', 'list', '--region=' + region):
            if matches_legacy_trigger(trigger):
                subprocess.run(['python3', str(Path(__file__).with_name('cloud-cost-controls.py')),
                                'disable-trigger', '--project=' + PROJECT, '--location=' + region,
                                '--trigger=' + trigger['id'], '--apply'], check=True)
                print('Disabled duplicate legacy production trigger:', trigger['id'])
    print('Google trust and scoped deployment permissions are configured. No Google key was created.')
    print('Allow a few minutes for IAM propagation, then run Deploy production from GitHub Actions on main.')
    print('If the existing APIs are unhealthy, select the API recovery option to run the tested candidate deployment.')
    print('Future pushes to main deploy automatically: https://github.com/miku0027-ops/repaido/actions/workflows/production.yml')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--replace-cpanel-token', action='store_true')
    args = parser.parse_args()
    setup(args.replace_cpanel_token)
