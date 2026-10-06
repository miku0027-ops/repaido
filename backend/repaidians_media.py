"""Private community media storage. The API must authorize each read first.

Objects live under their own prefix even when the private KYC bucket is reused.
Cloud/Firestore deployments never fall back to an ephemeral container filesystem.
"""
import io
import os
import re
import struct
import tempfile
import warnings
from pathlib import Path

from fastapi import HTTPException
from PIL import Image, ImageOps

from operations import fail


MAX_BYTES = 8 * 1024 * 1024
MAX_PIXELS = 20_000_000
_KEY = re.compile(r"^repaidians/(?:[A-Za-z0-9_-]{1,128}/)*[A-Za-z0-9_-]{1,128}(?:\.(?:jpg|png|webp|mp4|webm))?$")
_IMAGE_TYPES = {'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WEBP'}


def _bucket():
    return (os.getenv('REPAIDO_COMMUNITY_BUCKET', '').strip()
            or os.getenv('REPAIDO_KYC_BUCKET', '').strip())


def ready(core):
    """Whether a durable media destination is configured for this store."""
    return bool(_bucket()) or not core.USE_FIRESTORE


def _valid_key(key):
    if not isinstance(key, str) or not _KEY.fullmatch(key) or len(key) > 512:
        fail('INVALID_MEDIA_KEY', 'Invalid community media reference.', 422)
    return key


def _local_path(core, key):
    directory = os.getenv('REPAIDO_COMMUNITY_MEDIA_DIR', '').strip()
    root = Path(directory or str(Path(core.DB_PATH).absolute().parent / 'community-media')).resolve()
    target = (root / _valid_key(key)).resolve()
    if not target.is_relative_to(root):
        fail('INVALID_MEDIA_KEY', 'Invalid community media reference.', 422)
    return target


def _mp4(data):
    """Check complete ISO-BMFF box framing and a recognizable video container."""
    offset = 0
    types = set()
    brands = set()
    while offset < len(data):
        if len(data) - offset < 8:
            return False
        size, box = struct.unpack_from('>I4s', data, offset)
        header = 8
        if size == 1:
            if len(data) - offset < 16:
                return False
            size = struct.unpack_from('>Q', data, offset + 8)[0]
            header = 16
        elif size == 0:
            size = len(data) - offset
        if size < header or size > len(data) - offset:
            return False
        if offset == 0 and box != b'ftyp':
            return False
        if box == b'ftyp':
            payload = data[offset + header:offset + size]
            if len(payload) < 8 or (len(payload) - 8) % 4:
                return False
            brands.update([payload[:4], *[payload[i:i + 4] for i in range(8, len(payload), 4)]])
        types.add(box)
        offset += size
    supported = {b'isom', b'iso2', b'iso4', b'iso5', b'iso6', b'mp41', b'mp42', b'avc1', b'dash', b'M4V '}
    return bool(brands & supported) and {b'ftyp', b'moov', b'mdat'} <= types


def _vint(data, offset, keep_marker=False):
    if offset >= len(data) or data[offset] == 0:
        raise ValueError('Incomplete EBML element')
    first = data[offset]
    width = 1
    while width <= 8 and not first & (1 << (8 - width)):
        width += 1
    if width > 8 or offset + width > len(data):
        raise ValueError('Incomplete EBML element')
    value = int.from_bytes(data[offset:offset + width], 'big')
    if not keep_marker:
        value &= (1 << (7 * width)) - 1
    return value, offset + width, width


def _webm(data):
    """Validate EBML header, WebM doctype and segment/track/cluster framing."""
    try:
        if not data.startswith(b'\x1a\x45\xdf\xa3'):
            return False
        size, offset, _ = _vint(data, 4)
        end = offset + size
        if end > len(data):
            return False
        doc_type = None
        while offset < end:
            element, offset, _ = _vint(data, offset, True)
            length, offset, _ = _vint(data, offset)
            if offset + length > end:
                return False
            if element == 0x4282:
                doc_type = data[offset:offset + length]
            offset += length
        if offset != end or doc_type != b'webm' or data[end:end + 4] != b'\x18\x53\x80\x67':
            return False
        segment_size, offset, width = _vint(data, end + 4)
        unknown = segment_size == (1 << (7 * width)) - 1
        segment_end = len(data) if unknown else offset + segment_size
        if segment_end != len(data):
            return False
        elements = set()
        while offset < segment_end:
            element, offset, _ = _vint(data, offset, True)
            length, offset, width = _vint(data, offset)
            # Browser WebM capture can use an unknown-size cluster to EOF.
            if length == (1 << (7 * width)) - 1 and element == 0x1F43B675:
                length = segment_end - offset
            if offset + length > segment_end:
                return False
            elements.add(element)
            offset += length
        return {0x1654AE6B, 0x1F43B675} <= elements
    except (ValueError, OverflowError):
        return False


