import './App.css';
import { useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { MapContainer } from './map/MapContainer';
import { LayerPanel } from './map/controls/LayerPanel';
import { BuildingLegend } from './map/controls/BuildingLegend';
import { POIListPanel } from './map/controls/POIListPanel';
import { useMapLayers } from './map/hooks/useMapLayers';

function App() {
  const layerControls = useMapLayers();
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);

  return (
    <div className="app">
      <LayerPanel layerControls={layerControls} />
      <MapContainer layers={layerControls.layers} onMapReady={setMapInstance} />
      <BuildingLegend />
      <POIListPanel mapInstance={mapInstance} />
    </div>
  );
}

export default App;
