# ADAPTIVE EMERGENCY COMMUNICATION & RESCUE NETWORK
## Complete Project Architecture & Team Execution Specification

**Hackathon:** National-Level Hackathon — Shivalik College of Engineering, Dehradun  
**Event:** 7–8 October 2026  
**Team Size:** 4  
**Document Purpose:** Single source of truth for what the team is building, who owns what, how the modules connect, what will be demonstrated, and what is future scope.

---

# 1. EXECUTIVE SUMMARY

## 1.1 The Problem

During floods, earthquakes, landslides, fires, or other disasters, normal communication infrastructure may become unavailable or unreliable.

Examples:

- Cellular towers may be damaged or overloaded.
- Internet connectivity may be unavailable.
- Roads may be blocked.
- Rescue teams may not know where communication infrastructure should be placed.
- Survivors may still have phones but no working cellular network.
- Search teams may need additional information about people/devices in the affected area.

Our system creates a **temporary, rapidly deployable emergency communication network**.

The key idea is:

> Instead of depending on pre-deployed infrastructure that can itself be destroyed, rescue teams can plan and deploy temporary communication nodes after a disaster.

The system combines:

1. **Disaster Deployment Planner**
2. **Drone-Based Node Positioning / Deployment**
3. **Adaptive Emergency Communication Mesh**
4. **Passive Wi-Fi Search Assistance**
5. **Rescue Dashboard**

---

# 2. THE COMPLETE IDEA IN ONE FLOW

```text
                    DISASTER OCCURS
                           │
                           ▼
              ┌─────────────────────────┐
              │ 1. DEPLOYMENT PLANNER   │
              │                         │
              │ Area dimensions         │
              │ Disaster coordinates    │
              │ Wi-Fi range assumption  │
              │ LoRa range assumption   │
              └────────────┬────────────┘
                           │
                  Optimized node
                  coordinates
                           │
                           ▼
              ┌─────────────────────────┐
              │ 2. DRONE SYSTEM         │
              │                         │
              │ Target coordinates     │
              │ Flight/deployment plan │
              └────────────┬────────────┘
                           │
                    Nodes positioned
                           │
                           ▼
       ┌────────────────────────────────────────┐
       │ 3. ADAPTIVE EMERGENCY MESH            │
       │                                        │
       │ Survivor                               │
       │    │                                   │
       │    ▼ Wi-Fi                             │
       │ ESP32 Emergency Node                   │
       │    │                                   │
       │    ▼ LoRa                              │
       │ Node ─── Node ─── Node                 │
       │    \       │       /                   │
       │       ─ Gateway ─                     │
       └────────────┬───────────────────────────┘
                    │
                    ▼
          ┌─────────────────────┐
          │ RESCUE DASHBOARD    │
          │                     │
          │ Emergency requests │
          │ Node status        │
          │ Map                │
          │ Routes             │
          │ Alerts             │
          └─────────────────────┘


Parallel assistance:

 Detectable Wi-Fi activity
            │
            ▼
       ESP32 sniffing
            │
            ▼
 Probable proximity/search area
            │
            ▼
      Rescue team
```

---

# 3. IMPORTANT ARCHITECTURE DECISION

## We are NOT building a permanent pre-deployed network.

The system does **not** depend on nodes already being installed throughout a city.

Instead:

```text
Disaster
   ↓
Rescue team defines affected area
   ↓
Software calculates deployment
   ↓
Drones position/carry nodes
   ↓
Temporary mesh becomes active
   ↓
Survivors communicate
   ↓
Rescue team receives requests
```

### Why?

Permanent/pre-deployed infrastructure can also be:

- destroyed,
- inaccessible,
- powered off,
- damaged,
- expensive to maintain.

Our approach focuses on **rapid post-disaster deployment**.

---

# 4. FOUR CORE MODULES

## MODULE 1 — DISASTER DEPLOYMENT PLANNER

### Goal

Determine an effective temporary node deployment for a disaster area.

### Input

Rescue operator provides:

- Disaster area latitude
- Disaster area longitude
- Area length
- Area width
- Wi-Fi coverage assumption/range
- LoRa communication assumption/range
- Gateway location
- Optional obstacles/restricted areas

Example:

```text
Area:
2 km × 2 km

Area:
4 km²

Center:
Latitude = ...
Longitude = ...
```

### Output

The planner produces:

- estimated number of nodes,
- node coordinates,
- gateway location,
- coverage visualization,
- LoRa connectivity graph,
- deployment order,
- drone target coordinates.

### Critical design rule

A node placement is valid only if BOTH conditions are satisfied:

### A. Survivor coverage

The affected area should be covered by the local Wi-Fi service areas.

### B. Mesh connectivity

The nodes must form a connected LoRa graph that can reach the gateway.

Therefore:

```text
Wi-Fi Coverage
      +
LoRa Connectivity
      +
Gateway Reachability
      =
Valid Deployment
```

Do NOT claim that the software calculates an "absolute minimum" unless mathematically verified.

Use:

> "minimum/optimized deployment under selected coverage and connectivity assumptions."

---

# 5. DEPLOYMENT PLANNER LOGIC

For the prototype, use a practical grid/optimization approach rather than attempting a research-grade global optimization algorithm.

## Step 1 — Define affected area

Represent the disaster area as:

```text
        2 km
  ┌───────────────┐
  │               │
  │               │
2 │               │
km│               │
  │               │
  │               │
  └───────────────┘
```

## Step 2 — Generate candidate node positions

Possible positions are generated across the area.

## Step 3 — Check Wi-Fi coverage

For each candidate node:

```text
        Wi-Fi
       coverage

        (   )
      (   N   )
        (   )
```

Check whether the affected area is covered.

## Step 4 — Check LoRa connectivity

Create a graph:

```text
N1 ─── N2 ─── N3
      │        │
      N4 ───── N5
               │
             Gateway
```

An edge exists when two nodes are considered able to communicate under the selected LoRa range/model.

## Step 5 — Validate gateway reachability

Every deployed communication region must have a path to the gateway.

## Step 6 — Optimize

Prefer:

