import React from 'react';
import { Layers, Compass, Focus, Plus, Minus } from 'lucide-react';
import './MapToolbar.css';

export default function MapToolbar({
  is3DMode = true,
  onToggle3D,
  onFocusArea,
  onResetNorth,
  onZoomIn,
  onZoomOut,
  className = '',
}) {
  return (
    <aside className={`disha-map-toolbar ${className}`} aria-label="Map Navigation Controls">
      {/* 3D / 2D Toggle as filled blue chip when active */}
      <button
        type="button"
        className={`disha-map-toolbar__chip ${is3DMode ? 'is-active' : ''}`}
        onClick={onToggle3D}
        title={is3DMode ? 'Current: 3D View (click to switch to 2D Top-Down)' : 'Current: 2D View (click to switch to 3D Perspective)'}
        aria-label="Toggle 3D View"
      >
        <Layers size={16} />
        <span className="disha-map-toolbar__chip-label">{is3DMode ? '3D View' : '2D Map'}</span>
      </button>

      <div className="disha-map-toolbar__divider" />

      {/* Focus Area Button */}
      <button
        type="button"
        className="disha-map-toolbar__btn"
        onClick={onFocusArea}
        title="Recenter camera on disaster boundary area"
        aria-label="Focus Area"
      >
        <Focus size={17} />
      </button>

      {/* Reset North Button */}
      <button
        type="button"
        className="disha-map-toolbar__btn"
        onClick={onResetNorth}
        title="Reset camera heading to True North"
        aria-label="Reset North"
      >
        <Compass size={17} />
      </button>

      <div className="disha-map-toolbar__divider" />

      {/* Zoom In Button */}
      <button
        type="button"
        className="disha-map-toolbar__btn"
        onClick={onZoomIn}
        title="Zoom In (+)"
        aria-label="Zoom In"
      >
        <Plus size={17} />
      </button>

      {/* Zoom Out Button */}
      <button
        type="button"
        className="disha-map-toolbar__btn"
        onClick={onZoomOut}
        title="Zoom Out (-)"
        aria-label="Zoom Out"
      >
        <Minus size={17} />
      </button>
    </aside>
  );
}
