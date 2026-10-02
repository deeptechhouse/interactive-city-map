/**
 * Contact list → CSV, ready for mail merge (Word / labels) and call lists.
 *
 * Columns (agreed 2026-10-02 — split address for mail merge, plus email/website):
 *   Name / Address | Building Owner | Contact Name | Phone | Email | Website |
 *   Mail Street | Mail City | Mail State | Mail ZIP
 *
 * One row per contact:
 *   * owner rows    — Name/Address = the building's address, Building Owner = Y,
 *                     Contact Name = "PERSON, OWNER LLC" when a person was found,
 *                     Mail * = the address the user picked for letters (owner's own
 *                     address by default, or the tax-bill address);
 *   * business rows — Name/Address = business name, Building Owner = N,
 *                     Contact Name = legal entity, Mail * = the licence address.
 *
 * DNC: a phone on the Do-Not-Call registry is written as "(312) 555-0100 [DNC]", and an
 * owner phone from a batch skip trace (which never checks DNC) as
 * "(312) 555-0100 [DNC not checked]" — the flag travels with the number into whatever
 * dialer or spreadsheet opens the file.
 *
 * Owner Lookup Date (added 2026-10-02): YYYY-MM-DD of the paid skip trace behind an
 * owner row, so a stale lookup is visible in the spreadsheet too.
 *
 * SECURITY — CSV/formula injection: names come from public data anyone can register
 * ("=HYPERLINK(...)" as a business name). Excel/Sheets execute cells starting with
 * = + - @ (or tab/CR). Such cells get a leading apostrophe so they open as plain text.
 */
import { letterAddress, type OwnerContact, type SelectedBuilding } from './types';

export const CSV_HEADER = [
  'Name / Address',
  'Building Owner',
  'Contact Name',
  'Phone',
  'Email',
  'Website',
  'Mail Street',
  'Mail City',
  'Mail State',
  'Mail ZIP',
  'Owner Lookup Date',
] as const;

export type CsvRow = [string, 'Y' | 'N', string, string, string, string, string, string, string, string, string];

/** Flatten the list into rows. O(o + b) time and space — total owners + businesses. */
export function toCsvRows(buildings: readonly SelectedBuilding[]): CsvRow[] {
  const rows: CsvRow[] = [];
  for (const b of buildings) {
    // O(n) buildings × their contacts = O(total contacts)
    const label = b.address || `Building ${b.id.slice(0, 8)}`;
    for (const o of b.owners) {
      const mail = letterAddress(o);
      const contact = o.contactPerson && o.contactPerson !== o.name ? `${o.contactPerson}, ${o.name}` : o.name;
      rows.push([
        label, 'Y', contact, ownerPhoneCell(o), o.email, o.website,
        mail.street, mail.city, mail.state, mail.zip, o.skipTracedAt.slice(0, 10),
      ]);
    }
    for (const x of b.businesses) {
      rows.push([x.name, 'N', x.legalName, x.phone, '', x.website, x.address, 'CHICAGO', 'IL', x.zip, '']);
    }
    // A building with nothing found still gets a row, so it isn't silently dropped.
    if (b.owners.length === 0 && b.businesses.length === 0) rows.push([label, 'Y', '', '', '', '', '', '', '', '', '']);
  }
  return rows;
}

/**
 * Owner phone + its compliance marker. "DNC not checked" applies only to numbers that
 * came from a batch skip trace (phoneNote "… via tracerfy") — a company switchboard from
 * Google or a number typed by hand is not a skip-trace result. O(1).
 */
function ownerPhoneCell(o: OwnerContact): string {
  if (!o.phone) return '';
  if (o.phoneDnc) return `${o.phone} [DNC]`;
  const fromSkipTrace = o.skipTrace === 'found' && /via tracerfy|via batchdata/i.test(o.phoneNote);
  return fromSkipTrace && !o.dncChecked ? `${o.phone} [DNC not checked]` : o.phone;
}

/** Quote one cell (RFC 4180) and neutralise spreadsheet formulas. O(n) — n = cell length. */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Full CSV text with CRLF line endings (what Excel expects). O(total characters). */
export function toCsv(buildings: readonly SelectedBuilding[]): string {
  return [CSV_HEADER as readonly string[], ...toCsvRows(buildings)]
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n');
}

/** "contacts-2026-10-01.csv" */
export function csvFilename(now: Date = new Date()): string {
  return `contacts-${now.toISOString().slice(0, 10)}.csv`;
}

/** Trigger a browser download. The BOM makes Excel read UTF-8 names correctly. */
export function downloadCsv(buildings: readonly SelectedBuilding[]): void {
  const blob = new Blob(['\uFEFF', toCsv(buildings)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = csvFilename();
  a.click();
  URL.revokeObjectURL(url);
}
