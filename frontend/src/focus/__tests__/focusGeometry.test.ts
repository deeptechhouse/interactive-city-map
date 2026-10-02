import { describe, expect, it } from 'vitest';
import { booleanPointInPolygon, point } from '@turf/turf';
import {
  EMPTY_SELECTION,
  buildFocusShape,
  buildMask,
  coerceMode,
  indexBoundaries,
  isEmptySelection,
  type AreaFeature,
  type BoundaryIndex,
  type FocusSelection,
} from '../focusGeometry';
import { parseSavedSelection } from '../useFocusArea';
import { AREA_OPTIONS, CHICAGO_BOUNDARIES } from '../focusAreas';

/** Axis-aligned square [x0,y0]–[x1,y1] as a feature with an id property. */
function square(x0: number, y0: number, x1: number, y1: number, props: Record<string, unknown>) {
  return {
    type: 'Feature' as const,
    properties: props,
    geometry: {
      type: 'Polygon' as const,
      coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
    },
  };
}

// zip A: 0..2, zip B: 4..6 (disjoint); ward 1: 1..5 (overlaps both); ward 2 far away.
const boundaries: BoundaryIndex = {
  zip: indexBoundaries(
    { type: 'FeatureCollection', features: [square(0, 0, 2, 2, { z: 'A' }), square(4, 0, 6, 2, { z: 'B' })] },
    'z',
  ),
  police: new Map(),
  ward: indexBoundaries(
    { type: 'FeatureCollection', features: [square(1, 0, 5, 2, { w: 1 }), square(20, 20, 21, 21, { w: 2 })] },
    'w',
  ),
};

const sel = (patch: Partial<FocusSelection>): FocusSelection => ({ ...EMPTY_SELECTION, ...patch });
const inside = (shape: AreaFeature | null, x: number, y: number) =>
  !!shape && booleanPointInPolygon(point([x, y]), shape);

describe('indexBoundaries', () => {
  it('groups features by id, skipping non-polygons and missing ids', () => {
    const idx = indexBoundaries(
      {
        type: 'FeatureCollection',
        features: [
          square(0, 0, 1, 1, { id: 7 }),
          square(2, 2, 3, 3, { id: 7 }),
          square(0, 0, 1, 1, {}),
          { type: 'Feature', properties: { id: 8 }, geometry: { type: 'Point', coordinates: [0, 0] } },
        ],
      },
      'id',
    );
    expect([...idx.keys()]).toEqual(['7']);
    expect(idx.get('7')).toHaveLength(2);
  });
});

describe('buildFocusShape', () => {
  it('returns null when nothing is selected', () => {
    expect(isEmptySelection(EMPTY_SELECTION)).toBe(true);
    expect(buildFocusShape(EMPTY_SELECTION, boundaries)).toBeNull();
  });

  it('unions areas of one kind', () => {
    const shape = buildFocusShape(sel({ zip: ['A', 'B'] }), boundaries);
    expect(inside(shape, 1, 1)).toBe(true);
    expect(inside(shape, 5, 1)).toBe(true);
    expect(inside(shape, 3, 1)).toBe(false);
  });

  it('union mode across kinds covers everything selected', () => {
    const shape = buildFocusShape(sel({ zip: ['A'], ward: ['1'] }), boundaries);
    expect(inside(shape, 0.5, 1)).toBe(true); // zip only
    expect(inside(shape, 4.5, 1)).toBe(true); // ward only
  });

  it('intersection mode keeps only the overlap', () => {
    const shape = buildFocusShape(sel({ zip: ['A'], ward: ['1'], mode: 'intersection' }), boundaries);
    expect(inside(shape, 1.5, 1)).toBe(true);
    expect(inside(shape, 0.5, 1)).toBe(false);
    expect(inside(shape, 4.5, 1)).toBe(false);
  });

  it('intersection of disjoint areas is null', () => {
    expect(buildFocusShape(sel({ zip: ['A'], ward: ['2'], mode: 'intersection' }), boundaries)).toBeNull();
  });

  it('ignores unknown ids from stale saved state', () => {
    expect(buildFocusShape(sel({ zip: ['nope'] }), boundaries)).toBeNull();
  });
});

describe('buildMask', () => {
  it('cuts the focus shape out of the world', () => {
    const shape = buildFocusShape(sel({ zip: ['A'] }), boundaries);
    const mask = buildMask(shape);
    expect(inside(mask, 1, 1)).toBe(false);
    expect(inside(mask, 10, 10)).toBe(true);
  });

  it('masks the whole world when the shape is empty', () => {
    expect(inside(buildMask(null), 1, 1)).toBe(true);
  });
});

describe('saved selection parsing', () => {
  it('accepts a valid selection', () => {
    expect(parseSavedSelection({ zip: ['60614'], police: [], ward: ['43'], mode: 'intersection' })).toEqual({
      zip: ['60614'], police: [], ward: ['43'], mode: 'intersection',
    });
  });

  it('drops malformed values', () => {
    expect(parseSavedSelection({ zip: [1, '60614'], police: 'x', mode: 'evil' })).toEqual({
      zip: ['60614'], police: [], ward: [], mode: 'union',
    });
    expect(parseSavedSelection(null)).toBe(EMPTY_SELECTION);
    expect(coerceMode('intersection')).toBe('intersection');
  });
});

describe('Chicago boundary data', () => {
  it('has every zip, district and ward with options sorted numerically', () => {
    expect(CHICAGO_BOUNDARIES.ward.size).toBe(50);
    expect(CHICAGO_BOUNDARIES.police.size).toBeGreaterThanOrEqual(22);
    expect(CHICAGO_BOUNDARIES.zip.size).toBeGreaterThan(50);
    expect(AREA_OPTIONS.ward.slice(0, 3).map((o) => o.id)).toEqual(['1', '2', '3']);
    expect(AREA_OPTIONS.police[0].label).toMatch(/^District 1 — /);
  });

  it('builds a real ward ∩ zip shape', () => {
    const shape = buildFocusShape(
      { zip: ['60614'], police: [], ward: ['43'], mode: 'intersection' },
      CHICAGO_BOUNDARIES,
    );
    expect(shape).not.toBeNull();
  });
});
