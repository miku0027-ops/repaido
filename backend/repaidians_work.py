"""Account-scoped work discovery, consented connections and durable contract updates.

Hot reads use bounded audience lanes and re-resolve native records. Ranking is
explainable; it does not manufacture jobs or infer protected demographic traits.
All delivery decisions and IST-day quotas commit with the notification/outbox.
"""
import base64
import hashlib
import json
import math
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from pydantic import Field

from operations import Input, fail
from repaidians import TRADES, IST, blocked, browse, digest, lane, member_ensure, member_public, now_ms, query, signed, sort_key
from repaidians_opportunities import native_scan, trade_for

PAGE_SCAN = 64
DEFAULTS = {'personalizedDiscovery': False, 'contractUpdates': False, 'sharePlacements': False, 'shareSalary': False}
EVENT_WEIGHTS = {'search': 1.0, 'view': .25, 'save': 2.0, 'apply': 3.0}
HALF_LIFE_MS = 14 * 86400000
ID = r'^[A-Za-z0-9_-]{1,100}$'
STOP_WORDS = {'service', 'services', 'work', 'worker', 'and', 'the', 'for', 'contract', 'contracts', 'project', 'projects', 'find'}
RANK_VERSION = 'work-v2'
WORK_TRADE_INDEX_VERSION = 'work-trade-v2'


class Preferences(Input):
    personalizedDiscovery: bool | None = Field(default=None, strict=True)
    contractUpdates: bool | None = Field(default=None, strict=True)
    sharePlacements: bool | None = Field(default=None, strict=True)
    shareSalary: bool | None = Field(default=None, strict=True)


class Behavior(Input):
    eventId: uuid.UUID
    trade: Literal['cleaning', 'electrician', 'plumber', 'ac', 'pest', 'carpenter', 'civil', 'spares']
    type: Literal['search', 'view', 'apply', 'save']
    query: str = Field(default='', max_length=120)
    sourceId: str = Field(default='', max_length=100)


class Watch(Input):
    active: bool = Field(strict=True)


class Congratulations(Input):
    clientId: uuid.UUID
    message: Literal['congratulations', 'good_luck', 'well_deserved']


def normalized(value):
    return ' '.join(str(value or '').casefold().split())[:120]


def tokens(value):
    return list(dict.fromkeys(re.findall(r'[\w]{2,30}', normalized(value))))[:12]


def channel(kind, trade='all', city='', word=''):
    return 'rp_work_' + kind + '_' + digest(json.dumps([trade, normalized(city), normalized(word)], separators=(',', ':')))


def preferences(u, uid):
    return {**DEFAULTS, **((u.get('rp_members', uid) or {}).get('workPreferences') or {})}


def initialize(core):
    """The shared social sort index is sufficient for every work audience lane."""
    from repaidians import initialize as social_initialize
    social_initialize(core)
    if not core.USE_FIRESTORE:
        with core.db() as conn:
            conn.execute("CREATE INDEX IF NOT EXISTS operation_work_active_key ON operation_records(kind,json_extract(body,'$.active'),id)")


def active_query(u, kind, limit=32, after=''):
    """Only live audience/queue references, with no inactive-history traversal."""
    limit = max(1, min(limit, PAGE_SCAN))
    if u.tx is not None:
        from google.cloud.firestore_v1.field_path import FieldPath
        q = u.core.fs_collection('ops_' + kind).where('active', '==', True).order_by(FieldPath.document_id()).limit(limit)
        if after:
            q = q.start_after({FieldPath.document_id(): u.core.fs_doc('ops_' + kind, after)})
        rows = {snapshot.id: snapshot.to_dict() for snapshot in q.stream(transaction=u.tx)}
    else:
        rows = {row['id']: json.loads(row['body']) for row in u.conn.execute("SELECT id,body FROM operation_records WHERE kind=? AND json_extract(body,'$.active')=1 AND id>? ORDER BY id LIMIT ?", (kind, after, limit))}
    for (pending_kind, key), value in u.pending.items():
        if pending_kind == kind and key > after:
            if value.get('active'):
                rows[key] = value
            else:
                rows.pop(key, None)
    selected = sorted(rows.items())[:limit]
    u.fetched.update({(kind, key): value for key, value in selected})
    return [value for key, value in selected]


def candidate_keyset(u, trade, city='', after='', limit=32):
    if trade not in TRADES:
        return []
    return active_query(u, channel('ready', trade, city), min(64, max(1, limit)), after)


def _decayed(weight, timestamp, now):
    return float(weight) * math.exp(-math.log(2) * max(0, now - timestamp) / HALF_LIFE_MS)


def interests(u, uid, now=None):
    now = now or now_ms()
    member = u.get('rp_members', uid) or {}
    pref = preferences(u, uid)
    scores = {trade: 0.0 for trade in TRADES}
    signals = u.get('rp_work_signals', uid) or {}
    if pref['personalizedDiscovery']:
        for trade, value in signals.get('trades', {}).items():
            if trade in scores:
                scores[trade] += min(30, _decayed(value.get('weight', 0), value.get('at', now), now))
    profile = member.get('trade')
    if profile in scores:
        scores[profile] += 3.0
    for skill in member.get('skills', [])[:12]:
        inferred = trade_for(skill)
        if inferred in scores and inferred != 'spares':
            scores[inferred] += .5
    ordered = sorted(TRADES, key=lambda trade: (-scores[trade], TRADES.index(trade)))
    return {'trades': [{'trade': trade, 'weight': round(scores[trade], 3),
                       'reason': 'Your profile trade' if trade == profile else 'Recent work interests' if scores[trade] > 0 else 'Explore this trade'} for trade in ordered],
            'personalized': pref['personalizedDiscovery']}


def keyword_weights(u, uid, now=None):
    """At most 24 retained token groups; no raw search string is needed."""
    if not preferences(u, uid)['personalizedDiscovery']:
        return {}
    stamp = now or now_ms()
    signals = u.get('rp_work_signals', uid) or {}
    values = {}
    for group in signals.get('terms', [])[:24]:
        weight = _decayed(group.get('weight', 1), group.get('at', stamp), stamp)
        for word in group.get('tokens', [])[:12]:
            if word not in STOP_WORDS and not word.isdigit():
                values[word] = min(30, values.get(word, 0) + weight)
    return dict(sorted(values.items(), key=lambda pair: (-pair[1], pair[0]))[:24])


