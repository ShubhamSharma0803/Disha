import React from 'react';
import './Pill.css';

export default function Pill({
  label,
  children,
  variant = 'default', // 'default' | 'success' | 'danger' | 'warning' | 'accent' | 'primary' | 'glass'
  dot = false,
  dotColor,
  pulse = false,
  icon,
  size = 'md', // 'sm' | 'md'
  className = '',
  onClick,
  style = {},
}) {
  const content = children || label;

  const renderIcon = () => {
    if (!icon) return null;
    if (React.isValidElement(icon)) return icon;
    if (typeof icon === 'function' || (typeof icon === 'object' && icon !== null)) {
      const IconComponent = icon;
      return <IconComponent size={size === 'sm' ? 12 : 14} />;
    }
    return icon;
  };

  return (
    <span
      className={`ui-pill ui-pill--${variant} ui-pill--${size} ${onClick ? 'ui-pill--clickable' : ''} ${className}`}
      onClick={onClick}
      style={style}
    >
      {dot && (
        <span
          className={`ui-pill__dot ${pulse ? 'ui-pill__dot--pulse' : ''}`}
          style={dotColor ? { backgroundColor: dotColor, boxShadow: `0 0 6px ${dotColor}` } : {}}
        />
      )}
      {icon && <span className="ui-pill__icon">{renderIcon()}</span>}
      <span className="ui-pill__text">{content}</span>
    </span>
  );
}
