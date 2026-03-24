/**
 * Static mode flag — when true, the frontend uses local PMTiles/GeoJSON
 * files instead of Martin tile server and backend API endpoints.
 *
 * Set via VITE_STATIC_MODE=true at build time.
 */
export const IS_STATIC = import.meta.env.VITE_STATIC_MODE === 'true';
