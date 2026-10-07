"""Durable transactional email outbox; SMTP acceptance is not inbox delivery.

No network I/O occurs inside the command transaction. Each recipient has an
independent claim. An interrupted SMTP DATA exchange requires review rather
than a blind duplicate send. Verification links are derived only at send time.
"""
import base64
import hashlib
import json
import os
import re
import smtplib
import ssl
import time
import uuid
from dataclasses import dataclass, field
from email.message import EmailMessage
from email.utils import formatdate
from html import escape
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from operations import fail

SENDER = 'support@repaido.com'
LEASE_SECONDS = 120
SMTP_TIMEOUT = 15
MAX_ATTEMPTS = 6
MAX_RECIPIENTS = 50
MAX_FANOUT_RECIPIENTS = 1000
FANOUT_BATCH = 20
MAX_AGE_SECONDS = 7 * 86400
DISPATCH_SECONDS = 30
TERMINAL = {'accepted', 'failed', 'skipped', 'needs_review'}
_ID = re.compile(r'^[A-Za-z0-9_:.\-]{1,200}$')
_MAIL = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$")
_KINDS = {
    'registration': ('Welcome to Repaido', 'Your account is ready. Open Repaido to review your account and next steps.'),
    'login': ('Repaido sign-in notice', 'A sign-in to your Repaido account was recorded. Open your account securely to review it or contact support if you need help.'),
    'account_created': ('Welcome to Repaido', 'Your account is ready. Open Repaido to review your account and next steps.'),
    'email_verification': ('Verify your Repaido email address', 'Confirm ownership of this email address using the expiring verification link. This link does not sign you in.'),
    'booking_confirmed': ('Your Repaido booking is confirmed', 'Your booking has an update. Sign in to review the saved booking and work details.'),
    'contract_awarded': ('Your Repaido contract has been awarded', 'A contract award has been recorded. Sign in to review the agreed scope, team and next steps.'),
    'custom_contract_awarded': ('Your Repaido contract has been awarded', 'A contract award has been recorded. Sign in to review the agreed scope, team and next steps.'),
    'custom_contract_bid': ('A contractor proposal is ready', 'A proposal is available for your contract request. Sign in to review it and decide.'),
    'payment_confirmed': ('Your Repaido payment record is ready', 'A verified payment update has been recorded. Sign in to view the actual payment status and report.'),
    'invoice_ready': ('Your Repaido document is ready', 'A saved document is available. Sign in to review it securely.'),
    'support_opened': ('Your Repaido support request is recorded', 'Your support request has been saved. Sign in to view its status and conversation.'),
    'support_reply': ('Your Repaido support conversation has a reply', 'A reply is available in your support conversation. Sign in to review it securely.'),
    'support_updated': ('Your Repaido support request has an update', 'Your support request has a saved update. Sign in to review the current status.'),
    'contract_progress': ('Your Repaido contract has a progress report', 'A contractor progress report has been saved. Sign in to review the reported progress, calendar and supporting media.'),
    'contract_progress_reviewed': ('Your Repaido progress report has been reviewed', 'A customer review decision has been recorded. Sign in to view the decision and next steps.'),
    'contract_purchase_reported': ('A project purchase has been recorded', 'A contractor-reported purchase is ready for review in your private contract workspace.'),
    'contract_purchase_reviewed': ('A project purchase has been reviewed', 'A customer review decision has been recorded in your private contract purchase log.'),
    'contract_payment_requested': ('A Repaido contract payment request is ready', 'A payment request is awaiting its saved decision. Sign in to review the request before any payment.'),
    'contract_payment_decided': ('Your Repaido payment request has a decision', 'A decision has been recorded for a payment request. Sign in to view the actual status; approval alone does not confirm payment.'),
    'contract_transfer_reported': ('Your Repaido transfer report is pending review', 'An external transfer reference has been reported. It remains unverified until independent review. Sign in to view its status.'),
    'contract_transfer_reviewed': ('Your Repaido transfer report has a decision', 'An independent review decision has been saved. Sign in to see whether the reported transfer was verified or rejected.'),
}
_QUERY_KEYS = {'view', 'section', 'tab', 'mode', 'booking', 'custom-contract', 'custom-proposal', 'destination', 'reference', 'ref', 'query', 'query_id', 'queryId',
               'contract_query_id', 'contract_id', 'project_id', 'booking_id', 'shop_id', 'order_id', 'payment_id'}


