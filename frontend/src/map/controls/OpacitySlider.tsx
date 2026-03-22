import React from 'react';

interface OpacitySliderProps {
  id: string;
  opacity: number;
  onOpacityChange: (id: string, value: number) => void;
}

export const OpacitySlider: React.FC<OpacitySliderProps> = ({
  id,
  opacity,
  onOpacityChange,
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onOpacityChange(id, parseFloat(e.target.value) / 100);
  };

  return (
    <div className="opacity-slider">
      <input
        type="range"
        min="0"
        max="100"
        value={Math.round(opacity * 100)}
        onChange={handleChange}
        className="opacity-slider__input"
        aria-label={`Opacity for ${id}`}
      />
      <span className="opacity-slider__value">{Math.round(opacity * 100)}%</span>
    </div>
  );
};
