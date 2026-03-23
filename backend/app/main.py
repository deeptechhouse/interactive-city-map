from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings

app = FastAPI(
    title="Interactive City Map API",
    description="Multi-layer interactive map with historical overlays and building-level interactivity",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


from app.routes import cities, buildings, pois, search, floor_plans, railroads, interior
from app.routes import interior_contributions

app.include_router(cities.router, prefix="/api/v1")
app.include_router(buildings.router, prefix="/api/v1")
app.include_router(pois.router, prefix="/api/v1")
app.include_router(search.router, prefix="/api/v1")
app.include_router(floor_plans.router, prefix="/api/v1")
app.include_router(railroads.router, prefix="/api/v1")
app.include_router(interior.router, prefix="/api/v1")
app.include_router(interior_contributions.router, prefix="/api/v1")
