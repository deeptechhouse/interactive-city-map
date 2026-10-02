/**
 * HTML escaping for popup builders.
 *
 * WHY: popups are built as HTML strings from vector-tile properties, and those come from
 *   open-data portals — untrusted text. An address like `<img src=x onerror=…>` would run
 *   script in the map page. Every value interpolated into popup HTML goes through
 *   escapeHtml first. (The older Chicago builders in MapContainer predate this helper.)
 */

const ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escape a value for use in HTML text or a quoted attribute. null/undefined → ''.
 * O(n) time, O(n) space — n = length of the string form of the value.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  // O(n) time, O(n) space — n = characters replaced in one pass
  return String(value).replace(/[&<>"']/g, (ch) => ENTITIES[ch]);
}

/**
 * One `<div><b>label</b> value</div>` popup row, or '' when the value is empty.
 * O(n) time, O(n) space — n = length of label + value.
 */
export function popupRow(label: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  return `<div style="margin:2px 0"><b>${escapeHtml(label)}</b> ${escapeHtml(value)}</div>`;
}

/**
 * Popup title line.
 * O(n) time, O(n) space — n = length of the title.
 */
export function popupTitle(title: unknown): string {
  return `<div style="font-weight:600;font-size:14px;margin-bottom:4px">${escapeHtml(title)}</div>`;
}
