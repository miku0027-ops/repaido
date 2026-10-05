import test from 'node:test';
import assert from 'node:assert/strict';

// Mock inventory representing seeded refurbished products
const MOCK_REFURBISHED_INVENTORY = [
  {
    id: 'refurb-macbook-air-m2',
    name: 'Apple MacBook Air M2 (16GB RAM, 512GB SSD) - Space Grey',
    category: 'laptops',
    price: 68999,
    mrp: 119900,
    condition: 'refurbished',
    refurbishedGrade: 'A+',
    moneyBackDays: 7,
    certifiedDiagnostic: true,
    warranty: '12 Months Repaido Certified Warranty',
    warrantyMonths: 12,
    stock: 5,
    refurbishmentDetails: '40-Point Apple Diagnostic Passed. 100% Battery Health Cycle (12 cycles). Outer body zero blemishes, screen pristine.'
  },
  {
    id: 'refurb-iphone-14-pro',
    name: 'Apple iPhone 14 Pro (128GB, Deep Purple)',
    category: 'smartphones',
    price: 64999,
    mrp: 129900,
    condition: 'refurbished',
    refurbishedGrade: 'A+',
    moneyBackDays: 7,
    certifiedDiagnostic: true,
    warranty: '12 Months Repaido Certified Warranty',
    warrantyMonths: 12,
    stock: 8,
    refurbishmentDetails: 'OEM OLED Display calibrated. 98% Battery Health. FaceID, LiDAR, TrueTone 100% functional.'
  },
  {
    id: 'refurb-samsung-s23-ultra',
    name: 'Samsung Galaxy S23 Ultra 5G (12GB RAM, 256GB Storage)',
    category: 'smartphones',
    price: 59999,
    mrp: 124999,
    condition: 'refurbished',
    refurbishedGrade: 'A',
    moneyBackDays: 7,
    certifiedDiagnostic: true,
    warranty: '6 Months Certified Warranty',
    warrantyMonths: 6,
    stock: 4,
    refurbishmentDetails: 'Samsung Knox security passed. S-Pen tested. Micro hairline marks on bezel, display pristine.'
  },
  {
    id: 'refurb-daikin-inverter-ac-15',
    name: 'Daikin 1.5 Ton 5-Star Inverter Split AC (Copper Condenser)',
    category: 'ac',
    price: 21999,
    mrp: 48900,
    condition: 'refurbished',
    refurbishedGrade: 'A+',
    moneyBackDays: 7,
    certifiedDiagnostic: true,
    warranty: '12 Months Comprehensive Warranty',
    warrantyMonths: 12,
    stock: 6,
    refurbishmentDetails: 'Compressor nitrogen pressure pressure-tested at 450 PSI. PCB ultrasonic cleaned. Zero refrigerant leak.'
  },
  {
    id: 'refurb-bosch-washing-machine-8kg',
    name: 'Bosch 8 kg 5 Star Inverter Front Load Washing Machine',
    category: 'appliance',
    price: 19499,
    mrp: 44990,
    condition: 'refurbished',
    refurbishedGrade: 'A',
    moneyBackDays: 7,
    certifiedDiagnostic: true,
    warranty: '12 Months Motor & Drum Warranty',
    warrantyMonths: 12,
    stock: 3,
    refurbishmentDetails: 'Direct drive inverter motor & suspension shockers re-aligned. Drum balanced & anti-vibration calibrated.'
  },
  {
    id: 'refurb-bosch-rotary-hammer-drill',
    name: 'Bosch Professional Rotary Hammer Drill GBH 2-28 F',
    category: 'tools',
    price: 4999,
    mrp: 12500,
    condition: 'refurbished',
    refurbishedGrade: 'B',
    moneyBackDays: 7,
    certifiedDiagnostic: true,
    warranty: '6 Months Pro Workshop Warranty',
    warrantyMonths: 6,
    stock: 11,
    refurbishmentDetails: 'Gearbox grease re-lubricated with high-temp grease, carbon brushes replaced with genuine OEM Bosch parts.'
  }
];

