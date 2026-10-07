"""Authoritative field-service commands. No client-supplied prices or privileged states.

Uses the configured transactional store (Firestore or SQLite), integer paise,
immutable scope snapshots and an outbox. External delivery/payment stays explicit.
"""
import copy
import hashlib
import json
import math
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, ConfigDict


def fail(code, message, status=409):
    raise HTTPException(status, {'code': code, 'message': message})


def metres(a, b):
    p, q = math.radians(a['lat']), math.radians(b['lat'])
    x = math.sin((q-p)/2)**2 + math.cos(p)*math.cos(q)*math.sin(math.radians(b['lng']-a['lng'])/2)**2
    return 6371000 * 2 * math.atan2(math.sqrt(x), math.sqrt(max(0, 1-x)))


class Input(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Pin(Input):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class Position(Pin):
    accuracy: float = Field(ge=0, le=100)
    captured_at: float


class Onboarding(Input):
    name: str = Field(min_length=2, max_length=100)
    dob: str
    city: str = Field(min_length=2, max_length=80)
    home_address: str = Field(min_length=10, max_length=500)
    location: Pin
    requested_role: Literal['technician', 'specialist'] = 'technician'
    categories: list[str] = Field(min_length=1, max_length=12)
    skills: list[str] = Field(min_length=1, max_length=30)
    tools: list[str] = Field(min_length=1, max_length=30)
    experience_years: int = Field(ge=0, le=60)
    radius_km: float = Field(gt=0, le=6)
    partner_policy_version:str
    partner_policy_sections:list[str]=Field(max_length=10)
    terms_version: Literal['field-service-v1']
    # Never receive Aadhaar/bank credentials or document blobs in a public profile.
    # Private provider references are attached by the verification integration only.


class WorkerReview(Input):
    decision: Literal['approved', 'rejected']
    role: Literal['technician', 'specialist'] = 'technician'
    reason: str = Field(min_length=10, max_length=500)
    evidence_reference: str = Field(default='manual-onboarding-review', min_length=8, max_length=200)
    identity_reviewed: bool = False
    document_ids: list[str] = Field(default_factory=list, max_length=100)


class AvailabilityPosition(Position):
    # Discovery tolerates coarse GPS; arrival/proof still require precise GPS.
    accuracy: float = Field(ge=0, le=1000)


class Availability(Input):
    online: bool
    position: AvailabilityPosition | None = None
    heartbeat: bool = False


class InventoryItem(Input):
    id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,100}$')
    name: str = Field(min_length=3, max_length=200)
    shop_id: str = Field(min_length=1, max_length=100)
    price_paise: int = Field(gt=0, le=100000000)
    stock: int = Field(ge=0, le=100000)
    status: Literal['approved', 'suspended']


class Shop(Input):
    id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,100}$')
    owner_id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=3, max_length=200)
    location: Pin
    status: Literal['approved', 'suspended']
    evidence_reference: str = Field(min_length=8, max_length=200)


class Discovery(Input):
    location: Pin
    city: str
    category: str | None = None
    radius_km: float = Field(default=6, gt=0, le=6)
    offset: int = Field(default=0, ge=0, le=10000)
    limit: int = Field(default=24, ge=1, le=24)


class Booking(Input):
    coupon_code: str | None = Field(default=None,max_length=30)
    promotion_id: str | None = Field(default=None,max_length=80)
    service_id: str
    city: str
    address: str = Field(min_length=10, max_length=500)
    phone: str = Field(pattern=r'^\+?[0-9]{10,15}$')
    location: Pin
    starts_at: str
    notes: str = Field(default='', max_length=1000)
    service_terms_version: int | None = None
    idempotency_key: str = Field(min_length=16, max_length=100)


class Command(Input):
    action: Literal['schedule_follow_up','accept', 'decline', 'ack_reminder', 'depart', 'position', 'stop_tracking',
                    'start', 'propose_parts', 'approve_parts', 'reject_parts', 'collect_parts',
                    'return_to_site', 'install_parts', 'parts_unavailable', 'submit_completion', 'accept_completion',
                    'dispute', 'cancel', 'reschedule', 'review', 'retry_dispatch']
    expected_version: int = Field(ge=1)
    command_id: str = Field(min_length=16, max_length=100)
    payload: dict = Field(default_factory=dict)


class Store:
    def __init__(self, core):
        self.core = core

    def init(self):
        with self.core.db() as c:
            c.execute('CREATE TABLE IF NOT EXISTS operation_records (kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(kind,id))')
            # Browse by city and fetch a candidate's work without reading every record.
            c.execute("CREATE INDEX IF NOT EXISTS operation_workers_city ON operation_records(json_extract(body,'$.city')) WHERE kind='workers'")
            c.execute("CREATE INDEX IF NOT EXISTS operation_workers_online ON operation_records(json_extract(body,'$.online')) WHERE kind='workers'")
            c.execute("CREATE INDEX IF NOT EXISTS operation_jobs_customer ON operation_records(json_extract(body,'$.customer_id')) WHERE kind='jobs'")
            c.execute("CREATE INDEX IF NOT EXISTS operation_members_handle ON operation_records(json_extract(body,'$.handle')) WHERE kind='rp_members'")
            c.execute("CREATE INDEX IF NOT EXISTS operation_blocks_owner ON operation_records(json_extract(body,'$.from')) WHERE kind='rp_blocks'")
            c.execute("CREATE INDEX IF NOT EXISTS operation_notifications_user ON operation_records(json_extract(body,'$.user_id')) WHERE kind='notifications'")
            c.execute("CREATE INDEX IF NOT EXISTS operation_jobs_worker ON operation_records(json_extract(body,'$.worker_id')) WHERE kind='jobs'")
            c.execute("CREATE INDEX IF NOT EXISTS operation_hires_worker ON operation_records(json_extract(body,'$.worker_id')) WHERE kind='hires'")
            c.execute("CREATE INDEX IF NOT EXISTS operation_offers_worker ON operation_records(json_extract(body,'$.worker_id')) WHERE kind='professional_offers'")

    def run(self, callback):
        if self.core.USE_FIRESTORE:
            from firebase_admin import firestore
            @firestore.transactional
            def apply(transaction):
                u = Unit(self.core, transaction=transaction)
                result = callback(u)
                u.flush()
                return result
            return apply(self.core.fb_db.transaction())
        with self.core.db() as c:
            c.execute('BEGIN IMMEDIATE')
            u = Unit(self.core, connection=c)
            result = callback(u)
            u.flush()
            return result


