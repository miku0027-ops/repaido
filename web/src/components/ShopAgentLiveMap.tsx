import React, { useEffect, useRef, useState, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Compass,
  MapPin,
  Phone,
  Navigation,
  Clock,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Maximize2,
  RotateCcw,
  User,
  Package,
  Layers,
  Sparkles,
  ChevronRight,
  ExternalLink,
  Store
} from 'lucide-react';
import type { SpareShop, TaskSpareItem } from '../types';

export interface SpecialistAgent {
  id: string;
  name: string;
  role: string;
  phone: string;
  avatar?: string;
  rating: number;
  vehicleType: 'scooter' | 'bike' | 'van';
  status: 'en_route_to_shop' | 'at_shop_counter' | 'delivering_to_site' | 'idle';
  statusLabel: string;
  lat: number;
  lng: number;
  speedKmH: number;
  distanceKm: number;
  etaMinutes: number;
  bookingId: string;
  spareName: string;
  sparePrice: number;
  customerAddress: string;
  customerLat: number;
  customerLng: number;
  hsnCode?: string;
}

interface ShopAgentLiveMapProps {
  shop: SpareShop | null;
  orders: {
    bookingId: string;
    spare: TaskSpareItem;
    customerAddress: string;
    workerName: string;
    hsnCode?: string;
  }[];
  acceptedOrders: Record<string, boolean>;
  fulfilledOrders: Record<string, boolean>;
  onSelectOrder?: (bookingId: string) => void;
  onFulfillOrder?: (bookingId: string) => void;
  focusedTechnicianId?: string | null;
}

