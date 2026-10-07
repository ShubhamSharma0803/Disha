import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Map3DView from './components/Map3DView';
import TopBar from './components/panels/TopBar';
import LeftPanel from './components/panels/LeftPanel';
import RightPanel from './components/panels/RightPanel';
import MapToolbar from './components/panels/MapToolbar';
import Legend from './components/panels/Legend';
import DemoBar from './components/panels/DemoBar';
import RerouteBanner from './components/panels/RerouteBanner';
import { calculateHexGrid, haversineDistance, offsetToGps } from './utils/geoMath';
import {
  fetchDeploymentPlan,
  startSimulation,
  isBackendOnline,
  killNode,
  reviveNode,
  fetchSos,
  fetchGatewayStatus,
} from './utils/backendApi';
import { normalizeNodeId } from './utils/nodeUtils';
import { useMeshEvents } from './hooks/useMeshEvents';
import { clearSos, hydrateSos } from './state/sosStore';
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
  const [activeStep, setActiveStep] = useState('1');
  const [is3DMode, setIs3DMode] = useState(true);

  // Backend integration state
  const [backendOnline, setBackendOnline] = useState(false);
  const [deploymentPlan, setDeploymentPlan] = useState(null);
  const [backendLoading, setBackendLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [gatewayStatus, setGatewayStatus] = useState(null);

  const debounceTimerRef = useRef(null);
  const mapActionsRef = useRef(null);

  // Toast notification helper
  const showToast = useCallback((msg) => {
    setToast(msg);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Clear highlighted path when selected node changes
  useEffect(() => {
    setHighlightedPath(null);
  }, [selectedNode]);

  // ── Check backend health ───────────────────────────────────────────────────
  const checkHealth = useCallback(async () => {
    const online = await isBackendOnline();
    setBackendOnline(online);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const runCheck = async () => {
      const online = await isBackendOnline();
      if (!cancelled) setBackendOnline(online);

      // Also poll gateway/bridge status
      const gw = await fetchGatewayStatus();
      if (!cancelled) setGatewayStatus(gw);
    };

    runCheck();
    const interval = setInterval(runCheck, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // ── Real Mesh Events Layer (WebSocket with auto-reconnect & state sync) ──
  const {
    connectionState,
    clearEvents,
    syncSimulationState,
  } = useMeshEvents({
    isSimulating,
    setNodes,
    onConnected: checkHealth,
  });

  // When WebSocket reports connected, reflect backend online
  useEffect(() => {
    if (connectionState === 'connected') {
      setBackendOnline(true);
    }
  }, [connectionState]);

  // ── Optimistic UI node kill / revive handlers ─────────────────────────────
  const handleKillNode = useCallback(
    async (nodeId) => {
      const normId = normalizeNodeId(nodeId);
      if (normId === 'GATEWAY') return;

      // Optimistic UI: mark OFFLINE immediately
      setNodes((prev) =>
        prev.map((n) => (normalizeNodeId(n.id) === normId ? { ...n, status: 'OFFLINE' } : n))
      );

      const res = await killNode(normId);
      if (!res) {
        // Revert on failure
        setNodes((prev) =>
          prev.map((n) => (normalizeNodeId(n.id) === normId ? { ...n, status: 'ACTIVE' } : n))
        );
        showToast('Could not reach backend');
      } else {
        syncSimulationState();
      }
    },
    [showToast, syncSimulationState],
  );

  const handleReviveNode = useCallback(
    async (nodeId) => {
      const normId = normalizeNodeId(nodeId);
      // Optimistic UI: mark ACTIVE immediately
      setNodes((prev) =>
        prev.map((n) => (normalizeNodeId(n.id) === normId ? { ...n, status: 'ACTIVE' } : n))
      );

      const res = await reviveNode(normId);
      if (!res) {
        // Revert on failure
        setNodes((prev) =>
          prev.map((n) => (normalizeNodeId(n.id) === normId ? { ...n, status: 'OFFLINE' } : n))
        );
        showToast('Could not reach backend');
      }
    },
    [showToast],
  );

  const handleReviveAll = useCallback(async () => {
    const offlineNodes = nodes.filter((n) => n.status === 'OFFLINE');
    if (offlineNodes.length === 0) return;

    // Optimistic UI: mark all OFFLINE nodes ACTIVE immediately
    setNodes((prev) =>
      prev.map((n) => (n.status === 'OFFLINE' ? { ...n, status: 'ACTIVE' } : n))
    );

    const results = await Promise.all(
      offlineNodes.map((n) => reviveNode(normalizeNodeId(n.id)))
    );

    const failedNodes = offlineNodes.filter((_, idx) => !results[idx]);
    if (failedNodes.length > 0) {
      const failedSet = new Set(failedNodes.map((n) => normalizeNodeId(n.id)));
      setNodes((prev) =>
        prev.map((n) => (failedSet.has(normalizeNodeId(n.id)) ? { ...n, status: 'OFFLINE' } : n))
      );
      showToast('Could not reach backend');
    }
  }, [nodes, showToast]);

  // Initial load: hydrate SOS from backend
  useEffect(() => {
    fetchSos().then((items) => {
      if (Array.isArray(items)) hydrateSos(items);
    });
  }, []);

  const handleResetSimulation = useCallback(async () => {
    if (!isSimulating) return;

    // Clear event store and SOS store
    clearEvents();
    clearSos();

    // Call startSimulation(currentPlan) to restart backend mesh WITHOUT replaying drone animation
    if (backendOnline) {
      await startSimulation(deploymentPlan);
    }

    // Set deployed nodes back to ACTIVE
    setNodes((prev) =>
      prev.map((n) => ({
        ...n,
        status: 'ACTIVE',
      }))
    );
  }, [isSimulating, backendOnline, deploymentPlan, clearEvents]);

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
          id: normalizeNodeId(n.id || idx + 1),
          lat: n.lat,
          lon: n.lon,
          altM: n.altM ?? 25,
          wifiRadiusM: plan.assumptions?.wifi_range_m ?? wifiRangeM,
          status: n.status || 'PLANNED',
          hopsFromGateway: n.hops_from_gateway,
          deployOrder: n.deploy_order,
        }));

        setNodes(backendNodes);
      } else {
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
  }, [backendOnline, deploymentPlan]);

  // Gateway coordinates
  const effectiveGateway = useMemo(() => {
    if (deploymentPlan?.gateway) return deploymentPlan.gateway;
    const sideM = Math.sqrt(Math.max(0.1, Number(areaSqKm) || 4)) * 1000;
    return { id: 'GATEWAY', ...offsetToGps(centerLat, centerLon, 0, -sideM / 2) };
  }, [deploymentPlan, centerLat, centerLon, areaSqKm]);

  // Effective links
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

  // Toolbar handlers connected to Map3DView imperative handles
  const handleToggle3D = useCallback(() => {
    mapActionsRef.current?.toggle3D?.();
    setIs3DMode((prev) => !prev);
  }, []);

  const handleFocusArea = useCallback(() => {
    mapActionsRef.current?.focusArea?.();
  }, []);

  const handleResetNorth = useCallback(() => {
    mapActionsRef.current?.resetNorth?.();
  }, []);

  const handleZoomIn = useCallback(() => {
    mapActionsRef.current?.zoomIn?.();
  }, []);

  const handleZoomOut = useCallback(() => {
    mapActionsRef.current?.zoomOut?.();
  }, []);

  const handleSelectSosNode = useCallback((nodeId) => {
    setSelectedNode(nodeId);
    mapActionsRef.current?.flyToNode?.(nodeId);
  }, []);

  return (
    <div className="disha-app">
      {/* Full-viewport 3D Mapbox Map Canvas */}
      <main className="disha-app__map-canvas">
        <Map3DView
          ref={mapActionsRef}
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

      {/* Floating Product UI Overlays (16px margins, non-blocking click-through) */}
      <div className="disha-app__overlay">
        {/* Top Bar Floating Card */}
        <TopBar
          activeStep={activeStep}
          onStepChange={setActiveStep}
          backendOnline={backendOnline}
          backendLoading={backendLoading}
          connectionState={connectionState}
          onRefresh={checkHealth}
          gatewayStatus={gatewayStatus}
        />

        {/* Floating Reroute / Dropped notification banner under TopBar */}
        <RerouteBanner />

        {/* Middle Main Workspace Area */}
        <div className="disha-app__workspace">
          {/* Left Panel: Location, Radio, Overview, Deployment, Selected Node */}
          <LeftPanel
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
            onKillNode={handleKillNode}
            onReviveNode={handleReviveNode}
          />

          {/* Central Map Overlay Controls */}
          <div className="disha-app__center-controls">
            {/* Map Toolbar (Top-Left of map area) */}
            <div className="disha-app__toolbar-wrapper">
              <MapToolbar
                is3DMode={is3DMode}
                onToggle3D={handleToggle3D}
                onFocusArea={handleFocusArea}
                onResetNorth={handleResetNorth}
                onZoomIn={handleZoomIn}
                onZoomOut={handleZoomOut}
              />
            </div>

            {/* Bottom Controls Row: Legend + Demo Bar */}
            <div className="disha-app__bottom-row">
              <Legend
                nodeCount={nodes.length}
                areaSqKm={areaSqKm}
                className="disha-app__legend-wrapper"
              />

              <DemoBar
                nodes={nodes}
                isSimulating={isSimulating}
                backendOnline={backendOnline}
                onKillNode={handleKillNode}
                onReviveAll={handleReviveAll}
                onResetSimulation={handleResetSimulation}
                showToast={showToast}
                className="disha-app__demobar-wrapper"
              />
            </div>
          </div>

          {/* Right Panel: SOS, Failures, Log, Sniffing tabs */}
          <RightPanel
            nodes={nodes}
            onSelectNode={handleSelectSosNode}
            onReviveNode={handleReviveNode}
          />
        </div>
      </div>

      {/* Floating error/notification toast */}
      {toast && (
        <div className="disha-toast" role="alert">
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}

export default App;
