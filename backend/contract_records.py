"""Private awarded-contract progress, payment reservations and auditable reports.

The agreed price comes only from the canonical awarded tender/project. Gateway
capture proves platform collection; external transfers require operator review.
Neither path invents a contractor payout or accepts a browser payment claim.
"""
import hashlib
import copy
import io
import json
import os
import re
import time
from datetime import datetime
from html import escape
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import Field

from integrations import audit, configured, razorpay
from operations import Input, fail
from rentals import payments_ready

# Project-scoped bounds accommodate several years of daily progress. Media
# preview work remains capped independently at ten images per report.
LIMIT = 5000
MAX_ATTACHMENTS = 20000
REPORT_DOCUMENT_BYTES = 600 * 1024
REPORT_CHUNK_BYTES = 100 * 1024
REPORT_TRANSACTION_BYTES = 6 * 1024 * 1024
REPORT_SECTIONS = ('progress', 'payments', 'purchases', 'team', 'milestones', 'attendance', 'timeline')
PENDING = {'requested', 'approved', 'gateway_creating', 'gateway_pending', 'reported_pending'}
IST = ZoneInfo('Asia/Kolkata')


class Change(Input):
    request_id: str = Field(min_length=16, max_length=100)
    expected_version: int = Field(ge=1, strict=True)


class PaymentRequest(Change):
    amount_paise: int = Field(gt=0, le=50000000000, strict=True)
    method: Literal['gateway', 'neft', 'rtgs']
    note: str = Field(default='', max_length=1000)
    milestone_id: str | None = Field(default=None, max_length=100)


class Approval(Change):
    approved: bool = Field(strict=True)
    note: str = Field(default='', max_length=1000)


class ReportedTransfer(Change):
    reference: str = Field(min_length=6, max_length=100)
    evidence_ids: list[str] = Field(min_length=1, max_length=5)
    note: str = Field(default='', max_length=1000)


class Progress(Change):
    percent: int = Field(ge=0, le=100, strict=True)
    note: str = Field(min_length=10, max_length=2000)
    evidence_ids: list[str] = Field(default_factory=list, max_length=5)
    milestone_id: str | None = Field(default=None, max_length=100)
    public_share_consent: bool = Field(default=False, strict=True)


class PublicProgressConsent(Change):
    enabled: bool = Field(strict=True)


class ProgressReview(Change):
    approved: bool = Field(strict=True)
    note: str = Field(default='', max_length=1000)


class Purchase(Change):
    title: str = Field(min_length=3, max_length=150)
    vendor: str = Field(default='', max_length=150)
    amount_paise: int = Field(gt=0, le=50000000000, strict=True)
    purchased_at: int = Field(ge=946684800, strict=True)
    receipt_reference: str = Field(min_length=3, max_length=150)
    note: str = Field(default='', max_length=1000)
    evidence_ids: list[str] = Field(default_factory=list, max_length=5)


class PaymentCheck(Input):
    payment_id: str = Field(pattern=r'^pay_[A-Za-z0-9]+$')


class TransferReview(Input):
    approved: bool = Field(strict=True)
    reason: str = Field(min_length=20, max_length=1000)
    verified_reference: str = Field(min_length=6, max_length=100)
    evidence_reference: str = Field(min_length=8, max_length=200)


def initialize(core):
    if core.USE_FIRESTORE:
        return
    with core.db() as conn:
        for kind in ('contract_payments', 'contract_progress', 'contract_purchases'):
            conn.execute(f"CREATE INDEX IF NOT EXISTS idx_{kind}_project ON operation_records(json_extract(body,'$.project_id'),id) WHERE kind='{kind}'")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_contract_records_contractor ON operation_records(json_extract(body,'$.contractor_id'),id) WHERE kind='contract_project_records'")


def _id(*values):
    return hashlib.sha256(':'.join(values).encode()).hexdigest()


def _award(u, pid):
    p = u.get('contract_projects', pid)
    if not p:
        fail('NOT_FOUND', 'Contract project not found.', 404)
    t = u.get('contract_tenders', p.get('tender_id', '')) if p.get('tender_id') else None
    bid = next((b for b in (t or {}).get('bids', []) if b.get('id') == (t or {}).get('winning_bid_id')), None)
    amount = p.get('contract_value_paise')
    if (not p.get('awarded_at') or not t or t.get('status') != 'awarded'
            or t.get('winning_project_id') != pid or not bid or bid.get('status') != 'awarded'
            or bid.get('project_id') != pid or bid.get('contractor_id') != p.get('owner_id')
            or t.get('owner_id') != p.get('client_id') or bid.get('amount_paise') != amount
            or (t.get('source_kind') == 'customer_custom_query' and t.get('awarded_contractor_id') != p.get('owner_id'))
            or type(amount) is not int or amount <= 0 or p.get('client_id') == p.get('owner_id')):
        fail('AWARD_REQUIRED', 'A confirmed customer award and agreed deal price are required.', 409)
    return p, t


def _access(u, pid, user, write=False):
    p, t = _award(u, pid)
    uid = user['id']
    if uid not in (p['client_id'], p['owner_id']):
        fail('NOT_FOUND', 'Contract project not found.', 404)
    if not user.get('phone_verified'):
        fail('PHONE_REQUIRED', 'Verify your mobile number to use private contract records.', 403)
    if write:
        if p.get('status') == 'cancelled':
            fail('CONTRACT_CLOSED', 'This cancelled contract accepts no new records.', 409)
        worker = u.get('workers', p['owner_id']) or {}
        if worker.get('status') != 'approved' or not worker.get('contractor_verified'):
            fail('CONTRACTOR_UNAVAILABLE', 'The awarded contractor needs approval review before new records.', 403)
        if any((u.get('network_suspensions', actor) or {}).get('active') for actor in (p['owner_id'], p['client_id'])):
            fail('CONTRACT_UNAVAILABLE', 'Contract access needs support review.', 403)
        if uid == p['owner_id']:
            from repaidians_billing import subscription
            if not subscription(u, uid)['active']:
                fail('MEMBERSHIP_REQUIRED', 'An active Repaidians membership is required for new contractor records.', 402)
    return p, t


def _ledger(u, p):
    row = u.get('contract_project_records', p['id'])
    if row:
        if row['agreed_deal_paise'] != p['contract_value_paise'] or row['customer_id'] != p['client_id'] or row['contractor_id'] != p['owner_id']:
            fail('DEAL_CHANGED', 'The agreed contract record needs operator reconciliation.', 409)
        return row
    return dict(id=p['id'], project_id=p['id'], customer_id=p['client_id'], contractor_id=p['owner_id'],
                agreed_deal_paise=p['contract_value_paise'], confirmed_paid_paise=0,
                pending_reserved_paise=0, gateway_collected_paise=0, contractor_received_paise=0,
                payment_count=0, progress_count=0, attachment_count=0, public_progress_enabled=False, version=1)


def _rows(u, kind, pid):
    if u.tx is not None:
        from google.cloud.firestore_v1.field_path import FieldPath
        query = u.core.fs_collection('ops_' + kind).where('project_id', '==', pid).order_by(FieldPath.document_id()).limit(LIMIT + 1)
        rows = {s.id: s.to_dict() for s in query.stream(transaction=u.tx)}
    else:
        rows = {r['id']: json.loads(r['body']) for r in u.conn.execute(
            "SELECT id,body FROM operation_records WHERE kind=? AND json_extract(body,'$.project_id')=? ORDER BY id LIMIT ?", (kind, pid, LIMIT + 1))}
    rows.update({key: value for (k, key), value in u.pending.items() if k == kind and value.get('project_id') == pid})
    if len(rows) > LIMIT:
        fail('RECORD_REVIEW_REQUIRED', 'This contract history exceeds the supported report size. Contact support.', 409)
    u.fetched.update({(kind, key): value for key, value in rows.items()})
    return sorted(rows.values(), key=lambda x: (x['created_at'], x['id']))


def _version(ledger, expected):
    if ledger['version'] != expected:
        fail('STALE_VERSION', 'The contract records changed. Refresh and retry.', 409)


def _replay(u, pid, uid, action, body):
    key = _id(pid, uid, body.request_id)
    fingerprint = _id(action, body.model_dump_json())
    old = u.get('contract_record_commands', key)
    if old and old['fingerprint'] != fingerprint:
        fail('REQUEST_REUSED', 'Use a new request for changed contract details.', 409)
    return key, fingerprint, old


def _remember(u, key, fingerprint, record_id):
    u.put('contract_record_commands', key, dict(id=key, fingerprint=fingerprint, record_id=record_id))


