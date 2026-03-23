/**
 * 6-parameter affine transform: [a, b, c, d, e, f]
 *
 * world_x = a * px + b * py + c
 * world_y = d * px + e * py + f
 */
export type AffineTransform = [number, number, number, number, number, number];

/**
 * Convert pixel coordinates to world coordinates using an affine transform.
 */
export function pixelToWorld(
  affine: AffineTransform,
  px: number,
  py: number,
): [number, number] {
  const [a, b, c, d, e, f] = affine;
  return [a * px + b * py + c, d * px + e * py + f];
}

/**
 * Convert world coordinates to pixel coordinates (inverse affine).
 *
 * Throws if the affine transform is singular (determinant near zero).
 */
export function worldToPixel(
  affine: AffineTransform,
  wx: number,
  wy: number,
): [number, number] {
  const [a, b, c, d, e, f] = affine;
  const det = a * e - b * d;
  if (Math.abs(det) < 1e-12) {
    throw new Error('Singular affine transform, cannot invert');
  }
  const px = (e * (wx - c) - b * (wy - f)) / det;
  const py = (-d * (wx - c) + a * (wy - f)) / det;
  return [px, py];
}

/**
 * Transform the four corners of an image (0,0 to width,height) into world
 * coordinates, returning [TL, TR, BR, BL].
 */
export function transformBounds(
  affine: AffineTransform,
  width: number,
  height: number,
): [[number, number], [number, number], [number, number], [number, number]] {
  const tl = pixelToWorld(affine, 0, 0);
  const tr = pixelToWorld(affine, width, 0);
  const br = pixelToWorld(affine, width, height);
  const bl = pixelToWorld(affine, 0, height);
  return [tl, tr, br, bl];
}
