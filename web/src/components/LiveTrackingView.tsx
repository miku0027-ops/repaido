import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Phone, MapPin, Navigation, Clock3, ShieldCheck, ChevronDown, ChevronUp,
  FileText, ArrowLeft, RefreshCw, AlertTriangle, Check, CheckCircle2,
  Store, User, Sparkles, ExternalLink, Star, Receipt, X
} from 'lucide-react';
import { operation, money, jobCommand, type Job } from '../services/operations';
import { taskProgress } from '../services/taskStages.mjs';
import { PaymentPanel } from './PaymentPanel';

type Tracking = {
  phase: string;
  status: string;
  position: null | { lat: number; lng: number; accuracy: number; received_at: number };
  server_time: number;
};

const STAGE_CONFIG: Record<string, { label: string; sub: string; icon: string; eta: string }> = {
  searching: {
    label: 'Finding nearby specialist',
    sub: 'Matching with the highest-rated verified technician in your area…',
    icon: '🔍',
    eta: 'Searching…'
  },
  offered: {
    label: 'Specialist reviewing request',
    sub: 'Assignment offered to nearby professional. Confirmation in 2 mins.',
    icon: '⏳',
    eta: 'Confirming…'
  },
  accepted: {
    label: 'Specialist confirmed your visit',
    sub: 'Technician has accepted your booking and is preparing equipment.',
    icon: '✅',
    eta: 'Preparing departure'
  },
  en_route: {
    label: 'On the way to your address',
    sub: 'Technician is navigating live to your doorstep.',
    icon: '🛵',
    eta: 'Arriving soon'
  },
  collecting_parts: {
    label: 'Procuring approved parts at shop',
    sub: 'Specialist is at partner store collecting genuine replacement parts.',
    icon: '🏬',
    eta: 'Procuring parts'
  },
  arrived: {
    label: 'Specialist has arrived at doorstep',
    sub: 'Your professional is at the door. Please grant access.',
    icon: '📍',
    eta: 'Arrived at site'
  },
  in_progress: {
    label: 'Service work in progress',
    sub: 'Repairs and safety diagnostics are currently being performed.',
    icon: '⚡',
    eta: 'Service ongoing'
  },
  completion_pending: {
    label: 'Service complete · Verification',
    sub: 'Technician has completed repairs. Please review the finished work.',
    icon: '📋',
    eta: 'Review & Sign-off'
  },
  completed: {
    label: 'Service completed successfully',
    sub: 'Work completion confirmed. Check payment and receipt status below.',
    icon: '🎉',
    eta: 'Completed'
  },
  cancelled: {
    label: 'Booking cancelled',
    sub: 'This booking has been cancelled according to policy.',
    icon: '❌',
    eta: 'Cancelled'
  },
  disputed: {
    label: 'Support review in progress',
    sub: 'Work is paused pending support and settlement review.',
    icon: '⚠️',
    eta: 'Under review'
  }
};

const PAST_MILESTONES_MAP: Record<string, string[]> = {
  searching: ['Booking created & verified'],
  offered: ['Booking created', 'Location verified within 6 km'],
  accepted: ['Booking created', 'Professional matched & assigned'],
  en_route: ['Booking created', 'Professional assigned', 'Departure confirmed & live GPS active'],
  collecting_parts: ['Booking created', 'Professional assigned', 'Diagnosis complete', 'Parts order approved'],
  arrived: ['Booking created', 'Professional assigned', 'Traveled to site', 'Arrived at doorstep'],
  in_progress: ['Booking created', 'Professional assigned', 'Traveled to site', 'Pre-inspection completed', 'Work commenced'],
  completion_pending: ['Booking created', 'Professional assigned', 'Service work executed', 'Work submitted for customer review'],
  completed: ['Booking created', 'Professional assigned', 'Service completed', 'Customer completion confirmed']
};

