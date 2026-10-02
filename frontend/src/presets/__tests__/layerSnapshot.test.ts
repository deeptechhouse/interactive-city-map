import { describe, expect, it } from 'vitest';
import { applyLayerSnapshot, toLayerSnapshot } from '../../map/hooks/useMapLayers';
import type { LayerState } from '../../types/layer';

const layers: LayerState[] = [
  { id: 'zoning', name: 'Zoning', group: 'zoning', visible: false, opacity: 1 },
  { id: 'pois', name: 'POIs', group: 'poi', visible: true, opacity: 0.5 },
];

describe('layer snapshot', () => {
  it('round-trips visibility and opacity', () => {
    const snap = toLayerSnapshot(layers);
    const changed = layers.map((l) => ({ ...l, visible: !l.visible, opacity: 0.2 }));
    expect(applyLayerSnapshot(changed, snap)).toEqual(layers);
  });

  it('ignores unknown ids, keeps layers missing from the snapshot, clamps opacity', () => {
    const out = applyLayerSnapshot(layers, {
      zoning: { visible: true, opacity: 7 },
      gone_layer: { visible: true, opacity: 1 },
    });
    expect(out[0]).toMatchObject({ visible: true, opacity: 1 });
    expect(out[1]).toEqual(layers[1]);
  });

  it('ignores malformed input', () => {
    expect(applyLayerSnapshot(layers, 'x')).toEqual(layers);
    expect(applyLayerSnapshot(layers, { zoning: { visible: 'yes', opacity: NaN } })).toEqual(layers);
  });
});