def keyword_similarity(weights, text):
    matched = set(tokens(text)) & set(weights)
    total = sum(weights.values())
    return min(1, sum(weights[word] for word in matched) / total) if total else 0


def _source_fields(kind, row):
    from contract_work import hiring_trade
    if kind == 'contract_projects':
        hiring = row.get('hiring') or {}
        trade = hiring_trade(hiring, row.get('title', ''))
        return trade, hiring.get('city', ''), tokens(' '.join([hiring.get('city', ''), trade or '', hiring.get('sector', ''), row.get('title', ''), *hiring.get('skills', [])]))
    if kind == 'contract_tenders':
        trade = hiring_trade({'sector': row.get('sector', ''), 'skills': row.get('skills') or []}, row.get('title', ''))
        return trade, row.get('city', ''), tokens(row.get('city', '') + ' ' + row.get('sector', '') + ' ' + row.get('title', ''))
    return trade_for(row.get('sector')), row.get('city', ''), tokens(row.get('city', '') + ' ' + row.get('sector', '') + ' ' + row.get('name', ''))


def index_record(u, kind, key, row):
    """Called by Unit.put. References never authorize visibility by themselves."""
    if kind == 'rp_follows':
        follower, member = row.get('from'), row.get('to')
        if follower and member:
            u.put(lane('rp_work_followers', member), follower, {**row, 'id': follower, 'sortKey': follower})
        return
    if kind == 'workers':
        profile = u.get('contract_profiles', key)
        if profile:
            index_record(u, 'contract_profiles', key, profile)
        return
    if kind == 'rp_members':
        old = u.get('rp_work_ready_index', key) or {}
        ready_channels = {channel('ready', row.get('trade'), row.get('city', '')), channel('ready', row.get('trade'), '')} if row.get('workStatus') in ('available', 'open_to_work') and row.get('trade') in TRADES else set()
        for old_channel in set(old.get('channels', [])) - ready_channels:
            u.put(old_channel, key, {'id': key, 'sortKey': key, 'active': False})
        if set(old.get('channels', [])) != ready_channels:
            for current in ready_channels:
                u.put(current, key, {'id': key, 'sortKey': key, 'active': True})
            u.put('rp_work_ready_index', key, {'channels': sorted(ready_channels)})
        if preferences(u, key)['contractUpdates']:
            u.put('rp_work_update_recipients', key, {'id': key, 'sortKey': key, 'active': True})
        elif u.get('rp_work_update_recipients', key):
            u.put('rp_work_update_recipients', key, {'id': key, 'sortKey': key, 'active': False})
        previous_preferences = u.get('rp_work_member_preferences', key) or {}
        sharing = preferences(u, key)['sharePlacements']
        if sharing and not previous_preferences.get('sharePlacements'):
            # Late opt-in also permits already accepted placements; schedule a
            # bounded member keyset in the worker, never synchronous fan-out.
            u.put('rp_work_member_share_queue', key, {'id': key, 'sortKey': key, 'active': True, 'after': ''})
        if previous_preferences.get('sharePlacements') != sharing:
            u.put('rp_work_member_preferences', key, {'sharePlacements': sharing})
        # Sharing changes are enforced at every detail read/delivery, never cached.
        return
    kinds = {'contract_projects': 'jobs', 'contract_tenders': 'contracts', 'contract_profiles': 'companies'}
    if kind not in kinds:
        return
    name = kinds[kind]
    trade, city, words = _source_fields(kind, row)
    channels = {channel(name, 'all', city), channel(name, 'all', '')}
    if trade in TRADES:
        channels.update((channel(name, trade, city), channel(name, trade, '')))
    channels.update(channel(name, 'all', '', word) for word in words[:8])
    if kind in ('contract_projects', 'contract_tenders'):
        sector = (row.get('hiring') or {}).get('sector', '') if kind == 'contract_projects' else row.get('sector', '')
        if normalized(sector):
            channels.update((channel(name + '_sector', 'all', city, sector), channel(name + '_sector', 'all', '', sector)))
    if row.get('owner_id'):
        channels.add(lane('rp_work_owned_' + name, row['owner_id']))
    previous = u.get('rp_work_index', name + ':' + key) or {}
    current_time = time.time()
    if kind == 'contract_projects':
        from contract_work import team_capacity
        hiring = row.get('hiring') or {}
        capacity = team_capacity(row)
        awarded = not row.get('tender_id') or bool(row.get('awarded_at'))
        active = trade in TRADES and awarded and row.get('status') in ('planning', 'active') and row.get('ends_at', 0) > current_time and hiring.get('status') == 'open' and hiring.get('deadline', 0) > current_time and bool(capacity['vacancies'])
    elif kind == 'contract_tenders':
        active = row.get('source_kind') != 'customer_custom_query' and row.get('status') == 'open' and row.get('ends_at', 0) > current_time
    else:
        worker = u.get('workers', key) or {}
        active = worker.get('status') == 'approved' and bool(worker.get('contractor_verified'))
    entry = {'id': key, 'sortKey': key, 'active': active}
    for old in set(previous.get('channels', [])) - channels:
        u.put(old, key, {**entry, 'active': False})
    if set(previous.get('channels', [])) != channels or previous.get('active') != active:
        for current in channels:
            u.put(current, key, entry)
        u.put('rp_work_index', name + ':' + key, {'channels': sorted(channels), 'active': active})
    if kind == 'contract_projects':
        # One queue record per changed project, not one synchronous write per follower.
        fingerprint = digest(json.dumps([row.get('status'),[[m.get('id'),m.get('worker_id'),m.get('status')] for m in row.get('team',[])]],sort_keys=True))
        state = u.get('rp_work_project_queue', key) or {}
        if state.get('fingerprint') != fingerprint:
            u.put('rp_work_project_queue', key, {'id': key, 'sortKey': key, 'fingerprint': fingerprint, 'offset': 0, 'active': True})


def _cursor(value, uid, filters):
    binding = digest(json.dumps([uid, filters], sort_keys=True, separators=(',', ':')))
    if not value:
        return '', binding
    try:
        data = json.loads(base64.b64decode(value + '=' * (-len(value) % 4), altchars=b'-_', validate=True))
        if data.get('v') != 1 or data.get('binding') != binding or not re.fullmatch(ID, data.get('after', '')):
            raise ValueError()
        return data['after'], binding
    except (ValueError, TypeError, json.JSONDecodeError):
        fail('INVALID_CURSOR', 'Refresh this search after changing accounts or filters.', 422)


