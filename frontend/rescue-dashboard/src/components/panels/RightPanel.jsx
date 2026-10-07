import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ChevronRight,
  ChevronLeft,
  LifeBuoy,
  AlertTriangle,
  FileText,
  Radio,
  Clock,
  Users,
  GitFork,
  CheckCircle2,
  ZapOff,
  Zap,
  RotateCcw,
  Trash2,
  Signal,
  Crosshair,
  Wifi,
  Sparkles,
} from 'lucide-react';
import Card from '../ui/Card';
import SegmentedTabs from '../ui/SegmentedTabs';
import EmptyState from '../ui/EmptyState';
import Chip from '../ui/Chip';
import Pill from '../ui/Pill';
import Button from '../ui/Button';
import { useSosStore, SOS_CATEGORIES, formatRouteText } from '../../state/sosStore';
import {
  getEvents,
  subscribe,
  clearEvents,
  addMeshEvent,
} from '../../state/meshEvents';
import { formatNodeLabel, normalizeNodeId } from '../../utils/nodeUtils';
import './RightPanel.css';

const RIGHT_TABS = [
  { id: 'sos', label: 'SOS', icon: LifeBuoy },
  { id: 'failures', label: 'Failures', icon: AlertTriangle },
  { id: 'log', label: 'Log', icon: FileText },
  { id: 'sniffing', label: 'Sniffing', icon: Radio },
];

function formatTimeAgo(timestamp) {
  if (!timestamp) return 'just now';
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000));
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

