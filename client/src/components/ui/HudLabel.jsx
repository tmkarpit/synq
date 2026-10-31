import { cn } from '@/lib/cn';

/** Tiny uppercase monospace label, e.g. "01 / ROOM FLOW". */
export default function HudLabel({
  index,
  children,
  accent = false,
  className,
  as: Comp = 'span',
}) {
  return (
    <Comp className={cn('hud inline-flex items-center gap-2', className)}>
      {accent && <span aria-hidden className="h-1 w-1 rounded-full bg-warm" />}
      {index != null && <span className="text-faint">{String(index).padStart(2, '0')} /</span>}
      <span>{children}</span>
    </Comp>
  );
}
