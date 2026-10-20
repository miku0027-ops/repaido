# Compatibility checkout recovery

The older booking payment endpoint previously created a new provider order on
each retry. A successful capture could then fail appointment allocation when
the slot filled. The application callback lost that attempt after a refresh.

This change reserves an account-bound idempotent intent before provider I/O.
A lost order response is looked up by its stable receipt; an uncertain POST is
never repeated. Checkout retains only account-scoped references and a digest in
browser storage, without address, phone, gateway signatures or credentials.
A retry checks the previous payment before opening another gateway.

Verified captures have durable recovery cases. Customers can choose another
available future appointment using the same capture, or explicitly request a
full refund when no booking was fulfilled. Native transactions serialize the
refund reservation and fulfillment; the paid booking and its fulfilled case
commit together. Provider settlement must match the exact saved payment,
currency, amount and receipt before a refund is reported complete. Lost refund
responses use GET reconciliation; failed or uncertain refunds retain a hold.

The private Bookings accordion provides status, appointment recovery, refund
confirmation and references. Unrelated accounts receive 404 for owned actions.
Lists use bounded account-bound keyset queries. The background recovery pass
checks at most four active cases with two concurrent workers and performs no
refund POST. Unpaid abandoned checkouts do not become a polling queue.

## Verification

- Full backend run: 1,801 passed, 61 skipped, 21 warnings. The warnings concern
  existing SDK deprecations; native tests use a separate explicit emulator run.
- Native Firestore run: 38 passed, 37 deselected, including 12 new recovery
  workflows and legacy capacity, idempotency and stale-payment guards.
- Web: 386 passed; TypeScript build check passed.
- Real HTTP browser: four workflow groups passed with the actual component,
  isolated API/database and a synthetic provider. This includes rescheduling,
  verified refund settlement, account isolation, 320px/200% dark reflow and axe
  WCAG checks. Screenshot inspection confirmed the compact disclosure layout.
- Two added input checks reject a whitespace-only address and an unconfigured
  provider before payment intents or provider requests are created.

The first mixed emulator run exposed a test scheduler starting before its
database fixture switched to Firestore. The scheduler override now applies
before TestClient startup; the subsequent native run passed. SDK contention
still returns a bounded retryable conflict instead of bypassing capacity.

## Scope and release limits

No real gateway charge/refund, customer notification, cloud record migration or
application deployment was performed by this verification. Existing payment
orders can acquire a recovery case when their proof is verified again; this
does not perform an unbounded migration of historical orders. Failed provider
refunds and ambiguous receipt lookups require reviewed support intervention.

The primary operational service booking flow and bike reservation protocol
remain separate. Worker startup and infrastructure activation are being
verified against the already deployed image before a later application batch.
