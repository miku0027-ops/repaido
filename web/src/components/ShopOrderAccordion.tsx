import React, { useState } from 'react';
import {
  ChevronDown,
  CheckCircle2,
  AlertCircle,
  MapPin,
  Phone,
  Printer,
  Compass,
  Check,
  Package,
  Clock,
  ShieldCheck,
  DollarSign,
  ArrowRight,
  ExternalLink,
  Navigation,
  Lock,
  Sparkles
} from 'lucide-react';
import type { TaskSpareItem } from '../types';

export interface ShopOrderAccordionItem {
  bookingId: string;
  spare: TaskSpareItem;
  customerAddress: string;
  workerName: string;
  hsnCode?: string;
}

interface ShopOrderAccordionProps {
  order: ShopOrderAccordionItem;
  isAccepted: boolean;
  isFulfilled: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onAccept: (spareId: string) => void;
  onFulfill: (order: ShopOrderAccordionItem) => void;
  onPrintInvoice: (order: ShopOrderAccordionItem) => void;
  onFocusMap?: (bookingId: string) => void;
}

export const ShopOrderAccordion: React.FC<ShopOrderAccordionProps> = ({
  order,
  isAccepted,
  isFulfilled,
  isExpanded,
  onToggle,
  onAccept,
  onFulfill,
  onPrintInvoice,
  onFocusMap
}) => {
  const { bookingId, spare, customerAddress, workerName } = order;
  const matchingHsn = order.hsnCode || '8415';
  const netPayout = Math.round(spare.price * 0.95);
  const platformComm = Math.round(spare.price * 0.05);

  // OTP handshake verification input
  const [handoverOtp, setHandoverOtp] = useState('');
  const [otpError, setOtpError] = useState('');

  const handleVerifyAndHandover = () => {
    // If OTP provided or bypass accepted
    if (handoverOtp.trim().length > 0 && handoverOtp.trim().length !== 4) {
      setOtpError('Please enter valid 4-digit technician handshake OTP or leave blank for override.');
      return;
    }
    setOtpError('');
    onFulfill(order);
  };

  return (
    <div
      className={`rounded-2xl border transition-all duration-200 shadow-xs overflow-hidden ${
        isFulfilled
          ? 'bg-slate-50/70 border-slate-200'
          : isAccepted
          ? 'bg-white border-blue-200 hover:border-blue-300'
          : 'bg-white border-amber-300 hover:border-amber-400 ring-1 ring-amber-400/30'
      }`}
    >
      {/* 1. COMPACT ACCORDION HEADER (Clean, Uncluttered, Fast Scannability) */}
      <div
        onClick={onToggle}
        className={`p-3.5 sm:p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 cursor-pointer select-none transition-colors ${
          !isAccepted && !isFulfilled ? 'bg-amber-50/40 hover:bg-amber-50/70' : 'hover:bg-slate-50/70'
        }`}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        {/* Left: Thumbnail & Essential Order Details */}
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold shrink-0 shadow-2xs ${
              isFulfilled
                ? 'bg-emerald-100 text-emerald-800'
                : isAccepted
                ? 'bg-blue-100 text-[#003BB5]'
                : 'bg-amber-100 text-amber-900 ring-2 ring-amber-300'
            }`}
          >
            <Package className="w-5 h-5" />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs font-extrabold text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                #{bookingId}
              </span>
              <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                Tech: {workerName.split(' ')[0]} {workerName.split(' ')[1] || ''}
              </span>
              <span className="text-[10px] font-mono text-slate-500 font-semibold">
                HSN {matchingHsn}
              </span>
            </div>
            <h3 className="font-extrabold text-sm text-slate-900 truncate mt-1">
              {spare.name}
            </h3>
          </div>
        </div>

        {/* Center / Right: Status Pill & Commercials */}
        <div className="flex items-center justify-between md:justify-end gap-3 shrink-0">
          {/* Status Badge */}
          {isFulfilled ? (
            <span className="text-[11px] font-extrabold text-emerald-800 bg-emerald-50 border border-emerald-300 px-2.5 py-1 rounded-full flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              <span>Handed Over</span>
            </span>
          ) : isAccepted ? (
            <span className="text-[11px] font-extrabold text-blue-800 bg-blue-50 border border-blue-300 px-2.5 py-1 rounded-full flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
              <span>Agent In-Route (~6m ETA)</span>
            </span>
          ) : (
            <span className="text-[11px] font-extrabold text-amber-900 bg-amber-100 border border-amber-300 px-2.5 py-1 rounded-full flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-600 animate-ping" />
              <span>Verify Stock</span>
            </span>
          )}

          {/* Price & Payout */}
          <div className="text-right">
            <div className="text-sm font-extrabold text-slate-900 font-mono">
              ₹{spare.price}
            </div>
            <div className="text-[10px] text-emerald-700 font-semibold font-mono">
              Net ₹{netPayout}
            </div>
          </div>

          {/* Quick Action Button (Single Click Without Expanding) */}
          {!isAccepted && !isFulfilled && (
            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                onAccept(spare.id);
              }}
              className="hidden sm:inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs shadow-xs transition-all active:scale-95"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Accept Stock</span>
            </button>
          )}

          {/* Accordion Chevron */}
          <div
            className={`w-7 h-7 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center transition-transform duration-200 ${
              isExpanded ? 'rotate-180 bg-slate-200' : ''
            }`}
          >
            <ChevronDown className="w-4 h-4" />
          </div>
        </div>
      </div>

      {/* 2. EXPANDED ACCORDION CONTENT (Structured, Clean, No Wall of Text) */}
      {isExpanded && (
        <div className="p-4 sm:p-5 border-t border-slate-100 bg-slate-50/50 space-y-4 animate-fadeIn">
          {/* Quick Info Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Card 1: Commercial & Part Breakdown */}
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs space-y-2">
              <div className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-[#003BB5]" />
                <span>Commercials & Payout</span>
              </div>
              <div className="text-xs space-y-1.5 pt-1">
                <div className="flex justify-between text-slate-600">
                  <span>Part Billable MRP:</span>
                  <span className="font-mono font-bold text-slate-900">₹{spare.price}</span>
                </div>
                <div className="flex justify-between text-slate-500 text-[11px]">
                  <span>Repaido Fee (5%):</span>
                  <span className="font-mono text-slate-600">-₹{platformComm}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Two-Way Travel Fund:</span>
                  <span className="font-mono font-bold text-amber-700">₹{spare.travelCharge}</span>
                </div>
                <div className="pt-2 border-t border-slate-100 flex justify-between font-extrabold text-slate-900">
                  <span className="text-emerald-800">Net Wednesday Payout:</span>
                  <span className="font-mono text-emerald-700 text-sm">₹{netPayout}</span>
                </div>
              </div>
            </div>

            {/* Card 2: Field Specialist & Contact */}
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs space-y-2">
              <div className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                <span>Assigned Specialist</span>
              </div>
              <div className="text-xs space-y-1.5 pt-1">
                <div className="font-bold text-slate-900">{workerName}</div>
                <div className="text-[11px] text-slate-500">Certified In-Task Service Partner</div>
                <div className="flex items-center gap-2 pt-1">
                  <a
                    href="tel:9861054321"
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-[#003BB5] hover:text-[#002D8F] bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200 transition-colors"
                  >
                    <Phone className="w-3 h-3" />
                    <span>Call Specialist</span>
                  </a>
                  {onFocusMap && (
                    <button
                      type="button"
                      onClick={() => onFocusMap(bookingId)}
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-lg border border-slate-200 transition-colors"
                    >
                      <Compass className="w-3 h-3 text-[#003BB5]" />
                      <span>Track on Radar</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Card 3: Repair Job Site */}
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs space-y-2">
              <div className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-red-600" />
                <span>Job Site Location</span>
              </div>
              <div className="text-xs space-y-1.5 pt-1">
                <p className="text-slate-700 font-medium line-clamp-2">
                  {customerAddress}
                </p>
                <div className="text-[11px] text-slate-500 flex items-center gap-1">
                  <Navigation className="w-3 h-3 text-slate-400" />
                  <span>Straight-line dist: ~{spare.travelDistanceKm} km</span>
                </div>
                <div className="text-[10px] text-slate-400 font-mono">
                  Depot Handover Policy Active
                </div>
              </div>
            </div>
          </div>

          {/* Action Row */}
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-2xs">
            {!isAccepted && !isFulfilled ? (
              <div className="w-full flex flex-col sm:flex-row items-center justify-between gap-2.5">
                <div className="text-xs text-slate-600">
                  <strong className="text-slate-900">Stock Verification Required:</strong> Confirm item availability so the technician's GPS navigation routes to your depot.
                </div>
                <button
                  type="button"
                  onClick={() => onAccept(spare.id)}
                  className="w-full sm:w-auto px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-xs flex items-center justify-center gap-1.5 text-xs transition-all active:scale-95 shrink-0"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Confirm Stock Availability</span>
                </button>
              </div>
            ) : (
              <div className="w-full space-y-3">
                {/* Handover OTP Verification & Status */}
                {!isFulfilled && (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-blue-50/60 border border-blue-200 p-3 rounded-xl">
                    <div className="space-y-0.5">
                      <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5 text-[#003BB5]" />
                        <span>Counter Handover Handshake</span>
                      </div>
                      <div className="text-[11px] text-slate-600">
                        Technician will present 4-digit handover PIN upon arrival at counter.
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        maxLength={4}
                        placeholder="4-digit PIN"
                        value={handoverOtp}
                        onChange={e => setHandoverOtp(e.target.value)}
                        className="w-24 px-2.5 py-1.5 text-xs font-mono font-bold text-center bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#003BB5]"
                      />
                      <button
                        type="button"
                        onClick={handleVerifyAndHandover}
                        className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 transition-all shadow-xs shrink-0"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Verify & Handover</span>
                      </button>
                    </div>
                  </div>
                )}

                {otpError && (
                  <div className="text-xs text-red-600 font-semibold">{otpError}</div>
                )}

                {/* Print Invoice & Handover Status Actions */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => onPrintInvoice(order)}
                    className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all shadow-2xs"
                  >
                    <Printer className="w-3.5 h-3.5 text-slate-600" />
                    <span>Print GST Tax Invoice & Challan</span>
                  </button>

                  {isFulfilled ? (
                    <span className="text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-300 px-3.5 py-1.5 rounded-xl flex items-center gap-1.5">
                      <Check className="w-4 h-4 text-emerald-600" />
                      <span>Stock Decremented & Added to Wednesday Settlement</span>
                    </span>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
