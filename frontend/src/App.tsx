import './App.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { MapContainer } from './map/MapContainer';
import type { BuildingSelectInfo, ClickedBuildingInfo } from './map/MapContainer';
import { LayerPanel } from './map/controls/LayerPanel';
import { BuildingLegend } from './map/controls/BuildingLegend';
import { POIListPanel } from './map/controls/POIListPanel';
import { SubFilterPanel } from './map/controls/SubFilterPanel';
import { POICategoryFilter } from './map/controls/POICategoryFilter';
import { SanbornAdjust } from './map/controls/SanbornAdjust';
import { POIBrowsePanel } from './map/controls/POIBrowsePanel';
import { CitySelector } from './map/controls/CitySelector';
import { ToolsPanel } from './map/controls/ToolsPanel';
import { FocusAreaPanel } from './focus/FocusAreaPanel';
import { useFocusArea } from './focus/useFocusArea';
import { ContactListPanel } from './contacts/ContactListPanel';
import { useContactList } from './contacts/useContactList';
import { DiscoveryPanel } from './discovery/DiscoveryPanel';
import { useDiscovery } from './discovery/useDiscovery';
import { toLayerSnapshot, useMapLayers } from './map/hooks/useMapLayers';
import { SavedSearchesPanel } from './presets/SavedSearchesPanel';
import { useSavedSearches } from './presets/useSavedSearches';
import { useSearchAdapter } from './presets/SearchStateContext';
import { BuildingDetail } from './panels/BuildingDetail';
import { InteriorViewer } from './interior/InteriorViewer';
import { getBuilding } from './api/buildings';
import { getCity } from './api/cities';
import { getCityDefaults } from './utils/geoUtils';
import type { Building } from './types/building';
import type { City } from './types/city';
import { getCityProfile } from './cities/registry';

/** Read city slug from URL search params (e.g., ?city=detroit), default to chicago */
// O(q) time, O(q) space — q = length of the URL query string (parsed once)
function getCitySlugFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('city') ?? 'chicago';
}

