/**
 * State for the "Business types" discovery panel.
 *
 * FLOW (all FREE until the last step)
 *   area     = Focus-area selection if any, else the map view at the last refresh
 *   refresh  → directory.activityCounts(area)            → the type list with counts
 *   tick types → (debounced) directory.candidates(area, types) → magenta markers
 *   click a marker → removed (kept removed across re-queries until "Restore")
 *   lookUp() → PAID: adds the remaining buildings to the contact list (county + licence
 *              lookups free; business phones via Google/Foursquare), waits for those to
 *              finish, then runs the owner batch for exactly these buildings.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { ChicagoBusinessDirectory, type BusinessDirectory } from './businessDirectory';
import { setCandidates } from './CandidatesLayer';
import type { ActivityCount, Bounds, Candidate, SearchArea } from './discoveryQuery';
import { isEmptySelection, type FocusSelection } from '../focus/focusGeometry';
import type { ContactListStore } from '../contacts/ContactListStore';
import type { OwnerBatchRunner } from '../contacts/OwnerBatchRunner';
import type { BuildingPick } from '../contacts/types';

// ADJUSTABLE: pause after the last tick before re-querying the map markers.
const QUERY_DEBOUNCE_MS = 400;
// ADJUSTABLE: give up waiting for contact-list lookups before starting the owner batch.
const RESOLVE_TIMEOUT_MS = 5 * 60_000;

export type LookupPhase = 'idle' | 'adding' | 'looking-up' | 'done' | 'error';

export interface UseDiscoveryReturn {
  areaLabel: string;
  types: ActivityCount[];
  typesLoading: boolean;
  selected: ReadonlySet<string>;
  toggleType: (activity: string) => void;
  clearTypes: () => void;
  refresh: () => void;
  visible: Candidate[];
  removedCount: number;
  restoreRemoved: () => void;
  removeCandidate: (key: string) => void;
  candidatesLoading: boolean;
  error: string;
  lookUp: () => Promise<void>;
  lookupPhase: LookupPhase;
  lookupMessage: string;
}

/** "3 zip codes, 1 ward" for the panel. O(1) time, O(1) space — n = 3 kinds. */
export function describeArea(sel: FocusSelection): string {
  const parts: [number, string][] = [
    [sel.zip.length, 'zip code'],
    [sel.police.length, 'police district'],
    [sel.ward.length, 'ward'],
  ];
  // O(1) time, O(1) space — n = 3 kinds.
  const text = parts
    .filter(([n]) => n > 0)
    .map(([n, w]) => `${n} ${w}${n === 1 ? '' : 's'}`)
    .join(', ');
  return sel.mode === 'intersection' ? `overlap of ${text}` : text;
}

/** Map bounds as [w, s, e, n]. O(1) time, O(1) space — n = 4 numbers. */
function viewBounds(map: maplibregl.Map): Bounds {
  const b = map.getBounds();
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
}

/**
 * The building id to file a candidate under: the footprint under its marker when that
 * tile is loaded (so the contact list's amber outline works), else a stable synthetic id.
 * O(f) time, O(f) space — f = features under the point (a handful).
 */
export function pickFor(map: maplibregl.Map | null, c: Candidate): BuildingPick {
  let id = `biz:${c.key}`;
  try {
    const hit = map?.queryRenderedFeatures(map.project(c.lngLat), {
      layers: ['buildings-fill'],
    })[0];
    if (hit?.properties?.id) id = String(hit.properties.id);
  } catch {
    /* buildings layer not on the map (hidden / other city) — synthetic id is fine */
  }
  return { id, address: c.address, lngLat: c.lngLat };
}

/**
 * Resolve once every listed building has finished its (free + phone) lookups.
 * O(n) time per store change, O(n) space — n = ids.
 */
export function waitForResolved(store: ContactListStore, ids: readonly string[], timeoutMs: number): Promise<void> {
  const wanted = new Set(ids);
  // O(b) time, O(1) space — b = buildings in the list.
  const done = () => !store.getSnapshot().some((b) => wanted.has(b.id) && b.status === 'loading');
  return new Promise((resolve) => {
    if (done()) return resolve();
    const timer = setTimeout(finish, timeoutMs);
    const unsubscribe = store.subscribe(() => done() && finish());
    // O(1) time, O(1) space — n = 1 listener removed.
    function finish() {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    }
  });
}

