/**
 * City list for the city selector.
 *
 * The list normally comes from the backend database. In static mode (the usual way the
 * map runs — no Docker/database) there is no backend, and the selector used to show a
 * red "Error loading cities" even though the map worked fine (2026-10-02). Now it falls
 * back to the cities the frontend already knows (utils/geoUtils.ts CITY_DEFAULTS).
 */
import { apiClient } from './client';
import type { City } from '../types/city';
import { CITY_DEFAULTS } from '../utils/geoUtils';
import { IS_STATIC } from '../utils/staticMode';

// ADJUSTABLE: display names/states for the built-in cities. Add a city here AND in
// CITY_DEFAULTS (geoUtils.ts) to offer it without the backend.
const BUILT_IN_NAMES: Record<string, { name: string; state: string }> = {
  chicago: { name: 'Chicago', state: 'IL' },
  detroit: { name: 'Detroit', state: 'MI' },
};

/** Cities the map can show without the backend. O(c) time, O(c) space — c = built-in cities. */
export function builtInCities(): City[] {
  // O(c) time, O(c) space — c = cities in CITY_DEFAULTS (2).
  return Object.entries(CITY_DEFAULTS).map(([slug, d]) => ({
    id: slug,
    slug,
    name: BUILT_IN_NAMES[slug]?.name ?? slug,
    state: BUILT_IN_NAMES[slug]?.state ?? '',
    center_lat: d.center[1],
    center_lng: d.center[0],
    default_zoom: d.zoom,
    bounds: null,
    created_at: '',
    updated_at: '',
  }));
}

/** Backend list when available; built-in list in static mode or if the backend fails.
 * O(c) time, O(c) space — c = cities returned. */
export async function getCities(): Promise<City[]> {
  if (IS_STATIC) return builtInCities();
  try {
    const cities = await apiClient.get<City[]>('/api/cities');
    return cities.length ? cities : builtInCities();
  } catch {
    return builtInCities();
  }
}

/** One city from the backend (one HTTP call). O(1) time, O(1) space — n = 1 city. */
export async function getCity(slug: string): Promise<City> {
  return apiClient.get<City>(`/api/cities/${slug}`);
}
