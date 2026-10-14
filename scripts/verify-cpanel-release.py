"""Read-only checks of a published cPanel website and its matching API build."""
import argparse
import json
import re
import urllib.error
import urllib.parse
import urllib.request


def read(url, method='GET', headers=None):
    request = urllib.request.Request(url, method=method, headers=headers or {})
    try:
        response = urllib.request.urlopen(request, timeout=30)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.headers, response.read()


def verify(commit, api_build):
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise ValueError('Use the reviewed full source commit.')
    site = 'https://repaido.com'
    status, headers, body = read(site + '/build-info.json?release=' + commit)
    if status != 200 or 'application/json' not in headers.get('Content-Type', ''):
        raise ValueError('The domain is not serving cPanel release metadata.')
    info = json.loads(body)
    if info.get('commit') != commit or info.get('target') != 'cpanel':
        raise ValueError('The website is not serving the reviewed cPanel release.')
    index = read(site + '/')[2]
    if b'<div id="root"' not in index or b'/assets/' not in index:
        raise ValueError('The website did not serve the built application.')
    for path in ['/worker?mode=driver', '/company-admin', '/shop-admin']:
        status, _, page = read(site + path)
        if status != 200 or page != index:
            raise ValueError('A direct SPA route is not serving the application: ' + path)
    for path in re.findall(rb'(?:src|href)="(/assets/[^"<>]+)"', index):
        url = site + path.decode()
        status, headers, body = read(url)
        if status != 200 or body.lstrip().startswith(b'<!doctype html'):
            raise ValueError('A built asset did not load: ' + path.decode())
    status, _, _ = read(site + '/assets/release-does-not-exist.js')
    if status != 404:
        raise ValueError('Missing assets must return 404 so stale clients can detect a new release.')
    expected = {'api_origin': 'https://repaido-api-133610574058.us-central1.run.app',
                'work_api_origin': 'https://repaido-work-api-133610574058.us-central1.run.app'}
    for name, origin in expected.items():
        if info.get(name) != origin:
            raise ValueError('Unexpected API origin in release metadata: ' + name)
        status, _, raw = read(origin + '/api/health')
        health = json.loads(raw)
        if status != 200 or health.get('status') != 'ok' or health.get('build_id') != api_build:
            raise ValueError('The API build does not match the reviewed deployment: ' + name)
    main, work = expected['api_origin'], expected['work_api_origin']
    for origin, path in [(main, '/api/repaidians/feed/validate'), (work, '/api/repaidians/work/preferences')]:
        status, headers, _ = read(origin + path, method='OPTIONS', headers={
            'Origin': site, 'Access-Control-Request-Method': 'POST' if origin == main else 'GET',
            'Access-Control-Request-Headers': 'authorization,content-type'})
        if status != 200 or headers.get('Access-Control-Allow-Origin') != site:
            raise ValueError('The API does not permit the production website origin.')
    for origin, path in [(main, '/api/repaidians/professional/workspace'), (work, '/api/repaidians/work/preferences')]:
        status, _, _ = read(origin + path, headers={'Origin': site})
        if status != 401:
            raise ValueError('The authenticated route is missing or its guest boundary failed: ' + path)
    print('cPanel website, direct navigation, assets, API build IDs, CORS and guest access boundaries verified.')
    print(commit + ' / API build ' + api_build)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', required=True)
    parser.add_argument('--api-build', required=True)
    args = parser.parse_args()
    try:
        verify(args.release, args.api_build)
    except (OSError, ValueError) as error:
        parser.exit(1, str(error) + '\n')
