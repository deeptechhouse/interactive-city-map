// @vitest-environment happy-dom
/**
 * Owner BATCH lookup: runner (start → poll → apply, resume, give-up), the HTTP client,
 * the store's batch helpers, and the batch UI. Timers are injected — no real waiting.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContactListStore } from '../ContactListStore';
import { ownerPatchFromAnswer } from '../ContactResolver';
import { ContactListPanel } from '../ContactListPanel';
import { formatLookupDate } from '../links';
import {
  BackendOwnerBatchApi,
  createOwnerBatchApi,
  toOwnerAnswer,
  UnavailableOwnerBatchApi,
  type BatchReply,
  type OwnerAnswer,
  type OwnerBatchApi,
} from '../ownerLookup';
import { batchCostRange, GIVE_UP_MS, IDLE_BATCH, OwnerBatchRunner, parseSavedBatch, POLL_MS } from '../OwnerBatchRunner';
import { ApiError } from '../../api/client';
import { saveJson } from '../../utils/safeStorage';
import { newOwner, type SelectedBuilding } from '../types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const JOB = 'a'.repeat(32);
const FOUND: OwnerAnswer = {
  status: 'found', personName: 'JANE DOE', source: 'tracerfy', lookedUpAt: '2026-10-02T07:55:00Z', dncChecked: false, method: 'address',
  phones: [{ number: '(312) 555-0100', type: 'Mobile', dnc: false }, { number: '(312) 555-0200', type: 'Landline', dnc: false }],
  emails: ['jane@x.com'],
};

function building(id: string, address: string, patch: Partial<SelectedBuilding> = {}): SelectedBuilding {
  return {
    id, address, lngLat: [0, 0], status: 'ready', note: '', addedAt: 0, businesses: [],
    owners: [newOwner({ name: `${id} LLC`, propertyZip: '60642', isCompany: true })],
    ...patch,
  };
}

/** Manual timer: tests call run() to fire the scheduled poll. */
function manualTimer() {
  let pending: (() => void) | null = null;
  const t = {
    set: vi.fn((fn: () => void) => { pending = fn; return 1; }),
    clear: vi.fn(() => { pending = null; }),
    async run() { const fn = pending; pending = null; fn?.(); await new Promise((r) => setTimeout(r, 0)); },
    get scheduled() { return pending !== null; },
  };
  return t;
}

function apiStub(start: BatchReply, polls: BatchReply[] = []): OwnerBatchApi & { start: ReturnType<typeof vi.fn>; poll: ReturnType<typeof vi.fn> } {
  const queue = [...polls];
  return { start: vi.fn(async () => start), poll: vi.fn(async () => queue.shift() ?? { ok: false, reason: 'no more polls' }) };
}

// ---------------------------------------------------------------------------

describe('answer → owner fields', () => {
  it('found / not found / unavailable', () => {
    expect(ownerPatchFromAnswer(FOUND)).toMatchObject({
      skipTrace: 'found', skipTracedAt: '2026-10-02T07:55:00Z', dncChecked: false, contactPerson: 'JANE DOE',
      phone: '(312) 555-0100', phoneNote: 'Mobile · via tracerfy', extraPhones: [{ number: '(312) 555-0200' }], email: 'jane@x.com',
    });
    expect(ownerPatchFromAnswer({ status: 'not_found', lookedUpAt: 'd' })).toEqual({ skipTrace: 'not_found', skipTracedAt: 'd' });
    expect(ownerPatchFromAnswer({ status: 'unavailable', reason: 'r' })).toEqual({ skipTrace: 'unavailable', reason: 'r' });
    expect(ownerPatchFromAnswer({ ...FOUND, phones: [], emails: [] } as OwnerAnswer)).toMatchObject({ phone: '', phoneNote: '', email: '' });
  });

  it('toOwnerAnswer treats DNC-unchecked batch JSON correctly', () => {
    expect(toOwnerAnswer({ person_name: 'J', phones: [{ number: '1', type: 'Mobile', dnc: false }], emails: [], provider: 'tracerfy', dnc_checked: false, looked_up_at: 'd' }))
      .toMatchObject({ status: 'found', dncChecked: false, lookedUpAt: 'd' });
  });

  it('formats lookup dates', () => {
    expect(formatLookupDate('2026-10-02T07:55:00Z')).toMatch(/2026/);
    expect(formatLookupDate('')).toBe('');
  });
});

