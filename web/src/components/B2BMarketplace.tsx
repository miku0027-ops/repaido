import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Boxes,
  FileSpreadsheet,
  Search,
  Building2,
  ShieldCheck,
  Truck,
  CheckCircle2,
  Clock,
  Download,
  Send,
  X,
  Plus,
  ShoppingCart,
  ArrowRight,
  Filter,
  FileText,
  BadgePercent,
  Sparkles,
  Info,
  TrendingUp,
  Flame,
  Coins,
  Handshake,
  Check,
  ExternalLink,
  HardHat,
  Wind,
  Zap,
  Droplets,
  Wrench,
  Cpu,
  Layers
} from 'lucide-react';
import type {
  B2BListing,
  B2BRfqRequest,
  B2BQuotation,
  B2BCategory,
  RFQUrgency
} from '../types/b2b';
import { b2bService } from '../services/b2bService';
import { cartService } from '../services/cartService';
import { CustomerSearchField } from './ui';
import { B2BQuotationPdfModal } from './B2BQuotationPdfModal';
import './b2b-marketplace.css';

interface B2BMarketplaceProps {
  onOpenCart?: () => void;
  customerUser?: { name?: string; phone?: string; email?: string } | null;
  onSignIn?: () => void;
  contractorMode?: boolean;
  onOpenContractorPortal?: () => void;
  onSwitchToTenders?: () => void;
  onNavigateToCustomerMarket?: (market: 'parts' | 'refurbished' | 'used' | 'exchange') => void;
}

interface CarouselCardItem {
  id: string;
  theme: 'emerald' | 'sapphire' | 'amethyst' | 'amber' | 'cyan' | 'slate';
  badgeIcon: React.ElementType;
  badgeLabel: string;
  title: string;
  movingPhrase: string;
  schemeTag: string;
  categoryFilter?: string;
  isSchemeModal?: boolean;
}

const CAROUSEL_CARDS: CarouselCardItem[] = [
  {
    id: 'indiamart-brokerage',
    theme: 'emerald',
    badgeIcon: ShieldCheck,
    badgeLabel: '0% BROKERAGE vs INDIAMART',
    title: 'Zero Platform Fee on 3 Truckloads',
    movingPhrase: 'No dead-lead fees · 100% verified GST contractor RFQs',
    schemeTag: 'DEALER SCHEME',
    isSchemeModal: true
  },
  {
    id: 'escrow-48h',
    theme: 'sapphire',
    badgeIcon: CheckCircle2,
    badgeLabel: 'ZERO DEFAULT RISK',
    title: 'Guaranteed 48h Escrow Disbursal',
    movingPhrase: 'Customer funds locked in escrow before dispatch · 0 bad debt',
    schemeTag: 'ESCROW 48H',
    isSchemeModal: true
  },
  {
    id: 'contractors-pipeline',
    theme: 'amethyst',
    badgeIcon: Building2,
    badgeLabel: '500+ CONTRACTORS PIPELINE',
    title: 'Contractor Tender Bulk Supply',
    movingPhrase: 'Direct procurement channel for PWD & civil tenders',
    schemeTag: 'TENDER SUPPLY',
    isSchemeModal: true
  },
  {
    id: 'gst-itc-pass',
    theme: 'amber',
    badgeIcon: FileSpreadsheet,
    badgeLabel: '100% GST ITC COMPLIANT',
    title: 'Instant Input Tax Credit (ITC)',
    movingPhrase: 'Automated GSTR-1 matching · HSN e-invoicing in 1 click',
    schemeTag: 'SAVE 18%-28%',
    isSchemeModal: true
  },
  {
    id: 'hvac-copper-gas',
    theme: 'cyan',
    badgeIcon: BadgePercent,
    badgeLabel: 'FLAT 24% BULK DISCOUNT',
    title: 'HVAC Copper Coils & Refrigerants',
    movingPhrase: 'Mandev pancake coils, R32 & R410A virgin cylinders',
    schemeTag: 'BULK SLAB',
    categoryFilter: 'hvac'
  },
  {
    id: 'cables-tools-valves',
    theme: 'slate',
    badgeIcon: Sparkles,
    badgeLabel: 'CONTRACTOR GRADE MOQ',
    title: 'Heavy Power Tools, Cables & Valves',
    movingPhrase: 'Polycab XLPE cables, Bosch tools & Zoloto CI valves',
    schemeTag: 'MOQ SLABS',
    categoryFilter: 'tools'
  }
];