class Unit:
    def __init__(self, core, transaction=None, connection=None):
        self.core, self.tx, self.conn = core, transaction, connection
        self.pending = {}
        self.fetched = {}

    def get(self, kind, key):
        if (kind, key) in self.pending:
            return copy.deepcopy(self.pending[kind, key])
        if (kind, key) in self.fetched:
            return copy.deepcopy(self.fetched[kind, key])
        if self.tx is not None:
            s = self.core.fs_doc('ops_' + kind, key).get(transaction=self.tx)
            value = s.to_dict() if s.exists else None
            self.fetched[kind, key] = value
            return copy.deepcopy(value)
        row = self.conn.execute('SELECT body FROM operation_records WHERE kind=? AND id=?', (kind, key)).fetchone()
        return json.loads(row['body']) if row else None

    def prefetch(self, pairs):
        """Fetch independent Firestore documents in bounded batches instead of serial RPCs."""
        if self.tx is None: return
        missing = list(dict.fromkeys((kind, key) for kind, key in pairs
                                     if (kind, key) not in self.pending and (kind, key) not in self.fetched))
        for start in range(0, len(missing), 200):
            batch = missing[start:start+200]
            references = [self.core.fs_doc('ops_' + kind, key) for kind, key in batch]
            refs = {reference.path: pair for reference, pair in zip(references, batch)}
            loaded = {pair: None for pair in batch}
            for snapshot in self.core.fb_db.get_all(references, transaction=self.tx):
                pair = refs.get(snapshot.reference.path)
                if pair: loaded[pair] = snapshot.to_dict() if snapshot.exists else None
            self.fetched.update(loaded)

    def all(self, kind):
        if self.tx is not None:
            rows = {s.id: s.to_dict() for s in self.core.fs_collection('ops_' + kind).stream(transaction=self.tx)}
        else:
            rows = {r['id']: json.loads(r['body']) for r in self.conn.execute('SELECT id,body FROM operation_records WHERE kind=?', (kind,))}
        rows.update({key: copy.deepcopy(value) for (k, key), value in self.pending.items() if k == kind})
        return list(rows.values())

    def find(self, kind, field, value):
        """Indexed equality lookups with transaction-local writes overlaid."""
        allowed = {'workers': {'city', 'online'}, 'jobs': {'worker_id', 'customer_id'}, 'notifications': {'user_id'}, 'hires': {'worker_id'},
                   'professional_offers': {'worker_id'}, 'rp_members': {'handle'}, 'rp_blocks': {'from'}}
        if field not in allowed.get(kind, set()):
            raise ValueError('Unsupported indexed lookup')
        if self.tx is not None:
            query = self.core.fs_collection('ops_' + kind).where(field, '==', value)
            rows = {s.id: s.to_dict() for s in query.stream(transaction=self.tx)}
        else:
            sql = f"SELECT id,body FROM operation_records WHERE kind=? AND json_extract(body,'$.{field}')=?"
            rows = {r['id']: json.loads(r['body']) for r in self.conn.execute(sql, (kind, int(value) if isinstance(value, bool) else value))}
        self.fetched.update({(kind, key): copy.deepcopy(item) for key, item in rows.items()})
        for (pending_kind, key), item in self.pending.items():
            if pending_kind == kind:
                if item.get(field) == value: rows[key] = copy.deepcopy(item)
                else: rows.pop(key, None)
        return list(rows.values())

    def for_workers(self, kind, worker_ids, fields=None):
        """Indexed worker lookup, batched to at most 30 IDs on Firestore."""
        if kind not in ('jobs', 'hires', 'professional_offers'): raise ValueError('Unsupported worker lookup')
        if fields is not None:
            allowed={'jobs': {'worker_id','state','review','service_name','category','service_id','home_plan_id','completed_at'},
                     'hires': {'id','worker_id','state'}, 'professional_offers': {'worker_id'}}
            if not set(fields) <= allowed[kind] or 'worker_id' not in fields:
                raise ValueError('Unsupported projection')
        ids = list(set(worker_ids))
        if not ids: return []
        if self.tx is not None:
            rows = {}
            for start in range(0, len(ids), 30):
                batch = ids[start:start+30]
                query = self.core.fs_collection('ops_' + kind).where('worker_id', 'in', batch)
                if fields is not None: query=query.select(fields)
                rows.update({s.id: s.to_dict() for s in query.stream(transaction=self.tx)})
        else:
            rows = {}
            for start in range(0, len(ids), 500):
                batch = ids[start:start+500]
                placeholders = ','.join('?' for _ in batch)
                sql = f"SELECT id,body FROM operation_records WHERE kind=? AND json_extract(body,'$.worker_id') IN ({placeholders})"
                rows.update({r['id']: json.loads(r['body']) for r in self.conn.execute(sql, (kind, *batch))})
        allowed = set(ids)
        for (pending_kind, key), item in self.pending.items():
            if pending_kind == kind:
                if item.get('worker_id') in allowed: rows[key] = copy.deepcopy(item)
                else: rows.pop(key, None)
        if fields is not None:return [{field:row[field] for field in fields if field in row} for row in rows.values()]
        return list(rows.values())

    def put(self, kind, key, value):
        self.pending[kind, key] = copy.deepcopy(value)
        if kind in ('contract_tenders', 'contract_projects', 'inventory', 'market_listings', 'retail_orders'):
            from repaidians_opportunities import index_record
            index_record(self, kind, key, value)
        if kind in ('contract_projects', 'contract_tenders', 'contract_profiles', 'rp_members', 'workers', 'rp_follows'):
            from repaidians_work import index_record as index_work_record
            index_work_record(self, kind, key, value)
        if kind in ('devices', 'rp_work_delivery'):
            from work_push import index_record as index_push_record
            index_push_record(self, kind, key, value)

    def flush(self):
        for (kind, key), value in self.pending.items():
            if self.tx is not None:
                self.tx.set(self.core.fs_doc('ops_' + kind, key), value)
            else:
                self.conn.execute('INSERT INTO operation_records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body', (kind, key, json.dumps(value)))


def event(u, job, kind, actor, payload=None):
    eid = str(uuid.uuid4())
    envelope = dict(event_id=eid, event_type=kind, occurred_at_server_time=time.time(),
                    aggregate_type='work_order', aggregate_id=job['id'], aggregate_version=job['version'], visit_id=job.get('visit_id'),
                    actor_id=actor, correlation_id=job['id'], schema_version=1, payload=payload or {})
    # Kept atomically with the aggregate; a relay must mark delivery separately.
    u.put('outbox', eid, {**envelope, 'delivery_status': 'pending', 'recipient_ids': list(filter(None, [job['customer_id'], job.get('worker_id')]))})
    job['events'].append({k: envelope[k] for k in ('event_id', 'event_type', 'occurred_at_server_time', 'aggregate_version')})


def monitor_worksite(u,j,now,actor):
    """GPS uncertainty is not evidence of a violation. One review per exit."""
    p=j.get('position')
    if j['state']!='in_progress' or not p or p.get('accuracy',999)>50 or now-p.get('received_at',0)>120:return
    distance=metres(p,j['location'])
    if distance-p['accuracy']>200 and not j.get('worksite_exit_open'):
        j['worksite_exit_open']=True
        event(u,j,'WorksiteExitNeedsReview',actor,{'visit_id':j['visit_id'],'distance_metres':round(distance),'accuracy_metres':p['accuracy']})
    elif distance+p['accuracy']<=100:
        j['worksite_exit_open']=False


def assign(u, job, now):
    occupied = {j['worker_id'] for j in u.all('jobs') if j['id'] != job['id'] and j.get('worker_id') and j['state'] not in ('completed', 'cancelled') and not (j.get('home_plan_id') and j['state']=='accepted' and abs(j['starts_epoch']-job['starts_epoch'])>(j.get('duration_minutes',120)+job.get('duration_minutes',120))*60+1800) and not (j['state']=='follow_up_scheduled' and abs(j['starts_epoch']-job['starts_epoch'])>=7200)}
    occupied |= {h['worker_id'] for h in u.all('hires') if h['state'] in ('offered','quoting','quoted') and (h.get('quote_expires_at',h.get('offer_expires_at',0))>now or h.get('quote_lease_until',0)>now)}
    candidates = []
    for w in u.all('workers'):
        if w['status'] != 'approved' or not w.get('online') or w['id'] in occupied or w['id'] in job['attempted_workers']:
            continue
        p = w.get('position')
        if not p or now - p['received_at'] > 900 or w['city'].casefold() != job['city'].casefold() or job['category'] not in w['categories']:
            continue
        from home_plans import conflict
        if conflict(u,w['id'],job['starts_epoch'],job.get('duration_minutes',120),exclude_job=job['id']):continue
        distance = metres(p, job['location'])
        if distance + p.get('accuracy',0) > min(6, w['radius_km']) * 1000:
            continue
        # Skill/category eligibility precedes genuine completed-review aggregates and distance.
        avg = w.get('rating_sum', 0) / max(1, w.get('rating_count', 0))
        candidates.append(((-avg, distance, -w.get('completed_tasks', 0), w['id']), w))
    job['worker_id'] = None
    job['state'] = 'searching'
    if candidates:
        w = sorted(candidates, key=lambda x: x[0])[0][1]
        job.update(worker_id=w['id'], worker_name=w['name'], worker_role=w['role'], state='offered', offer_expires_at=now+900)
        job['attempted_workers'].append(w['id'])
        event(u, job, 'AssignmentOffered', 'dispatch', {'offer_expires_at':job['offer_expires_at']})
        offer_id = f"{job['id']}_{job['visit_id']}_{w['id']}_{int(now*1000)}"
        job['assignment_metric_id'] = offer_id
        u.put('assignment_metrics', offer_id, dict(id=offer_id, worker_id=w['id'], job_id=job['id'], offered_at=now))
    else:
        job['worker_name'] = None
        job['worker_role'] = None


