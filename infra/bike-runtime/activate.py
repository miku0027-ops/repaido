#!/usr/bin/env python3
"""Cloud Shell bike runtime setup. Inventory by default; explicit phases mutate.

No credentials/secret values are printed or written to release records. The API
candidate uses the already serving image digest, never a new build or mutable tag.
"""
import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

PROJECT = 'repaido'
PROJECT_NUMBER = '133610574058'
REGION = 'us-central1'
SERVICE = 'repaido-api'
NAME = 'repaido-bike-dispatch'
TOPIC = f'projects/{PROJECT}/topics/{NAME}-v1'
SUBSCRIPTION = f'projects/{PROJECT}/subscriptions/{NAME}-worker-v1'
WORKER = f'{NAME}@{PROJECT}.iam.gserviceaccount.com'
QUOTA = 'repaido-bike-promo-quota'
ROOT = Path(__file__).resolve().parent
ENVIRONMENT = {'REPAIDO_STORAGE': 'firestore', 'REPAIDO_BIKE_DISPATCH_MODE': 'pubsub',
               'REPAIDO_BIKE_PUBSUB_TOPIC': TOPIC, 'REPAIDO_BIKE_PUBSUB_SUBSCRIPTION': SUBSCRIPTION,
               'REPAIDO_BIKE_PUBSUB_REGION': REGION}
IMAGE = re.compile(r'us-central1-docker\.pkg\.dev/repaido/[a-zA-Z0-9_.-]+/[a-zA-Z0-9_./-]+@sha256:[a-f0-9]{64}')
RUN_URL = re.compile(r'https://[a-z0-9-]+(?:[.][a-z0-9-]+)?[.]run[.]app')
RUNTIME_ANNOTATIONS = ('run.googleapis.com/vpc-access-connector', 'run.googleapis.com/vpc-access-egress',
    'run.googleapis.com/execution-environment', 'run.googleapis.com/startup-cpu-boost',
    'run.googleapis.com/cpu-throttling', 'run.googleapis.com/encryption-key',
    'autoscaling.knative.dev/minScale', 'autoscaling.knative.dev/maxScale')


class SetupError(RuntimeError):
    pass


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=path.name+'.', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w') as stream:
            json.dump(value, stream, indent=2, sort_keys=True, allow_nan=False)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        Path(temporary).unlink(missing_ok=True)


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


class Runner:
    def run(self, args, *, raw=False, optional=False, data=None, cwd=None, timeout=180):
        try:
            result = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    cwd=cwd, timeout=timeout)
        except (FileNotFoundError, subprocess.TimeoutExpired):
            raise SetupError(f'{args[0]} is unavailable or timed out') from None
        if result.returncode:
            error = result.stderr.decode(errors='replace').upper()
            if optional and not any(x in error for x in ('PERMISSION_DENIED', 'UNAUTHENTICATED', '403', '401')) and any(
                    x in error for x in ('NOT_FOUND', 'NOT FOUND', 'DOES NOT EXIST', 'CANNOT FIND',
                                         'NO SUCH OBJECT', 'THE SPECIFIED BUCKET DOES NOT EXIST')):
                return None
            raise SetupError(f'{args[0]} {args[1]} failed; inspect authorization/resource settings in Cloud Shell')
        if raw:
            return result.stdout.decode()
        try:
            return json.loads(result.stdout) if result.stdout.strip() else {}
        except ValueError:
            raise SetupError('Provider returned invalid JSON') from None

    def cloud(self, *args, optional=False, data=None):
        # Use the same explicit quota project as the direct REST diagnostics.
        # Do not inherit another account's default or append conflicting flags.
        selected = []
        index = 0
        while index < len(args):
            argument = args[index]
            if argument == '--billing-project':
                index += 1
                value = args[index] if index < len(args) else None
            elif argument.startswith('--billing-project='):
                value = argument.split('=', 1)[1]
            else:
                selected.append(argument)
                index += 1
                continue
            if value != PROJECT:
                raise SetupError('Bike activation requires repaido as its quota project')
            index += 1
        return self.run(['gcloud', *selected, '--project='+PROJECT,
                         '--billing-project='+PROJECT, '--quiet', '--format=json'],
                        optional=optional, data=data)

    def tf(self, directory, *args, raw=False):
        if os.getenv('TF_WORKSPACE', 'default') != 'default':
            raise SetupError('Use the default Terraform workspace for the reviewed bike-runtime/v1 state prefix')
        return self.run(['terraform', *args], cwd=directory, raw=raw, timeout=1200)

    def api_read(self, url, *, optional=False):
        # Cloud Shell's existing OAuth identity only; token stays in memory.
        storage_metadata = re.fullmatch(r'https://storage\.googleapis\.com/storage/v1/b/repaido-[a-z0-9-]{3,50}\?fields=name,projectNumber,iamConfiguration,versioning', url)
        if not storage_metadata and not url.startswith(('https://compute.googleapis.com/compute/v1/projects/repaido/',
                                                       'https://monitoring.googleapis.com/v3/projects/repaido/')):
            raise SetupError('Unexpected Google Cloud metadata API URL')
        token = self.run(['gcloud', 'auth', 'print-access-token'], raw=True).strip()
        request = urllib.request.Request(url, headers={'Authorization': 'Bearer '+token,
                                                       'X-Goog-User-Project': PROJECT})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if optional and error.code == 404:
                return None
            raise SetupError('Google Cloud metadata API could not be verified; check permissions and enabled APIs') from None
        except (OSError, ValueError):
            raise SetupError('Google Cloud metadata API could not be verified') from None

    def monitoring_policies(self):
        result = self.api_read('https://monitoring.googleapis.com/v3/projects/repaido/alertPolicies?pageSize=1000')
        if result.get('nextPageToken'):
            raise SetupError('Monitoring inventory exceeded the bounded page; review alert ownership manually')
        return result.get('alertPolicies', [])