def _next(after, binding):
    return base64.urlsafe_b64encode(json.dumps({'v': 1, 'after': after, 'binding': binding}, separators=(',', ':')).encode()).decode().rstrip('=')


def _profile_binding(u, uid):
    member = u.get('rp_members', uid) or {}
    pref = preferences(u, uid)
    profile = {key: member.get(key) for key in ('trade', 'city', 'skills', 'experienceYears', 'workStatus')}
    revision = (u.get('rp_work_signals', uid) or {}).get('revision', 0) if pref['personalizedDiscovery'] else 0
    return {'profile': digest(json.dumps(profile, sort_keys=True)), 'personalized': pref['personalizedDiscovery'],
            'signalsRevision': revision, 'rankVersion': RANK_VERSION}


def _safe_owner(u, uid, owner):
    return bool(owner and not blocked(u, uid, owner) and not (u.get('network_suspensions', owner) or {}).get('active'))


def job(u, key, uid, member=None, filters=None):
    from contract_work import public_hiring, identifier, hiring_trade, team_capacity
    p = u.get('contract_projects', key)
    if not p or p.get('owner_id') == uid or not _safe_owner(u, uid, p.get('owner_id')):
        return None
    from contract_work import hiring_source_authorized
    if not hiring_source_authorized(u, p):
        return None
    h = p.get('hiring') or {}
    now = time.time()
    capacity = team_capacity(p)
    if (p.get('tender_id') and not p.get('awarded_at')) or p.get('status') not in ('planning', 'active') or p.get('ends_at', 0) <= now or h.get('status') != 'open' or h.get('deadline', 0) <= now or not capacity['vacancies']:
        return None
    member = member or u.get('rp_members', uid) or {}
    filters = filters or {}
    trade = hiring_trade(h, p.get('title', ''))
    if trade not in TRADES:
        return None
    skills = h.get('skills', [])[:20]
    member_skills = set(tokens(' '.join(member.get('skills', [])[:12])))
    requested_skills = set(tokens(' '.join(skills)))
    profile_trade = member.get('trade')
    # Relevant profile jobs never get padded with unrelated trades. Explicit
    # searches are allowed to explore a chosen category without changing profile.
    selected = filters.get('trade', 'all')
    if selected != 'all' and trade != selected:
        return None
    if selected == 'all' and not filters.get('query') and profile_trade in TRADES and trade != profile_trade and not member_skills.intersection(requested_skills):
        return None
    years = filters.get('experience')
    if years is None:
        years = member.get('experienceYears', 0)
    if h.get('minimum_experience', 0) > years:
        return None
    worker = u.get('workers', uid) or {}
    if h.get('worker_role') == 'specialist' and worker.get('role') != 'specialist':
        return None
    if h.get('worker_role') == 'technician' and worker.get('role') != 'technician':
        return None
    if filters.get('city') and normalized(h.get('city')) != normalized(filters['city']):
        return None
    if filters.get('sector') and normalized(h.get('sector')) != normalized(filters['sector']):
        return None
    if h.get('daily_rate_paise', 0) < filters.get('minimumPayPaise', 0):
        return None
    source = p.get('source_kind', 'commercial_project')
    work_type = 'private_request' if source == 'private_request' else 'project'
    if filters.get('workType', 'all') not in ('all', work_type):
        return None
    close_days = filters.get('closesWithinDays', 0)
    if close_days and h.get('deadline', 0) > now + close_days * 86400:
        return None
    search = tokens(filters.get('query', ''))
    haystack = set(tokens(' '.join([p.get('title', ''), h.get('summary', ''), h.get('sector', ''), h.get('city', ''), *skills])))
    if search and not all(word in haystack for word in search):
        return None
    reasons = []
    score = 0.0
    if trade == profile_trade:
        score += .45; reasons.append('Matches your profile trade')
    overlap = len(member_skills & requested_skills) / max(1, len(requested_skills))
    if overlap:
        score += .25 * overlap; reasons.append('Matches your listed skills')
    if normalized(member.get('city')) and normalized(member.get('city')) == normalized(h.get('city')):
        score += .15; reasons.append('In your profile city')
    score += .1 * min(1, years / max(1, h.get('minimum_experience', 0) + 1))
    reasons.append('Experience requirement met')
    pref = preferences(u, uid)
    if pref['personalizedDiscovery']:
        signals = u.get('rp_work_signals', uid) or {}
        signal = signals.get('trades', {}).get(trade) or {}
        relevance = min(1, _decayed(signal.get('weight', 0), signal.get('at', now_ms()), now_ms()) / 10)
        keyword_match = keyword_similarity(keyword_weights(u, uid), ' '.join([p.get('title', ''), h.get('sector', ''), *skills]))
        if relevance or keyword_match:
            score += .025 * relevance + .025 * keyword_match; reasons.append('Related to your recent work interests')
    card = {'id': key, 'title': p.get('title', ''), 'trade': trade, 'city': h.get('city', ''), 'sourceKind': source,
            'workType': work_type, 'ownerId': p['owner_id'], 'ownerName': p.get('owner_name', ''), 'skills': skills,
            'minimumExperience': h.get('minimum_experience', 0), 'dailyRatePaise': h.get('daily_rate_paise'),
            'openings': capacity['vacancies'], 'pendingOffers': capacity['pendingOffers'], 'availableToOffer': capacity['availableToOffer'], 'deadline': int(h['deadline'] * 1000),
            'startsAt': int(p.get('starts_at', 0) * 1000), 'endsAt': int(p['ends_at'] * 1000),
            'match': {'score': round(min(1, score), 4), 'reasons': reasons}, 'details': public_hiring(p)}
    application = u.get('project_applications', identifier('application', uid, key))
    if application and application.get('worker_id') == uid and application.get('project_id') == key:
        from contract_work import application_projection
        card['application'] = {'id': application['id'], 'status': application_projection(application,p).get('status', '')}
    return card


def _candidates(u, kind, filters, member, after, limit=PAGE_SCAN):
    search = tokens(filters.get('query', ''))
    trade = filters.get('trade', 'all')
    if trade == 'all' and kind == 'jobs' and not search:
        trade = member.get('trade') if member.get('trade') in TRADES else 'all'
    source = channel(kind, 'all', '', search[0]) if search else channel(kind, trade, filters.get('city', ''))
    if filters.get('sector'):
        source = channel(kind + '_sector', 'all', filters.get('city', ''), filters['sector'])
    return active_query(u, source, limit, after)


