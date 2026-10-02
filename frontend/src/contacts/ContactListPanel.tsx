/**
 * Contact List panel — buildings picked on the map, their owner(s) of record and the
 * businesses at the address, all editable, exportable as CSV.
 *
 * Pure UI over ContactListStore: every change goes through a store method, which also
 * saves the list. Inputs commit on blur (not every keystroke) so typing doesn't rewrite
 * localStorage per character.
 *
 * Owner skip trace (paid) — the GUI offers ONLY the batch ("Look up owners") plus a
 * per-owner "Re-check" that sends a one-building batch. Owners with a trusted person
 * name (ownerNames.ts) are traced by name at 1 credit; the rest by address at 2. The instant lookup (5 credits) is still wired end to end but its
 * button is hidden: flip SHOW_INSTANT_OWNER_LOOKUP to bring it back.
 */
import React, { useState } from 'react';
import type { ContactListStore } from './ContactListStore';
import { batchCostRange, DOLLARS_PER_CREDIT, type BatchState, type OwnerBatchRunner } from './OwnerBatchRunner';
import type { BatchCandidate } from './ContactListStore';
import { traceNameFor } from './ownerNames';
import { saveCsv, saveMessage } from './csvSave';
import { formatLookupDate, IL_SOS_SEARCH_URL, safeHref } from './links';
import {
  formatAddress,
  letterAddress,
  sameAddress,
  type BusinessContact,
  type LookupState,
  type OwnerContact,
  type PhoneStatus,
  type SelectedBuilding,
} from './types';

const COMPANY_STATUS_TEXT: Partial<Record<LookupState, string>> = {
  pending: 'Searching for the owner company…',
  not_found: 'No company listing found for this owner.',
  unavailable: 'Company search unavailable.',
};

// ADJUSTABLE: true shows the per-owner INSTANT lookup button again (5 Tracerfy credits
// per hit, DNC-checked) next to the batch. Hidden 2026-10-02 to keep costs down.
const SHOW_INSTANT_OWNER_LOOKUP = false;

const dollars = (credits: number) => `$${(credits * DOLLARS_PER_CREDIT).toFixed(2)}`;

const SKIP_TRACE_BUTTON: Record<LookupState, string> = {
  idle: 'Find owner phone & email ($)',
  pending: 'Searching…',
  found: 'Search again ($)',
  not_found: 'No match — try again ($)',
  unavailable: 'Retry owner search ($)',
};

interface ContactListPanelProps {
  store: ContactListStore;
  buildings: readonly SelectedBuilding[];
  selectionMode: boolean;
  onToggleSelectionMode: () => void;
  lookupAvailable: boolean;
  batchRunner: OwnerBatchRunner;
  batch: BatchState;
}

/** Status line + button for the owner batch. */
const BatchBar: React.FC<{ runner: OwnerBatchRunner; batch: BatchState; candidates: readonly BatchCandidate[] }> = ({
  runner,
  batch,
  candidates,
}) => {
  const running = batch.phase === 'running' || batch.phase === 'starting';
  const { low, high, byName } = batchCostRange(candidates);
  const estimate = low === high ? `up to ${high} credits ≈ ${dollars(high)}` : `≈ ${low}–${high} credits (${dollars(low)}–${dollars(high)})`;
  return (
    <div className="contact-batch">
      <button
        type="button"
        className="tools-btn tools-btn--block"
        disabled={running || candidates.length === 0}
        onClick={() => void runner.start()}
        title="Tracerfy batch skip trace: the person behind each owner, with phones and emails. Charged only for owners found; saved answers are reused free."
      >
        {running
          ? 'Looking up owners…'
          : candidates.length === 0
            ? 'All owners looked up'
            : `Look up owners (${candidates.length}) · ${estimate}`}
      </button>
      {!running && candidates.length > 0 && (
        <p className="tools-hint">
          {byName > 0
            ? `${byName} by owner name (1 credit if matched, else retried by address), ${candidates.length - byName} by address (2). Misses are free.`
            : 'All by address (2 credits per owner found). Misses are free.'}
        </p>
      )}
      {running && (
        <p className="tools-hint" role="status">
          Batch {batch.phase === 'starting' ? 'starting' : 'running at Tracerfy'} — usually 1–5 minutes. Checking every 30 s; you can keep working or close the page.
        </p>
      )}
      {batch.phase === 'done' && (
        <p className="tools-hint" role="status">
          Last batch: found {batch.found} of {batch.total}
          {batch.reused ? ` (${batch.reused} reused from saved lookups, free)` : ''}.
          {batch.exportNote ? ` ${batch.exportNote}` : ' Saving CSV…'}
        </p>
      )}
      {batch.phase === 'error' && (
        <p className="tools-warning" role="status">
          {batch.message}{' '}
          {batch.jobId && (
            <button type="button" className="tools-link" onClick={() => runner.checkAgain()}>
              Check again
            </button>
          )}
        </p>
      )}
    </div>
  );
};

