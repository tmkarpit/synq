import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

/** Square icon-only button. `label` is required and becomes aria-label + title. */
const IconButton = forwardRef(function IconButton(
  { label, active = false, size = 'md', className, children, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-chrome text-ws-muted',
        'transition-colors duration-micro ease-synq hover:bg-ws-hover hover:text-ws-text',
        'disabled:pointer-events-none disabled:opacity-40',
        active && 'bg-ws-hover text-ws-text',
        size === 'sm' ? 'h-6 w-6' : size === 'lg' ? 'h-10 w-10' : 'h-8 w-8',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

export default IconButton;
