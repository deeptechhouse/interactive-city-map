/**
 * DETROIT_PROFILE — the Detroit CityProfile, assembled from the sibling modules.
 *
 * FLOW
 *   App → getCityProfile('detroit') → DETROIT_PROFILE
 *     .layers()/.devSources()/.staticAssets → useMapLayers → MapContainer
 *     .popups                               → useMapClick
 *     .zoning / .railroadOwners / .transitColors → ZoningFilter, RailroadFilter, TransitLayer
 *     .focus                                → useFocusArea
 *     .contacts                             → ContactResolver
 *
 * DATA: static files under public/data/detroit/ are built by
 *   backend/scripts/export_city_static.py (plan: app/data_import/detroit/static_plan.py).
 */
import type { CityProfile } from '../CityProfile';
import { detroitDevSources, detroitLayerStates, detroitStaticSources } from './layers';
import { DETROIT_POPUPS } from './popups';
import { DETROIT_ZONE_CLASSES } from './zoning';
import {
  DETROIT_POI_CATEGORY_COUNTS,
  DETROIT_RAILROAD_OWNERS,
  DETROIT_RAILROAD_OWNERSHIP_TYPES,
  DETROIT_TRANSIT_COLORS,
} from './taxonomies';
import { DETROIT_FOCUS } from './focus';
import { detroitContactSources } from './contacts';
import { IS_STATIC } from '../../utils/staticMode';

export const DETROIT_PROFILE: CityProfile = {
  slug: 'detroit',
  name: 'Detroit',
  state: 'MI',
  county: 'Wayne County',
  // Same values as backend/app/data_import/configs/detroit.yaml — keep in sync.
  center: [-83.0458, 42.3314],
  defaultZoom: 11,
  bounds: [[-83.3, 42.2], [-82.9, 42.5]],

  // O(l) time, O(l) space — l = Detroit layers
  layers: () => detroitLayerStates(IS_STATIC),
  devSources: detroitDevSources,
  staticAssets: {
    basemapPmtiles: './data/detroit/basemap.pmtiles',
    layerPmtiles: detroitStaticSources(),
  },

  popups: DETROIT_POPUPS,
  // Detroit parks are their own tile layer, not Chicago's `parcels` (see layers.ts TRAPS).
  sourceLayers: { parks: 'parks' },
  zoning: DETROIT_ZONE_CLASSES,
  railroadOwners: DETROIT_RAILROAD_OWNERS,
  railroadOwnershipTypes: DETROIT_RAILROAD_OWNERSHIP_TYPES,
  transitColors: DETROIT_TRANSIT_COLORS,
  poiCategoryCounts: DETROIT_POI_CATEGORY_COUNTS,

  focus: DETROIT_FOCUS,
  contacts: detroitContactSources(),
};
