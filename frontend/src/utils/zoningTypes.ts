/**
 * Chicago zoning classes → specific zone types, and the MapLibre filter that shows only
 * the types the user ticked.
 *
 * PURPOSE
 *   The zoning layer's features carry ``zone_class`` (broad, set by the importer —
 *   backend/app/data_import/import_zoning.py) and ``zone_code`` (the real district, e.g.
 *   "B1-1", "RS-3", "PD 1047"). The filter panel lets the user pick types at the
 *   district level. This file is the pure part: catalogue + filter-expression builder.
 *
 * HOW CODES MAP TO TYPES (Chicago Zoning Ordinance, Title 17)
 *   * Residential codes ARE the district: "RS-3", "RT-4A" → matched exactly.
 *   * Business/commercial/manufacturing/downtown codes are "<district>-<bulk>":
 *     "B1-1.5" is district B1 at bulk 1.5 → matched by the "B1-" prefix.
 *   * Planned developments are numbered: "PD 1047" → "PD"; "PMD 4" → "PMD".
 *   Each class also gets an "Other …" type that catches codes not in the list, so ticking
 *   every type in a class never hides anything the data actually contains.
 *
 * TO ADD A TYPE: append to the class's ``types`` with a matcher; the panel and filter
 * pick it up automatically. Keep "exact" for codes that are prefixes of other codes
 * (RT-4 vs RT-4A).
 */
import { ZONING_COLORS } from './colorSchemes';

type Matcher =
  | { kind: 'exact'; code: string } // zone_code === code
  | { kind: 'prefix'; prefix: string }; // zone_code starts with prefix

export interface ZoneType {
  readonly key: string;
  readonly label: string;
  readonly matchers: readonly Matcher[];
}

export interface ZoneClass {
  readonly key: string; // must equal the importer's zone_class value
  readonly label: string;
  readonly color: string;
  readonly types: readonly ZoneType[];
}

// O(1) time, O(1) space — n = 1 matcher
const exact = (code: string): Matcher => ({ kind: 'exact', code });
// O(1) time, O(1) space — n = 1 matcher
const prefix = (p: string): Matcher => ({ kind: 'prefix', prefix: p });
/** "<district>-<bulk>" family, e.g. B1 → matches "B1-1", "B1-1.5", "B1-5". O(1) time, O(1) space — n = 1 type. */
const family = (key: string, label: string): ZoneType => ({ key, label, matchers: [prefix(`${key}-`)] });
// O(1) time, O(1) space — n = 1 type
const exactType = (code: string, label: string): ZoneType => ({ key: code, label, matchers: [exact(code)] });

export const OTHER_SUFFIX = '__other';

export const ZONE_CLASSES: readonly ZoneClass[] = [
  {
    key: 'residential',
    label: 'Residential',
    color: ZONING_COLORS.residential,
    types: [
      exactType('RS-1', 'RS-1 — Single-unit (detached)'),
      exactType('RS-2', 'RS-2 — Single-unit (detached)'),
      exactType('RS-3', 'RS-3 — Single-unit (detached & attached)'),
      exactType('RT-3.5', 'RT-3.5 — Two-flat, townhouse'),
      exactType('RT-4', 'RT-4 — Two-flat, townhouse, multi-unit'),
      exactType('RT-4A', 'RT-4A — Two-flat, townhouse, multi-unit'),
      exactType('RM-4.5', 'RM-4.5 — Multi-unit'),
      exactType('RM-5', 'RM-5 — Multi-unit'),
      exactType('RM-5.5', 'RM-5.5 — Multi-unit'),
      exactType('RM-6', 'RM-6 — Multi-unit'),
      exactType('RM-6.5', 'RM-6.5 — Multi-unit (high density)'),
    ],
  },
  {
    key: 'commercial',
    label: 'Commercial',
    color: ZONING_COLORS.commercial,
    types: [
      family('B1', 'B1 — Neighborhood shopping'),
      family('B2', 'B2 — Neighborhood mixed-use'),
      family('B3', 'B3 — Community shopping'),
      family('C1', 'C1 — Neighborhood commercial'),
      family('C2', 'C2 — Motor vehicle-related commercial'),
      family('C3', 'C3 — Commercial, manufacturing & employment'),
    ],
  },
  {
    key: 'manufacturing',
    label: 'Manufacturing',
    color: ZONING_COLORS.manufacturing,
    types: [
      family('M1', 'M1 — Limited manufacturing / business park'),
      family('M2', 'M2 — Light industry'),
      // (bigo-lint misreads this call as a definition) O(1) time, O(1) space — n = 1 type
      family('M3', 'M3 — Heavy industry'),
      { key: 'PMD', label: 'PMD — Planned manufacturing district', matchers: [prefix('PMD')] },
    ],
  },
  {
    key: 'mixed',
    label: 'Downtown / mixed',
    color: ZONING_COLORS.mixed,
    types: [
      family('DC', 'DC — Downtown core'),
      family('DX', 'DX — Downtown mixed-use'),
      family('DR', 'DR — Downtown residential'),
      family('DS', 'DS — Downtown service'),
    ],
  },
  {
    key: 'special',
    label: 'Special',
    color: ZONING_COLORS.special,
    types: [
      { key: 'PD', label: 'PD — Planned development', matchers: [exact('PD'), prefix('PD ')] },
      { key: 'POS', label: 'POS — Parks & open space', matchers: [prefix('POS')] },
    ],
  },
  {
    key: 'transportation',
    label: 'Transportation',
    color: ZONING_COLORS.transportation,
    types: [{ key: 'T', label: 'T — Transportation', matchers: [prefix('T')] }],
  },
  // Codes the importer couldn't classify (zone_class 'other'). No named types — only the
  // "Other" bucket — so unticking it is the only way to hide them.
  { key: 'other', label: 'Unclassified', color: '#888888', types: [] },
];

