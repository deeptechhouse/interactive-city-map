import React from 'react';
import { THEME } from '../utils/colorSchemes';

interface SourceAttributionProps {
  sourceType: string;
  sourceDate: string | null;
  confidence: number;
  sourceUrl: string | null;
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
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    color: THEME.textMuted,
    padding: '8px 0',
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  link: {
    color: THEME.accent,
    textDecoration: 'none',
  },
  separator: {
    color: THEME.border,
  },
} as const;

export const SourceAttribution: React.FC<SourceAttributionProps> = ({
  sourceType,
  sourceDate,
  confidence,
  sourceUrl,
}) => {
  const typeColor = SOURCE_TYPE_COLORS[sourceType] ?? THEME.accent;
  const label = SOURCE_TYPE_LABELS[sourceType] ?? sourceType;
  const confidenceColor = getConfidenceColor(confidence);
  const confidencePercent = `${Math.round(confidence * 100)}%`;

  return (
    <div style={styles.container}>
      <span style={{ ...styles.dot, background: typeColor }} />
      {sourceUrl ? (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={styles.link}
        >
          {label}
        </a>
      ) : (
        <span>{label}</span>
      )}
      <span style={styles.separator}>&middot;</span>
      <span>{sourceDate ?? 'Unknown date'}</span>
      <span style={styles.separator}>&middot;</span>
      <span style={{ color: confidenceColor }}>{confidencePercent}</span>
    </div>
  );
};
