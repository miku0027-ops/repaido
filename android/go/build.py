#!/usr/bin/env python3
"""Build one Go app with its package-specific Firebase client configuration."""
import argparse
import json
import os
from pathlib import Path
import subprocess


PACKAGES = {'customer': 'com.repaido.go', 'driver': 'com.repaido.go.driver'}


def firebase_properties(path, audience):
    data = json.loads(Path(path).read_text())
    project = data.get('project_info', {})
    if project.get('project_id') != 'repaido' or str(project.get('project_number')) != '133610574058':
        raise ValueError('Use the Repaido Firebase project configuration.')
    clients = [client for client in data.get('client', []) if
               client.get('client_info', {}).get('android_client_info', {}).get('package_name') == PACKAGES[audience]]
    if len(clients) != 1:
        raise ValueError('Configuration must contain exactly one client for ' + PACKAGES[audience])
    client = clients[0]
    app_id = client.get('client_info', {}).get('mobilesdk_app_id', '')
    keys = client.get('api_key', [])
    key = keys[0].get('current_key', '') if len(keys) == 1 else ''
    if not app_id.startswith('1:133610574058:android:') or not key:
        raise ValueError('Firebase Android app ID or API key is missing or ambiguous.')
    prefix = 'ORG_GRADLE_PROJECT_REPAIDO_GO_' + audience.upper() + '_'
    return {prefix + 'FIREBASE_APP_ID': app_id, prefix + 'FIREBASE_API_KEY': key,
            prefix + 'FIREBASE_SENDER_ID': '133610574058'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('audience', choices=PACKAGES)
    parser.add_argument('--firebase-config', type=Path, help='Downloaded google-services.json for this package')
    parser.add_argument('--release', action='store_true', help='Build an unsigned release; never uses the debug signer')
    args = parser.parse_args()
    if args.release and not args.firebase_config:
        parser.error('--release requires --firebase-config for this package')
    environment = os.environ.copy()
    # Never inherit a different app's Firebase registration accidentally.
    prefix = 'ORG_GRADLE_PROJECT_REPAIDO_GO_' + args.audience.upper() + '_'
    for suffix in ('FIREBASE_APP_ID', 'FIREBASE_API_KEY', 'FIREBASE_SENDER_ID'):
        environment[prefix + suffix] = '' if suffix != 'FIREBASE_SENDER_ID' else '133610574058'
    if args.firebase_config:
        try:
            environment.update(firebase_properties(args.firebase_config, args.audience))
        except (OSError, ValueError, TypeError, KeyError):
            parser.error('Invalid Firebase configuration. Check the project and selected Android package; no build started.')
    else:
        print('Building a test APK without push configuration. Ride notifications are unavailable in this build.', flush=True)
    android = Path(__file__).resolve().parents[1]
    variant = args.audience.title() + ('Release' if args.release else 'Debug')
    subprocess.run([str(android / 'gradlew'), ':go:assemble' + variant, '--console=plain'],
                   cwd=android, env=environment, check=True)
    print('Built ' + PACKAGES[args.audience] + '. Outputs: ' + str(android / 'go/build/outputs/apk' / args.audience))
    if args.release:
        print('Release is unsigned. Apply the approved production signing configuration before distribution.')


if __name__ == '__main__':
    main()
