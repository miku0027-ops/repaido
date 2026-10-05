import type {
  B2BListing,
  B2BRfqRequest,
  B2BQuotation,
  B2BCategory,
  B2BUnit
} from '../types/b2b';

const B2B_LISTINGS_KEY = 'repaido_b2b_listings_v1';
const B2B_RFQS_KEY = 'repaido_b2b_rfqs_v1';
const B2B_NOTIFICATIONS_KEY = 'repaido_b2b_notifications_v1';

export const SEEDED_B2B_LISTINGS: B2BListing[] = [
  {
    id: 'b2b-hvac-copper-01',
    shopId: 'shop-bls-01',
    shopName: 'Maa Tarini Spare Hub',
    distributorName: 'Tarini Thermal Solutions & Bulk Supplies',
    phone: '+91 94372 11234',
    email: 'tarini.bulk@repaido.in',
    gstin: '21ABCDE1234F1Z5',
    city: 'Balasore',
    address: 'Station Road, Near Bus Terminus, Balasore, Odisha 756001',
    title: 'Commercial Pure Deoxidized Copper Tubing Coil 1/2" (50 Ft Roll)',
    category: 'hvac',
    partNumber: 'COP-TUBE-50FT-050',
    hsnCode: '74112100',
    unit: 'Rolls',
    moq: 10,
    basePrice: 1450,
    mrp: 2350,
    bulkSlabs: [
      { minQty: 10, maxQty: 24, pricePerUnit: 1450, discountLabel: 'Standard Wholesale' },
      { minQty: 25, maxQty: 99, pricePerUnit: 1320, discountLabel: 'Save 9% (Distributor)' },
      { minQty: 100, pricePerUnit: 1180, discountLabel: 'Save 19% (Super Bulk)' }
    ],
    stock: 450,
    leadTimeDays: 2,
    supplyCapacity: '2,000 Rolls / Month',
    description: 'Electrolytic grade 99.9% pure phosphorus deoxidized seamless copper coils conforming to ASTM B280. Zero pinholes, nitrogen purged, suitable for R410A / R32 high-pressure VRF & split HVAC installations.',
    specifications: {
      'Outside Diameter': '1/2 Inch (12.7 mm)',
      'Wall Thickness': '0.80 mm (Heavy Gauge)',
      'Working Pressure': 'Up to 550 PSI',
      'Temper': 'Soft Annealed O60',
      'Standards Compliance': 'ASTM B280 / EN 12735-1'
    },
    image: '/images/ac.jpg',
    status: 'active',
    verifiedDistributor: true,
    createdAt: Date.now() - 86400000 * 7,
    updatedAt: Date.now() - 86400000 * 2
  },
  {
    id: 'b2b-elec-cable-02',
    shopId: 'shop-bls-02',
    shopName: 'Apex Electronics & Appliance Spares',
    distributorName: 'Apex Power Grid & Commercial Switchgear Co.',
    phone: '+91 98610 54321',
    email: 'apex.wholesale@repaido.in',
    gstin: '21BCDEF5678G2Z5',
    city: 'Balasore',
    address: 'Cinema Chhak, OT Road, Balasore, Odisha 756003',
    title: 'Industrial FR-LSH Multi-Strand Copper Wire 2.5 sq mm (Bundle of 10x90m)',
    category: 'electrical',
    partNumber: 'CAB-FRLSH-25-BUN',
    hsnCode: '85444990',
    unit: 'Bundles',
    moq: 5,
    basePrice: 8900,
    mrp: 14500,
    bulkSlabs: [
      { minQty: 5, maxQty: 19, pricePerUnit: 8900, discountLabel: 'Trade Pack' },
      { minQty: 20, maxQty: 49, pricePerUnit: 8200, discountLabel: 'Save 8% (Project Bulk)' },
      { minQty: 50, pricePerUnit: 7450, discountLabel: 'Save 16% (Direct Factory)' }
    ],
    stock: 180,
    leadTimeDays: 1,
    supplyCapacity: '1,200 Bundles / Month',
    description: 'Electrolytic grade 99.97% bright annealed copper multi-strand conductor with flame retardant low smoke zero halogen insulation. ISI marked (IS 694). Superior current-carrying capacity for commercial complexes and residential developments.',
    specifications: {
      'Conductor Size': '2.5 sq mm (50/0.25 strands)',
      'Current Rating': '22 Amperes',
      'Insulation': 'Type A FR-LSH PVC compound',
      'Voltage Grade': 'Up to 1100 V AC',
      'Flame Test': 'Conforms to IEC 60332-1'
    },
    image: '/images/electrical.jpg',
    status: 'active',
    verifiedDistributor: true,
    createdAt: Date.now() - 86400000 * 10,
    updatedAt: Date.now() - 86400000 * 3
  },
  {
    id: 'b2b-plumb-valves-03',
    shopId: 'shop-bls-03',
    shopName: 'Utkal Sanitary & Plumbing Mart',
    distributorName: 'Utkal Industrial Valves & Sanitary Mega-Distributors',
    phone: '+91 97781 87654',
    email: 'utkal.b2b@repaido.in',
    gstin: '21CDEFG9012H3Z5',
    city: 'Balasore',
    address: 'Fakir Mohan Golayei, Balasore, Odisha 756001',
    title: 'Heavy Forged Brass Ball Valve 1" Full Bore PN25 (Master Carton of 24 Pcs)',
    category: 'plumbing',
    partNumber: 'VLV-BRS-1IN-PN25',
    hsnCode: '84818020',
    unit: 'Cartons',
    moq: 4,
    basePrice: 4200,
    mrp: 6800,
    bulkSlabs: [
      { minQty: 4, maxQty: 9, pricePerUnit: 4200, discountLabel: 'Wholesale Tier' },
      { minQty: 10, maxQty: 29, pricePerUnit: 3750, discountLabel: 'Save 11% (Contractor)' },
      { minQty: 30, pricePerUnit: 3300, discountLabel: 'Save 21% (Depot Bulk)' }
    ],
    stock: 220,
    leadTimeDays: 2,
    supplyCapacity: '1,500 Cartons / Month',
    description: 'Solid forged nickel-plated brass body with hard-chrome plated solid brass ball and pure PTFE seals. High flow rate, blow-out proof stem, certified for commercial water supply, hydropneumatic pump lines, and chemical air networks.',
    specifications: {
      'Nominal Bore': '25 mm (1 Inch)',
      'Pressure Rating': 'PN25 (25 Bar / 362 PSI)',
      'Body Material': 'Forged Brass CW617N',
      'Thread Type': 'BSPT / NPT Female Endings',
      'Temperature Range': '-10°C to +110°C'
    },
    image: '/images/bathroom.jpg',
    status: 'active',
    verifiedDistributor: true,
    createdAt: Date.now() - 86400000 * 12,
    updatedAt: Date.now() - 86400000 * 4
  },
  {
    id: 'b2b-hvac-compressor-04',
    shopId: 'shop-bls-01',
    shopName: 'Maa Tarini Spare Hub',
    distributorName: 'Tarini Thermal Solutions & Bulk Supplies',
    phone: '+91 94372 11234',
    email: 'tarini.bulk@repaido.in',
    gstin: '21ABCDE1234F1Z5',
    city: 'Balasore',
    address: 'Station Road, Near Bus Terminus, Balasore, Odisha 756001',
    title: 'Twin Rotary Inverter AC Compressor 1.5 TR R32/R410A (Lot of 5 Units)',
    category: 'hvac',
    partNumber: 'CMP-ROT-15TR-INV',
    hsnCode: '84143000',
    unit: 'Boxes',
    moq: 2,
    basePrice: 23500,
    mrp: 36000,
    bulkSlabs: [
      { minQty: 2, maxQty: 5, pricePerUnit: 23500, discountLabel: 'HVAC Workshop Lot' },
      { minQty: 6, maxQty: 14, pricePerUnit: 21500, discountLabel: 'Save 8% (Service Chain)' },
      { minQty: 15, pricePerUnit: 19800, discountLabel: 'Save 16% (OEM Factory Sourcing)' }
    ],
    stock: 65,
    leadTimeDays: 3,
    supplyCapacity: '250 Lots / Month',
    description: 'High seasonal efficiency (ISEER 5.2 compliant) twin rotary DC inverter compressors. High torque rare-earth neodymium magnets, low vibration balance design, factory pre-charged with POE synthetic lubricant.',
    specifications: {
      'Displacement': '13.0 cc / rev',
      'Cooling Capacity': '5200 Watts (17,750 BTU/h)',
      'Operating Voltage': '140V - 280V DC Inverter Drive',
      'Compatible Gas': 'R32 / R410A Environment Safe',
      'Warranty': '1 Year Full Replacement with OEM test sheet'
    },
    image: '/images/ac.jpg',
    status: 'active',
    verifiedDistributor: true,
    createdAt: Date.now() - 86400000 * 6,
    updatedAt: Date.now() - 86400000 * 1
  },
  {
    id: 'b2b-tools-hammer-05',
    shopId: 'shop-bls-02',
    shopName: 'Apex Electronics & Appliance Spares',
    distributorName: 'Apex Power Grid & Commercial Switchgear Co.',
    phone: '+91 98610 54321',
    email: 'apex.wholesale@repaido.in',
    gstin: '21BCDEF5678G2Z5',
    city: 'Balasore',
    address: 'Cinema Chhak, OT Road, Balasore, Odisha 756003',
    title: 'Heavy Duty 850W SDS-Plus 26mm Rotary Hammer Drill (Case Pack of 6 Units)',
    category: 'tools',
    partNumber: 'TLS-SDR-850W-6PK',
    hsnCode: '84672100',
    unit: 'Cartons',
    moq: 2,
    basePrice: 15600,
    mrp: 24900,
    bulkSlabs: [
      { minQty: 2, maxQty: 4, pricePerUnit: 15600, discountLabel: 'Contractor Pack' },
      { minQty: 5, maxQty: 11, pricePerUnit: 14200, discountLabel: 'Save 9% (Hardware Dealer)' },
      { minQty: 12, pricePerUnit: 12800, discountLabel: 'Save 18% (Master Distributor)' }
    ],
    stock: 90,
    leadTimeDays: 2,
    supplyCapacity: '600 Packs / Month',
    description: '3-mode rotary hammer (Drill, Hammer Drill, Chisel) with 3.2 Joules impact energy and mechanical torque limiting clutch. Complete with heavy duty carrying cases, depth gauges, and auxiliary handles.',
    specifications: {
      'Motor Power': '850 Watts Pure Copper Windings',
      'Impact Energy': '3.2 Joules (High Impact Rate)',
      'Chuck System': 'SDS-Plus Quick Change',
      'Max Concrete Capacity': '26 mm Solid Core',
      'Weight per Unit': '2.9 kg Ergonomic'
    },
    image: '/images/appliance.svg',
    status: 'active',
    verifiedDistributor: true,
    createdAt: Date.now() - 86400000 * 9,
    updatedAt: Date.now() - 86400000 * 2
  },
  {
    id: 'b2b-ref-gas-06',
    shopId: 'shop-bls-01',
    shopName: 'Maa Tarini Spare Hub',
    distributorName: 'Tarini Thermal Solutions & Bulk Supplies',
    phone: '+91 94372 11234',
    email: 'tarini.bulk@repaido.in',
    gstin: '21ABCDE1234F1Z5',
    city: 'Balasore',
    address: 'Station Road, Near Bus Terminus, Balasore, Odisha 756001',
    title: 'Certified R32 Eco Refrigerant Gas 10 Kg Disposable Cylinder (Lot of 4)',
    category: 'refrigerants',
    partNumber: 'GAS-R32-10KG-4PK',
    hsnCode: '29033990',
    unit: 'Cartons',
    moq: 2,
    basePrice: 14400,
    mrp: 21800,
    bulkSlabs: [
      { minQty: 2, maxQty: 5, pricePerUnit: 14400, discountLabel: 'Service Station Pack' },
      { minQty: 6, maxQty: 14, pricePerUnit: 13100, discountLabel: 'Save 9% (AC Dealer)' },
      { minQty: 15, pricePerUnit: 11900, discountLabel: 'Save 17% (Fleet Wholesale)' }
    ],
    stock: 140,
    leadTimeDays: 1,
    supplyCapacity: '800 Lots / Month',
    description: 'Virgin grade purity 99.9% Difluoromethane (R32) moisture-tested under 10 PPM. Non-ozone depleting, zero ODP, certified low GWP. Cylinders manufactured to DOT-39 / ISO 11118 standards with dual pressure release valves.',
    specifications: {
      'Purity': '≥ 99.90% Virgin Quality',
      'Moisture Content': '≤ 10 ppm (Dry Laboratory Grade)',
      'Total Weight': '4 x 10 kg Net Weight = 40 kg Gas',
      'Safety Standard': 'ASHRAE A2L Safety Rating',
      'Cylinder Type': 'Disposable High Pressure Steel'
    },
    image: '/images/ac.jpg',
    status: 'active',
    verifiedDistributor: true,
    createdAt: Date.now() - 86400000 * 5,
    updatedAt: Date.now() - 86400000 * 1
  }
];

