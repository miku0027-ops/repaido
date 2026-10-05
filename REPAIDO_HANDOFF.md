## Shop Admin Collapsible Sidebar, Notification Bell Deep-Linking & Company Oversight — 2026-10-03
- **Ergonomic Collapsible Side Navigation Bar (`ShopAdminPortal.tsx`)**:
  - Re-architected shop side navigation into a modern, high-efficiency collapsible drawer/rail:
    - **Desktop Dynamic Collapsible Rail**: Toggles seamlessly between full-width (`w-64`) and compact icon-only rail (`w-16`). Persists user preference via `isDesktopSidebarCollapsed`.
    - **Dedicated Collapse / Expand Controls**: Header and footer collapse toggles (`PanelLeftClose` / `PanelLeft`) with tooltip indicators and active route highlighting.
    - **Mobile Responsive Drawer**: Off-canvas slide-out drawer (`fixed inset-y-0 left-0 w-72 z-50`) with darkened ambient backdrop overlay (`bg-slate-950/60 backdrop-blur-sm`) and prominent dedicated `X` close button (`X size={20}`) for fast thumb-reach operation.
  - Sidebar navigation organized into clean operational sections: Overview, Orders & Handover, Inventory & Stock, Directives & HQ Oversight, and Ledger & Payouts.

- **Top-Right Notification Bell & One-Click Deep-Linking (`ShopAdminPortal.tsx` & `repaidoService.ts`)**:
  - Positioned high-visibility Notification Bell (`Bell`) at the top right corner of the Shop Admin header.
  - **Dynamic Unread Badge**: Live red glowing pill counter (`animate-pulse`) displaying exact count of actionable requests (e.g. `8`).
  - **Floating Notification Center Dropdown**:
    - Filter tabs (`All`, `Urgent`, `HQ Directives`) for quick triaging during busy business hours.
    - Priority color coding: Urgent (`red-500` border & badge), High (`amber-500` border & badge), Normal (`blue-500` badge).
    - Clear-all and mark-as-read controls with real-time state synchronization.
  - **Zero-Friction One-Click Deep-Linking**:
    - Clicking any notification item automatically marks it as read and immediately routes the shop owner to the exact target tab (`orders`, `inventory`, `company_oversight`, `ledger`).
    - Bypasses manual searching by auto-populating order search filters and auto-launching handover modals, stock adjustment modals, or directive acknowledgment dialogs, completely eliminating operational delays during peak business hours.

- **Company Admin Oversight & Shop Operational Controls (`repaidoService.ts` & `ShopAdminPortal.tsx`)**:
  - Implemented company-level administrative oversight suite within the Shop Admin view:
    - **Emergency Operational Freeze / Unfreeze**: Enables Company HQ Admins to immediately freeze or unfreeze shop activities (`isOperationsFrozen`, `suspended_by_hq`) with mandatory audit reason logging.
    - **Automatic Catalog Delisting**: Freezing a shop immediately unlists its active products from customer marketplace search and listings to protect consumers.
    - **Official Directive Broadcast System**: Company Admin can dispatch urgent compliance directives, audit notices, or operational updates directly to the shop, complete with priority levels (`urgent`, `high`, `normal`), category tags, and resolution deadlines.
    - **Directives Audit Trail & Shop Acknowledgment**: Full ledger tracking directives dispatch and shop acknowledgment with timestamps (`Acknowledge & Confirm Completed`).
    - **Live SLA & Operational Metrics**: Real-time monitoring of average order handover speed (e.g. 14 mins), platform commission tiers, onboarded working capital, and KYC compliance status.

- **Shop Inventory Enhancements, Mandatory HSN Codes & Condition Lifecycle Management**:
  - **Mandatory HSN Code Field**: Added 4-to-8 digit HSN code specification (`hsnCode`) in product creation and editing modals with real-time tax code validation.
  - **Product Condition Classification**: Full support for `brand_new`, `certified_refurbished`, and `pre_owned` (second-hand) item conditions.
  - **Condition-Specific Quality Attributes**:
    - Refurbished items include condition grade (`Grade A+`, `Grade A`, `Grade B`), 40-point diagnostic inspection verification, and warranty duration (3 to 12 months).
    - Second-hand listings enforce seller condition disclosures, functionality tests, and physical condition notes.
  - **Automated Marketplace Synchronization**: Shop inventory updates (stock adjustments, condition changes, pricing, and HSN updates) synchronize instantaneously to the live customer marketplace.
  - **GST Tax Invoices & Delivery Challans**: Auto-generates compliant GST tax invoices displaying shop GSTIN, customer details, HSN breakdown, 18% GST calculation (9% CGST + 9% SGST), and delivery challan notes.

- **Horizontal Category & Filter Rails Standardization & Above-the-Fold Product Previews**:
  - Standardized horizontal category and filter rails across all marketplace sections (`SparePartsShop.tsx`, `B2BMarketplace.tsx`, `refurbished-market.css`, `b2b-marketplace.css`):
    - **Consistent 32px Button Height**: Compact ergonomic pill shape across all category chips.
    - **Signature Repaido Navy Theme**: Active states strictly use signature deep navy (`#142858` / `#0c1f42`) with subtle shadow and white text.
    - **Preserved Above-the-Fold Previews**: Reduced padding and excessive vertical white space across rails and hero banners, guaranteeing that at least 1 full row of catalog products remains visible immediately upon landing without requiring scroll.
    - **Applied Uniformly Across All Tabs**: Main Marketplace, Certified Refurbished, B2B Wholesale, Pre-Owned / Second Hand, and Tool Rentals.

- **Automated Verification & Live Firebase Deployment**:
  - Created automated test suites:
    - `web/tests/shop_admin_collapsible_and_notifications.test.mjs`
    - `web/tests/shop_inventory_and_conditions.test.mjs`
    - `web/tests/category_rail_standardization.test.mjs`
  - Total test suite: **100/100 unit tests passing** (0 failures).
  - Production build: `tsc -b && vite build` built with 0 errors.
  - Deployed live to Firebase Hosting: `https://repaido.web.app`.

## Event-Driven Customer Behavioral Hydration & Ultra-Smooth Motion Services Grid — 2026-10-02
- **Event-Driven Behavioral Hydration Engine (`customerBrowseTracker.ts`)**:
  - Implemented rolling 1-hour window tracking (`ONE_HOUR_MS = 3,600,000 ms`) with threshold of `>= 3` browse actions.
  - Automatically records customer browsing activity (app load, tab switches, category explore, service detail view).
  - Self-healing storage pruner: Automatically filters expired events older than 1 hour upon every read/write.
  - Reactive DOM dispatching via `CustomEvent('repaido:browse-activity')` and storage synchronization:
    - First-time / Casual visitors (`< 3` browse events in 1h): Render the clean, fast, distraction-free **Static Services Grid** (`ServiceStaticCardItem`).
    - High-intent returning customers (`>= 3` browse events in 1h): Hydrate into the **Dynamic Motion Services Grid** (`ServiceMotionCardItem`) with 5-stage carousel, 2 offer slides, ambient underglow, and moving shimmer reflections.
- **Static Services Grid Architecture (`HomeServicesGrid.tsx`)**:
  - Retains the exact same 6 primary trades without changing services:
    1. **Home Cleaning**: `⭐ 4.9 (2.4k+)` · `Deep Home Clean`
    2. **Plumbing**: `⚡ 15m Arrival` · `Pipe & Leak Repair`
    3. **Electrician**: `🛡️ Certified Pro` · `Wiring & Safety`
    4. **Appliance Repair**: `⭐ 4.8 Rating` · `Repair & Service`
    5. **Vehicle Road Assistance**: `⚡ 24x7 Roadside` · `Towing & Battery`
    6. **Gardening Help**: `🌱 Expert Care` · `Lawn & Plant Care`
  - Zero-rotation, zero CPU timers, instant first-contentful-paint clarity for newcomers.
  - Shares the identical 3-column responsive dimensions (`min-height: 142px`), ensuring zero layout shift when hydrated.
- **Hardware-Accelerated Fluid Motion & Animation Smoothness (`home-services-grid.css`)**:
  - **GPU Hardware Acceleration**: Added `will-change: transform, opacity;`, `transform: translate3d(0, 0, 0);`, and `backface-visibility: hidden;` across all cards, badges, graphics, and caption tickers.
  - **Organic Spring Curves**: Upgraded all keyframe curves to fluid Apple/iOS style `cubic-bezier(0.22, 1, 0.36, 1)`.
  - **Micro Blur Optical Flow**: Graphics transitions now smoothly interpolate `translate3d(0, 8px, 0) scale(0.92) blur(1.5px)` to `scale(1) blur(0px)`, giving a high-end cinematic feel on mobile OLED and desktop displays.
  - **Soft Glow Blooming**: Ambient underglow shadow transitions smoothly over `0.45s cubic-bezier(0.22, 1, 0.36, 1)` when rotating between standard attributes and amber/rose offer slides.
  - **Hydration Entrance Reveal**: Smooth container transition with `.repaido-services-grid-hydrated` running `services-grid-hydrate-reveal`.
- **Automated Test Suite & Live Deployment**:
  - Created `web/tests/customer_browse_hydration.test.mjs` verifying:
    - First-time visitors (1 or 2 visits) remain on static grid.
    - 3 browse events within 1 hour trigger dynamic motion grid hydration.
    - Expired events (> 1 hour old) are properly pruned and do not count.
    - 4th and subsequent browse events maintain hydration continuously.
    - Exact 60-minute window boundary validation.
  - Full test suite: **86/86 unit tests passing** (0 failures).
  - Production build: `npm run build` passed with zero errors.
  - cPanel release bundle: `deployment/package_cpanel.py` generated `repaido-cpanel-20260924.zip` (75 MB).
  - Live deployment: Deployed to Firebase Hosting (`https://repaido.web.app`).

## Marketplace On-Screen Category Rail, Certified Refurbished Ecosystem & B2B Micro-Hero — 2026-10-02
- **On-Screen Horizontal Category Rail (`SparePartsShop.tsx` & `refurbished-market.css`)**:
  - Replaced hidden category filtering with an on-screen horizontal scrollable category rail placed directly below the discovery dock.
  - Featured prominent `🔄 Refurbished` chip with green tint (`#f0fdf4`), emerald border (`#86efac`), and glowing orange `FEST` pill badge.
  - Comprehensive category rail coverage for customer discovery and seller catalog expansion:
    - `🔄 Refurbished` (Festive Spotlight)
    - `✨ All Spares` (Complete Catalog)
    - `📱 Gadgets` (Wearables, smart home, audio)
    - `📱 Smartphones` (Flagship & premium pre-owned)
    - `💻 Laptops & IT` (Certified workstations & ultrabooks)
    - `❄️ AC & Cooling` (Inverter split ACs & cooling spares)
    - `🧺 Appliances` (Front/top load washing machines, refrigerators)
    - `🔧 Pro Tools` (Rotary hammers, power tools)
    - `⚡ Electrical & Wire` (MCBs, cables, switchgear)
    - `🚰 Plumbing & Pipes` (Pumps, valves, fittings)
- **3-Month Current Season Refurbished Shining Cards (`.refurb-season-spotlight-section`)**:
  - Rendered when `selectedCategory === 'refurbished'` or condition filter is set to refurbished:
    - **Card 1: Mega Refurb Fest** (`theme-fest` Flame/Orange gradient): `🔥 Q4 MEGA FEST` · `Up to 70% OFF MRP` · `Season Offer · 3 Months`.
    - **Card 2: 7-Day Money Back Guarantee** (`theme-moneyback` Emerald/Teal gradient): `🛡️ ZERO RISK` · `100% Money Back` · `Instant Doorstep Return & Refund`.
    - **Card 3: 40-Point Diagnostic Check** (`theme-warranty` Sapphire/Indigo gradient): `🔍 CERTIFIED PASS` · `40-Point Diagnostic` · `12 Months Warranty`.
  - Continuous diagonal light sweep (`refurb-moving-shine`) with matte finish, reverse white typography, and AAA contrast.
  - Extremely concise, micro-element copy strictly following "use as much as less fonts and texts".
- **Condition Grade Filters & Certified Quality Badges**:
  - Refurbished condition grade chips bar (`All Grades`, `⭐ Grade A+ Like New`, `✨ Grade A Superb`, `👌 Grade B Value`).
  - Product card badges: `.refurb-grade-pill` (green for A+, blue for A) and `.refurb-moneyback-pill` (`🛡️ 7D Return`).
  - Detail modal refurbished policy section: Displays 7-day money back terms, 40-point hardware diagnostic test logs, warranty duration, and doorstep pickup assurance.
- **Seeded Multi-Category Refurbished Catalog (`data.ts` & `repaidoService.ts`)**:
  - Seeded certified inventory:
    - `refurb-macbook-air-m2`: Apple MacBook Air M2 (Grade A+, 12M Warranty, 40-Pt passed, 7-Day Money Back).
    - `refurb-iphone-14-pro`: Apple iPhone 14 Pro 128GB (Grade A+, 98% Battery Health, 12M Warranty).
    - `refurb-samsung-s23-ultra`: Samsung Galaxy S23 Ultra 5G (Grade A, Knox security passed, 6M Warranty).
    - `refurb-daikin-inverter-ac-15`: Daikin 1.5 Ton Inverter AC (Grade A+, 450 PSI pressure-tested, 12M Warranty).
    - `refurb-bosch-washing-machine-8kg`: Bosch 8 kg Inverter Front Load (Grade A, drum anti-vibration calibrated, 12M Warranty).
    - `refurb-bosch-rotary-hammer-drill`: Bosch Professional GBH 2-28 F (Grade B, genuine OEM brushes, 6M Warranty).
  - Sanitization logic in `repaidoService.ts` automatically merges certified refurbished inventory into existing browser storage without clobbering user carts.
- **B2B Hero Card Vertical Height Reduction & Micro-Elements (`B2BMarketplace.tsx` & `b2b-marketplace.css`)**:
  - Removed clashing oversized yellow buttons and bulky nav arrows.
  - Re-architected into a streamlined micro-hero card (`height ~74px`):
    - Top micro-row: Compact title (`Boxes size={14}`), `0% Listing Fee · 48h Escrow` pill, and sleek `Dealer Schemes` link.
    - Single-row capsule track: 38px micro-cards with moving shine sweep (`.b2b-micro-capsule-card`), micro category tags, and 4px indicator dots.
    - Pushes wholesale search bar, category chips (`🏗️ Tender Raw Materials`, etc.), and live listings above the fold so business owners and contractors see catalog items immediately upon landing.
- **Automated Test Suite & Live Deployment**:
  - Created `web/tests/refurbished_marketplace.test.mjs` verifying:
    - 7-Day Money Back guarantee across certified units.
    - 40-Point Diagnostic inspection and verified warranty terms.
    - Condition grade conformity (`Grade A+`, `Grade A`, `Grade B`).
    - Up to 70% OFF MRP discounts.
    - Category rail filtering by category, grade, and search query.
  - Full test suite: **81/81 unit tests passing** (0 failures).
  - Production build: `npm run build` completed with zero TypeScript errors.
  - cPanel release bundle: `deployment/package_cpanel.py` generated `repaido-cpanel-20260924.zip` (75 MB).
  - Live deployment: Deployed to Firebase Hosting (`https://repaido.web.app`).

## Home Services Dynamic Motion Grid, 3D Option Carousel, Multi-Layer Depth Shadows & Offer Slides — 2026-10-02
- **Home Services Motion Grid Architecture (`HomeServicesGrid.tsx` & `home-services-grid.css`)**:
  - Replaced flat static service buttons with a high-level international UI motion grid holding 6 primary trade cards:
    - **Home Cleaning** (`#059669` Emerald theme)
    - **Plumbing** (`#0284c7` Sky Blue theme)
    - **Electrician** (`#d97706` Amber Gold theme)
    - **Appliance Repair** (`#2563eb` Royal Sapphire theme)
    - **Vehicle Road Assistance** (`#ea580c` Flame Orange theme)
    - **Gardening Help** (`#10b981` Vibrant Mint theme)
- **Multi-Layered Depth Shadows & Ambient Underglow**:
  - Standardized on modern international global app aesthetics:
    - Rest state: Multi-tiered ambient diffusion shadows (`0 3px 6px -1px rgba(20,40,88,0.05), 0 8px 20px -3px rgba(20,40,88,0.09), 0 16px 32px -6px rgba(20,40,88,0.04)`) plus crisp top-lit border reflection (`inset 0 1px 0 rgba(255,255,255,0.95)`).
    - Ambient bottom underglow (`.repaido-service-card-shadow-ambient`): Radiates soft blurred colored light matching each category's specific brand accent.
    - Hover / Focus elevation: Smooth `translateY(-4px) scale(1.018)` lift with deep elevation shadows (`0 18px 36px -4px rgba(20,40,88,0.16), 0 26px 52px -8px rgba(20,40,88,0.10)`) and dynamic neon aura.
- **Moving Shine / Shimmer Light Reflection**:
  - Periodic angled diagonal light sweep (`.repaido-service-card-shimmer` with `card-shimmer-pass`) gliding across cards at staggered 9–14s intervals, creating a breathing, state-of-the-art super-app feel.
- **Non-Uniform, Organic Staggered Timings**:
  - Eliminated robotic synchronized flipping by assigning prime, staggered intervals with organic jitter (±250ms):
    - Cleaning: `3500ms`, offset `0ms`
    - Plumbing: `4300ms`, offset `1300ms`
    - Electrician: `3900ms`, offset `2600ms`
    - Appliance: `4700ms`, offset `700ms`
    - Vehicle: `4100ms`, offset `1900ms`
    - Gardening: `4500ms`, offset `3100ms`
  - Hover pause: Card pauses smoothly when the user hovers, allowing comfortable reading.
- **5 Dynamic Slides per Card (Trade Options & 2 Dedicated Offer Slides)**:
  - Each button now conveys full service variety and promotional deals without requiring the customer to click:
    1. **Home Cleaning**:
       - Slide 0: Base 3D icon · `Home Cleaning` · `⭐ 4.9`
       - Slide 1 (Option): 3D Chrome Faucet & Tiles · `Kitchen & Bath` · `Sanitized`
       - Slide 2 (**OFFER 1**): 3D Discount Tag · `⚡ Flat 25% OFF` · `FESTIVE SALE` with pulsing radar dot
       - Slide 3 (Option): 3D Plush Armchair · `Sofa & Fabric` · `Fabric Safe`
       - Slide 4 (**OFFER 2**): 3D Rupee Shield · `🏷️ Starts @ ₹299` · `BEST VALUE`
    2. **Plumbing**:
       - Slide 0: Base 3D icon · `Plumbing` · `⚡ 15m Arrival`
       - Slide 1 (Option): 3D Motor Pump & Tank · `Motor & Tank` · `Jet Pressure`
       - Slide 2 (**OFFER 1**): 3D Twin Wrench Deal · `⚡ Flat ₹150 OFF` · `COMBO PACK`
       - Slide 3 (Option): 3D Rain Shower & Drain · `Drains & Pipes` · `Zero Blockage`
       - Slide 4 (**OFFER 2**): 3D Free Waiver Coin · `🏷️ ₹99 Visit Fee` · `FEE WAIVED`
    3. **Electrician**:
       - Slide 0: Base 3D icon · `Electrician` · `Govt Certified`
       - Slide 1 (Option): 3D Inverter & Breaker · `MCB & Inverter` · `Surge Safe`
       - Slide 2 (**OFFER 1**): 3D Safety Shield · `⚡ Flat 20% OFF` · `SAFETY PACK`
       - Slide 3 (Option): 3D Geyser & Smart LED · `Geyser & Lights` · `Shockproof`
       - Slide 4 (**OFFER 2**): 3D Fixed Price Lock · `🏷️ Starts @ ₹149` · `FIXED PRICING`
    4. **Appliance Repair**:
       - Slide 0: Base 3D icon · `Appliance Repair` · `All Brands`
       - Slide 1 (Option): 3D Split AC Jet Wash · `AC Jet Clean` · `Deep Foam Jet`
       - Slide 2 (**OFFER 1**): 3D Snowflake Ribbon · `⚡ Save ₹300 on AC` · `SUMMER SAVER`
       - Slide 3 (Option): 3D Fridge & Microwave · `Fridge & Oven` · `Genuine Spares`
       - Slide 4 (**OFFER 2**): 3D Golden Warranty Seal · `🛡️ 90-Day Free Warranty` · `REPAIDO SHIELD`
    5. **Vehicle Road Assistance**:
       - Slide 0: Base 3D icon · `Road Assistance` · `🚨 20m Arrival`
       - Slide 1 (Option): 3D Tyre & Jumper Clamps · `Battery & Tyre` · `On-Spot Fix`
       - Slide 2 (**OFFER 1**): 3D Emergency Beacon · `⚡ Flat 30% OFF` · `HIGHWAY SOS`
       - Slide 3 (Option): 3D Jerrycan & Golden Key · `Fuel & Lockout` · `Emergency SOS`
       - Slide 4 (**OFFER 2**): 3D Calibrated Meter · `🏷️ Starts @ ₹199` · `ZERO SURCHARGE`
    6. **Gardening Help**:
       - Slide 0: Base 3D icon · `Gardening Help` · `🌿 100% Organic`
       - Slide 1 (Option): 3D Shears & Topiary · `Pruning & Trim` · `Designer Topiary`
       - Slide 2 (**OFFER 1**): 3D Green Medallion · `⚡ Flat 20% OFF` · `GREEN HOME`
       - Slide 3 (Option): 3D Neem Bottle & Soil · `Soil & Pest` · `Pet Safe`
       - Slide 4 (**OFFER 2**): 3D Pass Card · `🏷️ Starts @ ₹249` · `MONTHLY PASS`
- **Micro Progress Dots & Interactive Cues**:
  - 5 micro pill dots at the bottom of each card indicate slide progress in real time.
  - Active dot smoothly expands into a 12px pill in the category accent color; offer slides glow with a warm amber/flame gradient.
- **Verification & Deployment**:
  - Unit tests: 75/75 passing cleanly (`node --test web/tests/*.test.mjs`), including new `home_services_motion.test.mjs`.
  - Production build: Passing in 5.13s with zero errors (`npm run build`).
  - cPanel release: Updated `deployment/releases/repaido-cpanel-20260924.zip`.
  - Firebase Hosting: Deployed live to `https://repaido.web.app` (`HTTP/2 200 OK`).

## Customer Header Frameless Icons, B2B Compact Motion Carousel & Contractor Procurement Integration — 2026-10-02
- **App Shell Header Icons Polish (Frameless Deep Blue Fill & Proper Spacing)**:
  - Addressed customer header action buttons (Notification Bell, Cart, and Profile icon):
    - Removed circular logo frames, outlines, borders, and pills entirely (`background: transparent !important`, `border: none !important`, `box-shadow: none !important`, `border-radius: 0 !important`).
    - Filled SVG icon glyphs directly with Repaido Deep Blue (`#142858 !important`) at 24px (and `ShoppingCart` at 22px).
    - Widened spacing between the 3 top action buttons from congested layout to `22px !important` on desktop/tablet, `16px` on mobile (<=480px), and `12px` on small devices (<=360px).
    - Positioned unread notification count badge and cart quantity count pill smoothly on the top-right corner of the frameless icons without container clipping.
    - Added subtle hover lift (`transform: translateY(-1.5px)`) and soft depth shadow (`drop-shadow(0 2px 5px rgba(20, 40, 88, 0.2))`).
- **Compact B2B Hero Card with Motion Graphics Slideshow Carousel (`B2BMarketplace.tsx` & `b2b-marketplace.css`)**:
  - Replaced tall 240px static banner with a sleek, low-height compact card (`.b2b-compact-hero-card`).
  - Implemented an animated slideshow carousel containing 6 uniform-dimension rectangular cards (`280px` wide, `92px` high) across 6 matte jewel gradients (Emerald, Sapphire, Amethyst, Amber, Cyan, Slate).
  - Infused motion graphics:
    - Diagonal continuous shine sweep (`b2b-moving-shine`) echoing the home screen's featured service card aesthetics.
    - Animated typography tickers (`b2b-ticker-drift`) dynamically highlighting wholesale categories, bulk discounts, and distributor profit margins.
    - Interactive controls: auto-advance timer (4.2s), pause on hover, manual previous/next navigation buttons, and slide dot indicators.
- **Repaido B2B Dealer Profit-Making Schemes vs IndiaMART**:
  - Flashed high-impact dealer profit-making schemes competing directly with IndiaMART and Udaan:
    1. **0% Brokerage Scheme**: Zero platform commission on the first 3 full truckload shipments.
    2. **48-Hour Commercial Escrow Disbursal**: Guaranteed vendor payout upon verified delivery — zero credit default risk.
    3. **500+ Active Contractor Demand Pipeline**: Direct access to verified civil, electrical, HVAC, and mechanical contractors fulfilling government and corporate tenders.
    4. **Automated GST ITC & E-Way Bills**: Instant HSN tax invoice pass-through and automated e-way bill generation.
    5. **Zero Listing Subscription Fees**: Eliminates IndiaMART's ₹30,000–₹1,50,000/yr upfront pay-per-lead charges.
    6. **Contractor Volume Rebates**: 1.5%–3.5% quarterly cash rebates for consistent procurement volume.
  - Added an interactive **"Compare Repaido vs IndiaMART"** modal with a comprehensive comparative matrix covering listing fees, lead quality, payment escrow, logistics tracking, and contractor demand pipelines.
- **Theme-Matched Reusable UI & Search Component**:
  - Replaced ad-hoc search field in the B2B dashboard with the canonical reusable `CustomerSearchField` component from `ui.tsx`.
  - Added a dedicated `🏗️ Tender Raw Materials` category filter chip alongside Electrical, HVAC, Plumbing, and Hardware.
  - Aligned all category rails, modals, tabs, cards, and toggles with Repaido design tokens.
- **Contractor Portal Integration for Raw Material Procurement & Supply Responsibility**:
  - Contractors can now procure raw materials directly from their Contractor Workspace (`ContractorPortal.tsx`):
    - Added dedicated `'B2B Raw Materials'` navigation tab in the Contractor Workspace.
    - Added an overview entry card: *"Procure B2B Raw Materials & Spares — Source wholesale building supplies, bulk cables, pipes, and tender materials with verified GST tax invoices"*.
    - Multi-Market Switcher within the contractor workbench: lets contractors source across B2B Wholesale, Refurbished machinery, Pre-owned tools, New OEM parts, and Surplus exchange without leaving their workspace.
    - Connected active tenders to B2B procurement: RFQ forms now accept optional `rfqTenderRef` linking raw material procurement directly to specific contracts.
    - Added direct *"Procure tender raw materials"* action buttons on `TendersPlatform.tsx` hero banner and inside the Tender Detail modal.
    - Wired `onOpenB2BMarket` through `App.tsx` and `LiveWorkerPortal.tsx` to `ContractorPortal.tsx`.
- **Validation**:
  - All 72 unit tests passing cleanly (`node --test web/tests/*.test.mjs`), including new tests for contractor tender RFQs and dealer profit metrics.
  - Production build passing cleanly in 5.88s with 0 errors (`npm run build`).

## Side-wise Notification Bar & Micro-Typography Color-Coded Drawer — 2026-10-02
- **Slide-Over Side Notification Bar (`CustomerNotificationDrawer.tsx` & `customer-notifications.css`)**:
  - Connected app shell header notification bell icon (`.repaido-bell-btn`) and desktop sidebar to a dedicated slide-over side bar drawer (sliding in smoothly from the right with `translateX(0)`).
  - Replaced the previous generic centered popup dialog with a sleek 415px side panel (full-width on mobile) featuring a frosted backdrop (`rgba(15, 23, 42, 0.45)` with `backdrop-filter: blur(4px)`), Escape key listener, and backdrop click-to-dismiss.
- **Refined Micro & Small Level Typography**:
  - Solved the oversized desktop fonts by standardizing all elements to compact, high-legibility micro scales:
    - Drawer Title: 14px (`0.875rem`) bold Repaido Deep Blue (`#142858`).
    - Unread Count Pill: 10px (`0.625rem`) rounded-full pill.
    - Header Actions: 11px (`0.6875rem`) semibold ("Mark all read" with `CheckCheck`, "Refresh" with `RefreshCw`).
    - Filter Chips: 11px (`0.6875rem`) rounded-full pills ("All", "B2B Quotes", "Bookings", "Arrivals", "Offers", "Escrow").
    - Notification Micro Tags: 9.6px (`0.6rem`) uppercase bold tracking-wider badges.
    - Relative Timestamps: 10px (`0.625rem`) muted slate text ("Just now", "5m ago", "2h ago", "Yesterday").
    - Card Titles: 12.4px (`0.775rem`) font-semibold slate-900.
    - Card Body Text: 11.4px (`0.715rem`) font-normal slate-600 with clean 1.45 line-height.
    - Micro Action Buttons: 10.8px (`0.675rem`) font-semibold pill buttons with 11px glyphs.
    - Unread Indicator: 6px pulsing accent dot with soft glowing radial halo.
- **Vibrant Status & Type Color Palettes**:
  - **B2B Wholesale / Quotation**: Royal Indigo border (`#4f46e5`), subtle indigo tint gradient, `FileText` glyph, `B2B QUOTATION` tag, and direct "View Quotation PDF & Deal" button with 1-click official Repaido Quotation PDF launch.
  - **Doorstep Ready / Arrival / OTP**: Warm Amber & Flame border (`#d97706`), amber tag, `MapPin` glyph, and "Doorstep PIN & Tracking" button.
  - **Live Service / En Route**: Ocean Sky border (`#0284c7`), sky tag, `Truck` / `Wrench` glyph, and "Track Technician" button.
  - **Completed Service**: Emerald Green border (`#059669`), mint tint, `CheckCircle2` glyph, and "View Invoice & Bill" button.
  - **Escrow & Payments**: Deep Teal border (`#0d9488`), teal tag, `CreditCard` / `ShieldCheck` glyph, and "View Payment Details" button.
  - **Festive Offers & Deals**: Imperial Purple border (`#9333ea`), purple tag, `Sparkles` glyph, and "Claim Offer" button.
  - **Marketplace & Spares**: Royal Sapphire border (`#2563eb`), blue tag, `ShoppingBag` glyph, and "Browse Marketplace" button.
  - **Repaido Home**: Warm Gold border (`#ca8a04`), gold tag, `Crown` glyph, and "View Home Plan" button.
- **Direct 1-Click Quotation PDF Integration**:
  - Clicking "View Quotation PDF & Deal" on any B2B quotation notification automatically closes the drawer and displays the full official Repaido-branded A4 Quotation PDF via `B2BQuotationPdfModal`.
- **Validation & Deployment**:
  - Unit tests: 70/70 frontend tests passed (`node --test web/tests/*.test.mjs`), including new `notification_drawer.test.mjs`.
  - Backend integration tests: `pytest backend/test_b2b.py` passed with 100%.
  - Production Builds: Clean Vite build (`dist`) and cPanel build (`dist-cpanel`).
  - Firebase Hosting: Deployed live to `https://repaido.web.app` (all 69 files verified against SHA-256 hashes).
  - cPanel release: Generated package `deployment/releases/repaido-cpanel-notifications-20261002.zip` (742 KB).

