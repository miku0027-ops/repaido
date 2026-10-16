"""Private, listing-scoped marketplace conversations.

Messages and receipts commit together in the operations transaction. Public
listing data, private message data and plan eligibility remain separate. No
message text or contact details are copied into general notifications.
"""
import base64
import binascii
import hashlib
import json
import math
import re
import time
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import Field, model_validator

from operations import Input, fail
from integrations import audit
from marketplace import active
from market_access import access_status, require_access
from market_presence import add_routes as add_presence_routes, presence_view

PAGE_SIZE = 50


class OpenChat(Input):
    listing_id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,128}$')
    request_id: str = Field(min_length=16, max_length=100)
    body: str = Field(default='', max_length=2000)


class SendMessage(Input):
    request_id: str = Field(min_length=16, max_length=100)
    body: str = Field(default='', max_length=2000)
    kind: Literal['text', 'offer'] = 'text'
    amount_paise: int | None = Field(default=None, ge=100, le=100000000, strict=True)
    exchange_listing_id: str | None = Field(default=None, pattern=r'^[A-Za-z0-9_-]{1,128}$')

    @model_validator(mode='after')
    def valid(self):
        if self.kind == 'text' and (not self.body.strip() or self.amount_paise is not None or self.exchange_listing_id is not None):
            raise ValueError('A text message needs text and cannot contain offer fields.')
        return self


class ReadMessages(Input):
    through_seq: int = Field(ge=0, strict=True)


class BlockChat(Input):
    blocked: bool


class ReportChat(Input):
    reason: str = Field(min_length=10, max_length=1000)
    message_id: str | None = Field(default=None, pattern=r'^[a-f0-9]{64}:[0-9]{12,16}$')


class DecideOffer(Input):
    decision: Literal['accepted', 'declined']


class ResolveReport(Input):
    status: Literal['resolved', 'dismissed']
    note: str = Field(min_length=10, max_length=1000)


def _key(*parts):
    return hashlib.sha256(json.dumps(parts, separators=(',', ':')).encode()).hexdigest()


def _name(value):
    # Profile labels never act as a second channel for a stored phone/email.
    text = re.sub(r'\s+', ' ', str(value or 'Repaido member')).strip()
    text = re.sub(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}', 'Member', text)
    text = re.sub(r'\+?[\d\s()-]{10,}', 'Member', text)
    return text[:100] or 'Repaido member'


def _safe_context(value):
    text = str(value or '')[:2000]
    text = re.sub(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}', '[email removed]', text)
    return re.sub(r'\+?\d[\d\s()-]{8,}\d', '[phone removed]', text)[:600]


def _message_id(cid, seq):
    return f'{cid}:{seq:012d}'


def _side(chat, uid):
    if chat.get('buyer_id') == uid:
        return 'buyer'
    if chat.get('seller_id') == uid:
        return 'seller'
    fail('NOT_FOUND', 'Conversation not found.', 404)


def _participant(u, cid, user):
    if not re.fullmatch(r'[a-f0-9]{64}', cid):
        fail('NOT_FOUND', 'Conversation not found.', 404)
    chat = u.get('market_chats', cid)
    if not chat:
        fail('NOT_FOUND', 'Conversation not found.', 404)
    return chat, _side(chat, user['id'])


def _message_view(message, side):
    return {key: message.get(key) for key in ('id', 'seq', 'kind', 'body', 'created_at', 'sender_role', 'offer', 'offer_message_id', 'offer_status')} | {'mine': message['sender_role'] == side}


def _listing_view(row, fallback):
    if not row:
        return {**fallback, 'status': 'unavailable'}
    return dict(id=row['id'], name=row['name'], mode=row['mode'],
                image_url='/api/operations/market/photos/' + row['photo_id'],
                value_paise=row['value_paise'], city=row['city'],
                status='expired' if row.get('status') == 'published' and not active(row) else row.get('status', 'unavailable'))


def _counts(u, uid):
    return u.get('market_chat_counts', _key(uid)) or dict(id=_key(uid), all=0, buying=0, selling=0)


def _change_unread(u, uid, side, delta):
    counts = _counts(u, uid)
    counts['all'] = max(0, counts['all'] + delta)
    counts[side] = max(0, counts[side] + delta)
    u.put('market_chat_counts', counts['id'], counts)


