# Business and apartment accounts

The private workspace groups properties, staff, internal spending approvals,
maintenance reminders, and explicitly shared Repaido bookings/orders. It uses the
same authenticated transactional SQLite/Firestore store as operations.

## Roles and invitations

| Role | Read workspace | Request spending | Approve another member | Properties/calendar | Manage members |
| --- | --- | --- | --- | --- | --- |
| Owner | Yes | Yes | Yes | Yes | Yes |
| Manager | Yes | Yes | Yes | Yes | No |
| Staff | Yes | Yes | No | Complete assigned reminders | No |
| Viewer | Yes | No | No | No | No |

The creator is the immutable owner. An owner must invite a manager before their
own requests can be approved. Neither owner nor manager can approve their own
requests. Active members can read the shared property addresses, staff roster,
requests, and financial summaries; invitations should therefore be shared only
with people authorized to see the whole workspace.

Invitations are single-use, expire after 72 hours, and are stored by token hash.
The owner receives the code once and shares it manually. Repeating acceptance by
the same active member is safe. Owners can revoke unused codes or immediately
revoke a member. Member changes require the current version and cannot remove or
demote the owner. No email or message is sent by this module.

## Approval and native-record sharing

A request records the property, intended date, category, estimated amount, and
reason. Approval atomically reserves that estimate against the property's budget
for the intended date's calendar month. Concurrent approvals cannot overspend
that allowance. Zero budget permits no approvals. An approved request retains
its reservation until the requester cancels it before linking; linked requests
retain their audit history and reservation. Reducing a budget below current or
future approved commitments is rejected.

Internal approval does **not** create a booking, purchase stock, accept a native
quote, transfer funds, or grant access to native customer actions. The requester
continues through the existing booking/checkout flow, then explicitly links a
record owned by their authenticated identity. The record type must match the
approved category and its current quoted amount must fit the approval. Home
quotes include all periods and GST in this comparison. A native record can
belong to only one workspace request. Individual Home visits cannot be linked
separately from their plan.

Sharing persists in the workspace if the requester leaves. Other members receive
a limited financial projection, not the record's phone, private instructions,
payment credentials, or authority to alter it. Ownership is rechecked whenever
the statement is read; a missing/transferred source is marked unavailable.

These are internal procurement controls around explicitly linked records. Native
booking and checkout remain customer-authorized workflows. Later changes to
native scope or price are not intercepted by this module; the statement flags
issued totals above the original internal approval. Reapproval/change-order
enforcement inside all native purchase flows is a future integration.

## Calendar and consolidated statement

Managers schedule one-time or monthly recurring maintenance reminders and assign
them to an active staff member or manager. Only an assignee or manager can
complete a reminder. Completion stores the actor, timestamp and note, and creates
one next occurrence transactionally. Month-end recurrence retains the series day
(January 31 → February 28/29 → March 31). A reminder is a planning record; marking
it complete does not complete or charge a booking. There is no automatic dispatch
or external calendar synchronization. An owner or manager can cancel an open
reminder with a reason to stop that recurring series while preserving its history.

The workspace statement and CSV derive financial rows from authoritative records:

- Service jobs contribute an existing native invoice, with verified final and
  allocated parts collections counted once against its full amount. Before an
  invoice exists, actual captured advances appear as payment receipts. Parts
  refunds reduce confirmed net payments, even when a job's payment label is stale.
- Home plans contribute native ready monthly statements for the completed scope,
  including allocated advances in both the gross amount and recorded payments.
  Earlier advance receipts are folded into the period statement to avoid double
  counting. Accruing estimates and individual visits are excluded as invoices.
  Unallocated captured funds remain separate receipts under reconciliation.
- Contracts contribute confirmed gateway collections or independently verified
  external transfers. Unverified transfer reports and payment requests contribute
  no confirmed amount.
- Shop orders contribute an existing verified paid order with a payment ID.
  An unpaid checkout contributes no receipt. Verified partial and full refunds
  reduce the recorded net payments while preserving the original receipt.

Amounts are integer paise. Issued/receipt totals, confirmed net payments, known
refunds, outstanding issued amounts, and remaining internal estimates are shown
separately. A refund or reconciliation review does not automatically create a
new amount due. This consolidation is a service/receipt statement, not a new GST
tax invoice, a payment provider, or a single combined checkout. Original native
records retain their own payment and supplier tax-document workflows. CSV export
requires membership and escapes potential spreadsheet formulas.

## Integration and validation

Register `business_accounts.install(sys.modules[__name__])` in `backend/main.py`
after operations initialization and include `business_accounts.py` in the backend
Dockerfile. Render `BusinessAccounts` from the account/More navigation. Its API
prefix is `/operations/business-accounts`; the web client uses the existing
`/api/operations` proxy and authenticated `operation` helper.

All account data uses account-scoped collections. A per-user membership index
drives the account list. Native jobs, Home plans and retail orders use existing
customer lookups; contract discovery uses scoped customer/owner equality queries.
Payment reads are scoped to linked jobs, capped at 500 records per job with an
explicit error on overflow. Home statement calculation reuses those scoped rows
instead of scanning unrelated payment records for each visit.
No new payment credentials, provider configuration or scheduler is required.
Supported limits are 50 accounts per user, 100 members and properties per account,
2,000 requests and maintenance occurrences, and 500 invitation records. Reaching
a limit returns an explicit error rather than silently dropping financial data.

Run focused checks with:

```sh
cd backend
.venv/bin/pytest -q test_business_accounts.py
cd ../web
node_modules/.bin/tsc -b
```

The HTTP suite covers access isolation, invite hashing/expiration/revocation,
stale member changes, independent approval, concurrent budget limits, native
ownership and link uniqueness, allocated advances and refunds, incomplete native
invoice records, CSV escaping, Home invoice deduplication, and recurring reminder
completion races.

The isolated browser harness checks role permissions, request/decision payloads,
record linking, maintenance cancellation, identity changes, financial-record
labels, mobile widths, and axe accessibility. With the normal Vite dev server
running on port 5192:

```sh
BUSINESS_TEST_ORIGIN=http://127.0.0.1:5192 node web/tests/business-accounts.browser.mjs
```

The test harness supplies fixtures only on its dedicated preview route; production
workspace data always comes from the authenticated API.