def _save(u, ledger, action, actor, **fields):
    ledger['version'] += 1
    ledger['updated_at'] = time.time()
    if ledger['confirmed_paid_paise'] + ledger['pending_reserved_paise'] > ledger['agreed_deal_paise']:
        fail('DEAL_CEILING', 'Verified payments and pending requests cannot exceed the agreed deal price.', 409)
    u.put('contract_project_records', ledger['id'], ledger)
    audit(u, action, actor, project_id=ledger['id'], **fields)
    project=u.get('contract_projects',ledger['id'])
    if project and project.get('client_id') and project.get('owner_id'):
        from transactional_mail import enqueue
        kinds={'ContractProgressReported':'contract_progress','ContractProgressReviewed':'contract_progress_reviewed',
               'ContractPaymentRequested':'contract_payment_requested','ContractPaymentRequestDecided':'contract_payment_decided',
               'ContractExternalTransferReported':'contract_transfer_reported','ContractExternalTransferReviewed':'contract_transfer_reviewed',
               'ContractPurchaseReported':'contract_purchase_reported','ContractPurchaseReviewed':'contract_purchase_reviewed'}
        if action in kinds:
            enqueue(u,'contract-record:'+ledger['id']+':'+str(ledger['version']),kinds[action],[project['client_id'],project['owner_id']],
                    {'record_type':'contract_project','record_id':ledger['id'],'path':'/?view=contracts&project_id='+ledger['id']})


def _public_consent(tender, ledger):
    """The awarded query owner's saved control is the consent authority."""
    controls = tender.get('controls', {})
    if 'public_progress' in controls:
        return controls['public_progress'] is True
    # Existing awarded tenders without query controls retain their explicit choice.
    return ledger.get('public_progress_enabled') is True


def set_public_consent(u, project, uid, enabled):
    """Atomically share/revoke query and record progress for the customer owner.

    Called after canonical award or a custom-query command has saved its tender.
    The caller's transaction supplies authentication and optimistic concurrency;
    this helper independently proves the award and owner and never moves money.
    """
    p, tender = _award(u, project['id'])
    if uid != p['client_id']:
        fail('CUSTOMER_REQUIRED', 'Only the customer owner chooses public contract progress.', 403)
    if type(enabled) is not bool:
        fail('CONSENT_REQUIRED', 'Choose whether to publish contract progress.', 422)
    existing = u.get('contract_project_records', p['id'])
    ledger = _ledger(u, p)
    controls = dict(tender.get('controls', {}))
    canonical_changed = controls.get('public_progress') is not enabled
    if canonical_changed:
        controls['public_progress'] = enabled
        tender['controls'] = controls
        tender['version'] = tender.get('version', 1) + 1
        tender['events'] = [*tender.get('events', []), dict(action='public_progress', actor=uid, at=time.time())][-64:]
        u.put('contract_tenders', tender['id'], tender)
    if existing is not None and ledger.get('public_progress_enabled') is enabled and not canonical_changed:
        return ledger
    ledger.update(public_progress_enabled=enabled, public_progress_decided_by=uid, public_progress_decided_at=time.time())
    _save(u, ledger, 'ContractPublicProgressConsentChanged', uid, enabled=enabled)
    return ledger


def _evidence(u, p, ids, uid, purpose):
    if len(set(ids)) != len(ids):
        fail('DUPLICATE_EVIDENCE', 'Choose each evidence attachment once.', 422)
    rows = []
    for eid in ids:
        row = u.get('contract_attachments', eid)
        if not row or row.get('project_id') != p['id'] or row.get('uploaded_by') != uid or row.get('purpose') != purpose or row.get('status') != 'ready':
            fail('EVIDENCE_REQUIRED', 'Use your saved private evidence from this contract.', 422)
        rows.append(dict(id=eid, url=f'/api/operations/contracts/attachments/{eid}', purpose=purpose,
                         kind=row.get('kind', 'image'), mime=row['mime'], source='member_uploaded'))
    return rows


def _milestone(p, mid):
    if mid and not any(g.get('id') == mid for g in p.get('goals', [])):
        fail('MILESTONE_NOT_FOUND', 'Choose a recorded milestone from this contract.', 422)


def _methods(u, p):
    bank = u.get('verification', p['owner_id']) or {}
    bank_ready = bank.get('bank_status') == 'verified' and bool(bank.get('fund_account_id')) and configured('RAZORPAYX_KEY_ID', 'RAZORPAYX_KEY_SECRET')
    guidance = 'Your bank determines transfer limits, operating windows and settlement time. Use only the verified instructions shown for this contract.'
    return dict(gateway=dict(available=payments_ready(), reason='Configured gateway; available Netbanking banks and methods are shown by the provider at checkout.' if payments_ready() else 'Online contract payments are not connected.', source='platform_collection', contractor_payout_connected=False),
                neft=dict(available=bool(bank_ready), reason=guidance if bank_ready else 'Verified contractor bank instructions are not connected.'),
                rtgs=dict(available=bool(bank_ready), reason=guidance if bank_ready else 'Verified contractor bank instructions are not connected.'))


def _financials(ledger):
    return dict(currency='INR', **{k: ledger[k] for k in ('agreed_deal_paise', 'confirmed_paid_paise', 'pending_reserved_paise', 'gateway_collected_paise', 'contractor_received_paise')},
                balance_paise=ledger['agreed_deal_paise'] - ledger['confirmed_paid_paise'],
                available_to_request_paise=ledger['agreed_deal_paise'] - ledger['confirmed_paid_paise'] - ledger['pending_reserved_paise'],
                source='Verified gateway collections and operator-verified external transfer references; pending reports are excluded.')


def _payment_public(row, customer, methods):
    out = {k: row.get(k) for k in ('id', 'project_id', 'amount_paise', 'method', 'status', 'note', 'milestone_id', 'created_at', 'approved_at', 'reported_at', 'confirmed_at', 'reference', 'payment_id', 'source', 'amount_refunded', 'report_id', 'evidence')}
    out['actions'] = dict(can_approve=customer and row['status'] == 'requested',
                          can_pay=customer and row['method'] == 'gateway' and row['status'] in ('approved', 'gateway_creating', 'gateway_pending') and methods['gateway']['available'],
                          can_check=customer and row['method'] == 'gateway' and row['status'] in ('gateway_pending', 'confirmed', 'partially_refunded'),
                          can_report=customer and row['method'] in ('neft', 'rtgs') and row['status'] == 'approved')
    return out


def records(u, p, user):
    from contract_work import accepted_team
    ledger = _ledger(u, p)
    _, tender = _award(u, p['id'])
    customer = user['id'] == p['client_id']
    contractor = user['id'] == p['owner_id']
    methods = _methods(u, p)
    worker = u.get('workers', p['owner_id']) or {}
    writable = p.get('status') != 'cancelled' and worker.get('status') == 'approved' and bool(worker.get('contractor_verified'))
    suspended = any((u.get('network_suspensions', actor) or {}).get('active') for actor in (p['owner_id'], p['client_id']))
    if suspended:
        writable = False
    if contractor and writable:
        from repaidians_billing import subscription
        writable = bool(subscription(u, user['id'])['active'])
    payments = [_payment_public(row, customer and writable, methods) for row in _rows(u, 'contract_payments', p['id'])]
    progress = _rows(u, 'contract_progress', p['id'])
    for row in progress:
        row['actions'] = dict(can_review=customer and writable and row['status'] == 'reported')
    purchases = _rows(u, 'contract_purchases', p['id'])
    for row in purchases:
        row['actions'] = dict(can_review=customer and writable and row['status'] == 'reported')
    return dict(project={k: p.get(k) for k in ('id', 'title', 'scope', 'site', 'status', 'starts_at', 'ends_at', 'awarded_at')}
                | dict(customer_id=p['client_id'], contractor_id=p['owner_id'], agreed_deal_paise=p['contract_value_paise']),
                version=ledger['version'], financials=_financials(ledger), payments=payments, progress=progress,
                milestones=p.get('goals', []), payment_methods=methods, purchases=purchases,
                attendance=[{k: a.get(k) for k in ('worker_id', 'in_at', 'out_at', 'source')} for a in p.get('attendance', [])][-500:],
                timeline=[{k: e.get(k) for k in ('action', 'note', 'at', 'actor', 'event_type', 'occurred_at_server_time')} for e in p.get('events', [])][-200:],
                team=[{k: m.get(k) for k in ('worker_id', 'name', 'role', 'status')}
                      | dict(accepted_at=m.get('accepted_at') or m.get('responded_at')) for m in accepted_team(p)],
                team_count=len(accepted_team(p)),
                public_progress=dict(enabled=_public_consent(tender, ledger), source='customer_owner_consent',
                                     url=f'/api/operations/contracts/public/projects/{p["id"]}/progress'),
                actions=dict(can_request=writable, can_approve=customer and writable, can_pay=customer and writable and methods['gateway']['available'],
                             can_report=customer and writable, can_progress=contractor and writable, can_record_purchase=contractor and writable, can_read_report=True, can_manage_public_progress=customer and writable),
                report_url=f'/api/operations/contracts/projects/{p["id"]}/report.pdf', server_time=time.time())


