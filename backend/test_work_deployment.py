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
