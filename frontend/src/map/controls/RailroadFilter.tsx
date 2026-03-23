import React, { useCallback, useEffect, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { THEME, RAILROAD_COLORS, RAILROAD_STATUS_STYLES } from '../../utils/colorSchemes';

interface RailroadFilterProps {
  map: maplibregl.Map | null;
}

const RAILROAD_OWNERS = [
  { key: 'BNSF', label: 'BNSF', color: RAILROAD_COLORS.BNSF },
  { key: 'CP', label: 'CP/CPKC', color: RAILROAD_COLORS.CP },
  { key: 'NS', label: 'NS', color: RAILROAD_COLORS.NS },
  { key: 'CSX', label: 'CSX', color: RAILROAD_COLORS.CSX },
  { key: 'CN', label: 'CN', color: RAILROAD_COLORS.CN },
  { key: 'CTA', label: 'CTA', color: RAILROAD_COLORS.CTA },
  { key: '_other', label: 'Other', color: '#888888' },
];

const RAILROAD_STATUSES = [
  { key: 'active', label: 'Active', style: '━━━', color: '#22c55e' },
  { key: 'abandoned', label: 'Abandoned', style: '╌ ╌ ╌', color: '#ef4444' },
  { key: 'disused', label: 'Disused', style: '╍ ╍ ╍', color: '#f59e0b' },
  { key: 'spur', label: 'Spur', style: '───', color: '#8b949e' },
  { key: 'razed', label: 'Razed', style: '· · ·', color: '#6b7280' },
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
    borderRadius: '50%',
    flexShrink: 0 as const,
  },
  group: {
    marginBottom: '8px',
  },
} as const;

/**
 * Build an owner filter expression (returns just the owner part, no status).
 * Returns null when all owners selected (no filter needed).
 */
function buildOwnerFilter(activeOwners: Set<string>): unknown[] | null {
  const allActive = activeOwners.size === RAILROAD_OWNERS.length;
  if (allActive) return null;

  if (activeOwners.size === 0) return null; // handled by hiding all layers

  const hasOther = activeOwners.has('_other');
  const specificOwners = [...activeOwners].filter((o) => o !== '_other');
  const knownOwnerKeys = RAILROAD_OWNERS.filter((o) => o.key !== '_other').map((o) => o.key);

  if (hasOther && specificOwners.length > 0) {
    // Show selected owners + anything not in the known list
    return [
      'any',
      ['in', ['get', 'owner'], ['literal', specificOwners]],
      ['!', ['in', ['get', 'owner'], ['literal', knownOwnerKeys]]],
    ];
  } else if (hasOther) {
    // Show only unknown owners
    return ['!', ['in', ['get', 'owner'], ['literal', knownOwnerKeys]]];
  } else if (specificOwners.length > 0) {
    // Show only selected known owners
    return ['in', ['get', 'owner'], ['literal', specificOwners]];
  }
  return null;
}

export const RailroadFilter: React.FC<RailroadFilterProps> = ({ map }) => {
  const [activeOwners, setActiveOwners] = useState<Set<string>>(
    () => new Set(RAILROAD_OWNERS.map((o) => o.key)),
  );
  const [activeStatuses, setActiveStatuses] = useState<Set<string>>(
    () => new Set(RAILROAD_STATUSES.map((s) => s.key)),
  );

  const toggleOwner = useCallback((key: string) => {
    setActiveOwners((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const toggleStatus = useCallback((key: string) => {
    setActiveStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  // Apply filters: status toggles layer visibility, owner toggles data filter
  useEffect(() => {
    if (!map) return;

    const ownerExpr = buildOwnerFilter(activeOwners);
    const noOwnersSelected = activeOwners.size === 0;

    for (const status of RAILROAD_STATUSES) {
      const layerId = `railroads-${status.key}`;
      try {
        if (!map.getLayer(layerId)) continue;

        // Visibility: hide if status unchecked OR no owners selected
        const visible = activeStatuses.has(status.key) && !noOwnersSelected;
        map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');

        // Data filter: always include the status match, optionally add owner filter
        if (ownerExpr) {
          map.setFilter(layerId, [
            'all',
            ['==', ['get', 'status'], status.key],
            ownerExpr,
          ] as unknown as maplibregl.FilterSpecification);
        } else {
          // No owner filter — just the original status filter
          map.setFilter(layerId, [
            '==', ['get', 'status'], status.key,
          ] as unknown as maplibregl.FilterSpecification);
        }
      } catch {
        // Layer may not exist yet
      }
    }

    // Label layer visibility
    try {
      if (map.getLayer('railroads-label')) {
        const anyVisible = !noOwnersSelected && RAILROAD_STATUSES.some(s => activeStatuses.has(s.key));
        map.setLayoutProperty('railroads-label', 'visibility', anyVisible ? 'visible' : 'none');

        // Apply owner filter to labels too
        if (ownerExpr) {
          map.setFilter('railroads-label', ownerExpr as unknown as maplibregl.FilterSpecification);
        } else {
          map.setFilter('railroads-label', null);
        }
      }
    } catch { /* */ }
  }, [map, activeOwners, activeStatuses]);

  return (
    <div style={styles.container}>
      {/* Owner filter */}
      <div style={styles.group}>
        <div style={styles.title}>By Owner</div>
        {RAILROAD_OWNERS.map((owner) => (
          <label key={owner.key} style={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={activeOwners.has(owner.key)}
              onChange={() => toggleOwner(owner.key)}
              style={styles.checkbox}
            />
            <span style={{ ...styles.colorDot, background: owner.color }} />
            {owner.label}
          </label>
        ))}
      </div>

      {/* Status filter */}
      <div style={styles.group}>
        <div style={styles.title}>By Status</div>
        {RAILROAD_STATUSES.map((status) => (
          <label key={status.key} style={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={activeStatuses.has(status.key)}
              onChange={() => toggleStatus(status.key)}
              style={styles.checkbox}
            />
            <span style={{
              fontFamily: 'monospace',
              fontSize: '10px',
              color: status.color,
              letterSpacing: '1px',
              width: '36px',
              display: 'inline-block',
            }}>{status.style}</span>
            {status.label}
          </label>
        ))}
      </div>
    </div>
  );
};
