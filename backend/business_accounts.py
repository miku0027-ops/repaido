"""Private business/apartment workspaces, internal approvals and native statements.

Approval reserves an internal estimate. It never books work, approves native scope,
creates an invoice or collects money. A requester explicitly shares their own native
record with a workspace; that sharing survives staff departure for the audit record.
"""
import calendar
import csv
import hashlib
import io
import json
import re
import secrets
import time
import uuid
from datetime import date, datetime
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Response
from pydantic import Field, field_validator
from operations import Input, fail
from integrations import audit

IST = ZoneInfo('Asia/Kolkata')
ROLES = ('owner', 'manager', 'staff', 'viewer')
MANAGERS = ('owner', 'manager')
NATIVE = {'job': 'jobs', 'home_plan': 'home_plans', 'contract': 'contract_projects', 'retail': 'retail_orders'}
CATEGORY = {'job': 'repair', 'home_plan': 'home', 'contract': 'contract', 'retail': 'retail'}
LIMITS = {'members': 100, 'properties': 100, 'requests': 2000, 'maintenance': 2000, 'invitations': 500}


def digest(*parts):
    return hashlib.sha256(json.dumps(parts, separators=(',', ':')).encode()).hexdigest()


def today():
    return datetime.now(IST).date()


def valid_day(value):
    try:
        parsed = date.fromisoformat(value)
        if parsed.isoformat() != value:
            raise ValueError()
        return value
    except (ValueError, TypeError):
        raise ValueError('Use a calendar date in YYYY-MM-DD format.')


class WorkspaceInput(Input):
    @field_validator('*', mode='before')
    @classmethod
    def trim_text(cls, value):
        return value.strip() if isinstance(value, str) else value


class CreateAccount(WorkspaceInput):
    name: str = Field(min_length=2, max_length=120)
    kind: Literal['business', 'apartment']
    request_id: str = Field(min_length=16, max_length=100)

    @field_validator('name')
    @classmethod
    def name_not_blank(cls, value):
        value = value.strip()
        if len(value) < 2:
            raise ValueError('Enter the business or apartment name.')
        return value


class Invite(WorkspaceInput):
    role: Literal['manager', 'staff', 'viewer']


class AcceptInvite(WorkspaceInput):
    token: str = Field(min_length=30, max_length=160)


class MemberChange(Invite):
    expected_version: int = Field(ge=1)
    status: Literal['active', 'revoked']


class Property(WorkspaceInput):
    name: str = Field(min_length=2, max_length=120)
    address: str = Field(min_length=10, max_length=500)
    city: str = Field(min_length=2, max_length=80)
    monthly_budget_paise: int = Field(ge=0, le=50000000000, strict=True)

    @field_validator('name', 'address', 'city')
    @classmethod
    def text_required(cls, value):
        if not value.strip():
            raise ValueError('Enter property details.')
        return value.strip()


class PropertyChange(Property):
    expected_version: int = Field(ge=1)
    archived: bool = False


class RequestSpend(WorkspaceInput):
    request_id: str = Field(min_length=16, max_length=100)
    property_id: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=3, max_length=150)
    description: str = Field(min_length=10, max_length=2000)
    category: Literal['repair', 'home', 'contract', 'retail']
    estimated_paise: int = Field(gt=0, le=50000000000, strict=True)
    needed_on: str

    @field_validator('needed_on')
    @classmethod
    def date_check(cls, value):
        return valid_day(value)


class Decision(WorkspaceInput):
    expected_version: int = Field(ge=1)
    action: Literal['approve', 'reject', 'cancel']
    reason: str = Field(min_length=5, max_length=1000)


class Link(WorkspaceInput):
    expected_version: int = Field(ge=1)
    kind: Literal['job', 'home_plan', 'contract', 'retail']
    id: str = Field(min_length=1, max_length=128, pattern=r'^[A-Za-z0-9_-]+$')


class Maintenance(WorkspaceInput):
    property_id: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=3, max_length=150)
    due_on: str
    repeat_months: int = Field(default=0, ge=0, le=12, strict=True)
    assigned_to: str = Field(default='', max_length=128)

    @field_validator('due_on')
    @classmethod
    def date_check(cls, value):
        value = valid_day(value)
        if date.fromisoformat(value).year > today().year + 10:
            raise ValueError('Schedule maintenance within the next ten years.')
        return value


class Complete(WorkspaceInput):
    expected_version: int = Field(ge=1)
    note: str = Field(min_length=5, max_length=1000)