// O(L) time, O(L) space — L = map layers (per render: snapshot memo + Sanborn lookup, child panels carry their own bounds)
function App() {
  const [citySlug, setCitySlug] = useState<string>(getCitySlugFromUrl);
  const [cityConfig, setCityConfig] = useState<City | null>(null);

  const layerControls = useMapLayers(citySlug);
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);
  const [selectedBuilding, setSelectedBuilding] = useState<Building | null>(null);
  const [showInterior, setShowInterior] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);

  // Focus areas come from the city profile (Chicago: zips/districts/wards; Detroit:
  // zips/precincts/council districts; Dayton: zips/police areas/neighborhoods).
  const cityProfile = getCityProfile(citySlug);
  const focusConfig = cityProfile?.focus ?? null;
  const focusEnabled = focusConfig !== null;
  const focus = useFocusArea(mapInstance, focusConfig, citySlug);
  const contacts = useContactList(mapInstance, citySlug);
  // Free business-type browser → curated buildings → paid lookups (Chicago data only).
  const discovery = useDiscovery(mapInstance, focus.selection, contacts.store, contacts.batchRunner);

  // Saved searches: layers and focus areas live in their own hooks, so they join presets
  // through adapters; the filter panels store their state in the search store directly.
  // Section keys are persisted in saved presets — never rename them.
  const layerSnapshot = useMemo(() => toLayerSnapshot(layerControls.layers), [layerControls.layers]);
  useSearchAdapter('layers', layerSnapshot, layerControls.applySnapshot);
  useSearchAdapter('focus', focus.selection, focus.replace);
  const savedSearches = useSavedSearches(mapInstance, citySlug);

  const handleBuildingSelect = useCallback(
    (info: BuildingSelectInfo) => contacts.store.toggle(info),
    [contacts.store],
  );

  // Fetch city config from API when slug changes
  useEffect(() => {
    let cancelled = false;
    getCity(citySlug)
      .then((city) => {
        if (!cancelled) setCityConfig(city);
      })
      .catch(() => {
        // Fallback to static defaults if API unavailable
        if (!cancelled) setCityConfig(null);
      });
    return () => { cancelled = true; };
  }, [citySlug]);

  // Compute map center/zoom from API data or static fallback
  const defaults = getCityDefaults(citySlug);
  const cityCenter: [number, number] = cityConfig
    ? [cityConfig.center_lng, cityConfig.center_lat]
    : defaults.center;
  const cityZoom = cityConfig?.default_zoom ?? defaults.zoom;

  const handleCityChange = useCallback((slug: string) => {
    setCitySlug(slug);
    setSelectedBuilding(null);
    setShowInterior(null);
    // Update URL without reload
    const url = new URL(window.location.href);
    url.searchParams.set('city', slug);
    window.history.pushState({}, '', url.toString());
  }, []);

  const handleBuildingClick = useCallback(async (info: ClickedBuildingInfo) => {
    try {
      const building = await getBuilding(info.id);
      setSelectedBuilding(building);
      setShowInterior(null);
    } catch {
      setSelectedBuilding({
        id: info.id,
        ...info.properties,
      } as unknown as Building);
    }
  }, []);

  const handleViewInterior = useCallback((buildingId: string) => {
    setShowInterior(buildingId);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedBuilding(null);
    setShowInterior(null);
  }, []);

  const handleCloseInterior = useCallback(() => {
    setShowInterior(null);
  }, []);

  // O(L) time, O(1) space — L = map layers, scanned for the Sanborn toggle
  const sanbornVisible = layerControls.layers.find(l => l.id === 'sanborn')?.visible ?? false;

  return (
    <div className="app">
      <CitySelector currentCitySlug={citySlug} onChange={handleCityChange} />
      <LayerPanel layerControls={layerControls}>
        <SubFilterPanel map={mapInstance} layers={layerControls.layers} citySlug={citySlug} />
      </LayerPanel>
      <MapContainer
        layers={layerControls.layers}
        citySlug={citySlug}
        cityCenter={cityCenter}
        cityZoom={cityZoom}
        onMapReady={setMapInstance}
        onBuildingClick={handleBuildingClick}
        selectionMode={selectionMode}
        onBuildingSelect={handleBuildingSelect}
        onCandidateClick={discovery.removeCandidate}
      />
      <ToolsPanel badge={contacts.buildings.length}>
        <SavedSearchesPanel saved={savedSearches} />
        {focusEnabled && <FocusAreaPanel focus={focus} />}
        {/* Discovery's business directory is Chicago's licence data (discovery/businessDirectory.ts). */}
        {citySlug === 'chicago' && <DiscoveryPanel discovery={discovery} />}
        <ContactListPanel
          store={contacts.store}
          buildings={contacts.buildings}
          selectionMode={selectionMode}
          onToggleSelectionMode={() => setSelectionMode((v) => !v)}
          lookupAvailable={contacts.lookupAvailable}
          batchRunner={contacts.batchRunner}
          batch={contacts.batch}
        />
      </ToolsPanel>
      <BuildingLegend map={mapInstance} />
      <POIListPanel mapInstance={mapInstance} />
      <POICategoryFilter map={mapInstance} citySlug={citySlug} />
      <POIBrowsePanel map={mapInstance} citySlug={citySlug} />
      <SanbornAdjust
        map={mapInstance}
        visible={sanbornVisible}
      />

      {selectedBuilding && !showInterior && (
        <BuildingDetail
          building={selectedBuilding}
          onClose={handleCloseDetail}
          onViewInterior={handleViewInterior}
        />
      )}

      {showInterior && (
        <InteriorViewer
          buildingId={showInterior}
          mapInstance={mapInstance}
          onClose={handleCloseInterior}
        />
      )}
    </div>
  );
}

export default App;
