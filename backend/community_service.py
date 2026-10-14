"""Optional independently scalable community API; no operational scheduler.

Run uvicorn community_service:app. Normal deployments can keep social routes on
the main API. This runtime supports a separately released, scale-to-zero lane.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from http_boundary import TransportBoundaryMiddleware
from work_runtime import health, initialize, shared_core
from work_dispatch import WorkEventDispatchMiddleware


def create_app(core=None):
    core = core or shared_core()
    @asynccontextmanager
    async def lifespan(application):
        initialize(core)
        yield
    app = FastAPI(title='Repaidians community API', version='1.0.0', lifespan=lifespan)
    app.add_middleware(WorkEventDispatchMiddleware)
    app.add_middleware(CORSMiddleware,
        allow_origins=['https://repaido.com', 'https://www.repaido.com',
                       'https://repaido.web.app', 'https://repaido.firebaseapp.com',
                       'http://127.0.0.1:5186', 'http://localhost:5186'],
        allow_credentials=True, allow_methods=['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allow_headers=['Authorization', 'Content-Type', 'Idempotency-Key', 'Range', 'If-None-Match', 'If-Range'])
    @app.middleware('http')
    async def boundary(request: Request, call_next):
        if request.scope['path'].startswith('/api/'):
            request.scope['path'] = request.scope['path'][4:]
            request.scope['raw_path'] = request.scope['raw_path'][4:]
        response = await call_next(request)
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers.setdefault('Cache-Control', 'private, no-store')
        return response
    app.add_middleware(TransportBoundaryMiddleware)
    @app.get('/health')
    @app.get('/repaidians/health')
    def service_health():
        return health(core, 'repaido-community-api')
    core.app = app
    import repaidians
    import repaidians_network
    import repaidians_opportunities
    import repaidians_billing
    repaidians.install(core)
    repaidians_network.install(core)
    repaidians_opportunities.install(core)
    repaidians_billing.install(core)
    app.state.core = core
    return app


app = create_app()
