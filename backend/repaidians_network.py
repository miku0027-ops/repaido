"""Mutual professional connections and member-authored career profiles.

Relationship records authorize every projection, including endorsements and
approved recommendations. Bounded per-member lanes avoid collection scans and
never expose private invitations in a public member profile. Career details are
self-declared; connection approval does not verify employment or qualifications.
"""
import base64
import ipaddress
import json
import re
import uuid
from datetime import date
from typing import Annotated, Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Query, Response
from pydantic import Field, field_validator, model_validator

from operations import Input, fail
import repaidians as social

PAGE_SCAN = 64
DEFAULT_PREFERENCES = {
    'connectionPrivacy': 'everyone', 'allowEndorsements': True,
    'allowRecommendations': True, 'networkNotifications': True,
}
Month = Annotated[str, Field(pattern=r'^\d{4}-(0[1-9]|1[0-2])$')]
EntryId = Annotated[str, Field(pattern=r'^[A-Za-z0-9_-]{1,80}$')]


def clean_text(value):
    return value.strip() if isinstance(value, str) else value


def month_valid(value):
    if value:
        year, month = map(int, value.split('-'))
        if year < 1900 or year > date.today().year + 10:
            raise ValueError('Enter a valid career month between 1900 and the next ten years.')
        date(year, month, 1)
    return value


def public_link(value):
    if not value:
        return value
    value = value.strip()
    parsed = urlsplit(value)
    host = (parsed.hostname or '').casefold()
    if parsed.scheme != 'https' or not host or parsed.username or parsed.password:
        raise ValueError('Use a public HTTPS link without account credentials.')
    if host in ('localhost', 'localhost.localdomain') or host.endswith(('.local', '.internal', '.localhost')):
        raise ValueError('Use a public HTTPS link.')
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if address and not address.is_global:
        raise ValueError('Use a public HTTPS link.')
    try:
        parsed.port
    except ValueError as exc:
        raise ValueError('Enter a valid HTTPS link.') from exc
    return value


class CareerDates(Input):
    startMonth: Month
    endMonth: Month | None = None
    current: bool = Field(default=False, strict=True)

    @field_validator('startMonth', 'endMonth')
    @classmethod
    def valid_month(cls, value):
        return month_valid(value)

    @model_validator(mode='after')
    def chronological(self):
        if self.current and self.endMonth:
            raise ValueError('A current position cannot have an end month.')
        if not self.current and not self.endMonth:
            raise ValueError('Enter an end month or mark this as current.')
        if self.endMonth and self.endMonth < self.startMonth:
            raise ValueError('The end month must follow the start month.')
        return self


class Experience(CareerDates):
    id: EntryId
    title: str = Field(min_length=2, max_length=120)
    organization: str = Field(min_length=2, max_length=140)
    city: str = Field(default='', max_length=80)
    description: str = Field(default='', max_length=1500)

    @field_validator('title', 'organization', 'city', 'description', mode='before')
    @classmethod
    def trim(cls, value):
        return clean_text(value)


class Education(CareerDates):
    id: EntryId
    institution: str = Field(min_length=2, max_length=140)
    qualification: str = Field(min_length=2, max_length=140)
    fieldOfStudy: str = Field(default='', max_length=140)
    description: str = Field(default='', max_length=1000)

    @field_validator('institution', 'qualification', 'fieldOfStudy', 'description', mode='before')
    @classmethod
    def trim(cls, value):
        return clean_text(value)


class Certification(Input):
    id: EntryId
    name: str = Field(min_length=2, max_length=140)
    issuer: str = Field(min_length=2, max_length=140)
    issuedMonth: Month
    expiresMonth: Month | None = None
    credentialId: str = Field(default='', max_length=120)
    credentialUrl: str = Field(default='', max_length=1000)

    @field_validator('name', 'issuer', 'credentialId', 'credentialUrl', mode='before')
    @classmethod
    def trim(cls, value):
        return clean_text(value)

    @field_validator('issuedMonth', 'expiresMonth')
    @classmethod
    def valid_month(cls, value):
        return month_valid(value)

    @field_validator('credentialUrl')
    @classmethod
    def valid_url(cls, value):
        return public_link(value)

    @model_validator(mode='after')
    def chronological(self):
        if self.expiresMonth and self.expiresMonth < self.issuedMonth:
            raise ValueError('The expiry month must follow the issue month.')
        return self


