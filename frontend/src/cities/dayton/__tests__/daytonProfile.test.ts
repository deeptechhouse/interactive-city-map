/**
 * Dayton profile tests: layers + static sources, zoning catalogue coverage, popups
 * escaping, focus indexing, contacts adapters (with injected fake fetchers — no network).
 *
 * The zone codes below are the 26 distinct NEW_ZONE values of the live City of Dayton
 * layer (2026-10-02). backend/tests/test_dayton_parity.py pins the same list from the
 * importer side.
 */
import { describe, expect, it } from 'vitest';
import { DAYTON_PROFILE } from '../index';
import { DAYTON_LAYER_IDS, DAYTON_STATIC_LAYER_IDS, daytonDevSources, daytonLayerStates, daytonStaticSources } from '../layers';
import { DAYTON_POPUPS } from '../popups';
import { DAYTON_ZONE_CLASSES } from '../zoning';
import { DAYTON_TRANSIT_COLORS, DAYTON_RAILROAD_OWNERS } from '../taxonomies';
import { daytonAreaOptions, loadDaytonBoundaries, DAYTON_KIND_LABELS } from '../focus';
import {
  DaytonOsmBusinessSource,
  MontgomeryCountyOwnerSource,
  daytonContactSources,
  ohioCorporationSearchUrl,
  splitCityLine,
} from '../contacts';

const DAYTON_CODES = [
  'AP', 'BP', 'CBD', 'CI', 'EGC', 'EMF', 'ENC', 'ER-3', 'ER-4', 'I-1', 'I-2', 'MGC', 'MH',
  'MMF', 'MNC', 'MR-5', 'MX', 'OS', 'SGC', 'SMF', 'SNC', 'SR-1', 'SR-2', 'T', 'UBD', 'WO',
];

/** Does a zone type's matcher accept this code? O(m) time, O(1) space — m = matchers. */
function matches(code: string, matchers: readonly { kind: string; code?: string; prefix?: string }[]): boolean {
  // O(m) time, O(1) space — m = matchers
  return matchers.some((m) => (m.kind === 'exact' ? m.code === code : code.startsWith(m.prefix ?? '\u0000')));
}

