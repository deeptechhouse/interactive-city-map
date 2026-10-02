import { describe, expect, it } from 'vitest';
import {
  MAX_NAME_LENGTH,
  MAX_PRESETS,
  findByName,
  normaliseName,
  parsePresets,
  removePreset,
  upsertPreset,
  type SavedSearch,
} from '../savedSearches';

const NOW = new Date('2026-10-02T12:00:00Z');
let n = 0;
const makeId = () => `id${++n}`;

function preset(over: Partial<SavedSearch> = {}): SavedSearch {
  return { id: 'p1', name: 'Vacant lots', city: 'chicago', savedAt: '', state: {}, view: null, ...over };
}

describe('normaliseName', () => {
  it('trims, collapses whitespace and caps length', () => {
    expect(normaliseName('  Vacant   lots ')).toBe('Vacant lots');
    expect(normaliseName('x'.repeat(200))).toHaveLength(MAX_NAME_LENGTH);
    expect(normaliseName('   ')).toBe('');
  });
});

describe('upsertPreset', () => {
  it('appends a new preset with an id and timestamp', () => {
    const list = upsertPreset([], { name: 'Churches', city: 'chicago', state: { a: 1 }, view: null }, NOW, makeId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Churches', savedAt: NOW.toISOString(), state: { a: 1 } });
    expect(list[0].id).toBeTruthy();
  });

  it('overwrites a same-named preset in the same city, keeping its id', () => {
    const list = upsertPreset([preset()], { name: 'vacant LOTS', city: 'chicago', state: { b: 2 }, view: null }, NOW, makeId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'p1', name: 'vacant LOTS', state: { b: 2 } });
  });

  it('treats the same name in another city as a different preset', () => {
    const list = upsertPreset([preset()], { name: 'Vacant lots', city: 'detroit', state: {}, view: null }, NOW, makeId);
    expect(list).toHaveLength(2);
  });

  it('ignores blank names', () => {
    expect(upsertPreset([], { name: '  ', city: 'chicago', state: {}, view: null }, NOW, makeId)).toEqual([]);
  });

  it('drops the oldest past MAX_PRESETS', () => {
    const many = Array.from({ length: MAX_PRESETS }, (_, i) => preset({ id: `old${i}`, name: `p${i}` }));
    const list = upsertPreset(many, { name: 'newest', city: 'chicago', state: {}, view: null }, NOW, makeId);
    expect(list).toHaveLength(MAX_PRESETS);
    expect(list[0].id).toBe('old1');
    expect(list.at(-1)?.name).toBe('newest');
  });
});

describe('findByName / removePreset', () => {
  it('finds case-insensitively within a city and removes by id', () => {
    const list = [preset(), preset({ id: 'p2', name: 'Other' })];
    expect(findByName(list, 'chicago', ' vacant lots ')?.id).toBe('p1');
    expect(findByName(list, 'detroit', 'Vacant lots')).toBeUndefined();
    expect(removePreset(list, 'p1').map((p) => p.id)).toEqual(['p2']);
  });
});

describe('parsePresets', () => {
  it('returns [] for non-arrays', () => {
    expect(parsePresets(null)).toEqual([]);
    expect(parsePresets({})).toEqual([]);
  });

  it('keeps valid entries and drops malformed ones individually', () => {
    const raw = [
      preset({ view: { center: [-87.6, 41.8], zoom: 12 } }),
      { id: 'bad', name: 'no city', state: {} },
      { id: 'bad2', name: '', city: 'chicago', state: {} },
      { id: 'bad3', name: 'array state', city: 'chicago', state: [] },
      'junk',
      preset({ id: 'p2', name: 'Bad view', view: { center: ['x', 1], zoom: 3 } }),
    ];
    const out = parsePresets(raw);
    expect(out.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(out[0].view).toEqual({ center: [-87.6, 41.8], zoom: 12 });
    expect(out[1].view).toBeNull();
  });
});
