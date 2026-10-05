# Repaido identity

## Concept
A solid home silhouette with a spanner-shaped negative space: help with the work your home needs. The interface adds “Home services” beneath the wordmark so cleaning and other services are not reduced to repairs alone. A custom geometric lowercase wordmark adds a calm, approachable voice. The symbol and every letter are filled vector paths; no font installation, external images, strokes, filters, or gradients are required.

## Master files
- `repaido-logo-primary.svg`: blue symbol and navy wordmark, for white/light backgrounds.
- `repaido-logo-navy.svg`: one-colour positive artwork.
- `repaido-logo-white.svg`: reversed artwork for dark backgrounds.
- `repaido-mark-{blue,navy,white}.svg`: symbol-only artwork, including small icons.
- `identity-sheet.svg`: vector reference sheet showing scale and colour variations.

## Usage
Use the symbol alone for 12–24px spaces. The entire company name cannot be legible within a 12×12px box. The same symbol geometry is used at every size, without tiny lettering or fine decorative details. Minimum symbol size: 12×12 CSS pixels; prefer 24px or larger when space permits. Keep small icons aligned to whole pixel coordinates. Rendering quality still depends on the display and rasterizer.

Use the horizontal lockup at 132px wide or larger. Always preserve the SVG aspect ratio. Leave clear space of at least one-quarter of the symbol width around the artwork. Do not stretch, rotate, rearrange, add a container, or recreate the wordmark using a font. Use the supplied reversed artwork on dark backgrounds; the spanner is transparent negative space, not a white overlay.

Primary blue: #003BB5. Navy: #0B132B. Reversed: #FFFFFF. Blue/white contrast is 9.16:1; navy/white is 18.38:1. Avoid photographs or low-contrast surfaces directly behind the logo.

## Production
SVG masters scale without pixelation for large signage and billboards. Send the original vector artwork to the production vendor, who can convert it to their required PDF/EPS and colour profile. RGB hex values are digital references; approve a printer-supplied colour proof for the chosen ink, substrate, and CMYK/spot process. Do not use a screenshot as print artwork. The earlier house-and-checkmark design was archived in archive-home-check/. The current house-and-spanner design has not undergone trademark clearance. The name remains unverified; see CLEARANCE-NOTES.md for the historical review and its limitations.

## App integration
The shared React Brand component uses the primary SVG, so discovery and checkout stay consistent. The browser favicon uses the identical standalone symbol. Android source has not been modified by this browser-logo update.
