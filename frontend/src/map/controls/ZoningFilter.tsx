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
  /** City catalogue (defaults to Chicago's). Mount with key={citySlug} so switching city
   *  remounts the panel with the new catalogue and section. */
  classes?: readonly ZoneClass[];
  /** City slug — selects the preset section; Chicago keeps the original key. */
  citySlug?: string;
}

/** Layer IDs that belong to the zoning layer (see layers/ZoningLayer.ts). */
const ZONING_LAYER_IDS = ['zoning-fill', 'zoning-stroke', 'zoning-label'];

// Saved in presets — the key is persisted, never rename it. Value = VISIBLE type keys.
// Lives in the search store, not useState, because this panel unmounts while the layer is off.
const ACTIVE_TYPES_SECTION = setSection('zoning.activeTypes', allTypeKeys(), 'all');

// Other cities get their own section (a Detroit "R2" must never be applied to Chicago).
// Section identity matters to the search store, so each is created once and cached.
const CITY_SECTIONS = new Map<string, ReturnType<typeof setSection>>();

/**
 * Preset section for a city's zoning selection.
 * O(t) time, O(t) space — t = that city's type keys (paid once per city, then cached).
 */
function zoningSection(citySlug: string, classes: readonly ZoneClass[]): ReturnType<typeof setSection> {
  if (citySlug === 'chicago') return ACTIVE_TYPES_SECTION;
  let section = CITY_SECTIONS.get(citySlug);
  if (!section) {
    section = setSection(`zoning.activeTypes.${citySlug}`, allTypeKeys(classes), 'all');
    CITY_SECTIONS.set(citySlug, section);
  }
  return section;
}

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

// O(t) time per render, O(t) space — t = zoning types in the city's catalogue
export const ZoningFilter: React.FC<ZoningFilterProps> = ({ map, classes = ZONE_CLASSES, citySlug = 'chicago' }) => {
  const [active, setActive] = useSearchSection(zoningSection(citySlug, classes));
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
      // O(t_c) time, O(1) space — t_c = types in the class
      const allOn = keys.every((k) => prev.has(k));
      const next = new Set(prev);
      // O(t_c) time, O(1) space — t_c = types in the class
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
    const filter = buildZoningFilter(active, classes) as maplibregl.FilterSpecification | null;
    // O(1) time, O(1) space — n = 3 zoning sublayers
    for (const layerId of ZONING_LAYER_IDS) {
      try {
        if (map.getLayer(layerId)) map.setFilter(layerId, filter);
      } catch {
        /* layer removed between check and set — harmless */
      }
    }
  }, [map, active, classes]);

  /**
   * Checkbox rows for one class's types plus its "Other" bucket.
   * O(t_c) time, O(t_c) space — t_c = types in the class.
   */
  const typeRows = (cls: ZoneClass) => {
    const options = [
      // O(t_c) time, O(t_c) space — t_c = types in the class
      ...cls.types.map((t) => ({ key: t.key, label: t.label })),
      { key: `${cls.key}${OTHER_SUFFIX}`, label: `Other ${cls.label.toLowerCase()}` },
    ];
    // O(t_c) time, O(t_c) space — t_c = options in the class
    return options.map((t) => (
      <label key={t.key} style={styles.typeRow}>
        <input
          type="checkbox"
          checked={active.has(t.key)}
          onChange={() => toggleType(t.key)}
          style={styles.checkbox}
        />
        {t.label}
      </label>
    ));
  };

  // O(t) time, O(t) space — t = types across classes (each class handles only its own)
  const classBlocks = classes.map((cls) => {
    const keys = typeKeysOfClass(cls);
    // bigo-lint: disable=BIGO006 — amortised: each class filters only its own keys (t)
    // O(t_c) time, O(t_c) space — t_c = types in the class
    const onCount = keys.filter((k) => active.has(k)).length;
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
            {typeRows(cls)}
          </div>
        )}
      </div>
    );
  });

  return (
    <div style={styles.container}>
      <div style={styles.title}>Zoning types</div>
      {classBlocks}
    </div>
  );
};