def jobs_page(u, uid, filters, cursor=None, limit=20):
    member = u.get('rp_members', uid) or {}
    after, binding = _cursor(cursor, uid, {**filters, **_profile_binding(u, uid)})
    rows = _candidates(u, 'jobs', filters, member, after)
    u.prefetch([('contract_projects', row['id']) for row in rows])
    projects = [u.get('contract_projects', row['id']) for row in rows]
    u.prefetch([('workers', p['owner_id']) for p in projects if p] + [('network_suspensions', p['owner_id']) for p in projects if p])
    selected = []; examined = None
    for row in rows:
        examined = row['sortKey']
        card = job(u, row['id'], uid, member, filters) if row.get('active') else None
        if card:
            selected.append(card)
            if len(selected) == limit:
                break
    selected.sort(key=lambda card: (-card['match']['score'], card['id']))
    more = bool(examined and (len(selected) == limit or len(rows) == PAGE_SCAN))
    pref = preferences(u, uid)
    return {'items': selected, 'nextCursor': _next(examined, binding) if more else None,
            'personalized': pref['personalizedDiscovery'], 'preferences': pref, 'rankingScope': 'page', 'rankingVersion': RANK_VERSION}


def contract(u, tid, uid):
    from contract_work import public_tender, hiring_trade
    if not re.fullmatch(ID, str(tid)):
        return None
    row = u.get('contract_tenders', tid)
    if not row or not _safe_owner(u, uid, row.get('owner_id')):
        return None
    public = public_tender(row, time.time())
    if not public:
        return None
    trade = hiring_trade({'sector': row.get('sector', ''), 'skills': row.get('skills') or []}, row.get('title', ''))
    weighting = next((entry['weight'] for entry in interests(u, uid)['trades'] if entry['trade'] == trade), 0)
    keyword_match = keyword_similarity(keyword_weights(u, uid), row.get('title', '') + ' ' + row.get('sector', ''))
    score = min(1, .5 * min(1, weighting / 10) + .5 * keyword_match)
    return {**public, 'trade': trade, 'watched': bool((u.get(lane('rp_work_watches', uid), tid) or {}).get('active')),
            'match': {'score': round(score, 3), 'reasons': [*(['Related to your work interests'] if weighting else []), *(['Matches your recent search terms'] if keyword_match else [])] or ['Published contract']}}


def contracts_page(u, uid, filters, cursor=None, limit=20):
    after, binding = _cursor(cursor, uid, {**filters, **_profile_binding(u, uid)})
    rows = _candidates(u, 'contracts', filters, u.get('rp_members', uid) or {}, after)
    u.prefetch([('contract_tenders', row['id']) for row in rows])
    items = []; examined = None
    for row in rows:
        examined = row['sortKey']
        card = contract(u, row['id'], uid) if row.get('active') else None
        if not card or (filters.get('trade', 'all') != 'all' and card['trade'] != filters['trade']) or (filters.get('city') and normalized(card['city']) != normalized(filters['city'])):
            continue
        if filters.get('sector') and normalized(card['sector']) != normalized(filters['sector']):
            continue
        if filters.get('query') and not all(word in tokens(card['title'] + ' ' + card['sector'] + ' ' + card['city']) for word in tokens(filters['query'])):
            continue
        items.append(card)
        if len(items) == limit:
            break
    items.sort(key=lambda card: (-card['match']['score'], card['deadline'], card['id']))
    pref = preferences(u, uid)
    return {'items': items, 'nextCursor': _next(examined, binding) if examined and (len(items) == limit or len(rows) == PAGE_SCAN) else None,
            'personalized': pref['personalizedDiscovery'], 'preferences': pref}


def company(u, cid, uid):
    if not re.fullmatch(ID, str(cid)):
        return None
    profile = u.get('contract_profiles', cid)
    worker = u.get('workers', cid) or {}
    if not profile or worker.get('status') != 'approved' or not worker.get('contractor_verified') or not _safe_owner(u, uid, cid):
        return None
    return {**{key: profile.get(key, '') for key in ('name', 'city', 'sector', 'scope')}, 'id': cid, 'reviewed': True}


def placement(u, pid, uid):
    if not re.fullmatch(ID, str(pid)):
        return None
    ref = u.get('rp_work_placements', pid)
    if not ref:
        return None
    project = u.get('contract_projects', ref['projectId'])
    member = u.get('rp_members', ref['memberId'])
    if not project or not member or not preferences(u, member['id'])['sharePlacements']:
        return None
    owner = project.get('owner_id')
    if not _safe_owner(u, uid, owner) or not _safe_owner(u, uid, member['id']):
        return None
    from contract_work import hiring_source_authorized
    if not hiring_source_authorized(u, project) or project.get('status') in ('cancelled',):
        return None
    seat = next((seat for seat in project.get('team', []) if seat.get('id') == ref['seatId'] and seat.get('worker_id') == member['id'] and seat.get('status') == 'accepted'), None)
    if not seat:
        return None
    card = {'id': pid, 'member': member_public(u, member), 'ownerId': owner, 'ownerName': project.get('owner_name', ''),
            'projectId': project['id'], 'projectTitle': project.get('title', ''), 'role': seat.get('role', 'member'),
            'city': (project.get('hiring') or {}).get('city', ''), 'startsAt': int(project.get('starts_at', 0) * 1000),
            'endsAt': int(project.get('ends_at', 0) * 1000), 'congratulated': bool(u.get('rp_work_congratulations', digest(uid + ':' + pid)))}
    if preferences(u, member['id'])['shareSalary']:
        card['dailyRatePaise'] = seat.get('daily_rate_paise', 0)
    return card


def _connections(u, cid, uid):
    rows = query(u, lane('rp_work_company_placements', cid), 32, descending=False)
    cards = []
    for row in rows:
        card = placement(u, row['id'], uid)
        if not card:
            continue
        project=u.get('contract_projects',card['projectId']) or {}
        if project.get('status') in ('completed','cancelled') or project.get('ends_at',0)<=time.time():continue
        member_id = card['member']['id']
        connected = member_id == uid or (u.get('rp_follows', digest(uid + ':' + member_id)) or {}).get('active') or (u.get('rp_follows', digest(member_id + ':' + uid)) or {}).get('active')
        if connected:
            cards.append({key: card[key] for key in ('member', 'id', 'projectTitle', 'role', 'city', 'startsAt', 'endsAt')})
    return [{'placementId': card.pop('id'), **card} for card in cards[:12]]


