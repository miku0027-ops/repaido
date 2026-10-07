# Customer contracts and shared work records

The customer home plus menu opens Repaidians, a private custom contract request, or the existing Quick Hire flow. Requirements are stored as normalized, bounded trade/city/skill facets. Candidate suggestions come from actual approved contractor records; scores explain the recorded match and do not claim a complete global ranking or infer undisclosed behavioral data.

Custom requests use the existing `contract_tenders` record. Proposals stay private to their customer and proposer. Long proposal text and immutable accepted terms use separate bounded documents; the tender retains compact bid summaries. Award atomically creates the canonical `contract_projects` record with its customer, winning contractor, scope and agreed value. Private requests cannot be resolved or shared through the ordinary opportunity feed. Contractor matching notifications use bounded indexed pages and a durable background cursor.

Customers can browse professional publications and portfolios and save public work. Canonical approved worker records authorize professional publishing, profile edits, networking and ordinary social interactions; a member-selected profile label, trial or paid receipt cannot grant that role. Private advertisement comments and owner engagement controls are separate from ordinary community comments. Customer-to-contractor messages and enquiries require award. The first-60-day nearby agent opening-message path additionally requires fresh consented location, a matching real opening and distance within 10 km. General trial messages to a contractor require an accepted professional connection.

Pre-award interests are intent receipts, not hires. Jobs, applications, invitations, joining offers and accepted teams use the existing shared hiring lifecycle. Vacancy counts use distinct accepted workers; pending offers reserve capacity separately. Offers and acceptances check the same capacity inside a transaction. Filling the team closes hiring, while project work status still follows actual start/pause/completion commands. Typed positions such as mistri, labour, wiring or cleaning are distinct from registered technician/specialist account roles.

## Progress and payments

Awarded project records are available under `/api/operations/contracts/projects/{id}/records`. The customer can see the agreed value, team, calendar, goals, updates, attendance source and a private payment ledger. Attendance is member-reported; it does not imply continuous GPS monitoring. Existing optional attendance/geofence consent remains authoritative.

Each partial payment request reserves integer paise against the agreed total. Confirmed payments plus outstanding reservations cannot exceed that total. Customer approval is required before creating a gateway order. Captures and refunds are applied only after authenticated provider retrieval, including in the existing signed webhook flow. Gateway collection proves collection by the platform; it does not prove contractor payout. An absent payout integration is reported explicitly.

NEFT/RTGS references and evidence remain pending until an authorized operator verifies them. Bank instructions require configured, server-owned beneficiary details. The application does not invent beneficiary accounts or banking thresholds. Operator verification is `POST /api/operations/contracts/admin/payments/{id}/verify-external`, guarded by the existing operator authentication, with verified reference, evidence reference and a review reason. Never use this operation to mark an unverified transfer paid.

Customers can download the current branded report after award or the saved report snapshot associated with a verified payment. Reports include agreed terms, deadlines, accepted team, milestones, reported progress series, payment status and remaining balance. Readable authorized images are embedded within a bounded report size; unavailable images and videos remain identified references. Reports are private contract records, not tax invoices or payout confirmations.

## Public progress

Public sharing defaults off. Only the customer owner controls the canonical project consent, and each uploader separately consents to sharing an update and its media. Revocation is checked live by project, contractor-history and media routes. Public views exclude customer identity, exact site, private proposals/messages, payment details and team attendance.

Anonymous read-only routes are `/api/operations/contracts/public/projects/{id}/progress` and `/api/operations/contracts/public/contractors/{id}/projects`. The profile directory reads project summaries without loading every timeline; selecting a project loads its complete shared history. Public media uses its dedicated validated attachment route. Private documents require the signed contract participant; browser transports reject external credential destinations, unexpected document types and results from an account that has changed.