## B2B Wholesale Marketplace, RFQ & Official Branded Quotation PDF — 2026-10-02
- **Customer Markets Tab B2B Wholesale Hub**:
  - Added new dedicated `B2B Wholesale` toggle tab in the Markets screen (`tab === 'ShopSpares' & marketSub === 'b2b'`) positioned alongside `Marketplace` and `Contracts`.
  - IndiaMART / Udaan / Alibaba-style wholesale discovery experience (`B2BMarketplace.tsx`): MOQ (Minimum Order Quantity) badges, category filter chips (HVAC, Electrical, Hardware, Plumbing, Tools, Chemicals), live search, distributor verification badges, stock & supply capacity indicators, lead time SLA, and multi-tier wholesale pricing slab tables.
  - Quick MOQ cart addition: 1-tap "Quick Order MOQ" seamlessly adds minimum order wholesale lots directly into `cartService` and opens the customer Cart slide-over drawer.
- **RFQ (Request For Quotation) System**:
  - Customers can click "Request Bulk Quote" on any wholesale listing to open an inquiry modal.
  - Captures: quantity required (strictly enforcing MOQ), target price per unit (₹), buyer company/business name, buyer GSTIN, delivery address, pincode, delivery urgency, and custom project notes.
  - Automatically registers in `b2bService` and dispatches immediate notification to the distributor / shop admin.
  - "My Inquiries & Quotations" tab inside B2B Marketplace allows customers to monitor submitted RFQs in real time with status pills (`Pending Quote`, `Quotation Issued!`, `Deal Accepted`) and review issued quotations.
- **Shop Admin B2B Portal & Lifecycle Management**:
  - Added dedicated `B2B Wholesale` tab in `ShopAdminPortal.tsx` and sidebar link in `OperationsAdmin.tsx`.
  - Wholesale metrics overview: active listings, pending RFQs, closed deals, and pipeline revenue volume.
  - Inventory lifecycle control: Add new wholesale items, edit specifications, toggle Active / Paused / Archived states, define MOQ, HSN codes, and configure custom multi-tier bulk pricing slabs.
  - Incoming RFQ Inbox with interactive **Quotation Builder Form**:
    - Shop admin inputs offered wholesale rate, confirmed quantity, applicable GST rate (0%, 5%, 12%, 18%, 28%), freight & logistics charges, payment escrow terms, delivery timeline, warranty & certification terms, quote validity period, and authorized signatory details.
    - Live calculation of Taxable Amount, GST breakdown, Freight, and Grand Total.
    - 1-click Quotation Submission: notifies the customer and updates RFQ status to `quoted`.
- **Repaido-Branded Quotation PDF & A4 Engine**:
  - `B2BQuotationPdfModal.tsx` and `b2b-quotation.css` provides a pixel-perfect, print-ready A4 commercial quotation.
  - Deep Repaido Blue (`#142858`) branding, squircle logo, quotation reference number (`REP-B2B-QT-YYYY-XXXX`), and validity dates.
  - Seller / Distributor and Consignee / Buyer details with GSTIN numbers.
  - Itemized commercial schedule (HSN/SAC, Quantity, Unit, Base Rate, Taxable Value, GST %, Freight, Grand Total).
  - Legal Indian Rupee conversion in words (`numberToWordsINR`).
  - Comprehensive commercial terms & conditions (Repaido B2B Escrow guarantee, 48-hour doorstep inspection, transit insurance, and GST tax invoice).
  - Digital authentication seal and authorized signatory block.
  - 1-click "Download PDF / Print" trigger firing native browser print engine with `@media print` rules customized for strict A4 output.
- **Backend APIs & Python Engine**:
  - Endpoints in `backend/b2b.py` and routed in `backend/main.py`:
    - `GET /operations/b2b/listings`: List wholesale listings with MOQ, categories, and bulk slabs.
    - `POST /operations/b2b/listings`: Create wholesale listing.
    - `PUT /operations/b2b/listings/{id}`: Update listing and lifecycle state.
    - `POST /operations/b2b/rfq`: Submit buyer RFQ.
    - `GET /operations/b2b/rfq`: Filter RFQs by shop or customer.
    - `POST /operations/b2b/quotation`: Generate formal commercial quotation.
    - `GET /operations/b2b/quotation/{quote_number}`: Fetch structured quotation details.
    - `GET /operations/b2b/quotation/{quote_number}/pdf`: Download Repaido-branded binary PDF stream (`application/pdf`).
- **Validation & Deployment**:
  - Frontend unit tests: 65/65 passed (`node --test web/tests/*.test.mjs`), including new `b2b_wholesale.test.mjs`.
  - Backend integration tests: 100% passed (`pytest backend/test_b2b.py`).
  - TypeScript & Vite builds: Clean compile for both Firebase (`dist`) and cPanel (`dist-cpanel`).
  - Firebase Hosting: Deployed live to `https://repaido.web.app` (69 files uploaded and finalized, release verified against SHA-256 hashes).
  - cPanel release: Generated delta package `deployment/releases/repaido-cpanel-b2b-20261002.zip` (736 KB).

## Header actions & quick discovery marketplace overhaul — 2026-10-01
- Deep dark Repaido blue circular header action buttons: Cart, Notifications (Bell), and Profile converted to 42px circular buttons (`#142858`) with drop shadow (`0 4px 10px rgba(20,40,88,0.28)`), hover lifts, and pure white SVG glyphs (AAA contrast 12.5:1).
- Live notation badge counters: `.repaido-header-badge` displays live numerical counts for cart items, active orders / unread notifications, and profile action items.
- Home quick actions rail redesign: 5 distinct matte palettes (Emerald-Teal, Royal Sapphire, Imperial Amethyst, Burnt Amber, Midnight Ocean) with sweeping light reflections (`quick-moving-shine`), flashing offer tickers (`🔥 UP TO 55% OFF`, `🛡️ 6-MO WARRANTY`, `⭐ 4.9★ RATED PROS`), reverse white typography, and full reduced-motion safeguards.
- 5 dedicated discovery & quick checkout panels:
  - Pre-Owned Used: Dual-mode (Buy Verified Used with fast cart vs Instant 60s Doorstep Valuation & Pickup Request).
  - Certified Refurbished: Budget filters, Grade A+ badges, EMI preview, and 1-tap cart add.
  - Quick Hire: 4.9★ pro matching, 25-35 min arrival SLA, flat ₹149 inspection guarantee.
  - Quick Repair: Symptom triage grid with upfront cost estimation.
  - Home Premium: Festive Durga Puja makeover & modular packages.
- Instant 1-tap checkout: Connected quick panel cards directly to `cartService.addItem(...)` and the customer Cart Drawer slide-over without redirecting through the heavy `/market` tab.
- Validation: 60 frontend unit tests passed (`node --test web/tests/*.test.mjs`), clean TypeScript + Vite builds for both Firebase (`dist`) and cPanel (`dist-cpanel`).
- Firebase Hosting: deployed live to https://repaido.web.app (69 files uploaded and finalized). Verified all 69 files match build SHA-256 hashes via `deployment/verify_firebase_release.py`.
- cPanel release: generated delta archive `deployment/releases/repaido-cpanel-quickactions-20261001.zip` (700 KB, 5 entries: index.html, index-BxvzmeLS.css, index-CaZ5h53W.js, lottie-CBc1z_kv.js, .htaccess).

## Customer live tracking & task details redesign — 2026-09-29
- Redesigned customer LiveTrackingView: replaced oversized, cluttered cards with a high-density, branded Repaido layout. Re-engineered the container with `.live-tracking-overlay` backdrop blur, smooth slide-up mobile sheet / desktop dialog, Escape key dismissal, and backdrop click closure.
- Compact map viewport: balanced height clamp(150px, 20vh, 185px), floating glassmorphic live activity chip (.rt-map-chip) with pulsing dot, and 32px re-center button.
- 5-step milestone segmented tracker: Request → Travel → Arrival → Work → Finish with verified indicators and current-step hero banner.
- High-density technician quick strip: 34px avatar, name, rating badge (4.9 ★), Repaido certified specialist badge, and direct one-tap call button. Address, start time, and payment total organized into a clean 1-line metadata strip.
- Contextual action cards: compact 4-digit doorstep verification PIN card (32x38px boxes, 1.25rem font), parts proposal approval micro-table, work completion sign-off with before/after inspection chips, and 5-star review form.
- Quick actions row: aligned 36px buttons for View Bill, Open in Maps, and Cancel Visit. Collapsible verified milestones accordion and slide-up bill drawer with transparent escrow protection notes.
- Validation: 189 backend pytest passed, 47 frontend unit tests passed, both TypeScript and Vite builds passed (dist and dist-cpanel).
- Firebase Hosting: deployed live to https://repaido.web.app (61 files uploaded and finalized). Verified all 61 files match build SHA-256 hashes via deployment/verify_firebase_release.py.
- cPanel release: generated full package deployment/releases/repaido-cpanel-tracking-20260929.zip (73.2 MB, 62 entries) and fast delta archive deployment/releases/repaido-cpanel-tracking-delta-20260929.zip (553 KB, 4 entries: index.html, index-BEhmIOuc.css, index-C47AETFT.js, .htaccess). Both copied to /private/tmp/ for extraction into /public_html.

## Launch, loading and navigation — 2026-09-29
- Shared AppExperience mounted in main.tsx: 5-second modal launch on customer/worker page loads (not admin paths), branded Puja home imagery and service overview. No fabricated discount or guaranteed performance claim. Existing image asset reused.
- apiFetch now tracks overlapping requests with finally cleanup and default 20 s timeout; delayed non-blocking popover notifier with request-specific labels, slow-state copy and 46 service tips. Reduced motion honored. Image loading shimmer uses load/error capture + added/src-changed image observation. Firestore booking reads tracked too. This covers shared network/image paths; do not claim every native SDK/payment-provider surface was exhaustively tested.
- Tips use categories only from existing personalised discovery feed when enabled; no new covert profiling or persistent behavioural data. Contextual generic/worker tips otherwise.
- Customer and agent bottom tabs saved separately in sessionStorage, valid notification deep links retain precedence and are cleared on switching away. Tab changes scroll page/main to top. Task dialogs/drafts are not universally persisted.
- Fixed likely customer apparent logout cause: legacy App.api used cached token and cleared UI user on any 401. It now waits Firebase restore, uses current Firebase token, and does not clear profile for a failed request. App onIdTokenChanged keeps canonical identity/token in sync. operation also waits authStateReady. Agent token-refresh errors preserve the signed-in account and show retry. Firebase SDK existing persisted login retained; auth invalidation still requires legitimate sign-in.
- Build + 40 frontend checks passed; 61-file live Firebase hash verification passed. Browser at 380×860: Puja splash visually checked; customer Bookings survived refresh with Tushar signed in and actual bookings visible; agent Earnings survived refresh; loading notifier observed during refresh. No physical Android device test. Shared WebView UI updates without a native rebuild.
- Firebase version 1d4acba6b21c9813 / release 1790659770860000, label loading-20260929. Backend unchanged repaido-api-00076-fom. Evidence deployment/reviews/loading-20260929.
- repaido.com NOT deployed: Chrome cPanel handoff still unanswered. Latest cumulative archive deployment/releases/repaido-cpanel-loading-20260929.zip (10 entries includes preceding pending Home imagery and updated debug APKs). Local cpanel manifest is unpublished current build.

## In-task marketplace — 2026-09-29
- Parts & pickups now contains TaskMarket: Buy/Rent tabs, radius 6/7/8 km from confirmed work location, query/category/shop/condition filters and distance/price/name sorting, compact image cards/detail modal, one-shop quote basket. Existing procurement is in an accordion. Rental requests/returns remain accessible inside Rent.
- New authenticated GET /operations/jobs/{job_id}/market in procurement.py: only assigned approved agent, approved shops with coordinates inside radius, recently confirmed available parts and available rental units. No registration/home coordinate substitution. Returns straight-line shop distances.
- Parts quote and rental request mutations preserve existing state/approval/payment/stock/OTP gates. Agents can browse before work; requests remain disabled until permitted. Rental catalogue requests ignore stale fetch results. Customer public rental catalogue unchanged except extra filters/sorting/detail photo.
- Backend repaido-api-00076-fom live 100%; Firebase final 94d4a56aa9ae0070 label task-market-final-20260929 (receipt in review evidence). Shared hosted UI updates Android wrappers; no native changes/new APK build required this turn.
- Mobile live UI: Buy and Rent tabs inspected at 380×860; current task has no eligible stock within 6 km. No orders created or task state changed. Final CSS keeps radius label unwrapped.
- Validation: 184 backend tests, 33 frontend tests, TypeScript + both hosting builds, 23 candidate HTTP read-only smoke checks. Evidence deployment/reviews/task-market-20260929.
- repaido.com pending cPanel handoff. Complete cumulative 10-file archive deployment/releases/repaido-cpanel-task-market-final-20260929.zip includes prior Home images, latest shared UI and both prior updated debug APKs. cpanel-manifest is this unpublished build; do not package next delta as if already live.

## Travel map / arrival release — 2026-09-29
- Latest user request: map inside Travel, controls below, no Visit/bill cards in Travel, automatic 100 m Arrival and loud alerts.
- Implemented AgentTravelMap with real assigned-job tracking, 15 s polling, work-site/100 m/worker accuracy markers, recenter, stale-position removal and privacy checks. Existing server uncertainty-aware geofence (distance + accuracy <=100 m) drives Arrival and retains OTP/evidence gates. Map gestures do not swipe stages.
- Current implementation is a live map overview, NOT turn-by-turn road navigation. Open directions remains available; routing-provider navigation is still outstanding. Do not claim otherwise.
- Both recipients get visit-scoped arrival alerts; relay drops expired/non-arrived/wrong-visit alerts, expires after 5 min. Web uses stronger repeated bell after a user gesture. Android adds arrival channel handling/custom sound; OS volume/DND respected.
- Backend repaido-api-00074-deh at 100% traffic. Firebase final version d4947557ee2e47b1 (travel-final-20260929). Public build includes newly built debug-test APKs agent 1.2.10/code13 and customer 1.0.5/code6, built with production API/host URLs. Old release-named APK files were not rebuilt. Physical-device GPS/background sound not tested.
- Validation: 183 backend tests, 33 frontend tests, both Android debug builds; 23 candidate HTTP smoke checks. Final 61-file Firebase hash verification passed, including both new APKs. Final compact mobile Travel map and lower controls visually inspected at 380×860 without changing task state; browser location permission was off, so no moving GPS test.
- cPanel NOT deployed. Latest complete delta against hire-final baseline: deployment/releases/repaido-cpanel-travel-final-20260929.zip, 10 entries, includes all three pending Home JPEGs and both new debug APKs/metadata. Local cpanel-manifest tracks this unpublished build. Earlier pending Chrome handoff has no user reply; do not compete with user's Chrome.

## Repaido Home / partner programme — 29 September 2026

Backend live: `repaido-api-00072-won` (100% traffic), rollback prior `00068-viy`. Firebase final version `853858afbbec47e8`, release `1790652996504000`, label `home-puja-final-20260929`.

**cPanel pending user leaving Chrome available.** Async request already sent; do not ask again. Initial archive `repaido-cpanel-home-puja-20260929.zip` uploaded 100% to `/home/repaidoc` but NOT extracted. Final archive to use: `deployment/releases/repaido-cpanel-home-puja-final-20260929.zip`, hardlinked `/private/tmp/repaido-cpanel-home-puja-final-20260929.zip`. It contains 7 entries including latest JS `index-Cjmfi1Pq.js`, CSS `index-B9lUiBVa.css`, index, htaccess and all three new JPEGs, so extract ONLY this final archive into `/public_html`. Current cPanel production remains previous hire-final build. Chrome user switched to other pages during final selection; do not interact with those pages. After upload/extract run verify_cpanel.py and save a real UI screenshot through browser-supported workflow.

Implemented: 8 strict, distinct Home service schemas and booking forms; server validation and immutable saved answers; assigned-professional work brief, private customer/assigned-worker/admin PDF routes; active task Work > Customer brief & PDF; Android saveReport bridge reused. Home entry and seasonal modal use generated relevant imagery, JPEG encodes, compact cards, reduced-motion-aware animation. No fabricated real-work portfolio imagery. New contractor application in worker Profile, identity-prerequisite admin approval via Partner programme, audit evidence and version conflicts; customer Hire profile shows verified contractor designation only after approval. Operational technician/specialist roles remain unchanged.

Partner agreement: four required individually checked accordions, server enforced on onboarding; existing workers opt in from Profile. Launch window fixed Sep 29–Dec 29 2026. Default annual criteria (chosen implementation defaults, configurable for NEW agreements): 10 customer-confirmed verified-paid full tasks, >=3 actual reviews averaging >=4.2, >=80% starts within 10 minutes, every counted task has start evidence, approved worker, no unresolved disputes/holds. Only work after acknowledgement and within trial window counts. Accepted thresholds are snapshotted. Scheduler evaluates and idempotently grants Dec 29 2026–Dec 29 2027 listing. Values: technician INR12000, specialist18000, verified contractor24000; no cash or automatic debit. Earned entitlement prevents duplicate membership purchase and is recognised by Hire discovery. Day-hire policy activation/routing limitations from prior release persist.

Validation: full backend 182 passed; targeted final partner/Hire tests 11 passed after earned-listing fix; frontend 9 passed; both TypeScript/Vite builds pass. Private API/auth and live candidate schema smoke verified. Firebase file verification in deployment/reviews/home-puja-20260929. Live browser verified Home modal at actual 380px width, distinct interior form, worker four agreement sections and disabled incomplete submit. PDF both pages rendered and inspected; sample included. No actual Android device / Play release test, no live order/payment or real agreement submitted. Original generated PNGs retained in review source-images and Codex originals; prompt brief in image-prompts.md.

## Hire category-first release — 29 September 2026 (completed)

Latest frontend **hire-final-20260929** is live on BOTH domains. Firebase version `656cdd3d04e135fb`, release `1790650523804000`; JS `index-CxYRpsLY.js`. cPanel JS `index-DlhwwjrY.js`; shared CSS `index-BVn6oKVR.css`. Final cPanel archive `repaido-cpanel-hire-final-20260929.zip` was extracted into `/public_html`; it explicitly includes CSS because the earlier hire-launch archive was uploaded but NOT extracted. Both full 58-file hash verifications pass. Cloud Run `repaido-api-00068-viy` serves 100%; rollback `00066-cuj`; no new IAM or provider settings changed.

Changes: Hire now starts with premium blue category canvas, exact requested title, illustrated/photo Home help cards, compact category tiles. Clicking opens experts modal with level/sort/radius controls, real profiles and comparisons, completed work and all reviews in accordions. Previous-category flash fixed by clearing rows when category changes. My Hire requests moved into Bookings > Hiring, with hired operational work filtered separately from Visits; existing real task/payment/arrival/review controls reused. Hire notification deep links now route to Hiring (worker to Active Task). Footer USP cards form a manual horizontal rail with page-specific copy and city list.

Free approved Hire discovery runs **29 September 2026 00:00 IST to 29 December 2026 00:00 IST**, fixed server timestamps (not rolling per account). Membership payments reject during campaign. Approved profiles listed without paid entitlement; current approval, schedule, fresh-location, range and policy acceptance checks still apply to actual requests. Worker Profile > Hire listing membership opens free-listing offer, range preferences and weekly city/category rank. Weekly rank uses only genuine completed tasks in current IST Monday–Sunday window; ties share ranks; no work means unranked. Public discovery rankings remain lifetime review-confidence rankings and are labelled separately from worker weekly ranks.

Validation: 178 backend tests and 9 frontend tests passed; both production builds passed. Nine candidate API/privacy/auth smoke checks passed and live leaderboard returned two approved profiles. Live browser verified category navigation, actual electrician profile/review, Bookings Hiring separation and 320/380px layout without page overflow. Localhost browser preview was denied by browser access policy and was not retried; live authorized production was verified instead. Evidence and saved production screenshot: `deployment/reviews/hire-launch-20260929/`. Firebase verification timed out once on network, then passed on retry. Native screenshot `repaido.com.png` is 380x860 CSS at 2x.

Live authenticated worker Profile listing panel also verified: free offer and actual weekly results (0 tasks, correctly unranked). No profile preferences were mutated.

Remaining limitations: Day-hire policy still disabled pending route-provider/pricing activation; do NOT claim live paid day hiring is enabled or final end-to-end provider tests complete. No Android native source/APK change in this release (hosted shared UI updates); physical device and Play signing tests remain outstanding. Existing monthly Home plan management remains separate. No new arbitrary date-edit endpoint was added to hiring requests: published booking lifecycle actions remain server-authoritative. Worker weekly rank lives inside the existing profile listing panel, whose outer menu label is still “Hire listing membership”.

## 2026-09-29 — Compact home greeting, service shortcuts and Assured heading

Completed and deployed `home-compact-20260928` to both production sites. Greeting and saved service location now share one compact, accessible 44px control, with the smaller location directly below the name and reduced spacing before the shared 46px search. The location ticker has pause/play, pauses on focus/hover, respects OS/app reduced motion, and exposes the full location once to assistive technology. Six shortcuts remain a three-column square grid at normal phone text sizes (including 320px/360px); enlarged text reflows to two columns without clipping. Versioned icon URLs prevent stale cached artwork. The home catalogue now reads “Repaido Assured Home Essentials” with a compact green brand tag. Enlarged-text header/sign-in and bottom navigation labels now wrap within their controls.

Changed: web/src/components/HomeGreeting.tsx (new), web/src/App.tsx, web/src/design-system.css, web/src/dev/uiAudit.ts (development-only 200% text/reduced-motion query controls), web/public/downloads/latest-builds.json, deployment release/manifest/review artifacts, this handoff. No backend, financial policy, authentication or native APK changes. Existing Android wrappers load the same hosted UI; physical Android-device verification remains unperformed.

Validation: both TypeScript/Vite builds passed (existing large-bundle warning); all 4 existing contrast tests passed. Local 320/360/380px layouts checked: six square cards, no horizontal overflow, correct Home Cleaning category destination, location sheet open/Escape/focus restoration, pause/play, 200% text reflow and reduced motion. Home axe: 0 violations, 48 rules passed; offscreen service/story contrast checks incomplete and not presented as full conformance. Live cPanel 380px verified actual signed-in name, 46px search, three 105.66px columns, fresh icon URLs and current bundle. Saved production screenshot: deployment/reviews/home-compact-20260928/repaido.com.png (380x860 CSS viewport at 2x).

Deployment: Firebase version acaf0eb64596c5a1, release 1790619878537000; Firebase JS index-BqKtYt8l.js; cPanel JS index-C0MvlzKD.js; shared CSS index-Bkfa57m-.css. Archive deployment/releases/repaido-cpanel-home-compact-20260928.zip (524102 bytes, 5 entries) uploaded outside the web root and extracted into /public_html. Both complete 58-file hash inventories passed, including APKs. cPanel routes, revalidation/security headers, canonical redirects, blocked sensitive files/missing assets, CORS and unauthenticated private-job protection passed. Firebase used the existing authorized gcloud account to finalize after the deployment service account's run.services.get restriction; no IAM changes. Receipt: deployment/releases/firebase-home-compact-20260928-receipt.json.

Final identity follow-up is also complete: desktop greeting now uses the same verified customer identity/fallback as mobile, and location labels no longer append Odisha to unrelated cities. Firebase version d74c896fdad45f78 / release 1790647826689000, JS index-n0TE-rCM.js. cPanel final archive repaido-cpanel-home-final-20260929.zip (463157 bytes, 3 entries), JS index-DjwNFb0S.js; CSS unchanged. Final Firebase and cPanel 58-file verifications passed, along with cPanel route/security/CORS checks; live cPanel confirmed the new JS and actual customer greeting. Both sites retain the home-compact release UI metadata and icon version. Final deployment verification logs are saved in deployment/reviews/home-compact-20260928. The screenshot precedes only this desktop/location-label follow-up; its phone composition is unchanged. No new APK required.

No remaining blocker for this UI release. Earlier provider/payment/payout, real-device acceptance and Play Store release requirements remain below. This UI check did not re-run or certify every backend lifecycle, execute real payments or change live bookings.

## 2026-09-28 — Task stages, record accordions, customer identity and compact Hire

Implemented: high-contrast stage tabs/icons, completed stages in green, thin progress bar calculated as completed stages / 5 (not an estimate of work duration), status-aware green/orange/red, separate payment/payout status, restrained motion with reduced-motion support. Task records now have six native accordion cards: work report, payment/payout, penalty assessments, accepted rules, verified review/reply and timestamped timeline; PDF download remains available. A scoped spacing reset prevents the older worker `details` rules adding large gaps.

Customer account uses the actual authenticated name / own server worker name; approved dual-role users get a Repaido agent/specialist badge. Generic “Worker” is not used as a customer name. The large offer-preferences panel moved behind Notifications & offers, with real loading/error/retry states. Saved opt-outs and permission checks remain; no visitors were enrolled in tracking or marketing push.

Hire: same full-width46px shared search as Home/Services, sticky beneath branding, horizontal level/category/sort rails, category-appropriate icons, existing genuine leaderboards, monthly maid/care entry points, filters, profile and comparison flows. Backend matching/payment/role logic is unchanged. Shared hosted UI applies to web and existing Android wrappers; no new APK or backend deployment is necessary.

Changed: web/src/{App.tsx,design-system.css,services/customerIdentity.ts,services/taskStages.mjs,components/AgentTaskWorkspace.tsx,components/agent-workspace.css,components/WorkerRecords.tsx,components/Promotions.tsx,components/Hiring.tsx,components/hiring.css}; web/tests/{task-stages.test.mjs,contrast.test.mjs,agent-workspace-preview.tsx}; deployment releases/manifest and this handoff.

Checks:10 focused stage/contrast unit tests passed. Stage fixtures checked completed100%, completion-pending80%, arrival40%, disputed state, follow-up reset; keyboard arrow navigation, nested OTP Escape/focus, reduced motion and320px/200% text. Record accordions verified with native keyboard, timeline/policy/penalties, dark/200% text and380px without horizontal overflow. Final scoped record fixture axe0 violations/0 incomplete; earlier enlarged/offscreen headings had manual contrast checks incomplete. Hire46px search measured at380px; level/sort choices stay synchronized with advanced filters; comparison/profile display works with clearly local-only fixtures. Hire axe0 violations with contrast/aria checks incomplete; full AAA conformance, physical daylight legibility, Android-device and representative-user tests are NOT asserted.

Live intermediate release verified real worker en-route20% with Request completed, real completion report/review/timeline loading, customer actual name + agent badge and saved preferences, genuine Hire categories and honest0-member empty state. No live task/payment/preference mutations. Intermediate workspace-panels-20260928 deployment passed both58-file hash checks and cPanel route/security/CORS checks. Final workspace-final-20260928 was published: Firebase version3c91b1b38f322f8f/release1790616453019000, JS index-DQyYQv91.js; cPanel archive repaido-cpanel-workspace-final-20260928.zip(522821bytes/4entries), JS index-jW9cd_tz.js; shared CSS index-oxNdLKl4.css. Both58-file inventories, cPanel routes/security/CORS passed before the interrupted turn. Exact receipts/archive are preserved in deployment/releases. Both production builds passed with the existing bundle-size warning.

Existing launch blockers remain: approved active Hire memberships and provider/policy activation, real Razorpay capture/refund/payout testing, physical-device GPS/push/camera and Play release signing/requirements. The inspected worker session reported a GPS timeout; no location was invented or arrival recorded. No credential or backend business-policy changes in this update.

## 2026-09-28 — Completed task achievement card

Completed worker tasks now use a mint-green achievement card, check badge, “Task completed / Nice work!” and a direct “View completion report” action. The existing authenticated report/PDF opens in a focus-managed dialog. Cancelled/customer/ongoing cards retain their existing behavior. No invented rewards, ratings or payment status; the amount remains explicitly “Customer bill”. Shared light/dark success tokens, left alignment and wrapping support small screens and enlarged text.

Changed: web/src/design-system.css; web/src/components/{OperationalJobs.tsx,agent-workspace.css}; web/tests/agent-workspace-preview.tsx (labelled local-only card fixture). No backend or native APK change; Android wrappers receive the hosted UI.

Validation: both TypeScript/Vite builds passed (existing bundle-size warning); all3 existing contrast tests passed. New light/dark text contrast 8.3:1 or higher, boundaries 5.19:1 or higher. Browser fixture checked380px and320px/200% text, light/dark, no page/card clipping; axe0 violations/0 incomplete. Report open/Escape/focus restoration passed. Live authenticated Firebase History card confirmed green, no380px overflow; actual report loaded with PDF action, assessments, SLA, review and timeline. No live task/payment mutations and no physical Android test. Full accessibility conformance is not asserted.

Deployment COMPLETE: Firebase versionfa06f982c4ac593d, release1790604851949000, JS index-mDevLslV.js. cPanel archive repaido-cpanel-achievement-20260928.zip (516792bytes/4entries) extracted to/public_html, JS index-sWGiaf6H.js. Shared CSS index-DT2b0OFS.css. Both58-file inventories match SHA-256; cPanel routes/redirects/MIME/cache/security/CORS passed. One cPanel network disconnect during private-path checks passed a focused retry. Logs: /private/tmp/repaido-achievement-{build,cpanel-build,firebase-verify,cpanel-verify,cpanel-security-recheck}.txt. No blockers for this change; earlier provider/Play/physical-device launch requirements remain below. Next: user can inspect Worker → Tasks → History on either production site.

## 2026-09-28 — Home plans, Hire leaderboards, worker navigation and alerts

Implemented recurring maid/non-medical care + Home projects, dual-accepted quotes/calendars/daily visits/monthly invoices, company Home review, reusable event campaign studio, privacy-safe genuine Hire leaderboards/filter/compare/preferred worker, compact worker navigation and repeated incoming bells. Removed the two idle worker cards requested. Details and CTA mapping: `deployment/HOME_PLANS_CHECKLIST.md`.

Validation:174 backend tests and29 frontend tests passed; both web builds and customer1.0.4/code5 + agent1.2.9/code12 debug builds passed. Worker320/380px and200% text: five aligned tabs/no clipping; axe0 violations. Hire profile/compare/Home preference and calendar/studio inspected with labelled local fixtures; no live booking/payment/approval. Provider stubs and untested phone/provider checks are documented, not claimed as production acceptance.

