import {categoryMetadata,saveHireCategories} from './hireCategories.mjs';
import {beginLoading} from './loading';
import {createPhoneAccountRecovery} from './phoneAccountRecovery.mjs';
import { apiFetch } from './api';
import { auth, db } from '../firebase';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithPhoneNumber,
  signInWithCredential,
  type PhoneAuthCredential,
  PhoneAuthProvider,
  linkWithCredential,
  reauthenticateWithCredential,
  RecaptchaVerifier,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  updateProfile,
  type ConfirmationResult
} from 'firebase/auth';
import {
  collection,
  addDoc,
  setDoc,
  getDoc,
  updateDoc,
  doc,
  getDocs,
  query,
  where,
  onSnapshot,
  serverTimestamp
} from 'firebase/firestore';
import type {
  BookingRecord,
  WorkerProfile,
  WorkerGig,
  WorkerPricingModel,
  Service,
  SpareShop,
  SparePartProduct,
  TaskSpareItem,
  ProductChangeRequest,
  SpareCartItem,
  CategoryId,
  WorkerRole,
  ShopNotification,
  CompanyShopDirective
} from '../types';
import {
  seededSpareShops,
  seededSpareProducts,
  defaultCityBaseFares,
  seededWorkers,
  seededServices,
  getCandidateMatches
} from '../data';

export interface RepaidoUser {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  photoURL?: string;
}

export interface WorkerOnboardingDraft {
  name: string;
  phone: string;
  role: WorkerRole;
  category: CategoryId;
  city: string;
  experienceYears: number;
  serviceRadiusKm: number;
  tools: string[];
  skills: string[];
}

export interface PartnerApplication {
  id: string;
  role: 'Specialist' | 'Technician';
  name: string;
  phone: string;
  dob: string;
  gender: string;
  email: string;
  homeAddress: string;
  serviceRadiusKm: number;
  tradeCategory: string;
  experienceYears: number;
  toolsList: string;
  toolPhotosCount: number;
  aadhaarNumber: string;
  panNumber: string;
  bankName: string;
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  upiId?: string;
  hourlyRate?: number;
  lat?: number;
  lng?: number;
  status: 'pending_verification' | 'approved' | 'rejected';
  rejectionReason?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
}

export interface AdminLedgerEntry {
  id: string;
  timestamp: string;
  operator: string;
  actionCategory: 'agent_moderation' | 'shop_kyc' | 'product_moderation' | 'base_fare_change' | 'sla_override';
  targetId: string;
  targetName: string;
  entityType: 'Agent' | 'Shop' | 'Product' | 'RegionalFare' | 'Dispatch';
  decision: 'APPROVED' | 'REJECTED' | 'MODIFIED' | 'DISPATCHED';
  details: string;
  previousState?: string;
  newState?: string;
}

export interface SupportTicket {
  id: string;
  name: string;
  phone: string;
  subject: string;
  message: string;
  status: 'open' | 'in_progress' | 'resolved';
  createdAt: string;
}

// Local storage keys
const KEYS = {
  BOOKINGS: 'repaido.bookings',
  PARTNERS: 'repaido.partners',
  TICKETS: 'repaido.tickets',
  USER: 'repaido.user',
  TOKEN: 'repaido.token',
  SPARE_SHOPS: 'repaido.spare_shops',
  SPARE_PRODUCTS: 'repaido.spare_products',
  PRODUCT_REQUESTS: 'repaido.product_requests',
  BASE_FARES: 'repaido.base_fares',
  SHOP_LEDGERS: 'repaido.shop_ledgers',
  CUSTOMER_SPARE_ORDERS: 'repaido.customer_spare_orders',
  ADMIN_LEDGER: 'repaido.admin_ledger',
  WORKERS: 'repaido.workers',
  WORKER_SESSION: 'repaido.worker_session',
  MARKET_LISTINGS: 'repaido.market.listings',
  SHOP_NOTIFICATIONS: 'repaido.shop.notifications',
  COMPANY_DIRECTIVES: 'repaido.company.directives'
};

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, data: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {}
  if(key===KEYS.TOKEN)window.dispatchEvent(new Event('repaido:identity-changed'));
}

/**
 * Authentication Module: Google Sign-In & Mobile Phone OTP Verification
 */
const phoneAccountRecovery = createPhoneAccountRecovery({
  currentUid: () => auth.currentUser?.uid,
  signIn: (credential: PhoneAuthCredential) => signInWithCredential(auth, credential)
});
export const canContinueWithPhoneAccount = () => phoneAccountRecovery.available();
export function clearPhoneAccountRecovery() { phoneAccountRecovery.clear(); }
export async function continueWithPhoneAccount(): Promise<void> {
  const result = await phoneAccountRecovery.continue();
  await result.user.getIdToken(true);
  writeLocal(KEYS.USER, {id:result.user.uid,name:result.user.displayName || 'Repaido Member',phone:result.user.phoneNumber || undefined,email:result.user.email || undefined});
  writeLocal(KEYS.TOKEN, await result.user.getIdToken());
}
let confirmationResultRef: ConfirmationResult | null = null;
let recaptchaVerifierRef: RecaptchaVerifier | null = null;

function ensureRecaptchaContainer(containerId: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;

  const existing = document.getElementById(containerId);
  if (existing) {
    return existing as HTMLElement;
  }

  const fallback = document.createElement('div');
  fallback.id = containerId;
  fallback.setAttribute('aria-hidden', 'true');
  fallback.style.position = 'fixed';
  fallback.style.width = '1px';
  fallback.style.height = '1px';
  fallback.style.opacity = '0';
  fallback.style.pointerEvents = 'none';
  fallback.style.overflow = 'hidden';
  fallback.style.top = '-9999px';
  fallback.style.left = '-9999px';
  document.body.appendChild(fallback);
  return fallback;
}

/**
 * One-click Google Sign-In / Sign-Up
 */
export async function signInWithGoogle(): Promise<{ token: string; user: RepaidoUser }> {
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const cred = await signInWithPopup(auth, provider);
    const user: RepaidoUser = {
      id: cred.user.uid,
      name: cred.user.displayName || 'Repaido Member',
      email: cred.user.email || undefined,
      phone: cred.user.phoneNumber || undefined,
      photoURL: cred.user.photoURL || undefined
    };
    const token = await cred.user.getIdToken();
    writeLocal(KEYS.USER, user);
    writeLocal(KEYS.TOKEN, token);
    return { token, user };
  } catch (err: any) {
    if (err?.code === 'auth/popup-closed-by-user') {
      throw new Error('Sign in was cancelled. Please try again.');
    }
    if (err?.code === 'auth/cancelled-popup-request') {
      throw new Error('Sign in in progress.');
    }
    throw new Error(err?.message || 'Google sign-in failed. Try again or sign in with your mobile number.');
  }
}

/**
 * Send 6-Digit Verification Code to Mobile Number via SMS
 */