def prepare(data, content_type):
    """Validate and normalize bytes before persisting an authenticated upload.

    Image metadata is removed. Video containers are checked without executing a
    codec or accepting active HTML/SVG content; serving must use nosniff headers.
    """
    if not isinstance(data, (bytes, bytearray, memoryview)) or not data:
        fail('INVALID_MEDIA', 'Choose a complete photo or video.', 422)
    if len(data) > MAX_BYTES:
        fail('MEDIA_TOO_LARGE', 'Choose media no larger than 8 MB.', 413)
    data = bytes(data)
    mime = (content_type or '').split(';', 1)[0].strip().lower()
    if mime in _IMAGE_TYPES:
        try:
            with warnings.catch_warnings():
                warnings.simplefilter('error', Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(data)) as image:
                    if image.format != _IMAGE_TYPES[mime] or image.width * image.height > MAX_PIXELS:
                        raise ValueError('Invalid image')
                    image.verify()
                with Image.open(io.BytesIO(data)) as image:
                    image = ImageOps.exif_transpose(image)
                    mode = 'RGBA' if image.mode in ('RGBA', 'LA') or 'transparency' in image.info else 'RGB'
                    # Copy pixels into a new image to remove EXIF, ICC and other metadata.
                    cleaned = Image.new(mode, image.size)
                    cleaned.paste(image.convert(mode))
                    output = io.BytesIO()
                    if mode == 'RGBA':
                        cleaned.save(output, format='PNG')
                        result_mime = 'image/png'
                    else:
                        cleaned.save(output, format='JPEG', quality=88, optimize=True)
                        result_mime = 'image/jpeg'
                    result = output.getvalue()
        except Exception:
            fail('INVALID_IMAGE', 'Choose a valid JPEG, PNG or WebP photo up to 20 megapixels.', 422)
        if len(result) > MAX_BYTES:
            fail('MEDIA_TOO_LARGE', 'The normalized photo exceeds 8 MB. Choose a smaller photo.', 413)
        return result, result_mime, 'image'
    if mime == 'video/mp4' and _mp4(data) or mime == 'video/webm' and _webm(data):
        return data, mime, 'video'
    fail('INVALID_MEDIA', 'Choose a valid JPEG, PNG, WebP, MP4 or WebM file.', 422)


def write(core, key, data, mime):
    """Persist private bytes; object references are never public URLs."""
    _valid_key(key)
    if not ready(core):
        fail('STORAGE_UNAVAILABLE', 'Community media storage is unavailable. Retry later.', 503)
    try:
        bucket = _bucket()
        if bucket:
            from google.cloud import storage
            blob = storage.Client().bucket(bucket).blob(key)
            blob.cache_control = 'private, no-store'
            blob.upload_from_string(data, content_type=mime, if_generation_match=0)
            return
        target = _local_path(core, key)
        target.parent.mkdir(parents=True, exist_ok=True)
        # Write and fsync in the destination directory before atomically linking
        # a create-only object, so a crash never exposes a partial upload.
        descriptor, temp_path = tempfile.mkstemp(prefix='.upload-', dir=target.parent)
        try:
            with os.fdopen(descriptor, 'wb') as output:
                output.write(data)
                output.flush()
                os.fsync(output.fileno())
            os.link(temp_path, target)
            directory = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            os.unlink(temp_path)
    except FileExistsError:
        fail('MEDIA_EXISTS', 'This media reference already exists.', 409)
    except HTTPException:
        raise
    except Exception as error:
        if getattr(error, 'code', None) in (409, 412):
            fail('MEDIA_EXISTS', 'This media reference already exists.', 409)
        fail('STORAGE_UNAVAILABLE', 'Community media could not be stored. Retry later.', 503)


def read(core, key):
    """Read private bytes only after the caller has checked visibility/access."""
    _valid_key(key)
    if not ready(core):
        fail('STORAGE_UNAVAILABLE', 'Community media storage is unavailable. Retry later.', 503)
    try:
        bucket = _bucket()
        if bucket:
            from google.cloud import storage
            return storage.Client().bucket(bucket).blob(key).download_as_bytes()
        return _local_path(core, key).read_bytes()
    except FileNotFoundError:
        fail('NOT_FOUND', 'Community media was not found.', 404)
    except HTTPException:
        raise
    except Exception as error:
        # Avoid importing cloud clients until a cloud destination is configured.
        if getattr(error, 'code', None) == 404:
            fail('NOT_FOUND', 'Community media was not found.', 404)
        fail('STORAGE_UNAVAILABLE', 'Community media is temporarily unavailable.', 503)
