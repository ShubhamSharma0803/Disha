# Shared Data Contracts

Everyone builds against these formats. **Change this file before changing a format**, and tell the team.
All coordinates are WGS84 `lat` / `lon` in decimal degrees. All distances are meters.

## 1. Node

```json
{ "id": "NODE-01", "lat": 28.6139, "lon": 77.2090, "status": "PLANNED" }
```

Node `status`: `PLANNED` -> `ACTIVE` -> `FAILED`

The gateway uses the same shape with `"id": "GATEWAY"`.

## 2. Planner output (`deployment.json`)

Produced by `backend/deployment/run_planner.py`. Consumed by the drone module, the mesh engine and the dashboard.

```json
{
  "assumptions": {
    "wifi_range_m": 300, "lora_range_m": 1000, "area_m": [2000, 2000],
    "restricted_zones": [ { "lat": 28.6139, "lon": 77.2090, "radius_m": 250 } ]
  },
  "nodes": [
    { "id": "NODE-01", "lat": 28.6, "lon": 77.2, "status": "PLANNED",
      "hops_from_gateway": 1, "deploy_order": 1 }
  ],
  "gateway": { "id": "GATEWAY", "lat": 28.6, "lon": 77.2 },
  "links": [ { "from": "NODE-01", "to": "NODE-02", "distance_m": 420 } ],
  "deployment_order": ["NODE-01", "NODE-02"],
  "drone_targets": [ { "order": 1, "node_id": "NODE-01", "lat": 28.6, "lon": 77.2 } ],
  "wifi_coverage": 1.0,
  "valid": true
}
```

- `links` lists every pair within LoRa range (candidate links, not a routing decision).
- `valid` is true only when every node has a path to the gateway.
- `deployment_order` goes from the gateway outward (fewest hops first), so the network grows connected.
- `drone_targets` is the same order as a ready-made list for the drone module.
- `restricted_zones` are circles where **no node may be placed** (water, unstable buildings). The area inside them is still covered by Wi-Fi from nearby nodes. Optional; may be empty.
- Some nodes may sit slightly outside the area boundary; this is intentional (edge coverage).

## Planner input (for the UI)

```json
{
  "center_lat": 28.6139, "center_lon": 77.2090,
  "width_m": 2000, "height_m": 2000,
  "wifi_range_m": 300, "lora_range_m": 1000,
  "gateway_xy": [0, -1000],
  "restricted_zones": [ { "lat": 28.6139, "lon": 77.2090, "radius_m": 250 } ]
}
```

`gateway_xy` is in meters from the area center (x east, y north).

## 3. Drone

```json
{
  "id": "DRONE-01",
  "lat": 28.6139, "lon": 77.2090,
  "target_lat": 28.6200, "target_lon": 77.2100,
  "node_id": "NODE-01",
  "mode": "DEPLOY",
  "status": "MOVING"
}
```

Drone `status`: `PLANNED` -> `ASSIGNED` -> `MOVING` -> `ARRIVED` -> `NODE_ACTIVE`

`mode`: `DEPLOY` (drone places the node) or `RELAY` (node stays attached to the drone).

## 4. Packet

```json
{
  "packet_id": "PKT-001",
  "packet_type": "EMERGENCY",
  "source": "NODE-03",
  "destination": "GATEWAY",
  "payload": { "type": "MEDICAL", "message": "Person injured" },
  "hop_count": 0,
  "ttl": 10,
  "timestamp": "2026-10-07T10:30:00Z"
}
```

- `packet_type`: `HELLO`, `EMERGENCY`, `ACK`
- `payload.type` (for `EMERGENCY`): `MEDICAL`, `TRAPPED`, `FOOD_WATER`, `FIRE`, `MISSING_PERSON`, `OTHER`
- Each forward: `ttl -= 1`, `hop_count += 1`. Drop the packet when `ttl` reaches 0.
- A node drops any `packet_id` it has already seen.
- Optional later fields: `priority`, `gps`, `battery`, `link_quality`, `route_cost`.

## 5. Network events

The mesh engine emits these. The dashboard consumes them. Every event has `event` and `timestamp`.

