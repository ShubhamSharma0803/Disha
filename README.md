# Adaptive Emergency Communication & Rescue Network

Hackathon: Shivalik College of Engineering, Dehradun, 7-8 Oct 2026

A temporary emergency communication network that is **planned and deployed after a disaster**,
for when cellular and internet infrastructure is unavailable.

```
PLAN -> DEPLOY -> CONNECT -> ADAPT -> DELIVER -> RESPOND
```

Survivor phone --Wi-Fi--> ESP32 node --LoRa mesh--> Gateway --> FastAPI --WebSocket--> React dashboard

## Modules and owners

| # | Module | Owner | Folder |
|---|---|---|---|
| 1 | Deployment Planner | Shubham | `backend/deployment/` |
| 2 | Drone Deployment (simulation first) | Sanyam | `drone/` |
| 3 | Adaptive Mesh Network | Shubham | `backend/node/`, `backend/routing/`, `backend/gateway/`, `backend/simulation/` |
| 4 | Backend + Rescue Dashboard | Sarniha | `backend/` (API), `frontend/rescue-dashboard/` |
| 5 | Passive Wi-Fi Search Assistance | Aman | `backend/search/` |
| - | Hardware node (ESP32, LoRa, GPS, OLED) | Sanyam | `hardware/` |
| - | PPT / Presentation | Palak | `docs/` |

## Repository structure

```
backend/
  node/          software node, packet format (TCP-emulated nodes)
  routing/       neighbor discovery, routing table, failure handling
  gateway/       gateway that forwards to the backend
  deployment/    planner, optimizer
  simulation/    multi-node simulation runner
frontend/
  rescue-dashboard/   React dashboard
hardware/
  esp32/  lora/  gps/
drone/
  mission/  simulation/
docs/
  protocol.md    shared data contracts (READ THIS FIRST)
README.md
requirements.txt
```

## Setup

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS / Linux
pip install -r requirements.txt
```

Run the planner:

```bash
cd backend/deployment
python run_planner.py           # writes deployment.json and deployment.png
```

Run the mesh network simulation (25 nodes, full topology from `docs/sample_deployment.json`):

```bash
python backend/simulation/run_sim.py                         # default topology
python backend/simulation/run_sim.py -t path/to/deploy.json  # custom topology
```

This starts all nodes in one asyncio loop, waits for distance-vector routing to
converge via HELLO packets, then sends an EMERGENCY from the farthest node and
prints the multi-hop route it took to the gateway. Events are printed as JSON
lines to stdout (protocol.md section 5 format).

Run the mesh tests:

```bash
pytest backend/tests/test_mesh.py
pytest backend/tests/test_api.py
```

Run the FastAPI backend server:

```bash
uvicorn backend.main:app --reload --port 8000
```

### API & Simulation Endpoints

- **Generate Deployment Plan (`POST /plan`)**:
  ```bash
  curl -X POST http://localhost:8000/plan \
    -H "Content-Type: application/json" \
    -d '{
      "center_lat": 28.6139,
      "center_lon": 77.2090,
      "width_m": 2000,
      "height_m": 2000,
      "wifi_range_m": 300,
      "lora_range_m": 1000,
      "gateway_xy": [0, -1000],
      "restricted_zones": []
    }'
  ```

- **Start / Restart Mesh Simulation (`POST /simulation/start`)**:
  ```bash
  curl -X POST http://localhost:8000/simulation/start
  ```
  *(Optionally pass a planner result in the request body to simulate that specific deployment).*

- **Originate Emergency Message (`POST /simulation/emergency`)**:
  ```bash
  curl -X POST http://localhost:8000/simulation/emergency \
    -H "Content-Type: application/json" \
    -d '{
      "source": "NODE-05",
      "type": "MEDICAL",
      "message": "Immediate assistance required"
    }'
  ```

- **Simulate Power Failure & Revival**:
  ```bash
  curl -X POST http://localhost:8000/simulation/kill/NODE-02
  curl -X POST http://localhost:8000/simulation/revive/NODE-02
  ```

- **Get Mesh State (`GET /simulation/state`)**:
  ```bash
  curl http://localhost:8000/simulation/state
  ```

- **Stream Network Events (`WebSocket /ws/events`)**:
  Connect to `ws://localhost:8000/ws/events` to stream network events as JSON in real-time.

## Team rules

1. **Build against `docs/protocol.md`.** If a format must change, change that file first and tell everyone.
2. **Stay in your own folder.** Need something in another person's folder? Ask them.
3. **One branch per person**, named `name/feature` (for example `shubham/mesh`). Merge into `main` when it works.
4. **Pull before you push:** `git pull origin main`.
5. **Dashboard is not the router.** The network engine decides forwarding; the dashboard only displays state.
6. Every module answers: what do I receive, what do I produce, who consumes it.

## Honesty rules (what we may and may not claim)

Every feature has exactly one status: **BUILT**, **TESTED**, **SIMULATED**, **PLANNED** or **FUTURE**.

- We have **one** physical LoRa node. The larger network is **software-emulated**. Say so.
- Drone movement is **simulated** unless real autonomous flight is working.
- Ranges (Wi-Fi, LoRa) are **configurable assumptions**, not guaranteed specs.
- Node count is "optimized under our coverage and connectivity assumptions", not a proven minimum.
- Wi-Fi sniffing gives a **probable proximity/search area**, never an exact phone location.
- Survivor messages are "emergency requests", not carrier SMS.

## Status

| Feature | Status |
|---|---|
| Planner: placement, Wi-Fi coverage, LoRa links, gateway reachability, optimizer | BUILT / TESTED |
| Adaptive mesh network: HELLO, distance-vector routing, multi-hop forwarding, ACK | BUILT / TESTED |
| Gateway: EMERGENCY delivery, reverse-route ACK | BUILT / TESTED |
| Multi-hop routing, failure detection (neighbour timeout) | BUILT / TESTED |
| Gateway, FastAPI, WebSocket streaming | BUILT / TESTED |
| Drone mission simulation | PLANNED |
| Physical ESP32/LoRa node | PLANNED (mark TESTED only after testing) |
| Passive Wi-Fi observation | PLANNED |

Update this table as things change.