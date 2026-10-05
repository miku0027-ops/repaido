/** Integer paise throughout. Tax is an illustrative preview value, not a tax opinion. */
export function calculateTotals(items, taxBasisPoints = 1800) {
  if (!Number.isInteger(taxBasisPoints) || taxBasisPoints < 0) throw new Error('Invalid tax rate');
  const subtotal = items.reduce((sum, { service, quantity }) => {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 5 || !Number.isInteger(service.price) || service.price < 0) throw new Error('Invalid cart line');
    return sum + service.price * quantity;
  }, 0);
  const tax = Math.round(subtotal * taxBasisPoints / 10000);
  return { subtotal, tax, total: subtotal + tax };
}
export function addressErrors(address) {
  const errors = {};
  if (address.name.trim().length < 2) errors.name = 'Please enter your full name.';
  if (!/^[6-9]\d{9}$/.test(address.phone)) errors.phone = 'Enter a 10-digit Indian mobile number.';
  if (address.street.trim().length < 5) errors.street = 'Enter your flat number, building and street.';
  if (address.area.trim().length < 2) errors.area = 'Please enter your area.';
  if (!/^[1-9]\d{5}$/.test(address.pincode)) errors.pincode = 'Enter a valid 6-digit PIN code.';
  return errors;
}
export function indiaToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = type => parts.find(p => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function bookingDays(now = new Date()) {
  const base = new Date(`${indiaToday(now)}T12:00:00+05:30`);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(base.getTime() + i * 86400000);
    const iso = indiaToday(day);
    return { iso, weekday: i === 0 ? 'Today' : new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'Asia/Kolkata' }).format(day), number: new Intl.DateTimeFormat('en', { day: '2-digit', timeZone: 'Asia/Kolkata' }).format(day), month: new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'Asia/Kolkata' }).format(day) };
  });
}
export function slotAvailable(date, hour, now = new Date()) {
  return new Date(`${date}T${hour}:00+05:30`).getTime() > now.getTime() + 2 * 3600000;
}

export function bestWorkerCandidate(workers, category, city = 'Balasore') {
  const eligible = workers.filter(worker => {
    if (!worker) return false;
    if (category && worker.category !== category) return false;
    if (worker.distanceKm > 6) return false;
    if (city && worker.city && worker.city.toLowerCase() !== city.toLowerCase()) return false;
    return true;
  });

  if (!eligible.length) return null;

  return eligible
    .map(worker => ({
      ...worker,
      matchScore: Math.min(99, Math.max(75,
        78 + (worker.distanceKm <= 2 ? 12 : worker.distanceKm <= 4 ? 8 : 4) +
        (worker.taskScore >= 4.9 ? 7 : 3) +
        (worker.role === 'specialist' ? 5 : 2) +
        (worker.completedTasks >= 100 ? 5 : 2)
      ))
    }))
    .sort((a, b) => b.matchScore - a.matchScore || a.distanceKm - b.distanceKm)[0];
}

export function buildTaskAcknowledgementDeadline(start = new Date()) {
  return new Date(start.getTime() + 15 * 60 * 1000).toISOString();
}

export function buildReminderDeadline(taskStart, now = new Date()) {
  if (!taskStart) return new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
  const taskTime = new Date(taskStart).getTime();
  const reminderTime = new Date(taskTime - 2 * 60 * 60 * 1000);
  return reminderTime.toISOString();
}

export function calculateOperationalPenalty(amount, reason = 'missed_acknowledgement') {
  if (!Number.isFinite(amount) || amount <= 0) return { amount: 0, percent: 0, reason };

  const penaltyMap = {
    missed_acknowledgement: 20,
    missed_departure: 20,
    late_completion: 10
  };

  const percent = penaltyMap[reason] ?? 0;
  return {
    amount: Math.round(amount * (percent / 100)),
    percent,
    reason
  };
}

export function getGeofenceStatus(distanceMeters, arrivalRadius = 100, targetRadius = 200) {
  if (distanceMeters <= arrivalRadius) {
    return { level: 'inside-target', message: 'Within 100m of the work location.', withinTarget: true };
  }
  if (distanceMeters <= targetRadius) {
    return { level: 'approaching', message: 'Approaching service location. Customer contact remains hidden until inside 100m.', withinTarget: false };
  }
  return { level: 'far', message: 'Outside the active service radius.', withinTarget: false };
}

export function canRevealCustomerContact(distanceMeters) {
  const meters = Number(distanceMeters);
  return meters >= 100 && meters <= 150;
}

export const hours = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'];
