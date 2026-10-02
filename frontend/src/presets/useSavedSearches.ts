/**
 * Saved searches hook: the preset list (persisted in localStorage) wired to the
 * SearchStateStore and the map. SavedSearchesPanel is pure UI on top of this.
 *
 * FLOW
 *   save(name)  → store.snapshot() (+ map center/zoom) → upsertPreset → localStorage
 *   apply(id)   → store.apply(preset.state) → every filter control re-renders → map filters
 *                 update in their own effects; then flyTo the saved view if there is one
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { loadJson, saveJson } from '../utils/safeStorage';
import { useSearchStore } from './SearchStateContext';
import {
  makePresetId,
  parsePresets,
  removePreset,
  upsertPreset,
  type SavedSearch,
} from './savedSearches';

const STORAGE_KEY = 'citymap.savedSearches.v1';

export interface UseSavedSearchesReturn {
  /** Presets for the current city, in save order. */
  presets: SavedSearch[];
  save: (name: string, includeView: boolean) => void;
  apply: (id: string) => void;
  remove: (id: string) => void;
}

export function useSavedSearches(map: maplibregl.Map | null, city: string): UseSavedSearchesReturn {
  const store = useSearchStore();
  const [all, setAll] = useState<SavedSearch[]>(() => parsePresets(loadJson(STORAGE_KEY)));

  useEffect(() => saveJson(STORAGE_KEY, all), [all]);

  // O(n) — n = presets across all cities.
  const presets = useMemo(() => all.filter((p) => p.city === city), [all, city]);

  const save = useCallback(
    (name: string, includeView: boolean) => {
      const center = map?.getCenter();
      const view = includeView && map && center
        ? { center: [center.lng, center.lat] as [number, number], zoom: map.getZoom() }
        : null;
      const state = store.snapshot();
      setAll((prev) => upsertPreset(prev, { name, city, state, view }, new Date(), makePresetId));
    },
    [map, store, city],
  );

  const apply = useCallback(
    (id: string) => {
      const preset = all.find((p) => p.id === id); // O(n)
      if (!preset) return;
      store.apply(preset.state);
      if (preset.view && map) map.flyTo({ center: preset.view.center, zoom: preset.view.zoom, duration: 1000 });
    },
    [all, store, map],
  );

  const remove = useCallback((id: string) => setAll((prev) => removePreset(prev, id)), []);

  return { presets, save, apply, remove };
}
