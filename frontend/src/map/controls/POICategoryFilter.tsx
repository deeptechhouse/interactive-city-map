import React, { useCallback, useEffect, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { THEME } from '../../utils/colorSchemes';
import { setSection } from '../../presets/searchState';
import { useSearchSection } from '../../presets/SearchStateContext';
import { getCityProfile } from '../../cities/registry';

interface POICategoryFilterProps {
  map: maplibregl.Map | null;
  /** Current city — its profile supplies the per-category counts (default Chicago). */
  citySlug?: string;
}

const POI_CATEGORIES = [
  { key: 'church', label: 'Churches', color: '#ec4899', count: 691 },
  { key: 'gymnasium', label: 'Gyms & Fitness', color: '#ef4444', count: 220 },
  { key: 'hotel_event', label: 'Hotels & Events', color: '#f59e0b', count: 41 },
  { key: 'theater', label: 'Theaters', color: '#8b5cf6', count: 40 },
  { key: 'gallery', label: 'Galleries', color: '#a855f7', count: 39 },
  { key: 'museum', label: 'Museums', color: '#3b82f6', count: 32 },
  { key: 'music_studio', label: 'Music Studios', color: '#06b6d4', count: 23 },
  { key: 'community_center', label: 'Community Centers', color: '#14b8a6', count: 20 },
  { key: 'dance_studio', label: 'Dance Studios', color: '#f472b6', count: 19 },
  { key: 'park', label: 'Parks', color: '#22c55e', count: 18 },
  { key: 'music_venue', label: 'Music Venues', color: '#e11d48', count: 16 },
  { key: 'movie_theater', label: 'Movie Theaters', color: '#7c3aed', count: 14 },
  { key: 'recording_studio', label: 'Recording Studios', color: '#0ea5e9', count: 13 },
  { key: 'motel', label: 'Motels', color: '#eab308', count: 3 },
  { key: 'warehouse', label: 'Warehouses', color: '#78716c', count: 1 },
  { key: 'beer_garden', label: 'Beer Gardens', color: '#84cc16', count: 1 },
];

const styles = {
  container: {
    position: 'fixed' as const,
    top: '12px',
    left: '316px',
    zIndex: 10,
    background: THEME.bg,
    border: `1px solid ${THEME.border}`,
    borderRadius: '8px',
    padding: '10px 14px',
    boxShadow: '0 2px 12px rgba(0, 0, 0, 0.5)',
    maxWidth: '220px',
    maxHeight: '70vh',
    overflowY: 'auto' as const,
    fontSize: '11px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '8px',
  },
  title: {
    color: THEME.text,
    fontWeight: 600 as const,
    fontSize: '12px',
    margin: 0,
  },
  toggleAll: {
    background: 'none',
    border: 'none',
    color: THEME.accent,
    fontSize: '10px',
    cursor: 'pointer',
    padding: '2px 4px',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '2px 0',
    cursor: 'pointer',
    color: THEME.textMuted,
  },
  checkbox: {
    accentColor: THEME.accent,
    width: '11px',
    height: '11px',
    cursor: 'pointer',
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0 as const,
  },
  count: {
    marginLeft: 'auto',
    color: THEME.textMuted,
    fontSize: '10px',
  },
  collapsed: {
    position: 'fixed' as const,
    top: '12px',
    left: '316px',
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

// Saved in presets — the key is persisted, never rename it. Value = VISIBLE categories.
// O(k) time, O(k) space — k = POI categories (fixed list)
const ACTIVE_CATEGORIES_SECTION = setSection('pois.activeCategories', POI_CATEGORIES.map((c) => c.key), 'all');

// O(k) time, O(k) space — k = POI categories (fixed list, filter and rows rebuilt per change)
export const POICategoryFilter: React.FC<POICategoryFilterProps> = ({ map, citySlug = 'chicago' }) => {
  // Counts come from the city's export (cities/<slug>/taxonomies.ts). Chicago's profile has
  // none, so Chicago keeps the counts in POI_CATEGORIES above.
  const cityCounts = getCityProfile(citySlug)?.poiCategoryCounts ?? {};
  const hasCityCounts = Object.keys(cityCounts).length > 0;
  const [collapsed, setCollapsed] = useState(true);
  const [activeCategories, setActiveCategories] = useSearchSection(ACTIVE_CATEGORIES_SECTION);

  const toggleCategory = useCallback((key: string) => {
    setActiveCategories(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, [setActiveCategories]);

  const toggleAll = useCallback(() => {
    setActiveCategories(prev => {
      if (prev.size === POI_CATEGORIES.length) return new Set();
      // O(k) time, O(k) space — k = POI categories
      return new Set(POI_CATEGORIES.map(c => c.key));
    });
  }, [setActiveCategories]);

  // Apply filter to POI layer
  useEffect(() => {
    if (!map) return;
    try {
      if (!map.getLayer('pois')) return;

      const allActive = activeCategories.size === POI_CATEGORIES.length;
      if (allActive) {
        map.setFilter('pois', null);
      } else if (activeCategories.size === 0) {
        map.setFilter('pois', ['==', ['get', 'category'], '__none__']);
      } else {
        map.setFilter('pois', [
          'in', ['get', 'category'], ['literal', [...activeCategories]],
        ] as unknown as maplibregl.FilterSpecification);
      }
    } catch { /* */ }
  }, [map, activeCategories]);

  if (collapsed) {
    return (
      <button style={styles.collapsed} onClick={() => setCollapsed(false)}>
        POI Filter
      </button>
    );
  }

  const allActive = activeCategories.size === POI_CATEGORIES.length;
  // O(k) time, O(k) space — k = POI categories (Set lookup per row)
  const categoryRows = POI_CATEGORIES.map(cat => (
    <label key={cat.key} style={styles.row}>
      <input
        type="checkbox"
        checked={activeCategories.has(cat.key)}
        onChange={() => toggleCategory(cat.key)}
        style={styles.checkbox}
      />
      <span style={{ ...styles.dot, background: cat.color }} />
      {cat.label}
      <span style={styles.count}>{hasCityCounts ? (cityCounts[cat.key] ?? 0) : cat.count}</span>
    </label>
  ));

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>POI Categories</span>
        <button style={styles.toggleAll} onClick={toggleAll}>
          {allActive ? 'None' : 'All'}
        </button>
        <button style={{ ...styles.toggleAll, fontSize: '14px' }} onClick={() => setCollapsed(true)}>×</button>
      </div>
      {categoryRows}
    </div>
  );
};
