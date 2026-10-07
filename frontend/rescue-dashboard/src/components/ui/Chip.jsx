import React from 'react';
import './Chip.css';

export default function Chip({
  children,
  active = false,
  variant = 'default', // 'default' | 'danger' | 'warning' | 'info' | 'gray'
  onClick,
  className = '',
  size = 'md', // 'sm' | 'md'
  icon: Icon,
  ...props
}) {
  const isClickable = !!onClick;
  const classNames = [
    'disha-chip',
    `disha-chip--${variant}`,
    `disha-chip--${size}`,
    active ? 'is-active' : '',
    isClickable ? 'is-clickable' : '',
    className
  ].filter(Boolean).join(' ');

  return (
    <button
      type="button"
      className={classNames}
      onClick={onClick}
      disabled={!isClickable}
      {...props}
    >
      {Icon && <Icon size={size === 'sm' ? 12 : 14} className="disha-chip__icon" />}
      <span className="disha-chip__label">{children}</span>
    </button>
  );
}
