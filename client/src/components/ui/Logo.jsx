import { Link } from 'react-router-dom';
import { APP } from '@/config/app';
import { cn } from '@/lib/cn';

export function LogoMark({ size = 22, className }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      aria-hidden
      focusable="false"
    >
      <rect
        x="1"
        y="1"
        width="62"
        height="62"
        rx="14"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2"
      />
      <path
        d="M20 22h20a6 6 0 0 1 0 12H24a6 6 0 0 0 0 12h20"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <circle cx="46" cy="22" r="4" fill="var(--accent-warm)" />
    </svg>
  );
}

export default function Logo({ to = '/', className, showText = true }) {
  return (
    <Link
      to={to}
      aria-label={`${APP.name} home`}
      className={cn('inline-flex items-center gap-2.5 text-ink', className)}
    >
      <LogoMark />
      {showText && (
        <span className="font-display text-[17px] font-semibold tracking-[-0.02em]">
          {APP.name}
        </span>
      )}
    </Link>
  );
}
