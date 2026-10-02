/**
 * CHICAGO_PROFILE — Chicago as a CityProfile. Every value delegates to the code Chicago
 * already used before profiles existed, so selecting Chicago behaves exactly as before:
 * same layers (pinned by createDefaultLayers.test.ts), same Martin/PMTiles sources, same
 * basemap file, same zoning catalogue, CTA colours, railroad lists, focus areas and
 * Cook County / City of Chicago contact sources.
 *
 * Chicago-only map layers (police districts, wards, gang territory, federal properties,
 * railroad right-of-way) still use their embedded GeoJSON and MapContainer's built-in
 * popups, so `popups` here is empty.
 */
import type { CityProfile } from '../CityProfile';
import { chicagoDevSources, chicagoLayerStates, chicagoStaticSources } from './layers';
import { ZONE_CLASSES } from '../../utils/zoningTypes';
import { CTA_LINE_COLORS } from '../../utils/colorSchemes';
import { CHICAGO_OWNERSHIP_TYPES, CHICAGO_RAILROAD_OWNERS } from '../../utils/railroadTaxonomy';
import { AREA_OPTIONS, CHICAGO_BOUNDARIES, KIND_LABELS } from '../../focus/focusAreas';
import { ChicagoLicenseSource, CookCountyOwnerSource } from '../../contacts/publicRecords';
import { IL_SOS_SEARCH_URL } from '../../contacts/links';
import { CHICAGO_CENTER, CHICAGO_ZOOM } from '../../utils/geoUtils';

export const CHICAGO_PROFILE: CityProfile = {
  slug: 'chicago',
  name: 'Chicago',
  state: 'IL',
  county: 'Cook County',
  center: CHICAGO_CENTER,
  defaultZoom: CHICAGO_ZOOM,
  // Same box as the Chicago basemap extract (pmtiles show chicago-basemap.pmtiles).
  bounds: [[-88.0, 41.6], [-87.5, 42.1]],

  layers: chicagoLayerStates,
  devSources: chicagoDevSources,
  staticAssets: { basemapPmtiles: './data/chicago-basemap.pmtiles', layerPmtiles: chicagoStaticSources() },

  popups: {},
  zoning: ZONE_CLASSES,
  railroadOwners: CHICAGO_RAILROAD_OWNERS,
  railroadOwnershipTypes: CHICAGO_OWNERSHIP_TYPES,
  transitColors: CTA_LINE_COLORS,
  poiCategoryCounts: {},

  focus: {
    loadBoundaries: () => Promise.resolve(CHICAGO_BOUNDARIES),
    optionsFor: () => AREA_OPTIONS,
    kindLabels: KIND_LABELS,
  },
  contacts: {
    owners: new CookCountyOwnerSource(),
    businesses: new ChicagoLicenseSource(),
    postalCity: 'CHICAGO',
    postalState: 'IL',
    corporationSearchUrl: () => IL_SOS_SEARCH_URL,
  },
};