class Featured(Input):
    id: EntryId
    title: str = Field(min_length=2, max_length=120)
    url: str = Field(min_length=8, max_length=1000)
    description: str = Field(default='', max_length=500)

    @field_validator('title', 'url', 'description', mode='before')
    @classmethod
    def trim(cls, value):
        return clean_text(value)

    @field_validator('url')
    @classmethod
    def valid_url(cls, value):
        return public_link(value)


class ProfilePatch(Input):
    expectedVersion: int = Field(ge=0, strict=True)
    clientId: uuid.UUID
    about: str | None = Field(default=None, max_length=2000)
    visibility: Literal['public', 'connections'] | None = None
    experience: list[Experience] | None = Field(default=None, max_length=10)
    education: list[Education] | None = Field(default=None, max_length=6)
    certifications: list[Certification] | None = Field(default=None, max_length=10)
    featured: list[Featured] | None = Field(default=None, max_length=6)

    @field_validator('about', mode='before')
    @classmethod
    def trim(cls, value):
        return clean_text(value)

    @model_validator(mode='after')
    def distinct_entries(self):
        for section in ('experience', 'education', 'certifications', 'featured'):
            entries = getattr(self, section) or []
            if len({entry.id for entry in entries}) != len(entries):
                raise ValueError('Each profile entry needs its own reference.')
        return self


class PreferencesPatch(Input):
    connectionPrivacy: Literal['everyone', 'nobody'] | None = None
    allowEndorsements: bool | None = Field(default=None, strict=True)
    allowRecommendations: bool | None = Field(default=None, strict=True)
    networkNotifications: bool | None = Field(default=None, strict=True)


class ConnectionCommand(Input):
    action: Literal['request', 'accept', 'decline', 'cancel', 'remove']
    expectedVersion: int = Field(ge=0, strict=True)
    clientId: uuid.UUID
    note: str = Field(default='', max_length=300)

    @field_validator('note', mode='before')
    @classmethod
    def trim(cls, value):
        return clean_text(value)


class EndorsementCommand(Input):
    skill: str = Field(min_length=1, max_length=60)
    active: bool = Field(strict=True)
    clientId: uuid.UUID

    @field_validator('skill', mode='before')
    @classmethod
    def trim(cls, value):
        return clean_text(value)


class RecommendationWrite(Input):
    text: str = Field(min_length=20, max_length=2000)
    relationship: str = Field(min_length=2, max_length=100)
    clientId: uuid.UUID

    @field_validator('text', 'relationship', mode='before')
    @classmethod
    def trim(cls, value):
        return clean_text(value)


class RecommendationCommand(Input):
    action: Literal['approve', 'decline', 'retract']
    expectedVersion: int = Field(ge=1, strict=True)
    clientId: uuid.UUID


def initialize(core):
    social.initialize(core)


def preferences(u, uid):
    return {**DEFAULT_PREFERENCES, **(u.get('rp_network_preferences', uid) or {})}


def public_preferences(row):
    return {key: row[key] for key in DEFAULT_PREFERENCES}


def pair_key(left, right):
    return social.digest(json.dumps(sorted((left, right)), separators=(',', ':')))


def connection_row(u, left, right):
    return u.get('rp_network_connections', pair_key(left, right))


def live_connection(u, row):
    if not row or social.blocked(u, row['senderId'], row['recipientId']):
        return False
    if row['status'] == 'accepted':
        return True
    if row['status'] == 'pending':
        recipient = preferences(u, row['recipientId'])
        return (recipient['connectionPrivacy'] == 'everyone'
                and row.get('recipientEpoch', 0) == recipient.get('connectionEpoch', 0))
    return False


def accepted(u, left, right, generation=None):
    row = connection_row(u, left, right)
    return bool(row and row['status'] == 'accepted' and live_connection(u, row)
                and (generation is None or generation == row.get('generation', 1)))


