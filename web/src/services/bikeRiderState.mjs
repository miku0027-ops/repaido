/** Presentation helpers only. Dispatch, fares and ride transitions remain server-authoritative. */
export const bikeActionLabels = Object.freeze({
  accept: 'Accept ride', decline: 'Decline', depart: 'Go to pickup', arrive: 'At pickup',
  start: 'Verify OTP & start', complete: 'Finish ride', cash_received: 'Confirm cash received',
  cancel: 'Cancel ride', dispute: 'Report a concern',
});

const closedStates = new Set(['completed', 'cancelled', 'declined', 'expired']);
const liveStates = new Set(['accepted', 'on_the_way', 'arrived', 'in_progress', 'completion_pending', 'payment_due', 'payment_reported', 'disputed']);

export function bikeRiderSections(rides = []) {
  const sorted = [...rides].sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
  return {
    current: sorted.filter(ride => liveStates.has(ride.state) && !ride.queued),
    next: sorted.filter(ride => !closedStates.has(ride.state) && (ride.state === 'queued' || ride.queued) && ride.accepted_by_driver),
    offers: sorted.filter(ride => (ride.state === 'offered' || ride.state === 'queued') && !ride.accepted_by_driver),
    history: sorted.filter(ride => closedStates.has(ride.state)).reverse(),
  };
}

export function riderIsOnline(availability, now) {
  if (!availability?.online || !Number.isFinite(now)) return false;
  const captured = Number(availability.position?.captured_at || 0);
  const received = Number(availability.position?.received_at || 0);
  const accuracy = Number(availability.position?.accuracy);
  return captured > 0 && now - captured >= -30 && now - captured <= 120 && received > 0 && now - received >= 0 && now - received <= 75 && Number.isFinite(accuracy) && accuracy <= 100 && accuracy > 0;
}

export function bikeAllowedActions(ride) {
  return Array.isArray(ride?.allowed_actions)
    ? [...new Set(ride.allowed_actions)].filter(action => Object.hasOwn(bikeActionLabels, action))
    : [];
}

export function bikeArrivalCueKeys(rides, {now,enabled,visible,connected,sharing}) {
  if (!enabled || !visible || !connected || !sharing || !Number.isFinite(now)) return [];
  return rides.flatMap(ride => {
    if (ride.queued) return [];
    const phase = ['on_the_way', 'arrived'].includes(ride.state) ? 'pickup' : ride.state === 'in_progress' ? 'destination' : null;
    const stop = phase && ride.stop_status?.[phase];
    return stop?.status === 'inside' && Number.isFinite(stop.valid_until) && stop.valid_until >= now
      ? [`${ride.id}:${phase}`] : [];
  });
}

export function bikeCollectionSummary(ride) {
  const pricing = ride?.pricing || {};
  const value = key => Number.isSafeInteger(pricing[key]) && pricing[key] >= 0 ? pricing[key] : null;
  return {
    free: pricing.free === true,
    customerPaise: value('customer_total_paise'),
  };
}

export function assertBikePosition(position, now = Date.now() / 1000) {
  if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng) || Math.abs(position.lat) > 90 || Math.abs(position.lng) > 180)
    throw new Error('Your device could not provide a valid GPS location.');
  if (!Number.isFinite(position.accuracy) || position.accuracy <= 0 || position.accuracy > 100)
    throw new Error('Precise GPS is needed. Move to an open area and retry.');
  if (!Number.isFinite(position.captured_at) || now - position.captured_at > 120 || position.captured_at - now > 30)
    throw new Error('This GPS reading is too old. Get a fresh location and retry.');
  return position;
}
