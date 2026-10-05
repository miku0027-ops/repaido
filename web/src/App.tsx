import {CouponWelcome} from './components/Coupons';
import OpportunityCarousel,{opportunities} from './components/OpportunityCarousel';
import HomeQuickActions,{type QuickMarket} from './components/HomeQuickActions';
import HomeServiceFinder from './components/HomeServiceFinder';
import {ServiceAccordion} from './components/ServiceAccordion';
import {useSavedTab} from './services/navigation';
import {onIdTokenChanged} from 'firebase/auth';
import {HomeEntry,HomeHub,HomePlans} from './components/HomePlans';
import {HomeGreeting} from './components/HomeGreeting';
import {StoresIcon} from './components/StoresIcon';
import {auth} from './firebase';
import {useCustomerIdentity} from './services/customerIdentity';
import {operation} from './services/operations';
import {PromotionRail,PromotionPreferences,promotionService,type Promotion} from './components/Promotions';
import {Hiring,HireRequests} from './components/Hiring';
import {Marketplace} from './components/Marketplace';
import {HomeServiceDetails} from './components/HomeServiceDetails';
import ServiceStories from './components/ServiceStories';
import {LocalLeaderboard} from './components/LocalLeaderboard';
import {useServiceHydration,ServiceHydration,HydrationControls} from './components/ServiceHydration';
import {RentalManager} from './components/Rentals';
import { apiFetch } from './services/api';
import SearchDiscovery from './components/SearchDiscovery';
import {stopNativeSession} from './services/native';
import {SupportCenter,NotificationInbox} from './components/Lifecycle';
import { CategoryPicks } from './components/ServiceShowcase';
import ReferenceArt from './components/ReferenceArt';
import { CustomerCartDrawer } from './components/CustomerCartDrawer';
import { CustomerNotificationDrawer } from './components/CustomerNotificationDrawer';
import { B2BQuotationPdfModal } from './components/B2BQuotationPdfModal';
import type { B2BQuotation } from './types/b2b';
import { b2bService } from './services/b2bService';
import { cartService } from './services/cartService';
import { TendersPlatform } from './components/TendersPlatform';
import { Fragment, useEffect, useState } from 'react';
import {
  Bell,
  Package,
  ChevronRight,
  MapPin,
  ChevronDown,
  Search,
  ArrowRight,
  Store,
  Home as HomeIcon,
  Grid2X2,
  CalendarDays,
  Headphones,
  User,
  ShieldCheck,
  IndianRupee,
  Repeat2,
  Car,
  Sprout,
  Wrench,
  Sparkles,
  Zap,
  Refrigerator,
  Award,
  BriefcaseBusiness,
  Cog,
  CreditCard,
  FileCheck2,
  GraduationCap,
  MapPinned,
  Star,
  Upload,
  Clock3,
  Phone,
  CheckCircle2,
  Navigation,
  FileText,
  AlertCircle,
  Building,
  Camera,
  Check,
  LayoutGrid,
  Calendar,
  Receipt,
  CalendarCheck,
  Globe,
  Smartphone,
  Check as CheckIcon,
  X as XIcon,
  ArrowLeft,
  LogOut,
  ShoppingBag,
  ShoppingCart,
  Printer
} from 'lucide-react';
import CatalogApp from './CatalogApp';
import { Brand, Modal, Field } from './components/ui';
import RepaidoBrand from './components/RepaidoBrand';
import ServiceImage from './components/ServiceImage';
import { seededServices, seededBookings, cities, formatMoney, formatDuration, getTechnicianProgress, seededWorkers } from './data';
import type { BookingDraft, BookingRecord, CategoryId, ConfirmBooking, Service, WorkerProfile } from './types';
import {
  signInWithGoogle,
  sendPhoneOtp,
  confirmPhoneOtp,
  logoutUser,
  getSavedBookings,
  clearSavedBookings,
  saveBooking,
  updateBookingStatus,
  submitPartnerApplication,
  fetchLiveServices,
  fetchLiveTechnicians,
  fetchUserBookings,
  subscribeToUserBookings,
  getWorkers,
  rateBookingWorker,
  calculateTaskBilling,
  findWorkerByPhone,
  readWorkerSession,
  saveWorkerSession,
  createWorkerFromOnboarding,
  type WorkerOnboardingDraft
} from './services/repaidoService';
import { WorkerPortal } from './components/WorkerPortal';
import LiveWorkerPortal from './components/LiveWorkerPortal';
import LiveBooking from './components/LiveBooking';
import { OperationalJobs } from './components/OperationalJobs';
import OperationsAdmin from './components/OperationsAdmin';
import { SparePartsShop } from './components/SparePartsShop';
import { ShopAdminPortal } from './components/ShopAdminPortal';
import { B2BMarketplace } from './components/B2BMarketplace';
import { CompanyAdminPortal } from './components/CompanyAdminPortal';
import { LocationPickerModal } from './components/LocationPickerModal';
import PartnerRegistration from './components/PartnerRegistration';
import { HomeServicesGrid } from './components/HomeServicesGrid';
import { recordCustomerBrowse } from './services/customerBrowseTracker';
import './reference.css';

type Tab = 'Explore' | 'Services' | 'Bookings' | 'ShopSpares' | 'You' | 'Hire';
type Place = { city: string; address: string; landmark: string; label: string; lat?: number; lng?: number; accuracy?: number; confirmed: boolean };

function read<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}

const defaultPlace: Place = { city: 'Balasore', address: '', landmark: '', label: 'Home', confirmed: false };

// Screenshot-accurate 3-Column Service Category Mapping (with custom extracted 3D graphics)
const homePrimaryServices = [
  {
    id: 'cleaning',
    name: 'Home Cleaning',
    categoryId: 'cleaning' as CategoryId,
    img: '/images/icon-cleaning.png'
  },
  {
    id: 'plumber',
    name: 'Plumbing',
    categoryId: 'plumber' as CategoryId,
    img: '/images/icon-plumbing.png'
  },
  {
    id: 'electrician',
    name: 'Electrician',
    categoryId: 'electrician' as CategoryId,
    img: '/images/icon-electrician.png'
  },
  {
    id: 'ac',
    name: 'Appliance Repair',
    categoryId: 'ac' as CategoryId,
    img: '/images/icon-appliance.png'
  },
  {
    id: 'car',
    name: 'Vehicle Road Assistance',
    categoryId: 'car' as CategoryId,
    img: '/images/icon-vehicle.png'
  },
  {
    id: 'gardening',
    name: 'Gardening Help',
    categoryId: 'cleaning' as CategoryId,
    img: '/images/icon-gardening.png'
  }
];

// Android Category Tiles Mapping
const androidCategories: { id: CategoryId; name: string; icon: any }[] = [
  { id: 'cleaning', name: 'Cleaning', icon: Sparkles },
  { id: 'ac', name: 'AC & App.', icon: Refrigerator },
  { id: 'plumber', name: 'Plumber', icon: Wrench },
  { id: 'electrician', name: 'Electrician', icon: Zap },
  { id: 'car', name: 'Car Wash', icon: Car },
  { id: 'carpenter', name: 'Carpenter', icon: Wrench },
  { id: 'painting', name: 'Painting', icon: Sprout },
  { id: 'salon', name: 'Salon', icon: Sparkles }
];

