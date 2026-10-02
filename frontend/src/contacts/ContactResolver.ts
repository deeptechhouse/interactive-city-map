/**
 * Gathers everything the contact list knows about one building.
 *
 * FLOW — resolve(pick, onProgress), runs when a building is added:
 *     → owners.findOwners(address)              ┐ in parallel, both free
 *     → businesses.findBusinesses(address, pt)  ┘
 *     → onProgress(names ready)                       # panel fills in immediately
 *     → in parallel (Google → Foursquare, backend-cached):
 *         phones.lookup(business) for each business
 *         phones.lookup(owner company) for up to MAX_COMPANY_LOOKUPS company owners
 *     → onProgress(final)
 *
 * Owner skip trace (PAID) is NOT part of resolve(): it runs only on request —
 *   batch (the GUI path): OwnerBatchRunner → OwnerBatchApi → store.applyOwnerAnswer()
 *   instant (hidden):     skipTraceOwner() → OwnerLookup → store.skipTraceOwner()
 * Both turn answers into owner fields with ownerPatchFromAnswer() below.
 *
 * A failure in one source is recorded in ``note`` and the others still fill in — a
 * county API outage shouldn't hide the businesses.
 */
import type { BusinessSource, OwnerSource } from './publicRecords';
import { getCityProfile } from '../cities/registry';
import { createPhoneLookup, type PhoneLookup } from './phoneLookup';
import { createOwnerLookup, UnavailableOwnerLookup, type OwnerAnswer, type OwnerLookup } from './ownerLookup';
import {
  letterAddress,
  type BuildingPick,
  type BusinessContact,
  type OwnerContact,
  type SelectedBuilding,
} from './types';

export type ResolvedFields = Pick<SelectedBuilding, 'owners' | 'businesses' | 'status' | 'note'>;

/** A looked-up contact plus why the lookup couldn't run, if it couldn't. */
type Looked<T> = { contact: T; unavailableReason?: string };

// ADJUSTABLE: how many company owners per building get an automatic Google/Foursquare
// search. Condo buildings can list 25 owners; searching them all costs 25 lookups for
// little gain. Others can still be looked up by hand.
export const MAX_COMPANY_LOOKUPS = 3;

/** Where the buildings are — fills phone-lookup locality and CSV city/state. */
export interface ResolverPlace {
  /** Locality as a search engine expects it ("Chicago"). */
  readonly locality: string;
  /** Two-letter state ("IL"). */
  readonly region: string;
}

const CHICAGO_PLACE: ResolverPlace = { locality: 'Chicago', region: 'IL' };

export class ContactResolver {
  // O(1) time, O(1) space — n = 1 resolver (stores its five collaborators)
  constructor(
    private readonly owners: OwnerSource,
    private readonly businesses: BusinessSource,
    private readonly phones: PhoneLookup,
    private readonly ownerLookup: OwnerLookup = new UnavailableOwnerLookup(),
    private readonly place: ResolverPlace = CHICAGO_PLACE,
  ) {}

  /**
   * Factory for a city, from its CityProfile's contact sources. A city without sources
   * (profile.contacts === null) gets null, and the panel shows a clear note instead of
   * looking up another city's records.
   * O(1) time, O(1) space — n = 1 resolver.
   */
  static forCity(city: string): ContactResolver | null {
    const profile = getCityProfile(city);
    if (!profile?.contacts) return null;
    return new ContactResolver(
      profile.contacts.owners,
      profile.contacts.businesses,
      createPhoneLookup(city),
      // O(1) time, O(1) space — n = 1 owner-lookup adapter built
      createOwnerLookup(),
      { locality: profile.name, region: profile.state },
    );
  }

  /**
   * Network: b + c phone calls (b businesses + c ≤ MAX_COMPANY_LOOKUPS owner companies),
   * plus one county and one licence call, all issued in parallel.
   * O(o + b) time, O(o + b) space — o = owners found; b = businesses found.
   */
  async resolve(pick: BuildingPick, onProgress: (fields: ResolvedFields) => void): Promise<void> {
    const notes: string[] = [];
    if (!pick.address) notes.push('Building has no street address — owner lookup skipped; businesses found by location.');

    const [ownerResult, bizResult] = await Promise.allSettled([
      pick.address ? this.owners.findOwners(pick.address) : Promise.resolve<OwnerContact[]>([]),
      this.businesses.findBusinesses(pick.address, pick.lngLat),
    ]);
    let owners = ownerResult.status === 'fulfilled' ? ownerResult.value : [];
    if (ownerResult.status === 'rejected') notes.push('Owner records unavailable (county data portal error).');
    // Stamp the city so the CSV writes DETROIT, MI for a Detroit business (it used to
    // write CHICAGO, IL for every row).
    let businesses: BusinessContact[] = bizResult.status === 'fulfilled'
      // O(b) time, O(b) space — b = businesses found
      ? bizResult.value.map((b) => ({ ...b, city: b.city || this.place.locality.toUpperCase(), state: b.state || this.place.region }))
      : [];
    if (bizResult.status === 'rejected') notes.push('Business records unavailable (city data portal error).');

    const bothFailed = ownerResult.status === 'rejected' && bizResult.status === 'rejected';
    // Mark the owner companies we are about to search so the panel shows "searching…".
    let companiesLeft = MAX_COMPANY_LOOKUPS;
    // O(o) time, O(o) space — o = owners found
    owners = owners.map((o) =>
      o.isCompany && companiesLeft-- > 0 ? { ...o, companyLookup: 'pending' as const } : o,
    );
    onProgress({ owners, businesses, status: bothFailed ? 'error' : 'loading', note: notes.join(' ') });
    if (bothFailed) return;

    // All paid lookups at once: b + c calls in parallel.
    const [bizLooked, ownerLooked] = await Promise.all([
      // O(b) time, O(b) space — b = businesses, one phone lookup each
      Promise.all(businesses.map((b) => this.withBusinessPhone(b, pick.lngLat))),
      Promise.all(
        // O(o) time, O(o) space — o = owners (only c ≤ MAX_COMPANY_LOOKUPS make a call)
        owners.map((o): Promise<Looked<OwnerContact>> | Looked<OwnerContact> =>
          o.companyLookup === 'pending' ? this.withCompanyContact(o) : { contact: o },
        ),
      ),
    ]);
    // O(b) time, O(b) space — b = businesses
    businesses = bizLooked.map((l) => l.contact);
    // O(o) time, O(o) space — o = owners
    owners = ownerLooked.map((l) => l.contact);
    // O(o + b) time, O(o + b) space — o = owners; b = businesses (spread copy, then first hit)
    const reason = [...bizLooked, ...ownerLooked].find((l) => l.unavailableReason)?.unavailableReason;
    if (reason) notes.push(reason);
    onProgress({ owners, businesses, status: 'ready', note: notes.join(' ') });
  }