describe('store batch helpers', () => {
  it('candidates, pending marks, applying answers, counting, reset', () => {
    const store = new ContactListStore(null, 'chicago', [
      building('b1', '1001 W NORTH AVE'),
      building('b2', '233 S WACKER DR'),
      building('b3', '', {}), // no address → never sent
      building('b4', '1 N STATE ST', { owners: [] }), // no owner → never sent
    ]);
    expect(store.batchCandidates(false).map((c) => c.buildingId)).toEqual(['b1', 'b2']);
    expect(store.batchCandidates(false)[0]).toEqual({ buildingId: 'b1', street: '1001 W NORTH AVE', zip: '60642', firstName: '', lastName: '' });

    store.markOwnersPending(['b1', 'b2']);
    expect(store.getSnapshot()[0].owners[0].skipTrace).toBe('pending');
    expect(store.batchCandidates(false)).toEqual([]); // pending owners aren't re-sent

    store.applyOwnerAnswer(' 1001 w north ave ', FOUND);
    expect(store.getSnapshot()[0].owners[0]).toMatchObject({ skipTrace: 'found', dncChecked: false, contactPerson: 'JANE DOE' });
    expect(store.countOwnersFound(['b1', 'b2'])).toBe(1);

    store.resetPendingOwner('b2');
    store.resetPendingOwner('b1'); // found owner stays found
    expect(store.getSnapshot().map((b) => b.owners[0]?.skipTrace)).toEqual(['found', 'idle', 'idle', undefined]);

    // Refresh includes already-looked-up owners; onlyIds narrows to one building.
    expect(store.batchCandidates(true, new Set(['b1'])).map((c) => c.buildingId)).toEqual(['b1']);
  });
});