describe('Dayton profile — layers', () => {
  it('offers police_precincts and neighborhoods, never police_districts, wards, federal or gang layers', () => {
    const ids = daytonLayerStates(false).map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(['police_precincts', 'neighborhoods', 'parks', 'buildings']));
    // O(f) time, O(1) space — f = forbidden ids
    for (const forbidden of ['police_districts', 'wards', 'federal_properties', 'gang_territory', 'council_districts']) {
      expect(ids).not.toContain(forbidden);
    }
    expect(ids).toHaveLength(11);
  });

  it('parks read source-layer "parks", not "parcels"', () => {
    expect(DAYTON_PROFILE.sourceLayers?.parks).toBe('parks');
    expect(daytonDevSources().parks).toMatch(/\/parks\//);
    expect(daytonDevSources().neighborhoods).toMatch(/\/neighborhoods\//);
  });

  it('static sources: every offered static layer has a ./data/dayton/ PMTiles URL, never ""', () => {
    const sources = daytonStaticSources();
    // O(l) time, O(1) space — l = static layers
    for (const layer of daytonLayerStates(true)) {
      expect(sources[layer.id]).toBe(`pmtiles://./data/dayton/${layer.id}.pmtiles`);
    }
    expect(Object.values(sources)).not.toContain('');
    expect(DAYTON_PROFILE.staticAssets.basemapPmtiles).toBe('./data/dayton/basemap.pmtiles');
  });

  it('every layer id has a dev source', () => {
    const dev = daytonDevSources();
    // O(l) time, O(1) space — l = layers
    for (const id of DAYTON_LAYER_IDS) expect(dev[id]).toBeTruthy();
    // O(l) time, O(1) space — l = static layers
    for (const id of DAYTON_STATIC_LAYER_IDS) expect(DAYTON_LAYER_IDS).toContain(id);
  });

  it('layer states are fresh copies (toggling one never mutates the template)', () => {
    const a = daytonLayerStates(false);
    a[0].visible = !a[0].visible;
    expect(daytonLayerStates(false)[0].visible).not.toBe(a[0].visible);
  });
});

describe('Dayton popups', () => {
  it('escape every tile property (no raw HTML from open data)', () => {
    const evil = '<img src=x onerror=alert(1)>';
    // O(p) time, O(1) space — p = popup builders
    for (const build of Object.values(DAYTON_POPUPS)) {
      const html = build({ name: evil, precinct: evil, priority_board: evil });
      expect(html).not.toContain('<img');
      expect(html).toContain('&lt;img');
    }
  });

  it('are keyed by style layer id', () => {
    expect(Object.keys(DAYTON_POPUPS).sort()).toEqual(['neighborhoods-fill', 'police_precincts-fill']);
    expect(DAYTON_POPUPS['police_precincts-fill']({ precinct: 'Central', name: 'Central District' })).toContain('Central District');
  });
});

describe('Dayton vocabularies', () => {
  it('every exported zone_code matches exactly one ZoneType', () => {
    // O(c·t) time, O(1) space — c = 26 codes; t = 26 types (fixed catalogue)
    for (const code of DAYTON_CODES) {
      // bigo-allow: fixed catalogue, 26 codes × 26 types (test only)
      const hits = DAYTON_ZONE_CLASSES.flatMap((cls) => cls.types).filter((t) => matches(code, t.matchers));
      expect(hits, code).toHaveLength(1);
    }
  });

  it('class keys are the importer zone_class values; no Chicago sub-types', () => {
    expect(DAYTON_ZONE_CLASSES.map((c) => c.key)).toEqual([
      'residential', 'commercial', 'manufacturing', 'mixed', 'special', 'transportation', 'other',
    ]);
    const keys = DAYTON_ZONE_CLASSES.flatMap((c) => c.types.map((t) => t.key));
    // O(k) time, O(1) space — k = Chicago keys
    for (const chicago of ['M1', 'M2', 'M3', 'PMD', 'RS-3', 'B1']) expect(keys).not.toContain(chicago);
  });

  it('every GDRTA route has a #RRGGBB colour; railroad taxonomy has an _other bucket', () => {
    expect(Object.keys(DAYTON_TRANSIT_COLORS).length).toBeGreaterThanOrEqual(21);
    // O(r) time, O(1) space — r = routes
    for (const color of Object.values(DAYTON_TRANSIT_COLORS)) expect(color).toMatch(/^#[0-9A-F]{6}$/);
    expect(DAYTON_RAILROAD_OWNERS.map((o) => o.key)).toContain('_other');
  });
});

describe('Dayton focus', () => {
  const square = (x: number, props: Record<string, unknown>): GeoJSON.Feature => ({
    type: 'Feature',
    properties: props,
    geometry: { type: 'Polygon', coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]] },
  });
  const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });

  it('indexes zip_code / precinct / name and labels without "ward"', async () => {
    const files: Record<string, GeoJSON.FeatureCollection> = {
      './data/dayton/zip_codes.geojson': fc([square(0, { zip_code: '45410' }), square(1, { zip_code: '45402' })]),
      './data/dayton/police_precincts.geojson': fc([square(0, { precinct: 'Central', name: 'Central District' })]),
      './data/dayton/neighborhoods.geojson': fc([square(0, { name: 'Oregon' })]),
    };
    const index = await loadDaytonBoundaries(async (url) => files[url]);
    const options = daytonAreaOptions(index);
    expect(options.zip.map((o) => o.id)).toEqual(['45402', '45410']);
    expect(options.police).toEqual([{ id: 'Central', label: 'Central District' }]);
    expect(options.ward).toEqual([{ id: 'Oregon', label: 'Oregon' }]);
    expect(Object.values(DAYTON_KIND_LABELS).join(' ').toLowerCase()).not.toContain('ward');
    expect(DAYTON_PROFILE.focus).not.toBeNull();
  });
});

