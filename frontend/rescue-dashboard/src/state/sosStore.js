/**
 * sosStore.js — In-memory store and pub/sub bus for SOS emergencies.
 *
 * Responsibilities:
 * - Tracks SOS items: { packetId, source, code, priority, people, note, sourceKind, status, route, rerouted, createdAt, deliveredAt, hopCount, dropReason }
 * - Fed by real-time WebSocket events: EMERGENCY_CREATED, PACKET_FORWARDED, PACKET_REROUTED, PACKET_DELIVERED, PACKET_DROPPED
 * - De-duplicates by packetId
 * - Ranks emergencies: priority ASC (1 -> 4), people DESC (9 -> 1), createdAt ASC
 * - Hydrates from GET /sos on mount / reconnect
 * - Clears on simulation reset
 */

import { useState, useEffect } from 'react';
import { subscribe } from './meshEvents.js';
import { normalizeNodeId, formatNodeLabel } from '../utils/nodeUtils.js';

export const SOS_CATEGORIES = {
  MED: { code: 'MED', label: 'Medical', priority: 1, chipVariant: 'danger', dotColor: '#EF4444' },
  TRP: { code: 'TRP', label: 'Trapped', priority: 1, chipVariant: 'danger', dotColor: '#EF4444' },
  MIS: { code: 'MIS', label: 'Missing person', priority: 2, chipVariant: 'warning', dotColor: '#F59E0B' },
  FWD: { code: 'FWD', label: 'Food/Water', priority: 3, chipVariant: 'info', dotColor: '#3B82F6' },
  SHL: { code: 'SHL', label: 'Shelter', priority: 3, chipVariant: 'info', dotColor: '#3B82F6' },
  SAF: { code: 'SAF', label: "I'm safe", priority: 4, chipVariant: 'gray', dotColor: '#10B981' },
};

/**
 * Format route array into readable string:
 * ['NODE-20', 'NODE-14', 'NODE-09', 'GATEWAY'] -> "Node 20 > 14 > 9 > Gateway"
 */
export function formatRouteText(route = []) {
  if (!Array.isArray(route) || route.length === 0) return 'Direct';
  return route
    .map((nodeId, idx) => {
      const norm = normalizeNodeId(nodeId);
      if (norm === 'GATEWAY') return 'Gateway';
      if (idx === 0) return formatNodeLabel(norm);
      // For intermediate hops, strip "Node " and leading zeros for compact readability
      const match = norm.match(/(?:NODE[_-]|\s*)?(\d+)/i);
      return match ? parseInt(match[1], 10) : norm;
    })
    .join(' > ');
}

// In-memory map: packetId -> SOSEntry
const sosMap = new Map();

// Pub/sub listeners
const listeners = new Set();

function notifyListeners() {
  const ranked = getSosList();
  listeners.forEach((fn) => {
    try {
      fn(ranked);
    } catch (err) {
      console.error('[sosStore] Listener error:', err);
    }
  });
}

function compareSos(a, b) {
  // 1. Priority ascending (1 highest, 4 lowest)
  const pA = Number(a.priority ?? 4);
  const pB = Number(b.priority ?? 4);
  if (pA !== pB) return pA - pB;

  // 2. People count descending (more people first)
  const peoA = Number(a.people ?? 1);
  const peoB = Number(b.people ?? 1);
  if (peoA !== peoB) return peoB - peoA;

  // 3. Created time ascending (older first)
  const tA = new Date(a.createdAt || 0).getTime();
  const tB = new Date(b.createdAt || 0).getTime();
  return tA - tB;
}

/**
 * Returns all SOS emergencies ranked by priority, people, createdAt.
 */
export function getSosList() {
  const items = Array.from(sosMap.values());
  return items.sort(compareSos);
}

/**
 * Get a single SOS item by packetId.
 */
export function getSosItem(packetId) {
  return sosMap.get(packetId) || null;
}

/**
 * Subscribe to ranked SOS list updates.
 */
export function subscribeSos(callback) {
  if (typeof callback !== 'function') return () => {};
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/**
 * React hook to consume live ranked SOS list.
 */
export function useSosStore() {
  const [list, setList] = useState(getSosList);

  useEffect(() => {
    return subscribeSos((newList) => setList(newList));
  }, []);

  return list;
}

/**
 * Clear all SOS emergencies (called on simulation reset).
 */
export function clearSos() {
  sosMap.clear();
  notifyListeners();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sos:reset'));
  }
}

/**
 * Hydrate SOS store from backend GET /sos response.
 * Merges with existing records without overwriting local UI-specific state.
 */
