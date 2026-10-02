/**
 * Click popups for Dayton-only layers (keyed by STYLE layer id, as useMapClick queries).
 *
 * PURPOSE
 *   The shared MapContainer already builds popups for buildings, zoning, transit, parks,
 *   POIs… It has no builder for the two Dayton boundary layers, so those live here:
 *     'neighborhoods-fill'     → neighborhood name (+ priority board when present)
 *     'police_precincts-fill'  → Dayton PD area name
 *
 * SECURITY: tile properties are open data and untrusted. The fork's buildBuildingPopup
 *   interpolated them straight into HTML (Dayton_interactive_map MapContainer.tsx:305-355).
 *   Every value here goes through utils/html (escapeHtml via popupRow/popupTitle).
 *   It was deliberately NOT ported.
 */
import type { PopupBuilder } from '../CityProfile';
import { popupRow, popupTitle } from '../../utils/html';

/** Trim a tile property to a display string ('' for null/blank). O(n) time, O(n) space — n = value length. */
function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

/**
 * Neighborhood name and its priority-board area (when the source carries one).
 * O(n) time, O(n) space — n = total length of the shown values.
 */
export const neighborhoodPopup: PopupBuilder = (properties) =>
  popupTitle(text(properties.name) || 'Neighborhood') +
  popupRow('Priority board:', text(properties.priority_board)) +
  popupRow('Type:', 'City of Dayton neighborhood');

/**
 * Dayton PD area: the full name, plus the short key when it adds information.
 * O(n) time, O(n) space — n = total length of the shown values.
 */
export const policePrecinctPopup: PopupBuilder = (properties) => {
  const name = text(properties.name);
  const key = text(properties.precinct);
  return (
    popupTitle(name || `${key} District`) +
    popupRow('Area:', key && key !== name ? key : '') +
    popupRow('Agency:', 'Dayton Police Department')
  );
};

export const DAYTON_POPUPS: Readonly<Record<string, PopupBuilder>> = {
  'neighborhoods-fill': neighborhoodPopup,
  'police_precincts-fill': policePrecinctPopup,
};
