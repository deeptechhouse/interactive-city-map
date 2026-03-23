import React from 'react';
import { THEME } from '../utils/colorSchemes';

interface InteriorSearchResult {
  building_id: string;
  building_name: string | null;
  building_address: string | null;
  room_count: number;
  source_count: number;
}

interface InteriorSearchResultsProps {
  results: InteriorSearchResult[];
  onBuildingSelect: (buildingId: string) => void;
}

export const InteriorSearchResults: React.FC<InteriorSearchResultsProps> = ({
  results,
  onBuildingSelect,
}) => {
  if (results.length === 0) {
    return (
      <div style={styles.empty}>
        <span style={styles.emptyText}>No buildings with interior data found.</span>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {results.map((result) => (
        <button
          key={result.building_id}
          style={styles.card}
          onClick={() => onBuildingSelect(result.building_id)}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = THEME.accent;
            (e.currentTarget as HTMLButtonElement).style.background = THEME.bgTertiary;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = THEME.border;
            (e.currentTarget as HTMLButtonElement).style.background = THEME.bgSecondary;
          }}
        >
          <div style={styles.cardHeader}>
            <span style={styles.cardTitle}>
              {result.building_name ?? result.building_address ?? 'Unknown Building'}
            </span>
          </div>
          {result.building_address && result.building_name && (
            <span style={styles.cardAddress}>{result.building_address}</span>
          )}
          <div style={styles.cardStats}>
            <span style={styles.stat}>
              <span style={styles.statValue}>{result.room_count}</span> rooms
            </span>
            <span style={styles.statSeparator}>&middot;</span>
            <span style={styles.stat}>
              <span style={styles.statValue}>{result.source_count}</span> sources
            </span>
          </div>
        </button>
      ))}
    </div>
  );
};

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
    padding: '8px 0',
  },
  card: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
    padding: '12px',
    background: THEME.bgSecondary,
    border: `1px solid ${THEME.border}`,
    borderRadius: '8px',
    cursor: 'pointer',
    textAlign: 'left' as const,
    transition: 'border-color 0.15s, background 0.15s',
    width: '100%',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    fontSize: '14px',
    fontWeight: 600 as const,
    color: THEME.text,
  },
  cardAddress: {
    fontSize: '12px',
    color: THEME.textMuted,
  },
  cardStats: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginTop: '4px',
    fontSize: '12px',
    color: THEME.textMuted,
  },
  stat: {
    display: 'inline',
  },
  statValue: {
    color: THEME.accent,
    fontWeight: 600 as const,
  },
  statSeparator: {
    color: THEME.border,
  },
  empty: {
    padding: '24px 16px',
    textAlign: 'center' as const,
  },
  emptyText: {
    fontSize: '13px',
    color: THEME.textMuted,
  },
} as const;
