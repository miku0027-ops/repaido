"""Company-approved reward limits. Points never create an unfunded cash balance."""
import copy
import time
from datetime import datetime, timedelta, timezone
from pydantic import Field
from operations import Input, fail
from local_business import fingerprint

LEVELS = [
    dict(id='contributor', name='Contributor', points=0, cap_bps=10000),
    dict(id='bronze', name='Bronze', points=30, cap_bps=10000),
    dict(id='silver', name='Silver', points=60, cap_bps=10000),
    dict(id='gold', name='Gold', points=100, cap_bps=10000),
    dict(id='platinum', name='Platinum', points=200, cap_bps=12500),
    dict(id='diamond', name='Diamond', points=400, cap_bps=15000),
]
OFFERS = {
    'CAPTAINSHARE50': dict(title='Your first shared ride', scope='shared', bps=5000, cap_paise=None, first_only=True, checkout_ready=False),
    'CAPTAINREPAIR30': dict(title='Repair visiting fee', scope='visit', bps=3000, cap_paise=None),
    'CAPTAINREFURB25': dict(title='Refurbished appliances', scope='refurbished', bps=2500, cap_paise=100000),
    'CAPTAINRENT10': dict(title='Tools & heavy-vehicle rentals', scope='rental', bps=1000, cap_paise=None),
    'CAPTAINCAB50': dict(title='Cab base fare', scope='cab', bps=5000, cap_paise=None, checkout_ready=False),
    'CAPTAINHIRE20': dict(title='Professional day hire', scope='hire', bps=2000, cap_paise=None),
}
# Proposed limits are visible to operators only. They grant no redemption rights.
PROPOSED_CAPS = {'shared':10000, 'visit':15000, 'refurbished':100000, 'rental':20000, 'cab':15000, 'hire':15000}


def level_summary(points):
    level = next(x for x in reversed(LEVELS) if points >= x['points'])
    following = next((x for x in LEVELS if x['points'] > points), None)
    return dict(level=copy.deepcopy(level), next_level=copy.deepcopy(following),
                points_to_next_level=max(0, following['points']-points) if following else 0,
                level_progress_bps=min(10000, (points-level['points'])*10000//(following['points']-level['points'])) if following else 10000)


def month(now):
    return datetime.fromtimestamp(now, timezone(timedelta(hours=5, minutes=30))).strftime('%Y-%m')


def context(u, now):
    policy = u.get('captain_policies', 'current')
    budget = u.get('captain_budget', month(now)) or {'reserved_paise':0}
    return policy, budget


def limits(u, rule, code, summary, now):
    if rule.get('checkout_ready') is False:return None, 'Offer not active yet', None
    policy, budget = context(u, now)
    if policy is None:
        # Preserve the previously approved appliance offer. Every other offer
        # stays locked until its limits and company funding are approved.
        return rule['cap_paise'], '', None
    setting = policy['offers'].get(code, {})
    if not setting.get('enabled'):
        return None, 'Not active yet', None
    cap = min(setting['gold_cap_paise']*summary['level']['cap_bps']//10000, setting['max_cap_paise'])
    if rule['scope'] == 'refurbished': cap = min(cap, 100000)
    remaining = max(0, policy['monthly_budget_paise']-budget['reserved_paise'])
    return min(cap, remaining), '' if remaining else 'This month’s reward budget is fully reserved', policy['version']


def reserve_budget(u, amount, policy_version, now):
    if policy_version is None: return  # Existing, expressly approved appliance offer.
    policy, budget = context(u, now)
    if not policy or policy['version'] != policy_version or amount > policy['monthly_budget_paise']-budget['reserved_paise']:
        fail('REWARD_BUDGET_CHANGED', 'The reward budget changed. Check your offer before continuing.', 409)
    # This document serialises concurrent reservations across all accounts.
    budget.update(id=month(now), reserved_paise=budget['reserved_paise']+amount, updated_at=now)
    u.put('captain_budget', month(now), budget)


class OfferLimit(Input):
    enabled: bool = False
    gold_cap_paise: int = Field(ge=0, le=1000000, strict=True)
    max_cap_paise: int = Field(ge=0, le=1000000, strict=True)


class Policy(Input):
    expected_version: int = Field(ge=0)
    monthly_budget_paise: int = Field(ge=0, le=1000000000, strict=True)
    funding_reference: str = Field(default='', max_length=200)
    offers: dict[str, OfferLimit]


def policy_view(u, now=None):
    now = time.time() if now is None else now
    policy, budget = context(u, now)
    if not policy:
        policy = dict(version=0, monthly_budget_paise=0, funding_reference='', offers={
            code:dict(enabled=False, gold_cap_paise=PROPOSED_CAPS[rule['scope']],
                      max_cap_paise=min(100000, PROPOSED_CAPS[rule['scope']]*15000//10000))
            for code, rule in OFFERS.items()})
    return {**policy, 'rules':OFFERS, 'levels':LEVELS, 'budget_month':month(now),
            'reserved_paise':budget['reserved_paise'],
            'remaining_paise':max(0, policy['monthly_budget_paise']-budget['reserved_paise']),
            'standing_appliance_offer':policy['version']==0}


def save_policy(u, body, admin_id, now=None):
    now = time.time() if now is None else now
    previous, budget = context(u, now)
    version = previous['version'] if previous else 0
    if version != body.expected_version:
        if previous and version == body.expected_version+1 and previous.get('request_hash') == fingerprint(body): return policy_view(u, now)
        fail('STALE_VERSION', 'Reward settings changed. Refresh before saving.', 409)
    if set(body.offers) != set(OFFERS): fail('REWARD_LIMITS_REQUIRED', 'Set limits for every reward.', 422)
    if body.monthly_budget_paise < budget['reserved_paise']:
        fail('BUDGET_ALREADY_RESERVED', 'The budget cannot be lower than rewards already reserved this month.', 422)
    for code, setting in body.offers.items():
        if setting.enabled and OFFERS[code].get('checkout_ready') is False:
            fail('CHECKOUT_NOT_READY', 'Cab and shared-ride reward payments are not active yet. Keep these offers off.', 422)
        if setting.max_cap_paise < setting.gold_cap_paise or setting.enabled and setting.gold_cap_paise <= 0:
            fail('INVALID_REWARD_CAP', 'Set a positive Gold limit within the approved maximum.', 422)
        if code == 'CAPTAINREFURB25' and setting.max_cap_paise > 100000:
            fail('APPLIANCE_CAP', 'The appliance discount cannot exceed ₹1,000.', 422)
    if any(x.enabled for x in body.offers.values()) and (body.monthly_budget_paise <= 0 or len(body.funding_reference.strip()) < 8):
        fail('REWARD_FUNDING_REQUIRED', 'Record the approved monthly Repaido budget and its funding reference.', 422)
    row = dict(version=version+1, **body.model_dump(exclude={'expected_version'}),
               approved_by=admin_id, approved_at=now, request_hash=fingerprint(body))
    u.put('captain_policies', 'current', row)
    u.put('captain_policy_audit', str(row['version']), row)
    return policy_view(u, now)
