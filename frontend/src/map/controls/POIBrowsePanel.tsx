import React, { useCallback, useEffect, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { THEME } from '../../utils/colorSchemes';
import { apiBaseUrl } from '../../utils/geoUtils';

interface POIRecord {
  id: string;
  name: string;
  category: string;
  subcategory: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  geometry: { type: string; coordinates: [number, number] } | null;
  metadata: Record<string, unknown> | null;
}

interface POIBrowsePanelProps {
  map: maplibregl.Map | null;
}

const CATEGORIES = [
  { key: 'church', label: 'Churches', color: '#ec4899' },
  { key: 'gymnasium', label: 'Gyms & Fitness', color: '#ef4444' },
  { key: 'hotel_event', label: 'Hotels & Events', color: '#f59e0b' },
  { key: 'theater', label: 'Theaters', color: '#8b5cf6' },
  { key: 'gallery', label: 'Galleries', color: '#a855f7' },
  { key: 'museum', label: 'Museums', color: '#3b82f6' },
  { key: 'music_studio', label: 'Music Studios', color: '#06b6d4' },
  { key: 'community_center', label: 'Community Centers', color: '#14b8a6' },
  { key: 'dance_studio', label: 'Dance Studios', color: '#f472b6' },
  { key: 'music_venue', label: 'Music Venues', color: '#e11d48' },
  { key: 'movie_theater', label: 'Movie Theaters', color: '#7c3aed' },
  { key: 'recording_studio', label: 'Recording Studios', color: '#0ea5e9' },
  { key: 'park', label: 'Parks', color: '#22c55e' },
  { key: 'warehouse', label: 'Warehouses', color: '#78716c' },
  { key: 'motel', label: 'Motels', color: '#eab308' },
  { key: 'beer_garden', label: 'Beer Gardens', color: '#84cc16' },
];

const styles = {
  panel: {
    position: 'fixed' as const,
    top: '12px',
    right: '12px',
    width: '360px',
    maxHeight: '85vh',
    zIndex: 15,
    background: THEME.bg,
    border: `1px solid ${THEME.border}`,
    borderRadius: '8px',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.6)',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: `1px solid ${THEME.border}`,
    flexShrink: 0 as const,
  },
  title: {
    color: THEME.text,
    fontWeight: 600 as const,
    fontSize: '14px',
    margin: 0,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: THEME.textMuted,
    fontSize: '18px',
    cursor: 'pointer',
    padding: '0 4px',
    lineHeight: 1,
  },
  categoryBar: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '4px',
    padding: '10px 16px',
    borderBottom: `1px solid ${THEME.border}`,
    flexShrink: 0 as const,
    maxHeight: '120px',
    overflowY: 'auto' as const,
  },
  catBtn: {
    padding: '3px 10px',
    borderRadius: '12px',
    border: `1px solid ${THEME.border}`,
    background: THEME.bgSecondary,
    color: THEME.textMuted,
    fontSize: '11px',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  catBtnActive: {
    borderColor: THEME.accent,
    background: 'rgba(88, 166, 255, 0.15)',
    color: THEME.accent,
  },
  list: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '4px 0',
  },
  item: {
    display: 'flex',
    flexDirection: 'column' as const,
    padding: '8px 16px',
    cursor: 'pointer',
    borderBottom: `1px solid ${THEME.bgTertiary}`,
    transition: 'background 0.1s',
  },
  itemName: {
    color: THEME.text,
    fontWeight: 500 as const,
    fontSize: '13px',
  },
  itemMeta: {
    color: THEME.textMuted,
    fontSize: '11px',
    marginTop: '2px',
  },
  itemContact: {
    marginTop: '3px',
    fontSize: '11px',
  },
  link: {
    color: '#58a6ff',
    textDecoration: 'none',
  },
  loading: {
    padding: '20px',
    textAlign: 'center' as const,
    color: THEME.textMuted,
    fontSize: '12px',
  },
  count: {
    color: THEME.textMuted,
    fontSize: '11px',
    padding: '6px 16px',
    borderBottom: `1px solid ${THEME.border}`,
    flexShrink: 0 as const,
  },
  openBtn: {
    position: 'fixed' as const,
    top: '12px',
    right: '12px',
    zIndex: 10,
    background: THEME.bg,
    border: `1px solid ${THEME.border}`,
    borderRadius: '6px',
    padding: '8px 14px',
    fontSize: '12px',
    fontWeight: 600 as const,
    color: THEME.text,
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.4)',
  },
} as const;

