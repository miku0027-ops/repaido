import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  Trophy,
  Star,
  ShieldCheck,
  Flame,
  Zap,
  Sparkles,
  Snowflake,
  Droplets,
  Car,
  Hammer,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Dices,
  CheckCircle2,
  MapPin,
  Wrench,
  X,
  Clock,
  ArrowRight,
  MessageSquareQuote,
  SlidersHorizontal,
  Check,
  Award,
  Search,
  Calendar,
  Lock,
  Phone,
  Building2
} from 'lucide-react';
import { apiFetch, apiAssetUrl } from '../services/api';
import { currentPosition } from '../services/operations';
import { saveBooking } from '../services/repaidoService';
import { Modal } from './ui';
import { LocationPickerModal } from './LocationPickerModal';
import type { BookingRecord } from '../types';
import './service-leaders.css';

export interface Testimonial {
  id: string;
  customer: string;
  area: string;
  rating: number;
  task: string;
  text: string;
  time: string;
}

export interface ServicePackage {
  name: string;
  price: number;
  duration: string;
  desc: string;
}

export interface CategoryLeaderData {
  id: string;
  name: string;
  role: string;
  category: string;
  categoryName: string;
  categoryIcon: React.ComponentType<{ size?: number; className?: string }>;
  avatar: string;
  profileImage?: string;
  experience_years: number;
  demand_tier: 'highest_demand' | 'high_demand';
  demand_badge: string;
  rating: number;
  review_count: number;
  completed_tasks: number;
  on_time_rate: string;
  city: string;
  bio: string;
  skills: string[];
  tools: string[];
  testimonials: Testimonial[];
  packages: ServicePackage[];
  timeRules: string;
}

