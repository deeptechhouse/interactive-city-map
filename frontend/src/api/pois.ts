import { apiClient } from './client';
import type { POI, POICreate } from '../types/poi';
import { bboxToParam } from '../utils/geoUtils';

export async function getPOIs(
  slug: string,
  bbox: [number, number, number, number],
  category?: string,
): Promise<POI[]> {
  const bboxParam = bboxToParam(bbox);
  const categoryParam = category ? `&category=${encodeURIComponent(category)}` : '';
  return apiClient.get<POI[]>(`/api/cities/${slug}/pois?bbox=${bboxParam}${categoryParam}`);
}

export async function getPOI(id: string): Promise<POI> {
  return apiClient.get<POI>(`/api/pois/${id}`);
}

export async function createPOI(data: POICreate): Promise<POI> {
  return apiClient.post<POI>('/api/pois', data);
}
