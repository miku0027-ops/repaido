"""Private authenticated work update worker. Run: uvicorn work_worker:app.

Deploy with Cloud Run IAM authentication required. The application additionally
verifies the Scheduler caller's Google-issued OIDC token and exact audience.
Firebase member tokens, an arbitrary admin header and absent configuration never
authorize background processing.
"""
import logging
import os
import threading
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from work_runtime import health, initialize, shared_core

logger = logging.getLogger('repaido.work.worker')


def scheduler_identity(authorization: str = Header(default='')):
    audience = os.getenv('REPAIDO_WORK_WORKER_AUDIENCE', '').rstrip('/')
    caller = os.getenv('REPAIDO_WORK_SCHEDULER_EMAIL', '')
    if not audience.startswith('https://') or not caller.endswith('.iam.gserviceaccount.com'):
        raise HTTPException(503, 'Work scheduler identity is not configured.')
    if not authorization.startswith('Bearer '):
        raise HTTPException(401, 'A Scheduler identity token is required.')
    try:
        from google.auth.transport.requests import Request
        from google.oauth2.id_token import verify_oauth2_token
        claims = verify_oauth2_token(authorization[7:].strip(), Request(), audience=audience)
        if (claims.get('iss') not in ('accounts.google.com', 'https://accounts.google.com')
                or claims.get('email') != caller or claims.get('email_verified') is not True):
            raise ValueError('Caller is not the configured scheduler service account.')
    except Exception:
        raise HTTPException(403, 'The Scheduler identity is not authorized.') from None
    return {'email': caller}


class Dispatch(BaseModel):
    limit: int = Field(default=20, ge=1, le=40)


def create_app(core=None):
    core = core or shared_core()
    gate = threading.Lock()

    @asynccontextmanager
    async def lifespan(application):
        initialize(core)
        yield

    application = FastAPI(title='Private Repaido work update worker', version='1.0.0',
                          lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @application.get('/health')
    def service_health():
        return {**health(core, 'repaido-work-worker'),
                'push_enabled': os.getenv('REPAIDO_PUSH_ENABLED', '').lower() == 'true',
                'scheduler_configured': bool(os.getenv('REPAIDO_WORK_WORKER_AUDIENCE', '').startswith('https://')
                    and os.getenv('REPAIDO_WORK_SCHEDULER_EMAIL', '').endswith('.iam.gserviceaccount.com'))}

    @application.post('/internal/work/dispatch')
    def dispatch(body: Dispatch, identity=Depends(scheduler_identity)):
        if not gate.acquire(blocking=False):
            raise HTTPException(503, 'A work dispatch is already running.', headers={'Retry-After': '15'})
        try:
            import repaidians_work
            import work_push
            import custom_contracts
            result = {'indexing': repaidians_work.backfill(core, limit=min(body.limit, 20)),
                      'devices': work_push.backfill_devices(core, limit=min(body.limit, 20)),
                      'contracts': custom_contracts.process_notifications(core, limit=min(body.limit, 16)),
                      'updates': repaidians_work.process_updates(core, limit=body.limit),
                      'push': work_push.process_deliveries(core, limit=body.limit)}
            logger.info('work_dispatch completed indexing=%s updates=%s push=%s',
                        result['indexing'], result['updates'], result['push'])
            return result
        finally:
            gate.release()

    application.state.core = core
    return application


app = create_app()
