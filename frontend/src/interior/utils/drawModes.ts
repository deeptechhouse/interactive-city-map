import * as turf from '@turf/turf';

export function createLineStringFromPoints(
  points: [number, number][],
): GeoJSON.LineString | null {
  if (points.length < 2) return null;
  return { type: 'LineString', coordinates: points };
}

export function createPolygonFromPoints(
  points: [number, number][],
): GeoJSON.Polygon | null {
  if (points.length < 3) return null;
  const ring = [...points, points[0]];
  return { type: 'Polygon', coordinates: [ring] };
}

export function createPointFeature(point: [number, number]): GeoJSON.Point {
  return { type: 'Point', coordinates: point };
}

export function calculatePolygonArea(polygon: GeoJSON.Polygon): number {
  return turf.area({ type: 'Feature', geometry: polygon, properties: {} });
}

export function isValidPolygon(points: [number, number][]): boolean {
  if (points.length < 3) return false;

  // Check for self-intersections by testing each pair of non-adjacent edges
  for (let i = 0; i < points.length; i++) {
    const a1 = points[i];
    const a2 = points[(i + 1) % points.length];
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue; // skip adjacent wrap-around
      const b1 = points[j];
      const b2 = points[(j + 1) % points.length];
      if (segmentsIntersect(a1, a2, b1, b2)) return false;
    }
  }

  return true;
}

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

function cross(
  o: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

export function createPreviewLine(
  placedPoints: [number, number][],
  cursorPosition: [number, number],
): GeoJSON.LineString | null {
  if (placedPoints.length === 0) return null;
  const lastPoint = placedPoints[placedPoints.length - 1];
  return { type: 'LineString', coordinates: [lastPoint, cursorPosition] };
}
