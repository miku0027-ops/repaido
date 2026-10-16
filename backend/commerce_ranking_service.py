"""Optional private, stateless commerce scorer. No native records or PII are sent."""
import os
import re
import threading
import time
from types import SimpleNamespace

from fastapi import Depends, FastAPI, Header, HTTPException

from commerce_ranking import Batch, FeatureCache, VERSION
from http_boundary import TransportBoundaryMiddleware

_certificate_lock = threading.Lock()
_certificates = {}


class CertificateRequest:
    """Reuse public signing certificates within Google's cache lifetime."""
    def __call__(self, url, **kwargs):
        from google.auth.transport.requests import Request
        with _certificate_lock:
            cached = _certificates.get(url)
            if cached and cached[0] > time.monotonic():
                return cached[1]
            response = Request()(url, **{**kwargs, 'timeout': 1})
            # Copy the bounded public certificate response; no bearer tokens or
            # authenticated responses are retained in this cache.
            data = response.data
            if len(data) > 65536:
                raise ValueError('Signing certificate response is too large')
            result = SimpleNamespace(status=response.status, data=data, headers=response.headers)
            lifetime = re.search(r'(?:^|,)\s*max-age=(\d+)', response.headers.get('cache-control', ''))
            ttl = min(int(lifetime[1]), 3600) if lifetime else 0
            if response.status == 200 and ttl:
                _certificates[url] = (time.monotonic() + ttl, result)
                while len(_certificates) > 4:
                    _certificates.pop(next(iter(_certificates)))
            return result


def caller_identity(authorization: str = Header(default='')):
    audience = os.getenv('REPAIDO_COMMERCE_RANKING_AUDIENCE', '').rstrip('/')
    caller = os.getenv('REPAIDO_COMMERCE_RANKING_CALLER_EMAIL', '')
    if not audience.startswith('https://') or not caller.endswith('.iam.gserviceaccount.com'):
        raise HTTPException(503, 'Ranking caller identity is not configured.')
    if not authorization.startswith('Bearer '):
        raise HTTPException(401, 'A service identity token is required.')
    try:
        from google.oauth2.id_token import verify_oauth2_token
        claims = verify_oauth2_token(authorization[7:].strip(), CertificateRequest(), audience=audience)
        if (claims.get('iss') not in ('accounts.google.com', 'https://accounts.google.com')
                or claims.get('email') != caller or claims.get('email_verified') is not True):
            raise ValueError('Unexpected caller')
    except Exception:
        raise HTTPException(403, 'The service identity is not authorized.') from None
    return {'email': caller}


def create_app():
    application = FastAPI(title='Private commerce evidence scorer', docs_url=None, redoc_url=None, openapi_url=None)
    application.add_middleware(TransportBoundaryMiddleware)
    cache = FeatureCache()

    @application.get('/health')
    def health():
        return {'status': 'ok', 'service': 'repaido-commerce-ranking', 'version': VERSION}

    @application.post('/internal/commerce/rank')
    def ranking(body: Batch, identity=Depends(caller_identity)):
        return cache.rank(body)

    application.state.cache = cache
    return application


app = create_app()
