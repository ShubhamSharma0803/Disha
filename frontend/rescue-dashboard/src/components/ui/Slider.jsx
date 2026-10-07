import React from 'react';
import './Slider.css';

export default function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange,
  presets = [], // [{ label: string, value: number }]
  className = '',
  disabled = false,
}) {
  const percentage = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));

  return (
    <div className={`disha-slider ${className}`}>
      <div className="disha-slider__header">
        {label && <span className="disha-slider__label">{label}</span>}
        <span className="disha-slider__value-pill">
          {value}
          {unit && <span className="disha-slider__unit">{unit}</span>}
        </span>
      </div>

      <div className="disha-slider__track-wrapper">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="disha-slider__input"
          style={{
            '--slider-fill-percent': `${percentage}%`,
          }}
        />
      </div>

      {presets && presets.length > 0 && (
        <div className="disha-slider__presets">
          {presets.map((preset) => {
            const isSelected = value === preset.value;
            return (
              <button
                key={preset.value}
                type="button"
                className={`disha-slider__preset-chip ${isSelected ? 'is-active' : ''}`}
                onClick={() => onChange(preset.value)}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
