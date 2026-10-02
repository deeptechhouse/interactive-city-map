// @vitest-environment happy-dom
/**
 * UI + map-wiring tests for focus areas and the contact list. Uses a fake map object
 * (records addLayer / setFilter / setData calls) — no WebGL needed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { loadJson, saveJson } from '../../utils/safeStorage';
import { setSelectedBuildings } from '../SelectedBuildingsLayer';
import { FOCUS_MASK_LAYER, setFocusMask } from '../../focus/FocusMaskLayer';
import { useFocusArea } from '../../focus/useFocusArea';
import { CHICAGO_PROFILE } from '../../cities/chicago';
import { FocusAreaPanel } from '../../focus/FocusAreaPanel';
import { ContactListPanel } from '../ContactListPanel';
import { ContactListStore } from '../ContactListStore';
import { useContactList } from '../useContactList';
import { BackendPhoneLookup, backendGetter, createPhoneLookup, UnavailablePhoneLookup } from '../phoneLookup';
import { BackendOwnerLookup, createOwnerLookup, UnavailableOwnerLookup } from '../ownerLookup';
import { apiClient, ApiError } from '../../api/client';
import * as csv from '../csvExport';
import * as csvSave from '../csvSave';
import { ZoningFilter } from '../../map/controls/ZoningFilter';
import { OwnerBatchRunner } from '../OwnerBatchRunner';
import type { OwnerBatchApi } from '../ownerLookup';

/** Batch API stub: start() answers every item as saved-and-found (no job). */
function fakeBatchApi(): OwnerBatchApi & { start: ReturnType<typeof vi.fn> } {
  return {
    start: vi.fn(async (items: { street: string }[]) => ({
      ok: true as const, jobId: '', pending: false, submitted: 0,
      results: items.map((i) => ({ street: i.street, answer: {
        status: 'found' as const, personName: 'JANE DOE', phones: [{ number: '(312) 555-0101', type: 'Mobile', dnc: false }],
        emails: ['jane@x.com'], source: 'tracerfy', lookedUpAt: '2026-10-02T07:55:00Z', dncChecked: false, method: 'address',
      } })),
    })),
    poll: vi.fn(),
  };
}
import { newOwner, type SelectedBuilding } from '../types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

/** Minimal stand-in for maplibregl.Map. */
function fakeMap(withBuildings = true) {
  const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
  const layers = new Map<string, unknown>();
  if (withBuildings) sources.set('buildings-source', { setData: vi.fn() });
  return {
    getSource: vi.fn((id: string) => sources.get(id)),
    addSource: vi.fn((id: string) => sources.set(id, { setData: vi.fn() })),
    getLayer: vi.fn((id: string) => layers.get(id)),
    addLayer: vi.fn((l: { id: string }) => layers.set(l.id, l)),
    setFilter: vi.fn(),
    moveLayer: vi.fn(),
    fitBounds: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
    sources,
    layers,
  };
}
type FakeMap = ReturnType<typeof fakeMap>;
const asMap = (m: FakeMap) => m as unknown as maplibregl.Map;

const building = (patch: Partial<SelectedBuilding> = {}): SelectedBuilding => ({
  id: 'b1', address: '1001 W NORTH AVE', lngLat: [-87.65, 41.91], status: 'ready', note: '', addedAt: 0,
  owners: [newOwner({
    name: 'CRM PROPERTIES GROUP', pin: '17', isCompany: true, letterTo: 'owner',
    ownerAddress: { street: '740 WAUKEGAN RD', city: 'DEERFIELD', state: 'IL', zip: '60015' },
    taxBillAddress: { street: '1 MAIN ST', city: 'CHICAGO', state: 'IL', zip: '60601' },
    website: 'crm.com', phoneDnc: true, phone: '(847) 555-0000', phoneNote: 'Mobile',
    extraPhones: [{ number: '(847) 555-0001', type: 'Landline', dnc: true }], extraEmails: ['x@crm.com'],
  })],
  businesses: [{
    id: '1-1', name: 'DEEP PURPL', legalName: 'PEGABLO LLC', activity: 'Coffee', address: '1001 W NORTH AVE', zip: '60642',
    phone: '(312) 555-0100', phoneStatus: 'found', phoneSource: 'google', website: 'deeppurpl.com',
  }],
  ...patch,
});

