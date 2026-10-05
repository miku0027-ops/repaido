import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Bell,
  X,
  CheckCheck,
  RefreshCw,
  FileText,
  FileDown,
  MapPin,
  KeyRound,
  Truck,
  Wrench,
  CheckCircle2,
  CreditCard,
  ShieldCheck,
  Sparkles,
  ShoppingBag,
  Crown,
  ChevronRight,
  Check,
  Package
} from 'lucide-react';
import { operation } from '../services/operations';
import { b2bService } from '../services/b2bService';
import type { B2BQuotation } from '../types/b2b';
import { nativeAvailable, enableNativePush, stopNativeSession } from '../services/native';
import './customer-notifications.css';

export interface RawNotification {
  id: string;
  title: string;
  body: string;
  job_id?: string;
  destination?: string;
  campaign_id?: string;
  plan_id?: string;
  quoteNumber?: string;
  rfqId?: string;
  created_at?: number;
  read_at?: number | null;
}

export type NotificationCategory = 'all' | 'b2b' | 'bookings' | 'alerts' | 'offers' | 'escrow';

export interface EnrichedNotification extends RawNotification {
  category: 'b2b' | 'arrival' | 'service' | 'completed' | 'escrow' | 'offer' | 'marketplace' | 'home' | 'general';
  themeClass: string;
  badgeLabel: string;
  actionLabel: string;
  icon: React.ReactNode;
}

interface CustomerNotificationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenJob?: (jobId: string) => void;
  onOpenQuotationModal?: (quotation: B2BQuotation) => void;
  onNavigateTab?: (tab: string, sub?: string) => void;
  onOpenPromotion?: (campaignId?: string) => void;
  onOpenHomePlan?: (planId?: string) => void;
  activeBookings?: any[];
  onUnreadCountChange?: (count: number) => void;
}

