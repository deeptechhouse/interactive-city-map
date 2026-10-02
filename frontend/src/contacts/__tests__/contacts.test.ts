import { describe, expect, it, vi } from 'vitest';
import {
  ChicagoLicenseSource,
  CookCountyOwnerSource,
  normaliseAddress,
  soqlString,
  type BusinessSource,
  type OwnerSource,
} from '../publicRecords';
import { ContactResolver } from '../ContactResolver';
import { ContactListStore, mergeSkipTrace, parseSavedList } from '../ContactListStore';
import { safeHref } from '../links';
import type { OwnerLookup } from '../ownerLookup';
import { CSV_HEADER, csvCell, csvFilename, toCsv, toCsvRows } from '../csvExport';
import type { PhoneLookup } from '../phoneLookup';
import { UnavailablePhoneLookup } from '../phoneLookup';
import { formatAddress, letterAddress, looksLikeCompany, newOwner, sameAddress, type BuildingPick, type BusinessContact, type OwnerContact, type SelectedBuilding } from '../types';

const PICK: BuildingPick = { id: 'b1', address: '1001 W NORTH AVE', lngLat: [-87.65, 41.91] };

const owner = (o: Partial<OwnerContact> = {}): OwnerContact =>
  newOwner({
    name: 'CRM PROPERTIES GROUP',
    pin: '17052070020000',
    propertyZip: '60642',
    ownerAddress: { street: '740 WAUKEGAN RD', city: 'DEERFIELD', state: 'IL', zip: '60015' },
    taxBillAddress: { street: '1 MAIN ST', city: 'CHICAGO', state: 'IL', zip: '60601' },
    isCompany: true,
    ...o,
  });
const biz = (b: Partial<BusinessContact> = {}): BusinessContact => ({
  id: '1-1', name: "COREY'S NYC BAGEL DELI", legalName: 'COREY D. KAPLAN', activity: 'Food',
  address: '1001 W NORTH AVE', zip: '60642', phone: '', phoneStatus: 'pending', phoneSource: '', website: '', ...b,
});

