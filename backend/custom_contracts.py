"""Customer-owned custom contracts on the canonical tender/project ledger.

Only matched, reviewed contractors can bid. Customer acceptance commits the
actual bid and agreed value to one canonical project; it never records payment.
Pre-award agent interest is availability, not a job application or team seat.
Private site coordinates, bidder prices and messages use separate access checks.
"""
import hashlib
import json
import re
import time
import unicodedata
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Response
from pydantic import Field, field_validator, model_validator

from operations import Input, Pin, Position, fail, metres
import repaidians as social
from repaidians_network import decode_cursor, encode_cursor
from contract_work import WorkforceRequirement, identifier, sector_name, worker_type_name
from repaidians_opportunities import trade_for, native_scan

SOURCE = 'customer_custom_query'
SCAN = 64
TENDER_BYTE_BUDGET = 512 * 1024
REACTIONS = ('interested', 'useful', 'support')
Trade = Literal['cleaning', 'electrician', 'plumber', 'ac', 'pest', 'carpenter', 'civil', 'spares']


def normalized(value):
    return ' '.join(unicodedata.normalize('NFKC', str(value or '')).casefold().split())


def words(values):
    return list(dict.fromkeys(re.findall(r'[^\W_]{2,40}', normalized(' '.join(values)), flags=re.UNICODE)))[:24]


class RequestId(Input):
    request_id: str = Field(min_length=16, max_length=100, pattern=r'^[A-Za-z0-9_-]+$')


