/**
 * Runs the "Look up owners" batch for the contact list — the GUI's ONLY paid owner
 * lookup since 2026-10-02 (Tracerfy advanced batch, 2 credits per owner found).
 *
 * FLOW
 *   start() / recheck(id)
 *     → store.batchCandidates()          # buildings not yet looked up (or the one re-checked)
 *     → api.start(items, refresh)        # POST /contacts/owner/batch
 *         saved answers come back at once (free, with their original date) → applied
 *         the rest are queued at Tracerfy → job id → saved to localStorage
 *     → every POLL_MS: api.poll(job)     # GET /contacts/owner/batch/{job}
 *         done → every answer applied (store.applyOwnerAnswer) → status 'done'
 *     → onComplete hook (setOnComplete): saves the CSV to the Desktop (csvSave.ts) and
 *       its message ("Saved to Desktop: contacts-….csv") is shown as exportNote
 *
 * WHY THE JOB ID IS SAVED: Tracerfy charges when the queue runs. If the page is closed
 * mid-batch, the next page load resumes polling the same job, so results that were paid
 * for still land in the list. (The server keeps the job too — services/owner_batch_service.py.)
 *
 * Pure TS (no React): useContactList binds it with useSyncExternalStore.
 */
import { loadJson, saveJson } from '../utils/safeStorage';
import type { BatchCandidate, ContactListStore } from './ContactListStore';
import type { OwnerBatchApi } from './ownerLookup';
import { getCityProfile } from '../cities/registry';

// ADJUSTABLE: how often to check a running batch. Tracerfy rate-limits its status
// endpoint ("Retry in intervals of 20 seconds"); below ~20 s checks are wasted.
export const POLL_MS = 30_000;
// ADJUSTABLE: give up polling after this long (the server keeps the job; "Check again"
// resumes it). Tracerfy's estimate is 1–5 minutes.
export const GIVE_UP_MS = 30 * 60_000;

// ADJUSTABLE: Tracerfy batch prices for the button's estimate (Tracerfy, 2026-10-02):
// name trace 1 credit, address trace 2 credits per owner found; $20 per 1,000 credits.
const CREDITS_BY_NAME = 1;
const CREDITS_BY_ADDRESS = 2;
export const DOLLARS_PER_CREDIT = 0.02;

/**
 * Credit range for a batch. Low = every owner found the first time (names at 1, the
 * rest at 2). High = every name misses and is re-traced by address (2 each). Misses
 * cost nothing, so actual spend is usually lower still. O(n).
 */
export function batchCostRange(candidates: readonly BatchCandidate[]): { low: number; high: number; byName: number } {
  const byName = candidates.filter((c) => c.firstName && c.lastName).length;
  const byAddress = candidates.length - byName;
  return {
    byName,
    low: byName * CREDITS_BY_NAME + byAddress * CREDITS_BY_ADDRESS,
    high: candidates.length * CREDITS_BY_ADDRESS,
  };
}

export type BatchPhase = 'idle' | 'starting' | 'running' | 'done' | 'error';

export interface BatchState {
  phase: BatchPhase;
  jobId: string;
  /** Buildings sent to Tracerfy in this batch (not counting free saved answers). */
  submitted: number;
  /** Buildings answered from the store when the batch started (free). */
  reused: number;
  /** Owners found / looked up once done. */
  found: number;
  total: number;
  startedAt: string;
  message: string;
  /** Outcome of the automatic CSV save when the batch finished ('' = none yet). */
  exportNote: string;
  /** Buildings in this batch — to clear their "searching…" state on error. */
  buildingIds: string[];
}

export const IDLE_BATCH: BatchState = Object.freeze({
  phase: 'idle',
  jobId: '',
  submitted: 0,
  reused: 0,
  found: 0,
  total: 0,
  startedAt: '',
  message: '',
  exportNote: '',
  buildingIds: [],
}) as BatchState;