def dispatch_waiting(u, now):
    """Retry queued work when supply changes, atomically reserving each worker once."""
    assigned = 0
    for job in sorted(u.all('jobs'), key=lambda j: (j.get('created_at', 0), j['id'])):
        if job['state'] != 'searching' or job['starts_epoch'] <= now:
            continue
        job['version'] += 1
        assign(u, job, now)
        if job['state'] == 'offered':
            u.put('jobs', job['id'], job)
            assigned += 1
    return assigned


def fresh_position(job, now):
    p = job.get('position')
    return bool(p and now-p['received_at'] <= 120 and p['accuracy'] <= 50)


def at_site(job, now):
    manual=job.get('manual_arrival',{})
    return (manual.get('confirmed_by')==job['customer_id'] and 0<=now-manual.get('at',0)<=1800) or (fresh_position(job, now) and metres(job['position'], job['location']) + job['position']['accuracy'] <= 100)


def actions(job, actor, now):
    state = job['state']
    result = []
    if actor == job['customer_id']:
        if state in ('searching', 'offered', 'accepted', 'en_route', 'arrived'):
            result += ['cancel', 'reschedule']
        if state == 'searching': result += ['retry_dispatch']
        if state=='in_progress':
            if job.get('proposal',{}).get('status')=='pending':result += ['approve_parts','reject_parts']
            elif job.get('proposal',{}).get('status')=='awaiting_payment':result += ['reject_parts']
        if state == 'completion_pending': result += ['accept_completion', 'dispute']
        if state == 'completed' and not job.get('review'): result += ['review']
    if actor == job.get('worker_id'):
        if state == 'offered' and now < job['offer_expires_at']: result += ['accept', 'decline']
        if state in ('accepted','follow_up_scheduled'):
            if now >= job['reminder_at'] and not job.get('reminder_ack_at'): result += ['ack_reminder']
            if state=='accepted' and (job.get('reminder_ack_at') or now < job['reminder_at']): result += ['depart']
            if state=='follow_up_scheduled' and job.get('reminder_ack_at') and now>=job['starts_epoch']-3600:result += ['depart']
        if state in ('en_route', 'arrived', 'in_progress', 'collecting_parts'):
            result += ['position', 'stop_tracking']
        if state == 'arrived': result += ['start']
        if state in ('in_progress','follow_up_required','follow_up_scheduled'):result += ['schedule_follow_up']
        if state == 'in_progress':
            if not job.get('proposal') or job['proposal']['status'] in ('rejected', 'installed'): result += ['propose_parts']
            if not job.get('proposal') or job['proposal']['status'] in ('rejected', 'installed'):
                result += ['submit_completion']
            if job.get('proposal', {}).get('status') == 'approved': result += ['collect_parts', 'parts_unavailable']
            if job.get('proposal', {}).get('status') == 'received': result += ['install_parts']
        if state == 'collecting_parts': result += ['return_to_site']
    if job.get('home_plan_id'):
        result=[a for a in result if a not in ('cancel','reschedule','schedule_follow_up','retry_dispatch')]
        if now<job['starts_epoch']-3600:result=[a for a in result if a!='depart']
    return result


def public_job(u, job, actor, admin=False):
    now = time.time()
    if not admin and actor not in (job['customer_id'], job.get('worker_id')):
        fail('NOT_FOUND', 'This booking is not available to your account.', 404)
    value = copy.deepcopy(job)
    value.pop('commands', None)
    value.pop('attempted_workers', None)
    value.pop('hire_origin', None)
    value.pop('position', None)  # Raw worker coordinates are not a customer tracking feed.
    customer = actor == job['customer_id']
    if not customer and not admin:
        if not (fresh_position(job, now) and metres(job['position'], job['location']) + job['position']['accuracy'] <= 150 and job['state'] in ('arrived', 'in_progress')):
            value.pop('phone', None)
        if job['state'] in ('offered', 'searching', 'completed', 'cancelled'):
            value.pop('location', None)
            value.pop('address', None)
            value.pop('notes', None)
        elif not job.get('reminder_ack_at') and job['state'] == 'accepted':
            value.pop('location', None)
        fields = [key for key in ('phone', 'location', 'address') if key in value]
        if fields:
            audit_id = hashlib.sha256(f"{actor}:{job['id']}:{int(now//300)}".encode()).hexdigest()
            u.put('audit', audit_id, {'id': audit_id, 'actor_id': actor, 'job_id': job['id'], 'action': 'AssignedLocationAccessed', 'fields': fields, 'at': now})
    value.pop('tracking_generation', None)
    value['allowed_actions'] = actions(job, actor, now) if not admin else []
    value['server_time'] = now
    value['distance_metres'] = round(metres(job['position'], job['location'])) if fresh_position(job, now) else None
    value['blockers'] = []
    if actor == job.get('worker_id') and job.get('proposal', {}).get('status') == 'approved':
        shops = [u.get('shops', sid) for sid in {i['shop_id'] for i in job['proposal']['items']}]
        value['pickup_locations'] = [{'name': s['name'], 'location': s['location']} for s in shops if s]
    if job['state'] == 'searching': value['blockers'].append('NO_AVAILABLE_WORKER_WITHIN_6KM')
    if job['state'] in ('en_route', 'collecting_parts') and not at_site(job, now): value['blockers'].append('FRESH_ACCURATE_LOCATION_WITHIN_100M_REQUIRED')
    if job['payment_status'] != 'verified': value['blockers'].append('PAYOUT_HELD_UNTIL_PAYMENT_VERIFIED')
    evidence_items = [u.get('evidence', eid) for eid in job.get('evidence_ids', [])]
    valid_evidence = [e for e in evidence_items if e and e.get('status') == 'ready' and e.get('visit_id') == job.get('visit_id')]
    value['evidence_summary'] = {
        'has_before': any(e.get('kind') == 'before' for e in valid_evidence),
        'has_after': any(e.get('kind') == 'after' for e in valid_evidence),
        'has_forgotten_info': bool(job.get('forgotten_info') or job.get('before_omission_reason')),
        'before_omission_reason': job.get('forgotten_info') or job.get('before_omission_reason') or '',
        'count': len(valid_evidence)
    }
    return value


def command_response(u, job, actor):
    if actor not in (job['customer_id'], job.get('worker_id')):
        # A successful decline revokes access immediately; don't leak the next assignee.
        return {'id': job['id'], 'version': job['version'], 'state': 'released', 'allowed_actions': []}
    return public_job(u, job, actor)


