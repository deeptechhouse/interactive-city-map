import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LayerGroup, LayerState } from '../../types/layer';
import { LAYER_GROUP_LABELS } from '../../types/layer';
import { martinTileUrl } from '../../utils/geoUtils';
import { IS_STATIC } from '../../utils/staticMode';

/**
 * Default layer definitions for a city. Exported for tests (Chicago's list is pinned).
 * O(l) time, O(l) space — l = layers offered (~15).
 */
export function createDefaultLayers(citySlug: string): LayerState[] {
  const base: LayerState[] = [
    // Infrastructure
    { id: 'railroads', name: 'Railroads', group: 'infrastructure', visible: true, opacity: 1 },
    {
      id: 'transit',
      name: citySlug === 'detroit' ? 'Transit (DDOT/SMART/QLine/PM)' : 'CTA Transit',
      group: 'infrastructure',
      visible: true,
      opacity: 1,
    },
    { id: 'waterways', name: 'Waterways', group: 'infrastructure', visible: true, opacity: 1 },
    // Zoning
    { id: 'zoning', name: 'Zoning Districts', group: 'zoning', visible: false, opacity: 1 },
    { id: 'buildings', name: 'Buildings', group: 'zoning', visible: true, opacity: 1 },
    // Points of Interest
    { id: 'pois', name: 'Points of Interest', group: 'poi', visible: true, opacity: 1 },
    // Streets
    { id: 'major_streets', name: 'Major Street Labels', group: 'infrastructure', visible: true, opacity: 1 },
    // Boundaries
    { id: 'zip_codes', name: 'Zip Codes', group: 'zoning', visible: false, opacity: 1 },
    // Historical
    { id: 'sanborn', name: 'Sanborn Maps', group: 'historical', visible: false, opacity: 0.7 },
  ];

  // Parks — NOT offered for Detroit (fixed 2026-10-02). The parks layer paints the whole
  // `parcels` source-layer green, which is right for Chicago (its parcels table holds
  // only parks) but would cover Detroit, whose parcels table holds ~378K real parcels.
  // Detroit parks return with their own `parks` table (docs/detroit_parity TDD §4).
  if (citySlug !== 'detroit') {
    base.push({ id: 'parks', name: 'Parks & Green Space', group: 'parks', visible: true, opacity: 1 });
  }

  // Chicago-specific layers. police_districts is embedded CPD GeoJSON, so it is
  // Chicago-only (fixed 2026-10-02 — it used to be "shared" and drew Chicago districts
  // under every other city). Detroit gets DPD precincts in a later phase. Kept first
  // here so Chicago's layer order is unchanged (pinned in createDefaultLayers.test.ts).
  if (citySlug === 'chicago') {
    base.push(
      { id: 'police_districts', name: 'Police Districts', group: 'government', visible: false, opacity: 1 },
      { id: 'wards', name: 'City Wards', group: 'government', visible: false, opacity: 1 },
      { id: 'gang_territory', name: 'Gang Territory (CPD 2025)', group: 'safety', visible: false, opacity: 1 },
      { id: 'federal_properties', name: 'Federal Properties', group: 'government', visible: false, opacity: 1 },
      { id: 'railroad_row', name: 'Railroad Right-of-Way', group: 'infrastructure', visible: false, opacity: 1 },
    );
  }

  // Detroit-specific layers
  if (citySlug === 'detroit') {
    base.push(
      { id: 'neighborhoods', name: 'Neighborhoods', group: 'government', visible: false, opacity: 1 },
      { id: 'council_districts', name: 'Council Districts', group: 'government', visible: false, opacity: 1 },
      { id: 'dlba_properties', name: 'DLBA Land Bank', group: 'government', visible: false, opacity: 1 },
      { id: 'abandoned_blight', name: 'Abandoned & Blight', group: 'safety', visible: false, opacity: 1 },
    );
  }

  return base;
}

/**
 * Map layer IDs to their Martin tile source URLs (dev mode) or PMTiles/empty (static mode).
 * O(1) time, O(1) space — k = fixed-size lookup table of layer ids.
 */
export function getLayerSourceUrl(layerId: string): string {
  if (IS_STATIC) {
    const staticPmtiles: Record<string, string> = {
      buildings: 'pmtiles://./data/buildings.pmtiles',
      zoning: 'pmtiles://./data/zoning_districts.pmtiles',
      parks: 'pmtiles://./data/parcels.pmtiles',
      railroads: 'pmtiles://./data/railroads.pmtiles',
    };
    if (staticPmtiles[layerId]) return staticPmtiles[layerId];

    const staticGeojsonLayers = new Set([
      'transit', 'waterways', 'major_streets',
      'zip_codes', 'pois',
    ]);
    if (staticGeojsonLayers.has(layerId)) return '';

    return '';
  }

  // Dev mode: Martin vector tile server
  const sourceMap: Record<string, string> = {
    railroads: martinTileUrl('railroads'),
    transit: martinTileUrl('transit_lines'),
    waterways: martinTileUrl('waterways'),
    zoning: martinTileUrl('zoning_districts'),
    buildings: martinTileUrl('buildings'),
    pois: martinTileUrl('pois'),
    major_streets: martinTileUrl('major_streets'),
    zip_codes: martinTileUrl('zip_codes'),
    sanborn: '',
    parks: martinTileUrl('parcels'),
    police_districts: '',
    wards: '',
    gang_territory: '',
    federal_properties: '',
    railroad_row: '',
    // Detroit layers — Martin auto-discovers PostGIS tables
    neighborhoods: martinTileUrl('neighborhoods'),
    council_districts: '',  // Static GeoJSON (embedded in layer file)
    dlba_properties: martinTileUrl('dlba_properties'),
    abandoned_blight: martinTileUrl('blight_violations'),
  };
  return sourceMap[layerId] ?? '';
}

