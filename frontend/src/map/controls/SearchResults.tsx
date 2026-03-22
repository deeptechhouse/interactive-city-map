import React from 'react';
import type { SearchResult } from '../hooks/useSearch';
import { THEME } from '../../utils/colorSchemes';
import { POI_COLORS } from '../../utils/colorSchemes';

interface SearchResultsProps {
  results: SearchResult[];
  isLoading: boolean;
  error: string | null;
  onSelectResult: (result: SearchResult) => void;
}

const MAX_RESULTS = 20;

const styles = {
  container: {
    position: 'absolute' as const,
    top: '48px',
    left: '50%',
    transform: 'translateX(-50%)',
    width: '400px',
    maxHeight: '400px',
    overflowY: 'auto' as const,
    background: THEME.bgSecondary,
    border: `1px solid ${THEME.border}`,
    borderTop: 'none',
    borderRadius: '0 0 8px 8px',
    zIndex: 51,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 14px',
    cursor: 'pointer',
    borderBottom: `1px solid ${THEME.bgTertiary}`,
    transition: 'background 0.1s ease',
    fontSize: '13px',
  },
  icon: {
    width: '28px',
    height: '28px',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    flexShrink: 0 as const,
    fontWeight: 600 as const,
  },
  info: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden' as const,
  },
  name: {
    color: THEME.text,
    fontWeight: 500 as const,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
  },
  address: {
    color: THEME.textMuted,
    fontSize: '11px',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    marginTop: '2px',
  },
  badge: {
    display: 'inline-block',
    padding: '1px 6px',
    borderRadius: '10px',
    fontSize: '10px',
    fontWeight: 500 as const,
    flexShrink: 0 as const,
  },
  empty: {
    padding: '16px',
    textAlign: 'center' as const,
    color: THEME.textMuted,
    fontSize: '13px',
  },
  loading: {
    padding: '12px',
    textAlign: 'center' as const,
    color: THEME.textMuted,
    fontSize: '13px',
  },
} as const;

function getResultIcon(result: SearchResult): { symbol: string; bg: string; color: string } {
  if (result.type === 'building') {
    return { symbol: 'B', bg: `${THEME.accent}22`, color: THEME.accent };
  }
  const catColor = (result.category && POI_COLORS[result.category]) ?? THEME.warning;
  return { symbol: 'P', bg: `${catColor}22`, color: catColor };
}

function formatCategory(result: SearchResult): string {
  if (result.type === 'building') return 'Building';
  if (!result.category) return 'POI';
  return result.category
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export const SearchResults: React.FC<SearchResultsProps> = ({
  results,
  isLoading,
  error,
  onSelectResult,
}) => {
  if (isLoading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Searching...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.container}>
        <div style={{ ...styles.empty, color: THEME.danger }}>
          Search failed. Please try again.
        </div>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.empty}>No results found</div>
      </div>
    );
  }

  const displayed = results.slice(0, MAX_RESULTS);

  return (
    <div style={styles.container} role="listbox" aria-label="Search results">
      {displayed.map((result) => {
        const icon = getResultIcon(result);
        const categoryLabel = formatCategory(result);

        return (
          <div
            key={`${result.type}-${result.id}`}
            style={styles.item}
            role="option"
            tabIndex={0}
            onClick={() => onSelectResult(result)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelectResult(result);
              }
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = THEME.bgTertiary;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = 'transparent';
            }}
          >
            <div style={{ ...styles.icon, background: icon.bg, color: icon.color }}>
              {icon.symbol}
            </div>
            <div style={styles.info}>
              <div style={styles.name}>{result.name}</div>
              {result.address && <div style={styles.address}>{result.address}</div>}
            </div>
            <span
              style={{
                ...styles.badge,
                background: `${icon.color}18`,
                color: icon.color,
              }}
            >
              {categoryLabel}
            </span>
          </div>
        );
      })}
    </div>
  );
};
