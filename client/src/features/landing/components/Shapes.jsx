// Playful organic shapes (SVG) in the collaborator palette. Pure markup: the sections
// that use them animate them through their data-shape attribute.
import { PALETTE } from '../gsap';

export function Blob({ color = PALETTE.violet, size = 160, className, ...props }) {
  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      className={className}
      aria-hidden
      data-shape
      {...props}
    >
      <path
        fill={color}
        d="M43.6,-58.7C55.9,-50.9,64.3,-36.6,69.2,-21C74.1,-5.3,75.4,11.7,69.4,25.6C63.4,39.6,50.1,50.4,35.3,58.3C20.5,66.2,4.2,71.2,-12.9,70.5C-30.1,69.8,-48,63.4,-59.5,50.8C-71,38.2,-76,19.1,-74.4,1.6C-72.8,-15.9,-64.5,-31.7,-52.6,-39.7C-40.7,-47.7,-25.2,-47.8,-10.3,-53.9C4.5,-60,31.3,-66.5,43.6,-58.7Z"
        transform="translate(100 100)"
      />
    </svg>
  );
}

export function Ring({ color = PALETTE.cyan, size = 120, stroke = 22, className, ...props }) {
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={className}
      aria-hidden
      data-shape
      {...props}
    >
      <circle cx="60" cy="60" r={60 - stroke / 2} fill="none" stroke={color} strokeWidth={stroke} />
    </svg>
  );
}

/** A wavy "worm" stroke; data-draw lets DrawSVG animate it. */
export function Squiggle({ color = PALETTE.green, width = 260, className, ...props }) {
  return (
    <svg
      viewBox="0 0 260 80"
      width={width}
      height={(width / 260) * 80}
      className={className}
      aria-hidden
      data-shape
      {...props}
    >
      <path
        data-draw
        d="M10 50 C 40 10, 70 10, 90 40 S 140 75, 165 40 S 220 5, 250 35"
        fill="none"
        stroke={color}
        strokeWidth="18"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Star({ color = PALETTE.yellow, size = 90, className, ...props }) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      aria-hidden
      data-shape
      {...props}
    >
      <path
        fill={color}
        d="M50 0 C55 35 65 45 100 50 C65 55 55 65 50 100 C45 65 35 55 0 50 C35 45 45 35 50 0Z"
      />
    </svg>
  );
}

export function Pill({ color = PALETTE.orange, width = 150, className, ...props }) {
  return (
    <svg
      viewBox="0 0 150 60"
      width={width}
      height={(width / 150) * 60}
      className={className}
      aria-hidden
      data-shape
      {...props}
    >
      <rect x="0" y="0" width="150" height="60" rx="30" fill={color} />
    </svg>
  );
}

export function Cross({ color = PALETTE.pink, size = 70, className, ...props }) {
  return (
    <svg
      viewBox="0 0 70 70"
      width={size}
      height={size}
      className={className}
      aria-hidden
      data-shape
      {...props}
    >
      <path
        d="M12 12 L58 58 M58 12 L12 58"
        stroke={color}
        strokeWidth="16"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