def lane(kind, aid):
    # Account IDs are generated hashes; never interpolate arbitrary path input.
    if not re.fullmatch(r'[a-f0-9]{64}', aid):
        fail('NOT_FOUND', 'Business account not found.', 404)
    return 'business_' + kind + '_' + aid


def access(u, aid, uid, roles=ROLES):
    account = u.get('business_accounts', aid)
    member = u.get(lane('members', aid), uid)
    if not account or not member or member['status'] != 'active':
        fail('NOT_FOUND', 'Business account not found for this member.', 404)
    if member['role'] not in roles:
        fail('ROLE_REQUIRED', 'Your workspace role does not allow this action.', 403)
    return account, member


def version(row, expected):
    if row['version'] != expected:
        fail('VERSION_CHANGED', 'This record changed. Refresh before continuing.')


def entity(u, kind, aid, key):
    row = u.get(lane(kind, aid), key)
    if not row:
        fail('NOT_FOUND', 'Workspace record not found.', 404)
    return row


def active_property(u, aid, pid):
    row = entity(u, 'properties', aid, pid)
    if row['archived']:
        fail('PROPERTY_ARCHIVED', 'Choose an active property.')
    return row


def capacity(u, kind, aid):
    if len(u.all(lane(kind, aid))) >= LIMITS[kind]:
        fail('WORKSPACE_LIMIT', 'This workspace has reached its supported record limit. Contact support.')


def save(u, kind, aid, row, uid, action):
    row['updated_at'] = time.time()
    u.put(lane(kind, aid), row['id'], row)
    audit(u, 'Business' + action, uid, account_id=aid, record_id=row['id'])
    return row


def membership_index(u, uid, aid, active):
    row = u.get('business_memberships', uid) or {'id': uid, 'account_ids': []}
    ids = set(row['account_ids'])
    if active:
        if aid not in ids and len(ids) >= 50:
            fail('MEMBERSHIP_LIMIT', 'This member has reached the supported account limit.')
        ids.add(aid)
    else:
        ids.discard(aid)
    row['account_ids'] = sorted(ids)
    u.put('business_memberships', uid, row)


def native_owner(kind, row):
    if kind == 'contract':
        # Awarded spend belongs to the customer, not the contractor receiving it.
        return row.get('client_id') or row.get('owner_id')
    return row.get('customer_id')


