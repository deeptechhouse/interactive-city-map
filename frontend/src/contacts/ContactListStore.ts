/**
 * The contact list's single source of truth.
 *
 * PURPOSE
 *   Holds the selected buildings, runs lookups through ContactResolver, applies the
 *   user's edits, and persists everything to localStorage so the list survives reloads.
 *   React reads it through useSyncExternalStore (useContactList.ts) — this class has no
 *   React in it, so it's unit-testable on its own.
 *
 * INVARIANTS
 *   * ``snapshot`` is a new frozen array after every change and the same array otherwise
 *     (useSyncExternalStore re-renders on identity change, and loops if it changes on
 *     every read).
 *   * A user edit is never overwritten by a lookup: edits set phoneStatus 'manual', and
 *     late lookup results for a building that was removed are dropped.
 */
import { loadJson, saveJson } from '../utils/safeStorage';
import { ownerPatchFromAnswer, type ContactResolver, type ResolvedFields } from './ContactResolver';
import type { OwnerAnswer } from './ownerLookup';
import { traceNameFor } from './ownerNames';
import {
  EMPTY_ADDRESS,
  looksLikeCompany,
  newOwner,
  type BuildingPick,
  type BusinessContact,
  type OwnerContact,
  type PostalAddress,
  type SelectedBuilding,
} from './types';

/** One saved list per city: ``citymap.contactList.v1.chicago``.
 *  O(c) time, O(c) space — c = city slug length. */
const storageKey = (city: string) => `citymap.contactList.v1.${city}`;

type Listener = () => void;

// O(1) time, O(1) space
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Bring a saved owner up to the current shape. Lists saved before 2026-10-02 had a single
 * ``mailingAddress`` string; it becomes the tax-bill street so nothing typed is lost.
 * O(e) time, O(e) space — e = saved extra emails (extraPhones is reused, not copied).
 */
function upgradeOwner(raw: unknown): OwnerContact {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  // O(1) time, O(1) space
  const addr = (v: unknown, fallbackStreet = ''): PostalAddress => {
    const a = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    return v && typeof v === 'object'
      ? { street: str(a.street), city: str(a.city), state: str(a.state), zip: str(a.zip) }
      : { ...EMPTY_ADDRESS, street: fallbackStreet };
  };
  const name = str(o.name);
  const taxBillAddress = addr(o.taxBillAddress, str(o.mailingAddress));
  const ownerAddress = addr(o.ownerAddress);
  return newOwner({
    name,
    pin: str(o.pin),
    propertyZip: str(o.propertyZip),
    ownerAddress,
    taxBillAddress,
    letterTo: o.letterTo === 'taxBill' || !ownerAddress.street ? 'taxBill' : 'owner',
    isCompany: typeof o.isCompany === 'boolean' ? o.isCompany : looksLikeCompany(name),
    contactPerson: str(o.contactPerson),
    phone: str(o.phone),
    phoneNote: str(o.phoneNote),
    phoneDnc: o.phoneDnc === true,
    extraPhones: Array.isArray(o.extraPhones) ? (o.extraPhones as OwnerContact['extraPhones']) : [],
    email: str(o.email),
    // O(e) time, O(e) space — e = saved extra emails
    extraEmails: Array.isArray(o.extraEmails) ? (o.extraEmails as string[]).filter((e) => typeof e === 'string') : [],
    website: str(o.website),
    // An in-flight lookup from a closed page never finishes.
    companyLookup: o.companyLookup === 'found' || o.companyLookup === 'not_found' ? o.companyLookup : 'idle',
    skipTrace: o.skipTrace === 'found' || o.skipTrace === 'not_found' ? o.skipTrace : 'idle',
    skipTracedAt: str(o.skipTracedAt),
    dncChecked: o.dncChecked !== false,
    skipTraceMethod: str(o.skipTraceMethod),
  });
}

/** Older saves lack zip/website on businesses.
 *  O(1) time, O(1) space */
