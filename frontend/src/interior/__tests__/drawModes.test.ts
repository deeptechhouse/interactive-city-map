import { describe, expect, it } from 'vitest';
import { isValidPolygon, MAX_ROOM_VERTICES } from '../utils/drawModes';

describe('isValidPolygon', () => {
  it('accepts a simple square and rejects a bow-tie', () => {
    expect(isValidPolygon([[0, 0], [1, 0], [1, 1], [0, 1]])).toBe(true);
    expect(isValidPolygon([[0, 0], [1, 1], [1, 0], [0, 1]])).toBe(false);
  });

  it('needs at least three points', () => {
    expect(isValidPolygon([[0, 0], [1, 1]])).toBe(false);
  });

  it('handles a MAX_ROOM_VERTICES-corner room quickly', () => {
    // Regular polygon: convex, so no crossings.
    const pts: [number, number][] = Array.from({ length: MAX_ROOM_VERTICES }, (_, k) => {
      const a = (2 * Math.PI * k) / MAX_ROOM_VERTICES;
      return [Math.cos(a), Math.sin(a)];
    });
    const t0 = performance.now();
    expect(isValidPolygon(pts)).toBe(true);
    expect(performance.now() - t0).toBeLessThan(50);
  });
});
