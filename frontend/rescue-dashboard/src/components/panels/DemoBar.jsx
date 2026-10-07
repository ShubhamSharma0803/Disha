import React, { useState } from 'react';
import { ZapOff, RotateCcw, Send, CheckCircle2, Users } from 'lucide-react';
import { formatNodeLabel, normalizeNodeId } from '../../utils/nodeUtils';
import { sendSos } from '../../utils/backendApi';
import { SOS_CATEGORIES } from '../../state/sosStore';
import './DemoBar.css';

export default function DemoBar({
  nodes = [],
  isSimulating = false,
  backendOnline = false,
  onKillNode,
  onReviveAll,
  onResetSimulation,
  onSendSos,
  showToast,
  className = '',
}) {
  const [selectedKillNodeId, setSelectedKillNodeId] = useState('');
  const [selectedSosNodeId, setSelectedSosNodeId] = useState('');
  const [selectedSosCategory, setSelectedSosCategory] = useState('MED');
  const [peopleCount, setPeopleCount] = useState(1);
  const [isSendingSos, setIsSendingSos] = useState(false);

  // Active nodes excluding GATEWAY
  const activeNodes = nodes.filter(
    (n) => n.status === 'ACTIVE' && normalizeNodeId(n.id) !== 'GATEWAY'
  );
  const offlineNodes = nodes.filter((n) => n.status === 'OFFLINE');

  const isDeploying = isSimulating && nodes.some((n) => n.status === 'PLANNED');
  const simDisabled = !isSimulating;
  const simTooltip = simDisabled ? 'Start the simulation first' : undefined;

  const killDisabled = !isSimulating || isDeploying;
  const killTooltip = isDeploying
    ? 'Wait for deployment to finish'
    : simTooltip;

  const sosDisabled = !isSimulating || isDeploying || !selectedSosNodeId || isSendingSos || !backendOnline;
  const sosTooltip = !isSimulating
    ? 'Start the simulation first'
    : isDeploying
    ? 'Wait for deployment to finish'
    : !selectedSosNodeId
    ? 'Select an active node for SOS'
    : `Send ${selectedSosCategory} SOS from ${formatNodeLabel(selectedSosNodeId)} (${peopleCount} ${peopleCount === 1 ? 'person' : 'people'})`;

  const handleKillClick = () => {
    if (!selectedKillNodeId) return;
    onKillNode?.(selectedKillNodeId);
    setSelectedKillNodeId('');
  };

  const handleReviveAllClick = () => {
    onReviveAll?.();
  };

  const handleResetClick = () => {
    onResetSimulation?.();
    setSelectedKillNodeId('');
    setSelectedSosNodeId('');
  };

  const handleSendSosClick = async () => {
    if (sosDisabled || !selectedSosNodeId) return;
    setIsSendingSos(true);
    try {
      const payload = {
        source: selectedSosNodeId,
        code: selectedSosCategory,
        people: peopleCount,
        note: `${formatNodeLabel(selectedSosNodeId)} SOS (${selectedSosCategory})`.slice(0, 40),
        sourceKind: 'dashboard',
      };
      let res;
      if (onSendSos) {
        res = await onSendSos(payload);
      } else {
        res = await sendSos(payload);
      }
      if (!res) {
        showToast?.('Failed to send SOS: could not reach backend');
      }
    } catch (err) {
      showToast?.(`Failed to send SOS: ${err.message}`);
    } finally {
      setIsSendingSos(false);
    }
  };

  const currentCatMeta = SOS_CATEGORIES[selectedSosCategory] || SOS_CATEGORIES.MED;

  return (
    <div className={`disha-demobar ${className}`}>
      <div className="disha-demobar__pill">
        <span className="disha-demobar__badge">DEMO SIMULATOR</span>

        {/* SOS Controls */}
        <div className="disha-demobar__group">
          {/* Node Selector (ACTIVE nodes only, excluding gateway) */}
          <div className="disha-demobar__control">
            <label className="disha-demobar__label">Node</label>
            <select
              className="disha-demobar__select"
              disabled={!isSimulating || isDeploying}
              value={selectedSosNodeId}
              onChange={(e) => setSelectedSosNodeId(e.target.value)}
              title={isDeploying ? 'Wait for deployment to finish' : 'Select origin node for distress beacon'}
              aria-label="Select origin node for SOS"
            >
              <option value="">Select Node…</option>
              {activeNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {formatNodeLabel(n.id)}
                </option>
              ))}
            </select>
          </div>

          {/* Category Selector with colored dots */}
          <div className="disha-demobar__control">
            <span
              className="disha-demobar__cat-dot"
              style={{ backgroundColor: currentCatMeta.dotColor }}
              title={`Category: ${currentCatMeta.label}`}
            />
            <label className="disha-demobar__label">Category</label>
            <select
              className="disha-demobar__select disha-demobar__select--cat"
              disabled={!isSimulating || isDeploying}
              value={selectedSosCategory}
              onChange={(e) => setSelectedSosCategory(e.target.value)}
              aria-label="Select Category for SOS"
            >
              <option value="MED">● Medical</option>
              <option value="TRP">● Trapped</option>
              <option value="MIS">● Missing person</option>
              <option value="FWD">● Food/Water</option>
              <option value="SHL">● Shelter</option>
              <option value="SAF">● I'm safe</option>
            </select>
          </div>

          {/* Compact People Stepper (1-9) */}
          <div className="disha-demobar__control">
            <label className="disha-demobar__label">
              <Users size={12} style={{ display: 'inline', verticalAlign: '-1px' }} />
            </label>
            <div className="disha-demobar__stepper" title={`People count: ${peopleCount}`}>
              <button
                type="button"
                className="disha-demobar__stepper-btn"
                onClick={() => setPeopleCount((p) => Math.max(1, p - 1))}
                disabled={peopleCount <= 1 || !isSimulating || isDeploying}
                aria-label="Decrease people count"
              >
                −
              </button>
              <span className="disha-demobar__stepper-val">{peopleCount}</span>
              <button
                type="button"
                className="disha-demobar__stepper-btn"
                onClick={() => setPeopleCount((p) => Math.min(9, p + 1))}
                disabled={peopleCount >= 9 || !isSimulating || isDeploying}
                aria-label="Increase people count"
              >
                +
              </button>
            </div>
          </div>

          {/* Send SOS Button */}
          <button
            type="button"
            className="disha-demobar__btn disha-demobar__btn--sos"
            disabled={sosDisabled}
            title={sosTooltip}
            onClick={handleSendSosClick}
          >
            <Send size={13} />
            <span>{isSendingSos ? 'Sending…' : 'Send SOS'}</span>
          </button>
        </div>

        <div className="disha-demobar__divider" />

        {/* Fault Injection Controls (Kill / Revive / Reset) */}
        <div className="disha-demobar__group">
          <div className="disha-demobar__control" title={killTooltip}>
            <select
              className="disha-demobar__select"
              disabled={killDisabled}
              value={selectedKillNodeId}
              onChange={(e) => setSelectedKillNodeId(e.target.value)}
              title={killTooltip}
              aria-label="Select active node to kill"
            >
              <option value="">Kill node…</option>
              {activeNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {formatNodeLabel(n.id)}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            className="disha-demobar__btn disha-demobar__btn--kill"
            disabled={killDisabled || !selectedKillNodeId}
            title={killTooltip || (selectedKillNodeId ? `Kill ${formatNodeLabel(selectedKillNodeId)}` : 'Select an active node first')}
            onClick={handleKillClick}
          >
            <ZapOff size={13} />
            <span>Kill</span>
          </button>

          <button
            type="button"
            className="disha-demobar__btn disha-demobar__btn--revive"
            disabled={simDisabled || offlineNodes.length === 0}
            title={simTooltip || (offlineNodes.length === 0 ? 'No offline nodes to revive' : `Revive all ${offlineNodes.length} offline nodes`)}
            onClick={handleReviveAllClick}
          >
            <CheckCircle2 size={13} />
            <span>Revive all</span>
          </button>

          <button
            type="button"
            className="disha-demobar__btn disha-demobar__btn--reset"
            disabled={simDisabled}
            title={simTooltip || 'Reset mesh simulation and restore all deployed nodes'}
            onClick={handleResetClick}
          >
            <RotateCcw size={13} />
            <span>Reset</span>
          </button>
        </div>
      </div>
    </div>
  );
}