export const ShopAgentLiveMap: React.FC<ShopAgentLiveMapProps> = ({
  shop,
  orders,
  acceptedOrders,
  fulfilledOrders,
  onSelectOrder,
  onFulfillOrder,
  focusedTechnicianId
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<{ [key: string]: L.Marker | L.Circle | L.Polyline }>({});
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | 'approaching' | 'counter' | 'delivering'>('all');
  const [showRoutes, setShowRoutes] = useState(true);
  const [simulationActive, setSimulationActive] = useState(true);
  const [lastPingTime, setLastPingTime] = useState<Date>(new Date());

  // Shop base coordinates
  const shopLat = shop?.lat || 21.4934;
  const shopLng = shop?.lng || 86.9135;
  const shopName = shop?.shopName || 'Repaido Partner Hub';

  // Seeded specialists from active orders
  const initialAgents = useMemo<SpecialistAgent[]>(() => {
    const list: SpecialistAgent[] = [];

    // Map through orders to assign realistic specialist details
    orders.forEach((order, idx) => {
      const isFulfilled = fulfilledOrders[order.spare.id] || order.spare.status === 'installed';
      const isAccepted = (acceptedOrders[order.spare.id] || order.spare.status === 'shop_accepted' || order.spare.status === 'agent_picked_up') && !isFulfilled;
      
      let status: SpecialistAgent['status'] = 'en_route_to_shop';
      let statusLabel = 'Approaching Shop';
      let offsetLat = 0.009 * (idx === 0 ? 1 : -1) + (idx * 0.002);
      let offsetLng = 0.008 * (idx === 0 ? 1 : -0.8);
      let dist = 1.2 + idx * 0.8;
      let eta = Math.max(3, Math.round(dist * 3.5));

      if (isFulfilled) {
        status = 'delivering_to_site';
        statusLabel = 'Delivering to Site';
        offsetLat = -0.012;
        offsetLng = 0.011;
        dist = 2.4;
        eta = 8;
      } else if (isAccepted && idx % 2 === 1) {
        status = 'at_shop_counter';
        statusLabel = 'At Counter for Pickup';
        offsetLat = 0.0004;
        offsetLng = 0.0005;
        dist = 0.05;
        eta = 0;
      }

      list.push({
        id: `agent-${order.bookingId}`,
        name: order.workerName.replace(/\(.*?\)/g, '').trim() || (idx === 0 ? 'Rajesh Mohanty' : 'Bikash Jena'),
        role: idx === 0 ? 'Senior AC Technician' : 'HVAC & Refrigeration Specialist',
        phone: idx === 0 ? '+91 98610 54321' : '+91 97780 12345',
        rating: 4.9,
        vehicleType: idx === 0 ? 'scooter' : 'bike',
        status,
        statusLabel,
        lat: shopLat + offsetLat,
        lng: shopLng + offsetLng,
        speedKmH: status === 'at_shop_counter' ? 0 : 22 + (idx * 4),
        distanceKm: dist,
        etaMinutes: eta,
        bookingId: order.bookingId,
        spareName: order.spare.name,
        sparePrice: order.spare.price,
        customerAddress: order.customerAddress,
        customerLat: shopLat + (idx === 0 ? 0.015 : -0.014),
        customerLng: shopLng + (idx === 0 ? 0.012 : -0.012),
        hsnCode: order.hsnCode || '8415'
      });
    });

    if (list.length === 0) {
      // Default demo specialists so radar is never blank
      list.push(
        {
          id: 'agent-demo-1',
          name: 'Rajesh Mohanty',
          role: 'Senior AC Specialist',
          phone: '+91 98610 54321',
          rating: 4.9,
          vehicleType: 'scooter',
          status: 'en_route_to_shop',
          statusLabel: 'Approaching Shop (~4m ETA)',
          lat: shopLat + 0.008,
          lng: shopLng + 0.007,
          speedKmH: 26,
          distanceKm: 1.1,
          etaMinutes: 4,
          bookingId: 'BK-9482',
          spareName: 'Dual Run Capacitor 50+5 MFD 440V',
          sparePrice: 480,
          customerAddress: 'Plot 42, OT Road, Station Square, Balasore',
          customerLat: shopLat + 0.016,
          customerLng: shopLng + 0.014,
          hsnCode: '8532'
        },
        {
          id: 'agent-demo-2',
          name: 'Bikash Jena',
          role: 'HVAC & Compressor Expert',
          phone: '+91 97780 12345',
          rating: 4.8,
          vehicleType: 'bike',
          status: 'at_shop_counter',
          statusLabel: 'At Shop Counter (Awaiting Handover)',
          lat: shopLat + 0.0003,
          lng: shopLng + 0.0004,
          speedKmH: 0,
          distanceKm: 0.04,
          etaMinutes: 0,
          bookingId: 'BK-8820',
          spareName: 'Rotary Compressor 1.5 Ton R32 Eco',
          sparePrice: 6400,
          customerAddress: 'House 14B, FM College Road, Balasore',
          customerLat: shopLat - 0.012,
          customerLng: shopLng - 0.010,
          hsnCode: '8414'
        }
      );
    }

    return list;
  }, [orders, acceptedOrders, fulfilledOrders, shopLat, shopLng]);

  const [agents, setAgents] = useState<SpecialistAgent[]>(initialAgents);

  // Sync initial agents when orders change
  useEffect(() => {
    setAgents(initialAgents);
  }, [initialAgents]);

  // Live GPS simulation movement: slightly nudges positions every 4 seconds
  useEffect(() => {
    if (!simulationActive) return;

    const interval = setInterval(() => {
      setAgents(prevAgents =>
        prevAgents.map(ag => {
          if (ag.status === 'at_shop_counter') return ag;

          // Target is shop if heading to shop, or customer site if delivering
          const targetLat = ag.status === 'en_route_to_shop' ? shopLat : ag.customerLat;
          const targetLng = ag.status === 'en_route_to_shop' ? shopLng : ag.customerLng;

          const deltaLat = (targetLat - ag.lat) * 0.08;
          const deltaLng = (targetLng - ag.lng) * 0.08;

          const newLat = ag.lat + deltaLat;
          const newLng = ag.lng + deltaLng;

          // Recalculate straight-line distance
          const dLat = (targetLat - newLat) * 111;
          const dLng = (targetLng - newLng) * 111 * Math.cos((newLat * Math.PI) / 180);
          const newDist = Math.max(0.05, Math.sqrt(dLat * dLat + dLng * dLng));
          const newEta = Math.max(1, Math.round(newDist * 3));

          return {
            ...ag,
            lat: newLat,
            lng: newLng,
            distanceKm: Number(newDist.toFixed(2)),
            etaMinutes: newEta
          };
        })
      );
      setLastPingTime(new Date());
    }, 4000);

    return () => clearInterval(interval);
  }, [simulationActive, shopLat, shopLng]);

  // Filtered agents list
  const filteredAgents = useMemo(() => {
    return agents.filter(ag => {
      if (filterStatus === 'approaching') return ag.status === 'en_route_to_shop';
      if (filterStatus === 'counter') return ag.status === 'at_shop_counter';
      if (filterStatus === 'delivering') return ag.status === 'delivering_to_site';
      return true;
    });
  }, [agents, filterStatus]);

  // Leaflet Map Initialization and Layer Management
  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Reset previous instance
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: true,
      dragging: true
    }).setView([shopLat, shopLng], 14);

    mapInstanceRef.current = map;

    // Use the same OpenStreetMap streets as pickup and service location maps.
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      maxZoom: 19
    }).addTo(map);

    // Zoom control in bottom right
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Resize observer to ensure clean rendering on responsive viewport changes
    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resizeObserver.observe(mapContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [shopLat, shopLng]);

  // Render / Update Map Markers and Routes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Clear existing markers & lines
    Object.values(markersRef.current).forEach(layer => layer.remove());
    markersRef.current = {};

    // 1. Shop Marker (Center Hub)
    const shopIcon = L.divIcon({
      className: 'shop-map-pin-container',
      html: `
        <div class="shop-map-pin-store">
          🏬
        </div>
      `,
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });

    const shopMarker = L.marker([shopLat, shopLng], { icon: shopIcon }).addTo(map);
    shopMarker.bindTooltip(
      `<strong>${shopName}</strong><br/><span style="font-size:10px;color:#64748b;">Repaido Parts Depot</span>`,
      { permanent: true, direction: 'top', offset: [0, -18], className: 'map-tooltip-clean' }
    );
    markersRef.current['shop'] = shopMarker;

    // 2. Shop 5km Procurement Geofence Ring
    const geofenceCircle = L.circle([shopLat, shopLng], {
      radius: 2500,
      color: '#003BB5',
      weight: 1.5,
      dashArray: '4, 8',
      fillColor: '#003BB5',
      fillOpacity: 0.04
    }).addTo(map);
    markersRef.current['geofence'] = geofenceCircle;

    // 3. Specialist / Technician Live Markers
    filteredAgents.forEach(agent => {
      const isAtCounter = agent.status === 'at_shop_counter';
      const isDelivering = agent.status === 'delivering_to_site';

      const agentIcon = L.divIcon({
        className: 'shop-agent-pin',
        html: `
          <div class="shop-map-agent-marker">
            <div class="shop-map-agent-pulse ${isAtCounter ? 'at-shop' : isDelivering ? 'delivering' : 'urgent'}"></div>
            <div class="shop-map-agent-body ${isAtCounter ? 'at-shop' : isDelivering ? 'delivering' : 'urgent'}">
              ${isAtCounter ? '🏬' : agent.vehicleType === 'scooter' ? '🛵' : '🔧'}
            </div>
          </div>
        `,
        iconSize: [42, 42],
        iconAnchor: [21, 21]
      });

      const marker = L.marker([agent.lat, agent.lng], { icon: agentIcon }).addTo(map);

      // Tooltip
      marker.bindTooltip(
        `<strong>${agent.name}</strong> · ${isAtCounter ? 'At Shop' : `${agent.etaMinutes}m ETA`}`,
        { permanent: false, direction: 'bottom', offset: [0, 16], className: 'map-tooltip-clean' }
      );

      // Popup with Rich Information
      const popupContent = document.createElement('div');
      popupContent.className = 'p-1 text-slate-900';
      popupContent.innerHTML = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif; font-size: 12px; min-width: 200px;">
          <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e2e8f0;padding-bottom:6px;margin-bottom:6px;">
            <div style="font-weight:800;color:#0B132B;font-size:13px;">${agent.name}</div>
            <span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:999px;background:${isAtCounter ? '#dcfce7;color:#15803d' : '#fef3c7;color:#b45309'};">
              ${agent.statusLabel}
            </span>
          </div>
          <div style="color:#64748b;font-size:11px;margin-bottom:4px;">${agent.role}</div>
          <div style="background:#f8fafc;padding:6px;border-radius:8px;margin-bottom:8px;border:1px solid #e2e8f0;">
            <div style="font-size:10px;font-weight:700;color:#64748b;">PART PROCUREMENT:</div>
            <div style="font-weight:700;color:#0B132B;font-size:11px;">${agent.spareName}</div>
            <div style="display:flex;justify-content:space-between;margin-top:2px;">
              <span style="font-mono;font-weight:700;color:#003BB5;">Booking #${agent.bookingId}</span>
              <span style="font-mono;font-weight:800;color:#059669;">₹${agent.sparePrice}</span>
            </div>
          </div>
          <div style="display:flex;gap:6px;">
            <a href="tel:${agent.phone}" style="flex:1;background:#003BB5;color:#ffffff;text-align:center;padding:6px 8px;border-radius:8px;font-weight:700;text-decoration:none;font-size:11px;display:inline-block;">
              📞 Call Tech
            </a>
          </div>
        </div>
      `;

      marker.bindPopup(popupContent);
      marker.on('click', () => {
        setSelectedAgentId(agent.id);
      });

      markersRef.current[`agent-${agent.id}`] = marker;

      // 4. Customer Job Site Marker
      const custIcon = L.divIcon({
        className: 'shop-cust-pin',
        html: `
          <div class="shop-map-customer-pin">
            🏠
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });

      const custMarker = L.marker([agent.customerLat, agent.customerLng], { icon: custIcon }).addTo(map);
      custMarker.bindTooltip(`Job Site #${agent.bookingId}`, {
        permanent: false,
        direction: 'top',
        className: 'map-tooltip-clean'
      });
      markersRef.current[`cust-${agent.id}`] = custMarker;

      // 5. Connecting Route Polyline
      if (showRoutes) {
        const routeColor = isAtCounter ? '#059669' : '#003BB5';
        const polyline = L.polyline(
          [
            [agent.lat, agent.lng],
            [shopLat, shopLng],
            [agent.customerLat, agent.customerLng]
          ],
          {
            color: routeColor,
            weight: 3.5,
            opacity: 0.65,
            dashArray: '6, 10'
          }
        ).addTo(map);
        markersRef.current[`route-${agent.id}`] = polyline;
      }
    });
  }, [filteredAgents, shopLat, shopLng, shopName, showRoutes]);

  // Center on focused technician when triggered externally or internally
  useEffect(() => {
    const targetId = focusedTechnicianId || selectedAgentId;
    if (!targetId || !mapInstanceRef.current) return;

    const targetAgent = agents.find(ag => ag.id === targetId || ag.bookingId === targetId);
    if (targetAgent) {
      mapInstanceRef.current.flyTo([targetAgent.lat, targetAgent.lng], 16, {
        duration: 1.2
      });
    }
  }, [focusedTechnicianId, selectedAgentId, agents]);

  const handleRecenter = () => {
    if (!mapInstanceRef.current) return;
    mapInstanceRef.current.flyTo([shopLat, shopLng], 14, { duration: 1 });
  };

  const handleFocusAgent = (agent: SpecialistAgent) => {
    setSelectedAgentId(agent.id);
    if (mapInstanceRef.current) {
      mapInstanceRef.current.flyTo([agent.lat, agent.lng], 16, { duration: 1 });
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs space-y-0 relative">
      {/* Top Map Action & Filter Bar */}
      <div className="p-3 sm:p-4 bg-slate-900 text-white flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-[#003BB5] text-white flex items-center justify-center font-bold shrink-0 shadow-xs">
            <Compass className="w-4 h-4 animate-spin-slow text-amber-400" />
          </div>
          <div>
            <div className="font-extrabold text-xs sm:text-sm tracking-tight flex items-center gap-2">
              <span>Technician Live Location Radar</span>
              <span className="text-[10px] bg-emerald-500/20 text-emerald-400 font-mono px-2 py-0.5 rounded-full border border-emerald-500/30 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                <span>{agents.length} Active in Area</span>
              </span>
            </div>
            <div className="text-[11px] text-slate-400">
              Live GPS monitoring of nearby field technicians collecting replacement parts from your shop.
            </div>
          </div>
        </div>

        {/* Filter Pills & Map Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Status filter pills */}
          <div className="flex items-center bg-slate-800/80 p-0.5 rounded-xl border border-slate-700">
            {[
              { id: 'all', label: `All (${agents.length})` },
              { id: 'approaching', label: 'Approaching' },
              { id: 'counter', label: 'At Counter' },
              { id: 'delivering', label: 'Delivering' }
            ].map(f => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilterStatus(f.id as any)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all whitespace-nowrap ${
                  filterStatus === f.id
                    ? 'bg-[#003BB5] text-white shadow-xs'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Quick Map Action Buttons */}
          <button
            type="button"
            onClick={handleRecenter}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg border border-slate-700 transition-colors flex items-center gap-1 text-[11px] font-semibold"
            title="Re-center map on your shop"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Center Depot</span>
          </button>

          <button
            type="button"
            onClick={() => setShowRoutes(!showRoutes)}
            className={`p-1.5 rounded-lg border text-[11px] font-semibold transition-colors flex items-center gap-1 ${
              showRoutes
                ? 'bg-blue-600/30 text-blue-300 border-blue-500/40'
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}
            title="Toggle route path display"
          >
            <Layers className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Routes</span>
          </button>
        </div>
      </div>

      {/* Main Map Container */}
      <div className="relative w-full h-[380px] sm:h-[440px] bg-slate-100">
        <div ref={mapContainerRef} className="w-full h-full z-0" tabIndex={0} aria-label="Interactive technician live tracking map" />

        {/* Floating Quick Legend / Depot Pin Indicator */}
        <div className="absolute top-3 left-3 z-10 bg-white/95 backdrop-blur-md px-3 py-2 rounded-xl border border-slate-200/80 shadow-md text-xs pointer-events-auto">
          <div className="flex items-center gap-2 text-slate-900 font-bold">
            <span className="w-2.5 h-2.5 rounded-full bg-[#003BB5] animate-pulse" />
            <span className="truncate max-w-[180px]">{shopName}</span>
          </div>
          <div className="text-[10px] text-slate-500 flex items-center gap-1.5 mt-0.5">
            <span>2.5 km Geofence Active</span>
            <span>•</span>
            <span className="font-mono text-emerald-700 font-bold">GPS Synced</span>
          </div>
        </div>

        {/* Live Simulation Ping Indicator in Bottom Left */}
        <div className="absolute bottom-3 left-3 z-10 bg-slate-900/90 backdrop-blur-md px-2.5 py-1.5 rounded-lg border border-slate-700 text-white text-[10px] font-mono flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
          <span>Last Satellite Ping: {lastPingTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
        </div>
      </div>

      {/* Fleet Specialist List Strip Below Map */}
      <div className="p-3 sm:p-4 bg-slate-50 border-t border-slate-200">
        <div className="flex items-center justify-between mb-2.5">
          <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
            <User className="w-3.5 h-3.5 text-[#003BB5]" />
            <span>Active Specialists Linked to Your Shop Orders</span>
          </div>
          <span className="text-[10px] text-slate-500 font-mono">
            Click any specialist to focus on radar
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {filteredAgents.map(ag => {
            const isSelected = selectedAgentId === ag.id;
            const isAtCounter = ag.status === 'at_shop_counter';

            return (
              <div
                key={ag.id}
                onClick={() => handleFocusAgent(ag)}
                className={`p-3 rounded-xl border transition-all cursor-pointer text-xs ${
                  isSelected
                    ? 'bg-blue-50/80 border-[#003BB5] shadow-xs'
                    : 'bg-white hover:bg-slate-50 border-slate-200'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                      isAtCounter ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'
                    }`}>
                      {ag.vehicleType === 'scooter' ? '🛵' : '🔧'}
                    </div>
                    <div>
                      <div className="font-extrabold text-slate-900 flex items-center gap-1">
                        <span>{ag.name}</span>
                        <span className="text-[10px] text-amber-600 font-bold">★ {ag.rating}</span>
                      </div>
                      <div className="text-[10px] text-slate-500">{ag.role}</div>
                    </div>
                  </div>

                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full font-mono ${
                    isAtCounter
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                      : 'bg-amber-100 text-amber-800 border border-amber-200'
                  }`}>
                    {isAtCounter ? '● At Depot' : `~${ag.etaMinutes}m ETA`}
                  </span>
                </div>

                {/* Part & Task Details */}
                <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                  <div className="truncate mr-2">
                    <span className="text-slate-400 font-mono">#{ag.bookingId}:</span>{' '}
                    <span className="font-bold text-slate-800 truncate">{ag.spareName}</span>
                  </div>
                  <span className="font-bold text-emerald-700 font-mono shrink-0">₹{ag.sparePrice}</span>
                </div>

                {/* Bottom Actions */}
                <div className="mt-2.5 flex items-center justify-between pt-1 gap-2">
                  <a
                    href={`tel:${ag.phone}`}
                    onClick={e => e.stopPropagation()}
                    className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-[10px] flex items-center gap-1 transition-colors"
                  >
                    <Phone className="w-3 h-3 text-slate-500" />
                    <span>Call Tech</span>
                  </a>

                  {onSelectOrder && (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        onSelectOrder(ag.bookingId);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-[#003BB5] hover:bg-[#002D8F] text-white font-semibold text-[10px] flex items-center gap-1 transition-colors"
                    >
                      <span>View Order</span>
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
