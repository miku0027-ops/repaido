# Customer account journey

Customer sign-in now opens a separate mobile/Google choice, OTP verification,
profile and service-interest screen. Browsing does not require an account.
New Google identities link a phone using Firebase OTP before finishing setup.
Existing accounts retain Google or phone sign-in. Incomplete new accounts can
leave setup, keep browsing and resume from Home or Account & privacy.

The mobile UI uses original vector artwork with dimensional styling, short
transitions, a skippable home entrance and a dismissible welcome catalogue.
Reduced motion disables the decorative entrance and movement. Later setup
screens omit the mobile illustration to keep the current task in view.

## Account and phone requirements

`GET /account/onboarding` and `PUT /account/onboarding` use the authenticated
UID, private/no-store responses and UID-scoped idempotency receipts. The server
accepts verified Firebase phone claims, never a client-supplied verification
flag. Names, existing account email requirements and up to three valid catalogue
interests are checked before setup completes.

For newly provisioned identities, `account_creation_policy` is saved before the
user record. A pending Google identity may read/browse but cannot perform
commercial mutations until its phone is verified. Completing registration also
checks the phone claim. Legacy password registration is unavailable with the
production Firestore configuration. Existing user records are grandfathered;
accounts covered by the new policy still need verification if their phone is unlinked.

Firestore client creation of `users` documents is denied so a new identity cannot
pretend to be an existing account before its first API request. The API/Admin SDK
provisions users; existing owner updates remain allowed. Private policy,
contact and onboarding documents remain inaccessible to direct clients.

**Release together:** backend, web and `firestore.rules`. Publish the tightened
rules before enabling the new API/web flow. These local changes do not alter
production data, Firebase provider settings, live offers or outbound messages.

## Suggestions and offers

Explicit interests live in `customer_onboarding`, separate from observed events.
The primary choice leads the home/welcome catalogue and feeds existing discovery
and campaign ranking. Users can change or clear choices under Account & privacy.
The optional activity checkbox starts unchecked; enabling it uses existing
consented category/search/booking signals and completed spend. Disabling it
clears behavioral signals without inventing visits or enrolling marketing push.

Welcome offers come exclusively from the existing campaign engine. Expiry,
city, audience, per-user limits, budget, worker earnings and minimum margin
checks remain authoritative. Prices and savings are the engine's calculation;
the offer CTA carries the campaign into the existing booking flow, which checks
eligibility again. With no eligible offer, the welcome screen shows regular
services rather than an invented discount. No new production campaigns are
created by this feature.

## Verification

- 61 focused backend tests cover setup privacy, replay protection, phone gates,
  existing login, booking API behavior, discovery and funded offers.
- The full backend suite passes: 1,842 passed, 103 skipped.
- 398 frontend unit tests and the production build pass.
- `account-journey.browser.mjs` exercises the real HTTP API and UI with an
  isolated Firebase Auth SDK fixture. It covers both signup routes, existing
  Google login, invalid OTP, retries, editing, account changes and interrupted
  verification, plus the real App entry under React StrictMode.
- Automated WCAG A/AA checks pass at 320/495/1024px and 200% text, including dark
  theme and reduced motion. Screenshots are in
  `/workspace/artifacts/account-journey-2026-10-23/`.
- `scripts/test-firestore-security.mjs` passes 102 checks of the real rules in the local Firestore
  emulator: denied client creation/policy forgery, preserved API provisioning,
  owner updates and guest catalogue reads.

No real SMS, Google account popup, marketing message or payment is sent during
these tests. Provider credentials and production delivery are outside this
isolated verification.

To repeat browser checks, start `backend/.venv/bin/python
web/tests/account-journey-api.py` from the repository root. In separate terminals
under `web`, run `node tests/account-journey.vite.mjs`, then
`node tests/account-journey.browser.mjs`. For rules tests, start the Firestore
emulator on 127.0.0.1:8298 with project `demo-repaido-account` and the repository's
`firestore.rules`. From the repository root run:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8298 GCLOUD_PROJECT=demo-repaido-account node scripts/test-firestore-security.mjs
```
