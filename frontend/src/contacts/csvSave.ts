/**
 * Save the contact-list CSV — to the Desktop when the local lookup server is running,
 * otherwise as a normal browser download (which lands in ~/Downloads).
 *
 * WHY THE SERVER: a web page cannot pick a save folder. The lookup server
 * (backend/app/routes/exports.py) writes the file to CSV_EXPORT_DIR (default ~/Desktop)
 * with a timestamped name; the page only sends the CSV text — never a path.
 *
 * Used by the "Export CSV" button and automatically when an owner batch finishes
 * (OwnerBatchRunner onComplete, wired in useContactList).
 */
import { backendPoster, failureReason, type PostJson } from './phoneLookup';
import { downloadCsv, toCsv } from './csvExport';
import type { SelectedBuilding } from './types';

export type SaveResult =
  | { saved: true; filename: string; path: string }
  | { saved: false; reason: string };

/** Human-readable outcome for the panel. */
export function saveMessage(r: SaveResult): string {
  return r.saved
    ? `Saved to Desktop: ${r.filename}`
    : `Couldn't save to the Desktop (${r.reason}) — downloaded to your Downloads folder instead.`;
}

/**
 * Try the server; on any failure fall back to a browser download so the user always
 * gets the file. O(total characters) to build the CSV.
 */
export async function saveCsv(
  buildings: readonly SelectedBuilding[],
  post: PostJson | null = backendPoster(),
  download: (b: readonly SelectedBuilding[]) => void = downloadCsv,
): Promise<SaveResult> {
  if (post) {
    try {
      const res = await post<{ path: string; filename: string }>('/contacts/export', { csv: toCsv(buildings) });
      return { saved: true, filename: res.filename, path: res.path };
    } catch (err) {
      download(buildings);
      return { saved: false, reason: failureReason(err) };
    }
  }
  download(buildings);
  return { saved: false, reason: 'lookup server not running' };
}
