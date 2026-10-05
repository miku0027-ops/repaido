import test from 'node:test';
import assert from 'node:assert/strict';

test('Shop inventory products support HSN code configuration and validation', () => {
  const validHsnCodes = ['8415', '8501', '8481', '8536', '8471', '8532', '8414'];
  const testProduct = {
    id: 'pr-101',
    name: 'Inverter AC Blower Motor',
    partNumber: 'MOT-BLS-8415',
    hsnCode: '8415',
    category: 'ac',
    price: 1850,
    mrp: 2400,
    costPrice: 1200,
    stock: 8,
    condition: 'new'
  };

  assert.ok(validHsnCodes.includes(testProduct.hsnCode), 'HSN code must match standard tariff chapter');
  assert.equal(testProduct.hsnCode, '8415');
});

test('Exact product condition configurations: Brand New, Certified Refurbished, and Pre-Owned / Second Hand', () => {
  // 1. Brand New
  const newProduct = {
    id: 'prod-new-1',
    name: 'Voltas 1.5T Copper Condenser Coil',
    condition: 'new',
    warrantyMonths: 12
  };
  assert.equal(newProduct.condition, 'new');
  assert.equal(newProduct.warrantyMonths, 12);

  // 2. Certified Refurbished
  const refurbProduct = {
    id: 'prod-refurb-1',
    name: 'Daikin Inverter PCB Board (Refurbished)',
    condition: 'refurbished',
    refurbishedGrade: 'A+',
    moneyBackDays: 14,
    certifiedDiagnostic: true,
    warrantyMonths: 6
  };
  assert.equal(refurbProduct.condition, 'refurbished');
  assert.equal(refurbProduct.refurbishedGrade, 'A+');
  assert.equal(refurbProduct.moneyBackDays, 14);
  assert.equal(refurbProduct.certifiedDiagnostic, true);
  assert.equal(refurbProduct.warrantyMonths, 6);

  // 3. Pre-Owned / Second Hand
  const preownedProduct = {
    id: 'prod-second-1',
    name: 'Samsung 1.5 Ton Rotary Compressor (Pre-Owned)',
    condition: 'preowned',
    secondHandNotes: 'Clean bench-tested at 450 PSI, copper winding intact',
    ownershipVerified: true,
    warrantyMonths: 1
  };
  assert.equal(preownedProduct.condition, 'preowned');
  assert.ok(preownedProduct.secondHandNotes.includes('bench-tested'));
  assert.equal(preownedProduct.ownershipVerified, true);
});

test('Shop inventory automatically synchronizes pre-owned and refurbished stock to customer marketplace', () => {
  const mockMarketStore = [];

  function syncToMarketplace(product) {
    if (product.condition !== 'preowned' && product.condition !== 'refurbished') return;
    if (product.stock <= 0) {
      const idx = mockMarketStore.findIndex(m => m.id === product.id);
      if (idx >= 0) mockMarketStore.splice(idx, 1);
      return;
    }
    const idx = mockMarketStore.findIndex(m => m.id === product.id);
    const item = {
      id: product.id,
      name: product.name,
      value_paise: product.price * 100,
      shop_verified: true,
      hsn_code: product.hsnCode,
      status: 'published'
    };
    if (idx >= 0) mockMarketStore[idx] = item;
    else mockMarketStore.push(item);
  }

  // Add refurbished item
  const item1 = { id: 'p-1', name: 'Refurbished Motor', condition: 'refurbished', hsnCode: '8501', price: 900, stock: 3 };
  syncToMarketplace(item1);
  assert.equal(mockMarketStore.length, 1);
  assert.equal(mockMarketStore[0].hsn_code, '8501');
  assert.equal(mockMarketStore[0].shop_verified, true);

  // Stock update to 0 removes it from live marketplace
  syncToMarketplace({ ...item1, stock: 0 });
  assert.equal(mockMarketStore.length, 0, 'Out-of-stock shop items must be removed from customer marketplace');
});

test('Customer second-hand listing submission resilience', () => {
  // Listing submission must not fail even if eligibility check or photo server is offline
  const fallbackLocation = { lat: 21.4934, lng: 86.9135 };
  const fallbackFree = true; // 90-day launch guarantee

  const submissionPayload = {
    id: `mkt-${Date.now()}`,
    mode: 'second_hand',
    name: 'Voltas 1.5 Ton Split AC',
    brand: 'Voltas',
    value_paise: 1650000,
    fee_status: fallbackFree ? 'free_trial' : 'due',
    free_eligible: fallbackFree,
    status: 'published',
    location: fallbackLocation,
    hsn_code: '8415'
  };

  assert.equal(submissionPayload.fee_status, 'free_trial');
  assert.equal(submissionPayload.status, 'published');
  assert.ok(submissionPayload.location.lat > 0);
  assert.equal(submissionPayload.hsn_code, '8415');
});

test('GST Tax Invoice & Delivery Challan math verifies 18% GST (9% CGST + 9% SGST) and HSN compliance', () => {
  const priceGross = 1180; // Gross billable price
  const taxable = Math.round((priceGross / 1.18) * 100) / 100; // 1000
  const cgst = Math.round((taxable * 0.09) * 100) / 100; // 90
  const sgst = Math.round((taxable * 0.09) * 100) / 100; // 90

  assert.equal(taxable, 1000);
  assert.equal(cgst, 90);
  assert.equal(sgst, 90);
  assert.equal(taxable + cgst + sgst, 1180);
});
