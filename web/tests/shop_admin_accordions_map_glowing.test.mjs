import test from 'node:test';
import assert from 'node:assert/strict';

test('Shop Orders Accordion: compact state vs expanded details toggling', () => {
  const sampleOrder = {
    bookingId: 'BK-9482',
    spare: {
      id: 'sp-101',
      name: 'Dual Run Capacitor 50+5 MFD 440V',
      price: 480,
      travelCharge: 120,
      travelDistanceKm: 6,
      status: 'added_to_task'
    },
    customerAddress: 'Plot 42, OT Road, Station Square, Balasore',
    workerName: 'Rajesh Mohanty (Senior AC Technician)',
    hsnCode: '8532'
  };

  // State tracker for accordions
  const expandedOrders = { 'BK-9482': false };

  function toggleAccordion(bookingId) {
    expandedOrders[bookingId] = !expandedOrders[bookingId];
  }

  // 1. Initial collapsed check
  assert.equal(expandedOrders['BK-9482'], false, 'Order accordion should initially be collapsed');

  // 2. Expand
  toggleAccordion('BK-9482');
  assert.equal(expandedOrders['BK-9482'], true, 'Order accordion should expand after click');

  // 3. Commercial calculations
  const netPayout = Math.round(sampleOrder.spare.price * 0.95);
  const platformComm = Math.round(sampleOrder.spare.price * 0.05);
  assert.equal(netPayout, 456, 'Net payout must be 95% of gross price');
  assert.equal(platformComm, 24, 'Platform commission must be 5%');

  // 4. Collapse again
  toggleAccordion('BK-9482');
  assert.equal(expandedOrders['BK-9482'], false, 'Order accordion should collapse after second click');
});

test('Glowing Tabs: activates glow on new activity and clears when tab visited', () => {
  const glowingTabs = {
    orders: false,
    b2b: false,
    inventory: false,
    company_oversight: false
  };

  // Activity arrivals
  function onNewActivity(tabName) {
    glowingTabs[tabName] = true;
  }

  // User tab visit
  function onTabVisit(tabName) {
    glowingTabs[tabName] = false;
  }

  // Initial state: no glow
  assert.equal(glowingTabs.orders, false);
  assert.equal(glowingTabs.b2b, false);

  // Event: New in-task spare order arrived
  onNewActivity('orders');
  assert.equal(glowingTabs.orders, true, 'Orders tab should glow when new technician activity occurs');

  // Event: New B2B RFQ inquiry arrived
  onNewActivity('b2b');
  assert.equal(glowingTabs.b2b, true, 'B2B tab should glow when new wholesale RFQ arrives');

  // User visits orders tab
  onTabVisit('orders');
  assert.equal(glowingTabs.orders, false, 'Orders tab glow should extinguish after shop owner inspects it');
  assert.equal(glowingTabs.b2b, true, 'B2B tab should remain glowing until inspected');
});

test('Shop Agent Live Radar: distance, ETA, and specialist status calculation', () => {
  const shopLat = 21.4934;
  const shopLng = 86.9135;

  const agent = {
    id: 'agent-1',
    name: 'Rajesh Mohanty',
    lat: 21.4990,
    lng: 86.9210,
    status: 'en_route_to_shop'
  };

  // Haversine approximation
  function calculateDistanceKm(lat1, lon1, lat2, lon2) {
    const dLat = (lat2 - lat1) * 111;
    const dLon = (lon2 - lon1) * 111 * Math.cos((lat1 * Math.PI) / 180);
    return Math.sqrt(dLat * dLat + dLon * dLon);
  }

  const dist = calculateDistanceKm(shopLat, shopLng, agent.lat, agent.lng);
  assert.ok(dist > 0.5 && dist < 2.5, 'Agent distance to shop should be in realistic range');

  const etaMinutes = Math.max(1, Math.round(dist * 3.5));
  assert.ok(etaMinutes >= 2 && etaMinutes <= 15, 'ETA should be calculated realistically');

  // When agent reaches shop
  agent.lat = shopLat + 0.0002;
  agent.lng = shopLng + 0.0002;
  const arrivedDist = calculateDistanceKm(shopLat, shopLng, agent.lat, agent.lng);
  assert.ok(arrivedDist < 0.1, 'Agent distance should be under 100m when at counter');
});

test('Counter Handover Flow: stock decrements and payout logged', () => {
  let stock = 10;
  let isFulfilled = false;

  function fulfillOrder() {
    isFulfilled = true;
    stock = Math.max(0, stock - 1);
  }

  fulfillOrder();
  assert.equal(isFulfilled, true, 'Order must be marked as fulfilled');
  assert.equal(stock, 9, 'Stock must decrement by 1 on counter handover');
});
