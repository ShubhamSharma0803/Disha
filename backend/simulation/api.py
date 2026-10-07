"""Simulation API router for FastAPI: starts/controls mesh simulation and streams events over WebSocket."""
from __future__ import annotations

import asyncio
import json
import os
import sys
import uuid
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field, field_validator
from fastapi import APIRouter, Body, HTTPException, WebSocket, WebSocketDisconnect

# Ensure path
repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if repo_root not in sys.path:
    sys.path.insert(0, repo_root)

from backend.node.config import load_topology, Topology
from backend.node.packet import Packet
from backend.node import events
from backend.simulation.run_sim import MeshNetwork
from backend.simulation.sos import sos_tracker

router = APIRouter()

DEFAULT_TOPOLOGY_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "docs", "sample_deployment.json"
)

# Global simulation instance and concurrency lock
current_net: Optional[MeshNetwork] = None
_net_lock = asyncio.Lock()


class WebSocketManager:
    """Tracks active WebSocket connections and broadcasts events as JSON."""

    def __init__(self) -> None:
        self.queues: set[asyncio.Queue] = set()

    def register(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self.queues.add(q)
        return q

    def unregister(self, q: asyncio.Queue) -> None:
        self.queues.discard(q)

    def broadcast(self, event: dict[str, Any]) -> None:
        for q in list(self.queues):
            try:
                q.put_nowait(event)
            except Exception:
                pass


ws_manager = WebSocketManager()


def _event_bus_listener(event: dict[str, Any]) -> None:
    ws_manager.broadcast(event)


# Connect event bus to WebSocket broadcaster
events.register(_event_bus_listener)


VALID_CODES = {"MED", "TRP", "MIS", "FWD", "SHL", "SAF"}

CODE_PRIORITY = {
    "MED": 1,
    "TRP": 1,
    "MIS": 2,
    "FWD": 3,
    "SHL": 3,
    "SAF": 4,
}

TYPE_TO_CODE = {
    "MEDICAL": "MED",
    "TRAPPED": "TRP",
    "MISSING": "MIS",
    "FOOD": "FWD",
    "WATER": "FWD",
    "FOOD_WATER": "FWD",
    "SHELTER": "SHL",
    "SAFE": "SAF",
}


class EmergencyRequest(BaseModel):
    source: str
    type: Optional[str] = None
    message: Optional[str] = None
    code: Optional[str] = None
    people: int = Field(default=1, ge=1, le=9)
    note: Optional[str] = Field(default=None, max_length=40)
    source_kind: Optional[Literal["hardware", "simulated", "dashboard"]] = "simulated"

    @field_validator("code")
    @classmethod
    def validate_code(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            v_upper = v.upper()
            if v_upper not in VALID_CODES:
                raise ValueError(
                    f"Invalid emergency code '{v}'. Must be one of {sorted(VALID_CODES)}"
                )
            return v_upper
        return v


@router.post("/simulation/start")
async def start_simulation(deployment: Optional[Dict[str, Any]] = Body(None)):
    """Start or restart the mesh simulation from deployment JSON (or default sample)."""
    global current_net

    if deployment and deployment.get("nodes") and deployment.get("links"):
        topo = load_topology(deployment)
        deploy_data = deployment
    else:
        abs_path = os.path.abspath(DEFAULT_TOPOLOGY_PATH)
        topo = load_topology(abs_path)
        with open(abs_path) as f:
            deploy_data = json.load(f)

    async with _net_lock:
        if current_net is not None:
            await current_net.stop()
            current_net = None

        net = MeshNetwork(topo)
        await net.start()
        # Brief pause to allow initial HELLO packets to exchange
        await asyncio.sleep(1.5)
        current_net = net
        sos_tracker.clear()

    return {
        "status": "started",
        "nodes": deploy_data.get("nodes", []),
        "links": deploy_data.get("links", []),
        "gateway": deploy_data.get("gateway"),
    }


@router.post("/simulation/emergency")
@router.post("/sos")
async def send_emergency(req: EmergencyRequest):
    """Originate an EMERGENCY packet from a source node (accessible via /simulation/emergency or /sos)."""
    if current_net is None:
        raise HTTPException(
            status_code=400,
            detail="Simulation has not been started. Call POST /simulation/start first.",
        )
    if req.source not in current_net.nodes:
        raise HTTPException(status_code=404, detail=f"Node {req.source} not found")

    code = req.code
    if code is None and req.type:
        code = TYPE_TO_CODE.get(req.type.upper())

    if code in ("MED", "TRP"):
        priority = 1
    elif code == "MIS":
        priority = 2
    elif code in ("FWD", "SHL"):
        priority = 3
    elif code == "SAF":
        priority = 4
    elif req.type and req.type.upper() == "FIRE":
        priority = 1
    else:
        priority = 4

    ptype = req.type or code or "EMERGENCY"
    pmsg = req.message or req.note or ""
    pnote = req.note or (req.message[:40] if req.message else None)
    psource_kind = req.source_kind or "simulated"

    payload = {
        "type": ptype,
        "message": pmsg,
        "code": code,
        "priority": priority,
        "people": req.people,
        "note": pnote,
        "source_kind": psource_kind,
    }

    pkt = Packet(
        packet_id=f"PKT-EMG-{uuid.uuid4().hex[:8].upper()}",
        packet_type="EMERGENCY",
        source=req.source,
        destination="GATEWAY",
        payload=payload,
    )

    sos_tracker.record_emergency(
        packet_id=pkt.packet_id,
        source=req.source,
        destination="GATEWAY",
        code=code,
        priority=priority,
        people=req.people,
        note=pnote,
        source_kind=psource_kind,
        type=ptype,
        message=pmsg,
        created_at=pkt.timestamp,
        route=[req.source],
    )

    # Launch originate task and yield to event loop so creation event emits immediately
    asyncio.create_task(current_net.nodes[req.source].originate(pkt))
    await asyncio.sleep(0.05)

    return {
        "status": "originated",
        "packet_id": pkt.packet_id,
        "source": req.source,
        "type": ptype,
        "message": pmsg,
        "code": code,
        "priority": priority,
        "people": req.people,
        "note": pnote,
        "source_kind": psource_kind,
    }


@router.post("/simulation/kill/{node_id}")
async def kill_node_endpoint(node_id: str):
    """Simulate power loss on a node."""
    if current_net is None:
        raise HTTPException(status_code=400, detail="Simulation not started")
    if node_id not in current_net.nodes:
        raise HTTPException(status_code=404, detail=f"Node {node_id} not found")

    await current_net.kill_node(node_id)
    return {"status": "killed", "node_id": node_id}


@router.post("/simulation/revive/{node_id}")
async def revive_node_endpoint(node_id: str):
    """Revive a dead node."""
    if current_net is None:
        raise HTTPException(status_code=400, detail="Simulation not started")
    if node_id not in current_net.nodes:
        raise HTTPException(status_code=404, detail=f"Node {node_id} not found")

    await current_net.revive_node(node_id)
    return {"status": "revived", "node_id": node_id}


@router.get("/simulation/state")
async def get_simulation_state():
    """Return every node's status, hops_to_gateway, and next_hop."""
    if current_net is None:
        raise HTTPException(status_code=400, detail="Simulation not started")

    nodes_list: list[dict[str, Any]] = []
    nodes_dict: dict[str, dict[str, Any]] = {}
    for nid in sorted(current_net.nodes.keys()):
        node = current_net.nodes[nid]
        hops = node.router.hops_to_gateway
        hops_val = None if hops == float("inf") else hops
        info = {
            "id": nid,
            "status": "ALIVE" if node.is_alive else "DEAD",
            "hops_to_gateway": hops_val,
            "next_hop": node.router.next_hop,
        }
        nodes_list.append(info)
        nodes_dict[nid] = info

    return {
        "nodes": nodes_list,
        "state": nodes_dict,
        **nodes_dict,
    }


@router.get("/simulation/sos")
@router.get("/sos")
async def get_simulation_sos():
    """Return all emergencies so far ranked by priority asc, people desc, created time asc."""
    return sos_tracker.get_all_ranked()


@router.websocket("/ws/events")
async def websocket_events(websocket: WebSocket):
    """Stream network events as JSON to connected WebSocket clients."""
    await websocket.accept()
    q = ws_manager.register()

    async def receive_loop() -> None:
        try:
            while True:
                await websocket.receive_text()
        except (WebSocketDisconnect, Exception):
            pass

    async def send_loop() -> None:
        try:
            while True:
                event = await q.get()
                await websocket.send_json(event)
        except (WebSocketDisconnect, Exception):
            pass

    receive_task = asyncio.create_task(receive_loop())
    send_task = asyncio.create_task(send_loop())
    try:
        _, pending = await asyncio.wait(
            [receive_task, send_task],
            return_when=asyncio.FIRST_COMPLETED,
        )
        for t in pending:
            t.cancel()
    finally:
        ws_manager.unregister(q)


async def stop_simulation() -> None:
    """Cleanly shut down running simulation."""
    global current_net
    async with _net_lock:
        if current_net is not None:
            await current_net.stop()
            current_net = None


@router.on_event("shutdown")
async def on_shutdown() -> None:
    await stop_simulation()