describe('Dayton contacts', () => {
  const ownerRow = {
    'GISADMIN.WEB_CAMA.PARID': 'R72 16702 0081',
    'GISADMIN.WEB_CAMA.OWNER_NAME': 'KNIGHT PROPERTIES LLC',
    'GISADMIN.WEB_CAMA.OWNER_NA_1': ' ',
    'GISADMIN.WEB_CAMA.OWNER_ADDR': '3524 SPRINGDALE DR',
    'GISADMIN.WEB_CAMA.OWNER_AD_2': 'DAYTON, OH  45419',
    'GISADMIN.WEB_CAMA.MAILING_AD': '2005 TROY DR',
    'GISADMIN.WEB_CAMA.MAILING__3': 'DAYTON OH 45404',
    'GISADMIN.WEB_CAMA.MCITYNAME': 'DAYTON',
    'GISADMIN.WEB_CAMA.MSTATECODE': 'OH',
    'GISADMIN.WEB_CAMA.MZIP1': '45404',
    'GISADMIN.mc_parcel_polygon_e.LOC_ZIP': '45404',
  };

  it('MontgomeryCountyOwnerSource maps parcel owner fields to OwnerContact', async () => {
    const urls: string[] = [];
    const source = new MontgomeryCountyOwnerSource(async (url) => {
      urls.push(url);
      return { features: [{ attributes: ownerRow }, { attributes: ownerRow }] };
    });
    const owners = await source.findOwners('2005 troy st');
    expect(owners).toHaveLength(1); // duplicate rows collapse
    expect(owners[0]).toMatchObject({
      name: 'KNIGHT PROPERTIES LLC',
      pin: 'R72 16702 0081',
      propertyZip: '45404',
      ownerAddress: { street: '3524 SPRINGDALE DR', city: 'DAYTON', state: 'OH', zip: '45419' },
      taxBillAddress: { street: '2005 TROY DR', city: 'DAYTON', state: 'OH', zip: '45404' },
      letterTo: 'owner',
      isCompany: true,
    });
    expect(new URL(urls[0]).searchParams.get('where')).toBe("GISADMIN.WEB_CAMA.PARLOC = '2005 TROY ST'");
  });

  it('address is normalised and quote-escaped before it reaches the ArcGIS where clause', async () => {
    let where = '';
    const source = new MontgomeryCountyOwnerSource(async (url) => {
      where = new URL(url).searchParams.get('where') ?? '';
      return { features: [] };
    });
    await source.findOwners("1 O'Brien St'); DROP TABLE x;--");
    expect(where.startsWith("GISADMIN.WEB_CAMA.PARLOC = '")).toBe(true);
    const literal = where.slice("GISADMIN.WEB_CAMA.PARLOC = '".length, -1);
    expect(literal).not.toMatch(/'|;|\(|\)/);
    expect(await new MontgomeryCountyOwnerSource(async () => ({ error: { code: 400 } })).findOwners('1 MAIN ST')).toEqual([]);
    expect(await source.findOwners('   ')).toEqual([]);
  });

  it('DaytonOsmBusinessSource maps named OSM businesses and skips non-businesses', async () => {
    let query = '';
    const source = new DaytonOsmBusinessSource(async (url) => {
      query = new URL(url).searchParams.get('data') ?? '';
      return {
        elements: [
          { type: 'node', id: 1, tags: { name: 'Corner Cafe', amenity: 'cafe', phone: '+1 937 555 0100', 'addr:housenumber': '12', 'addr:street': 'Main St' } },
          { type: 'node', id: 2, tags: { name: 'Lot A', amenity: 'parking' } },
          { type: 'way', id: 3, tags: { name: '<b>Shop</b>', shop: 'books' } },
        ],
      };
    });
    const found = await source.findBusinesses('', [-84.19, 39.76]);
    expect(query).toContain('around:40,39.76,-84.19');
    expect(found.map((b) => b.name)).toEqual(['Corner Cafe', '<b>Shop</b>']); // escaping is the panel's job (React text)
    expect(found[0]).toMatchObject({ phone: '+1 937 555 0100', phoneStatus: 'found', phoneSource: 'osm', address: '12 MAIN ST' });
    expect(await source.findBusinesses('', [Number.NaN, 1])).toEqual([]);
  });

  it('CSV defaults are DAYTON, OH and the SOS link is Ohio', () => {
    const sources = daytonContactSources(async () => ({}));
    expect(sources.postalCity).toBe('DAYTON');
    expect(sources.postalState).toBe('OH');
    expect(ohioCorporationSearchUrl('ACME LLC')).toContain('ohiosos.gov');
    expect(splitCityLine('SPRINGBORO, OH  45066')).toEqual({ city: 'SPRINGBORO', state: 'OH', zip: '45066' });
    expect(DAYTON_PROFILE.contacts?.postalState).toBe('OH');
  });
});
