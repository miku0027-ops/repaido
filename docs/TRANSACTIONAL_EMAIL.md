# Transactional email

Repaido queues account and work updates in the authoritative operation store and delivers them through TLS SMTP as **support@repaido.com**. Each recipient has a durable delivery record. Enqueueing an event does not send an email, and SMTP acceptance does not prove inbox delivery.

## Configuration

The mailbox provider must supply its SMTP hostname, port **465 (implicit TLS)** or **587 (STARTTLS)**, login username, and an SMTP/app password. Providers requiring OAuth without SMTP password authentication need a separate transport implementation. Configure the domain's SPF, DKIM and DMARC using that provider's actual instructions.

| Setting | Purpose |
| --- | --- |
| `REPAIDO_TRANSACTIONAL_EMAIL_ENABLED` | Explicit delivery switch; only `true` permits SMTP attempts. |
| `REPAIDO_SMTP_HOST` | Provider SMTP hostname. |
| `REPAIDO_SMTP_PORT` | `465` or `587`; plaintext transport is rejected. |
| `REPAIDO_SMTP_USERNAME` | Provider login username. |
| `REPAIDO_SMTP_PASSWORD` | Secret Manager reference for the SMTP/app password. |
| `REPAIDO_SMTP_FROM` | `support@repaido.com`; other senders are rejected. |
| `REPAIDO_PUBLIC_WEB_URL` | Public HTTPS app origin, such as `https://repaido.web.app`. |
| `REPAIDO_EMAIL_CHALLENGE_SECRET` | Separate random server secret of at least 32 bytes for email ownership challenges. |

The worker and API use the same origin and challenge secret. Certificate and hostname verification remain enabled. Credentials, recipients, message contents and provider error text are never logged by the mailer. Socket operations have a 15-second timeout; dispatch stops starting additional attempts after its 30-second budget.

## Reviewable Cloud Shell setup

Preview metadata and secret resource names without changing cloud resources:

```bash
bash scripts/configure-transactional-email.sh \
  --host SMTP_HOST_FROM_PROVIDER --port 465 \
  --username support@repaido.com
```

After reviewing the provider metadata, `--apply` creates/reuses two separate Secret Manager resources, grants only the API/worker runtime identities access to those secrets, and configures the API and private worker. An existing enabled SMTP password secret can be reused. If none exists, an interactive hidden prompt accepts the password, or `--password-file /private/path` passes an existing private file directly to Secret Manager. Never put the password in command arguments, source control, screenshots or chat. A strong challenge secret is generated only if no enabled version exists; its value is piped directly into Secret Manager. The script reads only version metadata, selects the newest **enabled** version and pins its numeric reference, so a disabled newer version cannot be selected through a `latest` alias.

Delivery remains disabled unless `--enable` is also supplied. Enabling permits the private worker to process all eligible queued events, so review pending events and use a controlled deployment/test recipient before enabling an existing production queue. This script configures Cloud Run revisions; it does not test a provider, send a test email, verify DNS, or claim that mail has reached an inbox.

## Integration contract

After `operations_store` is initialized, call `transactional_mail.initialize(core)` for the local queue index. The private Scheduler-authenticated worker calls `transactional_mail.dispatch(core, limit=20)`; business commands call only:

```python
transactional_mail.enqueue(
    u, saved_event_id, "contract_awarded", [customer_uid, contractor_uid],
    {"record_type": "contract", "record_id": saved_project_id,
     "path": "/worker?mode=contractor"},
)
```

`event_id`, kind, participant IDs and saved references come from authoritative commands. Each `(event_id, kind, recipient UID)` has one stable delivery ID and `Message-ID`. Exact retries reuse the row; changing its saved payload under the same event raises a conflict. Ordinary `enqueue` is bounded at 50 participants; callers should send only relevant participants and keep total command writes bounded. Missing optional/unassigned participants (`None`) are ignored.

