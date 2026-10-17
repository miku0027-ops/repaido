"""Private camera receipts and collection-scoped GPS; no new always-on service."""
import hashlib, io, json, math, time, uuid, logging
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
from PIL import Image, ImageDraw, ImageFont, ImageOps
from fastapi import APIRouter, Depends, Request, Response, HTTPException
from starlette.concurrency import run_in_threadpool
from pydantic import Field
from operations import Input, Pin, Position, fail, metres
from evidence import Metadata, upload_object, download_object
from integrations import configured

class CaptureRequest(Input):
    request_id: str = Field(min_length=16, max_length=100)
    location: Pin

def claim_pickup_photo(u, identifier, uid, request_id, pin, collection_id):
    photo = u.get('business_documents', identifier)
    if not photo or photo.get('owner_id') != uid or photo.get('kind') != 'scrap_camera' or photo.get('status') != 'ready':
        fail('CAMERA_PHOTO_REQUIRED', 'Take a pickup photo with the Repaido camera before requesting collection.', 422)
    if photo.get('request_id') != request_id or photo.get('claimed_by') not in (None, collection_id):
        fail('PHOTO_SCOPE_CHANGED', 'This photo belongs to another request. Take a new pickup photo.', 409)
    if time.time() - photo['server_received_at'] > 1800 or metres(photo['pickup'], pin) > 10:
        fail('PHOTO_EXPIRED', 'The pickup or photo has changed. Take a fresh photo at this pickup.', 422)
    photo['claimed_by'] = collection_id
    u.put('business_documents', identifier, photo)
    return {key: photo[key] for key in ('id', 'server_received_at', 'sha256')}

def stamp_photo(data, capture_id, received_at):
    with Image.open(io.BytesIO(data)) as source:
        image = ImageOps.exif_transpose(source).convert('RGB')
        image.thumbnail((1280, 1280))
    width = image.width
    footer = max(90, round(width * .11))
    output = Image.new('RGB', (width, image.height + footer), '#10234e')
    output.paste(image, (0, 0))
    draw = ImageDraw.Draw(output)
    font = ImageFont.truetype(str(Path(__file__).parent/'fonts/Poppins-SemiBold.ttf'), max(10, round(width*.025)))
    inset = max(8, round(width*.018))
    clock = datetime.fromtimestamp(received_at, ZoneInfo('Asia/Kolkata')).strftime('%d %b %Y, %I:%M:%S %p IST')
    for index, text in enumerate(['REPAIDO  |  SCRAP PICKUP', 'Received '+clock, 'Camera receipt '+capture_id[:12]]):
        draw.text((inset, image.height+inset+index*max(23, round(width*.025))), text, fill='white', font=font)
    buffer = io.BytesIO(); output.save(buffer, format='JPEG', quality=88)
    return buffer.getvalue()

