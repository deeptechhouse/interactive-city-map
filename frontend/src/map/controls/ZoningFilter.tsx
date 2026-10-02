/**
 * Zoning type filter — shown when the Zoning Districts layer is on.
 *
 * Each class (Residential, Commercial…) has a tri-state checkbox that ticks all of its
 * types, and expands to list the specific districts (RS-3, B1, PMD…). The catalogue and
 * the MapLibre filter expression live in utils/zoningTypes.ts; this file is UI + applying
 * the filter to the three zoning sublayers.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { THEME } from '../../utils/colorSchemes';
import {
  OTHER_SUFFIX,
  ZONE_CLASSES,
  allTypeKeys,
  buildZoningFilter,
  typeKeysOfClass,
  type ZoneClass,
} from '../../utils/zoningTypes';
import { setSection } from '../../presets/searchState';
import { useSearchSection } from '../../presets/SearchStateContext';

interface ZoningFilterProps {
  map: maplibregl.Map | null;
}

/** Layer IDs that belong to the zoning layer (see layers/ZoningLayer.ts). */
const ZONING_LAYER_IDS = ['zoning-fill', 'zoning-stroke', 'zoning-label'];

// Saved in presets — the key is persisted, never rename it. Value = VISIBLE type keys.
// Lives in the search store, not useState, because this panel unmounts while the layer is off.
const ACTIVE_TYPES_SECTION = setSection('zoning.activeTypes', allTypeKeys(), 'all');

const styles = {
  container: {
    padding: '8px 12px',
    borderTop: `1px solid ${THEME.bgTertiary}`,
  },
  title: {
    fontSize: '10px',
    fontWeight: 600 as const,
    color: THEME.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    marginBottom: '6px',
  },
  classRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '2px 0',
    fontSize: '11px',
    color: THEME.text,
  },
  typeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '1px 0',
    fontSize: '10px',
    color: THEME.textMuted,
    cursor: 'pointer',
  },
  checkbox: {
    accentColor: THEME.accent,
    width: '11px',
    height: '11px',
    cursor: 'pointer',
  },
  colorDot: {
    width: '8px',
    height: '8px',
    borderRadius: '2px',
    flexShrink: 0 as const,
  },
  expand: {
    background: 'none',
    border: 'none',
    color: THEME.textMuted,
    cursor: 'pointer',
    fontSize: '10px',
    padding: '0 4px',
    marginLeft: 'auto',
  },
} as const;

/** Checkbox that can show the "some but not all" state (not expressible as a JSX prop). */
const TriStateCheckbox: React.FC<{
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
  label: string;
}> = ({ checked, indeterminate, onChange, label }) => {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      style={styles.checkbox}
      aria-label={label}
    />
  );
};

export const ZoningFilter: React.FC<ZoningFilterProps> = ({ map }) => {
  const [active, setActive] = useSearchSection(ACTIVE_TYPES_SECTION);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // O(1) per toggle (Set copy is O(t), t ≈ 40 types).
  const toggleType = useCallback((key: string) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, [setActive]);

  // Tick/untick every type in a class. O(t_c) — types in the class.
  const toggleClass = useCallback((cls: ZoneClass) => {
    setActive((prev) => {
      const keys = typeKeysOfClass(cls);
      const allOn = keys.every((k) => prev.has(k));
      const next = new Set(prev);
      for (const k of keys) {
        if (allOn) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  }, [setActive]);

  const toggleExpanded = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Apply the filter to every zoning sublayer. O(t) to build the expression.
  useEffect(() => {
    if (!map) return;
    const filter = buildZoningFilter(active) as maplibregl.FilterSpecification | null;
    for (const layerId of ZONING_LAYER_IDS) {
      try {
        if (map.getLayer(layerId)) map.setFilter(layerId, filter);
      } catch {
        /* layer removed between check and set — harmless */
      }
    }
  }, [map, active]);

  return (
    <div style={styles.container}>
      <div style={styles.title}>Zoning types</div>
      {ZONE_CLASSES.map((cls) => {
        const keys = typeKeysOfClass(cls);
        const onCount = keys.filter((k) => active.has(k)).length; // O(t_c)
        const isOpen = expanded.has(cls.key);
        return (
          <div key={cls.key}>
            <div style={styles.classRow}>
              <TriStateCheckbox
                checked={onCount === keys.length}
                indeterminate={onCount > 0 && onCount < keys.length}
                onChange={() => toggleClass(cls)}
                label={`All ${cls.label} zoning`}
              />
              <span style={{ ...styles.colorDot, background: cls.color }} />
              <span>{cls.label}</span>
              {cls.types.length > 0 && (
                <button
                  type="button"
                  style={styles.expand}
                  onClick={() => toggleExpanded(cls.key)}
                  aria-expanded={isOpen}
                  aria-label={`${isOpen ? 'Hide' : 'Show'} ${cls.label} types`}
                >
                  {isOpen ? '▾' : '▸'} {onCount}/{keys.length}
                </button>
              )}
            </div>
            {isOpen && (
              <div style={{ paddingLeft: '18px', borderLeft: `2px solid ${cls.color}`, margin: '2px 0 4px 4px' }}>
                {[...cls.types.map((t) => ({ key: t.key, label: t.label })),
                  { key: `${cls.key}${OTHER_SUFFIX}`, label: `Other ${cls.label.toLowerCase()}` }].map((t) => (
                  <label key={t.key} style={styles.typeRow}>
                    <input
                      type="checkbox"
                      checked={active.has(t.key)}
                      onChange={() => toggleType(t.key)}
                      style={styles.checkbox}
                    />
                    {t.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
