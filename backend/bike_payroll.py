"""Company bike rider salary obligations and explicitly reported receipts.

An enrollment earns a fixed INR 7,000 monthly obligation. This is neither a
per-trip payout nor a bank integration. Admin-reported transfers remain pending
until that rider confirms receipt. All identifiers are deterministic, so retries
and concurrent admin requests cannot pay a period or reuse a transfer twice.
"""
import copy
import math
import re
import time
from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, Response
from pydantic import Field, model_validator

from integrations import audit
from local_business import digest, fingerprint, partner_profile
from operations import Input, fail

INDIA = ZoneInfo('Asia/Kolkata')
SALARY_PAISE = 700000
MAX_RIDERS = 3
HEADERS = {'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer'}
DEFAULT = dict(version=0, enabled=False, service_city='Balasore',
               compensation_model='monthly_salary', monthly_salary_paise=SALARY_PAISE,
               monthly_funding_paise=0, funding_period='', funding_reference='',
               funding_evidence='', funding_acknowledged=False, roster=[])
PERIOD = r'^20[0-9]{2}-(0[1-9]|1[0-2])$'


class RosterEntry(Input):
    driver_id: str = Field(min_length=1, max_length=128, pattern=r'^[A-Za-z0-9_:.@-]+$')
    active: bool = True


class Policy(Input):
    expected_version: int = Field(ge=0, strict=True)
    enabled: bool = False
    monthly_funding_paise: int = Field(default=0, ge=0, le=1000000000, strict=True)
    funding_period: str = Field(default='', max_length=7)
    funding_reference: str = Field(default='', max_length=200)
    funding_evidence: str = Field(default='', max_length=1000)
    funding_acknowledged: bool = False
    roster: list[RosterEntry] = Field(default_factory=list, max_length=MAX_RIDERS)

    @model_validator(mode='after')
    def valid(self):
        identifiers = [r.driver_id for r in self.roster]
        if len(set(identifiers)) != len(identifiers):
            raise ValueError('Choose each rider only once.')
        if self.funding_period and not re.fullmatch(PERIOD, self.funding_period):
            raise ValueError('Use a valid YYYY-MM funding month.')
        if self.monthly_funding_paise and (not self.funding_acknowledged or
                len(self.funding_reference.strip()) < 8 or len(self.funding_evidence.strip()) < 10):
            raise ValueError('Acknowledge available salary funding and record its reference and evidence.')
        return self


class SalaryPayment(Input):
    expected_version: int = Field(ge=1, strict=True)
    amount_paise: int = Field(ge=SALARY_PAISE, le=SALARY_PAISE, strict=True)
    transfer_reference: str = Field(min_length=8, max_length=200)
    evidence: str = Field(min_length=10, max_length=1000)

    @model_validator(mode='after')
    def reference(self):
        if len(normalize_reference(self.transfer_reference)) < 8:
            raise ValueError('Use the actual transfer reference, with at least eight letters or digits.')
        if len(self.evidence.strip()) < 10:
            raise ValueError('Record evidence of the reported transfer.')
        return self


class SalaryReceipt(Input):
    expected_version: int = Field(ge=1, strict=True)
    received: Literal[True]


class CashRemittance(Input):
    expected_version: int = Field(ge=0, strict=True)
    request_id: str = Field(min_length=16, max_length=100)
    ride_ids: list[str] = Field(min_length=1, max_length=100)
    amount_paise: int = Field(ge=1, le=1000000000, strict=True)
    deposit_reference: str = Field(min_length=8, max_length=200)
    evidence: str = Field(min_length=10, max_length=1000)

    @model_validator(mode='after')
    def valid(self):
        if len(set(self.ride_ids)) != len(self.ride_ids) or any(not 1 <= len(key) <= 128 for key in self.ride_ids):
            raise ValueError('Choose each collected ride only once.')
        if len(normalize_reference(self.deposit_reference)) < 8 or len(self.evidence.strip()) < 10:
            raise ValueError('Record the actual deposit reference and supporting evidence.')
        return self


class CashReceipt(Input):
    expected_version: int = Field(ge=1, strict=True)
    received: Literal[True]
    receipt_reference: str = Field(min_length=8, max_length=200)
    evidence: str = Field(min_length=10, max_length=1000)

    @model_validator(mode='after')
    def valid(self):
        if len(normalize_reference(self.receipt_reference)) < 8 or len(self.evidence.strip()) < 10:
            raise ValueError('Record the company receipt reference and supporting evidence.')
        return self


def period_at(now=None):
    return datetime.fromtimestamp(time.time() if now is None else now, INDIA).strftime('%Y-%m')


def valid_period(value, now=None):
    if not re.fullmatch(PERIOD, value or ''):
        fail('INVALID_PAYROLL_PERIOD', 'Choose a salary month in YYYY-MM format.', 422)
    if value > period_at(now):
        fail('FUTURE_PAYROLL_PERIOD', 'Salary receipt records cannot be created for a future month.', 422)
    return value


