"""Read cPanel domain metadata without changing website files or logging a token."""
import json
import os
import re
import sys
import urllib.parse
import urllib.request


def check():
    host = os.environ.get('CPANEL_HOST', 'cpanel.repaido.com')
    user = os.environ.get('CPANEL_USERNAME', 'repaidoc')
    token = os.environ.get('CPANEL_API_TOKEN')
    if host != 'cpanel.repaido.com' or not re.fullmatch(r'[a-zA-Z0-9_]+', user):
        raise ValueError('Use the configured Repaido cPanel hostname and account.')
    if not token:
        raise ValueError('CPANEL_API_TOKEN is missing. Configure it securely in environment settings; do not paste it into chat.')
    url = f'https://{host}/execute/DomainInfo/single_domain_data?' + urllib.parse.urlencode({'domain': 'repaido.com'})
    request = urllib.request.Request(url, headers={'Authorization': f'cpanel {user}:{token}'})
    # Do not allow an authenticated request to redirect to a different host.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=25) as response:
        result = json.load(response)
    if result.get('status') != 1:
        raise ValueError('cPanel refused the domain metadata request; check token permissions and account access.')
    data = result.get('data') or {}
    root = data.get('documentroot')
    if not isinstance(root, str) or not root.startswith('/home/' + user + '/'):
        raise ValueError('cPanel did not return a document root inside this account. Inspect Domains before uploading.')
    print(json.dumps({'host': host, 'account': user, 'domain': 'repaido.com', 'document_root': root, 'read_access': 'verified'}, indent=2))


if __name__ == '__main__':
    try:
        check()
    except (OSError, ValueError) as error:
        # Provider response bodies and authentication headers are never printed.
        print(f'cPanel access check stopped: {error}', file=sys.stderr)
        sys.exit(1)
