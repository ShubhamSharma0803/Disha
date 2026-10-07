# Disha Project Progress & Technical Roadmap

> **Autonomous Disaster-Response Mesh Network & 3D Drone Deployment Simulator**  
> *Rapid-deployment emergency telecommunications system for disaster zones where cellular and internet infrastructure is compromised.*  
> **Event:** National-Level Hackathon — Shivalik College of Engineering, Dehradun (7–8 October 2026)  
> **Repository:** `Disha`

---

## 1. Executive Summary & Status Overview

When severe natural disasters strike (earthquakes, flash floods, landslides), existing telecommunication networks fail. **Disha** restores emergency connectivity within minutes via:
1. **Disaster Deployment Planner:** Algorithmic calculation of post-disaster node positions maximizing survivor Wi-Fi coverage while preserving multi-hop LoRa radio mesh connectivity.
2. **Autonomous Drone Fleet (Simulated 3D Deployment):** Drones dispatching from base station / gateway to deploy nodes across rugged terrain.
3. **Adaptive Mesh Network Engine:** Self-healing, multi-hop distance-vector mesh routing with HELLO heartbeats, automatic route failover, duplicate suppression, and end-to-end ACK delivery.
4. **3D Rescue Dashboard & Telemetry Backend:** Interactive Mapbox GL 3D satellite elevation view, live WebSocket telemetry stream, SOS triage queue, and failover visualization.
5. **Passive Wi-Fi Search Assistance:** Signal-strength (RSSI) proximity estimation for locating trapped survivors.

```
┌─────────────────┐       Wi-Fi (100–500m)       ┌────────────────────────┐
│ Survivor Phone  │ ───────────────────────────> │ Autonomous Mesh Node   │
└─────────────────┘                              └────────────────────────┘
                                                             │
                                                     LoRa (500–1500m)
                                                             │
                                                             ▼
┌──────────────────┐     WebSocket / REST API    ┌────────────────────────┐
│ Rescue Dashboard │ <────────────────────────── │ Gateway / Base Station │
│  (3D Visualizer) │                             └────────────────────────┘
└──────────────────┘
```

### Module Status Summary

| Workstream | Module | Owner | Status | Details |
|---|---|---|---|---|
| **WS 1** | Disaster Deployment Planner | Shubham | **BUILT & TESTED** | Hexagonal disk-packing, boundary clipping, BFS hop count, `/plan` API |
| **WS 2** | Drone Deployment & Positioning | Sanyam | **SIMULATED** | Deck.gl 3D terrain flight animation, autopilot mission export (`.json`) |
| **WS 3** | Adaptive Mesh Network Engine | Shubham | **BUILT & TESTED** | Distance-vector routing, HELLO loops, failover, 9/9 unit tests passing |
| **WS 4** | Rescue Backend & Dashboard | Sarniha | **BUILT & TESTED** | FastAPI server, WebSockets, Mapbox 3D terrain, SOS triage queue, failover alerts |
| **WS 5** | Passive Search Assistance | Aman | **PLANNED** | Protocol defined (`SEARCH_OBSERVATION`), dashboard sniffing tab drafted |
| **HW** | Physical ESP32 Hardware Node | Sanyam | **IN PROGRESS** | 1 physical prototype node (ESP32 + LoRa + GPS + OLED), firmware integration pending |
| **PRES** | Presentation & Demo Story | Palak | **IN PROGRESS** | Pitch deck, demo narrative, and system architecture explanation |

---

## 2. Completed Features Inventory (What Is Done)

