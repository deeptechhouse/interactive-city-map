import type maplibregl from 'maplibre-gl';
import type { LayerConfig } from '../../types/layer';

const SOURCE_ID = 'sanborn-source';

export function addSanbornOverlay(map: maplibregl.Map, config: LayerConfig): void {
  if (map.getSource(SOURCE_ID)) return;

  map.addSource(SOURCE_ID, {
    type: 'raster',
    tiles: [config.sourceUrl],
    tileSize: 256,
    minzoom: 0,
    maxzoom: 20,
  });

  map.addLayer({
    id: config.id,
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

export function getSanbornLayerIds(configId: string): string[] {
  return [configId];
}
