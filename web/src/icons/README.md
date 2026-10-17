# Repaido icon foundation

The shared UI family is Google's **Material Symbols Rounded**, outlined (`FILL=0`), weight 400, grade 0, optical size 24. Official `FILL=1` variants are additionally bundled for favorite, bookmark and star selected states. Symbols are bundled locally as inline SVG paths. No font, CDN, external request, or runtime icon package is required.

Upstream: [google/material-design-icons](https://github.com/google/material-design-icons), pinned to commit [`49d4db35df873165d6bd6ba09b063c7dafbac2f4`](https://github.com/google/material-design-icons/tree/49d4db35df873165d6bd6ba09b063c7dafbac2f4). The unmodified selected SVGs are retained in `material-symbols-rounded/`; exact upstream paths, per-asset axes, SHA-256 checksums and byte counts are recorded in `material-symbols.provenance.json`. Google distributes these assets under [Apache License 2.0](LICENSE.material-symbols.txt). Matching license copies are included in both applications at `public/licenses/material-symbols.txt`; the verification and refresh commands check or maintain those copies.

## Use

```tsx
import { CleaningServices, SupportAgent } from '../icons'

<CleaningServices size={20} />
<SupportAgent size={24} title="Customer support" />
```

Prefer meaningful feature names such as `CleaningServices`, `Plumbing`, `Carpenter`, `LocalCarWash`, `PersonSearch`, `SupportAgent`, `RequestQuote` and `Payments`. Existing Lucide export names remain compatibility aliases so feature migrations do not alter callbacks or behavior. `material-symbols.map.json` is the complete export-to-Google-symbol mapping. Google no longer includes `local_offer`, `laptop`, `queue` or `steering_wheel` in this rounded source set; the deliberately chosen equivalents are `LocalOffer=sell`, `Laptop=laptop_windows`, `Queue=stacked_inbox`, and `DriverBadge=badge` for driver identity.

Each generated factory call has a purity annotation and each alias reuses its component, allowing unused symbols to be removed by the bundler. The small `map-icons.ts` entry provides official car, two-wheeler, storefront, home, handyman and phone geometry as decorative static SVGs for Leaflet without importing a React server renderer.

## Size and accessibility

The default glyph is a 24 px square. Resolution order is explicit `size`, explicit `width`/`height` (a square), matching unprefixed utility dimensions such as `w-4 h-4` or `size-5`, then 24. Responsive utility variants are not parsed. Shared `icon-system.css` keeps glyph dimensions equal, prevents flex shrinking and protects outline geometry from legacy stroke/fill rules. The resolved value is exposed as `data-icon-size` and `--icon-size`; `data-icon` identifies the official Google symbol.

Icons are decorative by default (`aria-hidden=true`, `focusable=false`). A `title`, `aria-label` or `aria-labelledby` gives a labeled image role; title IDs use React's stable `useId`. Parent buttons still need an accessible action label. `color`, `className`, SVG events and refs are supported. Legacy `strokeWidth`, `absoluteStrokeWidth` and `stroke` props cannot distort Material's precomputed geometry; glyphs use `currentColor` with no added stroke. `filled={true}` selects the official filled variant for `Heart`, `Bookmark` and `Star`; `filled={false}` selects their outline. Existing `fill="currentColor"` selects the same filled variant unless an explicit `filled` prop overrides it, preserving liked/saved/rating states. Other icons retain their official outline geometry.

Most official assets use a 960-unit viewport. Google's `auto_awesome` and `settings_suggest` 24 px assets contain legacy 24-unit paths and omit their SVG viewport; generation supplies `0 0 24 24` for those two only. Original source bytes remain unchanged for verification.

## Verify or regenerate

From the repository root:

```bash
python3 scripts/material-icons.py --check
python3 scripts/material-icons.py
```

Both commands work offline. The first checks every source checksum, mapped import, SVG structure and generated output; the second regenerates the adapter from those verified local sources. To intentionally download the exact pinned upstream set and refresh provenance after editing the mapping:

```bash
python3 scripts/material-icons.py --refresh
```

Changing the upstream revision requires a reviewed edit to the script's pinned commit and an intentional source refresh. Do not replace missing symbols with generic fallback drawings.
