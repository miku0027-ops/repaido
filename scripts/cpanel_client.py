"""cPanel client: keep credentials private; never redirect or retry a mutation."""
import json
import os
from pathlib import Path
import urllib.parse
import urllib.request
import urllib.error
import time
import uuid

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None

class Client:
    def __init__(self):
        host = os.environ['CPANEL_HOST']
        self.user = os.environ['CPANEL_USERNAME']
        assert host == 'cpanel.repaido.com' and self.user == 'repaidoc'
        self.origin = 'https://' + host
        self.headers = {'Authorization': 'cpanel ' + self.user + ':' + os.environ['CPANEL_API_TOKEN']}
        self.opener = urllib.request.build_opener(NoRedirect())

    def request(self, path, parameters, post=False):
        encoded = urllib.parse.urlencode(parameters).encode()
        request = urllib.request.Request(self.origin + path + ('' if post else '?' + encoded.decode()),
            data=encoded if post else None,
            headers={**self.headers, 'Content-Type': 'application/x-www-form-urlencoded'},
            method='POST' if post else 'GET')
        for attempt in range(3):
            try:
                with self.opener.open(request, timeout=60) as response:
                    return json.load(response)
            except urllib.error.HTTPError as error:
                # Retry only the original read URL, never follow a redirect or
                # repeat a cPanel mutation after an uncertain response.
                if post or attempt == 2 or error.code not in (308, 429, 502, 503, 504):
                    raise
                time.sleep(attempt + 1)

    def uapi(self, function, parameters):
        result = self.request('/execute/Fileman/' + function, parameters)
        if result.get('status') != 1:
            raise RuntimeError('cPanel rejected Fileman/' + function)
        return result.get('data')

    def api2(self, function, parameters):
        result = self.request('/json-api/cpanel', {
            'cpanel_jsonapi_user': self.user, 'cpanel_jsonapi_apiversion': '2',
            'cpanel_jsonapi_module': 'Fileman', 'cpanel_jsonapi_func': function, **parameters}, post=True)['cpanelresult']
        if result.get('event', {}).get('result') != 1 or result.get('error'):
            raise RuntimeError('cPanel rejected Fileman::' + function)
        for row in result.get('data', []):
            if isinstance(row, dict) and 'result' in row and row['result'] not in (1, '1'):
                raise RuntimeError('cPanel reported a failed Fileman::' + function)
        return result.get('data')

    def listing(self, directory):
        return self.uapi('list_files', {'dir': directory, 'show_hidden': 1})

    def upload(self, filename, directory):
        filename = Path(filename)
        boundary = 'repaido-release-' + uuid.uuid4().hex
        prefix = ('--' + boundary + '\r\nContent-Disposition: form-data; name="file-0"; filename="' + filename.name + '"\r\nContent-Type: application/zip\r\n\r\n').encode()
        suffix = ('\r\n--' + boundary + '--\r\n').encode()
        size = filename.stat().st_size
        def stream():
            yield prefix
            sent = reported = 0
            with filename.open('rb') as source:
                while chunk := source.read(1024 * 1024):
                    sent += len(chunk)
                    yield chunk
                    if sent - reported >= 10 * 1024 * 1024 or sent == size:
                        print('Upload: %d / %d bytes' % (sent, size), flush=True)
                        reported = sent
            yield suffix
        query = urllib.parse.urlencode({'dir': directory, 'overwrite': 0, 'permissions': '0600', 'get_disk_info': 1})
        payload = prefix + filename.read_bytes() + suffix if size <= 8 * 1024 * 1024 else stream()
        request = urllib.request.Request(self.origin + '/execute/Fileman/upload_files?' + query,
            data=payload, headers={**self.headers,
            'Content-Type': 'multipart/form-data; boundary=' + boundary,
            'Content-Length': str(len(prefix) + size + len(suffix))}, method='POST')
        with self.opener.open(request, timeout=180) as response:
            result = json.load(response)
        data = result.get('data') or {}
        if result.get('status') != 1 or int(data.get('failed', 0)) or int(data.get('succeeded', 0)) != 1:
            raise RuntimeError('cPanel upload did not confirm exactly one successful file')
        print('Upload accepted by cPanel.', flush=True)
        return data