describe('ContactListStore.applyOwnerAnswer (single commit, 2026-10-06)', () => {
  it('fills every building at the street with ONE commit and leaves the others alone', () => {
    const store = new ContactListStore(null, 'chicago', [
      building('b1', '1001 W NORTH AVE'),
      building('b2', '1001 w north ave'),
      building('b3', '5 N STATE ST'),
    ]);
    const before = store.getSnapshot();
    const notify = vi.fn();
    store.subscribe(notify);

    store.applyOwnerAnswer('1001 W NORTH AVE', FOUND);

    expect(notify).toHaveBeenCalledTimes(1);
    const after = store.getSnapshot();
    expect(after.map((b) => b.owners[0].skipTrace)).toEqual(['found', 'found', before[2].owners[0].skipTrace]);
    expect(after[2]).toBe(before[2]); // untouched building keeps its identity
    expect(after[0].owners[0].extraPhones).not.toBe(after[1].owners[0].extraPhones); // each gets its own copy
  });

  it('writes the reason note and skips the commit when nothing matches', () => {
    const store = new ContactListStore(null, 'chicago', [building('b1', '1001 W NORTH AVE')]);
    const notify = vi.fn();
    store.subscribe(notify);
    store.applyOwnerAnswer('9 NOWHERE ST', FOUND);
    expect(notify).not.toHaveBeenCalled();
    store.applyOwnerAnswer('1001 W NORTH AVE', { status: 'unavailable', reason: 'out of credits' } as never);
    expect(store.getSnapshot()[0]).toMatchObject({ note: 'out of credits' });
    expect(store.getSnapshot()[0].owners[0].skipTrace).toBe('unavailable');
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------

describe('OwnerBatchRunner', () => {
  it('saved answers only → done at once, nothing scheduled', async () => {
    const store = new ContactListStore(null, 'chicago', [building('b1', '1001 W NORTH AVE')]);
    const api = apiStub({ ok: true, jobId: '', pending: false, submitted: 0, results: [{ street: '1001 W NORTH AVE', answer: FOUND }] });
    const timer = manualTimer();
    const runner = new OwnerBatchRunner(store, api, 'chicago', timer);
    expect(runner.pendingCount()).toBe(1);
    await runner.start();
    expect(api.start).toHaveBeenCalledWith([{ street: '1001 W NORTH AVE', zip: '60642', firstName: '', lastName: '', city: 'Chicago', state: 'IL' }], false);
    expect(runner.getSnapshot()).toMatchObject({ phase: 'done', found: 1, total: 1, reused: 1 });
    expect(timer.scheduled).toBe(false);
    await runner.start(); // nothing left → no-op
    expect(api.start).toHaveBeenCalledTimes(1);
  });

  it('a Detroit batch is sent as Detroit, MI (TDD §13 F-1)', async () => {
    const store = new ContactListStore(null, 'detroit', [building('b1', '1331 BROADWAY ST')]);
    const api = apiStub({ ok: true, jobId: '', pending: false, submitted: 0, results: [] });
    await new OwnerBatchRunner(store, api, 'detroit', manualTimer()).start();
    expect(api.start.mock.calls[0][0][0]).toMatchObject({ street: '1331 BROADWAY ST', city: 'Detroit', state: 'MI' });
  });

  it('queued job → polls until done, applies results, saves state', async () => {
    const store = new ContactListStore(null, 'chicago', [building('b1', '1001 W NORTH AVE'), building('b2', '233 S WACKER DR')]);
    const api = apiStub(
      { ok: true, jobId: JOB, pending: true, submitted: 2, results: [] },
      [
        { ok: true, jobId: JOB, pending: true, submitted: 2, results: [] },
        { ok: true, jobId: JOB, pending: false, submitted: 2, results: [
          { street: '1001 W NORTH AVE', answer: FOUND },
          { street: '233 S WACKER DR', answer: { status: 'not_found', lookedUpAt: 'd' } },
        ] },
      ],
    );
    const timer = manualTimer();
    const listener = vi.fn();
    const runner = new OwnerBatchRunner(store, api, 'chicago', timer);
    runner.subscribe(listener);
    await runner.start();
    expect(runner.getSnapshot()).toMatchObject({ phase: 'running', jobId: JOB, submitted: 2 });
    expect(runner.isRunning).toBe(true);
    expect(timer.set).toHaveBeenLastCalledWith(expect.any(Function), POLL_MS);
    expect(store.getSnapshot().map((b) => b.owners[0].skipTrace)).toEqual(['pending', 'pending']);
    expect(JSON.parse(window.localStorage.getItem('citymap.ownerBatch.v1.chicago')!)).toMatchObject({ jobId: JOB, phase: 'running' });

    await runner.start(); // already running → ignored
    expect(api.start).toHaveBeenCalledTimes(1);

    await timer.run(); // still pending → rescheduled
    expect(runner.getSnapshot().phase).toBe('running');
    await timer.run(); // done
    expect(api.poll).toHaveBeenCalledWith(JOB);
    expect(runner.getSnapshot()).toMatchObject({ phase: 'done', found: 1, total: 2 });
    expect(store.getSnapshot().map((b) => b.owners[0].skipTrace)).toEqual(['found', 'not_found']);
    expect(listener).toHaveBeenCalled();
  });

  it('start failure resets owners and shows the reason', async () => {
    const store = new ContactListStore(null, 'chicago', [building('b1', '1001 W NORTH AVE')]);
    const runner = new OwnerBatchRunner(store, apiStub({ ok: false, reason: 'Tracerfy account is out of credits' }), 'chicago', manualTimer());
    await runner.start();
    expect(runner.getSnapshot()).toMatchObject({ phase: 'error', message: 'Tracerfy account is out of credits' });
    expect(store.getSnapshot()[0].owners[0].skipTrace).toBe('idle');
  });

  it('poll failure → error; give-up after GIVE_UP_MS; Check again resumes', async () => {
    const store = new ContactListStore(null, 'chicago', [building('b1', '1001 W NORTH AVE')]);
    let now = 1_000_000;
    const api = apiStub(
      { ok: true, jobId: JOB, pending: true, submitted: 1, results: [] },
      [{ ok: true, jobId: JOB, pending: true, submitted: 1, results: [] }, { ok: false, reason: 'down' }],
    );
    const timer = manualTimer();
    const runner = new OwnerBatchRunner(store, api, 'chicago', timer, () => now);
    await runner.start();
    now += GIVE_UP_MS + 1;
    await timer.run();
    expect(runner.getSnapshot()).toMatchObject({ phase: 'error', jobId: JOB });
    expect(runner.getSnapshot().message).toMatch(/Check again/);
    runner.checkAgain();
    expect(runner.getSnapshot().phase).toBe('running');
    await timer.run();
    expect(runner.getSnapshot()).toMatchObject({ phase: 'error', message: 'down' });
    runner.dispose();
  });

  it('resumes a running batch after a page reload; drops a job-less "starting"', async () => {
    saveJson('citymap.ownerBatch.v1.chicago', { ...IDLE_BATCH, phase: 'running', jobId: JOB, startedAt: new Date().toISOString(), buildingIds: ['b1'] });
    const store = new ContactListStore(null, 'chicago', [building('b1', '1001 W NORTH AVE')]);
    const api = apiStub({ ok: false, reason: 'unused' }, [
      { ok: true, jobId: JOB, pending: false, submitted: 1, results: [{ street: '1001 W NORTH AVE', answer: FOUND }] },
    ]);
    const timer = manualTimer();
    const runner = new OwnerBatchRunner(store, api, 'chicago', timer);
    expect(timer.set).toHaveBeenCalledWith(expect.any(Function), 0);
    await timer.run();
    expect(runner.getSnapshot().phase).toBe('done');
    expect(store.getSnapshot()[0].owners[0].skipTrace).toBe('found');

    saveJson('citymap.ownerBatch.v1.chicago', { phase: 'starting', jobId: '' });
    expect(new OwnerBatchRunner(store, api, 'chicago', manualTimer()).getSnapshot().phase).toBe('idle');
  });

  it('recheck sends one building with refresh=true', async () => {
    const store = new ContactListStore(null, 'chicago', [
      building('b1', '1001 W NORTH AVE', { owners: [newOwner({ name: 'X', skipTrace: 'found' })] }),
      building('b2', '233 S WACKER DR'),
    ]);
    const api = apiStub({ ok: true, jobId: '', pending: false, submitted: 0, results: [] });
    await new OwnerBatchRunner(store, api, 'chicago', manualTimer()).recheck('b1');
    expect(api.start).toHaveBeenCalledWith([{ street: '1001 W NORTH AVE', zip: '', firstName: '', lastName: '', city: 'Chicago', state: 'IL' }], true);
  });

  it('parseSavedBatch rejects junk', () => {
    expect(parseSavedBatch(null)).toEqual(IDLE_BATCH);
    expect(parseSavedBatch({ phase: 'evil', jobId: '../x', total: 'NaN', buildingIds: [1, 'b'] }))
      .toMatchObject({ phase: 'idle', jobId: '', total: 0, buildingIds: ['b'] });
  });

  it('uses real timers by default', () => {
    const store = new ContactListStore(null, 'chicago', []);
    const spy = vi.spyOn(globalThis, 'setTimeout');
    saveJson('citymap.ownerBatch.v1.chicago', { phase: 'running', jobId: JOB, startedAt: new Date().toISOString() });
    const runner = new OwnerBatchRunner(store, new UnavailableOwnerBatchApi(), 'chicago');
    expect(spy).toHaveBeenCalled();
    runner.dispose();
  });
});

// ---------------------------------------------------------------------------

describe('BackendOwnerBatchApi', () => {
  it('posts items, maps replies and errors', async () => {
    const post = vi.fn().mockResolvedValueOnce({
      job_id: JOB, pending: true, submitted: 1,
      results: [{ street: 'S', zip: '', cached: true, person_name: 'J', phones: [], emails: ['e'], provider: 'tracerfy', looked_up_at: 'd', dnc_checked: false }],
    });
    const get = vi.fn().mockResolvedValueOnce({ job_id: JOB, pending: false, submitted: 1, results: [] });
    const api = new BackendOwnerBatchApi(get as never, post as never);
    const started = await api.start([
      { street: '1001 W NORTH AVE', zip: '60642' },
      { street: 'x', zip: 'bad', firstName: 'THOMAS', lastName: 'LIZAK' },
    ], false);
    expect(post).toHaveBeenCalledWith('/contacts/owner/batch', {
      refresh: false, items: [
        { street: '1001 W NORTH AVE', zip: '60642', first_name: '', last_name: '' },
        { street: 'x', zip: '', first_name: 'THOMAS', last_name: 'LIZAK' },
      ],
    });
    expect(started).toMatchObject({ ok: true, jobId: JOB, pending: true, results: [{ street: 'S', answer: { status: 'found', dncChecked: false } }] });
    expect(await api.poll(JOB)).toMatchObject({ ok: true, pending: false });
    expect(get).toHaveBeenCalledWith(`/contacts/owner/batch/${JOB}`);

    post.mockRejectedValueOnce(new ApiError(402, JSON.stringify({ detail: 'Tracerfy account is out of credits' }), ''));
    expect(await api.start([], true)).toEqual({ ok: false, reason: 'Tracerfy account is out of credits' });
    get.mockRejectedValueOnce(new ApiError(404, '{"detail":"Batch not found."}', ''));
    expect(await api.poll(JOB)).toEqual({ ok: false, reason: 'Batch not found.' });
    get.mockResolvedValueOnce({});
    expect(await api.poll(JOB)).toEqual({ ok: true, jobId: '', pending: false, submitted: 0, byName: 0, results: [] });
  });

  it('factory and unavailable fallback', async () => {
    expect(createOwnerBatchApi('http://localhost:8000/api/v1')).toBeInstanceOf(BackendOwnerBatchApi);
    expect(createOwnerBatchApi()).toBeInstanceOf(BackendOwnerBatchApi); // tests run outside static mode
    const none = new UnavailableOwnerBatchApi();
    expect(await none.start()).toMatchObject({ ok: false });
    expect(await none.poll()).toMatchObject({ ok: false });
  });

  it('POSTs JSON to the phone server URL', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ job_id: '', pending: false, submitted: 0, results: [] })),
    );
    await createOwnerBatchApi('http://localhost:8000/api/v1/').start([{ street: 'S', zip: '' }], false);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:8000/api/v1/contacts/owner/batch');
    expect(init).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ refresh: false, items: [{ street: 'S', zip: '', first_name: '', last_name: '' }] });
    // A city/state on the item is sent (TDD §13 F-1 — the backend defaults to Chicago, IL).
    await createOwnerBatchApi('http://localhost:8000/api/v1/').start([{ street: 'S', zip: '', city: 'Detroit', state: 'mi' }], false);
    const [, init2] = fetchMock.mock.calls.at(-1)!;
    expect(JSON.parse(String((init2 as RequestInit).body)).items[0]).toMatchObject({ city: 'Detroit', state: 'MI' });
  });
});