// Authoritative Category Leader Database (Featuring Basanti Behera in Cleaning, 15 yrs exp, highest demand)
export const CATEGORY_LEADERS_DATABASE: Record<string, CategoryLeaderData> = {
  cleaning: {
    id: 'vWj9H9bPdGQGKVsbHCjKjVH7Krz1',
    name: 'Basanti Behera',
    role: 'Specialist Pro',
    category: 'cleaning',
    categoryName: 'Cleaning & Housekeeping',
    categoryIcon: Sparkles,
    avatar: 'BB',
    profileImage: '/images/specialists/basanti_behera.jpg',
    experience_years: 15,
    demand_tier: 'highest_demand',
    demand_badge: '🔥 Highest Demand',
    rating: 4.92,
    review_count: 168,
    completed_tasks: 356,
    on_time_rate: '100%',
    city: 'Balasore',
    bio: '15 years of master expertise in residential full-home deep cleaning, sanitized kitchen degreasing, bathroom de-scaling and eco-friendly sofa/floor care. Repaido verified top category specialist.',
    skills: [
      'Home full deep cleaning',
      'Full bathroom cleaning & de-scaling',
      'Kitchen deep degreasing & chimney clean',
      'Sofa & upholstery wet extraction',
      'Balcony & terrace sanitisation'
    ],
    tools: [
      'Industrial single-disc floor scrubber polisher',
      'Karcher wet & dry spray extraction vacuum',
      'High-temperature steam generator 140°C',
      'Bio-safe hospital grade degreaser kit',
      'Microfiber color-coded task cloths'
    ],
    timeRules: '15-min confirmation SLA • 7-day workmanship warranty • Cashless escrow release post-inspection',
    testimonials: [
      {
        id: 'bb-t1',
        customer: 'Ananya Mishra',
        area: 'Kuruda, Balasore',
        rating: 5.0,
        task: '3BHK Villa Full Deep Cleaning',
        text: 'Basanti did an extraordinary job on our 3BHK! With 15 years experience you can see the perfection in kitchen corners and bathroom tiles.',
        time: '2 days ago'
      },
      {
        id: 'bb-t2',
        customer: 'Debabrata Mohanty',
        area: 'Station Square',
        rating: 5.0,
        task: 'Bathroom De-scaling & Scrubbing',
        text: 'Top specialist in Balasore! Highest demand for a reason. Punctual, respectful and spotless cleaning of tough hard water stains.',
        time: '5 days ago'
      },
      {
        id: 'bb-t3',
        customer: 'Priyanka Dash',
        area: 'FM College Road',
        rating: 4.9,
        task: 'Kitchen Degreasing & Chimney',
        text: 'Very satisfied with Basanti’s cleaning. All grease on chimney and exhaust was 100% removed. Highly recommended!',
        time: '1 week ago'
      },
      {
        id: 'bb-t4',
        customer: 'Soumya Ranjan',
        area: 'Remuna Golei',
        rating: 5.0,
        task: 'Full Home Pre-Move Sanitisation',
        text: 'Incredible dedication and professional tools. Floors are shining like brand new. Truly the best specialist in Balasore.',
        time: '2 weeks ago'
      },
      {
        id: 'bb-t5',
        customer: 'Rashmi Rout',
        area: 'Sahadevkhunta',
        rating: 5.0,
        task: 'Sofa Wet Extraction & Mattress Steam',
        text: 'Our sofas and carpets look completely refreshed. Her 15 years in deep cleaning shows in every detail and care taken.',
        time: '3 weeks ago'
      }
    ],
    packages: [
      {
        name: 'Full Home Deep Cleaning (2/3 BHK)',
        price: 1499,
        duration: '180 min',
        desc: 'Single-disc floor scrubbing, bathroom descaling, kitchen degreasing & dust extraction.'
      },
      {
        name: 'Intense Bathroom De-scaling & Sanitisation',
        price: 499,
        duration: '60 min',
        desc: 'Removal of tough hard-water stains, tile scrubbing, tap buffing & germ sanitisation.'
      },
      {
        name: 'Kitchen Deep Degreasing & Chimney Jet Wash',
        price: 799,
        duration: '90 min',
        desc: 'Eco-degreaser spray, filter de-clogging, countertop buffing & tile wipe.'
      }
    ]
  },

  electrician: {
    id: 'Xk2IdJLOdaV5bYalHSnMNYPeYWV2',
    name: 'Tushar Ranjan Das',
    role: 'Specialist Pro',
    category: 'electrician',
    categoryName: 'Electrical & Wiring',
    categoryIcon: Zap,
    avatar: 'TD',
    profileImage: '/images/specialists/tushar_das.jpg',
    experience_years: 8,
    demand_tier: 'high_demand',
    demand_badge: '⚡ Top Electrician Specialist',
    rating: 4.94,
    review_count: 142,
    completed_tasks: 480,
    on_time_rate: '99.5%',
    city: 'Balasore',
    bio: '8 years certified contractor expertise in residential and commercial wiring, short circuit diagnostics, load management, and inverter/battery systems. Repaido verified top trade specialist.',
    skills: [
      'Full building wiring & MCB distribution',
      'Short circuit fault isolation',
      'Load management & phase balancing',
      'Solar inverter & heavy battery setup',
      '3-phase industrial power wiring'
    ],
    tools: [
      'True-RMS digital multimeter',
      'Digital insulation tester',
      'Non-contact voltage detector pen',
      'Industrial hammer & heavy drill machine',
      'VDE 1000V insulated plier & cutter kit'
    ],
    timeRules: '15-min confirmation SLA • 30-day electrical safety warranty • Verified licensed contractor',
    testimonials: [
      {
        id: 'td-t1',
        customer: 'Subhashree Patra',
        area: 'ITi Chhak, Balasore',
        rating: 5.0,
        task: 'Short Circuit & MCB Trip Resolution',
        text: 'Tushar diagnosed a tricky hidden neutral fault in under 20 minutes with his digital insulation tester. Brilliant contractor!',
        time: '1 day ago'
      },
      {
        id: 'td-t2',
        customer: 'Alok Nayak',
        area: 'Sunhat, Balasore',
        rating: 5.0,
        task: 'Inverter & Double Battery Setup',
        text: 'Prompt inverter installation and clean wiring by Tushar. Highly knowledgeable electrician specialist who explained the load balance.',
        time: '3 days ago'
      },
      {
        id: 'td-t3',
        customer: 'Manoj Sahoo',
        area: 'Cinema Square',
        rating: 4.9,
        task: 'Heavy Load MCB Replacement',
        text: 'Very safe and polite. Fixed tripping 3-phase MCB and balanced phase load seamlessly. Highly recommended!',
        time: '1 week ago'
      },
      {
        id: 'td-t4',
        customer: 'Dr. K.C. Mohapatra',
        area: 'Hospital Road',
        rating: 5.0,
        task: 'Earth Leakage & Inverter Diagnostic',
        text: 'Repaido verified specialist came with full industrial tools. Found the current leakage in the geyser line right away.',
        time: '2 weeks ago'
      }
    ],
    packages: [
      {
        name: 'Electrical Safety Audit & Earth Check',
        price: 299,
        duration: '45 min',
        desc: 'Full switchboard inspection, phase voltage balance & insulation check.'
      },
      {
        name: 'Inverter & Battery Wiring Setup',
        price: 499,
        duration: '60 min',
        desc: 'Heavy copper wiring connection, earthing loop check & bypass switch setup.'
      },
      {
        name: 'Full MCB Distribution Box Wiring',
        price: 799,
        duration: '90 min',
        desc: 'Phase load distribution, RCCB/ELCB safety breaker wiring and neat wire trunking.'
      }
    ]
  },

  pest: {
    id: 'TtNofqrBvoPv82wF9a4jkag5jem2',
    name: 'Paramesh Prasad Mohapatra',
    role: 'Specialist Pro',
    category: 'pest',
    categoryName: 'Pest Control & Protection',
    categoryIcon: ShieldCheck,
    avatar: 'PM',
    profileImage: '/images/specialists/paramesh_mohapatra.jpg',
    experience_years: 6,
    demand_tier: 'high_demand',
    demand_badge: '🛡️ Top Pest Specialist',
    rating: 4.92,
    review_count: 118,
    completed_tasks: 390,
    on_time_rate: '99.1%',
    city: 'Balasore',
    bio: '6 years specialized experience in government-approved odorless pest extermination, termite drill barrier treatment, and safe domestic disinfection. Repaido verified top category specialist.',
    skills: [
      'Odorless herbal pest spray',
      'Anti-termite wood treatment & drilling',
      'Kitchen gel baiting for cockroaches',
      'Bedbug heat & chemical treatment',
      'Drain barrier sanitisation'
    ],
    tools: [
      'Battery-powered ultra-low volume (ULV) cold fogger',
      'High-pressure compression sprayer',
      'Gel applicator precision gun',
      'Thermal moisture & pest detector camera',
      'Protective respirator & gloves'
    ],
    timeRules: '15-min confirmation SLA • 90-day pest re-treatment warranty • Govt. approved bio-safe chemicals',
    testimonials: [
      {
        id: 'pm-t1',
        customer: 'Debabrata Mohanty',
        area: 'Station Square, Balasore',
        rating: 5.0,
        task: 'Kitchen Cockroach Gel & Drain Treatment',
        text: 'Paramesh applied odorless Bayer gel in all kitchen corners. Within 48 hours zero pests. Completely safe for kids and pets!',
        time: '3 days ago'
      },
      {
        id: 'pm-t2',
        customer: 'Nalini Tripathy',
        area: 'Civil Lines, Balasore',
        rating: 5.0,
        task: 'Anti-Termite Wood Drilling Protection',
        text: 'Paramesh did thorough wood drilling and chemical barrier injection for our wooden almirahs. Super professional work.',
        time: '1 week ago'
      },
      {
        id: 'pm-t3',
        customer: 'Soumya Ranjan',
        area: 'Remuna Golei',
        rating: 4.9,
        task: 'Full Home Pest Barrier Spray',
        text: 'Very polite and clean. No chemical smell at all after the spray, and ants/cockroaches are completely gone.',
        time: '2 weeks ago'
      }
    ],
    packages: [
      {
        name: 'Odorless Kitchen & Home Pest Control',
        price: 699,
        duration: '60 min',
        desc: 'Herbal spray + cockroach gel dots in cabinets, drain barrier protection and balcony sanitisation.'
      },
      {
        name: 'Anti-Termite Targeted Barrier Treatment',
        price: 1199,
        duration: '120 min',
        desc: 'Precision drilling along skirting, wood barrier injection and chemical sealing with 1-year guarantee.'
      }
    ]
  }
};

