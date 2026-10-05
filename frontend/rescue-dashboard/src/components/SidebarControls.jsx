import { useMemo, useCallback } from 'react';
import { exportAutopilotMission, findShortestPathToGateway } from '../utils/geoMath';
import './SidebarControls.css';

// ─── Defaults (Shivalik College, Dehradun) ───────────────────────────────────

const DEFAULT_LAT = 30.3256;
const DEFAULT_LON = 77.9423;
const DEFAULT_AREA_SQ_KM = 4.0;

// ─── Status badge colours ────────────────────────────────────────────────────

const STATUS_THEME = {
  PLANNED: { color: '#60a5fa', bg: 'rgba(96,165,250,0.12)', dot: '#60a5fa' },
  ACTIVE:  { color: '#34d399', bg: 'rgba(52,211,153,0.12)', dot: '#34d399' },
  OFFLINE: { color: '#f87171', bg: 'rgba(248,113,113,0.12)', dot: '#f87171' },
};

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * SidebarControls — dark-themed control panel for the drone mesh simulator.
 */
export default function SidebarControls({
  centerLat = DEFAULT_LAT,
  centerLon = DEFAULT_LON,
  setCenterLat,
  setCenterLon,
  areaSqKm = DEFAULT_AREA_SQ_KM,
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
}) {
  // ── Derived data ─────────────────────────────────────────────────────────

  const selectedNodeData = useMemo(
    () => nodes.find((n) => n.id === selectedNode) ?? null,
    [nodes, selectedNode],
  );

  const activeCount = useMemo(
    () => nodes.filter((n) => n.status === 'ACTIVE').length,
    [nodes],
  );

  // Live square bounds calculation: Math.sqrt(areaSqKm)
  const sideLengthKm = useMemo(() => {
    return Math.sqrt(Math.max(0.1, Number(areaSqKm) || 4));
  }, [areaSqKm]);

  const sideLengthStr = `${sideLengthKm.toFixed(1)} km × ${sideLengthKm.toFixed(1)} km`;

  // ── Handlers ─────────────────────────────────────────────────────────────

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

  const handleWifiChange = useCallback(
    (e) => {
      const val = parseInt(e.target.value, 10);
      if (!Number.isNaN(val)) setWifiRangeM?.(val);
    },
    [setWifiRangeM],
  );

  const handleLoraChange = useCallback(
    (e) => {
      const val = parseInt(e.target.value, 10);
      if (!Number.isNaN(val)) setLoraRangeM?.(val);
    },
    [setLoraRangeM],
  );

  const isPathHighlighted = useMemo(() => {
    return Boolean(
      highlightedPath &&
      highlightedPath.length > 0 &&
      selectedNode &&
      highlightedPath[0] === selectedNode,
    );
  }, [highlightedPath, selectedNode]);

  const handleToggleShortestPath = useCallback(() => {
    if (!selectedNode) return;
    if (isPathHighlighted) {
      setHighlightedPath?.(null);
    } else {
      const path = findShortestPathToGateway(selectedNode, effectiveLinks, 'GATEWAY');
      setHighlightedPath?.(path);
    }
  }, [selectedNode, isPathHighlighted, effectiveLinks, setHighlightedPath]);

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

  // ── Status helpers ───────────────────────────────────────────────────────

  const statusTheme = (status) => STATUS_THEME[status] ?? STATUS_THEME.PLANNED;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <aside className="sidebar">
      {/* Header */}
      <div className="sidebar__header">
        <div className="sidebar__logo">🛰</div>
        <div>
          <div className="sidebar__title">Drone Mesh Planner</div>
          <div className="sidebar__subtitle">3-D Formation Simulator</div>
        </div>
      </div>

      {/* ── Backend Status Badge ─────────────────────────────────────────── */}
      <div
        className="sidebar__backend-status"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 14px',
          margin: '0 16px 8px',
          borderRadius: '8px',
          fontSize: '11px',
          fontWeight: 600,
          letterSpacing: '0.03em',
          background: backendOnline
            ? 'rgba(52,211,153,0.10)'
            : 'rgba(248,113,113,0.10)',
          color: backendOnline ? '#34d399' : '#f87171',
          border: `1px solid ${backendOnline ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.25)'}`,
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            backgroundColor: backendOnline ? '#34d399' : '#f87171',
            boxShadow: `0 0 6px ${backendOnline ? '#34d399' : '#f87171'}`,
            display: 'inline-block',
            animation: backendLoading ? 'pulse 1.2s ease-in-out infinite' : 'none',
          }}
        />
        {backendLoading
          ? 'Syncing with Disha backend…'
          : backendOnline
            ? 'Disha FastAPI Connected'
            : 'Backend Offline — Local Mode'}
      </div>

      {/* ── Disaster Centre Coordinates ──────────────────────────────────── */}
      <div className="sidebar__section">
        <div className="sidebar__section-title">
          <span className="sidebar__section-icon">📍</span>
          Disaster Centre Coordinates
        </div>

        <div className="sidebar__field">
          <label className="sidebar__label" htmlFor="input-lat">
            Latitude (°N)
          </label>
          <input
            id="input-lat"
            className="sidebar__input"
            type="number"
            step="0.0001"
            min={-90}
            max={90}
            value={centerLat}
            onChange={handleLatChange}
            placeholder="30.3256"
          />
        </div>

        <div className="sidebar__field">
          <label className="sidebar__label" htmlFor="input-lon">
            Longitude (°E)
          </label>
          <input
            id="input-lon"
            className="sidebar__input"
            type="number"
            step="0.0001"
            min={-180}
            max={180}
            value={centerLon}
            onChange={handleLonChange}
            placeholder="77.9423"
          />
        </div>

        <div className="sidebar__field">
          <label className="sidebar__label" htmlFor="input-area">
            Affected Area (km²)
          </label>
          <input
            id="input-area"
            className="sidebar__input"
            type="number"
            step="0.5"
            min="0.5"
            max="50.0"
            value={areaSqKm}
            onChange={handleAreaChange}
            placeholder="4.0"
          />
          <div className="sidebar__field-hint">
            📐 {sideLengthStr}
          </div>
        </div>
      </div>

      {/* ── Radio & Mesh Parameters ──────────────────────────────────────── */}
      <div className="sidebar__section">
        <div className="sidebar__section-title">
          <span className="sidebar__section-icon">📡</span>
          Radio & Mesh Parameters
        </div>

        {/* Wi-Fi Range Slider (100m – 500m) */}
        <div className="sidebar__field">
          <div className="sidebar__slider-header">
            <label className="sidebar__label" htmlFor="slider-wifi">
              Wi-Fi Coverage Radius
            </label>
            <span className="sidebar__slider-value">{wifiRangeM} m</span>
          </div>
          <input
            id="slider-wifi"
            className="sidebar__range"
            type="range"
            min="100"
            max="500"
            step="10"
            value={wifiRangeM}
            onChange={handleWifiChange}
          />
          <div className="sidebar__slider-scale">
            <span>100m</span>
            <span>300m</span>
            <span>500m</span>
          </div>
          <div className="sidebar__presets">
            {[100, 200, 300, 400, 500].map((val) => (
              <button
                key={val}
                type="button"
                className={`sidebar__preset-btn ${wifiRangeM === val ? 'active' : ''}`}
                onClick={() => setWifiRangeM?.(val)}
              >
                {val}m
              </button>
            ))}
          </div>
        </div>

        {/* LoRa Range Slider (500m – 1500m) */}
        <div className="sidebar__field" style={{ marginTop: '14px' }}>
          <div className="sidebar__slider-header">
            <label className="sidebar__label" htmlFor="slider-lora">
              LoRa Link / Mesh Spacing
            </label>
            <span className="sidebar__slider-value">
              {loraRangeM >= 1000 ? `${(loraRangeM / 1000).toFixed(2)} km` : `${loraRangeM} m`}
            </span>
          </div>
          <input
            id="slider-lora"
            className="sidebar__range"
            type="range"
            min="500"
            max="1500"
            step="25"
            value={loraRangeM}
            onChange={handleLoraChange}
          />
          <div className="sidebar__slider-scale">
            <span>500m</span>
            <span>1000m</span>
            <span>1500m</span>
          </div>
          <div className="sidebar__presets">
            {[500, 750, 1000, 1250, 1500].map((val) => (
              <button
                key={val}
                type="button"
                className={`sidebar__preset-btn ${loraRangeM === val ? 'active' : ''}`}
                onClick={() => setLoraRangeM?.(val)}
              >
                {val >= 1000 ? `${val / 1000}km` : `${val}m`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Mission Summary ──────────────────────────────────────────────── */}
      <div className="sidebar__section">
        <div className="sidebar__section-title">
          <span className="sidebar__section-icon">📊</span>
          Mission Summary
        </div>

        <div className="sidebar__metrics">
          <div className="sidebar__metric">
            <span className="sidebar__metric-label">Total Nodes</span>
            <span className="sidebar__metric-value sidebar__metric-value--highlight">
              {nodes.length}
            </span>
          </div>

          <div className="sidebar__metric">
            <span className="sidebar__metric-label">Nodes Active</span>
            <span className="sidebar__metric-value sidebar__metric-value--green">
              {activeCount} / {nodes.length}
            </span>
          </div>

          <div className="sidebar__metric">
            <span className="sidebar__metric-label">Topology</span>
            <span className="sidebar__metric-value sidebar__metric-value--amber">
              Hexagonal Mesh
            </span>
          </div>

          <div className="sidebar__metric">
            <span className="sidebar__metric-label">Coverage Area</span>
            <span className="sidebar__metric-value sidebar__metric-value--highlight">
              {Number(areaSqKm).toFixed(2)} km²
            </span>
          </div>

          <div className="sidebar__metric">
            <span className="sidebar__metric-label">Wi-Fi Radius</span>
            <span className="sidebar__metric-value sidebar__metric-value--highlight">
              {wifiRangeM} m
            </span>
          </div>

          <div className="sidebar__metric">
            <span className="sidebar__metric-label">LoRa Mesh Range</span>
            <span className="sidebar__metric-value sidebar__metric-value--highlight">
              {loraRangeM} m
            </span>
          </div>

          {deploymentPlan && (
            <>
              <div className="sidebar__metric">
                <span className="sidebar__metric-label">Wi-Fi Coverage</span>
                <span className="sidebar__metric-value sidebar__metric-value--green">
                  {((deploymentPlan.wifi_coverage ?? 0) * 100).toFixed(1)}%
                </span>
              </div>

              <div className="sidebar__metric">
                <span className="sidebar__metric-label">LoRa Links</span>
                <span className="sidebar__metric-value sidebar__metric-value--amber">
                  {deploymentPlan.links?.length ?? 0}
                </span>
              </div>

              <div className="sidebar__metric">
                <span className="sidebar__metric-label">Network Valid</span>
                <span
                  className={`sidebar__metric-value ${
                    deploymentPlan.valid
                      ? 'sidebar__metric-value--green'
                      : 'sidebar__metric-value--highlight'
                  }`}
                >
                  {deploymentPlan.valid ? '✓ Connected' : '✗ Disconnected'}
                </span>
              </div>

              {deploymentPlan.gateway && (
                <div className="sidebar__metric">
                  <span className="sidebar__metric-label">Gateway</span>
                  <span className="sidebar__metric-value" style={{ fontSize: '11px', color: '#fb923c' }}>
                    {deploymentPlan.gateway.lat?.toFixed(4)}, {deploymentPlan.gateway.lon?.toFixed(4)}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Selected Node Details ────────────────────────────────────────── */}
      <div className="sidebar__section">
        <div className="sidebar__section-title">
          <span className="sidebar__section-icon">🔎</span>
          Selected Node Details
        </div>

        {selectedNodeData ? (
          <>
            <div className="sidebar__node-card">
            <div className="sidebar__node-field sidebar__node-field--full">
              <span className="sidebar__node-key">Node ID</span>
              <span className="sidebar__node-val">{selectedNodeData.id}</span>
            </div>

            <div className="sidebar__node-field">
              <span className="sidebar__node-key">Latitude</span>
              <span className="sidebar__node-val">
                {selectedNodeData.lat.toFixed(6)}°
              </span>
            </div>

            <div className="sidebar__node-field">
              <span className="sidebar__node-key">Longitude</span>
              <span className="sidebar__node-val">
                {selectedNodeData.lon.toFixed(6)}°
              </span>
            </div>

            <div className="sidebar__node-field">
              <span className="sidebar__node-key">Altitude</span>
              <span className="sidebar__node-val">
                {selectedNodeData.altM} m AGL
              </span>
            </div>

            <div className="sidebar__node-field">
              <span className="sidebar__node-key">Status</span>
              <span
                className="sidebar__node-status"
                style={{ color: statusTheme(selectedNodeData.status).color }}
              >
                <span
                  className="sidebar__node-status-dot"
                  style={{
                    backgroundColor: statusTheme(selectedNodeData.status).dot,
                    boxShadow: `0 0 6px ${statusTheme(selectedNodeData.status).dot}`,
                  }}
                />
                {selectedNodeData.status}
              </span>
            </div>
          </div>

          <div style={{ marginTop: '12px' }}>
            <button
              type="button"
              className={`sidebar__btn-path ${isPathHighlighted ? 'sidebar__btn-path--active' : ''}`}
              onClick={handleToggleShortestPath}
            >
              <span className="sidebar__btn-path-icon">{isPathHighlighted ? '✓' : '⚡'}</span>
              <span>Shortest Path to Gateway</span>
            </button>

            {isPathHighlighted && highlightedPath && highlightedPath.length > 0 && (
              <div className="sidebar__path-summary">
                <div className="sidebar__path-route">
                  {highlightedPath.map((id, idx) => (
                    <span key={id} className="sidebar__path-step">
                      {id.replace('NODE-', 'N-')}
                      {idx < highlightedPath.length - 1 && <span className="sidebar__path-arrow">→</span>}
                    </span>
                  ))}
                </div>
                <div className="sidebar__path-hops">
                  {highlightedPath.length - 1} hops to Gateway (highlighted in black)
                </div>
              </div>
            )}
          </div>
        </>
        ) : (
          <div className="sidebar__empty">
            Click a node on the map to inspect it
          </div>
        )}
      </div>

      {/* ── Action Buttons ───────────────────────────────────────────────── */}
      <div className="sidebar__actions">
        <button
          className="sidebar__btn sidebar__btn--simulate"
          onClick={handleSimulate}
          disabled={isSimulating || nodes.length === 0}
        >
          <span className="sidebar__btn-icon">▶</span>
          {isSimulating
            ? 'Simulating…'
            : backendOnline
              ? 'Simulate 3D Drone Formation (Live)'
              : 'Simulate 3D Drone Formation'}
        </button>

        <button
          className="sidebar__btn sidebar__btn--export"
          onClick={handleExport}
          disabled={nodes.length === 0}
        >
          <span className="sidebar__btn-icon">⬇</span>
          Export Autopilot Waypoints (JSON)
        </button>
      </div>
    </aside>
  );
}
