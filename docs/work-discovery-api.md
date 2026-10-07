# Repaidians work discovery

The work API reads native project, tender, reviewed contractor and accepted team
records. It contains no starter jobs, fictional organizations, inferred profile
views or synthetic placements. Signed requests use the existing community actor
and active trial/membership check for discovery. Preference GET/PATCH remain
available to signed accounts after expiry so they can revoke disclosure,
personalization and update consent; this preserves the original trial and never
grants new access. Account responses send `Cache-Control:
no-store`; browser caches must partition by authenticated account and clear on
sign-out and preference changes.

## Routes

| Route | Result / command |
| --- | --- |
| `GET /repaidians/work/preferences` | `{preferences}` with four booleans |
| `PATCH /repaidians/work/preferences` | Partial `personalizedDiscovery`, `contractUpdates`, `sharePlacements`, `shareSalary`; all default false |
| `GET /repaidians/work/interests` | `{trades:[{trade,weight,reason}],personalized}` |
| `POST /repaidians/work/behavior` | `{eventId:UUID,trade,type,query?,sourceId?}`; type `search`, `view`, `save`, `apply`; account-scoped replay protection |
| `GET /repaidians/work/jobs` | `{items,nextCursor,personalized,preferences,rankingScope:"page",rankingVersion:"work-v2"}` |
| `GET /repaidians/work/contracts` | `{items,nextCursor,personalized,preferences}` with native safe public tender summaries, watched flag, trade and match reasons |
| `GET /repaidians/work/contracts/{id}/watch` | `{watched}`; unavailable sources return 404 |
| `PUT /repaidians/work/contracts/{id}/watch` | `{active:boolean}` -> `{watched}`; enabling requires explicit contract-update consent |
| `GET /repaidians/companies` | `{items,nextCursor}` from live reviewed registered contractor profiles |
| `GET /repaidians/companies/{id}` | `{company,jobs,connections}`; connections require a live relationship and placement-sharing consent |
| `GET /repaidians/placements/{id}` | Consented accepted placement, safe project identity and public member profile; salary is omitted unless independently opted in |
| `POST /repaidians/placements/{id}/congratulate` | `{clientId:UUID,message:"congratulations"|"good_luck"|"well_deserved"}`; one durable congratulations per sender and placement |

Jobs filters: `trade`, `sector` (business industry), `city`, `query` (whole indexed terms),
`minimumPayPaise`, `experience` (applicant years), `workType`
(`all`, `project`, `private_request`), `closesWithinDays` (`0`, `7`, `30`),
`cursor`, `limit` (1–30). Contract/company filters are trade/city/query/cursor/
limit. Job/contract cursors bind account, normalized filters, profile fingerprint,
personalization consent, behavioral revision and ranking version, and advance over unavailable
records within a strict scan bound. Job card `deadline`, `startsAt`, `endsAt` are
milliseconds; nested native `details.hiring.deadline` and project dates are
seconds. Contract filters also accept an independent `sector`. Sector/city lanes
apply exact normalized native industry matching; keyword query is never replaced
by an industry selection. A job's `openings` is remaining capacity. `application`, when present,
contains only this account's native application id and status.

Default jobs are restricted to profile trade/skills and recorded experience.
Explicit trade/search filters let a member explore a different field. Unrelated
jobs never pad an empty relevant result. Contractor authorization, remaining
places, notice status/deadline, role/experience requirements and both community
and network blocks are checked again from native sources. Private customer
projects require a server-owned phone-verification snapshot; clients cannot
create authorization through a discovery hint.

Hiring `work_trade` is a canonical worker category independent of the business
`sector`: for example, an Education-sector job can require an electrician.
`hiring_trade` resolves explicit work categories first, then specific legacy
skills/title and recognizable trade sectors. Unknown industries never become
spare-parts jobs. Versioned `work-trade-v2` background checkpoints repair older
audience lanes and legacy career references even when the original backfill was
marked complete; every migration reads the current native source in a bounded
transaction.

## Ranking and bounded state

The explainable `work-v2` job score uses trade .45, listed skill-token overlap .25,
profile city .15, experience .10 and optional trade/keyword interest .025 each. This is a
ranking signal within the bounded page, not a calibrated hiring probability or
a global top-N claim. Search lanes index up to eight normalized native title,
sector and skill terms. City and trade lanes avoid full collection scans.

Behavior recording requires `personalizedDiscovery`. Weights decay with a
14-day half-life, are capped at 30 per trade and retain at most 24 recent token
groups across eight supported trades. Searches weigh 1, views .25, saved work 2
and applications 3. Disabling personalization clears behavioral signal state.
Event replay references carry a 24-hour `expiresAt` value. Production should
enable Firestore TTL on `ops_rp_work_behavior_commands.expiresAt`; this is a
Timestamp in Firestore and an ISO timestamp in the local SQLite fixture.

## Integration

`repaidians_work.index_record(unit,kind,id,row)` belongs in the native `Unit.put`
hook for `contract_projects`, `contract_tenders`, `contract_profiles`,
`rp_members`, `workers`, `rp_follows`. Project writes enqueue one reference,
then workers process accepted seats and followers in bounded batches. Ready
member lanes support `candidate_keyset(unit,trade,city,after,limit)`; callers
still validate the live approved worker and current requirements. Native
application commands call `application_event(unit,application,project,event)`
after real audited lifecycle changes.

`initialize(core)` creates local sort/live-reference indexes. Background
`backfill(core,limit=10)` advances document-key migration checkpoints for old
native records, never inside a discovery request. `process_updates(core,limit=20)`
handles at most 20 project queues (10 accepted seats each), member sharing
queues (10 placements each), announcement queues (20 current followers each)
and subscribed recipients (32 watched contracts plus two eight-item relevant
trade lanes and two eight-item consented search-term lanes per recipient). Active-reference queries exclude completed
queue history. Durable cycling cursors and transaction-local latest state make
retries idempotent and prevent an inactive first page from starving later work.

Contract updates choose at most three **distinct contracts per recipient per
IST calendar day**, with the quota, seen fingerprint, community notification
and outbox committed together. They report actual published timeline/version
changes or approaching deadlines. Contract-update consent also permits
profile-relevant published work; recent searched keywords contribute only with
the separate personalization consent. Trade/keyword similarity and timeline
urgency choose within the bounded candidate set; explicitly unwatched contracts
are excluded from automatic updates. Placement
announcements require acceptance and member sharing consent, and reach only
current followers. Notification text never copies private site, offer terms or
salary. Salary is resolved independently when opening the placement.

The `rp_work_delivery` outbox contains `id`, `recipient_id`, `sender_id`,
`event`/`type`, `target_id`, `notification_id`, `delivery_status`, `created_at`,
`title`, `body`, plus application/project references for application updates.
`delivery_allowed(unit,row)` must run at dispatch time before sending any push
to registered devices, rechecking consent, blocks and live source ownership.
Push leases, retry/backoff and revoked-token handling belong in `work_push`.
Separate deployment boundaries and measured load evidence are documented by the
work-service deployment instructions; this implementation does not establish
10,000 or 100,000 requests per second capacity.

## Evidence

`backend/test_repaidians_work.py` exercises actual authenticated HTTP commands,
strict relevant/empty results, private-source authorization, account-bound
cursors, consent and replay, signal decay/bounds, concurrent three-contract
quotas, live source/privacy revocation, accepted placements, current followers,
congratulations, genuine company connections and native application view events.
Tests prohibit full collection scans on hot discovery/company/worker paths.
