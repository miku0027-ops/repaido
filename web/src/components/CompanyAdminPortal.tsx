import React, { useState, useEffect, useRef, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  ShieldAlert,
  Lock,
  DollarSign,
  CheckCircle2,
  XCircle,
  Settings,
  Store,
  FileText,
  Activity,
  Layers,
  MapPin,
  Clock,
  ArrowRight,
  TrendingUp,
  Award,
  Users,
  Briefcase,
  AlertCircle,
  Search,
  Filter,
  ArrowUpDown,
  Bell,
  Check,
  X,
  ExternalLink,
  ChevronRight,
  Phone,
  Mail,
  Calendar,
  CreditCard,
  Building2,
  Wrench,
  Compass,
  Map as MapIcon,
  ShieldCheck,
  Eye,
  RefreshCw,
  LogOut,
  Menu
} from 'lucide-react';
import type { ProductChangeRequest, SpareShop, BookingRecord } from '../types';
import {
  getAllBaseFares,
  setBaseFare,
  getProductChangeRequests,
  moderateProductChangeRequest,
  getSpareShops,
  updateSpareShopStatus,
  getSavedBookings,
  getSavedPartnerApplications,
  approvePartnerApplication,
  rejectPartnerApplication,
  getAdminLedger,
  type PartnerApplication,
  type AdminLedgerEntry
} from '../services/repaidoService';
import { formatMoney, seededWorkers } from '../data';

interface CompanyAdminPortalProps {
  onBackToMain?: () => void;
}

type TabType =
  | 'overview'
  | 'agent_requests'
  | 'shop_kyc'
  | 'product_moderation'
  | 'base_fares'
  | 'demographic_map'
  | 'audit_ledger'
  | 'dispatch_engine';

const CEO_ADMIN_SESSION_KEY = 'repaido.companyAdminSession';

