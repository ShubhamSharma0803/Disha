import React, { useState, useEffect, useRef } from 'react';
import { GitFork, AlertOctagon, X } from 'lucide-react';
import { subscribe } from '../../state/meshEvents';
import { formatNodeLabel } from '../../utils/nodeUtils';
import './RerouteBanner.css';

export default function RerouteBanner() {
  const [banner, setBanner] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    // PACKET_REROUTED listener
    const unsubRerouted = subscribe('PACKET_REROUTED', (ev) => {
      const atNode = formatNodeLabel(ev.at_node || ev.source || 'Node');
      const newHop = formatNodeLabel(ev.new_next_hop || ev.next_hop || 'alternate');

      if (timerRef.current) clearTimeout(timerRef.current);

      setBanner({
        id: `reroute-${Date.now()}`,
        type: 'rerouted',
        icon: GitFork,
        title: 'Route Failover',
        message: `Route lost at ${atNode}. Rerouted via ${newHop}.`,
      });

      timerRef.current = setTimeout(() => {
        setBanner(null);
      }, 5000);
    });

    // PACKET_DROPPED listener
    const unsubDropped = subscribe('PACKET_DROPPED', (ev) => {
      const atNode = formatNodeLabel(ev.at_node || ev.source || 'Node');
      const reason = ev.reason ? ev.reason.toLowerCase().replace(/_/g, ' ') : 'no route';

      if (timerRef.current) clearTimeout(timerRef.current);

      setBanner({
        id: `drop-${Date.now()}`,
        type: 'dropped',
        icon: AlertOctagon,
        title: 'Packet Dropped',
        message: `Packet dropped at ${atNode}: ${reason}.`,
      });

      timerRef.current = setTimeout(() => {
        setBanner(null);
      }, 5000);
    });

    return () => {
      unsubRerouted();
      unsubDropped();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!banner) return null;

  const Icon = banner.icon;

  return (
    <div
      className={`disha-reroute-banner disha-reroute-banner--${banner.type}`}
      role="alert"
    >
      <div className="disha-reroute-banner__icon">
        <Icon size={16} />
      </div>
      <div className="disha-reroute-banner__body">
        <span className="disha-reroute-banner__title">{banner.title}</span>
        <span className="disha-reroute-banner__msg">{banner.message}</span>
      </div>
      <button
        type="button"
        className="disha-reroute-banner__close"
        onClick={() => {
          if (timerRef.current) clearTimeout(timerRef.current);
          setBanner(null);
        }}
        aria-label="Dismiss banner"
      >
        <X size={14} />
      </button>
    </div>
  );
}
