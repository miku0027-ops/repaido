import React, { useState, useEffect, useMemo } from 'react';
import {
  Boxes,
  FileSpreadsheet,
  Plus,
  Edit2,
  Trash2,
  CheckCircle2,
  Clock,
  Send,
  Download,
  Building2,
  ShieldCheck,
  Truck,
  Eye,
  X,
  FileText,
  BadgePercent,
  Search,
  Filter,
  DollarSign,
  TrendingUp,
  AlertCircle
} from 'lucide-react';
import type {
  B2BListing,
  B2BRfqRequest,
  B2BQuotation,
  B2BCategory,
  B2BUnit,
  B2BPriceSlab
} from '../types/b2b';
import { b2bService } from '../services/b2bService';
import { B2BQuotationPdfModal } from './B2BQuotationPdfModal';
import './shop-b2b.css';

interface ShopB2BSectionProps {
  shopId?: string;
  shopName?: string;
}

export const ShopB2BSection: React.FC<ShopB2BSectionProps> = ({
  shopId = 'shop-bls-01',
  shopName = 'Maa Tarini Spare Hub'
}) => {
  const [activeTab, setActiveTab] = useState<'listings' | 'rfqs'>('listings');
  const [listings, setListings] = useState<B2BListing[]>([]);
  const [rfqs, setRfqs] = useState<B2BRfqRequest[]>([]);
  const [rfqFilter, setRfqFilter] = useState<'all' | 'pending' | 'quoted'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Add / Edit Listing Modal State
  const [showListingModal, setShowListingModal] = useState(false);
  const [editingListingId, setEditingListingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<B2BCategory>('hvac');
  const [partNumber, setPartNumber] = useState('');
  const [hsnCode, setHsnCode] = useState('84149000');
  const [unit, setUnit] = useState<B2BUnit>('Boxes');
  const [moq, setMoq] = useState(10);
  const [basePrice, setBasePrice] = useState(1500);
  const [mrp, setMrp] = useState(2400);
  const [stock, setStock] = useState(200);
  const [leadTimeDays, setLeadTimeDays] = useState(2);
  const [supplyCapacity, setSupplyCapacity] = useState('1,500 Units / Month');
  const [description, setDescription] = useState('');
  const [image, setImage] = useState('/images/ac.jpg');

  // Dynamic Price Slabs for Add/Edit
  const [slabs, setSlabs] = useState<B2BPriceSlab[]>([
    { minQty: 10, maxQty: 24, pricePerUnit: 1500, discountLabel: 'Standard Wholesale' },
    { minQty: 25, pricePerUnit: 1350, discountLabel: 'Save 10% (Bulk)' }
  ]);

  // Quotation Generation Modal State
  const [activeRfqForQuote, setActiveRfqForQuote] = useState<B2BRfqRequest | null>(null);
  const [offeredRate, setOfferedRate] = useState<number>(1450);
  const [confirmedQuantity, setConfirmedQuantity] = useState<number>(10);
  const [gstRate, setGstRate] = useState<number>(0.18);
  const [freightCharges, setFreightCharges] = useState<number>(500);
  const [paymentTerms, setPaymentTerms] = useState('30% Advance via Repaido Escrow, 70% upon delivery inspection');
  const [deliveryTimeline, setDeliveryTimeline] = useState('Dispatched within 2 business days via Express Road Cargo');
  const [warrantyTerms, setWarrantyTerms] = useState('1 Year Manufacturer Replacement Guarantee with Test Certificates');
  const [validityDays, setValidityDays] = useState<number>(15);
  const [signatoryName, setSignatoryName] = useState('Authorized Merchant Director');
  const [signatoryDesignation, setSignatoryDesignation] = useState('Director of Commercial Wholesale');
  const [specialNotes, setSpecialNotes] = useState('');
  const [quoteSuccessMsg, setQuoteSuccessMsg] = useState('');

  // PDF Preview Modal
  const [previewQuotation, setPreviewQuotation] = useState<B2BQuotation | null>(null);

  // Load Data
  const refresh = () => {
    // Show listings belonging to this shop (or all if demo)
    const all = b2bService.getB2BListings();
    setListings(all.filter(l => l.shopId === shopId || !shopId));
    setRfqs(b2bService.getShopRFQs(shopId));
  };

  useEffect(() => {
    refresh();
    const unsub = b2bService.subscribe(refresh);
    return unsub;
  }, [shopId]);

  // Filtered RFQs
  const filteredRfqs = useMemo(() => {
    return rfqs.filter(r => {
      if (rfqFilter === 'pending') return r.status === 'pending';
      if (rfqFilter === 'quoted') return r.status === 'quoted' || r.status === 'accepted';
      return true;
    });
  }, [rfqs, rfqFilter]);

  // Overview Metrics
  const pendingRfqsCount = useMemo(() => rfqs.filter(r => r.status === 'pending').length, [rfqs]);
  const activeListingsCount = useMemo(() => listings.filter(l => l.status === 'active').length, [listings]);
  const quotedCount = useMemo(() => rfqs.filter(r => r.status === 'quoted' || r.status === 'accepted').length, [rfqs]);
  const totalPipelineValue = useMemo(() => {
    return rfqs.reduce((acc, curr) => {
      if (curr.quotation) return acc + curr.quotation.grandTotal;
      return acc + (curr.quantityRequested * (curr.targetPricePerUnit || 1000));
    }, 0);
  }, [rfqs]);

  // Handle Open Create/Edit Listing
  const handleOpenAddListing = () => {
    setEditingListingId(null);
    setTitle('');
    setCategory('hvac');
    setPartNumber(`PN-${Math.random().toString(36).substring(2, 7).toUpperCase()}`);
    setHsnCode('84149000');
    setUnit('Boxes');
    setMoq(10);
    setBasePrice(1500);
    setMrp(2400);
    setStock(200);
    setLeadTimeDays(2);
    setSupplyCapacity('1,500 Units / Month');
    setDescription('');
    setImage('/images/ac.jpg');
    setSlabs([
      { minQty: 10, maxQty: 24, pricePerUnit: 1500, discountLabel: 'Standard Wholesale' },
      { minQty: 25, pricePerUnit: 1350, discountLabel: 'Save 10% (Bulk)' }
    ]);
    setShowListingModal(true);
  };

  const handleOpenEditListing = (item: B2BListing) => {
    setEditingListingId(item.id);
    setTitle(item.title);
    setCategory(item.category);
    setPartNumber(item.partNumber);
    setHsnCode(item.hsnCode);
    setUnit(item.unit);
    setMoq(item.moq);
    setBasePrice(item.basePrice);
    setMrp(item.mrp);
    setStock(item.stock);
    setLeadTimeDays(item.leadTimeDays);
    setSupplyCapacity(item.supplyCapacity);
    setDescription(item.description);
    setImage(item.image);
    setSlabs(item.bulkSlabs.length > 0 ? item.bulkSlabs : [
      { minQty: item.moq, pricePerUnit: item.basePrice, discountLabel: 'Standard Bulk' }
    ]);
    setShowListingModal(true);
  };

  // Save Listing
  const handleSaveListing = (e: React.FormEvent) => {
    e.preventDefault();
    b2bService.saveB2BListing({
      id: editingListingId || undefined,
      shopId,
      shopName,
      distributorName: `${shopName} Wholesale & Commercial Supplies`,
      title,
      category,
      partNumber,
      hsnCode,
      unit,
      moq: Number(moq),
      basePrice: Number(basePrice),
      mrp: Number(mrp),
      bulkSlabs: slabs,
      stock: Number(stock),
      leadTimeDays: Number(leadTimeDays),
      supplyCapacity,
      description,
      image,
      status: 'active'
    });
    setShowListingModal(false);
    refresh();
  };

  const handleDeleteListing = (id: string) => {
    if (confirm('Are you sure you want to delete this B2B wholesale listing?')) {
      b2bService.deleteB2BListing(id);
      refresh();
    }
  };

  const handleToggleStatus = (id: string) => {
    b2bService.toggleListingStatus(id);
    refresh();
  };

  // Open Quotation Generator Form
  const handleOpenQuotationForm = (rfq: B2BRfqRequest) => {
    setActiveRfqForQuote(rfq);
    setConfirmedQuantity(rfq.quantityRequested);
    setOfferedRate(rfq.targetPricePerUnit || 1400);
    setGstRate(0.18);
    setFreightCharges(500);
    setQuoteSuccessMsg('');
  };

  // Submit Official Quotation
  const handleSubmitQuotation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRfqForQuote) return;

    const issued = b2bService.generateQuotation(activeRfqForQuote.id, {
      offeredRate: Number(offeredRate),
      quantity: Number(confirmedQuantity),
      gstRate: Number(gstRate),
      freightCharges: Number(freightCharges),
      paymentTerms,
      deliveryTimeline,
      warrantyTerms,
      validityDays: Number(validityDays),
      authorizedSignatory: signatoryName,
      signatoryDesignation,
      specialNotes
    });

    if (issued) {
      setQuoteSuccessMsg(`Official Quotation ${issued.quoteNumber} successfully generated and dispatched to buyer ${activeRfqForQuote.customerName}!`);
      setTimeout(() => {
        setPreviewQuotation(issued);
        setActiveRfqForQuote(null);
        refresh();
      }, 1400);
    }
  };

  // Calculated values in Quote form
  const calcTaxable = Math.round(confirmedQuantity * offeredRate);
  const calcGst = Math.round(calcTaxable * gstRate);
  const calcGrandTotal = calcTaxable + calcGst + Math.round(Number(freightCharges) || 0);

  return (
    <div className="shop-b2b-panel">
      {/* Header Area */}
      <div className="shop-b2b-header">
        <div className="shop-b2b-title-area">
          <h2>
            <Boxes size={22} className="text-[#142858]" />
            B2B &amp; Wholesale Commercial Hub
          </h2>
          <p>
            Manage industrial &amp; bulk wholesale catalog, set Minimum Order Quantities (MOQ), tiered slab pricing, and issue official Repaido Quotations.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            className="px-4 py-2 bg-[#142858] hover:bg-[#0f2048] text-white text-xs font-bold rounded-xl flex items-center gap-2 shadow-sm transition-all"
            onClick={handleOpenAddListing}
          >
            <Plus size={16} />
            Add Wholesale Listing
          </button>
        </div>
      </div>

      {/* Pulse Overview Metrics */}
      <div className="shop-b2b-metrics-grid">
        <div className="shop-b2b-metric-card">
          <div className="shop-b2b-metric-icon blue">
            <Boxes size={22} />
          </div>
          <div className="shop-b2b-metric-data">
            <strong>{activeListingsCount} / {listings.length}</strong>
            <span>Active B2B Listings</span>
          </div>
        </div>

        <div className="shop-b2b-metric-card">
          <div className="shop-b2b-metric-icon amber">
            <Clock size={22} />
          </div>
          <div className="shop-b2b-metric-data">
            <strong className="text-amber-700">{pendingRfqsCount}</strong>
            <span>Pending RFQ Quotes</span>
          </div>
        </div>

        <div className="shop-b2b-metric-card">
          <div className="shop-b2b-metric-icon emerald">
            <CheckCircle2 size={22} />
          </div>
          <div className="shop-b2b-metric-data">
            <strong className="text-emerald-700">{quotedCount}</strong>
            <span>Issued Quotations</span>
          </div>
        </div>

        <div className="shop-b2b-metric-card">
          <div className="shop-b2b-metric-icon purple">
            <TrendingUp size={22} />
          </div>
          <div className="shop-b2b-metric-data">
            <strong>₹{(totalPipelineValue / 1000).toFixed(1)}k</strong>
            <span>Active B2B Pipeline</span>
          </div>
        </div>
      </div>

      {/* Subtabs Bar */}
      <div className="shop-b2b-tabs-bar">
        <button
          type="button"
          className={`shop-b2b-tab-btn ${activeTab === 'listings' ? 'active' : ''}`}
          onClick={() => setActiveTab('listings')}
        >
          <Boxes size={16} />
          Wholesale Inventory ({listings.length})
        </button>

        <button
          type="button"
          className={`shop-b2b-tab-btn ${activeTab === 'rfqs' ? 'active' : ''}`}
          onClick={() => setActiveTab('rfqs')}
        >
          <FileSpreadsheet size={16} />
          Quotation Inquiries (RFQs) ({rfqs.length})
          {pendingRfqsCount > 0 && (
            <span className="bg-amber-500 text-white text-[10px] font-extrabold px-1.5 py-0.5 rounded-full ml-1">
              {pendingRfqsCount} PENDING
            </span>
          )}
        </button>
      </div>

      {/* TAB 1: WHOLESALE LISTINGS */}
      {activeTab === 'listings' && (
        <div className="shop-b2b-table-card">
          <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2 text-xs">
            <span className="font-bold text-slate-700">
              Your Published Wholesale &amp; Bulk Items (Visible on Customer B2B Tab)
            </span>
            <span className="text-slate-500">
              Prices reflect distributor bulk rates with verified GST compliance.
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="shop-b2b-table">
              <thead>
                <tr>
                  <th>Product &amp; Category</th>
                  <th>HSN Code</th>
                  <th>MOQ &amp; Unit</th>
                  <th>Wholesale Rate &amp; MRP</th>
                  <th>Volume Slabs</th>
                  <th>Stock &amp; SLA</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {listings.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-slate-500">
                      No B2B items listed yet. Click "+ Add Wholesale Listing" to create your first bulk item!
                    </td>
                  </tr>
                ) : (
                  listings.map(item => (
                    <tr key={item.id}>
                      <td>
                        <div className="flex items-center gap-3">
                          <img
                            src={item.image}
                            alt=""
                            className="w-10 h-10 rounded-lg object-cover bg-slate-100 border border-slate-200 shrink-0"
                            onError={(e) => { e.currentTarget.src = '/images/ac.jpg'; }}
                          />
                          <div>
                            <strong className="text-slate-900 block font-semibold">{item.title}</strong>
                            <span className="text-[11px] text-slate-500 uppercase">{item.category} · PN: {item.partNumber}</span>
                          </div>
                        </div>
                      </td>
                      <td className="font-mono text-slate-700 font-semibold">{item.hsnCode}</td>
                      <td>
                        <span className="font-bold text-[#142858]">
                          {item.moq} {item.unit}
                        </span>
                      </td>
                      <td>
                        <strong className="text-slate-900 font-bold block">₹{item.basePrice.toLocaleString('en-IN')}</strong>
                        <span className="text-[11px] text-slate-400 line-through">MRP: ₹{item.mrp}</span>
                      </td>
                      <td>
                        <div className="text-[11px] space-y-0.5 text-slate-600">
                          {item.bulkSlabs.slice(0, 2).map((s, i) => (
                            <div key={i}>
                              {s.minQty}{s.maxQty ? `-${s.maxQty}` : '+'}: <strong>₹{s.pricePerUnit}</strong>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td>
                        <span className="block font-semibold text-slate-800">{item.stock} in stock</span>
                        <span className="text-[11px] text-slate-500">{item.leadTimeDays}d dispatch</span>
                      </td>
                      <td>
                        <span className={`shop-status-badge ${item.status}`}>
                          {item.status === 'active' ? 'Active' : 'Paused'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
                            title={item.status === 'active' ? 'Pause Listing' : 'Activate Listing'}
                            onClick={() => handleToggleStatus(item.id)}
                          >
                            <Clock size={15} />
                          </button>
                          <button
                            type="button"
                            className="p-1.5 text-blue-600 hover:text-blue-900 hover:bg-blue-50 rounded-lg"
                            title="Edit Listing"
                            onClick={() => handleOpenEditListing(item)}
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            type="button"
                            className="p-1.5 text-red-500 hover:text-red-800 hover:bg-red-50 rounded-lg"
                            title="Delete Listing"
                            onClick={() => handleDeleteListing(item.id)}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: QUOTATION REQUESTS (RFQS) */}
      {activeTab === 'rfqs' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex gap-2">
              <button
                type="button"
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${rfqFilter === 'all' ? 'bg-[#142858] text-white' : 'bg-white text-slate-600 border border-slate-300'}`}
                onClick={() => setRfqFilter('all')}
              >
                All RFQs ({rfqs.length})
              </button>
              <button
                type="button"
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${rfqFilter === 'pending' ? 'bg-[#142858] text-white' : 'bg-white text-slate-600 border border-slate-300'}`}
                onClick={() => setRfqFilter('pending')}
              >
                Pending Review ({pendingRfqsCount})
              </button>
              <button
                type="button"
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${rfqFilter === 'quoted' ? 'bg-[#142858] text-white' : 'bg-white text-slate-600 border border-slate-300'}`}
                onClick={() => setRfqFilter('quoted')}
              >
                Quoted / Won ({quotedCount})
              </button>
            </div>
          </div>

          <div className="shop-b2b-table-card">
            <div className="overflow-x-auto">
              <table className="shop-b2b-table">
                <thead>
                  <tr>
                    <th>RFQ Ref &amp; Date</th>
                    <th>Requested Item</th>
                    <th>Buyer &amp; Company</th>
                    <th>Qty &amp; Target Rate</th>
                    <th>Destination &amp; Urgency</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Quotation Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRfqs.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-12 text-slate-500">
                        No quotation requests match this filter.
                      </td>
                    </tr>
                  ) : (
                    filteredRfqs.map(rfq => (
                      <tr key={rfq.id}>
                        <td>
                          <span className="font-mono text-slate-800 font-bold block">{rfq.id}</span>
                          <span className="text-[11px] text-slate-400">
                            {new Date(rfq.createdAt).toLocaleDateString('en-IN')}
                          </span>
                        </td>
                        <td>
                          <strong className="text-slate-900 block font-semibold">{rfq.itemTitle}</strong>
                          <span className="text-[11px] text-slate-500 font-mono">HSN {rfq.hsnCode}</span>
                        </td>
                        <td>
                          <strong className="text-slate-900 block">{rfq.buyerCompanyName || rfq.customerName}</strong>
                          <span className="text-[11px] text-slate-500">{rfq.customerPhone}</span>
                          {rfq.buyerGstin && (
                            <span className="text-[10px] text-blue-700 block font-mono">GST: {rfq.buyerGstin}</span>
                          )}
                        </td>
                        <td>
                          <span className="font-bold text-[#142858] block">
                            {rfq.quantityRequested} {rfq.unit}
                          </span>
                          <span className="text-[11px] text-slate-600">
                            Target: {rfq.targetPricePerUnit ? `₹${rfq.targetPricePerUnit}` : 'Best Offer'}
                          </span>
                        </td>
                        <td>
                          <span className="block text-slate-800">{rfq.deliveryCity} - {rfq.deliveryPincode}</span>
                          <span className="text-[11px] text-amber-700 font-semibold capitalize">
                            {rfq.urgency.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td>
                          {rfq.status === 'pending' && (
                            <span className="shop-status-badge paused">
                              <Clock size={11} />
                              Pending Quote
                            </span>
                          )}
                          {rfq.status === 'quoted' && (
                            <span className="shop-status-badge active">
                              <CheckCircle2 size={11} />
                              Quote Sent
                            </span>
                          )}
                          {rfq.status === 'accepted' && (
                            <span className="shop-status-badge active">
                              <CheckCircle2 size={11} />
                              Deal Closed
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {rfq.status === 'pending' ? (
                            <button
                              type="button"
                              className="px-3 py-1.5 bg-[#142858] hover:bg-[#0f2048] text-white text-xs font-bold rounded-lg inline-flex items-center gap-1.5 shadow-sm"
                              onClick={() => handleOpenQuotationForm(rfq)}
                            >
                              <FileSpreadsheet size={14} />
                              Generate Quote
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-lg inline-flex items-center gap-1.5 border border-slate-300"
                              onClick={() => rfq.quotation && setPreviewQuotation(rfq.quotation)}
                            >
                              <FileText size={14} />
                              View Quote PDF
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: ADD / EDIT B2B LISTING */}
      {showListingModal && (
        <div className="shop-quote-modal-overlay">
          <div className="shop-quote-modal-box">
            <div className="shop-quote-modal-header">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Boxes size={18} />
                {editingListingId ? 'Edit B2B Wholesale Listing' : 'Create New B2B Wholesale Listing'}
              </h3>
              <button
                type="button"
                className="text-white hover:opacity-80"
                onClick={() => setShowListingModal(false)}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveListing} className="shop-quote-modal-body">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="b2b-input-group sm:col-span-2">
                  <label>Listing Title &amp; Commercial Description *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Pure Copper Tubing Coil 1/2 Inch 50ft ASTM B280"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>

                <div className="b2b-input-group">
                  <label>Category *</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as B2BCategory)}
                  >
                    <option value="hvac">HVAC &amp; Refrigeration</option>
                    <option value="electrical">Electrical &amp; Switchgear</option>
                    <option value="plumbing">Plumbing &amp; Sanitary</option>
                    <option value="tools">Power Tools &amp; Equipment</option>
                    <option value="refrigerants">Refrigerants &amp; Gases</option>
                    <option value="appliances">Commercial Appliances</option>
                    <option value="hardware">General Hardware</option>
                  </select>
                </div>

                <div className="b2b-input-group">
                  <label>HSN / SAC Code (Mandatory for GST) *</label>
                  <input
                    type="text"
                    required
                    pattern="[0-9]{4,8}"
                    placeholder="e.g. 74112100"
                    value={hsnCode}
                    onChange={(e) => setHsnCode(e.target.value)}
                  />
                </div>

                <div className="b2b-input-group">
                  <label>Unit of Measure *</label>
                  <select
                    value={unit}
                    onChange={(e) => setUnit(e.target.value as B2BUnit)}
                  >
                    <option value="Boxes">Boxes</option>
                    <option value="Rolls">Rolls</option>
                    <option value="Pieces">Pieces</option>
                    <option value="Bundles">Bundles</option>
                    <option value="Cartons">Cartons</option>
                    <option value="Meters">Meters</option>
                    <option value="Kg">Kg</option>
                  </select>
                </div>

                <div className="b2b-input-group">
                  <label>Minimum Order Quantity (MOQ) *</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={moq}
                    onChange={(e) => setMoq(Number(e.target.value))}
                  />
                </div>

                <div className="b2b-input-group">
                  <label>Base Wholesale Rate per {unit.replace(/s$/, '')} (₹) *</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={basePrice}
                    onChange={(e) => setBasePrice(Number(e.target.value))}
                  />
                </div>

                <div className="b2b-input-group">
                  <label>Retail MRP for Reference (₹) *</label>
                  <input
                    type="number"
                    min={basePrice}
                    required
                    value={mrp}
                    onChange={(e) => setMrp(Number(e.target.value))}
                  />
                </div>

                <div className="b2b-input-group">
                  <label>Available Stock Quantity ({unit})</label>
                  <input
                    type="number"
                    min={0}
                    value={stock}
                    onChange={(e) => setStock(Number(e.target.value))}
                  />
                </div>

                <div className="b2b-input-group">
                  <label>Lead Time to Dispatch (Days)</label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={leadTimeDays}
                    onChange={(e) => setLeadTimeDays(Number(e.target.value))}
                  />
                </div>

                <div className="b2b-input-group sm:col-span-2">
                  <label>Monthly Supply Capacity</label>
                  <input
                    type="text"
                    placeholder="e.g. 2,000 Rolls / Month"
                    value={supplyCapacity}
                    onChange={(e) => setSupplyCapacity(e.target.value)}
                  />
                </div>

                <div className="b2b-input-group sm:col-span-2">
                  <label>Technical Specifications &amp; Standards</label>
                  <textarea
                    rows={2}
                    placeholder="Material grades, pressure limits, certifications (e.g. ASTM, ISI, CE)..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  onClick={() => setShowListingModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#142858] hover:bg-[#0f2048] text-white rounded-lg text-xs font-bold shadow-sm"
                >
                  {editingListingId ? 'Save Changes' : 'Publish Wholesale Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: GENERATE OFFICIAL QUOTATION */}
      {activeRfqForQuote && (
        <div className="shop-quote-modal-overlay">
          <div className="shop-quote-modal-box">
            <div className="shop-quote-modal-header">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <FileSpreadsheet size={18} />
                Generate Official Commercial Quotation for RFQ {activeRfqForQuote.id}
              </h3>
              <button
                type="button"
                className="text-white hover:opacity-80"
                onClick={() => setActiveRfqForQuote(null)}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmitQuotation} className="shop-quote-modal-body">
              {/* Buyer Context Card */}
              <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl text-xs">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase block">Buyer</span>
                    <strong>{activeRfqForQuote.buyerCompanyName || activeRfqForQuote.customerName}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase block">Requested Qty</span>
                    <strong>{activeRfqForQuote.quantityRequested} {activeRfqForQuote.unit}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase block">Destination</span>
                    <span>{activeRfqForQuote.deliveryCity} ({activeRfqForQuote.deliveryPincode})</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase block">Target Price</span>
                    <span>{activeRfqForQuote.targetPricePerUnit ? `₹${activeRfqForQuote.targetPricePerUnit}` : 'Open to quote'}</span>
                  </div>
                </div>
              </div>

              {quoteSuccessMsg && (
                <div className="p-3 bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-xl text-xs font-semibold flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                  {quoteSuccessMsg}
                </div>
              )}

              {/* Commercial Terms Form */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="b2b-input-group">
                  <label>Offered Rate / {activeRfqForQuote.unit.replace(/s$/, '')} (₹) *</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={offeredRate}
                    onChange={(e) => setOfferedRate(Number(e.target.value))}
                  />
                </div>

                <div className="b2b-input-group">
                  <label>Confirmed Quantity ({activeRfqForQuote.unit}) *</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={confirmedQuantity}
                    onChange={(e) => setConfirmedQuantity(Number(e.target.value))}
                  />
                </div>

                <div className="b2b-input-group">
                  <label>GST Slab *</label>
                  <select
                    value={gstRate}
                    onChange={(e) => setGstRate(Number(e.target.value))}
                  >
                    <option value={0.18}>18% (Standard Industrial)</option>
                    <option value={0.12}>12% (Equipment / Machinery)</option>
                    <option value={0.05}>5% (Essential Goods)</option>
                    <option value={0.28}>28% (Luxury / Air Conditioners)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="b2b-input-group">
                  <label>Freight &amp; Cargo Handling Charges (₹)</label>
                  <input
                    type="number"
                    min={0}
                    value={freightCharges}
                    onChange={(e) => setFreightCharges(Number(e.target.value))}
                  />
                  <span className="text-[10px] text-slate-500 mt-1 block">Set 0 for Free Cargo Delivery</span>
                </div>

                <div className="b2b-input-group">
                  <label>Quotation Validity</label>
                  <select
                    value={validityDays}
                    onChange={(e) => setValidityDays(Number(e.target.value))}
                  >
                    <option value={7}>7 Days</option>
                    <option value={15}>15 Days (Recommended)</option>
                    <option value={30}>30 Days</option>
                  </select>
                </div>
              </div>

              {/* Real-time Commercial Breakdown Card */}
              <div className="shop-quote-breakdown-card">
                <div className="text-xs font-bold text-slate-700 uppercase mb-2">Commercial Summary Preview</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div>
                    <span className="text-slate-500 block">Taxable Subtotal:</span>
                    <strong className="text-slate-900 font-mono">₹{calcTaxable.toLocaleString('en-IN')}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block">GST ({Math.round(gstRate * 100)}%):</span>
                    <strong className="text-slate-900 font-mono">₹{calcGst.toLocaleString('en-IN')}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Freight / Logistics:</span>
                    <strong className="text-slate-900 font-mono">₹{freightCharges.toLocaleString('en-IN')}</strong>
                  </div>
                  <div>
                    <span className="text-emerald-700 font-bold block">Grand Total:</span>
                    <strong className="text-emerald-800 font-bold font-mono text-sm">₹{calcGrandTotal.toLocaleString('en-IN')}</strong>
                  </div>
                </div>
              </div>

              <div className="b2b-input-group">
                <label>Payment Terms *</label>
                <input
                  type="text"
                  required
                  value={paymentTerms}
                  onChange={(e) => setPaymentTerms(e.target.value)}
                />
              </div>

              <div className="b2b-input-group">
                <label>Delivery Timeline &amp; Logistics Mode *</label>
                <input
                  type="text"
                  required
                  value={deliveryTimeline}
                  onChange={(e) => setDeliveryTimeline(e.target.value)}
                />
              </div>

              <div className="b2b-input-group">
                <label>Warranty &amp; Quality Guarantee Terms *</label>
                <input
                  type="text"
                  required
                  value={warrantyTerms}
                  onChange={(e) => setWarrantyTerms(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="b2b-input-group">
                  <label>Authorized Signatory Name *</label>
                  <input
                    type="text"
                    required
                    value={signatoryName}
                    onChange={(e) => setSignatoryName(e.target.value)}
                  />
                </div>

                <div className="b2b-input-group">
                  <label>Signatory Designation *</label>
                  <input
                    type="text"
                    required
                    value={signatoryDesignation}
                    onChange={(e) => setSignatoryDesignation(e.target.value)}
                  />
                </div>
              </div>

              <div className="b2b-input-group">
                <label>Special Instructions / Packaging Remarks</label>
                <textarea
                  rows={2}
                  placeholder="e.g. Moisture barrier wrap, wooden pallet crating, test certificate attached..."
                  value={specialNotes}
                  onChange={(e) => setSpecialNotes(e.target.value)}
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  onClick={() => setActiveRfqForQuote(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm"
                >
                  <Send size={14} />
                  Submit Official Quotation to Buyer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PDF PREVIEW MODAL */}
      {previewQuotation && (
        <B2BQuotationPdfModal
          quotation={previewQuotation}
          onClose={() => setPreviewQuotation(null)}
          isBuyer={false}
        />
      )}
    </div>
  );
};
