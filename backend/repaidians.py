"""Durable, authenticated community commands and bounded social timelines.

Firestore queries use one ordered field in separate audience/actor lanes, so a
new deployment does not depend on console-created composite indexes. SQLite
uses the same records and an expression index. There is deliberately no seed
content, name-based verification, client clock quota, or public media bucket.
"""
import base64
import hashlib
import json
import re
import secrets
import time
import uuid
from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, Request, Response
from pydantic import Field

from operations import Input, fail

TRADES = ('cleaning', 'electrician', 'plumber', 'ac', 'pest', 'carpenter', 'civil', 'spares')
Trade = Literal['cleaning', 'electrician', 'plumber', 'ac', 'pest', 'carpenter', 'civil', 'spares']
Kind = Literal['post', 'reel', 'story', 'tender']
QUOTA = 15 * 60 * 1000
LEASE = 15000
IST = ZoneInfo('Asia/Kolkata')
# Firebase Hosting forwards only __session through Cloud Run rewrites. This
# random, HttpOnly guest-meter token is deliberately not an authentication
# session: every signed command still requires the verified bearer dependency.
COOKIE = '__session'


class Heartbeat(Input):
    active: bool


class Toggle(Input):
    active: bool


class Text(Input):
    text: str = Field(min_length=1, max_length=2200)
    clientId: uuid.UUID | None = None


class ProfilePatch(Input):
    name: str | None = Field(default=None, min_length=2, max_length=100)
    bio: str | None = Field(default=None, max_length=500)
    trade: Trade | None = None
    avatarUrl: str | None = Field(default=None, max_length=200)


class Media(Input):
    url: str = Field(max_length=200)
    kind: Literal['image', 'video']
    alt: str = Field(default='', max_length=300)


class Publication(Input):
    kind: Kind
    caption: str = Field(default='', max_length=2200)
    trade: Trade
    visibility: Literal['public', 'trade']
    media: list[Media] = Field(default_factory=list, max_length=10)
    title: str | None = Field(default=None, max_length=150)
    location: str | None = Field(default=None, max_length=200)
    budgetRupees: int | None = Field(default=None, ge=1, le=100000000)
    slots: int | None = Field(default=None, ge=1, le=1000)
    deadline: int | None = None
    contact: str | None = Field(default=None, max_length=150)
    clientId: uuid.UUID | None = None


class Bid(Input):
    note: str = Field(default='', max_length=1000)
    clientId: uuid.UUID | None = None


class ReadNotifications(Input):
    ids: list[str] = Field(max_length=50)


class Report(Input):
    targetId: str = Field(min_length=1, max_length=100)
    reason: Literal['spam', 'harassment', 'unsafe', 'fraud', 'other']
    details: str = Field(default='', max_length=1000)


class ResolveReport(Input):
    decision: Literal['remove', 'retain']
    reason: str = Field(min_length=10, max_length=1000)


def now_ms():
    return int(time.time() * 1000)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()[:32]


def lane(base, actor):
    return base + '_' + digest(actor)


def sort_key(stamp, key):
    return f'{int(stamp):013d}:{digest(key)}'


def cursor_decode(value):
    if not value:
        return None
    try:
        key = base64.urlsafe_b64decode(value + '=' * (-len(value) % 4)).decode()
        if len(key) > 160 or not re.fullmatch(r'[0-9]{13}:[A-Za-z0-9_-]{1,100}', key):
            raise ValueError()
        return key
    except Exception:
        fail('INVALID_CURSOR', 'This page cursor is invalid.', 422)


def cursor_encode(key):
    return base64.urlsafe_b64encode(key.encode()).decode().rstrip('=') if key else None


def query(u, kind, limit=30, before=None, descending=True):
    """Bounded indexed lookup; never call Unit.all on a social collection."""
    limit = max(1, min(limit, 200))
    if u.tx is not None:
        from google.cloud.firestore_v1 import Query
        q = u.core.fs_collection('ops_' + kind)
        if before:
            q = q.where('sortKey', '<' if descending else '>', before)
        q = q.order_by('sortKey', direction=Query.DESCENDING if descending else Query.ASCENDING).limit(limit)
        rows = {s.id: s.to_dict() for s in q.stream(transaction=u.tx)}
    else:
        direction = 'DESC' if descending else 'ASC'
        op = '<' if descending else '>'
        sql = 'SELECT id,body FROM operation_records WHERE kind=?'
        args = [kind]
        if before:
            sql += f" AND json_extract(body,'$.sortKey'){op}?"
            args.append(before)
        sql += f" ORDER BY json_extract(body,'$.sortKey') {direction} LIMIT ?"
        args.append(limit)
        rows = {r['id']: json.loads(r['body']) for r in u.conn.execute(sql, args)}
    u.fetched.update({(kind, key): value for key, value in rows.items()})
    for (k, key), value in u.pending.items():
        if k == kind and value.get('sortKey') and (not before or (value['sortKey'] < before if descending else value['sortKey'] > before)):
            rows[key] = value
    return sorted(rows.values(), key=lambda x: x['sortKey'], reverse=descending)[:limit]


def initialize(core):
    if core.USE_FIRESTORE:
        return
    with core.db() as c:
        c.execute("CREATE INDEX IF NOT EXISTS operation_social_sort ON operation_records(kind,json_extract(body,'$.sortKey'))")


def member_public(u, row):
    if not row:
        return None
    out = {k: row.get(k) for k in ('id', 'name', 'handle', 'trade', 'role', 'avatarUrl', 'bio', 'followersCount', 'followingCount')}
    w = u.get('workers', row['id'])
    approved = bool(w and w.get('status') == 'approved')
    out.update(reviewed=approved, registeredId=row['id'] if w else None,
               completedTasks=int(w.get('completed_tasks', 0)) if approved else 0,
               rating=(w.get('rating_sum', 0) / w['rating_count']) if approved and w.get('rating_count') else None)
    if approved:
        out['role'] = 'Specialist' if w.get('role') == 'specialist' else 'Technician'
    return out


