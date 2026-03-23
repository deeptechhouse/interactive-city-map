import type maplibregl from 'maplibre-gl';
import type { LayerConfig } from '../../types/layer';

const SOURCE_ID = 'sanborn-source';
const LAYER_ID_PREFIX = 'sanborn';

// Sanborn composite image overlays by year
// Vol E (1897) covers Near South Side: Chinatown / Bridgeport / Pilsen
// Vol I (1950) covers Chicago Heights (south suburb) — not useful for central city
const SANBORN_YEARS: Record<string, { url: string; label: string; coords: [[number,number],[number,number],[number,number],[number,number]] }> = {
  '1897': {
    url: 'http://localhost:9000/citymap-tiles/sanborn/composite_1897_southside.jpg',
    label: '1897 — Near South Side',
    coords: [
      [-87.640, 41.862],  // top-left
      [-87.618, 41.862],  // top-right
      [-87.618, 41.845],  // bottom-right
      [-87.640, 41.845],  // bottom-left
    ],
  },
};

// Track which year is currently displayed
let currentYear = '1897';

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
