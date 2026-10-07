import React, { useMemo, useCallback, useState, useEffect } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  MapPin,
  Radio,
  Activity,
  Layers,
  Send,
  Zap,
  ZapOff,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  FileDown,
  Navigation,
  Globe,
  Share2,
} from 'lucide-react';
import Card from '../ui/Card';
import StatCard from '../ui/StatCard';
import Slider from '../ui/Slider';
import StripeProgress from '../ui/StripeProgress';
import Button from '../ui/Button';
import Pill from '../ui/Pill';
import { exportAutopilotMission, findShortestPathToGateway } from '../../utils/geoMath';
import { formatNodeLabel } from '../../utils/nodeUtils';
import { useSosStore } from '../../state/sosStore';
import './LeftPanel.css';

// Wi-Fi and LoRa presets
const WIFI_PRESETS = [
  { label: '100m', value: 100 },
  { label: '200m', value: 200 },
  { label: '300m', value: 300 },
  { label: '400m', value: 400 },
  { label: '500m', value: 500 },
];

const LORA_PRESETS = [
  { label: '500m', value: 500 },
  { label: '750m', value: 750 },
  { label: '1.0km', value: 1000 },
  { label: '1.25km', value: 1250 },
  { label: '1.5km', value: 1500 },
];

export default function LeftPanel({
  centerLat = 30.3256,
  centerLon = 77.9423,
  setCenterLat,
  setCenterLon,
  areaSqKm = 4.0,
  setAreaSqKm,
  wifiRangeM = 300,
  setWifiRangeM,
  loraRangeM = 1000,
  setLoraRangeM,
  nodes = [],
  selectedNode = null,
  setSelectedNode,
  isSimulating = false,
  setIsSimulating,
  backendOnline = false,
  backendLoading = false,
  deploymentPlan = null,
  effectiveLinks = [],
  highlightedPath = null,
  setHighlightedPath,
  onSimulateStart,
  onKillNode,
  onReviveNode,
  className = '',
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [isPathRequested, setIsPathRequested] = useState(false);

  // ── Derived Data ──────────────────────────────────────────────────────────
  const selectedNodeData = useMemo(
    () => nodes.find((n) => n.id === selectedNode) ?? null,
    [nodes, selectedNode],
  );

  const activeCount = useMemo(
    () => nodes.filter((n) => n.status === 'ACTIVE').length,
    [nodes],
  );

  const offlineCount = useMemo(
    () => nodes.filter((n) => n.status === 'OFFLINE').length,
    [nodes],
  );

  const sosList = useSosStore();

  const deliveredSosCount = useMemo(
    () => sosList.filter((s) => s.status === 'DELIVERED').length,
    [sosList],
  );

  const inFlightSosCount = useMemo(
    () => sosList.filter((s) => s.status === 'IN_FLIGHT').length,
    [sosList],
  );

  const isDeploying = useMemo(
    () => isSimulating && nodes.some((n) => n.status === 'PLANNED'),
    [isSimulating, nodes],
  );

  const sideLengthKm = useMemo(() => {
    return Math.sqrt(Math.max(0.1, Number(areaSqKm) || 4));
  }, [areaSqKm]);

  // Coverage percentage
  const coveragePercent = useMemo(() => {
    if (deploymentPlan && typeof deploymentPlan.wifi_coverage === 'number') {
      return Math.round(deploymentPlan.wifi_coverage * 100);
    }
    // Estimation if offline: total disc areas vs boundary box area
    if (nodes.length === 0) return 0;
    const singleAreaSqKm = (Math.PI * Math.pow(wifiRangeM / 1000, 2));
    const totalCovered = singleAreaSqKm * nodes.length * 0.85; // overlap discounting
    return Math.min(100, Math.round((totalCovered / areaSqKm) * 100));
  }, [deploymentPlan, nodes.length, wifiRangeM, areaSqKm]);

  // Mean hops calculation
  const avgHops = useMemo(() => {
    const validNodesWithHops = nodes.filter((n) => typeof n.hopsFromGateway === 'number');
    if (validNodesWithHops.length > 0) {
      const sum = validNodesWithHops.reduce((acc, curr) => acc + curr.hopsFromGateway, 0);
      return (sum / validNodesWithHops.length).toFixed(1);
    }
    return nodes.length > 1 ? '1.8' : '1.0';
  }, [nodes]);

  const offlineNodeIds = useMemo(
    () => new Set(nodes.filter((n) => n.status === 'OFFLINE').map((n) => n.id)),
    [nodes],
  );

  const isPathHighlighted = useMemo(() => {
    return Boolean(
      highlightedPath &&
      highlightedPath.length >= 2 &&
      selectedNode &&
      highlightedPath[0] === selectedNode,
    );
  }, [highlightedPath, selectedNode]);

  // Reset path request when selectedNode changes
  useEffect(() => {
    setIsPathRequested(false);
  }, [selectedNode]);

  // Recompute and redraw shortest path whenever nodes or links change
  useEffect(() => {
    if (!isPathRequested || !selectedNode) return;
    const sel = nodes.find((n) => n.id === selectedNode);
    if (!sel || sel.status === 'OFFLINE') {
      setHighlightedPath?.(null);
      return;
    }

    const path = findShortestPathToGateway(
      selectedNode,
      effectiveLinks,
      'GATEWAY',
      offlineNodeIds,
    );
    setHighlightedPath?.(path && path.length >= 2 ? path : null);
  }, [isPathRequested, selectedNode, nodes, effectiveLinks, offlineNodeIds, setHighlightedPath]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleLatChange = useCallback(
    (e) => {
      const val = parseFloat(e.target.value);
      if (!Number.isNaN(val)) setCenterLat?.(val);
    },
    [setCenterLat],
  );

  const handleLonChange = useCallback(
    (e) => {
      const val = parseFloat(e.target.value);
      if (!Number.isNaN(val)) setCenterLon?.(val);
    },
    [setCenterLon],
  );

  const handleAreaChange = useCallback(
    (e) => {
      const val = parseFloat(e.target.value);
      if (!Number.isNaN(val) && val > 0) setAreaSqKm?.(val);
    },
    [setAreaSqKm],
  );

  const handleToggleShortestPath = useCallback(() => {
    if (!selectedNode) return;
    const sel = nodes.find((n) => n.id === selectedNode);
    if (sel && sel.status === 'OFFLINE') {
      setHighlightedPath?.(null);
      setIsPathRequested(false);
      return;
    }

    if (isPathRequested) {
      setIsPathRequested(false);
      setHighlightedPath?.(null);
    } else {
      setIsPathRequested(true);
      const path = findShortestPathToGateway(
        selectedNode,
        effectiveLinks,
        'GATEWAY',
        offlineNodeIds,
      );
      setHighlightedPath?.(path && path.length >= 2 ? path : null);
    }
  }, [selectedNode, isPathRequested, nodes, effectiveLinks, offlineNodeIds, setHighlightedPath]);

  const handleSimulate = useCallback(() => {
    setIsSimulating?.(true);
    onSimulateStart?.();
  }, [setIsSimulating, onSimulateStart]);

  const handleExport = useCallback(() => {
    if (nodes.length === 0) return;
    const mission = exportAutopilotMission(nodes, centerLat, centerLon);
    const blob = new Blob([JSON.stringify(mission, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `drone-mission-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [nodes, centerLat, centerLon]);

  const getNodeStatusVariant = (status) => {
    switch (status) {
      case 'ACTIVE':
        return 'success';
      case 'OFFLINE':
        return 'danger';
      case 'PLANNED':
      default:
        return 'info';
    }
  };

  return (
    <aside
      className={`disha-left-panel ${collapsed ? 'is-collapsed' : ''} ${className}`}
      aria-label="Disaster Control Panel"
    >
      {/* Collapse Toggle Tab Button */}
      <button
        type="button"
        className="disha-left-panel__toggle"
        onClick={() => setCollapsed(!collapsed)}
        title={collapsed ? 'Expand Left Panel' : 'Collapse Left Panel'}
        aria-label={collapsed ? 'Expand Left Panel' : 'Collapse Left Panel'}
      >
        {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
      </button>

      {!collapsed && (
        <div className="disha-left-panel__scroll-container">
          {/* Card A: Location & Area */}
          <Card className="disha-left-panel__card" padding="md">
            <div className="disha-card-heading">
              <div className="disha-card-heading__icon">
                <MapPin size={16} />
              </div>
              <div>
                <h3 className="disha-card-heading__title">Location & Area</h3>
                <span className="disha-card-heading__caption">Disaster epicenter bounds</span>
              </div>
            </div>

            <div className="disha-form-row">
              <div className="disha-input-group">
                <label className="disha-input-label" htmlFor="input-lat">Latitude (°N)</label>
                <input
                  id="input-lat"
                  type="number"
                  step="0.0001"
                  min={-90}
                  max={90}
                  value={centerLat}
                  onChange={handleLatChange}
                  className="disha-input"
                  placeholder="30.3256"
                />
              </div>

              <div className="disha-input-group">
                <label className="disha-input-label" htmlFor="input-lon">Longitude (°E)</label>
                <input
                  id="input-lon"
                  type="number"
                  step="0.0001"
                  min={-180}
                  max={180}
                  value={centerLon}
                  onChange={handleLonChange}
                  className="disha-input"
                  placeholder="77.9423"
                />
              </div>
            </div>

            <div className="disha-input-group" style={{ marginTop: '10px' }}>
              <div className="disha-input-header">
                <label className="disha-input-label" htmlFor="input-area">Affected Area</label>
                <span className="disha-input-hint">
                  {sideLengthKm.toFixed(1)} km × {sideLengthKm.toFixed(1)} km
                </span>
              </div>
              <div className="disha-input-affix-wrapper">
                <input
                  id="input-area"
                  type="number"
                  step="0.5"
                  min="0.5"
                  max="50.0"
                  value={areaSqKm}
                  onChange={handleAreaChange}
                  className="disha-input"
                  placeholder="4.0"
                />
                <span className="disha-input-affix">km²</span>
              </div>
            </div>
          </Card>

          {/* Card B: Radio Parameters */}
          <Card className="disha-left-panel__card" padding="md">
            <div className="disha-card-heading">
              <div className="disha-card-heading__icon">
                <Radio size={16} />
              </div>
              <div>
                <h3 className="disha-card-heading__title">Radio Parameters</h3>
                <span className="disha-card-heading__caption">Propagation & Link Ranges</span>
              </div>
            </div>

            <div className="disha-radio-sliders">
              <Slider
                label="Wi-Fi Coverage Radius"
                value={wifiRangeM}
                min={100}
                max={500}
                step={10}
                unit="m"
                onChange={(val) => setWifiRangeM?.(val)}
                presets={WIFI_PRESETS}
              />

              <div style={{ marginTop: '14px' }}>
                <Slider
                  label="LoRa Mesh Spacing"
                  value={loraRangeM}
                  min={500}
                  max={1500}
                  step={25}
                  unit={loraRangeM >= 1000 ? 'm' : 'm'}
                  onChange={(val) => setLoraRangeM?.(val)}
                  presets={LORA_PRESETS}
                />
              </div>
            </div>
          </Card>

          {/* Card C: Network Overview (2x2 Grid of StatCards) */}
          <Card className="disha-left-panel__card" padding="md">
            <div className="disha-card-heading">
              <div className="disha-card-heading__icon">
                <Activity size={16} />
              </div>
              <div>
                <h3 className="disha-card-heading__title">Network Overview</h3>
                <span className="disha-card-heading__caption">Mesh telemetry & topology</span>
              </div>
            </div>

            <div className="disha-stats-grid">
              {/* Card 1: Primary Gradient */}
              <StatCard
                title="Active Nodes"
                value={`${activeCount} / ${nodes.length}`}
                caption={
                  offlineCount > 0 ? (
                    <span className="disha-stat-offline-caption">
                      {offlineCount} offline
                    </span>
                  ) : activeCount === nodes.length && nodes.length > 0 ? (
                    '100% active'
                  ) : (
                    'Deploying formation'
                  )
                }
                variant="gradient"
                icon={Navigation}
              />

              {/* Card 2: Coverage % */}
              <StatCard
                title="Coverage"
                value={`${coveragePercent}%`}
                caption="Ground hotspot"
                variant="white"
                icon={Globe}
              />

              {/* Card 3: Avg Hops */}
              <StatCard
                title="Avg Hops"
                value={avgHops}
                caption="To Base Gateway"
                variant="white"
                icon={Share2}
              />

              {/* Card 4: SOS Delivered */}
              <StatCard
                title="SOS Delivered"
                value={deliveredSosCount}
                caption={
                  inFlightSosCount > 0
                    ? `${inFlightSosCount} in flight`
                    : 'All beacons cleared'
                }
                variant="white"
                icon={CheckCircle2}
              />
            </div>
          </Card>

          {/* Card D: Deployment */}
          <Card className="disha-left-panel__card" padding="md">
            <div className="disha-card-heading">
              <div className="disha-card-heading__icon">
                <Send size={16} />
              </div>
              <div>
                <h3 className="disha-card-heading__title">Deployment</h3>
                <span className="disha-card-heading__caption">Fleet dispatch & autopilot</span>
              </div>
            </div>

            <div className="disha-deployment-actions">
              <Button
                variant="primary"
                size="md"
                icon={Zap}
                disabled={isSimulating || nodes.length === 0}
                onClick={handleSimulate}
                className="disha-deployment-btn"
              >
                {isSimulating ? 'Simulating Deployment…' : 'Simulate 3D Drone Formation'}
              </Button>

              <StripeProgress
                value={activeCount}
                max={nodes.length || 1}
                label="Mesh Fleet Deployed"
                sublabel={`${activeCount} of ${nodes.length} nodes active`}
                showPercentage={true}
                animated={isSimulating}
              />

              <Button
                variant="secondary"
                size="md"
                icon={FileDown}
                disabled={nodes.length === 0}
                onClick={handleExport}
                className="disha-deployment-btn"
              >
                Export Autopilot Waypoints (JSON)
              </Button>
            </div>
          </Card>

          {/* Card E: Selected Node (conditional or empty state prompt) */}
          {selectedNodeData ? (
            <Card className="disha-left-panel__card disha-node-card-active" padding="md">
              <div className="disha-card-heading">
                <div className="disha-card-heading__icon disha-card-heading__icon--active">
                  <Navigation size={16} />
                </div>
                <div className="disha-card-heading__grow">
                  <div className="disha-node-title-row">
                    <h3 className="disha-card-heading__title">{selectedNodeData.id}</h3>
                    <Pill variant={getNodeStatusVariant(selectedNodeData.status)} dot={true}>
                      {selectedNodeData.status}
                    </Pill>
                  </div>
                  <span className="disha-card-heading__caption">Node Telemetry Profile</span>
                </div>
              </div>

              <div className="disha-node-metrics-grid">
                <div className="disha-node-metric-cell">
                  <span className="disha-node-metric-label">Latitude</span>
                  <span className="disha-node-metric-val">{selectedNodeData.lat.toFixed(5)}°N</span>
                </div>
                <div className="disha-node-metric-cell">
                  <span className="disha-node-metric-label">Longitude</span>
                  <span className="disha-node-metric-val">{selectedNodeData.lon.toFixed(5)}°E</span>
                </div>
                <div className="disha-node-metric-cell">
                  <span className="disha-node-metric-label">Altitude</span>
                  <span className="disha-node-metric-val">{selectedNodeData.altM} m AGL</span>
                </div>
                <div className="disha-node-metric-cell">
                  <span className="disha-node-metric-label">Wi-Fi Range</span>
                  <span className="disha-node-metric-val">{selectedNodeData.wifiRadiusM || wifiRangeM} m</span>
                </div>
              </div>

              <div className="disha-node-actions">
                {/* Danger "Kill node" button when ACTIVE */}
                {selectedNodeData.status === 'ACTIVE' && (
                  <Button
                    variant="danger"
                    size="sm"
                    icon={ZapOff}
                    disabled={!isSimulating || !backendOnline || isDeploying}
                    title={
                      isDeploying
                        ? 'Wait for deployment to finish'
                        : !isSimulating || !backendOnline
                        ? 'Start the simulation first'
                        : `Kill ${selectedNodeData.id}`
                    }
                    onClick={() => onKillNode?.(selectedNodeData.id)}
                    className="disha-node-action-btn"
                  >
                    Kill node
                  </Button>
                )}

                {/* Success "Revive node" button when OFFLINE */}
                {selectedNodeData.status === 'OFFLINE' && (
                  <Button
                    variant="success"
                    size="sm"
                    icon={CheckCircle2}
                    disabled={!isSimulating || !backendOnline}
                    title={
                      !isSimulating || !backendOnline
                        ? 'Start the simulation first'
                        : `Revive ${selectedNodeData.id}`
                    }
                    onClick={() => onReviveNode?.(selectedNodeData.id)}
                    className="disha-node-action-btn"
                  >
                    Revive node
                  </Button>
                )}

                {/* Shortest Path Toggle Button */}
                <Button
                  variant={isPathHighlighted ? 'dark' : 'secondary'}
                  size="sm"
                  icon={Navigation}
                  disabled={selectedNodeData.status === 'OFFLINE'}
                  title={
                    selectedNodeData.status === 'OFFLINE'
                      ? 'No route to gateway (Node offline)'
                      : undefined
                  }
                  onClick={handleToggleShortestPath}
                  className="disha-shortest-path-btn"
                >
                  {isPathHighlighted ? '✓ Path to Gateway Active' : 'Shortest Path to Gateway'}
                </Button>

                {/* Clear "No route to gateway" message if OFFLINE */}
                {selectedNodeData.status === 'OFFLINE' && (
                  <div className="disha-path-no-route" role="status">
                    <AlertTriangle size={14} />
                    <span>No route to gateway</span>
                  </div>
                )}

                {/* Clear "No route to gateway" message if requested but disconnected */}
                {selectedNodeData.status !== 'OFFLINE' &&
                  isPathRequested &&
                  (!highlightedPath || highlightedPath.length < 2) && (
                    <div className="disha-path-no-route" role="status">
                      <AlertTriangle size={14} />
                      <span>No route to gateway</span>
                    </div>
                  )}

                {/* Shortest path breadcrumbs when live route exists */}
                {selectedNodeData.status !== 'OFFLINE' &&
                  isPathHighlighted &&
                  highlightedPath &&
                  highlightedPath.length >= 2 && (
                    <div className="disha-path-breadcrumbs">
                      <div className="disha-path-route">
                        {highlightedPath.map((id, idx) => (
                          <span key={id} className="disha-path-step">
                            {id.replace('NODE-', 'N-')}
                            {idx < highlightedPath.length - 1 && (
                              <span className="disha-path-arrow">→</span>
                            )}
                          </span>
                        ))}
                      </div>
                      <span className="disha-path-hops">
                        {highlightedPath.length - 1} hops to Gateway (routed on map)
                      </span>
                    </div>
                  )}
              </div>
            </Card>
          ) : (
            <div className="disha-node-hint-card">
              <Navigation size={15} />
              <span>Click any node pin on the map to inspect details</span>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