def previous_periods(period, count=12):
    year, month = map(int, period.split('-'))
    offset = year * 12 + month - 1
    return [f'{(offset-i)//12:04}-{(offset-i)%12+1:02}' for i in range(count)]


def period_bounds(period):
    year, month = map(int, period.split('-'))
    next_year, next_month = (year + 1, 1) if month == 12 else (year, month + 1)
    return (datetime(year, month, 1, tzinfo=INDIA).timestamp(),
            datetime(next_year, next_month, 1, tzinfo=INDIA).timestamp())


def normalize_reference(reference):
    return re.sub(r'[^a-z0-9]', '', reference.casefold())


def salary_key(driver_id, period):
    return digest('bike-salary:' + driver_id + ':' + period)


def policy(u):
    return {**copy.deepcopy(DEFAULT), **(u.get('bike_payroll_policy', 'current') or {})}


def _approved_profile(u, driver_id, now):
    for role in ('driver', 'cab_owner'):
        profile = partner_profile(u, driver_id, role)
        if not profile or profile.get('role') != role or profile.get('status') != 'approved':
            continue
        if str(profile.get('city', '')).strip().casefold() != 'balasore':
            continue
        expiry = profile.get('valid_until', 0)
        if not isinstance(expiry, (int, float)) or not math.isfinite(expiry) or expiry <= now:
            continue
        documents = profile.get('document_ids') or []
        if not 1 <= len(documents) <= 8:
            continue
        current = True
        for identifier in documents:
            document = u.get('business_documents', identifier)
            if not document or document.get('owner_id') != driver_id:
                current = False
                break
            expires = document.get('expires_at')
            if expires is not None and (not isinstance(expires, (int, float)) or
                    not math.isfinite(expires) or expires <= now):
                current = False
                break
        if current:
            return profile
    return None


def _active_roster(p):
    return [row for row in p.get('roster', []) if row.get('active') is True]


def _enrolled_during(roster, period):
    start, end = period_bounds(period)
    return any(enrollment['started_at'] < end and
               (enrollment.get('ended_at') is None or enrollment['ended_at'] > start)
               for enrollment in (roster or {}).get('enrollments', []))


def _ensure_obligation(u, driver_id, period, now, actor='system'):
    key = salary_key(driver_id, period)
    saved = u.get('bike_salary_obligations', key)
    if saved:
        return saved
    roster = u.get('bike_salary_roster', digest(driver_id))
    if not roster or not _enrolled_during(roster, period):
        return None
    row = dict(id=key, driver_id=driver_id, driver_name=roster['name'], period=period,
               amount_paise=SALARY_PAISE, currency='INR', status='owed', version=1,
               compensation_model='monthly_salary', service_city='Balasore',
               created_at=now, transfer=None, received_at=None)
    index = u.get('bike_salary_periods', period) or {'period': period, 'driver_ids': []}
    if driver_id not in index['driver_ids']:
        if len(index['driver_ids']) >= 100:
            fail('PAYROLL_PERIOD_REVIEW', 'This salary month needs a company payroll review.', 409)
        index['driver_ids'].append(driver_id)
        u.put('bike_salary_periods', period, index)
    u.put('bike_salary_obligations', key, row)
    audit(u, 'BikeSalaryObligationCreated', actor, driver_id=driver_id, period=period,
          amount_paise=SALARY_PAISE, obligation_id=key)
    return row


def _accrue_enrollment(u, driver_id, now, actor='system', *, limit=12, require_complete=False):
    """Catch up missed scheduler months with bounded transaction writes.

    Offboarding accounts for all elapsed employment months before closing the
    enrollment; expired driving documents do not cancel an employee's salary.
    """
    roster = u.get('bike_salary_roster', digest(driver_id))
    if not roster or not roster.get('enrollments'):
        return True
    first = period_at(min(row['started_at'] for row in roster['enrollments']))
    current = period_at(now)
    year, month = map(int, first.split('-'))
    end_year, end_month = map(int, current.split('-'))
    start_index, end_index = year*12+month-1, end_year*12+end_month-1
    accounted = roster.get('salary_accounted_through', '')
    periods = [f'{value//12:04}-{value%12+1:02}' for value in range(start_index, end_index+1)]
    pending = [period for period in periods if period > accounted and _enrolled_during(roster, period)]
    if require_complete and len(pending) > limit:
        fail('SALARY_CATCHUP_REQUIRED', 'Refresh company payroll to finish salary accounting before offboarding this rider.', 409)
    for period in pending[:limit]:
        _ensure_obligation(u, driver_id, period, now, actor)
    if pending:
        roster['salary_accounted_through'] = pending[min(len(pending), limit)-1]
        u.put('bike_salary_roster', digest(driver_id), roster)
    return len(pending) <= limit