- fewer nodes,
- good coverage,
- connected topology,
- reasonable distances,
- feasible drone deployment.

---

# 6. RANGE ASSUMPTIONS

The software must NOT hard-code marketing claims as guaranteed physical performance.

## Wi-Fi

ESP32 Wi-Fi range depends on:

- antenna,
- transmit power,
- environment,
- walls,
- terrain,
- interference,
- phone orientation.

Use a configurable/tested value in the planner.

Example:

```text
Wi-Fi planning range = configurable
```

## LoRa

LoRa range also depends heavily on:

- frequency,
- antenna,
- spreading factor,
- bandwidth,
- transmit power,
- terrain,
- obstacles,
- elevation.

For conceptual planning, rough ranges may be used, but the final demo should clearly label them as assumptions unless physically measured.

Possible planning assumptions:

```text
Urban/built-up:
~0.5–2 km

Open line-of-sight:
~2–5 km

Elevated/unobstructed:
potentially farther
```

These are NOT guaranteed project specifications.

The planner should allow the range to be changed.

---

# 7. MODULE 2 — DRONE DEPLOYMENT / FLIGHT CONTROL

## Goal

Move communication nodes to the coordinates calculated by Module 1.

The deployment planner gives:

```text
Node 1 → Coordinate A
Node 2 → Coordinate B
Node 3 → Coordinate C
...
```

The drone subsystem converts these into missions.

---

# 8. TWO DRONE OPERATING MODES

## MODE A — NODE DEPLOYMENT

Drone carries the node and places it at the desired location.

```text
Drone
  │
  ▼
Node
  │
  ▼
Target location
```

The node then operates independently.

## MODE B — ELEVATED RELAY

If physical deployment is not practical:

```text
Drone
  │
  └── Communication node attached
              │
              ▼
       Elevated relay
```

The drone carries the node and positions itself at the required coordinate/altitude.

This can improve communication geometry by reducing obstacles, but introduces:

- battery limitations,
- flight time limitations,
- payload limitations,
- safety/regulatory constraints.

### Demo priority

For the hackathon, a **simulation of drone movement/mission planning** is acceptable if actual autonomous flight integration is not implemented.

Never claim autonomous flight if we only simulate it.

---

# 9. DRONE INPUT/OUTPUT

### Input

```text
Target latitude
Target longitude
Optional altitude
Node ID
```

### Output

```text
Mission created
Drone moving
Drone reached target
Node deployed/positioned
Node active
```

Example:

```text
NODE-01
Target:
28.xxxxxx, 77.xxxxxx

Status:
PLANNED → MOVING → ARRIVED → ACTIVE
```

---

# 10. MODULE 3 — ADAPTIVE EMERGENCY COMMUNICATION MESH

This is the core networking module.

## Main flow

```text
Survivor phone
      │
      │ Wi-Fi
      ▼
ESP32 Node A
      │
      │ LoRa
      ▼
ESP32 Node B
      │
      │ LoRa
      ▼
ESP32 Node C
      │
      ▼
Gateway
      │
      ▼
Rescue Backend
      │
      ▼
Dashboard
```

---

# 11. SURVIVOR EXPERIENCE

The survivor does NOT need cellular internet for the local emergency interface.

Example:

```text
Phone
  ↓
Connect to:
"Emergency-Network"

  ↓

Local emergency page

  ↓

Select:
[Medical Emergency]
[Trapped]
[Food/Water]
[Fire]
[Missing Person]
[Other]

  ↓

Optional message

  ↓

Location if available

  ↓

SEND
```

Important terminology:

Unless we actually implement carrier SMS, call these:

> emergency requests/messages

Do not call them normal cellular SMS.

---

# 12. NODE RESPONSIBILITIES

Every communication node conceptually contains:

```text
ESP32
│
├── Wi-Fi access/interface
│
├── LoRa radio
│
├── Node identity
│
├── Routing logic
│
├── Packet forwarding
│
├── Duplicate detection
│
├── TTL / hop protection
│
├── ACK handling
│
├── Optional GPS
│
└── Optional OLED/status display
```

---

# 13. HOW A NODE KNOWS WHERE TO FORWARD

LoRa itself does NOT automatically create a mesh.

Our software creates the mesh behavior.

Each node maintains a distributed view of available network topology.

Conceptually:

```text
Node A knows:
A → B
A → C

Node B knows:
B → A
B → C
B → D

Node C knows:
C → A
C → B
C → D
C → Gateway
```

The node then determines:

```text
Destination = Gateway

Best next hop = C
```

The node forwards to C.

---

# 14. ROUTING DESIGN

Initial prototype:

```text
HELLO
  ↓
Neighbor discovery
  ↓
Topology information
  ↓
Routing table
  ↓
Best next hop
  ↓
Forward
```

Possible route cost:

```text
Route Cost =
hop count
+
link quality
+
packet loss
+
latency
+
node availability
+
battery status
```

### Important

Do not implement every metric immediately.

The first working routing engine should use a simple, explainable metric such as:

```text
lowest valid path cost / hop count
```

Then add adaptive metrics if time permits.

---

# 15. ADAPTIVE ROUTING

Suppose:

```text
A → B → C → Gateway
```

and B fails.

The system should detect the failed route.

If another route exists:

```text
A → D → C → Gateway
```

the node can select the alternative route.

Conceptually:

```text
Normal:

A ─ B ─ C ─ Gateway

Failure:

A ─ X ─ C ─ Gateway

Alternative:

A ─ D ─ C ─ Gateway
```

This is what makes the network adaptive.

---

# 16. PACKET DESIGN

Every message should use a structured packet.

Example:

```json
{
  "packet_id": "PKT-001",
  "packet_type": "EMERGENCY",
  "source": "NODE-A",
  "destination": "GATEWAY",
  "payload": {
    "type": "MEDICAL",
    "message": "Person injured"
  },
  "hop_count": 2,
  "ttl": 10,
  "timestamp": "..."
}
```

Important fields:

- packet ID
- packet type
- source
- destination
- payload
- hop count
- TTL
- timestamp

Possible future fields:

