"""Untrusted embedded camera metadata must fail before storage or state changes."""
import io
import json

import pytest
from PIL import Image

import main
from test_operations import api
from test_visits import arrived, blobs, capture, upload


@pytest.mark.parametrize('metadata', [None, [], 'not-a-metadata-object', 7, True])
def test_non_object_camera_metadata_is_rejected_without_storage(api, blobs, metadata):
    job = arrived(api)
    session, header = capture(api, job, 'before')
    exif = Image.Exif()
    exif[0x9286] = json.dumps(metadata).encode()
    output = io.BytesIO()
    Image.new('RGB', (64, 64), 'blue').save(output, format='JPEG', exif=exif)

    response = upload(api, session, header, data=output.getvalue())

    assert response.status_code == 422, response.text
    assert response.json()['detail']['code'] == 'INVALID_CAMERA_PHOTO'
    assert not blobs
    assert main.operations_store.run(lambda unit: unit.all('evidence')) == []
    assert main.operations_store.run(lambda unit: unit.get('jobs', job['id']))['state'] == 'arrived'