### A. Workstream 1: Disaster Deployment Planner (`backend/deployment/`)
- [x] **Hexagonal Lattice Coverage Optimizer ([optimize.py](file:///d:/disha/Disha/backend/deployment/optimize.py)):**
  - Mathematical disk-packing algorithm maximizing Wi-Fi coverage of disaster boundary while minimizing required drone nodes.
  - Rectangular boundary clipping ensuring all deployed nodes sit within designated operational bounds.
  - Redundant interior node pruning pass preserving multi-path LoRa connectivity.
  - Adaptive resolution steps (`plan_step`) preventing CPU lockups during small radio ranges or large disaster areas.
- [x] **Graph Link Builder & Hop Calculator ([planner.py](file:///d:/disha/Disha/backend/deployment/planner.py), [run_planner.py](file:///d:/disha/Disha/backend/deployment/run_planner.py)):**
  - Pairwise Euclidean distance calculations establishing bidirectional candidate LoRa links whenever $d \le \text{lora\_range\_m}$.
  - Breadth-First Search (BFS) computing `hops_from_gateway` for all nodes.
  - Staggered deployment order scheduling prioritizing gateway-adjacent relays first so the network expands connected.
  - Matplotlib visualizer exporting deployment diagram (`deployment.png`) and schema (`deployment.json`).
- [x] **REST Integration ([main.py](file:///d:/disha/Disha/backend/main.py)):**
  - `POST /plan` endpoint accepting center coordinates, width/height, radio ranges, gateway offset, and restricted no-go zones.

### B. Workstream 3: Adaptive Mesh Network Engine (`backend/node/`, `backend/routing/`, `backend/gateway/`, `backend/simulation/`)
- [x] **In-Process Asyncio Message Bus ([node.py](file:///d:/disha/Disha/backend/node/node.py)):**
  - High-performance, zero-socket in-process queuing between emulated nodes, avoiding OS socket exhaustion (TIME_WAIT issues).
- [x] **Distance-Vector Router ([router.py](file:///d:/disha/Disha/backend/routing/router.py)):**
  - HELLO-packet periodic broadcasting (default: 2.0s interval) advertising gateway distance and next hops.
  - Split-horizon routing preventing 2-node routing loops.
  - Neighbour timeout watchdog (8.0s) marking silent neighbours as lost.
  - Dynamic candidate route ranking selecting the lowest hop-count route to the gateway.
- [x] **Fault Tolerance & Dynamic Failover:**
  - Automated detection of dead neighbours emitting `NEIGHBOUR_LOST`.
  - Immediate failover to alternative next hop with `ROUTE_CHANGED` and `PACKET_REROUTED` events.
  - Graceful packet drop (`PACKET_DROPPED`) with reason tracking if no route to gateway exists.
- [x] **Packet Integrity & Delivery ([packet.py](file:///d:/disha/Disha/backend/node/packet.py), [gateway.py](file:///d:/disha/Disha/backend/gateway/gateway.py)):**
  - Unique packet IDs with LRU duplicate packet suppression (`_seen` cache).
  - Time-To-Live (TTL) decrement per hop preventing infinite packet circulation.
  - Gateway packet ingestion emitting `PACKET_DELIVERED` and dispatching reverse-route `ACK` packets back to the originator.
- [x] **Triage Priority Ranking Engine ([sos.py](file:///d:/disha/Disha/backend/simulation/sos.py)):**
  - Structured categorization: `MED` (Medical, P1), `TRP` (Trapped, P1), `MIS` (Missing, P2), `FWD` (Food/Water, P3), `SHL` (Shelter, P3), `SAF` (Safe, P4).
  - Live ranking sorted by `priority ASC`, `people_count DESC`, and `timestamp ASC`.

### C. Workstream 4: Backend API & Real-Time Streaming (`backend/main.py`, `backend/simulation/api.py`)
- [x] **FastAPI Application Server:**
  - `GET /`: Health check endpoint.
  - `POST /plan`: Runs deployment planner and returns JSON topology.
  - `POST /simulation/start`: Boots the multi-node mesh network simulation with custom or default topology.
  - `POST /simulation/emergency` & `POST /sos`: Injects emergency distress packets into specified source nodes.
  - `POST /simulation/kill/{node_id}`: Simulates node power loss / battery failure.
  - `POST /simulation/revive/{node_id}`: Restores dead node back to operation.
  - `GET /simulation/state`: Returns live node statuses, next hops, and hop counts.
  - `GET /simulation/sos` & `GET /sos`: Returns ranked SOS triage list.
- [x] **WebSocket Live Event Stream (`WebSocket /ws/events`):**
  - Broadcasts structured JSON events in real-time (`NODE_ACTIVE`, `LINK_CREATED`, `EMERGENCY_CREATED`, `PACKET_FORWARDED`, `PACKET_DELIVERED`, `NODE_FAILED`, `NODE_REVIVED`, `NEIGHBOUR_LOST`, `ROUTE_CHANGED`, `PACKET_REROUTED`, `PACKET_DROPPED`).

### D. Workstream 4 & Workstream 2: 3D Rescue Dashboard (`frontend/rescue-dashboard/`)
- [x] **Mapbox GL JS v3 3D Terrain Engine ([Map3DView.jsx](file:///d:/disha/Disha/frontend/rescue-dashboard/src/components/Map3DView.jsx)):**
  - Digital Elevation Models (DEM) with atmospheric lighting, 3D pitch/bearing controls, and satellite imagery.
  - **Zero-Parallax Draped Layers:** Uses native Mapbox vector layers (`circle-pitch-alignment: 'map'`, draped lines, polygons) for disaster boundary, Wi-Fi coverage circles, LoRa mesh lines, node badges, and gateway markers.
- [x] **Shortest Path to Gateway:**
  - Dijkstra shortest path algorithm ([geoMath.js](file:///d:/disha/Disha/frontend/rescue-dashboard/src/utils/geoMath.js)) weighted by link distance.
  - Interactive selection highlighting optimal route to the gateway in bold black (`#000000`, 5.5px) with hop count and node sequence.
- [x] **3D Autonomous Drone Flight Animation:**
  - Built with **Deck.gl v9** calculating real-time terrain elevations (`queryTerrainElevation`).
  - Drones fly 35m AGL along smooth sinusoidal ease-in-out arcs from the Gateway launch pad to destination coordinates.
  - Triggers arrival events transitioning node status from `PLANNED` to `ACTIVE`.
- [x] **Radio Parameter Tuning Sliders ([LeftPanel.jsx](file:///d:/disha/Disha/frontend/rescue-dashboard/src/components/panels/LeftPanel.jsx)):**
  - Wi-Fi radius slider (100m–500m, 10m steps) with instant preset pills.
  - LoRa spacing slider (500m–1500m, 25m steps) with instant preset pills.
  - Debounced backend recalculation (`POST /plan`) with instant local fallback grid.
- [x] **Demo Simulator Bar ([DemoBar.jsx](file:///d:/disha/Disha/frontend/rescue-dashboard/src/components/panels/DemoBar.jsx)):**
  - One-click SOS beacon generator: select source node, emergency category (MED, TRP, MIS, etc.), and affected people count.
  - Power fault injection: kill active node, revive all nodes, reset simulation.
- [x] **Signals & Telemetry Panel ([RightPanel.jsx](file:///d:/disha/Disha/frontend/rescue-dashboard/src/components/panels/RightPanel.jsx), [RightPanel.css](file:///d:/disha/Disha/frontend/rescue-dashboard/src/components/panels/RightPanel.css)):**
  - **Smooth Scroll Fix:** Nested flexbox height constraints resolved on `.ui-card__content` and `.disha-right-panel__body`, allowing limitless scrolling with styled scrollbar when 4+ SOS messages arrive.
  - **SOS Tab:** Ranked distress beacon cards with priority badges, survivor counts, route hop trail, delivered glow animation, and reroute indicators.
  - **Failures Tab:** Real-time catalog of dead/offline nodes with power failure badges, coordinates, last distance, "Focus on Map", and one-click "Revive Node" actions.
  - **Network Log Tab:** Real-time chronological terminal of live WebSocket events (`PACKET_FORWARDED`, `PACKET_DELIVERED`, `ROUTE_CHANGED`, `LINK_CREATED`, `NODE_ACTIVE`, `NODE_FAILED`) with category filters (`All`, `Packets`, `Routing`, `Nodes`) and clear utility.
  - **Sniffing Tab (WS-5):** Explanatory search assistance panel tracking 802.11 probe frame detections, anonymized device hashes, observer nodes, RSSI signal meters, estimated proximity radii, and an interactive simulation probe button.
- [x] **Dynamic Route Failover Banner ([RerouteBanner.jsx](file:///d:/disha/Disha/frontend/rescue-dashboard/src/components/panels/RerouteBanner.jsx)):**
  - Pop-up alert notifying operators when a link fails and a packet is rerouted via an alternate node.
- [x] **Autopilot Mission Exporter:**
  - One-click export producing standard `drone-mission-<timestamp>.json` waypoint files compatible with ArduPilot / PX4 flight controllers.
- [x] **WebSocket Client Layer ([useMeshEvents.js](file:///d:/disha/Disha/frontend/rescue-dashboard/src/hooks/useMeshEvents.js)):**
  - Auto-reconnect with exponential backoff (1s, 2s, 4s, max 5s).
  - Background state synchronization with `GET /simulation/state`.

### E. Verification & Automated Testing
- [x] **Mesh Protocol Unit Tests ([test_mesh.py](file:///d:/disha/Disha/backend/tests/test_mesh.py)):**
  - 9/9 tests passing (`pytest`):
    1. Linear topology HELLO convergence.
    2. Multi-hop packet forwarding along shortest path.
    3. Failure detection and failover in redundant diamond topology.
    4. Loop prevention with split-horizon check.
    5. TTL decrement and expiration drop.
    6. Duplicate packet suppression via seen cache.
    7. Reverse ACK packet return to originator.
    8. Multi-failure network partition isolation.
    9. Event bus emissions verification.
- [x] **Soak Test ([soak_test.py](file:///d:/disha/Disha/backend/tests/soak_test.py)):**
  - 22-node network simulation verifying long-term convergence, zero false failures during idle, and orderly packet transmission.
- [x] **Frontend Production Build:**
  - Clean Vite build with zero compilation errors (`npm run build`).

---

## 3. Checklist of What Is Left (By Workstream & Owner)

```
LEGEND:
[ ]  Not started / Pending
[/]  In progress / Partially implemented
[x]  Complete / Verified
```

### Workstream 1: Deployment Planner (Owner: Shubham)
- [x] Implement core hexagonal optimizer and boundary clipping.
- [x] Implement BFS gateway hop calculator and deployment order.
- [x] Connect optimizer to FastAPI `/plan` endpoint.
- [ ] **Restricted Zones Enforcement:** Verify no-go zones (water bodies, collapsed structures) properly exclude candidate node placement while preserving surrounding Wi-Fi coverage.
- [ ] **Terrain Obstacle Awareness:** (Optional / Bonus) Ingest elevation data to ensure LoRa links do not pass through mountain peaks without line-of-sight.

### Workstream 2: Drone Deployment & Fleet Control (Owner: Sanyam)
- [x] 3D drone flight animation in React / Deck.gl along elevation-aware arcs.
- [x] Export drone waypoints to standard autopilot JSON format (`drone-mission-*.json`).
- [/] **Drone Simulation Engine (`drone/simulation/`):**
  - [ ] Implement standalone Python simulation script in `drone/simulation/` to track fleet status (`PLANNED` $\to$ `ASSIGNED` $\to$ `MOVING` $\to$ `ARRIVED` $\to$ `NODE_ACTIVE`).
  - [ ] Emit drone telemetry events (`DRONE_ASSIGNED`, `DRONE_MOVING`) to FastAPI WebSocket.
- [/] **Mission Planner Integration (`drone/mission/`):**
  - [ ] Create Python utility to generate QGroundControl / MissionPlanner `.waypoints` or `.plan` files from planner output.

### Workstream 3: Adaptive Mesh Network Engine (Owner: Shubham)
- [x] In-process asyncio queue bus for fast, reliable node communication.
- [x] Distance-vector routing with HELLO exchange and split-horizon loop protection.
- [x] Emergency packet forwarding, TTL drop, duplicate suppression, and gateway reverse ACK.
- [x] Fault injection via `kill` and `revive` with dynamic rerouting.
- [x] SOS triage priority ranking store (`sos.py`).
- [ ] **Hardware Gateway Ingestion Script:**
  - [ ] Create a serial bridge script (`backend/gateway/serial_bridge.py`) that reads raw packets from a physical ESP32 connected via USB/UART and injects them into the FastAPI simulation bus as real events.

### Workstream 4: Rescue Backend & Dashboard (Owner: Sarniha)
- [x] FastAPI server with `/plan`, `/simulation/*`, `/sos`, and `/ws/events`.
- [x] Mapbox 3D satellite elevation view with zero-parallax draped layers.
- [x] Real-time WebSocket hook with auto-reconnection and state sync.
- [x] Demo bar with SOS generation, kill/revive controls, and reset.
- [x] SOS triage card feed with ranking, reroute indicators, and delivered flash.
- [x] Dynamic failover banner (`PACKET_REROUTED`, `PACKET_DROPPED`).
- [ ] **Environment & Testing Setup Fix:**
  - [ ] Add `httpx` to `requirements.txt` so `test_api.py` and `test_planner_api.py` run out-of-the-box (`RuntimeError: The starlette.testclient module requires the httpx package`).
- [x] **Right Panel Tabs Implementation:**
  - [x] **Failures Tab:** Real-time list of offline/failed nodes with last distance, "Focus on Map", and "Revive Node" triggers.
  - [x] **Log Tab:** Real-time stream of raw WebSocket network events with category filters and clear action.
  - [x] **Sniffing Tab:** Explanatory panel for Workstream 5 with probe simulation test button.
- [ ] **Gateway Connectivity Status Pill:** Display whether the base station is running in purely simulated mode or connected to a live physical USB gateway.

### Workstream 5: Passive Wi-Fi Search Assistance (Owner: Aman)
- [/] Define `SEARCH_OBSERVATION` event format in `docs/protocol.md`.
- [ ] **Sniffing Simulation / Ingestion (`backend/search/`):**
  - [ ] Implement `backend/search/search_engine.py` simulating or receiving RSSI observations from deployed nodes detecting nearby survivor Wi-Fi probe requests.
  - [ ] Aggregate multi-node signal strengths to compute a probable search centroid and estimated proximity radius.
- [ ] **Dashboard Visualization:**
  - [ ] Render a semi-transparent purple/amber circular search zone on the 3D map for active survivor device hashes.
  - [ ] Connect Right Panel **Sniffing Tab** to display observed MAC hashes, detecting node IDs, RSSI dBm values, and estimated distance.

### Physical Hardware Node (Owner: Sanyam)
- [/] Hardware bill of materials gathered: ESP32 development board, SX1276/SX1262 LoRa module, NEO-6M GPS module, 0.96" I2C OLED display, 18650 Li-ion battery.
- [ ] **Firmware Development (`hardware/esp32/`, `hardware/lora/`, `hardware/gps/`):**
  - [ ] Implement ESP32 captive portal Wi-Fi AP (`DISHA-RESCUE-NET`) serving a lightweight offline HTML emergency form (Category, People, Medical Note).
  - [ ] Implement LoRa packet transmitter sending compact binary/JSON emergency packet on button press or web submission.
  - [ ] Implement OLED status display showing Node ID, GPS coordinates, battery level, and transmission status.
  - [ ] Commit firmware source code into `hardware/`.
- [ ] **Hardware-to-Dashboard Demonstration:**
  - [ ] Demonstrate physical ESP32 sending an SOS packet over LoRa to a receiver ESP32 on the laptop serial port, which appears instantly on the React 3D Dashboard.

### Presentation & Pitch Deck (Owner: Palak)
- [ ] **Pitch Deck Slides (`docs/presentation/`):**
  - [ ] Problem statement: Disaster telecommunication infrastructure collapse (Uttarakhand floods, Wayanad landslides).
  - [ ] System architecture: Planner $\to$ Drones $\to$ Adaptive Mesh $\to$ Dashboard.
  - [ ] Technical innovation: Zero-configuration Wi-Fi captive portal + self-healing LoRa mesh + automated 3D drone planning.
  - [ ] Live demo script: Walk judges through the end-to-end disaster response scenario.
- [ ] **Honesty & Verification Alignment:**
  - [ ] Ensure claims strictly adhere to project honesty rules (1 physical node + software-emulated mesh + simulated drone fleet; no false claims of satellite links or 5 physical drones).

---

## 4. End-to-End Demo Story for Hackathon Judges

When presenting to the evaluation panel, the team will demonstrate the following live narrative:

```mermaid
sequenceDiagram
    autonumber
    actor Judge as Hackathon Judge
    actor Operator as Sarniha (Operator)
    participant UI as 3D Rescue Dashboard
    participant API as FastAPI Backend
    participant Sim as Mesh Simulation Engine
    actor Sanyam as Sanyam (Hardware Node)

    Judge->>Operator: Asks to simulate an earthquake in Dehradun
    Operator->>UI: Enters coordinates (30.3256°N, 77.9423°E) and 4 km² area
    UI->>API: POST /plan (computes optimal hex lattice)
    API-->>UI: Returns 23 nodes with LoRa links & deployment order
    Operator->>UI: Clicks "Simulate 3D Drone Formation"
    UI->>Sim: POST /simulation/start
    UI->>UI: 3D Drones take off in Deck.gl, cruising across satellite terrain to deploy nodes
    Note over UI,Sim: Nodes arrive at targets & transition to ACTIVE (Green)
    Sanyam->>Operator: Triggers hardware node / Operator triggers SOS from NODE-16 (Trapped, 3 people)
    Sim->>Sim: Packet hops: NODE-16 -> NODE-03 -> GATEWAY
    Sim-->>UI: WebSocket emits PACKET_FORWARDED & PACKET_DELIVERED
    UI->>UI: Ranked SOS card appears at #1 with glowing green DELIVERED badge
    Operator->>UI: Selects relay NODE-03 and clicks "Kill Node" (simulating battery failure)
    UI->>Sim: POST /simulation/kill/NODE-03
    Sim-->>UI: NODE-03 turns RED (OFFLINE). Neighbor nodes detect silence.
    Operator->>UI: Sends second SOS from NODE-16
    Sim->>Sim: Router detects failed link to NODE-03, automatically fails over to NODE-09
    Sim-->>UI: Emits PACKET_REROUTED event
    UI->>UI: Pop-up banner: "Route lost at NODE-16. Rerouted via NODE-09."
    UI->>UI: Packet arrives at GATEWAY via new path; new route shown on map
```

---

## 5. How to Run & Validate the Entire Project

### Backend Server
```bash
# In Disha/ directory:
.\venv\Scripts\activate

# Install dependencies (add httpx for test client):
pip install -r requirements.txt
pip install httpx

# Run unit tests:
pytest backend/tests/test_mesh.py

# Start FastAPI server on port 8000:
uvicorn backend.main:app --reload --port 8000
```

### Frontend Rescue Dashboard
```bash
# In Disha/frontend/rescue-dashboard/ directory:
npm install
npm run dev
# Dashboard opens on http://localhost:5173
```

---

*Last Updated:* October 2026  
*Maintained by:* Disha Engineering Team (Shubham, Sanyam, Sarniha, Aman, Palak)