def tick(u, now=None):
    """Idempotent monthly accounting for a bounded company roster, no scans."""
    now = time.time() if now is None else now
    current = period_at(now)
    identifiers = [r['driver_id'] for r in _active_roster(policy(u))]
    if len(identifiers) > MAX_RIDERS:
        fail('INVALID_PAYROLL_ROSTER', 'Review the company rider roster before salary accounting.', 409)
    for driver_id in identifiers:
        _accrue_enrollment(u, driver_id, now)
        _ensure_obligation(u, driver_id, current, now)
    return {'period': current, 'rider_count': len(identifiers)}


def policy_readiness(u, p=None, now=None):
    """Read-only compatibility hook for the bike booking policy.

    ``p`` may be the ride tariff policy. Payroll always uses its own server-owned
    configuration, never caller-supplied fares or client flags.
    """
    now = time.time() if now is None else now
    payroll = policy(u)
    rows = _active_roster(payroll)
    identifiers = [row.get('driver_id') for row in rows]
    approved = sum(bool(_approved_profile(u, uid, now)) for uid in identifiers if uid)
    current = period_at(now)
    month = u.get('bike_salary_periods', current) or {'driver_ids': []}
    # Offboarding never removes already earned monthly salary commitments.
    owed_ids = set(month['driver_ids']) | set(uid for uid in identifiers if uid)
    liability = len(owed_ids) * SALARY_PAISE
    evidence = (payroll.get('funding_acknowledged') is True and
                len(str(payroll.get('funding_reference', '')).strip()) >= 8 and
                len(str(payroll.get('funding_evidence', '')).strip()) >= 10)
    funding = payroll.get('monthly_funding_paise', 0)
    funding_ready = bool(liability and type(funding) is int and funding >= liability and
                         payroll.get('funding_period') == current and evidence)
    blockers = []
    if not payroll.get('enabled'):
        blockers.append('Company rider payroll is not enabled.')
    if not 1 <= len(rows) <= MAX_RIDERS or len(set(identifiers)) != len(identifiers):
        blockers.append('Enroll between one and three distinct company riders.')
    if approved != len(rows):
        blockers.append('Every enrolled rider needs current Balasore approval and supporting documents.')
    if not funding_ready:
        blockers.append('Acknowledge and evidence salary funding for the current month and all earned obligations.')
    return dict(payroll_ready=not blockers, funding_ready=funding_ready,
                approved_rider_count=approved, monthly_salary_liability_paise=liability,
                monthly_funding_paise=funding if type(funding) is int else 0,
                funding_period=payroll.get('funding_period', ''), blockers=blockers)


def approved_salaried_driver(u, driver_id, now=None):
    now = time.time() if now is None else now
    p = policy(u)
    return bool(any(row['driver_id'] == driver_id for row in _active_roster(p)) and
                _approved_profile(u, driver_id, now) and policy_readiness(u, None, now)['payroll_ready'])


def _candidates(u, now, cursor=None):
    rows = u.find('business_partners', 'status', 'approved', limit=100, after=cursor)
    result = {}
    for row in rows:
        if row.get('role') not in ('cab_owner', 'driver') or str(row.get('city', '')).strip().casefold() != 'balasore':
            continue
        uid = row.get('user_id') or row.get('id')
        if not uid or uid in result:
            continue
        profile = _approved_profile(u, uid, now)
        if profile:
            result[uid] = dict(driver_id=uid, name=profile['name'], role=profile['role'],
                               city='Balasore', valid_until=profile['valid_until'])
    return {'candidates': list(result.values()),
            'next_cursor': rows[-1]['id'] if len(rows) == 100 else None}


def _admin_view(u, period, now):
    p = policy(u)
    for row in _active_roster(p):
        if period == period_at(now):
            _accrue_enrollment(u, row['driver_id'], now)
        _ensure_obligation(u, row['driver_id'], period, now)
    index = u.get('bike_salary_periods', period) or {'driver_ids': []}
    obligations = [u.get('bike_salary_obligations', salary_key(uid, period)) for uid in index['driver_ids']]
    candidates = _candidates(u, now)
    cash_accounts = u.find('bike_company_cash_accounts', 'outstanding', True, limit=100)
    pending = u.find('bike_cash_remittances', 'status', 'deposit_reported', limit=100)
    return dict(policy=p, readiness=policy_readiness(u, None, now), period=period,
                obligations=[row for row in obligations if row],
                candidates=candidates['candidates'], candidates_next_cursor=candidates['next_cursor'],
                server_time=now, transfer_note='Transfers are recorded by the company; only the rider can confirm receipt.',
                company_cash_summary=company_cash_totals(u), company_cash_accounts=cash_accounts,
                cash_accounts_next_cursor=cash_accounts[-1]['id'] if len(cash_accounts) == 100 else None,
                cash_remittances=[_remittance_view(row) for row in pending],
                cash_remittances_next_cursor=pending[-1]['id'] if len(pending) == 100 else None,
                cash_scope='all_time_company_cash', remittance_history_scope='pending_company_receipt')


