"""Offline checks for the manual, component-scoped release planner."""
import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def script(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), ROOT / 'scripts' / name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


planner = script('plan-release.py')
generator = script('generate-selective-builds.py')
verifier = script('verify-release.py')


@pytest.mark.parametrize(('paths', 'target'), [
    (['web/src/App.tsx'], 'web'),
    (['backend/main.py'], 'api'),
    (['firestore.rules'], 'rules'),
    (['web/src/App.tsx', 'backend/main.py'], 'full'),
    (['web/src/App.tsx', 'firestore.rules'], 'full'),
    (['scripts/deploy-work-services.py'], 'full'),
    (['unknown-root-config'], 'full'),
    (['engineering/server/app.py'], 'engineering'),
    (['engineering/server/app.py', 'web/src/App.tsx'], 'web'),
    (['docs/CLOUD_BUILD.md', 'android/app/build.gradle'], 'none'),
])
def test_selects_only_independently_deployable_changes(paths, target):
    assert planner.classify(paths) == target


def test_indexes_cannot_be_silently_omitted():
    with pytest.raises(ValueError, match='indexes are not deployed'):
        planner.classify(['firestore.indexes.json', 'web/src/App.tsx'])


def test_selective_configs_match_canonical_steps_and_keep_manual_gate():
    source = (ROOT / 'cloudbuild.yaml').read_text()
    for target in generator.PIPELINES:
        config = generator.render(target, source)
        assert (ROOT / f'cloudbuild-{target}.yaml').read_text() == config
        assert config.index('id: require-explicit-release') < config.index('id: await-release-turn')
        assert "_RELEASE_APPROVED: 'false'" in config
        if target != 'rules':
            assert 'id: verify-selective-release' in config
        else:
            assert 'id: deploy-firestore-rules' in config
    web = generator.render('web', source)
    api = generator.render('api', source)
    rules = generator.render('rules', source)
    assert 'id: build-api' not in web and 'id: backend-tests' not in web
    assert 'firebase emulators:exec' not in web and 'openjdk' not in web
    assert 'id: deploy-firebase-hosting' not in api and 'id: web-tests-and-build' not in api
    assert 'id: build-api' not in rules and 'id: web-tests-and-build' not in rules
    assert 'firebase emulators:exec' in rules


def test_verification_allows_distinct_build_ids_across_partial_releases():
    calls = []

    def fetch(url):
        calls.append(url)
        if url.endswith('/build-info.json?build=web-build'):
            return {'build_id': 'web-build', 'commit': 'a' * 40}
        if url.endswith('/api/health?build=api-build'):
            return {'status': 'ok', 'build_id': 'api-build'}
        if url.endswith('/api/repaidians/work/health?build=api-build'):
            return {'status': 'ok', 'build_id': 'api-build', 'storage': 'firestore'}
        raise AssertionError('Unexpected release probe')

    verifier.verify('web', 'web-build', 'a' * 40, fetch=fetch, retries=1)
    verifier.verify('api', 'api-build', 'b' * 40, fetch=fetch, retries=1)
    assert len(calls) == 3


def test_web_release_rejects_stale_site_content():
    with pytest.raises(AssertionError):
        verifier.verify('web', 'new-build', 'a' * 40,
                        fetch=lambda url: {'build_id': 'old-build', 'commit': 'a' * 40}, retries=1)