function upgradeBusiness(b: BusinessContact): BusinessContact {
  return { ...b, zip: str(b.zip), website: str(b.website) };
}

/**
 * Accept saved entries only if they have the fields the UI dereferences — saved state is
 * untrusted (older app version, another tab, hand edits).
 * O(n) time, O(n) space — n = saved entries (buildings plus their owners, businesses and extra emails)
 */
export function parseSavedList(raw: unknown): SelectedBuilding[] {
  if (!Array.isArray(raw)) return [];
  return raw
    // O(b) time, O(b) space — b = saved buildings
    .filter(
      (b): b is SelectedBuilding =>
        !!b &&
        typeof b === 'object' &&
        typeof (b as SelectedBuilding).id === 'string' &&
        Array.isArray((b as SelectedBuilding).owners) &&
        Array.isArray((b as SelectedBuilding).businesses) &&
        Array.isArray((b as SelectedBuilding).lngLat),
    )
    // O(n) time, O(n) space — n = saved entries (buildings plus their owners and businesses)
    .map((b) => {
      // bigo-lint: disable=BIGO006 — amortised: every saved owner/business is upgraded once across all buildings
      // O(o + u) time, O(o + u) space — o = owners at this building; u = businesses at this building
      const upgraded = { ...b, owners: b.owners.map(upgradeOwner), businesses: b.businesses.map(upgradeBusiness) };
      // A lookup that was in flight when the page closed will never finish.
      return b.status === 'loading'
        ? { ...upgraded, status: 'error' as const, note: 'Lookup interrupted — press Retry.' }
        : upgraded;
    });
}

/** One building ready for the owner batch. Names empty → address (owner discovery) trace. */
export interface BatchCandidate {
  buildingId: string;
  street: string;
  zip: string;
  firstName: string;
  lastName: string;
}

// ADJUSTABLE: buildings resolved at once. Higher = faster big batches but more bursty
// paid phone lookups (each building looks up every business it holds).
export const MAX_PARALLEL_LOOKUPS = 3;

export class ContactListStore {
  private buildings: SelectedBuilding[];
  private snapshot: readonly SelectedBuilding[];
  private readonly listeners = new Set<Listener>();
  private readonly storageKey: string;
  // Lookups running now, and ones waiting for a slot (see lookup()).
  private activeLookups = 0;
  private readonly waitingLookups: (() => void)[] = [];

  /** City this list belongs to (slug) — names CSV exports so cities never mix.
   *  O(1) time, O(1) space — n = 1 field read. */
  get city(): string {
    return this.cityValue;
  }

  // O(n) time, O(n) space — n = saved entries parsed and copied (buildings plus their owners and businesses)
  constructor(
    private readonly resolver: ContactResolver | null,
    private readonly cityValue: string,
    initial?: SelectedBuilding[],
  ) {
    this.storageKey = storageKey(cityValue);
    initial ??= parseSavedList(loadJson(this.storageKey));
    this.buildings = initial;
    this.snapshot = Object.freeze([...initial]);
  }

  // ---- subscription (useSyncExternalStore contract) ----

  // O(1) time, O(1) space
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  // O(1) time, O(1) space
  getSnapshot = (): readonly SelectedBuilding[] => this.snapshot;

  /** Copies the list for the immutable snapshot and saves it.
   *  O(s + l) time, O(s) space — s = total list size (JSON-serialised by saveJson); l = subscribed listeners */
  private commit(next: SelectedBuilding[]): void {
    this.buildings = next;
    this.snapshot = Object.freeze([...next]);
    saveJson(this.storageKey, next);
    // O(l) time, O(1) space — l = subscribed listeners
    this.listeners.forEach((l) => l());
  }

  // ---- queries ----

  // O(n) time, O(1) space — n = buildings in the list (tens)
  has(id: string): boolean {
    // O(n) time, O(1) space — n = buildings in the list
    return this.buildings.some((b) => b.id === id);
  }

  // ---- commands ----

