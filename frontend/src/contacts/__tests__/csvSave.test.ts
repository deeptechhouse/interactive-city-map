import { describe, expect, it, vi } from 'vitest';
import { saveCsv, saveMessage } from '../csvSave';
import { ApiError } from '../../api/client';
import { newOwner, type SelectedBuilding } from '../types';

const LIST: SelectedBuilding[] = [{
  id: 'b1', address: '1001 W NORTH AVE', lngLat: [0, 0], status: 'ready', note: '', addedAt: 0, businesses: [],
  owners: [newOwner({ name: 'CRM PROPERTIES GROUP' })],
}];

describe('saveCsv', () => {
  it('sends only CSV text to the server and reports the Desktop file', async () => {
    const post = vi.fn().mockResolvedValue({ path: '/Users/me/Desktop/contacts-1.csv', filename: 'contacts-1.csv' });
    const download = vi.fn();
    const r = await saveCsv(LIST, post as never, download);
    expect(r).toEqual({ saved: true, filename: 'contacts-1.csv', path: '/Users/me/Desktop/contacts-1.csv' });
    const [path, body] = post.mock.calls[0];
    expect(path).toBe('/contacts/export');
    expect(Object.keys(body)).toEqual(['csv']); // no path/filename from the page
    expect(body.csv).toMatch(/^Name \/ Address,Building Owner/);
    expect(download).not.toHaveBeenCalled();
    expect(saveMessage(r)).toBe('Saved to Desktop: contacts-1.csv');
  });

  it('falls back to a browser download with the server reason', async () => {
    const post = vi.fn().mockRejectedValue(new ApiError(503, '{"detail":"Export folder not found: /x"}', ''));
    const download = vi.fn();
    const r = await saveCsv(LIST, post as never, download);
    expect(download).toHaveBeenCalledWith(LIST);
    expect(r).toEqual({ saved: false, reason: 'Export folder not found: /x' });
    expect(saveMessage(r)).toMatch(/Downloads folder instead/);
  });

  it('downloads when no lookup server is configured', async () => {
    const download = vi.fn();
    expect(await saveCsv(LIST, null, download)).toEqual({ saved: false, reason: 'lookup server not running' });
    expect(download).toHaveBeenCalled();
  });
});
