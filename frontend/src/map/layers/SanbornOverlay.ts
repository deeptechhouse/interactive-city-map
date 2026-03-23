import type maplibregl from 'maplibre-gl';
import type { LayerConfig } from '../../types/layer';

const SOURCE_ID = 'sanborn-source';
const LAYER_ID_PREFIX = 'sanborn';

// Sanborn composite image overlays by year
// Positioned over downtown Chicago (The Loop area)
const SANBORN_YEARS: Record<string, { url: string }> = {
  '1897': { url: 'http://localhost:9000/citymap-tiles/sanborn/composite_1897_downtown.jpg' },
  '1911': { url: 'http://localhost:9000/citymap-tiles/sanborn/composite_1911_downtown.jpg' },
  '1950': { url: 'http://localhost:9000/citymap-tiles/sanborn/composite_1950_downtown.jpg' },
};

// Approximate geo-coordinates for the overlay position (Loop/downtown)
const OVERLAY_COORDS: [[number, number], [number, number], [number, number], [number, number]] = [
  [-87.645, 41.895],  // top-left
  [-87.615, 41.895],  // top-right
  [-87.615, 41.875],  // bottom-right
  [-87.645, 41.875],  // bottom-left
];

// Track which year is currently displayed
let currentYear = '1950';

export function addSanbornOverlay(map: maplibregl.Map, config: LayerConfig): void {
  if (map.getSource(SOURCE_ID)) return;

  const yearData = SANBORN_YEARS[currentYear];
  if (!yearData) return;

  map.addSource(SOURCE_ID, {
    type: 'image',
    url: yearData.url,
    coordinates: OVERLAY_COORDS,
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
      source.updateImage({ url: yearData.url, coordinates: OVERLAY_COORDS });
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
