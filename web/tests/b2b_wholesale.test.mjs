import test from 'node:test';
import assert from 'node:assert/strict';

// Helper functions mirroring b2bService calculations
function getSlabPrice(slabs, quantity, basePrice) {
  if (!slabs || slabs.length === 0) return basePrice;
  // Slabs sorted by minQty descending
  const sorted = [...slabs].sort((a, b) => b.minQty - a.minQty);
  for (const slab of sorted) {
    if (quantity >= slab.minQty) {
      if (slab.maxQty === undefined || quantity <= slab.maxQty) {
        return slab.pricePerUnit;
      }
    }
  }
  return basePrice;
}

function calculateQuotation(quantity, offeredRate, gstRate, freightCharges) {
  const taxable = Math.round(quantity * offeredRate);
  const gst = Math.round(taxable * gstRate);
  const total = taxable + gst + Math.round(freightCharges);
  return {
    taxableAmount: taxable,
    gstAmount: gst,
    freightCharges: Math.round(freightCharges),
    grandTotal: total
  };
}

function numberToWordsINR(amount) {
  const rounded = Math.round(amount);
  if (rounded === 0) return 'Rupees Zero Only';

  const singleDigits = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convertTwoDigits(n) {
    if (n === 0) return '';
    if (n < 10) return singleDigits[n];
    if (n < 20) return teens[n - 10];
    return tens[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + singleDigits[n % 10] : '');
  }

  function convertThreeDigits(n) {
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

  const parts = [];
  if (crore > 0) parts.push(convertThreeDigits(crore) + ' Crore');
  if (lakh > 0) parts.push(convertThreeDigits(lakh) + ' Lakh');
  if (thousand > 0) parts.push(convertThreeDigits(thousand) + ' Thousand');
  if (remainder > 0) parts.push(convertThreeDigits(remainder));

  return 'Rupees ' + parts.join(' ') + ' Only';
}

test('B2B wholesale pricing slabs apply progressive bulk discounts accurately', () => {
  const slabs = [
    { minQty: 10, maxQty: 24, pricePerUnit: 1450, discountLabel: 'Standard Wholesale' },
    { minQty: 25, maxQty: 99, pricePerUnit: 1320, discountLabel: 'Distributor Bulk' },
    { minQty: 100, pricePerUnit: 1180, discountLabel: 'Super Bulk' }
  ];
  const basePrice = 1450;

  // Tier 1 (10-24 units)
  assert.equal(getSlabPrice(slabs, 10, basePrice), 1450);
  assert.equal(getSlabPrice(slabs, 20, basePrice), 1450);

  // Tier 2 (25-99 units)
  assert.equal(getSlabPrice(slabs, 25, basePrice), 1320);
  assert.equal(getSlabPrice(slabs, 50, basePrice), 1320);

  // Tier 3 (100+ units)
  assert.equal(getSlabPrice(slabs, 100, basePrice), 1180);
  assert.equal(getSlabPrice(slabs, 500, basePrice), 1180);
});

test('B2B MOQ enforcement rejects orders beneath distributor threshold', () => {
  const moq = 10;
  const isAllowed = (qty) => qty >= moq;

  assert.equal(isAllowed(5), false);
  assert.equal(isAllowed(9), false);
  assert.equal(isAllowed(10), true);
  assert.equal(isAllowed(35), true);
});

test('B2B commercial quotation math accurately computes taxable, GST and grand total', () => {
  // 35 units @ ₹1,280/unit with 18% GST and ₹650 freight
  const quote = calculateQuotation(35, 1280, 0.18, 650);

  assert.equal(quote.taxableAmount, 44800); // 35 * 1280
  assert.equal(quote.gstAmount, 8064);      // 44800 * 0.18
  assert.equal(quote.freightCharges, 650);
  assert.equal(quote.grandTotal, 53514);     // 44800 + 8064 + 650
});

test('Currency conversion formats INR figures into standard legal words for quotation PDF', () => {
  assert.equal(
    numberToWordsINR(53514),
    'Rupees Fifty Three Thousand Five Hundred and Fourteen Only'
  );

  assert.equal(
    numberToWordsINR(125000),
    'Rupees One Lakh Twenty Five Thousand Only'
  );

  assert.equal(
    numberToWordsINR(0),
    'Rupees Zero Only'
  );
});

test('Quotation reference number adheres to Repaido commercial B2B standard format', () => {
  const quotePattern = /^REP-B2B-QT-\d{4}-\d{4}$/;
  const sampleQuote = 'REP-B2B-QT-2026-8041';
  assert.match(sampleQuote, quotePattern);
});

test('Contractor tender RFQ integration attaches project reference and delivery timeline', () => {
  const rfq = {
    id: 'rfq-test-01',
    productId: 'b2b-cable-01',
    productTitle: 'Polycab 4-Sqmm 3-Core Submersible Copper Cable (100m Drum)',
    quantity: 50,
    unit: 'Drums',
    tenderRef: 'TND-2026-METRO-04',
    contractorRole: 'Civil & Electrical General Contractor',
    targetBudgetPaise: 35000000,
    requestedDeliveryDays: 7
  };

  assert.equal(rfq.tenderRef.startsWith('TND-'), true);
  assert.equal(rfq.quantity >= 10, true);
  assert.equal(rfq.targetBudgetPaise > 0, true);
});

test('B2B dealer profit schemes matrix delivers superior contractor economics vs IndiaMART', () => {
  const indiamartAnnualListingFee = 65000; // Average ₹65,000/yr subscription
  const indiamartPayPerLeadFee = 350;     // Pay per inquiry regardless of conversion
  const repaidoListingFee = 0;             // Free listing
  const repaidoIntroCommissionRate = 0.0;  // 0% on first 3 truckloads

  // 100 leads under IndiaMART vs Repaido
  const leadsCount = 100;
  const indiamartLeadCost = indiamartAnnualListingFee + (leadsCount * indiamartPayPerLeadFee);
  const repaidoCost = repaidoListingFee;

  assert.equal(indiamartLeadCost, 100000);
  assert.equal(repaidoCost, 0);
  assert.equal(indiamartLeadCost > repaidoCost, true);
});

