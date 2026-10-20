#!/usr/bin/env python3
"""Provision a website-restricted Maps display key, without changing API traffic.

Run in authenticated Cloud Shell. The key value stays out of stdout and logs.
The dedicated public config is consumed by the next reviewed application release.
"""
import argparse
import json
import subprocess
import time
import urllib.error
import urllib.request

PROJECT = 'repaido'
KEY = 'projects/133610574058/locations/global/keys/repaido-web-maps'
REFERRERS = ['https://repaido.com/*', 'https://www.repaido.com/*',
             'https://repaido.web.app/*', 'https://repaido.firebaseapp.com/*']
RESTRICTIONS = {'browserKeyRestrictions': {'allowedReferrers': REFERRERS},
                'apiTargets': [{'service': 'maps-backend.googleapis.com'}]}
DOCUMENT = 'https://firestore.googleapis.com/v1/projects/repaido/databases/(default)/documents/ops_public_maps_config/google'


def validate_restrictions(value):
    restrictions = value.get('restrictions', {})
    if set(restrictions.get('browserKeyRestrictions', {}).get('allowedReferrers', [])) != set(REFERRERS):
        raise RuntimeError('Existing key has different website restrictions; preserve it for review.')
    if restrictions.get('apiTargets') != RESTRICTIONS['apiTargets'] or 'androidKeyRestrictions' in restrictions or 'serverKeyRestrictions' in restrictions or 'iosKeyRestrictions' in restrictions:
        raise RuntimeError('Existing key has different API/client restrictions; preserve it for review.')


class Client:
    def __init__(self):
        self.token = subprocess.check_output(['gcloud', 'auth', 'print-access-token'], text=True).strip()

    def request(self, url, method='GET', body=None, missing=False):
        request = urllib.request.Request(url, method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={'Authorization': 'Bearer '+self.token, 'X-Goog-User-Project': PROJECT, 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if missing and error.code == 404: return None
            raise RuntimeError(f'Google {method} returned HTTP {error.code}; preserve records and inspect project access.') from None


def configure(client, apply=False):
    url = 'https://apikeys.googleapis.com/v2/'+KEY
    key = client.request(url, missing=True)
    existing = client.request(DOCUMENT, missing=True)
    if key: validate_restrictions(key)
    if not apply:
        return {'project': PROJECT, 'apply': False, 'key_exists': bool(key), 'display_config_exists': bool(existing),
                'allowed_referrers': REFERRERS, 'api': 'maps-backend.googleapis.com'}
    if not key:
        # Fixed keyId makes a power-loss retry find the same resource.
        op = client.request('https://apikeys.googleapis.com/v2/projects/repaido/locations/global/keys?keyId=repaido-web-maps', 'POST',
            {'displayName': 'Repaido website Google Maps', 'restrictions': RESTRICTIONS})
        for _ in range(60):
            if op.get('done'): break
            name = op.get('name', '')
            if not name.startswith('operations/'): raise RuntimeError('Unexpected key operation receipt.')
            time.sleep(2)
            op = client.request('https://apikeys.googleapis.com/v2/'+name)
        if not op.get('done') or op.get('error'): raise RuntimeError('Key provisioning did not finish. Do not create a different key; rerun this same check for recovery.')
        key = client.request(url)
        validate_restrictions(key)
    name = key['name']
    if not name.startswith('projects/133610574058/locations/global/keys/'):
        raise RuntimeError('Unexpected key project.')
    value = client.request('https://apikeys.googleapis.com/v2/'+name+'/keyString')['keyString']
    if existing:
        old = existing.get('fields', {}).get('browser_key', {}).get('stringValue')
        if old != value: raise RuntimeError('A different display configuration exists; no config was replaced.')
        return {'project': PROJECT, 'status': 'already_configured', 'key_resource': name, 'key_value_printed': False}
    client.request(DOCUMENT+'?currentDocument.exists=false', 'PATCH', {'fields': {
        'provider': {'stringValue': 'google'}, 'browser_key': {'stringValue': value},
        'key_resource': {'stringValue': name}, 'configured_at': {'integerValue': str(int(time.time()))}}})
    return {'project': PROJECT, 'status': 'configured', 'key_resource': name, 'key_value_printed': False,
            'api_traffic_changed': False, 'bookings_changed': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        if args.apply:
            subprocess.run(['gcloud', 'services', 'enable', 'maps-backend.googleapis.com', '--project='+PROJECT, '--quiet'], check=True, stdout=subprocess.DEVNULL)
        print(json.dumps(configure(Client(), args.apply), indent=2))
    except (RuntimeError, subprocess.CalledProcessError, OSError) as error:
        parser.exit(1, 'STOP: '+str(error)+'\n')
