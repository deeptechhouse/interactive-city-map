/**
 * Static mode flag — when true, the frontend uses local PMTiles/GeoJSON
 * files instead of Martin tile server and backend API endpoints.
 *
 * Set via VITE_STATIC_MODE=true at build time.
 */
export const IS_STATIC = import.meta.env.VITE_STATIC_MODE === 'true';

/**
 * Building interiors (floor plans, rooms, walls) live in the PostGIS database, which only
 * the full backend serves. The map runs in static mode (no database — see map_server.py),
 * so interiors can't load there. The building tiles still carry `has_interior: true` from
 * the database export, which used to show "View Interior" and then fail with
 * "API Error 0 … API unavailable in static mode" (reported 2026-10-02). Everything that
 * offers an interior checks this flag instead.
 */
export const INTERIORS_AVAILABLE = !IS_STATIC;
