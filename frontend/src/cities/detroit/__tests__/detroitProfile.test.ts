/**
 * Detroit profile acceptance tests (multi-city build, 2026-10-02).
 *
 * Vocabulary tests read vocab.generated.ts — the distinct values of the real static
 * export — so a rebuild that introduces a new zone code / railroad owner fails here until
 * the hand-written catalogue covers it. O(1) per test except where noted.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ZoneType } from '../../../utils/zoningTypes';
import { DETROIT_PROFILE } from '../index';
import { DETROIT_LAYER_IDS, DETROIT_STATIC_LAYER_IDS, detroitDevSources, detroitLayerStates, detroitStaticSources } from '../layers';
import { DETROIT_ZONE_CLASSES } from '../zoning';
import { DETROIT_RAILROAD_OWNERS, DETROIT_RAILROAD_OWNERSHIP_TYPES, DETROIT_TRANSIT_COLORS } from '../taxonomies';
import {
  DETROIT_EXPORTED_ZONE_CODES,
  DETROIT_POI_COUNTS,
  DETROIT_RAILROAD_OWNER_COUNTS,
  DETROIT_RAILROAD_OWNER_TYPE_COUNTS,
} from '../vocab.generated';
import { DETROIT_POPUPS, blightPopup, dlbaPopup, neighborhoodPopup } from '../popups';
import { detroitAreaOptions, loadDetroitBoundaries } from '../focus';
import {
  DETROIT_LICENSES_QUERY_URL,
  DETROIT_PARCELS_QUERY_URL,
  DetroitBusinessLicenseSource,
  DetroitParcelOwnerSource,
  addressCandidates,
  detroitContactSources,
  sqlString,
} from '../contacts';

/** Same semantics as zoningTypes.matcherExpr. O(m) time, O(1) space — m = matchers. */
function typeMatches(t: ZoneType, code: string): boolean {
  // O(m) time, O(1) space — m = matchers on the type
  return t.matchers.some((m) => (m.kind === 'exact' ? code === m.code : code.startsWith(m.prefix)));
}

describe('Detroit profile — layers', () => {
  it('offers police_precincts and council_districts, never police_districts or wards', () => {
    expect(DETROIT_LAYER_IDS).toContain('police_precincts');
    expect(DETROIT_LAYER_IDS).toContain('council_districts');
    expect(DETROIT_LAYER_IDS).not.toContain('police_districts');
    expect(DETROIT_LAYER_IDS).not.toContain('wards');
    expect(DETROIT_LAYER_IDS).not.toContain('gang_territory');
  });

  it('parks layer reads source-layer "parks", not "parcels"', () => {
    expect(DETROIT_PROFILE.sourceLayers).toEqual({ parks: 'parks' });
    expect(detroitDevSources().parks).toMatch(/\/parks\/\{z\}/);
  });

  it('static sources exist only for produced layers, all under ./data/detroit/', () => {
    const sources = detroitStaticSources();
    expect(Object.keys(sources).sort()).toEqual([...DETROIT_STATIC_LAYER_IDS].sort());
    // O(l) time, O(1) space — l = static layers
    for (const [id, url] of Object.entries(sources)) {
      expect(url).toBe(`pmtiles://./data/detroit/${id}.pmtiles`);
      expect(DETROIT_LAYER_IDS).toContain(id);
    }
  });

  it('static mode lists only layers that have a static asset (no "" tile URLs)', () => {
    const staticIds = detroitLayerStates(true).map((l) => l.id);
    const sources = detroitStaticSources();
    // O(l) time, O(1) space — l = layers
    for (const id of staticIds) expect(sources[id]).toBeTruthy();
  });

  it('every layer id has a dev source', () => {
    const dev = detroitDevSources();
    // O(l) time, O(1) space — l = layers
    for (const id of DETROIT_LAYER_IDS) expect(dev[id]).toMatch(/\{z\}\/\{x\}\/\{y\}$/);
    expect(dev.abandoned_blight).toContain('/blight_violations/');
  });

  const dataDir = resolve(__dirname, '../../../../public/data/detroit');
  it.skipIf(!existsSync(dataDir))('every static layer file is on disk (local build present)', () => {
    // O(l) time, O(1) space — l = static layers
    for (const id of DETROIT_STATIC_LAYER_IDS) expect(existsSync(`${dataDir}/${id}.pmtiles`), id).toBe(true);
  });
});

