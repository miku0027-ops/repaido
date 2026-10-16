"""Public catalogue cards reached through an available listing or private chat.

No user-ID lookup endpoint, identity badge, contact detail, residential address or
position is exposed. Cursor scans and count previews are bounded independently.
"""
import base64
import hashlib
import json
import math
import time
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from market_access import access_status
from marketplace import active
from market_messaging import _name, _participant
from operations import fail

MODES = ('all', 'second_hand', 'exchange', 'rentals')
COUNT_LIMIT = 500
SHOP_LIMIT = 20
SCAN_LIMIT = 400
BATCH = 100


def _key(uid):
    return hashlib.sha256(('repaido-public-market-profile-v1:' + uid).encode()).hexdigest()


def _label(value, maximum=150):
    return _name(value)[:maximum]


def _city(value):
    return _label(value, 80) if str(value or '').strip() else ''


def _number(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def _available(u, row, now, entitlement=None):
    if row.get('mode') not in ('second_hand', 'exchange') or not active(row):
        return False
    # Legacy individually paid listings retain their already purchased period.
    if row.get('fee_status') in ('free_trial', 'access_paid'):
        state = entitlement if entitlement is not None else access_status(u, row['owner_id'], now)
        if not state['active']:
            return False
    return True


def _market_card(row):
    return dict(id=row['id'], mode=row['mode'], name=_label(row.get('name')),
                image_url='/api/operations/market/photos/' + row['photo_id'],
                value_paise=row['value_paise'], city=_city(row.get('city')))


def _rental_card(row, shop):
    if not row.get('active') or not any(_number(row.get(k)) and row[k] > 0 for k in ('daily_paise', 'weekly_paise', 'monthly_paise')):
        return None
    image = str(row.get('image_url') or '')
    if not image.startswith(('https://', '/images/', '/api/operations/media/')):
        image = ''
    return dict(id=row['id'], mode='rentals', name=_label(row.get('name')),
                image_url=image, city=_city(shop.get('city')), shop_id=shop['id'],
                **{k: row[k] if _number(row.get(k)) else 0 for k in ('daily_paise', 'weekly_paise', 'monthly_paise')})


def _shops(u, uid, now):
    from shop_access import visible
    rows = sorted(u.find('shops', 'owner_id', uid, limit=SHOP_LIMIT + 1), key=lambda x: x['id'])
    return [row for row in rows[:SHOP_LIMIT] if visible(u, row, now)], len(rows) <= SHOP_LIMIT


def _cursor(key, mode, stage, after='', shop=''):
    value = dict(v=1, p=key, m=mode, s=stage, a=after, h=shop)
    return base64.urlsafe_b64encode(json.dumps(value, separators=(',', ':')).encode()).decode().rstrip('=')


def _parse_cursor(value, key, mode):
    if not value:
        return dict(s='rentals' if mode == 'rentals' else 'market', a='', h='')
    try:
        if len(value) > 1000:
            raise ValueError()
        data = json.loads(base64.urlsafe_b64decode(value + '=' * (-len(value) % 4)))
        if not isinstance(data, dict) or data.get('v') != 1 or data.get('p') != key or data.get('m') != mode or data.get('s') not in ('market', 'rentals'):
            raise ValueError()
        if mode == 'rentals' and data['s'] != 'rentals' or mode in ('second_hand', 'exchange') and data['s'] != 'market':
            raise ValueError()
        if any(not isinstance(data.get(k), str) or len(data[k]) > 100 or '/' in data[k] for k in ('a', 'h')):
            raise ValueError()
        return data
    except (ValueError, TypeError, KeyError, UnicodeError):
        fail('INVALID_CURSOR', 'Return to the first profile page to continue.', 422)


def profile(u, uid, name, mode='all', cursor=None, limit=12):
    now = time.time()
    key = _key(uid)
    position = _parse_cursor(cursor, key, mode)
    entitlement = access_status(u, uid, now)
    preview = u.find('market_listings', 'owner_id', uid, limit=COUNT_LIMIT + 1)
    visible_rows = [row for row in preview[:COUNT_LIMIT] if _available(u, row, now, entitlement)]
    shops, shops_complete = _shops(u, uid, now)
    # Reviewed approval is independent of a trial, payment or personal membership.
    from shop_access import verified
    shop_cards = [dict(id=s['id'], name=_label(s.get('name')), city=_city(s.get('city')), verified=bool(verified(s))) for s in shops]
    rental_count = 0
    counts_complete = len(preview) <= COUNT_LIMIT and shops_complete
    for shop in shops:
        rentals = u.find('rental_inventory', 'shop_id', shop['id'], limit=COUNT_LIMIT + 1)
        rental_count += sum(_rental_card(row, shop) is not None for row in rentals[:COUNT_LIMIT])
        counts_complete = counts_complete and len(rentals) <= COUNT_LIMIT
    counts = dict(second_hand=sum(r['mode'] == 'second_hand' for r in visible_rows), exchange=sum(r['mode'] == 'exchange' for r in visible_rows), rentals=rental_count)
    dates = [r['created_at'] for r in visible_rows if _number(r.get('created_at'))]
    items = []
    scanned = 0
    next_cursor = None
    if position['s'] == 'market':
        after = position['a']
        while scanned < SCAN_LIMIT:
            rows = u.find('market_listings', 'owner_id', uid, limit=BATCH, after=after or None)
            for row in rows:
                after = row['id']; scanned += 1
                if _available(u, row, now, entitlement) and (mode == 'all' or mode == row['mode']):
                    items.append(_market_card(row))
                if len(items) == limit or scanned == SCAN_LIMIT:
                    next_cursor = _cursor(key, mode, 'market', after)
                    break
            if next_cursor:
                break
            if len(rows) < BATCH:
                position = dict(s='rentals', a='', h='')
                break
        if next_cursor:
            pass
        elif mode in ('second_hand', 'exchange'):
            position['s'] = 'done'
    if position['s'] == 'rentals' and mode in ('all', 'rentals') and not next_cursor:
        for shop in shops:
            if position.get('h') and shop['id'] < position['h']:
                continue
            after = position.get('a', '') if shop['id'] == position.get('h') else ''
            while scanned < SCAN_LIMIT:
                rows = u.find('rental_inventory', 'shop_id', shop['id'], limit=BATCH, after=after or None)
                for row in rows:
                    after = row['id']; scanned += 1
                    card = _rental_card(row, shop)
                    if card:
                        items.append(card)
                    if len(items) == limit or scanned == SCAN_LIMIT:
                        next_cursor = _cursor(key, mode, 'rentals', after, shop['id'])
                        break
                if next_cursor or len(rows) < BATCH:
                    break
            if next_cursor:
                break
    return dict(key=key, name=_label(name), label='Community seller',
                first_listed_at=min(dates) if dates and len(preview) <= COUNT_LIMIT else None,
                counts=counts, counts_complete=counts_complete, shops=shop_cards,
                shops_complete=shops_complete, items=items, next_cursor=next_cursor, mode=mode)


def install(core):
    router = APIRouter(prefix='/operations')
    store = core.operations_store
    def headers(response):
        # Closed listings and access expiry must take effect before another read.
        response.headers['Cache-Control'] = 'private, no-store'
        response.headers['Vary'] = 'Authorization'
    @router.get('/market/profiles/by-listing/{listing_id}')
    def from_listing(listing_id: str, response: Response, mode: Literal['all','second_hand','exchange','rentals']='all', cursor: str|None=Query(default=None,max_length=1000), limit: int=Query(default=12,ge=1,le=24)):
        headers(response)
        def read(u):
            row = u.get('market_listings', listing_id)
            if not row or not _available(u, row, time.time()):
                fail('NOT_FOUND', 'This seller profile is unavailable.', 404)
            return {'profile': profile(u, row['owner_id'], row.get('owner_name'), mode, cursor, limit)}
        return store.run(read)
    @router.get('/market/chats/{chat_id}/peer-profile')
    def from_chat(chat_id: str, response: Response, mode: Literal['all','second_hand','exchange','rentals']='all', cursor: str|None=Query(default=None,max_length=1000), limit: int=Query(default=12,ge=1,le=24), user=Depends(core.current_user)):
        headers(response)
        def read(u):
            chat, side = _participant(u, chat_id, user)
            peer = 'seller' if side == 'buyer' else 'buyer'
            return {'profile': profile(u, chat[peer+'_id'], chat.get(peer+'_name'), mode, cursor, limit)}
        return store.run(read)
    core.app.include_router(router)