  /** Click in selection mode: add if absent, remove if present.
   *  O(s) time, O(s) space — s = total list size (buildings with their owners and businesses, which commit() re-serialises) */
  toggle(pick: BuildingPick): void {
    if (this.has(pick.id)) this.remove(pick.id);
    else this.add(pick);
  }

  // O(s) time, O(s) space — s = total list size (buildings with their owners and businesses, which commit() re-serialises)
  add(pick: BuildingPick): void {
    if (this.has(pick.id)) return;
    const entry: SelectedBuilding = {
      id: pick.id,
      address: pick.address,
      lngLat: pick.lngLat,
      owners: [],
      businesses: [],
      status: this.resolver ? 'loading' : 'ready',
      note: this.resolver ? '' : 'Contact lookup is only available for Chicago — enter details by hand.',
      addedAt: Date.now(),
    };
    this.commit([...this.buildings, entry]);
    void this.lookup(pick);
  }

  /** Re-run the lookup, keeping anything the user typed.
   *  O(s) time, O(s) space — s = total list size (buildings with their owners and businesses, which commit() re-serialises) */
  retry(id: string): void {
    // O(n) time, O(1) space — n = buildings in the list
    const b = this.buildings.find((x) => x.id === id);
    if (!b || !this.resolver) return;
    this.patch(id, { status: 'loading', note: '' });
    void this.lookup({ id: b.id, address: b.address, lngLat: b.lngLat });
  }

  // O(s) time, O(s) space — s = total list size (buildings with their owners and businesses, which commit() re-serialises)
  remove(id: string): void {
    // O(n) time, O(n) space — n = buildings in the list
    this.commit(this.buildings.filter((b) => b.id !== id));
  }

  // O(l) time, O(1) space — l = subscribed listeners
  clear(): void {
    this.commit([]);
  }

  // O(s) time, O(s) space — s = total list size (buildings with their owners and businesses, which commit() re-serialises)
  updateOwner(buildingId: string, index: number, patch: Partial<OwnerContact>): void {
    // A typed number replaces the looked-up one, so its DNC flag no longer applies.
    const phonePatch: Partial<OwnerContact> = 'phone' in patch ? { phoneNote: 'entered by hand', phoneDnc: false } : {};
    this.mapOwner(buildingId, index, (o) => ({ ...o, ...patch, ...phonePatch }));
  }

  /** Edit the address letters go to (whichever of owner / tax-bill is selected).
   *  O(s) time, O(s) space — s = total list size (buildings with their owners and businesses, which commit() re-serialises) */
  updateLetterAddress(buildingId: string, index: number, patch: Partial<PostalAddress>): void {
    this.mapOwner(buildingId, index, (o) =>
      o.letterTo === 'owner'
        ? { ...o, ownerAddress: { ...o.ownerAddress, ...patch } }
        : { ...o, taxBillAddress: { ...o.taxBillAddress, ...patch } },
    );
  }

  /** Add a blank owner row for the user to fill in (no county record found).
   *  O(s) time, O(s) space — s = total list size (buildings with their owners and businesses, which commit() re-serialises) */
  addOwner(buildingId: string): void {
    this.mapBuilding(buildingId, (b) => ({ ...b, owners: [...b.owners, newOwner({ letterTo: 'owner' })] }));
  }

  /**
   * INSTANT paid skip trace for one owner — hidden in the GUI (the batch runner is used),
   * kept for later. Fills fields the user left empty; see mergeSkipTrace.
   * O(s) time, O(s) space — s = total list size (buildings with their owners and businesses, which commit() re-serialises, network time excluded)
   */
  async skipTraceOwner(buildingId: string, index: number, refresh = false): Promise<void> {
    // O(n) time, O(1) space — n = buildings in the list
    const building = this.buildings.find((b) => b.id === buildingId);
    const owner = building?.owners[index];
    if (!building || !owner || !this.resolver || owner.skipTrace === 'pending') return;
    this.mapOwner(buildingId, index, (o) => ({ ...o, skipTrace: 'pending' }));
    let result: Awaited<ReturnType<ContactResolver['skipTraceOwner']>>;
    try {
      result = await this.resolver.skipTraceOwner(building, owner, refresh);
    } catch {
      result = { skipTrace: 'unavailable', reason: 'Owner lookup failed — try again.' };
    }
    this.applyOwnerPatch(buildingId, index, result);
  }