export async function sendPhoneOtp(
  phoneNumber: string,
  containerId = 'recaptcha-container',
  preserveCurrentAccount = false
): Promise<void> {
  confirmationResultRef = null;
  phoneAccountRecovery.clear();
  const cleanDigits = phoneNumber.replace(/\D/g, '');
  if (cleanDigits.length < 10) {
    throw new Error('Enter a valid 10-digit mobile number.');
  }

  const e164 = cleanDigits.length === 10
    ? `+91${cleanDigits}`
    : cleanDigits.startsWith('91') && cleanDigits.length === 12
      ? `+${cleanDigits}`
      : `+${cleanDigits}`;

  const uniqueContainerId = `${containerId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    if (recaptchaVerifierRef) {
      try {
        recaptchaVerifierRef.clear();
      } catch {}
      recaptchaVerifierRef = null;
    }

    const target = ensureRecaptchaContainer(uniqueContainerId);
    if (!target) {
      throw new Error('Phone verification is unavailable here. Open Repaido in Chrome or the Android app and try again.');
    }

    recaptchaVerifierRef = new RecaptchaVerifier(auth, target, {
      size: 'invisible',
      callback: () => {}
    });

    const existing = preserveCurrentAccount ? auth.currentUser : null;
    if (existing) {
      if(existing.phoneNumber && existing.phoneNumber !== e164) throw new Error('Use the mobile number already linked to this account, or sign out to switch accounts.');
      const verificationId = await new PhoneAuthProvider(auth).verifyPhoneNumber(e164, recaptchaVerifierRef);
      confirmationResultRef = {verificationId, confirm: async code => {
        if(auth.currentUser?.uid !== existing.uid) throw new Error('Your account changed. Request a new code.');
        const credential = PhoneAuthProvider.credential(verificationId, code);
        try {
          const result = existing.phoneNumber ? await reauthenticateWithCredential(existing, credential) : await linkWithCredential(existing, credential);
          await result.user.getIdToken(true);
          return result;
        } catch (err: any) {
          // Firebase supplies a verified temporary proof when the number has another UID.
          phoneAccountRecovery.capture(err, PhoneAuthProvider.credentialFromError(err), existing.uid);
          throw err;
        }
      }};
    } else confirmationResultRef = await signInWithPhoneNumber(auth, e164, recaptchaVerifierRef);
  } catch (err: any) {
    if (err?.code === 'auth/invalid-phone-number') {
      throw new Error('Invalid phone number. Enter a valid 10-digit mobile number.');
    }
    if (err?.code === 'auth/too-many-requests') {
      throw new Error('Too many requests. Please try again in a few minutes.');
    }
    throw new Error(err?.message || 'Could not send verification code. Please check your number.');
  }
}

/**
 * Confirm 6-Digit Verification Code
 */
export async function confirmPhoneOtp(
  otpCode: string,
  customerName?: string
): Promise<{ token: string; user: RepaidoUser }> {
  if (!confirmationResultRef) {
    throw new Error('Request a verification code first.');
  }
  const code = otpCode.trim();
  if (code.length !== 6) {
    throw new Error('Enter the 6-digit code from your messages.');
  }

  try {
    const cred = await confirmationResultRef.confirm(code);
    if (customerName && customerName.trim().length >= 2 && cred.user) {
      try {
        await updateProfile(cred.user, { displayName: customerName.trim() });
      } catch {}
    }

    const user: RepaidoUser = {
      id: cred.user.uid,
      name: customerName?.trim() || cred.user.displayName || `Customer (${cred.user.phoneNumber?.slice(-4) || 'User'})`,
      phone: cred.user.phoneNumber || undefined,
      email: cred.user.email || undefined
    };
    const token = await cred.user.getIdToken();
    writeLocal(KEYS.USER, user);
    writeLocal(KEYS.TOKEN, token);
    return { token, user };
  } catch (err: any) {
    if (err?.code === 'auth/invalid-verification-code') {
      throw new Error('The code does not match. Enter the latest 6-digit code from your messages.');
    }
    if (err?.code === 'auth/code-expired') {
      throw new Error('This code has expired. Request a new code.');
    }
    if(['auth/account-exists-with-different-credential','auth/credential-already-in-use'].includes(err?.code)) throw new Error(canContinueWithPhoneAccount() ? 'This number belongs to another Repaido account. Continue with that mobile account to access its worker profile. Your current account’s bookings stay separate.' : 'This number is linked to another Repaido account. Sign out, then sign in with this mobile number and request a new code. Your accounts have not been merged.');
    if(err?.code === 'auth/requires-recent-login') throw new Error('For your security, sign in again and request a new code.');
    throw new Error(err?.message || 'Failed to verify code. Please try again.');
  }
}

export async function logoutUser(): Promise<void> {
  confirmationResultRef = null;
  phoneAccountRecovery.clear();
  try {
    await firebaseSignOut(auth);
  } catch {}
  localStorage.removeItem(KEYS.USER);
  localStorage.removeItem(KEYS.TOKEN);
  window.dispatchEvent(new Event('repaido:identity-changed'));
}

/**
 * Firestore Database Queries: Services & Technicians Catalog
 */
export async function fetchLiveServices(): Promise<Service[]> {
  const response = await apiFetch('/api/catalog', {signal:AbortSignal.timeout(10000)});
  if (!response.ok) throw new Error('The live catalogue is unavailable. Retry before booking.');
  const data = await response.json();
  saveHireCategories('regular',categoryMetadata(data.categories,data.services));
  return data.services.map((s:any) => {
    const art = seededServices.find(item => item.id === s.id) || seededServices.find(item => item.category === s.category);
    return {id:s.id,name:s.name,category:s.category,description:s.description,price:s.price_paise,duration:s.duration_minutes,rating:s.rating??undefined,reviewCount:s.review_count||0,included:s.included,excluded:s.excluded,image:art?.image||'',imageTile:art?.imageTile,imageAlt:art?.imageAlt||s.name};
  });
}

export async function fetchLiveTechnicians(): Promise<WorkerProfile[]> {
  const place = readLocal<{lat?:number;lng?:number;city?:string;confirmed?:boolean}>('repaido.place', {});
  if (!place.confirmed || place.lat === undefined || place.lng === undefined) return [];
  const response = await apiFetch('/api/operations/professionals/search', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({location:{lat:place.lat,lng:place.lng},city:place.city,radius_km:6}), signal:AbortSignal.timeout(10000)});
  if (!response.ok) throw new Error('Nearby professionals could not be loaded. Please retry.');
  const {professionals} = await response.json();
  return professionals.map((w:any) => ({id:w.id,name:w.name,role:w.role,category:w.categories[0],avatar:w.name.slice(0,1),level:1,points:w.points,maxLevelPoints:1500,taskScore:w.rating_count?w.rating_sum/w.rating_count:0,completedTasks:w.completed_tasks,distanceKm:w.distance_km,bestSkill:w.skills[0]||'',specializedSkills:w.skills,toolsEquipped:w.tools.join(', '),toolsList:w.tools,hasSpecialistKit:w.has_specialist_kit,yearsExperience:w.experience_years,city:w.city,phone:'',verifiedKyc:true}));
}

/**
 * Booking Services (Local Storage + Cloud Firestore Real-time Sync)
 */
export function getSavedBookings(fallback: BookingRecord[] = []): BookingRecord[] {
  return readLocal<BookingRecord[]>(KEYS.BOOKINGS, fallback);
}

export function clearSavedBookings(): void {
  writeLocal(KEYS.BOOKINGS, []);
}

export async function fetchUserBookings(userId: string): Promise<BookingRecord[]> {
  if (!userId) return [];
  const finishLoading=beginLoading('/bookings');
  try {
    const q = query(collection(db, 'bookings'), where('userId', '==', userId));
    const snap = await getDocs(q);
    if (snap.empty) {
      // Also try user_id legacy format
      const q2 = query(collection(db, 'bookings'), where('user_id', '==', userId));
      const snap2 = await getDocs(q2);
      return snap2.docs.map(d => ({ id: d.id, ...d.data() } as BookingRecord));
    }
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as BookingRecord));
  } catch (err) {
    console.warn('Could not load user bookings from Firestore:', err);
    return [];
  } finally {finishLoading();}
}

export function subscribeToUserBookings(
  userId: string,
  onUpdate: (bookings: BookingRecord[]) => void
): () => void {
  if (!userId) return () => {};
  try {
    const q = query(collection(db, 'bookings'), where('userId', '==', userId));
    return onSnapshot(q, (snapshot) => {
      const live = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as BookingRecord));
      onUpdate(live);
    }, (error) => {
      console.warn('Firestore bookings snapshot error:', error);
    });
  } catch {
    return () => {};
  }
}

export async function saveBooking(booking: BookingRecord): Promise<void> {
  const current = readLocal<BookingRecord[]>(KEYS.BOOKINGS, []);
  const updated = [booking, ...current.filter(b => b.id !== booking.id)];
  writeLocal(KEYS.BOOKINGS, updated);

  // Sync to Cloud Firestore if connected
  try {
    const currentUserId = auth.currentUser?.uid || (booking as any).userId || (booking as any).user_id || 'guest';
    const payload = {
      ...booking,
      userId: currentUserId,
      user_id: currentUserId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    await setDoc(doc(db, 'bookings', booking.id), payload, { merge: true });
  } catch (err) {
    console.warn('Could not sync booking to Firestore, kept locally:', err);
  }
}

export async function updateBookingStatus(
  bookingId: string,
  changes: Partial<BookingRecord>
): Promise<BookingRecord[]> {
  const current = readLocal<BookingRecord[]>(KEYS.BOOKINGS, []);
  const updated = current.map(b => (b.id === bookingId ? { ...b, ...changes } : b));
  writeLocal(KEYS.BOOKINGS, updated);

  try {
    await updateDoc(doc(db, 'bookings', bookingId), {
      ...changes,
      updatedAt: serverTimestamp()
    });
  } catch (err) {
    console.warn('Could not update booking status in Firestore:', err);
  }

  return updated;
}

export const seededPartnerApplications: PartnerApplication[] = [];
export const defaultAdminLedger: AdminLedgerEntry[] = [];

/**
 * Partner Application Service (Technician & Specialist)
 */
export function getSavedPartnerApplications(): PartnerApplication[] {
  const saved = readLocal<PartnerApplication[]>(KEYS.PARTNERS, []);
  if (saved.length === 0) {
    writeLocal(KEYS.PARTNERS, seededPartnerApplications);
    return seededPartnerApplications;
  }
  return saved;
}

export async function submitPartnerApplication(appData: Omit<PartnerApplication, 'id' | 'status' | 'createdAt'>): Promise<string> {
  const id = `REP-PARTNER-${Math.floor(1000 + Math.random() * 9000)}`;
  const record: PartnerApplication = {
    ...appData,
    id,
    status: 'pending_verification',
    createdAt: new Date().toISOString()
  };

  const current = getSavedPartnerApplications();
  writeLocal(KEYS.PARTNERS, [record, ...current]);

  // Attempt sync to Cloud Firestore
  try {
    await setDoc(doc(db, 'partner_applications', id), {
      ...record,
      firestoreTimestamp: serverTimestamp()
    });
  } catch (err) {
    console.warn('Could not sync partner application to Firestore:', err);
  }

  return id;
}

export function approvePartnerApplication(appId: string, reviewer: string = 'CEO / Managing Director'): PartnerApplication[] {
  const apps = getSavedPartnerApplications();
  const target = apps.find(a => a.id === appId);
  if (!target) return apps;

  const updatedApps = apps.map(a =>
    a.id === appId
      ? {
          ...a,
          status: 'approved' as const,
          reviewedBy: reviewer,
          reviewedAt: new Date().toISOString()
        }
      : a
  );
  writeLocal(KEYS.PARTNERS, updatedApps);

  // Log to Admin Ledger
  recordAdminAction({
    operator: reviewer,
    actionCategory: 'agent_moderation',
    targetId: target.id,
    targetName: `${target.name} (${target.role})`,
    entityType: 'Agent',
    decision: 'APPROVED',
    details: `Approved ${target.role} verification for ${target.name}. Aadhaar: ${target.aadhaarNumber}. Service radius: ${target.serviceRadiusKm} km. Hourly rate: ₹${target.hourlyRate || 250}/hr.`,
    previousState: 'pending_verification',
    newState: 'approved'
  });

  return updatedApps;
}

export function rejectPartnerApplication(appId: string, reason: string, reviewer: string = 'CEO / Managing Director'): PartnerApplication[] {
  const apps = getSavedPartnerApplications();
  const target = apps.find(a => a.id === appId);
  if (!target) return apps;

  const updatedApps = apps.map(a =>
    a.id === appId
      ? {
          ...a,
          status: 'rejected' as const,
          rejectionReason: reason,
          reviewedBy: reviewer,
          reviewedAt: new Date().toISOString()
        }
      : a
  );
  writeLocal(KEYS.PARTNERS, updatedApps);

  // Log to Admin Ledger
  recordAdminAction({
    operator: reviewer,
    actionCategory: 'agent_moderation',
    targetId: target.id,
    targetName: `${target.name} (${target.role})`,
    entityType: 'Agent',
    decision: 'REJECTED',
    details: `Rejected application for ${target.name}. Reason: "${reason}".`,
    previousState: 'pending_verification',
    newState: 'rejected'
  });

  return updatedApps;
}

/**
 * Executive Admin Activity Ledger
 */
export function getAdminLedger(): AdminLedgerEntry[] {
  const saved = readLocal<AdminLedgerEntry[]>(KEYS.ADMIN_LEDGER, []);
  if (saved.length === 0) {
    writeLocal(KEYS.ADMIN_LEDGER, defaultAdminLedger);
    return defaultAdminLedger;
  }
  return saved;
}

export function recordAdminAction(action: Omit<AdminLedgerEntry, 'id' | 'timestamp'>): AdminLedgerEntry {
  const entry: AdminLedgerEntry = {
    ...action,
    id: `ledg-act-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    timestamp: new Date().toISOString()
  };
  const current = getAdminLedger();
  const updated = [entry, ...current];
  writeLocal(KEYS.ADMIN_LEDGER, updated);

  try {
    setDoc(doc(db, 'admin_ledger', entry.id), {
      ...entry,
      firestoreTimestamp: serverTimestamp()
    }).catch(() => {});
  } catch {}

  return entry;
}