- route cost
- priority
- GPS
- battery
- link quality

---

# 17. DUPLICATE PACKET PROTECTION

In a mesh, multiple routes can cause the same packet to arrive more than once.

Therefore nodes maintain recently seen packet IDs.

Example:

```text
PKT-001 received
PKT-001 already seen
→ DROP duplicate
```

This prevents unnecessary forwarding loops.

---

# 18. TTL / HOP LIMIT

A packet should not circulate forever.

Example:

```text
TTL = 10
```

Each forwarding operation decreases TTL.

```text
10 → 9 → 8 → 7 → ...
```

If TTL reaches zero:

```text
DROP PACKET
```

This provides protection against routing loops.

---

# 19. ACKNOWLEDGEMENT

There are two different concepts:

### Transport reliability

TCP can provide reliable delivery between software-emulated nodes.

### Application-level acknowledgement

Our emergency-network protocol can also acknowledge receipt of an emergency packet.

Correct judge explanation:

> "TCP provides reliable transport between our software-emulated nodes. Our application-level ACK represents acknowledgement at the emergency-network protocol layer, which becomes important when the same packet logic is adapted to a radio-based multi-hop network."

---

# 20. CURRENT NETWORK ENGINE MILESTONE

Already implemented:

```text
Software Node A
      │
      │ real TCP
      ▼
Software Node B
```

Working:

- structured HELLO packet,
- packet serialization,
- packet ID,
- source/destination,
- packet type,
- payload,
- application ACK.

Current project structure:

```text
emergency-network/
│
├── backend/
│   ├── node.py
│   ├── packet.py
│   └── config.py
│
└── README.md
```

Example:

```bash
python node.py --id NODE-A --port 5001
python node.py --id NODE-B --port 5002
```

This is a **software-emulated network**, not a physical LoRa mesh.

---

# 21. IMPORTANT HARDWARE REALITY

We currently have approximately:

```text
1 physical communication node
```

A genuine physical multi-hop LoRa mesh requires multiple LoRa-capable endpoints.

Therefore:

### Real hardware

- one ESP32-based node,
- LoRa radio,
- GPS,
- OLED,
- power system.

### Software emulation

- additional virtual/software nodes,
- routing,
- multi-hop topology,
- failure scenarios,
- deployment simulation.

### Never claim:

"Five physical LoRa nodes are communicating"

unless five physical LoRa endpoints actually exist and have been tested.

---

# 22. MODULE 4 — PASSIVE WI-FI SEARCH ASSISTANCE

This is an additional rescue-support feature.

## Problem

Some phones may not automatically connect to or present the local emergency Wi-Fi interface.

We can investigate whether nearby Wi-Fi activity is detectable by ESP32 promiscuous/sniffing mode.

Conceptually:

```text
Nearby phone/device
       │
       │ detectable Wi-Fi activity
       ▼
ESP32 sniffing node
       │
       ▼
Observation
       │
       ▼
Probable proximity/search area
```

---

# 23. CRITICAL LIMITATION OF WI-FI SNIFFING

Do NOT claim:

> "ESP32 can exactly locate every phone."

That is incorrect.

Detection depends on:

- phone behavior,
- Wi-Fi state,
- privacy/randomization mechanisms,
- packet activity,
- environment.

A single ESP32 also cannot automatically determine exact direction.

Safer project statement:

> "If a nearby device emits detectable Wi-Fi activity, multiple nodes can use observations such as signal strength to estimate a probable proximity/search area. This is an assistive search feature, not exact phone tracking."

---

# 24. RESCUE DASHBOARD

The dashboard is the command center.

It should show:

## Map

```text
┌─────────────────────────────────────┐
│                                     │
│       N1 ───── N2                   │
│        │       /                    │
│        │      /                     │
│       N3 ─── N4 ───── Gateway       │
│                                     │
│       Disaster Area                 │
│                                     │
└─────────────────────────────────────┘
```

## Dashboard information

- disaster area,
- node locations,
- drone positions,
- node status,
- mesh connections,
- gateway,
- emergency requests,
- route/path,
- packet movement,
- deployment progress,
- search-assistance observations.

---

# 25. DASHBOARD TECHNOLOGY

Recommended:

```text
Frontend:
React

Backend:
FastAPI

Real-time:
WebSockets

Database:
PostgreSQL / SQLAlchemy if needed

Networking simulation:
Python

Maps:
Map-based visualization

Hardware:
ESP32 + LoRa + GPS + OLED
```

The dashboard should not become the router.

The routing logic belongs to the network engine.

---

# 26. FINAL SYSTEM ARCHITECTURE

```text
                    ┌──────────────────────────┐
                    │ DISASTER OPERATOR        │
                    └────────────┬─────────────┘
                                 │
                                 ▼
                    ┌──────────────────────────┐
                    │ DEPLOYMENT PLANNER       │
                    │                          │
                    │ Area + coordinates       │
                    │ Wi-Fi assumptions        │
                    │ LoRa assumptions         │
                    └────────────┬─────────────┘
                                 │
                         Node coordinates
                                 │
                                 ▼
                    ┌──────────────────────────┐
                    │ DRONE MISSION SYSTEM     │
                    │                          │
                    │ Target coordinates       │
                    │ Mission simulation       │
                    │ Node deployment          │
                    └────────────┬─────────────┘
                                 │
                                 ▼
              ┌────────────────────────────────────────┐
              │       ADAPTIVE MESH NETWORK            │
              │                                        │
              │  Survivor                               │
              │      │ Wi-Fi                            │
              │      ▼                                  │
              │    Node A                               │
              │      │                                  │
              │     LoRa                                │
              │      ▼                                  │
              │    Node B ───── Node C                  │
              │       \          │                      │
              │        \         │                      │
              │          ─── Gateway                    │
              └──────────────────┬───────────────────────┘
                                 │
                                 ▼
                    ┌──────────────────────────┐
                    │ FASTAPI BACKEND          │
                    │                          │
                    │ Requests                 │
                    │ Node state               │
                    │ Events                   │
                    │ WebSockets               │
                    └────────────┬─────────────┘
                                 │
                                 ▼
                    ┌──────────────────────────┐
                    │ REACT RESCUE DASHBOARD  │
                    └──────────────────────────┘


        PARALLEL SEARCH ASSISTANCE

 Wi-Fi activity → ESP32 sniffing → observation
                                      │
                                      ▼
                               probable area
                                      │
                                      ▼
                                rescue team
```

