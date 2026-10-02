/**
 * DETROIT_PROFILE — the Detroit CityProfile, assembled from the sibling modules.
 *
 * FLOW (after Phase 4 wiring):
 *   App → getCityProfile('detroit') → DETROIT_PROFILE
 *     .layers()/.devSources()/.staticAssets → useMapLayers → MapContainer
 *     .popups → useMapClick
 *     .zoning / .railroadOwners / .transitColors → ZoningFilter, RailroadFilter, TransitLayer
 *     .focus                                → useFocusArea
 *     .contacts                             → ContactResolver.forCity
 *
 * STATUS — SKELETON. `layers` / `devSources` throw until Phase 4; `contacts` and `focus`
 *   are null until Phases 6/5 so the UI shows "not available for Detroit yet" rather than
 *   wrong-city data.
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

  layers: () => detroitLayerStates(IS_STATIC),
  devSources: detroitDevSources,
  // O(l) time, O(l) space — l = Detroit layers (getter so the stub only throws when read).
  get staticAssets() {
    return { basemapPmtiles: './data/detroit/basemap.pmtiles', layerPmtiles: detroitStaticSources() };
  },

  popups: DETROIT_POPUPS,
  zoning: DETROIT_ZONE_CLASSES,
  railroadOwners: DETROIT_RAILROAD_OWNERS,
  railroadOwnershipTypes: DETROIT_RAILROAD_OWNERSHIP_TYPES,
  transitColors: DETROIT_TRANSIT_COLORS,
  poiCategoryCounts: DETROIT_POI_CATEGORY_COUNTS,

  focus: null, // → DETROIT_FOCUS (./focus) in Phase 5
  contacts: null, // → detroitContactSources() (./contacts) in Phase 6
};
