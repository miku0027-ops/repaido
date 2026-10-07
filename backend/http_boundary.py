"""Bound transport work before authentication, JSON parsing or database reads.

The admission gate is per process. Edge DDoS protection and a global request
budget require a trusted load balancer; forwarded headers are never treated as
client identity here. Stream limits also cover chunked bodies without buffering.
"""
import asyncio
import math
import os
import time

from starlette.datastructures import MutableHeaders
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse


def positive_setting(name, default, maximum):
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        raise RuntimeError(f'{name} must be between 1 and {maximum}.') from None
    if not 1 <= value <= maximum:
        raise RuntimeError(f'{name} must be between 1 and {maximum}.')
    return value


def timeout_setting(name, default, maximum):
    try:
        value = float(os.getenv(name, str(default)))
    except ValueError:
        raise RuntimeError(f'{name} must be greater than zero and at most {maximum}.') from None
    if not math.isfinite(value) or not 0 < value <= maximum:
        raise RuntimeError(f'{name} must be greater than zero and at most {maximum}.')
    return value


class TransportBoundaryMiddleware:
    def __init__(self, app, *, admission=True):
        self.app = app
        self.json_limit = positive_setting('REPAIDO_HTTP_JSON_MAX_BYTES', 1024 * 1024, 8 * 1024 * 1024)
        self.media_limit = positive_setting('REPAIDO_HTTP_MEDIA_MAX_BYTES', 8 * 1024 * 1024, 32 * 1024 * 1024)
        self.header_limit = 32 * 1024
        self.admission = admission
        self.active_limit = positive_setting('REPAIDO_API_MAX_INFLIGHT', 32, 512)
        self.waiting_limit = positive_setting('REPAIDO_API_MAX_WAITING', 32, 512)
        self.upload_limit = positive_setting('REPAIDO_HTTP_MAX_UPLOADS', 2, 16)
        self.body_idle = timeout_setting('REPAIDO_HTTP_BODY_IDLE_SECONDS', 15, 120)
        self.body_total = timeout_setting('REPAIDO_HTTP_BODY_TOTAL_SECONDS', 120, 600)
        self.gate = asyncio.Semaphore(self.active_limit)
        self.inflight = self.waiting = 0
        self.uploads = 0

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)

        async def guarded_send(message):
            if message['type'] == 'http.response.start':
                headers = MutableHeaders(scope=message)
                headers.setdefault('Cache-Control', 'private, no-store')
                headers['X-Content-Type-Options'] = 'nosniff'
                headers['X-Frame-Options'] = 'DENY'
                headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
            await send(message)

        async def reject(status, code, message, *, retry=False):
            response = JSONResponse({'detail': {'code': code, 'message': message}}, status_code=status,
                                    headers={'Retry-After': '1'} if retry else {})
            await response(scope, receive, guarded_send)

        raw_headers = scope.get('headers', [])
        if sum(len(name) + len(value) for name, value in raw_headers) > self.header_limit:
            return await reject(431, 'HEADERS_TOO_LARGE', 'Request headers are too large.')
        lengths = [value for name, value in raw_headers if name.lower() == b'content-length']
        if len(lengths) > 1 or lengths and (not lengths[0] or len(lengths[0]) > 20 or not lengths[0].isdigit()):
            return await reject(400, 'INVALID_CONTENT_LENGTH', 'Invalid request length.')
        content_type = next((value.decode('latin-1').split(';', 1)[0].strip().lower()
                             for name, value in raw_headers if name.lower() == b'content-type'), '')
        media_types = {'application/octet-stream', 'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'}
        limit = self.media_limit if content_type in media_types else self.json_limit
        if lengths and int(lengths[0]) > limit:
            return await reject(413, 'PAYLOAD_TOO_LARGE', 'The request exceeds the upload limit.')
        encoding = next((value.decode('latin-1').strip().lower()
                         for name, value in raw_headers if name.lower() == b'content-encoding'), '')
        if encoding not in ('', 'identity'):
            return await reject(415, 'UNSUPPORTED_ENCODING', 'Compressed request bodies are not supported.')

        received = 0
        body_complete = False
        body_deadline = time.monotonic() + self.body_total

        async def bounded_receive():
            nonlocal received, body_complete
            # Streaming responses may listen for disconnect after the request
            # body ends. Their lifetime is not a request-upload deadline.
            if body_complete:
                return await receive()
            remaining = body_deadline - time.monotonic()
            try:
                if remaining <= 0:
                    raise asyncio.TimeoutError
                message = await asyncio.wait_for(receive(), timeout=min(self.body_idle, remaining))
            except asyncio.TimeoutError:
                raise HTTPException(408, {'code': 'BODY_TIMEOUT', 'message': 'The upload took too long. Please retry.'}) from None
            if message['type'] == 'http.request':
                received += len(message.get('body', b''))
                if received > limit:
                    raise HTTPException(413, {'code': 'PAYLOAD_TOO_LARGE', 'message': 'The request exceeds the upload limit.'})
                body_complete = not message.get('more_body', False)
            return message

        async def run():
            path = scope['path'].removeprefix('/api')
            health_request = scope['method'] in ('GET', 'HEAD') and path in ('/health', '/repaidians/work/health')
            if not self.admission or health_request:
                return await self.app(scope, bounded_receive, guarded_send)
            if self.inflight + self.waiting >= self.active_limit + self.waiting_limit:
                return await reject(503, 'API_BUSY', 'Please retry shortly.', retry=True)
            self.waiting += 1
            try:
                await asyncio.wait_for(self.gate.acquire(), timeout=0.1)
            except asyncio.TimeoutError:
                return await reject(503, 'API_BUSY', 'Please retry shortly.', retry=True)
            finally:
                self.waiting -= 1
            self.inflight += 1
            try:
                await self.app(scope, bounded_receive, guarded_send)
            finally:
                self.inflight -= 1
                self.gate.release()

        # Pixel normalization can allocate much more memory than the encoded
        # file. Keep concurrent raw uploads below the ordinary request budget.
        upload = content_type in media_types and scope['method'] in ('POST', 'PUT', 'PATCH')
        if upload:
            if self.uploads >= self.upload_limit:
                return await reject(503, 'UPLOAD_BUSY', 'Please retry the upload shortly.', retry=True)
            self.uploads += 1
            try:
                return await run()
            finally:
                self.uploads -= 1
        await run()
