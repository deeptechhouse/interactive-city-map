/**
 * Click popups for Dayton layers.
 *
 * PURPOSE
 *   Brings over the fork's enriched building popup (owner, owner/mailing address, year
 *   built, rooms, style, appraised value, last sale; fork commit 8a2ac00), plus popups
 *   for Dayton-only layers.
 *
 * TRAPS
 *   - SECURITY: the fork's buildBuildingPopup interpolated tile properties straight into
 *     HTML (Dayton_interactive_map/frontend/src/map/MapContainer.tsx:305-355). Tile
 *     properties are open data and untrusted. Escape every value with the same helper
 *     MapContainer's popup builders use. Do NOT copy the fork's row() helper as-is.
 *   - Field names: the fork's enrichment keys are 10-character DBF names (`owner_ad_2`,
 *     `mailing__3`, `mailing_ad`), so the join came from a county shapefile download.
 *     That code was never committed. Backend enrich.py (plan D2) renames them to clean keys
 *     (`owner_address`, `mailing_address`, …), and these builders read only the clean keys.
 *
 * STATUS — SKELETON.
 */
import type { PopupBuilder } from '../CityProfile';
import { notImplemented } from '../CityProfile';

/**
 * Building + Montgomery County parcel enrichment, with an "Open Details" button.
 * O(f) time, O(f) space — f = metadata fields shown (≤ 20).
 */
export const buildingPopup: PopupBuilder = (properties) => notImplemented('buildingPopup', properties);

/**
 * Neighborhood name (and its priority-board area if the source carries one).
 * O(1) time, O(1) space — p = fixed property set.
 */
export const neighborhoodPopup: PopupBuilder = (properties) => notImplemented('neighborhoodPopup', properties);

/**
 * Dayton PD area name/number.
 * O(1) time, O(1) space — p = fixed property set.
 */
export const policePrecinctPopup: PopupBuilder = (properties) => notImplemented('policePrecinctPopup', properties);

/**
 * Railroad-owned parcel: owner, acreage, Montgomery County Auditor link
 * (mcrealestate.org — replaces the fork's leftover cookcountyassessor.com link).
 * O(1) time, O(1) space — p = fixed property set.
 */
export const railroadRowPopup: PopupBuilder = (properties) => notImplemented('railroadRowPopup', properties);

export const DAYTON_POPUPS: Readonly<Record<string, PopupBuilder>> = {
  buildings: buildingPopup,
  neighborhoods: neighborhoodPopup,
  police_precincts: policePrecinctPopup,
  railroad_row: railroadRowPopup,
};