def environment(revision):
    containers = revision.get('spec', {}).get('containers') or []
    if len(containers) != 1:
        raise SetupError('Expected one existing API container; multi-container changes need a separate review')
    return {row['name']: row for row in containers[0].get('env', [])}


def digest_image(revision):
    container = (revision.get('spec', {}).get('containers') or [{}])[0]
    image = revision.get('status', {}).get('imageDigest') or container.get('image', '')
    if re.fullmatch(r'sha256:[a-f0-9]{64}', image):
        original = container.get('image', '')
        if not re.fullmatch(r'us-central1-docker\.pkg\.dev/repaido/[a-zA-Z0-9_.-]+/[a-zA-Z0-9_./-]+(?:[:@][a-zA-Z0-9:_.-]+)?', original):
            raise SetupError('Cannot establish the image repository for the serving digest')
        image = original.split('@')[0].rsplit(':', 1)[0] + '@' + image
    if not IMAGE.fullmatch(image):
        raise SetupError('The serving revision must expose a pinned same-project regional Artifact Registry image')
    return image


def select_serving(service, revision):
    generation = service.get('metadata', {}).get('generation')
    observed = service.get('status', {}).get('observedGeneration')
    if generation is not None and str(generation) != str(observed):
        raise SetupError('Cloud Run has an unobserved configuration update; wait for it before setup')
    conditions = service.get('status', {}).get('conditions', [])
    if conditions and not any(row.get('type') == 'Ready' and row.get('status') in ('True', True) for row in conditions):
        raise SetupError('Cloud Run is not currently Ready')
    traffic = [row for row in service.get('status', {}).get('traffic', []) if row.get('percent', 0)]
    ready = service.get('status', {}).get('latestReadyRevisionName')
    created = service.get('status', {}).get('latestCreatedRevisionName')
    name = traffic[0].get('revisionName') or (ready if traffic[0].get('latestRevision') else None) if len(traffic) == 1 else None
    if len(traffic) != 1 or traffic[0].get('percent') != 100 or not name:
        raise SetupError('Refusing mixed or unresolvable API traffic; finish the current release first')
    if revision.get('metadata', {}).get('name') != name or ready != name or created != name:
        raise SetupError('Serving and latest API revisions differ; resolve the pending candidate before setup')
    env = environment(revision)
    if env.get('REPAIDO_STORAGE', {}).get('value') != 'firestore':
        raise SetupError('The existing API must already use Firestore')
    build_id = env.get('REPAIDO_BUILD_ID', {}).get('value')
    if not isinstance(build_id, str) or not build_id.strip() or build_id == 'local':
        raise SetupError('The serving API must identify its reviewed production build')
    account = revision.get('spec', {}).get('serviceAccountName', '')
    if not account.endswith('@repaido.iam.gserviceaccount.com'):
        raise SetupError('Unexpected API service account; refusing identity changes')
    url = service.get('status', {}).get('url', '')
    if not RUN_URL.fullmatch(url):
        raise SetupError('Unexpected Cloud Run API URL')
    return {'revision': name, 'image': digest_image(revision), 'service_account': account,
            'build_id': build_id, 'url': url,
            'environment_fingerprint': fingerprint(revision.get('spec', {}))}


def validate_secret(resource):
    if isinstance(resource, str):
        resource = resource.replace('projects/'+PROJECT_NUMBER+'/', 'projects/repaido/', 1)
    if not re.fullmatch(r'projects/repaido/secrets/[A-Za-z0-9_-]+/versions/[1-9][0-9]*', resource or ''):
        raise SetupError('Use one pinned numeric Secret Manager version in project repaido')
    return resource


def quota_binding(revision):
    env = environment(revision)
    if 'REPAIDO_BIKE_PROMO_QUOTA_SECRET_RESOURCE' in env:
        raise SetupError('The API has a worker-only quota resource setting; review its key identity before setup')
    entry = env.get('REPAIDO_BIKE_PROMO_QUOTA_SECRET')
    if not entry:
        return None
    reference = entry.get('valueFrom', {}).get('secretKeyRef')
    if not reference:
        raise SetupError('An inline API quota key already exists; migrate it securely without changing its bytes before this setup')
    aliases = dict(item.split(':', 1) for item in revision.get('metadata', {}).get('annotations', {}).get(
        'run.googleapis.com/secrets', '').split(',') if ':' in item)
    name = aliases.get(reference['name'], reference['name'])
    if '/' not in name:
        name = f'projects/{PROJECT}/secrets/{name}'
    return validate_secret(name + '/versions/' + str(reference['key']))


def check_subscription(subscription, topic=TOPIC):
    if subscription is None:
        return
    if subscription.get('topic') != topic or subscription.get('enableMessageOrdering') is not True:
        raise SetupError('Existing subscription has another topic or ordering disabled; never replace a live subscription')
    if subscription.get('deadLetterPolicy'):
        raise SetupError('Existing subscription discards ordered commands through a dead-letter policy; review it before adoption')
    if any(subscription.get(key) for key in ('pushConfig', 'bigqueryConfig', 'cloudStorageConfig', 'filter',
                                              'detached', 'enableExactlyOnceDelivery', 'retainAckedMessages')):
        raise SetupError('Existing subscription delivery/retention configuration differs; do not rewrite live semantics during adoption')
    expiry = subscription.get('expirationPolicy')
    if subscription.get('messageRetentionDuration') != '604800s' or not isinstance(expiry, dict) or expiry.get('ttl'):
        raise SetupError('Existing subscription must retain seven days without expiration; review its complete metadata before adoption')