def _snapshot(u, p, ledger, payment_id=None):
    from contract_work import accepted_team
    progress = _rows(u, 'contract_progress', p['id'])
    payments = _rows(u, 'contract_payments', p['id'])
    team = [{k: m.get(k) for k in ('worker_id', 'name', 'role', 'status', 'invited_at')}
            | dict(accepted_at=m.get('accepted_at') or m.get('responded_at')) for m in accepted_team(p)]
    return dict(project={k: p.get(k) for k in ('id', 'title', 'scope', 'site', 'status', 'starts_at', 'ends_at', 'awarded_at', 'contract_value_paise')},
                customer_id=p['client_id'], contractor_id=p['owner_id'], team=team, milestones=p.get('goals', []),
                progress=[{k: v for k, v in row.items() if k != 'actions'} for row in progress],
                purchases=[{k: v for k, v in row.items() if k != 'actions'} for row in _rows(u, 'contract_purchases', p['id'])],
                payments=[{k: row.get(k) for k in ('id', 'amount_paise', 'method', 'status', 'created_at', 'confirmed_at', 'source', 'reference', 'payment_id', 'amount_refunded', 'report_id')} for row in payments],
                financials=_financials(ledger), version=ledger['version'], generated_at=time.time(), payment_id=payment_id,
                attendance=[{k: a.get(k) for k in ('worker_id', 'in_at', 'out_at', 'source')} for a in p.get('attendance', [])][-500:],
                timeline=[{k: e.get(k) for k in ('action', 'note', 'at', 'actor', 'event_type', 'occurred_at_server_time')} for e in p.get('events', [])][-200:],
                progress_source='Contractor-reported progress; customer-confirmed entries and recorded milestone approvals are identified separately.',
                location_source='Attendance is member-reported. No continuous location monitoring or hardware GPS attestation is claimed.')


def public_progress(u, pid, *, summary=False):
    ledger = u.get('contract_project_records', pid)
    if not ledger:
        fail('NOT_FOUND', 'Public contract progress is unavailable.', 404)
    try:
        p, tender = _award(u, pid)
        ledger = _ledger(u, p)
    except HTTPException:
        fail('NOT_FOUND', 'Public contract progress is unavailable.', 404)
    if not _public_consent(tender, ledger):
        fail('NOT_FOUND', 'Public contract progress is unavailable.', 404)
    worker = u.get('workers', p['owner_id']) or {}
    if worker.get('status') != 'approved' or any((u.get('network_suspensions', actor) or {}).get('active') for actor in (p['owner_id'], p['client_id'])):
        fail('NOT_FOUND', 'Public contract progress is unavailable.', 404)
    if summary:
        goals = p.get('goals', [])
        return dict(project={k: p.get(k) for k in ('id', 'title', 'status', 'starts_at', 'ends_at', 'awarded_at')},
                    contractor=dict(id=p['owner_id'], name=worker.get('name') or 'Repaido contractor'),
                    milestones=[], progress=[], calendar=[], progress_series=[],
                    verified_milestone_progress=dict(approved=sum(g.get('status') == 'approved' for g in goals), total=len(goals)),
                    visibility_source='customer_owner_consent', source='Customer-consented project summary; open the project for its calendar and recorded progress.', server_time=time.time())
    rows = _rows(u, 'contract_progress', pid)
    u.prefetch([('contract_attachments', attachment['id']) for row in rows if row.get('public_share_consent')
                for attachment in row.get('evidence', [])])
    progress = []
    for row in rows:
        item = {k: row.get(k) for k in ('id', 'percent', 'status', 'created_at', 'reviewed_at', 'source', 'milestone_id')}
        item['note'] = row['note'] if row.get('public_share_consent') else None
        item['evidence'] = []
        if row.get('public_share_consent'):
            for photo in row.get('evidence', []):
                attachment = u.get('contract_attachments', photo['id']) or {}
                if attachment.get('project_id') == pid and attachment.get('purpose') == 'progress' and attachment.get('status') == 'ready' and attachment.get('public_share_consent'):
                    item['evidence'].append(dict(id=photo['id'], url=f'/api/operations/contracts/public/attachments/{photo["id"]}',
                                                kind=attachment.get('kind', 'image'), mime=attachment['mime'], source='uploader_consented_media'))
        progress.append(item)
    milestones = [{k: g.get(k) for k in ('id', 'title', 'status', 'due_at', 'submitted_at', 'reviewed_at')} for g in p.get('goals', [])]
    calendar = [dict(kind='work_starts', at=p['starts_at']), dict(kind='work_deadline', at=p['ends_at'])]
    calendar += [dict(kind='milestone', id=g['id'], title=g['title'], at=g.get('due_at'), status=g['status']) for g in milestones]
    return dict(project={k: p.get(k) for k in ('id', 'title', 'status', 'starts_at', 'ends_at', 'awarded_at')},
                contractor=dict(id=p['owner_id'], name=worker.get('name') or 'Repaido contractor'),
                milestones=milestones, progress=progress, calendar=calendar,
                progress_series=[dict(at=row['created_at'], percent=row['percent'], status=row['status'], source=row['source']) for row in progress],
                verified_milestone_progress=dict(approved=sum(g['status'] == 'approved' for g in milestones), total=len(milestones)),
                visibility_source='customer_owner_consent', source='Reported progress and recorded milestone decisions; payment and attendance details are private.', server_time=time.time())


def _json_bytes(value):
    return len(json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode())


