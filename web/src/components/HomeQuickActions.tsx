import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  ShoppingBag,
  Smartphone,
  Laptop,
  Watch,
  Refrigerator,
  Wrench,
  Users,
  House,
  Plus,
  Recycle,
  ShieldCheck,
  CheckCircle2,
  Sparkles,
  Zap,
  Truck,
  Check,
  Star,
  Tv,
  Headphones,
  SlidersHorizontal,
  Flame,
  Clock,
  BadgePercent
} from 'lucide-react';
import type { Service } from '../types';
import { formatMoney } from '../data';
import { Modal } from './ui';
import RepaidoBrand from './RepaidoBrand';
import ServiceImage from './ServiceImage';
import { cartService } from '../services/cartService';
import './home-quick-actions.css';

export type QuickMarket = { condition?: 'refurbished'; search?: string; budget?: number; sell?: boolean };

export interface HomeQuickActionsProps {
  services: Service[];
  onMarket: (section: 'spares' | 'preowned', options?: QuickMarket) => void;
  onHire: () => void;
  onHome: (service: string) => void;
  onService: (service: Service) => void;
  onCatalogue: () => void;
  onOpenCart?: () => void;
}

interface PreownedItem {
  id: string;
  name: string;
  category: 'phone' | 'laptop' | 'appliance' | 'audio' | 'tools';
  condition: string;
  price: number;
  mrp: number;
  image: string;
  verifiedOwner: string;
  location: string;
  warranty: string;
}

interface RefurbishedItem {
  id: string;
  name: string;
  category: 'phone' | 'laptop' | 'watch' | 'appliance';
  grade: string;
  price: number;
  mrp: number;
  image: string;
  warranty: string;
  batteryHealth?: string;
  emiMonthly: number;
}

const PREOWNED_CATALOG: PreownedItem[] = [
  {
    id: 'pre-iphone-13',
    name: 'Apple iPhone 13 (Midnight, 128GB)',
    category: 'phone',
    condition: 'Like New (Flawless)',
    price: 36999,
    mrp: 59900,
    image: '/images/appliance.svg',
    verifiedOwner: 'Debasish P. · Verified Owner',
    location: 'Mallikashpur, Balasore',
    warranty: '7-Day Repaido Escrow Return'
  },
  {
    id: 'pre-dell-7490',
    name: 'Dell Latitude 7490 Core i7 (16GB RAM / 512GB SSD)',
    category: 'laptop',
    condition: 'Excellent (Inspected)',
    price: 18499,
    mrp: 45000,
    image: '/images/appliance.svg',
    verifiedOwner: 'Sourav M. · Corporate Surplus',
    location: 'Station Road, Balasore',
    warranty: 'Repaido Hardware Tested'
  },
  {
    id: 'pre-sony-xm4',
    name: 'Sony WH-1000XM4 Active Noise Cancelling Headphones',
    category: 'audio',
    condition: 'Like New (With Box)',
    price: 13999,
    mrp: 26990,
    image: '/images/appliance.svg',
    verifiedOwner: 'Priyanka D. · Verified Owner',
    location: 'FM Golai, Balasore',
    warranty: 'Original Bill Available'
  },
  {
    id: 'pre-bosch-wash',
    name: 'Bosch 7kg Fully Automatic Front Load Washing Machine',
    category: 'appliance',
    condition: 'Very Good (Tested)',
    price: 14500,
    mrp: 35000,
    image: '/images/appliance.svg',
    verifiedOwner: 'Alok K. · Relocation Sale',
    location: 'OT Road, Balasore',
    warranty: 'Technician Verified Motor'
  },
  {
    id: 'pre-samsung-tv',
    name: 'Samsung 43-inch Crystal 4K Smart UHD TV',
    category: 'appliance',
    condition: 'Flawless Panel',
    price: 17999,
    mrp: 38900,
    image: '/images/appliance.svg',
    verifiedOwner: 'Ranjan S. · Upgrading Setup',
    location: 'Remuna Golei, Balasore',
    warranty: '7-Day Screen Guarantee'
  },
  {
    id: 'pre-bosch-drill',
    name: 'Bosch Professional GSB 500W Impact Drill Kit',
    category: 'tools',
    condition: 'Like New (Barely Used)',
    price: 1899,
    mrp: 3500,
    image: '/images/appliance.svg',
    verifiedOwner: 'Manas R. · DIY Hobbyist',
    location: 'Sahadevkhunta, Balasore',
    warranty: 'All Bits & Case Included'
  }
];

