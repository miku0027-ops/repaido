"""Opt-in, post-commit event wakeups for the existing private work worker.

Only committed outbox writes mark the HTTP request. Cloud Tasks submission runs
after the response body; a provider failure leaves durable work for Scheduler.
No credentials, private records or event payloads leave through the task body.
"""
import asyncio
import base64
import contextvars
import logging
import os
import re
import time
import threading
from urllib.parse import urlsplit

LOG = logging.getLogger('repaido.work.events')
PENDING = contextvars.ContextVar('repaido_work_event_request', default=None)
ATTEMPTS = {}
LOCK = threading.Lock()


def configuration():
    if os.getenv('REPAIDO_WORK_EVENT_DISPATCH_ENABLED', '').lower() != 'true':
        return None
    queue = os.getenv('REPAIDO_WORK_EVENT_QUEUE', '')
    match = re.fullmatch(r'projects/([a-z][a-z0-9-]{4,61}[a-z0-9])/locations/([a-z0-9-]+)/queues/([a-z][a-z0-9-]{2,99})', queue)
    url = os.getenv('REPAIDO_WORK_EVENT_WORKER_URL', '').rstrip('/')
    caller = os.getenv('REPAIDO_WORK_EVENT_CALLER_EMAIL', '')
    try:
        parsed = urlsplit(url)
        port = parsed.port
    except ValueError:
        return None
    if not match or parsed.scheme != 'https' or not (parsed.hostname or '').endswith('.run.app') or port not in (None, 443) or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path:
        return None
    if not re.fullmatch(r'[a-z0-9-]+@' + re.escape(match[1]) + r'\.iam\.gserviceaccount\.com', caller):
        return None
    return queue, url, caller


def mark_committed():
    marker = PENDING.get()
    if marker is not None and configuration():
        marker[:] = [True]


def submit(transport=None, now=None):
    config = configuration()
    if not config:
        return False
    bucket = int((time.time() if now is None else now) // 10)
    with LOCK:
        previous = ATTEMPTS.get(config)
        if previous and previous[0] == bucket:
            return previous[1]
        result = submit_task(config, bucket, transport)
        ATTEMPTS[config] = (bucket, result)
        while len(ATTEMPTS) > 16:
            ATTEMPTS.pop(next(iter(ATTEMPTS)))
        return result


def submit_task(config, bucket, transport):
    queue, url, caller = config
    # Ten-second buckets collapse writes from multiple API instances. Repeated
    # provider acceptance is harmless; Scheduler remains the repair path.
    task = {'name': queue + '/tasks/work-events-' + str(bucket),
            'httpRequest': {'httpMethod': 'POST', 'url': url + '/internal/work/dispatch',
                            'headers': {'Content-Type': 'application/json'},
                            'body': base64.b64encode(b'{"limit":40}').decode(),
                            'oidcToken': {'serviceAccountEmail': caller, 'audience': url}}}
    try:
        if transport is None:
            import google.auth
            from google.auth.transport.requests import AuthorizedSession
            credentials, _ = google.auth.default(scopes=['https://www.googleapis.com/auth/cloud-platform'])
            with AuthorizedSession(credentials) as session:
                response = session.post('https://cloudtasks.googleapis.com/v2/' + queue + '/tasks', json={'task': task}, timeout=2)
        else:
            response = transport.post('https://cloudtasks.googleapis.com/v2/' + queue + '/tasks', json={'task': task}, timeout=2)
        if response.status_code in (200, 201, 409):
            LOG.info('work_event_dispatch accepted status=%s', response.status_code)
            return True
        LOG.warning('work_event_dispatch deferred status=%s', response.status_code)
    except Exception:
        LOG.warning('work_event_dispatch deferred provider_unavailable')
    return False


class WorkEventDispatchMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or not configuration():
            return await self.app(scope, receive, send)
        marker = []
        token = PENDING.set(marker)
        try:
            await self.app(scope, receive, send)
        finally:
            PENDING.reset(token)
        if marker:
            await asyncio.to_thread(submit)
