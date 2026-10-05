# Repaido interface accessibility and UX

The discovery redesign uses familiar category-first home-service browsing, visual category tiles, an editorial photo mosaic, clear pricing, and a persistent booking action. Checkout remains a sequential mobile flow and a split-pane desktop layout.

## Contrast

Normal text targets WCAG AAA's 7:1 contrast threshold. The earlier #0052FF blue has only 5.75:1 contrast with white, so functional blue is now #003BB5. White text on this blue is 9.16:1; navy #0B132B on white is 18.38:1; secondary #414B60 on white is 8.75:1. Secondary text on the darkest approved neutral surface (#E2E8F0) remains 7.10:1. Hover blue is #002D8F. Errors use #991B1B. Input and selectable-control boundaries use #65748B, meeting 3:1 against white and light gray. Pale borders are reserved for decorative grouping.

The automated palette test covers approved text/surface combinations and control boundaries. This is a contrast verification, not certification of complete WCAG AAA conformance.

## Interaction

- Sans-serif typography with distinct headline, section, service-title, body, and metadata levels.
- Native buttons, labelled inputs, selects, and radio groups support keyboard operation.
- Focus rings, selected-control border thickness, and active step numbers supplement colour cues.
- Large controls, spaced choices, reduced-motion support, validation messages, and a skip link.
- Dialogs trap focus, close with Escape, and restore the originating focus.
- Responsive layouts checked at 320, 390, 768, and 1440 pixels.
- No invented ratings, customer counts, or trust certifications.

## Design rationale

[Jakob's Law](https://lawsofux.com/jakobs-law/) informs familiar category browsing, location/search placement, service cards, and the cart action. [Hick's Law](https://lawsofux.com/hicks-law/) informs four primary categories and progressive checkout. [Fitts's Law](https://lawsofux.com/fittss-law/) informs large touch targets and the reachable booking action. Proximity and common regions group service details, prices, and controls.

References: [Laws of UX](https://lawsofux.com/), [Urban Company](https://www.urbancompany.com/), [WCAG contrast enhanced](https://www.w3.org/WAI/WCAG22/Understanding/contrast-enhanced.html).

Checkout currently remains a clearly labelled preview; it does not collect payments or create backend appointments.
