import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import Card from '../ui/Card';
import SegmentedTabs from '../ui/SegmentedTabs';
import EmptyState from '../ui/EmptyState';
import Chip from '../ui/Chip';
import Pill from '../ui/Pill';
import { useSosStore, SOS_CATEGORIES, formatRouteText } from '../../state/sosStore';
import { formatNodeLabel } from '../../utils/nodeUtils';
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

export default function RightPanel({
  onSelectNode,
  className = '',
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState('sos');
  const [, setTick] = useState(0);

  const sosList = useSosStore();

  // Periodic tick every 3s to refresh relative timestamps
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 3000);
    return () => clearInterval(timer);
  }, []);

  const tabsWithBadges = RIGHT_TABS.map((tab) => {
    if (tab.id === 'sos') {
      return { ...tab, count: sosList.length > 0 ? sosList.length : undefined };
    }
    return tab;
  });

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

            {activeTab === 'failures' && (
              <EmptyState
                icon={AlertTriangle}
                title="All nodes operational"
                description="Failed and isolated nodes detected by the mesh watchdog will be catalogued here."
              />
            )}

            {activeTab === 'log' && (
              <EmptyState
                icon={FileText}
                title="Event log clean"
                description="Network topology changes, route optimizations, and packet deliveries are recorded in real-time."
              />
            )}

            {activeTab === 'sniffing' && (
              <EmptyState
                icon={Radio}
                title="No raw packets"
                description="Over-the-air LoRa frame sniffing and mesh link latency probes are currently idle."
              />
            )}
          </div>
        </Card>
      )}
    </aside>
  );
}
