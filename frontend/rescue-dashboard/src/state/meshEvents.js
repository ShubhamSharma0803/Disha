/**
 * meshEvents.js — In-memory store and pub/sub event bus for mesh events.
 *
 * Requirements:
 * - Keeps last 300 events (newest first)
 * - Normalizes `kind = data.event ?? data.type`
 * - De-duplicates NODE_FAILED and NEIGHBOUR_LOST events (avoid duplicate log entries / UI flicker)
 * - NEIGHBOUR_LOST never triggers visual status changes (routing-only event)
 * - Exposes subscribe(kind, callback) returning an unsubscribe fn
 * - Exposes connection state (connected / reconnecting)
 */

import { normalizeNodeId } from '../utils/nodeUtils.js';

const MAX_STORED_EVENTS = 200;

// Internal in-memory event array (newest first)
let eventsList = [];

// Subscribers map: event kind -> Set of callback functions
const subscribers = new Map();

// Connection state listeners
const connStateSubscribers = new Set();
let currentConnectionState = 'reconnecting'; // 'connected' | 'reconnecting'

/**
 * Normalize incoming raw event payload.
 */
export function normalizeMeshEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = raw.event ?? raw.type;
  if (!kind || typeof kind !== 'string') return null;

  const normalized = {
    ...raw,
    kind,
    event: kind,
    type: kind,
    timestamp: raw.timestamp || new Date().toISOString(),
  };

  if (raw.node_id) {
    normalized.node_id = normalizeNodeId(raw.node_id);
  }
  if (raw.source) {
    normalized.source = normalizeNodeId(raw.source);
  }
  if (raw.detected_by) {
    normalized.detected_by = normalizeNodeId(raw.detected_by);
  }
  if (raw.neighbour_id) {
    normalized.neighbour_id = normalizeNodeId(raw.neighbour_id);
  }

  return normalized;
}

/**
 * Add an event to the store and notify registered subscribers.
 * De-duplicates NODE_FAILED so neighbour repeats do not generate
 * duplicate log entries or duplicate effects.
 *
 * @param {object} rawEvent
 * @returns {object|null} The normalized event, or null if ignored/duplicate
 */
export function addMeshEvent(rawEvent) {
  const event = normalizeMeshEvent(rawEvent);
  if (!event) return null;

  // De-duplicate NODE_FAILED:
  // If the most recent failure/revival record for this node is ALREADY NODE_FAILED,
  // ignore the duplicate event sent by another detecting neighbour.
  if (event.kind === 'NODE_FAILED' && event.node_id) {
    const priorStateEvent = eventsList.find(
      (e) =>
        e.node_id === event.node_id &&
        (e.kind === 'NODE_FAILED' || e.kind === 'NODE_REVIVED')
    );
    if (priorStateEvent && priorStateEvent.kind === 'NODE_FAILED') {
      return null;
    }
  }

  // Prepend newest first, cap at MAX_STORED_EVENTS
  eventsList = [event, ...eventsList.slice(0, MAX_STORED_EVENTS - 1)];

  // Notify kind subscribers
  const kindSubs = subscribers.get(event.kind);
  if (kindSubs) {
    kindSubs.forEach((cb) => {
      try {
        cb(event);
      } catch (err) {
        console.error(`[meshEvents] Subscriber error for ${event.kind}:`, err);
      }
    });
  }

  // Notify wildcard subscribers ('*')
  const wildcardSubs = subscribers.get('*');
  if (wildcardSubs) {
    wildcardSubs.forEach((cb) => {
      try {
        cb(event);
      } catch (err) {
        console.error('[meshEvents] Wildcard subscriber error:', err);
      }
    });
  }

  return event;
}

/**
 * Subscribe to mesh events by kind, or '*' for all events.
 *
 * @param {string} kind
 * @param {(event: object) => void} callback
 * @returns {() => void} Unsubscribe function
 */
export function subscribe(kind, callback) {
  if (typeof callback !== 'function') {
    return () => {};
  }
  if (!subscribers.has(kind)) {
    subscribers.set(kind, new Set());
  }
  subscribers.get(kind).add(callback);

  return () => {
    const set = subscribers.get(kind);
    if (set) {
      set.delete(callback);
      if (set.size === 0) {
        subscribers.delete(kind);
      }
    }
  };
}

/**
 * Get the current list of events (newest first).
 */
export function getEvents() {
  return eventsList;
}

/**
 * Clear all events from the store (used on simulation Reset).
 */
export function clearEvents() {
  eventsList = [];
  const clearSubs = subscribers.get('__CLEAR__');
  if (clearSubs) {
    clearSubs.forEach((cb) => {
      try {
        cb();
      } catch (err) {
        console.error('[meshEvents] Clear subscriber error:', err);
      }
    });
  }
}

/**
 * Connection state management
 */
export function getConnectionState() {
  return currentConnectionState;
}

export function setConnectionState(nextState) {
  if (currentConnectionState !== nextState) {
    currentConnectionState = nextState;
    connStateSubscribers.forEach((cb) => {
      try {
        cb(nextState);
      } catch (err) {
        console.error('[meshEvents] Connection state subscriber error:', err);
      }
    });
  }
}

export function subscribeConnectionState(callback) {
  if (typeof callback !== 'function') return () => {};
  connStateSubscribers.add(callback);
  return () => {
    connStateSubscribers.delete(callback);
  };
}