---

# 27. TEAM OF 5 — WORK DISTRIBUTION

The project is divided into **5 major technical workstreams**, with one primary owner for each.

There are now **5 team members**:

1. **Shubham** — Deployment Planner + Adaptive Network
2. **Palak** — PPT + Presentation
3. **Sanyam** — Hardware + Drone
4. **Sarniha** — Backend + React Dashboard
5. **Aman** — Passive Search Assistance + Rescue Intelligence

This is intentionally structured so every technical member has a clear ownership area.

---

# 28. THE FIVE TECHNICAL WORKSTREAMS

```text
WORKSTREAM 1
Deployment Planner
        │
        ▼
WORKSTREAM 2
Drone Deployment / Positioning
        │
        ▼
WORKSTREAM 3
Adaptive Emergency Communication Mesh
        │
        ▼
WORKSTREAM 4
Rescue Backend + Dashboard
        │
        ▼
WORKSTREAM 5
Passive Search Assistance
```

Palak works across all five from the **presentation layer**, but does not own technical implementation.

---

# WORKSTREAM 1 — DISASTER DEPLOYMENT PLANNER

## Owner: SHUBHAM

### Goal

Given a disaster area and communication assumptions, determine an effective temporary node deployment.

### Build

- disaster area input,
- latitude/longitude,
- area dimensions,
- configurable Wi-Fi range,
- configurable LoRa range,
- candidate node positions,
- Wi-Fi coverage calculation,
- LoRa connectivity graph,
- gateway reachability,
- optimized node placement,
- node coordinates,
- deployment topology.

### Output

```text
Area
  ↓
Coverage analysis
  ↓
Node positions
  ↓
LoRa topology
  ↓
Gateway-connected deployment
```

### Main deliverable

A planner that produces node coordinates and the connectivity topology needed by the drone and network modules.

---

# WORKSTREAM 2 — DRONE DEPLOYMENT / POSITIONING

## Owner: SANYAM

### Goal

Take the coordinates generated by the planner and represent how drones position the communication nodes.

### Build

- drone identity,
- target coordinates,
- mission creation,
- movement simulation,
- arrival state,
- node deployment/activation,
- optional real drone integration.

### State flow

```text
PLANNED
   ↓
ASSIGNED
   ↓
MOVING
   ↓
ARRIVED
   ↓
NODE ACTIVE
```

### Two operating modes

#### Mode A — Deploy node

Drone carries node and places it at target.

#### Mode B — Elevated relay

Node remains attached to drone and drone positions itself at target.

### Hackathon priority

If autonomous flight is not implemented:

> Demonstrate drone mission planning and movement in software.

Do not claim autonomous flight unless it is actually working.

---

# WORKSTREAM 3 — ADAPTIVE EMERGENCY COMMUNICATION MESH

## Owner: SHUBHAM

This is the core networking workstream.

### Build

- packet protocol,
- software node,
- neighbor discovery,
- topology,
- routing table,
- next-hop selection,
- forwarding,
- packet ID tracking,
- duplicate prevention,
- TTL,
- ACK,
- gateway,
- route failure detection,
- alternate route selection.

### Network flow

```text
Survivor
   │
 Wi-Fi
   ▼
NODE-A
   │
 LoRa
   ▼
NODE-B
   │
 LoRa
   ▼
NODE-C
   │
   ▼
GATEWAY
```

### Adaptive behavior

Normal:

```text
A → B → C → Gateway
```

Failure:

```text
A → B  X
```

Alternative:

```text
A → D → C → Gateway
```

### Existing foundation

Already working:

```text
NODE-A → NODE-B
```

using real TCP between software-emulated nodes, with structured packets and application-level ACK.

The next progression is:

```text
2 nodes
  ↓
3 nodes
  ↓
multi-hop
  ↓
routing
  ↓
failure
  ↓
alternate route
  ↓
gateway
```

---

# WORKSTREAM 4 — RESCUE BACKEND + DASHBOARD

## Owner: SARNIHA

This is the command center of the project.

### Backend

Use:

```text
FastAPI
WebSockets
```

### Frontend

Use:

```text
React
```

### Build

#### Dashboard

- disaster map,
- affected area,
- node markers,
- drone markers,
- gateway,
- mesh connections,
- node status,
- emergency requests,
- packet movement,
- route information,
- deployment progress,
- failure alerts,
- search observations.

#### Backend

- receive network events,
- receive planner output,
- receive drone status,
- maintain current system state,
- push real-time events through WebSockets.

### Critical architecture rule

The dashboard is **NOT the router**.

The network engine decides forwarding.

The dashboard visualizes system state and provides operator controls.

---

# WORKSTREAM 5 — PASSIVE SEARCH ASSISTANCE + RESCUE INTELLIGENCE

## Owner: AMAN

This is the fifth independent technical workstream.

### Goal

Explore how the deployed ESP32 nodes can provide additional information to the rescue team beyond emergency messages.

The first feature is passive Wi-Fi search assistance.

### Core concept

```text
Nearby device
      │
      ▼
ESP32 sniffing
      │
      ▼
Wi-Fi observation
      │
      ▼
RSSI / signal information
      │
      ▼
Probable proximity/search area
      │
      ▼
Rescue dashboard
```

### Aman owns

- ESP32 promiscuous/sniffing research,
- Wi-Fi observation collection,
- RSSI extraction,
- observation data format,
- testing device detection,
- search-area estimation experiments,
- integration of observations into the dashboard,
- rescue-intelligence UI requirements,
- documenting limitations.

### Important limitation

Never claim:

> "We can exactly locate every phone."

Correct claim:

> "If a nearby device emits detectable Wi-Fi activity, observations from deployed nodes can potentially provide a probable proximity/search area. This is an assistive search feature, not exact phone tracking."