/** Text input that only reports its value when the user leaves the field. */
const EditField: React.FC<{
  value: string;
  label: string;
  placeholder?: string;
  onCommit: (value: string) => void;
}> = ({ value, label, placeholder, onCommit }) => {
  const [draft, setDraft] = useState(value);
  // Pick up external changes (e.g. a lookup finished) when not mid-edit.
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value);
  }
  return (
    <input
      className="tools-input tools-input--inline"
      aria-label={label}
      placeholder={placeholder ?? label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft.trim())}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
};

const PHONE_STATUS_TEXT: Record<PhoneStatus, string> = {
  pending: 'looking up…',
  found: '',
  not_found: 'no listing found',
  unavailable: 'lookup unavailable',
  manual: 'entered by hand',
};

function phoneHint(b: BusinessContact): string {
  if (b.phoneStatus === 'found') return `via ${b.phoneSource}`;
  return PHONE_STATUS_TEXT[b.phoneStatus];
}

/** One owner of record: identity, where letters go, and how to reach them. */
const OwnerBlock: React.FC<{
  store: ContactListStore;
  runner: OwnerBatchRunner;
  batchRunning: boolean;
  buildingId: string;
  index: number;
  o: OwnerContact;
}> = ({ store, runner, batchRunning, buildingId, index, o }) => {
  const set = (patch: Partial<OwnerContact>) => store.updateOwner(buildingId, index, patch);
  const mail = letterAddress(o);
  const differ = !!o.ownerAddress.street && !!o.taxBillAddress.street && !sameAddress(o.ownerAddress, o.taxBillAddress);
  const website = safeHref(o.website);
  const radioName = `letter-${buildingId}-${index}`;
  return (
    <div className="contact-row">
      <EditField value={o.name} label="Owner name" onCommit={(v) => set({ name: v })} />
      {o.isCompany && (
        <span className="contact-row__meta">
          <a href={IL_SOS_SEARCH_URL} target="_blank" rel="noopener noreferrer" className="tools-link">
            IL Secretary of State lookup ↗
          </a>{' '}
          <button type="button" className="tools-link" onClick={() => void navigator.clipboard?.writeText(o.name)}>
            Copy name
          </button>
        </span>
      )}
      <EditField
        value={o.contactPerson}
        label="Contact person"
        placeholder="Contact person (Attn:)"
        onCommit={(v) => set({ contactPerson: v })}
      />

      {differ ? (
        <fieldset className="tools-mode contact-letter">
          <legend className="contact-row__meta">Letters go to</legend>
          <label className="tools-check">
            <input type="radio" name={radioName} checked={o.letterTo === 'owner'} onChange={() => set({ letterTo: 'owner' })} />
            <span>Owner address — {formatAddress(o.ownerAddress)}</span>
          </label>
          <label className="tools-check">
            <input type="radio" name={radioName} checked={o.letterTo === 'taxBill'} onChange={() => set({ letterTo: 'taxBill' })} />
            <span>Tax-bill address — {formatAddress(o.taxBillAddress)}</span>
          </label>
        </fieldset>
      ) : (
        <div className="contact-row__meta">Mailing address{o.pin ? ' (county record)' : ''}</div>
      )}
      <EditField
        value={mail.street}
        label="Mail street"
        placeholder="Street"
        onCommit={(v) => store.updateLetterAddress(buildingId, index, { street: v })}
      />
      <div className="contact-address-row">
        <EditField value={mail.city} label="Mail city" placeholder="City" onCommit={(v) => store.updateLetterAddress(buildingId, index, { city: v })} />
        <EditField value={mail.state} label="Mail state" placeholder="ST" onCommit={(v) => store.updateLetterAddress(buildingId, index, { state: v })} />
        <EditField value={mail.zip} label="Mail ZIP" placeholder="ZIP" onCommit={(v) => store.updateLetterAddress(buildingId, index, { zip: v })} />
      </div>

      <EditField value={o.phone} label="Owner phone" placeholder="Phone" onCommit={(v) => set({ phone: v })} />
      {(o.phoneNote || o.phoneDnc) && (
        <span className="contact-row__meta">
          {o.phoneDnc && <span className="contact-dnc" title="On the Do-Not-Call registry — no unsolicited sales calls">DNC</span>}{' '}
          {o.phoneNote}
        </span>
      )}
      {o.extraPhones.map((p) => (
        <span key={p.number} className="contact-row__meta">
          also {p.number}
          {p.type ? ` · ${p.type}` : ''} {p.dnc && <span className="contact-dnc">DNC</span>}
        </span>
      ))}
      <EditField value={o.email} label="Owner email" placeholder="Email" onCommit={(v) => set({ email: v })} />
      {o.extraEmails.map((e) => (
        <span key={e} className="contact-row__meta">also {e}</span>
      ))}
      {website && (
        <a className="tools-link contact-row__meta" href={website} target="_blank" rel="noopener noreferrer">
          {o.website} ↗
        </a>
      )}
      {COMPANY_STATUS_TEXT[o.companyLookup] && <span className="contact-row__meta">{COMPANY_STATUS_TEXT[o.companyLookup]}</span>}
      {/* Batches trace a building's FIRST owner, so only it gets the plan line. */}
      <OwnerLookupInfo o={o} plannable={index === 0} />
      {/* The batch looks up each PROPERTY once, filling its first owner — so Re-check lives there. */}
      {index === 0 && (o.skipTrace === 'found' || o.skipTrace === 'not_found') && (
        <button
          type="button"
          className="tools-link"
          disabled={batchRunning}
          onClick={() => void runner.recheck(buildingId)}
          title="Paid: look this owner up again at Tracerfy (one-building batch, 2 credits if found), replacing the saved answer"
        >
          Re-check ($)
        </button>
      )}
      {SHOW_INSTANT_OWNER_LOOKUP && (
        <button
          type="button"
          className="tools-link"
          disabled={o.skipTrace === 'pending'}
          onClick={() => void store.skipTraceOwner(buildingId, index, o.skipTrace === 'found')}
          title="Paid instant skip trace (Tracerfy, 5 credits per match, DNC-checked)"
        >
          {SKIP_TRACE_BUTTON[o.skipTrace]}
        </button>
      )}
    </div>
  );
};

