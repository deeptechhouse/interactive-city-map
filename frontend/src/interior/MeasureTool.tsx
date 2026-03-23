import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as turf from '@turf/turf';
import { THEME } from '../utils/colorSchemes';

interface MeasureToolProps {
  mapInstance: maplibregl.Map | null;
  active: boolean;
  onClose: () => void;
}

const SOURCE_ID = 'measure-tool-source';
const LINE_LAYER_ID = 'measure-tool-line';
const POINT_LAYER_ID = 'measure-tool-points';
const LABEL_LAYER_ID = 'measure-tool-labels';

export const MeasureTool: React.FC<MeasureToolProps> = ({
  mapInstance,
  active,
  onClose,
}) => {
  const [points, setPoints] = useState<[number, number][]>([]);
  const [segmentDistances, setSegmentDistances] = useState<number[]>([]);
  const [totalDistance, setTotalDistance] = useState(0);
  const cleanupRef = useRef<(() => void) | null>(null);

  const clearMeasureLayers = useCallback(() => {
    if (!mapInstance) return;
    if (mapInstance.getLayer(LABEL_LAYER_ID)) mapInstance.removeLayer(LABEL_LAYER_ID);
    if (mapInstance.getLayer(POINT_LAYER_ID)) mapInstance.removeLayer(POINT_LAYER_ID);
    if (mapInstance.getLayer(LINE_LAYER_ID)) mapInstance.removeLayer(LINE_LAYER_ID);
    if (mapInstance.getSource(SOURCE_ID)) mapInstance.removeSource(SOURCE_ID);
  }, [mapInstance]);

  const updateLayers = useCallback(
    (pts: [number, number][]) => {
      if (!mapInstance) return;

      const features: GeoJSON.Feature[] = [];

      // Point features
      for (const pt of pts) {
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: pt },
          properties: {},
        });
      }

      // Line feature
      if (pts.length >= 2) {
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: pts },
          properties: {},
        });
      }

      // Label features at midpoint of each segment
      const distances: number[] = [];
      for (let i = 1; i < pts.length; i++) {
        const from = turf.point(pts[i - 1]);
        const to = turf.point(pts[i]);
        const dist = turf.distance(from, to, { units: 'meters' });
        distances.push(dist);

        const midLng = (pts[i - 1][0] + pts[i][0]) / 2;
        const midLat = (pts[i - 1][1] + pts[i][1]) / 2;

        const label = dist >= 1000
          ? `${(dist / 1000).toFixed(2)} km`
          : `${dist.toFixed(1)} m`;

        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [midLng, midLat] },
          properties: { label, isLabel: true },
        });
      }

      setSegmentDistances(distances);
      setTotalDistance(distances.reduce((sum, d) => sum + d, 0));

      const geojson: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features,
      };

      const source = mapInstance.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (source) {
        source.setData(geojson);
      } else {
        mapInstance.addSource(SOURCE_ID, { type: 'geojson', data: geojson });

        mapInstance.addLayer({
          id: LINE_LAYER_ID,
          type: 'line',
          source: SOURCE_ID,
          filter: ['==', '$type', 'LineString'],
          paint: {
            'line-color': THEME.warning,
            'line-width': 2,
            'line-dasharray': [4, 2],
          },
        });

        mapInstance.addLayer({
          id: POINT_LAYER_ID,
          type: 'circle',
          source: SOURCE_ID,
          filter: ['all', ['==', '$type', 'Point'], ['!', ['has', 'isLabel']]],
          paint: {
            'circle-radius': 5,
            'circle-color': THEME.accent,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
          },
        });

        mapInstance.addLayer({
          id: LABEL_LAYER_ID,
          type: 'symbol',
          source: SOURCE_ID,
          filter: ['all', ['==', '$type', 'Point'], ['has', 'isLabel']],
          layout: {
            'text-field': ['get', 'label'],
            'text-size': 12,
            'text-offset': [0, -1.2],
            'text-allow-overlap': true,
          },
          paint: {
            'text-color': THEME.warning,
            'text-halo-color': THEME.bg,
            'text-halo-width': 2,
          },
        });
      }
    },
    [mapInstance],
  );

  // Register/unregister map click handler
  useEffect(() => {
    if (!mapInstance || !active) return;

    let currentPoints: [number, number][] = [];

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      const pt: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      currentPoints = [...currentPoints, pt];
      setPoints([...currentPoints]);
      updateLayers(currentPoints);
    };

    mapInstance.on('click', handleClick);
    mapInstance.getCanvas().style.cursor = 'crosshair';

    cleanupRef.current = () => {
      mapInstance.off('click', handleClick);
      mapInstance.getCanvas().style.cursor = '';
    };

    return () => {
      if (cleanupRef.current) cleanupRef.current();
      cleanupRef.current = null;
    };
  }, [mapInstance, active, updateLayers]);

  // Clean up layers on deactivate/unmount
  useEffect(() => {
    if (!active) {
      clearMeasureLayers();
      setPoints([]);
      setSegmentDistances([]);
      setTotalDistance(0);
    }
    return () => {
      clearMeasureLayers();
    };
  }, [active, clearMeasureLayers]);

  const handleClear = useCallback(() => {
    setPoints([]);
    setSegmentDistances([]);
    setTotalDistance(0);
    clearMeasureLayers();
  }, [clearMeasureLayers]);

  if (!active) return null;

  const formattedTotal =
    totalDistance >= 1000
      ? `${(totalDistance / 1000).toFixed(2)} km`
      : `${totalDistance.toFixed(1)} m`;

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.title}>Measure Distance</span>
        <button style={styles.closeBtn} onClick={onClose}>
          &times;
        </button>
      </div>

      <div style={styles.instructions}>
        Click on the map to place measurement points.
      </div>

      {segmentDistances.length > 0 && (
        <div style={styles.segmentList}>
          {segmentDistances.map((d, i) => (
            <div key={i} style={styles.segmentRow}>
              <span style={styles.segmentLabel}>
                Segment {i + 1}
              </span>
              <span style={styles.segmentValue}>
                {d >= 1000 ? `${(d / 1000).toFixed(2)} km` : `${d.toFixed(1)} m`}
              </span>
            </div>
          ))}
        </div>
      )}

      {points.length >= 2 && (
        <div style={styles.totalRow}>
          <span style={styles.totalLabel}>Total</span>
          <span style={styles.totalValue}>{formattedTotal}</span>
        </div>
      )}

      <div style={styles.actions}>
        <button
          style={styles.clearBtn}
          onClick={handleClear}
          disabled={points.length === 0}
        >
          Clear
        </button>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: 'fixed',
    right: 256,
    top: 12,
    width: 220,
    background: THEME.bgSecondary,
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
    padding: 12,
    zIndex: 210,
    fontFamily: 'system-ui, sans-serif',
    color: THEME.text,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 13,
    fontWeight: 600,
    color: THEME.warning,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: THEME.textMuted,
    fontSize: 18,
    cursor: 'pointer',
    padding: 0,
    lineHeight: 1,
  },
  instructions: {
    fontSize: 11,
    color: THEME.textMuted,
    marginBottom: 8,
  },
  segmentList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    marginBottom: 8,
  },
  segmentRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 12,
  },
  segmentLabel: {
    color: THEME.textMuted,
  },
  segmentValue: {
    color: THEME.text,
    fontFamily: 'monospace',
  },
  totalRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 13,
    fontWeight: 600,
    borderTop: `1px solid ${THEME.border}`,
    paddingTop: 6,
    marginBottom: 8,
  },
  totalLabel: {
    color: THEME.warning,
  },
  totalValue: {
    color: THEME.text,
    fontFamily: 'monospace',
  },
  actions: {
    display: 'flex',
    gap: 6,
  },
  clearBtn: {
    flex: 1,
    padding: '6px 0',
    background: THEME.bgTertiary,
    color: THEME.text,
    border: `1px solid ${THEME.border}`,
    borderRadius: 4,
    fontSize: 12,
    cursor: 'pointer',
  },
};
