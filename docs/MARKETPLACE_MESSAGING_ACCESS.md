# Marketplace messaging and shared access

Development branch: `development/marketplace-messaging`. Release is a separate explicitly requested action; this work does not publish or change production credentials.

## User journeys

Both **Direct swap** and **Pre-owned** use one marketplace inbox. A buyer opens an available listing and selects **Message seller**. The server creates one conversation for that listing and buyer; repeatedly opening it returns the existing conversation. Sellers can open **Messages** or **View buyer messages** from their own listing. Buying, selling and unread filters, listing context, timestamps, read receipts and earlier-message pagination stay together.

People can send text, make a price offer for a second-hand item, or choose one of their own active exchange listings to propose a swap. The seller can accept or decline a proposal. Acceptance is an agreement to discuss that proposal; it does not collect money, reserve stock, complete a sale or confirm a handover. Exact payment and handover arrangements remain between the participants.

Blocking stops new messages from either participant in that conversation. Reporting remains available independently of paid access. Company administrators see a separate report queue with the referenced message excerpt, review notes and resolve/dismiss actions; they do not receive a general private-inbox browser. Contact details are removed from moderation excerpts and profile labels. There is no claim of end-to-end encryption, and this release does not add chat attachments, audio/video calls or live location sharing.

## One trial and one monthly plan

| Access | Behavior |
| --- | --- |
| Not started | Read-only status and browsing never start the trial. Explicit activation or the first successful eligible action starts it. |
| Trial | One 90-day period per account, shared across swaps, second-hand listings, contact and messaging. Both buyers and sellers have their own account period. |
| Paid | ₹99 (9,900 paise), INR, for one calendar month of shared access. Manual renewal; no automatic debit. |
| Expired | Browsing, earlier conversations, read receipts, blocking, reporting and closing a listing remain available. Publishing, new messages/offers, contact disclosure and radius changes require renewed access. |

Legacy accounts derive the earliest original marketplace trial/listing start instead of receiving another 90 days. The earlier 30-day exchange offer becomes part of this shared 90-day policy. Existing permanently paid listings retain their visibility rights, and reserved historical listing payments remain reconcilable. New listings have no additional percentage listing fee. Closed, suspended, refunded and payment-review listings never reopen merely because access is renewed.

Photo uploads require an eligible, phone-verified account. Missing storage, invalid image content and provider upload failures do not consume a trial. Successful upload acknowledgement and trial enrollment commit with the owned photo record. Listing submission still verifies photo ownership, explicit coordinates and seller consent.

## Message integrity and privacy

Each conversation has an atomic increasing sequence. Participant-bound command IDs and fingerprints make text and offer submissions safe to retry after a lost reply. A changed payload cannot reuse an earlier request ID. Replay checks run before current plan, block and availability checks, allowing an already committed message to be confirmed after circumstances change.

Read markers advance monotonically only through existing message sequences. Unread totals use transactional per-account counters, including messages beyond the first inbox page. Inbox pages are ordered by activity and ID; message pages use bounded point reads. Other accounts receive 404 for private conversations. Phone numbers, email addresses and precise item coordinates are absent from conversation/inbox responses and notification previews.

The web client keeps bounded private response caches and account/thread-scoped drafts. Pending sends retain their exact request while confirmation is uncertain. Only a visible foreground conversation polls for incremental updates, every five seconds; the inbox refreshes every fifteen seconds. Hidden/offline views pause. Receipts advance when the latest messages are actually visible. These are periodic updates rather than a WebSocket delivery guarantee, and “Read” is based on the persisted other-participant receipt.

New messages create generic notification records in the same server transaction. The existing configured delivery worker rechecks the recipient, blocking and read sequence before sending a generic push; the payload includes only routing metadata and a conversation ID. The notification drawer and `?market-chat=ID` route open the private conversation. Actual background delivery still depends on existing device registration and push configuration.

## Billing integrity

Checkout uses the existing Razorpay integration. A durable purchase request ID belongs to an account and maps to one payment attempt. Dismissal, lost order replies and lost capture/check replies do not create a new purchase. A later deliberate month purchase gets a new ID only after the previous captured/refunded outcome has been acknowledged.

Only authenticated provider reads can grant access. The server verifies order ownership, exact INR amount, capture state, receipt namespace and payment ID. Signed shared webhooks trigger provider reconciliation. A bounded worker reconciles only pending attempts, with a durable five-minute retry throttle and advancing cursors; captured orders are not repeatedly polled. Refund tombstones cannot be overwritten by stale capture events.

Paid periods use calendar-month boundaries in Asia/Kolkata and retain their individual payment provenance. Refunding one period does not erase another. If a new purchase fills an inactive refund gap, overlapping future unstarted periods move forward by complete calendar months, with their verified attempt records and audit events updated atomically. Already-started periods remain fixed, preserving the full paid time.

Native dialogs are temporarily removed from the browser top layer while the external checkout is open, so its controls remain usable. Connected dialogs and unfinished forms return after dismissal or confirmation. Switching accounts closes the checkout and ignores callbacks for the previous account.

## APIs and storage

All routes below are under `/api/operations` in the browser.

| Route | Purpose |
| --- | --- |
| `GET /market/access` | Read shared trial/paid state and provider readiness without enrollment |
| `POST /market/access/trial` | Explicit, idempotent enrollment |
| `POST /market/access/order` | Reserve/reuse a ₹99 order using `request_id` |
| `POST /market/access/check` | Reconcile the authenticated account's payment attempts |
| `GET, POST /market/chats` | Paginated inbox or listing conversation creation |
| `GET, POST /market/chats/{id}/messages` | Read paginated/incremental history or send text/offer |
| `POST /market/chats/{id}/read` | Advance an authorized read sequence |
| `POST /market/chats/{id}/offers/{message_id}` | Seller accept/decline decision |
| `POST /market/chats/{id}/block` | Block/unblock this conversation |
| `POST /market/chats/{id}/report` | Submit a participant concern |
| `GET /admin/market/chats/reports` | Authorized scoped report queue |
| `POST /admin/market/chats/reports/{id}/resolve` | Save an administrator's resolution and note |

The existing transactional operations store supports both SQLite and Firestore. This batch adds no always-running service or dependency. New record namespaces separate chats, messages, inbox rows, read/unread counters, command receipts, moderation reports, access trials, paid intervals, payment attempts and purchase IDs.

Deploy the two `ops_market_chat_inbox` composite indexes in `firestore.indexes.json` and wait until they are ready before switching production traffic to the new APIs. SQLite initialization adds the equivalent indexes. API changes, matching web assets and indexes belong in the same requested release batch. Existing payment and push secrets are reused; their production availability has not been exercised during development.

## Verification

Backend checks cover participant authorization, rate/phone/plan gates, message and purchase replay, gapless sequences, exact unread totals, cursor paging, safe notification dispatch, offer decisions, moderation, legacy migration, calendar months, refunds and scheduled reconciliation. Browser fixtures use native local APIs with synthetic identities, local image storage and a stubbed payment provider; they do not bypass application billing or messaging logic.

The native browser suite exercises both marketplace entry points, buyer/seller messages and offers, notifications, blocked/closed/expired history, account isolation, exact retry after a committed response is lost, accessible mobile layouts, and external-checkout dismissal/capture/refund recovery. Production latency, external provider availability and real-device background push still require release verification.