// ---------------------------------------------------------------------------

describe('safeStorage', () => {
  it('round-trips JSON and swallows storage errors', () => {
    saveJson('k', { a: 1 });
    expect(loadJson('k')).toEqual({ a: 1 });
    expect(loadJson('missing')).toBeNull();
    window.localStorage.setItem('bad', '{not json');
    expect(loadJson('bad')).toBeNull();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => saveJson('k', 1)).not.toThrow();
  });
});

describe('map layers', () => {
  it('selected-buildings outline is added once, then refiltered and kept on top', () => {
    const map = fakeMap();
    setSelectedBuildings(asMap(map), ['a']);
    expect(map.addLayer).toHaveBeenCalledTimes(2);
    setSelectedBuildings(asMap(map), ['a', 'b']);
    expect(map.addLayer).toHaveBeenCalledTimes(2);
    expect(map.setFilter).toHaveBeenLastCalledWith('buildings-selected-line', ['in', ['get', 'id'], ['literal', ['a', 'b']]]);
    expect(map.moveLayer).toHaveBeenCalledWith('buildings-selected-line');
  });

  it('selected-buildings waits for the buildings source', () => {
    const map = fakeMap(false);
    setSelectedBuildings(asMap(map), ['a']);
    expect(map.addLayer).not.toHaveBeenCalled();
  });

  it('focus mask sets data and clears it', () => {
    const map = fakeMap();
    const sq = { type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } };
    setFocusMask(asMap(map), sq, sq);
    const maskSrc = map.sources.get('focus-mask-source')!;
    expect(maskSrc.setData).toHaveBeenLastCalledWith({ type: 'FeatureCollection', features: [sq] });
    setFocusMask(asMap(map), null, null);
    expect(maskSrc.setData).toHaveBeenLastCalledWith({ type: 'FeatureCollection', features: [] });
    expect(map.addLayer).toHaveBeenCalledTimes(2); // not re-added
    expect(map.moveLayer).toHaveBeenCalledWith(FOCUS_MASK_LAYER);
  });
});