/**
 * Support Ticket Submission
 */
export async function submitSupportTicket(ticket: Omit<SupportTicket, 'id' | 'status' | 'createdAt'>): Promise<string> {
  const id = `REP-TICKET-${Math.floor(1000 + Math.random() * 9000)}`;
  const record: SupportTicket = {
    ...ticket,
    id,
    status: 'open',
    createdAt: new Date().toISOString()
  };

  const current = readLocal<SupportTicket[]>(KEYS.TICKETS, []);
  writeLocal(KEYS.TICKETS, [record, ...current]);

  try {
    const userId = auth.currentUser?.uid || null;
    await setDoc(doc(db, 'support_tickets', id), {
      ...record,
      userId,
      user_id: userId,
      firestoreTimestamp: serverTimestamp()
    });
  } catch (err) {
    console.warn('Could not sync support ticket to Firestore:', err);
  }

  return id;
}

// ==========================================
// SPARE PARTS & E-COMMERCE SERVICES
// ==========================================

/**
 * Strict Platform Inventory Sanitizer
 * Erases any mock, fake, placeholder, or invalid products across platform
 */
export function purgeAndSanitizeInventory(): SparePartProduct[] {
  const stored = readLocal<SparePartProduct[]>(KEYS.SPARE_PRODUCTS, []);
  const validShops = getSpareShops().map(s => s.id);

  // Merge newly added seeded items (e.g. refurbished products) with stored inventory
  const existingIds = new Set(stored.map(p => p.id));
  const merged = [...stored, ...seededSpareProducts.filter(p => !existingIds.has(p.id))];
  const clean = (merged.length === 0 ? seededSpareProducts : merged).filter(p => {
    // Check for fake or mock keywords
    const isMock = /mock|fake|dummy|test|placeholder|sample/i.test(`${p.name} ${p.partNumber} ${p.brand} ${p.description}`);
    if (isMock) return false;

    // Must have valid associated shop
    if (!validShops.includes(p.shopId)) return false;

    // Must have authentic pricing & stock
    if (typeof p.price !== 'number' || p.price <= 0) return false;
    if (typeof p.mrp !== 'number' || p.mrp < p.price) return false;
    if (typeof p.stock !== 'number' || p.stock < 0) return false;

    return true;
  });

  const finalProducts = clean.length > 0 ? clean : seededSpareProducts;
  writeLocal(KEYS.SPARE_PRODUCTS, finalProducts);

  // Synchronize refurbished and preowned stock to customer marketplace
  finalProducts.forEach(p => {
    if (p.condition === 'refurbished' || p.condition === 'preowned') {
      try {
        syncShopPreownedToMarketplace(p);
      } catch (_) {}
    }
  });

  return finalProducts;
}

export function getSpareProducts(): SparePartProduct[] {
  const sanitized = purgeAndSanitizeInventory();
  // Strictly in-stock (> 0) and approved items only - Zero fake products
  return sanitized.filter(p => p.status === 'approved' && p.stock > 0);
}

export function getAllSpareProducts(): SparePartProduct[] {
  return purgeAndSanitizeInventory();
}

export function getSpareShops(): SpareShop[] {
  const stored = readLocal<SpareShop[]>(KEYS.SPARE_SHOPS, []);
  if (stored.length === 0) {
    writeLocal(KEYS.SPARE_SHOPS, seededSpareShops);
    return seededSpareShops;
  }
  return stored;
}

export async function registerSpareShop(shopData: Omit<SpareShop, 'id' | 'status' | 'onboardingFeeRemaining' | 'commissionRate' | 'createdAt'>): Promise<SpareShop> {
  const id = `shop-reg-${Date.now()}`;
  const newShop: SpareShop = {
    ...shopData,
    id,
    status: 'active', // activated with KYC verification
    onboardingFeeRemaining: 2000, // ₹2000 billed gradually with sales
    commissionRate: 0.05, // 5% platform commission
    createdAt: new Date().toISOString()
  };

  const current = getSpareShops();
  const updated = [newShop, ...current];
  writeLocal(KEYS.SPARE_SHOPS, updated);

  try {
    await setDoc(doc(db, 'spare_shops', id), {
      ...newShop,
      firestoreTimestamp: serverTimestamp()
    });
  } catch (err) {
    console.warn('Could not sync shop to Firestore:', err);
  }

  return newShop;
}

