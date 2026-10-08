import React, { useEffect, useState, useRef, useMemo } from 'react';
import type {Promotion} from './Promotions';
import type { CategoryId } from '../types';
import { useCustomerBrowseHydration } from '../services/customerBrowseTracker';
import './home-services-grid.css';

export interface ServiceSlide {
  id: string;
  type: 'base' | 'attribute' | 'offer';
  title: string;
  badge: string;
  badgeTheme: 'emerald' | 'sky' | 'amber' | 'rose' | 'purple' | 'flame';
  graphicKey?: string;
  image?: string;
  subLabel: string;
  isOffer?: boolean;
}

export interface HomeServiceConfig {
  id: string;
  categoryId: CategoryId;
  name: string;
  accentColor: string;
  glowColor: string;
  intervalMs: number;
  initialDelayMs: number;
  slides: ServiceSlide[];
}

export const homeServicesData: HomeServiceConfig[] = [
  {
    id: 'cleaning',
    categoryId: 'cleaning',
    name: 'Home Cleaning',
    accentColor: '#059669',
    glowColor: 'rgba(5, 150, 105, 0.28)',
    intervalMs: 3500,
    initialDelayMs: 0,
    slides: [
      {
        id: 'clean-base',
        type: 'base',
        title: 'Home Cleaning',
        badge: '⭐ 4.9 (2.4k+)',
        badgeTheme: 'emerald',
        image: '/images/icon-cleaning.png',
        subLabel: 'Deep Home Clean'
      },
      {
        id: 'clean-kitchen',
        type: 'attribute',
        title: 'Kitchen & Bath',
        badge: 'Sparkling Clean',
        badgeTheme: 'sky',
        graphicKey: 'kitchen-bath',
        subLabel: 'Oil & Lime Descale'
      },
      {
        id: 'clean-offer-1',
        type: 'offer',
        title: 'Home Cleaning',
        badge: 'FESTIVE SALE',
        badgeTheme: 'amber',
        graphicKey: 'offer-discount-25',
        subLabel: '⚡ Flat 25% OFF',
        isOffer: true
      },
      {
        id: 'clean-sofa',
        type: 'attribute',
        title: 'Sofa & Fabric',
        badge: 'Fabric Safe',
        badgeTheme: 'purple',
        graphicKey: 'sofa-carpet',
        subLabel: 'Shampoo & Stain Lift'
      },
      {
        id: 'clean-offer-2',
        type: 'offer',
        title: 'Home Cleaning',
        badge: 'BEST VALUE',
        badgeTheme: 'rose',
        graphicKey: 'offer-price-299',
        subLabel: '🏷️ Starts @ ₹299',
        isOffer: true
      }
    ]
  },
  {
    id: 'plumber',
    categoryId: 'plumber',
    name: 'Plumbing',
    accentColor: '#0284c7',
    glowColor: 'rgba(2, 132, 199, 0.28)',
    intervalMs: 4300,
    initialDelayMs: 1300,
    slides: [
      {
        id: 'plumb-base',
        type: 'base',
        title: 'Plumbing',
        badge: '⚡ 15m Arrival',
        badgeTheme: 'sky',
        image: '/images/icon-plumbing.png',
        subLabel: 'Leak & Tap Repair'
      },
      {
        id: 'plumb-tank',
        type: 'attribute',
        title: 'Motor & Tank',
        badge: 'Jet Pressure',
        badgeTheme: 'emerald',
        graphicKey: 'pump-tank',
        subLabel: 'Tank Flush & Motor'
      },
      {
        id: 'plumb-offer-1',
        type: 'offer',
        title: 'Plumbing',
        badge: 'COMBO PACK',
        badgeTheme: 'amber',
        graphicKey: 'offer-combo-150',
        subLabel: '⚡ Flat ₹150 OFF',
        isOffer: true
      },
      {
        id: 'plumb-drain',
        type: 'attribute',
        title: 'Drains & Pipes',
        badge: 'Zero Blockage',
        badgeTheme: 'purple',
        graphicKey: 'drain-bath',
        subLabel: 'Shower & Pipe Fix'
      },
      {
        id: 'plumb-offer-2',
        type: 'offer',
        title: 'Plumbing',
        badge: 'FEE WAIVED',
        badgeTheme: 'rose',
        graphicKey: 'offer-visit-99',
        subLabel: '🏷️ ₹99 Visit Fee',
        isOffer: true
      }
    ]
  },
  {
    id: 'electrician',
    categoryId: 'electrician',
    name: 'Electrician',
    accentColor: '#d97706',
    glowColor: 'rgba(217, 119, 6, 0.28)',
    intervalMs: 3900,
    initialDelayMs: 2600,
    slides: [
      {
        id: 'elec-base',
        type: 'base',
        title: 'Electrician',
        badge: 'Govt Certified',
        badgeTheme: 'amber',
        image: '/images/icon-electrician.png',
        subLabel: 'Wiring & Switches'
      },
      {
        id: 'elec-mcb',
        type: 'attribute',
        title: 'MCB & Inverter',
        badge: 'Surge Safe',
        badgeTheme: 'sky',
        graphicKey: 'inverter-mcb',
        subLabel: 'Inverter & Breakers'
      },
      {
        id: 'elec-offer-1',
        type: 'offer',
        title: 'Electrician',
        badge: 'SAFETY PACK',
        badgeTheme: 'flame',
        graphicKey: 'offer-shield-20',
        subLabel: '⚡ Flat 20% OFF',
        isOffer: true
      },
      {
        id: 'elec-geyser',
        type: 'attribute',
        title: 'Geyser & Lights',
        badge: 'Shockproof',
        badgeTheme: 'purple',
        graphicKey: 'geyser-smart',
        subLabel: 'Smart LED & Geyser'
      },
      {
        id: 'elec-offer-2',
        type: 'offer',
        title: 'Electrician',
        badge: 'FIXED PRICING',
        badgeTheme: 'emerald',
        graphicKey: 'offer-rate-149',
        subLabel: '🏷️ Starts @ ₹149',
        isOffer: true
      }
    ]
  },
  {
    id: 'ac',
    categoryId: 'ac',
    name: 'Appliance Repair',
    accentColor: '#2563eb',
    glowColor: 'rgba(37, 99, 235, 0.28)',
    intervalMs: 4700,
    initialDelayMs: 700,
    slides: [
      {
        id: 'app-base',
        type: 'base',
        title: 'Appliance Repair',
        badge: 'All Brands',
        badgeTheme: 'sky',
        image: '/images/icon-appliance.png',
        subLabel: 'Washing Machine Fix'
      },
      {
        id: 'app-ac',
        type: 'attribute',
        title: 'AC Jet Clean',
        badge: 'Deep Foam Jet',
        badgeTheme: 'emerald',
        graphicKey: 'ac-cooling',
        subLabel: 'Gas Refill & Cooling'
      },
      {
        id: 'app-offer-1',
        type: 'offer',
        title: 'Appliance Repair',
        badge: 'SUMMER SAVER',
        badgeTheme: 'amber',
        graphicKey: 'offer-saver-300',
        subLabel: '⚡ Save ₹300 on AC',
        isOffer: true
      },
      {
        id: 'app-fridge',
        type: 'attribute',
        title: 'Fridge & Oven',
        badge: 'Genuine Spares',
        badgeTheme: 'purple',
        graphicKey: 'fridge-micro',
        subLabel: 'Compressor & Board'
      },
      {
        id: 'app-offer-2',
        type: 'offer',
        title: 'Appliance Repair',
        badge: 'REPAIDO SHIELD',
        badgeTheme: 'rose',
        graphicKey: 'offer-warranty-90',
        subLabel: '🛡️ 90-Day Free Warranty',
        isOffer: true
      }
    ]
  },
  {
    id: 'car',
    categoryId: 'car',
    name: 'Vehicle Road Assistance',
    accentColor: '#ea580c',
    glowColor: 'rgba(234, 88, 12, 0.28)',
    intervalMs: 4100,
    initialDelayMs: 1900,
    slides: [
      {
        id: 'veh-base',
        type: 'base',
        title: 'Road Assistance',
        badge: '🚨 20m Arrival',
        badgeTheme: 'flame',
        image: '/images/icon-vehicle.png',
        subLabel: '24/7 Rapid Towing'
      },
      {
        id: 'veh-jump',
        type: 'attribute',
        title: 'Battery & Tyre',
        badge: 'On-Spot Fix',
        badgeTheme: 'amber',
        graphicKey: 'jumpstart-tyre',
        subLabel: 'Jumpstart & Puncture'
      },
      {
        id: 'veh-offer-1',
        type: 'offer',
        title: 'Road Assistance',
        badge: 'HIGHWAY SOS',
        badgeTheme: 'rose',
        graphicKey: 'offer-sos-30',
        subLabel: '⚡ Flat 30% OFF',
        isOffer: true
      },
      {
        id: 'veh-fuel',
        type: 'attribute',
        title: 'Fuel & Lockout',
        badge: 'Emergency SOS',
        badgeTheme: 'sky',
        graphicKey: 'fuel-lockout',
        subLabel: 'Fuel Can & Key Rescue'
      },
      {
        id: 'veh-offer-2',
        type: 'offer',
        title: 'Road Assistance',
        badge: 'ZERO SURCHARGE',
        badgeTheme: 'emerald',
        graphicKey: 'offer-fare-199',
        subLabel: '🏷️ Starts @ ₹199',
        isOffer: true
      }
    ]
  },
  {
    id: 'gardening',
    categoryId: 'cleaning',
    name: 'Gardening Help',
    accentColor: '#10b981',
    glowColor: 'rgba(16, 185, 129, 0.28)',
    intervalMs: 4500,
    initialDelayMs: 3100,
    slides: [
      {
        id: 'gard-base',
        type: 'base',
        title: 'Gardening Help',
        badge: '🌿 100% Organic',
        badgeTheme: 'emerald',
        image: '/images/icon-gardening.png',
        subLabel: 'Lawn & Balcony Care'
      },
      {
        id: 'gard-prune',
        type: 'attribute',
        title: 'Pruning & Trim',
        badge: 'Designer Topiary',
        badgeTheme: 'sky',
        graphicKey: 'pruning-trim',
        subLabel: 'Hedges & Sculpting'
      },
      {
        id: 'gard-offer-1',
        type: 'offer',
        title: 'Gardening Help',
        badge: 'GREEN HOME',
        badgeTheme: 'amber',
        graphicKey: 'offer-green-20',
        subLabel: '⚡ Flat 20% OFF',
        isOffer: true
      },
      {
        id: 'gard-soil',
        type: 'attribute',
        title: 'Soil & Pest',
        badge: 'Pet Safe',
        badgeTheme: 'purple',
        graphicKey: 'soil-pest',
        subLabel: 'Organic Manure & Neem'
      },
      {
        id: 'gard-offer-2',
        type: 'offer',
        title: 'Gardening Help',
        badge: 'MONTHLY PASS',
        badgeTheme: 'flame',
        graphicKey: 'offer-pass-249',
        subLabel: '🏷️ Starts @ ₹249',
        isOffer: true
      }
    ]
  }
];

