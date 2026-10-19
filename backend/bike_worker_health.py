"""Private worker probes; liveness does not depend on external service health."""
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class WorkerPulse:
    def __init__(self):
        self.updated_at = time.monotonic()
        self.ready = False
        self.started = False
        self.lock = threading.Lock()

    def touch(self, ready=None):
        with self.lock:
            self.updated_at = time.monotonic()
            if ready is not None:
                self.ready = bool(ready)
                self.started = self.started or self.ready

    def status(self, readiness=False):
        with self.lock:
            alive = time.monotonic()-self.updated_at < 45
            return alive and (self.ready if readiness else self.started)


def health_server(pulse, port=9118, host='0.0.0.0'):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path not in ('/livez', '/readyz'):
                self.send_error(404)
                return
            ready = pulse.status(self.path == '/readyz')
            payload = json.dumps({'status': 'ok' if ready else 'unavailable'}).encode()
            self.send_response(200 if ready else 503)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *args):
            pass
    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, name='bike-worker-probes', daemon=True).start()
    return server


def load_quota_secret():
    """GCE workers read one pinned Secret Manager version with ADC, in memory."""
    import base64
    import os
    import re
    import urllib.request
    resource = os.getenv('REPAIDO_BIKE_PROMO_QUOTA_SECRET_RESOURCE', '').strip()
    if not resource:
        return
    if not re.fullmatch(r'projects/[a-z0-9-]+/secrets/[A-Za-z0-9_-]+/versions/[1-9][0-9]*', resource):
        raise RuntimeError('Use a pinned Secret Manager quota-key version')
    if os.getenv('REPAIDO_BIKE_PROMO_QUOTA_SECRET'):
        raise RuntimeError('Configure one quota-secret source, not two')
    import google.auth
    from google.auth.transport.requests import Request
    credentials, _ = google.auth.default(scopes=['https://www.googleapis.com/auth/cloud-platform'])
    url = 'https://secretmanager.googleapis.com/v1/'+resource+':access'
    headers = {}
    credentials.before_request(Request(), 'GET', url, headers)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=10) as response:
            payload = json.load(response)['payload']
        value = base64.b64decode(payload['data'], validate=True)
        if 'dataCrc32c' in payload:
            import google_crc32c
            if google_crc32c.value(value) != int(payload['dataCrc32c']):
                raise ValueError('Secret checksum mismatch')
        if len(value) < 32 or not value.strip():
            raise ValueError('Quota secret is too short')
        os.environ['REPAIDO_BIKE_PROMO_QUOTA_SECRET'] = value.decode('utf-8')
    except Exception:
        raise RuntimeError('Could not load the configured quota key; worker remains unavailable') from None
