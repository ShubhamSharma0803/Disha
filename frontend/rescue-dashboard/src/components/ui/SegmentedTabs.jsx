import React from 'react';
import './SegmentedTabs.css';

export default function SegmentedTabs({
  tabs = [], // [{ id: string, label: string, icon?: Component, count?: number }]
  activeId,
  onChange,
  size = 'md', // 'sm' | 'md'
  variant = 'solid', // 'solid' | 'glass'
  className = ''
}) {
  const currentActive = activeId !== undefined && activeId !== null ? String(activeId) : String(tabs[0]?.id || '1');

  return (
    <div className={`disha-segmented-tabs disha-segmented-tabs--${size} disha-segmented-tabs--${variant} ${className}`}>
      {tabs.map((tab) => {
        const isActive = String(tab.id) === currentActive;
        const Icon = tab.icon;

        const renderIcon = () => {
          if (!Icon) return null;
          if (React.isValidElement(Icon)) return Icon;
          if (typeof Icon === 'function' || (typeof Icon === 'object' && Icon !== null)) {
            const IconComp = Icon;
            return <IconComp size={size === 'sm' ? 14 : 16} className="disha-tab-btn__icon" />;
          }
          return Icon;
        };

        return (
          <button
            key={tab.id}
            type="button"
            className={`disha-tab-btn ${isActive ? 'is-active' : ''}`}
            onClick={() => onChange && onChange(tab.id)}
          >
            {renderIcon()}
            <span className="disha-tab-btn__label">{tab.label}</span>
            {tab.count !== undefined && (
              <span className={`disha-tab-btn__badge ${isActive ? 'is-active' : ''}`}>
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
