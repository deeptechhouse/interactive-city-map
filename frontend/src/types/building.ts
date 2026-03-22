export interface Building {
  id: string;
  slug: string;
  city_slug: string;
  name: string | null;
  address: string | null;
  year_built: number | null;
  year_demolished: number | null;
  stories: number | null;
  building_type: string | null;
  architect: string | null;
  style: string | null;
  description: string | null;
  is_hidden: boolean;
  has_interior: boolean;
  geometry: GeoJSON.Geometry;
  created_at: string;
  updated_at: string;
}

export interface BuildingUpdate {
  name?: string | null;
  address?: string | null;
  year_built?: number | null;
  year_demolished?: number | null;
  stories?: number | null;
  building_type?: string | null;
  architect?: string | null;
  style?: string | null;
  description?: string | null;
  is_hidden?: boolean;
  has_interior?: boolean;
}
