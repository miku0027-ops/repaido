import test from 'node:test';
import assert from 'node:assert/strict';

// Mock storage and time window for Customer Browse Hydration testing
const ONE_HOUR_MS = 60 * 60 * 1000;
const HYDRATION_THRESHOLD = 3;

function pruneAndCountEvents(events, now = Date.now()) {
  const valid = events.filter(e => typeof e.timestamp === 'number' && (now - e.timestamp) < ONE_HOUR_MS);
  return {
    events: valid,
    count: valid.length,
    isHydrated: valid.length >= HYDRATION_THRESHOLD
  };
}

function recordEvent(events, action = 'browse', timestamp = Date.now()) {
  const updated = [...events, { timestamp, action }];
  return pruneAndCountEvents(updated, timestamp);
}

test('First-time visitor with 1 or 2 visits is NOT hydrated (renders static grid)', () => {
  let state = { events: [] };
  
  // Visit 1: landing on home
  state = recordEvent(state.events, 'session_start');
  assert.strictEqual(state.count, 1);
  assert.strictEqual(state.isHydrated, false, 'First visit should not trigger motion hydration');

  // Visit 2: tab switch
  state = recordEvent(state.events, 'tab:Services');
  assert.strictEqual(state.count, 2);
  assert.strictEqual(state.isHydrated, false, 'Second visit should remain on static grid');
});

test('Customer who browses 3 times within 1 hour triggers dynamic motion grid hydration', () => {
  let state = { events: [] };
  const baseTime = Date.now();

  // Event 1: app open at T = 0
  state = recordEvent(state.events, 'app_open', baseTime);
  assert.strictEqual(state.count, 1);
  assert.strictEqual(state.isHydrated, false);

  // Event 2: market visit at T + 10 mins
  state = recordEvent(state.events, 'tab:ShopSpares', baseTime + (10 * 60 * 1000));
  assert.strictEqual(state.count, 2);
  assert.strictEqual(state.isHydrated, false);

  // Event 3: return to home at T + 25 mins (3rd browse within 1 hour)
  state = recordEvent(state.events, 'tab:Explore', baseTime + (25 * 60 * 1000));
  assert.strictEqual(state.count, 3);
  assert.strictEqual(state.isHydrated, true, 'Customer with 3 browse events in 1 hour must be hydrated');
});

test('Events older than 1 hour (60 minutes) expire and do NOT count towards hydration', () => {
  const now = Date.now();
  const twoHoursAgo = now - (2 * 60 * 60 * 1000);
  const seventyMinsAgo = now - (70 * 60 * 1000);
  const tenMinsAgo = now - (10 * 60 * 1000);

  // 2 stale events + 1 recent event
  const events = [
    { timestamp: twoHoursAgo, action: 'stale_visit_1' },
    { timestamp: seventyMinsAgo, action: 'stale_visit_2' },
    { timestamp: tenMinsAgo, action: 'recent_visit' }
  ];

  const result = pruneAndCountEvents(events, now);
  assert.strictEqual(result.count, 1, 'Only events within 1 hour should be counted');
  assert.strictEqual(result.isHydrated, false, 'Expired visits cannot trigger hydration');
  assert.strictEqual(result.events[0].action, 'recent_visit');
});

test('4th and subsequent browse events within 1 hour maintain hydration continuously', () => {
  let state = { events: [] };
  const now = Date.now();

  state = recordEvent(state.events, 'visit_1', now);
  state = recordEvent(state.events, 'visit_2', now + 1000);
  state = recordEvent(state.events, 'visit_3', now + 2000);
  assert.strictEqual(state.isHydrated, true);

  // 4th visit
  state = recordEvent(state.events, 'visit_4', now + 3000);
  assert.strictEqual(state.count, 4);
  assert.strictEqual(state.isHydrated, true, 'Subsequent visits within window maintain hydration');
});

test('Exact boundary check: event at 59m 59s is valid, event at 60m 01s is pruned', () => {
  const now = Date.now();
  const validEventTime = now - (ONE_HOUR_MS - 1000); // 59 mins 59 secs
  const expiredEventTime = now - (ONE_HOUR_MS + 1000); // 60 mins 01 sec

  const events = [
    { timestamp: validEventTime, action: 'boundary_valid' },
    { timestamp: expiredEventTime, action: 'boundary_expired' }
  ];

  const result = pruneAndCountEvents(events, now);
  assert.strictEqual(result.count, 1);
  assert.strictEqual(result.events[0].action, 'boundary_valid');
});
