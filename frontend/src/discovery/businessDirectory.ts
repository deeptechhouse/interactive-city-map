/**
 * FREE business-licence client for discovery (City of Chicago open data, no key, no cost).
 * The query text is built in discoveryQuery.ts; this file only does the HTTP.
 */
import { defaultFetchJson, type FetchJson } from '../contacts/publicRecords';
import {
  businessesParams,
  groupCandidates,
  LICENSE_URL,
  parseTypeCounts,
  typeCountsParams,
  type ActivityCount,
  type Candidate,
  type SearchArea,
} from './discoveryQuery';

/** Port, so tests (and other cities later) can swap the data source. */
export interface BusinessDirectory {
  activityCounts(area: SearchArea): Promise<ActivityCount[]>;
  candidates(area: SearchArea, activities: readonly string[]): Promise<Candidate[]>;
}

/** URL with query params. O(p) time, O(p) space — p = params. */
function withParams(params: Record<string, string>): string {
  const url = new URL(LICENSE_URL);
  // O(p) time, O(1) space — p = params.
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

export class ChicagoBusinessDirectory implements BusinessDirectory {
  /** O(1) time, O(1) space — n = 1 injected fetcher. */
  constructor(private readonly fetchJson: FetchJson = defaultFetchJson) {}

  /** One free HTTP call. O(r + t log t) time, O(t) space — r = rows, t = activities. */
  async activityCounts(area: SearchArea): Promise<ActivityCount[]> {
    return parseTypeCounts(await this.fetchJson(withParams(typeCountsParams(area))));
  }

  /** One free HTTP call. O(r) time, O(r) space — r = licence rows (≤ 5,000). */
  async candidates(area: SearchArea, activities: readonly string[]): Promise<Candidate[]> {
    if (activities.length === 0) return [];
    return groupCandidates(await this.fetchJson(withParams(businessesParams(area, activities))));
  }
}
