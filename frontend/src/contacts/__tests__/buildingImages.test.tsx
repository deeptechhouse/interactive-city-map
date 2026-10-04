// @vitest-environment happy-dom
/** Building photos on contact-list cards: free images inline, Google only in a pop-up. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BuildingPhotos } from '../BuildingPhotos';
import { buildingPin, fetchBuildingImages, imagesPath, wasSearched, type BuildingImagesAnswer } from '../buildingImages';
import { newOwner, type SelectedBuilding } from '../types';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const building = (pin = '17163110010000'): SelectedBuilding => ({
  id: 'b1', address: '500 W MADISON ST', lngLat: [-87.6359, 41.8789], status: 'ready', note: '', addedAt: 0,
  owners: [newOwner({ name: 'OWNER LLC', pin })], businesses: [],
});

const answer = (patch: Partial<BuildingImagesAnswer> = {}): BuildingImagesAnswer => ({
  facade: [{ kind: 'facade', source: 'Cook County Assessor', url: 'https://img/f.jpg', attribution: 'Photo: CCAO', link: '', captured: '2007', note: '' }],
  aerial: [
    { kind: 'aerial', source: 'Cook County 2025 aerial', url: 'https://img/a1.jpg', attribution: 'Cook GIS', link: '', captured: '2025', note: '' },
    { kind: 'aerial', source: 'USDA NAIP (USGS)', url: 'https://img/a2.jpg', attribution: 'USGS', link: '', captured: '', note: '' },
  ],
  google_maps_url: 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=41.878900,-87.635900',
  mapillary_configured: false,
  streetview_paid_enabled: false,
  streetview: null,
  ...patch,
});

const serve = (body: BuildingImagesAnswer) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body))));

describe('buildingImages client', () => {
  it('sends the Cook County PIN only for Chicago', () => {
    expect(buildingPin(building(), 'chicago')).toBe('17163110010000');
    expect(buildingPin(building(), 'detroit')).toBe('');
    expect(buildingPin(building('17'), 'chicago')).toBe(''); // not a 14-digit PIN
    expect(imagesPath('chicago', building())).toBe(
      '/images/building?city=chicago&lat=41.878900&lon=-87.635900&pin=17163110010000',
    );
    expect(imagesPath('dayton', building())).not.toContain('pin=');
  });

  it('asks nothing when there is no server', async () => {
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);
    expect(await fetchBuildingImages('chicago', building(), false, null)).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('BuildingPhotos', () => {
  it('shows the free facade and aerial with their credits', async () => {
    serve(answer());
    render(<BuildingPhotos city="chicago" b={building()} />);
    const facade = await screen.findByAltText('Street view of 500 W MADISON ST');
    expect(facade.getAttribute('src')).toBe('https://img/f.jpg');
    expect(screen.getByAltText('Aerial view of 500 W MADISON ST').getAttribute('src')).toBe('https://img/a1.jpg');
    expect(screen.getByText('Photo: CCAO')).toBeTruthy();
    expect(screen.queryByText(/Street View photo \(pop-up\)/)).toBeNull(); // paid option off
  });

  it('falls through to the next aerial when one fails to load', async () => {
    serve(answer());
    render(<BuildingPhotos city="chicago" b={building()} />);
    fireEvent.error(await screen.findByAltText('Aerial view of 500 W MADISON ST'));
    await waitFor(() =>
      expect(screen.getByAltText('Aerial view of 500 W MADISON ST').getAttribute('src')).toBe('https://img/a2.jpg'),
    );
  });

  it('opens Google Street View in a separate pop-up window, never inline', async () => {
    serve(answer({
      streetview_paid_enabled: true,
      streetview: { available: true, reason: 'free photo is from 2008', date: '2023-07', note: '', token: 'PASS1' },
    }));
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<BuildingPhotos city="chicago" b={building()} />);
    fireEvent.click(await screen.findByText('Google Street View ↗'));
    expect(open).toHaveBeenCalledWith(answer().google_maps_url, 'citymap-streetview', expect.stringContaining('popup'));
    fireEvent.click(screen.getByText('Street View photo (pop-up)'));
    expect(open.mock.calls[1][0]).toContain('/images/streetview/page?');
    expect(open.mock.calls[1][0]).toContain('token=PASS1'); // the single-use pass travels along
    expect(document.querySelector('img[src*="google"]')).toBeNull();
  });

  it('suggests a free Mapillary token when Detroit/Dayton have no street photo', async () => {
    serve(answer({ facade: [] }));
    render(<BuildingPhotos city="dayton" b={building()} />);
    expect(await screen.findByText(/free Mapillary token/)).toBeTruthy();
  });
});

describe('paid Street View: only after a search, only when the free photo is missing or poor', () => {
  it('a building counts as searched once its owner or business lookup has run', () => {
    const b = building();
    expect(wasSearched(b)).toBe(false);
    expect(wasSearched({ ...b, owners: [{ ...b.owners[0], skipTrace: 'pending' }] })).toBe(true);
    expect(imagesPath('chicago', b, true)).toContain('searched=true');
    expect(imagesPath('chicago', b)).not.toContain('searched');
  });

  it('asks the server with searched=true after a lookup, and offers the pop-up photo', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(answer({
      streetview_paid_enabled: true,
      streetview: { available: true, reason: 'free photo is from 2008', date: '2023-07', note: '' },
    }))));
    vi.stubGlobal('fetch', fetchFn);
    const b = building();
    render(<BuildingPhotos city="chicago" b={{ ...b, owners: [{ ...b.owners[0], skipTrace: 'found' }] }} />);
    expect(await screen.findByText('Street View photo (pop-up)')).toBeTruthy();
    expect(screen.getByText(/free photo is from 2008/)).toBeTruthy();
    expect(String((fetchFn.mock.calls[0] as unknown[])[0])).toContain('searched=true');
  });

  it('no paid button when the server made no offer (enabled, but not searched / good free photo)', async () => {
    serve(answer({ streetview_paid_enabled: true, streetview: null }));
    render(<BuildingPhotos city="chicago" b={building()} />);
    await screen.findByText('Google Street View ↗');
    expect(screen.queryByText('Street View photo (pop-up)')).toBeNull();
  });

  it('explains when Google has no imagery or the monthly free photos are used up', async () => {
    serve(answer({
      facade: [],
      streetview_paid_enabled: true,
      streetview: { available: false, reason: 'no free street-level photo', date: '', note: 'no Google Street View here' },
    }));
    render(<BuildingPhotos city="chicago" b={building()} />);
    expect(await screen.findByText('No free street-level photo; no Google Street View here.')).toBeTruthy();
    expect(screen.queryByText('Street View photo (pop-up)')).toBeNull();
  });
});

describe('Street View usage line (contact list)', () => {
  it('formats the month count, the limit, and an unreadable counter', async () => {
    const { usageText } = await import('../StreetViewUsageLine');
    expect(usageText({ enabled: true, used: 2, cap: 9500, month: '2026-10' })).toBe(
      'Google Street View photos this month: 2 of 9,500 free.',
    );
    expect(usageText({ enabled: true, used: 9500, cap: 9500, month: '2026-10' })).toContain('free limit reached');
    expect(usageText({ enabled: true, used: null, cap: 9500, month: '2026-10' })).toContain('paused');
    expect(usageText({ enabled: false, used: 0, cap: 9500, month: '2026-10' })).toBe('');
    expect(usageText(null)).toBe('');
  });

  it('shows under the heading and refreshes when the window regains focus', async () => {
    const { StreetViewUsageLine } = await import('../StreetViewUsageLine');
    let used = 2;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ enabled: true, used, cap: 9500, month: '2026-10' }))));
    render(<StreetViewUsageLine />);
    expect(await screen.findByText('Google Street View photos this month: 2 of 9,500 free.')).toBeTruthy();
    used = 3;
    window.dispatchEvent(new Event('focus'));
    expect(await screen.findByText('Google Street View photos this month: 3 of 9,500 free.')).toBeTruthy();
  });
});
