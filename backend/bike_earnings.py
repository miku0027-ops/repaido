"""Independent rider agreements and per-ride liabilities, separate from salary.

No bank transfer is initiated. Promotional earnings reserve reviewed company
funds atomically with the rider slot. Paid earnings become payable only after
company receipt of that ride's cash. Immutable credits prevent duplicate pay.
"""
import copy
import time
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Response
from pydantic import Field, model_validator
from operations import Input, fail
from local_business import digest, fingerprint
from bike_payroll import _approved_profile, approved_salaried_driver, normalize_reference
from integrations import audit

HEADERS = {'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer'}
DEFAULT = {'version': 0, 'terms_version': 0, 'enabled': False, 'paid_payout_bps': 0, 'promo_payout_paise': 0,
           'terms': '', 'reviewed': False, 'reference': ''}
FUND_BUCKETS = 16


class Policy(Input):
    expected_version: int = Field(ge=0, strict=True)
    enabled: bool = False
    paid_payout_bps: int = Field(default=0, ge=0, le=10000, strict=True)
    promo_payout_paise: int = Field(default=0, ge=0, le=100000, strict=True)
    terms: str = Field(min_length=20, max_length=2000)
    reviewed: bool = False
    reference: str = Field(min_length=8, max_length=200)

    @model_validator(mode='after')
    def meaningful_terms(self):
        if len(normalize_reference(self.reference)) < 8 or len(self.terms.strip()) < 20:
            raise ValueError('Record the reviewed agreement and actual review reference.')
        return self


class Evidence(Input):
    reference: str = Field(min_length=8, max_length=200)
    evidence: str = Field(min_length=10, max_length=1000)

    @model_validator(mode='after')
    def proof(self):
        if len(normalize_reference(self.reference)) < 8 or len(self.evidence.strip()) < 10:
            raise ValueError('Record the actual reference and evidence.')
        return self


class Enrollment(Input):
    expected_version: int = Field(ge=0, strict=True)
    terms_version: int = Field(ge=1, strict=True)
    consent: Literal[True]


class Review(Evidence):
    expected_version: int = Field(ge=1, strict=True)
    status: Literal['approved', 'rejected', 'suspended', 'pending']
    reference: str = Field(min_length=8, max_length=200)
    evidence: str = Field(min_length=10, max_length=1000)


class Funding(Evidence):
    request_id: str = Field(min_length=16, max_length=100)
    amount_paise: int = Field(ge=1, le=1000000000, strict=True)
    reference: str = Field(min_length=8, max_length=200)
    evidence: str = Field(min_length=10, max_length=1000)
    received: Literal[True]


class Transfer(Evidence):
    request_id: str = Field(min_length=16, max_length=100)
    driver_id: str = Field(min_length=1, max_length=128, pattern=r'^[A-Za-z0-9_:.@-]+$')
    credit_ids: list[Annotated[str, Field(min_length=1, max_length=128, pattern=r'^[A-Za-z0-9_:-]+$')]] = Field(min_length=1, max_length=50)
    amount_paise: int = Field(ge=1, le=1000000000, strict=True)
    reference: str = Field(min_length=8, max_length=200)
    evidence: str = Field(min_length=10, max_length=1000)


class Receipt(Input):
    expected_version: int = Field(ge=1, strict=True)
    received: Literal[True]


def policy(u):
    return {**DEFAULT, **(u.get('bike_earnings_policy', 'current') or {})}


def configured(p):
    return bool(p['enabled'] and p['reviewed'] and p['paid_payout_bps'] > 0 and p['terms'])


def _fund_bucket(u, identifier):
    return u.get('bike_earnings_fund_buckets', str(identifier)) or {
        'funded_paise': 0, 'reserved_paise': 0, 'committed_paise': 0, 'version': 0}


def fund(u):
    """Exact bounded aggregate for administration; never a per-booking write."""
    u.prefetch([('bike_earnings_fund_buckets', str(i)) for i in range(FUND_BUCKETS)])
    buckets = [_fund_bucket(u, i) for i in range(FUND_BUCKETS)]
    return {key: sum(row[key] for row in buckets)
            for key in ('funded_paise', 'reserved_paise', 'committed_paise', 'version')}


