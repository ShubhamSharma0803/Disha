"""FastAPI router for the hardware serial bridge ingestion endpoints.

Endpoints
---------
POST /bridge/ingest
    Accepts a parsed packet from serial_bridge.py and injects it into the
    same event bus / SOS tracker that the simulation uses.

POST /bridge/status
    Called by the bridge process to report its connection state (mode, port,
    connected, packets_received, packets_ignored).

GET /bridge/status          (hardware node heartbeat list, backwards-compat)
GET /gateway/status         (canonical; returns bridge connection + mode)
    Both return the gateway-level status object:
    {
      mode: "simulated" | "mock" | "live",
      port: str | None,
      connected: bool,
      last_packet_ts: str | None,
      packets_received: int,
      packets_ignored: int,
    }
    If no bridge has reported within 10 s the mode resets to "simulated".
"""
from __future__ import annotations

import os
import sys
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if repo_root not in sys.path:
    sys.path.insert(0, repo_root)

from backend.node import events
from backend.simulation.sos import sos_tracker

router = APIRouter(tags=["bridge"])

# ---------------------------------------------------------------------------
# Gateway-level bridge state (singleton, in-memory)
# ---------------------------------------------------------------------------

_STALE_SECONDS = 10.0  # if no status report arrives within this window → simulated

_gw_state: Dict[str, Any] = {
    "mode": "simulated",       # "simulated" | "mock" | "live"
    "port": None,
    "connected": False,
    "last_packet_ts": None,    # ISO timestamp of last ingested packet
    "packets_received": 0,
    "packets_ignored": 0,
    "_last_status_ts": None,   # monotonic time of last POST /bridge/status
}


def _effective_mode() -> str:
    """Return mode, but fall back to 'simulated' if report is stale."""
    lts = _gw_state.get("_last_status_ts")
    if lts is None:
        return "simulated"
    if time.monotonic() - lts > _STALE_SECONDS:
        return "simulated"
    return _gw_state["mode"]


def _gw_public() -> Dict[str, Any]:
    return {
        "mode": _effective_mode(),
        "port": _gw_state["port"],
        "connected": _gw_state["connected"] if _effective_mode() != "simulated" else False,
        "last_packet_ts": _gw_state["last_packet_ts"],
        "packets_received": _gw_state["packets_received"],
        "packets_ignored": _gw_state["packets_ignored"],
    }


# ---------------------------------------------------------------------------
# Per-node heartbeat store (used by /bridge/status legacy endpoint)
# ---------------------------------------------------------------------------

_hw_nodes: Dict[str, Dict[str, Any]] = {}


def _update_hw_node(node: str, bat: int, ts: str) -> None:
    _hw_nodes[node] = {"node": node, "bat": bat, "timestamp": ts}


# ---------------------------------------------------------------------------
# Priority / type maps (mirror simulation/api.py)
# ---------------------------------------------------------------------------

_CAT_PRIORITY = {"MED": 1, "TRP": 1, "MIS": 2, "FWD": 3, "SHL": 3, "SAF": 4}
_CAT_TYPE = {
    "MED": "MEDICAL", "TRP": "TRAPPED", "MIS": "MISSING",
    "FWD": "FOOD_WATER", "SHL": "SHELTER", "SAF": "SAFE",
}


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class BridgeStatusReport(BaseModel):
    mode: Literal["live", "mock"] = "mock"
    port: Optional[str] = None
    connected: bool = False
    packets_received: int = 0
    packets_ignored: int = 0


# ---------------------------------------------------------------------------
# POST /bridge/ingest
# ---------------------------------------------------------------------------

