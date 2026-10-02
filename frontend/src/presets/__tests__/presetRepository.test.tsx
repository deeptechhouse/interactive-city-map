// @vitest-environment happy-dom
/**
 * Presets persisted on the map server (2026-10-02). The server is faked — either a fake
 * fetch for ServerPresetRepository, or an in-memory PresetRepository for the hook.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { createPresetRepository, localOnlyPresets, ServerPresetRepository, type PresetRepository } from '../presetRepository';
import { OFFLINE_NOTE, useSavedSearches } from '../useSavedSearches';
import { SearchStateContext } from '../SearchStateContext';
import { SearchStateStore } from '../searchState';
import { SavedSearchesPanel } from '../SavedSearchesPanel';
import type { SavedSearch } from '../savedSearches';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const P = (id: string, name: string, city = 'chicago'): SavedSearch => ({
  id, name, city, savedAt: '2026-10-02T08:00:00.000Z', state: {}, view: null,
});

/** In-memory server. O(1) per call — tests only. */
function memoryServer(initial: SavedSearch[] = [], online = true) {
  let data = [...initial];
  const repo: PresetRepository & { data: () => SavedSearch[] } = {
    list: vi.fn(async () => (online ? [...data] : null)),
    put: vi.fn(async (p: SavedSearch) => {
      if (!online) return false;
      data = [...data.filter((x) => x.id !== p.id), p];
      return true;
    }),
    remove: vi.fn(async (id: string) => {
      if (!online) return false;
      data = data.filter((x) => x.id !== id);
      return true;
    }),
    data: () => data,
  };
  return repo;
}

const store = new SearchStateStore();
// O(1) time, O(1) space — n = 1 provider.
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SearchStateContext.Provider value={store}>{children}</SearchStateContext.Provider>
);
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('localOnlyPresets', () => {
  it('uploads only presets the server lacks (by id, or by name within a city)', () => {
    const server = [P('a', 'Vacant lots'), P('b', 'Bars', 'detroit')];
    const local = [P('a', 'old copy'), P('x', 'vacant LOTS'), P('y', 'Bars'), P('z', 'Coffee')];
    expect(localOnlyPresets(local, server).map((p) => p.id)).toEqual(['y', 'z']);
  });
});

describe('ServerPresetRepository', () => {
  it('lists, puts and deletes over HTTP', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ presets: [P('a', 'A')] })))
      .mockResolvedValueOnce(new Response('{"ok":true}'))
      .mockResolvedValueOnce(new Response('{"ok":true}'));
    const repo = new ServerPresetRepository('/api/v1', fetchFn);
    expect(await repo.list()).toEqual([P('a', 'A')]);
    expect(await repo.put(P('b c', 'B'))).toBe(true);
    expect(fetchFn.mock.calls[1][0]).toBe('/api/v1/presets/b%20c');
    expect(fetchFn.mock.calls[1][1]).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'application/json' } });
    expect(JSON.parse(fetchFn.mock.calls[1][1].body)).toMatchObject({ id: 'b c', name: 'B' });
    expect(await repo.remove('a')).toBe(true);
    expect(fetchFn.mock.calls[2][1]).toMatchObject({ method: 'DELETE' });
  });

  it('reports failure without throwing', async () => {
    const down = new ServerPresetRepository('/api/v1', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await down.list()).toBeNull();
    expect(await down.put(P('a', 'A'))).toBe(false);
    const refused = new ServerPresetRepository('/api/v1', vi.fn().mockResolvedValue(new Response('', { status: 500 })));
    expect(await refused.list()).toBeNull();
    expect(await refused.remove('a')).toBe(false);
    const odd = new ServerPresetRepository('/api/v1', vi.fn().mockResolvedValue(new Response('{"nope":1}')));
    expect(await odd.list()).toBeNull();
  });

  it('factory: none without a server base', () => {
    expect(createPresetRepository(null)).toBeNull();
    expect(createPresetRepository('/api/v1')).toBeInstanceOf(ServerPresetRepository);
  });
});

describe('useSavedSearches with server storage', () => {
  it('loads from the server and uploads browser-only presets once', async () => {
    window.localStorage.setItem('citymap.savedSearches.v1', JSON.stringify([P('old', 'andy1')]));
    const server = memoryServer([P('s1', 'From the Mac mini')]);
    const { result } = renderHook(() => useSavedSearches(null, 'chicago', server), { wrapper });
    expect(result.current.presets.map((p) => p.name)).toEqual(['andy1']); // cache shows instantly
    await tick();
    expect(result.current.presets.map((p) => p.name)).toEqual(['From the Mac mini', 'andy1']);
    expect(server.data().map((p) => p.id)).toEqual(['s1', 'old']);
    expect(result.current.storageNote).toBe('');
  });

  it('save and remove go to the server', async () => {
    const server = memoryServer();
    const { result } = renderHook(() => useSavedSearches(null, 'chicago', server), { wrapper });
    await tick();
    act(() => result.current.save('Vacant lots', false));
    await tick();
    expect(server.data().map((p) => p.name)).toEqual(['Vacant lots']);
    act(() => result.current.save('vacant lots', false)); // same name → overwrite, same id
    await tick();
    expect(server.data()).toHaveLength(1);
    const id = server.data()[0].id;
    act(() => result.current.remove(id));
    await tick();
    expect(server.data()).toEqual([]);
    expect(result.current.presets).toEqual([]);
  });

  it('works offline from the local copy and says so', async () => {
    window.localStorage.setItem('citymap.savedSearches.v1', JSON.stringify([P('a', 'Local')]));
    const server = memoryServer([], false);
    const { result } = renderHook(() => useSavedSearches(null, 'chicago', server), { wrapper });
    await tick();
    expect(result.current.presets.map((p) => p.name)).toEqual(['Local']);
    expect(result.current.storageNote).toBe(OFFLINE_NOTE);
    act(() => result.current.save('Offline save', false));
    await tick();
    expect(result.current.presets.map((p) => p.name)).toEqual(['Local', 'Offline save']);
    expect(JSON.parse(window.localStorage.getItem('citymap.savedSearches.v1')!)).toHaveLength(2);
    render(<SavedSearchesPanel saved={result.current} />);
    expect(screen.getByText(OFFLINE_NOTE)).toBeTruthy();
  });

  it('notes a failed upload; no repository = local only, no note', async () => {
    window.localStorage.setItem('citymap.savedSearches.v1', JSON.stringify([P('a', 'Local')]));
    const server = memoryServer();
    (server.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    const { result } = renderHook(() => useSavedSearches(null, 'chicago', server), { wrapper });
    await tick();
    expect(result.current.storageNote).toBe(OFFLINE_NOTE);
    const local = renderHook(() => useSavedSearches(null, 'chicago', null), { wrapper });
    await tick();
    expect(local.result.current.storageNote).toBe('');
  });
});
