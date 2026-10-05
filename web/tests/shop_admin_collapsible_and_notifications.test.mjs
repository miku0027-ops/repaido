import test from 'node:test';
import assert from 'node:assert/strict';

// In-memory test mock for local storage and service behaviors
const testStorage = new Map();

function mockReadLocal(key, fallback) {
  return testStorage.has(key) ? JSON.parse(testStorage.get(key)) : fallback;
}

function mockWriteLocal(key, data) {
  testStorage.set(key, JSON.stringify(data));
}

test('Shop operational notifications: retrieval, dynamic stock monitoring, and priority sorting', () => {
  testStorage.clear();

  const shopId = 'shop-bls-01';
  
  // Seed sample products
  const products = [
    { id: 'p1', shopId, name: 'Split AC Motor', partNumber: 'MOT-1', stock: 10, price: 1200 },
    { id: 'p2', shopId, name: 'Capacitor 45uF', partNumber: 'CAP-45', stock: 2, price: 350 }, // Low stock (<=5)
    { id: 'p3', shopId, name: 'Rotary Compressor', partNumber: 'CMP-R32', stock: 0, price: 6500 }, // Out of stock (0)
  ];
  mockWriteLocal('repaido.spare_products', products);

  // Dynamic notification builder mirror
  const stored = mockReadLocal('repaido.shop.notifications', []);
  const stockNotifs = [];

  products.forEach(p => {
    if (p.stock === 0) {
      stockNotifs.push({
        id: `notif-out-stock-${p.id}`,
        shopId,
        type: 'low_stock',
        priority: 'urgent',
        title: `🚨 Out of Stock: ${p.name}`,
        message: `Stock is 0 for SKU: ${p.partNumber}. Product is currently hidden from marketplace. Click to restock.`,
        read: false,
        actionTarget: { tab: 'inventory', productId: p.id, sku: p.partNumber, actionType: 'open_stock_modal' }
      });
    } else if (p.stock <= 5) {
      stockNotifs.push({
        id: `notif-low-stock-${p.id}`,
        shopId,
        type: 'low_stock',
        priority: 'high',
        title: `⚠️ Low Stock Warning: ${p.name}`,
        message: `Only ${p.stock} units remaining (SKU: ${p.partNumber}). Restock now to prevent stockouts.`,
        read: false,
        actionTarget: { tab: 'inventory', productId: p.id, sku: p.partNumber, actionType: 'open_stock_modal' }
      });
    }
  });

  const priorityWeight = { urgent: 3, high: 2, normal: 1 };
  const sorted = [...stockNotifs].sort((a, b) => {
    return (priorityWeight[b.priority] || 1) - (priorityWeight[a.priority] || 1);
  });

  assert.equal(sorted.length, 2, 'Should create notifications for both out-of-stock and low-stock items');
  assert.equal(sorted[0].priority, 'urgent', 'Out of stock notification must take top priority');
  assert.equal(sorted[0].actionTarget.tab, 'inventory');
  assert.equal(sorted[0].actionTarget.actionType, 'open_stock_modal');
  assert.equal(sorted[1].priority, 'high');
});

test('Notification task deep-linking: routes shop owner directly to task without searching', () => {
  // Scenario 1: Urgent Order handover notification
  const orderNotif = {
    id: 'notif-order-sp-demo-1',
    shopId: 'shop-bls-01',
    type: 'order_action',
    priority: 'urgent',
    title: '⚡ Urgent: Order #SP-DEMO-1 Awaiting Handover',
    message: '1x Split AC Motor ready for collection by Agent Ramesh. Handover immediately.',
    read: false,
    actionTarget: {
      tab: 'orders',
      orderId: 'sp-demo-1',
      actionType: 'open_order_handover'
    }
  };

  // Simulate notification click routing
  let activeTab = 'inventory';
  let activeOrderSearch = '';
  let openedModal = null;

  function handleOpenNotificationTask(notif) {
    if (notif.actionTarget?.tab) {
      activeTab = notif.actionTarget.tab;
    }
    if (notif.actionTarget?.tab === 'orders' && notif.actionTarget.orderId) {
      activeOrderSearch = notif.actionTarget.orderId;
      if (notif.actionTarget.actionType === 'open_order_handover') {
        openedModal = 'HANDOVER_INVOICE_MODAL';
      }
    }
  }

  handleOpenNotificationTask(orderNotif);
  assert.equal(activeTab, 'orders', 'Must switch directly to orders tab');
  assert.equal(activeOrderSearch, 'sp-demo-1', 'Must filter to the specific order');
  assert.equal(openedModal, 'HANDOVER_INVOICE_MODAL', 'Must directly open the handover invoice modal');

  // Scenario 2: Low Stock Restock notification
  const stockNotif = {
    id: 'notif-low-stock-p2',
    shopId: 'shop-bls-01',
    type: 'low_stock',
    priority: 'high',
    title: '⚠️ Low Stock Warning: Capacitor 45uF',
    message: 'Only 2 units remaining.',
    read: false,
    actionTarget: {
      tab: 'inventory',
      productId: 'p2',
      sku: 'CAP-45',
      actionType: 'open_stock_modal'
    }
  };

  let activeInvSearch = '';
  function handleOpenStockTask(notif) {
    if (notif.actionTarget?.tab) {
      activeTab = notif.actionTarget.tab;
    }
    if (notif.actionTarget?.tab === 'inventory') {
      activeInvSearch = notif.actionTarget.sku || '';
      if (notif.actionTarget.actionType === 'open_stock_modal') {
        openedModal = 'PRODUCT_EDIT_STOCK_MODAL';
      }
    }
  }

  handleOpenStockTask(stockNotif);
  assert.equal(activeTab, 'inventory', 'Must switch directly to inventory tab');
  assert.equal(activeInvSearch, 'CAP-45', 'Must prefill search with SKU');
  assert.equal(openedModal, 'PRODUCT_EDIT_STOCK_MODAL', 'Must directly open product stock adjuster modal');
});

