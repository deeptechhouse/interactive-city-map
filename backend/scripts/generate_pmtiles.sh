#!/bin/bash
# =============================================================================
# Generate PMTiles from PostGIS for static map layers
#
# Requires:
#   - tippecanoe (brew install tippecanoe)
#   - ogr2ogr (from GDAL — brew install gdal)
#
# Usage:
#   ./generate_pmtiles.sh <db_url> <output_dir>
#
# Example:
#   ./generate_pmtiles.sh "postgresql://citymap:citymap@localhost:5433/citymap" ./tiles
# =============================================================================

set -euo pipefail

DB_URL="${1:?Usage: $0 <db_url> <output_dir>}"
OUTPUT_DIR="${2:?Usage: $0 <db_url> <output_dir>}"

mkdir -p "$OUTPUT_DIR"

echo "=== PMTiles Generation ==="
echo "DB:     $DB_URL"
echo "Output: $OUTPUT_DIR"
echo ""

# Check dependencies
for cmd in ogr2ogr tippecanoe; do
    if ! command -v "$cmd" &>/dev/null; then
        echo "ERROR: $cmd is not installed. Install it first."
        echo "  brew install $([ "$cmd" = "ogr2ogr" ] && echo "gdal" || echo "$cmd")"
        exit 1
    fi
done

# --- Export and convert each layer ---

# Zoning Districts
echo "[1/3] Exporting zoning_districts..."
ogr2ogr -f GeoJSON "$OUTPUT_DIR/zoning.geojson" \
    PG:"$DB_URL" \
    -sql "SELECT id, zone_code, zone_class, zone_name, geom FROM zoning_districts"

if [ -s "$OUTPUT_DIR/zoning.geojson" ]; then
    echo "       Converting to PMTiles..."
    tippecanoe \
        -o "$OUTPUT_DIR/zoning.pmtiles" \
        --force \
        --name="zoning" \
        --layer="zoning_districts" \
        --minimum-zoom=10 \
        --maximum-zoom=16 \
        --no-feature-limit \
        --no-tile-size-limit \
        "$OUTPUT_DIR/zoning.geojson"
    echo "       Done: $OUTPUT_DIR/zoning.pmtiles"
else
    echo "       No zoning data found, skipping."
fi

# Parcels
echo "[2/3] Exporting parcels..."
ogr2ogr -f GeoJSON "$OUTPUT_DIR/parcels.geojson" \
    PG:"$DB_URL" \
    -sql "SELECT id, pin, address, land_use, geom FROM parcels"

if [ -s "$OUTPUT_DIR/parcels.geojson" ]; then
    echo "       Converting to PMTiles..."
    tippecanoe \
        -o "$OUTPUT_DIR/parcels.pmtiles" \
        --force \
        --name="parcels" \
        --layer="parcels" \
        --minimum-zoom=13 \
        --maximum-zoom=17 \
        --no-feature-limit \
        --no-tile-size-limit \
        --drop-densest-as-needed \
        "$OUTPUT_DIR/parcels.geojson"
    echo "       Done: $OUTPUT_DIR/parcels.pmtiles"
else
    echo "       No parcel data found, skipping."
fi

# Buildings (large dataset — use drop-densest for lower zooms)
echo "[3/3] Exporting buildings..."
ogr2ogr -f GeoJSON "$OUTPUT_DIR/buildings.geojson" \
    PG:"$DB_URL" \
    -sql "SELECT id, address, name, year_built, floors, geom FROM buildings"

if [ -s "$OUTPUT_DIR/buildings.geojson" ]; then
    echo "       Converting to PMTiles..."
    tippecanoe \
        -o "$OUTPUT_DIR/buildings.pmtiles" \
        --force \
        --name="buildings" \
        --layer="buildings" \
        --minimum-zoom=13 \
        --maximum-zoom=17 \
        --no-feature-limit \
        --no-tile-size-limit \
        --drop-densest-as-needed \
        "$OUTPUT_DIR/buildings.geojson"
    echo "       Done: $OUTPUT_DIR/buildings.pmtiles"
else
    echo "       No building data found, skipping."
fi

# Clean up intermediate GeoJSON files
echo ""
echo "Cleaning up intermediate GeoJSON files..."
rm -f "$OUTPUT_DIR"/*.geojson

echo ""
echo "=== PMTiles generation complete ==="
ls -lh "$OUTPUT_DIR"/*.pmtiles 2>/dev/null || echo "No PMTiles files generated."
