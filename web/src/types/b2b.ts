/**
 * Types for Repaido B2B, Wholesale & Bulk Ordering Hub.
 * IndiaMART / Udaan style bulk trade with MOQ, tier pricing, RFQs & Quotations.
 */

export interface B2BPriceSlab {
  minQty: number;
  maxQty?: number;
  pricePerUnit: number; // in INR
  discountLabel: string; // e.g. "Save 12%"
}

export type B2BUnit = 'Boxes' | 'Pieces' | 'Rolls' | 'Meters' | 'Bundles' | 'Kg' | 'Sets' | 'Cartons' | 'Packs';

export type B2BCategory = 
  | 'hvac'
  | 'electrical'
  | 'plumbing'
  | 'tools'
  | 'refrigerants'
  | 'appliances'
  | 'hardware';

export interface B2BListing {
  id: string;
  shopId: string;
  shopName: string;
  distributorName: string;
  phone: string;
  email: string;
  gstin: string;
  city: string;
  address: string;
  title: string;
  category: B2BCategory;
  partNumber: string;
  hsnCode: string; // e.g. "74112100"
  unit: B2BUnit;
  moq: number; // Minimum Order Quantity
  basePrice: number; // Base wholesale rate per unit (INR)
  mrp: number; // Retail MRP for comparison
  bulkSlabs: B2BPriceSlab[];
  stock: number; // Available wholesale units
  leadTimeDays: number; // Dispatch SLA
  supplyCapacity: string; // e.g. "2,500 Rolls / Month"
  description: string;
  specifications: Record<string, string>;
  image: string;
  status: 'active' | 'paused' | 'archived';
  verifiedDistributor: boolean;
  createdAt: number;
  updatedAt: number;
}

export type RFQUrgency = 'immediate' | 'within_7_days' | 'within_15_days' | 'flexible';

export type RFQStatus = 'pending' | 'quoted' | 'accepted' | 'declined';

export interface B2BRfqRequest {
  id: string; // e.g. "rfq-2026-9182"
  listingId: string;
  itemTitle: string;
  category: B2BCategory;
  hsnCode: string;
  unit: B2BUnit;
  shopId: string;
  shopName: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  buyerCompanyName?: string;
  buyerGstin?: string;
  deliveryAddress: string;
  deliveryCity: string;
  deliveryPincode: string;
  quantityRequested: number;
  targetPricePerUnit?: number;
  urgency: RFQUrgency;
  notes: string;
  status: RFQStatus;
  createdAt: number;
  updatedAt: number;
  quotation?: B2BQuotation;
}

export interface B2BQuotation {
  quoteNumber: string; // e.g. "REP-B2B-QT-2026-4819"
  rfqId: string;
  shopId: string;
  shopName: string;
  distributorName: string;
  distributorGstin: string;
  shopAddress: string;
  shopPhone: string;
  shopEmail: string;
  customerName: string;
  buyerCompanyName?: string;
  buyerGstin?: string;
  deliveryAddress: string;
  deliveryCity: string;
  deliveryPincode: string;
  itemTitle: string;
  partNumber: string;
  hsnCode: string;
  unit: B2BUnit;
  quantity: number;
  offeredRate: number; // per unit INR
  taxableAmount: number; // quantity * offeredRate
  gstRate: number; // 0.18, 0.12, 0.05
  gstAmount: number; // taxableAmount * gstRate
  freightCharges: number; // in INR
  grandTotal: number; // taxableAmount + gstAmount + freightCharges
  paymentTerms: string; // e.g. "30% Advance via Repaido Escrow, 70% upon delivery inspection"
  deliveryTimeline: string; // e.g. "Dispatched within 2-3 Business Days via Surface Cargo"
  warrantyTerms: string; // e.g. "1 Year Manufacturer Replacement Guarantee"
  validityDays: number; // e.g. 15
  validUntil: string; // Formatted date
  authorizedSignatory: string;
  signatoryDesignation: string;
  specialNotes?: string;
  createdAt: number;
}
