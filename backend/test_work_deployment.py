"""Deployment repeatability and regional release ordering without remote writes."""
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

spec = importlib.util.spec_from_file_location('deploy_work_services', Path(__file__).resolve().parents[1] / 'scripts' / 'deploy-work-services.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


@pytest.mark.parametrize('existing_job', [False, True])
def test_scheduler_create_and_repeat_deploy_use_supported_header_flags(tmp_path, monkeypatch, existing_job):
    commands = []
    services = []
    def fake_gcloud(*args, data=False):
        commands.append(args)
        if args[:3] == ('run', 'services', 'describe'):
            return {'spec': {'template': {'spec': {'serviceAccountName': 'runtime@repaido.iam.gserviceaccount.com', 'containers': [{'env': []}]}}}}
        if args[:2] == ('services', 'list'):
            return [{'config': {'name': service}} for service in deploy.REQUIRED_WORK_APIS]
        if args[:2] == ('run', 'deploy'):
            name = args[2]
            return {'status': {'url': 'https://' + name + '.example.run.app',
                               'traffic': [{'tag': 'b-build123', 'url': 'https://candidate-' + name + '.example.run.app',
                                            'revisionName': name + '-verified'}]}}
        return {}
    def fake_exists(*args):
        if args[:3] == ('run', 'services', 'describe'):
            return {'status': {'url': 'https://' + args[3] + '.example.run.app'}}
        if args[:3] == ('scheduler', 'jobs', 'describe'):
            return {'name': 'existing-job'} if existing_job else None
        return {'exists': True}
    monkeypatch.setattr(deploy, 'gcloud', fake_gcloud)
    monkeypatch.setattr(deploy, 'exists', fake_exists)
    monkeypatch.setattr(deploy.subprocess, 'check_output', lambda *args, **kwargs: 'test-identity-token')
    monkeypatch.setattr(deploy, 'request_health', lambda url, build, token, service: services.append(service))
    args = SimpleNamespace(project='repaido', region='us-central1', parent='repaido-api', image='fixture-image',
                           build='build123', receipt=str(tmp_path / 'receipt.json'))
    deploy.deploy(args)
    scheduler = next(command for command in commands if command[:2] == ('scheduler', 'jobs') and command[2] in ('create', 'update'))
    assert scheduler[2] == ('update' if existing_job else 'create')
    expected = '--update-headers=Content-Type=application/json' if existing_job else '--headers=Content-Type=application/json'
    assert expected in scheduler
    other = '--headers=Content-Type=application/json' if existing_job else '--update-headers=Content-Type=application/json'
    assert other not in scheduler
    assert '--oidc-token-audience=https://repaido-work-worker.example.run.app' in scheduler
    assert services == ['repaido-work-api', 'repaido-work-worker']
    assert not any(command[:2] == ('services', 'enable') for command in commands)
    receipt = json.loads((tmp_path / 'receipt.json').read_text())
    assert [row['revision'] for row in receipt] == ['repaido-work-api-verified', 'repaido-work-worker-verified']


@pytest.mark.parametrize('build_region', ['global', 'us-central1'])
def test_release_order_waits_for_earlier_build_in_actual_cloud_build_location(monkeypatch, build_region):
    commands = []
    sleeps = []
    pages = [[{'id': 'earlier', 'createTime': '2026-10-07T10:00:00Z'}], []]
    def fake_gcloud(*args, data=False):
        commands.append(args)
        if args[:2] == ('builds', 'describe'):
            return {'id': 'own', 'buildTriggerId': 'trigger', 'createTime': '2026-10-07T10:01:00Z'}
        return pages.pop(0)
    monkeypatch.setattr(deploy, 'gcloud', fake_gcloud)
    monkeypatch.setattr(deploy.time, 'sleep', lambda seconds: sleeps.append(seconds))
    args = SimpleNamespace(project='repaido', build='own', build_region=build_region)
    deploy.await_release(args)
    assert sleeps == [10]
    assert len(commands) == 3
    assert all('--region=' + build_region in command for command in commands)
    assert commands[0][:3] == ('builds', 'describe', 'own')
    assert all(command[:2] == ('builds', 'list') for command in commands[1:])


def test_release_order_read_permission_failure_stays_fail_closed(monkeypatch):
    def denied(*args, **kwargs):
        raise PermissionError('cloudbuild.builds.get denied')
    monkeypatch.setattr(deploy, 'gcloud', denied)
    with pytest.raises(PermissionError, match='cloudbuild.builds.get'):
        deploy.await_release(SimpleNamespace(project='repaido', build='own', build_region='global'))


@pytest.mark.parametrize('denied_operation', ['describe', 'list'])
def test_early_build_access_get_and_list_fail_fast_with_actionable_role_without_mutations(monkeypatch, capsys, denied_operation):
    commands = []
    def fake_gcloud(*args, data=False):
        commands.append(args)
        if args[1] == denied_operation:
            raise deploy.subprocess.CalledProcessError(1, ['gcloud', *args])
        return {'id': 'own', 'private_configuration': 'MUST_NOT_APPEAR_IN_OUTPUT'}
    monkeypatch.setattr(deploy, 'gcloud', fake_gcloud)
    monkeypatch.setattr(deploy.time, 'sleep', lambda *args: pytest.fail('Access preflight must not wait for earlier builds.'))
    args = SimpleNamespace(project='repaido', build='own', build_region='us-central1')
    with pytest.raises(RuntimeError, match='roles/cloudbuild.builds.viewer') as failed:
        deploy.check_build_access(args)
    assert 'us-central1' in str(failed.value) and 'cloudbuild.builds.get' in str(failed.value)
    assert 'cloudbuild.builds.list' in str(failed.value)
    assert len(commands) == (1 if denied_operation == 'describe' else 2)
    assert all(command[:2] in (('builds', 'describe'), ('builds', 'list')) for command in commands)
    assert all('--region=us-central1' in command for command in commands)
    assert 'MUST_NOT_APPEAR_IN_OUTPUT' not in capsys.readouterr().out + str(failed.value)


def test_early_build_access_checks_only_own_get_and_bounded_list_without_logging_metadata(monkeypatch, capsys):
    commands = []
    def fake_gcloud(*args, data=False):
        commands.append(args)
        return {'configuration': 'MUST_NOT_APPEAR_IN_OUTPUT'}
    monkeypatch.setattr(deploy, 'gcloud', fake_gcloud)
    monkeypatch.setattr(deploy.time, 'sleep', lambda *args: pytest.fail('Access preflight must not wait for earlier builds.'))
    deploy.check_build_access(SimpleNamespace(project='repaido', build='own', build_region='global'))
    assert commands == [('builds', 'describe', 'own', '--project=repaido', '--region=global'),
                        ('builds', 'list', '--project=repaido', '--region=global', '--limit=1')]
    output = capsys.readouterr().out
    assert 'verified' in output and 'MUST_NOT_APPEAR_IN_OUTPUT' not in output


def test_enabled_apis_use_read_only_service_listing_without_enabling_again(monkeypatch):
    commands = []
    def fake_gcloud(*args, data=False):
        commands.append(args)
        return [{'config': {'name': service}} for service in (*deploy.REQUIRED_WORK_APIS, 'unrelated.googleapis.com')]
    monkeypatch.setattr(deploy, 'gcloud', fake_gcloud)
    deploy.ensure_required_apis('repaido')
    assert commands == [('services', 'list', '--enabled', '--project=repaido')]


def test_only_missing_apis_are_enabled(monkeypatch):
    commands = []
    def fake_gcloud(*args, data=False):
        commands.append(args)
        if args[:2] == ('services', 'list'):
            return [{'config': {'name': service}} for service in deploy.REQUIRED_WORK_APIS[:-1]]
        return {}
    monkeypatch.setattr(deploy, 'gcloud', fake_gcloud)
    deploy.ensure_required_apis('repaido')
    assert commands == [('services', 'list', '--enabled', '--project=repaido'),
                        ('services', 'enable', 'firebaseinstallations.googleapis.com', '--project=repaido')]


def test_denied_api_listing_does_not_try_unverified_enable_or_iam_changes(monkeypatch):
    commands = []
    def denied(*args, **kwargs):
        commands.append(args)
        raise deploy.subprocess.CalledProcessError(1, ['gcloud', *args])
    monkeypatch.setattr(deploy, 'gcloud', denied)
    with pytest.raises(deploy.subprocess.CalledProcessError):
        deploy.ensure_required_apis('repaido')
    assert commands == [('services', 'list', '--enabled', '--project=repaido')]


@pytest.mark.parametrize(('arguments', 'stderr'), [
    (('run', 'services', 'describe', 'repaido-work-api'),
     'ERROR: (gcloud.run.services.describe) Cannot find service [repaido-work-api]\n'),
    (('run', 'services', 'describe', 'repaido-work-worker'),
     'WARNING: SDK configuration notice\nERROR: (gcloud.run.services.describe) Cannot find service [repaido-work-worker].\n'),
    (('scheduler', 'jobs', 'describe', 'repaido-work-updates'),
     'ERROR: (gcloud.scheduler.jobs.describe) NOT_FOUND: Job not found.\n'),
    (('iam', 'service-accounts', 'describe', 'repaido-work-scheduler@repaido.iam.gserviceaccount.com'),
     'ERROR: (gcloud.iam.service-accounts.describe) NOT_FOUND: Unknown service account.\n'),
])
def test_missing_resources_recognize_sdk_run_404_and_scheduler_iam_not_found(monkeypatch, arguments, stderr):
    calls = []
    def run(command, **kwargs):
        calls.append(command)
        return SimpleNamespace(returncode=1, stdout='', stderr=stderr)
    monkeypatch.setattr(deploy.subprocess, 'run', run)
    assert deploy.exists(*arguments, '--project=repaido') is None
    assert calls == [['gcloud', *arguments, '--project=repaido', '--format=json']]


@pytest.mark.parametrize(('arguments', 'stderr'), [
    (('run', 'services', 'describe', 'repaido-work-api'),
     'ERROR: (gcloud.run.services.describe) PERMISSION_DENIED: Permission run.services.get denied on service that does not exist or is inaccessible.\n'),
    (('scheduler', 'jobs', 'describe', 'repaido-work-updates'),
     'ERROR: (gcloud.scheduler.jobs.describe) PERMISSION_DENIED: Job not found or caller lacks permission.\n'),
    (('iam', 'service-accounts', 'describe', 'repaido-work-scheduler@repaido.iam.gserviceaccount.com'),
     'ERROR: (gcloud.iam.service-accounts.describe) PERMISSION_DENIED: Permission iam.serviceAccounts.get denied on resource (or it may not exist).\n'),
    (('run', 'services', 'describe', 'repaido-work-api'),
     'ERROR: (gcloud.run.services.describe) UNAUTHENTICATED: Resource not found without credentials.\n'),
    (('run', 'services', 'describe', 'repaido-work-api'),
     'ERROR: (gcloud.run.services.describe) Cannot find service [different-service]\n'),
    (('scheduler', 'jobs', 'describe', 'repaido-work-updates'),
     'ERROR: (gcloud.scheduler.jobs.describe) Cannot find service [repaido-work-updates]\n'),
    (('run', 'services', 'describe', 'repaido-work-api'),
     'ERROR: (gcloud.run.services.describe) UNAVAILABLE: Service temporarily unavailable.\n'),
])
def test_resource_checks_keep_permission_and_unverified_missing_errors_fail_closed(monkeypatch, arguments, stderr):
    calls = []
    def run(command, **kwargs):
        calls.append(command)
        return SimpleNamespace(returncode=1, stdout='', stderr=stderr)
    monkeypatch.setattr(deploy.subprocess, 'run', run)
    with pytest.raises(RuntimeError, match='GCP resource check failed'):
        deploy.exists(*arguments, '--project=repaido')
    assert calls == [['gcloud', *arguments, '--project=repaido', '--format=json']]


def test_existing_resource_description_is_returned_without_mutation(monkeypatch):
    calls = []
    def run(command, **kwargs):
        calls.append(command)
        return SimpleNamespace(returncode=0, stdout='{"metadata":{"name":"repaido-work-api"}}', stderr='')
    monkeypatch.setattr(deploy.subprocess, 'run', run)
    assert deploy.exists('run', 'services', 'describe', 'repaido-work-api') == {'metadata': {'name': 'repaido-work-api'}}
    assert calls == [['gcloud', 'run', 'services', 'describe', 'repaido-work-api', '--format=json']]