def native_amount(kind, row):
    if kind == 'home_plan':
        quote = row.get('quote') or {}
        if not quote:
            return None
        amount = quote['period_price_paise']
        return (amount + (amount * quote.get('gst_bps', 0) + 5000) // 10000) * len(row['periods'])
    if kind == 'contract':
        return row.get('contract_value_paise', row.get('budget_paise'))
    return row.get('total_paise')


def native_label(kind, row):
    return row.get('service_name') or row.get('title') or ('Home plan · ' + row.get('service_id', '') if kind == 'home_plan' else 'Shop order')


def owned_contracts(u, uid):
    """Use two scoped equality queries; never scan other customers' projects."""
    rows = {}
    for field in ('client_id', 'owner_id'):
        if u.tx is not None:
            result = u.core.fs_collection('ops_contract_projects').where(field, '==', uid).stream(transaction=u.tx)
            rows.update({s.id: s.to_dict() for s in result})
        else:
            result = u.conn.execute(f"SELECT id,body FROM operation_records WHERE kind='contract_projects' AND json_extract(body,'$.{field}')=?", (uid,))
            rows.update({r['id']: json.loads(r['body']) for r in result})
    rows.update({key: value for (kind, key), value in u.pending.items() if kind == 'contract_projects' and native_owner('contract', value) == uid})
    return [row for row in rows.values() if native_owner('contract', row) == uid]


def approved_months(requests, pid):
    months = {}
    for row in requests:
        if row['property_id'] == pid and row['status'] == 'approved':
            month = row['needed_on'][:7]
            months[month] = months.get(month, 0) + row['estimated_paise']
    return months


def job_collections(u, jid):
    """Only provider-confirmed collections; never infer paid amounts from job state."""
    if u.tx is not None:
        result = u.core.fs_collection('ops_payments').where('job_id', '==', jid).limit(501).stream(transaction=u.tx)
        rows = {s.id: s.to_dict() for s in result}
    else:
        result = u.conn.execute("SELECT id,body FROM operation_records WHERE kind='payments' AND json_extract(body,'$.job_id')=? LIMIT 501", (jid,))
        rows = {r['id']: json.loads(r['body']) for r in result}
    rows.update({key: value for (kind, key), value in u.pending.items() if kind == 'payments' and value.get('job_id') == jid})
    if len(rows) > 500:
        fail('PAYMENT_HISTORY_LIMIT', 'A linked booking exceeds the supported financial history size. Contact support before using its statement.')
    return [p for p in rows.values() if confirmed_collection(p)]


class ScopedInvoicePayments:
    """Canonical Home invoices can inspect only these already scoped collections."""
    def __init__(self, unit, payments):
        self.unit, self.payments = unit, payments

    def get(self, kind, key):
        return self.unit.get(kind, key)

    def all(self, kind):
        if kind != 'payments':
            raise ValueError('Unsupported invoice collection')
        return self.payments


def confirmed_collection(payment):
    return (payment.get('status') in ('captured', 'partially_refunded', 'refunded') and bool(payment.get('payment_id'))
            and type(payment.get('amount_paise')) is int and payment['amount_paise'] > 0
            and type(payment.get('amount_refunded', 0)) is int and 0 <= payment.get('amount_refunded', 0) <= payment['amount_paise'])


def collected(payment):
    return payment['amount_paise'] - payment.get('amount_refunded', 0)


def advance_receipt(payment):
    state = 'paid' if payment['status'] == 'captured' else payment['status']
    if not payment.get('allocated') and collected(payment):
        state = 'review'
    return dict(id='parts-' + payment['id'], amount_paise=payment['amount_paise'], paid_paise=collected(payment), refunded_paise=payment.get('amount_refunded', 0),
                status=state, issued_at=payment.get('created_at'), document_type='payment_receipt', source='native_parts_advance' if payment.get('allocated') else 'native_unallocated_parts_collection')


def statement(u, requests):
    rows = []
    estimates = 0
    unavailable = []
    for request in requests:
        if request['status'] not in ('pending', 'approved'):
            continue
        linked = request.get('record')
        if not linked:
            estimates += request['estimated_paise']
            continue
        kind, key = linked['kind'], linked['id']
        source = u.get(NATIVE[kind], key)
        if not source or native_owner(kind, source) != request['requested_by']:
            unavailable.append(request['id'])
            estimates += request['estimated_paise']
            continue
        items = []
        if kind == 'job':
            payments = job_collections(u, key)
            allocated = [p for p in payments if p.get('kind') != 'parts' or p.get('allocated')]
            inv = source.get('invoice')
            if inv:
                if not inv.get('id') or type(inv.get('total_paise')) is not int or inv['total_paise'] < 0:
                    unavailable.append(request['id'])
                else:
                    paid = sum(collected(p) for p in allocated)
                    refund = sum(p.get('amount_refunded', 0) for p in allocated)
                    state = 'paid' if paid >= inv['total_paise'] else 'issued' if inv.get('status') == 'payment_due' else 'review'
                    if refund:
                        state = 'partially_refunded' if paid else 'refunded'
                    if source.get('financial_hold') or source.get('parts_refund_hold'):
                        state = 'review'
                    items.append(dict(id=inv['id'], amount_paise=inv['total_paise'], paid_paise=paid, refunded_paise=refund,
                                      status=state, issued_at=source.get('completed_at'), document_type='service_statement', source='native_service_invoice_with_allocated_advances'))
            # A captured advance is a receipt before invoicing, then becomes part
            # of the invoice's paid total. Unallocated funds stay a review receipt.
            for payment in payments:
                if payment.get('kind') == 'parts' and (not inv or not payment.get('allocated')):
                    items.append(advance_receipt(payment))
        elif kind == 'home_plan':
            from home_plans import invoices
            visit_ids = {v.get('job_id') for v in source['visits'] if v.get('job_id')}
            advances = {jid: [p for p in job_collections(u, jid) if p.get('kind') == 'parts'] for jid in visit_ids}
            included = set()
            scoped = ScopedInvoicePayments(u, [p for payments in advances.values() for p in payments])
            for inv in invoices(scoped, source):
                if inv['status'] == 'accruing' or not inv['total_paise']:
                    continue
                payment = u.get('payments', 'home-' + inv['id']) or {}
                parts = [p for row in inv['rows'] for p in advances.get(row['job_id'], []) if p.get('allocated')]
                included.update(p['id'] for p in parts)
                # Native monthly checkout subtracts advances. Add their net back
                # to the scope amount, and count verified collections only once.
                amount = inv['total_paise'] + sum(collected(p) for p in parts)
                paid = (collected(payment) if confirmed_collection(payment) else 0) + sum(collected(p) for p in parts)
                refund = payment.get('amount_refunded', 0) + sum(p.get('amount_refunded', 0) for p in parts)
                state = {'captured': 'paid', 'ready': 'issued', 'created': 'issued', 'creating': 'issued', 'partially_refunded': 'partially_refunded', 'refunded': 'refunded'}.get(inv['status'], 'review')
                if any((u.get('jobs', row['job_id']) or {}).get('financial_hold') or (u.get('jobs', row['job_id']) or {}).get('parts_refund_hold') for row in inv['rows']):
                    state = 'review'
                if state == 'paid' and paid < amount:
                    state = 'review'
                items.append(dict(id=inv['id'], amount_paise=amount, paid_paise=paid,
                                  refunded_paise=refund, status=state, issued_at=payment.get('created_at'), period=inv['end'], document_type='service_statement', source='native_home_invoice'))
            for payments in advances.values():
                for payment in payments:
                    if payment['id'] not in included:
                        items.append(advance_receipt(payment))
        elif kind == 'contract':
            from contract_records import _rows
            for payment in _rows(u, 'contract_payments', key):
                # Pending approvals and claimed transfers are not invoices/receipts.
                if payment['status'] not in ('confirmed', 'partially_refunded', 'refunded'):
                    continue
                items.append(dict(id=payment['id'], amount_paise=payment['amount_paise'], paid_paise=payment.get('confirmed_amount_paise', 0),
                                  refunded_paise=payment.get('amount_refunded', 0), status='paid' if payment['status'] == 'confirmed' else payment['status'],
                                  issued_at=payment.get('confirmed_at'), document_type='payment_receipt', source=payment.get('source', 'native_contract_record')))
        elif kind == 'retail' and source.get('state') in ('paid', 'partially_refunded', 'refunded') and source.get('payment_id'):
            amount = source['total_paise']
            refund = source.get('amount_refunded', amount if source['state'] == 'refunded' else 0)
            valid_refund = type(refund) is int and 0 <= refund <= amount
            uncertain = not valid_refund or source.get('refunded_at') and not refund
            if uncertain:
                unavailable.append(request['id'])
            state = 'review' if uncertain or source.get('refund_pending') or source.get('financial_hold') else 'refunded' if refund == amount else 'partially_refunded' if refund else 'paid'
            items.append(dict(id=key, amount_paise=amount, paid_paise=max(0, amount - refund) if not uncertain else 0, refunded_paise=refund if valid_refund else 0,
                              status=state, issued_at=source.get('paid_at'),
                              document_type='payment_receipt', source='native_retail_payment'))
        invoiced = sum(item['amount_paise'] for item in items)
        estimates += max(0, request['estimated_paise'] - invoiced)
        for item in items:
            rows.append({**item, 'id': kind + ':' + item['id'], 'source_kind': kind, 'source_id': key, 'property_id': request['property_id'],
                         'request_id': request['id'], 'label': native_label(kind, source), 'approved_estimate_paise': request['estimated_paise'],
                         'exceeds_approval': invoiced > request['estimated_paise']})
    return dict(rows=rows, total_issued_paise=sum(r['amount_paise'] for r in rows), total_paid_paise=sum(r['paid_paise'] for r in rows),
                outstanding_paise=sum(max(0, r['amount_paise'] - r['paid_paise']) for r in rows if r['status'] == 'issued'),
                refunded_paise=sum(r.get('refunded_paise', 0) for r in rows), estimate_paise=estimates, unavailable_request_ids=unavailable,
                note='Consolidated native service statements and verified payment receipts, not a new tax invoice. Service statements include allocated parts advances once; unallocated collections remain under review. Estimates and pending transfers are excluded from issued and paid totals. Pay through the original booking or order. Internal approval does not book work or charge money; later native scope changes need separate review.')


def detail(u, aid, uid):
    account, member = access(u, aid, uid)
    members = u.all(lane('members', aid))
    requests = u.all(lane('requests', aid))
    properties = u.all(lane('properties', aid))
    maintenance = u.all(lane('maintenance', aid))
    for row in requests:
        row.pop('fingerprint', None)
        own = row['requested_by'] == uid
        row.update(can_decide=row['status'] == 'pending' and not own and member['role'] in MANAGERS,
                   can_cancel=own and row['status'] in ('pending', 'approved') and not row.get('record') and member['role'] != 'viewer',
                   can_link=own and row['status'] == 'approved' and not row.get('record') and member['role'] != 'viewer')
    for row in properties:
        row['approved_months'] = approved_months(requests, row['id'])
    for row in maintenance:
        row['can_complete'] = row['status'] == 'open' and (member['role'] in MANAGERS or member['role'] == 'staff' and row['assigned_to'] == uid)
        row['can_cancel'] = row['status'] == 'open' and member['role'] in MANAGERS
    invitations = []
    if member['role'] == 'owner':
        for row in u.all(lane('invitations', aid)):
            row.pop('token_hash', None)
            if row['status'] == 'pending' and row['expires_at'] <= time.time():
                row['status'] = 'expired'
            invitations.append(row)
    return dict(account={k: account[k] for k in ('id', 'name', 'kind', 'version')}, user_id=uid, role=member['role'], members=members,
                properties=properties, requests=sorted(requests, key=lambda r: r['created_at'], reverse=True),
                maintenance=sorted(maintenance, key=lambda r: (r['status'] != 'open', r['due_on'])), invitations=invitations,
                summary=dict(approved_estimate_paise=sum(r['estimated_paise'] for r in requests if r['status'] == 'approved'),
                             pending_estimate_paise=sum(r['estimated_paise'] for r in requests if r['status'] == 'pending')), statement=statement(u, requests))


def install(core):
    router = APIRouter(prefix='/operations/business-accounts', tags=['Business accounts'])
    store = core.operations_store

    @router.get('')
    def accounts(user=Depends(core.current_user)):
        def read(u):
            ids = (u.get('business_memberships', user['id']) or {}).get('account_ids', [])
            u.prefetch([('business_accounts', aid) for aid in ids] + [(lane('members', aid), user['id']) for aid in ids])
            rows = []
            for aid in ids:
                account = u.get('business_accounts', aid)
                member = u.get(lane('members', aid), user['id'])
                if account and member and member['status'] == 'active':
                    rows.append({k: account[k] for k in ('id', 'name', 'kind')} | {'role': member['role']})
            return {'accounts': rows}
        return store.run(read)

    @router.post('', status_code=201)
    def create(body: CreateAccount, user=Depends(core.current_user)):
        aid = digest(user['id'], body.request_id)
        fingerprint = digest(body.model_dump_json())
        def write(u):
            old = u.get('business_accounts', aid)
            if old:
                if old['fingerprint'] != fingerprint:
                    fail('KEY_REUSED', 'Use a new request for changed account details.')
                return detail(u, aid, user['id'])
            membership_index(u, user['id'], aid, True)
            u.put('business_accounts', aid, dict(id=aid, name=body.name, kind=body.kind, owner_id=user['id'], version=1, created_at=time.time(), fingerprint=fingerprint))
            save(u, 'members', aid, dict(id=user['id'], user_id=user['id'], name=user['name'], role='owner', status='active', version=1), user['id'], 'AccountCreated')
            return detail(u, aid, user['id'])
        return store.run(write)

    @router.post('/invitations/accept')
    def accept(body: AcceptInvite, user=Depends(core.current_user)):
        def write(u):
            token_hash = digest(body.token)
            token = u.get('business_invite_tokens', token_hash)
            if not token:
                fail('INVITATION_UNAVAILABLE', 'This invitation is invalid, expired or revoked.', 404)
            aid = token['account_id']
            inv = entity(u, 'invitations', aid, token['invitation_id'])
            if inv['status'] == 'accepted' and inv.get('accepted_by') == user['id']:
                return detail(u, aid, user['id'])
            if inv['status'] != 'pending' or inv['expires_at'] <= time.time():
                fail('INVITATION_UNAVAILABLE', 'This invitation is invalid, expired or revoked.', 404)
            old = u.get(lane('members', aid), user['id'])
            if old and old['status'] == 'active':
                fail('ALREADY_MEMBER', 'You already belong to this workspace. Its owner can change your role.')
            if not old:
                capacity(u, 'members', aid)
            membership_index(u, user['id'], aid, True)
            save(u, 'members', aid, dict(id=user['id'], user_id=user['id'], name=user['name'], role=inv['role'], status='active', version=(old or {}).get('version', 0) + 1), user['id'], 'MemberJoined')
            inv.update(status='accepted', accepted_by=user['id'], accepted_at=time.time())
            save(u, 'invitations', aid, inv, user['id'], 'InvitationAccepted')
            return detail(u, aid, user['id'])
        return store.run(write)

    @router.get('/{aid}')
    def get_account(aid: str, user=Depends(core.current_user)):
        return store.run(lambda u: detail(u, aid, user['id']))

    @router.post('/{aid}/invitations', status_code=201)
    def invite(aid: str, body: Invite, user=Depends(core.current_user)):
        token, iid = secrets.token_urlsafe(32), uuid.uuid4().hex
        def write(u):
            access(u, aid, user['id'], ('owner',))
            capacity(u, 'invitations', aid)
            row = dict(id=iid, role=body.role, status='pending', created_by=user['id'], created_at=time.time(), expires_at=time.time() + 72 * 3600, token_hash=digest(token))
            save(u, 'invitations', aid, row, user['id'], 'InvitationCreated')
            u.put('business_invite_tokens', row['token_hash'], dict(account_id=aid, invitation_id=iid))
            return {'id': iid, 'token': token, 'expires_at': row['expires_at']}
        return store.run(write)

    @router.post('/{aid}/invitations/{iid}/revoke')
    def revoke(aid: str, iid: str, user=Depends(core.current_user)):
        def write(u):
            access(u, aid, user['id'], ('owner',))
            inv = entity(u, 'invitations', aid, iid)
            if inv['status'] == 'accepted':
                fail('INVITATION_USED', 'This invitation was accepted. Revoke the member to remove access.')
            inv.update(status='revoked', revoked_at=time.time())
            save(u, 'invitations', aid, inv, user['id'], 'InvitationRevoked')
            return {'id': iid, 'status': 'revoked'}
        return store.run(write)

    @router.put('/{aid}/members/{uid}')
    def change_member(aid: str, uid: str, body: MemberChange, user=Depends(core.current_user)):
        def write(u):
            account, _ = access(u, aid, user['id'], ('owner',))
            member = entity(u, 'members', aid, uid)
            version(member, body.expected_version)
            if account['owner_id'] == uid or member['role'] == 'owner':
                fail('OWNER_PROTECTED', 'The workspace owner cannot be removed or demoted.')
            membership_index(u, uid, aid, body.status == 'active')
            member.update(role=body.role, status=body.status, version=member['version'] + 1)
            return save(u, 'members', aid, member, user['id'], 'MemberChanged')
        return store.run(write)

    @router.post('/{aid}/properties', status_code=201)
    def add_property(aid: str, body: Property, user=Depends(core.current_user)):
        def write(u):
            access(u, aid, user['id'], MANAGERS)
            capacity(u, 'properties', aid)
            return save(u, 'properties', aid, dict(**body.model_dump(), id=uuid.uuid4().hex, archived=False, version=1, created_at=time.time()), user['id'], 'PropertyCreated')
        return store.run(write)

    @router.put('/{aid}/properties/{pid}')
    def edit_property(aid: str, pid: str, body: PropertyChange, user=Depends(core.current_user)):
        def write(u):
            access(u, aid, user['id'], MANAGERS)
            row = entity(u, 'properties', aid, pid)
            version(row, body.expected_version)
            requests = u.all(lane('requests', aid))
            months = approved_months(requests, pid)
            if any(amount > body.monthly_budget_paise for month, amount in months.items() if month >= today().isoformat()[:7]):
                fail('BUDGET_COMMITTED', 'The new budget is below approved requests in a current or future month.')
            if body.archived and (any(r['property_id'] == pid and r['status'] == 'pending' for r in requests) or any(r['property_id'] == pid and r['status'] == 'open' for r in u.all(lane('maintenance', aid)))):
                fail('PROPERTY_HAS_OPEN_WORK', 'Resolve pending requests and open maintenance before archiving.')
            row.update(**body.model_dump(exclude={'expected_version'}), version=row['version'] + 1)
            return save(u, 'properties', aid, row, user['id'], 'PropertyChanged')
        return store.run(write)

    @router.post('/{aid}/requests', status_code=201)
    def request_spend(aid: str, body: RequestSpend, user=Depends(core.current_user)):
        rid, fingerprint = digest(aid, user['id'], body.request_id), digest(body.model_dump_json())
        def write(u):
            access(u, aid, user['id'], ('owner', 'manager', 'staff'))
            old = u.get(lane('requests', aid), rid)
            if old:
                if old['fingerprint'] != fingerprint:
                    fail('KEY_REUSED', 'Use a new request for changed approval details.')
                return {k: v for k, v in old.items() if k != 'fingerprint'}
            active_property(u, aid, body.property_id)
            if body.needed_on < today().isoformat():
                fail('PAST_APPROVAL', 'Request approval for today or a future date.', 422)
            capacity(u, 'requests', aid)
            row = dict(**body.model_dump(exclude={'request_id'}), id=rid, fingerprint=fingerprint, requested_by=user['id'], requested_name=user['name'], status='pending', version=1, created_at=time.time())
            save(u, 'requests', aid, row, user['id'], 'SpendRequested')
            return {k: v for k, v in row.items() if k != 'fingerprint'}
        return store.run(write)

    @router.post('/{aid}/requests/{rid}/decision')
    def decide(aid: str, rid: str, body: Decision, user=Depends(core.current_user)):
        def write(u):
            _, member = access(u, aid, user['id'], ('owner', 'manager', 'staff'))
            row = entity(u, 'requests', aid, rid)
            version(row, body.expected_version)
            if body.action == 'cancel':
                if row['requested_by'] != user['id']:
                    fail('REQUESTER_REQUIRED', 'Only the requester can cancel this approval.', 403)
                if row['status'] not in ('pending', 'approved') or row.get('record'):
                    fail('CANNOT_CANCEL', 'Only an unlinked pending or approved request can be cancelled. Manage linked work in its original record.')
                row['status'] = 'cancelled'
            else:
                if member['role'] not in MANAGERS or row['requested_by'] == user['id']:
                    fail('INDEPENDENT_APPROVER_REQUIRED', 'Another owner or manager must review this request.', 403)
                if row['status'] != 'pending':
                    fail('ALREADY_DECIDED', 'Only pending requests can be decided.')
                if body.action == 'approve':
                    prop = active_property(u, aid, row['property_id'])
                    amount = approved_months(u.all(lane('requests', aid)), prop['id']).get(row['needed_on'][:7], 0)
                    if amount + row['estimated_paise'] > prop['monthly_budget_paise']:
                        fail('MONTHLY_BUDGET_EXCEEDED', 'Approved estimates would exceed this property’s monthly budget. Review its budget or reject the request.')
                row['status'] = 'approved' if body.action == 'approve' else 'rejected'
            row.update(decision_reason=body.reason, decided_by=user['id'], decided_at=time.time(), version=row['version'] + 1)
            save(u, 'requests', aid, row, user['id'], 'Spend' + body.action.title())
            return {k: v for k, v in row.items() if k != 'fingerprint'}
        return store.run(write)

    @router.get('/{aid}/linkable')
    def linkable(aid: str, user=Depends(core.current_user)):
        def read(u):
            access(u, aid, user['id'], ('owner', 'manager', 'staff'))
            records = []
            for kind, collection in NATIVE.items():
                if kind == 'contract':
                    native = owned_contracts(u, user['id'])
                else:
                    native = u.find(collection, 'customer_id', user['id'])
                for row in native:
                    if row.get('home_plan_id') or u.get('business_record_links', digest(kind, row['id'])):
                        continue
                    records.append(dict(kind=kind, id=row['id'], label=native_label(kind, row), status=row.get('state', row.get('status', 'unknown')), amount_paise=native_amount(kind, row)))
            return {'records': records}
        return store.run(read)

    @router.post('/{aid}/requests/{rid}/link')
    def link(aid: str, rid: str, body: Link, user=Depends(core.current_user)):
        def write(u):
            access(u, aid, user['id'], ('owner', 'manager', 'staff'))
            row = entity(u, 'requests', aid, rid)
            version(row, body.expected_version)
            if row['requested_by'] != user['id']:
                fail('REQUESTER_REQUIRED', 'Only the requester can share their own booking or order.', 403)
            if row['status'] != 'approved' or row.get('record'):
                fail('APPROVAL_REQUIRED', 'Choose an approved request without a linked record.')
            if CATEGORY[body.kind] != row['category']:
                fail('WRONG_RECORD_KIND', 'Choose a record matching the approved spending category.', 422)
            source = u.get(NATIVE[body.kind], body.id)
            if not source or native_owner(body.kind, source) != user['id']:
                fail('NOT_FOUND', 'Native record not found for this requester.', 404)
            if source.get('home_plan_id'):
                fail('LINK_HOME_PLAN', 'Link the whole Home plan to a Home approval. Individual visits cannot be counted twice.')
            amount = native_amount(body.kind, source)
            if amount is None or amount <= 0:
                fail('QUOTE_REQUIRED', 'Obtain a native quote or agreed amount before linking.')
            if amount > row['estimated_paise']:
                fail('APPROVED_AMOUNT_EXCEEDED', 'The native amount exceeds this approval. Request approval for the revised total before linking.')
            key = digest(body.kind, body.id)
            if u.get('business_record_links', key):
                fail('RECORD_ALREADY_LINKED', 'This record already belongs to a business approval.')
            u.put('business_record_links', key, dict(id=key, account_id=aid, request_id=rid, kind=body.kind, native_id=body.id, shared_by=user['id']))
            row.update(record=dict(kind=body.kind, id=body.id, shared_at=time.time(), amount_at_link_paise=amount), version=row['version'] + 1)
            save(u, 'requests', aid, row, user['id'], 'NativeRecordShared')
            return {k: v for k, v in row.items() if k != 'fingerprint'}
        return store.run(write)

    @router.post('/{aid}/maintenance', status_code=201)
    def maintenance(aid: str, body: Maintenance, user=Depends(core.current_user)):
        def write(u):
            access(u, aid, user['id'], MANAGERS)
            active_property(u, aid, body.property_id)
            if body.assigned_to:
                assigned = entity(u, 'members', aid, body.assigned_to)
                if assigned['status'] != 'active' or assigned['role'] == 'viewer':
                    fail('ASSIGNEE_UNAVAILABLE', 'Assign an active staff member or manager.', 422)
            capacity(u, 'maintenance', aid)
            row = dict(**body.model_dump(), id=uuid.uuid4().hex, status='open', version=1, created_at=time.time())
            return save(u, 'maintenance', aid, row, user['id'], 'MaintenancePlanned')
        return store.run(write)

    @router.post('/{aid}/maintenance/{mid}/complete')
    def complete(aid: str, mid: str, body: Complete, user=Depends(core.current_user)):
        def write(u):
            _, member = access(u, aid, user['id'], ('owner', 'manager', 'staff'))
            row = entity(u, 'maintenance', aid, mid)
            version(row, body.expected_version)
            if member['role'] not in MANAGERS and row['assigned_to'] != user['id']:
                fail('ASSIGNEE_REQUIRED', 'Only the assignee or a manager can complete this reminder.', 403)
            if row['status'] != 'open':
                fail('ALREADY_COMPLETED', 'This maintenance reminder is already completed.')
            row.update(status='completed', completed_by=user['id'], completed_at=time.time(), completion_note=body.note, version=row['version'] + 1)
            if row['repeat_months']:
                capacity(u, 'maintenance', aid)
                first = date.fromisoformat(row['due_on'])
                # Preserve the series' original day (Jan 31 -> Feb 28 -> Mar 31).
                anchor = row.get('anchor_day', first.day)
                year, month = divmod(first.year * 12 + first.month - 1 + row['repeat_months'], 12)
                if year > 9999:
                    fail('RECURRENCE_LIMIT', 'This recurring series has reached the calendar limit. Cancel the reminder to close the series.')
                due = date(year, month + 1, min(anchor, calendar.monthrange(year, month + 1)[1]))
                next_id = digest(mid, 'next')
                nxt = dict(id=next_id, property_id=row['property_id'], title=row['title'], due_on=due.isoformat(), repeat_months=row['repeat_months'],
                           assigned_to=row['assigned_to'], anchor_day=anchor, previous_id=mid, status='open', version=1, created_at=time.time())
                save(u, 'maintenance', aid, nxt, user['id'], 'MaintenanceRepeated')
                row['next_id'] = next_id
            return save(u, 'maintenance', aid, row, user['id'], 'MaintenanceCompleted')
        return store.run(write)

    @router.post('/{aid}/maintenance/{mid}/cancel')
    def cancel_maintenance(aid: str, mid: str, body: Complete, user=Depends(core.current_user)):
        def write(u):
            access(u, aid, user['id'], MANAGERS)
            row = entity(u, 'maintenance', aid, mid)
            version(row, body.expected_version)
            if row['status'] != 'open':
                fail('REMINDER_CLOSED', 'Only an open maintenance reminder can be cancelled.')
            row.update(status='cancelled', cancelled_by=user['id'], cancelled_at=time.time(), cancellation_note=body.note, version=row['version'] + 1)
            return save(u, 'maintenance', aid, row, user['id'], 'MaintenanceCancelled')
        return store.run(write)

    @router.get('/{aid}/statement.csv')
    def export_statement(aid: str, user=Depends(core.current_user)):
        data = store.run(lambda u: detail(u, aid, user['id']))
        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow(['Document', 'Source type', 'Source ID', 'Property ID', 'Description', 'Status', 'Amount INR', 'Confirmed net paid INR', 'Record type'])
        for row in data['statement']['rows']:
            values = [row['id'], row['source_kind'], row['source_id'], row['property_id'], row['label'], row['status'], f"{row['amount_paise'] / 100:.2f}", f"{row['paid_paise'] / 100:.2f}", row['document_type']]
            # Spreadsheet formulas are not an allowed representation of user text.
            writer.writerow(["'" + str(value) if str(value).lstrip().startswith(('=', '+', '-', '@')) else value for value in values])
        return Response(out.getvalue(), media_type='text/csv', headers={'Content-Disposition': 'attachment; filename="business-statement.csv"', 'Cache-Control': 'private, no-store'})

    core.app.include_router(router)