def _fund_allocations(u, amount, driver_id):
    # Usually one bucket read/write. A bounded fallback uses split balances when
    # the last funds are fragmented; every claimed bucket is in the transaction.
    start = int(digest(driver_id)[:8], 16) % FUND_BUCKETS
    remaining, allocations = amount, []
    for offset in range(FUND_BUCKETS):
        identifier = str((start+offset) % FUND_BUCKETS)
        value = _fund_bucket(u, identifier)
        claimed = min(remaining, available_fund(value))
        if claimed:
            # Firestore supports arrays of maps, but not nested arrays/tuples.
            allocations.append({'bucket': identifier, 'amount_paise': claimed})
            remaining -= claimed
        if remaining == 0:
            return allocations
    return None


def _change_reserve(u, row, *, commit=False):
    amount = row.get('earning_fund_reserved_paise', 0)
    allocations = row.get('earning_fund_allocations', [])
    if sum(part['amount_paise'] for part in allocations) != amount:
        fail('EARNING_FUND_REVIEW', 'The reserved rider payment needs accounting review.', 409)
    balances = [(part['bucket'], part['amount_paise'], _fund_bucket(u, part['bucket'])) for part in allocations]
    if any(value['reserved_paise'] < part for _, part, value in balances):
        fail('EARNING_FUND_REVIEW', 'The reserved rider payment is inconsistent.', 409)
    for identifier, part, value in balances:
        value['reserved_paise'] -= part
        value['committed_paise'] += part if commit else 0
        value['version'] += 1
        u.put('bike_earnings_fund_buckets', identifier, value)
    row['earning_fund_reserved_paise'] = 0
    row['earning_fund_allocations'] = []


def available_fund(value):
    return max(0, value['funded_paise']-value['reserved_paise']-value['committed_paise'])


def salary_enrolled(u, driver_id):
    """Membership survives a funding/operating pause and document expiry."""
    from bike_payroll import policy as salary_policy
    membership = u.get('bike_salary_roster', digest(driver_id)) or {}
    return bool(membership.get('active') or any(row.get('driver_id') == driver_id and row.get('active')
                for row in salary_policy(u).get('roster', [])))


def approved(u, driver_id, now=None):
    p, profile = policy(u), u.get('bike_independent_riders', driver_id) or {}
    return bool(configured(p) and profile.get('status') == 'approved' and not salary_enrolled(u, driver_id) and
                profile.get('terms_version') == p['terms_version'] and
                _approved_profile(u, driver_id, time.time() if now is None else now))


def compensated_driver(u, driver_id, now=None):
    return approved_salaried_driver(u, driver_id, now) or approved(u, driver_id, now)


def operations_readiness(u, p=None, now=None, *, funding_detail=False):
    from bike_payroll import policy_readiness
    salary = policy_readiness(u, p, now)
    independent = policy(u)
    ready = configured(independent)
    salary_ready = bool(salary['payroll_ready'] and salary['funding_ready'])
    # Configuration readiness is advisory. Exact funding is checked for each
    # quote and atomically reserved at allocation, without locking all buckets.
    funding = u.get('bike_earnings_fund', 'current') or {}
    promo = ready and independent['promo_payout_paise'] > 0 and funding.get('funded_paise', 0) > 0
    if promo and funding_detail:
        promo = available_fund(fund(u)) >= independent['promo_payout_paise']
    return {**salary, 'payroll_ready': salary_ready or ready, 'funding_ready': salary_ready or ready,
            'salary_roster_ready': salary_ready, 'independent_ready': ready,
            'promo_pool_ready': salary_ready or bool(promo)}


def quote_earnings(u, driver_id, pricing):
    if approved_salaried_driver(u, driver_id):
        return {'model': 'monthly_salary', 'amount_paise': 0, 'policy_version': 0}
    p = policy(u)
    if not approved(u, driver_id):
        fail('EARNING_AGREEMENT_REQUIRED', 'This rider needs a current approved earning agreement.', 409)
    if pricing['free']:
        amount = p['promo_payout_paise']
        if amount <= 0 or not _fund_allocations(u, amount, driver_id):
            return None
    else:
        # The share applies to actual fare before GST, including agreed surge.
        amount = ((pricing['total_paise']-pricing.get('gst_paise', 0))*p['paid_payout_bps'])//10000
        if amount <= 0:
            return None
    return {'model': 'per_ride', 'amount_paise': amount, 'policy_version': p['version'],
            'terms': p['terms'], 'free': pricing['free'], 'currency': 'INR'}


