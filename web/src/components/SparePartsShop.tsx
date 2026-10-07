import {CustomerCartDrawer} from './CustomerCartDrawer';
import MarketOpportunities from './MarketOpportunities';
import type {QuickMarket} from './HomeQuickActions';
import {Marketplace} from './Marketplace';
import {RentalMarket} from './Rentals';
import { apiFetch,apiAssetUrl } from '../services/api';
import {opportunityDetails} from '../services/repaidiansService';
import type {OpportunityReference} from '../types/repaidians';
import { cartService } from '../services/cartService';
import React, { useState, useEffect, useRef } from 'react';
import {
  ShoppingBag,
  Search,
  Filter,
  ShieldCheck,
  CheckCircle2,
  Trash2,
  MapPin,
  CreditCard,
  Truck,
  ArrowRight,
  Package,
  Layers,
  Wind,
  Droplets,
  Zap,
  Cpu,
  Wrench,
  Star,
  Sparkles,
  SlidersHorizontal,
  ChevronRight,
  Tag,
  Check,
  X,
  BadgePercent,
  Repeat2,
  Store,
  Laptop,
  Smartphone,
  RotateCcw,
  Award,
  Share2
} from 'lucide-react';
import './refurbished-market.css';
import type { SparePartProduct, SpareCartItem, SparePartCategory } from '../types';
import { Modal } from './ui';
import {PrimeBadge,RefurbishmentDetails} from './ShopPrime';
import './shop-prime.css';
import { formatMoney } from '../data';

interface SparePartsShopProps {
  onContracts?:()=>void;
  quickIntent?:QuickMarket;
  onBackToExplore?: () => void;
  authToken?: string;
  onSignIn?:()=>void;
  onShare?:(reference:OpportunityReference)=>void;
  initialSection?: StoreSection;
  onSectionChange?: (sec: StoreSection) => void;
}

export type StoreSection = 'spares' | 'refurbished' | 'rentals' | 'exchange' | 'preowned';
export type SparesConditionFilter = 'all' | 'new' | 'refurbished';