def _progress_content_hash(row):
    return hashlib.sha256(json.dumps(dict(note=row['note'], evidence=row.get('evidence', [])),
                                    sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def _seal_report(saved):
    """Keep audit snapshots below document and transaction storage bounds.

    Notes and attachment references never change after a progress entry is
    created. Large reports keep hash-checked references to that immutable
    content while preserving the review state recorded at payment time.
    """
    record = saved['record']
    # Existing payment snapshots predate the purchase log.
    for section in REPORT_SECTIONS:
        record.setdefault(section, [])
    counts = {section: len(record[section]) for section in REPORT_SECTIONS}
    record['history_snapshot_status'] = 'complete'
    record['history_counts'] = counts
    if _json_bytes(saved) > REPORT_DOCUMENT_BYTES:
        record['progress'] = [{k: v for k, v in entry.items() if k not in ('note', 'evidence')}
                              | dict(content_hash=_progress_content_hash(entry)) for entry in record['progress']]
    chunks = []
    saved['section_pages'] = {}
    for section in sorted(REPORT_SECTIONS, key=lambda name: _json_bytes(record[name]), reverse=True):
        if _json_bytes(saved) <= REPORT_DOCUMENT_BYTES:
            break
        entries = record[section]
        if not entries:
            continue
        pages, page = [], []
        for entry in entries:
            if page and _json_bytes([*page, entry]) > REPORT_CHUNK_BYTES:
                pages.append(page); page = []
            page.append(entry)
        if page:
            pages.append(page)
        ids = []
        for index, values in enumerate(pages):
            key = _id(saved['id'], section, str(index))
            ids.append(key)
            chunks.append(dict(id=key, report_id=saved['id'], section=section, rows=values))
        saved['section_pages'][section] = ids
        record[section] = []
    if (_json_bytes(saved) > REPORT_DOCUMENT_BYTES or len(chunks) > 100
            or any(_json_bytes(chunk) > REPORT_DOCUMENT_BYTES for chunk in chunks)
            or _json_bytes(saved) + sum(_json_bytes(chunk) for chunk in chunks) > REPORT_TRANSACTION_BYTES):
        # A verified capture must still be recorded if a malformed legacy
        # history exceeds the supported audit-export budget. Never imply that
        # omitted history was snapshotted; the current project report remains
        # available independently with all supported history.
        saved['section_pages'] = {}; chunks = []
        for section in REPORT_SECTIONS:
            record[section] = []
        record['history_snapshot_status'] = 'financial_summary_only_size_review_required'
        if _json_bytes(saved) > REPORT_DOCUMENT_BYTES:
            record['project']['scope'] = 'Scope omitted from this financial snapshot because its saved text requires size review.'
            record['project']['site'] = 'Site omitted from this financial snapshot because its saved text requires size review.'
    return saved, chunks


def _load_report(u, saved):
    record = copy.deepcopy(saved['record'])
    pages = saved.get('section_pages', {})
    if set(pages) - set(REPORT_SECTIONS) or sum(len(ids) for ids in pages.values()) > 100:
        fail('REPORT_REVIEW_REQUIRED', 'This saved report needs storage review.', 503)
    u.prefetch([('contract_report_pages', key) for ids in pages.values() for key in ids])
    for section, ids in pages.items():
        values = []
        for key in ids:
            chunk = u.get('contract_report_pages', key)
            if not chunk or chunk.get('report_id') != saved['id'] or chunk.get('section') != section:
                fail('REPORT_REVIEW_REQUIRED', 'The complete saved report is temporarily unavailable.', 503)
            values.extend(chunk['rows'])
        record[section] = values
    refs = [entry for entry in record['progress'] if entry.get('content_hash')]
    u.prefetch([('contract_progress', entry['id']) for entry in refs])
    for entry in refs:
        source = u.get('contract_progress', entry['id'])
        if not source or source.get('project_id') != saved['project_id'] or _progress_content_hash(source) != entry['content_hash']:
            fail('REPORT_REVIEW_REQUIRED', 'The original progress evidence for this saved report needs review.', 503)
        entry.update(note=source['note'], evidence=source.get('evidence', []))
    if record.get('history_snapshot_status') == 'complete' and any(
            len(record[section]) != count for section, count in record.get('history_counts', {}).items()):
        fail('REPORT_REVIEW_REQUIRED', 'The complete saved report is temporarily unavailable.', 503)
    return record


def _report(u, p, ledger, row):
    rid = _id(p['id'], row['id'], str(row.get('amount_refunded', 0)), str(ledger['version']))
    row['report_id'] = rid
    u.put('contract_payments', row['id'], row)
    saved, chunks = _seal_report(dict(id=rid, project_id=p['id'], payment_id=row['id'], record=_snapshot(u, p, ledger, row['id'])))
    for chunk in chunks:
        u.put('contract_report_pages', chunk['id'], chunk)
    u.put('contract_reports', rid, saved)
    from transactional_mail import enqueue
    enqueue(u,'contract-report:'+rid,'payment_confirmed',[p['client_id'],p['owner_id']],
            {'record_type':'contract_report','record_id':rid,'path':'/?view=contracts&project_id='+p['id']})
    return rid


def apply_provider_payment(u, payment):
    """Called only with a fetched provider payment, never an event/browser entity."""
    linked = u.get('contract_gateway_orders', payment.get('order_id', ''))
    if not linked:
        return None
    row = u.get('contract_payments', linked['payment_id'])
    p, _ = _award(u, linked['project_id'])
    ledger = _ledger(u, p)
    if (not row or row.get('project_id') != p['id'] or row.get('order_id') != payment.get('order_id')
            or row['method'] != 'gateway' or type(payment.get('amount')) is not int
            or payment['amount'] != row['amount_paise'] or payment.get('currency') != 'INR'
            or not re.fullmatch(r'pay_[A-Za-z0-9]+', str(payment.get('id', '')))):
        fail('PAYMENT_MISMATCH', 'The provider payment does not match this approved contract request.', 409)
    pid = payment['id']
    if row.get('payment_id') and row['payment_id'] != pid:
        fail('DUPLICATE_COLLECTION_REVIEW', 'Another collection on this order needs operator reconciliation.', 409)
    receipt = u.get('receipts', pid)
    if receipt and (receipt.get('contract_payment_id') != row['id'] or receipt.get('customer_id') != p['client_id']):
        fail('PAYMENT_ALREADY_USED', 'This provider receipt belongs to another purchase.', 409)
    raw_refund = payment.get('amount_refunded', 0) or 0
    if type(raw_refund) is not int or not 0 <= raw_refund <= row['amount_paise']:
        fail('PAYMENT_MISMATCH', 'The provider refund needs reconciliation.', 409)
    if payment.get('status') == 'refunded' and raw_refund == 0:
        fail('PAYMENT_MISMATCH', 'The provider refund needs reconciliation.', 409)
    captured = payment.get('status') == 'captured' and payment.get('captured') is True
    refunded = payment.get('status') == 'refunded' and raw_refund > 0
    if raw_refund > 0 and not (captured or refunded):
        fail('PAYMENT_MISMATCH', 'The provider refund has no confirmed collection state.', 409)
    if not captured and not refunded:
        return row
    if row['status'] not in ('gateway_pending', 'confirmed', 'partially_refunded', 'refunded'):
        fail('PAYMENT_NOT_APPROVED', 'This collection has no customer-approved request.', 409)
    refund = max(raw_refund, row.get('amount_refunded', 0))
    net = row['amount_paise'] - refund
    previous = row.get('confirmed_amount_paise', 0)
    if row['status'] == 'gateway_pending':
        ledger['pending_reserved_paise'] -= row['amount_paise']
    if row.get('payment_id') == pid and net == previous:
        return row
    ledger['confirmed_paid_paise'] += net - previous
    ledger['gateway_collected_paise'] += net - previous
    row.update(payment_id=pid, amount_refunded=refund, confirmed_amount_paise=net,
               status='refunded' if refund == row['amount_paise'] else 'partially_refunded' if refund else 'confirmed',
               source='platform_collection', confirmed_at=row.get('confirmed_at', time.time()))
    u.put('receipts', pid, dict(id=pid, kind='contract_collection', contract_payment_id=row['id'],
                              customer_id=p['client_id'], project_id=p['id'], amount_paise=row['amount_paise'],
                              currency='INR', verified_at=time.time()))
    _save(u, ledger, 'ContractPaymentProviderVerified', 'razorpay', payment_id=row['id'], amount_paise=net)
    _report(u, p, ledger, row)
    return row


def report_pdf(record, photos=(), kind='full'):
    report_names={'full':'Complete audit record','summary':'Executive summary','progress':'Progress and milestones','payments':'Payments and reconciliation','purchases':'Purchase and expense register','team':'Team and attendance','timeline':'Activity audit trail'}
    if kind not in report_names:fail('INVALID_REPORT','Choose a supported contract report.',422)
    from reportlab.graphics.shapes import Drawing, Line, PolyLine, Rect, String
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Image as PDFImage, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    styles = getSampleStyleSheet()
    styles['BodyText'].fontSize = 9
    styles['BodyText'].leading = 13
    styles['Heading1'].textColor = colors.HexColor('#16344C')
    styles['Heading2'].fontSize = 12
    def text(value):
        return Paragraph(escape(str(value)).replace('\n', '<br/>'), styles['BodyText'])
    def date(value):
        return datetime.fromtimestamp(value, IST).strftime('%d %b %Y %H:%M IST') if value else 'Not recorded'
    def money(value):
        return f'INR {value // 100:,}.{value % 100:02d}'
    blocks = [Paragraph('REPAIDO | '+report_names[kind], styles['Heading1']), text(record['project']['title']),
              text('Contract ' + record['project']['id']), text('Generated ' + date(record['generated_at'])), Spacer(1, 14)]
    def section(title, rows):
        sections={'Payment position':('summary','payments'),'Accepted team':('team',),'Milestones and deadlines':('progress',),'Progress history':('progress',),'Payment timeline':('payments',),'Purchase log':('purchases',),'Contract timeline':('timeline',),'Attendance register':('team',)}
        if title in sections and kind!='full' and kind not in sections[title]:return
        blocks.append(Paragraph(title, styles['Heading2']))
        table = Table([[text(a), text(b)] for a, b in rows], colWidths=[145, 370])
        table.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#F0F4F5')),
                                  ('BOX', (0, 0), (-1, -1), .5, colors.HexColor('#BCD1D8')), ('INNERGRID', (0, 0), (-1, -1), .3, colors.HexColor('#DFE8EA')),
                                  ('TOPPADDING', (0, 0), (-1, -1), 7), ('BOTTOMPADDING', (0, 0), (-1, -1), 7)]))
        blocks.extend([table, Spacer(1, 12)])
    p, financials = record['project'], record['financials']
    digest=hashlib.sha256(json.dumps(record,sort_keys=True,default=str,separators=(',',':')).encode()).hexdigest()
    section('Record control',[('Report',report_names[kind]),('Snapshot reference',digest),('Currency and time','INR; Indian Standard Time (UTC+05:30)'),('Evidence basis','Saved contract records as of the generation time. Contractor reports and customer confirmations are identified separately.')])
    if kind=='summary':
        latest=record.get('progress',[])[-1] if record.get('progress') else None
        section('At a glance',[('Latest reported progress',str(latest['percent'])+'% | '+latest['status'] if latest else 'No progress report recorded'),('Milestones approved',str(sum(g.get('status')=='approved' for g in record.get('milestones',[])))+' of '+str(len(record.get('milestones',[])))),('Recorded purchases',money(sum(x.get('amount_paise',0) for x in record.get('purchases',[])))),('Purchase basis','Recorded expense total only; not an addition to the contract price or evidence of customer payment.')])
    if record.get('history_snapshot_status') == 'financial_summary_only_size_review_required':
        blocks.append(text('This payment report preserves the verified financial snapshot. Historical activity exceeded its storage budget and requires review; use the current contract report for the recorded activity timeline.'))
    section('Agreed work', [('Scope', p.get('scope', '')), ('Site', p.get('site', '')), ('Stage', p['status']),
                           ('Awarded', date(p['awarded_at'])), ('Work calendar', date(p['starts_at']) + ' - ' + date(p['ends_at'])),
                           ('Customer / contractor', record['customer_id'] + ' / ' + record['contractor_id'])])
    section('Payment position', [(label, money(financials[key])) for label, key in [
        ('Agreed deal price', 'agreed_deal_paise'), ('Confirmed net payments', 'confirmed_paid_paise'),
        ('Pending reserved requests', 'pending_reserved_paise'), ('Unpaid balance', 'balance_paise'),
        ('Gateway collected', 'gateway_collected_paise'), ('Contractor received (verified external references)', 'contractor_received_paise')]])
    blocks.append(text('Gateway collection does not confirm contractor payout. Pending or reported transfers are excluded from confirmed totals. This private contract record is not a tax invoice.'))
    section('Accepted team', [(m.get('name') or m.get('worker_id'), f"{m.get('role')} - {m.get('status')}") for m in record['team']] or [('Team', 'No accepted team recorded')])
    section('Milestones and deadlines', [(g.get('title', g.get('id')), f"{g.get('status')} | due {date(g.get('due_at'))}") for g in record['milestones']] or [('Milestones', 'No milestones recorded')])
    if kind in ('full','progress'):
        progress = record['progress']
        blocks.extend([Paragraph('Progress calendar and graph', styles['Heading2']), text(record['progress_source'])])
        if progress:
            graph = Drawing(510, 140)
            graph.add(Line(35, 25, 495, 25, strokeColor=colors.HexColor('#9CB2BB')))
            graph.add(Line(35, 25, 35, 125, strokeColor=colors.HexColor('#9CB2BB')))
            graph.add(String(0, 120, '100%', fontSize=8)); graph.add(String(8, 25, '0%', fontSize=8))
            points = []
            start, end = min(x['created_at'] for x in progress), max(x['created_at'] for x in progress)
            for entry in progress:
                x = 35 + 460 * (entry['created_at'] - start) / max(1, end - start)
                points.extend([x, 25 + entry['percent']])
            if len(points) > 2:
                graph.add(PolyLine(points, strokeColor=colors.HexColor('#236C84'), strokeWidth=2))
            else:
                graph.add(Rect(points[0] - 2, points[1] - 2, 4, 4, fillColor=colors.HexColor('#236C84')))
            blocks.extend([graph, Spacer(1, 8)])
        section('Progress history', [(date(x['created_at']), f"{x['percent']}% | {x['status']} | {x['note']} | Media references: " + ', '.join(e.get('kind', 'image') + ' ' + e['id'] for e in x.get('evidence', []))) for x in progress] or [('Progress', 'No progress reports recorded')])
        if photos:
            blocks.append(Paragraph('Private progress photo previews', styles['Heading2']))
            for photo in photos:
                blocks.append(text('Photo ' + photo['id']))
                if photo.get('data'):
                    preview = PDFImage(io.BytesIO(photo['data']))
                    scale = min(1, 240 / preview.imageWidth, 180 / preview.imageHeight)
                    preview.drawWidth = preview.imageWidth * scale; preview.drawHeight = preview.imageHeight * scale
                    blocks.append(preview)
                else:
                    blocks.append(text('Preview unavailable; the saved private photo reference remains in the progress record.'))
                blocks.append(Spacer(1, 8))
            blocks.append(text('Up to ten recent authorized progress photos are previewed. All recorded photo and video references remain listed above; videos can be opened in the private contract timeline.'))
    section('Payment timeline', [(date(x.get('confirmed_at') or x['created_at']), f"{money(x['amount_paise'])} | {x['method']} | {x['status']} | {x.get('source') or 'pending'} | Reference {x.get('reference') or x.get('payment_id') or x['id']}") for x in record['payments']] or [('Payments', 'No payment requests recorded')])
    section('Purchase log', [(date(x['purchased_at']), f"{x['title']} | {money(x['amount_paise'])} | {x['status']} | Vendor {x.get('vendor') or 'Not supplied'} | Receipt {x['receipt_reference']} | {x.get('note') or ''}") for x in record.get('purchases', [])] or [('Purchases', 'No purchases recorded')])
    blocks.append(text('Purchases are contractor-reported expenses, with customer review shown separately. They do not increase the agreed price, confirm a payment or create an extra payment request.'))
    section('Attendance register',[(date(x.get('in_at')),str(x.get('worker_name') or x.get('worker_id') or 'Team member')+' | '+'Out '+date(x.get('out_at'))+' | Source '+str(x.get('source') or 'Member reported')) for x in record.get('attendance',[])] or [('Attendance','No attendance records')])
    section('Contract timeline', [(date(x.get('at') or x.get('occurred_at_server_time')), x.get('action') or x.get('event_type') or 'Recorded event') for x in record['timeline']] or [('Timeline', 'Awarded contract; no additional status events recorded')])
    blocks.append(text(record['location_source']))
    out = io.BytesIO()
    doc = SimpleDocTemplate(out, pagesize=A4, leftMargin=40, rightMargin=40, topMargin=40, bottomMargin=40)
    def footer(canvas, document):
        canvas.setFont('Helvetica', 8); canvas.drawString(40, 22, 'Repaido - private awarded contract record')
        canvas.drawRightString(A4[0] - 40, 22, f'Page {document.page}')
    doc.build(blocks, onFirstPage=footer, onLaterPages=footer)
    return out.getvalue()


