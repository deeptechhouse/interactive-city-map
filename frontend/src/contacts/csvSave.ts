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
 *
 * REMOTE USE (2026-10-02): over Tailscale the page comes from the Mac mini, so "the
 * Desktop" would be the Mac mini's — not the phone/laptop in your hand. When the page is
 * not opened as localhost, the CSV downloads to the device you're using instead.
 */
import { backendPoster, failureReason, type PostJson } from './phoneLookup';
import { downloadCsv, toCsv } from './csvExport';
import type { SelectedBuilding } from './types';

export type SaveResult =
  | { saved: true; filename: string; path: string }
  | { saved: false; reason: string; remote?: boolean };

// Page opened on the machine running the map server → its Desktop is "your" Desktop.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Human-readable outcome for the panel. O(1) time, O(1) space — n = 1 result. */
export function saveMessage(r: SaveResult): string {
  if (r.saved) return `Saved to Desktop: ${r.filename}`;
  if (r.remote) return 'CSV downloaded to this device.';
  return `Couldn't save to the Desktop (${r.reason}) — downloaded to your Downloads folder instead.`;
}

/**
 * Try the server; on any failure fall back to a browser download so the user always
 * gets the file. O(c) time, O(c) space — c = characters in the CSV.
 */
export async function saveCsv(
  buildings: readonly SelectedBuilding[],
  post: PostJson | null = backendPoster(),
  download: (b: readonly SelectedBuilding[]) => void = downloadCsv,
  hostname: string = typeof window === 'undefined' ? 'localhost' : window.location.hostname,
): Promise<SaveResult> {
  if (!LOCAL_HOSTS.has(hostname)) {
    download(buildings);
    return { saved: false, reason: 'opened from another device', remote: true };
  }
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
