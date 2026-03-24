import React, { useCallback, useEffect, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { THEME } from '../../utils/colorSchemes';

const LEGEND_ITEMS = [
  { label: 'Residential', color: '#22c55e', key: 'R', zonePrefix: 'R' },
  { label: 'Commercial / Business', color: '#ef4444', key: 'C/B', zonePrefix: 'C' },
  { label: 'Manufacturing / Industrial', color: '#f59e0b', key: 'M', zonePrefix: 'M' },
  { label: 'Downtown / Mixed Use', color: '#a855f7', key: 'D', zonePrefix: 'D' },
  { label: 'Planned / Institutional', color: '#3b82f6', key: 'P', zonePrefix: 'P' },
  { label: 'Government-Owned', color: '#06b6d4', key: 'GOV', zonePrefix: null },
  { label: 'Has Interior Map', color: '#0d9488', key: 'INT', zonePrefix: null },
  { label: 'Other / Unknown', color: '#334155', key: '—', zonePrefix: null },
];

const styles = {
  container: {
    position: 'fixed' as const,
    bottom: '32px',
    left: '12px',
    zIndex: 10,
    background: THEME.bg,
    border: `1px solid ${THEME.border}`,
    borderRadius: '8px',
    padding: '10px 14px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.4)',
    maxWidth: '200px',
    fontSize: '11px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '6px',
  },
  title: {
    color: THEME.text,
    fontWeight: 600 as const,
    fontSize: '12px',
    margin: 0,
  },
  toggleBtn: {
    background: 'none',
    border: 'none',
    color: THEME.textMuted,
    fontSize: '14px',
    cursor: 'pointer',
    padding: '0 4px',
    lineHeight: 1,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '2px 0',
  },
  swatch: {
    width: '12px',
    height: '12px',
    borderRadius: '3px',
    flexShrink: 0 as const,
  },
  label: {
    color: THEME.textMuted,
  },
  collapsed: {
    position: 'fixed' as const,
    bottom: '32px',
    left: '12px',
    zIndex: 10,
    background: THEME.bg,
    border: `1px solid ${THEME.border}`,
    borderRadius: '6px',
    padding: '6px 12px',
    fontSize: '11px',
    color: THEME.textMuted,
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.4)',
  },
} as const;

interface BuildingLegendProps {
  map?: maplibregl.Map | null;
}

const BUILDING_LAYER_IDS = [
  'buildings-fill', 'buildings-stroke', 'buildings-interior-stroke',
  'buildings-highlight', 'buildings-label',
];

export const BuildingLegend: React.FC<BuildingLegendProps> = ({ map }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());

  const toggleType = useCallback((key: string) => {
    setHiddenTypes(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Apply building filter when hidden types change
  useEffect(() => {
    if (!map) return;

    for (const layerId of BUILDING_LAYER_IDS) {
      try {
        if (!map.getLayer(layerId)) continue;

        if (hiddenTypes.size === 0) {
          // Show all — just the is_hidden filter
          map.setFilter(layerId, ['==', ['get', 'is_hidden'], false]);
        } else {
          // Build exclusion filter based on zoning_code prefix
          const conditions: unknown[] = [['==', ['get', 'is_hidden'], false]];

          for (const item of LEGEND_ITEMS) {
            if (!hiddenTypes.has(item.key)) continue;

            if (item.key === 'GOV') {
              conditions.push(['!=', ['get', 'owner_type'], 'government']);
            } else if (item.key === 'INT') {
              conditions.push(['!=', ['get', 'has_interior'], true]);
            } else if (item.key === '—') {
              // Can't easily filter "other" — skip
            } else if (item.key === 'C/B') {
              conditions.push(['!', ['any',
                ['==', ['slice', ['get', 'zoning_code'], 0, 1], 'C'],
                ['==', ['slice', ['get', 'zoning_code'], 0, 1], 'B'],
              ]]);
            } else if (item.zonePrefix) {
              conditions.push(['!=', ['slice', ['get', 'zoning_code'], 0, 1], item.zonePrefix]);
            }
          }

          map.setFilter(layerId, ['all', ...conditions] as unknown as maplibregl.FilterSpecification);
        }
      } catch { /* */ }
    }
  }, [map, hiddenTypes]);

  if (collapsed) {
    return (
      <button style={styles.collapsed} onClick={() => setCollapsed(false)}>
        Legend {hiddenTypes.size > 0 ? `(${hiddenTypes.size} hidden)` : ''}
      </button>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>Building Types</span>
        <button style={styles.toggleBtn} onClick={() => setCollapsed(true)} aria-label="Collapse legend">
          &times;
        </button>
      </div>
      {LEGEND_ITEMS.map((item) => (
        <label key={item.key} style={{ ...styles.row, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={!hiddenTypes.has(item.key)}
            onChange={() => toggleType(item.key)}
            style={{ accentColor: item.color, width: '11px', height: '11px', cursor: 'pointer' }}
          />
          <div style={{ ...styles.swatch, background: item.color, opacity: hiddenTypes.has(item.key) ? 0.3 : 1 }} />
          <span style={{ ...styles.label, opacity: hiddenTypes.has(item.key) ? 0.4 : 1 }}>{item.label}</span>
        </label>
      ))}
    </div>
  );
};