export default function App() {
  const [homePreferred,setHomePreferred]=useState<{id:string;name:string}>();
  const [hireBookings,setHireBookings]=useState(new URLSearchParams(location.search).has('hiring'));
  const [homeHub,setHomeHub]=useState<string|null>(null),[homePlans,setHomePlans]=useState(new URLSearchParams(location.search).has('home-plan'));
  const [tab,setTab]=useSavedTab<Tab>('repaido.customer.tab',['Explore','Services','Bookings','ShopSpares','You','Hire'],'Explore',(()=>{
    const sp = new URLSearchParams(location.search);
    if (sp.has('booking') || sp.has('home-plan') || sp.has('hiring')) return 'Bookings';
    const t = sp.get('tab')?.toLowerCase();
    if (t === 'hire') return 'Hire';
    if (t === 'shop' || t === 'shopspares' || t === 'marketplace' || t === 'market') return 'ShopSpares';
    if (t === 'services') return 'Services';
    if (t === 'explore') return 'Explore';
    if (t === 'you') return 'You';
    return undefined;
  })());
  const [marketQuick,setMarketQuick]=useState<QuickMarket>({});
  const [storeSection, setStoreSection] = useState<'spares' | 'rentals' | 'exchange' | 'preowned'>(() => {
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      const sec = sp.get('section')?.toLowerCase();
      if (sec === 'rentals' || sec === 'rental') return 'rentals';
      if (sec === 'exchange' || sec === 'swap' || sec === 'c2c') return 'exchange';
      if (sec === 'preowned' || sec === 'refurbished' || sec === 'refurb') return 'preowned';
    }
    return 'spares';
  });
  const [showCartDrawer, setShowCartDrawer] = useState(false);
  const [cartCount, setCartCount] = useState(() => cartService.getItemCount());
  const [marketSubTab, setMarketSubTab] = useState<'spares' | 'tenders' | 'b2b'>(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      const sub = p.get('marketSub') || p.get('sub');
      if (sub === 'b2b' || sub === 'wholesale') return 'b2b';
      if (sub === 'tenders' || sub === 'contracts') return 'tenders';
    }
    return 'spares';
  });

  useEffect(() => {
    const unsub = cartService.subscribe(() => {
      setCartCount(cartService.getItemCount());
    });
    return unsub;
  }, []);

  useEffect(() => {
    recordCustomerBrowse(`tab:${tab}`);
  }, [tab]);

  const openStoreSection = (sec: 'spares' | 'rentals' | 'exchange' | 'preowned') => {
    setMarketQuick({});
    setStoreSection(sec);
    setTab('ShopSpares');
  };
  const [portal, setPortal] = useState<'customer' | 'worker' | 'shop-admin' | 'company-admin'>(() => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname.toLowerCase();
      const params = new URLSearchParams(window.location.search);
      const qPortal = params.get('portal');
      if (path.includes('worker') || qPortal === 'worker') return 'worker';
      if (path.includes('shop-admin') || qPortal === 'shop-admin') return 'shop-admin';
      if (path.includes('company-admin') || qPortal === 'company-admin') return 'company-admin';
    }
    return 'customer';
  });

  const navigatePortal = (target: 'customer' | 'worker' | 'shop-admin' | 'company-admin') => {
    setPortal(target);
    const targetUrl = target === 'customer' ? '/' : `/${target}`;
    window.history.pushState({}, '', targetUrl);
  };

  useEffect(() => {
    if (portal !== 'customer') return;
    const header = document.querySelector('.repaido-home-header');
    if (!header) return;
    const update = () => document.documentElement.style.setProperty('--customer-header-height', `${header.getBoundingClientRect().height}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    const focusSearch = (event: FocusEvent) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== 'search' || input.closest('dialog')) return;
      const dock = input.closest('.uc-header-sticky, .spare-discovery-dock, .rental-search, .market-search, .hire-discovery-dock');
      if (dock) window.scrollTo({top:window.scrollY + dock.getBoundingClientRect().top - header.getBoundingClientRect().height, behavior:'instant'});
    };
    document.addEventListener('focusin', focusSearch);
    return () => { observer.disconnect(); document.removeEventListener('focusin', focusSearch); };
  }, [portal]);

  const handleWorkerLogout = () => {
    saveWorkerSession(null);
    setWorkerSession(null);
    setWorkerNeedsOnboarding(false);
    setWorkerOtpStep('phone');
    setWorkerOtp('');
    setWorkerError('');
    setPortal('customer');
    window.history.pushState({}, '', '/');
  };

  useEffect(() => {
    const handleUrlChange = () => {
      const path = window.location.pathname.toLowerCase();
      const params = new URLSearchParams(window.location.search);
      const qPortal = params.get('portal');
      if (path.includes('worker') || qPortal === 'worker') setPortal('worker');
      else if (path.includes('shop-admin') || qPortal === 'shop-admin') setPortal('shop-admin');
      else if (path.includes('company-admin') || qPortal === 'company-admin') setPortal('company-admin');
      else setPortal('customer');
    };
    window.addEventListener('popstate', handleUrlChange);
    return () => window.removeEventListener('popstate', handleUrlChange);
  }, []);

  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [myRentalsOpen,setMyRentalsOpen]=useState(false);
  const [activeCategory, setActiveCategory] = useState<CategoryId>('all');
  const [homeDetail,setHomeDetail]=useState<Service|null>(null);
  const [marketProfile,setMarketProfile]=useState<'exchange'|'second_hand'|null>(()=>new URLSearchParams(location.search).get('market')==='exchange'?'exchange':new URLSearchParams(location.search).get('market')==='second_hand'?'second_hand':null);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedPromotion,setSelectedPromotion]=useState<string|undefined>();
  const openPromotion=(c:Promotion)=>{if(c.home_service){setSelectedService(null);setSelectedPromotion(undefined);setHomeHub(c.home_service);return;}if(c.service){setSelectedPromotion(c.id);setSelectedService(promotionService(c));}};
  const [bookingStep, setBookingStep] = useState(0);

  // Booking Form State for 4-Step Android Booking Sheet
  const [bookingSlot, setBookingSlot] = useState('Tomorrow, 10:00 AM');
  const [bookingAddress, setBookingAddress] = useState('Plot 42, Station Road, Balasore');
  const [bookingPhone, setBookingPhone] = useState('9876543210');
  const [bookingNotes, setBookingNotes] = useState('');
  const [receiptBooking, setReceiptBooking] = useState<BookingRecord | null>(null);

  const [sheet, setSheet] = useState('');
  const [message, setMessage] = useState('');
  const [workerSession, setWorkerSession] = useState(() => readWorkerSession());
  const [workerPhone, setWorkerPhone] = useState('');
  const [workerOtp, setWorkerOtp] = useState('');
  const [workerOtpStep, setWorkerOtpStep] = useState<'phone' | 'code'>('phone');
  const [workerName, setWorkerName] = useState('');
  const [workerNeedsOnboarding, setWorkerNeedsOnboarding] = useState(false);
  const [workerOnboarding, setWorkerOnboarding] = useState<WorkerOnboardingDraft>({
    name: '',
    phone: '',
    role: 'technician',
    category: 'ac',
    city: 'Balasore',
    experienceYears: 1,
    serviceRadiusKm: 6,
    tools: ['Basic toolkit', 'Safety gloves'],
    skills: ['General service']
  });
  const [workerBusy, setWorkerBusy] = useState(false);
  const [workerError, setWorkerError] = useState('');
  const [place, setPlace] = useState<Place>(() => { const saved = read('repaido.place', defaultPlace); return {...saved, city: saved.city || defaultPlace.city}; });
  const [cityModalOpen, setCityModalOpen] = useState(false);
  const [draft, setDraft] = useState<Place>(place);
  const [large, setLarge] = useState(() => read<boolean>('repaido.large', false));
  const [reduce, setReduce] = useState(() => read<boolean>('repaido.motion', false));
  const [token, setToken] = useState(() => read<string>('repaido.token', ''));
  const [user, setUser] = useState<{ id?: string; name: string; email?: string; phone?: string; photoURL?: string } | null>(() => read('repaido.user', null));
  useEffect(()=>onIdTokenChanged(auth,async current=>{
    if(!current){setUser(null);setToken('');try{localStorage.removeItem('repaido.user');localStorage.removeItem('repaido.token');}catch{}return;}
    setUser({id:current.uid,name:current.displayName||'',email:current.email||undefined,phone:current.phoneNumber||undefined,photoURL:current.photoURL||undefined});
    try{const fresh=await current.getIdToken();if(auth.currentUser?.uid===current.uid)setToken(fresh);}catch{setError('Connection interrupted. Your account is still signed in. Please retry.');}
  }),[]);
  const customerIdentity=useCustomerIdentity(user,portal);
  const [offerSettings,setOfferSettings]=useState(false);
  useEffect(()=>{const campaign=new URLSearchParams(location.search).get('campaign');if(!campaign)return;let alive=true;const body=JSON.stringify({city:place.city,placement:'push'});const load=async()=>{try{await auth.authStateReady();const r=auth.currentUser?await operation<{cards:Promotion[]}>('/campaigns/feed/personal',{method:'POST',body}):await apiFetch('/api/operations/campaigns/feed',{method:'POST',headers:{'Content-Type':'application/json'},body}).then(r=>r.json());const match=r.cards.find((c:Promotion)=>c.id===campaign);if(alive&&match)openPromotion(match);else if(alive)setError('This offer is no longer available. You can still browse regular services.');}catch{if(alive)setError('Offer could not load. Please retry from notifications.');}};void load();return()=>{alive=false;};},[place.city]);
  const [finderSlot] = useState(()=>2+Math.floor(Math.random()*3));
  const hydration = useServiceHydration(user?.id, place.city, tab === 'Explore' && !discoveryOpen);

  // Customer Auth Flow: Create account vs Already Have Account
  const [authMode, setAuthMode] = useState<'create' | 'signin'>('create');
  const [otpPhone, setOtpPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpStep, setOtpStep] = useState<'phone' | 'code'>('phone');
  const [otpUserName, setOtpUserName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [bookingError, setBookingError] = useState('');
  const [records, setRecords] = useState<BookingRecord[]>(() => getSavedBookings([]));
  const [bookingFilter, setBookingFilter] = useState<'active' | 'completed' | 'cancelled'>('active');
  const [activeTrackingBooking, setActiveTrackingBooking] = useState<BookingRecord | null>(null);
  const [activeInvoiceBooking, setActiveInvoiceBooking] = useState<BookingRecord | null>(null);
  const [activeRescheduleBooking, setActiveRescheduleBooking] = useState<BookingRecord | null>(null);
  const [newSlotTime, setNewSlotTime] = useState('Tomorrow, 10:00 AM');
  const [cancelTarget, setCancelTarget] = useState<BookingRecord | null>(null);
  const [spareOrdersOpen, setSpareOrdersOpen] = useState(false);
  const [spareOrders, setSpareOrders] = useState<Array<{ id?: string; status?: string; createdAt?: string; totalPaise?: number; deliveryAddress?: string }>>(() => read('repaido.spare_orders', []));

  // Partner Registration Form State
  const [partnerForm, setPartnerForm] = useState({
    role: 'Technician',
    name: '',
    phone: '',
    email: '',
    dob: '',
    gender: 'Male',
    homeAddress: '',
    serviceCity: 'Balasore',
    serviceRadius: '6 km',
    primarySkill: 'AC & Appliance Repair',
    specializedSkills: '',
    experienceYears: '3',
    toolsList: '',
    toolsPhotosCount: 0,
    aadhaarNumber: '',
    aadhaarUploaded: false,
    panNumber: '',
    panUploaded: false,
    addressProofUploaded: false,
    bankHolder: '',
    bankName: '',
    accountNumber: '',
    confirmAccountNumber: '',
    ifscCode: '',
    upiId: '',
    hourlyRate: '299',
    lat: 21.4934,
    lng: 86.9135
  });

  const [customerMapModalOpen, setCustomerMapModalOpen] = useState(false);
  const [workerMapModalOpen, setWorkerMapModalOpen] = useState(false);
  const [partnerApplicationId, setPartnerApplicationId] = useState('');
  const [servicesList, setServicesList] = useState<Service[]>(seededServices);
  const [techniciansList, setTechniciansList] = useState<WorkerProfile[]>(() => getWorkers());
  const [notificationJob,setNotificationJob]=useState<string|undefined>(()=>new URLSearchParams(location.search).get('booking')||undefined);
  const [showNotificationDrawer, setShowNotificationDrawer] = useState(false);
  const [activeQuotationForPdf, setActiveQuotationForPdf] = useState<B2BQuotation | null>(null);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState<number>(0);

  useEffect(() => {
    let alive = true;
    const fetchUnread = async () => {
      try {
        let unread = 0;
        if (user) {
          const res = await operation<{ notifications: { read_at?: number }[] }>('/notifications');
          if (alive && res?.notifications) {
            unread += res.notifications.filter(n => !n.read_at).length;
          }
        }
        const b2bNotifs = b2bService.getB2BNotifications();
        unread += b2bNotifs.filter((n: any) => !n.read_at).length;
        if (alive) {
          setUnreadNotificationCount(unread);
        }
      } catch {
        const b2bNotifs = b2bService.getB2BNotifications();
        const unread = b2bNotifs.filter((n: any) => !n.read_at).length;
        if (alive) setUnreadNotificationCount(unread);
      }
    };
    void fetchUnread();
    const unsubB2B = b2bService.subscribe(fetchUnread);
    const handleB2BNotif = () => void fetchUnread();
    window.addEventListener('repaido:b2b:notification', handleB2BNotif);
    const timer = setInterval(fetchUnread, 30000);
    return () => {
      alive = false;
      unsubB2B();
      window.removeEventListener('repaido:b2b:notification', handleB2BNotif);
      clearInterval(timer);
    };
  }, [user]);

  const activeBookingCount = records.filter(b => ['requested', 'confirmed', 'on_the_way', 'in_progress'].includes(b.status)).length;
  const notificationCount = Math.max(activeBookingCount, unreadNotificationCount);

  const [ratingBooking, setRatingBooking] = useState<BookingRecord | null>(null);
  const [ratingScore, setRatingScore] = useState<number>(5);
  const [ratingComment, setRatingComment] = useState<string>('');
  const [selectedCompliments, setSelectedCompliments] = useState<string[]>([]);
  const [hasSpareOrders, setHasSpareOrders] = useState(() => read<unknown[]>('repaido.spare_orders', []).length > 0);

  // Firestore Real-Time Data Sync: Load catalog from Cloud Firestore with seamless offline fallback
  useEffect(() => {
    fetchLiveServices().then(svcs => {
      if (svcs && svcs.length > 0) setServicesList(svcs);
    }).catch(() => setError('Live service prices are unavailable. Reopen the app to retry; booking requires the live catalogue.'));
    fetchLiveTechnicians().then(techs => {
      setTechniciansList(techs);
    }).catch(() => { setTechniciansList([]); setError('Nearby professionals could not be loaded. Reopen the app to retry.'); });
  }, []);

  // Sync user's cloud bookings in real-time when authenticated
  useEffect(() => {
    if (user?.id) {
      fetchUserBookings(user.id).then(cloudBookings => {
        if (cloudBookings && cloudBookings.length > 0) {
          setRecords(curr => {
            const map = new Map<string, BookingRecord>();
            curr.forEach(b => map.set(b.id, b));
            cloudBookings.forEach(b => map.set(b.id, b));
            return Array.from(map.values());
          });
        }
      });
      const unsubscribe = subscribeToUserBookings(user.id, (cloudBookings) => {
        if (cloudBookings && cloudBookings.length > 0) {
          setRecords(curr => {
            const map = new Map<string, BookingRecord>();
            curr.forEach(b => map.set(b.id, b));
            cloudBookings.forEach(b => map.set(b.id, b));
            return Array.from(map.values());
          });
        }
      });
      return () => unsubscribe();
    }
  }, [user?.id]);

  useEffect(() => {
    localStorage.setItem('repaido.place', JSON.stringify(place));
  }, [place]);

  useEffect(() => {
    document.documentElement.dataset.theme = 'light';
    localStorage.removeItem('repaido.theme');
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('large-text', large);
    document.documentElement.classList.toggle('reduce-motion', reduce);
    localStorage.setItem('repaido.large', JSON.stringify(large));
    localStorage.setItem('repaido.motion', JSON.stringify(reduce));
  }, [large, reduce]);

  async function api(path: string, init: RequestInit = {}) {
    await auth.authStateReady();
    const freshToken=await auth.currentUser?.getIdToken();
    const response = await apiFetch('/api' + path, {
      ...init,
      signal: AbortSignal.timeout(12000),
      headers: {
        'Content-Type': 'application/json',
        ...(freshToken ? { Authorization: `Bearer ${freshToken}` } : {})
      }
    });
    if (response.status === 401) {
      throw Error('This request needs a valid sign-in. Retry, or sign in again if your session has expired.');
    }
    if (!response.ok) {
      let body;
      try { body = await response.json(); } catch {}
      throw Error(typeof body?.detail === 'string' ? body.detail : 'The service is unavailable. Please try again.');
    }
    return response.status === 204 ? null : response.json();
  }

  const liveConfirmBooking: ConfirmBooking = async (draft: BookingDraft) => {
    if (!token) {
      setSheet('auth');
      throw new Error('Please sign in before paying for a booking.');
    }
    const order = await api('/checkout/booking/order', {
      method: 'POST',
      body: JSON.stringify({
        service_id: draft.items[0]?.service.id,
        city: draft.city,
        address: `${draft.address.name}, ${draft.address.street}, ${draft.address.area}, ${draft.address.pincode}`,
        phone: draft.address.phone,
        starts_at: new Date(`${draft.date}T${draft.time}:00+05:30`).toISOString(),
        idempotency_key: crypto.randomUUID()
      })
    });
    const payment = await new Promise<any>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => {
        const gateway = new (window as any).Razorpay({
          key: order.key_id,
          amount: order.amount_paise,
          currency: order.currency,
          name: 'Repaido',
          description: 'Service booking base fare',
          prefill: { name: draft.address.name, contact: draft.address.phone },
          handler: resolve,
          modal: { ondismiss: () => reject(new Error('Payment was cancelled.')) }
        });
        gateway.open();
      };
      script.onerror = () => reject(new Error('Payment gateway failed to load.'));
      document.body.appendChild(script);
    });
    const booking = await api('/checkout/booking/verify', {
      method: 'POST',
      body: JSON.stringify({ payment_order_id: order.payment_order_id, razorpay_order_id: order.razorpay_order_id, razorpay_payment_id: payment.razorpay_payment_id, razorpay_signature: payment.razorpay_signature })
    });
    await loadBookings();
    return { reference: booking.id, mode: 'live' as const };
  };

  async function loadBookings() {
    setBusy(true);
    setError('');
    try {
      const data = await api('/bookings');
      if (data && Array.isArray(data.bookings) && data.bookings.length > 0) {
        const liveMapped: BookingRecord[] = data.bookings.map((b: any) => ({
          id: b.id,
          serviceId: b.service_id,
          serviceName: b.service_name,
          category: (b.category || 'cleaning') as any,
          city: b.city,
          address: b.address || place.address,
          startsAt: b.starts_at,
          status: b.status as any,
          price: b.price,
          canCancel: ['requested', 'confirmed'].includes(b.status)
        }));
        setRecords(liveMapped);
      }
    } catch {
      setRecords(seededBookings);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const stored = getSavedBookings([]);
    const hasMockBookingData = stored.some(booking =>
      booking.id.startsWith('REP-') &&
      (booking.status === 'on_the_way' || booking.status === 'confirmed' || booking.status === 'completed')
    );

    if (hasMockBookingData) {
      clearSavedBookings();
      setRecords([]);
    }
  }, []);

  useEffect(() => {
    if (tab === 'Bookings' && token) void loadBookings();
  }, [tab, token]);

  function navigate(next: Tab) {
    setTab(next);
    setError('');
    window.scrollTo(0, 0);
  }

  function handleCategoryClick(catId: CategoryId) {
    if(catId!=='all')hydration.event({kind:'category_view',category:catId});
    setActiveCategory(curr => curr === catId ? 'all' : catId);
  }

  function handleOpenBooking(service: Service) {
    hydration.event({kind:'service_view',service_id:service.id});
    setHomeDetail(service);
    setBookingStep(0);
  }

  // Calculation for Worker Pricing Model (Hourly with ₹150 Base Fare vs Fixed) & New User 50% Labor Discount
  const userCompletedBookingsCount = records.filter(b => b.status !== 'cancelled').length;
  const isNewUser = userCompletedBookingsCount === 0;

  const currentAssignedWorker = selectedService
    ? (techniciansList.find(w => w.category === selectedService.category && w.distanceKm <= 6.0) || techniciansList[0])
    : techniciansList[0];
  const workerPricingModel = currentAssignedWorker?.pricingModel || 'hourly';
  const workerBaseFare = currentAssignedWorker?.baseFare || 150;
  const workerHourlyRate = currentAssignedWorker?.hourlyRate || (currentAssignedWorker?.role === 'specialist' ? 499 : 299);
  const workerFixedPrice = currentAssignedWorker?.fixedPrice || 399;
  const estimatedHours = selectedService ? Math.max(1, Math.round((selectedService.duration / 60) * 10) / 10) : 1;

  let computedLabor = 0;
  if (workerPricingModel === 'fixed') {
    computedLabor = workerFixedPrice;
  } else {
    computedLabor = workerBaseFare + Math.round(workerHourlyRate * estimatedHours);
  }

  const baseServicePrice = selectedService ? selectedService.price : 0;
  const laborServiceCharge = computedLabor;
  const materialLogisticsCharge = Math.max(0, baseServicePrice - Math.round(baseServicePrice * 0.70));
  const gstRate = 0.18;
  const newCustomerDiscount = (isNewUser && selectedService) ? Math.round(laborServiceCharge * 0.50) : 0;
  const grossTaskValue = laborServiceCharge + materialLogisticsCharge;
  const workerBonusEligible = (currentAssignedWorker?.taskScore ?? 4.8) >= 4.5;
  const actualPlatformCommission = Math.round(grossTaskValue * 0.15);
  const workerDirectPayout = Math.round(grossTaskValue * 0.75);
  const workerRetentionBonus = workerBonusEligible ? Math.round(grossTaskValue * 0.10) : 0;
  const workerNetPayout = workerDirectPayout + workerRetentionBonus;
  const userWalletCredit = workerBonusEligible ? 0 : Math.round(grossTaskValue * 0.10);
  const platformCommission = Math.round(grossTaskValue * 0.25);
  const taxableSubtotal = Math.max(0, grossTaskValue + actualPlatformCommission);
  const gstAmount = Math.round(taxableSubtotal * gstRate);
  const finalPayablePrice = Math.max(0, taxableSubtotal + gstAmount - newCustomerDiscount);

  const filteredServices = servicesList.filter(s => {
    if (activeCategory !== 'all' && s.category !== activeCategory) return false;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      return `${s.name} ${s.description} ${s.category}`.toLowerCase().includes(q);
    }
    return true;
  });

  const filteredBookings = records.filter(b => {
    if (bookingFilter === 'active') return ['requested', 'confirmed', 'on_the_way', 'in_progress'].includes(b.status);
    if (bookingFilter === 'completed') return b.status === 'completed';
    return b.status === 'cancelled';
  });

  if (portal === 'worker') {
    return (
      <LiveWorkerPortal
        onBack={() => navigatePortal('customer')}
        onOpenB2BMarket={() => {
          navigatePortal('customer');
          setTab('ShopSpares');
          setMarketSubTab('b2b');
        }}
      />
    );
  }
  if (portal === 'shop-admin') {
    return <ShopAdminPortal onBackToMain={() => navigatePortal('customer')} />;
  }
  if (portal === 'company-admin') {
    return <OperationsAdmin onBack={() => navigatePortal('customer')} />;
  }

  return (
    <div className="repaido-customer-shell">
      {/* Invisible reCAPTCHA container for Phone Auth */}
      <div id="recaptcha-container" />

      {/* ===== APP SHELL ===== */}
      <div className="android-app-container">
        <a href="#android-main-content" className="sr-only focus:not-sr-only">Skip to main content</a>

        {/* ===== TOP HEADER ===== */}
        <header className="repaido-home-header">
          <div className="repaido-header-top-row">
            {/* Logo */}
            <div
              className="flex items-center gap-2 cursor-pointer select-none py-1 shrink-0"
              onClick={() => { setTab('Explore'); setActiveCategory('all'); }}
              title="Repaido - Professional Home Services & Repairs"
            >
              <img
                src="/brand/repaido-logo-transparent.png"
                alt="Repaido Logo"
                className="h-8 sm:h-9 w-auto max-w-[140px] object-contain"
              />
            </div>

            {/* Desktop inline search bar — hidden on mobile */}
            <div className="desktop-header-search hidden lg:flex flex-1 mx-8 max-w-xl">
              <div className="repaido-search-bar customer-search-field">
                <Search size={17} className="text-slate-400 shrink-0" />
                <input
                  type="search"
                  placeholder="Search services — AC repair, plumber, cleaning…"
                  value={query}
                  onClick={() => setDiscoveryOpen(true)}
                  onKeyDown={e => { if(e.key==='Enter'||e.key==='ArrowDown') {e.preventDefault();setDiscoveryOpen(true);} }}
                  onChange={e => {setQuery(e.target.value);setDiscoveryOpen(true);}}
                  className="flex-1 min-w-0 bg-transparent text-sm text-slate-800 placeholder-slate-400 outline-none"
                  aria-label="Search for repair or home services"
                />
                {query && (
                  <button onClick={() => setQuery('')} aria-label="Clear search">
                    <XIcon size={14} className="text-slate-400 hover:text-slate-700" />
                  </button>
                )}
              </div>
            </div>

            {/* Header actions */}
            <div className="repaido-header-actions">
              {/* Parts & Equipment Cart Button */}
              <button
                className="repaido-cart-btn relative"
                onClick={() => setShowCartDrawer(true)}
                aria-label={`Shopping cart with ${cartCount} items`}
                title="Parts & Equipment Store Cart"
              >
                <ShoppingCart size={22} aria-hidden="true" />
                {cartCount > 0 && (
                  <span className="repaido-cart-badge-pill" aria-label={`${cartCount} items in cart`}>
                    {cartCount > 99 ? '99+' : cartCount}
                  </span>
                )}
              </button>

              {/* Service updates & Notifications Button */}
              <button
                className="repaido-bell-btn relative"
                onClick={() => setShowNotificationDrawer(true)}
                aria-label={notificationCount > 0 ? `Notifications (${notificationCount} new)` : 'Notifications'}
                title="Service updates and notifications"
              >
                <Bell size={20} aria-hidden="true" />
                {notificationCount > 0 && (
                  <span className="repaido-bell-badge" aria-label={`${notificationCount} notifications`}>
                    {notificationCount > 99 ? '99+' : notificationCount}
                  </span>
                )}
              </button>

              {/* User / Profile Button */}
              {user ? (
                <button onClick={() => setTab('You')} className="repaido-user-avatar-pill relative" title="My Profile" aria-label="My profile">
                  <User size={20} aria-hidden="true" />
                  {(customerIdentity.agentLabel?.includes('pending') || Boolean(partnerApplicationId)) && (
                    <span className="repaido-header-badge repaido-user-badge" aria-label="1 pending application">
                      1
                    </span>
                  )}
                </button>
              ) : (
                <button
                  onClick={() => { setAuthMode('signin'); setSheet('auth'); setError(''); setOtpStep('phone'); setOtpCode(''); }}
                  className="repaido-header-signin-btn relative" aria-label="Sign in" title="Sign in"
                >
                  <User size={20} aria-hidden="true"/>
                </button>
              )}
            </div>
          </div>

        </header>

        {/* ===== MAIN LAYOUT: sidebar + content on desktop, single column on mobile ===== */}
        <main
          id="android-main-content"
          className="android-main-content lg:flex lg:flex-row lg:items-start lg:gap-6 lg:max-w-[1400px] lg:mx-auto lg:px-10 lg:py-8 lg:w-full"
        >

          {/* ===== DESKTOP SIDEBAR (hidden on mobile/tablet, flex column on ≥1024px) ===== */}
          <aside
            className="desktop-sidebar-nav hidden lg:flex flex-col gap-1 shrink-0 sticky top-[73px] self-start"
            aria-label="Desktop Navigation"
          >
            {/* User greeting + location */}
            <div className="px-2 mb-3">
              <p className="text-sm font-bold text-[#17285c] leading-tight">
                {user&&customerIdentity.name?`Hello, ${customerIdentity.name.split(' ')[0]}!`:'Hello there!'}
              </p>
              <button
                className="flex items-center gap-1 text-sm text-slate-500 hover:text-[#17285c] mt-0.5 transition-colors"
                onClick={() => setCityModalOpen(true)}
              >
                <MapPin size={12} />
                <span>{place.address||place.city}</span>
                <ChevronDown size={11} />
              </button>
            </div>

            {/* Nav links */}
            {([
              { id: 'Explore', label: 'Explore', icon: LayoutGrid },
              { id: 'Services', label: 'All Services', icon: Cog },
              { id: 'Bookings', label: 'My Bookings', icon: CalendarDays },
              { id: 'ShopSpares', label: 'Market', icon: StoresIcon },
              { id: 'Hire', label: 'Hire', icon: BriefcaseBusiness },
            ] as { id: Tab; label: string; icon: any }[]).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => { if (id === 'Explore') { setActiveCategory('all'); } setTab(id); }}
                className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  tab === id
                    ? 'bg-[#e8edfa] text-[#17285c]'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-[#17285c]'
                }`}
              >
                <Icon size={18} className={tab === id ? 'text-[#2c50e9]' : 'text-slate-400'} />
                <span className="flex-1 text-left">{label}</span>
                {id === 'Bookings' && records.filter(b => ['requested','confirmed','on_the_way','in_progress'].includes(b.status)).length > 0 && (
                  <span className="text-sm bg-red-500 text-white rounded-full px-1.5 py-0.5 font-bold">
                    {records.filter(b => ['requested','confirmed','on_the_way','in_progress'].includes(b.status)).length}
                  </span>
                )}
              </button>
            ))}

            <div className="h-px bg-slate-200 my-2 mx-2" />

            <button
              className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-semibold text-slate-500 hover:bg-slate-100 hover:text-[#17285c] transition-all"
              onClick={() => { setSheet('support_ticket'); setError(''); }}
            >
              <Headphones size={17} className="text-slate-400" />
              Help & Support
            </button>
            <button
              className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-semibold text-slate-500 hover:bg-slate-100 hover:text-[#17285c] transition-all"
              onClick={() => setShowCartDrawer(true)}
            >
              <ShoppingBag size={17} className="text-slate-400" />
              <span>Parts & Store Cart</span>
              {cartCount > 0 && (
                <span className="ml-auto text-xs bg-blue-600 text-white font-bold px-2 py-0.5 rounded-full">
                  {cartCount}
                </span>
              )}
            </button>
            <button
              className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-semibold text-slate-500 hover:bg-slate-100 hover:text-[#17285c] transition-all"
              onClick={() => setShowNotificationDrawer(true)}
            >
              <Bell size={17} className="text-slate-400" />
              Notifications
              {records.some(b => ['requested','confirmed','on_the_way','in_progress'].includes(b.status)) && (
                <span className="ml-auto w-2 h-2 rounded-full bg-red-500 shrink-0" />
              )}
            </button>

            <div className="h-px bg-slate-200 my-2 mx-2" />

          </aside>

          {/* ===== MAIN PAGE CONTENT (flex-1 on desktop) ===== */}
          <div className="flex-1 min-w-0">

          {/* 1. EXPLORE TAB */}
          {tab === 'Explore' && (
                <div className="android-explore-screen">
                  <HomeGreeting greeting={user&&customerIdentity.name?`Hello, ${customerIdentity.name.split(' ')[0]}!`:'Hello there!'} location={place.address||place.city} onLocation={()=>setCityModalOpen(true)}/>
              <h1 className="sr-only">Home services</h1>
              {/* Search Field */}
              <div className="repaido-search-container">
                <div className="repaido-search-bar">
                  <Search size={20} className="repaido-search-icon" />
                  <input
                    type="search"
                    aria-label="Search for repair or home services"
                    placeholder="Search for repair or home services"
                    value={query}
                    onClick={() => setDiscoveryOpen(true)}
                    onKeyDown={e => {if(e.key==='Enter'||e.key==='ArrowDown'){e.preventDefault();setDiscoveryOpen(true);}}}
                    onChange={e => {setQuery(e.target.value);setDiscoveryOpen(true);}}
                    className="repaido-search-input"
                  />
                  {query && (
                    <button onClick={() => setQuery('')} aria-label="Clear search" className="repaido-search-clear">
                      <XIcon size={16} />
                    </button>
                  )}
                </div>
              </div>

              {!query && (
                <>
                  {/* Desktop: Hero + Trust side-by-side via desktop-hero-row */}
                  <div className="desktop-hero-row">
                    {/* 3. Hero Promo Banner Card */}
                    <div className="repaido-hero-banner-container">
                      <OpportunityCarousel variant="home" slides={[{id:'services',tag:'',title:'',body:'',cta:'Browse services',image:'/images/hero-banner-promo.png',alt:'Trusted help at budget-friendly prices - Local experts. Quality service. Hassle-free booking.',legacy:true},...opportunities]} onOpen={slide=>{if(slide.id==='services'){setActiveCategory('all');setTab('Services');}else if(slide.id==='contracts'){setMarketSubTab('tenders');setTab('ShopSpares');}else if(slide.id==='sell'){openStoreSection('preowned');setMarketQuick({sell:true});}else if(slide.id==='refurbished'){openStoreSection('spares');setMarketQuick({condition:'refurbished'});}else openStoreSection(slide.id as 'rentals'|'exchange');}}/>
                    </div>

                  </div>
                  <HomeQuickActions city={place.city} location={place.confirmed&&typeof place.lat==='number'&&typeof place.lng==='number'?{lat:place.lat,lng:place.lng}:undefined} onLocation={()=>setCustomerMapModalOpen(true)} onMarket={(section,options)=>{openStoreSection(section);setMarketQuick(options||{});}} onHire={()=>setTab('Hire')} onHome={(service,professional)=>{setHomePreferred(professional);setHomeHub(service);}} onService={handleOpenBooking} onCatalogue={()=>{setActiveCategory('all');setTab('Services');}} onOpenCart={()=>setShowCartDrawer(true)}/>
                  <div className="home-promotion-slot"><HomeEntry onOpen={()=>setHomeHub('')}/></div>

                  {/* 3-Column Service Category Grid with Modern Motion Graphics, 3D Option Slides, Offers & Depth Shadows */}
                  <HomeServicesGrid
                    activeCategory={activeCategory}
                    onSelectCategory={catId => {
                      setActiveCategory(catId);
                      setTab('Services');
                    }}
                  />

                  <div className="home-promotion-slot"><PromotionRail city={place.city} onOpen={openPromotion} onSignIn={()=>setSheet('auth')}/></div>
                  {/* Marketplace Sliding Notifier: Buy, Rent, Exchange, Sell */}
                  <div className="marketplace-sliding-notifier-container">
                    <div className="marketplace-sliding-header">
                      <div className="flex items-center gap-2">
                        <span className="live-pulse-dot" aria-hidden="true" />
                        <span className="marketplace-sliding-badge">STORES & MARKETPLACE HUB</span>
                      </div>
                      <button
                        type="button"
                        className="marketplace-explore-all-btn"
                        onClick={() => openStoreSection('spares')}
                      >
                        <span>Explore All</span>
                        <ArrowRight size={13} />
                      </button>
                    </div>

                    <div className="marketplace-sliding-track" role="region" aria-label="Marketplace live categories">
                      <button
                        type="button"
                        className="marketplace-slide-card"
                        onClick={() => openStoreSection('spares')}
                      >
                        <div className="slide-card-icon bg-blue-100 text-blue-700">
                          <ShoppingBag size={20} />
                        </div>
                        <div className="slide-card-info">
                          <strong className="slide-card-title">Buy Spares</strong>
                          <span className="slide-card-desc">Parts from local stores</span>
                        </div>
                        <ArrowRight size={15} className="slide-card-arrow text-blue-600" />
                      </button>

                      <button
                        type="button"
                        className="marketplace-slide-card"
                        onClick={() => openStoreSection('rentals')}
                      >
                        <div className="slide-card-icon bg-emerald-100 text-emerald-700">
                          <Wrench size={20} />
                        </div>
                        <div className="slide-card-info">
                          <strong className="slide-card-title">Rent Tools</strong>
                          <span className="slide-card-desc">Deposit refund after return check</span>
                        </div>
                        <ArrowRight size={15} className="slide-card-arrow text-emerald-600" />
                      </button>

                      <button
                        type="button"
                        className="marketplace-slide-card"
                        onClick={() => openStoreSection('exchange')}
                      >
                        <div className="slide-card-icon bg-purple-100 text-purple-700">
                          <Repeat2 size={20} />
                        </div>
                        <div className="slide-card-info">
                          <strong className="slide-card-title">Direct Swap</strong>
                          <span className="slide-card-desc">1-to-1 Gadget exchange</span>
                        </div>
                        <ArrowRight size={15} className="slide-card-arrow text-purple-600" />
                      </button>

                      <button
                        type="button"
                        className="marketplace-slide-card"
                        onClick={() => openStoreSection('preowned')}
                      >
                        <div className="slide-card-icon bg-amber-100 text-amber-700">
                          <Sparkles size={20} />
                        </div>
                        <div className="slide-card-info">
                          <strong className="slide-card-title">Sell Pre-Owned</strong>
                          <span className="slide-card-desc">New sellers · 90 days free</span>
                        </div>
                        <ArrowRight size={15} className="slide-card-arrow text-amber-600" />
                      </button>
                    </div>
                  </div>

                  <PromotionRail city={place.city} placement="explore" onOpen={openPromotion}/><ServiceStories services={servicesList} selected={activeCategory} onSelect={category=>{hydration.event({kind:'category_view',category});setActiveCategory(category);setTab('Services');}}/>
                </>
              )}

                {/* Android Everyday Essentials / Search Results */}
                <section className="android-services-section">
                  <div className="home-essentials-heading">
                    <h2 className="android-section-title" aria-label={!query&&activeCategory==='all'?'Repaido Assured Home Essentials':undefined}>
                      {query ? 'Search results' : activeCategory === 'all' ? <><span className="repaido-assured-tag"><ShieldCheck size={13} aria-hidden="true"/>Repaido Assured</span><span>Home Essentials</span></> : androidCategories.find(c => c.id === activeCategory)?.name}
                    </h2>
                    {activeCategory !== 'all' && (
                      <button className="android-show-all-btn" onClick={() => setActiveCategory('all')}>
                        Show all
                      </button>
                    )}
                  </div>

                  <div className="android-services-list">
                    {filteredServices.slice(0,query?filteredServices.length:6).map((service,index) => (
                      <Fragment key={service.id}>{!query&&activeCategory==='all'&&index===finderSlot&&<HomeServiceFinder services={servicesList} onPreview={handleOpenBooking}/>}<ServiceAccordion service={service} city={place.city} onPreview={()=>handleOpenBooking(service)} onOffer={openPromotion}/>
                      {!query&&activeCategory==='all'&&(index===3||index===9)&&hydration.feed?.covered&&<ServiceHydration cards={hydration.feed.cards.slice(index===3?0:3,index===3?3:6)} slot={index===3?0:1} onOpen={s=>{hydration.event({kind:'banner_open',service_id:s.id});setHomeDetail(s);}}/>}
                      </Fragment>
                    ))}
                  </div>
                  {!query&&filteredServices.length>6&&<button className="browse-all-services" onClick={()=>setTab('Services')}>See all {filteredServices.length} services <ArrowRight size={16} aria-hidden="true"/></button>}
                  <HydrationControls enabled={hydration.enabled} signedIn={hydration.signedIn} error={hydration.error} pending={hydration.pending} onChange={hydration.refresh} onSignIn={()=>setSheet('auth')}/>

                  <details className="operations" style={{margin:"16px 0"}}><summary>Local leaderboards · verified reviews</summary><LocalLeaderboard/></details><section className="home-discovery-entry"><div><Sparkles size={22}/><h2>Find the right help nearby</h2><p>Compare services, check what’s included, and explore professionals within 8 km.</p></div><button onClick={() => setDiscoveryOpen(true)}>Explore & compare <ArrowRight size={16}/></button></section>
                  <div className="android-footer-slogan">
                    <h3>A little help makes a home.</h3>
                    <p>Pilot catalogue · Appointments require confirmation within 6 km</p>
                  </div>
                </section>
              </div>
            )}

            {/* 2. SERVICES TAB: Urban Company Style Layout */}
            {tab === 'Services' && (
              <div className="catalogue-container">
                <PromotionRail city={place.city} placement="explore" onOpen={openPromotion}/><HomeEntry onOpen={()=>setHomeHub('')}/><CatalogApp nearbyLocation={place.confirmed&&typeof place.lat==='number'&&typeof place.lng==='number'?{lat:place.lat,lng:place.lng,city:place.city}:undefined} filter={activeCategory} search={query} location={place.city} onConfirm={liveConfirmBooking} services={servicesList} onBook={service=>setSelectedService(service)} />
              </div>
            )}

            {tab === 'Bookings' && <div className="customer-bookings-page"><div className="customer-home-plans-switch" role="group" aria-label="Booking service type"><button aria-pressed={!homePlans&&!hireBookings} onClick={()=>{setHomePlans(false);setHireBookings(false);}}><Wrench size={15} aria-hidden="true"/>Visits</button><button aria-pressed={homePlans} onClick={()=>{setHomePlans(true);setHireBookings(false);}}><CalendarDays size={15} aria-hidden="true"/>Home plans & calendar</button><button aria-pressed={hireBookings&&!homePlans} onClick={()=>{setHomePlans(false);setHireBookings(true);}}><BriefcaseBusiness size={15} aria-hidden="true"/>Hiring</button></div>{hireBookings&&!homePlans?<><HireRequests onSignIn={()=>setSheet('auth')} onBooking={id=>setNotificationJob(id)}/><OperationalJobs kind="hiring" key={notificationJob||'hiring'} initialJobId={notificationJob} onSignIn={()=>setSheet('auth')}/></>:homePlans?<HomePlans onSignIn={()=>setSheet('auth')} onJob={id=>{setNotificationJob(id);setHomePlans(false);}}/>:<OperationalJobs kind="visits" key={notificationJob||'bookings'} initialJobId={notificationJob} onSignIn={() => setSheet('auth')} onRebook={draft=>{const service=servicesList.find(s=>s.id===draft.service_id);if(service)setSelectedService(service);else setError('This package is no longer listed. Please choose an available service.');}} />}</div>}

            {/* 4. MARKET: SPARE PARTS & CONTRACT TENDERS */}
            {tab === 'ShopSpares' && (
              <div className="w-full market-experience">
                <div className="market-primary-switch" role="group" aria-label="Marketplace destination">
                  <button
                    className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all ${
                      marketSubTab === 'spares'
                        ? 'bg-[#0f306e] text-white shadow'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    aria-pressed={marketSubTab === 'spares'}
                    onClick={() => setMarketSubTab('spares')}
                  >
                    Marketplace
                  </button>
                  <button
                    className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all ${
                      marketSubTab === 'b2b'
                        ? 'bg-[#0f306e] text-white shadow'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    aria-pressed={marketSubTab === 'b2b'}
                    onClick={() => setMarketSubTab('b2b')}
                  >
                    B2B Wholesale
                  </button>
                  <button
                    className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all ${
                      marketSubTab === 'tenders'
                        ? 'bg-[#0f306e] text-white shadow'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    aria-pressed={marketSubTab === 'tenders'}
                    onClick={() => setMarketSubTab('tenders')}
                  >
                    Contracts
                  </button>
                </div>

                {marketSubTab === 'spares' ? (
                  <SparePartsShop
                    onContracts={()=>setMarketSubTab('tenders')}
                    onSignIn={()=>setSheet('auth')}
                    onBackToExplore={() => setTab('Explore')}
                    authToken={token}
                    initialSection={storeSection}
                    quickIntent={marketQuick}
                    onSectionChange={setStoreSection}
                  />
                ) : marketSubTab === 'b2b' ? (
                  <B2BMarketplace
                    onOpenCart={() => setShowCartDrawer(true)}
                    customerUser={user ? { name: user.name || customerIdentity.name, phone: user.phone || '', email: user.email || '' } : null}
                    onSignIn={() => setSheet('auth')}
                  />
                ) : (
                  <TendersPlatform
                    onOpenContractorPortal={() => {
                      setPortal('worker');
                      window.history.pushState({}, '', '/worker?mode=contractor');
                    }}
                    onOpenB2BMarket={() => setMarketSubTab('b2b')}
                  />
                )}
              </div>
            )}

            {/* 5. YOU / PROFILE TAB (Includes Partner Registration underneath at the bottom) */}
            {tab === 'Hire' && <Hiring services={servicesList} onRequests={()=>{setHomePlans(false);setHireBookings(true);setTab('Bookings');}} onHome={(service,professional)=>{setHomePreferred(professional);setHomeHub(service);}} city={place.city} onSignIn={()=>setSheet('auth')} onBooking={id=>{setNotificationJob(id);setHireBookings(true);setHomePlans(false);setTab('Bookings');}}/>}
            {tab === 'You' && (
              <div className="android-you-screen">
                <div className="android-screen-header">
                  <span className="android-eyebrow">A LITTLE SPACE FOR YOU</span>
                  <h1 className="android-title-large">{user ? customerIdentity.name?`Hello, ${customerIdentity.name}.`:'Hello there!' : 'Make yourself at home.'}</h1>
                </div>

                {user ? (
                  <div className="android-user-card flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <div className="user-avatar-circle">{customerIdentity.name?customerIdentity.name.charAt(0).toUpperCase():<User size={22} aria-hidden="true"/>}</div>
                      <div>
                        <strong>{customerIdentity.accountLabel}</strong>
                        {customerIdentity.agentLabel&&<span className="customer-agent-badge"><BriefcaseBusiness size={13} aria-hidden="true"/>{customerIdentity.agentLabel}</span>}
                        <p className="text-xs text-muted">{user.email}</p>
                      </div>
                    </div>
                    <button
                      className="action-btn danger text-xs py-1 px-3"
                      onClick={async () => {
                        try{await stopNativeSession();await logoutUser();}catch(e){setError((e as Error).message);return;}
                        setUser(null);
                        setToken('');
                      }}
                    >
                      Sign out
                    </button>
                  </div>
                ) : (
                  <div className="android-auth-prompt">
                    <p className="text-sm text-muted mb-3">Save your bookings and keep your home’s to-do list in one place.</p>
                    <button className="navy-button w-full" onClick={() => setSheet('auth')}>
                      Sign in or create account
                    </button>
                  </div>
                )}

                <div className="android-menu-list"><button className="android-menu-item" onClick={()=>setMarketProfile('exchange')}><Package size={20}/><span>Let’s exchange</span><ChevronRight size={18}/></button><button className="android-menu-item" onClick={()=>setMarketProfile('second_hand')}><Package size={20}/><span>Sell a used item</span><ChevronRight size={18}/></button>
                  <button className="android-menu-item" onClick={()=>setMyRentalsOpen(true)}><Package size={20}/><span className="flex-1 text-left">My rentals</span><ChevronRight size={18}/></button>
                  <button className="android-menu-item" onClick={() => setCityModalOpen(true)}>
                    <MapPin size={20} className="text-accent" />
                    <span className="flex-1 text-left">Service location</span>
                    <span className="text-xs text-muted">{place.city}</span>
                  </button>

                  <button className="android-menu-item" onClick={() => navigate('ShopSpares')}>
                    <ShoppingBag size={20} className="text-accent" />
                    <span className="flex-1 text-left">Market · Buy & rent</span>
                    <span className="text-sm bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-bold">Store</span>
                  </button>

                  <button className={`android-menu-item ${hasSpareOrders ? 'my-orders-glow' : ''}`} onClick={() => {
                    const orders = read<Array<{ id?: string; status?: string; createdAt?: string; totalPaise?: number; deliveryAddress?: string }>>('repaido.spare_orders', []);
                    setSpareOrders(orders);
                    setHasSpareOrders(orders.length > 0);
                    setSpareOrdersOpen(true);
                    navigate('ShopSpares');
                  }}>
                    <Receipt size={20} className="text-accent" />
                    <span className="flex-1 text-left">My Orders / Track order</span>
                    {hasSpareOrders && <span className="text-sm bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-bold">Live</span>}
                  </button>

                  <button className="android-menu-item" onClick={() => { setSheet('support_ticket'); setError(''); }}>
                    <Headphones size={20} className="text-accent" />
                    <span className="flex-1 text-left">Help & Support Desk</span>
                  </button>
                  <button className="android-menu-item" onClick={()=>setOfferSettings(true)}><Bell size={20}/><span className="flex-1 text-left">Notifications & offers</span><ChevronRight size={18}/></button>
                  <button className="android-menu-item" onClick={() => navigatePortal('worker')}><span className="flex-1 text-left">Agent / specialist account</span><span className="text-xs">Register or switch →</span></button>
                  <button className="android-menu-item" onClick={() => navigatePortal('shop-admin')}><Store size={20} className="text-accent"/><span className="flex-1 text-left">Shop Partner / B2B Merchant Portal</span><span className="text-xs">Manage & switch →</span></button>
                </div>

                <fieldset className="ui-preferences">
                  <legend>Reading & motion</legend>
                  <label><input type="checkbox" checked={large} onChange={e => setLarge(e.target.checked)} />Larger text</label>
                  <label><input type="checkbox" checked={reduce} onChange={e => setReduce(e.target.checked)} />Reduce animations</label>
                  <p>Your choices are saved on this device. Your device’s reduced-motion setting is always respected.</p>
                </fieldset>

                {offerSettings&&<Modal title="Notifications & offers" className="customer-offer-settings" onClose={()=>setOfferSettings(false)}><PromotionPreferences city={place.city} onSignIn={()=>{setOfferSettings(false);setSheet('auth');}}/></Modal>}


              </div>
            )}
          </div> {/* end desktop-main-content */}
          </main>

          {/* Mobile Bottom Navigation Bar */}
          <nav className="android-bottom-nav md:hidden" aria-label="Bottom Navigation">
            <button
              className={`android-nav-item ${tab === 'Explore' ? 'active' : ''}`}
              onClick={() => navigate('Explore')}
              aria-current={tab === 'Explore' ? 'page' : undefined}
            >
              <LayoutGrid size={22} />
              <span>Explore</span>
            </button>

            <button
              className={`android-nav-item ${tab === 'Services' ? 'active' : ''}`}
              onClick={() => navigate('Services')}
              aria-current={tab === 'Services' ? 'page' : undefined}
            >
              <Cog size={20} strokeWidth={2} aria-hidden="true" />
              <span>Services</span>
            </button>

            <button
              className={`android-nav-item ${tab === 'Bookings' ? 'active' : ''}`}
              onClick={() => navigate('Bookings')}
              aria-current={tab === 'Bookings' ? 'page' : undefined}
            >
              <Calendar size={22} />
              <span>Bookings</span>
            </button>

            <button
              className={`android-nav-item ${tab === 'ShopSpares' ? 'active' : ''}`}
              onClick={() => navigate('ShopSpares')}
              aria-current={tab === 'ShopSpares' ? 'page' : undefined}
            >
              <StoresIcon size={20} />
              <span>Market</span>
            </button>

            <button className={`android-nav-item ${tab === 'Hire' ? 'active' : ''}`} onClick={() => navigate('Hire')} aria-current={tab === 'Hire' ? 'page' : undefined}><BriefcaseBusiness size={20} strokeWidth={2}/><span>Hire</span></button>
          </nav>
        </div>

      {/* Customer Trust & Safety Footer */}
      <footer className="repaido-customer-footer py-12 px-6 border-t border-line">
        <div className="page-width">
          <div className="customer-footer-rail" aria-label="Repaido service information" tabIndex={0}>
            {(tab==='Hire'?[
              ['Reviewed professionals','Explore approved skills and real completed-work reviews.'],
              ['Compare your shortlist','Compare experience, specialties and customer feedback.'],
              ['Choose your plan','Day hiring and recurring Home plans have separate terms.'],
              ['Private profiles','Professional phone numbers and exact locations stay private.']
            ]:tab==='ShopSpares'?[
              ['Buy, rent or exchange','Choose the option that fits your needs.'],
              ['Review item details','Check condition, warranty and seller information.'],
              ['Track your rental','Manage ongoing rentals and returns from your profile.'],
              ['Review before paying','Check delivery, deposits and charges at checkout.']
            ]:tab==='Bookings'?[
              ['Your booking timeline','Track visits, requests and hiring in separate sections.'],
              ['Approve extra work','Review proposed items and charges before approval.'],
              ['Review completion','Confirm the work or report a concern from your booking.'],
              ['Help when needed','Find support and task records inside your booking.']
            ]:[
              ['Professional verification','Professionals complete a platform review before assignments.'],
              ['Pay after service','Review completed work and approved charges before payment.'],
              ['Review the work','Confirm completion or report a concern from your booking.'],
              ['Clear service prices','Review service scope and extras in your itemized bill.']
            ]).map(([title,copy])=><div className="trust-pillar-card" key={title}><ShieldCheck size={20} aria-hidden="true"/><h2>{title}</h2><p>{copy}</p></div>)}
          </div>

          <div className="flex flex-col md:flex-row justify-between items-center gap-6 pt-8 border-t border-slate-200 text-xs text-slate-500">
            <div>
              <RepaidoBrand size="sm" onClick={() => setTab('Explore')} className="mb-2 cursor-pointer" />
              <p>{tab==='Hire'?'Compare experts, explore their work and choose your service.':tab==='Bookings'?'Manage visits, hiring and your Home plans.':tab==='ShopSpares'?'Explore products, rentals and exchanges.':'Home services in your city.'}</p><ul className="footer-city-list"><li>Balasore</li><li>Bhubaneswar</li><li>Cuttack</li></ul>
              <p className="mt-1">Need help with a booking? Open Help & Support Desk in your profile.</p>
            </div>
            <div className="flex flex-wrap items-center gap-5 text-xs text-slate-600">
              <button onClick={() => setTab('Services')} className="hover:text-slate-900 font-medium">Browse services</button>
              <button onClick={() => setTab('Bookings')} className="hover:text-slate-900 font-medium">Track booking</button>
              <button onClick={() => setTab('ShopSpares')} className="hover:text-emerald-800 text-emerald-700 font-bold flex items-center gap-1">
                <ShoppingBag size={13} /> Market · Buy & rent
              </button>
            </div>
          </div>
          <p className="text-sm text-slate-500 mt-6 text-center">
            © 2026 Repaido Technologies Private Limited. All rights reserved.
          </p>
        </div>
      </footer>

      {myRentalsOpen&&<Modal title="My rentals" className="rental-modal" onClose={()=>setMyRentalsOpen(false)}><RentalManager onSignIn={()=>setSheet('auth')}/></Modal>}
      {discoveryOpen && <SearchDiscovery onHomeService={id=>{setDiscoveryOpen(false);setQuery('');setHomeHub(id);}} onEvent={hydration.event} onPreferencesChange={hydration.refresh} query={query} onQuery={setQuery} place={place} signedIn={hydration.signedIn} onClose={()=>{setDiscoveryOpen(false);setQuery('');}} onLocation={()=>{setDiscoveryOpen(false);setCityModalOpen(true);}} onSignIn={()=>{setDiscoveryOpen(false);setSheet('auth');}} onBook={service=>{setDiscoveryOpen(false);setQuery('');setSelectedService(service);}}/>}
      {homeDetail&&<HomeServiceDetails service={homeDetail} onClose={()=>setHomeDetail(null)} onBook={()=>{setSelectedService(homeDetail);setHomeDetail(null);}}/>}
      {marketProfile&&<Modal title={marketProfile==='exchange'?'Let’s exchange':'My used items'} className="market-manager-modal" onClose={()=>setMarketProfile(null)}><Marketplace mode={marketProfile} manage onSignIn={()=>setSheet('auth')}/></Modal>}
      {homeHub!==null&&<HomeHub preferredWorker={homePreferred} onEvent={hydration.event} city={place.city} initialService={homeHub||undefined} onClose={()=>{setHomeHub(null);setHomePreferred(undefined);}} onSignIn={()=>setSheet('auth')} onPlans={()=>{setHomeHub(null);setHomePreferred(undefined);setHomePlans(true);setTab('Bookings');}}/>}
      <CouponWelcome onExplore={scope=>{if(scope==='rental')openStoreSection('rentals');else if(scope==='refurbished'){openStoreSection('spares');setMarketQuick({condition:'refurbished'});}else setTab('Services');}}/>
      {selectedService && <LiveBooking service={selectedService} city={place.city} promotionId={selectedPromotion} onRemovePromotion={()=>setSelectedPromotion(undefined)} onPromotion={openPromotion} onClose={() => {setSelectedService(null);setSelectedPromotion(undefined);}} onSignIn={() => setSheet('auth')} onBooked={() => { setSelectedService(null);setSelectedPromotion(undefined); setTab('Bookings'); }} />}

      {/* Customer Service Location Selector */}
      {cityModalOpen && (
        <Modal
          title="Select Your Service Location"
          onClose={() => setCityModalOpen(false)}
        >
          <div className="space-y-4">
            {/* Option 1: Live Interactive Map Pin */}
            <div className="p-3.5 bg-red-50/80 rounded-2xl border border-red-200 space-y-2">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-red-600 text-white flex items-center justify-center flex-shrink-0">
                  <MapPin size={16} />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900">Live Map Pin</div>
                  <div className="text-sm text-slate-500">Pin exact doorstep location on live Google Map</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCityModalOpen(false);
                  setCustomerMapModalOpen(true);
                }}
                className="w-full py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-xs transition-all cursor-pointer"
              >
                <MapPin size={14} />
                <span>Open Live Map & Set Exact Pin</span>
              </button>
            </div>

            {/* Option 2: Select City from List */}
            <div className="space-y-1.5">
              <div className="text-sm uppercase font-bold text-slate-400 px-1">
                Or Select Your City From List:
              </div>
              <div className="city-picker-list max-h-56 overflow-y-auto divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                {cities.map(c => (
                  <button
                    key={c}
                    className={`w-full px-3.5 py-2.5 text-left text-xs font-semibold flex items-center justify-between transition-colors ${
                      place.city === c ? 'bg-emerald-50 text-emerald-800' : 'hover:bg-slate-50 text-slate-700'
                    }`}
                    onClick={() => {
                      setPlace(prev => ({ ...prev, city: c }));
                      setCityModalOpen(false);
                    }}
                  >
                    <span>{c}</span>
                    {place.city === c && <CheckIcon size={16} className="text-emerald-600" />}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Partner Registration Modal (Specialist & Technician) */}
      {sheet === 'partner_registration' && (
        <PartnerRegistration onClose={() => setSheet('')} />
      )}

      {sheet === 'Register as specialist/technician' && (
        <Modal
          title="Partner Registration — Specialist & Technician"
          onClose={() => { setSheet(''); setError(''); }}
        >
          <form
            className="worker-registration-form"
            onSubmit={async e => {
              e.preventDefault();
              setError('');
              if (partnerForm.name.trim().length < 2) {
                setError('Please enter your full legal name.');
                return;
              }
              const cleanPhone = partnerForm.phone.trim().replace(/\D/g, '');
              if (cleanPhone.length !== 10) {
                setError('Please enter a valid 10-digit mobile number.');
                return;
              }
              if (!partnerForm.dob) {
                setError('Please enter your date of birth.');
                return;
              }
              if (partnerForm.homeAddress.trim().length < 8) {
                setError('Please enter your complete home address (at least 8 characters).');
                return;
              }
              if (partnerForm.aadhaarNumber && !/^\d{12}$/.test(partnerForm.aadhaarNumber.trim().replace(/\s/g, ''))) {
                setError('Aadhaar number must be exactly 12 digits.');
                return;
              }
              if (partnerForm.panNumber && !/^[A-Za-z]{5}[0-9]{4}[A-Za-z]{1}$/.test(partnerForm.panNumber.trim())) {
                setError('PAN number must follow standard format (e.g. ABCDE1234F).');
                return;
              }
              if (!/^\d{9,18}$/.test(partnerForm.accountNumber.trim())) {
                setError('Please enter a valid bank account number (9 to 18 digits).');
                return;
              }
              if (!/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(partnerForm.ifscCode.trim())) {
                setError('Please enter a valid 11-character IFSC code (e.g. SBIN0001234).');
                return;
              }

              const parsedRate = Number(partnerForm.hourlyRate);
              if (!parsedRate || parsedRate < 150) {
                setError('Please specify a valid hourly visiting rate (minimum ₹150/hr).');
                return;
              }

              try {
                setBusy(true);
                const appId = await submitPartnerApplication({
                  role: partnerForm.role as 'Specialist' | 'Technician',
                  name: partnerForm.name.trim(),
                  phone: cleanPhone,
                  dob: partnerForm.dob,
                  gender: partnerForm.gender,
                  email: partnerForm.email.trim(),
                  homeAddress: partnerForm.homeAddress.trim(),
                  serviceRadiusKm: 6,
                  tradeCategory: partnerForm.primarySkill,
                  experienceYears: Number(partnerForm.experienceYears) || 1,
                  toolsList: partnerForm.toolsList,
                  toolPhotosCount: partnerForm.toolsPhotosCount,
                  aadhaarNumber: partnerForm.aadhaarNumber,
                  panNumber: partnerForm.panNumber.toUpperCase(),
                  bankName: partnerForm.bankName || 'Partner Bank',
                  accountHolderName: partnerForm.bankHolder || partnerForm.name,
                  accountNumber: partnerForm.accountNumber,
                  ifscCode: partnerForm.ifscCode.toUpperCase(),
                  upiId: partnerForm.upiId,
                  hourlyRate: parsedRate,
                  lat: partnerForm.lat || 21.4934,
                  lng: partnerForm.lng || 86.9135
                });
                setPartnerApplicationId(appId);
                setSheet('partner_registered_success');
              } catch (err: any) {
                setError(err?.message || 'Submission failed. Please check your network and try again.');
              } finally {
                setBusy(false);
              }
            }}
          >
            <p className="form-intro">
              Join India’s most trusted home services platform. Please provide your verified details, tools inventory, KYC identification, and bank account for payment reception.
            </p>

            {error && <p className="error-banner" role="alert">{error}</p>}

            {/* 1. Role Selection */}
            <div className="form-section-box">
              <span className="section-step-badge">STEP 1: ROLE SELECTION</span>
              <p className="text-xs text-muted mb-2">Select your entry tier on Repaido platform:</p>
              <div className="grid grid-cols-2 gap-3">
                <label className={`role-select-card ${partnerForm.role === 'Technician' ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="partner_role"
                    value="Technician"
                    checked={partnerForm.role === 'Technician'}
                    onChange={() => setPartnerForm({ ...partnerForm, role: 'Technician', hourlyRate: partnerForm.hourlyRate === '499' ? '299' : partnerForm.hourlyRate })}
                  />
                  <div className="role-title">Technician</div>
                  <div className="role-subtitle">Entry Tier • ₹299/hr standard rate</div>
                </label>

                <label className={`role-select-card ${partnerForm.role === 'Specialist' ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="partner_role"
                    value="Specialist"
                    checked={partnerForm.role === 'Specialist'}
                    onChange={() => setPartnerForm({ ...partnerForm, role: 'Specialist', hourlyRate: partnerForm.hourlyRate === '299' ? '499' : partnerForm.hourlyRate })}
                  />
                  <div className="role-title">Specialist ★</div>
                  <div className="role-subtitle">Master Tier • ₹499/hr priority rate</div>
                </label>
              </div>
            </div>

            {/* 2. Personal Particulars */}
            <div className="form-section-box">
              <span className="section-step-badge">STEP 2: PERSONAL PARTICULARS</span>
              <Field
                id="w-name"
                label="Full Legal Name (as per Aadhaar)"
                required
                placeholder="e.g. Subhankar Jena"
                value={partnerForm.name}
                onChange={e => setPartnerForm({ ...partnerForm, name: e.target.value })}
              />
              <div className="grid grid-cols-2 gap-3 mt-2">
                <Field
                  id="w-phone"
                  label="Primary Mobile (WhatsApp)"
                  required
                  type="tel"
                  placeholder="10-digit number"
                  value={partnerForm.phone}
                  onChange={e => setPartnerForm({ ...partnerForm, phone: e.target.value })}
                />
                <Field
                  id="w-dob"
                  label="Date of Birth"
                  required
                  type="date"
                  value={partnerForm.dob}
                  onChange={e => setPartnerForm({ ...partnerForm, dob: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3 mt-2">
                <label className="field-group">
                  <span className="field-label">Gender</span>
                  <select
                    className="field"
                    value={partnerForm.gender}
                    onChange={e => setPartnerForm({ ...partnerForm, gender: e.target.value })}
                  >
                    <option>Male</option>
                    <option>Female</option>
                    <option>Other</option>
                  </select>
                </label>
                <Field
                  id="w-email"
                  label="Email Address"
                  type="email"
                  value={partnerForm.email}
                  onChange={e => setPartnerForm({ ...partnerForm, email: e.target.value })}
                />
              </div>
            </div>

            {/* 3. Location & Base */}
            <div className="form-section-box">
              <span className="section-step-badge">STEP 3: HOME LOCATION & BASE</span>
              <Field
                id="w-home-addr"
                label="Home Address & Permanent Residence"
                required
                placeholder="House / Flat, Street, Area, Landmark"
                value={partnerForm.homeAddress}
                onChange={e => setPartnerForm({ ...partnerForm, homeAddress: e.target.value })}
              />
              <div className="grid grid-cols-2 gap-3 mt-2">
                <label className="field-group">
                  <span className="field-label">Service Base City</span>
                  <select
                    className="field"
                    value={partnerForm.serviceCity}
                    onChange={e => setPartnerForm({ ...partnerForm, serviceCity: e.target.value })}
                  >
                    {cities.map(c => <option key={c}>{c}</option>)}
                  </select>
                </label>
                <label className="field-group">
                  <span className="field-label">Service Coverage Radius</span>
                  <select
                    className="field"
                    value={partnerForm.serviceRadius}
                    onChange={e => setPartnerForm({ ...partnerForm, serviceRadius: e.target.value })}
                  >
                    <option>Within 6 km (Standard Guaranteed)</option>
                    <option>Within 3 km (Immediate Local)</option>
                  </select>
                </label>
              </div>

              {/* Exact Pin Location on Leaflet Google Map */}
              <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <MapPin size={14} className="text-red-600" />
                    <span>Exact Technician Base Pin (Live Google Map)</span>
                  </div>
                  <div className="text-sm text-slate-500 font-mono mt-0.5">
                    {partnerForm.lat && partnerForm.lng
                      ? `Pinned: ${partnerForm.lat.toFixed(4)}° N, ${partnerForm.lng.toFixed(4)}° E`
                      : 'Not set yet (Default: Balasore Central)'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setWorkerMapModalOpen(true)}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg transition-all shadow-xs flex items-center gap-1"
                >
                  <MapPin size={13} />
                  <span>Set Pin on Map</span>
                </button>
              </div>
            </div>

            {/* 4. Skills & Tool Kit Pictures */}
            <div className="form-section-box">
              <span className="section-step-badge">STEP 4: SKILLS & TOOL KIT PICTURES</span>
              <div className="grid grid-cols-2 gap-3">
                <label className="field-group">
                  <span className="field-label">Primary Trade Skill</span>
                  <select
                    className="field"
                    value={partnerForm.primarySkill}
                    onChange={e => setPartnerForm({ ...partnerForm, primarySkill: e.target.value })}
                  >
                    <option>AC & Appliance Repair</option>
                    <option>Plumbing & Pipe Fitting</option>
                    <option>Electrical & Wiring</option>
                    <option>Deep Cleaning & Sanitisation</option>
                    <option>Carpentry & Assembly</option>
                    <option>Car Wash & Detailing</option>
                  </select>
                </label>
                <label className="field-group">
                  <span className="field-label">Years of Experience</span>
                  <select
                    className="field"
                    value={partnerForm.experienceYears}
                    onChange={e => setPartnerForm({ ...partnerForm, experienceYears: e.target.value })}
                  >
                    <option value="1">1 Year</option>
                    <option value="2">2 Years</option>
                    <option value="3">3 Years</option>
                    <option value="5">5+ Years (Specialist Eligible)</option>
                    <option value="8">8+ Years (Senior Specialist)</option>
                  </select>
                </label>
              </div>

              <Field
                id="w-tools-owned"
                label="Tools Owned Inventory (List main equipment)"
                placeholder="Drill, Pipe wrench, Multimeter, Pressure washer, etc."
                value={partnerForm.toolsList}
                onChange={e => setPartnerForm({ ...partnerForm, toolsList: e.target.value })}
              />

              <div className="doc-upload-box mt-3">
                <Camera size={20} className="text-accent" />
                <div>
                  <strong>Upload Tool Kit Photos (Clear pictures of your tools)</strong>
                  <p className="text-xs text-muted">Upload photos of your tool kit and equipment.</p>
                </div>
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  aria-label="Upload tool kit photos"
                  onChange={e => setPartnerForm({ ...partnerForm, toolsPhotosCount: e.target.files?.length || 0 })}
                />
                {partnerForm.toolsPhotosCount > 0 && (
                  <span className="upload-success-chip">✓ {partnerForm.toolsPhotosCount} Tool Photos Selected</span>
                )}
              </div>
            </div>

            {/* 4B. Hourly Service Rate & Repaido 3% Platform Payout Model */}
            <div className="form-section-box">
              <span className="section-step-badge">STEP 4B: PER-HOUR RATE & REPAIDO PLATFORM PAYOUT</span>
              <p className="text-xs text-muted mb-2">
                Specify your per-hour visiting & labor charge. Repaido charges 3% of the task value after successful task completion. You receive 97% directly into your bank account or UPI.
              </p>
              <Field
                id="w-hourly-rate"
                label={`Your Desired Hourly Charge (₹/hr) — Recommended: ₹${partnerForm.role === 'Specialist' ? '499' : '299'}/hr`}
                required
                type="number"
                min={150}
                max={2500}
                value={partnerForm.hourlyRate}
                onChange={e => setPartnerForm({ ...partnerForm, hourlyRate: e.target.value })}
              />

              {Number(partnerForm.hourlyRate) > 0 && (
                <div className="payout-simulator-box mt-3">
                  <div className="payout-simulator-title">
                    <Sparkles size={14} className="text-accent" />
                    Task Payout Simulator (Sample 2-Hour Task)
                  </div>
                  <div className="payout-row">
                    <span>Worker Hourly Rate</span>
                    <strong>₹{Number(partnerForm.hourlyRate)}/hr</strong>
                  </div>
                  <div className="payout-row">
                    <span>Gross Task Earnings (2 Hours)</span>
                    <span>₹{Number(partnerForm.hourlyRate) * 2}</span>
                  </div>
                  <div className="payout-row">
                    <span>Repaido Platform Commission (3%)</span>
                    <span className="commission-badge">3% Charged Post-Task (-₹{Math.round(Number(partnerForm.hourlyRate) * 2 * 0.03)})</span>
                  </div>
                  <div className="payout-row highlight">
                    <span>Your Net Direct Payout (97%)</span>
                    <strong>₹{Math.round(Number(partnerForm.hourlyRate) * 2 * 0.97)}</strong>
                  </div>
                </div>
              )}
            </div>

            {/* 5. KYC Documents */}
            <div className="form-section-box">
              <span className="section-step-badge">STEP 5: AADHAAR, PAN & ADDRESS PROOF</span>
              <div className="grid grid-cols-2 gap-3">
                <Field
                  id="w-aadhaar"
                  label="12-Digit Aadhaar Card Number"
                  required
                  inputMode="numeric"
                  placeholder="XXXX XXXX XXXX"
                  value={partnerForm.aadhaarNumber}
                  onChange={e => setPartnerForm({ ...partnerForm, aadhaarNumber: e.target.value })}
                />
                <Field
                  id="w-pan"
                  label="10-Character PAN Card Number"
                  required
                  placeholder="ABCDE1234F"
                  value={partnerForm.panNumber}
                  onChange={e => setPartnerForm({ ...partnerForm, panNumber: e.target.value.toUpperCase() })}
                />
              </div>

              <div className="grid grid-cols-3 gap-2 mt-3">
                <label className="kyc-upload-pill">
                  <FileCheck2 size={18} className="text-accent" />
                  <span>Aadhaar Photo</span>
                  <input
                    type="file"
                    accept="image/*"
                    aria-label="Upload Aadhaar card image"
                    onChange={() => setPartnerForm({ ...partnerForm, aadhaarUploaded: true })}
                  />
                  {partnerForm.aadhaarUploaded && <span className="verified-check">✓ Uploaded</span>}
                </label>

                <label className="kyc-upload-pill">
                  <CreditCard size={18} className="text-accent" />
                  <span>PAN Card Photo</span>
                  <input
                    type="file"
                    accept="image/*"
                    aria-label="Upload PAN card image"
                    onChange={() => setPartnerForm({ ...partnerForm, panUploaded: true })}
                  />
                  {partnerForm.panUploaded && <span className="verified-check">✓ Uploaded</span>}
                </label>

                <label className="kyc-upload-pill">
                  <MapPinned size={18} className="text-accent" />
                  <span>Address Proof</span>
                  <input
                    type="file"
                    accept="image/*"
                    aria-label="Upload address proof image"
                    onChange={() => setPartnerForm({ ...partnerForm, addressProofUploaded: true })}
                  />
                  {partnerForm.addressProofUploaded && <span className="verified-check">✓ Uploaded</span>}
                </label>
              </div>
            </div>

            {/* 6. Bank Details */}
            <div className="form-section-box">
              <span className="section-step-badge">STEP 6: BANK DETAILS FOR PAYMENT RECEIPT</span>
              <p className="text-xs text-muted mb-2">
                All customer earnings and weekly payouts are deposited directly into this bank account.
              </p>
              <Field
                id="w-bank-name"
                label="Bank Name (e.g. State Bank of India, HDFC Bank)"
                required
                value={partnerForm.bankName}
                onChange={e => setPartnerForm({ ...partnerForm, bankName: e.target.value })}
              />
              <Field
                id="w-bank-holder"
                label="Account Holder Name (as per Bank Passbook)"
                required
                value={partnerForm.bankHolder}
                onChange={e => setPartnerForm({ ...partnerForm, bankHolder: e.target.value })}
              />
              <div className="grid grid-cols-2 gap-3 mt-2">
                <Field
                  id="w-bank-acc"
                  label="Bank Account Number"
                  required
                  inputMode="numeric"
                  value={partnerForm.accountNumber}
                  onChange={e => setPartnerForm({ ...partnerForm, accountNumber: e.target.value })}
                />
                <Field
                  id="w-bank-ifsc"
                  label="IFSC Code"
                  required
                  placeholder="SBIN0000123"
                  value={partnerForm.ifscCode}
                  onChange={e => setPartnerForm({ ...partnerForm, ifscCode: e.target.value.toUpperCase() })}
                />
              </div>
              <Field
                id="w-upi"
                label="UPI ID for Instant Daily Payouts (Optional)"
                placeholder="yourname@okhdfcbank"
                value={partnerForm.upiId}
                onChange={e => setPartnerForm({ ...partnerForm, upiId: e.target.value })}
              />
            </div>

            <div className="partner-submit-row">
              <button className="navy-button w-full py-4 text-base" type="submit">
                Send application
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Partner Registration Success Dialog */}
      {sheet === 'partner_registered_success' && (
        <Modal
          title="Application Received — Welcome to Repaido"
          onClose={() => setSheet('')}
        >
          <div className="partner-success-modal">
            <div className="success-icon-badge">
              <CheckCircle2 size={44} className="text-emerald" />
            </div>
            <h3 className="text-xl font-bold text-ink">Application Reference: {partnerApplicationId}</h3>
            <p className="text-sm text-muted mt-2">
              Thank you, <strong>{partnerForm.name}</strong>! Your partner application as a <strong>{partnerForm.role}</strong> has been registered with Repaido Operations.
            </p>

            <div className="next-steps-card mt-4">
              <h4 className="font-bold text-ink text-sm">What happens next:</h4>
              <ul className="next-steps-list">
                <li><strong>1. Document Verification:</strong> Our onboarding team will verify your Aadhaar, PAN and Bank IFSC within 24 hours.</li>
                <li><strong>2. Tool Kit Verification:</strong> Your submitted tool photos and equipment list will be assessed.</li>
                <li>
                  <strong>3. Onboarding & Points:</strong>
                  {partnerForm.role === 'Technician'
                    ? ' You will start at Level 1 Technician. Every 5-star job earns +100 points towards your Specialist promotion and official Repaido Specialist Pro Kit!'
                    : ' Once your 5+ years experience and equipment are verified, your Senior Specialist badge will activate.'}
                </li>
                <li><strong>4. Payouts & Commission:</strong> Registered hourly rate: ₹{partnerForm.hourlyRate || 349}/hr. Repaido charges 3% of task value post-completion; 97% net earnings are credited directly to your bank account ({partnerForm.accountNumber}).</li>
              </ul>
            </div>

            <button className="button-primary w-full mt-6" onClick={() => setSheet('')}>
              Done & Return to App
            </button>
          </div>
        </Modal>
      )}

      {spareOrdersOpen && (
        <Modal
          title="My Orders & Tracking"
          onClose={() => setSpareOrdersOpen(false)}
        >
          <div className="space-y-3">
            {spareOrders.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                <ShoppingBag className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                <p className="text-sm font-semibold text-slate-700">No spare-part orders yet</p>
                <p className="text-xs text-slate-500 mt-1">Your order history and live tracking will appear here after checkout.</p>
              </div>
            ) : (
              spareOrders.map((order, index) => (
                <div key={order.id || `order-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm uppercase tracking-[0.12em] text-slate-500">Order ID</div>
                      <div className="font-mono text-xs font-bold text-slate-800">{order.id || 'REPAIDO-ORDER'}</div>
                    </div>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-sm font-bold text-emerald-700">
                      {order.status || 'confirmed'}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-slate-600">
                    <div>
                      <div className="text-sm uppercase tracking-[0.12em] text-slate-400">Placed</div>
                      <div className="font-medium">{order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Today'}</div>
                    </div>
                    <div>
                      <div className="text-sm uppercase tracking-[0.12em] text-slate-400">Total</div>
                      <div className="font-medium">₹{order.totalPaise ? (order.totalPaise / 100).toFixed(2) : '0.00'}</div>
                    </div>
                  </div>

                  <div className="mt-3 text-sm text-slate-600">
                    <div className="text-sm uppercase tracking-[0.12em] text-slate-400">Delivery</div>
                    <div className="mt-1">{order.deliveryAddress || 'Station Square, Balasore, Odisha 756001'}</div>
                  </div>

                  <button
                    type="button"
                    className="mt-3 w-full rounded-lg bg-[#2874f0] px-3 py-2 text-xs font-bold text-white"
                    onClick={() => {
                      setSpareOrdersOpen(false);
                      setTab('ShopSpares');
                    }}
                  >
                    View live tracking
                  </button>
                </div>
              ))
            )}
          </div>
        </Modal>
      )}

      {/* Live Tracking Modal */}
      {activeTrackingBooking && (
        <Modal
          title={`Tracking — ${activeTrackingBooking.serviceName}`}
          onClose={() => setActiveTrackingBooking(null)}
        >
          <div className="tracking-modal-content">
            <div className="tracking-map-sim">
              <div className="sim-map-grid" />
              <div className="route-line" />
              <div className="pulse-user-pin">
                <MapPin size={20} className="text-accent" />
                <span>Your Home</span>
              </div>
              <div className="pulse-worker-pin">
                <Navigation size={20} className="text-emerald" />
                <span>{activeTrackingBooking.worker?.name || 'Technician'} ({activeTrackingBooking.etaMinutes || 20}m)</span>
              </div>
            </div>

            <div className="tracking-status-info">
              <div className="tracking-hero-row">
                <div>
                  <div className="tracking-status-kicker">On the way</div>
                  <h3 className="text-lg font-bold text-ink">Estimated Arrival: ~{activeTrackingBooking.etaMinutes || 20} mins</h3>
                  <p className="text-xs text-muted">{activeTrackingBooking.worker?.name || 'Technician'} is heading to your location from Balasore Hub ({activeTrackingBooking.worker?.distanceKm || 2} km away)</p>
                </div>
                <span className="live-pulse-badge">LIVE GPS</span>
              </div>

              <div className="tracking-metrics-row">
                <div className="tracking-metric-card">
                  <span className="metric-label">ETA</span>
                  <strong>{activeTrackingBooking.etaMinutes || 20} min</strong>
                </div>
                <div className="tracking-metric-card">
                  <span className="metric-label">Distance</span>
                  <strong>{activeTrackingBooking.worker?.distanceKm || 2} km</strong>
                </div>
                <div className="tracking-metric-card">
                  <span className="metric-label">Status</span>
                  <strong>On route</strong>
                </div>
              </div>

              <div className="delivery-progress-card">
                <div className="progress-head">
                  <span>Order progress</span>
                  <strong>72%</strong>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" />
                </div>
                <div className="progress-steps">
                  <span className="done">Assigned</span>
                  <span className="done">En route</span>
                  <span className="current">At your door</span>
                </div>
              </div>

              {activeTrackingBooking.worker && (
                <div className="worker-contact-card mt-4">
                  <div className="worker-banner-avatar">{activeTrackingBooking.worker.avatar}</div>
                  <div className="flex-1">
                    <strong>{activeTrackingBooking.worker.name}</strong>
                    <span className="block text-xs text-muted">
                      {activeTrackingBooking.worker.role === 'specialist' ? '⭐ Senior Specialist' : '🔧 Junior Technician'} · ★ {activeTrackingBooking.worker.taskScore}
                    </span>
                    <span className="block text-xs text-emerald font-semibold">
                      Vaccinated · Aadhaar Verified · Safety Kit Equipped
                    </span>
                  </div>
                  <a
                    href={`tel:${activeTrackingBooking.worker.phone}`}
                    className="call-worker-btn"
                    aria-label={`Call ${activeTrackingBooking.worker.name}`}
                  >
                    <Phone size={16} /> Call
                  </a>
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Invoice Modal */}
      {activeInvoiceBooking && (
        <Modal
          title={`Tax Invoice & Service Statement — ${activeInvoiceBooking.id}`}
          onClose={() => setActiveInvoiceBooking(null)}
        >
          <div className="invoice-modal-content">
            <div className="invoice-header-box flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-200">
              <div className="flex items-center gap-2">
                <img
                  src="/brand/repaido-logo-transparent.png"
                  alt="Repaido"
                  className="h-8 w-auto object-contain"
                />
                <span className="text-sm uppercase font-bold tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  Tax Invoice
                </span>
              </div>
              <div className="text-right">
                <span className="invoice-date block text-xs font-semibold text-slate-800">
                  {new Date(activeInvoiceBooking.startsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
                <span className="text-sm text-slate-500">Ref: {activeInvoiceBooking.id}</span>
              </div>
            </div>

            {(() => {
              const baseFare = activeInvoiceBooking.baseFare || 150;
              const serviceValue = activeInvoiceBooking.laborCharge || activeInvoiceBooking.price || 0;
              const materialValue = activeInvoiceBooking.materialCharge || 0;
              const platformFee = activeInvoiceBooking.platformCommission || Math.round((serviceValue + materialValue) * 0.03);
              const taxableValue = Math.max(0, serviceValue + materialValue + platformFee);
              const gstAmount = Math.round(taxableValue * 0.18);
              const discountAmount = activeInvoiceBooking.discountAmount || 0;
              const finalTotal = Math.max(0, serviceValue + materialValue + platformFee + gstAmount - discountAmount);

              return (
                <div className="invoice-details-table my-3">
                  <div className="table-row head font-bold text-xs bg-slate-100 p-2 rounded">
                    <span>Description & Fare Breakdown</span>
                    <span>Amount</span>
                  </div>
                  <div className="table-row">
                    <div>
                      <strong>{activeInvoiceBooking.serviceName}</strong>
                      <p className="text-xs text-muted">Includes verified technician dispatch, equipment inspection & diagnosis</p>
                    </div>
                    <strong>{formatMoney(serviceValue)}</strong>
                  </div>

                  <div className="table-row text-xs">
                    <span>Base Fare</span>
                    <span className="font-semibold text-slate-700">₹{baseFare}</span>
                  </div>

                  {activeInvoiceBooking.pricingModel === 'fixed' ? (
                    <div className="table-row text-xs">
                      <span>Scope Mode: Fixed Project Fare</span>
                      <span className="font-semibold text-slate-700">Flat ₹{activeInvoiceBooking.fixedPrice || serviceValue}</span>
                    </div>
                  ) : (
                    <div className="table-row text-xs">
                      <span>Hourly Billing: Base Fare ₹{baseFare} + Rate</span>
                      <span className="font-semibold text-slate-700">₹{activeInvoiceBooking.workerHourlyRate || 299}/hr</span>
                    </div>
                  )}

                  {materialValue > 0 ? (
                    <div className="table-row text-xs">
                      <span>Specialist Consumables / Standard Hardware</span>
                      <span>{formatMoney(materialValue)}</span>
                    </div>
                  ) : null}

                  <div className="table-row">
                    <span>Repaido Platform Charge (3%)</span>
                    <span className="text-slate-800 font-semibold">{formatMoney(platformFee)}</span>
                  </div>

                  {discountAmount > 0 && (
                    <div className="table-row font-bold text-emerald">
                      <span>🎉 First-Order 50% Service Charge Discount</span>
                      <span>-{formatMoney(discountAmount)}</span>
                    </div>
                  )}

                  <div className="table-row text-xs text-slate-700">
                    <span>GST (Goods & Services Tax 18%)</span>
                    <span>{formatMoney(gstAmount)}</span>
                  </div>

                  <div className="table-row total border-t-2 border-slate-900 pt-2 font-bold text-sm">
                    <span>Final Payable Bill Amount</span>
                    <span className="text-base text-emerald-700">{formatMoney(finalTotal)}</span>
                  </div>
                </div>
              );
            })()}

            {activeInvoiceBooking.worker && (
              <div className="payout-simulator-box my-3 text-left">
                <div className="payout-simulator-title">
                  <Sparkles size={13} className="text-accent" />
                  Assigned Professional
                </div>
                <div className="payout-row">
                  <span>Professional</span>
                  <strong>{activeInvoiceBooking.worker.name} ({activeInvoiceBooking.worker.role === 'specialist' ? '⭐ Specialist' : '🔧 Technician'})</strong>
                </div>
                <div className="payout-row">
                  <span>Pricing Structure</span>
                  <span>{activeInvoiceBooking.pricingModel === 'fixed' ? 'Fixed Scope' : `Base ₹${activeInvoiceBooking.baseFare || 150} + ₹${activeInvoiceBooking.workerHourlyRate || 299}/hr`}</span>
                </div>
              </div>
            )}

            <div className="invoice-policy-note">
              <ShieldCheck size={16} className="text-emerald shrink-0" />
              <span>
                <strong>Repaido Service Guarantee:</strong> 30-day warranty on all repair services. Official tax bill carries GST compliance across India.
              </span>
            </div>

            <div className="flex gap-2 mt-4">
              <button
                type="button"
                className="action-btn secondary flex-1 py-2.5 flex items-center justify-center gap-2 text-xs font-semibold"
                onClick={() => window.print()}
              >
                <Printer size={14} /> Print / Save Tax Bill (PDF)
              </button>
              <button
                type="button"
                className="navy-button flex-1 py-2.5 text-xs font-semibold"
                onClick={() => setActiveInvoiceBooking(null)}
              >
                Close Invoice
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Reschedule Modal */}
      {activeRescheduleBooking && (
        <Modal
          title={`Reschedule Booking — ${activeRescheduleBooking.serviceName}`}
          onClose={() => setActiveRescheduleBooking(null)}
        >
          <div className="reschedule-modal-content">
            <p className="text-sm text-muted mb-4">
              Select a new preferred date and arrival time slot. There are zero rescheduling fees.
            </p>

            <label className="font-semibold text-xs text-ink">Choose New Slot</label>
            <div className="slot-grid mt-2">
              {[
                'Today, 04:00 PM',
                'Tomorrow, 10:00 AM',
                'Tomorrow, 02:00 PM',
                'Day After Tomorrow, 11:00 AM'
              ].map(slot => (
                <button
                  key={slot}
                  className={`slot-chip ${newSlotTime === slot ? 'active' : ''}`}
                  onClick={() => setNewSlotTime(slot)}
                >
                  {slot}
                </button>
              ))}
            </div>

            <button
              className="button-primary w-full mt-6"
              onClick={async () => {
                const updated = await updateBookingStatus(activeRescheduleBooking.id, {
                  startsAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString()
                });
                setRecords(updated);
                setActiveRescheduleBooking(null);
                setSheet('Booking Rescheduled');
                setMessage(`Your booking has been updated to ${newSlotTime}. Your assigned professional has been notified.`);
              }}
            >
              Confirm Reschedule
            </button>
          </div>
        </Modal>
      )}

      {/* Cancel Target Confirmation Dialog */}
      {cancelTarget && (
        <Modal
          title={`Cancel Booking ${cancelTarget.id}?`}
          onClose={() => setCancelTarget(null)}
        >
          <div className="cancel-confirm-box">
            <p className="text-sm text-ink mb-2">
              Are you sure you want to cancel your visit for <strong>{cancelTarget.serviceName}</strong>?
            </p>
            <p className="text-xs text-muted mb-4">
              Repaido does not charge any cancellation fee. You can re-book anytime.
            </p>
            <div className="flex gap-2">
              <button
                className="action-btn danger flex-1"
                onClick={async () => {
                  const updated = await updateBookingStatus(cancelTarget.id, { status: 'cancelled', canCancel: false });
                  setRecords(updated);
                  setCancelTarget(null);
                }}
              >
                Yes, Cancel Booking
              </button>
              <button
                className="button-secondary flex-1"
                onClick={() => setCancelTarget(null)}
              >
                Keep Booking
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Auth Modal: Create account vs Already have an account? Sign in */}
      {sheet === 'auth' && (
        <Modal
          title={authMode === 'create' ? 'Create account' : 'Sign in'}
          onClose={() => { setSheet(''); setError(''); setOtpStep('phone'); setOtpCode(''); }}
        >
          {/* Segmented Switch: Create account vs Sign in */}
          <div className="auth-segmented-switch">
            <button
              type="button"
              className={`auth-segment-btn ${authMode === 'create' ? 'active' : ''}`}
              onClick={() => { setAuthMode('create'); setError(''); setOtpStep('phone'); }}
            >
              Create account
            </button>
            <button
              type="button"
              className={`auth-segment-btn ${authMode === 'signin' ? 'active' : ''}`}
              onClick={() => { setAuthMode('signin'); setError(''); setOtpStep('phone'); }}
            >
              Already have an account? Sign in
            </button>
          </div>

          <div className="text-center mb-4">
            <RepaidoBrand size="sm" className="mx-auto mb-1.5" />
            <p className="text-xs text-muted">
              {authMode === 'create'
                ? 'Join Repaido for fast bookings with verified local specialists'
                : 'Sign in to access your bookings, tracking, and invoices'}
            </p>
          </div>

          {error && <p className="error-banner mb-4" role="alert">{error}</p>}

          {/* 1. Google 1-Click Sign-In / Sign-Up */}
          <button
            type="button"
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                const res = await signInWithGoogle();
                setToken(res.token);
                setUser(res.user);
                setSheet('');
              } catch (err: any) {
                setError(err.message || 'Google sign-in failed. Please try Phone OTP.');
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            className="google-sign-in-btn"
          >
            <svg className="google-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
            </svg>
            <span>{authMode === 'create' ? 'Sign up with Google' : 'Sign in with Google'}</span>
          </button>

          <div className="auth-divider">
            <span>{authMode === 'create' ? 'or register with mobile OTP' : 'or sign in with a text message'}</span>
          </div>

          {/* 2. Mobile Phone OTP Verification */}
          {otpStep === 'phone' ? (
            <form
              onSubmit={async e => {
                e.preventDefault();
                setBusy(true);
                setError('');
                try {
                  await sendPhoneOtp(otpPhone, 'recaptcha-container');
                  setOtpStep('code');
                } catch (err: any) {
                  setError(err.message || 'Could not send verification code.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {authMode === 'create' && (
                <div className="field-group mb-3">
                  <label htmlFor="auth-name" className="field-label text-xs font-semibold text-ink">Your full name</label>
                  <input
                    id="auth-name"
                    autoComplete="name"
                    type="text"
                    placeholder="e.g. Subhankar Behera"
                    value={otpUserName}
                    onChange={e => setOtpUserName(e.target.value)}
                    required
                    className="field w-full mt-1"
                  />
                </div>
              )}

              <div className="field-group mb-4">
                <label htmlFor="auth-phone" className="field-label text-xs font-semibold text-ink">Mobile number</label>
                <div className="phone-prefix-input mt-1">
                  <span className="country-code">+91</span>
                  <input
                    type="tel"
                    id="auth-phone"
                    inputMode="tel"
                    autoComplete="tel-national"
                    aria-describedby="auth-phone-help"
                    maxLength={10}
                    placeholder="Enter 10-digit mobile number"
                    required
                    value={otpPhone}
                    onChange={e => setOtpPhone(e.target.value.replace(/\D/g, ''))}
                    className="phone-number-field"
                    autoFocus
                  />
                </div>
                <p id="auth-phone-help" className="text-sm text-muted mt-1.5">
                  {authMode === 'create'
                    ? 'We will send a 6-digit code to create your account.'
                    : 'We will send a 6-digit sign-in code by SMS.'}
                </p>
              </div>

              <button
                type="submit"
                className="button-primary w-full"
                disabled={busy || otpPhone.length < 10}
              >
                {busy ? 'Sending code…' : authMode === 'create' ? 'Send sign-up code' : 'Send sign-in code'}
              </button>

              <div className="text-center mt-4 text-xs text-muted">
                {authMode === 'create' ? (
                  <span>
                    Already have an account?{' '}
                    <button
                      type="button"
                      className="text-accent font-bold hover:underline"
                      onClick={() => { setAuthMode('signin'); setError(''); }}
                    >
                      Sign in
                    </button>
                  </span>
                ) : (
                  <span>
                    Don't have an account?{' '}
                    <button
                      type="button"
                      className="text-accent font-bold hover:underline"
                      onClick={() => { setAuthMode('create'); setError(''); }}
                    >
                      Create account
                    </button>
                  </span>
                )}
              </div>
            </form>
          ) : (
            <form
              onSubmit={async e => {
                e.preventDefault();
                setBusy(true);
                setError('');
                try {
                  const res = await confirmPhoneOtp(otpCode, otpUserName);
                  setToken(res.token);
                  setUser(res.user);
                  setSheet('');
                  setOtpCode('');
                  setOtpStep('phone');
                } catch (err: any) {
                  setError(err.message || 'Invalid verification code.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div className="bg-surface-subtle p-3 rounded-xl mb-4 text-xs text-ink flex justify-between items-center">
                <span>Code sent to <strong>+91 {otpPhone}</strong></span>
                <button
                  type="button"
                  onClick={() => { setOtpStep('phone'); setError(''); }}
                  className="text-accent font-semibold underline"
                >
                  Change
                </button>
              </div>

              <div className="field-group mb-4">
                <label htmlFor="auth-otp" className="field-label text-xs font-semibold text-ink mb-1 block">Enter the 6-digit code</label>
                <input
                  id="auth-otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  type="text"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  placeholder="• • • • • •"
                  required
                  value={otpCode}
                  onChange={e => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  className="otp-digit-input"
                  autoFocus
                />
              </div>

              <button
                type="submit"
                className="button-primary w-full"
                disabled={busy || otpCode.length !== 6}
              >
                {busy ? 'Verifying…' : authMode === 'create' ? 'Verify and create account' : 'Verify and sign in'}
              </button>

              <div className="flex justify-between items-center mt-3 text-xs text-muted">
                <span>Didn't receive SMS?</span>
                <button
                  type="button"
                  onClick={async () => {
                    setBusy(true);
                    setError('');
                    try {
                      await sendPhoneOtp(otpPhone, 'recaptcha-container');
                      setMessage('New code sent. Check your messages.');
                    } catch (err: any) {
                      setError(err.message || 'Could not resend OTP.');
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="text-accent font-semibold hover:underline"
                  disabled={busy}
                >
                  Resend OTP
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}

      {/* Support Ticket Modal */}
      {sheet === 'support_ticket' && <Modal title="Repaido support" onClose={()=>setSheet('')}><SupportCenter onSignIn={()=>setSheet('auth')}/></Modal>}

      {/* Generic Notice Modal */}
      {sheet && !['Register as specialist/technician', 'partner_registration', 'partner_registered_success', 'auth', 'support_ticket'].includes(sheet) && (
        <Modal title={sheet} onClose={() => setSheet('')}>
          <p className="text-sm text-ink">{message}</p>
          <button className="button-primary w-full mt-4" onClick={() => setSheet('')}>
            Understood
          </button>
        </Modal>
      )}

      <CustomerNotificationDrawer
        isOpen={showNotificationDrawer}
        onClose={() => setShowNotificationDrawer(false)}
        onOpenJob={id => {
          setNotificationJob(id);
          setTab('Bookings');
        }}
        onOpenQuotationModal={quote => {
          setActiveQuotationForPdf(quote);
        }}
        onNavigateTab={(targetTab, sub) => {
          setTab(targetTab as any);
          if (targetTab === 'ShopSpares' && sub) {
            setMarketSubTab(sub as any);
          }
        }}
        onOpenPromotion={campId => {
          if (campId) setSelectedPromotion(campId);
          setTab('Explore');
        }}
        onOpenHomePlan={planId => {
          setHomeHub(planId || '');
        }}
        activeBookings={records}
        onUnreadCountChange={count => setUnreadNotificationCount(count)}
      />

      {activeQuotationForPdf && (
        <B2BQuotationPdfModal
          quotation={activeQuotationForPdf}
          onClose={() => setActiveQuotationForPdf(null)}
        />
      )}
      <CustomerCartDrawer
        isOpen={showCartDrawer}
        onClose={() => setShowCartDrawer(false)}
        customerName={customerIdentity.name}
        customerPhone={user?.phone || ''}
        defaultAddress={place.address}
        defaultCity={place.city}
        onExploreMore={() => {
          setStoreSection('spares');
          setMarketSubTab('spares');
          setTab('ShopSpares');
        }}
      />

      {/* Customer Rating & Review Modal */}
      {ratingBooking && (
        <Modal
          title="Rate Your Specialist & Experience"
          onClose={() => setRatingBooking(null)}
        >
          <div className="rating-modal-content space-y-4">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
              <span className="text-xs text-slate-500 block">Service Completed</span>
              <h3 className="font-bold text-slate-900 text-sm mt-0.5">{ratingBooking.serviceName}</h3>
              {ratingBooking.worker && (
                <div className="mt-2 flex items-center justify-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-amber-500 text-white flex items-center justify-center font-bold text-xs">
                    {ratingBooking.worker.name.charAt(0)}
                  </div>
                  <div className="text-left">
                    <strong className="text-xs text-slate-800 block">{ratingBooking.worker.name}</strong>
                    <span className="text-sm text-slate-500">
                      {ratingBooking.worker.role === 'specialist' ? '⭐ Senior Specialist' : '🔧 Certified Technician'}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Interactive Star Picker */}
            <div className="text-center">
              <label className="text-xs font-semibold text-slate-700 block mb-1.5">Tap to Rate Service Quality</label>
              <div className="flex items-center justify-center gap-2">
                {[1, 2, 3, 4, 5].map(star => (
                  <button
                    key={`star-${star}`}
                    type="button"
                    onClick={() => setRatingScore(star)}
                    className="p-1 hover:scale-125 transition-transform"
                    aria-label={`${star} Stars`}
                  >
                    <Star
                      size={28}
                      className={star <= ratingScore ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}
                    />
                  </button>
                ))}
              </div>
              <span className="text-xs font-bold text-amber-600 mt-1 block">
                {ratingScore === 5 ? '⭐⭐⭐⭐⭐ Exceptional (5/5)' :
                 ratingScore === 4 ? '⭐⭐⭐⭐ Great Experience (4/5)' :
                 ratingScore === 3 ? '⭐⭐⭐ Satisfactory (3/5)' :
                 ratingScore === 2 ? '⭐⭐ Needs Improvement (2/5)' :
                 '⭐ Poor (1/5)'}
              </span>
            </div>

            {/* Quick Compliment Tags */}
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1.5">What did you appreciate most?</label>
              <div className="flex flex-wrap gap-1.5">
                {[
                  '⚡ On-Time Arrival',
                  '🧰 Professional Tools',
                  '🧹 Cleaned Up After Work',
                  '🤝 Polite & Courteous',
                  '💎 Fair & Clear Pricing',
                  '🩺 Accurately Diagnosed'
                ].map(tag => {
                  const active = selectedCompliments.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => {
                        setSelectedCompliments(curr =>
                          active ? curr.filter(t => t !== tag) : [...curr, tag]
                        );
                      }}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        active
                          ? 'bg-amber-100 border-amber-400 text-amber-900 font-semibold'
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Written Review Feedback */}
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Additional Comments or Feedback (Optional)
              </label>
              <textarea
                rows={3}
                className="w-full p-2.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-accent focus:outline-none"
                placeholder="Share your experience to help the specialist and future customers..."
                value={ratingComment}
                onChange={e => setRatingComment(e.target.value)}
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                className="action-btn secondary flex-1 py-2 text-xs"
                onClick={() => setRatingBooking(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="navy-button flex-1 py-2 text-xs font-bold"
                onClick={async () => {
                  if (!ratingBooking) return;
                  const finalReview = [
                    ...selectedCompliments,
                    ratingComment.trim()
                  ].filter(Boolean).join(' • ');

                  const result = await rateBookingWorker(ratingBooking.id, ratingScore, finalReview);
                  if (result) {
                    setRecords(curr => curr.map(b => b.id === ratingBooking.id ? result.booking : b));
                    setTechniciansList(getWorkers());
                  }
                  setRatingBooking(null);
                }}
              >
                Send feedback
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Customer Location Picker Modal (Leaflet Google Map) */}
      <LocationPickerModal
        isOpen={customerMapModalOpen}
        onClose={() => setCustomerMapModalOpen(false)}
        initialLat={21.4934}
        initialLng={86.9135}
        title="Set Your Current Service Location"
        subtitle="Move the pin, use GPS, or enter coordinates to choose your service entrance."
        onConfirmLocation={res => {
          setPlace(prev => ({ ...prev, city: res.city || prev.city || 'Balasore', address: res.address || prev.address, lat: res.lat, lng: res.lng, confirmed: true }));
        }}
      />

      {/* Technician / Worker Location Picker Modal (Leaflet Google Map) */}
      <LocationPickerModal
        isOpen={workerMapModalOpen}
        onClose={() => setWorkerMapModalOpen(false)}
        initialLat={partnerForm.lat || 21.4934}
        initialLng={partnerForm.lng || 86.9135}
        title="Set Technician Base GPS Location"
        subtitle="Choose your service workshop or home base using the map or coordinates."
        onConfirmLocation={res => {
          setPartnerForm(prev => ({
            ...prev,
            lat: res.lat,
            lng: res.lng,
            homeAddress: prev.homeAddress || res.address,
            serviceCity: res.city || prev.serviceCity
          }));
        }}
      />
    </div>
  );
}
