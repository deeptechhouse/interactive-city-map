/**
 * DAYTON_PROFILE — the Dayton, OH CityProfile, assembled from the sibling modules.
 *
 * PURPOSE
 *   Dayton used to be a separate fork (../Dayton_interactive_map, forked from an early
 *   Chicago commit). This profile is how Dayton joins the one shared app instead: every
 *   Dayton difference lives under src/cities/dayton/, and shared code asks the profile.
 *   See docs/dayton_parity/dayton_tdd.html.
 *
 * FLOW (after Detroit plan Phase 4 wires the registry; Dayton plan D4):
 *   App → getCityProfile('dayton') → DAYTON_PROFILE
 *     .layers()/.devSources()/.staticAssets → useMapLayers → MapContainer
 *     .popups                               → useMapClick
 *     .zoning / .railroadOwners / .transitColors → ZoningFilter, RailroadFilter, TransitLayer
 *     .focus                                → useFocusArea
 *     .contacts                             → ContactResolver.forCity
 *
 * STATUS — implemented 2026-10-02 (static data built under public/data/dayton/). Focus
 *   (zip / police area / neighborhood) and contacts (Montgomery County Auditor owners +
 *   OSM businesses) are wired.
 *
 * MODULARITY: this file must import only from ../CityProfile, shared utils, and
 *   ./ siblings — never from ../chicago or ../detroit. A Dayton-only build
 *   (VITE_CITIES=dayton, see ../packs.ts) must not pull another city's code or data.
 */
import type { CityProfile } from '../CityProfile';
import { daytonDevSources, daytonLayerStates, daytonStaticSources } from './layers';
import { DAYTON_POPUPS } from './popups';
import { DAYTON_ZONE_CLASSES } from './zoning';
import {
  DAYTON_POI_CATEGORY_COUNTS,
  DAYTON_RAILROAD_OWNERS,
  DAYTON_RAILROAD_OWNERSHIP_TYPES,
  DAYTON_TRANSIT_COLORS,
} from './taxonomies';
import { IS_STATIC } from '../../utils/staticMode';
import { DAYTON_FOCUS } from './focus';
import { daytonContactSources } from './contacts';

export const DAYTON_PROFILE: CityProfile = {
  slug: 'dayton',
  name: 'Dayton',
  state: 'OH',
  county: 'Montgomery County',
  // Same values as backend/app/data_import/configs/dayton.yaml and the fork's
  // geoUtils.DAYTON_CENTER — keep in sync.
  center: [-84.1916, 39.7589],
  defaultZoom: 12,
  // ADJUSTABLE: the city limit is ~[-84.31,39.69]–[-84.09,39.83]; this box adds margin
  // for Montgomery County context. Widening it grows every static PMTiles file.
  bounds: [[-84.35, 39.65], [-84.05, 39.85]],

  layers: () => daytonLayerStates(IS_STATIC),
  devSources: daytonDevSources,
  staticAssets: { basemapPmtiles: './data/dayton/basemap.pmtiles', layerPmtiles: daytonStaticSources() },

  popups: DAYTON_POPUPS,
  // Dayton tiles name parks 'parks' (Chicago's live in 'parcels').
  sourceLayers: { parks: 'parks' },
  zoning: DAYTON_ZONE_CLASSES,
  railroadOwners: DAYTON_RAILROAD_OWNERS,
  railroadOwnershipTypes: DAYTON_RAILROAD_OWNERSHIP_TYPES,
  transitColors: DAYTON_TRANSIT_COLORS,
  poiCategoryCounts: DAYTON_POI_CATEGORY_COUNTS,

  focus: DAYTON_FOCUS,
  contacts: daytonContactSources(),
};
