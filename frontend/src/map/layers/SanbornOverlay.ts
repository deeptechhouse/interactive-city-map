import type maplibregl from 'maplibre-gl';
import type { LayerConfig } from '../../types/layer';

const SOURCE_ID = 'sanborn-source';
const LAYER_ID_PREFIX = 'sanborn';

// Individual Sanborn sheet overlays — downtown Chicago Vol. 1, 1906 N&W
// Each sheet covers roughly 2-3 city blocks (~0.003° lng x 0.004° lat)
// Default position: centered on The Loop, user adjusts with nudge/rotate controls
const SHEET_BASE_URL = 'http://localhost:9000/citymap-tiles/sanborn/1906_downtown';
const TOTAL_SHEETS = 59;

// Each sheet covers roughly this size (adjustable via scale)
const SHEET_WIDTH_DEG = 0.006;  // ~660m
const SHEET_HEIGHT_DEG = 0.008; // ~890m

// Default center for sheet overlay (The Loop)
const DEFAULT_CENTER: [number, number] = [-87.6298, 41.8819];

const SANBORN_YEARS: Record<string, { url: string; label: string; sheets: number; coords: [[number,number],[number,number],[number,number],[number,number]] }> = {}

// Build sheet entries dynamically
for (let i = 1; i <= TOTAL_SHEETS; i++) {
  const num = String(i).padStart(4, '0');
  SANBORN_YEARS[`sheet-${i}`] = {
    url: `${SHEET_BASE_URL}/sheet_${num}.jpg`,
    label: `Sheet ${i}`,
    sheets: 1,
    coords: [
      [DEFAULT_CENTER[0] - SHEET_WIDTH_DEG/2, DEFAULT_CENTER[1] + SHEET_HEIGHT_DEG/2],
      [DEFAULT_CENTER[0] + SHEET_WIDTH_DEG/2, DEFAULT_CENTER[1] + SHEET_HEIGHT_DEG/2],
      [DEFAULT_CENTER[0] + SHEET_WIDTH_DEG/2, DEFAULT_CENTER[1] - SHEET_HEIGHT_DEG/2],
      [DEFAULT_CENTER[0] - SHEET_WIDTH_DEG/2, DEFAULT_CENTER[1] - SHEET_HEIGHT_DEG/2],
    ],
  };
}

// Track which sheet is currently displayed
let currentYear = 'sheet-1';

// Manual adjustment state
let offsetLng = 0;
let offsetLat = 0;
let rotationDeg = 0;
let scaleFactor = 1.0;

function getAdjustedCoords(): [[number,number],[number,number],[number,number],[number,number]] {
  const yearData = SANBORN_YEARS[currentYear];
  if (!yearData) return [[0,0],[0,0],[0,0],[0,0]];

  // Get center of the default coords
  const cx0 = (yearData.coords[0][0] + yearData.coords[2][0]) / 2;
  const cy0 = (yearData.coords[0][1] + yearData.coords[2][1]) / 2;

  // Apply scale around center, then offset
  const scaled = yearData.coords.map(([lng, lat]) => {
    const dx = (lng - cx0) * scaleFactor;
    const dy = (lat - cy0) * scaleFactor;
    return [cx0 + dx + offsetLng, cy0 + dy + offsetLat] as [number, number];
  });

  // Apply rotation around center of scaled/offset coords
  if (rotationDeg !== 0) {
    const cx = (scaled[0][0] + scaled[2][0]) / 2;
    const cy = (scaled[0][1] + scaled[2][1]) / 2;
    const rad = (rotationDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return scaled.map(([lng, lat]) => {
      const dx = lng - cx;
      const dy = lat - cy;
      return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos] as [number, number];
    }) as [[number,number],[number,number],[number,number],[number,number]];
  }

  return scaled as [[number,number],[number,number],[number,number],[number,number]];
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

export function scaleSanborn(map: maplibregl.Map, factor: number): void {
  scaleFactor *= factor;
  applyAdjustment(map);
}

export function getScale(): number {
  return scaleFactor;
}

export function resetSanbornOffset(): void {
  offsetLng = 0;
  offsetLat = 0;
  rotationDeg = 0;
  scaleFactor = 1.0;
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
