import { describe, expect, it, vi } from 'vitest';
import { SearchStateStore, setSection } from '../searchState';

const COLORS = setSection('colors', ['red', 'green', 'blue'], 'all');
const HIDDEN = setSection('hidden', ['a', 'b'], 'none');

describe('setSection', () => {
  it('starts with all or none of the known keys', () => {
    expect([...COLORS.initial()]).toEqual(['red', 'green', 'blue']);
    expect(HIDDEN.initial().size).toBe(0);
  });

  it('serialises sorted and drops unknown or non-string keys when parsing', () => {
    expect(COLORS.toJson(new Set(['red', 'blue']))).toEqual(['blue', 'red']);
    expect([...(COLORS.fromJson(['red', 'purple', 7]) ?? [])]).toEqual(['red']);
    expect(COLORS.fromJson('red')).toBeNull();
  });
});

describe('SearchStateStore', () => {
  it('get returns a stable reference until set', () => {
    const store = new SearchStateStore();
    const first = store.get(COLORS);
    expect(store.get(COLORS)).toBe(first);
    store.set(COLORS, new Set(['red']));
    expect(store.get(COLORS)).not.toBe(first);
  });

  it('set accepts an updater and notifies subscribers', () => {
    const store = new SearchStateStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(COLORS, (prev) => new Set([...prev].filter((c) => c !== 'green')));
    expect([...store.get(COLORS)]).toEqual(['red', 'blue']);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('round-trips owned and external sections through snapshot/apply', () => {
    const store = new SearchStateStore();
    let external = { zoom: 1 };
    store.attach('ext', { capture: () => external, apply: (raw) => { external = raw as typeof external; } });
    store.set(COLORS, new Set(['green']));
    const snap = store.snapshot();
    expect(snap).toEqual({ colors: ['green'], ext: { zoom: 1 } });

    store.set(COLORS, new Set(['red', 'blue']));
    external = { zoom: 9 };
    store.apply(snap);
    expect([...store.get(COLORS)]).toEqual(['green']);
    expect(external).toEqual({ zoom: 1 });
  });

  it('resets an owned section missing from the snapshot to its initial value', () => {
    const store = new SearchStateStore();
    store.set(HIDDEN, new Set(['a']));
    store.apply({});
    expect(store.get(HIDDEN).size).toBe(0);
  });

  it('falls back to initial when the saved value is malformed', () => {
    const store = new SearchStateStore();
    store.get(COLORS);
    store.apply({ colors: 'not-an-array' });
    expect(store.get(COLORS).size).toBe(3);
  });

  it('holds values for a section that has not mounted yet, then parses them on define', () => {
    // The zoning panel unmounts while its layer is off — a preset must still reach it.
    const store = new SearchStateStore();
    store.apply({ hidden: ['b'] });
    expect(store.snapshot()).toEqual({ hidden: ['b'] }); // re-saving keeps it
    expect([...store.get(HIDDEN)]).toEqual(['b']);
  });

  it('detaching an adapter removes it from snapshots', () => {
    const store = new SearchStateStore();
    const detach = store.attach('ext', { capture: () => 1, apply: () => {} });
    detach();
    expect(store.snapshot()).toEqual({});
  });
});
