export const VISIT_KEY = 'repaido.customer.visits.v2';
export const RETURN_VISIT_MS = 30 * 60 * 1000;
export function readVisits(storage) {
  try {
    const value = JSON.parse(storage.getItem(VISIT_KEY) || '{}');
    return Number.isSafeInteger(value.count) && value.count >= 0 ? Math.min(value.count, 1000000) : 0;
  } catch { return 0; }
}
export function addVisit(storage, fallback = 0) {
  const count = Math.min(Math.max(readVisits(storage), fallback) + 1, 1000000);
  try { storage.setItem(VISIT_KEY, JSON.stringify({count})); } catch {}
  return count;
}
