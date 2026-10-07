import React from 'react';
import './StatCard.css';

export default function StatCard({
  title,
  value,
  caption,
  icon,
  variant = 'default', // 'default' | 'white' | 'gradient' | 'accent'
  className = '',
  style = {},
}) {
  const renderIcon = () => {
    if (!icon) return null;
    if (React.isValidElement(icon)) return icon;
    if (typeof icon === 'function' || (typeof icon === 'object' && icon !== null)) {
      const IconComponent = icon;
      return <IconComponent size={18} />;
    }
    return icon;
  };

  return (
    <div className={`ui-stat-card ui-stat-card--${variant} ${className}`} style={style}>
      <div className="ui-stat-card__top">
        <span className="ui-stat-card__title">{title}</span>
        {icon && <div className="ui-stat-card__icon-wrap">{renderIcon()}</div>}
      </div>
      <div className="ui-stat-card__value">{value}</div>
      {caption && <div className="ui-stat-card__caption">{caption}</div>}
    </div>
  );
}
