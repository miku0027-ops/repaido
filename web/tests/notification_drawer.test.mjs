import test from 'node:test';
import assert from 'node:assert/strict';

// Helper mirror for notification classification and theme assignment
function classifyNotification(n) {
  const text = `${n.title || ''} ${n.body || ''}`.toLowerCase();

  // Explicit Destination Checks
  if (n.destination === 'promotion' || Boolean(n.campaign_id)) {
    return {
      category: 'offer',
      themeClass: 'notif-theme-offer',
      badgeLabel: 'FESTIVE OFFER',
      actionLabel: 'Claim Offer'
    };
  }

  if (n.destination === 'exchange' || n.destination === 'second_hand') {
    return {
      category: 'marketplace',
      themeClass: 'notif-theme-marketplace',
      badgeLabel: 'MARKETPLACE',
      actionLabel: 'Browse Marketplace'
    };
  }

  if (n.destination === 'b2b_quotation' || n.id?.startsWith('notif-b2b') || Boolean(n.quoteNumber)) {
    return {
      category: 'b2b',
      themeClass: 'notif-theme-b2b',
      badgeLabel: 'B2B QUOTATION',
      actionLabel: n.quoteNumber ? 'View Quotation PDF & Deal' : 'Open B2B Hub'
    };
  }

  if (n.destination === 'arrival') {
    return {
      category: 'arrival',
      themeClass: 'notif-theme-arrival',
      badgeLabel: 'DOORSTEP ARRIVAL',
      actionLabel: 'Doorstep PIN & Tracking'
    };
  }

  if (n.destination === 'wallet') {
    return {
      category: 'escrow',
      themeClass: 'notif-theme-escrow',
      badgeLabel: 'ESCROW & BILLING',
      actionLabel: 'View Payment Details'
    };
  }

  if (n.destination === 'home_plan' || Boolean(n.plan_id)) {
    return {
      category: 'home',
      themeClass: 'notif-theme-home',
      badgeLabel: 'REPAIDO HOME',
      actionLabel: 'View Home Plan'
    };
  }

  // Keyword / Heuristic Checks
  if (/completed|finished|service summary/i.test(text)) {
    return {
      category: 'completed',
      themeClass: 'notif-theme-completed',
      badgeLabel: 'COMPLETED',
      actionLabel: 'View Invoice & Bill'
    };
  }

  if (/b2b quotation|wholesale rfq|bulk quotation|bulk deal|wholesale quote/i.test(text)) {
    return {
      category: 'b2b',
      themeClass: 'notif-theme-b2b',
      badgeLabel: 'B2B QUOTATION',
      actionLabel: 'Open B2B Hub'
    };
  }

  if (/arrived|doorstep|security code|verify code/i.test(text)) {
    return {
      category: 'arrival',
      themeClass: 'notif-theme-arrival',
      badgeLabel: 'DOORSTEP ARRIVAL',
      actionLabel: 'Doorstep PIN & Tracking'
    };
  }

  if (n.job_id || n.destination === 'booking' || /technician|en route|on the way|in progress|dispatched/i.test(text)) {
    return {
      category: 'service',
      themeClass: 'notif-theme-service',
      badgeLabel: 'LIVE SERVICE',
      actionLabel: 'Track Technician'
    };
  }

  if (/paid|escrow|refund|invoice|transaction|cashback/i.test(text)) {
    return {
      category: 'escrow',
      themeClass: 'notif-theme-escrow',
      badgeLabel: 'ESCROW & BILLING',
      actionLabel: 'View Payment Details'
    };
  }

  if (/offer|discount|promo|festive|puja|deal|save/i.test(text)) {
    return {
      category: 'offer',
      themeClass: 'notif-theme-offer',
      badgeLabel: 'FESTIVE OFFER',
      actionLabel: 'Claim Offer'
    };
  }

  if (/marketplace|spare|used|exchange/i.test(text)) {
    return {
      category: 'marketplace',
      themeClass: 'notif-theme-marketplace',
      badgeLabel: 'MARKETPLACE',
      actionLabel: 'Browse Marketplace'
    };
  }

  if (/repaido home|membership/i.test(text)) {
    return {
      category: 'home',
      themeClass: 'notif-theme-home',
      badgeLabel: 'REPAIDO HOME',
      actionLabel: 'View Home Plan'
    };
  }

  return {
    category: 'general',
    themeClass: 'notif-theme-service',
    badgeLabel: 'NOTIFICATION',
    actionLabel: 'View Details'
  };
}

