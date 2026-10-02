/**
 * Phone lookup port for the contact list — businesses in a building, and owner COMPANIES.
 *
 * The real lookup is paid (Google Places / Foursquare) and needs an API key, so it runs
 * on the backend: GET /api/v1/contacts/phone (backend/app/routes/contacts.py). The
 * browser never sees the key.
 *
 * Which server answers (backendGetter):
 *   VITE_PHONE_API_URL set  → that URL, even in static mode. This is how the static map
 *                             talks to the lightweight server (backend/app/phone_app.py)
 *                             — no Docker needed. ./start_map.sh sets it.
 *   static mode, no URL     → none: lookups answer 'unavailable'; the user can type numbers.
 *   otherwise               → the full backend via apiClient.
 * ownerLookup.ts uses the same getter for the paid owner skip trace.
 */
import { apiClient, ApiError } from '../api/client';
import { IS_STATIC } from '../utils/staticMode';
import { getCityProfile } from '../cities/registry';

export type PhoneAnswer =
  | { status: 'found'; phone: string; source: string; website: string }
  | { status: 'not_found' }
  | { status: 'unavailable'; reason: string };

export interface PhoneQuery {
  name: string;
  /** Street address of the business (or the owner company's mailing street). */
  address: string;
  /** Bias point — omit for owner companies, whose office is somewhere else. */
  lngLat?: [number, number];
  /** City/state of ``address``; default = the map city's (from its profile). */
  locality?: string;
  region?: string;
}

export interface PhoneLookup {
  lookup(q: PhoneQuery): Promise<PhoneAnswer>;
}

interface PhoneResponse {
  phone: string;
  matched_name: string;
  provider: string;
  cached: boolean;
  website?: string;
}

/** GET a JSON path; resolves the parsed body or throws ApiError (status 429 = rate limit). */
export type GetJson = <T>(path: string) => Promise<T>;

/** POST a JSON body; same error contract as GetJson. */
export type PostJson = <T>(path: string, body: unknown) => Promise<T>;

/** fetch → parsed JSON, or ApiError carrying the server's body (for failureReason). */
// O(b) time, O(b) space — b = response body size (read + JSON parse, the single fetch counts as constant work)
async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const resp = await fetch(url, { ...init, headers: { Accept: 'application/json', ...init.headers } });
  if (!resp.ok) throw new ApiError(resp.status, await resp.text().catch(() => ''), url);
  return resp.json() as Promise<T>;
}

/** GET against an explicit base URL — used for the phone-only server in static mode. */
// O(1) time, O(1) space — k = 1 closure returned (each call is linear in u + b); u = URL length; b = response body size
export function getJsonFrom(baseUrl: string): GetJson {
  return <T>(path: string) => fetchJson<T>(`${baseUrl.replace(/\/$/, '')}${path}`, {});
}

