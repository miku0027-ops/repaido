"""Real ASGI requests prove bounds apply before parsing and survive failures."""
import asyncio

import httpx
import pytest
from fastapi import FastAPI, Request
from fastapi.responses import Response, StreamingResponse

from http_boundary import TransportBoundaryMiddleware
from test_operations import api, auth, onboard


def application(monkeypatch, **settings):
    for name, value in settings.items():
        monkeypatch.setenv(name, str(value))
    app = FastAPI()
    app.add_middleware(TransportBoundaryMiddleware)
    app.state.called = []

    @app.post('/json')
    async def json_read(request: Request):
        data = await request.json()
        app.state.called.append(data)
        return {'ok': True}

    @app.post('/binary')
    async def binary_read(request: Request):
        data = await request.body()
        app.state.called.append(len(data))
        return {'length': len(data)}

    @app.get('/private')
    def private():
        return {'private': 'account data'}

    @app.get('/media')
    def media():
        return Response(status_code=304, headers={'Cache-Control': 'private, max-age=0, must-revalidate',
                                                'ETag': '"immutable-asset"', 'Vary': 'Authorization, Cookie'})

    @app.get('/health')
    def health():
        return {'ok': True}

    return app


@pytest.mark.parametrize('length', ['-1', 'not-a-length', '9' * 5000])
def test_invalid_content_length_rejected_without_parsing(monkeypatch, length):
    async def run():
        app = application(monkeypatch)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            response = await client.post('/json', headers={'Content-Length': length}, content=b'{}')
            assert response.status_code == 400
            assert app.state.called == []
    asyncio.run(run())


def test_oversized_declared_body_and_headers_do_no_application_work(monkeypatch):
    async def run():
        app = application(monkeypatch, REPAIDO_HTTP_JSON_MAX_BYTES=16)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            response = await client.post('/json', content=b'{"value":"too much data"}', headers={'Content-Type': 'application/json'})
            assert response.status_code == 413
            assert response.headers['cache-control'] == 'private, no-store'
            assert response.headers['x-content-type-options'] == 'nosniff'
            response = await client.post('/json', json={}, headers={'Authorization': 'Bearer ' + 'a' * 32768})
            assert response.status_code == 431
            assert app.state.called == []
    asyncio.run(run())


def test_chunked_body_limit_counts_actual_bytes_and_binary_has_separate_budget(monkeypatch):
    async def chunks():
        yield b'{"value":"'
        yield b'a' * 30
        yield b'"}'

    async def run():
        app = application(monkeypatch, REPAIDO_HTTP_JSON_MAX_BYTES=16, REPAIDO_HTTP_MEDIA_MAX_BYTES=64)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            response = await client.post('/json', content=chunks(), headers={'Content-Type': 'application/json'})
            assert response.status_code == 413, response.text
            assert app.state.called == []
            response = await client.post('/binary', content=chunks(), headers={'Content-Type': 'application/octet-stream'})
            assert response.status_code == 200 and response.json()['length'] == 42
            response = await client.post('/binary', content=b'a' * 65, headers={'Content-Type': 'image/jpeg'})
            assert response.status_code == 413
            response = await client.post('/json', content=b'{}', headers={'Content-Encoding': 'gzip'})
            assert response.status_code == 415
    asyncio.run(run())


def test_private_defaults_preserve_authorized_conditional_media_response(monkeypatch):
    async def run():
        app = application(monkeypatch)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            response = await client.get('/private')
            assert response.headers['cache-control'] == 'private, no-store'
            assert response.headers['x-frame-options'] == 'DENY'
            response = await client.get('/media')
            assert response.status_code == 304 and response.content == b''
            assert response.headers['cache-control'] == 'private, max-age=0, must-revalidate'
            assert response.headers['etag'] == '"immutable-asset"'
            assert response.headers['vary'] == 'Authorization, Cookie'
    asyncio.run(run())