export async function updateSpareShopStatus(
  shopId: string,
  status: SpareShop['status'],
  operator: string = 'CEO / Managing Director'
): Promise<void> {
  const currentShops = getSpareShops();
  const shop = currentShops.find(s => s.id === shopId);
  const previous = shop ? shop.status : 'unknown';

  const shops = currentShops.map(s => s.id === shopId ? { ...s, status } : s);
  writeLocal(KEYS.SPARE_SHOPS, shops);

  recordAdminAction({
    operator,
    actionCategory: 'shop_kyc',
    targetId: shopId,
    targetName: shop ? shop.shopName : shopId,
    entityType: 'Shop',
    decision: status === 'active' ? 'APPROVED' : status === 'rejected' ? 'REJECTED' : 'MODIFIED',
    details: `Updated shop status for "${shop?.shopName || shopId}" to "${status}". GSTIN: ${shop?.gstin || 'N/A'}.`,
    previousState: previous,
    newState: status
  });

  try {
    await updateDoc(doc(db, 'spare_shops', shopId), { status, updatedAt: serverTimestamp() });
  } catch (err) {
    console.warn('Firestore shop status update error:', err);
  }
}

// Haversine distance computation in km
export function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return Math.round((R * c) * 10) / 10;
}

// Base Fare Management (Default Balasore: ₹150)
export function getBaseFare(city: string = 'Balasore'): number {
  const fares = readLocal<Record<string, number>>(KEYS.BASE_FARES, defaultCityBaseFares);
  return fares[city] || fares['Balasore'] || 150;
}

export function setBaseFare(city: string, fare: number, operator: string = 'CEO / Managing Director'): Record<string, number> {
  const fares = readLocal<Record<string, number>>(KEYS.BASE_FARES, defaultCityBaseFares);
  const previous = fares[city] || 150;
  fares[city] = fare;
  writeLocal(KEYS.BASE_FARES, fares);

  recordAdminAction({
    operator,
    actionCategory: 'base_fare_change',
    targetId: `FARE-${city.toUpperCase()}`,
    targetName: `${city} Regional Base Fare`,
    entityType: 'RegionalFare',
    decision: 'MODIFIED',
    details: `Adjusted platform baseline labor call-out fare for ${city} from ₹${previous} to ₹${fare}.`,
    previousState: `₹${previous}`,
    newState: `₹${fare}`
  });

  try {
    setDoc(doc(db, 'platform_config', 'base_fares'), { ...fares, updatedAt: serverTimestamp() });
  } catch (err) {
    console.warn('Could not sync base fare to Firestore:', err);
  }
  return fares;
}

export function getAllBaseFares(): Record<string, number> {
  return readLocal<Record<string, number>>(KEYS.BASE_FARES, defaultCityBaseFares);
}

// Product Change Requests (Shop add/edit requests moderated by Company Admin)
export function getProductChangeRequests(): ProductChangeRequest[] {
  return readLocal<ProductChangeRequest[]>(KEYS.PRODUCT_REQUESTS, []);
}

export async function submitProductChangeRequest(req: Omit<ProductChangeRequest, 'id' | 'status' | 'submittedAt'>): Promise<string> {
  const id = `pcr-${Date.now()}`;
  const record: ProductChangeRequest = {
    ...req,
    id,
    status: 'pending',
    submittedAt: new Date().toISOString()
  };

  const requests = [record, ...getProductChangeRequests()];
  writeLocal(KEYS.PRODUCT_REQUESTS, requests);

  try {
    await setDoc(doc(db, 'product_requests', id), {
      ...record,
      firestoreTimestamp: serverTimestamp()
    });
  } catch (err) {
    console.warn('Could not sync product request:', err);
  }

  return id;
}

export async function moderateProductChangeRequest(requestId: string, decision: 'approved' | 'rejected'): Promise<void> {
  const requests = getProductChangeRequests().map(r => r.id === requestId ? { ...r, status: decision } : r);
  writeLocal(KEYS.PRODUCT_REQUESTS, requests);

  const targetReq = requests.find(r => r.id === requestId);

  recordAdminAction({
    operator: 'CEO / Managing Director',
    actionCategory: 'product_moderation',
    targetId: requestId,
    targetName: (targetReq && targetReq.proposedData && targetReq.proposedData.name) || requestId,
    entityType: 'Product',
    decision: decision === 'approved' ? 'APPROVED' : 'REJECTED',
    details: `${decision === 'approved' ? 'Approved' : 'Rejected'} ${targetReq?.type || 'item'} request from "${targetReq?.shopName || 'Partner Shop'}". SKU: ${targetReq?.proposedData.partNumber || 'N/A'}. Listed Price: ₹${targetReq?.proposedData.price || 0}.`,
    previousState: 'pending',
    newState: decision
  });

  if (targetReq && decision === 'approved') {
    const products = getAllSpareProducts();
    if (targetReq.type === 'add') {
      const newProduct: SparePartProduct = {
        id: `pr-${Date.now()}`,
        shopId: targetReq.shopId,
        shopName: targetReq.shopName,
        name: targetReq.proposedData.name || 'New Spare Part',
        partNumber: targetReq.proposedData.partNumber || `SKU-${Date.now()}`,
        category: targetReq.proposedData.category || 'ac',
        price: targetReq.proposedData.price || 100,
        mrp: targetReq.proposedData.mrp || 150,
        stock: targetReq.proposedData.stock || 1,
        image: targetReq.proposedData.image || '/images/appliance.svg',
        brand: targetReq.proposedData.brand || 'OEM Genuine',
        compatibility: targetReq.proposedData.compatibility || 'Universal standard',
        warrantyMonths: targetReq.proposedData.warrantyMonths ?? 6,
        gstRate: targetReq.proposedData.gstRate ?? 0.18,
        status: 'approved',
        description: targetReq.proposedData.description || 'Verified replacement spare part'
      };
      writeLocal(KEYS.SPARE_PRODUCTS, [newProduct, ...products]);
    } else if (targetReq.type === 'edit' && targetReq.productId) {
      const updated = products.map(p => p.id === targetReq.productId ? { ...p, ...targetReq.proposedData, status: 'approved' } : p);
      writeLocal(KEYS.SPARE_PRODUCTS, updated);
    }
  }

  try {
    await updateDoc(doc(db, 'product_requests', requestId), { status: decision, reviewedAt: serverTimestamp() });
  } catch (err) {
    console.warn('Could not sync request decision:', err);
  }
}

// Cloud-Synchronized Shop Inventory Management Services
export async function updateProductStock(productId: string, newStock: number): Promise<void> {
  const stockVal = Math.max(0, newStock);
  const products = getAllSpareProducts().map(p =>
    p.id === productId ? { ...p, stock: stockVal, lastRestockedAt: new Date().toISOString() } : p
  );
  writeLocal(KEYS.SPARE_PRODUCTS, products);

  const targetProd = products.find(p => p.id === productId);
  if (targetProd && (targetProd.condition === 'preowned' || targetProd.condition === 'refurbished')) {
    if (stockVal === 0) {
      removeShopPreownedFromMarketplace(productId);
    } else {
      syncShopPreownedToMarketplace({ ...targetProd, stock: stockVal });
    }
  }

  // Synchronize with Cloud Firestore
  try {
    await setDoc(
      doc(db, 'spare_products', productId),
      { stock: stockVal, lastRestockedAt: serverTimestamp(), updatedAt: serverTimestamp() },
      { merge: true }
    );
  } catch (err) {
    console.warn('Firestore stock sync note:', err);
  }
}