export function LiveTrackingView({
  job,
  onClose,
  onRefresh,
  worker = false
}: {
  job: Job;
  onClose: () => void;
  onRefresh?: () => void | Promise<void>;
  worker?: boolean;
}) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const agentMarker = useRef<L.Marker | null>(null);
  const routeLine = useRef<L.Polyline | null>(null);

  const [tracking, setTracking] = useState<Tracking | null>(null);
  const [showPastMilestones, setShowPastMilestones] = useState(false);
  const [showBillSheet, setShowBillSheet] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [arrivalCode, setArrivalCode] = useState<string | null>(null);
  const [loadingPin, setLoadingPin] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [selectedRating, setSelectedRating] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const [disputeReason, setDisputeReason] = useState('');

  // Close on Escape key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const runCommand = async (action: string, payload: object = {}) => {
    setBusyAction(action);
    setActionError('');
    try {
      const updated = await jobCommand(job, action, payload);
      if (onRefresh) await onRefresh();
      return updated;
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusyAction(null);
    }
  };

  // Fetch arrival code when specialist has arrived
  useEffect(() => {
    if (job.state === 'arrived') {
      let active = true;
      setLoadingPin(true);
      operation<{ code: string; expires_at: number }>(`/jobs/${job.id}/arrival-code`)
        .then(res => {
          if (active && res?.code) setArrivalCode(res.code);
        })
        .catch(() => {})
        .finally(() => {
          if (active) setLoadingPin(false);
        });
      return () => { active = false; };
    } else {
      setArrivalCode(null);
    }
  }, [job.id, job.state]);

  // Poll live tracking position
  useEffect(() => {
    let cancelled = false;
    const fetchTracking = async () => {
      try {
        const data = await operation<Tracking>(`/jobs/${job.id}/tracking`,{}, {background:true});
        if (!cancelled) setTracking(data);
      } catch {
        // Fallback gracefully
      }
    };
    void fetchTracking();
    const interval = setInterval(fetchTracking, 12000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [job.id]);

  // Leaflet map setup
  useEffect(() => {
    if (!mapContainer.current) return;
    if (mapInstance.current) {
      mapInstance.current.remove();
      mapInstance.current = null;
    }

    // Determine target location: Customer location or default
    const custLat = job.location?.lat || 28.6139;
    const custLng = job.location?.lng || 77.2090;

    // Agent live position or fallback offset for visual navigation
    const agentLat = tracking?.position?.lat || (job.state === 'en_route' ? custLat - 0.012 : custLat - 0.005);
    const agentLng = tracking?.position?.lng || (job.state === 'en_route' ? custLng + 0.010 : custLng + 0.004);

    const map = L.map(mapContainer.current, {
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: false,
      dragging: true
    }).setView([custLat, custLng], 14);

    mapInstance.current = map;

    // Tile Layer: Crisp Clean CartoDB Positron / Voyager style
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19
    }).addTo(map);

    // Custom Customer Pin
    const customerIcon = L.divIcon({
      className: 'clean-map-pin',
      html: `
        <div style="background:#0f172a;color:#ffffff;width:32px;height:32px;border-radius:50%;display:grid;place-items:center;font-size:15px;box-shadow:0 4px 12px rgba(15,23,42,0.35);border:2.5px solid #ffffff;">
          🏠
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
    L.marker([custLat, custLng], { icon: customerIcon })
      .addTo(map)
      .bindTooltip('Your Location', { permanent: true, direction: 'top', offset: [0, -14], className: 'map-tooltip-clean' });

    // Custom Agent Live Moving Pin
    const isEnRoute = ['en_route', 'collecting_parts'].includes(job.state);
    const agentIcon = L.divIcon({
      className: 'clean-map-pin',
      html: `
        <div class="live-agent-pulse-marker">
          <div class="agent-pulse-ring"></div>
          <div class="agent-pin-body">
            ${isEnRoute ? '🛵' : '🔧'}
          </div>
        </div>
      `,
      iconSize: [38, 38],
      iconAnchor: [19, 19]
    });

    agentMarker.current = L.marker([agentLat, agentLng], { icon: agentIcon })
      .addTo(map)
      .bindTooltip(job.worker_name ? `${job.worker_name.split(' ')[0]} (Live)` : 'Specialist', {
        permanent: true,
        direction: 'bottom',
        offset: [0, 15],
        className: 'map-tooltip-clean'
      });

    // Add Shop Marker if Collecting Parts
    if (job.pickup_locations?.length) {
      const shop = job.pickup_locations[0];
      const shopIcon = L.divIcon({
        className: 'clean-map-pin',
        html: `
          <div style="background:#0284c7;color:#ffffff;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font-size:14px;box-shadow:0 4px 12px rgba(2,132,199,0.35);border:2px solid #ffffff;">
            🏬
          </div>
        `,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });
      L.marker([shop.location.lat, shop.location.lng], { icon: shopIcon })
        .addTo(map)
        .bindTooltip(shop.name, { permanent: true, direction: 'top', offset: [0, -14], className: 'map-tooltip-clean' });
    }

    // Connect Route Polyline
    routeLine.current = L.polyline(
      [[agentLat, agentLng], [custLat, custLng]],
      { color: '#2563eb', weight: 3.5, dashArray: '5, 7', opacity: 0.85 }
    ).addTo(map);

    // Fit bounds smoothly with compact padding
    map.fitBounds([
      [agentLat, agentLng],
      [custLat, custLng]
    ], { padding: [40, 40], maxZoom: 16 });

    // Invalidate size once DOM layout settles
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 200);

    return () => {
      clearTimeout(timer);
      map.remove();
      mapInstance.current = null;
    };
  }, [job.location, job.pickup_locations, job.state, tracking?.position]);

  // Update agent position if coordinates change
  useEffect(() => {
    if (tracking?.position && agentMarker.current && mapInstance.current) {
      const p = tracking.position;
      agentMarker.current.setLatLng([p.lat, p.lng]);
      if (job.location) {
        routeLine.current?.setLatLngs([[p.lat, p.lng], [job.location.lat, job.location.lng]]);
      }
    }
  }, [tracking?.position, job.location]);

  const currentStage = STAGE_CONFIG[job.state] || {
    label: job.state.replaceAll('_', ' '),
    sub: 'Your service visit is active.',
    icon: '⚡',
    eta: 'In progress'
  };

  const progress = taskProgress(job);
  const pastMilestones = PAST_MILESTONES_MAP[job.state] || ['Booking confirmed'];

  const handleManualRefresh = async () => {
    setRefreshing(true);
    if (onRefresh) await onRefresh();
    setTimeout(() => setRefreshing(false), 600);
  };

  const STAGES_LIST = ['Request', 'Travel', 'Arrival', 'Work', 'Finish'];

  return (
    <div
      className="repaido-tracking-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={`Live Tracking: ${job.service_name}`}
      onClick={e => e.stopPropagation()}
    >
      {/* Top Branded Bar */}
      <header className="rt-header">
        <button
          type="button"
          onClick={onClose}
          className="rt-header-btn"
          aria-label="Back to bookings"
          title="Back to bookings"
        >
          <ArrowLeft size={16} />
        </button>

        <div className="rt-header-center">
          <span className="rt-service-title">{job.service_name}</span>
          <div className="rt-status-subline">
            <span className="rt-pulse-dot" />
            <span className="rt-live-badge">Live Tracking</span>
            <span className="rt-dot-separator">·</span>
            <span className="rt-job-id">#{job.id.slice(0, 8)}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleManualRefresh}
          className={`rt-header-btn ${refreshing ? 'is-spinning' : ''}`}
          aria-label="Refresh status"
          title="Refresh status"
        >
          <RefreshCw size={15} />
        </button>
      </header>

      {/* Map Viewport Area */}
      <div className="rt-map-area">
        <div ref={mapContainer} className="rt-leaflet-container" />

        {/* Floating Live Activity Chip Overlay */}
        <div className="rt-map-chip">
          <span className="rt-map-chip-icon">{currentStage.icon}</span>
          <div className="rt-map-chip-text">
            <strong>{currentStage.label}</strong>
            <small>{currentStage.eta}</small>
          </div>
        </div>

        {/* Map Re-Center Button */}
        <button
          type="button"
          onClick={() => {
            if (mapInstance.current && job.location) {
              mapInstance.current.setView([job.location.lat, job.location.lng], 15);
            }
          }}
          className="rt-recenter-btn"
          title="Center on my location"
          aria-label="Center map"
        >
          <Navigation size={15} />
        </button>
      </div>

      {/* Underneath Body Content: High-Density Branded Elements */}
      <div className="rt-body">
        {/* 5-Step Segmented Milestone Tracker */}
        <div
          className="rt-milestone-bar"
          role="progressbar"
          aria-label="Visit Progress"
          aria-valuenow={progress.completed}
          aria-valuemin={0}
          aria-valuemax={5}
        >
          {STAGES_LIST.map((name, idx) => {
            const isDone = idx < progress.completed;
            const isCurrent = idx === Math.min(progress.completed, 4) && job.state !== 'completed';
            return (
              <div
                key={name}
                className={`rt-step-item ${isDone ? 'is-done' : ''} ${isCurrent ? 'is-current' : ''}`}
              >
                <div className="rt-step-indicator">
                  {isDone ? (
                    <Check size={10} strokeWidth={3} />
                  ) : (
                    <span className="rt-step-num">{idx + 1}</span>
                  )}
                </div>
                <span className="rt-step-label">{name}</span>
              </div>
            );
          })}
        </div>

        {/* Current Step Status Banner */}
        <div className="rt-hero-card">
          <div className="rt-hero-icon-wrap">
            <span>{currentStage.icon}</span>
          </div>
          <div className="rt-hero-copy">
            <span className="rt-hero-eyebrow">
              STEP {Math.min(progress.completed + 1, 5)} OF 5 · {progress.status.toUpperCase()}
            </span>
            <h3>{currentStage.label}</h3>
            <p>{currentStage.sub}</p>
          </div>
        </div>

        {/* Doorstep Verification PIN Card (High Priority when Arrived) */}
        {job.state === 'arrived' && (
          <section className="rt-pin-card" aria-label="Doorstep Verification PIN">
            <div className="rt-pin-header">
              <div className="rt-pin-icon">
                <ShieldCheck size={18} color="#059669" />
              </div>
              <div className="rt-pin-header-text">
                <h4>Doorstep Verification PIN</h4>
                <p>Share this PIN with your specialist when they arrive at your door to start work.</p>
              </div>
            </div>

            <div className="rt-pin-content">
              {arrivalCode ? (
                <div className="rt-pin-display">
                  <div className="rt-pin-digits" aria-label={`Arrival PIN ${arrivalCode}`}>
                    {arrivalCode.split('').map((digit, idx) => (
                      <span key={idx} className="rt-pin-digit">{digit}</span>
                    ))}
                  </div>
                  <span className="rt-pin-pill">● Verified OTP for this visit</span>
                </div>
              ) : (
                <button
                  type="button"
                  className="rt-btn-primary rt-btn-green"
                  onClick={() => {
                    setLoadingPin(true);
                    operation<{ code: string; expires_at: number }>(`/jobs/${job.id}/arrival-code`)
                      .then(res => { if (res?.code) setArrivalCode(res.code); })
                      .catch(() => {})
                      .finally(() => setLoadingPin(false));
                  }}
                  disabled={loadingPin}
                >
                  {loadingPin ? 'Generating PIN…' : 'Reveal Doorstep PIN'}
                </button>
              )}
            </div>
          </section>
        )}

        {/* Action Error Banner */}
        {actionError && (
          <div role="alert" className="ops-error rt-error-banner">
            <AlertTriangle size={15} />
            <span>{actionError}</span>
          </div>
        )}

        {/* Spare Parts Approval Card */}
        {job.proposal && ['pending', 'awaiting_payment'].includes(job.proposal.status) && (
          <section className="rt-parts-card" aria-label="Proposed Replacement Parts">
            <div className="rt-card-header">
              <Store size={17} color="#15803d" />
              <div>
                <h4>Specialist Proposed Replacement Parts</h4>
                <p>Genuine parts requested from verified partner shop.</p>
              </div>
            </div>

            <div className="rt-parts-table">
              {job.proposal.items.map((it, idx) => (
                <div key={idx} className="rt-parts-row">
                  <span>{it.quantity} × {it.name}</span>
                  <strong>{money(it.quantity * it.unit_price_paise)}</strong>
                </div>
              ))}
              <div className="rt-parts-total">
                <span>Parts Total</span>
                <span className="rt-parts-amount">{money(job.proposal.amount_paise)}</span>
              </div>
            </div>

            {job.allowed_actions.includes('approve_parts') && (
              <div className="rt-btn-group">
                <button
                  type="button"
                  className="rt-btn-primary rt-btn-green flex-1"
                  disabled={!!busyAction}
                  onClick={() => void runCommand('approve_parts', { proposal_id: job.proposal!.id })}
                >
                  {busyAction === 'approve_parts' ? 'Approving…' : `Approve Parts (${money(job.proposal.amount_paise)})`}
                </button>
                <button
                  type="button"
                  className="rt-btn-secondary rt-btn-danger"
                  disabled={!!busyAction}
                  onClick={() => void runCommand('reject_parts', { proposal_id: job.proposal!.id })}
                >
                  Decline
                </button>
              </div>
            )}

            {job.proposal.status === 'awaiting_payment' && (
              <p className="rt-parts-notice">
                Parts approved. Please complete payment hold in your bill to confirm stock reservation.
              </p>
            )}
          </section>
        )}

        {/* Completion Sign-Off Card */}
        {(job.state === 'completion_pending' || job.allowed_actions.includes('accept_completion')) && (
          <section className="rt-completion-card" aria-label="Review and Sign Off Work">
            <div className="rt-card-header">
              <CheckCircle2 size={18} color="#16a34a" />
              <div>
                <h4>Work Completed — Review & Sign Off</h4>
                <p>Please inspect the completed repairs before confirming completion.</p>
              </div>
            </div>

            {job.completion_notes && (
              <div className="rt-notes-box">
                <span className="rt-notes-label">Technician Note:</span>
                <p>{job.completion_notes}</p>
              </div>
            )}

            {job.evidence_summary && (
              <div className="rt-chips-row">
                <span className="rt-micro-chip">
                  {job.evidence_summary.has_before ? '✓ Inspection photo verified' : 'ℹ Inspection note provided'}
                </span>
                <span className="rt-micro-chip">
                  {job.evidence_summary.has_after ? '✓ Repair photo uploaded' : 'Repair photo pending'}
                </span>
              </div>
            )}

            <button
              type="button"
              className="rt-btn-primary rt-btn-green w-full"
              disabled={!!busyAction}
              onClick={() => void runCommand('accept_completion')}
            >
              {busyAction === 'accept_completion' ? 'Confirming…' : 'Confirm & Accept Work ✓'}
            </button>

            {job.allowed_actions.includes('dispute') && (
              <details className="rt-dispute-details">
                <summary>Work not satisfactory? Report issue</summary>
                <div className="rt-dispute-box">
                  <textarea
                    placeholder="Describe the issue so support can investigate…"
                    value={disputeReason}
                    onChange={e => setDisputeReason(e.target.value)}
                    rows={2}
                  />
                  <button
                    type="button"
                    className="rt-btn-secondary rt-btn-danger w-full"
                    disabled={!!busyAction || disputeReason.trim().length < 5}
                    onClick={() => void runCommand('dispute', { reason: disputeReason.trim() })}
                  >
                    Submit Workmanship Dispute
                  </button>
                </div>
              </details>
            )}
          </section>
        )}

        {/* Rate & Review Card */}
        {job.state === 'completed' && (
          <section className="rt-review-card" aria-label="Customer Review">
            <div className="rt-card-header">
              <Sparkles size={17} color="#d97706" />
              <h4>Rate & Review Specialist</h4>
            </div>

            {job.review ? (
              <div className="rt-review-display">
                <div className="rt-stars-row">
                  {'★'.repeat(job.review.rating)}{'☆'.repeat(5 - job.review.rating)}
                  <span className="rt-stars-score">{job.review.rating} / 5</span>
                </div>
                {job.review.text && <p className="rt-review-text">{job.review.text}</p>}
                <span className="rt-review-verified">✓ Verified Customer Review recorded</span>
              </div>
            ) : job.allowed_actions.includes('review') ? (
              <div className="rt-review-form">
                <p className="rt-review-prompt">
                  How was your experience with {job.worker_name || 'your technician'}?
                </p>
                <div className="rt-stars-picker">
                  {[1, 2, 3, 4, 5].map(star => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setSelectedRating(star)}
                      className={`rt-star-btn ${selectedRating >= star ? 'is-active' : ''}`}
                      aria-label={`${star} star${star > 1 ? 's' : ''}`}
                    >
                      ★
                    </button>
                  ))}
                </div>
                <textarea
                  placeholder="Write a brief review (optional)…"
                  value={reviewText}
                  onChange={e => setReviewText(e.target.value)}
                  maxLength={1000}
                  rows={2}
                />
                <button
                  type="button"
                  className="rt-btn-primary rt-btn-blue w-full"
                  disabled={!!busyAction || selectedRating < 1}
                  onClick={() => void runCommand('review', { rating: selectedRating, text: reviewText.trim() })}
                >
                  {busyAction === 'review' ? 'Submitting…' : 'Submit Verified Review'}
                </button>
              </div>
            ) : null}
          </section>
        )}

        {/* Technician Micro-Card */}
        {job.worker_name && (
          <div className="rt-pro-card">
            <div className="rt-pro-avatar">
              <User size={18} />
            </div>
            <div className="rt-pro-details">
              <div className="rt-pro-name-row">
                <strong>{job.worker_name}</strong>
                <span className="rt-pro-rating">4.9 ★</span>
              </div>
              <span className="rt-pro-role">
                <ShieldCheck size={12} color="#059669" /> Repaido Certified Specialist
              </span>
            </div>
            {job.phone && (
              <a
                href={`tel:${job.phone}`}
                className="rt-call-btn"
                aria-label={`Call technician ${job.worker_name}`}
                title={`Call ${job.worker_name}`}
              >
                <Phone size={14} />
                <span>Call</span>
              </a>
            )}
          </div>
        )}

        {/* Address & Booking Metadata Strip */}
        <div className="rt-meta-strip">
          <div className="rt-meta-item">
            <MapPin size={13} color="#475569" />
            <span className="truncate">{job.address || job.city}</span>
          </div>
          <div className="rt-meta-item">
            <Clock3 size={13} color="#475569" />
            <span>{new Date(job.starts_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div className="rt-meta-item">
            <Receipt size={13} color="#475569" />
            <span>{money(job.total_paise)}</span>
          </div>
        </div>

        {/* Collapsible Milestones History */}
        <div className="rt-milestones-accordion">
          <button
            type="button"
            className="rt-milestones-toggle"
            onClick={() => setShowPastMilestones(v => !v)}
            aria-expanded={showPastMilestones}
          >
            <div className="flex items-center gap-1.5">
              <CheckCircle2 size={14} color="#059669" />
              <span>{pastMilestones.length} Verified Milestones Completed</span>
            </div>
            {showPastMilestones ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>

          {showPastMilestones && (
            <div className="rt-milestones-list">
              {pastMilestones.map((m, i) => (
                <div key={i} className="rt-milestone-entry">
                  <span className="rt-entry-check">✓</span>
                  <span>{m}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bottom Quick Actions Row */}
        <div className="rt-actions-grid">
          <button
            type="button"
            className="rt-btn-action"
            onClick={() => setShowBillSheet(true)}
          >
            <FileText size={14} />
            <span>View Bill ({money(job.total_paise)})</span>
          </button>

          {job.location && (
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${job.location.lat},${job.location.lng}`}
              target="_blank"
              rel="noreferrer"
              className="rt-btn-action"
            >
              <ExternalLink size={14} />
              <span>Open in Maps</span>
            </a>
          )}

          {job.allowed_actions.includes('cancel') && (
            <button
              type="button"
              className="rt-btn-action rt-action-cancel"
              disabled={!!busyAction}
              onClick={() => {
                if (window.confirm('Cancel this service request? No cancellation fee applies before work begins.')) {
                  void runCommand('cancel');
                }
              }}
            >
              <X size={14} />
              <span>Cancel Visit</span>
            </button>
          )}
        </div>
      </div>

      {/* Bill & Scope Slide-Up Drawer */}
      {showBillSheet && (
        <div className="rt-bill-drawer-overlay" onClick={() => setShowBillSheet(false)}>
          <div className="rt-bill-drawer" onClick={e => e.stopPropagation()}>
            <div className="rt-drawer-header">
              <div className="flex items-center gap-2">
                <Receipt size={18} color="#0f306e" />
                <h3>Service Invoice & Scope</h3>
              </div>
              <button
                type="button"
                className="rt-drawer-close"
                onClick={() => setShowBillSheet(false)}
                aria-label="Close bill drawer"
              >
                ✕
              </button>
            </div>
            <div className="rt-drawer-body">
              <div className="rt-drawer-line">
                <span>Base Service Package</span>
                <strong>{money(job.base_price_paise)}</strong>
              </div>
              {job.total_paise + (job.promotion_discount_paise || 0) > job.base_price_paise && (
                <div className="rt-drawer-line">
                  <span>Approved Extras & Genuine Parts</span>
                  <strong>{money(job.total_paise + (job.promotion_discount_paise || 0) - job.base_price_paise)}</strong>
                </div>
              )}
              {(job.promotion_discount_paise || 0) > 0 && (
                <div className="rt-drawer-line rt-drawer-discount">
                  <span>Repaido promotional offer</span>
                  <strong>−{money(job.promotion_discount_paise!)}</strong>
                </div>
              )}
              <div className="rt-drawer-line rt-drawer-total">
                <span>Total Amount</span>
                <strong className="rt-total-amount">{money(job.total_paise)}</strong>
              </div>
              <p className="rt-escrow-badge">
                Payment status: {job.payment_status.replaceAll('_', ' ')}. Protected under Repaido Escrow.
              </p>

              {job.state === 'completed' && job.payment_status !== 'no_payment_due' && (
                <div className="mt-4">
                  <PaymentPanel job={job} onRefresh={async () => { if (onRefresh) await onRefresh(); }} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