### Phase 1

First prove:

```text
ESP32
 ↓
Detectable Wi-Fi activity
 ↓
Observation
 ↓
RSSI
```

### Phase 2

Investigate:

```text
Multiple nodes
 ↓
Multiple observations
 ↓
Relative signal comparison
 ↓
Probable search region
```

### Phase 3 — only if time permits

Visualize:

```text
Possible search area
       ↓
Heatmap / confidence region
       ↓
Rescue dashboard
```

### Priority

This is an important extension, but the core emergency communication system takes priority if time becomes limited.

---

# 29. PALAK — PPT & PRESENTATION ONLY

## Owner: PALAK

Palak is **not responsible for technical implementation**.

Her complete ownership is:

### PPT

Build and maintain the final presentation covering:

1. Problem
2. Existing limitation
3. Our solution
4. Why post-disaster deployment
5. Five technical workstreams
6. System architecture
7. Deployment planner
8. Drone deployment
9. Adaptive mesh
10. Rescue dashboard
11. Search assistance
12. Hardware prototype
13. Demo
14. Results
15. Limitations
16. Future scope
17. Impact

### Presentation visuals

Create:

- architecture diagrams,
- workflow diagrams,
- before/after visuals,
- deployment illustrations,
- demo screenshots,
- hardware photographs,
- final architecture slide.

### Presentation coordination

Palak coordinates the final explanation order:

```text
Problem
  ↓
Planner
  ↓
Drone
  ↓
Mesh
  ↓
Dashboard
  ↓
Search assistance
  ↓
Demo
  ↓
Impact + future
```

She should understand the full project, but she does not need to write the technical modules.

---

# 30. TEAM OWNERSHIP MATRIX

| Workstream | Primary Owner | Supporting Owner |
|---|---|---|
| 1. Deployment Planner | **Shubham** | Sarniha |
| 2. Drone Deployment | **Sanyam** | Shubham |
| 3. Adaptive Mesh | **Shubham** | Sanyam |
| 4. Backend + React Dashboard | **Sarniha** | Shubham |
| 5. Passive Search + Rescue Intelligence | **Aman** | Sanyam + Sarniha |
| PPT / Presentation | **Palak** | Everyone provides material |

---

# 31. WHAT EACH PERSON SHOULD BUILD TOWARDS

## SHUBHAM — ARCHITECTURE + NETWORK

Your final chain:

```text
Deployment Planner
       ↓
Node topology
       ↓
Network engine
       ↓
Routing
       ↓
Failure recovery
       ↓
Gateway
       ↓
Dashboard events
```

You own the system architecture and the core networking logic.

You are also responsible for making sure the modules built by the team actually integrate into one coherent system.

---

## SANYAM — HARDWARE + DRONE

Your final chain:

```text
ESP32
 ↓
LoRa
 ↓
GPS
 ↓
OLED
 ↓
Physical node
 ↓
Drone
 ↓
Node positioning
```

You own the physical-world side.

---

## SARNIHA — BACKEND + DASHBOARD

Your final chain:

```text
FastAPI
 ↓
WebSocket
 ↓
React
 ↓
Map
 ↓
Nodes
 ↓
Drones
 ↓
Packets
 ↓
Emergency alerts
```

You own the rescue command center.

---

## AMAN — SEARCH + RESCUE INTELLIGENCE

Your final chain:

```text
ESP32 Wi-Fi observation
        ↓
RSSI / device observation
        ↓
Multiple-node analysis
        ↓
Probable search area
        ↓
Rescue intelligence
        ↓
Dashboard
```

You own the additional intelligence that helps rescuers search for people/devices when a normal emergency request may not be available.

---

## PALAK — PRESENTATION

Your final chain:

```text
Technical work from everyone
          ↓
        PPT
          ↓
   Project story
          ↓
   Demo narration
          ↓
    Judge explanation
```

You own how the complete project is communicated to judges.

---

# 32. PARALLEL WORK STRATEGY

All five workstreams can begin independently.

## Shubham starts with

```text
Planner data model
+
Network engine
```

## Sanyam starts with

```text
Physical node
+
Drone mission simulation
```

## Sarniha starts with

```text
React dashboard
+
FastAPI/WebSocket event model
```

## Aman starts with

```text
ESP32 sniffing experiment
+
Search observation data model
```

## Palak starts with

```text
PPT
+
architecture visuals
+
problem/solution story
```

No person needs to wait for the others to finish their entire module.

Integration happens through common data contracts.

---

# 33. PRIORITY ORDER

Not all five workstreams are equally critical.

## PRIORITY 1 — MUST WORK

```text
Deployment Planner
Adaptive Mesh
Dashboard
```

## PRIORITY 2 — STRONG DEMO

```text
Drone deployment
Physical ESP32/LoRa node
```

## PRIORITY 3 — ADVANCED FEATURE

```text
Passive Wi-Fi search assistance
```

## PRESENTATION

```text
Palak works continuously in parallel.
```

If time becomes short:

> Do NOT sacrifice the core communication network for the search-assistance feature.

The core project remains:

```text
PLAN → DEPLOY → CONNECT → ADAPT → DELIVER
```

Search assistance is an additional rescue capability.


# 31. TEAM INTERFACE CONTRACT

Everyone must build against common data formats.

## Node

```json
{
  "id": "NODE-01",
  "lat": 28.123,
  "lon": 77.123,
  "status": "ACTIVE"
}
```

## Drone

```json
{
  "id": "DRONE-01",
  "lat": 28.123,
  "lon": 77.123,
  "target_lat": 28.130,
  "target_lon": 77.130,
  "status": "MOVING"
}
```

## Emergency packet

```json
{
  "packet_id": "PKT-001",
  "source": "NODE-03",
  "destination": "GATEWAY",
  "type": "MEDICAL",
  "payload": {
    "message": "Person injured"
  }
}
```

## Network event

```json
{
  "event": "PACKET_FORWARDED",
  "packet_id": "PKT-001",
  "from": "NODE-02",
  "to": "NODE-03"
}
```

