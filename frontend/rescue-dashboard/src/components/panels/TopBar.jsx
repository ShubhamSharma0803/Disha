import React from 'react';
import { Radio, RefreshCw, Usb } from 'lucide-react';
import SegmentedTabs from '../ui/SegmentedTabs';
import Pill from '../ui/Pill';
import Button from '../ui/Button';
import './TopBar.css';

const STEP_TABS = [
  { id: '1', label: '1 Planner' },
  { id: '2', label: '2 Mesh' },
  { id: '3', label: '3 SOS' },
  { id: '4', label: '4 Adaptive Routing' },
];

export default function TopBar({
  activeStep = '1',
  onStepChange,
  backendOnline = false,
  backendLoading = false,
  connectionState = 'reconnecting',
  onRefresh,
  gatewayStatus = null,
}) {
  const isLiveUSB = gatewayStatus && gatewayStatus.mode === 'live' && gatewayStatus.connected;
  const isMockBridge = gatewayStatus && gatewayStatus.mode === 'mock' && gatewayStatus.connected;

  return (
    <header className="disha-topbar">
      {/* Left: Brand Wordmark */}
      <div className="disha-topbar__brand">
        <div className="disha-topbar__logo-mark">
          <Radio size={18} strokeWidth={2.5} />
        </div>
        <div className="disha-topbar__wordmark-group">
          <span className="disha-topbar__wordmark">DISHA</span>
          <span className="disha-topbar__badge">RESCUE MESH</span>
        </div>
      </div>

      {/* Center: Workflow Step Pills on Solid #F3F4F6 Track */}
      <nav className="disha-topbar__steps" aria-label="Workflow Steps">
        <SegmentedTabs
          tabs={STEP_TABS}
          activeId={activeStep}
          onChange={onStepChange}
          variant="solid"
          size="md"
        />
      </nav>

      {/* Right: Gateway Status + Backend Status Pill & 40px Refresh Icon Button */}
      <div className="disha-topbar__actions">
        {/* Hardware Bridge Indicator */}
        {isLiveUSB && (
          <Pill variant="success" dot={true} pulse={true}>
            <Usb size={12} style={{ marginRight: 4 }} />
            LIVE USB
          </Pill>
        )}
        {isMockBridge && (
          <Pill variant="warning" dot={true}>
            MOCK BRIDGE
          </Pill>
        )}

        <Pill
          variant={
            backendLoading
              ? 'default'
              : connectionState === 'connected'
              ? 'success'
              : connectionState === 'reconnecting'
              ? 'warning'
              : backendOnline
              ? 'success'
              : 'danger'
          }
          dot={true}
          pulse={backendLoading || connectionState === 'reconnecting'}
        >
          {backendLoading
            ? 'Syncing backend…'
            : connectionState === 'connected'
            ? 'Backend online'
            : connectionState === 'reconnecting'
            ? 'Reconnecting…'
            : 'Offline — using local grid'}
        </Pill>

        <Button
          variant="icon"
          icon={RefreshCw}
          title={backendOnline ? 'Refresh deployment state' : 'Check backend status'}
          onClick={onRefresh}
          className="disha-topbar__refresh-btn"
        />
      </div>
    </header>
  );
}
