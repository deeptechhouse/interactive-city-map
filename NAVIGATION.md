# Interactive City Map — Navigation Map

> Multi-layer interactive map with historical overlays, building-level interactivity, and spatial data import pipelines.

## Architecture Overview

Layered architecture: React + MapLibre GL frontend communicates with a FastAPI backend backed by PostgreSQL + PostGIS. Martin serves vector tiles directly from PostGIS tables. MinIO provides S3-compatible object storage for raster tiles, Sanborn map overlays, and floor plan images. PMTiles are used for static/historical map overlays. The data import pipeline ingests open geospatial data (buildings, parcels, zoning, transit, etc.) from city data portals into PostGIS via configurable YAML-driven importers.

## Directory Map

| Directory | Layer/Role | Description |
|---|---|---|
| `backend/` | Backend Root | FastAPI application, data import pipeline, migrations |
| `backend/app/` | Application | Main FastAPI app package |
| `backend/app/models/` | Data Layer | SQLAlchemy + GeoAlchemy2 models (building, city, parcel, poi, floor_plan, railroad, transit, waterway, zoning, interior_source, interior_room, interior_wall, interior_feature, scrape_target) |
| `backend/app/schemas/` | Data Transfer | Pydantic request/response schemas (building, city, floor_plan, poi, search, interior) |
| `backend/app/services/` | Business Logic | Service classes for buildings, floor plans, geocoding, POIs, search, interior CRUD, interior sources, georeferencing |
| `backend/app/services/extractors/` | AI Pipeline | Floor plan extraction: LineDetector, RoomSegmenter, TextExtractor, SanbornParser, GeoJSONWriter |
| `backend/app/routes/` | API Interface | FastAPI route handlers (buildings, cities, pois, search, floor_plans, railroads, interior, contacts) |
| `backend/app/adapters/` | Integration | Swappable adapters for storage (S3/MinIO), geocoder (Pelias), POI fetcher (Foursquare), phone lookup (Google Places / Foursquare, chained), owner skip trace (Tracerfy; BatchData adapter present but disabled — no pay-per-call plan; `owner_lookup.py`), shared HTTP plumbing (`http_json.py`) |
| `backend/app/data_import/` | Pipeline | Spatial data import CLI — per-source importers with YAML city configs |
| `backend/app/data_import/interior/` | Interior Pipeline | Interior data importers: user upload processor, Sanborn cropper, county records enricher, OSM indoor importer |
| `backend/app/data_import/configs/` | Config | Per-city YAML configuration files (e.g., chicago.yaml) |
| `backend/alembic/` | Migrations | Alembic database migration scripts |
| `backend/alembic/versions/` | Migrations | Individual migration files |
| `backend/scripts/` | Utilities | SQL init scripts, PMTiles generation shell scripts |
| `backend/tests/` | Testing | pytest test suite for backend |
| `frontend/` | Frontend Root | React + TypeScript + Vite application |
| `frontend/src/` | Source | All frontend source code |
| `frontend/src/map/` | Map Engine | MapLibre container component and map subsystems |
| `frontend/src/map/controls/` | UI Controls | Map control components (SearchBar, LayerPanel, EraSelector, filters, toggles) |
| `frontend/src/map/hooks/` | React Hooks | Custom hooks for map click handling, layer management, search |
| `frontend/src/map/layers/` | Map Layers | Layer definitions (Building, POI, Park, Railroad, Sanborn, Transit, Waterway, Zoning, FloorPlan) |
| `frontend/src/presets/` | Feature | Saved searches — `searchState.ts` (store every filter writes to; snapshot/apply), `savedSearches.ts` (pure preset list ops), `useSavedSearches.ts` (localStorage + map), `SavedSearchesPanel.tsx` (UI in Tools) |
| `frontend/src/focus/` | Feature | Focus areas — union/intersection of selected zips, police districts, wards; gray mask over everything else (`focusGeometry.ts` is pure, `FocusMaskLayer.ts` is MapLibre wiring) |
| `frontend/src/contacts/` | Feature | Building contact list — click buildings, owner of record (Cook County) + licensed businesses (Chicago), phone via backend, CSV export |
| `frontend/src/panels/` | UI Panels | Detail/info panels (BuildingDetail, POIDetail, FloorPlanViewer, FloorPlanUpload, ExternalLinks) |
| `frontend/src/api/` | API Client | Typed fetch wrappers for backend endpoints (buildings, cities, floorPlans, pois, client) |
| `frontend/src/types/` | Type Defs | TypeScript interfaces (building, city, layer, poi) |
| `frontend/src/utils/` | Utilities | Color schemes, geo utility functions |
| `docs/` | Documentation | Guides and references (Sanborn georeferencing guide) |
| `.github/workflows/` | CI/CD | GitHub Actions pipeline |

## Key Entry Points