def install(core):
    router = APIRouter(prefix='/operations/contracts', tags=['Private contract records'])
    store = core.operations_store
    def response(u, p, user):
        return records(u, p, user)
    def payment_row(u, pid, payment_id):
        row = u.get('contract_payments', payment_id)
        if not row or row.get('project_id') != pid:
            fail('NOT_FOUND', 'Contract payment request not found.', 404)
        return row
    def photos_for_report(record, user):
        from repaidians_media import read, ready
        refs = list(dict.fromkeys(photo['id'] for entry in reversed(record['progress']) for photo in entry.get('evidence', []) if photo.get('kind', 'image') == 'image'))[:10]
        def authorize(u):
            _access(u, record['project']['id'], user)
            return [u.get('contract_attachments', eid) for eid in refs]
        attachments = store.run(authorize) if refs else []
        photos = []
        for eid, attachment in zip(refs, attachments):
            result = dict(id=eid)
            if attachment and attachment.get('kind', 'image') == 'image' and attachment.get('project_id') == record['project']['id'] and attachment.get('purpose') == 'progress' and attachment.get('status') == 'ready' and ready(core):
                try:
                    from PIL import Image
                    with Image.open(io.BytesIO(read(core, attachment['object']))) as photo:
                        photo.thumbnail((640, 640)); out = io.BytesIO(); photo.convert('RGB').save(out, format='JPEG', quality=80)
                        result['data'] = out.getvalue()
                except Exception:
                    pass
            photos.append(result)
        return photos

    @router.get('/projects/{pid}/records')
    def get_records(pid: str, user=Depends(core.current_user)):
        return store.run(lambda u: response(u, _access(u, pid, user)[0], user))

    @router.post('/projects/{pid}/progress')
    def progress(pid: str, body: Progress, user=Depends(core.current_user)):
        def save(u):
            p, _ = _access(u, pid, user, True)
            if user['id'] != p['owner_id']:
                fail('CONTRACTOR_REQUIRED', 'Only the awarded contractor reports work progress.', 403)
            key, fingerprint, replay = _replay(u, pid, user['id'], 'progress', body)
            if replay:
                return response(u, p, user)
            ledger = _ledger(u, p); _version(ledger, body.expected_version)
            if ledger['progress_count'] >= LIMIT:
                fail('RECORD_LIMIT', 'This contract has reached its progress record limit.', 409)
            _milestone(p, body.milestone_id)
            evidence = _evidence(u, p, body.evidence_ids, user['id'], 'progress')
            row = dict(id=key, project_id=pid, percent=body.percent, note=body.note, evidence=evidence,
                       milestone_id=body.milestone_id, public_share_consent=body.public_share_consent,
                       status='reported', source='contractor_reported', created_at=time.time(), actor_id=user['id'])
            u.put('contract_progress', key, row); ledger['progress_count'] += 1
            _save(u, ledger, 'ContractProgressReported', user['id'], progress_id=key)
            _remember(u, key, fingerprint, key)
            return response(u, p, user)
        return store.run(save)

    @router.post('/projects/{pid}/purchases')
    def record_purchase(pid: str, body: Purchase, user=Depends(core.current_user)):
        def save(u):
            p, _ = _access(u, pid, user, True)
            if user['id'] != p['owner_id']:
                fail('CONTRACTOR_REQUIRED', 'Only the awarded contractor records project purchases.', 403)
            key, fingerprint, replay = _replay(u, pid, user['id'], 'purchase', body)
            if replay:
                return response(u, p, user)
            ledger = _ledger(u, p); _version(ledger, body.expected_version)
            if ledger.get('purchase_count', 0) >= LIMIT:
                fail('RECORD_LIMIT', 'This contract has reached its purchase log limit.', 409)
            if body.purchased_at > time.time():
                fail('PURCHASE_DATE_REQUIRED', 'Record the actual purchase date, not a future date.', 422)
            if not body.title.strip() or not body.receipt_reference.strip():
                fail('PURCHASE_DETAILS_REQUIRED', 'Provide a purchase description and actual receipt reference.', 422)
            row = dict(id=key, project_id=pid, title=body.title.strip(), vendor=body.vendor.strip(),
                       amount_paise=body.amount_paise, purchased_at=body.purchased_at,
                       receipt_reference=body.receipt_reference.strip(), note=body.note,
                       evidence=_evidence(u, p, body.evidence_ids, user['id'], 'purchase'),
                       status='reported', source='contractor_reported', actor_id=user['id'], created_at=time.time())
            u.put('contract_purchases', key, row)
            ledger['purchase_count'] = ledger.get('purchase_count', 0) + 1
            _save(u, ledger, 'ContractPurchaseReported', user['id'], purchase_id=key)
            _remember(u, key, fingerprint, key)
            return response(u, p, user)
        return store.run(save)

    @router.post('/projects/{pid}/purchases/{purchase_id}/review')
    def review_purchase(pid: str, purchase_id: str, body: Approval, user=Depends(core.current_user)):
        def save(u):
            p, _ = _access(u, pid, user, True)
            if user['id'] != p['client_id']:
                fail('CUSTOMER_REQUIRED', 'Only the customer reviews project purchases.', 403)
            key, fingerprint, replay = _replay(u, pid, user['id'], 'purchase_review:' + purchase_id, body)
            if replay:
                return response(u, p, user)
            ledger = _ledger(u, p); _version(ledger, body.expected_version)
            row = u.get('contract_purchases', purchase_id)
            if not row or row['project_id'] != pid or row['status'] != 'reported':
                fail('PURCHASE_REVIEW', 'Choose an unreviewed purchase from this contract.', 409)
            row.update(status='customer_confirmed' if body.approved else 'changes_requested', review_note=body.note,
                       reviewed_by=user['id'], reviewed_at=time.time())
            u.put('contract_purchases', purchase_id, row)
            _save(u, ledger, 'ContractPurchaseReviewed', user['id'], purchase_id=purchase_id)
            _remember(u, key, fingerprint, purchase_id)
            return response(u, p, user)
        return store.run(save)

    @router.post('/projects/{pid}/progress/{progress_id}/review')
    def review_progress(pid: str, progress_id: str, body: ProgressReview, user=Depends(core.current_user)):
        def save(u):
            p, _ = _access(u, pid, user, True)
            if user['id'] != p['client_id']:
                fail('CUSTOMER_REQUIRED', 'Only the customer reviews reported progress.', 403)
            key, fingerprint, replay = _replay(u, pid, user['id'], 'progress_review:' + progress_id, body)
            if replay:
                return response(u, p, user)
            ledger = _ledger(u, p); _version(ledger, body.expected_version)
            row = u.get('contract_progress', progress_id)
            if not row or row['project_id'] != pid or row['status'] != 'reported':
                fail('PROGRESS_REVIEW', 'Choose an unreviewed progress report from this contract.', 409)
            row.update(status='customer_confirmed' if body.approved else 'changes_requested', review_note=body.note, reviewed_by=user['id'], reviewed_at=time.time())
            u.put('contract_progress', progress_id, row)
            _save(u, ledger, 'ContractProgressReviewed', user['id'], progress_id=progress_id)
            _remember(u, key, fingerprint, progress_id)
            return response(u, p, user)
        return store.run(save)

    @router.post('/projects/{pid}/payments')
    def request_payment(pid: str, body: PaymentRequest, user=Depends(core.current_user)):
        def save(u):
            p, _ = _access(u, pid, user, True)
            key, fingerprint, replay = _replay(u, pid, user['id'], 'payment_request', body)
            if replay:
                return response(u, p, user)
            ledger = _ledger(u, p); _version(ledger, body.expected_version)
            if ledger['payment_count'] >= LIMIT:
                fail('RECORD_LIMIT', 'This contract has reached its payment request limit.', 409)
            if body.amount_paise > ledger['agreed_deal_paise'] - ledger['confirmed_paid_paise'] - ledger['pending_reserved_paise']:
                fail('DEAL_CEILING', 'This request exceeds the remaining agreed contract amount.', 409)
            _milestone(p, body.milestone_id)
            if not _methods(u, p)[body.method]['available']:
                fail('PAYMENT_METHOD_UNAVAILABLE', 'This payment method is not connected for the awarded contractor.', 503)
            row = dict(id=key, project_id=pid, customer_id=p['client_id'], contractor_id=p['owner_id'],
                       amount_paise=body.amount_paise, method=body.method, note=body.note, milestone_id=body.milestone_id,
                       status='requested', requested_by=user['id'], created_at=time.time(), currency='INR')
            u.put('contract_payments', key, row)
            ledger['payment_count'] += 1; ledger['pending_reserved_paise'] += body.amount_paise
            _save(u, ledger, 'ContractPaymentRequested', user['id'], payment_id=key, amount_paise=body.amount_paise)
            _remember(u, key, fingerprint, key)
            return response(u, p, user)
        return store.run(save)

    @router.post('/projects/{pid}/payments/{payment_id}/approve')
    def approve(pid: str, payment_id: str, body: Approval, user=Depends(core.current_user)):
        def save(u):
            p, _ = _access(u, pid, user, True)
            if user['id'] != p['client_id']:
                fail('CUSTOMER_REQUIRED', 'Only the customer approves a contract payment request.', 403)
            key, fingerprint, replay = _replay(u, pid, user['id'], 'payment_approve:' + payment_id, body)
            if replay:
                return response(u, p, user)
            ledger = _ledger(u, p); _version(ledger, body.expected_version)
            row = payment_row(u, pid, payment_id)
            if row['status'] != 'requested':
                fail('PAYMENT_DECIDED', 'This payment request has already been decided.', 409)
            row.update(status='approved' if body.approved else 'rejected', approved_by=user['id'], approved_at=time.time(), approval_note=body.note)
            if not body.approved:
                ledger['pending_reserved_paise'] -= row['amount_paise']
            u.put('contract_payments', payment_id, row)
            _save(u, ledger, 'ContractPaymentRequestDecided', user['id'], payment_id=payment_id)
            _remember(u, key, fingerprint, payment_id)
            return response(u, p, user)
        return store.run(save)

    @router.post('/projects/{pid}/payments/{payment_id}/reported')
    def reported(pid: str, payment_id: str, body: ReportedTransfer, user=Depends(core.current_user)):
        def save(u):
            p, _ = _access(u, pid, user, True)
            if user['id'] != p['client_id']:
                fail('CUSTOMER_REQUIRED', 'Only the customer reports their external transfer.', 403)
            key, fingerprint, replay = _replay(u, pid, user['id'], 'payment_report:' + payment_id, body)
            if replay:
                return response(u, p, user)
            ledger = _ledger(u, p); _version(ledger, body.expected_version)
            row = payment_row(u, pid, payment_id)
            if row['method'] not in ('neft', 'rtgs') or row['status'] != 'approved':
                fail('PAYMENT_REPORT_UNAVAILABLE', 'Approve an external transfer request before reporting its reference.', 409)
            row.update(status='reported_pending', reference=body.reference, evidence=_evidence(u, p, body.evidence_ids, user['id'], 'payment'),
                       reported_at=time.time(), reported_by=user['id'], transfer_note=body.note, source='customer_reported_unverified')
            u.put('contract_payments', payment_id, row)
            _save(u, ledger, 'ContractExternalTransferReported', user['id'], payment_id=payment_id)
            _remember(u, key, fingerprint, payment_id)
            return response(u, p, user)
        return store.run(save)

    @router.post('/admin/payments/{payment_id}/verify-external')
    def verify_external(payment_id: str, body: TransferReview, admin=Depends(core.operator)):
        def save(u):
            row = u.get('contract_payments', payment_id)
            if not row:
                fail('NOT_FOUND', 'Payment request not found.', 404)
            p, _ = _award(u, row['project_id']); ledger = _ledger(u, p)
            if row['status'] == 'confirmed' and row.get('verified_reference') == body.verified_reference and body.approved:
                return dict(payment_id=payment_id, status=row['status'], report_id=row['report_id'])
            if row['method'] not in ('neft', 'rtgs') or row['status'] != 'reported_pending' or body.verified_reference != row['reference']:
                fail('TRANSFER_REVIEW_REQUIRED', 'Review the reported bank reference and original evidence.', 409)
            receipt_id = 'bank-' + _id(body.verified_reference.strip().upper())
            old = u.get('contract_external_receipts', receipt_id)
            if body.approved and old and old['payment_id'] != payment_id:
                fail('TRANSFER_ALREADY_USED', 'This bank reference already belongs to another confirmed transfer.', 409)
            row.update(status='confirmed' if body.approved else 'rejected', verified_by=admin['id'], verified_at=time.time(),
                       verified_reference=body.verified_reference, review_reason=body.reason, operator_evidence_reference=body.evidence_reference)
            ledger['pending_reserved_paise'] -= row['amount_paise']
            if body.approved:
                row.update(source='operator_verified_external_transfer', confirmed_at=time.time(), confirmed_amount_paise=row['amount_paise'])
                ledger['confirmed_paid_paise'] += row['amount_paise']; ledger['contractor_received_paise'] += row['amount_paise']
                u.put('contract_external_receipts', receipt_id, dict(id=receipt_id, payment_id=payment_id, project_id=p['id'], reference=body.verified_reference))
            u.put('contract_payments', payment_id, row)
            _save(u, ledger, 'ContractExternalTransferReviewed', admin['id'], payment_id=payment_id, decision=body.approved)
            if body.approved:
                _report(u, p, ledger, row)
            return dict(payment_id=payment_id, status=row['status'], report_id=row.get('report_id'))
        return store.run(save)

    @router.post('/projects/{pid}/payments/{payment_id}/order')
    def order(pid: str, payment_id: str, user=Depends(core.current_user)):
        if not payments_ready():
            fail('PAYMENTS_UNAVAILABLE', 'Online contract payments are not connected. No charge was made.', 503)
        def reserve(u):
            p, _ = _access(u, pid, user, True)
            if user['id'] != p['client_id']:
                fail('CUSTOMER_REQUIRED', 'Only the customer pays an approved contract request.', 403)
            row = payment_row(u, pid, payment_id)
            if row['method'] != 'gateway' or row['status'] not in ('approved', 'gateway_creating', 'gateway_pending'):
                fail('PAYMENT_NOT_APPROVED', 'The customer must approve this gateway payment request first.', 409)
            fresh = row['status'] == 'approved'
            if fresh:
                row.update(status='gateway_creating', receipt='ct-' + row['id'][:32])
                u.put('contract_payments', row['id'], row)
            return row, fresh
        row, fresh = store.run(reserve)
        if not row.get('order_id'):
            if fresh:
                gateway = razorpay('orders', dict(amount=row['amount_paise'], currency='INR', receipt=row['receipt'], notes=dict(contract_payment_id=row['id'], project_id=pid, customer_id=user['id'])))
            else:
                found = razorpay('orders?receipt=' + row['receipt']).get('items', [])
                matches = [item for item in found if item.get('receipt') == row['receipt']]
                if len(matches) != 1:
                    fail('ORDER_RECONCILING', 'The provider has not confirmed this order. Keep this request; do not pay another order.', 503)
                gateway = matches[0]
            notes = gateway.get('notes') or {}
            if (gateway.get('amount') != row['amount_paise'] or type(gateway.get('amount')) is not int or gateway.get('currency') != 'INR'
                    or gateway.get('receipt') != row['receipt'] or not re.fullmatch(r'order_[A-Za-z0-9]+', str(gateway.get('id', '')))
                    or notes.get('contract_payment_id') != row['id'] or notes.get('project_id') != pid or notes.get('customer_id') != user['id']):
                fail('ORDER_MISMATCH', 'The provider order needs reconciliation.', 409)
            def attach(u):
                p, _ = _access(u, pid, user, True); current = payment_row(u, pid, payment_id)
                linked = u.get('contract_gateway_orders', gateway['id'])
                if current['status'] not in ('gateway_creating', 'gateway_pending') or (current.get('order_id') and current['order_id'] != gateway['id']) or (linked and linked['payment_id'] != payment_id):
                    fail('ORDER_MISMATCH', 'This provider order needs operator review.', 409)
                current.update(order_id=gateway['id'], status='gateway_pending')
                u.put('contract_gateway_orders', gateway['id'], dict(payment_id=payment_id, project_id=pid))
                u.put('contract_payments', payment_id, current)
                return current
            row = store.run(attach)
        return dict(payment_id=row['id'], order_id=row['order_id'], amount_paise=row['amount_paise'], currency='INR', key_id=os.getenv('RAZORPAY_KEY_ID', ''), status=row['status'], source='platform_collection', contractor_payout_connected=False)

    @router.post('/projects/{pid}/payments/{payment_id}/check')
    def check(pid: str, payment_id: str, body: PaymentCheck, user=Depends(core.current_user)):
        def authorize(u):
            p, _ = _access(u, pid, user)
            if user['id'] != p['client_id']:
                fail('CUSTOMER_REQUIRED', 'Only the customer reconciles their contract payment.', 403)
            row = payment_row(u, pid, payment_id)
            if row['method'] != 'gateway' or not row.get('order_id'):
                fail('ORDER_REQUIRED', 'Create the approved provider order before checking payment.', 409)
            return row
        row = store.run(authorize)
        payment = razorpay('payments/' + body.payment_id)
        if payment.get('id') != body.payment_id or payment.get('order_id') != row['order_id']:
            fail('PAYMENT_MISMATCH', 'Payment does not belong to this approved contract order.', 409)
        def apply(u):
            p, _ = _access(u, pid, user)
            apply_provider_payment(u, payment)
            return response(u, p, user)
        return store.run(apply)

    @router.get('/projects/{pid}/bank-instructions')
    def bank_instructions(pid: str, user=Depends(core.current_user)):
        def own(u):
            p, _ = _access(u, pid, user, True)
            if user['id'] != p['client_id']:
                fail('CUSTOMER_REQUIRED', 'Only the customer can view the awarded contractor bank instructions.', 403)
            if not any(row['method'] in ('neft', 'rtgs') and row['status'] == 'approved' for row in _rows(u, 'contract_payments', pid)):
                fail('PAYMENT_APPROVAL_REQUIRED', 'Approve an external payment request before viewing transfer instructions.', 409)
            bank = u.get('verification', p['owner_id']) or {}
            if bank.get('bank_status') != 'verified' or not bank.get('fund_account_id'):
                fail('BANK_NOT_VERIFIED', 'The awarded contractor has no verified bank instructions.', 503)
            return p, bank
        p, bank = store.run(own)
        fund = razorpay('fund_accounts/' + bank['fund_account_id'], payout=True)
        contact = razorpay('contacts/' + str(fund.get('contact_id', '')), payout=True)
        account = fund.get('bank_account') or {}
        if fund.get('id') != bank['fund_account_id'] or contact.get('reference_id') != p['owner_id'] or str(account.get('account_number', ''))[-4:] != bank.get('bank_last4'):
            fail('BANK_REVIEW_REQUIRED', 'Verified bank details changed. Ask support to recheck them.', 409)
        if not re.fullmatch(r'[0-9]{6,24}', str(account.get('account_number', ''))) or not re.fullmatch(r'[A-Z]{4}0[A-Z0-9]{6}', str(account.get('ifsc', ''))):
            fail('BANK_REVIEW_REQUIRED', 'The provider bank instructions need review.', 409)
        # Recheck live ownership and the approved bank pointer after external GETs.
        latest_p, latest_bank = store.run(own)
        if latest_p['owner_id'] != p['owner_id'] or latest_bank['fund_account_id'] != bank['fund_account_id']:
            fail('BANK_REVIEW_REQUIRED', 'Bank instructions changed. Refresh before transferring.', 409)
        return dict(account_holder=account.get('name'), account_number=str(account['account_number']), ifsc=account['ifsc'], bank_name=account.get('bank_name'), last4=bank.get('bank_last4'), source='provider_verified_contractor_bank', guidance='Follow your bank displayed limits, fees and settlement instructions. A reported transfer remains pending until independent verification.')

    @router.post('/projects/{pid}/attachments')
    async def upload(pid: str, request: Request, purpose: Literal['progress', 'payment', 'purchase'] = Query(), share_public: bool = Query(default=False), user=Depends(core.current_user)):
        from repaidians_media import MAX_BYTES, prepare, read, write
        store.run(lambda u: _access(u, pid, user, True))
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > MAX_BYTES:
                fail('MEDIA_TOO_LARGE', 'Choose contract evidence up to 8 MB.', 413)
        mime = request.headers.get('content-type', '').split(';', 1)[0]
        accepted = ('image/jpeg', 'image/png', 'image/webp') + (('video/mp4', 'video/webm') if purpose == 'progress' else ())
        if mime not in accepted:
            fail('EVIDENCE_TYPE_REQUIRED', 'Choose a JPEG, PNG or WebP photo; progress also accepts MP4 and WebM video.', 422)
        cleaned, mime, kind = prepare(bytes(data), mime)
        if purpose != 'progress' and share_public:
            fail('PRIVATE_PAYMENT_EVIDENCE', 'Payment and purchase evidence remains private.', 422)
        sha = hashlib.sha256(cleaned).hexdigest(); key = _id(pid, user['id'], purpose, sha, str(share_public))
        def reserve(u):
            p, _ = _access(u, pid, user, True)
            old = u.get('contract_attachments', key)
            if old:
                return old, old['status'] != 'ready'
            ledger = _ledger(u, p)
            if ledger['attachment_count'] >= MAX_ATTACHMENTS:
                fail('ATTACHMENT_LIMIT', 'This contract has reached its evidence attachment limit.', 409)
            row = dict(id=key, project_id=pid, purpose=purpose, uploaded_by=user['id'], mime=mime, kind=kind,
                       object=f'repaidians/contract-records/{pid}/{key}', public_share_consent=share_public,
                       sha256=sha, status='uploading', created_at=time.time())
            ledger['attachment_count'] += 1
            u.put('contract_project_records', pid, ledger); u.put('contract_attachments', key, row)
            return row, True
        row, send = store.run(reserve)
        if send:
            try:
                write(core, row['object'], cleaned, mime)
            except Exception:
                if hashlib.sha256(read(core, row['object'])).hexdigest() != sha:
                    fail('UPLOAD_RECONCILING', 'Private evidence upload is not confirmed. Retry the same file.', 503)
            def ready(u):
                _access(u, pid, user, True)
                saved = u.get('contract_attachments', key); saved['status'] = 'ready'
                u.put('contract_attachments', key, saved)
            store.run(ready)
        return dict(id=key, url=f'/api/operations/contracts/attachments/{key}', mime=mime, kind=kind, purpose=purpose)

    @router.get('/attachments/{attachment_id}')
    def attachment(attachment_id: str, user=Depends(core.current_user)):
        from repaidians_media import read
        def authorize(u):
            row = u.get('contract_attachments', attachment_id)
            if not row or row['status'] != 'ready':
                fail('NOT_FOUND', 'Private contract evidence not found.', 404)
            _access(u, row['project_id'], user)
            return row
        row = store.run(authorize)
        return Response(read(core, row['object']), media_type=row['mime'], headers={'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'})

    @router.get('/projects/{pid}/report.pdf')
    def current_report(pid: str, kind: Literal['full','summary','progress','payments','purchases','team','timeline']='full', user=Depends(core.current_user)):
        def authorize(u):
            p, _ = _access(u, pid, user)
            return _snapshot(u, p, _ledger(u, p))
        record = store.run(authorize)
        return Response(report_pdf(record, photos_for_report(record, user) if kind in ('full','progress') else (),kind), media_type='application/pdf', headers={'Cache-Control': 'private, no-store', 'Content-Disposition': f'attachment; filename="Repaido-contract-{kind}.pdf"', 'X-Content-Type-Options': 'nosniff'})

    @router.get('/reports/{report_id}.pdf')
    def payment_report(report_id: str, user=Depends(core.current_user)):
        def authorize(u):
            saved = u.get('contract_reports', report_id)
            if not saved:
                fail('NOT_FOUND', 'Contract payment report not found.', 404)
            _access(u, saved['project_id'], user)
            return _load_report(u, saved)
        record = store.run(authorize)
        return Response(report_pdf(record, photos_for_report(record, user)), media_type='application/pdf', headers={'Cache-Control': 'private, no-store', 'Content-Disposition': 'attachment; filename="Repaido-contract-payment-report.pdf"', 'X-Content-Type-Options': 'nosniff'})

    @router.put('/projects/{pid}/public-progress')
    def share_progress(pid: str, body: PublicProgressConsent, user=Depends(core.current_user)):
        def save(u):
            p, _ = _access(u, pid, user, True)
            if user['id'] != p['client_id']:
                fail('CUSTOMER_REQUIRED', 'Only the customer owner chooses public contract progress.', 403)
            key, fingerprint, replay = _replay(u, pid, user['id'], 'public_progress', body)
            if replay:
                return response(u, p, user)
            ledger = _ledger(u, p); _version(ledger, body.expected_version)
            set_public_consent(u, p, user['id'], body.enabled)
            _remember(u, key, fingerprint, pid)
            return response(u, p, user)
        return store.run(save)

    @router.get('/public/projects/{pid}/progress')
    def public_project_progress(pid: str):
        return store.run(lambda u: public_progress(u, pid))

    @router.get('/public/contractors/{uid}/projects')
    def contractor_public_projects(uid: str, cursor: str = Query(default='', max_length=100, pattern=r'^[A-Za-z0-9_-]*$'), limit: int = Query(default=12, ge=1, le=24)):
        def read(u):
            if u.tx is not None:
                from google.cloud.firestore_v1.field_path import FieldPath
                q = u.core.fs_collection('ops_contract_project_records').where('contractor_id', '==', uid).order_by(FieldPath.document_id()).limit(limit + 1)
                if cursor:
                    q = q.start_after({FieldPath.document_id(): u.core.fs_doc('ops_contract_project_records', cursor)})
                rows = [(s.id, s.to_dict()) for s in q.stream(transaction=u.tx)]
            else:
                rows = [(r['id'], json.loads(r['body'])) for r in u.conn.execute("SELECT id,body FROM operation_records WHERE kind='contract_project_records' AND json_extract(body,'$.contractor_id')=? AND id>? ORDER BY id LIMIT ?", (uid, cursor, limit + 1))]
            has_more = len(rows) > limit; scanned = rows[:limit]; projects = []
            for key, ledger in scanned:
                try:
                    projects.append(public_progress(u, key, summary=True))
                except HTTPException as error:
                    if error.status_code != 404:
                        raise
            return dict(projects=projects, has_more=has_more, next_cursor=scanned[-1][0] if has_more and scanned else None, source='customer_owner_consented_contract_history')
        return store.run(read)

    @router.get('/public/attachments/{attachment_id}')
    def public_photo(attachment_id: str):
        from repaidians_media import read
        def authorize(u):
            attachment = u.get('contract_attachments', attachment_id)
            if not attachment or attachment.get('purpose') != 'progress' or attachment.get('status') != 'ready' or not attachment.get('public_share_consent'):
                fail('NOT_FOUND', 'Public contract media unavailable.', 404)
            shared = public_progress(u, attachment['project_id'])
            if not any(photo['id'] == attachment_id for entry in shared['progress'] for photo in entry['evidence']):
                fail('NOT_FOUND', 'Public contract media unavailable.', 404)
            return attachment
        attachment = store.run(authorize)
        return Response(read(core, attachment['object']), media_type=attachment['mime'], headers={'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'})

    core.app.include_router(router)
