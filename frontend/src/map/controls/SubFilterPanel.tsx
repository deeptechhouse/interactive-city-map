import React from 'react';
import type maplibregl from 'maplibre-gl';
import type { LayerState } from '../../types/layer';
import { RailroadFilter } from './RailroadFilter';
import { ZoningFilter } from './ZoningFilter';

interface SubFilterPanelProps {
  map: maplibregl.Map | null;
  layers: LayerState[];
}

/**
 * Container for sub-filter controls that appear when specific layers
 * are visible. Renders RailroadFilter and ZoningFilter when their
 * respective layers are turned on.
 */
export const SubFilterPanel: React.FC<SubFilterPanelProps> = ({ map, layers }) => {
  const railroadLayer = layers.find((l) => l.id === 'railroads');
  const zoningLayer = layers.find((l) => l.id === 'zoning');

  const showRailroad = railroadLayer?.visible ?? false;
  const showZoning = zoningLayer?.visible ?? false;

  if (!showRailroad && !showZoning) {
    return null;
  }

  return (
    <>
      {showRailroad && <RailroadFilter map={map} />}
      {showZoning && <ZoningFilter map={map} />}
    </>
  );
};
