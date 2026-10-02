import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { layers as protomapsLayers, namedTheme } from 'protomaps-themes-base';
import { Protocol } from 'pmtiles';

import { CHICAGO_CENTER, CHICAGO_ZOOM } from '../utils/geoUtils';
import { INTERIORS_AVAILABLE, IS_STATIC } from '../utils/staticMode';
import type { LayerConfig, LayerState } from '../types/layer';
import { getLayerSourceUrl } from './hooks/useMapLayers';
import { useMapClick } from './hooks/useMapClick';
import { getCityProfile } from '../cities/registry';
import { removeLayersAndSources } from './cityLayerLifecycle';
import { addBoundaryLayer, getBoundaryLayerIds } from './layers/BoundaryLayer';

import { addRailroadLayer, getRailroadLayerIds } from './layers/RailroadLayer';
import { addZoningLayer, getZoningLayerIds } from './layers/ZoningLayer';
import { addTransitLayer, getTransitLayerIds } from './layers/TransitLayer';
import { addBuildingLayer, getBuildingLayerIds } from './layers/BuildingLayer';
import { addPOILayer, getPOILayerIds } from './layers/POILayer';
import { addWaterwayLayer, getWaterwayLayerIds } from './layers/WaterwayLayer';
import { addParkLayer, getParkLayerIds } from './layers/ParkLayer';
import { addSanbornOverlay, getSanbornLayerIds } from './layers/SanbornOverlay';
import { addMajorStreetsLayer, getMajorStreetsLayerIds } from './layers/MajorStreetsLayer';
import { addZipCodeLayer, getZipCodeLayerIds } from './layers/ZipCodeLayer';
import { addPoliceDistrictLayer, getPoliceDistrictLayerIds } from './layers/PoliceDistrictLayer';
import { addWardLayer, getWardLayerIds } from './layers/WardLayer';
import { DISTRICT_INFO } from './layers/data/policeDistrictsData';
import { WARD_INFO } from './layers/data/wardsData';
import { addGangTerritoryLayer, getGangTerritoryLayerIds } from './layers/GangTerritoryLayer';
import { GANG_INFO } from './layers/data/gangTerritoryData';
import { addFederalPropertyLayer, getFederalPropertyLayerIds } from './layers/FederalPropertyLayer';
import { addRailroadRowLayer, getRailroadRowLayerIds } from './layers/RailroadRowLayer';
import { addNeighborhoodLayer, getNeighborhoodLayerIds } from './layers/NeighborhoodLayer';
import { addCouncilDistrictLayer, getCouncilDistrictLayerIds } from './layers/CouncilDistrictLayer';
import { addDLBALayer, getDLBALayerIds } from './layers/DLBALayer';
import { addBlightLayer, getBlightLayerIds } from './layers/BlightLayer';

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
  major_streets: { add: addMajorStreetsLayer, getIds: getMajorStreetsLayerIds },
  zip_codes: { add: addZipCodeLayer, getIds: getZipCodeLayerIds },
  police_districts: { add: addPoliceDistrictLayer, getIds: getPoliceDistrictLayerIds },
  wards: { add: addWardLayer, getIds: getWardLayerIds },
  gang_territory: { add: addGangTerritoryLayer, getIds: getGangTerritoryLayerIds },
  federal_properties: { add: addFederalPropertyLayer, getIds: getFederalPropertyLayerIds },
  railroad_row: { add: addRailroadRowLayer, getIds: getRailroadRowLayerIds },
  // Detroit-specific layers
  neighborhoods: { add: addNeighborhoodLayer, getIds: getNeighborhoodLayerIds },
  council_districts: { add: addCouncilDistrictLayer, getIds: getCouncilDistrictLayerIds },
  dlba_properties: { add: addDLBALayer, getIds: getDLBALayerIds },
  abandoned_blight: { add: addBlightLayer, getIds: getBlightLayerIds },
  // Generic boundaries (Detroit DPD precincts, Dayton police areas)
  police_precincts: { add: addBoundaryLayer, getIds: getBoundaryLayerIds },
};