Deployment COMPLETE: backend00066-cuj at100%; Firebase FINAL versionb139b26d264964e9 release1790600384098000. Both Firebase and cPanel: all58 published hashes match, including final agent1.2.9/code12 and customer1.0.4/code5 APKs. cPanel route/MIME/cache/security/CORS checks passed. Archives `deployment/releases/repaido-cpanel-home-plans-20260928.zip` and subsequent `repaido-cpanel-home-plans-final-20260928.zip` uploaded outside document root and extracted to/public_html. cPanel JS index-D9rhPk7I.js; Firebase JS index-B5K0ROfQ.js; shared CSS index-CV0JCzMC.css. The final APK safeguard cancels native request bells on app resume and avoids an insistent foreground notification; no OS volume or DND override.

Live UI: authenticated Firebase worker page confirmed the two cards removed, five visible aligned white nav labels, no overflow at380px; Calendar tab opened. cPanel loaded expected JS. No live task/approval/payment mutation. Final release logs are `/private/tmp/repaido-home-final-{cpanel,firebase}-verify.txt`; receipts under deployment/releases.

Remaining: actual Home qualification/availability/quotes and campaign artwork/dates/publication require company setup; Razorpay/route/day-hire activation remains provider-gated; real money/refund/payout and physical Android GPS/push/ringtone untested; monthly partial-refund allocation is a finance hold; no clinical care or automatic replacement guarantee. Debug APKs are not Play Store packages. Browser gesture + OS volume/DND remain in control. Full criterion-level accessibility/manual screen-reader checks remain. No fabricated ratings or live test data.

## 2026-09-28 — Market tab and supplied storefront icon

Implemented: renamed the customer Stores tab to **Market** in mobile/Android shared navigation, desktop navigation, page heading, section accessible name, account shortcut and footer shortcut. The supplied add_business SVG retains its original geometry and inherits navigation colours (white, 20px on mobile); it is decorative to screen readers beside the visible label. Routes and backend are unchanged.

Changed: web/src/App.tsx, web/src/components/{StoresIcon.tsx,SparePartsShop.tsx}; deployment/finalize_firebase_version.py now accepts a release label and preserves distinct receipts. Both TypeScript/Vite builds passed, with the pre-existing large-bundle warning. Local390px icon/label/active state and navigation verified; live desktop Market destination and its four sections verified. No physical Android test or unrelated backend tests were needed/performed for this UI-only change; both Android wrappers load the hosted shared interface.

Deployed: Firebase version d96c711cd8d33021, release1790589743740000, JS index-DIOEVHPS.js; all58 live Firebase build hashes passed. cPanel archive repaido-cpanel-market-20260928.zip (443755bytes/3entries) uploaded and extracted to /public_html, JS index-BhqPvjNQ.js; extraction and live Market UI confirmed. Shared CSS remains index-D-QWavVh.css. cPanel final verification passed: all58 file hashes, direct routes, asset MIME/cache headers, canonical redirects, private-path blocking and production CORS/access separation. No new credentials or feature blockers for the icon/name change. Existing launch/provider blockers remain in earlier entries.

## 2026-09-28 — Compact promotions, Global Control and consented delivery

Implemented: replaced the tall four-benefit home block with a compact full-width icon carousel (4-second default, company-adjustable 3–10 seconds), pause/play, next/previous controls, swipe, focus/hover/offscreen pause and reduced-motion support. Real offer details disclose fixed price, savings, expiry, terms and eligibility before booking. Home, explore, optional checkout and welcome-only placements share the same UI; the native splash remains quick. Corrected unsupported home marketplace copy about certified parts, unconditional deposit refunds and unlimited free listings.

Company **Global Control** adds real-catalogue campaign creation/edit/pause, dates, cities, placements, audience/spending filters, fixed discounts, reserved budgets, per-customer limits, icons/themes, delivery slots, caps, margin/cost assumptions and counts. Version checks and server-side administrator authorization protect edits. Personalisation and promotional push are explicitly opt-in under the customer's account. Ranking uses decaying consented interests, completed paid categories, savings and daily variety, with category diversity; it is an explainable rules model, not an asserted lifetime-profit prediction. No example campaigns, fabricated ratings, artificial urgency or automated paid add-ons were published.

Notifications: owner confirmed **8 AM–11 PM India time**. Defaults **08:30 / 14:30 / 20:30 IST**, maximum three relevant messages/day, lower user/admin caps, 72-hour same-campaign cooldown, stale/active-task suppression, durable slot deduplication, final eligibility/consent/version/cap checks and expiry. Existing minute scheduler verified enabled. Updated customer Android **1.0.3/code4** implements an independent optional-offers channel, data-only normal-priority messages, local quiet-window/expiry/dedup checks and campaign deep links. The shared web UI updates both Android wrappers. Agent APK remains1.2.6/code9. Both downloads are debug TEST builds.

Money: company-funded discounts reserve budget atomically and survive booking retries; accepted offer terms are snapshotted. Worker earnings, bonus reserve and approved shop-item prices are preserved. Settlement/receipt show the discount. Budget reservations are deliberately not automatically released after cancellation/refund. Discounted partial closures require existing dispute/finance review instead of silently changing earnings. Margin floor5% + cost/risk allowance3% are configurable starting policy assumptions, not a profit guarantee.

Changed files: backend/{promotions.py,test_promotions.py,operations.py,integrations.py,lifecycle.py,main.py,Dockerfile}; web/src/{App.tsx,components/Promotions.tsx,promotions.css,CampaignAdmin.tsx,OperationsAdmin.tsx,ServiceHydration.tsx,LiveBooking.tsx,LiveTrackingView.tsx,Lifecycle.tsx,services/native.ts,services/operations.ts}; Android customer {CustomerBridge.java,CustomerPushService.java,MainActivity.kt,build.gradle.kts}; web/tests/{contrast.test.mjs,promotions-preview.html,promotions-preview.tsx}; web/public/downloads/{repaido-app.apk,latest-builds.json}; deployment/{promotions_smoke.py,finalize_firebase_version.py,PROMOTIONS_RUNBOOK.md,releases/manifest+archive+receipt}.

Validation: full backend163 passed; the8 affected campaign tests reran successfully after the final queued-cap safeguard. Frontend28 passed; both TypeScript/Vite production builds passed (existing large-bundle warning). Customer Android debug build passed. Tests cover budget races, duplicate booking/dispatch prevention, worker settlement, roles, opt-out, matching, launch-only preferences, IST windows/caps and stubbed FCM relay. Candidate read-only health, workspace, role isolation, discovery, marketplace, rentals, Hire/records and promotion endpoints passed. Local browser: pause regression fixed; offer details→booking/sign-in recovery verified;320px/390px and desktop1440px no overflow. Home axe0 violations with existing offscreen/image-backed contrast checks incomplete; isolated shared carousel at200% text + dark palette + reduced motion:0 violations/0 incomplete, no price clipping. Real admin campaign editing, physical Android delivery, representative usability and full screen-reader testing were not performed.

Deployment: backend **repaido-api-00062-kob** verified at100%; prior rollback revision00059-wup. cPanel delta **repaido-cpanel-promotions-20260928.zip**,17,546,420bytes/6entries, extracted into/public_html; all58 live hashes, routes/APKs/headers/CORS verified. cPanel JS index-D2pr5LnC.js; shared CSS index-D-QWavVh.css. Firebase JS index-76KWlIc6.js; published version **79bb5151f53c489a**, release1790589003500000. CLI cache login had expired, then service-account finalize lacked Cloud Run read permission; finished through official Hosting REST using existing gcloud identity and explicit quota project, without changing IAM. All58 uploaded build hashes matched, with only Firebase's standard__/firebase/init.js and init.json extra. Final live CDN verification: all58 Firebase files match the build including APKs; cPanel and Firebase now both serve the release. All six live Firebase promotion API/access checks passed (the quote access check had one network timeout, then passed on a focused retry). Production home inspected at390px and1440px without horizontal overflow.

Remaining activation/launch requirements: admin must publish real campaigns and approve actual budgets/terms; customers must opt in and install the updated customer test APK for promotional push. No real promotional pushes were sent. Razorpay keys/webhook and payout setup remain missing/disabled; real capture/refund/bank reconciliation remains untested. Existing Hire provider/policy gates, physical-device background/GPS/OTP/camera/notifications tests and signed Play AAB/declarations remain as documented below. Scheduler batches50 recipients/20-minute slot window require capacity monitoring before broad rollout. Financial reservation reuse and discounted partial-close automation are intentionally blocked for finance review. Instructions and rollback: deployment/PROMOTIONS_RUNBOOK.md.

## 2026-09-28 — Agent task stages, records, Hire and compact home release

Implemented: five compact task stages with swipe, labelled tabs and keyboard navigation; fixed primary action, separate OTP/camera/parts/rentals/follow-up/support sheets, and retained location updates across worker tabs. Before-work photos are enforced on task start; completion uses after-work evidence. Added account-scoped task/earnings records, payout status/history, assessment reasons and timestamps, genuine task reviews and PDF download (including Android save picker). Worker public profile supports portrait, cover, biography, languages and skills without exposing contact/home/KYC data.

Customer Hire replaces the bottom Profile tab; account remains in the header. Added genuine professional profiles, comparison, radius/role/rating/sort filters, pauseable/reduced-motion-aware profile rail, paid membership verification, five-minute offers, wait/rematch choice, fresh acceptance GPS driving quote, customer price confirmation and reuse of the existing task lifecycle. Rematch bonus is 10% of base, funded from company share; travelling reimbursement and GST stay separate. Missed Hire offers create review assessments, NOT invented monetary deductions. Hiring remains disabled until its missing provider/policy configuration is supplied.

Latest requested UI: six smaller square rounded home shortcuts (40px maximum artwork, 12px labels with text-enlargement reflow); Services uses a gear in desktop/mobile navigation; removed Hire landing price tagline (review still discloses charges); removed duplicate Stores quick-switch rail and retained the rectangular segmented selector. Shared hosted UI applies to Android wrappers and web.

Changed files: backend/{hiring.py,worker_records.py,new test_hiring_records.py,operations.py,integrations.py,main.py,Dockerfile,requirements.txt,test_visits.py}; web/src/{App.tsx,design-system.css,services/taskStages.mjs,services/native.ts,components/AgentTaskWorkspace.tsx,agent-workspace.css,WorkerRecords.tsx,Hiring.tsx,hiring.css,OperationalJobs.tsx,LiveWorkerPortal.tsx,WorkerAssignmentAlerts.tsx,OperationsAdmin.tsx,Lifecycle.tsx,LiveTrackingView.tsx,VisitEvidence.tsx,ui.tsx,SparePartsShop.tsx}; web/tests/{task-stages.test.mjs,agent-workspace-preview.html,agent-workspace-preview.tsx}; Android agent {AgentActivity.java,PushService.java,build.gradle.kts}; web/public/downloads/{both APKs,latest-builds.json}; deployment/{production-env.yaml,hiring_smoke.py,releases/manifest+archive}.

Validation: full backend suite 155 passed; frontend 27 passed; both TypeScript/Vite builds passed (existing large-bundle warning). Android customer+agent debug builds passed after cleaning generated duplicate resources. Candidate read-only health, role isolation, workspace, discovery, rentals, marketplace and Hire/records checks passed; promoted production Hire checks passed. Local UI: home cards square at390px and320px without overflow; agent stages checked320x680/390x844, keyboard arrow navigation and OTP focus restoration; axe agent stage 0 violations/0 incomplete, Hire with expanded filters 0 violations/0 incomplete (46 rules passed). PDF render inspected with boxed sections and pagination. No representative usability study or full conformance certification. External money movement, actual memberships and real worker assignments were NOT simulated in production.

Deployment: backend repaido-api-00059-wup promoted to100% and verified; prior ACTUAL live revision was00038-f6g (older handoff entries claiming00048 at100% were inconsistent with Cloud Run traffic). Existing tagged candidates preserved. Private profile-media bucket repaido-professional-media created with public-access prevention and bucket-scoped runtime object access, separate from expiring KYC storage. Firebase published and all58 file hashes passed; JS index-Cr7Hz94u.js, CSS index-D-OGKZUQ.css. cPanel full package repaido-cpanel-agent-hire-20260928.zip (71,947,827bytes,59 entries) uploaded outside the document root and extracted to /public_html. ALL58 live hashes, routes, APKs, MIME/cache/security headers, redirects, private-path blocks and CORS passed. cPanel JS index-tjRtICvJ.js / CSS index-D-OGKZUQ.css. Both production frontends verified: https://repaido.com/?release=agent-hire-20260928 and https://repaido.web.app/?release=agent-hire-20260928. Live390px home inspected; one Stores selector and zero duplicate rails; desktop1440px cards130px square. This full release also supersedes the earlier pending compact-search patch.

Android downloads: customer1.0.2/code3, agent1.2.6/code9; both debug TEST builds. Native pinch zoom disabled, OS/app text-size support retained. Shared UI/API updates do not require reinstall; agent PDF save bridge needs this agent APK.

Exact launch blockers: Razorpay payment/payout secrets and enablement remain absent/disabled; configure RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET and payout setup securely, then test real capture/refund/reconciliation/bank transfer. Hire additionally requires GOOGLE_ROUTES_API_KEY, approved membership price, day duration, applicable GST and versioned terms (Company Finance > Day-hire policy). No invented values were activated. Missed-hire monetary penalty amount/policy is unspecified; keep review-only until explicitly configured. Physical-device OTP/camera/GPS/foreground/background FCM/audio/PDF save and signed-in multi-role acceptance tests remain. Signed release AAB/upload signing and Play declarations are still required; debug APKs are not Play-ready. Public profile uploads use a real private bucket but no real user upload was performed here.

Next: configure the above launch providers/policies and execute real-device acceptance. Deployment and production UI verification are complete. Relevant endpoint check: deployment/hiring_smoke.py; all test data/QA previews are local-only.

## 2026-09-28 — Compact search, blue navigation and Android zoom update

Implemented: shared 46px customer search fields (44px input targets), consistent stroke/radius/icons, sticky offset measured from branding header; greeting moved into home content to keep branding height consistent across tabs. Services/Stores search focus brings their toolbar below branding. Removed the scrolling-container conflict that broke Stores sticky positioning. Discovery retains real APIs, comparison/details, location and preferences, using a transparent borderless dialog over a blurred translucent backdrop; keyboard focus loops, Escape/restoration and root scroll lock retained. Bottom navigation uses navy Repaido blue with white labels and consistent 20px/2px-stroke icons. Agent/desktop workspace controls and spacing compacted; redundant agent metric copy and unsupported default 5.0/payout-settlement claims removed. No backend/application data changes.

Android: native pinch zoom disabled in both wrappers; app text-size preference retained. Customer debug-test APK 1.0.2/code3 and agent 1.2.5/code8 built, copied to web/public/downloads, and metadata/checksums updated. The clean build resolved old cloud-sync duplicate generated resources. Later removed only regenerable Android intermediates to recover disk space; APK outputs/downloads remain.

Changed files: web/src/App.tsx, components/ui.tsx, components/SearchDiscovery.tsx, components/LiveWorkerPortal.tsx, components/Rentals.tsx, components/Marketplace.tsx, design-system.css, tests/contrast.test.mjs; android/app and android/agent build.gradle.kts and respective MainActivity.kt/AgentActivity.java; web/public/downloads/{repaido-app.apk,repaido-agent.apk,latest-builds.json}; deployment/verify_firebase_release.py (verify CLI-published file inventory, not cloud-sync conflict copies).

Automated checks: all 150 existing backend pytest tests passed, including API/auth, operations/dispatch, visits/evidence, procurement/parts advances, shops/payouts, marketplace/rentals, rewards, discovery and workspace tests. Tests use isolated fixtures/provider stubs; this is NOT a claim of every real-world lifecycle or every endpoint being exercised. All 24 frontend tests passed (final log web/test-results/compact-search-unit-tests.txt), including expanded contrast palette tests. Both TypeScript/Vite production builds and both Android debug builds passed. Existing bundle-size/mixed-import, Android API deprecation and pytest deprecation warnings remain.

Read-only production checks: http_smoke.py (23 checks), workspace_smoke.py, marketplace_smoke.py, discovery_smoke.py, hydration_smoke.py and rentals_smoke.py passed. No live booking, charge, applicant approval, document upload or financial mutation was performed. Firebase release hash verification passed for all 58 published files, including APKs.

Browser checks: customer home reflow at 320/390/600/840/1440 CSS px; Services and Stores search/clear/sticky alignment; real search → service details; Escape and restored opener focus; 320px with 125% text and reduced motion; explicit forward/reverse dialog focus loop. Home and discovery axe reported zero violations after fixes, with some contrast checks incomplete on blended/offscreen elements. Desktop shop/company unauthenticated access screens checked at1440px; agent sign-in at390px. Live repaido.com pest search returned two real matching services with46px field/no dialog border/no horizontal overflow. No full WCAG conformance, screen-reader or representative-user testing claim.

Publication: main update published to BOTH Firebase and cPanel. cPanel complete archive deployment/releases/repaido-cpanel-compact-search-20260928.zip (59 entries,58 files) uploaded outside document root and extracted to /public_html. ALL58 cPanel file hashes, routes, MIME/cache/security headers, redirects, private-path protection and CORS checks PASSED; live search also verified in browser. Current cPanel JS index-DSyhYiiv.js and CSS index-DREqprYj.css include new APKs, main search/discovery/navigation/worker UI.

Final follow-up: rental and Exchange now reuse CustomerSearchField, with matching magnifier,46px height, clear control and sticky alignment; local390px checks passed for both without horizontal overflow. Both production builds passed. Firebase FINAL deployed and all58 published SHA-256 checks passed: https://repaido.web.app/?release=compact-search-20260928, JS index-D9aTXD-l.js / CSS index-Bb2JTRxd.css. cPanel FINAL PATCH IS PENDING: deployment/releases/repaido-cpanel-compact-search-final-20260928.zip (483569 bytes,4entries) contains final CSS/JS/index/.htaccess; it depends on the already-installed full archive. deployment/releases/cpanel-manifest.json now describes this FINAL intended release, not the current cPanel release. Intended cPanel JS index-CnQS-vlD.js / CSS index-Bb2JTRxd.css.

Exact deployment blocker: Mac became locked during opening cPanel File Upload; CUA reported automatic unlock unavailable and required the user to unlock manually. Do not bypass the lock. Next action after unlock: upload /private/tmp/repaido-cpanel-compact-search-final-20260928.zip (hardlink to workspace archive) to /home/repaidoc, extract to /public_html, then run backend/.venv/bin/python deployment/verify_cpanel.py. No new backend/APK deployment is needed. Final patch has NOT been uploaded/extracted to cPanel; do not claim the two frontends are byte-identical yet.

Remaining launch gates: Razorpay payments/payouts still disabled/missing configuration per live integration-status check; real capture/refund/reconciliation, bank transfers, physical-device OTP/camera/GPS/background tracking/FCM/audio and authenticated multi-role acceptance workflows have not been exercised here. Published APKs are debug TEST builds, not Play Store releases; existing release Gradle config uses debug signing, so a proper private upload key/signing configuration and signed AAB, Play declarations and device acceptance are still required. Admin/worker authorization was not weakened. No live worker availability or location was fabricated. Manual contrast/screen-reader checks remain for incomplete axe results. Browser zoom remains available; only Android native pinch zoom was disabled as requested.

## 2026-09-27 — Mobile App Web Feel, Restored 3D Service Grid & Sliding Marketplace Notifier Deployed
1. **Restored 3-Column Service Category Grid with Custom 3D Graphics**:
   - Re-instated the 3-column / 2-row grid of quick service buttons (`repaido-services-3col-grid` with `homePrimaryServices`) on the Explore/Home tab.
   - Restored high-res 3D icons: `/images/icon-cleaning.png`, `/images/icon-plumbing.png`, `/images/icon-electrician.png`, `/images/icon-appliance.png`, `/images/icon-vehicle.png`, and `/images/icon-gardening.png`.
2. **Marketplace Sliding Notifier (`marketplace-sliding-notifier-container`)**:
   - Added an interactive horizontal sliding ticker with a live pulsing green indicator dot.
   - 4 quick-jump cards for:
     - 🛒 **Buy Spares**: OEM & Certified parts with quick delivery.
     - ⚡ **Rent Tools**: Power tools & machines · Pay per day.
     - 🔄 **Direct Swap**: 1-to-1 gadget exchange with nearby matches.
     - 🏷️ **Sell & Pre-Owned**: List used items free · Direct member deals.
   - Tapping any card directly transitions the app into the Stores tab and switches to that exact pillar.
3. **Mobile App Experience on Web (`stores-mobile-app-shell`)**:
   - Enclosed the entire Stores experience in `.stores-mobile-app-shell` (centered 640px mobile app viewport frame on desktop with native shadows; 100% responsive on mobile).
   - Added `.stores-sliding-quick-nav` ticker inside the Stores tab for instant one-touch switching between modalities.
   - Preserved single Filter button (`.spare-filter-trigger`) and clean inventory cards.
Files modified:
- `web/src/App.tsx`: Restored 3D category grid, added sliding marketplace notifier, and wired `storeSection` navigation.
- `web/src/components/SparePartsShop.tsx`: Wrapped inside `.stores-mobile-app-shell`, added `initialSection`/`onSectionChange`, and added `.stores-sliding-quick-nav`.
- `web/src/design-system.css`: Added styles for `.marketplace-sliding-notifier-container`, `.marketplace-slide-card`, `.stores-mobile-app-shell`, and `.stores-sliding-quick-nav`.
Validation:
- `npm test` in `web/`: 8/8 tests passed.
- `npm run build` in `web/`: TypeScript compilation and Vite bundling passed with zero errors.
- `backend pytest`: 150/150 tests passed.
- Deployed live to Firebase Hosting: `https://repaido.web.app`.

## 2026-09-26 — Availability, customer progress, and parts advances
Backend deployed and promoted: repaido-api-00048-tuq at100%; previous00046-qaq retained. Firebase publish completed; cPanel archive ready but NOT YET uploaded/verified: deployment/releases/repaido-cpanel-presence-progress-20260926.zip (6entries,58manifest files). Firebase JS index-ClyzWks9.js; cPanel JS index-DqYWkOUZ.js; CSS index-DcDAJopQ.css. Agent1.2.4/code7 debug APK built and included in both build outputs. Update this publication status after verification.

Implemented: top-right worker Online/Offline switch on shared web/Android UI; fresh/coarse discovery GPS validation distinct from precise arrival; delayed heartbeat cannot undo Offline; immediate assignment refresh. Private customer live-location endpoint/panel polls15s, hides stale coordinates after60s and after consent withdrawal/visit end. Depart action starts consented native/web tracking; native ping interval15s. Search orange finite pulse/reduced motion, accepted/active green, acknowledgement and actual departure copy, accessible progress steps. Native/web worksite exit monitoring now shares accuracy-aware deduplication. New bookings procurement v3 require approved provider-captured parts advance BEFORE stock reservation/shop order; final invoice subtracts paid allocated advances. Duplicate/ambiguous capture, late capture, stale stock, shop rejection/expiry, refund-review holds and refund-payment selection covered. Existing bookings preserve payment terms. Company finance exposes collection IDs for refund review.
Changed files: backend/{operations,integrations,parts_payments(new),procurement,refunds,lifecycle,shop_payouts,main}.py, Dockerfile; tests test_presence_progress.py(new),test_parts_advances.py(new),test_procurement.py(legacy fixture); web/src/components/{LiveWorkerPortal,OperationalJobs,CustomerTaskProgress(new),PaymentPanel,Procurement,Lifecycle,PrivateReview}.tsx,operations.css,services/operations.ts; android/agent TrackingService.java/build.gradle.kts; downloads APK+metadata; local-only web/tests/presence-preview.{html,tsx}; deployment/PRESENCE_PROGRESS_CHECKLIST.md.
Validation:147 backend tests passed (provider stubs, no real charges);18 frontend tests;both TypeScript/Vite builds passed with existing bundle-size warning;Android debug build passed.36 candidate read-only HTTP checks passed. Local fixture visually inspected390px/320px, switch48px and keyboard reachable, no horizontal overflow. Full authenticated phone/browser workflow, GPS travel, real push/audio and real money NOT tested. Read-only live diagnostic still found sole eligible pest worker OFFLINE with NO fresh device position, no active push device; no forced availability or location fabrication.
Exact blockers/next: finish Firebase/cPanel publication +58file live hash checks; user must use approved phone account, Go online with device location, enable/test bell and native notifications. Razorpay payment/payout activation/secrets missing; new parts payment correctly blocks with recoverable error until configured. Public support telephone requested asynchronously, not yet supplied; booking-linked support works, call link not invented. Existing financial holds for disputes/refunds of installed parts need company accounting review. Manual verified support/traffic/safety review still required for deductions. Validate Android background GPS/notification delivery on a real phone. See deployment/PRESENCE_PROGRESS_CHECKLIST.md.

## 2026-09-26 — Pest dispatch and incoming-task alerts (publication in progress)
Read-only production investigation found the requested future pest booking searching; sole registered worker approved in pest category/same city, but offline, no live position, no other jobs, zero registered active push devices. Category matching was correct. No personal documents, exact coordinates, phone or names printed; no worker forced online and no test booking/approval/payment created.
Fix: transactionally retry future searching bookings on online/fresh-position heartbeat and scheduler sweep, oldest first, preserving approval/category/city/fresh15minGPS/radius<=6km/busy/prior-decline gates. Pending writes reserve agent once under concurrent requests; versioned assignment event and privacy preserved. Worker GPS refresh immediately on returning online/focus then every3min while page visible; failures now shown. Cross-tab worker alert panel polls5sec, shows request deadline/server-clock offset and visit reminder, user-enabled repeating bell, volume control and per-offer silence. Stops when expiry/action refresh revokes attention. Page must remain open for web alerts. Android high-importance incoming-request channel with bundled bell/vibration and deadline; follows OS sound/DND. FCM has assignment-specific copy, correct recipient, snapshot expiry check and boundedTTL. Scheduler confirmed enabled everyminute. Agent APK1.2.3/code6 built after generated-resource clean.
Changed: backend/operations.py, integrations.py, test_operations.py, test_dispatch.py(new); web/src/components/WorkerAssignmentAlerts.tsx(new), LiveWorkerPortal.tsx, OperationalJobs.tsx, services/operations.ts; android/agent/PushService.java, raw/repaido_task_bell.wav, build.gradle.kts; public/downloads agentAPK+metadata; deployment/diagnose_dispatch.py(read-only).
Validation:52 focused dispatch/operations/integrations/workspace/lifecycle tests passed;33 impacted tests rerun after event-version correction passed; TypeScript/Vite and Agent debug build passed. New tests cover offline pest→online immediate offer, one offer despite retries/concurrency, approval/radius/category/staleGPS exclusion, decline retry protection, urgent private notice deduplication and expiry. Real-device sound/background delivery not tested. Backend candidate building, frontend builds completing. Next: candidate checks/promotion, Firebase+cPanel release verification, then agent must explicitly Go online with current location and enable bell/push. Browsers cannot be forced to autoplay or override devicevolume/DND. Do not claim this live booking was assigned unless later verified.

## 2026-09-26 — First listing free for30days — deployed
Implemented one free first Exchange listing and one free first used-item listing per account, transaction-protected and idempotent. Eligible new listings publish without Razorpay; existing sole unpaid draft can explicitly claim free publication. Exact server-time expiry30days later removes search/photos/matches/contact access even when scheduler is late. Private expired record retained for renewal/audit; no permanent erasure of fee records. Closing or expiry never resets eligibility. Subsequent listings and one-time paid continuation retain10% exchange/5% used-item fees, no recurring/automatic charge. Verified capture clears trial expiry; closed/admin-hidden items cannot be revived. Deduplicated in-app reminders before expiry and on expiry link to the relevant profile manager. UI shows free eligibility, ₹0 due now, exact expiry, renewal charge and explicit publish action.
Files: backend/marketplace.py, test_marketplace.py; web/src/components/Marketplace.tsx, Lifecycle.tsx; web/src/App.tsx; deployment/marketplace_smoke.py, MARKETPLACE_CHECKLIST.md.69 focused backend tests pass including concurrency, boundary expiry, reminders, first-per-mode, retries, early/late renewal/refunds, legacy drafts and privacy. Both TS/Vite builds pass(existing bundle size warning). Published backend revision repaido-api-00044-dej at100% after30 candidate HTTP checks passed. Firebase JS index-Bro18LxL.js and cPanel JS index-CAWU0KNo.js released; cPanel archive repaido-cpanel-free-listing-20260926.zip extracted to public_html. All58 live-file SHA-256 checks plus routes/headers/CORS/private-path checks passed. Browser verified Exchange30days/10% and sale30days/5% copy, signed-out recovery, and no horizontal overflow at320/390/840/1440px. Previous revision00042-zok retained for rollback. Paid continuation still blocked until real Razorpay configuration; no real listing or financial transaction performed. Physical Android not tested; hosted UI/API shared.

## 2026-09-26 — Marketplace + resumable onboarding release deployed
Published Firebase Hosting and cPanel repaido.com. Production backend is repaido-api-00042-zok at100% traffic (previous00039-paq retained for rollback). Firebase JS index-WYwLS1o0.js; cPanel JS index-B6AfFXH5.js; shared CSS index-RbrUgDyR.css. Archive deployment/releases/repaido-cpanel-marketplace-20260926.zip extracted into public_html; all58 live files match manifest SHA-256. Prior resume-onboarding changes below are now published too.

Implemented Stores Exchange, Buy/New/Refurbished/Second hand, Profile Let’s exchange/Sell a used item, required photo/item details, private radius-based matching (10km default, both owners’ radii, reciprocal categories, maximum15% value difference), in-app match notifications and gated contact access. Server-controlled captured listing fees10% exchange/5% used; idempotent orders, unknown-outcome reconciliation, refund unpublishing, owner closure, admin moderation/reports. Refurbished shop inventory requires warranty/refurbishment details. Home cards open actual service details; company-admin versioned service terms appear in detail/booking views and snapshot onto bookings.

Changed: backend/marketplace.py(new), main.py, Dockerfile, integrations.py, procurement.py, workspace.py, operations.py, test_marketplace.py(new); web/src/components/Marketplace.tsx, ServiceTerms.tsx, HomeServiceDetails.tsx(new), SparePartsShop.tsx, Procurement.tsx, Discovery.tsx, SearchDiscovery.tsx, LiveBooking.tsx, OperationalJobs.tsx, OperationsAdmin.tsx, Lifecycle.tsx; web/src/App.tsx, design-system.css, services/operations.ts. Prior onboarding files described below. Added deployment/marketplace_smoke.py and MARKETPLACE_CHECKLIST.md.

Verification:63 focused backend tests passed; both TypeScript/Vite builds passed (existing large-bundle warning). Candidate23 core+6 workspace+6 marketplace HTTP checks passed; production cPanel58 hashes/routes/headers/redirects/private-path blocking/CORS passed. Live UI checked Home→detail/terms, Escape focus restoration, Stores Exchange and10km/10% default, New/Refurbished/Second hand and5% fee, phone-verification recovery, Profile actions. Exchange layout had no horizontal overflow at320/390/840/1440 CSS px. No actual listings, payment, exchange, KYC decisions or user financial mutations performed by assistant. No full WCAG conformance, representative usability or physical Android test claim.