def _unread(chat, side):
    return max(0, chat.get(('seller' if side == 'buyer' else 'buyer') + '_count', 0) - chat.get(side + '_read_peer_count', 0))


def _chat_view(u, chat, uid, access=None):
    side = _side(chat, uid)
    peer = 'seller' if side == 'buyer' else 'buyer'
    listing = u.get('market_listings', chat['listing_id'])
    access = access_status(u, uid) if access is None else access
    reason = None
    if chat.get(side + '_blocked') or chat.get(peer + '_blocked'):
        reason = 'This conversation is blocked. Messages remain available to its participants.'
    elif not listing or not active(listing):
        reason = 'This listing is no longer active. Your conversation remains available.'
    elif not access.get('active') and access.get('status') != 'not_started':
        reason = 'Renew marketplace access to send messages. Your conversation remains available.'
    last = u.get('market_chat_messages', _message_id(chat['id'], chat['latest_seq'])) if chat['latest_seq'] else None
    return dict(id=chat['id'], listing=_listing_view(listing, chat['listing']),
                side='buying' if side == 'buyer' else 'selling', other={'name': chat[peer + '_name']},
                last_message=_message_view(last, side) if last else None,
                latest_seq=chat['latest_seq'], read_seq=chat.get(side + '_read_seq', 0),
                other_read_seq=chat.get(peer + '_read_seq', 0), unread_count=_unread(chat, side),
                blocked_by_me=bool(chat.get(side + '_blocked')), blocked_by_other=bool(chat.get(peer + '_blocked')),
                can_send=reason is None, unavailable_reason=reason, access=access, updated_at=chat['updated_at'])


def _command(u, user, request_id, kind, payload):
    key = _key(user['id'], request_id)
    fingerprint = _key(kind, payload)
    old = u.get('market_chat_commands', key)
    if old and old['fingerprint'] != fingerprint:
        fail('KEY_REUSED', 'This message request changed. Start a new request.', 409)
    return key, fingerprint, old