---

# 32. GIT / REPOSITORY STRUCTURE

Recommended:

```text
emergency-network/
│
├── backend/
│   ├── node/
│   ├── routing/
│   ├── gateway/
│   ├── deployment/
│   └── simulation/
│
├── frontend/
│   └── rescue-dashboard/
│
├── hardware/
│   ├── esp32/
│   ├── lora/
│   └── gps/
│
├── drone/
│   ├── mission/
│   └── simulation/
│
├── docs/
│   ├── architecture.md
│   ├── protocol.md
│   └── demo.md
│
├── README.md
└── requirements.txt
```

If the team prefers separate repositories, keep the same logical module boundaries.

---

# 33. THREE MAJOR IMPLEMENTATION PHASES

We intentionally avoid creating 15 tiny phases.

## PHASE 1 — CORE SYSTEM

### Goal

Make the complete logical system work in software.

Includes:

- deployment planner,
- node placement,
- network engine,
- multi-hop simulation,
- routing,
- gateway,
- basic dashboard.

End state:

```text
Planner
   ↓
Virtual nodes
   ↓
Mesh
   ↓
Gateway
   ↓
Dashboard
```

---

# PHASE 2 — VISUAL + DRONE INTEGRATION

### Goal

Make the system look like a real rescue operation.

Includes:

- map,
- node animation,
- drone movement,
- deployment sequence,
- packet movement,
- emergency request animation,
- real-time dashboard,
- polished UI.

End state:

```text
Disaster
 ↓
Planner
 ↓
Drones move
 ↓
Nodes activate
 ↓
Mesh forms
 ↓
Survivor request travels
 ↓
Dashboard receives
```

---

# PHASE 3 — HARDWARE + FAILURE + ADVANCED FEATURES

### Goal

Connect the physical prototype and demonstrate resilience.

Includes where feasible:

- ESP32 Wi-Fi,
- LoRa,
- GPS,
- OLED,
- physical node,
- software/hardware boundary,
- route failure,
- alternate route,
- sniffing/search proof-of-concept,
- drone hardware.

Anything not physically verified remains labelled as simulation/planned.

---

# 34. DEMO STORY — WHAT JUDGES SHOULD SEE

The demo should tell a story, not just show code.

## SCENE 1 — DISASTER

Show:

```text
Flood / disaster affected area
```

Narration:

> "After a disaster, conventional communication infrastructure may be unavailable. Our first problem is therefore not only communication, but deciding where temporary infrastructure should be deployed."

---

## SCENE 2 — PLANNER

Operator enters:

```text
Area = 2 km × 2 km
Latitude = ...
Longitude = ...
```

System calculates:

```text
Optimized deployment:
N1
N2
N3
N4
Gateway
```

Map shows coverage and connectivity.

---

## SCENE 3 — DRONES

Drone missions appear:

```text
DRONE-01 → N1
DRONE-02 → N2
DRONE-03 → N3
```

Drones move to coordinates.

Nodes become:

```text
PLANNED
   ↓
MOVING
   ↓
ACTIVE
```

---

## SCENE 4 — MESH FORMS

Show actual logical connections:

```text
N1 ─ N2 ─ N3
     │     │
     N4 ─ Gateway
```

The dashboard shows the network becoming active.

---

## SCENE 5 — SURVIVOR REQUEST

Phone connects to local emergency Wi-Fi.

Select:

```text
MEDICAL EMERGENCY
```

Send request.

---

## SCENE 6 — PACKET TRAVELS

Animate:

```text
Phone
 ↓
N1
 ↓
N2
 ↓
N3
 ↓
Gateway
 ↓
Dashboard
```

Show packet ID:

```text
PKT-001
```

---

## SCENE 7 — RESCUE DASHBOARD

Dashboard displays:

```text
🚨 EMERGENCY REQUEST

Type:
MEDICAL

Source:
NODE-01

Packet:
PKT-001

Route:
NODE-01 → NODE-02 → NODE-03 → GATEWAY

Status:
DELIVERED
```

---

## SCENE 8 — FAILURE

Disable:

```text
NODE-02
```

Show route failure.

System recalculates:

```text
OLD:
N1 → N2 → N3 → Gateway

NEW:
N1 → N4 → N3 → Gateway
```

This is one of the strongest demonstrations because it proves the word **adaptive**.

---

## SCENE 9 — SEARCH ASSISTANCE

Show a detectable Wi-Fi observation.

Do NOT say:

> "We found the exact phone location."

Say:

> "This observation can provide a probable proximity/search area when a device emits detectable Wi-Fi activity."

---

# 35. HARDWARE DEMO

The physical node should prove the real hardware layer.

Possible demonstration:

```text
Phone
 ↓ Wi-Fi
Physical ESP32
 ↓
LoRa transmission
```

Depending on what is actually tested.

The software network can then demonstrate the larger multi-node topology.

### Judge-safe statement

> "Our physical prototype validates the hardware communication layer, while additional nodes in the large-scale demonstration are software-emulated because building several physical LoRa nodes would increase prototype cost. We clearly distinguish the two."

This is much better than pretending the emulated nodes are physical.

---

# 36. DEMO STATUS LABELS

Every feature must have one status:

### BUILT

Implemented in code.

### TESTED

Actually executed and verified.

### SIMULATED / EMULATED

Software representation of a physical or distributed component.

### PLANNED

Architecture defined but implementation incomplete.

### FUTURE

Possible extension beyond the hackathon prototype.

Never mix these categories during the presentation.

---

# 37. CURRENT STATUS

## BUILT / VERIFIED

### Software networking

```text
Node A
  ↓ TCP
Node B
```

Includes:

- structured packet,
- HELLO,
- packet ID,
- source,
- destination,
- payload,
- application ACK.

## PHYSICAL PROTOTYPE

One physical node exists with approximately:

- ESP32,
- LoRa,
- GPS,
- OLED,
- battery/power.

Exact features must be marked tested only after actual testing.

---

# 38. WHAT WE SHOULD NOT CLAIM

Never claim the following unless actually implemented/tested:

- 5 physical LoRa nodes,
- guaranteed 5 km LoRa range,
- exact survivor GPS without phone GPS,
- exact phone location from sniffing,
- automatic connection on every phone,
- autonomous drone flight,
- automatic physical node deployment,
- internet-independent global dashboard,
- satellite connectivity,
- cellular backup,
- perfect routing,
- guaranteed disaster-area coverage,
- absolute mathematically minimum number of nodes.

---

# 39. KEY LIMITATIONS

## 1. Hardware scale

Multiple physical LoRa nodes increase cost.

Solution:

- one physical hardware validation node,
- software-emulated nodes for large topology demonstration.

## 2. Wi-Fi phone compatibility

Not every phone will automatically connect to the emergency network.

Solution:

- provide manual Wi-Fi connection flow,
- investigate passive Wi-Fi observation as an additional search aid.

## 3. LoRa range

Range is environmental and configuration-dependent.

Solution:

- configurable planning values,
- physical testing,
- conservative assumptions.

## 4. Drone battery

Continuous airborne relays have limited flight time.

Solution:

- prefer deploy-and-leave nodes where practical,
- use elevated relay mode as an alternative.

## 5. GPS

GPS may be unavailable/weak indoors or in obstructed environments.

Solution:

- use node location as area/reference information,
- never represent it as exact survivor location.

## 6. Privacy

Passive Wi-Fi detection has privacy and technical limitations.

Solution:

- treat it as rescue assistance,
- do not claim exact tracking.

---

# 40. FUTURE SCOPE

After the hackathon, the project can evolve into:

## Advanced deployment optimization

- terrain-aware planning,
- building/obstacle maps,
- elevation models,
- weather,
- flood maps,
- restricted zones,
- battery-aware drone planning.

## Advanced routing

- link-quality routing,
- dynamic metrics,
- battery-aware routing,
- congestion-aware routing,
- predictive route failure.

## More physical nodes

A production prototype could use:

- multiple LoRa nodes,
- solar charging,
- rugged enclosures,
- waterproofing,
- long-duration batteries.

## Advanced drone system

- autonomous waypoint navigation,
- multiple drones,
- automated node release,
- return-to-base,
- battery-aware mission planning.

## Localization

- multi-node RSSI localization,
- time-based localization,
- specialized direction-finding hardware,
- sensor fusion.

## Security

Future versions should add:

- authenticated packets,
- encryption,
- replay protection,
- secure node registration,
- emergency-priority controls.

## Production deployment

Potential use:

- flood rescue,
- earthquake response,
- landslide areas,
- forest fires,
- remote disaster zones,
- temporary relief camps,
- large-event emergency communication.

---

# 41. WHY THE SYSTEM IS ADAPTIVE

The word "adaptive" must have a clear technical meaning.

Our system adapts at multiple levels:

### Deployment adaptation

The node layout is generated according to the affected area and communication constraints.

### Routing adaptation

The network can choose an alternative route when the preferred path fails.

### Infrastructure adaptation

Nodes can be positioned after the disaster rather than depending entirely on permanent infrastructure.

### Search adaptation

The rescue team can use available Wi-Fi observations as an additional search signal.

Therefore:

> "Adaptive" means the system can adapt deployment and communication paths to changing disaster conditions instead of relying on a fixed communication topology.

---

# 42. THE ONE-SENTENCE PITCH

> "Our system rapidly creates a temporary emergency communication network after a disaster by calculating where nodes should be placed, positioning them using drones, forming an adaptive LoRa mesh, and delivering survivor emergency requests to a rescue dashboard even when conventional communication infrastructure is unavailable."

---

# 43. 30-SECOND EXPLANATION

> "Imagine a flood destroys cellular connectivity across a 2-by-2 kilometre area. Instead of depending on pre-installed infrastructure, our rescue team enters the affected area's coordinates and dimensions into our deployment planner. The system calculates an optimized placement of temporary communication nodes considering both survivor Wi-Fi coverage and LoRa mesh connectivity. Drones then position those nodes. Once deployed, the nodes automatically form an adaptive communication network. A survivor connects to a local emergency Wi-Fi interface and sends a request. That request travels hop-by-hop through the LoRa mesh to a gateway and appears on the rescue dashboard. If a route fails, the network can select an alternative route. We also investigate passive Wi-Fi observations as an additional search-assistance mechanism."

---

# 44. WHAT EACH PERSON MUST UNDERSTAND

Everyone must understand the COMPLETE FLOW:

```text
DISASTER
   ↓
DEPLOYMENT PLANNER
   ↓
NODE COORDINATES
   ↓
DRONE POSITIONING
   ↓
MESH FORMATION
   ↓
SURVIVOR CONNECTS
   ↓
EMERGENCY REQUEST
   ↓
MULTI-HOP FORWARDING
   ↓
GATEWAY
   ↓
RESCUE DASHBOARD
   ↓
RESCUE ACTION
```

But each member has a deeper ownership area.

---

# 45. CROSS-TEAM DEPENDENCIES

## Palak → Shubham

Provides:

```text
Node coordinates
Deployment topology
```

Shubham uses this topology in network simulation.

## Shubham → Sarniha

Provides:

```text
Network events
Node states
Packet events
Emergency messages
Routes
```

Sarniha visualizes them.

## Sanyam → Shubham

Provides:

```text
Physical node communication
LoRa interface
GPS data
Hardware constraints
```

Shubham integrates the hardware layer.

## Sanyam → Palak

Provides:

```text
Realistic communication range assumptions
Node dimensions
Drone constraints
```

Planner uses realistic constraints.

## Sarniha → Everyone

Provides:

```text
Common dashboard
Real-time integration
```

---

# 46. DAILY TEAM RULE

No one should build an isolated feature without defining its input/output.

Every module must answer:

```text
What do I receive?
What do I produce?
Who consumes my output?
```

Example:

### Planner

```text
INPUT:
area + coordinates + ranges

OUTPUT:
node coordinates + topology
```

### Drone

```text
INPUT:
node coordinates

OUTPUT:
node status + position
```

### Network

