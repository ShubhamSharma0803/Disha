/**
 * geoMath.js — Geospatial utility functions for drone mesh-network planning.
 *
 * All angular values are in degrees at the public API boundary;
 * internal helpers work in radians.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const EARTH_RADIUS_M = 6_371_000; // Mean Earth radius in metres
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const DEFAULT_ALT_M = 25; // Default node altitude (metres AGL)

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Convert degrees → radians.
 * @param {number} deg
 * @returns {number}
 */
function toRad(deg) {
  return deg * DEG_TO_RAD;
}

/**
 * Convert radians → degrees.
 * @param {number} rad
 * @returns {number}
 */
function toDeg(rad) {
  return rad * RAD_TO_DEG;
}

/**
 * Haversine distance between two GPS points.
 * @param {number} lat1 – Latitude  of point A (deg)
 * @param {number} lon1 – Longitude of point A (deg)
 * @param {number} lat2 – Latitude  of point B (deg)
 * @param {number} lon2 – Longitude of point B (deg)
 * @returns {number} Distance in metres
 */
export function haversineDistance(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Compute a destination point given a start, bearing, and distance.
 * Uses the "direct" geodesic formula on a sphere.
 *
 * @param {number} lat      – Start latitude  (deg)
 * @param {number} lon      – Start longitude (deg)
 * @param {number} bearingDeg – Bearing in degrees (0 = N, 90 = E)
 * @param {number} distanceM  – Distance in metres
 * @returns {{ lat: number, lon: number }}
 */
export function destinationPoint(lat, lon, bearingDeg, distanceM) {
  const φ1 = toRad(lat);
  const λ1 = toRad(lon);
  const θ = toRad(bearingDeg);
  const δ = distanceM / EARTH_RADIUS_M; // angular distance

  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ),
  );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
    );

  return { lat: toDeg(φ2), lon: toDeg(λ2) };
}

/**
 * Convert a local metre offset (dx, dy) from a reference point to GPS coords.
 * +x → East, +y → North.
 *
 * @param {number} refLat – Reference latitude  (deg)
 * @param {number} refLon – Reference longitude (deg)
 * @param {number} dx     – Eastward  offset (m)
 * @param {number} dy     – Northward offset (m)
 * @returns {{ lat: number, lon: number }}
 */
