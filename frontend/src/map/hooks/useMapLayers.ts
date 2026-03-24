import { useCallback, useMemo, useState } from 'react';
import type { LayerGroup, LayerState } from '../../types/layer';
import { LAYER_GROUP_LABELS } from '../../types/layer';
import { martinTileUrl } from '../../utils/geoUtils';
import { IS_STATIC } from '../../utils/staticMode';

/** Default layer definitions */
function createDefaultLayers(): LayerState[] {
  return [
    // Infrastructure
    {
      id: 'railroads',
      name: 'Railroads',
      group: 'infrastructure',
      visible: true,
      opacity: 1,
    },
    {
      id: 'transit',
      name: 'CTA Transit',
      group: 'infrastructure',
      visible: true,
      opacity: 1,
    },
    {
      id: 'waterways',
      name: 'Waterways',
      group: 'infrastructure',
      visible: true,
      opacity: 1,
    },
    // Zoning
    {
      id: 'zoning',
      name: 'Zoning Districts',
      group: 'zoning',
      visible: false,
      opacity: 1,
    },
    {
      id: 'buildings',
      name: 'Buildings',
      group: 'zoning',
      visible: true,
      opacity: 1,
    },
    // Points of Interest
    {
      id: 'pois',
      name: 'Points of Interest',
      group: 'poi',
      visible: true,
      opacity: 1,
    },
    // Streets
    {
      id: 'major_streets',
      name: 'Major Street Labels',
      group: 'infrastructure',
      visible: true,
      opacity: 1,
    },
    // Boundaries
    {
      id: 'zip_codes',
      name: 'Zip Codes',
      group: 'zoning',
      visible: false,
      opacity: 1,
    },
    // Historical
    {
      id: 'sanborn',
      name: 'Sanborn Maps',
      group: 'historical',
      visible: false,
      opacity: 0.7,
    },
    // Parks
    {
      id: 'parks',
      name: 'Parks & Green Space',
      group: 'parks',
      visible: true,
      opacity: 1,
    },
    // Government
    {
      id: 'police_districts',
      name: 'Police Districts',
      group: 'government',
      visible: false,
      opacity: 1,
    },
    {
      id: 'wards',
      name: 'City Wards',
      group: 'government',
      visible: false,
      opacity: 1,
    },
    // Public Safety
    {
      id: 'gang_territory',
      name: 'Gang Territory (CPD 2025)',
      group: 'safety',
      visible: false,
      opacity: 1,
    },
    {
      id: 'federal_properties',
      name: 'Federal Properties',
      group: 'government',
      visible: false,
      opacity: 1,
    },
    {
      id: 'railroad_row',
      name: 'Railroad Right-of-Way',
      group: 'infrastructure',
      visible: false,
      opacity: 1,
    },
  ];
}

/** Map layer IDs to their Martin tile source URLs (dev mode) or PMTiles/empty (static mode) */
export function getLayerSourceUrl(layerId: string): string {
  if (IS_STATIC) {
    // Static mode: large layers served as local PMTiles files
    const staticPmtiles: Record<string, string> = {
      buildings: 'pmtiles://./data/buildings.pmtiles',
      zoning: 'pmtiles://./data/zoning_districts.pmtiles',
      parks: 'pmtiles://./data/parcels.pmtiles',
    };
    if (staticPmtiles[layerId]) return staticPmtiles[layerId];

    // Medium layers will be embedded as GeoJSON (handled in individual layer files)
    // Return empty string so MapContainer skips the Martin tile source
    const staticGeojsonLayers = new Set([
      'railroads', 'transit', 'waterways', 'major_streets',
      'zip_codes', 'pois',
    ]);
    if (staticGeojsonLayers.has(layerId)) return '';

    // Sanborn, police_districts, wards, gang_territory, federal_properties, railroad_row
    // already return '' in dev mode — same in static mode
    return '';
  }

  // Dev mode: Martin vector tile server
  const sourceMap: Record<string, string> = {
    railroads: martinTileUrl('railroads'),
    transit: martinTileUrl('transit_lines'),
    waterways: martinTileUrl('waterways'),
    zoning: martinTileUrl('zoning_districts'),
    buildings: martinTileUrl('buildings'),
    pois: martinTileUrl('pois'),
    major_streets: martinTileUrl('major_streets'),
    zip_codes: martinTileUrl('zip_codes'),
    sanborn: '', // PMTiles URL, configured separately
    parks: martinTileUrl('parcels'),
    police_districts: '', // GeoJSON embedded in layer data
    wards: '', // GeoJSON embedded in layer data
    gang_territory: '', // GeoJSON embedded in layer data
    federal_properties: '', // GeoJSON embedded in layer data
    railroad_row: '', // GeoJSON embedded in layer data
  };
  return sourceMap[layerId] ?? '';
}

export interface UseMapLayersReturn {
  layers: LayerState[];
  toggleLayer: (id: string) => void;
  setOpacity: (id: string, value: number) => void;
  toggleGroup: (group: LayerGroup) => void;
  getLayersByGroup: () => Record<LayerGroup, LayerState[]>;
  groupLabels: Record<LayerGroup, string>;
}

export function useMapLayers(): UseMapLayersReturn {
  const [layers, setLayers] = useState<LayerState[]>(createDefaultLayers);

  const toggleLayer = useCallback((id: string) => {
    setLayers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
    );
  }, []);

  const setOpacity = useCallback((id: string, value: number) => {
    setLayers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, opacity: value } : l)),
    );
  }, []);

  const toggleGroup = useCallback((group: LayerGroup) => {
    setLayers((prev) => {
      const groupLayers = prev.filter((l) => l.group === group);
      const allVisible = groupLayers.every((l) => l.visible);
      return prev.map((l) =>
        l.group === group ? { ...l, visible: !allVisible } : l,
      );
    });
  }, []);

  const getLayersByGroup = useCallback((): Record<LayerGroup, LayerState[]> => {
    const groups: Record<LayerGroup, LayerState[]> = {
      infrastructure: [],
      zoning: [],
      poi: [],
      historical: [],
      parks: [],
      government: [],
      safety: [],
    };
    for (const layer of layers) {
      groups[layer.group].push(layer);
    }
    return groups;
  }, [layers]);

  const groupLabels = useMemo(() => LAYER_GROUP_LABELS, []);

  return {
    layers,
    toggleLayer,
    setOpacity,
    toggleGroup,
    getLayersByGroup,
    groupLabels,
  };
}
