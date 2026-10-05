import test from 'node:test';
import assert from 'node:assert/strict';

test('Shop Inventory: KPIs, valuation, and low-stock reorder alerts calculation', () => {
  const sampleProducts = [
    { id: 'p1', name: 'Dual Run Capacitor 50+5 MFD', partNumber: 'CAP-505', category: 'ac', condition: 'new', price: 480, stock: 12 },
    { id: 'p2', name: 'Rotary Compressor 1.5 Ton', partNumber: 'COMP-15', category: 'ac', condition: 'refurbished', price: 6200, stock: 3 },
    { id: 'p3', name: 'Brass Ball Valve 1 inch', partNumber: 'VAL-01', category: 'plumber', condition: 'new', price: 320, stock: 0 },
    { id: 'p4', name: 'MCB Double Pole 32A', partNumber: 'MCB-32', category: 'electrician', condition: 'preowned', price: 210, stock: 25 }
  ];

  // 1. Total units and valuation
  const totalUnits = sampleProducts.reduce((sum, p) => sum + (p.stock || 0), 0);
  const totalValuation = sampleProducts.reduce((sum, p) => sum + (p.stock * p.price), 0);
  assert.equal(totalUnits, 40, 'Total stock units should sum correctly');
  assert.equal(totalValuation, (12 * 480) + (3 * 6200) + (0 * 320) + (25 * 210), 'Total valuation should match selling prices');

  // 2. Health alerts
  const lowStockCount = sampleProducts.filter(p => p.stock > 0 && p.stock <= 5).length;
  const outOfStockCount = sampleProducts.filter(p => p.stock === 0).length;
  assert.equal(lowStockCount, 1, 'Only p2 should be counted as low stock (3 units)');
  assert.equal(outOfStockCount, 1, 'Only p3 should be counted as out of stock (0 units)');
});

test('Shop Inventory: Quick stock adjust stepper & Quick Stock-In additions', () => {
  let stock = 3;

  // Stepper decrement
  function adjustStock(delta) {
    stock = Math.max(0, stock + delta);
    return stock;
  }

  // Quick Stock-In batch
  function quickStockIn(unitsToAdd) {
    if (unitsToAdd > 0) {
      stock += unitsToAdd;
    }
    return stock;
  }

  assert.equal(adjustStock(-1), 2, 'Stepper decrement by 1 should be 2');
  assert.equal(adjustStock(-5), 0, 'Stepper decrement below 0 should clamp to 0');

  // Add +5 received units
  assert.equal(adjustStock(5), 5, 'Quick +5 shortcut should raise stock to 5');

  // Add bulk shipment +20
  assert.equal(quickStockIn(20), 25, 'Bulk Stock-In +20 should result in 25 units');
});

test('Shop Inventory: One-line filter combinations', () => {
  const sampleProducts = [
    { id: 'p1', name: 'Dual Run Capacitor', partNumber: 'CAP-505', category: 'ac', condition: 'new', stock: 12 },
    { id: 'p2', name: 'Rotary Compressor', partNumber: 'COMP-15', category: 'ac', condition: 'refurbished', stock: 3 },
    { id: 'p3', name: 'Submersible Pump 1HP', partNumber: 'PMP-10', category: 'plumber', condition: 'new', stock: 0 }
  ];

  function filterInventory(products, { search = '', category = 'all', condition = 'all', stockStatus = 'all' }) {
    return products.filter(p => {
      const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.partNumber.toLowerCase().includes(search.toLowerCase());
      const matchCat = category === 'all' || p.category === category;
      const matchCond = condition === 'all' || p.condition === condition;
      const matchStock = stockStatus === 'all'
        ? true
        : stockStatus === 'in_stock'
        ? p.stock > 5
        : stockStatus === 'low_stock'
        ? p.stock > 0 && p.stock <= 5
        : p.stock === 0;
      return matchSearch && matchCat && matchCond && matchStock;
    });
  }

  // Filter 1: Low stock items
  const lowStock = filterInventory(sampleProducts, { stockStatus: 'low_stock' });
  assert.equal(lowStock.length, 1);
  assert.equal(lowStock[0].id, 'p2');

  // Filter 2: AC category + Brand New
  const acNew = filterInventory(sampleProducts, { category: 'ac', condition: 'new' });
  assert.equal(acNew.length, 1);
  assert.equal(acNew[0].id, 'p1');

  // Filter 3: Search term "Pump"
  const pumpSearch = filterInventory(sampleProducts, { search: 'Pump' });
  assert.equal(pumpSearch.length, 1);
  assert.equal(pumpSearch[0].id, 'p3');
});
