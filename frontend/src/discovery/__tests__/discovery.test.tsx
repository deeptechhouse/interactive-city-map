// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import {
  areaWhere,
  buildingAddress,
  businessesParams,
  groupCandidates,
  parseTypeCounts,
  typeCountsParams,
  type Candidate,
  type SearchArea,
} from '../discoveryQuery';
import { ChicagoBusinessDirectory, type BusinessDirectory } from '../businessDirectory';
import { setCandidates, CANDIDATE_DOT, CANDIDATE_HALO } from '../CandidatesLayer';
import { describeArea, pickFor, useDiscovery, waitForResolved } from '../useDiscovery';
import { DiscoveryPanel } from '../DiscoveryPanel';
import { EMPTY_SELECTION, type FocusSelection } from '../../focus/focusGeometry';
import { ContactListStore, MAX_PARALLEL_LOOKUPS } from '../../contacts/ContactListStore';
import type { ContactResolver } from '../../contacts/ContactResolver';
import { BackendPhoneLookup } from '../../contacts/phoneLookup';
import { ApiError } from '../../api/client';
import { LayerPanel } from '../../map/controls/LayerPanel';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.localStorage.clear();
});

const sel = (patch: Partial<FocusSelection>): FocusSelection => ({ ...EMPTY_SELECTION, ...patch });

// ---------------------------------------------------------------------------
// Pure query building
// ---------------------------------------------------------------------------

describe('areaWhere', () => {
  it('focus union / intersection map to OR / AND over licence columns', () => {
    const union: SearchArea = { kind: 'focus', selection: sel({ zip: ['60614'], ward: ['43', '2'] }) };
    expect(areaWhere(union)).toBe("(zip_code in('60614')) OR (ward in('43','2'))");
    const both: SearchArea = { kind: 'focus', selection: sel({ police: ['18'], ward: ['43'], mode: 'intersection' }) };
    expect(areaWhere(both)).toBe("(police_district in('18')) AND (ward in('43'))");
  });

  it('strips anything but digits from ids (no injection) and handles empty', () => {
    expect(areaWhere({ kind: 'focus', selection: sel({ ward: ["43') OR 1=1 --"] }) })).toBe("(ward in('4311'))");
    expect(areaWhere({ kind: 'focus', selection: sel({ ward: ['x'] }) })).toBe('1 = 0');
  });

  it('map view → within_box(n, w, s, e)', () => {
    expect(areaWhere({ kind: 'view', bounds: [-87.67, 41.9, -87.64, 41.92] })).toBe(
      'within_box(location, 41.92, -87.67, 41.9, -87.64)',
    );
  });
});

describe('type counts', () => {
  it('splits "A | B" combos and sums, biggest first', () => {
    expect(typeCountsParams({ kind: 'focus', selection: sel({ ward: ['43'] }) }).$group).toBe('business_activity');
    expect(
      parseTypeCounts([
        { business_activity: 'Coffee | Food', n: '3' },
        { business_activity: 'Food', n: '2' },
        { business_activity: 'Bar', n: '1' },
        { business_activity: '', n: '9' },
      ]),
    ).toEqual([
      { activity: 'Food', count: 5 },
      { activity: 'Coffee', count: 3 },
      { activity: 'Bar', count: 1 },
    ]);
    expect(parseTypeCounts({ error: true })).toEqual([]);
  });
});

describe('businesses query', () => {
  it('ORs activity LIKEs with quotes escaped and wildcards stripped', () => {
    const p = businessesParams({ kind: 'focus', selection: sel({ ward: ['43'] }) }, ["Joe's Coffee", '100%_Food']);
    expect(p.$where).toBe(
      "((ward in('43'))) AND (business_activity like '%Joe''s Coffee%' OR business_activity like '%100  Food%') AND latitude IS NOT NULL",
    );
    expect(businessesParams({ kind: 'view', bounds: [0, 0, 1, 1] }, []).$where).toContain('(1 = 0)');
  });
});

