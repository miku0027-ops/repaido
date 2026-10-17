"""Participant-confirmed marketplace meetings and handovers.

These records are agreements between participants, not verified payments. A
handover locks its listing atomically; the second confirmation closes it. Reads,
cancellation and completion remain available after marketplace access expires.
"""
import time
from typing import Literal

from fastapi import Depends
from pydantic import Field

from operations import Input, fail
from integrations import audit


class Meeting(Input):
    expected_version: int = Field(ge=0, strict=True)
    request_id: str = Field(min_length=16, max_length=100)
    offer_message_id: str = Field(pattern=r'^[a-f0-9]{64}:[0-9]{12,16}$')
    place: str = Field(min_length=5, max_length=300)
    starts_at: float = Field(allow_inf_nan=False)
    note: str = Field(default='', max_length=800)


class Action(Input):
    expected_version: int = Field(ge=1, strict=True)
    request_id: str = Field(min_length=16, max_length=100)
    action: Literal['agree', 'confirm_completion', 'cancel']
    note: str = Field(default='', max_length=800)


class Review(Input):
    request_id: str = Field(min_length=16, max_length=100)
    rating: int = Field(ge=1, le=5, strict=True)
    text: str = Field(min_length=5, max_length=1000)


def view(row, side):
    if not row:
        return None
    peer = 'seller' if side == 'buyer' else 'buyer'
    return {key: row.get(key) for key in ('version', 'state', 'meeting', 'offer', 'offer_message_id',
            'created_at', 'updated_at', 'completed_at', 'cancel_note', 'cancelled_at')} | {
        'my_agreement': bool(row.get(side + '_agreed')),
        'other_agreement': bool(row.get(peer + '_agreed')),
        'my_completion': bool(row.get(side + '_completed')),
        'other_completion': bool(row.get(peer + '_completed')),
        'my_review': row.get(side + '_review'), 'other_review': row.get(peer + '_review'),
        'confirmation_basis': 'Both participants confirm the handover; payment is not independently verified.'}


