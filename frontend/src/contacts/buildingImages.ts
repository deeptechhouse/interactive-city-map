/**
 * Building photos for the contact list — client for GET /api/v1/images/building
 * (backend/app/routes/images.py → adapters/building_images.py).
 *
 * FREE FIRST (asked 2026-10-02): each city's free public sources — Cook County Assessor
 * photos + county aerials (Chicago), Detroit Street View on Mapillary + 2024 aerial
 * (Detroit), Mapillary + Montgomery County aerial (Dayton), USGS NAIP everywhere.
 * Google appears only as (a) a free link to Google's own Street View and (b) an optional
 * paid photo — both opened in a SEPARATE POP-UP WINDOW, because Google's terms forbid
 * Google imagery on the same screen as our (non-Google) map.
 *
 * Nothing is stored: image URLs are loaded live by the browser (county photos carry no
 * reuse licence; Mapillary URLs expire; Google forbids caching).
 *
 * PAID STREET VIEW RULE (asked 2026-10-02): offered only (1) after the building has been
 * through a lookup (`searched`), and (2) when its free street photo is missing or poor
 * (old / far away — backend paid_streetview_reason). The server then runs Google's FREE
 * coverage check; a photo is billed only when the user opens it in the pop-up, and the
 * server stops at a monthly cap inside Google's free 10,000.
 */
import { getJsonFrom, lookupApiBase } from './phoneLookup';
import type { SelectedBuilding } from './types';

export interface ImageCandidate {
  kind: 'facade' | 'aerial';
  source: string;
  url: string;
  attribution: string;
  link: string;
  captured: string;
  note: string;
}

/** The server's paid-photo offer for one building (null = not offered, Google not asked). */
export interface StreetViewOffer {
  available: boolean;
  /** Why the free photo isn't enough: "no free street-level photo", "free photo is from 2008". */
  reason: string;
  /** Google's capture month of the panorama, "2023-07". */
  date: string;
  /** Why it isn't available ("no Google Street View here", monthly cap reached). */
  note: string;
  /** Single-use pass the pop-up must present — the server bills a photo only with one. */
  token?: string;
}

export interface BuildingImagesAnswer {
  facade: ImageCandidate[];
  aerial: ImageCandidate[];
  google_maps_url: string;
  mapillary_configured: boolean;
  streetview_paid_enabled: boolean;
  streetview: StreetViewOffer | null;
}

/**
 * Has this building been through a lookup (owner skip trace or business phone search)?
 * Only then may the paid Street View photo be considered.
 * O(o + b) time, O(1) space — o = owners; b = businesses.
 */
export function wasSearched(b: SelectedBuilding): boolean {
  // O(o) time, O(1) space — o = owners
  if (b.owners.some((o) => o.skipTrace !== 'idle')) return true;
  // O(b) time, O(1) space — b = businesses
  return b.businesses.some((x) => x.phoneStatus === 'found' || x.phoneStatus === 'not_found');
}

/**
 * Cook County PIN for the building (Chicago): the first owner record's 14-digit PIN.
 * Other cities' PINs aren't used by any image source, so '' there.
 * O(o) time, O(1) space — o = owner records.
 */
export function buildingPin(b: SelectedBuilding, city: string): string {
  if (city !== 'chicago') return '';
  // O(o) time, O(1) space — o = owners
  const pin = b.owners.map((o) => o.pin.replace(/\D/g, '')).find((p) => p.length === 14);
  return pin ?? '';
}

/** O(1) time, O(1) space — n = 1 URL (fixed fields). */
export function imagesPath(city: string, b: SelectedBuilding, searched = false): string {
  const [lon, lat] = b.lngLat;
  const params = new URLSearchParams({ city, lat: lat.toFixed(6), lon: lon.toFixed(6) });
  const pin = buildingPin(b, city);
  if (pin) params.set('pin', pin);
  if (searched) params.set('searched', 'true');
  return `/images/building?${params.toString()}`;
}

/**
 * One building's images, or null when there's no server to ask (pure static build).
 * O(b) time, O(b) space — b = response size (a handful of candidates).
 */
export async function fetchBuildingImages(
  city: string,
  b: SelectedBuilding,
  searched = false,
  base: string | null = lookupApiBase(),
): Promise<BuildingImagesAnswer | null> {
  if (base === null) return null;
  return getJsonFrom(base)<BuildingImagesAnswer>(imagesPath(city, b, searched));
}

// ADJUSTABLE: pop-up window size for Street View (Google's own page or our paid-photo page).
const POPUP_FEATURES = 'popup=yes,width=960,height=680,noopener,noreferrer';

/** Open Google's free Street View for the building in its own window. O(1) time, O(1) space — n = 1 window. */
export function openGoogleStreetView(url: string): void {
  window.open(url, 'citymap-streetview', POPUP_FEATURES);
}

/**
 * Open OUR pop-up page that shows the PAID Street View photo. `token` is the single-use pass
 * from the server's offer (backend services/streetview_offers.py) — without it nothing is
 * billed. O(1) time, O(1) space — n = 1 window.
 */
export function openPaidStreetView(
  b: SelectedBuilding,
  token: string,
  base: string | null = lookupApiBase(),
): void {
  if (base === null) return;
  const [lon, lat] = b.lngLat;
  const params = new URLSearchParams({
    lat: lat.toFixed(6),
    lon: lon.toFixed(6),
    title: b.address || 'Building',
    token,
  });
  window.open(`${base}/images/streetview/page?${params.toString()}`, 'citymap-streetview-photo', POPUP_FEATURES);
}
