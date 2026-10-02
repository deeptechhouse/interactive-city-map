/**
 * React state for the focus area: what's selected, the computed shape, and keeping the
 * map mask in sync. The panel (FocusAreaPanel) is pure UI on top of this hook.
 *
 * FLOW
 *   panel click → toggle()/setMode()/clear() → selection state (+ localStorage)
 *     → useMemo: buildFocusShape → buildMask       (focusGeometry.ts, pure)
 *     → useEffect: setFocusMask(map, mask, shape)  (FocusMaskLayer.ts)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { bbox } from '@turf/turf';
import {
  EMPTY_SELECTION,
  buildFocusShape,
  buildMask,
  coerceMode,
  isEmptySelection,
  type AreaFeature,
  type FocusKind,
  type FocusMode,
  type FocusSelection,
} from './focusGeometry';
import { CHICAGO_BOUNDARIES } from './focusAreas';
import { setFocusMask } from './FocusMaskLayer';
import { loadJson, saveJson } from '../utils/safeStorage';

const STORAGE_KEY = 'citymap.focusSelection.v1';

/** Validate untrusted saved state; anything malformed becomes the empty selection. O(n). */
export function parseSavedSelection(raw: unknown): FocusSelection {
  if (!raw || typeof raw !== 'object') return EMPTY_SELECTION;
  const obj = raw as Record<string, unknown>;
  const ids = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  return { zip: ids(obj.zip), police: ids(obj.police), ward: ids(obj.ward), mode: coerceMode(obj.mode) };
}

export interface UseFocusAreaReturn {
  selection: FocusSelection;
  shape: AreaFeature | null;
  /** True when areas are selected but they don't overlap (intersection mode). */
  isEmptyResult: boolean;
  toggle: (kind: FocusKind, id: string) => void;
  setKindIds: (kind: FocusKind, ids: readonly string[]) => void;
  setMode: (mode: FocusMode) => void;
  /** Replace the whole selection (saved-search presets). Input is validated. */
  replace: (raw: unknown) => void;
  clear: () => void;
  zoomToFocus: () => void;
}

export function useFocusArea(map: maplibregl.Map | null, enabled: boolean): UseFocusAreaReturn {
  const [selection, setSelection] = useState<FocusSelection>(() =>
    parseSavedSelection(loadJson(STORAGE_KEY)),
  );

  useEffect(() => saveJson(STORAGE_KEY, selection), [selection]);

  // Geometry is the expensive part (polygon clipping) — only recompute on selection change.
  const shape = useMemo(
    () => (isEmptySelection(selection) ? null : buildFocusShape(selection, CHICAGO_BOUNDARIES)),
    [selection],
  );
  const active = enabled && !isEmptySelection(selection);
  const mask = useMemo(() => (active ? buildMask(shape) : null), [active, shape]);

  useEffect(() => {
    if (!map) return;
    setFocusMask(map, mask, active ? shape : null);
  }, [map, mask, shape, active]);

  // O(s) — s = ids selected for that kind.
  const toggle = useCallback((kind: FocusKind, id: string) => {
    setSelection((prev) => {
      const ids = prev[kind].includes(id) ? prev[kind].filter((x) => x !== id) : [...prev[kind], id];
      return { ...prev, [kind]: ids };
    });
  }, []);

  const setKindIds = useCallback((kind: FocusKind, ids: readonly string[]) => {
    setSelection((prev) => ({ ...prev, [kind]: [...ids] }));
  }, []);

  const setMode = useCallback((mode: FocusMode) => {
    setSelection((prev) => ({ ...prev, mode }));
  }, []);

  const replace = useCallback((raw: unknown) => setSelection(parseSavedSelection(raw)), []);

  const clear = useCallback(() => setSelection(EMPTY_SELECTION), []);

  const zoomToFocus = useCallback(() => {
    if (!map || !shape) return;
    const [minX, minY, maxX, maxY] = bbox(shape); // O(v)
    map.fitBounds([[minX, minY], [maxX, maxY]], { padding: 40, duration: 800 });
  }, [map, shape]);

  return {
    selection,
    shape,
    isEmptyResult: active && shape === null,
    toggle,
    setKindIds,
    setMode,
    replace,
    clear,
    zoomToFocus,
  };
}