@dataclass(frozen=True)
class SMTPSettings:
    host: str
    port: int
    username: str
    password: str = field(repr=False)
    origin: str = ''


def _email(value):
    if not isinstance(value, str) or len(value) > 254 or value != value.strip() or not _MAIL.fullmatch(value):
        return None
    address = value.casefold()
    if address.endswith('@repaido.user') or '..' in address or address.startswith('.'):
        return None
    return address


def _origin():
    value = os.getenv('REPAIDO_PUBLIC_WEB_URL', '').strip().rstrip('/')
    try:
        parsed = urlsplit(value)
        invalid = (any(ord(char) < 32 or char == '|' for char in value) or parsed.scheme != 'https'
                   or not parsed.hostname or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.\-]{0,252}', parsed.hostname)
                   or parsed.username or parsed.password
                   or parsed.path not in ('', '/') or parsed.query or parsed.fragment)
        parsed.port  # Reject an invalid configured port while still failing closed.
    except ValueError:
        return None
    return None if invalid else value


def _settings():
    if os.getenv('REPAIDO_TRANSACTIONAL_EMAIL_ENABLED', '').lower() != 'true':
        return None, 'delivery_disabled'
    host = os.getenv('REPAIDO_SMTP_HOST', '').strip()
    username = os.getenv('REPAIDO_SMTP_USERNAME', '')
    password = os.getenv('REPAIDO_SMTP_PASSWORD', '')
    port = os.getenv('REPAIDO_SMTP_PORT', '')
    if not all((host, username, password, port)):
        return None, 'smtp_configuration_missing'
    if (not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.\-]{0,252}', host) or any(c in username for c in '\r\n\x00')
            or len(username) > 254 or port not in ('465', '587')
            or os.getenv('REPAIDO_SMTP_FROM', SENDER).casefold() != SENDER):
        return None, 'smtp_configuration_invalid'
    origin = _origin()
    if not origin:
        return None, 'app_origin_missing_or_invalid'
    return SMTPSettings(host, int(port), username, password, origin), None


def readiness():
    settings, reason = _settings()
    return dict(enabled=os.getenv('REPAIDO_TRANSACTIONAL_EMAIL_ENABLED', '').lower() == 'true',
                ready=settings is not None, reason=reason, sender=SENDER,
                transport='TLS SMTP', acceptance_is_delivery=False)


def initialize(core):
    if core.USE_FIRESTORE:
        return
    with core.db() as conn:
        conn.execute("CREATE INDEX IF NOT EXISTS operation_mail_queue_sort ON operation_records(json_extract(body,'$.sortKey')) WHERE kind='transactional_mail_queue'")
        conn.execute("CREATE INDEX IF NOT EXISTS operation_mail_fanout_queue_sort ON operation_records(json_extract(body,'$.sortKey')) WHERE kind='transactional_mail_fanout_queue'")


def _digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def _payload(kind, payload):
    if not isinstance(payload, dict):
        fail('MAIL_PAYLOAD_INVALID', 'Use a saved record reference for account email.', 422)
    allowed = {'challenge_id'} if kind == 'email_verification' else {'record_type', 'record_id', 'path'}
    if set(payload) - allowed:
        fail('MAIL_PAYLOAD_INVALID', 'Account email contains only a saved record reference.', 422)
    for key, value in payload.items():
        if key == 'path':
            _safe_path(value)
        elif not isinstance(value, str) or not _ID.fullmatch(value):
            fail('MAIL_PAYLOAD_INVALID', 'Use a valid saved record reference.', 422)
    if kind == 'email_verification' and set(payload) != {'challenge_id'}:
        fail('MAIL_PAYLOAD_INVALID', 'An email ownership challenge is required.', 422)
    return dict(payload)


