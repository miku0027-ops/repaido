# Compact customer Market workspace

The customer Market now uses `MarketWorkspace` for Marketplace, Wholesale,
Contracts, Cabs and Scrap. Its five destinations remain visible on narrow
screens. It uses the shared `BusinessTabs` component with labelled panels,
roving keyboard focus, arrow keys and Home/End navigation. Keyboard movement
starts from the focused tab, including during quick successive selections.

The workspace owns its horizontal gutters. Nested catalogue, wholesale,
contract, transport and cleanup sections use that same edge alignment. Compact
labels and padding retain 44-pixel touch targets, visible focus, Poppins and
the existing brand palette. Shared card padding and shadow tokens configure the
brand layer instead of changing partner or community layouts globally.

## Surfaces and interactions

- Marketplace keeps parts, refurbished goods, rentals, swaps and pre-owned
  items visible in a compact section switcher. Market highlights expand on
  request and mount their carousel only while open.
- Wholesale uses small product images beside the title, supplier, price and
  inventory facts. The quotation action and stated dispatch estimate remain
  available, with tax and freight information retained.
- Contracts keeps posting and refresh accessible. The bid planner and material
  links use a disclosure that supports keyboard dismissal. Sector descriptions
  no longer repeat basic category explanations above the results.
- Transport retains four separate service modes. Each has a light tinted
  surface, distinct colour, illustration and search action. Pickup selection
  opens the existing map/address picker and carries the chosen location into
  discovery and booking. A lone transport result fills the available rail;
  counts and navigation reflect the actual number of rendered service options.
  Below booking history, three illustrated banners show the other travel types
  and open their existing booking flows. The selected discovery mode stays in
  place while an alternative booking is open, and closing it returns keyboard
  focus to the banner. A pickup shortcut opens the same map picker. These
  banners make no API reads or automatic submissions, and are omitted from the
  compact home-discovery embed. The customer footer uses trip information when
  Cabs is selected rather than general shopping guidance.
- Scrap uses the same compact geometry with its green identity. Selling,
  public-place reports and rewards remain distinct sections. The existing
  patriotic message, camera requirement and collection workflow are retained.

Illustrations are original local SVGs. Their short entrance movements and
selection feedback do not imply live activity. Text remains opaque during
movement. Reduced motion stops decorative animation while preserving Leaflet's
position transforms. Short-lived location pickers disable queued CSS zoom
animation and cancel pending work on close; panning respects reduced motion.

Booking history and optional highlights fetch only after being opened. These
changes reuse the existing API clients, permissions, request guards and caches;
they do not create cloud services or publish content automatically. Search focus
accounts for both the app header and the sticky destination switcher.

## Verification

`npm test` runs the existing frontend regression suite. `npm run build` checks
TypeScript and generates the production bundle. Start Vite on port 5186, then:

```bash
cd web
PLAYWRIGHT_MODULE=/path/to/playwright CHROME_PATH=/usr/bin/chromium \
  node tests/market-compact.browser.mjs
```

The new suite renders the production components against isolated HTTP fixtures.
It checks all five destinations at 320, 471, 768 and 1280 pixels, keyboard
navigation, quotations and filters, transport mode switching, lazy history,
scrap reports/rewards, reduced-motion map operation, enlarged text and dark
theme. It also runs WCAG A/AA/AAA audits on the tested panels. Fixture data and
the preview entry are excluded from the production entry graph.
The travel banner checks also exercise all four booking entries, preservation
of the selected panel, keyboard focus restoration and pickup selection.

Existing `market.browser.mjs` verifies catalogue errors/retry, disclosures,
inventory and payment gating. Existing `b2b.browser.mjs` verifies real private
RFQ/quotation persistence, uncertain-response retry, PDF access, stale prices
and account isolation against an isolated SQLite API.

No release is performed during this development work. The current development
branch also contains the unreleased scrap API/camera changes described in
[Scrap collection experience](SCRAP_COLLECTION_EXPERIENCE.md); include those in
the next coordinated release rather than publishing this web bundle by itself.
