import React, { useCallback, useEffect, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { THEME, ZONING_COLORS } from '../../utils/colorSchemes';

interface ZoningFilterProps {
  map: maplibregl.Map | null;
}

const ZONE_CLASSES = [
  { key: 'manufacturing', label: 'Manufacturing', color: ZONING_COLORS.manufacturing },
  { key: 'commercial', label: 'Commercial', color: ZONING_COLORS.commercial },
  { key: 'residential', label: 'Residential', color: ZONING_COLORS.residential },
  { key: 'mixed', label: 'Mixed', color: ZONING_COLORS.mixed },
  { key: 'special', label: 'Special', color: ZONING_COLORS.special },
];

const styles = {
  container: {
    padding: '8px 12px',
    borderTop: `1px solid ${THEME.bgTertiary}`,
  },
  title: {
    fontSize: '10px',
    fontWeight: 600 as const,
    color: THEME.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    marginBottom: '6px',
  },
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '2px 0',
    fontSize: '11px',
    color: THEME.textMuted,
    cursor: 'pointer',
  },
  checkbox: {
    accentColor: THEME.accent,
    width: '11px',
    height: '11px',
    cursor: 'pointer',
  },
  colorDot: {
    width: '8px',
    height: '8px',
    borderRadius: '2px',
    flexShrink: 0 as const,
  },
} as const;

/** Layer IDs that belong to the zoning layer */
const ZONING_LAYER_IDS = [
  'zoning-fill',
  'zoning-stroke',
  'zoning-label',
];

export const ZoningFilter: React.FC<ZoningFilterProps> = ({ map }) => {
  const [activeClasses, setActiveClasses] = useState<Set<string>>(
    () => new Set(ZONE_CLASSES.map((z) => z.key)),
  );

  const toggleClass = useCallback((key: string) => {
    setActiveClasses((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  // Apply filter to map whenever selections change
  useEffect(() => {
    if (!map) return;

    const allActive = activeClasses.size === ZONE_CLASSES.length;

    for (const layerId of ZONING_LAYER_IDS) {
      try {
        if (map.getLayer(layerId)) {
          if (allActive) {
            map.setFilter(layerId, null);
          } else if (activeClasses.size === 0) {
            // Hide all
            map.setFilter(layerId, ['==', ['get', 'zone_class'], '__none__']);
          } else {
            const classList = [...activeClasses];
            map.setFilter(layerId, [
              'in',
              ['get', 'zone_class'],
              ['literal', classList],
            ]);
          }
        }
      } catch {
        // Layer may not exist
      }
    }
  }, [map, activeClasses]);

  return (
    <div style={styles.container}>
      <div style={styles.title}>By Zone Class</div>
      {ZONE_CLASSES.map((zone) => (
        <label key={zone.key} style={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={activeClasses.has(zone.key)}
            onChange={() => toggleClass(zone.key)}
            style={styles.checkbox}
          />
          <span style={{ ...styles.colorDot, background: zone.color }} />
          {zone.label}
        </label>
      ))}
    </div>
  );
};
