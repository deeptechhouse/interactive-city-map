/**
 * Saved searches hook: the preset list wired to the SearchStateStore, the map, and
 * STORAGE ON THE MAP SERVER. SavedSearchesPanel is pure UI on top of this.
 *
 * STORAGE (changed 2026-10-02 — presets "disappeared" because localStorage is per address
 * including the port: :5173 vs :8000, another device over Tailscale…):
 *   * the map server is the source of truth (presetRepository.ts → /api/v1/presets);
 *   * localStorage is a cache — the list shows instantly on load and still works if the
 *     server can't be reached; changes made then stay local until the next load;
 *   * on load, presets only this browser has are uploaded once (migration from the old
 *     localStorage-only presets, or ones saved while offline).
 *
 * FLOW
 *   load        → cache → server list (+ upload browser-only ones) → list + cache
 *   save(name)  → store.snapshot() (+ map center/zoom) → upsertPreset → server PUT
 *   apply(id)   → store.apply(preset.state) → filters re-render → flyTo the saved view
 *   remove(id)  → server DELETE
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { loadJson, saveJson } from '../utils/safeStorage';
import { useSearchStore } from './SearchStateContext';
import { createPresetRepository, localOnlyPresets, type PresetRepository } from './presetRepository';
import { findByName, makePresetId, parsePresets, removePreset, upsertPreset, type SavedSearch } from './savedSearches';

const STORAGE_KEY = 'citymap.savedSearches.v1';

export const OFFLINE_NOTE = 'Map server not reachable — presets are saved on this device only for now.';

export interface UseSavedSearchesReturn {
  /** Presets for the current city, in save order. */
  presets: SavedSearch[];
  save: (name: string, includeView: boolean) => void;
  apply: (id: string) => void;
  remove: (id: string) => void;
  /** '' normally; explains when presets aren't reaching the server. */
  storageNote: string;
}

const defaultRepository = createPresetRepository();

/** Saved-search state. O(p) time per change, O(p) space — p = presets. */
export function useSavedSearches(
  map: maplibregl.Map | null,
  city: string,
  repository: PresetRepository | null = defaultRepository,
): UseSavedSearchesReturn {
  const store = useSearchStore();
  const [all, setAll] = useState<SavedSearch[]>(() => parsePresets(loadJson(STORAGE_KEY)));
  const [storageNote, setStorageNote] = useState('');
  const allRef = useRef(all);
  allRef.current = all;

  useEffect(() => saveJson(STORAGE_KEY, all), [all]);

  // Load from the server once; upload anything only this browser has.
  useEffect(() => {
    if (!repository) return;
    let cancelled = false;
    void (async () => {
      const server = await repository.list();
      if (cancelled) return;
      if (server === null) {
        setStorageNote(OFFLINE_NOTE);
        return;
      }
      const toUpload = localOnlyPresets(allRef.current, parsePresets(server));
      // O(u) time, O(u) space — u = presets to upload (once, then never again).
      const uploaded = await Promise.all(toUpload.map((p) => repository.put(p)));
      if (cancelled) return;
      setAll([...parsePresets(server), ...toUpload]);
      // O(u) time, O(1) space — u = upload results.
      setStorageNote(uploaded.every(Boolean) ? '' : OFFLINE_NOTE);
    })();
    return () => {
      cancelled = true;
    };
  }, [repository]);

  /** Push one change to the server; note (don't fail) when it can't be reached. */
  const sync = useCallback(
    (op: Promise<boolean> | undefined) => {
      if (!op) return;
      void op.then((ok) => setStorageNote(ok ? '' : OFFLINE_NOTE));
    },
    [],
  );

  // O(p) time, O(p) space — p = presets across all cities.
  const presets = useMemo(() => all.filter((p) => p.city === city), [all, city]);

  const save = useCallback(
    (name: string, includeView: boolean) => {
      const center = map?.getCenter();
      const view =
        includeView && map && center ? { center: [center.lng, center.lat] as [number, number], zoom: map.getZoom() } : null;
      const next = upsertPreset(allRef.current, { name, city, state: store.snapshot(), view }, new Date(), makePresetId);
      setAll(next);
      // The preset just written (same name + city, overwritten or new).
      // O(p) time, O(1) space — p = presets.
      const saved = findByName(next, city, name);
      if (saved) sync(repository?.put(saved));
    },
    [map, store, city, repository, sync],
  );

  const apply = useCallback(
    (id: string) => {
      // O(p) time, O(1) space — p = presets.
      const preset = all.find((p) => p.id === id);
      if (!preset) return;
      store.apply(preset.state);
      if (preset.view && map) map.flyTo({ center: preset.view.center, zoom: preset.view.zoom, duration: 1000 });
    },
    [all, store, map],
  );

  const remove = useCallback(
    (id: string) => {
      setAll((prev) => removePreset(prev, id));
      sync(repository?.remove(id));
    },
    [repository, sync],
  );

  return { presets, save, apply, remove, storageNote };
}