Exact blockers/next actions: Razorpay keys/webhook secret and payments enablement remain missing; paid publication returns a recoverable unavailable state until configured, never fake paid. Company must publish service-specific terms (currently honest missing-terms notice). Peer inspection/handover/item-price payment is a member-arranged classifieds workflow; escrow/shipping/peer purchase checkout not implemented. Listing-fee refund initiation remains company support/provider dashboard; provider refunds are observed server-side. Desired model words rank candidates; only desired category is a hard reciprocal match requirement. Matching is not verified valuation or exact-model guarantee. In-app notifications implemented; background delivery not proven for these match events. Add draft-photo cleanup/indexed matching before high-volume use. Test real Razorpay sandbox capture/refund, matched verified-mobile accounts, registration/resubmission/admin review and physical Android before broad launch. Android uses same hosted UI/API; this release does not create new native APKs. See deployment/MARKETPLACE_CHECKLIST.md for contracts and limits.

## 2026-09-26 — Resume incomplete agent onboarding
Added server-derived per-account checklist (identity/PAN/address/tools, expiry-aware), explicit idempotent submit-for-review endpoint, reviewer-note display, rejection → correction → resubmission transition, and private in-app onboarding notification linked to /worker. Existing accounts get the checklist and notification on their next status/notification read; no manual mutation or fabricated document approval needed. Saved worker profile is editable for pending/rejected applicants with prefilled fields; edits invalidate stale identity approval/submission and changed legal name invalidates bank verification. Approved profiles cannot self-edit through onboarding.
UI: profile/documents/team-review steps, separate named upload cards (no confusing type dropdown), progress bar, persistent missing-info banner, saved/upload/error states, selfie/manual path, explicit submit button. Pending users no longer see irrelevant task statistics. Status refreshes every30s while visible and on focus; approval exposes availability control. Same hosted customer/agent Android and web UI. Uploaded files and saved profile survive sign-out; unsaved edits/file selections do not.
Files: backend/integrations.py, operations.py, test_workspace.py; web/src/components/VerificationPanel.tsx, LiveWorkerPortal.tsx, Lifecycle.tsx, operations.css; web/src/services/operations.ts. 48 focused backend tests passed, covering resume/missing docs, private notification/no duplication, submit idempotency, reject/resubmit/approve and profile-edit identity invalidation. Publication and browser checks in progress. No real applicant documents uploaded or reviewed by assistant.

## 2026-09-26 — Reference UI and one-screen joining review
Implemented full-width application review with profile facts, automatically loaded private JPG/PNG gallery, PDF download, per-file retry, one review attestation + approve/reject. No Razorpay or private case reference input in joining UI. Server atomically records identity decision and worker approval; mandatory current identity/PAN/address/tools documents, document-set freshness, operator auth and audit retained. Bank status is not fabricated and still gates payouts. Existing approved identity can join without bank provider.

Adapted 56 supplied mHome reference PNG screens into Repaido tokens: photo-first responsive service grid, mobile detail/booking sheets, selected-service summary, four numbered booking sections, due-now invoice, compact dated booking cards and profile rows. Catalog Choose opens booking directly. Existing API/pricing/Android hosted web UI reused. No sample photos/ratings/discounts copied.

Changed: backend/operations.py, workspace.py, test_workspace.py; web/src/components/OnboardingOverview.tsx, operations.css, Discovery.tsx, LiveBooking.tsx, OperationalJobs.tsx; web/src/App.tsx, design-system.css; deployment/REFERENCE_UI_CHECKLIST.md, PRODUCTION_RUNBOOK.md; release artifacts.
Validation: 35 focused backend tests passed; both TypeScript/Vite builds passed (existing large bundle warning). Candidate 23 core + 6 workspace HTTP checks passed; repaido-api-00039-paq promoted to100%. UI width320/390/600/840/1440 no horizontal overflow. Service detail and direct booking dialog manually checked. No real identity approvals, bookings or financial transactions submitted.
Deployment complete: Firebase + cPanel published. All58 repaido.com release SHA-256 checks passed, including routes, asset/cache headers, redirects, sensitive-path blocking and CORS. Firebase JS index-C_jD-egQ.js; cPanel JS index-BXXO6AMk.js; shared CSS index-CXF6H5vl.css. Archive repaido-cpanel-reference-onboarding-20260926.zip. Live admin gallery loaded all5 current PAN/selfie photos; missing identity/address/tools correctly blocks approval. No live decision submitted. Live service-detail Escape restored focus to its opener. 125% text reflow at390px had no overflow; reduced-motion transition measured0s; preferences restored. Shared hosted Android UI receives release; physical device testing still pending.
Remaining: real payment/payout credentials still absent; physical Android and representative user/screen-reader testing not performed. Pending applicant must supply missing document kinds; do not approve based only on PAN/selfie or invent bank verification.

# 26 September 2026 — compact service stories and purposeful microinteractions

Implemented shared React UI for customer web and hosted Android: “Spare Parts” navigation renamed “Stores”; manual image story rail with real catalogue categories, selected ring/text indicator and labelled scroll buttons; compact service cards with right-side imagery, duration, honest rating/New state, price and details/choose actions; full scope/exclusions remain in details; home shows first6 packages with See all; shorter hydration suggestions; soft navy/mint gradients,180ms press/selection feedback, comparison selection highlight/status. Retained static home banner. Removed unsupported30-day guarantee copy from old service detail modal. No fabricated stars.

Sources followed: https://ixdf.org/literature/article/micro-interactions-ux and https://www.nngroup.com/articles/microinteractions/ — feedback is tied to user action, status and error prevention; no looping decorative motion. WCAG reference: https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html and target-size-enhanced.html. Shared OS/app reduced-motion controls disable new motion/smooth scrolling. Buttons retain48px minimum targets. Navigation can reflow at enlarged sizes.

Files: web/src/components/ServiceStories.tsx(new), Discovery.tsx, SearchDiscovery.tsx, ServiceHydration.tsx, App.tsx, design-system.css. No new API or Android dependency needed; customer APK loads Firebase-hosted shared UI.

Validation: TypeScript/Vite production and cPanel builds passed (existing large-chunk warning). Browser320/390/1440px: no document horizontal overflow; mobile filtered service card203px high at390px; desktop2columns; all catalogue images loaded. Story category → filtered services; full details; Choose → search/compare; Stores → Buy/Rental verified. Keyboard Escape closes detail modal; no browser console errors captured.125%text+320px reflows; reduced motion computed0s and rail scroll behavior auto. Axe in catalogue found0violations/49passes; gradient/offscreen contrast checks incomplete. Manual new token contrast7.80:1 minimum in sampled normal/day pairs and8.80:1 in sampled night pairs. No full WCAG certification, screen-reader, representative usability or physical Android claim.

Publication: compact stories and spacing/breakpoint refinement deployed to both Firebase and cPanel. Firebase JS index-C-Ym-kuK.js; cPanel JS index-CYZhrZgz.js; shared CSS index-BIINp4Ac.css. Final cPanel archive deployment/releases/repaido-cpanel-spacing-20260926.zip (4entries,0644) uploaded to private root and extracted to/public_html after user made Chrome available. Earlier stories archive was not extracted and is superseded. Live repaido.com/?release=spacing-20260926 shows story category filtering, compact plumbing card, new Stores tab and final spacing. Backend/APKs already deployed. Final production verifier PASSED: all58 SHA-256 hashes including APKs, asset MIME/cache headers, direct routes, canonical redirects, blocked sensitive paths, production CORS and unauthorized private-job rejection. Same provider/real-device/lifecycle blockers remain; do not equate this UI change with payment certification.

Spacing refinement: shared4/8px scale tokens; compact<600 uses4layout columns/16px gutter,600–839 uses8/24px,840–1199 uses12/24px,1200+12/32px. Dense list sections16–32px; customer max1600px, admin fullwidth. Unified outer padding across home, stories, catalogue, booking, stores/rentals and admin; inventory/card internal padding12/16px. Tested599,600,839,840,1200,1440px: expected tokens and no horizontal document overflow. Source references: supplied Medium article and Material responsive-layout documentation. These are chosen CSSpx breakpoints, not a claim that Material mandates these exact column counts for every component.

# 25 September 2026 — workspace UX, photos, selfie and real local rankings

Implemented: full-width desktop company/shop layouts; master/detail worker application overview with search, ready/pending filters, document-kind summary, verification statuses and direct approve/reject decisions through existing server gate. Role selector and reason required for rejection; existing six identity checks consolidated into one explicit reviewer attestation. Private JPEG/PNG documents/selfies preview inside an accessible modal rather than forced binary download; PDFs remain downloads. Default evidence reference uses the real internal case ID. No actual worker was approved/rejected by the agent.

Shop inventory and rentals: direct JPG/PNG upload with 5 MB client/server limits, image decoding/pixel cap/resizing, EXIF removal, preview, upload progress/error recovery and no public bucket ACL. Stored listing-media uses public proxy only after an active listing by approved owner references it. Ownership validated at listing save. Stock and rental forms retain data on error; category suggestions and wider rental editor. Customer buy catalogue now reads real server-confirmed shop stock instead of browser-local seeded inventory, includes actual uploaded images/store coordinates and hides stale/zero stock. Direct spare-parts checkout remains the pre-existing provider/backend contract and is NOT proven end-to-end. Removed hardcoded customer checkout contact/address defaults.

Worker private selfie: live browser camera, visible device timestamp/capture ID, server capture session and receipt timestamp, consent, 30-day document retention, authorization, retry/checksum reuse guards, private admin review. No face recognition, automated liveness or hardware attestation. Selfie added AFTER initial worker profile save under Private verification. Manual identity comparison route remains for accessibility; selfies are not the only permitted identity evidence. Android agent1.2.2/code5 and customer1.0.1/code2 now request scoped video-only camera permission and wait for GPS permission callbacks. Test/debug APKs built after cleaning duplicate generated resource artifacts. Camera requires permissions and physical-phone acceptance remains untested.

Company team: support status text plus green resolved/red escalated/orange open, status filtering, assign-to-me/release actions with version conflict/ownership protection, and latest100 audit-event view. All existing authorized company admins retain same permissions; no four new accounts or fine-grained team roles invented.

Rankings: new public location-scoped endpoint returns professionals within20km with fresh positions, approximate 8km-radius local hex axial zones, real review average/count/completed tasks, approximate straight-line distance, no phone/email/home coordinates. Services aggregate verified completed-booking reviews in area. No random/seeded public stars and no 4.8 floor. UI on home expandable panel, worker Profile and company Rankings; map/GPS entry, zone filter, honest New/empty states and methodology. Approximate local hex grouping is NOT H3/global persistent clustering, an optimized search index, a trained recommendation engine or proof of best possible suggestions. Service coverage/dispatch remains6km; discovery radius does not authorize distant assignments.

Files: backend/workspace.py (new), main.py, Dockerfile, procurement.py, rentals.py, test_workspace.py; frontend InventoryPhoto.tsx, OnboardingSelfie.tsx, OnboardingOverview.tsx, LocalLeaderboard.tsx (new), OperationsAdmin.tsx, PrivateReview.tsx, VerificationPanel.tsx, Procurement.tsx, Rentals.tsx, SparePartsShop.tsx, LiveWorkerPortal.tsx, Lifecycle.tsx, App.tsx, api.ts, operations.css; both Android activity/build config + customer manifest; APK metadata and release artifacts.

Validation: 63 backend tests pass across workspace, operations, rentals, procurement, visits and lifecycle; includes invalid images, unpublished media404, image metadata stripping, cross-owner binding, selfie consent/unauthorized/duplicate, stale stock, real unrated rankings/no contacts/outside20km, case-claim versioning/admin separation. Both Android debug builds pass. TypeScript/Vite production builds pass with existing large-bundle warning. Real photos, production registrations/approvals, money flows and physical Android not exercised; no fake success.

Deployment: backend repaido-api-00037-put promoted to100% after23 existing HTTP smoke checks and6 new workspace route/auth checks passed. Firebase hosting and cPanel published with both new APKs. Initial merged archive inadvertently used0600 permissions, causing403; corrected workspaces-permissions archive restored0644 and all58 published hash/route/cache/security/CORS checks passed. package_cpanel.py now explicitly encodes0644. Final desktop sidebar correction published in workspaces-layout-20260926; superseded by subsequent compact-service UI release. Live admin signed in as approved account, worker application summary loaded, pending identity/bank decision guard verified, support status filters visible. No live approvals or financial mutations performed.

Exact blockers: real Razorpay payments/refunds and RazorpayX bank validation/payout credentials absent. Existing operational approval requires identity approved AND bank provider verified, so overview approval remains disabled until those real checks pass. User's request for complete real payment/rental-deposit lifecycle cannot be claimed met without provider testing. Product-photo orphan cleanup/retention, indexed high-volume leaderboard retrieval, global geospatial clustering/map visualization, detailed team RBAC and real-device camera testing remain. Permission denials use recovery/manual paths. Full WCAG conformance and representative usability testing not claimed.

# 25 September 2026 — admin session identity and refresh

Resolved live company-admin access failure. Both requested Firebase grants persisted and runtime already had firebaseauth.viewer. Live refreshed UI revealed active browser identity was the phone-based worker account, not an approved email identity. Company PortalAccess now requests fresh ID-token claims on entry/retry, checks admin/role before rendering admin workspace, shows signed-in identity and Refresh access, and guards stale async auth results. Admin workspace shows current email and Refresh renews ID token before protected API reads. Backend authorization unchanged. No further grants, merges or impersonation were performed.

Files: web/src/components/PortalAccess.tsx, OperationsAdmin.tsx. Both TypeScript/Vite builds passed. Published Firebase and cPanel (repaido-cpanel-admin-session-20260925.zip). Firebase JS index-BLkSAt0U.js / cPanel index-C9OVQSKA.js. Live Google sign-in completed as miku0027@gmail.com and the protected overview successfully loaded 1 worker and2 open bookings, with no authorization error. Second account Google login not exercised. All58 published hashes, direct routes, MIME/cache/security headers, redirects, private-path protection and production CORS passed. Backend remains00035-buw. Existing logged-in worker/customer identity can differ from the company identity; use the approved Google account at company-admin.

# 25 September 2026 — requested company-admin access

Enabled Firebase custom claim admin=true for the two email accounts explicitly requested by the owner. Existing claims preserved and both grants verified by Firebase Admin readback. First account existed with verified Google provider; second required a new email-only Auth record, created without password and without marking email verified. Users must sign in using their own Google accounts. Existing sessions must sign out/in to refresh ID-token claims. No IAM, credentials, public allowlists or client-side admin bypass added; backend operator checks unchanged. Local restricted audit deployment/admin-access-20260925.json stores prior claims for reversal (not in hosting bundle). No impersonation token minted and no KYC/finance operations performed. Actual browser login under the second Google identity remains for its owner.

# 25 September 2026 — supported-city registration fix

Fixed the reported worker setup error. Root cause: free-text Service city passed to a strict case-sensitive membership check. Worker onboarding now loads a required supported-city select from /api/catalog with loading/error/retry states and save disabled if the list is unavailable. Backend trims whitespace and matches case-insensitively, persisting the canonical city for dispatch. Unsupported cities remain rejected. Onboarding request failures are caught within the form, retaining entered fields; the unrelated global Retry connection action now appears only when worker account loading failed.

Files: backend/operations.py, backend/test_operations.py, web/src/components/LiveWorkerPortal.tsx and deployment artifacts. 18 operations tests passed, including Balasore/lowercase/space variants and unsupported-city rejection with prior profile intact. Both TypeScript/production builds passed. 23 staged HTTP health/access checks passed. Backend repaido-api-00035-buw now100%; Firebase published. cPanel archive repaido-cpanel-worker-city-20260925.zip extracted; all58 intended deployed file hashes, routes, cache/MIME/security headers, redirects and CORS passed. Live authenticated browser confirmed the catalogue city selector loads and keyboard selection sets Balasore. No registration submitted. Firebase JS index-CXWD-NM4.js; cPanel index-BCPqmaGR.js. Shared hosted Android frontend receives the same fix without another APK. No real registration or terms acceptance submitted by the agent. Deployment verifier now URL-encodes asset paths after a filename containing spaces caused its initial run to fail before hash comparison. Three accidental synchronization backup copies in dist-cpanel were excluded from the intended release manifest and future packages; cPanel correctly blocks the duplicate HTML with403. Intended manifest58; Firebase build58. Full verification rerun against intended assets.

# 25 September 2026 — worker registration, GPS and web work camera

Implemented: explicit existing-worker login in onboarding (sign out, then verify registered phone; no account merge). Registration GPS now distinguishes denied/unavailable/timeout/insecure contexts, retries unavailable/timeout with fresh approximate GPS only for registration, has busy feedback, and offers the existing accessible map plus independently validated latitude/longitude fields (no silent zero coordinate). Android permission callback now waits for OS permission instead of immediately rejecting; requests fine/coarse together, restricts origin. Agent test version 1.2.1/code4. Existing job arrival geofence/accuracy checks unchanged.

Web parity improvement: BrowserEvidenceCamera uses live getUserMedia, fresh GPS, task-bound capture session, visible time/task/customer/GPS stamp and embedded JSON EXIF. Camera tracks stop on close/capture/unmount. No gallery substitute. Failed upload retains in-memory bytes for idempotent retry. Backend explicitly accepts web-camera provenance through identical authorization, coordinate, visit/state, metadata, private storage, checksum, expiry and mandatory-before/after gates. Neither native nor web metadata is hardware attestation. Existing worker web already offers assignments, acknowledgement, dispatch, arrival OTP, quotes, procurement/rentals, follow-ups, completion and wallet. Browser background tracking/notifications parity is NOT complete: foreground GPS and open-app task polling only; native Android supports background tracking/push with permissions.

Dispatch: removed unconditional preference for technicians over specialists. Approved, online, fresh-position, same-city/category, free-capacity and radius gates remain. Sort by genuine review average, then distance, completed tasks and stable ID. This is deterministic matching, not a proven best-candidate/ML or per-service skills engine. No fabricated ratings or client approval.

Changed files: web/src/services/deviceLocation.mjs, operations.ts, cameraMetadata.mjs; web/src/components/LiveWorkerPortal.tsx, LocationPickerModal.tsx, VisitEvidence.tsx, BrowserEvidenceCamera.tsx; web/tests/device-location.test.mjs; backend/operations.py, evidence.py, test_operations.py, test_visits.py; android/agent/build.gradle.kts and AgentActivity.java; web/public/downloads testing APKs/latest-builds.json; deployment release archive/manifest.

Verification: 40 targeted backend tests passed (operations, visits, procurement, lifecycle), including actual browser EXIF encoder→private upload→mandatory before/start/after/completion/customer review; denial/duplicate/cross-task guards retained. 10 frontend GPS/phone tests passed. Both TypeScript/Vite builds passed (existing large bundle warning). Android customer and agent debug builds succeeded after clean removed stale duplicate generated resources. Local browser sign-in entry inspected; authenticated onboarding, physical camera/location/OTP and Android installation not exercised with a real user. No production worker created/approved, no production booking/payments or identity documents used.

Deployment: staged backend repaido-api-00033-gam passed all23 read-only health/auth checks. Promoted to 100% live traffic; Firebase and cPanel publication completed. All58 live file hashes (including APKs), direct routes, cache/MIME/security headers, canonical redirects and CORS passed. Live authenticated onboarding visibly includes the existing-account login button and manual-location map; map opens with focus on Close and confirmation disabled until a pin is chosen, then closing restores focus to its launcher. No profile or location was submitted. Archive deployment/releases/repaido-cpanel-worker-camera-20260925.zip (5 entries; complete manifest58). Firebase JS index-ahWKnBpR.js, cPanel index-DxmMwpbT.js; CSS unchanged index-peJMMPMz.css. Download /downloads/repaido-agent.apk is debug test build1.2.1, not a Play release. Existing *-release.apk files not rebuilt. latest-builds.json API revision field says candidate tag, not final revision.

Remaining gates: worker must personally verify mobile, fill profile, consent/upload documents and bank information; Repaido admin reviews/approves; worker goes online with current location; customer books matching category within configured radius. Browser/OS permissions cannot be enabled remotely. Razorpay credentials absent: real payments/refunds/payouts remain blocked. Physical-phone end-to-end acceptance test and push/background behaviour still required. Server reviews/dispatch checks intentionally cannot be bypassed to make registration look successful. Address search/reverse geocoding not implemented in existing map; manual pin/coordinates supported. Follow up on service-specific skill matching, fairness/cold-start ranking and foreground web presence freshness before claiming complete production parity.

# 25 September 2026 — event-driven service discovery cards

Implemented: two rectangular service carousels within Everyday essentials, after items 4 and 10. Three diverse category slides per placement (up to six unique categories), catalogue photography, real service name/price/duration, connected Explore CTA into search → scope → existing live booking. Previous/next buttons, touch swipe, announced manual slide position, subtle opacity transition, OS/app reduced-motion handling and larger-text reflow. No autoplay. Closing discovery restores the Everyday essentials list so updated suggestions become visible.

Backend engine: authenticated POST /operations/discovery/events consumes search, category_view, service_view, banner_open events and reduces them transactionally into per-account category signals. Search text is transiently resolved against active catalogue names/categories; raw search text, precise location and arbitrary form contents are not persisted. Only typed discovery searches settled for 1.2 seconds emit search events; prefilled service names do not double-count a card click. New explicit consent_version=2 required to enable this broader scope; old consent is not expanded. Unauthenticated/opted-out calls denied. Settings/reset endpoints allow deletion of signals, recent dedupe state and seen IDs; opting out clears those too.

Algorithm: weights search 1.5/category 1/service 2/banner .5; maximum 30 score/category; exponential 7-day decay; signals older than 30 days ignored. At least two accepted visits before personalisation affects a category. Mix up to three interest categories with other categories. Daily deterministic category/service rotation avoids arbitrary reshuffling while reading. Per-target 60-second suppression, 1 event/second, 100/day, max100 dedupe IDs/day; server IDs/catalogue validation and account isolation. Expired bookkeeping is pruned on later writes, not by an automatic erasure scheduler. No price changes, fake deals/ratings, inferred emergency/diagnosis, marketing push or margin/worker-pay changes.

Endpoints: GET /discovery/feed for anonymous/general cards, GET /discovery/feed/personal for authenticated cards; existing preference and legacy interest entry points retained with refreshed-consent requirement. Consent is independent of marketing. Cards are hidden outside supported cities, and do not assert worker availability before dispatch. Client refreshes after meaningful events when returning home; no raw clickstream queue or external analytics provider added.

Files: backend/discovery.py, backend/test_discovery.py; web/src/components/ServiceHydration.tsx (new), SearchDiscovery.tsx, web/src/App.tsx, web/src/design-system.css; web/src/services/serviceSuggestions.mjs and web/tests/service-suggestions.test.mjs; deployment/hydration_smoke.py and release archives/manifest.

Validation: 21 targeted discovery/operations tests passed; final consent-guard run 8 discovery tests passed. Covers real active catalogue, rating/worker privacy, coverage, unauthenticated rejection, genuine repeated interest, diversity, decaying influence, bounded/deduped events, per-user isolation, opt-out/reset erasure, old-consent rejection. Both production builds/TypeScript passed (existing ~1.50 MB bundle warning). Manual browser at 390/320px: carousel next/keyboard announcement, service CTA → matching discovery, closing restores home; no horizontal banner overflow during final opacity animation; enlarged text and app reduced motion (animation none) checked, restored afterward. Local axe: 0 violations/47 passes, some contrast checks incomplete; not full WCAG certification. Physical Android, OS screen reader, user research and real-user personalisation behavioural trial not performed. Shared customer Android hosted WebView receives same UI/API; no APK rebuild.

Release candidates: initial backend 00030-wor passed 23 health/access checks and read-only hydration smoke, no production traffic. Final consent guard revision repaido-api-00031-daj passed hydration smoke and was promoted to 100%; previous production 00028-yuw retained. Firebase hosting deployed and final cPanel ZIP extracted to public_html; final file verification pending. Final Firebase JS index-uocP02OD.js; cPanel JS index-DuG1bu1M.js; CSS index-peJMMPMz.css. Use deployment/releases/repaido-cpanel-hydration-final-20260925.zip ONLY; includes previously unpublished CSS explicitly. Earlier hydration ZIP is staged in private cPanel root but must not be published over the final version.

Remaining: no fully general arbitrary-element/item tracker (intentionally scoped to service catalogue interactions); no marketing/discount/push engine; no validated conversion/retention improvement claims. Before high traffic add indexed feed/cached catalogue retrieval, global request quotas, asynchronous aggregate cleanup/defined erasure retention and monitored ranking fairness. Existing payment/provider blockers remain unchanged. Production backend hydration smoke and initial 58-file cPanel verification passed. Live browser exposed stale cached-profile/auth state; fixed by deriving feed identity from Firebase onIdTokenChanged and using public suggestions for guests. Personal-feed failures recover to public cards with a notice; complete outages remain explicit errors. Four additional frontend recovery tests passed. Final session patch Firebase JS index-CpyBfYbs.js / cPanel JS index-C5j-Qb8e.js, same CSS; ZIP repaido-cpanel-hydration-session-20260925.zip overlays the already-deployed final bundle. Final live browser verified both carousel placements, next-slide announcement, real catalogue prices/descriptions and Your service suggestions controls after the stale-session fix. Preferences were not enabled or changed on the live customer account. Final verification passed: all 58 SHA-256 hashes, direct routes, asset MIME/cache/security headers, canonical redirects, sensitive-path blocks and production CORS. Latest release consists of hydration-final plus hydration-session delta; do not roll back to the earlier staged ZIP.

# 25 September 2026 — agent OTP recovery and compact home cards

Implemented: Firebase phone collision recovery while switching from a customer/Google account to worker. Existing no-phone account still links a new phone normally, and a linked phone reauthenticates. If Firebase reports account-exists-with-different-credential with a verified temporary phone proof, an explicit “Continue with this mobile account” action signs into that existing phone UID. No account merge, document transfer or permission escalation. Proof is in memory only, expires locally after two minutes, binds to the original UID and is invalidated on resend, logout, unmount, failed continuation or reuse. Missing proof offers fresh mobile sign-in recovery. Backend worker approval gates are unchanged.

Root cause evidence: installed Firebase browser SDK linkWithPhoneNumber throws account-exists-with-different-credential when the provider returns temporaryProof. PhoneAuthProvider.credentialFromError extracts that proof. This was a credential collision, not necessarily an incorrect OTP. Reference: https://firebase.google.com/docs/reference/js/auth.phoneauthprovider and https://firebase.google.com/docs/auth/web/account-linking .

UI: home Everyday essentials uses discovery card components/styles: consistent 16px section insets, 12px card padding, 52px thumbnail, 14px title, 13px price/duration, 12px scope note, full-row semantic buttons; 1 column mobile/2 desktop. Removed “Clear prices. A choice that fits.”, its comparison sentence and Offers & pricing panel from discovery. Shared hosted Android/web source.

Changed: web/src/services/phoneAccountRecovery.mjs, repaidoService.ts; web/src/components/LiveWorkerPortal.tsx, SearchDiscovery.tsx; web/src/App.tsx; web/src/design-system.css; web/tests/phone-account.test.mjs; deployment artifacts.

Validation: six targeted auth tests passed against actual Firebase browser credential extraction with simulated sign-in (valid conflict, bad OTP/missing proof, changed UID, expiry, cleanup, nonreplay after network failure). Both TypeScript/production builds passed, existing bundle-size warning remains. Browser 390px cards: 14px titles/12px padding; 320px no horizontal document/dialog overflow; search modal contains none of the removed text; card opens matching-service discovery; Escape works. Local axe scan: 0 violations, 46 passes, contrast checks had incomplete/offscreen results and need manual review; no full WCAG claim. Real SMS login, physical Android and multi-account production linking NOT performed. User should request a fresh OTP after refresh and use the explicit mobile-account continuation when prompted; if proof expired, resend.

Release: Firebase JS index-CbBFnhMV.js; cPanel JS index-Bz8fP856.js; CSS index-NCMa6s9e.css. ZIP deployment/releases/repaido-cpanel-agent-otp-cards-20260925.zip. Backend unchanged at repaido-api-00028-yuw. Firebase hosting and cPanel publication complete. All 58 live file hashes, direct routes, headers, redirects, sensitive-file blocks and CORS passed verification. Live browser: 19 home cards at 14px titles/16px section padding; discovery panel count zero, dialog opening/Escape verified. Real customer SMS remains user-confirmation pending.

# 25 September 2026 — rentals release

## Implemented
- Shared customer web/hosted Android UI: Spare Parts Buy/Rental switch, rental category/search catalogue, compact details/terms/rate picker, pickup/delivery, Profile → My rentals, current accrued charges and return/refund/payment states.
- Approved shop desktop workspace: rental inventory, required deposit and replacement value, daily/weekly/30-day rates, units, condition/instructions, optional photo URL, delivery area/fee, order acceptance/decline, six-digit renter handover/return verification, inspection/damage claims and repaired-unit restocking.
- Agent ongoing tasks: equipment rental request with customer rate approval; agent pays deposit and is responsible for custody; returned rental usage is added to the final customer task invoice. Completion/cancellation/rescheduling are blocked while rental custody/request remains open. No extra worker commission is charged on rental pass-through amounts.
- Transactional stock reservation/version checks/expiry; immutable agreed terms; role and participant checks; live server-calculated usage; return requests alone do not stop billing. Each started period is charged, with no automatic cheaper-period conversion. Physical return or independent evidenced custody resolution stops billing.
- Repaido collects refundable deposits via Razorpay integration; separate liability ledger, never shop earnings. Provider-verified capture, reconciliation, retry-safe orders/refunds, approved damage deductions, independent dispute/loss decisions, quarantine and weekly shop-payable integration. Provider outage/disabled credentials produce explicit blocked states. No real money moved in this release.
- Service ratings now aggregate verified completed-booking reviews, including the first real review. No random initial 4.5+ ratings were added.

## Changed files
backend/rentals.py (new), backend/test_rentals.py (new), backend/main.py, backend/Dockerfile, backend/integrations.py, backend/operations.py, backend/shop_payouts.py; web/src/components/Rentals.tsx (new), PaymentPanel.tsx, OperationsAdmin.tsx, SparePartsShop.tsx, OperationalJobs.tsx; web/src/App.tsx, web/src/design-system.css, web/src/services/repaidoService.ts; deployment/rentals_smoke.py, release manifest and ZIP.

