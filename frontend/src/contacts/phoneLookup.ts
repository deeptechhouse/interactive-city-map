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
 *   otherwise               → the full backend at <VITE_API_URL>/api/v1.
 * ownerLookup.ts uses the same getter for the paid owner skip trace.
 */
import { apiClient, ApiError } from '../api/client';
import { apiBaseUrl } from '../utils/geoUtils';
import { IS_STATIC } from '../utils/staticMode';

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
  /** City/state of ``address``; default Chicago, IL. */
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
async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const resp = await fetch(url, { ...init, headers: { Accept: 'application/json', ...init.headers } });
  if (!resp.ok) throw new ApiError(resp.status, await resp.text().catch(() => ''), url);
  return resp.json() as Promise<T>;
}

/** GET against an explicit base URL — used for the phone-only server in static mode. */
export function getJsonFrom(baseUrl: string): GetJson {
  return <T>(path: string) => fetchJson<T>(`${baseUrl.replace(/\/$/, '')}${path}`, {});
}

/** POST against an explicit base URL (owner batch start). */
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
/**
 * Base URL of the lookup API ("…/api/v1"), or null when no server is reachable.
 * apiClient's base is an ORIGIN (geoUtils.apiBaseUrl), so the full-backend case adds
 * "/api/v1" here — without it, lookup paths like "/contacts/phone" would 404.
 * O(1) time, O(1) space — n = 1 URL.
 */
export function lookupApiBase(phoneApiUrl: string = PHONE_API_URL): string | null {
  if (phoneApiUrl) return phoneApiUrl.replace(/\/$/, '');
  return IS_STATIC ? null : `${apiBaseUrl()}/api/v1`;
}

/** O(1) time, O(1) space — n = 1 function. */
export function backendGetter(phoneApiUrl: string = PHONE_API_URL): GetJson | null {
  const base = lookupApiBase(phoneApiUrl);
  return base === null ? null : getJsonFrom(base);
}

/** POST twin of backendGetter. */
export function backendPoster(phoneApiUrl: string = PHONE_API_URL): PostJson | null {
  const base = lookupApiBase(phoneApiUrl);
  return base === null ? null : postJsonTo(base);
}

export const NO_SERVER_REASON = 'Phone/owner lookup needs the lookup server — start the map with ./start_map.sh';

/**
 * Turn a failed request into a user-facing reason. The backend explains provider
 * failures in FastAPI's ``{"detail": "..."}`` body — e.g. 402 "Tracerfy account is out
 * of credits" — and that text is shown as-is (it's our own server's wording).
 */
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
  constructor(
    private readonly city: string,
    private readonly get: GetJson = (path) => apiClient.get(`/api/v1${path}`),
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async lookup(q: PhoneQuery): Promise<PhoneAnswer> {
    const params = new URLSearchParams({
      name: q.name.slice(0, 200), // backend rejects > 200 chars (422)
      address: q.address.slice(0, 200),
      city: this.city,
      locality: (q.locality || 'Chicago').slice(0, 80),
      region: (q.region || 'IL').slice(0, 2),
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
  constructor(private readonly reason: string) {}

  async lookup(): Promise<PhoneAnswer> {
    return { status: 'unavailable', reason: this.reason };
  }
}

export function createPhoneLookup(city: string, phoneApiUrl: string = PHONE_API_URL): PhoneLookup {
  const get = backendGetter(phoneApiUrl);
  return get ? new BackendPhoneLookup(city, get) : new UnavailablePhoneLookup(NO_SERVER_REASON);
}
