"""Independent work API. Run: uvicorn work_service:app --port 8001.

Public transport does not imply public data: the work router enforces Firebase
identity, ownership and community access on every authenticated operation.
"""
import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from work_runtime import health, initialize, shared_core

logger = logging.getLogger('repaido.work.api')


def positive_setting(name, default, maximum):
    value = int(os.getenv(name, str(default)))
    if not 1 <= value <= maximum:
        raise RuntimeError(f'{name} must be between 1 and {maximum}.')
    return value


def create_app(core=None):
    core = core or shared_core()
    active_limit = positive_setting('REPAIDO_WORK_MAX_INFLIGHT', 64, 512)
    waiting_limit = positive_setting('REPAIDO_WORK_MAX_WAITING', 64, 512)
    gate = asyncio.Semaphore(active_limit)
    inflight = 0
    waiting = 0

    @asynccontextmanager
    async def lifespan(application):
        initialize(core)
        yield

    application = FastAPI(title='Repaido work discovery API', version='1.0.0', lifespan=lifespan)
    application.add_middleware(CORSMiddleware,
        allow_origins=['https://repaido.com', 'https://www.repaido.com',
                       'https://repaido.web.app', 'https://repaido.firebaseapp.com',
                       'http://127.0.0.1:5186', 'http://localhost:5186'],
        allow_credentials=True, allow_methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allow_headers=['Authorization', 'Content-Type', 'Idempotency-Key'])

    @application.middleware('http')
    async def boundary(request: Request, call_next):
        nonlocal inflight, waiting
        if request.scope['path'].startswith('/api/'):
            request.scope['path'] = request.scope['path'][4:]
            request.scope['raw_path'] = request.scope['raw_path'][4:]
        if request.scope['path'] in ('/health', '/repaidians/work/health'):
            response = await call_next(request)
        else:
            if inflight + waiting >= active_limit + waiting_limit:
                return JSONResponse({'detail': {'code': 'WORK_BUSY', 'message': 'Please retry shortly.'}},
                                    status_code=503, headers={'Retry-After': '1', 'Cache-Control': 'no-store'})
            started = time.perf_counter()
            waiting += 1
            try:
                await asyncio.wait_for(gate.acquire(), timeout=0.1)
            except asyncio.TimeoutError:
                return JSONResponse({'detail': {'code': 'WORK_BUSY', 'message': 'Please retry shortly.'}},
                                    status_code=503, headers={'Retry-After': '1', 'Cache-Control': 'no-store'})
            finally:
                waiting -= 1
            inflight += 1
            try:
                response = await call_next(request)
                logger.info('work_request method=%s path=%s status=%s duration_ms=%.1f',
                            request.method, request.scope['path'], response.status_code,
                            (time.perf_counter() - started) * 1000)
            finally:
                inflight -= 1
                gate.release()
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Cache-Control'] = 'private, no-store'
        return response

    @application.get('/health')
    @application.get('/repaidians/work/health')
    def service_health():
        return health(core, 'repaido-work-api')

    core.app = application
    import repaidians_work
    repaidians_work.install(core)
    application.state.core = core
    return application


app = create_app()
