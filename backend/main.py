"""FastAPI backend for Adaptive Emergency Communication & Rescue Network."""
import os
import sys
from typing import List, Optional, Tuple, Union

# Ensure repository root is in sys.path so backend package is importable
repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if repo_root not in sys.path:
    sys.path.insert(0, repo_root)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

try:
    from backend.deployment.planner import PlannerInput
    from backend.deployment.run_planner import run
except ImportError:
    from deployment.planner import PlannerInput
    from deployment.run_planner import run

from backend.simulation.api import router as simulation_router

app = FastAPI(
    title="Disha - Emergency Communication & Rescue Network API",
    description="Backend API providing deployment planning, mesh coordination, and drone telemetry.",
    version="1.0.0",
)

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
        "*",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(simulation_router)


class RestrictedZone(BaseModel):
    lat: float
    lon: float
    radius_m: float


class PlannerRequest(BaseModel):
    center_lat: float
    center_lon: float
    width_m: float
    height_m: float
    wifi_range_m: float
    lora_range_m: float
    gateway_xy: Optional[Tuple[float, float]] = None
    restricted_zones: Optional[List[RestrictedZone]] = Field(default_factory=list)
    out_json: Optional[Union[str, bool]] = None
    out_png: Optional[Union[str, bool]] = None


@app.get("/")
def root():
    return {"status": "ok", "service": "Disha Emergency Network API"}


@app.post("/plan")
def plan_deployment(req: PlannerRequest):
    """Generate disaster deployment plan from area specifications and constraints."""
    p = PlannerInput(
        center_lat=req.center_lat,
        center_lon=req.center_lon,
        width_m=req.width_m,
        height_m=req.height_m,
        wifi_range_m=req.wifi_range_m,
        lora_range_m=req.lora_range_m,
    )
    gw = req.gateway_xy if req.gateway_xy is not None else (0.0, -req.height_m / 2.0)
    zones = [z.model_dump() for z in req.restricted_zones] if req.restricted_zones else []

    result = run(
        p=p,
        gateway_xy=gw,
        restricted_latlon=zones,
        out_json=req.out_json,
        out_png=req.out_png,
    )
    return result


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