const REFURBISHED_CATALOG: RefurbishedItem[] = [
  {
    id: 'ref-apple-watch-7',
    name: 'Apple Watch Series 7 GPS 45mm (Midnight)',
    category: 'watch',
    grade: 'Grade A+ Certified',
    price: 14999,
    mrp: 41900,
    image: '/images/appliance.svg',
    warranty: '6 Months Repaido Direct Warranty',
    batteryHealth: '94% Battery Health',
    emiMonthly: 1250
  },
  {
    id: 'ref-oneplus-10pro',
    name: 'OnePlus 10 Pro 5G (Emerald Forest, 8GB/128GB)',
    category: 'phone',
    grade: 'Factory Reconditioned',
    price: 22499,
    mrp: 66999,
    image: '/images/appliance.svg',
    warranty: '6 Months Replacement Warranty',
    batteryHealth: '100% Tested Cell',
    emiMonthly: 1875
  },
  {
    id: 'ref-hp-elitebook',
    name: 'HP EliteBook 840 G6 Core i5 8th Gen (16GB / 256GB SSD)',
    category: 'laptop',
    grade: 'Grade A Business Refurbished',
    price: 15999,
    mrp: 58000,
    image: '/images/appliance.svg',
    warranty: '1 Year Hardware & Battery Warranty',
    batteryHealth: 'Original HP Power Adapter',
    emiMonthly: 1333
  },
  {
    id: 'ref-voltas-ac',
    name: 'Voltas 1.5 Ton 3-Star Inverter Split AC (Copper Condenser)',
    category: 'appliance',
    grade: 'Factory Recertified',
    price: 19999,
    mrp: 38500,
    image: '/images/appliance.svg',
    warranty: '1 Year Complete + 5 Year Compressor',
    batteryHealth: 'Fresh R32 Gas Top-Up',
    emiMonthly: 1666
  },
  {
    id: 'ref-mi-vacuum',
    name: 'Xiaomi Mi Robot Vacuum Mop 2 Pro (Smart LiDAR Navigation)',
    category: 'appliance',
    grade: 'Certified Like New',
    price: 11999,
    mrp: 29999,
    image: '/images/appliance.svg',
    warranty: '6 Months Motor & Battery Warranty',
    batteryHealth: 'All Accessories Replaced New',
    emiMonthly: 1000
  },
  {
    id: 'ref-portronics-bar',
    name: 'Portronics Pure Sound 1 Pro 60W Bluetooth Soundbar',
    category: 'appliance',
    grade: 'Factory Box Pack',
    price: 1499,
    mrp: 4999,
    image: '/images/appliance.svg',
    warranty: '6 Months Warranty',
    batteryHealth: 'Optical & AUX Compatible',
    emiMonthly: 250
  }
];

