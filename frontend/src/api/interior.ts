import { apiClient } from './client';

export interface InteriorSource {
  id: string;
  building_id: string;
  city_id: string;
  source_type: string;
  source_url: string | null;
  source_date: string | null;
  fetch_date: string | null;
  raw_data: Record<string, unknown> | null;
  raster_url: string | null;
  geojson: Record<string, unknown> | null;
  confidence: number;
  status: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface InteriorRoom {
  id: string;
  building_id: string;
  floor_plan_id: string | null;
  source_id: string | null;
  level: number;
  room_type: string | null;
  name: string | null;
  area_sqm: number | null;
  capacity: number | null;
  metadata: Record<string, unknown> | null;
  geom: GeoJSON.Geometry | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface InteriorWall {
  id: string;
  building_id: string;
  floor_plan_id: string | null;
  source_id: string | null;
  level: number;
  wall_type: string;
  material: string | null;
  thickness_m: number | null;
  geom: GeoJSON.Geometry | null;
  created_at: string | null;
}

export interface InteriorFeature {
  id: string;
  building_id: string;
  floor_plan_id: string | null;
  source_id: string | null;
  level: number;
  feature_type: string;
  name: string | null;
  metadata: Record<string, unknown> | null;
  geom: GeoJSON.Geometry | null;
  created_at: string | null;
}

export interface InteriorSummary {
  building_id: string;
  source_count: number;
  room_count: number;
  wall_count: number;
  feature_count: number;
  has_extracted_data: boolean;
}

// --- Sources ---

// O(n) time, O(n) space — n = sources returned in the response (JSON-parsed client-side)
export async function getSources(buildingId: string): Promise<InteriorSource[]> {
  return apiClient.get<InteriorSource[]>(
    `/api/v1/buildings/${buildingId}/interior/sources`,
  );
}

// O(1) time, O(1) space
export async function createSource(
  buildingId: string,
  data: {
    source_type: string;
    source_url?: string;
    raster_url?: string;
    confidence?: number;
  },
): Promise<InteriorSource> {
  return apiClient.post<InteriorSource>(
    `/api/v1/buildings/${buildingId}/interior/sources`,
    data,
  );
}

// O(1) time, O(1) space
export async function updateSourceStatus(
  sourceId: string,
  status: string,
): Promise<InteriorSource> {
  return apiClient.patch<InteriorSource>(
    `/api/v1/interior/sources/${sourceId}/status`,
    { status },
  );
}

// O(1) time, O(1) space
export async function triggerExtraction(
  sourceId: string,
): Promise<{ status: string; source_id: string }> {
  return apiClient.post<{ status: string; source_id: string }>(
    `/api/v1/interior/sources/${sourceId}/extract`,
    {},
  );
}

// --- Rooms ---

// O(n) time, O(n) space — n = rooms returned in the response (JSON-parsed client-side)
export async function getRooms(
  buildingId: string,
  level?: number,
): Promise<InteriorRoom[]> {
  const query = level !== undefined ? `?level=${level}` : '';
  return apiClient.get<InteriorRoom[]>(
    `/api/v1/buildings/${buildingId}/interior/rooms${query}`,
  );
}

// O(v) time, O(v) space — v = vertices in the geometry (JSON-serialised into the request body)
export async function createRoom(
  buildingId: string,
  data: {
    level: number;
    room_type?: string;
    name?: string;
    area_sqm?: number;
    capacity?: number;
    geom: GeoJSON.Geometry;
  },
): Promise<InteriorRoom> {
  return apiClient.post<InteriorRoom>(
    `/api/v1/buildings/${buildingId}/interior/rooms`,
    data,
  );
}

// O(1) time, O(1) space
export async function deleteRoom(roomId: string): Promise<void> {
  return apiClient.delete(`/api/v1/interior/rooms/${roomId}`);
}

// --- Walls ---

// O(n) time, O(n) space — n = walls returned in the response (JSON-parsed client-side)
export async function getWalls(
  buildingId: string,
  level?: number,
): Promise<InteriorWall[]> {
  const query = level !== undefined ? `?level=${level}` : '';
  return apiClient.get<InteriorWall[]>(
    `/api/v1/buildings/${buildingId}/interior/walls${query}`,
  );
}

// O(v) time, O(v) space — v = vertices in the geometry (JSON-serialised into the request body)
export async function createWall(
  buildingId: string,
  data: {
    level: number;
    wall_type: string;
    material?: string;
    thickness_m?: number;
    geom: GeoJSON.Geometry;
  },
): Promise<InteriorWall> {
  return apiClient.post<InteriorWall>(
    `/api/v1/buildings/${buildingId}/interior/walls`,
    data,
  );
}

// O(1) time, O(1) space
export async function deleteWall(wallId: string): Promise<void> {
  return apiClient.delete(`/api/v1/interior/walls/${wallId}`);
}

// --- Features ---

// O(n) time, O(n) space — n = features returned in the response (JSON-parsed client-side)
export async function getFeatures(
  buildingId: string,
  level?: number,
): Promise<InteriorFeature[]> {
  const query = level !== undefined ? `?level=${level}` : '';
  return apiClient.get<InteriorFeature[]>(
    `/api/v1/buildings/${buildingId}/interior/features${query}`,
  );
}

// O(v) time, O(v) space — v = vertices in the geometry (JSON-serialised into the request body)
export async function createFeature(
  buildingId: string,
  data: {
    level: number;
    feature_type: string;
    name?: string;
    metadata?: Record<string, unknown>;
    geom: GeoJSON.Geometry;
  },
): Promise<InteriorFeature> {
  return apiClient.post<InteriorFeature>(
    `/api/v1/buildings/${buildingId}/interior/features`,
    data,
  );
}

// O(1) time, O(1) space
export async function deleteFeature(featureId: string): Promise<void> {
  return apiClient.delete(`/api/v1/interior/features/${featureId}`);
}

// --- Summary ---

// O(1) time, O(1) space
export async function getSummary(buildingId: string): Promise<InteriorSummary> {
  return apiClient.get<InteriorSummary>(
    `/api/v1/buildings/${buildingId}/interior/summary`,
  );
}
