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

export interface ClickedBuildingInfo {
  id: string;
  properties: Record<string, unknown>;
}

interface MapContainerProps {
  layers: LayerState[];
  onMapReady?: (map: maplibregl.Map) => void;
  onBuildingClick?: (info: ClickedBuildingInfo) => void;
}

export const MapContainer: React.FC<MapContainerProps> = ({ layers, onMapReady, onBuildingClick }) => {
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
      onMapReady?.(map);
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

  // Show click info (rich popup with all available properties)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !clickInfo.clickedFeature || !clickInfo.position) return;

    const props = clickInfo.clickedFeature.properties ?? {};
    const isBldg = clickInfo.featureType === 'building';

    let html: string;
    if (isBldg) {
      html = buildBuildingPopup(props);
    } else if (clickInfo.featureType === 'zoning') {
      html = buildZoningPopup(props);
    } else {
      html = buildPOIPopup(props);
    }

    const popup = new maplibregl.Popup({ closeOnClick: true, maxWidth: '360px' })
      .setLngLat(map.unproject([clickInfo.position.x, clickInfo.position.y]))
      .setHTML(html)
      .addTo(map);

    // Wire up "Open Details" button in building popups
    if (isBldg && props.id) {
      const el = popup.getElement();
      const detailBtn = el?.querySelector('[data-action="open-details"]');
      if (detailBtn) {
        detailBtn.addEventListener('click', () => {
          popup.remove();
          onBuildingClick?.({
            id: String(props.id),
            properties: props as Record<string, unknown>,
          });
        });
      }
    }

    return () => {
      popup.remove();
    };
  }, [clickInfo, onBuildingClick]);

  return <div ref={containerRef} className="map-container" />;
};

/* ─── Popup HTML builders ─────────────────────────────────────── */

const popupStyles = `
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px; color: #0d1117; line-height: 1.5;
`;

const headerStyle = `
  font-size: 15px; font-weight: 600; margin: 0 0 6px 0; color: #0d1117;
`;

const rowStyle = `
  display: flex; justify-content: space-between; padding: 3px 0;
  border-bottom: 1px solid #e5e7eb;
`;

const labelStyle = `color: #6b7280; font-size: 12px;`;
const valueStyle = `color: #111827; font-weight: 500; text-align: right; max-width: 180px; word-break: break-word;`;

const badgeStyle = (bg: string, fg: string) =>
  `display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 11px; font-weight: 500; background: ${bg}; color: ${fg}; margin-right: 4px; margin-bottom: 4px;`;

function row(label: string, value: unknown): string {
  if (value === null || value === undefined || value === '' || value === 'null') return '';
  return `<div style="${rowStyle}"><span style="${labelStyle}">${label}</span><span style="${valueStyle}">${value}</span></div>`;
}

function buildBuildingPopup(p: Record<string, unknown>): string {
  const name = p.name ?? p.address ?? 'Building';
  const badges: string[] = [];
  if (p.has_interior) badges.push(`<span style="${badgeStyle('#dcfce7', '#166534')}">Interior Map</span>`);
  if (p.zoning_code) badges.push(`<span style="${badgeStyle('#dbeafe', '#1e40af')}">${p.zoning_code}</span>`);
  if (p.property_class) badges.push(`<span style="${badgeStyle('#fef3c7', '#92400e')}">${p.property_class}</span>`);

  return `<div style="${popupStyles} max-width: 340px; padding: 8px;">
    <div style="${headerStyle}">${name}</div>
    ${badges.length > 0 ? `<div style="margin-bottom: 8px;">${badges.join('')}</div>` : ''}
    ${row('Address', p.address)}
    ${row('Zoning', p.zoning_code ? `${p.zoning_code}${p.zoning_desc ? ' — ' + p.zoning_desc : ''}` : null)}
    ${row('Year Built', p.year_built)}
    ${row('Floors', p.floors)}
    ${row('Square Feet', p.sq_ft ? Number(p.sq_ft).toLocaleString() : null)}
    ${row('Owner', p.owner_name)}
    ${row('Owner Type', p.owner_type)}
    ${row('Property Class', p.property_class)}
    ${row('Parcel PIN', p.parcel_pin)}
    <div style="margin-top: 10px; display: flex; gap: 6px;">
      <button data-action="open-details" style="flex:1; padding: 6px 12px; background: #2563eb; color: white; border: none; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;">
        ${p.has_interior ? 'View Interior &amp; Details' : 'Open Details'}
      </button>
    </div>
  </div>`;
}

function buildZoningPopup(p: Record<string, unknown>): string {
  const title = p.zone_code ?? p.zone_class ?? 'Zoning District';
  return `<div style="${popupStyles} max-width: 340px; padding: 8px;">
    <div style="${headerStyle}">${title}</div>
    ${row('Zone Code', p.zone_code)}
    ${row('Zone Class', p.zone_class)}
    ${row('Zone Name', p.zone_name)}
    ${row('Description', p.description)}
    ${row('Ordinance Ref', p.ordinance_ref)}
  </div>`;
}

function buildPOIPopup(p: Record<string, unknown>): string {
  const name = p.name ?? 'Point of Interest';
  const badges: string[] = [];
  if (p.category) badges.push(`<span style="${badgeStyle('#ede9fe', '#5b21b6')}">${p.category}</span>`);
  if (p.subcategory) badges.push(`<span style="${badgeStyle('#fce7f3', '#9d174d')}">${p.subcategory}</span>`);

  return `<div style="${popupStyles} max-width: 340px; padding: 8px;">
    <div style="${headerStyle}">${name}</div>
    ${badges.length > 0 ? `<div style="margin-bottom: 8px;">${badges.join('')}</div>` : ''}
    ${row('Address', p.address)}
    ${row('Category', p.category)}
    ${row('Phone', p.phone)}
    ${row('Website', p.website ? `<a href="${p.website}" target="_blank" style="color:#2563eb">${(p.website as string).replace(/^https?:\/\//, '').slice(0, 30)}...</a>` : null)}
    ${row('Description', p.description)}
    ${row('Hours', typeof p.hours === 'string' ? p.hours : null)}
    ${row('Verified', p.verified ? 'Yes' : null)}
  </div>`;
}