describe('phone lookup client', () => {
  it('maps backend answers', async () => {
    const get = vi.spyOn(apiClient, 'get');
    // Instant "sleep" so the 429 wait-and-retry doesn't take real time.
    const lookup = new BackendPhoneLookup('chicago', undefined, async () => undefined);
    const q = { name: 'A', address: 'B', lngLat: [-87, 41] as [number, number] };
    get.mockResolvedValueOnce({ phone: '(312) 555-0100', matched_name: 'x', provider: 'google', cached: false, website: 'a.com' });
    expect(await lookup.lookup(q)).toEqual({ status: 'found', phone: '(312) 555-0100', source: 'google', website: 'a.com' });
    expect(get.mock.calls[0][0]).toBe('/contacts/phone?name=A&address=B&city=chicago&locality=Chicago&region=IL&lat=41&lon=-87');

    get.mockResolvedValueOnce({ phone: '1', matched_name: '', provider: 'foursquare', cached: true });
    expect(await lookup.lookup({ name: 'CRM', address: '740 WAUKEGAN RD', locality: 'DEERFIELD', region: 'IL' }))
      .toMatchObject({ status: 'found', website: '' });
    expect(get.mock.calls[1][0]).toBe('/contacts/phone?name=CRM&address=740+WAUKEGAN+RD&city=chicago&locality=DEERFIELD&region=IL');

    get.mockResolvedValueOnce({ phone: '', matched_name: '', provider: '', cached: true });
    expect(await lookup.lookup(q)).toEqual({ status: 'not_found' });

    get.mockRejectedValueOnce(new Error('network'));
    expect(await lookup.lookup(q)).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('unreachable') });

    // Still rate-limited after every retry → reported, not hung.
    get.mockRejectedValue(new ApiError(429, 'slow down', 'u'));
    expect(await lookup.lookup(q)).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('limit') });
  });

  it('phone-only server URL is used when configured, with errors mapped', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ phone: '1', matched_name: '', provider: 'google', cached: false })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Google is not responding — try again shortly.' }), { status: 502 }));
    const lookup = createPhoneLookup('chicago', 'http://localhost:8000/api/v1/');
    const q = { name: 'A', address: 'B' };
    expect(await lookup.lookup(q)).toMatchObject({ status: 'found', source: 'google' });
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^http:\/\/localhost:8000\/api\/v1\/contacts\/phone\?/);
    expect(await lookup.lookup(q)).toMatchObject({ reason: 'Google is not responding — try again shortly.' });
  });

  it('owner lookup client maps answers and validates ZIP', async () => {
    const get = vi.fn();
    const lookup = new BackendOwnerLookup(get as never);
    get.mockResolvedValueOnce({ person_name: 'JANE', phones: [{ number: '1', type: 'Mobile', dnc: true }], emails: ['j@x.com'], provider: 'tracerfy', cached: false });
    expect(await lookup.lookup({ street: '1001 W NORTH AVE', zip: '60642', ownerName: 'CRM', locality: 'Chicago', region: 'IL' })).toEqual({
      status: 'found', personName: 'JANE', phones: [{ number: '1', type: 'Mobile', dnc: true }], emails: ['j@x.com'], source: 'tracerfy',
      lookedUpAt: '', dncChecked: true, method: '',
    });
    expect(get.mock.calls[0][0]).toBe('/contacts/owner?street=1001+W+NORTH+AVE&locality=Chicago&region=IL&owner_name=CRM&zip=60642');

    get.mockResolvedValueOnce({ person_name: '', phones: [], emails: [], provider: '', cached: false, looked_up_at: '2026-10-02T00:00:00Z' });
    expect(await lookup.lookup({ street: 'x', zip: 'bad', ownerName: '', locality: 'Detroit', region: 'mi' }, true)).toEqual({ status: 'not_found', lookedUpAt: '2026-10-02T00:00:00Z' });
    expect(get.mock.calls[1][0]).toContain('locality=Detroit&region=MI');
    expect(get.mock.calls[1][0]).toContain('refresh=true');
    expect(get.mock.calls[1][0]).not.toContain('zip=');
    // No city → no call, nothing charged (wrong-city guard, 2026-10-02).
    const calls = get.mock.calls.length;
    expect(await lookup.lookup({ street: 'x', zip: '', ownerName: '', locality: '', region: '' })).toMatchObject({ status: 'unavailable' });
    expect(get.mock.calls.length).toBe(calls);

    get.mockResolvedValueOnce({ person_name: undefined, phones: undefined, emails: ['e'], provider: undefined });
    expect(await lookup.lookup({ street: 'x', zip: '', ownerName: '', locality: 'Chicago', region: 'IL' })).toMatchObject({ status: 'found', personName: '', phones: [], source: '' });

    get.mockRejectedValueOnce(new ApiError(429, '', ''));
    expect(await lookup.lookup({ street: 'x', zip: '', ownerName: '', locality: 'Chicago', region: 'IL' })).toMatchObject({ status: 'unavailable' });

    // Provider failure explained by the server (out of credits) is shown verbatim.
    get.mockRejectedValueOnce(new ApiError(402, JSON.stringify({ detail: 'Tracerfy account is out of credits — add credits on their website.' }), ''));
    expect(await lookup.lookup({ street: 'x', zip: '', ownerName: '', locality: 'Chicago', region: 'IL' })).toEqual({
      status: 'unavailable', reason: 'Tracerfy account is out of credits — add credits on their website.',
    });
    get.mockRejectedValueOnce(new ApiError(502, 'not json', ''));
    expect(await lookup.lookup({ street: 'x', zip: '', ownerName: '', locality: 'Chicago', region: 'IL' })).toMatchObject({ reason: 'Lookup service unreachable' });

    expect(createOwnerLookup('http://x/api/v1')).toBeInstanceOf(BackendOwnerLookup);
    expect(await new UnavailableOwnerLookup().lookup()).toMatchObject({ status: 'unavailable' });
    expect(backendGetter('')).not.toBeNull(); // tests run outside static mode → full backend
  });

  it('factory picks the backend outside static mode', async () => {
    expect(createPhoneLookup('chicago')).toBeInstanceOf(BackendPhoneLookup);
    expect(await new UnavailablePhoneLookup('why').lookup()).toEqual({ status: 'unavailable', reason: 'why' });
  });
});

