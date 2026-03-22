export enum POICategory {
  PerformanceArts = 'performance_arts',
  HospitalityEvents = 'hospitality_events',
  CreativeProduction = 'creative_production',
  CulturalCommunity = 'cultural_community',
  Parks = 'parks',
}

export const POI_CATEGORY_COLORS: Record<POICategory, string> = {
  [POICategory.PerformanceArts]: '#E53E3E',
  [POICategory.HospitalityEvents]: '#DD6B20',
  [POICategory.CreativeProduction]: '#805AD5',
  [POICategory.CulturalCommunity]: '#2B6CB0',
  [POICategory.Parks]: '#38A169',
};

export const POI_CATEGORY_LABELS: Record<POICategory, string> = {
  [POICategory.PerformanceArts]: 'Performance & Arts',
  [POICategory.HospitalityEvents]: 'Hospitality & Events',
  [POICategory.CreativeProduction]: 'Creative & Production',
  [POICategory.CulturalCommunity]: 'Cultural & Community',
  [POICategory.Parks]: 'Parks',
};

export interface POI {
  id: string;
  city_slug: string;
  name: string;
  category: POICategory;
  subcategory: string | null;
  address: string | null;
  description: string | null;
  website: string | null;
  phone: string | null;
  geometry: GeoJSON.Geometry;
  created_at: string;
  updated_at: string;
}

export interface POICreate {
  city_slug: string;
  name: string;
  category: POICategory;
  subcategory?: string | null;
  address?: string | null;
  description?: string | null;
  website?: string | null;
  phone?: string | null;
  geometry: GeoJSON.Geometry;
}