READS = {
    'account': ('iam', 'service-accounts', 'describe', WORKER),
    'topic': ('pubsub', 'topics', 'describe', TOPIC),
    'subscription': ('pubsub', 'subscriptions', 'describe', SUBSCRIPTION),
    'network': ('compute', 'networks', 'describe', NAME+'-net'),
    'subnet': ('compute', 'networks', 'subnets', 'describe', NAME+'-subnet', '--region='+REGION),
    'firewall': ('compute', 'firewall-rules', 'describe', NAME+'-probes'),
    'health_check': ('compute', 'health-checks', 'describe', NAME+'-live', '--global'),
    'group': ('compute', 'instance-groups', 'managed', 'describe', NAME, '--region='+REGION),
}


def baseline(runner):
    service = runner.cloud('run', 'services', 'describe', SERVICE, '--region='+REGION)
    traffic = [row for row in service.get('status', {}).get('traffic', []) if row.get('percent', 0)]
    name = (traffic[0].get('revisionName') or service.get('status', {}).get('latestReadyRevisionName')) if len(traffic) == 1 else ''
    if not name:
        raise SetupError('Cannot identify a single serving API revision')
    revision = runner.cloud('run', 'revisions', 'describe', name, '--region='+REGION)
    return select_serving(service, revision), revision


def inventory(runner):
    serving, revision = baseline(runner)
    existing = {key: runner.cloud(*args, optional=True) for key, args in READS.items()}
    existing['autoscaler'] = runner.api_read('https://compute.googleapis.com/compute/v1/projects/repaido/regions/'+REGION+'/autoscalers/'+NAME+'-scale', optional=True)
    policies = [row for row in runner.monitoring_policies() if row.get('displayName') == 'Bike dispatch oldest unacknowledged event']
    if len(policies) > 1:
        raise SetupError('Multiple bike dispatch Monitoring alerts exist; resolve ownership before adoption')
    existing['alert'] = policies[0] if policies else None
    check_subscription(existing['subscription'])
    if existing['topic']:
        regions = existing['topic'].get('messageStoragePolicy', {}).get('allowedPersistenceRegions', [])
        if regions != [REGION]:
            raise SetupError('Existing topic regional storage policy differs; review before adoption')
    # All-network subnet inventory prevents silently introducing an overlapping CIDR.
    subnets = runner.cloud('compute', 'networks', 'subnets', 'list')
    for row in subnets:
        if row.get('name') == NAME+'-subnet':
            if row.get('ipCidrRange') != '10.73.0.0/24' or not row.get('privateIpGoogleAccess'):
                raise SetupError('Existing worker subnet has incompatible CIDR/private Google access')
            continue
        if row.get('ipCidrRange') and ipaddress.ip_network(row['ipCidrRange']).overlaps(ipaddress.ip_network('10.73.0.0/24')):
            raise SetupError('Worker subnet overlaps an existing project subnet; review addressing first')
    region = runner.cloud('compute', 'regions', 'describe', REGION)
    versions = quota_binding(revision)
    metadata = runner.cloud('secrets', 'versions', 'describe', versions, optional=False) if versions else None
    if metadata and metadata.get('state') != 'ENABLED':
        raise SetupError('The API quota key version is not enabled')
    work = {}
    for worker in ('repaido-work-api', 'repaido-work-worker'):
        value = runner.cloud('run', 'services', 'describe', worker, '--region='+REGION)
        work[worker] = {'traffic': value.get('status', {}).get('traffic', []),
                        'template_fingerprint': fingerprint(value.get('spec', {}).get('template', {}))}
    # Full service environment never enters returned/shared inventory.
    return {'schema_version': 1, 'project': PROJECT, 'region': REGION, 'baseline': serving,
            'quota_secret_version': versions, 'existing': existing, 'work_baselines': work,
            'quota_headroom': {row['metric']: row['limit']-row.get('usage', 0) for row in region.get('quotas', [])},
            'created_at': int(time.time())}


def summary(value):
    return {'project': PROJECT, 'region': REGION, 'baseline': value['baseline'],
            'quota_secret_version': value.get('quota_secret_version'),
            'resources_present': {key: bool(row) for key, row in value['existing'].items()},
            'quota_headroom': value['quota_headroom'], 'work_services': list(value['work_baselines'])}


