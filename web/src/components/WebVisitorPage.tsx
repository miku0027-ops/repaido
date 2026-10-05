import { useState } from 'react';
import {
  Smartphone,
  Globe,
  Download,
  QrCode,
  ShieldCheck,
  CheckCircle2,
  Database,
  Server,
  Zap,
  Star,
  Clock3,
  ArrowRight,
  ExternalLink,
  ChevronRight,
  MapPin,
  Sparkles,
  Award
} from 'lucide-react';
import { categories, seededServices, formatMoney } from '../data';
import RepaidoBrand from './RepaidoBrand';

export default function WebVisitorPage({
  onLaunchApp,
  onSelectCategory
}: {
  onLaunchApp: () => void;
  onSelectCategory: (catId: string) => void;
}) {
  const [showQr, setShowQr] = useState(false);
  const popularServices = seededServices.slice(0, 4);

  return (
    <div className="web-visitor-page">
      {/* Top Banner / Announcement */}
      <div className="visitor-announcement-bar">
        <div className="page-width flex items-center justify-between gap-4 py-2 text-xs">
          <span className="flex items-center gap-2">
            <span className="live-indicator-dot" />
            <strong>Repaido Web Portal</strong> · Hosted on Firebase Blaze Plan with Hostinger / GoDaddy Custom Domain
          </span>
          <span className="hidden sm:flex items-center gap-3">
            <span className="flex items-center gap-1 font-semibold text-emerald"><Database size={13} /> Shared SQLite & FastAPI Database</span>
            <span>·</span>
            <span>Pay after service</span>
          </span>
        </div>
      </div>

      {/* Brand Navigation Header */}
      <header className="visitor-brand-nav border-b bg-white/95 backdrop-blur sticky top-0 z-30">
        <div className="page-width flex items-center justify-between py-3">
          <div className="flex items-center gap-3">
            <RepaidoBrand size="md" onClick={onLaunchApp} />
          </div>
          <div className="flex items-center gap-3">
            <button className="button-secondary text-xs py-2 px-3 sm:px-4 flex items-center gap-1.5" onClick={onLaunchApp}>
              <Smartphone size={14} className="text-accent" />
              <span>Open Mobile App</span>
            </button>
            <button className="button-primary text-xs py-2 px-3 sm:px-4" onClick={onLaunchApp}>
              Book Service
            </button>
          </div>
        </div>
      </header>

      {/* Web Visitor Hero Section */}
      <section className="visitor-hero">
        <div className="page-width visitor-hero-grid">
          <div className="visitor-hero-copy">
            <div className="visitor-badge-pill">
              <Sparkles size={13} className="text-accent" />
              <span>OFFICIAL WEB PORTAL & MOBILE PLATFORM</span>
            </div>
            <h1 className="visitor-hero-title">
              Home services, <br />
              <span className="text-accent-gradient">handled with care.</span>
            </h1>
            <p className="visitor-hero-subtitle">
              Book verified technicians and specialists within 6 km. Experience the exact same mobile layout, booking workflow, and unified database as our native Android app.
            </p>

            <div className="visitor-cta-row">
              <button className="visitor-primary-cta" onClick={onLaunchApp}>
                <Smartphone size={18} />
                <span>Launch Mobile App Experience</span>
                <ArrowRight size={17} />
              </button>

              <button
                className="visitor-secondary-cta"
                onClick={() => setShowQr(!showQr)}
                aria-expanded={showQr}
              >
                <QrCode size={18} />
                <span>Scan Mobile QR</span>
              </button>

              <a
                href="/apk/app-debug.apk"
                download="repaido-app.apk"
                className="visitor-apk-cta"
                title="Download direct Android APK"
              >
                <Download size={18} />
                <span>Download Android APK</span>
              </a>
            </div>

            {showQr && (
              <div className="qr-popup-card">
                <div className="qr-box">
                  {/* SVG QR Code Simulation */}
                  <svg viewBox="0 0 100 100" className="qr-svg" aria-label="QR Code to open Repaido on mobile">
                    <rect width="100" height="100" fill="#ffffff" rx="8" />
                    <path d="M10 10h30v30h-30z M15 15h20v20h-20z M20 20h10v10h-10z" fill="#0b132b" />
                    <path d="M60 10h30v30h-30z M65 15h20v20h-20z M70 20h10v10h-10z" fill="#0b132b" />
                    <path d="M10 60h30v30h-30z M15 65h20v20h-20z M20 70h10v10h-10z" fill="#0b132b" />
                    <circle cx="50" cy="50" r="8" fill="#003bb5" />
                    <rect x="45" y="20" width="10" height="20" fill="#0b132b" />
                    <rect x="50" y="65" width="20" height="10" fill="#0b132b" />
                    <rect x="75" y="60" width="15" height="15" fill="#0b132b" />
                    <rect x="25" y="45" width="20" height="10" fill="#0b132b" />
                  </svg>
                </div>
                <div className="qr-info">
                  <strong>Open on your Phone</strong>
                  <p className="text-xs text-muted">Scan with your smartphone camera to launch the pixel-perfect mobile layout instantly.</p>
                  <span className="text-xs font-semibold text-accent">repaido.web.app / custom domain</span>
                </div>
              </div>
            )}

            <div className="visitor-highlights-row">
              <div className="highlight-item">
                <ShieldCheck size={18} className="text-emerald" />
                <span>100% Verified Workers</span>
              </div>
              <div className="highlight-item">
                <MapPin size={18} className="text-accent" />
                <span>Strict 6 km Proximity</span>
              </div>
              <div className="highlight-item">
                <CheckCircle2 size={18} className="text-emerald" />
                <span>Pay after service</span>
              </div>
            </div>
          </div>

          {/* Interactive Mobile Device Frame Preview */}
          <div className="visitor-hero-device">
            <div className="mobile-device-mockup">
              <div className="device-speaker" />
              <div className="device-screen-preview">
                {/* Mini Header */}
                <div className="mock-top-bar">
                  <div>
                    <span className="mock-sub">YOUR LOCATION</span>
                    <strong className="mock-loc">Balasore ▾</strong>
                  </div>
                  <RepaidoBrand size="sm" />
                </div>

                {/* Mini Hero */}
                <div className="mock-hero-box">
                  <span className="mock-eyebrow">A LITTLE HELP.</span>
                  <h4 className="mock-headline">Home, handled.</h4>
                  <p className="mock-desc">Expert care. More time for you.</p>
                </div>

                {/* Mini Categories */}
                <div className="mock-categories-grid">
                  {categories.slice(1, 5).map(c => (
                    <div key={c.id} className="mock-cat-tile">
                      <div className="mock-tile-icon" />
                      <span>{c.name.split(' ')[0]}</span>
                    </div>
                  ))}
                </div>

                {/* Mini Promo Card */}
                <div className="mock-promo-card">
                  <span>YOUR WEEKEND, RECLAIMED</span>
                  <p>A fresh home. Fresh state of mind.</p>
                </div>

                {/* Open App Overlay Button */}
                <div className="mock-screen-overlay" onClick={onLaunchApp}>
                  <button className="overlay-open-btn">
                    <span>Explore Full App Interface</span>
                    <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Database & Firebase Blaze Plan Architecture Section */}
      <section className="visitor-architecture-section">
        <div className="page-width">
          <div className="section-header-center">
            <span className="micro-eyebrow">ENTERPRISE CLOUD ARCHITECTURE</span>
            <h2>Single Unified Platform: Android App & Web</h2>
            <p>Built for zero discrepancy. Web visitors and Android app customers share the identical real-time backend.</p>
          </div>

          <div className="architecture-grid">
            <div className="arch-card">
              <div className="arch-icon-box bg-blue">
                <Database size={24} className="text-accent" />
              </div>
              <h3>Shared Core Database</h3>
              <p>All bookings, technician assignments, status progressions, and catalog items sync directly to the central Repaido database.</p>
              <ul className="arch-list">
                <li><CheckCircle2 size={13} className="text-emerald" /> Unified user accounts & bookings</li>
                <li><CheckCircle2 size={13} className="text-emerald" /> Real-time slot availability</li>
                <li><CheckCircle2 size={13} className="text-emerald" /> Server-side idempotent security</li>
              </ul>
            </div>

            <div className="arch-card">
              <div className="arch-icon-box bg-orange">
                <Globe size={24} className="text-orange" />
              </div>
              <h3>Firebase Hosting on Blaze Plan</h3>
              <p>Deployable directly to project <code>repaido</code>. Ready for custom domain configuration on Hostinger or GoDaddy.</p>
              <ul className="arch-list">
                <li><CheckCircle2 size={13} className="text-emerald" /> Global CDN edge distribution</li>
                <li><CheckCircle2 size={13} className="text-emerald" /> Automatic SSL certificate on custom domain</li>
                <li><CheckCircle2 size={13} className="text-emerald" /> Seamless single-page routing (SPA)</li>
              </ul>
            </div>

            <div className="arch-card">
              <div className="arch-icon-box bg-emerald">
                <Smartphone size={24} className="text-emerald" />
              </div>
              <h3>1:1 Native Android Parity</h3>
              <p>The web layout mimics the native Kotlin / Jetpack Compose Android app down to typography, paddings, and bottom sheets.</p>
              <ul className="arch-list">
                <li><CheckCircle2 size={13} className="text-emerald" /> 4-step progressive booking flow</li>
                <li><CheckCircle2 size={13} className="text-emerald" /> Mobile-first responsive touch UI</li>
                <li><CheckCircle2 size={13} className="text-emerald" /> WCAG AAA high-contrast accessibility</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Featured Services Showcase */}
      <section className="visitor-services-showcase">
        <div className="page-width">
          <div className="flex justify-between items-end mb-6">
            <div>
              <span className="micro-eyebrow">POPULAR SERVICES</span>
              <h2 className="text-2xl font-bold text-ink">Browse top home services</h2>
            </div>
            <button className="visitor-link-btn" onClick={onLaunchApp}>
              View All 12+ Services <ArrowRight size={16} />
            </button>
          </div>

          <div className="visitor-services-grid">
            {popularServices.map(s => (
              <div key={s.id} className="visitor-service-card" onClick={() => onSelectCategory(s.category)}>
                <div className="service-card-top">
                  <div className="card-info">
                    <span className="card-cat">{categories.find(c => c.id === s.category)?.name}</span>
                    <h3 className="card-title">{s.name}</h3>
                    <div className="card-meta">
                      <span className="rating"><Star size={12} fill="currentColor" /> {s.rating || 4.8}</span>
                      <span>·</span>
                      <span className="duration"><Clock3 size={12} /> {s.duration} min</span>
                    </div>
                  </div>
                  <strong className="card-price">{formatMoney(s.price)}</strong>
                </div>
                <p className="card-desc">{s.description}</p>
                <div className="card-action-bar">
                  <span className="pay-note">Pay after service</span>
                  <span className="book-link">Book Service <ChevronRight size={15} /></span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Domain Setup Helper / Deployment Status for Hostinger & GoDaddy */}
      <section className="visitor-domain-card-section">
        <div className="page-width">
          <div className="domain-guide-box">
            <div className="domain-guide-header">
              <div>
                <span className="micro-eyebrow">FIREBASE HOSTING & DOMAIN CONNECTIVITY</span>
                <h3 className="text-lg font-bold text-ink">Hostinger & GoDaddy Custom Domain Ready</h3>
                <p className="text-xs text-muted mt-1">
                  Once deployed to Firebase project <code>repaido</code>, connect your purchased domain via Firebase Console with zero downtime.
                </p>
              </div>
              <div className="status-badge-active">
                <span>Blaze Plan Ready</span>
              </div>
            </div>

            <div className="domain-steps-grid">
              <div className="step-card">
                <span className="step-num">1</span>
                <strong>Firebase Deploy</strong>
                <p>Run <code>npm run deploy</code> to push the production bundle to Firebase Hosting.</p>
              </div>
              <div className="step-card">
                <span className="step-num">2</span>
                <strong>Add Custom Domain</strong>
                <p>In Firebase Console &gt; Hosting, click "Add Custom Domain" and type your domain name.</p>
              </div>
              <div className="step-card">
                <span className="step-num">3</span>
                <strong>Update DNS Records</strong>
                <p>Add the provided A and TXT records in Hostinger or GoDaddy DNS Manager.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="visitor-footer">
        <div className="page-width flex flex-col sm:flex-row justify-between items-center gap-4 py-8 text-xs text-muted border-t">
          <div>
            <RepaidoBrand size="md" onClick={onLaunchApp} className="mb-2" />
            <p className="mt-1">Home Services Platform · Balasore, Odisha & Pan India</p>
          </div>
          <div className="flex gap-6">
            <button className="hover:underline" onClick={onLaunchApp}>Launch App</button>
            <a href="/apk/app-debug.apk" download className="hover:underline">Android APK</a>
            <button className="hover:underline" onClick={onLaunchApp}>Technician Registration</button>
          </div>
        </div>
      </footer>
    </div>
  );
}