| Event | Fields |
|---|---|
| `NODE_CREATED` | `node_id`, `lat`, `lon` |
| `DRONE_ASSIGNED` | `drone_id`, `node_id` |
| `DRONE_MOVING` | `drone_id`, `lat`, `lon` |
| `NODE_ACTIVE` | `node_id` |
| `LINK_CREATED` | `from`, `to` |
| `EMERGENCY_CREATED` | `packet_id`, `source`, `payload` |
| `PACKET_FORWARDED` | `packet_id`, `from`, `to` |
| `PACKET_DELIVERED` | `packet_id`, `route` (list of node ids) |
| `NODE_FAILED` | `node_id` |
| `ROUTE_CHANGED` | `source`, `old_route`, `new_route` |
| `SEARCH_OBSERVATION` | see section 6 |

Example:

```json
{ "event": "PACKET_FORWARDED", "packet_id": "PKT-001", "from": "NODE-02", "to": "NODE-03",
  "timestamp": "2026-10-07T10:30:01Z" }
```

## 6. Search observation (draft, owner: Aman)

```json
{
  "event": "SEARCH_OBSERVATION",
  "observer_node": "NODE-04",
  "rssi": -72,
  "device_hash": "a91f...",
  "timestamp": "2026-10-07T10:31:00Z"
}
```

- `device_hash` is a hash, never a raw MAC address.
- This feeds a *probable proximity* display only, not exact location.
- Aman: confirm or change these fields.

## 7. Flow summary

```
Planner  --deployment.json-->  Drone module, Mesh engine, Dashboard
Mesh engine  --network events-->  FastAPI  --WebSocket-->  Dashboard
Drone module  --drone status / events-->  FastAPI
Search module  --SEARCH_OBSERVATION-->  FastAPI
ESP32 serial  --serial_bridge.py-->  POST /bridge/ingest  -->  events bus  -->  WebSocket  -->  Dashboard
```

## 8. ESP32 serial wire format (FROZEN)

**Change this section before changing firmware or `serial_parser.py`.**

Each line sent by the ESP32 is **one JSON object**, UTF-8, terminated by `\n`.  
Baud rate: **115200**. The bridge silently discards any line that is not valid JSON or lacks a `"t"` field (boot logs, debug text, etc.).

### 8.1 SOS packet

```json
{"t":"SOS","node":"HW-01","cat":"TRP","n":3,"lat":30.3256,"lon":77.9423,"bat":82}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `t` | string | ✓ | Always `"SOS"` |
| `node` | string | ✓ | Hardware node ID (e.g. `"HW-01"`) |
| `cat` | string | ✓ | Emergency category: `MED`, `TRP`, `MIS`, `FWD`, `SHL`, `SAF` |
| `n` | int | ✓ | Number of people (1–9) |
| `lat` | float | ✓ | WGS84 latitude |
| `lon` | float | ✓ | WGS84 longitude |
| `bat` | int | — | Battery percentage 0–100 |

The bridge maps `cat` → `code` and sets `source_kind = "hardware"`.

### 8.2 Wi-Fi sniff observation

```json
{"t":"SNF","node":"HW-01","dev":"a3f9c1","rssi":-71,"ch":6}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `t` | string | ✓ | Always `"SNF"` |
| `node` | string | ✓ | Hardware node ID |
| `dev` | string | ✓ | Truncated device identifier (never raw MAC) |
| `rssi` | int | ✓ | Signal strength in dBm |
| `ch` | int | — | Wi-Fi channel (1–13) |

The bridge emits a `SEARCH_OBSERVATION` event with `source_kind = "hardware"`.

### 8.3 Heartbeat (optional)

```json
{"t":"HB","node":"HW-01","bat":82}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `t` | string | ✓ | Always `"HB"` |
| `node` | string | ✓ | Hardware node ID |
| `bat` | int | — | Battery percentage 0–100 |

Heartbeats update `GET /gateway/status` but do not create SOS entries or observations.

### 8.4 Rules

- **One JSON object per line**, newline-terminated. No multi-line JSON.
- The bridge silently drops lines that are not valid JSON or have an unknown `"t"` value.
- `cat` must be one of: `MED`, `TRP`, `MIS`, `FWD`, `SHL`, `SAF`. Unknown values are treated as `MIS`.
- `n` is clamped to 1–9.
- The bridge is a **separate process** (`backend/gateway/serial_bridge.py`). Switch mock ↔ real with `--mock` / `--port COM3`.
- The backend never reads serial directly; it only receives `POST /bridge/ingest`.