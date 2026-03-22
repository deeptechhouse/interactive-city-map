import { describe, it, expect, vi } from 'vitest';
import { bboxToParam, martinTileUrl, apiBaseUrl, darkenColor, CHICAGO_CENTER, CHICAGO_ZOOM } from '../geoUtils';

// Note: boundsToArray requires a MapLibre LngLatBounds object which is hard to
// construct without the full MapLibre GL JS library, so we test it indirectly.

describe('bboxToParam', () => {
  it('joins four numbers with commas', () => {
    const result = bboxToParam([-87.7, 41.8, -87.6, 41.9]);
    expect(result).toBe('-87.7,41.8,-87.6,41.9');
  });

  it('handles zero values', () => {
    const result = bboxToParam([0, 0, 0, 0]);
    expect(result).toBe('0,0,0,0');
  });

  it('handles negative coordinates', () => {
    const result = bboxToParam([-180, -90, 180, 90]);
    expect(result).toBe('-180,-90,180,90');
  });
});

describe('martinTileUrl', () => {
  it('constructs tile URL with default base', () => {
    // import.meta.env.VITE_MARTIN_URL is undefined in test env
    const url = martinTileUrl('buildings');
    expect(url).toContain('buildings');
    expect(url).toContain('{z}/{x}/{y}');
  });

  it('uses the table name in the path', () => {
    const url = martinTileUrl('railroads');
    expect(url).toMatch(/\/railroads\//);
  });
});

describe('apiBaseUrl', () => {
  it('returns a string URL', () => {
    const url = apiBaseUrl();
    expect(typeof url).toBe('string');
    expect(url).toMatch(/^http/);
  });
});

describe('darkenColor', () => {
  it('returns a valid hex color', () => {
    const result = darkenColor('#FF6600', 0.5);
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('returns black when factor is 1', () => {
    const result = darkenColor('#FFFFFF', 1);
    expect(result).toBe('#000000');
  });

  it('returns same color when factor is 0', () => {
    const result = darkenColor('#FF6600', 0);
    expect(result).toBe('#ff6600');
  });

  it('darkens a color by half', () => {
    const result = darkenColor('#FF0000', 0.5);
    // Red channel: 255 * 0.5 = 128 -> 0x80
    expect(result).toBe('#800000');
  });

  it('handles mid-tone gray', () => {
    const result = darkenColor('#808080', 0.5);
    // 128 * 0.5 = 64 -> 0x40
    expect(result).toBe('#404040');
  });
});

describe('CHICAGO_CENTER constant', () => {
  it('has two elements (longitude, latitude)', () => {
    expect(CHICAGO_CENTER).toHaveLength(2);
  });

  it('longitude is approximately -87.63', () => {
    expect(CHICAGO_CENTER[0]).toBeCloseTo(-87.63, 1);
  });

  it('latitude is approximately 41.88', () => {
    expect(CHICAGO_CENTER[1]).toBeCloseTo(41.88, 1);
  });
});

describe('CHICAGO_ZOOM constant', () => {
  it('is a number', () => {
    expect(typeof CHICAGO_ZOOM).toBe('number');
  });

  it('is a reasonable zoom level', () => {
    expect(CHICAGO_ZOOM).toBeGreaterThanOrEqual(1);
    expect(CHICAGO_ZOOM).toBeLessThanOrEqual(22);
  });
});