// Helper functions for Refurbished ecosystem
function filterRefurbished(products, options = {}) {
  const { category = 'all', grade = 'all', maxPrice, searchQuery = '' } = options;
  return products.filter(p => {
    if (p.condition !== 'refurbished') return false;
    if (category !== 'all' && p.category !== category) return false;
    if (grade !== 'all' && p.refurbishedGrade !== grade) return false;
    if (maxPrice !== undefined && p.price > maxPrice) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchName = p.name.toLowerCase().includes(q);
      const matchCat = p.category.toLowerCase().includes(q);
      if (!matchName && !matchCat) return false;
    }
    return p.stock > 0;
  });
}

function computeDiscountPercentage(price, mrp) {
  if (!mrp || mrp <= price) return 0;
  return Math.round(((mrp - price) / mrp) * 100);
}

test('Refurbished catalog provides 7-Day Money Back Guarantee across all certified units', () => {
  assert.ok(MOCK_REFURBISHED_INVENTORY.length >= 6);
  for (const item of MOCK_REFURBISHED_INVENTORY) {
    assert.strictEqual(item.condition, 'refurbished');
    assert.ok(typeof item.moneyBackDays === 'number' && item.moneyBackDays >= 7,
      `Item ${item.name} must offer at least 7-day money back guarantee`);
  }
});

test('Refurbished items require 40-Point Diagnostic inspection and verified warranty', () => {
  for (const item of MOCK_REFURBISHED_INVENTORY) {
    assert.strictEqual(item.certifiedDiagnostic, true,
      `Item ${item.name} must have certifiedDiagnostic set to true`);
    assert.ok(item.refurbishmentDetails && item.refurbishmentDetails.length > 20,
      `Item ${item.name} must contain specific refurbishment diagnostic log`);
    assert.ok(item.warrantyMonths >= 6,
      `Item ${item.name} must offer minimum 6 months warranty`);
  }
});

test('Condition grades strictly conform to Grade A+, A, or B standards', () => {
  const validGrades = new Set(['A+', 'A', 'B']);
  for (const item of MOCK_REFURBISHED_INVENTORY) {
    assert.ok(validGrades.has(item.refurbishedGrade),
      `Grade ${item.refurbishedGrade} for ${item.name} is not a recognized condition grade`);
  }
});

test('Current season offer delivers up to 70% OFF MRP savings', () => {
  const discounts = MOCK_REFURBISHED_INVENTORY.map(item => computeDiscountPercentage(item.price, item.mrp));
  const maxDiscount = Math.max(...discounts);
  assert.ok(maxDiscount >= 50 && maxDiscount <= 70,
    `Max festive discount should reach up to 70% off MRP (got ${maxDiscount}%)`);
});

test('Refurbished category rail filtering correctly isolates specific categories and grades', () => {
  // Filter only smartphones
  const smartphones = filterRefurbished(MOCK_REFURBISHED_INVENTORY, { category: 'smartphones' });
  assert.strictEqual(smartphones.length, 2);
  assert.ok(smartphones.every(s => s.category === 'smartphones'));

  // Filter only Grade A+
  const gradeAPlus = filterRefurbished(MOCK_REFURBISHED_INVENTORY, { grade: 'A+' });
  assert.strictEqual(gradeAPlus.length, 3);
  assert.ok(gradeAPlus.every(s => s.refurbishedGrade === 'A+'));

  // Filter by search query "MacBook"
  const macbook = filterRefurbished(MOCK_REFURBISHED_INVENTORY, { searchQuery: 'macbook' });
  assert.strictEqual(macbook.length, 1);
  assert.strictEqual(macbook[0].id, 'refurb-macbook-air-m2');
});

test('Multi-category appliance and tools coverage exists for seller expansion', () => {
  const categories = new Set(MOCK_REFURBISHED_INVENTORY.map(p => p.category));
  assert.ok(categories.has('smartphones'), 'Must support smartphones');
  assert.ok(categories.has('laptops'), 'Must support laptops');
  assert.ok(categories.has('ac'), 'Must support cooling appliances');
  assert.ok(categories.has('appliance'), 'Must support home appliances');
  assert.ok(categories.has('tools'), 'Must support professional workshop tools');
});