/** Let queued promise callbacks run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// Address + SoQL safety
// ---------------------------------------------------------------------------

describe('address normalising and SoQL quoting', () => {
  it('normalises case, spacing and strips unsafe characters', () => {
    expect(normaliseAddress('  1001  w North Ave ')).toBe('1001 W NORTH AVE');
    expect(normaliseAddress("1 N STATE ST' OR 1=1 --")).toBe('1 N STATE ST OR 1 1 --');
  });

  it('doubles quotes inside SoQL literals', () => {
    expect(soqlString("O'HARE")).toBe("'O''HARE'");
  });
});

// ---------------------------------------------------------------------------
// Cook County owners
// ---------------------------------------------------------------------------

describe('CookCountyOwnerSource', () => {
  it('queries by normalised address and keeps only the newest year, deduped', async () => {
    const fetchJson = vi.fn().mockResolvedValue([
      { pin: '1', year: '2026.0', prop_address_zipcode_1: '60642', owner_address_name: 'A LLC', owner_address_full: '5 OWNER RD', owner_address_city_name: 'EVANSTON', owner_address_state: 'IL', owner_address_zipcode_1: '60201', mail_address_full: '1 X ST', mail_address_city_name: 'CHICAGO', mail_address_state: 'IL', mail_address_zipcode_1: '60601' },
      { pin: '2', year: '2026', owner_address_name: 'A LLC', owner_address_full: '5 OWNER RD', owner_address_city_name: 'EVANSTON', owner_address_state: 'IL', owner_address_zipcode_1: '60201', mail_address_full: '1 X ST', mail_address_city_name: 'CHICAGO', mail_address_state: 'IL', mail_address_zipcode_1: '60601' },
      { pin: '3', year: '2026', owner_address_name: '', mail_address_name: 'JOHN DOE', mail_address_full: '9 Y AVE' },
      { pin: '1', year: '2025', owner_address_name: 'OLD OWNER' },
    ]);
    const owners = await new CookCountyOwnerSource(fetchJson).findOwners('1001 w north ave');

    const url = new URL(fetchJson.mock.calls[0][0]);
    expect(url.host).toBe('datacatalog.cookcountyil.gov');
    expect(url.searchParams.get('$where')).toContain("prop_address_full='1001 W NORTH AVE'");
    expect(owners).toHaveLength(2);
    expect(owners[0]).toMatchObject({
      name: 'A LLC', pin: '1', propertyZip: '60642', isCompany: true, letterTo: 'owner',
      ownerAddress: { street: '5 OWNER RD', city: 'EVANSTON', state: 'IL', zip: '60201' },
      taxBillAddress: { street: '1 X ST', city: 'CHICAGO', state: 'IL', zip: '60601' },
    });
    // No owner address on file → letters default to the tax-bill address.
    expect(owners[1]).toMatchObject({ name: 'JOHN DOE', isCompany: false, letterTo: 'taxBill', taxBillAddress: { street: '9 Y AVE' } });
  });

  it('returns nothing for empty address or empty/odd responses', async () => {
    const fetchJson = vi.fn().mockResolvedValue({ error: true });
    const src = new CookCountyOwnerSource(fetchJson);
    expect(await src.findOwners('')).toEqual([]);
    expect(fetchJson).not.toHaveBeenCalled();
    expect(await src.findOwners('1 N STATE ST')).toEqual([]);
  });

  it('caps very large condo buildings', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ pin: String(i), year: '2026', owner_address_name: `OWNER ${i}` }));
    const owners = await new CookCountyOwnerSource(vi.fn().mockResolvedValue(rows)).findOwners('1 N STATE ST');
    expect(owners).toHaveLength(CookCountyOwnerSource.MAX_OWNERS);
  });
});

// ---------------------------------------------------------------------------
// Chicago business licences
// ---------------------------------------------------------------------------

describe('ChicagoLicenseSource', () => {
  it('matches the address or address + unit and merges duplicate licences', async () => {
    const fetchJson = vi.fn().mockResolvedValue([
      { account_number: '1', site_number: '1', legal_name: 'PEGABLO LLC', doing_business_as_name: 'DEEP PURPL', business_activity: 'Coffee', address: '1001 W NORTH AVE  UNIT E' },
      { account_number: '1', site_number: '1', legal_name: 'PEGABLO LLC', doing_business_as_name: 'DEEP PURPL', business_activity: 'Food' },
      { account_number: '1', site_number: '1', legal_name: 'PEGABLO LLC', doing_business_as_name: 'DEEP PURPL', business_activity: 'Food' },
      { account_number: '', legal_name: 'NO DBA INC', doing_business_as_name: '' },
      { legal_name: '', doing_business_as_name: '' },
    ]);
    const list = await new ChicagoLicenseSource(fetchJson).findBusinesses('1001 W NORTH AVE', [-87.65, 41.91]);

    const where = new URL(fetchJson.mock.calls[0][0]).searchParams.get('$where');
    expect(where).toBe("address='1001 W NORTH AVE' OR starts_with(address, '1001 W NORTH AVE ')");
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: '1-1', name: 'DEEP PURPL', legalName: 'PEGABLO LLC', activity: 'Coffee | Food', address: '1001 W NORTH AVE UNIT E', website: '' });
    expect(list[1]).toMatchObject({ id: 'NO DBA INC', name: 'NO DBA INC', legalName: 'NO DBA INC' });
  });

  it('falls back to a radius search when the building has no address', async () => {
    const fetchJson = vi.fn().mockResolvedValue([]);
    await new ChicagoLicenseSource(fetchJson).findBusinesses('', [-87.65, 41.91]);
    expect(new URL(fetchJson.mock.calls[0][0]).searchParams.get('$where')).toBe(
      `within_circle(location, 41.91, -87.65, ${ChicagoLicenseSource.FALLBACK_RADIUS_M})`,
    );
  });
});

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

const ownerSrc = (impl: OwnerSource['findOwners']): OwnerSource => ({ findOwners: impl });
const bizSrc = (impl: BusinessSource['findBusinesses']): BusinessSource => ({ findBusinesses: impl });

describe('ContactResolver', () => {
  it('reports names first, then phones', async () => {
    const phones: PhoneLookup = {
      lookup: vi.fn(async (q) => {
        if (q.name === "COREY'S NYC BAGEL DELI") return { status: 'found' as const, phone: '(312) 555-0100', source: 'google', website: 'coreys.com' };
        if (q.name === 'CRM PROPERTIES GROUP') return { status: 'found' as const, phone: '(847) 555-0000', source: 'google', website: 'crm.com' };
        return { status: 'not_found' as const };
      }),
    };
    const resolver = new ContactResolver(
      ownerSrc(async () => [owner()]),
      bizSrc(async () => [biz(), biz({ id: '2-1', name: 'WILD FORKS' })]),
      phones,
    );
    const progress = vi.fn();
    await resolver.resolve(PICK, progress);

    expect(progress).toHaveBeenCalledTimes(2);
    expect(progress.mock.calls[0][0].status).toBe('loading');
    const final = progress.mock.calls[1][0];
    expect(final.status).toBe('ready');
    expect(final.businesses.map((b: BusinessContact) => [b.phone, b.phoneStatus, b.phoneSource, b.website])).toEqual([
      ['(312) 555-0100', 'found', 'google', 'coreys.com'],
      ['', 'not_found', '', ''],
    ]);
    // Owner company searched at its letter address (owner's own), no map bias point.
    expect(phones.lookup).toHaveBeenCalledWith({ name: 'CRM PROPERTIES GROUP', address: '740 WAUKEGAN RD', locality: 'DEERFIELD', region: 'IL' });
    expect(progress.mock.calls[0][0].owners[0].companyLookup).toBe('pending');
    expect(final.owners[0]).toMatchObject({ companyLookup: 'found', phone: '(847) 555-0000', phoneNote: 'company line · via google', website: 'crm.com' });
  });

  it('keeps going when one source fails, and explains unavailable phones', async () => {
    const resolver = new ContactResolver(
      ownerSrc(async () => { throw new Error('down'); }),
      bizSrc(async () => [biz()]),
      new UnavailablePhoneLookup('No backend'),
    );
    const progress = vi.fn();
    await resolver.resolve(PICK, progress);
    const final = progress.mock.calls.at(-1)![0];
    expect(final.status).toBe('ready');
    expect(final.note).toContain('Owner records unavailable');
    expect(final.note).toContain('No backend');
    expect(final.businesses[0].phoneStatus).toBe('unavailable');
  });

  it('errors when both sources fail; skips owner lookup without an address', async () => {
    const owners = vi.fn();
    const failing = new ContactResolver(
      ownerSrc(async () => { throw new Error('x'); }),
      bizSrc(async () => { throw new Error('y'); }),
      new UnavailablePhoneLookup(''),
    );
    const progress = vi.fn();
    await failing.resolve(PICK, progress);
    expect(progress.mock.calls.at(-1)![0].status).toBe('error');

    const noAddr = new ContactResolver(ownerSrc(owners), bizSrc(async () => []), new UnavailablePhoneLookup(''));
    const p2 = vi.fn();
    await noAddr.resolve({ ...PICK, address: '' }, p2);
    expect(owners).not.toHaveBeenCalled();
    expect(p2.mock.calls.at(-1)![0].note).toContain('no street address');
  });

  it('a resolver exists for every city with contact sources, never for an unknown city', () => {
    expect(ContactResolver.forCity('chicago')).toBeInstanceOf(ContactResolver);
    expect(ContactResolver.forCity('detroit')).toBeInstanceOf(ContactResolver);
    expect(ContactResolver.forCity('dayton')).toBeInstanceOf(ContactResolver);
    expect(ContactResolver.forCity('gotham')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

function storeWith(resolve: ContactResolver['resolve'] | null) {
  const resolver = resolve ? ({ resolve } as unknown as ContactResolver) : null;
  return new ContactListStore(resolver, 'chicago', []);
}

describe('ContactListStore', () => {
  it('toggle adds then removes; snapshot identity changes only on change', async () => {
    const store = storeWith(async (_p, cb) => cb({ owners: [owner()], businesses: [biz()], status: 'ready', note: '' }));
    const listener = vi.fn();
    store.subscribe(listener);
    const before = store.getSnapshot();
    store.toggle(PICK);
    await flush();
    expect(store.getSnapshot()).not.toBe(before);
    expect(store.getSnapshot()[0]).toMatchObject({ id: 'b1', status: 'ready', owners: [owner()] });
    expect(store.getSnapshot()).toBe(store.getSnapshot());
    store.toggle(PICK);
    expect(store.getSnapshot()).toHaveLength(0);
    expect(listener).toHaveBeenCalled();
  });

  it('manual phone edits survive a retry', async () => {
    const resolve = vi.fn(async (_p: BuildingPick, cb: (f: never) => void) =>
      cb({ owners: [owner()], businesses: [biz()], status: 'ready', note: '' } as never));
    const store = storeWith(resolve as never);
    store.add(PICK);
    await flush();
    store.updateBusiness('b1', '1-1', { phone: '312-000-0000' });
    store.updateOwner('b1', 0, { phone: '773-111-1111' });
    store.retry('b1');
    await flush();
    const b = store.getSnapshot()[0];
    expect(b.businesses[0]).toMatchObject({ phone: '312-000-0000', phoneStatus: 'manual' });
    expect(b.owners[0].phone).toBe('773-111-1111');
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('hand-added owners are kept and late results for removed buildings are dropped', async () => {
    let finish: (() => void) | undefined;
    const store = storeWith((_p, cb) => new Promise<void>((res) => {
      finish = () => { cb({ owners: [], businesses: [biz()], status: 'ready', note: '' }); res(); };
    }));
    store.add(PICK);
    store.addOwner('b1');
    store.updateOwner('b1', 0, { name: 'JANE DOE' });
    finish!();
    await flush();
    expect(store.getSnapshot()[0].owners.map((o) => o.name)).toEqual(['JANE DOE']);

    store.add({ ...PICK, id: 'b2' });
    store.remove('b2');
    finish!();
    expect(store.has('b2')).toBe(false);
  });

  it('records lookup crashes as errors, and works without a resolver', async () => {
    const crashing = storeWith(async () => { throw new Error('boom'); });
    crashing.add(PICK);
    await flush();
    expect(crashing.getSnapshot()[0]).toMatchObject({ status: 'error' });

    const manual = storeWith(null);
    manual.add(PICK);
    manual.retry('b1'); // no-op without resolver
    expect(manual.getSnapshot()[0]).toMatchObject({ status: 'ready' });
    expect(manual.getSnapshot()[0].note).toContain('only available for Chicago');
    manual.clear();
    expect(manual.getSnapshot()).toHaveLength(0);
  });

  it('parseSavedList drops malformed entries and marks interrupted lookups', () => {
    const good: SelectedBuilding = {
      id: 'b1', address: 'x', lngLat: [0, 0], owners: [], businesses: [], status: 'loading', note: '', addedAt: 1,
    };
    const parsed = parseSavedList([good, { id: 5 }, null, { id: 'b2', owners: 'no' }]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].status).toBe('error');
    expect(parseSavedList('garbage')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

describe('CSV export', () => {
  const building: SelectedBuilding = {
    id: 'abcdef123456', address: '1001 W NORTH AVE', lngLat: [0, 0], status: 'ready', note: '', addedAt: 0,
    owners: [owner({ phone: '773-111-1111' })],
    businesses: [biz({ phone: '(312) 555-0100', phoneStatus: 'found' })],
  };

  it('one row per owner then per business, split mail-merge address', () => {
    expect(CSV_HEADER).toEqual([
      'Name / Address', 'Building Owner', 'Contact Name', 'Phone', 'Email', 'Website',
      'Mail Street', 'Mail City', 'Mail State', 'Mail ZIP', 'Owner Lookup Date',
    ]);
    expect(toCsvRows([building])).toEqual([
      ['1001 W NORTH AVE', 'Y', 'CRM PROPERTIES GROUP', '773-111-1111', '', '', '740 WAUKEGAN RD', 'DEERFIELD', 'IL', '60015', ''],
      ["COREY'S NYC BAGEL DELI", 'N', 'COREY D. KAPLAN', '(312) 555-0100', '', '', '1001 W NORTH AVE', 'CHICAGO', 'IL', '60642', ''],
    ]);
  });

  it('uses the tax-bill address when chosen, names the person, and flags DNC phones', () => {
    const b = { ...building, businesses: [], owners: [owner({
      letterTo: 'taxBill', contactPerson: 'JANE DOE', phone: '(312) 555-9999', phoneDnc: true, email: 'j@x.com', website: 'crm.com',
    })] };
    expect(toCsvRows([b])[0]).toEqual([
      '1001 W NORTH AVE', 'Y', 'JANE DOE, CRM PROPERTIES GROUP', '(312) 555-9999 [DNC]', 'j@x.com', 'crm.com',
      '1 MAIN ST', 'CHICAGO', 'IL', '60601', '',
    ]);
  });

  it('marks batch skip-trace phones "DNC not checked" and writes the lookup date', () => {
    const batchOwner = owner({
      skipTrace: 'found', skipTracedAt: '2026-10-02T07:55:00Z', dncChecked: false,
      phone: '(312) 555-0100', phoneNote: 'Mobile · via tracerfy',
    });
    const companyLine = owner({ skipTrace: 'found', dncChecked: false, phone: '(847) 555-0000', phoneNote: 'company line · via google' });
    const rows = toCsvRows([{ ...building, businesses: [], owners: [batchOwner, companyLine] }]);
    expect(rows[0][3]).toBe('(312) 555-0100 [DNC not checked]');
    expect(rows[0][10]).toBe('2026-10-02');
    expect(rows[1][3]).toBe('(847) 555-0000'); // not a skip-trace number
  });

  it('keeps empty buildings as a placeholder row', () => {
    expect(toCsvRows([{ ...building, address: '', owners: [], businesses: [] }])).toEqual([
      ['Building abcdef12', 'Y', '', '', '', '', '', '', '', '', ''],
    ]);
  });

  it('quotes per RFC 4180 and neutralises formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('A, B')).toBe('"A, B"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1 312')).toBe("'+1 312");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('produces CRLF text with the header first and a dated filename', () => {
    const text = toCsv([building]);
    expect(text.split('\r\n')[0]).toBe('Name / Address,Building Owner,Contact Name,Phone,Email,Website,Mail Street,Mail City,Mail State,Mail ZIP,Owner Lookup Date');
    expect(text.split('\r\n')).toHaveLength(3);
    expect(csvFilename(new Date('2026-10-01T12:00:00Z'))).toBe('contacts-2026-10-01.csv');
  });
});

// ---------------------------------------------------------------------------
// Owner outreach: company detection, skip-trace merge, saved-list upgrade
// ---------------------------------------------------------------------------


describe('owner helpers', () => {
  it('detects company owners', () => {
    expect(looksLikeCompany('BIG DEAHL LTD LIAB CO')).toBe(true);
    expect(looksLikeCompany('CRM PROPERTIES GROUP')).toBe(true);
    expect(looksLikeCompany('CHICAGO TITLE LAND TRUST')).toBe(true);
    expect(looksLikeCompany('JOHN DOE')).toBe(false);
  });

  it('formats and compares addresses; letterAddress follows the choice', () => {
    const o = owner();
    expect(formatAddress(o.ownerAddress)).toBe('740 WAUKEGAN RD, DEERFIELD, IL 60015');
    expect(sameAddress(o.ownerAddress, { street: '740  waukegan rd', city: 'Deerfield', state: 'il', zip: '60015' })).toBe(true);
    expect(letterAddress(o).city).toBe('DEERFIELD');
    expect(letterAddress({ ...o, letterTo: 'taxBill' }).city).toBe('CHICAGO');
  });

  it('only allows http(s) links', () => {
    expect(safeHref('crm.com')).toBe('https://crm.com/');
    expect(safeHref('http://x.com/a')).toBe('http://x.com/a');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('')).toBeNull();
    expect(safeHref('http://')).toBeNull();
  });
});

describe('mergeSkipTrace', () => {
  const found = {
    skipTrace: 'found' as const, contactPerson: 'JANE DOE', phone: '(312) 555-0100', phoneDnc: true,
    phoneNote: 'Mobile · via tracerfy', extraPhones: [{ number: '(312) 555-0200', type: 'Landline', dnc: false }],
    email: 'j@x.com', extraEmails: ['j2@x.com'],
  };

  it('fills empty fields', () => {
    expect(mergeSkipTrace(owner(), found)).toMatchObject({
      skipTrace: 'found', contactPerson: 'JANE DOE', phone: '(312) 555-0100', phoneDnc: true, email: 'j@x.com',
      extraPhones: [{ number: '(312) 555-0200' }], extraEmails: ['j2@x.com'],
    });
  });

  it('keeps existing phone/email/person and files the new ones as extras', () => {
    const merged = mergeSkipTrace(owner({ phone: '(847) 555-0000', phoneNote: 'company line', email: 'office@crm.com', contactPerson: 'BOB' }), found);
    expect(merged).toMatchObject({ phone: '(847) 555-0000', phoneNote: 'company line', phoneDnc: false, email: 'office@crm.com', contactPerson: 'BOB' });
    expect(merged.extraPhones.map((p) => [p.number, p.dnc])).toEqual([['(312) 555-0100', true], ['(312) 555-0200', false]]);
    expect(merged.extraEmails).toEqual(['j@x.com', 'j2@x.com']);
  });

  it('records misses without touching data', () => {
    const o = owner({ phone: '1' });
    expect(mergeSkipTrace(o, { skipTrace: 'not_found' })).toEqual({ ...o, skipTrace: 'not_found' });
    expect(mergeSkipTrace(o, {}).skipTrace).toBe('not_found');
  });
});

describe('store skip trace', () => {
  function storeWithOwnerLookup(answer: Awaited<ReturnType<OwnerLookup['lookup']>> | Error) {
    const ownerLookup: OwnerLookup = { lookup: vi.fn(async () => { if (answer instanceof Error) throw answer; return answer; }) };
    const resolver = new ContactResolver(
      { findOwners: async () => [owner()] },
      { findBusinesses: async () => [] },
      new UnavailablePhoneLookup('none'),
      ownerLookup,
    );
    return { store: new ContactListStore(resolver, 'chicago', []), ownerLookup };
  }

  it('looks up the PROPERTY address and fills the owner', async () => {
    const { store, ownerLookup } = storeWithOwnerLookup({
      status: 'found', personName: 'JANE DOE', source: 'tracerfy', lookedUpAt: '2026-10-02T07:00:00Z', dncChecked: true, method: '',
      phones: [{ number: '(312) 555-0100', type: 'Mobile', dnc: false }], emails: ['j@x.com'],
    });
    store.add(PICK);
    await flush();
    await store.skipTraceOwner('b1', 0, true);
    expect(ownerLookup.lookup).toHaveBeenCalledWith({ street: '1001 W NORTH AVE', zip: '60642', ownerName: 'CRM PROPERTIES GROUP' }, true);
    expect(store.getSnapshot()[0].owners[0]).toMatchObject({
      skipTrace: 'found', contactPerson: 'JANE DOE', phone: '(312) 555-0100', phoneNote: 'Mobile · via tracerfy', email: 'j@x.com',
      skipTracedAt: '2026-10-02T07:00:00Z', dncChecked: true,
    });
  });

  it('reports unavailable/errors and ignores bad indexes', async () => {
    const { store } = storeWithOwnerLookup({ status: 'unavailable', reason: 'No server' });
    store.add(PICK);
    await flush();
    await store.skipTraceOwner('b1', 0);
    expect(store.getSnapshot()[0].owners[0].skipTrace).toBe('unavailable');
    expect(store.getSnapshot()[0].note).toContain('No server');
    await store.skipTraceOwner('b1', 9);
    await store.skipTraceOwner('nope', 0);

    const crashing = storeWithOwnerLookup(new Error('boom')).store;
    crashing.add(PICK);
    await flush();
    await crashing.skipTraceOwner('b1', 0);
    expect(crashing.getSnapshot()[0].owners[0].skipTrace).toBe('unavailable');
  });

  it('not found', async () => {
    const { store } = storeWithOwnerLookup({ status: 'not_found', lookedUpAt: '2026-10-02T07:00:00Z' });
    store.add(PICK);
    await flush();
    await store.skipTraceOwner('b1', 0);
    expect(store.getSnapshot()[0].owners[0]).toMatchObject({ skipTrace: 'not_found', skipTracedAt: '2026-10-02T07:00:00Z' });
  });

  it('owner edits: typed phone clears DNC; letter address edits follow the choice', () => {
    const store = new ContactListStore(null, 'chicago', [{
      id: 'b1', address: 'x', lngLat: [0, 0], status: 'ready', note: '', addedAt: 0, businesses: [],
      owners: [owner({ phone: '1', phoneDnc: true, phoneNote: 'Mobile' })],
    }]);
    store.updateOwner('b1', 0, { phone: '2' });
    expect(store.getSnapshot()[0].owners[0]).toMatchObject({ phone: '2', phoneDnc: false, phoneNote: 'entered by hand' });
    store.updateLetterAddress('b1', 0, { zip: '60016' });
    expect(store.getSnapshot()[0].owners[0].ownerAddress.zip).toBe('60016');
    store.updateOwner('b1', 0, { letterTo: 'taxBill' });
    store.updateLetterAddress('b1', 0, { street: '2 B ST' });
    expect(store.getSnapshot()[0].owners[0].taxBillAddress.street).toBe('2 B ST');
  });
});

describe('saved-list upgrade', () => {
  it('turns an old single mailingAddress into the tax-bill street and fills defaults', () => {
    const [b] = parseSavedList([{
      id: 'b1', address: 'x', lngLat: [0, 0], status: 'ready', note: '', addedAt: 0,
      owners: [{ name: 'A LLC', mailingAddress: '1 X ST, CHICAGO, IL 60601', pin: '1', phone: '5', skipTrace: 'pending', extraEmails: ['a', 3] }],
      businesses: [{ id: '1', name: 'B', legalName: 'B', activity: '', address: 'y', phone: '', phoneStatus: 'found', phoneSource: '' }],
    }]);
    expect(b.owners[0]).toMatchObject({
      name: 'A LLC', phone: '5', isCompany: true, letterTo: 'taxBill', skipTrace: 'idle', companyLookup: 'idle',
      taxBillAddress: { street: '1 X ST, CHICAGO, IL 60601', city: '' }, ownerAddress: { street: '' }, extraEmails: ['a'],
    });
    expect(b.businesses[0]).toMatchObject({ zip: '', website: '' });
  });

  it('keeps a saved owner-address choice and finished lookups', () => {
    const [b] = parseSavedList([{
      id: 'b1', address: 'x', lngLat: [0, 0], status: 'ready', note: '', addedAt: 0, businesses: [],
      owners: [{ ...owner(), skipTrace: 'found', companyLookup: 'not_found', isCompany: false }, null],
    }]);
    expect(b.owners[0]).toMatchObject({ letterTo: 'owner', skipTrace: 'found', companyLookup: 'not_found', isCompany: false });
    expect(b.owners[1].name).toBe('');
  });
});
