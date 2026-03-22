import React, { useState, useEffect, useRef } from 'react';
import type { City } from '../../types/city';
import { getCities } from '../../api/cities';

interface CitySelectorProps {
  currentCitySlug: string;
  onChange: (slug: string) => void;
}

export const CitySelector: React.FC<CitySelectorProps> = ({
  currentCitySlug,
  onChange,
}) => {
  const [cities, setCities] = useState<City[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getCities()
      .then((data) => {
        if (!cancelled) {
          setCities(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load cities');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close dropdown on Escape key
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [open]);

  const currentCity = cities.find((c) => c.slug === currentCitySlug);
  const displayName = currentCity
    ? `${currentCity.name}, ${currentCity.state}`
    : currentCitySlug;

  const handleSelect = (slug: string) => {
    setOpen(false);
    if (slug !== currentCitySlug) {
      onChange(slug);
    }
  };

  if (loading) {
    return (
      <div className="city-selector" style={selectorStyle}>
        <span style={loadingTextStyle}>Loading cities...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="city-selector" style={selectorStyle}>
        <span style={errorTextStyle}>Error loading cities</span>
      </div>
    );
  }

  return (
    <div
      className="city-selector"
      ref={dropdownRef}
      style={selectorStyle}
      role="combobox"
      aria-expanded={open}
      aria-haspopup="listbox"
      aria-label="Select a city"
    >
      <button
        className="city-selector__trigger"
        style={triggerStyle}
        onClick={() => setOpen(!open)}
        aria-label={`Current city: ${displayName}. Click to change.`}
      >
        <span style={cityNameStyle}>{displayName}</span>
        <span style={badgeStyle}>{cities.length} cities</span>
        <span style={arrowStyle}>{open ? '\u25B2' : '\u25BC'}</span>
      </button>
      {open && (
        <ul
          className="city-selector__dropdown"
          style={dropdownStyle}
          role="listbox"
          aria-label="Available cities"
        >
          {cities.map((city) => {
            const isActive = city.slug === currentCitySlug;
            return (
              <li
                key={city.slug}
                role="option"
                aria-selected={isActive}
                style={{
                  ...itemStyle,
                  ...(isActive ? activeItemStyle : {}),
                }}
                onClick={() => handleSelect(city.slug)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSelect(city.slug);
                  }
                }}
                tabIndex={0}
              >
                <span>{city.name}</span>
                <span style={stateAbbrStyle}>{city.state}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------
   Inline styles — dark theme matching the layer panel
   ------------------------------------------------------------------ */

const selectorStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  left: 12,
  zIndex: 20,
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontSize: 14,
  minWidth: 200,
};

const triggerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '8px 12px',
  background: '#161b22',
  color: '#c9d1d9',
  border: '1px solid #30363d',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: '20px',
};

const cityNameStyle: React.CSSProperties = {
  flex: 1,
  textAlign: 'left',
  fontWeight: 600,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const badgeStyle: React.CSSProperties = {
  background: '#58a6ff22',
  color: '#58a6ff',
  fontSize: 11,
  fontWeight: 600,
  padding: '2px 6px',
  borderRadius: 10,
  whiteSpace: 'nowrap',
};

const arrowStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#8b949e',
  marginLeft: 4,
};

const dropdownStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: '4px 0 0',
  padding: 4,
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: 6,
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
  maxHeight: 260,
  overflowY: 'auto',
};

const itemStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '8px 10px',
  borderRadius: 4,
  cursor: 'pointer',
  color: '#c9d1d9',
  transition: 'background 0.15s',
};

const activeItemStyle: React.CSSProperties = {
  background: '#58a6ff22',
  color: '#58a6ff',
  fontWeight: 600,
};

const stateAbbrStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#8b949e',
  marginLeft: 8,
};

const loadingTextStyle: React.CSSProperties = {
  padding: '8px 12px',
  color: '#8b949e',
  display: 'block',
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: 6,
};

const errorTextStyle: React.CSSProperties = {
  padding: '8px 12px',
  color: '#f85149',
  display: 'block',
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: 6,
};
