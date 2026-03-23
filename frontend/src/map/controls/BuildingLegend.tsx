import React, { useState } from 'react';
import { THEME } from '../../utils/colorSchemes';

const LEGEND_ITEMS = [
  { label: 'Residential', color: '#22c55e', key: 'R' },
  { label: 'Commercial / Business', color: '#ef4444', key: 'C/B' },
  { label: 'Manufacturing / Industrial', color: '#f59e0b', key: 'M' },
  { label: 'Downtown / Mixed Use', color: '#a855f7', key: 'D' },
  { label: 'Planned / Institutional', color: '#3b82f6', key: 'P' },
  { label: 'Government-Owned', color: '#06b6d4', key: 'GOV' },
  { label: 'Has Interior Map', color: '#0d9488', key: 'INT' },
  { label: 'Other / Unknown', color: '#334155', key: '—' },
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

export const BuildingLegend: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <button style={styles.collapsed} onClick={() => setCollapsed(false)}>
        Legend
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
        <div key={item.key} style={styles.row}>
          <div style={{ ...styles.swatch, background: item.color }} />
          <span style={styles.label}>{item.label}</span>
        </div>
      ))}
    </div>
  );
};
