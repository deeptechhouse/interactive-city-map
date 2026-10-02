/**
 * Click popups for Detroit layers, keyed by STYLE layer id (CityProfile.popups contract).
 *
 * PURPOSE
 *   The shared MapContainer has no builders for Detroit's own layers (neighborhoods,
 *   council districts, DPD precincts, DLBA land bank, blight tickets). useMapClick queries
 *   the style ids below and calls the matching builder with the feature's tile properties.
 *
 * PROPERTY NAMES are exactly what the Detroit static build writes
 *   (backend/app/data_import/detroit/static_plan.py) — checked against the 2026-10-02 tiles.
 *
 * SECURITY — every value comes from tile properties (open data, untrusted). popupRow /
 *   popupTitle escape every value; never interpolate a raw property into HTML.
 */
import type { PopupBuilder } from '../CityProfile';
import { escapeHtml, popupRow, popupTitle } from '../../utils/html';

/** Fixed, trusted URL — never built from tile data. */
const BUILDING_DETROIT_URL = 'https://buildingdetroit.org/';

/**
 * Neighborhood name + council district + its page on theneighborhoods.org.
 * The website link is only rendered when it is an https URL (it comes from tile data).
 * O(1) time, O(1) space — p = fixed property set.
 */
export const neighborhoodPopup: PopupBuilder = (p) => {
  const site = typeof p.website === 'string' && p.website.startsWith('https://') ? p.website : '';
  const link = site
    ? `<div style="margin:2px 0"><a href="${escapeHtml(site)}" target="_blank" rel="noopener noreferrer">Neighborhood page</a></div>`
    : '';
  return popupTitle(p.name ?? 'Neighborhood') + popupRow('Council district', p.council_district) + link;
};

/**
 * Council district number + name (the 2026 map has no council-member field).
 * O(1) time, O(1) space — p = fixed property set.
 */
export const councilDistrictPopup: PopupBuilder = (p) =>
  popupTitle(p.name ?? `District ${String(p.district_number ?? '')}`) +
  popupRow('District', p.district_number) +
  popupRow('Council member', p.council_member);

/**
 * DPD precinct label. The source layer carries no station address.
 * O(1) time, O(1) space — p = fixed property set.
 */
export const policePrecinctPopup: PopupBuilder = (p) =>
  popupTitle(p.name ?? `Precinct ${String(p.precinct ?? '')}`) +
  popupRow('Precinct', p.precinct) +
  popupRow('Agency', 'Detroit Police Department');

/**
 * Land Bank property: address, inventory status, lot/structure, parcel, link to
 * buildingdetroit.org (where DLBA lists what is for sale).
 * O(1) time, O(1) space — p = fixed property set.
 */
export const dlbaPopup: PopupBuilder = (p) =>
  popupTitle(p.address ?? 'DLBA property') +
  popupRow('Status', p.status) +
  popupRow('Type', p.property_type) +
  popupRow('Parcel', p.parcel_id) +
  popupRow('Neighborhood', p.neighborhood) +
  popupRow('Council district', p.council_district) +
  `<div style="margin:2px 0"><a href="${BUILDING_DETROIT_URL}" target="_blank" rel="noopener noreferrer">Building Detroit listings</a></div>`;

/**
 * Blight ticket (or commercial demolition): violation, date, disposition.
 * O(1) time, O(1) space — p = fixed property set.
 */
export const blightPopup: PopupBuilder = (p) =>
  popupTitle(p.address ?? (p.source === 'commercial_demolition' ? 'Commercial demolition' : 'Blight ticket')) +
  popupRow('Violation', p.violation_description) +
  popupRow('Ordinance', p.violation_code) +
  popupRow('Issued', p.violation_date) +
  popupRow('Disposition', p.ticket_status);

/** Style layer id → builder. Ids follow the shared layer files' `<layerId>-<kind>` naming. */
export const DETROIT_POPUPS: Readonly<Record<string, PopupBuilder>> = {
  'neighborhoods-fill': neighborhoodPopup,
  'council_districts-fill': councilDistrictPopup,
  'police_precincts-fill': policePrecinctPopup,
  'dlba_properties-points': dlbaPopup,
  'abandoned_blight-blight-points': blightPopup,
};
