"""Release guard, routing and access checks without production writes."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[1]


def script(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), ROOT / 'scripts' / name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


verifier = script('verify-cpanel-release.py')
package = script('package-cpanel-release.py')
inventory = script('check-build-source.py')
access = script('check-cpanel-access.py')
COMMIT = 'a' * 40


def test_cpanel_checks_actual_site_api_identity_and_authentication(monkeypatch, capsys):
    requested = []
    page = b'<div id="root"></div><script src="/assets/index-abcd1234.js"></script>'
    def read(url, method='GET', headers=None):
        requested.append((url, method, headers))
        if url.startswith('https://repaido.com/build-info.json'):
            info = {'commit': COMMIT, 'target': 'cpanel',
                    'api_origin': 'https://repaido-api-133610574058.us-central1.run.app',
                    'work_api_origin': 'https://repaido-work-api-133610574058.us-central1.run.app'}
            return 200, {'Content-Type': 'application/json'}, json.dumps(info).encode()
        if url.endswith('/api/health'):
            return 200, {}, json.dumps({'status': 'ok', 'build_id': 'verified-build'}).encode()
        if method == 'OPTIONS':
            return 200, {'Access-Control-Allow-Origin': 'https://repaido.com'}, b''
        if url.endswith('/professional/workspace') or url.endswith('/work/preferences'):
            return 401, {}, b'{}'
        if url.endswith('/assets/release-does-not-exist.js'):
            return 404, {}, b'not found'
        if url.endswith('/assets/index-abcd1234.js'):
            return 200, {}, b'console.log("built asset")'
        return 200, {}, page
    monkeypatch.setattr(verifier, 'read', read)
    verifier.verify(COMMIT, 'verified-build')
    assert any('/worker?mode=driver' in url for url, _, _ in requested)
    assert sum(method == 'OPTIONS' for _, method, _ in requested) == 2
    with pytest.raises(ValueError, match='API build does not match'):
        verifier.verify(COMMIT, 'other-build')
    assert 'verified' in capsys.readouterr().out


def test_cpanel_verifier_rejects_spa_html_as_missing_release_metadata(monkeypatch):
    monkeypatch.setattr(verifier, 'read', lambda *args, **kwargs: (200, {'Content-Type': 'text/html'}, b'<html>old site</html>'))
    with pytest.raises(ValueError, match='release metadata'):
        verifier.verify(COMMIT, 'build')


def test_package_rejects_unreviewed_source_before_build_or_output(tmp_path, monkeypatch):
    # Cloud Build's source upload has no .git directory or Git CLI. Model a
    # mismatched checkout without adding a dependency to the API test image.
    monkeypatch.setattr(package.subprocess, 'check_output', lambda *args, **kwargs: 'b' * 40 + '\n')
    with pytest.raises(ValueError, match='clean checkout'):
        package.build(COMMIT, tmp_path / 'release.zip', 'https://main.test', 'https://work.test')
    assert not list(tmp_path.iterdir())


def test_website_only_package_records_its_existing_api_commit(tmp_path, monkeypatch):
    root = tmp_path / 'source'
    assets = root / 'web/dist-cpanel/assets'
    assets.mkdir(parents=True)
    (assets / 'index-one.js').write_text('https://main.test https://work.test')
    (root / 'web/dist-cpanel/index.html').write_text('<div id="root"></div>')
    deployment = root / 'deployment/cpanel'
    deployment.mkdir(parents=True)
    (deployment / '.htaccess').write_text('Options -Indexes\n')
    monkeypatch.setattr(package, 'ROOT', root)
    monkeypatch.setattr(package.subprocess, 'check_output', lambda args, **kwargs: '' if args[1] == 'status' else COMMIT)
    commands = []
    monkeypatch.setattr(package.subprocess, 'run', lambda args, **kwargs: commands.append(args))
    package.build(COMMIT, tmp_path / 'release.zip', 'https://main.test', 'https://work.test', 'b' * 40)
    manifest = json.loads((tmp_path / 'release.manifest.json').read_text())
    assert manifest['commit'] == COMMIT
    assert manifest['required_api_commit'] == 'b' * 40
    assert commands == [['npm', 'run', 'build:cpanel']]
    assert 'assets/index-one.js' in manifest['files']
    with pytest.raises(ValueError, match='API source commit'):
        package.build(COMMIT, tmp_path / 'invalid.zip', 'https://main.test', 'https://work.test', 'short-ref')


@pytest.mark.parametrize('origin', ['http://main.test', 'https://main.test/api', 'https://user:password@main.test', 'https://main.test?token=one'])
def test_package_rejects_insecure_or_credentialed_api_origins(origin):
    with pytest.raises(ValueError, match='HTTPS origins'):
        package.https_origin(origin)


def test_cpanel_access_requires_a_secure_binding_without_secret_output(monkeypatch):
    monkeypatch.delenv('CPANEL_API_TOKEN', raising=False)
    monkeypatch.setenv('CPANEL_HOST', 'cpanel.repaido.com')
    monkeypatch.setenv('CPANEL_USERNAME', 'repaidoc')
    with pytest.raises(ValueError, match='CPANEL_API_TOKEN is missing'):
        access.check()


def fake_release_tools(tmp_path, *, rule_change='', active=''):
    bindir = tmp_path / 'bin'
    bindir.mkdir()
    log = tmp_path / 'cloud-calls'
    for name, code in {
        'git': f'''#!/usr/bin/env python3
import sys
a=sys.argv[1:]
if a[0]=='rev-parse': print({COMMIT!r})
elif a[0]=='diff': print({rule_change!r}, end='')
elif a[0] not in ('status','merge-base'): raise SystemExit(9)
''',
        'gcloud': f'''#!/usr/bin/env python3
import sys
from pathlib import Path
a=sys.argv[1:]
with Path({str(log)!r}).open('a') as f: f.write(' '.join(a)+'\\n')
if a[:2]==['meta','list-files-for-upload']: print({chr(10).join(sorted(inventory.REQUIRED))!r})
elif a[:2]==['builds','list']: print({active!r},end='')
elif a[:2]!=['builds','submit']: raise SystemExit(9)
''',
    }.items():
        path = bindir / name
        path.write_text(code)
        path.chmod(0o755)
    return dict(os.environ, PATH=str(bindir) + os.pathsep + os.environ['PATH']), log


def run_release(env):
    return subprocess.run(['bash', str(ROOT / 'scripts/release-cpanel-backend.sh'),
                           '--release', COMMIT, '--changed-from', 'b' * 40],
                          env=env, capture_output=True, text=True)


def test_api_only_cpanel_release_refuses_omitted_rules(tmp_path):
    env, log = fake_release_tools(tmp_path, rule_change='firestore.rules')
    result = run_release(env)
    assert result.returncode != 0 and 'Rules or indexes also changed' in result.stderr
    assert not log.exists()


def test_cpanel_release_refuses_another_active_build(tmp_path):
    env, log = fake_release_tools(tmp_path, active='existing-active-build')
    result = run_release(env)
    assert result.returncode != 0 and 'Another build is active' in result.stderr
    assert 'builds submit' not in log.read_text()


def test_cpanel_release_submits_one_api_pipeline_without_hosting(tmp_path):
    env, log = fake_release_tools(tmp_path)
    result = run_release(env)
    assert result.returncode == 0, result.stderr
    submits = [line for line in log.read_text().splitlines() if line.startswith('builds submit')]
    assert len(submits) == 1
    assert '--config=cloudbuild-api.yaml' in submits[0]
    assert '_RELEASE_APPROVED=true,COMMIT_SHA=' + COMMIT in submits[0]
    assert 'firebase deploy' not in log.read_text()