def bootstrap(runner, args):
    # Establish serving API identity before enabling missing setup APIs. A full
    # inventory cannot succeed while those APIs are disabled; it runs afterward.
    serving, revision = baseline(runner)
    bucket = args.state_bucket
    if not re.fullmatch(r'repaido-[a-z0-9-]{3,50}', bucket or ''):
        raise SetupError('Use an explicit project-owned repaido-* Terraform state bucket name')
    # Reusing a previous API key is mandatory once configured; no implicit rotation.
    version = quota_binding(revision)
    selected = validate_secret(args.quota_secret_version) if args.quota_secret_version else None
    if version and selected and selected != version:
        raise SetupError('Refusing to change the existing API quota key during prerequisite setup')
    def record(phase):
        if getattr(args, 'record_file', None):
            write_json(args.record_file, {'project': PROJECT, 'state_bucket': bucket,
                'quota_secret_version': version, 'phase': phase, 'baseline': serving})
    record('bootstrap_started')
    runner.cloud('services', 'enable', 'compute.googleapis.com', 'pubsub.googleapis.com',
                 'secretmanager.googleapis.com', 'artifactregistry.googleapis.com', 'monitoring.googleapis.com',
                 'logging.googleapis.com', 'iam.googleapis.com')
    current = inventory(runner)
    if current['baseline'] != serving:
        raise SetupError('Serving API changed during prerequisite setup; restart from inventory')
    secret = runner.cloud('secrets', 'describe', QUOTA, optional=True)
    if not version and secret and not selected:
        raise SetupError('Quota secret already exists but API has no numeric binding; rerun with its reviewed --quota-secret-version, never create a replacement key blindly')
    if selected:
        if runner.cloud('secrets', 'versions', 'describe', selected).get('state') != 'ENABLED':
            raise SetupError('Selected quota secret version must be enabled')
        version = selected
    if not version:
        runner.cloud('secrets', 'create', QUOTA, '--replication-policy=automatic',
                     '--labels=repaido-component=bike-dispatch')
        # ASCII entropy goes through stdin only; no argument, local file or log.
        result = runner.cloud('secrets', 'versions', 'add', QUOTA, '--data-file=-',
                              data=secrets.token_urlsafe(48).encode())
        version = validate_secret(result['name'])
    record('quota_secret_ready')
    existing_bucket = runner.cloud('storage', 'buckets', 'describe', 'gs://'+bucket, optional=True)
    if existing_bucket is None:
        runner.cloud('storage', 'buckets', 'create', 'gs://'+bucket, '--location='+REGION,
                     '--uniform-bucket-level-access', '--public-access-prevention')
        runner.cloud('storage', 'buckets', 'update', 'gs://'+bucket, '--versioning')
    verified_bucket(runner, bucket)
    record('prerequisites_verified')
    print(json.dumps({'quota_secret_version': version, 'state_bucket': bucket,
                      'next': 'prepare with this numeric version; no API traffic or worker pool changed'}, indent=2))


def validate_bucket(value):
    iam = value.get('iamConfiguration') or value.get('iam_configuration') or {}
    uniform = iam.get('uniformBucketLevelAccess', {}).get('enabled') or value.get('uniform_bucket_level_access') is True
    prevention = iam.get('publicAccessPrevention') or value.get('public_access_prevention')
    versioning = value.get('versioning', {}).get('enabled') or value.get('versioning_enabled') is True
    if not uniform or prevention != 'enforced' or not versioning:
        raise SetupError('State bucket must enforce uniform access, public access prevention and versioning')
    number = value.get('projectNumber') or value.get('project_number')
    if str(number) != PROJECT_NUMBER:
        raise SetupError('State bucket ownership is not verified as the repaido project')


def verified_bucket(runner, bucket):
    # gcloud's transformed bucket DTO can omit projectNumber. Read the canonical
    # JSON API field before establishing ownership; never infer it from a name,
    # the current gcloud project, or the ability to read the bucket.
    if not re.fullmatch(r'repaido-[a-z0-9-]{3,50}', bucket or ''):
        raise SetupError('Use an explicit project-owned repaido-* Terraform state bucket name')
    value = runner.api_read('https://storage.googleapis.com/storage/v1/b/'+bucket+
                           '?fields=name,projectNumber,iamConfiguration,versioning')
    if not isinstance(value, dict) or value.get('name') != bucket:
        raise SetupError('State bucket identity could not be verified from canonical metadata')
    validate_bucket(value)
    return value


def source_hash(directory=ROOT):
    paths = sorted(path for path in Path(directory).rglob('*') if path.is_file() and
                   (path.suffix in {'.tf', '.tftpl'} or path.name in {'.terraform.lock.hcl', 'activate.py'}) and '.terraform' not in path.parts)
    return fingerprint({str(path.relative_to(directory)): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths})


IMPORTS = {'account': ('google_service_account.worker', f'projects/{PROJECT}/serviceAccounts/{WORKER}'),
           'topic': ('google_pubsub_topic.dispatch', TOPIC),
           'subscription': ('google_pubsub_subscription.dispatch', SUBSCRIPTION),
           'network': ('google_compute_network.workers', f'projects/{PROJECT}/global/networks/{NAME}-net'),
           'subnet': ('google_compute_subnetwork.workers', f'projects/{PROJECT}/regions/{REGION}/subnetworks/{NAME}-subnet'),
           'firewall': ('google_compute_firewall.probes', f'projects/{PROJECT}/global/firewalls/{NAME}-probes'),
           'health_check': ('google_compute_health_check.worker', f'projects/{PROJECT}/global/healthChecks/{NAME}-live'),
           'group': ('google_compute_region_instance_group_manager.workers', f'projects/{PROJECT}/regions/{REGION}/instanceGroupManagers/{NAME}'),
           'autoscaler': ('google_compute_region_autoscaler.workers', f'projects/{PROJECT}/regions/{REGION}/autoscalers/{NAME}-scale')}


def validate_plan(value):
    if value.get('errored'):
        raise SetupError('Terraform plan contains provider errors')
    for row in value.get('resource_changes', []):
        actions = row.get('change', {}).get('actions', [])
        if 'delete' in actions and not (row.get('address') == 'module.dispatch[0].google_compute_instance_template.worker' and actions == ['create', 'delete']):
            raise SetupError('Refusing Terraform deletion/replacement: '+row.get('address', 'unknown'))
        if row.get('mode') != 'data' and not row.get('address', '').startswith('module.dispatch[0].'):
            raise SetupError('Plan contains resources outside the dedicated bike module')


def owned_addresses(runner, directory, bucket):
    # Terraform state list exits nonzero for a brand-new backend. Confirm that
    # exact remote object is absent; never interpret an auth/CLI failure as empty.
    state = runner.cloud('storage', 'objects', 'describe', 'gs://'+bucket+'/bike-runtime/v1/default.tfstate', optional=True)
    if state is None:
        return set()
    return set(runner.tf(directory, 'state', 'list', raw=True).splitlines())


