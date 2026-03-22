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
| `backend/app/routes/` | API Interface | FastAPI route handlers (buildings, cities, pois, search, floor_plans, railroads, interior) |
| `backend/app/adapters/` | Integration | Swappable adapters for storage (S3/MinIO), geocoder (Pelias), POI fetcher (Foursquare) |
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
| Foursquare API | POI supplementary data | Yes (Overpass/OSM — via POI fetcher adapter) |
| MapLibre GL JS | Frontend map rendering | Replaceable but central to frontend |
| PMTiles | Static historical map tile format | Format-level dependency |
| Protomaps | Basemap tile theme | Swappable basemap source |
| OpenCV (headless) | Floor plan image processing | No (core to extraction) |
| Tesseract (pytesseract) | OCR text extraction from floor plans | Yes (EasyOCR) |
| scikit-learn | Floor plan binary classifier (SVM) | Yes (any ML framework) |
| Playwright | JS-rendered venue website scraping | Yes (Selenium) |
| BeautifulSoup4 | HTML parsing for venue scraper | Yes (lxml) |
