import './App.css';
import { useCallback, useEffect, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { MapContainer } from './map/MapContainer';
import type { ClickedBuildingInfo } from './map/MapContainer';
import { LayerPanel } from './map/controls/LayerPanel';
import { BuildingLegend } from './map/controls/BuildingLegend';
import { POIListPanel } from './map/controls/POIListPanel';
import { SubFilterPanel } from './map/controls/SubFilterPanel';
import { POICategoryFilter } from './map/controls/POICategoryFilter';
import { SanbornAdjust } from './map/controls/SanbornAdjust';
import { POIBrowsePanel } from './map/controls/POIBrowsePanel';
import { useMapLayers } from './map/hooks/useMapLayers';
import { BuildingDetail } from './panels/BuildingDetail';
import { InteriorViewer } from './interior/InteriorViewer';
import { getBuilding } from './api/buildings';
import type { Building } from './types/building';

function App() {
  const layerControls = useMapLayers();
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);
  const [selectedBuilding, setSelectedBuilding] = useState<Building | null>(null);
  const [showInterior, setShowInterior] = useState<string | null>(null); // building ID

  const handleBuildingClick = useCallback(async (info: ClickedBuildingInfo) => {
    try {
      const building = await getBuilding(info.id);
      setSelectedBuilding(building);
      setShowInterior(null);
    } catch {
      // If API fetch fails, build a minimal Building from popup properties
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

  return (
    <div className="app">
      <LayerPanel layerControls={layerControls} />
      <MapContainer
        layers={layerControls.layers}
        onMapReady={setMapInstance}
        onBuildingClick={handleBuildingClick}
      />
      <BuildingLegend map={mapInstance} />
      <POIListPanel mapInstance={mapInstance} />
      <SubFilterPanel map={mapInstance} layers={layerControls.layers} />
      <POICategoryFilter map={mapInstance} />
      <POIBrowsePanel map={mapInstance} />
      <SanbornAdjust
        map={mapInstance}
        visible={layerControls.layers.find(l => l.id === 'sanborn')?.visible ?? false}
      />

      {/* Building detail side panel */}
      {selectedBuilding && !showInterior && (
        <BuildingDetail
          building={selectedBuilding}
          onClose={handleCloseDetail}
          onViewInterior={handleViewInterior}
        />
      )}

      {/* Interior viewer (replaces detail panel when active) */}
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
