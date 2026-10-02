#!/usr/bin/env node
/**
 * Download the map-label fonts into public/fonts/ so labels work fully OFFLINE.
 *
 * WHY (2026-10-02): static mode loads glyphs from ./fonts/{fontstack}/{range}.pbf, but
 * public/fonts/ never existed — the server answered every font request with the web page
 * itself (HTML), so labels couldn't render without internet. The laptop is meant to run
 * the map in a car with no connection, so the fonts must ship with it.
 *
 * Source: protomaps/basemaps-assets (Noto Sans, SIL Open Font License — free to bundle).
 * RUN (from frontend/):  node scripts/fetch-fonts.mjs      (~a few MB, one time)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'fonts');
const BASE = 'https://raw.githubusercontent.com/protomaps/basemaps-assets/main/fonts';
// ADJUSTABLE: font stacks used by the map's text layers (grep "Noto Sans" in src/) and
// the Protomaps dark theme. Add one here if a layer starts using a new font.
const STACKS = ['Noto Sans Regular', 'Noto Sans Italic', 'Noto Sans Medium'];
// ADJUSTABLE: glyph ranges to fetch. Latin, Latin-ext, punctuation and symbols live in the
// first 9 ranges (0–2303) plus general punctuation (8192–8447). Add ranges for other scripts.
const RANGES = [0, 256, 512, 768, 1024, 1280, 1536, 1792, 2048, 8192];
const CONCURRENCY = 8;
// The map's own layers ask for "Noto Sans Bold", which basemaps-assets doesn't publish
// (checked 2026-10-02: all 404). Its Medium weight is served under the Bold name instead.
// ADJUSTABLE: map of requested stack → stack whose files to copy.
const ALIASES = { 'Noto Sans Bold': 'Noto Sans Medium' };

/** Fetch one glyph file; a 404 just means that range doesn't exist for this font.
 * O(b) time, O(b) space — b = bytes in the file. */
async function fetchOne(stack, start) {
  const name = `${start}-${start + 255}.pbf`;
  const resp = await fetch(`${BASE}/${encodeURIComponent(stack)}/${name}`);
  if (resp.status === 404) return 0;
  if (!resp.ok) throw new Error(`${stack}/${name}: HTTP ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  fs.mkdirSync(path.join(OUT, stack), { recursive: true });
  fs.writeFileSync(path.join(OUT, stack, name), buf);
  return buf.length;
}

// bigo-allow: the job list is a fixed 3 stacks × 10 ranges = 30 downloads.
// O(s * r) time, O(s * r) space — s = stacks, r = ranges.
const jobs = STACKS.flatMap((stack) => RANGES.map((start) => [stack, start]));
let bytes = 0;
// O(j) time, O(1) space — j = jobs, run CONCURRENCY at a time.
for (let i = 0; i < jobs.length; i += CONCURRENCY) {
  const batch = jobs.slice(i, i + CONCURRENCY);
  // O(k) time, O(k) space — k = CONCURRENCY downloads in flight.
  const sizes = await Promise.all(batch.map(([s, r]) => fetchOne(s, r)));
  // O(k) time, O(1) space — k = sizes in this batch.
  bytes += sizes.reduce((a, b) => a + b, 0);
}
// bigo-allow: one alias today, so this copies a single folder of r files.
// O(a * r) time, O(1) space — a = aliases (1), r = ranges copied.
for (const [stack, source] of Object.entries(ALIASES)) {
  if (fs.existsSync(path.join(OUT, stack))) continue; // real files were found — keep them
  fs.cpSync(path.join(OUT, source), path.join(OUT, stack), { recursive: true });
}
console.log(`fonts: ${STACKS.length} stacks → ${OUT} (${Math.round(bytes / 1024)} KB)`);
