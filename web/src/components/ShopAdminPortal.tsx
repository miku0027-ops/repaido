import React, { useState, useEffect } from 'react';
import {
  Store,
  MapPin,
  FileText,
  DollarSign,
  Package,
  Plus,
  Edit2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Compass,
  Building2,
  ShieldCheck,
  Send,
  Eye,
  Download,
  Search,
  Trash2,
  TrendingUp,
  Boxes,
  Check,
  Upload,
  Image as ImageIcon,
  Settings,
  Printer,
  Sparkles,
  Bell,
  Menu,
  X,
  PanelLeftClose,
  PanelLeft,
  ChevronRight,
  AlertTriangle,
  Radio,
  Megaphone,
  Lock,
  Unlock,
  ExternalLink,
  Layers
} from 'lucide-react';
import type { SpareShop, SparePartProduct, TaskSpareItem, ProductChangeRequest, SparePartCategory, ShopNotification, CompanyShopDirective } from '../types';
import {
  getSpareShops,
  getAllSpareProducts,
  registerSpareShop,
  submitProductChangeRequest,
  updateProductStock,
  updateProductDetails,
  addInventoryProduct,
  deleteProductFromInventory,
  getShopLedger,
  updateSpareShop,
  getSavedBookings,
  getShopNotifications,
  markShopNotificationAsRead,
  markAllShopNotificationsAsRead,
  getCompanyDirectivesForShop,
  sendCompanyDirectiveToShop,
  acknowledgeCompanyDirective,
  updateShopOperationalStatus,
  type ShopLedgerEntry
} from '../services/repaidoService';
import { formatMoney } from '../data';
import { LocationPickerModal } from './LocationPickerModal';
import { ShopB2BSection } from './ShopB2BSection';
import RepaidoBrand from './RepaidoBrand';
import { ShopAgentLiveMap } from './ShopAgentLiveMap';
import { ShopOrderAccordion } from './ShopOrderAccordion';
import './shop-admin.css';

interface ShopAdminPortalProps {
  onBackToMain?: () => void;
  shopId?: string;
}