function formatRelativeTime(ts, now = Math.floor(Date.now() / 1000)) {
  if (!ts) return 'Just now';
  const diff = Math.max(0, now - ts);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 172800) return 'Yesterday';
  return `${Math.floor(diff / 86400)}d ago`;
}

test('Side-wise notification drawer accurately color-codes B2B wholesale quotation notices', () => {
  const b2bNotif = {
    id: 'notif-b2b-REP-B2B-QT-2026-0042',
    title: 'Official Wholesale Quotation: REP-B2B-QT-2026-0042',
    body: 'Maa Tarini Spare Hub issued official quotation for 35 Rolls of Pure Copper Refrigeration Tubing. Total: ₹53,514 (Incl. GST & Cargo).',
    destination: 'b2b_quotation',
    quoteNumber: 'REP-B2B-QT-2026-0042'
  };

  const meta = classifyNotification(b2bNotif);
  assert.equal(meta.category, 'b2b');
  assert.equal(meta.themeClass, 'notif-theme-b2b');
  assert.equal(meta.badgeLabel, 'B2B QUOTATION');
  assert.equal(meta.actionLabel, 'View Quotation PDF & Deal');
});

test('Side-wise notification drawer color-codes Doorstep Arrival alerts with Amber theme and OTP badge', () => {
  const arrivalNotif = {
    id: 'notif-arrival-job-901',
    title: 'Technician Arrived at Doorstep',
    body: 'Your AC specialist Rajesh Mohanty has reached your location. Share your 4-digit security PIN 4921 to start work.',
    destination: 'arrival'
  };

  const meta = classifyNotification(arrivalNotif);
  assert.equal(meta.category, 'arrival');
  assert.equal(meta.themeClass, 'notif-theme-arrival');
  assert.equal(meta.badgeLabel, 'DOORSTEP ARRIVAL');
  assert.equal(meta.actionLabel, 'Doorstep PIN & Tracking');
});

test('Side-wise notification drawer color-codes Completed Services and Escrow payments', () => {
  const completedNotif = {
    id: 'notif-completed-job-402',
    title: 'AC Jet Deep Clean Completed',
    body: 'Work finished and verified. Review before/after photos and rate technician.'
  };
  const compMeta = classifyNotification(completedNotif);
  assert.equal(compMeta.category, 'completed');
  assert.equal(compMeta.themeClass, 'notif-theme-completed');
  assert.equal(compMeta.badgeLabel, 'COMPLETED');

  const escrowNotif = {
    id: 'notif-escrow-101',
    title: 'Repaido Escrow Milestone Released',
    body: '₹1,450 successfully transferred from Repaido Escrow upon confirmed delivery.',
    destination: 'wallet'
  };
  const escMeta = classifyNotification(escrowNotif);
  assert.equal(escMeta.category, 'escrow');
  assert.equal(escMeta.themeClass, 'notif-theme-escrow');
  assert.equal(escMeta.badgeLabel, 'ESCROW & BILLING');
});

test('Side-wise notification drawer color-codes Festive Promotions and Marketplace notices', () => {
  const promoNotif = {
    id: 'notif-puja-55',
    title: 'Festive Durga Puja Wholesale & Home Deal: Up to 55% OFF',
    body: 'Grab exclusive festive discounts with 6-month Repaido warranty coverage.',
    destination: 'promotion',
    campaign_id: 'puja-festive-55'
  };
  const promoMeta = classifyNotification(promoNotif);
  assert.equal(promoMeta.category, 'offer');
  assert.equal(promoMeta.themeClass, 'notif-theme-offer');
  assert.equal(promoMeta.badgeLabel, 'FESTIVE OFFER');

  const marketNotif = {
    id: 'notif-market-33',
    title: 'New Copper Tubing Batch Available in Exchange',
    body: 'Grade A+ HVAC spares listed at 40% discount.',
    destination: 'exchange'
  };
  const mktMeta = classifyNotification(marketNotif);
  assert.equal(mktMeta.category, 'marketplace');
  assert.equal(mktMeta.themeClass, 'notif-theme-marketplace');
  assert.equal(mktMeta.badgeLabel, 'MARKETPLACE');
});

test('Relative timestamp formatter generates compact micro labels without UI clutter', () => {
  const now = 1759363200;
  assert.equal(formatRelativeTime(now - 15, now), 'Just now');
  assert.equal(formatRelativeTime(now - 300, now), '5m ago');
  assert.equal(formatRelativeTime(now - 7200, now), '2h ago');
  assert.equal(formatRelativeTime(now - 90000, now), 'Yesterday');
  assert.equal(formatRelativeTime(now - 259200, now), '3d ago');
});
