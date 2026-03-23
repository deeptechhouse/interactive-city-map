import type maplibregl from 'maplibre-gl';

/** Convert map bounds to a [west, south, east, north] bbox array */
export function boundsToArray(bounds: maplibregl.LngLatBounds): [number, number, number, number] {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  return [sw.lng, sw.lat, ne.lng, ne.lat];
}

/** Convert bbox array to query string param */
export function bboxToParam(bbox: [number, number, number, number]): string {
  return bbox.join(',');
}

/** Get Martin tile URL for a given table */
export function martinTileUrl(tableName: string): string {
  const base = import.meta.env.VITE_MARTIN_URL || 'http://localhost:3030';
  return `${base}/${tableName}/{z}/{x}/{y}`;
}

/** Get the API base URL */
export function apiBaseUrl(): string {
  return import.meta.env.VITE_API_URL || 'http://localhost:8000';
}

/** Chicago default center and zoom */
export const CHICAGO_CENTER: [number, number] = [-87.6298, 41.8781];
export const CHICAGO_ZOOM = 11;

/** Darken a hex color by a factor (0-1) */
export function darkenColor(hex: string, factor: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const dr = Math.round(r * (1 - factor));
  const dg = Math.round(g * (1 - factor));
  const db = Math.round(b * (1 - factor));
  return `#${dr.toString(16).padStart(2, '0')}${dg.toString(16).padStart(2, '0')}${db.toString(16).padStart(2, '0')}`;
}