def _safe_path(value):
    if not isinstance(value, str) or len(value) > 1200 or any(c in value for c in '\r\n\x00\\'):
        fail('MAIL_DESTINATION_INVALID', 'Use an authenticated app destination.', 422)
    parsed = urlsplit(value)
    if (not value.startswith('/') or value.startswith('//') or parsed.scheme or parsed.netloc or parsed.fragment
            or not re.fullmatch(r'/[A-Za-z0-9/_\-]*', parsed.path)
            or any(key not in _QUERY_KEYS or not _ID.fullmatch(item) for key, item in parse_qsl(parsed.query, keep_blank_values=True))):
        fail('MAIL_DESTINATION_INVALID', 'Use an authenticated app record destination without credentials.', 422)
    return urlunsplit(('', '', parsed.path, parsed.query, ''))


def _contact(u, uid, kind, payload):
    """The account module owns verified identity/contact provenance."""
    import account_profile
    if kind == 'email_verification':
        return account_profile.verification_delivery(u, uid, payload['challenge_id'])
    return account_profile.transactional_email_recipient(u, uid)


def _verification_link(value, challenge, origin):
    if not isinstance(value, str) or len(value) > 2000:
        return None
    parsed = urlsplit(value)
    if (urlunsplit((parsed.scheme, parsed.netloc, '', '', '')) != origin
            or parsed.path != '/' or parsed.query != 'view=account'
            or not parsed.fragment.startswith('email-verification=')):
        return None
    try:
        encoded = parsed.fragment.split('=', 1)[1]
        decoded = json.loads(base64.urlsafe_b64decode(encoded + '=' * (-len(encoded) % 4)))
        if (set(decoded) != {'challenge_id', 'token'} or decoded['challenge_id'] != challenge
                or not re.fullmatch(r'[A-Za-z0-9_\-]{32,200}', decoded['token'])):
            return None
    except (ValueError, TypeError, KeyError):
        return None
    return value


def _resolve(u, row, now):
    try:
        contact = _contact(u, row['recipient_id'], row['kind'], row['payload'])
    except Exception:
        # Resolver/provider exception text may contain addresses or credentials.
        return None, 'recipient_lookup_unavailable'
    if not contact:
        return None, 'challenge_obsolete' if row['kind'] == 'email_verification' else 'verified_email_required'
    email = _email(contact.get('email'))
    version = contact.get('email_version', contact.get('version'))
    if not email or type(version) is not int or version < 1 or contact.get('disabled'):
        return None, 'verified_email_required'
    result = dict(email=email, fingerprint=_digest(email + ':' + str(version)))
    if row['kind'] == 'email_verification':
        if not isinstance(contact.get('expires_at'), (int, float)) or contact['expires_at'] <= now:
            return None, 'challenge_obsolete'
        link = _verification_link(contact.get('link'), row['payload']['challenge_id'], _origin())
        if not link:
            return None, 'verification_link_unavailable'
        result['link'] = link
    elif contact.get('email_verified') is not True:
        return None, 'verified_email_required'
    return result, None


def _save(u, row):
    u.put('transactional_mail_delivery', row['id'], row)
    due = (row.get('lease_until', 0) if row['status'] in ('leased', 'sending')
           else row.get('next_attempt_at', 0) or row['created_at']) if row['status'] not in TERMINAL else 0
    if row['status'] not in TERMINAL and due <= 0:
        due = row['created_at']
    u.put('transactional_mail_queue', row['id'], dict(id=row['id'], sortKey=f'{max(0, int(due * 1000)):013d}:{row["id"]}'))