/** "Owner looked up Oct 2, 2026 · DNC not checked" / "searching…" / "no match". */
const OwnerLookupInfo: React.FC<{ o: OwnerContact; plannable: boolean }> = ({ o, plannable }) => {
  const date = formatLookupDate(o.skipTracedAt);
  if (o.skipTrace === 'pending') return <span className="contact-row__meta">Owner lookup: searching…</span>;
  if (o.skipTrace === 'idle' || o.skipTrace === 'unavailable') {
    if (!plannable) return null;
    const name = traceNameFor(o);
    return (
      <span className="contact-row__meta">
        {name
          ? `Will search by name: ${name.first} ${name.last} (1 credit${name.source === 'contact' ? ', from Contact person' : ''})`
          : 'Will search by address (2 credits)'}
      </span>
    );
  }
  if (o.skipTrace === 'not_found') {
    return <span className="contact-row__meta">Owner lookup: no match{date ? ` (${date})` : ''}</span>;
  }
  if (o.skipTrace !== 'found') return null;
  return (
    <span className="contact-row__meta">
      Owner {o.skipTraceMethod === 'name' ? 'found by name' : o.skipTraceMethod === 'address' ? 'found by address' : 'looked up'}{' '}
      {date || 'earlier'}
      {!o.dncChecked && (
        <>
          {' · '}
          <span className="contact-dnc-unchecked" title="Batch results don't include Do-Not-Call status. Check before any sales call.">
            DNC not checked
          </span>
        </>
      )}
    </span>
  );
};

