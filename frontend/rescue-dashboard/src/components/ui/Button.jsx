import React from 'react';
import './Button.css';

export default function Button({
  children,
  variant = 'primary', // 'primary' | 'secondary' | 'dark' | 'icon' | 'glass'
  size = 'md', // 'sm' | 'md' | 'lg'
  icon: Icon,
  iconPosition = 'left',
  disabled = false,
  className = '',
  onClick,
  type = 'button',
  title,
  ...props
}) {
  const classNames = [
    'disha-btn',
    `disha-btn--${variant}`,
    `disha-btn--${size}`,
    disabled ? 'is-disabled' : '',
    className
  ].filter(Boolean).join(' ');

  return (
    <button
      type={type}
      className={classNames}
      disabled={disabled}
      onClick={onClick}
      title={title}
      {...props}
    >
      {Icon && iconPosition === 'left' && (
        <span className="disha-btn__icon">
          <Icon size={size === 'sm' ? 14 : size === 'lg' ? 18 : 16} />
        </span>
      )}
      {children && <span className="disha-btn__label">{children}</span>}
      {Icon && iconPosition === 'right' && (
        <span className="disha-btn__icon">
          <Icon size={size === 'sm' ? 14 : size === 'lg' ? 18 : 16} />
        </span>
      )}
    </button>
  );
}
