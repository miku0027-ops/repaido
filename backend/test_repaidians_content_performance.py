"""Content work is lazy; private media revalidates access before saving bytes."""
import io
import struct
import time

import anyio
import pytest
from starlette.requests import ClientDisconnect

import repaidians as social
import repaidians_media as media
from test_repaidians import api, auth, expire, photo, post, profile


def test_compact_state_avoids_feed_and_global_activity_reads_with_canonical_item_state(api, monkeypatch):
    profile(api)
    profile(api, 'bob')
    item = post(api)
    tender = post(api, kind='tender', title='Actual electrical work', location='Balasore',
                  budgetRupees=15000, slots=2, deadline=int(time.time() * 1000) + 86400000,
                  contact='+919876543210')
    assert api.put('/repaidians/activity/likes/' + item['id'], headers=auth('bob'), json={'active': True}).status_code == 200
    assert api.put('/repaidians/activity/saved/' + item['id'], headers=auth('bob'), json={'active': True}).status_code == 200
    assert api.put('/repaidians/follow/alice', headers=auth('bob'), json={'active': True}).status_code == 200
    assert api.post('/repaidians/bids/' + tender['id'], headers=auth('bob'), json={}).status_code == 201
    assert api.post('/repaidians/messages/bob', headers=auth(), json={'text': 'A real unread update'}).status_code == 201
    full = api.get('/repaidians/state', headers=auth('bob')).json()
    assert full['data']['posts'] and full['activity']['likes'] == [item['id']]
    assert full['activity']['bids'] == [tender['id']]
    calls = []
    original = social.query

    def counted(u, kind, *args, **kwargs):
        calls.append(kind)
        return original(u, kind, *args, **kwargs)
    monkeypatch.setattr(social, 'query', counted)
    compact = api.get('/repaidians/state?content=compact', headers=auth('bob')).json()
    assert compact['member'] == full['member']
    assert compact['capabilities'] == full['capabilities']
    assert compact['subscription'] == full['subscription']
    assert compact['unreadCount'] == full['unreadCount'] == 1
    assert compact['remainingMs'] == full['remainingMs']
    assert all(not compact['data'][key] for key in ('posts', 'stories', 'reels', 'tenders'))
    assert all(not rows for rows in compact['activity'].values())
    assert compact['cursors'] == {}
    assert calls == [social.lane('rp_notifications', 'bob')]
    assert api.get('/repaidians/state?content=unknown', headers=auth('bob')).status_code == 422
    feed = api.get('/repaidians/feed', headers=auth('bob')).json()['items'][0]
    assert feed['id'] == item['id'] and feed['liked'] and feed['saved']
    assert api.get('/repaidians/feed?kind=tender', headers=auth('bob')).json()['items'][0]['hasBid']
    assert not api.get('/repaidians/feed?kind=tender', headers=auth()).json()['items'][0]['hasBid']
    assert api.get('/repaidians/members/alice', headers=auth('bob')).json()['viewerFollowing']
    assert not api.get('/repaidians/members/alice').json()['viewerFollowing']


