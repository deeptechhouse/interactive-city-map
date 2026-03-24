import React, { useState } from 'react';
import type { LayerGroup } from '../../types/layer';
import { GroupToggle } from './GroupToggle';
import type { UseMapLayersReturn } from '../hooks/useMapLayers';

interface LayerPanelProps {
  layerControls: UseMapLayersReturn;
}

export const LayerPanel: React.FC<LayerPanelProps> = ({ layerControls }) => {
  const [collapsed, setCollapsed] = useState(false);

  const {
    toggleLayer,
    setOpacity,
    toggleGroup,
    getLayersByGroup,
    groupLabels,
  } = layerControls;

  const groupedLayers = getLayersByGroup();
  const groupOrder: LayerGroup[] = [
    'infrastructure',
    'zoning',
    'poi',
    'government',
    'safety',
    'historical',
    'parks',
  ];

  if (collapsed) {
    return (
      <button
        className="layer-panel__toggle-btn"
        onClick={() => setCollapsed(false)}
        aria-label="Open layer panel"
      >
        Layers
      </button>
    );
  }

  return (
    <aside className="layer-panel" role="complementary" aria-label="Map layers">
      <div className="layer-panel__header">
        <h2 className="layer-panel__title">Layers</h2>
        <button
          className="layer-panel__close"
          onClick={() => setCollapsed(true)}
          aria-label="Close layer panel"
        >
          &times;
        </button>
      </div>
      <div className="layer-panel__content">
        {groupOrder.map((group) => {
          const layers = groupedLayers[group];
          if (layers.length === 0) return null;
          return (
            <GroupToggle
              key={group}
              group={group}
              label={groupLabels[group]}
              layers={layers}
              onToggleLayer={toggleLayer}
              onToggleGroup={toggleGroup}
              onOpacityChange={setOpacity}
            />
          );
        })}
      </div>
    </aside>
  );
};
