import React from 'react';

interface LayerToggleProps {
  id: string;
  name: string;
  visible: boolean;
  onToggle: (id: string) => void;
}

export const LayerToggle: React.FC<LayerToggleProps> = ({
  id,
  name,
  visible,
  onToggle,
}) => {
  return (
    <label className="layer-toggle" htmlFor={`layer-${id}`}>
      <input
        id={`layer-${id}`}
        type="checkbox"
        checked={visible}
        onChange={() => onToggle(id)}
        className="layer-toggle__checkbox"
      />
      <span className="layer-toggle__label">{name}</span>
    </label>
  );
};
