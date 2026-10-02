/**
 * Owner skip-trace clients — the PERSON behind a building owner, with phones and emails.
 *
 * Two paths, both PAID per hit and both answered from the server's permanent store when
 * a property was looked up before (free, with the ORIGINAL lookup date):
 *
 *   OwnerBatchApi  — what the GUI uses (since 2026-10-02). Tracerfy "advanced" batch,
 *                    2 credits/hit. start() returns saved answers at once + a job id;
 *                    poll() every ~30 s until done. Results carry dncChecked=false: the
 *                    batch file has no Do-Not-Call columns.
 *   OwnerLookup    — INSTANT, 5 credits/hit, DNC-checked. Wired but hidden in the GUI
 *                    (SHOW_INSTANT_OWNER_LOOKUP in ContactListPanel.tsx).
 *
 * The backend (GET/POST /api/v1/contacts/owner…) holds the key, rate-limits and stores.
 */
import {
  backendGetter,
  backendPoster,
  failureReason,
  NO_SERVER_REASON,
  type GetJson,
  type PostJson,
} from './phoneLookup';
import type { ExtraPhone } from './types';

/** One looked-up owner, as both paths return it. */
export interface OwnerFound {
  personName: string;
  phones: ExtraPhone[];
  emails: string[];
  source: string;
  /** ISO UTC date the paid lookup happened. */
  lookedUpAt: string;
  dncChecked: boolean;
  /** 'name' | 'address' | '' — how the person was found (batch); '' for instant/old. */
  method: string;
}

export type OwnerAnswer =
  | ({ status: 'found' } & OwnerFound)
  | { status: 'not_found'; lookedUpAt: string }
  | { status: 'unavailable'; reason: string };

export interface OwnerQuery {
  /** The PROPERTY (building) street address — skip tracers key on the property. */
  street: string;
  zip: string;
  ownerName: string;
  /** The property's city/state ("Detroit", "MI"). REQUIRED: this lookup costs 5 credits
   *  and used to send every address as Chicago, IL (fixed 2026-10-02). */
  locality: string;
  region: string;
}

/** Wire format shared by the instant and batch endpoints (routes/contacts.py _owner_json). */
interface OwnerJson {
  person_name: string;
  phones: { number: string; type: string; dnc: boolean }[];
  emails: string[];
  provider: string;
  dnc_checked?: boolean;
  looked_up_at?: string;
  method?: string;
}

/** JSON → answer. A result with no phones and no emails is a (dated) miss. */
// O(p) time, O(p) space — p = phones in the response (emails are passed through, not copied)
export function toOwnerAnswer(res: OwnerJson): OwnerAnswer {
  const lookedUpAt = res.looked_up_at ?? '';
  if (!res.phones?.length && !res.emails?.length) return { status: 'not_found', lookedUpAt };
  return {
    status: 'found',
    personName: res.person_name ?? '',
    // O(p) time, O(p) space — p = phones in the response
    phones: (res.phones ?? []).map((p) => ({ number: p.number, type: p.type ?? '', dnc: !!p.dnc })),
    emails: res.emails ?? [],
    source: res.provider ?? '',
    lookedUpAt,
    dncChecked: res.dnc_checked !== false,
    method: res.method ?? '',
  };
}

const VALID_ZIP = /^\d{5}(-\d{4})?$/; // backend rejects anything else with 422

// ---------------------------------------------------------------------------
// Instant (hidden in the GUI)
// ---------------------------------------------------------------------------

export interface OwnerLookup {
  lookup(q: OwnerQuery, refresh?: boolean): Promise<OwnerAnswer>;
}

export class BackendOwnerLookup implements OwnerLookup {
  // O(1) time, O(1) space — k = 1 injected getter stored (constant)
  constructor(private readonly get: GetJson) {}

  // O(p) time, O(p) space — p = phones in the reply (fields length-capped, the single GET counts as constant work)
  async lookup(q: OwnerQuery, refresh = false): Promise<OwnerAnswer> {
    // Fail closed: without the property's city/state this would be a 5-credit lookup in
    // an unknown place — skip it instead (nothing is charged).
    if (!q.locality || !q.region) {
      return { status: 'unavailable', reason: 'Unknown city — owner lookup skipped (nothing was charged).' };
    }
    const params = new URLSearchParams({
      street: q.street.slice(0, 200),
      locality: q.locality.slice(0, 80),
      region: q.region.slice(0, 2).toUpperCase(),
      owner_name: q.ownerName.slice(0, 200),
    });
    if (VALID_ZIP.test(q.zip)) params.set('zip', q.zip);
    if (refresh) params.set('refresh', 'true');
    try {
      return toOwnerAnswer(await this.get<OwnerJson>(`/contacts/owner?${params.toString()}`));
    } catch (err) {
      return { status: 'unavailable', reason: failureReason(err) };
    }
  }
}

