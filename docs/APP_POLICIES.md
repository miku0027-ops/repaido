# In-app policy and help summaries

`AppPolicies.tsx` provides Privacy, Refunds & cancellations, Service standards,
Terms of use, and About & contact pages inside one accessible dialog. `AccountHub`
links to the selected page. Support opens the existing help callback when supplied,
or a `mailto:support@repaido.com` link. No external policy URL is assumed.

These pages describe the actual application and existing operational policies.
They are not a newly invented corporate legal agreement. No legal entity, address,
universal refund deadline, automatic account deletion, guaranteed provider arrival,
absolute uptime, or universal service SLA is asserted. Versioned per-service terms,
accepted work quotations, contract terms and product disclosures remain in the
relevant transaction flow. Any future legal policy must be approved and maintained
alongside the application behaviour it describes.

## Sources checked

- `backend/marketplace.py`: published service terms have explicit versions; the
  default says company-specific terms have not been published for the service.
- `backend/operations.py`: bookings retain the accepted service-terms snapshot;
  the standard field-service policy allows cancellation before work starts;
  available actions depend on state and outstanding rentals can block changes.
- `backend/home_plans.py` and `backend/hiring.py`: accepted scope, visit/quote
  confirmation, exclusions, separate travel/tax and their own current terms.
- `backend/refunds.py`: reviewed refund intent, provider-verified captured balance,
  previous-refund checks, settlement holds and uncertain-outcome reconciliation.
  No fixed customer refund-processing window is specified.
- `backend/procurement.py` and `backend/rentals.py`: product-specific refurbished
  inspection, warranty and return disclosures; rental custody and return checks.
- `backend/contract_records.py` and `docs/CUSTOM_CONTRACTS.md`: bank references
  are pending until independently verified; gateway collection does not prove
  contractor payout; participant-only reports and explicit public-sharing consent.
- `backend/integrations.py`, `backend/workspace.py`, `backend/evidence.py`:
  identity-review uploads and task-evidence photos have 30-day access expiry.
  This is not a platform-wide record-deletion promise.
- `backend/repaidians.py`, `backend/repaidians_billing.py`,
  `backend/repaidians_network.py`, `docs/REPAIDIANS.md`: private contact redaction,
  account-scoped media cache, canonical professional role gates, current 60-day
  trial, manual paid renewal, proof/visibility controls and retained privacy actions.
- `backend/discovery.py`: consented preferences govern personalised discovery.
- `web/src/firebase.ts`: Firebase Auth, Google Cloud-backed records and supported
  Firebase Analytics; `backend/main.py` and account/help flows supply phone and
  contact email for private communication. Email or client callbacks are not proof
  that a payment was captured.

## Interface and accessibility

Exported props are `{initialPolicy?, onClose, onContactSupport?}`. IDs are `privacy`,
`refunds`, `service-standards`, `terms`, and `about`. The shared native dialog retains
Escape dismissal, focus containment and focus restoration. Policy navigation uses
labelled buttons with `aria-current="page"`; selecting a page focuses its heading
and resets only the policy scroll pane. Text and controls use shared Repaido theme
tokens, bounded readable line lengths, 44–48 px targets and reduced-motion styles.
Mobile navigation scrolls horizontally without overlapping labels; the article has
one vertical scroll pane and remains usable with enlarged text.

Validated all five pages in Chromium at 320, 390 and 1024 px widths, light/dark
themes and 100%/200% root text. The checks exercised pane fit and scrolling,
heading focus on navigation, Escape dismissal and trigger-focus restoration,
the support callback, reduced motion and an axe WCAG 2/2.1 AA scan. There were no
violations in those scenarios. Used body, secondary-text and link token pairs
against their surface/subtle backgrounds also meet the 7:1 AAA text-contrast
threshold; this is a contrast check, not a claim of platform-wide AAA conformance.
