import React, { useCallback, useEffect, useRef, useState } from 'react';
import { THEME } from '../utils/colorSchemes';
import { useInteriorEditor, EditorAction } from './hooks/useInteriorEditor';
import { createRoom, createWall, createFeature, deleteRoom, deleteWall, deleteFeature } from '../api/interior';
import { createLineStringFromPoints, createPolygonFromPoints, createPointFeature, createPreviewLine, isValidPolygon, calculatePolygonArea } from './utils/drawModes';
import { MeasureTool } from './MeasureTool';

const PREVIEW_SOURCE = 'editor-preview-source';
const PREVIEW_LINE_LAYER = 'editor-preview-line';
const PREVIEW_POINT_LAYER = 'editor-preview-points';

interface InteriorEditorProps {
  buildingId: string;
  level: number;
  mapInstance: maplibregl.Map | null;
  onSave: () => void;
  onClose: () => void;
}

export const InteriorEditor: React.FC<InteriorEditorProps> = ({
  buildingId,
  level,
  mapInstance,
  onSave,
  onClose,
}) => {
  const editor = useInteriorEditor();
  const [drawPoints, setDrawPoints] = useState<[number, number][]>([]);
  const [saving, setSaving] = useState(false);
  const [roomType, setRoomType] = useState('room');
  const [roomName, setRoomName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const drawPointsRef = useRef<[number, number][]>([]);

  // Keep ref in sync
  useEffect(() => {
    drawPointsRef.current = drawPoints;
  }, [drawPoints]);

  // Clear draw state when tool changes
  useEffect(() => {
    setDrawPoints([]);
    setError(null);
  }, [editor.activeTool]);

  // KEYBOARD SHORTCUTS
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (drawPointsRef.current.length > 0) {
          setDrawPoints([]);
        } else {
          editor.setActiveTool(null);
        }
        return;
      }
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        editor.redo();
        return;
      }
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        editor.undo();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editor]);

  // PREVIEW LAYERS
  const clearPreviewLayers = useCallback(() => {
    if (!mapInstance) return;
    if (mapInstance.getLayer(PREVIEW_LINE_LAYER)) mapInstance.removeLayer(PREVIEW_LINE_LAYER);
    if (mapInstance.getLayer(PREVIEW_POINT_LAYER)) mapInstance.removeLayer(PREVIEW_POINT_LAYER);
    if (mapInstance.getSource(PREVIEW_SOURCE)) mapInstance.removeSource(PREVIEW_SOURCE);
  }, [mapInstance]);

  const updatePreview = useCallback(
    (pts: [number, number][], cursor?: [number, number]) => {
      if (!mapInstance) return;

      const features: GeoJSON.Feature[] = [];

      // Placed points
      for (const pt of pts) {
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: pt },
          properties: {},
        });
      }

      // Lines between placed points
      if (pts.length >= 2) {
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: pts },
          properties: {},
        });
      }

      // Preview line from last point to cursor
      if (cursor && pts.length > 0) {
        const preview = createPreviewLine(pts, cursor);
        if (preview) {
          features.push({
            type: 'Feature',
            geometry: preview,
            properties: { preview: true },
          });
        }
      }

      const geojson: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features,
      };

      const source = mapInstance.getSource(PREVIEW_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (source) {
        source.setData(geojson);
      } else {
        mapInstance.addSource(PREVIEW_SOURCE, { type: 'geojson', data: geojson });
        mapInstance.addLayer({
          id: PREVIEW_LINE_LAYER,
          type: 'line',
          source: PREVIEW_SOURCE,
          filter: ['==', '$type', 'LineString'],
          paint: {
            'line-color': THEME.accent,
            'line-width': 2,
            'line-dasharray': [4, 2],
          },
        });
        mapInstance.addLayer({
          id: PREVIEW_POINT_LAYER,
          type: 'circle',
          source: PREVIEW_SOURCE,
          filter: ['==', '$type', 'Point'],
          paint: {
            'circle-radius': 5,
            'circle-color': THEME.accent,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
          },
        });
      }
    },
    [mapInstance],
  );

  // SAVE HANDLERS
  const handleSaveRoom = useCallback(
    async (polygon: GeoJSON.Polygon) => {
      setSaving(true);
      setError(null);
      try {
        const result = await createRoom(buildingId, {
          level,
          room_type: roomType,
          name: roomName || undefined,
          geom: polygon,
        });
        editor.pushAction({
          type: 'create-room',
          data: { ...result, geom: polygon },
          undoData: result,
        });
        setDrawPoints([]);
        setRoomName('');
        onSave();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save room');
      } finally {
        setSaving(false);
      }
    },
    [buildingId, level, roomType, roomName, onSave, editor],
  );

  const handleSaveWall = useCallback(
    async (line: GeoJSON.LineString) => {
      setSaving(true);
      setError(null);
      try {
        const result = await createWall(buildingId, {
          level,
          wall_type: 'interior',
          geom: line,
        });
        editor.pushAction({
          type: 'create-wall',
          data: { ...result, geom: line },
          undoData: result,
        });
        setDrawPoints([]);
        onSave();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save wall');
      } finally {
        setSaving(false);
      }
    },
    [buildingId, level, onSave, editor],
  );

  const handleSaveFeature = useCallback(
    async (point: GeoJSON.Point) => {
      setSaving(true);
      setError(null);
      try {
        const result = await createFeature(buildingId, {
          level,
          feature_type: editor.featurePlacementType,
          geom: point,
        });
        editor.pushAction({
          type: 'create-feature',
          data: { ...result, geom: point },
          undoData: result,
        });
        onSave();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save feature');
      } finally {
        setSaving(false);
      }
    },
    [buildingId, level, editor, onSave],
  );

  // MAP CLICK + MOUSEMOVE HANDLERS
  useEffect(() => {
    if (!mapInstance) return;
    const tool = editor.activeTool;
    if (tool !== 'draw-wall' && tool !== 'draw-room' && tool !== 'draw-feature') {
      clearPreviewLayers();
      return;
    }

    let localPoints: [number, number][] = [];

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      const pt: [number, number] = [e.lngLat.lng, e.lngLat.lat];

      if (tool === 'draw-feature') {
        const geom = createPointFeature(pt);
        handleSaveFeature(geom);
        return;
      }

      localPoints = [...localPoints, pt];
      setDrawPoints([...localPoints]);
      updatePreview(localPoints);

      if (tool === 'draw-wall' && localPoints.length === 2) {
        const line = createLineStringFromPoints(localPoints);
        if (line) handleSaveWall(line);
        localPoints = [];
        setDrawPoints([]);
      }
    };

    const handleDblClick = (e: maplibregl.MapMouseEvent) => {
      if (tool !== 'draw-room') return;
      e.preventDefault();

      if (localPoints.length >= 3 && isValidPolygon(localPoints)) {
        const polygon = createPolygonFromPoints(localPoints);
        if (polygon) handleSaveRoom(polygon);
      } else if (localPoints.length >= 3) {
        setError('Invalid polygon: edges cannot cross each other');
      }

      localPoints = [];
      setDrawPoints([]);
      clearPreviewLayers();
    };

    const handleMouseMove = (e: maplibregl.MapMouseEvent) => {
      if (localPoints.length > 0) {
        updatePreview(localPoints, [e.lngLat.lng, e.lngLat.lat]);
      }
    };

    mapInstance.on('click', handleClick);
    mapInstance.on('dblclick', handleDblClick);
    mapInstance.on('mousemove', handleMouseMove);
    mapInstance.getCanvas().style.cursor = 'crosshair';

    return () => {
      mapInstance.off('click', handleClick);
      mapInstance.off('dblclick', handleDblClick);
      mapInstance.off('mousemove', handleMouseMove);
      mapInstance.getCanvas().style.cursor = '';
      clearPreviewLayers();
    };
  }, [
    mapInstance,
    editor.activeTool,
    handleSaveRoom,
    handleSaveWall,
    handleSaveFeature,
    clearPreviewLayers,
    updatePreview,
  ]);

  // UNDO / REDO HANDLERS
  const handleUndo = useCallback(async () => {
    const action = editor.undo();
    if (!action || !action.undoData) return;
    const data = action.undoData as { id: string };
    try {
      if (action.type === 'create-room') await deleteRoom(data.id);
      if (action.type === 'create-wall') await deleteWall(data.id);
      if (action.type === 'create-feature') await deleteFeature(data.id);
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Undo failed');
    }
  }, [editor, onSave]);

  const handleRedo = useCallback(async () => {
    const action = editor.redo();
    if (!action) return;
    const data = action.data as { geom: GeoJSON.Geometry; [key: string]: unknown };
    try {
      if (action.type === 'create-room') {
        await createRoom(buildingId, {
          level,
          room_type: (data as { room_type?: string }).room_type ?? 'room',
          name: (data as { name?: string }).name,
          geom: data.geom,
        });
      }
      if (action.type === 'create-wall') {
        await createWall(buildingId, { level, wall_type: 'interior', geom: data.geom });
      }
      if (action.type === 'create-feature') {
        await createFeature(buildingId, {
          level,
          feature_type: (data as { feature_type?: string }).feature_type ?? 'door',
          geom: data.geom,
        });
      }
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Redo failed');
    }
  }, [editor, buildingId, level, onSave]);

  // ROOM TYPES
  const roomTypes = [
    'room', 'bedroom', 'bathroom', 'kitchen', 'living', 'dining',
    'office', 'closet', 'hallway', 'lobby', 'ballroom', 'conference',
    'storage', 'utility', 'restroom',
  ];

  const featureTypes = ['door', 'stair', 'elevator', 'restroom', 'exit', 'utility'] as const;

  return (
    <>
      <div style={styles.toolbar}>
        <div style={styles.toolbarHeader}>
          <span style={styles.toolbarTitle}>Editor</span>
          <button style={styles.closeBtn} onClick={onClose}>
            &times;
          </button>
        </div>

        <div style={styles.toolGroup}>
          <ToolButton
            icon={'\u2197'}
            label="Select"
            active={editor.activeTool === 'select'}
            onClick={() => editor.setActiveTool('select')}
          />
          <ToolButton
            icon={'\u2014'}
            label="Wall"
            active={editor.activeTool === 'draw-wall'}
            onClick={() => editor.setActiveTool('draw-wall')}
          />
          <ToolButton
            icon={'\u25A2'}
            label="Room"
            active={editor.activeTool === 'draw-room'}
            onClick={() => editor.setActiveTool('draw-room')}
          />
          <ToolButton
            icon={'\u25C9'}
            label="Feature"
            active={editor.activeTool === 'draw-feature'}
            onClick={() => editor.setActiveTool('draw-feature')}
          />
          <ToolButton
            icon={'\uD83D\uDCCF'}
            label="Measure"
            active={editor.activeTool === 'measure'}
            onClick={() => editor.setActiveTool('measure')}
          />
        </div>

        {/* Room type selector */}
        {editor.activeTool === 'draw-room' && (
          <div style={styles.formSection}>
            <label style={styles.label}>Room Type</label>
            <select
              style={styles.select}
              value={roomType}
              onChange={(e) => setRoomType(e.target.value)}
            >
              {roomTypes.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
            <input
              style={styles.input}
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder="Room name (optional)"
            />
          </div>
        )}

        {/* Feature type selector */}
        {editor.activeTool === 'draw-feature' && (
          <div style={styles.formSection}>
            <label style={styles.label}>Feature Type</label>
            <select
              style={styles.select}
              value={editor.featurePlacementType}
              onChange={(e) =>
                editor.setFeaturePlacementType(e.target.value as typeof featureTypes[number])
              }
            >
              {featureTypes.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Undo/Redo */}
        <div style={styles.toolGroup}>
          <button
            style={{
              ...styles.actionBtn,
              ...(editor.canUndo ? {} : styles.actionBtnDisabled),
            }}
            onClick={handleUndo}
            disabled={!editor.canUndo}
          >
            Undo
          </button>
          <button
            style={{
              ...styles.actionBtn,
              ...(editor.canRedo ? {} : styles.actionBtnDisabled),
            }}
            onClick={handleRedo}
            disabled={!editor.canRedo}
          >
            Redo
          </button>
        </div>

        {/* Status */}
        {drawPoints.length > 0 && (
          <div style={styles.status}>
            {drawPoints.length} point{drawPoints.length > 1 ? 's' : ''} placed
            {editor.activeTool === 'draw-room' && drawPoints.length >= 3
              ? ' (double-click to close)'
              : ''}
          </div>
        )}
        {saving && <div style={styles.statusSaving}>Saving...</div>}
        {error && <div style={styles.statusError}>{error}</div>}
      </div>

      <MeasureTool
        mapInstance={mapInstance}
        active={editor.activeTool === 'measure'}
        onClose={() => editor.setActiveTool(null)}
      />
    </>
  );
};

function ToolButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      style={{ ...styles.toolBtn, ...(active ? styles.toolBtnActive : {}) }}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
    >
      <span style={styles.toolIcon}>{icon}</span>
      <span style={styles.toolLabel}>{label}</span>
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  toolbar: {
    position: 'fixed',
    right: 0,
    top: 0,
    width: 240,
    height: '100vh',
    background: THEME.bg,
    borderLeft: `1px solid ${THEME.border}`,
    zIndex: 200,
    display: 'flex',
    flexDirection: 'column',
    padding: 12,
    fontFamily: 'system-ui, sans-serif',
    color: THEME.text,
    overflowY: 'auto',
  },
  toolbarHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 8,
    borderBottom: `1px solid ${THEME.border}`,
  },
  toolbarTitle: {
    fontSize: 15,
    fontWeight: 700,
    color: THEME.accent,
    letterSpacing: '0.02em',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: THEME.textMuted,
    fontSize: 20,
    cursor: 'pointer',
    padding: 0,
    lineHeight: 1,
  },
  toolGroup: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  toolBtn: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    width: 52,
    height: 52,
    background: THEME.bgSecondary,
    border: `1px solid ${THEME.border}`,
    borderRadius: 6,
    cursor: 'pointer',
    color: THEME.text,
    padding: 4,
    transition: 'border-color 0.15s, background 0.15s',
  },
  toolBtnActive: {
    borderColor: THEME.accent,
    background: THEME.bgTertiary,
    boxShadow: `0 0 0 1px ${THEME.accent}`,
  },
  toolIcon: {
    fontSize: 16,
    lineHeight: 1,
    marginBottom: 2,
  },
  toolLabel: {
    fontSize: 9,
    color: THEME.textMuted,
    lineHeight: 1,
  },
  formSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    marginBottom: 12,
    padding: 8,
    background: THEME.bgSecondary,
    borderRadius: 6,
    border: `1px solid ${THEME.border}`,
  },
  label: {
    fontSize: 11,
    fontWeight: 600,
    color: THEME.textMuted,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  select: {
    background: THEME.bgTertiary,
    color: THEME.text,
    border: `1px solid ${THEME.border}`,
    borderRadius: 4,
    padding: '6px 8px',
    fontSize: 12,
    outline: 'none',
  },
  input: {
    background: THEME.bgTertiary,
    color: THEME.text,
    border: `1px solid ${THEME.border}`,
    borderRadius: 4,
    padding: '6px 8px',
    fontSize: 12,
    outline: 'none',
  },
  actionBtn: {
    flex: 1,
    padding: '8px 0',
    background: THEME.bgSecondary,
    color: THEME.text,
    border: `1px solid ${THEME.border}`,
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background 0.15s',
  },
  actionBtnDisabled: {
    opacity: 0.4,
    cursor: 'default',
  },
  status: {
    fontSize: 11,
    color: THEME.textMuted,
    padding: '6px 8px',
    background: THEME.bgSecondary,
    borderRadius: 4,
    marginBottom: 6,
  },
  statusSaving: {
    fontSize: 11,
    color: THEME.warning,
    padding: '6px 8px',
    background: THEME.bgSecondary,
    borderRadius: 4,
    marginBottom: 6,
  },
  statusError: {
    fontSize: 11,
    color: THEME.danger,
    padding: '6px 8px',
    background: THEME.bgSecondary,
    borderRadius: 4,
    border: `1px solid ${THEME.danger}`,
    marginBottom: 6,
  },
};
