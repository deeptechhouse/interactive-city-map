import React, { useCallback, useEffect, useState } from 'react';
import { getFloorPlans } from '../api/floorPlans';
import type { FloorPlan } from '../api/floorPlans';

interface FloorPlanViewerProps {
  buildingId: string;
  /** If provided, start on this floor level */
  initialLevel?: number;
  onClose: () => void;
  /** Called when opacity changes, so parent can update map overlay */
  onOpacityChange?: (opacity: number) => void;
  /** Called when active floor changes */
  onFloorChange?: (floorPlan: FloorPlan) => void;
}

export const FloorPlanViewer: React.FC<FloorPlanViewerProps> = ({
  buildingId,
  initialLevel,
  onClose,
  onOpacityChange,
  onFloorChange,
}) => {
  const [floorPlans, setFloorPlans] = useState<FloorPlan[]>([]);
  const [activeLevel, setActiveLevel] = useState<number>(initialLevel ?? 0);
  const [opacity, setOpacity] = useState(0.75);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchPlans = async () => {
      setLoading(true);
      setError(null);
      try {
        const plans = await getFloorPlans(buildingId);
        if (cancelled) return;
        setFloorPlans(plans);
        if (plans.length > 0) {
          const startLevel = initialLevel ?? plans[0].level;
          setActiveLevel(startLevel);
        }
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : 'Failed to load floor plans.';
        setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchPlans();

    return () => {
      cancelled = true;
    };
  }, [buildingId, initialLevel]);

  const activeFloorPlan = floorPlans.find((fp) => fp.level === activeLevel);

  useEffect(() => {
    if (activeFloorPlan && onFloorChange) {
      onFloorChange(activeFloorPlan);
    }
  }, [activeFloorPlan, onFloorChange]);

  const handleOpacityChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newOpacity = parseFloat(e.target.value);
      setOpacity(newOpacity);
      if (onOpacityChange) {
        onOpacityChange(newOpacity);
      }
    },
    [onOpacityChange],
  );

  const handleLevelSelect = useCallback(
    (level: number) => {
      setActiveLevel(level);
      const plan = floorPlans.find((fp) => fp.level === level);
      if (plan && onFloorChange) {
        onFloorChange(plan);
      }
    },
    [floorPlans, onFloorChange],
  );

  const getLevelLabel = (level: number): string => {
    if (level < 0) return `B${Math.abs(level)}`;
    if (level === 0) return 'G';
    return `${level + 1}F`;
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingMessage}>Loading floor plans...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <h3 style={styles.title}>Floor Plans</h3>
          <button style={styles.closeButton} onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>
        <p style={styles.error}>{error}</p>
      </div>
    );
  }

  if (floorPlans.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <h3 style={styles.title}>Floor Plans</h3>
          <button style={styles.closeButton} onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>
        <p style={styles.emptyMessage}>
          No floor plans available for this building.
        </p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>Floor Plans</h3>
        <button style={styles.closeButton} onClick={onClose} aria-label="Close">
          &times;
        </button>
      </div>

      {/* Floor level selector tabs */}
      <div style={styles.levelTabs} role="tablist" aria-label="Floor levels">
        {floorPlans
          .slice()
          .sort((a, b) => a.level - b.level)
          .map((fp) => (
            <button
              key={fp.level}
              style={{
                ...styles.levelTab,
                ...(fp.level === activeLevel ? styles.levelTabActive : {}),
              }}
              onClick={() => handleLevelSelect(fp.level)}
              role="tab"
              aria-selected={fp.level === activeLevel}
              aria-label={`Floor level ${getLevelLabel(fp.level)}`}
            >
              {getLevelLabel(fp.level)}
            </button>
          ))}
      </div>

      {/* Floor plan image display */}
      {activeFloorPlan && (
        <div style={styles.imageContainer}>
          {activeFloorPlan.image_url ? (
            <img
              src={activeFloorPlan.image_url}
              alt={`Floor plan level ${getLevelLabel(activeFloorPlan.level)}`}
              style={styles.image}
            />
          ) : (
            <p style={styles.emptyMessage}>No image available for this floor.</p>
          )}
        </div>
      )}

      {/* Opacity slider */}
      <div style={styles.opacityControl}>
        <label style={styles.opacityLabel} htmlFor="floor-plan-opacity">
          Overlay Opacity
        </label>
        <div style={styles.sliderRow}>
          <input
            id="floor-plan-opacity"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={opacity}
            onChange={handleOpacityChange}
            style={styles.slider}
          />
          <span style={styles.opacityValue}>{Math.round(opacity * 100)}%</span>
        </div>
      </div>

      {/* Back to map button */}
      <button style={styles.backButton} onClick={onClose}>
        Back to Map
      </button>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    backgroundColor: '#161b22',
    borderRadius: '8px',
    border: '1px solid #30363d',
    padding: '16px',
    width: '320px',
    maxHeight: '80vh',
    overflowY: 'auto',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  },
  title: {
    margin: 0,
    color: '#c9d1d9',
    fontSize: '16px',
    fontWeight: 600,
  },
  closeButton: {
    background: 'none',
    border: 'none',
    color: '#8b949e',
    fontSize: '22px',
    cursor: 'pointer',
    padding: '0 4px',
    lineHeight: 1,
  },
  levelTabs: {
    display: 'flex',
    gap: '4px',
    marginBottom: '12px',
    flexWrap: 'wrap' as const,
  },
  levelTab: {
    padding: '6px 12px',
    backgroundColor: '#21262d',
    border: '1px solid #30363d',
    borderRadius: '6px',
    color: '#8b949e',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background-color 0.15s, color 0.15s',
  },
  levelTabActive: {
    backgroundColor: '#58a6ff',
    borderColor: '#58a6ff',
    color: '#ffffff',
  },
  imageContainer: {
    backgroundColor: '#0d1117',
    borderRadius: '6px',
    border: '1px solid #21262d',
    padding: '8px',
    marginBottom: '12px',
    minHeight: '180px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    maxWidth: '100%',
    maxHeight: '300px',
    objectFit: 'contain' as const,
    borderRadius: '4px',
  },
  opacityControl: {
    marginBottom: '16px',
  },
  opacityLabel: {
    display: 'block',
    color: '#c9d1d9',
    fontSize: '12px',
    fontWeight: 500,
    marginBottom: '6px',
  },
  sliderRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  slider: {
    flex: 1,
    accentColor: '#58a6ff',
  },
  opacityValue: {
    color: '#8b949e',
    fontSize: '12px',
    minWidth: '36px',
    textAlign: 'right' as const,
  },
  backButton: {
    width: '100%',
    padding: '8px 16px',
    backgroundColor: '#21262d',
    border: '1px solid #30363d',
    borderRadius: '6px',
    color: '#c9d1d9',
    fontSize: '14px',
    cursor: 'pointer',
    transition: 'background-color 0.15s',
  },
  loadingMessage: {
    color: '#8b949e',
    fontSize: '14px',
    textAlign: 'center' as const,
    padding: '32px 16px',
  },
  emptyMessage: {
    color: '#8b949e',
    fontSize: '13px',
    textAlign: 'center' as const,
    margin: '0',
    padding: '16px',
  },
  error: {
    color: '#f85149',
    fontSize: '13px',
    margin: '0',
  },
};
