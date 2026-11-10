"""Publish a pinned website with a private backup, asset hashes and API gates."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import urllib.request
import uuid
import zipfile

from cpanel_client import Client

SITE = 'https://repaido.com'
PUBLIC = '/home/repaidoc/public_html'
ACCOUNT = '/home/repaidoc'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read(url):
    request = urllib.request.Request(url, headers={'Cache-Control': 'no-cache', 'Accept-Encoding': 'identity'})
    with urllib.request.urlopen(request, timeout=35) as response:
        return response.read()


def validate_path(name):
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or any(c in name for c in ',\r\n\\') or name != str(path):
        raise ValueError('Unsafe publication path: ' + name)
    if any(part.startswith('.') for part in path.parts) and name != '.htaccess':
        raise ValueError('Hidden website files cannot be published.')
    return path


def validate_archive(archive, manifest):
    with zipfile.ZipFile(archive) as package:
        names = [name for name in package.namelist() if not name.endswith('/')]
        if len(names) != len(set(names)) or set(names) != set(manifest['files']):
            raise ValueError('Archive entries do not match its manifest.')
        for name in names:
            validate_path(name)
            if (package.getinfo(name).external_attr >> 16) & 0o170000 != 0o100000:
                raise ValueError('Only regular files can be published.')
            if digest(package.read(name)) != manifest['files'][name]:
                raise ValueError('Archive content hash mismatch: ' + name)
    if digest(Path(archive).read_bytes()) != manifest['archive_sha256']:
        raise ValueError('Release archive hash mismatch.')


def publication_paths(manifest, changed_public):
    assets = sorted(name for name in manifest['files'] if name.startswith('assets/'))
    resources = sorted({path.removeprefix('web/public/') for path in changed_public
                        if path.startswith('web/public/') and path.removeprefix('web/public/') in manifest['files']
                        and path.removeprefix('web/public/') not in ('.htaccess', 'index.html', 'build-info.json')
                        and not path.removeprefix('web/public/').startswith('assets/')})
    # Removed public resources remain available to existing browser sessions.
    return list(dict.fromkeys([*assets, *resources, 'build-info.json', 'index.html']))


def health(manifest, build, fetch=read):
    for key in ('api_origin', 'work_api_origin'):
        expected = 'https://repaido-' + ('api' if key == 'api_origin' else 'work-api') + '-133610574058.us-central1.run.app'
        if manifest[key] != expected:
            raise ValueError('Unexpected API origin.')
        value = json.loads(fetch(expected + '/api/health'))
        if value.get('status') != 'ok' or value.get('build_id') != build:
            raise ValueError('Production API health/build check failed.')


def content(client, directory, name):
    return client.uapi('get_file_content', {'dir': directory, 'file': name, 'from_charset': 'UTF-8',
                        'to_charset': 'UTF-8', 'update_html_document_encoding': 0})['content'].encode()


def fileop(client, op, sources, destination=None):
    for offset in range(0, len(sources), 40):
        batch = sources[offset:offset + 40]
        args = {'op': op, 'sourcefiles': ','.join(batch), 'doubledecode': 0}
        if destination:
            args['destfiles'] = destination
        rows = client.api2('fileop', args)
        if len(rows) != len(batch) or any(int(row['result']) != 1 for row in rows):
            raise ValueError('cPanel did not confirm every ' + op + ' operation.')
        if {row['src'].removeprefix(ACCOUNT + '/') for row in rows} != set(batch):
            raise ValueError('cPanel returned unexpected source files.')
        if destination and any(row['dest'] != destination for row in rows):
            raise ValueError('cPanel returned an unexpected destination.')
        if op == 'extract' and any(term in rows[0].get('output', '').lower() for term in ('bad crc', 'cannot find', 'error:')):
            raise ValueError('Archive extraction reported an error.')


def publish(archive, baseline, api_build, *, client=None, fetch=read):
    archive = archive.resolve()
    manifest = json.loads(archive.with_suffix('.manifest.json').read_text())
    commit = manifest['commit']
    if not all(re.fullmatch(r'[a-f0-9]{40}', value) for value in (commit, baseline, manifest['required_api_commit'])):
        raise ValueError('Full reviewed source commits are required.')
    validate_archive(archive, manifest)
    repo = Path(__file__).resolve().parents[1]
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=repo, text=True).strip()
    if git('rev-parse', 'HEAD') != commit or git('status', '--porcelain'):
        raise ValueError('The archive must match a clean source checkout.')
    git('merge-base', '--is-ancestor', baseline, commit)
    if git('diff', '--name-only', baseline, commit, '--', 'deployment/cpanel/.htaccess'):
        raise ValueError('Apache rules changed; review the provider configuration before publication.')
    paths = publication_paths(manifest, git('diff', '--name-only', '--no-renames', baseline, commit, '--', 'web/public').splitlines())
    for path in paths:
        validate_path(path)
    health(manifest, api_build, fetch)
    client = client or Client()
    domain = client.request('/execute/DomainInfo/single_domain_data', {'domain': 'repaido.com'})
    if domain.get('status') != 1 or domain.get('data', {}).get('documentroot') != PUBLIC:
        raise ValueError('The production document root could not be confirmed.')
    previous_info = content(client, PUBLIC, 'build-info.json')
    previous = json.loads(previous_info)
    if previous['commit'] == commit and previous.get('required_api_commit') == manifest['required_api_commit']:
        for path in paths:
            if digest(fetch(SITE + '/' + path)) != manifest['files'][path]:
                raise ValueError('An already published release has different content: ' + path)
        print('This exact website release is already published and verified.')
        return
    if previous['commit'] != baseline:
        raise ValueError('Production changed after planning. Start a fresh release from its current baseline.')
    previous_index = content(client, PUBLIC, 'index.html')
    rules = content(client, PUBLIC, '.htaccess')
    private_name = 'repaido-ci-' + commit[:12] + '-' + uuid.uuid4().hex[:12]
    private = ACCOUNT + '/' + private_name
    state_path = archive.parent / 'publication.json'
    state = {'commit': commit, 'baseline': baseline, 'api_build': api_build, 'private_root': private,
             'backup': private + '/backup', 'paths': paths, 'htaccess_sha256': digest(rules), 'status': 'preparing_backup'}
    def save(status):
        state['status'] = status
        state['updated_at'] = datetime.now(timezone.utc).isoformat()
        state_path.write_text(json.dumps(state, indent=2) + '\n')
    created = set()
    def mkdir(path, mode='0700'):
        if path in created:
            return
        parent, name = path.rsplit('/', 1)
        client.api2('mkdir', {'path': parent, 'name': name, 'permissions': mode})
        created.add(path)
    def parents(base, path, mode='0700'):
        current = base
        for part in PurePosixPath(path).parent.parts:
            current += '/' + part
            mkdir(current, mode)
    save('preparing_backup')
    mkdir(private)
    mkdir(private + '/backup')
    mkdir(private + '/stage')
    mkdir(private + '/backup/assets')
    old_assets = client.listing(PUBLIC + '/assets')
    old_assets = [row for row in old_assets if row['type'] == 'file']
    if not old_assets:
        raise ValueError('No existing assets were found to back up.')
    for row in old_assets:
        validate_path('assets/' + row['file'])
    fileop(client, 'copy', ['public_html/assets/' + row['file'] for row in old_assets], private + '/backup/assets')
    fileop(client, 'copy', ['public_html/' + name for name in ('index.html', 'build-info.json', '.htaccess')], private + '/backup')
    for name, raw in (('index.html', previous_index), ('build-info.json', previous_info), ('.htaccess', rules)):
        if content(client, private + '/backup', name) != raw:
            raise ValueError('Backup content could not be verified: ' + name)
    copied = {row['file']: int(row['size']) for row in client.listing(private + '/backup/assets') if row['type'] == 'file'}
    if any(copied.get(row['file']) != int(row['size']) for row in old_assets):
        raise ValueError('Asset backup is incomplete.')
    # Back up any replaced public resources; unrelated files and uploads stay in place.
    resources = [p for p in paths if not p.startswith('assets/') and p not in ('index.html', 'build-info.json')]
    for path in resources:
        parent = str(PurePosixPath(path).parent)
        directory = PUBLIC + ('' if parent == '.' else '/' + parent)
        current = PUBLIC
        exists = True
        for part in PurePosixPath(path).parent.parts:
            if not any(r['file'] == part and r['type'] == 'dir' for r in client.listing(current)):
                exists = False
                break
            current += '/' + part
        rows = client.listing(directory) if exists else []
        row = next((r for r in rows if r['file'] == PurePosixPath(path).name and r['type'] == 'file'), None)
        if row:
            parents(private + '/backup', path)
            destination = private + '/backup' + ('' if parent == '.' else '/' + parent)
            fileop(client, 'copy', ['public_html/' + path], destination)
            backup_row = next(r for r in client.listing(destination) if r['file'] == row['file'])
            if int(backup_row['size']) != int(row['size']):
                raise ValueError('Public resource backup size mismatch.')
    save('backup_verified')
    payload = archive.parent / 'publication.zip'
    with zipfile.ZipFile(archive) as source, zipfile.ZipFile(payload, 'w', zipfile.ZIP_DEFLATED) as target:
        directories = sorted({str(parent) for path in paths for parent in PurePosixPath(path).parents if str(parent) != '.'})
        for directory in directories:
            entry = zipfile.ZipInfo(directory + '/'); entry.external_attr = (0o40755 << 16) | 0x10
            target.writestr(entry, b'')
        for path in paths:
            entry = zipfile.ZipInfo(path); entry.external_attr = 0o100644 << 16; entry.compress_type = zipfile.ZIP_DEFLATED
            target.writestr(entry, source.read(path))
    uploads = client.upload(payload, private + '/stage')['uploads']
    if len(uploads) != 1 or int(uploads[0]['status']) != 1 or int(uploads[0]['size']) != payload.stat().st_size:
        raise ValueError('Upload was not confirmed; inspect the private stage before retrying.')
    fileop(client, 'extract', [private_name + '/stage/' + payload.name], private + '/stage')
    with zipfile.ZipFile(payload) as source:
        for parent in {str(PurePosixPath(path).parent) for path in paths}:
            directory = private + '/stage' + ('' if parent == '.' else '/' + parent)
            inventory = {row['file']: row for row in client.listing(directory)}
            for path in paths:
                if str(PurePosixPath(path).parent) != parent:
                    continue
                row = inventory.get(PurePosixPath(path).name)
                if not row or row['type'] != 'file' or int(row['size']) != source.getinfo(path).file_size or row['nicemode'] != '0644':
                    raise ValueError('Staged file size or permission mismatch: ' + path)
    fileop(client, 'trash', [private_name + '/stage/' + payload.name])
    save('private_stage_verified')
    health(manifest, api_build, fetch)
    if content(client, PUBLIC, 'index.html') != previous_index or content(client, PUBLIC, '.htaccess') != rules:
        raise ValueError('Production changed during staging; nothing further will be published.')
    # Reuse existing public directories, creating only missing paths.
    public_dirs = {PUBLIC}
    def public_parents(path):
        current = PUBLIC
        for part in PurePosixPath(path).parent.parts:
            next_path = current + '/' + part
            if next_path not in public_dirs:
                if not any(row['file'] == part and row['type'] == 'dir' for row in client.listing(current)):
                    mkdir(next_path, '0755')
                public_dirs.add(next_path)
            current = next_path
        return current
    save('publishing_assets')
    for path in paths:
        if path in ('index.html', 'build-info.json'):
            continue
        fileop(client, 'copy', [private_name + '/stage/' + path], public_parents(path))
        if digest(fetch(SITE + '/' + path + '?release=' + commit)) != manifest['files'][path]:
            raise ValueError('Published resource hash mismatch: ' + path)
    save('resources_verified')
    health(manifest, api_build, fetch)
    if content(client, PUBLIC, 'index.html') != previous_index:
        raise ValueError('Another release changed production before entry publication.')
    for path in ('build-info.json', 'index.html'):
        fileop(client, 'copy', [private_name + '/stage/' + path], PUBLIC)
        if digest(fetch(SITE + '/' + path + '?release=' + commit)) != manifest['files'][path]:
            raise ValueError('Published entry hash mismatch; the private backup is retained.')
    if content(client, PUBLIC, '.htaccess') != rules:
        raise ValueError('Apache configuration changed during publication.')
    save('published')
    print('Website published:', commit, 'Backup:', private + '/backup', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--baseline', required=True)
    parser.add_argument('--api-build', required=True)
    args = parser.parse_args()
    publish(args.archive, args.baseline, args.api_build)