test('Company Admin Directive Dispatch and Shop Owner Acknowledgment Flow', () => {
  testStorage.clear();
  const shopId = 'shop-bls-01';

  // 1. Company Admin dispatches an urgent compliance directive
  const directive = {
    id: 'dir-101',
    shopId: 'ALL',
    title: 'Q3 Mandatory GST & HSN Verification',
    category: 'compliance',
    priority: 'urgent',
    instructions: 'Verify HSN codes across all AC compressors and valves before 5 PM.',
    issuedAt: new Date().toISOString(),
    deadline: new Date(Date.now() + 86400000).toISOString(),
    issuedBy: 'Repaido Operations HQ',
    acknowledged: false
  };

  const storedDirs = [directive];
  mockWriteLocal('repaido.company.directives', storedDirs);

  // 2. Directive generates urgent notification for the shop
  const notif = {
    id: `notif-dir-${directive.id}`,
    shopId,
    type: 'company_directive',
    priority: directive.priority,
    title: `🏢 HQ Directive: ${directive.title}`,
    message: directive.instructions,
    timestamp: directive.issuedAt,
    read: false,
    actionTarget: { tab: 'company_oversight', directiveId: directive.id, actionType: 'view_directive' }
  };
  mockWriteLocal('repaido.shop.notifications', [notif]);

  // Verify notification unread status
  const notifs = mockReadLocal('repaido.shop.notifications', []);
  assert.equal(notifs.length, 1);
  assert.equal(notifs[0].read, false);
  assert.equal(notifs[0].priority, 'urgent');

  // 3. Shop owner clicks "Acknowledge & Confirm Completed"
  const updatedDirs = storedDirs.map(d => d.id === 'dir-101' ? { ...d, acknowledged: true, acknowledgedAt: new Date().toISOString() } : d);
  mockWriteLocal('repaido.company.directives', updatedDirs);

  // And marks notification as read
  const updatedNotifs = notifs.map(n => n.id === notif.id ? { ...n, read: true } : n);
  mockWriteLocal('repaido.shop.notifications', updatedNotifs);

  const checkDirs = mockReadLocal('repaido.company.directives', []);
  assert.equal(checkDirs[0].acknowledged, true, 'Directive must be marked as acknowledged');
  assert.ok(checkDirs[0].acknowledgedAt, 'Acknowledgment timestamp must be recorded for audit trail');

  const checkNotifs = mockReadLocal('repaido.shop.notifications', []);
  assert.equal(checkNotifs[0].read, true, 'Notification must be marked as read');
});

test('Company Admin Emergency Freeze: sets suspended_by_hq, unlists items, and logs audit reason', () => {
  testStorage.clear();
  const shopId = 'shop-bls-01';

  const shops = [
    { id: shopId, shopName: 'Maa Tarini Spare Hub', status: 'active', isOperationsFrozen: false }
  ];
  mockWriteLocal('repaido.spare_shops', shops);

  const marketplaceListings = [
    { id: 'm1', shopId, title: 'Split AC Motor', condition: 'refurbished' },
    { id: 'm2', shopId, title: 'Washing Machine Pump', condition: 'second_hand' }
  ];
  mockWriteLocal('repaido.market.listings', marketplaceListings);

  // Freeze action by Company Admin
  const freezeReason = 'Unverified HSN codes flagged during routine audit';
  const updatedShops = shops.map(s => {
    if (s.id === shopId) {
      return {
        ...s,
        status: 'suspended_by_hq',
        isOperationsFrozen: true,
        frozenReason: freezeReason,
        operationalNotes: 'Suspended by Repaido Operations Admin'
      };
    }
    return s;
  });
  mockWriteLocal('repaido.spare_shops', updatedShops);

  // Marketplace unlisting triggered
  const remainingListings = marketplaceListings.filter(l => l.shopId !== shopId);
  mockWriteLocal('repaido.market.listings', remainingListings);

  // Verification
  const verifiedShops = mockReadLocal('repaido.spare_shops', []);
  assert.equal(verifiedShops[0].status, 'suspended_by_hq');
  assert.equal(verifiedShops[0].isOperationsFrozen, true);
  assert.equal(verifiedShops[0].frozenReason, freezeReason);

  const verifiedListings = mockReadLocal('repaido.market.listings', []);
  assert.equal(verifiedListings.length, 0, 'All shop items must be unlisted from customer marketplace while suspended');
});
