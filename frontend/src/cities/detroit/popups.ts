/**
 * Click popups for Detroit layers. Today useMapClick.INTERACTIVE_LAYERS has no Detroit
 * layer ids, so neighborhoods / council districts / DLBA / blight / precincts are not
 * clickable at all (frontend audit 2026-10-02).
 *
 * SECURITY — every value comes from tile properties (open data, untrusted). Escape with
 *   the same HTML-escape helper MapContainer's popup builders use; never interpolate raw.
 *
 * STATUS — SKELETON.
 */
import type { PopupBuilder } from '../CityProfile';
import { notImplemented } from '../CityProfile';

/**
 * Neighborhood name + council district.
 * O(1) time, O(1) space — p = fixed property set.
 */
export const neighborhoodPopup: PopupBuilder = (properties) => notImplemented('neighborhoodPopup', properties);

/**
 * District number + council member.
 * O(1) time, O(1) space — p = fixed property set.
 */
export const councilDistrictPopup: PopupBuilder = (properties) => notImplemented('councilDistrictPopup', properties);

/**
 * DPD precinct number + station address.
 * O(1) time, O(1) space — p = fixed property set.
 */
export const policePrecinctPopup: PopupBuilder = (properties) => notImplemented('policePrecinctPopup', properties);

/**
 * Land Bank parcel: address, program (auction / own-it-now / side-lot), status, link to
 * buildingdetroit.org.
 * O(1) time, O(1) space — p = fixed property set.
 */
export const dlbaPopup: PopupBuilder = (properties) => notImplemented('dlbaPopup', properties);

/**
 * Blight ticket / commercial demolition: violation, date, disposition.
 * O(1) time, O(1) space — p = fixed property set.
 */
export const blightPopup: PopupBuilder = (properties) => notImplemented('blightPopup', properties);

export const DETROIT_POPUPS: Readonly<Record<string, PopupBuilder>> = {
  neighborhoods: neighborhoodPopup,
  council_districts: councilDistrictPopup,
  police_precincts: policePrecinctPopup,
  dlba_properties: dlbaPopup,
  abandoned_blight: blightPopup,
};
