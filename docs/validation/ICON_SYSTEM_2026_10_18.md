# Material icon system and semantic audit

Status: implemented and locally verified; not deployed.

## Implementation

All application and engineering-console imports now use the shared local icon adapter. The unused Lucide dependency was removed from both package manifests and lockfiles without changing other dependency resolutions. Four older browser fixtures also use the production adapter.

The adapter exposes 291 named exports backed by 248 distinct official Google Material Symbols Rounded symbols and 251 verified SVG assets. The common design axes are weight 400, grade 0 and optical size 24. Outlined geometry is the default; official filled variants preserve selected hearts, bookmarks and stars. Sources are pinned to Google commit `49d4db35df873165d6bd6ba09b063c7dafbac2f4`, with Apache 2.0 licensing, per-asset checksums and an offline verification/generation script. Both distributed web applications include the license.

The size scale is 14/16px for metadata, 18/20px for compact actions, 24px for navigation and 28/32px for categories. Small decorative badge seals retain 12px, success illustrations retain 48px, and the transient community reaction artwork retains 84px. Glyphs stay square, cannot shrink in flex layouts, inherit their surface colour and retain their authored geometry. Removed conflicting stroke-weight rules; Material outlines use filled vector contours rather than extra CSS strokes. Smaller icons preserve the surrounding 44px or larger touch targets.

Icons are decorative by default. Meaningful standalone icons accept accessible titles or labels, with stable title IDs; icon-only buttons retain action names. A map marker that became decorative-only gained an explicit service-address name. Tracking cancellation text was darkened to pass the existing AAA contrast check.

## Semantic corrections

| Surface | Distinct meanings |
| --- | --- |
| Customer navigation | Explore, home repair services, bookings, storefront market and person search for hiring |
| Services and hiring | Cleaning, plumbing, electrical work, carpentry, painting, salon, vehicle care and appliances |
| Trading | Spares inventory, shopping cart, refurbishment, tool rental, housing, exchange and selling |
| Mobility | Cab, shared travel, self-drive keys, scheduled rental, pickup, destination and passenger seats |
| Account and rewards | Support, privacy, invoices, payments, coupons, rewards, history and memberships |
| Company and worker suites | Dashboard, bookings, fleet, schedule, customers, inventory, procurement, contracts, tickets and finance |
| Community | Posts, messages, opportunities, tenders, media, saved items and liked content |
| Engineering | Source folders, APIs, runtime functions, scheduling, queues, devices and graph controls |

Functional emoji and typographic action glyphs were replaced in the audited controls and map markers. Persisted compliment keys, rating text, user content, brand artwork, photography, charts and service illustrations were preserved. No booking, payment, assignment or location contract changed. The engineering Docker source layout and release inventory guard were updated for the shared icon source.

## Verification

- Main web unit suite: 338 passed, zero failures/skips.
- Main production TypeScript/Vite build: passed. Existing bundle-size and mixed-import warnings remain.
- Engineering production build: passed; 7 graph tests and 16 release checks passed. Its Docker frontend source layout was recreated and built successfully in isolation; a new Docker image was not built or deployed.
- Both dependency lockfiles passed offline frozen-lockfile verification and supply-chain policy checks.
- `python3 scripts/material-icons.py --check`: passed, including upstream source, selected-state variants, generated exports, current imports and distributed-license checks.
- Icon gallery: all 291 exports passed geometry, current-colour, stroke isolation, square sizing, accessible title/label and selected-state checks. Verified explicit and utility-derived sizes, 44px targets, light/dark/Gold themes, enlarged text, and operating-system/app reduced-motion settings. A single-icon tree-shaking probe retained 1,805 bytes with React external.
- Customer and workspace icon suites: 56 recorded viewport/theme/text variants across customer screens, all Market destinations, company navigation, cab owner, driver, scrap and Repaidians. No icon font/CDN requests or browser exceptions.
- Catalogue, leader latency and transactional Home discovery browser suites passed, including query/filter drafts, real offer/version payloads, account isolation, dark mode, enlarged text and accessibility.
- Hiring discovery and all 56 listing-layout cases passed, including profile decisions, approved handoffs, 44px targets and responsive AAA checks.
- Engineering desktop/mobile browser checks passed, including source inspection, graph controls, reduced motion, overflow and accessibility.
- Full refinement browser suite: 96 responsive/theme/text cases passed, with existing AAA checks. Tracking retained marker profiles, manual zoom, pinch zoom, square/fullscreen geometry and whole-word milestones after icon replacement.
- `git diff --check`: passed.

Browser evidence: `/tmp/repaido-icon-system-JTwv3e`, `/tmp/repaido-icon-workspaces-D9HWJo`, `/tmp/repaido-refinement-lVS6cM`, `/tmp/repaido-material-engineering-browser`, `/tmp/repaido-home-checks-ylvIcN` and ignored `web/test-results/`.

These are local and isolated-API checks. This task did not publish website files, backend revisions or Android artifacts.
