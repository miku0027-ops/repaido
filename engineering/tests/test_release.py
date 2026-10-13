import hashlib
import io
import json
import tarfile
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from engineering import release
from engineering.server.app import create_app
from engineering.server.catalog import Catalog


def test_offline_plan_cannot_call_cloud(monkeypatch, capsys):
    monkeypatch.setattr('sys.argv', ['release.py', '--engineer-email=engineer@example.test'])
    monkeypatch.setattr(release, 'command', lambda *a, **k: pytest.fail('Offline plan must not run commands'))
    release.main()
    assert json.loads(capsys.readouterr().out)['customer_deployment'] is False


def test_access_grant_preserves_other_claims_and_is_idempotent(monkeypatch):
    user = {'localId': 'existing', 'email': 'engineer@example.test',
            'customAttributes': json.dumps({'admin': True, 'contractor': 'approved'})}
    writes = []

    def request(path, *, body):
        if path.endswith(':lookup'):
            return {'users': [dict(user)]}
        assert path.endswith(':update')
        writes.append(body)
        user['customAttributes'] = body['customAttributes']
        return {}

    monkeypatch.setattr(release, 'google_request', request)
    release.grant_engineers([dict(user)])
    release.grant_engineers([dict(user)])
    assert len(writes) == 1
    assert json.loads(writes[0]['customAttributes']) == {
        'admin': True, 'contractor': 'approved', 'engineer': True}
    assert int(writes[0]['validSince']) > 0
    assert 'password' not in writes[0]


@pytest.mark.parametrize('users', [[], [{'localId': 'u', 'email': 'engineer@example.test', 'disabled': True}],
                                  [{'localId': 'u', 'email': 'different@example.test'}]])
def test_missing_disabled_or_different_account_never_gets_access(monkeypatch, users):
    def lookup(path, *, body):
        assert path.endswith(':lookup')
        return {'users': users}
    monkeypatch.setattr(release, 'google_request', lookup)
    with pytest.raises(release.ReleaseError, match='active existing'):
        release.resolve_engineers(['engineer@example.test'])


def test_explicit_deferral_keeps_only_active_accounts_and_reports_pending(monkeypatch, capsys):
    active = {'localId': 'active-uid', 'email': 'active@example.test'}
    responses = {
        'active@example.test': [active],
        'missing@example.test': [],
        'disabled@example.test': [{'localId': 'disabled-uid', 'email': 'disabled@example.test', 'disabled': True}],
    }
    def lookup(path, *, body):
        assert path.endswith(':lookup'), 'Deferral must never create or change an account'
        return {'users': responses[body['email'][0]]}
    monkeypatch.setattr(release, 'google_request', lookup)
    assert release.resolve_engineers(list(responses), defer_unavailable=True) == [active]
    output = capsys.readouterr().out
    assert 'missing@example.test (no Firebase account found)' in output
    assert 'disabled@example.test (Firebase account is disabled)' in output
    assert output.count('No access granted to this account.') == 2


def test_deferral_cannot_release_with_no_active_engineer(monkeypatch):
    monkeypatch.setattr(release, 'google_request', lambda *a, **k: {'users': []})
    with pytest.raises(release.ReleaseError, match='At least one active existing engineer'):
        release.resolve_engineers(['missing@example.test'], defer_unavailable=True)


def test_deferral_does_not_hide_an_account_identity_mismatch(monkeypatch):
    monkeypatch.setattr(release, 'google_request', lambda *a, **k: {
        'users': [{'localId': 'wrong', 'email': 'someone-else@example.test'}]})
    with pytest.raises(release.ReleaseError, match='active existing'):
        release.resolve_engineers(['engineer@example.test'], defer_unavailable=True)


def test_access_only_grants_claim_without_build_or_deployment(monkeypatch, capsys):
    monkeypatch.setattr('sys.argv', ['release.py', '--grant-access', '--engineer-email=engineer@example.test'])
    monkeypatch.setattr(release.shutil, 'which', lambda binary: '/tool/gcloud')
    def forbidden(*args, **kwargs):
        pytest.fail('Access-only must not run release, checkout, IAM or build operations')
    for name in ('gcloud', 'command', 'bootstrap', 'build_image', 'deploy', 'stage_source'):
        monkeypatch.setattr(release, name, forbidden)
    writes = []
    def request(path, *, body):
        if path.endswith(':lookup'):
            return {'users': [{'localId': 'existing', 'email': 'engineer@example.test',
                'customAttributes': '{"contractor":true}'}]}
        assert path.endswith(':update')
        writes.append(body)
        return {}
    monkeypatch.setattr(release, 'google_request', request)
    release.main()
    assert json.loads(writes[0]['customAttributes']) == {'contractor': True, 'engineer': True}
    assert len(writes) == 1
    assert 'No build or deployment was started.' in capsys.readouterr().out


def test_access_only_cannot_defer_unavailable_accounts(monkeypatch):
    monkeypatch.setattr('sys.argv', ['release.py', '--grant-access', '--defer-unavailable-engineers',
        '--engineer-email=engineer@example.test'])
    with pytest.raises(SystemExit) as caught:
        release.main()
    assert caught.value.code == 2


