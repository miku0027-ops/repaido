"""Server-clock, conversation-scoped presence; never a global online claim.

One bounded record per participant/thread avoids collection scans. Session
sequences make late disconnects harmless across tabs. Reads derive expiration;
there is no scheduler, notification, message, unread or billing side effect.
"""
import hashlib
import time
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import Depends
from pydantic import Field, model_validator

from operations import Input, fail
from market_access import access_status
from marketplace import active

ONLINE_TTL = 45
TYPING_TTL = 6
MAX_SESSIONS = 16
IST = timezone(timedelta(hours=5, minutes=30), name='Asia/Kolkata')


class PresenceHeartbeat(Input):
    session_id: uuid.UUID
    sequence: int = Field(ge=1, le=9007199254740991, strict=True)
    online: bool = Field(strict=True)
    typing: bool = Field(strict=True)

    @model_validator(mode='after')
    def online_typing(self):
        if self.typing and not self.online:
            raise ValueError('Typing requires an active conversation.')
        return self


def _key(cid, uid):
    return hashlib.sha256((cid + ':' + uid).encode()).hexdigest()


def presence_view(u, chat, side, now=None):
    now = time.time() if now is None else now
    result = dict(other_online=False, other_typing=False, last_seen_at=None,
                  server_now=now, expires_at=None, typing_expires_at=None)
    if chat.get('buyer_blocked') or chat.get('seller_blocked'):
        return result
    peer = 'seller' if side == 'buyer' else 'buyer'
    row = u.get('market_chat_presence', _key(chat['id'], chat[peer + '_id']))
    if not row:
        return result
    sessions = list(row.get('sessions', {}).values())
    live = [item for item in sessions if item.get('online_until', 0) > now]
    typing = [item for item in live if item.get('typing_until', 0) > now]
    if typing:
        listing = u.get('market_listings', chat['listing_id'])
        access = access_status(u, chat[peer + '_id'], now)
        if not listing or not active(listing) or not (access['active'] or access['status'] == 'not_started'):
            typing = []
    return dict(other_online=bool(live), other_typing=bool(typing),
                last_seen_at=row.get('last_seen_at'), server_now=now,
                expires_at=max((item['online_until'] for item in live), default=None),
                typing_expires_at=max((item['typing_until'] for item in typing), default=None))


def _record_active_day(u, uid, now):
    """Private Asia/Kolkata month/day aggregate of observed shop-owner chat activity.

    This is evidence of an active day, not hours worked or sales. Only shops
    whose authenticated owner matches are eligible; no public identity fields.
    """
    shops = u.find('shops', 'owner_id', uid, limit=1)
    if not shops:
        return
    date = datetime.fromtimestamp(now, IST)
    month = date.strftime('%Y-%m')
    key = hashlib.sha256((uid + ':' + month).encode()).hexdigest()
    row = u.get('shop_presence_month', key) or dict(id=key, owner_id=uid, month=month, active_days=[])
    if date.day not in row['active_days']:
        row['active_days'] = sorted(set(row['active_days']) | {date.day})
        row['last_active_at'] = now
        u.put('shop_presence_month', key, row)


def add_routes(router, core, participant, chat_view):
    store = core.operations_store

    @router.get('/market/chats/{cid}/presence')
    def read_presence(cid: str, user=Depends(core.current_user)):
        def read(u):
            chat, side = participant(u, cid, user)
            return presence_view(u, chat, side)
        return store.run(read)

    @router.post('/market/chats/{cid}/presence')
    def heartbeat(cid: str, body: PresenceHeartbeat, user=Depends(core.current_user)):
        def save(u):
            chat, side = participant(u, cid, user)
            now = time.time()
            if chat.get('buyer_blocked') or chat.get('seller_blocked'):
                return presence_view(u, chat, side, now)
            # Reading expired membership is allowed; typing is a send capability.
            may_type = bool(user.get('phone_verified')) and chat_view(u, chat, user['id']).get('can_send', False)
            key = _key(cid, user['id'])
            row = u.get('market_chat_presence', key) or dict(id=key, sessions={}, last_seen_at=None)
            sessions = row['sessions']
            session = str(body.session_id)
            old = sessions.get(session)
            if old and body.sequence <= old['sequence']:
                return presence_view(u, chat, side, now)
            if not old and not body.online:
                return presence_view(u, chat, side, now)
            if not old and len(sessions) >= MAX_SESSIONS:
                removable = sorted((name for name, value in sessions.items() if value.get('online_until', 0) <= now),
                                   key=lambda name: sessions[name].get('seen_at', 0))
                if not removable:
                    fail('PRESENCE_LIMIT', 'Too many active conversation windows. Close another window.', 429)
                del sessions[removable[0]]
            # Suppress duplicate hot heartbeats but always allow stop/blur events.
            if old and body.online and old.get('online_until', 0) > now and now - old.get('seen_at', 0) < 1 and bool(old.get('typing_until', 0) > now) == bool(body.typing and may_type):
                fail('PRESENCE_RATE', 'Please wait before refreshing conversation activity.', 429)
            sessions[session] = dict(sequence=body.sequence, seen_at=now,
                                     online_until=now + ONLINE_TTL if body.online else 0,
                                     typing_until=now + TYPING_TTL if body.online and body.typing and may_type else 0)
            row['last_seen_at'] = now
            u.put('market_chat_presence', key, row)
            if body.online:
                _record_active_day(u, user['id'], now)
            return presence_view(u, chat, side, now)
        return store.run(save)