/** Per-layer visibility + opacity as saved in a preset (section key 'layers'). */
export type LayerSnapshot = Record<string, { visible: boolean; opacity: number }>;

/** Capture the layer list for a preset. O(n) time, O(n) space — n = layers. */
export function toLayerSnapshot(layers: readonly LayerState[]): LayerSnapshot {
  const out: LayerSnapshot = {};
  // O(n) time, O(n) space — n = layers
  for (const l of layers) out[l.id] = { visible: l.visible, opacity: l.opacity };
  return out;
}

/**
 * Apply an UNTRUSTED preset snapshot onto the current layer list. Only known layer ids
 * are touched; a layer missing from the snapshot (added after the preset was saved) keeps
 * its current state. Opacity is clamped to 0–1. O(n) time, O(n) space — n = layers.
 */
export function applyLayerSnapshot(layers: readonly LayerState[], raw: unknown): LayerState[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [...layers];
  const snap = raw as Record<string, unknown>;
  // O(n) time, O(n) space — n = layers
  return layers.map((l) => {
    const entry = snap[l.id];
    if (!entry || typeof entry !== 'object') return l;
    const { visible, opacity } = entry as Record<string, unknown>;
    return {
      ...l,
      visible: typeof visible === 'boolean' ? visible : l.visible,
      opacity: typeof opacity === 'number' && Number.isFinite(opacity)
        ? Math.min(1, Math.max(0, opacity))
        : l.opacity,
    };
  });
}

export interface UseMapLayersReturn {
  layers: LayerState[];
  toggleLayer: (id: string) => void;
  setOpacity: (id: string, value: number) => void;
  toggleGroup: (group: LayerGroup) => void;
  getLayersByGroup: () => Record<LayerGroup, LayerState[]>;
  groupLabels: Record<LayerGroup, string>;
  /** Restore visibility/opacity from a saved preset (see applyLayerSnapshot). */
  applySnapshot: (raw: unknown) => void;
}

/** O(l) time, O(l) space — l = layers for the city (state + callbacks over the list). */
export function useMapLayers(citySlug: string = 'chicago'): UseMapLayersReturn {
  const [layers, setLayers] = useState<LayerState[]>(() => createDefaultLayers(citySlug));

  // Recreate layer list when city changes
  useEffect(() => {
    setLayers(createDefaultLayers(citySlug));
  }, [citySlug]);

  const toggleLayer = useCallback((id: string) => {
    setLayers((prev) =>
      // O(l) time, O(l) space — l = layers
      prev.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
    );
  }, []);

  const setOpacity = useCallback((id: string, value: number) => {
    setLayers((prev) =>
      // O(l) time, O(l) space — l = layers
      prev.map((l) => (l.id === id ? { ...l, opacity: value } : l)),
    );
  }, []);

  const toggleGroup = useCallback((group: LayerGroup) => {
    setLayers((prev) => {
      // O(l) time, O(l) space — l = layers
      const groupLayers = prev.filter((l) => l.group === group);
      // O(g) time, O(1) space — g = layers in the group
      const allVisible = groupLayers.every((l) => l.visible);
      // O(l) time, O(l) space — l = layers
      return prev.map((l) =>
        l.group === group ? { ...l, visible: !allVisible } : l,
      );
    });
  }, []);

  const getLayersByGroup = useCallback((): Record<LayerGroup, LayerState[]> => {
    const groups: Record<LayerGroup, LayerState[]> = {
      infrastructure: [],
      zoning: [],
      poi: [],
      historical: [],
      parks: [],
      government: [],
      safety: [],
    };
    // O(l) time, O(l) space — l = layers
    for (const layer of layers) {
      groups[layer.group].push(layer);
    }
    return groups;
  }, [layers]);

  const groupLabels = useMemo(() => LAYER_GROUP_LABELS, []);

  const applySnapshot = useCallback((raw: unknown) => {
    setLayers((prev) => applyLayerSnapshot(prev, raw));
  }, []);

  return {
    layers,
    toggleLayer,
    setOpacity,
    toggleGroup,
    getLayersByGroup,
    groupLabels,
    applySnapshot,
  };
}