// Rich 3D SVG Graphics Renderer
function ServiceGraphicArt({ graphicKey }: { graphicKey?: string }) {
  if (!graphicKey) return null;

  switch (graphicKey) {
    case 'kitchen-bath':
      return (
        <svg viewBox="0 0 64 64" fill="none" className="repaido-service-svg-art" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="kb-tile" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
              <stop stopColor="#e0f2fe" />
              <stop offset="1" stopColor="#bae6fd" />
            </linearGradient>
            <linearGradient id="kb-faucet" x1="20" y1="12" x2="44" y2="36" gradientUnits="userSpaceOnUse">
              <stop stopColor="#94a3b8" />
              <stop offset="0.5" stopColor="#f1f5f9" />
              <stop offset="1" stopColor="#64748b" />
            </linearGradient>
            <linearGradient id="kb-water" x1="32" y1="30" x2="32" y2="52" gradientUnits="userSpaceOnUse">
              <stop stopColor="#38bdf8" />
              <stop offset="1" stopColor="#0284c7" />
            </linearGradient>
          </defs>
          <rect x="8" y="10" width="48" height="46" rx="14" fill="url(#kb-tile)" />
          {/* Chrome Faucet Neck */}
          <path d="M22 42V26C22 18 30 14 38 14C44 14 46 18 46 22V26" stroke="url(#kb-faucet)" strokeWidth="6" strokeLinecap="round" />
          <rect x="42" y="24" width="8" height="4" rx="2" fill="#cbd5e1" />
          {/* Water Splash & Drops */}
          <path d="M46 30C46 34 43 38 43 42C43 45 45 48 46 48C47 48 49 45 49 42C49 38 46 34 46 30Z" fill="url(#kb-water)" />
          {/* Sparkle Stars */}
          <path d="M18 16L19.5 21L24 22.5L19.5 24L18 29L16.5 24L12 22.5L16.5 21L18 16Z" fill="#38bdf8" />
          <circle cx="50" cy="18" r="3" fill="#bae6fd" opacity="0.8" />
          <circle cx="20" cy="48" r="2.5" fill="#38bdf8" opacity="0.7" />
        </svg>
      );

    case 'sofa-carpet':
      return (
        <svg viewBox="0 0 64 64" fill="none" className="repaido-service-svg-art" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="sofa-body" x1="8" y1="18" x2="56" y2="50" gradientUnits="userSpaceOnUse">
              <stop stopColor="#a855f7" />
              <stop offset="1" stopColor="#6b21a8" />
            </linearGradient>
            <linearGradient id="sofa-cushion" x1="16" y1="26" x2="48" y2="44" gradientUnits="userSpaceOnUse">
              <stop stopColor="#c084fc" />
              <stop offset="1" stopColor="#9333ea" />
            </linearGradient>
          </defs>
          {/* Sofa Backrest */}
          <path d="M12 20C12 16.5 14.8 14 18.5 14H45.5C49.2 14 52 16.5 52 20V38H12V20Z" fill="url(#sofa-body)" />
          {/* Plush Cushions */}
          <rect x="15" y="26" width="16" height="15" rx="5" fill="url(#sofa-cushion)" />
          <rect x="33" y="26" width="16" height="15" rx="5" fill="url(#sofa-cushion)" />
          {/* Rounded Armrests */}
          <rect x="8" y="22" width="9" height="21" rx="4.5" fill="#7e22ce" />
          <rect x="47" y="22" width="9" height="21" rx="4.5" fill="#7e22ce" />
          {/* Sofa Base & Wooden Legs */}
          <rect x="10" y="41" width="44" height="6" rx="3" fill="#581c87" />
          <path d="M15 47L13 54M49 47L51 54" stroke="#d97706" strokeWidth="3" strokeLinecap="round" />
          {/* Foam Bubble Sparkles */}
          <circle cx="28" cy="18" r="3.5" fill="#e9d5ff" opacity="0.9" />
          <circle cx="36" cy="16" r="2" fill="#f3e8ff" />
        </svg>
      );

    case 'pump-tank':
      return (
        <svg viewBox="0 0 64 64" fill="none" className="repaido-service-svg-art" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="pt-metal" x1="12" y1="18" x2="52" y2="48" gradientUnits="userSpaceOnUse">
              <stop stopColor="#38bdf8" />
              <stop offset="0.6" stopColor="#0284c7" />
              <stop offset="1" stopColor="#075985" />
            </linearGradient>
            <linearGradient id="pt-tank" x1="24" y1="8" x2="56" y2="36" gradientUnits="userSpaceOnUse">
              <stop stopColor="#14b8a6" />
              <stop offset="1" stopColor="#0f766e" />
            </linearGradient>
          </defs>
          {/* Water Storage Cylinder */}
          <rect x="28" y="10" width="26" height="26" rx="6" fill="url(#pt-tank)" />
          <line x1="30" y1="18" x2="52" y2="18" stroke="#5eead4" strokeWidth="1.5" />
          <line x1="30" y1="26" x2="52" y2="26" stroke="#5eead4" strokeWidth="1.5" />
          {/* Motor Pump Body */}
          <rect x="10" y="24" width="24" height="24" rx="7" fill="url(#pt-metal)" />
          {/* Pump Motor Impeller Flange */}
          <circle cx="22" cy="36" r="6" fill="#0f172a" />
          <circle cx="22" cy="36" r="3.5" fill="#38bdf8" />
          {/* Connecting Pipes & Water Flow */}
          <path d="M22 24V16H28" stroke="#38bdf8" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M42 44C44 48 42 54 48 54C54 54 52 48 54 44" stroke="#0ea5e9" strokeWidth="3" strokeLinecap="round" />
          <path d="M12 48H32" stroke="#64748b" strokeWidth="3" strokeLinecap="round" />
        </svg>
      );

    case 'drain-bath':
      return (
        <svg viewBox="0 0 64 64" fill="none" className="repaido-service-svg-art" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="db-head" x1="16" y1="12" x2="48" y2="28" gradientUnits="userSpaceOnUse">
              <stop stopColor="#f1f5f9" />
              <stop offset="0.5" stopColor="#cbd5e1" />
              <stop offset="1" stopColor="#64748b" />
            </linearGradient>
          </defs>
          {/* Shower Arm */}
          <path d="M10 20C24 20 32 14 36 12" stroke="#94a3b8" strokeWidth="5" strokeLinecap="round" />
          {/* Rain Shower Disc Head */}
          <ellipse cx="40" cy="18" rx="14" ry="6" fill="url(#db-head)" stroke="#475569" strokeWidth="1" />
          {/* Rainfall Jet Streams */}
          <line x1="33" y1="24" x2="31" y2="40" stroke="#38bdf8" strokeWidth="2" strokeDasharray="3 2" />
          <line x1="37" y1="25" x2="36" y2="46" stroke="#0284c7" strokeWidth="2.5" strokeDasharray="4 2" />
          <line x1="41" y1="25" x2="41" y2="48" stroke="#38bdf8" strokeWidth="2.5" strokeDasharray="4 2" />
          <line x1="45" y1="25" x2="46" y2="46" stroke="#0284c7" strokeWidth="2.5" strokeDasharray="4 2" />
          <line x1="49" y1="24" x2="51" y2="40" stroke="#38bdf8" strokeWidth="2" strokeDasharray="3 2" />
          {/* Chrome Drain Vortex Ring */}
          <ellipse cx="41" cy="52" rx="12" ry="4.5" fill="#e2e8f0" stroke="#0284c7" strokeWidth="2" />
        </svg>
      );

    case 'inverter-mcb':
      return (
        <svg viewBox="0 0 64 64" fill="none" className="repaido-service-svg-art" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="inv-case" x1="10" y1="14" x2="54" y2="50" gradientUnits="userSpaceOnUse">
              <stop stopColor="#1e293b" />
              <stop offset="1" stopColor="#0f172a" />
            </linearGradient>
            <linearGradient id="inv-glow" x1="16" y1="22" x2="36" y2="28" gradientUnits="userSpaceOnUse">
              <stop stopColor="#22c55e" />
              <stop offset="1" stopColor="#16a34a" />
            </linearGradient>
          </defs>
          <rect x="10" y="14" width="44" height="36" rx="8" fill="url(#inv-case)" stroke="#334155" strokeWidth="1.5" />
          {/* LED Digital Display */}
          <rect x="16" y="20" width="20" height="9" rx="3" fill="#022c22" stroke="#059669" strokeWidth="1" />
          <line x1="19" y1="24.5" x2="33" y2="24.5" stroke="url(#inv-glow)" strokeWidth="2.5" strokeLinecap="round" />
          {/* MCB Toggle Switches */}
          <rect x="40" y="20" width="5" height="12" rx="2" fill="#f59e0b" />
          <rect x="47" y="20" width="5" height="12" rx="2" fill="#3b82f6" />
          {/* Cooling Vents */}
          <line x1="16" y1="36" x2="34" y2="36" stroke="#475569" strokeWidth="1.5" />
          <line x1="16" y1="40" x2="34" y2="40" stroke="#475569" strokeWidth="1.5" />
          <line x1="16" y1="44" x2="34" y2="44" stroke="#475569" strokeWidth="1.5" />
          {/* Surge Lightning Bolt */}
          <path d="M42 38L47 34L45 40L49 41L41 48L43 43L39 42L42 38Z" fill="#fbbf24" />
        </svg>
      );

    case 'geyser-smart':
      return (
        <svg viewBox="0 0 64 64" fill="none" className="repaido-service-svg-art" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="gy-body" x1="14" y1="10" x2="36" y2="52" gradientUnits="userSpaceOnUse">
              <stop stopColor="#f8fafc" />
              <stop offset="0.6" stopColor="#e2e8f0" />
              <stop offset="1" stopColor="#cbd5e1" />
            </linearGradient>
            <linearGradient id="bulb-glow" x1="42" y1="16" x2="58" y2="38" gradientUnits="userSpaceOnUse">
              <stop stopColor="#fde047" />
              <stop offset="1" stopColor="#eab308" />
            </linearGradient>
          </defs>
          {/* Geyser Vertical Tank */}
          <rect x="12" y="10" width="22" height="38" rx="8" fill="url(#gy-body)" stroke="#94a3b8" strokeWidth="1.5" />
          {/* Temperature Dial */}
          <circle cx="23" cy="22" r="5" fill="#ef4444" opacity="0.85" />
          <path d="M23 19V22L25 24" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
          {/* In/Out Water Pipes */}
          <rect x="16" y="48" width="4" height="6" fill="#3b82f6" />
          <rect x="26" y="48" width="4" height="6" fill="#ef4444" />
          {/* Smart Bulb Graphic beside */}
          <circle cx="48" cy="26" r="10" fill="url(#bulb-glow)" />
          <rect x="45" y="36" width="6" height="5" rx="1.5" fill="#64748b" />
          <path d="M48 10V13M36 26H39M57 26H60M39 17L41 19M55 17L57 19" stroke="#f59e0b" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );

    case 'ac-cooling':
      return (
        <svg viewBox="0 0 64 64" fill="none" className="repaido-service-svg-art" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="ac-unit" x1="6" y1="14" x2="58" y2="34" gradientUnits="userSpaceOnUse">
              <stop stopColor="#ffffff" />
              <stop offset="0.7" stopColor="#f1f5f9" />
              <stop offset="1" stopColor="#e2e8f0" />
            </linearGradient>
            <linearGradient id="ice-flow" x1="16" y1="36" x2="48" y2="56" gradientUnits="userSpaceOnUse">
              <stop stopColor="#38bdf8" />
              <stop offset="1" stopColor="#0284c7" />
            </linearGradient>
          </defs>
          {/* Split AC Main Chassis */}
          <rect x="6" y="14" width="52" height="22" rx="6" fill="url(#ac-unit)" stroke="#cbd5e1" strokeWidth="1.5" />
          {/* Display & Louver */}
          <rect x="42" y="19" width="10" height="4.5" rx="2" fill="#0284c7" />
          <line x1="10" y1="31" x2="54" y2="31" stroke="#0ea5e9" strokeWidth="2.5" strokeLinecap="round" />
          {/* Ice Frost Snowflake Crystals */}
          <path d="M32 38V54M24 46H40M26 40L38 52M26 52L38 40" stroke="url(#ice-flow)" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="16" cy="46" r="2.5" fill="#38bdf8" opacity="0.8" />
          <circle cx="48" cy="46" r="2.5" fill="#38bdf8" opacity="0.8" />
        </svg>
      );

    case 'fridge-micro':
      return (
        <svg viewBox="0 0 64 64" fill="none" className="repaido-service-svg-art" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="fridge-metal" x1="10" y1="8" x2="38" y2="56" gradientUnits="userSpaceOnUse">
              <stop stopColor="#e2e8f0" />
              <stop offset="0.5" stopColor="#cbd5e1" />
              <stop offset="1" stopColor="#94a3b8" />
            </linearGradient>
          </defs>
          {/* Fridge Cabinet */}
          <rect x="12" y="8" width="24" height="48" rx="6" fill="url(#fridge-metal)" stroke="#64748b" strokeWidth="1.5" />
          {/* Upper Freezer Door */}
          <line x1="13" y1="24" x2="35" y2="24" stroke="#475569" strokeWidth="2" />
          {/* Handles */}
          <rect x="15" y="15" width="2.5" height="6" rx="1" fill="#1e293b" />
          <rect x="15" y="27" width="2.5" height="12" rx="1" fill="#1e293b" />
          {/* Microwave Oven Beside */}
          <rect x="38" y="22" width="20" height="22" rx="4" fill="#334155" stroke="#64748b" strokeWidth="1" />
          <rect x="40" y="25" width="11" height="16" rx="2" fill="#0f172a" stroke="#475569" />
          <circle cx="54" cy="28" r="2" fill="#38bdf8" />
          <circle cx="54" cy="36" r="2" fill="#f59e0b" />
        </svg>
      );

    case 'jumpstart-tyre':
      return (
        <svg viewBox="0 0 64 64" fill="none" className="repaido-service-svg-art" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="jt-wheel" x1="16" y1="18" x2="48" y2="50" gradientUnits="userSpaceOnUse">
              <stop stopColor="#334155" />
              <stop offset="1" stopColor="#0f172a" />
            </linearGradient>
          </defs>
          {/* Heavy Duty Automobile Tyre */}
          <circle cx="32" cy="34" r="18" fill="url(#jt-wheel)" stroke="#64748b" strokeWidth="2" />
          <circle cx="32" cy="34" r="10" fill="#94a3b8" />
          <circle cx="32" cy="34" r="4" fill="#475569" />
          {/* Jumpstart Battery Cable Clamps */}
          <path d="M12 18L22 28M15 15L25 25" stroke="#ef4444" strokeWidth="4" strokeLinecap="round" />
          <path d="M52 18L42 28M49 15L39 25" stroke="#0f172a" strokeWidth="4" strokeLinecap="round" />
          {/* Electric Spark Burst */}
          <path d="M30 14L34 8L33 16L38 18L28 26L30 19L24 18L30 14Z" fill="#fbbf24" stroke="#f59e0b" strokeWidth="0.5" />
        </svg>
      );

    case 'fuel-lockout':
      return (
        <svg viewBox="0 0 64 64" fill="none" className="repaido-service-svg-art" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="fl-can" x1="12" y1="16" x2="38" y2="52" gradientUnits="userSpaceOnUse">
              <stop stopColor="#ef4444" />
              <stop offset="1" stopColor="#991b1b" />
            </linearGradient>
            <linearGradient id="fl-key" x1="38" y1="12" x2="56" y2="40" gradientUnits="userSpaceOnUse">
              <stop stopColor="#fbbf24" />
              <stop offset="1" stopColor="#d97706" />
            </linearGradient>
          </defs>
          {/* Emergency Red Fuel Jerrycan */}
          <rect x="12" y="20" width="24" height="32" rx="5" fill="url(#fl-can)" stroke="#7f1d1d" strokeWidth="1.5" />
          <path d="M16 20V14H24V20" stroke="#b91c1c" strokeWidth="3" strokeLinecap="round" />
          <line x1="18" y1="28" x2="30" y2="28" stroke="#fca5a5" strokeWidth="2" />
          <line x1="18" y1="36" x2="30" y2="36" stroke="#fca5a5" strokeWidth="2" />
          {/* Golden Car Key */}
          <circle cx="48" cy="18" r="7" fill="none" stroke="url(#fl-key)" strokeWidth="3.5" />
          <path d="M48 25V48L52 46V42L54 40V34L48 34" stroke="url(#fl-key)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'pruning-trim':
      return (
        <svg viewBox="0 0 64 64" fill="none" className="repaido-service-svg-art" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="pr-leaf" x1="14" y1="16" x2="50" y2="52" gradientUnits="userSpaceOnUse">
              <stop stopColor="#34d399" />
              <stop offset="0.6" stopColor="#10b981" />
              <stop offset="1" stopColor="#047857" />
            </linearGradient>
          </defs>
          {/* Sculpted Spherical Garden Hedge */}
          <circle cx="32" cy="28" r="16" fill="url(#pr-leaf)" />
          <rect x="29" y="44" width="6" height="12" rx="2" fill="#78350f" />
          {/* Shears Blades */}
          <path d="M18 16L32 26M46 16L32 26" stroke="#f1f5f9" strokeWidth="3" strokeLinecap="round" />
          <path d="M14 12L20 18M50 12L44 18" stroke="#ea580c" strokeWidth="3.5" strokeLinecap="round" />
          {/* Flying Leaves */}
          <path d="M48 30C52 28 54 32 50 34C46 36 46 32 48 30Z" fill="#a7f3d0" />
          <path d="M14 36C18 34 20 38 16 40C12 42 12 38 14 36Z" fill="#a7f3d0" />
        </svg>
      );

    case 'soil-pest':
      return (
        <svg viewBox="0 0 64 64" fill="none" className="repaido-service-svg-art" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="sp-soil" x1="16" y1="36" x2="48" y2="56" gradientUnits="userSpaceOnUse">
              <stop stopColor="#78350f" />
              <stop offset="1" stopColor="#451a03" />
            </linearGradient>
          </defs>
          {/* Soil Mound */}
          <path d="M10 50C14 42 22 38 32 38C42 38 50 42 54 50H10Z" fill="url(#sp-soil)" />
          {/* Green Sprout Growth */}
          <path d="M32 40V24" stroke="#16a34a" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M32 28C26 24 24 16 32 14C36 18 36 24 32 28Z" fill="#22c55e" />
          <path d="M32 32C38 28 40 20 32 18C28 22 28 28 32 32Z" fill="#4ade80" />
          {/* Herbal Spray Droplets */}
          <circle cx="20" cy="20" r="3" fill="#38bdf8" opacity="0.8" />
          <circle cx="44" cy="22" r="2.5" fill="#38bdf8" opacity="0.8" />
          <circle cx="16" cy="30" r="2" fill="#6ee7b7" />
        </svg>
      );

    // =========================================================================
    // DEDICATED 3D OFFER GRAPHICS (FLAT DISCOUNTS, PRICE SHIELDS & DEALS)
    // =========================================================================
    case 'offer-discount-25':
    case 'offer-green-20':
    case 'offer-sos-30':
    case 'offer-shield-20':
      return (
        <svg viewBox="0 0 64 64" fill="none" className="repaido-service-svg-art" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="off-tag" x1="12" y1="12" x2="52" y2="52" gradientUnits="userSpaceOnUse">
              <stop stopColor="#f59e0b" />
              <stop offset="0.5" stopColor="#ea580c" />
              <stop offset="1" stopColor="#dc2626" />
            </linearGradient>
          </defs>
          {/* Discount Badge Tag */}
          <path d="M16 14C14 14 12 16 12 18V32C12 34 13 36 15 38L34 54C37 57 41 57 44 54L54 44C57 41 57 37 54 34L38 15C36 13 34 12 32 12H16" fill="url(#off-tag)" />
          {/* Tag Eyelet */}
          <circle cx="20" cy="22" r="3.5" fill="#ffffff" />
          {/* Bold % Symbol */}
          <text x="32" y="38" fill="#ffffff" fontSize="16" fontWeight="700" fontFamily="Poppins, sans-serif" textAnchor="middle">%</text>
          {/* Celebration Sparkles */}
          <path d="M46 14L47.5 18.5L52 20L47.5 21.5L46 26L44.5 21.5L40 20L44.5 18.5L46 14Z" fill="#fde047" />
          <circle cx="14" cy="46" r="2" fill="#fef08a" />
        </svg>
      );

    case 'offer-price-299':
    case 'offer-rate-149':
    case 'offer-visit-99':
    case 'offer-fare-199':
    case 'offer-pass-249':
      return (
        <svg viewBox="0 0 64 64" fill="none" className="repaido-service-svg-art" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="off-coin" x1="12" y1="12" x2="52" y2="52" gradientUnits="userSpaceOnUse">
              <stop stopColor="#10b981" />
              <stop offset="0.6" stopColor="#059669" />
              <stop offset="1" stopColor="#047857" />
            </linearGradient>
            <linearGradient id="off-gold" x1="16" y1="16" x2="48" y2="48" gradientUnits="userSpaceOnUse">
              <stop stopColor="#fef08a" />
              <stop offset="0.5" stopColor="#facc15" />
              <stop offset="1" stopColor="#ca8a04" />
            </linearGradient>
          </defs>
          {/* Golden Shield / Medallion Rim */}
          <circle cx="32" cy="32" r="22" fill="url(#off-gold)" />
          <circle cx="32" cy="32" r="18" fill="url(#off-coin)" />
          {/* Rupee Symbol */}
          <text x="32" y="40" fill="#ffffff" fontSize="22" fontWeight="700" fontFamily="Poppins, sans-serif" textAnchor="middle">₹</text>
          {/* Sparkles */}
          <circle cx="48" cy="18" r="3" fill="#fef08a" />
          <circle cx="16" cy="44" r="2.5" fill="#fef08a" />
        </svg>
      );

    case 'offer-combo-150':
    case 'offer-saver-300':
    case 'offer-warranty-90':
      return (
        <svg viewBox="0 0 64 64" fill="none" className="repaido-service-svg-art" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="off-shield-grad" x1="14" y1="10" x2="50" y2="54" gradientUnits="userSpaceOnUse">
              <stop stopColor="#3b82f6" />
              <stop offset="0.5" stopColor="#1d4ed8" />
              <stop offset="1" stopColor="#1e3a8a" />
            </linearGradient>
          </defs>
          {/* Security Shield */}
          <path d="M32 10L48 16V32C48 43 41 51 32 55C23 51 16 43 16 32V16L32 10Z" fill="url(#off-shield-grad)" stroke="#93c5fd" strokeWidth="1.5" />
          {/* Golden Starburst / Check */}
          <path d="M26 32L30 36L39 26" stroke="#facc15" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="48" cy="14" r="3" fill="#60a5fa" />
          <circle cx="16" cy="44" r="2" fill="#93c5fd" />
        </svg>
      );

    default:
      return null;
  }
}

// Single Service Motion Card with Staggered Jittered Timer
function ServiceMotionCardItem({
  service,
  isActive,
  onSelect,
  initialIndex=0, motionPaused=false, onOffer
}: {
  motionPaused?:boolean;
  onOffer?:(id:string)=>void;
  initialIndex?:number;
  service: HomeServiceConfig;
  isActive: boolean;
  onSelect: () => void;
}) {
  const [slideIndex, setSlideIndex] = useState(initialIndex);
  const isHoveredRef = useRef(false);
  const cardRef=useRef<HTMLButtonElement>(null);
  const [visible,setVisible]=useState(false),[reduced,setReduced]=useState(false),[paused,setPaused]=useState(false);
  const [pageVisible,setPageVisible]=useState(!document.hidden);
  const isShining=visible&&pageVisible&&!reduced&&!paused&&!motionPaused;
  useEffect(()=>{
    const media=matchMedia('(prefers-reduced-motion: reduce)');
    const sync=()=>setReduced(media.matches||document.documentElement.classList.contains('reduce-motion'));
    sync();media.addEventListener('change',sync);const mutation=new MutationObserver(sync);mutation.observe(document.documentElement,{attributes:true,attributeFilter:['class']});
    const observer=new IntersectionObserver(rows=>setVisible(rows[0]?.isIntersecting||false));if(cardRef.current)observer.observe(cardRef.current);
    const page=()=>setPageVisible(!document.hidden);document.addEventListener('visibilitychange',page);
    return()=>{observer.disconnect();media.removeEventListener('change',sync);mutation.disconnect();document.removeEventListener('visibilitychange',page);};
  },[]);
  useEffect(()=>setSlideIndex(initialIndex),[initialIndex,service]);

  // Independent Non-Uniform Sliding Loop with Organic Staggering
  useEffect(() => {
    if(reduced||paused||motionPaused||!visible||!pageVisible||service.slides.length<2)return;
    let timeoutId: ReturnType<typeof setTimeout>;

    const scheduleNextSlide = () => {
      // Add organic random jitter (±250ms) to ensure non-uniform, living movement
      const jitter = Math.floor(Math.random() * 500) - 250;
      const delay = Math.max(2800, service.intervalMs + jitter);

      timeoutId = setTimeout(() => {
        if (!isHoveredRef.current && !document.hidden) {
          setSlideIndex(prev => (prev + 1) % service.slides.length);
        }
        scheduleNextSlide();
      }, delay);
    };

    // Stagger initial activation by initialDelayMs
    const initialTimer = setTimeout(() => {
      scheduleNextSlide();
    }, service.initialDelayMs);

    return () => {
      clearTimeout(initialTimer);
      clearTimeout(timeoutId);
    };
  }, [service,reduced,paused,motionPaused,visible,pageVisible]);

  const currentSlide = service.slides[slideIndex % service.slides.length];
  const isOfferSlide = currentSlide.isOffer;

  return (
    <button
      ref={cardRef}
      type="button"
      onFocus={()=>setPaused(true)} onBlur={()=>setPaused(false)}
      className={`repaido-service-motion-card ${isActive ? 'is-active' : ''} ${isShining ? 'is-shining' : ''}`}
      style={{
        // Dynamic CSS variables for high-level glow & accents
        ['--card-accent' as any]: service.accentColor,
        ['--card-accent-border' as any]: isOfferSlide ? '#f59e0b' : service.accentColor,
        ['--card-accent-glow' as any]: isOfferSlide ? 'rgba(245, 158, 11, 0.35)' : service.glowColor,
        ['--offer-glow-color' as any]: isOfferSlide ? 'rgba(245, 158, 11, 0.4)' : 'rgba(5, 150, 105, 0.25)'
      }}
      onClick={()=>isOfferSlide&&onOffer?onOffer(currentSlide.id):onSelect()}
      onMouseEnter={() => { isHoveredRef.current = true; }}
      onMouseLeave={() => { isHoveredRef.current = false; }}
      aria-label={`${service.name} - ${currentSlide.subLabel}`}
      title={`${service.name}: ${currentSlide.subLabel}`}
    >
      {/* Outer Ambient Underglow Shadow */}
      <div
        className="repaido-service-card-shadow-ambient"
        style={{
          background: isOfferSlide ? 'rgba(245, 158, 11, 0.35)' : service.glowColor
        }}
      />

      {/* Inner Card Surface */}
      <div className="repaido-service-card-surface">
        {/* Moving Shine Sweep */}
        <div className="repaido-service-card-shimmer" />

        {/* 1. Top Micro Badge Pill */}
        <div className="repaido-service-card-top-pill">
          <span className={`repaido-service-micro-badge repaido-badge-${currentSlide.badgeTheme}`}>
            {isOfferSlide && <span className="repaido-badge-radar-dot" />}
            {currentSlide.badge}
          </span>
        </div>

        {/* 2. Graphic Motion Stage (Base 3D Image or Attribute/Offer SVG) */}
        <div className="repaido-service-graphic-stage">
          {isOfferSlide && <div className="repaido-offer-glow-halo" />}
          <div key={currentSlide.id} className="repaido-service-graphic-wrap">
            {currentSlide.image ? (
              <img
                src={`${currentSlide.image}?v=home-compact-20260928`}
                width={44}
                height={44}
                alt=""
                className="repaido-service-icon-img"
              />
            ) : (
              <ServiceGraphicArt graphicKey={currentSlide.graphicKey} />
            )}
          </div>
        </div>

        {/* 3. Primary Service Title */}
        <h3 className="repaido-service-motion-title">{service.name}</h3>

        {/* 4. Dynamic Motion Sub-Caption / Offer Ticker */}
        <div className="repaido-service-motion-caption">
          <span
            key={`cap-${currentSlide.id}`}
            className={isOfferSlide ? 'repaido-caption-offer' : 'repaido-caption-attribute'}
          >
            {currentSlide.subLabel}
          </span>
        </div>

        {/* 5. Micro Progress Dots (Shows 5 slides with active & offer highlights) */}
        <div className="repaido-service-dots-indicator" aria-hidden="true">
          {service.slides.map((s, idx) => (
            <span
              key={s.id}
              className={`repaido-service-dot ${idx === slideIndex ? 'is-active' : ''} ${s.isOffer && idx === slideIndex ? 'is-offer' : ''}`}
            />
          ))}
        </div>
      </div>
    </button>
  );
}

// Static service card for the first two device visits.
export function ServiceStaticCardItem({
  service,
  isActive,
  onSelect
}: {
  service: HomeServiceConfig;
  isActive: boolean;
  onSelect: () => void;
}) {
  const baseSlide = service.slides.find(s => s.type === 'base') || service.slides[0];

  return (
    <button
      type="button"
      className={`repaido-service-static-card ${isActive ? 'is-active' : ''}`}
      style={{
        ['--card-accent' as any]: service.accentColor,
        ['--card-accent-border' as any]: service.accentColor
      }}
      onClick={onSelect}
      aria-label={`${service.name} - ${baseSlide.subLabel}`}
      title={`${service.name}: ${baseSlide.subLabel}`}
    >
      {/* Inner Card Surface */}
      <div className="repaido-service-card-surface">
        {/* 1. Top Micro Badge Pill */}
        <div className="repaido-service-card-top-pill">
          <span className={`repaido-service-micro-badge repaido-badge-${baseSlide.badgeTheme}`}>
            {baseSlide.badge}
          </span>
        </div>

        {/* 2. Graphic Stage (Base 3D Image) */}
        <div className="repaido-service-graphic-stage">
          <div className="repaido-service-graphic-wrap">
            {baseSlide.image ? (
              <img
                src={`${baseSlide.image}?v=home-compact-20260928`}
                width={44}
                height={44}
                alt=""
                className="repaido-service-icon-img"
                loading="eager"
              />
            ) : (
              <ServiceGraphicArt graphicKey={baseSlide.graphicKey} />
            )}
          </div>
        </div>

        {/* 3. Primary Service Title */}
        <h3 className="repaido-service-motion-title">{service.name}</h3>

        {/* 4. Sub-Caption */}
        <div className="repaido-service-motion-caption">
          <span className="repaido-caption-attribute">
            {baseSlide.subLabel}
          </span>
        </div>

        {/* 5. Static Micro Dot */}
        <div className="repaido-service-dots-indicator" aria-hidden="true">
          <span className="repaido-static-dot" />
        </div>
      </div>
    </button>
  );
}

// Service discovery starts rotating on the third device visit.
export function HomeServicesGrid({
  activeCategory,
  onSelectCategory,
  forceHydrated, city, offers=[], onOffer
}: {
  city?:string;
  offers?:Promotion[];
  onOffer?:(card:Promotion)=>void;
  activeCategory: CategoryId;
  onSelectCategory: (cat: CategoryId) => void;
  forceHydrated?: boolean;
}) {
  const { isHydrated, browseCount } = useCustomerBrowseHydration();
  const shouldHydrate = forceHydrated !== undefined ? forceHydrated : isHydrated;

  const [paused,setPaused]=useState(false),[offerTime,setOfferTime]=useState(()=>Date.now()/1000);
  useEffect(()=>{
    const now=Date.now()/1000;
    const expiry=Math.min(...offers.map(card=>card.ends_at).filter(at=>at>now));
    if(!Number.isFinite(expiry))return;
    const timer=setTimeout(()=>setOfferTime(Date.now()/1000),Math.min(2147483647,Math.max(1,(expiry-now)*1000)));
    return()=>clearTimeout(timer);
  },[offers,offerTime]);
  const regionServices=useMemo(()=>homeServicesData.map(service=>{
    const regular=service.slides.filter(slide=>!slide.isOffer).map(slide=>({...slide,badge:slide.type==='base'?'Explore service':slide.badge,subLabel:slide.type==='base'?service.slides[0].subLabel:slide.subLabel}));
    const regional=offers.filter(card=>card.service?.category===service.categoryId&&card.discount_paise>0&&card.ends_at>Math.max(offerTime,Date.now()/1000)).slice(0,3).map(card=>({id:card.id,type:'offer' as const,title:card.title,badge:'Local offer',badgeTheme:'amber' as const,image:service.slides[0].image,subLabel:card.title,isOffer:true}));
    return {...service,slides:[...regular,...regional]};
  }),[offers,offerTime]);

  return (
    <div
      className={`repaido-services-grid-container ${shouldHydrate ? 'repaido-services-grid-hydrated' : 'repaido-services-grid-static'}`}
      role="region"
      aria-label="Home Services Category Grid"
      data-browse-count={browseCount}
      data-hydrated={shouldHydrate}
      data-city={city}
    >
      {shouldHydrate&&<div className="service-grid-toolbar"><small>{city?`Discover ${city}`:'Discover services'}</small><button type="button" onClick={()=>setPaused(v=>!v)} aria-label={paused?'Play service cards':'Pause service cards'}>{paused?'Play':'Pause'}</button></div>}
      <div className={`repaido-services-3col-grid ${paused?'service-grid-paused':''}`}>
        {shouldHydrate
          ? regionServices.map((service,index) => (
              <ServiceMotionCardItem
                key={service.id}
                initialIndex={(Math.max(0,browseCount-3)+index)%service.slides.length}
                service={service}
                motionPaused={paused}
                onOffer={id=>{const card=offers.find(card=>card.id===id&&card.ends_at>Date.now()/1000);if(card&&onOffer)onOffer(card);else onSelectCategory(service.categoryId);}}
                isActive={activeCategory === service.categoryId}
                onSelect={() => onSelectCategory(service.categoryId)}
              />
            ))
          : regionServices.map((service,index) => (
              <ServiceStaticCardItem
                key={service.id}
                service={service}
                isActive={activeCategory === service.categoryId}
                onSelect={() => onSelectCategory(service.categoryId)}
              />
            ))}
      </div>
    </div>
  );
}
export default HomeServicesGrid;