describe('buildingAddress', () => {
  it.each([
    ['1001 W NORTH AVE  UNIT E', '1001 W NORTH AVE'],
    ['233 S WACKER DR 4030', '233 S WACKER DR'],
    ['4840 N MARINE DR 5 FLOORS', '4840 N MARINE DR'],
    ['1 N STATE ST STE 200', '1 N STATE ST'],
    ['10 W BROADWAY #3', '10 W BROADWAY'],
    ['5 N ELM', '5 N ELM'],
  ])('%s → %s', (raw, out) => expect(buildingAddress(raw)).toBe(out));
});

describe('groupCandidates', () => {
  it('one candidate per building, businesses deduped, bad rows skipped', () => {
    const rows = [
      { account_number: '1', site_number: '1', doing_business_as_name: 'DEEP PURPL', legal_name: 'PEGABLO LLC', address: '1001 W NORTH AVE  UNIT E', zip_code: '60642', latitude: '41.91', longitude: '-87.65', business_activity: 'Coffee' },
      { account_number: '1', site_number: '1', doing_business_as_name: 'DEEP PURPL', legal_name: 'PEGABLO LLC', address: '1001 W NORTH AVE  UNIT E', latitude: '41.91', longitude: '-87.65' },
      { account_number: '2', site_number: '1', doing_business_as_name: '', legal_name: 'WILD FORKS', address: '1001 W NORTH AVE', latitude: '41.91', longitude: '-87.65' },
      { account_number: '3', address: '233 S WACKER DR 4030', latitude: '41.87', longitude: '-87.63', legal_name: 'X' },
      { account_number: '4', address: '', latitude: '1', longitude: '1' },
      { account_number: '5', address: '9 N A ST', latitude: 'nope', longitude: '1' },
    ];
    const c = groupCandidates(rows);
    expect(c.map((x) => [x.key, x.businesses.length])).toEqual([['1001 W NORTH AVE', 2], ['233 S WACKER DR', 1]]);
    expect(c[0]).toMatchObject({ zip: '60642', lngLat: [-87.65, 41.91] });
    expect(c[0].businesses[1]).toMatchObject({ name: 'WILD FORKS', legalName: 'WILD FORKS' });
    expect(groupCandidates(null)).toEqual([]);
  });
});

describe('ChicagoBusinessDirectory (free, keyless)', () => {
  it('calls only the City of Chicago licence dataset', async () => {
    const fetchJson = vi.fn()
      .mockResolvedValueOnce([{ business_activity: 'Coffee', n: '2' }])
      .mockResolvedValueOnce([{ address: '1 N STATE ST', latitude: '41.88', longitude: '-87.62', legal_name: 'A' }]);
    const dir = new ChicagoBusinessDirectory(fetchJson);
    const area: SearchArea = { kind: 'focus', selection: sel({ ward: ['42'] }) };
    expect(await dir.activityCounts(area)).toEqual([{ activity: 'Coffee', count: 2 }]);
    expect(await dir.candidates(area, ['Coffee'])).toHaveLength(1);
    expect(await dir.candidates(area, [])).toEqual([]);
    expect(fetchJson).toHaveBeenCalledTimes(2);
    for (const [url] of fetchJson.mock.calls) expect(new URL(url).host).toBe('data.cityofchicago.org');
  });
});

// ---------------------------------------------------------------------------
// Map layer, helpers
// ---------------------------------------------------------------------------

function fakeMap(buildingHit?: Record<string, unknown>) {
  const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
  return {
    getSource: vi.fn((id: string) => sources.get(id)),
    addSource: vi.fn((id: string) => sources.set(id, { setData: vi.fn() })),
    addLayer: vi.fn(),
    moveLayer: vi.fn(),
    project: vi.fn(() => ({ x: 1, y: 2 })),
    queryRenderedFeatures: vi.fn(() => (buildingHit ? [{ properties: buildingHit }] : [])),
    getBounds: vi.fn(() => ({ getWest: () => -87.7, getSouth: () => 41.8, getEast: () => -87.6, getNorth: () => 41.9 })),
    sources,
  };
}
const asMap = (m: ReturnType<typeof fakeMap>) => m as unknown as maplibregl.Map;

