#!/usr/bin/env python3
"""Publish emulator-tested rules using the existing build identity.

The Firebase SDK service-agent role already grants these create/get/update
permissions. This targets the existing default Firestore release only, never
grants IAM, creates a database, changes indexes, or touches stored records.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import urllib.error
import urllib.request


PERMISSIONS = ('firebaserules.rulesets.create', 'firebaserules.rulesets.get',
               'firebaserules.releases.get', 'firebaserules.releases.update')


class RulesClient:
    def __init__(self, project):
        if not re.fullmatch(r'[a-z][a-z0-9-]{4,62}', project):
            raise ValueError('Enter a valid Google Cloud project ID.')
        self.project = project
        self.token = subprocess.check_output(['gcloud', 'auth', 'print-access-token', '--quiet'], text=True).strip()

    def request(self, method, resource, body=None, *, iam=False):
        base = ('https://cloudresourcemanager.googleapis.com/v1/' if iam
                else 'https://firebaserules.googleapis.com/v1/')
        request = urllib.request.Request(base + resource, method=method,
            headers={'Authorization': 'Bearer ' + self.token, 'Content-Type': 'application/json'},
            data=None if body is None else json.dumps(body).encode())
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            # Credentials and request headers are never included in diagnostics.
            raise RuntimeError(f'{method} {resource} failed with HTTP {error.code}. '
                               'Check the build identity Rules API permissions and the existing default release.') from None


def check_access(client):
    result = client.request('POST', f'projects/{client.project}:testIamPermissions',
                            {'permissions': list(PERMISSIONS)}, iam=True)
    missing = sorted(set(PERMISSIONS) - set(result.get('permissions', [])))
    if missing:
        raise RuntimeError('The build identity is missing: ' + ', '.join(missing))
    name = f'projects/{client.project}/releases/cloud.firestore'
    release = client.request('GET', name)
    if release.get('name') != name or not str(release.get('rulesetName', '')).startswith(f'projects/{client.project}/rulesets/'):
        raise RuntimeError('The existing default Firestore rules release is unavailable.')
    return release


def publish(client, source, receipt):
    release = check_access(client)
    files = [{'name': 'firestore.rules', 'content': source}]
    existing = client.request('GET', release['rulesetName'])
    def source_files(ruleset):
        return [{key: file.get(key) for key in ('name', 'content')}
                for file in ruleset.get('source', {}).get('files', [])]
    if source_files(existing) == files:
        ruleset = release['rulesetName']
        print('Firestore rules already match this release; no publication needed.')
    else:
        created = client.request('POST', f'projects/{client.project}/rulesets', {'source': {'files': files}})
        ruleset = created.get('name', '')
        if not ruleset.startswith(f'projects/{client.project}/rulesets/'):
            raise RuntimeError('The Rules API did not confirm the compiled ruleset.')
        # Creation compiles the source in Google's Rules API; an invalid ruleset
        # fails without changing the active release.
        compiled = client.request('GET', ruleset)
        if source_files(compiled) != files:
            raise RuntimeError('Compiled rules source does not match the tested source.')
        client.request('PATCH', release['name'], {'release': {'name': release['name'], 'rulesetName': ruleset}})
        current = client.request('GET', release['name'])
        if current.get('rulesetName') != ruleset:
            raise RuntimeError('The active Firestore release did not match the published ruleset.')
        print('Firestore rules compiled, published and verified for the existing default database.')
    Path(receipt).write_text(json.dumps({'project': client.project, 'release': release['name'],
        'ruleset': ruleset, 'source_sha256': hashlib.sha256(source.encode()).hexdigest()}) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', required=True)
    parser.add_argument('--check-access', action='store_true')
    parser.add_argument('--rules', default='firestore.rules')
    parser.add_argument('--receipt', default='/workspace/firestore-rules-release.json')
    args = parser.parse_args()
    client = RulesClient(args.project)
    if args.check_access:
        check_access(client)
        print('Firestore rules publication access verified.')
    else:
        publish(client, Path(args.rules).read_text(), args.receipt)


if __name__ == '__main__':
    main()
