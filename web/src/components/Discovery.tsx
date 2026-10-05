import ServiceLeaders from './ServiceLeaders';
import {ServiceTerms} from './ServiceTerms';
import ServiceStories from './ServiceStories';
import ServiceImage from './ServiceImage';
import { useEffect, useMemo, useState } from 'react';
import {ArrowRight,Check,ChevronDown,Clock3,MapPin,Minus,Plus,Search,ShieldCheck,SlidersHorizontal,Star,Trash2,X} from 'lucide-react';
import { categories, cities, formatDuration, formatMoney } from '../data';
import type { CartItem, CategoryId, Service } from '../types';
import { Empty, Modal } from './ui';

export function QuantityControl({item, onChange}:{item:CartItem; onChange:(id:string, delta:number)=>void}) {
  return (
    <div className="quantity-stepper" aria-label={`Quantity for ${item.service.name}`}>
      <button
        className="stepper-btn"
        aria-label={`Remove one ${item.service.name}`}
        onClick={() => onChange(item.service.id, -1)}
      >
        <Minus size={15} />
      </button>
      <span className="stepper-count" aria-live="polite">{item.quantity}</span>
      <button
        disabled={item.quantity >= 5}
        className="stepper-btn"
        aria-label={`Add one ${item.service.name}`}
        onClick={() => onChange(item.service.id, 1)}
      >
        <Plus size={15} />
      </button>
    </div>
  );
}

export function ServiceCard({
  service,
  item,
  onAdd,
  onChange,
  onDetails
}: {
  service: Service;
  item?: CartItem;
  onAdd: () => void;
  onChange: (id: string, delta: number) => void;
  onDetails: () => void;
}) {
  const categoryName = categories.find(c => c.id === service.category)?.name || 'Service';
  return <article className="uc-service-card compact-service-card reference-service-card" aria-labelledby={`service-title-${service.id}`}>
    <button className="reference-card-photo" onClick={onDetails} aria-label={`View ${service.name}`}><ServiceImage service={service} className="compact-service-image" decorative/></button>
    <div className="compact-service-main">
      <span className="compact-service-category">{categoryName}</span>
      <h2 id={`service-title-${service.id}`} className="uc-service-title">{service.name}</h2>
      <div className="compact-service-meta"><span><Clock3 size={13} aria-hidden="true"/>{formatDuration(service.duration)}</span>{service.rating!==undefined&&!!service.reviewCount?<span><Star size={13} aria-hidden="true"/>{service.rating.toFixed(1)} ({service.reviewCount})</span>:<span>New · no reviews</span>}</div>
      <strong className="compact-service-price">{formatMoney(service.price)}</strong>
    </div>
    <div className="compact-service-actions"><button className="compact-details" onClick={onDetails} aria-label={`View details for ${service.name}`}>View details <ArrowRight size={14} aria-hidden="true"/></button>{item?<QuantityControl item={item} onChange={onChange}/>:<button className="compact-choose" onClick={onAdd} aria-label={`Choose ${service.name} for ${formatMoney(service.price)}`}>Choose <Plus size={15} aria-hidden="true"/></button>}</div>
  </article>;
}

export function BookingDrawer({items, subtotal, onProceed, onOpen}:{items:CartItem[]; subtotal:number; onProceed:()=>void; onOpen:()=>void}) {
  const count = items.reduce((n,i) => n + i.quantity, 0);
  if (!count) return null;

  return (
    <aside className="booking-drawer" aria-label="Booking summary">
      <div className="page-width flex items-center justify-between gap-4 py-3">
        <button
          className="drawer-summary-btn"
          onClick={onOpen}
          aria-label={`Review ${count} ${count===1?'service':'services'} in cart, subtotal ${formatMoney(subtotal)}`}
        >
          <div className="drawer-cart-badge">{count}</div>
          <div className="drawer-text">
            <span className="drawer-amount">{formatMoney(subtotal)}</span>
            <span className="drawer-subtext">{count} {count===1?'service':'services'} selected · Pay after service</span>
          </div>
          <ChevronDown size={16} className="rotate-180 text-muted" />
        </button>
        <button className="drawer-checkout-btn" onClick={onProceed}>
          <span>Select Date & Slot</span>
          <ArrowRight size={17} />
        </button>
      </div>
    </aside>
  );
}

