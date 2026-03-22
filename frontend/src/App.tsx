import './App.css';
import { MapContainer } from './map/MapContainer';
import { LayerPanel } from './map/controls/LayerPanel';
import { useMapLayers } from './map/hooks/useMapLayers';

function App() {
  const layerControls = useMapLayers();

  return (
    <div className="app">
      <LayerPanel layerControls={layerControls} />
      <MapContainer layers={layerControls.layers} />
    </div>
  );
}

export default App;
