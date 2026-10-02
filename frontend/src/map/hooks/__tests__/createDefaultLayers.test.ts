/**
 * Per-city layer lists. Chicago's list is pinned exactly (ids + order + defaults), so a
 * change made for another city can never silently alter what Chicago users see.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultLayers } from '../useMapLayers';

const ids = (slug: string) => createDefaultLayers(slug).map((l) => l.id);

describe('createDefaultLayers', () => {
  it('Chicago list is unchanged (pinned 2026-10-02)', () => {
    expect(createDefaultLayers('chicago').map(({ id, group, visible, opacity }) => [id, group, visible, opacity]))
      .toEqual([
        ['railroads', 'infrastructure', true, 1],
        ['transit', 'infrastructure', true, 1],
        ['waterways', 'infrastructure', true, 1],
        ['zoning', 'zoning', false, 1],
        ['buildings', 'zoning', true, 1],
        ['pois', 'poi', true, 1],
        ['major_streets', 'infrastructure', true, 1],
        ['zip_codes', 'zoning', false, 1],
        ['sanborn', 'historical', false, 0.7],
        ['parks', 'parks', true, 1],
        ['police_districts', 'government', false, 1],
        ['wards', 'government', false, 1],
        ['gang_territory', 'safety', false, 1],
        ['federal_properties', 'government', false, 1],
        ['railroad_row', 'infrastructure', false, 1],
      ]);
  });

  it('Detroit never offers the embedded Chicago police districts', () => {
    expect(ids('detroit')).not.toContain('police_districts');
  });

  it('Detroit does not offer parks until it has its own parks table', () => {
    expect(ids('detroit')).not.toContain('parks');
  });

  it('Detroit keeps its own layers', () => {
    expect(ids('detroit')).toEqual(
      expect.arrayContaining(['neighborhoods', 'council_districts', 'dlba_properties', 'abandoned_blight']),
    );
  });
});
