import React from 'react';
import './Card.css';

export default function Card({
  title,
  subtitle,
  icon,
  badge,
  action,
  children,
  className = '',
  variant = 'default', // 'default' | 'glass' | 'dark'
  style = {},
  noPadding = false,
  padding,
}) {
  const renderIcon = () => {
    if (!icon) return null;
    if (React.isValidElement(icon)) return icon;
    if (typeof icon === 'function' || (typeof icon === 'object' && icon !== null)) {
      const IconComponent = icon;
      return <IconComponent size={16} />;
    }
    return icon;
  };

  const paddingClass = padding ? `ui-card--padding-${padding}` : noPadding ? 'ui-card--no-padding' : '';

  return (
    <div className={`ui-card ui-card--${variant} ${paddingClass} ${className}`} style={style}>
      {(title || icon || action) && (
        <div className="ui-card__header">
          <div className="ui-card__title-group">
            {icon && <span className="ui-card__icon">{renderIcon()}</span>}
            <div>
              {title && <h3 className="ui-card__title">{title}</h3>}
              {subtitle && <p className="ui-card__subtitle">{subtitle}</p>}
            </div>
            {badge && <div className="ui-card__badge">{badge}</div>}
          </div>
          {action && <div className="ui-card__action">{action}</div>}
        </div>
      )}
      <div className="ui-card__content">{children}</div>
    </div>
  );
}
