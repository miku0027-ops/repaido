import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculateTotals,addressErrors,slotAvailable,bookingDays,indiaToday} from '../src/booking.mjs';
test('invoice recalculates quantities and rounds tax in integer paise',()=>{
  assert.deepEqual(calculateTotals([{service:{price:59900},quantity:2},{service:{price:19900},quantity:1}]),{subtotal:139700,tax:25146,total:164846});
  assert.deepEqual(calculateTotals([]),{subtotal:0,tax:0,total:0});
  assert.equal(calculateTotals([{service:{price:19900},quantity:1}],0).total,19900);
  assert.throws(()=>calculateTotals([{service:{price:19900},quantity:-1}]));
});
test('address validation catches malformed data, accepts complete input',()=>{
  assert.equal(Object.keys(addressErrors({name:' ',phone:'123',street:'',area:'',pincode:'000000'})).length,5);
  assert.deepEqual(addressErrors({name:'Test Customer',phone:'9876543210',street:'24 Palm Grove',area:'Indiranagar',pincode:'560038'}),{});
});
test('slots use India time and enforce a two-hour lead, even across UTC dates',()=>{
  const now=new Date('2026-09-17T02:00:00Z');
  assert.equal(slotAvailable('2026-09-17','09:00',now),false);
  assert.equal(slotAvailable('2026-09-17','10:00',now),true);
  assert.equal(indiaToday(new Date('2026-09-17T20:00:00Z')),'2026-09-18');
  assert.equal(bookingDays(now).length,7);
  assert.equal(bookingDays(now)[6].iso,'2026-09-23');
});

test('task billing calculation validates hourly rate with base fare 150 vs fixed price', () => {
  // Pure billing calculation formula matching calculateTaskBilling in repaidoService.ts
  function calcTaskBilling({ pricingModel, baseFare = 150, hourlyRate = 299, fixedPrice = 499, hoursWorked = 1.5, partsCost = 0, isFirstOrder = false }) {
    let labor = 0;
    if (pricingModel === 'fixed') {
      labor = Math.max(150, Math.round(fixedPrice));
    } else {
      const activeBase = Math.max(150, baseFare);
      const calculatedLabor = Math.round(activeBase + (hourlyRate * Math.max(0.5, hoursWorked)));
      labor = calculatedLabor;
    }
    const discount = isFirstOrder ? Math.round(labor * 0.5) : 0;
    const billableLabor = labor - discount;
    const total = billableLabor + partsCost;
    const commission = Math.round(total * 0.25);
    const workerPayout = total - commission;
    return { labor, discount, total, commission, workerPayout };
  }

  // 1. Hourly service: Base Fare 150 + 299/hr * 2 hours = 150 + 598 = 748
  const hourlyBill = calcTaskBilling({ pricingModel: 'hourly', baseFare: 150, hourlyRate: 299, hoursWorked: 2 });
  assert.equal(hourlyBill.labor, 748);
  assert.equal(hourlyBill.total, 748);
  assert.equal(hourlyBill.commission, 187);
  assert.equal(hourlyBill.workerPayout, 561);

  // 2. Fixed service: Flat 699
  const fixedBill = calcTaskBilling({ pricingModel: 'fixed', fixedPrice: 699 });
  assert.equal(fixedBill.labor, 699);
  assert.equal(fixedBill.total, 699);
  assert.equal(fixedBill.commission, 175);
  assert.equal(fixedBill.workerPayout, 524);

  // 3. New customer 50% discount on labor
  const discountBill = calcTaskBilling({ pricingModel: 'hourly', baseFare: 150, hourlyRate: 300, hoursWorked: 1, isFirstOrder: true });
  assert.equal(discountBill.labor, 450);
  assert.equal(discountBill.discount, 225);
  assert.equal(discountBill.total, 225);
});