@router.post("/bridge/ingest")
async def bridge_ingest(body: Dict[str, Any]):
    """Accept a parsed packet from the serial bridge and inject into the event bus."""
    kind = body.get("kind", "").upper()
    ts = body.get("timestamp") or datetime.now(timezone.utc).isoformat()

    # Record last-packet time regardless of kind
    _gw_state["last_packet_ts"] = ts

    if kind == "SOS":
        node = body.get("node", "HW-UNKNOWN")
        cat = str(body.get("cat", "MIS")).upper()
        n = max(1, min(9, int(body.get("n", 1))))
        bat = body.get("bat", -1)

        # Default to Dehradun coordinates when hardware node has no GPS
        try:
            lat = float(body["lat"])
        except (KeyError, TypeError, ValueError):
            lat = 30.3256
        try:
            lon = float(body["lon"])
        except (KeyError, TypeError, ValueError):
            lon = 77.9423

        priority = _CAT_PRIORITY.get(cat, 4)
        ptype = _CAT_TYPE.get(cat, "OTHER")
        packet_id = f"PKT-HW-{uuid.uuid4().hex[:8].upper()}"
        note = body.get("note") or f"HW node {node} bat={bat}%"

        sos_tracker.record_emergency(
            packet_id=packet_id,
            source=node,
            destination="GATEWAY",
            code=cat,
            priority=priority,
            people=n,
            note=note,
            source_kind="hardware",
            type=ptype,
            message=note,
            created_at=ts,
            route=[node],
        )

        # Mark delivered immediately (single-hop hardware → gateway)
        sos_tracker.on_deliver(packet_id, route=[node, "GATEWAY"], hop_count=1)

        events.emit({
            "event": "EMERGENCY_CREATED",
            "packet_id": packet_id,
            "source": node,
            "code": cat,
            "type": ptype,
            "priority": priority,
            "people": n,
            "note": note,
            "message": note,
            "source_kind": "hardware",
            "timestamp": ts,
            "payload": {
                "type": ptype,
                "code": cat,
                "priority": priority,
                "people": n,
                "note": note,
                "message": note,
                "source_kind": "hardware",
                "lat": lat,
                "lon": lon,
                "bat": bat,
            },
        })

        events.emit({
            "event": "PACKET_DELIVERED",
            "packet_id": packet_id,
            "route": [node, "GATEWAY"],
            "hop_count": 1,
            "code": cat,
            "priority": priority,
            "people": n,
            "note": note,
            "message": note,
            "source_kind": "hardware",
            "timestamp": ts,
        })

        if bat >= 0:
            _update_hw_node(node, bat, ts)
        _gw_state["packets_received"] = _gw_state["packets_received"] + 1

        return {"status": "ok", "kind": "SOS", "packet_id": packet_id}

    elif kind == "SNF":
        node = body.get("node", "HW-UNKNOWN")
        dev = body.get("dev", "")
        rssi = body.get("rssi", 0)
        ch = body.get("ch")
        bat = body.get("bat", -1)

        events.emit({
            "event": "SEARCH_OBSERVATION",
            "observer_node": node,
            "device_hash": dev,
            "rssi": rssi,
            "channel": ch,
            "timestamp": ts,
            "source_kind": "hardware",
        })

        if bat >= 0:
            _update_hw_node(node, bat, ts)
        _gw_state["packets_received"] = _gw_state["packets_received"] + 1

        return {"status": "ok", "kind": "SNF"}

    elif kind == "HB":
        node = body.get("node", "HW-UNKNOWN")
        bat = body.get("bat", -1)
        _update_hw_node(node, bat, ts)
        _gw_state["packets_received"] = _gw_state["packets_received"] + 1
        return {"status": "ok", "kind": "HB"}

    else:
        _gw_state["packets_ignored"] = _gw_state["packets_ignored"] + 1
        raise HTTPException(status_code=422, detail=f"Unknown kind: {kind!r}")


# ---------------------------------------------------------------------------
# POST /bridge/status  – called by the bridge process
# ---------------------------------------------------------------------------

@router.post("/bridge/status")
async def post_bridge_status(report: BridgeStatusReport):
    """Bridge process reports its connection state. Resets stale timer."""
    _gw_state["mode"] = report.mode
    _gw_state["port"] = report.port
    _gw_state["connected"] = report.connected
    _gw_state["packets_received"] = report.packets_received
    _gw_state["packets_ignored"] = report.packets_ignored
    _gw_state["_last_status_ts"] = time.monotonic()
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# GET /gateway/status  (canonical)
# GET /bridge/status   (kept for backwards compatibility)
# ---------------------------------------------------------------------------

@router.get("/gateway/status")
async def get_gateway_status():
    """Return bridge connection mode + stats. Falls back to 'simulated' if stale."""
    return _gw_public()


@router.get("/bridge/status")
async def get_bridge_status():
    """Alias for GET /gateway/status (also retains per-node HB list)."""
    out = _gw_public()
    out["nodes"] = list(_hw_nodes.values())
    return out
