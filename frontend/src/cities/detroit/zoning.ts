/**
 * Detroit zoning catalogue — same ZoneClass/ZoneType shape as utils/zoningTypes.ts.
 *
 * PURPOSE
 *   utils/zoningTypes.ts is Chicago Title 17 (RS-3, B3-2, DX-…; dash families). Detroit's
 *   Zoning Ordinance (City Code Ch. 50) uses undashed codes, so this file supplies the
 *   Detroit catalogue the zoning filter shows when Detroit is selected.
 *
 * SOURCE: the 29 distinct ZONING_REV codes in the 2026-10-02 static export
 *   (vocab.generated.ts DETROIT_EXPORTED_ZONE_CODES), labelled with the layer's own
 *   ZDESCR_N descriptions. Every exported code matches exactly one type (test-enforced).
 *
 * MATCHING: codes are matched EXACTLY — "R1" must not prefix-match a future "R10", and
 *   "PC" must not swallow "PCA". buildZoningFilter adds each class's "Other" bucket
 *   (class AND NOT a listed code) itself, so a code added upstream is never hidden.
 *
 * CONTRACT: `ZoneClass.key` equals the `zone_class` written by the backend
 *   (detroit/import_zoning.py DETROIT_ZONE_CLASS). Keep both tables in step.
 */
import type { ZoneClass, ZoneType } from '../../utils/zoningTypes';
import { ZONING_COLORS } from '../../utils/colorSchemes';

/** One exact-code type. O(1) time, O(1) space — t = 1 type object. */
const exactType = (code: string, label: string): ZoneType => ({
  key: code,
  label: `${code} — ${label}`,
  matchers: [{ kind: 'exact', code }],
});

// Colours for classes Chicago does not have. ADJUSTABLE: any hex.
const WATERFRONT_COLOR = '#38BDF8';
const OTHER_COLOR = '#A3A3A3';

export const DETROIT_ZONE_CLASSES: readonly ZoneClass[] = [
  {
    key: 'residential',
    label: 'Residential',
    color: ZONING_COLORS.residential,
    types: [
      exactType('R1', 'Single-family residential'),
      exactType('R2', 'Two-family residential'),
      exactType('R3', 'Low density residential'),
      exactType('R4', 'Thoroughfare residential'),
      exactType('R5', 'Medium density residential'),
      exactType('R6', 'High density residential'),
    ],
  },
  {
    key: 'commercial',
    label: 'Commercial',
    color: ZONING_COLORS.commercial,
    types: [
      exactType('B1', 'Restricted business'),
      exactType('B2', 'Local business & residential'),
      exactType('B3', 'Shopping'),
      exactType('B4', 'General business'),
      exactType('B5', 'Major business'),
      exactType('B6', 'General services'),
      exactType('PCA', 'Restricted central business'),
    ],
  },
  {
    key: 'manufacturing',
    label: 'Industrial',
    color: ZONING_COLORS.manufacturing,
    types: [
      exactType('M1', 'Limited industrial'),
      exactType('M2', 'Restricted industrial'),
      exactType('M3', 'General industrial'),
      exactType('M4', 'Intensive industrial'),
      exactType('M5', 'Special industrial'),
      exactType('MKT', 'Market & distribution'),
      exactType('TM', 'Transitional-industrial'),
    ],
  },
  {
    key: 'mixed',
    label: 'Mixed-use (SD)',
    color: ZONING_COLORS.mixed,
    types: [
      exactType('SD1', 'Special development, small-scale mixed-use'),
      exactType('SD2', 'Special development, mixed-use'),
      exactType('SD3', 'Special development, technology & research'),
      exactType('SD4', 'Special development, riverfront mixed-use'),
    ],
  },
  {
    key: 'special',
    label: 'Special & public',
    color: ZONING_COLORS.special,
    types: [
      exactType('PD', 'Planned development'),
      exactType('PC', 'Public center'),
      exactType('PR', 'Parks & recreation'),
      exactType('P1', 'Open parking'),
      exactType('SD5', 'Special development, casinos'),
    ],
  },
  {
    key: 'waterfront',
    label: 'Waterfront',
    color: WATERFRONT_COLOR,
    types: [exactType('W1', 'Waterfront-industrial')],
  },
  {
    key: 'other',
    label: 'Other / unrecognised',
    color: OTHER_COLOR,
    // Backend writes 'other' for any code its table does not know. No named types — only
    // the automatic "Other" bucket, exactly like Chicago's 'other' class.
    types: [],
  },
];
