import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LayerGroup, LayerState } from '../../types/layer';
import { LAYER_GROUP_LABELS } from '../../types/layer';
import { IS_STATIC } from '../../utils/staticMode';
import { getCityProfile } from '../../cities/registry';

/**
 * Layer list for a city, from its CityProfile (src/cities/<slug>/). Unknown city → no
 * layers (fail closed — never another city's data). Exported for tests: Chicago's list
 * is pinned in createDefaultLayers.test.ts.
 * O(l) time, O(l) space — l = layers the city offers (~15).
 */
export function createDefaultLayers(citySlug: string): LayerState[] {
  return getCityProfile(citySlug)?.layers() ?? [];
}

/**
 * Tile source for a layer in the current mode: static → the city's PMTiles ('' = the
 * layer file's bundled GeoJSON, Chicago only); dev → Martin. Defaults to Chicago so any
 * caller that predates multi-city keeps Chicago's exact URLs.
 * O(1) time, O(1) space — k = fixed-size lookup table of layer ids.
 */
export function getLayerSourceUrl(layerId: string, citySlug: string = 'chicago'): string {
  const profile = getCityProfile(citySlug);
  if (!profile) return '';
  const table = IS_STATIC ? profile.staticAssets.layerPmtiles : profile.devSources();
  return table[layerId] ?? '';
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