  /**
   * INSTANT paid skip trace for one owner (hidden in the GUI — the batch runner is the
   * GUI path). Returns the fields to merge; the store decides what not to overwrite.
   * O(p + e) time, O(p + e) space — p = phones returned; e = emails returned (one lookup call).
   */
  async skipTraceOwner(
    building: SelectedBuilding,
    owner: OwnerContact,
    refresh = false,
  ): Promise<Partial<OwnerContact> & { reason?: string }> {
    const answer = await this.ownerLookup.lookup(
      {
        street: building.address, zip: owner.propertyZip, ownerName: owner.name,
        locality: this.place.locality, region: this.place.region,
      },
      refresh,
    );
    return ownerPatchFromAnswer(answer);
  }

  /** Look up one business phone — one call. */
  // O(1) time, O(1) space — n = 1 phone lookup
  private async withBusinessPhone(
    b: BusinessContact,
    lngLat: [number, number],
  ): Promise<Looked<BusinessContact>> {
    const answer = await this.phones.lookup({
      name: b.name, address: b.address, lngLat, locality: this.place.locality, region: this.place.region,
    });
    switch (answer.status) {
      case 'found':
        return {
          contact: { ...b, phone: answer.phone, phoneStatus: 'found', phoneSource: answer.source, website: answer.website },
        };
      case 'not_found':
        return { contact: { ...b, phoneStatus: 'not_found', phoneSource: '' } };
      default:
        return { contact: { ...b, phoneStatus: 'unavailable', phoneSource: '' }, unavailableReason: answer.reason };
    }
  }

  /**
   * Search the owner COMPANY at its letter address (management firms, LLC offices).
   * Gives a company switchboard + website — not the person; skip trace does that.
   * O(1) time, O(1) space — n = 1 phone lookup.
   */
  private async withCompanyContact(o: OwnerContact): Promise<Looked<OwnerContact>> {
    const addr = letterAddress(o);
    const answer = await this.phones.lookup({
      name: o.name,
      address: addr.street,
      locality: addr.city || this.place.locality,
      region: addr.state || this.place.region,
    });
    switch (answer.status) {
      case 'found':
        return {
          contact: {
            ...o,
            companyLookup: 'found',
            phone: o.phone || answer.phone,
            phoneNote: o.phone ? o.phoneNote : `company line · via ${answer.source}`,
            website: o.website || answer.website,
          },
        };
      case 'not_found':
        return { contact: { ...o, companyLookup: 'not_found' } };
      default:
        return { contact: { ...o, companyLookup: 'unavailable' }, unavailableReason: answer.reason };
    }
  }
}

/**
 * Any owner answer (instant or batch) → the owner fields it fills. Phones arrive
 * callable-first from the server, so the first one becomes the main phone.
 * O(p + e) time, O(p + e) space — p = phones in the answer; e = emails in the answer.
 */
export function ownerPatchFromAnswer(answer: OwnerAnswer): Partial<OwnerContact> & { reason?: string } {
  if (answer.status === 'unavailable') return { skipTrace: 'unavailable', reason: answer.reason };
  if (answer.status === 'not_found') return { skipTrace: 'not_found', skipTracedAt: answer.lookedUpAt };
  const [first, ...rest] = answer.phones;
  const [email, ...moreEmails] = answer.emails;
  return {
    skipTrace: 'found',
    skipTracedAt: answer.lookedUpAt,
    dncChecked: answer.dncChecked,
    skipTraceMethod: answer.method,
    contactPerson: answer.personName,
    phone: first?.number ?? '',
    phoneDnc: first?.dnc ?? false,
    // "(by name)" flags a 1-credit name trace: only as reliable as the name that was sent.
    phoneNote: first
      // O(1) time, O(1) space — k = 2 note parts filtered and joined
      ? [first.type, `via ${answer.source}${answer.method === 'name' ? ' (by name)' : ''}`].filter(Boolean).join(' · ')
      : '',
    extraPhones: rest,
    email: email ?? '',
    extraEmails: moreEmails,
  };
}