def prepare(runner, args):
    value = inventory(runner)
    version = validate_secret(args.quota_secret_version or value['quota_secret_version'])
    if value['quota_secret_version'] and version != value['quota_secret_version']:
        raise SetupError('Refusing to change the API quota identity key version during runtime activation')
    if runner.cloud('secrets', 'versions', 'describe', version).get('state') != 'ENABLED':
        raise SetupError('Selected quota secret version must already exist and be enabled')
    bucket = args.state_bucket
    if not re.fullmatch(r'repaido-[a-z0-9-]{3,50}', bucket or ''):
        raise SetupError('Choose an explicit repaido-* protected state bucket')
    verified_bucket(runner, bucket)
    if not 2 <= args.maximum_workers <= 16:
        raise SetupError('This launch helper caps steady worker count at 2-16; pilot default is2')
    current_workers = (value['existing'].get('group') or {}).get('targetSize', 0)
    if current_workers > args.maximum_workers:
        raise SetupError('Existing pool exceeds the selected pilot ceiling; review its scale-down separately')
    needed = max(0, args.maximum_workers+2-current_workers)
    for metric, required in [('CPUS', needed*2), ('E2_CPUS', needed*2), ('INSTANCES', needed), ('DISKS_TOTAL_GB', needed*20)]:
        if metric in value['quota_headroom'] and value['quota_headroom'][metric] < required:
            raise SetupError('Insufficient regional quota headroom for '+metric+' including rolling surge')
    directory = Path(args.directory).resolve()
    if directory.exists() or directory.is_relative_to(ROOT):
        raise SetupError('Use a new preparation directory; preserve previous release/rollback records')
    directory.mkdir(mode=0o700, parents=True)
    terraform = directory/'terraform'
    shutil.copytree(ROOT, terraform, ignore=shutil.ignore_patterns('.terraform', '__pycache__', '*.py', '*.md', 'test*'))
    (terraform/'backend.tf').write_text('terraform {\n  backend "gcs" {}\n}\n')
    inputs = {'enabled': True, 'project_id': PROJECT, 'region': REGION, 'zones': ['us-central1-a', 'us-central1-b'],
              'image': value['baseline']['image'], 'quota_secret_version': version,
              'minimum_workers': 2, 'maximum_workers': args.maximum_workers, 'events_per_worker': 32, 'alert_email': args.alert_email,
              'existing_notification_channels': (value['existing'].get('alert') or {}).get('notificationChannels', [])}
    write_json(terraform/'launch.auto.tfvars.json', inputs)
    runner.tf(terraform, 'init', '-input=false', '-lockfile=readonly', '-backend-config=bucket='+bucket,
              '-backend-config=prefix=bike-runtime/v1', raw=True)
    owned = owned_addresses(runner, terraform, bucket)
    adoption = [{'address': 'module.dispatch[0].'+address, 'id': resource}
                for key, (address, resource) in IMPORTS.items() if value['existing'][key] and 'module.dispatch[0].'+address not in owned]
    if value['existing'].get('alert') and 'module.dispatch[0].google_monitoring_alert_policy.age' not in owned:
        adoption.append({'address': 'module.dispatch[0].google_monitoring_alert_policy.age', 'id': value['existing']['alert']['name']})
    tag = 'bike-'+secrets.token_hex(4)
    manifest = {**value, 'quota_secret_version': version, 'source_hash': source_hash(), 'terraform_inputs': inputs,
                'tag': tag, 'state_bucket': bucket, 'adoption': adoption}
    write_json(directory/'manifest.json', manifest)
    if adoption:
        print(json.dumps({'status': 'adoption_required', 'directory': str(directory), 'resources': adoption,
                          'next': 'Review IDs then run adopt; no resource is recreated'}, indent=2))
        return
    save_plan(runner, directory, manifest)


def load(directory):
    directory = Path(directory).resolve()
    value = json.loads((directory/'manifest.json').read_text())
    if value.get('project') != PROJECT or value.get('region') != REGION or value.get('source_hash') != source_hash():
        raise SetupError('Preparation belongs to another project/source; prepare again from the reviewed checkout')
    validate_secret(value['quota_secret_version'])
    return directory, value


def save_plan(runner, directory, manifest):
    runner.tf(directory/'terraform', 'plan', '-input=false', '-out=launch.tfplan', raw=True)
    value = runner.tf(directory/'terraform', 'show', '-json', 'launch.tfplan')
    validate_plan(value)
    write_json(directory/'plan-summary.json', {'resource_changes': [
        {'address': row['address'], 'actions': row['change']['actions']}
        for row in value.get('resource_changes', []) if row.get('mode') != 'data']})
    # The summary is for navigation; operators review the complete saved diff.
    (directory/'plan.txt').write_text(runner.tf(directory/'terraform', 'show', '-no-color', 'launch.tfplan', raw=True))
    manifest['plan_sha256'] = hashlib.sha256((directory/'terraform/launch.tfplan').read_bytes()).hexdigest()
    write_json(directory/'manifest.json', manifest)
    print(json.dumps({'status': 'plan_ready', 'directory': str(directory),
                      'worker_bounds': [2, manifest['terraform_inputs']['maximum_workers']],
                      'rolling_surge': 2, 'review': str(directory/'plan.txt'),
                      'next': 'apply-infra applies only this saved non-destructive plan'}, indent=2))


