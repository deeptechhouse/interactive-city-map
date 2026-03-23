export interface WallSegment {
  start: [number, number];
  end: [number, number];
}

export interface ProjectionResult {
  projected: [number, number];
  distance: number;
  t: number;
}

export function projectPointOnSegment(
  point: [number, number],
  segStart: [number, number],
  segEnd: [number, number],
): ProjectionResult {
  const dx = segEnd[0] - segStart[0];
  const dy = segEnd[1] - segStart[1];
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    const dist = Math.sqrt(
      (point[0] - segStart[0]) ** 2 + (point[1] - segStart[1]) ** 2,
    );
    return { projected: [segStart[0], segStart[1]], distance: dist, t: 0 };
  }

  let t =
    ((point[0] - segStart[0]) * dx + (point[1] - segStart[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = segStart[0] + t * dx;
  const projY = segStart[1] + t * dy;
  const dist = Math.sqrt((point[0] - projX) ** 2 + (point[1] - projY) ** 2);

  return { projected: [projX, projY], distance: dist, t };
}

export function snapToWall(
  point: [number, number],
  walls: WallSegment[],
  threshold: number = 0.00005,
): [number, number] | null {
  let closest: [number, number] | null = null;
  let minDist = Infinity;

  for (const wall of walls) {
    const result = projectPointOnSegment(point, wall.start, wall.end);
    if (result.distance < minDist) {
      minDist = result.distance;
      closest = result.projected;
    }
  }

  if (closest !== null && minDist <= threshold) {
    return closest;
  }

  return null;
}
