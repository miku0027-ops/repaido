export type CategoryId = 'all' | 'cleaning' | 'ac' | 'plumber' | 'electrician' | 'carpenter' | 'painting' | 'salon' | 'pest' | 'car' | 'moving';

export interface Service {
  id: string;
  name: string;
  category: CategoryId;
  description: string;
  price: number;
  duration: number;
  image: string;
  imageTile?: number;
  imageAlt: string;
  included: string[];
  excluded: string[];
  rating?: number;
  reviewCount?: number;
  originalPrice?: number;
}

export interface CartItem {
  service: Service;
  quantity: number;
}

export interface Address {
  name: string;
  phone: string;
  street: string;
  area: string;
  pincode: string;
  label: 'Home' | 'Work' | 'Other';
}

export interface BookingDraft {
  items: CartItem[];
  address: Address;
  city: string;
  date: string;
  time: string;
  subtotal: number;
  tax: number;
  total: number;
  currency: 'INR';
  assignedWorkerId?: string;
}

export type ConfirmBooking = (draft: BookingDraft) => Promise<{ reference: string; mode: 'preview' | 'live' }>;

export type WorkerRole = 'technician' | 'specialist';
export type WorkerPricingModel = 'hourly' | 'fixed';

export interface WorkerGig {
  id: string;
  title: string;
  category: CategoryId;
  skills: string[];
  tools: string[];
  pricingModel: WorkerPricingModel;
  baseFare: number; // ₹150 base inspection fare
  hourlyRate?: number;
  fixedPrice?: number;
  description?: string;
}

export interface WorkerProfile {
  id: string;
  name: string;
  role: WorkerRole;
  category: CategoryId;
  avatar: string;
  profileImage?: string;
  level: number;
  points: number;
  maxLevelPoints: number;
  taskScore: number;
  completedTasks: number;
  distanceKm: number;
  bestSkill: string;
  specializedSkills: string[];
  toolsEquipped: string;
  toolsList: string[];
  hasSpecialistKit: boolean;
  yearsExperience: number;
  city: string;
  phone: string;
  verifiedKyc: boolean;
  hourlyRate?: number;
  pricingModel?: WorkerPricingModel;
  baseFare?: number;
  fixedPrice?: number;
  gigs?: WorkerGig[];
  demandTier?: 'highest_demand' | 'high_demand' | 'standard';
  demandBadge?: string;
  bio?: string;
  reviewCount?: number;
}

export type Tab = 'Explore' | 'Services' | 'Bookings' | 'ShopSpares' | 'You';

export type SparePartCategory = 'ac' | 'plumber' | 'electrician' | 'appliance' | 'cleaning' | 'tools' | 'refurbished' | 'gadgets' | 'smartphones' | string;

export interface Refurbishment {
  grade:'A+'|'A'|'B'; cosmetic_condition:string; tested_functions:string; tested_on:string;
  repairs:string; known_defects:string; accessories:string; battery_health_percent?:number|null;
  warranty_days:number; warranty_terms:string; return_days:number; return_terms:string;
}
export interface ShopPrimeStatus {active:boolean;paid_placement:boolean;ends_at?:number|null}
export interface SparePartProduct {
  refurbishment?:Refurbishment|null;
  refurbishmentDetails?:string;
  warranty?:string;
  prime?:ShopPrimeStatus;
  id: string;
  shopId: string;
  shopName: string;
  name: string;
  partNumber: string;
  category: SparePartCategory;
  price: number;
  mrp: number;
  stock: number;
  image: string;
  brand: string;
  compatibility: string;
  warrantyMonths: number;
  gstRate: number;
  status: 'approved' | 'pending_review' | 'rejected';
  description: string;
  costPrice?: number;
  binLocation?: string;
  reorderThreshold?: number;
  supplierName?: string;
  lastRestockedAt?: string;
  condition?: 'new' | 'refurbished' | 'preowned';
  refurbishedGrade?: 'A+' | 'A' | 'B';
  moneyBackDays?: number;
  certifiedDiagnostic?: boolean;
  hsnCode?: string;
  ownershipVerified?: boolean;
  secondHandNotes?: string;
}

