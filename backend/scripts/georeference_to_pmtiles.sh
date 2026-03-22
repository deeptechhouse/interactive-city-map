#!/bin/bash
# =============================================================================
# Sanborn Map Pipeline: Georeferenced GeoTIFF → Cloud Optimized GeoTIFF → PMTiles
#
# This script processes Sanborn fire insurance maps that have already been
# georeferenced in QGIS (see docs/sanborn_georeferencing_guide.html).
#
# Prerequisites:
#   - GDAL tools (gdal_translate, gdaladdo, gdal2tiles.py)
#       macOS:  brew install gdal
#       Ubuntu: sudo apt install gdal-bin python3-gdal
#   - go-pmtiles CLI (for converting tile directories to PMTiles)
#       go install github.com/protomaps/go-pmtiles/pmtiles@latest
#     OR install via Homebrew:
#       brew install pmtiles
#
# Usage:
#   ./georeference_to_pmtiles.sh <input_dir> <output_dir> [era_label]
#
# Arguments:
#   input_dir   Directory containing georeferenced GeoTIFF files (.tif)
#   output_dir  Directory where output PMTiles and intermediates are written
#   era_label   Optional label for the era (e.g. "1890s", "1905"). Defaults to
#               the input directory name.
#
# Input:  Directory of GeoTIFF files (already georeferenced in QGIS)
# Output: A single PMTiles file containing the raster tile pyramid for the era
#
# Example:
#   ./georeference_to_pmtiles.sh ./data/sanborn/1890s ./tiles "1890s"
# =============================================================================

set -euo pipefail

INPUT_DIR="${1:?Usage: $0 <input_dir> <output_dir> [era_label]}"
OUTPUT_DIR="${2:?Usage: $0 <input_dir> <output_dir> [era_label]}"
ERA_LABEL="${3:-$(basename "$INPUT_DIR")}"

# Intermediate directories
COG_DIR="$OUTPUT_DIR/cog_${ERA_LABEL}"
TILES_DIR="$OUTPUT_DIR/tiles_${ERA_LABEL}"

mkdir -p "$OUTPUT_DIR" "$COG_DIR" "$TILES_DIR"

echo "=== Sanborn Georeferenced → PMTiles Pipeline ==="
echo "Input:     $INPUT_DIR"
echo "Output:    $OUTPUT_DIR"
echo "Era:       $ERA_LABEL"
echo ""

# ------------------------------------------------------------------
# Step 0: Check dependencies
# ------------------------------------------------------------------
echo "[0/4] Checking dependencies..."
MISSING=0
for cmd in gdal_translate gdaladdo gdal2tiles.py; do
    if ! command -v "$cmd" &>/dev/null; then
        echo "  ERROR: $cmd not found. Install GDAL:"
        echo "    macOS:  brew install gdal"
        echo "    Ubuntu: sudo apt install gdal-bin python3-gdal"
        MISSING=1
    fi
done

# pmtiles CLI check — try both 'pmtiles' and 'go-pmtiles'
PMTILES_CMD=""
if command -v pmtiles &>/dev/null; then
    PMTILES_CMD="pmtiles"
elif command -v go-pmtiles &>/dev/null; then
    PMTILES_CMD="go-pmtiles"
fi

if [ -z "$PMTILES_CMD" ]; then
    echo "  ERROR: pmtiles CLI not found. Install one of:"
    echo "    brew install pmtiles"
    echo "    go install github.com/protomaps/go-pmtiles/pmtiles@latest"
    MISSING=1
fi

if [ "$MISSING" -eq 1 ]; then
    echo ""
    echo "Install missing dependencies and re-run."
    exit 1
fi

echo "  All dependencies found. pmtiles CLI: $PMTILES_CMD"
echo ""

