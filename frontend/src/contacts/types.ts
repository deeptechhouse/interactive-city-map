/**
 * Data shapes for the building contact list.
 *
 * One SelectedBuilding = one building the user clicked, with its owner(s) of record and
 * the businesses licensed at its address. Most fields are user-editable in the panel;
 * status fields tell a re-lookup not to overwrite what the user typed.
 *
 * Saved lists from older versions are upgraded on load by ContactListStore.parseSavedList
 * — when adding a field here, give it a default there too.
 */

/** Where a phone number came from — shown next to it so the user knows how far to trust it. */
export type PhoneStatus =
  | 'pending' // lookup in flight
  | 'found' // provider matched the business
  | 'not_found' // provider answered, no match
  | 'unavailable' // no backend / no provider key / error — lookup never ran
  | 'manual'; // typed by the user

/** Status of an optional, separately-triggered lookup (owner company search, skip trace). */
export type LookupState = 'idle' | 'pending' | 'found' | 'not_found' | 'unavailable';

/** A US postal address split the way mail merge / label software wants it. */
export interface PostalAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
}

/**
 * Which county address a letter goes to.
 *   'owner'   — the owner-of-record's own address (owner_address_*)
 *   'taxBill' — where the county mails the tax bill (mail_address_*); often a
 *               management company or tax agent ("PROPERTY TAX, P O BOX …")
 */
export type LetterTarget = 'owner' | 'taxBill';

export interface ExtraPhone {
  number: string;
  type: string; // "Mobile" / "Landline" / ''
  dnc: boolean; // on the Do-Not-Call registry — no unsolicited sales calls
}

export interface OwnerContact {
  /** Owner / taxpayer of record from the county (often an LLC, trust or bank). */
  name: string;
  /** Parcel number the record came from — several PINs per building for condos. */
  pin: string;
  /** The building's ZIP, from the county record — skip tracers need it. */
  propertyZip: string;
  ownerAddress: PostalAddress;
  taxBillAddress: PostalAddress;
  letterTo: LetterTarget;
  /** Heuristic: the owner name looks like a company (LLC, INC, TRUST…). */
  isCompany: boolean;
  /** Person behind the owner (from skip trace) — the letter's "Attn:" line. */
  contactPerson: string;
  phone: string;
  /** e.g. "Mobile · via tracerfy" or "company line · via google" */
  phoneNote: string;
  phoneDnc: boolean;
  extraPhones: ExtraPhone[];
  email: string;
  extraEmails: string[];
  website: string;
  /** Google/Foursquare search for the owner COMPANY (automatic, cheap). */
  companyLookup: LookupState;
  /** Skip trace for the owner PERSON (batch button, paid). */
  skipTrace: LookupState;
  /** When the skip trace that filled this owner was bought — ISO UTC, '' if never.
   * Comes from the server's permanent store, so a re-used answer keeps its original date. */
  skipTracedAt: string;
  /** False when the skip-trace source never checked Do-Not-Call status (Tracerfy batch
   * results). The UI/CSV then say "DNC not checked" instead of implying "safe to call". */
  dncChecked: boolean;
  /** How the skip trace found the person: 'name' (1-credit trace of a given name — only
   * as right as that name), 'address' (owner discovery), 'instant', or ''. */
  skipTraceMethod: string;
}

export interface BusinessContact {
  /** Stable key within a building (licence account + site, or name). */
  id: string;
  /** "Doing business as" — the name on the door. Falls back to legal name. */
  name: string;
  /** Registered legal entity, used as the CSV contact name. */
  legalName: string;
  activity: string;
  /** Address on the licence, including unit ("1001 W NORTH AVE UNIT E"). */
  address: string;
  zip: string;
  phone: string;
  phoneStatus: PhoneStatus;
  /** Provider that supplied the phone ("google", "foursquare") or '' */
  phoneSource: string;
  website: string;
}

export type LookupStatus = 'loading' | 'ready' | 'error';

export interface SelectedBuilding {
  /** Building id from the buildings tile layer. */
  id: string;
  /** Street address from the building footprint, '' when the footprint has none. */
  address: string;
  /** Click point — used to find businesses when there's no address and to bias phone search. */
  lngLat: [number, number];
  owners: OwnerContact[];
  businesses: BusinessContact[];
  status: LookupStatus;
  /** Human-readable reason when status is 'error' or a source was skipped. */
  note: string;
  addedAt: number;
}

/** What the map hands over when a building is clicked in selection mode. */
export interface BuildingPick {
  id: string;
  address: string;
  lngLat: [number, number];
}

export const EMPTY_ADDRESS: PostalAddress = Object.freeze({ street: '', city: '', state: '', zip: '' });

/** "740 WAUKEGAN RD, DEERFIELD, IL 60015" — skips blank parts. O(1). */
export function formatAddress(a: PostalAddress): string {
  const stateZip = [a.state, a.zip].filter(Boolean).join(' ');
  return [a.street, a.city, stateZip].filter(Boolean).join(', ');
}

/** True when two addresses are the same place, ignoring case/spacing. O(1). */
export function sameAddress(a: PostalAddress, b: PostalAddress): boolean {
  return formatAddress(a).replace(/\s+/g, ' ').toUpperCase() === formatAddress(b).replace(/\s+/g, ' ').toUpperCase();
}

/** The address the user chose for letters. O(1). */
export function letterAddress(o: OwnerContact): PostalAddress {
  return o.letterTo === 'owner' ? o.ownerAddress : o.taxBillAddress;
}

// Words that mark an owner as an organisation rather than a person. Used to decide
// whether to search Google/Foursquare for the owner as a company.
// ADJUSTABLE: add words if company owners are being missed (e.g. "CONDO ASSN").
const COMPANY_WORDS =
  /\b(L\.?L\.?C|LTD|INC|CORP|CORPORATION|CO|COMPANY|LP|LLP|TRUST|TR|BANK|MGMT|MANAGEMENT|PROPERTIES|PROPERTY|REALTY|GROUP|PARTNERS|PARTNERSHIP|HOLDINGS|ASSN|ASSOC|ASSOCIATION|ENTERPRISES|INVESTMENTS|DEVELOPMENT|LIAB|CHURCH|CITY OF|BOARD|FUND|CAPITAL|VENTURES)\b/i;

/** O(n) — n = name length. */
export function looksLikeCompany(name: string): boolean {
  return COMPANY_WORDS.test(name);
}

/** A fresh owner with every optional field defaulted. */
export function newOwner(patch: Partial<OwnerContact> = {}): OwnerContact {
  return {
    name: '',
    pin: '',
    propertyZip: '',
    ownerAddress: { ...EMPTY_ADDRESS },
    taxBillAddress: { ...EMPTY_ADDRESS },
    letterTo: 'owner',
    isCompany: false,
    contactPerson: '',
    phone: '',
    phoneNote: '',
    phoneDnc: false,
    extraPhones: [],
    email: '',
    extraEmails: [],
    website: '',
    companyLookup: 'idle',
    skipTrace: 'idle',
    skipTracedAt: '',
    dncChecked: true,
    skipTraceMethod: '',
    ...patch,
  };
}
