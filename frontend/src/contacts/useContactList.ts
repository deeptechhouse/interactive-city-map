/**
 * React binding for ContactListStore + keeping the map's selected-building outline in sync.
 *
 * One store per city (a Chicago list shouldn't show Detroit buildings); switching city
 * swaps the store. The resolver is null for cities without public-record sources, and
 * the store then just records buildings for hand entry.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type maplibregl from 'maplibre-gl';
import { ContactListStore } from './ContactListStore';
import { ContactResolver } from './ContactResolver';
import { OwnerBatchRunner, type BatchState } from './OwnerBatchRunner';
import { createOwnerBatchApi } from './ownerLookup';
import { saveCsv, saveMessage } from './csvSave';
import { setSelectedBuildings } from './SelectedBuildingsLayer';
import type { SelectedBuilding } from './types';
import { getCityProfile } from '../cities/registry';

export interface UseContactListReturn {
  store: ContactListStore;
  buildings: readonly SelectedBuilding[];
  lookupAvailable: boolean;
  /** "Look up owners" batch (Tracerfy, paid) — the GUI's owner skip-trace path. */
  batchRunner: OwnerBatchRunner;
  batch: BatchState;
}

// O(n) time, O(n) space — n = buildings in the contact list (id list + map filter rebuilt when it changes)
export function useContactList(map: maplibregl.Map | null, citySlug: string): UseContactListReturn {
  const store = useMemo(() => new ContactListStore(ContactResolver.forCity(citySlug), citySlug), [citySlug]);
  const buildings = useSyncExternalStore(store.subscribe, store.getSnapshot);
  // One runner per store; it resumes a batch left running when the page was closed.
  const batchRunner = useMemo(() => new OwnerBatchRunner(store, createOwnerBatchApi(), citySlug), [store, citySlug]);
  useEffect(() => {
    // Lookup finished → save the whole list as CSV to the Desktop (asked for 2026-10-02).
    batchRunner.setOnComplete(async () => saveMessage(await saveCsv(store.getSnapshot(), undefined, undefined, undefined, store.city)));
    return () => {
      batchRunner.setOnComplete(null);
      batchRunner.dispose();
    };
  }, [batchRunner, store]);
  const batch = useSyncExternalStore(batchRunner.subscribe, batchRunner.getSnapshot);

  // O(n) time, O(n) space — n = buildings in the contact list
  const ids = useMemo(() => buildings.map((b) => b.id), [buildings]);
  useEffect(() => {
    if (!map) return;
    // O(n) time, O(n) space — n = selected ids written into the outline filter
    const apply = () => setSelectedBuildings(map, ids);
    apply();
    // The buildings source may not exist yet on first load — try again once the map settles.
    map.once('idle', apply);
    return () => {
      map.off('idle', apply);
    };
  }, [map, ids]);

  // A city offers lookups when its profile has contact sources (cities/<slug>/contacts.ts).
  const lookupAvailable = getCityProfile(citySlug)?.contacts != null;
  return { store, buildings, lookupAvailable, batchRunner, batch };
}
