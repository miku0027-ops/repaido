# Repaido interface system

The shared rules live in `web/src/brand-system.css`, imported by `design-system.css`.
The priority CSS layer deliberately protects typography, surface colours and card
spacing from legacy module styles and lazy-loaded stylesheets. Module CSS still
owns layout and domain-specific states. New components should use the shared tokens,
not add another colour or spacing override.

## Card patterns

The ten supplied SVG reference sheets inform four reusable patterns, rather than
introducing a separate component for every wireframe:

| Pattern | Structure | Used for |
| --- | --- | --- |
| Identity | Avatar, name, secondary facts, status | Account and professional profiles |
| Media | Image, title, facts, price, action row | Marketplace and Repaidians opportunities |
| Work summary | Status, title, schedule, progress, details | Bookings and contract cards |
| Form or message | Heading, short explanation, fields or next action | Quotes, empty states and feedback |

Use `Card` for new article, section or div cards. Existing domain card classes share
the same surface contract. Keep one primary action, group secondary actions, and
use a divider only when it separates information from actions. Images use a
consistent crop; informative profile pictures keep their existing identity crop.

## Typography and spacing

Poppins is self-hosted at weights 400, 500, 600 and 700. Body copy uses 400, controls
500, headings 600, and occasional emphasis 700. There are no remote font requests.
The files include Latin and Devanagari glyphs. The browser may use its script fallback
for characters Poppins does not contain. Logos and user-uploaded artwork are not
re-typeset. Font source hashes and the OFL licence are in `web/public/fonts/`.

Use 4, 8, 12, 16, 24 and 32px spacing. Cards use 16px padding on phones and 20px
on larger screens, with a 16px radius. Form controls keep 16px text; primary
interactive targets are at least 44px high. Layouts must remain usable at 320px
and with 200% text. Do not truncate essential prices, status or error messages.

## Colour and accessibility

| Role | Light theme | Dark theme |
| --- | --- | --- |
| Main text | `#0b132b` | `#f5f7ff` |
| Secondary text | `#3e4c63` | `#d1dbea` |
| Card | `#ffffff` | `#182337` |
| Page | `#f4f6fa` | `#101827` |
| Link | `#003bb5` | `#bfd2ff` |
| Primary action | White on `#17285c` | White on `#17285c` |

Text pairs target WCAG AAA: 7:1 for normal text and 4.5:1 for large text.
Controls and focus indicators need the applicable non-text contrast, not 7:1.
States always include words or icons, never colour alone. Place banner text on a
solid surface so changing imagery cannot reduce contrast. Respect reduced motion.
Automated contrast checks support review; they are not full WCAG certification.

## Wording and async actions

Say what happened and what the customer can do next. Prefer “Changes saved”,
“Uploading…” or “Choose a date” over explanations of internal processes. Keep
payment, privacy, eligibility and agreement terms where they affect a decision.

A selected file is not yet uploaded; an uploaded file is not a saved form; a saved
draft is not published; a payment check is not payment confirmation. Show progress
until the server confirms the result. Retain drafts after failures and keep
completion feedback visible when a dialog closes. After an uncertain timeout,
ask the customer to check saved records before retrying.

API calls combine caller cancellation with a deadline: ordinary requests get
20 seconds (community requests 30); uploads get 120 seconds. Both cancellation
and rejection clear the loading state. Never automatically retry a write that
might already have succeeded.

## Verification

- `npm --prefix web test` includes deadline, cancellation and feedback regressions.
- `brand-system.browser.mjs` checks actual card/account components in both themes,
  at 320/465/1280px and enlarged text, with AAA contrast enabled.
- `brand-screens.browser.mjs` checks customer navigation and marketplace sections
  against a disposable local SQLite API, in both themes.
- Existing market, wholesale, hiring, action-feedback and custom-contract browser suites
  exercise submission errors, recovery and confirmed outcomes with isolated data.

The Android customer app renders the same web interface. Native Poppins family
resources and their licence also live in the customer and agent Android apps; those require an APK
build to update the native launch screen.
