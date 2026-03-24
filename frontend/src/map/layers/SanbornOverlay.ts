import type maplibregl from 'maplibre-gl';
import type { LayerConfig } from '../../types/layer';

const SOURCE_ID = 'sanborn-source';
const LAYER_ID_PREFIX = 'sanborn';

// Sanborn composite image overlays by year (all rotated 180°)
// Vol E (1897) = Near South Side, 44 sheets for wider coverage
// Benchmarks: Halsted St ≈ -87.6468, Ashland Ave ≈ -87.6668
// The large composite covers roughly Halsted to State, 22nd to 35th
const SANBORN_YEARS: Record<string, { url: string; label: string; coords: [[number,number],[number,number],[number,number],[number,number]] }> = {
  '1897': {
    url: 'http://localhost:9000/citymap-tiles/sanborn/composite_1897_large_180.jpg',
    label: '1897 (44 sheets)',
    coords: [
      [-87.650, 41.865],  // top-left (NW)
      [-87.615, 41.865],  // top-right (NE)
      [-87.615, 41.830],  // bottom-right (SE)
      [-87.650, 41.830],  // bottom-left (SW)
    ],
  },
  '1897-sm': {
    url: 'http://localhost:9000/citymap-tiles/sanborn/composite_1897_180.jpg',
    label: '1897 (12 sheets)',
    coords: [
      [-87.648, 41.862],
      [-87.618, 41.862],
      [-87.618, 41.842],
      [-87.648, 41.842],
    ],
  },
  '1911': {
    url: 'http://localhost:9000/citymap-tiles/sanborn/composite_1911_180.jpg',
    label: '1911',
    coords: [
      [-87.650, 41.865],
      [-87.618, 41.865],
      [-87.618, 41.840],
      [-87.650, 41.840],
    ],
  },
  '1950': {
    url: 'http://localhost:9000/citymap-tiles/sanborn/composite_1950_180.jpg',
    label: '1950',
    coords: [
      [-87.650, 41.865],
      [-87.618, 41.865],
      [-87.618, 41.840],
      [-87.650, 41.840],
    ],
  },
};

// Track which year is currently displayed
let currentYear = '1897';

// Manual adjustment offsets (user can nudge the overlay)
let offsetLng = 0;
let offsetLat = 0;

export function nudgeSanborn(map: maplibregl.Map, dlng: number, dlat: number): void {
  offsetLng += dlng;
  offsetLat += dlat;
  const yearData = SANBORN_YEARS[currentYear];
  if (!yearData) return;
  const adjusted = yearData.coords.map(([lng, lat]) =>
    [lng + offsetLng, lat + offsetLat] as [number, number],
  ) as [[number,number],[number,number],[number,number],[number,number]];
  try {
    const source = map.getSource(SOURCE_ID) as maplibregl.ImageSource | undefined;
    if (source && 'updateImage' in source) {
      source.updateImage({ url: yearData.url, coordinates: adjusted });
    }
  } catch { /* */ }
}

export function resetSanbornOffset(): void {
  offsetLng = 0;
  offsetLat = 0;
}

export function addSanbornOverlay(map: maplibregl.Map, config: LayerConfig): void {
  if (map.getSource(SOURCE_ID)) return;

  const yearData = SANBORN_YEARS[currentYear];
  if (!yearData) return;

  map.addSource(SOURCE_ID, {
    type: 'image',
    url: yearData.url,
    coordinates: yearData.coords,
  });

  map.addLayer({
    id: `${LAYER_ID_PREFIX}`,
    type: 'raster',
    source: SOURCE_ID,
    layout: {
      visibility: config.visible ? 'visible' : 'none',
    },
    paint: {
      'raster-opacity': config.opacity * 0.7,
    },
  });
}

export function setSanbornYear(map: maplibregl.Map, year: string): void {
  const yearData = SANBORN_YEARS[year];
  if (!yearData) return;
  currentYear = year;

  try {
    const source = map.getSource(SOURCE_ID) as maplibregl.ImageSource | undefined;
    if (source && 'updateImage' in source) {
      source.updateImage({ url: yearData.url, coordinates: yearData.coords });
    }
  } catch {
    // Source may not exist yet
  }
}

export function getSanbornYears(): string[] {
  return Object.keys(SANBORN_YEARS);
}

export function getSanbornLayerIds(_configId: string): string[] {
  return [LAYER_ID_PREFIX];
}
