#!/usr/bin/env node
/**
 * Refresh the embedded Chicago ward + police-district BOUNDARY shapes from the City of
 * Chicago data portal.
 *
 * WHY (2026-10-02): the embedded shapes had been rounded to 3 decimal places (~80–110 m).
 * Measured against the official data they were off by ~24 m on average and up to ~70 m —
 * lines visibly cut through blocks at street zoom. This rebuilds them from the official
 * full-precision data, simplified to ~1 m (TOLERANCE_DEG) so the bundle stays small.
 *
 * WHAT IT CHANGES — only the `WARD_BOUNDARIES` and `DISTRICT_BOUNDARIES` literals in
 *   src/map/layers/data/wardsData.ts and policeDistrictsData.ts. Everything else in those
 *   files (WARD_INFO, WARD_OFFICES, DISTRICT_INFO, DISTRICT_STATIONS) is left untouched,
 *   and each ward keeps the properties it already had (alderman, phones, …).
 *
 * RUN (from frontend/):   node scripts/refresh-boundaries.mjs
 * Needs network access; uses the project's own @turf/turf. Re-run after redistricting.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { simplify } from '@turf/turf';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(HERE, '..', 'src', 'map', 'layers', 'data');

// ADJUSTABLE: simplification tolerance in degrees. 0.00001° ≈ 1.1 m. Smaller = more exact
// but bigger files (0.000005 → wards ~260 KB); larger saves bytes but drifts off streets.
const TOLERANCE_DEG = 0.00001;
// ADJUSTABLE: decimal places kept. 6 ≈ 0.1 m — finer than the tolerance, so no extra error.
const DECIMALS = 6;

// Official datasets (City of Chicago data portal, checked 2026-10-02).
const SOURCES = [
  {
    file: 'wardsData.ts',
    constName: 'WARD_BOUNDARIES',
    url: 'https://data.cityofchicago.org/resource/p293-wvbd.geojson?$limit=100', // Boundaries - Wards (2023-)
    idProp: 'ward',
    expectedCount: 50,
  },
  {
    file: 'policeDistrictsData.ts',
    constName: 'DISTRICT_BOUNDARIES',
    // "Boundaries - Police Districts (current)" map fthy-xz3r is backed by this dataset:
    url: 'https://data.cityofchicago.org/resource/24zt-jpfn.geojson?$limit=100',
    idProp: 'dist_num',
    expectedCount: 23, // distinct district numbers (district 31 is several polygons)
  },
];

/** Round every number in a GeoJSON object.
 * O(v) time, O(v) space — v = vertices (JSON round-trip touches each number once). */
const roundCoords = (obj) => JSON.parse(JSON.stringify(obj, (_k, v) => (typeof v === 'number' ? +v.toFixed(DECIMALS) : v)));

/** Pull one `export const NAME: GeoJSON.FeatureCollection = {...};` literal out of a TS file.
 * O(n) time, O(n) space — n = characters in the file (one regex scan + JSON.parse). */
function readLiteral(text, constName) {
  const re = new RegExp(`(export const ${constName}: GeoJSON\\.FeatureCollection = )(\\{.*?\\});\\n`, 's');
  const m = text.match(re);
  if (!m) throw new Error(`${constName} not found`);
  return { match: m[0], prefix: m[1], fc: JSON.parse(m[2]) };
}

// bigo-allow: s is a fixed constant (2 sources), so the bound is linear in vertices.
// O(s * v) time, O(v) space — s = sources (2, fixed), v = vertices per source (~90k).
for (const src of SOURCES) {
  const filePath = path.join(DATA_DIR, src.file);
  const text = fs.readFileSync(filePath, 'utf8');
  const current = readLiteral(text, src.constName);

  const resp = await fetch(src.url);
  if (!resp.ok) throw new Error(`${src.url} → HTTP ${resp.status}`);
  const official = await resp.json();

  // Keep each area's existing properties (ward alderman/phones…); geometry comes from the city.
  // O(a) time, O(a) space — a = areas (≤ 50).
  const oldProps = new Map(current.fc.features.map((f) => [Number(f.properties[src.idProp]), f.properties]));
  // O(a log a) time, O(a) space — a = official polygons (≤ 50): filter + map + sort.
  const features = official.features
    .filter((f) => f.geometry)
    .map((f) => {
      const id = Number(f.properties[src.idProp]);
      return { type: 'Feature', properties: oldProps.get(id) ?? { [src.idProp]: id }, geometry: f.geometry };
    })
    .sort((a, b) => Number(a.properties[src.idProp]) - Number(b.properties[src.idProp]));

  // O(a) time, O(a) space — a = polygons.
  const distinct = new Set(features.map((f) => Number(f.properties[src.idProp]))).size;
  if (distinct !== src.expectedCount) {
    throw new Error(`${src.constName}: expected ${src.expectedCount} areas, got ${distinct} — not writing`);
  }

  const fc = roundCoords(simplify({ type: 'FeatureCollection', features }, { tolerance: TOLERANCE_DEG, highQuality: true }));
  const updated = text.replace(current.match, `${current.prefix}${JSON.stringify(fc)};\n`);
  fs.writeFileSync(filePath, updated);
  console.log(`${src.file}: ${src.constName} — ${features.length} polygons, ${distinct} areas, ${Math.round(JSON.stringify(fc).length / 1024)} KB`);
}