export const SparePartsShop: React.FC<SparePartsShopProps> = ({ onContracts,onBackToExplore, authToken, onSignIn,onShare, initialSection, onSectionChange,quickIntent }) => {
  const [sellLaunch,setSellLaunch]=useState(0);
  const [section, setSectionState] = useState<StoreSection>(initialSection || 'spares');
  const setSection = (sec: StoreSection) => {
    setSectionState(sec);
    setSelectedCategory('all');setRefurbishedGrade('all');
    onSectionChange?.(sec);
    requestAnimationFrame(()=>alignMarketSection(sec));
  };
  useEffect(() => {
    if (initialSection) {
      setSectionState(initialSection);
    }
  }, [initialSection]);
  const sectionNavRef = useRef<HTMLElement>(null);
  const alignMarketSection = (selected: StoreSection, animate=true) => {
    const nav=sectionNavRef.current;
    if(!nav||getComputedStyle(nav).display!=='flex')return;
    const button=nav.querySelector<HTMLElement>(`#tab-${selected}`);
    const last=nav.querySelector<HTMLElement>('.stores-nav-pill:last-child');
    if(!button||!last)return;
    const style=getComputedStyle(nav),padding=parseFloat(style.paddingLeft)||0,gap=parseFloat(style.columnGap)||0;
    nav.style.setProperty('--market-rail-tail',`${Math.max(0,nav.clientWidth-last.offsetWidth-padding*2-gap)}px`);
    const left=button.getBoundingClientRect().left-nav.getBoundingClientRect().left+nav.scrollLeft-padding;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches||document.documentElement.classList.contains('reduce-motion');
    nav.scrollTo({left:Math.max(0,left),behavior:animate&&!reduced?'smooth':'instant'});
  };
  useEffect(()=>{
    const nav=sectionNavRef.current;if(!nav)return;
    const observer=new ResizeObserver(()=>{const selected=nav.querySelector('[aria-selected="true"]')?.id.replace('tab-','') as StoreSection|undefined;if(selected)alignMarketSection(selected,false);});
    observer.observe(nav);const last=nav.querySelector('.stores-nav-pill:last-child');if(last)observer.observe(last);
    return()=>observer.disconnect();
  },[]);
  useEffect(()=>{alignMarketSection(section);},[section]);

  const [detail, setDetail] = useState<SparePartProduct|null>(null);
  const [intentError,setIntentError]=useState('');
  const [shareableProductId,setShareableProductId]=useState<string|null>(null);
  const handledProductId=useRef<string|undefined>(undefined);
  useEffect(()=>{
    let active=true;setShareableProductId(null);
    if(!detail||!onShare||!authToken)return;
    void opportunityDetails({source:'inventory',id:detail.id}).then(card=>{
      if(active&&card.available&&card.shareable)setShareableProductId(detail.id);
    }).catch(()=>{});
    return()=>{active=false;};
  },[detail?.id,onShare,authToken]);
  const [liveShops,setLiveShops]=useState<{id:string;shopName:string;address:string;city:string;lat:number;lng:number}[]>([]);
  const [catalogError,setCatalogError]=useState(''),[catalogLoading,setCatalogLoading]=useState(true),[catalogAttempt,setCatalogAttempt]=useState(0);
  const shop = detail ? liveShops.find(s => s.id === detail.shopId) : undefined;
  const address = shop ? [shop.address, shop.city].filter(Boolean).join(', ') : '';
  const hasPin = !!shop && Number.isFinite(shop.lat) && Number.isFinite(shop.lng) && Math.abs(shop.lat)<=90 && Math.abs(shop.lng)<=180 && (shop.lat!==0 || shop.lng!==0);
  const destination = hasPin ? `${shop!.lat},${shop!.lng}` : address;
  const directions = destination ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}` : null;
  const railRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(80);
  useEffect(() => {
    const header = document.querySelector('.repaido-home-header');
    if (!header) return;
    const observer = new ResizeObserver(() => setHeaderHeight(header.getBoundingClientRect().height));
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  const [products, setProducts] = useState<SparePartProduct[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [refurbishedGrade, setRefurbishedGrade] = useState<'all' | 'A+' | 'A' | 'B'>('all');
  const [searchQuery, setSearchQuery] = useState<string>(quickIntent?.search||'');
  const [maxPrice,setMaxPrice]=useState<number|undefined>(quickIntent?.budget);
  const [sortBy, setSortBy] = useState<'popularity' | 'price_low' | 'price_high' | 'newest' | 'discount'>('popularity');
  const [showFilterModal, setShowFilterModal] = useState<boolean>(false);
  const activeFilterCount = (maxPrice!==undefined?1:0) + (refurbishedGrade !== 'all' ? 1 : 0) + (selectedCategory !== 'all' ? 1 : 0) + (sortBy !== 'popularity' ? 1 : 0);
  const [cart, setCart] = useState<SpareCartItem[]>([]);
  const [showCartDrawer, setShowCartDrawer] = useState<boolean>(false);
  const [checkoutStep, setCheckoutStep] = useState<'cart' | 'address' | 'payment' | 'tracking'>('cart');

  // Checkout form fields
  const [deliveryAddress, setDeliveryAddress] = useState<string>('');
  const [recipientName, setRecipientName] = useState<string>('');
  const [recipientPhone, setRecipientPhone] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<'upi' | 'card'>('upi');
  const [paymentError, setPaymentError] = useState('');
  const [activeOrderId, setActiveOrderId] = useState<string>('');

  useEffect(() => {
    let active=true;setCatalogLoading(true);setCatalogError('');
    void apiFetch('/api/operations/products/catalog',{signal:AbortSignal.timeout(15000)},{background:true}).then(async r=>{
      if(!r.ok)throw Error('Shop products could not load. Please retry.');
      const d=await r.json();
      if(!active)return;
      setLiveShops(d.shops.map((s:any)=>({id:s.id,shopName:s.name,address:s.address||'',city:s.city||'',lat:s.location?.lat,lng:s.location?.lng})));
      if (!Array.isArray(d.items)) throw Error('Invalid catalogue response. Please retry.');
      setProducts(d.items.map((p:any)=>({
        id:p.id,shopId:p.shop_id,shopName:d.shops?.find((s:any)=>s.id===p.shop_id)?.name||'',
        name:p.name,partNumber:p.sku,category:p.category,price:p.price_paise/100,
        mrp:p.mrp_paise ? p.mrp_paise/100 : p.price_paise/100,stock:p.stock,
        image:p.image_url?apiAssetUrl(p.image_url):'',condition:p.condition||'new',
        warranty:p.warranty,warrantyMonths:0,refurbishmentDetails:p.refurbishment_details,
        refurbishment:p.refurbishment,refurbishedGrade:p.refurbishment?.grade,prime:p.prime,
        brand:p.brand||'',compatibility:p.compatibility||'',gstRate:p.gst_bps==null?NaN:p.gst_bps/10000,
        status:'approved',description:p.compatibility,lastRestockedAt:new Date(p.stock_confirmed_at*1000).toISOString()
      })));
    }).catch(e=>{if(active){setProducts([]);setLiveShops([]);setCatalogError(e.message||'Products could not load. Please retry.');}
    }).finally(()=>{if(active)setCatalogLoading(false);});
    return()=>{active=false;};
  }, [catalogAttempt]);
  useEffect(()=>{
    const id=quickIntent?.productId;
    if(!id){handledProductId.current=undefined;setIntentError('');return;}
    if(catalogLoading||catalogError||handledProductId.current===id)return;
    handledProductId.current=id;
    const product=products.find(item=>item.id===id&&item.status==='approved'&&item.stock>0);
    if(!product){setDetail(null);setIntentError('This product is no longer available in the live catalogue. Browse another item or retry products.');return;}
    setIntentError('');setDetail(product);
    setSection(product.condition==='refurbished'?'refurbished':'spares');
  },[quickIntent?.productId,products,catalogLoading,catalogError]);

  const standardCategories = [
    { id: 'all', label: section==='refurbished'?'All refurbished':'All spares', icon: Layers },
    { id: 'gadgets', label: 'Gadgets', icon: Sparkles },
    { id: 'smartphones', label: 'Smartphones', icon: Smartphone },
    { id: 'laptops', label: 'Laptops & IT', icon: Laptop },
    { id: 'ac', label: 'AC & Cooling', icon: Wind },
    { id: 'appliance', label: 'Appliances', icon: Cpu },
    { id: 'tools', label: 'Pro Tools', icon: Wrench },
    { id: 'electrician', label: 'Electrical & Wire', icon: Zap },
    { id: 'plumber', label: 'Plumbing & Pipes', icon: Droplets }
  ];

  const handleSelectCategory = (catId:string) => setSelectedCategory(catId);

  // Filtering & Sorting
  const categories=[...standardCategories,...[...new Set(products.filter(p=>(p.condition||'new')===(section==='refurbished'?'refurbished':'new')).map(p=>p.category))].filter(c=>c!=='refurbished'&&!standardCategories.some(s=>s.id===c)).map(c=>({id:c,label:c,icon:Wrench}))];
  const filteredProducts = products.filter(p => {
    if(maxPrice!==undefined&&p.price>maxPrice)return false;
    const cond = (p as any).condition || 'new';
    if (cond !== (section==='refurbished'?'refurbished':'new')) return false;
    if (refurbishedGrade !== 'all') {
      if ((p as any).refurbishedGrade !== refurbishedGrade) return false;
    }
    if (selectedCategory !== 'all') {
      if (p.category !== selectedCategory) return false;
    }
    const matchesQuery =
      !searchQuery ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.brand.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.partNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.compatibility.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesQuery && p.stock > 0;
  });

  const sortedProducts = [...filteredProducts].sort((a, b) => {
    if (sortBy === 'price_low') return a.price - b.price;
    if (sortBy === 'price_high') return b.price - a.price;
    if (sortBy === 'newest') return (b.lastRestockedAt || '').localeCompare(a.lastRestockedAt || '');
    if (sortBy === 'discount') {
      const discA = a.mrp > 0 ? (a.mrp - a.price) / a.mrp : 0;
      const discB = b.mrp > 0 ? (b.mrp - b.price) / b.mrp : 0;
      return discB - discA;
    }
    // Paid Prime placement only applies to Featured, after category filtering.
    return Number(!!b.prime?.active)-Number(!!a.prime?.active) || b.stock-a.stock;
  });

  const addToCart = (product: SparePartProduct) => {
    cartService.addItem({
      id: product.id,
      title: product.name,
      price_paise: Math.round(product.price * 100),
      image_url: product.image,
      shop_id: product.shopId,
      shop_name: product.shopName,
      category: product.category,
      condition: (product as any).condition || 'new',
      stock: product.stock
    }, 1);

    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      if (existing) {
        return prev.map(item =>
          item.product.id === product.id
            ? { ...item, quantity: Math.min(product.stock, item.quantity + 1) }
            : item
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const updateQuantity = (productId: string, delta: number) => {
    cartService.updateQuantity(productId, delta);
    setCart(prev =>
      prev
        .map(item => {
          if (item.product.id === productId) {
            const nextQty = item.quantity + delta;
            return nextQty > 0 ? { ...item, quantity: Math.min(item.product.stock, nextQty) } : null;
          }
          return item;
        })
        .filter((item): item is SpareCartItem => item !== null)
    );
  };

  useEffect(()=>{const sync=()=>setCart(cartService.getItems().flatMap(i=>{const product=products.find(p=>p.id===i.id);return product?[{product,quantity:i.quantity}]:[];}));sync();return cartService.subscribe(sync);},[products]);
  // Pricing Calculations
  const subtotalPaise = cart.reduce((sum, item) => sum + item.product.price * 100 * item.quantity, 0);
  const totalMrpPaise = cart.reduce((sum, item) => sum + (item.product.mrp || item.product.price * 1.3) * 100 * item.quantity, 0);
  const savingsPaise = Math.max(0, totalMrpPaise - subtotalPaise);
  const gstPaise = Math.round(subtotalPaise * 0.18);
  const deliveryPaise = cart.length > 0 ? 0 : 0; // Free delivery like Flipkart Plus / Assured
  const grandTotalPaise = subtotalPaise + gstPaise + deliveryPaise;
  const totalItemsCount = cart.reduce((sum, item) => sum + item.quantity, 0);


  return (
    <div className="spare-parts-shop-container stores-hub-container bg-slate-100/70 text-slate-800 min-h-screen pb-24 text-sm antialiased selection:bg-blue-600 selection:text-white font-sans">
      <div className="stores-mobile-app-shell">
        {/* 1. MASTER STORES HUB HEADER */}
      <header className="stores-hub-header">
        <MarketOpportunities onChoose={kind=>{if(kind==='contracts'){onContracts?.();return;}if(kind==='refurbished'){setSection('refurbished');return;}if(kind==='sell'){setSection('preowned');setSellLaunch(v=>v+1);return;}setSection(kind);}}/>

        <div className="stores-header-actions">
          {totalItemsCount > 0 && (
            <button
              type="button"
              className="stores-cart-pill"
              onClick={() => {
                setCheckoutStep('cart');
                setShowCartDrawer(true);
              }}
              aria-label={`View cart with ${totalItemsCount} items`}
            >
              <ShoppingBag size={16} />
              <span>Cart ({totalItemsCount})</span>
              <span>•</span>
              <span>{formatMoney(subtotalPaise)}</span>
            </button>
          )}
        </div>
      </header>

        {/* 2. REPAIDO 4-PILLAR SEGMENTED NAVIGATION */}
        <div className="stores-segmented-nav-wrap">
          <nav ref={sectionNavRef} className="stores-segmented-nav" role="tablist" aria-label="Market sections" onKeyDown={event=>{const keys=['ArrowLeft','ArrowRight','Home','End'];if(!keys.includes(event.key))return;event.preventDefault();const tabs=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));const current=tabs.indexOf(document.activeElement as HTMLButtonElement);const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(current+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[next].focus();tabs[next].click();}}>
            <button
              type="button"
              role="tab"
              id="tab-spares" tabIndex={section==='spares'?0:-1}
              aria-selected={section === 'spares'}
              aria-controls="panel-spares"
              className={`stores-nav-pill ${section === 'spares' ? 'is-active' : ''}`}
              onClick={() => setSection('spares')}
            >
              <ShoppingBag size={18} className="stores-pill-icon" aria-hidden="true" />
              <div className="stores-pill-text">
                <span className="stores-pill-label">Buy Spares</span>
                <span className="stores-pill-tag">New parts</span>
              </div>
            </button>

            <button type="button" role="tab" id="tab-refurbished" tabIndex={section==='refurbished'?0:-1} aria-selected={section==='refurbished'} aria-controls="panel-refurbished" className={`stores-nav-pill ${section==='refurbished'?'is-active':''}`} onClick={()=>setSection('refurbished')}>
              <RotateCcw size={18} className="stores-pill-icon" aria-hidden="true"/>
              <div className="stores-pill-text"><span className="stores-pill-label">Refurbished</span><span className="stores-pill-tag">A Repaido specialty</span></div>
            </button>

            <button
              type="button"
              role="tab"
              id="tab-rentals" tabIndex={section==='rentals'?0:-1}
              aria-selected={section === 'rentals'}
              aria-controls="panel-rentals"
              className={`stores-nav-pill ${section === 'rentals' ? 'is-active' : ''}`}
              onClick={() => setSection('rentals')}
            >
              <Wrench size={18} className="stores-pill-icon" aria-hidden="true" />
              <div className="stores-pill-text">
                <span className="stores-pill-label">Tool Rentals</span>
                <span className="stores-pill-tag">Pay As You Use</span>
              </div>
            </button>

            <button
              type="button"
              role="tab"
              id="tab-exchange" tabIndex={section==='exchange'?0:-1}
              aria-selected={section === 'exchange'}
              aria-controls="panel-exchange"
              className={`stores-nav-pill ${section === 'exchange' ? 'is-active' : ''}`}
              onClick={() => setSection('exchange')}
            >
              <Repeat2 size={18} className="stores-pill-icon" aria-hidden="true" />
              <div className="stores-pill-text">
                <span className="stores-pill-label">Direct Swap</span>
                <span className="stores-pill-tag">1-to-1 Exchange</span>
              </div>
            </button>

            <button
              type="button"
              role="tab"
              id="tab-preowned" tabIndex={section==='preowned'?0:-1}
              aria-selected={section === 'preowned'}
              aria-controls="panel-preowned"
              className={`stores-nav-pill ${section === 'preowned' ? 'is-active' : ''}`}
              onClick={() => setSection('preowned')}
            >
              <Sparkles size={18} className="stores-pill-icon" aria-hidden="true" />
              <div className="stores-pill-text">
                <span className="stores-pill-label">Pre-Owned</span>
                <span className="stores-pill-tag">Direct Member Sales</span>
              </div>
            </button>
          </nav>
        </div>

      {/* 3. SECTION CONTENT PANELS */}
      {intentError&&<p role="alert" className="prime-placement-note">{intentError}<button type="button" onClick={()=>{handledProductId.current=undefined;setCatalogAttempt(value=>value+1);}}>Retry products</button></p>}
      {(section === 'spares'||section==='refurbished') && (
        <section id={`panel-${section}`} role="tabpanel" aria-labelledby={`tab-${section}`} className="stores-module-container">
          {catalogError && (
            <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between text-xs text-red-700" role="alert">
              <span>{catalogError}</span>
              <button
                type="button"
                className="px-3 py-1 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition-colors"
                onClick={() => setCatalogAttempt(n => n + 1)}
              >
                Retry products
              </button>
            </div>
          )}

          {/* Clean Discovery Dock: Search + Single Filter Button + Cart */}
          <div ref={railRef} className="spare-discovery-dock" style={{top:headerHeight, scrollMarginTop:headerHeight}}>
            <div className="spare-search-row">
              <label className="spare-scoped-search">
                <Search size={18} aria-hidden="true"/>
                <input
                  type="search"
                  value={searchQuery}
                  onChange={e=>setSearchQuery(e.target.value)}
                  aria-label="Search spare parts"
                  placeholder="Search parts by name, model or SKU..."
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="text-slate-400 hover:text-slate-600 p-1"
                    aria-label="Clear search"
                  >
                    <X size={15} />
                  </button>
                )}
              </label>

              {/* SINGLE FILTER BUTTON */}
              <button
                type="button"
                className={`spare-filter-trigger ${activeFilterCount > 0 ? 'is-filtered' : ''}`}
                onClick={() => setShowFilterModal(true)}
                aria-label={`Open filters, ${activeFilterCount} active`}
              >
                <SlidersHorizontal size={17} aria-hidden="true" />
                <span>Filter</span>
                {activeFilterCount > 0 && <span className="spare-filter-badge">{activeFilterCount}</span>}
              </button>

              <button
                className="spare-cart-button"
                type="button"
                aria-label={`View cart, ${totalItemsCount} items`}
                onClick={()=>{setCheckoutStep('cart');setShowCartDrawer(true);}}
              >
                <ShoppingBag size={18}/>
                <span>{totalItemsCount}</span>
              </button>
            </div>
          </div>

          {/* On-Screen Horizontal Category Rail */}
          <div className="spare-category-rail-container">
            <div className="spare-category-rail" role="group" aria-label="Product categories">
              {categories.map(cat => {
                const Icon = cat.icon || Wrench;
                const isSelected = selectedCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    aria-pressed={isSelected}
                    className={`spare-category-rail-btn ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => handleSelectCategory(cat.id)}
                  >
                    <Icon size={14} aria-hidden="true" />
                    <span>{cat.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {section==='refurbished'&&<section className="refurb-introduction" aria-labelledby="refurb-title">
            <div className="refurb-intro-icon"><RotateCcw size={26} aria-hidden="true"/></div>
            <div><span className="prime-eyebrow">A Repaido specialty</span><h2 id="refurb-title">A second life. The details first.</h2><p>Compare shop-declared condition, repairs, test results and cover before you choose.</p></div>
          </section>}
          {sortBy==='popularity'&&sortedProducts.some(p=>p.prime?.active)&&<p className="prime-placement-note">Prime shops receive paid priority in these results. Price and newest sorts follow your selection.</p>}

      {/* 4. Flipkart-Style Product Grid ("more alligned cards with shadowed back") */}
      <main className="max-w-7xl mx-auto p-2 sm:p-4 pt-1 sm:pt-2">
        {catalogLoading?<p role="status" className="prime-placement-note">Loading shop inventory…</p>:catalogError?null:sortedProducts.length === 0 ? (
          <div className="spare-catalog-empty bg-white rounded-xl border border-slate-200 p-12 text-center shadow-md max-w-lg mx-auto space-y-3">
            <Package className="w-12 h-12 text-slate-300 mx-auto" />
            <h3 className="text-sm font-bold text-slate-900">{section==='refurbished'?'No refurbished products available':'No new parts available'}</h3>
            <p className="text-xs text-slate-500">
              Only confirmed shop inventory appears here. Try other filters or check back after shops update their stock.
            </p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory('all');
                setRefurbishedGrade('all');
                setMaxPrice(undefined);
                setSortBy('popularity');
              }}
              className="px-4 py-2 bg-[#2874f0] hover:bg-blue-600 text-white text-xs font-bold rounded-lg shadow-xs transition-colors"
            >
              Reset All Filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 items-stretch">
            {sortedProducts.map(product => {
              const inCart = cart.find(i => i.product.id === product.id);
              const discountPercent =
                product.mrp > product.price
                  ? Math.round(((product.mrp - product.price) / product.mrp) * 100)
                  : 0;

              return (
                <div
                  key={product.id}
                  className="spare-compact-card relative bg-white rounded-xl border border-slate-200/90 shadow-md hover:shadow-xl transition-all duration-200 flex flex-col justify-between overflow-hidden group h-full"
                >
                  <button type="button" className="product-details-trigger" aria-label={`View details for ${product.name}`} aria-haspopup="dialog" onClick={() => setDetail(product)} />
                  
                  {/* Refurbished Badges */}
                  {(product as any).condition === 'refurbished' && (
                    <div className="refurb-product-badge-row">
                      <span className={`refurb-grade-pill ${(product as any).refurbishedGrade === 'A+' ? 'refurb-grade-a-plus' : 'refurb-grade-a'}`}>
                        {(product as any).refurbishedGrade ? `Grade ${product.refurbishedGrade}` : 'Refurbished'}
                      </span>
                      {product.refurbishment&&<span className="refurb-moneyback-pill">{product.refurbishment.return_days>0?`${product.refurbishment.return_days}-day shop returns`:'No shop returns'}</span>}
                    </div>
                  )}

                  <div className="spare-card-summary">
                    {product.image?<img className="spare-card-image" src={product.image} alt="" loading="lazy" />:<Wrench className="spare-card-image" aria-label="Product photo not provided"/>}
                    <div className="spare-card-copy">
                      <h3 title={product.name}>{product.name}</h3><span className="spare-card-seller">{product.shopName}</span><PrimeBadge prime={product.prime}/>
                      <div className="spare-card-price">
                        <strong>{formatMoney(Math.round(product.price*100))}</strong>
                        {discountPercent>0&&<span>{discountPercent}% off</span>}
                      </div>
                      {(product as any).condition === 'refurbished' ? (
                        <div className="text-[10px] text-emerald-700 font-bold flex items-center gap-1 mt-0.5">
                          <CheckCircle2 size={11} className="shrink-0" />
                          <span>{product.refurbishment?product.refurbishment.warranty_days>0?`${product.refurbishment.warranty_days}-day shop warranty`:'No shop warranty':'Open condition details'}</span>
                        </div>
                      ) : (
                        <span className="spare-card-stock">{product.stock} listed in stock</span>
                      )}
                    </div>
                  </div>

                  {/* Card Bottom: Aligned Action Button */}
                  <div className="relative z-10 p-3 pt-0">
                    {inCart ? (
                      <div className="w-full flex items-center justify-between bg-emerald-50 border border-emerald-300 rounded-lg p-1">
                        <button
                          type="button"
                          onClick={() => updateQuantity(product.id, -1)}
                          className="w-7 h-7 bg-white hover:bg-slate-100 text-slate-800 border border-slate-200 rounded font-extrabold text-sm flex items-center justify-center transition-colors shadow-2xs"
                        >
                          -
                        </button>
                        <span className="text-xs font-mono font-extrabold text-emerald-800">
                          {inCart.quantity} in cart
                        </span>
                        <button
                          type="button"
                          onClick={() => updateQuantity(product.id, 1)}
                          className="w-7 h-7 bg-white hover:bg-slate-100 text-slate-800 border border-slate-200 rounded font-extrabold text-sm flex items-center justify-center transition-colors shadow-2xs"
                        >
                          +
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => addToCart(product)}
                        className="w-full py-2 bg-[#2874f0] hover:bg-blue-600 text-white text-xs font-bold rounded-lg shadow-xs transition-all flex items-center justify-center gap-1.5"
                      >
                        <ShoppingBag className="w-3.5 h-3.5" />
                        <span>Add to Cart</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
        </section>
      )}

      {/* RENTALS TAB CONTAINER */}
      {section === 'rentals' && (
        <section id="panel-rentals" role="tabpanel" aria-labelledby="tab-rentals" className="stores-module-container rental-page">
          <RentalMarket onSignIn={onSignIn} />
        </section>
      )}

      {/* EXCHANGE TAB CONTAINER */}
      {section === 'exchange' && (
        <section id="panel-exchange" role="tabpanel" aria-labelledby="tab-exchange" className="stores-module-container">
          <Marketplace mode="exchange" onSignIn={onSignIn} onShare={onShare} />
        </section>
      )}

      {/* PRE-OWNED TAB CONTAINER */}
      {section === 'preowned' && (
        <section id="panel-preowned" role="tabpanel" aria-labelledby="tab-preowned" className="stores-module-container">
          <Marketplace key={`${sellLaunch}-${quickIntent?.listingId||''}`} initialListingId={quickIntent?.listingId} initialLocation={quickIntent?.location} initialSearch={quickIntent?.search} mode="second_hand" onSignIn={onSignIn} onShare={onShare} initialCreate={!!sellLaunch||quickIntent?.sell} />
        </section>
      )}

      {/* 4. UNIFIED FILTER & SORT MODAL */}
      {showFilterModal && (
        <Modal
          title="Filter & Sort Parts"
          onClose={() => setShowFilterModal(false)}
          className="spare-filter-modal"
        >
          <div className="space-y-5 p-1 text-xs">
            {/* Refurbished Condition Grade Group */}
            {section === 'refurbished' && (
              <div className="spare-filter-group">
                <span className="spare-filter-group-title">Shop-declared grade</span>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'all', label: 'All Grades' },
                    { id: 'A+', label: 'Grade A+' },
                    { id: 'A', label: 'Grade A' },
                    { id: 'B', label: 'Grade B' }
                  ].map(grade => (
                    <button
                      key={grade.id}
                      type="button"
                      aria-pressed={refurbishedGrade === grade.id}
                      className={`spare-filter-choice-btn ${refurbishedGrade === grade.id ? 'is-selected' : ''}`}
                      onClick={() => setRefurbishedGrade(grade.id as any)}
                    >
                      {grade.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Category Group */}
            <div className="spare-filter-group">
              <span className="spare-filter-group-title">Category</span>
              <div className="grid grid-cols-2 gap-2 max-h-52 overflow-y-auto pr-1">
                {categories.map(cat => {
                  const Icon = cat.icon;
                  const isSelected = selectedCategory === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      aria-pressed={isSelected}
                      className={`spare-filter-cat-btn ${isSelected ? 'is-selected' : ''}`}
                      onClick={() => setSelectedCategory(cat.id)}
                    >
                      <Icon size={16} aria-hidden="true" />
                      <span className="truncate">{cat.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="market-filter-budget">Maximum price (₹)<input type="number" min="1" max="1000000" step="1" inputMode="numeric" placeholder="Any price" value={maxPrice??''} onChange={e=>setMaxPrice(e.target.value?Number(e.target.value):undefined)}/></label>

            {/* Sort Group */}
            <div className="spare-filter-group">
              <span className="spare-filter-group-title">Sort By</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  { id: 'popularity', label: 'Featured · Prime paid priority' },
                  { id: 'price_low', label: 'Price: Low to High' },
                  { id: 'price_high', label: 'Price: High to Low' },
                  { id: 'newest', label: 'Recently Restocked' },
                  { id: 'discount', label: 'Largest Discount' }
                ].map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    aria-pressed={sortBy === opt.id}
                    className={`spare-filter-sort-btn ${sortBy === opt.id ? 'is-selected' : ''}`}
                    onClick={() => setSortBy(opt.id as any)}
                  >
                    <span>{opt.label}</span>
                    {sortBy === opt.id && <Check size={16} className="text-blue-600" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="market-filter-actions">
              <button
                type="button"
                className="market-filter-reset"
                onClick={() => {
                    setRefurbishedGrade('all');
                  setMaxPrice(undefined);
                  setSelectedCategory('all');
                  setSortBy('popularity');
                }}
              >
                Reset All
              </button>
              <button
                type="button"
                className="ops-primary"
                onClick={() => setShowFilterModal(false)}
              >
                <span>Apply ({sortedProducts.length} Results)</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {detail && <Modal title={detail.name} onClose={() => setDetail(null)} className="spare-product-modal">
        <div className="spare-detail-summary">
          <img src={detail.image} alt="" width={96} height={96} onError={e=>{e.currentTarget.style.display='none';}} />
          <div><p>{detail.brand || 'Brand not listed'}</p><strong>{formatMoney(Math.round(detail.price*100))}</strong>
            {detail.mrp>detail.price && <p>MRP <s>{formatMoney(Math.round(detail.mrp*100))}</s></p>}
            <p>{detail.stock} listed in stock</p></div>
        </div>
        <p>{detail.description || 'No description provided. Check compatibility with the shop before buying.'}</p>
        
        <PrimeBadge prime={detail.prime}/>
        {detail.prime?.active&&<p className="prime-placement-note">This reviewed shop has an active paid Prime membership. The badge does not certify individual product testing. Condition and cover below are declared by the shop.</p>}
        {detail.condition==='refurbished'&&<RefurbishmentDetails details={detail.refurbishment} legacy={detail.refurbishmentDetails}/>}

        <dl className="spare-detail-specs">
          <div><dt>Condition</dt><dd>{(detail as any).condition==='refurbished' ? `Refurbished${detail.refurbishedGrade?` (shop grade ${detail.refurbishedGrade})`:''}` : ((detail as any).condition || 'New')}</dd></div>
          <div><dt>Part number</dt><dd>{detail.partNumber || 'Not listed'}</dd></div>
          <div><dt>Compatibility</dt><dd>{detail.compatibility || 'Confirm with the shop'}</dd></div>
          <div><dt>Warranty</dt><dd>{(detail as any).warranty || (detail.warrantyMonths > 0 ? `${detail.warrantyMonths} months` : 'Not listed')}</dd></div>
          <div><dt>GST rate</dt><dd>{Number.isFinite(detail.gstRate) ? `${Math.round(detail.gstRate * 10000) / 100}%` : 'Confirm with the shop'}</dd></div>
        </dl>
        <section className="spare-detail-store" aria-label="Store location">
          <h3><MapPin size={18} aria-hidden="true"/> {shop?.shopName || detail.shopName || 'Store not listed'}</h3>
          <p>{address || 'The shop address is not available yet.'}</p>
          <p className="spare-detail-note">Catalogue information may change. Confirm stock, compatibility and the final price with the shop before travelling.</p>
          {directions ? <a className="spare-directions" href={directions} target="_blank" rel="noopener noreferrer">Directions to store <ArrowRight size={18} aria-hidden="true"/><span className="sr-only"> (opens Google Maps in a new tab)</span></a> : <p role="status">Directions will be available when the shop adds its location.</p>}
        </section>
        <button type="button" className="ops-primary" disabled={detail.stock<=0} onClick={()=>addToCart(detail)}><ShoppingBag size={16}/> Add to cart</button>
        {shareableProductId===detail.id&&onShare&&<button type="button" className="ops-primary" onClick={()=>onShare({source:'inventory',id:detail.id})}><Share2 size={16}/> Share on Repaidians</button>}
      </Modal>}

      {/* Floating Cart Quick Access Pill (Positioned neatly above bottom nav bar) */}
      {cart.length > 0 && !showCartDrawer && (
        <aside
          className="fixed left-1/2 -translate-x-1/2 w-[calc(100%-24px)] max-w-[560px] bottom-[64px] md:bottom-5 z-40 bg-[#17285c] text-white p-3 rounded-2xl shadow-2xl flex items-center justify-between gap-3 border border-blue-900 animate-in fade-in slide-in-from-bottom-2 duration-200"
          aria-label="Spare parts quick checkout"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-amber-400 text-slate-900 flex items-center justify-center font-extrabold text-xs shrink-0 shadow-xs">
              {totalItemsCount}
            </div>
            <div>
              <div className="text-xs font-bold text-white leading-tight">
                {totalItemsCount} {totalItemsCount === 1 ? 'Part' : 'Parts'} • {formatMoney(subtotalPaise)}
              </div>
              <div className="text-sm text-blue-200 font-medium">Direct shop inventory</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setCheckoutStep('cart');
              setShowCartDrawer(true);
            }}
            className="bg-[#2874f0] hover:bg-blue-600 text-white font-bold text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-xs transition-colors shrink-0"
          >
            <span>View Cart</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </aside>
      )}

      {/* 5. Flipkart-Style Cart & Checkout Drawer */}
      <CustomerCartDrawer isOpen={showCartDrawer} onClose={()=>setShowCartDrawer(false)} onExploreMore={()=>setSection('spares')}/>

        </div>
      </div>
    );
  };
