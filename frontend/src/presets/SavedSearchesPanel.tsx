/**
 * Saved searches panel (Tools sidebar) — save the current filters as a named preset,
 * re-apply or delete one. Pure UI: state and storage live in useSavedSearches.
 *
 * Saving under an existing name (same city, case-insensitive) overwrites that preset; the
 * button reads "Update" so that is never a surprise.
 */
import React, { useState } from 'react';
import { normaliseName, MAX_NAME_LENGTH } from './savedSearches';
import type { SavedSearch } from './savedSearches';
import type { UseSavedSearchesReturn } from './useSavedSearches';

interface SavedSearchesPanelProps {
  saved: UseSavedSearchesReturn;
}

/** "Oct 2, 3:15 PM" — empty for presets saved before timestamps were valid. O(1) time, O(1) space. */
function formatSavedAt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Row subtitle: save time and whether the preset restores the map position. */
// O(1) time, O(1) space
function formatPresetMeta(p: SavedSearch): string {
  // O(1) time, O(1) space — k = 2 (the array literal below always has two entries)
  return [formatSavedAt(p.savedAt), p.view ? 'with map position' : ''].filter(Boolean).join(' · ');
}

// O(n) time, O(n) space — n = this city's presets (find for the name match + one row per preset)
export const SavedSearchesPanel: React.FC<SavedSearchesPanelProps> = ({ saved }) => {
  const { presets, save, apply, remove } = saved;
  const [name, setName] = useState('');
  const [includeView, setIncludeView] = useState(true);
  // Two-click delete instead of a confirm() dialog: id awaiting the second click.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  const trimmed = normaliseName(name);
  // `presets` is already this city's list, so a name match is the preset that would be overwritten.
  // O(n) time, O(1) space — n = this city's presets
  const existing = trimmed ? presets.find((p) => p.name.toLowerCase() === trimmed.toLowerCase()) : undefined;

  // O(p + k) time, O(p + k) space — p = presets across all cities (save() upserts the whole list); k = filter sections snapshotted
  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed) return;
    save(trimmed, includeView);
    setStatus(`${existing ? 'Updated' : 'Saved'} “${trimmed}”.`);
    setName('');
  };

  // O(n) time, O(n) space — n = this city's presets (one row per preset)
  const presetItems = presets.map((p) => (
    <li key={p.id} className="saved-searches__item">
      <button
        type="button"
        className="saved-searches__apply"
        onClick={() => {
          apply(p.id);
          setStatus(`Applied “${p.name}”.`);
        }}
        title="Apply this preset"
      >
        <span className="saved-searches__name">{p.name}</span>
        <span className="saved-searches__meta">
          {formatPresetMeta(p)}
        </span>
      </button>
      {confirmingId === p.id ? (
        <span className="saved-searches__confirm">
          <button
            type="button"
            className="tools-link tools-link--danger"
            onClick={() => {
              remove(p.id);
              setConfirmingId(null);
              setStatus(`Deleted “${p.name}”.`);
            }}
          >
            Delete
          </button>
          <button type="button" className="tools-link" onClick={() => setConfirmingId(null)}>
            Keep
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="tools-link"
          onClick={() => setConfirmingId(p.id)}
          aria-label={`Delete preset ${p.name}`}
        >
          ✕
        </button>
      )}
    </li>
  ));

  return (
    <section className="tools-section" aria-labelledby="saved-searches-heading">
      <h3 id="saved-searches-heading" className="tools-section__title">Saved searches</h3>
      <p className="tools-hint">Save the current layers and filters as a preset.</p>

      <form onSubmit={handleSave}>
        <label htmlFor="saved-search-name" className="visually-hidden">Preset name</label>
        <input
          id="saved-search-name"
          className="tools-input"
          type="text"
          placeholder="Preset name…"
          maxLength={MAX_NAME_LENGTH}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <label className="tools-check">
          <input type="checkbox" checked={includeView} onChange={(e) => setIncludeView(e.target.checked)} />
          <span>Include map position</span>
        </label>
        <div className="tools-actions">
          <button type="submit" className="tools-btn" disabled={!trimmed}>
            {existing ? 'Update preset' : 'Save preset'}
          </button>
        </div>
      </form>

      <p className="visually-hidden" role="status">{status}</p>

      {presets.length > 0 && (
        <ul className="saved-searches" aria-label="Saved searches">
          {presetItems}
        </ul>
      )}
      {saved.storageNote && (
        <p className="tools-warning" role="status">
          {saved.storageNote}
        </p>
      )}
    </section>
  );
};
