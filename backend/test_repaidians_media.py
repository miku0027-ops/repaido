import io
import struct
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from PIL import Image

import repaidians_media as media


@pytest.fixture
def core(tmp_path, monkeypatch):
    monkeypatch.delenv('REPAIDO_COMMUNITY_BUCKET', raising=False)
    monkeypatch.delenv('REPAIDO_KYC_BUCKET', raising=False)
    monkeypatch.delenv('REPAIDO_COMMUNITY_MEDIA_DIR', raising=False)
    return SimpleNamespace(USE_FIRESTORE=False, DB_PATH=str(tmp_path / 'community.db'))


def photo(format='JPEG', mode='RGB'):
    output = io.BytesIO()
    exif = Image.Exif()
    exif[0x9286] = 'Private location metadata'
    Image.new(mode, (32, 48), 'blue').save(output, format=format, exif=exif)
    return output.getvalue()


def box(kind, payload=b''):
    return struct.pack('>I4s', len(payload) + 8, kind) + payload


def mp4():
    return box(b'ftyp', b'isom\x00\x00\x00\x00mp42') + box(b'moov') + box(b'mdat', b'video frame')


def webm():
    header = b'\x42\x82\x84webm'
    segment = b'\x16\x54\xae\x6b\x80\x1f\x43\xb6\x75\x81\x00'
    return b'\x1a\x45\xdf\xa3' + bytes([0x80 + len(header)]) + header + b'\x18\x53\x80\x67' + bytes([0x80 + len(segment)]) + segment


@pytest.mark.parametrize('format,mime', [('JPEG', 'image/jpeg'), ('PNG', 'image/png'), ('WEBP', 'image/webp')])
def test_photo_validation_and_private_metadata_removal(format, mime):
    result, normalized_mime, kind = media.prepare(photo(format), mime)
    assert kind == 'image' and normalized_mime == 'image/jpeg'
    with Image.open(io.BytesIO(result)) as image:
        assert image.size == (32, 48)
        assert not image.getexif()
        assert not image.info.get('icc_profile')


def test_transparency_is_preserved_without_metadata():
    result, mime, _ = media.prepare(photo('PNG', 'RGBA'), 'image/png')
    assert mime == 'image/png'
    with Image.open(io.BytesIO(result)) as image:
        assert image.mode == 'RGBA'
        assert not image.getexif()


@pytest.mark.parametrize('data,mime', [(b'<html>active content</html>', 'image/jpeg'), (photo(), 'image/png'), (b'GIF89a', 'image/gif'), (b'', 'video/mp4')])
def test_disguised_or_incomplete_media_is_rejected(data, mime):
    with pytest.raises(HTTPException) as error:
        media.prepare(data, mime)
    assert error.value.status_code == 422


def test_size_and_pixel_limits(monkeypatch):
    with pytest.raises(HTTPException) as error:
        media.prepare(b'x' * (media.MAX_BYTES + 1), 'video/mp4')
    assert error.value.status_code == 413
    monkeypatch.setattr(media, 'MAX_PIXELS', 100)
    with pytest.raises(HTTPException) as error:
        media.prepare(photo(), 'image/jpeg')
    assert error.value.status_code == 422


@pytest.mark.parametrize('data,mime', [(mp4(), 'video/mp4'), (webm(), 'video/webm')])
def test_video_container_framing(data, mime):
    assert media.prepare(data, mime) == (data, mime, 'video')
    with pytest.raises(HTTPException):
        media.prepare(data[:-1], mime)
    with pytest.raises(HTTPException):
        media.prepare(data + b'<html>Not a container element</html>', mime)


def test_video_container_requires_expected_signature_and_structure():
    for data, mime in [(mp4(), 'video/webm'), (webm(), 'video/mp4'), (box(b'ftyp', b'isom\0\0\0\0'), 'video/mp4'), (webm().replace(b'webm', b'html'), 'video/webm')]:
        with pytest.raises(HTTPException) as error:
            media.prepare(data, mime)
        assert error.value.status_code == 422


def test_local_storage_is_durable_create_only_and_namespaced(core):
    assert media.ready(core)
    key = 'repaidians/account_1/1234.jpg'
    media.write(core, key, b'normalized data', 'image/jpeg')
    # A fresh core instance reads from the configured filesystem, not memory.
    assert media.read(SimpleNamespace(**vars(core)), key) == b'normalized data'
    with pytest.raises(HTTPException) as error:
        media.write(core, key, b'overwrite', 'image/jpeg')
    assert error.value.status_code == 409
    assert media.read(core, key) == b'normalized data'
    with pytest.raises(HTTPException) as error:
        media.read(core, 'repaidians/missing.jpg')
    assert error.value.status_code == 404


@pytest.mark.parametrize('key', ['repaidians/../verification/private.jpg', '/repaidians/photo.jpg', 'verification/secret', 'repaidians//photo.jpg', 'repaidians/a.html', 'repaidians/a\\b'])
def test_storage_keys_cannot_escape_community_prefix(core, key):
    with pytest.raises(HTTPException) as error:
        media.write(core, key, b'data', 'image/jpeg')
    assert error.value.status_code == 422


def test_firestore_without_bucket_does_not_use_ephemeral_local_storage(core):
    core.USE_FIRESTORE = True
    assert not media.ready(core)
    for operation in [lambda: media.write(core, 'repaidians/a.jpg', b'data', 'image/jpeg'), lambda: media.read(core, 'repaidians/a.jpg')]:
        with pytest.raises(HTTPException) as error:
            operation()
        assert error.value.status_code == 503


def test_cloud_bucket_is_private_and_uses_dedicated_bucket_first(core, monkeypatch):
    from google.cloud import storage
    calls = []

    class Blob:
        def upload_from_string(self, data, **kwargs):
            calls.append(('upload', data, kwargs, self.cache_control))

        def download_as_bytes(self):
            return b'private stored photo'

    class Bucket:
        def blob(self, key):
            calls.append(('object', key))
            return Blob()

    class Client:
        def bucket(self, name):
            calls.append(('bucket', name))
            return Bucket()

    monkeypatch.setattr(storage, 'Client', Client)
    monkeypatch.setenv('REPAIDO_KYC_BUCKET', 'private-kyc')
    monkeypatch.setenv('REPAIDO_COMMUNITY_BUCKET', 'private-community')
    core.USE_FIRESTORE = True
    media.write(core, 'repaidians/u/photo.jpg', b'photo', 'image/jpeg')
    assert calls[0] == ('bucket', 'private-community')
    assert calls[1] == ('object', 'repaidians/u/photo.jpg')
    assert calls[2] == ('upload', b'photo', {'content_type': 'image/jpeg', 'if_generation_match': 0}, 'private, no-store')
    monkeypatch.delenv('REPAIDO_COMMUNITY_BUCKET')
    assert media.read(core, 'repaidians/u/photo.jpg') == b'private stored photo'
    assert calls[3] == ('bucket', 'private-kyc')