def member_ensure(u, user):
    member = u.get('rp_members', user['id'])
    if member:
        return member
    w = u.get('workers', user['id'])
    trade = next((t for t in (w or {}).get('categories', []) if t in TRADES), 'cleaning')
    name = str((w or {}).get('name') or user.get('name') or 'Repaido member')[:100]
    slug = re.sub('[^a-z0-9]+', '.', name.lower()).strip('.')[:22] or 'member'
    member = dict(id=user['id'], name=name, handle=f'{slug}.{digest(user["id"])[:8]}', trade=trade,
                  role='Member', avatarUrl='', bio='', followersCount=0, followingCount=0, createdAt=now_ms())
    index_member(u, member)
    return member


def index_member(u, member):
    u.put('rp_members', member['id'], member)
    directory = {'id': member['id'], 'sortKey': sort_key(member['createdAt'], member['id'])}
    u.put('rp_member_directory', member['id'], directory)
    old = u.get('rp_member_search_keys', member['id']) or {'keys': []}
    tokens = re.findall(r'[\w]+', (member['name'] + ' ' + member['handle']).casefold())
    tokens.append(member['name'].casefold())
    keys = set()
    for token in tokens[:8]:
        keys.update(digest(token[:i]) for i in range(2, min(len(token), 20) + 1))
    for key in set(old['keys']) - keys:
        u.put('rp_search_' + key, member['id'], {**directory, 'active': False})
    for key in keys:
        u.put('rp_search_' + key, member['id'], {**directory, 'active': True})
    u.put('rp_member_search_keys', member['id'], {'keys': sorted(keys)})


def subscription_state(u, uid):
    if not uid:
        from rentals import payments_ready
        return {'active': False, 'subscription': None, 'paymentsReady': payments_ready()}
    from repaidians_billing import subscription
    return subscription(u, uid)


def usage(u, subject, beat=None):
    stamp = now_ms()
    day = datetime.fromtimestamp(stamp / 1000, IST).date().isoformat()
    record = u.get('rp_usage', subject) or {}
    if record.get('day') != day:
        record = dict(day=day, usedMs=0, leaseUntil=0)
    if beat and record.get('leaseUntil', 0) <= stamp and record.get('usedMs', 0) < QUOTA:
        # A server-issued foreground lease is charged up front. Content reads
        # renew too, so omitting/falsifying heartbeat cannot create free access.
        # Pausing stops renewal; the unused part of a 15-second slice is never
        # refunded. Tabs share the same transactional lease and midnight reset.
        charge = min(LEASE, QUOTA - record.get('usedMs', 0))
        record['usedMs'] = record.get('usedMs', 0) + charge
        record['leaseUntil'] = stamp + charge
        u.put('rp_usage', subject, record)
    return max(0, QUOTA - record.get('usedMs', 0) + max(0, record.get('leaseUntil', 0) - stamp))


def browse(u, actor):
    if actor.get('user') and subscription_state(u, actor['user']['id'])['active']:
        return QUOTA
    remaining = usage(u, actor['subject'], True)
    if remaining <= 0:
        fail('DAILY_LIMIT', 'Your 15-minute community browsing allowance is used. Upgrade or return after midnight IST.', 402)
    return remaining


def pro(u, actor):
    if not actor.get('user'):
        fail('SIGN_IN_REQUIRED', 'Sign in to continue.', 401)
    if not subscription_state(u, actor['user']['id'])['active']:
        fail('PRO_REQUIRED', 'An active Repaidians Pro subscription is required.', 402)


def signed(actor):
    if not actor.get('user'):
        fail('SIGN_IN_REQUIRED', 'Sign in to continue.', 401)
    return actor['user']


def blocked(u, actor_id, other_id):
    if not actor_id or actor_id == other_id:
        return False
    return any((u.get('rp_blocks', digest(a + ':' + b)) or {}).get('active') for a, b in ((actor_id, other_id), (other_id, actor_id)))


def visible(u, item, actor):
    uid = (actor.get('user') or {}).get('id')
    if not item or item.get('deleted') or (item.get('kind') == 'story' and item.get('expiresAt', 0) <= now_ms()):
        return False
    if blocked(u, uid, item['authorId']):
        return False
    if item['authorId'] == uid or item['visibility'] == 'public':
        return True
    member = u.get('rp_members', uid) if uid else None
    return bool(member and member['trade'] == item['trade'])


def target(u, target_id, actor):
    browse(u, actor)
    item = u.get('rp_publications', target_id)
    if not visible(u, item, actor):
        fail('NOT_FOUND', 'This publication is unavailable.', 404)
    return item


def clean_item(item, u=None, actor=None):
    private = {'sortKey', 'deleted', 'mediaIds', 'contact', 'ownerId'}
    out = {k: v for k, v in item.items() if k not in private}
    if item['kind'] == 'tender':
        out['contact'] = ''
    if u is not None and actor:
        uid = (actor.get('user') or {}).get('id')
        for action, flag in (('likes', 'liked'), ('saved', 'saved')):
            out[flag] = bool(uid and (u.get('rp_activity', digest(uid + ':' + action + ':' + item['id'])) or {}).get('active'))
    return out


def actor_rows(u, base, uid, maximum=50, before=None):
    return [r for r in query(u, lane(base, uid), maximum, before) if r.get('active', True)]


def members_for(u, ids, actor):
    ids = list(dict.fromkeys(ids))[:100]
    prefetch_blocks(u, actor, ids)
    u.prefetch([('rp_members', key) for key in ids] + [('workers', key) for key in ids])
    return [member_public(u, row) for key in ids if (row := u.get('rp_members', key)) and not blocked(u, (actor.get('user') or {}).get('id'), key)]


def prefetch_blocks(u, actor, ids):
    uid = (actor.get('user') or {}).get('id')
    if uid:
        other = set(ids) - {uid}
        u.prefetch([('rp_blocks', digest(left + ':' + right)) for key in other for left, right in ((uid, key), (key, uid))])


