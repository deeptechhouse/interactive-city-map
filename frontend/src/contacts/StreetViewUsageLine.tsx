/**
 * "Google Street View photos this month: 2 of 9,500 free" — under the Contact list heading
 * (asked 2026-10-04), so paid-photo use is visible before anything is opened.
 *
 * Reads GET /api/v1/images/streetview/usage (our own counter — never calls Google).
 * Refreshes when the window regains focus, which is exactly when the user comes back from
 * the Street View pop-up. Hidden when paid photos are off or there's no server.
 */
import React, { useEffect, useState } from 'react';
import { getJsonFrom, lookupApiBase } from './phoneLookup';

export interface StreetViewUsage {
  enabled: boolean;
  /** null = the server's counter file is unreadable (paid photos are blocked until fixed). */
  used: number | null;
  cap: number;
  month: string;
}

/** O(1) time, O(1) space — n = 1 small request. */
export async function fetchStreetViewUsage(base: string | null = lookupApiBase()): Promise<StreetViewUsage | null> {
  if (base === null) return null;
  return getJsonFrom(base)<StreetViewUsage>('/images/streetview/usage');
}

/** The sentence shown, or '' when nothing should show. O(1) time, O(1) space — n = 1 string. */
export function usageText(u: StreetViewUsage | null): string {
  if (!u || !u.enabled) return '';
  if (u.used === null) return 'Google Street View photos: usage counter unreadable — paid photos paused.';
  // O(d) time, O(d) space — d = digits in the number
  const fmt = (n: number) => n.toLocaleString('en-US');
  const left = Math.max(0, u.cap - u.used);
  return left === 0
    ? `Google Street View photos this month: ${fmt(u.used)} of ${fmt(u.cap)} — free limit reached until next month.`
    : `Google Street View photos this month: ${fmt(u.used)} of ${fmt(u.cap)} free.`;
}

// O(1) time, O(1) space — n = 1 line
export const StreetViewUsageLine: React.FC = () => {
  const [usage, setUsage] = useState<StreetViewUsage | null>(null);
  useEffect(() => {
    let cancelled = false;
    // O(1) time, O(1) space — n = 1 request
    const refresh = () => {
      fetchStreetViewUsage()
        .then((u) => !cancelled && setUsage(u))
        .catch(() => !cancelled && setUsage(null));
    };
    refresh();
    window.addEventListener('focus', refresh); // back from the pop-up → show the new count
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refresh);
    };
  }, []);
  const text = usageText(usage);
  return text ? (
    <p className="tools-hint" role="status">
      {text}
    </p>
  ) : null;
};
