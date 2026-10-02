/** Small display helpers for the contact list: external links (and the guard that keeps
 * them safe) and date formatting. Kept out of the .tsx so React fast-refresh works. */

/** Illinois Secretary of State business search — LLC managers / registered agent. Free;
 * no API and it blocks scripted requests, so it's a link the user opens and pastes into. */
export const IL_SOS_SEARCH_URL = 'https://apps.ilsos.gov/businessentitysearch/';

/**
 * Only render http(s) links. Websites come from third-party place data; a
 * "javascript:" URL in an href would run in our page when clicked (XSS). O(n).
 */
export function safeHref(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** "Oct 2, 2026" from an ISO date; '' stays ''. */
export function formatLookupDate(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
