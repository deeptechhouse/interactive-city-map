import React, { useCallback, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { THEME } from '../../utils/colorSchemes';
import { setSanbornYear, getSanbornYears, nudgeSanborn, resetSanbornOffset } from '../layers/SanbornOverlay';

interface SanbornAdjustProps {
  map: maplibregl.Map | null;
  visible: boolean;
}

const NUDGE_STEP = 0.0005; // ~55 meters per click

const styles = {
  panel: {
    position: 'fixed' as const,
    top: '60px',
    right: '60px',
    zIndex: 20,
    background: THEME.bg,
    border: `1px solid ${THEME.border}`,
    borderRadius: '8px',
    padding: '12px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
    width: '200px',
    fontSize: '11px',
  },
  title: {
    color: THEME.text,
    fontWeight: 600 as const,
    fontSize: '12px',
    marginBottom: '8px',
  },
  section: {
    marginBottom: '10px',
  },
  label: {
    color: THEME.textMuted,
    fontSize: '10px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    marginBottom: '4px',
    display: 'block' as const,
  },
  yearBtn: {
    padding: '4px 8px',
    margin: '2px',
    borderRadius: '4px',
    border: `1px solid ${THEME.border}`,
    background: THEME.bgSecondary,
    color: THEME.textMuted,
    fontSize: '11px',
    cursor: 'pointer',
  },
  yearBtnActive: {
    background: THEME.accent,
    color: '#0d1117',
    borderColor: THEME.accent,
  },
  nudgeGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '3px',
    width: '120px',
    margin: '0 auto',
  },
  nudgeBtn: {
    padding: '6px',
    borderRadius: '4px',
    border: `1px solid ${THEME.border}`,
    background: THEME.bgSecondary,
    color: THEME.text,
    fontSize: '14px',
    cursor: 'pointer',
    textAlign: 'center' as const,
    lineHeight: 1,
  },
  resetBtn: {
    width: '100%',
    padding: '5px',
    marginTop: '6px',
    borderRadius: '4px',
    border: `1px solid ${THEME.border}`,
    background: THEME.bgTertiary,
    color: THEME.textMuted,
    fontSize: '10px',
    cursor: 'pointer',
  },
  hint: {
    color: THEME.textMuted,
    fontSize: '10px',
    marginTop: '6px',
    lineHeight: 1.4,
  },
} as const;

export const SanbornAdjust: React.FC<SanbornAdjustProps> = ({ map, visible }) => {
  const [activeYear, setActiveYear] = useState('1897');

  const handleYearChange = useCallback((year: string) => {
    if (!map) return;
    setActiveYear(year);
    resetSanbornOffset();
    setSanbornYear(map, year);
  }, [map]);

  const handleNudge = useCallback((dlng: number, dlat: number) => {
    if (!map) return;
    nudgeSanborn(map, dlng, dlat);
  }, [map]);

  const handleReset = useCallback(() => {
    if (!map) return;
    resetSanbornOffset();
    setSanbornYear(map, activeYear);
  }, [map, activeYear]);

  if (!visible) return null;

  const years = getSanbornYears();

  return (
    <div style={styles.panel}>
      <div style={styles.title}>Sanborn Map Controls</div>

      <div style={styles.section}>
        <span style={styles.label}>Year / Edition</span>
        <div style={{ display: 'flex', flexWrap: 'wrap' }}>
          {years.map(year => (
            <button
              key={year}
              style={{ ...styles.yearBtn, ...(activeYear === year ? styles.yearBtnActive : {}) }}
              onClick={() => handleYearChange(year)}
            >
              {year}
            </button>
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Adjust Position</span>
        <div style={styles.nudgeGrid}>
          <div />
          <button style={styles.nudgeBtn} onClick={() => handleNudge(0, NUDGE_STEP)} title="Move north">↑</button>
          <div />
          <button style={styles.nudgeBtn} onClick={() => handleNudge(-NUDGE_STEP, 0)} title="Move west">←</button>
          <button style={{ ...styles.nudgeBtn, fontSize: '10px' }} onClick={handleReset} title="Reset position">⟲</button>
          <button style={styles.nudgeBtn} onClick={() => handleNudge(NUDGE_STEP, 0)} title="Move east">→</button>
          <div />
          <button style={styles.nudgeBtn} onClick={() => handleNudge(0, -NUDGE_STEP)} title="Move south">↓</button>
          <div />
        </div>
        <button style={styles.resetBtn} onClick={handleReset}>Reset to Default</button>
      </div>

      <div style={styles.hint}>
        Use arrow buttons to nudge the overlay ~55m per click.
        Align Halsted St (-87.647) and Ashland Ave (-87.667) as benchmarks.
      </div>
    </div>
  );
};
