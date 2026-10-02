#!/usr/bin/env node
/**
 * Headless smoke test of the DATABASE-mode map: every city loads, its data tiles come
 * from PostGIS (via the /tiles proxy), its API calls succeed, and nothing errors.
 *
 * USAGE (with ./run-db.sh running):
 *   node scripts/smoke-db.mjs                         http://localhost:8100, all 3 cities
 *   node scripts/smoke-db.mjs http://localhost:8101 detroit
 *
 * Writes a screenshot per city to $SMOKE_OUT (default /tmp) and exits non-zero if any city
 * shows no data tiles, a failed tile/API request, or a page error.
 *
 * HOW: drives Chrome over the DevTools protocol with the `ws` package (already a dev
 * dependency) — no Playwright download. TRAP: headless Chrome without a GPU needs
 * SwiftShader for WebGL, or MapLibre never paints (hung renders, 2026-10-02).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const BASE = process.argv[2] ?? 'http://localhost:8100';
const CITIES = process.argv[3] ? [process.argv[3]] : ['chicago', 'detroit', 'dayton'];
const OUT = process.env.SMOKE_OUT ?? tmpdir();
// ADJUSTABLE: how long each city gets to load its tiles. Dense building tiles are slow cold.
const SETTLE_MS = Number(process.env.SMOKE_SETTLE_MS ?? 25000);
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;

/** O(1) time, O(1) space — n = 1 timer. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), 'smoke-chrome-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1400,900',
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

// bigo-allow: t ≤ 50 polling tries and g ≤ 2 DevTools targets — both fixed constants
/** Poll until Chrome's DevTools endpoint answers. O(t·g) time, O(g) space — t = tries (≤ 50); g = open targets (1–2). */
async function pageWsUrl() {
  // bigo-allow: t ≤ 50 tries × g ≤ 2 targets, constant
  // O(t·g) time, O(g) space — t = tries (≤ 50); g = targets (1–2)
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      // bigo-lint: disable=BIGO006 — g = 1–2 DevTools targets, a constant
      // O(g) time, O(1) space — g = targets
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('Chrome DevTools did not start');
}

const ws = new WebSocket(await pageWsUrl());
await new Promise((r) => ws.once('open', r));
let nextId = 1;
const pending = new Map();
const listeners = [];
ws.on('message', (raw) => {
  const msg = JSON.parse(raw);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method) {
    // O(l) time, O(1) space — l = listeners (1)
    listeners.forEach((fn) => fn(msg));
  }
});
/** One DevTools command (to the page, or to an attached worker's session). O(1) time, O(1) space — n = 1 message. */
const send = (method, params = {}, sessionId = undefined) => new Promise((resolve) => {
  const id = nextId++;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});

// MapLibre fetches tiles from Web Workers, whose requests the PAGE's Network domain never
// sees (first run 2026-10-02 reported "no tiles" while the server log showed 142).
// Auto-attach to workers and enable Network in each one.
ws.on('message', (raw) => {
  const msg = JSON.parse(raw);
  if (msg.method === 'Target.attachedToTarget') {
    void send('Network.enable', {}, msg.params.sessionId);
    void send('Runtime.runIfWaitingForDebugger', {}, msg.params.sessionId);
  }
});
await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
await send('Network.enable');
await send('Runtime.enable');
await send('Log.enable');

let failures = 0;
// O(c) time, O(r) space — c = cities; r = requests recorded for one city
for (const city of CITIES) {
  const tiles = new Map(); // table → { ok, failed }
  const api = { ok: 0, failed: [] };
  const errors = [];
  const urls = new Map();
  listeners.length = 0;
  listeners.push((msg) => {
    if (msg.method === 'Network.requestWillBeSent') urls.set(msg.params.requestId, msg.params.request.url);
    if (msg.method === 'Network.responseReceived') {
      const { url, status } = msg.params.response;
      const tile = url.match(/\/tiles\/([a-z0-9_]+)\/\d+\/\d+\/\d+/);
      if (tile) {
        const t = tiles.get(tile[1]) ?? { ok: 0, failed: 0 };
        if (status === 200 || status === 204) t.ok++; else t.failed++;
        tiles.set(tile[1], t);
      } else if (url.includes('/api/v1/')) {
        if (status < 400) api.ok++; else api.failed.push(`${status} ${url.replace(BASE, '')}`);
      }
    }
    if (msg.method === 'Network.loadingFailed' && !msg.params.canceled) {
      errors.push(`load failed: ${urls.get(msg.params.requestId) ?? '?'} (${msg.params.errorText})`);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(`exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      errors.push(`console: ${msg.params.entry.text}`);
    }
  });

  await send('Page.navigate', { url: `${BASE}/?city=${city}` });
  await sleep(SETTLE_MS);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const shotPath = join(OUT, `smoke-db-${city}.png`);
  writeFileSync(shotPath, Buffer.from(shot.result.data, 'base64'));

  // O(t) time, O(t) space — t = tile sources seen
  const tileSummary = [...tiles].map(([t, n]) => `${t}:${n.ok}${n.failed ? `(!${n.failed})` : ''}`).join(' ');
  // O(t) time, O(t) space — t = tile sources seen
  const tileFailures = [...tiles.values()].reduce((s, n) => s + n.failed, 0);
  const ok = tiles.size > 0 && tileFailures === 0 && api.failed.length === 0 && errors.length === 0;
  if (!ok) failures++;
  console.log(`\n${ok ? 'PASS' : 'FAIL'} ${city}`);
  console.log(`  tiles   ${tileSummary || '(none!)'}`);
  console.log(`  api     ${api.ok} ok${api.failed.length ? `, failed: ${api.failed.join('; ')}` : ''}`);
  // O(e) time, O(1) space — e = errors (first 8 shown)
  errors.slice(0, 8).forEach((e) => console.log(`  error   ${e.slice(0, 200)}`));
  console.log(`  shot    ${shotPath}`);
}

ws.close();
chrome.kill();
process.exit(failures ? 1 : 0);