export async function updateProductDetails(
  productId: string,
  updates: Partial<SparePartProduct>
): Promise<SparePartProduct | null> {
  const products = getAllSpareProducts();
  let updatedProduct: SparePartProduct | null = null;

  const newProducts = products.map(p => {
    if (p.id === productId) {
      updatedProduct = { ...p, ...updates };
      return updatedProduct;
    }
    return p;
  });

  if (updatedProduct) {
    writeLocal(KEYS.SPARE_PRODUCTS, newProducts);
    const cond = (updatedProduct as SparePartProduct).condition;
    if (cond === 'preowned' || cond === 'refurbished') {
      if (((updatedProduct as SparePartProduct).stock || 0) > 0) {
        syncShopPreownedToMarketplace(updatedProduct as SparePartProduct);
      } else {
        removeShopPreownedFromMarketplace(productId);
      }
    } else {
      removeShopPreownedFromMarketplace(productId);
    }
    try {
      await setDoc(
        doc(db, 'spare_products', productId),
        { ...updates, updatedAt: serverTimestamp() },
        { merge: true }
      );
    } catch (err) {
      console.warn('Firestore update note:', err);
    }
  }

  return updatedProduct;
}

export async function addInventoryProduct(
  product: Omit<SparePartProduct, 'id'>
): Promise<SparePartProduct> {
  const id = `pr-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const newProduct: SparePartProduct = {
    ...product,
    id,
    lastRestockedAt: new Date().toISOString()
  };

  const current = getAllSpareProducts();
  writeLocal(KEYS.SPARE_PRODUCTS, [newProduct, ...current]);

  if (newProduct.condition === 'preowned') {
    syncShopPreownedToMarketplace(newProduct);
  }

  try {
    await setDoc(doc(db, 'spare_products', id), {
      ...newProduct,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  } catch (err) {
    console.warn('Firestore add product note:', err);
  }

  return newProduct;
}

export async function deleteProductFromInventory(productId: string): Promise<void> {
  const products = getAllSpareProducts().filter(p => p.id !== productId);
  writeLocal(KEYS.SPARE_PRODUCTS, products);
  removeShopPreownedFromMarketplace(productId);

  try {
    await updateDoc(doc(db, 'spare_products', productId), {
      status: 'rejected',
      isDeleted: true,
      updatedAt: serverTimestamp()
    });
  } catch (err) {
    console.warn('Firestore delete note:', err);
  }
}

export function syncShopPreownedToMarketplace(product: SparePartProduct) {
  if (product.condition !== 'preowned' && product.condition !== 'refurbished') return;
  if ((product.stock || 0) <= 0) {
    removeShopPreownedFromMarketplace(product.id);
    return;
  }
  const current = readLocal<any[]>(KEYS.MARKET_LISTINGS, []);
  const existingIdx = current.findIndex(item => item.id === product.id);
  const conditionText = product.condition === 'refurbished'
    ? `Certified Refurbished (Grade ${product.refurbishedGrade || 'A+'}) · 40-Point Diagnostic Passed · ${product.moneyBackDays || 7}-Day Money Back Guarantee`
    : (product.secondHandNotes || 'Fully inspected and tested by certified partner shop.');

  const marketItem = {
    id: product.id,
    mode: 'second_hand',
    name: product.name,
    brand: product.brand || 'Verified Seller',
    product_type: product.category === 'ac' ? 'appliance' : product.category === 'tools' ? 'tools' : 'other',
    value_paise: Math.round(product.price * 100),
    purchase_paise: Math.round((product.mrp || product.price * 1.3) * 100),
    age_months: product.condition === 'refurbished' ? 3 : 6,
    manufacture_year: 2024,
    warranty: product.warrantyMonths ? `${product.warrantyMonths} Months Shop Warranty` : (product.condition === 'refurbished' ? '6 Months Certified Warranty' : 'Verified Testing Warranty'),
    condition: conditionText,
    reason: product.condition === 'refurbished' ? 'OEM Certified Refurbished Inventory' : 'Verified pre-owned shop stock',
    city: 'Balasore',
    radius_km: 15,
    status: 'published',
    image_url: product.image,
    distance_km: 0.8,
    fee_status: 'free_trial',
    free_eligible: true,
    shop_verified: true,
    shop_id: product.shopId,
    shop_name: product.shopName,
    hsn_code: product.hsnCode,
    expires_at: Math.floor(Date.now() / 1000) + (90 * 86400)
  };
  if (existingIdx >= 0) {
    current[existingIdx] = { ...current[existingIdx], ...marketItem };
  } else {
    current.unshift(marketItem);
  }
  writeLocal(KEYS.MARKET_LISTINGS, current);
}

export function removeShopPreownedFromMarketplace(productId: string) {
  const current = readLocal<any[]>(KEYS.MARKET_LISTINGS, []);
  const filtered = current.filter(item => item.id !== productId);
  writeLocal(KEYS.MARKET_LISTINGS, filtered);
}

export function getCommunityMarketListings(): any[] {
  return readLocal<any[]>(KEYS.MARKET_LISTINGS, []);
}

export function saveCommunityMarketListing(item: any): any {
  const current = readLocal<any[]>(KEYS.MARKET_LISTINGS, []);
  const existingIdx = current.findIndex(x => x.id === item.id);
  if (existingIdx >= 0) {
    current[existingIdx] = item;
  } else {
    current.unshift(item);
  }
  writeLocal(KEYS.MARKET_LISTINGS, current);
  return item;
}

// Shop Ledger Entry
export interface ShopLedgerEntry {
  id: string;
  shopId: string;
  orderId: string;
  productName: string;
  itemPrice: number;
  commission: number; // 5%
  onboardingDeduction: number; // ₹50 gradual deduction from ₹2000 fee
  netPayout: number;
  date: string;
  settlementDay: 'Wednesday';
  settlementStatus: 'pending' | 'settled_wednesday';
}

export function getShopLedger(shopId: string): ShopLedgerEntry[] {
  const all = readLocal<ShopLedgerEntry[]>(KEYS.SHOP_LEDGERS, []);
  return all.filter(l => l.shopId === shopId);
}

export function recordShopSale(shopId: string, orderId: string, productName: string, itemPrice: number): ShopLedgerEntry {
  const shops = getSpareShops();
  const shop = shops.find(s => s.id === shopId);
  const commission = Math.round(itemPrice * 0.05);
  
  // Gradual recovery of ₹2000 onboarding fee (e.g. ₹50 per sale)
  let onboardingDeduction = 0;
  if (shop && shop.onboardingFeeRemaining > 0) {
    onboardingDeduction = Math.min(shop.onboardingFeeRemaining, 50);
    const updatedShops = shops.map(s => s.id === shopId ? { ...s, onboardingFeeRemaining: s.onboardingFeeRemaining - onboardingDeduction } : s);
    writeLocal(KEYS.SPARE_SHOPS, updatedShops);
  }

  const netPayout = itemPrice - commission - onboardingDeduction;

  const entry: ShopLedgerEntry = {
    id: `ledg-${Date.now()}`,
    shopId,
    orderId,
    productName,
    itemPrice,
    commission,
    onboardingDeduction,
    netPayout,
    date: new Date().toISOString(),
    settlementDay: 'Wednesday',
    settlementStatus: 'pending'
  };

  const current = readLocal<ShopLedgerEntry[]>(KEYS.SHOP_LEDGERS, []);
  writeLocal(KEYS.SHOP_LEDGERS, [entry, ...current]);
  return entry;
}

// ==========================================
// WORKER IN-TASK SPARE PROCUREMENT SERVICE
// ==========================================

export async function addTaskSpareToBooking(
  bookingId: string,
  product: SparePartProduct,
  customerLat: number = 21.4934,
  customerLng: number = 86.9135
): Promise<BookingRecord | null> {
  const shops = getSpareShops();
  const shop = shops.find(s => s.id === product.shopId) || seededSpareShops[0];

  // Calculate distance between customer repair location and shop
  const distanceKm = calculateDistanceKm(customerLat, customerLng, shop.lat, shop.lng);
  // ₹10/km up and ₹10/km down => distanceKm * 2 * 10
  const travelCharge = Math.max(20, Math.round(distanceKm * 2 * 10));
  const totalBilledToCustomer = product.price + travelCharge;

  const spareItem: TaskSpareItem = {
    id: `tsp-${Date.now()}`,
    productId: product.id,
    name: product.name,
    image: product.image,
    shopId: shop.id,
    shopName: shop.shopName,
    shopPhone: shop.phone,
    shopLat: shop.lat,
    shopLng: shop.lng,
    price: product.price,
    travelDistanceKm: distanceKm,
    travelCharge,
    totalBilledToCustomer,
    status: 'added_to_task',
    addedAt: new Date().toISOString()
  };

  const bookings = getSavedBookings();
  let updatedBooking: BookingRecord | null = null;

  const nextBookings = bookings.map(b => {
    if (b.id === bookingId) {
      const existingSpares = b.taskSpares || [];
      const updatedSpares = [...existingSpares, spareItem];
      const sparePartsTotal = updatedSpares.reduce((sum, s) => sum + s.price, 0);
      const travelChargesTotal = updatedSpares.reduce((sum, s) => sum + s.travelCharge, 0);
      const newPrice = (b.laborCharge || b.price) + sparePartsTotal + travelChargesTotal - (b.discountAmount || 0);

      updatedBooking = {
        ...b,
        taskSpares: updatedSpares,
        sparePartsTotal,
        travelChargesTotal,
        price: newPrice
      };
      return updatedBooking;
    }
    return b;
  });

  const finalBooking = updatedBooking as BookingRecord | null;
  if (finalBooking) {
    writeLocal(KEYS.BOOKINGS, nextBookings);
    // Deduct stock
    updateProductStock(product.id, product.stock - 1);
    // Record ledger entry
    recordShopSale(shop.id, bookingId, product.name, product.price);

    try {
      await updateDoc(doc(db, 'bookings', bookingId), {
        taskSpares: finalBooking.taskSpares,
        sparePartsTotal: finalBooking.sparePartsTotal,
        travelChargesTotal: finalBooking.travelChargesTotal,
        price: finalBooking.price,
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      console.warn('Firestore booking spare sync warning:', err);
    }
  }

  return finalBooking;
}

export async function updateTaskSpareStatus(
  bookingId: string,
  spareItemId: string,
  status: TaskSpareItem['status']
): Promise<BookingRecord | null> {
  const bookings = getSavedBookings();
  let updatedBooking: BookingRecord | null = null;

  const nextBookings = bookings.map(b => {
    if (b.id === bookingId && b.taskSpares) {
      const updatedSpares = b.taskSpares.map(s => s.id === spareItemId ? { ...s, status } : s);
      updatedBooking = { ...b, taskSpares: updatedSpares };
      return updatedBooking;
    }
    return b;
  });

  const finalBooking = updatedBooking as BookingRecord | null;
  if (finalBooking) {
    writeLocal(KEYS.BOOKINGS, nextBookings);
    try {
      await updateDoc(doc(db, 'bookings', bookingId), {
        taskSpares: finalBooking.taskSpares,
        updatedAt: serverTimestamp()
      });
    } catch (err) {}
  }

  return finalBooking;
}

// 15-Minute Task Acknowledgement
export async function acknowledgeBooking(bookingId: string): Promise<BookingRecord[]> {
  return updateBookingStatus(bookingId, {
    acknowledgedAt: new Date().toISOString(),
    status: 'confirmed',
    timelineStep: 'acknowledged'
  });
}

// 15-Minute Deadline Expiry: Discovery Engine Reassignment to Next Best Worker
export async function timeoutAndReassignBooking(bookingId: string): Promise<BookingRecord | null> {
  const bookings = getSavedBookings();
  const booking = bookings.find(b => b.id === bookingId);
  if (!booking) return null;

  // Run discovery engine to find next best worker
  const matches = getCandidateMatches(booking.serviceId, undefined, booking.city || 'Balasore');
  const otherCandidates = matches
    .filter((m: any) => m.worker.id !== booking.worker?.id)
    .sort((a: any, b: any) => b.matchScore - a.matchScore);

  const nextWorker = otherCandidates[0]?.worker || seededWorkers[0];

  const updated: BookingRecord = {
    ...booking,
    worker: nextWorker,
    status: 'requested',
    acknowledgedAt: undefined,
    acknowledgementDeadline: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    timelineStep: 'assigned'
  };

  const nextBookings = bookings.map(b => b.id === bookingId ? updated : b);
  writeLocal(KEYS.BOOKINGS, nextBookings);

  try {
    await updateDoc(doc(db, 'bookings', bookingId), {
      worker: nextWorker,
      status: 'requested',
      acknowledgedAt: null,
      acknowledgementDeadline: updated.acknowledgementDeadline,
      timelineStep: 'assigned',
      reassignedAt: serverTimestamp()
    });
  } catch (err) {}

  return updated;
}

export async function updateBookingTimeline(
  bookingId: string,
  timelineStep: BookingRecord['timelineStep']
): Promise<BookingRecord[]> {
  const statusMap: Record<NonNullable<BookingRecord['timelineStep']>, BookingRecord['status']> = {
    assigned: 'requested',
    acknowledged: 'confirmed',
    on_the_way: 'on_the_way',
    in_progress: 'in_progress',
    completed: 'completed'
  };

  const status = timelineStep ? statusMap[timelineStep] : 'in_progress';
  return updateBookingStatus(bookingId, { timelineStep, status });
}

/**
 * Worker / Agent Session & Onboarding Foundation
 */
export function normalizePhone(phone: string): string {
  return (phone || '').replace(/\D/g, '').slice(-10);
}

export function findWorkerByPhone(phone: string): WorkerProfile | undefined {
  const digits = normalizePhone(phone);
  if (!digits) return undefined;
  return getWorkers().find(worker => normalizePhone(worker.phone) === digits);
}

export function readWorkerSession(): WorkerProfile | null {
  const saved = readLocal<WorkerProfile | null>(KEYS.WORKER_SESSION, null);
  return saved && saved.id ? saved : null;
}

export function saveWorkerSession(worker: WorkerProfile | null): void {
  if (!worker) {
    localStorage.removeItem(KEYS.WORKER_SESSION);
    return;
  }
  writeLocal(KEYS.WORKER_SESSION, worker);
}

export function createWorkerFromOnboarding(data: WorkerOnboardingDraft): WorkerProfile {
  const safeName = data.name.trim() || 'New Technician';
  const role = data.role === 'specialist' ? 'specialist' : 'technician';
  const cleanedPhone = normalizePhone(data.phone);
  const nextWorker: WorkerProfile = {
    id: `w-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: safeName,
    role,
    category: data.category || 'ac',
    avatar: safeName.split(' ').map(part => part[0] || '').slice(0, 2).join('').toUpperCase() || 'NT',
    level: 1,
    points: 0,
    maxLevelPoints: 1500,
    taskScore: 4.8,
    completedTasks: 0,
    distanceKm: 3,
    bestSkill: (data.skills || [data.category || 'general service'])[0] || 'General service',
    specializedSkills: data.skills && data.skills.length ? data.skills : ['General service'],
    toolsEquipped: data.tools && data.tools.length ? data.tools.join(', ') : 'Standard essential technician kit',
    toolsList: data.tools && data.tools.length ? data.tools : ['Basic toolkit', 'Safety gloves'],
    hasSpecialistKit: role === 'specialist',
    yearsExperience: Math.max(1, Number(data.experienceYears) || 1),
    city: data.city || 'Balasore',
    phone: cleanedPhone ? `+91 ${cleanedPhone.slice(0, 5)} ${cleanedPhone.slice(5)}`.trim() : '+91 00000 00000',
    verifiedKyc: false,
    pricingModel: 'hourly',
    baseFare: 150,
    hourlyRate: role === 'specialist' ? 499 : 299,
    fixedPrice: role === 'specialist' ? 699 : 399,
    gigs: [{
      id: `gig-${Date.now()}`,
      title: `${role === 'specialist' ? 'Specialist' : 'Technician'} onboarding service`,
      category: data.category || 'ac',
      skills: data.skills && data.skills.length ? data.skills : ['General service'],
      tools: data.tools && data.tools.length ? data.tools.slice(0, 3) : ['Basic toolkit'],
      pricingModel: 'hourly',
      baseFare: 150,
      hourlyRate: role === 'specialist' ? 499 : 299,
      fixedPrice: role === 'specialist' ? 699 : 399,
      description: 'Onboarded via Repaido worker verification flow.'
    }]
  };

  const current = getWorkers();
  const nextWorkers = [nextWorker, ...current.filter(item => item.phone !== nextWorker.phone)];
  saveWorkers(nextWorkers);
  return nextWorker;
}

