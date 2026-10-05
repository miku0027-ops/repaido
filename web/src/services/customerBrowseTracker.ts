/**
 * Repaido Customer Behavioral Hydration & Browse Event Tracker
 *
 * Tracks customer browsing sessions and interactions within a rolling 1-hour window.
 * When a customer has browsed the app 3 times or more within 1 hour, high-intent
 * event-driven hydration activates the dynamic motion grid, rotating offers,
 * and 3D option graphics instead of the static services grid.
 */

import { useState, useEffect } from 'react';

export interface BrowseEvent {
  timestamp: number;
  action: string;
}

export const ONE_HOUR_MS = 60 * 60 * 1000; // 3,600,000 ms (1 hour)
export const BROWSE_HYDRATION_THRESHOLD = 3; // 3 browse events within 1 hour
export const BROWSE_STORAGE_KEY = 'repaido:customer:browse_events';
export const BROWSE_CUSTOM_EVENT = 'repaido:browse-activity';

/**
 * Retrieves valid browse events occurring within the last 1 hour.
 * Automatically prunes expired events from storage.
 */
export function getRecentBrowseEvents(): BrowseEvent[] {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(BROWSE_STORAGE_KEY) : null;
    if (!raw) return [];
    const list: BrowseEvent[] = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    
    const now = Date.now();
    const valid = list.filter(item => typeof item.timestamp === 'number' && (now - item.timestamp) < ONE_HOUR_MS);
    
    // Self-healing prune
    if (valid.length !== list.length) {
      localStorage.setItem(BROWSE_STORAGE_KEY, JSON.stringify(valid));
    }
    return valid;
  } catch {
    return [];
  }
}

/**
 * Records a customer browsing action (e.g. app load, tab switch, category explore, service click).
 * Dispatches an event-driven DOM notification so UI components react immediately.
 */
export function recordCustomerBrowse(action = 'browse'): { count: number; isHydrated: boolean } {
  try {
    const current = getRecentBrowseEvents();
    const updated = [...current, { timestamp: Date.now(), action }];
    localStorage.setItem(BROWSE_STORAGE_KEY, JSON.stringify(updated));
    
    const count = updated.length;
    const isHydrated = count >= BROWSE_HYDRATION_THRESHOLD;

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(BROWSE_CUSTOM_EVENT, {
        detail: { count, isHydrated, action }
      }));
    }

    return { count, isHydrated };
  } catch {
    return { count: 0, isHydrated: false };
  }
}

/**
 * Returns true if customer has browsed >= 3 times in the last 1 hour.
 */
export function isCustomerBrowseHydrated(): boolean {
  return getRecentBrowseEvents().length >= BROWSE_HYDRATION_THRESHOLD;
}

/**
 * Returns current count of customer browse events in the last 1 hour.
 */
export function getCustomerBrowseCount(): number {
  return getRecentBrowseEvents().length;
}

/**
 * Clears browse events (useful for testing or session reset).
 */
export function resetCustomerBrowse(): void {
  try {
    localStorage.removeItem(BROWSE_STORAGE_KEY);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(BROWSE_CUSTOM_EVENT, {
        detail: { count: 0, isHydrated: false, action: 'reset' }
      }));
    }
  } catch {}
}

/**
 * React hook that reactively tracks customer browse count and hydration state.
 * Subscribes to local DOM events and cross-tab storage events.
 */
export function useCustomerBrowseHydration() {
  const [browseCount, setBrowseCount] = useState<number>(() => {
    return typeof window !== 'undefined' ? getCustomerBrowseCount() : 0;
  });

  const isHydrated = browseCount >= BROWSE_HYDRATION_THRESHOLD;

  useEffect(() => {
    const sync = () => {
      setBrowseCount(getCustomerBrowseCount());
    };

    window.addEventListener(BROWSE_CUSTOM_EVENT, sync as EventListener);
    window.addEventListener('storage', sync);

    return () => {
      window.removeEventListener(BROWSE_CUSTOM_EVENT, sync as EventListener);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return {
    isHydrated,
    browseCount,
    recordBrowse: recordCustomerBrowse,
    resetBrowse: resetCustomerBrowse
  };
}