def assess_penalties(u, j, now):
    if j.get("home_plan_id"):return False  # New home-plan SLA terms require explicit policy; attendance stays auditable.
    if not j.get('accepted_at') or j['state'] in ('stop_requested','disputed','follow_up_required','completed','cancelled'): return False
    changed = False
    codes = {p['code'] for p in j['penalties'] if p.get('visit_id') == j['visit_id']}
    if not j.get('is_follow_up') and (j.get('reminder_ack_at') or now) >= j['reminder_at']+600 and 'MISSED_REMINDER' not in codes:
        j['penalties'].append({'code': 'MISSED_REMINDER', 'worker_id': j['worker_id'], 'visit_id': j['visit_id'], 'current_percent': 10, 'next_task_percent': 20, 'assessed_at': now, 'status': 'pending_settlement_review'})
        from integrations import penalty_obligation
        penalty_obligation(u, j, j['penalties'][-1])
        event(u, j, 'PenaltyAssessed', 'scheduler', {'code': 'MISSED_REMINDER'})
        changed = True
    if not j.get('is_follow_up') and (j.get('departed_at') or now) >= j['starts_epoch']-1800 and 'LATE_DEPARTURE' not in codes:
        j['penalties'].append({'code': 'LATE_DEPARTURE', 'worker_id': j['worker_id'], 'visit_id': j['visit_id'], 'current_percent': 20, 'assessed_at': now, 'status': 'pending_settlement_review'})
        event(u, j, 'PenaltyAssessed', 'scheduler', {'code': 'LATE_DEPARTURE'})
        changed = True
    return changed


def enrich_professional_badges(u, public_rows, worker_by_id):
    """Enroll/project only the returned page, with independent billing reads batched.

    Callers rank and paginate before this helper. Public allowlists stay in the
    caller; private worker or payment records never merge into a customer card.
    """
    from repaidians_billing import membership_badge
    ids = [row['id'] for row in public_rows]
    u.prefetch([(kind, uid) for uid in ids for kind in ('rp_members', 'rp_trials', 'rp_subscriptions')])
    for row in public_rows:
        row['repaidianBadge'] = membership_badge(u, row['id'], worker=worker_by_id[row['id']])
    return public_rows


def own_worker_projection(u, worker):
    """Every own-worker response preserves the same authoritative avatar metadata."""
    if not worker:
        return None
    from repaidians_billing import membership_badge
    uid = worker['id']
    u.prefetch([(kind, uid) for kind in ('worker_profiles', 'rp_members', 'rp_trials', 'rp_subscriptions')])
    profile = u.get('worker_profiles', uid) or {}
    return {**worker, 'repaidianBadge': membership_badge(u, uid, worker=worker),
            'portrait_url': f"/api/operations/professional-media/{profile['portrait_id']}" if profile.get('portrait_id') else None}