def feed_page(u, actor, kind='post', trade='all', mode='all', cursor=None, limit=20, author=None):
    browse(u, actor)
    before = cursor_decode(cursor)
    uid = (actor.get('user') or {}).get('id')
    member = u.get('rp_members', uid) if uid else None
    sources = []
    if author:
        sources = [lane('rp_author_' + kind, author)]
    elif mode == 'saved':
        if not uid:
            return {'items': [], 'members': [], 'nextCursor': None}
        sources = [lane('rp_saved', uid)]
    else:
        sources = ['rp_timeline_' + kind + '_public_' + trade]
        if member and trade in ('all', member['trade']):
            sources.append('rp_timeline_' + kind + '_trade_' + member['trade'])
    scans = [entry for source in sources for entry in query(u, source, min(200, limit * 3 + 1), before)]
    scans = sorted({r['id']: r for r in scans}.values(), key=lambda x: x['sortKey'], reverse=True)
    u.prefetch([('rp_publications', row.get('publicationId', row['id'])) for row in scans])
    author_ids = [item['authorId'] for row in scans if (item := u.get('rp_publications', row.get('publicationId', row['id'])))]
    prefetch_blocks(u, actor, author_ids)
    if mode == 'following' and uid:
        u.prefetch([('rp_follows', digest(uid + ':' + author_id)) for author_id in set(author_ids)])
    items = []
    examined = None
    for row in scans:
        examined = row['sortKey']
        item = u.get('rp_publications', row.get('publicationId', row['id']))
        if not row.get('active', True) or not item or item['kind'] != kind or not visible(u, item, actor):
            continue
        if trade != 'all' and item['trade'] != trade:
            continue
        if mode == 'following' and not (uid and (u.get('rp_follows', digest(uid + ':' + item['authorId'])) or {}).get('active')):
            continue
        items.append(item)
        if len(items) >= limit:
            break
    # A cursor also advances over deleted/blocked/expired entries. Each request
    # has a hard read bound, so an empty filtered page never scans a million rows.
    more = bool(examined and (len(items) == limit or len(scans) >= limit * 3 + 1))
    if uid:
        u.prefetch([('rp_activity', digest(uid + ':' + action + ':' + item['id'])) for item in items for action in ('likes', 'saved')])
    return {'items': [clean_item(item, u, actor) for item in items], 'members': members_for(u, [item['authorId'] for item in items], actor),
            'nextCursor': cursor_encode(examined) if more else None}


def rate(u, uid, kind, limit=60, period=3600000):
    stamp = now_ms()
    key = digest(uid + ':' + kind)
    row = u.get('rp_rate', key) or {'window': stamp, 'count': 0}
    if stamp - row['window'] >= period:
        row = {'window': stamp, 'count': 0}
    if row['count'] >= limit:
        fail('RATE_LIMIT', 'Please wait before trying again.', 429)
    row['count'] += 1
    u.put('rp_rate', key, row)


def notify(u, recipient, sender, event, target_id):
    if recipient == sender or blocked(u, recipient, sender):
        return
    stamp = now_ms()
    key = str(uuid.uuid4())
    row = dict(id=key, authorId=sender, type=event, targetId=target_id, createdAt=stamp, read=False, sortKey=sort_key(stamp, key))
    u.put(lane('rp_notifications', recipient), key, row)


def media_id(url):
    found = re.fullmatch(r'/api/repaidians/media/([0-9a-f-]{36})', url)
    if not found:
        fail('MEDIA_REQUIRED', 'Upload media using the community uploader.', 422)
    return found.group(1)


def replay(u, uid, body, command, target_id=''):
    if not body.clientId:
        return None
    key = digest(uid + ':' + str(body.clientId))
    payload = body.model_dump(mode='json', exclude={'clientId'})
    signature = hashlib.sha256(json.dumps([command, target_id, payload], sort_keys=True).encode()).hexdigest()
    old = u.get('rp_commands', key)
    if old:
        if old['signature'] != signature:
            fail('COMMAND_REUSED', 'This retry reference was already used for another request.', 409)
        return old['result']
    return None


def remember(u, uid, body, command, result, target_id=''):
    if body.clientId:
        payload = body.model_dump(mode='json', exclude={'clientId'})
        signature = hashlib.sha256(json.dumps([command, target_id, payload], sort_keys=True).encode()).hexdigest()
        u.put('rp_commands', digest(uid + ':' + str(body.clientId)), {'signature': signature, 'result': result, 'createdAt': now_ms()})
    return result


def publication_count(member, kind, visibility, trade, delta):
    counts = member.setdefault('publicationCounts', {})
    key = kind + ':' + visibility + ':' + trade
    counts[key] = max(0, counts.get(key, 0) + delta)
    member[kind + 'Count'] = max(0, member.get(kind + 'Count', 0) + delta)


def visible_count(u, member, kind, a):
    uid = (a['user'] or {}).get('id')
    if uid == member['id']:
        return member.get(kind + 'Count', 0)
    viewer = u.get('rp_members', uid) if uid else None
    counts = member.get('publicationCounts', {})
    return sum(value for key, value in counts.items() if key.startswith(kind + ':public:') or
               (viewer and key == kind + ':trade:' + viewer['trade']))


def soft_delete(u, item):
    """One shared counter transition for owner removal and operator moderation."""
    if item.get('deleted'):
        return False
    item['deleted'] = True
    item['deletedAt'] = now_ms()
    u.put('rp_publications', item['id'], item)
    member = u.get('rp_members', item['authorId'])
    if member:
        publication_count(member, item['kind'], item['visibility'], item['trade'], -1)
        u.put('rp_members', member['id'], member)
    return True


