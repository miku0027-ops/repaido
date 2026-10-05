import React, { useRef } from 'react';
import {
  X,
  Printer,
  Download,
  ShieldCheck,
  Building2,
  Phone,
  Mail,
  FileText,
  Calendar,
  MapPin,
  Truck,
  Lock,
  CheckCircle2,
  Clock
} from 'lucide-react';
import type { B2BQuotation } from '../types/b2b';
import { numberToWordsINR } from '../services/b2bService';
import './b2b-quotation.css';

interface B2BQuotationPdfModalProps {
  quotation: B2BQuotation;
  onClose: () => void;
  onAccept?: (rfqId: string) => void;
  isBuyer?: boolean;
}

export const B2BQuotationPdfModal: React.FC<B2BQuotationPdfModalProps> = ({
  quotation,
  onClose,
  onAccept,
  isBuyer = true
}) => {
  const printableRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    window.print();
  };

  const handleDownload = () => {
    // Triggers system print-to-pdf dialog
    window.print();
  };

  return (
    <div
      className="b2b-quotation-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="b2b-quote-title"
    >
      <div className="b2b-quotation-modal-container">
        {/* Modal Top Control Bar */}
        <div className="b2b-quotation-modal-header">
          <h2 id="b2b-quote-title">
            <FileText size={18} aria-hidden="true" />
            Official Commercial Quotation — {quotation.quoteNumber}
          </h2>
          <button
            type="button"
            className="b2b-btn-close"
            onClick={onClose}
            aria-label="Close Quotation"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Toolbar Actions */}
        <div className="b2b-quotation-modal-actions">
          <div className="flex items-center gap-2 text-xs text-slate-600 font-medium">
            <span className="flex items-center gap-1.5 bg-blue-50 text-blue-800 px-2.5 py-1 rounded-full border border-blue-200">
              <ShieldCheck size={14} className="text-blue-600" />
              Repaido B2B Escrow Protected
            </span>
            <span className="flex items-center gap-1 bg-amber-50 text-amber-800 px-2.5 py-1 rounded-full border border-amber-200">
              <Clock size={13} />
              Valid until {quotation.validUntil}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors border border-slate-300"
              onClick={handlePrint}
            >
              <Printer size={15} />
              Print / Save PDF (A4)
            </button>
            <button
              type="button"
              className="px-4 py-1.5 bg-[#142858] hover:bg-[#0f2048] text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shadow-sm transition-all"
              onClick={handleDownload}
            >
              <Download size={15} />
              Download Official PDF
            </button>
            {isBuyer && onAccept && (
              <button
                type="button"
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shadow-sm transition-all"
                onClick={() => {
                  onAccept(quotation.rfqId);
                  onClose();
                }}
              >
                <CheckCircle2 size={15} />
                Accept Deal
              </button>
            )}
          </div>
        </div>

        {/* Modal Printable Sheet Container */}
        <div className="b2b-quotation-modal-scroll">
          <article className="repaido-quotation-sheet" ref={printableRef}>
            {/* Top Branding Banner */}
            <header className="repaido-quote-header">
              <div className="repaido-quote-logo-col">
                <img
                  src="/brand/repaido-icon-squircle.png"
                  alt="Repaido Logo"
                  className="repaido-quote-logo-img"
                  onError={(e) => {
                    // Fallback to text shield if asset missing
                    e.currentTarget.style.display = 'none';
                  }}
                />
                <div>
                  <h1 className="repaido-quote-brand-title">REPAIDO</h1>
                  <p className="repaido-quote-brand-sub">
                    Commercial Wholesale &amp; Bulk Procurement
                  </p>
                </div>
              </div>

              <div className="repaido-quote-title-col">
                <p className="repaido-quote-doctype">TAX QUOTATION</p>
                <p className="repaido-quote-num">{quotation.quoteNumber}</p>
                <div className="repaido-quote-meta-row">
                  <span><strong>Date:</strong> {new Date(quotation.createdAt).toLocaleDateString('en-IN')}</span>
                  <span><strong>Valid Until:</strong> {quotation.validUntil}</span>
                  <span><strong>State Code:</strong> 21 (Odisha)</span>
                </div>
              </div>
            </header>

            {/* Parties Grid (Supplier vs Buyer) */}
            <section className="repaido-quote-parties-grid">
              {/* Supplier / Distributor */}
              <div className="repaido-quote-party-box">
                <h4>
                  <Building2 size={13} />
                  Seller / Distributor
                </h4>
                <p className="repaido-quote-party-name">{quotation.distributorName || quotation.shopName}</p>
                <div className="repaido-quote-party-meta">
                  <p><strong>GSTIN:</strong> {quotation.distributorGstin}</p>
                  <p>{quotation.shopAddress}</p>
                  <p className="flex items-center gap-2 mt-1">
                    <span><Phone size={11} className="inline mr-1" />{quotation.shopPhone}</span>
                    <span><Mail size={11} className="inline mr-1" />{quotation.shopEmail}</span>
                  </p>
                </div>
                <div className="repaido-quote-badge-verified">
                  <ShieldCheck size={12} />
                  Verified Repaido B2B Merchant
                </div>
              </div>

              {/* Buyer / Inquirer */}
              <div className="repaido-quote-party-box">
                <h4>
                  <MapPin size={13} />
                  Buyer / Consignee
                </h4>
                <p className="repaido-quote-party-name">
                  {quotation.buyerCompanyName || quotation.customerName}
                </p>
                <div className="repaido-quote-party-meta">
                  {quotation.buyerCompanyName && (
                    <p><strong>Contact:</strong> {quotation.customerName}</p>
                  )}
                  <p>
                    <strong>GSTIN:</strong> {quotation.buyerGstin || 'Unregistered / Commercial Retailer'}
                  </p>
                  <p><strong>Delivery Destination:</strong></p>
                  <p>{quotation.deliveryAddress}, {quotation.deliveryCity} - {quotation.deliveryPincode}</p>
                </div>
              </div>
            </section>

            {/* Itemized Commercial Table */}
            <section className="repaido-quote-table-wrapper">
              <table className="repaido-quote-table">
                <thead>
                  <tr>
                    <th style={{ width: '5%' }}>#</th>
                    <th style={{ width: '45%' }}>Item Description &amp; Specifications</th>
                    <th style={{ width: '12%' }}>HSN / SAC</th>
                    <th style={{ width: '12%' }} className="text-right">Qty &amp; Unit</th>
                    <th style={{ width: '13%' }} className="text-right">Unit Rate (₹)</th>
                    <th style={{ width: '13%' }} className="text-right">Taxable (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>1</td>
                    <td>
                      <p className="repaido-quote-item-title">{quotation.itemTitle}</p>
                      <p className="repaido-quote-item-specs">
                        Part No: {quotation.partNumber} · Conforms to commercial industrial specifications
                      </p>
                    </td>
                    <td>{quotation.hsnCode}</td>
                    <td className="text-right font-semibold">
                      {quotation.quantity} {quotation.unit}
                    </td>
                    <td className="text-right font-mono">
                      ₹{quotation.offeredRate.toLocaleString('en-IN')}
                    </td>
                    <td className="text-right font-mono font-bold">
                      ₹{quotation.taxableAmount.toLocaleString('en-IN')}
                    </td>
                  </tr>
                </tbody>
              </table>
            </section>

            {/* Totals & Breakdown */}
            <section className="repaido-quote-totals-grid">
              <div className="repaido-quote-words-box">
                <p className="repaido-quote-words-label">Total Amount in Words:</p>
                <p className="repaido-quote-words-val">{numberToWordsINR(quotation.grandTotal)}</p>

                {quotation.specialNotes && (
                  <div className="mt-3 pt-2 border-t border-slate-200">
                    <p className="text-[10px] font-bold text-slate-500 uppercase">Special Packing / Logistics Note:</p>
                    <p className="text-xs text-slate-700 mt-0.5">{quotation.specialNotes}</p>
                  </div>
                )}
              </div>

              <div>
                <table className="repaido-quote-totals-table">
                  <tbody>
                    <tr>
                      <td className="text-slate-600">Taxable Value:</td>
                      <td className="text-right font-mono font-semibold">
                        ₹{quotation.taxableAmount.toLocaleString('en-IN')}
                      </td>
                    </tr>
                    <tr>
                      <td className="text-slate-600">
                        GST ({Math.round(quotation.gstRate * 100)}%):
                      </td>
                      <td className="text-right font-mono font-semibold">
                        ₹{quotation.gstAmount.toLocaleString('en-IN')}
                      </td>
                    </tr>
                    <tr>
                      <td className="text-slate-600">Freight &amp; Cargo Handling:</td>
                      <td className="text-right font-mono font-semibold">
                        {quotation.freightCharges === 0 ? (
                          <span className="text-emerald-700 font-bold">FREE CARGO</span>
                        ) : (
                          `₹${quotation.freightCharges.toLocaleString('en-IN')}`
                        )}
                      </td>
                    </tr>
                    <tr className="grand-total-row">
                      <td>Grand Total (INR):</td>
                      <td className="text-right font-mono">
                        ₹{quotation.grandTotal.toLocaleString('en-IN')}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {/* Commercial Terms & Conditions */}
            <section className="repaido-quote-terms-box">
              <h4>Commercial Terms &amp; Scope of Supply</h4>
              <ol className="repaido-quote-terms-list">
                <li>
                  <strong>Payment Terms:</strong> {quotation.paymentTerms}. All payments deposited through Repaido B2B Escrow remain protected until delivery confirmation.
                </li>
                <li>
                  <strong>Logistics &amp; Dispatch:</strong> {quotation.deliveryTimeline}. Doorstep unloading to ground floor included.
                </li>
                <li>
                  <strong>Quality &amp; Inspection:</strong> {quotation.warrantyTerms}. Buyer has 48 hours from delivery timestamp to raise transit damage or discrepancy reports.
                </li>
                <li>
                  <strong>Validity:</strong> This quotation is firm for {quotation.validityDays} days from date of issuance ({quotation.validUntil}). Subsequent adjustments may apply based on commodity metal fluctuations.
                </li>
              </ol>
            </section>

            {/* Authorization & Signature Block */}
            <footer className="repaido-quote-signatures">
              <div className="repaido-quote-sig-box">
                <div className="repaido-quote-stamp-mark">
                  <span>★ REPAIDO ★</span>
                  <span style={{ fontSize: '8px' }}>AUTHENTICATED</span>
                  <span>B2B ESCROW</span>
                </div>
                <p className="repaido-quote-sig-title">Platform Verification Seal</p>
                <p className="repaido-quote-sig-sub">Repaido Technologies India Pvt Ltd</p>
              </div>

              <div className="repaido-quote-sig-box" style={{ borderLeft: '1px dashed #cbd5e1' }}>
                <div style={{ height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontFamily: 'cursive', fontSize: '18px', color: '#142858' }}>
                    {quotation.authorizedSignatory}
                  </span>
                </div>
                <p className="repaido-quote-sig-title">{quotation.authorizedSignatory}</p>
                <p className="repaido-quote-sig-sub">{quotation.signatoryDesignation}</p>
              </div>
            </footer>
          </article>
        </div>
      </div>
    </div>
  );
};
