"""Offline safety checks for bike Cloud Shell activation; no provider calls."""
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parent
REPOSITORY = 'us-central1-docker.pkg.dev/repaido/cloud-run-source-deploy/repaido-api'
DIGEST = REPOSITORY + '@sha256:' + 'a' * 64
REVISION = 'repaido-api-00073-review'
SECRET = 'projects/repaido/secrets/repaido-bike-promo-quota/versions/3'
TOPIC = 'projects/repaido/topics/repaido-bike-dispatch-v1'


@pytest.fixture(scope='module')
def activation():
    spec = importlib.util.spec_from_file_location('repaido_bike_activation', ROOT / 'activate.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def revision():
    return {
        'metadata': {'name': REVISION},
        'spec': {'serviceAccountName': 'runtime@repaido.iam.gserviceaccount.com',
                 'containers': [{'image': REPOSITORY + ':reviewed-build', 'env': [
                     {'name': 'REPAIDO_BUILD_ID', 'value': 'fixture-reviewed-build'},
                     {'name': 'REPAIDO_STORAGE', 'value': 'firestore'},
                     {'name': 'EXISTING_OTHER_SETTING', 'value': 'preserve-me'},
                     {'name': 'EXISTING_SECRET', 'valueFrom': {'secretKeyRef': {'name': 'other-secret', 'key': '7'}}}]}]},
        'status': {'imageDigest': DIGEST}}


@pytest.fixture
def service():
    return {
        'metadata': {'name': 'repaido-api', 'generation': 3},
        'status': {'url': 'https://repaido-api-133610574058.us-central1.run.app',
                   'observedGeneration': 3, 'conditions': [{'type': 'Ready', 'status': 'True'}],
                   'latestReadyRevisionName': REVISION, 'latestCreatedRevisionName': REVISION,
                   'traffic': [{'revisionName': REVISION, 'percent': 100},
                               {'revisionName': 'old-zero-traffic-tag', 'percent': 0, 'tag': 'old-tag'}]}}


def test_exact_serving_revision_selects_existing_digest_and_identity(activation, service, revision):
    selected = activation.select_serving(service, revision)
    assert selected['revision'] == REVISION
    assert selected['image'] == DIGEST
    assert selected['service_account'] == 'runtime@repaido.iam.gserviceaccount.com'
    assert selected['build_id'] == 'fixture-reviewed-build'
    assert selected['url'] == service['status']['url']
    assert selected['environment_fingerprint']


def test_metadata_receipt_replacement_is_private_complete_and_leaves_no_partial_file(activation,tmp_path):
    path=tmp_path/'nested'/'manifest.json'
    activation.write_json(path,{'phase':'first'})
    activation.write_json(path,{'phase':'complete','key_reference':SECRET})
    assert json.loads(path.read_text())=={'phase':'complete','key_reference':SECRET}
    assert path.stat().st_mode & 0o777 == 0o600
    assert list(path.parent.glob('*.tmp'))==[]


def test_interrupted_metadata_replacement_preserves_previous_valid_receipt(activation,tmp_path,monkeypatch):
    path=tmp_path/'manifest.json'
    activation.write_json(path,{'phase':'previous'})
    def interrupt(*args): raise OSError('simulated interrupted replacement')
    monkeypatch.setattr(activation.os,'replace',interrupt)
    with pytest.raises(OSError):activation.write_json(path,{'phase':'next'})
    assert json.loads(path.read_text())=={'phase':'previous'}
    assert list(tmp_path.glob('*.tmp'))==[]


def test_invalid_metadata_cannot_truncate_previous_checkpoint(activation,tmp_path):
    path=tmp_path/'manifest.json'
    activation.write_json(path,{'phase':'previous'})
    with pytest.raises(ValueError):activation.write_json(path,{'invalid':float('nan')})
    assert json.loads(path.read_text())=={'phase':'previous'}


@pytest.fixture
def prepared_configuration(activation, tmp_path, monkeypatch):
    inventory = {'baseline': {'image': DIGEST}, 'quota_secret_version': None,
                 'existing': dict.fromkeys(activation.IMPORTS), 'quota_headroom': {}}
    monkeypatch.setattr(activation, 'inventory', lambda runner: copy.deepcopy(inventory))
    monkeypatch.setattr(activation, 'verified_bucket', lambda runner, bucket: None)
    monkeypatch.setattr(activation, 'owned_addresses', lambda *args: set())
    monkeypatch.setattr(activation, 'save_plan', lambda *args: None)
    calls = []

    class Provider:
        def cloud(self, *args, **kwargs):
            assert args == ('secrets', 'versions', 'describe', SECRET)
            return {'state': 'ENABLED'}

        def tf(self, directory, *args, **kwargs):
            # Only initialization is authorized during this preparation fixture.
            assert args == ('init', '-input=false', '-lockfile=readonly',
                            '-backend-config=bucket=repaido-fixture-state',
                            '-backend-config=prefix=bike-runtime/v1')
            calls.append(Path(directory))
            return ''

    directory = tmp_path/'release'
    activation.prepare(Provider(), SimpleNamespace(
        directory=str(directory), state_bucket='repaido-fixture-state',
        quota_secret_version=SECRET, maximum_workers=2, alert_email=''))
    assert calls == [directory/'terraform']
    return directory/'terraform'


def test_prepare_preserves_reviewed_image_key_and_provider_lock(prepared_configuration):
    inputs = json.loads((prepared_configuration/'launch.auto.tfvars.json').read_text())
    assert inputs['image'] == DIGEST
    assert inputs['quota_secret_version'] == SECRET
    assert (inputs['minimum_workers'], inputs['maximum_workers']) == (2, 2)
    assert (prepared_configuration/'.terraform.lock.hcl').read_bytes() == (ROOT/'.terraform.lock.hcl').read_bytes()


def test_generated_backend_is_accepted_by_real_terraform_parser(prepared_configuration):
    binary = os.environ.get('REPAIDO_TEST_TERRAFORM')
    if not binary:
        pytest.skip('Set REPAIDO_TEST_TERRAFORM to run the generated HCL through Terraform')
    # fmt parses the actual file produced by prepare, without accessing a cloud
    # backend or installing providers. It rejects nested blocks on one line.
    result = subprocess.run([binary, 'fmt', '-check', '-no-color', 'backend.tf'],
                            cwd=prepared_configuration, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout+result.stderr


@pytest.mark.parametrize('traffic', [
    [], [{'revisionName': REVISION, 'percent': 50}, {'revisionName': 'another', 'percent': 50}],
    [{'revisionName': 'another', 'percent': 100}],
    [{'revisionName': REVISION, 'percent': 99}],
])
def test_serving_revision_selection_rejects_mixed_unknown_or_partial_traffic(activation, service, revision, traffic):
    service['status']['traffic'] = traffic
    with pytest.raises(Exception):
        activation.select_serving(service, revision)


@pytest.mark.parametrize('field', ['latestReadyRevisionName', 'latestCreatedRevisionName'])
def test_unserved_new_template_cannot_be_inherited_by_configuration_rollout(activation, service, revision, field):
    service['status'][field] = 'unserved-new-candidate'
    with pytest.raises(Exception):
        activation.select_serving(service, revision)


def test_inflight_service_generation_is_not_inherited_by_configuration_rollout(activation, service, revision):
    service['metadata']['generation'] = 4
    with pytest.raises(Exception):
        activation.select_serving(service, revision)


def test_service_must_be_reconciled_ready_before_configuration_rollout(activation, service, revision):
    service['status']['conditions'][0]['status'] = 'Unknown'
    with pytest.raises(Exception):
        activation.select_serving(service, revision)


def test_digest_can_be_qualified_only_from_validated_existing_repository(activation, revision):
    revision['status']['imageDigest'] = 'sha256:' + 'b' * 64
    assert activation.digest_image(revision) == REPOSITORY + '@sha256:' + 'b' * 64
    revision['spec']['containers'][0]['image'] = 'us-central1-docker.pkg.dev/another-project/backend/api:tag'
    with pytest.raises(Exception):
        activation.digest_image(revision)


@pytest.mark.parametrize('image', [
    REPOSITORY + ':latest',
    'us-central1-docker.pkg.dev/another-project/backend/api@sha256:' + 'a' * 64,
    'https://registry.example/api@sha256:' + 'a' * 64,
    DIGEST + '?credential=forbidden',
    'sha256:' + 'a' * 63,
])
def test_invalid_or_mutable_status_image_digest_is_rejected(activation, revision, image):
    revision['status']['imageDigest'] = image
    with pytest.raises(Exception):
        activation.digest_image(revision)


def test_quota_secret_requires_same_project_and_numeric_stable_version(activation):
    assert activation.validate_secret(SECRET) == SECRET


@pytest.mark.parametrize('resource', [
    SECRET.replace('/3', '/latest'), SECRET.replace('/3', '/0'),
    SECRET.replace('/repaido/', '/other-project/'), SECRET + ':access',
    'repaido-bike-promo-quota:3', '',
])
def test_invalid_quota_version_cannot_rekey_the_promotion_identity(activation, resource):
    with pytest.raises(Exception):
        activation.validate_secret(resource)


def test_quota_binding_resolves_cloud_run_alias_and_keeps_numeric_version(activation, revision):
    revision['metadata']['annotations'] = {
        'run.googleapis.com/secrets': 'quota-alias:projects/repaido/secrets/repaido-bike-promo-quota'}
    revision['spec']['containers'][0]['env'].append({
        'name': 'REPAIDO_BIKE_PROMO_QUOTA_SECRET',
        'valueFrom': {'secretKeyRef': {'name': 'quota-alias', 'key': '3'}}})
    assert activation.quota_binding(revision) == SECRET


def test_quota_binding_accepts_only_the_known_numeric_project_alias(activation, revision):
    revision['metadata']['annotations'] = {
        'run.googleapis.com/secrets': 'quota-alias:projects/133610574058/secrets/repaido-bike-promo-quota'}
    revision['spec']['containers'][0]['env'].append({
        'name': 'REPAIDO_BIKE_PROMO_QUOTA_SECRET',
        'valueFrom': {'secretKeyRef': {'name': 'quota-alias', 'key': '3'}}})
    assert activation.quota_binding(revision) == SECRET
    revision['metadata']['annotations']['run.googleapis.com/secrets'] = (
        'quota-alias:projects/999999999999/secrets/repaido-bike-promo-quota')
    with pytest.raises(activation.SetupError):
        activation.quota_binding(revision)


def test_existing_inline_quota_key_is_not_silently_rotated_or_printed(activation, revision):
    secret = 'fixture-private-inline-value-do-not-log'
    revision['spec']['containers'][0]['env'].append({'name': 'REPAIDO_BIKE_PROMO_QUOTA_SECRET', 'value': secret})
    with pytest.raises(activation.SetupError) as error:
        activation.quota_binding(revision)
    assert secret not in str(error.value)


def subscription(**changes):
    return {'name': 'projects/repaido/subscriptions/repaido-bike-dispatch-worker-v1',
            'topic': TOPIC, 'enableMessageOrdering': True,
            'messageRetentionDuration': '604800s', 'expirationPolicy': {}, **changes}


def test_existing_matching_ordered_subscription_can_be_adopted(activation):
    activation.check_subscription(subscription(), TOPIC)


@pytest.mark.parametrize('changes', [
    {'enableMessageOrdering': False}, {'topic': TOPIC + '-unrelated'},
    {'deadLetterPolicy': {'deadLetterTopic': TOPIC + '-discard', 'maxDeliveryAttempts': 5}},
])
def test_conflicting_subscription_is_not_silently_replaced_or_purged(activation, changes):
    with pytest.raises(Exception):
        activation.check_subscription(subscription(**changes), TOPIC)


@pytest.mark.parametrize('changes', [
    {'pushConfig': {'pushEndpoint': 'https://existing-delivery.example/event'}},
    {'bigqueryConfig': {'table': 'repaido.existing.events'}},
    {'cloudStorageConfig': {'bucket': 'existing-delivery'}},
    {'filter': 'attributes.existing = "retained"'},
    {'detached': True}, {'enableExactlyOnceDelivery': True}, {'retainAckedMessages': True},
    {'expirationPolicy': {'ttl': '2678400s'}},
    {'messageRetentionDuration': '86400s'},
])
def test_adoption_cannot_rewrite_existing_delivery_or_retention_semantics(activation, changes):
    with pytest.raises(activation.SetupError):
        activation.check_subscription(subscription(**changes), TOPIC)


def test_subscription_adoption_needs_observed_seven_day_retention(activation):
    value = subscription()
    del value['messageRetentionDuration']
    with pytest.raises(activation.SetupError):
        activation.check_subscription(value, TOPIC)


def test_subscription_adoption_needs_explicit_no_expiration_metadata(activation):
    value = subscription()
    del value['expirationPolicy']
    with pytest.raises(activation.SetupError):
        activation.check_subscription(value, TOPIC)


def change(address, actions):
    return {'address': address, 'change': {'actions': actions}}


def test_plan_allows_additive_setup_and_reviewed_create_before_destroy_template(activation):
    activation.validate_plan({'resource_changes': [
        change('module.dispatch[0].google_pubsub_topic.dispatch', ['create']),
        change('module.dispatch[0].google_compute_instance_template.worker', ['create', 'delete']),
        change('module.dispatch[0].google_compute_region_instance_group_manager.workers', ['update']),
    ]})


@pytest.mark.parametrize('address,actions', [
    ('module.dispatch[0].google_pubsub_subscription.dispatch', ['delete', 'create']),
    ('module.dispatch[0].google_compute_network.workers', ['delete']),
    ('module.dispatch[0].google_compute_region_instance_group_manager.workers', ['create', 'delete']),
    ('google_secret_manager_secret.unrelated', ['delete']),
])
def test_plan_rejects_deleting_or_replacing_durable_or_unrelated_resources(activation, address, actions):
    with pytest.raises(Exception):
        activation.validate_plan({'resource_changes': [change(address, actions)]})


def test_environment_fingerprint_detects_existing_env_or_secret_reference_drift(activation, service, revision):
    selected = activation.select_serving(service, revision)
    changed = copy.deepcopy(revision)
    changed['spec']['containers'][0]['env'][2]['value'] = 'unexpected-drift'
    assert activation.select_serving(service, changed)['environment_fingerprint'] != selected['environment_fingerprint']
    changed = copy.deepcopy(revision)
    changed['spec']['containers'][0]['env'][3]['valueFrom']['secretKeyRef']['key'] = '8'
    assert activation.select_serving(service, changed)['environment_fingerprint'] != selected['environment_fingerprint']


def test_candidate_command_updates_only_bike_configuration_from_pinned_existing_image(activation):
    manifest = {'baseline': {'image': DIGEST}, 'quota_secret_version': SECRET, 'tag': 'bike-fixture'}
    args = activation.candidate_command(manifest)
    assert args[:4] == ['run', 'services', 'update', 'repaido-api']
    assert '--image='+DIGEST in args and '--no-traffic' in args and '--tag=bike-fixture' in args
    assert '--update-secrets=REPAIDO_BIKE_PROMO_QUOTA_SECRET=repaido-bike-promo-quota:3' in args
    assert not any(value.startswith(('--set-env-vars=', '--set-secrets=', '--service-account=', '--clear-')) for value in args)
    updates = next(value.split('=', 1)[1] for value in args if value.startswith('--update-env-vars='))
    assert dict(value.split('=', 1) for value in updates.split(',')) == activation.ENVIRONMENT


def test_runner_provider_failure_does_not_echo_stderr_secrets(activation, monkeypatch):
    class Failed:
        returncode = 1
        stdout = b''
        stderr = b'PERMISSION_DENIED with private-token fixture-private-value'
    monkeypatch.setattr(activation.subprocess, 'run', lambda *args, **kwargs: Failed())
    with pytest.raises(activation.SetupError) as error:
        activation.Runner().cloud('secrets', 'describe', 'fixture')
    assert 'fixture-private-value' not in str(error.value)


@pytest.mark.parametrize('missing', [b'NOT_FOUND: resource does not exist',
    b'HTTPError 404: No such object: repaido-state/bike-runtime/v1/default.tfstate'])
def test_runner_optional_missing_resource_is_distinct_from_denied_read(activation, monkeypatch, missing):
    class Failed:
        returncode = 1
        stdout = b''
        stderr = missing
    monkeypatch.setattr(activation.subprocess, 'run', lambda *args, **kwargs: Failed())
    assert activation.Runner().cloud('pubsub', 'topics', 'describe', TOPIC, optional=True) is None
    Failed.stderr = b'PERMISSION_DENIED: Not found or not allowed'
    with pytest.raises(activation.SetupError):
        activation.Runner().cloud('pubsub', 'topics', 'describe', TOPIC, optional=True)


def test_runner_secret_data_uses_stdin_and_json_output_only(activation, monkeypatch):
    calls = []
    class Success:
        returncode = 0
        stdout = json.dumps({'name': SECRET}).encode()
        stderr = b''
    def capture(args, **kwargs):
        calls.append((args, kwargs))
        return Success()
    monkeypatch.setattr(activation.subprocess, 'run', capture)
    secret = b'fixture-private-secret-bytes'
    result = activation.Runner().cloud('secrets', 'versions', 'add', 'fixture', '--data-file=-', data=secret)
    assert result == {'name': SECRET}
    assert calls[0][1]['input'] == secret
    assert not any(secret.decode() in item for item in calls[0][0])


@pytest.mark.parametrize('flags', [(), ('--billing-project=repaido',),
    ('--billing-project', 'repaido'),
    ('--billing-project=repaido', '--billing-project', 'repaido')])
def test_runner_pins_exactly_one_quota_project_preserving_payload_and_operator_environment(
        activation, monkeypatch, flags):
    calls = []
    monkeypatch.setenv('CLOUDSDK_BILLING_QUOTA_PROJECT', 'unrelated-inherited-default')
    def capture(self, args, **kwargs):
        calls.append((args, kwargs))
        return {'ok': True}
    monkeypatch.setattr(activation.Runner, 'run', capture)
    payload = b'fixture-secret-in-stdin-only'
    assert activation.Runner().cloud('secrets', 'versions', 'add', 'fixture',
        '--data-file=-', *flags, data=payload, optional=True) == {'ok': True}
    args, kwargs = calls[0]
    assert args == ['gcloud', 'secrets', 'versions', 'add', 'fixture', '--data-file=-',
                    '--project=repaido', '--billing-project=repaido', '--quiet', '--format=json']
    assert kwargs == {'optional': True, 'data': payload}
    assert activation.os.environ['CLOUDSDK_BILLING_QUOTA_PROJECT'] == 'unrelated-inherited-default'


@pytest.mark.parametrize('flags', [('--billing-project=another-project',),
    ('--billing-project', 'another-project'), ('--billing-project',),
    ('--billing-project=',), ('--billing-project=repaido', '--billing-project=another-project')])
def test_runner_rejects_conflicting_or_missing_quota_project_before_any_provider_call(
        activation, monkeypatch, flags):
    monkeypatch.setattr(activation.Runner, 'run', lambda *args, **kwargs: pytest.fail('No provider call allowed'))
    with pytest.raises(activation.SetupError, match='requires repaido as its quota project'):
        activation.Runner().cloud('pubsub', 'topics', 'describe', TOPIC, *flags)


def candidate_fixture(activation, service, revision):
    manifest = {'baseline': activation.select_serving(service, revision),
                'quota_secret_version': SECRET, 'tag': 'bike-fixture'}
    candidate = copy.deepcopy(revision)
    candidate['metadata']['name'] = 'repaido-api-00074-bike'
    candidate['spec']['containers'][0]['image'] = DIGEST
    env = {row['name']: row for row in candidate['spec']['containers'][0]['env']}
    env.update({name: {'name': name, 'value': value} for name, value in activation.ENVIRONMENT.items()})
    env['REPAIDO_BIKE_PROMO_QUOTA_SECRET'] = {
        'name': 'REPAIDO_BIKE_PROMO_QUOTA_SECRET',
        'valueFrom': {'secretKeyRef': {'name': 'repaido-bike-promo-quota', 'key': '3'}}}
    candidate['spec']['containers'][0]['env'] = list(env.values())
    record = {'revision': candidate['metadata']['name'],
              'url': 'https://bike-fixture---repaido-api-133610574058.us-central1.run.app'}
    class Provider:
        def __init__(self): self.calls = []
        def cloud(self, *args, **kwargs):
            self.calls.append(args)
            assert args[:3] == ('run', 'revisions', 'describe')
            if args[3] == record['revision']:
                return candidate
            assert args[3] == REVISION
            return revision
    return Provider(), manifest, candidate, record


def healthy_responses(activation, monkeypatch, *, dispatch_ready=True):
    def response(url, path):
        if path.endswith('/health'):
            return {'build_id': 'fixture-reviewed-build', 'status': 'ok'}
        assert path.endswith('/operations/bike-rides/policy')
        return {'dispatch_ready': dispatch_ready, 'promo_identity_ready': True,
                'routing_ready': True, 'bookings_available': False}
    monkeypatch.setattr(activation, 'get_json', response)


def test_candidate_verification_preserves_other_configuration_and_does_not_invent_launch_readiness(
        activation, service, revision, monkeypatch, tmp_path):
    provider, manifest, candidate, record = candidate_fixture(activation, service, revision)
    healthy_responses(activation, monkeypatch)
    activation.verify_candidate(provider, tmp_path, manifest, record)
    saved = json.loads((tmp_path/'candidate-verified.json').read_text())
    assert saved['dispatch_ready'] is True
    assert saved['bookings_available'] is False
    assert all(args[:3] == ('run', 'revisions', 'describe') for args in provider.calls)


@pytest.mark.parametrize('drift', ['service-account', 'other-setting', 'other-secret', 'container-args'])
def test_candidate_verification_rejects_unrelated_template_changes(
        activation, service, revision, monkeypatch, tmp_path, drift):
    provider, manifest, candidate, record = candidate_fixture(activation, service, revision)
    if drift == 'service-account':
        candidate['spec']['serviceAccountName'] = 'another@repaido.iam.gserviceaccount.com'
    elif drift == 'container-args':
        candidate['spec']['containers'][0]['args'] = ['unexpected-command']
    else:
        env = {row['name']: row for row in candidate['spec']['containers'][0]['env']}
        if drift == 'other-setting':
            env['EXISTING_OTHER_SETTING']['value'] = 'unexpected-change'
        else:
            env['EXISTING_SECRET']['valueFrom']['secretKeyRef']['key'] = '8'
    healthy_responses(activation, monkeypatch)
    with pytest.raises(activation.SetupError, match='Unrelated'):
        activation.verify_candidate(provider, tmp_path, manifest, record)
    assert not (tmp_path/'candidate-verified.json').exists()


def test_candidate_verification_rejects_mismatched_numeric_worker_key(
        activation, service, revision, monkeypatch, tmp_path):
    provider, manifest, candidate, record = candidate_fixture(activation, service, revision)
    key = next(row for row in candidate['spec']['containers'][0]['env']
               if row['name'] == 'REPAIDO_BIKE_PROMO_QUOTA_SECRET')
    key['valueFrom']['secretKeyRef']['key'] = '4'
    healthy_responses(activation, monkeypatch)
    with pytest.raises(activation.SetupError, match='version differs'):
        activation.verify_candidate(provider, tmp_path, manifest, record)


def test_candidate_verification_requires_real_dispatch_readiness_before_promotion(
        activation, service, revision, monkeypatch, tmp_path):
    provider, manifest, candidate, record = candidate_fixture(activation, service, revision)
    healthy_responses(activation, monkeypatch, dispatch_ready=False)
    with pytest.raises(activation.SetupError, match='not ready'):
        activation.verify_candidate(provider, tmp_path, manifest, record)
    assert not (tmp_path/'candidate-verified.json').exists()


def test_candidate_verification_preserves_networking_and_scaling_annotations(
        activation, service, revision, monkeypatch, tmp_path):
    provider, manifest, candidate, record = candidate_fixture(activation, service, revision)
    candidate['metadata']['annotations'] = {'run.googleapis.com/vpc-access-egress': 'all-traffic'}
    healthy_responses(activation, monkeypatch)
    with pytest.raises(activation.SetupError, match='annotations changed'):
        activation.verify_candidate(provider, tmp_path, manifest, record)


def test_state_bucket_must_be_protected_versioned_and_in_the_correct_project(activation):
    activation.validate_bucket({'uniform_bucket_level_access': True,
        'public_access_prevention': 'enforced', 'versioning_enabled': True,
        'project_number': activation.PROJECT_NUMBER})
    for field, value in [('uniform_bucket_level_access', False),
                         ('public_access_prevention', 'inherited'),
                         ('versioning_enabled', False), ('project_number', '999999999999')]:
        bucket = {'uniform_bucket_level_access': True, 'public_access_prevention': 'enforced',
                  'versioning_enabled': True, 'project_number': activation.PROJECT_NUMBER, field: value}
        with pytest.raises(activation.SetupError):
            activation.validate_bucket(bucket)


def test_nested_state_bucket_rest_metadata_is_supported(activation):
    activation.validate_bucket({'iamConfiguration': {
        'uniformBucketLevelAccess': {'enabled': True}, 'publicAccessPrevention': 'enforced'},
        'versioning': {'enabled': True}, 'projectNumber': activation.PROJECT_NUMBER})


def canonical_bucket(name='repaido-state-fixture', **changes):
    return {'name': name, 'projectNumber': '133610574058',
            'iamConfiguration': {'uniformBucketLevelAccess': {'enabled': True}, 'publicAccessPrevention': 'enforced'},
            'versioning': {'enabled': True}, **changes}


def test_canonical_bucket_ownership_is_read_independently_of_transformed_cli_output(activation):
    calls=[]
    class Provider:
        def api_read(self,url): calls.append(url); return canonical_bucket()
        def cloud(self,*args,**kwargs): pytest.fail('CLI projection cannot establish bucket ownership')
    value=activation.verified_bucket(Provider(),'repaido-state-fixture')
    assert value['projectNumber']=='133610574058'
    assert calls==['https://storage.googleapis.com/storage/v1/b/repaido-state-fixture?fields=name,projectNumber,iamConfiguration,versioning']


@pytest.mark.parametrize('changes', [{'projectNumber':None}, {'projectNumber':'another-project'},
    {'name':'repaido-different-bucket'}, {'versioning':{'enabled':False}},
    {'iamConfiguration':{'uniformBucketLevelAccess':{'enabled':True},'publicAccessPrevention':'inherited'}}])
def test_canonical_metadata_never_weakens_project_or_state_protection_guards(activation,changes):
    class Provider:
        def api_read(self,url): return canonical_bucket(**changes)
    with pytest.raises(activation.SetupError):activation.verified_bucket(Provider(),'repaido-state-fixture')


def test_bootstrap_resumes_existing_numeric_key_and_bucket_without_recreation(activation,service,revision,monkeypatch,tmp_path,capsys):
    serving=activation.select_serving(service,revision)
    monkeypatch.setattr(activation,'baseline',lambda runner:(serving,revision))
    monkeypatch.setattr(activation,'inventory',lambda runner:{'baseline':serving})
    bucket='repaido-state-fixture'; calls=[]
    class Provider:
        def cloud(self,*args,**kwargs):
            calls.append(args)
            assert not any(word in args for word in ('create','add','update'))
            if args[:2]==('services','enable'):return {}
            if args==('secrets','describe',activation.QUOTA):return {'name':activation.QUOTA}
            if args==('secrets','versions','describe',SECRET):return {'state':'ENABLED'}
            if args==('storage','buckets','describe','gs://'+bucket):
                return {'name':bucket,'uniform_bucket_level_access':True,'versioning_enabled':True,'public_access_prevention':'enforced'}
            pytest.fail('Unexpected bootstrap mutation/read: '+repr(args))
        def api_read(self,url):return canonical_bucket(bucket)
    record=tmp_path/'bootstrap-progress.json'
    activation.bootstrap(Provider(),SimpleNamespace(state_bucket=bucket,quota_secret_version=SECRET,record_file=str(record)))
    output=json.loads(capsys.readouterr().out)
    assert output['quota_secret_version']==SECRET and output['state_bucket']==bucket
    assert json.loads(record.read_text())['phase']=='prerequisites_verified'
    assert json.loads(record.read_text())['quota_secret_version']==SECRET


def test_failed_bucket_verification_preserves_numeric_key_progress_for_recovery(activation,service,revision,monkeypatch,tmp_path):
    serving=activation.select_serving(service,revision)
    monkeypatch.setattr(activation,'baseline',lambda runner:(serving,revision))
    monkeypatch.setattr(activation,'inventory',lambda runner:{'baseline':serving})
    class Provider:
        def cloud(self,*args,**kwargs):
            if args[:2]==('services','enable'):return {}
            if args==('secrets','describe',activation.QUOTA):return None
            if args[:2]==('secrets','create'):return {}
            if args[:3]==('secrets','versions','add'):return {'name':SECRET}
            if args[:3]==('storage','buckets','describe'):return {'name':'repaido-state-fixture'}
            pytest.fail(repr(args))
        def api_read(self,url):return canonical_bucket(projectNumber='different-project')
    record=tmp_path/'bootstrap-progress.json'
    with pytest.raises(activation.SetupError):
        activation.bootstrap(Provider(),SimpleNamespace(state_bucket='repaido-state-fixture',quota_secret_version=None,record_file=str(record)))
    value=json.loads(record.read_text())
    assert value['phase']=='quota_secret_ready' and value['quota_secret_version']==SECRET
    assert 'data-file' not in record.read_text()


def pool_instance(zone, *, health='HEALTHY', action='NONE', status='RUNNING'):
    return {'instance': f'https://www.googleapis.com/compute/v1/projects/repaido/zones/{zone}/instances/fixture',
            'instanceStatus': status, 'currentAction': action,
            'instanceHealth': [{'detailedHealthState': health}]}


def test_pool_verification_requires_stable_healthy_workers_in_both_zones(activation):
    class Provider:
        def cloud(self, *args, **kwargs):
            if args[:4] == ('compute', 'instance-groups', 'managed', 'describe'):
                return {'targetSize': 2, 'status': {'isStable': True},
                        'versions': [{'instanceTemplate': '/global/instanceTemplates/bike-fixture'}]}
            if args[:3] == ('compute', 'instance-templates', 'describe'):
                return {'properties': {
                    'networkInterfaces': [{'subnetwork': '/regions/us-central1/subnetworks/repaido-bike-dispatch-subnet'}],
                    'serviceAccounts': [{'email': activation.WORKER}],
                    'metadata': {'items': [{'key': 'startup-script', 'value': DIGEST+' '+SECRET}]}}}
            assert args[:4] == ('compute', 'instance-groups', 'managed', 'list-instances')
            return [pool_instance('us-central1-a'), pool_instance('us-central1-b')]
    activation.verify_pool(Provider(), {'terraform_inputs': {'maximum_workers': 2},
                                      'baseline': {'image': DIGEST}, 'quota_secret_version': SECRET})


@pytest.mark.parametrize('group,instances', [
    ({'targetSize': 2, 'status': {'isStable': False}}, [pool_instance('us-central1-a'), pool_instance('us-central1-b')]),
    ({'targetSize': 3, 'status': {'isStable': True}}, [pool_instance('us-central1-a'), pool_instance('us-central1-b')]),
    ({'targetSize': 2, 'status': {'isStable': True}}, [pool_instance('us-central1-a')]),
    ({'targetSize': 2, 'status': {'isStable': True}}, [pool_instance('us-central1-a'), pool_instance('us-central1-a')]),
    ({'targetSize': 2, 'status': {'isStable': True}}, [pool_instance('us-central1-a'), pool_instance('us-central1-b', health='UNHEALTHY')]),
    ({'targetSize': 2, 'status': {'isStable': True}}, [pool_instance('us-central1-a'), pool_instance('us-central1-b', action='RECREATING')]),
])
def test_pool_must_not_promote_from_partial_unhealthy_or_overbudget_state(activation, group, instances):
    class Provider:
        def cloud(self, *args, **kwargs):
            return group if args[:4] == ('compute', 'instance-groups', 'managed', 'describe') else instances
    with pytest.raises(activation.SetupError):
        activation.verify_pool(Provider(), {'terraform_inputs': {'maximum_workers': 2}})


@pytest.mark.parametrize('drift', ['public-ip', 'subnet', 'service-account', 'image', 'quota-version'])
def test_actual_worker_template_must_match_private_reviewed_identity_image_and_key(activation, drift):
    properties = {
        'networkInterfaces': [{'subnetwork': '/regions/us-central1/subnetworks/repaido-bike-dispatch-subnet'}],
        'serviceAccounts': [{'email': activation.WORKER}],
        'metadata': {'items': [{'key': 'startup-script', 'value': DIGEST+' '+SECRET}]}}
    if drift == 'public-ip':
        properties['networkInterfaces'][0]['accessConfigs'] = [{'type': 'ONE_TO_ONE_NAT'}]
    elif drift == 'subnet':
        properties['networkInterfaces'][0]['subnetwork'] = '/regions/us-central1/subnetworks/unrelated'
    elif drift == 'service-account':
        properties['serviceAccounts'][0]['email'] = 'other@repaido.iam.gserviceaccount.com'
    elif drift == 'image':
        properties['metadata']['items'][0]['value'] = DIGEST.replace('a'*64, 'b'*64)+' '+SECRET
    else:
        properties['metadata']['items'][0]['value'] = DIGEST+' '+SECRET.replace('/3', '/4')
    class Provider:
        def cloud(self, *args, **kwargs):
            if args[:4] == ('compute', 'instance-groups', 'managed', 'describe'):
                return {'targetSize': 2, 'status': {'isStable': True},
                        'versions': [{'instanceTemplate': '/global/instanceTemplates/bike-fixture'}]}
            if args[:3] == ('compute', 'instance-templates', 'describe'):
                return {'properties': properties}
            return [pool_instance('us-central1-a'), pool_instance('us-central1-b')]
    with pytest.raises(activation.SetupError, match='Actual worker template'):
        activation.verify_pool(Provider(), {'terraform_inputs': {'maximum_workers': 2},
                                           'baseline': {'image': DIGEST}, 'quota_secret_version': SECRET})


def recovery_fixture(activation, service, revision, monkeypatch, tmp_path):
    manifest = {'baseline': activation.select_serving(service, revision),
                'quota_secret_version': SECRET, 'tag': 'bike-fixture'}
    tagged = {'revisionName': 'repaido-api-00074-bike', 'percent': 0, 'tag': manifest['tag'],
              'url': 'https://bike-fixture---repaido-api-133610574058.us-central1.run.app'}
    service['status']['traffic'].append(tagged)
    (tmp_path/'candidate-started.json').write_text(json.dumps({
        'tag': manifest['tag'], 'image': DIGEST, 'baseline_revision': REVISION}))
    monkeypatch.setattr(activation, 'load', lambda directory: (tmp_path, manifest))
    verified = []
    monkeypatch.setattr(activation, 'verify_candidate',
                        lambda runner, directory, value, record: verified.append(copy.deepcopy(record)))

    class ReadOnlyProvider:
        def __init__(self):
            self.calls = []

        def cloud(self, *args, **kwargs):
            self.calls.append(args)
            assert args == ('run', 'services', 'describe', activation.SERVICE,
                            '--region='+activation.REGION)
            return service

        def tf(self, *args, **kwargs):
            pytest.fail('Candidate recovery must never invoke Terraform')

    return ReadOnlyProvider(), manifest, tagged, verified, SimpleNamespace(directory=str(tmp_path))


def test_candidate_recovery_verifies_existing_tag_without_any_cloud_mutation(
        activation, service, revision, monkeypatch, tmp_path):
    provider, manifest, tagged, verified, args = recovery_fixture(
        activation, service, revision, monkeypatch, tmp_path)
    assert not (tmp_path/'candidate.json').exists()
    activation.recover_candidate(provider, args)
    record = json.loads((tmp_path/'candidate.json').read_text())
    assert record['revision'] == tagged['revisionName']
    assert record['url'] == tagged['url']
    assert verified == [record]
    assert len(provider.calls) == 1
    assert service['status']['traffic'][0] == {'revisionName': REVISION, 'percent': 100}


def test_candidate_recovery_requires_an_owned_start_record_before_provider_reads(
        activation, service, revision, monkeypatch, tmp_path):
    provider, manifest, tagged, verified, args = recovery_fixture(
        activation, service, revision, monkeypatch, tmp_path)
    (tmp_path/'candidate-started.json').unlink()
    with pytest.raises(activation.SetupError, match='No recorded candidate request'):
        activation.recover_candidate(provider, args)
    assert not provider.calls and not verified
    assert not (tmp_path/'candidate.json').exists()


@pytest.mark.parametrize('change', ['missing-tag', 'candidate-live', 'baseline-moved', 'tagged-baseline'])
def test_candidate_recovery_rejects_missing_or_production_traffic_candidate(
        activation, service, revision, monkeypatch, tmp_path, change):
    provider, manifest, tagged, verified, args = recovery_fixture(
        activation, service, revision, monkeypatch, tmp_path)
    if change == 'missing-tag':
        service['status']['traffic'].remove(tagged)
    elif change == 'candidate-live':
        service['status']['traffic'][0]['percent'] = 99
        tagged['percent'] = 1
    elif change == 'baseline-moved':
        service['status']['traffic'][0]['revisionName'] = 'another-production-revision'
    else:
        tagged['revisionName'] = REVISION
        tagged['percent'] = 100
        service['status']['traffic'].pop(0)
    with pytest.raises(activation.SetupError):
        activation.recover_candidate(provider, args)
    assert not verified
    assert not (tmp_path/'candidate.json').exists()
    assert len(provider.calls) == 1


@pytest.mark.parametrize('field,value', [
    ('revision', 'another-candidate'),
    ('url', 'https://unowned---repaido-api-133610574058.us-central1.run.app'),
])
def test_candidate_recovery_rejects_disagreement_with_an_existing_release_record(
        activation, service, revision, monkeypatch, tmp_path, field, value):
    provider, manifest, tagged, verified, args = recovery_fixture(
        activation, service, revision, monkeypatch, tmp_path)
    previous = {'revision': tagged['revisionName'], 'url': tagged['url'], 'created_at': 1,
                field: value}
    path = tmp_path/'candidate.json'
    path.write_text(json.dumps(previous))
    with pytest.raises(activation.SetupError, match='records disagree'):
        activation.recover_candidate(provider, args)
    assert json.loads(path.read_text()) == previous
    assert not verified


def test_candidate_recovery_does_not_accept_or_save_unverified_provider_result(
        activation, service, revision, monkeypatch, tmp_path):
    provider, manifest, tagged, verified, args = recovery_fixture(
        activation, service, revision, monkeypatch, tmp_path)

    def failed_verification(*values):
        assert not (tmp_path/'candidate.json').exists()
        raise activation.SetupError('Candidate key identity differs')

    monkeypatch.setattr(activation, 'verify_candidate', failed_verification)
    with pytest.raises(activation.SetupError, match='key identity differs'):
        activation.recover_candidate(provider, args)
    assert not (tmp_path/'candidate.json').exists()
    assert (tmp_path/'candidate-started.json').exists()


@pytest.mark.parametrize('failure', ['invalid-json', 'network', 'non-object'])
def test_candidate_endpoint_failures_are_safe_and_do_not_echo_remote_content(
        activation, monkeypatch, failure):
    private_remote_content = 'private-response-body-do-not-log'

    def open_response(request, timeout):
        assert timeout == 30
        if failure == 'network':
            raise OSError(private_remote_content)
        return io.BytesIO((private_remote_content if failure == 'invalid-json' else '[]').encode())

    monkeypatch.setattr(activation.urllib.request, 'urlopen', open_response)
    with pytest.raises(activation.SetupError) as error:
        activation.get_json('https://bike-fixture---repaido-api-133610574058.us-central1.run.app',
                            '/api/health')
    assert private_remote_content not in str(error.value)


@pytest.mark.parametrize('build_id', ['', ' ', 'local', None])
def test_serving_revision_requires_a_reviewable_production_build_identity(
        activation, service, revision, build_id):
    revision['spec']['containers'][0]['env'][0]['value'] = build_id
    with pytest.raises(activation.SetupError, match='reviewed production build'):
        activation.select_serving(service, revision)


def test_worker_only_quota_resource_flag_cannot_hide_an_api_key_identity(activation, revision):
    revision['spec']['containers'][0]['env'].append({
        'name': 'REPAIDO_BIKE_PROMO_QUOTA_SECRET_RESOURCE', 'value': SECRET})
    with pytest.raises(activation.SetupError, match='worker-only quota resource'):
        activation.quota_binding(revision)


def test_candidate_verification_rejects_repointing_an_unrelated_existing_secret_alias(
        activation, service, revision, monkeypatch, tmp_path):
    provider, manifest, candidate, record = candidate_fixture(activation, service, revision)
    revision['metadata']['annotations'] = {
        'run.googleapis.com/secrets': 'other-secret:projects/repaido/secrets/original-key'}
    candidate['metadata']['annotations'] = {
        'run.googleapis.com/secrets': 'other-secret:projects/repaido/secrets/unrelated-key'}
    healthy_responses(activation, monkeypatch)
    with pytest.raises(activation.SetupError, match='Unrelated API secret aliases'):
        activation.verify_candidate(provider, tmp_path, manifest, record)
    assert not (tmp_path/'candidate-verified.json').exists()


def test_first_prepare_can_use_a_confirmed_empty_remote_state_without_state_list(activation, tmp_path):
    calls = []

    class Provider:
        def cloud(self, *args, **kwargs):
            calls.append((args, kwargs))
            return None

        def tf(self, *args, **kwargs):
            pytest.fail('A confirmed absent backend object has no state to list')

    assert activation.owned_addresses(Provider(), tmp_path, 'repaido-fixture-state') == set()
    assert calls == [(('storage', 'objects', 'describe',
                       'gs://repaido-fixture-state/bike-runtime/v1/default.tfstate'), {'optional': True})]


def test_existing_remote_state_uses_terraform_ownership_instead_of_being_treated_as_empty(activation, tmp_path):
    calls = []
    address = 'module.dispatch[0].google_pubsub_topic.dispatch'

    class Provider:
        def cloud(self, *args, **kwargs):
            return {'name': 'bike-runtime/v1/default.tfstate', 'generation': '1'}

        def tf(self, *args, **kwargs):
            calls.append((args, kwargs))
            return address+'\n'

    assert activation.owned_addresses(Provider(), tmp_path, 'repaido-fixture-state') == {address}
    assert calls == [((tmp_path, 'state', 'list'), {'raw': True})]


@pytest.fixture
def repair_plan(activation,tmp_path,monkeypatch):
    path=tmp_path/'terraform'/'launch.tfplan'
    path.parent.mkdir();path.write_bytes(b'reviewed-fixture-plan')
    manifest={'baseline':{'image':DIGEST},'work_baselines':{},'adoption':[],
              'plan_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
              'existing':{'group':{'targetSize':2,'versions':[{'instanceTemplate':'reviewed-template'}],
                  'distributionPolicy':{'zones':['us-central1-a','us-central1-b']},
                  'updatePolicy':{'maxSurge':2},'status':{'isStable':False},
                  'currentActions':{'verifying':2},'fingerprint':'observed-before'},
                  'autoscaler':{'autoscalingPolicy':{'minNumReplicas':2,'maxNumReplicas':2},
                      'recommendedSize':2,'status':'ACTIVE','statusDetails':[]},
                  'subscription':{'topic':TOPIC,'enableMessageOrdering':True},
                  'firewall':{'sourceRanges':['130.211.0.0/22','35.191.0.0/16']},
                  'account':{'disabled':False}}}
    current=copy.deepcopy(manifest)
    monkeypatch.setattr(activation,'load',lambda directory:(tmp_path,copy.deepcopy(manifest)))
    monkeypatch.setattr(activation,'inventory',lambda runner:copy.deepcopy(current))
    calls=[]
    class Provider:
        def tf(self,directory,*args,**kwargs):
            calls.append(args)
            if args[0]=='show':return {'resource_changes':[]}
            assert args==('apply','-input=false','launch.tfplan')
            return ''
    return manifest,current,Provider(),calls


def test_worker_health_recovery_does_not_block_the_saved_repair_plan(activation,repair_plan,tmp_path):
    manifest,current,provider,calls=repair_plan
    current['existing']['group'].update(status={'isStable':True},currentActions={'none':2},fingerprint='observed-after')
    current['existing']['autoscaler'].update(recommendedSize=1,status='PENDING',statusDetails=[{'type':'telemetry_pending'}])
    activation.apply_infra(provider,SimpleNamespace(directory=str(tmp_path)))
    assert calls[-1]==('apply','-input=false','launch.tfplan')
    assert (tmp_path/'infra-applied.json').is_file()
    assert manifest['existing']['group']['status']=={'isStable':False}


@pytest.mark.parametrize('resource,field,value',[
    ('group','targetSize',3),('group','versions',[{'instanceTemplate':'another-template'}]),
    ('group','distributionPolicy',{'zones':['another-zone']}),('group','updatePolicy',{'maxSurge':5}),
    ('autoscaler','autoscalingPolicy',{'minNumReplicas':2,'maxNumReplicas':16}),
    ('subscription','enableMessageOrdering',False),('subscription','topic','another-topic'),
    ('firewall','sourceRanges',['0.0.0.0/0']),('account','disabled',True),
])
def test_runtime_drift_exclusion_never_hides_configuration_changes(activation,repair_plan,tmp_path,resource,field,value):
    _,current,provider,calls=repair_plan
    current['existing'][resource][field]=value
    with pytest.raises(activation.SetupError,match='configuration changed after planning'):
        activation.apply_infra(provider,SimpleNamespace(directory=str(tmp_path)))
    assert calls==[]
    assert not (tmp_path/'infra-applied.json').exists()


@pytest.mark.parametrize('stage', ['metadata', 'state-list'])
def test_remote_state_authorization_or_cli_failure_is_never_interpreted_as_empty(activation, tmp_path, stage):
    calls = []

    class Provider:
        def cloud(self, *args, **kwargs):
            if stage == 'metadata':
                raise activation.SetupError('State metadata read denied')
            return {'name': 'bike-runtime/v1/default.tfstate'}

        def tf(self, *args, **kwargs):
            calls.append(args)
            raise activation.SetupError('State ownership read failed')

    with pytest.raises(activation.SetupError):
        activation.owned_addresses(Provider(), tmp_path, 'repaido-fixture-state')
    assert len(calls) == (stage == 'state-list')


def test_activation_rejects_a_non_default_terraform_workspace_before_any_command(
        activation, monkeypatch, tmp_path):
    monkeypatch.setenv('TF_WORKSPACE', 'another-service')
    monkeypatch.setattr(activation.Runner, 'run', lambda *args, **kwargs: pytest.fail('No Terraform command allowed'))
    with pytest.raises(activation.SetupError, match='default Terraform workspace'):
        activation.Runner().tf(tmp_path, 'plan', raw=True)


@pytest.mark.parametrize('status,optional,missing', [
    (404, True, True), (404, False, False), (401, True, False),
    (403, True, False), (429, True, False), (500, True, False),
])
def test_metadata_rest_reads_only_treat_explicit_optional_404_as_absent(
        activation, monkeypatch, status, optional, missing):
    private_token = 'fixture-oauth-token-never-log'
    calls = []
    monkeypatch.setattr(activation.Runner, 'run', lambda self, args, **kwargs: private_token+'\n')

    def unavailable(request, timeout):
        calls.append(request)
        assert request.get_header('Authorization') == 'Bearer '+private_token
        assert request.get_header('X-goog-user-project') == 'repaido'
        raise activation.urllib.error.HTTPError(request.full_url, status, private_token, {}, None)

    monkeypatch.setattr(activation.urllib.request, 'urlopen', unavailable)
    url = 'https://compute.googleapis.com/compute/v1/projects/repaido/regions/us-central1/autoscalers/bike-fixture'
    if missing:
        assert activation.Runner().api_read(url, optional=optional) is None
    else:
        with pytest.raises(activation.SetupError) as error:
            activation.Runner().api_read(url, optional=optional)
        assert private_token not in str(error.value)
    assert len(calls) == 1


def test_metadata_rest_read_preserves_provider_json_without_printing_oauth(activation, monkeypatch):
    private_token = 'fixture-oauth-token-never-log'
    monkeypatch.setattr(activation.Runner, 'run', lambda self, args, **kwargs: private_token)
    expected = {'name': 'bike-fixture', 'autoscalingPolicy': {'minNumReplicas': 2, 'maxNumReplicas': 2}}
    monkeypatch.setattr(activation.urllib.request, 'urlopen',
                        lambda request, timeout: io.BytesIO(json.dumps(expected).encode()))
    assert activation.Runner().api_read(
        'https://compute.googleapis.com/compute/v1/projects/repaido/regions/us-central1/autoscalers/bike-fixture') == expected


@pytest.mark.parametrize('url', [
    'https://compute.googleapis.com/compute/v1/projects/repaido/regions/us-central1/autoscalers/bike-fixture',
    'https://monitoring.googleapis.com/v3/projects/repaido/alertPolicies?pageSize=1000',
    'https://storage.googleapis.com/storage/v1/b/repaido-state-fixture?fields=name,projectNumber,iamConfiguration,versioning',
])
def test_metadata_rest_sets_resource_quota_project_while_preserving_existing_oauth(
        activation, monkeypatch, url, capsys):
    token = 'fixture-opaque-oauth-credential'
    commands = []
    def capture(self, args, **kwargs):
        commands.append((args, kwargs))
        return token + '\n'
    monkeypatch.setattr(activation.Runner, 'run', capture)
    def respond(request, timeout):
        assert request.full_url == url
        assert request.get_header('Authorization') == 'Bearer ' + token
        assert request.get_header('X-goog-user-project') == 'repaido'
        assert request.get_method() == 'GET' and request.data is None
        return io.BytesIO(b'{"metadata":true}')
    monkeypatch.setattr(activation.urllib.request, 'urlopen', respond)
    assert activation.Runner().api_read(url) == {'metadata': True}
    assert commands == [(['gcloud', 'auth', 'print-access-token'], {'raw': True})]
    assert capsys.readouterr() == ('', '')


@pytest.mark.parametrize('url', [
    'https://compute.googleapis.com.evil.example/compute/v1/projects/repaido/regions/us-central1/autoscalers/fixture',
    'https://compute.googleapis.com/compute/v1/projects/another-project/regions/us-central1/autoscalers/fixture',
    'https://untrusted.example/metadata',
    'https://storage.googleapis.com.evil.example/storage/v1/b/repaido-state-fixture?fields=name,projectNumber,iamConfiguration,versioning',
    'https://storage.googleapis.com/storage/v1/b/unrelated-bucket?fields=name,projectNumber,iamConfiguration,versioning',
    'https://storage.googleapis.com/storage/v1/b/repaido-state-fixture/iam',
    'https://storage.googleapis.com/storage/v1/b/repaido-state-fixture?fields=name,projectNumber,iamConfiguration,versioning&other=true',
])
def test_metadata_rest_never_sends_oauth_to_an_unapproved_host_or_project(activation, monkeypatch, url):
    monkeypatch.setattr(activation.Runner, 'run', lambda *args, **kwargs: pytest.fail('No OAuth read allowed'))
    monkeypatch.setattr(activation.urllib.request, 'urlopen', lambda *args, **kwargs: pytest.fail('No request allowed'))
    with pytest.raises(activation.SetupError, match='Unexpected Google Cloud metadata API URL'):
        activation.Runner().api_read(url)


def promotion_fixture(activation, service, revision):
    _, manifest, _, record = candidate_fixture(activation, service, revision)
    status = service['status']
    status['latestCreatedRevisionName'] = status['latestReadyRevisionName'] = record['revision']
    status['traffic'] = [
        {'revisionName': record['revision'], 'percent': 100},
        {'revisionName': record['revision'], 'percent': 0, 'tag': manifest['tag'], 'url': record['url']}]

    class ReadOnlyProvider:
        def __init__(self):
            self.calls = []

        def cloud(self, *args, **kwargs):
            self.calls.append(args)
            assert args == ('run', 'services', 'describe', activation.SERVICE,
                            '--region='+activation.REGION)
            return service

        def tf(self, *args, **kwargs):
            pytest.fail('Promotion receipt recovery cannot invoke Terraform')

    return ReadOnlyProvider(), manifest, record


@pytest.mark.parametrize('serving', ['baseline', 'candidate'])
def test_exact_reconciled_candidate_owns_tag_before_and_after_traffic_switch(
        activation, service, revision, serving):
    _, manifest, record = promotion_fixture(activation, service, revision)
    expected = manifest['baseline']['revision'] if serving == 'baseline' else record['revision']
    service['status']['traffic'][0]['revisionName'] = expected
    activation.check_candidate_service(service, manifest, record, expected)


@pytest.mark.parametrize('drift', [
    'generation', 'ready', 'latest-created', 'latest-ready', 'tag-owner', 'tag-url', 'traffic',
])
def test_promotion_requires_reconciled_candidate_identity_and_exact_expected_traffic(
        activation, service, revision, drift):
    _, manifest, record = promotion_fixture(activation, service, revision)
    status = service['status']
    if drift == 'generation':
        service['metadata']['generation'] += 1
    elif drift == 'ready':
        status['conditions'][0]['status'] = 'Unknown'
    elif drift == 'latest-created':
        status['latestCreatedRevisionName'] = 'other-release'
    elif drift == 'latest-ready':
        status['latestReadyRevisionName'] = 'other-release'
    elif drift == 'tag-owner':
        status['traffic'][1]['revisionName'] = 'other-release'
    elif drift == 'tag-url':
        status['traffic'][1]['url'] = 'https://other-release---repaido-api-133610574058.us-central1.run.app'
    else:
        status['traffic'][0]['revisionName'] = manifest['baseline']['revision']
    with pytest.raises(activation.SetupError):
        activation.check_candidate_service(service, manifest, record, record['revision'])


def test_same_build_old_revision_cannot_produce_a_successful_promotion_receipt(
        activation, service, revision, monkeypatch, tmp_path):
    provider, manifest, record = promotion_fixture(activation, service, revision)
    service['status']['traffic'][0]['revisionName'] = manifest['baseline']['revision']
    # The image/build deliberately stays unchanged; health alone proves nothing.
    monkeypatch.setattr(activation, 'get_json', lambda *args: pytest.fail('Traffic identity must be checked first'))
    with pytest.raises(activation.SetupError, match='expected revision'):
        activation.record_promotion(provider, tmp_path, manifest, record)
    assert not (tmp_path/'promoted.json').exists()


def test_promotion_receipt_recovery_uses_reads_and_rechecks_pool_candidate_and_work(
        activation, service, revision, monkeypatch, tmp_path):
    provider, manifest, record = promotion_fixture(activation, service, revision)
    (tmp_path/'candidate.json').write_text(json.dumps(record))
    (tmp_path/'promotion-started.json').write_text(json.dumps({
        'revision': record['revision'], 'baseline_revision': REVISION}))
    monkeypatch.setattr(activation, 'load', lambda directory: (tmp_path, manifest))
    checked = []
    monkeypatch.setattr(activation, 'check_work_baselines', lambda *args: checked.append('work'))
    monkeypatch.setattr(activation, 'verify_pool', lambda *args: checked.append('pool'))
    monkeypatch.setattr(activation, 'verify_candidate', lambda *args: checked.append('candidate'))
    healthy_responses(activation, monkeypatch)
    activation.recover_promotion(provider, SimpleNamespace(directory=str(tmp_path)))
    receipt = json.loads((tmp_path/'promoted.json').read_text())
    assert receipt['revision'] == record['revision']
    assert receipt['rollback_revision'] == REVISION
    assert receipt['bookings_available'] is False
    assert checked == ['work', 'pool', 'candidate']
    assert len(provider.calls) == 1


def test_promotion_receipt_recovery_requires_a_recorded_request_before_any_reads(
        activation, service, revision, monkeypatch, tmp_path):
    provider, manifest, record = promotion_fixture(activation, service, revision)
    (tmp_path/'candidate.json').write_text(json.dumps(record))
    monkeypatch.setattr(activation, 'load', lambda directory: (tmp_path, manifest))
    monkeypatch.setattr(activation, 'check_work_baselines', lambda *args: pytest.fail('No ownership reads allowed'))
    with pytest.raises(activation.SetupError, match='No recorded promotion request'):
        activation.recover_promotion(provider, SimpleNamespace(directory=str(tmp_path)))
    assert not provider.calls
    assert not (tmp_path/'promoted.json').exists()
