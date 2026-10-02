/**
 * Detroit zoning catalogue — same ZoneClass/ZoneType shape as utils/zoningTypes.ts.
 *
 * PURPOSE
 *   utils/zoningTypes.ts is Chicago Title 17 (RS-3, B3-2, DX-…; dash families). Detroit's
 *   Zoning Ordinance (City Code Ch. 50) uses undashed codes, so every Detroit code would
 *   land in an "Other …" bucket. This file supplies the Detroit catalogue; Phase 5 adds
 *   an optional `classes` parameter to buildZoningFilter (default = Chicago's
 *   ZONE_CLASSES, so Chicago is unchanged).
 *
 * STATUS — SKELETON. Catalogue empty.
 *
 * UNPROVEN — verify against the live `Zoning_1` FeatureServer before filling:
 *   expected families R1–R6, B1–B6, M1–M5, W1, TM, PD, PC, PCA, PR, P1, SD1–SD5, MKT.
 *   Run `SELECT zone_code, count(*) FROM zoning_districts WHERE city_id = :detroit
 *   GROUP BY 1` after import and make sure every code is matched by exactly one type.
 *
 * CONTRACT: `ZoneClass.key` must equal the `zone_class` the backend's
 *   DetroitZoningImporter writes (residential / commercial / manufacturing / special /
 *   transportation / waterfront / other). Class keys that disagree hide buildings.
 */
import type { ZoneClass } from '../../utils/zoningTypes';

export const DETROIT_ZONE_CLASSES: readonly ZoneClass[] = [];
