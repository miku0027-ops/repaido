"""Incremental verified-service ratings; no lifetime job scan on catalogue reads."""
import copy
import hashlib
import threading
import time
from collections import OrderedDict

SHARDS = 16
_CACHE, _LOCK = OrderedDict(), threading.Lock()


def facts(job):
    review = job.get('review') or {}
    rating = review.get('rating')
    if job.get('state') == 'completed' and review.get('verified_booking') is True and review.get('customer_id') == job.get('customer_id') and type(rating) is int and 1 <= rating <= 5 and job.get('service_id'):
        return {'service_id': job['service_id'], 'rating': rating}
    return None


def shard_key(service, identifier):
    return hashlib.sha256(service.encode()).hexdigest()+':'+str(int(hashlib.sha256(identifier.encode()).hexdigest()[:8], 16) % SHARDS)


def project_job(u, identifier, job):
    previous = u.get('catalog_review_facts', identifier) or {}
    old = previous.get('value')
    current = facts(job)
    if old == current:
        return
    for value, sign in ((old, -1), (current, 1)):
        if value:
            key = shard_key(value['service_id'], identifier)
            row = u.get('catalog_rating_shards', key) or {'sum': 0, 'count': 0}
            row['sum'] += sign*value['rating']; row['count'] += sign
            if row['sum'] < 0 or row['count'] < 0:
                raise RuntimeError('Service review projection needs repair')
            u.put('catalog_rating_shards', key, row)
    u.put('catalog_review_facts', identifier, {'id': identifier, 'value': current})
    with _LOCK:
        _CACHE.clear()


def advance(core, limit=64):
    def step(u):
        state = u.get('catalog_rating_projection', 'v1') or {'ready': False, 'after': '', 'processed': 0}
        if state['ready']:
            return state
        if state.get('next_check_at', 0) > time.time():
            return state
        rows = u.page('jobs', limit=min(100, max(1, limit)), after=state['after'])
        for job in rows:
            project_job(u, job['id'], job)
        state.update(after=rows[-1]['id'] if rows else state['after'], processed=state['processed']+len(rows),
                     ready=len(rows) < min(100, max(1, limit)), updated_at=time.time(), next_check_at=time.time()+2)
        u.put('catalog_rating_projection', 'v1', state)
        return state
    return core.operations_store.run(step)


def read(u, services):
    keys = [hashlib.sha256(identifier.encode()).hexdigest()+':'+str(index) for identifier in services for index in range(SHARDS)]
    namespace = (id(u.core), str(getattr(u.core, 'DB_PATH', '')), str(getattr(getattr(u.core, 'fb_db', None), 'project', '')), tuple(services))
    dirty = any(kind in ('catalog_rating_shards', 'catalog_review_facts') for kind, _ in u.pending)
    with _LOCK:
        cached = _CACHE.get(namespace) if not dirty else None
        if cached and time.monotonic()-cached[0] < 15:
            return copy.deepcopy(cached[1])
    u.prefetch([('catalog_rating_shards', key) for key in keys])
    result = {}
    for identifier in services:
        prefix = hashlib.sha256(identifier.encode()).hexdigest()+':'
        rows = [u.get('catalog_rating_shards', prefix+str(index)) or {} for index in range(SHARDS)]
        result[identifier] = (sum(row.get('sum', 0) for row in rows), sum(row.get('count', 0) for row in rows))
    if not dirty:
        with _LOCK:
            _CACHE[namespace] = (time.monotonic(), copy.deepcopy(result))
            while len(_CACHE) > 32:
                _CACHE.popitem(last=False)
    return result
