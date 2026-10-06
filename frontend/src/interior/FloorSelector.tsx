import React from 'react';
import { THEME } from '../utils/colorSchemes';

interface FloorSelectorProps {
  levels: number[];
  selectedLevel: number;
  onLevelChange: (level: number) => void;
}

// O(1) time, O(1) space
const formatLevel = (level: number): string => {
  if (level < 0) return `B${Math.abs(level)}`;
  if (level === 0) return 'G';
  return `${level}F`;
};

const styles = {
  container: {
    position: 'absolute' as const,
    left: '16px',
    top: '50%',
    transform: 'translateY(-50%)',
    zIndex: 50,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
  },
  pill: {
    minWidth: '36px',
    padding: '6px 10px',
    borderRadius: '18px',
    border: 'none',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 600,
    textAlign: 'center' as const,
    lineHeight: '1',
    transition: 'background 0.15s, color 0.15s',
  },
} as const;

// O(n log n) time, O(n) space — n = floor levels in the building (per render: sorted copy + one button each)
export const FloorSelector: React.FC<FloorSelectorProps> = ({
  levels,
  selectedLevel,
  onLevelChange,
}) => {
  const sorted = [...levels].sort((a, b) => b - a);

  // O(n) time, O(n) space — n = floor levels (one button each)
  const pills = sorted.map((level) => {
    const isSelected = level === selectedLevel;
    return (
      <button
        key={level}
        style={{
          ...styles.pill,
          background: isSelected ? THEME.accent : THEME.bgSecondary,
          color: isSelected ? '#fff' : THEME.textMuted,
        }}
        onClick={() => onLevelChange(level)}
      >
        {formatLevel(level)}
      </button>
    );
  });

  return <div style={styles.container}>{pills}</div>;
};