def reserve(u, row):
    offer = row.get('compensation_offer') or {'model': 'monthly_salary'}
    if offer['model'] != 'per_ride':
        if not approved_salaried_driver(u, row['driver_id']):
            fail('EARNING_AGREEMENT_CHANGED', 'Rider compensation changed. Review a new quote.', 409)
        return
    p = policy(u)
    if not approved(u, row['driver_id']) or offer['policy_version'] != p['version']:
        fail('EARNING_AGREEMENT_CHANGED', 'Rider earning terms changed. Search again.', 409)
    if row['pricing']['free']:
        allocations = _fund_allocations(u, offer['amount_paise'], row['driver_id'])
        if not allocations:
            fail('PROMO_FUNDING_CHANGED', 'The launch offer is no longer funded for this rider. Review a new quote.', 409)
        for allocation in allocations:
            identifier, part = allocation['bucket'], allocation['amount_paise']
            value = _fund_bucket(u, identifier)
            value['reserved_paise'] += part; value['version'] += 1
            u.put('bike_earnings_fund_buckets', identifier, value)
        row['earning_fund_reserved_paise'] = offer['amount_paise']
        row['earning_fund_allocations'] = allocations


def release(u, row):
    amount = row.get('earning_fund_reserved_paise', 0)
    if amount:
        _change_reserve(u, row)


def account(u, uid):
    return u.get('bike_earnings_accounts', uid) or {'id': uid, 'version': 0, 'earned_paise': 0,
           'awaiting_remittance_paise': 0, 'payable_paise': 0, 'transfer_reported_paise': 0, 'received_paise': 0}


def _change(u, uid, **deltas):
    value = account(u, uid)
    for key, delta in deltas.items():
        value[key] += delta
        if value[key] < 0:
            fail('EARNING_LEDGER_REVIEW', 'Rider earnings need an accounting review.', 409)
    value['version'] += 1
    u.put('bike_earnings_accounts', uid, value)


def _index_credit(u, row):
    key = f'{9999999999999-int(row["created_at"]*1000):013d}:'+row['id']
    u.put('bike_earning_history_'+digest(row['driver_id'])[:32], key, {'id': key, 'credit_id': row['id'], 'active': True})


def sync_earning(u, ride):
    offer = ride.get('compensation_offer') or {}
    if offer.get('model') != 'per_ride':
        return
    if ride['state'] in ('cancelled', 'declined', 'expired', 'unavailable'):
        release(u, ride)
        return
    if ride['state'] != 'completed':
        return
    identifier = digest('bike-earning:'+ride['id'])
    if u.get('bike_earning_credits', identifier):
        return
    amount = offer['amount_paise']
    free = ride['pricing']['free']
    if free:
        if ride.get('earning_fund_reserved_paise') != amount:
            fail('EARNING_FUND_REVIEW', 'This completed launch ride needs its reserved rider payment reviewed.', 409)
        _change_reserve(u, ride, commit=True)
    payable = free or ride.get('company_collection_status') == 'company_received'
    credit = {'id': identifier, 'ride_id': ride['id'], 'driver_id': ride['driver_id'], 'version': 1,
              'amount_paise': amount, 'currency': 'INR', 'free': free, 'policy_version': offer['policy_version'],
              'status': 'payable' if payable else 'awaiting_remittance', 'created_at': time.time()}
    u.put('bike_earning_credits', identifier, credit)
    _index_credit(u, credit)
    _change(u, ride['driver_id'], earned_paise=amount,
            **{'payable_paise' if payable else 'awaiting_remittance_paise': amount})


def cash_received_by_company(u, ride):
    credit = u.get('bike_earning_credits', digest('bike-earning:'+ride['id']))
    if not credit or credit['status'] != 'awaiting_remittance':
        return
    credit.update(status='payable', version=credit['version']+1)
    u.put('bike_earning_credits', credit['id'], credit)
    _change(u, credit['driver_id'], awaiting_remittance_paise=-credit['amount_paise'], payable_paise=credit['amount_paise'])