export default function Discovery({
  initialCategory = "all",
  initialQuery = "",
  nearbyLocation,
  services,
  items,
  city,
  onCity,
  onAdd,
  onChange,
  onProceed,
  subtotal,
  preview
}: {
  initialCategory?: string;
  initialQuery?: string;
  nearbyLocation?:{lat:number;lng:number;city:string};
  services: Service[];
  items: CartItem[];
  city: string;
  onCity: (s:string)=>void;
  onAdd: (s:Service)=>void;
  onChange: (id:string, delta:number)=>void;
  onProceed: () => void;
  subtotal: number;
  preview: boolean;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState<CategoryId>((initialCategory as CategoryId) || 'all');
  const [detail, setDetail] = useState<Service | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [sort, setSort] = useState('recommended');
  const [roleFilter, setRoleFilter] = useState<'all'|'specialist'|'technician'>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [cityOpen,setCityOpen]=useState(false);
  const [maxPrice, setMaxPrice] = useState('');
  const [radiusKm, setRadiusKm] = useState('6');

  useEffect(() => {
    setCategory((initialCategory as CategoryId) || 'all');
    setQuery(initialQuery);
  }, [initialCategory, initialQuery]);

  // Filtered Services
  const visibleServices = useMemo(() => {
    return services
      .filter(s => {
        if (category !== 'all' && s.category !== category) return false;
        if (maxPrice && s.price > Number(maxPrice) * 100) return false;
        if (query.trim()) {
          const q = query.trim().toLowerCase();
          const matches = `${s.name} ${s.description} ${s.included.join(' ')} ${s.category}`.toLowerCase().includes(q);
          if (!matches) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sort === 'duration') return a.duration - b.duration || a.price - b.price;
        if (sort === 'price-low') return a.price - b.price;
        if (sort === 'price-high') return b.price - a.price;
        if (sort === 'rating') return (b.rating || 0) - (a.rating || 0);
        return 0;
      });
  }, [services, category, query, maxPrice, sort]);

  return (
    <>
      {cityOpen&&<Modal title="Choose service city" onClose={()=>setCityOpen(false)}>          <div className="uc-location-selector">
            <MapPin size={16} className="text-accent" aria-hidden="true" />
            <label htmlFor="city-select" className="sr-only">Choose service city</label>
            <select
              id="city-select"
              value={city}
              onChange={e => onCity(e.target.value)}
              className="uc-city-dropdown"
            >
              {cities.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <ChevronDown size={14} className="dropdown-chevron" />
          </div>

<button onClick={()=>setCityOpen(false)}>Use this city</button></Modal>}
      <header className="uc-header-sticky">
        <div className="page-width uc-nav-row">
          <div className="uc-search-container">
            <Search size={18} className="search-icon" aria-hidden="true" />
            <input
              type="search"
              aria-label="Search services, repairs, specialists or technicians"
              placeholder="Search 'AC service', 'pipe leak', 'deep clean'..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="uc-search-input"
            />
            {query && (
              <button
                className="uc-clear-search-btn"
                onClick={() => setQuery('')}
                aria-label="Clear search input"
              >
                <X size={16} />
              </button>
            )}
          </div>
          <button className="uc-compact-action" aria-label={`Choose service city: ${city}`} title={city} onClick={()=>setCityOpen(true)}><MapPin size={18}/></button>
          <button className="uc-compact-action" aria-label="Filters and sort" aria-expanded={filtersOpen} onClick={()=>setFiltersOpen(true)}><SlidersHorizontal size={18}/></button>
        </div>


      </header>

      <section id="main-content" aria-label="Service catalogue" className="page-width uc-discovery-main catalog-discovery pb-56">
        <ServiceStories services={services} selected={category} onSelect={setCategory} title="Find your service"/>
        {category!=='all'&&<ServiceLeaders key={`${category}:${city}`} category={category} city={city} initialLocation={nearbyLocation} role={roleFilter} radiusKm={Number(radiusKm)}/>}

        {/* Section Heading & Compact Filter Controls */}
        <div className="uc-services-controls">
          <div className="uc-heading-group">
            <h1 className="uc-section-heading">
              {query ? `Results for "${query}"` : category === 'all' ? 'All home services' : categories.find(c => c.id === category)?.name}
            </h1>
            <span className="catalog-service-count" role="status">{visibleServices.length} {visibleServices.length===1?'service':'services'}</span>

          </div>


        </div>


        {filtersOpen && (
          <Modal title="Filters & sort" onClose={()=>setFiltersOpen(false)}><div id="filter-panel" className="uc-expanded-filters"><label>Sort services<select value={sort} onChange={e=>setSort(e.target.value)}><option value="recommended">Recommended</option><option value="price-low">Price: Low to High</option><option value="price-high">Price: High to Low</option><option value="rating">Highest Rated</option><option value="duration">Shortest estimated visit</option></select></label>
            <div className="filter-group">
              <label htmlFor="filter-price">Max Budget</label>
              <select id="filter-price" value={maxPrice} onChange={e => setMaxPrice(e.target.value)}>
                <option value="">Any Budget</option>
                <option value="300">Up to ₹300</option>
                <option value="600">Up to ₹600</option>
                <option value="1000">Up to ₹1,000</option>
                <option value="3000">Up to ₹3,000</option>
              </select>
            </div>

            <div className="filter-group">
              <label htmlFor="filter-role">Professional role · selected category</label>
              <select id="filter-role" value={roleFilter} onChange={e => setRoleFilter(e.target.value as any)}>
                <option value="all">All listed professionals</option>
                <option value="specialist">Specialist</option>
                <option value="technician">Technician</option>
              </select>
            </div>

            <div className="filter-group">
              <label htmlFor="filter-radius">Professional search radius</label>
              <select id="filter-radius" disabled={!nearbyLocation||nearbyLocation.city!==city} value={radiusKm} onChange={e => setRadiusKm(e.target.value)}>
                <option value="3">Within 3 km</option>
                <option value="6">Within 6 km</option>
              </select>
              {(!nearbyLocation||nearbyLocation.city!==city)&&<small>Choose your location on the home page to apply a distance filter. Currently browsing the city.</small>}
            </div>

            {(maxPrice || roleFilter !== 'all' || radiusKm !== '6') && (
              <button
                className="clear-filters-btn"
                onClick={() => { setMaxPrice(''); setRoleFilter('all'); setRadiusKm('6'); }}
              >
                Reset Filters
              </button>
            )}
          </div></Modal>
        )}

        {/* Services List */}
        <div className="uc-services-grid">
          {visibleServices.map(service => (
            <ServiceCard
              key={service.id}
              service={service}
              item={items.find(i => i.service.id === service.id)}
              onAdd={() => onAdd(service)}
              onChange={onChange}
              onDetails={() => setDetail(service)}
            />
          ))}

          {!visibleServices.length && (
            <Empty
              title="No services match your search"
              description={`We couldn't find any services matching "${query}" in ${categories.find(c=>c.id===category)?.name || 'this category'}.`}
              action={
                <button
                  className="button-primary"
                  onClick={() => { setQuery(''); setCategory('all'); setMaxPrice(''); }}
                >
                  View All Services
                </button>
              }
            />
          )}
        </div>
      </section>

      <BookingDrawer items={items} subtotal={subtotal} onProceed={onProceed} onOpen={() => setCartOpen(true)} />

      {/* Detailed Service Modal */}
      {detail && (
        <Modal className="reference-detail-sheet" title={detail.name} onClose={() => setDetail(null)}>
          <div className="uc-modal-content">
            <div className="uc-modal-header-banner">
              <ServiceImage service={detail} className="uc-modal-image" />
              <div className="uc-modal-pricing-bar">
                <div>
                  <span className="price-big">{formatMoney(detail.price)}</span>
                  {detail.originalPrice && (
                    <span className="price-struck">{formatMoney(detail.originalPrice)}</span>
                  )}
                </div>
                <div className="duration-pill">
                  <Clock3 size={13} /> {formatDuration(detail.duration)}
                </div>
              </div>
            </div>

            <p className="uc-modal-description">{detail.description}</p>

            <div className="uc-guarantee-pill">
              <ShieldCheck size={18} className="text-emerald" />
              <div>
                <strong>Review before you book</strong>
                <p>Parts and additional work need your approval. Review the scope and final bill.</p>
              </div>
            </div>

            <div className="uc-inclusions-section">
              <h3 className="section-subtitle">What's Included</h3>
              <ul className="uc-checklist included">
                {detail.included.map(inc => (
                  <li key={inc}>
                    <Check size={16} className="text-emerald" />
                    <span>{inc}</span>
                  </li>
                ))}
              </ul>

              <h3 className="section-subtitle mt-4">What's Excluded</h3>
              <ul className="uc-checklist excluded">
                {detail.excluded.map(exc => (
                  <li key={exc}>
                    <X size={16} className="text-muted" />
                    <span>{exc}</span>
                  </li>
                ))}
              </ul>
            </div>

            <ServiceTerms serviceId={detail.id}/>
            <ServiceLeaders key={`detail:${detail.category}:${city}`} category={detail.category} city={city} initialLocation={nearbyLocation}/>

            <div className="uc-modal-bottom-cta">
              <div>
                <span className="pay-after-note">Pay after service completion</span>
                <strong className="final-price">{formatMoney(detail.price)}</strong>
              </div>
              <button
                className="button-primary add-service-btn"
                onClick={() => {
                  onAdd(detail);
                  setDetail(null);
                }}
                disabled={(items.find(i => i.service.id === detail.id)?.quantity ?? 0) >= 5}
              >
                <Plus size={18} /> Add to Booking
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Cart Drawer Modal */}
      {cartOpen && (
        <Modal title="Review Your Services" onClose={() => setCartOpen(false)}>
          {items.length ? (
            <div className="space-y-6">
              {items.map(item => (
                <div key={item.service.id} className="cart-item-row">
                  <div className="cart-item-info">
                    <h3 className="font-semibold text-ink">{item.service.name}</h3>
                    <span className="cart-item-price">{formatMoney(item.service.price * item.quantity)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <QuantityControl item={item} onChange={onChange} />
                    <button
                      type="button"
                      className="cart-remove-btn"
                      onClick={() => onChange(item.service.id, -item.quantity)}
                      aria-label={`Remove ${item.service.name} from selection`}
                      title="Remove service"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
              <div className="cart-summary-block">
                <div className="flex justify-between text-sm text-muted">
                  <span>Subtotal</span>
                  <span>{formatMoney(subtotal)}</span>
                </div>
                <div className="flex justify-between font-bold text-ink text-base pt-2 border-t">
                  <span>Total (Pay after service)</span>
                  <span>{formatMoney(subtotal)}</span>
                </div>
              </div>
              <button
                className="button-primary w-full py-4 text-base font-semibold"
                onClick={() => {
                  setCartOpen(false);
                  onProceed();
                }}
              >
                Proceed to Date & Address Selection <ArrowRight size={18} />
              </button>
            </div>
          ) : (
            <Empty
              title="Your booking is empty"
              description="Add a service to get started."
              action={
                <button className="button-primary" onClick={() => setCartOpen(false)}>
                  View Services
                </button>
              }
            />
          )}
        </Modal>
      )}
    </>
  );
}