def _empty_cash(driver_id=None):
    return dict(driver_id=driver_id, currency='INR', version=0, collected_paise=0,
                reported_remittance_paise=0, confirmed_remittance_paise=0,
                outstanding_held_paise=0, available_to_report_paise=0, outstanding=False)


def company_cash_totals(u):
    """Exact 16-shard total plus the immutable pre-sharding ledger baseline."""
    value = u.get('bike_company_cash_totals', 'current') or _empty_cash()
    u.prefetch([('bike_company_cash_total_shards', str(i)) for i in range(16)])
    for identifier in range(16):
        row = u.get('bike_company_cash_total_shards', str(identifier)) or {}
        for key in ('collected_paise', 'reported_remittance_paise', 'confirmed_remittance_paise', 'version'):
            value[key] += row.get(key, 0)
    value['outstanding_held_paise'] = value['collected_paise']-value['confirmed_remittance_paise']
    value['available_to_report_paise'] = value['outstanding_held_paise']-value['reported_remittance_paise']
    value['outstanding'] = value['outstanding_held_paise'] > 0
    return value


def _cash_account(u, driver_id):
    return u.get('bike_company_cash_accounts', digest(driver_id)) or _empty_cash(driver_id)


def _cash_change(u, driver_id, now, *, collected=0, reported=0, confirmed=0, months=None):
    shard = str(int(digest(driver_id)[:8], 16) % 16)
    pairs = [('bike_company_cash_accounts', digest(driver_id), _cash_account(u, driver_id)),
             ('bike_company_cash_total_shards', shard, u.get('bike_company_cash_total_shards', shard) or _empty_cash())]
    for period, changes in (months or {}).items():
        key = digest(driver_id + ':' + period)
        existing = u.get('bike_company_cash_monthly', key) or {**_empty_cash(driver_id), 'period':period}
        pairs.append(('bike_company_cash_monthly', key, existing))
    for collection, key, row in pairs:
        delta = (months or {}).get(row.get('period')) if collection == 'bike_company_cash_monthly' else None
        delta = delta or dict(collected=collected, reported=reported, confirmed=confirmed)
        row['collected_paise'] += delta.get('collected', 0)
        row['reported_remittance_paise'] += delta.get('reported', 0)
        row['confirmed_remittance_paise'] += delta.get('confirmed', 0)
        row['outstanding_held_paise'] = row['collected_paise']-row['confirmed_remittance_paise']
        row['available_to_report_paise'] = row['outstanding_held_paise']-row['reported_remittance_paise']
        # Shards are signed deltas against the immutable historical total.
        # A pre-migration cash receipt can legitimately create a negative delta
        # here. Each rider and month still enforces the full cash invariants.
        if collection != 'bike_company_cash_total_shards' and min(row['collected_paise'], row['reported_remittance_paise'], row['confirmed_remittance_paise'],
               row['outstanding_held_paise'], row['available_to_report_paise']) < 0:
            fail('CASH_LEDGER_REVIEW', 'Company fare collections need an accounting review.', 409)
        row.update(id=key, version=row['version']+1, updated_at=now, outstanding=row['outstanding_held_paise']>0)
        u.put(collection, key, row)


def record_company_cash(u, ride, now=None):
    """Called atomically by actual ride cash-receipt transitions, once per ride.

    It does not charge, deposit, pay salary, or manufacture a bank confirmation.
    Later salary changes and employee offboarding cannot erase company cash.
    """
    now = time.time() if now is None else now
    amount = ride.get('collected_paise')
    pricing = ride.get('pricing') or {}
    if (ride.get('state') != 'completed' or ride.get('payment_status') not in
            ('rider_confirmed_cash', 'operator_reported_collection') or
            pricing.get('free') is not False or type(amount) is not int or amount <= 0 or
            amount != pricing.get('customer_total_paise') or not ride.get('driver_id')):
        fail('CASH_RECEIPT_REQUIRED', 'Only a completed, explicitly collected paid ride can enter company cash accounting.', 409)
    key = digest('bike-cash:' + ride['id'])
    old = u.get('bike_company_cash_credits', key)
    if old:
        if old['driver_id'] != ride['driver_id'] or old['amount_paise'] != amount:
            fail('CASH_CREDIT_CONFLICT', 'This ride already has a different company cash record.', 409)
        if old['status'] == 'company_received':
            ride.update(company_cash_held_paise=0, company_collection_status='company_received',
                        company_remittance_id=old.get('remittance_id'),
                        company_cash_received_at=old.get('received_at'))
        return old
    period = period_at(now)
    credit = dict(id=key, ride_id=ride['id'], driver_id=ride['driver_id'], amount_paise=amount,
                  collected_at=now, period=period, status='held_by_rider', remittance_id=None,
                  unremitted_driver_id=ride['driver_id'], currency='INR')
    u.put('bike_company_cash_credits', key, credit)
    _cash_change(u, ride['driver_id'], now, collected=amount,
                 months={period:{'collected':amount}})
    audit(u, 'BikeCompanyFareCollected', ride['driver_id'], ride_id=ride['id'],
          amount_paise=amount, collection_source=ride['payment_status'])
    return credit


