import React from 'react';

interface ShiftLeaderIconProps {
  className?: string;
  style?: React.CSSProperties;
}

export default function ShiftLeaderIcon({ className = "", style }: ShiftLeaderIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{
        display: 'inline-block',
        verticalAlign: 'middle',
        width: '11px',
        height: '11px',
        marginRight: '2px',
        flexShrink: 0,
        ...style
      }}
    >
      {/* Head */}
      <circle cx="12" cy="5.5" r="4.2" fill="currentColor" />

      {/* Left Jacket */}
      <path
        d="M 4 20 C 4 14.5 7 12 10.5 12 L 12 16 L 12 20 Z"
        fill="currentColor"
      />

      {/* Right Jacket */}
      <path
        d="M 20 20 C 20 14.5 17 12 13.5 12 L 12 16 L 12 20 Z"
        fill="currentColor"
      />

      {/* Tie Knot */}
      <circle cx="12" cy="11.5" r="0.8" fill="currentColor" />

      {/* Tie hanging */}
      <path
        d="M 11.5 12 L 12.5 12 L 12.8 15 L 12 17.5 L 11.2 15 Z"
        fill="currentColor"
      />

      {/* White Medical Cross on Viewer's Right */}
      <path
        d="M 15.5 15.5 H 17 V 14 H 18 V 15.5 H 19.5 V 16.5 H 18 V 18 H 17 V 16.5 H 15.5 Z"
        fill="white"
      />
    </svg>
  );
}