def add_routes(router, core):
    from market_messaging import _participant, _key, _append, _write_allowed
    store = core.operations_store

    def command(u, user, cid, body, name):
        key = _key('market-transaction', user['id'], body.request_id)
        fp = _key(name, cid, body.model_dump(exclude={'request_id'}))
        old = u.get('market_transaction_commands', key)
        if old and old['fingerprint'] != fp:
            fail('KEY_REUSED', 'This request changed. Refresh the handover before retrying.', 409)
        return key, fp, old

    def save_command(u, key, fp):
        u.put('market_transaction_commands', key, {'id': key, 'fingerprint': fp})

    def listings(u, chat, row, *, require_active=False):
        from marketplace import active
        ids = [(chat['listing_id'], chat['seller_id'])]
        if row['offer'].get('exchange_listing'):
            ids.append((row['offer']['exchange_listing']['id'], chat['buyer_id']))
        values = []
        for lid, owner in ids:
            listing = u.get('market_listings', lid)
            # Expiry hides public listings, but must not strand an already
            # agreed handover when the scheduler materializes that expiry.
            allowed_states = ('published',) if require_active else ('published', 'expired')
            if not listing or listing['owner_id'] != owner or listing['status'] not in allowed_states or require_active and not active(listing):
                fail('LISTING_UNAVAILABLE', 'An item in this agreement is no longer available. Contact support if a handover already took place.', 409)
            claim = u.get('market_handover_claims', lid)
            if claim and claim['chat_id'] != chat['id']:
                fail('HANDOVER_IN_PROGRESS', 'This item already has a handover confirmation in another conversation.', 409)
            values.append(listing)
        return values

    @router.get('/market/chats/{cid}/transaction')
    def transaction(cid: str, user=Depends(core.current_user)):
        def read(u):
            _, side = _participant(u, cid, user)
            return {'transaction': view(u.get('market_transactions', cid), side), 'server_time': time.time()}
        return store.run(read)

    @router.post('/market/chats/{cid}/transaction/meeting')
    def meeting(cid: str, body: Meeting, user=Depends(core.current_user)):
        def save(u):
            chat, side = _participant(u, cid, user)
            row = u.get('market_transactions', cid)
            key, fp, old = command(u, user, cid, body, 'meeting')
            if old:
                return {'transaction': view(row, side)}
            if (row or {}).get('version', 0) != body.expected_version:
                fail('STALE_VERSION', 'The handover changed. Refresh before proposing a meeting.', 409)
            if row and row['state'] in ('completion_pending', 'completed'):
                fail('HANDOVER_STARTED', 'A confirmed handover cannot be rescheduled.', 409)
            _write_allowed(u, chat, side, user)
            offer = u.get('market_chat_messages', body.offer_message_id)
            if not offer or offer.get('chat_id') != cid or offer.get('kind') != 'offer' or offer['offer']['status'] != 'accepted':
                fail('ACCEPTED_OFFER_REQUIRED', 'Choose an accepted price or swap proposal from this conversation.', 409)
            now = time.time()
            if len(body.place.strip()) < 5 or not now <= body.starts_at <= now + 60 * 86400:
                fail('INVALID_MEETING', 'Choose a public meeting place and a time within the next 60 days.', 422)
            row = dict(id=cid, version=body.expected_version + 1, state='proposed',
                       buyer_id=chat['buyer_id'], seller_id=chat['seller_id'],
                       offer_message_id=body.offer_message_id, offer=offer['offer'].copy(),
                       meeting=dict(place=body.place.strip(), starts_at=body.starts_at, note=body.note.strip()),
                       buyer_agreed=side == 'buyer', seller_agreed=side == 'seller',
                       buyer_completed=False, seller_completed=False, created_at=(row or {}).get('created_at', now), updated_at=now)
            listings(u, chat, row, require_active=True)
            u.put('market_transactions', cid, row)
            _append(u, chat, side, body='Meeting proposed. Open Handover details to review the place and time.', now=now)
            save_command(u, key, fp)
            audit(u, 'MarketplaceMeetingProposed', user['id'], chat_id=cid, version=row['version'])
            return {'transaction': view(row, side)}
        return store.run(save)

    @router.post('/market/chats/{cid}/transaction/actions')
    def action(cid: str, body: Action, user=Depends(core.current_user)):
        def save(u):
            chat, side = _participant(u, cid, user)
            row = u.get('market_transactions', cid)
            key, fp, old = command(u, user, cid, body, 'action')
            if old:
                return {'transaction': view(row, side)}
            if not row:
                fail('NOT_FOUND', 'Handover not found.', 404)
            if row['version'] != body.expected_version:
                fail('STALE_VERSION', 'The handover changed. Refresh before continuing.', 409)
            now = time.time()
            if body.action == 'cancel':
                if row['state'] not in ('proposed', 'agreed') or len(body.note.strip()) < 5:
                    fail('CANNOT_CANCEL', 'Add a reason to cancel before either participant confirms handover. Contact support for a handover concern.', 409)
                row.update(state='cancelled', cancel_note=body.note.strip(), cancelled_at=now)
                message = 'The meeting was cancelled. Open Handover details for the reason.'
            else:
                if not user.get('phone_verified'):
                    fail('PHONE_REQUIRED', 'Verify your mobile number before confirming a handover.', 403)
                if body.action == 'agree':
                    if chat.get('buyer_blocked') or chat.get('seller_blocked'):
                        fail('CHAT_BLOCKED', 'This conversation is blocked.', 409)
                    if row['state'] != 'proposed' or row.get(side + '_agreed') or row['meeting']['starts_at'] < now:
                        fail('INVALID_TRANSITION', 'Ask for a fresh meeting proposal before agreeing.', 409)
                    listings(u, chat, row, require_active=True)
                    row.update({side + '_agreed': True, 'state': 'agreed'})
                    message = 'Both participants agreed to the meeting. Inspect the item before confirming handover.'
                else:
                    if row['state'] not in ('agreed', 'completion_pending') or row.get(side + '_completed'):
                        fail('INVALID_TRANSITION', 'Both participants must agree to the meeting before confirming handover.', 409)
                    if now < row['meeting']['starts_at']:
                        fail('MEETING_NOT_STARTED', 'Confirm handover only after the agreed meeting time and actual exchange.', 409)
                    items = listings(u, chat, row)
                    row[side + '_completed'] = True
                    row[side + '_completed_at'] = now
                    complete = row['buyer_completed'] and row['seller_completed']
                    row['state'] = 'completed' if complete else 'completion_pending'
                    for listing in items:
                        u.put('market_handover_claims', listing['id'], dict(id=listing['id'], chat_id=cid, created_at=now))
                        if complete:
                            listing.update(status='closed', closed_at=now, completion_chat_id=cid)
                            u.put('market_listings', listing['id'], listing)
                    if complete:
                        row['completed_at'] = now
                    message = 'Both participants confirmed handover. The listing is now closed; you can review this transaction.' if complete else 'One participant confirmed handover. The other participant still needs to confirm.'
            row.update(version=row['version'] + 1, updated_at=now)
            u.put('market_transactions', cid, row)
            _append(u, chat, side, body=message, now=now)
            save_command(u, key, fp)
            audit(u, 'MarketplaceHandoverUpdated', user['id'], chat_id=cid, transition=body.action, state=row['state'])
            return {'transaction': view(row, side)}
        return store.run(save)

    @router.post('/market/chats/{cid}/transaction/review')
    def review(cid: str, body: Review, user=Depends(core.current_user)):
        def save(u):
            _, side = _participant(u, cid, user)
            row = u.get('market_transactions', cid)
            key, fp, old = command(u, user, cid, body, 'review')
            if old:
                return {'transaction': view(row, side)}
            if not row or row['state'] != 'completed':
                fail('HANDOVER_REQUIRED', 'Both participants must confirm handover before leaving a review.', 409)
            if row.get(side + '_review'):
                fail('REVIEW_EXISTS', 'You have already reviewed this transaction.', 409)
            if len(body.text.strip()) < 5:
                fail('REVIEW_REQUIRED', 'Describe your transaction in at least five characters.', 422)
            row[side + '_review'] = dict(rating=body.rating, text=body.text.strip(), created_at=time.time())
            row.update(version=row['version'] + 1, updated_at=time.time())
            u.put('market_transactions', cid, row)
            save_command(u, key, fp)
            audit(u, 'MarketplaceTransactionReviewed', user['id'], chat_id=cid)
            return {'transaction': view(row, side)}
        return store.run(save)
