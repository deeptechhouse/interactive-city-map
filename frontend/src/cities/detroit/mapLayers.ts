/**
 * RETIRED (2026-10-02) — intentionally exports nothing.
 *
 * This file held skeleton stubs for Detroit-only MapLibre layer adders (parks from the
 * `parks` source-layer, DPD precinct outlines, city-switch layer removal). The multi-city
 * build moved all three into shared code instead, so no city needs its own adder:
 *   - parks       → shared park layer + CityProfile.sourceLayers.parks = 'parks'
 *   - precincts   → shared boundary layer (map/layers/BoundaryLayer.ts)
 *   - city switch → map/cityLayerLifecycle.ts
 * Nothing imports this module. Delete it once the lead confirms the shared versions.
 */
export {};