// ---------------------------------------------------------------------------

describe('useFocusArea + FocusAreaPanel', () => {
  it('selecting a ward masks the map, persists, zooms and clears', async () => {
    const map = fakeMap();
    const { result } = renderHook(() => useFocusArea(asMap(map), CHICAGO_PROFILE.focus));
    await act(async () => {}); // boundaries load asynchronously (city profiles are lazy)
    const { rerender } = render(<FocusAreaPanel focus={result.current} />);
    const rerenderPanel = () => rerender(<FocusAreaPanel focus={result.current} />);

    fireEvent.change(screen.getByLabelText('Search City wards'), { target: { value: 'Ward 43 ' } });
    fireEvent.click(screen.getByLabelText(/Ward 43 —/));
    rerenderPanel();

    expect(result.current.selection.ward).toEqual(['43']);
    expect(result.current.shape).not.toBeNull();
    expect(loadJson('citymap.focusSelection.v1')).toMatchObject({ ward: ['43'] });
    const outline = map.sources.get('focus-outline-source')!;
    expect(outline.setData.mock.calls.at(-1)![0].features).toHaveLength(1);

    fireEvent.click(screen.getByText('Zoom to focus'));
    expect(map.fitBounds).toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText(/Overlap only/));
    rerenderPanel();
    expect(result.current.selection.mode).toBe('intersection');

    fireEvent.click(screen.getByText('Clear'));
    rerenderPanel();
    expect(result.current.selection.ward).toEqual([]);
    expect(outline.setData.mock.calls.at(-1)![0].features).toHaveLength(0);
  });

  it('select-all/none per kind and the no-overlap warning', async () => {
    const map = fakeMap();
    const { result } = renderHook(() => useFocusArea(asMap(map), CHICAGO_PROFILE.focus));
    await act(async () => {}); // boundaries load asynchronously
    const { rerender } = render(<FocusAreaPanel focus={result.current} />);
    const again = () => rerender(<FocusAreaPanel focus={result.current} />);

    act(() => {
      result.current.setKindIds('zip', ['60614']);
      result.current.setKindIds('police', ['22']); // far south side
      result.current.setMode('intersection');
    });
    again();
    expect(result.current.isEmptyResult).toBe(true);
    expect(screen.getByRole('status').textContent).toMatch(/don’t overlap/);

    fireEvent.click(screen.getAllByText('None')[0]);
    act(() => result.current.toggle('police', '22'));
    again();
    expect(result.current.selection.zip).toEqual([]);
    expect(result.current.selection.police).toEqual([]);
    fireEvent.click(screen.getAllByText('Select all')[2]);
    again();
    expect(result.current.selection.ward).toHaveLength(50);
  });

  it('disabled (non-Chicago) never shows a mask', () => {
    saveJson('citymap.focusSelection.v1', { ward: ['1'] });
    const map = fakeMap();
    renderHook(() => useFocusArea(asMap(map), null));
    expect(map.sources.get('focus-mask-source')!.setData).toHaveBeenLastCalledWith({ type: 'FeatureCollection', features: [] });
  });
});

// ---------------------------------------------------------------------------