export const B2BMarketplace: React.FC<B2BMarketplaceProps> = ({
  onOpenCart,
  customerUser,
  onSignIn,
  contractorMode = false,
  onOpenContractorPortal,
  onSwitchToTenders,
  onNavigateToCustomerMarket
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'browse' | 'rfqs'>('browse');
  const [listings, setListings] = useState<B2BListing[]>([]);
  const [rfqs, setRfqs] = useState<B2BRfqRequest[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [verifiedOnly, setVerifiedOnly] = useState(false);

  // Carousel & Dealer Scheme Modal State
  const carouselRef = useRef<HTMLDivElement>(null);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const [showSchemesModal, setShowSchemesModal] = useState(false);

  // RFQ Submission Modal State
  const [activeRfqListing, setActiveRfqListing] = useState<B2BListing | null>(null);
  const [rfqQuantity, setRfqQuantity] = useState<number>(10);
  const [rfqTargetPrice, setRfqTargetPrice] = useState<string>('');
  const [rfqCompanyName, setRfqCompanyName] = useState('');
  const [rfqGstin, setRfqGstin] = useState('');
  const [rfqTenderRef, setRfqTenderRef] = useState('');
  const [rfqAddress, setRfqAddress] = useState('Ganeswarpur Industrial Area, Balasore');
  const [rfqCity, setRfqCity] = useState('Balasore');
  const [rfqPincode, setRfqPincode] = useState('756019');
  const [rfqUrgency, setRfqUrgency] = useState<RFQUrgency>('within_7_days');
  const [rfqNotes, setRfqNotes] = useState('');
  const [rfqSuccessMsg, setRfqSuccessMsg] = useState('');

  // PDF Preview Modal State
  const [viewingQuotation, setViewingQuotation] = useState<B2BQuotation | null>(null);

  // Bulk Cart Added Toast State
  const [cartToastMsg, setCartToastMsg] = useState('');

  // Load Data
  const refreshData = () => {
    setListings(b2bService.getB2BListings().filter(l => l.status === 'active'));
    setRfqs(b2bService.getCustomerRFQs(customerUser?.phone || customerUser?.email));
  };

  useEffect(() => {
    refreshData();
    const unsub = b2bService.subscribe(refreshData);
    return unsub;
  }, [customerUser]);

  // Listen for newly issued quotation notifications
  useEffect(() => {
    const handleQuoteNotif = (e: any) => {
      refreshData();
      if (e.detail?.quoteNumber) {
        // Find and auto-prompt
        const allRfqs = b2bService.getRFQs();
        const found = allRfqs.find(r => r.quotation?.quoteNumber === e.detail.quoteNumber);
        if (found?.quotation) {
          setViewingQuotation(found.quotation);
        }
      }
    };
    window.addEventListener('repaido:b2b:notification', handleQuoteNotif);
    return () => window.removeEventListener('repaido:b2b:notification', handleQuoteNotif);
  }, []);

  // Auto-advance slideshow carousel every 4.2s
  useEffect(() => {
    if (isHovered) return;
    const timer = setInterval(() => {
      setCurrentSlide(prev => {
        const next = (prev + 1) % CAROUSEL_CARDS.length;
        if (carouselRef.current) {
          carouselRef.current.scrollTo({ left: next * 248, behavior: 'smooth' });
        }
        return next;
      });
    }, 4200);
    return () => clearInterval(timer);
  }, [isHovered]);

  // Filter listings
  const filteredListings = useMemo(() => {
    return listings.filter(item => {
      if (selectedCategory === 'tender_materials') {
        const isTenderItem = ['hvac', 'electrical', 'tools', 'plumbing'].includes(item.category) ||
          /copper|cable|valve|compressor|conduit|switchgear|drill|hammer|breaker/i.test(item.title);
        if (!isTenderItem) return false;
      } else if (selectedCategory !== 'all' && item.category !== selectedCategory) {
        return false;
      }
      if (verifiedOnly && !item.verifiedDistributor) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = item.title.toLowerCase().includes(q);
        const matchesDistributor = item.distributorName.toLowerCase().includes(q);
        const matchesHsn = item.hsnCode.includes(q);
        const matchesPart = item.partNumber.toLowerCase().includes(q);
        if (!matchesTitle && !matchesDistributor && !matchesHsn && !matchesPart) return false;
      }
      return true;
    });
  }, [listings, selectedCategory, verifiedOnly, searchQuery]);

  // Count active quotations received
  const readyQuotesCount = useMemo(() => {
    return rfqs.filter(r => r.status === 'quoted').length;
  }, [rfqs]);

  // Open RFQ Modal
  const handleOpenRfq = (listing: B2BListing) => {
    setActiveRfqListing(listing);
    setRfqQuantity(listing.moq);
    setRfqTargetPrice(String(listing.basePrice));
    setRfqSuccessMsg('');
  };

  // Submit RFQ
  const handleRfqSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRfqListing) return;

    if (rfqQuantity < activeRfqListing.moq) {
      alert(`Minimum Order Quantity (MOQ) for this wholesale item is ${activeRfqListing.moq} ${activeRfqListing.unit}.`);
      return;
    }

    const noteDetails = [
      rfqTenderRef ? `[TENDER/PROJECT: ${rfqTenderRef}]` : '',
      rfqNotes
    ].filter(Boolean).join(' ');

    const created = b2bService.createRFQ({
      listingId: activeRfqListing.id,
      itemTitle: activeRfqListing.title,
      category: activeRfqListing.category,
      hsnCode: activeRfqListing.hsnCode,
      unit: activeRfqListing.unit,
      shopId: activeRfqListing.shopId,
      shopName: activeRfqListing.shopName,
      customerName: customerUser?.name || 'Commercial Procurement Buyer',
      customerPhone: customerUser?.phone || '+91 94371 00000',
      customerEmail: customerUser?.email || 'buyer@business.in',
      buyerCompanyName: rfqCompanyName || undefined,
      buyerGstin: rfqGstin || undefined,
      deliveryAddress: rfqAddress,
      deliveryCity: rfqCity,
      deliveryPincode: rfqPincode,
      quantityRequested: Number(rfqQuantity),
      targetPricePerUnit: rfqTargetPrice ? Number(rfqTargetPrice) : undefined,
      urgency: rfqUrgency,
      notes: noteDetails
    });

    setRfqSuccessMsg(`Quotation request ${created.id} submitted to ${activeRfqListing.shopName}! The distributor will issue an official Repaido Quotation PDF.`);
    setTimeout(() => {
      setActiveRfqListing(null);
      setActiveSubTab('rfqs');
    }, 1800);
  };

  // Quick Direct Bulk Order into Cart
  const handleQuickBulkOrder = (listing: B2BListing) => {
    const unitPrice = listing.basePrice;
    const qty = listing.moq;

    cartService.addItem({
      id: `b2b-${listing.id}`,
      title: `[WHOLESALE MOQ ${qty} ${listing.unit}] ${listing.title}`,
      price_paise: unitPrice * qty * 100,
      quantity: 1,
      category: 'Wholesale B2B',
      shop_id: listing.shopId,
      shop_name: listing.shopName,
      image_url: listing.image
    });

    setCartToastMsg(`Added ${qty} ${listing.unit} of ${listing.title} to Cart at wholesale rate!`);
    setTimeout(() => setCartToastMsg(''), 4000);

    if (onOpenCart) {
      onOpenCart();
    }
  };

  const handleAcceptQuote = (rfqId: string) => {
    b2bService.acceptQuotation(rfqId);
    alert('Quotation accepted! Distributor notified to initiate dispatch via Repaido B2B Escrow.');
    refreshData();
  };

  const categoriesList = [
    { id: 'all', name: 'All Wholesale', icon: Boxes },
    { id: 'tender_materials', name: 'Tender Raw Materials', icon: HardHat },
    { id: 'hvac', name: 'HVAC & Copper', icon: Wind },
    { id: 'electrical', name: 'Electrical & Cables', icon: Zap },
    { id: 'plumbing', name: 'Plumbing & Valves', icon: Droplets },
    { id: 'tools', name: 'Power Tools', icon: Wrench },
    { id: 'refrigerants', name: 'Refrigerants & Gases', icon: Cpu },
    { id: 'hardware', name: 'Commercial Hardware', icon: Layers }
  ];

  return (
    <div className="b2b-hub-container">
      {/* Contractor Active Mode Banner */}
      {contractorMode && (
        <aside className="b2b-contractor-mode-banner">
          <span>
            <HardHat size={16} className="text-amber-300" />
            Contractor Procurement Active: Procuring Raw Materials &amp; Spares for Tenders &amp; Projects
          </span>
          <div className="flex items-center gap-2">
            {onSwitchToTenders && (
              <button type="button" onClick={onSwitchToTenders}>
                Open Tenders Desk
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelectedCategory('tender_materials')}
              className="bg-amber-400 text-slate-900"
            >
              Filter Tender Materials
            </button>
          </div>
        </aside>
      )}

      {/* Reduced-Height Hero Card with Micro Elements */}
      <section className="b2b-compact-hero-card">
        <div className="b2b-micro-hero-row">
          <div className="b2b-micro-hero-left">
            <span className="b2b-micro-hero-title">
              <Boxes size={14} className="text-amber-400" />
              Repaido B2B Wholesale
            </span>
            <span className="b2b-micro-escrow-pill">
              <ShieldCheck size={10} />
              0% Listing Fee · 48h Escrow
            </span>
          </div>

          <button
            type="button"
            className="b2b-micro-scheme-link"
            onClick={() => setShowSchemesModal(true)}
            title="View Repaido vs IndiaMART Dealer Profit Scheme"
          >
            <Sparkles size={11} className="text-amber-300" />
            Dealer Schemes
          </button>
        </div>

        {/* Micro Carousel Viewport */}
        <div
          className="b2b-micro-carousel-viewport"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <div className="b2b-micro-carousel-track" ref={carouselRef}>
            {CAROUSEL_CARDS.map((card) => {
              const Icon = card.badgeIcon;
              return (
                <div
                  key={card.id}
                  className="b2b-micro-capsule-card"
                  onClick={() => {
                    if (card.isSchemeModal) {
                      setShowSchemesModal(true);
                    } else if (card.categoryFilter) {
                      setSelectedCategory(card.categoryFilter);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <span className="b2b-micro-capsule-badge">
                    <Icon size={9} />
                    {card.badgeLabel}
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span className="b2b-micro-capsule-title">{card.title}</span>
                    <span className="b2b-micro-capsule-desc">{card.schemeTag}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="b2b-micro-carousel-dots">
            {CAROUSEL_CARDS.map((_, idx) => (
              <span
                key={idx}
                className={`b2b-micro-dot ${currentSlide === idx ? 'active' : ''}`}
                onClick={() => {
                  setCurrentSlide(idx);
                  if (carouselRef.current) {
                    carouselRef.current.scrollTo({ left: idx * 248, behavior: 'smooth' });
                  }
                }}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Subtab Toggle (Browse vs RFQs) */}
      <div className="b2b-subnav-switch" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeSubTab === 'browse'}
          className={`b2b-subnav-btn ${activeSubTab === 'browse' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('browse')}
        >
          <Boxes size={16} />
          Browse Wholesale Catalog ({listings.length})
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeSubTab === 'rfqs'}
          className={`b2b-subnav-btn ${activeSubTab === 'rfqs' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('rfqs')}
        >
          <FileText size={16} />
          My Inquiries &amp; Quotations ({rfqs.length})
          {readyQuotesCount > 0 && (
            <span className="b2b-badge-count">{readyQuotesCount} QUOTE</span>
          )}
        </button>
      </div>

      {/* Cart Toast Notification */}
      {cartToastMsg && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-xl text-xs font-semibold flex items-center justify-between shadow-sm">
          <span className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
            {cartToastMsg}
          </span>
          <button
            type="button"
            className="text-emerald-700 underline text-xs font-bold"
            onClick={onOpenCart}
          >
            View Cart
          </button>
        </div>
      )}

      {/* VIEW 1: BROWSE WHOLESALE LISTINGS */}
      {activeSubTab === 'browse' && (
        <>
          {/* Filters Bar with Reusable Theme-Matched Search Field */}
          <div className="b2b-filters-bar">
            <div className="b2b-search-row">
              <div className="b2b-customer-search-wrap">
                <CustomerSearchField
                  label="Search wholesale catalog"
                  placeholder="Search bulk items, HSN code, copper coils, cables, compressors, valves..."
                  value={searchQuery}
                  onChange={setSearchQuery}
                />
              </div>

              <label className="b2b-verified-toggle">
                <input
                  type="checkbox"
                  checked={verifiedOnly}
                  onChange={(e) => setVerifiedOnly(e.target.checked)}
                />
                <ShieldCheck size={15} className="text-emerald-500" />
                <span>Verified Distributors</span>
              </label>
            </div>

            {/* Category Chips Rail */}
            <div className="b2b-category-chips" role="tablist" aria-label="Wholesale categories">
              {categoriesList.map(cat => {
                const Icon = cat.icon || Boxes;
                const isSelected = selectedCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    className={`b2b-cat-chip ${isSelected ? 'active' : ''}`}
                    onClick={() => setSelectedCategory(cat.id)}
                  >
                    <Icon size={14} aria-hidden="true" />
                    <span>{cat.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Listings Grid */}
          {filteredListings.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-2xl border border-slate-200 p-8">
              <Boxes size={48} className="mx-auto text-slate-400 mb-3" />
              <h3 className="text-base font-bold text-slate-800">No wholesale listings match your filter</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                Try clearing search terms or selecting another category. All listings are authentic items verified with Indian HSN codes and GST credentials.
              </p>
              <button
                type="button"
                className="mt-4 px-4 py-2 bg-[#142858] text-white text-xs font-semibold rounded-lg"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('all');
                  setVerifiedOnly(false);
                }}
              >
                Reset Filters
              </button>
            </div>
          ) : (
            <div className="b2b-listings-grid">
              {filteredListings.map(item => (
                <article className="b2b-card" key={item.id}>
                  <div className="b2b-card-top">
                    <img
                      src={item.image}
                      alt={item.title}
                      className="b2b-card-img"
                      onError={(e) => {
                        e.currentTarget.src = '/images/ac.jpg';
                      }}
                    />
                    <span className="b2b-moq-chip">
                      MOQ: {item.moq} {item.unit}
                    </span>
                    {item.verifiedDistributor && (
                      <span className="b2b-verified-badge">
                        <ShieldCheck size={12} />
                        Verified
                      </span>
                    )}
                  </div>

                  <div className="b2b-card-body">
                    <span className="b2b-card-category">{item.category} · HSN {item.hsnCode}</span>
                    <h3 className="b2b-card-title">{item.title}</h3>

                    {/* Pricing Slabs Matrix */}
                    <div className="b2b-slab-matrix">
                      <div className="b2b-slab-header">
                        <span>Quantity Tier</span>
                        <span>Wholesale Rate / {item.unit.replace(/s$/, '')}</span>
                      </div>
                      {item.bulkSlabs.map((slab, idx) => (
                        <div className="b2b-slab-row" key={idx}>
                          <span className="b2b-slab-qty">
                            {slab.minQty}{slab.maxQty ? ` – ${slab.maxQty}` : '+'} {item.unit}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="b2b-slab-tag">{slab.discountLabel}</span>
                            <span className="b2b-slab-price">₹{slab.pricePerUnit.toLocaleString('en-IN')}</span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Distributor Strip */}
                    <div className="b2b-distributor-info">
                      <div className="b2b-distributor-name">
                        <Building2 size={13} className="text-slate-500" />
                        {item.distributorName}
                      </div>
                      <div className="b2b-dispatch-sla">
                        <Truck size={12} />
                        Dispatches in {item.leadTimeDays} business days · {item.city}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="b2b-card-actions">
                      <button
                        type="button"
                        className="b2b-btn-rfq"
                        onClick={() => handleOpenRfq(item)}
                      >
                        <FileText size={14} />
                        Request Quotation
                      </button>

                      <button
                        type="button"
                        className="b2b-btn-cart"
                        onClick={() => handleQuickBulkOrder(item)}
                        title={`Add minimum wholesale order (${item.moq} ${item.unit}) to cart`}
                      >
                        <ShoppingCart size={14} />
                        Order MOQ ({item.moq})
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {/* VIEW 2: CUSTOMER RFQS & QUOTATIONS TRACKER */}
      {activeSubTab === 'rfqs' && (
        <section className="b2b-rfq-list">
          <div className="bg-white p-4 rounded-xl border border-slate-200 mb-2 flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Your Bulk Inquiries &amp; Quotations</h2>
              <p className="text-xs text-slate-500">
                Track quotation requests sent to shop distributors. View and download official Repaido PDFs when issued.
              </p>
            </div>
            <button
              type="button"
              className="text-xs font-bold text-[#142858] hover:underline"
              onClick={() => setActiveSubTab('browse')}
            >
              + Submit New Bulk Inquiry
            </button>
          </div>

          {rfqs.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-2xl border border-slate-200 p-8">
              <FileSpreadsheet size={48} className="mx-auto text-slate-400 mb-3" />
              <h3 className="text-base font-bold text-slate-800">No quotation requests submitted yet</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                Browse our B2B Wholesale catalog and click "Request Quotation" on any product to get direct distributor price quotes.
              </p>
              <button
                type="button"
                className="mt-4 px-4 py-2 bg-[#142858] text-white text-xs font-semibold rounded-lg"
                onClick={() => setActiveSubTab('browse')}
              >
                Browse Wholesale Products
              </button>
            </div>
          ) : (
            rfqs.map(rfq => (
              <article
                key={rfq.id}
                className={`b2b-rfq-card ${rfq.status === 'quoted' ? 'has-quote' : ''}`}
              >
                <div className="b2b-rfq-card-header">
                  <div>
                    <span className="b2b-rfq-ref">RFQ REF: {rfq.id}</span>
                    <h3 className="b2b-rfq-card-title">{rfq.itemTitle}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Distributor: <strong>{rfq.shopName}</strong> · Quantity: <strong>{rfq.quantityRequested} {rfq.unit}</strong>
                    </p>
                  </div>

                  <div>
                    {rfq.status === 'pending' && (
                      <span className="b2b-status-pill pending">
                        <Clock size={12} />
                        Awaiting Distributor Quote
                      </span>
                    )}
                    {rfq.status === 'quoted' && (
                      <span className="b2b-status-pill quoted">
                        <Sparkles size={12} />
                        Quotation Issued!
                      </span>
                    )}
                    {rfq.status === 'accepted' && (
                      <span className="b2b-status-pill accepted">
                        <CheckCircle2 size={12} />
                        Deal Accepted
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-xs text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-200">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Buyer Info</span>
                      <span>{rfq.buyerCompanyName || rfq.customerName}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Delivery Destination</span>
                      <span>{rfq.deliveryCity} - {rfq.deliveryPincode}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Urgency Timeline</span>
                      <span className="capitalize">{rfq.urgency.replace(/_/g, ' ')}</span>
                    </div>
                  </div>
                </div>

                {/* Quotation Ready Banner */}
                {rfq.quotation && (
                  <div className="b2b-quote-callout">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold text-emerald-800 uppercase tracking-wide flex items-center gap-1">
                          <CheckCircle2 size={13} className="text-emerald-600" />
                          Official Quote: {rfq.quotation.quoteNumber}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          (Valid until {rfq.quotation.validUntil})
                        </span>
                      </div>

                      <div className="b2b-quote-figures">
                        <span className="text-xs text-slate-600">
                          Offered Rate: <strong className="b2b-quote-rate">₹{rfq.quotation.offeredRate.toLocaleString('en-IN')}/{rfq.quotation.unit.replace(/s$/, '')}</strong>
                        </span>
                        <span className="text-xs text-slate-600">
                          Total with GST: <strong className="b2b-quote-total">₹{rfq.quotation.grandTotal.toLocaleString('en-IN')}</strong>
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="px-3.5 py-2 bg-[#142858] hover:bg-[#0f2048] text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shadow-sm transition-colors"
                        onClick={() => setViewingQuotation(rfq.quotation!)}
                      >
                        <FileText size={14} />
                        View &amp; Download PDF
                      </button>

                      {rfq.status === 'quoted' && (
                        <button
                          type="button"
                          className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shadow-sm transition-colors"
                          onClick={() => handleAcceptQuote(rfq.id)}
                        >
                          <CheckCircle2 size={14} />
                          Accept Deal
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </article>
            ))
          )}
        </section>
      )}

      {/* RFQ MODAL */}
      {activeRfqListing && (
        <div className="b2b-rfq-modal-overlay">
          <div className="b2b-rfq-modal-box">
            <div className="b2b-rfq-modal-header">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <FileSpreadsheet size={16} />
                Request Wholesale Quotation
              </h2>
              <button
                type="button"
                className="text-white hover:opacity-80"
                onClick={() => setActiveRfqListing(null)}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleRfqSubmit} className="b2b-rfq-modal-form">
              <div className="bg-blue-50 border border-blue-200 p-3 rounded-xl text-xs text-blue-900">
                <p className="font-bold text-blue-950 mb-0.5">{activeRfqListing.title}</p>
                <p className="text-blue-800">
                  Distributor: <strong>{activeRfqListing.distributorName}</strong> ·
                  Minimum Order Quantity: <strong>{activeRfqListing.moq} {activeRfqListing.unit}</strong>
                </p>
              </div>

              {rfqSuccessMsg && (
                <div className="p-3 bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-xl text-xs font-semibold flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                  {rfqSuccessMsg}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="b2b-input-group">
                  <label>Quantity Required ({activeRfqListing.unit}) *</label>
                  <input
                    type="number"
                    min={activeRfqListing.moq}
                    required
                    value={rfqQuantity}
                    onChange={(e) => setRfqQuantity(Math.max(activeRfqListing.moq, Number(e.target.value)))}
                  />
                  <span className="text-[10px] text-slate-500 mt-1 block">
                    Must meet or exceed MOQ of {activeRfqListing.moq} {activeRfqListing.unit}
                  </span>
                </div>

                <div className="b2b-input-group">
                  <label>Target Price / {activeRfqListing.unit.replace(/s$/, '')} (₹)</label>
                  <input
                    type="number"
                    placeholder={`e.g. ₹${activeRfqListing.basePrice}`}
                    value={rfqTargetPrice}
                    onChange={(e) => setRfqTargetPrice(e.target.value)}
                  />
                  <span className="text-[10px] text-slate-500 mt-1 block">
                    Catalog Base Rate: ₹{activeRfqListing.basePrice}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="b2b-input-group">
                  <label>Buyer Company / Trade Name (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. Utkal Cooling Systems Pvt Ltd"
                    value={rfqCompanyName}
                    onChange={(e) => setRfqCompanyName(e.target.value)}
                  />
                </div>

                <div className="b2b-input-group">
                  <label>Buyer GSTIN (For ITC Tax Credit)</label>
                  <input
                    type="text"
                    placeholder="e.g. 21AAACK1928J1Z9"
                    maxLength={15}
                    value={rfqGstin}
                    onChange={(e) => setRfqGstin(e.target.value.toUpperCase())}
                  />
                </div>
              </div>

              <div className="b2b-input-group">
                <label>Tender or Project Reference (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Govt PWD Electrical Tender #429 / Hospital Project"
                  value={rfqTenderRef}
                  onChange={(e) => setRfqTenderRef(e.target.value)}
                />
                <span className="text-[10px] text-slate-500 mt-1 block">
                  Distributor will stamp this quotation reference for official tender submission
                </span>
              </div>

              <div className="b2b-input-group">
                <label>Delivery Address &amp; Destination *</label>
                <input
                  type="text"
                  required
                  placeholder="Street address, industrial plot or workshop location"
                  value={rfqAddress}
                  onChange={(e) => setRfqAddress(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="b2b-input-group">
                  <label>City *</label>
                  <input
                    type="text"
                    required
                    value={rfqCity}
                    onChange={(e) => setRfqCity(e.target.value)}
                  />
                </div>

                <div className="b2b-input-group">
                  <label>Pincode *</label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    pattern="[0-9]{6}"
                    value={rfqPincode}
                    onChange={(e) => setRfqPincode(e.target.value)}
                  />
                </div>
              </div>

              <div className="b2b-input-group">
                <label>Urgency / Required Delivery SLA</label>
                <select
                  value={rfqUrgency}
                  onChange={(e) => setRfqUrgency(e.target.value as RFQUrgency)}
                >
                  <option value="immediate">Immediate Dispatch (1-2 Days)</option>
                  <option value="within_7_days">Within 7 Days</option>
                  <option value="within_15_days">Within 15 Days</option>
                  <option value="flexible">Flexible / Planning Next Month</option>
                </select>
              </div>

              <div className="b2b-input-group">
                <label>Project Notes / Custom Specs Requirement</label>
                <textarea
                  rows={2}
                  placeholder="Mention any custom brand preference, test certificates, or specific packing requirements..."
                  value={rfqNotes}
                  onChange={(e) => setRfqNotes(e.target.value)}
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  onClick={() => setActiveRfqListing(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#142858] hover:bg-[#0f2048] text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm"
                >
                  <Send size={14} />
                  Send Quotation Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* REPAIDO VS INDIAMART DEALER PROFIT SCHEMES MODAL */}
      {showSchemesModal && (
        <div className="b2b-rfq-modal-overlay" onClick={() => setShowSchemesModal(false)}>
          <div className="b2b-rfq-modal-box b2b-schemes-modal" onClick={e => e.stopPropagation()}>
            <div className="b2b-schemes-header">
              <h2>
                <Sparkles size={20} className="text-amber-300" />
                Repaido B2B Dealer Profit Schemes vs IndiaMART
              </h2>
              <p>
                How Repaido Wholesale empowers industrial distributors and manufacturers across Odisha
                with zero fake lead fees, guaranteed escrow settlements, and direct contractor demand.
              </p>
            </div>

            <div className="b2b-schemes-body">
              {/* Comparative Matrix */}
              <div className="b2b-comparison-table-wrap">
                <table className="b2b-comparison-table">
                  <thead>
                    <tr>
                      <th>Platform Metric</th>
                      <th className="repaido-col">Repaido B2B Wholesale</th>
                      <th>IndiaMART / Other Giants</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="feature-name">Listing &amp; Annual Fees</td>
                      <td className="repaido-cell">₹0 Free Catalog Listing</td>
                      <td className="indiamart-cell">₹30,000 – ₹1,50,000 / year mandatory fee</td>
                    </tr>
                    <tr>
                      <td className="feature-name">Lead Quality &amp; Inquiry Charges</td>
                      <td className="repaido-cell">100% Verified GSTIN RFQs (Zero lead charges)</td>
                      <td className="indiamart-cell">Pay-per-lead charges (60-80% junk/unreachable)</td>
                    </tr>
                    <tr>
                      <td className="feature-name">Payment Security &amp; Default Risk</td>
                      <td className="repaido-cell">100% Escrow protected (Funds in escrow before dispatch)</td>
                      <td className="indiamart-cell">No escrow protection (Dealer carries 100% default risk)</td>
                    </tr>
                    <tr>
                      <td className="feature-name">Settlement &amp; Disbursal SLA</td>
                      <td className="repaido-cell">Guaranteed 48-Hour Bank Disbursal on delivery proof</td>
                      <td className="indiamart-cell">Unregulated / 60–90 days delayed market credit</td>
                    </tr>
                    <tr>
                      <td className="feature-name">Direct Contractor Pipeline</td>
                      <td className="repaido-cell">Directly tied to 500+ active civil, electrical &amp; HVAC tenders</td>
                      <td className="indiamart-cell">None (Generic public phone directory)</td>
                    </tr>
                    <tr>
                      <td className="feature-name">GST ITC &amp; HSN Compliance</td>
                      <td className="repaido-cell">Automated GSTR-1 matching &amp; compliant PDF quotation</td>
                      <td className="indiamart-cell">Manual billing without automated reconciliation</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* 4 Dealer Profit Scheme Cards */}
              <div className="b2b-schemes-grid">
                <div className="b2b-scheme-feature-card">
                  <strong>
                    <ShieldCheck size={16} className="text-emerald-600" />
                    Scheme 1: 0% Platform Brokerage
                  </strong>
                  <p>
                    New distributors enjoy zero platform brokerage fee on their first 3 truckload or bulk container consignments. Keep 100% of your wholesale margins.
                  </p>
                </div>

                <div className="b2b-scheme-feature-card">
                  <strong>
                    <Coins size={16} className="text-amber-600" />
                    Scheme 2: 48-Hour Escrow Guarantee
                  </strong>
                  <p>
                    Buyer funds are pre-deposited into the Repaido Escrow nodal account before order fulfillment begins. Disbursal occurs within 48 hours of e-way bill confirmation.
                  </p>
                </div>

                <div className="b2b-scheme-feature-card">
                  <strong>
                    <Building2 size={16} className="text-blue-600" />
                    Scheme 3: Contractor Tender Pipeline
                  </strong>
                  <p>
                    Over 500 verified government and private civil/MEP contractors rely on Repaido to procure bulk materials for tender execution across all 30 districts of Odisha.
                  </p>
                </div>

                <div className="b2b-scheme-feature-card">
                  <strong>
                    <Truck size={16} className="text-sky-600" />
                    Scheme 4: Subsidized Cargo Freight
                  </strong>
                  <p>
                    Heavy commercial consignments benefit from Repaido's bulk freight partner rates across Balasore, Cuttack, Bhubaneswar, Rourkela and Sambalpur.
                  </p>
                </div>
              </div>

              <div className="b2b-schemes-cta">
                <button
                  type="button"
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  onClick={() => setShowSchemesModal(false)}
                >
                  Close
                </button>
                <button
                  type="button"
                  className="px-5 py-2 bg-[#142858] hover:bg-[#0f2048] text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm"
                  onClick={() => {
                    setShowSchemesModal(false);
                    setActiveSubTab('browse');
                  }}
                >
                  <Boxes size={14} />
                  Explore Wholesale Deals
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PDF QUOTATION MODAL */}
      {viewingQuotation && (
        <B2BQuotationPdfModal
          quotation={viewingQuotation}
          onClose={() => setViewingQuotation(null)}
          onAccept={handleAcceptQuote}
          isBuyer={true}
        />
      )}
    </div>
  );
};
