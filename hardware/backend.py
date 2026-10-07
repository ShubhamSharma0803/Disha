import os, time
from collections import deque
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse

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

app = FastAPI()
obs = deque(maxlen=5000)
sos = deque(maxlen=50)
mode = {"want": "NORMAL", "actual": "NORMAL"}
HERE = os.path.dirname(os.path.abspath(__file__))


def to_dist(rssi):
    return 10 ** ((RSSI_1M - rssi) / (10 * N))


@app.post("/api/search-observation")
async def add(req: Request):
    d = await req.json()
    d["t"] = time.time()
    obs.append(d)
    return {"ok": True}


@app.get("/api/mode")
def get_mode():
    return mode


@app.post("/api/mode")
async def set_mode(req: Request):
    m = (await req.json()).get("mode")
    if m in ("NORMAL", "SNIFF"):
        mode["want"] = m
    return mode


@app.post("/api/mode-actual")
async def mode_actual(req: Request):
    mode["actual"] = (await req.json()).get("mode", mode["actual"])
    return {"ok": True}


@app.post("/api/sos")
async def add_sos(req: Request):
    d = await req.json()
    d["t"] = time.time()
    sos.append(d)
    return {"ok": True}


@app.get("/api/state")
def state():
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
        "mode": mode, "sos": list(sos)[-8:], "total": len(obs), "recent": len(recent),
        "devices": len(counts),
        "close": sum(1 for r in latest.values() if r > -70),
        "target": target, "nodes": nodes, "est": est,
        "all_nodes": {k: list(v) for k, v in NODES.items()},
        "last_seen": round(now - recent[-1]["t"], 1) if recent else None,
    }


@app.get("/")
def home():
    return FileResponse(os.path.join(HERE, "dashboard.html"))