## Validation
- Full backend suite: 102 passed before final dispute guard; final focused rental suite: 14 passed (13 prior tests plus one added), covering customer/task flows, daily/weekly/monthly billing, authorization, stock races, idempotency, capture pending/failure/retry, OTP lockout, damage/dispute/loss, refunds, weekly payouts and real first-review aggregation. Gateway simulated only; no live Razorpay certification claimed.
- Final TypeScript plus Firebase/cPanel production builds passed. Existing large JS bundle warning (~1.49 MB uncompressed) remains.
- Candidate health/auth checks: 23 passed; rental catalogue/access/ratings checks: 5 passed. Local fixture is SQLite-only, explicitly labelled; production smoke rejects any fixture item.
- Manual browser: Buy/Rental navigation, local preview product checkout, weekly selection (₹500 usage), delivery selection (₹50), separate ₹1,000 deposit/₹2,000 replacement liability, required delivery field, unchecked consent/disabled submit, 320px dialog no horizontal overflow, Escape closes/restores View rental focus. Viewport override reset. No physical Android, real authenticated shop/renter multi-device UI, screen-reader, full axe/AAA or representative-user usability claim.

## Deployment
- Cloud Run repaido-api-00028-yuw promoted to 100%; prior repaido-api-00025-voh retained for rollback. No database fixture or production orders added.
- Firebase hosting deployed index-Dzc4WxSK.js.
- cPanel rental delta ZIP deployment/releases/repaido-cpanel-rentals-20260925.zip uploaded under private /home/repaidoc, extracted into public_html; index-DwuZuiRT.js and index-CwhKwQmd.css. cPanel remains frontend hosting; Firebase/Cloud Run backend shared by web and hosted customer Android.
- Postdeployment cPanel verification passed: all 58 SHA-256 hashes (including unchanged APKs), asset MIME/cache headers, direct customer/worker/shop/company routes, canonical redirects, sensitive-file blocks and production CORS. Production rental smoke: all 5 checks passed. Live browser confirmed Buy/Rental, honest empty rental catalogue, authenticated My rentals empty state and Profile → My rentals modal. No live mutation or money movement.

## Exact blockers / next actions
1. Razorpay key/secret/webhook credentials and payment activation remain missing/disabled. Payout provider/account activation also remains blocked. Add secrets server-side, run TEST-mode authenticated capture/refund/reconciliation and RazorpayX payout checks, then approve live activation. Until then no paid rental handover can be completed; UI explicitly reports unavailable payments. No fabricated success.
2. Approved shops must add real rental listings; none are seeded in production. Rental pass-through currently credits full usage/delivery to shop liabilities; no new rental commission/tax policy invented. Review operational rental terms, period rounding, damage evidence and liability policy before launch.
3. Standalone rental notifications currently rely on visible-screen polling/refresh and audit records; dedicated push/email reminders and receipt export are not implemented. Task rentals use existing job events. Add consent-aware overdue/acceptance/return/refund notifications and overdue operations before scaling.
4. Damage review accepts private case evidence references/notes; no dedicated rental photo-upload/capture UI yet. Add protected evidence uploads and operational evidence retention; do not treat self-reported damage as auto-deductible.
5. Large-catalogue pagination/indexed queries and service-review materialized aggregates remain scalability work (existing transactional store scans). No validated optimum ranking or general AAA conformance claim.
6. Hosted customer shell receives these shared screens/backend; no new APK built or physical-device/background testing completed. Older independently native agent surfaces need a separate parity audit.

## Interaction checklist
Buy/Rental → catalogue (loading/error/retry/empty); category/search → local filtered live listings; View rental → rate/terms/delivery request (auth/version/stock recovery); My rentals → participant records (signin/retry/refresh); task rental → customer approval → shop acceptance → verified deposit → OTP handover → usage → return request → OTP receipt → inspection → usage payment/task bill and deposit refund; damage → acceptance or independent admin review; admin custody outcome → continued rental/verified return/reviewed loss; stock editor → versioned inventory; weekly payables → existing verified payout process. Failed provider requests reconcile before retry; no client-controlled captured/verified states.

## 25 September 2026 — search discovery release

Implemented and deployed a shared React discovery modal for cPanel/Firebase/Android WebView: blurred backdrop; compact service cards; category rail; price/sort/professional-level filters; service scope details; up to three package comparisons; existing live booking handoff; home discovery entry after the service list; restrained entry/feedback motion with OS/app reduced-motion handling. Home and Services View actions enter discovery. Native dialog Escape/focus restoration; search receives initial focus.

Backend: `backend/discovery.py`, registered in `backend/main.py` and included in `backend/Dockerfile`. Public `/operations/discovery/search` searches active live catalogue and approved/online workers, checks fresh positions and travel limits, ranks skill relevance/review confidence/distance, returns a safe field projection. Discovery accepts 8 km; **actual booking dispatch and worker-configured coverage remain capped at 6 km**, disclosed in results. No worker location coordinates returned. Location/search text is not saved by this engine.

Personalisation: authenticated `/discovery/preferences` GET/PUT and `/discovery/interest` POST. Explicit opt-in, account isolation, bounded category counts, one event/minute, disable clears counts. Personalisation changes suggestions only, not prices/payouts. Marketing notifications are not subscribed or sent.

Changed files: `web/src/components/SearchDiscovery.tsx`, `web/src/components/ui.tsx`, `web/src/App.tsx`, `web/src/design-system.css`; backend files above; `backend/test_discovery.py`; `deployment/discovery_smoke.py`; release artifacts/manifest.

Validation: both frontend production builds passed (existing large-bundle warning remains). Operations/API/discovery suite 27 passed, then final discovery suite 4 passed (28 unique tests total). Candidate HTTP health/auth suite 23 passed; final candidate discovery smoke passed with real catalogue, no-location/no-results states, safe projection and authenticated preferences. Manual browser: 390px layout and 320px no horizontal modal overflow; category search, no-results recovery, comparing two cleaning packages into the correct booking package, keyboard Enter opening/search focus, Escape closing/opener focus, blurred backdrop. No real customer booking/payment submitted. No physical Android, screen-reader, full axe, text-zoom or representative-user testing claimed.

Release: Cloud Run `repaido-api-00025-voh` promoted to 100%; previous `00021-qud` retained. Initial candidate `00023-hiz` failed because Dockerfile omitted new module; corrected before traffic. Firebase deployed JS `index-CTJu8xBI.js`; cPanel extracted `deployment/releases/repaido-cpanel-discovery-20260925.zip` to public_html, JS `index-C6RrI1LG.js`; shared CSS `index-Dr3ng5Ik.css`. Same backend and customer UI on both web hosts; no APK rebuild required for existing hosted customer shell. Final cPanel verification: all 58 SHA-256 hashes, direct routes, MIME/cache/security headers, canonical redirects, blocked sensitive paths and CORS passed. Live browser displayed 23 real catalogue services with rendered thumbnails and the new modal.

Remaining scope / next actions:
- No actual discount campaign or promotional push engine shipped: no approved bookable offer definitions, funding budget/margin floor, eligibility/redemption policy or marketing-consent/frequency-cap implementation. Offers disclosure is an honest empty state, not a fake deal. Implement server-authoritative funded coupon redemption/checkout accounting and explicit marketing opt-in before campaigns; preserve worker shares. No deceptive urgency/pricing/hidden consent.
- Discovery ranking is a transparent heuristic, not a validated optimum or ML engine. Public endpoints scan the existing catalogue/workers; add indexed geospatial retrieval/rate limits/caching before high traffic. Current operational radius remains 6 km despite an 8 km search ceiling. Expand worker terms/registration/dispatch policy together if 8 km bookings are desired.
- Profile cards expose approved real public skill/experience/review metrics and category navigation; they do not reserve a chosen professional. Existing dispatcher assigns after request.
- Home has a discovery entry at the end of services, not an always-loaded personalised feed. Preferences are used in modal, refreshed when reopened. Marketing/personalisation retention and deletion beyond opt-out need a defined policy.
- Existing unrelated legacy UI/catalogue/offer claims and full lifecycle/provider blockers remain below. Razorpay credentials were not supplied or changed in this release.

Interaction checklist: home search → modal (retry/empty/clear); category/search/filters → POST search; service → scope → live booking; Compare → two/three-package scope comparison → live booking; location → existing location selector (manual path retained); professional → expanded facts/category results; preferences → authenticated opt-in/out (inline failure); offers → real no-campaign disclosure; Escape/close → opener. No live financial or verification statuses simulated.

# Compact parts deployment completed — 25 September 2026

User provided a clear Chrome window; cPanel compact-parts ZIP uploaded/extracted into /public_html. Prior interruption resolved. Live phone check confirms category filter returns2 plumbing items, sticky dock top matches branding header bottom86px, and no horizontal overflow. Firebase and cPanel both serve the shared update. Physical Android validation remains outstanding.

---

# Compact spare cards and category search — 25 September 2026

Changed SparePartsShop.tsx and design-system.css: short cards (~283px at390px viewport), image/name/price/discount/listed stock, full information retained in product modal. Removed crowded redundant store branding, fake rating/assured card badges and repetitive metadata. Added horizontal category rail and scoped search in sticky dock; ResizeObserver follows actual customer branding header height. Category selection clears old search, selects category, brings dock below header. Cart remains available. Both builds pass. Browser checks: plumbing category2 products, angle search1 product, dock top86px matches header bottom86px, no horizontal overflow. Android uses shared Firebase UI; native device not tested.

Firebase deployed index-Bb8JqAfa.js. cPanel candidate index-SxMxvRNS.js, CSS index-CL_CJBab.css. Ready ZIP deployment/releases/repaido-cpanel-compact-parts-20260925.zip. cPanel upload interrupted by concurrent Chrome activity; requested user reply ready. Manifest is candidate already: use this ZIP without regenerating delta. Next upload/extract to /public_html and run deployment/verify_cpanel.py. Existing backend unchanged.

---

# Compact service notices and platform parity — 25 September 2026

Replaced long service trust notices with shield/map/receipt graphics and13px labels in a native details disclosure; full review,6km availability and payment conditions remain tap/keyboard accessible. Shared Discovery.tsx/design-system.css changes deployed to cPanel and Firebase Hosting. Both builds passed and live strip/expanded explanations checked. cPanel index-CCGDSHQq.js; Firebase index-D0-BAbnj.js; CSS index-Cc0GLkNx.css.