/** Discovery state hook. O(c) time per render, O(c) space — c = candidates. */
export function useDiscovery(
  map: maplibregl.Map | null,
  focusSelection: FocusSelection,
  store: ContactListStore,
  runner: OwnerBatchRunner,
  directory: BusinessDirectory = defaultDirectory,
): UseDiscoveryReturn {
  const [viewArea, setViewArea] = useState<Bounds | null>(null);
  const [types, setTypes] = useState<ActivityCount[]>([]);
  const [typesLoading, setTypesLoading] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [candidates, setCandidatesState] = useState<Candidate[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState('');
  const [lookupPhase, setLookupPhase] = useState<LookupPhase>('idle');
  const [lookupMessage, setLookupMessage] = useState('');

  const useFocus = !isEmptySelection(focusSelection);
  // Keyed on the selection's CONTENT, not its identity: a caller passing an equal-but-new
  // object each render would otherwise refetch → re-render → refetch forever (found in a
  // test that did exactly that, 2026-10-02). O(k) time, O(k) space — k = selected ids.
  const selectionKey = JSON.stringify(focusSelection);
  const area: SearchArea | null = useMemo(
    () =>
      useFocus
        ? { kind: 'focus', selection: JSON.parse(selectionKey) as FocusSelection }
        : viewArea
          ? { kind: 'view', bounds: viewArea }
          : null,
    [useFocus, selectionKey, viewArea],
  );
  const areaLabel = useFocus ? describeArea(focusSelection) : viewArea ? 'the map view (at last refresh)' : '';

  // Type list: reload whenever the area changes. Free.
  const typesSeq = useRef(0);
  useEffect(() => {
    if (!area) return;
    const seq = ++typesSeq.current; // ignore answers that arrive after a newer request
    setTypesLoading(true);
    setError('');
    directory
      .activityCounts(area)
      .then((t) => seq === typesSeq.current && setTypes(t))
      .catch(() => seq === typesSeq.current && setError('Couldn’t load business types (City of Chicago data portal).'))
      .finally(() => seq === typesSeq.current && setTypesLoading(false));
  }, [area, directory]);

  // Markers: re-query (debounced) when the ticked types or area change. Free.
  const bizSeq = useRef(0);
  useEffect(() => {
    if (!area || selected.size === 0) {
      setCandidatesState([]);
      return;
    }
    const seq = ++bizSeq.current;
    const handle = setTimeout(() => {
      setCandidatesLoading(true);
      directory
        .candidates(area, [...selected])
        .then((c) => seq === bizSeq.current && setCandidatesState(c))
        .catch(() => seq === bizSeq.current && setError('Couldn’t load businesses (City of Chicago data portal).'))
        .finally(() => seq === bizSeq.current && setCandidatesLoading(false));
    }, QUERY_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [area, selected, directory]);

  // O(c) time, O(c) space — c = candidates.
  const visible = useMemo(() => candidates.filter((c) => !removed.has(c.key)), [candidates, removed]);

  useEffect(() => {
    if (map) setCandidates(map, visible);
  }, [map, visible]);

  const refresh = useCallback(() => {
    if (map) setViewArea(viewBounds(map));
  }, [map]);

  // First load with no focus selection: use the view once the map is ready.
  useEffect(() => {
    if (map && !viewArea) setViewArea(viewBounds(map));
  }, [map, viewArea]);

  const toggleType = useCallback((activity: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(activity)) next.delete(activity);
      else next.add(activity);
      return next;
    });
  }, []);

  const removeCandidate = useCallback((key: string) => {
    setRemoved((prev) => new Set(prev).add(key));
  }, []);

  const lookUp = useCallback(async () => {
    if (visible.length === 0) return;
    setLookupPhase('adding');
    setLookupMessage('');
    try {
      // O(v) time, O(v) space — v = visible candidates.
      const picks = visible.map((c) => pickFor(map, c));
      // store.add skips buildings already listed.
      // O(v) time, O(1) space — v = picks.
      for (const p of picks) store.add(p);
      setLookupMessage(`Added ${picks.length} buildings — looking up owners and business phones…`);
      // O(v) time, O(v) space — v = picks.
      const ids = picks.map((p) => p.id);
      await waitForResolved(store, ids, RESOLVE_TIMEOUT_MS);
      setLookupPhase('looking-up');
      await runner.startFor(ids);
      setLookupPhase('done');
      setLookupMessage(`Sent ${picks.length} buildings for owner lookup — follow progress in the Contact list below.`);
      setSelected(new Set());
      setRemoved(new Set());
    } catch {
      setLookupPhase('error');
      setLookupMessage('Something went wrong adding these buildings — check the Contact list.');
    }
  }, [visible, map, store, runner]);

  return {
    areaLabel,
    types,
    typesLoading,
    selected,
    toggleType,
    clearTypes: useCallback(() => setSelected(new Set()), []),
    refresh,
    visible,
    removedCount: candidates.length - visible.length,
    restoreRemoved: useCallback(() => setRemoved(new Set()), []),
    removeCandidate,
    candidatesLoading,
    error,
    lookUp,
    lookupPhase,
    lookupMessage,
  };
}

const defaultDirectory: BusinessDirectory = new ChicagoBusinessDirectory();
