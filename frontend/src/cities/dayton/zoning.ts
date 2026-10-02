/**
 * Dayton zoning catalogue, in the same ZoneClass/ZoneType shape as utils/zoningTypes.ts.
 *
 * PURPOSE
 *   utils/zoningTypes.ts is Chicago Title 17. The fork's ZoningFilter offered Chicago's
 *   M1/M2/M3/PMD manufacturing sub-types. Un-ticking any of them hid all Dayton
 *   manufacturing, because no Dayton code matches them. This file supplies Dayton's
 *   catalogue, consumed through the optional `classes` parameter of buildZoningFilter
 *   (Detroit plan P5).
 *
 * STATUS — SKELETON. The catalogue is empty.
 *
 * UNPROVEN — check against the live City of Dayton layer before filling it:
 *   MapLayers_Citywide/MapServer/203. The fork's import_zoning.py guessed these families:
 *   SF, TF, MF, UR (residential); NC, GC, RC, OC (commercial); LM, GM, HM, I, IN
 *   (manufacturing); MU, MX, CBD, WR (mixed); OS (special). It mixed them with Chicago
 *   prefixes under longest-prefix matching, so "C…" and "R…" codes may have been
 *   misclassified. After import, run `SELECT zone_code, count(*) FROM zoning_districts
 *   WHERE city_id = :dayton GROUP BY 1` and confirm each code matches exactly one type.
 *
 * CONTRACT: `ZoneClass.key` must equal the `zone_class` that the backend's
 *   DaytonZoningImporter writes. If the keys disagree, buildings are hidden.
 */
import type { ZoneClass } from '../../utils/zoningTypes';

export const DAYTON_ZONE_CLASSES: readonly ZoneClass[] = [];