export const POIBrowsePanel: React.FC<POIBrowsePanelProps> = ({ map }) => {
  const [open, setOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [pois, setPois] = useState<POIRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // Fetch POIs when category changes
  useEffect(() => {
    if (!selectedCategory) {
      setPois([]);
      return;
    }
    setLoading(true);
    const base = apiBaseUrl();
    fetch(`${base}/api/v1/cities/chicago/pois?category=${selectedCategory}`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          data.sort((a: POIRecord, b: POIRecord) => (a.name || '').localeCompare(b.name || ''));
          setPois(data);
        }
      })
      .catch(() => setPois([]))
      .finally(() => setLoading(false));
  }, [selectedCategory]);

  const handleClickPOI = useCallback((poi: POIRecord) => {
    if (!map || !poi.geometry) return;
    const [lng, lat] = poi.geometry.coordinates;
    map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 17), duration: 1000 });
  }, [map]);

  if (!open) {
    return (
      <button style={styles.openBtn} onClick={() => setOpen(true)}>
        Browse All POIs
      </button>
    );
  }

  const catInfo = CATEGORIES.find(c => c.key === selectedCategory);

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.title}>
          {selectedCategory ? (catInfo?.label ?? selectedCategory) : 'Browse Points of Interest'}
        </span>
        <button style={styles.closeBtn} onClick={() => setOpen(false)} aria-label="Close">×</button>
      </div>

      <div style={styles.categoryBar}>
        {CATEGORIES.map(cat => (
          <button
            key={cat.key}
            style={{
              ...styles.catBtn,
              ...(selectedCategory === cat.key ? styles.catBtnActive : {}),
              ...(selectedCategory === cat.key ? { borderColor: cat.color, color: cat.color } : {}),
            }}
            onClick={() => setSelectedCategory(selectedCategory === cat.key ? null : cat.key)}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {selectedCategory && (
        <div style={styles.count}>
          {loading ? 'Loading...' : `${pois.length} ${catInfo?.label ?? 'results'}`}
        </div>
      )}

      {!selectedCategory && (
        <div style={styles.loading}>Select a category above to browse all locations</div>
      )}

      <div style={styles.list}>
        {loading && <div style={styles.loading}>Loading...</div>}
        {pois.map((poi, idx) => (
          <div
            key={poi.id}
            style={{
              ...styles.item,
              background: hoverIdx === idx ? THEME.bgTertiary : 'transparent',
            }}
            onClick={() => handleClickPOI(poi)}
            onMouseEnter={() => setHoverIdx(idx)}
            onMouseLeave={() => setHoverIdx(null)}
            role="button"
            tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter') handleClickPOI(poi); }}
          >
            <span style={styles.itemName}>{poi.name}</span>
            <span style={styles.itemMeta}>
              {poi.address && <span>{poi.address}</span>}
              {poi.subcategory && <span> · {poi.subcategory}</span>}
            </span>
            <div style={styles.itemContact}>
              {poi.phone && <span><a href={`tel:${poi.phone}`} style={styles.link}>{poi.phone}</a></span>}
              {poi.phone && poi.website && <span> · </span>}
              {poi.website && (
                <a href={poi.website} target="_blank" rel="noopener noreferrer" style={styles.link}
                   onClick={e => e.stopPropagation()}>
                  website
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