export const CustomerNotificationDrawer: React.FC<CustomerNotificationDrawerProps> = ({
  isOpen,
  onClose,
  onOpenJob,
  onOpenQuotationModal,
  onNavigateTab,
  onOpenPromotion,
  onOpenHomePlan,
  activeBookings = [],
  onUnreadCountChange
}) => {
  const [notifications, setNotifications] = useState<RawNotification[]>([]);
  const [activeFilter, setActiveFilter] = useState<NotificationCategory>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const drawerRef = useRef<HTMLDivElement>(null);

  // Load and merge all notifications
  const loadNotifications = async () => {
    setIsLoading(true);
    setStatusMessage('');
    try {
      // 1. Fetch backend notifications
      const backendRes = await operation<{ notifications: RawNotification[] }>('/notifications')
        .catch(() => ({ notifications: [] as RawNotification[] }));
      const backendNotifs = backendRes.notifications || [];

      // 2. Fetch B2B notifications from b2bService
      const b2bNotifs: RawNotification[] = b2bService.getB2BNotifications();

      // 3. Fallback / curated showcase notifications if list is sparse
      const fallbackNotifs: RawNotification[] = [
        {
          id: 'notif-offer-puja-55',
          title: 'Festive Durga Puja Wholesale & Home Deal: Up to 55% OFF',
          body: 'Special discounts on AC Deep Clean & Electrical Maintenance packages with 6-month Repaido warranty coverage.',
          destination: 'promotion',
          campaign_id: 'puja-festive-55',
          created_at: Math.floor(Date.now() / 1000) - 1800,
          read_at: null
        },
        {
          id: 'notif-b2b-escrow-trust',
          title: 'Repaido B2B Escrow Guarantee Active',
          body: 'All bulk purchases, distributor orders, and commercial quotations are 100% protected under our 48-Hour Inspection Escrow.',
          destination: 'b2b_quotation',
          created_at: Math.floor(Date.now() / 1000) - 7200,
          read_at: null
        }
      ];

      // 4. Synthesize active booking notifications from live records if available
      const bookingNotifs: RawNotification[] = (activeBookings || []).map(b => {
        const isArrived = b.status === 'arrived';
        const isEnRoute = b.status === 'on_the_way';
        const isCompleted = b.status === 'completed';
        const title = isArrived
          ? `Technician Arrived for ${b.service_name || 'Booking'}`
          : isEnRoute
          ? `Technician En Route for ${b.service_name || 'Booking'}`
          : isCompleted
          ? `Service Completed: ${b.service_name || 'Booking'}`
          : `Booking Confirmed: ${b.service_name || 'Booking'}`;

        const body = isArrived
          ? `Technician is outside. Please provide your 4-digit doorstep PIN ${b.doorstep_pin || '••••'} to start work.`
          : isEnRoute
          ? `Technician has started travelling to your address. Live tracking is active.`
          : isCompleted
          ? `Service completed. Review invoice & rate technician experience.`
          : `Visit scheduled for ${b.service_name || 'home service'}. Dedicated pro assigned.`;

        return {
          id: `notif-booking-${b.id}`,
          job_id: b.id,
          title,
          body,
          destination: isArrived ? 'arrival' : 'booking',
          created_at: Math.floor(Date.now() / 1000) - 600,
          read_at: null
        };
      });

      // Merge and deduplicate by id
      const map = new Map<string, RawNotification>();
      [...b2bNotifs, ...backendNotifs, ...bookingNotifs, ...fallbackNotifs].forEach(item => {
        if (!map.has(item.id)) {
          map.set(item.id, item);
        }
      });

      const merged = Array.from(map.values()).sort(
        (a, b) => (b.created_at || 0) - (a.created_at || 0)
      );

      setNotifications(merged);

      // Compute unread count
      const unreadCount = merged.filter(n => !n.read_at).length;
      if (onUnreadCountChange) onUnreadCountChange(unreadCount);
    } catch {
      // Offline fallback
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void loadNotifications();
    }
  }, [isOpen]);

  // Listen to B2B notification events
  useEffect(() => {
    const handleB2BNotif = () => {
      void loadNotifications();
    };
    window.addEventListener('repaido:b2b:notification', handleB2BNotif);
    const unsub = b2bService.subscribe(handleB2BNotif);
    return () => {
      window.removeEventListener('repaido:b2b:notification', handleB2BNotif);
      unsub();
    };
  }, []);

  // Keyboard accessibility: Escape key dismisses drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Mark a single notification as read
  const handleMarkAsRead = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    // 1. Update local state immediately
    setNotifications(prev =>
      prev.map(n => (n.id === id ? { ...n, read_at: Math.floor(Date.now() / 1000) } : n))
    );

    // 2. Persist to B2B service or backend
    if (id.startsWith('notif-b2b')) {
      b2bService.markNotificationRead(id);
    } else {
      try {
        await operation(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
      } catch {
        // Offline / local fallback
      }
    }

    // 3. Update unread count
    const updatedUnread = notifications.filter(n => n.id !== id && !n.read_at).length;
    if (onUnreadCountChange) onUnreadCountChange(updatedUnread);
  };

  // Mark all notifications as read
  const handleMarkAllAsRead = async () => {
    const now = Math.floor(Date.now() / 1000);
    setNotifications(prev => prev.map(n => ({ ...n, read_at: n.read_at || now })));
    b2bService.markAllNotificationsRead();

    try {
      await operation('/notifications/read-all', { method: 'POST' });
    } catch {
      // Fallback
    }

    if (onUnreadCountChange) onUnreadCountChange(0);
  };

  // Enrich notification with color theme, icons, and micro typography tags
  const enrichedList: EnrichedNotification[] = useMemo(() => {
    return notifications.map(n => {
      const text = `${n.title} ${n.body}`.toLowerCase();

      // Explicit Destination Checks
      if (n.destination === 'promotion' || Boolean(n.campaign_id)) {
        return {
          ...n,
          category: 'offer',
          themeClass: 'notif-theme-offer',
          badgeLabel: 'FESTIVE OFFER',
          actionLabel: 'Claim Offer',
          icon: <Sparkles size={14} />
        };
      }

      if (n.destination === 'exchange' || n.destination === 'second_hand') {
        return {
          ...n,
          category: 'marketplace',
          themeClass: 'notif-theme-marketplace',
          badgeLabel: 'MARKETPLACE',
          actionLabel: 'Browse Marketplace',
          icon: <ShoppingBag size={14} />
        };
      }

      if (n.destination === 'b2b_quotation' || n.id.startsWith('notif-b2b') || Boolean(n.quoteNumber)) {
        return {
          ...n,
          category: 'b2b',
          themeClass: 'notif-theme-b2b',
          badgeLabel: 'B2B QUOTATION',
          actionLabel: n.quoteNumber ? 'View Quotation PDF & Deal' : 'Open B2B Hub',
          icon: <FileText size={14} />
        };
      }

      if (n.destination === 'arrival') {
        return {
          ...n,
          category: 'arrival',
          themeClass: 'notif-theme-arrival',
          badgeLabel: 'DOORSTEP ARRIVAL',
          actionLabel: 'Doorstep PIN & Tracking',
          icon: <MapPin size={14} />
        };
      }

      if (n.destination === 'wallet') {
        return {
          ...n,
          category: 'escrow',
          themeClass: 'notif-theme-escrow',
          badgeLabel: 'ESCROW & BILLING',
          actionLabel: 'View Payment Details',
          icon: <CreditCard size={14} />
        };
      }

      if (n.destination === 'home_plan' || Boolean(n.plan_id)) {
        return {
          ...n,
          category: 'home',
          themeClass: 'notif-theme-home',
          badgeLabel: 'REPAIDO HOME',
          actionLabel: 'View Home Plan',
          icon: <Crown size={14} />
        };
      }

      // Keyword / Heuristic Checks for unlabelled notices
      if (/completed|finished|service summary/i.test(text)) {
        return {
          ...n,
          category: 'completed',
          themeClass: 'notif-theme-completed',
          badgeLabel: 'COMPLETED',
          actionLabel: 'View Invoice & Bill',
          icon: <CheckCircle2 size={14} />
        };
      }

      if (/b2b quotation|wholesale rfq|bulk quotation|bulk deal|wholesale quote/i.test(text)) {
        return {
          ...n,
          category: 'b2b',
          themeClass: 'notif-theme-b2b',
          badgeLabel: 'B2B QUOTATION',
          actionLabel: 'Open B2B Hub',
          icon: <FileText size={14} />
        };
      }

      if (/arrived|doorstep|security code|verify code/i.test(text)) {
        return {
          ...n,
          category: 'arrival',
          themeClass: 'notif-theme-arrival',
          badgeLabel: 'DOORSTEP ARRIVAL',
          actionLabel: 'Doorstep PIN & Tracking',
          icon: <MapPin size={14} />
        };
      }

      if (n.job_id || n.destination === 'booking' || /technician|en route|on the way|in progress|dispatched/i.test(text)) {
        return {
          ...n,
          category: 'service',
          themeClass: 'notif-theme-service',
          badgeLabel: 'LIVE SERVICE',
          actionLabel: 'Track Technician',
          icon: <Truck size={14} />
        };
      }

      if (/paid|escrow|refund|invoice|transaction|cashback/i.test(text)) {
        return {
          ...n,
          category: 'escrow',
          themeClass: 'notif-theme-escrow',
          badgeLabel: 'ESCROW & BILLING',
          actionLabel: 'View Payment Details',
          icon: <CreditCard size={14} />
        };
      }

      if (/offer|discount|promo|festive|puja|deal|save/i.test(text)) {
        return {
          ...n,
          category: 'offer',
          themeClass: 'notif-theme-offer',
          badgeLabel: 'FESTIVE OFFER',
          actionLabel: 'Claim Offer',
          icon: <Sparkles size={14} />
        };
      }

      if (/marketplace|spare|used|exchange/i.test(text)) {
        return {
          ...n,
          category: 'marketplace',
          themeClass: 'notif-theme-marketplace',
          badgeLabel: 'MARKETPLACE',
          actionLabel: 'Browse Marketplace',
          icon: <ShoppingBag size={14} />
        };
      }

      if (/repaido home|membership/i.test(text)) {
        return {
          ...n,
          category: 'home',
          themeClass: 'notif-theme-home',
          badgeLabel: 'REPAIDO HOME',
          actionLabel: 'View Home Plan',
          icon: <Crown size={14} />
        };
      }

      // Default General
      return {
        ...n,
        category: 'general',
        themeClass: 'notif-theme-service',
        badgeLabel: 'NOTIFICATION',
        actionLabel: 'View Details',
        icon: <Bell size={14} />
      };
    });
  }, [notifications]);

  // Filter list by selected tab
  const filteredList = useMemo(() => {
    if (activeFilter === 'all') return enrichedList;
    if (activeFilter === 'b2b') return enrichedList.filter(n => n.category === 'b2b');
    if (activeFilter === 'bookings') {
      return enrichedList.filter(n => ['service', 'arrival', 'completed'].includes(n.category));
    }
    if (activeFilter === 'alerts') return enrichedList.filter(n => n.category === 'arrival');
    if (activeFilter === 'offers') return enrichedList.filter(n => n.category === 'offer');
    if (activeFilter === 'escrow') return enrichedList.filter(n => n.category === 'escrow');
    return enrichedList;
  }, [enrichedList, activeFilter]);

  // Counts for filter pills
  const counts = useMemo(() => {
    return {
      all: enrichedList.length,
      b2b: enrichedList.filter(n => n.category === 'b2b').length,
      bookings: enrichedList.filter(n => ['service', 'arrival', 'completed'].includes(n.category)).length,
      alerts: enrichedList.filter(n => n.category === 'arrival').length,
      offers: enrichedList.filter(n => n.category === 'offer').length,
      escrow: enrichedList.filter(n => n.category === 'escrow').length
    };
  }, [enrichedList]);

  const unreadTotal = enrichedList.filter(n => !n.read_at).length;

  // Primary Action Click Dispatcher
  const handleActionClick = (n: EnrichedNotification) => {
    void handleMarkAsRead(n.id);

    // 1. B2B Quotation Action
    if (n.category === 'b2b') {
      if (n.quoteNumber) {
        const quotation = b2bService.getQuotationByNumber(n.quoteNumber);
        if (quotation && onOpenQuotationModal) {
          onClose();
          onOpenQuotationModal(quotation);
          return;
        }
      }
      onClose();
      if (onNavigateTab) onNavigateTab('ShopSpares', 'b2b');
      else window.location.assign('/?tab=ShopSpares&marketSub=b2b');
      return;
    }

    // 2. Doorstep Arrival / Booking
    if (n.job_id) {
      onClose();
      if (onOpenJob) onOpenJob(n.job_id);
      else if (onNavigateTab) onNavigateTab('Bookings');
      return;
    }

    // 3. Festive Offer / Promotion
    if (n.destination === 'promotion' || n.category === 'offer') {
      onClose();
      if (onOpenPromotion) onOpenPromotion(n.campaign_id);
      else if (n.campaign_id) window.location.assign(`/?campaign=${encodeURIComponent(n.campaign_id)}`);
      return;
    }

    // 4. Repaido Home Plan
    if (n.destination === 'home_plan' || n.category === 'home') {
      onClose();
      if (onOpenHomePlan) onOpenHomePlan(n.plan_id);
      else window.location.assign(`/?home-plan=${encodeURIComponent(n.plan_id || '')}`);
      return;
    }

    // 5. Marketplace
    if (n.destination === 'exchange' || n.destination === 'second_hand' || n.category === 'marketplace') {
      onClose();
      if (onNavigateTab) onNavigateTab('ShopSpares', n.destination || 'spares');
      else window.location.assign(`/?market=${n.destination || 'spares'}`);
      return;
    }

    // 6. Escrow / Wallet
    if (n.category === 'escrow') {
      onClose();
      if (onNavigateTab) onNavigateTab('You');
      return;
    }

    onClose();
  };

  // Format timestamp into clean micro label (e.g. "12m ago", "2h ago", "Yesterday")
  const formatTime = (ts?: number) => {
    if (!ts) return 'Just now';
    const now = Math.floor(Date.now() / 1000);
    const diff = Math.max(0, now - ts);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 172800) return 'Yesterday';
    return `${Math.floor(diff / 86400)}d ago`;
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Semi-transparent frosted backdrop with click-to-dismiss */}
      <div
        className="repaido-notif-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Side-wise Notification Bar Panel */}
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Service updates & notifications"
        className="repaido-notif-drawer-panel"
      >
        {/* Header Bar */}
        <div className="notif-drawer-header">
          <div className="notif-drawer-brand">
            <div className="notif-drawer-brand-icon">
              <Bell size={15} />
            </div>
            <div>
              <h2 className="notif-drawer-title">Notifications</h2>
            </div>
            {unreadTotal > 0 ? (
              <span className="notif-unread-count-pill">
                {unreadTotal} New
              </span>
            ) : (
              <span className="text-[10px] text-slate-400 font-semibold">
                Caught up
              </span>
            )}
          </div>

          <div className="notif-header-actions">
            {unreadTotal > 0 && (
              <button
                type="button"
                className="notif-header-btn"
                onClick={handleMarkAllAsRead}
                title="Mark all as read"
                aria-label="Mark all as read"
              >
                <CheckCheck size={13} className="text-emerald-600" />
                <span>Mark all read</span>
              </button>
            )}

            <button
              type="button"
              className="notif-header-btn"
              onClick={loadNotifications}
              disabled={isLoading}
              title="Refresh notifications"
              aria-label="Refresh notifications"
            >
              <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
            </button>

            <button
              type="button"
              className="notif-header-close-btn"
              onClick={onClose}
              title="Close panel (Esc)"
              aria-label="Close notification panel"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Micro Category Filter Tabs */}
        <div className="notif-filter-bar">
          <button
            type="button"
            className={`notif-filter-chip ${activeFilter === 'all' ? 'active' : ''}`}
            onClick={() => setActiveFilter('all')}
          >
            <span>All</span>
            <span className="notif-chip-counter">{counts.all}</span>
          </button>

          {counts.b2b > 0 && (
            <button
              type="button"
              className={`notif-filter-chip ${activeFilter === 'b2b' ? 'active' : ''}`}
              onClick={() => setActiveFilter('b2b')}
            >
              <span>B2B Quotes</span>
              <span className="notif-chip-counter">{counts.b2b}</span>
            </button>
          )}

          {counts.bookings > 0 && (
            <button
              type="button"
              className={`notif-filter-chip ${activeFilter === 'bookings' ? 'active' : ''}`}
              onClick={() => setActiveFilter('bookings')}
            >
              <span>Bookings</span>
              <span className="notif-chip-counter">{counts.bookings}</span>
            </button>
          )}

          {counts.alerts > 0 && (
            <button
              type="button"
              className={`notif-filter-chip ${activeFilter === 'alerts' ? 'active' : ''}`}
              onClick={() => setActiveFilter('alerts')}
            >
              <span>Arrivals</span>
              <span className="notif-chip-counter">{counts.alerts}</span>
            </button>
          )}

          {counts.offers > 0 && (
            <button
              type="button"
              className={`notif-filter-chip ${activeFilter === 'offers' ? 'active' : ''}`}
              onClick={() => setActiveFilter('offers')}
            >
              <span>Offers</span>
              <span className="notif-chip-counter">{counts.offers}</span>
            </button>
          )}

          {counts.escrow > 0 && (
            <button
              type="button"
              className={`notif-filter-chip ${activeFilter === 'escrow' ? 'active' : ''}`}
              onClick={() => setActiveFilter('escrow')}
            >
              <span>Escrow</span>
              <span className="notif-chip-counter">{counts.escrow}</span>
            </button>
          )}
        </div>

        {/* Status message */}
        {statusMessage && (
          <div className="px-3 py-1.5 bg-emerald-50 border-b border-emerald-100 text-[11px] text-emerald-800 flex items-center justify-between">
            <span>{statusMessage}</span>
            <button onClick={() => setStatusMessage('')} className="text-emerald-600 hover:text-emerald-900">
              <X size={12} />
            </button>
          </div>
        )}

        {/* Notification Feed List */}
        <div className="notif-feed-container">
          {filteredList.length === 0 ? (
            <div className="notif-empty-state">
              <div className="notif-empty-icon">
                <Bell size={22} />
              </div>
              <h3 className="notif-empty-title">All caught up!</h3>
              <p className="notif-empty-desc">
                {activeFilter === 'all'
                  ? 'No new notifications right now. Service updates, B2B wholesale quotations, and doorstep PINs will appear here.'
                  : `No notifications found under the "${activeFilter}" category.`}
              </p>
            </div>
          ) : (
            filteredList.map(item => {
              const isUnread = !item.read_at;
              return (
                <article
                  key={item.id}
                  className={`notif-card ${item.themeClass} ${isUnread ? 'is-unread' : ''}`}
                  onClick={() => handleActionClick(item)}
                >
                  {/* Top micro metadata strip */}
                  <div className="notif-card-header">
                    <div className="notif-card-header-left">
                      <span className="notif-micro-tag">
                        {item.badgeLabel}
                      </span>
                      {isUnread && <span className="notif-unread-dot" title="Unread" />}
                    </div>
                    <span className="notif-time">
                      {formatTime(item.created_at)}
                    </span>
                  </div>

                  {/* Body with micro icon box and refined text */}
                  <div className="notif-card-body">
                    <div className="notif-icon-box">
                      {item.icon}
                    </div>
                    <div className="notif-text-content">
                      <h4 className="notif-card-title">
                        {item.title}
                      </h4>
                      <p className="notif-card-desc">
                        {item.body}
                      </p>
                    </div>
                  </div>

                  {/* Micro action row */}
                  <div className="notif-card-actions">
                    <button
                      type="button"
                      className="notif-action-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleActionClick(item);
                      }}
                    >
                      {item.category === 'b2b' && <FileDown size={11} />}
                      <span>{item.actionLabel}</span>
                      <ChevronRight size={11} />
                    </button>

                    {isUnread && (
                      <button
                        type="button"
                        className="notif-mark-read-btn"
                        onClick={(e) => handleMarkAsRead(item.id, e)}
                        title="Mark as read"
                        aria-label="Mark notification as read"
                      >
                        <Check size={12} />
                      </button>
                    )}
                  </div>
                </article>
              );
            })
          )}
        </div>

        {/* Micro push settings footer */}
        <div className="notif-drawer-footer">
          <p className="notif-footer-text">
            <ShieldCheck size={13} className="text-emerald-600" />
            <span>Repaido Smart Notification Relay</span>
          </p>

          {nativeAvailable() && (
            <button
              type="button"
              className="notif-push-toggle-btn"
              onClick={async () => {
                try {
                  await enableNativePush();
                  setStatusMessage('Device push notifications enabled.');
                } catch (e) {
                  setStatusMessage((e as Error).message);
                }
              }}
            >
              Device Push
            </button>
          )}
        </div>
      </aside>
    </>
  );
};

export default CustomerNotificationDrawer;