export const SEEDED_B2B_RFQS: B2BRfqRequest[] = [
  {
    id: 'rfq-2026-8041',
    listingId: 'b2b-hvac-copper-01',
    itemTitle: 'Commercial Pure Deoxidized Copper Tubing Coil 1/2" (50 Ft Roll)',
    category: 'hvac',
    hsnCode: '74112100',
    unit: 'Rolls',
    shopId: 'shop-bls-01',
    shopName: 'Maa Tarini Spare Hub',
    customerName: 'Biswajit Mohapatra',
    customerPhone: '+91 94381 22334',
    customerEmail: 'biswajit.infra@gmail.com',
    buyerCompanyName: 'Kalinga HVAC Engineering Solutions',
    buyerGstin: '21AAACK1928J1Z9',
    deliveryAddress: 'Plot 42, Ganeswarpur Industrial Estate, Januganj',
    deliveryCity: 'Balasore',
    deliveryPincode: '756019',
    quantityRequested: 35,
    targetPricePerUnit: 1290,
    urgency: 'within_7_days',
    notes: 'Required for commercial hospital VRF ductable project. Please provide mill test certificate and include GST invoice in quotation.',
    status: 'quoted',
    createdAt: Date.now() - 86400000 * 2,
    updatedAt: Date.now() - 86400000 * 1,
    quotation: {
      quoteNumber: 'REP-B2B-QT-2026-8041',
      rfqId: 'rfq-2026-8041',
      shopId: 'shop-bls-01',
      shopName: 'Maa Tarini Spare Hub',
      distributorName: 'Tarini Thermal Solutions & Bulk Supplies',
      distributorGstin: '21ABCDE1234F1Z5',
      shopAddress: 'Station Road, Near Bus Terminus, Balasore, Odisha 756001',
      shopPhone: '+91 94372 11234',
      shopEmail: 'tarini.bulk@repaido.in',
      customerName: 'Biswajit Mohapatra',
      buyerCompanyName: 'Kalinga HVAC Engineering Solutions',
      buyerGstin: '21AAACK1928J1Z9',
      deliveryAddress: 'Plot 42, Ganeswarpur Industrial Estate, Januganj',
      deliveryCity: 'Balasore',
      deliveryPincode: '756019',
      itemTitle: 'Commercial Pure Deoxidized Copper Tubing Coil 1/2" (50 Ft Roll)',
      partNumber: 'COP-TUBE-50FT-050',
      hsnCode: '74112100',
      unit: 'Rolls',
      quantity: 35,
      offeredRate: 1280,
      taxableAmount: 44800,
      gstRate: 0.18,
      gstAmount: 8064,
      freightCharges: 650,
      grandTotal: 53514,
      paymentTerms: '30% Advance via Repaido Escrow, 70% upon delivery inspection',
      deliveryTimeline: 'Dispatched within 2 Business Days via Express Road Cargo',
      warrantyTerms: '1 Year Manufacturer Replacement Guarantee + ASTM B280 Test Certificates',
      validityDays: 15,
      validUntil: new Date(Date.now() + 86400000 * 14).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      }),
      authorizedSignatory: 'Sarat Chandra Nayak',
      signatoryDesignation: 'Director of Commercial Wholesale, Maa Tarini Spare Hub',
      specialNotes: 'All 35 rolls will be shipped in sealed protective wooden crates with moisture-absorbent silica packs.',
      createdAt: Date.now() - 86400000 * 1
    }
  }
];

