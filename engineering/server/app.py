"""Separate engineering web app. No production mutation endpoints."""
import asyncio
import hashlib
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

import firebase_admin
from firebase_admin import auth
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from .catalog import Catalog
from .cloud import Cloud, stamp


ROOT = Path(__file__).resolve().parents[2]
LOG = logging.getLogger('repaido.engineering.audit')


def firebase_app(project):
    try:
        return firebase_admin.get_app('engineering')
    except ValueError:
        return firebase_admin.initialize_app(options={'projectId': project}, name='engineering')


def verify_engineer(token, project):
    try:
        claims = auth.verify_id_token(token, app=firebase_app(project), check_revoked=True)
    except Exception:
        raise HTTPException(401, 'Your session could not be verified. Please sign in again.') from None
    # Customer/admin/business roles do not grant infrastructure access.
    if claims.get('engineer') is not True:
        raise HTTPException(403, 'This account does not have engineering access.')
    return claims


def create_app(root=ROOT, *, catalog=None, cloud=None, verifier=None, preview=None):
    root = Path(root).resolve()
    project = os.getenv('ENGINEERING_PROJECT', 'repaido')
    local = os.getenv('ENGINEERING_LOCAL_PREVIEW') == 'true' if preview is None else preview
    if local and any(os.getenv(v) for v in ('K_SERVICE', 'GAE_ENV', 'FUNCTION_TARGET')):
        raise RuntimeError('Local preview is forbidden in a cloud runtime.')
    catalogue = catalog or Catalog(root)
    collector = cloud or Cloud(project, catalogue, os.getenv('ENGINEERING_CLOUD_ENABLED') == 'true')
    check = verifier or (lambda token: verify_engineer(token, project))
    streams = asyncio.Semaphore(20)

    def release_checks(user_ids):
        # One bounded check per container start, using its attached runtime
        # identity. Only outcomes are public; no identities or observations.
        states = {key: value['state'] for key, value in collector.snapshot().items()}
        access = False
        try:
            users = [auth.get_user(uid, app=firebase_app(project)) for uid in user_ids]
            access = bool(users) and all(not user.disabled and
                (user.custom_claims or {}).get('engineer') is True for user in users)
        except Exception:
            pass
        return {'collectors': states, 'engineer_accounts': access}

    @asynccontextmanager
    async def lifespan(application):
        user_ids = [uid for uid in os.getenv('ENGINEERING_RELEASE_CHECK_UIDS', '').split(',') if uid]
        if user_ids:
            application.state.release_checks = await run_in_threadpool(release_checks, user_ids)
        yield

    app = FastAPI(title='Repaido Engineering', docs_url=None, redoc_url=None,
        openapi_url=None, lifespan=lifespan)
    app.state.catalog = catalogue
    app.state.cloud = collector
    app.state.release_checks = None

    @app.middleware('http')
    async def security(request, call_next):
        if request.method not in {'GET', 'HEAD'}:
            return JSONResponse({'detail': 'The engineering console is read-only.'}, status_code=405)
        response = await call_next(request)
        response.headers.update({'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
            'Content-Security-Policy': "default-src 'self'; script-src 'self' https://www.google.com https://www.gstatic.com https://apis.google.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com; frame-src https://repaido.firebaseapp.com https://www.google.com https://recaptcha.google.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"})
        return response

    def engineer(request: Request, authorization: str = Header(default='', max_length=16384)):
        if local and request.client and request.client.host in {'127.0.0.1', '::1'} and request.url.hostname in {'localhost', '127.0.0.1', '::1'} and not request.headers.get('x-forwarded-for'):
            return {'uid': 'local-preview', 'engineer': True, 'exp': time.time() + 3600}
        if not authorization.startswith('Bearer '):
            raise HTTPException(401, 'Sign in with your Repaido engineering account.')
        result = check(authorization[7:].strip())
        if result.get('engineer') is not True:
            raise HTTPException(403, 'This account does not have engineering access.')
        return result

    def audit(identity, operation):
        # Audit stable, pseudonymous identities; never tokens or source contents.
        uid_hash = hashlib.sha256(identity['uid'].encode()).hexdigest()[:16]
        LOG.warning(json.dumps({'event': 'engineering_access', 'actor_hash': uid_hash, 'operation': operation}))

    @app.get('/health')
    def health():
        return {'status': 'ok', 'service': 'repaido-engineering',
            'source_revision': catalogue.revision,
            'build_id': os.getenv('ENGINEERING_BUILD_ID', 'local'),
            'release_checks': app.state.release_checks}

    @app.get('/engineering-api/config')
    def config(request: Request):
        # These are public Firebase app identifiers, not Admin credentials.
        import re
        source = root / 'web/src/firebase.ts'
        public = {}
        if source.is_file():
            text = source.read_text()
            for key in ('apiKey', 'authDomain', 'projectId', 'appId'):
                match = re.search(r'\b' + key + r'\s*:\s*["\']([^"\']+)["\']', text)
                if match:
                    public[key] = match.group(1)
        return {'firebase': public, 'project': project,
            'local_preview': bool(local and request.client and request.client.host in {'127.0.0.1', '::1'} and request.url.hostname in {'localhost', '127.0.0.1', '::1'} and not request.headers.get('x-forwarded-for'))}

    @app.get('/engineering-api/blueprint')
    def blueprint(identity=Depends(engineer)):
        audit(identity, 'blueprint')
        return {**catalogue.graph(), 'digest': catalogue.digest, 'project': project,
            'generated_at': stamp(), 'read_only': True}

    @app.get('/engineering-api/snapshot')
    def snapshot(identity=Depends(engineer)):
        return {'at': stamp(), 'collectors': collector.snapshot()}

    @app.get('/engineering-api/source')
    def source(node: str = Query(min_length=1, max_length=500), identity=Depends(engineer)):
        result = catalogue.source(node)
        if result is None:
            raise HTTPException(404, 'No source excerpt is available for this element.')
        audit(identity, 'source')
        return result

    @app.get('/engineering-api/stream')
    async def stream(request: Request, identity=Depends(engineer)):
        # Short-lived streams bound resource use and force revocation/claim
        # checks on reconnect. Tokens are only sent in Authorization headers.
        if streams.locked():
            raise HTTPException(429, 'All live streams are in use. Retry shortly.', headers={'Retry-After': '15'})
        await streams.acquire()

        async def events():
            try:
                for _ in range(4):
                    if await request.is_disconnected() or identity.get('exp', 0) <= time.time():
                        break
                    value = await run_in_threadpool(collector.snapshot)
                    yield 'event: snapshot\ndata: ' + json.dumps({'at': stamp(), 'collectors': value}) + '\n\n'
                    await asyncio.sleep(15)
            finally:
                streams.release()
        return StreamingResponse(events(), media_type='text/event-stream', headers={'X-Accel-Buffering': 'no'})

    build = root / 'engineering/web/dist'
    if build.is_dir():
        app.mount('/assets', StaticFiles(directory=build / 'assets'), name='assets')
        app.mount('/fonts', StaticFiles(directory=build / 'fonts'), name='fonts')

        @app.get('/')
        def index():
            return FileResponse(build / 'index.html')
    return app


app = create_app()
