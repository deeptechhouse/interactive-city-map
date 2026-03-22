import { apiClient } from './client';

export interface FloorPlan {
  id: string;
  building_id: string;
  level: number;
  image_url: string;
  created_at: string;
  updated_at: string;
}

export async function getFloorPlans(buildingId: string): Promise<FloorPlan[]> {
  return apiClient.get<FloorPlan[]>(`/api/buildings/${buildingId}/floor-plans`);
}

export async function uploadFloorPlan(
  buildingId: string,
  level: number,
  file: File,
): Promise<FloorPlan> {
  const formData = new FormData();
  formData.append('level', level.toString());
  formData.append('file', file);
  return apiClient.uploadFile<FloorPlan>(
    `/api/buildings/${buildingId}/floor-plans`,
    formData,
  );
}