def adopt(runner, args):
    directory, manifest = load(args.directory)
    current = inventory(runner)
    if current['baseline'] != manifest['baseline'] or current['existing'] != manifest['existing']:
        raise SetupError('Cloud resource inventory changed; prepare again before state adoption')
    owned = owned_addresses(runner, directory/'terraform', manifest['state_bucket'])
    for row in manifest['adoption']:
        if row['address'] not in owned:
            runner.tf(directory/'terraform', 'import', '-input=false', row['address'], row['id'], raw=True)
    manifest['adoption'] = []
    save_plan(runner, directory, manifest)


def apply_infra(runner, args):
    directory, manifest = load(args.directory)
    path = directory/'terraform/launch.tfplan'
    if manifest.get('adoption') or not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != manifest.get('plan_sha256'):
        raise SetupError('A complete unchanged saved Terraform plan is required')
    current = inventory(runner)
    if current['baseline'] != manifest['baseline'] or current['work_baselines'] != manifest['work_baselines']:
        raise SetupError('Another API/work deployment changed the release baseline; prepare again')
    if current['existing'] != manifest['existing']:
        raise SetupError('Infrastructure inventory changed after planning; prepare again rather than applying a stale resource diff')
    validate_plan(runner.tf(directory/'terraform', 'show', '-json', 'launch.tfplan'))
    runner.tf(directory/'terraform', 'apply', '-input=false', 'launch.tfplan', raw=True)
    write_json(directory/'infra-applied.json', {'at': int(time.time()), 'image': manifest['baseline']['image']})
    print('Worker infrastructure applied. API traffic and application launch policy were not changed.')


def candidate_command(manifest):
    resource = validate_secret(manifest['quota_secret_version'])
    secret, version = resource.split('/')[3], resource.split('/')[-1]
    return ['run', 'services', 'update', SERVICE, '--region='+REGION, '--image='+manifest['baseline']['image'],
            '--update-env-vars='+','.join(name+'='+value for name, value in ENVIRONMENT.items()),
            '--update-secrets=REPAIDO_BIKE_PROMO_QUOTA_SECRET='+secret+':'+version,
            '--no-traffic', '--tag='+manifest['tag']]


def get_json(url, path):
    if not RUN_URL.fullmatch(url):
        raise SetupError('Unexpected Cloud Run verification URL')
    request = urllib.request.Request(url+path, headers={'Cache-Control': 'no-cache'})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            value = json.load(response)
    except (OSError, ValueError):
        raise SetupError('Candidate endpoint could not be verified; preserve the candidate and retry verify') from None
    if not isinstance(value, dict):
        raise SetupError('Candidate endpoint returned an unexpected response')
    return value


def candidate(runner, args):
    directory, manifest = load(args.directory)
    if not (directory/'infra-applied.json').exists():
        raise SetupError('Apply and verify worker infrastructure before creating the API candidate')
    if (directory/'candidate.json').exists():
        raise SetupError('A candidate already exists in this directory; verify/promote it instead of redeploying')
    if (directory/'candidate-started.json').exists():
        raise SetupError('An earlier candidate request may have started. Run recover-candidate to inspect its recorded tag without redeploying')
    current = inventory(runner)
    if current['baseline'] != manifest['baseline'] or current['work_baselines'] != manifest['work_baselines']:
        raise SetupError('Serving baseline changed; prepare again before a configuration-only candidate')
    # Shared quota IAM only: existing API identity and all other settings remain.
    runner.cloud('secrets', 'add-iam-policy-binding', manifest['quota_secret_version'].split('/')[3],
                 '--member=serviceAccount:'+manifest['baseline']['service_account'], '--role=roles/secretmanager.secretAccessor')
    write_json(directory/'candidate-started.json', {'at': int(time.time()), 'tag': manifest['tag'],
        'image': manifest['baseline']['image'], 'baseline_revision': manifest['baseline']['revision']})
    service = runner.cloud(*candidate_command(manifest))
    tagged = next((row for row in service['status']['traffic'] if row.get('tag') == manifest['tag']), None)
    if not tagged:
        raise SetupError('Candidate tag missing; preserve records and inspect Cloud Run before retrying')
    record = {'revision': tagged['revisionName'], 'url': tagged['url'], 'created_at': int(time.time())}
    write_json(directory/'candidate.json', record)
    verify_candidate(runner, directory, manifest, record)
    print('Configuration-only candidate verified without production traffic. Run promote to publish its API configuration.')


def recover_candidate(runner, args):
    """Recover only release records after an ambiguous Cloud Run update result."""
    directory, manifest = load(args.directory)
    if not (directory/'candidate-started.json').exists():
        raise SetupError('No recorded candidate request exists; do not infer ownership of another revision')
    service = runner.cloud('run', 'services', 'describe', SERVICE, '--region='+REGION)
    traffic = service.get('status', {}).get('traffic', [])
    live = [row for row in traffic if row.get('percent', 0)]
    if len(live) != 1 or live[0].get('percent') != 100 or live[0].get('revisionName') != manifest['baseline']['revision']:
        raise SetupError('Production traffic changed; recovery cannot verify a zero-traffic candidate')
    tagged = [row for row in traffic if row.get('tag') == manifest['tag']]
    if len(tagged) != 1 or tagged[0].get('percent', 0) or not tagged[0].get('revisionName') or not RUN_URL.fullmatch(tagged[0].get('url', '')):
        raise SetupError('The recorded candidate tag is missing or not a valid zero-traffic revision; inspect Cloud Run without retrying deployment')
    record = {'revision': tagged[0]['revisionName'], 'url': tagged[0]['url'], 'created_at': int(time.time())}
    path = directory/'candidate.json'
    if path.exists():
        previous = json.loads(path.read_text())
        if previous.get('revision') != record['revision'] or previous.get('url') != record['url']:
            raise SetupError('Candidate records disagree with the current tag; review ownership before proceeding')
    # Verify source, secret version and preserved settings before accepting a
    # provider response into the release record. This function never deploys.
    verify_candidate(runner, directory, manifest, record)
    write_json(path, record)
    print('Existing zero-traffic candidate recovered and verified; no cloud settings were changed.')