// Chicago's static basemap — used when the city has no profile (never another city's).
const CHICAGO_STATIC_BASEMAP = './data/chicago-basemap.pmtiles';

export interface ClickedBuildingInfo {
  id: string;
  properties: Record<string, unknown>;
}

/** A building chosen for the contact list (selection mode click or popup button). */
export interface BuildingSelectInfo {
  id: string;
  address: string;
  lngLat: [number, number];
}

interface MapContainerProps {
  layers: LayerState[];
  citySlug?: string;
  cityCenter?: [number, number];
  cityZoom?: number;
  onMapReady?: (map: maplibregl.Map) => void;
  onBuildingClick?: (info: ClickedBuildingInfo) => void;
  /** When true, clicking a building adds/removes it from the contact list instead of opening a popup. */
  selectionMode?: boolean;
  onBuildingSelect?: (info: BuildingSelectInfo) => void;
  /** A discovery marker was clicked (its building key) — the discovery panel removes it. */
  onCandidateClick?: (key: string) => void;
}

// O(l) time, O(l) space — l = layers in the list (each effect walks it once, each layer has a fixed handful of style sublayers)
export const MapContainer: React.FC<MapContainerProps> = ({
  layers, citySlug, cityCenter, cityZoom, onMapReady, onBuildingClick,
  selectionMode = false, onBuildingSelect, onCandidateClick,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);

  // Click handling — the city profile adds popup layers MapContainer has no builder for.
  const profile = getCityProfile(citySlug ?? 'chicago');
  const cityPopups = React.useMemo(() => profile?.popups ?? {}, [profile]);
  // O(p) time, O(p) space — p = city popup layers (≤ ~6)
  const cityPopupLayers = React.useMemo(() => Object.keys(cityPopups), [cityPopups]);
  const clickInfo = useMapClick(mapInstance, cityPopupLayers);

  // layer id → { city it was added for, style layer ids } — so a city switch can remove
  // exactly what the previous city drew (cityLayerLifecycle.ts explains why).
  const addedRef = useRef(new Map<string, { city: string; ids: string[] }>());
  // The open feature popup — closed on city switch so one city's details never sit on
  // top of another city's map.
  const popupRef = useRef<maplibregl.Popup | null>(null);
  useEffect(() => {
    popupRef.current?.remove();
    popupRef.current = null;
  }, [citySlug]);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const staticBasemap = getCityProfile(citySlug ?? 'chicago')?.staticAssets.basemapPmtiles
      ?? CHICAGO_STATIC_BASEMAP;
    // The basemap (streets, labels — background only) is each city's local clipped
    // PMTiles in BOTH modes; database mode serves the data layers from PostGIS, not this.
    // TRAP (fixed 2026-10-02): database mode used to point at a dated planet build,
    // build.protomaps.com/20250313.pmtiles — Protomaps prunes those after ~a week, so
    // the background was blank in database mode. Fonts are local for the same reason.
    const basemapUrl = `pmtiles://${staticBasemap}`;

    const basemapStyle: maplibregl.StyleSpecification = {
      version: 8,
      glyphs: './fonts/{fontstack}/{range}.pbf',
      sources: {
        protomaps: {
          type: 'vector',
          url: basemapUrl,
          attribution:
            '<a href="https://protomaps.com">Protomaps</a> | <a href="https://openstreetmap.org">OSM</a>',
        },
      },
      layers: protomapsLayers('protomaps', namedTheme('dark')),
    };

    const initialCenter = cityCenter ?? CHICAGO_CENTER;
    const initialZoom = cityZoom ?? CHICAGO_ZOOM;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: basemapStyle,
      center: initialCenter,
      zoom: initialZoom,
      minZoom: 3,
      maxZoom: 20,
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(
      new maplibregl.ScaleControl({ maxWidth: 200, unit: 'imperial' }),
      'bottom-right',
    );

    map.on('load', () => {
      // Dev-only test hook: the multi-city smoke test (city switching, stray layers) reads
      // the live style from here. Stripped from production builds by Vite (DEV is false).
      if (import.meta.env.DEV) (window as unknown as { __citymap?: maplibregl.Map }).__citymap = map;
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

  // Fly to new city when cityCenter/cityZoom changes (city switch)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !cityCenter) return;
    map.flyTo({ center: cityCenter, zoom: cityZoom ?? 11, duration: 1500 });
  }, [cityCenter?.[0], cityCenter?.[1], cityZoom]);

  // Each city ships its own clipped basemap (both modes) — swap it on city switch.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const path = getCityProfile(citySlug ?? 'chicago')?.staticAssets.basemapPmtiles
      ?? CHICAGO_STATIC_BASEMAP;
    const source = map.getSource('protomaps') as maplibregl.VectorTileSource | undefined;
    if (source && source.url !== `pmtiles://${path}`) source.setUrl(`pmtiles://${path}`);
  }, [citySlug, mapLoaded]);

  // Add data layers once map is loaded
  // O(l + L) time per run, O(l) space — l = layers in the list; L = style layers removed
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const city = citySlug ?? 'chicago';
    const cityProfile = getCityProfile(city);
    // useMapLayers swaps its list one render AFTER citySlug changes; ignore ids the
    // current city doesn't offer so the stale list can't add Chicago data to Detroit.
    // O(l) time, O(l) space — l = layers the city offers
    const offered = new Set((cityProfile?.layers() ?? []).map((l) => l.id));

    // Remove what an earlier city added, or what this city no longer offers.
    const stale: string[] = [];
    // O(a) time, O(a) space — a = layers added so far
    for (const [layerId, record] of addedRef.current) {
      if (record.city !== city || !offered.has(layerId)) {
        stale.push(...record.ids);
        addedRef.current.delete(layerId);
      }
    }
    if (stale.length) removeLayersAndSources(map, stale);

    // O(l) time, O(1) space — l = layers in the list
    for (const layer of layers) {
      const registry = LAYER_REGISTRY[layer.id];
      if (!registry || !offered.has(layer.id)) continue;

      const sourceUrl = getLayerSourceUrl(layer.id, city);
      // Layers that use embedded GeoJSON or special sources (no Martin tile URL needed)
      const nonTileLayers = new Set([
        'sanborn', 'police_districts', 'wards', 'gang_territory',
        'federal_properties', 'railroad_row', 'council_districts',
      ]);
      // In static mode, medium layers (railroads, transit, waterways, etc.) also return ''
      // because they will use embedded GeoJSON — allow them through
      if (!sourceUrl && !nonTileLayers.has(layer.id) && !IS_STATIC) continue;

      // Only add if not already added
      const sublayerIds = registry.getIds(layer.id);
      // bigo-lint: disable=BIGO006 — amortised: each layer has a fixed handful of sublayers (≤ 5), so the total stays linear in l
      // O(s) time, O(1) space — s = style sublayers of this layer (≤ 5)
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
          sourceLayer: cityProfile?.sourceLayers?.[layer.id],
        } satisfies LayerConfig);
        addedRef.current.set(layer.id, { city, ids: sublayerIds });
      }
    }
  }, [mapLoaded, layers, citySlug]);

  // Sync visibility and opacity when layer state changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // O(l) time, O(1) space — l = layers in the list (each with a fixed handful of sublayers)
    for (const layer of layers) {
      const registry = LAYER_REGISTRY[layer.id];
      if (!registry) continue;

      const sublayerIds = registry.getIds(layer.id);
      // bigo-lint: disable=BIGO006 — amortised: each layer has a fixed handful of sublayers (≤ 5), so the total stays linear in l
      // O(s) time, O(1) space — s = style sublayers of this layer (≤ 5)
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
          } else if (layerType === 'symbol') {
            map.setPaintProperty(sublayerId, 'text-opacity', layer.opacity);
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
    // Discovery marker: un-select that building, no popup.
    if (clickInfo.featureType === 'candidate') {
      if (typeof props.key === 'string') onCandidateClick?.(props.key);
      return;
    }
    const isBldg = clickInfo.featureType === 'building';
    const lngLat = map.unproject([clickInfo.position.x, clickInfo.position.y]);
    const selectInfo: BuildingSelectInfo | null = isBldg && props.id
      ? {
        id: String(props.id),
        address: typeof props.address === 'string' ? props.address : '',
        lngLat: [lngLat.lng, lngLat.lat],
      }
      : null;

    // Selection mode: a building click toggles it in the contact list — no popup.
    if (selectionMode && selectInfo) {
      onBuildingSelect?.(selectInfo);
      return;
    }

    let html: string;
    const cityPopup = clickInfo.layerId ? cityPopups[clickInfo.layerId] : undefined;
    if (clickInfo.featureType === 'city' && cityPopup) {
      html = cityPopup(props);
    } else if (isBldg) {
      html = buildBuildingPopup(props);
    } else if (clickInfo.featureType === 'railroad') {
      html = buildRailroadPopup(props);
    } else if (clickInfo.featureType === 'zoning') {
      html = buildZoningPopup(props);
    } else if (clickInfo.featureType === 'police_district') {
      html = buildPoliceDistrictPopup(props);
    } else if (clickInfo.featureType === 'ward') {
      html = buildWardPopup(props);
    } else if (clickInfo.featureType === 'gang_territory') {
      html = buildGangTerritoryPopup(props);
    } else if (clickInfo.featureType === 'federal_property') {
      html = buildFederalPropertyPopup(props);
    } else if (clickInfo.featureType === 'railroad_row') {
      html = buildRailroadRowPopup(props);
    } else {
      html = buildPOIPopup(props);
    }

    const popup = new maplibregl.Popup({ closeOnClick: true, maxWidth: '360px' })
      .setLngLat(lngLat)
      .setHTML(html)
      .addTo(map);
    popupRef.current = popup;

    // Wire up "Open Details" / "Add to contact list" buttons in building popups
    if (isBldg && props.id) {
      const el = popup.getElement();
      el?.querySelector('[data-action="add-to-list"]')?.addEventListener('click', () => {
        popup.remove();
        if (selectInfo) onBuildingSelect?.(selectInfo);
      });
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
    // selectionMode / onBuildingSelect are deliberately NOT deps: toggling the mode must
    // not replay the last click (which would add/remove the last-clicked building).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clickInfo, onBuildingClick]);

  return <div ref={containerRef} className="map-container" />;
};

/* ─── Popup HTML builders ─────────────────────────────────────── */

const popupStyles = `
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px; color: #c9d1d9; line-height: 1.5;
`;

const headerStyle = `
  font-size: 15px; font-weight: 600; margin: 0 0 6px 0; color: #e6edf3;
`;

const rowStyle = `
  display: flex; justify-content: space-between; padding: 3px 0;
  border-bottom: 1px solid #30363d;
`;

const labelStyle = `color: #8b949e; font-size: 12px;`;
const valueStyle = `color: #e6edf3; font-weight: 500; text-align: right; max-width: 180px; word-break: break-word;`;

// O(1) time, O(1) space — n = 1 inline style string
const badgeStyle = (bg: string, fg: string) =>
  `display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 11px; font-weight: 500; background: ${bg}; color: ${fg}; margin-right: 4px; margin-bottom: 4px;`;

// O(v) time, O(v) space — v = length of the rendered value
function row(label: string, value: unknown): string {
  if (value === null || value === undefined || value === '' || value === 'null') return '';
  return `<div style="${rowStyle}"><span style="${labelStyle}">${label}</span><span style="${valueStyle}">${value}</span></div>`;
}

// O(m) time, O(m) space — m = size of the building's metadata JSON (parsed for the businesses section)
function buildBuildingPopup(p: Record<string, unknown>): string {
  const name = p.name ?? p.address ?? 'Building';
  const badges: string[] = [];
  const hasInterior = Boolean(p.has_interior) && INTERIORS_AVAILABLE; // see staticMode.ts
  if (hasInterior) badges.push(`<span style="${badgeStyle('#dcfce7', '#166534')}">Interior Map</span>`);
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
    ${buildBusinessesSection(p)}
    <div style="margin-top: 10px; display: flex; gap: 6px;">
      <button data-action="open-details" style="flex:1; padding: 6px 12px; background: #58a6ff; color: #0d1117; border: none; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;">
        ${hasInterior ? 'View Interior &amp; Details' : 'Open Details'}
      </button>
      <button data-action="add-to-list" style="flex:1; padding: 6px 12px; background: #21262d; color: #f0b429; border: 1px solid #f0b429; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;">
        + Contact list
      </button>
    </div>
  </div>`;
}

// O(m) time, O(m) space — m = size of the metadata JSON (parsed once, at most 5 businesses rendered)
function buildBusinessesSection(p: Record<string, unknown>): string {
  let metadata: Record<string, unknown> = {};
  if (p.metadata) {
    try {
      metadata = typeof p.metadata === 'string' ? JSON.parse(p.metadata as string) : p.metadata as Record<string, unknown>;
    } catch { /* ignore */ }
  }
  const businesses = Array.isArray(metadata.businesses) ? metadata.businesses as Array<Record<string, string>> : [];
  if (businesses.length === 0) return '';

  return `
    <div style="margin-top: 8px; border-top: 1px solid #30363d; padding-top: 6px;">
      <div style="font-size: 11px; font-weight: 600; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">
        Businesses at this location (${businesses.length})
      </div>
      ${businesses.slice(0, 5).map(b => `
        <div style="padding: 4px 0; border-bottom: 1px solid #21262d;">
          <div style="font-weight: 600; color: #e6edf3; font-size: 12px;">${b.name || b.legal_name || 'Unknown'}</div>
          ${b.legal_name && b.legal_name !== b.name ? `<div style="color: #8b949e; font-size: 11px;">${b.legal_name}</div>` : ''}
          ${b.license_type ? `<div style="color: #8b949e; font-size: 10px;">${b.license_type}</div>` : ''}
          ${b.phone ? `<div><a href="tel:${b.phone}" style="color:#58a6ff;font-size:11px;">${b.phone}</a></div>` : ''}
          ${b.email ? `<div><a href="mailto:${b.email}" style="color:#58a6ff;font-size:11px;">${b.email}</a></div>` : ''}
          ${b.website ? `<div><a href="${b.website}" target="_blank" style="color:#58a6ff;font-size:11px;">${b.website}</a></div>` : ''}
        </div>
      `).join('')}
    </div>`;
}

// O(1) time, O(1) space — k = 9 ownership labels in a fixed lookup table
function formatOwnershipType(type: string | null | undefined): string | null {
  const map: Record<string, string> = {
    government_transit: 'Public Transit Agency',
    government_passenger: 'Federal (Amtrak)',
    city_owned: 'City of Chicago',
    county_owned: 'Cook County',
    private_class1: 'Private — Class I Railroad',
    private_terminal: 'Private — Terminal/Switching',
    private_shortline: 'Private — Short Line',
    private_industrial: 'Private — Industrial',
    unknown: 'Unknown',
  };
  return type ? (map[type] ?? type) : null;
}

// O(r) time, O(r) space — r = trackage-rights entries joined into the popup
function buildRailroadPopup(p: Record<string, unknown>): string {
  const name = p.name ?? 'Railroad';
  const statusColors: Record<string, [string, string]> = {
    active: ['#dcfce7', '#166534'],
    abandoned: ['#fef2f2', '#991b1b'],
    disused: ['#fefce8', '#854d0e'],
    spur: ['#f3f4f6', '#374151'],
    razed: ['#f3f4f6', '#6b7280'],
  };
  const [bg, fg] = statusColors[p.status as string] ?? ['#f3f4f6', '#374151'];

  return `<div style="${popupStyles} max-width: 340px; padding: 8px;">
    <div style="${headerStyle}">${name}</div>
    <div style="margin-bottom: 8px;">
      <span style="${badgeStyle(bg, fg)}">${p.status ?? 'unknown'}</span>
      ${p.owner ? `<span style="${badgeStyle('#dbeafe', '#1e40af')}">${p.owner}</span>` : ''}
    </div>
    ${row('Owner', p.owner)}
    ${row('Ownership', formatOwnershipType(p.owner_type as string))}
    ${row('Status', p.status)}
    ${row('Track Class', p.track_class)}
    ${row('Trackage Rights', Array.isArray(p.trackage_rights) ? (p.trackage_rights as string[]).join(', ') : p.trackage_rights)}
    ${row('Source', p.source)}
  </div>`;
}

// O(1) time, O(1) space — k = 5 fixed rows
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

// O(m) time, O(m) space — m = size of the POI's metadata JSON (parsed once, at most 5 contacts rendered)
function buildPOIPopup(p: Record<string, unknown>): string {
  const name = p.name ?? 'Point of Interest';
  const badges: string[] = [];
  if (p.category) badges.push(`<span style="${badgeStyle('#ede9fe', '#5b21b6')}">${p.category}</span>`);
  if (p.subcategory) badges.push(`<span style="${badgeStyle('#fce7f3', '#9d174d')}">${p.subcategory}</span>`);

  // Parse metadata for contacts and photos
  let metadata: Record<string, unknown> = {};
  if (p.metadata) {
    try {
      metadata = typeof p.metadata === 'string' ? JSON.parse(p.metadata as string) : p.metadata as Record<string, unknown>;
    } catch { /* ignore */ }
  }

  // Occupancy data
  const occupancy = metadata.occupancy as Record<string, unknown> | undefined;
  const occupancyHtml = occupancy ? `
    <div style="margin-top: 8px; border-top: 1px solid #30363d; padding-top: 6px;">
      <div style="font-size: 11px; font-weight: 600; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Occupancy</div>
      <div style="display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px;">
        <span style="font-size: 20px; font-weight: 700; color: #58a6ff;">${occupancy.estimated_max_occupancy}</span>
        <span style="font-size: 12px; color: #8b949e;">max persons</span>
      </div>
      <div style="font-size: 11px; color: #8b949e;">
        ${occupancy.ibc_classification}<br/>
        ${occupancy.building_sqft ? `${Number(occupancy.building_sqft).toLocaleString()} sqft · ${occupancy.load_factor_sqft_per_person} sqft/person` : (occupancy.note || '')}
      </div>
    </div>` : '';

  const contacts = Array.isArray(metadata.contacts) ? metadata.contacts as Array<Record<string, string>> : [];
  const contactsHtml = contacts.length > 0 ? `
    <div style="margin-top: 8px; border-top: 1px solid #30363d; padding-top: 6px;">
      <div style="font-size: 11px; font-weight: 600; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Contacts</div>
      ${contacts.slice(0, 5).map(c => {
        const nameLine = c.name ? `<span style="font-weight:600;color:#e6edf3;">${c.name}</span>` : '';
        const roleLine = (c.role && c.role !== 'general') ? `<span style="color:#8b949e;font-size:11px;">${c.role}</span>` : '';
        const emailLine = c.email ? `<a href="mailto:${c.email}" style="color:#58a6ff;font-size:11px;">${c.email}</a>` : '';
        const phoneLine = c.phone ? `<a href="tel:${c.phone}" style="color:#58a6ff;font-size:11px;">${c.phone}</a>` : '';
        const top = [nameLine, roleLine].filter(Boolean).join(' — ');
        const bottom = [emailLine, phoneLine].filter(Boolean).join(' · ');
        return (top || bottom) ? `<div style="padding:3px 0;border-bottom:1px solid #21262d;">${top ? `<div>${top}</div>` : ''}${bottom ? `<div style="margin-top:1px;">${bottom}</div>` : ''}</div>` : '';
      }).join('')}
    </div>` : '';

  return `<div style="${popupStyles} max-width: 360px; padding: 8px; max-height: 400px; overflow-y: auto;">
    <div style="${headerStyle}">${name}</div>
    ${badges.length > 0 ? `<div style="margin-bottom: 8px;">${badges.join('')}</div>` : ''}
    ${row('Address', p.address)}
    ${row('Category', p.category)}
    ${row('Phone', p.phone)}
    ${row('Website', p.website ? `<a href="${p.website}" target="_blank" style="color:#58a6ff">${(p.website as string).replace(/^https?:\/\//, '').slice(0, 30)}...</a>` : null)}
    ${row('Description', p.description)}
    ${row('Hours', typeof p.hours === 'string' ? p.hours : null)}
    ${occupancyHtml}
    ${contactsHtml}
  </div>`;
}

function buildPoliceDistrictPopup(p: Record<string, unknown>): string {
  const distNum = p.dist_num as number | undefined;
  const stationName = p.name as string | undefined;

  if (stationName && distNum) {
    const info = DISTRICT_INFO[distNum];
    return `<div style="${popupStyles} max-width: 340px; padding: 8px;">
      <div style="${headerStyle}">\u2605 ${stationName}</div>
      <div style="margin-bottom: 8px;">
        <span style="${badgeStyle('#fef3c7', '#92400e')}">Police Station</span>
      </div>
      ${row('Address', p.address ?? info?.address)}
      ${row('Commander', p.commander ?? info?.commander)}
      ${row('Phone', p.phone ?? info?.phone)}
      ${row('Non-Emergency', '311')}
      ${row('Emergency', '911')}
    </div>`;
  }

  const info = distNum ? DISTRICT_INFO[distNum] : undefined;
  return `<div style="${popupStyles} max-width: 340px; padding: 8px;">
    <div style="${headerStyle}">Police District ${distNum ?? '?'}</div>
    <div style="margin-bottom: 8px;">
      <span style="${badgeStyle('#dbeafe', '#1e40af')}">CPD District</span>
    </div>
    ${info ? row('Station', info.name) : ''}
    ${info ? row('Address', info.address) : ''}
    ${info ? row('Commander', info.commander) : ''}
    ${info ? row('Phone', info.phone) : ''}
    ${row('Non-Emergency', '311')}
    ${row('Emergency', '911')}
  </div>`;
}

function buildWardPopup(p: Record<string, unknown>): string {
  const wardNum = p.ward as number | undefined;
  const info = wardNum ? WARD_INFO[wardNum] : undefined;
  const isOffice = Boolean(p.alderman);

  const alderman = (p.alderman as string) ?? info?.alderman ?? '';
  const title = isOffice ? `Ald. ${alderman}` : `Ward ${wardNum ?? '?'}`;
  const badgeText = isOffice ? "Alderman's Office" : 'City Ward';
  const [badgeBg, badgeFg] = isOffice ? ['#ede9fe', '#5b21b6'] as const : ['#e0e7ff', '#3730a3'] as const;

  return `<div style="${popupStyles} max-width: 340px; padding: 8px;">
    <div style="${headerStyle}">${title}</div>
    <div style="margin-bottom: 8px;">
      <span style="${badgeStyle(badgeBg, badgeFg)}">${badgeText}</span>
      ${wardNum ? `<span style="${badgeStyle('#f0fdf4', '#166534')}">Ward ${wardNum}</span>` : ''}
    </div>
    ${row('Alderman', alderman)}
    ${row('Ward Office', (p.address as string) ?? info?.address)}
    ${row('Ward Phone', (p.ward_phone as string) ?? info?.wardPhone)}
    ${row('City Hall Phone', (p.hall_phone as string) ?? info?.hallPhone)}
    ${row('City Hall Office', info?.hallOffice ? 'Room ' + info.hallOffice : null)}
    ${row('Email', info?.email ? '<a href="mailto:' + info.email + '" style="color:#58a6ff">' + info.email + '</a>' : null)}
    ${row('Staff', info?.staff || null)}
  </div>`;
}

function buildGangTerritoryPopup(p: Record<string, unknown>): string {
  const gangName = (p.gang_name as string) ?? 'Unknown';
  const info = GANG_INFO[gangName];

  return `<div style="${popupStyles} max-width: 340px; padding: 8px;">
    <div style="${headerStyle}">${gangName}</div>
    <div style="margin-bottom: 8px;">
      ${info?.nation ? `<span style="${badgeStyle(info.nation === 'People' ? '#fef3c7' : '#dbeafe', info.nation === 'People' ? '#92400e' : '#1e40af')}">${info.nation} Nation</span>` : ''}
    </div>
    ${row('Alliance', info?.alliance || null)}
    ${row('Source', 'CPD 2025 Gang Boundaries')}
  </div>`;
}

function buildFederalPropertyPopup(p: Record<string, unknown>): string {
  const name = (p.name as string) ?? 'Federal Property';
  const category = (p.category as string) ?? '';
  const categoryLabels: Record<string, [string, string, string]> = {
    law_enforcement: ['Law Enforcement', '#fef2f2', '#991b1b'],
    courts: ['Federal Courts', '#eff6ff', '#1e3a5f'],
    regulatory: ['Regulatory Agency', '#f0fdf4', '#166534'],
    revenue_services: ['Revenue & Services', '#fefce8', '#854d0e'],
    postal: ['Postal Service', '#f5f3ff', '#5b21b6'],
    military: ['Military', '#fdf2f8', '#9d174d'],
    financial: ['Financial', '#ecfdf5', '#065f46'],
    healthcare: ['Healthcare', '#f0f9ff', '#0c4a6e'],
  };
  const [catLabel, catBg, catFg] = categoryLabels[category] ?? ['Federal', '#f3f4f6', '#374151'];

  return `<div style="${popupStyles} max-width: 360px; padding: 8px;">
    <div style="${headerStyle}">${name}</div>
    <div style="margin-bottom: 8px;">
      <span style="${badgeStyle(catBg, catFg)}">${catLabel}</span>
      <span style="${badgeStyle('#dbeafe', '#1e40af')}">U.S. Government</span>
    </div>
    ${row('Agency', p.agency)}
    ${row('Address', p.address)}
    ${row('Phone', p.phone)}
    ${row('Building', p.building_name)}
    ${row('Status', p.ownership)}
  </div>`;
}

function buildRailroadRowPopup(p: Record<string, unknown>): string {
  const pin = (p.pin as string) ?? '';
  const address = (p.address as string) ?? '';
  const assessorUrl = pin ? 'https://www.cookcountyassessor.com/pin/' + pin : '';

  return `<div style="${popupStyles} max-width: 340px; padding: 8px;">
    <div style="${headerStyle}">Railroad Right-of-Way</div>
    <div style="margin-bottom: 8px;">
      <span style="${badgeStyle('#fef3c7', '#92400e')}">Railroad Property</span>
      <span style="${badgeStyle('#fef9c3', '#713f12')}">Class RR</span>
    </div>
    ${row('PIN', pin)}
    ${row('Address', address || null)}
    ${assessorUrl ? row('Assessor', '<a href="' + assessorUrl + '" target="_blank" style="color:#58a6ff">View on Cook County Assessor</a>') : ''}
    <div style="margin-top: 6px; font-size: 11px; color: #8b949e;">
      Toggle the Railroads layer to see line ownership info.
    </div>
  </div>`;
}