def _rate(u, uid, name, seconds, maximum, now):
    bucket = int(now // seconds)
    key = _key(uid, name, bucket)
    value = u.get('market_chat_limits', key) or dict(id=key, count=0, expires_at=(bucket + 2) * seconds)
    if value['count'] >= maximum:
        fail('RATE_LIMITED', 'Please wait before sending more marketplace messages.', 429)
    value['count'] += 1
    u.put('market_chat_limits', key, value)


def _write_allowed(u, chat, side, user):
    if not user.get('phone_verified'):
        fail('PHONE_REQUIRED', 'Verify your mobile number before messaging.', 403)
    if chat.get('buyer_blocked') or chat.get('seller_blocked'):
        fail('CHAT_BLOCKED', 'This conversation is blocked.', 409)
    listing = u.get('market_listings', chat['listing_id'])
    if not listing or not active(listing):
        fail('LISTING_UNAVAILABLE', 'This listing is no longer active. Your conversation remains available.', 409)
    require_access(u, user, start_trial=True)
    return listing


def _append(u, chat, side, *, body, kind='text', offer=None, offer_message_id=None, offer_status=None, now=None):
    now = time.time() if now is None else now
    seq = chat['latest_seq'] + 1
    chat['latest_seq'] = seq
    chat[side + '_count'] += 1
    chat['updated_at'] = now
    message = dict(id=_message_id(chat['id'], seq), chat_id=chat['id'], seq=seq,
                   sender_role=side, kind=kind, body=body, offer=offer, created_at=now,
                   buyer_count=chat['buyer_count'], seller_count=chat['seller_count'],
                   offer_message_id=offer_message_id, offer_status=offer_status)
    u.put('market_chat_messages', message['id'], message)
    peer = 'seller' if side == 'buyer' else 'buyer'
    _change_unread(u, chat[peer + '_id'], 'buying' if peer == 'buyer' else 'selling', 1)
    for role in ('buyer', 'seller'):
        iid = _key(chat[role + '_id'], chat['id'])
        u.put('market_chat_inbox', iid, dict(id=iid, user_id=chat[role + '_id'],
              side='buying' if role == 'buyer' else 'selling', chat_id=chat['id'], updated_at=now))
    u.put('market_chats', chat['id'], chat)
    nid = 'market-message-' + _key(message['id'], chat[peer + '_id'])
    u.put('notifications', nid, dict(id=nid, user_id=chat[peer + '_id'], title='New marketplace message',
          body='Open your private marketplace inbox to read it. Never pay a fee to receive a payment.',
          destination=chat['listing']['mode'], market_chat_id=chat['id'], market_message_seq=seq, created_at=now))
    return message


def _encode_cursor(row):
    return base64.urlsafe_b64encode(json.dumps([row['updated_at'], row['id']], separators=(',', ':')).encode()).decode().rstrip('=')


def _decode_cursor(cursor):
    if not cursor:
        return None
    try:
        if len(cursor) > 300:
            raise ValueError()
        value = json.loads(base64.urlsafe_b64decode(cursor + '=' * (-len(cursor) % 4)))
        if not isinstance(value, list) or len(value) != 2 or isinstance(value[0], bool) or not isinstance(value[0], (int, float)) or not math.isfinite(value[0]) or value[0] < 0 or not re.fullmatch(r'[a-f0-9]{64}', value[1]):
            raise ValueError()
        return value
    except (ValueError, TypeError, IndexError, binascii.Error, UnicodeDecodeError):
        fail('INVALID_CURSOR', 'Refresh the inbox to continue.', 422)


def _inbox_page(u, uid, side, cursor):
    """Bounded native query; no global thread or message collection scans."""
    if u.tx is not None:
        query = u.core.fs_collection('ops_market_chat_inbox').where('user_id', '==', uid)
        if side != 'all':
            query = query.where('side', '==', side)
        query = query.order_by('updated_at', direction='DESCENDING').order_by('__name__', direction='DESCENDING')
        if cursor:
            query = query.start_after({'updated_at': cursor[0], '__name__': u.core.fs_doc('ops_market_chat_inbox', cursor[1])})
        rows = {s.id: s.to_dict() for s in query.limit(PAGE_SIZE + 1).stream(transaction=u.tx)}
    else:
        sql = "SELECT id,body FROM operation_records WHERE kind='market_chat_inbox' AND json_extract(body,'$.user_id')=?"
        params = [uid]
        if side != 'all':
            sql += " AND json_extract(body,'$.side')=?"
            params.append(side)
        if cursor:
            sql += " AND (json_extract(body,'$.updated_at')<? OR (json_extract(body,'$.updated_at')=? AND id<?))"
            params.extend((cursor[0], cursor[0], cursor[1]))
        sql += " ORDER BY json_extract(body,'$.updated_at') DESC,id DESC LIMIT ?"
        params.append(PAGE_SIZE + 1)
        rows = {r['id']: json.loads(r['body']) for r in u.conn.execute(sql, params)}
    u.fetched.update({('market_chat_inbox', key): value for key, value in rows.items()})
    for (kind, key), row in u.pending.items():
        if kind == 'market_chat_inbox':
            if row.get('user_id') == uid and (side == 'all' or row.get('side') == side):
                rows[key] = row
            else:
                rows.pop(key, None)
    values = sorted(rows.values(), key=lambda row: (row['updated_at'], row['id']), reverse=True)
    return [row for row in values if not cursor or (row['updated_at'], row['id']) < (cursor[0], cursor[1])][:PAGE_SIZE + 1]


def install(core):
    router = APIRouter(prefix='/operations')
    store = core.operations_store

    @router.get('/market/chats')
    def inbox(side: Literal['all', 'buying', 'selling'] = 'all', cursor: str | None = None, user=Depends(core.current_user)):
        boundary = _decode_cursor(cursor)
        def read(u):
            rows = _inbox_page(u, user['id'], side, boundary)
            visible = rows[:PAGE_SIZE]
            u.prefetch([('market_chats', row['chat_id']) for row in visible])
            chats = [u.get('market_chats', row['chat_id']) for row in visible]
            u.prefetch([('market_listings', chat['listing_id']) for chat in chats if chat] + [('market_chat_messages', _message_id(chat['id'], chat['latest_seq'])) for chat in chats if chat and chat['latest_seq']])
            access = access_status(u, user['id'])
            return dict(chats=[_chat_view(u, chat, user['id'], access) for chat in chats if chat],
                        next_cursor=_encode_cursor(visible[-1]) if len(rows) > PAGE_SIZE else None,
                        unread_count=_counts(u, user['id']).get(side, 0))
        return store.run(read)

    @router.post('/market/chats')
    def open_chat(body: OpenChat, user=Depends(core.current_user)):
        def save(u):
            key, fp, old = _command(u, user, body.request_id, 'open', body.model_dump(exclude={'request_id'}))
            if old:
                chat, side = _participant(u, old['chat_id'], user)
                message = u.get('market_chat_messages', old['message_id']) if old.get('message_id') else None
                return dict(chat=_chat_view(u, chat, user['id']), messages=[_message_view(message, side)] if message else [])
            listing = u.get('market_listings', body.listing_id)
            if not listing or listing.get('mode') not in ('exchange', 'second_hand'):
                fail('NOT_FOUND', 'Listing not found.', 404)
            if listing['owner_id'] == user['id']:
                fail('SELF_CHAT', 'You cannot message yourself about your own listing.', 409)
            cid = _key(body.listing_id, user['id'])
            chat = u.get('market_chats', cid)
            fresh = chat is None
            if fresh:
                if not active(listing):
                    fail('NOT_FOUND', 'Listing not found.', 404)
                if not user.get('phone_verified'):
                    fail('PHONE_REQUIRED', 'Verify your mobile number before messaging.', 403)
                require_access(u, user, start_trial=True)
                now = time.time()
                _rate(u, user['id'], 'new_chat_hour', 3600, 10, now)
                _rate(u, user['id'], 'new_chat_day', 86400, 30, now)
                chat = dict(id=cid, listing_id=listing['id'], listing=_listing_view(listing, {}),
                            buyer_id=user['id'], seller_id=listing['owner_id'], buyer_name=_name(user.get('name')),
                            seller_name=_name(listing.get('owner_name')), latest_seq=0, buyer_count=0, seller_count=0,
                            buyer_read_seq=0, seller_read_seq=0, buyer_read_peer_count=0, seller_read_peer_count=0,
                            buyer_blocked=False, seller_blocked=False, created_at=now, updated_at=now)
                for role in ('buyer', 'seller'):
                    iid = _key(chat[role + '_id'], cid)
                    u.put('market_chat_inbox', iid, dict(id=iid, user_id=chat[role + '_id'], side='buying' if role == 'buyer' else 'selling', chat_id=cid, updated_at=now))
                u.put('market_chats', cid, chat)
                audit(u, 'MarketplaceConversationOpened', user['id'], chat_id=cid, listing_id=listing['id'])
            message = None
            if body.body.strip():
                _write_allowed(u, chat, 'buyer', user)
                now = time.time()
                _rate(u, user['id'], 'messages_minute', 60, 60, now)
                _rate(u, user['id'], 'messages_day', 86400, 1000, now)
                message = _append(u, chat, 'buyer', body=body.body.strip(), now=now)
            u.put('market_chat_commands', key, dict(id=key, fingerprint=fp, chat_id=cid, message_id=message['id'] if message else None))
            return dict(chat=_chat_view(u, chat, user['id']), messages=[_message_view(message, 'buyer')] if message else [])
        return store.run(save)

    @router.get('/market/chats/{cid}/messages')
    def messages(cid: str, before: int | None = Query(default=None, ge=1), after: int | None = Query(default=None, ge=0), user=Depends(core.current_user)):
        if before is not None and after is not None:
            fail('INVALID_CURSOR', 'Use one message cursor at a time.', 422)
        def read(u):
            chat, side = _participant(u, cid, user)
            latest = chat['latest_seq']
            if (before is not None and before > latest + 1) or (after is not None and after > latest):
                fail('INVALID_CURSOR', 'Refresh the conversation to continue.', 422)
            if after is not None:
                start, end = after + 1, min(latest, after + PAGE_SIZE)
            else:
                end = min(latest, before - 1 if before is not None else latest)
                start = max(1, end - PAGE_SIZE + 1)
            ids = [_message_id(cid, seq) for seq in range(start, end + 1)]
            u.prefetch([('market_chat_messages', mid) for mid in ids])
            rows = [u.get('market_chat_messages', mid) for mid in ids]
            return dict(chat=_chat_view(u, chat, user['id']), presence=presence_view(u, chat, side), messages=[_message_view(row, side) for row in rows if row],
                        next_cursor=start if start > 1 and rows else None,
                        next_after=end if rows else (after or 0), has_more=end < latest if after is not None else start > 1)
        return store.run(read)

    @router.post('/market/chats/{cid}/messages')
    def send(cid: str, body: SendMessage, user=Depends(core.current_user)):
        def save(u):
            chat, side = _participant(u, cid, user)
            key, fp, old = _command(u, user, body.request_id, 'send', {'chat_id': cid, **body.model_dump(exclude={'request_id'})})
            if old:
                message = u.get('market_chat_messages', old['message_id'])
                return dict(chat=_chat_view(u, chat, user['id']), message=_message_view(message, side))
            listing = _write_allowed(u, chat, side, user)
            offer = None
            if body.kind == 'offer':
                if side != 'buyer':
                    fail('OFFER_NOT_ALLOWED', 'Only the interested buyer can propose an offer.', 403)
                if listing['mode'] == 'second_hand':
                    if body.amount_paise is None or body.exchange_listing_id is not None:
                        fail('INVALID_OFFER', 'Enter a rupee offer for this second-hand item.', 422)
                    offer = dict(amount_paise=body.amount_paise, exchange_listing=None, status='pending', decided_at=None)
                else:
                    own = u.get('market_listings', body.exchange_listing_id or '')
                    if body.amount_paise is not None or not own or own['owner_id'] != user['id'] or own.get('mode') != 'exchange' or not active(own):
                        fail('INVALID_OFFER', 'Choose your own active exchange listing.', 422)
                    offer = dict(amount_paise=None, exchange_listing={k: v for k, v in _listing_view(own, {}).items() if k in ('id', 'name', 'image_url', 'status')}, status='pending', decided_at=None)
            now = time.time()
            _rate(u, user['id'], 'messages_minute', 60, 60, now)
            _rate(u, user['id'], 'messages_day', 86400, 1000, now)
            message = _append(u, chat, side, body=body.body.strip(), kind=body.kind, offer=offer, now=now)
            u.put('market_chat_commands', key, dict(id=key, fingerprint=fp, chat_id=cid, message_id=message['id']))
            return dict(chat=_chat_view(u, chat, user['id']), message=_message_view(message, side))
        return store.run(save)

    @router.post('/market/chats/{cid}/read')
    def mark_read(cid: str, body: ReadMessages, user=Depends(core.current_user)):
        def save(u):
            chat, side = _participant(u, cid, user)
            if body.through_seq > chat['latest_seq']:
                fail('INVALID_RECEIPT', 'A read receipt cannot refer to a future message.', 422)
            if body.through_seq > chat.get(side + '_read_seq', 0):
                previous = _unread(chat, side)
                row = u.get('market_chat_messages', _message_id(cid, body.through_seq))
                peer = 'seller' if side == 'buyer' else 'buyer'
                chat[side + '_read_seq'] = body.through_seq
                chat[side + '_read_peer_count'] = row[peer + '_count'] if row else 0
                _change_unread(u, user['id'], 'buying' if side == 'buyer' else 'selling', _unread(chat, side) - previous)
                u.put('market_chats', cid, chat)
            return {'chat': _chat_view(u, chat, user['id'])}
        return store.run(save)

    @router.post('/market/chats/{cid}/offers/{mid}')
    def decide(cid: str, mid: str, body: DecideOffer, user=Depends(core.current_user)):
        def save(u):
            chat, side = _participant(u, cid, user)
            if side != 'seller':
                fail('OFFER_NOT_ALLOWED', 'Only the listing owner can decide this offer.', 403)
            if not re.fullmatch(re.escape(cid) + r':[0-9]{12,16}', mid):
                fail('NOT_FOUND', 'Offer not found.', 404)
            message = u.get('market_chat_messages', mid)
            if not message or message.get('chat_id') != cid or message.get('kind') != 'offer':
                fail('NOT_FOUND', 'Offer not found.', 404)
            offer = message['offer']
            if offer['status'] != 'pending':
                if offer['status'] != body.decision:
                    fail('OFFER_DECIDED', 'This offer has already been decided.', 409)
                return dict(chat=_chat_view(u, chat, user['id']), message=_message_view(message, side))
            _write_allowed(u, chat, side, user)
            if body.decision == 'accepted' and offer.get('exchange_listing'):
                own = u.get('market_listings', offer['exchange_listing']['id'])
                if not own or own['owner_id'] != chat['buyer_id'] or not active(own) or own.get('mode') != 'exchange':
                    fail('INVALID_OFFER', 'The proposed exchange item is no longer active.', 409)
            now = time.time()
            _rate(u, user['id'], 'messages_minute', 60, 60, now)
            _rate(u, user['id'], 'messages_day', 86400, 1000, now)
            offer.update(status=body.decision, decided_at=now)
            u.put('market_chat_messages', mid, message)
            _append(u, chat, side, kind='offer_update', body='Offer accepted. This is a proposal only; no payment or reservation was made.' if body.decision == 'accepted' else 'Offer declined.', offer_message_id=mid, offer_status=body.decision, now=now)
            audit(u, 'MarketplaceOfferDecided', user['id'], chat_id=cid, message_id=mid, decision=body.decision)
            return dict(chat=_chat_view(u, chat, user['id']), message=_message_view(message, side))
        return store.run(save)

    @router.post('/market/chats/{cid}/block')
    def block(cid: str, body: BlockChat, user=Depends(core.current_user)):
        def save(u):
            chat, side = _participant(u, cid, user)
            if chat.get(side + '_blocked') != body.blocked:
                chat[side + '_blocked'] = body.blocked
                u.put('market_chats', cid, chat)
                audit(u, 'MarketplaceConversationBlocked' if body.blocked else 'MarketplaceConversationUnblocked', user['id'], chat_id=cid)
            return {'chat': _chat_view(u, chat, user['id'])}
        return store.run(save)

    @router.post('/market/chats/{cid}/report')
    def report(cid: str, body: ReportChat, user=Depends(core.current_user)):
        def save(u):
            chat, _ = _participant(u, cid, user)
            message = u.get('market_chat_messages', body.message_id) if body.message_id else None
            if body.message_id and (not message or message.get('chat_id') != cid):
                fail('NOT_FOUND', 'Message not found.', 404)
            rid = _key(cid, user['id'])
            if not u.get('market_chat_reports', rid):
                if len(body.reason.strip()) < 10:
                    fail('INVALID_REPORT', 'Describe the concern in at least 10 characters.', 422)
                u.put('market_chat_reports', rid, dict(id=rid, chat_id=cid, listing_id=chat['listing_id'],
                      user_id=user['id'], reason=_safe_context(body.reason.strip()), message_id=body.message_id,
                      message_context=_safe_context(message.get('body')) if message else None,
                      status='open', created_at=time.time()))
                audit(u, 'MarketplaceConversationReported', user['id'], chat_id=cid, report_id=rid)
            return {'status': 'reported', 'id': rid}
        return store.run(save)

    @router.get('/admin/market/chats/reports')
    def reports(status: Literal['open', 'resolved', 'dismissed'] = 'open', cursor: str | None = None, operator=Depends(core.operator)):
        def read(u):
            rows = u.find('market_chat_reports', 'status', status, limit=PAGE_SIZE + 1, after=cursor)
            return dict(reports=[{k: row.get(k) for k in ('id', 'chat_id', 'listing_id', 'reason', 'message_id', 'message_context', 'status', 'created_at', 'resolved_at', 'note')} for row in rows[:PAGE_SIZE]], next_cursor=rows[PAGE_SIZE - 1]['id'] if len(rows) > PAGE_SIZE else None)
        return store.run(read)

    @router.post('/admin/market/chats/reports/{rid}/resolve')
    def resolve(rid: str, body: ResolveReport, operator=Depends(core.operator)):
        def save(u):
            if not re.fullmatch(r'[a-f0-9]{64}', rid):
                fail('NOT_FOUND', 'Report not found.', 404)
            row = u.get('market_chat_reports', rid)
            if not row:
                fail('NOT_FOUND', 'Report not found.', 404)
            if row['status'] != 'open':
                if row['status'] != body.status or row.get('note') != body.note:
                    fail('REPORT_RESOLVED', 'This report has already been resolved.', 409)
                return {'status': row['status']}
            row.update(status=body.status, note=body.note, resolved_at=time.time())
            u.put('market_chat_reports', rid, row)
            audit(u, 'MarketplaceMessageReportResolved', 'operator', report_id=rid, status=body.status)
            return {'status': row['status']}
        return store.run(save)

    add_presence_routes(router, core, _participant, _chat_view)
    core.app.include_router(router)
