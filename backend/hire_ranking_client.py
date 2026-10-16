"""Optional IAM-authenticated scoring transport, inline by default and on failure."""
import json
import logging
import os
import re
import threading
import time
import urllib.request

from hire_ranking import Batch, VERSION, rank

logger = logging.getLogger('repaido.hiring.ranking')
_lock = threading.Lock()
_failed_until = 0
_token = None
_token_url = None
_token_refreshing = False
_refresh_worker = None


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        # Never forward a service identity token to a redirect destination.
        return None


_scoring_transport = urllib.request.build_opener(NoRedirect())


def send_scoring(request, timeout):
    return _scoring_transport.open(request, timeout=timeout)


def remote_url():
    url = os.getenv('REPAIDO_HIRE_RANKING_URL', '').rstrip('/')
    # Configuration cannot turn the scorer into an arbitrary network fetcher.
    return url if re.fullmatch(r'https://[a-z0-9][a-z0-9-]*\.(?:[a-z0-9-]+\.)?run\.app', url) else None


def identity_token(url):
    from google.auth.transport.requests import Request
    from google.oauth2.id_token import fetch_id_token_credentials
    # Bound token discovery/refresh too, including the metadata-server call.
    class BoundedRequest(Request):
        def __call__(self, *args, **kwargs):
            kwargs['timeout'] = 0.5
            return super().__call__(*args, **kwargs)
    request = BoundedRequest()
    credential = fetch_id_token_credentials(url, request=request)
    credential.refresh(request)
    return credential


def _refresh_identity(url):
    global _token, _token_url, _token_refreshing, _failed_until
    try:
        credential = identity_token(url)
        if not credential.valid:
            raise ValueError('The refreshed credential is not valid')
        with _lock:
            _token, _token_url = credential, url
    except Exception:
        _failed_until = time.monotonic() + 30
        logger.warning('Optional hiring scorer identity unavailable; using inline evidence score.')
    finally:
        with _lock:
            _token_refreshing = False


def ready_identity_token(url):
    """Token discovery never waits on the public recommendation request.

    At most one refresh thread exists per process. Actual recommendation calls
    trigger refresh; there is no scheduled warming, polling or unbounded pool.
    """
    global _token_refreshing, _refresh_worker
    with _lock:
        if _token is not None and _token_url == url and _token.valid:
            return _token.token
        if not _token_refreshing:
            _token_refreshing = True
            _refresh_worker = threading.Thread(target=_refresh_identity, args=(url,),
                name='hiring-scorer-identity', daemon=True)
            _refresh_worker.start()
    return None


def rank_candidates(candidates):
    global _failed_until
    batch = Batch(candidates=candidates)
    local = rank(batch)
    url = remote_url()
    if not url or time.monotonic() < _failed_until:
        return local
    token = ready_identity_token(url)
    if token is None:
        return local
    # Do not queue remote requests when a cold start/provider failure is already
    # being resolved. Ranking is cheap and deterministic locally.
    if not _remote_gate.acquire(blocking=False):
        return local
    try:
        request = urllib.request.Request(url + '/internal/hiring/rank',
            data=batch.model_dump_json().encode(), method='POST', headers={
                'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
        with send_scoring(request, timeout=1) as response:
            payload = response.read(32769)
        if len(payload) > 32768:
            raise ValueError('Ranking response exceeds its bound')
        result = json.loads(payload)
        # This version is the same deterministic engine. Reject stale images,
        # malformed output and altered weights; native authority stays local.
        if result.get('version') != VERSION or result != local:
            raise ValueError('Ranking engine response does not match this version')
        return result
    except Exception:
        _failed_until = time.monotonic() + 30
        logger.warning('Optional hiring scorer unavailable; using inline evidence score.')
        return local
    finally:
        _remote_gate.release()


_remote_gate = threading.BoundedSemaphore(2)