  // ---- batch support (used by OwnerBatchRunner) ----

  /**
   * Buildings whose first owner should go into a batch: has an address and an owner,
   * and — unless ``refresh`` — hasn't been looked up yet. ``onlyIds`` narrows it (the
   * per-owner "Re-check" link).
   * O(n) time, O(n) space — n = buildings in the list
   */
  batchCandidates(refresh: boolean, onlyIds?: ReadonlySet<string>): BatchCandidate[] {
    return this.buildings
      // O(n) time, O(n) space — n = buildings in the list
      .filter((b) => b.address && b.owners.length > 0 && (!onlyIds || onlyIds.has(b.id)))
      // O(n) time, O(n) space — n = buildings left after the first filter
      .filter((b) => refresh || b.owners[0].skipTrace === 'idle' || b.owners[0].skipTrace === 'unavailable')
      // O(n) time, O(n) space — n = candidate buildings
      .map((b) => {
        // A trusted person name → cheaper 1-credit name trace (see ownerNames.ts).
        const name = traceNameFor(b.owners[0]);
        return {
          buildingId: b.id,
          street: b.address,
          zip: b.owners[0].propertyZip,
          firstName: name?.first ?? '',
          lastName: name?.last ?? '',
        };
      });
  }

  /** Show "searching…" on the first owner of each listed building.
   *  O(s + k) time, O(s + k) space — s = total list size; k = building ids passed in */
  markOwnersPending(buildingIds: readonly string[]): void {
    const ids = new Set(buildingIds);
    this.commit(
      // O(s) time, O(s) space — s = total list size (buildings plus the owners copied below)
      this.buildings.map((b) =>
        ids.has(b.id) && b.owners.length
          ? {
              ...b,
              // bigo-lint: disable=BIGO006 — amortised: each owner is visited at most once across all buildings
              // O(o) time, O(o) space — o = owners at this building
              owners: b.owners.map((o, i) => (i === 0 ? { ...o, skipTrace: 'pending' as const } : o)),
            }
          : b,
      ),
    );
  }

  /**
   * Apply a batch answer to every building at that street (normally one). The skip
   * trace is per PROPERTY, so it fills the building's FIRST owner — for condo buildings
   * with several owners of record, the person found belongs to one unit at most.
   * Fixed 2026-10-06 (Big O audit): this used to commit — re-copy, re-save to storage and
   * notify listeners — up to twice PER matching building, quadratic in m and s. It now builds the new
   * list in one pass and commits once. The stored list format is unchanged.
   * Each matching building stores its own copy of the answer's phones/emails, and a found
   * phone/email is either already on that owner or gets added, so the merge work is
   * bounded by the list size after the write.
   * O(s) time, O(s) space — s = total list size after the answer is written
   */
  applyOwnerAnswer(street: string, answer: OwnerAnswer): void {
    const key = street.trim().toUpperCase();
    let changed = false;
    // O(s) time, O(s) space — s = total list size after the write (see the doc comment above)
    const next = this.buildings.map((b) => {
      if (!b.owners.length || b.address.trim().toUpperCase() !== key) return b;
      changed = true;
      const { reason, ...found } = ownerPatchFromAnswer(answer); // fresh copy per building, as before
      // O(o) time, O(o) space — o = owners at this building (only the first is merged)
      // bigo-lint: disable=BIGO006 — amortised: each owner is visited once across all buildings
      const owners = b.owners.map((o, i) => (i === 0 ? mergeSkipTrace(o, found) : o));
      return reason ? { ...b, owners, note: reason } : { ...b, owners };
    });
    if (changed) this.commit(next);
  }

