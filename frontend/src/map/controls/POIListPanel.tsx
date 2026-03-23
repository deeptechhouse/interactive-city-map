import React, { useCallback, useEffect, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { THEME } from '../../utils/colorSchemes';
import { POI_COLORS } from '../../utils/colorSchemes';

interface VisiblePOI {
  id: string;
  name: string;
  category: string;
  subcategory: string | null;
  address: string | null;
  lng: number;
  lat: number;
}

interface POIListPanelProps {
  mapInstance: maplibregl.Map | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  performance_arts: 'Performance & Arts',
  hospitality_events: 'Hospitality & Events',
  creative_production: 'Creative Production',
  cultural_community: 'Cultural & Community',
  parks: 'Parks & Recreation',
};

const styles = {
  panel: {
    position: 'fixed' as const,
    bottom: '32px',
    right: '12px',
    width: '320px',
    maxHeight: '50vh',
    zIndex: 10,
    background: THEME.bg,
    border: `1px solid ${THEME.border}`,
    borderRadius: '8px',
    boxShadow: '0 2px 12px rgba(0, 0, 0, 0.5)',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    borderBottom: `1px solid ${THEME.border}`,
    flexShrink: 0 as const,
  },
  title: {
    color: THEME.text,
    fontWeight: 600 as const,
    fontSize: '13px',
    margin: 0,
  },
  count: {
    color: THEME.textMuted,
    fontSize: '11px',
    marginLeft: '8px',
  },
  toggleBtn: {
    background: 'none',
    border: 'none',
    color: THEME.textMuted,
    fontSize: '16px',
    cursor: 'pointer',
    padding: '0 4px',
    lineHeight: 1,
  },
  list: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '4px 0',
  },
  categoryGroup: {
    marginBottom: '4px',
  },
  categoryHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 14px',
    fontSize: '11px',
    fontWeight: 600 as const,
    color: THEME.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0 as const,
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '5px 14px 5px 28px',
    cursor: 'pointer',
    fontSize: '12px',
    borderBottom: `1px solid ${THEME.bgTertiary}`,
    transition: 'background 0.1s',
  },
  itemName: {
    color: THEME.text,
    flex: 1,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  itemAddr: {
    color: THEME.textMuted,
    fontSize: '11px',
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
    maxWidth: '120px',
  },
  empty: {
    padding: '20px 14px',
    textAlign: 'center' as const,
    color: THEME.textMuted,
    fontSize: '12px',
  },
  collapsedBtn: {
    position: 'fixed' as const,
    bottom: '32px',
    right: '12px',
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

export const POIListPanel: React.FC<POIListPanelProps> = ({ mapInstance }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [pois, setPois] = useState<VisiblePOI[]>([]);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const queryVisiblePOIs = useCallback(() => {
    if (!mapInstance) return;

    try {
      const layer = mapInstance.getLayer('pois');
      if (!layer) { setPois([]); return; }
    } catch { setPois([]); return; }

    const features = mapInstance.queryRenderedFeatures(undefined, { layers: ['pois'] });

    const seen = new Set<string>();
    const result: VisiblePOI[] = [];

    for (const f of features) {
      const p = f.properties ?? {};
      const id = String(p.id ?? p.name ?? Math.random());
      if (seen.has(id)) continue;
      seen.add(id);

      let lng = 0, lat = 0;
      if (f.geometry.type === 'Point') {
        [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
      }

      result.push({
        id,
        name: p.name ?? 'Unnamed POI',
        category: p.category ?? 'unknown',
        subcategory: p.subcategory ?? null,
        address: p.address ?? null,
        lng,
        lat,
      });
    }

    result.sort((a, b) => {
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      return a.name.localeCompare(b.name);
    });

    setPois(result);
  }, [mapInstance]);

  // Query on map move/zoom with debounce
  useEffect(() => {
    if (!mapInstance) return;

    const handler = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(queryVisiblePOIs, 300);
    };

    mapInstance.on('moveend', handler);
    mapInstance.on('zoomend', handler);
    mapInstance.on('sourcedata', handler);

    // Initial query
    handler();

    return () => {
      mapInstance.off('moveend', handler);
      mapInstance.off('zoomend', handler);
      mapInstance.off('sourcedata', handler);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [mapInstance, queryVisiblePOIs]);

  const handleClickPOI = useCallback((poi: VisiblePOI) => {
    if (!mapInstance) return;
    mapInstance.flyTo({ center: [poi.lng, poi.lat], zoom: Math.max(mapInstance.getZoom(), 17), duration: 800 });
  }, [mapInstance]);

  if (collapsed) {
    return (
      <button style={styles.collapsedBtn} onClick={() => setCollapsed(false)}>
        POIs ({pois.length})
      </button>
    );
  }

  // Group by category
  const grouped: Record<string, VisiblePOI[]> = {};
  for (const poi of pois) {
    if (!grouped[poi.category]) grouped[poi.category] = [];
    grouped[poi.category].push(poi);
  }

  const categories = Object.keys(grouped).sort();

  return (
    <div style={styles.panel} role="complementary" aria-label="Visible points of interest">
      <div style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={styles.title}>Visible POIs</span>
          <span style={styles.count}>{pois.length}</span>
        </div>
        <button style={styles.toggleBtn} onClick={() => setCollapsed(true)} aria-label="Collapse POI list">
          &times;
        </button>
      </div>

      <div style={styles.list}>
        {pois.length === 0 && (
          <div style={styles.empty}>
            {mapInstance && mapInstance.getZoom() < 14
              ? 'Zoom in to see POIs (zoom ≥ 14)'
              : 'No POIs in current view'}
          </div>
        )}
        {categories.map((cat) => (
          <div key={cat} style={styles.categoryGroup}>
            <div style={styles.categoryHeader}>
              <div style={{ ...styles.dot, background: POI_COLORS[cat] ?? '#888' }} />
              {CATEGORY_LABELS[cat] ?? cat} ({grouped[cat].length})
            </div>
            {grouped[cat].map((poi, idx) => (
              <div
                key={poi.id}
                style={{
                  ...styles.item,
                  background: hoverIdx === pois.indexOf(poi) ? THEME.bgTertiary : 'transparent',
                }}
                onClick={() => handleClickPOI(poi)}
                onMouseEnter={() => setHoverIdx(pois.indexOf(poi))}
                onMouseLeave={() => setHoverIdx(null)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') handleClickPOI(poi); }}
              >
                <span style={styles.itemName}>{poi.name}</span>
                {poi.address && <span style={styles.itemAddr}>{poi.address}</span>}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};