def emit(u, recipient, sender, event, target, title, body, event_key):
    """Deterministic notification and outbox in the same transaction."""
    if recipient == sender or blocked(u, recipient, sender):
        return False
    member = u.get('rp_members', recipient) or {}
    setting = 'contractUpdates' if event == 'contract_update' else 'applicationNotifications' if event == 'application_update' else 'placementNotifications'
    if event == 'contract_update' and not preferences(u, recipient)['contractUpdates']:
        return False
    if not (member.get('settings') or {}).get(setting, True):
        return False
    key = digest(event_key)
    collection = lane('rp_notifications', recipient)
    if u.get(collection, key):
        return False
    stamp = now_ms()
    note = {'id': key, 'authorId': sender, 'type': event, 'targetId': target, 'createdAt': stamp, 'read': False,
            'title': title[:120], 'body': body[:240], 'sortKey': sort_key(stamp, key)}
    if event in ('placement', 'congratulation'):
        note['placementId'] = target
    elif event == 'contract_update':
        note['contractId'] = target
    u.put(collection, key, note)
    u.put('rp_work_delivery', key, {'id': key, 'sortKey': key, 'recipient_id': recipient, 'sender_id': sender,
                                  'event': event, 'type': event, 'target_id': target, 'notification_id': key, 'delivery_status': 'pending',
                                  'created_at': time.time(), 'title': title[:120], 'body': body[:240]})
    return True


def application_event(u, application, project, event):
    """Native application lifecycle callback; no inferred profile view events."""
    uid = application.get('worker_id')
    owner = project.get('owner_id')
    aid = application.get('id')
    if not uid or not owner or not aid:
        return False
    version = application.get('version', 1)
    title = {'profile_viewed': 'Your profile was viewed', 'application_viewed': 'Your application was opened',
             'reviewing': 'Your application is being reviewed', 'held': 'Your application is on hold',
             'shortlisted': 'You were shortlisted', 'offered': 'You received a work offer',
             'rejected': 'Your application was updated', 'accepted': 'Your placement is confirmed'}.get(event, 'Your application was updated')
    emitted = emit(u, uid, owner, 'application_update', aid, title, project.get('title', ''), aid + ':' + str(version) + ':' + event)
    if emitted:
        key = digest(aid + ':' + str(version) + ':' + event)
        row = u.get(lane('rp_notifications', uid), key)
        row.update(applicationId=aid, projectId=project['id'], status=application.get('status'), event=event)
        u.put(lane('rp_notifications', uid), key, row)
        envelope = u.get('rp_work_delivery', key)
        envelope.update(application_id=aid,project_id=project['id'],status=application.get('status'))
        u.put('rp_work_delivery', key, envelope)
    return emitted


def delivery_allowed(u, row):
    """Re-check privacy and live source at push delivery, not only enqueue time."""
    uid = row.get('recipient_id'); sender = row.get('sender_id')
    if not uid or not sender or blocked(u, uid, sender):
        return False
    event = row.get('event', row.get('type'))
    if event == 'contract_update':
        return bool(preferences(u, uid)['contractUpdates'] and contract(u, row.get('target_id', ''), uid))
    if event in ('placement', 'congratulation'):
        card = placement(u, row.get('target_id', ''), uid)
        if not card or not ((u.get('rp_members', uid) or {}).get('settings') or {}).get('placementNotifications', True):
            return False
        if event == 'placement':
            return bool((u.get('rp_follows', digest(uid + ':' + sender)) or {}).get('active'))
        return card['member']['id'] == uid
    if event == 'application_update':
        if not ((u.get('rp_members', uid) or {}).get('settings') or {}).get('applicationNotifications', True):
            return False
        application = u.get('project_applications', row.get('application_id', row.get('target_id', '')))
        project = u.get('contract_projects', (application or {}).get('project_id', ''))
        if application and project:
            from contract_work import application_projection
            effective=application_projection(application,project).get('status')
            if effective in ('completed','cancelled'):
                notification=u.get(lane('rp_notifications',uid),row.get('notification_id','')) or {}
                if notification.get('status')!=effective or notification.get('event')!=('complete' if effective=='completed' else 'cancel'):return False
        return bool(application and project and application.get('worker_id') == uid and project.get('owner_id') == sender)
    return False


def deliver_contract_updates(u, uid, now=None):
    """Atomically choose at most three distinct contracts per account/IST day."""
    stamp = now or time.time()
    if not preferences(u, uid)['contractUpdates']:
        return 0
    day = datetime.fromtimestamp(stamp, IST).date().isoformat()
    key = digest(uid + ':' + day)
    quota = u.get('rp_work_daily', key) or {'day': day, 'contracts': []}
    if len(quota['contracts']) >= 3:
        return 0
    watches = active_query(u, lane('rp_work_watches', uid), 32)
    refs = {entry['id']: entry for entry in watches if entry.get('active')}
    # Contract-update consent permits profile-relevant opportunities. Search
    # history contributes only with the independent personalization consent.
    ranked_interests = interests(u, uid)['trades']
    for entry in ranked_interests[:2]:
        if entry['weight'] <= 0:
            continue
        for ref in active_query(u, channel('contracts', entry['trade']), 8):
            if ref.get('active'):
                refs.setdefault(ref['id'], ref)
    for word in list(keyword_weights(u, uid))[:2]:
        for ref in active_query(u, channel('contracts', 'all', '', word), 8):
            refs.setdefault(ref['id'], ref)
    candidates = []
    for watch in refs.values():
        if not watch.get('active') or watch['id'] in quota['contracts']:
            continue
        explicit_watch = u.get(lane('rp_work_watches', uid), watch['id'])
        if explicit_watch is not None and not explicit_watch.get('active'):
            continue
        card = contract(u, watch['id'], uid)
        if not card:
            continue
        row = u.get('contract_tenders', watch['id'])
        signature = digest(json.dumps([row.get('status'), row.get('deadline'), row.get('starts_at'), row.get('ends_at'), row.get('version')]))
        last = u.get(lane('rp_work_contract_seen', uid), watch['id']) or {}
        deadline_soon = 0 < row.get('deadline', 0) - stamp <= 7 * 86400
        if last.get('signature') == signature and not deadline_soon:
            continue
        if not card['watched'] and card['match']['score'] <= 0:
            continue
        if row.get('owner_id') == uid:
            continue
        candidates.append((card, row, signature))
    candidates.sort(key=lambda item: (-(item[0]['match']['score'] + (.05 if item[0]['watched'] else 0)), item[0]['deadline'], item[0]['id']))
    delivered = 0
    for card, row, signature in candidates[:3 - len(quota['contracts'])]:
        sender = row['owner_id']
        title = 'Contract timeline update'
        body = f"{card['title']} · {card['city']}"
        if emit(u, uid, sender, 'contract_update', card['id'], title, body, uid + ':' + day + ':' + card['id']):
            quota['contracts'].append(card['id']); delivered += 1
            u.put(lane('rp_work_contract_seen', uid), card['id'], {'signature': signature, 'day': day})
    if delivered:
        u.put('rp_work_daily', key, quota)
    return delivered


