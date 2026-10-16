"""Shared deterministic hiring score; accepts bounded, anonymous evidence only.

Native approval, consent, catalogue, location and booking checks remain in the
calling API. This module never reads a database or invents availability/demand.
"""
import copy
import hashlib
import threading
import time
from collections import OrderedDict

from pydantic import BaseModel, ConfigDict, Field, model_validator

VERSION = 'hire-evidence-v1'
MAX_CANDIDATES = 12


class Evidence(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, allow_inf_nan=False)
    completed: int = Field(ge=0, le=1000000)
    review_count: int = Field(ge=0, le=1000000)
    rating: float | None = Field(default=None, ge=1, le=5)
    experience_years: float = Field(default=0, ge=0, le=60)
    search_match: float = Field(default=0, ge=0, le=1)
    has_query: bool = False
    available_now: bool = False

    @model_validator(mode='after')
    def coherent_reviews(self):
        if self.review_count > self.completed or bool(self.review_count) != (self.rating is not None):
            raise ValueError('Reviews require matching completed-work evidence.')
        return self


class Batch(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    candidates: list[Evidence] = Field(min_length=1, max_length=MAX_CANDIDATES)


def score(evidence):
    e = evidence if isinstance(evidence, Evidence) else Evidence.model_validate(evidence)
    confidence = e.review_count / (e.review_count + 5)
    components = [
        {'id': 'verified_reviews', 'label': 'Verified category reviews', 'points': round((e.rating or 0) / 5 * confidence * 60, 2), 'maximum': 60, 'source': 'completed_work'},
        {'id': 'completed_work', 'label': 'Completed category work', 'points': round(min(e.completed, 20) / 20 * 10, 2), 'maximum': 10, 'source': 'completed_work'},
        {'id': 'experience', 'label': 'Listed years of experience', 'points': round(min(e.experience_years, 10), 2), 'maximum': 10, 'source': 'reviewed_profile'},
        {'id': 'search_match', 'label': 'Current search match', 'points': round(e.search_match * 10, 2) if e.has_query else 0, 'maximum': 10, 'source': 'current_request'},
        {'id': 'availability', 'label': 'Fresh presence without known active work', 'points': 10 if e.available_now else 0, 'maximum': 10, 'source': 'current_presence'},
    ]
    return {'score': round(sum(c['points'] for c in components), 2), 'components': components}


def rank(batch):
    batch = batch if isinstance(batch, Batch) else Batch.model_validate(batch)
    return {'version': VERSION, 'scores': [score(e) for e in batch.candidates]}


class FeatureCache:
    """Small pure-feature cache; changed evidence immediately has a new key."""
    def __init__(self, limit=128, ttl=60):
        self.limit, self.ttl = limit, ttl
        self.rows = OrderedDict()
        self.lock = threading.Lock()

    def rank(self, batch):
        batch = batch if isinstance(batch, Batch) else Batch.model_validate(batch)
        key = hashlib.sha256((VERSION + batch.model_dump_json()).encode()).digest()
        now = time.monotonic()
        with self.lock:
            cached = self.rows.get(key)
            if cached and cached[0] > now:
                self.rows.move_to_end(key)
                return copy.deepcopy(cached[1])
            self.rows.pop(key, None)
        result = rank(batch)
        with self.lock:
            self.rows[key] = (now + self.ttl, result)
            while len(self.rows) > self.limit:
                self.rows.popitem(last=False)
        return copy.deepcopy(result)


def profile_recommendation(row, catalog, jobs, category='', *, offerings, complete=True, record_limit=None):
    """Choose a real next action using the same category review-confidence score.

    This consumes the API's already-authorized public profile and current
    catalogue. Package history only breaks ties within the selected category.
    No lifetime or popularity claims are derived from missing/bounded evidence.
    """
    names = {c['id']: c['name'] for c in catalog['categories']}
    records = {c['category']: c for c in row.get('category_records', [])}
    packages = [s for s in row.get('service_packages', []) if s.get('id') and s.get('category') in row.get('categories', [])]
    approved = set(row.get('home_services', []))
    candidates = []
    for s in offerings:
        cid = 'home:' + s['id']
        if s['id'] in approved and (not category or category in (cid, s['category'])):
            candidates.append((cid, s['name'], {'kind': 'home', 'label': 'Discuss ' + s['name'], 'service_id': s['id']}))
    for s in packages:
        if not category or category == s['category']:
            candidates.append((s['category'], names.get(s['category'], s['category'].replace('_', ' ').title()),
                               {'kind': 'service', 'label': 'Book ' + s['name'], 'service_id': s['id']}))
    if not candidates:
        return None
    def record(cid):
        return records.get(cid) or {'completed': 0, 'review_count': 0, 'rating': None}
    def order(candidate):
        cid, _, action = candidate
        rec = record(cid)
        points = score(Evidence(completed=rec['completed'], review_count=rec['review_count'], rating=rec['rating']))['score']
        service_id = action['service_id']
        actual_id = 'home-' + service_id if action['kind'] == 'home' else service_id
        package_work = sum(j.get('state') == 'completed' and j.get('service_id') == actual_id for j in jobs)
        return (-points, -package_work, cid, action['kind'], service_id)
    cid, name, action = min(candidates, key=order)
    rec = record(cid)
    reasons = [f"{rec['completed']} completed {'Home visits' if cid.startswith('home:') else 'tasks'} in {name}"]
    if rec['review_count']:
        reasons.append(f"{rec['rating']:g}/5 from {rec['review_count']} verified category reviews")
    else:
        reasons.append('No verified category reviews in the inspected work records' if not complete else 'No verified completed-work reviews in this category yet')
    if action['kind'] == 'home':
        reasons.append('This Home service is approved for this professional; agree the scope, schedule and quote first')
    else:
        reasons.append('This package is in the current catalogue for this professional’s listed category')
    if not complete:
        reasons.append('Work evidence is a bounded sample, not lifetime totals')
    return {'category': cid, 'summary': f"Explore {name} with this professional.", 'reasons': reasons,
            'action': action, 'engine_version': VERSION,
            'verified_work': {'completed': rec['completed'], 'review_count': rec['review_count'], 'rating': rec['rating']},
            'evidence_scope': {'kind': 'bounded_worker_records' if record_limit else 'worker_records', 'complete': complete, 'record_limit': record_limit},
            'method': 'Current approved services and catalogue packages, ordered by verified category-review confidence, completed category work, then matching package history. This is not a demand, price or availability forecast.'}
