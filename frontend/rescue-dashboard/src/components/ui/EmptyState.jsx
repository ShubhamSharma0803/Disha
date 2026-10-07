import React from 'react';
import './EmptyState.css';

export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className = '',
}) {
  const renderIcon = () => {
    if (!Icon) return null;
    if (React.isValidElement(Icon)) return Icon;
    if (typeof Icon === 'function' || (typeof Icon === 'object' && Icon !== null)) {
      const IconComponent = Icon;
      return <IconComponent size={24} className="disha-empty-state__icon" />;
    }
    return Icon;
  };

  return (
    <div className={`disha-empty-state ${className}`}>
      {Icon && (
        <div className="disha-empty-state__icon-wrapper">
          {renderIcon()}
        </div>
      )}
      {title && <h4 className="disha-empty-state__title">{title}</h4>}
      {description && <p className="disha-empty-state__description">{description}</p>}
      {action && <div className="disha-empty-state__action">{action}</div>}
    </div>
  );
}