const CAND: Candidate = { key: '1001 W NORTH AVE', address: '1001 W NORTH AVE', zip: '60642', lngLat: [-87.65, 41.91], businesses: [{ name: 'A', legalName: 'A', activity: 'Coffee', address: '1001 W NORTH AVE' }] };

describe('CandidatesLayer', () => {
  it('adds halo + dot once, then swaps data, always on top', () => {
    const map = fakeMap();
    setCandidates(asMap(map), [CAND]);
    setCandidates(asMap(map), []);
    expect(map.addLayer).toHaveBeenCalledTimes(2);
    expect(map.sources.get('discovery-candidates')!.setData).toHaveBeenLastCalledWith({ type: 'FeatureCollection', features: [] });
    expect(map.moveLayer).toHaveBeenCalledWith(CANDIDATE_HALO);
    expect(map.moveLayer).toHaveBeenLastCalledWith(CANDIDATE_DOT);
  });
});

describe('helpers', () => {
  it('describeArea', () => {
    expect(describeArea(sel({ zip: ['1', '2'], ward: ['3'] }))).toBe('2 zip codes, 1 ward');
    expect(describeArea(sel({ police: ['1'], ward: ['3'], mode: 'intersection' }))).toBe('overlap of 1 police district, 1 ward');
  });

  it('pickFor uses the footprint under the marker, else a synthetic id', () => {
    expect(pickFor(asMap(fakeMap({ id: 'bldg-9' })), CAND)).toEqual({ id: 'bldg-9', address: '1001 W NORTH AVE', lngLat: [-87.65, 41.91] });
    expect(pickFor(asMap(fakeMap()), CAND).id).toBe('biz:1001 W NORTH AVE');
    const broken = { ...fakeMap(), queryRenderedFeatures: () => { throw new Error('no layer'); } };
    expect(pickFor(broken as unknown as maplibregl.Map, CAND).id).toBe('biz:1001 W NORTH AVE');
    expect(pickFor(null, CAND).id).toBe('biz:1001 W NORTH AVE');
  });

  it('waitForResolved waits for the listed buildings, or times out', async () => {
    const store = new ContactListStore(null, 'chicago', [
      { id: 'a', address: 'x', lngLat: [0, 0], owners: [], businesses: [], status: 'loading', note: '', addedAt: 0 },
    ]);
    let settled = false;
    const p = waitForResolved(store, ['a'], 10_000).then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    store.retry('a'); // no resolver → no-op; patch status directly via a resolved add
    (store as unknown as { patch: (id: string, p: object) => void }).patch('a', { status: 'ready' });
    await p;
    expect(settled).toBe(true);
    await waitForResolved(store, ['nope'], 10); // nothing loading → immediate
    vi.useFakeTimers();
    (store as unknown as { patch: (id: string, p: object) => void }).patch('a', { status: 'loading' });
    const timed = waitForResolved(store, ['a'], 50);
    vi.advanceTimersByTime(60);
    await timed;
  });
});

// ---------------------------------------------------------------------------
// Hook + panel
// ---------------------------------------------------------------------------

function fakeDirectory(): BusinessDirectory & { activityCounts: ReturnType<typeof vi.fn>; candidates: ReturnType<typeof vi.fn> } {
  return {
    activityCounts: vi.fn(async () => [{ activity: 'Preparation and Sale of Coffee', count: 4 }, { activity: 'Tavern', count: 2 }]),
    candidates: vi.fn(async () => [CAND, { ...CAND, key: '233 S WACKER DR', address: '233 S WACKER DR', lngLat: [-87.63, 41.87] }]),
  };
}

const tick = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

