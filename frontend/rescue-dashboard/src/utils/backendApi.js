/**
 * backendApi.js — Service module for Disha FastAPI backend integration.
 *
 * All fetch calls target http://localhost:8000 and include a short timeout
 * so the UI degrades gracefully when the backend is offline.
 *
 * Every public function returns `null` on failure instead of throwing,
 * letting callers fall back to local (mock) calculations.
 */

// ─── Configuration ───────────────────────────────────────────────────────────

const API_BASE = 'http://localhost:8000';
const FETCH_TIMEOUT_MS = 15000;

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Fetch with a timeout. Returns the Response object or throws on timeout/error.
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST JSON to the backend. Returns parsed JSON or null on failure.
 * Logs a single-line warning on failure (avoids flooding the console).
 */
async function postJSON(path, body) {
  try {
    const res = await fetchWithTimeout(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.warn(`[backendApi] POST ${path} → ${res.status} ${res.statusText}`);
      return null;
    }

    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn(`[backendApi] POST ${path} → timeout (${FETCH_TIMEOUT_MS}ms)`);
    } else {
      console.warn(`[backendApi] POST ${path} → offline (${err.message})`);
    }
    return null;
  }
}

/**
 * GET JSON from the backend. Returns parsed JSON or null on failure.
 */
async function getJSON(path) {
  try {
    const res = await fetchWithTimeout(`${API_BASE}${path}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!res.ok) {
      console.warn(`[backendApi] GET ${path} → ${res.status} ${res.statusText}`);
      return null;
    }

    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn(`[backendApi] GET ${path} → timeout (${FETCH_TIMEOUT_MS}ms)`);
    } else {
      console.warn(`[backendApi] GET ${path} → offline (${err.message})`);
    }
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * POST /plan — Request a deployment plan from the backend planner.
 *
 * @param {{
 *   centerLat: number,
 *   centerLon: number,
 *   areaSqKm: number,
 *   wifiRangeM?: number,
 *   loraRangeM?: number,
 * }} params
 * @returns {Promise<object|null>} The planner output (deployment.json shape) or null
 */
export async function fetchDeploymentPlan({
  centerLat,
  centerLon,
  areaSqKm,
  wifiRangeM = 300,
  loraRangeM = 1000,
}) {
  const sideM = Math.sqrt(areaSqKm) * 1000;

  return postJSON('/plan', {
    center_lat: centerLat,
    center_lon: centerLon,
    width_m: sideM,
    height_m: sideM,
    wifi_range_m: wifiRangeM,
    lora_range_m: loraRangeM,
  });
}

/**
 * POST /simulation/start — Start or restart the mesh simulation.
 *
 * Accepts the full deployment plan JSON (with nodes, links, gateway, etc.).
 * If `deploymentPlan` is null/undefined, the backend falls back to its
 * sample_deployment.json.
 *
 * @param {object|null} deploymentPlan — Full planner output object
 * @returns {Promise<object|null>} Response with { status, nodes, links, gateway }
 */
export async function startSimulation(deploymentPlan = null) {
  return postJSON('/simulation/start', deploymentPlan || {});
}

/**
 * GET /simulation/state — Get current simulation state for all nodes.
 *
 * @returns {Promise<object|null>} Response with { nodes, state, ... }
 */
export async function getSimulationState() {
  return getJSON('/simulation/state');
}

/**
 * POST /simulation/emergency — Originate an emergency packet from a node.
 *
 * @param {{ source: string, type: string, message: string }} params
 * @returns {Promise<object|null>}
 */
export async function sendEmergency({ source, type, message }) {
  return postJSON('/simulation/emergency', { source, type, message });
}

/**
 * POST /simulation/kill/:nodeId — Kill a node in the running simulation.
 *
 * @param {string} nodeId
 * @returns {Promise<object|null>}
 */
export async function killNode(nodeId) {
  return postJSON(`/simulation/kill/${nodeId}`, {});
}

/**
 * POST /simulation/revive/:nodeId — Revive a dead node.
 *
 * @param {string} nodeId
 * @returns {Promise<object|null>}
 */
export async function reviveNode(nodeId) {
  return postJSON(`/simulation/revive/${nodeId}`, {});
}

/**
 * Connect to the WebSocket event stream at ws://localhost:8000/ws/events.
 *
 * Returns a WebSocket instance. The caller is responsible for attaching
 * onmessage / onclose / onerror handlers and calling .close() on cleanup.
 *
 * Returns null if WebSocket construction throws (e.g. invalid URL).
 *
 * @returns {WebSocket|null}
 */
export function connectEventStream() {
  try {
    return new WebSocket('ws://localhost:8000/ws/events');
  } catch (err) {
    console.warn('[backendApi] WebSocket connection failed:', err.message);
    return null;
  }
}

/**
 * Quick health-check: GET / → { status: "ok", ... }
 * Resolves to true if the backend is reachable, false otherwise.
 *
 * @returns {Promise<boolean>}
 */
export async function isBackendOnline() {
  const data = await getJSON('/');
  return data?.status === 'ok';
}
