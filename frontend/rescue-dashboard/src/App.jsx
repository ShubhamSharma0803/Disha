import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import SidebarControls from './components/SidebarControls';
import Map3DView from './components/Map3DView';
import { calculateHexGrid, haversineDistance, offsetToGps } from './utils/geoMath';
import {
  fetchDeploymentPlan,
  startSimulation,
  isBackendOnline,
  connectEventStream,
} from './utils/backendApi';
import './App.css';

// ─── Defaults (Shivalik College, Dehradun) ───────────────────────────────────

const DEFAULT_LAT = 30.3256;
const DEFAULT_LON = 77.9423;
const DEFAULT_AREA_SQ_KM = 4.0;
const DEFAULT_WIFI_RANGE_M = 300;
const DEFAULT_LORA_RANGE_M = 1000;

/** Debounce delay (ms) before calling the backend after parameter changes */
const PLAN_DEBOUNCE_MS = 600;

// ─── App ─────────────────────────────────────────────────────────────────────

function App() {
  const [centerLat, setCenterLat] = useState(DEFAULT_LAT);
  const [centerLon, setCenterLon] = useState(DEFAULT_LON);
  const [areaSqKm, setAreaSqKm] = useState(DEFAULT_AREA_SQ_KM);
  const [wifiRangeM, setWifiRangeM] = useState(DEFAULT_WIFI_RANGE_M);
  const [loraRangeM, setLoraRangeM] = useState(DEFAULT_LORA_RANGE_M);
  const [nodes, setNodes] = useState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [highlightedPath, setHighlightedPath] = useState(null);
  const [isSimulating, setIsSimulating] = useState(false);

  // Backend integration state
  const [backendOnline, setBackendOnline] = useState(false);
  const [deploymentPlan, setDeploymentPlan] = useState(null);
  const [backendLoading, setBackendLoading] = useState(false);
  const debounceTimerRef = useRef(null);

  // Clear highlighted path when selected node changes
  useEffect(() => {
    setHighlightedPath(null);
  }, [selectedNode]);

  // ── Check backend health on mount ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const checkHealth = async () => {
      const online = await isBackendOnline();
      if (!cancelled) setBackendOnline(online);
    };

    checkHealth();

    // Re-check every 15 seconds in case the backend comes online later
    const interval = setInterval(checkHealth, 15000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // ── Listen to live simulation events over WebSocket when backend is online ─
  useEffect(() => {
    if (!backendOnline) return;

    const ws = connectEventStream();
    if (!ws) return;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'PACKET_FORWARDED' || data.type === 'EMERGENCY_DELIVERED') {
          if (data.node_id) {
            setNodes((prev) =>
              prev.map((n) => (n.id === data.node_id ? { ...n, status: 'ACTIVE' } : n)),
            );
          }
        } else if (data.type === 'NODE_FAILED') {
          if (data.node_id) {
            setNodes((prev) =>
              prev.map((n) => (n.id === data.node_id ? { ...n, status: 'OFFLINE' } : n)),
            );
          }
        } else if (data.type === 'NODE_REVIVED') {
          if (data.node_id) {
            setNodes((prev) =>
              prev.map((n) => (n.id === data.node_id ? { ...n, status: 'ACTIVE' } : n)),
            );
          }
        }
      } catch (err) {
        // Ignore non-json frames
      }
    };

    return () => {
      ws.close();
    };
  }, [backendOnline]);

  // ── Recalculate grid via backend /plan (with local fallback) ───────────────
  useEffect(() => {
    // Always compute local grid immediately for instant UI response
    const localGrid = calculateHexGrid(
      centerLat,
      centerLon,
      areaSqKm,
      loraRangeM,
      wifiRangeM,
    );
    setNodes(localGrid);
    setSelectedNode(null);
    setIsSimulating(false);

    // Debounce the backend call to avoid spamming during rapid slider changes
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(async () => {
      // Attempt backend plan generation
      setBackendLoading(true);
      const plan = await fetchDeploymentPlan({
        centerLat,
        centerLon,
        areaSqKm,
        wifiRangeM,
        loraRangeM,
      });

      if (plan && plan.nodes && plan.nodes.length > 0) {
        setBackendOnline(true);
        setDeploymentPlan(plan);

        // Map backend node positions into our 3D visualizer node format
        const backendNodes = plan.nodes.map((n, idx) => ({
          id: n.id || `NODE-${String(idx).padStart(4, '0')}`,
          lat: n.lat,
          lon: n.lon,
          altM: n.altM ?? 25,
          wifiRadiusM: plan.assumptions?.wifi_range_m ?? wifiRangeM,
          status: n.status || 'PLANNED',
          // Preserve backend-specific fields for simulation use
          hopsFromGateway: n.hops_from_gateway,
          deployOrder: n.deploy_order,
        }));

        setNodes(backendNodes);
      } else {
        // Backend unreachable or returned empty — keep the local grid
        setDeploymentPlan(null);
        const online = await isBackendOnline();
        setBackendOnline(online);
      }

      setBackendLoading(false);
    }, PLAN_DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [centerLat, centerLon, areaSqKm, wifiRangeM, loraRangeM]);

  // ── Listen for drone arrival events dispatched by Map3DView ──────────────
  useEffect(() => {
    const handler = (e) => {
      const { nodeId } = e.detail;
      setNodes((prev) =>
        prev.map((n) =>
          n.id === nodeId ? { ...n, status: 'ACTIVE' } : n,
        ),
      );
    };

    window.addEventListener('drone:node-arrived', handler);
    return () => window.removeEventListener('drone:node-arrived', handler);
  }, []);

  // ── Simulation trigger (POST /simulation/start) ────────────────────
  const handleSimulateStart = useCallback(async () => {
    setIsSimulating(true);

    if (backendOnline && deploymentPlan) {
      // Send deployment plan to backend simulation engine
      const result = await startSimulation(deploymentPlan);

      if (result && result.status === 'started') {
        console.info(
          '[App] Backend simulation started —',
          result.nodes?.length ?? 0,
          'nodes,',
          result.links?.length ?? 0,
          'links',
        );
      } else {
        console.warn('[App] Backend simulation failed, running local-only animation');
      }
    }
    // The 3D drone animation in Map3DView is driven by the isSimulating flag
    // and will run regardless of backend availability
  }, [backendOnline, deploymentPlan]);

  // Gateway coordinates (from backend plan or south edge default)
  const effectiveGateway = useMemo(() => {
    if (deploymentPlan?.gateway) return deploymentPlan.gateway;
    const sideM = Math.sqrt(Math.max(0.1, Number(areaSqKm) || 4)) * 1000;
    return { id: 'GATEWAY', ...offsetToGps(centerLat, centerLon, 0, -sideM / 2) };
  }, [deploymentPlan, centerLat, centerLon, areaSqKm]);

  // Links between nodes & gateway (from backend plan or local LoRa range fallback)
  const effectiveLinks = useMemo(() => {
    if (deploymentPlan?.links && deploymentPlan.links.length > 0) {
      return deploymentPlan.links;
    }
    const allPts = [{ id: 'GATEWAY', lat: effectiveGateway.lat, lon: effectiveGateway.lon }, ...nodes];
    const generated = [];
    for (let i = 0; i < allPts.length; i++) {
      for (let j = i + 1; j < allPts.length; j++) {
        const d = haversineDistance(allPts[i].lat, allPts[i].lon, allPts[j].lat, allPts[j].lon);
        if (d <= loraRangeM) {
          generated.push({
            from: allPts[i].id,
            to: allPts[j].id,
            distance_m: Math.round(d),
          });
        }
      }
    }
    return generated;
  }, [deploymentPlan, nodes, effectiveGateway, loraRangeM]);

  return (
    <div className="app">
      <SidebarControls
        centerLat={centerLat}
        centerLon={centerLon}
        setCenterLat={setCenterLat}
        setCenterLon={setCenterLon}
        areaSqKm={areaSqKm}
        setAreaSqKm={setAreaSqKm}
        wifiRangeM={wifiRangeM}
        setWifiRangeM={setWifiRangeM}
        loraRangeM={loraRangeM}
        setLoraRangeM={setLoraRangeM}
        nodes={nodes}
        selectedNode={selectedNode}
        setSelectedNode={setSelectedNode}
        isSimulating={isSimulating}
        setIsSimulating={setIsSimulating}
        backendOnline={backendOnline}
        backendLoading={backendLoading}
        deploymentPlan={deploymentPlan}
        effectiveLinks={effectiveLinks}
        highlightedPath={highlightedPath}
        setHighlightedPath={setHighlightedPath}
        onSimulateStart={handleSimulateStart}
      />

      <main className="app__map">
        <Map3DView
          centerLat={centerLat}
          centerLon={centerLon}
          areaSqKm={areaSqKm}
          nodes={nodes}
          selectedNode={selectedNode}
          setSelectedNode={setSelectedNode}
          isSimulating={isSimulating}
          links={effectiveLinks}
          gateway={effectiveGateway}
          highlightedPath={highlightedPath}
        />
      </main>
    </div>
  );
}

export default App;
