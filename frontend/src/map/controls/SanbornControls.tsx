import React, { useState, useCallback } from 'react';
import { EraSelector, CHICAGO_SANBORN_ERAS } from './EraSelector';
import type { SanbornEra } from './EraSelector';

interface SanbornControlsProps {
  /** Whether the Sanborn overlay is currently visible on the map. */
  visible: boolean;
  /** Current overlay opacity (0–1). */
  opacity: number;
  /** Called when the user toggles the overlay on/off. */
  onToggleVisible: (visible: boolean) => void;
  /** Called when the user changes opacity. */
  onOpacityChange: (opacity: number) => void;
  /** Called when the user selects a different Sanborn era. */
  onEraChange: (era: SanbornEra) => void;
}

/**
 * Compact control panel for the Sanborn historical map overlay.
 *
 * Contains:
 * - A toggle button to show/hide the overlay
 * - An EraSelector pill group for choosing which map era to display
 * - An opacity slider
 * - Brief informational text about what Sanborn maps are
 *
 * Designed to sit inside the layer panel area at ~250 px width with
 * the project's dark theme.
 */
export const SanbornControls: React.FC<SanbornControlsProps> = ({
  visible,
  opacity,
  onToggleVisible,
  onOpacityChange,
  onEraChange,
}) => {
  const [selectedEraId, setSelectedEraId] = useState<string | null>(
    CHICAGO_SANBORN_ERAS[0]?.id ?? null,
  );

  const handleToggle = useCallback(() => {
    onToggleVisible(!visible);
  }, [visible, onToggleVisible]);

  const handleEraSelect = useCallback(
    (era: SanbornEra) => {
      setSelectedEraId(era.id);
      onEraChange(era);
    },
    [onEraChange],
  );

  const handleOpacity = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onOpacityChange(parseFloat(e.target.value) / 100);
    },
    [onOpacityChange],
  );

  return (
    <div className="sanborn-controls" role="region" aria-label="Sanborn map overlay controls">
      {/* Header with toggle */}
      <div className="sanborn-controls__header">
        <label className="sanborn-controls__toggle">
          <input
            type="checkbox"
            checked={visible}
            onChange={handleToggle}
            className="sanborn-controls__checkbox"
          />
          <span className="sanborn-controls__title">Sanborn Maps</span>
        </label>
      </div>

      {visible && (
        <div className="sanborn-controls__body">
          {/* Era selector */}
          <EraSelector
            eras={CHICAGO_SANBORN_ERAS}
            selectedEraId={selectedEraId}
            onSelectEra={handleEraSelect}
          />

          {/* Opacity slider */}
          <div className="sanborn-controls__opacity">
            <label className="sanborn-controls__opacity-label" htmlFor="sanborn-opacity">
              Opacity
            </label>
            <div className="sanborn-controls__opacity-row">
              <input
                id="sanborn-opacity"
                type="range"
                min="0"
                max="100"
                value={Math.round(opacity * 100)}
                onChange={handleOpacity}
                className="sanborn-controls__slider"
                aria-label="Sanborn overlay opacity"
              />
              <span className="sanborn-controls__opacity-value">
                {Math.round(opacity * 100)}%
              </span>
            </div>
          </div>

          {/* Info text */}
          <p className="sanborn-controls__info">
            Sanborn fire insurance maps are highly detailed property surveys
            created from the 1860s through the 1960s. They show building
            footprints, construction materials, and street layouts — an
            invaluable record of how Chicago&apos;s built environment evolved.
          </p>
        </div>
      )}

      <style>{`
        .sanborn-controls {
          background: #161b22;
          border: 1px solid #30363d;
          border-radius: 6px;
          padding: 10px 12px;
          width: 250px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
          color: #c9d1d9;
        }

        .sanborn-controls__header {
          display: flex;
          align-items: center;
        }

        .sanborn-controls__toggle {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          user-select: none;
        }

        .sanborn-controls__checkbox {
          accent-color: #58a6ff;
          width: 14px;
          height: 14px;
          cursor: pointer;
        }

        .sanborn-controls__title {
          font-size: 13px;
          font-weight: 600;
          color: #e6edf3;
        }

        .sanborn-controls__body {
          margin-top: 10px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .sanborn-controls__opacity {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .sanborn-controls__opacity-label {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #8b949e;
        }

        .sanborn-controls__opacity-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .sanborn-controls__slider {
          flex: 1;
          accent-color: #58a6ff;
          height: 4px;
          cursor: pointer;
        }

        .sanborn-controls__opacity-value {
          font-size: 11px;
          color: #8b949e;
          min-width: 32px;
          text-align: right;
        }

        .sanborn-controls__info {
          font-size: 11px;
          line-height: 1.5;
          color: #8b949e;
          margin: 0;
          padding-top: 4px;
          border-top: 1px solid #21262d;
        }
      `}</style>
    </div>
  );
};
