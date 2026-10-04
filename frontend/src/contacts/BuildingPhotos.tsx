/**
 * Photo strip on a contact-list card: a street-level photo and an aerial view of the
 * building from FREE public sources, plus Street View buttons that open Google in a
 * separate pop-up window (never inline — see buildingImages.ts for why).
 *
 * Loads when the card first renders (one free request per building, cached by the server
 * for an hour). Images that fail to load are skipped: a broken facade photo disappears,
 * a broken aerial falls through to the next source (county → NAIP).
 */
import React, { useEffect, useState } from 'react';
import {
  buildingPin,
  fetchBuildingImages,
  wasSearched,
  openGoogleStreetView,
  openPaidStreetView,
  type BuildingImagesAnswer,
  type ImageCandidate,
} from './buildingImages';
import type { SelectedBuilding } from './types';

type Load = { state: 'loading' } | { state: 'none' } | { state: 'ready'; data: BuildingImagesAnswer };

// O(1) time, O(1) space — n = 1 image with its credit line
const Figure: React.FC<{ img: ImageCandidate; alt: string; onError: () => void }> = ({ img, alt, onError }) => (
  <figure className="building-photo">
    <a href={img.link || img.url} target="_blank" rel="noopener noreferrer" title="Open larger">
      <img src={img.url} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={onError} />
    </a>
    <figcaption>
      {img.source}
      {img.captured ? ` · ${img.captured}` : ''}
      <br />
      <span className="building-photo__credit">{img.attribution}</span>
    </figcaption>
  </figure>
);

// O(c + o) time, O(1) space — c = image candidates (≤ 3); o = owner records (PIN lookup)
export const BuildingPhotos: React.FC<{ city: string; b: SelectedBuilding }> = ({ city, b }) => {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [facadeIdx, setFacadeIdx] = useState(0);
  const [aerialIdx, setAerialIdx] = useState(0);
  // Bumped after the paid photo is opened: its pass is single-use, so fetch a fresh offer.
  const [reload, setReload] = useState(0);
  const [lon, lat] = b.lngLat;
  // The Chicago PIN arrives with the owner record, so refetch when THE PIN WE SEND changes
  // (always '' in Detroit/Dayton, so owner edits there never refetch) — and once the
  // building has been searched, so the paid Street View offer can be considered.
  const pin = buildingPin(b, city);
  const searched = wasSearched(b);

  useEffect(() => {
    let cancelled = false;
    setLoad({ state: 'loading' });
    setFacadeIdx(0);
    setAerialIdx(0);
    fetchBuildingImages(city, b, searched)
      .then((data) => !cancelled && setLoad(data ? { state: 'ready', data } : { state: 'none' }))
      .catch(() => !cancelled && setLoad({ state: 'none' }));
    return () => {
      cancelled = true;
    };
    // b's identity changes on every list update; only position, PIN and city matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city, lat, lon, pin, searched, reload]);

  if (load.state === 'loading') return <p className="tools-hint">Loading photos…</p>;
  if (load.state === 'none') return null;
  const { data } = load;
  const facade = data.facade[facadeIdx];
  const aerial = data.aerial[aerialIdx];
  const title = b.address || 'this building';
  return (
    <div className="building-photos">
      <div className="building-photos__row">
        {facade && (
          <Figure img={facade} alt={`Street view of ${title}`} onError={() => setFacadeIdx((i) => i + 1)} />
        )}
        {aerial && <Figure img={aerial} alt={`Aerial view of ${title}`} onError={() => setAerialIdx((i) => i + 1)} />}
      </div>
      {!facade && (
        <p className="tools-hint">
          No free street-level photo here
          {!data.mapillary_configured && city !== 'chicago' ? ' (add a free Mapillary token in .env for street photos)' : ''}.
        </p>
      )}
      <div className="building-photos__actions">
        <button type="button" className="tools-link" onClick={() => openGoogleStreetView(data.google_maps_url)}>
          Google Street View ↗
        </button>
        {data.streetview?.available && (
          <button
            type="button"
            className="tools-link"
            onClick={() => {
              openPaidStreetView(b, data.streetview?.token ?? '');
              setReload((n) => n + 1);
            }}
            title={`Google Street View photo${data.streetview.date ? ` from ${data.streetview.date}` : ''} in a pop-up (within Google's free 10,000/month)`}
          >
            Street View photo (pop-up)
          </button>
        )}
      </div>
      {data.streetview && (
        <p className="tools-hint">
          {data.streetview.available
            ? `Google Street View photo available${data.streetview.date ? ` (${data.streetview.date})` : ''} — ${data.streetview.reason}.`
            : `${data.streetview.reason[0].toUpperCase()}${data.streetview.reason.slice(1)}; ${data.streetview.note}.`}
        </p>
      )}
    </div>
  );
};
