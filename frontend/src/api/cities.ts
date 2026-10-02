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
import { IS_STATIC } from '../utils/staticMode';
import { listCityProfiles } from '../cities/registry';

/**
 * Cities the map can show without the backend — one per CityProfile (src/cities/<slug>/).
 * To offer a new city, add its profile to cities/registry.ts; nothing here changes.
 * O(c) time, O(c) space — c = registered cities.
 */
export function builtInCities(): City[] {
  // O(c) time, O(c) space — c = registered cities (3).
  return listCityProfiles().map((p) => ({
    id: p.slug,
    slug: p.slug,
    name: p.name,
    state: p.state,
    center_lat: p.center[1],
    center_lng: p.center[0],
    default_zoom: p.defaultZoom,
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
