/**
 * localStorage wrapper that never throws.
 *
 * Private windows, blocked site data and quota errors all make localStorage throw.
 * Everything saved through here is a convenience (focus selection, contact list), so a
 * failure must degrade to "not remembered" — never crash the map.
 *
 * Values are JSON. Whatever comes back is UNTRUSTED (another tab, an older app version,
 * or a hand-edited value): callers must validate the shape before using it.
 */

/** Read and JSON-parse a key; ``null`` on any failure. O(n) time, O(n) space — n = stored length. */
export function loadJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

/** JSON-stringify and store; silently ignores failures. O(n) time, O(n) space — n = serialised length. */
export function saveJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable or full — not fatal, see module doc */
  }
}
