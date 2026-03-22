import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { layers as protomapsLayers, namedTheme } from 'protomaps-themes-base';
import { Protocol } from 'pmtiles';

import { CHICAGO_CENTER, CHICAGO_ZOOM } from '../utils/geoUtils';
import type { LayerConfig, LayerState } from '../types/layer';
import { getLayerSourceUrl } from './hooks/useMapLayers';
import { useMapClick } from './hooks/useMapClick';

import { addRailroadLayer, getRailroadLayerIds } from './layers/RailroadLayer';
import { addZoningLayer, getZoningLayerIds } from './layers/ZoningLayer';
import { addTransitLayer, getTransitLayerIds } from './layers/TransitLayer';
import { addBuildingLayer, getBuildingLayerIds } from './layers/BuildingLayer';
import { addPOILayer, getPOILayerIds } from './layers/POILayer';
import { addWaterwayLayer, getWaterwayLayerIds } from './layers/WaterwayLayer';
import { addParkLayer, getParkLayerIds } from './layers/ParkLayer';
import { addSanbornOverlay, getSanbornLayerIds } from './layers/SanbornOverlay';

// Register PMTiles protocol once
const protocol = new Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

/** Map from layer id to: add function and sublayer-ids function */
const LAYER_REGISTRY: Record<
  string,
  {
    add: (map: maplibregl.Map, config: LayerConfig) => void;
    getIds: (id: string) => string[];
  }
> = {
  railroads: { add: addRailroadLayer, getIds: getRailroadLayerIds },
  zoning: { add: addZoningLayer, getIds: getZoningLayerIds },
  transit: { add: addTransitLayer, getIds: getTransitLayerIds },
  buildings: { add: addBuildingLayer, getIds: getBuildingLayerIds },
  pois: { add: addPOILayer, getIds: getPOILayerIds },
  waterways: { add: addWaterwayLayer, getIds: getWaterwayLayerIds },
  parks: { add: addParkLayer, getIds: getParkLayerIds },
  sanborn: { add: addSanbornOverlay, getIds: getSanbornLayerIds },
};

interface MapContainerProps {
  layers: LayerState[];
}

export const MapContainer: React.FC<MapContainerProps> = ({ layers }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);

  // Click handling
  const clickInfo = useMapClick(mapInstance);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const basemapStyle: maplibregl.StyleSpecification = {
      version: 8,
      glyphs: 'https://cdn.protomaps.com/fonts/pbf/{fontstack}/{range}.pbf',
      sources: {
        protomaps: {
          type: 'vector',
          url: 'pmtiles://https://build.protomaps.com/20250313.pmtiles',
          attribution:
            '<a href="https://protomaps.com">Protomaps</a> | <a href="https://openstreetmap.org">OSM</a>',
        },
      },
      layers: protomapsLayers('protomaps', namedTheme('dark')),
    };

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: basemapStyle,
      center: CHICAGO_CENTER,
      zoom: CHICAGO_ZOOM,
      minZoom: 3,
      maxZoom: 20,
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(
      new maplibregl.ScaleControl({ maxWidth: 200, unit: 'imperial' }),
      'bottom-right',
    );

    map.on('load', () => {
      setMapLoaded(true);
      setMapInstance(map);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      setMapInstance(null);
      setMapLoaded(false);
    };
  }, []);

  // Add data layers once map is loaded
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    for (const layer of layers) {
      const registry = LAYER_REGISTRY[layer.id];
      if (!registry) continue;

      const sourceUrl = getLayerSourceUrl(layer.id);
      if (!sourceUrl && layer.id !== 'sanborn') continue;

      // Only add if not already added
      const sublayerIds = registry.getIds(layer.id);
      const alreadyAdded = sublayerIds.some((id) => {
        try {
          return map.getLayer(id);
        } catch {
          return false;
        }
      });

      if (!alreadyAdded) {
        registry.add(map, {
          id: layer.id,
          name: layer.name,
          group: layer.group,
          sourceUrl,
          visible: layer.visible,
          opacity: layer.opacity,
        } satisfies LayerConfig);
      }
    }
  }, [mapLoaded, layers]);

  // Sync visibility and opacity when layer state changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    for (const layer of layers) {
      const registry = LAYER_REGISTRY[layer.id];
      if (!registry) continue;

      const sublayerIds = registry.getIds(layer.id);
      for (const sublayerId of sublayerIds) {
        try {
          if (!map.getLayer(sublayerId)) continue;

          // Update visibility
          map.setLayoutProperty(
            sublayerId,
            'visibility',
            layer.visible ? 'visible' : 'none',
          );

          // Update opacity based on layer type
          const mapLayer = map.getLayer(sublayerId);
          if (!mapLayer) continue;

          const layerType = mapLayer.type;
          if (layerType === 'fill') {
            const currentOpacity = map.getPaintProperty(sublayerId, 'fill-opacity');
            if (typeof currentOpacity === 'number') {
              map.setPaintProperty(sublayerId, 'fill-opacity', layer.opacity * 0.3);
            }
          } else if (layerType === 'line') {
            map.setPaintProperty(sublayerId, 'line-opacity', layer.opacity);
          } else if (layerType === 'circle') {
            map.setPaintProperty(sublayerId, 'circle-opacity', layer.opacity);
          } else if (layerType === 'raster') {
            map.setPaintProperty(sublayerId, 'raster-opacity', layer.opacity * 0.7);
          }
        } catch {
          // Layer may not exist yet
        }
      }
    }
  }, [layers, mapLoaded]);

  // Show click info (basic popup)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !clickInfo.clickedFeature || !clickInfo.position) return;

    const props = clickInfo.clickedFeature.properties ?? {};
    const name = props.name ?? props.address ?? 'Unknown';
    const type = clickInfo.featureType ?? 'feature';

    const popup = new maplibregl.Popup({ closeOnClick: true, maxWidth: '300px' })
      .setLngLat(map.unproject([clickInfo.position.x, clickInfo.position.y]))
      .setHTML(
        `<div style="color:#0d1117;padding:4px">
          <strong>${type === 'building' ? 'Building' : 'POI'}</strong><br/>
          ${name}
        </div>`,
      )
      .addTo(map);

    return () => {
      popup.remove();
    };
  }, [clickInfo]);

  return <div ref={containerRef} className="map-container" />;
};