function getSavedCompanyAdminSession() {
  try {
    const raw = localStorage.getItem(CEO_ADMIN_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { secretId?: string; secretPassword?: string };
    if (!parsed.secretId || !parsed.secretPassword) return null;
    return parsed;
  } catch {
    return null;
  }
}

export const CompanyAdminPortal: React.FC<CompanyAdminPortalProps> = ({ onBackToMain }) => {
  const savedSession = getSavedCompanyAdminSession();

  // Secret credentials
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(Boolean(savedSession));
  const [secretId, setSecretId] = useState<string>(savedSession?.secretId || '');
  const [secretPassword, setSecretPassword] = useState<string>(savedSession?.secretPassword || '');
  const [authError, setAuthError] = useState<string>('');

  // Navigation & UI state
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);

  // Business Data States
  const [baseFares, setBaseFaresState] = useState<Record<string, number>>({});
  const [editingCity, setEditingCity] = useState<string>('Balasore');
  const [newCityFare, setNewCityFare] = useState<number>(150);
  const [fareSaveSuccess, setFareSaveSuccess] = useState<boolean>(false);

  const [requests, setRequests] = useState<ProductChangeRequest[]>([]);
  const [shops, setShops] = useState<SpareShop[]>([]);
  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [partnerApps, setPartnerApps] = useState<PartnerApplication[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<AdminLedgerEntry[]>([]);

  // Notification Popup & Request Detail Modal
  const [notificationToast, setNotificationToast] = useState<{
    id: string;
    type: 'agent' | 'shop' | 'product';
    title: string;
    subtitle: string;
    data: any;
  } | null>(null);

  const [selectedEntityModal, setSelectedEntityModal] = useState<{
    type: 'agent' | 'shop' | 'product';
    data: any;
  } | null>(null);

  const [rejectionReasonInput, setRejectionReasonInput] = useState<string>('');
  const [showRejectPrompt, setShowRejectPrompt] = useState<boolean>(false);

  // Universal Filter & Sorting States
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'name' | 'value'>('newest');

  // Demographic Map States
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const [showTechnicianLayer, setShowTechnicianLayer] = useState<boolean>(true);
  const [showShopLayer, setShowShopLayer] = useState<boolean>(true);
  const [showBookingLayer, setShowBookingLayer] = useState<boolean>(true);

  const refreshData = () => {
    setBaseFaresState(getAllBaseFares());
    setRequests(getProductChangeRequests());
    setShops(getSpareShops());
    setBookings(getSavedBookings());
    const apps = getSavedPartnerApplications();
    setPartnerApps(apps);
    setLedgerEntries(getAdminLedger());

    // Set prominent notification if pending applications exist
    const pendingApp = apps.find(a => a.status === 'pending_verification');
    if (pendingApp) {
      setNotificationToast({
        id: pendingApp.id,
        type: 'agent',
        title: `🚨 Agent Join Request: ${pendingApp.name}`,
        subtitle: `${pendingApp.role} (${pendingApp.tradeCategory}) • Balasore • Tap to Review`,
        data: pendingApp
      });
    }
  };

  useEffect(() => {
    refreshData();
  }, []);

  useEffect(() => {
    if (isAuthenticated && secretId && secretPassword) {
      localStorage.setItem(CEO_ADMIN_SESSION_KEY, JSON.stringify({ secretId, secretPassword }));
    } else {
      localStorage.removeItem(CEO_ADMIN_SESSION_KEY);
    }
  }, [isAuthenticated, secretId, secretPassword]);

  // Reset filters when tab changes
  useEffect(() => {
    setSearchQuery('');
    setStatusFilter('all');
    setCategoryFilter('all');
    setSortBy('newest');
  }, [activeTab]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (
      (secretId.trim() === 'repaido_admin' || secretId.trim() === 'admin@repaido.in') &&
      secretPassword.trim() === 'repaido_core_2026'
    ) {
      setIsAuthenticated(true);
      setAuthError('');
    } else {
      setAuthError('Invalid Secret ID or Security Key. Access restricted to Repaido Executives.');
    }
  };

  const handleQuickDemoLogin = () => {
    setSecretId('repaido_admin');
    setSecretPassword('repaido_core_2026');
    setIsAuthenticated(true);
    setAuthError('');
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setSecretPassword('');
    setAuthError('');
    localStorage.removeItem(CEO_ADMIN_SESSION_KEY);
  };

  const handleSaveBaseFare = () => {
    const updated = setBaseFare(editingCity, Number(newCityFare), 'CEO / Managing Director');
    setBaseFaresState(updated);
    setFareSaveSuccess(true);
    setLedgerEntries(getAdminLedger());
    setTimeout(() => setFareSaveSuccess(false), 2500);
  };

  // Moderate Product
  const handleModerateRequest = async (requestId: string, decision: 'approved' | 'rejected') => {
    await moderateProductChangeRequest(requestId, decision);
    refreshData();
    if (selectedEntityModal?.type === 'product' && selectedEntityModal.data.id === requestId) {
      setSelectedEntityModal(null);
    }
  };

  // Toggle Shop Status
  const handleToggleShopStatus = async (shopId: string, currentStatus: SpareShop['status'], newStatus?: SpareShop['status']) => {
    const nextStatus = newStatus || (currentStatus === 'active' ? 'pending_verification' : 'active');
    await updateSpareShopStatus(shopId, nextStatus, 'CEO / Managing Director');
    refreshData();
    if (selectedEntityModal?.type === 'shop' && selectedEntityModal.data.id === shopId) {
      setSelectedEntityModal(null);
    }
  };

  // Agent Application Decision
  const handleApproveAgent = (appId: string) => {
    approvePartnerApplication(appId, 'CEO / Managing Director');
    refreshData();
    setSelectedEntityModal(null);
    setShowRejectPrompt(false);
    if (notificationToast?.data?.id === appId) {
      setNotificationToast(null);
    }
  };

  const handleRejectAgent = (appId: string) => {
    const reason = rejectionReasonInput.trim() || 'Criteria not fulfilled / Incomplete verification documents';
    rejectPartnerApplication(appId, reason, 'CEO / Managing Director');
    refreshData();
    setSelectedEntityModal(null);
    setShowRejectPrompt(false);
    setRejectionReasonInput('');
    if (notificationToast?.data?.id === appId) {
      setNotificationToast(null);
    }
  };

  // Initialize Demographic Leaflet Map
  useEffect(() => {
    if (!isAuthenticated || activeTab !== 'demographic_map') return;

    const timer = setTimeout(() => {
      if (!mapContainerRef.current) return;

      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }

      // Default center Balasore Central
      const map = L.map(mapContainerRef.current, {
        center: [21.4934, 86.9135],
        zoom: 13,
        zoomControl: true
      });

      // 1. Base Layer: OpenStreetMap
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap'
      }).addTo(map);

      // 2. Google Maps Roadmap Live Tiles
      L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        attribution: '&copy; Google Maps'
      }).addTo(map);

      // Layer 1: Technicians / Agents (Green / Amber Pins)
      if (showTechnicianLayer) {
        partnerApps.forEach(app => {
          const lat = app.lat || 21.4934;
          const lng = app.lng || 86.9135;
          const isSpecialist = app.role === 'Specialist';
          const isPending = app.status === 'pending_verification';

          const icon = L.divIcon({
            className: 'custom-tech-pin',
            html: `
              <div style="transform: translate(-50%, -100%); display: flex; flex-direction: column; align-items: center;">
                <div style="background: ${isPending ? '#D97706' : '#059669'}; color: white; padding: 3px 6px; border-radius: 6px; font-weight: bold; font-size: 10px; box-shadow: 0 2px 6px rgba(0,0,0,0.25); white-space: nowrap; border: 1.5px solid white;">
                  👷 ${app.name.split(' ')[0]} ${isSpecialist ? '★' : ''}
                </div>
                <div style="width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 6px solid ${isPending ? '#D97706' : '#059669'};"></div>
              </div>
            `,
            iconSize: [80, 40],
            iconAnchor: [40, 40]
          });

          const marker = L.marker([lat, lng], { icon }).addTo(map);
          marker.bindPopup(`
            <div style="font-family: var(--ui-font); font-size: 12px; min-width: 180px; color: #0f172a;">
              <strong style="font-size: 13px;">${app.name}</strong>
              <div style="color: ${isSpecialist ? '#b45309' : '#047857'}; font-weight: bold; margin-top: 2px;">${app.role} • ${app.tradeCategory}</div>
              <div style="margin-top: 4px; font-size: 11px; color: #475569;">Rate: <strong>₹${app.hourlyRate || 250}/hr</strong> (Platform cut: 3%)</div>
              <div style="font-size: 11px; color: #64748b;">Status: <span style="font-weight: bold; text-transform: uppercase;">${app.status}</span></div>
              <div style="margin-top: 6px; font-size: 10px; color: #94a3b8;">${app.homeAddress}</div>
            </div>
          `);
        });
      }

      // Layer 2: Partner Shops (Blue / Purple Pins)
      if (showShopLayer) {
        shops.forEach(shop => {
          const lat = shop.lat || 21.498;
          const lng = shop.lng || 86.918;

          const icon = L.divIcon({
            className: 'custom-shop-pin',
            html: `
              <div style="transform: translate(-50%, -100%); display: flex; flex-direction: column; align-items: center;">
                <div style="background: #2563EB; color: white; padding: 3px 6px; border-radius: 6px; font-weight: bold; font-size: 10px; box-shadow: 0 2px 6px rgba(0,0,0,0.25); white-space: nowrap; border: 1.5px solid white;">
                  🏬 ${shop.shopName}
                </div>
                <div style="width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 6px solid #2563EB;"></div>
              </div>
            `,
            iconSize: [100, 40],
            iconAnchor: [50, 40]
          });

          const marker = L.marker([lat, lng], { icon }).addTo(map);
          marker.bindPopup(`
            <div style="font-family: var(--ui-font); font-size: 12px; min-width: 200px; color: #0f172a;">
              <strong style="font-size: 13px;">${shop.shopName}</strong>
              <div style="color: #2563eb; font-weight: bold; margin-top: 2px;">Proprietor: ${shop.ownerName}</div>
              <div style="margin-top: 4px; font-size: 11px;">GSTIN: <span style="font-family: var(--ui-font);">${shop.gstin}</span></div>
              <div style="font-size: 11px; color: #059669; font-weight: bold;">Commission: 5% Platform Cut</div>
              <div style="font-size: 11px; color: #d97706;">Onboarding Due: ₹${shop.onboardingFeeRemaining}</div>
              <div style="margin-top: 6px; font-size: 10px; color: #94a3b8;">${shop.address}</div>
            </div>
          `);
        });
      }

      // Layer 3: Customer Booking Demand (Red Pulsing Rings)
      if (showBookingLayer) {
        bookings.forEach((booking, idx) => {
          // Approximate layout around Balasore
          const lat = 21.4934 + (Math.sin(idx * 1.5) * 0.02);
          const lng = 86.9135 + (Math.cos(idx * 1.5) * 0.02);

          const icon = L.divIcon({
            className: 'custom-booking-pin',
            html: `
              <div style="transform: translate(-50%, -100%); display: flex; flex-direction: column; align-items: center;">
                <div style="background: #DC2626; color: white; padding: 2px 5px; border-radius: 4px; font-weight: bold; font-size: 9px; box-shadow: 0 2px 6px rgba(0,0,0,0.25); white-space: nowrap; border: 1px solid white;">
                  📍 ${booking.serviceName.slice(0, 14)}...
                </div>
                <div style="width: 0; height: 0; border-left: 4px solid transparent; border-right: 4px solid transparent; border-top: 5px solid #DC2626;"></div>
              </div>
            `,
            iconSize: [80, 35],
            iconAnchor: [40, 35]
          });

          const marker = L.marker([lat, lng], { icon }).addTo(map);
          marker.bindPopup(`
            <div style="font-family: var(--ui-font); font-size: 12px; color: #0f172a;">
              <strong>${booking.serviceName}</strong>
              <div style="color: #dc2626; font-weight: bold;">Customer Task #${booking.id}</div>
              <div style="font-size: 11px; margin-top: 2px;">Assigned: ${booking.worker?.name || 'Searching...'}</div>
              <div style="font-size: 11px; color: #059669; font-weight: bold;">Fare: ${formatMoney(booking.price)}</div>
              <div style="font-size: 10px; color: #94a3b8; margin-top: 4px;">Balasore Demand Zone</div>
            </div>
          `);
        });
      }

      mapInstanceRef.current = map;
      map.invalidateSize();
      setTimeout(() => map.invalidateSize(), 150);
      setTimeout(() => map.invalidateSize(), 400);
    }, 120);

    return () => {
      clearTimeout(timer);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [isAuthenticated, activeTab, showTechnicianLayer, showShopLayer, showBookingLayer, partnerApps, shops, bookings]);

  // Derived Business Metrics
  const pendingApps = partnerApps.filter(a => a.status === 'pending_verification');
  const approvedApps = partnerApps.filter(a => a.status === 'approved');
  const pendingRequests = requests.filter(r => r.status === 'pending');
  const pendingShops = shops.filter(s => s.status === 'pending_verification');

  // Total GMV & Platform Revenue
  const totalLaborGMV = bookings.reduce((sum, b) => sum + (b.price || 0), 0) / 100;
  const platformLaborCut = Math.round(totalLaborGMV * 0.03); // 3% Labor Commission
  const totalSpareSales = 34500; // Tracked spare volume
  const platformSpareCut = Math.round(totalSpareSales * 0.05); // 5% Spare Commission
  const totalPlatformGrossRevenue = platformLaborCut + platformSpareCut;

  // Filtered Lists per active tab
  const filteredPartnerApps = useMemo(() => {
    return partnerApps.filter(app => {
      const matchSearch =
        !searchQuery ||
        app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        app.phone.includes(searchQuery) ||
        app.tradeCategory.toLowerCase().includes(searchQuery.toLowerCase()) ||
        app.homeAddress.toLowerCase().includes(searchQuery.toLowerCase());
      const matchStatus = statusFilter === 'all' || app.status === statusFilter;
      const matchCat = categoryFilter === 'all' || app.role === categoryFilter || app.tradeCategory === categoryFilter;
      return matchSearch && matchStatus && matchCat;
    }).sort((a, b) => {
      if (sortBy === 'newest') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (sortBy === 'oldest') return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'value') return (b.hourlyRate || 0) - (a.hourlyRate || 0);
      return 0;
    });
  }, [partnerApps, searchQuery, statusFilter, categoryFilter, sortBy]);

  const filteredShops = useMemo(() => {
    return shops.filter(shop => {
      const matchSearch =
        !searchQuery ||
        shop.shopName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        shop.ownerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        shop.gstin.toLowerCase().includes(searchQuery.toLowerCase()) ||
        shop.address.toLowerCase().includes(searchQuery.toLowerCase());
      const matchStatus = statusFilter === 'all' || shop.status === statusFilter;
      return matchSearch && matchStatus;
    }).sort((a, b) => {
      if (sortBy === 'name') return a.shopName.localeCompare(b.shopName);
      if (sortBy === 'value') return b.onboardingFeeRemaining - a.onboardingFeeRemaining;
      return 0;
    });
  }, [shops, searchQuery, statusFilter, sortBy]);

  const filteredProductRequests = useMemo(() => {
    return requests.filter(req => {
      const pName = req.proposedData?.name || '';
      const pSku = req.proposedData?.partNumber || '';
      const pCat = req.proposedData?.category || '';
      const matchSearch =
        !searchQuery ||
        pName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        req.shopName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        pSku.toLowerCase().includes(searchQuery.toLowerCase());
      const matchStatus = statusFilter === 'all' || req.status === statusFilter;
      const matchCat = categoryFilter === 'all' || pCat === categoryFilter;
      return matchSearch && matchStatus && matchCat;
    }).sort((a, b) => {
      if (sortBy === 'newest') return new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime();
      if (sortBy === 'value') return (b.proposedData?.price || 0) - (a.proposedData?.price || 0);
      return 0;
    });
  }, [requests, searchQuery, statusFilter, categoryFilter, sortBy]);

  const filteredLedger = useMemo(() => {
    return ledgerEntries.filter(entry => {
      const matchSearch =
        !searchQuery ||
        entry.targetName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        entry.operator.toLowerCase().includes(searchQuery.toLowerCase()) ||
        entry.details.toLowerCase().includes(searchQuery.toLowerCase());
      const matchStatus = statusFilter === 'all' || entry.decision.toLowerCase() === statusFilter.toLowerCase();
      const matchCat = categoryFilter === 'all' || entry.entityType === categoryFilter;
      return matchSearch && matchStatus && matchCat;
    }).sort((a, b) => {
      if (sortBy === 'oldest') return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });
  }, [ledgerEntries, searchQuery, statusFilter, categoryFilter, sortBy]);

  // If not authenticated, show Secret ID Login screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 text-slate-900 font-sans antialiased">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-6 shadow-xl space-y-6">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-xl bg-red-50 border border-red-200 text-red-600 flex items-center justify-center mx-auto shadow-xs">
              <Lock className="w-6 h-6" />
            </div>
            <h1 className="text-lg font-extrabold text-slate-900 tracking-wide">REPAIDO COMPANY HQ ADMIN</h1>
            <p className="text-xs text-slate-500">
              Executive Management & Operational Governance Console. Enter authorized credentials to proceed.
            </p>
          </div>

          {authError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs p-3 rounded-lg flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 flex-shrink-0" />
              <span>{authError}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Company Executive Secret ID</label>
              <input
                type="text"
                required
                value={secretId}
                onChange={e => setSecretId(e.target.value)}
                placeholder="repaido_admin"
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-red-500 focus:bg-white focus:ring-1 focus:ring-red-500"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Secret Passphrase</label>
              <input
                type="password"
                required
                value={secretPassword}
                onChange={e => setSecretPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-red-500 focus:bg-white focus:ring-1 focus:ring-red-500"
              />
            </div>

            <button
              type="submit"
              className="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg text-xs shadow-md transition-all cursor-pointer"
            >
              Authenticate Executive Access
            </button>

            <div className="text-center pt-2">
              <button
                type="button"
                onClick={handleQuickDemoLogin}
                className="text-sm text-slate-500 hover:text-slate-800 underline cursor-pointer"
              >
                [One-Click Demo Login: repaido_admin / repaido_core_2026]
              </button>
            </div>
          </form>

          {onBackToMain && (
            <div className="pt-2 border-t border-slate-100 text-center">
              <button
                type="button"
                onClick={onBackToMain}
                className="text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors"
              >
                ← Back to Repaido Platform
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Sidebar navigation links definition
  const navItems = [
    { id: 'overview', label: 'Executive Business Overview', icon: TrendingUp },
    { id: 'agent_requests', label: 'Agent Join Requests', icon: Users, badge: pendingApps.length },
    { id: 'shop_kyc', label: 'Partner Shops & KYC', icon: Store, badge: pendingShops.length },
    { id: 'product_moderation', label: 'Catalog Moderation', icon: FileText, badge: pendingRequests.length },
    { id: 'base_fares', label: 'Base Fare & Pricing Config', icon: DollarSign },
    { id: 'demographic_map', label: 'Demographic GIS Map', icon: MapIcon },
    { id: 'audit_ledger', label: 'Central Activity Ledger', icon: ShieldCheck, badge: ledgerEntries.length },
    { id: 'dispatch_engine', label: 'Discovery Engine & SLAs', icon: Activity }
  ];

  return (
    <div
      className="company-admin-container"
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'stretch',
        minHeight: '100vh',
        width: '100%',
        backgroundColor: '#f8fafc',
        color: '#0f172a',
        overflowX: 'hidden'
      }}
    >
      {/* 1. LEFT SIDEBAR NAVIGATION (Strictly at left side, never on top) */}
      <aside
        style={{
          width: '260px',
          minWidth: '260px',
          maxWidth: '260px',
          height: '100vh',
          position: 'sticky',
          top: 0,
          backgroundColor: '#ffffff',
          borderRight: '1px solid #e2e8f0',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          zIndex: 40
        }}
      >
        {/* Brand Wordmark & CEO Session */}
        <div className="p-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-red-600 text-white flex items-center justify-center font-black text-base shadow-xs">
              R
            </div>
            <div>
              <div className="font-black text-sm tracking-wider text-slate-900">REPAIDO HQ</div>
              <div className="text-sm text-red-600 font-bold uppercase tracking-wide">CEO Executive Suite</div>
            </div>
          </div>
          <div className="mt-3 bg-red-50/80 border border-red-200 rounded-lg p-2 flex items-center justify-between text-sm">
            <span className="font-semibold text-red-900">Central Base:</span>
            <span className="font-mono font-bold text-red-700">₹{baseFares['Balasore'] || 150} (Balasore)</span>
          </div>
        </div>

        {/* Sidebar Nav Items */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id as TabType);
                  if (window.innerWidth < 768) setIsSidebarOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  isActive
                    ? 'bg-red-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-500'}`} />
                  <span>{item.label}</span>
                </div>
                {item.badge !== undefined && item.badge > 0 && (
                  <span
                    className={`text-sm font-mono font-bold px-1.5 py-0.5 rounded-full ${
                      isActive ? 'bg-white/25 text-white' : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Footer Admin Info */}
        <div className="p-3 border-t border-slate-200 space-y-2 bg-slate-50/50">
          <div className="flex items-center gap-2 text-slate-600 text-sm">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <span>CEO Active • TLS-256 Encrypted</span>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleLogout}
              className="flex-1 py-1.5 bg-white hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold border border-slate-200 transition-all cursor-pointer text-center"
            >
              Lock
            </button>
            {onBackToMain && (
              <button
                type="button"
                onClick={onBackToMain}
                className="flex-1 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-xs font-semibold border border-red-200 transition-all cursor-pointer text-center"
              >
                Exit
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* 2. MAIN CONTENT AREA (Takes remaining width and scrolls independently) */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          overflowY: 'auto',
          backgroundColor: '#f8fafc'
        }}
      >
        {/* Top Header with Notification Bell & Quick Stats */}
        <header className="bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between sticky top-0 z-20 shadow-xs">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-sm font-black text-slate-900 uppercase tracking-wide">
                {navItems.find(n => n.id === activeTab)?.label}
              </h1>
              <p className="text-sm text-slate-500">
                Repaido Management System • Multi-tier Administrative Control
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Real-time Notification Bell & Trigger */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  if (pendingApps.length > 0) {
                    setSelectedEntityModal({ type: 'agent', data: pendingApps[0] });
                  } else if (pendingShops.length > 0) {
                    setSelectedEntityModal({ type: 'shop', data: pendingShops[0] });
                  } else if (pendingRequests.length > 0) {
                    setSelectedEntityModal({ type: 'product', data: pendingRequests[0] });
                  } else {
                    alert('All agent join requests and shop KYC applications have been reviewed.');
                  }
                }}
                className="relative p-2 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 transition-all cursor-pointer"
                title="View Pending Incoming Requests"
              >
                <Bell className="w-4 h-4" />
                {(pendingApps.length > 0 || pendingShops.length > 0 || pendingRequests.length > 0) && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-600 text-white text-sm font-bold flex items-center justify-center animate-bounce">
                    {pendingApps.length + pendingShops.length + pendingRequests.length}
                  </span>
                )}
              </button>
            </div>

            <button
              type="button"
              onClick={refreshData}
              className="p-2 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 transition-all cursor-pointer"
              title="Refresh Platform Data"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Real-Time Request Notification Toast (Clickable to open inspection modal) */}
        {notificationToast && (
          <div className="bg-amber-50 border-b border-amber-200 px-5 py-2.5 flex items-center justify-between gap-4 text-xs animate-in slide-in-from-top duration-200">
            <div
              onClick={() => setSelectedEntityModal({ type: notificationToast.type, data: notificationToast.data })}
              className="flex items-center gap-2.5 cursor-pointer flex-1"
            >
              <span className="flex h-2.5 w-2.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-600"></span>
              </span>
              <div>
                <span className="font-bold text-amber-900">{notificationToast.title}</span>
                <span className="text-amber-800 ml-2 hidden sm:inline">{notificationToast.subtitle}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedEntityModal({ type: notificationToast.type, data: notificationToast.data })}
                className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-md text-sm font-bold shadow-xs cursor-pointer"
              >
                Inspect & Decide
              </button>
              <button
                type="button"
                onClick={() => setNotificationToast(null)}
                className="text-amber-700 hover:text-amber-900 p-1"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Universal Filter & Search Bar on ALL Tabs */}
        {activeTab !== 'demographic_map' && (
          <div className="bg-white border-b border-slate-200 px-5 py-2.5 flex flex-wrap items-center justify-between gap-2.5 text-xs">
            <div className="flex items-center gap-2 flex-1 min-w-[220px]">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search by name, contact, SKU, or locality..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-red-500 focus:bg-white"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 overflow-x-auto">
              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:border-red-500"
              >
                <option value="all">All Statuses</option>
                <option value="pending_verification">Pending Review</option>
                <option value="approved">Approved / Active</option>
                <option value="rejected">Rejected</option>
              </select>

              {/* Sorting */}
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as any)}
                className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:border-red-500"
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="name">Name A–Z</option>
                <option value="value">Highest Rate / Value</option>
              </select>
            </div>
          </div>
        )}

        {/* TAB CONTENTS */}
        <main className="flex-1 p-5 overflow-y-auto space-y-6">
          {/* TAB 1: EXECUTIVE BUSINESS OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Metric Cards: GMV, 3% Labor commission, 5% Spare commission */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-1">
                  <div className="text-slate-500 text-sm font-semibold flex items-center justify-between">
                    <span>Gross Labor GMV</span>
                    <Briefcase className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div className="text-2xl font-black text-slate-900 font-mono">
                    ₹{totalLaborGMV.toLocaleString()}
                  </div>
                  <div className="text-sm text-emerald-700 font-medium">Across {bookings.length} doorstep bookings</div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-1">
                  <div className="text-slate-500 text-sm font-semibold flex items-center justify-between">
                    <span>Labor Commission (3%)</span>
                    <DollarSign className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div className="text-2xl font-black text-emerald-700 font-mono">
                    ₹{platformLaborCut.toLocaleString()}
                  </div>
                  <div className="text-sm text-slate-500">3% fixed platform charge on worker hour rates</div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-1">
                  <div className="text-slate-500 text-sm font-semibold flex items-center justify-between">
                    <span>Spare Parts Commission (5%)</span>
                    <Store className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="text-2xl font-black text-blue-700 font-mono">
                    ₹{platformSpareCut.toLocaleString()}
                  </div>
                  <div className="text-sm text-slate-500">5% cut on genuine spare parts sold</div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-1">
                  <div className="text-slate-500 text-sm font-semibold flex items-center justify-between">
                    <span>Verified Agent Workforce</span>
                    <Users className="w-4 h-4 text-amber-600" />
                  </div>
                  <div className="text-2xl font-black text-slate-900 font-mono">
                    {approvedApps.length} <span className="text-xs font-normal text-slate-400">({pendingApps.length} pending)</span>
                  </div>
                  <div className="text-sm text-amber-700 font-medium">Balasore, Bhubaneswar, Cuttack</div>
                </div>
              </div>

              {/* Pending Action Quick Bar */}
              <div className="bg-gradient-to-r from-red-50 to-amber-50 p-4 rounded-xl border border-red-200 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xs">
                <div>
                  <h3 className="text-xs font-bold text-red-900 flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-red-600" />
                    <span>Executive Immediate Review Queue</span>
                  </h3>
                  <p className="text-sm text-red-700 mt-0.5">
                    {pendingApps.length} agent join requests, {pendingShops.length} shop KYC submissions, and {pendingRequests.length} product changes awaiting decision.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab('agent_requests')}
                    className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold shadow-xs transition-all cursor-pointer"
                  >
                    Review Agents ({pendingApps.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('shop_kyc')}
                    className="px-3.5 py-1.5 bg-white hover:bg-slate-100 text-slate-800 rounded-lg text-xs font-bold border border-slate-200 transition-all cursor-pointer"
                  >
                    Review Shops ({pendingShops.length})
                  </button>
                </div>
              </div>

              {/* Recent Ledger Audit Stream on Tab */}
              <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 shadow-xs">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>Executive Governance Audit Ledger (Recent Actions)</span>
                  </h3>
                  <button
                    type="button"
                    onClick={() => setActiveTab('audit_ledger')}
                    className="text-sm text-red-600 font-semibold hover:underline"
                  >
                    View Full Ledger →
                  </button>
                </div>
                <div className="divide-y divide-slate-100">
                  {ledgerEntries.slice(0, 4).map(entry => (
                    <div key={entry.id} className="py-2.5 flex items-center justify-between text-xs">
                      <div>
                        <div className="font-semibold text-slate-800 flex items-center gap-2">
                          <span className={`px-1.5 py-0.5 rounded text-sm font-mono font-bold uppercase ${
                            entry.decision === 'APPROVED' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'
                          }`}>
                            {entry.decision}
                          </span>
                          <span>{entry.targetName}</span>
                          <span className="text-sm text-slate-400">({entry.entityType})</span>
                        </div>
                        <p className="text-sm text-slate-500 mt-0.5">{entry.details}</p>
                      </div>
                      <div className="text-right text-sm text-slate-400 font-mono">
                        {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: AGENT JOIN REQUESTS (Technicians & Specialists) */}
          {activeTab === 'agent_requests' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Agent (Technician / Specialist) Join Requests</h2>
                  <p className="text-sm text-slate-500">
                    Review Aadhaar, tool verification photos, base location pin, and approve or reject join applications.
                  </p>
                </div>
                <div className="text-xs bg-white border border-slate-200 text-slate-700 px-3 py-1 rounded-full font-mono shadow-xs">
                  Showing: <strong>{filteredPartnerApps.length}</strong> applications
                </div>
              </div>

              {filteredPartnerApps.length === 0 ? (
                <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400 shadow-xs">
                  <Users className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                  <p>No agent applications match your filter criteria.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredPartnerApps.map(app => (
                    <div
                      key={app.id}
                      className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xs hover:border-slate-300 transition-all"
                    >
                      <div className="space-y-1.5 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-sm font-bold uppercase font-mono border ${
                            app.role === 'Specialist' ? 'bg-amber-50 text-amber-800 border-amber-300' : 'bg-slate-100 text-slate-700 border-slate-200'
                          }`}>
                            {app.role === 'Specialist' ? '★ Master Specialist' : 'Technician'}
                          </span>
                          <span className="font-bold text-slate-900 text-sm">{app.name}</span>
                          <span className="text-sm text-slate-400 font-mono">({app.id})</span>
                          <span className={`text-sm px-2 py-0.5 rounded-full font-bold uppercase font-mono ${
                            app.status === 'approved' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                            app.status === 'rejected' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-amber-50 text-amber-800 border border-amber-200'
                          }`}>
                            {app.status.replace('_', ' ')}
                          </span>
                        </div>

                        <div className="text-sm text-slate-600">
                          Trade: <strong className="text-slate-800">{app.tradeCategory}</strong> • Experience: <strong>{app.experienceYears} yrs</strong> • Contact: <span className="font-mono text-slate-800">{app.phone}</span>
                        </div>

                        <div className="text-sm text-slate-600 flex flex-wrap items-center gap-3 pt-0.5">
                          <span>Aadhaar: <span className="font-mono font-semibold text-slate-800">{app.aadhaarNumber}</span></span>
                          <span>Visiting Rate: <strong className="text-emerald-700 font-mono">₹{app.hourlyRate || 250}/hr</strong></span>
                          <span>Platform Cut (3%): <strong className="text-slate-800 font-mono">₹{Math.round((app.hourlyRate || 250) * 0.03)}/hr</strong></span>
                        </div>

                        <div className="text-sm text-slate-500 bg-slate-50 p-2 rounded-lg border border-slate-100 flex items-center gap-2">
                          <MapPin className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                          <span className="truncate">{app.homeAddress}</span>
                          {app.lat && app.lng && (
                            <span className="font-mono text-slate-600 text-sm flex-shrink-0">
                              ({app.lat.toFixed(4)}° N, {app.lng.toFixed(4)}° E)
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Action Controls */}
                      <div className="flex items-center gap-2 self-end md:self-center flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => setSelectedEntityModal({ type: 'agent', data: app })}
                          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1 border border-slate-200 transition-all cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Inspect Dossier</span>
                        </button>

                        {app.status === 'pending_verification' && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleApproveAgent(app.id)}
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-xs transition-all cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Accept</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedEntityModal({ type: 'agent', data: app });
                                setShowRejectPrompt(true);
                              }}
                              className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-lg text-xs font-bold flex items-center gap-1 transition-all cursor-pointer"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              <span>Reject</span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: PARTNER SHOPS & KYC */}
          {activeTab === 'shop_kyc' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Partner Spare Parts Shops & Commercial KYC</h2>
                  <p className="text-sm text-slate-500">
                    Verify GSTIN licenses, trade registration, ₹2,000 onboarding fee recovery, and 5% spare commission terms.
                  </p>
                </div>
                <span className="text-xs bg-white border border-slate-200 text-slate-700 px-3 py-1 rounded-full font-mono shadow-xs">
                  Active Shops: <strong>{shops.filter(s => s.status === 'active').length}</strong>
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredShops.map(shop => (
                  <div key={shop.id} className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 shadow-xs hover:border-slate-300 transition-all">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900">{shop.shopName}</h3>
                        <div className="text-sm text-slate-500">Proprietor: {shop.ownerName} • Phone: {shop.phone}</div>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-sm font-bold uppercase font-mono border ${
                        shop.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-800 border-amber-200'
                      }`}>
                        {shop.status}
                      </span>
                    </div>

                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-sm space-y-1 text-slate-600">
                      <div>GSTIN: <span className="font-mono text-slate-900 font-semibold">{shop.gstin}</span></div>
                      <div>Trade License: <span className="font-mono text-slate-900 font-semibold">{shop.tradeLicense}</span></div>
                      <div>Address: <span className="text-slate-800">{shop.address}</span></div>
                      <div>GPS Pin: <span className="font-mono text-red-600 font-medium">{shop.lat}° N, {shop.lng}° E</span></div>
                      <div>Settlement Bank: <span className="font-mono text-slate-800">A/C {shop.bankAccount} ({shop.ifsc})</span></div>
                    </div>

                    <div className="flex items-center justify-between text-sm pt-1">
                      <span className="text-slate-600">Platform Cut: <strong className="text-emerald-700">5%</strong></span>
                      <span className="text-amber-800 font-semibold font-mono">
                        Onboarding Fee Left: ₹{shop.onboardingFeeRemaining} / ₹2,000
                      </span>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => setSelectedEntityModal({ type: 'shop', data: shop })}
                        className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold border border-slate-200 cursor-pointer"
                      >
                        Inspect Dossier
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleShopStatus(shop.id, shop.status)}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition-all border cursor-pointer ${
                          shop.status === 'active'
                            ? 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-300'
                            : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                        }`}
                      >
                        {shop.status === 'active' ? 'Revoke Status' : 'Accept & Activate'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: PRODUCT MODERATION */}
          {activeTab === 'product_moderation' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Shop Catalog Moderation & Price Approvals</h2>
                  <p className="text-sm text-slate-500">
                    Review submissions from partner shops for new spare parts, stock levels, and price calibrations.
                  </p>
                </div>
                <span className="text-xs bg-white border border-slate-200 text-slate-700 px-3 py-1 rounded-full font-mono shadow-xs">
                  Pending: <strong>{pendingRequests.length}</strong>
                </span>
              </div>

              {filteredProductRequests.length === 0 ? (
                <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400 shadow-xs">
                  <FileText className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                  <p>No product requests match your criteria.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredProductRequests.map(req => (
                    <div
                      key={req.id}
                      className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xs"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-sm font-bold uppercase font-mono border ${
                            req.type === 'add' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-blue-50 text-blue-800 border-blue-200'
                          }`}>
                            {req.type}
                          </span>
                          <span className="font-bold text-slate-900 text-sm">{req.proposedData.name}</span>
                          <span className="text-slate-400 text-sm">({new Date(req.submittedAt).toLocaleTimeString()})</span>
                        </div>

                        <div className="text-sm text-slate-600">
                          Shop: <strong className="text-slate-800">{req.shopName}</strong> • Category: <strong className="text-slate-800 capitalize">{req.proposedData.category}</strong> • SKU: <span className="font-mono text-slate-700">{req.proposedData.partNumber}</span>
                        </div>

                        <div className="flex items-center gap-3 text-sm pt-1 text-slate-600">
                          <span>Price: <strong className="text-emerald-700 font-mono">₹{req.proposedData.price}</strong> (MRP: ₹{req.proposedData.mrp})</span>
                          <span>Stock: <strong className="text-slate-800 font-mono">{req.proposedData.stock} units</strong></span>
                          <span>Brand: <strong className="text-slate-700">{req.proposedData.brand}</strong></span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-end md:self-center">
                        {req.status === 'pending' ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleModerateRequest(req.id, 'approved')}
                              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs flex items-center gap-1 shadow-xs transition-all cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Approve & Publish</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleModerateRequest(req.id, 'rejected')}
                              className="px-3.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-lg font-bold text-xs flex items-center gap-1 transition-all cursor-pointer"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              <span>Reject</span>
                            </button>
                          </>
                        ) : (
                          <span className={`px-3 py-1 rounded-full text-xs font-bold capitalize border ${
                            req.status === 'approved' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-red-50 text-red-800 border-red-200'
                          }`}>
                            {req.status}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 5: REGIONAL BASE FARES */}
          {activeTab === 'base_fares' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Dynamic Regional Base Fare Configuration</h2>
                <p className="text-sm text-slate-500">
                  Configure platform minimum base call-out fares. Balasore default base fare is ₹150 and can be adjusted instantly.
                </p>
              </div>

              {fareSaveSuccess && (
                <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 rounded-lg flex items-center gap-2 text-xs">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <span>Base Fare for {editingCity} successfully updated to ₹{newCityFare}!</span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3 shadow-xs">
                  <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                    <Settings className="w-4 h-4 text-red-600" />
                    <span>Update Regional Fare</span>
                  </h3>

                  <div>
                    <label className="text-sm font-semibold text-slate-700 block mb-1">Target Region</label>
                    <select
                      value={editingCity}
                      onChange={e => {
                        setEditingCity(e.target.value);
                        setNewCityFare(baseFares[e.target.value] || 150);
                      }}
                      className="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-lg p-2 text-xs focus:outline-none focus:border-red-500 focus:bg-white"
                    >
                      {Object.keys(baseFares).map(city => (
                        <option key={city} value={city}>
                          {city} (Current: ₹{baseFares[city]})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-sm font-semibold text-slate-700 block mb-1">New Base Fare (₹)</label>
                    <input
                      type="number"
                      min={50}
                      max={1000}
                      value={newCityFare}
                      onChange={e => setNewCityFare(Number(e.target.value))}
                      className="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-lg p-2 text-xs font-mono font-bold focus:outline-none focus:border-red-500 focus:bg-white"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleSaveBaseFare}
                    className="w-full py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg text-xs shadow-xs flex items-center justify-center gap-1 transition-all cursor-pointer"
                  >
                    <DollarSign className="w-3.5 h-3.5" />
                    <span>Save Base Fare</span>
                  </button>
                </div>

                <div className="md:col-span-2 bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
                  <h3 className="text-xs font-bold text-slate-900 mb-3">Live Base Fares Registry</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {Object.entries(baseFares).map(([city, fare]) => (
                      <div
                        key={city}
                        className={`p-3 rounded-lg border ${
                          city === 'Balasore'
                            ? 'bg-red-50 border-red-200 text-red-900'
                            : 'bg-slate-50 border-slate-200 text-slate-800'
                        }`}
                      >
                        <div className="text-sm text-slate-500 flex items-center justify-between">
                          <span className="font-semibold">{city}</span>
                          {city === 'Balasore' && (
                            <span className="text-sm bg-red-600 text-white px-1.5 py-0.2 rounded font-bold">
                              CENTRAL HQ
                            </span>
                          )}
                        </div>
                        <div className="text-base font-extrabold text-slate-900 font-mono mt-0.5">
                          ₹{fare}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: GEOGRAPHICAL DEMOGRAPHIC GIS MAP (Requirement: CEO demographic analysis showing all entities' location on map) */}
          {activeTab === 'demographic_map' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Geographical Demographic & Density Analysis</h2>
                  <p className="text-sm text-slate-500">
                    Original live Google Maps roadmap displaying exact GPS distribution of Technicians, Partner Shops, and Customer Bookings.
                  </p>
                </div>

                {/* Layer Visibility Toggles */}
                <div className="flex items-center gap-2 text-xs">
                  <label className="flex items-center gap-1.5 bg-white border border-slate-200 px-2.5 py-1.5 rounded-lg cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showTechnicianLayer}
                      onChange={e => setShowTechnicianLayer(e.target.checked)}
                      className="accent-emerald-600"
                    />
                    <span className="text-sm font-semibold text-emerald-800">Technicians ({partnerApps.length})</span>
                  </label>

                  <label className="flex items-center gap-1.5 bg-white border border-slate-200 px-2.5 py-1.5 rounded-lg cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showShopLayer}
                      onChange={e => setShowShopLayer(e.target.checked)}
                      className="accent-blue-600"
                    />
                    <span className="text-sm font-semibold text-blue-800">Shops ({shops.length})</span>
                  </label>

                  <label className="flex items-center gap-1.5 bg-white border border-slate-200 px-2.5 py-1.5 rounded-lg cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showBookingLayer}
                      onChange={e => setShowBookingLayer(e.target.checked)}
                      className="accent-red-600"
                    />
                    <span className="text-sm font-semibold text-red-800">Tasks ({bookings.length})</span>
                  </label>
                </div>
              </div>

              {/* KPI Density Metrics */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
                <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
                  <div className="text-sm text-slate-500 uppercase font-semibold">Balasore Hub Density</div>
                  <div className="text-lg font-bold text-slate-900 font-mono mt-0.5">High (4.8 agents/km²)</div>
                </div>
                <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
                  <div className="text-sm text-slate-500 uppercase font-semibold">Avg Technician Radius</div>
                  <div className="text-lg font-bold text-emerald-700 font-mono mt-0.5">5.2 km</div>
                </div>
                <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
                  <div className="text-sm text-slate-500 uppercase font-semibold">Shop Proximity to Task</div>
                  <div className="text-lg font-bold text-blue-700 font-mono mt-0.5">1.8 km (Fast Spare)</div>
                </div>
                <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
                  <div className="text-sm text-slate-500 uppercase font-semibold">Dispatch SLA Meet Rate</div>
                  <div className="text-lg font-bold text-amber-700 font-mono mt-0.5">96.4% on 15m SLA</div>
                </div>
              </div>

              {/* Live Leaflet Map Container */}
              <div
                style={{
                  position: 'relative',
                  width: '100%',
                  height: '480px',
                  minHeight: '480px',
                  borderRadius: '16px',
                  overflow: 'hidden',
                  border: '1px solid #e2e8f0',
                  backgroundColor: '#e2e8f0'
                }}
              >
                <div
                  ref={mapContainerRef}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    width: '100%',
                    height: '480px',
                    zIndex: 1
                  }}
                />

                {/* Map Legend Overlay */}
                <div className="absolute top-3 right-3 z-[1000] bg-white/95 backdrop-blur-xs border border-slate-200 rounded-xl p-3 shadow-md text-sm space-y-1.5">
                  <div className="font-bold text-slate-900 text-xs mb-1">Map Entities</div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded bg-emerald-600"></span>
                    <span>Approved Technicians</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded bg-amber-600"></span>
                    <span>Pending Verification Agents</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded bg-blue-600"></span>
                    <span>Partner Spare Shops</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded bg-red-600"></span>
                    <span>Live Customer Bookings</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 7: CENTRAL ACTIVITY AUDIT LEDGER */}
          {activeTab === 'audit_ledger' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Platform Governance & Activity Audit Ledger</h2>
                  <p className="text-sm text-slate-500">
                    Immutable chronological record of administrative actions, agent decisions, KYC approvals, and fare revisions.
                  </p>
                </div>
                <span className="text-xs bg-white border border-slate-200 text-slate-700 px-3 py-1 rounded-full font-mono shadow-xs">
                  Recorded Actions: <strong>{filteredLedger.length}</strong>
                </span>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-700 divide-y divide-slate-200">
                    <thead className="bg-slate-50 text-sm uppercase font-bold text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Timestamp</th>
                        <th className="px-4 py-3">Operator</th>
                        <th className="px-4 py-3">Action Type</th>
                        <th className="px-4 py-3">Target Entity</th>
                        <th className="px-4 py-3">Decision</th>
                        <th className="px-4 py-3">Details & Audit Log</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredLedger.map(entry => (
                        <tr key={entry.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="px-4 py-3 font-mono text-sm text-slate-500 whitespace-nowrap">
                            {new Date(entry.timestamp).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 font-semibold text-slate-900 whitespace-nowrap">
                            {entry.operator}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="px-2 py-0.5 rounded text-sm font-mono bg-slate-100 text-slate-700 font-semibold">
                              {entry.actionCategory}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-medium text-slate-800">
                            {entry.targetName}
                            <span className="text-sm text-slate-400 block font-mono">({entry.entityType})</span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className={`px-2 py-0.5 rounded text-sm font-bold font-mono uppercase ${
                              entry.decision === 'APPROVED' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' :
                              entry.decision === 'REJECTED' ? 'bg-red-50 text-red-800 border border-red-200' :
                              'bg-blue-50 text-blue-800 border border-blue-200'
                            }`}>
                              {entry.decision}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600 max-w-md">
                            {entry.details}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 8: DISCOVERY ENGINE & DISPATCH SLAs */}
          {activeTab === 'dispatch_engine' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Discovery Engine & Dispatch SLA Governance</h2>
                <p className="text-sm text-slate-500">
                  15-minute countdown deadline tracking, agent discovery ranking, and automatic reassignment triggers.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                  <div className="text-slate-500 text-sm font-medium">Acknowledgment Deadline</div>
                  <div className="text-2xl font-bold text-amber-700 font-mono mt-1">15m 00s</div>
                  <div className="text-sm text-slate-500 mt-1">Countdown triggers audio ringtone on Agent Android App</div>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                  <div className="text-slate-500 text-sm font-medium">Reassignment Trigger</div>
                  <div className="text-2xl font-bold text-red-700 font-mono mt-1">Auto-Shift</div>
                  <div className="text-sm text-slate-500 mt-1">Dispatches next best scored specialist when timer expires</div>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                  <div className="text-slate-500 text-sm font-medium">Specialist Upgrade Gate</div>
                  <div className="text-2xl font-bold text-blue-700 font-mono mt-1">1,500 pts / 20 jobs</div>
                  <div className="text-sm text-emerald-700 font-medium mt-1">Dual threshold for automatic promotion</div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 shadow-xs">
                <h3 className="text-xs font-bold text-slate-900">Live Active Dispatches</h3>
                <div className="space-y-2">
                  {bookings.map(b => (
                    <div key={b.id} className="bg-slate-50 p-3 rounded-lg border border-slate-200 flex items-center justify-between text-sm">
                      <div>
                        <div className="font-bold text-slate-900">{b.serviceName} (#{b.id})</div>
                        <div className="text-slate-600">
                          {b.city} • Assigned: <strong className="text-slate-800">{b.worker?.name || 'Unassigned'}</strong> ({b.worker?.role})
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-emerald-700 font-mono">{formatMoney(b.price)}</div>
                        <div className="text-sm text-amber-800 uppercase font-bold">{b.status}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* 3. REQUEST INSPECTION MODAL (Requirement: CEO can click request notification to open request modal with full details of shop or agent) */}
      {selectedEntityModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs font-sans antialiased text-slate-900"
        >
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-red-100 text-red-600 flex items-center justify-center">
                  {selectedEntityModal.type === 'agent' ? <Users className="w-4 h-4" /> : <Store className="w-4 h-4" />}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {selectedEntityModal.type === 'agent' ? 'Agent Application Dossier' : 'Partner Shop KYC Dossier'}
                  </h3>
                  <p className="text-sm text-slate-500">
                    Confidential CEO Inspection • Action will be logged to immutable ledger
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedEntityModal(null);
                  setShowRejectPrompt(false);
                }}
                className="w-8 h-8 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              {/* AGENT DOSSIER DETAILS */}
              {selectedEntityModal.type === 'agent' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <div>
                      <div className="text-base font-bold text-slate-900">{selectedEntityModal.data.name}</div>
                      <div className="text-sm text-slate-500 flex items-center gap-2 mt-0.5">
                        <span className="font-semibold text-slate-700">{selectedEntityModal.data.role}</span>
                        <span>•</span>
                        <span>{selectedEntityModal.data.gender}, Born: {selectedEntityModal.data.dob}</span>
                      </div>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold font-mono uppercase ${
                      selectedEntityModal.data.status === 'approved' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                      selectedEntityModal.data.status === 'rejected' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-amber-50 text-amber-800 border border-amber-200'
                    }`}>
                      {selectedEntityModal.data.status.replace('_', ' ')}
                    </span>
                  </div>

                  {/* Commercial & Rate Card */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                      <div className="text-sm text-slate-500 font-semibold">Hourly Visiting Rate</div>
                      <div className="text-base font-black text-emerald-700 font-mono mt-0.5">
                        ₹{selectedEntityModal.data.hourlyRate || 250}/hr
                      </div>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                      <div className="text-sm text-slate-500 font-semibold">Platform Fee (3%)</div>
                      <div className="text-base font-black text-slate-900 font-mono mt-0.5">
                        ₹{Math.round((selectedEntityModal.data.hourlyRate || 250) * 0.03)}/hr
                      </div>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                      <div className="text-sm text-slate-500 font-semibold">Net Agent Payout</div>
                      <div className="text-base font-black text-blue-700 font-mono mt-0.5">
                        ₹{Math.round((selectedEntityModal.data.hourlyRate || 250) * 0.97)}/hr
                      </div>
                    </div>
                  </div>

                  {/* Identification & Tools */}
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
                    <div className="font-bold text-slate-900">Identity & Verification Records</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                      <div>Aadhaar Card: <span className="font-mono font-bold text-slate-900">{selectedEntityModal.data.aadhaarNumber}</span></div>
                      <div>PAN Card: <span className="font-mono font-bold text-slate-900">{selectedEntityModal.data.panNumber || 'N/A'}</span></div>
                      <div>Contact Phone: <span className="font-mono font-bold text-slate-900">{selectedEntityModal.data.phone}</span></div>
                      <div>Email Address: <span className="text-slate-900">{selectedEntityModal.data.email || 'N/A'}</span></div>
                    </div>
                  </div>

                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1.5">
                    <div className="font-bold text-slate-900">Trade Skills & Tool Kit Photos</div>
                    <div className="text-sm text-slate-700">
                      Category: <strong className="text-slate-900">{selectedEntityModal.data.tradeCategory}</strong> ({selectedEntityModal.data.experienceYears} years active experience)
                    </div>
                    <div className="text-sm text-slate-600">
                      Declared Tools: {selectedEntityModal.data.toolsList || 'Standard diagnostic kit & safety gear'}
                    </div>
                    <div className="text-sm text-emerald-700 font-semibold mt-1">
                      ✓ {selectedEntityModal.data.toolPhotosCount || 3} Tool Kit Photos Uploaded & Auto-Scanned
                    </div>
                  </div>

                  {/* Bank Details */}
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1.5">
                    <div className="font-bold text-slate-900">Direct Payout Bank Account</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-sm">
                      <div>Bank: <span className="font-semibold text-slate-900">{selectedEntityModal.data.bankName}</span></div>
                      <div>A/C Holder: <span className="font-semibold text-slate-900">{selectedEntityModal.data.accountHolderName}</span></div>
                      <div>A/C Number: <span className="font-mono font-bold text-slate-900">{selectedEntityModal.data.accountNumber}</span></div>
                      <div>IFSC: <span className="font-mono font-bold text-slate-900">{selectedEntityModal.data.ifscCode}</span></div>
                      {selectedEntityModal.data.upiId && (
                        <div className="col-span-2">UPI ID: <span className="font-mono text-slate-900">{selectedEntityModal.data.upiId}</span></div>
                      )}
                    </div>
                  </div>

                  {/* Base Address & Coordinates */}
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1">
                    <div className="font-bold text-slate-900 flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-red-500" />
                      <span>Service Base & Map Pin</span>
                    </div>
                    <div className="text-sm text-slate-700">{selectedEntityModal.data.homeAddress}</div>
                    {selectedEntityModal.data.lat && selectedEntityModal.data.lng && (
                      <div className="text-sm text-slate-500 font-mono">
                        GPS Coordinates: {selectedEntityModal.data.lat.toFixed(5)}° N, {selectedEntityModal.data.lng.toFixed(5)}° E (Radius: {selectedEntityModal.data.serviceRadiusKm} km)
                      </div>
                    )}
                  </div>

                  {/* Rejection Prompt if Triggered */}
                  {showRejectPrompt && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-xl space-y-2">
                      <div className="font-bold text-red-900 text-xs">Specify Reason for Rejection:</div>
                      <input
                        type="text"
                        placeholder="e.g. Incomplete tool kit photo / Address proof mismatch..."
                        value={rejectionReasonInput}
                        onChange={e => setRejectionReasonInput(e.target.value)}
                        className="w-full bg-white border border-red-300 rounded-lg p-2 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-red-500"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* SHOP DOSSIER DETAILS */}
              {selectedEntityModal.type === 'shop' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <div>
                      <div className="text-base font-bold text-slate-900">{selectedEntityModal.data.shopName}</div>
                      <div className="text-sm text-slate-500">Proprietor: {selectedEntityModal.data.ownerName} • {selectedEntityModal.data.phone}</div>
                    </div>
                    <span className="px-2.5 py-1 rounded-full text-xs font-bold font-mono uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">
                      {selectedEntityModal.data.status}
                    </span>
                  </div>

                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
                    <div className="font-bold text-slate-900">Commercial Registration Dossier</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                      <div>GSTIN: <span className="font-mono font-bold text-slate-900">{selectedEntityModal.data.gstin}</span></div>
                      <div>Trade License: <span className="font-mono font-bold text-slate-900">{selectedEntityModal.data.tradeLicense}</span></div>
                      <div>Address: <span className="text-slate-800">{selectedEntityModal.data.address}</span></div>
                      <div>Location: <span className="font-mono text-red-600">{selectedEntityModal.data.lat}° N, {selectedEntityModal.data.lng}° E</span></div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                      <div className="text-sm text-emerald-800 font-semibold">Platform Commission</div>
                      <div className="text-lg font-black text-emerald-900 mt-0.5">5%</div>
                      <div className="text-sm text-emerald-700">Deducted on gross spare sales</div>
                    </div>
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
                      <div className="text-sm text-amber-800 font-semibold">Onboarding Recovery</div>
                      <div className="text-lg font-black text-amber-900 font-mono mt-0.5">
                        ₹{selectedEntityModal.data.onboardingFeeRemaining}
                      </div>
                      <div className="text-sm text-amber-700">Recovered per sale (out of ₹2,000)</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Actions */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setSelectedEntityModal(null);
                  setShowRejectPrompt(false);
                }}
                className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 font-semibold rounded-lg text-xs border border-slate-200"
              >
                Close Dossier
              </button>

              <div className="flex items-center gap-2">
                {selectedEntityModal.type === 'agent' && selectedEntityModal.data.status === 'pending_verification' && (
                  <>
                    {!showRejectPrompt ? (
                      <button
                        type="button"
                        onClick={() => setShowRejectPrompt(true)}
                        className="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-700 font-bold rounded-lg text-xs border border-red-200 cursor-pointer"
                      >
                        Reject Application
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleRejectAgent(selectedEntityModal.data.id)}
                        className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg text-xs cursor-pointer shadow-xs"
                      >
                        Confirm Rejection
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleApproveAgent(selectedEntityModal.data.id)}
                      className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs flex items-center gap-1.5 shadow-xs cursor-pointer"
                    >
                      <Check className="w-4 h-4" />
                      <span>Accept & Grant Live Status</span>
                    </button>
                  </>
                )}

                {selectedEntityModal.type === 'shop' && (
                  <button
                    type="button"
                    onClick={() => handleToggleShopStatus(selectedEntityModal.data.id, selectedEntityModal.data.status)}
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs flex items-center gap-1.5 shadow-xs cursor-pointer"
                  >
                    <Check className="w-4 h-4" />
                    <span>{selectedEntityModal.data.status === 'active' ? 'Revoke Status' : 'Verify & Activate Shop'}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
