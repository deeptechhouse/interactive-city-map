import { describe, expect, it } from 'vitest';
import { boundaryUrl } from '../boundarySource';

describe('boundaryUrl', () => {
  it('static mode reads the static build’s GeoJSON next to the PMTiles', () => {
    expect(boundaryUrl('detroit', 'zip_codes', true)).toBe('./data/detroit/zip_codes.geojson');
  });

  it('database mode asks the backend for one city’s polygons', () => {
    expect(boundaryUrl('dayton', 'neighborhoods', false)).toMatch(/\/api\/v1\/cities\/dayton\/boundaries\/neighborhoods$/);
  });
});