class B2BService {
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.ensureInitialized();
  }

  private ensureInitialized() {
    if (typeof window === 'undefined') return;
    try {
      if (!localStorage.getItem(B2B_LISTINGS_KEY)) {
        localStorage.setItem(B2B_LISTINGS_KEY, JSON.stringify(SEEDED_B2B_LISTINGS));
      }
      if (!localStorage.getItem(B2B_RFQS_KEY)) {
        localStorage.setItem(B2B_RFQS_KEY, JSON.stringify(SEEDED_B2B_RFQS));
      }
      if (!localStorage.getItem(B2B_NOTIFICATIONS_KEY)) {
        const initialNotifs = [
          {
            id: 'notif-b2b-REP-B2B-QT-2026-0042',
            title: 'Official Wholesale Quotation: REP-B2B-QT-2026-0042',
            body: 'Maa Tarini Spare Hub issued official quotation for 35 Rolls of "Commercial Pure Deoxidized Copper Tubing Coil 1/2"". Total: ₹53,514 (Incl. GST & Express Freight). Download official Repaido PDF.',
            destination: 'b2b_quotation',
            quoteNumber: 'REP-B2B-QT-2026-0042',
            rfqId: 'rfq-b2b-01',
            created_at: Math.floor((Date.now() - 3600000 * 2) / 1000)
          }
        ];
        localStorage.setItem(B2B_NOTIFICATIONS_KEY, JSON.stringify(initialNotifs));
      }
    } catch {
      // Storage restricted fallback
    }
  }

  public subscribe(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notify() {
    this.listeners.forEach(cb => {
      try { cb(); } catch (err) { console.error('B2B listener error', err); }
    });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('repaido:b2b:updated'));
    }
  }

  // --- LISTINGS API ---

  public getB2BListings(): B2BListing[] {
    try {
      const data = localStorage.getItem(B2B_LISTINGS_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return SEEDED_B2B_LISTINGS;
  }

  public getShopB2BListings(shopId: string): B2BListing[] {
    return this.getB2BListings().filter(l => l.shopId === shopId);
  }

  public saveB2BListing(listing: Partial<B2BListing> & { shopId: string; title: string; category: B2BCategory }): B2BListing {
    const listings = this.getB2BListings();
    const now = Date.now();
    let saved: B2BListing;

    if (listing.id && listings.some(l => l.id === listing.id)) {
      listings.forEach((l, idx) => {
        if (l.id === listing.id) {
          saved = {
            ...l,
            ...listing,
            updatedAt: now
          };
          listings[idx] = saved;
        }
      });
    } else {
      const id = listing.id || `b2b-${listing.category}-${Math.random().toString(36).substring(2, 7)}`;
      saved = {
        id,
        shopId: listing.shopId,
        shopName: listing.shopName || 'Repaido Verified Shop',
        distributorName: listing.distributorName || listing.shopName || 'Wholesale Distributor',
        phone: listing.phone || '+91 94370 00000',
        email: listing.email || 'wholesale@repaido.in',
        gstin: listing.gstin || '21AAAAA0000A1Z5',
        city: listing.city || 'Balasore',
        address: listing.address || 'Industrial Estate, Balasore, Odisha',
        title: listing.title,
        category: listing.category,
        partNumber: listing.partNumber || `PN-${id.toUpperCase()}`,
        hsnCode: listing.hsnCode || '84149000',
        unit: listing.unit || 'Boxes',
        moq: Number(listing.moq) || 5,
        basePrice: Number(listing.basePrice) || 1000,
        mrp: Number(listing.mrp) || Math.round((Number(listing.basePrice) || 1000) * 1.5),
        bulkSlabs: listing.bulkSlabs && listing.bulkSlabs.length > 0 ? listing.bulkSlabs : [
          { minQty: Number(listing.moq) || 5, maxQty: 19, pricePerUnit: Number(listing.basePrice) || 1000, discountLabel: 'Standard Bulk' },
          { minQty: 20, pricePerUnit: Math.round((Number(listing.basePrice) || 1000) * 0.9), discountLabel: 'Save 10% (High Volume)' }
        ],
        stock: Number(listing.stock) || 100,
        leadTimeDays: Number(listing.leadTimeDays) || 2,
        supplyCapacity: listing.supplyCapacity || '1,000 Units / Month',
        description: listing.description || 'Commercial bulk wholesale package with verified GST invoice.',
        specifications: listing.specifications || {},
        image: listing.image || '/images/ac.jpg',
        status: listing.status || 'active',
        verifiedDistributor: listing.verifiedDistributor ?? true,
        createdAt: now,
        updatedAt: now
      };
      listings.unshift(saved);
    }

    try {
      localStorage.setItem(B2B_LISTINGS_KEY, JSON.stringify(listings));
    } catch {}
    this.notify();
    return saved!;
  }

  public deleteB2BListing(id: string): boolean {
    const listings = this.getB2BListings().filter(l => l.id !== id);
    try {
      localStorage.setItem(B2B_LISTINGS_KEY, JSON.stringify(listings));
      this.notify();
      return true;
    } catch {
      return false;
    }
  }

  public toggleListingStatus(id: string): B2BListing | null {
    const listings = this.getB2BListings();
    const item = listings.find(l => l.id === id);
    if (!item) return null;
    item.status = item.status === 'active' ? 'paused' : 'active';
    item.updatedAt = Date.now();
    try {
      localStorage.setItem(B2B_LISTINGS_KEY, JSON.stringify(listings));
      this.notify();
      return item;
    } catch {
      return null;
    }
  }

  // --- RFQ & QUOTATION API ---

  public getRFQs(): B2BRfqRequest[] {
    try {
      const data = localStorage.getItem(B2B_RFQS_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return SEEDED_B2B_RFQS;
  }

  public getShopRFQs(shopId: string): B2BRfqRequest[] {
    return this.getRFQs().filter(r => r.shopId === shopId);
  }

  public getCustomerRFQs(phoneOrEmail?: string): B2BRfqRequest[] {
    const all = this.getRFQs();
    if (!phoneOrEmail) return all;
    return all.filter(r => 
      (r.customerPhone && r.customerPhone.includes(phoneOrEmail)) ||
      (r.customerEmail && r.customerEmail.toLowerCase() === phoneOrEmail.toLowerCase())
    );
  }

  public createRFQ(request: Omit<B2BRfqRequest, 'id' | 'status' | 'createdAt' | 'updatedAt'>): B2BRfqRequest {
    const rfqs = this.getRFQs();
    const id = `rfq-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const now = Date.now();

    const newRfq: B2BRfqRequest = {
      ...request,
      id,
      status: 'pending',
      createdAt: now,
      updatedAt: now
    };

    rfqs.unshift(newRfq);
    try {
      localStorage.setItem(B2B_RFQS_KEY, JSON.stringify(rfqs));
    } catch {}
    this.notify();
    return newRfq;
  }

  public generateQuotation(rfqId: string, quoteInput: {
    offeredRate: number;
    quantity: number;
    gstRate: number; // e.g. 0.18
    freightCharges: number;
    paymentTerms: string;
    deliveryTimeline: string;
    warrantyTerms: string;
    validityDays: number;
    authorizedSignatory: string;
    signatoryDesignation?: string;
    specialNotes?: string;
  }): B2BQuotation | null {
    const rfqs = this.getRFQs();
    const rfq = rfqs.find(r => r.id === rfqId);
    if (!rfq) return null;

    const listings = this.getB2BListings();
    const listing = listings.find(l => l.id === rfq.listingId);

    const now = Date.now();
    const quoteNumber = `REP-B2B-QT-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const taxableAmount = Math.round(quoteInput.quantity * quoteInput.offeredRate);
    const gstAmount = Math.round(taxableAmount * quoteInput.gstRate);
    const grandTotal = taxableAmount + gstAmount + Math.round(quoteInput.freightCharges);

    const validUntilDate = new Date(now + quoteInput.validityDays * 86400000);
    const validUntil = validUntilDate.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });

    const quotation: B2BQuotation = {
      quoteNumber,
      rfqId,
      shopId: rfq.shopId,
      shopName: rfq.shopName,
      distributorName: listing?.distributorName || rfq.shopName,
      distributorGstin: listing?.gstin || '21ABCDE1234F1Z5',
      shopAddress: listing?.address || `${listing?.city || 'Balasore'}, Odisha`,
      shopPhone: listing?.phone || '+91 94370 00000',
      shopEmail: listing?.email || 'wholesale@repaido.in',
      customerName: rfq.customerName,
      buyerCompanyName: rfq.buyerCompanyName,
      buyerGstin: rfq.buyerGstin,
      deliveryAddress: rfq.deliveryAddress,
      deliveryCity: rfq.deliveryCity,
      deliveryPincode: rfq.deliveryPincode,
      itemTitle: rfq.itemTitle,
      partNumber: listing?.partNumber || 'PART-B2B-BULK',
      hsnCode: rfq.hsnCode,
      unit: rfq.unit,
      quantity: quoteInput.quantity,
      offeredRate: quoteInput.offeredRate,
      taxableAmount,
      gstRate: quoteInput.gstRate,
      gstAmount,
      freightCharges: quoteInput.freightCharges,
      grandTotal,
      paymentTerms: quoteInput.paymentTerms,
      deliveryTimeline: quoteInput.deliveryTimeline,
      warrantyTerms: quoteInput.warrantyTerms,
      validityDays: quoteInput.validityDays,
      validUntil,
      authorizedSignatory: quoteInput.authorizedSignatory,
      signatoryDesignation: quoteInput.signatoryDesignation || 'Authorized Signatory, Repaido B2B Merchant',
      specialNotes: quoteInput.specialNotes,
      createdAt: now
    };

    rfq.status = 'quoted';
    rfq.quotation = quotation;
    rfq.updatedAt = now;

    try {
      localStorage.setItem(B2B_RFQS_KEY, JSON.stringify(rfqs));
      
      // Dispatch in-app buyer notification
      this.dispatchQuotationNotification(rfq, quotation);
    } catch {}

    this.notify();
    return quotation;
  }

  public acceptQuotation(rfqId: string): boolean {
    const rfqs = this.getRFQs();
    const rfq = rfqs.find(r => r.id === rfqId);
    if (!rfq || !rfq.quotation) return false;
    rfq.status = 'accepted';
    rfq.updatedAt = Date.now();
    try {
      localStorage.setItem(B2B_RFQS_KEY, JSON.stringify(rfqs));
      this.notify();
      return true;
    } catch {
      return false;
    }
  }

  public declineQuotation(rfqId: string): boolean {
    const rfqs = this.getRFQs();
    const rfq = rfqs.find(r => r.id === rfqId);
    if (!rfq) return false;
    rfq.status = 'declined';
    rfq.updatedAt = Date.now();
    try {
      localStorage.setItem(B2B_RFQS_KEY, JSON.stringify(rfqs));
      this.notify();
      return true;
    } catch {
      return false;
    }
  }

  private dispatchQuotationNotification(rfq: B2BRfqRequest, quotation: B2BQuotation) {
    if (typeof window === 'undefined') return;
    try {
      const notif = {
        id: `notif-b2b-${quotation.quoteNumber}`,
        title: `Official Wholesale Quotation: ${quotation.quoteNumber}`,
        body: `${quotation.shopName} issued quotation for ${quotation.quantity} ${quotation.unit} of "${quotation.itemTitle}". Total: ₹${quotation.grandTotal.toLocaleString('en-IN')}. Download official Repaido PDF.`,
        destination: 'b2b_quotation',
        quoteNumber: quotation.quoteNumber,
        rfqId: rfq.id,
        created_at: Math.floor(Date.now() / 1000)
      };

      const existingStr = localStorage.getItem(B2B_NOTIFICATIONS_KEY);
      const list = existingStr ? JSON.parse(existingStr) : [];
      list.unshift(notif);
      localStorage.setItem(B2B_NOTIFICATIONS_KEY, JSON.stringify(list));

      // Trigger custom window event
      window.dispatchEvent(new CustomEvent('repaido:b2b:notification', { detail: notif }));
    } catch {}
  }

  public getB2BNotifications(): any[] {
    if (typeof window === 'undefined') return [];
    try {
      const existingStr = localStorage.getItem(B2B_NOTIFICATIONS_KEY);
      return existingStr ? JSON.parse(existingStr) : [];
    } catch {
      return [];
    }
  }

  public markNotificationRead(id: string): boolean {
    if (typeof window === 'undefined') return false;
    try {
      const existingStr = localStorage.getItem(B2B_NOTIFICATIONS_KEY);
      if (!existingStr) return false;
      const list = JSON.parse(existingStr);
      const now = Math.floor(Date.now() / 1000);
      const updated = list.map((n: any) => n.id === id ? { ...n, read_at: n.read_at || now } : n);
      localStorage.setItem(B2B_NOTIFICATIONS_KEY, JSON.stringify(updated));
      this.notify();
      return true;
    } catch {
      return false;
    }
  }

  public markAllNotificationsRead(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      const existingStr = localStorage.getItem(B2B_NOTIFICATIONS_KEY);
      if (!existingStr) return false;
      const list = JSON.parse(existingStr);
      const now = Math.floor(Date.now() / 1000);
      const updated = list.map((n: any) => ({ ...n, read_at: n.read_at || now }));
      localStorage.setItem(B2B_NOTIFICATIONS_KEY, JSON.stringify(updated));
      this.notify();
      return true;
    } catch {
      return false;
    }
  }

  public clearB2BNotifications(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      localStorage.setItem(B2B_NOTIFICATIONS_KEY, JSON.stringify([]));
      this.notify();
      return true;
    } catch {
      return false;
    }
  }

  public getQuotationByNumber(quoteNumber: string): B2BQuotation | null {
    const rfqs = this.getRFQs();
    for (const rfq of rfqs) {
      if (rfq.quotation && rfq.quotation.quoteNumber === quoteNumber) {
        return rfq.quotation;
      }
    }
    return null;
  }
}

