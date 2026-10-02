/**
 * Map markers for discovered buildings: a magenta dot inside a soft magenta halo, so a
 * curated set stands out from every other layer (amber = contact list, blue = focus
 * outline). Clicking a marker removes that building from the set — MapContainer routes
 * clicks on CANDIDATE_LAYER_IDS to the discovery hook instead of opening a popup.
 */
import type maplibregl from 'maplibre-gl';
import type { Candidate } from './discoveryQuery';

const SOURCE = 'discovery-candidates';
export const CANDIDATE_HALO = 'discovery-candidates-halo';
export const CANDIDATE_DOT = 'discovery-candidates-dot';
/** Click targets, most specific first (MapContainer / useMapClick). */
export const CANDIDATE_LAYER_IDS = [CANDIDATE_DOT, CANDIDATE_HALO] as const;

// ADJUSTABLE: marker colour — chosen to clash with nothing else on the map.
const COLOR = '#e040fb';

/** Candidates → GeoJSON points. O(c) time, O(c) space — c = candidates. */
function toGeoJson(candidates: readonly Candidate[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    // O(c) time, O(c) space — c = candidates.
    features: candidates.map((c) => ({
      type: 'Feature',
      properties: {
        key: c.key,
        address: c.address,
        businesses: c.businesses.length,
      },
      geometry: { type: 'Point', coordinates: c.lngLat },
    })),
  };
}

/** Add layers once, then just swap data. O(c) time, O(c) space — c = candidates. */
export function setCandidates(map: maplibregl.Map, candidates: readonly Candidate[]): void {
  const data = toGeoJson(candidates);
  const source = map.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined;
  if (source) {
    source.setData(data);
  } else {
    map.addSource(SOURCE, { type: 'geojson', data });
    map.addLayer({
      id: CANDIDATE_HALO,
      type: 'circle',
      source: SOURCE,
      paint: {
        // ADJUSTABLE: halo size — big enough to spot from a zoomed-out view.
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 9, 14, 16, 17, 24],
        'circle-color': COLOR,
        'circle-opacity': 0.18,
        'circle-stroke-color': COLOR,
        'circle-stroke-width': 2,
        'circle-stroke-opacity': 0.9,
      },
    });
    map.addLayer({
      id: CANDIDATE_DOT,
      type: 'circle',
      source: SOURCE,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 5, 17, 7],
        'circle-color': COLOR,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
      },
    });
  }
  // Keep above data layers and the focus mask so a marker is never hidden.
  map.moveLayer(CANDIDATE_HALO);
  map.moveLayer(CANDIDATE_DOT);
}