const BuildingCard: React.FC<{
  store: ContactListStore;
  runner: OwnerBatchRunner;
  batchRunning: boolean;
  b: SelectedBuilding;
}> = ({ store, runner, batchRunning, b }) => {
  const title = b.address || `Building ${b.id.slice(0, 8)}`;
  return (
    <li className="contact-card">
      <div className="contact-card__head">
        <strong>{title}</strong>
        <span className="contact-card__actions">
          {b.status === 'error' && (
            <button type="button" className="tools-link" onClick={() => store.retry(b.id)}>
              Retry
            </button>
          )}
          <button
            type="button"
            className="tools-link tools-link--danger"
            onClick={() => store.remove(b.id)}
            aria-label={`Remove ${title} from list`}
          >
            Remove
          </button>
        </span>
      </div>
      {b.status === 'loading' && <p className="tools-hint" role="status">Looking up owner and businesses…</p>}
      {b.note && <p className="tools-hint">{b.note}</p>}

      <div className="contact-card__section">Owner of record</div>
      {b.owners.length === 0 && b.status !== 'loading' && <p className="tools-hint">No owner record found.</p>}
      {b.owners.map((o, i) => (
        <OwnerBlock
          key={`${o.pin}-${i}`}
          store={store}
          runner={runner}
          batchRunning={batchRunning}
          buildingId={b.id}
          index={i}
          o={o}
        />
      ))}
      <button type="button" className="tools-link" onClick={() => store.addOwner(b.id)}>
        + Add owner
      </button>

      <div className="contact-card__section">Businesses ({b.businesses.length})</div>
      {b.businesses.length === 0 && b.status !== 'loading' && (
        <p className="tools-hint">No active business licences at this address.</p>
      )}
      {b.businesses.map((x) => (
        <div key={x.id} className="contact-row">
          <div className="contact-row__name">{x.name}</div>
          {x.legalName !== x.name && <div className="contact-row__meta">{x.legalName}</div>}
          {x.activity && <div className="contact-row__meta">{x.activity}</div>}
          <EditField value={x.phone} label={`Phone for ${x.name}`} placeholder="Phone" onCommit={(v) => store.updateBusiness(b.id, x.id, { phone: v })} />
          <span className="contact-row__meta">{phoneHint(x)}</span>
          {safeHref(x.website) && (
            <a className="tools-link contact-row__meta" href={safeHref(x.website) ?? undefined} target="_blank" rel="noopener noreferrer">
              {x.website} ↗
            </a>
          )}
        </div>
      ))}
    </li>
  );
};

export const ContactListPanel: React.FC<ContactListPanelProps> = ({
  store,
  buildings,
  selectionMode,
  onToggleSelectionMode,
  lookupAvailable,
  batchRunner,
  batch,
}) => {
  const batchRunning = batch.phase === 'running' || batch.phase === 'starting';
  // Re-derived on every list change — O(n), n = buildings (tens).
  const candidates = store.batchCandidates(false);
  const contactCount = buildings.reduce((n, b) => n + Math.max(1, b.owners.length + b.businesses.length), 0);
  const [exportNote, setExportNote] = useState('');
  const [exporting, setExporting] = useState(false);
  const exportNow = async () => {
    setExporting(true);
    setExportNote(saveMessage(await saveCsv(buildings)));
    setExporting(false);
  };
  return (
    <section className="tools-section" aria-labelledby="contacts-heading">
      <h3 id="contacts-heading" className="tools-section__title">Contact list</h3>
      <button
        type="button"
        className={`tools-btn tools-btn--block${selectionMode ? ' tools-btn--active' : ''}`}
        aria-pressed={selectionMode}
        onClick={onToggleSelectionMode}
      >
        {selectionMode ? '✓ Selecting buildings — click map to add/remove' : 'Select buildings on map'}
      </button>
      {!lookupAvailable && (
        <p className="tools-hint">Automatic owner/business lookup isn't available for this city yet.</p>
      )}
      {lookupAvailable && buildings.length > 0 && <BatchBar runner={batchRunner} batch={batch} candidates={candidates} />}
      {buildings.length === 0 ? (
        <p className="tools-hint">No buildings yet. Turn on selection, then click buildings — or use “+ Contact list” in a building popup.</p>
      ) : (
        <ul className="contact-list">
          {buildings.map((b) => (
            <BuildingCard key={b.id} store={store} runner={batchRunner} batchRunning={batchRunning} b={b} />
          ))}
        </ul>
      )}
      <div className="tools-actions">
        <button
          type="button"
          className="tools-btn"
          onClick={() => void exportNow()}
          disabled={buildings.length === 0 || exporting}
          title="Saves to your Desktop (via the lookup server); falls back to a normal download"
        >
          {exporting ? 'Saving…' : `Export CSV (${contactCount})`}
        </button>
        <button
          type="button"
          className="tools-btn tools-btn--ghost"
          onClick={() => store.clear()}
          disabled={buildings.length === 0}
        >
          Clear list
        </button>
      </div>
      {exportNote && (
        <p className="tools-hint" role="status">
          {exportNote}
        </p>
      )}
    </section>
  );
};