export function getWorkers(): WorkerProfile[] {
  // Legacy device profiles are unverified and must not enter live discovery.
  return [];
}

export function saveWorkers(workers: WorkerProfile[]): void {
  writeLocal(KEYS.WORKERS, workers);
}

export function updateWorkerProfile(workerId: string, updates: Partial<WorkerProfile>): WorkerProfile {
  const current = getWorkers();
  const workerIndex = current.findIndex(w => w.id === workerId);
  if (workerIndex === -1) {
    throw new Error('Use the authenticated worker profile API. Local worker profiles are no longer supported.');
  }
  const updated = { ...current[workerIndex], ...updates };
  current[workerIndex] = updated;
  saveWorkers([...current]);
  return updated;
}

export function updateSpareShop(shopId: string, updates: Partial<SpareShop>): SpareShop | null {
  const shops = getSpareShops();
  const index = shops.findIndex(shop => shop.id === shopId);
  if (index === -1) return null;
  const updated = { ...shops[index], ...updates };
  shops[index] = updated;
  writeLocal(KEYS.SPARE_SHOPS, shops);
  void updateDoc(doc(db, 'spare_shops', shopId), { ...updates, updatedAt: serverTimestamp() }).catch(() => undefined);
  return updated;
}

export function addWorkerGig(workerId: string, gig: Omit<WorkerGig, 'id'>): WorkerProfile {
  const newGig: WorkerGig = {
    ...gig,
    id: `gig-${Date.now()}`
  };
  const current = getWorkers();
  const worker = current.find(w => w.id === workerId) || current[0];
  const existingGigs = worker.gigs || [];
  const updatedGigs = [...existingGigs, newGig];
  
  return updateWorkerProfile(worker.id, {
    gigs: updatedGigs,
    pricingModel: gig.pricingModel,
    baseFare: gig.baseFare,
    hourlyRate: gig.hourlyRate || worker.hourlyRate,
    fixedPrice: gig.fixedPrice || worker.fixedPrice
  });
}

