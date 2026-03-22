import { apiClient } from './client';
import type { Building, BuildingUpdate } from '../types/building';
import { bboxToParam } from '../utils/geoUtils';

export async function getBuilding(id: string): Promise<Building> {
  return apiClient.get<Building>(`/api/buildings/${id}`);
}

export async function getBuildingsByBbox(
  slug: string,
  bbox: [number, number, number, number],
): Promise<Building[]> {
  const bboxParam = bboxToParam(bbox);
  return apiClient.get<Building[]>(`/api/cities/${slug}/buildings?bbox=${bboxParam}`);
}

export async function updateBuilding(id: string, data: BuildingUpdate): Promise<Building> {
  return apiClient.patch<Building>(`/api/buildings/${id}`, data);
}