def other_secret_bindings(revision):
    aliases = dict(item.split(':', 1) for item in revision.get('metadata', {}).get('annotations', {}).get(
        'run.googleapis.com/secrets', '').split(',') if ':' in item)
    result = {}
    for name, entry in environment(revision).items():
        reference = entry.get('valueFrom', {}).get('secretKeyRef')
        if reference and name != 'REPAIDO_BIKE_PROMO_QUOTA_SECRET':
            result[name] = (aliases.get(reference['name'], reference['name']), reference['key'])
    return result


def verify_candidate(runner, directory, manifest, record):
    revision = runner.cloud('run', 'revisions', 'describe', record['revision'], '--region='+REGION)
    if digest_image(revision) != manifest['baseline']['image']:
        raise SetupError('Candidate image differs from the reviewed deployed digest')
    if quota_binding(revision) != manifest['quota_secret_version']:
        raise SetupError('Candidate API quota secret version differs from worker configuration')
    spec = revision['spec']; env = environment(revision)
    if any(env.get(key, {}).get('value') != value for key, value in ENVIRONMENT.items()):
        raise SetupError('Candidate dispatch configuration does not match the worker')
    # Reconstruct old spec by removing only permitted changes; detect accidental
    # identity, container args, unrelated secrets, resource or networking drift.
    old_revision = runner.cloud('run', 'revisions', 'describe', manifest['baseline']['revision'], '--region='+REGION)
    if other_secret_bindings(old_revision) != other_secret_bindings(revision):
        raise SetupError('Unrelated API secret aliases changed; do not promote the candidate')
    old_spec = json.loads(json.dumps(old_revision['spec']))
    new_spec = json.loads(json.dumps(spec))
    for item in (old_spec, new_spec):
        item['containers'][0]['image'] = manifest['baseline']['image']
        item['containers'][0]['env'] = sorted((row for row in item['containers'][0].get('env', [])
            if row['name'] not in ENVIRONMENT and row['name'] != 'REPAIDO_BIKE_PROMO_QUOTA_SECRET'), key=lambda row: row['name'])
    if old_spec != new_spec:
        raise SetupError('Unrelated API runtime settings changed; do not promote the candidate')
    old_annotations = old_revision.get('metadata', {}).get('annotations', {})
    new_annotations = revision.get('metadata', {}).get('annotations', {})
    if any(old_annotations.get(key) != new_annotations.get(key) for key in RUNTIME_ANNOTATIONS):
        raise SetupError('API networking, scaling or execution annotations changed; do not promote')
    health = get_json(record['url'], '/api/health')
    policy = get_json(record['url'], '/api/operations/bike-rides/policy')
    if health.get('build_id') != manifest['baseline']['build_id'] or health.get('status') != 'ok':
        raise SetupError('Candidate health/build ID changed')
    if not all(policy.get(key) is True for key in ('dispatch_ready', 'promo_identity_ready', 'routing_ready')):
        raise SetupError('Worker, pinned quota key or route provider is not ready; candidate keeps zero traffic')
    write_json(directory/'candidate-verified.json', {'at': int(time.time()), 'revision': record['revision'],
        'dispatch_ready': True, 'bookings_available': policy.get('bookings_available') is True})


def verify_pool(runner, manifest):
    group = runner.cloud('compute', 'instance-groups', 'managed', 'describe', NAME, '--region='+REGION)
    target = group.get('targetSize', 0)
    if not 2 <= target <= manifest['terraform_inputs']['maximum_workers'] or not group.get('status', {}).get('isStable'):
        raise SetupError('Worker group is not stable within the reviewed two-zone capacity bounds')
    rows = runner.cloud('compute', 'instance-groups', 'managed', 'list-instances', NAME, '--region='+REGION)
    zones, healthy = set(), 0
    for row in rows:
        health = row.get('instanceHealth', [])
        if row.get('instanceStatus') == 'RUNNING' and row.get('currentAction') == 'NONE' and any(
                entry.get('detailedHealthState') == 'HEALTHY' for entry in health):
            match = re.search(r'/zones/([^/]+)/instances/', row.get('instance', ''))
            if match:
                zones.add(match[1]); healthy += 1
    if healthy < 2 or not {'us-central1-a', 'us-central1-b'} <= zones:
        raise SetupError('Wait for healthy private workers in both reviewed zones before API promotion')
    templates = {entry.get('instanceTemplate', '').rsplit('/', 1)[-1] for entry in group.get('versions', [])}
    if len(templates) != 1 or not next(iter(templates), ''):
        raise SetupError('Worker group must use one reviewed instance template after its rollout')
    template = runner.cloud('compute', 'instance-templates', 'describe', next(iter(templates)))
    properties = template.get('properties', {})
    interfaces = properties.get('networkInterfaces', [])
    accounts = properties.get('serviceAccounts', [])
    script = next((item.get('value', '') for item in properties.get('metadata', {}).get('items', []) if item.get('key') == 'startup-script'), '')
    if (len(interfaces) != 1 or interfaces[0].get('accessConfigs') or
            not interfaces[0].get('subnetwork', '').endswith('/subnetworks/'+NAME+'-subnet') or
            len(accounts) != 1 or accounts[0].get('email') != WORKER or
            manifest['baseline']['image'] not in script or manifest['quota_secret_version'] not in script):
        raise SetupError('Actual worker template differs from the reviewed private image/identity/quota setup')