def test_overload_timeout_cancellation_and_streaming_release_slots(monkeypatch):
    async def run():
        app = application(monkeypatch, REPAIDO_API_MAX_INFLIGHT=1, REPAIDO_API_MAX_WAITING=1)
        entered, release = asyncio.Event(), asyncio.Event()

        @app.get('/slow')
        async def slow():
            async def data():
                entered.set()
                await release.wait()
                yield b'done'
            return StreamingResponse(data())

        @app.get('/fail')
        async def failure():
            raise ValueError('local test failure')

        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=False), base_url='http://test') as client:
            first = asyncio.create_task(client.get('/slow'))
            await entered.wait()
            queued = asyncio.create_task(client.get('/private'))
            await asyncio.sleep(.01)
            overloaded = await client.get('/private')
            assert overloaded.status_code == 503 and overloaded.headers['retry-after'] == '1'
            assert (await queued).status_code == 503
            assert (await client.get('/health')).status_code == 200
            first.cancel()
            with pytest.raises(asyncio.CancelledError):
                await first
            assert (await client.get('/private')).status_code == 200
            assert (await client.get('/fail')).status_code == 500
            assert (await client.get('/private')).status_code == 200
    asyncio.run(run())


def test_binary_upload_memory_budget_releases_after_cancel(monkeypatch):
    async def run():
        app = application(monkeypatch, REPAIDO_HTTP_MAX_UPLOADS=1)
        entered, release = asyncio.Event(), asyncio.Event()

        @app.post('/slow-upload')
        async def slow(request: Request):
            await request.body()
            entered.set()
            await release.wait()
            return {'ok': True}

        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            first = asyncio.create_task(client.post('/slow-upload', content=b'photo', headers={'Content-Type': 'image/jpeg'}))
            await entered.wait()
            response = await client.post('/binary', content=b'photo', headers={'Content-Type': 'image/jpeg'})
            assert response.status_code == 503 and response.json()['detail']['code'] == 'UPLOAD_BUSY'
            assert (await client.get('/private')).status_code == 200
            first.cancel()
            with pytest.raises(asyncio.CancelledError):
                await first
            assert (await client.post('/binary', content=b'photo', headers={'Content-Type': 'image/jpeg'})).status_code == 200
    asyncio.run(run())


@pytest.mark.parametrize('idle,total,delay', [(.01,1,.05), (1,.03,.02)])
def test_slow_chunked_body_has_idle_and_absolute_deadlines_and_releases_slots(monkeypatch,idle,total,delay):
    async def chunks():
        for _ in range(10):
            yield b'a'
            await asyncio.sleep(delay)

    async def run():
        app=application(monkeypatch,REPAIDO_HTTP_BODY_IDLE_SECONDS=idle,REPAIDO_HTTP_BODY_TOTAL_SECONDS=total,
                        REPAIDO_HTTP_MAX_UPLOADS=1,REPAIDO_API_MAX_INFLIGHT=1)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
            response=await client.post('/binary',content=chunks(),headers={'Content-Type':'image/jpeg'})
            assert response.status_code==408 and response.json()['detail']['code']=='BODY_TIMEOUT'
            assert response.headers['cache-control']=='private, no-store'
            assert app.state.called==[]
            assert (await client.post('/binary',content=b'a',headers={'Content-Type':'image/jpeg'})).status_code==200
    asyncio.run(run())


def test_existing_kyc_pdf_over_one_megabyte_keeps_auth_and_route_limits(api, monkeypatch):
    import main
    from google.cloud import storage
    onboard(api, approve=False)
    monkeypatch.setenv('REPAIDO_KYC_BUCKET', 'local-test-private-bucket')
    written = []

    class Blob:
        def upload_from_string(self, data, **options):
            written.append((data, options))

    class Bucket:
        def blob(self, key):
            return Blob()

    monkeypatch.setattr(storage, 'Client', lambda: type('Client', (), {'bucket': lambda self, name: Bucket()})())
    data = b'%PDF-1.7\n' + b'0' * (1024 * 1024 + 7)
    headers = {'Content-Type': 'application/pdf', 'X-Verification-Consent': 'private-review-v1'}
    path = '/api/operations/worker/documents/identity'
    assert api.post(path, content=data, headers=headers).status_code == 401
    assert api.post(path, content=data, headers={**auth('customer'), **headers}).status_code == 403
    response = api.post(path, content=data, headers={**auth('worker'), **headers})
    assert response.status_code == 200, response.text
    assert response.json()['status'] == 'pending_review'
    assert written[0][0] == data and written[0][1]['content_type'] == 'application/pdf'
    assert written[0][1]['if_generation_match'] == 0
    assert api.post(path, content=b'%PDF-' + b'0' * (5 * 1024 * 1024), headers={**auth('worker'), **headers}).status_code == 413
    assert len(written) == 1
    documents = main.operations_store.run(lambda unit: unit.all('documents'))
    assert len(documents) == 1 and documents[0]['worker_id'] == 'worker'
