import type maplibregl from 'maplibre-gl';

/** Convert map bounds to a [west, south, east, north] bbox array */
// O(1) time, O(1) space — n = 1 bounds object (two corners read)
export function boundsToArray(bounds: maplibregl.LngLatBounds): [number, number, number, number] {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  return [sw.lng, sw.lat, ne.lng, ne.lat];
}

/** Convert bbox array to query string param */
// O(1) time, O(1) space — k = 4 bbox numbers joined
export function bboxToParam(bbox: [number, number, number, number]): string {
  return bbox.join(',');
}

/** Get Martin tile URL for a given table */
// O(1) time, O(1) space — n = 1 URL template filled
export function martinTileUrl(tableName: string): string {
  const base = import.meta.env.VITE_MARTIN_URL || 'http://localhost:3030';
  return `${base}/${tableName}/{z}/{x}/{y}`;
}

/** Get the API base URL */
// O(1) time, O(1) space — n = 1 env lookup
export function apiBaseUrl(): string {
  return import.meta.env.VITE_API_URL || 'http://localhost:8000';
}

/** City center coordinates and default zoom levels */
export const CHICAGO_CENTER: [number, number] = [-87.6298, 41.8781];
export const CHICAGO_ZOOM = 11;

export const DETROIT_CENTER: [number, number] = [-83.0458, 42.3314];
export const DETROIT_ZOOM = 11;

/** Per-city center and zoom configs (fallback when API data isn't loaded yet) */
export const CITY_DEFAULTS: Record<string, { center: [number, number]; zoom: number }> = {
  chicago: { center: CHICAGO_CENTER, zoom: CHICAGO_ZOOM },
  detroit: { center: DETROIT_CENTER, zoom: DETROIT_ZOOM },
  // Same values as cities/dayton/index.ts — keep in sync.
  dayton: { center: [-84.1916, 39.7589], zoom: 12 },
};

/** Get city center/zoom by slug, defaulting to Chicago */
// O(1) time, O(1) space — n = 1 keyed lookup in CITY_DEFAULTS
export function getCityDefaults(slug: string): { center: [number, number]; zoom: number } {
  return CITY_DEFAULTS[slug] ?? { center: CHICAGO_CENTER, zoom: CHICAGO_ZOOM };
}

/** Darken a hex color by a factor (0-1) */
// O(1) time, O(1) space — k = 3 colour channels parsed and darkened
export function darkenColor(hex: string, factor: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const dr = Math.round(r * (1 - factor));
  const dg = Math.round(g * (1 - factor));
  const db = Math.round(b * (1 - factor));
  return `#${dr.toString(16).padStart(2, '0')}${dg.toString(16).padStart(2, '0')}${db.toString(16).padStart(2, '0')}`;
}
