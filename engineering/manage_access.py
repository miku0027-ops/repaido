"""Grant/revoke the engineering claim; plan only unless --apply is explicit.

Run manually by an authorised Firebase operator using their existing identity.
Never overwrite other custom claims. This is not an HTTP endpoint.
"""
import argparse
import json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', default='repaido')
    parser.add_argument('--uid', required=True, help='Existing Firebase user UID, not a phone number')
    parser.add_argument('action', choices=['grant', 'revoke'])
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if not 1 <= len(args.uid) <= 128:
        parser.error('Provide an existing Firebase UID.')
    if not args.apply:
        print(json.dumps({'project': args.project, 'uid': args.uid, 'action': args.action,
            'claim': 'engineer', 'applied': False, 'existing_claims': 'preserved'}))
        return
    import firebase_admin
    from firebase_admin import auth
    firebase_admin.initialize_app(options={'projectId': args.project})
    user = auth.get_user(args.uid)
    claims = dict(user.custom_claims or {})
    if args.action == 'grant':
        claims['engineer'] = True
    else:
        claims.pop('engineer', None)
    auth.set_custom_user_claims(args.uid, claims)
    # Existing sessions must be revoked so old engineer tokens cannot keep access.
    auth.revoke_refresh_tokens(args.uid)
    print(json.dumps({'uid': args.uid, 'action': args.action, 'applied': True,
        'next': 'Sign in again to receive updated claims.'}))


if __name__ == '__main__':
    main()