def _event(u, event_id, kind, recipient_ids, payload, bound):
    if not isinstance(event_id, str) or not _ID.fullmatch(event_id) or not re.fullmatch(r'[a-z][a-z0-9_]{0,63}', str(kind)):
        fail('MAIL_EVENT_INVALID', 'Use a saved server event for transactional email.', 422)
    payload = _payload(kind, payload)
    if not isinstance(recipient_ids, (list, tuple)):
        fail('MAIL_RECIPIENTS_INVALID', 'Use bounded saved account recipients.', 422)
    recipient_ids = [uid for uid in recipient_ids if uid is not None]
    if (len(recipient_ids) > bound
            or any(not isinstance(uid, str) or not _ID.fullmatch(uid) for uid in recipient_ids)):
        fail('MAIL_RECIPIENTS_INVALID', 'Use bounded saved account recipients.', 422)
    return payload, list(dict.fromkeys(recipient_ids))


def _enqueue_rows(u, event_id, kind, recipient_ids, payload, now, expires_at, contacts=None):
    settings, blocked = _settings(); result = []
    fingerprint = _digest(json.dumps(dict(kind=kind, payload=payload), sort_keys=True, separators=(',', ':')))
    for uid in dict.fromkeys(recipient_ids):
        key = _digest(event_id + ':' + kind + ':' + uid)
        old = u.get('transactional_mail_delivery', key)
        if old:
            if old['fingerprint'] != fingerprint:
                fail('MAIL_EVENT_REUSED', 'The saved email event has different record details.', 409)
            result.append(dict(id=key, status=old['status'])); continue
        row = dict(id=key, event_id=event_id, kind=kind, recipient_id=uid, payload=payload, fingerprint=fingerprint,
                   status='blocked' if blocked else 'pending', reason=blocked, created_at=now,
                   expires_at=expires_at, attempts=0, lease_until=0, lease_token='', next_attempt_at=now,
                   message_id=f'<{key}@repaido.com>')
        contact, reason = _resolve(u, row, now)
        expected = contacts.get(uid) if contacts is not None else None
        if expected:
            row['contact_fingerprint'] = expected
        if expected and contact and contact['fingerprint'] != expected:
            row.update(status='skipped', reason='account_contact_changed')
        elif contact and not expected:
            row['contact_fingerprint'] = contact['fingerprint']
        elif not contact and not blocked:
            row.update(status='blocked', reason=reason)
        _save(u, row); result.append(dict(id=key, status=row['status']))
    return dict(deliveries=result)


def enqueue(u, event_id, kind, recipient_ids, payload):
    """Idempotently queue a saved server event for its actual participants."""
    payload, recipient_ids = _event(u, event_id, kind, recipient_ids, payload, MAX_RECIPIENTS)
    now = time.time()
    return _enqueue_rows(u, event_id, kind, recipient_ids, payload, now, now + MAX_AGE_SECONDS)


def _save_fanout(u, row):
    u.put('transactional_mail_fanout', row['id'], row)
    due = row.get('next_attempt_at', row['created_at']) if row['status'] == 'pending' else 0
    u.put('transactional_mail_fanout_queue', row['id'], dict(id=row['id'], sortKey=f'{max(0, int(due * 1000)):013d}:{row["id"]}'))