// ---------------------------------------------------------------------------

describe('batch UI', () => {
  function renderPanel(store: ContactListStore, runner: OwnerBatchRunner) {
    const ui = () => (
      <ContactListPanel store={store} buildings={store.getSnapshot()} selectionMode={false} onToggleSelectionMode={() => {}}
        lookupAvailable batchRunner={runner} batch={runner.getSnapshot()} />
    );
    const r = render(ui());
    return () => r.rerender(ui());
  }

  it('button shows count and cost; click runs the batch; results show date and DNC notice', async () => {
    const store = new ContactListStore(null, 'chicago', [building('b1', '1001 W NORTH AVE'), building('b2', '233 S WACKER DR')]);
    const api = apiStub({ ok: true, jobId: '', pending: false, submitted: 0, results: [
      { street: '1001 W NORTH AVE', answer: FOUND },
      { street: '233 S WACKER DR', answer: { status: 'not_found', lookedUpAt: '2026-10-02T07:55:00Z' } },
    ] });
    const runner = new OwnerBatchRunner(store, api, 'chicago', manualTimer());
    const rerender = renderPanel(store, runner);
    const btn = screen.getByText('Look up owners (2) · up to 4 credits ≈ $0.08');
    fireEvent.click(btn);
    await new Promise((r) => setTimeout(r, 0));
    rerender();
    expect(screen.getByText(/Last batch: found 1 of 2/)).toBeTruthy();
    expect(screen.getByText('All owners looked up')).toBeTruthy();
    expect(screen.getByText(/Owner found by address/)).toBeTruthy();
    expect(screen.getByText('DNC not checked')).toBeTruthy();
    expect(screen.getByText(/Owner lookup: no match/)).toBeTruthy();

    const recheck = vi.spyOn(runner, 'recheck').mockResolvedValue();
    fireEvent.click(screen.getAllByText('Re-check ($)')[0]);
    expect(recheck).toHaveBeenCalledWith('b1');
  });

  it('running and error states', async () => {
    const store = new ContactListStore(null, 'chicago', [building('b1', '1001 W NORTH AVE')]);
    const api = apiStub({ ok: true, jobId: JOB, pending: true, submitted: 1, results: [] }, [{ ok: false, reason: 'Tracerfy is not responding' }]);
    const timer = manualTimer();
    const runner = new OwnerBatchRunner(store, api, 'chicago', timer);
    const rerender = renderPanel(store, runner);
    await runner.start();
    rerender();
    expect(screen.getByText('Looking up owners…')).toBeTruthy();
    expect(screen.getByText(/running at Tracerfy/)).toBeTruthy();
    expect(screen.getByText('Owner lookup: searching…')).toBeTruthy();
    await timer.run();
    rerender();
    expect(screen.getByText(/Tracerfy is not responding/)).toBeTruthy();
    const again = vi.spyOn(runner, 'checkAgain');
    fireEvent.click(screen.getByText('Check again'));
    expect(again).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Name / address split (2026-10-02)
// ---------------------------------------------------------------------------


describe('name split in the batch', () => {
  const individual = (id: string, name: string, patch = {}) =>
    building(id, `${id} ST`, { owners: [newOwner({ name, propertyZip: '60618', ...patch })] });

  it('candidates carry a trusted name; companies and truncated names go by address', () => {
    const store = new ContactListStore(null, 'chicago', [
      individual('1', 'THOMAS J LIZAK'),
      individual('2', 'MIGUEL ANGEL ORTEGA RA'),
      building('3', '3 ST'), // company owner
      building('4', '4 ST', { owners: [newOwner({ name: 'CRM PROPERTIES GROUP', isCompany: true, contactPerson: 'Pat Example' })] }),
    ]);
    expect(store.batchCandidates(false).map((c) => [c.buildingId, c.firstName, c.lastName])).toEqual([
      ['1', 'THOMAS', 'LIZAK'], ['2', '', ''], ['3', '', ''], ['4', 'Pat', 'Example'],
    ]);
    expect(batchCostRange(store.batchCandidates(false))).toEqual({ byName: 2, low: 6, high: 8 });
    expect(batchCostRange([])).toEqual({ byName: 0, low: 0, high: 0 });
  });

  it('a name-found answer is labelled "(by name)"', () => {
    expect(ownerPatchFromAnswer({ ...FOUND, method: 'name' } as OwnerAnswer)).toMatchObject({
      skipTraceMethod: 'name', phoneNote: 'Mobile · via tracerfy (by name)',
    });
  });

  it('UI: cost range, per-owner plan, and "found by name"', async () => {
    const store = new ContactListStore(null, 'chicago', [
      individual('1', 'THOMAS J LIZAK'),
      building('2', '2 ST'),
    ]);
    const api = apiStub({ ok: true, jobId: '', pending: false, submitted: 0, byName: 0, results: [
      { street: '1 ST', answer: { ...FOUND, method: 'name' } as OwnerAnswer },
    ] });
    const runner = new OwnerBatchRunner(store, api, 'chicago', manualTimer());
    const ui = () => (
      <ContactListPanel store={store} buildings={store.getSnapshot()} selectionMode={false} onToggleSelectionMode={() => {}}
        lookupAvailable batchRunner={runner} batch={runner.getSnapshot()} />
    );
    const r = render(ui());
    expect(screen.getByText('Look up owners (2) · ≈ 3–4 credits ($0.06–$0.08)')).toBeTruthy();
    expect(screen.getByText(/1 by owner name \(1 credit if matched/)).toBeTruthy();
    expect(screen.getByText('Will search by name: THOMAS LIZAK (1 credit)')).toBeTruthy();
    expect(screen.getByText('Will search by address (2 credits)')).toBeTruthy();
    fireEvent.click(screen.getByText(/Look up owners \(2\)/));
    await new Promise((res) => setTimeout(res, 0));
    r.rerender(ui());
    expect(api.start.mock.calls[0][0][0]).toEqual({ street: '1 ST', zip: '60618', firstName: 'THOMAS', lastName: 'LIZAK', city: 'Chicago', state: 'IL' });
    expect(screen.getByText(/Owner found by name/)).toBeTruthy();
  });

  it('typed contact person is labelled as the source; all-by-address hint', () => {
    const store = new ContactListStore(null, 'chicago', [
      building('4', '4 ST', { owners: [newOwner({ name: 'CRM PROPERTIES GROUP', isCompany: true, contactPerson: 'Pat Example' })] }),
    ]);
    const runner = new OwnerBatchRunner(store, apiStub({ ok: false, reason: 'x' }), 'chicago', manualTimer());
    render(<ContactListPanel store={store} buildings={store.getSnapshot()} selectionMode={false} onToggleSelectionMode={() => {}}
      lookupAvailable batchRunner={runner} batch={runner.getSnapshot()} />);
    expect(screen.getByText('Will search by name: Pat Example (1 credit, from Contact person)')).toBeTruthy();
    cleanup();
    const store2 = new ContactListStore(null, 'chicago', [building('5', '5 ST')]);
    const runner2 = new OwnerBatchRunner(store2, apiStub({ ok: false, reason: 'x' }), 'chicago', manualTimer());
    render(<ContactListPanel store={store2} buildings={store2.getSnapshot()} selectionMode={false} onToggleSelectionMode={() => {}}
      lookupAvailable batchRunner={runner2} batch={runner2.getSnapshot()} />);
    expect(screen.getByText(/All by address/)).toBeTruthy();
  });
});

describe('CSV saved when a lookup finishes', () => {
  it('runs the completion hook after done and shows its note', async () => {
    const store = new ContactListStore(null, 'chicago', [building('b1', '1001 W NORTH AVE')]);
    const api = apiStub({ ok: true, jobId: JOB, pending: true, submitted: 1, byName: 0, results: [] }, [
      { ok: true, jobId: JOB, pending: false, submitted: 1, byName: 0, results: [{ street: '1001 W NORTH AVE', answer: FOUND }] },
    ]);
    const timer = manualTimer();
    const runner = new OwnerBatchRunner(store, api, 'chicago', timer);
    const hook = vi.fn(async () => {
      // The hook sees the FINISHED list (owner already filled in).
      expect(store.getSnapshot()[0].owners[0].skipTrace).toBe('found');
      return 'Saved to Desktop: contacts-x.csv';
    });
    runner.setOnComplete(hook);
    await runner.start();
    expect(hook).not.toHaveBeenCalled(); // not while still running
    await timer.run();
    await new Promise((r) => setTimeout(r, 0));
    expect(hook).toHaveBeenCalledTimes(1);
    expect(runner.getSnapshot()).toMatchObject({ phase: 'done', exportNote: 'Saved to Desktop: contacts-x.csv' });
  });

  it('a failing hook leaves a helpful note; no hook = no note', async () => {
    const store = new ContactListStore(null, 'chicago', [building('b1', '1001 W NORTH AVE')]);
    const saved: BatchReply = { ok: true, jobId: '', pending: false, submitted: 0, byName: 0, results: [{ street: '1001 W NORTH AVE', answer: FOUND }] };
    const runner = new OwnerBatchRunner(store, apiStub(saved), 'chicago', manualTimer());
    runner.setOnComplete(async () => { throw new Error('disk full'); });
    await runner.recheck('b1');
    expect(runner.getSnapshot().exportNote).toMatch(/could not be saved/);

    const store2 = new ContactListStore(null, 'chicago', [building('b2', '2 ST')]);
    const quiet = new OwnerBatchRunner(store2, apiStub({ ...saved, results: [] }), 'chicago', manualTimer());
    quiet.setOnComplete(null);
    await quiet.start();
    expect(quiet.getSnapshot()).toMatchObject({ phase: 'done', exportNote: '' });
  });

  it('panel shows "Saving CSV…" then the note', () => {
    const store = new ContactListStore(null, 'chicago', [building('b1', '1001 W NORTH AVE')]);
    const runner = new OwnerBatchRunner(store, apiStub({ ok: false, reason: 'x' }), 'chicago', manualTimer());
    const panel = (batch: ReturnType<OwnerBatchRunner['getSnapshot']>) => (
      <ContactListPanel store={store} buildings={store.getSnapshot()} selectionMode={false} onToggleSelectionMode={() => {}}
        lookupAvailable batchRunner={runner} batch={batch} />
    );
    const r = render(panel({ ...IDLE_BATCH, phase: 'done', found: 1, total: 1 }));
    expect(screen.getByText(/Saving CSV…/)).toBeTruthy();
    r.rerender(panel({ ...IDLE_BATCH, phase: 'done', found: 1, total: 1, exportNote: 'Saved to Desktop: contacts-x.csv' }));
    expect(screen.getByText(/Saved to Desktop: contacts-x.csv/)).toBeTruthy();
  });
});
