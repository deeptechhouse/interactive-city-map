import React from 'react';

/** Configuration for a single Sanborn map era. */
export interface SanbornEra {
  /** Unique key for this era (e.g. "1890s"). */
  id: string;
  /** Human-readable label shown in the UI. */
  label: string;
  /** PMTiles URL serving tiles for this era. */
  tilesUrl: string;
}

/**
 * Default Chicago Sanborn eras.
 *
 * Placeholder URLs — replace with actual hosted PMTiles endpoints once
 * the georeference_to_pmtiles.sh pipeline has been run.
 */
export const CHICAGO_SANBORN_ERAS: SanbornEra[] = [
  {
    id: '1890s',
    label: '1890s',
    tilesUrl: '/tiles/sanborn_1890s.pmtiles',
  },
  {
    id: '1905-1910',
    label: '1905–1910',
    tilesUrl: '/tiles/sanborn_1905-1910.pmtiles',
  },
  {
    id: '1920s-1950',
    label: '1920s–1950',
    tilesUrl: '/tiles/sanborn_1920s-1950.pmtiles',
  },
];

interface EraSelectorProps {
  /** Available eras to display. */
  eras: SanbornEra[];
  /** Currently selected era id, or null if none. */
  selectedEraId: string | null;
  /** Callback when user selects an era. */
  onSelectEra: (era: SanbornEra) => void;
}

/**
 * Radio-button pill group for selecting a Sanborn map era.
 *
 * Each era renders as a pill-style button. The selected pill receives
 * the accent highlight colour.
 */
export const EraSelector: React.FC<EraSelectorProps> = ({
  eras,
  selectedEraId,
  onSelectEra,
}) => {
  return (
    <fieldset className="era-selector" role="radiogroup" aria-label="Select Sanborn map era">
      <legend className="era-selector__legend">Era</legend>
      <div className="era-selector__pills">
        {eras.map((era) => {
          const isSelected = era.id === selectedEraId;
          return (
            <label
              key={era.id}
              className={`era-selector__pill ${isSelected ? 'era-selector__pill--active' : ''}`}
            >
              <input
                type="radio"
                name="sanborn-era"
                value={era.id}
                checked={isSelected}
                onChange={() => onSelectEra(era)}
                className="era-selector__radio"
              />
              <span className="era-selector__pill-text">{era.label}</span>
            </label>
          );
        })}
      </div>

      <style>{`
        .era-selector {
          border: none;
          margin: 0;
          padding: 0;
        }

        .era-selector__legend {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #8b949e;
          margin-bottom: 6px;
        }

        .era-selector__pills {
          display: flex;
          gap: 4px;
          flex-wrap: wrap;
        }

        .era-selector__radio {
          position: absolute;
          opacity: 0;
          width: 0;
          height: 0;
          pointer-events: none;
        }

        .era-selector__pill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 4px 12px;
          border-radius: 12px;
          border: 1px solid #30363d;
          background: #161b22;
          color: #c9d1d9;
          font-size: 12px;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s, color 0.15s;
          user-select: none;
        }

        .era-selector__pill:hover {
          border-color: #58a6ff;
          color: #e6edf3;
        }

        .era-selector__pill--active {
          background: #58a6ff;
          border-color: #58a6ff;
          color: #0d1117;
          font-weight: 600;
        }

        .era-selector__pill--active:hover {
          background: #79b8ff;
          border-color: #79b8ff;
          color: #0d1117;
        }

        .era-selector__pill-text {
          pointer-events: none;
        }
      `}</style>
    </fieldset>
  );
};
