import { describe, expect, it, vi } from 'vitest';
import { featureFilter } from '@maplibre/maplibre-gl-style-spec';

// Static mode (how the map server runs): no database → no interiors.
vi.mock('../../../utils/staticMode', () => ({ IS_STATIC: true, INTERIORS_AVAILABLE: false }));

const { buildingBaseFilter } = await import('../BuildingLayer');
const draws = (sub: Parameters<typeof buildingBaseFilter>[0], props: Record<string, unknown>) =>
  featureFilter(buildingBaseFilter(sub) as never).filter({ zoom: 16 } as never, { type: 3, properties: props } as never);

describe('building sublayer filters (static mode)', () => {
  it('no dashed interior outline; has_interior buildings look like any other', () => {
    expect(draws('interior-stroke', { is_hidden: false, has_interior: true })).toBe(false);
    expect(draws('stroke', { is_hidden: false, has_interior: true })).toBe(true);
    expect(draws('stroke', { is_hidden: false, has_interior: false })).toBe(true);
  });
});
