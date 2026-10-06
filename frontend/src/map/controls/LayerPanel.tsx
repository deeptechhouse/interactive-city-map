import React, { useState } from 'react';
import type { LayerGroup } from '../../types/layer';
import { GroupToggle } from './GroupToggle';
import type { UseMapLayersReturn } from '../hooks/useMapLayers';

interface LayerPanelProps {
  layerControls: UseMapLayersReturn;
  /** Extra controls shown under the layer groups — the railroad / zoning filters
   * (SubFilterPanel). Moved here 2026-10-02: as separate columns they squeezed the map. */
  children?: React.ReactNode;
}

/**
 * Left sidebar: layer groups, then the per-layer filters (children).
 *
 * Closing the panel HIDES it rather than unmounting it, because the filters keep their
 * state in React — unmounting would silently reset e.g. the zoning-type selection while
 * the map still showed it filtered.
 */
// O(l) time, O(l) space — l = layers for the city (getLayersByGroup buckets them, then each group renders its own)
export const LayerPanel: React.FC<LayerPanelProps> = ({ layerControls, children }) => {
  const [collapsed, setCollapsed] = useState(false);

  const { toggleLayer, setOpacity, toggleGroup, getLayersByGroup, groupLabels } = layerControls;

  const groupedLayers = getLayersByGroup();
  const groupOrder: LayerGroup[] = ['infrastructure', 'zoning', 'poi', 'government', 'safety', 'historical', 'parks'];

  // O(1) time, O(1) space
  // O(g) time, O(g) space — g = 7 layer groups (the fixed groupOrder list); the per-layer
  // work happens inside each GroupToggle, so a whole panel render is O(l) — l = layers.
  const groupToggles = groupOrder.map((group) => {
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
  });

  return (
    <>
      {collapsed && (
        <button className="layer-panel__toggle-btn" onClick={() => setCollapsed(false)} aria-label="Open layer panel">
          Layers
        </button>
      )}
      <aside className="layer-panel" role="complementary" aria-label="Map layers" hidden={collapsed}>
        <div className="layer-panel__header">
          <h2 className="layer-panel__title">Layers</h2>
          <button className="layer-panel__close" onClick={() => setCollapsed(true)} aria-label="Close layer panel">
            &times;
          </button>
        </div>
        <div className="layer-panel__content">
          {groupToggles}
          {children}
        </div>
      </aside>
    </>
  );
};