/** POST against an explicit base URL (owner batch start). */
// O(1) time, O(1) space — k = 1 closure returned (each call is linear in q + b); q = serialised request body size; b = response body size
export function postJsonTo(baseUrl: string): PostJson {
  return <T>(path: string, body: unknown) =>
    fetchJson<T>(`${baseUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
}

// ADJUSTABLE: base URL of the phone-only server, e.g. http://localhost:8000/api/v1
const PHONE_API_URL: string = import.meta.env.VITE_PHONE_API_URL ?? '';

/** The GET function for paid lookups, or null when no server is reachable (see header). */
// O(1) time, O(1) space — k = 1 getter chosen, no I/O
export function backendGetter(phoneApiUrl: string = PHONE_API_URL): GetJson | null {
  if (phoneApiUrl) return getJsonFrom(phoneApiUrl);
  return IS_STATIC ? null : (path) => apiClient.get(path);
}

/** POST twin of backendGetter. */
// O(1) time, O(1) space — k = 1 poster chosen, no I/O
export function backendPoster(phoneApiUrl: string = PHONE_API_URL): PostJson | null {
  if (phoneApiUrl) return postJsonTo(phoneApiUrl);
  return IS_STATIC ? null : (path, body) => apiClient.post(path, body);
}

export const NO_SERVER_REASON = 'Phone/owner lookup needs the lookup server — start the map with ./start_map.sh';

/**
 * Turn a failed request into a user-facing reason. The backend explains provider
 * failures in FastAPI's ``{"detail": "..."}`` body — e.g. 402 "Tracerfy account is out
 * of credits" — and that text is shown as-is (it's our own server's wording).
 */
// O(e) time, O(e) space — e = length of the error body (JSON.parse)
export function failureReason(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return 'Lookup limit reached — retry in a minute';
    try {
      const detail = (JSON.parse(err.body) as { detail?: unknown }).detail;
      if (typeof detail === 'string' && detail) return detail.slice(0, 200);
    } catch {
      /* body wasn't JSON — fall through */
    }
  }
  return 'Lookup service unreachable';
}

// ADJUSTABLE: when the lookup server says "too many this minute" (429), wait this long
// and try again, up to this many times. 4 × 20 s covers one full rate-limit window.
export const RATE_LIMIT_RETRIES = 4;
export const RATE_LIMIT_WAIT_MS = 20_000;

/** Calls the backend proxy. One HTTP call per query; the backend caches repeats. */
export class BackendPhoneLookup implements PhoneLookup {
  // O(1) time, O(1) space — k = 3 injected dependencies stored (constant)
  constructor(
    private readonly city: string,
    // O(1) time, O(1) space — k = 1 delegated apiClient call (network, counted as constant work)
    private readonly get: GetJson = (path) => apiClient.get(path),
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  // O(1) time, O(1) space — k = at most RATE_LIMIT_RETRIES + 1 GETs (constant, each counted as constant work, query fields length-capped)
  async lookup(q: PhoneQuery): Promise<PhoneAnswer> {
    // City/state default to THIS map city's (from its profile) — never to Chicago. Before
    // 2026-10-02 a missing locality became "Chicago, IL", which would have paid for
    // Detroit/Dayton searches in the wrong city. No known place → no paid call at all.
    const profile = getCityProfile(this.city);
    const locality = q.locality || profile?.name || '';
    const region = q.region || profile?.state || '';
    if (!locality || !region) {
      return { status: 'unavailable', reason: 'Unknown city — phone lookup skipped (nothing was charged).' };
    }
    const params = new URLSearchParams({
      name: q.name.slice(0, 200), // backend rejects > 200 chars (422)
      address: q.address.slice(0, 200),
      city: this.city,
      locality: locality.slice(0, 80),
      region: region.slice(0, 2),
    });
    if (q.lngLat) {
      params.set('lat', String(q.lngLat[1]));
      params.set('lon', String(q.lngLat[0]));
    }
    // Retry on the server's per-minute limit (429) instead of giving up — a big curated
    // batch hits it by design. Each attempt is one (possibly paid) lookup; 429s cost nothing.
    // O(1) time, O(1) space — n = RATE_LIMIT_RETRIES attempts at most.
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await this.get<PhoneResponse>(`/contacts/phone?${params.toString()}`);
        return res.phone
          ? { status: 'found', phone: res.phone, source: res.provider, website: res.website ?? '' }
          : { status: 'not_found' };
      } catch (err) {
        if (err instanceof ApiError && err.status === 429 && attempt < RATE_LIMIT_RETRIES) {
          await this.sleep(RATE_LIMIT_WAIT_MS);
          continue;
        }
        return { status: 'unavailable', reason: failureReason(err) };
      }
    }
  }
}

/** Static mode without a lookup server: never looks anything up. */
export class UnavailablePhoneLookup implements PhoneLookup {
  // O(1) time, O(1) space — k = 1 reason string stored (constant)
  constructor(private readonly reason: string) {}

  // O(1) time, O(1) space — k = 1 constant answer built, no I/O
  async lookup(): Promise<PhoneAnswer> {
    return { status: 'unavailable', reason: this.reason };
  }
}

// O(1) time, O(1) space — k = 1 implementation chosen, no I/O
export function createPhoneLookup(city: string, phoneApiUrl: string = PHONE_API_URL): PhoneLookup {
  const get = backendGetter(phoneApiUrl);
  return get ? new BackendPhoneLookup(city, get) : new UnavailablePhoneLookup(NO_SERVER_REASON);
}
