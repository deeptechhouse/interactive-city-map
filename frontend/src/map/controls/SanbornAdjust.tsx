import React, { useCallback, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { THEME } from '../../utils/colorSchemes';
import { setSanbornYear, getSanbornYears, nudgeSanborn, rotateSanborn, getRotation, scaleSanborn, getScale, resetSanbornOffset } from '../layers/SanbornOverlay';

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
  const [sheetNum, setSheetNum] = useState(1);
  const totalSheets = 59;

  const handleSheetChange = useCallback((num: number) => {
    if (!map || num < 1 || num > totalSheets) return;
    setSheetNum(num);
    setSanbornYear(map, `sheet-${num}`);
  }, [map]);

  const handleYearChange = useCallback((year: string) => {
    // kept for compatibility
  }, [map]);

  const handleNudge = useCallback((dlng: number, dlat: number) => {
    if (!map) return;
    nudgeSanborn(map, dlng, dlat);
  }, [map]);

  const [rotation, setRotation] = useState(0);
  const [scale, setScaleState] = useState(1.0);

  const handleRotate = useCallback((deg: number) => {
    if (!map) return;
    rotateSanborn(map, deg);
    setRotation(getRotation());
  }, [map]);

  const handleScale = useCallback((factor: number) => {
    if (!map) return;
    scaleSanborn(map, factor);
    setScaleState(getScale());
  }, [map]);

  const handleReset = useCallback(() => {
    if (!map) return;
    resetSanbornOffset();
    setRotation(0);
    setScaleState(1.0);
    setSanbornYear(map, `sheet-${sheetNum}`);
  }, [map, sheetNum]);

  if (!visible) return null;

  return (
    <div style={styles.panel}>
      <div style={styles.title}>Sanborn Map Controls</div>

      <div style={styles.section}>
        <span style={styles.label}>Sheet Browser (1906 Downtown)</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center' }}>
          <button style={styles.nudgeBtn} onClick={() => handleSheetChange(sheetNum - 1)} disabled={sheetNum <= 1}>◀</button>
          <span style={{ color: THEME.text, fontWeight: 600, fontSize: '14px', minWidth: '80px', textAlign: 'center' as const }}>
            Sheet {sheetNum} / {totalSheets}
          </span>
          <button style={styles.nudgeBtn} onClick={() => handleSheetChange(sheetNum + 1)} disabled={sheetNum >= totalSheets}>▶</button>
        </div>
        <input
          type="range" min="1" max={totalSheets} value={sheetNum}
          onChange={(e) => handleSheetChange(parseInt(e.target.value))}
          style={{ width: '100%', marginTop: '4px', accentColor: THEME.accent }}
        />
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
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Rotate ({Math.round(rotation)}°)</span>
        <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
          <button style={styles.nudgeBtn} onClick={() => handleRotate(-5)} title="Rotate 5° CCW">↺ 5°</button>
          <button style={styles.nudgeBtn} onClick={() => handleRotate(-1)} title="Rotate 1° CCW">↺ 1°</button>
          <button style={styles.nudgeBtn} onClick={() => handleRotate(1)} title="Rotate 1° CW">↻ 1°</button>
          <button style={styles.nudgeBtn} onClick={() => handleRotate(5)} title="Rotate 5° CW">↻ 5°</button>
        </div>
        <div style={{ display: 'flex', gap: '4px', justifyContent: 'center', marginTop: '4px' }}>
          <button style={styles.nudgeBtn} onClick={() => handleRotate(90)} title="Rotate 90° CW">↻ 90°</button>
          <button style={styles.nudgeBtn} onClick={() => handleRotate(180)} title="Rotate 180°">180°</button>
        </div>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Scale ({Math.round(scale * 100)}%)</span>
        <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
          <button style={styles.nudgeBtn} onClick={() => handleScale(0.9)} title="Shrink 10%">−</button>
          <button style={styles.nudgeBtn} onClick={() => handleScale(0.95)} title="Shrink 5%">−5%</button>
          <button style={styles.nudgeBtn} onClick={() => handleScale(1.05)} title="Grow 5%">+5%</button>
          <button style={styles.nudgeBtn} onClick={() => handleScale(1.1)} title="Grow 10%">+</button>
        </div>
      </div>

      <button style={styles.resetBtn} onClick={handleReset}>Reset All</button>

      <div style={styles.hint}>
        Browse sheets with ◀▶ or slider. Nudge, rotate, scale to align with modern streets.
      </div>
    </div>
  );
};
