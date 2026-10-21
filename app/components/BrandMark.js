import React from 'react';

export default function BrandMark({ size = 36, className = '', style = {} }) {
  const fontSize = Math.round(size * 0.38);
  const radius = Math.max(6, Math.round(size * 0.22));

  return (
    <div
      className={`brand-mark ${className}`.trim()}
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        borderRadius: radius,
        backgroundColor: '#0B2A5B',
        color: '#FFFFFF',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: `${fontSize}px`,
        lineHeight: 1,
        letterSpacing: '0.04em',
        userSelect: 'none',
        boxSizing: 'border-box',
        ...style,
      }}
      aria-hidden="true"
    >
      NCC
    </div>
  );
}
export { BrandMark };