def check_candidate_service(service, manifest, record, serving_revision):
    status = service.get('status', {})
    generation = service.get('metadata', {}).get('generation')
    if generation is None or str(generation) != str(status.get('observedGeneration')) or not any(
            row.get('type') == 'Ready' and row.get('status') in ('True', True) for row in status.get('conditions', [])):
        raise SetupError('API service has a pending or unready update; preserve the release records')
    if status.get('latestCreatedRevisionName') != record['revision'] or status.get('latestReadyRevisionName') != record['revision']:
        raise SetupError('A different API candidate exists; do not override another release')
    traffic = status.get('traffic', [])
    live = [row for row in traffic if row.get('percent', 0)]
    if len(live) != 1 or live[0].get('percent') != 100 or live[0].get('revisionName') != serving_revision:
        raise SetupError('API traffic does not point entirely at the expected revision; preserve the release records')
    tags = [row for row in traffic if row.get('tag') == manifest['tag']]
    if len(tags) != 1 or tags[0].get('revisionName') != record['revision'] or tags[0].get('url') != record['url']:
        raise SetupError('Recorded candidate tag ownership changed; inspect Cloud Run before proceeding')


def check_work_baselines(runner, manifest):
    for worker, baseline in manifest['work_baselines'].items():
        current = runner.cloud('run', 'services', 'describe', worker, '--region='+REGION)
        if fingerprint(current.get('spec', {}).get('template', {})) != baseline['template_fingerprint'] or current['status']['traffic'] != baseline['traffic']:
            raise SetupError('An unrelated work service changed; preserve it and prepare again')


def record_promotion(runner, directory, manifest, record):
    # The build intentionally stays the same, so build_id alone cannot establish
    # promotion. Require the provider's exact reconciled revision traffic first.
    service = runner.cloud('run', 'services', 'describe', SERVICE, '--region='+REGION)
    check_candidate_service(service, manifest, record, record['revision'])
    health = get_json(manifest['baseline']['url'], '/api/health')
    policy = get_json(manifest['baseline']['url'], '/api/operations/bike-rides/policy')
    if health.get('build_id') != manifest['baseline']['build_id'] or health.get('status') != 'ok' or not all(
            policy.get(key) is True for key in ('dispatch_ready', 'promo_identity_ready', 'routing_ready')):
        raise SetupError('Live API configuration is not ready; preserve records and inspect before rollback or recovery')
    write_json(directory/'promoted.json', {'at': int(time.time()), 'revision': record['revision'],
        'rollback_revision': manifest['baseline']['revision'], 'bookings_available': policy.get('bookings_available') is True})


def promote(runner, args):
    directory, manifest = load(args.directory)
    record = json.loads((directory/'candidate.json').read_text())
    service = runner.cloud('run', 'services', 'describe', SERVICE, '--region='+REGION)
    check_candidate_service(service, manifest, record, manifest['baseline']['revision'])
    check_work_baselines(runner, manifest)
    verify_pool(runner, manifest)
    verify_candidate(runner, directory, manifest, record)
    write_json(directory/'promotion-started.json', {'at': int(time.time()), 'revision': record['revision'],
        'baseline_revision': manifest['baseline']['revision']})
    runner.cloud('run', 'services', 'update-traffic', SERVICE, '--region='+REGION,
                 '--to-revisions='+record['revision']+'=100')
    record_promotion(runner, directory, manifest, record)
    print('API configuration promoted from the existing digest. Rider approvals, payroll/funding and launch policy remain operator-controlled.')


def recover_promotion(runner, args):
    directory, manifest = load(args.directory)
    if not (directory/'promotion-started.json').exists():
        raise SetupError('No recorded promotion request exists; inspect release ownership first')
    record = json.loads((directory/'candidate.json').read_text())
    check_work_baselines(runner, manifest)
    verify_pool(runner, manifest)
    verify_candidate(runner, directory, manifest, record)
    record_promotion(runner, directory, manifest, record)
    print('Existing promotion verified and its receipt recovered; no cloud settings were changed.')


def verify(runner, args):
    directory, manifest = load(args.directory)
    record = json.loads((directory/'candidate.json').read_text())
    verify_candidate(runner, directory, manifest, record)
    print('Existing zero-traffic candidate verified; no service configuration was changed.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('inventory')
    bootstrap_parser = commands.add_parser('bootstrap')
    bootstrap_parser.add_argument('--state-bucket', required=True)
    bootstrap_parser.add_argument('--quota-secret-version')
    bootstrap_parser.add_argument('--record-file', help='Private metadata-only progress receipt for interrupted setup.')
    prepare_parser = commands.add_parser('prepare')
    prepare_parser.add_argument('--state-bucket', required=True)
    prepare_parser.add_argument('--quota-secret-version')
    prepare_parser.add_argument('--maximum-workers', type=int, default=2)
    prepare_parser.add_argument('--alert-email', default='')
    prepare_parser.add_argument('--directory', required=True)
    for name in ('adopt', 'apply-infra', 'candidate', 'recover-candidate', 'verify', 'promote', 'recover-promotion'):
        commands.add_parser(name).add_argument('--directory', required=True)
    args = parser.parse_args()
    runner = Runner()
    try:
        if args.command == 'inventory':
            print(json.dumps(summary(inventory(runner)), indent=2, sort_keys=True))
        else:
            {'bootstrap': bootstrap, 'prepare': prepare, 'adopt': adopt,
             'apply-infra': apply_infra, 'candidate': candidate, 'recover-candidate': recover_candidate,
             'verify': verify, 'promote': promote, 'recover-promotion': recover_promotion}[args.command](runner, args)
    except SetupError as error:
        print('STOP: '+str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