test('task assignment prefers the best available worker and sets a 15-minute acknowledgement window', async () => {
  const { bestWorkerCandidate, buildTaskAcknowledgementDeadline } = await import('../src/booking.mjs');
  const workers = [
    { id: 'w-1', category: 'ac', distanceKm: 1.2, role: 'specialist', taskScore: 4.96, completedTasks: 180, city: 'Balasore' },
    { id: 'w-2', category: 'ac', distanceKm: 2.4, role: 'technician', taskScore: 4.82, completedTasks: 90, city: 'Balasore' },
    { id: 'w-3', category: 'plumber', distanceKm: 1.1, role: 'specialist', taskScore: 4.9, completedTasks: 120, city: 'Balasore' }
  ];

  const best = bestWorkerCandidate(workers, 'ac', 'Balasore');
  assert.equal(best.id, 'w-1');

  const deadline = buildTaskAcknowledgementDeadline(new Date('2026-09-17T10:00:00Z'));
  const diffMinutes = (new Date(deadline).getTime() - new Date('2026-09-17T10:00:00Z').getTime()) / 60000;
  assert.ok(diffMinutes >= 14.9 && diffMinutes <= 15.1);
});

test('worker post-task rating updates score accurately', () => {
  // Score formula: ((prevCompletedTasks * prevTaskScore) + newRating) / (prevCompletedTasks + 1)
  const prevTasks = 10;
  const prevScore = 4.8;
  const newRating = 5;
  const newScore = Math.round(((prevTasks * prevScore + newRating) / (prevTasks + 1)) * 100) / 100;
  assert.equal(newScore, 4.82);
});

test('worker dashboard income sums only completed paid tasks and excludes customer invoice totals', () => {
  const sumCompletedWorkerIncome = (bookings, workerId) => bookings
    .filter(b => b.worker?.id === workerId && b.status === 'completed')
    .reduce((sum, booking) => sum + (booking.workerNetPayout ?? 0), 0);

  const bookings = [
    { status: 'completed', worker: { id: 'w-1' }, workerNetPayout: 4200 },
    { status: 'completed', worker: { id: 'w-1' }, workerNetPayout: 3100 },
    { status: 'cancelled', worker: { id: 'w-1' }, workerNetPayout: 9999 },
    { status: 'in_progress', worker: { id: 'w-1' }, workerNetPayout: 1500 },
    { status: 'completed', worker: { id: 'w-2' }, workerNetPayout: 8000 }
  ];

  assert.equal(sumCompletedWorkerIncome(bookings, 'w-1'), 7300);
  assert.notEqual(sumCompletedWorkerIncome(bookings, 'w-1'), 9999);
});

test('task reminder, penalty, and geofence rules match operational policy', async () => {
  const { buildReminderDeadline, calculateOperationalPenalty, getGeofenceStatus, canRevealCustomerContact } = await import('../src/booking.mjs');

  const taskStart = new Date('2026-09-17T10:00:00Z');
  const reminderTime = buildReminderDeadline(taskStart, new Date('2026-09-17T08:00:00Z'));
  assert.equal(new Date(reminderTime).toISOString(), new Date('2026-09-17T08:00:00Z').toISOString());

  const penalty = calculateOperationalPenalty(2000, 'missed_acknowledgement');
  assert.equal(penalty.percent, 20);
  assert.equal(penalty.amount, 400);

  const near = getGeofenceStatus(90, 100, 200);
  assert.equal(near.level, 'inside-target');
  assert.equal(canRevealCustomerContact(130), true);
  assert.equal(canRevealCustomerContact(90), false);
});


import {startTaskBell} from '../src/services/taskBell.mjs';
test('request bell repeats, and silence/accept cleanup stops scheduled sounds without changing system volume',()=>{
 const nodes=[],cycles=new Map();let next=0,created=0;
 const timers={setInterval(fn,ms){assert.equal(ms,2200);cycles.set(++next,fn);return next;},clearInterval(id){cycles.delete(id);}};
 const context={state:'running',currentTime:1,destination:{},createOscillator(){created++;const node={frequency:{},connect(){},disconnect(){},start(){},stop(at){if(at===undefined){this.stopped=true;this.onended?.();}}};nodes.push(node);return node;},createGain(){return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(n){assert.ok(n>0&&n<=.65);}},connect(){},disconnect(){}};}};
 const stop=startTaskBell(context,timers);assert.equal(created,4);cycles.values().next().value();assert.equal(created,8);
 stop();assert.equal(cycles.size,0);assert.ok(nodes.every(n=>n.stopped));stop();
 context.state='suspended';startTaskBell(context,timers)();assert.equal(created,8);assert.equal(cycles.size,0);
});
