import React from 'react';

interface ShiftLeaderIconProps {
  className?: string;
}

export default function ShiftLeaderIcon({ className = "w-4 h-4" }: ShiftLeaderIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`${className} inline-block align-text-bottom`}
      style={{ minWidth: '1em', minHeight: '1em' }}
    >
      {/* Head */}
      <circle cx="12" cy="5.5" r="4" fill="currentColor" />

      {/* Left Jacket (Viewer's Left, Character's Right) */}
      <path
        d="M 4 20 C 4 14.5 7 12 10.5 12 L 12 16 L 12 20 Z"
        fill="currentColor"
      />

      {/* Right Jacket (Viewer's Right, Character's Left) */}
      <path
        d="M 20 20 C 20 14.5 17 12 13.5 12 L 12 16 L 12 20 Z"
        fill="currentColor"
      />

      {/* Tie Knot */}
      <circle cx="12" cy="11.5" r="0.7" fill="currentColor" />

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