/**
 * Customer Post-Completion Rating & Review
 * Validates rating (1-5), updates booking, and recalculates worker's live score
 */
export async function rateBookingWorker(
  bookingId: string,
  rating: number,
  review?: string
): Promise<{ booking: BookingRecord; worker?: WorkerProfile } | null> {
  const validRating = Math.max(1, Math.min(5, Math.round(rating)));
  const bookings = getSavedBookings();
  const bIndex = bookings.findIndex(b => b.id === bookingId);
  if (bIndex === -1) return null;

  const b = bookings[bIndex];
  const updatedBooking: BookingRecord = {
    ...b,
    ratingGiven: validRating,
    customerReview: review?.trim() || undefined,
    customerRatedAt: new Date().toISOString()
  };
  bookings[bIndex] = updatedBooking;
  writeLocal(KEYS.BOOKINGS, bookings);

  // If there's an assigned worker, update their taskScore and completedTasks
  let updatedWorker: WorkerProfile | undefined = undefined;
  if (b.worker) {
    const workers = getWorkers();
    const wIndex = workers.findIndex(w => w.id === b.worker?.id);
    if (wIndex !== -1) {
      const w = workers[wIndex];
      const prevTotal = (w.completedTasks || 1) * (w.taskScore || 4.8);
      const newScore = Math.round(((prevTotal + validRating) / (w.completedTasks + 1)) * 100) / 100;
      w.taskScore = newScore;
      workers[wIndex] = w;
      saveWorkers([...workers]);
      updatedWorker = w;
    }
  }

  try {
    await updateDoc(doc(db, 'bookings', bookingId), {
      ratingGiven: validRating,
      customerReview: review?.trim() || null,
      customerRatedAt: serverTimestamp()
    });
  } catch {}

  return { booking: updatedBooking, worker: updatedWorker };
}

/**
 * Validated Final Billing Calculation Engine
 * Accurately computes Base Fare (₹150 standard), Labor (Hourly vs Fixed), Spares, Travel, Discounts, and Platform Commission
 */
export function sumCompletedWorkerIncome(bookings: BookingRecord[], workerId: string): number {
  return bookings
    .filter(b => b.worker?.id === workerId && b.status === 'completed')
    .reduce((sum, booking) => sum + (booking.workerNetPayout ?? 0), 0);
}

export function calculateTaskBilling(params: {
  pricingModel?: WorkerPricingModel;
  baseFare?: number;
  hourlyRate?: number;
  hours?: number;
  fixedPrice?: number;
  taskSpares?: TaskSpareItem[];
  isNewUserDiscount?: boolean;
  workerRating?: number;
}): {
  baseFare: number;
  laborCharge: number;
  sparesSubtotal: number;
  travelChargesTotal: number;
  grossTotal: number;
  discountAmount: number;
  netPayable: number;
  platformCommission: number;
  workerDirectPayout: number;
  workerRetentionBonus: number;
  workerNetPayout: number;
  workerBonusEligible: boolean;
  userWalletCredit: number;
} {
  const baseFare = Math.max(150, params.baseFare ?? 150);
  const isFixed = params.pricingModel === 'fixed';
  
  let laborCharge = 0;
  if (isFixed) {
    laborCharge = params.fixedPrice ?? 399;
  } else {
    const rate = params.hourlyRate ?? 299;
    const hours = Math.max(1, params.hours ?? 1);
    laborCharge = baseFare + Math.round(rate * hours);
  }

  const sparesSubtotal = (params.taskSpares || []).reduce((sum, s) => sum + s.price, 0);
  const travelChargesTotal = (params.taskSpares || []).reduce((sum, s) => sum + s.travelCharge, 0);
  const grossTotal = laborCharge + sparesSubtotal + travelChargesTotal;

  const discountAmount = params.isNewUserDiscount ? Math.round(laborCharge * 0.5) : 0;
  const netPayable = Math.max(0, grossTotal - discountAmount);

  const workerRating = params.workerRating ?? 4.8;
  const workerBonusEligible = workerRating >= 4.5;
  const platformCommission = Math.round(grossTotal * 0.15);
  const workerDirectPayout = Math.round(grossTotal * 0.75);
  const workerRetentionBonus = workerBonusEligible ? Math.round(grossTotal * 0.10) : 0;
  const workerNetPayout = workerDirectPayout + workerRetentionBonus;
  const userWalletCredit = workerBonusEligible ? 0 : Math.round(grossTotal * 0.10);

  return {
    baseFare,
    laborCharge,
    sparesSubtotal,
    travelChargesTotal,
    grossTotal,
    discountAmount,
    netPayable,
    platformCommission,
    workerDirectPayout,
    workerRetentionBonus,
    workerNetPayout,
    workerBonusEligible,
    userWalletCredit
  };
}

// ==========================================
// SHOP NOTIFICATIONS & COMPANY DIRECTIVES
// ==========================================