def _page(u, lane, kind, target, cursor=None):
    from repaidians_work import active_query
    refs = active_query(u, lane, 51, cursor or '')
    u.prefetch([(kind, row[target]) for row in refs[:50]])
    values = [u.get(kind, row[target]) for row in refs[:50]]
    return {'items': [value for value in values if value], 'next_cursor': refs[49]['id'] if len(refs)>50 else None}


def driver_view(u, uid, cursor=None, transfer_cursor=None):
    p = policy(u)
    profile = u.get('bike_independent_riders', uid)
    credits = _page(u, 'bike_earning_history_'+digest(uid)[:32], 'bike_earning_credits', 'credit_id', cursor)
    transfers = _page(u, 'bike_earning_transfers_'+digest(uid)[:32], 'bike_earning_transfers', 'transfer_id', transfer_cursor)
    own_profile = {key: profile[key] for key in ('id', 'name', 'status', 'version', 'terms_version', 'accepted_at', 'created_at') if key in profile} if profile else None
    return {'policy': {key: p[key] for key in ('version', 'terms_version', 'enabled', 'paid_payout_bps', 'promo_payout_paise', 'terms', 'reviewed')},
            'enrollment': own_profile, 'approved': approved(u, uid), 'account': account(u, uid),
            'credits': credits['items'], 'next_cursor': credits['next_cursor'],
            'transfers': transfers['items'], 'transfers_next_cursor': transfers['next_cursor'], 'server_time': time.time()}


