/**
 * Focus Areas panel — pick zip codes / police districts / wards; everything outside is
 * grayed out. Pure UI: all state and map work lives in useFocusArea.
 */
import React, { useMemo, useState } from 'react';
import { FOCUS_KINDS, type FocusKind } from './focusGeometry';
import type { AreaOption } from './focusAreas';
import type { UseFocusAreaReturn } from './useFocusArea';

interface FocusAreaPanelProps {
  focus: UseFocusAreaReturn;
}

interface KindListProps {
  kind: FocusKind;
  /** This city's options and name for the kind (from the city profile via useFocusArea). */
  options: readonly AreaOption[];
  label: string;
  selected: readonly string[];
  onToggle: (kind: FocusKind, id: string) => void;
  onSetAll: (kind: FocusKind, ids: readonly string[]) => void;
}

/** One collapsible, searchable checkbox list (e.g. all 50 wards). */
const KindList: React.FC<KindListProps> = ({ kind, options, label, selected, onToggle, onSetAll }) => {
  const [query, setQuery] = useState('');
  const selectedSet = useMemo(() => new Set(selected), [selected]); // O(s)
  // O(n) filter — n = options for this kind (≤ 59).
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const searchId = `focus-search-${kind}`;
  return (
    <details className="tools-section__group" open={selected.length > 0}>
      <summary className="tools-section__summary">
        {label}
        {selected.length > 0 && <span className="tools-badge">{selected.length}</span>}
      </summary>
      <label htmlFor={searchId} className="visually-hidden">
        Search {label}
      </label>
      <input
        id={searchId}
        className="tools-input"
        type="search"
        placeholder={`Search ${label.toLowerCase()}…`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="tools-links">
        <button type="button" className="tools-link" onClick={() => onSetAll(kind, visible.map((o) => o.id))}>
          Select {query ? 'matches' : 'all'}
        </button>
        <button type="button" className="tools-link" onClick={() => onSetAll(kind, [])}>
          None
        </button>
      </div>
      <ul className="tools-checklist" aria-label={label}>
        {visible.map((opt) => (
          <li key={opt.id}>
            <label className="tools-check">
              <input
                type="checkbox"
                checked={selectedSet.has(opt.id)}
                onChange={() => onToggle(kind, opt.id)}
              />
              <span>{opt.label}</span>
            </label>
          </li>
        ))}
      </ul>
    </details>
  );
};

export const FocusAreaPanel: React.FC<FocusAreaPanelProps> = ({ focus }) => {
  const { selection, shape, isEmptyResult, toggle, setKindIds, setMode, clear, zoomToFocus } = focus;
  const total = selection.zip.length + selection.police.length + selection.ward.length;

  return (
    <section className="tools-section" aria-labelledby="focus-heading">
      <h3 id="focus-heading" className="tools-section__title">Focus areas</h3>
      <p className="tools-hint">Areas outside your selection are grayed out.</p>

      <fieldset className="tools-mode">
        <legend className="visually-hidden">How to combine areas</legend>
        <label className="tools-check">
          <input
            type="radio"
            name="focus-mode"
            checked={selection.mode === 'union'}
            onChange={() => setMode('union')}
          />
          <span title="Show anything inside any selected area">Any selected (union)</span>
        </label>
        <label className="tools-check">
          <input
            type="radio"
            name="focus-mode"
            checked={selection.mode === 'intersection'}
            onChange={() => setMode('intersection')}
          />
          <span title="Show only where a selected area of every type overlaps">Overlap only (intersection)</span>
        </label>
      </fieldset>

      {FOCUS_KINDS.map((kind) => (
        <KindList
          key={kind}
          kind={kind}
          options={focus.options[kind]}
          label={focus.kindLabels[kind]}
          selected={selection[kind]}
          onToggle={toggle}
          onSetAll={setKindIds}
        />
      ))}

      {isEmptyResult && (
        <p className="tools-warning" role="status">
          The selected areas don’t overlap. Switch to “Any selected” or change the selection.
        </p>
      )}

      <div className="tools-actions">
        <button type="button" className="tools-btn" onClick={zoomToFocus} disabled={!shape}>
          Zoom to focus
        </button>
        <button type="button" className="tools-btn tools-btn--ghost" onClick={clear} disabled={total === 0}>
          Clear
        </button>
      </div>
    </section>
  );
};