class CustomQuery(RequestId):
    title: str = Field(min_length=3, max_length=150)
    sector: str = Field(min_length=2, max_length=80)
    work_trade: Trade
    city: str = Field(min_length=2, max_length=80)
    area: str = Field(min_length=2, max_length=120)
    site: str = Field(min_length=5, max_length=300)
    location: Pin | None = None
    scope: str = Field(min_length=20, max_length=4000)
    skills: list[Annotated[str, Field(min_length=2, max_length=80)]] = Field(min_length=1, max_length=20)
    minimum_experience: int = Field(default=0, ge=0, le=60, strict=True)
    workforce_requirements: list[WorkforceRequirement] = Field(default_factory=list, max_length=20)
    starts_at: float
    ends_at: float
    deadline: float
    budget_paise: int = Field(gt=0, le=50000000000, strict=True)
    terms: str = Field(min_length=20, max_length=4000)
    public_progress: bool = Field(default=False, strict=True)
    cta_label: str = Field(default='Enquiry', min_length=2, max_length=24)
    cta_enabled: bool = Field(default=True, strict=True)

    @field_validator('title', 'city', 'area', 'site', 'scope', 'terms', 'cta_label', mode='before')
    @classmethod
    def trim(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator('sector')
    @classmethod
    def sector_clean(cls, value):
        return sector_name(value)

    @field_validator('skills')
    @classmethod
    def skill_clean(cls, values):
        output = list(dict.fromkeys(value.strip() for value in values))
        if any(len(value) < 2 for value in output):
            raise ValueError('Enter actual skills needed for the work.')
        return output

    @model_validator(mode='after')
    def valid_window(self):
        if not time.time() < self.deadline <= self.starts_at < self.ends_at:
            raise ValueError('Use a future bidding deadline before work begins, followed by an end date.')
        if self.ends_at - self.starts_at > 3 * 365 * 86400:
            raise ValueError('Limit the work period to three years.')
        roles = [value.worker_type for value in self.workforce_requirements]
        if len(set(roles)) != len(roles) or sum(value.count for value in self.workforce_requirements) > 500:
            raise ValueError('Use distinct worker types, with at most 500 team places.')
        return self


class Bid(RequestId):
    expected_version: int = Field(ge=1, strict=True)
    amount_paise: int = Field(gt=0, le=50000000000, strict=True)
    proposal: str = Field(min_length=20, max_length=4000)
    accepted_terms: Literal[True]


class Command(RequestId):
    expected_version: int = Field(ge=1, strict=True)
    action: Literal['award', 'close', 'engagement', 'public_progress', 'withdraw_bid']
    bid_id: str | None = Field(default=None, max_length=100)
    reactions_enabled: bool | None = Field(default=None, strict=True)
    comments_enabled: bool | None = Field(default=None, strict=True)
    public_progress: bool | None = Field(default=None, strict=True)
    cta_enabled: bool | None = Field(default=None, strict=True)
    cta_label: str | None = Field(default=None, min_length=2, max_length=24)

    @field_validator('cta_label', mode='before')
    @classmethod
    def label_clean(cls,value):
        return value.strip() if isinstance(value,str) else value


class Reaction(RequestId):
    reaction: Literal['interested', 'useful', 'support'] | None


class Comment(RequestId):
    text: str = Field(min_length=1, max_length=2000)
    parent_id: str | None = Field(default=None, max_length=100)

    @field_validator('text', mode='before')
    @classmethod
    def text_clean(cls, value):
        return value.strip() if isinstance(value, str) else value


class Enquiry(Comment):
    bid_id: str = Field(min_length=1, max_length=100)


class AgentLocation(Input):
    location: Position | None = None
    location_consent: bool = Field(default=False, strict=True)
    cursor: str | None = Field(default=None, max_length=600)
    limit: int = Field(default=20, ge=1, le=30)


class Interest(RequestId):
    note: str = Field(min_length=20, max_length=2000)
    available: Literal[True]
    worker_type: str = Field(min_length=2, max_length=60, pattern=r'^[a-z][a-z0-9_]{1,59}$')
    location: Position | None = None
    location_consent: bool = Field(default=False, strict=True)

    @field_validator('worker_type', mode='before')
    @classmethod
    def clean_type(cls, value):
        return worker_type_name(value) if isinstance(value, str) else value


class AgentMessage(RequestId):
    text: str = Field(min_length=1, max_length=2000)
    recipient_id: str | None = Field(default=None, min_length=1, max_length=100)
    location: Position
    location_consent: Literal[True]

    @field_validator('text', mode='before')
    @classmethod
    def text_clean(cls, value):
        return value.strip() if isinstance(value, str) else value


def initialize(core):
    social.initialize(core)


def backfill_contractors(core, limit=24):
    """Checkpointed document-key migration, run by the worker, never a request."""
    def batch(u):
        checkpoint = u.get('custom_contract_index_state', 'contractors-v1') or {'after': '', 'complete': False}
        if checkpoint['complete']:
            return {'indexed': 0, 'complete': True}
        batch_limit=min(24,max(1,limit))
        rows = native_scan(u, 'workers', checkpoint['after'], batch_limit)
        for key, worker in rows:
            index_record(u, 'workers', key, worker)
        checkpoint.update(after=rows[-1][0] if rows else checkpoint['after'], complete=len(rows) < batch_limit)
        u.put('custom_contract_index_state', 'contractors-v1', checkpoint)
        return {'indexed': len(rows), 'complete': checkpoint['complete']}
    return core.operations_store.run(batch)


def lane(trade, city):
    return 'custom_contract_queries_' + social.digest(json.dumps([trade, normalized(city)], separators=(',', ':')))


def contractor_lane(trade, city):
    return 'custom_contract_contractors_' + social.digest(json.dumps([trade, normalized(city)], separators=(',', ':')))


def worker_trades(worker):
    return set(trade_for(value) for value in worker.get('categories', []))


def ensure_tender_size(row):
    """Reserve headroom below Firestore's 1 MiB document/wire encoding limit."""
    if len(json.dumps(row,ensure_ascii=False,separators=(',',':')).encode('utf-8'))>TENDER_BYTE_BUDGET:
        fail('CONTRACT_CAPACITY','This contract has reached its saved-detail capacity.',409)


def index_record(u, kind, key, row):
    if kind == 'workers':
        active = row.get('status') == 'approved' and bool(row.get('contractor_verified'))
        current = {contractor_lane(trade, row.get('city', '')) for trade in worker_trades(row)} if active else set()
        old = u.get('custom_contract_contractor_index', key) or {}
        entry = {'id': key, 'active': active, 'sortKey': key}
        for source in set(old.get('lanes', [])) - current:
            u.put(source, key, {**entry, 'active': False})
        for source in current:
            u.put(source, key, entry)
        u.put('custom_contract_contractor_index', key, {'lanes': sorted(current)})
    elif kind == 'contract_tenders' and row.get('source_kind') == SOURCE:
        ensure_tender_size(row)
        stamp = int(row['created_at'] * 1000)
        entry = {'id': key, 'sortKey': social.sort_key(stamp, key)}
        u.put(lane(row['work_trade'], row['city']), key, entry)
        u.put(social.lane('custom_contract_owned', row['owner_id']), key, entry)


def member_access(u, uid):
    worker = u.get('workers', uid) or {}
    from repaidians_billing import ensure_trial
    ensure_trial(u, uid, worker=worker)
    return social.subscription_state(u, uid)['active']


def professional(u, user, contractor=False, paid_gate=True):
    if not user.get('phone_verified'):
        fail('PHONE_REQUIRED', 'Verify your phone before opening professional opportunities.', 403)
    worker = u.get('workers', user['id']) or {}
    if worker.get('status') != 'approved' or (u.get('network_suspensions', user['id']) or {}).get('active'):
        fail('PROFESSIONAL_REQUIRED', 'Use an approved professional account.', 403)
    if contractor and not worker.get('contractor_verified'):
        fail('CONTRACTOR_REQUIRED', 'Complete contractor review before submitting a contract proposal.', 403)
    if paid_gate and not member_access(u, user['id']):
        fail('MEMBERSHIP_REQUIRED', 'Your 60-day trial has ended. An active Repaidians membership is required.', 402)
    return worker


def match(u, query, uid, contractor=True):
    worker = u.get('workers', uid) or {}
    profile = u.get('contract_profiles', uid) or {}
    requested = set(words(query['skills']))
    held = set(words(worker.get('skills', [])))
    reasons = []
    trade_match = query['work_trade'] in worker_trades(worker)
    city_match = normalized(worker.get('city')) == normalized(query['city'])
    if trade_match: reasons.append('Matches your registered work trade')
    if city_match: reasons.append('In your registered service city')
    if normalized(profile.get('sector')) == normalized(query['sector']): reasons.append('Matches your registered business sector')
    if requested & held: reasons.append('Your listed skills overlap the requested work')
    experience = worker.get('experience_years', 0) >= query.get('minimum_experience', 0)
    if experience: reasons.append('Meets the listed experience requirement')
    eligible = bool(uid != query['owner_id'] and worker.get('status') == 'approved' and (not contractor or worker.get('contractor_verified'))
                    and trade_match and city_match and experience
                    and not social.blocked(u, uid, query['owner_id'])
                    and not (u.get('network_suspensions', uid) or {}).get('active'))
    return {'eligible': eligible, 'reasons': reasons}


def fit(u, query, uid):
    worker = u.get('workers', uid) or {}
    wanted = set(words(query['skills'])); held = set(words(worker.get('skills', [])))
    components = dict(trade=1.0 if query['work_trade'] in worker_trades(worker) else 0.0,
        city=1.0 if normalized(worker.get('city')) == normalized(query['city']) else 0.0,
        skills=round(len(wanted & held) / len(wanted), 3) if wanted else 0.0,
        experience=1.0 if worker.get('experience_years', 0) >= query.get('minimum_experience', 0) else 0.0)
    return dict(score=round(40*components['trade']+30*components['city']+20*components['skills']+10*components['experience'],2),
        model='custom-contract-fit-v1',components=components)


def get_query(u, qid):
    row = u.get('contract_tenders', qid)
    if not row or row.get('source_kind') != SOURCE:
        fail('NOT_FOUND', 'Custom contract unavailable.', 404)
    return row


def parties(query, uid):
    return uid == query['owner_id'] or uid == query.get('awarded_contractor_id')


def access(u, query, user):
    uid = user['id']
    if social.blocked(u, uid, query['owner_id']):
        fail('NOT_FOUND', 'Custom contract unavailable.', 404)
    if parties(query, uid):
        return
    interest = u.get('custom_contract_interests', social.digest(query['id'] + ':' + uid))
    if (interest and interest.get('available') and interest.get('status') == 'pending_award'
            and query['status'] == 'open' and match(u, query, uid, contractor=False)['eligible']):
        professional(u, user)
        return
    if not match(u, query, uid)['eligible']:
        fail('NOT_FOUND', 'This contract is private to its customer and eligible professionals.', 404)
    professional(u, user, contractor=True)


def fresh_location(position):
    if not 0 <= time.time() - position.captured_at <= 900 or position.accuracy > 100:
        fail('FRESH_LOCATION_REQUIRED', 'Use a location from the last 15 minutes with accuracy within 100 metres.', 422)


def trial_active(u, uid):
    state = social.subscription_state(u, uid)
    return bool(state.get('trial') and state['trial'].get('status') == 'active')


def agent_access(u, query, user, position=None, consent=False, nearby_only=False):
    professional(u, user)
    location = query.get('location')
    if not query.get('workforce_requirements') or not match(u, query, user['id'], contractor=False)['eligible']:
        fail('OPPORTUNITY_UNAVAILABLE', 'This is not a matching opening near your selected location.', 404)
    paid = (social.subscription_state(u, user['id']).get('subscription') or {}).get('plan') != 'trial'
    if paid and not nearby_only:
        return None
    if not consent or not position:
        fail('LOCATION_CONSENT_REQUIRED', 'Choose to share a fresh location for nearby trial opportunities.', 422)
    fresh_location(position)
    if not location:
        fail('OPPORTUNITY_UNAVAILABLE', 'This opening has no customer-confirmed location.', 404)
    distance = metres(position.model_dump(), location)
    if distance > 10000:
        fail('OPPORTUNITY_OUTSIDE_RADIUS', 'This opening is outside the 10 km opportunity radius.', 403)
    return round(distance / 1000, 1)


def live_opening(u, row, worker):
    if row.get('status') != 'awarded' or not row.get('winning_project_id'):
        return None
    project=u.get('contract_projects',row['winning_project_id']) or {}
    from contract_work import hiring_source_authorized,team_capacity,application_fit
    hiring=project.get('hiring') or {};capacity=team_capacity(project)
    if (not hiring_source_authorized(u,project) or project.get('status') not in ('planning','active')
            or hiring.get('status')!='open' or hiring.get('deadline',0)<=time.time()
            or project.get('ends_at',0)<=time.time() or not capacity.get('vacancies')
            or not application_fit(worker,hiring)['eligible']):
        return None
    return project


def opening_recipients(u, row, user):
    ids=([row['awarded_contractor_id']] if row['status']=='awarded' else
         list(dict.fromkeys(b['contractor_id'] for b in row['bids'] if b['status']=='submitted'))[:6])
    social.prefetch_blocks(u,{'user':user},ids)
    u.prefetch([(kind,uid) for uid in ids for kind in ('workers','rp_members','network_suspensions')])
    ids=[uid for uid in ids if (u.get('workers',uid) or {}).get('status')=='approved'
         and (u.get('workers',uid) or {}).get('contractor_verified') and u.get('rp_members',uid)
         and not (u.get('network_suspensions',uid) or {}).get('active') and not social.blocked(u,user['id'],uid)]
    return public_members(u,ids)


def receipt(u, uid, body, action, target=''):
    key = social.digest(uid + ':' + body.request_id)
    signature = hashlib.sha256(json.dumps([action, target, body.model_dump(mode='json')], sort_keys=True).encode()).hexdigest()
    old = u.get('custom_contract_commands', key)
    if old and old['signature'] != signature:
        fail('REQUEST_REUSED', 'Use a new request reference for changed details.', 409)
    return key, signature, old


def remember(u, key, signature, result_id):
    u.put('custom_contract_commands', key, {'signature': signature, 'result_id': result_id, 'created_at': time.time()})


def version(row, expected):
    if row['version'] != expected:
        fail('VERSION_CONFLICT', 'This contract changed. Refresh and try again.', 409)


def notification(u, recipient, actor, query, kind, bid_id=None, project_id=None, event_id=None):
    if recipient == actor or social.blocked(u, actor, recipient): return
    key = identifier('custom-notice', recipient, query['id'] + ':' + kind + ':' + str(event_id or bid_id or ''))
    if u.get('notifications', key): return
    row = dict(id=key, user_id=recipient, title={'custom_contract_bid': 'New contract proposal',
        'custom_contract_awarded': 'Contract proposal accepted', 'custom_contract_match': 'Matching custom contract',
        'custom_contract_enquiry': 'Contract proposal enquiry', 'custom_contract_message': 'New contract message',
        'custom_contract_recommendations': 'Contractors match your custom contract',
        'custom_contract_interest': 'Professional availability interest'}.get(kind, 'Contract update'),
        body='Open the contract to review the confirmed details.', destination='custom_contract', kind=kind,
        query_id=query['id'], author_id=actor, created_at=time.time())
    if bid_id: row['bid_id'] = bid_id
    if project_id: row['project_id'] = project_id
    u.put('notifications', key, row)
    stamp = int(row['created_at'] * 1000)
    community = dict(id=key, authorId=actor, type=kind, targetId=query['id'], queryId=query['id'],
        title=row['title'], body=row['body'], createdAt=stamp, sortKey=social.sort_key(stamp, key), read=False)
    if bid_id: community['bidId'] = bid_id
    if project_id: community['projectId'] = project_id
    u.put(social.lane('rp_notifications', recipient), key, community)
    if kind in ('custom_contract_bid', 'custom_contract_awarded'):
        from transactional_mail import enqueue
        enqueue(u,key,'contract_proposal_submitted' if kind=='custom_contract_bid' else 'contract_awarded',
                [recipient,actor],{'record_type':'contract','record_id':query['id'],'path':'/'})


def prefetch_queries(u, queries, uid):
    dependencies = [('workers', uid), ('contract_profiles', uid), ('network_suspensions', uid),
                    ('rp_trials', uid), ('rp_subscriptions', uid)]
    for row in queries:
        dependencies.extend((kind, row['id']) for kind in ('custom_contract_stats', 'custom_contract_requirements', 'custom_contract_recommendations'))
        dependencies.extend((kind, social.digest(row['id'] + ':' + uid)) for kind in ('custom_contract_reactions', 'custom_contract_interests'))
        for left, right in ((uid, row['owner_id']), (row['owner_id'], uid)):
            dependencies.extend([('rp_blocks', social.digest(left + ':' + right)), ('network_blocks', left + ':' + right)])
    u.prefetch(dependencies)


def matched_contractors(u, row, user):
    if user['id'] != row['owner_id']:
        return [], None
    from repaidians_work import active_query
    saved = u.get('custom_contract_recommendations', row['id']) or {}
    ids = saved.get('contractor_ids') or [r['id'] for r in active_query(u,contractor_lane(row['work_trade'],row['city']),16)]
    ids = list(dict.fromkeys(ids))[:24]
    u.prefetch([(kind,uid) for uid in ids for kind in ('workers','contract_profiles','network_suspensions','rp_trials','rp_subscriptions')])
    social.prefetch_blocks(u,{'user':user},ids)
    selected = sorted((uid for uid in ids if match(u,row,uid)['eligible']),key=lambda uid:(-fit(u,row,uid)['score'],uid))[:6]
    members = {member['id']:member for member in public_members(u,selected)}
    items = [dict(contractor_id=uid,name=members[uid]['name'],member=members[uid],reasons=match(u,row,uid)['reasons'],fit=fit(u,row,uid))
             for uid in selected if uid in members]
    indexing = not (u.get('custom_contract_index_state','contractors-v1') or {}).get('complete',False)
    return items, dict(indexing=indexing,complete=bool(saved.get('complete')) and not indexing,shown=len(items),scope='bounded trade/city candidates')


def public_members(u, ids):
    output = []
    ids = list(dict.fromkeys(ids))[:64]
    u.prefetch([(kind, uid) for uid in ids for kind in ('workers', 'worker_profiles', 'rp_members', 'rp_trials', 'rp_subscriptions')])
    for uid in ids:
        member = u.get('rp_members', uid)
        worker = u.get('workers', uid) or {}
        profile = u.get('worker_profiles', uid) or {}
        portrait = f"/api/operations/professional-media/{profile['portrait_id']}" if profile.get('portrait_id') else ''
        if member:
            projection=social.member_public(u, member)
            if not projection.get('avatarUrl'):projection['avatarUrl']=portrait
            output.append(projection)
        elif worker.get('status') == 'approved':
            from repaidians_billing import membership_badge
            output.append(dict(id=uid, name=worker.get('name', 'Professional'), handle='', role=worker.get('role'),
                trade=next(iter(worker_trades(worker)), 'cleaning'), avatarUrl=portrait, bio=profile.get('bio',''), skills=worker.get('skills', [])[:12],
                city=worker.get('city', ''), reviewed=True, repaidianBadge=membership_badge(u, uid, worker=worker)))
    return output


def query_view(u, row, user):
    uid = user['id']; owner = uid == row['owner_id']; winner = uid == row.get('awarded_contractor_id')
    worker = u.get('workers', uid) or {}; matching = match(u, row, uid)
    writable = matching['eligible'] and member_access(u, uid)
    engagement = match(u, row, uid, contractor=False)['eligible'] and member_access(u, uid)
    open_now = row['status'] == 'open' and time.time() < row['deadline']
    stats = u.get('custom_contract_stats', row['id']) or {'views': 0, 'comments': 0, 'reactions': {key: 0 for key in REACTIONS}, 'interests': 0}
    my_reaction = (u.get('custom_contract_reactions', social.digest(row['id'] + ':' + uid)) or {}).get('reaction')
    visible_bids=[bid for bid in row['bids'] if owner or bid['contractor_id']==uid]
    u.prefetch([('custom_contract_bid_content',bid['content_id']) for bid in visible_bids if bid.get('content_id')])
    bids=[]
    for bid in visible_bids:
        content=u.get('custom_contract_bid_content',bid['content_id']) if bid.get('content_id') else None
        if bid.get('content_id') and (not content or content.get('query_id')!=row['id'] or content.get('contractor_id')!=bid['contractor_id']):
            fail('PROPOSAL_UNAVAILABLE','The saved proposal needs reconciliation before review.',409)
        projection={key:bid.get(key) for key in ('id','contractor_id','contractor_name','amount_paise','status','submitted_at')}
        projection['proposal']=content['proposal'] if content else bid.get('proposal','')
        bids.append(projection)
    profile = u.get('custom_contract_requirements', row['id']) or {}
    output = {key: row.get(key) for key in ('id', 'title', 'sector', 'work_trade', 'city', 'area', 'scope', 'skills',
        'minimum_experience', 'workforce_requirements', 'budget_paise', 'starts_at', 'ends_at', 'deadline', 'terms', 'status', 'version', 'owner_id', 'owner_name')}
    output.update(controls=row['controls'], stats={**stats, 'bids': sum(b['status'] == 'submitted' for b in row['bids'])},
                  my_reaction=my_reaction, bids=bids, match=matching, requirements=profile,
                  permissions=dict(can_bid=writable and not owner and open_now, can_award=owner and row['status']=='open' and time.time()<row['ends_at'],
                    can_close=owner and row['status'] == 'open', can_react=not owner and engagement and row['controls']['reactions_enabled'],
                    can_comment=(owner or engagement) and row['controls']['comments_enabled'], can_manage_engagement=owner,
                    can_enquire=row['controls'].get('cta_enabled',True) and row['status']=='awarded' and (owner or winner),
                    can_use_cta=row['controls'].get('cta_enabled',True) and (owner or writable or winner),
                    can_message=row['status'] == 'awarded' and (owner or winner), can_view_site=owner or winner))
    if owner or winner: output.update(site=row['site'], location=row.get('location'))
    if owner or winner:
        project=u.get('contract_projects',row['winning_project_id']) if row.get('winning_project_id') else None
        status=(project or {}).get('status')
        output['project_status']=status
        output['lifecycle']='completed' if status in ('completed','cancelled') or row['status']=='closed' else 'progress' if status in ('active','paused') else 'assigned' if row['status']=='awarded' else 'pending'
    interest = u.get('custom_contract_interests', social.digest(row['id'] + ':' + uid))
    output['my_interest'] = {key: interest.get(key) for key in ('id', 'worker_type', 'note', 'status', 'created_at')} if interest else None
    if owner:
        output['matched_contractors'],output['matches_state']=matched_contractors(u,row,user)
    return output


def details(u, query, user):
    project = u.get('contract_projects', query.get('winning_project_id', '')) if query.get('winning_project_id') and parties(query, user['id']) else None
    safe_project = {key: project.get(key) for key in ('id', 'version', 'status', 'title', 'owner_id', 'owner_name', 'client_id', 'awarded_at', 'contract_value_paise')} if project else None
    return dict(query=query_view(u, query, user), project=safe_project,
        members=public_members(u, [b['contractor_id'] for b in query['bids'] if user['id'] == query['owner_id'] or b['contractor_id'] == user['id']]))


def process_notifications(core, limit=4):
    """A durable bounded candidate cursor; no synchronous recipient fan-out."""
    from repaidians_work import active_query
    indexing = backfill_contractors(core)
    if not indexing['complete']:
        return {'delivered': 0, 'queries': 0, 'indexing': indexing}
    rows = core.operations_store.run(lambda u: active_query(u, 'custom_contract_match_queue', min(16, limit)))
    delivered = 0
    for entry in rows:
        def batch(u):
            queue = u.get('custom_contract_match_queue', entry['id'])
            query = get_query(u, entry['id'])
            if not queue or not queue.get('active'): return 0
            refs = active_query(u, contractor_lane(query['work_trade'], query['city']), 32, queue.get('after', ''))
            u.prefetch([(kind, row['id']) for row in refs for kind in ('workers', 'contract_profiles', 'network_suspensions')])
            social.prefetch_blocks(u,{'user':{'id':query['owner_id']}},[r['id'] for r in refs])
            recommendations=u.get('custom_contract_recommendations',query['id']) or {'contractor_ids':[],'complete':False}
            count = 0
            for row in refs:
                if query['status'] == 'open' and time.time() < query['deadline'] and match(u, query, row['id'])['eligible']:
                    notification(u, row['id'], query['owner_id'], query, 'custom_contract_match'); count += 1
                    if row['id'] not in recommendations['contractor_ids'] and len(recommendations['contractor_ids'])<24:
                        recommendations['contractor_ids'].append(row['id'])
            queue.update(after=refs[-1]['id'] if refs else queue.get('after', ''), active=len(refs) == 32)
            recommendations['complete']=not queue['active'];u.put('custom_contract_recommendations',query['id'],recommendations)
            if recommendations['contractor_ids']:
                notification(u,query['owner_id'],recommendations['contractor_ids'][0],query,'custom_contract_recommendations')
            u.put('custom_contract_match_queue', entry['id'], queue)
            return count
        delivered += core.operations_store.run(batch)
    return {'delivered': delivered, 'queries': len(rows), 'indexing': indexing}


def install(core):
    router = APIRouter(prefix='/operations/custom-contracts', tags=['Customer custom contracts'])
    store = core.operations_store

    @router.post('/queries', status_code=201)
    def create(body: CustomQuery, user=Depends(core.current_user)):
        if not user.get('phone_verified'): fail('PHONE_REQUIRED', 'Verify your phone before posting a custom contract.', 403)
        def save(u):
            uid=user['id']; key=identifier('custom-query',uid,body.request_id)
            receipt_key, signature, old=receipt(u,uid,body,'create-query')
            if old: return details(u,get_query(u,key),user)
            from account_profile import require_email
            require_email(u,user)
            social.rate(u,uid,'custom-query-create',limit=10)
            stamp=time.time(); payload=body.model_dump(mode='json',exclude={'request_id','public_progress','cta_label','cta_enabled'})
            row=dict(**payload,id=key,source_kind=SOURCE,owner_id=uid,owner_name=user.get('name','Customer'),owner_phone_verified=True,
                status='open',bids=[],registrations=[],events=[],version=1,created_at=stamp,opens_at=stamp,
                manpower_needed=sum(r.count for r in body.workforce_requirements),controls={'reactions_enabled':True,'comments_enabled':True,'public_progress':body.public_progress,'cta_label':body.cta_label,'cta_enabled':body.cta_enabled})
            u.put('contract_tenders',key,row); index_record(u,'contract_tenders',key,row)
            u.put('custom_contract_requirements',key,dict(id=key,basis='customer supplied requirements',sector=normalized(body.sector),
                work_trade=body.work_trade,city=normalized(body.city),skill_terms=words(body.skills),minimum_experience=body.minimum_experience,
                workforce_requirements=payload['workforce_requirements'],source_query_id=key))
            u.put('custom_contract_match_queue',key,{'id':key,'sortKey':key,'active':True,'after':''})
            from transactional_mail import enqueue
            enqueue(u,receipt_key,'contract_posted',[uid],{'record_type':'contract','record_id':key,'path':'/'})
            remember(u,receipt_key,signature,key);return details(u,row,user)
        return store.run(save)

    @router.get('/queries')
    def listing(response:Response,scope:Literal['mine','matched','bids']='mine',cursor:str|None=None,
                limit:int=Query(default=20,ge=1,le=30),user=Depends(core.current_user)):
        response.headers['Cache-Control']='private, no-store'
        def read(u):
            uid=user['id']; binding='queries:'+scope; before=decode_cursor(cursor,uid,scope,binding)
            if scope=='mine': sources=[social.lane('custom_contract_owned',uid)]
            elif scope=='bids': professional(u,user,contractor=True);sources=[social.lane('custom_contract_bidder',uid)]
            else:
                worker=professional(u,user,contractor=True);index_record(u,'workers',uid,worker)
                sources=[lane(trade,worker.get('city','')) for trade in sorted(worker_trades(worker))[:8]]
            refs=sorted([row for source in sources for row in social.query(u,source,SCAN,before)],key=lambda r:r['sortKey'],reverse=True)
            refs=list({row['id']:row for row in refs}.values())[:SCAN]
            u.prefetch([('contract_tenders',row['id']) for row in refs]);items=[];examined=None
            prefetch_queries(u,[row for ref in refs if (row:=u.get('contract_tenders',ref['id'])) and row.get('source_kind')==SOURCE],uid)
            for ref in refs:
                examined=ref['sortKey'];row=u.get('contract_tenders',ref['id'])
                if not row or row.get('source_kind')!=SOURCE:continue
                if scope=='matched' and (row['status']!='open' or time.time()>=row['deadline'] or not match(u,row,uid)['eligible']):continue
                if social.blocked(u,uid,row['owner_id']):continue
                items.append(query_view(u,row,user))
                if len(items)==limit:break
            more=bool(examined and (len(items)==limit or len(refs)==SCAN))
            return dict(items=items,members=public_members(u,[b['contractor_id'] for row in items for b in row['bids']]),
                        nextCursor=encode_cursor(examined,uid,scope,binding) if more else None)
        return store.run(read)

    @router.get('/queries/{qid}')
    def detail(qid:str,response:Response,user=Depends(core.current_user)):
        response.headers['Cache-Control']='private, no-store'
        def read(u):
            row=get_query(u,qid);access(u,row,user);return details(u,row,user)
        return store.run(read)

    @router.get('/queries/{qid}/updates')
    def updates(qid: str, response: Response, user=Depends(core.current_user)):
        # One bounded, authenticated check; no proposal bodies, candidate scan,
        # site or message content travels through the update channel.
        response.headers['Cache-Control'] = 'private, no-store'
        def read(u):
            row = get_query(u, qid)
            access(u, row, user)  # Recheck blocks, review and membership on every check.
            stats = u.get('custom_contract_stats', qid) or {}
            activity = u.get('custom_contract_activity', qid) or {}
            project = u.get('contract_projects', row.get('winning_project_id', '')) if row.get('winning_project_id') and parties(row, user['id']) else None
            signature = [row['version'], stats, activity.get('version', 0) if parties(row, user['id']) else 0,
                (project or {}).get('version'), time.time() < row['deadline']]
            return {'revision': hashlib.sha256(json.dumps(signature, sort_keys=True).encode()).hexdigest()}
        return store.run(read)

    @router.post('/queries/{qid}/bids')
    def bid(qid:str,body:Bid,user=Depends(core.current_user)):
        def save(u):
            uid=user['id'];worker=professional(u,user,contractor=True);row=get_query(u,qid);access(u,row,user)
            rk,sig,old=receipt(u,uid,body,'bid',qid)
            if old:return details(u,row,user)
            from account_profile import require_email
            require_email(u,user)
            version(row,body.expected_version)
            if row['owner_id']==uid:fail('SELF_BID','A customer cannot propose to their own contract.',403)
            if row['status']!='open' or time.time()>=row['deadline']:fail('BIDDING_CLOSED','Bidding is closed.',409)
            if len(row['bids'])>=64:fail('PROPOSAL_LIMIT','This request has reached its proposal limit.',409)
            social.rate(u,uid,'custom-query-bid',limit=30)
            for proposal in row['bids']:
                if proposal['contractor_id']==uid and proposal['status']=='submitted':proposal['status']='superseded'
            bidid=identifier('custom-bid',uid,body.request_id);stamp=time.time()
            u.put('custom_contract_bid_content',bidid,dict(id=bidid,query_id=qid,contractor_id=uid,
                proposal=body.proposal,terms_snapshot=row['terms'],created_at=stamp))
            row['bids'].append(dict(id=bidid,contractor_id=uid,contractor_name=worker['name'],amount_paise=body.amount_paise,
                content_id=bidid,status='submitted',submitted_at=stamp))
            row['version']+=1;u.put('contract_tenders',qid,row)
            u.put(social.lane('custom_contract_bidder',uid),qid,{'id':qid,'sortKey':social.sort_key(int(stamp*1000),qid)})
            notification(u,row['owner_id'],uid,row,'custom_contract_bid',bidid)
            remember(u,rk,sig,bidid);return details(u,row,user)
        return store.run(save)

    @router.post('/queries/{qid}/commands')
    def command(qid:str,body:Command,user=Depends(core.current_user)):
        def save(u):
            uid=user['id'];row=get_query(u,qid);access(u,row,user);rk,sig,old=receipt(u,uid,body,'command',qid)
            if old:return details(u,row,user)
            version(row,body.expected_version)
            if body.action=='withdraw_bid':
                proposal=next((b for b in row['bids'] if b['id']==body.bid_id and b['contractor_id']==uid and b['status']=='submitted'),None)
                if not proposal or row['status']!='open':fail('PROPOSAL_UNAVAILABLE','Only your pending proposal can be withdrawn.',409)
                proposal['status']='withdrawn'
            else:
                if row['owner_id']!=uid or not user.get('phone_verified'):fail('CUSTOMER_OWNER_REQUIRED','Only the verified customer who posted this contract can manage it.',403)
                if body.action=='award':
                    if row['status']!='open':fail('CONTRACT_DECIDED','This request has already been decided.',409)
                    if time.time()>=row['ends_at']:fail('CONTRACT_ENDED','The requested work period has ended.',409)
                    proposal=next((b for b in row['bids'] if b['id']==body.bid_id and b['status']=='submitted'),None)
                    if not proposal:fail('PROPOSAL_UNAVAILABLE','Choose a submitted proposal.',422)
                    wid=proposal['contractor_id']; professional(u,{'id':wid,'phone_verified':True},contractor=True)
                    if not match(u,row,wid)['eligible']:fail('CONTRACTOR_UNAVAILABLE','The contractor no longer matches this request.',409)
                    pid=identifier('custom-project',uid,qid);stamp=time.time()
                    project=dict(id=pid,title=row['title'],scope=row['scope'],site=row['site'],location=row.get('location'),
                        starts_at=row['starts_at'],ends_at=row['ends_at'],budget_paise=row['budget_paise'],work_trade=row['work_trade'],
                        workforce_requirements=row['workforce_requirements'],manpower_needed=row['manpower_needed'],
                        owner_id=wid,owner_name=proposal['contractor_name'],client_id=uid,tender_id=qid,source_kind=SOURCE,
                        status='planning',team=[],goals=[],attendance=[],leave=[],events=[],version=1,created_at=stamp,
                        awarded_at=stamp,contract_value_paise=proposal['amount_paise'],owner_phone_verified=True)
                    if u.get('contract_projects',pid):fail('CONTRACT_DECIDED','A project already exists for this award.',409)
                    for other in row['bids']:
                        if other['id']!=proposal['id'] and other['status']=='submitted':other['status']='not_selected'
                    proposal.update(status='awarded',project_id=pid);row.update(status='awarded',winning_bid_id=proposal['id'],winning_project_id=pid,awarded_contractor_id=wid)
                    u.put('contract_projects',pid,project);notification(u,wid,uid,row,'custom_contract_awarded',proposal['id'],pid)
                elif body.action=='close':
                    if row['status']!='open':fail('CONTRACT_DECIDED','This request has already been decided.',409)
                    row['status']='closed'
                elif body.action=='engagement':
                    for field in ('reactions_enabled','comments_enabled','cta_label','cta_enabled'):
                        if getattr(body,field) is not None:row['controls'][field]=getattr(body,field)
                elif body.action=='public_progress':
                    if body.public_progress is None:fail('CONSENT_REQUIRED','Choose whether to publish a limited progress summary.',422)
                    row['controls']['public_progress']=body.public_progress
            row['version']+=1;row['events'].append({'action':body.action,'actor':uid,'at':time.time()});row['events']=row['events'][-64:]
            u.put('contract_tenders',qid,row)
            if body.action in ('close','withdraw_bid'):
                from transactional_mail import enqueue
                enqueue(u,rk,'contract_closed' if body.action=='close' else 'contract_proposal_withdrawn',
                        [uid,row['owner_id']],{'record_type':'contract','record_id':qid,'path':'/'})
            if body.action in ('award','public_progress') and row.get('winning_project_id'):
                from contract_records import set_public_consent
                set_public_consent(u,u.get('contract_projects',row['winning_project_id']),uid,row['controls']['public_progress'])
            remember(u,rk,sig,qid);return details(u,row,user)
        return store.run(save)

    @router.put('/queries/{qid}/reaction')
    def reaction(qid:str,body:Reaction,user=Depends(core.current_user)):
        def save(u):
            uid=user['id'];row=get_query(u,qid);access(u,row,user);professional(u,user)
            if uid==row['owner_id'] or not row['controls']['reactions_enabled']:fail('REACTIONS_DISABLED','Reactions are disabled for this request.',403)
            rk,sig,old=receipt(u,uid,body,'reaction',qid)
            if old:return {'query':query_view(u,row,user)}
            social.rate(u,uid,'custom-query-reaction',limit=60)
            key=social.digest(qid+':'+uid);previous=(u.get('custom_contract_reactions',key) or {}).get('reaction')
            stats=u.get('custom_contract_stats',qid) or {'views':0,'comments':0,'interests':0,'reactions':{r:0 for r in REACTIONS}}
            if previous!=body.reaction:
                if previous:stats['reactions'][previous]=max(0,stats['reactions'][previous]-1)
                if body.reaction:stats['reactions'][body.reaction]+=1
            u.put('custom_contract_reactions',key,{'query_id':qid,'user_id':uid,'reaction':body.reaction})
            u.put('custom_contract_stats',qid,stats);remember(u,rk,sig,key);return {'query':query_view(u,row,user)}
        return store.run(save)

    @router.post('/queries/{qid}/view')
    def view(qid:str,body:RequestId,user=Depends(core.current_user)):
        def save(u):
            row=get_query(u,qid);access(u,row,user);key=social.digest(qid+':'+user['id'])
            stats=u.get('custom_contract_stats',qid) or {'views':0,'comments':0,'interests':0,'reactions':{r:0 for r in REACTIONS}}
            recorded=not u.get('custom_contract_views',key) and user['id']!=row['owner_id']
            if recorded:
                stats['views']+=1;u.put('custom_contract_views',key,{'query_id':qid,'user_id':user['id'],'created_at':time.time()});u.put('custom_contract_stats',qid,stats)
            return {'recorded':recorded,'views':stats['views']}
        return store.run(save)

    def thread_access(u,row,user,kind,bid_id=None,writing=False):
        access(u,row,user);uid=user['id']
        if kind in ('messages','enquiries'):
            if row['status']!='awarded' or not parties(row,uid):fail('AWARD_REQUIRED','Contract messages open only between the customer and accepted contractor after award.',403)
        if kind=='enquiries':
            proposal=next((b for b in row['bids'] if b['id']==bid_id),None) if bid_id else None
            if bid_id and (not proposal or bid_id!=row.get('winning_bid_id')):fail('PROPOSAL_REQUIRED','Enquiries must belong to the accepted proposal.',403)
        if writing and kind=='comments' and not row['controls']['comments_enabled']:fail('COMMENTS_DISABLED','Comments are disabled for this contract.',403)

    def thread_page(u,qid,user,kind,cursor,limit):
        row=get_query(u,qid);thread_access(u,row,user,kind)
        before=decode_cursor(cursor,user['id'],kind,qid)
        refs=social.query(u,social.lane('custom_contract_'+kind,qid),SCAN,before);items=[];examined=None
        social.prefetch_blocks(u,{'user':user},[r['author_id'] for r in refs])
        for entry in refs:
            examined=entry['sortKey']
            if kind=='enquiries':
                proposal=next((b for b in row['bids'] if b['id']==entry['bid_id']),None)
                if not proposal or user['id'] not in (row['owner_id'],proposal['contractor_id']):continue
            if social.blocked(u,user['id'],entry['author_id']):continue
            items.append({k:v for k,v in entry.items() if k!='sortKey'})
            if len(items)==limit:break
        more=bool(examined and (len(items)==limit or len(refs)==SCAN))
        return dict(items=items,members=public_members(u,[r['author_id'] for r in items]),nextCursor=encode_cursor(examined,user['id'],kind,qid) if more else None)

    def write_thread(u,qid,user,body,kind):
        row=get_query(u,qid);uid=user['id'];thread_access(u,row,user,kind,getattr(body,'bid_id',None),writing=True)
        if not user.get('phone_verified'):fail('PHONE_REQUIRED','Verify your phone before communicating about a contract.',403)
        if uid!=row['owner_id']:professional(u,user)
        rk,sig,old=receipt(u,uid,body,kind,qid);key=identifier('custom-'+kind,uid,body.request_id)
        source=social.lane('custom_contract_'+kind,qid)
        if old:return {'item':{k:v for k,v in u.get(source,key).items() if k!='sortKey'}}
        if kind=='comments' and body.parent_id:
            parent=u.get(source,body.parent_id)
            if not parent or parent.get('parent_id'):fail('REPLY_UNAVAILABLE','Reply to an existing root comment in this contract.',422)
        social.rate(u,uid,'custom-contract-'+kind,limit=60);stamp=time.time()
        item=dict(id=key,query_id=qid,author_id=uid,text=body.text,created_at=stamp,context='customer' if uid==row['owner_id'] else 'contractor' if (u.get('workers',uid) or {}).get('contractor_verified') else 'agent',sortKey=social.sort_key(int(stamp*1000),key))
        if kind=='enquiries':item['bid_id']=body.bid_id
        elif kind=='comments':item['parent_id']=body.parent_id
        u.put(source,key,item)
        if kind=='comments':
            stats=u.get('custom_contract_stats',qid) or {'views':0,'comments':0,'interests':0,'reactions':{r:0 for r in REACTIONS}}
            stats['comments']+=1;u.put('custom_contract_stats',qid,stats)
        elif kind=='messages':notification(u,row['awarded_contractor_id'] if uid==row['owner_id'] else row['owner_id'],uid,row,'custom_contract_message',row['winning_bid_id'],row['winning_project_id'],event_id=key)
        elif kind=='enquiries':
            proposal=next(b for b in row['bids'] if b['id']==body.bid_id)
            notification(u,proposal['contractor_id'] if uid==row['owner_id'] else row['owner_id'],uid,row,'custom_contract_enquiry',body.bid_id,row['winning_project_id'],event_id=key)
        activity = u.get('custom_contract_activity', qid) or {'version': 0}
        u.put('custom_contract_activity', qid, {'version': activity['version'] + 1})
        remember(u,rk,sig,key);return {'item':{k:v for k,v in item.items() if k!='sortKey'}}

    @router.get('/queries/{qid}/comments')
    def comments(qid:str,response:Response,cursor:str|None=None,limit:int=Query(default=20,ge=1,le=30),user=Depends(core.current_user)):
        response.headers['Cache-Control']='private, no-store';return store.run(lambda u:thread_page(u,qid,user,'comments',cursor,limit))
    @router.post('/queries/{qid}/comments',status_code=201)
    def comment(qid:str,body:Comment,user=Depends(core.current_user)):return store.run(lambda u:write_thread(u,qid,user,body,'comments'))
    @router.get('/queries/{qid}/enquiries')
    def enquiries(qid:str,response:Response,cursor:str|None=None,limit:int=Query(default=20,ge=1,le=30),user=Depends(core.current_user)):
        response.headers['Cache-Control']='private, no-store';return store.run(lambda u:thread_page(u,qid,user,'enquiries',cursor,limit))
    @router.post('/queries/{qid}/enquiries',status_code=201)
    def enquiry(qid:str,body:Enquiry,user=Depends(core.current_user)):return store.run(lambda u:write_thread(u,qid,user,body,'enquiries'))
    @router.get('/queries/{qid}/messages')
    def messages(qid:str,response:Response,cursor:str|None=None,limit:int=Query(default=20,ge=1,le=30),user=Depends(core.current_user)):
        response.headers['Cache-Control']='private, no-store';return store.run(lambda u:thread_page(u,qid,user,'messages',cursor,limit))
    @router.post('/queries/{qid}/messages',status_code=201)
    def message(qid:str,body:Comment,user=Depends(core.current_user)):return store.run(lambda u:write_thread(u,qid,user,body,'messages'))

    @router.post('/agent-opportunities')
    def agent_opportunities(body:AgentLocation,response:Response,user=Depends(core.current_user)):
        response.headers['Cache-Control']='private, no-store'
        def read(u):
            worker=professional(u,user);uid=user['id'];paid=(social.subscription_state(u,uid).get('subscription') or {}).get('plan')!='trial'
            if not paid:
                if not body.location_consent or not body.location:fail('LOCATION_CONSENT_REQUIRED','Choose to share a fresh location for nearby trial opportunities.',422)
                fresh_location(body.location)
            binding='agent:'+social.digest(json.dumps(body.location.model_dump() if body.location else None,sort_keys=True))
            before=decode_cursor(body.cursor,uid,'agent',binding)
            refs=sorted([ref for trade in sorted(worker_trades(worker))[:8] for ref in social.query(u,lane(trade,worker.get('city','')),SCAN,before)],key=lambda r:r['sortKey'],reverse=True)[:SCAN]
            u.prefetch([('contract_tenders',r['id']) for r in refs]);items=[];examined=None
            prefetch_queries(u,[row for ref in refs if (row:=u.get('contract_tenders',ref['id'])) and row.get('source_kind')==SOURCE],uid)
            for ref in refs:
                examined=ref['sortKey'];row=u.get('contract_tenders',ref['id'])
                if not row or row.get('source_kind')!=SOURCE or not row.get('workforce_requirements'):continue
                project=live_opening(u,row,worker) if row['status']=='awarded' else None
                if not project and (row['status']!='open' or time.time()>=row['deadline']):continue
                if not match(u,row,uid,contractor=False)['eligible']:continue
                if not paid and (not row.get('location') or metres(body.location.model_dump(),row['location'])>10000):continue
                item=query_view(u,row,user);item['phase']='jobs_open' if project else 'pending_award';item['permissions'].update(can_interest=not bool(project),can_bid=False,can_comment=False,can_react=False)
                item['message_recipients']=opening_recipients(u,row,user)
                item['permissions']['can_message_nearby']=trial_active(u,uid) and bool(item['message_recipients']) and bool(row.get('location'))
                if project:item.update(opening_project_id=project['id'],message_recipient_id=project['owner_id'])
                item['interest_access']='membership' if paid else 'nearby_trial'
                if body.location and body.location_consent and row.get('location'):item['distance_km']=round(metres(body.location.model_dump(),row['location'])/1000,1)
                items.append(item)
                if len(items)==body.limit:break
            more=bool(examined and (len(items)==body.limit or len(refs)==SCAN))
            return dict(items=items,members=[],nextCursor=encode_cursor(examined,uid,'agent',binding) if more else None)
        return store.run(read)

    @router.post('/queries/{qid}/interest')
    def interest(qid:str,body:Interest,user=Depends(core.current_user)):
        def save(u):
            uid=user['id'];row=get_query(u,qid);distance=agent_access(u,row,user,body.location,body.location_consent)
            if row['status']!='open' or time.time()>=row['deadline']:fail('INTEREST_CLOSED','Pre-award availability is closed for this request.',409)
            required={r['worker_type'] for r in row.get('workforce_requirements',[])}
            if body.worker_type not in required:fail('WORKER_TYPE_UNAVAILABLE','Choose a worker type requested by this customer.',422)
            rk,sig,old=receipt(u,uid,body,'interest',qid);key=social.digest(qid+':'+uid)
            if old:return {'interest':u.get('custom_contract_interests',key)}
            from account_profile import require_email
            require_email(u,user)
            previous=u.get('custom_contract_interests',key);social.rate(u,uid,'custom-contract-interest',limit=30)
            record=dict(id=key,query_id=qid,worker_id=uid,worker_type=body.worker_type,note=body.note,status='pending_award',available=True,
                created_at=previous['created_at'] if previous else time.time(),updated_at=time.time(),approx_distance_km=distance)
            u.put('custom_contract_interests',key,record);u.put(social.lane('custom_contract_interest',qid),key,{**record,'sortKey':social.sort_key(int(record['created_at']*1000),key)})
            stats=u.get('custom_contract_stats',qid) or {'views':0,'comments':0,'interests':0,'reactions':{r:0 for r in REACTIONS}}
            if not previous:stats['interests']+=1;u.put('custom_contract_stats',qid,stats)
            activity = u.get('custom_contract_activity', qid) or {'version': 0}
            u.put('custom_contract_activity', qid, {'version': activity['version'] + 1})
            remember(u,rk,sig,key);return {'interest':record}
        return store.run(save)

    @router.post('/queries/{qid}/agent-messages',status_code=201)
    def agent_message(qid:str,body:AgentMessage,user=Depends(core.current_user)):
        """A trial opening exception for professionals, never for customer chat."""
        def save(u):
            uid=user['id'];row=get_query(u,qid);worker=professional(u,user)
            if not trial_active(u,uid):fail('NEARBY_TRIAL_REQUIRED','Nearby opening messages are available during your first 60-day trial.',403)
            agent_access(u,row,user,body.location,body.location_consent,nearby_only=True)
            if row['status']=='awarded':
                pid=row.get('winning_project_id');project=live_opening(u,row,worker)
                if not project:
                    fail('OPENING_UNAVAILABLE','The awarded contractor has no current matching vacancy.',404)
                recipient=row.get('awarded_contractor_id')
                if body.recipient_id and body.recipient_id!=recipient:fail('RECIPIENT_UNAVAILABLE','Choose the contractor who owns this opening.',404)
            elif row['status']=='open' and time.time()<row['deadline']:
                recipient=body.recipient_id
                if not recipient or not any(b['contractor_id']==recipient and b['status']=='submitted' for b in row['bids']):
                    fail('RECIPIENT_UNAVAILABLE','Choose a registered contractor with a submitted proposal for this opening.',404)
                pid=None
            else:fail('OPENING_UNAVAILABLE','This opening is closed.',404)
            if recipient==uid or social.blocked(u,uid,recipient):fail('NOT_FOUND','Conversation unavailable.',404)
            professional(u,{'id':recipient,'phone_verified':True},contractor=True,paid_gate=False)
            recipient_member=u.get('rp_members',recipient)
            if not recipient_member:fail('RECIPIENT_UNAVAILABLE','This contractor has not joined Repaidians messaging.',404)
            privacy=(recipient_member.get('settings') or {}).get('messagePrivacy','everyone')
            if privacy=='nobody' or privacy=='following' and not (u.get('rp_follows',social.digest(recipient+':'+uid)) or {}).get('active'):
                fail('MESSAGES_RESTRICTED','This contractor is not accepting messages from you.',403)
            rk,sig,old=receipt(u,uid,body,'agent-opening-message',qid)
            key=identifier('custom-opening-message',uid,body.request_id)
            source='rp_thread_'+social.digest(':'.join(sorted((uid,recipient))))
            if old:return {'message':{k:v for k,v in u.get(source,key).items() if k!='sortKey'}}
            social.member_ensure(u,user);social.rate(u,uid,'custom-agent-opening-message',limit=30);stamp=social.now_ms()
            item=dict(id=key,senderId=uid,authorId=uid,recipientId=recipient,text=body.text,createdAt=stamp,
                sortKey=social.sort_key(stamp,key),queryId=qid,openingContext='awarded_vacancy' if pid else 'pending_award_availability')
            if pid:item['projectId']=pid
            u.put(source,key,item)
            for actor,other in ((uid,recipient),(recipient,uid)):
                u.put(social.lane('rp_threads',actor),other,dict(id=other,recipientId=other,lastMessage=item['text'],lastSenderId=uid,updatedAt=stamp,sortKey=social.sort_key(stamp,other)))
            social.notify(u,recipient,uid,'message',uid);remember(u,rk,sig,key)
            return {'message':{k:v for k,v in item.items() if k!='sortKey'}}
        return store.run(save)

    @router.get('/queries/{qid}/interests')
    def interests(qid:str,response:Response,cursor:str|None=None,limit:int=Query(default=20,ge=1,le=30),user=Depends(core.current_user)):
        response.headers['Cache-Control']='private, no-store'
        def read(u):
            row=get_query(u,qid);access(u,row,user)
            if user['id']!=row['owner_id']:professional(u,user,contractor=True)
            if row['status']=='awarded' and not parties(row,user['id']):fail('NOT_FOUND','Contract team interests are private to the awarded parties.',404)
            before=decode_cursor(cursor,user['id'],'interests',qid);refs=social.query(u,social.lane('custom_contract_interest',qid),limit+1,before)
            social.prefetch_blocks(u,{'user':user},[r['worker_id'] for r in refs])
            items=[{k:v for k,v in value.items() if k not in ('sortKey','approx_distance_km')} for value in refs[:limit] if not social.blocked(u,user['id'],value['worker_id'])]
            return dict(items=items,members=public_members(u,[r['worker_id'] for r in items]),nextCursor=encode_cursor(refs[limit-1]['sortKey'],user['id'],'interests',qid) if len(refs)>limit else None)
        return store.run(read)

    @router.get('/public/{qid}/progress')
    def public_progress(qid:str):
        def read(u):
            row=get_query(u,qid)
            if row['status']!='awarded' or not row['controls']['public_progress']:fail('NOT_FOUND','No public progress summary is shared.',404)
            project=u.get('contract_projects',row['winning_project_id']) or {}
            goals=project.get('goals',[])
            return dict(id=project.get('id'),query_id=qid,title=row['title'],city=row['city'],sector=row['sector'],status=project.get('status'),
                progress={'approved':sum(g.get('status')=='approved' for g in goals),'total':len(goals)})
        return store.run(read)

    core.app.include_router(router)
