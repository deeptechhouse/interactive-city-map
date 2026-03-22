import React, { useCallback, useRef, useState } from 'react';
import { useSearch } from '../hooks/useSearch';
import { SearchResults } from './SearchResults';
import type { SearchResult } from '../hooks/useSearch';
import { THEME } from '../../utils/colorSchemes';
import { POI_CATEGORY_LABELS } from '../../types/poi';

interface SearchBarProps {
  citySlug: string;
  onSelectResult: (result: SearchResult) => void;
}

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'buildings', label: 'Buildings' },
  ...Object.entries(POI_CATEGORY_LABELS).map(([key, label]) => ({
    value: key,
    label,
  })),
];

const styles = {
  wrapper: {
    position: 'absolute' as const,
    top: '12px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 50,
    width: '400px',
  },
  inputRow: {
    display: 'flex',
    alignItems: 'center',
    background: THEME.bgSecondary,
    border: `1px solid ${THEME.border}`,
    borderRadius: '8px',
    overflow: 'hidden',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
  },
  inputRowOpen: {
    borderRadius: '8px 8px 0 0',
  },
  searchIcon: {
    padding: '0 10px 0 14px',
    color: THEME.textMuted,
    fontSize: '14px',
    flexShrink: 0 as const,
    display: 'flex',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: THEME.text,
    fontSize: '14px',
    padding: '10px 0',
    fontFamily: 'inherit',
  },
  select: {
    background: THEME.bgTertiary,
    border: 'none',
    borderLeft: `1px solid ${THEME.border}`,
    color: THEME.textMuted,
    fontSize: '11px',
    padding: '10px 8px',
    outline: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
} as const;

export const SearchBar: React.FC<SearchBarProps> = ({ citySlug, onSelectResult }) => {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [showResults, setShowResults] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { results, isLoading, error, search, clearResults } = useSearch(citySlug);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setQuery(value);
      if (value.trim().length >= 2) {
        setShowResults(true);
        search(value, category);
      } else {
        setShowResults(false);
        clearResults();
      }
    },
    [category, search, clearResults],
  );

  const handleCategoryChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      setCategory(value);
      if (query.trim().length >= 2) {
        search(query, value);
      }
    },
    [query, search],
  );

  const handleSelectResult = useCallback(
    (result: SearchResult) => {
      setShowResults(false);
      setQuery(result.name);
      onSelectResult(result);
    },
    [onSelectResult],
  );

  const handleBlur = useCallback(() => {
    // Delay hiding to allow click on results
    setTimeout(() => setShowResults(false), 200);
  }, []);

  const handleFocus = useCallback(() => {
    if (results.length > 0 || isLoading || error) {
      setShowResults(true);
    }
  }, [results.length, isLoading, error]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowResults(false);
        inputRef.current?.blur();
      }
    },
    [],
  );

  const isOpen = showResults && (results.length > 0 || isLoading || error !== null);

  return (
    <div style={styles.wrapper}>
      <div
        style={{
          ...styles.inputRow,
          ...(isOpen ? styles.inputRowOpen : {}),
        }}
      >
        <span style={styles.searchIcon} aria-hidden="true">
          &#128269;
        </span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder="Search buildings and places..."
          style={styles.input}
          aria-label="Search"
          autoComplete="off"
        />
        <select
          value={category}
          onChange={handleCategoryChange}
          style={styles.select}
          aria-label="Filter by category"
        >
          {CATEGORY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      {isOpen && (
        <SearchResults
          results={results}
          isLoading={isLoading}
          error={error}
          onSelectResult={handleSelectResult}
        />
      )}
    </div>
  );
};
