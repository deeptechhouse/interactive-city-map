import { describe, expect, it } from 'vitest';
import { featureFilter } from '@maplibre/maplibre-gl-style-spec';
import { buildingBaseFilter } from '../BuildingLayer';

/** Does a sublayer draw this building? Evaluated with MapLibre's own filter engine. */
const draws = (sub: Parameters<typeof buildingBaseFilter>[0], props: Record<string, unknown>) =>
  featureFilter(buildingBaseFilter(sub) as never).filter({ zoom: 16 } as never, { type: 3, properties: props } as never);

describe('building sublayer filters (interiors available: full backend)', () => {
  it('interior buildings get the dashed stroke, others the normal one', () => {
    expect(draws('interior-stroke', { is_hidden: false, has_interior: true })).toBe(true);
    expect(draws('stroke', { is_hidden: false, has_interior: true })).toBe(false);
    expect(draws('stroke', { is_hidden: false, has_interior: false })).toBe(true);
  });

  it('hidden buildings never draw; labels need a name or address', () => {
    expect(draws('fill', { is_hidden: true })).toBe(false);
    expect(draws('label', { is_hidden: false, address: '1 N STATE ST' })).toBe(true);
    expect(draws('label', { is_hidden: false })).toBe(false);
  });
});
