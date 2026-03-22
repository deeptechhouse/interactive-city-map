import React, { useCallback, useEffect, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { THEME, RAILROAD_COLORS } from '../../utils/colorSchemes';

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
  { key: 'active', label: 'Active' },
  { key: 'abandoned', label: 'Abandoned' },
  { key: 'disused', label: 'Disused' },
  { key: 'spur', label: 'Spur' },
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
 * Build a MapLibre filter expression from the active owner and status selections.
 * Returns undefined when no filter is needed (all selected).
 * Uses `unknown` return type to satisfy MapLibre's complex FilterSpecification union.
 */
function buildRailroadFilter(
  activeOwners: Set<string>,
  activeStatuses: Set<string>,
): unknown | null {
  const allOwnersActive = activeOwners.size === RAILROAD_OWNERS.length;
  const allStatusesActive = activeStatuses.size === RAILROAD_STATUSES.length;

  if (allOwnersActive && allStatusesActive) {
    return null; // No filter needed
  }

  const conditions: unknown[] = [];

  // Owner filter
  if (!allOwnersActive) {
    const hasOther = activeOwners.has('_other');
    const specificOwners = [...activeOwners].filter((o) => o !== '_other');
    const knownOwnerKeys = RAILROAD_OWNERS.filter((o) => o.key !== '_other').map((o) => o.key);

    if (hasOther && specificOwners.length > 0) {
      conditions.push([
        'any',
        ['in', ['get', 'owner'], ['literal', specificOwners]],
        ['!', ['in', ['get', 'owner'], ['literal', knownOwnerKeys]]],
      ]);
    } else if (hasOther) {
      conditions.push(['!', ['in', ['get', 'owner'], ['literal', knownOwnerKeys]]]);
    } else if (specificOwners.length > 0) {
      conditions.push(['in', ['get', 'owner'], ['literal', specificOwners]]);
    } else {
      // Nothing selected — hide all
      return ['==', ['get', 'owner'], '__none__'];
    }
  }

  // Status filter
  if (!allStatusesActive) {
    const statusList = [...activeStatuses];
    if (statusList.length === 0) {
      return ['==', ['get', 'status'], '__none__'];
    }
    conditions.push(['in', ['get', 'status'], ['literal', statusList]]);
  }

  if (conditions.length === 0) return null;
  if (conditions.length === 1) return conditions[0];
  return ['all', ...conditions];
}

/** Layer IDs that belong to the railroad layer */
const RAILROAD_LAYER_IDS = [
  'railroads-line',
  'railroads-casing',
  'railroads-label',
];

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

  // Apply filter to map whenever selections change
  useEffect(() => {
    if (!map) return;

    const filter = buildRailroadFilter(activeOwners, activeStatuses);

    for (const layerId of RAILROAD_LAYER_IDS) {
      try {
        if (map.getLayer(layerId)) {
          map.setFilter(layerId, (filter ?? null) as maplibregl.FilterSpecification | null);
        }
      } catch {
        // Layer may not exist
      }
    }
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
            {status.label}
          </label>
        ))}
      </div>
    </div>
  );
};
