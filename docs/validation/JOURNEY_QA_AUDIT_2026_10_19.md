# Customer and Repaidians journey QA — 19 October 2026

## Scope and method

Independent follow-up to 7472593 while the customer, social and backend review fixes were being developed. Chromium checks use actual application components and, where stated, production API modules against disposable SQLite databases. No production customer data, cloud credentials or live payment providers were used. This audit did not deploy.

The design baseline is consistent controls, readable prices and labels, clear next actions, keyboard/focus behavior, theme support, network-failure recovery and privacy across accounts. Automated checks do not establish a design ranking or guarantee that production cannot fail.

## Confirmed issue and correction

Homes used fixed light colors and several fixed pixel text sizes. At 300 px with 200% text, rental destination and section controls split words into fragments. Dark mode still displayed light cards and inputs.

homes.css now uses the shared palette, relative text sizing, adaptive columns and controls that wrap as whole actions. Inputs remain at least 16 px at ordinary text and buttons retain 44 px targets. Slight hover motion is removed for system or app reduced-motion settings. Property forms, enquiries, moderation, uploaded-photo handling and equipment navigation are preserved.

The strengthened Homes browser test checks actual theme changes, whole words and control geometry at 300/390/1280 px, light/dark and 100%/200% text. It also checks keyboard switching and reduced-motion transitions.

## Completed checks

| Suite | Result | Boundary and behavior |
| --- | --- | --- |
| market-messaging.browser.mjs | 16 checks passed | Real local API: second-hand seller conversation; replies/unread; offers/swaps; lost-send idempotency; notification handoff; blocking/reporting; closed listings; account isolation; ₹99 membership dismissal/failure/capture/refund; operator report resolution. External checkout/provider is a local adapter. Layout and automated A/AA/AAA at 320/467/1440 px, light/dark and 200% text. |
| repaidians-messaging.browser.mjs | 6 checks passed | Real local auth/API: 31 conversations, 38-message history, two browser actors, pagination, refresh preservation, read retries, revoked recipients and delayed account-switch isolation. Eight header layout/theme/text variants. |
| ecosystem-lifecycles.browser.mjs | 4 checks passed | Real local API: accepted offer → agreed meeting → both handover confirmations → closed listing → participant review. Early handover and outsider access blocked. Mission → owned evidence → independent review → one Captain award. A/AA and 320/467/1280 px. Time/storage adapters remain local. |
| hourly-hiring.browser.mjs | 8 checks passed | Real local API/components: ₹150 advance, no travel before capture, shared timer, one unpaid 30-minute break and early-resume guard, worker completion, customer acceptance and exact remaining payment. 723 seconds produce ₹180.13 total and ₹30.13 balance. Provider/time adapters are local. |
| journeys.browser.mjs | 11 checks passed | Real local API: owner publishes route/fare, customer searches/requests, accepted pickup map and honest absent GPS, notification, owner workspace and expired family link. 320/465/1440 px, light/dark and 200% text. Acceptance is performed through the API in this scenario. |
| market-discovery.browser.mjs | 11 checks passed | Real local API: public/private cache separation, delayed reads/account resets, draft persistence, photo upload and one listing after lost-response retry, guest sign-in resumption, cancelled guest draft isolation, discovery reuse and malformed-success recovery. |
| home-discovery.browser.mjs | 8 checks passed | Real local API: eligible offers, persistent selection/removal, reviewed promotion/version sent to booking, no idle resubmission, delayed-account isolation and reduced motion. 320/390/487/1440 px, light/dark, 100%/200% text and enhanced contrast. |
| homes.browser.mjs | 10 checks passed | Response fixtures: responsive/themed catalogue and keyboard; one viewing request on double submission; photo/save retry IDs; account isolation; pagination; deep links; authenticated moderation photo retry. Pair with native housing tests below; this is not one combined property browser/backend journey. |
| Native domain tests, first group | 113 passed | test_rentals, test_market_messaging, test_market_presence, test_market_transactions, test_market_profiles, test_repaidians, test_repaidians_network, test_repaidians_role_policy. Includes equipment reservation, deposit/usage/refund lifecycle, authorization and concurrency. |
| Native domain tests, second group | 50 passed | test_housing, test_hourly_hiring, test_promotions. Includes property publication/privacy/viewing/state/retry/concurrency and billing/promotion guards. |

The broader social publication/profile/follow/comment/media/native-destination suite is reported by the social design review. Customer clarity and frontend runtime reviews report their own discovery, modal and streaming checks.

## Harness corrections

- Inbox verification waits for a rendered conversation before counting rows. Network idle alone had raced the deferred render; the API and failure screenshot contained the expected history.
- Marketplace discovery explicitly chooses Repairs. Initial discovery can depend on local time and intent.
- Home offers are selected by their real accessible service/price offer label, instead of an old category caption.
- Homes accepts HOMES_PREVIEW_ORIGIN and can reuse the existing development server.

Initial connection-refused runs occurred when the old Vite server exited. They were rerun against the replacement task-owned server and are not counted as application failures or passes.

## Evidence

Temporary local artifact directories:

- Marketplace messaging: /tmp/repaido-market-messaging-nc7Gts
- Repaidians messaging: /tmp/repaidians-messaging-6ONd3t
- Marketplace/mission completion: /tmp/repaido-ecosystem-lifecycles-3LKWeX
- Hourly completion: /tmp/repaido-hourly-du7eoX
- Customer rides: /tmp/repaido-journeys-AD0fqz
- Listing discovery: /tmp/repaido-market-discovery-dXXYuu
- Offer booking: /tmp/repaido-home-checks-lTXeTC
- Property fixture checks: /tmp/repaido-homes-browser
- Native results: /tmp/qa-audit-domain.log and /tmp/qa-audit-housing-hiring-promotions.log

## Practical limits

These passes verify the described local paths and failure handling. They do not verify live Firebase/OTP delivery, production Firestore indexes/contention, physical-phone push delivery, provider credentials/webhooks/settlements, GPS accuracy or real trips, Safari/iOS, store packaging, production load or complete manual screen-reader use. Those boundaries require release-environment and device/provider evidence. A fixture property browser check plus native HTTP tests does not prove a live enquiry on repaido.com.
