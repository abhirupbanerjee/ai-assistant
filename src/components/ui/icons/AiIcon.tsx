'use client';

import { useId } from 'react';

interface AiIconProps {
  size?: number;
  className?: string;
}

/**
 * Custom AI Bot icon rendered as an inline SVG React component.
 * Compatible with the same prop API as Lucide icons (size, className).
 *
 * The icon uses fixed brand gradient colors (blue → teal) and a drop-shadow
 * filter, so it does NOT respond to `currentColor`. For color-customizable
 * icons, use the existing Lucide-based BRANDING_ICONS.
 */
export default function AiIcon({ size = 24, className }: AiIconProps) {
  // Unique IDs per instance to avoid SVG gradient/filter collisions
  const id = useId();
  const bgGradientId = `bgGradient-${id}`;
  const faceGradientId = `faceGradient-${id}`;
  const shadowId = `shadow-${id}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={bgGradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#2563eb" />
          <stop offset="100%" stopColor="#0d9488" />
        </linearGradient>
        <linearGradient id={faceGradientId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#f1f5f9" />
        </linearGradient>
        <filter id={shadowId} x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000000" floodOpacity="0.15" />
        </filter>
      </defs>

      {/* Background rounded square */}
      <rect x="16" y="16" width="480" height="480" rx="96" fill={`url(#${bgGradientId})`} />

      {/* Antenna stem */}
      <line x1="256" y1="88" x2="256" y2="128" stroke="#ffffff" strokeWidth="6" strokeLinecap="round" />
      {/* Antenna tip */}
      <circle cx="256" cy="78" r="12" fill="#ffffff" />

      {/* Bot head */}
      <rect
        x="128" y="128" width="256" height="224" rx="48"
        fill={`url(#${faceGradientId})`}
        filter={`url(#${shadowId})`}
      />

      {/* Side ears */}
      <rect x="100" y="208" width="28" height="72" rx="14" fill="#ffffff" opacity="0.85" />
      <rect x="384" y="208" width="28" height="72" rx="14" fill="#ffffff" opacity="0.85" />

      {/* Left eye */}
      <circle cx="200" cy="216" r="28" fill="#2563eb" />
      <circle cx="208" cy="208" r="8" fill="#ffffff" />

      {/* Right eye */}
      <circle cx="312" cy="216" r="28" fill="#0d9488" />
      <circle cx="320" cy="208" r="8" fill="#ffffff" />

      {/* Smile */}
      <path
        d="M 200 276 Q 256 316 312 276"
        stroke="#2563eb"
        strokeWidth="10"
        fill="none"
        strokeLinecap="round"
      />

      {/* Chin indicator bar */}
      <rect x="184" y="376" width="144" height="36" rx="18" fill="#ffffff" opacity="0.9" />
      <circle cx="216" cy="394" r="6" fill="#2563eb" />
      <circle cx="256" cy="394" r="6" fill="#0d9488" />
      <circle cx="296" cy="394" r="6" fill="#2563eb" />
    </svg>
  );
}