def install(core):
    store = core.operations_store
    r = APIRouter(prefix='/operations/bike-rides', tags=['Independent bike earnings'])

    @r.get('/driver/earnings')
    def own(response: Response, cursor: str | None=Query(default=None, max_length=100),
            transfer_cursor: str | None=Query(default=None, max_length=100), user=Depends(core.current_user)):
        response.headers.update(HEADERS)
        return store.run(lambda u: driver_view(u, user['id'], cursor, transfer_cursor))

    @r.post('/driver/earnings/enrollment')
    def enroll(body: Enrollment, user=Depends(core.current_user)):
        def save(u):
            p = policy(u); old = u.get('bike_independent_riders', user['id']) or {'version': 0}
            if old['version'] != body.expected_version: fail('STALE', 'Refresh your rider agreement.', 409)
            if not p['reviewed'] or p['paid_payout_bps'] <= 0 or body.terms_version != p['terms_version'] or not p['terms']:
                fail('TERMS_CHANGED', 'The company needs to publish reviewed rider earning terms.', 409)
            if salary_enrolled(u, user['id']):
                fail('SALARIED_ASSIGNMENT', 'Your account already has a salaried rider assignment.', 409)
            if old.get('status') in ('suspended', 'rejected'):
                fail('RIDER_REVIEW_REQUIRED', 'Contact the company to reopen this rider application.', 409)
            row = {'id': user['id'], 'name': user.get('name', 'Rider'), 'version': old['version']+1,
                   'status': 'approved' if old.get('status') == 'approved' else 'pending',
                   'terms_version': p['terms_version'], 'accepted_at': time.time(),
                   'created_at': old.get('created_at', time.time())}
            u.put('bike_independent_riders', user['id'], row)
            u.put('bike_independent_applications', user['id'], {'id': user['id'], 'rider_id': user['id'], 'active': True})
            audit(u, 'BikeIndependentTermsAccepted', user['id'], policy_version=p['version'])
            return driver_view(u, user['id'])
        return store.run(save)

    @r.get('/earnings/admin')
    def admin(response: Response, cursor: str | None=Query(default=None, max_length=128), actor=Depends(core.operator)):
        response.headers.update(HEADERS)
        def read(u):
            rows = _page(u, 'bike_independent_applications', 'bike_independent_riders', 'rider_id', cursor)
            u.prefetch([(kind, key) for row in rows['items'] for kind, key in
                        [('bike_earnings_accounts', row['id']), *[('business_partners', row['id']+suffix) for suffix in ('', ':driver', ':cab_owner')]]])
            documents = set()
            for row in rows['items']:
                for suffix in ('', ':driver', ':cab_owner'):
                    profile = u.get('business_partners', row['id']+suffix) or {}
                    identifiers = profile.get('document_ids') or []
                    if isinstance(identifiers, list) and len(identifiers) <= 8:
                        documents.update(identifier for identifier in identifiers if isinstance(identifier, str))
            u.prefetch([('business_documents', identifier) for identifier in documents])
            for row in rows['items']:
                row['profile_approved'] = bool(_approved_profile(u, row['id'], time.time()))
                row['account'] = account(u, row['id'])
            return {**rows, 'policy': policy(u), 'fund': fund(u), 'available_promo_fund_paise': available_fund(fund(u))}
        return store.run(read)

    @r.put('/earnings/policy')
    def set_policy(body: Policy, actor=Depends(core.operator)):
        def save(u):
            old = policy(u)
            if old['version'] != body.expected_version: fail('STALE', 'Refresh the earning policy.', 409)
            if body.enabled and (not body.reviewed or body.paid_payout_bps <= 0):
                fail('EARNING_TERMS_REQUIRED', 'Review a positive paid-ride share before activation.', 422)
            row = {**body.model_dump(exclude={'expected_version'}), 'version': old['version']+1}
            changed = any(row[key] != old[key] for key in ('paid_payout_bps', 'promo_payout_paise', 'terms'))
            row['terms_version'] = old['terms_version']+int(changed)
            u.put('bike_earnings_policy', 'current', row)
            audit(u, 'BikeEarningPolicyUpdated', actor['id'], policy_version=row['version'])
            return row
        return store.run(save)

    @r.post('/earnings/riders/{identifier}/review')
    def review(identifier: str, body: Review, actor=Depends(core.operator)):
        def save(u):
            row = u.get('bike_independent_riders', identifier)
            if not row: fail('NOT_FOUND', 'Rider application not found.', 404)
            if row['version'] != body.expected_version: fail('STALE', 'Refresh this rider application.', 409)
            current = policy(u)
            if body.status == 'approved' and (not current['reviewed'] or current['paid_payout_bps'] <= 0 or
                    row.get('terms_version') != current['terms_version'] or
                    not _approved_profile(u, identifier, time.time()) or salary_enrolled(u, identifier)):
                fail('RIDER_APPROVAL_REQUIRED', 'Current documents and earning terms are required; salary and per-ride models cannot overlap.', 409)
            row.update(status=body.status, version=row['version']+1, review_reference=body.reference,
                       review_evidence=body.evidence, reviewed_at=time.time(), reviewed_by=actor['id'])
            u.put('bike_independent_riders', identifier, row)
            audit(u, 'BikeIndependentRiderReviewed', actor['id'], rider_id=identifier, status=body.status)
            return row
        return store.run(save)

    @r.post('/earnings/funding', status_code=201)
    def add_funding(body: Funding, actor=Depends(core.operator)):
        def save(u):
            identifier = digest('bike-earning-fund:'+body.request_id)
            old = u.get('bike_earnings_funding', identifier)
            if old:
                if old['hash'] != fingerprint(body): fail('IDEMPOTENCY_CONFLICT', 'This funding key has other details.', 409)
                return old
            ref = digest(normalize_reference(body.reference))
            if u.get('bike_earnings_funding_references', ref): fail('REFERENCE_REUSED', 'This funding reference was already recorded.', 409)
            value = u.get('bike_earnings_fund', 'current') or {'funded_paise': 0, 'version': 0}
            value['funded_paise'] += body.amount_paise; value['version'] += 1
            whole, remainder = divmod(body.amount_paise, FUND_BUCKETS)
            for bucket in range(FUND_BUCKETS):
                amount = whole+int(bucket < remainder)
                if amount:
                    balance = _fund_bucket(u, bucket)
                    balance['funded_paise'] += amount; balance['version'] += 1
                    u.put('bike_earnings_fund_buckets', str(bucket), balance)
            row = {**body.model_dump(), 'id': identifier, 'hash': fingerprint(body), 'recorded_by': actor['id'], 'created_at': time.time()}
            u.put('bike_earnings_fund', 'current', value); u.put('bike_earnings_funding', identifier, row)
            u.put('bike_earnings_funding_references', ref, {'id': ref, 'funding_id': identifier})
            audit(u, 'BikeIndependentPromotionFunding', actor['id'], amount_paise=body.amount_paise)
            return row
        return store.run(save)

    @r.get('/earnings/riders/{identifier}')
    def rider_records(identifier: str, response: Response, cursor: str | None=Query(default=None, max_length=100),
                      transfer_cursor: str | None=Query(default=None, max_length=100), actor=Depends(core.operator)):
        response.headers.update(HEADERS)
        return store.run(lambda u: driver_view(u, identifier, cursor, transfer_cursor))

    @r.post('/earnings/transfers', status_code=201)
    def transfer(body: Transfer, actor=Depends(core.operator)):
        def save(u):
            identifier = digest('bike-earning-transfer:'+body.request_id)
            old = u.get('bike_earning_transfers', identifier)
            if old:
                if old['hash'] != fingerprint(body): fail('IDEMPOTENCY_CONFLICT', 'This transfer key has other details.', 409)
                return old
            if len(set(body.credit_ids)) != len(body.credit_ids): fail('DUPLICATE_CREDIT', 'Select each earning once.', 422)
            credits = [u.get('bike_earning_credits', key) for key in body.credit_ids]
            if any(not credit or credit['driver_id'] != body.driver_id or credit['status'] != 'payable' for credit in credits):
                fail('EARNING_NOT_PAYABLE', 'Select only this rider’s payable earnings after company cash receipt.', 409)
            if sum(credit['amount_paise'] for credit in credits) != body.amount_paise:
                fail('AMOUNT_MISMATCH', 'The transfer must match the exact selected earnings.', 422)
            ref = digest(normalize_reference(body.reference))
            if u.get('bike_earning_transfer_references', ref): fail('REFERENCE_REUSED', 'This transfer reference was already recorded.', 409)
            for credit in credits:
                credit.update(status='transfer_reported', version=credit['version']+1, transfer_id=identifier)
                u.put('bike_earning_credits', credit['id'], credit)
            _change(u, body.driver_id, payable_paise=-body.amount_paise, transfer_reported_paise=body.amount_paise)
            row = {**body.model_dump(), 'id': identifier, 'hash': fingerprint(body), 'version': 1,
                   'status': 'transfer_reported', 'created_at': time.time(), 'reported_by': actor['id']}
            u.put('bike_earning_transfers', identifier, row)
            u.put('bike_earning_transfer_references', ref, {'id': ref, 'transfer_id': identifier})
            u.put('bike_earning_transfers_'+digest(body.driver_id)[:32], f'{9999999999999-int(row["created_at"]*1000):013d}:'+identifier,
                  {'id': f'{9999999999999-int(row["created_at"]*1000):013d}:'+identifier, 'transfer_id': identifier, 'active': True})
            audit(u, 'BikeIndependentTransferReported', actor['id'], driver_id=body.driver_id, amount_paise=body.amount_paise)
            return row
        return store.run(save)

    @r.post('/driver/earnings/transfers/{identifier}/receipt')
    def receipt(identifier: str, body: Receipt, user=Depends(core.current_user)):
        def save(u):
            row = u.get('bike_earning_transfers', identifier)
            if not row or row['driver_id'] != user['id']: fail('NOT_FOUND', 'Transfer not found.', 404)
            if row['status'] == 'rider_received': return row
            if row['version'] != body.expected_version: fail('STALE', 'Refresh this transfer.', 409)
            for key in row['credit_ids']:
                credit = u.get('bike_earning_credits', key)
                if not credit or credit.get('transfer_id') != identifier or credit['status'] != 'transfer_reported':
                    fail('EARNING_LEDGER_REVIEW', 'This transfer needs review.', 409)
                credit.update(status='rider_received', version=credit['version']+1)
                u.put('bike_earning_credits', key, credit)
            _change(u, user['id'], transfer_reported_paise=-row['amount_paise'], received_paise=row['amount_paise'])
            row.update(status='rider_received', version=row['version']+1, received_at=time.time())
            u.put('bike_earning_transfers', identifier, row)
            audit(u, 'BikeIndependentTransferReceived', user['id'], transfer_id=identifier)
            return row
        return store.run(save)
    core.app.include_router(r)
