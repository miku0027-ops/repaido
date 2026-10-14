"""Check the components updated by one manual Cloud Build release."""
import argparse
import json
import time
import urllib.request


def read(url):
    with urllib.request.urlopen(url, timeout=20) as response:
        return json.load(response)


def verify(target, build, commit, *, fetch=read, retries=12, delay=5):
    base = 'https://repaido.web.app'
    for attempt in range(retries):
        try:
            if target == 'web':
                site = fetch(f'{base}/build-info.json?build={build}')
                assert site['build_id'] == build and site['commit'] == commit
            if target == 'api':
                for path in ('/api/health', '/api/repaidians/work/health'):
                    health = fetch(f'{base}{path}?build={build}')
                    assert health['status'] == 'ok' and health['build_id'] == build
                    if path.endswith('/work/health'):
                        assert health['storage'] == 'firestore'
            print(f'{target} release verified: {commit} / build {build}')
            return
        except (OSError, ValueError, KeyError, AssertionError):
            if attempt == retries - 1:
                raise
            time.sleep(delay)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', required=True, choices=('web', 'api'))
    parser.add_argument('--build', required=True)
    parser.add_argument('--commit', required=True)
    args = parser.parse_args()
    verify(args.target, args.build, args.commit)
