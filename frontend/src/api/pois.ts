import { apiClient } from './client';
import type { POI, POICreate } from '../types/poi';
import { bboxToParam } from '../utils/geoUtils';

// O(n + c) time, O(n + c) space — n = POIs returned in the response; c = length of the category string
export async function getPOIs(
  slug: string,
  bbox: [number, number, number, number],
  category?: string,
): Promise<POI[]> {
  const bboxParam = bboxToParam(bbox);
  const categoryParam = category ? `&category=${encodeURIComponent(category)}` : '';
  return apiClient.get<POI[]>(`/api/v1/cities/${slug}/pois?bbox=${bboxParam}${categoryParam}`);
}

// O(1) time, O(1) space
export async function getPOI(id: string): Promise<POI> {
  return apiClient.get<POI>(`/api/v1/pois/${id}`);
}

// O(v) time, O(v) space — v = vertices in the geometry (JSON-serialised into the request body)
export async function createPOI(data: POICreate): Promise<POI> {
  return apiClient.post<POI>('/api/v1/pois', data);
}