def test_conditional_media_never_skips_live_block_delete_trade_and_trial_checks(api, monkeypatch):
    profile(api)
    profile(api, 'bob')
    asset = photo(api)
    publication = post(api, media=asset)
    path = asset['url'].removeprefix('/api')
    first = api.get(path, headers=auth('bob'))
    assert first.status_code == 200 and first.content
    assert first.headers['cache-control'] == 'private, max-age=0, must-revalidate'
    assert first.headers['vary'] == 'Authorization, Cookie'
    etag = first.headers['etag']
    assert etag.startswith('"') and len(etag) == 66
    conditional = {**auth('bob'), 'If-None-Match': '"other", W/' + etag}
    monkeypatch.setattr(media, 'stream', lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError('Conditional read downloaded bytes')))
    cached = api.get(path, headers=conditional)
    assert cached.status_code == 304 and cached.content == b''
    assert cached.headers['etag'] == etag
    assert api.put('/repaidians/blocks/alice', headers=auth('bob'), json={'active': True}).status_code == 200
    assert api.get(path, headers=conditional).status_code == 404
    assert api.put('/repaidians/blocks/alice', headers=auth('bob'), json={'active': False}).status_code == 200
    assert api.delete('/repaidians/publications/' + publication['id'], headers=auth()).status_code == 200
    assert api.get(path, headers=conditional).status_code == 404
    private_asset = photo(api)
    post(api, media=private_asset, visibility='trade')
    private_path = private_asset['url'].removeprefix('/api')
    private_head = api.head(private_path, headers=auth('bob'))
    assert private_head.status_code == 200 and not private_head.content
    assert api.patch('/repaidians/profile', headers=auth('bob'), json={'trade': 'plumber'}).status_code == 200
    assert api.get(private_path, headers={**auth('bob'), 'If-None-Match': private_head.headers['etag']}).status_code == 404
    expire(api, 'bob')
    assert api.get(path, headers=conditional).status_code == 402


def test_story_expiry_is_rechecked_even_with_saved_media_validator(api, monkeypatch):
    profile(api)
    profile(api, 'bob')
    asset = photo(api)
    story = post(api, media=asset, kind='story')
    path = asset['url'].removeprefix('/api')
    head = api.head(path, headers=auth('bob'))
    etag = head.headers['etag']
    monkeypatch.setattr(social, 'now_ms', lambda: story['expiresAt'] + 1)
    monkeypatch.setattr(media, 'stream', lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError('Expired story downloaded bytes')))
    assert api.get(path, headers={**auth('bob'), 'If-None-Match': etag}).status_code == 404
    # The uploader retains access to their own file independently of the story.
    assert api.get(path, headers={**auth(), 'If-None-Match': etag}).status_code == 304


def test_video_ranges_fetch_only_requested_bytes_and_handle_validators(api, monkeypatch):
    def box(kind, data=b''):
        return struct.pack('>I4s', len(data) + 8, kind) + data
    video = box(b'ftyp', b'isom\x00\x00\x00\x00mp42') + box(b'moov') + box(b'mdat', b'v' * (2 * 1024 * 1024))
    profile(api)
    uploaded = api.post('/repaidians/media', headers={**auth(), 'Content-Type': 'video/mp4'}, content=video)
    assert uploaded.status_code == 201, uploaded.text
    path = uploaded.json()['url'].removeprefix('/api')
    head = api.head(path, headers=auth())
    assert int(head.headers['content-length']) == len(video)
    calls = []
    original = media.read_range
    def ranged(core, key, start, end, **kwargs):
        calls.append((start, end))
        return original(core, key, start, end, **kwargs)
    monkeypatch.setattr(media, 'read_range', ranged)
    monkeypatch.setattr(media, 'stream', lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError('A range downloaded the full video')))
    part = api.get(path, headers={**auth(), 'Range': 'bytes=24-39', 'If-Range': head.headers['etag']})
    assert part.status_code == 206 and part.content == video[24:40]
    assert part.headers['content-range'] == f'bytes 24-39/{len(video)}'
    assert int(part.headers['content-length']) == 16 and calls == [(24, 39)]
    suffix = api.get(path, headers={**auth(), 'Range': 'bytes=-12'})
    assert suffix.status_code == 206 and suffix.content == video[-12:]
    assert calls[-1] == (len(video) - 12, len(video) - 1)
    before = len(calls)
    for span in ('bytes=-0', 'bytes=40-20', f'bytes={len(video)}-', 'bytes=1-2,4-5', 'bytes=' + '9' * 5000 + '-'):
        invalid = api.get(path, headers={**auth(), 'Range': span})
        assert invalid.status_code == 416 and not invalid.content
        assert invalid.headers['content-range'] == f'bytes */{len(video)}'
    assert len(calls) == before
    monkeypatch.setattr(media, 'stream', lambda *_args, **_kwargs: iter([video]))
    changed = api.get(path, headers={**auth(), 'Range': 'bytes=24-39', 'If-Range': '"old-version"'})
    assert changed.status_code == 200 and changed.content == video


