/**
 * SearchStateStore — the one place a "search" (every filter the user has set) can be
 * captured as JSON and restored. Saved searches / presets are built on top of this.
 *
 * PURPOSE
 *   Filter state used to live in each control's own useState. That made a preset
 *   impossible: ZoningFilter and RailroadFilter UNMOUNT while their layer is hidden, so
 *   there was nothing to read from or write to. This store keeps the state alive outside
 *   the components, so a preset can set zoning types even while the zoning panel is closed.
 *
 *   It does NOT know about localStorage, presets, or the map. Pure state + subscriptions —
 *   framework-agnostic and unit-testable (see __tests__/searchState.test.ts).
 *
 * ARCHITECTURE — two kinds of section, one snapshot
 *   - Owned sections (SectionDef): the store holds the value. Controls read/write it via
 *     useSearchSection() as a drop-in replacement for useState. Used by the filter panels.
 *   - External sections (ExternalSection): state that already lives in a hook elsewhere
 *     (useMapLayers, useFocusArea). The hook attaches capture()/apply() adapters.
 *   snapshot() → { [key]: json }  and  apply(snapshot) are the whole public contract.
 *
 * FLOW
 *   control renders → get(def) (lazily define()s it) → value
 *   user clicks     → set(def, next) → notify → React re-renders via useSyncExternalStore
 *   save preset     → snapshot()
 *   apply preset    → apply(snap) → owned: def.fromJson() ; external: adapter.apply() → notify
 *
 * TO ADD A NEW FILTER TO PRESETS: define a module-level SectionDef (setSection() covers
 * checkbox lists) with a UNIQUE key and swap the control's useState for useSearchSection.
 * Nothing in the preset code needs editing.
 */

/** JSON-serialisable state of every section, keyed by section key. */
export type SearchSnapshot = Record<string, unknown>;

/** A section whose value the store owns. Define once at module level — identity matters. */
export interface SectionDef<T> {
  /** Unique across ALL sections (owned and external). Stored in saved presets: never rename. */
  key: string;
  initial: () => T;
  toJson: (value: T) => unknown;
  /** Parse UNTRUSTED json (old app version, hand-edited storage). null → use initial(). */
  fromJson: (raw: unknown) => T | null;
}

/** Adapter for state owned elsewhere (a hook) that should still be saved in presets. */
export interface ExternalSection {
  capture: () => unknown;
  apply: (raw: unknown) => void;
}

export type Updater<T> = T | ((prev: T) => T);

export class SearchStateStore {
  readonly #defs = new Map<string, SectionDef<unknown>>();
  readonly #values = new Map<string, unknown>();
  /** Raw json from an applied preset for a section that has not mounted yet. */
  readonly #pending = new Map<string, unknown>();
  readonly #externals = new Map<string, ExternalSection>();
  readonly #listeners = new Set<() => void>();

  /**
   * Register an owned section (idempotent). If a preset was applied before this section's
   * control ever mounted, its pending json is parsed now. O(1) + fromJson cost.
   */
  define<T>(def: SectionDef<T>): void {
    if (this.#defs.has(def.key)) return;
    this.#defs.set(def.key, def as SectionDef<unknown>);
    const raw = this.#pending.get(def.key);
    this.#pending.delete(def.key);
    this.#values.set(def.key, (raw === undefined ? null : def.fromJson(raw)) ?? def.initial());
  }

  /** Current value; stable reference until set() — required by useSyncExternalStore. O(1). */
  get<T>(def: SectionDef<T>): T {
    this.define(def);
    return this.#values.get(def.key) as T;
  }

  /** Replace a value (accepts an updater like setState). O(1) + listeners. */
  set<T>(def: SectionDef<T>, next: Updater<T>): void {
    const prev = this.get(def);
    const value = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
    if (Object.is(value, prev)) return;
    this.#values.set(def.key, value);
    this.#notify();
  }

  /** Attach an external adapter; returns the detach function (use as an effect cleanup). O(1) time, O(1) space. */
  attach(key: string, section: ExternalSection): () => void {
    this.#externals.set(key, section);
    return () => {
      if (this.#externals.get(key) === section) this.#externals.delete(key);
    };
  }

  /**
   * Capture everything. Sections that were applied but never mounted are passed through
   * as-is, so re-saving a preset doesn't silently drop them.
   * O(k) time, O(k) space — k = sections (plus each section's toJson)
   */
  snapshot(): SearchSnapshot {
    const out: SearchSnapshot = {};
    for (const [key, raw] of this.#pending) out[key] = raw;
    for (const [key, def] of this.#defs) out[key] = def.toJson(this.#values.get(key));
    for (const [key, ext] of this.#externals) out[key] = ext.capture();
    return out;
  }

  /**
   * Restore a snapshot. An owned section MISSING from the snapshot resets to its initial
   * value — a preset saved before that filter existed means "that filter untouched".
   * External sections missing from the snapshot are left alone (we can't know their default).
   * O(k) time, O(k) space — k = sections (plus each section's fromJson)
   */
  apply(snap: SearchSnapshot): void {
    this.#pending.clear();
    for (const [key, def] of this.#defs) {
      const raw = snap[key];
      this.#values.set(key, (raw === undefined ? null : def.fromJson(raw)) ?? def.initial());
    }
    for (const [key, raw] of Object.entries(snap)) {
      const ext = this.#externals.get(key);
      if (ext) ext.apply(raw);
      else if (!this.#defs.has(key)) this.#pending.set(key, raw);
    }
    this.#notify();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  // O(l) — l = subscribed controls.
  #notify(): void {
    for (const l of this.#listeners) l();
  }
}

/**
 * SectionDef for a checkbox list stored as a Set of keys. Unknown keys in saved json are
 * dropped (a category removed in a later version must not break the filter expression).
 * Saved as a sorted array so identical selections produce identical json.
 * O(n log n) time, O(n) space — n = keys.
 */
export function setSection(
  key: string,
  knownKeys: readonly string[],
  initial: 'all' | 'none',
): SectionDef<ReadonlySet<string>> {
  const known = new Set(knownKeys);
  return {
    key,
    initial: () => new Set(initial === 'all' ? knownKeys : []),
    toJson: (value) => [...value].sort(),
    fromJson: (raw) =>
      Array.isArray(raw)
        ? new Set(raw.filter((x): x is string => typeof x === 'string' && known.has(x)))
        : null,
  };
}
