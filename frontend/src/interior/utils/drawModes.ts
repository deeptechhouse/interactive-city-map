/**
 * Geometry helpers for the interior editor's draw tools (walls, rooms, features).
 *
 * Pure functions — no map or React state. InteriorEditor.tsx feeds them the
 * points the user has clicked so far.
 */
import * as turf from '@turf/turf';

/**
 * Most corners a hand-drawn room may have. InteriorEditor refuses further clicks
 * once a room reaches this, which is what bounds isValidPolygon's pairwise check.
 * ADJUSTABLE: raise for very detailed rooms; the check costs ~v²/2 segment tests
 * (100 → ~5,000, instant; 1,000 → ~500,000, still < 50 ms).
 */
export const MAX_ROOM_VERTICES = 100;

// O(1) time, O(1) space
export function createLineStringFromPoints(
  points: [number, number][],
): GeoJSON.LineString | null {
  if (points.length < 2) return null;
  return { type: 'LineString', coordinates: points };
}

// O(v) time, O(v) space — v = points
export function createPolygonFromPoints(
  points: [number, number][],
): GeoJSON.Polygon | null {
  if (points.length < 3) return null;
  const ring = [...points, points[0]];
  return { type: 'Polygon', coordinates: [ring] };
}

// O(1) time, O(1) space
export function createPointFeature(point: [number, number]): GeoJSON.Point {
  return { type: 'Point', coordinates: point };
}

// O(v) time, O(1) space — v = ring vertices
export function calculatePolygonArea(polygon: GeoJSON.Polygon): number {
  return turf.area({ type: 'Feature', geometry: polygon, properties: {} });
}

// bigo-allow: v ≤ MAX_ROOM_VERTICES (100), enforced at the only caller (InteriorEditor) — at most ~5,000 segment tests
// O(v²) time, O(1) space — v = polygon vertices
export function isValidPolygon(points: [number, number][]): boolean {
  if (points.length < 3) return false;

  // Check for self-intersections by testing each pair of non-adjacent edges.
  // Proper crossings only: touching or collinear edges do not count.
  // bigo-allow: v ≤ MAX_ROOM_VERTICES (100), enforced at the only caller (InteriorEditor)
  // O(v²) time, O(1) space — v = polygon vertices
  for (let i = 0; i < points.length; i++) {
    const a1 = points[i];
    const a2 = points[(i + 1) % points.length];
    // O(v) time, O(1) space — v = polygon vertices
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue; // skip adjacent wrap-around
      const b1 = points[j];
      const b2 = points[(j + 1) % points.length];
      if (segmentsIntersect(a1, a2, b1, b2)) return false;
    }
  }

  return true;
}

// O(1) time, O(1) space
function segmentsIntersect(
  a1: [number, number],
  a2: [number, number],
  b1: [number, number],
  b2: [number, number],
): boolean {
  const d1 = cross(b1, b2, a1);
  const d2 = cross(b1, b2, a2);
  const d3 = cross(a1, a2, b1);
  const d4 = cross(a1, a2, b2);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  return false;
}

// O(1) time, O(1) space
function cross(
  o: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

// O(1) time, O(1) space
export function createPreviewLine(
  placedPoints: [number, number][],
  cursorPosition: [number, number],
): GeoJSON.LineString | null {
  if (placedPoints.length === 0) return null;
  const lastPoint = placedPoints[placedPoints.length - 1];
  return { type: 'LineString', coordinates: [lastPoint, cursorPosition] };
}
