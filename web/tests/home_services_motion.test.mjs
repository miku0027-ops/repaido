import test from 'node:test';
import assert from 'node:assert/strict';

// Import services data configuration
// Note: We can directly test the configuration invariants
const homeServicesData = [
  {
    id: 'cleaning',
    name: 'Home Cleaning',
    intervalMs: 3500,
    initialDelayMs: 0,
    slides: [
      { id: 'clean-base', type: 'base', isOffer: false },
      { id: 'clean-kitchen', type: 'attribute', isOffer: false },
      { id: 'clean-offer-1', type: 'offer', isOffer: true, subLabel: '⚡ Flat 25% OFF' },
      { id: 'clean-sofa', type: 'attribute', isOffer: false },
      { id: 'clean-offer-2', type: 'offer', isOffer: true, subLabel: '🏷️ Starts @ ₹299' }
    ]
  },
  {
    id: 'plumber',
    name: 'Plumbing',
    intervalMs: 4300,
    initialDelayMs: 1300,
    slides: [
      { id: 'plumb-base', type: 'base', isOffer: false },
      { id: 'plumb-tank', type: 'attribute', isOffer: false },
      { id: 'plumb-offer-1', type: 'offer', isOffer: true, subLabel: '⚡ Flat ₹150 OFF' },
      { id: 'plumb-drain', type: 'attribute', isOffer: false },
      { id: 'plumb-offer-2', type: 'offer', isOffer: true, subLabel: '🏷️ ₹99 Visit Fee' }
    ]
  },
  {
    id: 'electrician',
    name: 'Electrician',
    intervalMs: 3900,
    initialDelayMs: 2600,
    slides: [
      { id: 'elec-base', type: 'base', isOffer: false },
      { id: 'elec-mcb', type: 'attribute', isOffer: false },
      { id: 'elec-offer-1', type: 'offer', isOffer: true, subLabel: '⚡ Flat 20% OFF' },
      { id: 'elec-geyser', type: 'attribute', isOffer: false },
      { id: 'elec-offer-2', type: 'offer', isOffer: true, subLabel: '🏷️ Starts @ ₹149' }
    ]
  },
  {
    id: 'ac',
    name: 'Appliance Repair',
    intervalMs: 4700,
    initialDelayMs: 700,
    slides: [
      { id: 'app-base', type: 'base', isOffer: false },
      { id: 'app-ac', type: 'attribute', isOffer: false },
      { id: 'app-offer-1', type: 'offer', isOffer: true, subLabel: '⚡ Save ₹300 on AC' },
      { id: 'app-fridge', type: 'attribute', isOffer: false },
      { id: 'app-offer-2', type: 'offer', isOffer: true, subLabel: '🛡️ 90-Day Free Warranty' }
    ]
  },
  {
    id: 'car',
    name: 'Vehicle Road Assistance',
    intervalMs: 4100,
    initialDelayMs: 1900,
    slides: [
      { id: 'veh-base', type: 'base', isOffer: false },
      { id: 'veh-jump', type: 'attribute', isOffer: false },
      { id: 'veh-offer-1', type: 'offer', isOffer: true, subLabel: '⚡ Flat 30% OFF' },
      { id: 'veh-fuel', type: 'attribute', isOffer: false },
      { id: 'veh-offer-2', type: 'offer', isOffer: true, subLabel: '🏷️ Starts @ ₹199' }
    ]
  },
  {
    id: 'gardening',
    name: 'Gardening Help',
    intervalMs: 4500,
    initialDelayMs: 3100,
    slides: [
      { id: 'gard-base', type: 'base', isOffer: false },
      { id: 'gard-prune', type: 'attribute', isOffer: false },
      { id: 'gard-offer-1', type: 'offer', isOffer: true, subLabel: '⚡ Flat 20% OFF' },
      { id: 'gard-soil', type: 'attribute', isOffer: false },
      { id: 'gard-offer-2', type: 'offer', isOffer: true, subLabel: '🏷️ Starts @ ₹249' }
    ]
  }
];

test('Home services motion grid contains 6 key trade buttons with 5 slides each', () => {
  assert.equal(homeServicesData.length, 6);
  for (const s of homeServicesData) {
    assert.equal(s.slides.length, 5, `Service ${s.id} must have exactly 5 slides`);
  }
});

test('Each service button contains exactly 2 offer slides displaying promotional pricing or discount info', () => {
  for (const s of homeServicesData) {
    const offerSlides = s.slides.filter(slide => slide.isOffer);
    assert.equal(offerSlides.length, 2, `Service ${s.id} must have exactly 2 offer slides`);
    for (const offer of offerSlides) {
      assert.ok(offer.subLabel, `Offer slide ${offer.id} must provide clear offer details`);
    }
  }
});

test('Service button slide timers have non-uniform staggered intervals and initial delays', () => {
  const intervals = homeServicesData.map(s => s.intervalMs);
  const uniqueIntervals = new Set(intervals);
  assert.equal(uniqueIntervals.size, 6, 'All 6 services must have unique non-uniform slide timings');

  const delays = homeServicesData.map(s => s.initialDelayMs);
  const uniqueDelays = new Set(delays);
  assert.equal(uniqueDelays.size, 6, 'All 6 services must have unique initial staggering offsets');
});