def install(core):
    from local_business import current, view, document
    store = core.operations_store
    router = APIRouter(prefix='/operations/local-business/scrap', tags=['Scrap camera and tracking'])

    @router.post('/capture-sessions', status_code=201)
    def capture_session(body: CaptureRequest, user=Depends(core.current_user)):
        if not configured('REPAIDO_KYC_BUCKET'):
            fail('STORAGE_UNAVAILABLE', 'The private camera upload is unavailable. Please try again shortly.', 503)
        def create(u):
            now = time.time()
            quota_id = hashlib.sha256(user['id'].encode()).hexdigest()
            quota = u.get('scrap_capture_limits', quota_id) or {}
            hour = int(now//3600)
            count = quota.get('count',0) if quota.get('hour')==hour else 0
            if count >= 20: fail('CAPTURE_LIMIT', 'Too many capture attempts. Please try again later.', 429)
            u.put('scrap_capture_limits',quota_id,{'id':quota_id,'hour':hour,'count':count+1})
            row = dict(id=str(uuid.uuid4()), owner_id=user['id'], request_id=body.request_id, pickup=body.location.model_dump(), issued_at=now, expires_at=now+600)
            u.put('scrap_capture_sessions', row['id'], row)
            return {'id': row['id'], 'request_id': body.request_id, 'server_time': now, 'expires_at': row['expires_at']}
        return store.run(create)

    @router.post('/capture-sessions/{capture_id}/photo')
    async def camera_photo(capture_id: str, request: Request, user=Depends(core.current_user)):
        if not configured('REPAIDO_KYC_BUCKET'): fail('STORAGE_UNAVAILABLE', 'Private photo storage is unavailable.', 503)
        if request.headers.get('content-type') != 'image/jpeg': fail('CAMERA_PHOTO_REQUIRED', 'Use the Repaido camera photo.', 422)
        try: metadata = Metadata.model_validate(json.loads(request.headers.get('x-capture-metadata', '{}')))
        except (ValueError, TypeError): fail('INVALID_METADATA', 'Use a fresh camera photo with an accurate location.', 422)
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > 5*1024*1024: fail('PHOTO_TOO_LARGE', 'Retake the photo at a smaller resolution.', 413)
        try:
            with Image.open(io.BytesIO(data)) as image:
                if image.format != 'JPEG' or min(image.size) < 32 or image.width*image.height > 20_000_000: raise ValueError()
                if not data.endswith(b'\xff\xd9'): raise ValueError()
                comment = image.getexif().get(0x9286)
                if isinstance(comment, bytes): comment = comment.removeprefix(b'ASCII\x00\x00\x00').decode('utf-8')
                embedded = json.loads(comment)
                if not isinstance(embedded, dict): raise ValueError()
                image.load()
        except Exception: fail('INVALID_CAMERA_PHOTO', 'Retake this photo with the Repaido camera.', 422)
        if embedded.get('capture_id') != capture_id or any(embedded.get(key) != value for key,value in metadata.model_dump().items()):
            fail('CAMERA_METADATA_MISMATCH', 'The photo and camera receipt do not match. Retake the photo.', 422)
        def save_photo():
            checksum = hashlib.sha256(data).hexdigest()
            def reserve(u):
                session = u.get('scrap_capture_sessions', capture_id)
                if not session or session['owner_id'] != user['id']: fail('NOT_FOUND', 'Camera receipt unavailable.', 404)
                old = u.get('business_documents', capture_id)
                if old and old['input_sha256'] != checksum: fail('CAPTURE_REUSED', 'A different photo needs a new camera receipt.', 409)
                if old and old['status'] == 'ready': return old, False
                now = time.time()
                if now > session['expires_at'] or abs(now-metadata.captured_at) > 180 or metadata.captured_at < session['issued_at']-5:
                    fail('STALE_CAPTURE', 'Take a fresh photo and keep your device clock set automatically.', 422)
                if metadata.accuracy > 100 or metres(metadata.model_dump(), session['pickup'])+metadata.accuracy > 300:
                    fail('PICKUP_LOCATION_REQUIRED', 'Take the photo at the pickup, within 300 metres. Retry an accurate location.', 422)
                if old and old.get('lease_until', 0) > now: fail('UPLOAD_PENDING', 'The photo is uploading. Check again shortly.', 409)
                row = old or dict(id=capture_id, owner_id=user['id'], kind='scrap_camera', request_id=session['request_id'], pickup=session['pickup'], camera_metadata=metadata.model_dump(),input_sha256=checksum, server_received_at=now, created_at=now, object='scrap-camera/'+user['id']+'/'+capture_id+'.jpg', expires_at=now+30*86400, provenance='Authenticated camera flow; device GPS is not hardware attestation')
                row.update(status='uploading', lease_until=now+60)
                u.put('business_documents', capture_id, row)
                return row, True
            row, send = store.run(reserve)
            if send:
                stamped = stamp_photo(bytes(data), capture_id, row['server_received_at'])
                stamped_hash = hashlib.sha256(stamped).hexdigest()
                try: upload_object(row['object'], stamped)
                except Exception as error:
                    logging.getLogger(__name__).warning('Scrap camera upload failed; class=%s receipt=%s',type(error).__name__,capture_id)
                    try:
                        if hashlib.sha256(download_object(row['object'])).hexdigest() != stamped_hash: raise ValueError()
                    except Exception:
                        store.run(lambda u: u.put('business_documents', capture_id, {**row, 'lease_until': 0}))
                        fail('UPLOAD_UNAVAILABLE', 'The photo could not upload. Keep this screen open and retry the same photo.', 503)
                row.update(status='ready', lease_until=0, sha256=stamped_hash)
                store.run(lambda u: u.put('business_documents', capture_id, row))
            return {'id': row['id'], 'status': 'ready', 'server_received_at': row['server_received_at']}

        return await run_in_threadpool(save_photo)

    def accessible(u, identifier, uid, collector=False):
        row = u.get('scrap_collections', identifier)
        if not row or uid not in (row['customer_id'], row.get('owner_id')) or collector and uid != row.get('owner_id'):
            fail('NOT_FOUND', 'Collection unavailable.', 404)
        if collector: current(u, uid, ('scrap_owner',))
        return row

    @router.get('/{identifier}')
    def collection(identifier: str, user=Depends(core.current_user)):
        def read(u):
            row=u.get('scrap_collections',identifier);uid=user['id']
            if row and row['state']=='requested' and uid in row.get('candidate_owner_ids',[]):
                # The request list opens this detail before acceptance. Keep its
                # candidate projection sanitized; photo/GPS routes remain private.
                current(u,uid,('scrap_owner',))
                return view(row,uid)
            return view(accessible(u,identifier,uid),uid)
        return store.run(read)

    @router.get('/{identifier}/pickup-photo')
    def pickup_photo(identifier: str, user=Depends(core.current_user)):
        def read(u):
            row = accessible(u, identifier, user['id'])
            photo = document(u, row.get('photo_document_id'), row['customer_id'])
            if photo.get('expires_at', 0) < time.time(): fail('NOT_FOUND', 'The pickup photo has expired.', 404)
            return photo
        photo = store.run(read)
        try: content = download_object(photo['object'])
        except Exception: fail('PHOTO_UNAVAILABLE', 'The pickup photo could not load. Retry shortly.', 503)
        return Response(content, media_type='image/jpeg', headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'})

    @router.get('/{identifier}/tracking')
    def tracking(identifier: str, response: Response, user=Depends(core.current_user)):
        response.headers['Cache-Control'] = 'private, no-store'
        def read(u):
            row = accessible(u, identifier, user['id']); now = time.time()
            active = row['state'] in ('accepted','evaluated','agreed','payment_reported') and bool(row.get('tracking_consent'))
            if active:
                try: current(u, row['owner_id'], ('scrap_owner',))
                except HTTPException: active = False
            position = u.get('scrap_positions', identifier) if active else None
            if position and (position.get('owner_id') != row.get('owner_id') or now-position['received_at'] > 75): position = None
            return {'id':identifier,'state':row['state'],'phase':row.get('travel_phase','confirmed'),'pickup':row['location'],'collector_name':row.get('buyer_name'),'sharing':active,'position':{key:position[key] for key in ('lat','lng','accuracy','captured_at','received_at')} if position else None,'server_time':now}
        return store.run(read)

    def save_position(identifier, body, user, begin=False):
        def save(u):
            row = accessible(u, identifier, user['id'], True); now = time.time()
            if row['state'] not in ('accepted','evaluated','agreed','payment_reported'): fail('TRACKING_CLOSED', 'Location sharing is closed for this collection.', 409)
            if not math.isfinite(body.captured_at) or not -10 <= now-body.captured_at <= 120: fail('STALE_POSITION', 'Use a fresh location reading.', 422)
            if not begin and not row.get('tracking_consent'): fail('TRACKING_PAUSED', 'Location sharing is paused.', 409)
            old = u.get('scrap_positions', identifier)
            if old and old['captured_at'] > body.captured_at: fail('STALE_POSITION', 'A newer location is already available.', 409)
            if begin:
                row['tracking_consent'] = True; u.put('scrap_collections', identifier, row)
            u.put('scrap_positions', identifier, dict(id=identifier, owner_id=user['id'], **body.model_dump(), received_at=now))
            return {'saved':True,'server_time':now}
        return store.run(save)

    @router.post('/{identifier}/position')
    def position(identifier: str, body: Position, user=Depends(core.current_user)): return save_position(identifier, body, user)

    @router.post('/{identifier}/position/start')
    def start_position(identifier: str, body: Position, user=Depends(core.current_user)): return save_position(identifier, body, user, True)

    @router.post('/{identifier}/position/stop')
    def stop_position(identifier: str, user=Depends(core.current_user)):
        def stop(u):
            row = accessible(u, identifier, user['id'], True)
            row['tracking_consent'] = False; u.put('scrap_collections', identifier, row)
            u.put('scrap_positions', identifier, {'id':identifier,'owner_id':user['id'],'captured_at':0,'received_at':0})
            return {'sharing':False}
        return store.run(stop)
    core.app.include_router(router)