def install(core):
    router = APIRouter(prefix='/operations', tags=['Field operations'])
    store = Store(core)
    core.operations_store = store

    def worker_user(user=Depends(core.current_user)):
        if not user.get('phone_verified'):
            fail('PHONE_AUTH_REQUIRED', 'Sign in using your phone OTP before opening the worker account.', 403)
        return user

    @router.get('/worker/me')
    def worker_me(user=Depends(worker_user)):
        def read(u):
            worker=u.get('workers',user['id'])
            return {'worker':own_worker_projection(u, worker),'verification_uploads_available':bool(__import__('os').getenv('REPAIDO_KYC_BUCKET'))}
        return store.run(read)

    @router.post('/worker/onboarding')
    def onboard(body: Onboarding, user=Depends(worker_user)):
        # Store canonical catalogue names so dispatch uses the same city as bookings.
        city = next((city for city in core.CITIES if city.casefold() == body.city.strip().casefold()), None)
        if city is None:
            fail('OUTSIDE_COVERAGE', 'Choose your service city from the supported-city list.', 422)
        body.city = city
        try:
            dob = datetime.strptime(body.dob, '%Y-%m-%d').date()
            today = datetime.now(timezone.utc).date()
            age = today.year-dob.year-((today.month, today.day)<(dob.month, dob.day))
            if age < 18 or age > 100: raise ValueError()
        except ValueError:
            fail('INVALID_DOB', 'Enter your date of birth. Workers must be at least 18.', 422)
        from home_plans import OFFERINGS
        known_categories = {s[1] for s in core.SERVICES}|{s['category'] for s in OFFERINGS}
        if not set(body.categories) <= known_categories:
            fail('UNKNOWN_CATEGORY', 'Choose a category in the live catalogue.', 422)
        def save(u):
            old = u.get('workers', user['id'])
            if old and old['status'] == 'approved': fail('ALREADY_APPROVED', 'Your account is already onboarded.')
            from partner_program import accept
            accept(u,user['id'],body.partner_policy_version,body.partner_policy_sections)
            worker = dict(body.model_dump(), id=user['id'], phone=user['phone'], role='technician',
                          status='pending_verification', online=False, points=0, completed_tasks=0,
                          rating_sum=0, rating_count=0, has_specialist_kit=False,
                          verification_blocker='PRIVATE_DOCUMENT_REVIEW_REQUIRED', created_at=time.time())
            if old:
                # Reapplying must never erase completed work or negative review history.
                for key in ('points', 'completed_tasks', 'rating_sum', 'rating_count', 'has_specialist_kit', 'created_at'):
                    worker[key] = old[key]
            if old:
                v=u.get('verification',user['id']) or {'bank_status':'not_verified'}
                v.update(identity_status='pending_review',submitted_at=None,submitted_document_ids=[])
                if old.get('name')!=body.name:v['bank_status']='not_verified'
                u.put('verification',user['id'],v)
            u.put('workers', user['id'], worker)
            return {'worker': worker, 'message': 'Profile saved. Continue with identity, PAN, address and tools uploads, then submit for review.'}
        return store.run(save)

    @router.post('/worker/availability')
    def availability(body: Availability, user=Depends(worker_user)):
        def save(u):
            w = u.get('workers', user['id'])
            if not w or w['status'] != 'approved': fail('APPROVAL_REQUIRED', 'Your worker profile must be approved before going online.', 403)
            # A delayed heartbeat must never undo an explicit offline choice.
            if body.heartbeat and not w.get('online'):
                return {'worker':own_worker_projection(u, w),'new_assignments':0}
            if bool(w.get('online')) != body.online:
                eid = str(uuid.uuid4())
                u.put('availability_events', eid, dict(id=eid,worker_id=w['id'],online=body.online,at=time.time()))
            w['online'] = body.online
            if body.position:
                if abs(time.time()-body.position.captured_at) > 120: fail('STALE_POSITION', 'Get a fresh GPS reading.')
                w['position'] = {**body.position.model_dump(), 'received_at': time.time()}
            if body.online and (not w.get('position') or time.time()-w['position']['received_at'] > 900): fail('LOCATION_REQUIRED', 'Confirm a fresh location to receive nearby work.')
            if body.online and body.position:
                sample=f"{w['id']}_{int(time.time()//300)}"
                u.put('availability_samples',sample,dict(id=sample,worker_id=w['id'],at=time.time()))
            u.put('workers', w['id'], w)
            assigned = dispatch_waiting(u, time.time()) if body.online else 0
            return {'worker': own_worker_projection(u, w), 'new_assignments': assigned}
        return store.run(save)

    @router.get('/admin/workers', dependencies=[Depends(core.operator)])
    def review_queue():
        return store.run(lambda u: {'workers': u.all('workers')})

    @router.post('/admin/workers/{worker_id}/review')
    def review_worker(worker_id: str, body: WorkerReview, admin=Depends(core.operator)):
        def save(u):
            w = u.get('workers', worker_id)
            if not w: fail('NOT_FOUND', 'Worker not found.', 404)
            if body.decision == 'approved':
                verification = u.get('verification', worker_id) or {}
                if verification.get('identity_status') != 'approved':
                    docs = [d for d in u.all('documents') if d['worker_id'] == worker_id and d['status'] == 'pending_review' and d['expires_at'] > time.time()]
                    if not body.identity_reviewed or not {'identity','pan','address','tools'} <= {d['kind'] for d in docs}:
                        fail('VERIFICATION_REQUIRED', 'Review identity, PAN, address and tools evidence, and confirm the identity match before approval.')
                    if set(body.document_ids) != {d['id'] for d in docs} or any(d['worker_id'] == worker_id and d['status'] == 'uploading' and d['created_at'] > time.time()-600 for d in u.all('documents')):
                        fail('DOCUMENTS_CHANGED', 'Documents changed. Refresh the application and review the latest files.')
                    verification.update(identity_status='approved', identity_reviewed_by=admin['id'], identity_reviewed_at=time.time(), identity_evidence='onboarding-case:'+worker_id, review_reason=body.reason, reviewed_document_ids=body.document_ids)
                    verification.setdefault('bank_status','not_verified')
                    u.put('verification', worker_id, verification)
                    aid = str(uuid.uuid4())
                    u.put('audit', aid, dict(id=aid, action='IdentityManuallyReviewed', actor_id=admin['id'], worker_id=worker_id, at=time.time(), document_ids=body.document_ids))
                # Joining and dispatch are independent of bank validation. Payouts remain gated separately.
            w.update(status=body.decision, role=body.role, review_reason=body.reason,
                     evidence_reference=body.evidence_reference, reviewed_at=time.time())
            if body.decision == 'rejected': w['online'] = False
            u.put('workers', worker_id, w)
            aid = str(uuid.uuid4())
            u.put('audit', aid, {'id': aid, 'action': 'WorkerReviewed', 'actor_id': admin['id'], 'worker_id': worker_id, 'decision': body.model_dump(), 'at': time.time()})
            return {'worker': w}
        return store.run(save)

    @router.get('/admin/jobs')
    def admin_jobs(admin=Depends(core.operator)):
        def read(u):
            aid = str(uuid.uuid4())
            u.put('audit', aid, {'id': aid, 'action': 'OperationalLocationsAccessed', 'actor_id': admin['id'], 'at': time.time()})
            return {'jobs': [public_job(u, j, '', admin=True) for j in u.all('jobs')]}
        return store.run(read)

    @router.get('/admin/audit', dependencies=[Depends(core.operator)])
    def audit():
        return store.run(lambda u: {'audit': u.all('audit'), 'ledger': u.all('ledger')})

    @router.post('/admin/shops', dependencies=[Depends(core.operator)])
    def shop(body: Shop):
        def save(u):
            existing=u.get('shops',body.id)
            if existing and existing.get('version'): fail('APPLICATION_REVIEW_REQUIRED','Use the versioned shop application review to update this shop.')
            u.put('shops', body.id, body.model_dump())
            return {'shop': body.model_dump()}
        return store.run(save)

    @router.post('/admin/inventory', dependencies=[Depends(core.operator)])
    def inventory_update(body: InventoryItem):
        def save(u):
            shop = u.get('shops', body.shop_id)
            if not shop or shop['status'] != 'approved': fail('SHOP_NOT_APPROVED', 'Approve the registered shop before listing its inventory.')
            old=u.get('inventory',body.id)
            if old and old.get('reserved',0): fail('RESERVED_STOCK','Use shop inventory management; existing reservations must be preserved.')
            u.put('inventory', body.id, {**body.model_dump(),'stock_confirmed_at':time.time(),'version':(old or {}).get('version',0)+1,'reserved':0})
            return {'item': body.model_dump()}
        return store.run(save)

    @router.get('/shop/orders')
    def shop_orders(user=Depends(core.current_user)):
        if not user.get('phone_authenticated'): fail('PHONE_OTP_REQUIRED', 'Sign in with mobile OTP to access shop orders.', 403)
        def read(u):
            shops = {s['id'] for s in u.all('shops') if s['owner_id'] == user['id'] and s['status'] == 'approved'}
            if not shops: fail('SHOP_APPROVAL_REQUIRED', 'Your account is not linked to an approved shop.', 403)
            return {'orders': [{'job_id': j['id'], 'proposal_id': j['proposal']['id'], 'worker_name': j['worker_name'], 'items': [i for i in j['proposal']['items'] if i['shop_id'] in shops]} for j in u.all('jobs') if j.get('proposal', {}).get('status') == 'approved' and any(i['shop_id'] in shops for i in j['proposal']['items'])]}
        return store.run(read)

    @router.post('/shop/orders/{job_id}/handover')
    def handover(job_id: str, user=Depends(core.current_user)):
        if not user.get('phone_authenticated'): fail('PHONE_OTP_REQUIRED', 'Sign in with mobile OTP to confirm shop handovers.', 403)
        def save(u):
            j = u.get('jobs', job_id)
            if not j or j['state'] != 'in_progress' or j.get('proposal', {}).get('status') != 'approved': fail('ORDER_NOT_AVAILABLE', 'No approved parts order is awaiting handover.')
            if j.get('procurement_version',1)>=2: fail('PICKUP_OTP_REQUIRED','Use the purchase order in-app OTP flow. Direct handover is disabled.')
            shops = {s['id'] for s in u.all('shops') if s['owner_id'] == user['id'] and s['status'] == 'approved'}
            required = {i['shop_id'] for i in j['proposal']['items']}
            owned = shops & required
            if not owned: fail('NOT_YOUR_ORDER', 'This order is not assigned to your shop.', 403)
            confirmations = set(j['proposal'].get('confirmed_shops', []))
            if owned <= confirmations: return {'status': 'already_confirmed'}
            j['proposal']['confirmed_shops'] = sorted(confirmations | owned)
            j['proposal']['shop_confirmed'] = required <= (confirmations | owned)
            j['version'] += 1
            event(u, j, 'ShopHandoverConfirmed', user['id'])
            u.put('jobs', j['id'], j)
            return {'status': 'confirmed'}
        return store.run(save)

    @router.get('/professionals')
    def professionals(offset: int = Query(default=0, ge=0, le=10000), limit: int = Query(default=24, ge=1, le=24)):
        def read(u):
            candidates = sorted((worker for worker in u.all('workers') if worker['status'] == 'approved'),
                                key=lambda worker: (worker['name'].casefold(), worker['id']))
            visible = candidates[offset:offset + limit]
            rows = [{k: worker[k] for k in ('id', 'name', 'role', 'city', 'categories', 'skills', 'tools',
                                           'experience_years', 'completed_tasks', 'rating_count', 'rating_sum', 'points', 'has_specialist_kit')}
                    for worker in visible]
            enrich_professional_badges(u, rows, {worker['id']: worker for worker in visible})
            return {'professionals': rows, 'offset': offset, 'limit': limit,
                    'next_offset': offset + limit if len(candidates) > offset + limit else None}
        return store.run(read)

    @router.post('/professionals/search')
    def search_professionals(body: Discovery):
        def read(u):
            result = []
            worker_by_id = {}
            for w in u.all('workers'):
                if w['status'] != 'approved' or not w.get('online') or w['city'].casefold() != body.city.casefold(): continue
                if body.category and body.category not in w['categories']: continue
                position = w.get('position')
                if not position or time.time()-position['received_at'] > 900: continue
                distance = metres(body.location.model_dump(), position)
                if distance > min(body.radius_km, w['radius_km'])*1000: continue
                safe = {k:w[k] for k in ('id','name','role','city','categories','skills','tools','experience_years','completed_tasks','rating_count','rating_sum','points','has_specialist_kit')}
                safe['distance_km'] = round(distance/1000, 1)
                result.append(safe)
                worker_by_id[w['id']] = w
            result.sort(key=lambda w: (-(w['rating_sum']/max(1,w['rating_count'])), w['distance_km'], w['id']))
            visible = result[body.offset:body.offset + body.limit]
            enrich_professional_badges(u, visible, worker_by_id)
            return {'professionals': visible, 'distance_type':'straight_line', 'offset': body.offset, 'limit': body.limit,
                    'next_offset': body.offset + body.limit if len(result) > body.offset + body.limit else None}
        return store.run(read)

    @router.post('/bookings', status_code=201)
    def book(body: Booking, user=Depends(core.current_user)):
        now = time.time()
        try:
            start = datetime.fromisoformat(body.starts_at)
            if start.tzinfo is None or not now+3600 < start.timestamp() < now+30*86400: raise ValueError()
        except ValueError: fail('INVALID_SLOT', 'Choose an appointment between one hour and 30 days from now.', 422)
        if body.city not in core.CITIES: fail('OUTSIDE_COVERAGE', 'This city is not currently served.', 422)
        if core.USE_FIRESTORE:
            service = core.firestore_service_by_id(body.service_id)
        else:
            with core.db() as c: service = dict(core.service_by_id(c, body.service_id))
        key = hashlib.sha256((user['id']+body.idempotency_key).encode()).hexdigest()
        fingerprint = hashlib.sha256(body.model_dump_json().encode()).hexdigest()
        def save(u):
            old = u.get('booking_keys', key)
            if old:
                if old['fingerprint'] != fingerprint: fail('KEY_REUSED', 'This retry key belongs to another booking.')
                return public_job(u, u.get('jobs', old['id']), user['id'])
            service_terms=u.get('service_terms',body.service_id) or {'version':0,'text':''}
            if service_terms['version'] and body.service_terms_version!=service_terms['version']:fail('TERMS_CHANGED','Service terms changed. Reopen the booking and review the latest terms.')
            jid = str(uuid.uuid4())
            job = dict(id=jid, booking_id=jid, work_order_id=str(uuid.uuid4()), visit_id=str(uuid.uuid4()),
                       procurement_version=3, customer_id=user['id'], customer_name=user.get('name','Customer name not recorded'), service_id=body.service_id, service_name=service['name'], category=service['category'],
                       city=body.city, address=body.address, phone=body.phone, location=body.location.model_dump(), notes=body.notes,
                       starts_at=start.isoformat(), starts_epoch=start.timestamp(), version=1, scope_version=1,
                       state='searching', worker_id=None, worker_name=None, worker_role=None, attempted_workers=[],
                       base_price_paise=service['price_paise'], total_paise=service['price_paise'],
                       payment_status='pay_after_service', payout_status='held', scopes=[{'version': 1, 'price_paise': service['price_paise'], 'service': service['name'], 'accepted_by': user['id'], 'accepted_at': now}],
                       events=[], penalties=[], reminder_at=max(now, start.timestamp()-7200), created_at=now,
                       terms={'version': 'field-service-v1', 'reminder_grace_seconds': 600, 'missed_reminder_current_percent': 10, 'missed_reminder_next_percent': 20, 'late_departure_percent': 20, 'free_cancel_before_start': True})
            if body.coupon_code:
                if body.promotion_id:fail("OFFER_STACKING","Choose one offer per booking.",422)
                from coupons import reserve,attach_job
                attach_job(job,reserve(u,user["id"],body.coupon_code,"service",service["price_paise"],"job:"+job["id"],now))
            if body.promotion_id:
                from promotions import reserve_discount
                reserve_discount(u,job,user['id'],body.promotion_id,service,body.city,now)
            job['service_terms']=copy.deepcopy(service_terms)
            event(u, job, 'BookingRequested', user['id'])
            assign(u, job, now)
            u.put('jobs', jid, job)
            u.put('booking_keys', key, {'id': jid, 'fingerprint': fingerprint})
            return public_job(u, job, user['id'])
        return store.run(save)

    @router.get('/jobs')
    def jobs(user=Depends(core.current_user)):
        def read(u):
            rows={j['id']:j for j in [*u.find('jobs','customer_id',user['id']),*u.find('jobs','worker_id',user['id'])]}
            return {'jobs':[public_job(u,j,user['id']) for j in sorted(rows.values(),key=lambda j:j.get('starts_epoch',0),reverse=True)]}
        return store.run(read)

    @router.get('/jobs/{job_id}')
    def get_job(job_id: str, user=Depends(core.current_user)):
        def get(u):
            j = u.get('jobs', job_id)
            if not j: fail('NOT_FOUND', 'Booking not found.', 404)
            return public_job(u, j, user['id'])
        return store.run(get)

    @router.post('/jobs/{job_id}/commands')
    def command(job_id: str, body: Command, user=Depends(core.current_user)):
        def apply(u):
            now = time.time()
            j = u.get('jobs', job_id)
            if not j: fail('NOT_FOUND', 'Booking not found.', 404)
            key = hashlib.sha256((user['id']+body.command_id).encode()).hexdigest()
            fingerprint = hashlib.sha256((job_id+body.model_dump_json()).encode()).hexdigest()
            previous = u.get('commands', key)
            if previous:
                if previous['fingerprint'] != fingerprint: fail('KEY_REUSED', 'Command key was used for different details.')
                return command_response(u, j, user['id'])
            public_job(u, j, user['id'])
            if j['version'] != body.expected_version: fail('STALE_VERSION', 'This task changed. Refresh it before trying again.')
            if body.action not in actions(j, user['id'], now): fail('ACTION_NOT_ALLOWED', 'This action is not available now. Refresh the task.')
            if user['id'] == j.get('worker_id'):
                w = u.get('workers', user['id'])
                if not (user.get('phone_verified') or (w and w.get('phone'))) or not w or w['status'] != 'approved': fail('WORKER_APPROVAL_REQUIRED', 'Worker access is no longer approved.', 403)
            j['version'] += 1
            assess_penalties(u, j, now)
            p, a = body.payload, body.action
            if a in ('accept','decline') and j.get('assignment_metric_id'):
                metric=u.get('assignment_metrics',j['assignment_metric_id'])
                if metric:metric.update(responded_at=now,response=a);u.put('assignment_metrics',metric['id'],metric)
            if a == 'accept':
                busy = any(other['id'] != j['id'] and other.get('worker_id') == user['id'] and other['state'] not in ('cancelled', 'completed', 'searching') and not (other.get('home_plan_id') and other['state']=='accepted' and abs(other['starts_epoch']-j['starts_epoch'])>(other.get('duration_minutes',120)+j.get('duration_minutes',120))*60+1800) and not (other['state']=='follow_up_scheduled' and abs(other['starts_epoch']-j['starts_epoch'])>=7200) for other in u.all('jobs'))
                if busy: fail('CAPACITY_CONFLICT', 'You already have another active assignment.')
                from integrations import snapshot_policy
                snapshot_policy(u, j, w)
                j.update(state='accepted', accepted_at=now, reminder_at=max(now, j['starts_epoch']-7200))
            elif a == 'decline': assign(u, j, now)
            elif a == 'ack_reminder': j['reminder_ack_at'] = now
            elif a == 'depart':
                if any(o['id']!=j['id'] and o.get('worker_id')==user['id'] and o['state'] in ('en_route','arrived','in_progress','collecting_parts','completion_pending') for o in u.all('jobs')):fail('ACTIVE_VISIT_CONFLICT','Finish or reschedule your other active visit before departing.')
                j.update(state='en_route', departed_at=now, tracking_consent=True)
            elif a == 'schedule_follow_up':
                if j.get('proposal',{}).get('status') in ('approved','received','awaiting_payment'): fail('PARTS_ORDER_OPEN','Resolve the open parts order before scheduling another visit.')
                from procurement import pause_timer
                pause_timer(j,now)
                try:
                    start=datetime.fromisoformat(p['starts_at'])
                    if start.tzinfo is None or not now+3600<start.timestamp()<now+30*86400:raise ValueError()
                except (KeyError,TypeError,ValueError):fail('INVALID_SLOT','Choose a follow-up between one hour and 30 days from now.',422)
                reason=str(p.get('reason','')).strip();purpose=p.get('purpose')
                if len(reason)<10 or len(reason)>1000 or purpose not in ('repair','inspection','update','parts','other'):fail('FOLLOW_UP_DETAILS_REQUIRED','Choose the visit purpose and explain why more time is needed.',422)
                if any(o['id']!=j['id'] and o.get('worker_id')==user['id'] and o['state'] not in ('completed','cancelled','searching') and abs(o['starts_epoch']-start.timestamp())<7200 for o in u.all('jobs')):fail('SLOT_CONFLICT','Another assigned visit is within two hours of this time. Choose another slot.')
                j.setdefault('visit_history',[]).append({k:copy.deepcopy(j.get(k)) for k in ('visit_id','starts_at','state','worker_id','started_at','evidence_ids','completion_notes','reminder_ack_at')})
                j.update(state='follow_up_scheduled',visit_id=str(uuid.uuid4()),starts_at=start.isoformat(),starts_epoch=start.timestamp(),reminder_at=max(now,start.timestamp()-86400),follow_up_reason=reason,follow_up_purpose=purpose,is_follow_up=True,tracking_consent=False,payout_status='held')
                for field in ('position','manual_arrival','started_at','departed_at','reminder_ack_at','reminder_sent_at','completion_notes'):j.pop(field,None)
                event(u,j,'FollowUpScheduled',user['id'],{'starts_at':j['starts_at'],'purpose':purpose})

            elif a == 'stop_tracking':
                j.pop('position', None)
                j['tracking_consent'] = False
            elif a == 'position':
                pos = Position.model_validate(p)
                if abs(now-pos.captured_at) > 120: fail('STALE_POSITION', 'Get a fresh GPS reading.')
                j['tracking_consent'] = True
                j['position'] = {**pos.model_dump(), 'received_at': now}
                distance = metres(p, j['location'])
                j['geofence_zone'] = 'at_site' if at_site(j, now) else 'nearby' if distance <= 300 else 'travelling'
                if j['state'] == 'en_route' and at_site(j, now):
                    j['state'] = 'arrived'
                    event(u, j, 'WorkerArrived', user['id'])
                from procurement import movement
                movement(u,j,now)
                monitor_worksite(u,j,now,user['id'])
            elif a == 'start':
                if j.get('home_plan_id') and not at_site(j,now):fail('ARRIVAL_LOCATION_REQUIRED','Confirm arrival with a fresh location or the customer’s manual arrival confirmation.')
                if j.get('home_plan_id') and not j['starts_epoch']-900<=now<=j['starts_epoch']+j['duration_minutes']*60+3600:fail('VISIT_WINDOW','Start this visit within its scheduled attendance window. Contact support if the time changed.')
                otp_code = str(p.get('code') or p.get('otp') or '').strip()
                if otp_code and j.get('procurement_version', 1) >= 2 and j.get('arrival_verified_visit') != j['visit_id']:
                    from procurement import check_code, otp_id
                    err = check_code(u, otp_id('arrival', j), otp_code, now)
                    if not err:
                        j['arrival_verified_visit'] = j['visit_id']
                        event(u, j, 'CustomerArrivalVerified', user['id'])
                    else:
                        fail('INVALID_OTP', err, 422)
                if j.get('procurement_version',1)>=2 and j.get('arrival_verified_visit')!=j['visit_id']: fail('ARRIVAL_OTP_REQUIRED','Enter the customer’s in-app arrival OTP before starting.')
                from evidence import require_evidence
                if j.get('home_log_required'):
                    if not j.get('home_arrival_log',{}).get('hygiene'):fail('ARRIVAL_CHECKS_REQUIRED','Save the hygiene and arrival checks before starting.')
                else:require_evidence(u, j, 'before', now)
                from procurement import resume_timer
                resume_timer(j,now)
                j.update(state='in_progress', started_at=now)
            elif a == 'propose_parts':
                lines = p.get('items', [])
                if not isinstance(lines, list) or not 1 <= len(lines) <= 20: fail('INVALID_PARTS', 'Choose between one and 20 registered parts.', 422)
                items = []
                for line in lines:
                    product = u.get('inventory', str(line.get('product_id', '')))
                    quantity = line.get('quantity')
                    from procurement import live_product
                    if j.get('procurement_version',1)>=2 and not live_product(u,product,now): fail('STALE_INVENTORY','Use recently confirmed stock from an approved shop.')
                    if not product or product.get('status') != 'approved': fail('PART_UNAVAILABLE', 'This part is not in the verified shop inventory.')
                    if type(quantity) is not int or not 1 <= quantity <= product['stock']: fail('INSUFFICIENT_STOCK', 'The shop does not have this quantity.')
                    items.append({'product_id': product['id'], 'quantity': quantity, 'unit_price_paise': product['price_paise'], 'name': product['name'], 'shop_id': product['shop_id']})
                if len({i['product_id'] for i in items}) != len(items): fail('DUPLICATE_PART', 'Combine quantities for each part.', 422)
                if j.get('procurement_version',1)>=2 and len({i['shop_id'] for i in items})!=1: fail('ONE_SHOP_PER_ORDER','Choose parts from one shop per request.')
                j['proposal'] = {'id': str(uuid.uuid4()), 'status': 'pending', 'base_scope_version': j['scope_version'], 'items': items, 'amount_paise': sum(i['quantity']*i['unit_price_paise'] for i in items), 'expires_at': now+3600}
            elif a in ('approve_parts', 'reject_parts'):
                quote = j['proposal']
                if a=='approve_parts' and (quote['base_scope_version'] != j['scope_version'] or quote['expires_at'] <= now): fail('QUOTE_STALE', 'Ask the professional for a new quote.')
                if p.get('proposal_id') != quote['id']: fail('QUOTE_STALE', 'Review the current quote before deciding.')
                quote['status'] = 'approved' if a == 'approve_parts' else 'rejected'
                if a=='approve_parts' and j.get('procurement_version',1)>=3:
                    quote.update(status='awaiting_payment',accepted_at=now,payment_status='unpaid')
                elif a == 'approve_parts':
                    for line in quote['items']:
                        product = u.get('inventory', line['product_id'])
                        if not product or product['stock'] < line['quantity'] or product['price_paise'] != line['unit_price_paise']: fail('STOCK_OR_PRICE_CHANGED', 'The shop stock or price changed. Request a fresh quote.')
                        product['stock'] -= line['quantity']
                        u.put('inventory', product['id'], product)
                    if j.get('procurement_version',1)>=2:
                        from procurement import create_order
                        create_order(u,j,now)
                    j['scope_version'] += 1
                    j['total_paise'] += quote['amount_paise']
                    j['scopes'].append({'version': j['scope_version'], 'quote': copy.deepcopy(quote), 'accepted_by': user['id'], 'accepted_at': now, 'price_paise': j['total_paise']})
            elif a == 'collect_parts':
                if j.get('procurement_version',1)>=2:
                    o=u.get('parts_orders',j['proposal']['id'])
                    if not o or o['status']!='accepted' or o['expires_at']<=now: fail('SHOP_ACCEPTANCE_REQUIRED','Wait for the shop to accept this reserved order.')
                    if p.get('return_policy')!='pickup-return-v1': fail('RETURN_TERMS_REQUIRED','Review and accept the disclosed pickup-return policy before leaving.')
                    o['return_policy']='pickup-return-v1';u.put('parts_orders',o['id'],o)
                elif not j['proposal'].get('shop_confirmed'): fail('SHOP_CONFIRMATION_REQUIRED','The registered shop must confirm handover before you can collect these parts.')
                from procurement import pause_timer
                pause_timer(j,now);j['state']='collecting_parts'
                j.pop('manual_arrival',None);j.pop('position',None)
            elif a == 'return_to_site':
                if j.get('procurement_version',1)>=2:
                    o=u.get('parts_orders',j['proposal']['id'])
                    if not o or o['status']!='picked_up': fail('PICKUP_REQUIRED','Complete the shop OTP and confirm receipt before returning to work.')
                    o['return_monitor_ended']=now;u.put('parts_orders',o['id'],o)
                from procurement import resume_timer
                resume_timer(j,now);j['state']='in_progress';j['proposal']['status']='received'
            elif a == 'install_parts':
                j['proposal']['status'] = 'installed'
            elif a == 'parts_unavailable':
                from procurement import pause_timer
                pause_timer(j,now)
                j['state'] = 'follow_up_required'
                j['payout_status'] = 'held'
                event(u, j, 'InventoryDiscrepancyNeedsReview', user['id'], {'proposal_id': j['proposal']['id']})
            elif a == 'submit_completion':
                if any(r.get('job_id')==j['id'] and r['state'] not in ('returned','cancelled','rejected','expired') for r in u.all('rentals')):fail('RENTALS_OUTSTANDING','Return rented equipment and close pending rental requests before submitting completion.')
                from procurement import pause_timer
                pause_timer(j,now)
                from evidence import require_evidence
                if j.get('home_log_required'):
                    log=j.get('home_daily_log',{})
                    if not log.get('hygiene') or len(log.get('checked',[]))!=len(j['home_checklist']):fail('DAILY_LOG_REQUIRED','Complete the agreed tasks and hygiene log, or report a concern before submitting.')
                else:require_evidence(u,j,'after',now)
                has_before = any((u.get('evidence',eid) or {}).get('kind')=='before' and (u.get('evidence',eid) or {}).get('visit_id')==j['visit_id'] and (u.get('evidence',eid) or {}).get('status')=='ready' for eid in j.get('evidence_ids',[]))
                if not has_before and not j.get('home_log_required'):
                    forgotten = str(p.get('forgotten_info') or p.get('before_omission_reason') or p.get('omitted_info') or '').strip()
                    if len(forgotten) < 5:
                        fail('BEFORE_EVIDENCE_MISSING', 'Before inspection photo was omitted. Please enter the compulsory Forgotten Initial Information / Condition notes explaining initial item state to submit for customer review.', 422)
                    j['forgotten_info'] = forgotten[:2000]
                    j['before_omission_reason'] = forgotten[:2000]
                    event(u, j, 'BeforeEvidenceForgottenInfoRecorded', user['id'], {'forgotten_info': forgotten[:2000]})
                elif p.get('forgotten_info') or p.get('before_omission_reason'):
                    j['forgotten_info'] = str(p.get('forgotten_info') or p.get('before_omission_reason')).strip()[:2000]
                if not str(p.get('notes', '')).strip(): fail('EVIDENCE_REQUIRED', 'Describe the work and checks completed.', 422)
                j.update(state='completion_pending', completion_notes=str(p['notes'])[:2000])
                j.pop('position', None)
                j['tracking_consent'] = False
            elif a == 'accept_completion':
                j.update(state='completed', completed_at=now, invoice={'id': j['id'], 'total_paise': j['total_paise'], 'status': 'payment_due'})
                w = u.get('workers', j['worker_id'])
                w['completed_tasks'] += 1
                j['points_awarded'] = 10
                w['points'] += 10  # Points confer review eligibility only, never verification or a kit.
                u.put('workers', w['id'], w)
                u.put('ledger', j['id'], {'id': j['id'], 'invoice_paise': j['total_paise'], 'payment_status': 'unverified', 'payout_status': 'held', 'penalties': j['penalties'], 'reason': 'PAYMENT_AND_PAYOUT_PROVIDER_REQUIRED'})
            elif a == 'dispute':
                if len(str(p.get('reason', '')).strip()) < 5: fail('REASON_REQUIRED', 'Describe the issue so support can investigate.', 422)
                j.update(state='disputed', dispute_reason=str(p['reason'])[:2000], payout_status='held')
            elif a in ('cancel', 'reschedule'):
                if any(r.get('job_id')==j['id'] and r['state'] not in ('returned','cancelled','rejected','expired') for r in u.all('rentals')):fail('RENTALS_OUTSTANDING','Resolve equipment custody before cancelling or rescheduling this task. Contact support if needed.')
                if a == 'cancel': j['state'] = 'cancelled'
                else:
                    try:
                        start = datetime.fromisoformat(p['starts_at'])
                        if start.tzinfo is None or not now+3600 < start.timestamp() < now+30*86400: raise ValueError()
                    except (KeyError, ValueError): fail('INVALID_SLOT', 'Choose a valid future appointment.', 422)
                    j.setdefault('schedule_history', []).append(dict(from_worker_id=j.get('worker_id'), **{'from':j['starts_at']}, to=start.isoformat(), at=now))
                    j.update(starts_at=start.isoformat(), starts_epoch=start.timestamp(), reminder_at=max(now, start.timestamp()-7200), attempted_workers=[], visit_id=str(uuid.uuid4()))
                    for field in ('manual_arrival','reminder_ack_at', 'reminder_sent_at', 'departed_at', 'accepted_at'): j.pop(field, None)
                    assign(u, j, now)
                j.pop('position', None)
                j['tracking_consent'] = False
            elif a == 'review':
                rating = p.get('rating')
                if type(rating) is not int or not 1 <= rating <= 5: fail('INVALID_RATING', 'Choose a rating from one to five.', 422)
                j['review'] = {'rating': rating, 'text': str(p.get('text', ''))[:2000], 'customer_id': user['id'], 'verified_booking': True, 'at': now}
                w = u.get('workers', j['worker_id'])
                w['rating_sum'] += rating
                w['rating_count'] += 1
                u.put('workers', w['id'], w)
            elif a == 'retry_dispatch':
                j['attempted_workers'] = []
                assign(u, j, now)
            event(u, j, a, user['id'])
            u.put('jobs', j['id'], j)
            u.put('commands', key, {'fingerprint': fingerprint, 'job_id': j['id'], 'at': now})
            return command_response(u, j, user['id'])
        try:
            return store.run(apply)
        except __import__('pydantic').ValidationError:
            fail('INVALID_PAYLOAD', 'The submitted task details are invalid.', 422)

    def sweep():
        def tick(u):
            now = time.time()
            changed = 0
            for j in u.all('jobs'):
                if j['state'] in ('completed', 'cancelled', 'disputed'): continue
                dirty = False
                j['version'] += 1
                if j['state'] == 'offered' and now >= j['offer_expires_at']:
                    event(u, j, 'AssignmentExpired', 'scheduler')
                    assign(u, j, now)
                    dirty = True
                if j['state'] in ('accepted','follow_up_scheduled') and now >= j['reminder_at'] and not j.get('reminder_sent_at'):
                    j['reminder_sent_at'] = now
                    event(u, j, 'PreparationReminderDue', 'scheduler')
                    dirty = True
                # Assessments are auditable obligations. Never invent a payout basis or charge a bank.
                dirty = assess_penalties(u, j, now) or dirty
                if dirty:
                    u.put('jobs', j['id'], j)
                    changed += 1
            changed += dispatch_waiting(u, now)
            return {'changed': changed}
        return store.run(tick)

    @router.post('/admin/tick', dependencies=[Depends(core.operator)])
    def tick(): return sweep()

    @router.get('/inventory')
    def inventory(user=Depends(core.current_user)):
        from procurement import live_product
        return store.run(lambda u: {'items': [{**{k:p.get(k) for k in ('id','name','sku','category','compatibility','price_paise','stock','shop_id','stock_confirmed_at')},'shop_name':u.get('shops',p['shop_id'])['name']} for p in u.all('inventory') if live_product(u,p,time.time()) and p['stock']>0]})

    core.operations_tick = sweep
    core.app.include_router(router)
