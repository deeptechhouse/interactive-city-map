/**
 * React bindings for SearchStateStore (searchState.ts).
 *
 *   useSearchSection(def)                 — useState replacement for a filter control
 *   useSearchAdapter(key, value, apply)   — expose a hook's existing state to presets
 *   useSearchStore()                      — the store itself (snapshot/apply for presets)
 *
 * The context defaults to one app-wide store, so no Provider is needed in main.tsx.
 * Tests (or a second map on one page) can wrap a subtree in <SearchStateContext.Provider>.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useSyncExternalStore } from 'react';
import { SearchStateStore, type SectionDef, type Updater } from './searchState';

export const SearchStateContext = createContext<SearchStateStore>(new SearchStateStore());

export function useSearchStore(): SearchStateStore {
  return useContext(SearchStateContext);
}

/**
 * Like useState, but the value lives in the store: it survives the control unmounting and
 * is saved/restored by presets. `def` must be a module-level constant. O(1) per render.
 */
export function useSearchSection<T>(def: SectionDef<T>): [T, (next: Updater<T>) => void] {
  const store = useSearchStore();
  const value = useSyncExternalStore(
    useCallback((cb) => store.subscribe(cb), [store]),
    () => store.get(def),
  );
  const set = useCallback((next: Updater<T>) => store.set(def, next), [store, def]);
  return [value, set];
}

/**
 * Register state owned by another hook (layers, focus areas) as a preset section.
 * `value` must be JSON-serialisable; `apply` receives UNTRUSTED json and must validate it.
 * The adapter reads through a ref, so it always captures the latest render's value.
 */
export function useSearchAdapter(key: string, value: unknown, apply: (raw: unknown) => void): void {
  const store = useSearchStore();
  const latest = useRef({ value, apply });
  useEffect(() => {
    latest.current = { value, apply };
  });
  useEffect(
    () =>
      store.attach(key, {
        capture: () => latest.current.value,
        apply: (raw) => latest.current.apply(raw),
      }),
    [store, key],
  );
}