export interface SpareShop {
  id: string;
  profileImage?: string;
  ownerName: string;
  shopName: string;
  phone: string;
  email: string;
  gstin: string;
  tradeLicense: string;
  address: string;
  city: string;
  lat: number;
  lng: number;
  bankAccount: string;
  ifsc: string;
  status: 'active' | 'pending_verification' | 'rejected' | 'suspended_by_hq';
  isOperationsFrozen?: boolean;
  frozenReason?: string;
  operationalNotes?: string;
  onboardingFeeRemaining: number;
  commissionRate: number;
  createdAt: string;
}

export type ShopNotificationType = 'order_action' | 'low_stock' | 'company_directive' | 'settlement' | 'kyc' | 'b2b_rfq';
export type ShopNotificationPriority = 'urgent' | 'high' | 'normal';

export interface ShopNotification {
  id: string;
  shopId: string;
  type: ShopNotificationType;
  priority: ShopNotificationPriority;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  actionTarget: {
    tab: 'orders' | 'inventory' | 'b2b' | 'ledger' | 'kyc_register' | 'settings' | 'company_oversight';
    orderId?: string;
    productId?: string;
    sku?: string;
    filterCondition?: string;
    directiveId?: string;
    actionType?: 'open_invoice' | 'open_stock_modal' | 'open_order_handover' | 'view_directive';
  };
  sender?: string;
  metadata?: Record<string, any>;
}

export interface CompanyShopDirective {
  id: string;
  shopId: string; // or 'ALL'
  title: string;
  category: 'audit' | 'compliance' | 'urgent_order' | 'holiday_schedule' | 'price_verification';
  priority: 'urgent' | 'high' | 'normal';
  instructions: string;
  issuedAt: string;
  deadline?: string;
  issuedBy: string;
  acknowledged: boolean;
  acknowledgedAt?: string;
}

export interface TaskSpareItem {
  id: string;
  productId: string;
  partNumber?: string;
  hsnCode?: string;
  name: string;
  image?: string;
  shopId: string;
  shopName: string;
  shopPhone: string;
  shopLat: number;
  shopLng: number;
  price: number;
  travelDistanceKm: number;
  travelCharge: number; // distanceKm * 2 * ₹10
  totalBilledToCustomer: number;
  status: 'added_to_task' | 'shop_accepted' | 'agent_picked_up' | 'installed';
  addedAt: string;
}

export interface ProductChangeRequest {
  id: string;
  shopId: string;
  shopName: string;
  type: 'add' | 'edit';
  productId?: string;
  proposedData: Partial<SparePartProduct>;
  status: 'pending' | 'approved' | 'rejected';
  submittedAt: string;
}

export interface SpareCartItem {
  product: SparePartProduct;
  quantity: number;
}

export interface CandidateMatch {
  worker: WorkerProfile;
  matchScore: number;
  matchReasons: string[];
  recommendedRole: WorkerRole;
}

export type BookingStatus = 'requested' | 'confirmed' | 'on_the_way' | 'in_progress' | 'completed' | 'cancelled';

export interface BookingRecord {
  id: string;
  serviceId: string;
  serviceName: string;
  category: CategoryId;
  city: string;
  address: string;
  startsAt: string;
  status: BookingStatus;
  price: number;
  worker?: WorkerProfile;
  etaMinutes?: number;
  ratingGiven?: number;
  canCancel?: boolean;
  laborCharge?: number;
  materialCharge?: number;
  discountAmount?: number;
  isNewUserDiscount?: boolean;
  workerHourlyRate?: number;
  estimatedHours?: number;
  workerLaborTotal?: number;
  platformCommission?: number;
  workerDirectPayout?: number;
  workerRetentionBonus?: number;
  workerNetPayout?: number;
  workerBonusEligible?: boolean;
  userWalletCredit?: number;
  taskAssignedAt?: string;
  acknowledgedAt?: string;
  acknowledgementDeadline?: string;
  taskSpares?: TaskSpareItem[];
  sparePartsTotal?: number;
  travelChargesTotal?: number;
  baseFare?: number;
  timelineStep?: 'assigned' | 'acknowledged' | 'on_the_way' | 'in_progress' | 'completed';
  pricingModel?: WorkerPricingModel;
  fixedPrice?: number;
  customerReview?: string;
  customerRatedAt?: string;
}
