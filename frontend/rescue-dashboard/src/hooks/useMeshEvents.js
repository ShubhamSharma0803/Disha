/**
 * useMeshEvents.js — Custom React hook for live mesh WebSocket integration.
 *
 * Responsibilities:
 * - Connects to ws://localhost:8000/ws/events on app mount.
 * - Automatic reconnection with exponential backoff: 1s, 2s, 4s, max 5s.
 * - Exposes connectionState ('connected' | 'reconnecting').
 * - Safely parses JSON and normalizes kind into the meshEvents store.
 * - Dispatches NODE_FAILED (sets OFFLINE) ONLY when detected_by === 'SIMULATOR'.
 * - NEIGHBOUR_LOST never changes node status (routing-only event).
 * - NODE_REVIVED sets ACTIVE.
 * - Ignores NODE_ACTIVE for status changes (drone arrival drives PLANNED -> ACTIVE).
 * - On WebSocket (re)connect, if simulation is running, calls GET /simulation/state
 *   and syncs node statuses: DEAD -> OFFLINE, ALIVE leaves status as-is.
 * - Exposes `subscribe(kind, callback)` and `events` array.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  addMeshEvent,
  subscribe,
  getEvents,
  clearEvents,
  getConnectionState,
  setConnectionState,
  subscribeConnectionState,
} from '../state/meshEvents';
import { getSimulationState, fetchSos } from '../utils/backendApi';
import { normalizeNodeId } from '../utils/nodeUtils';
import { hydrateSos } from '../state/sosStore';

const BACKOFF_MS = [1000, 2000, 4000, 5000];

export function useMeshEvents({
  isSimulating = false,
  setNodes = null,
  onConnected = null,
} = {}) {
  const [connectionState, setConnState] = useState(getConnectionState());
  const [eventCount, setEventCount] = useState(0);

  const attemptRef = useRef(0);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const isSimulatingRef = useRef(isSimulating);
  isSimulatingRef.current = isSimulating;

  const setNodesRef = useRef(setNodes);
  setNodesRef.current = setNodes;

  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

  // Sync node statuses from backend GET /simulation/state
  const syncSimulationState = useCallback(async () => {
    try {
      const state = await getSimulationState();
      if (!state || !state.nodes || !setNodesRef.current) return;

      const stateMap = new Map();
      state.nodes.forEach((n) => {
        stateMap.set(normalizeNodeId(n.id), n.status);
      });

      setNodesRef.current((prevNodes) =>
        prevNodes.map((node) => {
          const normId = normalizeNodeId(node.id);
          // Gateway is never managed as an offline node
          if (normId === 'GATEWAY') return node;

          const backendStatus = stateMap.get(normId);

          // Rule 5: A node that is not in the backend's state must be left unchanged
          if (!backendStatus) return node;

          // DEAD becomes OFFLINE
          if (backendStatus === 'DEAD') {
            return node.status !== 'OFFLINE' ? { ...node, status: 'OFFLINE' } : node;
          }

          // If backend confirms ALIVE, restore any erroneously OFFLINE node to ACTIVE
          if (backendStatus === 'ALIVE' && node.status === 'OFFLINE') {
            return { ...node, status: 'ACTIVE' };
          }

          return node;
        }),
      );
    } catch (err) {
      console.warn('[useMeshEvents] syncSimulationState error:', err);
    }
  }, []);

  // Listen to connectionState updates from store
  useEffect(() => {
    const unsub = subscribeConnectionState((newStatus) => {
      setConnState(newStatus);
    });
    return unsub;
  }, []);

  // Listen to incoming NODE_FAILED, NEIGHBOUR_LOST, and NODE_REVIVED from event store
  useEffect(() => {
    // NODE_FAILED: only set OFFLINE if detected_by === 'SIMULATOR' (authoritative kill)
    const unsubFailed = subscribe('NODE_FAILED', (ev) => {
      if (!ev.node_id || !setNodesRef.current) return;
      // Only the SIMULATOR (Node.kill) produces authoritative NODE_FAILED events.
      // Neighbour-detected failures are now NEIGHBOUR_LOST, which never reaches here.
      // But as a safeguard, only trust SIMULATOR-sourced NODE_FAILED.
      if (ev.detected_by !== 'SIMULATOR') {
        // Ignore non-authoritative NODE_FAILED (legacy safety)
        return;
      }
      const targetId = normalizeNodeId(ev.node_id);
      if (targetId === 'GATEWAY') return;

      setNodesRef.current((prev) => {
        const found = prev.find((n) => normalizeNodeId(n.id) === targetId);
        // Avoid redundant update, and NEVER mark PLANNED nodes OFFLINE
        if (!found || found.status === 'OFFLINE' || found.status === 'PLANNED') return prev;
        return prev.map((n) =>
          normalizeNodeId(n.id) === targetId ? { ...n, status: 'OFFLINE' } : n
        );
      });

      // Synchronize with backend simulation state to ensure authoritative confirmation
      syncSimulationState();
      setEventCount((c) => c + 1);
    });

    // NEIGHBOUR_LOST: routing-only event, never change node status in the UI
    const unsubNeighbourLost = subscribe('NEIGHBOUR_LOST', (_ev) => {
      // Do NOT change any node's visual status.
      // This event is for routing/debugging only.
      setEventCount((c) => c + 1);
    });

    const unsubRevived = subscribe('NODE_REVIVED', (ev) => {
      if (!ev.node_id || !setNodesRef.current) return;
      const targetId = normalizeNodeId(ev.node_id);

      setNodesRef.current((prev) => {
        const found = prev.find((n) => normalizeNodeId(n.id) === targetId);
        // Avoid redundant state update / re-render if already ACTIVE
        if (!found || found.status === 'ACTIVE') return prev;
        return prev.map((n) =>
          normalizeNodeId(n.id) === targetId ? { ...n, status: 'ACTIVE' } : n
        );
      });
      setEventCount((c) => c + 1);
    });

    // Also update eventCount on all other events
    const unsubWildcard = subscribe('*', () => {
      setEventCount((c) => c + 1);
    });

    return () => {
      unsubFailed();
      unsubNeighbourLost();
      unsubRevived();
      unsubWildcard();
    };
  }, []);

  // WebSocket lifecycle management
  useEffect(() => {
    let isCancelled = false;

    function connect() {
      if (isCancelled) return;
      if (
        wsRef.current &&
        (wsRef.current.readyState === WebSocket.OPEN ||
          wsRef.current.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }

      setConnectionState('reconnecting');

      let socket;
      try {
        socket = new WebSocket('ws://localhost:8000/ws/events');
      } catch (err) {
        scheduleReconnect();
        return;
      }

      wsRef.current = socket;

      socket.onopen = () => {
        if (isCancelled) {
          socket.close();
          return;
        }
        attemptRef.current = 0;
        setConnectionState('connected');
        onConnectedRef.current?.();

        // Hydrate SOS emergencies from backend on (re)connect
        fetchSos().then((items) => {
          if (!isCancelled && Array.isArray(items)) {
            hydrateSos(items);
          }
        });

        // On WebSocket (re)connect, if simulation is running, sync state
        if (isSimulatingRef.current) {
          syncSimulationState();
        }
      };

      socket.onmessage = (event) => {
        if (isCancelled) return;
        try {
          const data = JSON.parse(event.data);
          addMeshEvent(data);
        } catch {
          // Safely ignore malformed frames
        }
      };

      socket.onclose = () => {
        if (isCancelled) return;
        wsRef.current = null;
        setConnectionState('reconnecting');
        scheduleReconnect();
      };

      socket.onerror = () => {
        if (isCancelled) return;
        // WebSocket automatically triggers onclose next
      };
    }

    function scheduleReconnect() {
      if (isCancelled) return;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      const delay = BACKOFF_MS[Math.min(attemptRef.current, BACKOFF_MS.length - 1)];
      attemptRef.current += 1;
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, delay);
    }

    connect();

    return () => {
      isCancelled = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [syncSimulationState]);

  return {
    connectionState,
    events: getEvents(),
    clearEvents,
    subscribe,
    syncSimulationState,
    eventCount,
  };
}
