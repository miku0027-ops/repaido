"""Offline safety and readiness diagnostics; never calls a cloud provider."""
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('bike_launch_check', ROOT/'scripts/check-bike-launch.py')
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


def service(env=None):
    return {'metadata': {'name': 'repaido-api'}, 'spec': {'template': {'spec': {
        'serviceAccountName': 'runtime@repaido.iam.gserviceaccount.com',
        'containers': [{'image': 'us-central1-docker.pkg.dev/repaido/backend/api@sha256:'+'a'*64,
            'env': env or []}]}}}, 'status': {'latestReadyRevisionName': 'repaido-api-001'}}


def value(**overrides):
    return {'service': service(), 'topic': {'name': check.TOPIC},
            'subscription': {'name': check.SUBSCRIPTION, 'topic': check.TOPIC,
                'enableMessageOrdering': True, 'expirationPolicy': {}},
            'workers': [], 'policy': {'bookings_available': False, 'enabled': False,
                'dispatch_ready': False, 'geography_ready': False, 'paid_ready': False,
                'routing_ready': True}, **overrides}


def test_report_redacts_raw_environment_contacts_coordinates_and_private_fields():
    data = value(service=service([
        {'name': 'REPAIDO_BIKE_PROMO_QUOTA_SECRET', 'value': 'must-never-print-private-key'},
        {'name': 'UNRELATED_PASSWORD', 'value': 'must-never-print-password'},
        {'name': 'REPAIDO_BIKE_PUBSUB_TOPIC', 'value': check.TOPIC},
        {'name': 'REPAIDO_BIKE_PUBSUB_SUBSCRIPTION', 'value': check.SUBSCRIPTION}]),
        policy={'bookings_available': False, 'phone': '+919111111111',
                'service_center': {'lat': 21.123456, 'lng': 86.654321},
                'evidence_reference': 'private-reference'},
        subscription={'name': check.SUBSCRIPTION, 'topic': check.TOPIC,
                      'pushConfig': {'pushEndpoint': 'https://example.test/?token=must-never-print-token'}})
    output = json.dumps(check.report(**data))
    for private in ('must-never-print', '919111111111', '21.123456', '86.654321', 'private-reference', 'pushEndpoint', 'UNRELATED_PASSWORD'):
        assert private not in output
    assert check.report(**data)['api']['quota_secret']['configured']
    assert not check.report(**data)['api']['quota_secret']['secret_manager_binding']


def test_absent_mode_is_effective_pubsub_not_an_invented_configuration_failure():
    data = check.service_summary(service())
    assert data['dispatch_mode'] == 'pubsub'
    assert data['dispatch_mode_explicitly_configured'] is False
    assert data['topic'] is None and data['subscription'] is None


@pytest.mark.parametrize('key,expected', [('1', True), ('latest', False), ('0', False), ('01', False)])
def test_quota_key_reports_binding_pinning_without_reading_the_secret(key, expected):
    result = check.service_summary(service([{'name': 'REPAIDO_BIKE_PROMO_QUOTA_SECRET',
        'valueFrom': {'secretKeyRef': {'name': 'private-secret-name', 'key': key}}}]))
    assert result['quota_secret']['pinned_numeric_version'] is expected
    assert 'private-secret-name' not in json.dumps(result)


@pytest.mark.parametrize('message,status', [
    ('NOT_FOUND: fixture resource does not exist', 'not_found'),
    ('PERMISSION_DENIED: private-response-do-not-print', 'permission_denied'),
    ('HTTP 401 ACCESS_TOKEN_TYPE_UNSUPPORTED private-response-do-not-print', 'authentication_failed'),
    ('Unexpected private-response-do-not-print', 'read_failed')])
def test_gcloud_failures_are_classified_without_echoing_provider_output(monkeypatch, message, status, capsys):
    monkeypatch.setattr(check.subprocess, 'run', lambda *a, **kw: SimpleNamespace(returncode=1, stdout='', stderr=message))
    assert check.gcloud('pubsub', 'topics', 'describe', check.TOPIC) == {'read_status': status}
    assert not capsys.readouterr().out


def test_explicit_format_projection_is_not_overridden(monkeypatch):
    seen = []
    def run(command, **kwargs):
        seen.append(command)
        return SimpleNamespace(returncode=0, stdout='{}', stderr='')
    monkeypatch.setattr(check.subprocess, 'run', run)
    check.gcloud('pubsub', 'topics', 'describe', check.TOPIC, '--format=json(name)')
    assert [part for part in seen[0] if part.startswith('--format=')] == ['--format=json(name)']


def test_server_blockers_remain_visible_and_default_contract_is_not_activation():
    result = check.report(**value())
    assert not result['bookings_available_reported_by_server']
    assert result['cloud_mutations'] is False and result['read_only'] is True
    assert any('healthy continuous' in text for text in result['findings'])
    assert any('operating circle' in text for text in result['findings'])
    assert any('funding readiness' in text for text in result['findings'])
    contract = result['agreed_launch_contract']
    assert contract['base_paise'] == 800 and contract['per_km_paise'] == 500
    assert contract['monthly_salary_paise_per_rider'] == 700000


def test_main_uses_only_project_scoped_metadata_reads_and_no_apply_option(monkeypatch, capsys):
    calls = []
    def cloud(*args):
        calls.append(args)
        if args[:3] == ('run', 'services', 'describe'):
            return service()
        if args[:2] == ('compute', 'instance-groups'):
            return []
        return {'read_status': 'not_found'}
    monkeypatch.setattr(check, 'gcloud', cloud)
    monkeypatch.setattr(check, 'public_policy', lambda: value()['policy'])
    monkeypatch.setattr('sys.argv', ['check-bike-launch.py'])
    assert check.main() == 0
    output = json.loads(capsys.readouterr().out)
    assert output['read_only'] and not output['cloud_mutations']
    assert len(calls) == 4
    assert all('--project=repaido' in command for command in calls)
    assert all(any(part.startswith('--format=json(') for part in command) for command in calls)
    assert all(not any(part in ('create', 'update', 'delete', 'enable', 'access', 'pull', 'publish') for part in command) for command in calls)
    monkeypatch.setattr('sys.argv', ['check-bike-launch.py', '--apply'])
    with pytest.raises(SystemExit) as failure:
        check.main()
    assert failure.value.code == 2 and len(calls) == 4