  /** First owner back to idle if it's still "searching…" (batch failed).
   *  O(s) time, O(s) space — s = total list size (buildings with their owners and businesses, which commit() re-serialises) */
  resetPendingOwner(buildingId: string): void {
    this.mapOwner(buildingId, 0, (o) => (o.skipTrace === 'pending' ? { ...o, skipTrace: 'idle' } : o));
  }

  /** How many of these buildings now have a found owner.
   *  O(n + k) time, O(n + k) space — n = buildings in the list; k = building ids passed in */
  countOwnersFound(buildingIds: readonly string[]): number {
    const ids = new Set(buildingIds);
    // O(n) time, O(n) space — n = buildings in the list
    return this.buildings.filter((b) => ids.has(b.id) && b.owners[0]?.skipTrace === 'found').length;
  }

  // O(s + p + e) time, O(s + p + e) space — s = total list size; p = phones on the owner + result; e = emails on the owner + result
  private applyOwnerPatch(buildingId: string, index: number, result: Partial<OwnerContact> & { reason?: string }): void {
    const { reason, ...found } = result;
    this.mapOwner(buildingId, index, (o) => mergeSkipTrace(o, found));
    if (reason) this.patch(buildingId, { note: reason });
  }

  // O(s) time, O(s) space — s = total list size (buildings with their owners and businesses, which commit() re-serialises)
  updateBusiness(buildingId: string, businessId: string, patch: Partial<BusinessContact>): void {
    // Typing a phone marks it manual so a later Retry won't replace it.
    const statusPatch: Partial<BusinessContact> = 'phone' in patch ? { phoneStatus: 'manual', phoneSource: '' } : {};
    this.mapBuilding(buildingId, (b) => ({
      ...b,
      // O(u) time, O(u) space — u = businesses at this building
      businesses: b.businesses.map((x) => (x.id === businessId ? { ...x, ...patch, ...statusPatch } : x)),
    }));
  }

  // ---- internals ----

  /**
   * Resolve one building, at most MAX_PARALLEL_LOOKUPS at a time. Adding 50 curated
   * buildings at once would otherwise fire 100 public-data calls plus a phone lookup per
   * business simultaneously and trip the lookup server's per-minute limit (2026-10-02).
   * O(1) time, O(w) space — w = buildings waiting for a slot.
   */
  private async lookup(pick: BuildingPick): Promise<void> {
    if (!this.resolver) return;
    if (this.activeLookups >= MAX_PARALLEL_LOOKUPS) {
      await new Promise<void>((resolve) => this.waitingLookups.push(resolve));
    }
    this.activeLookups++;
    try {
      await this.resolver.resolve(pick, (fields) => this.applyResolved(pick.id, fields));
    } catch {
      this.patch(pick.id, { status: 'error', note: 'Lookup failed — press Retry.' });
    } finally {
      this.activeLookups--;
      this.waitingLookups.shift()?.();
    }
  }

  /**
   * Merge lookup results into the entry, preserving user edits:
   *  * owners the user already has (by PIN, or any hand-entered owner) are kept as-is;
   *  * businesses with a manual phone keep it.
   * O(s + f) time, O(s + f) space — s = total list size; f = owners and businesses in the lookup result
   */
  private applyResolved(id: string, fields: ResolvedFields): void {
    this.mapBuilding(id, (b) => {
      const manualPhones = new Map(
        // O(u) time, O(u) space — u = businesses already on the building
        b.businesses.filter((x) => x.phoneStatus === 'manual').map((x) => [x.id, x.phone] as const),
      );
      // O(f) time, O(f) space — f = businesses in the lookup result (one Map lookup each)
      const businesses = fields.businesses.map((x) =>
        manualPhones.has(x.id) ? { ...x, phone: manualPhones.get(x.id) ?? '', phoneStatus: 'manual' as const } : x,
      );
      // O(o) time, O(o) space — o = owners already on the building
      const handEntered = b.owners.filter((o) => !o.pin);
      // O(o) time, O(o) space — o = owners already on the building
      const editedByPin = new Map(b.owners.filter((o) => o.pin).map((o) => [o.pin, o] as const));
      // O(f + o) time, O(f + o) space — f = owners in the lookup result; o = hand-entered owners kept
      const owners = [...fields.owners.map((o) => editedByPin.get(o.pin) ?? o), ...handEntered];
      return { ...b, owners, businesses, status: fields.status, note: fields.note };
    });
  }

