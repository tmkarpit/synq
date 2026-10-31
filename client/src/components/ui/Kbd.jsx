import { cn } from '@/lib/cn';

export const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export const MOD_KEY = isMac ? '⌘' : 'Ctrl';

export default function Kbd({ children, className }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border border-ws-border bg-ws-widget px-1.5',
        'font-mono text-[11px] leading-none text-ws-muted',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