# ------------------------------------------------------------------
# Step 1: Convert each GeoTIFF to Cloud Optimized GeoTIFF (COG)
# ------------------------------------------------------------------
echo "[1/4] Converting GeoTIFFs to Cloud Optimized GeoTIFFs..."
TIFF_COUNT=0
for tif in "$INPUT_DIR"/*.tif "$INPUT_DIR"/*.tiff; do
    [ -f "$tif" ] || continue
    BASENAME=$(basename "$tif" | sed 's/\.\(tiff\?\)$//')
    COG_PATH="$COG_DIR/${BASENAME}_cog.tif"

    if [ -f "$COG_PATH" ]; then
        echo "  Skip (exists): $COG_PATH"
    else
        echo "  Processing: $(basename "$tif") → COG"
        gdal_translate \
            -of COG \
            -co COMPRESS=JPEG \
            -co QUALITY=85 \
            -co BLOCKSIZE=512 \
            -co OVERVIEW_COMPRESS=JPEG \
            -co OVERVIEW_QUALITY=75 \
            "$tif" "$COG_PATH"
    fi
    TIFF_COUNT=$((TIFF_COUNT + 1))
done

if [ "$TIFF_COUNT" -eq 0 ]; then
    echo "  WARNING: No .tif/.tiff files found in $INPUT_DIR"
    echo "  Make sure your georeferenced GeoTIFFs are in the input directory."
    exit 1
fi

echo "  Processed $TIFF_COUNT GeoTIFFs"
echo ""

# ------------------------------------------------------------------
# Step 2: Build overviews (pyramids) for fast multi-zoom rendering
# ------------------------------------------------------------------
echo "[2/4] Building overviews (pyramids) for COGs..."
for cog in "$COG_DIR"/*_cog.tif; do
    [ -f "$cog" ] || continue
    echo "  Adding overviews: $(basename "$cog")"
    gdaladdo \
        --config COMPRESS_OVERVIEW JPEG \
        --config JPEG_QUALITY_OVERVIEW 75 \
        -r average \
        "$cog" \
        2 4 8 16 32
done
echo ""

# ------------------------------------------------------------------
# Step 3: Generate XYZ tile pyramid using gdal2tiles.py
# ------------------------------------------------------------------
echo "[3/4] Generating tile pyramid with gdal2tiles.py..."

# If multiple COGs, build a VRT mosaic first
COG_FILES=("$COG_DIR"/*_cog.tif)
if [ "${#COG_FILES[@]}" -gt 1 ]; then
    echo "  Building VRT mosaic from ${#COG_FILES[@]} COGs..."
    VRT_PATH="$COG_DIR/mosaic_${ERA_LABEL}.vrt"
    gdalbuildvrt "$VRT_PATH" "${COG_FILES[@]}"
    TILE_INPUT="$VRT_PATH"
else
    TILE_INPUT="${COG_FILES[0]}"
fi

gdal2tiles.py \
    --profile=mercator \
    --zoom=12-19 \
    --resampling=average \
    --processes="$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)" \
    --webviewer=none \
    "$TILE_INPUT" \
    "$TILES_DIR"

echo "  Tiles generated in $TILES_DIR"
echo ""

# ------------------------------------------------------------------
# Step 4: Package tiles into PMTiles format
# ------------------------------------------------------------------
echo "[4/4] Packaging tiles into PMTiles..."
PMTILES_OUTPUT="$OUTPUT_DIR/sanborn_${ERA_LABEL}.pmtiles"

# The pmtiles CLI can convert a directory of z/x/y tiles to PMTiles
$PMTILES_CMD convert "$TILES_DIR" "$PMTILES_OUTPUT"

echo "  Output: $PMTILES_OUTPUT"
echo ""

# ------------------------------------------------------------------
# Cleanup intermediate files (optional — uncomment to enable)
# ------------------------------------------------------------------
# echo "Cleaning up intermediate files..."
# rm -rf "$COG_DIR" "$TILES_DIR"

echo "=== Pipeline complete ==="
echo "PMTiles file: $PMTILES_OUTPUT"
ls -lh "$PMTILES_OUTPUT"
echo ""
echo "Serve this file with any static file server, or copy it to your"
echo "tile hosting directory. The frontend SanbornOverlay layer expects"
echo "the PMTiles URL in the era configuration."
