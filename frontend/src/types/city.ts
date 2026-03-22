export interface City {
  id: string;
  slug: string;
  name: string;
  state: string;
  center_lat: number;
  center_lng: number;
  default_zoom: number;
  bounds: GeoJSON.BBox | null;
  created_at: string;
  updated_at: string;
}