def enqueue_fanout(u, event_id, kind, recipient_ids, payload):
    """Save a large material event in two writes; the worker expands its recipients.

    Only immutable saved participant IDs and contact-version hashes are retained.
    Source commands remain atomic without hundreds of per-recipient writes.
    """
    payload, recipient_ids = _event(u, event_id, kind, recipient_ids, payload, MAX_FANOUT_RECIPIENTS)
    if kind == 'email_verification':
        fail('MAIL_EVENT_INVALID', 'Email ownership challenges use their individual delivery record.', 422)
    recipient_ids = sorted(recipient_ids)
    if not recipient_ids:
        return dict(fanout_id=None, status='complete', recipient_count=0, expanded_count=0)
    key = _digest(event_id + ':' + kind + ':fanout')
    fingerprint = _digest(json.dumps(dict(kind=kind, payload=payload, recipients=recipient_ids), sort_keys=True, separators=(',', ':')))
    old = u.get('transactional_mail_fanout', key)
    if old:
        if old['fingerprint'] != fingerprint:
            fail('MAIL_EVENT_REUSED', 'The saved email event has different participants or record details.', 409)
        return dict(fanout_id=key, status=old['status'], recipient_count=len(old['recipients']), expanded_count=old['expanded_count'])
    now = time.time(); recipients = []
    u.prefetch([('account_contacts', uid) for uid in recipient_ids])
    for uid in recipient_ids:
        contact, reason = _resolve(u, dict(recipient_id=uid, kind=kind, payload=payload), now)
        recipients.append(dict(id=uid, contact_fingerprint=contact['fingerprint'] if contact else None))
    row = dict(id=key, event_id=event_id, kind=kind, payload=payload, recipients=recipients,
               fingerprint=fingerprint, status='pending', expanded_count=0, created_at=now,
               expires_at=now + MAX_AGE_SECONDS, next_attempt_at=now)
    _save_fanout(u, row)
    return dict(fanout_id=key, status='pending', recipient_count=len(recipients), expanded_count=0)


def _expand_fanout(u, key, now):
    """One transactional cursor step, at most 42 writes including the cursor."""
    row = u.get('transactional_mail_fanout', key)
    if not row or row['status'] != 'pending' or row.get('next_attempt_at', 0) > now:
        return 0
    if row['expires_at'] <= now:
        row.update(status='skipped', reason='event_expired'); _save_fanout(u, row); return 0
    start = row['expanded_count']; batch = row['recipients'][start:start + FANOUT_BATCH]
    ids = [entry['id'] for entry in batch]
    u.prefetch([('account_contacts', uid) for uid in ids] +
               [('transactional_mail_delivery', _digest(row['event_id'] + ':' + row['kind'] + ':' + uid)) for uid in ids])
    _enqueue_rows(u, row['event_id'], row['kind'], ids, row['payload'], row['created_at'], row['expires_at'],
                  {entry['id']: entry.get('contact_fingerprint') for entry in batch})
    row['expanded_count'] = start + len(batch)
    row.update(status='complete' if row['expanded_count'] == len(row['recipients']) else 'pending', next_attempt_at=now)
    _save_fanout(u, row)
    return len(batch)


def _claim(u, key, now):
    row = u.get('transactional_mail_delivery', key)
    if not row or row['status'] in TERMINAL or row.get('lease_until', 0) > now or row.get('next_attempt_at', 0) > now:
        return None
    if row['status'] == 'sending':
        row.update(status='needs_review', reason='smtp_acceptance_unknown_after_interruption', lease_until=0, lease_token='')
        _save(u, row); return None
    if row['expires_at'] <= now:
        row.update(status='skipped', reason='event_expired', lease_until=0, lease_token=''); _save(u, row); return None
    settings, reason = _settings()
    if not settings:
        row.update(status='blocked', reason=reason, next_attempt_at=now + 300, lease_until=0, lease_token=''); _save(u, row); return None
    contact, reason = _resolve(u, row, now)
    if not contact:
        row.update(status='skipped' if reason == 'challenge_obsolete' else 'blocked', reason=reason,
                   next_attempt_at=now + 300, lease_until=0, lease_token=''); _save(u, row); return None
    if row.get('contact_fingerprint') and row['contact_fingerprint'] != contact['fingerprint']:
        row.update(status='skipped', reason='account_contact_changed', lease_until=0, lease_token=''); _save(u, row); return None
    if row['attempts'] >= MAX_ATTEMPTS:
        row.update(status='failed', reason='retry_exhausted', lease_until=0, lease_token=''); _save(u, row); return None
    row.update(status='leased', reason=None, attempts=row['attempts'] + 1, contact_fingerprint=contact['fingerprint'],
               lease_until=now + LEASE_SECONDS, lease_token=str(uuid.uuid4()))
    _save(u, row)
    return row