def _driver_remittances(u, uid, cursor=None, collection_cursor=None):
    items = u.find('bike_cash_remittances', 'driver_id', uid, limit=25, after=cursor)
    credits = u.find('bike_company_cash_credits', 'unremitted_driver_id', uid,
                     limit=100, after=collection_cursor)
    return dict(company_cash=_cash_account(u, uid), items=[_remittance_view(row) for row in items],
                next_cursor=items[-1]['id'] if len(items) == 25 else None,
                available_collections=[{key:row[key] for key in ('ride_id','amount_paise','collected_at','period')} for row in credits],
                collections_next_cursor=credits[-1]['id'] if len(credits) == 100 else None)


def _remittance_view(row):
    return {key:value for key,value in row.items() if key != 'request_fingerprint'}


def install(core):
    store = core.operations_store
    router = APIRouter(prefix='/operations/bike-rides', tags=['Company bike rider payroll'])

    @router.get('/payroll/candidates')
    def candidates(response: Response, cursor: str | None = Query(default=None, max_length=200), admin=Depends(core.operator)):
        response.headers.update(HEADERS)
        return store.run(lambda u: _candidates(u, time.time(), cursor))

    @router.get('/payroll')
    def get_payroll(response: Response, period: str | None = None, admin=Depends(core.operator)):
        response.headers.update(HEADERS)
        now = time.time()
        selected = valid_period(period or period_at(now), now)
        return store.run(lambda u: _admin_view(u, selected, now))

    @router.get('/payroll/cash-accounts')
    def cash_accounts(response: Response, cursor: str | None = Query(default=None, max_length=200),
                      admin=Depends(core.operator)):
        response.headers.update(HEADERS)
        def read(u):
            rows = u.find('bike_company_cash_accounts', 'outstanding', True, limit=100, after=cursor)
            return dict(items=rows, next_cursor=rows[-1]['id'] if len(rows) == 100 else None,
                        company_cash_summary=company_cash_totals(u), cash_scope='all_time_company_cash')
        return store.run(read)

    @router.get('/payroll/remittances')
    def pending_remittances(response: Response, cursor: str | None = Query(default=None, max_length=200),
                            admin=Depends(core.operator)):
        response.headers.update(HEADERS)
        def read(u):
            rows = u.find('bike_cash_remittances', 'status', 'deposit_reported', limit=100, after=cursor)
            return dict(items=[_remittance_view(row) for row in rows], next_cursor=rows[-1]['id'] if len(rows) == 100 else None,
                        scope='pending_company_receipt')
        return store.run(read)

    @router.post('/payroll/remittances/{identifier}/confirm')
    def receive_remittance(identifier: str, body: CashReceipt, response: Response,
                           admin=Depends(core.operator)):
        response.headers.update(HEADERS)
        now = time.time()
        def save(u):
            row = u.get('bike_cash_remittances', identifier)
            if not row:
                fail('NOT_FOUND', 'Company fare deposit unavailable.', 404)
            normalized = normalize_reference(body.receipt_reference)
            receipt_key = digest('bike-company-cash-receipt:' + normalized)
            if row.get('receipt'):
                receipt = row['receipt']
                if normalize_reference(receipt['reference']) == normalized and receipt['evidence'] == body.evidence.strip():
                    return _remittance_view(row)
                fail('CASH_RECEIPT_EXISTS', 'The company already recorded receipt of this deposit.', 409)
            if row['version'] != body.expected_version:
                fail('STALE', 'Refresh the fare deposit before confirming company receipt.', 409)
            if row['status'] != 'deposit_reported':
                fail('DEPOSIT_REPORT_REQUIRED', 'A rider must report the fare deposit before company receipt.', 409)
            if u.get('bike_cash_receipt_references', receipt_key):
                fail('CASH_RECEIPT_REFERENCE_REUSED', 'This company receipt reference belongs to another deposit.', 409)
            months = {}
            credits = []
            for ride_id in row['ride_ids']:
                credit = u.get('bike_company_cash_credits', digest('bike-cash:' + ride_id))
                if not credit or credit.get('remittance_id') != identifier or credit['driver_id'] != row['driver_id'] or credit['status'] != 'deposit_reported':
                    fail('CASH_LEDGER_REVIEW', 'This fare deposit needs an accounting review before receipt.', 409)
                amount = credit['amount_paise']
                month = months.setdefault(credit['period'], {'reported':0, 'confirmed':0})
                month['reported'] -= amount
                month['confirmed'] += amount
                credits.append(credit)
            if sum(credit['amount_paise'] for credit in credits) != row['amount_paise']:
                fail('CASH_LEDGER_REVIEW', 'This deposit amount does not match its ride collections.', 409)
            _cash_change(u, row['driver_id'], now, reported=-row['amount_paise'],
                         confirmed=row['amount_paise'], months=months)
            for credit in credits:
                credit.update(status='company_received', received_at=now)
                u.put('bike_company_cash_credits', credit['id'], credit)
                ride = u.get('bike_rides', credit['ride_id'])
                if ride and ride.get('driver_id') == row['driver_id']:
                    ride.update(company_cash_held_paise=0, company_collection_status='company_received',
                                company_remittance_id=identifier, company_cash_received_at=now)
                    u.put('bike_rides', ride['id'], ride)
                    from bike_earnings import cash_received_by_company
                    cash_received_by_company(u, ride)
            receipt = dict(reference=body.receipt_reference.strip(), evidence=body.evidence.strip(),
                           confirmed_by=admin['id'], confirmed_at=now,
                           source='company_confirmed_receipt')
            row.update(status='company_received', version=row['version']+1, receipt=receipt,
                       received_at=now, updated_at=now)
            u.put('bike_cash_remittances', identifier, row)
            u.put('bike_cash_receipt_references', receipt_key,
                  dict(remittance_id=identifier, reference=normalized, recorded_at=now))
            audit(u, 'BikeCompanyFareRemittanceReceived', admin['id'], remittance_id=identifier,
                  driver_id=row['driver_id'], amount_paise=row['amount_paise'],
                  receipt_reference=receipt['reference'])
            return _remittance_view(row)
        return store.run(save)

    @router.put('/payroll')
    def put_payroll(body: Policy, response: Response, admin=Depends(core.operator)):
        response.headers.update(HEADERS)
        now = time.time()
        current = period_at(now)
        def save(u):
            old = policy(u)
            for member in body.roster:
                independent = u.get('bike_independent_riders', member.driver_id) or {}
                if member.active and independent.get('status') == 'approved':
                    fail('COMPENSATION_CONFLICT', 'Suspend this rider’s per-ride agreement before assigning a salary.', 409)
            if old['version'] != body.expected_version:
                fail('STALE', 'Refresh the company payroll before changing its roster or funding.', 409)
            if body.monthly_funding_paise and body.funding_period != current:
                fail('CURRENT_SALARY_FUNDING_REQUIRED', 'Record available salary funding for the current month.', 422)
            incoming = {r.driver_id: r for r in body.roster if r.active}
            profiles = {}
            for driver_id in incoming:
                profile = _approved_profile(u, driver_id, now)
                if not profile:
                    fail('APPROVED_SALARIED_RIDER_REQUIRED', 'Enroll a Balasore rider with current driver or owner-driver approval and documents.', 422)
                profiles[driver_id] = profile
            previous = {row['driver_id']: row for row in _active_roster(old)}
            # Preserve every obligation earned before offboarding, even if an
            # operating approval has expired or the ride service is paused.
            for driver_id in previous:
                _accrue_enrollment(u, driver_id, now, admin['id'], limit=60, require_complete=True)
                _ensure_obligation(u, driver_id, current, now, admin['id'])
            roster = []
            for driver_id, profile in profiles.items():
                existing = u.get('bike_salary_roster', digest(driver_id)) or dict(
                    driver_id=driver_id, enrollments=[], first_enrolled_at=now)
                if not existing.get('active'):
                    existing['enrollments'].append({'started_at': now, 'ended_at': None})
                existing.update(active=True, name=profile['name'], role=profile['role'],
                                service_city='Balasore', monthly_salary_paise=SALARY_PAISE,
                                updated_at=now, updated_by=admin['id'])
                u.put('bike_salary_roster', digest(driver_id), existing)
                roster.append(dict(driver_id=driver_id, active=True,
                                   enrolled_at=existing['enrollments'][-1]['started_at'],
                                   name=profile['name'], role=profile['role'],
                                   approval_valid_until=profile['valid_until']))
                _ensure_obligation(u, driver_id, current, now, admin['id'])
                _accrue_enrollment(u, driver_id, now, admin['id'], limit=60, require_complete=True)
            for driver_id in previous.keys() - incoming.keys():
                existing = u.get('bike_salary_roster', digest(driver_id))
                if existing:
                    for enrollment in existing['enrollments']:
                        if enrollment.get('ended_at') is None:
                            enrollment['ended_at'] = now
                    existing.update(active=False, offboarded_at=now, updated_at=now,
                                    updated_by=admin['id'])
                    u.put('bike_salary_roster', digest(driver_id), existing)
            p = {**old, **body.model_dump(exclude={'expected_version', 'roster'}),
                 'version': old['version']+1, 'roster': roster,
                 'updated_at': now, 'updated_by': admin['id']}
            u.put('bike_payroll_policy', 'current', p)
            ready = policy_readiness(u, None, now)
            if p['enabled'] and not ready['payroll_ready']:
                fail('SALARY_FUNDING_REQUIRED', ' '.join(ready['blockers']), 422)
            audit(u, 'BikePayrollPolicyUpdated', admin['id'], policy_version=p['version'],
                  active_driver_ids=list(incoming), monthly_funding_paise=p['monthly_funding_paise'],
                  funding_period=p['funding_period'], funding_reference=p['funding_reference'])
            return _admin_view(u, current, now)
        return store.run(save)

    @router.post('/payroll/{driver_id}/{period}/payment')
    def report_payment(driver_id: str, period: str, body: SalaryPayment,
                       response: Response, admin=Depends(core.operator)):
        response.headers.update(HEADERS)
        now = time.time()
        valid_period(period, now)
        def save(u):
            row = _ensure_obligation(u, driver_id, period, now, admin['id'])
            if not row:
                fail('NOT_FOUND', 'This rider has no earned salary obligation for that month.', 404)
            reference = normalize_reference(body.transfer_reference)
            transfer_key = digest('bike-salary-transfer:' + reference)
            old = u.get('bike_salary_transfer_references', transfer_key)
            transfer = row.get('transfer')
            if transfer:
                if (normalize_reference(transfer['reference']) == reference and
                        transfer['amount_paise'] == body.amount_paise and
                        transfer['evidence'] == body.evidence.strip()):
                    return row
                fail('SALARY_TRANSFER_EXISTS', 'This month already has a reported salary transfer; reconcile it before any further transfer.', 409)
            if old:
                fail('TRANSFER_REFERENCE_REUSED', 'This salary transfer reference is already assigned to another obligation.', 409)
            if row['version'] != body.expected_version:
                fail('STALE', 'Refresh this salary obligation before reporting a transfer.', 409)
            transfer = dict(amount_paise=body.amount_paise, reference=body.transfer_reference.strip(),
                            evidence=body.evidence.strip(), reported_at=now,
                            reported_by=admin['id'], source='company_reported_transfer')
            row.update(transfer=transfer, status='transfer_reported', version=row['version']+1,
                       updated_at=now)
            u.put('bike_salary_transfer_references', transfer_key,
                  dict(reference=reference, obligation_id=row['id'], driver_id=driver_id,
                       period=period, amount_paise=body.amount_paise, created_at=now))
            u.put('bike_salary_obligations', row['id'], row)
            audit(u, 'BikeSalaryTransferReported', admin['id'], driver_id=driver_id,
                  period=period, obligation_id=row['id'], amount_paise=body.amount_paise,
                  transfer_reference=transfer['reference'])
            return row
        return store.run(save)

    @router.get('/driver/payroll')
    def driver_payroll(response: Response, period: str | None = None, user=Depends(core.current_user)):
        response.headers.update(HEADERS)
        now = time.time()
        selected = valid_period(period or period_at(now), now)
        periods = [selected] if period else previous_periods(selected)
        def read(u):
            roster = u.get('bike_salary_roster', digest(user['id']))
            if roster and hasattr(u, 'prefetch'):
                u.prefetch([('bike_salary_obligations', salary_key(user['id'], month)) for month in periods])
            rows = [_ensure_obligation(u, user['id'], month, now) for month in periods] if roster else []
            p = policy(u)
            cash = _cash_account(u, user['id'])
            cash_rows = u.find('bike_cash_remittances', 'driver_id', user['id'], limit=25)
            return dict(driver_id=user['id'], period=selected, compensation_model='monthly_salary',
                        monthly_salary_paise=SALARY_PAISE, currency='INR', service_city='Balasore',
                        rostered=any(r['driver_id'] == user['id'] for r in _active_roster(p)),
                        approved=bool(_approved_profile(u, user['id'], now)),
                        roster={key: roster.get(key) for key in ('driver_id', 'active', 'first_enrolled_at', 'offboarded_at')} if roster else None,
                        obligations=[row for row in rows if row], server_time=now,
                        company_cash=cash, cash_remittances=[_remittance_view(row) for row in cash_rows],
                        cash_remittances_next_cursor=cash_rows[-1]['id'] if len(cash_rows) == 25 else None,
                        company_cash_monthly=u.get('bike_company_cash_monthly', digest(user['id']+':'+selected)) or {**_empty_cash(user['id']), 'period':selected},
                        cash_scope='all_time_company_cash',
                        salary_note='Monthly salary is separate from company ride fare collections. A reported transfer still needs your receipt confirmation.')
        return store.run(read)

    @router.get('/driver/remittances')
    def driver_remittances(response: Response, cursor: str | None = Query(default=None, max_length=200),
                           collection_cursor: str | None = Query(default=None, max_length=200),
                           user=Depends(core.current_user)):
        response.headers.update(HEADERS)
        return store.run(lambda u: _driver_remittances(u, user['id'], cursor, collection_cursor))

    @router.post('/driver/remittances', status_code=201)
    def report_remittance(body: CashRemittance, response: Response, user=Depends(core.current_user)):
        response.headers.update(HEADERS)
        now = time.time()
        def save(u):
            identifier = digest(user['id'] + ':company-cash-deposit:' + body.request_id)
            existing = u.get('bike_cash_remittances', identifier)
            if existing:
                if existing['request_fingerprint'] != fingerprint(body):
                    fail('IDEMPOTENCY_CONFLICT', 'This deposit request already records different details.', 409)
                return {key:value for key,value in existing.items() if key != 'request_fingerprint'}
            account = _cash_account(u, user['id'])
            if account['version'] != body.expected_version:
                fail('STALE', 'Refresh your fare collections before reporting a deposit.', 409)
            normalized = normalize_reference(body.deposit_reference)
            ref_key = digest('bike-company-cash-deposit:' + normalized)
            if u.get('bike_cash_deposit_references', ref_key):
                fail('DEPOSIT_REFERENCE_REUSED', 'This fare deposit reference has already been recorded.', 409)
            credits = []
            months = {}
            for ride_id in body.ride_ids:
                credit = u.get('bike_company_cash_credits', digest('bike-cash:' + ride_id))
                if not credit or credit['driver_id'] != user['id']:
                    fail('NOT_FOUND', 'A selected fare collection is unavailable for this rider.', 404)
                if credit.get('remittance_id') or credit['status'] != 'held_by_rider':
                    fail('FARE_ALREADY_REMITTED', 'A selected ride already belongs to a reported fare deposit.', 409)
                credits.append(credit)
                month = months.setdefault(credit['period'], {'reported':0})
                month['reported'] += credit['amount_paise']
            if sum(credit['amount_paise'] for credit in credits) != body.amount_paise:
                fail('DEPOSIT_AMOUNT_MISMATCH', 'Report the exact full cash amount for the selected ride collections.', 422)
            if body.amount_paise > account['available_to_report_paise']:
                fail('CASH_LEDGER_REVIEW', 'This fare deposit exceeds your unreported company cash.', 409)
            row = dict(id=identifier, driver_id=user['id'], version=1, status='deposit_reported',
                       amount_paise=body.amount_paise, currency='INR',
                       deposit_reference=body.deposit_reference.strip(), evidence=body.evidence.strip(),
                       ride_ids=body.ride_ids, reported_at=now, received_at=None, receipt=None,
                       request_fingerprint=fingerprint(body), source='rider_reported_deposit')
            for credit in credits:
                credit.update(remittance_id=identifier, status='deposit_reported', unremitted_driver_id=None)
                u.put('bike_company_cash_credits', credit['id'], credit)
            _cash_change(u, user['id'], now, reported=body.amount_paise, months=months)
            u.put('bike_cash_remittances', identifier, row)
            u.put('bike_cash_deposit_references', ref_key,
                  dict(reference=normalized, remittance_id=identifier, driver_id=user['id'], created_at=now))
            audit(u, 'BikeCompanyFareRemittanceReported', user['id'], remittance_id=identifier,
                  driver_id=user['id'], amount_paise=body.amount_paise, deposit_reference=row['deposit_reference'])
            return {key:value for key,value in row.items() if key != 'request_fingerprint'}
        return store.run(save)

    @router.post('/driver/payroll/{period}/confirm')
    def confirm_receipt(period: str, body: SalaryReceipt, response: Response,
                        user=Depends(core.current_user)):
        response.headers.update(HEADERS)
        now = time.time()
        valid_period(period, now)
        def save(u):
            row = u.get('bike_salary_obligations', salary_key(user['id'], period))
            if not row:
                fail('NOT_FOUND', 'No salary receipt is available for this account and month.', 404)
            if row['status'] == 'driver_received':
                return row
            if row['version'] != body.expected_version:
                fail('STALE', 'Refresh your salary receipt before confirming.', 409)
            if row['status'] != 'transfer_reported' or not row.get('transfer'):
                fail('SALARY_TRANSFER_REQUIRED', 'The company must report its salary transfer before you confirm receipt.', 409)
            row.update(status='driver_received', received_at=now, received_by=user['id'],
                       version=row['version']+1, updated_at=now,
                       receipt_source='driver_confirmed_receipt')
            u.put('bike_salary_obligations', row['id'], row)
            audit(u, 'BikeSalaryReceiptConfirmed', user['id'], driver_id=user['id'],
                  period=period, obligation_id=row['id'], amount_paise=row['amount_paise'])
            return row
        return store.run(save)

    core.app.include_router(router, prefix='/api')
    core.app.include_router(router)