def test_authorized_domains_keeps_existing_customer_domains(monkeypatch):
    config = {'authorizedDomains': ['repaido.web.app', 'repaido.firebaseapp.com']}
    def request(path, **kwargs):
        if kwargs:
            assert kwargs['method'] == 'PATCH'
            assert path.endswith('?updateMask=authorizedDomains')
            config.update(kwargs['body'])
        return dict(config)
    monkeypatch.setattr(release, 'google_request', request)
    release.authorize_domains(['https://repaido-engineering-fixture-uc.a.run.app',
        'https://repaido-engineering-123.us-central1.run.app'])
    assert set(config['authorizedDomains']) == {'repaido.web.app', 'repaido.firebaseapp.com',
        'repaido-engineering-fixture-uc.a.run.app', 'repaido-engineering-123.us-central1.run.app'}


def test_console_origins_use_cloud_run_declared_urls_without_guessing():
    legacy = 'https://repaido-engineering-fixture-uc.a.run.app'
    numbered = 'https://repaido-engineering-123.us-central1.run.app'
    service = {'uri': legacy, 'urls': [numbered, legacy]}
    assert release.console_origins(service) == [legacy, numbered]
    assert release.console_origins({'uri': legacy}) == [legacy]
    service['urls'] = ['https://unrelated.example.test']
    with pytest.raises(release.ReleaseError, match='unexpected console origin'):
        release.console_origins(service)


def test_release_archive_omits_private_and_local_files_and_detects_missing_source(tmp_path, monkeypatch):
    commit = 'a' * 40
    files = {path: b'reviewed source' for path in release.REQUIRED_SOURCE}
    files.update({'infra/main.tf': b'resource "fixture" "test" {}',
                  'engineering/.env.production': b'secret-canary',
                  'engineering/service-account.json': b'secret-canary',
                  'engineering/web/node_modules/private.js': b'local-output'})
    selected = []
    def git(args, **kwargs):
        if 'ls-tree' in args:
            return b'\0'.join(b'100644 blob hash\t' + name.encode() for name in files) + b'\0'
        assert 'archive' in args
        selected.extend(args[args.index('--') + 1:])
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode='w') as archive:
            for name in selected:
                info = tarfile.TarInfo(name)
                info.size = len(files[name])
                archive.addfile(info, io.BytesIO(files[name]))
        return stream.getvalue()
    monkeypatch.setattr(release.subprocess, 'check_output', git)
    release.stage_source(commit, tmp_path)
    release.check_build(commit, 'true', tmp_path)
    assert all('secret-canary' not in file.read_text() for file in tmp_path.rglob('*') if file.is_file())
    (tmp_path / 'engineering/server/app.py').write_text('unexpected change')
    with pytest.raises(release.ReleaseError, match='changed or was filtered'):
        release.check_build(commit, 'true', tmp_path)
    with pytest.raises(release.ReleaseError, match='explicitly approved'):
        release.check_build(commit, 'false', tmp_path)


def test_promotion_check_rejects_disconnected_collectors_and_open_api():
    commit, build = 'a' * 40, 'build-fixture'
    checks = {'engineer_accounts': True,
        'collectors': dict.fromkeys(['inventory', 'events', 'metrics', 'traces'], 'connected')}
    leaked = False
    def read(url, **kwargs):
        headers = {'X-Frame-Options': 'DENY'}
        if url.endswith('/health'):
            return 200, json.dumps({'source_revision': commit, 'build_id': build,
                'release_checks': checks}).encode(), headers
        if url.endswith('/config'):
            return 200, json.dumps({'local_preview': False, 'firebase': {
                'projectId': 'repaido', 'apiKey': 'public-config',
                'authDomain': 'repaido.firebaseapp.com', 'appId': 'fixture'}}).encode(), headers
        if '/engineering-api/' in url:
            return (200 if leaked else 401), b'{}', headers
        return 200, b'<script src="/assets/app.js"></script>', headers
    release.verify_release('https://fixture.run.app', commit, build, read)
    checks['collectors']['inventory'] = 'unavailable'
    with pytest.raises(release.ReleaseError, match='Live cloud checks'):
        release.verify_release('https://fixture.run.app', commit, build, read)
    checks['collectors']['inventory'] = 'connected'
    leaked = True
    with pytest.raises(release.ReleaseError, match='did not reject'):
        release.verify_release('https://fixture.run.app', commit, build, read)


@pytest.mark.parametrize('disabled', [False, True])
def test_runtime_checks_actual_identity_without_exposing_account_data(tmp_path, monkeypatch, disabled):
    from engineering.server import app as module
    monkeypatch.setenv('ENGINEERING_RELEASE_CHECK_UIDS', 'private-uid')
    monkeypatch.setenv('ENGINEERING_BUILD_ID', 'build-fixture')
    calls = []
    monkeypatch.setattr(module, 'firebase_app', lambda project: 'attached-runtime')
    def get_user(uid, *, app):
        calls.append((uid, app))
        return SimpleNamespace(disabled=disabled, custom_claims={'engineer': True})
    monkeypatch.setattr(module.auth, 'get_user', get_user)
    cloud = SimpleNamespace(snapshot=lambda: {key: {'state': 'connected', 'data': {'private': 'canary'}}
        for key in ('inventory', 'metrics', 'events', 'traces')})
    app = create_app(root=tmp_path, catalog=Catalog(tmp_path), cloud=cloud, preview=False)
    with TestClient(app) as client:
        result = client.get('/health')
        assert result.json()['release_checks']['engineer_accounts'] is (not disabled)
        assert result.json()['build_id'] == 'build-fixture'
        assert 'private-uid' not in result.text and 'canary' not in result.text
        assert client.get('/engineering-api/blueprint').status_code == 401
    assert calls == [('private-uid', 'attached-runtime')]