def _before_data(u, key, lease, now):
    row = u.get('transactional_mail_delivery', key)
    if not row or row['status'] != 'leased' or row.get('lease_token') != lease or row['lease_until'] <= now:
        return None
    contact, reason = _resolve(u, row, now)
    if row['expires_at'] <= now or not contact or contact['fingerprint'] != row['contact_fingerprint']:
        row.update(status='skipped', reason='recipient_or_challenge_changed', lease_until=0, lease_token='')
        _save(u, row); return None
    row.update(status='sending', smtp_started_at=now, lease_until=now + LEASE_SECONDS)
    _save(u, row)
    return row, contact


def message(row, contact, settings):
    title, body = _KINDS.get(row['kind'], ('Repaido account update', 'A saved account or work record has an update. Sign in to Repaido to review the details.'))
    if row['kind'] == 'email_verification':
        link, button = contact['link'], 'Verify email address'
    else:
        payload = row['payload']
        params = dict(view=payload.get('record_type', 'account'))
        if payload.get('record_id'):
            params['reference'] = payload['record_id']
        path = payload.get('path') or '/?' + urlencode(params)
        link, button = settings.origin + _safe_path(path), 'Open Repaido securely'
    mail = EmailMessage()
    mail['From'] = 'Repaido Support <' + SENDER + '>'
    mail['To'] = contact['email']
    mail['Reply-To'] = SENDER
    mail['Subject'] = title
    mail['Date'] = formatdate(row['created_at'], usegmt=True)
    mail['Message-ID'] = row['message_id']
    mail['Auto-Submitted'] = 'auto-generated'
    mail.set_content(f'Repaido\n\nHello,\n\n{body}\n\n{button}: {link}\n\nNeed help? Contact {SENDER}.\n\nThis is a transactional update for your Repaido account. Private records require sign-in.\n')
    mail.add_alternative(f'''<!doctype html><html lang="en"><body style="margin:0;background:#f3f6f8;color:#182b3a;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 12px"><table role="presentation" width="560" style="max-width:100%;background:white;border:1px solid #dce5eb;border-radius:16px" cellspacing="0" cellpadding="24"><tr><td style="background:#102b42;color:white;font-size:24px;font-weight:bold">Repaido</td></tr><tr><td><h1 style="font-size:22px;line-height:1.4">{escape(title)}</h1><p>Hello,</p><p style="line-height:1.7">{escape(body)}</p><p style="padding:12px 0"><a href="{escape(link, quote=True)}" style="display:inline-block;background:#174e73;color:#fff;padding:14px 22px;border-radius:8px;text-decoration:none;font-weight:bold">{escape(button)}</a></p><p style="font-size:13px;line-height:1.6;color:#516675">Private records require sign-in. Need help? Contact {SENDER}.</p></td></tr><tr><td style="border-top:1px solid #e2e9ef;font-size:12px;color:#516675">A transactional update for your Repaido account.</td></tr></table></td></tr></table></body></html>''', subtype='html')
    return mail


def _finish(u, key, lease, state, reason, now):
    row = u.get('transactional_mail_delivery', key)
    if not row or row.get('lease_token') != lease or row['status'] not in ('leased', 'sending'):
        return False
    if state in ('retry', 'blocked') and row['attempts'] >= MAX_ATTEMPTS:
        state, reason = 'failed', 'retry_exhausted'
    row.update(status=state, reason=reason, lease_until=0, lease_token='')
    if state in ('retry', 'blocked'):
        row['next_attempt_at'] = now + min(3600, 30 * 2 ** (row['attempts'] - 1)) + int(key[:2], 16) % 17
    if state == 'accepted':
        row['accepted_at'] = now
    _save(u, row)
    return True


