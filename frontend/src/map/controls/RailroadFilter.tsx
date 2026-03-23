import React, { useCallback, useEffect, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { THEME, RAILROAD_COLORS, RAILROAD_STATUS_STYLES } from '../../utils/colorSchemes';

interface RailroadFilterProps {
  map: maplibregl.Map | null;
}

const RAILROAD_OWNERS = [
  { key: 'BNSF', label: 'BNSF', color: RAILROAD_COLORS.BNSF },
  { key: 'CP', label: 'CP/CPKC', color: RAILROAD_COLORS.CP },
  { key: 'NS', label: 'Norfolk Southern', color: RAILROAD_COLORS.NS },
  { key: 'CSX', label: 'CSX', color: RAILROAD_COLORS.CSX },
  { key: 'CN', label: 'Canadian National', color: RAILROAD_COLORS.CN },
  { key: 'CTA', label: 'CTA', color: RAILROAD_COLORS.CTA },
  { key: '_other', label: 'Other', color: '#888888' },
];

const OWNERSHIP_TYPES = [
  { key: 'government_transit', label: 'Public Transit (CTA/Metra/NICTD)', color: '#06b6d4' },
  { key: 'government_passenger', label: 'Amtrak (Federal)', color: '#8b5cf6' },
  { key: 'city_owned', label: 'City of Chicago', color: '#ec4899' },
  { key: 'county_owned', label: 'Cook County', color: '#14b8a6' },
  { key: 'private_class1', label: 'Private — Class I', color: '#ef4444' },
  { key: 'private_terminal', label: 'Private — Terminal/Switching', color: '#f97316' },
  { key: 'private_shortline', label: 'Private — Short Line', color: '#eab308' },
  { key: 'private_industrial', label: 'Private — Industrial', color: '#78716c' },
  { key: 'unknown', label: 'Unknown Ownership', color: '#6b7280' },
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
  const [activeOwnershipTypes, setActiveOwnershipTypes] = useState<Set<string>>(
    () => new Set(OWNERSHIP_TYPES.map((t) => t.key)),
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

  const toggleOwnershipType = useCallback((key: string) => {
    setActiveOwnershipTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  // Apply filters: status toggles visibility, owner + ownership_type toggle data filters
  useEffect(() => {
    if (!map) return;

    const ownerExpr = buildOwnerFilter(activeOwners);
    const noOwnersSelected = activeOwners.size === 0;

    // Build ownership_type filter
    const allOwnershipActive = activeOwnershipTypes.size === OWNERSHIP_TYPES.length;
    const noOwnershipSelected = activeOwnershipTypes.size === 0;
    const ownershipExpr = (!allOwnershipActive && !noOwnershipSelected)
      ? ['in', ['get', 'owner_type'], ['literal', [...activeOwnershipTypes]]]
      : null;

    for (const status of RAILROAD_STATUSES) {
      const layerId = `railroads-${status.key}`;
      try {
        if (!map.getLayer(layerId)) continue;

        const visible = activeStatuses.has(status.key) && !noOwnersSelected && !noOwnershipSelected;
        map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');

        // Combine: status + owner + ownership_type
        const conditions: unknown[] = [['==', ['get', 'status'], status.key]];
        if (ownerExpr) conditions.push(ownerExpr);
        if (ownershipExpr) conditions.push(ownershipExpr);

        const filter = conditions.length === 1 ? conditions[0] : ['all', ...conditions];
        map.setFilter(layerId, filter as unknown as maplibregl.FilterSpecification);
      } catch { /* */ }
    }

    // Labels
    try {
      if (map.getLayer('railroads-label')) {
        const anyVisible = !noOwnersSelected && !noOwnershipSelected && RAILROAD_STATUSES.some(s => activeStatuses.has(s.key));
        map.setLayoutProperty('railroads-label', 'visibility', anyVisible ? 'visible' : 'none');

        const labelConditions: unknown[] = [];
        if (ownerExpr) labelConditions.push(ownerExpr);
        if (ownershipExpr) labelConditions.push(ownershipExpr);

        if (labelConditions.length > 0) {
          const labelFilter = labelConditions.length === 1 ? labelConditions[0] : ['all', ...labelConditions];
          map.setFilter('railroads-label', labelFilter as unknown as maplibregl.FilterSpecification);
        } else {
          map.setFilter('railroads-label', null);
        }
      }
    } catch { /* */ }
  }, [map, activeOwners, activeStatuses, activeOwnershipTypes]);

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

      {/* Ownership type filter */}
      <div style={styles.group}>
        <div style={styles.title}>By Ownership</div>
        {OWNERSHIP_TYPES.map((ot) => (
          <label key={ot.key} style={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={activeOwnershipTypes.has(ot.key)}
              onChange={() => toggleOwnershipType(ot.key)}
              style={styles.checkbox}
            />
            <span style={{ ...styles.colorDot, background: ot.color }} />
            {ot.label}
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
