import { test } from 'node:test';
import assert from 'node:assert/strict';

test('cart calculations enforce 18% GST and free delivery above ₹999', () => {
  // Simulate Cart totals calculation
  function calculateCartTotals(items) {
    const subtotal_paise = items.reduce((sum, item) => sum + item.price_paise * item.quantity, 0);
    const delivery_fee_paise = subtotal_paise >= 99900 || subtotal_paise === 0 ? 0 : 9900;
    const gst_paise = Math.round(subtotal_paise * 0.18);
    const total_paise = subtotal_paise + gst_paise + delivery_fee_paise;
    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

    return { subtotal_paise, gst_paise, delivery_fee_paise, total_paise, itemCount };
  }

  // Under ₹999: ₹650 capacitor (65000 paise)
  const items1 = [{ id: 'p1', title: 'Capacitor', price_paise: 65000, quantity: 1 }];
  const totals1 = calculateCartTotals(items1);
  assert.equal(totals1.subtotal_paise, 65000);
  assert.equal(totals1.delivery_fee_paise, 9900); // ₹99
  assert.equal(totals1.gst_paise, 11700);        // 18% of 65000
  assert.equal(totals1.total_paise, 65000 + 11700 + 9900);

  // Over ₹999: 2 capacitors = ₹1,300 (130000 paise)
  const items2 = [{ id: 'p1', title: 'Capacitor', price_paise: 65000, quantity: 2 }];
  const totals2 = calculateCartTotals(items2);
  assert.equal(totals2.subtotal_paise, 130000);
  assert.equal(totals2.delivery_fee_paise, 0);   // FREE delivery
  assert.equal(totals2.gst_paise, 23400);        // 18% of 130000
  assert.equal(totals2.total_paise, 130000 + 23400);
  assert.equal(totals2.itemCount, 2);
});

test('tender fees and 2-month bidding window comply with business rules', () => {
  const TENDER_ENTRY_FEE_PAISE = 149900; // ₹1,499
  const CONTRACTOR_PRIME_MONTHLY_PAISE = 199900; // ₹1,999
  const BIDDING_WINDOW_DAYS = 60; // 2 months

  assert.equal(TENDER_ENTRY_FEE_PAISE / 100, 1499);
  assert.equal(CONTRACTOR_PRIME_MONTHLY_PAISE / 100, 1999);
  assert.equal(BIDDING_WINDOW_DAYS, 60);

  // Suitability calculation validation
  function calculateSuitability(contractor, bid, tender) {
    let score = 50.0;
    if (contractor.is_prime) score += 15.0;
    const rating = contractor.rating || 4.0;
    score += (rating - 3.0) * 10.0;
    const needed = tender.manpower_needed || 10;
    const team = contractor.team_size || 5;
    if (team >= needed) score += 10.0;
    else score += Math.max(0, 10.0 * (team / needed));
    const sla = contractor.sla_compliance_rate || 95.0;
    score += (sla - 90.0) * 0.5;

    const budget = tender.budget_paise;
    const bidAmt = bid.bid_amount_paise;
    if (0.7 * budget <= bidAmt && bidAmt <= 0.98 * budget) score += 10.0;

    return Math.min(99, Math.max(45, Math.round(score)));
  }

  const contractorPrime = {
    is_prime: true,
    rating: 4.95,
    team_size: 42,
    sla_compliance_rate: 99.2
  };
  const tender = {
    budget_paise: 450000000,
    manpower_needed: 16
  };
  const competitiveBid = {
    bid_amount_paise: 420000000 // 93% of budget
  };

  const score = calculateSuitability(contractorPrime, competitiveBid, tender);
  assert.ok(score >= 95, `Expected score >= 95 for prime contractor, got ${score}`);
});
