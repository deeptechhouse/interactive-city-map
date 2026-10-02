/**
 * Where saved searches are kept: on the map server (backend/app/routes/presets.py), so
 * they survive port changes and restarts and are shared by every browser using that
 * server — the browser's localStorage is only a cache/offline copy (useSavedSearches).
 *
 * WHY (2026-10-02): localStorage is per address *including the port*; presets saved on
 * :5173 were invisible on :8000 and on other devices, so they "disappeared".
 */
import { lookupApiBase } from '../contacts/phoneLookup';
import type { SavedSearch } from './savedSearches';

/** Server port. Every method resolves; `false`/`null` = server unreachable or refused. */
export interface PresetRepository {
  list(): Promise<SavedSearch[] | null>;
  put(preset: SavedSearch): Promise<boolean>;
  remove(id: string): Promise<boolean>;
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export class ServerPresetRepository implements PresetRepository {
  /** O(1) time, O(1) space — n = 1 base URL. */
  constructor(
    private readonly base: string,
    // O(1) time, O(1) space — n = 1 request.
    private readonly fetchFn: FetchFn = (url, init) => fetch(url, init),
  ) {}

  /** One request. O(p) time, O(p) space — p = presets returned. */
  async list(): Promise<SavedSearch[] | null> {
    try {
      const resp = await this.fetchFn(`${this.base}/presets`, { headers: { Accept: 'application/json' } });
      if (!resp.ok) return null;
      const body = (await resp.json()) as { presets?: unknown };
      return Array.isArray(body.presets) ? (body.presets as SavedSearch[]) : null;
    } catch {
      return null;
    }
  }

  /** One request. O(s) time, O(s) space — s = preset size. */
  async put(preset: SavedSearch): Promise<boolean> {
    return this.send('PUT', preset.id, JSON.stringify(preset));
  }

  /** One request. O(1) time, O(1) space — n = 1 id. */
  async remove(id: string): Promise<boolean> {
    return this.send('DELETE', id);
  }

  /** O(s) time, O(s) space — s = body size. */
  private async send(method: 'PUT' | 'DELETE', id: string, body?: string): Promise<boolean> {
    try {
      const resp = await this.fetchFn(`${this.base}/presets/${encodeURIComponent(id)}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body,
      });
      return resp.ok;
    } catch {
      return false;
    }
  }
}

/** The server repository, or null when there's no map server (pure static build).
 * O(1) time, O(1) space — n = 1 repository. */
export function createPresetRepository(base: string | null = lookupApiBase()): PresetRepository | null {
  return base === null ? null : new ServerPresetRepository(base);
}

/**
 * Presets in the browser that the server doesn't have yet (saved before presets moved to
 * the server, or while it was unreachable) — to be uploaded once. A local preset is
 * skipped if the server has the same id, or the same name in the same city (the server's
 * copy wins, so nothing is duplicated).
 * O(l + s) time, O(s) space — l = local presets, s = server presets.
 */
export function localOnlyPresets(local: readonly SavedSearch[], server: readonly SavedSearch[]): SavedSearch[] {
  // O(s) time, O(s) space — s = server presets.
  const ids = new Set(server.map((p) => p.id));
  // O(s) time, O(s) space — s = server presets.
  const names = new Set(server.map((p) => `${p.city}|${p.name.toLowerCase()}`));
  // O(l) time, O(l) space — l = local presets.
  return local.filter((p) => !ids.has(p.id) && !names.has(`${p.city}|${p.name.toLowerCase()}`));
}
