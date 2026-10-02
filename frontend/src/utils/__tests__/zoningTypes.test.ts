import { describe, expect, it } from 'vitest';
import { featureFilter } from '@maplibre/maplibre-gl-style-spec';
import {
  OTHER_SUFFIX,
  ZONE_CLASSES,
  allTypeKeys,
  buildZoningFilter,
  typeKeysOfClass,
} from '../zoningTypes';
import { ZONING_COLORS } from '../colorSchemes';

/** Evaluate a filter expression against a zoning feature, like MapLibre would. */
function matches(filter: unknown[] | null, zone_class: string, zone_code: string): boolean {
  if (filter === null) return true;
  const f = featureFilter(filter as never);
  return f.filter({ zoom: 14 } as never, { type: 3, properties: { zone_class, zone_code } } as never);
}

const without = (...keys: string[]) => new Set(allTypeKeys().filter((k) => !keys.includes(k)));
const only = (...keys: string[]) => new Set(keys);

describe('zoning catalogue', () => {
  it('has unique type keys and a colour for every class', () => {
    const keys = allTypeKeys();
    expect(new Set(keys).size).toBe(keys.length);
    for (const cls of ZONE_CLASSES) {
      if (cls.key !== 'other') expect(ZONING_COLORS[cls.key]).toBe(cls.color);
      expect(typeKeysOfClass(cls)).toContain(`${cls.key}${OTHER_SUFFIX}`);
    }
  });
});

describe('buildZoningFilter', () => {
  it('everything ticked → no filter', () => {
    expect(buildZoningFilter(new Set(allTypeKeys()))).toBeNull();
  });

  it('nothing ticked → matches nothing', () => {
    const f = buildZoningFilter(new Set());
    expect(matches(f, 'residential', 'RS-3')).toBe(false);
  });

  it('residential types match exactly (RT-4 does not include RT-4A)', () => {
    const f = buildZoningFilter(only('RT-4'));
    expect(matches(f, 'residential', 'RT-4')).toBe(true);
    expect(matches(f, 'residential', 'RT-4A')).toBe(false);
  });

  it('district families match every bulk suffix but not neighbours', () => {
    const f = buildZoningFilter(only('B1'));
    expect(matches(f, 'commercial', 'B1-1')).toBe(true);
    expect(matches(f, 'commercial', 'B1-1.5')).toBe(true);
    expect(matches(f, 'commercial', 'B2-1')).toBe(false);
  });

  it('numbered planned developments group under PD; PMD is separate', () => {
    const f = buildZoningFilter(only('PD'));
    expect(matches(f, 'special', 'PD 1047')).toBe(true);
    expect(matches(f, 'special', 'PD')).toBe(true);
    expect(matches(f, 'manufacturing', 'PMD 4')).toBe(false);
    expect(matches(buildZoningFilter(only('PMD')), 'manufacturing', 'PMD 4')).toBe(true);
  });

  it('"Other" catches codes not in the list, only within its class', () => {
    const f = buildZoningFilter(only(`commercial${OTHER_SUFFIX}`));
    expect(matches(f, 'commercial', 'B9-9')).toBe(true);
    expect(matches(f, 'commercial', 'B1-1')).toBe(false);
    expect(matches(f, 'residential', 'R9')).toBe(false);
  });

  it('unticking one type hides only that type', () => {
    const f = buildZoningFilter(without('M3'));
    expect(matches(f, 'manufacturing', 'M3-3')).toBe(false);
    expect(matches(f, 'manufacturing', 'M2-3')).toBe(true);
    expect(matches(f, 'other', 'XYZ')).toBe(true);
  });

  it('unclassified codes can be hidden', () => {
    expect(matches(buildZoningFilter(without(`other${OTHER_SUFFIX}`)), 'other', 'XYZ')).toBe(false);
  });
});