def connection_public(u, uid, other):
    if not uid or uid == other:
        return {'status': 'self' if uid == other else 'anonymous', 'version': 0, 'canRequest': False}
    row = connection_row(u, uid, other)
    live = live_connection(u, row)
    state = ('connected' if row['status'] == 'accepted' else
             'outgoing' if row['senderId'] == uid else 'incoming') if live else 'none'
    return dict(status=state, version=row.get('version', 0) if row else 0,
                canRequest=state == 'none' and preferences(u, other)['connectionPrivacy'] == 'everyone',
                updatedAt=row.get('updatedAt') if row else None,
                note=row.get('note', '') if live and row['status'] == 'pending' else '')


def save_connection(u, row):
    u.put('rp_network_connections', row['id'], row)
    for uid, other in ((row['senderId'], row['recipientId']), (row['recipientId'], row['senderId'])):
        entry = {'id': row['id'], 'otherId': other, 'sortKey': social.sort_key(row['updatedAt'], row['id'])}
        u.put(social.lane('rp_network_connections', uid), row['id'], entry)


def change_count(u, uid, delta):
    row = u.get('rp_network_counts', uid) or {'connections': 0}
    row['connections'] = max(0, row['connections'] + delta)
    u.put('rp_network_counts', uid, row)


def disconnect(u, left, right, reason='removed'):
    """Called atomically by removal and community blocking; unblock cannot restore proof."""
    row = connection_row(u, left, right)
    if not row or row['status'] not in ('accepted', 'pending'):
        return False
    if row['status'] == 'accepted':
        change_count(u, left, -1)
        change_count(u, right, -1)
    row.update(status='removed', reason=reason, updatedAt=social.now_ms(), version=row['version'] + 1)
    save_connection(u, row)
    return True


def check_version(row, expected):
    if (row or {}).get('version', 0) != expected:
        fail('VERSION_CONFLICT', 'This item changed. Refresh before trying again.', 409)


def target_member(u, uid, other):
    member = u.get('rp_members', other)
    worker = u.get('workers', other) if not member else None
    if worker and worker.get('status') == 'approved':
        member = social.member_ensure(u, {'id': other, 'name': worker.get('name', 'Repaidian')})
    if not member or social.blocked(u, uid, other):
        fail('NOT_FOUND', 'Member unavailable.', 404)
    return member


def notify(u, recipient, sender, event):
    if preferences(u, recipient)['networkNotifications']:
        social.notify(u, recipient, sender, event, sender)


def encode_cursor(key, uid, mode, scope):
    value = [key, social.digest(uid), mode, scope]
    return base64.urlsafe_b64encode(json.dumps(value, separators=(',', ':')).encode()).decode().rstrip('=')


def decode_cursor(value, uid, mode, scope):
    if not value:
        return None
    try:
        if len(value) > 600:
            raise ValueError()
        key, actor, saved_mode, saved_scope = json.loads(base64.urlsafe_b64decode(value + '=' * (-len(value) % 4)))
        if (actor, saved_mode, saved_scope) != (social.digest(uid), mode, scope):
            raise ValueError()
        if not isinstance(key, str) or not re.fullmatch(r'[0-9]{13}:[a-f0-9]{32}', key):
            raise ValueError()
        return key
    except (ValueError, TypeError, UnicodeDecodeError):
        fail('INVALID_CURSOR', 'This page cursor belongs to another network view.', 422)


def career_profile(u, uid):
    return u.get('rp_network_profiles', uid) or dict(userId=uid, about='', visibility='public',
        experience=[], education=[], certifications=[], featured=[], version=0, updatedAt=None)


def endorsement_live(u, row, recipient_prefs=None):
    pref = recipient_prefs or preferences(u, row['recipientId'])
    member = u.get('rp_members', row['recipientId']) or {}
    return bool(row.get('active') and pref['allowEndorsements']
                and row.get('recipientEpoch', 0) == pref.get('endorsementEpoch', 0)
                and row['skill'].casefold() in {skill.strip().casefold() for skill in member.get('skills', [])}
                and accepted(u, row['authorId'], row['recipientId'], row.get('connectionGeneration')))


def recommendation_live(u, row, recipient_prefs=None):
    pref = recipient_prefs or preferences(u, row['recipientId'])
    return bool(row.get('status') in ('pending', 'approved') and pref['allowRecommendations']
                and row.get('recipientEpoch', 0) == pref.get('recommendationEpoch', 0)
                and accepted(u, row['authorId'], row['recipientId'], row.get('connectionGeneration')))


