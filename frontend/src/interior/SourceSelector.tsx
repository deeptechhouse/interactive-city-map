import React from 'react';
import { THEME } from '../utils/colorSchemes';

interface SourceSelectorProps {
  sources: Array<{ id: string; source_type: string; confidence: number }>;
  selectedSourceId: string | null;
  onSourceChange: (sourceId: string) => void;
}

const SOURCE_TYPE_LABELS: Record<string, string> = {
  sanborn: 'Sanborn',
  venue_scrape: 'Venue',
  upload: 'Upload',
  osm: 'OSM',
  county_records: 'County',
};

const SOURCE_TYPE_COLORS: Record<string, string> = {
  sanborn: '#d97706',
  venue_scrape: '#7c3aed',
  upload: '#2563eb',
  osm: '#16a34a',
  county_records: '#dc2626',
};

const getConfidenceColor = (confidence: number): string => {
  if (confidence >= 0.7) return THEME.success;
  if (confidence >= 0.4) return THEME.warning;
  return THEME.danger;
};

const styles = {
  container: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap' as const,
    padding: '8px 16px',
  },
  chip: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 10px',
    borderRadius: '12px',
    border: '1px solid',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 500,
    lineHeight: '1',
    transition: 'border-color 0.15s, background 0.15s',
  },
  confidenceDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    flexShrink: 0,
  },
} as const;

export const SourceSelector: React.FC<SourceSelectorProps> = ({
  sources,
  selectedSourceId,
  onSourceChange,
}) => {
  return (
    <div style={styles.container}>
      {sources.map((source) => {
        const isSelected = source.id === selectedSourceId;
        const typeColor = SOURCE_TYPE_COLORS[source.source_type] ?? THEME.accent;
        const label = SOURCE_TYPE_LABELS[source.source_type] ?? source.source_type;

        return (
          <button
            key={source.id}
            style={{
              ...styles.chip,
              background: isSelected
                ? `${typeColor}18`
                : THEME.bgSecondary,
              borderColor: isSelected ? typeColor : THEME.border,
              color: isSelected ? THEME.text : THEME.textMuted,
            }}
            onClick={() => onSourceChange(source.id)}
          >
            <span>{label}</span>
            <span
              style={{
                ...styles.confidenceDot,
                background: getConfidenceColor(source.confidence),
              }}
            />
          </button>
        );
      })}
    </div>
  );
};
