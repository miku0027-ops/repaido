# Office cash salary and live pilot setup

The owner chose salary payments in cash from the company office and confirmed
that INR 7,000 is available and reserved for the selected rider's October salary.
This supports current-month salary coverage. It does not establish that the rider
has received salary.

Salary policy now records the preferred payment method and cash collection
point. Company staff can record a completed office cash handover with its actual
receipt and evidence. The rider confirms receipt separately. Cash and bank
payments share the existing normalized reference and monthly-obligation guards;
changing the method on a retry cannot relabel a prior payment. Older bank
records and clients retain their retry behavior.

Company and rider interfaces distinguish office cash from bank transfers.
Changing handover details clears the company acknowledgement. Fare cash and
salary receipts remain separate. Runtime readiness changes now refresh in an
open policy editor without requiring a ride-policy version increment; unsaved
fare edits remain intact.

## Explicit native maintenance

`scripts/activate-bike-office-cash.py` is an operator-only Cloud Shell program,
not an application HTTP endpoint. Cloud IAM authorizes Firestore access; the
active Cloud Shell account is the recorded maintenance actor. It starts no
server, impersonates no Firebase account and grants no roles.

It verifies the recorded live API promotion and private worker pool, reads only
the actual serving route/quota secret bindings into process memory, and invokes
the existing payroll and bike-policy handlers in one native transaction. All
their approval, document, compensation, funding, route and dispatch gates run.
The statement confirming an office cash reserve is saved with an internally
created reserve reference; it is not presented as a bank transaction or a cash
handover receipt.

The program is restricted to the delegated saved Balasore centre and 8 km
operating circle, 4 km trip/pickup limits, the selected rider/bike and October
2026. Its original mode enrolls one rider with INR 7,000. An explicit
`--preserve-saved-roster` mode retains the existing roster and requires its
expected active count and the full owner-confirmed reserve at INR 7,000 each,
within the existing three-rider limit. It preserves fares, tax/terms reviews, fixed campaign dates, other
accounts, plates, vehicle ownership and retained rides. Other current salary
obligations outside that roster, changed versions/area, an incompatible agreement or lost readiness
stop the transaction. The stored maintenance receipt makes retries idempotent;
partial payroll/activation changes roll back together. It creates no online
rider presence, GPS, salary handover or salary-paid record.

The refreshed private inventory showed ride policy version 3 and payroll
version 2, with two active riders, two October obligations, INR 7,000 coverage,
and payroll disabled. The owner subsequently confirmed that the full INR 14,000
is available and reserved at the office. The continuation uses that confirmation
and preserves both obligations. Prior funding reference, evidence, amount and
policy version are retained privately in the maintenance record; they are
excluded from the returned receipt. A higher existing reserve is never reduced.

The helper can configure this pilot against the already deployed compatible
dispatch schema. The new office-cash UI and explicit handover-method API require
the subsequent matching application release. Do not publish that website before
its API. The current application can continue serving rides during that release.

## Verification

- Full backend: 1,813 passed, 96 skipped, 21 existing SDK warnings. Native
  Firestore cases require a separate loopback emulator run.
- Cash salary and maintenance: 20 passed across SQLite and actual native
  Firestore, plus two concurrent-activation cases passed across both stores.
  Tests cover receipt ownership, shared cash/bank duplicate guards, legacy
  retries, exact funding, atomic rollback and no manufactured payment/presence.
- Web: 386 passed; TypeScript build check passed.
- Admin browser: 13 workflow groups passed, including explicit cash handover,
  bank compatibility, acknowledgement reset, current backend request schemas,
  private cash ledgers and 320–1440 px/200% light/dark WCAG checks.
- Launch checklist browser: six groups passed. The new same-version dispatch
  regression failed before the fix and passed afterwards.
- Saved-roster continuation: 30 passed, zero skipped across SQLite and the
  actual loopback Firestore emulator. This includes concurrent retries,
  unchanged salary obligations, retained funding evidence, and rollback for
  insufficient coverage, changed roster count/version, additional earned
  salaries, pending approval, higher existing coverage and lost dispatch.
  Records: `/tmp/repaido-native-recovery-_om7ae0d/verification.json`.

The native cash verification initially inherited a SQLite-only fixture despite
an emulator being present. The fixture now explicitly switches the real store
to a fresh emulator project before tests run; the native setup case also reads
back its committed Firestore policy document. No production mutation, physical
cash handover, real GPS or bank call was performed by these local tests.
