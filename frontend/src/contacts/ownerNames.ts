/**
 * Which owner names are safe to send to Tracerfy's 1-credit NAME trace.
 *
 * WHY THIS IS CONSERVATIVE: a name that's wrong but matches someone at the address is a
 * PAID wrong hit (1 credit + misleading phones), then the address trace costs 2 more.
 * A name we skip just costs the normal 2-credit address trace. So: when in doubt, return
 * null. (Decided 2026-10-02 — see owner_batch_service.py for the split.)
 *
 * SOURCES, in priority order
 *   1. owner.contactPerson — typed by the user (e.g. from the IL Secretary of State
 *      lookup) or kept from an earlier trace. Read as "FIRST [MIDDLE] LAST".
 *   2. owner.name — the Cook County owner of record, ONLY when it's an individual.
 *
 * COOK COUNTY NAME FORMAT (measured 2026-10-02 on 5,000 Chicago 2026 records):
 *   * "FIRST [MIDDLE] LAST": "THOMAS J LIZAK", "JULIO C BENDEZU SR"
 *   * co-owners joined by "&": "GREGORY BASIL & LOIS B", "ANGELA & JESUS LAGUNAS"
 *   * TRUNCATED AT 22 CHARACTERS — 568 of 5,000 names are exactly 22 long vs ~200 at
 *     21 or 23: "MIGUEL ANGEL ORTEGA RA", "ROBERT F DONOVAN DECLA". A 22-char name's
 *     last word may be cut off, so it's never used as the surname.
 *   * trusts/estates leak in as "… TRU", "… DECLA", "… T D"; initials as "E CONDE".
 */
import { looksLikeCompany, type OwnerContact } from './types';

export interface TraceName {
  first: string;
  last: string;
  source: 'contact' | 'county';
}

// ADJUSTABLE: Cook County's owner-name field length — names this long may be truncated.
export const COUNTY_NAME_LIMIT = 22;

// Generational suffixes dropped from the end ("JULIO C BENDEZU SR" → BENDEZU).
const SUFFIXES = new Set(['JR', 'SR', 'II', 'III', 'IV', 'V']);

// Words/fragments meaning "not a plain person": trusts, estates, placeholders, truncated
// trust wording. ADJUSTABLE: add fragments if non-people slip through.
const NOT_A_PERSON = /\b(TRU|TRUS|TRUST|TRUSTEE|TR|DECL|DECLA|DECLAR|DEC|LIV|LIVING|REV|T\s?D|ESTATE|EST|HEIRS|UNKNOWN|TAXPAYER|CURRENT|OCCUPANT|OWNER|CEMETERY|PARISH|CONDO|ASSN)\b/i;

/** Letters (incl. accented), apostrophes and hyphens only, 2+ letters. O(n). */
function isNameWord(w: string): boolean {
  return /^[\p{L}][\p{L}'-]*$/u.test(w) && w.replace(/['-]/g, '').length >= 2;
}

/** Tidy title-ish casing is not needed — Tracerfy matches case-insensitively. */
function words(text: string): string[] {
  return text.replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean);
}

/**
 * "FIRST [MIDDLE…] LAST [SUFFIX]" → {first, last}, or null when it isn't clearly a
 * person: fewer than two name words, an initial as first name, or digits/symbols. O(n).
 */
export function splitPersonName(text: string): { first: string; last: string } | null {
  const w = words(text);
  while (w.length && SUFFIXES.has(w[w.length - 1].toUpperCase())) w.pop();
  if (w.length < 2) return null;
  const first = w[0];
  const last = w[w.length - 1];
  return isNameWord(first) && isNameWord(last) ? { first, last } : null;
}

/**
 * A Cook County owner-of-record string → the FIRST owner's name, or null. O(n).
 *
 *   "THOMAS J LIZAK"           → THOMAS / LIZAK
 *   "GREGORY BASIL & LOIS B"   → GREGORY / BASIL        (first owner complete before "&")
 *   "ANGELA & JESUS LAGUNAS"   → ANGELA / LAGUNAS       (shared surname after "&")
 *   "MIGUEL ANGEL ORTEGA RA"   → null                   (22 chars: surname may be cut)
 *   "ROBERT F DONOVAN DECLA"   → null                   (trust wording)
 *   "E CONDE", "CRM PROPERTIES GROUP" → null
 */
export function countyOwnerName(raw: string): { first: string; last: string } | null {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text || looksLikeCompany(text) || NOT_A_PERSON.test(text) || /\d/.test(text)) return null;
  const truncated = raw.trimEnd().length >= COUNTY_NAME_LIMIT;

  const amp = text.indexOf('&');
  if (amp === -1) return truncated ? null : splitPersonName(text);

  const before = text.slice(0, amp).trim();
  const beforeName = splitPersonName(before);
  if (beforeName) return beforeName; // first owner's full name is complete before "&"

  // "ANGELA & JESUS LAGUNAS": a lone first name, surname at the very end — which is
  // exactly the word truncation would cut, so only trust it on a short string.
  const firstOnly = words(before);
  const after = words(text.slice(amp + 1));
  if (truncated || firstOnly.length !== 1 || after.length < 2) return null;
  const first = firstOnly[0];
  const last = after[after.length - 1];
  return isNameWord(first) && isNameWord(last) && !SUFFIXES.has(last.toUpperCase()) ? { first, last } : null;
}

/** The name to send for this owner, or null → 2-credit address trace. O(n). */
export function traceNameFor(owner: OwnerContact): TraceName | null {
  const fromContact = owner.contactPerson ? splitPersonName(owner.contactPerson) : null;
  if (fromContact) return { ...fromContact, source: 'contact' };
  if (owner.isCompany) return null;
  const fromCounty = countyOwnerName(owner.name);
  return fromCounty ? { ...fromCounty, source: 'county' } : null;
}
