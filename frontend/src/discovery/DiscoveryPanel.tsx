/**
 * "Business types" panel — browse what's in the search area for free, curate buildings on
 * the map, then send only those to the paid lookups. UI only; logic in useDiscovery.
 *
 * The paid step is two clicks on purpose: "Look up N buildings ($)" shows what will be
 * charged, then "Yes, look them up" spends it.
 */
import React, { useMemo, useState } from 'react';
import type { UseDiscoveryReturn } from './useDiscovery';

// ADJUSTABLE: Tracerfy batch price range per owner (name trace 1, address trace 2) and
// $ per credit, for the confirmation text. Mirrors OwnerBatchRunner's constants.
const OWNER_CREDITS_MAX = 2;
const DOLLARS_PER_CREDIT = 0.02;

interface DiscoveryPanelProps {
  discovery: UseDiscoveryReturn;
}

/** Panel component. O(t) time per render, O(t) space — t = business types listed. */
export const DiscoveryPanel: React.FC<DiscoveryPanelProps> = ({ discovery: d }) => {
  const [query, setQuery] = useState('');
  const [confirming, setConfirming] = useState(false);
  // O(t) time, O(t) space — t = types.
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return d.types;
    // O(t) time, O(t) space — t = types.
    return d.types.filter((t) => t.activity.toLowerCase().includes(q));
  }, [d.types, query]);
  // O(c) time, O(1) space — c = candidates.
  const businessCount = d.visible.reduce((n, c) => n + c.businesses.length, 0);
  const busy = d.lookupPhase === 'adding' || d.lookupPhase === 'looking-up';
  const maxOwnerCredits = d.visible.length * OWNER_CREDITS_MAX;
  // O(t) time, O(t) space — t = types shown.
  const typeItems = shown.map((t) => (
    <li key={t.activity}>
      <label className="tools-check">
        <input type="checkbox" checked={d.selected.has(t.activity)} onChange={() => d.toggleType(t.activity)} />
        <span className="discovery-type__name">{t.activity}</span>
        <span className="discovery-type__count">{t.count}</span>
      </label>
    </li>
  ));

  return (
    <section className="tools-section" aria-labelledby="discovery-heading">
      <h3 id="discovery-heading" className="tools-section__title">
        Business types
      </h3>
      <p className="tools-hint">
        Free — from City of Chicago business licences. Searching <strong>{d.areaLabel || '…'}</strong>.{' '}
        <button
          type="button"
          className="tools-link"
          onClick={d.refresh}
          title="Use the current map view (when no focus area is selected)"
        >
          Refresh
        </button>
      </p>
      {d.error && (
        <p className="tools-warning" role="status">
          {d.error}
        </p>
      )}

      <label htmlFor="discovery-search" className="visually-hidden">
        Search business types
      </label>
      <input
        id="discovery-search"
        className="tools-input"
        type="search"
        placeholder={d.typesLoading ? 'Loading types…' : `Search ${d.types.length} business types…`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {d.selected.size > 0 && (
        <div className="tools-links">
          <span className="tools-hint">{d.selected.size} selected</span>
          <button type="button" className="tools-link" onClick={d.clearTypes}>
            Clear
          </button>
        </div>
      )}
      <ul className="tools-checklist discovery-types" aria-label="Business types">
        {typeItems}
      </ul>

      {d.selected.size > 0 && (
        <p className="tools-hint" role="status">
          {d.candidatesLoading
            ? 'Finding buildings…'
            : `${d.visible.length} buildings highlighted (${businessCount} businesses). Click a pink marker on the map to remove it.`}
          {d.removedCount > 0 && (
            <>
              {' '}
              {d.removedCount} removed —{' '}
              <button type="button" className="tools-link" onClick={d.restoreRemoved}>
                restore
              </button>
            </>
          )}
        </p>
      )}

      {d.visible.length > 0 && !confirming && (
        <button
          type="button"
          className="tools-btn tools-btn--block discovery-lookup"
          disabled={busy}
          onClick={() => setConfirming(true)}
        >
          Look up these {d.visible.length} buildings ($)
        </button>
      )}
      {confirming && (
        <div className="discovery-confirm" role="group" aria-label="Confirm paid lookup">
          <p className="tools-hint">
            Adds {d.visible.length} buildings to the Contact list, then: owner records + business licences (free), phone
            lookups for up to {businessCount} businesses (Google — free monthly allowance, then about $0.035 each), and
            owner skip trace for up to {d.visible.length} owners (Tracerfy — up to {maxOwnerCredits} credits ≈ $
            {(maxOwnerCredits * DOLLARS_PER_CREDIT).toFixed(2)}). Saved answers are reused free.
          </p>
          <div className="tools-actions">
            <button
              type="button"
              className="tools-btn"
              onClick={() => {
                setConfirming(false);
                void d.lookUp();
              }}
            >
              Yes, look them up
            </button>
            <button type="button" className="tools-btn tools-btn--ghost" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {d.lookupMessage && (
        <p className={d.lookupPhase === 'error' ? 'tools-warning' : 'tools-hint'} role="status">
          {d.lookupMessage}
        </p>
      )}
    </section>
  );
};