/**
 * Every selectable type key, including each class's "Other" bucket. `classes` defaults to
 * Chicago's catalogue; other cities pass theirs (src/cities/<slug>/zoning.ts).
 * O(t) time, O(t) space — t = types.
 */
export function allTypeKeys(classes: readonly ZoneClass[] = ZONE_CLASSES): string[] {
  // O(t) time, O(t) space — t = types across classes
  // bigo-lint: disable=BIGO006 — amortised: each class maps only its own types (t total)
  return classes.flatMap((c) => [...c.types.map((t) => t.key), `${c.key}${OTHER_SUFFIX}`]);
}

/** Type keys belonging to one class (incl. its "Other"). O(t) time, O(t) space — t = types in the class. */
export function typeKeysOfClass(cls: ZoneClass): string[] {
  // O(t) time, O(t) space — t = types in the class
  return [...cls.types.map((t) => t.key), `${cls.key}${OTHER_SUFFIX}`];
}

const CODE = ['get', 'zone_code'];

/** One matcher → MapLibre boolean expression. O(1) time, O(1) space — n = 1 matcher. */
function matcherExpr(m: Matcher): unknown[] {
  if (m.kind === 'exact') return ['==', CODE, m.code];
  // 'slice' on a shorter string just returns the shorter string, so no length guard needed.
  return ['==', ['slice', CODE, 0, m.prefix.length], m.prefix];
}

/** Any of a type's matchers. O(m) time, O(m) space — m = matchers on the type (≤ 2). */
function typeExpr(t: ZoneType): unknown[] {
  // O(m) time, O(m) space — m = matchers
  return t.matchers.length === 1 ? matcherExpr(t.matchers[0]) : ['any', ...t.matchers.map(matcherExpr)];
}

/**
 * Filter for the zoning layers given the ticked type keys.
 *   all ticked  → null (no filter: show everything, including classes we don't list)
 *   none ticked → a filter that matches nothing
 *   otherwise   → any(type expressions) with each class's "Other" = class AND NOT known type
 *
 * O(t) time, O(t) space — t = types (each with ≤ 2 matchers, a constant).
 */
export function buildZoningFilter(
  active: ReadonlySet<string>,
  classes: readonly ZoneClass[] = ZONE_CLASSES,
): unknown[] | null {
  const all = allTypeKeys(classes);
  // O(t) time, O(1) space — t = type keys
  if (all.every((k) => active.has(k))) return null;
  const conditions: unknown[] = [];
  // O(t) time, O(t) space — t = types across all classes (each class visits only its own)
  for (const cls of classes) {
    // bigo-lint: disable=BIGO006 — amortised: every type is visited once overall (t)
    // O(t_c) time, O(t_c) space — t_c = types in this class
    for (const t of cls.types) {
      if (active.has(t.key)) conditions.push(['all', ['==', ['get', 'zone_class'], cls.key], typeExpr(t)]);
    }
    if (active.has(`${cls.key}${OTHER_SUFFIX}`)) {
      conditions.push([
        'all',
        ['==', ['get', 'zone_class'], cls.key],
        // bigo-lint: disable=BIGO006 — amortised: each class's types are mapped once (t)
        // O(t_c) time, O(t_c) space — t_c = types in this class
        ...(cls.types.length ? [['!', ['any', ...cls.types.map(typeExpr)]]] : []),
      ]);
    }
  }
  if (conditions.length === 0) return ['==', ['get', 'zone_class'], '__none__'];
  return conditions.length === 1 ? conditions[0] as unknown[] : ['any', ...conditions];
}