def _project_terminal_notice(u,project,seat):
    """Relay the actual terminal project event; the source never copies its crew."""
    from contract_work import application_projection
    action='complete' if project['status']=='completed' else 'cancel'
    event=next((item for item in reversed(project.get('events',[])) if item.get('action')==action),None)
    if not event or not event.get('id'):return 0
    uid=seat.get('worker_id');aid=seat.get('application_id')
    application=u.get('project_applications',aid) if aid else None
    if aid:
        if not application or application.get('worker_id')!=uid or application.get('invitation_id')!=seat.get('id'):return 0
        if application.get('status') in ('completed','cancelled'):return 0
        projected=application_projection(application,project)
        if projected.get('status')!=project['status']:return 0
        application_event(u,projected,project,action)
    key=digest('project-end:'+project['id']+':'+event['id']+':'+str(uid))
    if u.get('notifications',key):return 0
    note=dict(id=key,user_id=uid,title='Project '+project['status'],body=project.get('title',''),
        destination='repaidians' if aid else 'contractor',created_at=event.get('at',project.get('updated_at',0)),project_id=project['id'])
    if aid:note.update(application_id=aid,kind='application_update')
    u.put('notifications',key,note)
    return 1


def _project_placements(u, entry, batch=20):
    project = u.get('contract_projects', entry['id'])
    if not project:
        entry['active'] = False; u.put('rp_work_project_queue', entry['id'], entry); return 0
    from contract_work import accepted_team
    terminal=project.get('status') in ('completed','cancelled')
    accepted=accepted_team(project)
    if terminal:
        selected={seat['worker_id']:seat for seat in accepted}
        for seat in project.get('team',[]):
            if seat.get('status')=='pending' and seat.get('worker_id'):selected.setdefault(seat['worker_id'],seat)
        accepted=list(selected.values())
    offset = entry.get('offset', 0)
    count = 0
    for seat in accepted[offset:offset + batch]:
        uid = seat.get('worker_id'); sid = seat.get('id')
        if not uid or not sid:
            continue
        if terminal:_project_terminal_notice(u,project,seat)
        if seat.get('status')!='accepted' or project.get('status')=='cancelled':
            count+=1;continue
        pid = digest(project['id'] + ':' + sid)
        ref = {'id': pid, 'sortKey': pid, 'projectId': project['id'], 'seatId': sid, 'memberId': uid}
        u.put('rp_work_placements', pid, ref)
        u.put(lane('rp_work_company_placements', project['owner_id']), pid, ref)
        u.put(lane('rp_work_member_placements', uid), pid, ref)
        if not terminal and placement(u, pid, uid) and not u.get('rp_work_announcements', pid):
            u.put('rp_work_announcement_queue', pid, {**ref, 'active': True, 'after': ''})
        count += 1
    entry['offset'] = offset + batch
    entry['active'] = entry['offset'] < len(accepted)
    u.put('rp_work_project_queue', entry['id'], entry)
    return count


def _announcement(u, entry, batch=20):
    card = placement(u, entry['id'], entry['memberId'])
    if not card:
        entry['active'] = False; u.put('rp_work_announcement_queue', entry['id'], entry); return 0
    rows = active_query(u, lane('rp_work_followers', entry['memberId']), batch, entry.get('after') or '')
    delivered = 0
    for edge in rows:
        uid = edge.get('from')
        live = u.get('rp_follows', digest(str(uid) + ':' + entry['memberId'])) or {}
        if edge.get('active') and live.get('active'):
            # Details and salary are fetched on open, never copied into the push.
            delivered += emit(u, uid, entry['memberId'], 'placement', entry['id'], 'A connection joined a project',
                              card['member']['name'] + ' · ' + card['projectTitle'], entry['id'] + ':' + str(uid))
    if rows:
        entry['after'] = rows[-1]['sortKey']
    entry['active'] = len(rows) == batch
    u.put('rp_work_announcement_queue', entry['id'], entry)
    if not entry['active']:
        u.put('rp_work_announcements', entry['id'], {'completedAt': now_ms()})
    return delivered


def _member_shares(u, entry, batch=10):
    if not preferences(u, entry['id'])['sharePlacements']:
        entry['active'] = False; u.put('rp_work_member_share_queue', entry['id'], entry); return 0
    rows = query(u, lane('rp_work_member_placements', entry['id']), batch, entry.get('after') or None, descending=False)
    count = 0
    for ref in rows:
        if placement(u, ref['id'], entry['id']) and not u.get('rp_work_announcements', ref['id']):
            u.put('rp_work_announcement_queue', ref['id'], {**ref, 'active': True, 'after': ''}); count += 1
    if rows:
        entry['after'] = rows[-1]['sortKey']
    entry['active'] = len(rows) == batch
    u.put('rp_work_member_share_queue', entry['id'], entry)
    return count


def _worker_batch(core, kind, handler, limit):
    """Durable cycling keyset; inactive rows cannot starve later work."""
    def select(u):
        checkpoint = u.get('rp_work_worker_cursors', kind) or {}
        rows = active_query(u, kind, limit, checkpoint.get('after') or '')
        after = rows[-1]['sortKey'] if len(rows) == limit else ''
        u.put('rp_work_worker_cursors', kind, {'after': after})
        return rows
    rows = core.operations_store.run(select)
    total = 0
    for row in rows:
        def process(u, key=row['id']):
            latest = u.get(kind, key)
            return handler(u, latest) if latest and latest.get('active') else 0
        total += core.operations_store.run(process)
    return total


