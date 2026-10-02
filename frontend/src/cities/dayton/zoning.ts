/**
 * Dayton zoning catalogue, in the same ZoneClass/ZoneType shape as utils/zoningTypes.ts.
 *
 * PURPOSE
 *   utils/zoningTypes.ts is Chicago Title 17. The fork's ZoningFilter offered Chicago's
 *   M1/M2/M3/PMD manufacturing sub-types. Unticking any of them hid all Dayton
 *   manufacturing, because no Dayton code matches them. This file supplies Dayton's
 *   catalogue, consumed through the profile's `zoning` field.
 *
 * WHERE THE CODES CAME FROM (2026-10-02)
 *   GROUP BY NEW_ZONE on City of Dayton MapLayers_Citywide/MapServer/203: 26 codes over
 *   970 polygons (25 polygons have no code → class 'other'). Dayton's 2006 code names
 *   districts by neighborhood type: S(uburban), E(clectic), M(ature).
 *   UNPROVEN labels: T ("Transitional"), MX ("Mixed-Use"), AP ("Airport"). The City's own
 *   legend says just "T"; check the Zoning Code text before quoting these.
 *
 * MATCHING: every type matches its code EXACTLY. Dayton codes overlap as prefixes
 *   ("I-1" would prefix-match a future "I-12"), so prefix matchers would be a trap.
 *
 * CONTRACT: `ZoneClass.key` must equal the `zone_class` that
 *   backend/app/data_import/dayton/import_zoning.py writes, and every code in its
 *   DAYTON_ZONES must appear here exactly once. backend/tests/test_dayton_parity.py and
 *   __tests__/daytonProfile.test.ts both pin this. If keys disagree, buildings are hidden.
 *
 * TO ADD A CODE: add it to DAYTON_ZONES in the backend importer AND to the right class here.
 */
import type { ZoneClass, ZoneType } from '../../utils/zoningTypes';
import { ZONING_COLORS } from '../../utils/colorSchemes';

/**
 * One exact-code zone type: "ER-3 — Eclectic Residential 3".
 * O(1) time, O(1) space — n = one object.
 */
const zone = (code: string, name: string): ZoneType => ({
  key: code,
  label: `${code} — ${name}`,
  matchers: [{ kind: 'exact', code }],
});

export const DAYTON_ZONE_CLASSES: readonly ZoneClass[] = [
  {
    key: 'residential',
    label: 'Residential',
    color: ZONING_COLORS.residential,
    types: [
      zone('SR-1', 'Suburban Residential 1'),
      zone('SR-2', 'Suburban Residential 2'),
      zone('ER-3', 'Eclectic Residential 3'),
      zone('ER-4', 'Eclectic Residential 4'),
      zone('MR-5', 'Mature Residential 5'),
      zone('SMF', 'Suburban Multi-Family'),
      zone('EMF', 'Eclectic Multi-Family'),
      zone('MMF', 'Mature Multi-Family'),
      zone('MH', 'Manufactured Home'),
    ],
  },
  {
    key: 'commercial',
    label: 'Commercial',
    color: ZONING_COLORS.commercial,
    types: [
      zone('SNC', 'Suburban Neighborhood Commercial'),
      zone('ENC', 'Eclectic Neighborhood Commercial'),
      zone('MNC', 'Mature Neighborhood Commercial'),
      zone('SGC', 'Suburban General Commercial'),
      zone('EGC', 'Eclectic General Commercial'),
      zone('MGC', 'Mature General Commercial'),
    ],
  },
  {
    key: 'manufacturing',
    label: 'Industrial',
    color: ZONING_COLORS.manufacturing,
    types: [
      zone('I-1', 'Light Industrial'),
      zone('I-2', 'General Industrial'),
      zone('BP', 'Business Park'),
    ],
  },
  {
    key: 'mixed',
    label: 'Downtown / mixed',
    color: ZONING_COLORS.mixed,
    types: [
      zone('CBD', 'Central Business District'),
      zone('UBD', 'Urban Business District'),
      zone('MX', 'Mixed-Use'),
      zone('T', 'Transitional'),
    ],
  },
  {
    key: 'special',
    label: 'Special',
    color: ZONING_COLORS.special,
    types: [
      zone('CI', 'Campus Institutional'),
      zone('OS', 'Open Space'),
      zone('WO', 'Well Head Operation'),
    ],
  },
  {
    key: 'transportation',
    label: 'Transportation',
    color: ZONING_COLORS.transportation,
    types: [zone('AP', 'Airport')],
  },
  // Polygons with no current code, and buildings outside the city limit (enrich sets
  // zone_class 'other'). Only the "Other" bucket, as in Chicago's catalogue.
  { key: 'other', label: 'Unclassified', color: '#888888', types: [] },
];