describe('Detroit vocabularies', () => {
  it('every zone_code in the Detroit export matches exactly one ZoneType', () => {
    const types = DETROIT_ZONE_CLASSES.flatMap((c) => c.types);
    // O(c·t) time, O(1) space — c = exported codes (29); t = types (36)
    for (const code of Object.keys(DETROIT_EXPORTED_ZONE_CODES)) {
      const hits = types.filter((t) => typeMatches(t, code)).map((t) => t.key);
      expect(hits, code).toHaveLength(1);
    }
  });

  it('zone class keys are the backend zone_class vocabulary', () => {
    const allowed = ['residential', 'commercial', 'manufacturing', 'mixed', 'special', 'transportation', 'waterfront', 'other'];
    // O(k) time, O(1) space — k = classes
    for (const c of DETROIT_ZONE_CLASSES) expect(allowed).toContain(c.key);
  });

  it('transit colours are GTFS hex values', () => {
    expect(Object.keys(DETROIT_TRANSIT_COLORS).length).toBeGreaterThan(50);
    // O(n) time, O(1) space — n = lines
    for (const color of Object.values(DETROIT_TRANSIT_COLORS)) expect(color).toMatch(/^#[0-9A-F]{6}$/);
    expect(DETROIT_TRANSIT_COLORS.QLINE).toBe('#EF4D2E');
    // Names two systems share in different colours are left to the feature's own colour.
    expect(DETROIT_TRANSIT_COLORS).not.toHaveProperty('Greenfield');
  });

  it('railroad owner and ownership-type lists cover every value in the export', () => {
    const owners = DETROIT_RAILROAD_OWNERS.map((o) => o.key);
    const types = DETROIT_RAILROAD_OWNERSHIP_TYPES.map((t) => t.key);
    // O(k) time, O(1) space — k = owner marks
    for (const mark of Object.keys(DETROIT_RAILROAD_OWNER_COUNTS)) expect(owners, mark).toContain(mark);
    // O(k) time, O(1) space — k = ownership types
    for (const kind of Object.keys(DETROIT_RAILROAD_OWNER_TYPE_COUNTS)) expect(types, kind).toContain(kind);
  });

  it('POI category counts come from the export', () => {
    expect(DETROIT_PROFILE.poiCategoryCounts).toBe(DETROIT_POI_COUNTS);
    expect(DETROIT_POI_COUNTS.church).toBeGreaterThan(0);
  });
});

describe('Detroit popups', () => {
  it('are keyed by style layer id', () => {
    expect(Object.keys(DETROIT_POPUPS).sort()).toEqual([
      'abandoned_blight-blight-points',
      'council_districts-fill',
      'dlba_properties-points',
      'neighborhoods-fill',
      'police_precincts-fill',
    ]);
  });

  it('escape every tile value', () => {
    const evil = '<img src=x onerror=alert(1)>';
    // O(b) time, O(1) space — b = builders (5)
    for (const html of [
      blightPopup({ address: evil, violation_description: evil }),
      dlbaPopup({ address: evil, status: evil }),
      neighborhoodPopup({ name: evil, council_district: evil }),
    ]) {
      expect(html).not.toContain('<img');
      expect(html).toContain('&lt;img');
    }
  });

  it('only links neighborhood pages over https', () => {
    expect(neighborhoodPopup({ name: 'X', website: 'javascript:alert(1)' })).not.toContain('href');
    expect(neighborhoodPopup({ name: 'X', website: 'https://theneighborhoods.org/x' })).toContain('href="https://theneighborhoods.org/x"');
  });
});

describe('Detroit focus areas', () => {
  const fc = (prop: string, ids: string[]): GeoJSON.FeatureCollection => ({
    type: 'FeatureCollection',
    // O(n) time, O(n) space — n = ids
    features: ids.map((id) => ({
      type: 'Feature',
      properties: { [prop]: id },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    })),
  });

  it('loads the three boundary files and labels options numerically', async () => {
    const urls: string[] = [];
    const index = await loadDetroitBoundaries(async (url) => {
      urls.push(url);
      if (url.endsWith('zip_codes.geojson')) return fc('zip_code', ['48226', '48201']);
      if (url.endsWith('police_precincts.geojson')) return fc('precinct', ['10', '2', '9']);
      return fc('district_number', ['7', '1']);
    });
    expect(urls.sort()).toEqual([
      './data/detroit/council_districts.geojson',
      './data/detroit/police_precincts.geojson',
      './data/detroit/zip_codes.geojson',
    ]);
    const options = detroitAreaOptions(index);
    expect(options.police.map((o) => o.label)).toEqual(['Precinct 2', 'Precinct 9', 'Precinct 10']);
    expect(options.ward.map((o) => o.label)).toEqual(['District 1', 'District 7']);
    expect(options.zip.map((o) => o.id)).toEqual(['48201', '48226']);
    expect(DETROIT_PROFILE.focus?.kindLabels.ward).toBe('Council districts');
  });
});

describe('Detroit contacts', () => {
  it('DetroitParcelOwnerSource maps taxpayer fields to OwnerContact', async () => {
    const urls: string[] = [];
    const source = new DetroitParcelOwnerSource(async (url) => {
      urls.push(url);
      return {
        features: [
          { attributes: { parcel_id: '02002017-8', zip_code: '48226', taxpayer_1: '5725 WALNUT LLC', taxpayer_address: '630 WOODWARD AVE', taxpayer_city: 'DETROIT', taxpayer_state: 'MI', taxpayer_zip_code: '48226' } },
          { attributes: { parcel_id: '02002017-9', taxpayer_1: '5725 WALNUT LLC', taxpayer_address: '630 WOODWARD AVE' } },
        ],
      };
    });
    const owners = await source.findOwners('525 Griswold St');
    expect(urls[0].startsWith(DETROIT_PARCELS_QUERY_URL)).toBe(true);
    expect(new URL(urls[0]).searchParams.get('where')).toBe("address IN ('525 GRISWOLD ST','525 GRISWOLD')");
    expect(owners).toHaveLength(1); // same owner + street → deduped
    expect(owners[0]).toMatchObject({
      name: '5725 WALNUT LLC',
      pin: '02002017-8',
      propertyZip: '48226',
      isCompany: true,
      ownerAddress: { street: '630 WOODWARD AVE', city: 'DETROIT', state: 'MI', zip: '48226' },
    });
  });

  it('address is normalised and quote-escaped before it reaches the ArcGIS where clause', async () => {
    expect(sqlString("O'BRIEN")).toBe("'O''BRIEN'");
    expect(addressCandidates("1 x' OR '1'='1 st")).toEqual(['1 X OR 1 1 ST', '1 X OR 1 1']);
    let where = '';
    await new DetroitParcelOwnerSource(async (url) => {
      where = new URL(url).searchParams.get('where') ?? '';
      return { features: [] };
    }).findOwners("12 O'Hara'); DROP TABLE x;--");
    expect(where).not.toContain(';');
    // Every quote in the clause is a literal delimiter; '--' left inside the literal is inert.
    expect(where).toBe("address IN ('12 O HARA DROP TABLE X --')");
  });

  it('DetroitBusinessLicenseSource matches by address, merging licences of one business', async () => {
    let url = '';
    const source = new DetroitBusinessLicenseSource(async (u) => {
      url = u;
      return {
        features: [
          { attributes: { record_id: 'BUS1', business_name: 'PRIME PARKING LLC', address: '200 W Columbia St', license_type: 'Parking Lot License', zip_code: '48201' } },
          { attributes: { record_id: 'BUS2', business_name: 'PRIME PARKING LLC', address: '200 W Columbia St', license_type: 'Valet License', zip_code: '48201' } },
        ],
      };
    });
    const found = await source.findBusinesses('200 W Columbia St', [-83.05, 42.33]);
    expect(url.startsWith(DETROIT_LICENSES_QUERY_URL)).toBe(true);
    expect(new URL(url).searchParams.get('where')).toContain('UPPER(address) IN');
    expect(found).toHaveLength(1);
    expect(found[0].activity).toBe('Parking Lot License | Valet License');
  });

  it('DetroitBusinessLicenseSource falls back to a point query when address is empty', async () => {
    let params = new URLSearchParams();
    await new DetroitBusinessLicenseSource(async (u) => {
      params = new URL(u).searchParams;
      return { features: [] };
    }).findBusinesses('', [-83.05524, 42.337062]);
    expect(params.get('where')).toBe('1=1');
    expect(params.get('geometry')).toBe('-83.05524,42.337062');
    expect(params.get('distance')).toBe('30');
    expect(params.get('units')).toBe('esriSRUnit_Meter');
  });

  it('CSV rows use DETROIT, MI — never CHICAGO, IL', () => {
    const sources = detroitContactSources(async () => ({ features: [] }));
    expect(sources.postalCity).toBe('DETROIT');
    expect(sources.postalState).toBe('MI');
    expect(sources.corporationSearchUrl('ACME LLC')).toContain('lara.state.mi.us');
    expect(DETROIT_PROFILE.contacts?.postalState).toBe('MI');
  });
});
