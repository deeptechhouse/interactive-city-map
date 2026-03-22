import React, { useState } from 'react';
import type { LayerGroup, LayerState } from '../../types/layer';
import { LayerToggle } from './LayerToggle';
import { OpacitySlider } from './OpacitySlider';

interface GroupToggleProps {
  group: LayerGroup;
  label: string;
  layers: LayerState[];
  onToggleLayer: (id: string) => void;
  onToggleGroup: (group: LayerGroup) => void;
  onOpacityChange: (id: string, value: number) => void;
}

export const GroupToggle: React.FC<GroupToggleProps> = ({
  group,
  label,
  layers,
  onToggleLayer,
  onToggleGroup,
  onOpacityChange,
}) => {
  const [expanded, setExpanded] = useState(true);
  const allVisible = layers.every((l) => l.visible);
  const someVisible = layers.some((l) => l.visible);

  return (
    <div className="group-toggle">
      <div className="group-toggle__header">
        <button
          className="group-toggle__expand"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`}
        >
          <span className={`group-toggle__chevron ${expanded ? 'group-toggle__chevron--open' : ''}`}>
            &#9656;
          </span>
        </button>
        <label className="group-toggle__label">
          <input
            type="checkbox"
            checked={allVisible}
            ref={(el) => {
              if (el) el.indeterminate = someVisible && !allVisible;
            }}
            onChange={() => onToggleGroup(group)}
            className="group-toggle__checkbox"
          />
          {label}
        </label>
      </div>
      {expanded && (
        <div className="group-toggle__layers">
          {layers.map((layer) => (
            <div key={layer.id} className="group-toggle__layer-item">
              <LayerToggle
                id={layer.id}
                name={layer.name}
                visible={layer.visible}
                onToggle={onToggleLayer}
              />
              {layer.visible && (
                <OpacitySlider
                  id={layer.id}
                  opacity={layer.opacity}
                  onOpacityChange={onOpacityChange}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