function formatClockTime(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export default function RightPanel({
  nodes = [],
  onSelectNode,
  onReviveNode,
  className = '',
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState('sos');
  const [logFilter, setLogFilter] = useState('all'); // 'all' | 'packets' | 'routing' | 'nodes'
  const [allEvents, setAllEvents] = useState(() => getEvents().slice(0, 200));
  const [sniffObservations, setSniffObservations] = useState([]);
  const [, setTick] = useState(0);

  const sosList = useSosStore();

  // Periodic tick every 3s to refresh relative timestamps
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 3000);
    return () => clearInterval(timer);
  }, []);

  // Subscribe to live mesh events for the Log & Sniffing tabs (capped at latest 200 events)
  useEffect(() => {
    // Initial load capped at latest 200
    setAllEvents([...getEvents().slice(0, 200)]);

    const unsubWildcard = subscribe('*', (ev) => {
      // Keep only latest 200 events
      setAllEvents([...getEvents().slice(0, 200)]);

      // If it's a SEARCH_OBSERVATION, collect into sniffing feed
      if (ev.kind === 'SEARCH_OBSERVATION' || ev.event === 'SEARCH_OBSERVATION') {
        const sourceKind = ev.source_kind || (ev.is_simulated ? 'simulated' : 'simulated');
        setSniffObservations((prev) => [
          {
            id: `sniff-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            observerNode: ev.observer_node || ev.source || 'NODE-01',
            rssi: ev.rssi ?? -72,
            deviceHash: ev.device_hash || `HASH-${Math.random().toString(16).substring(2, 10).toUpperCase()}`,
            timestamp: ev.timestamp || new Date().toISOString(),
            isSimulated: sourceKind !== 'hardware',
            sourceKind,
          },
          ...prev.slice(0, 49),
        ]);
      }
    });

    const unsubClear = subscribe('__CLEAR__', () => {
      setAllEvents([]);
      setSniffObservations([]);
    });

    return () => {
      unsubWildcard();
      unsubClear();
    };
  }, []);

  // Offline / Failed nodes derived from nodes prop
  const offlineNodes = useMemo(() => {
    return nodes.filter(
      (n) => n.status === 'OFFLINE' && normalizeNodeId(n.id) !== 'GATEWAY'
    );
  }, [nodes]);

  // Tab badges calculation
  const tabsWithBadges = RIGHT_TABS.map((tab) => {
    if (tab.id === 'sos') {
      return { ...tab, count: sosList.length > 0 ? sosList.length : undefined };
    }
    if (tab.id === 'failures') {
      return { ...tab, count: offlineNodes.length > 0 ? offlineNodes.length : undefined };
    }
    if (tab.id === 'log') {
      return { ...tab, count: allEvents.length > 0 ? allEvents.length : undefined };
    }
    if (tab.id === 'sniffing') {
      return { ...tab, count: sniffObservations.length > 0 ? sniffObservations.length : undefined };
    }
    return tab;
  });

  // Filtered log events
  const filteredEvents = useMemo(() => {
    if (logFilter === 'all') return allEvents;
    if (logFilter === 'packets') {
      return allEvents.filter((e) =>
        ['PACKET_FORWARDED', 'PACKET_DELIVERED', 'PACKET_REROUTED', 'PACKET_DROPPED', 'EMERGENCY_CREATED'].includes(
          e.kind
        )
      );
    }
    if (logFilter === 'routing') {
      return allEvents.filter((e) =>
        ['ROUTE_CHANGED', 'NEIGHBOUR_LOST', 'LINK_CREATED'].includes(e.kind)
      );
    }
    if (logFilter === 'nodes') {
      return allEvents.filter((e) =>
        ['NODE_ACTIVE', 'NODE_FAILED', 'NODE_REVIVED'].includes(e.kind)
      );
    }
    return allEvents;
  }, [allEvents, logFilter]);

  // Helper to simulate a Wi-Fi sniffing event for demo purposes
  const handleSimulateSniff = useCallback(() => {
    const activeNodes = nodes.filter((n) => n.status === 'ACTIVE' && normalizeNodeId(n.id) !== 'GATEWAY');
    const randomNode = activeNodes.length > 0 ? activeNodes[Math.floor(Math.random() * activeNodes.length)].id : 'NODE-04';
    const rssiValues = [-58, -64, -71, -78, -84, -91];
    const pickedRssi = rssiValues[Math.floor(Math.random() * rssiValues.length)];
    const mockHash = `WIFI-SHA256-${Math.random().toString(16).substring(2, 8).toUpperCase()}`;

    addMeshEvent({
      event: 'SEARCH_OBSERVATION',
      kind: 'SEARCH_OBSERVATION',
      observer_node: randomNode,
      rssi: pickedRssi,
      device_hash: mockHash,
      timestamp: new Date().toISOString(),
      is_simulated: true,
    });
  }, [nodes]);

  return (
    <aside
      className={`disha-right-panel ${collapsed ? 'is-collapsed' : ''} ${className}`}
      aria-label="Mission Activity and SOS Monitor"
    >
      {/* Collapse Toggle Tab Button */}
      <button
        type="button"
        className="disha-right-panel__toggle"
        onClick={() => setCollapsed(!collapsed)}
        title={collapsed ? 'Expand Right Panel' : 'Collapse Right Panel'}
        aria-label={collapsed ? 'Expand Right Panel' : 'Collapse Right Panel'}
      >
        {collapsed ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
      </button>

      {!collapsed && (
        <Card className="disha-right-panel__content" padding="lg">
          {/* Header */}
          <div className="disha-right-panel__header">
            <div>
              <h3 className="disha-right-panel__title">Telemetry & Signals</h3>
              <p className="disha-right-panel__subtitle">Real-time rescue monitoring</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="disha-right-panel__tabs-wrapper">
            <SegmentedTabs
              tabs={tabsWithBadges}
              activeId={activeTab}
              onChange={setActiveTab}
              size="sm"
              variant="solid"
            />
          </div>

          {/* Tab Panes */}
          <div className="disha-right-panel__body">
            {/* ─── TAB 1: SOS FEED ─── */}
            {activeTab === 'sos' && (
              <div className="disha-right-panel__feed">
                {sosList.length === 0 ? (
                  <EmptyState
                    icon={LifeBuoy}
                    title="No active SOS alerts"
                    description="Incoming distress beacons from hardware nodes will appear here in ranked priority order."
                  />
                ) : (
                  sosList.map((item, idx) => {
                    const catMeta = SOS_CATEGORIES[item.code] || SOS_CATEGORIES.MED;
                    const statusVariant =
                      item.status === 'DELIVERED'
                        ? 'success'
                        : item.status === 'DROPPED'
                        ? 'danger'
                        : 'warning';
                    const statusLabel =
                      item.status === 'DELIVERED'
                        ? 'Delivered'
                        : item.status === 'DROPPED'
                        ? 'Dropped'
                        : 'In flight';

                    const isDeliveredRecent =
                      item.status === 'DELIVERED' &&
                      item.deliveredAt &&
                      Date.now() - item.deliveredAt < 3500;

                    const routeDisplay = formatRouteText(item.route);
                    const hopsSuffix =
                      item.status === 'DELIVERED'
                        ? ` · ${item.hopCount ?? Math.max(0, item.route.length - 1)} ${
                            (item.hopCount ?? (item.route.length - 1)) === 1 ? 'hop' : 'hops'
                          }`
                        : '';

                    return (
                      <div
                        key={item.packetId}
                        className={`disha-sample-sos-card disha-sos-card ${
                          isDeliveredRecent ? 'is-delivered-flash' : ''
                        }`}
                        onClick={() => onSelectNode?.(item.source)}
                        title={`Click to focus ${formatNodeLabel(item.source)} on map`}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            onSelectNode?.(item.source);
                          }
                        }}
                      >
                        <div className="disha-sample-sos-card__rank-badge">
                          #{idx + 1}
                        </div>
                        <div className="disha-sample-sos-card__content">
                          <div className="disha-sample-sos-card__top">
                            <div className="disha-sample-sos-card__tags">
                              <Chip variant={catMeta.chipVariant} size="sm">
                                {catMeta.label}
                              </Chip>
                              {/* Source kind badge: green HW for hardware, amber SIM for simulated */}
                              {item.sourceKind === 'hardware' ? (
                                <span className="disha-source-badge disha-source-badge--hw" title="Reported by physical ESP32 hardware node">
                                  HW
                                </span>
                              ) : (
                                <span className="disha-source-badge disha-source-badge--sim" title="Simulated or dashboard-originated">
                                  SIM
                                </span>
                              )}
                              <span className="disha-sample-sos-card__people">
                                <Users size={12} /> ×{item.people}{' '}
                                {item.people === 1 ? 'person' : 'people'}
                              </span>
                              {item.rerouted && (
                                <span className="disha-sos-card__rerouted" title="Route lost and recalculated">
                                  <GitFork size={10} /> Rerouted
                                </span>
                              )}
                            </div>
                            <Pill variant={statusVariant} dot={true}>
                              {statusLabel}
                            </Pill>
                          </div>

                          <div className="disha-sample-sos-card__middle">
                            <span className="disha-sample-sos-card__source">
                              From <strong>{formatNodeLabel(item.source)}</strong>
                            </span>
                            {item.note && (
                              <p className="disha-sample-sos-card__note">
                                "{item.note}"
                              </p>
                            )}
                          </div>

                          <div className="disha-sample-sos-card__footer">
                            <span className="disha-sample-sos-card__time">
                              <Clock size={11} /> {formatTimeAgo(item.createdAt)}
                            </span>
                            <span className="disha-sample-sos-card__hops">
                              Route: {routeDisplay}
                              {hopsSuffix}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* ─── TAB 2: FAILURES ─── */}
            {activeTab === 'failures' && (
              <div className="disha-right-panel__failures-tab">
                {offlineNodes.length === 0 ? (
                  <EmptyState
                    icon={CheckCircle2}
                    title="All nodes operational"
                    description="No dead or isolated nodes detected by the mesh watchdog. The network topology is fully healthy."
                  />
                ) : (
                  <div className="disha-failure-list">
                    <div className="disha-failure-summary-badge">
                      <AlertTriangle size={14} />
                      <span>
                        <strong>{offlineNodes.length}</strong> {offlineNodes.length === 1 ? 'node' : 'nodes'} currently offline
                      </span>
                    </div>

                    {offlineNodes.map((node) => {
                      const label = formatNodeLabel(node.id);
                      return (
                        <div key={node.id} className="disha-failure-card">
                          <div className="disha-failure-card__top">
                            <div className="disha-failure-card__header">
                              <span className="disha-failure-card__icon">
                                <ZapOff size={16} />
                              </span>
                              <div>
                                <h4 className="disha-failure-card__title">{label}</h4>
                                <span className="disha-failure-card__status">Power Loss / Unreachable</span>
                              </div>
                            </div>
                            <Pill variant="danger" dot={true}>
                              Offline
                            </Pill>
                          </div>

                          <div className="disha-failure-card__meta">
                            <span>
                              Coordinates: {node.lat ? node.lat.toFixed(4) : '--'}, {node.lon ? node.lon.toFixed(4) : '--'}
                            </span>
                            {node.hops_from_gateway && (
                              <span>Last distance: {node.hops_from_gateway} hops</span>
                            )}
                          </div>

                          <div className="disha-failure-card__actions">
                            <Button
                              variant="ghost"
                              size="xs"
                              icon={Crosshair}
                              onClick={() => onSelectNode?.(node.id)}
                            >
                              Focus on Map
                            </Button>
                            {onReviveNode && (
                              <Button
                                variant="primary"
                                size="xs"
                                icon={Zap}
                                onClick={() => onReviveNode(node.id)}
                              >
                                Revive Node
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ─── TAB 3: NETWORK LOG ─── */}
            {activeTab === 'log' && (
              <div className="disha-right-panel__log-tab">
                {/* Filter Chips & Clear */}
                <div className="disha-log-toolbar">
                  <div className="disha-log-chips">
                    {[
                      { id: 'all', label: 'All' },
                      { id: 'packets', label: 'Packets' },
                      { id: 'routing', label: 'Routing' },
                      { id: 'nodes', label: 'Nodes' },
                    ].map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        className={`disha-log-chip ${logFilter === f.id ? 'is-active' : ''}`}
                        onClick={() => setLogFilter(f.id)}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  {allEvents.length > 0 && (
                    <button
                      type="button"
                      className="disha-log-clear-btn"
                      onClick={() => clearEvents()}
                      title="Clear event log"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>

                {filteredEvents.length === 0 ? (
                  <EmptyState
                    icon={FileText}
                    title="No events recorded"
                    description="Network topology changes, route optimizations, and packet deliveries will appear here as they stream from the mesh engine."
                  />
                ) : (
                  <div className="disha-log-stream">
                    {filteredEvents.map((ev, index) => {
                      let tagVariant = 'neutral';
                      let tagText = ev.kind;

                      if (ev.kind === 'PACKET_DELIVERED') {
                        tagVariant = 'success';
                        tagText = 'DELIVERED';
                      } else if (ev.kind === 'PACKET_FORWARDED') {
                        tagVariant = 'info';
                        tagText = 'FORWARD';
                      } else if (ev.kind === 'PACKET_REROUTED') {
                        tagVariant = 'warning';
                        tagText = 'REROUTE';
                      } else if (ev.kind === 'PACKET_DROPPED' || ev.kind === 'NODE_FAILED') {
                        tagVariant = 'danger';
                        tagText = ev.kind === 'NODE_FAILED' ? 'NODE DEAD' : 'DROPPED';
                      } else if (ev.kind === 'ROUTE_CHANGED') {
                        tagVariant = 'warning';
                        tagText = 'ROUTE';
                      } else if (ev.kind === 'LINK_CREATED') {
                        tagVariant = 'neutral';
                        tagText = 'LINK';
                      } else if (ev.kind === 'NODE_ACTIVE' || ev.kind === 'NODE_REVIVED') {
                        tagVariant = 'success';
                        tagText = 'ACTIVE';
                      }

                      return (
                        <div key={`${ev.kind}-${ev.timestamp}-${index}`} className="disha-log-row">
                          <div className="disha-log-row__top">
                            <span className={`disha-log-badge disha-log-badge--${tagVariant}`}>
                              {tagText}
                            </span>
                            <span className="disha-log-row__time">
                              {formatClockTime(ev.timestamp)}
                            </span>
                          </div>

                          <div className="disha-log-row__detail">
                            {ev.kind === 'PACKET_FORWARDED' && (
                              <span>
                                Hop: <strong>{formatNodeLabel(ev.from)}</strong> → <strong>{formatNodeLabel(ev.to)}</strong>
                              </span>
                            )}
                            {ev.kind === 'PACKET_DELIVERED' && (
                              <span>
                                Delivered to Gateway: <code>{ev.packet_id?.slice(0, 14)}</code>
                              </span>
                            )}
                            {ev.kind === 'PACKET_REROUTED' && (
                              <span>
                                Failover at {formatNodeLabel(ev.at_node || ev.source)} via {formatNodeLabel(ev.new_next_hop || ev.next_hop)}
                              </span>
                            )}
                            {ev.kind === 'PACKET_DROPPED' && (
                              <span>
                                Dropped at {formatNodeLabel(ev.at_node || ev.source)} ({ev.reason || 'No route'})
                              </span>
                            )}
                            {ev.kind === 'ROUTE_CHANGED' && (
                              <span>
                                {formatNodeLabel(ev.source)} next hop: {ev.new_route?.[0] ? formatNodeLabel(ev.new_route[0]) : 'None'}
                              </span>
                            )}
                            {ev.kind === 'LINK_CREATED' && (
                              <span>
                                LoRa link: {formatNodeLabel(ev.from)} ↔ {formatNodeLabel(ev.to)}
                              </span>
                            )}
                            {ev.kind === 'NODE_ACTIVE' && (
                              <span>Node online: {formatNodeLabel(ev.node_id)}</span>
                            )}
                            {ev.kind === 'NODE_FAILED' && (
                              <span>Node power lost: {formatNodeLabel(ev.node_id)}</span>
                            )}
                            {ev.kind === 'NODE_REVIVED' && (
                              <span>Node restored: {formatNodeLabel(ev.node_id)}</span>
                            )}
                            {ev.kind === 'NEIGHBOUR_LOST' && (
                              <span>Unreachable neighbor: {formatNodeLabel(ev.neighbour_id)} (detected by {formatNodeLabel(ev.detected_by)})</span>
                            )}
                            {ev.kind === 'EMERGENCY_CREATED' && (
                              <span>Originated SOS at {formatNodeLabel(ev.source)}</span>
                            )}
                            {ev.kind === 'SEARCH_OBSERVATION' && (
                              <span>Wi-Fi probe at {formatNodeLabel(ev.observer_node)} ({ev.rssi} dBm)</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ─── TAB 4: PASSIVE WI-FI SNIFFING (SEARCH ASSISTANCE) ─── */}
            {activeTab === 'sniffing' && (
              <div className="disha-right-panel__sniffing-tab">
                {/* Amber SIMULATED Badge & Note */}
                <div className="disha-sniffing-sim-notice">
                  <div className="disha-sniffing-sim-notice__top">
                    <span className="disha-sim-badge">SIMULATED</span>
                  </div>
                  <p className="disha-sniffing-sim-note">
                    Demo data only. Physical Wi-Fi sniffing firmware is not yet deployed.
                  </p>
                </div>

                {/* Explain module role (Workstream 5 - Aman) */}
                <div className="disha-sniffing-banner">
                  <div className="disha-sniffing-banner__icon">
                    <Wifi size={18} />
                  </div>
                  <div>
                    <h4 className="disha-sniffing-banner__title">Passive Search Assistance (WS-5)</h4>
                    <p className="disha-sniffing-banner__desc">
                      ESP32 nodes sniff ambient 802.11 probe frames emitted by survivor phones under rubble to estimate search proximity via signal strength (RSSI).
                    </p>
                  </div>
                </div>

                <div className="disha-sniffing-action">
                  <Button
                    variant="outline"
                    size="sm"
                    icon={Sparkles}
                    onClick={handleSimulateSniff}
                    style={{ width: '100%' }}
                  >
                    Simulate Wi-Fi Sniff Probe (demo data)
                  </Button>
                </div>

                {sniffObservations.length === 0 ? (
                  <EmptyState
                    icon={Radio}
                    title="Sniffer listening"
                    description="Deployed nodes are scanning 2.4 GHz channels for survivor mobile probe beacons. Detected signal events will appear here."
                  />
                ) : (
                  <div className="disha-sniffing-list">
                    {sniffObservations.map((obs) => {
                      let rssiQuality = 'Moderate';
                      let rssiVariant = 'warning';
                      let approxDistance = '~30–50m';

                      if (obs.rssi >= -65) {
                        rssiQuality = 'Strong';
                        rssiVariant = 'success';
                        approxDistance = '~10–25m';
                      } else if (obs.rssi <= -82) {
                        rssiQuality = 'Weak';
                        rssiVariant = 'danger';
                        approxDistance = '~50–90m';
                      }

                      return (
                        <div key={obs.id} className="disha-sniffing-card">
                          <div className="disha-sniffing-card__top">
                            <div className="disha-sniffing-card__hash">
                              <Radio size={14} />
                              <span>{obs.deviceHash}</span>
                              {obs.sourceKind === 'hardware' ? (
                                <span className="disha-source-badge disha-source-badge--hw" title="Hardware ESP32 observation">
                                  HW
                                </span>
                              ) : (
                                <span className="disha-sim-tag" title="Simulated demo observation">
                                  SIM
                                </span>
                              )}
                            </div>
                            <Pill variant={rssiVariant} size="xs">
                              {obs.rssi} dBm · {rssiQuality}
                            </Pill>
                          </div>

                          <div className="disha-sniffing-card__middle">
                            <span className="disha-sniffing-card__observer">
                              Detected by <strong>{formatNodeLabel(obs.observerNode)}</strong>
                            </span>
                            <span className="disha-sniffing-card__distance">
                              Estimated Search Radius: <strong>{approxDistance}</strong>
                            </span>
                          </div>

                          <div className="disha-sniffing-card__footer">
                            <span className="disha-sniffing-card__time">
                              <Clock size={11} /> {formatTimeAgo(obs.timestamp)}
                            </span>
                            <Button
                              variant="ghost"
                              size="xs"
                              icon={Crosshair}
                              onClick={() => onSelectNode?.(obs.observerNode)}
                            >
                              Focus Detector
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>
      )}
    </aside>
  );
}
