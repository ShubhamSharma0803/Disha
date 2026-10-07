import React, { useState } from 'react';
import { Layers, ChevronDown, ChevronUp } from 'lucide-react';
import './Legend.css';

export default function Legend({
  nodeCount = 0,
  areaSqKm = 4,
  className = '',
}) {
  // Start collapsed on viewports under 1500px wide
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth < 1500;
    }
    return true;
  });

  if (collapsed) {
    return (
      <div className={`disha-legend-wrapper ${className}`}>
        <button
          type="button"
          className="disha-legend-pill-btn"
          onClick={() => setCollapsed(false)}
          title="Expand Map Legend"
          aria-label="Expand Map Legend"
        >
          <Layers size={15} />
          <span>Legend</span>
          <ChevronUp size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className={`disha-legend-wrapper ${className}`} aria-label="Map Legend">
      <div className="disha-legend-card">
        <div className="disha-legend-card__header">
          <div className="disha-legend-card__title-row">
            <Layers size={14} className="disha-legend-card__header-icon" />
            <span className="disha-legend-card__title">Map Legend</span>
          </div>
          <button
            type="button"
            className="disha-legend-card__close-btn"
            onClick={() => setCollapsed(true)}
            title="Minimize Legend"
            aria-label="Minimize Legend"
          >
            <ChevronDown size={15} />
          </button>
        </div>

        <div className="disha-legend-card__grid">
          <div className="disha-legend-item">
            <span className="disha-legend-dot disha-legend-dot--active" />
            <span className="disha-legend-label">Active Node</span>
          </div>

          <div className="disha-legend-item">
            <span className="disha-legend-dot disha-legend-dot--planned" />
            <span className="disha-legend-label">Planned Node</span>
          </div>

          <div className="disha-legend-item">
            <span className="disha-legend-dot disha-legend-dot--offline" />
            <span className="disha-legend-label">Offline Node</span>
          </div>

          <div className="disha-legend-item">
            <span className="disha-legend-dot disha-legend-dot--gateway" />
            <span className="disha-legend-label">Gateway Station</span>
          </div>

          <div className="disha-legend-item">
            <span className="disha-legend-line disha-legend-line--mesh" />
            <span className="disha-legend-label">Mesh Links</span>
          </div>

          <div className="disha-legend-item">
            <span className="disha-legend-line disha-legend-line--path" />
            <span className="disha-legend-label">Shortest Path</span>
          </div>

          <div className="disha-legend-item">
            <span className="disha-legend-ring disha-legend-ring--wifi" />
            <span className="disha-legend-label">Wi-Fi Range</span>
          </div>

          <div className="disha-legend-item">
            <span className="disha-legend-box disha-legend-box--zone" />
            <span className="disha-legend-label">Zone ({Number(areaSqKm).toFixed(1)} km²)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