Large material events such as a retail receipt with 100 actual supplier owners use `enqueue_fanout(u, event_id, kind, participant_ids, payload)`. It captures at most 1,000 saved participant IDs and contact-version hashes in one private fanout record plus one indexed queue row, requiring **two source-transaction writes**. The private worker expands one due fanout in batches of 20 recipients, with at most 42 writes per expansion transaction. The cursor and delivery rows commit together; concurrent workers and retries reuse the same per-recipient delivery IDs. Each expanded delivery retains the original event time, seven-day expiry and contact binding. Expansion does not send email or refresh expired events, and email ownership challenges continue to use individual delivery records.

Ordinary payloads permit only `record_type`, `record_id` and an optional validated same-origin app path. The mailer uses fixed branded text and escaped HTML rather than user-provided titles, site addresses, prices, bank details or private evidence. Passwords, SMS OTPs, sign-in bearer tokens and private proof cannot enter those payloads. Registration/login notices accept `{}` and link to the account page without exposing their event/session hashes.

`account_profile.transactional_email_recipient(u, uid)` resolves a current verified private contact with `{email, email_verified: True, version}`. Placeholder `@repaido.user`, missing/unverified addresses and disabled recipients do not receive ordinary mail. A verified source-time contact is bound immediately. If no verified contact existed when the event was saved, the same UID's later verified contact may be bound within the original seven-day expiry, allowing registration notices to wait for ownership verification. Once bound, the email/version fingerprint is checked again after SMTP authentication and immediately before sending; a changed contact retires that queued delivery. No email address is copied into the delivery outbox.

Email ownership verification is the narrow exception: kind `email_verification` carries only `{"challenge_id": saved_challenge_id}`. `account_profile.verification_delivery` checks the same UID, current email/version, challenge state and expiry and derives the one-use link transiently. Its fragment contains only the challenge ID and scoped verification token. The clear token/link is never persisted in the outbox or returned from the challenge-creation HTTP response. The app clears the fragment before analytics or subsequent navigation and requires the current signed account to confirm ownership. This link does not grant sign-in or disclose work records.

## Delivery states and recovery

| State | Meaning |
| --- | --- |
| `pending` | Saved event waiting for processing. |
| `blocked` | Sending disabled, incomplete configuration, missing verified recipient, or temporary authentication/TLS setup issue. |
| `leased` | One worker has claimed this recipient. |
| `sending` | Current contact/challenge rechecked; an SMTP exchange is beginning. |
| `retry` | Failure before DATA or explicit temporary SMTP rejection; retry time is persisted. |
| `accepted` | SMTP server acknowledged acceptance for this recipient. Inbox delivery is unknown. |
| `failed` | Permanent rejection or six attempts exhausted. |
| `skipped` | Event expired, contact changed, or challenge was revoked/consumed/expired. |
| `needs_review` | DATA result or an interrupted sending lease has an unknown acceptance outcome. Automatic resend stops. |

Claims last 120 seconds. Explicit transient failures use bounded exponential backoff with deterministic jitter, up to six attempts. Events expire after seven days; ownership challenges also retain their shorter canonical expiry. Queue queries select due active entries before applying their bound, so terminal records and future retries do not starve current events.

SMTP has no universal idempotency API. A stable `Message-ID` helps investigation but does not guarantee provider deduplication. A disconnect during DATA or crash after SMTP begins becomes `needs_review` when its lease expires. Review the provider's message trace before deciding whether to create a new authorized delivery event. Existing accepted/failed/review rows are never reset by replaying the original command. No public retry/admin endpoint is exposed by this module.

## Validation

`backend/test_transactional_mail.py` exercises real SQLite transactions with a fake SMTP transport: concurrent worker claims, idempotent enqueue, atomic 101-participant fanout and bounded concurrent expansion, SSL/STARTTLS ordering and certificate validation, escaped branded content, configuration/header injection rejection, backoff/exhaustion, permanent and ambiguous outcomes, changed accounts, revoked challenges, queue fairness, per-recipient state and log privacy. The setup script is tested with a fake `gcloud` executable to verify offline planning and secret references without exposing values. No live provider credentials or actual email delivery are required for this suite.
