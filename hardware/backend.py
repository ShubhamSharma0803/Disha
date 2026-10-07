import os, sys, time, uuid
from collections import deque
from datetime import datetime, timezone
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

# Ensure repo root is in sys.path to access backend modules for main dashboard
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

try:
    from backend.node import events
    from backend.simulation.sos import sos_tracker
    from backend.simulation.api import router as simulation_router
    from backend.gateway.bridge_api import router as bridge_router, _gw_state
    HAS_MESH_BACKEND = True
except ImportError:
    HAS_MESH_BACKEND = False

# ===== EDIT THESE after your calibration =====
RSSI_1M = -45          # average RSSI at 1 metre
N = 2.5                # path-loss exponent (2 open space, 3 indoors)
WINDOW = 120           # seconds of readings to use
NODES = {              # node positions in metres (x, y) on your test layout
    "NODE-01": (0, 0),
    "NODE-02": (10, 0),
    "NODE-03": (5, 8),
}
# =============================================

app = FastAPI(title="Disha Hardware & Rescue Network API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if HAS_MESH_BACKEND:
    app.include_router(simulation_router)
    app.include_router(bridge_router)

obs = deque(maxlen=5000)
sos = deque(maxlen=50)
mode = {"want": "NORMAL", "actual": "NORMAL"}
HERE = os.path.dirname(os.path.abspath(__file__))

_CAT_PRIORITY = {"MED": 1, "TRP": 1, "MIS": 2, "FWD": 3, "SHL": 3, "SAF": 4}
_CAT_TYPE = {
    "MED": "MEDICAL", "TRP": "TRAPPED", "MIS": "MISSING",
    "FWD": "FOOD_WATER", "SHL": "SHELTER", "SAF": "SAFE",
}


def to_dist(rssi):
    return 10 ** ((RSSI_1M - rssi) / (10 * N))


@app.post("/api/search-observation")
async def add(req: Request):
    if mode["want"] != "SNIFF":
        return {"ok": True, "ignored": True}
    d = await req.json()
    d["t"] = time.time()
    obs.append(d)

    # Forward to main dashboard event bus if available
    if HAS_MESH_BACKEND:
        ts = d.get("timestamp") or datetime.now(timezone.utc).isoformat()
        events.emit({
            "event": "SEARCH_OBSERVATION",
            "observer_node": d.get("node_id", "NODE-02"),
            "device_hash": d.get("device_hash", ""),
            "rssi": d.get("rssi", -70),
            "channel": d.get("channel", 1),
            "timestamp": ts,
            "source_kind": "hardware",
        })
        _gw_state["mode"] = "live"
        _gw_state["connected"] = True
        _gw_state["last_packet_ts"] = ts
        _gw_state["_last_status_ts"] = time.monotonic()
        _gw_state["packets_received"] = _gw_state["packets_received"] + 1

    return {"ok": True}


@app.get("/api/mode")
def get_mode():
    return mode


@app.post("/api/mode")
async def set_mode(req: Request):
    m = (await req.json()).get("mode")
    if m in ("NORMAL", "SNIFF"):
        if m == "SNIFF" and mode["want"] != "SNIFF":
            obs.clear()
        mode["want"] = m
    return mode


@app.post("/api/mode-actual")
async def mode_actual(req: Request):
    mode["actual"] = (await req.json()).get("mode", mode["actual"])
    return {"ok": True}


@app.post("/api/sos")
async def add_sos(req: Request):
    if mode["want"] != "NORMAL":
        return {"ok": True, "ignored": True}
    d = await req.json()
    d["t"] = time.time()

    # Parse payload: SOS|<NODE_ID>|<CATEGORY_CODE>|<PEOPLE_COUNT>|<NOTE>
    payload = str(d.get("payload", ""))
    parts = payload.split("|", 4)
    source_node = parts[1].strip() if len(parts) > 1 and parts[1].strip() else d.get("node_id", "NODE-01")
    cat = parts[2].strip().upper() if len(parts) > 2 and parts[2].strip().upper() in _CAT_PRIORITY else "MED"
    try:
        n = max(1, min(9, int(parts[3].strip()))) if len(parts) > 3 else 1
    except (ValueError, TypeError):
        n = 1
    note = parts[4].strip() if len(parts) > 4 and parts[4].strip() else f"HW alert from {source_node}"

    d["note"] = note
    d["message"] = note
    d["source"] = source_node
    d["code"] = cat
    d["people"] = n
    d["payload"] = f"SOS|{source_node}|{cat}|{n}|{note}"
    sos.append(d)

    # Forward to main dashboard event bus and sos_tracker if available
    if HAS_MESH_BACKEND:
        ts = datetime.now(timezone.utc).isoformat()
        packet_id = f"PKT-HW-{uuid.uuid4().hex[:8].upper()}"
        priority = _CAT_PRIORITY.get(cat, 4)
        ptype = _CAT_TYPE.get(cat, "MEDICAL")

        sos_tracker.record_emergency(
            packet_id=packet_id,
            source=source_node,
            destination="GATEWAY",
            code=cat,
            priority=priority,
            people=n,
            note=note,
            source_kind="hardware",
            type=ptype,
            message=note,
            created_at=ts,
            route=[source_node],
        )
        sos_tracker.on_deliver(packet_id, route=[source_node, "GATEWAY"], hop_count=1)

        # Emit EMERGENCY_CREATED with note and message at both top-level and payload
        events.emit({
            "event": "EMERGENCY_CREATED",
            "packet_id": packet_id,
            "source": source_node,
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
                "lat": 30.3256,
                "lon": 77.9423,
                "bat": 100,
            },
        })
        events.emit({
            "event": "PACKET_DELIVERED",
            "packet_id": packet_id,
            "route": [source_node, "GATEWAY"],
            "hop_count": 1,
            "code": cat,
            "priority": priority,
            "people": n,
            "note": note,
            "message": note,
            "source_kind": "hardware",
            "timestamp": ts,
        })
        _gw_state["mode"] = "live"
        _gw_state["connected"] = True
        _gw_state["last_packet_ts"] = ts
        _gw_state["_last_status_ts"] = time.monotonic()
        _gw_state["packets_received"] = _gw_state["packets_received"] + 1

    return {"ok": True}