export class UnavailableOwnerLookup implements OwnerLookup {
  // O(1) time, O(1) space — k = 1 constant answer built, no I/O
  async lookup(): Promise<OwnerAnswer> {
    return { status: 'unavailable', reason: NO_SERVER_REASON };
  }
}

// O(1) time, O(1) space — k = 1 implementation chosen, no I/O
export function createOwnerLookup(phoneApiUrl?: string): OwnerLookup {
  const get = backendGetter(phoneApiUrl);
  return get ? new BackendOwnerLookup(get) : new UnavailableOwnerLookup();
}

// ---------------------------------------------------------------------------
// Batch (the GUI path)
// ---------------------------------------------------------------------------

export interface BatchItemAnswer {
  street: string;
  answer: OwnerAnswer;
}

export type BatchReply =
  | { ok: true; jobId: string; pending: boolean; submitted: number; byName: number; results: BatchItemAnswer[] }
  | { ok: false; reason: string };

/** One building to look up. Names empty → 2-credit owner discovery by address. */
export interface BatchItem {
  street: string;
  zip: string;
  firstName?: string;
  lastName?: string;
  /** City/state of the building (e.g. "Detroit", "MI"). The backend defaults to
   *  Chicago, IL when absent, so they must be sent for every other city. */
  city?: string;
  state?: string;
}

interface BatchJson {
  job_id: string;
  pending: boolean;
  submitted: number;
  by_name?: number;
  results: (OwnerJson & { street: string; zip: string; cached: boolean })[];
}

export interface OwnerBatchApi {
  start(items: BatchItem[], refresh: boolean): Promise<BatchReply>;
  poll(jobId: string): Promise<BatchReply>;
}

// O(r + P) time, O(r + P) space — r = results in the reply; P = phones across all results
function toBatchReply(res: BatchJson): BatchReply {
  return {
    ok: true,
    jobId: res.job_id ?? '',
    pending: !!res.pending,
    submitted: res.submitted ?? 0,
    byName: res.by_name ?? 0,
    // O(r + P) time, O(r + P) space — r = results; P = phones across all results (toOwnerAnswer is linear in each result's phones)
    results: (res.results ?? []).map((r) => ({ street: r.street, answer: toOwnerAnswer(r) })),
  };
}

export class BackendOwnerBatchApi implements OwnerBatchApi {
  // O(1) time, O(1) space — k = 2 injected functions stored (constant)
  constructor(
    private readonly get: GetJson,
    private readonly post: PostJson,
  ) {}

  // O(k + r + P) time, O(k + r + P) space — k = items submitted; r = results in the reply; P = phones across them (the single POST counts as constant work)
  async start(items: BatchItem[], refresh: boolean): Promise<BatchReply> {
    const body = {
      refresh,
      // O(k) time, O(k) space — k = items submitted (each field is length-capped)
      items: items.map((i) => ({
        street: i.street.slice(0, 200),
        zip: VALID_ZIP.test(i.zip) ? i.zip : '',
        first_name: (i.firstName ?? '').slice(0, 60),
        last_name: (i.lastName ?? '').slice(0, 60),
        ...(i.city ? { city: i.city.slice(0, 60) } : {}),
        ...(i.state ? { state: i.state.slice(0, 2).toUpperCase() } : {}),
      })),
    };
    try {
      return toBatchReply(await this.post<BatchJson>('/contacts/owner/batch', body));
    } catch (err) {
      return { ok: false, reason: failureReason(err) };
    }
  }

  // O(r + P) time, O(r + P) space — r = results in the reply; P = phones across them (the single GET counts as constant work)
  async poll(jobId: string): Promise<BatchReply> {
    try {
      return toBatchReply(await this.get<BatchJson>(`/contacts/owner/batch/${encodeURIComponent(jobId)}`));
    } catch (err) {
      return { ok: false, reason: failureReason(err) };
    }
  }
}

export class UnavailableOwnerBatchApi implements OwnerBatchApi {
  // O(1) time, O(1) space — k = 1 constant failure built, no I/O
  async start(): Promise<BatchReply> {
    return { ok: false, reason: NO_SERVER_REASON };
  }

  // O(1) time, O(1) space — k = 1 constant failure built, no I/O
  async poll(): Promise<BatchReply> {
    return { ok: false, reason: NO_SERVER_REASON };
  }
}

// O(1) time, O(1) space — k = 1 implementation chosen, no I/O
export function createOwnerBatchApi(phoneApiUrl?: string): OwnerBatchApi {
  const get = backendGetter(phoneApiUrl);
  const post = backendPoster(phoneApiUrl);
  return get && post ? new BackendOwnerBatchApi(get, post) : new UnavailableOwnerBatchApi();
}