```text
INPUT:
node topology + emergency packet

OUTPUT:
routing events + delivered packet
```

### Dashboard

```text
INPUT:
events

OUTPUT:
visual rescue interface
```

---

# 47. INTEGRATION RULE

Use a common event model.

Example:

```text
NODE_CREATED
DRONE_ASSIGNED
DRONE_MOVING
NODE_ACTIVE
LINK_CREATED
EMERGENCY_CREATED
PACKET_FORWARDED
PACKET_DELIVERED
NODE_FAILED
ROUTE_CHANGED
SEARCH_OBSERVATION
```

This lets the dashboard remain independent from the internal implementation.

---

# 48. FINAL DEMO ARCHITECTURE

The final hackathon demo should preferably have:

```text
                    OPERATOR
                       │
                       ▼
              ┌────────────────┐
              │ DEPLOYMENT UI  │
              └───────┬────────┘
                      │
                      ▼
                NODE PLANNER
                      │
                      ▼
               DRONE SIMULATION
                      │
                      ▼
            VIRTUAL MESH NETWORK
                      │
             ┌────────┴────────┐
             │                 │
          SURVIVOR         PHYSICAL NODE
             │                 │
           Wi-Fi              LoRa
             │                 │
             └────────┬────────┘
                      ▼
                   GATEWAY
                      │
                      ▼
                FASTAPI
                      │
                  WebSocket
                      │
                      ▼
               REACT DASHBOARD
```

---

# 49. DEFINITION OF DONE

The project is considered demo-ready when the team can show this complete sequence:

### Required

- [ ] Disaster area can be configured.
- [ ] Planner generates node positions.
- [ ] Planner shows Wi-Fi coverage.
- [ ] Planner shows LoRa connectivity.
- [ ] Gateway is reachable.
- [ ] Drone deployment can be simulated.
- [ ] Nodes transition to ACTIVE.
- [ ] Multi-node software mesh works.
- [ ] Emergency packet is generated.
- [ ] Packet travels through multiple hops.
- [ ] Gateway receives it.
- [ ] Dashboard displays it.
- [ ] At least one route failure is demonstrated.
- [ ] Alternate route is demonstrated.
- [ ] Physical node is demonstrated where tested.
- [ ] Team can clearly distinguish hardware vs simulation.

### Strong bonus

- [ ] GPS shown.
- [ ] OLED shown.
- [ ] Real Wi-Fi → ESP32 interaction.
- [ ] Real LoRa transmission.
- [ ] Drone hardware.
- [ ] Passive Wi-Fi observation.
- [ ] Search-area visualization.

---

# 50. JUDGE DEFENCE PRINCIPLE

For every feature, answer three questions:

### 1. Why?

What problem does it solve?

### 2. How?

What technical mechanism implements it?

### 3. What are the limitations?

Where can it fail?

Example:

**Question:** Why use LoRa?

**Answer structure:**

```text
WHY:
Long-range, low-power communication suitable for small emergency messages.

HOW:
LoRa radios exchange structured packets between nodes and our software implements forwarding/routing.

LIMITATION:
Actual range depends heavily on environment, antenna, configuration and obstacles.
```

This pattern should be used for every major component.

---

# 51. FINAL PROJECT MINDSET

We are not trying to pretend that a hackathon prototype is already a nationwide production network.

We are demonstrating the architecture and proving the most important technical pieces.

The project should be presented honestly as:

```text
REAL HARDWARE
+
SOFTWARE-EMULATED LARGE NETWORK
+
DEPLOYMENT OPTIMIZATION
+
DRONE SIMULATION/INTEGRATION
+
REAL-TIME RESCUE DASHBOARD
```

The strongest part of the project is not claiming that everything is already production-ready.

The strongest part is showing that the system has a coherent path:

```text
PLAN
 ↓
DEPLOY
 ↓
CONNECT
 ↓
ADAPT
 ↓
DELIVER
 ↓
RESPOND
```

---

# 52. TEAM CHECKLIST

## Shubham — Network

- [ ] Refactor current TCP node prototype
- [ ] Implement 3+ software nodes
- [ ] Implement neighbor discovery
- [ ] Implement topology
- [ ] Implement routing
- [ ] Implement forwarding
- [ ] Implement duplicate detection
- [ ] Implement TTL
- [ ] Implement gateway
- [ ] Implement route failure
- [ ] Implement alternate route
- [ ] Define event API

## Palak — Planner

- [ ] Define deployment inputs
- [ ] Build affected-area model
- [ ] Build candidate-node generation
- [ ] Implement Wi-Fi coverage
- [ ] Implement LoRa connectivity
- [ ] Implement gateway reachability
- [ ] Implement node optimization
- [ ] Output node coordinates
- [ ] Visualize deployment
- [ ] Integrate with drone module
- [ ] Prepare architecture slides

## Sanyam — Hardware/Drone

- [ ] ESP32 setup
- [ ] LoRa setup
- [ ] GPS
- [ ] OLED
- [ ] Power
- [ ] Physical node test
- [ ] Define hardware API
- [ ] Drone mission concept
- [ ] Coordinate input
- [ ] Position/deployment simulation
- [ ] Physical drone integration if feasible

## Sarniha — Dashboard

- [ ] React setup
- [ ] FastAPI integration
- [ ] WebSocket integration
- [ ] Map
- [ ] Node markers
- [ ] Drone markers
- [ ] Mesh links
- [ ] Emergency panel
- [ ] Packet animation
- [ ] Node failure animation
- [ ] Route change display
- [ ] Search observation display
- [ ] Final UI polish

---

# 53. FINAL ARCHITECTURE STATEMENT

The complete system is a **post-disaster, rapidly deployable emergency communication architecture**.

It first determines where temporary communication infrastructure should be positioned, then uses drones to position that infrastructure, creates an adaptive communication mesh, provides local survivor access through Wi-Fi, forwards emergency requests over LoRa, and presents the received information to rescue operators through a real-time dashboard.

The system is designed around one principle:

> **When infrastructure fails, communication infrastructure itself should be rapidly deployable and adaptable.**

