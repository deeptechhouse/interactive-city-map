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

// Manufacturing sub-types (Chicago zoning code prefixes)
const MFG_SUBTYPES = [
  { key: 'M1', label: 'M1 — Limited Mfg/Business Park' },
  { key: 'M2', label: 'M2 — Light Manufacturing' },
  { key: 'M3', label: 'M3 — Heavy Manufacturing' },
  { key: 'PMD', label: 'PMD — Planned Mfg District' },
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
  const [activeMfgSubtypes, setActiveMfgSubtypes] = useState<Set<string>>(
    () => new Set(MFG_SUBTYPES.map((s) => s.key)),
  );

  const toggleClass = useCallback((key: string) => {
    setActiveClasses((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleMfgSubtype = useCallback((key: string) => {
    setActiveMfgSubtypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Apply filter
  useEffect(() => {
    if (!map) return;

    const allClassesActive = activeClasses.size === ZONE_CLASSES.length;
    const allMfgActive = activeMfgSubtypes.size === MFG_SUBTYPES.length;
    const mfgIsActive = activeClasses.has('manufacturing');

    for (const layerId of ZONING_LAYER_IDS) {
      try {
        if (!map.getLayer(layerId)) continue;

        if (allClassesActive && allMfgActive) {
          map.setFilter(layerId, null);
        } else if (activeClasses.size === 0) {
          map.setFilter(layerId, ['==', ['get', 'zone_class'], '__none__']);
        } else {
          // Build conditions
          const conditions: unknown[] = [];

          // Non-manufacturing classes: simple in-list
          const nonMfgClasses = [...activeClasses].filter(c => c !== 'manufacturing');
          if (nonMfgClasses.length > 0) {
            conditions.push(['in', ['get', 'zone_class'], ['literal', nonMfgClasses]]);
          }

          // Manufacturing: filter by sub-type (zone_code prefix)
          if (mfgIsActive && !allMfgActive && activeMfgSubtypes.size > 0) {
            // Match zone_code starting with selected prefixes
            const mfgConditions = [...activeMfgSubtypes].map(prefix => {
              if (prefix === 'PMD') {
                return ['==', ['slice', ['get', 'zone_code'], 0, 3], 'PMD'];
              }
              return ['==', ['slice', ['get', 'zone_code'], 0, 2], prefix];
            });
            if (mfgConditions.length === 1) {
              conditions.push(['all', ['==', ['get', 'zone_class'], 'manufacturing'], mfgConditions[0]]);
            } else {
              conditions.push(['all', ['==', ['get', 'zone_class'], 'manufacturing'], ['any', ...mfgConditions]]);
            }
          } else if (mfgIsActive) {
            conditions.push(['==', ['get', 'zone_class'], 'manufacturing']);
          }

          if (conditions.length === 0) {
            map.setFilter(layerId, ['==', ['get', 'zone_class'], '__none__']);
          } else if (conditions.length === 1) {
            map.setFilter(layerId, conditions[0] as unknown as maplibregl.FilterSpecification);
          } else {
            map.setFilter(layerId, ['any', ...conditions] as unknown as maplibregl.FilterSpecification);
          }
        }
      } catch { /* */ }
    }
  }, [map, activeClasses, activeMfgSubtypes]);

  const mfgActive = activeClasses.has('manufacturing');

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

      {/* Manufacturing sub-types — only show when manufacturing is active */}
      {mfgActive && (
        <div style={{ marginTop: '6px', paddingLeft: '8px', borderLeft: `2px solid ${ZONING_COLORS.manufacturing}` }}>
          <div style={{ ...styles.title, fontSize: '9px', marginBottom: '4px' }}>Manufacturing Sub-Type</div>
          {MFG_SUBTYPES.map((sub) => (
            <label key={sub.key} style={{ ...styles.checkboxRow, fontSize: '10px' }}>
              <input
                type="checkbox"
                checked={activeMfgSubtypes.has(sub.key)}
                onChange={() => toggleMfgSubtype(sub.key)}
                style={styles.checkbox}
              />
              {sub.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
};
