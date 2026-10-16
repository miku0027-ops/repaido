# Shop business tools

The approved shop portal's **Business tools** tab provides inventory imports,
stock reminders, payment allocation statements and parts-order response reports.
All routes live under `/operations/shop/tools` and require mobile OTP sign-in
and ownership of an approved shop. No payment provider request is made by these
tools. Existing payout execution and operator reconciliation remain authoritative.

## Inventory import

1. Download the blank CSV template or export existing stock in files of up to
   25 products. Existing exports include current product versions and physical
   count (`available + reserved`). A new product uses `expected_version=0`.
2. Edit the file using integer paise, then upload or paste it and preview.
   Required columns are `product_id`, `expected_version`, `name`, `sku`,
   `category`, `compatibility`, `price_paise` and `on_hand`.
3. Review every line, including old/new stock and base price. Correct any errors
   before saving. A refurbished item needs the same structured inspection JSON
   as the individual inventory editor.
4. Save the reviewed file. The backend rechecks shop/product versions, media
   ownership, duplicate SKUs, reserved stock and condition disclosures in one
   transaction. A changed or invalid row prevents every row from committing.

Preview has no side effects. The digest covers the submitted CSV, shop version
and proposed canonical product records. Commit requires this digest and an
owner-scoped idempotency key; a retry returns the original import receipt.
Changing a file clears its review and retry key in the interface. Unknown save
outcomes can be retried with the same key. After closing the interface during an
unknown save outcome, export current stock and preview again before proceeding.

The single-product editor and importer share `procurement.prepare_stock_item`.
Stored merchant offers are retained, reservations are protected and availability
is calculated from the physical count. Import never rewrites historical paid
order snapshots. A new base price cannot undercut an existing merchant floor;
change the product offer's floor first if that price is intended. Source hooks
still run for every committed product.

Limits are 25 rows, 120,000 UTF-8 bytes and 2,000 existing products for duplicate
SKU validation. The lower row limit includes old and new discovery-index lanes;
a final 450-document transaction guard protects against future hook expansion.
Larger catalogues can continue using the existing individual inventory editor.
Exported text cells are protected against spreadsheet formula execution.

## Stock and response evidence

Stock reminders read the canonical inventory in owner-scoped pages of 100.
They identify available quantities at or below the configured threshold and
confirmations older than 24 hours. Reserved quantities are shown separately.
These are live in-app reminders; this feature adds no automatic SMS or email.

The response report reads owner-scoped parts-order pages of 100. Median time to
accept uses only recorded creation and acceptance timestamps. It shows the
sample size, measured acceptances, pending requests, expired requests and
cancellations. Missing measurements remain unknown, and cancellations are not
classified as shop rejections. Each page explicitly describes its sample.

## Statements and documents

Statements read native `shop_payables` in pages of 50 and follow their actual
retail, rental or job references. They show recorded allocations, any existing
job invoice reference, provider payment references, payout references and
evidence that requires reconciliation. Page totals do not claim to be lifetime
totals or profit. No supplier costs, margins or tax invoices are invented.

Confirmed-paid totals require a processed native batch, its provider reference,
the exact owned allocations and amount, a balanced posted payout journal with
matching parts-payable debit and clearing credit, and no reversal record.
Batches above 200 allocations are marked for review rather than expanded in a
report request. Missing/mismatched evidence remains visible and does not trigger
a transfer. Retail receipt review is displayed honestly as settlement review.
Retail allocations require manual settlement review and are excluded from the
weekly service/rental payout worker. An unrelated retail allocation or a legacy
allocation without a service job cannot block an eligible service transfer.

Saved document views expose the selected shop allocation and its own source
lines. They omit other shops' lines, customer contact/address details, bank fund
account IDs and idempotency secrets. A job invoice reference is shown only when
the job already has one; the view does not create a supplier tax invoice. CSV
statement pages and JSON source-record summaries can be downloaded.

## Integration and local verification

`shop_tools.install(core)` is installed by `backend/main.py`; the backend Docker
image includes `shop_tools.py`. SQLite indexes and `Unit.find` support
`shop_payables.shop_id`, `shop_batches.shop_id` and `parts_orders.shop_id` in
addition to existing inventory/shop ownership indexes. Queries use a single
equality field and document ID pagination, with no new Firestore composite
index. Native `ops_*` records remain inaccessible to direct client reads/writes.

Focused backend checks:

```bash
cd /workspace/repaido/backend
.venv/bin/python -m pytest -q test_shop_tools.py test_shop_payouts.py test_procurement.py test_shop_pricing.py
```

Native web build:

```bash
cd /workspace/repaido/web
npm run build
```

Browser interaction checks use explicit HTTP/auth fixtures and the real
component. The backend tests separately verify canonical authorization and
transaction behavior:

```bash
cd /workspace/repaido/web
npm run dev -- --port 5193 --strictPort
# In another shell, with Playwright and Chromium available:
node tests/shop-tools.browser.mjs
```

The browser check writes screenshots and a report to
`/tmp/repaido-shop-tools-browser`. Local development and validation do not
authorize a production deployment or production-triggering push.
