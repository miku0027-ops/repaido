"""Release gating and cost inventory without GCP writes or credentials."""
import importlib.util
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]


def load_script(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), ROOT / 'scripts' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


cost = load_script('cloud-cost-controls')
release = load_script('check-release-authorization')


@pytest.mark.parametrize('approved', ['', 'false', 'TRUE', '1', ' true', 'true '])
def test_release_without_exact_manual_override_is_denied(approved):
    with pytest.raises(ValueError, match='Release not requested'):
        release.require_release(approved, 'a' * 40)


@pytest.mark.parametrize('commit', ['', 'main', 'a' * 7, 'a' * 39, 'z' * 40])
def test_release_requires_reviewed_commit_identity(commit):
    with pytest.raises(ValueError, match='commit'):
        release.require_release('true', commit)


def test_release_defaults_deny_and_explicit_batch_can_proceed():
    command = ['python3', str(ROOT / 'scripts/check-release-authorization.py')]
    denied = subprocess.run(command, text=True, capture_output=True)
    assert denied.returncode == 1 and 'Release not requested' in denied.stderr
    allowed = subprocess.run([*command, '--approved=true', '--commit=' + 'a' * 40], text=True, capture_output=True)
    assert allowed.returncode == 0
    config = (ROOT / 'cloudbuild.yaml').read_text()
    assert config.split('steps:\n', 1)[1].split('  - id: ', 1)[1].startswith('require-explicit-release\n')
    assert "_RELEASE_APPROVED: 'false'" in config
    # All current steps use Cloud Build's implicit previous-step dependency.
    # A parallel graph must prove every expensive/mutating step follows the gate.
    assert 'waitFor:' not in config
    assert '--approved=${_RELEASE_APPROVED}' in config and '--commit=$COMMIT_SHA' in config


def test_audit_is_read_only_bounded_and_does_not_export_private_configuration(monkeypatch):
    commands = []
    def read(*args):
        commands.append(args)
        if args[:3] == ('builds', 'triggers', 'list'):
            return [{'id': 'push', 'name': 'production', 'filename': 'cloudbuild.yaml',
                     'substitutions': {'PRIVATE_KEY': 'MUST_NOT_APPEAR'}}]
        if args[:2] == ('builds', 'list'):
            return [{'id': 'build', 'status': 'SUCCESS', 'secrets': ['MUST_NOT_APPEAR']}]
        if args[:3] == ('run', 'services', 'list'):
            return [{'metadata': {'name': 'api', 'annotations': {'run.googleapis.com/minScale': '1'}},
                     'spec': {'template': {'metadata': {'annotations': {'autoscaling.knative.dev/minScale': '2',
                             'autoscaling.knative.dev/maxScale': '8', 'run.googleapis.com/cpu-throttling': 'false'}},
                             'spec': {'containerConcurrency': 64, 'containers': [{'env': [{'name': 'TOKEN',
                                      'value': 'MUST_NOT_APPEAR'}], 'resources': {'limits': {'cpu': '1'}}}]}}},
                     'status': {'traffic': [{'revisionName': 'api-1', 'percent': 100}]}}]
        return [{'name': 'updates', 'schedule': '* * * * *', 'httpTarget': {'headers': {'private': 'MUST_NOT_APPEAR'}}}]
    monkeypatch.setattr(cost, 'gcloud_json', read)
    monkeypatch.setattr(cost, 'trigger_request', lambda *args: pytest.fail('Audit must not patch a trigger.'))
    report = cost.audit('repaido', 'us-central1', ['global', 'us-central1', 'global'])
    assert report['read_only'] and len(commands) == 6
    assert {command[:3] for command in commands} <= {
        ('builds', 'triggers', 'list'), ('builds', 'list', '--project=repaido'),
        ('run', 'services', 'list'), ('scheduler', 'jobs', 'list')}
    assert all('--limit=20' in command for command in commands if command[:2] == ('builds', 'list'))
    service = report['services'][0]
    assert service['service_min_instances'] == '1' and service['revision_min_instances'] == '2'
    assert service['revision_max_instances'] == '8' and service['cpu_throttling'] == 'false'
    assert 'MUST_NOT_APPEAR' not in json.dumps(report)


@pytest.mark.parametrize(('apply', 'disabled'), [(False, False), (False, True), (True, True)])
def test_disable_preview_and_already_disabled_trigger_never_write(monkeypatch, apply, disabled):
    requests = []
    def request(*args):
        requests.append(args)
        return {'id': 'prod', 'disabled': disabled}
    monkeypatch.setattr(cost, 'trigger_request', request)
    report = cost.disable_trigger('repaido', 'global', 'prod', apply)
    assert requests == [('GET', 'repaido', 'global', 'prod')]
    assert report['applied'] is False


def test_disable_changes_only_one_trigger_disabled_field_and_reads_receipt(monkeypatch):
    requests = []
    def request(*args):
        requests.append(args)
        return {'id': 'prod', 'disabled': len(requests) > 1}
    monkeypatch.setattr(cost, 'trigger_request', request)
    report = cost.disable_trigger('repaido', 'us-central1', 'prod', True)
    assert requests == [('GET', 'repaido', 'us-central1', 'prod'),
                        ('PATCH', 'repaido', 'us-central1', 'prod', {'disabled': True}),
                        ('GET', 'repaido', 'us-central1', 'prod')]
    assert report['applied'] is True and report['trigger']['disabled'] is True


def test_disable_unverified_state_fails_without_retry(monkeypatch):
    requests = []
    def request(*args):
        requests.append(args)
        return {'disabled': False}
    monkeypatch.setattr(cost, 'trigger_request', request)
    with pytest.raises(RuntimeError, match='could not be verified'):
        cost.disable_trigger('repaido', 'global', 'prod', True)
    assert len(requests) == 3


def test_trigger_patch_uses_narrow_field_mask_and_keeps_access_token_out_of_output(monkeypatch, capsys):
    captured = []
    monkeypatch.setattr(cost.subprocess, 'run', lambda *args, **kwargs:
                        SimpleNamespace(returncode=0, stdout='PRIVATE_TEST_TOKEN\n'))
    class Response:
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        def read(self):
            return b'{"disabled":true}'
    def open_request(request, **kwargs):
        captured.append(request)
        return Response()
    monkeypatch.setattr(cost.urllib.request, 'urlopen', open_request)
    assert cost.trigger_request('PATCH', 'repaido', 'global', 'prod', {'disabled': True}) == {'disabled': True}
    request = captured[0]
    assert request.get_method() == 'PATCH' and request.full_url.endswith('/prod?updateMask=disabled')
    assert json.loads(request.data) == {'disabled': True}
    assert 'PRIVATE_TEST_TOKEN' not in capsys.readouterr().out
