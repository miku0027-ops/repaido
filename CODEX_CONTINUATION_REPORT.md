# Repaido Platform Continuation & Handover Report (For Codex)

**Document Version:** 2.0  
**Date:** September 30, 2026  
**Target Environment:** Web (Vite + React 19 + TypeScript), Mobile (Capacitor/Android APK), Backend (FastAPI + Python 3.12), Hosting (Firebase Hosting & Apache cPanel)  
**Live Production URL:** [https://repaido.web.app](https://repaido.web.app)  
**cPanel Domain:** [https://repaido.com](https://repaido.com)  

---

## 1. Executive Summary

This report documents the architectural implementation, UI/UX consistency, backend services, and deployment deliverables for two major production subsystems added to the Repaido platform:

1. **Customer Parts & Equipment Shopping Cart Drawer**: Decoupled parts procurement with tax calculation (18% GST), free delivery threshold (₹999), 4-digit verification PIN, multi-payment options, and persistent local storage synchronization.
2. **Contractor / Manager Enterprise Suite & Dual Role Workspace**:
   - Integrated with the Agent Portal (`/worker`), supporting dual authentication between **Technician / Specialist** (solo field tasks, doorstep PIN, travel geofence) and **Contractor / Manager Account** (HRMS workforce roster, team commands, site geofencing, won contract oversight, and tender bidding).
   - 100% design system consistency adhering to Repaido's mobile-first Agent App container (`.operations.ops-worker`), bottom navigation tabs (`Dashboard`, `Workforce`, `Bidding`, `Contracts`, `Profile`), 4-tile interactive metric grid, and micro-typography.
3. **Repaido Contract Tenders & Auctions Marketplace**:
   - Available on Customer Market tab and inside the Contractor Bidding workspace.
   - Enforces business constants: **60-day (2-month) bidding window**, **₹1,499 tender entry sitting fee** (inclusive of 18% GST), and **₹1,999/month Contractor Prime membership** for promoted showcase and 48-hour early bidding.
   - Repaido AI Suitability Scoring engine (0–100%) ranking contractors based on rating, crew readiness, certifications, and historical SLA compliance.

---

## 2. Recent Bug Fixes & Refinements Completed

During the latest review pass, the following specific issues were resolved:
- **Static Banner Eradicated**: Removed the unconfigurable banner (`CONTRACTOR WORKDAY · MANAGER SUITE`, `Utkal Electro-Tech Engineering Consortium`, etc.) from the Contractor Dashboard. The dashboard now immediately surfaces the 4-tile interactive command grid.
- **Bidding Tab Column Misalignment & Wrapping Fixed**:
  - Implemented `.contractor-columns-grid` with a responsive 4-column spec matrix (`Project Valuation`, `Tender Entry Fee`, `Crew Allocation`, `Active Bids`) with uppercase micro-typography (`font-size: 0.65rem; font-weight: 800; letter-spacing: 0.06em`).
  - Implemented `.contractor-tender-scope-box` for `Scope of Work` and `Technical Deliverables` to eliminate awkward truncation or clipping.
  - Replaced rigid 3-column modal layouts with `.contractor-modal-form-grid` and `.contractor-modal-form-col`, ensuring input labels (`Quote (₹ Lakhs) *`, `Days to Handover *`, `Crew Allocated *`) never wrap awkwardly or get cut off on mobile viewports.
- **Elimination of Mock/Demo Terminology**: Purged developer placeholders and internal labels like `(Naukri-Style Recommendation Board)` in favor of `Verified Prime Contractors Showcase`.
- **Dynamic Contractor Profile**: Default profile is now configurable and saved to `localStorage['repaido.contractor_profile']` via the Profile tab editor.

---

## 3. Architecture & File Mapping

### 3.1. Frontend Codebase (`/web/src/`)

| File Path | Description | Key Responsibilities |
|---|---|---|
| [`components/ContractorPortal.tsx`](file:///Users/miku0027/Documents/ChatGPT/Repaido%20App/web/src/components/ContractorPortal.tsx) | Complete Contractor Workspace | Houses 5 bottom-nav tabs (`dashboard`, `hrms`, `tenders`, `contracts`, `profile`), modal sheets for adding crew, adjusting geofence radius (200m–2,000m), bidding on tenders, and posting contracts. |
| [`components/contractor-tenders.css`](file:///Users/miku0027/Documents/ChatGPT/Repaido%20App/web/src/components/contractor-tenders.css) | Contractor & Tenders Design System | Defines `.contractor-button-grid`, `.contractor-columns-grid`, `.contractor-col-cell`, `.contractor-col-label`, `.contractor-col-value`, `.contractor-member-card`, and modal styling. |
| [`components/TendersPlatform.tsx`](file:///Users/miku0027/Documents/ChatGPT/Repaido%20App/web/src/components/TendersPlatform.tsx) | Customer Market Tenders Platform | Sector filtering rail, tender search, Prime contractor directory, tender posting modal, and bid review/award modal. |
| [`components/CustomerCartDrawer.tsx`](file:///Users/miku0027/Documents/ChatGPT/Repaido%20App/web/src/components/CustomerCartDrawer.tsx) | Slide-over Parts Cart Drawer | Micro-typography cart item steppers, 18% GST calculation, free shipping calculation, delivery address form, multi-payment options, 4-digit confirmation PIN. |
| [`components/customer-cart.css`](file:///Users/miku0027/Documents/ChatGPT/Repaido%20App/web/src/components/customer-cart.css) | Cart CSS Stylesheet | Slide-over drawer animations, backdrop blur, badge counters, and checkout summary styling. |
| [`services/cartService.ts`](file:///Users/miku0027/Documents/ChatGPT/Repaido%20App/web/src/services/cartService.ts) | Reactive Cart State Singleton | `addItem()`, `removeItem()`, `updateQuantity()`, `clearCart()`, `getSummary()`, and `placeOrder()`. |
| [`components/LiveWorkerPortal.tsx`](file:///Users/miku0027/Documents/ChatGPT/Repaido%20App/web/src/components/LiveWorkerPortal.tsx) | Agent Portal Shell (`/worker`) | Dual login switcher (`Technician / Specialist` vs `Contractor / Manager`), fast-track desk switch button, and auth routing. |
| [`App.tsx`](file:///Users/miku0027/Documents/ChatGPT/Repaido%20App/web/src/App.tsx) | Customer Application Shell | Top header cart button with active count badge near notification bell, Market sub-tab switcher (`Spare Parts & Equipment` vs `Contract Tenders & Auctions`). |

### 3.2. Backend APIs (`/backend/`)

| File Path | Description | Key Responsibilities |
|---|---|---|
| [`backend/tenders.py`](file:///Users/miku0027/Documents/ChatGPT/Repaido%20App/backend/tenders.py) | Contract Tenders, HRMS, and Cart Router | Registered under prefix `/operations`. Provides endpoints for sector tenders, contractor bidding, contract awards, contractor workforce management, site geofencing, Prime subscriptions, and cart orders. |
| [`backend/main.py`](file:///Users/miku0027/Documents/ChatGPT/Repaido%20App/backend/main.py) | FastAPI Main Application | Mounts `tenders.router`, initialises SQLite tables and seed data. |
| [`backend/test_tenders.py`](file:///Users/miku0027/Documents/ChatGPT/Repaido%20App/backend/test_tenders.py) | Backend Pytest Suite | Verifies seed tenders, sector queries, suitability scoring, Prime boosts, and cart order placements. |

---

## 4. API Endpoints Reference

All endpoints are hosted at `https://repaido-api-rivzaqvyvq-uc.a.run.app` (or local dev proxy `/api`):

### 4.1. Contract Tenders
- `GET /api/operations/tenders?sector={sector}&city={city}`
  - Returns list of open tenders with calculated `days_remaining` and `bids_count`.
- `POST /api/operations/tenders`
  - Body: `{ title, sector, entity_name, entity_phone, city, address, budget_paise, manpower_needed, description, deliverables }`
  - Creates a new tender with a 60-day bidding window.
- `POST /api/operations/tenders/{id}/bids`
  - Body: `{ contractor_name, contractor_phone, bid_amount_paise, timeline_days, team_size, capabilities_pitch, tender_fee_confirmed: true }`
  - Calculates AI suitability score and rank, increments bid count.
- `POST /api/operations/tenders/{id}/award`
  - Body: `{ bid_id }`
  - Marks tender status as `awarded` and triggers project milestone setup.

### 4.2. Contractor Workforce & Prime
- `GET /api/operations/contractor/team`
  - Returns crew roster with trades, daily wage rates, geofence status, and active project.
- `POST /api/operations/contractor/team`
  - Adds a new technician/engineer to the contractor roster.
- `POST /api/operations/contractor/team/{id}/geofence`
  - Body: `{ radius_meters, site_name, breach_action }`
  - Deploys site perimeter geofence commands.
- `POST /api/operations/contractor/prime`
  - Activates Contractor Prime membership (₹1,999/mo).
- `GET /api/operations/contractors/leaderboard`
  - Returns promoted Prime contractors for business matching.

### 4.3. Shopping Cart Parts Orders
- `POST /api/operations/cart/orders`
  - Body: `{ items, delivery_address, payment_method, verification_pin, subtotal_paise, gst_paise, delivery_fee_paise, total_paise }`
  - Creates parts order record with `payment_status: 'paid'` and `delivery_status: 'processing'`.

---

## 5. Design System Tokens & Styling Guide

The Contractor workspace strictly adheres to the Agent App design tokens defined in `operations.css`, `agent-workspace.css`, and `contractor-tenders.css`:

```css
/* Container Bounding */
.operations.ops-worker.contractor-app {
  max-width: 640px;
  margin: auto;
  padding: 24px 20px calc(110px + env(safe-area-inset-bottom));
  min-height: 100dvh;
  background: #fbfcfe;
}

/* 4-Tile Interactive Button Grid */
.contractor-button-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin: 16px 0;
}

/* Spec Matrix in Tender Cards */
.contractor-columns-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 12px;
  background: #f8fafc;
  border: 1px solid #dbe4f0;
  border-radius: 14px;
  padding: 12px 14px;
}
@media (min-width: 520px) {
  .contractor-columns-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

/* Modal Form Grids */
.contractor-modal-form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 10px;
}
```

---

## 6. Test Suites & Verification Status

### Frontend Unit Tests
- `node --test tests/booking.test.mjs`: **9 passed, 0 failed** (110ms)
- `node --test tests/cart_tenders.test.mjs`: **2 passed, 0 failed** (50ms)
- **Total Frontend Tests**: **11 passed, 0 failed**

### Backend Tests
- `backend/.venv/bin/pytest test_tenders.py test_operations.py`: **22 passed, 0 failed** (2.02s)
  - 4 tender/cart test cases
  - 18 core operations test cases

### Build Status
- `npm run build`: Exit code 0 (`dist/` directory generated, 61 assets)
- `npm run build:cpanel`: Exit code 0 (`dist-cpanel/` directory generated, 61 assets)
- `firebase deploy --only hosting`: Deployed to `https://repaido.web.app`

---

## 7. Next Continuation Tasks for Codex

When continuing development on this codebase, Codex should focus on the following roadmap items in priority order:

1. **Android APK Compilation (Capacitor/Gradle)**:
   - When recompiling the Android APK for field agents, ensure the login screen exposes the role switcher (`Technician` vs `Contractor`).
   - Deep linking `/worker?mode=contractor` should directly open the Contractor Portal on mobile.
2. **Production cPanel Deployment (`repaido.com`)**:
   - The verified cPanel archive is built and stored at:
     - `/Users/miku0027/Desktop/repaido-cpanel-full-release-20260930.zip`
     - `/Users/miku0027/Downloads/repaido-cpanel-full-release-20260930.zip`
   - To update `repaido.com`, extract this zip directly into `public_html` via cPanel File Manager or FTP.
3. **Live Payment Gateway Webhooks (Razorpay / Cashfree)**:
   - Currently, tender sitting fee payments (₹1,499) and Contractor Prime subscriptions (₹1,999/mo) operate in instant verification mode.
   - For live banking settlement, hook up Razorpay/Cashfree order generation and signature verification in `backend/tenders.py` under `/api/operations/tenders/{id}/bids` and `/api/operations/contractor/prime`.
4. **Real-time Geofence Tracking**:
   - Connect the Geofence commands modal to live GPS coordinates emitted by technicians using the existing `currentPosition(true)` stream in `LiveWorkerPortal.tsx`.