export default function HomeQuickActions({
  services,
  onMarket,
  onHire,
  onHome,
  onService,
  onCatalogue,
  onOpenCart
}: HomeQuickActionsProps) {
  const [panel, setPanel] = useState<'used' | 'refurbished' | 'hire' | 'repair' | 'home' | null>(null);
  const rail = useRef<HTMLElement>(null);
  const [frame, setFrame] = useState(0);
  const [engaged, setEngaged] = useState(false);
  const [visible, setVisible] = useState(false);

  // Used panel states
  const [usedMode, setUsedMode] = useState<'buy' | 'sell'>('buy');
  const [usedCategory, setUsedCategory] = useState<string>('all');
  const [sellCategory, setSellCategory] = useState<string>('phone');
  const [sellAge, setSellAge] = useState<string>('under_1');
  const [sellCondition, setSellCondition] = useState<string>('good');
  const [sellSubmitted, setSellSubmitted] = useState(false);

  // Refurbished panel states
  const [refurbBudget, setRefurbBudget] = useState<number>(0);
  const [refurbCategory, setRefurbCategory] = useState<string>('all');

  // Hire panel states
  const [hireCategory, setHireCategory] = useState<string>('electrician');

  // Fast cart toast notification
  const [addedItemName, setAddedItemName] = useState<string | null>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.3 });
    if (rail.current) observer.observe(rail.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || engaged || panel) return;
    const timer = setInterval(() => {
      if (
        !document.hidden &&
        !matchMedia('(prefers-reduced-motion: reduce)').matches &&
        !document.documentElement.classList.contains('reduce-motion')
      ) {
        setFrame(v => v + 1);
      }
    }, 3600);
    return () => clearInterval(timer);
  }, [visible, engaged, panel]);

  const go = (action: () => void) => {
    setPanel(null);
    action();
  };

  const handleInstantBuy = (item: { id: string; name: string; price: number; image: string; category?: string }) => {
    cartService.addItem({
      id: item.id,
      title: item.name,
      price_paise: Math.round(item.price * 100),
      image_url: item.image,
      shop_id: 'repaido-verified-market',
      shop_name: 'Repaido Verified Store',
      category: item.category || 'electronics',
      condition: 'refurbished',
      stock: 3
    }, 1);

    setAddedItemName(item.name);
    setTimeout(() => {
      setPanel(null);
      setAddedItemName(null);
      onOpenCart?.();
    }, 350);
  };

  const calculateSellQuote = () => {
    let base = 4000;
    if (sellCategory === 'phone') base = 6500;
    else if (sellCategory === 'laptop') base = 12000;
    else if (sellCategory === 'tv') base = 7500;
    else if (sellCategory === 'appliance') base = 5000;

    let ageFactor = 0.85;
    if (sellAge === 'under_1') ageFactor = 1.0;
    else if (sellAge === '1_to_2') ageFactor = 0.75;
    else ageFactor = 0.55;

    let condFactor = 0.9;
    if (sellCondition === 'flawless') condFactor = 1.15;
    else if (sellCondition === 'good') condFactor = 0.95;
    else condFactor = 0.7;

    return Math.round(base * ageFactor * condFactor);
  };

  const titles = {
    used: 'Verified Pre-Owned Marketplace & Sell',
    refurbished: 'Certified Refurbished Tech & Appliances',
    hire: 'Direct Specialist Dispatch · Verified Pros',
    repair: 'Fast Problem Triage & Price Estimator',
    home: 'Repaido Home Living & Festive Makeover'
  };

  const tiles = [
    {
      id: 'used' as const,
      label: 'Buy / sell used',
      Icon: ShoppingBag,
      saleTag: '🔥 UP TO 55% OFF',
      notes: ['Direct from verified owners', '7-day escrow protection', 'Doorstep pickup & cash']
    },
    {
      id: 'refurbished' as const,
      label: 'Refurbished',
      Icon: Recycle,
      saleTag: '🛡️ 6-MO WARRANTY',
      notes: ['32-point inspection check', 'Zero-cost EMI available', 'Free delivery above ₹999']
    },
    {
      id: 'hire' as const,
      label: 'Quick hire',
      Icon: Users,
      saleTag: '⭐ 4.9★ RATED PROS',
      notes: ['Aadhaar & police vetted', 'Flat ₹149 inspection rate', 'Live technician tracking']
    },
    {
      id: 'repair' as const,
      label: 'Quick repair',
      Icon: Wrench,
      saleTag: '⚡ 30-MIN DISPATCH',
      notes: ['Fast doorstep fault fix', 'Genuine OEM spare parts', 'Pay after job satisfaction']
    },
    {
      id: 'home' as const,
      label: 'Home premium',
      Icon: House,
      saleTag: '✨ PUJA READY OFFERS',
      notes: ['Complete decor & interiors', 'Modular kitchen renovation', 'Full site supervision']
    }
  ];

  const filteredUsed = PREOWNED_CATALOG.filter(
    item => usedCategory === 'all' || item.category === usedCategory
  );

  const filteredRefurb = REFURBISHED_CATALOG.filter(item => {
    const matchCat = refurbCategory === 'all' || item.category === refurbCategory;
    const matchBudget = refurbBudget === 0 || item.price <= refurbBudget;
    return matchCat && matchBudget;
  });

  return (
    <>
      {/* ===== HORIZONTAL QUICK ACTION RAIL ===== */}
      <nav
        ref={rail}
        className="home-quick-rail"
        aria-label="Quick actions"
        onMouseEnter={() => setEngaged(true)}
        onMouseLeave={() => setEngaged(false)}
        onFocusCapture={() => setEngaged(true)}
        onBlurCapture={e => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEngaged(false);
        }}
      >
        {tiles.map(({ id, label, Icon, saleTag, notes }) => (
          <button key={id} data-action={id} aria-label={`${label} - ${saleTag}`} onClick={() => setPanel(id)}>
            <div className="quick-tile-header">
              <span className="quick-sale-badge" aria-hidden="true">
                <Flame size={10} className="quick-badge-flame" />
                {saleTag}
              </span>
            </div>

            <div className="quick-tile-main">
              <span className="quick-tile-icon">
                <Icon size={19} strokeWidth={2.4} aria-hidden="true" />
              </span>

              <span className="quick-tile-copy">
                <strong>{label}</strong>
                <span className="quick-tile-note" aria-hidden="true">
                  <span key={frame}>{notes[frame % notes.length]}</span>
                </span>
              </span>

              <span className="quick-tile-arrow">
                <ArrowRight size={13} aria-hidden="true" />
              </span>
            </div>
          </button>
        ))}
      </nav>

      {/* ===== DEDICATED QUICK DISCOVERY & CHECKOUT PANELS ===== */}
      {panel && (
        <Modal
          title={titles[panel]}
          className={`quick-action-modal quick-panel-${panel}`}
          onClose={() => setPanel(null)}
        >
          <div className="quick-modal-header-brand">
            <RepaidoBrand size="sm" />
            <span className="quick-modal-tagline">Fast Discovery · Direct Checkout</span>
          </div>

          {/* ===== 1. PRE-OWNED USED ITEMS PANEL ===== */}
          {panel === 'used' && (
            <div className="quick-dedicated-container">
              {/* Mode Toggle */}
              <div className="quick-mode-segmented-bar" role="tablist">
                <button
                  role="tab"
                  aria-selected={usedMode === 'buy'}
                  className={`quick-seg-btn ${usedMode === 'buy' ? 'active' : ''}`}
                  onClick={() => setUsedMode('buy')}
                >
                  <ShoppingBag size={14} /> Buy Verified Used
                </button>
                <button
                  role="tab"
                  aria-selected={usedMode === 'sell'}
                  className={`quick-seg-btn ${usedMode === 'sell' ? 'active' : ''}`}
                  onClick={() => setUsedMode('sell')}
                >
                  <Zap size={14} /> Instant 60s Sell Valuation
                </button>
              </div>

              {usedMode === 'buy' ? (
                <>
                  {/* Category Pills */}
                  <div className="quick-filter-pills-row" role="region" aria-label="Product categories">
                    {[
                      { id: 'all', label: 'All Items' },
                      { id: 'phone', label: 'Phones' },
                      { id: 'laptop', label: 'Laptops' },
                      { id: 'appliance', label: 'Appliances' },
                      { id: 'audio', label: 'Audio & Gadgets' },
                      { id: 'tools', label: 'Power Tools' }
                    ].map(c => (
                      <button
                        key={c.id}
                        className={`quick-pill ${usedCategory === c.id ? 'active' : ''}`}
                        onClick={() => setUsedCategory(c.id)}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>

                  {/* Trust Pill */}
                  <div className="quick-trust-banner">
                    <ShieldCheck size={16} className="text-emerald-500" />
                    <span>Inspected hardware · 7-day money-back escrow · Doorstep verification PIN</span>
                  </div>

                  {/* Product Cards */}
                  <div className="quick-products-grid">
                    {filteredUsed.map(item => {
                      const discount = Math.round(((item.mrp - item.price) / item.mrp) * 100);
                      return (
                        <div key={item.id} className="quick-product-card">
                          <div className="quick-product-thumb-wrap">
                            <img src={item.image} alt={item.name} className="quick-product-thumb" />
                            <span className="quick-condition-badge">{item.condition}</span>
                          </div>
                          <div className="quick-product-info">
                            <h4 className="quick-product-title">{item.name}</h4>
                            <p className="quick-product-seller">{item.verifiedOwner}</p>
                            <div className="quick-product-pricing">
                              <span className="quick-price">{formatMoney(item.price)}</span>
                              <span className="quick-mrp">{formatMoney(item.mrp)}</span>
                              <span className="quick-discount-chip">{discount}% OFF</span>
                            </div>
                            <button
                              className="quick-buy-now-btn"
                              onClick={() => handleInstantBuy(item)}
                            >
                              <ShoppingBag size={14} /> Buy Now & Checkout
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="quick-modal-footer-nav">
                    <button className="quick-secondary-link" onClick={() => go(() => onMarket('preowned'))}>
                      Open full community marketplace <ArrowRight size={14} />
                    </button>
                  </div>
                </>
              ) : (
                /* Instant Sell Valuation Tool */
                <div className="quick-sell-estimator-card">
                  <h3>Get Instant Doorstep Cash Quote</h3>
                  <p>Choose your gadget details for an upfront cash offer with free home pickup.</p>

                  <div className="quick-form-group">
                    <label>Select Device Category</label>
                    <div className="quick-tile-selector-grid">
                      {[
                        { id: 'phone', label: 'Smartphone', Icon: Smartphone },
                        { id: 'laptop', label: 'Laptop', Icon: Laptop },
                        { id: 'tv', label: 'Smart TV', Icon: Tv },
                        { id: 'appliance', label: 'Appliance', Icon: Refrigerator }
                      ].map(d => (
                        <button
                          key={d.id}
                          className={`quick-dev-btn ${sellCategory === d.id ? 'active' : ''}`}
                          onClick={() => setSellCategory(d.id)}
                        >
                          <d.Icon size={18} />
                          <span>{d.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="quick-form-grid-2">
                    <div className="quick-form-group">
                      <label>Device Age</label>
                      <select value={sellAge} onChange={e => setSellAge(e.target.value)}>
                        <option value="under_1">Under 1 Year Old</option>
                        <option value="1_to_2">1 to 2 Years Old</option>
                        <option value="above_2">Above 2 Years Old</option>
                      </select>
                    </div>

                    <div className="quick-form-group">
                      <label>Condition</label>
                      <select value={sellCondition} onChange={e => setSellCondition(e.target.value)}>
                        <option value="flawless">Flawless (No Scratches)</option>
                        <option value="good">Good (Minor Signs of Use)</option>
                        <option value="fair">Fair (Visible Scratches / Dent)</option>
                      </select>
                    </div>
                  </div>

                  <div className="quick-valuation-box">
                    <div className="quick-valuation-left">
                      <small>Guaranteed Cash Payout</small>
                      <strong>{formatMoney(calculateSellQuote())}</strong>
                      <span>Spot payment upon doorstep pickup</span>
                    </div>
                    <button
                      className="quick-confirm-sell-btn"
                      disabled={sellSubmitted}
                      onClick={() => {
                        setSellSubmitted(true);
                        setTimeout(() => {
                          setPanel(null);
                          setSellSubmitted(false);
                          go(() => onMarket('preowned', { sell: true }));
                        }, 900);
                      }}
                    >
                      {sellSubmitted ? (
                        <>
                          <Check size={16} /> Pickup Scheduled!
                        </>
                      ) : (
                        <>
                          <Truck size={16} /> Request Free Pickup
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ===== 2. CERTIFIED REFURBISHED PANEL ===== */}
          {panel === 'refurbished' && (
            <div className="quick-dedicated-container">
              {/* Trust & Guarantee Banner */}
              <div className="quick-refurb-hero-banner">
                <div className="quick-refurb-badge">
                  <ShieldCheck size={18} /> 100% Repaido Certified
                </div>
                <h3>32-Point Quality Inspected with 6-Month Warranty</h3>
                <p>Grade A+ certified tech with authentic parts, battery health check, and free delivery.</p>
              </div>

              {/* Budget Quick Filters */}
              <div className="quick-budget-chips-row" role="region" aria-label="Budget filters">
                <span className="quick-budget-label">
                  <SlidersHorizontal size={13} /> Budget:
                </span>
                {[
                  { budget: 0, label: 'All Tech' },
                  { budget: 2000, label: 'Under ₹2,000' },
                  { budget: 5000, label: 'Under ₹5,000' },
                  { budget: 15000, label: 'Under ₹15,000' },
                  { budget: 25000, label: 'Flagship' }
                ].map(b => (
                  <button
                    key={b.budget}
                    className={`quick-pill ${refurbBudget === b.budget ? 'active' : ''}`}
                    onClick={() => setRefurbBudget(b.budget)}
                  >
                    {b.label}
                  </button>
                ))}
              </div>

              {/* Product Grid */}
              <div className="quick-products-grid">
                {filteredRefurb.map(item => {
                  const discount = Math.round(((item.mrp - item.price) / item.mrp) * 100);
                  return (
                    <div key={item.id} className="quick-product-card quick-refurb-card">
                      <div className="quick-product-thumb-wrap">
                        <img src={item.image} alt={item.name} className="quick-product-thumb" />
                        <span className="quick-grade-badge">{item.grade}</span>
                      </div>
                      <div className="quick-product-info">
                        <h4 className="quick-product-title">{item.name}</h4>
                        <div className="quick-refurb-specs">
                          <span>
                            <ShieldCheck size={12} /> {item.warranty}
                          </span>
                          {item.batteryHealth && (
                            <span>
                              <Zap size={12} /> {item.batteryHealth}
                            </span>
                          )}
                        </div>
                        <div className="quick-product-pricing">
                          <span className="quick-price">{formatMoney(item.price)}</span>
                          <span className="quick-mrp">{formatMoney(item.mrp)}</span>
                          <span className="quick-discount-chip">{discount}% OFF</span>
                        </div>
                        <p className="quick-emi-note">Or {formatMoney(item.emiMonthly)}/mo with No-Cost EMI</p>
                        <button
                          className="quick-buy-now-btn quick-refurb-buy-btn"
                          onClick={() => handleInstantBuy(item)}
                        >
                          <ShoppingBag size={14} /> Add to Cart & Checkout
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="quick-modal-footer-nav">
                <button
                  className="quick-secondary-link"
                  onClick={() => go(() => onMarket('spares', { condition: 'refurbished' }))}
                >
                  Browse all certified refurbished catalogue <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}

          {/* ===== 3. QUICK HIRE PANEL ===== */}
          {panel === 'hire' && (
            <div className="quick-dedicated-container">
              <div className="quick-hire-hero-bar">
                <div className="quick-hire-stat">
                  <strong>4.9 ★</strong>
                  <span>Average Pro Rating</span>
                </div>
                <div className="quick-hire-stat">
                  <strong>25-35m</strong>
                  <span>Fast Arrival SLA</span>
                </div>
                <div className="quick-hire-stat">
                  <strong>₹149</strong>
                  <span>Flat Doorstep Rate</span>
                </div>
              </div>

              <div className="quick-category-tab-rail">
                {[
                  { id: 'electrician', label: 'Electrician' },
                  { id: 'plumber', label: 'Plumber' },
                  { id: 'ac', label: 'AC Engineer' },
                  { id: 'carpenter', label: 'Carpenter' },
                  { id: 'cleaning', label: 'Home Maid & Cleaning' }
                ].map(t => (
                  <button
                    key={t.id}
                    className={`quick-pill ${hireCategory === t.id ? 'active' : ''}`}
                    onClick={() => setHireCategory(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="quick-pro-preview-list">
                {[
                  {
                    name: 'Bhabani Shankar Behera',
                    trade: 'Senior Electrical Specialist',
                    rating: '4.95',
                    jobs: '312 completed',
                    badge: 'Repaido Certified Pro',
                    verified: true
                  },
                  {
                    name: 'Rajendra Kumar Patra',
                    trade: 'Master Plumber & Pipe Engineer',
                    rating: '4.92',
                    jobs: '248 completed',
                    badge: 'Specialist Level 2',
                    verified: true
                  },
                  {
                    name: 'Tapan Kumar Mohapatra',
                    trade: 'Inverter AC & HVAC Technician',
                    rating: '4.88',
                    jobs: '184 completed',
                    badge: 'Verified Contractor',
                    verified: true
                  }
                ].map(pro => (
                  <div key={pro.name} className="quick-pro-card">
                    <div className="quick-pro-avatar">
                      <Users size={22} />
                    </div>
                    <div className="quick-pro-details">
                      <h4>{pro.name}</h4>
                      <p>{pro.trade}</p>
                      <div className="quick-pro-meta">
                        <span className="quick-pro-rating">
                          <Star size={11} fill="#eab308" color="#eab308" /> {pro.rating}
                        </span>
                        <span>{pro.jobs}</span>
                        <span className="quick-pro-badge">{pro.badge}</span>
                      </div>
                    </div>
                    <button className="quick-pro-book-btn" onClick={() => go(onHire)}>
                      Book Visit <ArrowRight size={13} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="quick-modal-footer-nav">
                <button className="quick-secondary-link" onClick={() => go(onHire)}>
                  Compare all local verified professionals <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}

          {/* ===== 4. QUICK REPAIR PANEL ===== */}
          {panel === 'repair' && (
            <div className="quick-dedicated-container">
              <div className="quick-repair-triage-header">
                <h3>What is the issue?</h3>
                <p>Tap a symptom for instant transparent diagnosis quote and technician arrival.</p>
              </div>

              <div className="quick-symptoms-grid">
                {[
                  { title: 'AC Not Cooling', category: 'ac', est: '₹299 + Gas/Parts', time: '35 mins' },
                  { title: 'Water Pipe Leakage', category: 'plumber', est: '₹199 + Fitting', time: '25 mins' },
                  { title: 'Switchboard / MCB Trip', category: 'electrician', est: '₹149 + Breaker', time: '20 mins' },
                  { title: 'Washing Machine Spin Fail', category: 'appliance', est: '₹249 + Belt', time: '40 mins' },
                  { title: 'Ceiling Fan Slow / Wobble', category: 'electrician', est: '₹149 + Cap', time: '20 mins' },
                  { title: 'RO Water Purifier Filter', category: 'plumber', est: '₹199 + Filter', time: '30 mins' }
                ].map(symptom => {
                  const matchingSvc = services.find(s => s.category === symptom.category) || services[0];
                  return (
                    <button
                      key={symptom.title}
                      className="quick-symptom-card"
                      onClick={() => {
                        if (matchingSvc) go(() => onService(matchingSvc));
                        else go(onCatalogue);
                      }}
                    >
                      <div className="quick-symptom-top">
                        <Wrench size={16} />
                        <span className="quick-eta-badge">
                          <Clock size={11} /> {symptom.time}
                        </span>
                      </div>
                      <strong>{symptom.title}</strong>
                      <div className="quick-symptom-footer">
                        <span>{symptom.est}</span>
                        <ArrowRight size={13} />
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="quick-modal-footer-nav">
                <button className="quick-secondary-link" onClick={() => go(onCatalogue)}>
                  Browse all 40+ repair services catalogue <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}

          {/* ===== 5. REPAIDO HOME LIVING PANEL ===== */}
          {panel === 'home' && (
            <div className="quick-dedicated-container">
              <div className="quick-home-promo-card">
                <img
                  className="quick-home-cover-img"
                  src="/images/puja-ready-home.jpg"
                  alt="A welcoming decorated living room ready for festive occasions"
                />
                <div className="quick-home-cover-overlay">
                  <span className="quick-home-fest-tag">
                    <Sparkles size={12} /> Durga Puja Special
                  </span>
                  <h3>Make Your Home Ready for Maa Durga</h3>
                  <p>All-in-one painting, deep sanitation, lighting & festive decor packages.</p>
                </div>
              </div>

              <div className="quick-home-packages-grid">
                {[
                  { id: 'interior-design', title: 'Modular Interiors & Lighting', desc: 'Custom designs with 3D preview & installation' },
                  { id: 'renovation', title: 'Full Home / Kitchen Renovation', desc: 'Civil, plumbing & carpentry with certified supervisors' },
                  { id: 'decor', title: 'Festive Painting & Deep Decor', desc: 'Asian Paints certified painters with dust-free sanding' }
                ].map(pkg => (
                  <div key={pkg.id} className="quick-home-pkg-card">
                    <div className="quick-home-pkg-left">
                      <House size={18} />
                      <div>
                        <strong>{pkg.title}</strong>
                        <p>{pkg.desc}</p>
                      </div>
                    </div>
                    <button className="quick-home-select-btn" onClick={() => go(() => onHome(pkg.id))}>
                      Explore <ArrowRight size={13} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="quick-modal-footer-nav">
                <button className="quick-secondary-link" onClick={() => go(() => onHome(''))}>
                  View all Repaido Home architectural services <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* Instant Cart Added Notification Toast */}
      {addedItemName && (
        <div className="quick-cart-toast" role="status" aria-live="polite">
          <CheckCircle2 size={18} className="text-emerald-400" />
          <span>Added &ldquo;{addedItemName}&rdquo; to Cart! Opening checkout…</span>
        </div>
      )}
    </>
  );
}
