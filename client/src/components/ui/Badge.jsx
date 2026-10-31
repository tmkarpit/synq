import { cn } from '@/lib/cn';

/** Pill badge used on the landing ("Real-time rooms. Zero setup.") and in chrome. */
export default function Badge({
  children,
  dot,
  dotColor = 'var(--accent-warm)',
  className,
  ...props
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-line bg-white/[0.03] px-3 py-1',
        'text-[12px] font-medium text-muted backdrop-blur',
        className,
      )}
      {...props}
    >
      {dot && (
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full animate-pulse-dot"
          style={{ background: dotColor, boxShadow: `0 0 10px ${dotColor}` }}
        />
      )}
      {children}
    </span>
  );
}