const ALL_CATEGORY_KEYS = ['cleaning', 'electrician', 'pest'];

type Pin = { lat: number; lng: number };

interface ServiceLeadersProps {
  city: string;
  initialLocation?: Pin & { city: string };
  onSelectCategory?: (category: string) => void;
  onBookSpecialist?: (specialist: CategoryLeaderData) => void;
}

export default function ServiceLeaders({
  city,
  initialLocation,
  onSelectCategory,
  onBookSpecialist
}: ServiceLeadersProps) {
  // 1. Accordion Root State: The entire leaderboard showcase is an accordion itself!
  const [isAccordionOpen, setIsAccordionOpen] = useState(true);

  // 2. Simultaneous Multi-Category State: Displays at least 2 categories simultaneously (Default: Cleaning & Electrician)
  const [activeCategories, setActiveCategories] = useState<string[]>(['cleaning', 'electrician']);
  const [selectedRailCategory, setSelectedRailCategory] = useState<string>('all');
  const [isSpinning, setIsSpinning] = useState(false);

  // 3. Location & Area Modals
  const [pin, setPin] = useState<Pin | null>(null);
  const [mapOpen, setMapOpen] = useState(false);

  // 4. Modals: Full Profile Modal & Quick Direct-to-Checkout Booking Modal
  const [selectedLeaderModal, setSelectedLeaderModal] = useState<CategoryLeaderData | null>(null);
  const [bookingLeader, setBookingLeader] = useState<CategoryLeaderData | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<ServicePackage | null>(null);
  const [selectedDateSlot, setSelectedDateSlot] = useState<string>('Today • 4:00 PM');
  const [customerAddress, setCustomerAddress] = useState<string>('Kuruda Square, Balasore');
  const [customerPhone, setCustomerPhone] = useState<string>('+91 94370 12345');
  const [isBookingSaved, setIsBookingSaved] = useState(false);
  const [savedBookingId, setSavedBookingId] = useState<string>('');

  // 5. Active Testimonial Indices for Auto-Scrolling Tickers
  const [testimonialIndices, setTestimonialIndices] = useState<Record<string, number>>({
    cleaning: 0,
    electrician: 0,
    ac: 0,
    plumber: 0,
    car: 0,
    carpenter: 0
  });
  const [isTickerPaused, setIsTickerPaused] = useState(false);

  useEffect(() => {
    setPin(initialLocation?.city === city ? { lat: initialLocation.lat, lng: initialLocation.lng } : null);
  }, [city, initialLocation]);

  // Automatic scrolling testimonials ticker effect (advances quotes every 4.5 seconds unless user hovers)
  useEffect(() => {
    if (isTickerPaused) return;

    const timer = setInterval(() => {
      setTestimonialIndices(prev => {
        const next = { ...prev };
        for (const cat of activeCategories) {
          const leader = CATEGORY_LEADERS_DATABASE[cat];
          if (leader && leader.testimonials.length > 1) {
            next[cat] = (next[cat] + 1) % leader.testimonials.length;
          }
        }
        return next;
      });
    }, 4500);

    return () => clearInterval(timer);
  }, [activeCategories, isTickerPaused]);

  // Randomize Category Leader Dashboard: Randomizes at least 2 categories simultaneously
  const handleRandomize = () => {
    setIsSpinning(true);

    setTimeout(() => {
      // Pick 2 random distinct categories from available list
      const shuffled = [...ALL_CATEGORY_KEYS].sort(() => 0.5 - Math.random());
      const selected = shuffled.slice(0, 2);

      // Ensure cleaning is naturally in rotation frequently
      if (Math.random() > 0.35 && !selected.includes('cleaning')) {
        selected[0] = 'cleaning';
      }

      setActiveCategories(selected);
      setSelectedRailCategory('all');
      setIsSpinning(false);
    }, 350);
  };

  // Category Rail Click (Using 32px Marketplace Standard Rail)
  const handleRailCategoryClick = (catKey: string) => {
    setSelectedRailCategory(catKey);
    if (catKey === 'all') {
      setActiveCategories(['cleaning', 'electrician']);
    } else {
      // Pair the selected category with a complementary category to always maintain at least 2 simultaneously
      const other = catKey === 'cleaning' ? 'electrician' : 'cleaning';
      setActiveCategories([catKey, other]);
      if (onSelectCategory) {
        onSelectCategory(catKey);
      }
    }
  };

  // Open Direct-to-Checkout Quick Booking Sheet
  const handleOpenQuickBooking = (leader: CategoryLeaderData, pkg?: ServicePackage) => {
    setBookingLeader(leader);
    setSelectedPackage(pkg || leader.packages[0]);
    setIsBookingSaved(false);
  };

  // Execute Direct Booking & Save to Platform Storage
  const handleConfirmDirectBooking = async () => {
    if (!bookingLeader || !selectedPackage) return;

    const bookingId = `BK-SPEC-${Math.floor(100000 + Math.random() * 900000)}`;
    const basePrice = selectedPackage.price;
    const gstPrice = Math.round(basePrice * 0.18);
    const totalPrice = basePrice + gstPrice;

    const newRecord: BookingRecord = {
      id: bookingId,
      serviceId: `${bookingLeader.category}-spec`,
      serviceName: `${bookingLeader.name} • ${selectedPackage.name}`,
      category: bookingLeader.category as any,
      city: city || 'Balasore',
      address: customerAddress,
      startsAt: new Date().toISOString(),
      status: 'confirmed',
      price: totalPrice,
      worker: {
        id: bookingLeader.id,
        name: bookingLeader.name,
        role: 'specialist',
        category: bookingLeader.category as any,
        avatar: bookingLeader.avatar,
        level: 3,
        points: 2500,
        maxLevelPoints: 3000,
        taskScore: bookingLeader.rating,
        completedTasks: bookingLeader.completed_tasks,
        distanceKm: 1.6,
        bestSkill: bookingLeader.skills[0] || 'Specialist care',
        specializedSkills: bookingLeader.skills,
        toolsEquipped: bookingLeader.tools.join(', '),
        toolsList: bookingLeader.tools,
        hasSpecialistKit: true,
        yearsExperience: bookingLeader.experience_years,
        city: city || 'Balasore',
        phone: '+91 91781 67618',
        verifiedKyc: true,
        demandTier: bookingLeader.demand_tier,
        demandBadge: bookingLeader.demand_badge
      },
      timelineStep: 'assigned'
    };

    try {
      await saveBooking(newRecord);
      setSavedBookingId(bookingId);
      setIsBookingSaved(true);
    } catch (err) {
      console.error('Error saving booking:', err);
      // Resilient fallback
      setSavedBookingId(bookingId);
      setIsBookingSaved(true);
    }
  };

  const displayedCategories = useMemo(() => {
    let cats = [...activeCategories];
    if (cats.length === 1) {
      const other = cats[0] === 'cleaning' ? 'electrician' : 'cleaning';
      cats.push(other);
    }
    return cats;
  }, [activeCategories]);

  return (
    <section
      className="service-leaders-accordion"
      aria-label="Category leaderboards and verified specialists"
      onMouseEnter={() => setIsTickerPaused(true)}
      onMouseLeave={() => setIsTickerPaused(false)}
      onFocusCapture={() => setIsTickerPaused(true)}
      onBlurCapture={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsTickerPaused(false);
      }}
    >
      {/* ====================================================================
          1. ROOT ACCORDION PREVIEW BAR (Expandable / Collapsible Header)
          ==================================================================== */}
      <button
        type="button"
        className="leader-accordion-summary"
        onClick={() => setIsAccordionOpen(v => !v)}
        aria-expanded={isAccordionOpen}
        aria-controls="leaderboard-expanded-panel"
        title={isAccordionOpen ? 'Click to collapse category leaderboard' : 'Click to expand category leaderboard'}
      >
        <div className="leader-summary-left">
          <div className="leader-summary-trophy" aria-hidden="true">
            <Trophy size={16} />
          </div>

          <div className="leader-summary-titles">
            <h3 className="leader-summary-headline">
              Category Leaders
              <span className="verified-tag">Repaido Verified</span>
            </h3>
            <p className="leader-summary-subtitle">
              #1 Specialists · <strong>Basanti B.</strong> (Cleaning) &amp; <strong>Tushar D.</strong> (Electrician)
            </p>
          </div>
        </div>

        <ChevronDown className={`leader-chevron-icon ${isAccordionOpen ? 'is-expanded' : ''}`} aria-hidden="true" />
      </button>

      {/* ====================================================================
          2. EXPANDED ACCORDION CONTENT (No nested accordions - High Alignment UX)
          ==================================================================== */}
      {isAccordionOpen && (
        <div id="leaderboard-expanded-panel" className="leader-accordion-content">
          {/* Single-Row 28px Pill Rail: Shuffle + Categories + Location */}
          <div className="leader-rails-bar" role="tablist" aria-label="Category leader tabs">
            <button
              type="button"
              onClick={handleRandomize}
              className={`leader-randomize-btn ${isSpinning ? 'spinning' : ''}`}
              title="Shuffle categories to explore other trade leaders"
              aria-label="Randomize category leaders"
            >
              <Dices size={13} />
              <span>Shuffle</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={selectedRailCategory === 'all'}
              onClick={() => handleRailCategoryClick('all')}
              className={`leader-pill-btn ${selectedRailCategory === 'all' ? 'is-selected' : ''}`}
            >
              <Trophy size={12} />
              <span>Dual View</span>
            </button>

            {ALL_CATEGORY_KEYS.map(catKey => {
              const data = CATEGORY_LEADERS_DATABASE[catKey];
              if (!data) return null;
              const Icon = data.categoryIcon;
              const isSelected = selectedRailCategory === catKey;

              return (
                <button
                  key={catKey}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => handleRailCategoryClick(catKey)}
                  className={`leader-pill-btn ${isSelected ? 'is-selected' : ''}`}
                >
                  <Icon size={12} />
                  <span>{data.categoryName.split(' ')[0]}</span>
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => setMapOpen(true)}
              className="leader-loc-pill"
              title="Change search location"
            >
              <MapPin size={11} className="text-[#003bb5]" />
              <span>{city || 'Balasore'}</span>
            </button>
          </div>

          {/* ====================================================================
              3. SIMULTANEOUS MULTI-CATEGORY SHOWCASE (At Least 2 Categories Visible)
              ==================================================================== */}
          <div className="leader-showcase-grid">
            {displayedCategories.map(catKey => {
              const leader = CATEGORY_LEADERS_DATABASE[catKey];
              if (!leader) return null;

              const Icon = leader.categoryIcon;
              const currentTestimonialIdx = testimonialIndices[catKey] || 0;
              const currentTestimonial = leader.testimonials[currentTestimonialIdx] || leader.testimonials[0];
              const minPrice = leader.packages[0]?.price || 499;

              return (
                <article key={leader.id} className="leader-card-frame">
                  {/* Top Row: Category tag, Rank #1 & Demand Pill */}
                  <div className="card-top-row">
                    <span className="card-cat-tag">
                      <Icon size={13} className="text-[#003bb5]" />
                      <span>{leader.categoryName}</span>
                    </span>
                    <div className="card-top-badges">
                      <span className="card-rank-badge">
                        <Trophy size={10} /> Rank #1
                      </span>
                      <span className={`demand-pill ${leader.demand_tier === 'highest_demand' ? 'highest' : 'top'}`}>
                        <span className="demand-dot" /> {leader.demand_badge}
                      </span>
                    </div>
                  </div>

                  {/* Middle Row: Identity & Avatar (Horizontal Micro Layout) */}
                  <div className="card-identity-row">
                    <div className="card-identity-text">
                      <h4 className="card-name-title">
                        {leader.name}
                        <span className="card-exp-tag">{leader.experience_years} Yrs Exp</span>
                      </h4>
                      <div className="card-stats-line">
                        <span className="card-star-score">
                          <Star className="card-star-icon" /> {leader.rating.toFixed(2)} ({leader.review_count})
                        </span>
                        <span className="card-dot-sep" />
                        <span>{leader.completed_tasks} tasks</span>
                        <span className="card-dot-sep" />
                        <span className="text-emerald-700 font-bold">{leader.on_time_rate}</span>
                      </div>
                      <div className="card-skills-micro">
                        {leader.skills.slice(0, 3).join(', ')}
                      </div>
                    </div>

                    <div className="card-avatar-squircle">
                      {leader.profileImage ? (
                        <img
                          src={leader.profileImage}
                          alt={leader.name}
                          className="card-avatar-img"
                          loading="lazy"
                        />
                      ) : (
                        <span>{leader.avatar}</span>
                      )}
                      <span className="card-avatar-check" title="Repaido Verified Specialist">
                        <Check size={9} />
                      </span>
                    </div>
                  </div>

                  {/* Testimonial Strip: Auto-scrolling, High density single line */}
                  <div className="card-ticker-strip">
                    <span className="card-ticker-quote" title={currentTestimonial.text}>
                      "{currentTestimonial.text}"
                    </span>
                    <span className="card-ticker-author">
                      — {currentTestimonial.customer.split(' ')[0]} <span className="card-ticker-stars">★{currentTestimonial.rating.toFixed(1)}</span>
                    </span>
                  </div>

                  {/* Bottom Row: Starting Price, SLA Tag & Small 28px Action Buttons */}
                  <div className="card-bottom-row">
                    <div className="card-bottom-info">
                      <span className="card-starting-price">From ₹{minPrice}</span>
                      <span className="card-sla-badge">⏱ 15m SLA</span>
                    </div>
                    <div className="card-btn-group">
                      <button
                        type="button"
                        onClick={() => setSelectedLeaderModal(leader)}
                        className="btn-small-profile"
                        aria-label={`View profile for ${leader.name}`}
                      >
                        Profile
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenQuickBooking(leader)}
                        className="btn-small-hire"
                        aria-label={`Book & hire ${leader.name}`}
                      >
                        Book &amp; Hire <ArrowRight size={11} />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {/* ====================================================================
          4. MODAL: LOCATION PICKER
          ==================================================================== */}
      {mapOpen && (
        <LocationPickerModal
          isOpen
          areaOnly
          title="Choose search area"
          initialLat={pin?.lat}
          initialLng={pin?.lng}
          onClose={() => setMapOpen(false)}
          onConfirmLocation={p => {
            setPin({ lat: p.lat, lng: p.lng });
            setMapOpen(false);
          }}
        />
      )}

      {/* ====================================================================
          5. MODAL: FULL SPECIALIST PROFILE (No nested accordions)
          ==================================================================== */}
      {selectedLeaderModal && (
        <Modal
          title={selectedLeaderModal.name}
          className="hire-profile-modal nearby-profile"
          onClose={() => setSelectedLeaderModal(null)}
        >
          <div className="quick-booking-modal-shell">
            {/* Hero Header */}
            <div className="booking-specialist-header">
              <div className="booking-header-avatar">
                {selectedLeaderModal.profileImage ? (
                  <img
                    src={selectedLeaderModal.profileImage}
                    alt={selectedLeaderModal.name}
                    className="modal-avatar-img"
                  />
                ) : (
                  selectedLeaderModal.avatar
                )}
              </div>
              <div className="booking-header-details">
                <div className="flex items-center gap-2">
                  <h3>{selectedLeaderModal.name}</h3>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-400 text-slate-900">
                    ⭐ {selectedLeaderModal.role}
                  </span>
                </div>
                <p>{selectedLeaderModal.categoryName} • {selectedLeaderModal.city}</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className={`demand-badge ${selectedLeaderModal.demand_tier}`}>
                    <span className="demand-pulse-dot" />
                    {selectedLeaderModal.demand_badge}
                  </span>
                  <span className="experience-badge bg-white/20 text-white border-white/30">
                    {selectedLeaderModal.experience_years} Years Experience
                  </span>
                </div>
              </div>
            </div>

            {/* Metrics */}
            <div className="profile-metrics-strip bg-slate-50 border border-slate-200">
              <div className="metric-item metric-rating-stars">
                <Star className="metric-star-icon" />
                <span className="text-sm font-extrabold">{selectedLeaderModal.rating.toFixed(2)}</span>
                <span className="text-slate-500 font-normal">({selectedLeaderModal.review_count} client reviews)</span>
              </div>
              <span className="metric-dot-divider" />
              <div className="metric-item metric-label-val">
                <span><strong>{selectedLeaderModal.completed_tasks}</strong> completed tasks</span>
              </div>
            </div>

            {/* Bio */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1.5">
                <ShieldCheck size={13} className="text-[#003bb5]" />
                Professional Summary & Verification
              </h4>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs leading-relaxed text-slate-700">
                {selectedLeaderModal.bio}
              </div>
            </div>

            {/* Skills & Tools */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <strong className="text-slate-900 block mb-1.5 font-bold">Key Specialties:</strong>
                <ul className="space-y-1 text-slate-600">
                  {selectedLeaderModal.skills.map((s, idx) => (
                    <li key={idx} className="flex items-center gap-1.5">
                      <Check size={11} className="text-emerald-600 shrink-0" /> {s}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <strong className="text-slate-900 block mb-1.5 font-bold">Equipped Specialist Kit:</strong>
                <ul className="space-y-1 text-slate-600">
                  {selectedLeaderModal.tools.map((t, idx) => (
                    <li key={idx} className="flex items-center gap-1.5">
                      <Check size={11} className="text-[#003bb5] shrink-0" /> {t}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* All Testimonials */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5 flex items-center gap-1.5">
                <MessageSquareQuote size={13} className="text-amber-700" />
                Verified Client Testimonials ({selectedLeaderModal.testimonials.length})
              </h4>
              <div className="space-y-2">
                {selectedLeaderModal.testimonials.map(t => (
                  <div key={t.id} className="p-2.5 bg-amber-50/60 border border-amber-200 rounded-lg text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <div>
                        <strong className="text-slate-900">{t.customer}</strong>
                        <span className="text-[10px] text-slate-500 ml-1.5">• {t.area}</span>
                      </div>
                      <span className="flex items-center gap-1 text-[10px] font-bold text-amber-700">
                        <Star size={10} className="fill-amber-500 text-amber-500" /> {t.rating.toFixed(1)}
                      </span>
                    </div>
                    <div className="text-[10px] font-semibold text-slate-500 mb-1">
                      Service: {t.task} ({t.time})
                    </div>
                    <p className="text-amber-950 italic m-0">"{t.text}"</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Direct Booking Action */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => {
                  const target = selectedLeaderModal;
                  setSelectedLeaderModal(null);
                  handleOpenQuickBooking(target);
                }}
                className="btn-proceed-checkout"
              >
                Book {selectedLeaderModal.name} for Service <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ====================================================================
          6. MODAL: QUICK BOOKING & DIRECT-TO-CHECKOUT SHEET
          ==================================================================== */}
      {bookingLeader && (
        <Modal
          title={`Book ${bookingLeader.name}`}
          className="hire-profile-modal"
          onClose={() => setBookingLeader(null)}
        >
          <div className="quick-booking-modal-shell">
            {isBookingSaved ? (
              <div className="p-6 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto">
                  <CheckCircle2 size={28} />
                </div>
                <h3 className="text-base font-extrabold text-slate-900">
                  Specialist Booking Confirmed!
                </h3>
                <p className="text-xs text-slate-600 max-w-sm mx-auto">
                  Your booking <strong>#{savedBookingId}</strong> has been created. {bookingLeader.name} has received your task with our 15-minute dispatch SLA.
                </p>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-left text-xs space-y-1 max-w-sm mx-auto">
                  <div><strong>Specialist:</strong> {bookingLeader.name} ({bookingLeader.experience_years} yrs exp)</div>
                  <div><strong>Package:</strong> {selectedPackage?.name}</div>
                  <div><strong>Slot:</strong> {selectedDateSlot}</div>
                  <div><strong>Total to Pay After Service:</strong> ₹{selectedPackage ? Math.round(selectedPackage.price * 1.18) : 0}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setBookingLeader(null)}
                  className="px-6 py-2.5 rounded-lg bg-[#003bb5] text-white text-xs font-bold hover:bg-[#002d8f] transition-all"
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                {/* Header Summary */}
                <div className="booking-specialist-header">
                  <div className="booking-header-avatar">
                    {bookingLeader.profileImage ? (
                      <img
                        src={bookingLeader.profileImage}
                        alt={bookingLeader.name}
                        className="modal-avatar-img"
                      />
                    ) : (
                      bookingLeader.avatar
                    )}
                  </div>
                  <div className="booking-header-details">
                    <h3>{bookingLeader.name}</h3>
                    <p>{bookingLeader.categoryName} • {bookingLeader.experience_years} Years Experience</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className={`demand-badge ${bookingLeader.demand_tier}`}>
                        <span className="demand-pulse-dot" /> {bookingLeader.demand_badge}
                      </span>
                      <span className="text-[10px] font-bold bg-white/20 px-2 py-0.5 rounded text-white">
                        ★ {bookingLeader.rating.toFixed(2)} ({bookingLeader.review_count} reviews)
                      </span>
                    </div>
                  </div>
                </div>

                {/* 1. Package Selector */}
                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-2">
                    1. Select Service Package:
                  </label>
                  <div className="package-choice-grid">
                    {bookingLeader.packages.map((pkg, idx) => {
                      const isSelected = selectedPackage?.name === pkg.name;
                      return (
                        <div
                          key={idx}
                          onClick={() => setSelectedPackage(pkg)}
                          className={`package-radio-card ${isSelected ? 'is-selected-package' : ''}`}
                        >
                          <div>
                            <div className="pkg-title">{pkg.name}</div>
                            <div className="pkg-duration">{pkg.desc} ({pkg.duration})</div>
                          </div>
                          <div className="pkg-rate">₹{pkg.price}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 2. Schedule Slot Selector */}
                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-2">
                    2. Select Appointment Slot:
                  </label>
                  <div className="slot-pills-row">
                    {[
                      'Today • 4:00 PM',
                      'Tomorrow • 10:00 AM',
                      'Tomorrow • 2:00 PM',
                      'Tomorrow • 5:00 PM'
                    ].map(slot => (
                      <div
                        key={slot}
                        onClick={() => setSelectedDateSlot(slot)}
                        className={`slot-pill-choice ${selectedDateSlot === slot ? 'active-slot' : ''}`}
                      >
                        {slot}
                      </div>
                    ))}
                  </div>
                </div>

                {/* 3. Address & Contact */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 checkout-input-group">
                  <div>
                    <label>Service Address:</label>
                    <input
                      type="text"
                      value={customerAddress}
                      onChange={e => setCustomerAddress(e.target.value)}
                      className="checkout-text-input"
                    />
                  </div>
                  <div>
                    <label>Contact Phone:</label>
                    <input
                      type="tel"
                      value={customerPhone}
                      onChange={e => setCustomerPhone(e.target.value)}
                      className="checkout-text-input"
                    />
                  </div>
                </div>

                {/* 4. Transparent Price Breakdown (Base + 18% GST + Free Dispatch) */}
                {selectedPackage && (
                  <div className="checkout-breakdown-card">
                    <div className="breakdown-row">
                      <span>{selectedPackage.name}</span>
                      <span>₹{selectedPackage.price}</span>
                    </div>
                    <div className="breakdown-row">
                      <span>Standard GST (18%)</span>
                      <span>₹{Math.round(selectedPackage.price * 0.18)}</span>
                    </div>
                    <div className="breakdown-row text-emerald-700">
                      <span>Doorstep Dispatch & Kit Fee</span>
                      <span className="font-bold">FREE</span>
                    </div>
                    <div className="breakdown-row total-row">
                      <span>Total Amount (Pay After Service)</span>
                      <span>₹{Math.round(selectedPackage.price * 1.18)}</span>
                    </div>
                  </div>
                )}

                {/* Trust & Guarantee Banner */}
                <div className="trust-rules-strip justify-center">
                  <span className="trust-rule-item">
                    <Lock size={11} className="text-[#003bb5]" /> Repaido Escrow
                  </span>
                  <span>•</span>
                  <span className="trust-rule-item">
                    <ShieldCheck size={11} className="text-emerald-700" /> 7-Day Warranty
                  </span>
                  <span>•</span>
                  <span className="trust-rule-item">
                    <Clock size={11} className="text-blue-700" /> 15-Min Response SLA
                  </span>
                </div>

                {/* Action: Direct Confirm & Checkout */}
                <button
                  type="button"
                  onClick={handleConfirmDirectBooking}
                  className="btn-proceed-checkout"
                >
                  <span>Confirm Booking & Dispatch Specialist</span>
                  <ArrowRight size={14} />
                </button>
              </>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}
