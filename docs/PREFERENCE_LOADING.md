# Preference screens without a network gate

Work discovery, community privacy, professional network, offer and saved-item
preferences render their labels, explanations and form layout before their saved
values arrive. An unknown checkbox is disabled and indeterminate; an unknown
select has a pending placeholder. Opening a screen never opts the member in.

Community privacy and the blocked-members list load independently, with separate
retry controls. A failed or delayed blocked list cannot hide privacy settings.
Confirmed privacy choices use the existing account-scoped in-memory view cache;
a background read cannot overwrite unsaved edits. Closing and reopening the
network accordion preserves the mounted form and its draft.

Work and network preference mutations use the complete authoritative save
response to update their read caches. Active work-preference observers adopt
that response directly, without another GET. Older reads cannot replace saved
choices. Mutations still invalidate dependent discovery data. Failed work saves
restore the confirmed checkbox value, and unknown values remain disabled.

Work/network resource hooks rely on their service's data-generation guards and
identity checks. An unrelated content receipt no longer silently drops their
response and leaves a panel stuck loading. Private records remain memory-only,
scoped to the signed-in identity; server authorization and consent enforcement
remain authoritative.

## Verification

- Frontend build and 401 unit tests pass, including mutation-response caching,
  failed saves, stale-response retirement and account changes.
- `social-navigation.browser.mjs` uses the real API and a disposable SQLite DB.
  Held responses prove that forms are visible before data, privacy settings do
  not wait for blocked members, and an unrelated network-preference save does
  not strand the work-preference load. It checks draft retention, no redundant
  save GET, failure rollback, account isolation and WCAG AA.
- `saved-alerts.browser.mjs` checks static options during a held read, actual
  preference saves, account changes, quiet hours, 200% text and WCAG AA.
- Preference text is checked for clipping at 320/495 px with 100/200% text.
- The broader `navigation-work-market.browser.mjs` currently stops on its
  existing single-row header expectation at 320 px / 200% text. The existing
  header CSS permits wrapping; this is separate from preference loading.

## Compact work controls

Work & market now uses one horizontal row of native dropdowns for Browse,
My work and Tools. The selected destination stays visible, long labels do not
split across rows, and narrow or enlarged-text layouts scroll horizontally.
Destination availability still follows the existing professional access checks.

Browser notifications use a collapsed native details/summary control with an
On, Off, Blocked or In-app only status. Details and enable/disable actions appear
only when expanded. Opening the accordion never enables notifications.

Jobs keep the existing server-backed filters, with Best match, Closing soon and
Highest daily pay sorting for the jobs currently shown. Sorting is local to the
loaded results and does not fetch or imply a globally sorted catalogue; when
more results are available, the interface states this scope.

`work-controls.browser.mjs` covers the compact row, keyboard disclosure, explicit
notification actions, denied permission, 320/495/1024 px layouts, both themes,
200% text, WCAG AA, sort orders, city filtering, clearing and guest restrictions.
The production frontend build and real-API social-navigation scenario also pass.