def process_updates(core, limit=20):
    limit = max(1, min(limit, 40))
    projects = _worker_batch(core, 'rp_work_project_queue', _project_placements, limit)
    _worker_batch(core, 'rp_work_member_share_queue', _member_shares, limit)
    announcements = _worker_batch(core, 'rp_work_announcement_queue', _announcement, limit)
    contracts = _worker_batch(core, 'rp_work_update_recipients', lambda u, row: deliver_contract_updates(u, row['id']), limit)
    return {'placementsIndexed': projects, 'placementNotifications': announcements, 'contractNotifications': contracts}


def backfill(core, limit=10):
    """Background-only native document keyset migration, bounded per invocation."""
    limit = max(1, min(limit, 20)); processed = 0
    for kind in ('contract_projects', 'contract_tenders', 'contract_profiles', 'rp_follows', 'rp_members'):
        checkpoint_key = kind + ':' + WORK_TRADE_INDEX_VERSION if kind in ('contract_projects', 'contract_tenders') else kind
        def read(u):
            checkpoint = u.get('rp_work_backfill', checkpoint_key) or {}
            if checkpoint.get('complete'):
                return checkpoint, []
            return checkpoint, native_scan(u, kind, checkpoint.get('after', ''), limit + 1)
        checkpoint, rows = core.operations_store.run(read)
        for key, row in rows[:limit]:
            def index_live(u, key=key):
                current = u.get(kind, key)
                if current:
                    index_record(u, kind, key, current)
                    if kind == 'contract_projects':
                        from repaidians_opportunities import index_record as index_opportunity
                        index_opportunity(u, kind, key, current)
            core.operations_store.run(index_live)
            processed += 1
        if not checkpoint.get('complete'):
            after = rows[min(limit, len(rows)) - 1][0] if rows else checkpoint.get('after', '')
            def save(u):
                latest = u.get('rp_work_backfill', checkpoint_key) or {}
                if latest.get('after', '') <= after:
                    u.put('rp_work_backfill', checkpoint_key, {'after': after, 'complete': len(rows) <= limit})
            core.operations_store.run(save)
    return {'processed': processed}