export function getShopNotifications(shopId: string): ShopNotification[] {
  const stored = readLocal<ShopNotification[]>(KEYS.SHOP_NOTIFICATIONS, []);
  
  // Also collect any dynamic company directives addressed to this shop or 'ALL'
  const directives = getCompanyDirectivesForShop(shopId);
  const directiveNotifs: ShopNotification[] = directives.map(d => ({
    id: `notif-dir-${d.id}`,
    shopId,
    type: 'company_directive',
    priority: d.priority,
    title: `🏢 HQ Directive: ${d.title}`,
    message: d.instructions,
    timestamp: d.issuedAt,
    read: d.acknowledged,
    actionTarget: {
      tab: 'company_oversight',
      directiveId: d.id,
      actionType: 'view_directive'
    },
    sender: d.issuedBy || 'Repaido Company Admin'
  }));

  // Dynamic check for low stock and out-of-stock items in this shop's inventory
  const products = getAllSpareProducts().filter(p => p.shopId === shopId);
  const stockNotifs: ShopNotification[] = [];
  products.forEach(p => {
    if (p.stock === 0) {
      stockNotifs.push({
        id: `notif-out-stock-${p.id}`,
        shopId,
        type: 'low_stock',
        priority: 'urgent',
        title: `🚨 Out of Stock: ${p.name}`,
        message: `Stock is 0 for SKU: ${p.partNumber || p.id}. Product is currently hidden from marketplace. Click to restock.`,
        timestamp: new Date().toISOString(),
        read: false,
        actionTarget: {
          tab: 'inventory',
          productId: p.id,
          sku: p.partNumber,
          actionType: 'open_stock_modal'
        },
        sender: 'Repaido Inventory Monitor'
      });
    } else if (p.stock <= 5) {
      stockNotifs.push({
        id: `notif-low-stock-${p.id}`,
        shopId,
        type: 'low_stock',
        priority: 'high',
        title: `⚠️ Low Stock Warning: ${p.name}`,
        message: `Only ${p.stock} units remaining (SKU: ${p.partNumber || p.id}). Restock now to prevent stockouts.`,
        timestamp: new Date().toISOString(),
        read: false,
        actionTarget: {
          tab: 'inventory',
          productId: p.id,
          sku: p.partNumber,
          actionType: 'open_stock_modal'
        },
        sender: 'Repaido Inventory Monitor'
      });
    }
  });

  // Default seeded operational notifications if none stored yet
  let list = stored.filter(n => n.shopId === shopId || n.shopId === 'ALL');
  if (list.length === 0) {
    const seed: ShopNotification[] = [
      {
        id: `notif-seed-settle-${shopId}`,
        shopId,
        type: 'settlement',
        priority: 'normal',
        title: '💰 Wednesday Settlement Processed',
        message: '₹14,850 credited to registered bank account. Click to view full audit breakdown and payout ledger.',
        timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
        read: false,
        actionTarget: {
          tab: 'ledger'
        },
        sender: 'Repaido Finance Desk'
      },
      {
        id: `notif-seed-hsn-${shopId}`,
        shopId,
        type: 'company_directive',
        priority: 'high',
        title: '🏢 Company Directive: Mandatory HSN Numbers Active',
        message: 'Repaido HQ has mandated valid 4-to-8 digit HSN codes for all inventory. Review your HSN & Tax Audit report.',
        timestamp: new Date(Date.now() - 3600000 * 6).toISOString(),
        read: false,
        actionTarget: {
          tab: 'inventory'
        },
        sender: 'Repaido Operations HQ'
      }
    ];
    writeLocal(KEYS.SHOP_NOTIFICATIONS, seed);
    list = seed;
  }

  // Merge and deduplicate by id
  const map = new Map<string, ShopNotification>();
  // Dynamic stock notifications first
  stockNotifs.forEach(n => map.set(n.id, n));
  // Directives
  directiveNotifs.forEach(n => map.set(n.id, n));
  // Stored / acknowledged overrides
  list.forEach(n => {
    if (map.has(n.id)) {
      map.set(n.id, { ...map.get(n.id)!, read: n.read });
    } else {
      map.set(n.id, n);
    }
  });

  const priorityWeight = { urgent: 3, high: 2, normal: 1 };
  return Array.from(map.values()).sort((a, b) => {
    if (a.read !== b.read) return a.read ? 1 : -1;
    const pDiff = (priorityWeight[b.priority] || 1) - (priorityWeight[a.priority] || 1);
    if (pDiff !== 0) return pDiff;
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });
}

export function markShopNotificationAsRead(notifId: string): void {
  const stored = readLocal<ShopNotification[]>(KEYS.SHOP_NOTIFICATIONS, []);
  let found = false;
  const updated = stored.map(n => {
    if (n.id === notifId) {
      found = true;
      return { ...n, read: true };
    }
    return n;
  });
  if (!found) {
    updated.push({
      id: notifId,
      shopId: 'ALL',
      type: 'company_directive',
      priority: 'normal',
      title: 'Notification',
      message: '',
      timestamp: new Date().toISOString(),
      read: true,
      actionTarget: { tab: 'orders' }
    });
  }
  writeLocal(KEYS.SHOP_NOTIFICATIONS, updated);
}

export function markAllShopNotificationsAsRead(shopId: string): void {
  const current = getShopNotifications(shopId);
  const updated = current.map(n => ({ ...n, read: true }));
  writeLocal(KEYS.SHOP_NOTIFICATIONS, updated);
}

export function getCompanyDirectivesForShop(shopId: string): CompanyShopDirective[] {
  const directives = readLocal<CompanyShopDirective[]>(KEYS.COMPANY_DIRECTIVES, []);
  if (directives.length === 0) {
    const defaultDirectives: CompanyShopDirective[] = [
      {
        id: 'dir-hq-01',
        shopId: 'ALL',
        title: 'Q3 GST E-Way Bill & HSN Number Verification',
        category: 'compliance',
        priority: 'urgent',
        instructions: 'All partner shops must verify that HSN codes are mapped to every active SKU. Run the HSN & Tax Audit report from your inventory dashboard.',
        issuedAt: new Date(Date.now() - 3600000 * 12).toISOString(),
        deadline: new Date(Date.now() + 86400000 * 2).toISOString(),
        issuedBy: 'Managing Director / Repaido HQ',
        acknowledged: false
      },
      {
        id: 'dir-hq-02',
        shopId: 'ALL',
        title: 'Festive Season Express Handover Protocol',
        category: 'urgent_order',
        priority: 'high',
        instructions: 'Peak maintenance demand in progress. Delivery agents arrive within 10-15 minutes of order placement. Keep stock packed with printed challan.',
        issuedAt: new Date(Date.now() - 3600000 * 24).toISOString(),
        issuedBy: 'Head of Logistics / Repaido HQ',
        acknowledged: false
      }
    ];
    writeLocal(KEYS.COMPANY_DIRECTIVES, defaultDirectives);
    return defaultDirectives;
  }
  return directives.filter(d => d.shopId === 'ALL' || d.shopId === shopId);
}

export async function sendCompanyDirectiveToShop(directive: Omit<CompanyShopDirective, 'id' | 'issuedAt' | 'acknowledged'>): Promise<CompanyShopDirective> {
  const id = `dir-${Date.now()}`;
  const newDirective: CompanyShopDirective = {
    ...directive,
    id,
    issuedAt: new Date().toISOString(),
    acknowledged: false
  };
  const directives = readLocal<CompanyShopDirective[]>(KEYS.COMPANY_DIRECTIVES, []);
  const updated = [newDirective, ...directives];
  writeLocal(KEYS.COMPANY_DIRECTIVES, updated);

  const notif: ShopNotification = {
    id: `notif-dir-${id}`,
    shopId: newDirective.shopId,
    type: 'company_directive',
    priority: newDirective.priority,
    title: `🏢 HQ Directive: ${newDirective.title}`,
    message: newDirective.instructions,
    timestamp: newDirective.issuedAt,
    read: false,
    actionTarget: {
      tab: 'company_oversight',
      directiveId: id,
      actionType: 'view_directive'
    },
    sender: newDirective.issuedBy
  };
  const notifications = readLocal<ShopNotification[]>(KEYS.SHOP_NOTIFICATIONS, []);
  writeLocal(KEYS.SHOP_NOTIFICATIONS, [notif, ...notifications]);

  return newDirective;
}

export function acknowledgeCompanyDirective(directiveId: string): void {
  const directives = readLocal<CompanyShopDirective[]>(KEYS.COMPANY_DIRECTIVES, []);
  const updated = directives.map(d => d.id === directiveId ? { ...d, acknowledged: true, acknowledgedAt: new Date().toISOString() } : d);
  writeLocal(KEYS.COMPANY_DIRECTIVES, updated);
  markShopNotificationAsRead(`notif-dir-${directiveId}`);
}

export async function updateShopOperationalStatus(
  shopId: string,
  status: SpareShop['status'],
  isFrozen: boolean,
  reason?: string,
  operator: string = 'Repaido Company Admin'
): Promise<void> {
  const shops = getSpareShops();
  const updated = shops.map(s => {
    if (s.id === shopId) {
      return {
        ...s,
        status,
        isOperationsFrozen: isFrozen,
        frozenReason: isFrozen ? reason : undefined,
        operationalNotes: `Updated by ${operator} at ${new Date().toLocaleString()}`
      };
    }
    return s;
  });
  writeLocal(KEYS.SPARE_SHOPS, updated);

  if (isFrozen || status === 'suspended_by_hq') {
    const products = getAllSpareProducts().filter(p => p.shopId === shopId);
    products.forEach(p => {
      try {
        removeShopPreownedFromMarketplace(p.id);
      } catch (_) {}
    });
  }

  const notif: ShopNotification = {
    id: `notif-status-${Date.now()}`,
    shopId,
    type: 'company_directive',
    priority: isFrozen ? 'urgent' : 'high',
    title: isFrozen ? '🚨 Shop Operations Suspended by Repaido HQ' : '✅ Shop Operational Status Updated',
    message: isFrozen
      ? `Your shop has been temporarily suspended by Repaido HQ. Reason: ${reason || 'Compliance verification pending'}. Contact partner desk.`
      : `Your operational status has been set to ${status.toUpperCase()} by ${operator}.`,
    timestamp: new Date().toISOString(),
    read: false,
    actionTarget: {
      tab: 'company_oversight'
    },
    sender: operator
  };
  const notifications = readLocal<ShopNotification[]>(KEYS.SHOP_NOTIFICATIONS, []);
  writeLocal(KEYS.SHOP_NOTIFICATIONS, [notif, ...notifications]);
}
