"""Build a pinned cPanel website archive; makes no deployment or cloud calls."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
from datetime import datetime, timezone
from urllib.parse import urlsplit
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def https_origin(value):
    parsed = urlsplit(value)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.path not in ('', '/') or parsed.query or parsed.fragment:
        raise ValueError('API endpoints must be HTTPS origins without paths or credentials.')
    return value.rstrip('/')


def build(release, output, api_origin, work_origin):
    if not re.fullmatch(r'[0-9a-f]{40}', release):
        raise ValueError('Use the full reviewed source commit.')
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()
    if git('rev-parse', 'HEAD') != release or git('status', '--porcelain'):
        raise ValueError('The source must be a clean checkout of the reviewed commit.')
    api_origin, work_origin = https_origin(api_origin), https_origin(work_origin)
    output = output.resolve()
    if output.exists() or output.with_suffix('.manifest.json').exists():
        raise ValueError('Choose a new output path; existing release archives are preserved.')
    dist = ROOT / 'web' / 'dist-cpanel'
    env = dict(os.environ, VITE_API_BASE_URL=api_origin, VITE_WORK_API_BASE_URL=work_origin)
    subprocess.run(['npm', 'run', 'build:cpanel'], cwd=ROOT / 'web', env=env, check=True)
    # Assert that build-time configuration reached the actual JS bundle.
    bundles = [p.read_text() for p in (dist / 'assets').glob('*.js')]
    for origin in (api_origin, work_origin):
        if not any(origin in bundle for bundle in bundles):
            raise ValueError('An API origin is missing from the built JavaScript.')
    shutil.copyfile(ROOT / 'deployment/cpanel/.htaccess', dist / '.htaccess')
    info = {'build_id': 'cpanel-' + release[:12], 'commit': release, 'target': 'cpanel',
            'built_at': datetime.now(timezone.utc).isoformat(), 'api_origin': api_origin,
            'work_api_origin': work_origin, 'required_api_commit': release}
    (dist / 'build-info.json').write_text(json.dumps(info, indent=2) + '\n')
    manifest = dict(info, files={})
    files = sorted(p for p in dist.rglob('*') if p.is_file())
    for path in files:
        if path.is_symlink() or path.name.startswith('.env') or path.suffix in ('.py', '.ts', '.tsx', '.map'):
            raise ValueError('Unexpected source, secret or linked file in the website output: ' + str(path.relative_to(dist)))
        manifest['files'][path.relative_to(dist).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'x', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in files:
            archive.write(path, path.relative_to(dist).as_posix())
    with zipfile.ZipFile(output) as archive:
        if archive.testzip() is not None:
            raise ValueError('Archive integrity check failed.')
    manifest['archive_sha256'] = hashlib.sha256(output.read_bytes()).hexdigest()
    manifest['archive_bytes'] = output.stat().st_size
    output.with_suffix('.manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Prepared {len(files)} website files: {output} ({output.stat().st_size} bytes)')
    print('Archive SHA-256: ' + manifest['archive_sha256'])
    print('No website or API was deployed.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', required=True)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--api-origin', default='https://repaido-api-133610574058.us-central1.run.app')
    parser.add_argument('--work-api-origin', default='https://repaido-work-api-133610574058.us-central1.run.app')
    args = parser.parse_args()
    try:
        build(args.release, args.output, args.api_origin, args.work_api_origin)
    except (ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, str(error) + '\n')
