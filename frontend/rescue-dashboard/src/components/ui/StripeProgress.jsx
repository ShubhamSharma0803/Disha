import React from 'react';
import './StripeProgress.css';

export default function StripeProgress({
  value = 0,
  max = 100,
  label,
  sublabel,
  showPercentage = true,
  className = '',
  animated = true,
}) {
  const safeMax = max > 0 ? max : 1;
  const percentage = Math.min(100, Math.max(0, Math.round((value / safeMax) * 100)));

  return (
    <div className={`disha-stripe-progress-wrapper ${className}`}>
      {(label || showPercentage) && (
        <div className="disha-stripe-progress__meta">
          <div className="disha-stripe-progress__label-group">
            {label && <span className="disha-stripe-progress__label">{label}</span>}
            {sublabel && <span className="disha-stripe-progress__sublabel">{sublabel}</span>}
          </div>
          {showPercentage && (
            <span className="disha-stripe-progress__value">
              {percentage}%
            </span>
          )}
        </div>
      )}

      <div className="disha-stripe-progress-track">
        <div
          className={`disha-stripe-progress-fill progress-stripe ${animated ? 'is-animated' : ''}`}
          style={{ width: `${percentage}%` }}
          role="progressbar"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={max}
        />
      </div>
    </div>
  );
}