def test_local_full_media_streams_bounded_chunks_and_closes_on_cancel(api, monkeypatch):
    data = b'p' * (media.STREAM_CHUNK_BYTES * 3 + 7)
    key = 'repaidians/alice/streamed.mp4'
    media.write(api.core, key, data, 'video/mp4')
    chunks = list(media.stream(api.core, key, len(data)))
    assert b''.join(chunks) == data
    assert all(0 < len(chunk) <= media.STREAM_CHUNK_BYTES for chunk in chunks)
    opened = []
    original = media.Path.open
    def tracked(path, *args, **kwargs):
        reader = original(path, *args, **kwargs)
        opened.append(reader)
        return reader
    monkeypatch.setattr(media.Path, 'open', tracked)
    streaming = media.stream(api.core, key, len(data))
    assert next(streaming) == data[:media.STREAM_CHUNK_BYTES]
    assert not opened[-1].closed
    streaming.close()
    assert opened[-1].closed


def test_cloud_ranges_are_exact_and_full_streams_use_pinned_bounded_reader(api, monkeypatch):
    from google.cloud import storage
    data = b'c' * (media.CLOUD_READ_CHUNK_BYTES + 17)
    calls = []
    readers = []
    class Blob:
        generation = 123
        def download_as_bytes(self, **kwargs):
            assert 'start' in kwargs and 'end' in kwargs
            calls.append(('range', kwargs))
            return data[kwargs['start']:kwargs['end'] + 1]
        def open(self, mode, **kwargs):
            calls.append(('open', mode, kwargs))
            reader = io.BytesIO(data)
            readers.append(reader)
            return reader
    class Bucket:
        def blob(self, key, **kwargs):
            calls.append(('blob', key, kwargs))
            return Blob()
    class Client:
        def __init__(self):
            calls.append(('client',))
        def bucket(self, name):
            assert name == 'private-community'
            return Bucket()
    monkeypatch.setattr(storage, 'Client', Client)
    monkeypatch.setenv('REPAIDO_COMMUNITY_BUCKET', 'private-community')
    key = 'repaidians/alice/pinned.mp4'
    assert media.read_range(api.core, key, 100, 115, generation='123') == data[100:116]
    assert ('blob', key, {'generation': '123'}) in calls
    assert ('range', {'start': 100, 'end': 115, 'raw_download': True}) in calls
    chunks = list(media.stream(api.core, key, len(data), generation='123'))
    assert b''.join(chunks) == data and max(map(len, chunks)) == media.STREAM_CHUNK_BYTES
    assert ('open', 'rb', {'chunk_size': media.CLOUD_READ_CHUNK_BYTES, 'raw_download': True}) in calls
    assert readers[-1].closed
    assert calls.count(('client',)) == 1


@pytest.mark.parametrize('disconnect_before_body', [True, False])
def test_http_media_disconnect_closes_reader_before_or_after_first_body(api, monkeypatch, disconnect_before_body):
    data = b'p' * (media.STREAM_CHUNK_BYTES * 2 + 7)
    key = 'repaidians/alice/disconnect.mp4'
    media.write(api.core, key, data, 'video/mp4')
    opened = []
    original = media.Path.open
    def tracked(path, *args, **kwargs):
        reader = original(path, *args, **kwargs)
        opened.append(reader)
        return reader
    monkeypatch.setattr(media.Path, 'open', tracked)
    stream = media.stream(api.core, key, len(data))
    response = media.MediaStreamingResponse(stream, media_type='video/mp4')
    async def disconnected():
        async def receive():
            return {'type': 'http.disconnect'}
        async def send(message):
            if disconnect_before_body or message['type'] == 'http.response.body':
                raise OSError('Disconnected browser')
        await response({'type': 'http', 'asgi': {'spec_version': '2.4'}}, receive, send)
    with pytest.raises(ClientDisconnect):
        anyio.run(disconnected)
    assert opened[-1].closed