describe('useDiscovery + DiscoveryPanel', () => {
  it('lists types for the focus area, highlights picks, removes on click, then looks up only the rest', async () => {
    const map = fakeMap();
    const resolve = vi.fn(async (_p, cb) => cb({ owners: [], businesses: [], status: 'ready', note: '' }));
    const store = new ContactListStore({ resolve } as unknown as ContactResolver, 'chicago', []);
    const runner = { startFor: vi.fn(async () => undefined) };
    const dir = fakeDirectory();
    const focus = sel({ ward: ['43'] });
    const { result } = renderHook(() => useDiscovery(asMap(map), focus, store, runner as never, dir));
    await tick();
    expect(result.current.areaLabel).toBe('1 ward');
    expect(dir.activityCounts).toHaveBeenCalledWith({ kind: 'focus', selection: focus });
    expect(result.current.types).toHaveLength(2);

    const ui = () => <DiscoveryPanel discovery={result.current} />;
    const r = render(ui());
    fireEvent.change(screen.getByPlaceholderText(/Search 2 business types/), { target: { value: 'coff' } });
    expect(screen.queryByText('Tavern')).toBeNull();
    fireEvent.click(screen.getByLabelText(/Preparation and Sale of Coffee/));
    await tick(450); // debounce
    r.rerender(ui());
    expect(dir.candidates).toHaveBeenCalledWith({ kind: 'focus', selection: focus }, ['Preparation and Sale of Coffee']);
    expect(result.current.visible).toHaveLength(2);
    expect(screen.getByText(/2 buildings highlighted \(2 businesses\)/)).toBeTruthy();
    expect(map.sources.get('discovery-candidates')!.setData).toHaveBeenLastCalledWith(
      expect.objectContaining({ features: expect.arrayContaining([expect.objectContaining({ properties: expect.objectContaining({ key: '233 S WACKER DR' }) })]) }),
    );

    act(() => result.current.removeCandidate('233 S WACKER DR')); // = clicking its marker
    r.rerender(ui());
    expect(result.current.visible.map((c) => c.key)).toEqual(['1001 W NORTH AVE']);
    expect(screen.getByText(/1 removed/)).toBeTruthy();

    fireEvent.click(screen.getByText('Look up these 1 buildings ($)'));
    expect(screen.getByText(/up to 2 credits/)).toBeTruthy();
    fireEvent.click(screen.getByText('Cancel'));
    fireEvent.click(screen.getByText('Look up these 1 buildings ($)'));
    await act(async () => {
      fireEvent.click(screen.getByText('Yes, look them up'));
    });
    await tick();
    expect(store.getSnapshot().map((b) => b.id)).toEqual(['biz:1001 W NORTH AVE']); // removed one NOT added
    expect(runner.startFor).toHaveBeenCalledWith(['biz:1001 W NORTH AVE']);
    expect(result.current.lookupPhase).toBe('done');
    expect(result.current.selected.size).toBe(0);
  });

  it('uses the map view when no focus area; restore, clear, refresh, errors', async () => {
    const map = fakeMap();
    const dir = fakeDirectory();
    const store = new ContactListStore(null, 'chicago', []);
    const { result } = renderHook(() => useDiscovery(asMap(map), EMPTY_SELECTION, store, { startFor: vi.fn() } as never, dir));
    await tick();
    expect(result.current.areaLabel).toBe('the map view (at last refresh)');
    expect(dir.activityCounts).toHaveBeenCalledWith({ kind: 'view', bounds: [-87.7, 41.8, -87.6, 41.9] });

    act(() => result.current.toggleType('Tavern'));
    await tick(450);
    act(() => result.current.removeCandidate(CAND.key));
    act(() => result.current.restoreRemoved());
    expect(result.current.removedCount).toBe(0);
    act(() => result.current.toggleType('Tavern')); // untick
    act(() => result.current.toggleType('Tavern'));
    act(() => result.current.clearTypes());
    await tick();
    expect(result.current.visible).toEqual([]);

    dir.activityCounts.mockRejectedValueOnce(new Error('down'));
    map.getBounds.mockReturnValueOnce({ getWest: () => 1, getSouth: () => 2, getEast: () => 3, getNorth: () => 4 });
    act(() => result.current.refresh());
    await tick();
    expect(result.current.error).toMatch(/business types/);

    dir.candidates.mockRejectedValueOnce(new Error('down'));
    act(() => result.current.toggleType('Tavern'));
    await tick(450);
    expect(result.current.error).toMatch(/businesses/);
    await act(async () => result.current.lookUp()); // nothing visible → no-op
  });

  it('a failed lookup reports an error', async () => {
    const map = fakeMap();
    const store = new ContactListStore(null, 'chicago', []);
    vi.spyOn(store, 'add').mockImplementation(() => { throw new Error('boom'); });
    const dir = fakeDirectory(); // created ONCE — a new directory per render would refetch forever
    const runner = { startFor: vi.fn() };
    // sel(...) builds a NEW (equal) selection each render — the hook must not loop on that.
    const { result } = renderHook(() => useDiscovery(asMap(map), sel({ ward: ['43'] }), store, runner as never, dir));
    act(() => result.current.toggleType('Tavern'));
    await tick(450);
    await act(async () => result.current.lookUp());
    expect(result.current.lookupPhase).toBe('error');
    render(<DiscoveryPanel discovery={{ ...result.current, error: 'x', candidatesLoading: true }} />);
    expect(screen.getByText(/Something went wrong/)).toBeTruthy();
    expect(screen.getByText('Finding buildings…')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Supporting changes
// ---------------------------------------------------------------------------

describe('contact list throttles lookups', () => {
  it(`runs at most ${MAX_PARALLEL_LOOKUPS} at once`, async () => {
    let running = 0;
    let peak = 0;
    const release: (() => void)[] = [];
    const resolve = vi.fn(
      (_p: unknown, cb: (f: object) => void) =>
        new Promise<void>((done) => {
          running++;
          peak = Math.max(peak, running);
          release.push(() => {
            running--;
            cb({ owners: [], businesses: [], status: 'ready', note: '' });
            done();
          });
        }),
    );
    const store = new ContactListStore({ resolve } as unknown as ContactResolver, 'chicago', []);
    for (let i = 0; i < 7; i++) store.add({ id: `b${i}`, address: `${i} ST`, lngLat: [0, 0] });
    await tick();
    expect(peak).toBe(MAX_PARALLEL_LOOKUPS);
    while (release.length) {
      release.shift()!();
      await tick();
    }
    expect(resolve).toHaveBeenCalledTimes(7);
    expect(peak).toBe(MAX_PARALLEL_LOOKUPS);
  });
});

describe('phone lookup waits out the rate limit', () => {
  it('retries a 429 after waiting, then gives up with a reason', async () => {
    const sleep = vi.fn(async () => undefined);
    const get = vi.fn()
      .mockRejectedValueOnce(new ApiError(429, '', ''))
      .mockResolvedValueOnce({ phone: '1', matched_name: '', provider: 'google', cached: false });
    const lookup = new BackendPhoneLookup('chicago', get as never, sleep);
    expect(await lookup.lookup({ name: 'A', address: 'B' })).toMatchObject({ status: 'found' });
    expect(sleep).toHaveBeenCalledTimes(1);

    get.mockReset().mockRejectedValue(new ApiError(429, '', ''));
    expect(await lookup.lookup({ name: 'A', address: 'B' })).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('limit') });
    expect(get).toHaveBeenCalledTimes(5); // first try + 4 retries
  });
});

describe('Layers panel keeps its filters mounted when closed', () => {
  it('hides instead of unmounting children', () => {
    const controls = {
      toggleLayer: vi.fn(), setOpacity: vi.fn(), toggleGroup: vi.fn(),
      getLayersByGroup: () => ({ infrastructure: [], zoning: [], poi: [], government: [], safety: [], historical: [], parks: [] }),
      groupLabels: {},
    };
    const mounted = vi.fn();
    const Child = () => { mounted(); return <div>zoning filter</div>; };
    render(<LayerPanel layerControls={controls as never}><Child /></LayerPanel>);
    fireEvent.click(screen.getByLabelText('Close layer panel'));
    expect(screen.getByText('zoning filter')).toBeTruthy(); // still in the DOM (hidden)
    expect(screen.getByRole('complementary', { hidden: true }).hidden).toBe(true);
    fireEvent.click(screen.getByLabelText('Open layer panel'));
    expect(mounted).toHaveBeenCalledTimes(1); // never re-mounted → state kept
  });
});
