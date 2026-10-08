# Repaido React design system

React + TypeScript + Tailwind CSS 4 components for home-service discovery and checkout. This is a separate web interface alongside the native Android project.

## Run

Node 20.19+ and pnpm 11.19+:

```sh
pnpm install
pnpm dev
pnpm build
pnpm test
```

Local preview: http://127.0.0.1:5186

## Tokens

`src/brand-system.css` owns shared typography, colour and card spacing;
`src/styles.css` integrates the Tailwind theme and `src/tokens.ts` exposes JS tokens.
See [the brand system](../docs/BRAND_SYSTEM.md) for card patterns, accessibility,
wording and async-state rules.

| Token | Value |
| --- | --- |
| Card / page surface | `#FFFFFF` / `#F4F6FA` |
| Main / secondary text | `#0B132B` / `#3E4C63` |
| Primary action | White on `#17285C` |
| Border / control outline | `#DCE1E8` / `#68768A` |
| Card radius | 16px |
| Card padding | 16px phone / 20px desktop |
| Spacing | 4, 8, 12, 16, 24, 32px |
| Controls | 44px minimum height; 16px input text |
| Typeface | Locally bundled Poppins 400, 500, 600, 700 |

Text colours target AAA contrast in both themes. Cards use a restrained shadow;
fonts and standard product imagery are served locally.

## Reusable components

- `Discovery`: sticky search/location header, horizontally scrolling category pills, service list and fixed booking drawer.
- `ServiceCard`, `QuantityControl`, `BookingDrawer`: independently exported for reuse.
- `Checkout`: mobile Address → Schedule → Review; desktop `md:grid-cols-3` with the form spanning two columns and a sticky invoice spanning one.
- `Invoice`: live integer-paise calculations; configurable `taxBasisPoints`, default 1800 for the illustrative 18% tax estimate.
- `Field`, `Modal`, `Brand`, `Empty`: shared accessible primitives.

The time grid uses 2 columns on small phones, 4 on intermediate widths, and 8 on large desktops, preserving usable touch targets and the specified padding. The day picker scrolls horizontally. Past times and times within two hours are disabled using India Standard Time.

## Payment and backend boundary

This request delivers interactive design-system components. `App.tsx` uses an explicit **preview checkout**: the Confirm and Pay button validates input and completes a clearly labelled preview. It does not submit an appointment or collect a payment. No financial details are requested or stored.

To connect a real payment provider, inject the `ConfirmBooking` callback into `Checkout`. It receives the cart, address, selected time and estimated totals. Treat those as untrusted client inputs: the server must re-price services, calculate applicable taxes, reserve live availability and create a payment session. Confirm payment only from a verified provider webhook. Redirect to the provider inside the callback as appropriate and return a genuine reference only after the intended server operation succeeds. Set `preview={false}` only after that integration exists.

The existing Python backend supports a single-service pay-after-service pilot with four daily slots. This UI intentionally does not send its multi-item, hourly-slot, tax-estimate checkout into that incompatible API. The Android app and backend are unchanged. `vite.config.ts` includes an optional `/api` development proxy for a future integration.

Draft address and cart data stay in React memory and are cleared on reload. No localStorage storage of personal information. Returning from checkout preserves the cart; submitted preview data is never described as a live booking.

## Verification

`pnpm test` covers invoice rounding and quantities, address validation, and India-time slot boundaries. `tests/browser.mjs` exercises mobile and desktop checkout, live totals, cart removal, validation, empty search, modal Escape handling and image loading. Run it with Playwright installed and Chrome available; `PLAYWRIGHT_MODULE` and `CHROME_PATH` support environment-specific paths. Screenshots and output are written to ignored `test-results/`.

See `ASSETS.md` for placeholder image sources.

Validated on 2026-09-17: TypeScript passed, production build passed, three logic tests passed, browser flows passed at 390px and 1440px, and discovery/image/overflow checks passed at 320px, 390px, 768px and 1440px. No JavaScript runtime errors were observed.
