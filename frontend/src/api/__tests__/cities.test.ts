import { afterEach, describe, expect, it, vi } from 'vitest';
import { builtInCities, getCities } from '../cities';
import { apiClient } from '../client';

afterEach(() => vi.restoreAllMocks());

describe('city list', () => {
  it('built-in list covers the cities the map knows', () => {
    const cities = builtInCities();
    expect(cities.map((c) => [c.slug, c.name, c.state])).toEqual([
      ['chicago', 'Chicago', 'IL'],
      ['detroit', 'Detroit', 'MI'],
      ['dayton', 'Dayton', 'OH'],
    ]);
    expect(cities[0]).toMatchObject({ center_lat: 41.8781, center_lng: -87.6298, default_zoom: 11 });
  });

  it('uses the backend list when it answers, built-in when it fails or is empty', async () => {
    const get = vi.spyOn(apiClient, 'get');
    get.mockResolvedValueOnce([{ slug: 'x' }]);
    expect(await getCities()).toEqual([{ slug: 'x' }]);
    get.mockResolvedValueOnce([]);
    expect((await getCities()).map((c) => c.slug)).toEqual(['chicago', 'detroit', 'dayton']);
    get.mockRejectedValueOnce(new Error('down'));
    expect((await getCities()).map((c) => c.slug)).toEqual(['chicago', 'detroit', 'dayton']);
  });
});