export const ShopAdminPortal: React.FC<ShopAdminPortalProps> = ({ onBackToMain, shopId: propShopId }) => {
  const [shops, setShops] = useState<SpareShop[]>([]);
  const [currentShopId, setCurrentShopId] = useState<string>(() => {
    if (propShopId) return propShopId;
    try {
      const qShop = new URLSearchParams(window.location.search).get('shopId');
      if (qShop) return qShop;
      const stored = localStorage.getItem('repaido_active_shop_id');
      if (stored) return stored;
    } catch (_) {}
    return '';
  });
  const [allProducts, setAllProducts] = useState<SparePartProduct[]>([]);
  const [activeTab, setActiveTab] = useState<'orders' | 'inventory' | 'b2b' | 'ledger' | 'kyc_register' | 'settings' | 'company_oversight'>(() => {
    try {
      const qTab = new URLSearchParams(window.location.search).get('shopTab');
      if (qTab && ['orders', 'inventory', 'b2b', 'ledger', 'kyc_register', 'settings', 'company_oversight'].includes(qTab)) {
        return qTab as any;
      }
    } catch (_) {}
    return 'inventory';
  });

  // Collapsible Side Navigation Bar
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDesktopSidebarCollapsed, setIsDesktopSidebarCollapsed] = useState(false);

  // Notification Bell and Alert Center
  const [isNotifDrawerOpen, setIsNotifDrawerOpen] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('notifOpen') === '1';
    } catch (_) { return false; }
  });
  const [notifications, setNotifications] = useState<ShopNotification[]>([]);
  const [notifFilter, setNotifFilter] = useState<'all' | 'urgent' | 'company'>('all');

  // Company HQ Directives & Controls
  const [activeDirectives, setActiveDirectives] = useState<CompanyShopDirective[]>([]);
  const [isCompanyAdminMode, setIsCompanyAdminMode] = useState(false);
  const [directiveCategory, setDirectiveCategory] = useState<CompanyShopDirective['category']>('compliance');
  const [directivePriority, setDirectivePriority] = useState<CompanyShopDirective['priority']>('urgent');
  const [directiveTitle, setDirectiveTitle] = useState('');
  const [directiveInstructions, setDirectiveInstructions] = useState('');
  const [directiveDeadlineHours, setDirectiveDeadlineHours] = useState('24');
  const [directiveTargetShop, setDirectiveTargetShop] = useState<'THIS_SHOP' | 'ALL'>('THIS_SHOP');
  const [isSuspendingShop, setIsSuspendingShop] = useState(false);
  const [suspendReason, setSuspendReason] = useState('Routine GST compliance verification pending');
  const [hqActionFeedback, setHqActionFeedback] = useState('');
  const [shopProfileImage, setShopProfileImage] = useState('');
  const [shopProfileName, setShopProfileName] = useState('');
  const [shopProfileOwner, setShopProfileOwner] = useState('');
  const [shopProfilePhone, setShopProfilePhone] = useState('');
  const [shopProfileEmail, setShopProfileEmail] = useState('');
  const [shopProfileGstin, setShopProfileGstin] = useState('');
  const [shopProfileTradeLicense, setShopProfileTradeLicense] = useState('');

  // New Shop Registration State (with Map Pin Picker)
  const [newShopName, setNewShopName] = useState('');
  const [newOwnerName, setNewOwnerName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newGstin, setNewGstin] = useState('');
  const [newTradeLicense, setNewTradeLicense] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newCity, setNewCity] = useState('Balasore');
  const [newBankAccount, setNewBankAccount] = useState('');
  const [newIfsc, setNewIfsc] = useState('');
  const [shopLat, setShopLat] = useState(21.4934);
  const [shopLng, setShopLng] = useState(86.9135);
  const [isMapPickerOpen, setIsMapPickerOpen] = useState(false);
  const [regSuccessMessage, setRegSuccessMessage] = useState('');

  // Inventory Add/Edit Modal
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [prodName, setProdName] = useState('');
  const [prodPartNumber, setProdPartNumber] = useState('');
  const [prodHsnCode, setProdHsnCode] = useState('8415');
  const [prodCondition, setProdCondition] = useState<'new' | 'refurbished' | 'preowned'>('new');
  const [prodRefurbishedGrade, setProdRefurbishedGrade] = useState<'A+' | 'A' | 'B'>('A+');
  const [prodMoneyBackDays, setProdMoneyBackDays] = useState<number>(7);
  const [prodCertifiedDiagnostic, setProdCertifiedDiagnostic] = useState<boolean>(true);
  const [prodSecondHandNotes, setProdSecondHandNotes] = useState<string>('');
  const [prodCategory, setProdCategory] = useState<SparePartCategory>('ac');
  const [prodPrice, setProdPrice] = useState(500);
  const [prodMrp, setProdMrp] = useState(700);
  const [prodStock, setProdStock] = useState(10);
  const [prodBrand, setProdBrand] = useState('');
  const [prodCompatibility, setProdCompatibility] = useState('');
  const [prodDescription, setProdDescription] = useState('');
  const [prodCostPrice, setProdCostPrice] = useState<number>(350);
  const [prodBinLocation, setProdBinLocation] = useState<string>('Rack A-1');
  const [prodImage, setProdImage] = useState<string>('');
  const [prodRequestSent, setProdRequestSent] = useState(false);

  // Inventory Filtering & Business State
  const [invSearch, setInvSearch] = useState('');
  const [invCategoryFilter, setInvCategoryFilter] = useState('all');
  const [invConditionFilter, setInvConditionFilter] = useState<'all' | 'new' | 'refurbished' | 'preowned'>('all');
  const [invStockFilter, setInvStockFilter] = useState<'all' | 'in_stock' | 'low_stock' | 'out_of_stock'>('all');
  const [invActionMessage, setInvActionMessage] = useState<string>('');

  // Accepted and fulfilled orders tracking
  const [acceptedOrders, setAcceptedOrders] = useState<Record<string, boolean>>({});
  const [fulfilledOrders, setFulfilledOrders] = useState<Record<string, boolean>>({});
  const [orderStatusFilter, setOrderStatusFilter] = useState<'all' | 'pending' | 'in_route' | 'fulfilled'>('all');
  const [orderSearch, setOrderSearch] = useState('');
  const [invoiceModalOrder, setInvoiceModalOrder] = useState<{
    bookingId: string;
    spare: TaskSpareItem;
    customerAddress: string;
    workerName: string;
    hsnCode?: string;
  } | null>(null);
  const [showHsnAuditModal, setShowHsnAuditModal] = useState(false);
  const [showQuickRestockModal, setShowQuickRestockModal] = useState(false);
  const [quickRestockProductId, setQuickRestockProductId] = useState<string>('');
  const [quickRestockQuantity, setQuickRestockQuantity] = useState<number>(10);
  const [quickRestockNote, setQuickRestockNote] = useState<string>('');
  const [showStockSheetModal, setShowStockSheetModal] = useState(false);

  // Glowing tabs for real-time activity alerts
  const [glowingTabs, setGlowingTabs] = useState<Record<string, boolean>>({
    orders: true, // Initially glowing because there are active technician procurement orders
    b2b: false,
    inventory: false,
    company_oversight: false
  });
  const [liveActivityToast, setLiveActivityToast] = useState<{ title: string; message: string; tab: string } | null>(null);

  // Live Orders & Agent Tracker View State
  const [ordersViewMode, setOrdersViewMode] = useState<'list' | 'map' | 'split'>('list');
  const [expandedOrders, setExpandedOrders] = useState<Record<string, boolean>>({
    'BK-9482': true
  });
  const [focusedTechnicianId, setFocusedTechnicianId] = useState<string | null>(null);

  const handleTabClick = (tabId: string) => {
    setActiveTab(tabId as any);
    setIsSidebarOpen(false);
    // Dismiss glowing indicator for this tab when clicked
    setGlowingTabs(prev => ({ ...prev, [tabId]: false }));
  };

  const triggerLiveActivity = () => {
    const randomBooking = `BK-${Math.floor(1000 + Math.random() * 9000)}`;
    setGlowingTabs(prev => ({ ...prev, orders: true }));
    setLiveActivityToast({
      title: 'Technician In-Task Spare Order',
      message: `Technician assigned to #${randomBooking} requested immediate stock check. Approaching shop in ~5 mins.`,
      tab: 'orders'
    });
    setTimeout(() => {
      setLiveActivityToast(null);
    }, 6000);
  };

  const refreshData = () => {
    const shps = getSpareShops();
    setShops(shps);
    let activeId = propShopId || currentShopId;
    if (!activeId && shps.length > 0) {
      activeId = shps[0].id;
      setCurrentShopId(activeId);
      try { localStorage.setItem('repaido_active_shop_id', activeId); } catch (_) {}
    } else if (propShopId && currentShopId !== propShopId) {
      setCurrentShopId(propShopId);
    }
    setAllProducts(getAllSpareProducts());
    if (activeId) {
      setNotifications(getShopNotifications(activeId));
      setActiveDirectives(getCompanyDirectivesForShop(activeId));
    }
  };

  useEffect(() => {
    refreshData();
    const interval = setInterval(refreshData, 3000);
    return () => clearInterval(interval);
  }, [currentShopId]);

  const currentShop = shops.find(s => s.id === currentShopId) || shops[0];
  const shopProducts = allProducts.filter(p => p.shopId === currentShop?.id);
  const shopLedger = currentShop ? getShopLedger(currentShop.id) : [];

  useEffect(() => {
    if (!currentShop) return;
    setShopProfileImage(currentShop.profileImage || '');
    setShopProfileName(currentShop.shopName);
    setShopProfileOwner(currentShop.ownerName);
    setShopProfilePhone(currentShop.phone);
    setShopProfileEmail(currentShop.email);
    setShopProfileGstin(currentShop.gstin || '');
    setShopProfileTradeLicense(currentShop.tradeLicense || '');
  }, [currentShopId, currentShop]);

  const handleShopProfileImage = (file?: File) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => setShopProfileImage(String(reader.result));
    reader.readAsDataURL(file);
  };

  const handleSaveShopProfile = () => {
    if (!currentShop) return;
    updateSpareShop(currentShop.id, {
      profileImage: shopProfileImage,
      shopName: shopProfileName.trim() || currentShop.shopName,
      ownerName: shopProfileOwner.trim() || currentShop.ownerName,
      phone: shopProfilePhone.trim() || currentShop.phone,
      email: shopProfileEmail.trim() || currentShop.email,
      gstin: shopProfileGstin.trim() || currentShop.gstin,
      tradeLicense: shopProfileTradeLicense.trim() || currentShop.tradeLicense
    });
    refreshData();
    setRegSuccessMessage('Shop profile, GSTIN and verification details updated.');
    setTimeout(() => setRegSuccessMessage(''), 4500);
  };

  // Business Inventory Calculations
  const totalStockUnits = shopProducts.reduce((sum, p) => sum + (p.stock || 0), 0);
  const totalStockValuation = shopProducts.reduce((sum, p) => sum + (p.stock * p.price), 0);
  const lowStockCount = shopProducts.filter(p => p.stock > 0 && p.stock <= 5).length;
  const outOfStockCount = shopProducts.filter(p => p.stock === 0).length;
  const newItemsCount = shopProducts.filter(p => !p.condition || p.condition === 'new').length;
  const refurbItemsCount = shopProducts.filter(p => p.condition === 'refurbished').length;
  const preownedItemsCount = shopProducts.filter(p => p.condition === 'preowned').length;

  const filteredInventory = shopProducts.filter(p => {
    const matchQuery =
      !invSearch ||
      p.name.toLowerCase().includes(invSearch.toLowerCase()) ||
      p.partNumber.toLowerCase().includes(invSearch.toLowerCase()) ||
      p.brand.toLowerCase().includes(invSearch.toLowerCase()) ||
      (p.hsnCode && p.hsnCode.toLowerCase().includes(invSearch.toLowerCase()));
    const matchCat = invCategoryFilter === 'all' || p.category === invCategoryFilter;
    const matchStock =
      invStockFilter === 'all'
        ? true
        : invStockFilter === 'in_stock'
        ? p.stock > 5
        : invStockFilter === 'low_stock'
        ? p.stock > 0 && p.stock <= 5
        : p.stock === 0;
    const matchCondition =
      invConditionFilter === 'all'
        ? true
        : invConditionFilter === 'new'
        ? (!p.condition || p.condition === 'new')
        : p.condition === invConditionFilter;
    return matchQuery && matchCat && matchStock && matchCondition;
  });

  const handleQuickStockAdjust = async (productId: string, delta: number) => {
    const target = shopProducts.find(p => p.id === productId);
    if (!target) return;
    const newStock = Math.max(0, target.stock + delta);
    await updateProductStock(productId, newStock);
    refreshData();
    setInvActionMessage(`Stock for "${target.name}" updated to ${newStock} units (Synced to Cloud Firestore)`);
    setTimeout(() => setInvActionMessage(''), 2500);
  };

  const handleExecuteQuickRestock = async () => {
    if (!quickRestockProductId) return;
    const target = shopProducts.find(p => p.id === quickRestockProductId);
    if (!target) return;
    const unitsToAdd = Number(quickRestockQuantity) || 0;
    if (unitsToAdd <= 0) return;

    const newStock = (target.stock || 0) + unitsToAdd;
    await updateProductStock(quickRestockProductId, newStock);
    refreshData();
    setShowQuickRestockModal(false);
    setQuickRestockQuantity(10);
    setQuickRestockNote('');
    setInvActionMessage(`Restocked +${unitsToAdd} units for "${target.name}". Total available: ${newStock} units.`);
    setTimeout(() => setInvActionMessage(''), 3000);
  };

  const handleDeleteProduct = async (productId: string) => {
    if (window.confirm('Are you sure you want to remove this SKU from active shop inventory?')) {
      await deleteProductFromInventory(productId);
      refreshData();
      setInvActionMessage('Product removed from active catalog and synced to Cloud.');
      setTimeout(() => setInvActionMessage(''), 2500);
    }
  };

  const handleExportInventoryCsv = () => {
    const headers = [
      'ID',
      'Name',
      'SKU',
      'HSN Code',
      'Category',
      'Condition',
      'Refurbished Grade',
      'Brand',
      'Unit Cost (₹)',
      'Selling Price (₹)',
      'MRP (₹)',
      'Gross Margin %',
      'Current Stock',
      'Total Stock Value (₹)',
      'Applicable GST %',
      'Bin Location',
      'Catalog Status'
    ];
    const rows = shopProducts.map(p => {
      const cost = p.costPrice || Math.round(p.price * 0.7);
      const margin = p.price > 0 ? Math.round(((p.price - cost) / p.price) * 100) : 0;
      return [
        p.id,
        `"${p.name.replace(/"/g, '""')}"`,
        `"${p.partNumber || ''}"`,
        `"${p.hsnCode || '8415'}"`,
        p.category,
        p.condition || 'new',
        p.refurbishedGrade || 'N/A',
        `"${p.brand || 'OEM'}"`,
        cost,
        p.price,
        p.mrp,
        `${margin}%`,
        p.stock,
        p.stock * p.price,
        '18%',
        `"${p.binLocation || 'Rack A-1'}"`,
        p.status
      ];
    });
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `repaido_inventory_hsn_${(currentShop?.shopName || 'shop').toLowerCase().replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setInvActionMessage('Full inventory with HSN codes & valuations exported to CSV.');
    setTimeout(() => setInvActionMessage(''), 3000);
  };

  const handleImageFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please select a valid JPG or PNG image file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = event => {
      const result = event.target?.result as string;
      if (!result) return;

      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 480;
        const MAX_HEIGHT = 480;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
          setProdImage(compressedDataUrl);
        } else {
          setProdImage(result);
        }
      };
      img.src = result;
    };
    reader.readAsDataURL(file);
  };

  // Active bookings with spare parts from this shop
  const allBookings = getSavedBookings();
  const shopActiveOrders: { bookingId: string; spare: TaskSpareItem; customerAddress: string; workerName: string; hsnCode?: string }[] = [];

  allBookings.forEach(b => {
    if (b.taskSpares) {
      b.taskSpares.forEach(sp => {
        if (sp.shopId === currentShop?.id) {
          const matchingProduct = shopProducts.find(p => p.id === sp.productId || p.partNumber === sp.partNumber);
          shopActiveOrders.push({
            bookingId: b.id,
            spare: sp,
            customerAddress: b.address,
            workerName: b.worker?.name || 'Assigned Technician',
            hsnCode: matchingProduct?.hsnCode || '8415'
          });
        }
      });
    }
  });

  const activeShopId = currentShop ? currentShop.id : (shops[0]?.id || '');
  const activeShopName = currentShop?.shopName || (shops[0]?.shopName || 'Partner Hub');
  const activeShopPhone = currentShop?.phone || (shops[0]?.phone || '9437012345');
  const activeShopLat = currentShop?.lat || (shops[0]?.lat || 21.4934);
  const activeShopLng = currentShop?.lng || (shops[0]?.lng || 86.9135);

  const demoOrders: { bookingId: string; spare: TaskSpareItem; customerAddress: string; workerName: string; hsnCode?: string }[] = [
    {
      bookingId: 'BK-9482',
      spare: {
        id: `sp-${activeShopId || 'order'}-1`,
        productId: shopProducts[0]?.id || (allProducts.find(p => p.shopId === activeShopId)?.id || ''),
        partNumber: shopProducts[0]?.partNumber || 'CAP-50-5',
        name: shopProducts[0]?.name || 'Dual Run Capacitor 50+5 MFD 440V',
        price: shopProducts[0]?.price || 480,
        travelCharge: 120,
        travelDistanceKm: 6,
        totalBilledToCustomer: (shopProducts[0]?.price || 480) + 120,
        status: 'added_to_task',
        shopId: activeShopId,
        shopName: activeShopName,
        shopPhone: activeShopPhone,
        shopLat: activeShopLat,
        shopLng: activeShopLng,
        addedAt: new Date().toISOString()
      },
      customerAddress: 'Plot 42, OT Road, Station Square, Balasore',
      workerName: 'Rajesh Mohanty (Senior AC Technician)',
      hsnCode: shopProducts[0]?.hsnCode || '8532'
    },
    {
      bookingId: 'BK-8820',
      spare: {
        id: `sp-${activeShopId || 'order'}-2`,
        productId: shopProducts[1]?.id || shopProducts[0]?.id || (allProducts.find(p => p.shopId === activeShopId)?.id || ''),
        partNumber: shopProducts[1]?.partNumber || 'CMP-R32-15',
        name: shopProducts[1]?.name || 'Rotary Compressor 1.5 Ton R32 Eco',
        price: shopProducts[1]?.price || 6400,
        travelCharge: 180,
        travelDistanceKm: 9,
        totalBilledToCustomer: (shopProducts[1]?.price || 6400) + 180,
        status: 'shop_accepted',
        shopId: activeShopId,
        shopName: activeShopName,
        shopPhone: activeShopPhone,
        shopLat: activeShopLat,
        shopLng: activeShopLng,
        addedAt: new Date().toISOString()
      },
      customerAddress: 'House 14B, FM College Road, Balasore',
      workerName: 'Bikash Jena (HVAC Expert)',
      hsnCode: shopProducts[1]?.hsnCode || '8414'
    }
  ];

  const allShopOrders = shopActiveOrders.length > 0 ? shopActiveOrders : demoOrders;

  const populateEditModal = (p: SparePartProduct) => {
    setEditingProductId(p.id);
    setProdName(p.name);
    setProdPartNumber(p.partNumber);
    setProdHsnCode(p.hsnCode || '8415');
    setProdCondition(p.condition || 'new');
    setProdRefurbishedGrade(p.refurbishedGrade || 'A+');
    setProdMoneyBackDays(p.moneyBackDays || 7);
    setProdCertifiedDiagnostic(p.certifiedDiagnostic ?? true);
    setProdSecondHandNotes(p.secondHandNotes || '');
    setProdCategory(p.category);
    setProdPrice(p.price);
    setProdMrp(p.mrp);
    setProdCostPrice(p.costPrice || Math.round(p.price * 0.7));
    setProdStock(p.stock);
    setProdBrand(p.brand);
    setProdBinLocation(p.binLocation || 'Rack A-1');
    setProdImage(p.image || '');
    setProdCompatibility(p.compatibility);
    setProdDescription(p.description);
    setShowProductModal(true);
  };

  const handleOpenNotificationTask = (notif: ShopNotification) => {
    markShopNotificationAsRead(notif.id);
    setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, read: true } : n));
    setIsNotifDrawerOpen(false);

    if (notif.actionTarget?.tab) {
      setActiveTab(notif.actionTarget.tab as any);
    }

    if (notif.actionTarget?.tab === 'orders') {
      if (notif.actionTarget.orderId) {
        setOrderSearch(notif.actionTarget.orderId);
        const matched = allShopOrders.find(o => o.spare.id === notif.actionTarget.orderId || o.bookingId === notif.actionTarget.orderId);
        if (matched) {
          setInvoiceModalOrder({
            bookingId: matched.bookingId,
            spare: matched.spare,
            customerAddress: matched.customerAddress,
            workerName: matched.workerName,
            hsnCode: matched.hsnCode || matched.spare.hsnCode || '8415'
          });
        }
      }
    } else if (notif.actionTarget?.tab === 'inventory') {
      if (notif.actionTarget.sku || notif.actionTarget.productId) {
        setInvSearch(notif.actionTarget.sku || notif.actionTarget.productId || '');
        if (notif.actionTarget.actionType === 'open_stock_modal' && notif.actionTarget.productId) {
          const prod = allProducts.find(p => p.id === notif.actionTarget.productId);
          if (prod) {
            populateEditModal(prod);
          }
        }
      }
    }
  };

  const handleMarkAllRead = () => {
    if (currentShopId) {
      markAllShopNotificationsAsRead(currentShopId);
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    }
  };

  const handleDispatchCompanyDirective = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directiveTitle.trim() || !directiveInstructions.trim()) return;

    const targetShopId = directiveTargetShop === 'ALL' ? 'ALL' : currentShopId;
    await sendCompanyDirectiveToShop({
      shopId: targetShopId,
      title: directiveTitle.trim(),
      category: directiveCategory,
      priority: directivePriority,
      instructions: directiveInstructions.trim(),
      deadline: new Date(Date.now() + Number(directiveDeadlineHours || 24) * 3600000).toISOString(),
      issuedBy: 'Repaido Operations HQ / Company Admin'
    });

    setDirectiveTitle('');
    setDirectiveInstructions('');
    setHqActionFeedback(`HQ Directive dispatched successfully to ${directiveTargetShop === 'ALL' ? 'ALL Partner Shops' : currentShop?.shopName}. Instant notification delivered.`);
    refreshData();
    setTimeout(() => setHqActionFeedback(''), 4000);
  };

  const handleAcknowledgeDirective = (directiveId: string) => {
    acknowledgeCompanyDirective(directiveId);
    setActiveDirectives(prev => prev.map(d => d.id === directiveId ? { ...d, acknowledged: true } : d));
    setNotifications(prev => prev.map(n => n.id === `notif-dir-${directiveId}` ? { ...n, read: true } : n));
    setHqActionFeedback('Directive acknowledged by shop. Acknowledgment logged for company compliance audit.');
    setTimeout(() => setHqActionFeedback(''), 3000);
  };

  const handleToggleShopFreeze = async (freeze: boolean) => {
    if (!currentShop) return;
    const newStatus: SpareShop['status'] = freeze ? 'suspended_by_hq' : 'active';
    await updateShopOperationalStatus(
      currentShop.id,
      newStatus,
      freeze,
      freeze ? suspendReason : undefined,
      'Repaido Company Admin / HQ Oversight'
    );
    refreshData();
    setIsSuspendingShop(false);
    setHqActionFeedback(`Shop operations ${freeze ? 'FROZEN & SUSPENDED' : 'RESTORED & ACTIVE'}. Sync complete across marketplace.`);
    setTimeout(() => setHqActionFeedback(''), 4000);
  };

  const handleRegisterShop = async (e: React.FormEvent) => {
    e.preventDefault();
    const registered = await registerSpareShop({
      ownerName: newOwnerName,
      shopName: newShopName,
      phone: newPhone,
      email: newEmail,
      gstin: newGstin,
      tradeLicense: newTradeLicense,
      address: newAddress,
      city: newCity,
      lat: shopLat,
      lng: shopLng,
      bankAccount: newBankAccount,
      ifsc: newIfsc
    });

    setRegSuccessMessage(`Shop "${registered.shopName}" registered successfully! Free registration active with ₹2,000 onboarding fee recovered gradually per sale.`);
    refreshData();
    setCurrentShopId(registered.id);
    setActiveTab('orders');
  };

  const handleAcceptAvailability = (spareId: string) => {
    setAcceptedOrders(prev => ({ ...prev, [spareId]: true }));
    setInvActionMessage('Order availability confirmed. Agent navigation coordinates active.');
    setTimeout(() => setInvActionMessage(''), 3000);
  };

  const handleFulfillOrder = async (order: { bookingId: string; spare: TaskSpareItem; customerAddress: string; workerName: string; hsnCode?: string }) => {
    setFulfilledOrders(prev => ({ ...prev, [order.spare.id]: true }));
    const prod = shopProducts.find(p => p.id === order.spare.productId || p.partNumber === order.spare.partNumber || p.name === order.spare.name);
    if (prod && prod.stock > 0) {
      await updateProductStock(prod.id, Math.max(0, prod.stock - 1));
      setInvActionMessage(`Order #${order.bookingId} handed over! Stock for "${prod.name}" decremented from ${prod.stock} to ${Math.max(0, prod.stock - 1)} and synced.`);
    } else {
      setInvActionMessage(`Order #${order.bookingId} handed over & marked fulfilled.`);
    }
    setTimeout(() => setInvActionMessage(''), 3500);
    refreshData();
  };

  const handleSaveDirectProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentShop) return;

    const cond = prodCondition;
    const prodData = {
      name: prodName,
      partNumber: prodPartNumber,
      hsnCode: prodHsnCode.trim() || undefined,
      category: prodCategory,
      price: Number(prodPrice),
      mrp: Number(prodMrp),
      costPrice: Number(prodCostPrice || 0),
      stock: Number(prodStock),
      brand: prodBrand,
      binLocation: prodBinLocation,
      compatibility: prodCompatibility,
      description: prodDescription,
      condition: cond,
      refurbishedGrade: cond === 'refurbished' ? prodRefurbishedGrade : undefined,
      moneyBackDays: cond === 'refurbished' ? prodMoneyBackDays : undefined,
      certifiedDiagnostic: cond === 'refurbished' ? prodCertifiedDiagnostic : false,
      secondHandNotes: cond === 'preowned' ? (prodSecondHandNotes.trim() || 'Verified shop stock') : undefined,
      ownershipVerified: cond === 'preowned' ? true : undefined,
      image: prodImage || 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=400&auto=format&fit=crop&q=80',
      gstRate: 0.18,
      warrantyMonths: cond === 'new' ? 12 : cond === 'refurbished' ? 6 : 1,
      status: 'approved' as const
    };

    if (editingProductId) {
      await updateProductDetails(editingProductId, prodData);
      setInvActionMessage(`Product "${prodName}" (${cond.toUpperCase()} · HSN: ${prodHsnCode}) updated & synced across entire marketplace.`);
    } else {
      await addInventoryProduct({
        shopId: currentShop.id,
        shopName: currentShop.shopName,
        ...prodData
      });
      setInvActionMessage(`New SKU "${prodName}" (${cond.toUpperCase()} · HSN: ${prodHsnCode}) added & live on marketplace.`);
    }

    refreshData();
    setShowProductModal(false);
    setTimeout(() => setInvActionMessage(''), 3000);
  };

  const handleSubmitProductRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentShop) return;

    await submitProductChangeRequest({
      shopId: currentShop.id,
      shopName: currentShop.shopName,
      type: editingProductId ? 'edit' : 'add',
      productId: editingProductId || undefined,
      proposedData: {
        name: prodName,
        partNumber: prodPartNumber,
        category: prodCategory,
        price: Number(prodPrice),
        mrp: Number(prodMrp),
        costPrice: Number(prodCostPrice || 0),
        stock: Number(prodStock),
        brand: prodBrand,
        binLocation: prodBinLocation,
        compatibility: prodCompatibility,
        description: prodDescription,
        image: prodImage || 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=400&auto=format&fit=crop&q=80',
        gstRate: 0.18,
        warrantyMonths: 6,
        status: 'pending_review'
      }
    });

    setProdRequestSent(true);
    setTimeout(() => {
      setProdRequestSent(false);
      setShowProductModal(false);
      refreshData();
    }, 1500);
  };

  const totalEarnings = shopLedger.reduce((sum, l) => sum + l.netPayout, 0);
  const totalCommissionPaid = shopLedger.reduce((sum, l) => sum + l.commission, 0);
  const totalOnboardingDeducted = shopLedger.reduce((sum, l) => sum + l.onboardingDeduction, 0);

  const navTabs = [
    { id: 'orders', label: 'Live Orders & Agent Tracker', icon: Package, badge: shopActiveOrders.length, badgeColor: 'bg-amber-600 text-white' },
    { id: 'inventory', label: 'Inventory Management', icon: Store, badge: shopProducts.length, badgeColor: 'bg-slate-200 text-slate-700' },
    { id: 'b2b', label: 'B2B Wholesale & RFQ Quotes', icon: Boxes },
    { id: 'ledger', label: 'Wednesday Settlements & Ledger', icon: DollarSign },
    { id: 'kyc_register', label: 'Partner Registration / KYC', icon: FileText },
    { id: 'company_oversight', label: 'Company HQ Directives', icon: ShieldCheck, badge: activeDirectives.filter(d => !d.acknowledged).length || undefined, badgeColor: 'bg-red-500 text-white' },
    { id: 'settings', label: 'Shop Settings', icon: Settings }
  ];

  const filteredNotifs = notifications.filter(n => {
    if (notifFilter === 'urgent') return n.priority === 'urgent';
    if (notifFilter === 'company') return n.type === 'company_directive';
    return true;
  });

  return (
    <div className="shop-admin-container min-h-screen bg-slate-100 text-slate-900 text-xs font-sans antialiased flex flex-col md:flex-row relative">
      {/* 1. Mobile Backdrop for Collapsible Sidebar */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-40 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
          aria-label="Close navigation overlay"
        />
      )}

      {/* 2. Collapsible Side Navigation Bar */}
      <aside className={`
        fixed md:sticky top-0 left-0 h-screen z-50 bg-[#0c1f42] text-white flex flex-col justify-between transition-all duration-300 ease-in-out border-r border-[#1a366b] shadow-2xl md:shadow-none shrink-0
        ${isSidebarOpen ? 'translate-x-0 w-72' : '-translate-x-full md:translate-x-0'}
        ${isDesktopSidebarCollapsed ? 'md:w-16' : 'md:w-64'}
      `}>
        {/* Sidebar Header: Brand & Dedicated Close / Collapse Button */}
        <div>
          <div className="p-4 border-b border-[#1a366b] flex items-center justify-between">
            <div className={`flex items-center gap-2.5 overflow-hidden ${isDesktopSidebarCollapsed ? 'md:hidden' : ''}`}>
              <RepaidoBrand size="sm" />
              <div className="truncate">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-xs text-white">Partner Admin</span>
                  <span className="text-[9px] bg-amber-500/20 text-amber-400 font-mono px-1.5 py-0.2 rounded border border-amber-500/30">DEPOT</span>
                </div>
                <div className="text-[10px] text-slate-400 truncate">{currentShop?.shopName || 'Partner Hub'}</div>
              </div>
            </div>

            {/* Dedicated Close Buttons */}
            <div className="flex items-center gap-1">
              {/* Mobile Close Button (X) */}
              <button
                type="button"
                onClick={() => setIsSidebarOpen(false)}
                className="md:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                title="Close side navigation"
                aria-label="Close navigation bar"
              >
                <X className="w-5 h-5" />
              </button>

              {/* Desktop Collapse / Expand Button */}
              <button
                type="button"
                onClick={() => setIsDesktopSidebarCollapsed(!isDesktopSidebarCollapsed)}
                className="hidden md:flex p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                title={isDesktopSidebarCollapsed ? "Expand side navigation" : "Collapse side navigation"}
                aria-label="Collapse side navigation"
              >
                {isDesktopSidebarCollapsed ? <PanelLeft className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Shop Quick Status Badge (when expanded) */}
          {!isDesktopSidebarCollapsed && (
            <div className="p-3 mx-3 my-2.5 bg-[#142d5f] border border-[#20448a] rounded-xl space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">Status</span>
                <span className={`text-[10px] font-extrabold px-1.5 py-0.2 rounded ${
                  currentShop?.isOperationsFrozen || currentShop?.status === 'suspended_by_hq'
                    ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                    : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                }`}>
                  {currentShop?.isOperationsFrozen || currentShop?.status === 'suspended_by_hq' ? '● SUSPENDED' : '● ONLINE'}
                </span>
              </div>
              <div className="text-[11px] text-slate-300 font-semibold truncate">{currentShop?.city || 'Balasore'} Hub</div>
            </div>
          )}

          {/* Navigation Links */}
          <nav className="p-2 space-y-1" aria-label="Shop partner workspaces">
            {navTabs.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              const isGlowing = !!glowingTabs[tab.id];
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleTabClick(tab.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-bold transition-all text-left group relative ${
                    isGlowing ? 'tab-glowing-amber' : ''
                  } ${
                    isActive
                      ? 'bg-[#003BB5] text-white shadow-md shadow-blue-950/30'
                      : 'text-slate-300 hover:bg-white/10 hover:text-white'
                  }`}
                  title={tab.label}
                >
                  <Icon className={`w-4 h-4 shrink-0 transition-transform group-hover:scale-110 ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-amber-400'}`} />
                  <span className={`truncate text-xs ${isDesktopSidebarCollapsed ? 'md:hidden' : 'block'}`}>
                    {tab.label}
                  </span>
                  {isGlowing && <span className="tab-glow-indicator" title="New Activity Available" />}
                  {tab.badge !== undefined && tab.badge > 0 && (
                    <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-mono font-bold shrink-0 ${
                      isActive ? 'bg-blue-900 text-white' : tab.badgeColor || 'bg-slate-700 text-slate-200'
                    } ${isDesktopSidebarCollapsed ? 'md:hidden' : ''}`}>
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer: Mode Toggle & Close Button */}
        <div className="p-3 border-t border-[#1a366b] space-y-2">
          {!isDesktopSidebarCollapsed && (
            <button
              type="button"
              onClick={() => {
                setIsCompanyAdminMode(!isCompanyAdminMode);
                setActiveTab('company_oversight');
              }}
              className={`w-full p-2 rounded-lg text-[11px] font-bold flex items-center justify-between transition-all ${
                activeTab === 'company_oversight' || isCompanyAdminMode
                  ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40'
                  : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
                <span>Company HQ Control</span>
              </div>
              <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-black/40">
                ACTIVE
              </span>
            </button>
          )}

          {/* Dedicated Text Button to Collapse Sidebar */}
          <button
            type="button"
            onClick={() => {
              if (window.innerWidth < 768) {
                setIsSidebarOpen(false);
              } else {
                setIsDesktopSidebarCollapsed(!isDesktopSidebarCollapsed);
              }
            }}
            className="w-full py-2 px-3 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 text-xs font-semibold flex items-center justify-center gap-2 transition-all"
            title="Collapse side navigation bar"
          >
            <PanelLeftClose className="w-4 h-4 shrink-0" />
            <span className={isDesktopSidebarCollapsed ? 'md:hidden' : ''}>Collapse side nav</span>
          </button>
        </div>
      </aside>

      {/* 3. Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header Bar */}
        <header className="bg-white border-b border-slate-200 px-4 py-3 sticky top-0 z-30 flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-3">
            {/* Mobile Drawer Trigger (Hidden on Desktop because Side Nav is already present) */}
            <button
              type="button"
              onClick={() => setIsSidebarOpen(true)}
              className="md:hidden p-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 text-slate-700 transition-colors shrink-0"
              aria-label="Open navigation drawer"
            >
              <Menu className="w-4 h-4 shrink-0" />
            </button>

            {/* Active View Title & Shop Breadcrumb */}
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-slate-900 text-sm">
                  {navTabs.find(t => t.id === activeTab)?.label || 'Shop Admin'}
                </span>
                <span className={`px-2 py-0.2 rounded text-[10px] font-extrabold border ${
                  currentShop?.isOperationsFrozen || currentShop?.status === 'suspended_by_hq'
                    ? 'bg-red-50 text-red-700 border-red-300'
                    : 'bg-emerald-50 text-emerald-800 border-emerald-300'
                }`}>
                  {currentShop?.isOperationsFrozen || currentShop?.status === 'suspended_by_hq' ? 'HQ FROZEN' : 'KYC VERIFIED'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-medium hidden sm:block">
                {currentShop?.shopName} • GSTIN: {currentShop?.gstin || 'Registered Partner'}
              </p>
            </div>
          </div>

          {/* Right Header Actions: Notification Bell, Shop Switcher, Exit */}
          <div className="flex items-center gap-2">
            {/* Real-Time Operational Notification Bell Icon */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsNotifDrawerOpen(!isNotifDrawerOpen)}
                className={`relative p-2 rounded-xl border transition-all ${
                  isNotifDrawerOpen
                    ? 'bg-amber-50 border-amber-300 text-amber-800'
                    : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700'
                }`}
                title="Operational Alerts & Company Directives"
                aria-label="View notifications and alerts"
              >
                <Bell className="w-4 h-4" />
                {notifications.filter(n => !n.read).length > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-mono font-bold text-white shadow-xs">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                    <span className="relative">{notifications.filter(n => !n.read).length}</span>
                  </span>
                )}
              </button>

              {/* Notification Center Dropdown / Floating Panel */}
              {isNotifDrawerOpen && (
                <div className="absolute right-0 top-11 w-80 sm:w-96 bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 overflow-hidden text-xs">
                  {/* Dropdown Header */}
                  <div className="p-3.5 bg-gradient-to-r from-[#0f244a] to-[#1a386d] text-white flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Bell className="w-4 h-4 text-amber-400" />
                      <div>
                        <div className="font-extrabold text-xs">Operational Alerts & Directives</div>
                        <div className="text-[10px] text-slate-300">
                          {notifications.filter(n => !n.read).length} action items require attention
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleMarkAllRead}
                        className="text-[10px] text-amber-300 hover:text-white font-bold px-2 py-1 rounded bg-white/10 hover:bg-white/20 transition-all"
                      >
                        Mark all read
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsNotifDrawerOpen(false)}
                        className="p-1 text-slate-300 hover:text-white rounded hover:bg-white/10 transition-all"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Filter Pills */}
                  <div className="p-2 border-b border-slate-100 flex items-center gap-1.5 bg-slate-50 overflow-x-auto">
                    {[
                      { id: 'all', label: `All (${notifications.length})` },
                      { id: 'urgent', label: `Urgent (${notifications.filter(n => n.priority === 'urgent').length})` },
                      { id: 'company', label: `HQ Directives (${notifications.filter(n => n.type === 'company_directive').length})` }
                    ].map(f => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setNotifFilter(f.id as any)}
                        className={`px-2.5 py-1 rounded-full text-[10px] font-bold whitespace-nowrap transition-all ${
                          notifFilter === f.id
                            ? 'bg-[#0f244a] text-white'
                            : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  {/* Notification List */}
                  <div className="max-h-[380px] overflow-y-auto divide-y divide-slate-100">
                    {filteredNotifs.length === 0 ? (
                      <div className="p-6 text-center text-slate-500 space-y-1">
                        <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto opacity-70" />
                        <div className="font-bold text-slate-700">All caught up!</div>
                        <div className="text-[10px] text-slate-400">No operational delays or pending actions.</div>
                      </div>
                    ) : (
                      filteredNotifs.map(notif => {
                        const isUrgent = notif.priority === 'urgent';
                        const isCompany = notif.type === 'company_directive';
                        const isStock = notif.type === 'low_stock';
                        return (
                          <div
                            key={notif.id}
                            onClick={() => handleOpenNotificationTask(notif)}
                            className={`p-3 transition-colors cursor-pointer hover:bg-slate-50 relative group ${
                              !notif.read ? 'bg-amber-50/40 font-semibold' : 'opacity-85'
                            }`}
                          >
                            {/* Color Strip Indicator */}
                            <div className={`absolute left-0 top-0 bottom-0 w-1 ${
                              isUrgent ? 'bg-red-500' : isCompany ? 'bg-blue-500' : isStock ? 'bg-amber-500' : 'bg-emerald-500'
                            }`} />

                            <div className="pl-1.5 space-y-1">
                              <div className="flex items-center justify-between">
                                <span className={`text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded font-mono ${
                                  isUrgent
                                    ? 'bg-red-100 text-red-800'
                                    : isCompany
                                    ? 'bg-blue-100 text-blue-800'
                                    : isStock
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-slate-100 text-slate-700'
                                }`}>
                                  {isUrgent ? 'URGENT TASK' : isCompany ? 'HQ DIRECTIVE' : isStock ? 'STOCK ALERT' : 'UPDATE'}
                                </span>
                                <span className="text-[9px] text-slate-400 font-mono">
                                  {notif.timestamp ? new Date(notif.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                                </span>
                              </div>

                              <div className="text-xs font-bold text-slate-900 group-hover:text-amber-700 transition-colors">
                                {notif.title}
                              </div>

                              <div className="text-[11px] text-slate-600 line-clamp-2">
                                {notif.message}
                              </div>

                              <div className="pt-1 flex items-center justify-between">
                                <span className="text-[9px] text-slate-400">
                                  From: {notif.sender || 'Repaido System'}
                                </span>
                                <span className="text-[10px] font-bold text-amber-700 flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                                  Open Task <ChevronRight className="w-3 h-3" />
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>


            {/* Dedicated Logged-In Shop Scope (Single Shop Locked to This Screen - Isolated Data) */}
            <div 
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-slate-800 text-xs shadow-2xs"
              title={`Active Shop: ${currentShop?.shopName || 'Shop Portal'} (${currentShop?.id || ''})`}
            >
              <Store className="w-3.5 h-3.5 text-[#003BB5] shrink-0" />
              <div className="flex items-center gap-1.5 truncate max-w-[140px] sm:max-w-[200px]">
                <span className="font-bold text-slate-900 truncate">
                  {currentShop?.shopName || 'Partner Hub'}
                </span>
                {currentShop?.id && (
                  <span className="text-[10px] font-mono font-semibold text-slate-600 bg-white px-1.5 py-0.5 rounded border border-slate-200 shrink-0">
                    {currentShop.id}
                  </span>
                )}
              </div>
            </div>

            {onBackToMain && (
              <button
                type="button"
                onClick={onBackToMain}
                className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium px-2.5 py-1.5 rounded border border-slate-300 transition-all shrink-0"
              >
                Exit View
              </button>
            )}
          </div>
        </header>

        {/* Real-Time Live Activity Notification Banner */}
        {liveActivityToast && (
          <div className="mx-4 mt-3 bg-gradient-to-r from-slate-950 via-slate-900 to-[#0c1f42] text-white p-3 rounded-2xl border border-amber-400/50 shadow-xl flex items-center justify-between gap-3 animate-fade-in z-20">
            <div className="flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping shrink-0" />
              <div>
                <div className="font-extrabold text-xs text-amber-400 flex items-center gap-2">
                  <span>{liveActivityToast.title}</span>
                  <span className="text-[10px] bg-amber-400/20 text-amber-300 px-1.5 py-0.2 rounded font-mono">LIVE RADAR</span>
                </div>
                <div className="text-[11px] text-slate-300">{liveActivityToast.message}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  handleTabClick(liveActivityToast.tab);
                  setLiveActivityToast(null);
                }}
                className="px-3 py-1 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-lg text-xs transition-colors shadow-xs"
              >
                View Now
              </button>
              <button
                type="button"
                onClick={() => setLiveActivityToast(null)}
                className="p-1 text-slate-400 hover:text-white rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}


        {/* Main Container */}
        <main className="p-3 sm:p-4 max-w-5xl mx-auto space-y-4 w-full">
        {/* TAB 1: LIVE ORDERS & FLASHING ALERTS */}
        {activeTab === 'orders' && (() => {
          const pendingCount = allShopOrders.filter(o => !acceptedOrders[o.spare.id] && o.spare.status === 'added_to_task' && !fulfilledOrders[o.spare.id]).length;
          const inRouteCount = allShopOrders.filter(o => (acceptedOrders[o.spare.id] || o.spare.status === 'shop_accepted' || o.spare.status === 'agent_picked_up') && !fulfilledOrders[o.spare.id]).length;
          const fulfilledCount = allShopOrders.filter(o => fulfilledOrders[o.spare.id] || o.spare.status === 'installed').length;

          const filteredOrders = allShopOrders.filter(o => {
            const isFulfilled = fulfilledOrders[o.spare.id] || o.spare.status === 'installed';
            const isAccepted = (acceptedOrders[o.spare.id] || o.spare.status === 'shop_accepted' || o.spare.status === 'agent_picked_up') && !isFulfilled;
            const isPending = !isAccepted && !isFulfilled;

            if (orderStatusFilter === 'pending' && !isPending) return false;
            if (orderStatusFilter === 'in_route' && !isAccepted) return false;
            if (orderStatusFilter === 'fulfilled' && !isFulfilled) return false;

            if (orderSearch.trim()) {
              const q = orderSearch.toLowerCase();
              return (
                o.bookingId.toLowerCase().includes(q) ||
                o.spare.name.toLowerCase().includes(q) ||
                o.workerName.toLowerCase().includes(q) ||
                o.customerAddress.toLowerCase().includes(q) ||
                (o.hsnCode && o.hsnCode.includes(q))
              );
            }
            return true;
          });

          return (
            <div className="space-y-4">
              {/* Fleet & Orders Live Notifier Lights (Zero Long Text & Zero Clutter) */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 bg-white px-3.5 py-2 rounded-xl border border-slate-200 shadow-2xs">
                {/* Left: Depot Online Status Light */}
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                  </span>
                  <span className="text-xs font-bold text-slate-900 tracking-tight">Live Fleet Tracker</span>
                  <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                    DEPOT ONLINE
                  </span>
                </div>

                {/* Right: Annunciator Notifier Lights */}
                <div className="flex items-center gap-2">
                  {/* Amber Notifier Light: Awaiting Action */}
                  <div
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all ${
                      pendingCount > 0
                        ? 'bg-amber-50 text-amber-900 border-amber-300 shadow-2xs'
                        : 'bg-slate-50 text-slate-500 border-slate-200'
                    }`}
                    title={pendingCount > 0 ? `${pendingCount} orders awaiting action` : '0 orders awaiting action'}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        pendingCount > 0 ? 'bg-amber-500 animate-ping' : 'bg-slate-300'
                      }`}
                    />
                    <span>{pendingCount} Awaiting Action</span>
                  </div>

                  {/* Blue Notifier Light: Approaching Depot */}
                  <div
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all ${
                      inRouteCount > 0
                        ? 'bg-blue-50 text-[#003BB5] border-blue-200 shadow-2xs'
                        : 'bg-slate-50 text-slate-500 border-slate-200'
                    }`}
                    title={inRouteCount > 0 ? `${inRouteCount} specialists approaching depot` : '0 specialists approaching'}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        inRouteCount > 0 ? 'bg-[#003BB5] animate-pulse' : 'bg-slate-300'
                      }`}
                    />
                    <span>{inRouteCount} Approaching Depot</span>
                  </div>
                </div>
              </div>

              {/* View Mode Switcher & Global Accordion Actions */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 bg-white p-2.5 rounded-2xl border border-slate-200 shadow-xs">
                {/* View Mode Toggles */}
                <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
                  <button
                    type="button"
                    onClick={() => setOrdersViewMode('list')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                      ordersViewMode === 'list'
                        ? 'bg-[#003BB5] text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Package className="w-3.5 h-3.5" />
                    <span>Orders List ({allShopOrders.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrdersViewMode('map')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                      ordersViewMode === 'map'
                        ? 'bg-[#003BB5] text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Compass className="w-3.5 h-3.5 animate-spin-slow" />
                    <span>Live Specialist Map & Radar</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrdersViewMode('split')}
                    className={`hidden lg:flex px-3 py-1.5 rounded-lg text-xs font-bold transition-all items-center gap-1.5 ${
                      ordersViewMode === 'split'
                        ? 'bg-[#003BB5] text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>Split View</span>
                  </button>
                </div>

                {/* Right Global Actions */}
                <div className="flex items-center gap-2">
                  {ordersViewMode !== 'map' && (
                    <button
                      type="button"
                      onClick={() => {
                        const allExpanded = filteredOrders.every(o => !!expandedOrders[o.bookingId]);
                        if (allExpanded) {
                          setExpandedOrders({});
                        } else {
                          const next: Record<string, boolean> = {};
                          filteredOrders.forEach(o => { next[o.bookingId] = true; });
                          setExpandedOrders(next);
                        }
                      }}
                      className="px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold shadow-2xs transition-colors"
                    >
                      {filteredOrders.every(o => !!expandedOrders[o.bookingId]) ? 'Collapse All' : 'Expand All'}
                    </button>
                  )}


                </div>
              </div>

              {/* Filters & Search Row */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 bg-white p-2.5 rounded-2xl border border-slate-200 shadow-xs">
                <div className="flex items-center gap-1.5 overflow-x-auto">
                  {[
                    { key: 'all', label: `All Orders (${allShopOrders.length})` },
                    { key: 'pending', label: `Awaiting Stock (${pendingCount})` },
                    { key: 'in_route', label: `Agent In-Route (${inRouteCount})` },
                    { key: 'fulfilled', label: `Handed Over (${fulfilledCount})` }
                  ].map(tab => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setOrderStatusFilter(tab.key as any)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                        orderStatusFilter === tab.key
                          ? 'bg-[#003BB5] text-white shadow-xs'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={orderSearch}
                    onChange={e => setOrderSearch(e.target.value)}
                    placeholder="Search Booking, Tech, Part, or HSN..."
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-8 pr-7 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-[#003BB5] focus:ring-2 focus:ring-blue-100"
                  />
                  {orderSearch && (
                    <button
                      type="button"
                      onClick={() => setOrderSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 font-bold text-xs"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {/* MAIN CONTENT DISPLAY ACCORDING TO VIEW MODE */}
              {ordersViewMode === 'map' && (
                <ShopAgentLiveMap
                  shop={currentShop}
                  orders={allShopOrders}
                  acceptedOrders={acceptedOrders}
                  fulfilledOrders={fulfilledOrders}
                  focusedTechnicianId={focusedTechnicianId}
                  onSelectOrder={(bookingId) => {
                    setOrderSearch(bookingId);
                    setOrdersViewMode('list');
                    setExpandedOrders(prev => ({ ...prev, [bookingId]: true }));
                  }}
                  onFulfillOrder={(bookingId) => {
                    const matched = allShopOrders.find(o => o.bookingId === bookingId);
                    if (matched) handleFulfillOrder(matched);
                  }}
                />
              )}

              {ordersViewMode === 'list' && (
                <div>
                  {filteredOrders.length === 0 ? (
                    <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-500 space-y-2 shadow-xs">
                      <Package className="w-10 h-10 text-slate-400 mx-auto" />
                      <p className="font-semibold text-slate-700">No orders match the selected filter</p>
                      <p className="text-xs text-slate-500">
                        Switch to "All Orders" or clear your search term.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setOrderStatusFilter('all');
                          setOrderSearch('');
                        }}
                        className="mt-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl"
                      >
                        Reset Filters
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {filteredOrders.map(order => {
                        const isFulfilled = fulfilledOrders[order.spare.id] || order.spare.status === 'installed';
                        const isAccepted = (acceptedOrders[order.spare.id] || order.spare.status === 'shop_accepted' || order.spare.status === 'agent_picked_up') && !isFulfilled;

                        return (
                          <ShopOrderAccordion
                            key={order.spare.id}
                            order={order}
                            isAccepted={isAccepted}
                            isFulfilled={isFulfilled}
                            isExpanded={!!expandedOrders[order.bookingId]}
                            onToggle={() =>
                              setExpandedOrders(prev => ({
                                ...prev,
                                [order.bookingId]: !prev[order.bookingId]
                              }))
                            }
                            onAccept={handleAcceptAvailability}
                            onFulfill={handleFulfillOrder}
                            onPrintInvoice={(ord) =>
                              setInvoiceModalOrder({ ...ord, hsnCode: ord.hsnCode || '8415' })
                            }
                            onFocusMap={(bookingId) => {
                              setFocusedTechnicianId(bookingId);
                              setOrdersViewMode('map');
                            }}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {ordersViewMode === 'split' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                  {/* Left Column: Interactive Map */}
                  <div className="lg:col-span-7">
                    <ShopAgentLiveMap
                      shop={currentShop}
                      orders={allShopOrders}
                      acceptedOrders={acceptedOrders}
                      fulfilledOrders={fulfilledOrders}
                      focusedTechnicianId={focusedTechnicianId}
                      onSelectOrder={(bookingId) => {
                        setOrderSearch(bookingId);
                        setExpandedOrders(prev => ({ ...prev, [bookingId]: true }));
                      }}
                      onFulfillOrder={(bookingId) => {
                        const matched = allShopOrders.find(o => o.bookingId === bookingId);
                        if (matched) handleFulfillOrder(matched);
                      }}
                    />
                  </div>

                  {/* Right Column: Sleek Accordions List */}
                  <div className="lg:col-span-5 space-y-3 max-h-[580px] overflow-y-auto pr-1">
                    <div className="text-xs font-bold text-slate-700 flex items-center justify-between pb-1">
                      <span>Orders List ({filteredOrders.length})</span>
                      <span className="text-[10px] text-slate-400">Click card to expand</span>
                    </div>

                    {filteredOrders.map(order => {
                      const isFulfilled = fulfilledOrders[order.spare.id] || order.spare.status === 'installed';
                      const isAccepted = (acceptedOrders[order.spare.id] || order.spare.status === 'shop_accepted' || order.spare.status === 'agent_picked_up') && !isFulfilled;

                      return (
                        <ShopOrderAccordion
                          key={order.spare.id}
                          order={order}
                          isAccepted={isAccepted}
                          isFulfilled={isFulfilled}
                          isExpanded={!!expandedOrders[order.bookingId]}
                          onToggle={() =>
                            setExpandedOrders(prev => ({
                              ...prev,
                              [order.bookingId]: !prev[order.bookingId]
                            }))
                          }
                          onAccept={handleAcceptAvailability}
                          onFulfill={handleFulfillOrder}
                          onPrintInvoice={(ord) =>
                            setInvoiceModalOrder({ ...ord, hsnCode: ord.hsnCode || '8415' })
                          }
                          onFocusMap={(bookingId) => {
                            setFocusedTechnicianId(bookingId);
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* TAB 2: INVENTORY MANAGEMENT */}
        {activeTab === 'inventory' && (
          <div className="space-y-3">
            {/* Real-Time Cloud Sync Feedback Banner */}
            {invActionMessage && (
              <div className="bg-emerald-50 border border-emerald-300 text-emerald-800 px-3 py-2 rounded-xl flex items-center justify-between shadow-2xs animate-fade-in text-xs font-semibold">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{invActionMessage}</span>
                </div>
                <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded font-mono font-bold uppercase tracking-wider">
                  Cloud Synced
                </span>
              </div>
            )}

            {/* Streamlined Inventory KPI Metric Bar */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-semibold text-slate-500">Active SKUs</div>
                  <div className="text-lg font-extrabold text-slate-900 font-mono leading-tight mt-0.5">
                    {shopProducts.length}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1 font-medium">
                    <span className="text-slate-700 font-semibold">{newItemsCount} New</span>
                    <span>•</span>
                    <span className="text-emerald-700 font-semibold">{refurbItemsCount} Refurb</span>
                    <span>•</span>
                    <span className="text-amber-700 font-semibold">{preownedItemsCount} Used</span>
                  </div>
                </div>
                <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500 shrink-0">
                  <Package className="w-4 h-4" />
                </div>
              </div>

              <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-semibold text-slate-500">Available Units</div>
                  <div className="text-lg font-extrabold text-emerald-700 font-mono leading-tight mt-0.5">
                    {totalStockUnits} <span className="text-[11px] font-normal text-slate-500">units</span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Ready for dispatch in depot</div>
                </div>
                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600 shrink-0">
                  <Boxes className="w-4 h-4" />
                </div>
              </div>

              <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-semibold text-slate-500">Stock Valuation</div>
                  <div className="text-lg font-extrabold text-[#003BB5] font-mono leading-tight mt-0.5">
                    ₹{totalStockValuation.toLocaleString('en-IN')}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">At current selling prices</div>
                </div>
                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-[#003BB5] shrink-0">
                  <TrendingUp className="w-4 h-4" />
                </div>
              </div>

              <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-semibold text-slate-500">Reorder Alerts</div>
                  {lowStockCount > 0 || outOfStockCount > 0 ? (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {lowStockCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setInvStockFilter(invStockFilter === 'low_stock' ? 'all' : 'low_stock')}
                          className={`text-xs font-bold px-2 py-0.5 rounded font-mono transition-colors border ${
                            invStockFilter === 'low_stock'
                              ? 'bg-amber-600 text-white border-amber-700 shadow-2xs'
                              : 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100'
                          }`}
                          title="Click to filter low stock items"
                        >
                          ⚠️ {lowStockCount} Low
                        </button>
                      )}
                      {outOfStockCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setInvStockFilter(invStockFilter === 'out_of_stock' ? 'all' : 'out_of_stock')}
                          className={`text-xs font-bold px-2 py-0.5 rounded font-mono transition-colors border ${
                            invStockFilter === 'out_of_stock'
                              ? 'bg-red-600 text-white border-red-700 shadow-2xs'
                              : 'bg-red-50 text-red-700 border-red-300 hover:bg-red-100'
                          }`}
                          title="Click to filter out-of-stock items"
                        >
                          🚨 {outOfStockCount} Out
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="text-xs font-bold text-emerald-700 mt-0.5 flex items-center gap-1">
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Healthy Stock</span>
                    </div>
                  )}
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    {lowStockCount > 0 || outOfStockCount > 0 ? 'Click badge to isolate items' : 'No items need reorder'}
                  </div>
                </div>
                <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600 shrink-0">
                  <AlertCircle className="w-4 h-4" />
                </div>
              </div>
            </div>

            {/* One-Line Aligned Controls & Action Toolbar (Small Buttons, Zero Clutter) */}
            <div className="bg-white p-2 rounded-xl border border-slate-200 shadow-2xs flex flex-wrap lg:flex-nowrap items-center justify-between gap-2">
              {/* Left: Aligned Filters & Search in a single compact row */}
              <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-x-auto py-0.5">
                {/* Search */}
                <div className="relative w-44 sm:w-56 shrink-0">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={invSearch}
                    onChange={e => setInvSearch(e.target.value)}
                    placeholder="Search SKU, name, HSN..."
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg pl-8 pr-6 py-1 text-xs text-slate-900 focus:outline-none focus:border-[#003BB5] focus:ring-1 focus:ring-blue-100"
                  />
                  {invSearch && (
                    <button
                      type="button"
                      onClick={() => setInvSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 font-bold text-xs"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Category Dropdown */}
                <select
                  value={invCategoryFilter}
                  onChange={e => setInvCategoryFilter(e.target.value)}
                  className="h-8 bg-slate-50 border border-slate-300 rounded-lg px-2 py-1 text-xs text-slate-700 font-semibold focus:outline-none focus:border-[#003BB5] shrink-0"
                >
                  <option value="all">All Categories</option>
                  <option value="ac">AC & Cooling</option>
                  <option value="plumber">Plumbing</option>
                  <option value="electrician">Electrical</option>
                  <option value="appliance">Appliances</option>
                  <option value="tools">Tools & Gear</option>
                </select>

                {/* Condition Dropdown */}
                <select
                  value={invConditionFilter}
                  onChange={e => setInvConditionFilter(e.target.value as any)}
                  className="h-8 bg-slate-50 border border-slate-300 rounded-lg px-2 py-1 text-xs text-slate-700 font-semibold focus:outline-none focus:border-[#003BB5] shrink-0"
                >
                  <option value="all">All Conditions</option>
                  <option value="new">Brand New</option>
                  <option value="refurbished">Refurbished</option>
                  <option value="preowned">2nd-Hand / Used</option>
                </select>

                {/* Stock Status Dropdown */}
                <select
                  value={invStockFilter}
                  onChange={e => setInvStockFilter(e.target.value as any)}
                  className="h-8 bg-slate-50 border border-slate-300 rounded-lg px-2 py-1 text-xs text-slate-700 font-semibold focus:outline-none focus:border-[#003BB5] shrink-0"
                >
                  <option value="all">All Stock Status</option>
                  <option value="in_stock">In Stock (&gt;5)</option>
                  <option value="low_stock">Low Stock (≤5)</option>
                  <option value="out_of_stock">Out of Stock (0)</option>
                </select>

                {/* Reset Filters Shortcut (if any active) */}
                {(invSearch || invCategoryFilter !== 'all' || invConditionFilter !== 'all' || invStockFilter !== 'all') && (
                  <button
                    type="button"
                    onClick={() => {
                      setInvSearch('');
                      setInvCategoryFilter('all');
                      setInvConditionFilter('all');
                      setInvStockFilter('all');
                    }}
                    className="text-[11px] font-bold text-[#003BB5] hover:underline px-1 shrink-0"
                  >
                    Reset
                  </button>
                )}
              </div>

              {/* Right: Small Aligned Inventory Management Options Buttons */}
              <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                {/* 1. Quick Stock In */}
                <button
                  type="button"
                  onClick={() => {
                    if (shopProducts.length > 0) {
                      setQuickRestockProductId(shopProducts[0].id);
                    }
                    setShowQuickRestockModal(true);
                  }}
                  className="h-8 px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-semibold rounded-lg flex items-center gap-1 text-xs border border-emerald-300 transition-colors shadow-2xs"
                  title="Quick stock-in / receive goods shipment"
                >
                  <Plus className="w-3 h-3 text-emerald-700" />
                  <span>Quick Restock</span>
                </button>

                {/* 2. Export CSV */}
                <button
                  type="button"
                  onClick={handleExportInventoryCsv}
                  className="h-8 px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 font-semibold rounded-lg flex items-center gap-1 text-xs border border-slate-200 transition-colors shadow-2xs"
                  title="Export inventory table to CSV for Excel / Tally"
                >
                  <Download className="w-3 h-3 text-slate-500" />
                  <span>Export CSV</span>
                </button>

                {/* 3. HSN Audit */}
                <button
                  type="button"
                  onClick={() => setShowHsnAuditModal(true)}
                  className="h-8 px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-[#003BB5] font-semibold rounded-lg flex items-center gap-1 text-xs border border-blue-200 transition-colors shadow-2xs"
                  title="View HSN tax breakdown & print inventory audit sheet"
                >
                  <FileText className="w-3 h-3 text-[#003BB5]" />
                  <span>HSN Audit</span>
                </button>

                {/* 4. Physical Count Sheet */}
                <button
                  type="button"
                  onClick={() => setShowStockSheetModal(true)}
                  className="h-8 px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 font-semibold rounded-lg flex items-center gap-1 text-xs border border-slate-200 transition-colors shadow-2xs"
                  title="Print physical stock verification sheet"
                >
                  <Printer className="w-3 h-3 text-slate-500" />
                  <span>Count Sheet</span>
                </button>

                {/* 5. Add SKU (Primary) */}
                <button
                  type="button"
                  onClick={() => {
                    setEditingProductId(null);
                    setProdName('');
                    setProdPartNumber(`SKU-${Date.now().toString().slice(-5)}`);
                    setProdHsnCode('8415');
                    setProdCondition('new');
                    setProdRefurbishedGrade('A+');
                    setProdMoneyBackDays(7);
                    setProdCertifiedDiagnostic(true);
                    setProdSecondHandNotes('');
                    setProdCategory('ac');
                    setProdPrice(500);
                    setProdMrp(750);
                    setProdCostPrice(350);
                    setProdStock(10);
                    setProdBrand('');
                    setProdBinLocation('Rack A-1');
                    setProdImage('');
                    setProdCompatibility('');
                    setProdDescription('');
                    setShowProductModal(true);
                  }}
                  className="h-8 px-3 py-1 bg-[#003BB5] hover:bg-[#002D8F] text-white font-bold rounded-lg flex items-center gap-1 text-xs transition-colors shadow-2xs active:scale-95"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add SKU</span>
                </button>
              </div>
            </div>

            {/* Showing Count & Filter Summary Sub-Bar */}
            <div className="flex items-center justify-between text-[11px] text-slate-500 px-1 font-medium">
              <div>
                Showing <strong className="text-slate-800 font-bold">{filteredInventory.length}</strong> of{' '}
                <strong className="text-slate-800 font-bold">{shopProducts.length}</strong> catalog items
              </div>
              {filteredInventory.length < shopProducts.length && (
                <div className="flex items-center gap-1 text-[#003BB5]">
                  <span>Filter Active</span>
                  <button
                    type="button"
                    onClick={() => {
                      setInvSearch('');
                      setInvCategoryFilter('all');
                      setInvConditionFilter('all');
                      setInvStockFilter('all');
                    }}
                    className="hover:underline font-bold"
                  >
                    (Clear All)
                  </button>
                </div>
              )}
            </div>

            {/* Inventory Table with Aligned, Compact Controls */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[840px]">
                  <thead>
                    <tr className="bg-slate-50/90 border-b border-slate-200 text-slate-600 text-[11px] uppercase tracking-wider font-semibold">
                      <th className="py-2.5 px-3">Item & SKU</th>
                      <th className="py-2.5 px-3">Category & Shelf</th>
                      <th className="py-2.5 px-3">Condition</th>
                      <th className="py-2.5 px-3">Price / Margin</th>
                      <th className="py-2.5 px-3">Stock Units</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {filteredInventory.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-8 text-center text-slate-400">
                          <Package className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                          <p className="font-semibold text-slate-600 text-xs">No products match your search or filter</p>
                          <p className="text-[11px] text-slate-400 mt-0.5">Try clearing filters or click "Add SKU"</p>
                        </td>
                      </tr>
                    ) : (
                      filteredInventory.map(p => {
                        const cost = p.costPrice || Math.round(p.price * 0.7);
                        const marginPercent = p.price > 0 ? Math.round(((p.price - cost) / p.price) * 100) : 0;
                        const isLow = p.stock > 0 && p.stock <= 5;
                        const isOut = p.stock === 0;

                        return (
                          <tr key={p.id} className="hover:bg-slate-50/70 transition-colors">
                            {/* Name & SKU */}
                            <td className="py-2.5 px-3 align-middle">
                              <div className="flex items-center gap-2.5">
                                {p.image ? (
                                  <img
                                    src={p.image}
                                    alt={p.name}
                                    className="w-9 h-9 rounded-lg object-contain border border-slate-200 bg-white p-0.5 shrink-0 shadow-2xs"
                                  />
                                ) : (
                                  <div className="w-9 h-9 rounded-lg border border-slate-200 bg-slate-100 flex items-center justify-center shrink-0 text-slate-400">
                                    <Package className="w-4 h-4" />
                                  </div>
                                )}
                                <div className="min-w-0 max-w-[210px]">
                                  <div className="font-bold text-slate-900 truncate" title={p.name}>
                                    {p.name}
                                  </div>
                                  <div className="text-[10px] text-slate-500 font-mono mt-0.5 truncate">
                                    SKU: {p.partNumber} • <strong className="text-slate-700">{p.brand || 'OEM'}</strong>
                                  </div>
                                </div>
                              </div>
                            </td>

                            {/* Category & Shelf Location */}
                            <td className="py-2.5 px-3 align-middle">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="capitalize px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded text-[10.5px] font-semibold">
                                  {p.category}
                                </span>
                                <span className="text-[10px] font-mono text-slate-600 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded font-medium">
                                  📍 {p.binLocation || 'Rack A-1'}
                                </span>
                              </div>
                            </td>

                            {/* Condition */}
                            <td className="py-2.5 px-3 align-middle">
                              <div>
                                {p.condition === 'refurbished' ? (
                                  <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-300 rounded text-[10px] font-bold">
                                    Refurb {p.refurbishedGrade ? `(${p.refurbishedGrade})` : ''}
                                  </span>
                                ) : p.condition === 'preowned' ? (
                                  <span className="px-1.5 py-0.5 bg-amber-50 text-amber-900 border border-amber-300 rounded text-[10px] font-bold">
                                    2nd-Hand
                                  </span>
                                ) : (
                                  <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 border border-slate-200 rounded text-[10px] font-semibold">
                                    New
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Price / Margin */}
                            <td className="py-2.5 px-3 align-middle">
                              <div className="font-bold text-slate-900 font-mono text-xs">₹{p.price}</div>
                              <div className="text-[10px] text-slate-400 space-x-1 font-mono">
                                <span>Cost ₹{cost}</span>
                                <span className={`font-bold ${marginPercent >= 25 ? 'text-emerald-700' : 'text-amber-700'}`}>
                                  ({marginPercent}%)
                                </span>
                              </div>
                            </td>

                            {/* Stock Units, Small Stepper & Quick +5 */}
                            <td className="py-2.5 px-3 align-middle">
                              <div className="flex items-center gap-1.5">
                                <div className="inline-flex items-center border border-slate-300 rounded-lg bg-slate-50 overflow-hidden shadow-2xs">
                                  <button
                                    type="button"
                                    onClick={() => handleQuickStockAdjust(p.id, -1)}
                                    disabled={p.stock <= 0}
                                    title="Decrease by 1"
                                    className="px-2 py-0.5 hover:bg-slate-200 text-slate-700 font-bold border-r border-slate-200 text-xs disabled:opacity-30 transition-colors"
                                  >
                                    -
                                  </button>
                                  <input
                                    type="number"
                                    min={0}
                                    value={p.stock}
                                    onChange={e => updateProductStock(p.id, Number(e.target.value))}
                                    className="w-10 text-center font-bold text-slate-900 font-mono text-xs bg-transparent py-0.5 focus:outline-none"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleQuickStockAdjust(p.id, 1)}
                                    title="Increase by 1"
                                    className="px-2 py-0.5 hover:bg-slate-200 text-slate-700 font-bold border-l border-slate-200 text-xs transition-colors"
                                  >
                                    +
                                  </button>
                                </div>

                                {/* Quick +5 stock in shortcut */}
                                <button
                                  type="button"
                                  onClick={() => handleQuickStockAdjust(p.id, 5)}
                                  title="Quick add +5 received units"
                                  className="px-1.5 py-0.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded text-[10px] font-bold transition-all shadow-2xs"
                                >
                                  +5
                                </button>

                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded font-mono ${
                                  isOut
                                    ? 'bg-red-100 text-red-700 border border-red-200'
                                    : isLow
                                    ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                    : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                }`}>
                                  {isOut ? 'Out' : isLow ? 'Low' : `${p.stock}`}
                                </span>
                              </div>
                            </td>

                            {/* Catalog Review Status */}
                            <td className="py-2.5 px-3 align-middle">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold capitalize ${
                                p.status === 'approved'
                                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-300'
                                  : 'bg-amber-50 text-amber-800 border border-amber-300'
                              }`}>
                                {p.status}
                              </span>
                            </td>

                            {/* Small Aligned Actions */}
                            <td className="py-2.5 px-3 align-middle text-right">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingProductId(p.id);
                                    setProdName(p.name);
                                    setProdPartNumber(p.partNumber);
                                    setProdHsnCode(p.hsnCode || '8415');
                                    setProdCondition(p.condition || 'new');
                                    setProdRefurbishedGrade(p.refurbishedGrade || 'A+');
                                    setProdMoneyBackDays(p.moneyBackDays || 7);
                                    setProdCertifiedDiagnostic(p.certifiedDiagnostic ?? true);
                                    setProdSecondHandNotes(p.secondHandNotes || '');
                                    setProdCategory(p.category);
                                    setProdPrice(p.price);
                                    setProdMrp(p.mrp);
                                    setProdCostPrice(p.costPrice || Math.round(p.price * 0.7));
                                    setProdStock(p.stock);
                                    setProdBrand(p.brand);
                                    setProdBinLocation(p.binLocation || 'Rack A-1');
                                    setProdImage(p.image || '');
                                    setProdCompatibility(p.compatibility);
                                    setProdDescription(p.description);
                                    setShowProductModal(true);
                                  }}
                                  className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md font-semibold text-[11px] inline-flex items-center gap-1 transition-all border border-slate-200"
                                >
                                  <Edit2 className="w-3 h-3" />
                                  <span>Edit</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteProduct(p.id)}
                                  className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-all"
                                  title="Archive / Delete SKU"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB: B2B WHOLESALE & BULK ORDERS MANAGEMENT */}
        {activeTab === 'b2b' && (
          <ShopB2BSection
            shopId={currentShop ? currentShop.id : (shops[0]?.id || '')}
            shopName={currentShop ? currentShop.shopName : (shops[0]?.shopName || 'Partner Hub')}
          />
        )}

        {/* TAB 3: WEDNESDAY SETTLEMENTS & 5% COMMISSION LEDGER */}
        {activeTab === 'ledger' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                <div className="text-slate-500 text-sm font-medium">Wednesday Net Payouts Due</div>
                <div className="text-2xl font-extrabold text-slate-900 font-mono mt-1">
                  ₹{totalEarnings > 0 ? totalEarnings : 1850}
                </div>
                <div className="text-sm text-emerald-700 mt-1 font-semibold">Transferred every Wednesday via NEFT/IMPS</div>
              </div>

              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                <div className="text-slate-500 text-sm font-medium">5% Repaido Platform Commission</div>
                <div className="text-2xl font-extrabold text-amber-700 font-mono mt-1">
                  ₹{totalCommissionPaid > 0 ? totalCommissionPaid : 95}
                </div>
                <div className="text-sm text-slate-500 mt-1">Auto-deducted from gross sales</div>
              </div>

              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                <div className="text-slate-500 text-sm font-medium">Onboarding Fee Remaining (₹2,000 Total)</div>
                <div className="text-2xl font-extrabold text-blue-700 font-mono mt-1">
                  ₹{currentShop?.onboardingFeeRemaining ?? 1850}
                </div>
                <div className="text-sm text-emerald-700 mt-1 font-medium">Recovered gradually per sale (no upfront stress)</div>
              </div>
            </div>

            {/* Ledger Transactions */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 shadow-xs">
              <h3 className="text-xs font-bold text-slate-900 flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-emerald-600" />
                <span>Shop Sales Ledger & Settlement Schedule</span>
              </h3>

              {shopLedger.length === 0 ? (
                <div className="text-center py-6 text-slate-500">
                  <p className="font-semibold">No completed sales in this settlement cycle yet.</p>
                  <p className="text-sm text-slate-400">Sales made during technician tasks log here automatically.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {shopLedger.map(entry => (
                    <div key={entry.id} className="bg-slate-50 p-3 rounded-lg border border-slate-200 flex items-center justify-between text-sm">
                      <div>
                        <div className="font-bold text-slate-900">{entry.productName}</div>
                        <div className="text-slate-500 text-sm">
                          Order #{entry.orderId} • {new Date(entry.date).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-extrabold text-slate-900 font-mono">Net: ₹{entry.netPayout}</div>
                        <div className="text-sm text-slate-500">
                          Gross: ₹{entry.itemPrice} | Comm (5%): -₹{entry.commission} | Onboard: -₹{entry.onboardingDeduction}
                        </div>
                        <div className="text-sm text-amber-800 font-bold">Settlement: Wednesday Cycle</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: PARTNER REGISTRATION / KYC WITH MAP PIN PICKER */}
        {activeTab === 'kyc_register' && (
          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4 shadow-xs">
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-amber-600" />
                <span>Register New Spare Parts Partner Shop (Balasore Hub)</span>
              </h2>
              <p className="text-sm text-slate-500">
                Free Registration • Business KYC • Pin exact shop coordinates on the live interactive map
              </p>
            </div>

            {regSuccessMessage && (
              <div className="bg-emerald-50 border border-emerald-300 text-emerald-800 p-3 rounded-lg flex items-center gap-2 font-medium">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                <span>{regSuccessMessage}</span>
              </div>
            )}

            <form onSubmit={handleRegisterShop} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-slate-600 font-medium block mb-1">Shop / Business Name</label>
                  <input
                    type="text"
                    required
                    value={newShopName}
                    onChange={e => setNewShopName(e.target.value)}
                    placeholder="e.g. Maa Tarini Spare Hub"
                    className="w-full bg-slate-50 border border-slate-300 text-slate-900 rounded p-2 text-xs focus:outline-none focus:border-amber-600"
                  />
                </div>
                <div>
                  <label className="text-sm text-slate-600 font-medium block mb-1">Proprietor / Owner Name</label>
                  <input
                    type="text"
                    required
                    value={newOwnerName}
                    onChange={e => setNewOwnerName(e.target.value)}
                    placeholder="e.g. Rabindra Mohapatra"
                    className="w-full bg-slate-50 border border-slate-300 text-slate-900 rounded p-2 text-xs focus:outline-none focus:border-amber-600"
                  />
                </div>
                <div>
                  <label className="text-sm text-slate-600 font-medium block mb-1">Mobile Phone (KYC Verified)</label>
                  <input
                    type="tel"
                    required
                    value={newPhone}
                    onChange={e => setNewPhone(e.target.value)}
                    placeholder="+91 94370 12890"
                    className="w-full bg-slate-50 border border-slate-300 text-slate-900 rounded p-2 text-xs focus:outline-none focus:border-amber-600"
                  />
                </div>
                <div>
                  <label className="text-sm text-slate-600 font-medium block mb-1">Business Email</label>
                  <input
                    type="email"
                    required
                    value={newEmail}
                    onChange={e => setNewEmail(e.target.value)}
                    placeholder="shop@repaido-spares.com"
                    className="w-full bg-slate-50 border border-slate-300 text-slate-900 rounded p-2 text-xs focus:outline-none focus:border-amber-600"
                  />
                </div>
                <div>
                  <label className="text-sm text-slate-600 font-medium block mb-1">GSTIN Number</label>
                  <input
                    type="text"
                    required
                    value={newGstin}
                    onChange={e => setNewGstin(e.target.value)}
                    placeholder="21AABCM1234F1Z8"
                    className="w-full bg-slate-50 border border-slate-300 text-slate-900 rounded p-2 text-xs font-mono uppercase focus:outline-none focus:border-amber-600"
                  />
                </div>
                <div>
                  <label className="text-sm text-slate-600 font-medium block mb-1">Trade License / Municipal Reg #</label>
                  <input
                    type="text"
                    required
                    value={newTradeLicense}
                    onChange={e => setNewTradeLicense(e.target.value)}
                    placeholder="TL-BLS-2024-8891"
                    className="w-full bg-slate-50 border border-slate-300 text-slate-900 rounded p-2 text-xs focus:outline-none focus:border-amber-600"
                  />
                </div>
                <div>
                  <label className="text-sm text-slate-600 font-medium block mb-1">Bank Account Number (for Wednesday payouts)</label>
                  <input
                    type="text"
                    required
                    value={newBankAccount}
                    onChange={e => setNewBankAccount(e.target.value)}
                    placeholder="38920199201"
                    className="w-full bg-slate-50 border border-slate-300 text-slate-900 rounded p-2 text-xs font-mono focus:outline-none focus:border-amber-600"
                  />
                </div>
                <div>
                  <label className="text-sm text-slate-600 font-medium block mb-1">Bank IFSC Code</label>
                  <input
                    type="text"
                    required
                    value={newIfsc}
                    onChange={e => setNewIfsc(e.target.value)}
                    placeholder="SBIN0000016"
                    className="w-full bg-slate-50 border border-slate-300 text-slate-900 rounded p-2 text-xs font-mono uppercase focus:outline-none focus:border-amber-600"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm text-slate-600 font-medium block mb-1">Shop Physical Address</label>
                <input
                  type="text"
                  required
                  value={newAddress}
                  onChange={e => setNewAddress(e.target.value)}
                  placeholder="Station Road, Near Bus Stand, Balasore, Odisha 756001"
                  className="w-full bg-slate-50 border border-slate-300 text-slate-900 rounded p-2 text-xs focus:outline-none focus:border-amber-600"
                />
              </div>

              {/* LIVE LEAFLET GOOGLE MAP PIN PICKER */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-slate-900 flex items-center gap-2">
                    <div className="w-6 h-6 rounded bg-red-100 text-red-600 flex items-center justify-center">
                      <MapPin className="w-3.5 h-3.5" />
                    </div>
                    <span>Shop Geo-Location & Dispatch GPS Pin</span>
                  </div>
                  <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full font-mono font-bold">
                    {shopLat.toFixed(4)}° N, {shopLng.toFixed(4)}° E
                  </span>
                </div>
                <p className="text-sm text-slate-500">
                  Used by Repaido discovery and billing engine to compute exact travel distance (billed at ₹10/km up + ₹10/km return to customer invoice).
                </p>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-white rounded-lg border border-slate-200 shadow-xs">
                  <div>
                    <div className="text-xs font-bold text-slate-800">
                      Current Pinned Coordinates: <span className="font-mono text-red-600">{shopLat.toFixed(5)}, {shopLng.toFixed(5)}</span>
                    </div>
                    <div className="text-sm text-slate-500 mt-0.5">
                      Target City: <strong className="text-slate-700">{newCity}</strong> • Original Live Roadmap by Google Maps & Leaflet
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsMapPickerOpen(true)}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 shadow-sm transition-all flex-shrink-0"
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    <span>Open Live Leaflet Google Map</span>
                  </button>
                </div>
              </div>

              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-sm text-slate-700 space-y-1">
                <div className="font-bold text-slate-900">Repaido Partner Commercial Terms:</div>
                <div>• Free registration with ₹2,000 onboarding fee recovered gradually per sale.</div>
                <div>• 5% platform commission on gross spare part sales.</div>
                <div>• Weekly Wednesday direct bank account settlement.</div>
              </div>

              <button
                type="submit"
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs shadow-xs flex items-center justify-center gap-2 transition-all"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Send shop details for review</span>
              </button>
            </form>
          </div>
        )}

        {activeTab === 'settings' && (
          <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-4 shadow-xs max-w-xl mx-auto">
            <div className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-amber-600" />
              <div>
                <h2 className="text-sm font-bold text-slate-900">Shop Profile Settings</h2>
                <p className="text-sm text-slate-500">Update the shop identity customers and technicians see.</p>
              </div>
            </div>
            <label className="text-sm text-slate-600 font-medium block">Shop profile picture</label>
            <div className="flex items-center gap-3">
              {shopProfileImage ? <img src={shopProfileImage} alt="Shop profile preview" className="w-16 h-16 rounded-xl object-cover border border-slate-200" /> : <div className="w-16 h-16 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400"><ImageIcon className="w-5 h-5" /></div>}
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => handleShopProfileImage(e.target.files?.[0])} className="text-xs text-slate-600" />
            </div>
            <label className="text-sm text-slate-600 font-medium block">Shop name<input value={shopProfileName} onChange={e => setShopProfileName(e.target.value)} className="mt-1 w-full bg-slate-50 border border-slate-300 rounded p-2 text-xs" /></label>
            <label className="text-sm text-slate-600 font-medium block">Owner name<input value={shopProfileOwner} onChange={e => setShopProfileOwner(e.target.value)} className="mt-1 w-full bg-slate-50 border border-slate-300 rounded p-2 text-xs" /></label>
            <label className="text-sm text-slate-600 font-medium block">Phone<input value={shopProfilePhone} onChange={e => setShopProfilePhone(e.target.value)} className="mt-1 w-full bg-slate-50 border border-slate-300 rounded p-2 text-xs" /></label>
            <label className="text-sm text-slate-600 font-medium block">Email<input value={shopProfileEmail} onChange={e => setShopProfileEmail(e.target.value)} className="mt-1 w-full bg-slate-50 border border-slate-300 rounded p-2 text-xs" /></label>
            <label className="text-sm text-slate-600 font-medium block">GSTIN Number<input value={shopProfileGstin} onChange={e => setShopProfileGstin(e.target.value.toUpperCase())} placeholder="21AABCM1234F1Z8" className="mt-1 w-full bg-slate-50 border border-slate-300 rounded p-2 text-xs font-mono uppercase" /></label>
            <label className="text-sm text-slate-600 font-medium block">Trade License / Registration Number<input value={shopProfileTradeLicense} onChange={e => setShopProfileTradeLicense(e.target.value)} placeholder="TL-BLS-2024-8891" className="mt-1 w-full bg-slate-50 border border-slate-300 rounded p-2 text-xs" /></label>
            <button type="button" onClick={handleSaveShopProfile} className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-xs flex items-center justify-center gap-2"><Check className="w-4 h-4" /> Save shop profile & GST/KYC</button>
          </section>
        )}

        {/* TAB 7: COMPANY HQ DIRECTIVES & OVERSIGHT */}
        {activeTab === 'company_oversight' && (
          <div className="space-y-4">
            {hqActionFeedback && (
              <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-800 text-xs font-bold flex items-center justify-between shadow-xs">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{hqActionFeedback}</span>
                </div>
                <button type="button" onClick={() => setHqActionFeedback('')} className="text-emerald-700 hover:text-emerald-950 font-bold">✕</button>
              </div>
            )}

            {/* Shop Operational State & HQ Freeze Controls */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center font-bold">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">Repaido Company Admin & HQ Oversight Controls</h2>
                    <p className="text-[11px] text-slate-500">
                      Real-time monitoring, compliance directives, and operational controls for {currentShop?.shopName}.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {currentShop?.isOperationsFrozen || currentShop?.status === 'suspended_by_hq' ? (
                    <button
                      type="button"
                      onClick={() => handleToggleShopFreeze(false)}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 shadow-xs transition-all"
                    >
                      <Unlock className="w-3.5 h-3.5" />
                      <span>Unfreeze / Restore Shop</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsSuspendingShop(true)}
                      className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 shadow-xs transition-all"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>Freeze / Suspend Shop</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Suspend confirmation dialog if requested */}
              {isSuspendingShop && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl space-y-2">
                  <div className="font-bold text-red-900 text-xs flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-red-600" />
                    <span>Confirm Emergency Shop Freeze & Marketplace Delisting</span>
                  </div>
                  <p className="text-[11px] text-red-700">
                    Freezing will immediately hide all inventory products of this shop from customer search, pause incoming booking assignments, and alert the shop owner.
                  </p>
                  <div>
                    <label className="text-[11px] font-bold text-slate-700 block mb-1">Reason for Suspension</label>
                    <input
                      type="text"
                      value={suspendReason}
                      onChange={e => setSuspendReason(e.target.value)}
                      className="w-full p-2 bg-white border border-red-300 rounded text-xs text-slate-900"
                      placeholder="e.g. GST compliance verification pending / suspicious pricing"
                    />
                  </div>
                  <div className="flex items-center gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => setIsSuspendingShop(false)}
                      className="px-3 py-1 bg-white border border-slate-300 text-slate-700 rounded text-xs font-bold"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleShopFreeze(true)}
                      className="px-3 py-1 bg-red-700 hover:bg-red-800 text-white rounded text-xs font-bold"
                    >
                      Confirm Freeze & Delist
                    </button>
                  </div>
                </div>
              )}

              {/* Operational Overview Metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                  <div className="text-[10px] text-slate-500 font-bold uppercase">Operational Status</div>
                  <div className={`text-xs font-extrabold mt-0.5 ${
                    currentShop?.isOperationsFrozen || currentShop?.status === 'suspended_by_hq' ? 'text-red-700' : 'text-emerald-700'
                  }`}>
                    {currentShop?.isOperationsFrozen || currentShop?.status === 'suspended_by_hq' ? '🚨 Suspended by HQ' : '✓ Live & Active'}
                  </div>
                  <div className="text-[9px] text-slate-400 mt-0.5">SLA Handover: &lt; 15 mins</div>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                  <div className="text-[10px] text-slate-500 font-bold uppercase">Commission Rate</div>
                  <div className="text-xs font-extrabold text-slate-900 mt-0.5">
                    {Math.round((currentShop?.commissionRate || 0.05) * 100)}%
                  </div>
                  <div className="text-[9px] text-slate-400 mt-0.5">Standard Repaido tier</div>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                  <div className="text-[10px] text-slate-500 font-bold uppercase">Onboarding Balance</div>
                  <div className="text-xs font-extrabold text-slate-900 mt-0.5">
                    {formatMoney(currentShop?.onboardingFeeRemaining || 0)}
                  </div>
                  <div className="text-[9px] text-slate-400 mt-0.5">Recovered per sale</div>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                  <div className="text-[10px] text-slate-500 font-bold uppercase">KYC Verification</div>
                  <div className="text-xs font-extrabold text-emerald-700 mt-0.5">
                    {currentShop?.status === 'active' ? 'Verified Partner' : 'Verification Review'}
                  </div>
                  <div className="text-[9px] text-slate-400 mt-0.5">GSTIN: {currentShop?.gstin || 'Verified'}</div>
                </div>
              </div>
            </div>

            {/* Form to Dispatch Operational Directives to Shop */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3">
              <div className="flex items-center gap-2">
                <Megaphone className="w-4 h-4 text-amber-600" />
                <div>
                  <h3 className="text-xs font-bold text-slate-900">Broadcast Direct Operational Directive</h3>
                  <p className="text-[11px] text-slate-500">
                    Dispatches an immediate alert to the shop owner's notification bell with deep-link navigation.
                  </p>
                </div>
              </div>

              <form onSubmit={handleDispatchCompanyDirective} className="space-y-3 pt-1">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-[11px] font-bold text-slate-700 block mb-1">Target Shop</label>
                    <select
                      value={directiveTargetShop}
                      onChange={e => setDirectiveTargetShop(e.target.value as any)}
                      className="w-full p-2 bg-slate-50 border border-slate-300 rounded text-xs"
                    >
                      <option value="THIS_SHOP">{currentShop?.shopName} (This shop only)</option>
                      <option value="ALL">ALL Partner Shops in Network</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-slate-700 block mb-1">Directive Category</label>
                    <select
                      value={directiveCategory}
                      onChange={e => setDirectiveCategory(e.target.value as any)}
                      className="w-full p-2 bg-slate-50 border border-slate-300 rounded text-xs"
                    >
                      <option value="compliance">GST / HSN Compliance Audit</option>
                      <option value="urgent_order">Urgent Order Dispatch / Handover</option>
                      <option value="price_verification">Price & MRP Verification</option>
                      <option value="holiday_schedule">Holiday Working Hours</option>
                      <option value="audit">Inventory Physical Verification</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-slate-700 block mb-1">Priority Level</label>
                    <select
                      value={directivePriority}
                      onChange={e => setDirectivePriority(e.target.value as any)}
                      className="w-full p-2 bg-slate-50 border border-slate-300 rounded text-xs"
                    >
                      <option value="urgent">🔴 Urgent (Immediate Action)</option>
                      <option value="high">🟡 High (Within 4 Hours)</option>
                      <option value="normal">🔵 Normal (Standard Info)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1">Directive Title</label>
                  <input
                    type="text"
                    required
                    value={directiveTitle}
                    onChange={e => setDirectiveTitle(e.target.value)}
                    placeholder="e.g. Q3 HSN Number Compliance & Tax Audit Check"
                    className="w-full p-2 bg-slate-50 border border-slate-300 rounded text-xs text-slate-900"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1">Action Instructions for Shop Owner</label>
                  <textarea
                    required
                    rows={2}
                    value={directiveInstructions}
                    onChange={e => setDirectiveInstructions(e.target.value)}
                    placeholder="Provide specific actionable steps required from the shop owner to prevent operational delays..."
                    className="w-full p-2 bg-slate-50 border border-slate-300 rounded text-xs text-slate-900"
                  />
                </div>

                <div className="flex items-center justify-between pt-1">
                  <div className="text-[10px] text-slate-400">
                    Directives appear instantly with sound/ping on shop owner's notification bell.
                  </div>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-[#0f244a] hover:bg-[#1a386d] text-white rounded-lg font-bold text-xs flex items-center gap-1.5 shadow-xs transition-all"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Dispatch Directive to Shop Bell</span>
                  </button>
                </div>
              </form>
            </div>

            {/* Active Directives & Acknowledgment Log */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <h3 className="text-xs font-bold text-slate-900">
                    Active Company Directives & Compliance Acknowledgment ({activeDirectives.length})
                  </h3>
                </div>
                <span className="text-[10px] text-slate-400 font-mono">
                  {activeDirectives.filter(d => !d.acknowledged).length} pending acknowledgment
                </span>
              </div>

              <div className="space-y-2">
                {activeDirectives.length === 0 ? (
                  <p className="text-slate-500 text-xs py-3 text-center">No directives issued yet.</p>
                ) : (
                  activeDirectives.map(dir => (
                    <div
                      key={dir.id}
                      className={`p-3 rounded-xl border transition-all ${
                        dir.acknowledged
                          ? 'bg-slate-50 border-slate-200 opacity-80'
                          : 'bg-amber-50/60 border-amber-300 shadow-2xs'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className={`text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded font-mono ${
                              dir.priority === 'urgent'
                                ? 'bg-red-100 text-red-800'
                                : dir.priority === 'high'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-blue-100 text-blue-800'
                            }`}>
                              {dir.priority}
                            </span>
                            <span className="text-xs font-bold text-slate-900">{dir.title}</span>
                          </div>
                          <p className="text-[11px] text-slate-600">{dir.instructions}</p>
                          <div className="text-[10px] text-slate-400 font-mono">
                            Issued by: {dir.issuedBy} • {new Date(dir.issuedAt).toLocaleString()}
                          </div>
                        </div>

                        <div className="shrink-0 flex items-center gap-2">
                          {dir.acknowledged ? (
                            <span className="text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-lg flex items-center gap-1 border border-emerald-300">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Acknowledged
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleAcknowledgeDirective(dir.id)}
                              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold text-xs flex items-center gap-1 shadow-xs transition-all"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>Acknowledge & Confirm Completed</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </main>
      </div>

      {/* Product Add/Edit Modal with Instant Cloud Sync */}
      {showProductModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-5 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  {editingProductId ? 'Edit SKU & Stock Parameters' : 'Add New SKU to Shop Inventory'}
                </h3>
                <p className="text-sm text-slate-500">
                  Changes synchronize directly across server nodes and Cloud Firestore collections.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowProductModal(false)}
                className="w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-700 font-bold"
              >
                ✕
              </button>
            </div>

            {prodRequestSent ? (
              <div className="py-8 text-center text-emerald-700 space-y-2">
                <CheckCircle2 className="w-10 h-10 mx-auto" />
                <p className="font-bold">Request sent for company review</p>
                <p className="text-sm text-slate-500">Moderated within 2 hours for catalog quality assurance.</p>
              </div>
            ) : (
              <form onSubmit={handleSaveDirectProduct} className="space-y-3 text-xs">
                {/* Product Condition Classification */}
                <div>
                  <label className="text-xs text-slate-700 font-bold block mb-1">
                    Product Condition & Marketplace Classification
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'new', label: '🆕 Brand New', desc: 'OEM sealed & warranty' },
                      { id: 'refurbished', label: '🔄 Refurbished', desc: '40-pt tested & certified' },
                      { id: 'preowned', label: '♻️ Pre-Owned', desc: 'Verified 2nd-hand stock' }
                    ].map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setProdCondition(c.id as any)}
                        className={`p-2 rounded-lg border text-left transition-all ${
                          prodCondition === c.id
                            ? 'bg-[#142858] text-white border-[#142858] shadow-xs'
                            : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <div className="font-bold text-[11px]">{c.label}</div>
                        <div className="text-[9px] opacity-80 mt-0.5">{c.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Refurbished Specific Parameters */}
                {prodCondition === 'refurbished' && (
                  <div className="bg-emerald-50/80 border border-emerald-300 rounded-lg p-3 space-y-2">
                    <div className="font-bold text-emerald-950 text-xs flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-emerald-600"/>
                      <span>Refurbished Certification Parameters</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] text-emerald-900 font-semibold block mb-0.5">Condition Grade</label>
                        <select
                          value={prodRefurbishedGrade}
                          onChange={e => setProdRefurbishedGrade(e.target.value as any)}
                          className="w-full bg-white border border-emerald-300 rounded p-1.5 text-xs text-slate-900"
                        >
                          <option value="A+">Grade A+ (Like New, 0 Scratches)</option>
                          <option value="A">Grade A (Excellent, Minor Scuffs)</option>
                          <option value="B">Grade B (Fully Functional, Noticeable Wear)</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[11px] text-emerald-900 font-semibold block mb-0.5">Money-Back Guarantee</label>
                        <select
                          value={prodMoneyBackDays}
                          onChange={e => setProdMoneyBackDays(Number(e.target.value))}
                          className="w-full bg-white border border-emerald-300 rounded p-1.5 text-xs text-slate-900"
                        >
                          <option value={7}>7 Days Money-Back</option>
                          <option value={14}>14 Days Money-Back</option>
                          <option value={30}>30 Days Money-Back</option>
                        </select>
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-[11px] text-emerald-900 font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        checked={prodCertifiedDiagnostic}
                        onChange={e => setProdCertifiedDiagnostic(e.target.checked)}
                        className="w-3.5 h-3.5 rounded text-emerald-600"
                      />
                      <span>Certified 40-Point Diagnostic Check passed</span>
                    </label>
                  </div>
                )}

                {/* Pre-Owned / Second Hand Specific Configuration */}
                {prodCondition === 'preowned' && (
                  <div className="bg-amber-50/80 border border-amber-300 rounded-lg p-3 space-y-2">
                    <div className="font-bold text-amber-950 text-xs flex items-center gap-1.5">
                      <Store className="w-3.5 h-3.5 text-amber-700"/>
                      <span>Pre-Owned / 2nd-Hand Listing Configuration</span>
                    </div>
                    <div>
                      <label className="text-[11px] text-amber-900 font-semibold block mb-0.5">Tested Functional Condition & Seller Notes</label>
                      <input
                        type="text"
                        value={prodSecondHandNotes}
                        onChange={e => setProdSecondHandNotes(e.target.value)}
                        placeholder="e.g. Fully tested, no gas leak, original capacitor intact with 30-day testing warranty"
                        className="w-full bg-white border border-amber-300 rounded p-1.5 text-xs text-slate-900"
                      />
                    </div>
                    <p className="text-[10.5px] text-amber-900 font-medium">
                      ✓ Automatically published to both Spare Parts Shop AND Community Second-Hand Finds with Shop Verified badge.
                    </p>
                  </div>
                )}

                {/* Product Name */}
                <div>
                  <label className="text-sm text-slate-600 font-medium block mb-0.5">Product Name</label>
                  <input
                    type="text"
                    required
                    value={prodName}
                    onChange={e => setProdName(e.target.value)}
                    placeholder="e.g. Split AC Indoor Blower Fan Motor 28W"
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs text-slate-900 focus:outline-none focus:border-amber-600"
                  />
                </div>

                {/* HSN Code Input & Quick Presets */}
                <div>
                  <div className="flex items-center justify-between mb-0.5">
                    <label className="text-sm text-slate-600 font-medium">HSN Code (GST Classification)</label>
                    <span className="text-[10.5px] text-slate-400">Required for GST billing & B2B quotations</span>
                  </div>
                  <input
                    type="text"
                    required
                    value={prodHsnCode}
                    onChange={e => setProdHsnCode(e.target.value)}
                    placeholder="e.g. 8415 / 8501 / 8481"
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs text-slate-900 font-mono font-bold focus:outline-none focus:border-amber-600"
                  />
                  <div className="flex flex-wrap items-center gap-1 mt-1">
                    <span className="text-[10px] text-slate-400 mr-1">Quick Select:</span>
                    {[
                      { code: '8415', label: '8415 (AC Parts)' },
                      { code: '8501', label: '8501 (Motors)' },
                      { code: '8481', label: '8481 (Valves/Taps)' },
                      { code: '8536', label: '8536 (Switches/MCB)' },
                      { code: '8471', label: '8471 (Computers)' },
                      { code: '8504', label: '8504 (Transformers)' }
                    ].map(hsn => (
                      <button
                        key={hsn.code}
                        type="button"
                        onClick={() => setProdHsnCode(hsn.code)}
                        className={`text-[9.5px] px-1.5 py-0.5 rounded font-mono transition-all ${
                          prodHsnCode === hsn.code
                            ? 'bg-amber-100 text-amber-900 font-bold border border-amber-300'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {hsn.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-sm text-slate-600 font-medium block mb-0.5">SKU / Part Number</label>
                    <input
                      type="text"
                      required
                      value={prodPartNumber}
                      onChange={e => setProdPartNumber(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs text-slate-900 font-mono focus:outline-none focus:border-amber-600"
                    />
                  </div>

                  <div>
                    <label className="text-sm text-slate-600 font-medium block mb-0.5">Category</label>
                    <select
                      value={prodCategory}
                      onChange={e => setProdCategory(e.target.value as any)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs text-slate-900 focus:outline-none focus:border-amber-600"
                    >
                      <option value="ac">AC & Cooling</option>
                      <option value="plumber">Plumbing</option>
                      <option value="electrician">Electrical</option>
                      <option value="appliance">Appliances</option>
                      <option value="tools">Tools</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-sm text-slate-600 font-medium block mb-0.5">Brand / OEM</label>
                    <input
                      type="text"
                      required
                      value={prodBrand}
                      onChange={e => setProdBrand(e.target.value)}
                      placeholder="e.g. Havells / Daikin / Voltas"
                      className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs text-slate-900 focus:outline-none focus:border-amber-600"
                    />
                  </div>

                  <div>
                    <label className="text-sm text-slate-600 font-medium block mb-0.5">Bin / Warehouse Rack</label>
                    <input
                      type="text"
                      value={prodBinLocation}
                      onChange={e => setProdBinLocation(e.target.value)}
                      placeholder="e.g. Rack A-3 / Shelf 2"
                      className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs text-slate-900 font-mono focus:outline-none focus:border-amber-600"
                    />
                  </div>

                  <div>
                    <label className="text-sm text-slate-600 font-medium block mb-0.5">Cost / Purchase Price (₹)</label>
                    <input
                      type="number"
                      required
                      min={0}
                      value={prodCostPrice}
                      onChange={e => setProdCostPrice(Number(e.target.value))}
                      className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs text-slate-900 font-mono focus:outline-none focus:border-amber-600"
                    />
                  </div>

                  <div>
                    <label className="text-sm text-slate-600 font-medium block mb-0.5">Selling Price (₹)</label>
                    <input
                      type="number"
                      required
                      min={1}
                      value={prodPrice}
                      onChange={e => setProdPrice(Number(e.target.value))}
                      className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs text-slate-900 font-mono focus:outline-none focus:border-amber-600"
                    />
                  </div>

                  <div>
                    <label className="text-sm text-slate-600 font-medium block mb-0.5">MRP Print (₹)</label>
                    <input
                      type="number"
                      required
                      min={1}
                      value={prodMrp}
                      onChange={e => setProdMrp(Number(e.target.value))}
                      className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs text-slate-900 font-mono focus:outline-none focus:border-amber-600"
                    />
                  </div>

                  <div>
                    <label className="text-sm text-slate-600 font-medium block mb-0.5">In-Stock Quantity</label>
                    <input
                      type="number"
                      min={0}
                      required
                      value={prodStock}
                      onChange={e => setProdStock(Number(e.target.value))}
                      className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs text-slate-900 font-mono focus:outline-none focus:border-amber-600"
                    />
                  </div>
                </div>

                {/* Product Image JPG / PNG Upload Section */}
                <div>
                  <label className="text-sm text-slate-700 font-semibold block mb-1 flex items-center justify-between">
                    <span>Product Image (JPG or PNG)</span>
                    <span className="text-sm text-slate-400 font-normal">Shows in Store & to Worker on active task</span>
                  </label>

                  <div className="flex flex-col sm:flex-row items-start gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
                    {/* Preview Thumbnail */}
                    <div className="w-20 h-20 rounded-lg border border-slate-300 bg-white overflow-hidden flex items-center justify-center flex-shrink-0 relative group shadow-2xs">
                      {prodImage ? (
                        <>
                          <img src={prodImage} alt="Preview" className="w-full h-full object-contain p-1" />
                          <button
                            type="button"
                            onClick={() => setProdImage('')}
                            className="absolute top-1 right-1 bg-red-600 text-white rounded-full w-4 h-4 text-sm flex items-center justify-center opacity-80 hover:opacity-100"
                            title="Remove Image"
                          >
                            ✕
                          </button>
                        </>
                      ) : (
                        <div className="text-center p-1 text-slate-400">
                          <ImageIcon className="w-6 h-6 mx-auto opacity-50" />
                          <span className="text-sm block mt-0.5">No photo</span>
                        </div>
                      )}
                    </div>

                    {/* Upload Controls & Presets */}
                    <div className="flex-1 space-y-2 w-full">
                      <div className="flex items-center gap-2">
                        <label className="cursor-pointer px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg text-slate-800 font-semibold text-sm shadow-2xs flex items-center gap-1.5 transition-all">
                          <Upload className="w-3.5 h-3.5 text-amber-600" />
                          <span>Upload JPG / PNG</span>
                          <input
                            type="file"
                            accept="image/png, image/jpeg, image/webp"
                            onChange={handleImageFileUpload}
                            className="hidden"
                          />
                        </label>
                        {prodImage && (
                          <span className="text-sm text-emerald-700 font-medium flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Image Loaded
                          </span>
                        )}
                      </div>

                      {/* Preset Quick Selectors */}
                      <div>
                        <span className="text-sm text-slate-400 block mb-1">Or choose standard OEM spare part photo:</span>
                        <div className="flex flex-wrap gap-1">
                          {[
                            { label: 'AC Motor', url: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=400&auto=format&fit=crop&q=80' },
                            { label: 'Copper Pipe', url: 'https://images.unsplash.com/photo-1504917599217-d4dc5ebe6122?w=400&auto=format&fit=crop&q=80' },
                            { label: 'PCB Board', url: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=400&auto=format&fit=crop&q=80' },
                            { label: 'Brass Valve', url: 'https://images.unsplash.com/photo-1585704032915-c3400ca199e7?w=400&auto=format&fit=crop&q=80' },
                            { label: 'Capacitor', url: 'https://images.unsplash.com/photo-1581092335397-9583fe92d232?w=400&auto=format&fit=crop&q=80' }
                          ].map(preset => (
                            <button
                              key={preset.label}
                              type="button"
                              onClick={() => setProdImage(preset.url)}
                              className="text-sm px-2 py-0.5 bg-white hover:bg-slate-200 border border-slate-300 rounded text-slate-700 font-medium"
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-sm text-slate-600 font-medium block mb-0.5">Compatibility Specs</label>
                  <input
                    type="text"
                    required
                    value={prodCompatibility}
                    onChange={e => setProdCompatibility(e.target.value)}
                    placeholder="e.g. Universal 1.5 Ton Inverter AC (LG, Samsung, Voltas)"
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs text-slate-900 focus:outline-none focus:border-amber-600"
                  />
                </div>

                <div>
                  <label className="text-sm text-slate-600 font-medium block mb-0.5">Technical Notes / Specs</label>
                  <textarea
                    rows={2}
                    value={prodDescription}
                    onChange={e => setProdDescription(e.target.value)}
                    placeholder="e.g. Copper winding, 220-240V AC, 1350 RPM with dual bearings"
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs text-slate-900 focus:outline-none focus:border-amber-600"
                  />
                </div>

                {/* Profit Margin Preview Callout */}
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 flex items-center justify-between text-sm">
                  <span className="text-slate-600 font-medium">Estimated Profit Margin:</span>
                  <span className="font-mono font-bold text-emerald-700">
                    ₹{prodPrice - prodCostPrice} ({prodPrice > 0 ? Math.round(((prodPrice - prodCostPrice) / prodPrice) * 100) : 0}%)
                  </span>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col sm:flex-row gap-2 pt-2">
                  <button
                    type="submit"
                    className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs shadow-xs flex items-center justify-center gap-1.5 transition-all"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Save & Sync to Cloud</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSubmitProductRequest}
                    className="py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs flex items-center justify-center gap-1.5 transition-all"
                    title="Submit to Company Admin for official platform catalog listing"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Send for Admin Catalog</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
      {/* GST Tax Invoice & Delivery Challan Modal */}
      {invoiceModalOrder && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-300 rounded-xl max-w-2xl w-full p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                  Original for Recipient / In-Task Procurement
                </span>
                <h3 className="text-base font-extrabold text-slate-900 mt-1">
                  TAX INVOICE & MATERIAL DELIVERY CHALLAN
                </h3>
                <p className="text-xs text-slate-500">
                  Issued under Section 31 of CGST Act, 2017 & Repaido Verified Partner Hub Rules
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-xs transition-all"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print Invoice</span>
                </button>
                <button
                  type="button"
                  onClick={() => setInvoiceModalOrder(null)}
                  className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-700 font-bold"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Invoice Printable Sheet */}
            <div className="p-4 border border-slate-200 rounded-xl bg-slate-50/50 space-y-4 text-xs font-sans">
              {/* Header Grid */}
              <div className="grid grid-cols-2 gap-4 pb-3 border-b border-slate-200">
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase">Supplier / Seller</div>
                  <div className="font-extrabold text-slate-900 text-sm">{currentShop?.shopName}</div>
                  <div className="text-slate-600 mt-0.5">{currentShop?.address || 'Main Road, Balasore, Odisha'}</div>
                  <div className="text-slate-700 font-mono mt-1">
                    GSTIN: <strong className="text-slate-900">{currentShop?.gstin || '21AABCM1234F1Z8'}</strong>
                  </div>
                  <div className="text-slate-500 font-mono">State Code: 21 (Odisha)</div>
                </div>

                <div className="text-right">
                  <div className="text-[10px] font-bold text-slate-400 uppercase">Invoice & Job Reference</div>
                  <div className="font-mono font-bold text-slate-900">
                    INV-{invoiceModalOrder.bookingId}-{Date.now().toString().slice(-4)}
                  </div>
                  <div className="text-slate-500 mt-0.5">Date: {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                  <div className="mt-1 font-mono text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 inline-block font-bold">
                    Job Booking #{invoiceModalOrder.bookingId}
                  </div>
                </div>
              </div>

              {/* Delivery Consignee */}
              <div className="bg-white p-3 rounded-lg border border-slate-200 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Field Delivery Destination</span>
                  <span className="font-semibold text-slate-800">{invoiceModalOrder.customerAddress}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Receiving Technician (Bearer)</span>
                  <span className="font-semibold text-slate-800">{invoiceModalOrder.workerName}</span>
                </div>
              </div>

              {/* Items Table */}
              <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-100 text-slate-600 text-[10.5px] font-bold uppercase tracking-wider border-b border-slate-200">
                      <th className="p-2.5">Item Description</th>
                      <th className="p-2.5">HSN Code</th>
                      <th className="p-2.5 text-center">Qty</th>
                      <th className="p-2.5 text-right">Taxable (₹)</th>
                      <th className="p-2.5 text-right">CGST 9%</th>
                      <th className="p-2.5 text-right">SGST 9%</th>
                      <th className="p-2.5 text-right">Total (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {(() => {
                      const gross = invoiceModalOrder.spare.price;
                      const taxable = Math.round((gross / 1.18) * 100) / 100;
                      const cgst = Math.round((taxable * 0.09) * 100) / 100;
                      const sgst = cgst;
                      return (
                        <tr>
                          <td className="p-2.5">
                            <div className="font-bold text-slate-900">{invoiceModalOrder.spare.name}</div>
                            <div className="text-[10.5px] text-slate-500 font-mono">SKU: {invoiceModalOrder.spare.partNumber || 'SKU-OEM'}</div>
                          </td>
                          <td className="p-2.5 font-mono font-bold text-slate-800">{invoiceModalOrder.hsnCode || '8415'}</td>
                          <td className="p-2.5 text-center font-bold">1</td>
                          <td className="p-2.5 text-right font-mono">₹{taxable.toFixed(2)}</td>
                          <td className="p-2.5 text-right font-mono">₹{cgst.toFixed(2)}</td>
                          <td className="p-2.5 text-right font-mono">₹{sgst.toFixed(2)}</td>
                          <td className="p-2.5 text-right font-mono font-bold text-slate-900">₹{gross.toFixed(2)}</td>
                        </tr>
                      );
                    })()}
                  </tbody>
                </table>
              </div>

              {/* Total Summary */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                <div className="flex items-center gap-2 bg-emerald-50 text-emerald-800 px-3 py-2 rounded-lg border border-emerald-200 text-xs">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <span>Verified by Repaido Platform · Standard Testing Warranty Attached</span>
                </div>
                <div className="text-right space-y-1 w-full sm:w-auto">
                  <div className="flex justify-between sm:justify-end gap-6 text-slate-600">
                    <span>Part Value (Incl. 18% GST):</span>
                    <strong className="font-mono text-slate-900">₹{invoiceModalOrder.spare.price}</strong>
                  </div>
                  <div className="flex justify-between sm:justify-end gap-6 text-slate-600">
                    <span>Two-Way Technician Dispatch:</span>
                    <strong className="font-mono text-slate-900">₹{invoiceModalOrder.spare.travelCharge}</strong>
                  </div>
                  <div className="flex justify-between sm:justify-end gap-6 text-base font-extrabold text-slate-900 pt-1 border-t border-slate-200">
                    <span>Total Invoice Amount:</span>
                    <strong className="font-mono text-emerald-700">
                      ₹{invoiceModalOrder.spare.price + invoiceModalOrder.spare.travelCharge}
                    </strong>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setInvoiceModalOrder(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs"
              >
                Close Preview
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="px-4 py-2 bg-[#142858] hover:bg-slate-900 text-white font-bold rounded-lg text-xs flex items-center gap-1.5 shadow-xs"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Official Copy</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* HSN & Inventory Tax Audit Modal */}
      {showHsnAuditModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-300 rounded-xl max-w-2xl w-full p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                  GST & Customs Chapter Compliance
                </span>
                <h3 className="text-base font-extrabold text-slate-900 mt-1">
                  HSN Code Audit & Stock Valuation Summary
                </h3>
                <p className="text-xs text-slate-500">
                  Automated categorization of active catalog by Indian GST Tariff Schedule
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-xs transition-all"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print Audit Sheet</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowHsnAuditModal(false)}
                  className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-700 font-bold"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* HSN Groupings Breakdown Table */}
            {(() => {
              const hsnDescriptions: Record<string, string> = {
                '8415': 'Air Conditioners & Spares (Compressors, Evaporators, Coils)',
                '8501': 'Electric Motors, Blowers & Rotors',
                '8481': 'Valves, Taps, Cocks & Plumbing Fittings',
                '8536': 'Electrical Switches, Relays, Fuses & MCB Contactors',
                '8471': 'Data Processing / Computer & PCB Assemblies',
                '8504': 'Electrical Transformers, Inductors & Static Converters',
                '8532': 'Electrical Capacitors (Dual Run & Start)',
                '8414': 'Pumps, Compressors & Exhaust Ventilation Fans'
              };

              const hsnGroups: Record<string, { count: number; totalUnits: number; totalValue: number; products: string[] }> = {};

              shopProducts.forEach(p => {
                const code = (p.hsnCode || '8415').trim();
                if (!hsnGroups[code]) {
                  hsnGroups[code] = { count: 0, totalUnits: 0, totalValue: 0, products: [] };
                }
                hsnGroups[code].count += 1;
                hsnGroups[code].totalUnits += p.stock;
                hsnGroups[code].totalValue += p.stock * p.price;
                hsnGroups[code].products.push(p.name);
              });

              const totalValuation = Object.values(hsnGroups).reduce((sum, g) => sum + g.totalValue, 0);
              const totalUnitsAll = Object.values(hsnGroups).reduce((sum, g) => sum + g.totalUnits, 0);

              return (
                <div className="space-y-4">
                  {/* Top summary cards */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                      <span className="text-[10px] font-bold text-slate-400 uppercase block">HSN Classifications</span>
                      <span className="text-lg font-mono font-extrabold text-slate-900">{Object.keys(hsnGroups).length} Chapters</span>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                      <span className="text-[10px] font-bold text-slate-400 uppercase block">Total Physical Units</span>
                      <span className="text-lg font-mono font-extrabold text-blue-700">{totalUnitsAll} Units</span>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                      <span className="text-[10px] font-bold text-slate-400 uppercase block">Stock Asset Valuation</span>
                      <span className="text-lg font-mono font-extrabold text-emerald-700">₹{totalValuation.toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-100 text-slate-600 text-[10.5px] font-bold uppercase tracking-wider border-b border-slate-200">
                          <th className="p-2.5">HSN Code</th>
                          <th className="p-2.5">Chapter & Description</th>
                          <th className="p-2.5 text-center">SKUs</th>
                          <th className="p-2.5 text-center">Stock Units</th>
                          <th className="p-2.5 text-right">Asset Valuation</th>
                          <th className="p-2.5 text-right">GST Slab</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {Object.entries(hsnGroups).map(([code, g]) => (
                          <tr key={code} className="hover:bg-slate-50/80">
                            <td className="p-2.5 font-mono font-bold text-blue-800 bg-blue-50/40">{code}</td>
                            <td className="p-2.5 text-slate-700 font-medium">
                              <div>{hsnDescriptions[code] || 'General Mechanical / Electrical Spares'}</div>
                              <div className="text-[10px] text-slate-400 mt-0.5 truncate max-w-xs">{g.products.slice(0, 2).join(', ')}{g.products.length > 2 ? '…' : ''}</div>
                            </td>
                            <td className="p-2.5 text-center font-bold text-slate-800">{g.count}</td>
                            <td className="p-2.5 text-center font-mono font-bold text-slate-800">{g.totalUnits}</td>
                            <td className="p-2.5 text-right font-mono font-bold text-emerald-700">₹{g.totalValue.toLocaleString()}</td>
                            <td className="p-2.5 text-right font-mono font-bold text-slate-700">18%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="bg-blue-50 border border-blue-200 p-3 rounded-lg text-xs text-blue-900 flex items-center justify-between">
                    <span>Need to submit this breakdown for GST filing (GSTR-1 HSN Summary Table 12)?</span>
                    <button
                      type="button"
                      onClick={handleExportInventoryCsv}
                      className="px-3 py-1 bg-blue-700 hover:bg-blue-800 text-white rounded font-bold text-xs shadow-xs"
                    >
                      Export CSV
                    </button>
                  </div>
                </div>
              );
            })()}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setShowHsnAuditModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs"
              >
                Close Audit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Stock-In / Inward Goods Modal */}
      {showQuickRestockModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
                  <Boxes className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Quick Stock-In / Inward Goods</h3>
                  <p className="text-[11px] text-slate-500">Log incoming units from distributor shipments</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowQuickRestockModal(false)}
                className="w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-700 font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-xs text-slate-700 font-bold block mb-1">Select Catalog Item / SKU</label>
                <select
                  value={quickRestockProductId}
                  onChange={e => setQuickRestockProductId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs text-slate-900 font-semibold focus:outline-none focus:border-[#003BB5]"
                >
                  {shopProducts.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} (SKU: {p.partNumber} • Current: {p.stock} units)
                    </option>
                  ))}
                </select>
              </div>

              {(() => {
                const target = shopProducts.find(p => p.id === quickRestockProductId);
                const currentStock = target ? target.stock : 0;
                const newTotal = currentStock + (Number(quickRestockQuantity) || 0);

                return (
                  <div className="space-y-3">
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex items-center justify-between">
                      <div>
                        <div className="text-[11px] text-slate-500 font-medium">Current In-Store Stock</div>
                        <div className="text-base font-extrabold text-slate-900 font-mono">{currentStock} units</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[11px] text-emerald-700 font-medium">New Total After Stock-In</div>
                        <div className="text-base font-extrabold text-emerald-700 font-mono">{newTotal} units</div>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs text-slate-700 font-bold block mb-1">Units Received / Added</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          value={quickRestockQuantity}
                          onChange={e => setQuickRestockQuantity(Math.max(1, Number(e.target.value)))}
                          className="w-24 bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs text-slate-900 font-mono font-bold focus:outline-none focus:border-[#003BB5]"
                        />
                        <div className="flex items-center gap-1">
                          {[5, 10, 20, 50].map(val => (
                            <button
                              key={val}
                              type="button"
                              onClick={() => setQuickRestockQuantity(val)}
                              className={`px-2 py-1 text-xs font-mono font-bold rounded-lg border transition-all ${
                                quickRestockQuantity === val
                                  ? 'bg-[#003BB5] text-white border-[#003BB5]'
                                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                              }`}
                            >
                              +{val}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs text-slate-700 font-bold block mb-1">
                        Supplier / Invoice Note <span className="font-normal text-slate-400">(Optional)</span>
                      </label>
                      <input
                        type="text"
                        value={quickRestockNote}
                        onChange={e => setQuickRestockNote(e.target.value)}
                        placeholder="e.g. Inv #8492 from Havells Distributor"
                        className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs text-slate-900 focus:outline-none focus:border-[#003BB5]"
                      />
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setShowQuickRestockModal(false)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteQuickRestock}
                className="px-3.5 py-1.5 bg-[#003BB5] hover:bg-[#002D8F] text-white font-bold rounded-lg text-xs flex items-center gap-1.5 shadow-2xs active:scale-95"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Confirm Stock-In</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Printable Inventory Physical Count Sheet Modal */}
      {showStockSheetModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-300 rounded-xl max-w-3xl w-full p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  Shop Floor Audit
                </span>
                <h3 className="text-base font-extrabold text-slate-900 mt-1">
                  Physical Stock Count Verification Sheet
                </h3>
                <p className="text-xs text-slate-500">
                  Printer-friendly checklist for weekly/monthly physical stock take and shelf verification
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-xs transition-all"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print Sheet</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowStockSheetModal(false)}
                  className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-700 font-bold"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Shop Details Header for Audit */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div>
                <span className="text-slate-400 font-medium block text-[10px]">Shop Name:</span>
                <span className="font-bold text-slate-900">{currentShop?.shopName || 'Shop Depot'}</span>
              </div>
              <div>
                <span className="text-slate-400 font-medium block text-[10px]">Audit Date:</span>
                <span className="font-bold text-slate-900">{new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
              </div>
              <div>
                <span className="text-slate-400 font-medium block text-[10px]">Total Catalog Items:</span>
                <span className="font-bold text-slate-900">{shopProducts.length} SKUs</span>
              </div>
              <div>
                <span className="text-slate-400 font-medium block text-[10px]">Audited By:</span>
                <span className="font-bold text-slate-900">________________</span>
              </div>
            </div>

            {/* Printable Table */}
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-bold text-[11px]">
                    <th className="p-2 w-10 text-center">#</th>
                    <th className="p-2">SKU & Part No.</th>
                    <th className="p-2">Item Description</th>
                    <th className="p-2">Shelf / Rack</th>
                    <th className="p-2 text-center w-24">System Qty</th>
                    <th className="p-2 text-center w-28 bg-slate-200/60">Physical Count</th>
                    <th className="p-2 w-28">Variance / Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-[11.5px]">
                  {shopProducts.map((p, idx) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="p-2 text-center text-slate-400 font-mono">{idx + 1}</td>
                      <td className="p-2 font-mono font-bold text-slate-800">{p.partNumber}</td>
                      <td className="p-2">
                        <div className="font-semibold text-slate-900">{p.name}</div>
                        <div className="text-[10px] text-slate-500">{p.brand || 'OEM'} • {p.category}</div>
                      </td>
                      <td className="p-2 font-mono text-slate-600">{p.binLocation || 'Rack A-1'}</td>
                      <td className="p-2 text-center font-mono font-bold text-slate-800">{p.stock}</td>
                      <td className="p-2 text-center bg-slate-50 border-x border-slate-200">
                        <span className="inline-block w-16 border-b border-dotted border-slate-400 py-1 font-mono text-center">
                          &nbsp;
                        </span>
                      </td>
                      <td className="p-2 border-b border-dotted border-slate-300"></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-200">
              <span>Repaido Physical Stock Sheet • Printed from Shop Admin Portal</span>
              <button
                type="button"
                onClick={() => setShowStockSheetModal(false)}
                className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Leaflet Google Maps Location Picker Modal */}
      <LocationPickerModal
        isOpen={isMapPickerOpen}
        onClose={() => setIsMapPickerOpen(false)}
        initialLat={shopLat}
        initialLng={shopLng}
        title="Set Exact Shop Pin Location"
        subtitle="Move pin or tap on the live Google roadmap to set your shop's official coordinates"
        onConfirmLocation={result => {
          setShopLat(result.lat);
          setShopLng(result.lng);
          if (result.city) setNewCity(result.city);
          if (result.address && !newAddress) setNewAddress(result.address);
        }}
      />
    </div>
  );
};
