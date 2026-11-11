"""Offline release-boundary and package integrity checks; no production calls."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import warnings
from unittest.mock import patch
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), ROOT / 'scripts' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


runner = load('production-release')
publisher = load('publish-cpanel-release')
bootstrap = load('bootstrap-github-production')


class BootstrapBillingTests(unittest.TestCase):
    def test_inactive_or_unknown_billing_stops_before_any_mutation(self):
        for billing in ({}, {'billingEnabled': False, 'billingAccountName': 'billingAccounts/closed'},
                        {'billingEnabled': True}, {'billingEnabled': 'true', 'billingAccountName': 'billingAccounts/test'}):
            with self.subTest(billing=billing), patch.object(bootstrap, 'gcloud', side_effect=[
                {'projectNumber': bootstrap.PROJECT_NUMBER}, billing,
            ]) as cloud:
                with self.assertRaisesRegex(ValueError, 'Billing is not active'):
                    bootstrap.setup()
                self.assertEqual(cloud.call_args_list, [
                    unittest.mock.call('projects', 'describe', 'repaido'),
                    unittest.mock.call('billing', 'projects', 'describe', 'repaido'),
                ])

    def test_active_project_billing_does_not_require_account_admin_permissions(self):
        with patch.object(bootstrap, 'gcloud', return_value={
            'billingEnabled': True, 'billingAccountName': 'billingAccounts/active',
        }) as cloud:
            bootstrap.check_billing()
            cloud.assert_called_once_with('billing', 'projects', 'describe', 'repaido')

    def test_enabled_services_are_not_reactivated(self):
        enabled = [{'config': {'name': name}} for name in bootstrap.REQUIRED_SERVICES]
        with patch.object(bootstrap, 'gcloud', return_value=enabled) as cloud:
            bootstrap.enable_missing_services()
            cloud.assert_called_once_with('services', 'list', '--enabled')

    def test_only_missing_services_are_enabled(self):
        enabled = [{'config': {'name': name}} for name in bootstrap.REQUIRED_SERVICES
                   if name != 'secretmanager.googleapis.com']
        with patch.object(bootstrap, 'gcloud', side_effect=[enabled, None]) as cloud:
            bootstrap.enable_missing_services()
            self.assertEqual(cloud.call_args_list[-1],
                             unittest.mock.call('services', 'enable', 'secretmanager.googleapis.com'))


class ReleaseBoundaryTests(unittest.TestCase):
    def test_only_main_from_the_expected_repository_can_deploy(self):
        valid = dict(GITHUB_REPOSITORY_ID='1404280702', GITHUB_REPOSITORY_OWNER_ID='332603370',
                     GITHUB_REF='refs/heads/main', GITHUB_EVENT_NAME='push', GITHUB_SHA='a' * 40)
        runner.require_main(valid)
        runner.require_main(dict(valid, GITHUB_EVENT_NAME='workflow_dispatch'))
        for key, value in [('GITHUB_REPOSITORY_ID', '111'), ('GITHUB_REPOSITORY_OWNER_ID', '111'),
                           ('GITHUB_REF', 'refs/heads/feature'), ('GITHUB_EVENT_NAME', 'pull_request'),
                           ('GITHUB_EVENT_NAME', 'pull_request_target'), ('GITHUB_SHA', 'short')]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                runner.require_main(dict(valid, **{key: value}))

    def test_ui_only_changes_reuse_the_api(self):
        self.assertEqual(runner.components(['web/src/App.tsx'], ['web/src/App.tsx']),
                         {'api': False, 'rules': False, 'web': True})

    def test_partial_release_uses_separate_live_baselines(self):
        # API already moved, but the previous website publication failed.
        self.assertEqual(runner.components(['backend/main.py', 'web/src/App.tsx'], []),
                         {'api': False, 'rules': False, 'web': True})

    def test_backend_and_rule_changes_keep_their_checks(self):
        self.assertEqual(runner.components([], ['backend/main.py']), {'api': True, 'rules': False, 'web': True})
        self.assertEqual(runner.components(['firestore.rules'], []), {'api': False, 'rules': True, 'web': True})
        self.assertEqual(runner.components([], ['cloudbuild-api.yaml']), {'api': True, 'rules': True, 'web': True})

    def test_unsupported_changes_fail_instead_of_silently_disappearing(self):
        for path in ('firestore.indexes.json', 'engineering/server.py'):
            with self.subTest(path=path), self.assertRaises(ValueError):
                runner.components([path], [])

    def test_docs_and_setup_do_not_rebuild_but_explicit_recovery_does(self):
        paths = ['docs/GITHUB_DEPLOYMENT.md', 'scripts/bootstrap-github-production.py', '.github/workflows/production.yml']
        self.assertEqual(runner.components(paths, paths), {'api': False, 'rules': False, 'web': False})
        self.assertEqual(runner.components([], [], True), {'api': True, 'rules': False, 'web': True})

    def test_already_published_rules_are_not_rebuilt_for_later_doc_changes(self):
        self.assertEqual(runner.components(['docs/README.md'], ['firestore.rules', 'docs/README.md']),
                         {'api': False, 'rules': False, 'web': False})

    def test_temporary_oidc_files_are_rejected_from_build_source(self):
        source = load('check-build-source')
        with self.assertRaises(ValueError):
            source.validate([*source.REQUIRED, 'gha-creds-test.json'])

    def test_only_matching_legacy_production_triggers_are_disabled(self):
        trigger = dict(github={'owner': 'miku0027-ops', 'name': 'repaido', 'push': {'branch': '^main$'}}, filename='cloudbuild.yaml')
        self.assertTrue(bootstrap.matches_legacy_trigger(trigger))
        self.assertFalse(bootstrap.matches_legacy_trigger(dict(trigger, filename='engineering/cloudbuild.yaml')))
        self.assertFalse(bootstrap.matches_legacy_trigger(dict(trigger, disabled=True)))
        self.assertFalse(bootstrap.matches_legacy_trigger(dict(trigger, github={'owner': 'someone', 'name': 'repaido', 'push': {}})))

    def test_oidc_is_bound_to_ids_main_workflow_and_production_environment(self):
        for claim in ("assertion.repository_id == '1404280702'", "assertion.repository_owner_id == '332603370'",
                      "assertion.ref == 'refs/heads/main'", "assertion.workflow_ref == 'miku0027-ops/repaido/.github/workflows/production.yml@refs/heads/main'",
                      "assertion.sub == 'repo:miku0027-ops/repaido:environment:production'"):
            self.assertIn(claim, bootstrap.PROVIDER_CONDITION)


class PublicationTests(unittest.TestCase):
    def test_failed_or_wrong_api_build_cannot_pass_the_gate(self):
        manifest = dict(api_origin=runner.API_ORIGINS[0], work_api_origin=runner.API_ORIGINS[1])
        publisher.health(manifest, 'reviewed', lambda url: json.dumps({'status': 'ok', 'build_id': 'reviewed'}).encode())
        for body in ({'status': 'error', 'build_id': 'reviewed'}, {'status': 'ok', 'build_id': 'old'}):
            with self.assertRaises(ValueError):
                publisher.health(manifest, 'reviewed', lambda url: json.dumps(body).encode())

    def test_asset_first_entry_last_preserves_provider_rules_and_old_resources(self):
        manifest = {'files': {'assets/new.js': '', 'index.html': '', 'build-info.json': '', '.htaccess': '', 'images/new.jpg': '', 'unchanged.apk': ''}}
        self.assertEqual(publisher.publication_paths(manifest, ['web/public/images/new.jpg', 'web/public/deleted.png', 'web/public/.htaccess', 'web/public/index.html']),
                         ['assets/new.js', 'images/new.jpg', 'build-info.json', 'index.html'])

    def test_archive_rejects_traversal_links_duplicates_and_bad_hashes(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / 'release.zip'
            def write(name, mode=0o100644):
                with zipfile.ZipFile(archive, 'w') as package:
                    entry = zipfile.ZipInfo(name); entry.external_attr = mode << 16
                    package.writestr(entry, b'test')
                return {'files': {name: publisher.digest(b'test')}, 'archive_sha256': publisher.digest(archive.read_bytes())}
            manifest = write('assets/good.js'); publisher.validate_archive(archive, manifest)
            manifest['files']['assets/good.js'] = 'bad'
            with self.assertRaises(ValueError): publisher.validate_archive(archive, manifest)
            for name, mode in [('../outside', 0o100644), ('/absolute', 0o100644), ('assets/link', 0o120777), ('.env', 0o100644)]:
                manifest = write(name, mode)
                with self.subTest(name=name), self.assertRaises(ValueError): publisher.validate_archive(archive, manifest)
            manifest = write('assets/duplicate.js')
            with warnings.catch_warnings():
                warnings.simplefilter('ignore', UserWarning)
                with zipfile.ZipFile(archive, 'a') as package: package.writestr('assets/duplicate.js', b'test')
            manifest['archive_sha256'] = publisher.digest(archive.read_bytes())
            with self.assertRaises(ValueError): publisher.validate_archive(archive, manifest)

    def test_cpanel_partial_or_redirected_copy_is_rejected(self):
        class FakeClient:
            def api2(self, operation, params): return [{'result': 1, 'src': '/home/repaidoc/a', 'dest': '/unexpected'}]
        with self.assertRaises(ValueError): publisher.fileop(FakeClient(), 'copy', ['a'], '/intended')


class PublicationSequenceTests(unittest.TestCase):
    def test_backup_stage_hashes_entry_order_and_idempotent_retry(self):
        from urllib.parse import urlsplit
        import io
        commit, baseline = 'a' * 40, 'b' * 40
        info = dict(commit=commit, required_api_commit=baseline, api_origin=runner.API_ORIGINS[0],
                    work_api_origin=runner.API_ORIGINS[1])
        old_info = json.dumps(dict(info, commit=baseline)).encode()
        original_rules = b'provider redirect and security rules'
        public = publisher.PUBLIC

        class FakeClient:
            def __init__(self):
                self.files = {public + '/index.html': b'old-index', public + '/build-info.json': old_info,
                              public + '/.htaccess': original_rules, public + '/assets/old.js': b'old-js'}
                self.dirs = {publisher.ACCOUNT, public, public + '/assets'}
                self.mutations = []
            def request(self, path, params):
                return {'status': 1, 'data': {'documentroot': public}}
            def listing(self, directory):
                self.assert_directory(directory)
                prefix = directory + '/'
                rows = []
                for name in self.dirs:
                    if name.startswith(prefix) and '/' not in name[len(prefix):]:
                        rows.append({'file': name[len(prefix):], 'type': 'dir', 'size': 0, 'nicemode': '0755'})
                for name, raw in self.files.items():
                    if name.startswith(prefix) and '/' not in name[len(prefix):]:
                        rows.append({'file': name[len(prefix):], 'type': 'file', 'size': len(raw), 'nicemode': '0644'})
                return rows
            def assert_directory(self, directory):
                if directory not in self.dirs: raise ValueError('Directory does not exist: ' + directory)
            def uapi(self, operation, params):
                return {'content': self.files[params['dir'] + '/' + params['file']].decode()}
            def upload(self, filename, directory):
                self.files[directory + '/' + filename.name] = filename.read_bytes()
                return {'uploads': [{'status': 1, 'size': filename.stat().st_size}]}
            def api2(self, operation, params):
                self.mutations.append((operation, dict(params)))
                if operation == 'mkdir':
                    self.assert_directory(params['path'])
                    target = params['path'] + '/' + params['name']
                    if target in self.dirs: raise ValueError('Unexpected duplicate directory creation')
                    self.dirs.add(target)
                    return []
                result = []
                for source in params['sourcefiles'].split(','):
                    path = publisher.ACCOUNT + '/' + source
                    destination = params.get('destfiles')
                    if params['op'] == 'copy':
                        self.assert_directory(destination)
                        self.files[destination + '/' + PurePosixPath(source).name] = self.files[path]
                    elif params['op'] == 'extract':
                        with zipfile.ZipFile(io.BytesIO(self.files[path])) as package:
                            for name in package.namelist():
                                target = destination + '/' + name.rstrip('/')
                                if name.endswith('/'): self.dirs.add(target)
                                else: self.files[target] = package.read(name)
                    elif params['op'] == 'trash':
                        del self.files[path]
                    result.append(dict(result=1, src=path, dest=destination))
                return result
        from pathlib import PurePosixPath
        client = FakeClient()
        def fetch(url):
            path = urlsplit(url).path
            if path == '/api/health': return json.dumps({'status': 'ok', 'build_id': 'verified'}).encode()
            return client.files[public + path]
        def git(args, **kwargs):
            if args[1:3] == ['rev-parse', 'HEAD']: return commit
            if args[1] == 'diff' and args[-1] == 'web/public': return 'web/public/new/nested.txt'
            return ''
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / 'release.zip'
            files = {'index.html': b'new-index', 'build-info.json': json.dumps(info).encode(),
                     '.htaccess': b'archive rules never overwrite provider rules',
                     'assets/new.js': b'new-js', 'new/nested.txt': b'new public resource'}
            with zipfile.ZipFile(archive, 'w') as package:
                for name, raw in files.items():
                    entry = zipfile.ZipInfo(name); entry.external_attr = 0o100644 << 16
                    package.writestr(entry, raw)
            manifest = dict(info, files={name: publisher.digest(raw) for name, raw in files.items()},
                            archive_sha256=publisher.digest(archive.read_bytes()))
            archive.with_suffix('.manifest.json').write_text(json.dumps(manifest))
            with patch.object(publisher.subprocess, 'check_output', side_effect=git):
                publisher.publish(archive, baseline, 'verified', client=client, fetch=fetch)
                mutations = len(client.mutations)
                publisher.publish(archive, baseline, 'verified', client=client, fetch=fetch)
                self.assertEqual(len(client.mutations), mutations, 'An identical retry must not publish twice')
            state = json.loads((Path(directory) / 'publication.json').read_text())
            self.assertEqual(state['status'], 'published')
            self.assertEqual(client.files[state['backup'] + '/index.html'], b'old-index')
            self.assertEqual(client.files[state['backup'] + '/assets/old.js'], b'old-js')
            self.assertEqual(client.files[public + '/.htaccess'], original_rules)
            self.assertEqual(client.files[public + '/assets/old.js'], b'old-js')
            copies = [params for operation, params in client.mutations if operation == 'fileop' and params['op'] == 'copy']
            live = [params for params in copies if params.get('destfiles', '').startswith(public)]
            self.assertTrue(live[-1]['sourcefiles'].endswith('/index.html'))
            self.assertTrue(live[-2]['sourcefiles'].endswith('/build-info.json'))
            self.assertTrue(all('/backup' in params['destfiles'] for params in copies[:2]))
            # The gate must fail before authentication or any private/public write.
            broken = FakeClient()
            with patch.object(publisher.subprocess, 'check_output', side_effect=git), self.assertRaises(ValueError):
                publisher.publish(archive, baseline, 'verified', client=broken,
                                  fetch=lambda url: json.dumps({'status': 'error', 'build_id': 'verified'}).encode())
            self.assertEqual(broken.mutations, [])


if __name__ == '__main__':
    unittest.main()
