/**
 * Saved searches (presets) — the data model and the pure operations on a list of them.
 * No React, no storage: useSavedSearches.ts wires these to localStorage and the map.
 *
 * A preset = a name + the city it was made in + a SearchSnapshot (every filter) + optionally
 * the map position. Presets are per city because layer ids differ between cities
 * (e.g. 'wards' is Chicago-only), so a Detroit preset would half-apply in Chicago.
 */
import type { SearchSnapshot } from './searchState';

export interface MapView {
  center: [number, number];
  zoom: number;
}

export interface SavedSearch {
  id: string;
  name: string;
  city: string;
  /** ISO timestamp of the last save (create or overwrite). */
  savedAt: string;
  state: SearchSnapshot;
  /** null = applying the preset leaves the map where it is. */
  view: MapView | null;
}

// ADJUSTABLE: longer names get truncated. Above ~60 they overflow the 300px tools panel.
export const MAX_NAME_LENGTH = 60;
// ADJUSTABLE: oldest presets are dropped past this. Each is ~1–3 KB; localStorage holds ~5 MB.
export const MAX_PRESETS = 200;

/** Trim + collapse whitespace + cap length. '' means "not a usable name". O(n), n = name length. */
export function normaliseName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH);
}

/** Names are matched case-insensitively within a city ("Vacant lots" == "vacant lots"). O(n). */
export function findByName(list: readonly SavedSearch[], city: string, name: string): SavedSearch | undefined {
  const target = normaliseName(name).toLowerCase();
  return list.find((p) => p.city === city && p.name.toLowerCase() === target);
}

/**
 * Save under `name`: overwrites the same-named preset in that city (keeping its id and
 * list position), otherwise appends. Returns a new list. O(n), n = presets.
 */
export function upsertPreset(
  list: readonly SavedSearch[],
  input: Omit<SavedSearch, 'id' | 'savedAt'>,
  now: Date,
  makeId: () => string,
): SavedSearch[] {
  const name = normaliseName(input.name);
  if (!name) return [...list];
  const existing = findByName(list, input.city, name);
  const preset: SavedSearch = {
    ...input,
    name,
    id: existing?.id ?? makeId(),
    savedAt: now.toISOString(),
  };
  const next = existing ? list.map((p) => (p.id === existing.id ? preset : p)) : [...list, preset];
  return next.slice(-MAX_PRESETS);
}

/** O(n). */
export function removePreset(list: readonly SavedSearch[], id: string): SavedSearch[] {
  return list.filter((p) => p.id !== id);
}

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** O(1). */
function parseView(raw: unknown): MapView | null {
  if (!raw || typeof raw !== 'object') return null;
  const { center, zoom } = raw as Record<string, unknown>;
  if (!Array.isArray(center) || center.length !== 2 || !center.every(isFiniteNum) || !isFiniteNum(zoom)) {
    return null;
  }
  return { center: [center[0], center[1]], zoom };
}

/**
 * Validate the UNTRUSTED stored list. Malformed entries are dropped one by one rather than
 * discarding everything — one bad preset must not wipe the user's others.
 * Section contents are validated later, by each section's fromJson, when applied.
 * O(n), n = stored presets.
 */
export function parsePresets(raw: unknown): SavedSearch[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedSearch[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;
    const name = typeof p.name === 'string' ? normaliseName(p.name) : '';
    if (typeof p.id !== 'string' || !name || typeof p.city !== 'string') continue;
    if (!p.state || typeof p.state !== 'object' || Array.isArray(p.state)) continue;
    out.push({
      id: p.id,
      name,
      city: p.city,
      savedAt: typeof p.savedAt === 'string' ? p.savedAt : '',
      state: p.state as SearchSnapshot,
      view: parseView(p.view),
    });
  }
  return out.slice(-MAX_PRESETS);
}

/** crypto.randomUUID needs a secure context; plain-http LAN/static hosting falls back. O(1). */
export function makePresetId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