Android customer MainActivity loads BuildConfig.WEB_URL (default https://repaido.web.app); Firebase /api rewrite targets the same repaido-api backend as cPanel VITE_API_BASE_URL. No duplicate backend or data migration needed. Physical Android app verification not performed. Preserve user preference: every customer UI release must cover both hosting targets and keep the shared backend contract consistent; native-only screens require separate consideration.

---

# Catalogue toolbar alignment — 25 September 2026

Replaced spare-parts text sort strip with labelled native dropdown and count. Services heading/Filters/sort use consistent aligned row, 14px compact text on mobile, count below; deliberate reflow below360px and with enlarged text. Updated SparePartsShop.tsx, Discovery.tsx, design-system.css. Both builds passed; live390px viewport checks show no horizontal overflow and separated controls; spare price sort selection verified. Published cPanel index-DAKDgURX.js, Firebase index-zVwHG4u7.js, CSS index-CsgEweQz.css. Archive deployment/releases/repaido-cpanel-toolbars-20260925.zip. Existing authenticated workflow/accessibility limitations remain.

---

# Customer product details — 25 September 2026

Added compact customer-only spare product modal in SparePartsShop.tsx, optional Modal className in ui.tsx, and shared styles. Keyboard/card trigger, native dialog focus/escape restoration, description, price/MRP, stock listing, SKU, compatibility, warranty, GST, matched shop address and Google Maps directions; missing locations get a fallback. No private shop bank/identity data rendered. Uses existing local catalogue/shop data, not new live-stock validation; modal advises confirming stock/prices before travelling. Existing catalogue seed/verification claims elsewhere remain outside this change.

Both builds passed; mobile modal visually checked; Enter/Escape and focus restoration verified; live cPanel dialog and18% GST verified. Published to both hosts. cPanel index-CFcpKU7b.js, Firebase index-DJD4Od2k.js, CSS index-AyB8bZZl.css. Release ZIP deployment/releases/repaido-cpanel-product-details-20260924.zip. No purchases or real directions navigation performed.

---

# Booking side-padding release — 24 September 2026

Added a customer-only booking wrapper in App.tsx and shared CSS: 16px phone side padding with safe-area support, 24px at768px+, and bounded/wrapping content. Both production builds passed. Published to cPanel and Firebase; live phone check confirms 16px side padding and no document overflow. cPanel JS index-B2B79GPO.js, Firebase index-DArZlnfO.js, CSS index-BAGhDmsK.css. Archive: deployment/releases/repaido-cpanel-booking-padding-20260924.zip. Signed-in populated booking records were not tested in this spacing-only pass.

---

# Release complete — cPanel, 24 September 2026

- Published the final UI and UX-writing release to https://repaido.com using the authenticated cPanel File Manager. Uploaded `repaido-cpanel-writing-20260924.zip` outside the document root and extracted into `/public_html`.
- Live cPanel JS `index-X6nvkyn4.js`, shared CSS `index-B3Eb1Fy9.css`. Firebase remains `index-BrbTHpIi.js`.
- `deployment/verify_cpanel.py` passed: all58 release files match SHA-256, portal refresh routes, cache/MIME/security headers, HTTP/www redirects, private-file denial and API CORS/auth checks.
- Browser verified the new home wording and single static banner on repaido.com. Prior cPanel deployment blockers below are resolved. Existing product/provider and full accessibility-testing limitations remain unchanged.

---

# Current handoff — UX writing update, 24 September 2026

- Applied the user-approved UX writing guide to recurring copy and key customer/worker/shop/company flows. Plain-language labels, sentence-case actions, clearer recovery/empty states, numeral-based milestone explanations, and removal of unsupported activation promises. Address-save success now has a status announcement rather than an error.
- Final builds passed; 8 existing frontend tests passed before final copy-only tweaks. Browser checked customer sign-in and all 3 portal entry screens. Real authentication, populated accounts and usability studies remain untested.
- Firebase final bundle: `index-BrbTHpIi.js`; cPanel candidate: `index-X6nvkyn4.js`; shared CSS: `index-B3Eb1Fy9.css`.
- cPanel remains pending: Chrome reported concurrent user activity twice. Asked user for a 2-minute clear window; no response yet. Prepared `deployment/releases/repaido-cpanel-writing-20260924.zip` includes this copy update AND prior UI rules CSS. Upload outside public_html, extract to `/public_html`, then run `backend/.venv/bin/python deployment/verify_cpanel.py`.
- Candidate manifest already reflects this build. Do not regenerate a delta until prepared archive is deployed. Previous UI-rules archive is superseded by this writing archive.
- Detailed scope, files, verification and limitations: `deployment/UX_WRITING_CHECKLIST.md`. Backend and payment/provider blockers below are unchanged.

---

# Current handoff — shared UI specification, 24 September 2026

- Implemented shared typography, contrast tokens, 48px controls, visible focus, responsive desktop/mobile grids, motion/text preferences and labelled authentication fields. Finalized brand and single static banner retained.
- Changed: `web/src/design-system.css` (new), `main.tsx`, `styles.css`, `reference.css`, `App.tsx`, `components/{Discovery,Checkout,RepaidoBrand,ui,CompanyAdminPortal,ShopAdminPortal,PartnerRegistration,SparePartsShop,WorkerPortal}.tsx`, dev-only `dev/uiAudit.ts`, package/lock files, and `deployment/package_cpanel.py` (unique release names).
- Checks: both production builds pass; 8 frontend tests pass; shared contrast token checks pass; home/sign-in axe scans zero violations (incomplete checks remain); Enter/Escape modal focus verified; 320px/1440px layout checked. Full authenticated workflows, screen readers and200%/400% reflow remain untested.
- **Firebase release complete:** https://repaido.web.app uses `index-BXn_hT9h.js`, CSS `index-B3Eb1Fy9.css`. Verified live body16px and one static banner.
- **cPanel release pending:** Mac is locked; user asked to unlock. Ready archive `deployment/releases/repaido-cpanel-ui-rules-20260924.zip` must be uploaded via logged-in Chrome cPanel and extracted to `/public_html`. Expected JS `index-CI0_u0GV.js`. Existing repaido.com remains previous release until upload. Candidate manifest already updated: do not regenerate delta before applying this ZIP.
- Next: unlock Mac, upload/extract prepared ZIP, run `backend/.venv/bin/python deployment/verify_cpanel.py`, inspect live custom-domain home/portals, rerun final catalogue axe scan and remaining authenticated accessibility checks.
- Full requirement mapping and exact validation limitations: `deployment/UI_RULES_CHECKLIST.md`. No WCAG certification claim; raster banner text remains a known image-of-text limitation. Existing payment/provider/native blockers below are unchanged.

---

# Current handoff — cPanel migration and single static home banner, 24 September 2026

## Released
- Customer site now runs on cPanel at **https://repaido.com/** from `/home/repaidoc/public_html`. HTTP and www redirect to the canonical HTTPS domain, preserving paths/queries. Direct `/worker`, `/shop-admin` and `/company-admin` routes work after refresh.
- Firebase Authentication, Firestore, FCM/private storage and existing Cloud Run/scheduler infrastructure remain in the same Google project. No backend source or service credentials were uploaded to cPanel.
- API revision `repaido-api-00021-qud` serves 100% of traffic. Prior revision `repaido-api-00019-rof` is retained. Exact CORS origins include repaido.com/www; authentication and roles remain required. Firebase Auth authorized domains now include both domains, preserving all prior entries.
- Central `web/src/services/api.ts` routes all frontend API requests (including private documents/evidence) to the configured HTTPS API origin for cPanel builds; Firebase/development builds retain relative `/api` calls.
- Removed the upper home slideshow and its wrapper. The finalized static `/images/hero-banner-promo.png` remains as the sole home banner, with unchanged artwork and a keyboard-operable button leading to Services.
- Current cPanel bundle: `index-DD67apPh.js`; Firebase-compatible preview/Android web content: `index-BF4FrZiX.js`; shared CSS: `index-DJDLSGbr.css`. Both domains have zero slideshow instances and one static banner.

## Verification
- TypeScript plus production and cPanel Vite builds passed; existing large-bundle warning remains.
- 11 focused backend API tests passed, including exact-origin preflights/private upload headers, auth rejection and malicious-origin rejection. Candidate and final production API each passed all 23 HTTP health/access checks.
- Final cPanel integrity verification passed: all 58 files match SHA-256 release manifest including existing APKs; root/portal routes, HTTP/www redirects with path/query preservation, cache/MIME/security headers, private-file denial, missing-asset/API 404s and production CORS checks passed.
- Browser checked desktop and 390px home: one loaded static banner, no carousel, no horizontal overflow at phone width; Enter on the banner opens Services. Shop phone-OTP entry, company Google-sign-in gate and worker registration/sign-in entry load directly. No error-level console messages in checked routes. Firebase preview verified separately with the new bundle and same one-banner state.
- Real sign-in/SMS delivery, authenticated bookings/shop/admin actions, payment/payout processing and native-device flows were not performed in this hosting change. No full accessibility-conformance claim.

## Files and recovery
- New: `web/src/services/api.ts`, `web/.env.cpanel`, `backend/.gcloudignore`, `deployment/cpanel.htaccess`, `package_cpanel.py`, `configure_cpanel_auth.py`, `verify_cpanel.py`, `CPANEL_RUNBOOK.md`.
- Updated: API callers in `App.tsx`, `services/operations.ts`, `services/repaidoService.ts`, `PrivateReview.tsx`, `LiveBooking.tsx`, `VisitEvidence.tsx`, `VerificationPanel.tsx`, `SparePartsShop.tsx`; `reference.css`, `web/package.json`, `backend/main.py`, `backend/test_api.py`, `.gitignore`, this handoff.
- Original host settings backed up outside the document root: `/home/repaidoc/repaido-htaccess-before-cpanel-20260924.txt`. Original PHP directives and AutoSSL paths preserved. Deployment archives remain outside the document root.
- Full initial archive: `deployment/releases/repaido-cpanel-20260924.zip`; subsequent changed-files patch: `deployment/releases/repaido-cpanel-static-banner-20260924.zip`; final manifest: `deployment/releases/cpanel-manifest.json`. Apply full archive then patch for a fresh installation, or rebuild a complete package from current source.
- Reproducible build, publication, verification and rollback instructions: `deployment/CPANEL_RUNBOOK.md`.

## Remaining blockers
- Hosting migration is complete. Existing product blockers below remain: Razorpay/RazorpayX credentials and controlled transaction testing, authorized admin/reviewer accounts, physical-device validation and unfinished operational/accounting features. Payment, worker payout and shop payout flags remain OFF.
- Existing Android APKs still use the compatible Firebase Hosting origin; they were not rebuilt for the custom domain. Public APK bytes on cPanel match the existing builds.
- Old slideshow-specific browser test scripts are historical and no longer describe the current home UI; current banner behavior was checked through browser interactions above.

---

# Current handoff — stock, procurement, in-app OTPs and shop settlement, 24 September 2026

This section supersedes procurement and shop-payment statements below. Released: API `repaido-api-00019-rof` serves 100% of traffic; Firebase Hosting serves bundle `index-BLDg-l-V.js`. Existing APKs are unchanged.

## Implemented
- Approved shops manage SKU, compatibility, prices, physical counts, reserved quantities, listing visibility and low-stock thresholds. Updates require the current version; reserved stock cannot be silently overwritten. Agent searches exclude inactive, unapproved, unavailable and unconfirmed (>24 hours) inventory.
- For new bookings, customer parts approval atomically reserves stock and creates a shop order with immutable item/price snapshots. Shop acceptance precedes collection. Rejection/expiry releases stock and credits the customer bill; a rejected stock listing requires a fresh count. Concurrent requests cannot oversell the recorded inventory. One shop per request; additional requests are supported after installation.
- Assignment/visit-bound six-digit in-app OTPs verify customer arrival and shop pickup. Codes expire after five minutes; five failed attempts cause a 15-minute lock. Codes are private to the receiving customer/shop, never sent through SMS. Existing customer-confirmed manual arrival fallback remains available where GPS fails.
- Shop order details expose only the current collecting agent's fresh consented pickup position, with opt-in live map and a text alternative. This view stops at pickup/withdrawn consent and does not expose customer home coordinates. Receipt finalization is idempotent and creates a parts bill; the agent does not pay the shop.
- Work time pauses for parts collection and resumes on verified return. Customer quote/credit lines retain the live itemized bill. Existing before/after evidence and customer completion confirmation gates remain.
- After verified pickup, accurate, continuously observed stillness beyond ten minutes creates a ₹5/min return-delay assessment. A fixed stationary anchor prevents walking from being misclassified by adjacent-fix comparisons. Missing/inaccurate/stale GPS intervals are excluded. Reliable movement at least 10 km/h or arrival ends monitoring. The policy is disclosed before collection; safe travel takes priority. Company approval/waiver is required before a monetary deduction. The highest applicable deduction applies, capped at worker gross earnings, with corresponding company ledger credit; unresolved assessments hold settlement.
- Weekly shop payables require completed, customer-paid, undisputed tasks and posted parts-liability allocation. The RazorpayX adapter verifies bank/provider references, rechecks actual customer payment immediately before transfer, uses immutable idempotent batches and reconciles provider events. Unknown transfer submissions are not blindly retried. Journals for confirmed transfers/reversals are balanced and idempotent.
- Separate shop Orders / Inventory / Earnings views and company Procurement / assessment / payout review use the existing protected desktop portals.

## Changed files
New: `backend/procurement.py`, `backend/shop_payouts.py`, `backend/test_procurement.py`, `backend/test_shop_payouts.py`, `web/src/components/Procurement.tsx`, `web/src/components/PickupMap.tsx`, `deployment/PROCUREMENT_CHECKLIST.md`.
Modified: backend `main.py`, `Dockerfile`, `operations.py`, `integrations.py`, `lifecycle.py`, `refunds.py`, legacy test fixtures; web `OperationsAdmin.tsx`, `ShopRegistration.tsx`, `OperationalJobs.tsx`, `services/operations.ts`; deployment environment/smoke checks; download manifests; this handoff. No native code or APK rebuild this turn.

## Verification
- 71 backend tests passed across procurement, shop payouts, shops, visits, lifecycle, operations, integrations, rewards and API. Includes complete v2 procurement lifecycle, OTP privacy/lockout, overselling, stock expiry/rejection recovery, walking versus stillness, assessment review/cap, weekly batching, provider refund recheck, unknown transfer retry safety, bank/role boundaries and ledger idempotency.
- TypeScript and Vite production build passed. Existing ~1.46 MB bundle warning remains.
- Candidate and production: all 23 HTTP health/authorization checks passed. Live shop OTP entry and the new Hosting bundle were inspected; no console errors appeared in the test tab. Provider/payment/storage tests use isolated fixtures/stubs; no real payment, bank transfer, OTP SMS or shop approval was performed.
- Populated authenticated shop/admin UI, physical Android GPS/camera/background behavior and real Razorpay/RazorpayX processing remain untested. No accessibility or usability certification is claimed.

## Exact remaining blockers and next actions
1. Payments, worker payouts and shop payouts remain disabled. Supply Razorpay/RazorpayX keys, account and webhook secrets through the existing server secret configuration, verify each shop's bank reference, then run controlled sandbox reconciliation before enabling flags. Shop payables also require an actual posted financial allocation journal; customer payment alone does not bypass this gate.
2. Failed/reversed shop batch reissue requires reviewed accounting recovery; automatic reissue is deliberately not implemented. Worker-payout reversal after a reserved shop transfer creates a financial-review hold instead of erasing parts liability.
3. New bookings use procurement v2. Existing in-flight v1 bookings retain legacy handovers; active-job migration needs company-assisted review and is not automatic. No historical task data was rewritten.
4. Current browser identity lacks a company-admin claim. User's approved account/email is still needed before granting that role; no role was granted automatically. Verify actual shop OTP login and approved shop/admin populated views with controlled accounts.
5. Run the physical-device checklist in `deployment/PROCUREMENT_CHECKLIST.md`, especially stationary GPS, traffic/safety exceptions, return geofence and OTP ownership. Device GPS/metadata are not hardware-attested, and physical stock remains shop-declared; this does not guarantee zero fraud.
6. Existing broader platform blockers in earlier sections remain where not explicitly superseded. Private document-review intake/malware scanning, full native integration checks and provider activation are not claimed complete.

## Entry points
Shop: https://repaido.web.app/shop-admin · Company: https://repaido.web.app/company-admin · Agent: https://repaido.web.app/worker

---

# Current handoff — desktop portals and shop approval, 24 September 2026

This section supersedes navigation/authentication statements below. Released: `repaido-api-00016-wub` serves 100% of API traffic; Firebase Hosting serves the new desktop portals.

## Implemented
- Dedicated desktop company workspace with persistent sidebar, overview, worker queue, shop queue, bookings, finance, support and moderation. Existing protected management components are retained; responsive layouts reflow at narrower widths.
- Dedicated shop mobile-OTP entry and registration, without customer-side shop/admin links. New registrations collect owner/business name, address, pickup coordinates, category and trade-registration reference. Firebase-authenticated phone is authoritative. No Aadhaar/bank numbers or document blobs collected in this form.
- Transactional shop records start pending_verification. Company reviews require actual owner identity, business and address checks, a private verification case reference and decision reason before approval. Self-review, client status/owner injection and stale review versions are rejected. Rejection feedback supports corrected resubmission; suspension revokes orders/handovers. Retry of unchanged pending submission does not create duplicates.
- Pending shops appear in Company → Shops. Shop → Refresh status retrieves the recorded decision; no SMS approval-notification claim. Approved shops use their protected handover queue. Legacy admin-provisioned shop records remain supported, but versioned applications cannot be overwritten through the legacy upsert.
- Customer profile now contains only Agent / specialist account → Register or switch as an operational entry. Switching stays in the same application route. Already signed-in customers can link their verified phone to the same Firebase UID; a phone belonging to another account yields an explicit conflict rather than silent merging. Returning to customer mode retains that account.
- Worker phone verification accepts Firebase-confirmed linked phones; shop endpoints additionally require a phone-authenticated session. Removed the development simulated-OTP fallback. Company Google sign-in is available directly on its portal; administrator claims are still required server-side and no public admin registration exists.

## Files
`backend/shops.py`, `main.py`, `operations.py`, `Dockerfile`, `test_shops.py`, `test_operations.py`; `web/src/components/PortalAccess.tsx`, `ShopRegistration.tsx`, `OperationsAdmin.tsx`, `LiveWorkerPortal.tsx`, `operations.css`, `web/src/services/repaidoService.ts`, `web/src/App.tsx`; `deployment/http_smoke.py`, this handoff. No native code changes this turn.

## Verification
- 57 backend tests passed across shops, visits, lifecycle, operations, integrations, rewards and API. Includes non-phone access rejection, application retry, privileged-field rejection, approval check requirements, independent reviewer, stale review, rejection/resubmission, suspension, legacy overwrite protection and linked-customer UID/phone-session distinction.
- TypeScript check and Vite production build passed. Existing ~1.44 MB bundle warning remains.
- Candidate and production: all 17 HTTP health/authorization checks passed. Live shop OTP entry and company unauthorized state verified; customer profile → worker → customer round trip preserves sign-in and shows no customer-side shop/admin links.
- Visually checked shop sign-in at 1440px and company sign-in reflow at 390px. No real OTP sent, no Google-account linking performed, and no real shop approved during testing. Firebase SMS delivery/linking must still be verified using actual controlled test accounts.

## Remaining limitations
- Current browser identity has no company-admin claim. Asked the user which Firebase email to authorize; no role was granted automatically. The protected company data/approval UI cannot be exercised with that account until authorized.
- Shop verification is a real manual-review record/workflow, not an automated identity/bank verifier. Company reviewers must inspect genuine evidence through their private review process. Dedicated shop document upload/retrieval, malware scanning, bank verification and payouts are not added here; do not claim those work.
- Existing approval/order data is preserved. The legacy `/shop-applications` endpoint remains explicitly blocked; the new portal uses `/operations/shop/application`.
- Worker mode is accessible within the customer app. Background task tracking and timestamp evidence capture still require the previously built Agent APK; the customer native bridge has not gained those capabilities in this desktop-focused change.
- Actual account linking on a phone already belonging to another Firebase UID cannot be performed automatically. Use the correct existing account or an audited support process.
- Full accessibility certification, physical-phone workflow and the older financial/provider blockers below remain outstanding.

## Entry URLs
- Shop (OTP + new registration): https://repaido.web.app/shop-admin
- Company (authorized Google/Firebase admin account): https://repaido.web.app/company-admin
- Customer → You → Agent / specialist account; direct worker route remains https://repaido.web.app/worker

---

# Current handoff — repeat visits and private camera evidence, 24 September 2026

This section supersedes the older release notes below. Released: API `repaido-api-00014-qoc` at 100% traffic; Firebase Hosting published the updated web bundle and Agent 1.2.0 debug APK. Historical unfinished requirements remain outstanding.

## Completed
- Same assigned task can be scheduled for another repair, inspection, update, parts visit or other documented reason. Each visit has its own ID/history while preserving the booking, accepted price and previous penalty assessments. No extra charges are implied.
- Pending next visit stays active. The existing scheduled operations sweep creates the preparation reminder at T−24 hours (immediately for shorter notice); acknowledgement is required and departure opens one hour before the visit. Tracking stops between visits. Scheduling conflicts and replayed commands are checked server-side.
- Every visit requires its own uploaded before photo before start and after photo before completion submission. Customer confirmation remains required for completion. Earlier-visit evidence cannot satisfy a new visit.
- Agent Android 1.2.0 includes a dedicated camera (no gallery picker), contextual camera/precise-location permissions, accurate fresh GPS, private temporary storage, visible timestamp/task/customer/GPS caption and embedded EXIF capture metadata. Server-issued capture sessions bind uploads to actor/task/visit; JPEG decoding, metadata, freshness, proximity, size, hash and retry validation are enforced.
- Private bucket evidence, authenticated access for customer/current assigned worker/authorized admin, access auditing and 30-day image expiry. No public evidence URLs. Native metadata is device-reported, NOT hardware-attested or tamper-proof.
- Removed operational dashboard/registration links from customer header, sidebar, profile and footer. Direct protected portal URLs remain.

## Changed files
`backend/evidence.py`, `operations.py`, `integrations.py`, `main.py`, `requirements.txt`, `Dockerfile`, `test_operations.py`, `test_visits.py`; `web/src/components/VisitEvidence.tsx`, `OperationalJobs.tsx`, `OperationsAdmin.tsx`, `web/src/services/native.ts`, `operations.ts`, `web/src/App.tsx`; `android/agent/build.gradle.kts`, `src/main/AndroidManifest.xml`, `src/main/java/com/repaido/agent/AgentActivity.java`, `EvidenceCameraActivity.java`; `deployment/http_smoke.py`, `deployment/VISIT_EVIDENCE_CHECKLIST.md`, download APK/manifest and this handoff.

## Verification
- 52 backend tests passed (visits, lifecycle, operations, integrations, rewards, API), isolated SQLite/private-storage fixtures/provider stubs. New coverage: two-visit completion, 24-hour/immediate reminder, mandatory acknowledgement, before/after gates, stale/cross-visit/gallery/malformed metadata rejection, ownership, duplicate command/upload retry, uncertain upload reconciliation, expiry, preserved penalties and nonoverlapping assignment.
- TypeScript and Vite production build passed; existing 1.42 MB bundle-size warning remains.
- Final clean Agent debug APK build passed; platform Camera/deprecated API warnings remain.
- Manually inspected local customer home and profile: operational links absent. No authenticated browser booking mutation or OTP submission performed.
- Candidate and promoted production API: all 15 HTTP health/access checks passed. Deployed signed-in customer home/profile inspected: operational dashboard links absent. Hosted Agent APK SHA-256 checked against the build manifest.
- No physical Android device was connected. Real camera/EXIF/GPS interoperability, background notification delivery, permissions/recovery and complete on-device journey remain UNTESTED. Automated JPEG fixtures are not device captures.

## Limitations / exact next actions
1. Install updated Agent APK and run the physical checklist below before operational rollout. Browsers and old APKs cannot satisfy mandatory evidence capture. GPS must be accurate within 50 m and within 150 m of service location including accuracy; permissions/poor GPS fail explicitly. Contact support rather than fabricate evidence.
2. Existing in-progress visits without a genuine before photo will be blocked from completion. Use the authorized support/recovery process to start a documented new visit at arrival; do not backdate or bypass evidence.
3. Follow-up reminders do not automatically create new monetary attendance penalties: existing accepted terms cover the old reminder schedule. Previously imposed penalties remain in settlement; a separately approved policy is required for new follow-up penalty terms.
4. No hardware attestation; authenticated malicious clients can manufacture camera metadata. The feature records device claims plus server upload time and validates consistency, not forensic authenticity. Evidence bytes expire after 30 days; task/audit metadata remains.
5. Auth uses existing Firebase identities and server roles, not shared portal passwords. No admin/shop account was newly provisioned or credentials reset. Phone OTP and approved worker status are required for operational agent actions.
6. Razorpay secrets/testing and the older accounting/production blockers below remain unchanged; payment/payout flags remain off.

## Access
- Agent: https://repaido.web.app/worker — existing Firebase sign-in, phone verification, approved worker profile.
- Company admin: https://repaido.web.app/company-admin — existing Firebase account with authorized admin role.
- Shop: https://repaido.web.app/shop-admin — existing Firebase identity mapped to the approved shop owner.
- New Agent test APK: https://repaido.web.app/downloads/repaido-agent.apk . Debug signed, not a Play production release.
- Admin/shop users may sign in at the customer login then open the direct URL; hiding customer links does not replace API authorization.

---

# Current handoff — lifecycle recovery release, 24 September 2026

This section supersedes older status below. The entire historical product specification is **not fully complete**. Do not describe provider-stub tests as real banking or physical-device testing.

## Completed this session
- Added authoritative support conversations, versioned escalation/resolution/reopening, owned saved addresses and profile endpoints; booking-linked warranty/payment/penalty/safety cases hold new payouts.
- Customer-confirmed manual arrival (30-minute scope), safe stop, admin recovery proposals, customer approval/rejection, follow-up/new acceptance, reassignment access revocation, and partial completion with separate agreed service/parts amounts. New visits preserve history; no automatic acceptance or new charges. Multi-worker financial allocation stays held.
- Receipts/service statements, rebooking drafts and UI, review replies/reports and admin report disposition, notification read state and related-booking navigation.
- Penalty appeals can waive/uphold unreleased assessments and recalculate affected settlements. Already-created payouts are not rewritten. Audited reward source exclusions remove proven invalid response/ack measurements; review scores stay unchanged.
- Refund intent reservation and provider adapter: uncertain POST never repeated; receipt lookup reconciles a lost response; refund journals are idempotent. Existing payouts require recovery before refunding.
- Failed normal earnings payout reissue: provider-confirmed failure only, separate immutable attempt history, new provider key; old attempt events cannot overwrite the current attempt. Unknown outcomes retain their original key.
- Connected customer support/recovery, admin support/resolution/penalty/refund/reward/moderation screens, saved addresses in booking, rebooking, notification inbox. Support/recovery/refund retry IDs survive reload. Removed the generic modal overlay that hid support and unsupported cash/automatic-promotion copy.
- Customer Android native notification bridge, opt-in/disable controls, private FCM messages and booking deep links. Registered `com.repaido.app` Firebase app `1:133610574058:android:76fde448cc32ed83a84793`. Public config only in APK/repository. No credentials embedded.
- Customer WebView: HTTPS-only trusted origin, no mixed content/file access or blanket media permission, contextual location and notification requests, reduced splash delay. Agent native flow retained.

## Changed files
- Backend: `backend/lifecycle.py`, `backend/refunds.py`, `backend/main.py`, `backend/operations.py`, `backend/integrations.py`, `backend/rewards.py`, `backend/Dockerfile`, `backend/test_lifecycle.py`.
- Web: `web/src/components/Lifecycle.tsx`, `OperationalJobs.tsx`, `OperationsAdmin.tsx`, `PrivateReview.tsx`, `LiveBooking.tsx`, `operations.css`, `web/src/services/operations.ts`, `web/src/App.tsx`.
- Android customer: `android/app/build.gradle.kts`, `src/main/AndroidManifest.xml`, `src/main/java/com/repaido/app/MainActivity.kt`, `CustomerBridge.java`, `CustomerPushService.java`, `src/main/res/values/firebase.xml`, `android/app/google-services.json`.
- Release/checklist: `deployment/http_smoke.py`, `deployment/LIFECYCLE_CHECKLIST.md`, this handoff. Build outputs regenerated.

## Verification
- **46 actual API/domain tests passed** using isolated SQLite and provider stubs. New tests cover support ownership/holds/retry, manual arrival, safe-stop/resume, partial final allocation, addresses, refund uncertain outcome, failed payout reissue/history, penalty waiver, reassignment revocation, notification ownership and metric correction ownership.
- Final TypeScript check passed; exact deployed revision is recorded below. Vite production build succeeds; existing ~1.42 MB bundle warning remains.
- Customer and Agent debug APKs build successfully. Offline build initially lacked two transitive dependencies; official registry download resolved it. Native deprecated API warnings remain.
- Browser manually inspected profile → support, fixed duplicate modal, verified actual support form/signed-out recovery. No OTP sent and no authenticated UI transaction performed.
- Candidate API health/catalog/status and unauthenticated role gates passed before promotion; final expanded smoke results recorded below.
- Not run: real Razorpay transactions, real KYC approvals, physical-phone push/location/Doze tests, full WCAG audit, representative usability tests. Historical arithmetic-only test_product_lifecycle and older browser scripts are NOT counted as current lifecycle validation.

## Exact blockers and unfinished work
1. User will add Razorpay credentials later. Keep payment/payout flags OFF. Need Secret Manager bindings for RAZORPAY_KEY_ID / KEY_SECRET / WEBHOOK_SECRET and RAZORPAYX_KEY_ID / KEY_SECRET / ACCOUNT_NUMBER / WEBHOOK_SECRET; register webhooks and enable only after sandbox checks. RazorpayX bank validation/payout activation, funding and static egress allowlist are separate from payment-gateway credentials.
2. Actual company reviewer identities need Firebase admin claims, real approved providers and phone verification. No arbitrary accounts were granted privileges.
3. **Accounting code still missing:** approved allocation across multiple workers, after-payout refund/appeal adjustments, payout-reversal recovery and failed bonus-withdrawal reissue. Those cases remain explicitly held; do not manually erase journals or pretend successful settlement. Cash collection/shop payouts/GST invoice issuance are not implemented as verified financial flows.
4. Recovery proposal withdrawal and some profile/preferences APIs exist without full management UI; admin can call the protected API, but stale-proposal cleanup still needs a UI. Comprehensive shop procurement/admin, roadside dispatch and cross-service provider discovery from the original specification remain incomplete.
5. Customer push is compiled/configured, but both APKs require physical-device validation of opt-in, denied permissions, cold-start taps, token rotation, logout deregistration, Doze/background delivery and GPS Stop. Play production signing is not configured; APKs are debug testing builds.
6. Private KYC still needs malware scanning/operational review controls. Support replies require refresh; support-specific push and staffed escalation SLAs are not implemented.
7. Operational storage still scans collections and retains growing histories; indexed/paginated read models, event archival, load tests and broader accessibility validation remain outstanding. Existing legacy screens/fixtures require a further production-only audit.

## Next actions
1. Finish the remaining accounting adjustment model and protected admin UI before releasing held multi-worker/refund/reversal funds.
2. Complete proposal withdrawal/profile administration and remaining shop/roadside flows without inventing live suppliers or dispatch availability.
3. Install the new APKs on actual devices and execute the physical-device checklist.
4. Add secrets via Secret Manager, bind them server-side, run Razorpay sandbox capture/failure/pending/refund/reissue/bonus tests and webhook reconciliation; only then authorize live activation.
5. Use `deployment/LIFECYCLE_CHECKLIST.md` for visible journeys and recovery states. Retain older requirements below until implemented.

## Release status
- API `repaido-api-00012-koy` promoted to 100% traffic after the expanded 13-route candidate smoke passed. Live Hosting API smoke also passed all 13 routes.
- Web build and final TypeScript check passed; Firebase Hosting published to https://repaido.web.app. Live browser verified support form, sign-in recovery, Escape dismissal and focus restored to Help & Support Desk.
- Updated debug APKs copied to existing `/downloads/repaido-app.apk` and `/downloads/repaido-agent.apk`; metadata/checksums in `/downloads/latest-builds.json`. Both public APK downloads were fetched over verified HTTPS and their size/SHA-256 matched the final builds byte-for-byte.
- Customer APK 17,688,109 bytes; SHA-256 `3bb13a96dc955dd0b820884f4b2f85a6e3498691687860ce3dcbee814739c95b`. Agent APK 3,473,456 bytes; SHA-256 `0c6c04c6fc5f287b54a2f48682893206acdd4ef76f0ddf1153ea84dd32fb3ac9`.
- Both final APK builds passed after clean removed regenerated duplicate resource filenames. Old `*-release.apk` URLs are historical builds, not this release. Use the two URLs above; these are debug testing builds, not Play production releases.
- Existing ~1.42 MB JS bundle warning, native API deprecations and one Starlette/AnyIO test deprecation remain.

---

# Current handoff — production integrations, 23 September 2026

This section supersedes historical status below.

## Implemented and deployed scope
- Private team KYC review: consented JPEG/PNG/PDF uploads, size/type/rate validation, opaque Cloud Storage objects, 30-day retention, admin-only audited attachment downloads, current-document-set binding, explicit manual identity checks. No automated biometrics. Worker approval cannot bypass identity and bank evidence.
- RazorpayX bank validation adapter: provider GET, active account, matching worker contact reference and normalized legal name; raw bank credentials kept out of profiles. **Not live without provider credentials/account activation.**
- Native Android Agent FCM + location foreground service, origin-restricted WebView bridge, notification opt-in, generic private notifications, user Stop control, in-memory job-scoped tracking capability, server revocation on completion/consent withdrawal. Web retains foreground fallback.
- Durable transactional notification outbox, device registration/revocation, per-delivery leases/backoff, invalid-token retirement, authenticated Cloud Scheduler dispatch/rewards/reconciliation.
- Razorpay invoice checkout, stable order per job, ambiguous creation held for receipt reconciliation, signature-verified webhook inbox, authoritative provider GET, captured amount/order/currency checks, refund monotonicity, duplicate-effect protection.
- Payout authorization/reconciliation, stable provider idempotency keys, bank/payment/worker gates, separate applied deductions and balanced allocation/payout/reversal journals. No real money was moved.
- Owner-approved future policy `earnings-75-15-10-v2`: 75% worker, 15% company, 10% bonus reserve; parts separate. Highest single penalty only, comparing attendance percentages against reduction to 50% of base fee. Example ₹1,000 base -> regular worker ₹750; qualifying highest reduction -> worker ₹500, company ₹400, reserve ₹100. Existing bookings unchanged; new assignments require explicit worker acceptance.
- Achievement engine `retention-v1`, worker wallet and congratulations modal; minimum work/review/reliability evidence, transparent score, bounded availability contribution, no speed-only incentives, five- then ten-task milestones, minimum seven-day intervals, locked/available/withdrawing/paid/held states. Each worker's own funded reserve supplies awards; no cross-worker redistribution. Metric review queue and audited no-change/hold resolution; evidence corrections still require expanded tooling.
- Real Firestore transaction bug fixed (`transaction is not None`, not truthiness). Regression test added.

## Production resources
- Customer: https://repaido.web.app
- Worker: https://repaido.web.app/worker
- API: https://repaido-api-rivzaqvyvq-uc.a.run.app
- Live revision: `repaido-api-00009-tuw`, 100% traffic. Final candidate HTTP smoke passed before promotion; admin and customer Firebase token checks enforce revocation. Initial promotion was revision 00007; 00005/00006 never received live traffic.
- Firebase Hosting + protected Firestore rules published.
- Runtime: `repaido-runtime@repaido.iam.gserviceaccount.com`; separate datastore/auth-viewer/FCM roles; bucket-specific object access.
- Private bucket: `gs://repaido-private-verification`, US-CENTRAL1, uniform access and public access prevention enforced, 30-day lifecycle, soft-delete retention zero. API access expires immediately at 30 days; physical cloud lifecycle deletion is asynchronous.
- Scheduler: `repaido-operations-minute`, every minute in us-central1; dedicated OIDC identity `repaido-scheduler@repaido.iam.gserviceaccount.com`. Verified successful authenticated execution: HTTP 200 at 2026-09-23 17:55:12 UTC.
- Android Firebase app registered: `com.repaido.agent`, app ID `1:133610574058:android:25363caeaa591e2ea84793`.
- Payment/payout feature flags remain FALSE. Rewards and private manual review are enabled; awards need actual funded work and eligibility.

## Validation completed
- **36 backend tests passed**: SQLite workflows, verification boundaries, document access blocking, tracking replay/revocation/terminal state, signed webhook dedupe, refund ordering, ambiguous order retries, bank reference binding, payout/bonus idempotency, reversal, policy math, reward eligibility/cooldown/holds, falsey Firestore transaction regression.
- **Live Firestore adapter** tested in isolated disposable QA collections: concurrent updates, rollback, collection reads; probes removed afterward.
- TypeScript build and Vite production build passed. Existing large bundle warning remains (~1.4 MB uncompressed JS).
- Both debug APKs built successfully; Agent ~3.3 MB, customer ~16 MB. Generated duplicate Android resource filenames required clean builds. Native APIs have deprecation warnings, no build errors.
- Final candidate and live Hosting HTTP smoke passed: health/catalog/professionals/status 200; unauthenticated job/wallet 401; admin workers/finance 403. Public professional responses checked for absence of home/bank/contact fields.
- Browser manually verified deployed worker OTP gate and current branding. No OTP sent by the agent, no real identity document uploaded, no real bank validation/charge/payout performed.
- Not tested on a physical Android device: FCM delivery with app closed, foreground tracking under Doze/OEM restrictions, permission revocation, native Stop control. No claim of full WCAG conformance, representative usability testing, or empirically perfect ranking.

## Exact blockers / activation
1. Secret Manager currently contains **no Razorpay integration secrets**. Need `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`; register signed payment/refund webhook before enabling collection.
2. Need activated RazorpayX payout/bank-validation account, `RAZORPAYX_KEY_ID`, `RAZORPAYX_KEY_SECRET`, `RAZORPAYX_ACCOUNT_NUMBER`, `RAZORPAYX_WEBHOOK_SECRET`, funded balance, static outbound IP/network configuration and provider IP allowlisting. Payment gateway approval does not establish payout readiness.
3. Confirm actual Repaido reviewer accounts have server-issued Firebase admin claims; no arbitrary user was granted administrator access in this task.
4. Identity review is manual as the owner requested. Managed review devices/manual inspection remain required; antivirus scanning is not installed. No automatic face verification or automatic KYC approval.
5. Bonus algorithm is versioned and explainable but not calibrated against real operational cohorts. Availability is observed windows, not inferred 24-hour uptime. Corrections can be requested and held; comprehensive source-event correction, financial appeal adjustments, refund recovery and automatic failed-payout reissue are not complete. Held funds are not silently reissued.
6. Production Play release signing/distribution remains separate from debug APK testing. Customer APK does not yet have native background push (Agent does); browser push/VAPID is not implemented.
7. Store uses collection scans for several operational queries and holds event history in job records. Add indexed read models, pagination, event archival and load tests before high-volume operation.

## Changed files this turn
- Backend: `backend/integrations.py`, `backend/rewards.py`, `backend/operations.py`, `backend/main.py`, `backend/Dockerfile`, `.env.example`, `test_integrations.py`, `test_rewards.py`, test fixture in `test_operations.py`, `CLOUD_RUN_DEPLOY.md`.
- Web: `VerificationPanel.tsx`, `PrivateReview.tsx`, `AchievementWallet.tsx`, `PaymentPanel.tsx`, `LiveWorkerPortal.tsx`, `OperationalJobs.tsx`, `OperationsAdmin.tsx`, `services/native.ts`.
- Android Agent: `build.gradle.kts`, manifest, `AgentActivity.java`, `PushService.java`, `TrackingService.java`, Firebase public app config and resource values. Both existing APK modules reused.
- Deployment: `PRODUCTION_RUNBOOK.md`, `production-env.yaml`, `verification-lifecycle.json`, `http_smoke.py`, `firestore_smoke.py`, `install_policy.py`.

## Next actions
- Supply secrets through Secret Manager (never chat or client code), activate provider webhooks/static egress, run provider sandbox and approved small-value live tests, then enable financial flags.
- Install Agent APK on an Android phone; sign in, register notifications, exercise an authorized task and background/Stop flows.
- Team reviews private uploads, completes matching bank validation, approves worker; worker accepts policy before new assignments.
- Follow `deployment/PRODUCTION_RUNBOOK.md` for policy details, endpoints, activation, interaction checklist and rollback. Prior pre-task API revision is `repaido-api-00004-f2x`; do not weaken rules during rollback.

---
# Historical handoff (superseded where inconsistent)

# Repaido handoff — updated 23 September 2026

## Current implementation — operational lifecycle pass (supersedes historical status below)

Source: read all 15 pages of `/Users/miku0027/Downloads/Repaido_Complete_Event_Driven_Architecture.pdf`; visually inspected the command/transaction/event diagram on page 6. The pasted request is the user's task; the PDF supplies architecture context. No delegation or new dependencies. No production deployment or real payment/OTP transaction performed.

### Implemented
- `backend/operations.py`: authenticated operational API, configured SQLite/Firestore transaction adapter, optimistic versions, persisted command/booking idempotency, scope snapshots, atomic outbox, explicit allowed actions and blockers. Separate booking/work-order/visit IDs; an initial single executable service workflow is implemented, not the PDF's full task-dependency graph.
- Worker phone-provider authentication enforced server-side; returning users load their server profile. Onboarding stores name/DOB/address/base coordinates/skills/tools/experience/radius/role request/consent, always pending verification. Only an authorized operator/custom-claim admin can approve against a private manual review reference. Selecting Specialist cannot approve a worker or grant a kit.
- Approved, online, recently located workers match by category, city, up to 6 km and configured worker radius, genuine review aggregate and distance; technicians preferred for ordinary service bookings. One concurrent active assignment per worker, atomic dispatch, 15-minute offer timeout/reassignment. No available worker remains an honest searching state.
- Preparation reminder at two hours, 10-minute acknowledgement window, departure deadline 30 minutes before appointment. Server scheduler creates idempotent, visit/worker-linked policy assessments (10% current + 20% next for missed reminder; 20% late departure). These are pending settlement review, NOT bank deductions; next-task settlement is not yet implemented.
- Consent-bound foreground GPS updates; fresh readings and accuracy required. 300 m proximity indication, within 100 m plus accuracy to arrive/start; phone only returned to assigned workers with a fresh reading within 150 m. Raw worker coordinates omitted from customer projection; unaccepted offers omit exact customer location. Exit outside 200 m during work raises a review event, not a fabricated physical constraint. Tracking stops after completion submission/consent withdrawal.
- Server-priced parts proposal -> explicit customer approval -> atomic stock reservation -> registered-shop handover -> collection -> GPS-confirmed return -> separate installation confirmation -> completion request -> customer confirmation/dispute -> payment-due invoice + held ledger -> one authorized completed-booking review. Negative reviews retained; genuine aggregates updated transactionally. Registered inventory has no fixtures; empty stock blocks procurement honestly.
- Customer cancellation/rescheduling before work begins, stale-command recovery, assignment decline/retry, pending extra-charge display, Maps directions and gated call links. Map picker random coordinates/fake reverse geocoding removed; real map, GPS and manual coordinate path with explicit pin confirmation.
- New connected worker Home / Active Task / Profile UI, foreground audible alerts with explicit sound enable/silence, actual countdowns, large actions. Customer home cards and Services Add now enter live catalogue-backed booking; Bookings and bell show the operational feed. Existing design/components/Leaflet/Firebase auth reused.
- Worker fixtures and seeded application/admin-ledger entries removed. Reachable company/shop demo portals replaced by protected operational views. Legacy public technician/specialist APIs now use sanitized approved-worker projections. Client Firestore booking/worker/application mutation rules tightened; these rules are NOT yet deployed.
- Existing Android customer and agent modules rebuilt successfully; external Maps/tel links now leave the WebView and use exact host matching. Build-time `REPAIDO_WEB_URL` supports staging. APKs are WebView shells defaulting to the existing hosted site; they will not display this new local code until a matching backend/web/rules release is deployed.

### Files changed
New: `backend/operations.py`, `backend/test_operations.py`, `web/src/services/operations.ts`, `web/src/components/{LiveWorkerPortal,LiveBooking,OperationalJobs,OperationsAdmin}.tsx`, `web/src/components/operations.css`.
Updated: `backend/main.py`, `backend/Dockerfile`, `backend/test_api.py`, `firestore.rules`, `web/src/App.tsx`, `web/src/CatalogApp.tsx`, `web/src/data.ts`, `web/src/services/repaidoService.ts`, `web/src/components/{LocationPickerModal,Discovery,ServiceShowcase,ui}.tsx`, Android `app/build.gradle.kts`, `agent/build.gradle.kts`, `MainActivity.kt`, `AgentActivity.java`.

### Verification
- Backend: 20 tests passed (`test_operations.py` + existing `test_api.py`), including complete worker/customer loop, authorization, radius/no matches, fresh/accurate GPS, phone masking, concurrent idempotent acceptance, parts consent/stock/handover, review restrictions, deadline assessment deduplication, late acknowledgement before scheduler execution, public-profile privacy, dispute holds, rescheduling and persistence. Test fixtures use temporary SQLite and disable cloud access; production Firebase OTP is not bypassed.
- TypeScript build and Vite production build passed. Vite reports a large existing app bundle (about 1.4 MB uncompressed); code splitting remains.
- Android: `:agent:assembleDebug` and `:app:assembleDebug` passed offline with installed JDK 21. JDK 25 failed; generated resource cache had a malformed filename and was cleaned via Gradle. Deprecation warnings remain. No physical-device OTP/background GPS/push test performed.
- Browser manually inspected worker OTP gate, customer catalogue price mapping, category -> live booking, map/manual fields and unauthenticated booking recovery. Nested map Escape/focus restoration was reverified: only the map closes and the booking remains open. Booking dialog fits 320/390/838 widths with no document overflow and no visible dialog button below 44px height. Measured new operational text pairs: navy/white 15.57:1, CTA/white 10.69:1, error text/pale red 8.87:1; the mint-panel muted text was darkened after a 6.94:1 result. These checks are not an axe audit or full AAA claim. A viewport screenshot was partially black due to browser capture; do not claim screenshot/pixel verification from that capture. No representative-user usability or physical-device test.
- Local preview: Vite `http://127.0.0.1:5186`; API port 8000 with isolated `/private/tmp/repaido-operations-preview.db`. No cloud data needed for anonymous browsing. Backend restarted after the final edits. Worker preview left open at `/worker`. New operational muted text on mint measures 7.16:1 after correction. Latest TypeScript, Vite and 20 backend tests passed; generated APKs were verified to exist.

### Exact blockers / next work
1. Secure KYC/private uploads, Aadhaar/PAN/address/tool-image capture, selfie/liveness and bank/payout verification are NOT integrated. Need chosen provider credentials/webhooks, private storage, encryption/access/retention policy and approved manual-review operations. The UI explicitly blocks document collection and auto-verification. Legacy raw-PII application endpoints now refuse persistence.
2. New operational invoices are pay-after with unverified payment/held payout. Existing Razorpay legacy endpoints are NOT yet adapted to this work-order ledger. Need stable payment attempts, verified webhook/reconciliation, refunds, eligible worker earnings basis, approved cumulative penalty/appeal policy and next-task deductions, bank payout provider. No charges, transfers or deductions were executed.
3. Outbox is atomically persisted but no durable external relay/FCM consumer deployed. Foreground polling/chimes work only while screen is open; no guaranteed high-volume background alert or device wakeup. Need Android FCM channels, permissions, foreground/background location service, delivery/ack instrumentation. Cannot force OS volume or physically constrain a worker within a geofence; spoof resistance/attestation and GPS manual-review workflow remain.
4. Firestore adapter is implemented but not exercised against an emulator/live database. Operational scans need indexed queries/pagination before scale. SQLite tested; Firestore document size, contention and 500-write limits require scope/event partitioning for long-running orders. Cloud Run idle/suspended instances need an external authenticated scheduler to call `/operations/admin/tick`; current in-process 30s loop is not a durable scheduling guarantee.
5. No verified production workers/shop inventory created. Admin APIs can register verified shops/inventory; full shop inventory editing UI, discrepancy adjudication/penalty settlements, procurement travel billing and follow-up scheduling remain. Stock shortages emit review events and hold work; no automatic shop charge is claimed.
6. PDF extensions remain: independent task/dependency aggregates, findings/evidence uploads, specialist escalation, safety/make-safe actions, task-level partial cancellation, warranty, recurring maintenance, refunds and offline evidence replay. Work-order state must not be presented as the complete PDF architecture.
7. Existing legacy booking/payment/admin code remains for migration. Old records are not imported into the new operations tab; migration/reconciliation needs a reviewed plan, not silent conversion. The main flow is now operational; remove inaccessible legacy UI/state in a separate cleanup. Root credential file already existed and was not copied into client code or modified.
8. UI remaining: full reference comparison, dark/theme preferences, 200/400% reflow and contrast across legacy screens, screen-reader/keyboard/axe audit; no AAA claim. No server geocoding, road-assistance dispatch, service-area polygons or route ETA integration. Location matching uses straight-line radius and configured city. Booking is single service per visit; multi-package checkout is not part of this pass.
9. Deploy backend (Dockerfile now includes operations.py), reviewed Firestore rules and web together to a staging environment; exercise real OTP and approved test accounts on two devices; then point APKs to staging with `-PREPAIDO_WEB_URL=<https staging origin>`. Current debug APKs: `android/agent/build/outputs/apk/debug/agent-debug.apk`, `android/app/build/outputs/apk/debug/app-debug.apk`. Production remains unchanged.

### Current interaction checklist
| Control | Destination / mutation | Recovery |
|---|---|---|
| Service card / Services Add | LiveBooking -> server catalogue -> operations booking | Draft preserved in session, stable retry key, error text, sign in, no-candidate state |
| Worker OTP / returning login | Firebase phone auth -> server profile | OTP error/resend/change number, reconnect, no device-local bypass |
| Onboarding | Pending server profile + terms | Field validation, provider-blocked verification, refresh review |
| Go online | Approved worker + fresh GPS | Denied/low-quality GPS and unapproved profile errors |
| Offer / reminder / departure | Versioned actor-specific command | Deadline, decline/rematch, stale response, repeat-safe commands |
| GPS / map / call / start | Consent, fresh location checks, external Maps, gated phone | Manual pin for customer; worker manual arrival review still pending |
| Parts quote / approve / handover | Server inventory, immutable scope, stock transaction | No stock/provider, quote stale, wrong shop, customer reject |
| Completion / dispute / review | Customer confirmation, held ledger, completed-booking review | Unauthorized/duplicate/stale commands rejected, dispute hold |
| Booking cancellation / reschedule | Pre-start state and new visit/assignment | Fee explanation, stale command error, no silent execution |
| Admin / shop tabs | Server claim/registered ownership | Explicit authorization/sign-in errors, no demo login |

---
## Historical notes (September 21; superseded where the current section differs)

## Status and scope
Partial implementation in the existing React/Tailwind app, not a completed production platform. No framework migration, dependencies, delegation, or backend schema changes. No applicable AGENTS.md was found in the focused repository search. Existing native Compose app and preview APK were preserved; neither was rebuilt for this update. The downloadable APK from the earlier turn is now older than the web implementation.

The two stated attachments were NOT accessible in the message. Existing brand assets show the earlier house/wrench emblem and plain custom wordmark, not the requested wrench-i/red dot/gear-o. They were retained rather than inventing an allegedly exact replacement. Home is based on the written order and shared reference tokens. Existing technician photo and colourful line icons are provisional, NOT the supplied illustration style. No pixel-level reference comparison was possible.

## Completed
- New customer home, header, greeting (actual signed-in name or neutral greeting), editable location, search/suggestions/recent history with clearing.
- Cream hero and Book Now; six named categories in requested order; no unsupported 24/7 badge.
- Mint standards strip with explanations; three reference-only price cards with price-condition sheets and links to correct catalogue; honest empty professional directory, no fabricated ratings.
- Exactly five fixed tabs: Home, Services, Bookings, Support, Profile. Existing catalogue/detail/cart/demo checkout preserved. Cart persists through tab changes and session reload; checkout form survives tab changes but not page reload.
- Existing API sign-in/logout wiring and account-owned booking retrieval with loading/error/retry. Token is memory-only. Backend must run on port 8000 for Vite proxy; no live end-to-end account test was performed this session.
- Manual saved address edit/delete, optional contextual geolocation, permission-failure recovery; local persistence and explicit lack of coverage checks. Editing address/city clears captured coordinates to avoid mismatched location. No address sent to public profiles.
- Light/Dark/Auto local-time schedule (19:00–07:00, disclosed), larger-text and reduced-motion settings. Shared customer tokens; old catalogue styles still need complete theme auditing.
- Worker/admin entry points are explicit blocked states; no client role approval, identity upload, fake verification, payment, dispatch or success added.

## Changed files
web/src/App.tsx (new customer shell/home/settings/account integration)
web/src/CatalogApp.tsx (retained previous demo catalogue flow and persisted cart)
web/src/components/Discovery.tsx (initial category/query props)
web/src/reference.css (shared reference colours/layout/theme/responsive rules)
web/tests/reference-home.cjs (focused UI checks)
REPAIDO_HANDOFF.md

## Validation
- TypeScript build: passed after final location-coordinate cleanup.
- Vite production build: passed.
- Existing backend pytest: 7 passed, one Starlette deprecation warning.
- Playwright: passed 320/390/838 widths, six tiles/five tabs, manual location save, road dispatch blocked state, plumbing result, dark/large text, no horizontal overflow or JS errors.
- Screenshot inspected at 390px against the now-supplied visual reference; this is not a pixel-perfect or accessibility certification. Final repeated browser check passed with explicit light baseline screenshots and dark/enlarged screenshots.
- Screenshots: web/test-results/reference-home-{width}.png and reference-dark-large-{width}.png.
- No axe-core run, real screen-reader audit, representative-user usability test, physical-device test, or complete worker acceptance/completion/review journey this session.
- Preview: http://127.0.0.1:5186/ (Vite). Server was stopped on arrival and was started for validation.

## Interaction checklist
| Control | Destination / mutation | Recovery |
|---|---|---|
| Bell | Notifications empty state | Close dialog |
| Location | Manual fields, geolocation, device-local save | Text error/manual path; delete in Profile |
| Search/recent | Filtered existing catalogue; device-local history | Clear history / catalogue reset |
| Book Now | Services catalogue | Main tabs |
| Cleaning/plumbing/electrician/appliances | Correct category | Change category |
| Road/garden | Explicit unavailable sheet; car care/all-services alternative | Close/back |
| Price cards | Reference-price explanation then category | Close; no false ₹99 package |
| View all professionals | Directory unavailable | Services alternative |
| Standards strip | Verification/pricing/support/rebooking explanations | Close |
| Service details/Add/quantity | Existing details and cart/demo checkout | Existing validation/removal/back |
| Bookings | Authenticated GET /bookings | Sign in, loading/error/refresh |
| Booking detail/cancel options | Details/policy-blocked explanation (NO cancellation mutation) | Close/support |
| Support | Booking reference and explicit ticket-provider unavailable | Select another booking |
| Profile sign-in/logout | Existing /auth/login and /auth/logout | Error/retry, expired auth clears session |
| Display | Theme/text/motion persisted locally | Change/reset choices |
| Worker/admin | Explicit missing role infrastructure | Back to Profile |

## Exact blockers / missing integrations
1. Reference PNGs now supplied and integrated in the web header/home. Vector logo master remains unavailable; native/app-icon and metadata branding updates remain. Raster artwork is not a billboard-ready vector or trademark clearance.
2. Real checkout NOT connected: existing API single-service pay-after request differs from React multi-item illustrative-tax checkout. Need agreed contract, server catalogue reconciliation, server slots/quotes/terms snapshots, idempotent authenticated creation and auth-intent preservation. Current Finish sample booking creates no booking/payment.
3. No professional/worker tables, role sessions, review aggregates, schedules/radii or event stream. Build authenticated least-privilege role APIs before worker/admin views. Existing admin API uses a server environment key, never expose it in customer UI.
4. No maps/place/geocoding provider or key supplied. No coverage/radius APIs, draggable/keyboard pin map, reverse geocoding, address sync, exact-location access auditing or consent-bound tracking. One device-local address supported; no address collection CRUD.
5. No payment provider credentials/webhook secret; no pending/failure/refund/retry UI or verified payment events. No charges made.
6. No identity/KYC provider credentials, private-upload store, biometric consent/retention policy, one-to-one matching, manual review queue or server approval boundary implementation. Do not mark anybody verified.
7. No support provider/queue/contact/escalation policy. No real ticket/conversation mutation; cancellation blocked until fees disclosed in UI. Notifications not integrated.

## Remaining requirements, in next-action order
- Finish native/app-icon branding from an approved vector master. References are now available and the web home uses their artwork; continue exact viewport comparison and accessibility auditing.
- Connect authentic booking through service/scope, assigned worker, address, real slots, quote/terms, pay-after or payment, confirmed request. Preserve full draft and worker/address across reload/auth; avoid duplicate requests/charges.
- Worker registration (contact → profile/skills → area/radius → pricing/hours/terms → KYC/selfie/manual route → pending/approved/rejected), role-protected dashboard (requests accept/decline/expiry, availability/time off, jobs, quotes with customer approval, notes/evidence, earnings, profiles/review replies). State machine requested→accepted→en route→arrived→in progress→completion pending→completed plus cancellation/disputes. Immutable agreement snapshots.
- Customer booking details/tracking/contact/completion/receipt/verified review/rebooking. Reschedule, decline, no slots, unavailable, payment pending/failure, refund, offline, expired auth, disputed completion; real recovery.
- Road assistance separate breakdown pin, vehicle/issue/photos, quote/actual ETA, dispatch, tracking, contact and cancellation; no 24/7 or ETA promises until supported.
- Search professionals/skills as well as services, backend radius/price/rating/availability/verification filters, unavailable/no-result/loading retry states.
- Real profiles: portrait, genuine verification, skills/experience/languages/service area/radius/availability, packages/fees/exclusions/duration/terms/portfolio, real average/count/distribution/reviews/date/verified completion, reporting/helpful/replies. Completed-customer-only reviews, server aggregation, duplicate prevention and moderation.
- Protected admin: worker/KYC review, pricing/catalogue/policies, assignments/map, disputes/refunds, moderation, audit history. Server/database role enforcement and exact-address access logs; no public customer coordinates or KYC files.
- Accessibility remaining criterion-level checks: 1.4.6 contrast all themes/states (not yet measured for new theme); 1.4.4 resizing all fixed-pixel text; 1.4.10 400% reflow; 1.4.11 control graphics; 2.4.11/2.4.12 focus obscured by nav/cart/keyboard; 2.5.5 targets including narrow nav; 3.3.8 accessible auth; 4.1.3 statuses; screen-reader semantics and focus order. Shared Modal already uses native dialog focus containment/Escape/restoration. No full WCAG AAA claim.
- Keep manual carousel if added (not currently a carousel); labelled controls, no autoplay. Replace local-time Auto with reliable sunrise/sunset only when configured, preserving explicit theme choice.
- Required future journey tests: customer→worker acceptance→completion→review; permission denied/outside radius; payment failure/pending/idempotent retry; cancellation/reschedule/provider decline; KYC approval boundary; customer/worker/admin separation; keyboard/screen reader, reduced motion, text enlargement and contrast. Rebuild/retest Android APK after web/API integration stabilizes.

## Supplied-reference visual pass (September 21)
- Both original PNG references copied unchanged to web/public/reference/. Header Brand now displays the supplied logo, preserving wrench i, red dot, gear o and tagline.
- Added web/src/components/ReferenceArt.tsx: CSS clips isolated illustrations from the source reference; page text, cards, buttons and navigation remain HTML, not a screenshot UI. Standalone high-resolution artwork/vector originals are still preferable for production.
- Updated web/src/components/ui.tsx, App.tsx and reference.css for illustrated cream hero, six illustrated tiles, pastel pricing, compact hierarchy and five-tab navigation. Narrow/enlarged views reflow and omit decorative hero art.
- Latest TypeScript and Vite production builds passed. Browser checks passed at 320/390/838; test now asserts hero artwork dimensions. Manual 390px screenshot inspected.
- No invented reference identity, provider ratings, unread count, best-price or 24/7 claims copied. Backend/integration limitations above remain; this pass does not make demo checkout production-ready. APK not rebuilt.

## Compact discovery and motion pass
- Added ServiceShowcase.tsx: three manual service slides with previous/next, desktop indicators, touch swipe and announced slide position. CTAs open the correct catalogue. No autoplay.
- Added category highlight rails (cleaning/appliances/car/plumbing) ordered by sample starting price, with duration and price; cards open matching search. No unsupported best-rated claims.
- Discovery now supports combined category/search/inclusions, maximum price, maximum duration, both price sort directions, duration sort, filter counts and clear/reset empty-state recovery. Radius/rating/availability still require real provider data.
- Compact shared home/catalogue/account typography and spacing, preserved 44px primary controls; 180ms press feedback and 240ms content entry respect OS/app reduced motion. Larger text retained.
- TypeScript and production build passed. Browser checks passed 320/390/838 including slide navigation, category switch, combined filters/clear, address, blocked dispatch, dark/larger text and no horizontal overflow. 390px screenshot inspected. Touch swipe and physical-device/screen-reader/AAA audits not manually verified.

## Automatic banner follow-up
- ServiceSlideshow advances every 6 seconds, with pause/play. Hover temporarily pauses; focus, swipe and manual slide selection stop playback until Play. Hidden/offscreen banners pause timers.
- OS reduced motion and the app setting disable autoplay. Automatic slide changes do not generate repeated live announcements.
- TypeScript and production build passed; focused browser check in web/tests/slideshow.cjs covers advance, pause/resume and OS reduced motion.
- Focused autoplay browser check passed automatic advance, pause, keyboard resume and OS reduced motion. Pointer resume stays subject to hover pausing until pointer leaves the banner.

## 2026-09-29 premium UI release and confirmed shared demand pool
- Firebase frontend published: version a15924fff35ea32b, release 1790675128921000, label premium-20260929. Backend remains prior revision; no demand charging deployed.
- Published seven-second fullscreen Puja splash; compact Services search/location/filter-sort controls; Home navy cards, pausable rotating supporting text; service accordions and compact detail accordions; branded pausable suggestion carousel (pauses on focus/hover); offer terms accordion.
- Build passed; frontend 9 tests passed; backend 189 tests passed including 5 new demand policy tests. Public 380x860 browser check confirms compact controls and functional city and combined filter modals. Hash verification initially transient HTTP503; retry log /tmp/repaido-premium-hashes.log.
- Complete cPanel archive prepared: deployment/releases/repaido-cpanel-premium-20260929.zip (62 entries, 73,198,294 bytes). NOT uploaded to cPanel. Previous cPanel handoff remains pending; avoid taking over unrelated Chrome use.
- Owner confirmed: year-round25% surcharge (20 percentage points shared agent pool, 5 Repaido), strictly >5% surplus over available capacity; shared pool distributed weekly proportional to completed, paid, undisputed service value excluding parts/taxes.
- Implemented ONLY pure policy calculations in backend/demand_policy.py, tests in backend/test_demand_policy.py, specification/status in deployment/DEMAND_POOL_POLICY.md. Not mounted/imported by backend production, not in Docker COPY. No live charge or payouts. Do not claim completed end-to-end financial integration.
- Remaining money work: real demand/capacity eligibility and deduplication, transactional admission, explicit expiring customer quote/consent, immutable surcharge invoice split, separate agent-pool liability accounting, weekly allocations, refund/reversal freeze and clawback/reconciliation. No additional owner decision on rates/distribution is needed. Normal provider payout gates remain unchanged.

## 2026-09-29 service leaderboard strip
- Replaced Services static benefits strip with ServiceLeaders.tsx + service-leaders.css. Uses existing public /operations/hiring/leaderboard, approved/listed profiles only. City context by default; explicit Near me gets location and requests radius6km. Never claims current high demand from historical ratings.
- Compact navy rotating category leaders, category-specific true rating/task counts, real review excerpt and portraits (neutral fallback when no image); user pause, reduced-motion, hidden/offscreen/focus/hover and expanded-panel pause. Waits for category data before advancing; per-category cache and cancelled/15s-limited fetches.
- Expanded category rail and ranked profile accordions reuse exported ProfessionalDetails (skills, work history, review distribution and full verified review list). Unreviewed profiles stay unranked. No billing/financial logic touched.
- Final Firebase version ff63ea2f7ce3a52a / release1790675949921000 / leaders-20260929. Build passed; 3 backend hire discovery tests +8 contrast/suggestion tests passed. Browser at478x830 verified real Electrician and Pest control category data, #1 ranks, exact reviews, new unreviewed profile and nested profile/review accordions.
- Final full cPanel package deployment/releases/repaido-cpanel-leaders-20260929.zip prepared, NOT uploaded. Existing demand-pool integration remains incomplete and no demand surcharge is enabled.

## 2026-09-29 compact service finder and comparison
- Replaced uc-services-count with ServiceFinder.tsx + service-finder.css: navy/white live option count, true minimum price from visible services, lowest-price and shortest-duration sorting, budget/sort entry, reset and expandable 6km/scope guidance.
- Compare modal permits up to3 distinct visible services, shows real prices, estimated duration, recorded reviews, included/excluded accordions and full-details action. No invented suitability percentages, discounts, urgency or availability claims. Added duration sorting to existing filter modal.
- ServiceLeaders now pauses automatic category fetching while any dialog is open, avoiding disruptive background loading overlays during comparison.
- Build passed. Browser478x830 verified count/minimum, low-price ordering, duration ordering, native selects and two-service comparison of Bathroom₹499/1hour versus Kitchen₹999/2hours with real included scope. Direct getByLabel exact locator failed; use getByRole combobox exact names Service1/Service2 as surfaced in DOM. Comparison full-details follow-through not confirmed: view changed to Electrical filter during inspection, so did not overwrite that view. Viewport restored.
- Final Firebase version3c8280fe1b3994a0, release1790676568782000, label finder-20260929. Hash log /tmp/repaido-finder-hashes.log. Full cPanel package deployment/releases/repaido-cpanel-finder-20260929.zip prepared, not uploaded. Financial demand integration remains separately incomplete.

## 2026-09-29 compact customer booking cards
- Published customer booking switch and compact heading/filter controls, premium raised status-coloured cards with service artwork, actual agent name/role, visit time/city, approved total, confirmed visit progress and contextual management link. Visit/payment details accordion and existing rebooking flow for completed records. Pause and reduced-motion support.
- Customer On site now only arrived/in_progress; travelling and parts collection are excluded. Needs you includes allowed review/approval actions and awaiting parts payment. Completed/cancelled/disputed cards do not show fake live motion. Historical missing-agent fallback is explicit.
- Files: CustomerBookingCard.tsx, customer-bookings.css, customerBookings.mjs; OperationalJobs/App/main integration. 10 booking/stage tests passed; production and cPanel builds passed. Status header contrast ratios exceed7:1; no full AAA or physical Android audit claimed.
- Final Firebase version f62dfe26deda3527, release1790677912602000, label bookings-20260929. 61 public files match build (/tmp/repaido-bookings-hashes.log). Live478x830 browser verified compact active card, actual service/agent/price,1/5 stage count, corrected On site0; history checked before final small wording/spacing fixes. No booking mutations during tests.
- Full cPanel archive deployment/releases/repaido-cpanel-bookings-20260929.zip prepared (73,205,674 bytes,62 entries), NOT uploaded. Backend unchanged; shared demand-pool financial integration remains incomplete and disabled as documented above.

## 2026-09-29 compact accents and comparison relocation
- HomeEntry now one compact photo/title/rotating-description/icons row with cream surface. Removed visible playback buttons from HomeGreeting, RotatingNote, ServiceShowcase, Promotions, ServiceHydration, ServiceLeaders, Hiring and booking animation controls. Business pause controls remain. Reduced-motion and existing interaction-pausing retained; location ticker limited to one cycle. No AAA claim.
- ServiceLeaders warm gold/brown treatment. ServiceFinder removed from Discovery catalogue and inserted once among lower Home essentials at mount-stable randomized index2..4. HomeServiceFinder wraps true catalogue comparisons with price/duration shortlist sorting and budget filter; light sage/cream design and Repaido logo. Fixed existing ServiceShowcase arrow modulo to use all6 slides.
- Build and cPanel build pass. Public browser confirms compact row, gold live leaderboard, absence of finder on Services, finder among Home essentials, actual lowest-price shortlist3 items at₹199. Browser tab2 had active user comments so final verification used temporary hidden tab3, closed afterward. Viewport reset.
- Firebase version930822d08400aef7, release1790678918732000, compact-20260929. All61 public hashes pass. Full cPanel archive deployment/releases/repaido-cpanel-compact-20260929.zip prepared,73,206,591bytes,62entries; NOT uploaded. Backend and unimplemented demand-pool integration unchanged.

## 2026-09-29 Home service card photo repair and rotating facts
- ServiceAccordion.tsx now uses explicitly sized service-accordion-photo rather than unsized discovery-thumbnail; generic summary span flex rules had collapsed photograph containers. New service-accordion.css protects dimensions76x84 (62x80 narrow), compact name/fixed price/duration, subtle sliding real included-work/review facts every3.2s. Stops when open, focused/hovered, offscreen, document hidden, dialogs open, or reduced-motion active. No playback buttons.
- Expanded cards show description, actual review status, complete included list, exclusions accordion, existing real offer rail and full-preview action. No speculative discounts. Rotating text aria-hidden; its content is available statically in expanded scope/review copy. Desktop cards align to start so adjacent closed cards do not stretch to expanded height.
- Production and cPanel builds pass. Live browser confirmed restored AC/furniture photos and accurate expanded AC scope; final follow-up CSS reduces paragraph font and prevents grid stretch. Temporary tab4 closed.
- Firebase final version d9f0b3b5e47063c0, release1790679380421000, cards-20260929. Hash log /tmp/repaido-cards-hashes.log. Full cPanel archive deployment/releases/repaido-cpanel-cards-20260929.zip prepared, NOT uploaded. Backend/demand-pool status unchanged.

## 2026-09-29 restore white Home shortcut grid
- User explicitly reverted blue six-category shortcut grid. Removed only the two overriding .repaido-services-3col-grid button/span rules from premium-discovery.css. Original surface, ink, light-border tokens and layout now apply again.
- Production/cPanel build passed. Firebase version388ac3d562affea7, release1790682371297000, grid-20260929. Initial CLI authentication transient failed; retry upload succeeded and existing gcloud finalized. Hash log /tmp/repaido-grid-hashes.log.
- Full cPanel package deployment/releases/repaido-cpanel-grid-20260929.zip prepared, not uploaded. No other UI or backend changes.

## 2026-09-29 Market selected tab aligns left
- SparePartsShop nav ref aligns chosen tab to mobile rail left inset using smooth scroll (instant for reduced motion), including repeat clicks and restored initial section. ResizeObserver adjusts trailing pseudo-element room so final Pre-Owned can also align left. Manual scrolling does not change selection or trigger a reposition; no auto-rotation. Desktop four-column grid unchanged.
- Production/cPanel builds pass. Live478x830 browser confirmed Tool Rentals and final Pre-Owned both left aligned with original theme; temporary tab5 closed and viewport reset.
- Firebase version9bc4b7a103c07541, release1790682563234000, rail-20260929. Hash log /tmp/repaido-rail-hashes.log. Full cPanel archive deployment/releases/repaido-cpanel-rail-20260929.zip prepared, not uploaded. Backend unchanged.

## 2026-09-29 immediate cached Hire categories
- Hiring category state initializes from metadata-only memory/localStorage cache (7-day maximum age) or existing catalogue categories; no waiting on full leaderboard. fetchLiveServices updates authoritative regular category names from backend categories plus service-derived category IDs, so new backend categories auto appear without a frontend whitelist. Home catalogue independently refreshes after5min in background; generic Wrench handles new category icons.
- Profile leaderboard and hire policy requests now deferred until results modal opens; live availability and rankings never persisted. Initial grid limit11 plus All categories, Show all/Show fewer automatically includes full current metadata list. API helper accepts explicit background loading option only used for Home category revalidation.
-3 tests pass: unknown new category discovery, metadata-only cache/expiry/storage failure, growing Show all list. Production and cPanel builds pass. Live478x830 checked cached return, Show all18, and Electrician modal with2 real profiles. Viewport reset and temporary tab6 closed.
- Firebase version466e10fee96d8a61, release1790682898106000, hire-cache-20260929.61 public hashes pass. Full cPanel archive deployment/releases/repaido-cpanel-hire-cache-20260929.zip prepared, not uploaded. Existing backend catalogue is the source; no new admin category editor or backend deployment added. Demand-pool status unchanged.

## 2026-09-29 Home quick actions and offer placement
- HomeQuickActions adds compact horizontal rail directly after hero: buy/sell used, refurbished, quick hire, quick repair, Home premium. Focused modals use existing live service data, icons and Repaido branding. Used sale opens existing draft listing form (verified-mobile gate preserved), buying opens marketplace; refurbished carries condition/query or maximum₹1999 into spare shop; hiring routes to profiles/Home plans, repair to actual service previews, Home to existing specific forms.
- ₹1999 is explicitly a budget filter, not an invented starting-price/stock claim; current matching stock was0. Benefits PromotionRail moved from under HomeEntry to below6-category shortcut grid. White shortcut styling retained.
- SparePartsShop quickIntent initializes condition/search/budget; removable budget chip and correct Reset All. Marketplace initialCreate opens form only, no submission or charge.
- Production/cPanel builds pass. Live478x830 verified content order, refurbished modal, both budget+condition filters, and sell shortcut opening unsubmitted form. Temporary tab8 closed; viewport reset.
- Firebase version11d8897cb0837e97, release1790685347238000, quick-20260929. Hash log /tmp/repaido-quick-hashes.log. Full cPanel archive deployment/releases/repaido-cpanel-quick-20260929.zip prepared, not uploaded. Backend/demand-pool unchanged.

## 2026-09-29 modern quick-action rail
- HomeQuickActions neutral raised tiles replace beige/green pills; distinct violet/emerald/plum/orange/navy icon tiles, circular dark arrows, compact two-line supporting notes and hover/press feedback. Notes slide every3.6s only while visible, no dialog/interaction, page visible and reduced motion off. No auto-scroll or playback control. Existing modal/navigation handlers unchanged.
- Production/cPanel builds pass. Live478x830 screenshot verified cards below banner, distinct icons and supporting notes; refurbished tile still opens existing modal. Temporary tab9 closed; viewport reset.
- Firebase versiondc356680e8bcb0e5, release1790685855453000, quick-modern-20260929. Hash log /tmp/repaido-quick-modern-hashes.log. Full cPanel archive deployment/releases/repaido-cpanel-quick-modern-20260929.zip prepared, not uploaded. Backend unchanged.

## 2026-09-29 shared spacing cleanup
- Added spacing.css imported last: one screen gutter (12px narrow,16mobile,24tablet,32desktop), Home grid-controlled section gaps instead of duplicate bottom padding, consistent quick rail insets, aligned Home cards, catalogue HomeEntry/search/main, Hire, Bookings, Market headers/rails/modules and profile gutters. Existing layout/theme preserved.
- Modal now has explicit app-modal-heading class; shared header removes redundant title top padding, aligns44px close control, standard16/24px dialog inset. Frameless task dialogs excluded; widths preserved. Inputs constrained to available width. Agent tool modal headers inherit cleanup.
- Production/cPanel builds pass. Browser checks478px Home/Services/Market;320px Hire/Bookings and refurbished modal;1280px desktop Home. No clipped modal controls observed; horizontal nav rails remain intentionally scrollable. Temporary tab10 closed and viewport reset.
- Firebase version7306d5d85a94e0a0, release1790686949372000, spacing-20260929. Hash log /tmp/repaido-spacing-hashes.log. Full cPanel archive deployment/releases/repaido-cpanel-spacing-20260929.zip prepared, not uploaded. No backend changes.

## 2026-09-30 contractor workflows, listing fix and line weights
- Marketplace now sends coordinate-only pins for listing/search. Backend marketplace-specific Pin accepts bounded address/city metadata from older installed clients, while retaining extra-field rejection for unknown keys. Regression covers actual second-hand listing create and search with the previously rejected picker payload.
- strokes.css sets a shared 1.8 Lucide stroke and 1px control/card borders; focus outlines remain 2px and selected rings remain distinct.
- Replaced fabricated contractor profile, won contracts, seeded crews, paid-priority suitability scores and success-only actions with contract_work.py transactional records. New collections contract_profiles/projects/tenders; existing legacy records are not deleted. Old prototype tender/team/prime endpoints removed from tenders.py; unrelated cart routes retained. Dockerfile now includes tenders.py and contract_work.py (previous main imported tenders but Docker COPY omitted it).
- Contractor desk: approval-gated project creation/bidding; business profile; actual overview counts; upcoming/open tender catalogue, search/status/sort, interest registration, team preparation, bid/revision/withdrawal, private owner comparison and owner-only award after deadline. Award rechecks accepted crew and capacity. No fee capture, escrow or paid membership is implied.
- Project lifecycle: planning/active/paused/completed/cancelled, approved milestone requirement for completion, supervisor/member reporting hierarchy, explicit agent invitations with work dates/rate/terms, accept/decline/remove/leave, self-reported server-time attendance, leave approval, goals/evidence submission/review/reopen and activity history. Consent and version checks guard changes; idempotent create/bid keys prevent network retry duplicates. Work-date acceptance reserves the full date range; UI says to use precise shift windows. No GPS attendance validation or payroll transfer implemented.
- Agent Home/Profile now includes project team invitations and workspace; project notification links open it. Removed contractor login bypass. Existing company contractor review in partner profile remains authoritative.
- Capacity checks include projects, existing service jobs and recurring Home visits. Home/dispatch conflict helper checks accepted project reservations; day-hire confirmation also checks the shared conflict helper.
- Customer TendersPlatform now reads real published opportunities from /contractor/opportunities, with terms preview and workspace entry. Does not manufacture tenders, rankings or stock data. Tender creation/bidding and HR mutations were exercised against isolated databases, not live customer records.
- Validation: all195 backend tests pass; production/cPanel TypeScript+Vite builds pass. Candidate API health/catalogue/private access smoke passed; new anonymous opportunity and auth-required workspace checks passed. Live search request carrying legacy address/city metadata returns200.
- Cloud Run repaido-api-00079-wan promoted100% after no-traffic candidate checks (prior00076-fom; intermediate00078-jis never promoted).
- Firebase initial version a46052cb85ceabb0, then final compact-form correction version3b3f639f4fd01e6a (contract-work-final-20260930). cPanel full archive repaido-cpanel-contract-work-20260930.zip and4-entry delta repaido-cpanel-contract-layout-20260930.zip UPLOADED and EXTRACTED to /public_html through existing cPanel session. Public entrypoint backup deployment/reviews/contract-work-20260930/previous-cpanel-index.html; old hashed assets preserved. Source credentials are excluded from packages.
- Earlier shared demand-pool financial integration remains unfinished/disabled; this release does not implement it. Full HR/payroll, statutory employment documents and project payment settlement are not claimed by the operational team workspace.

## 2026-09-30 customer navigation layout correction
- Removed the shared border-width override from all buttons/inputs: it incorrectly reintroduced borders on intentionally borderless navigation controls. Lucide 1.8 stroke and scoped card rules retained.
- customer-layout.css: only active customer bottom tab has white background/navy icon/text; other tabs transparent with no borders. Keyboard focus remains visible. Header profile is icon-only for signed-in/out users; cart/bell/profile aligned in equal square targets in that visual order.
- ServiceStories uses measured overflow for single-line scrolling labels, equal96x130px tiles (88px wide at narrow breakpoint), hover/focus pauses and reduced-motion/manual scrolling fallback. Bookings service-type selector now matches Market's charcoal active pill/light gray rail.
- Production and cPanel builds pass. Firebase20c122f581b1d2cc, release1790744690589000. cPanel delta repaido-cpanel-customer-nav-20260930.zip uploaded/extracted to public_html. Firebase61-file hash check passes. Live custom-domain checks390px and320px: all11 service tiles same dimensions; active-only bottom styling and0px borders; header targets aligned; booking colors verified; Market/Hire have no horizontal document overflow. IAB verification tab closed and viewport reset. Native Chrome later showed user New tab; no unrelated tabs closed.
- Final UI corrections preserve selected-tab white/navy contrast and exact paise display for bid/project amounts; misleading geofenced-command login copy removed. Firebase final version93991c30bcb132bc, release1790743972752000 (contract-work-precision-20260930). Contrast and precision cPanel delta archives both uploaded and extracted to /public_html; consolidated final archive deployment/releases/repaido-cpanel-contract-final-20260930.zip prepared for recovery.
- Final verification: all61 Firebase build files match; cPanel verifier passes current routes/assets, canonical redirects, security headers/config blocking, CORS and private-job authentication. Logs /tmp/repaido-contract-precision-hashes.log and /tmp/repaido-contract-precision-cpanel.log. Live UI checked at496px and320px: compact project form, readable selected controls, 1.8px Lucide strokes and no contractor horizontal page overflow. Agent project deep link and custom-domain verified-phone boundary checked. No live project/bid/invitation/listing mutations submitted. Temporary verification tab and four cPanel upload tabs closed; user tabs retained; viewport override reset.

## 2026-09-30 supplied loading GIF and background request cleanup
- Found micro_animations_frontend/Loading animation blue.gif (150x112,180frames,90KB). Original copied unchanged to web/public/images/loading-blue.gif. AppExperience renders it at180x134 in a shared larger loading notice,120x90 on short screens. SVG color matrix removes its green background during browser rendering. Reduced-motion uses a static wrench. GIF mounts only while foreground loading is active; existing650ms debounce and immediate finish retained; no extra minimum delay.
- operation() now shares concurrent GET promises by signed-in UID+path, cleans up after success/error and holds foreground indicator through response JSON parsing. No persistent private cache, no mutation deduplication and no new realtime subscription. Seven targeted loading/request tests pass, including concurrent requests, user isolation, failed retry and loading cleanup.
- Background options applied to worker assignment/hiring alerts(5sec), task counts, approval checks, availability heartbeats, job list polling, contractor workspace/invitation counts and GPS tracking. Existing inline errors and foreground initial/manual loads remain. Hidden task-count polling suspended. Does not claim every app API migrated to realtime or eliminate backend latency.
- Production/cPanel builds pass. Firebase final660d13c5e678fae9, release1790763837942000, loading-final-20260930; all62 files verified (/tmp/repaido-gif-hashes.log). Contractor workspace and manual refresh load successfully in IAB; fast response did not expose loader long enough for animation screenshot. Green removal/reduced-motion not yet visually confirmed on physical Android.
- Full repaido-cpanel-loading-final-20260930.zip (73,306,328bytes,63entries) UPLOADED to cPanel home and100% confirmed, but NOT EXTRACTED. Native Chrome user activity interrupted return-to-manager. User explicitly said "Leave repaido.com deployment for later". Respect this; do not extract until resumed. repaido.com remains customer-nav release. Old intermediate delta loading-gif archive is not the final complete release.

## 2026-09-30 crisp loader and customer background noise
- Replaced enlarged/chroma-keyed150x112 GIF rendering with resolution-independent inline SVG blue circular loader at112px. No green filter, no image scaling. Existing static reduced-motion fallback retained. Original supplied GIF is retained as an unused asset.
- Customer sources identified: promotion impression/open/dismiss telemetry, campaign feed minute/focus refresh, discovery events/preferences/feed and auto-rotating leaderboard fetches. These now explicitly use background requests; hiring10sec/calendar30sec polling also quiet. Offer refresh retains current cards for unchanged user/city/placement/service context; context changes clear previous cards. Foreground manual calendar/hiring loads and business actions keep loading feedback.
- Seven loading/request tests pass and both TypeScript/Vite builds pass. Firebase cd190dd86afb6aaf, release1790764430799000 (vector-loading-20260930). New complete cPanel archive repaido-cpanel-vector-loading-20260930.zip prepared locally; NOT UPLOADED/EXTRACTED because user explicitly paused repaido.com deployment. This archive supersedes loading-final for future deployment.

## 2026-09-30 compact rentals, market carousel, new seller offer
- App market switch shortened to Marketplace / Contracts. MarketOpportunities replaces static header with5 slides for selling, refurbished goods, rentals, swaps and contracts; each opens explanation/terms modal before relevant destination. Auto-rotation pauses during interaction/dialog and respects reduced motion. Sell opens verified-phone listing form; no automatic submission.
- RentalMarket compact11px category controls at40px, smaller shop/sort row, availability checkbox, reset filters, result count, two-column mobile cards (single column at<=360px) and desktop filter sidebar. Cards show actual image, prices, deposit, stock and condition with colored tags and subtle hover motion. No invented discounts/reviews. Existing checkout/details preserved.
- User explicitly chose unlimited second-hand listings for first90days. Backend market_trials seller90 ledger starts at first eligible listing and retains one shared90-day expiry across listings;10/day anti-spam cap remains. Old sellers/trial records not re-enrolled. Exchange retains first-listing30day rule. Policy endpoint and customer copy updated; fees after window remain5%, no autocharge. Shared backend change also applies to repaido.com even while its frontend deployment is paused.
- Backend Cloud Run repaido-api-00081-yak promoted100% after candidate smoke23routes/private-access and policy check. All197 pre-final-cap backend tests passed; final marketplace suite16passed includes extra daily-cap test, shared expiry, concurrent creation, expiry and legacy-user cases. Production/cPanel builds passed.
- Firebase final c237d4033cbf62b3, release1790765836613000, market-final-20260930. Receipt deployment/releases/firebase-market-final-20260930-receipt.json. All62 public files match build (final verifier rerun after interrupted turn).
- UI checked496px (40px categories,11px text,two-column cards),320px(no horizontal page overflow),1280px(desktop sidebar). Tested availability filter, rental details, carousel terms-to-rentals navigation. No live rentals/listings/payments submitted. Temporary tab closed; viewport reset.
- Full deployment/releases/repaido-cpanel-market-final-20260930.zip prepared locally, NOT uploaded/extracted. User's repaido.com frontend pause remains active. It supersedes earlier loading/vector archives for the next resumed custom-domain deployment.

## 2026-09-30 rental category drill-down sidebar
- Replaced shallow rental category rail with persistent side navigation on mobile and desktop. Category groups expand into equipment names drawn from the live catalogue; current backend taxonomy is flat, so no invented nested manufacturer/type hierarchy. New catalogue categories populate automatically.
- Grouped accordion filters: daily/weekly/monthly maximum rate, maximum deposit, available stock, pickup/delivery, shop and actual condition. Desktop filters sit below categories; mobile All filters opens an accessible left drawer with result count. Removable chips, clear-all and empty-result reset. Client-side filtering makes no extra API requests.
- Verified live category selection reduces two items to one, combined rate ceiling excludes the ₹100/day item at ₹99, reset restores two. Checked 320/496/1280 widths without document overflow. Final scoped heading/form typography fixes prevent category title wrapping.
- Production and cPanel builds pass. Firebase version08e874d0e4dc8ae4 release1790776574973000, rental-sidebar-final-20260930; receipt in deployment/releases. No backend or live data mutations.
- Full repaido-cpanel-rental-sidebar-final-20260930.zip prepared locally. Custom-domain deployment remains paused; archive NOT uploaded/extracted.
- Final mobile category word-wrap polish supersedes the prior release: Firebase21a2aa55ca2528af / release1790776720199000, rental-sidebar-compact-final-20260930. Latest local full cPanel archive is repaido-cpanel-rental-sidebar-compact-final-20260930.zip (not deployed).

## 2026-09-30 compact marketplace visual polish
- Added scoped market-experience shell and accessible Marketplace/Contracts pressed states. Compact dark destination switch, tighter section tabs/search/spacing, smaller promotion carousel with per-opportunity accent surfaces. Product cards emphasize daily price with smaller secondary rates and stock/condition labels. Desktop uses available content width rather than narrow mobile shell; rental hierarchy and grouped filters preserved.
- Production and cPanel builds pass. Visual QA at320/499/1280 widths: no document horizontal overflow. Saved deployment/releases/marketplace-polish-preview.jpg. No business data mutations.
- Firebase e253de601ea1e5d4, release1790785296507000, marketplace-polish-20260930. All62 deployed files match build.
- Full repaido-cpanel-marketplace-polish-20260930.zip prepared locally. repaido.com deployment still paused; no upload/extraction.

## 2026-09-30 contractor marketplace redesign and access split
- Rebuilt TendersPlatform as compact Repaido Business discovery: dark hero, real estate/education/hospitality/home-services rails, additional live sector names, subtle reduced-motion-aware cards, four explicitly labelled illustrative demo scopes, public awarded-contract summaries and recorded-completion contractor leaderboard. No fictional customers, awards, ratings, earnings or success stories.
- Added local bid planner (quote minus estimated costs minus contingency, percentage of quote), demo scope accordions and existing contractor onboarding/workspace CTA. Planner never submits financial records. UI verified100000-70000-10000=20000/20%.
- Backend /contractor/opportunities now requires phone-verified, approved contractor_verified worker. /workspace no longer leaks all tenders to non-contractors; tender publishers still see their own tender to manage it. Public /overview only exposes awarded title/sector/city/status plus approved contractor names/cities and recorded completed awarded counts; no scopes, sites, budget, bid, team or contact data.
- Six contract/tender tests passed, including guest401, ordinary-agent403, approved access, workspace isolation and public field allowlists/ranking. Candidate23-route smoke and new overview200/opportunities401 checks passed. Cloud Run repaido-api-00083-jey promoted100%; shared backend change applies to both domains. Previous live00081-yak.
- Firebase04f50b4c5feeeddc, release1790786358410000, tender-market-20260930. All62 public files match build. Production/cPanel builds pass. Visual QA320/499/1280 without horizontal document overflow, sector filtering, demo modal and calculator verified. Preview deployment/releases/tender-market-preview.jpg.
- Full repaido-cpanel-tender-market-20260930.zip prepared locally only. repaido.com frontend deployment remains paused, no upload/extraction.

## 2026-09-30 twenty contract sectors
- Expanded TendersPlatform to20 actual sectors plus All sectors, each with a distinct Lucide icon and sector-specific descriptive copy. Added healthcare, retail, offices, manufacturing, warehousing, logistics, construction, electrical, plumbing, HVAC, solar, telecom, security systems, landscaping, water systems and interiors.
- Added Show all sectors / Compact rail toggle with aria-expanded, responsive grid and equal76px tiles. Existing live-sector auto additions, filtering and clearly labelled demo limitations preserved.
- Both builds passed. Firebase90f5e15f00e5ee37, release1790787067088000, sectors-20260930. Full repaido-cpanel-20-sectors-20260930.zip prepared locally only; repaido.com frontend remains paused. No backend/data changes.
- Final label-width polish:100px minimum sector tiles. Firebase74a41b93fb8eed4e / release1790787195491000 (sectors-final-20260930) supersedes intermediate release. Latest offline archive repaido-cpanel-20-sectors-final-20260930.zip.

## 2026-10-01 shared business sector ecosystem
- Backend GET /operations/contractor/sectors provides20 defaults plus stored business_sectors and legacy profile/tender sectors. New sector persisted atomically on successful profile save or tender publication, deterministic casefold key, NFKC/whitespace normalization,2–80char validation. Existing default names canonicalized; failed tender submissions do not add categories. Legacy profile clients omitting sector preserve saved value.
- BusinessSectorField shared by ContractorPortal Business details and Publish tender. Dropdown offers catalogue + Other/manual entry. Refreshes on focus silently; custom saved only upon form submit. Profile shows saved sector. Discovery loads backend custom names at mount/window focus and adds rail icons with dynamic total.
- Fixed TendersPlatform approved access request to send Firebase bearer token after authStateReady; previous public implementation was missing this header after endpoint became restricted.
- Seven contract/tender tests passed incl custom registration, shared tender catalogue, case/space duplicates, invalid input, idempotent tender, failed submission atomicity, access and public allowlists. Candidate23-route smoke +20unique-sector GET passed; Cloud Run00085-hiq promoted100% (previous00083-jey). Shared API change applies to both domains.
- Firebase7e49ae14b0e7a5ba / release1790824305511000 (sector-ecosystem-20261001). Production/cPanel builds pass and62files match. Browser verified business dropdown20+Other, manual input and tender Healthcare selection; no live form submissions. Screenshot deployment/releases/sector-ecosystem-preview.jpg. Existing workspace background poll had a transient timeout during QA; sector loading and selection succeeded.
- Full repaido-cpanel-sector-ecosystem-20261001.zip prepared locally, not uploaded/extracted; repaido.com frontend pause remains active.

## 2026-10-01 strict nearby leaders and professional discovery
- ServiceLeaders now requests strict nearby mode with8km default /10km option, no city-wide fallback without a selected location. Reuses confirmed customer service coordinates; manual search-area picker and consented GPS remain available. Distances are to registered service bases, not live agent positions. Customer radius and member service radius both limit eligibility; no radius buffer allowed.
- Leader tap opens full profile; similar-profile discovery supports skills/name/category, technicians/specialists/verified contractors, ratings, availability and sorting. Background debounced/abortable queries, per-category session cache, loading/error/empty states. Gold leader animation and profile entry transitions respect reduced motion and pause when focus/hover/dialog/offscreen require it.
- Public profiles expose allowlisted matching catalogue packages/rates/scope plus genuine verified reviews, category results and recent completed work. Catalogue rates are explicitly distinguished from a personal custom quote; no invented gigs, promises or scores. Precise worker coordinates/contact fields remain private.
- Backend9 profile/discovery regressions passed; candidate23-route smoke passed plus missing-location422,8km radius/privacy live read checks. Cloud Run repaido-api-00087-rum promoted100%, previous00085-hiq. Shared backend serves both domains.
- Initial Firebase a5d285f39b9f6f9d / release1790825834242000 verified62files. Final search-area wording refinement pending verification below. repaido.com frontend remains paused; offline cPanel archive only.
- Final Firebase e2fd819de93fc1e1 / release1790826068819000 (nearby-final-20261001) supersedes intermediate release;62files match build. Both frontend builds passed (existing chunk-size warning only). Area-only map avoids booking-address fields/entrance attestation for discovery.
- Browser QA with public Balasore map centre:8km live results, verified contractor filter2→1, full profile with₹199/45min package/inclusions/exclusions, completed-work record, similar-profile navigation and10km selector.320/472px layouts have no document overflow. Saved deployment/releases/nearby-discovery-preview.jpg and nearby-profile-preview.jpg. No GPS permissions, bookings or business record submissions performed.
- Final offline full archive: deployment/releases/repaido-cpanel-nearby-final-20261001.zip. Not uploaded/extracted. repaido.com frontend still paused.

## 2026-10-01 search dock, filters and predictive completions
- SearchDiscovery now shares the home search field geometry, with an internal close icon and adjacent44px location/filter controls. Sticky dock has8px top focus clearance, explicit native search appearance reset and opaque surface. Search/preference reads run in background with inline status instead of global loading popovers on typing.
- Replaced always-visible filter accordion with a grouped filter modal: Services, Budget & time, Experts, Preferences. Draft changes apply together; reset, active count, budget validation, minimum/maximum prices, duration, role, minimum reviews/experience, radius, price ascending/descending, duration, distance, rating and experience sorts. Backend enforces supplied filters; quote-based home plans excluded when fixed price/duration bounds apply. Professional-specific filters explicitly distinguished from package filters. Existing6km booking service coverage unchanged.
- Added live active-catalogue completion metadata (services/plans/categories), local2+character prefix/multiword/alias/one-edit typo suggestions, keyboard arrows/Enter/Escape, explicit selection, and consented category-interest tie-breaks. No invented predictions, neural-network training or raw query/keystroke storage. Existing opt-in feedback remains background.
-14 backend discovery/leaderboard tests and3 completion tests passed.23-route candidate smoke plus live combined budget/duration/descending-price and suggestions read passed. Backend repaido-api-00089-cat promoted100% (previous00087-rum), shared across domains. Both frontend builds passed (existing chunk-size warning only).
- Initial Firebase5da61bc10025fba8 / release1790826882577000 verified62files. Browser confirmed prefix suggestions and keyboard selection, no loading popover while typing, invalid budget rejection, combined results₹300–600/up to60min/descending, location icon flow, and320/472px no horizontal document overflow. Final focus-outline/narrow sidebar label polish release follows below.
- Final Firebase6ea6a1eb877a043f / release1790827249864000 (search-polish-final-20261001) supersedes intermediate release. Final offline full archive deployment/releases/repaido-cpanel-search-polish-final-20261001.zip; no upload/extraction. repaido.com frontend remains paused.
- Final62file hashes verified. Final browser QA confirmed catalogue completions after2keys, clean rounded focus (no rectangular label outline), Experts sidebar label, and in-field Close search dismissal. Screenshots deployment/releases/search-polish-preview.jpg and search-filters-preview.jpg. Temporary browser tab closed and viewport reset. No live records, location permissions or personalisation settings changed.

## 2026-10-01 compact Hire discovery and professional spotlight
- Hire category results now use one compact role/location/filter toolbar with38px controls and no duplicate sort row. Filter modal uses a compact two-column layout. List cards show specialty, real rating/reviews/tasks/experience, inline bio/skills/tools/languages/recent review and catalogue-rate accordions; full professional profile retains scope, work history, verified reviews and existing hiring/Home-plan actions.
- Added forest/gold premium spotlight, portrait framing, subtle depth and3D slide entry, category and genuine review. Only public profiles with portrait/bio/skills/categories/languages qualify. Session-stable random ordering without preferences; consented category interests can prioritize all-category recommended discovery without altering published ranks. Autoplay pauses on interaction, background page, child dialogs and reduced-motion preference. Currently only one live profile qualifies, so controls are hidden and no live multi-profile rotation was asserted.
- Public Hire reads now run as background requests with inline status. Preference auth-change guard prevents applying another signed-in user's delayed result. Global rectangular hover inset replaced with gentle surface tint on these cards; keyboard focus remains available.
- Two helper tests passed (consent ordering/rank preservation and profile completeness/stable ordering). Production/cPanel builds passed (existing large-chunk warning). Browser472px confirms two Electrician cards fit above bottom nav; inline details and full profile work;10-year experience filter gives0results and reset restores3 all-category profiles.320px results/filter dialogs show no horizontal document or modal overflow. No business records, bookings, payments or profile changes submitted.
- Final Firebase d3a3f4c074bc407d / release1790828495436000 (hire-premium-final-20261001), all62file hashes verified. Supersedes intermediate a545a36a395d7180 and79b8bb7b509f0e45. Backend remains00089-cat; no financial/backend edits this turn. Screenshot deployment/releases/hire-compact-preview.jpg.
- Full offline archive deployment/releases/repaido-cpanel-hire-premium-final-20261001.zip.22 identical generated synchronization copies removed from dist-cpanel before repackaging (originals preserved). Custom-domain frontend remains paused; no upload/extraction.
- PENDING USER CLARIFICATION: Asked commission percentage for verified rating<=4.5 and treatment of workers with no reviews; no answer yet. Do not invent payout changes. Existing approved-worker free-listing campaign2026-09-29–2026-12-29 remains. Day hiring policy is disabled with day_hours/GST unset and routing/payment providers unready. UI explains 'Day hire · opening soon'; enabling requests requires these actual settings/providers, and must preserve approval, consent, location/schedule and settlement checks.

## 2026-10-01 — Shared premium banners and percentage coupons (released)
- User confirmed 20% maximum eligible-base discount, with no separate rupee cap; excludes taxes, parts, travel, delivery and deposits. First service and first direct rental have separate one-use offers. After a verified paid purchase/booking, choose one 10% service-base or refurbished-base coupon. Fixed 30-day issue expiry; server reminder at most once per 48 hours; no stacking or account transfer.
- Firebase test frontend live: version `930c3035963621ac`, release `1790831629382000`. All 69 published files hash-match current `web/dist`. Backend `repaido-api-00093-fex` serves 100% after 23-route candidate smoke; new unauthenticated coupon/opportunity/retail routes also rejected with401. API is shared across domains. **repaido.com frontend upload/extraction is still paused by user.**
- Offline cPanel package only: `deployment/releases/repaido-cpanel-banners-coupons-final-20261001.zip` (74,987,273 bytes;70 entries incl htaccess). No cPanel deployment performed. Earlier non-final banner package retained as recoverable artifact.
- Five generated photorealistic JPEGs in `web/public/images/banners/`; original home hero is first. Shared OpportunityCarousel has fixed per-session weekday shape (four variants),112px mobile marketplace frame, lazy Lottie accent, image movement, swipe/arrow controls, focus/hover pause, reduced-motion handling and hidden/off-screen suspension. No visible pause control. Images explicitly illustrative in opportunity modals.
- `backend/opportunities.py` ranks only from explicit banner openings with existing Personalise offers consent. No raw search queries, psychological inference or differential pricing. Opt-out clears saved banner interests.
- Coupon wallet/check/choice/launch in `backend/coupons.py`; integer-paise reservation attached to ordinary service, day-hire, first Home-plan period and direct rentals. Rentals use percentage of ACTUAL eligible usage with no expected-duration rupee ceiling. Worker/shop-funded deductions are disclosed; company share and excluded tax/travel/parts are retained. Settlement holds if available worker earnings cannot cover a discount. Cancelled reserved coupons are not automatically reissued; terms disclose reservation locks.
- Refurbished checkout uses new authoritative `retail_checkout.py` over actual operations inventory, replacing legacy-catalog/cart mismatch. CustomerCartDrawer is shared between header and marketplace. No client-created successful orders, invented18% tax, courier ETA or delivery PIN. Live quote before gateway, expected-total protection, exact gateway capture verification, one provider order per retry key, reconciliation by receipt, atomic stock reservation, account-isolated saved orders. Shops can see their own paid retail orders. Stock stays reserved until customer receipt. Receipt records go to `retail_receipt_review`; this does NOT automatically transfer money. Existing weekly parts payout logic does not silently release retail funds. Unresolved gateway/refund/retail payout outcomes require support/financial review; do not announce automated retail refunds or payouts.
- Existing live payments/payouts remain disabled (verified integration status); no live financial transactions were made. Rental/refurbished discount eligibility requires shop-declared included-tax metadata (`gst_bps`). Existing unknown-tax products were NOT assigned an invented tax rate or auto-edited. Vendor inventory screens now accept this metadata.
- QA:107-test backend regression passed; additional lifecycle tests brought targeted coupon/retail checks to14; final percentage/rental/retail suite28 passed.57 frontend logic tests passed. Both production builds passed; existing bundle-size warning and lottie-web full-player eval warning remain. Deferred light-player optimization. Browser checked320/472/1280 widths, no page horizontal overflow; all6 home slides identical425x153.421875 at472 viewport; all5 marketplace slides identical433x112; images loaded; modals/routes worked; coupon launch rendered RENT20 with correct expiry for current account and was dismissed without claiming a return-choice coupon; shared empty cart worked; runtime error log empty. Live rental catalogue loaded two actual items.
- Proof: `deployment/releases/market-banners-coupons-preview.png`.
- Dockerfile explicitly includes new coupons/opportunities/retail modules. Staging caught missing COPY list on00091; fixed before promotion.00092 was staged only;00093 is the final percentage-based version. Firebase CLI upload hit its existing run.services.get403; existing authorized gcloud-account finalization script completed release without IAM changes.
- macOS iCloud aggressively restored/offloaded project files during work. Safe parallel read hydration recovered source/assets; temporary Python venv `/private/tmp/repaido-coupon-venv` and pycache outside iCloud avoided blocked .venv reads. `pnpm install --force --frozen-lockfile` repaired dependencies after npm install failed against pnpm layout. Use pnpm for dependencies. No repository Git metadata exists. No agents spawned.

## 2026-10-01 — Compact worker dashboard and work calendar (released)

- Latest worker screenshot requests implemented in `LiveWorkerPortal.tsx`, `WorkerCalendar.tsx`, `worker-dashboard.css`, `WorkerRecords.tsx`, `ContractorPortal.tsx`; removed legacy metric-card `!important` sizing in `operations.css`.
- Compact greeting, corner verified tag and completion percentage. `/operations/worker/profile-progress` computes required registration/public-profile/identity checks on the server. Complete-profile links lead to missing public fields or verification/application settings. Verified requires 100% completion AND approved worker/identity review; filling public text never bypasses review.
- Android download (green tag), native notification option and sign-out live in worker Profile and contractor Business profile. Home no longer contains APK/sign-out blocks.
- Active-task CTA displays real count and pulses only with active work, reduced-motion aware. The previous home metrics are compact with consistent strokes.
- Availability refresh: 3-minute cooldown across focus/visibility events, one request at a time, no automatic permission prompting when browser permission is not granted, denial pauses automatic retries until explicit recovery. Contractor view does not run worker GPS heartbeat. Failed manual Go online also uses the compact recovery notice. No weakening of backend freshness/accuracy checks, and manual registration coordinates never become live GPS. Device permission still must be enabled by the user; live permission/availability was not changed for QA.
- Calendar endpoint `/operations/worker/calendar?month=YYYY-MM`, own phone-verified worker only. IST day boundaries; server-recorded task events, completion points, settlements, actual processed payouts, reviews, schedule history and availability. Added explicit availability transition records in `operations.py`; existing location samples supply observed online checks. Unknown days are not marked offline and samples are not represented as worked/online hours.
- Completion command now persists its 10-point award; old completed tasks use the existing 10-point policy. Rescheduling now snapshots prior/new schedule dates for future records. Historical reschedule dates that were never saved cannot be reconstructed. Calendar reports current-assigned-worker job history; no new access to other workers' reassigned job reports.
- Financial day colors distinguish calculated earnings, deductions, mixed earnings/deductions, completed without settlement, online checks, explicit offline transitions, scheduled activity and unknown. Actual payout date uses immutable payout journal when present, falling back to provider confirmation. No completion-as-payment assumptions; payments/payouts remain disabled as before.
- Informational monthly quality score: 60% settled completed work without deductions, 40% completed-work customer ratings. Missing measures excluded with weights normalized; no measurable data => no score. Availability never reduces score. UI displays formula, sample counts, target 85%, server-generated suggestions. Does not change financial penalty/commission or hiring policy.
- Day modal contains task accordions, complete existing task reports (payment/payout, work notes, penalty assessments, accepted policies, review, timeline and PDF). Pending work links to Active tasks. Calendar caches own month for 60 seconds and invalidates on job updates; refresh is explicit and requests run in background.
- Validation: 26 core/calendar/presence tests + 18 hiring-records/rewards/visits regressions passed; 7 Node GPS/refresh tests passed. Firebase and cPanel builds passed. Staged 23-route HTTP smoke passed, plus unauthenticated calendar/profile-progress endpoints returned 401. Live browser verified profile/account controls, September completed-day details and points, 320px no-overlap calendar/nav, 496px dashboard. No live booking, profile, permission, payment or availability mutations were used for QA.
- Backend: `repaido-api-00095-xit`, 100% traffic. Firebase FINAL version `124423354258f7c7`, live release `1790833769875000`. Includes the scoped calendar day-colour fix; earlier intermediate versions `072c2629b5ff1d56` and `980b09dd53519c6d` superseded. All 69 deployed files verified against the final build.
- cPanel offline package: `deployment/releases/repaido-cpanel-worker-dashboard-final-20261001.zip` (74,992,072 bytes, 70 archive entries; 69 manifest files). **repaido.com frontend deployment remains deferred.** Backend service is shared.
- Proof: `deployment/releases/worker-dashboard-preview-20261001.png` and `deployment/releases/worker-calendar-preview-20261001.png`.

## 2026-10-01 — Worker network and project recruitment

- User confirmed technician ₹12,000/year and specialist ₹18,000/year, both GST inclusive, with a yearly plan required for ALL messaging, including forums/group posts/replies. Search, connections, reading, joining groups and project applications are free. Existing launch/earned listing entitlements do not unlock messaging.
- Added `worker_network.py`, wired into `main.py`, Docker COPY and the integration scheduler. Approved, phone-verified workers can search approved professional profiles, contractors, explicitly published project hiring notices and their OWN assigned task history. Profile data contains public skills/bio/reviews only; precise locations, customer contacts, private documents, payroll and unpublished project scope/budgets are excluded. Public team details are aggregate counts. No fabricated profiles, groups, applications or success records were seeded.
- Shared `WorkNetwork.tsx`, `workNetworkApi.ts`, `work-network.css` add a compact search entry to technician/specialist and contractor desks; debounced discovery, city/skill filters, rating/experience ordering, pagination, full public profiles, connection requests/accept/decline/cancel/remove, inbox/conversations, communities/forums, application history and annual plan screen. Own task results use the existing full TaskReport. Background requests avoid global loading overlays; chat refreshes every 5 seconds only while its view is open and document visible. Other active network views use longer visible-only refreshes. This is polling, not a new socket transport.
- Consent-based private chat requires an accepted, unblocked connection. Sending, creating a community, posting and replying require a paid, unexpired, role-matching network membership backed by a confirmed payment record. Recipients can read without buying. Server enforces gates, request idempotency, limits, block controls and moderation suspension. Reports go to new NetworkModeration in company admin Moderation, with hide/restore and suspend/unsuspend and audit records. Group owners/authors can remove posts.
- `contract_work.py` now supports public hiring notices with status open/paused/closed, public area/city/sector/scope, skills, worker role, experience, total team places, daily pay, hours, deadline, terms and benefits. New sectors use the existing ecosystem catalogue. Candidates explicitly confirm dates/terms before applying; application stores a notice snapshot. Contractor Hiring tab manages notices, filters requests by project/status, shortlists/declines with reasons, and sends rate/terms-based offers. Optimistic versions, role/experience checks, schedule conflicts and capacity are checked before offers. Offers create PENDING existing project invitations; workers still must accept through Project teams. Existing goals, attendance, leave, hierarchy and project lifecycle remain connected.
- Contractor overview now uses compact metric cards, short controls, hidden-scrollbar category tabs and a direct recruitment entry. Desk switch icons use Lucide rather than emoji.
- Annual checkout uses the existing Razorpay widget with server-generated orders, receipt recovery after uncertain creation, exact amount/currency/order/capture verification, 365-day entitlement after confirmation, idempotent checks and refund invalidation. No automatic renewal. **Global live payments/payouts remain disabled, so plan purchasing is visibly disabled.** Do not claim paid plans can currently be bought, or enable all platform payments merely to activate network checkout. No live payments, messages, posts, connections, hiring notices, applications or offers were submitted for QA.
- Validation: 60-test targeted backend regression passed (network/contracts/records/calendar/integrations/core); cloud QA found an empty Firestore fee-ID lookup for accounts with no membership, fixed with an early false return and a strict document-ID regression. Final network suite 15 passed (61 distinct backend checks across the two runs). Nine existing frontend booking tests passed. Both production builds passed; existing bundle-size/Lottie warnings remain. Candidate HTTP smoke passed all 23 routes; 5 new unauthenticated routes returned 401. Browser QA uses the signed-in account read-only and confirmed public profile reviews, own task search, contractor recruitment entry, project form, community paywall, plan prices and no horizontal overflow at 320px.
- Backend FINAL `repaido-api-00099-lur`, 100% traffic. Intermediate `00097-dab` superseded (no-membership lookup fixed). Backend shared by both domains. Firebase FINAL `9aee7760433d333e`, release `1790839584477000`; intermediate `eafbf1915e5207f7` and `50cae7d48b2ae3a8` superseded. Existing Firebase CLI run.services.get 403 was finalized with the already authorized gcloud account; no IAM changes.
- `deployment/releases/repaido-cpanel-work-network-final-20261001.zip` is offline only; repaido.com frontend deployment remains deferred. Latest final mobile label correction rebuilt both targets. Final screenshots and file-hash verification recorded below after read-only QA.
- Final live verification: all 69 Firebase files match the final build. At 320px the document and plan dialog have equal client/scroll widths (no horizontal overflow); annual labels remain intact; subscription response contains no alert. Profile displays actual verified review history and the explicit paid community-creation path redirects to Yearly plan. Final offline cPanel archive is 75,006,018 bytes, 70 entries (69 manifest files plus htaccess).
- Proof files: `deployment/releases/contractor-network-preview-20261001.png`, `deployment/releases/network-plan-mobile-20261001.png`, and `deployment/releases/work-network-preview-20261001.png`. No source-control commit available (workspace has no Git metadata).
- Final spacing follow-up supersedes the previous frontend version: Firebase `436a3db5344ec340`, release `1790840171276000`. Reset legacy `.operations` label/input margins inside the new network component and fixed search field/filter controls at 46px. Backend remains `00099-lur`. The cPanel offline archive was rebuilt again under the same final archive name. Keyword search “wiring” correctly narrows the live professional list while retaining the account’s matching own tasks.
