import ServiceLeaders from './ServiceLeaders';
import {ServiceTerms} from './ServiceTerms';
import ServiceStories from './ServiceStories';
import ServiceImage from './ServiceImage';
import SponsoredPlacement from './SponsoredPlacement';
import { discoverySponsor } from '../advertising';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Award,
  BriefcaseBusiness,
  CalendarCheck2,
  Check,
  ChevronDown,
  Clock3,
  GraduationCap,
  Info,
  MapPin,
  MapPinned,
  Minus,
  Percent,
  Plus,
  ReceiptText,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  User,
  Wrench,
  X,
  Zap
} from 'lucide-react';
import { categories, cities, formatDuration, formatMoney, seededWorkers, findBestCandidates, getTechnicianProgress } from '../data';
import type { CartItem, CategoryId, Service, WorkerProfile, CandidateMatch } from '../types';
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
  onDetails,
  onOpenWorker
}: {
  service: Service;
  item?: CartItem;
  onAdd: () => void;
  onChange: (id: string, delta: number) => void;
  onDetails: () => void;
  onOpenWorker: (worker: WorkerProfile) => void;
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
  const [selectedWorker, setSelectedWorker] = useState<WorkerProfile | null>(null);
  const [showRoleGuide, setShowRoleGuide] = useState(false);
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

  // Search and Discovery Candidate Matching Engine
  const bestCandidateMatches = useMemo(() => {
    return findBestCandidates(query, category, city);
  }, [query, category, city]);

  const topMatch: CandidateMatch | undefined = bestCandidateMatches[0];

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

      <section id="main-content" aria-label="Service catalogue" className="page-width uc-discovery-main pb-56">
        <ServiceStories services={services} selected={category} onSelect={setCategory} title="Find your service"/>
        <ServiceLeaders
          city={city}
          initialLocation={nearbyLocation}
          onSelectCategory={cat => setCategory(cat as any)}
        />

        {/* Best Candidate Matching Engine Card */}
        {topMatch && (
          <section className="uc-candidate-engine-card" aria-labelledby="best-candidate-heading">
            <div className="engine-card-header">
              <div className="engine-badge-group">
                <span className="candidate-match-pill">
                  <Sparkles size={13} aria-hidden="true" />
                  {topMatch.matchScore}% Match Found
                </span>
                <span className="candidate-distance-pill">
                  <MapPin size={12} aria-hidden="true" />
                  {topMatch.worker.distanceKm} km away (Coverage: &lt;6 km)
                </span>
              </div>
              <button
                className="role-guide-link"
                onClick={() => setShowRoleGuide(true)}
              >
                <Info size={14} /> Specialist vs Technician Guide
              </button>
            </div>

            <div className="engine-candidate-body">
              <div className="candidate-avatar-large">
                {topMatch.worker.profileImage ? (
                  <img src={topMatch.worker.profileImage} alt={topMatch.worker.name} className="w-full h-full rounded-2xl object-cover" />
                ) : (
                  <span>{topMatch.worker.avatar}</span>
                )}
                <span className={`role-badge-pill ${topMatch.worker.role}`}>
                  {topMatch.worker.role === 'specialist' ? '⭐ Specialist' : '🔧 Technician'}
                </span>
              </div>

              <div className="candidate-details">
                <h3 id="best-candidate-heading" className="candidate-name">
                  {topMatch.worker.name}
                  <span className="experience-tag">({topMatch.worker.yearsExperience} yrs exp)</span>
                </h3>

                <p className="candidate-skill-highlight">
                  <strong>Best suited for:</strong> {topMatch.worker.bestSkill}
                </p>

                <p className="candidate-tools-tag">
                  <Wrench size={13} className="text-muted" />
                  <span>{topMatch.worker.toolsEquipped}</span>
                </p>

                <div className="flex flex-wrap items-center gap-2 my-1 text-xs">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md font-bold bg-blue-50 text-blue-800 border border-blue-200">
                    {topMatch.worker.pricingModel === 'fixed'
                      ? `₹${topMatch.worker.fixedPrice || 399} Flat (Fixed Task Fare)`
                      : `Base Fare: ₹${topMatch.worker.baseFare || 150} + ₹${topMatch.worker.hourlyRate || 349}/hr`}
                  </span>
                  <span className="text-sm text-muted">• Verified Tools</span>
                </div>

                <div className="candidate-reasons-list">
                  {topMatch.matchReasons.map((reason, idx) => (
                    <span key={idx} className="match-reason-item">
                      <Check size={12} className="check-icon" /> {reason}
                    </span>
                  ))}
                </div>
              </div>

              <div className="candidate-actions">
                <div className="rating-box">
                  <Star size={16} className="star-icon" fill="currentColor" />
                  <strong>{topMatch.worker.taskScore}</strong>
                  <span>({topMatch.worker.completedTasks} completed)</span>
                </div>
                <button
                  className="uc-candidate-view-btn"
                  onClick={() => setSelectedWorker(topMatch.worker)}
                >
                  View Profile & Tools
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Section Heading & Compact Filter Controls */}
        <div className="uc-services-controls">
          <div className="uc-heading-group">
            <h1 className="uc-section-heading">
              {query ? `Results for "${query}"` : category === 'all' ? 'All home services' : categories.find(c => c.id === category)?.name}
            </h1>

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
              <label htmlFor="filter-role">Worker Role</label>
              <select id="filter-role" value={roleFilter} onChange={e => setRoleFilter(e.target.value as any)}>
                <option value="all">All Professionals</option>
                <option value="specialist">Specialist (Senior with Pro Kit)</option>
                <option value="technician">Technician (Junior Partner)</option>
              </select>
            </div>

            <div className="filter-group">
              <label htmlFor="filter-radius">Distance Coverage</label>
              <select id="filter-radius" value={radiusKm} onChange={e => setRadiusKm(e.target.value)}>
                <option value="3">Within 3 km</option>
                <option value="6">Within 6 km (Standard)</option>
              </select>
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
              onOpenWorker={worker => setSelectedWorker(worker)}
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

            <ServiceTerms serviceId={detail.id}/>{/* Associated Workers Within 6 km */}
            <div className="uc-modal-workers-section">
              <div className="workers-section-header">
                <div>
                  <h3 className="section-subtitle">Professional assignment</h3>
                  <p className="subtitle-caption">Assigned based on proximity (&lt;6 km), skill fit and user ratings.</p>
                </div>
                <button className="link-button" onClick={() => setShowRoleGuide(true)}>
                  Role Guide
                </button>
              </div>

              <div className="associated-workers-list">
                {seededWorkers
                  .filter(w => w.category === detail.category && w.distanceKm <= 6.0)
                  .map(worker => (
                    <div key={worker.id} className="associated-worker-card">
                      <div className="worker-header-row">
                        <div className="worker-avatar-box">
                          {worker.profileImage ? (
                            <img src={worker.profileImage} alt={worker.name} className="w-full h-full rounded-xl object-cover" />
                          ) : (
                            <span>{worker.avatar}</span>
                          )}
                        </div>
                        <div className="worker-info-col">
                          <div className="worker-name-role">
                            <strong>{worker.name}</strong>
                            <span className={`role-badge ${worker.role}`}>
                              {worker.role === 'specialist' ? '⭐ Specialist (Sr.)' : '🔧 Technician (Jr.)'}
                            </span>
                          </div>
                          <span className="worker-meta">
                            {worker.distanceKm} km away · {worker.yearsExperience} yrs exp · ★ {worker.taskScore} ({worker.completedTasks} jobs)
                          </span>
                        </div>
                        <button
                          className="view-toolkit-btn"
                          onClick={() => setSelectedWorker(worker)}
                        >
                          Toolkit & Info
                        </button>
                      </div>

                      <p className="worker-best-skill">
                        <strong>Best for:</strong> {worker.bestSkill}
                      </p>

                      <div className="worker-equipment-tag">
                        <Wrench size={12} /> {worker.toolsEquipped}
                      </div>
                    </div>
                  ))}
              </div>
            </div>

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

      {/* Worker Profile & Toolkit Details Modal */}
      {selectedWorker && (
        <Modal
          title={`${selectedWorker.name} — Profile & Verification`}
          onClose={() => setSelectedWorker(null)}
        >
          <div className="worker-modal-body">
            <div className="worker-profile-banner">
              <div className="profile-large-avatar">
                {selectedWorker.profileImage ? (
                  <img src={selectedWorker.profileImage} alt={selectedWorker.name} className="w-full h-full rounded-2xl object-cover" />
                ) : (
                  <span>{selectedWorker.avatar}</span>
                )}
              </div>
              <div className="profile-info-banner">
                <div className="flex items-center gap-2">
                  <h3 className="profile-name">{selectedWorker.name}</h3>
                  <span className={`role-badge ${selectedWorker.role}`}>
                    {selectedWorker.role === 'specialist' ? '⭐ Senior Specialist' : '🔧 Junior Technician'}
                  </span>
                </div>
                <p className="profile-city-exp">
                  {selectedWorker.city} · {selectedWorker.yearsExperience} Years Field Experience
                </p>
                <div className="profile-score-row">
                  <span className="score-badge">★ {selectedWorker.taskScore} Customer Rating</span>
                  <span className="tasks-done">{selectedWorker.completedTasks} Completed Tasks</span>
                  <span className="dist-badge">{selectedWorker.distanceKm} km Proximity</span>
                </div>
              </div>
            </div>

            {/* Points & Level Progression for Technician */}
            {selectedWorker.role === 'technician' && (
              <div className="progression-box">
                {(() => {
                  const prog = getTechnicianProgress(selectedWorker.points);
                  return (
                    <>
                      <div className="progression-header">
                        <div>
                          <strong>Technician Level {prog.currentLevel}</strong>
                          <span className="points-display">{prog.currentPoints} / {prog.specialistThreshold} Points</span>
                        </div>
                        <span className="points-remaining">
                          {prog.remainingToSpecialist} pts to Specialist & Pro Kit
                        </span>
                      </div>
                      <div className="progress-bar-track">
                        <div className="progress-bar-fill" style={{width: `${prog.progressPercent}%`}} />
                      </div>
                      <p className="progression-note">
                        Earns +50 pts for on-time arrival, +100 pts for 5-star review, +100 pts for zero rework. Level 5 unlocks Senior Specialist role & official Repaido Specialist Pro Kit!
                      </p>
                    </>
                  );
                })()}
              </div>
            )}

            {/* Specialist Kit Badge */}
            {selectedWorker.role === 'specialist' && (
              <div className="specialist-pro-badge-box">
                <Award size={24} className="text-amber" />
                <div>
                  <strong>Certified Repaido Specialist</strong>
                  <p>Awarded official Repaido Specialist Kit for maintaining high task scores (4.85+ ★) and delivering 150+ completed jobs.</p>
                </div>
              </div>
            )}

            <div className="worker-details-grid">
              <div className="detail-item">
                <span className="detail-label">Best Suitable Skill</span>
                <span className="detail-val font-semibold">{selectedWorker.bestSkill}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Specialized Areas</span>
                <span className="detail-val">{selectedWorker.specializedSkills.join(', ')}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Service Pricing Model</span>
                <span className="detail-val font-bold text-accent">
                  {selectedWorker.pricingModel === 'fixed'
                    ? `₹${selectedWorker.fixedPrice || 399} Flat (Completion-Based)`
                    : `₹${selectedWorker.baseFare || 150} Base Inspection + ₹${selectedWorker.hourlyRate || 349}/hr`}
                </span>
              </div>
            </div>

            {selectedWorker.gigs && selectedWorker.gigs.length > 0 && (
              <div className="my-3 space-y-2">
                <h4 className="text-xs font-bold text-ink uppercase tracking-wider">Available Gigs & Specialties</h4>
                <div className="space-y-1.5">
                  {selectedWorker.gigs.map(g => (
                    <div key={g.id} className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                      <div className="font-bold text-slate-900">{g.title}</div>
                      <div className="text-sm text-muted mt-0.5">{g.description || g.skills.join(', ')}</div>
                      <div className="text-xs font-semibold text-emerald-700 mt-1">
                        {g.pricingModel === 'fixed' ? `₹${g.fixedPrice || 399} Flat Rate` : `₹${g.baseFare || 150} Base + ₹${g.hourlyRate || 349}/hr`}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="tool-inventory-box">
              <h4 className="inventory-title">
                <Wrench size={15} /> Verified Toolkit Inventory
              </h4>
              <ul className="tools-checklist">
                {selectedWorker.toolsList.map(tool => (
                  <li key={tool}>
                    <Check size={14} className="text-emerald" />
                    <span>{tool}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="kyc-verified-strip">
              <ShieldCheck size={16} className="text-emerald" />
              <span>Aadhaar, Police Background Verification & Address Verified by Repaido Security</span>
            </div>
          </div>
        </Modal>
      )}

      {/* Specialist vs Technician Educational Modal */}
      {showRoleGuide && (
        <Modal title="Specialist vs. Technician: Understanding the Difference" onClose={() => setShowRoleGuide(false)}>
          <div className="role-guide-modal-content">
            <p className="guide-intro">
              At Repaido, we transparently classify our professionals so you always know who is visiting your home and what equipment they carry.
            </p>

            <div className="role-comparison-cards">
              <div className="role-card technician-card">
                <div className="role-card-top">
                  <GraduationCap size={26} className="text-accent" />
                  <div>
                    <h4>Technician (Junior Partner)</h4>
                    <span className="role-tier-tag">Levels 1 – 4 (Starts at Level 1)</span>
                  </div>
                </div>
                <p className="role-desc">
                  Skilled professionals for standard servicing, maintenance, filter washing, and minor fixes.
                </p>
                <ul className="role-perks-list">
                  <li><strong>Experience:</strong> 1 – 3 years of trade experience.</li>
                  <li><strong>Equipment:</strong> Standard Essential Toolkit (wrenches, pressure pumps, testers).</li>
                  <li><strong>Point System:</strong> Earns points on every job (+50 on-time, +100 for 5★ reviews).</li>
                  <li><strong>Specialist Goal:</strong> Reaching 1,500 points (Level 5) unlocks promotion to Specialist and the official Repaido Specialist Pro Kit!</li>
                </ul>
              </div>

              <div className="role-card specialist-card">
                <div className="role-card-top">
                  <Award size={26} className="text-amber" />
                  <div>
                    <h4>Specialist (Senior Master Partner)</h4>
                    <span className="role-tier-tag">Level 5+ Master (1,500+ Points)</span>
                  </div>
                </div>
                <p className="role-desc">
                  Senior veterans with advanced diagnostics for complex leakages, complete rewiring, PCB issues, and precision installations.
                </p>
                <ul className="role-perks-list">
                  <li><strong>Experience:</strong> 5 – 10+ years of verified master experience.</li>
                  <li><strong>Equipment:</strong> Official Repaido Pro Specialist Kit (Thermal leak sensors, digital manifold gauges, electric pipe threaders).</li>
                  <li><strong>Quality Bar:</strong> Must maintain a strict 4.85+ ★ user task score with 150+ completed jobs.</li>
                  <li><strong>Best For:</strong> Difficult troubleshooting, concealed issues, high-precision work.</li>
                </ul>
              </div>
            </div>

            <div className="guide-summary-box">
              <Sparkles size={18} className="text-accent" />
              <span>
                Both Technicians and Specialists are background verified, Aadhaar verified, and covered under the 30-day Repaido Service Guarantee.
              </span>
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
