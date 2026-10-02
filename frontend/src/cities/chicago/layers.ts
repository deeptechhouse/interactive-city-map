/**
 * Chicago's layer list and tile sources — moved verbatim from map/hooks/useMapLayers.ts
 * (2026-10-02) so Chicago is one CityProfile among several.
 *
 * DO NOT "tidy" this list: Chicago is in daily research use, and
 * map/hooks/__tests__/createDefaultLayers.test.ts pins its ids, order, groups, visibility
 * and opacity exactly. Static sources keep Chicago's original flat files
 * (public/data/*.pmtiles); '' means the layer file falls back to its bundled GeoJSON.
 */
import type { LayerState } from '../../types/layer';
import { martinTileUrl } from '../../utils/geoUtils';

/**
 * Chicago's 15 layers in LayerPanel order.
 * O(l) time, O(l) space — l = layers (15).
 */
export function chicagoLayerStates(): LayerState[] {
  return [
    // Infrastructure
    { id: 'railroads', name: 'Railroads', group: 'infrastructure', visible: true, opacity: 1 },
    { id: 'transit', name: 'CTA Transit', group: 'infrastructure', visible: true, opacity: 1 },
    { id: 'waterways', name: 'Waterways', group: 'infrastructure', visible: true, opacity: 1 },
    // Zoning
    { id: 'zoning', name: 'Zoning Districts', group: 'zoning', visible: false, opacity: 1 },
    { id: 'buildings', name: 'Buildings', group: 'zoning', visible: true, opacity: 1 },
    // Points of Interest
    { id: 'pois', name: 'Points of Interest', group: 'poi', visible: true, opacity: 1 },
    // Streets
    { id: 'major_streets', name: 'Major Street Labels', group: 'infrastructure', visible: true, opacity: 1 },
    // Boundaries
    { id: 'zip_codes', name: 'Zip Codes', group: 'zoning', visible: false, opacity: 1 },
    // Historical
    { id: 'sanborn', name: 'Sanborn Maps', group: 'historical', visible: false, opacity: 0.7 },
    // Parks (Chicago's parcels table holds only parks — see the parks trap in cities/detroit)
    { id: 'parks', name: 'Parks & Green Space', group: 'parks', visible: true, opacity: 1 },
    // Chicago-only: embedded CPD / ward / gang / federal / Cook County RR data
    { id: 'police_districts', name: 'Police Districts', group: 'government', visible: false, opacity: 1 },
    { id: 'wards', name: 'City Wards', group: 'government', visible: false, opacity: 1 },
    { id: 'gang_territory', name: 'Gang Territory (CPD 2025)', group: 'safety', visible: false, opacity: 1 },
    { id: 'federal_properties', name: 'Federal Properties', group: 'government', visible: false, opacity: 1 },
    { id: 'railroad_row', name: 'Railroad Right-of-Way', group: 'infrastructure', visible: false, opacity: 1 },
  ];
}

/**
 * Dev-mode Martin URLs ('' = embedded data or no tile source).
 * O(1) time, O(1) space — k = fixed table of layer ids.
 */
export function chicagoDevSources(): Record<string, string> {
  return {
    railroads: martinTileUrl('railroads'),
    transit: martinTileUrl('transit_lines'),
    waterways: martinTileUrl('waterways'),
    zoning: martinTileUrl('zoning_districts'),
    buildings: martinTileUrl('buildings'),
    pois: martinTileUrl('pois'),
    major_streets: martinTileUrl('major_streets'),
    zip_codes: martinTileUrl('zip_codes'),
    sanborn: '',
    parks: martinTileUrl('parcels'),
    police_districts: '',
    wards: '',
    gang_territory: '',
    federal_properties: '',
    railroad_row: '',
  };
}

/**
 * Static-mode PMTiles (Chicago's original flat files). Unlisted layers → '' (bundled GeoJSON).
 * O(1) time, O(1) space — k = 4 tiled layers.
 */
export function chicagoStaticSources(): Record<string, string> {
  return {
    buildings: 'pmtiles://./data/buildings.pmtiles',
    zoning: 'pmtiles://./data/zoning_districts.pmtiles',
    parks: 'pmtiles://./data/parcels.pmtiles',
    railroads: 'pmtiles://./data/railroads.pmtiles',
  };
}