export function hydrateSos(serverItems = []) {
  if (!Array.isArray(serverItems)) return;

  let changed = false;
  serverItems.forEach((raw) => {
    const pid = raw.packet_id || raw.packetId;
    if (!pid) return;

    const existing = sosMap.get(pid);
    const code = (raw.code || raw.type || 'MED').toUpperCase();
    const priority = raw.priority ?? (SOS_CATEGORIES[code]?.priority || 4);
    const source = normalizeNodeId(raw.source);
    const rawRoute = raw.route && raw.route.length > 0 ? raw.route : [source];
    const normalizedRoute = rawRoute.map(normalizeNodeId);

    if (existing) {
      // Merge updates
      const updated = {
        ...existing,
        status: raw.status || existing.status,
        route: normalizedRoute.length >= existing.route.length ? normalizedRoute : existing.route,
        hopCount: raw.hop_count ?? existing.hopCount,
        priority: priority,
        people: raw.people ?? existing.people,
        note: raw.note ?? raw.message ?? existing.note,
      };
      sosMap.set(pid, updated);
      changed = true;
    } else {
      sosMap.set(pid, {
        packetId: pid,
        source,
        code,
        priority,
        people: raw.people ?? 1,
        note: raw.note ?? raw.message ?? '',
        sourceKind: raw.source_kind || 'dashboard',
        status: raw.status || 'IN_FLIGHT',
        route: normalizedRoute,
        rerouted: false,
        createdAt: raw.created_at || new Date().toISOString(),
        deliveredAt: raw.status === 'DELIVERED' ? Date.now() : null,
        hopCount: raw.hop_count ?? Math.max(0, normalizedRoute.length - 1),
        dropReason: null,
      });
      changed = true;
    }
  });

  if (changed) {
    notifyListeners();
  }
}

// ── Wire up mesh event listeners ─────────────────────────────────────────────

subscribe('EMERGENCY_CREATED', (ev) => {
  const pid = ev.packet_id || ev.packetId;
  if (!pid) return;

  const rawCode = ev.code || ev.payload?.code || (ev.type !== 'EMERGENCY_CREATED' ? ev.type : null) || 'MED';
  const code = rawCode.toUpperCase();
  const priority = ev.priority ?? ev.payload?.priority ?? (SOS_CATEGORIES[code]?.priority || 4);
  const source = normalizeNodeId(ev.source || ev.payload?.source || 'NODE-01');

  const item = {
    packetId: pid,
    source,
    code,
    priority,
    people: ev.people ?? ev.payload?.people ?? 1,
    note: ev.note ?? ev.message ?? ev.payload?.note ?? ev.payload?.message ?? '',
    sourceKind: ev.source_kind || ev.payload?.source_kind || 'dashboard',
    status: 'IN_FLIGHT',
    route: [source],
    rerouted: false,
    createdAt: ev.timestamp || new Date().toISOString(),
    deliveredAt: null,
    hopCount: 0,
    dropReason: null,
  };

  sosMap.set(pid, item);
  notifyListeners();
});

subscribe('PACKET_FORWARDED', (ev) => {
  const pid = ev.packet_id || ev.packetId;
  if (!pid || !sosMap.has(pid)) return; // Only track packets announced by EMERGENCY_CREATED

  const item = sosMap.get(pid);
  const toNode = normalizeNodeId(ev.to);

  // Append 'to' hop if not already last in route
  const currentRoute = [...item.route];
  if (currentRoute[currentRoute.length - 1] !== toNode) {
    currentRoute.push(toNode);
  }

  item.route = currentRoute;
  item.hopCount = Math.max(0, currentRoute.length - 1);
  sosMap.set(pid, { ...item });
  notifyListeners();
});

subscribe('PACKET_REROUTED', (ev) => {
  const pid = ev.packet_id || ev.packetId;
  if (!pid || !sosMap.has(pid)) return;

  const item = sosMap.get(pid);
  item.rerouted = true;
  sosMap.set(pid, { ...item });
  notifyListeners();
});

subscribe('PACKET_DELIVERED', (ev) => {
  const pid = ev.packet_id || ev.packetId;
  if (!pid || !sosMap.has(pid)) return;

  const item = sosMap.get(pid);
  const finalRoute = Array.isArray(ev.route) && ev.route.length > 0
    ? ev.route.map(normalizeNodeId)
    : [...item.route];

  if (!finalRoute.includes('GATEWAY')) {
    finalRoute.push('GATEWAY');
  }

  item.status = 'DELIVERED';
  item.route = finalRoute;
  item.hopCount = ev.hop_count ?? Math.max(0, finalRoute.length - 1);
  item.deliveredAt = Date.now();
  const deliveredCode = ev.code || ev.payload?.code;
  if (deliveredCode) item.code = deliveredCode.toUpperCase();
  if (ev.people !== undefined || ev.payload?.people !== undefined) {
    item.people = ev.people ?? ev.payload?.people;
  }
  if (ev.priority !== undefined || ev.payload?.priority !== undefined) {
    item.priority = ev.priority ?? ev.payload?.priority;
  }
  if (ev.note || ev.payload?.note) {
    item.note = ev.note || ev.payload?.note;
  }
  if (ev.source_kind || ev.payload?.source_kind) {
    item.sourceKind = ev.source_kind || ev.payload?.source_kind;
  }

  sosMap.set(pid, { ...item });
  notifyListeners();
});

subscribe('PACKET_DROPPED', (ev) => {
  const pid = ev.packet_id || ev.packetId;
  if (!pid || !sosMap.has(pid)) return;

  const item = sosMap.get(pid);
  item.status = 'DROPPED';
  item.dropReason = ev.reason || 'NO_ROUTE';
  item.droppedAt = Date.now();

  sosMap.set(pid, { ...item });
  notifyListeners();
});