- **Backend start:** `backend/app/main.py` — FastAPI app with CORS, health check, and all route registrations
- **Backend config:** `backend/app/config.py` — Pydantic settings loaded from environment / `.env`
- **Database models:** `backend/app/models/__init__.py` — all SQLAlchemy model imports
- **API routes:** `backend/app/routes/` — each file registers a FastAPI `APIRouter`
- **Data import CLI:** `python -m app.data_import.run --city chicago` (run from `backend/`)
- **Contact-list phone API:** `backend/app/routes/contacts.py` → `services/phone_lookup_service.py` (cache, rate limit, per-city provider order) → `adapters/phone_lookup.py`
- **Phone/owner lookup server without Docker:** `backend/app/phone_app.py`, started with the map by `./start_map.sh`
- **Owner skip trace — batch (the GUI path):** `POST/GET /api/v1/contacts/owner/batch` → `services/owner_batch_service.py` (name trace 1 credit / address trace 2 credits / name misses re-sent by address) → `adapters/tracerfy_batch.py`; frontend `contacts/OwnerBatchRunner.ts`, name rules `contacts/ownerNames.ts`
- **Owner skip trace — instant (wired, hidden in GUI, 5 credits/hit):** `GET /api/v1/contacts/owner` → `services/owner_lookup_service.py` → `adapters/owner_lookup.py`
- **CSV to Desktop:** `POST /api/v1/contacts/export` → `backend/app/routes/exports.py` (local callers only, server-chosen filename, `CSV_EXPORT_DIR`, default `~/Desktop`); frontend `contacts/csvSave.ts` — runs automatically when an owner batch finishes and on Export CSV
- **Saved owner lookups (permanent, dated, private):** `services/owner_result_store.py` → `backend/data/owner_lookups.sqlite3` (gitignored, 0600)
- **Contact list (frontend):** `frontend/src/contacts/ContactListStore.ts` (state) · `ContactResolver.ts` (lookups) · `csvExport.ts`
- **Saved searches (frontend):** `frontend/src/presets/useSavedSearches.ts` · to make a new filter part of presets, use `useSearchSection(setSection(...))` instead of `useState` (see `searchState.ts` header)
- **Focus areas (frontend):** `frontend/src/focus/useFocusArea.ts` · zoning types: `frontend/src/utils/zoningTypes.ts`
- **Interior API:** `backend/app/routes/interior.py` — 13 endpoints for interior CRUD + extraction
- **Interior services:** `backend/app/services/interior_service.py`, `interior_source_service.py`, `georeferencing_service.py`
- **Extraction pipeline:** `backend/app/services/floor_plan_extractor.py` — orchestrates extractors → GeoJSON → DB
- **City config:** `backend/app/data_import/configs/chicago.yaml` — data sources and bounds for Chicago
- **Alembic migrations:** `backend/alembic.ini` + `backend/alembic/versions/`
- **Frontend start:** `frontend/src/main.tsx` — React entry point
- **Map container:** `frontend/src/map/MapContainer.tsx` — MapLibre GL initialization and layer orchestration
- **Martin config:** `martin.yaml` — vector tile server configuration (auto-publishes PostGIS tables)
- **Docker (dev):** `docker-compose.yml` — PostgreSQL + PostGIS, Martin, MinIO
- **Docker (prod):** `docker-compose.prod.yml` — full stack including backend and frontend containers
- **CI pipeline:** `.github/workflows/ci.yml` — lint, type-check, test, build

## Module Relationships

- **Frontend `api/`** calls **Backend `routes/`** via REST (`/api/v1/*`)
- **Routes** delegate to **Services** for business logic; routes never access models directly
- **Services** use **Adapters** for external I/O (S3 storage, geocoding, POI fetching)
- **Adapters** implement swappable interfaces — storage can switch from MinIO to AWS S3; geocoder from Pelias to Nominatim
- **Models** define PostGIS geometries via GeoAlchemy2; Alembic manages schema migrations
- **Martin** reads directly from PostGIS tables and serves them as vector tiles to the frontend
- **Frontend `map/layers/`** consume Martin vector tile endpoints and render via MapLibre GL
- **Frontend `map/controls/`** manage user interaction (search, layer toggles, filters) and pass state to layers via hooks
- **Frontend `panels/`** display detail views when a map feature is clicked, fetching data from `api/`
- **Data import pipeline** runs independently — reads city YAML configs, downloads open data, transforms geometries, and inserts into PostGIS

## External Dependencies

| Dependency | Purpose | Swappable? |
|---|---|---|
| PostgreSQL 16 + PostGIS 3.4 | Primary spatial data store | No (core to architecture) |
| Martin v0.14.2 | Vector tile server from PostGIS | Yes (pg_tileserv, Tegola) |
| MinIO | S3-compatible object storage for tiles and images | Yes (AWS S3, any S3-compatible — via storage adapter) |
| Pelias | Geocoding service | Yes (Nominatim — via geocoder adapter) |
| Foursquare API | POI supplementary data; contact-list phone fallback | Yes (Overpass/OSM — via POI fetcher adapter; phone via `PhoneLookupAdapter`) |
| Google Places API (New) | Contact-list business phone numbers (Chicago primary) | Yes (`PhoneLookupAdapter`; order set by `PHONE_LOOKUP_PROVIDERS*`) |
| Tracerfy (BatchData optional, disabled) | Owner skip trace — the person behind an owner/LLC, phones (with DNC flags), emails. Paid per hit, button-triggered | Yes (`OwnerLookupAdapter`; order set by `OWNER_LOOKUP_PROVIDERS`) |
| Cook County Assessor open data (3723-97qp) | Building owner of record + mailing address (browser, free) | Yes (`OwnerSource` in `contacts/publicRecords.ts`) |
| Chicago open data — active business licences (uupf-x98q) | Businesses at a building (browser, free) | Yes (`BusinessSource` in `contacts/publicRecords.ts`) |
| MapLibre GL JS | Frontend map rendering | Replaceable but central to frontend |
| PMTiles | Static historical map tile format | Format-level dependency |
| Protomaps | Basemap tile theme | Swappable basemap source |
| OpenCV (headless) | Floor plan image processing | No (core to extraction) |
| Tesseract (pytesseract) | OCR text extraction from floor plans | Yes (EasyOCR) |
| scikit-learn | Floor plan binary classifier (SVM) | Yes (any ML framework) |
| Playwright | JS-rendered venue website scraping | Yes (Selenium) |
| BeautifulSoup4 | HTML parsing for venue scraper | Yes (lxml) |