type Timer = { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void };
const realTimer: Timer = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class OwnerBatchRunner {
  private state: BatchState;
  private readonly listeners = new Set<() => void>();
  private timer: unknown = null;
  private readonly storageKey: string;
  /** City/state sent with every batch item — from the city profile (Detroit, MI…). */
  private readonly place: { city: string; state: string };
  private onComplete: (() => Promise<string>) | null = null;

  constructor(
    private readonly store: ContactListStore,
    private readonly api: OwnerBatchApi,
    city: string,
    private readonly clock: Timer = realTimer,
    private readonly now: () => number = Date.now,
  ) {
    this.storageKey = `citymap.ownerBatch.v1.${city}`;
    const profile = getCityProfile(city);
    this.place = { city: profile?.name ?? 'Chicago', state: profile?.state ?? 'IL' };
    this.state = parseSavedBatch(loadJson(this.storageKey));
    if (this.state.phase === 'running' || this.state.phase === 'starting') {
      // Page was closed mid-batch: resume. 'starting' never got a job id → nothing to resume.
      if (this.state.jobId) this.schedule(0);
      else this.set({ ...IDLE_BATCH });
    }
  }

  /** Run ``fn`` after every finished lookup; its returned text becomes exportNote. */
  setOnComplete(fn: (() => Promise<string>) | null): void {
    this.onComplete = fn;
  }

  // ---- useSyncExternalStore contract ----

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = (): BatchState => this.state;

  /** Buildings a "Look up owners" click would send (for the button's count/cost). */
  pendingCount(): number {
    return this.store.batchCandidates(false).length;
  }

  get isRunning(): boolean {
    return this.state.phase === 'running' || this.state.phase === 'starting';
  }

  // ---- commands ----

  /** Look up every building not yet looked up. */
  start(): Promise<void> {
    return this.run(this.store.batchCandidates(false), false);
  }

  /** Look up only these buildings (a curated discovery set), not the whole list. */
  startFor(buildingIds: readonly string[]): Promise<void> {
    return this.run(this.store.batchCandidates(false, new Set(buildingIds)), false);
  }

  /** Paid re-check of one building, ignoring its saved answer ("Re-check ($)"). */
  recheck(buildingId: string): Promise<void> {
    return this.run(this.store.batchCandidates(true, new Set([buildingId])), true);
  }

  /** Resume polling a batch that gave up waiting. */
  checkAgain(): void {
    if (this.state.jobId) {
      this.set({ ...this.state, phase: 'running', startedAt: new Date(this.now()).toISOString(), message: '' });
      this.schedule(0);
    }
  }

  dispose(): void {
    if (this.timer !== null) this.clock.clear(this.timer);
    this.timer = null;
  }

  // ---- internals ----

  private async run(items: BatchCandidate[], refresh: boolean): Promise<void> {
    if (this.isRunning || items.length === 0) return;
    const buildingIds = items.map((i) => i.buildingId);
    this.set({
      ...IDLE_BATCH,
      phase: 'starting',
      total: items.length,
      startedAt: new Date(this.now()).toISOString(),
      buildingIds,
    });
    this.store.markOwnersPending(buildingIds);

    const reply = await this.api.start(
      items.map(({ street, zip, firstName, lastName }) => ({ street, zip, firstName, lastName, ...this.place })),
      refresh,
    );
    if (!reply.ok) return this.fail(reply.reason);

    for (const r of reply.results) this.store.applyOwnerAnswer(r.street, r.answer); // saved answers, free
    const reused = reply.results.length;
    if (!reply.pending || !reply.jobId) {
      this.set({ ...this.state, reused });
      return this.finish();
    }
    this.set({ ...this.state, phase: 'running', jobId: reply.jobId, submitted: reply.submitted, reused });
    this.schedule(POLL_MS);
  }

  private async poll(): Promise<void> {
    this.timer = null;
    const reply = await this.api.poll(this.state.jobId);
    if (!reply.ok) return this.fail(reply.reason);
    if (reply.pending) {
      if (this.now() - Date.parse(this.state.startedAt) > GIVE_UP_MS) {
        this.set({ ...this.state, phase: 'error', message: 'Tracerfy is taking unusually long — press “Check again” later.' });
        return;
      }
      this.schedule(POLL_MS);
      return;
    }
    for (const r of reply.results) this.store.applyOwnerAnswer(r.street, r.answer);
    await this.finish();
  }

  /** Count from the store (the single source of truth), not from replies. O(n). */
  private async finish(): Promise<void> {
    const found = this.store.countOwnersFound(this.state.buildingIds);
    this.set({ ...this.state, phase: 'done', found, message: '', exportNote: '' });
    if (!this.onComplete) return;
    let note: string;
    try {
      note = await this.onComplete();
    } catch {
      note = 'Lookup finished, but the CSV could not be saved — use Export CSV.';
    }
    this.set({ ...this.state, exportNote: note });
  }

  private fail(reason: string): void {
    // Owners still showing "searching…" go back to idle so they're offered next time.
    for (const id of this.state.buildingIds) this.store.resetPendingOwner(id);
    this.set({ ...this.state, phase: 'error', message: reason });
  }

  private schedule(ms: number): void {
    if (this.timer !== null) this.clock.clear(this.timer);
    this.timer = this.clock.set(() => void this.poll(), ms);
  }

  private set(next: BatchState): void {
    this.state = next;
    saveJson(this.storageKey, next);
    this.listeners.forEach((l) => l());
  }
}

/** Validate untrusted saved state. O(1). */
export function parseSavedBatch(raw: unknown): BatchState {
  if (!raw || typeof raw !== 'object') return { ...IDLE_BATCH };
  const o = raw as Record<string, unknown>;
  const phases: BatchPhase[] = ['idle', 'starting', 'running', 'done', 'error'];
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    phase: phases.includes(o.phase as BatchPhase) ? (o.phase as BatchPhase) : 'idle',
    jobId: /^[0-9a-f]{32}$/.test(str(o.jobId)) ? str(o.jobId) : '',
    submitted: num(o.submitted),
    reused: num(o.reused),
    found: num(o.found),
    total: num(o.total),
    startedAt: str(o.startedAt),
    message: str(o.message),
    exportNote: str(o.exportNote),
    buildingIds: Array.isArray(o.buildingIds) ? o.buildingIds.filter((x): x is string => typeof x === 'string') : [],
  };
}