def install(core):
    import repaidians_media as storage
    store = core.operations_store
    r = APIRouter(prefix='/repaidians', tags=['Repaidians community'])

    def actor(request: Request, response: Response, authorization: str = Header(default='')):
        if authorization:
            # Honour FastAPI test/application overrides without accepting a
            # bearer string as an identity or swallowing invalid credentials.
            checker = core.app.dependency_overrides.get(core.current_user, core.current_user)
            user = checker(authorization=authorization)
            return {'user': user, 'subject': 'user_' + digest(user['id'])}
        cookie = request.cookies.get(COOKIE, '')
        if not re.fullmatch('[A-Za-z0-9_-]{43}', cookie):
            cookie = secrets.token_urlsafe(32)
            response.set_cookie(COOKIE, cookie, max_age=365 * 86400, httponly=True,
                                secure=core.USE_FIRESTORE or request.url.scheme == 'https', samesite='lax', path='/')
        return {'user': None, 'subject': 'guest_' + digest(cookie)}

    @r.get('/state')
    def state(a=Depends(actor)):
        def read(u):
            user = a['user']
            current = member_ensure(u, user) if user else {'id': 'guest', 'name': 'Guest', 'handle': 'guest', 'trade': 'cleaning', 'role': 'Guest', 'avatarUrl': '', 'bio': ''}
            bill = subscription_state(u, (user or {}).get('id'))
            remaining = QUOTA if bill['active'] else usage(u, a['subject'], True)
            pages = {k: feed_page(u, a, k, limit=15) for k in ('post', 'story', 'reel', 'tender')} if remaining else {}
            activity = {key: [row['id'] for row in actor_rows(u, 'rp_' + key, user['id'], 200)] if user and remaining else [] for key in ('likes', 'saved', 'following', 'bids')}
            activity['messages'] = []
            all_members = {m['id']: m for p in pages.values() for m in p['members']}
            public_current = member_public(u, current) if user else current
            if user:
                all_members[user['id']] = public_current
            notes = query(u, lane('rp_notifications', user['id']), 200) if user and remaining else []
            prefetch_blocks(u, a, [row['authorId'] for row in notes])
            return {'data': {'version': 1, 'members': list(all_members.values()),
                             'posts': pages.get('post', {}).get('items', []), 'stories': pages.get('story', {}).get('items', []),
                             'reels': pages.get('reel', {}).get('items', []), 'tenders': pages.get('tender', {}).get('items', []),
                             'comments': [], 'follows': [{'from': user['id'], 'to': key} for key in activity['following']] if user else []},
                    'member': public_current, 'activity': activity, 'subscription': bill['subscription'], 'remainingMs': remaining,
                    'authenticated': bool(user), 'paymentsReady': bill['paymentsReady'], 'mediaReady': storage.ready(core),
                    'storage': 'firestore' if core.USE_FIRESTORE else 'sqlite',
                    'cursors': {k: p['nextCursor'] for k, p in pages.items()},
                    'unreadCount': sum(not row.get('read') for row in notes if not blocked(u, user['id'], row['authorId'])) if user else 0}
        return store.run(read)

    @r.post('/usage')
    def heartbeat(body: Heartbeat, a=Depends(actor)):
        def save(u):
            bill = subscription_state(u, (a['user'] or {}).get('id'))
            remaining = QUOTA if bill['active'] else usage(u, a['subject'], body.active)
            return {'remainingMs': QUOTA if bill['active'] else remaining, 'subscription': bill['subscription']}
        return store.run(save)

    @r.get('/feed')
    def feed(kind: Kind = 'post', trade: str = 'all', mode: Literal['all', 'following', 'saved'] = 'all', cursor: str | None = None,
             limit: int = 20, a=Depends(actor)):
        if trade != 'all' and trade not in TRADES or not 1 <= limit <= 50:
            fail('INVALID_FILTER', 'Choose a supported trade and a page size between 1 and 50.', 422)
        return store.run(lambda u: feed_page(u, a, kind, trade, mode, cursor, limit))

    @r.get('/members')
    def members(search: str = '', cursor: str | None = None, limit: int = 20, a=Depends(actor)):
        if not 1 <= limit <= 50 or len(search) > 100:
            fail('INVALID_SEARCH', 'Keep searches and page sizes within the supported limit.', 422)
        prefix = search.strip().casefold()[:20]
        if prefix and len(prefix) < 2:
            return {'members': [], 'nextCursor': None}
        def read(u):
            browse(u, a)
            rows = query(u, 'rp_search_' + digest(prefix) if prefix else 'rp_member_directory', limit + 1, cursor_decode(cursor))
            results = members_for(u, [row['id'] for row in rows[:limit] if row.get('active', True)], a)
            return {'members': results, 'nextCursor': cursor_encode(rows[limit - 1]['sortKey']) if len(rows) > limit else None}
        return store.run(read)

    @r.get('/members/{member_id}')
    def profile(member_id: str, a=Depends(actor)):
        def read(u):
            browse(u, a)
            row = u.get('rp_members', member_id)
            if not row or blocked(u, (a['user'] or {}).get('id'), member_id):
                fail('NOT_FOUND', 'Member unavailable.', 404)
            pages = {k: feed_page(u, a, k, author=member_id, limit=20) for k in ('post', 'reel', 'story')}
            return {'member': member_public(u, row), 'posts': pages['post']['items'], 'reels': pages['reel']['items'],
                    'stories': pages['story']['items'], 'cursors': {k: p['nextCursor'] for k, p in pages.items()},
                    'stats': {'followers': row.get('followersCount', 0), 'following': row.get('followingCount', 0),
                              'posts': visible_count(u, row, 'post', a), 'reels': visible_count(u, row, 'reel', a)}}
        return store.run(read)

    @r.patch('/profile')
    def update_profile(body: ProfilePatch, a=Depends(actor)):
        user = signed(a)
        def save(u):
            browse(u, a)
            member = member_ensure(u, user)
            values = body.model_dump(exclude_none=True)
            for field in ('name', 'bio'):
                if field in values:
                    values[field] = values[field].strip()
            if 'name' in values and len(values['name']) < 2:
                fail('INVALID_NAME', 'Enter your display name.', 422)
            if values.get('avatarUrl'):
                mid = media_id(values['avatarUrl'])
                media = u.get('rp_media', mid)
                if not media or media['ownerId'] != user['id'] or media['kind'] != 'image' or media['status'] != 'ready':
                    fail('MEDIA_UNAVAILABLE', 'Choose your uploaded profile image.', 422)
                media['avatarFor'] = user['id']
                u.put('rp_media', mid, media)
            if 'avatarUrl' in values and member.get('avatarUrl') and member['avatarUrl'] != values['avatarUrl']:
                old_id = media_id(member['avatarUrl'])
                old = u.get('rp_media', old_id)
                if old:
                    old.pop('avatarFor', None)
                    u.put('rp_media', old_id, old)
            member.update(values)
            index_member(u, member)
            return {'member': member_public(u, member)}
        return store.run(save)

    @r.post('/publications', status_code=201)
    def publish(body: Publication, a=Depends(actor)):
        user = signed(a)
        def save(u):
            pro(u, a)
            prior = replay(u, user['id'], body, 'publish')
            if prior:
                return prior
            member = member_ensure(u, user)
            rate(u, user['id'], 'publish', 30)
            stamp = now_ms()
            if body.visibility == 'trade' and body.trade != member['trade']:
                fail('TRADE_REQUIRED', 'Private trade posts must match your profile trade.', 422)
            if body.kind == 'tender':
                if not all((body.title and body.title.strip(), body.caption.strip(), body.location and body.location.strip(), body.budgetRupees, body.slots, body.deadline, body.contact and body.contact.strip())):
                    fail('TENDER_DETAILS_REQUIRED', 'Provide title, details, location, budget, slots, deadline and contact.', 422)
                if not stamp < body.deadline <= stamp + 365 * 86400000:
                    fail('INVALID_DEADLINE', 'Choose a future deadline within a year.', 422)
                if body.media:
                    fail('INVALID_MEDIA', 'Tender cards use structured project details.', 422)
            elif body.kind == 'post':
                if not body.media or any(m.kind != 'image' for m in body.media):
                    fail('PHOTO_REQUIRED', 'Choose one to ten photos for a post.', 422)
            elif len(body.media) != 1 or (body.kind == 'reel' and body.media[0].kind != 'video'):
                fail('MEDIA_REQUIRED', 'Choose one video for a reel or one photo/video for a story.', 422)
            key = str(uuid.uuid4())
            media_ids = []
            medias = []
            for m in body.media:
                mid = media_id(m.url)
                asset = u.get('rp_media', mid)
                if not asset or asset['status'] != 'ready' or asset['ownerId'] != user['id'] or asset['kind'] != m.kind:
                    fail('MEDIA_UNAVAILABLE', 'Use media uploaded by your account.', 422)
                if len(asset.get('publicationIds', [])) >= 20:
                    fail('MEDIA_REUSE_LIMIT', 'Upload a fresh copy of this media.', 422)
                asset['publicationIds'] = [*asset.get('publicationIds', []), key]
                u.put('rp_media', mid, asset)
                media_ids.append(mid)
                medias.append(m.model_dump())
            item = dict(id=key, authorId=user['id'], kind=body.kind, createdAt=stamp, trade=body.trade,
                        visibility=body.visibility, sample=False, caption=body.caption.strip(),
                        sortKey=sort_key(stamp, key), deleted=False, mediaIds=media_ids, likeCount=0, commentCount=0)
            if body.kind == 'post':
                item['media'] = medias
            elif body.kind in ('story', 'reel'):
                item['media'] = medias[0]
                if body.kind == 'story':
                    item['expiresAt'] = stamp + 86400000
            else:
                item.update(title=body.title.strip(), details=body.caption.strip(), location=body.location.strip(),
                            budgetRupees=body.budgetRupees, slots=body.slots, deadline=body.deadline, bidCount=0)
                u.put('rp_tender_contact', key, {'contact': body.contact.strip(), 'ownerId': user['id']})
            u.put('rp_publications', key, item)
            entry = {'id': key, 'publicationId': key, 'sortKey': item['sortKey'], 'active': True}
            u.put(lane('rp_author_' + body.kind, user['id']), key, entry)
            lanes = ['rp_timeline_' + body.kind + '_' + body.visibility + '_' + body.trade]
            if body.visibility == 'public':
                lanes.append('rp_timeline_' + body.kind + '_public_all')
            for collection in lanes:
                u.put(collection, key, entry)
            publication_count(member, body.kind, body.visibility, body.trade, 1)
            u.put('rp_members', user['id'], member)
            return remember(u, user['id'], body, 'publish', {'item': clean_item(item, u, a)})
        return store.run(save)

    @r.get('/publications/{publication_id}')
    def publication(publication_id: str, a=Depends(actor)):
        def read(u):
            item = target(u, publication_id, a)
            return {'item': clean_item(item, u, a), 'members': members_for(u, [item['authorId']], a)}
        return store.run(read)

    @r.delete('/publications/{publication_id}')
    def remove(publication_id: str, a=Depends(actor)):
        user = signed(a)
        def save(u):
            item = u.get('rp_publications', publication_id)
            if not item or item['authorId'] != user['id']:
                fail('NOT_FOUND', 'Publication unavailable.', 404)
            soft_delete(u, item)
            return {'ok': True}
        return store.run(save)

    @r.put('/activity/{action}/{publication_id}')
    def activity(action: Literal['likes', 'saved'], publication_id: str, body: Toggle, a=Depends(actor)):
        user = signed(a)
        def save(u):
            item = target(u, publication_id, a)
            member_ensure(u, user)
            key = digest(user['id'] + ':' + action + ':' + publication_id)
            old = u.get('rp_activity', key) or {'active': False}
            changed = old['active'] != body.active
            stamp = now_ms()
            row = dict(id=publication_id, active=body.active, sortKey=sort_key(stamp, publication_id), createdAt=stamp)
            u.put('rp_activity', key, row)
            u.put(lane('rp_' + action, user['id']), publication_id, row)
            if action == 'likes' and changed:
                item['likeCount'] = max(0, item.get('likeCount', 0) + (1 if body.active else -1))
                u.put('rp_publications', publication_id, item)
                if body.active:
                    notify(u, item['authorId'], user['id'], 'like', publication_id)
            return {'ok': True, 'active': body.active, 'likeCount': item.get('likeCount', 0)}
        return store.run(save)

    @r.put('/follow/{member_id}')
    def follow(member_id: str, body: Toggle, a=Depends(actor)):
        user = signed(a)
        def save(u):
            browse(u, a)
            mine = member_ensure(u, user)
            other = u.get('rp_members', member_id)
            if not other or member_id == user['id'] or blocked(u, user['id'], member_id):
                fail('NOT_FOUND', 'This member is unavailable.', 404)
            key = digest(user['id'] + ':' + member_id)
            old = u.get('rp_follows', key) or {'active': False}
            stamp = now_ms()
            row = dict(id=member_id, **{'from': user['id'], 'to': member_id}, active=body.active, createdAt=stamp, sortKey=sort_key(stamp, member_id))
            if old['active'] != body.active:
                delta = 1 if body.active else -1
                mine['followingCount'] = max(0, mine.get('followingCount', 0) + delta)
                other['followersCount'] = max(0, other.get('followersCount', 0) + delta)
                u.put('rp_members', user['id'], mine)
                u.put('rp_members', member_id, other)
                if body.active:
                    notify(u, member_id, user['id'], 'follow', user['id'])
            u.put('rp_follows', key, row)
            u.put(lane('rp_following', user['id']), member_id, row)
            return {'ok': True, 'active': body.active, 'followersCount': other.get('followersCount', 0)}
        return store.run(save)

    @r.get('/comments/{publication_id}')
    def comments(publication_id: str, cursor: str | None = None, limit: int = 30, a=Depends(actor)):
        if not 1 <= limit <= 50:
            fail('INVALID_LIMIT', 'Choose a page size between 1 and 50.', 422)
        def read(u):
            target(u, publication_id, a)
            rows = query(u, lane('rp_comments', publication_id), limit + 1, cursor_decode(cursor))
            prefetch_blocks(u, a, [row['authorId'] for row in rows])
            chosen = [row for row in rows[:limit] if not blocked(u, (a['user'] or {}).get('id'), row['authorId'])]
            return {'comments': [{k: v for k, v in row.items() if k != 'sortKey'} for row in chosen],
                    'members': members_for(u, [row['authorId'] for row in chosen], a),
                    'nextCursor': cursor_encode(rows[limit - 1]['sortKey']) if len(rows) > limit else None}
        return store.run(read)

    @r.post('/comments/{publication_id}', status_code=201)
    def comment(publication_id: str, body: Text, a=Depends(actor)):
        user = signed(a)
        def save(u):
            item = target(u, publication_id, a)
            prior = replay(u, user['id'], body, 'comment', publication_id)
            if prior:
                return prior
            member_ensure(u, user)
            text = body.text.strip()
            if not text:
                fail('TEXT_REQUIRED', 'Write a comment first.', 422)
            rate(u, user['id'], 'comment', 100)
            stamp = now_ms()
            key = str(uuid.uuid4())
            row = dict(id=key, targetId=publication_id, authorId=user['id'], text=text, createdAt=stamp, sortKey=sort_key(stamp, key))
            u.put(lane('rp_comments', publication_id), key, row)
            item['commentCount'] = item.get('commentCount', 0) + 1
            u.put('rp_publications', publication_id, item)
            notify(u, item['authorId'], user['id'], 'comment', publication_id)
            return remember(u, user['id'], body, 'comment', {'comment': {k: v for k, v in row.items() if k != 'sortKey'}, 'commentCount': item['commentCount']}, publication_id)
        return store.run(save)

    def thread_key(uid, other):
        return digest(':'.join(sorted((uid, other))))

    def thread_access(u, a, other):
        user = signed(a)
        browse(u, a)
        if user['id'] == other or not u.get('rp_members', other) or blocked(u, user['id'], other):
            fail('NOT_FOUND', 'Conversation unavailable.', 404)
        return user

    @r.get('/messages/{recipient_id}')
    def messages(recipient_id: str, cursor: str | None = None, limit: int = 30, a=Depends(actor)):
        if not 1 <= limit <= 50:
            fail('INVALID_LIMIT', 'Choose a page size between 1 and 50.', 422)
        def read(u):
            user = thread_access(u, a, recipient_id)
            rows = query(u, 'rp_thread_' + thread_key(user['id'], recipient_id), limit + 1, cursor_decode(cursor))
            return {'messages': [{k: v for k, v in row.items() if k != 'sortKey'} for row in rows[:limit]],
                    'members': members_for(u, [user['id'], recipient_id], a),
                    'nextCursor': cursor_encode(rows[limit - 1]['sortKey']) if len(rows) > limit else None}
        return store.run(read)

    @r.post('/messages/{recipient_id}', status_code=201)
    def message(recipient_id: str, body: Text, a=Depends(actor)):
        user = signed(a)
        def save(u):
            pro(u, a)
            thread_access(u, a, recipient_id)
            prior = replay(u, user['id'], body, 'message', recipient_id)
            if prior:
                return prior
            member_ensure(u, user)
            if not body.text.strip():
                fail('TEXT_REQUIRED', 'Write a message first.', 422)
            rate(u, user['id'], 'message', 100)
            stamp = now_ms()
            key = str(uuid.uuid4())
            row = dict(id=key, senderId=user['id'], authorId=user['id'], recipientId=recipient_id, text=body.text.strip(), createdAt=stamp, sortKey=sort_key(stamp, key))
            u.put('rp_thread_' + thread_key(user['id'], recipient_id), key, row)
            for uid, other in ((user['id'], recipient_id), (recipient_id, user['id'])):
                u.put(lane('rp_threads', uid), other, dict(id=other, recipientId=other, lastMessage=row['text'], lastSenderId=user['id'], updatedAt=stamp, sortKey=sort_key(stamp, other)))
            notify(u, recipient_id, user['id'], 'message', user['id'])
            return remember(u, user['id'], body, 'message', {'message': {k: v for k, v in row.items() if k != 'sortKey'}}, recipient_id)
        return store.run(save)

    @r.get('/threads')
    def threads(cursor: str | None = None, limit: int = 30, a=Depends(actor)):
        user = signed(a)
        if not 1 <= limit <= 50:
            fail('INVALID_LIMIT', 'Choose a page size between 1 and 50.', 422)
        def read(u):
            browse(u, a)
            rows = query(u, lane('rp_threads', user['id']), limit + 1, cursor_decode(cursor))
            prefetch_blocks(u, a, [row['id'] for row in rows])
            chosen = [row for row in rows[:limit] if not blocked(u, user['id'], row['id'])]
            return {'threads': [{k: v for k, v in row.items() if k != 'sortKey'} for row in chosen],
                    'members': members_for(u, [row['id'] for row in chosen], a),
                    'nextCursor': cursor_encode(rows[limit - 1]['sortKey']) if len(rows) > limit else None}
        return store.run(read)

    @r.post('/bids/{tender_id}', status_code=201)
    def bid(tender_id: str, body: Bid, a=Depends(actor)):
        user = signed(a)
        def save(u):
            pro(u, a)
            item = target(u, tender_id, a)
            prior = replay(u, user['id'], body, 'bid', tender_id)
            if prior:
                return prior
            if item['kind'] != 'tender' or item['authorId'] == user['id'] or item['deadline'] <= now_ms():
                fail('BID_UNAVAILABLE', 'This tender is closed or belongs to you.', 409)
            member_ensure(u, user)
            key = digest(tender_id + ':' + user['id'])
            old = u.get('rp_bids', key)
            if old:
                return remember(u, user['id'], body, 'bid', {'bid': {k: v for k, v in old.items() if k != 'sortKey'}}, tender_id)
            rate(u, user['id'], 'bid', 50)
            stamp = now_ms()
            row = dict(id=key, tenderId=tender_id, authorId=user['id'], note=body.note.strip(), createdAt=stamp, status='submitted', sortKey=sort_key(stamp, key))
            u.put('rp_bids', key, row)
            u.put(lane('rp_tender_bids', tender_id), key, row)
            u.put(lane('rp_bids', user['id']), tender_id, {'id': tender_id, 'active': True, 'sortKey': sort_key(stamp, tender_id)})
            item['bidCount'] = item.get('bidCount', 0) + 1
            u.put('rp_publications', tender_id, item)
            notify(u, item['authorId'], user['id'], 'bid', tender_id)
            return remember(u, user['id'], body, 'bid', {'bid': {k: v for k, v in row.items() if k != 'sortKey'}}, tender_id)
        return store.run(save)

    @r.get('/bids/{tender_id}')
    def tender_bids(tender_id: str, cursor: str | None = None, limit: int = 30, a=Depends(actor)):
        user = signed(a)
        if not 1 <= limit <= 50:
            fail('INVALID_LIMIT', 'Choose a page size between 1 and 50.', 422)
        def read(u):
            item = target(u, tender_id, a)
            if item['kind'] != 'tender' or item['authorId'] != user['id']:
                fail('NOT_FOUND', 'Tender unavailable.', 404)
            rows = query(u, lane('rp_tender_bids', tender_id), limit + 1, cursor_decode(cursor))
            prefetch_blocks(u, a, [row['authorId'] for row in rows])
            chosen = [row for row in rows[:limit] if not blocked(u, user['id'], row['authorId'])]
            return {'bids': [{k: v for k, v in row.items() if k != 'sortKey'} for row in chosen],
                    'members': members_for(u, [row['authorId'] for row in chosen], a),
                    'nextCursor': cursor_encode(rows[limit - 1]['sortKey']) if len(rows) > limit else None}
        return store.run(read)

    @r.get('/tenders/{tender_id}/contact')
    def tender_contact(tender_id: str, a=Depends(actor)):
        def read(u):
            pro(u, a)
            item = target(u, tender_id, a)
            if item['kind'] != 'tender' or item['deadline'] <= now_ms():
                fail('NOT_FOUND', 'Tender unavailable.', 404)
            private = u.get('rp_tender_contact', tender_id) or {}
            return {'tenderId': tender_id, 'contact': private.get('contact', '')}
        return store.run(read)

    @r.get('/notifications')
    def notifications(cursor: str | None = None, limit: int = 30, a=Depends(actor)):
        user = signed(a)
        if not 1 <= limit <= 50:
            fail('INVALID_LIMIT', 'Choose a page size between 1 and 50.', 422)
        def read(u):
            browse(u, a)
            rows = query(u, lane('rp_notifications', user['id']), limit + 1, cursor_decode(cursor))
            prefetch_blocks(u, a, [row['authorId'] for row in rows])
            chosen = [row for row in rows[:limit] if not blocked(u, user['id'], row['authorId'])]
            return {'notifications': [{k: v for k, v in row.items() if k != 'sortKey'} for row in chosen],
                    'members': members_for(u, [row['authorId'] for row in chosen], a),
                    'nextCursor': cursor_encode(rows[limit - 1]['sortKey']) if len(rows) > limit else None}
        return store.run(read)

    @r.post('/notifications/read')
    def read_notifications(body: ReadNotifications, a=Depends(actor)):
        user = signed(a)
        def save(u):
            collection = lane('rp_notifications', user['id'])
            for key in body.ids:
                row = u.get(collection, key)
                if row:
                    row['read'] = True
                    u.put(collection, key, row)
            return {'ok': True}
        return store.run(save)

    @r.post('/reports', status_code=201)
    def report(body: Report, a=Depends(actor)):
        user = signed(a)
        def save(u):
            item = target(u, body.targetId, a)
            rate(u, user['id'], 'report', 30)
            key = digest(user['id'] + ':' + body.targetId)
            stamp = now_ms()
            u.put('rp_reports', key, dict(id=key, authorId=user['id'], targetId=item['id'], reason=body.reason,
                                        details=body.details.strip(), createdAt=stamp, sortKey=sort_key(stamp, key), status='open'))
            return {'ok': True}
        return store.run(save)

    @r.get('/admin/reports')
    def reports(cursor: str | None = None, limit: int = 30, admin=Depends(core.operator)):
        if not 1 <= limit <= 50:
            fail('INVALID_LIMIT', 'Choose a page size between 1 and 50.', 422)
        def read(u):
            from integrations import audit
            rows = query(u, 'rp_reports', limit + 1, cursor_decode(cursor))
            chosen = rows[:limit]
            u.prefetch([('rp_publications', row['targetId']) for row in chosen])
            members = members_for(u, [key for row in chosen for key in (row['authorId'],
                                  (u.get('rp_publications', row['targetId']) or {}).get('authorId')) if key], {'user': None})
            # Review only reported publication content, not private DM history,
            # tender contact records, billing details or unrelated uploads.
            results = []
            for row in chosen:
                item = u.get('rp_publications', row['targetId'])
                results.append({**{k: v for k, v in row.items() if k != 'sortKey'},
                                'publication': clean_item(item) if item else None,
                                'publicationDeleted': bool(item and item.get('deleted'))})
            audit(u, 'RepaidiansReportsViewed', admin['id'], report_ids=[row['id'] for row in chosen])
            return {'reports': results, 'members': members,
                    'nextCursor': cursor_encode(rows[limit - 1]['sortKey']) if len(rows) > limit else None}
        return store.run(read)

    @r.post('/admin/reports/{report_id}/resolve')
    def resolve_report(report_id: str, body: ResolveReport, admin=Depends(core.operator)):
        reason = body.reason.strip()
        if len(reason) < 10:
            fail('REASON_REQUIRED', 'Explain the moderation decision in at least 10 characters.', 422)
        def save(u):
            from integrations import audit
            row = u.get('rp_reports', report_id)
            if not row:
                fail('NOT_FOUND', 'Report unavailable.', 404)
            if row.get('status') == 'reviewed':
                if row.get('decision') != body.decision or row.get('decisionReason') != reason:
                    fail('REPORT_REVIEWED', 'This report already has a moderation decision.', 409)
                return {'report': {k: v for k, v in row.items() if k != 'sortKey'}}
            removed = False
            if body.decision == 'remove':
                item = u.get('rp_publications', row['targetId'])
                if item:
                    removed = soft_delete(u, item)
            row.update(status='reviewed', decision=body.decision, decisionReason=reason,
                       reviewedBy=admin['id'], reviewedAt=now_ms())
            u.put('rp_reports', report_id, row)
            audit(u, 'RepaidiansReportResolved', admin['id'], report_id=report_id, publication_id=row['targetId'],
                  decision=body.decision, reason=reason, publication_removed=removed)
            return {'report': {k: v for k, v in row.items() if k != 'sortKey'}}
        return store.run(save)

    @r.put('/blocks/{member_id}')
    def block(member_id: str, body: Toggle, a=Depends(actor)):
        user = signed(a)
        def save(u):
            member_ensure(u, user)
            other = u.get('rp_members', member_id)
            if not other or member_id == user['id']:
                fail('NOT_FOUND', 'Member unavailable.', 404)
            u.put('rp_blocks', digest(user['id'] + ':' + member_id), {'active': body.active, 'from': user['id'], 'to': member_id, 'createdAt': now_ms()})
            if body.active:
                # Remove both follow edges and their counters atomically. Old
                # notifications/threads remain private but are filtered at read.
                for left, right in ((user['id'], member_id), (member_id, user['id'])):
                    key = digest(left + ':' + right)
                    edge = u.get('rp_follows', key)
                    if edge and edge.get('active'):
                        edge['active'] = False
                        u.put('rp_follows', key, edge)
                        u.put(lane('rp_following', left), right, {**edge, 'id': right})
                        lm = u.get('rp_members', left)
                        rm = u.get('rp_members', right)
                        lm['followingCount'] = max(0, lm.get('followingCount', 0) - 1)
                        rm['followersCount'] = max(0, rm.get('followersCount', 0) - 1)
                        u.put('rp_members', left, lm)
                        u.put('rp_members', right, rm)
            return {'ok': True, 'active': body.active}
        return store.run(save)

    @r.post('/media', status_code=201)
    async def upload_media(request: Request, a=Depends(actor)):
        user = signed(a)
        if not storage.ready(core):
            fail('MEDIA_UNAVAILABLE', 'Durable community media storage is not configured.', 503)
        mime = request.headers.get('content-type', '').split(';')[0]
        def reserve(u):
            browse(u, a)
            paid = subscription_state(u, user['id'])['active']
            if not paid and mime not in ('image/jpeg', 'image/png', 'image/webp'):
                fail('PRO_REQUIRED', 'An active Pro subscription is required for video uploads.', 402)
            rate(u, user['id'], 'upload' if paid else 'avatar_upload', 60 if paid else 5,
                 3600000 if paid else 86400000)
            return paid
        paid = store.run(reserve)
        maximum = 8 * 1024 * 1024 if paid else 2 * 1024 * 1024
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > maximum:
                fail('MEDIA_TOO_LARGE', 'Pro media must be 8 MB or smaller; free profile photos must be 2 MB or smaller.', 413)
        normalized, mime, kind = storage.prepare(bytes(data), mime)
        if len(normalized) > maximum:
            fail('MEDIA_TOO_LARGE', 'Choose a smaller profile photo.', 413)
        key = str(uuid.uuid4())
        object_key = 'repaidians/' + digest(user['id']) + '/' + key
        try:
            storage.write(core, object_key, normalized, mime)
        except Exception as exc:
            from fastapi import HTTPException
            if isinstance(exc, HTTPException):
                raise
            fail('MEDIA_UNAVAILABLE', 'Media could not be stored. Retry later.', 503)
        record = dict(id=key, ownerId=user['id'], object=object_key, mime=mime, kind=kind, size=len(normalized),
                      status='ready', createdAt=now_ms(), publicationIds=[])
        store.run(lambda u: u.put('rp_media', key, record))
        return {'id': key, 'url': '/api/repaidians/media/' + key, 'kind': kind, 'alt': ''}

    @r.get('/media/{asset_id}')
    def get_media(asset_id: str, request: Request, response: Response, a=Depends(actor)):
        def read(u):
            browse(u, a)
            asset = u.get('rp_media', asset_id)
            uid = (a['user'] or {}).get('id')
            if not asset or asset['status'] != 'ready' or blocked(u, uid, asset['ownerId']):
                fail('NOT_FOUND', 'Media unavailable.', 404)
            accessible = asset['ownerId'] == uid
            if asset.get('avatarFor'):
                accessible = True
            if not accessible:
                accessible = any(visible(u, u.get('rp_publications', key), a) for key in asset.get('publicationIds', []))
            if not accessible:
                fail('NOT_FOUND', 'Media unavailable.', 404)
            return asset
        asset = store.run(read)
        try:
            content = storage.read(core, asset['object'])
        except Exception:
            fail('MEDIA_UNAVAILABLE', 'Media is temporarily unavailable.', 503)
        headers = {'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes'}
        if response.headers.get('set-cookie'):
            headers['Set-Cookie'] = response.headers['set-cookie']
        span = request.headers.get('range')
        if span and asset['kind'] == 'video':
            found = re.fullmatch(r'bytes=(\d*)-(\d*)', span)
            if not found or not any(found.groups()):
                return Response(status_code=416, headers={**headers, 'Content-Range': f'bytes */{len(content)}'})
            left, right = found.groups()
            start = int(left) if left else max(0, len(content) - int(right))
            end = min(len(content) - 1, int(right) if left and right else len(content) - 1)
            if start > end or start >= len(content):
                return Response(status_code=416, headers={**headers, 'Content-Range': f'bytes */{len(content)}'})
            headers['Content-Range'] = f'bytes {start}-{end}/{len(content)}'
            return Response(content[start:end + 1], status_code=206, media_type=asset['mime'], headers=headers)
        return Response(content, media_type=asset['mime'], headers=headers)

    # Lifespan creates the base operations table. The SQLite query index must
    # be installed there as well; root wires initialize(core) after Store.init.
    core.app.include_router(r)