  // O(s) time, O(s) space — s = total list size (buildings with their owners and businesses, which commit() re-serialises)
  private mapOwner(buildingId: string, index: number, fn: (o: OwnerContact) => OwnerContact): void {
    // O(o) time, O(o) space — o = owners at this building
    this.mapBuilding(buildingId, (b) => ({ ...b, owners: b.owners.map((o, i) => (i === index ? fn(o) : o)) }));
  }

  // O(s) time, O(s) space — s = total list size (buildings with their owners and businesses, which commit() re-serialises)
  private patch(id: string, patch: Partial<SelectedBuilding>): void {
    this.mapBuilding(id, (b) => ({ ...b, ...patch }));
  }

  /** Replace one building; no-op if it was removed meanwhile (late lookup).
   *  O(s) time, O(s) space — s = total list size (buildings with their owners and businesses, which commit() re-serialises) */
  private mapBuilding(id: string, fn: (b: SelectedBuilding) => SelectedBuilding): void {
    if (!this.has(id)) return;
    // O(n) time, O(n) space — n = buildings in the list (fn runs once)
    this.commit(this.buildings.map((b) => (b.id === id ? fn(b) : b)));
  }
}

/**
 * Merge skip-trace results into an owner without losing what's already there:
 * empty fields are filled; a phone that differs from the existing one is kept as an
 * extra; the person's name only fills an empty "contact person".
 * O(p + e) time, O(p + e) space — p = phones on the owner + result; e = emails on the owner + result
 */
export function mergeSkipTrace(o: OwnerContact, found: Partial<OwnerContact>): OwnerContact {
  if (found.skipTrace !== 'found') {
    return { ...o, skipTrace: found.skipTrace ?? 'not_found', skipTracedAt: found.skipTracedAt ?? o.skipTracedAt };
  }
  const keepPhone = !!o.phone;
  const extraPhones = [
    ...o.extraPhones,
    ...(keepPhone && found.phone && found.phone !== o.phone
      ? [{ number: found.phone, type: found.phoneNote ?? '', dnc: !!found.phoneDnc }]
      : []),
    ...(found.extraPhones ?? []),
  ];
  const keepEmail = !!o.email;
  const extraEmails = [...o.extraEmails, ...(keepEmail && found.email ? [found.email] : []), ...(found.extraEmails ?? [])];
  return {
    ...o,
    skipTrace: 'found',
    skipTracedAt: found.skipTracedAt ?? '',
    dncChecked: found.dncChecked ?? true,
    skipTraceMethod: found.skipTraceMethod ?? '',
    contactPerson: o.contactPerson || found.contactPerson || '',
    phone: keepPhone ? o.phone : found.phone ?? '',
    phoneNote: keepPhone ? o.phoneNote : found.phoneNote ?? '',
    phoneDnc: keepPhone ? o.phoneDnc : !!found.phoneDnc,
    // O(p) time, O(p) space — p = phones on the owner + result
    extraPhones: dedupeBy(extraPhones, (p) => p.number).filter((p) => p.number !== (keepPhone ? o.phone : found.phone)),
    email: keepEmail ? o.email : found.email ?? '',
    // O(e) time, O(e) space — e = emails on the owner + result
    extraEmails: [...new Set(extraEmails)].filter((e) => e && e !== (keepEmail ? o.email : found.email)),
  };
}

/** Keep the first item per key.
 *  O(n) time, O(n) space — n = items */
function dedupeBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  // O(n) time, O(n) space — n = items (one Set lookup each)
  return items.filter((t) => (seen.has(key(t)) ? false : (seen.add(key(t)), true)));
}