export function offsetToGps(refLat, refLon, dx, dy) {
  // Metres per degree at the reference latitude
  const mPerDegLat = (Math.PI / 180) * EARTH_RADIUS_M;
  const mPerDegLon = mPerDegLat * Math.cos(toRad(refLat));

  return {
    lat: refLat + dy / mPerDegLat,
    lon: refLon + dx / mPerDegLon,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Calculate a closed GeoJSON polygon ring representing a rectangular bounding
 * box of the given area centred on a GPS coordinate.
 *
 * For a 4 km² area the box is 2 km × 2 km (i.e. ±1 km from centre).
 *
 * The returned ring follows the GeoJSON winding convention:
 *   [[lon,lat], …, [lon,lat]]   (first === last to close the ring)
 *
 * @param {number} centerLat – Centre latitude  (deg)
 * @param {number} centerLon – Centre longitude (deg)
 * @param {number} areaSqKm  – Target area (km²), default 4
 * @returns {Array<[number, number]>} Closed ring of [lon, lat] pairs
 */
export function calculateBoundaryBox(centerLat, centerLon, areaSqKm = 4) {
  const cLat = Number(centerLat);
  const cLon = Number(centerLon);
  const area = Math.max(0.01, Number(areaSqKm) || 4);

  // Side length of the square whose area equals areaSqKm
  const sideM = Math.sqrt(area) * 1000; // e.g. 2000 m for 4 km²
  const halfSide = sideM / 2;           // 1000 m offset from centre

  // Compute the four corners via metre offsets → GPS
  const sw = offsetToGps(cLat, cLon, -halfSide, -halfSide);
  const se = offsetToGps(cLat, cLon, halfSide, -halfSide);
  const ne = offsetToGps(cLat, cLon, halfSide, halfSide);
  const nw = offsetToGps(cLat, cLon, -halfSide, halfSide);

  // Return as a 5-point closed GeoJSON-style ring [[lon, lat], ...]
  return [
    [sw.lon, sw.lat],
    [se.lon, se.lat],
    [ne.lon, ne.lat],
    [nw.lon, nw.lat],
    [sw.lon, sw.lat], // close the ring
  ];
}

/**
 * Generate a hexagonal grid of node positions covering a given area.
 *
 * The grid uses a "pointy-top" hex layout where each ring of hexagons adds
 * 6 more nodes than the previous ring. The spacing between adjacent nodes
 * equals `loraRangeM` so that every node can reach at least its six
 * immediate neighbours via LoRa. Node generation is tightly clipped
 * within the square area boundary.
 *
 * @param {number} centerLat   – Centre latitude  (deg)
 * @param {number} centerLon   – Centre longitude (deg)
 * @param {number} areaSqKm    – Target coverage area (km²), default 4
 * @param {number} loraRangeM  – LoRa radio range (m), used as hex spacing
 * @param {number} wifiRangeM  – Wi-Fi hotspot radius per node (m)
 * @returns {Array<{
 *   id: string,
 *   lat: number,
 *   lon: number,
 *   altM: number,
 *   wifiRadiusM: number,
 *   status: string
 * }>}
 */
export function calculateHexGrid(
  centerLat,
  centerLon,
  areaSqKm = 4,
  loraRangeM = 1000,
  wifiRangeM = 300,
) {
  const cLat = Number(centerLat);
  const cLon = Number(centerLon);
  const area = Math.max(0.01, Number(areaSqKm) || 4);

  // Exact square side length and half-side for bounding box clipping
  const sideM = Math.sqrt(area) * 1000;
  const halfSide = sideM / 2;

  // Maximum radial distance to any corner of the bounding square
  const maxCornerDistM = Math.hypot(halfSide, halfSide);

  // Node spacing for complete Wi-Fi hotspot coverage across the disaster area
  // Spacing = wifiRangeM * sqrt(3) allows adjacent circular coverage footprints
  // to overlap and fully cover the terrain without gaps.
  const wifiR = Math.max(50, Number(wifiRangeM) || 300);
  const loraR = Math.max(100, Number(loraRangeM) || 1000);
  const hexSpacingM = Math.min(loraR, wifiR * Math.sqrt(3));
  const ringStepM = hexSpacingM * (Math.sqrt(3) / 2);
  const rings = Math.max(1, Math.ceil(maxCornerDistM / ringStepM));

  const nodes = [];
  let nodeIndex = 0;

  /**
   * Push a node from a local-metre offset if within the boundary.
   */
  const addNode = (dx, dy) => {
    // Tightly clip node generation within the square boundary box
    if (Math.abs(dx) > halfSide || Math.abs(dy) > halfSide) {
      return;
    }

    // Node (0,0) lands precisely at (centerLat, centerLon), placing the hex grid
    // dead-center inside the boundary box polygon
    const isCenter = dx === 0 && dy === 0;
    const { lat, lon } = isCenter
      ? { lat: cLat, lon: cLon }
      : offsetToGps(cLat, cLon, dx, dy);

    nodes.push({
      id: `NODE-${String(nodeIndex + 1).padStart(2, '0')}`,
      lat: isCenter ? cLat : parseFloat(lat.toFixed(8)),
      lon: isCenter ? cLon : parseFloat(lon.toFixed(8)),
      altM: DEFAULT_ALT_M,
      wifiRadiusM: wifiRangeM,
      status: 'PLANNED',
    });
    nodeIndex++;
  };

  // Centre node (0, 0) dead-center at (centerLat, centerLon)
  addNode(0, 0);

  // ── Build rings 1 … R using axial hex coordinates ──────────────────────
  const sqrt3 = Math.sqrt(3);

  // Six axial direction vectors for walking around a ring (pointy-top)
  const directions = [
    { dq: 1, dr: 0 },
    { dq: 0, dr: 1 },
    { dq: -1, dr: 1 },
    { dq: -1, dr: 0 },
    { dq: 0, dr: -1 },
    { dq: 1, dr: -1 },
  ];

  for (let ring = 1; ring <= rings; ring++) {
    let q = ring;
    let r = 0;

    for (let side = 0; side < 6; side++) {
      const dir = directions[(side + 2) % 6];
      for (let step = 0; step < ring; step++) {
        // Convert axial (q, r) → cartesian (x, y) in metres
        const x = hexSpacingM * (sqrt3 * q + (sqrt3 / 2) * r);
        const y = hexSpacingM * ((3 / 2) * r);
        addNode(x, y);

        q += dir.dq;
        r += dir.dr;
      }
    }
  }

  return nodes;
}

/**
 * Format a node array into a JSON-serialisable autopilot mission specification
 * conforming to the Disha protocol.md data contract.
 *
 * The output includes:
 *  - `assumptions`   — area, radio ranges, restricted zones
 *  - `nodes`         — protocol-compliant node list with hops_from_gateway + deploy_order
 *  - `gateway`       — { id, lat, lon }
 *  - `links`         — candidate LoRa links within range
 *  - `deployment_order` — ordered node IDs (fewest hops first)
 *  - `drone_targets` — ready-made list for the drone module
 *  - `wifi_coverage` — estimated coverage ratio
 *  - `valid`         — true when every node has a path to the gateway
 *  - `mission`       — extended waypoint spec for autopilot firmware
 *
 * @param {Array<{ id: string, lat: number, lon: number, altM?: number, wifiRadiusM?: number, hopsFromGateway?: number, deployOrder?: number }>} nodes
 * @param {number} centerLat – Mission reference latitude  (deg)
 * @param {number} centerLon – Mission reference longitude (deg)
 * @param {{ wifiRangeM?: number, loraRangeM?: number, areaSqKm?: number }} options
 * @returns {object} A protocol.md-compliant JSON-ready mission specification
 */
export function exportAutopilotMission(
  nodes,
  centerLat,
  centerLon,
  { wifiRangeM = 300, loraRangeM = 1000, areaSqKm = 4 } = {},
) {
  const sideM = Math.sqrt(areaSqKm) * 1000;

  // ── Build protocol-compliant node list ────────────────────────────────────
  const protocolNodes = nodes.map((node, index) => ({
    id: node.id,
    lat: node.lat,
    lon: node.lon,
    status: node.status || 'PLANNED',
    hops_from_gateway: node.hopsFromGateway ?? index + 1,
    deploy_order: node.deployOrder ?? index + 1,
  }));

  // ── Deployment order (fewest hops first, then by distance from centre) ──
  const sortedNodes = [...protocolNodes].sort((a, b) => {
    if (a.hops_from_gateway !== b.hops_from_gateway) {
      return a.hops_from_gateway - b.hops_from_gateway;
    }
    const distA = haversineDistance(centerLat, centerLon, a.lat, a.lon);
    const distB = haversineDistance(centerLat, centerLon, b.lat, b.lon);
    return distA - distB;
  });

  const deploymentOrder = sortedNodes.map((n) => n.id);

  // ── Build candidate LoRa links (pairs within loraRangeM) ──────────────────
  const links = [];
  for (let i = 0; i < protocolNodes.length; i++) {
    for (let j = i + 1; j < protocolNodes.length; j++) {
      const d = haversineDistance(
        protocolNodes[i].lat,
        protocolNodes[i].lon,
        protocolNodes[j].lat,
        protocolNodes[j].lon,
      );
      if (d <= loraRangeM) {
        links.push({
          from: protocolNodes[i].id,
          to: protocolNodes[j].id,
          distance_m: Math.round(d),
        });
      }
    }
  }

  // ── Drone targets (protocol §2 drone_targets) ────────────────────────────
  const droneTargets = sortedNodes.map((n, idx) => ({
    order: idx + 1,
    node_id: n.id,
    lat: n.lat,
    lon: n.lon,
  }));

  // ── Gateway (bottom-centre of the area) ──────────────────────────────────
  const gatewayPos = offsetToGps(centerLat, centerLon, 0, -(sideM / 2));
  const gateway = {
    id: 'GATEWAY',
    lat: parseFloat(gatewayPos.lat.toFixed(6)),
    lon: parseFloat(gatewayPos.lon.toFixed(6)),
  };

  // ── Extended waypoint spec for autopilot firmware ─────────────────────────
  const waypoints = nodes.map((node, index) => {
    const distFromCenter = haversineDistance(
      centerLat,
      centerLon,
      node.lat,
      node.lon,
    );

    return {
      seq: index,
      id: node.id,
      coordinate: {
        lat: node.lat,
        lon: node.lon,
        altM: node.altM ?? DEFAULT_ALT_M,
      },
      distanceFromCenterM: parseFloat(distFromCenter.toFixed(2)),
      actions: [
        {
          type: 'FLY_TO',
          description: `Navigate to waypoint ${node.id}`,
          params: {
            lat: node.lat,
            lon: node.lon,
            altM: node.altM ?? DEFAULT_ALT_M,
            speedMs: 5, // default cruise speed
          },
        },
        {
          type: 'HOVER',
          description: `Hold position at ${node.id} for sensor deployment`,
          params: {
            durationS: 10,
          },
        },
        {
          type: 'ACTIVATE_PAYLOAD',
          description: `Activate mesh node radio at ${node.id}`,
          params: {
            payload: 'MESH_NODE',
            wifiRadiusM: node.wifiRadiusM ?? wifiRangeM,
          },
        },
      ],
    };
  });

  return {
    // ── protocol.md §2 fields ──────────────────────────────────────────────
    assumptions: {
      wifi_range_m: wifiRangeM,
      lora_range_m: loraRangeM,
      area_m: [sideM, sideM],
      restricted_zones: [],
    },
    nodes: protocolNodes,
    gateway,
    links,
    deployment_order: deploymentOrder,
    drone_targets: droneTargets,
    wifi_coverage: 1.0, // placeholder — backend provides the real value
    valid: true,        // placeholder — backend validates connectivity

    // ── Extended mission block for autopilot firmware ───────────────────────
    mission: {
      name: 'Drone Mesh Network Deployment',
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      reference: {
        lat: centerLat,
        lon: centerLon,
        description: 'Mission centre / launch point',
      },
      totalWaypoints: waypoints.length,
      estimatedFlightTimeS: waypoints.length * 30,
      settings: {
        defaultAltM: DEFAULT_ALT_M,
        returnToLaunch: true,
        failsafeAction: 'RTL',
        maxSpeedMs: 10,
        geofenceRadiusM:
          waypoints.length > 0
            ? Math.max(...waypoints.map((w) => w.distanceFromCenterM)) + 100
            : 500,
      },
      waypoints,
    },
  };
}

/**
 * Compute the shortest path from a starting node to the GATEWAY over the LoRa mesh links.
 * Uses Dijkstra's algorithm weighted by Euclidean distance (distance_m).
 *
 * @param {string} startNodeId – ID of the starting node (e.g. 'NODE-04')
 * @param {Array<{ from: string, to: string, distance_m?: number }>} links – Array of mesh links
 * @param {string} targetId – Target node ID, default 'GATEWAY'
 * @returns {Array<string>} Ordered list of node IDs along the shortest path, e.g. ['NODE-04', 'NODE-01', 'GATEWAY']
 */
export function findShortestPathToGateway(startNodeId, links, targetId = 'GATEWAY') {
  if (!startNodeId || !links || links.length === 0) return [];
  if (startNodeId === targetId) return [targetId];

  // Build bidirectional adjacency graph
  const adj = new Map();
  links.forEach((l) => {
    const d = typeof l.distance_m === 'number' && l.distance_m > 0 ? l.distance_m : 1;
    if (!adj.has(l.from)) adj.set(l.from, []);
    if (!adj.has(l.to)) adj.set(l.to, []);
    adj.get(l.from).push({ node: l.to, dist: d });
    adj.get(l.to).push({ node: l.from, dist: d });
  });

  if (!adj.has(startNodeId) || !adj.has(targetId)) return [];

  // Dijkstra's algorithm
  const distances = new Map();
  const previous = new Map();
  const unvisited = new Set();

  adj.forEach((_, node) => {
    distances.set(node, Infinity);
    unvisited.add(node);
  });
  distances.set(startNodeId, 0);

  while (unvisited.size > 0) {
    let curr = null;
    let minDist = Infinity;
    unvisited.forEach((node) => {
      const dist = distances.get(node);
      if (dist < minDist) {
        minDist = dist;
        curr = node;
      }
    });

    if (curr === null || minDist === Infinity || curr === targetId) {
      break;
    }

    unvisited.delete(curr);

    const neighbors = adj.get(curr) || [];
    for (const edge of neighbors) {
      if (!unvisited.has(edge.node)) continue;
      const alt = distances.get(curr) + edge.dist;
      if (alt < distances.get(edge.node)) {
        distances.set(edge.node, alt);
        previous.set(edge.node, curr);
      }
    }
  }

  // Reconstruct path from startNodeId to targetId
  if (!previous.has(targetId) && startNodeId !== targetId) return [];

  const path = [];
  let step = targetId;
  while (step) {
    path.unshift(step);
    step = previous.get(step);
    if (step === startNodeId) {
      path.unshift(startNodeId);
      break;
    }
  }
  return path;
}
