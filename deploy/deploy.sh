#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Build and Deploy Interactive City Map to DreamHost
# =============================================================================
# Usage:
#   ./deploy/deploy.sh              Build and deploy
#   ./deploy/deploy.sh --build-only Build without uploading
#   ./deploy/deploy.sh --upload-only Upload existing build without rebuilding
#
# Prerequisites:
#   - Node.js (see .nvmrc for version)
#   - SSH access to DreamHost configured (key-based auth recommended)
#   - PMTiles files available locally or already on the server
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration — EDIT THESE VALUES
# ---------------------------------------------------------------------------
DREAMHOST_USER="your-username"
DREAMHOST_HOST="resistor.technology"
DREAMHOST_PATH="/home/${DREAMHOST_USER}/map.resistor.technology"

# Local paths (relative to project root)
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="${PROJECT_ROOT}/frontend"
BUILD_DIR="${FRONTEND_DIR}/dist"
DEPLOY_DIR="${PROJECT_ROOT}/deploy"
DATA_DIR="${PROJECT_ROOT}/data"

# Remote connection string
REMOTE="${DREAMHOST_USER}@${DREAMHOST_HOST}"

# ---------------------------------------------------------------------------
# Color output helpers
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
BUILD_ONLY=false
UPLOAD_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --build-only)  BUILD_ONLY=true ;;
    --upload-only) UPLOAD_ONLY=true ;;
    --help|-h)
      echo "Usage: $0 [--build-only|--upload-only|--help]"
      echo ""
      echo "  --build-only   Build the frontend without uploading"
      echo "  --upload-only  Upload existing build without rebuilding"
      echo "  --help         Show this help message"
      exit 0
      ;;
    *)
      error "Unknown argument: $arg"
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Step 1: Build the frontend
# ---------------------------------------------------------------------------
build_frontend() {
  info "Building frontend..."

  if [ ! -d "${FRONTEND_DIR}/node_modules" ]; then
    info "Installing dependencies..."
    (cd "${FRONTEND_DIR}" && npm ci)
  fi

  (cd "${FRONTEND_DIR}" && npm run build)

  if [ ! -d "${BUILD_DIR}" ]; then
    error "Build directory not found at ${BUILD_DIR}"
    error "Vite build may have failed."
    exit 1
  fi

  success "Frontend built successfully at ${BUILD_DIR}"
}

# ---------------------------------------------------------------------------
# Step 2: Copy deployment files into the build output
# ---------------------------------------------------------------------------
prepare_build() {
  info "Preparing build for deployment..."

  # Copy .htaccess into the build directory
  cp "${DEPLOY_DIR}/.htaccess" "${BUILD_DIR}/.htaccess"
  success "Copied .htaccess"

  # Copy PMTiles data files if they exist locally
  if [ -d "${DATA_DIR}" ]; then
    PMTILES_COUNT=$(find "${DATA_DIR}" -name "*.pmtiles" 2>/dev/null | wc -l | tr -d ' ')
    if [ "${PMTILES_COUNT}" -gt 0 ]; then
      mkdir -p "${BUILD_DIR}/data"
      cp "${DATA_DIR}"/*.pmtiles "${BUILD_DIR}/data/" 2>/dev/null || true
      success "Copied ${PMTILES_COUNT} PMTiles file(s) to build/data/"
    else
      warn "No .pmtiles files found in ${DATA_DIR}"
    fi
  else
    warn "No data/ directory found. PMTiles must be uploaded separately."
    warn "Create ${DATA_DIR} and place .pmtiles files there, or upload them manually."
  fi

  # Show build size
  BUILD_SIZE=$(du -sh "${BUILD_DIR}" | cut -f1)
  info "Total build size: ${BUILD_SIZE}"
}

# ---------------------------------------------------------------------------
# Step 3: Upload to DreamHost via rsync
# ---------------------------------------------------------------------------
upload_to_dreamhost() {
  info "Uploading to ${REMOTE}:${DREAMHOST_PATH}..."

  # Verify SSH connectivity first
  if ! ssh -o ConnectTimeout=10 -o BatchMode=yes "${REMOTE}" "echo ok" &>/dev/null; then
    error "Cannot connect to ${REMOTE}"
    error "Ensure SSH key-based auth is configured:"
    error "  ssh-copy-id ${REMOTE}"
    exit 1
  fi

  # Create remote directory if it doesn't exist
  ssh "${REMOTE}" "mkdir -p ${DREAMHOST_PATH}"

  # Rsync the build — delete remote files not in local build
  rsync -avz --delete \
    --exclude='.htpasswd' \
    --chmod=D755,F644 \
    "${BUILD_DIR}/" \
    "${REMOTE}:${DREAMHOST_PATH}/"

  success "Upload complete!"
  info "Site available at: https://map.resistor.technology"
}

# ---------------------------------------------------------------------------
# Step 4: Post-deployment verification
# ---------------------------------------------------------------------------
verify_deployment() {
  info "Verifying deployment..."

  # Check that index.html exists on remote
  if ssh "${REMOTE}" "test -f ${DREAMHOST_PATH}/index.html"; then
    success "index.html present on server"
  else
    error "index.html NOT found on server!"
    exit 1
  fi

  # Check .htaccess
  if ssh "${REMOTE}" "test -f ${DREAMHOST_PATH}/.htaccess"; then
    success ".htaccess present on server"
  else
    warn ".htaccess NOT found on server — password protection may not work"
  fi

  # Check .htpasswd
  if ssh "${REMOTE}" "test -f /home/${DREAMHOST_USER}/.htpasswd"; then
    success ".htpasswd found in home directory"
  else
    warn ".htpasswd NOT found — run on server: htpasswd -c /home/${DREAMHOST_USER}/.htpasswd yourusername"
  fi

  echo ""
  success "Deployment complete!"
  info "URL: https://map.resistor.technology"
  info ""
  info "If this is a first-time deploy, don't forget to:"
  info "  1. Create .htpasswd:  ssh ${REMOTE} 'htpasswd -c ~/.htpasswd yourusername'"
  info "  2. Update .htaccess AuthUserFile path with your actual DreamHost username"
  info "  3. Configure the subdomain in DreamHost panel (if not already done)"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
echo ""
echo "========================================="
echo " Interactive City Map — Deploy to DreamHost"
echo "========================================="
echo ""

if [ "$UPLOAD_ONLY" = true ]; then
  if [ ! -d "${BUILD_DIR}" ]; then
    error "No build found at ${BUILD_DIR}. Run without --upload-only first."
    exit 1
  fi
  upload_to_dreamhost
  verify_deployment
elif [ "$BUILD_ONLY" = true ]; then
  build_frontend
  prepare_build
  echo ""
  success "Build ready at: ${BUILD_DIR}"
  info "Run with --upload-only to deploy."
else
  build_frontend
  prepare_build
  upload_to_dreamhost
  verify_deployment
fi