@app.get("/api/state")
def state():
    if mode["want"] == "NORMAL":
        return {
            "mode": mode,
            "sos": list(sos)[-8:],
            "total": 0,
            "recent": 0,
            "devices": 0,
            "close": 0,
            "target": None,
            "nodes": [],
            "est": None,
            "all_nodes": {k: list(v) for k, v in NODES.items()},
            "last_seen": None,
        }

    now = time.time()
    recent = [o for o in obs if now - o["t"] <= WINDOW]

    counts, latest = {}, {}
    for o in recent:
        h = o["device_hash"]
        counts[h] = counts.get(h, 0) + 1
        latest[h] = o["rssi"]
    target = max(counts, key=counts.get) if counts else None

    per = {}
    for o in recent:
        if o["device_hash"] == target:
            per.setdefault(o["node_id"], []).append(o["rssi"])

    nodes = []
    for nid, vals in per.items():
        avg = sum(vals) / len(vals)
        nodes.append({"id": nid, "pos": NODES.get(nid, (0, 0)),
                      "avg": round(avg, 1), "n": len(vals),
                      "dist": round(to_dist(avg), 1)})

    est = None
    if len(nodes) >= 2:
        ws = [10 ** (n["avg"] / 10) for n in nodes]
        tot = sum(ws)
        x = sum(n["pos"][0] * w for n, w in zip(nodes, ws)) / tot
        y = sum(n["pos"][1] * w for n, w in zip(nodes, ws)) / tot
        big = len(nodes) >= 3
        est = {"x": round(x, 1), "y": round(y, 1),
               "radius": 15 if big else 30,
               "conf": "High" if big else "Medium", "kind": "area"}
    elif len(nodes) == 1:
        n = nodes[0]
        est = {"x": n["pos"][0], "y": n["pos"][1], "radius": n["dist"],
               "conf": "Low", "kind": "ring"}

    return {
        "mode": mode,
        "sos": [],
        "total": len(obs),
        "recent": len(recent),
        "devices": len(counts),
        "close": sum(1 for r in latest.values() if r > -70),
        "target": target,
        "nodes": nodes,
        "est": est,
        "all_nodes": {k: list(v) for k, v in NODES.items()},
        "last_seen": round(now - recent[-1]["t"], 1) if recent else None,
    }


@app.get("/")
def home(req: Request):
    if "application/json" in req.headers.get("accept", ""):
        return {"status": "ok", "service": "Disha Emergency Network API"}
    html_path = os.path.join(HERE, "dashboard.html")
    if os.path.exists(html_path):
        return FileResponse(html_path)
    alt_path = os.path.abspath(os.path.join(HERE, "..", "..", "AmanSearch_dashboard", "dashboard.html"))
    if os.path.exists(alt_path):
        return FileResponse(alt_path)
    return {"status": "ok", "service": "Disha Emergency Network API"}