def install(core):
    r = APIRouter(prefix='/repaidians', tags=['Repaidians work'])
    store = core.operations_store
    actor = core.repaidians_actor

    def user(a=Depends(actor)):
        account = signed(a)
        store.run(lambda u: browse(u, a))
        return account

    def privacy_user(a=Depends(actor)):
        # Privacy controls are an account right after membership/trial expiry.
        # member_ensure preserves the original immutable grant; it cannot mint
        # another trial for an existing account.
        account = signed(a)
        store.run(lambda u: member_ensure(u, account))
        return account

    @r.get('/work/preferences')
    def get_preferences(response: Response, account=Depends(privacy_user)):
        response.headers['Cache-Control'] = 'private, no-store'
        return store.run(lambda u: {'preferences': preferences(u, account['id'])})

    @r.patch('/work/preferences')
    def patch_preferences(body: Preferences, account=Depends(privacy_user)):
        def save(u):
            member = member_ensure(u, account)
            pref = {**preferences(u, account['id']), **body.model_dump(exclude_none=True)}
            if not pref['sharePlacements']:
                pref['shareSalary'] = False
            member['workPreferences'] = pref
            u.put('rp_members', account['id'], member)
            if not pref['personalizedDiscovery']:
                u.put('rp_work_signals', account['id'], {'trades': {}, 'terms': []})
            return {'preferences': pref}
        return store.run(save)

    @r.get('/work/interests')
    def get_interests(response: Response, account=Depends(user)):
        response.headers['Cache-Control'] = 'private, no-store'
        return store.run(lambda u: interests(u, account['id']))

    @r.post('/work/behavior')
    def behavior(body: Behavior, account=Depends(user)):
        def save(u):
            uid = account['id']; key = digest(uid + ':' + str(body.eventId))
            signature = digest(json.dumps(body.model_dump(mode='json'), sort_keys=True))
            old = u.get('rp_work_behavior_commands', key)
            if old:
                if old['signature'] != signature:
                    fail('COMMAND_REUSED', 'Use a new event reference for changed activity.', 409)
                return {'recorded': old['recorded']}
            consent = preferences(u, uid)['personalizedDiscovery']
            if consent:
                from repaidians import rate
                rate(u, uid, 'work_behavior', 240)
                signal = u.get('rp_work_signals', uid) or {'trades': {}, 'terms': []}
                now = now_ms(); prev = signal['trades'].get(body.trade) or {'weight': 0, 'at': now}
                signal['trades'][body.trade] = {'weight': min(30, _decayed(prev['weight'], prev['at'], now) + EVENT_WEIGHTS[body.type]), 'at': now}
                signal['revision'] = signal.get('revision', 0) + 1
                if body.query:
                    term = {'tokens': tokens(body.query), 'trade': body.trade, 'at': now, 'weight': EVENT_WEIGHTS[body.type]}
                    signal['terms'] = [term, *[row for row in signal.get('terms', []) if now - row.get('at', 0) <= HALF_LIFE_MS * 6]][:24]
                u.put('rp_work_signals', uid, signal)
            expires = datetime.fromtimestamp(time.time() + 86400, timezone.utc)
            u.put('rp_work_behavior_commands', key, {'signature': signature, 'recorded': consent,
                                                   'expiresAt': expires if u.tx is not None else expires.isoformat()})
            return {'recorded': consent}
        return store.run(save)

    @r.get('/work/jobs')
    def get_jobs(response: Response, trade: str = 'all', city: str = Query(default='', max_length=80), sector: str = Query(default='', max_length=80), query_text: str = Query(default='', alias='query', max_length=120),
                 minimumPayPaise: int = Query(default=0, ge=0, le=10000000), experience: int | None = Query(default=None, ge=0, le=60),
                 workType: Literal['all', 'project', 'private_request'] = 'all', closesWithinDays: int = Query(default=0, ge=0, le=30),
                 cursor: str | None = Query(default=None, max_length=1500), limit: int = Query(default=20, ge=1, le=30), account=Depends(user)):
        if trade != 'all' and trade not in TRADES:
            fail('INVALID_FILTER', 'Choose a supported work trade.', 422)
        if closesWithinDays not in (0, 7, 30):
            fail('INVALID_FILTER', 'Choose a closing window of 7 or 30 days.', 422)
        if sector and len(normalized(sector)) < 2:
            fail('INVALID_FILTER', 'Choose a business sector with at least two characters.', 422)
        response.headers['Cache-Control'] = 'private, no-store'
        filters = {'trade': trade, 'city': normalized(city), 'sector': normalized(sector), 'query': normalized(query_text), 'minimumPayPaise': minimumPayPaise,
                   'experience': experience, 'workType': workType, 'closesWithinDays': closesWithinDays}
        return store.run(lambda u: jobs_page(u, account['id'], filters, cursor, limit))

    @r.get('/work/contracts')
    def get_contracts(response: Response, trade: str = 'all', city: str = Query(default='', max_length=80), sector: str = Query(default='', max_length=80), query_text: str = Query(default='', alias='query', max_length=120),
                      cursor: str | None = Query(default=None, max_length=1500), limit: int = Query(default=20, ge=1, le=30), account=Depends(user)):
        if trade != 'all' and trade not in TRADES:
            fail('INVALID_FILTER', 'Choose a supported work trade.', 422)
        response.headers['Cache-Control'] = 'private, no-store'
        if sector and len(normalized(sector)) < 2:
            fail('INVALID_FILTER', 'Choose a business sector with at least two characters.', 422)
        return store.run(lambda u: contracts_page(u, account['id'], {'trade': trade, 'city': normalized(city), 'sector': normalized(sector), 'query': normalized(query_text)}, cursor, limit))

    @r.put('/work/contracts/{tid}/watch')
    def watch_contract(tid: str, body: Watch, account=Depends(user)):
        def save(u):
            uid = account['id']
            if not contract(u, tid, uid):
                fail('NOT_FOUND', 'This published contract is unavailable.', 404)
            if body.active and not preferences(u, uid)['contractUpdates']:
                fail('CONSENT_REQUIRED', 'Enable contract updates in your work preferences first.', 409)
            u.put(lane('rp_work_watches', uid), tid, {'id': tid, 'sortKey': tid, 'active': body.active})
            return {'watched': body.active}
        return store.run(save)

    @r.get('/work/contracts/{tid}/watch')
    def contract_watch(tid: str, response: Response, account=Depends(user)):
        response.headers['Cache-Control'] = 'private, no-store'
        def read(u):
            if not contract(u, tid, account['id']):
                fail('NOT_FOUND', 'This published contract is unavailable.', 404)
            return {'watched': bool((u.get(lane('rp_work_watches', account['id']), tid) or {}).get('active'))}
        return store.run(read)

    @r.get('/companies')
    def companies(response: Response, trade: str = 'all', city: str = Query(default='', max_length=80), query_text: str = Query(default='', alias='query', max_length=120),
                  cursor: str | None = Query(default=None, max_length=1500), limit: int = Query(default=20, ge=1, le=30), account=Depends(user)):
        if trade != 'all' and trade not in TRADES:
            fail('INVALID_FILTER', 'Choose a supported work trade.', 422)
        response.headers['Cache-Control'] = 'private, no-store'
        def read(u):
            filters = {'trade': trade, 'city': normalized(city), 'query': normalized(query_text)}
            after, binding = _cursor(cursor, account['id'], filters)
            rows = _candidates(u, 'companies', filters, {}, after)
            items = []; examined = None
            for row in rows:
                examined = row['sortKey']
                card = company(u, row['id'], account['id']) if row.get('active') else None
                if not card or (trade != 'all' and trade_for(card['sector']) != trade) or (city and normalized(card['city']) != normalized(city)):
                    continue
                if query_text and not all(word in tokens(card['name'] + ' ' + card['sector'] + ' ' + card['city']) for word in tokens(query_text)):
                    continue
                items.append(card)
                if len(items) == limit:
                    break
            return {'items': items, 'nextCursor': _next(examined, binding) if examined and (len(items) == limit or len(rows) == PAGE_SCAN) else None}
        return store.run(read)

    @r.get('/companies/{cid}')
    def company_detail(cid: str, response: Response, account=Depends(user)):
        response.headers['Cache-Control'] = 'private, no-store'
        def read(u):
            card = company(u, cid, account['id'])
            if not card:
                fail('NOT_FOUND', 'This registered company is unavailable.', 404)
            rows = query(u, lane('rp_work_owned_jobs', cid), PAGE_SCAN, descending=False)
            jobs = [value for row in rows if (source := u.get('contract_projects', row['id'])) and source.get('owner_id') == cid and (value := job(u, row['id'], account['id'], filters={'query': ' ', 'experience': 60}))]
            return {'company': card, 'jobs': jobs[:20], 'connections': _connections(u, cid, account['id'])}
        return store.run(read)

    @r.get('/placements/{pid}')
    def placement_detail(pid: str, response: Response, account=Depends(user)):
        response.headers['Cache-Control'] = 'private, no-store'
        def read(u):
            card = placement(u, pid, account['id'])
            if not card:
                fail('NOT_FOUND', 'This shared placement is unavailable.', 404)
            return card
        return store.run(read)

    @r.post('/placements/{pid}/congratulate')
    def congratulate(pid: str, body: Congratulations, account=Depends(user)):
        def save(u):
            card = placement(u, pid, account['id'])
            if not card:
                fail('NOT_FOUND', 'This shared placement is unavailable.', 404)
            uid = account['id']; key = digest(uid + ':' + pid)
            prior = u.get('rp_work_congratulations', key)
            if prior:
                return {'ok': True, 'congratulated': True}
            from repaidians import rate
            rate(u, uid, 'placement_congratulate', 60)
            u.put('rp_work_congratulations', key, {'id': key, 'memberId': uid, 'placementId': pid, 'message': body.message, 'createdAt': now_ms()})
            labels = {'congratulations': 'Congratulations!', 'good_luck': 'Best of luck!', 'well_deserved': 'Well deserved!'}
            emit(u, card['member']['id'], uid, 'congratulation', pid, labels[body.message], 'A member celebrated your new work.', key)
            return {'ok': True, 'congratulated': True}
        return store.run(save)

    core.app.include_router(r)
