/** Availability refreshes are bounded; manual recovery is the only retry after denial. */
export function shouldRefreshPresence({hidden,running,denied,lastAttempt,now,manual=false}) {
  return !hidden && !running && !denied && (manual || now-lastAttempt>=180000);
}