export const b2bService = new B2BService();

/**
 * Utility to convert INR number into Indian currency words.
 * E.g. 53514 -> "Rupees Fifty Three Thousand Five Hundred Fourteen Only"
 */
export function numberToWordsINR(amount: number): string {
  const rounded = Math.round(amount);
  if (rounded === 0) return 'Rupees Zero Only';

  const singleDigits = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convertTwoDigits(n: number): string {
    if (n === 0) return '';
    if (n < 10) return singleDigits[n];
    if (n < 20) return teens[n - 10];
    return tens[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + singleDigits[n % 10] : '');
  }

  function convertThreeDigits(n: number): string {
    const hundred = Math.floor(n / 100);
    const remainder = n % 100;
    let str = '';
    if (hundred > 0) str += singleDigits[hundred] + ' Hundred';
    if (remainder > 0) {
      if (str.length > 0) str += ' and ';
      str += convertTwoDigits(remainder);
    }
    return str;
  }

  let crore = Math.floor(rounded / 10000000);
  let remainder = rounded % 10000000;
  let lakh = Math.floor(remainder / 100000);
  remainder = remainder % 100000;
  let thousand = Math.floor(remainder / 1000);
  remainder = remainder % 1000;

  const parts: string[] = [];
  if (crore > 0) parts.push(convertThreeDigits(crore) + ' Crore');
  if (lakh > 0) parts.push(convertThreeDigits(lakh) + ' Lakh');
  if (thousand > 0) parts.push(convertThreeDigits(thousand) + ' Thousand');
  if (remainder > 0) parts.push(convertThreeDigits(remainder));

  return 'Rupees ' + parts.join(' ') + ' Only';
}
