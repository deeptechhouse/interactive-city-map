import React, { useCallback, useEffect } from 'react';
import type maplibregl from 'maplibre-gl';
import { THEME } from '../../utils/colorSchemes';
import { setSection } from '../../presets/searchState';
import { useSearchSection } from '../../presets/SearchStateContext';
import { CHICAGO_OWNERSHIP_TYPES, CHICAGO_RAILROAD_OWNERS } from '../../utils/railroadTaxonomy';
import { getCityProfile } from '../../cities/registry';
import type { TaxonomyEntry } from '../../cities/CityProfile';

interface RailroadFilterProps {
  map: maplibregl.Map | null;
  /** Current city — picks its owner / ownership-type lists (default Chicago). */
  citySlug?: string;
}

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
 * O(w) time, O(w) space — w = railroad owners (fixed taxonomy list).
 */
function buildOwnerFilter(activeOwners: ReadonlySet<string>, owners: readonly TaxonomyEntry[]): unknown[] | null {
  const allActive = activeOwners.size === owners.length;
  if (allActive) return null;

  if (activeOwners.size === 0) return null; // handled by hiding all layers

  const hasOther = activeOwners.has('_other');
  // O(w) time, O(w) space — w = active owners (≤ railroad owners)
  const specificOwners = [...activeOwners].filter((o) => o !== '_other');
  // O(w) time, O(w) space — w = railroad owners (filter, then map)
  const knownOwnerKeys = owners.filter((o) => o.key !== '_other').map((o) => o.key);

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

// Saved in presets — keys are persisted, never rename them. Values = VISIBLE keys.
// O(w) time, O(w) space — w = railroad owners
const OWNERS_SECTION = setSection('railroads.owners', CHICAGO_RAILROAD_OWNERS.map((o) => o.key), 'all');
// O(t) time, O(t) space — t = railroad statuses
const STATUSES_SECTION = setSection('railroads.statuses', RAILROAD_STATUSES.map((s) => s.key), 'all');
// O(y) time, O(y) space — y = ownership types
const OWNERSHIP_TYPES_SECTION = setSection('railroads.ownershipTypes', CHICAGO_OWNERSHIP_TYPES.map((t) => t.key), 'all');

type Section = ReturnType<typeof setSection>;
// Other cities' owner / ownership sections, created once per city (section identity
// matters to the search store). Chicago keeps the original preset keys above.
const CITY_SECTIONS = new Map<string, { owners: Section; types: Section }>();

/**
 * Preset sections for a city's railroad owner and ownership-type selections.
 * O(w + y) time, O(w + y) space — w = owners; y = ownership types (paid once per city).
 */
function railroadSections(
  citySlug: string,
  owners: readonly TaxonomyEntry[],
  types: readonly TaxonomyEntry[],
): { owners: Section; types: Section } {
  if (citySlug === 'chicago') return { owners: OWNERS_SECTION, types: OWNERSHIP_TYPES_SECTION };
  let sections = CITY_SECTIONS.get(citySlug);
  if (!sections) {
    sections = {
      // O(w) time, O(w) space — w = owners
      owners: setSection(`railroads.owners.${citySlug}`, owners.map((o) => o.key), 'all'),
      // O(y) time, O(y) space — y = ownership types
      types: setSection(`railroads.ownershipTypes.${citySlug}`, types.map((t) => t.key), 'all'),
    };
    CITY_SECTIONS.set(citySlug, sections);
  }
  return sections;
}

// O(w + t + y) time, O(w + t + y) space — w = railroad owners; t = statuses; y = ownership types (all fixed taxonomy lists)
export const RailroadFilter: React.FC<RailroadFilterProps> = ({ map, citySlug = 'chicago' }) => {
  // The city's own vocabularies (generated from its export); Chicago's lists otherwise.
  const profile = getCityProfile(citySlug);
  const RAILROAD_OWNERS = profile?.railroadOwners.length ? profile.railroadOwners : CHICAGO_RAILROAD_OWNERS;
  const OWNERSHIP_TYPES = profile?.railroadOwnershipTypes.length
    ? profile.railroadOwnershipTypes
    : CHICAGO_OWNERSHIP_TYPES;
  const sections = railroadSections(citySlug, RAILROAD_OWNERS, OWNERSHIP_TYPES);
  const [activeOwners, setActiveOwners] = useSearchSection(sections.owners);
  const [activeStatuses, setActiveStatuses] = useSearchSection(STATUSES_SECTION);
  const [activeOwnershipTypes, setActiveOwnershipTypes] = useSearchSection(sections.types);

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
  }, [setActiveOwners]);

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
  }, [setActiveStatuses]);

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
  }, [setActiveOwnershipTypes]);

  // Apply filters: status toggles visibility, owner + ownership_type toggle data filters
  useEffect(() => {
    if (!map) return;

    const ownerExpr = buildOwnerFilter(activeOwners, RAILROAD_OWNERS);
    const noOwnersSelected = activeOwners.size === 0;

    // Build ownership_type filter
    const allOwnershipActive = activeOwnershipTypes.size === OWNERSHIP_TYPES.length;
    const noOwnershipSelected = activeOwnershipTypes.size === 0;
    const ownershipExpr = (!allOwnershipActive && !noOwnershipSelected)
      ? ['in', ['get', 'owner_type'], ['literal', [...activeOwnershipTypes]]]
      : null;

    // O(t + w + y) time, O(w + y) space — t = statuses (one layer each); w = owners; y = ownership types (expressions built once, shared by reference)
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
        // O(t) time, O(1) space — t = railroad statuses
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
  }, [map, activeOwners, activeStatuses, activeOwnershipTypes, RAILROAD_OWNERS, OWNERSHIP_TYPES]);

  // O(w) time, O(w) space — w = railroad owners
  const ownerRows = RAILROAD_OWNERS.map((owner) => (
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
  ));
  // O(y) time, O(y) space — y = ownership types
  const ownershipRows = OWNERSHIP_TYPES.map((ot) => (
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
  ));
  // O(t) time, O(t) space — t = railroad statuses
  const statusRows = RAILROAD_STATUSES.map((status) => (
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
  ));

  return (
    <div style={styles.container}>
      {/* Owner filter */}
      <div style={styles.group}>
        <div style={styles.title}>By Owner</div>
        {ownerRows}
      </div>

      {/* Ownership type filter */}
      <div style={styles.group}>
        <div style={styles.title}>By Ownership</div>
        {ownershipRows}
      </div>

      {/* Status filter */}
      <div style={styles.group}>
        <div style={styles.title}>By Status</div>
        {statusRows}
      </div>
    </div>
  );
};
