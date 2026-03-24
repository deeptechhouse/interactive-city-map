import type maplibregl from 'maplibre-gl';
import type { LayerConfig } from '../../types/layer';

const SOURCE_ID = 'sanborn-source';
const LAYER_ID_PREFIX = 'sanborn';

// Sanborn composite image overlays by year (all rotated 180°)
// Vol E (1897) = Near South Side, 44 sheets for wider coverage
// Benchmarks: Halsted St ≈ -87.6468, Ashland Ave ≈ -87.6668
// The large composite covers roughly Halsted to State, 22nd to 35th
const SANBORN_YEARS: Record<string, { url: string; label: string; sheets: number; coords: [[number,number],[number,number],[number,number],[number,number]] }> = {
  '1897': {
    url: 'http://localhost:9000/citymap-tiles/sanborn/composite_1897_all_180.jpg',
    label: '1897',
    sheets: 44,
    coords: [
      [-87.655, 41.870],
      [-87.610, 41.870],
      [-87.610, 41.825],
      [-87.655, 41.825],
    ],
  },
  '1911': {
    url: 'http://localhost:9000/citymap-tiles/sanborn/composite_1911_all_180.jpg',
    label: '1911',
    sheets: 14,
    coords: [
      [-87.655, 41.870],
      [-87.610, 41.870],
      [-87.610, 41.825],
      [-87.655, 41.825],
    ],
  },
  '1946': {
    url: 'http://localhost:9000/citymap-tiles/sanborn/composite_1946_all_180.jpg',
    label: '1946',
    sheets: 16,
    coords: [
      [-87.655, 41.870],
      [-87.610, 41.870],
      [-87.610, 41.825],
      [-87.655, 41.825],
    ],
  },
  '1949': {
    url: 'http://localhost:9000/citymap-tiles/sanborn/composite_1949_all_180.jpg',
    label: '1949',
    sheets: 13,
    coords: [
      [-87.655, 41.870],
      [-87.610, 41.870],
      [-87.610, 41.825],
      [-87.655, 41.825],
    ],
  },
  '1950': {
    url: 'http://localhost:9000/citymap-tiles/sanborn/composite_1950_all_180.jpg',
    label: '1950',
    sheets: 15,
    coords: [
      [-87.655, 41.870],
      [-87.610, 41.870],
      [-87.610, 41.825],
      [-87.655, 41.825],
    ],
  },
};

// Track which year is currently displayed
let currentYear = '1897';

// Manual adjustment state
let offsetLng = 0;
let offsetLat = 0;
let rotationDeg = 0;

function getAdjustedCoords(): [[number,number],[number,number],[number,number],[number,number]] {
  const yearData = SANBORN_YEARS[currentYear];
  if (!yearData) return [[0,0],[0,0],[0,0],[0,0]];

  // Apply offset
  const shifted = yearData.coords.map(([lng, lat]) =>
    [lng + offsetLng, lat + offsetLat] as [number, number],
  );

  // Apply rotation around center
  if (rotationDeg !== 0) {
    const cx = (shifted[0][0] + shifted[2][0]) / 2;
    const cy = (shifted[0][1] + shifted[2][1]) / 2;
    const rad = (rotationDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return shifted.map(([lng, lat]) => {
      const dx = lng - cx;
      const dy = lat - cy;
      return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos] as [number, number];
    }) as [[number,number],[number,number],[number,number],[number,number]];
  }

  return shifted as [[number,number],[number,number],[number,number],[number,number]];
}

function applyAdjustment(map: maplibregl.Map): void {
  const yearData = SANBORN_YEARS[currentYear];
  if (!yearData) return;
  try {
    const source = map.getSource(SOURCE_ID) as maplibregl.ImageSource | undefined;
    if (source && 'updateImage' in source) {
      source.updateImage({ url: yearData.url, coordinates: getAdjustedCoords() });
    }
  } catch { /* */ }
}

export function nudgeSanborn(map: maplibregl.Map, dlng: number, dlat: number): void {
  offsetLng += dlng;
  offsetLat += dlat;
  applyAdjustment(map);
}

export function rotateSanborn(map: maplibregl.Map, degrees: number): void {
  rotationDeg += degrees;
  applyAdjustment(map);
}

export function getRotation(): number {
  return rotationDeg;
}

export function resetSanbornOffset(): void {
  offsetLng = 0;
  offsetLat = 0;
  rotationDeg = 0;
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
    // Remove and re-add to fully swap the image source
    const layerId = `${LAYER_ID_PREFIX}`;
    const currentOpacity = map.getLayer(layerId)
      ? (map.getPaintProperty(layerId, 'raster-opacity') as number ?? 0.5)
      : 0.5;
    const wasVisible = map.getLayer(layerId)
      ? map.getLayoutProperty(layerId, 'visibility') === 'visible'
      : true;

    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);

    map.addSource(SOURCE_ID, {
      type: 'image',
      url: yearData.url,
      coordinates: getAdjustedCoords(),
    });

    map.addLayer({
      id: layerId,
      type: 'raster',
      source: SOURCE_ID,
      layout: { visibility: wasVisible ? 'visible' : 'none' },
      paint: { 'raster-opacity': currentOpacity },
    });
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
