# Refurbished inventory and Shop Prime

The Market has separate Buy Spares (new) and Refurbished sections. Both read only `/operations/products/catalog`; empty or failed responses never load sample inventory. Approved shops manage real inventory through the phone-authenticated Shop Partner workspace. Stock must be confirmed within 24 hours to appear publicly.

Refurbished stock requires shop-declared grade, cosmetic condition, inspection date and results, repairs, defects, accessories, warranty duration/terms, and return window/terms. Battery health is optional. Existing records without these structured fields retain their previously supplied text; customers see missing information explicitly and owners must complete disclosures when editing. Prime does not certify product inspections.

## Monthly membership

Shop Prime costs **149900 paise (₹1,499)** per calendar month, calculated in Asia/Kolkata from server activation. Month-end dates clamp to the last valid day of the next month. Renewal is manual after expiry; there is no automatic debit. Shop identity is derived from the phone-authenticated owner and approved shop record, never a browser-supplied shop ID.

Only a matching Razorpay order with the exact INR amount and an authenticated captured-payment response activates membership. One pending order is reused per shop, including after uncertain provider responses. Duplicate capture reconciliation does not extend membership. Any observed refund revokes that payment's benefits, and an old refund cannot revoke a later renewal. Suspended shops and expired memberships have no public badge or placement.

Public products and their shops expose `prime.active`, `prime.paid_placement`, and `prime.ends_at`. Featured results prioritize active Prime shops after category/search filtering. Explicit price, newest, and discount sorts retain their meaning. The UI labels the badge `Repaido Verified · Prime · paid` and explains the reviewed shop's paid membership separately from shop-declared inspection claims.

## Payment activation

The live integration status reported `payments: false` during implementation. The feature is deployed with checkout disabled until the existing payment integration is connected. Do not put keys in Git or chat.

Configure the existing backend secrets `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` through Secret Manager/Cloud Run, then enable `REPAIDO_PAYMENTS_ENABLED=true` after provider activation. Use the provider's matching live-mode credentials. Configure signed Razorpay captured-payment and refund webhooks at `https://repaido.web.app/api/operations/webhooks/razorpay/payments`.

The existing authenticated scheduler endpoint `/operations/internal/tick` consumes webhook events and reconciles orders, including Shop Prime records. Its existing `REPAIDO_SCHEDULER_AUDIENCE` and `REPAIDO_SCHEDULER_EMAIL` must be configured and Cloud Scheduler must invoke it regularly. Validate provider capture and refund reconciliation in a test environment before accepting live payments. Check `/api/operations/integrations/status` and the Shop Prime screen for availability; displaying a price is not evidence that live payments work.

No live purchase was made during implementation. Tests use an isolated database and stubbed gateway responses.
