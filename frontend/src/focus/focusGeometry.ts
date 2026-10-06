/**
 * Focus-area geometry — turns "zip 60614 + Ward 43" into one shape, and that shape into
 * the gray mask that hides everything else.
 *
 * PURPOSE
 *   The user picks zip codes, police districts and wards. Everything outside the picked
 *   area is grayed out so the data inside stands out. This file is the pure geometry for
 *   that: no React, no MapLibre — easy to unit test.
 *
 * FLOW
 *   useFocusArea → buildFocusShape(selection, boundaries)
 *                    → unionOf(each kind)        # e.g. all selected wards as one shape
 *                    → union | intersect across kinds (selection.mode)
 *               → buildMask(shape)               # world rectangle with the shape cut out
 *               → FocusMaskLayer draws the mask on top of every data layer
 *
 * WHY A MASK and not per-layer filters: ~20 layers, many of which have no zip/ward
 * property. One inverted polygon on top grays out all of them, including layers added
 * later, with zero per-layer code.
 */
import { difference, featureCollection, intersect, union } from '@turf/turf';

export type FocusKind = 'zip' | 'police' | 'ward';

/** 'union' = inside ANY selected area; 'intersection' = inside a selected area of EVERY kind used. */
export type FocusMode = 'union' | 'intersection';

export type AreaFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;

/** Selected area ids per kind (zip strings, district / ward numbers as strings). */
export interface FocusSelection {
  readonly zip: readonly string[];
  readonly police: readonly string[];
  readonly ward: readonly string[];
  readonly mode: FocusMode;
}

export const EMPTY_SELECTION: FocusSelection = Object.freeze({
  zip: [],
  police: [],
  ward: [],
  mode: 'union',
});

/** Boundary features per kind, each keyed by its area id. */
export type BoundaryIndex = Record<FocusKind, ReadonlyMap<string, readonly AreaFeature[]>>;

export const FOCUS_KINDS: readonly FocusKind[] = ['zip', 'police', 'ward'];

/** True when nothing is selected — the mask should be removed entirely. O(1) time, O(1) space. */
export function isEmptySelection(sel: FocusSelection): boolean {
  return sel.zip.length + sel.police.length + sel.ward.length === 0;
}

/**
 * Group a FeatureCollection's polygons by an id property.
 * A zip can be split into several features (islands, PO boxes), so values are arrays.
 * O(n) time, O(n) space — n = features.
 */
export function indexBoundaries(
  fc: GeoJSON.FeatureCollection,
  idProp: string,
): Map<string, AreaFeature[]> {
  const index = new Map<string, AreaFeature[]>();
  // O(n) time, O(n) space — n = features in the collection
  for (const f of fc.features) {
    // O(n)
    const type = f.geometry?.type;
    if (type !== 'Polygon' && type !== 'MultiPolygon') continue;
    const raw = f.properties?.[idProp];
    if (raw === undefined || raw === null) continue;
    const id = String(raw);
    const list = index.get(id) ?? [];
    list.push(f as AreaFeature);
    index.set(id, list);
  }
  return index;
}

/**
 * Merge a list of polygons into one. Returns null for an empty list.
 * Turf's union is a polygon-clipping sweep: ~O(v log v) time, O(v) space — v = vertices.
 */
function unionOf(features: readonly AreaFeature[]): AreaFeature | null {
  if (features.length === 0) return null;
  if (features.length === 1) return features[0];
  return union(featureCollection([...features])) as AreaFeature | null;
}

/**
 * Build the single shape the user wants to focus on, or null when nothing is selected
 * (or an intersection comes out empty — e.g. a ward that doesn't touch the chosen zip).
 *
 * Unknown ids are skipped silently: the panel only offers ids that exist, so an unknown
 * one means stale saved state from an older data file, not user error.
 *
 * O(v log v) time, O(v) space — v = total vertices of the selected boundaries.
 */
export function buildFocusShape(sel: FocusSelection, boundaries: BoundaryIndex): AreaFeature | null {
  const perKind: AreaFeature[] = [];
  // Runs 3 times (FOCUS_KINDS is fixed).
  // O(a + v log v) time, O(a + v) space — a = selected area ids; v = vertices of the selected boundaries
  for (const kind of FOCUS_KINDS) {
    // O(v log v) time, O(v) space — v = vertices of the selected boundaries; k = 3 focus kinds
    const feats = sel[kind].flatMap((id) => boundaries[kind].get(id) ?? []);
    const merged = unionOf(feats);
    if (merged) perKind.push(merged);
  }
  if (perKind.length === 0) return null;
  if (perKind.length === 1) return perKind[0];

  if (sel.mode === 'union') return unionOf(perKind);
  // Intersection across kinds: pairwise fold. intersect() needs ≥2 features per call.
  let acc: AreaFeature | null = perKind[0];
  // O(v log v) time, O(v) space — v = vertices of the per-kind shapes
  for (let i = 1; i < perKind.length && acc; i++) {
    // O(k) folds, k ≤ 3
    acc = intersect(featureCollection([acc, perKind[i]])) as AreaFeature | null;
  }
  return acc;
}

/**
 * Whole-world rectangle. Latitude stops at ±85 because Web Mercator can't show the poles —
 * a ±90 ring renders as a sliver and leaves the far north unmasked.
 */
const WORLD: GeoJSON.Feature<GeoJSON.Polygon> = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'Polygon',
    coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]],
  },
};

/**
 * The gray overlay: the world with the focus shape cut out.
 * When the intersection is empty (shape null) the whole world is masked so the user
 * sees "nothing matches" rather than an unmasked map that looks like the filter failed.
 * O(v log v) time, O(v) space — v = vertices of the focus shape.
 */
export function buildMask(shape: AreaFeature | null): AreaFeature {
  if (!shape) return WORLD;
  return (difference(featureCollection([WORLD, shape])) as AreaFeature | null) ?? WORLD;
}

/** Pick 'mode' from untrusted saved state, defaulting to union. O(1) time, O(1) space. */
export function coerceMode(value: unknown): FocusMode {
  return value === 'intersection' ? 'intersection' : 'union';
}