def recommendation_public(row):
    return {key: row.get(key) for key in ('id', 'authorId', 'recipientId', 'text', 'relationship',
                                         'status', 'version', 'createdAt', 'updatedAt', 'approvedAt')}


def prefetch_relationships(u, rows, viewer=None):
    """Resolve all bounded proof dependencies in batches before filtering."""
    pairs, members = [], set()
    for row in rows:
        if not row:
            continue
        left, right = row.get('authorId', row.get('senderId')), row['recipientId']
        members.update((left, right))
        pairs.append(('rp_network_connections', pair_key(left, right)))
        for actor, other in ((left, right), (right, left), (viewer, left), (left, viewer)):
            if actor and other and actor != other:
                pairs.extend((('rp_blocks', social.digest(actor + ':' + other)), ('network_blocks', actor + ':' + other)))
    pairs.extend((kind, uid) for uid in members for kind in ('rp_network_preferences', 'rp_members'))
    u.prefetch(pairs)


def proof_page(u, uid, kind, mode, cursor, limit, viewer):
    before = decode_cursor(cursor, viewer or 'guest', mode, kind + ':' + uid)
    rows = social.query(u, social.lane('rp_network_' + kind, uid), PAGE_SCAN, before)
    canonical = 'rp_network_endorsements' if kind == 'endorsements' else 'rp_network_recommendations'
    u.prefetch([(canonical, row['id']) for row in rows])
    prefetch_relationships(u, [u.get(canonical, entry['id']) for entry in rows], viewer)
    pref = preferences(u, uid)
    items, examined = [], None
    for entry in rows:
        examined = entry['sortKey']
        row = u.get(canonical, entry['id'])
        if not row:
            continue
        if kind == 'endorsements':
            live = endorsement_live(u, row, pref)
        else:
            live = recommendation_live(u, row, pref)
            if mode in ('public', 'received'):
                live = live and row['status'] == 'approved'
            elif mode == 'pending':
                live = live and row['status'] == 'pending'
        if not live or social.blocked(u, viewer, row['authorId']):
            continue
        item = ({key: row[key] for key in ('id', 'authorId', 'recipientId', 'skill', 'createdAt')}
                if kind == 'endorsements' else recommendation_public(row))
        items.append(item)
        if len(items) == limit:
            break
    ids = {item['authorId'] for item in items}
    members = social.members_for(u, ids, {'user': {'id': viewer} if viewer else None})
    more = bool(examined and (len(items) == limit or len(rows) == PAGE_SCAN))
    return dict(items=items, members=members,
                nextCursor=encode_cursor(examined, viewer or 'guest', mode, kind + ':' + uid) if more else None)


def profile_public(u, uid, viewer):
    row = career_profile(u, uid)
    can_view = row['visibility'] == 'public' or viewer == uid or bool(viewer and accepted(u, viewer, uid))
    endorsement_page = proof_page(u, uid, 'endorsements', 'public', None, 12, viewer) if can_view else {'items': [], 'members': [], 'nextCursor': None}
    member_skills = (u.get('rp_members', uid) or {}).get('skills', [])[:12]
    endorsement_page['viewerEndorsed'] = []
    if can_view and viewer and viewer != uid:
        keys = [social.digest(json.dumps([viewer, uid, skill.strip().casefold()], separators=(',', ':'))) for skill in member_skills]
        u.prefetch([('rp_network_endorsements', key) for key in keys])
        for skill, key in zip(member_skills, keys):
            endorsement = u.get('rp_network_endorsements', key)
            if endorsement and endorsement_live(u, endorsement):
                endorsement_page['viewerEndorsed'].append(skill)
    return dict(profile=row if can_view else None, profileInfoSource='member',
                connection=connection_public(u, viewer, uid),
                endorsements=endorsement_page,
                recommendations=proof_page(u, uid, 'recommendations', 'public', None, 6, viewer) if can_view else {'items': [], 'members': [], 'nextCursor': None},
                stats={'connections': (u.get('rp_network_counts', uid) or {}).get('connections', 0)})