describe('useContactList + ContactListPanel', () => {
  it('outlines the stored buildings on the map and retries when the map settles', () => {
    const map = fakeMap();
    saveJson('citymap.contactList.v1.chicago', [building()]);
    const { result, unmount } = renderHook(() => useContactList(asMap(map), 'chicago'));
    expect(result.current.buildings).toHaveLength(1);
    expect(result.current.lookupAvailable).toBe(true);
    expect(map.once).toHaveBeenCalledWith('idle', expect.any(Function));
    unmount();
    expect(map.off).toHaveBeenCalled();
  });

  it('renders contacts, edits phones on blur, removes, exports and clears', async () => {
    const store = new ContactListStore(null, 'chicago', [building(), building({ id: 'b2', address: '', owners: [], businesses: [], status: 'error', note: 'Lookup failed' })]);
    const toggle = vi.fn();
    // Never let a test reach the real lookup server (it would write to the real Desktop).
    const save = vi.spyOn(csvSave, 'saveCsv').mockResolvedValue({ saved: true, filename: 'contacts-x.csv', path: '/Users/me/Desktop/contacts-x.csv' });
    const runner = new OwnerBatchRunner(store, fakeBatchApi(), 'chicago');
    const ui = () => (
      <ContactListPanel store={store} buildings={store.getSnapshot()} selectionMode={false} onToggleSelectionMode={toggle}
        lookupAvailable={false} batchRunner={runner} batch={runner.getSnapshot()} />
    );
    const { rerender } = render(ui());

    expect(screen.getByText('1001 W NORTH AVE')).toBeTruthy();
    expect(screen.getByDisplayValue('740 WAUKEGAN RD')).toBeTruthy();
    expect(screen.getByText(/Owner address — 740 WAUKEGAN RD, DEERFIELD/)).toBeTruthy();
    expect(screen.getByText(/Tax-bill address — 1 MAIN ST, CHICAGO/)).toBeTruthy();
    expect(screen.getAllByText('DNC')).toHaveLength(2);
    expect(screen.getByText(/also \(847\) 555-0001/)).toBeTruthy();
    expect(screen.getByText('also x@crm.com')).toBeTruthy();
    expect(screen.getByText('crm.com ↗').getAttribute('href')).toBe('https://crm.com/');
    expect(screen.getByText('deeppurpl.com ↗')).toBeTruthy();
    expect(screen.getByText('IL Secretary of State lookup ↗').getAttribute('target')).toBe('_blank');
    expect(screen.getByText('via google')).toBeTruthy();
    expect(screen.getByText('PEGABLO LLC')).toBeTruthy();
    expect(screen.getByText(/isn't available for this city yet/)).toBeTruthy();
    expect(screen.getByText('No owner record found.')).toBeTruthy();
    expect(screen.getByText('Retry')).toBeTruthy();

    fireEvent.click(screen.getByText('Select buildings on map'));
    expect(toggle).toHaveBeenCalled();

    const phone = screen.getByLabelText('Phone for DEEP PURPL');
    fireEvent.change(phone, { target: { value: '312-999-0000' } });
    fireEvent.keyDown(phone, { key: 'Enter' });
    fireEvent.blur(phone);
    rerender(ui());
    expect(store.getSnapshot()[0].businesses[0]).toMatchObject({ phone: '312-999-0000', phoneStatus: 'manual' });
    expect(screen.getByText('entered by hand')).toBeTruthy();

    const ownerName = screen.getByLabelText('Owner name');
    fireEvent.change(ownerName, { target: { value: 'NEW OWNER' } });
    fireEvent.blur(ownerName);
    for (const [label, value] of [['Mail street', '2 B ST'], ['Mail city', 'SKOKIE'], ['Mail state', 'IL'], ['Mail ZIP', '60076'],
      ['Contact person', 'JANE DOE'], ['Owner email', 'j@x.com'], ['Owner phone', '1']]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
      fireEvent.blur(screen.getByLabelText(label));
    }
    expect(store.getSnapshot()[0].owners[0]).toMatchObject({
      name: 'NEW OWNER', ownerAddress: { street: '2 B ST', city: 'SKOKIE', state: 'IL', zip: '60076' },
      contactPerson: 'JANE DOE', email: 'j@x.com', phone: '1', phoneDnc: false,
    });
    rerender(ui());
    fireEvent.click(screen.getByLabelText(/Tax-bill address/));
    expect(store.getSnapshot()[0].owners[0].letterTo).toBe('taxBill');
    rerender(ui());
    fireEvent.click(screen.getByLabelText(/Owner address/));
    expect(store.getSnapshot()[0].owners[0].letterTo).toBe('owner');

    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    fireEvent.click(screen.getByText('Copy name'));
    expect(writeText).toHaveBeenCalledWith('NEW OWNER');

    // The instant (5-credit) button is hidden; owner lookups go through the batch.
    expect(screen.queryByText('Find owner phone & email ($)')).toBeNull();

    fireEvent.click(screen.getAllByText('+ Add owner')[1]);
    expect(store.getSnapshot()[1].owners).toHaveLength(1);

    rerender(ui()); // panel props = the current list
    await act(async () => {
      fireEvent.click(screen.getByText(/Export CSV/));
    });
    expect(save).toHaveBeenCalledWith(store.getSnapshot(), undefined, undefined, undefined, store.city);
    expect(screen.getByText('Saved to Desktop: contacts-x.csv')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Remove 1001 W NORTH AVE from list'));
    rerender(ui());
    expect(store.getSnapshot()).toHaveLength(1);

    fireEvent.click(screen.getByText('Clear list'));
    rerender(ui());
    expect(screen.getByText(/No buildings yet/)).toBeTruthy();
  });

  it('shows the active selection state and loading/phone statuses', () => {
    const store = new ContactListStore(null, 'chicago', [building({
      status: 'loading',
      owners: [newOwner({ name: 'A LLC', taxBillAddress: { street: '1 X', city: '', state: '', zip: '' }, letterTo: 'taxBill', companyLookup: 'pending', skipTrace: 'pending' })],
      businesses: [{ ...building().businesses[0], phone: '', phoneStatus: 'pending', phoneSource: '' }],
    })]);
    const runner = new OwnerBatchRunner(store, fakeBatchApi(), 'chicago');
    render(<ContactListPanel store={store} buildings={store.getSnapshot()} selectionMode onToggleSelectionMode={() => {}}
      lookupAvailable batchRunner={runner} batch={runner.getSnapshot()} />);
    expect(screen.getByRole('button', { pressed: true }).textContent).toMatch(/Selecting buildings/);
    expect(screen.getByText(/Looking up owner/)).toBeTruthy();
    expect(screen.getByText('looking up…')).toBeTruthy();
    expect(screen.getByText('Searching for the owner company…')).toBeTruthy();
    expect(screen.getByText('Owner lookup: searching…')).toBeTruthy();
    expect(screen.getByText(/Mailing address/)).toBeTruthy();
  });

  it('downloadCsv builds a UTF-8 CSV blob and clicks a link', () => {
    const create = vi.fn(() => 'blob:x');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    csv.downloadCsv([building()]);
    expect(create).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith('blob:x');
  });
});

// ---------------------------------------------------------------------------

describe('ZoningFilter', () => {
  it('class checkbox, expand, and single type toggles drive the layer filter', () => {
    const map = fakeMap();
    map.layers.set('zoning-fill', {});
    map.layers.set('zoning-stroke', {});
    render(<ZoningFilter map={asMap(map)} />);
    expect(map.setFilter).toHaveBeenLastCalledWith('zoning-stroke', null); // all on → no filter

    fireEvent.click(screen.getByLabelText('All Residential zoning'));
    const filter = map.setFilter.mock.calls.at(-1)![1] as unknown[];
    expect(filter[0]).toBe('any');
    expect(JSON.stringify(filter)).not.toContain('residential');

    fireEvent.click(screen.getByLabelText('Show Commercial types'));
    fireEvent.click(screen.getByLabelText(/B1 — Neighborhood shopping/));
    const indeterminate = screen.getByLabelText('All Commercial zoning') as HTMLInputElement;
    expect(indeterminate.indeterminate).toBe(true);
    fireEvent.click(screen.getByLabelText(/B1 — Neighborhood shopping/));
    expect(indeterminate.indeterminate).toBe(false);
    fireEvent.click(screen.getByLabelText('Hide Commercial types'));
    expect(screen.queryByLabelText(/B1 — Neighborhood shopping/)).toBeNull();

    fireEvent.click(screen.getByLabelText('All Residential zoning'));
    expect(map.setFilter).toHaveBeenLastCalledWith('zoning-stroke', null);
  });
});