def _smtp(core, row, settings):
    client = None; data_started = False
    try:
        context = ssl.create_default_context()
        client = (smtplib.SMTP_SSL(settings.host, settings.port, timeout=SMTP_TIMEOUT, context=context)
                  if settings.port == 465 else smtplib.SMTP(settings.host, settings.port, timeout=SMTP_TIMEOUT))
        client.ehlo()
        if settings.port == 587:
            client.starttls(context=context); client.ehlo()
        client.login(settings.username, settings.password)
        prepared = core.operations_store.run(lambda u: _before_data(u, row['id'], row['lease_token'], time.time()))
        if not prepared:
            return 'skipped', 'recipient_or_claim_changed'
        saved, contact = prepared
        mail = message(saved, contact, settings)
        data_started = True
        refused = client.send_message(mail, from_addr=SENDER, to_addrs=[contact['email']])
        if refused:
            codes = [value[0] for value in refused.values()]
            return ('retry', 'smtp_temporarily_rejected') if all(400 <= code < 500 for code in codes) else ('failed', 'smtp_recipient_rejected')
        return 'accepted', None
    except smtplib.SMTPAuthenticationError:
        return 'blocked', 'smtp_authentication_unavailable'
    except (smtplib.SMTPNotSupportedError, ssl.SSLCertVerificationError):
        return 'blocked', 'smtp_tls_unavailable'
    except smtplib.SMTPRecipientsRefused as error:
        codes = [value[0] for value in error.recipients.values()]
        return ('retry', 'smtp_temporarily_rejected') if codes and all(400 <= code < 500 for code in codes) else ('failed', 'smtp_recipient_rejected')
    except smtplib.SMTPResponseException as error:
        return ('retry', 'smtp_temporarily_rejected') if 400 <= error.smtp_code < 500 else ('failed', 'smtp_rejected')
    except Exception:
        return ('needs_review', 'smtp_acceptance_unknown') if data_started else ('retry', 'smtp_connection_unavailable')
    finally:
        if client:
            try:
                client.close()
            except Exception:
                pass


def _due_refs(u, kind, now, limit):
    indexes = {'transactional_mail_queue': 'operation_mail_queue_sort',
               'transactional_mail_fanout_queue': 'operation_mail_fanout_queue_sort'}
    if kind not in indexes:
        raise ValueError('Unsupported email due queue')
    floor, ceiling = '0000000000001:', f'{int(now * 1000):013d}:~'
    if u.tx is not None:
        query = u.core.fs_collection('ops_' + kind).where('sortKey', '>=', floor).where('sortKey', '<=', ceiling).order_by('sortKey').limit(limit)
        return [snapshot.to_dict() for snapshot in query.stream(transaction=u.tx)]
    # SQLite otherwise prefers the broad kind primary-key range and sorts all
    # recipients. Only these fixed queue/index names can enter this statement.
    sql = f"SELECT body FROM operation_records INDEXED BY {indexes[kind]} WHERE kind='{kind}' AND json_extract(body,'$.sortKey')>=? AND json_extract(body,'$.sortKey')<=? ORDER BY json_extract(body,'$.sortKey') LIMIT ?"
    return [json.loads(item['body']) for item in u.conn.execute(sql, (floor, ceiling, limit))]


def dispatch(core, limit=20):
    limit = max(1, min(int(limit), 40)); started = time.monotonic(); now = time.time()
    fanouts = core.operations_store.run(lambda u: _due_refs(u, 'transactional_mail_fanout_queue', now, 1))
    expanded = sum(core.operations_store.run(lambda u: _expand_fanout(u, reference['id'], time.time())) for reference in fanouts)
    refs = core.operations_store.run(lambda u: _due_refs(u, 'transactional_mail_queue', time.time(), limit))
    result = dict(**readiness(), fanout_expanded=expanded, scanned=len(refs), attempted=0, accepted=0, retry=0, blocked=0, failed=0, skipped=0, needs_review=0)
    for reference in refs:
        if time.monotonic() - started >= DISPATCH_SECONDS:
            break
        row = core.operations_store.run(lambda u: _claim(u, reference['id'], time.time()))
        if not row:
            continue
        settings, reason = _settings()
        if not settings:
            state = 'blocked'
        else:
            result['attempted'] += 1
            state, reason = _smtp(core, row, settings)
        core.operations_store.run(lambda u: _finish(u, row['id'], row['lease_token'], state, reason, time.time()))
        result[state] += 1
    return result