def install(core):
    store = core.operations_store
    actor = core.repaidians_actor
    router = APIRouter(prefix='/repaidians/network', tags=['Repaidians professional network'])

    @router.get('/profile')
    def own_profile(response: Response, a=Depends(actor)):
        user = social.signed(a)
        response.headers['Cache-Control'] = 'private, no-store'
        def read(u):
            # Owners retain access to their own shared profile and privacy
            # metadata even after membership access ends.
            social.member_ensure(u, user)
            return profile_public(u, user['id'], user['id'])
        return store.run(read)

    @router.get('/members/{member_id}/profile')
    def member_profile(member_id: str, response: Response, a=Depends(actor)):
        response.headers['Cache-Control'] = 'private, no-store'
        def read(u):
            social.browse(u, a)
            uid = (a.get('user') or {}).get('id')
            target_member(u, uid, member_id)
            return profile_public(u, member_id, uid)
        return store.run(read)

    @router.patch('/profile')
    def update_profile(body: ProfilePatch, a=Depends(actor)):
        user = social.signed(a)
        def save(u):
            values = body.model_dump(mode='json', exclude_none=True, exclude={'expectedVersion', 'clientId'})
            if values == {'visibility': 'connections'}:
                social.member_ensure(u, user)
            else:
                social.professional(u, a)
            old = social.replay(u, user['id'], body, 'network-profile')
            if old:
                return old
            row = career_profile(u, user['id'])
            check_version(row, body.expectedVersion)
            social.rate(u, user['id'], 'network-profile', limit=30)
            row.update(values, version=row['version'] + 1, updatedAt=social.now_ms())
            u.put('rp_network_profiles', user['id'], row)
            return social.remember(u, user['id'], body, 'network-profile', {'profile': row})
        return store.run(save)

    @router.get('/preferences')
    def own_preferences(response: Response, a=Depends(actor)):
        user = social.signed(a)
        response.headers['Cache-Control'] = 'private, no-store'
        return store.run(lambda u: {'preferences': public_preferences(preferences(u, user['id']))})

    @router.patch('/preferences')
    def update_preferences(body: PreferencesPatch, a=Depends(actor)):
        user = social.signed(a)
        def save(u):
            social.member_ensure(u, user)
            social.rate(u, user['id'], 'network-preferences', limit=60)
            row = preferences(u, user['id'])
            changes = body.model_dump(exclude_none=True)
            for field, epoch in (('connectionPrivacy', 'connectionEpoch'), ('allowEndorsements', 'endorsementEpoch'),
                                 ('allowRecommendations', 'recommendationEpoch')):
                if field in changes and changes[field] != row[field]:
                    row[epoch] = row.get(epoch, 0) + 1
            row.update(changes)
            u.put('rp_network_preferences', user['id'], row)
            return {'preferences': public_preferences(row)}
        return store.run(save)

    @router.get('/connections')
    def connections(response: Response, mode: Literal['connections', 'incoming', 'outgoing'] = 'connections',
                    cursor: str | None = None, limit: int = Query(default=20, ge=1, le=30), a=Depends(actor)):
        user = social.signed(a)
        response.headers['Cache-Control'] = 'private, no-store'
        def read(u):
            social.browse(u, a)
            uid = user['id']
            before = decode_cursor(cursor, uid, mode, 'connections')
            rows = social.query(u, social.lane('rp_network_connections', uid), PAGE_SCAN, before)
            u.prefetch([('rp_network_connections', row['id']) for row in rows])
            prefetch_relationships(u, [u.get('rp_network_connections', entry['id']) for entry in rows], uid)
            items, examined = [], None
            for entry in rows:
                examined = entry['sortKey']
                row = u.get('rp_network_connections', entry['id'])
                if not live_connection(u, row):
                    continue
                expected = ('connections' if row['status'] == 'accepted' else 'outgoing' if row['senderId'] == uid else 'incoming')
                if mode != expected:
                    continue
                other = entry['otherId']
                items.append({'memberId': other, **connection_public(u, uid, other)})
                if len(items) == limit:
                    break
            more = bool(examined and (len(items) == limit or len(rows) == PAGE_SCAN))
            return dict(items=items, members=social.members_for(u, [row['memberId'] for row in items], a),
                        nextCursor=encode_cursor(examined, uid, mode, 'connections') if more else None,
                        connectionsCount=(u.get('rp_network_counts', uid) or {}).get('connections', 0))
        return store.run(read)

    @router.get('/members/{member_id}/connection')
    def connection(member_id: str, response: Response, a=Depends(actor)):
        user = social.signed(a)
        response.headers['Cache-Control'] = 'private, no-store'
        def read(u):
            social.browse(u, a)
            target_member(u, user['id'], member_id)
            return {'connection': connection_public(u, user['id'], member_id)}
        return store.run(read)

    @router.post('/members/{member_id}/connection')
    def connection_command(member_id: str, body: ConnectionCommand, a=Depends(actor)):
        user = social.signed(a)
        def save(u):
            uid = user['id']
            if uid == member_id:
                fail('SELF_CONNECTION', 'Choose another member to connect with.', 422)
            if body.action in ('cancel', 'decline', 'remove'):
                social.member_ensure(u, user)
            else:
                social.professional(u, a)
            target_member(u, uid, member_id)
            if body.action in ('request', 'accept') and not social.capabilities(u, {'user': {'id': member_id}})['professional']:
                fail('NOT_FOUND', 'Professional profile unavailable.', 404)
            prior = social.replay(u, uid, body, 'network-connection', member_id)
            if prior:
                return prior
            row = connection_row(u, uid, member_id)
            check_version(row, body.expectedVersion)
            social.rate(u, uid, 'network-connection', limit=30)
            stamp = social.now_ms()
            if body.action == 'request':
                pref = preferences(u, member_id)
                if pref['connectionPrivacy'] != 'everyone':
                    fail('CONNECTION_PRIVATE', 'This member is not accepting connection requests.', 403)
                if live_connection(u, row):
                    fail('CONNECTION_EXISTS', 'A connection or invitation already exists.', 409)
                if (row and row['status'] == 'declined' and row['senderId'] == uid
                        and stamp - row['updatedAt'] < 86400000):
                    fail('INVITATION_COOLDOWN', 'Wait 24 hours before inviting a member who declined your request.', 429)
                row = dict(id=pair_key(uid, member_id), senderId=uid, recipientId=member_id,
                           status='pending', note=body.note, createdAt=stamp, updatedAt=stamp,
                           version=(row or {}).get('version', 0) + 1,
                           generation=(row or {}).get('generation', 0) + 1,
                           recipientEpoch=pref.get('connectionEpoch', 0))
                save_connection(u, row)
                notify(u, member_id, uid, 'connection')
            elif body.action == 'remove':
                if not row or row['status'] != 'accepted':
                    fail('CONNECTION_UNAVAILABLE', 'There is no accepted connection to remove.', 409)
                disconnect(u, uid, member_id)
            else:
                if not row or row['status'] != 'pending' or not live_connection(u, row):
                    fail('INVITATION_UNAVAILABLE', 'This invitation is no longer available.', 409)
                required = row['senderId'] if body.action == 'cancel' else row['recipientId']
                if uid != required:
                    fail('INVITATION_FORBIDDEN', 'Only the invitation recipient can respond; only its sender can cancel.', 403)
                row.update(status={'accept': 'accepted', 'decline': 'declined', 'cancel': 'cancelled'}[body.action],
                           updatedAt=stamp, version=row['version'] + 1)
                save_connection(u, row)
                if body.action == 'accept':
                    change_count(u, uid, 1)
                    change_count(u, member_id, 1)
                    notify(u, member_id, uid, 'connection_accepted')
            result = {'connection': connection_public(u, uid, member_id)}
            return social.remember(u, uid, body, 'network-connection', result, member_id)
        return store.run(save)

    @router.get('/members/{member_id}/endorsements')
    def endorsements(member_id: str, response: Response, cursor: str | None = None,
                     limit: int = Query(default=20, ge=1, le=30), a=Depends(actor)):
        response.headers['Cache-Control'] = 'private, no-store'
        def read(u):
            social.browse(u, a)
            uid = (a.get('user') or {}).get('id')
            target_member(u, uid, member_id)
            profile = career_profile(u, member_id)
            if profile['visibility'] == 'connections' and uid != member_id and not (uid and accepted(u, uid, member_id)):
                return {'items': [], 'members': [], 'nextCursor': None}
            return proof_page(u, member_id, 'endorsements', 'public', cursor, limit, uid)
        return store.run(read)

    @router.put('/members/{member_id}/endorsements')
    def endorsement_command(member_id: str, body: EndorsementCommand, a=Depends(actor)):
        user = social.signed(a)
        def save(u):
            uid = user['id']
            social.professional(u, a) if body.active else social.member_ensure(u, user)
            member = target_member(u, uid, member_id)
            if uid == member_id:
                fail('SELF_ENDORSEMENT', 'An endorsement must come from another connection.', 422)
            prior = social.replay(u, uid, body, 'network-endorsement', member_id)
            if prior:
                return prior
            pref = preferences(u, member_id)
            skill = next((skill for skill in member.get('skills', []) if skill.strip().casefold() == body.skill.casefold()), None)
            key = social.digest(json.dumps([uid, member_id, body.skill.casefold()], separators=(',', ':')))
            row = u.get('rp_network_endorsements', key)
            if body.active:
                if not accepted(u, uid, member_id):
                    fail('CONNECTION_REQUIRED', 'Connect with this member before endorsing a skill.', 403)
                if not pref['allowEndorsements']:
                    fail('ENDORSEMENTS_PRIVATE', 'This member is not accepting skill endorsements.', 403)
                if not skill:
                    fail('SKILL_UNAVAILABLE', 'Endorse a skill currently listed on this member’s profile.', 422)
            social.rate(u, uid, 'network-endorsement', limit=60)
            stamp = social.now_ms()
            connection = connection_row(u, uid, member_id)
            row = dict(id=key, authorId=uid, recipientId=member_id, skill=skill or body.skill,
                       active=body.active, createdAt=(row or {}).get('createdAt', stamp), updatedAt=stamp,
                       recipientEpoch=pref.get('endorsementEpoch', 0),
                       connectionGeneration=(connection or {}).get('generation', 0))
            u.put('rp_network_endorsements', key, row)
            u.put(social.lane('rp_network_endorsements', member_id), key,
                  {'id': key, 'sortKey': social.sort_key(stamp, key)})
            return social.remember(u, uid, body, 'network-endorsement', {'active': body.active, 'skill': row['skill']}, member_id)
        return store.run(save)

    @router.get('/members/{member_id}/recommendations')
    def member_recommendations(member_id: str, response: Response, cursor: str | None = None,
                               limit: int = Query(default=20, ge=1, le=30), a=Depends(actor)):
        response.headers['Cache-Control'] = 'private, no-store'
        def read(u):
            social.browse(u, a)
            uid = (a.get('user') or {}).get('id')
            target_member(u, uid, member_id)
            profile = career_profile(u, member_id)
            if profile['visibility'] == 'connections' and uid != member_id and not (uid and accepted(u, uid, member_id)):
                return {'items': [], 'members': [], 'nextCursor': None}
            return proof_page(u, member_id, 'recommendations', 'public', cursor, limit, uid)
        return store.run(read)

    @router.post('/members/{member_id}/recommendations', status_code=201)
    def write_recommendation(member_id: str, body: RecommendationWrite, a=Depends(actor)):
        user = social.signed(a)
        def save(u):
            uid = user['id']
            social.professional(u, a)
            target_member(u, uid, member_id)
            if uid == member_id or not accepted(u, uid, member_id):
                fail('CONNECTION_REQUIRED', 'Recommendations must come from an accepted connection.', 403)
            pref = preferences(u, member_id)
            if not pref['allowRecommendations']:
                fail('RECOMMENDATIONS_PRIVATE', 'This member is not accepting recommendations.', 403)
            prior = social.replay(u, uid, body, 'network-recommendation', member_id)
            if prior:
                return prior
            key = social.digest(json.dumps([uid, member_id, 'recommendation'], separators=(',', ':')))
            row = u.get('rp_network_recommendations', key)
            if row and recommendation_live(u, row):
                fail('RECOMMENDATION_EXISTS', 'You already have a recommendation for this connection. Retract it before replacing it.', 409)
            social.rate(u, uid, 'network-recommendation', limit=12)
            stamp = social.now_ms()
            row = dict(id=key, authorId=uid, recipientId=member_id, text=body.text, relationship=body.relationship,
                       status='pending', createdAt=stamp, updatedAt=stamp, version=(row or {}).get('version', 0) + 1,
                       recipientEpoch=pref.get('recommendationEpoch', 0),
                       connectionGeneration=connection_row(u, uid, member_id)['generation'])
            u.put('rp_network_recommendations', key, row)
            for base, person in (('rp_network_recommendations', member_id), ('rp_network_written', uid)):
                u.put(social.lane(base, person), key, {'id': key, 'sortKey': social.sort_key(stamp, key)})
            notify(u, member_id, uid, 'recommendation')
            return social.remember(u, uid, body, 'network-recommendation', {'recommendation': recommendation_public(row)}, member_id)
        return store.run(save)

    @router.put('/recommendations/{recommendation_id}')
    def recommendation_command(recommendation_id: str, body: RecommendationCommand, a=Depends(actor)):
        user = social.signed(a)
        def save(u):
            uid = user['id']
            social.professional(u, a) if body.action == 'approve' else social.member_ensure(u, user)
            row = u.get('rp_network_recommendations', recommendation_id)
            if not row or uid not in (row['authorId'], row['recipientId']):
                fail('NOT_FOUND', 'Recommendation unavailable.', 404)
            required = row['authorId'] if body.action == 'retract' else row['recipientId']
            if uid != required:
                fail('RECOMMENDATION_FORBIDDEN', 'Only the recipient can approve or decline; only the writer can retract.', 403)
            prior = social.replay(u, uid, body, 'network-recommendation-decision', recommendation_id)
            if prior:
                return prior
            check_version(row, body.expectedVersion)
            if body.action == 'approve' and (row['status'] != 'pending' or not recommendation_live(u, row)):
                fail('RECOMMENDATION_UNAVAILABLE', 'This recommendation is no longer available for approval.', 409)
            if body.action == 'decline' and row['status'] not in ('pending', 'approved'):
                fail('RECOMMENDATION_UNAVAILABLE', 'This recommendation is already hidden.', 409)
            social.rate(u, uid, 'network-recommendation-decision', limit=60)
            stamp = social.now_ms()
            row.update(status={'approve': 'approved', 'decline': 'declined', 'retract': 'retracted'}[body.action],
                       updatedAt=stamp, version=row['version'] + 1)
            if body.action == 'approve':
                row['approvedAt'] = stamp
            u.put('rp_network_recommendations', recommendation_id, row)
            for base, person in (('rp_network_recommendations', row['recipientId']), ('rp_network_written', row['authorId'])):
                u.put(social.lane(base, person), recommendation_id, {'id': recommendation_id, 'sortKey': social.sort_key(stamp, recommendation_id)})
            return social.remember(u, uid, body, 'network-recommendation-decision', {'recommendation': recommendation_public(row)}, recommendation_id)
        return store.run(save)

    @router.get('/recommendations')
    def own_recommendations(response: Response, mode: Literal['received', 'pending', 'written'] = 'received',
                            cursor: str | None = None, limit: int = Query(default=20, ge=1, le=30), a=Depends(actor)):
        user = social.signed(a)
        response.headers['Cache-Control'] = 'private, no-store'
        def read(u):
            social.browse(u, a)
            uid = user['id']
            if mode != 'written':
                return proof_page(u, uid, 'recommendations', mode, cursor, limit, uid)
            before = decode_cursor(cursor, uid, mode, 'written')
            rows = social.query(u, social.lane('rp_network_written', uid), PAGE_SCAN, before)
            u.prefetch([('rp_network_recommendations', row['id']) for row in rows])
            prefetch_relationships(u, [u.get('rp_network_recommendations', entry['id']) for entry in rows], uid)
            items, examined = [], None
            for entry in rows:
                examined = entry['sortKey']
                row = u.get('rp_network_recommendations', entry['id'])
                if not row or not recommendation_live(u, row):
                    continue
                items.append(recommendation_public(row))
                if len(items) == limit:
                    break
            more = bool(examined and (len(items) == limit or len(rows) == PAGE_SCAN))
            return dict(items=items, members=social.members_for(u, [row['recipientId'] for row in items], a),
                        nextCursor=encode_cursor(examined, uid, mode, 'written') if more else None)
        return store.run(read)

    core.app.include_router(router)
