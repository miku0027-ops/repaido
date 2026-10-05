"""Confirmed year-round demand policy and auditable integer-paise calculations.

This module deliberately does not collect payments or create withdrawable awards.
Activation requires quote consent, capacity reservation and refund reconciliation
to use the same versioned policy. Preview results are not bank balances.
"""
from collections import defaultdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

POLICY = {
    'version': 'demand-pool-v1',
    'scope': 'all_occasions',
    'surcharge_bps': 2500,
    'company_bps': 500,
    'agent_pool_bps': 2000,
    'trigger_buffer_bps': 500,
    'trigger_comparison': 'strictly_greater',
    'distribution': 'weekly_proportional_verified_service_value',
    'timezone': 'Asia/Kolkata',
    'week_starts': 'Monday 00:00',
    'activation': 'integration_pending',
}


def demand_trigger(demand, capacity):
    """Unknown/zero capacity cannot justify a surcharge or a service promise."""
    if type(demand) is not int or type(capacity) is not int or min(demand, capacity) < 0:
        raise ValueError('Demand and capacity must be non-negative integers.')
    return capacity > 0 and demand * 10000 > capacity * (10000 + POLICY['trigger_buffer_bps'])


def surcharge_split(service_paise):
    """Half-up total, company capped at 5%; residual paise stay with agents."""
    if type(service_paise) is not int or service_paise < 0:
        raise ValueError('Service price must be non-negative integer paise.')
    total = (service_paise * POLICY['surcharge_bps'] + 5000) // 10000
    company = service_paise * POLICY['company_bps'] // 10000
    return {'surcharge_paise': total, 'company_paise': company, 'agent_pool_paise': total-company}


def week_bounds(timestamp):
    local = datetime.fromtimestamp(timestamp, ZoneInfo(POLICY['timezone']))
    start = (local - timedelta(days=local.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    return start.timestamp(), (start + timedelta(days=7)).timestamp()


def eligible_job(job):
    return (job.get('state') == 'completed'
            and job.get('payment_status') == 'verified'
            and job.get('outcome') != 'partial'
            and bool(job.get('worker_id'))
            and job.get('worker_id') != job.get('customer_id')
            and not any(job.get(k) for k in ('financial_hold', 'parts_refund_hold',
                                           'allocation_review_required', 'dispute_open')))


def distribute(pool_paise, values):
    """Largest remainder allocation conserves every paise; ID breaks exact ties."""
    if type(pool_paise) is not int or pool_paise < 0:
        raise ValueError('Pool must be non-negative integer paise.')
    if any(type(v) is not int or v < 0 for v in values.values()):
        raise ValueError('Weights must be non-negative integer paise.')
    weights = {k: v for k, v in values.items() if v > 0}
    total = sum(weights.values())
    if not total:
        return {'shares': {}, 'held_paise': pool_paise}
    shares = {k: pool_paise*v//total for k, v in weights.items()}
    order = sorted(weights, key=lambda k: (-(pool_paise*weights[k] % total), k))
    for key in order[:pool_paise-sum(shares.values())]:
        shares[key] += 1
    return {'shares': shares, 'held_paise': 0}


def weekly_preview(jobs, receipts, workers, start, end, pool_paise):
    """Use payment verification time as well as completion time, never acceptance.

    The later event selects the week, so a late verified payment is not lost or
    counted twice. The caller supplies an independently reconciled pool balance.
    No catalogue/base total is silently assumed to exclude tax: accounting must
    provide verified_service_value_paise explicitly before a job can qualify.
    """
    verified = defaultdict(float)
    seen_receipts = set()
    for receipt in receipts:
        rid = receipt.get('id')
        if not rid or rid in seen_receipts:
            continue
        seen_receipts.add(rid)
        verified[receipt['job_id']] = max(verified[receipt['job_id']], receipt.get('verified_at', 0))
    approved = {w['id'] for w in workers if w.get('status') == 'approved'}
    values = defaultdict(int)
    included = []
    seen = set()
    for job in jobs:
        jid = job.get('id')
        if not jid or jid in seen:
            continue
        seen.add(jid)
        value = job.get('verified_service_value_paise')
        completed = job.get('completed_at', 0)
        if (not eligible_job(job) or job['worker_id'] not in approved or not completed
                or not verified[jid] or type(value) is not int or value <= 0):
            continue
        if start <= max(completed, verified[jid]) < end:
            values[job['worker_id']] += value
            included.append(jid)
    return {'policy_version': POLICY['version'], 'status': 'preview_only',
            'start': start, 'end': end, 'service_value_paise': dict(values),
            'source_job_ids': sorted(included), **distribute(pool_paise, values)}
