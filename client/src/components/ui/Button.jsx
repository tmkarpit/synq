import { forwardRef } from 'react';
import { cn } from '@/lib/cn';
import Spinner from './Spinner';

const VARIANTS = {
  primary:
    'bg-blue text-white hover:bg-[#2f74e6] shadow-[0_0_0_1px_rgba(255,255,255,0.08)_inset,0_8px_30px_-8px_rgba(59,130,246,0.6)]',
  white: 'bg-ink text-bg hover:bg-white',
  dark: 'bg-elevated text-ink border border-line hover:border-line-strong',
  outline: 'border border-line-strong text-ink hover:bg-white/[0.04] hover:border-white/30',
  ghost: 'text-muted hover:text-ink hover:bg-white/[0.04]',
  danger: 'bg-[#C93C3C] text-white hover:bg-[#B83232]',
  // Workspace chrome variants
  ws: 'bg-ws-accent text-white hover:brightness-110',
  'ws-ghost': 'text-ws-text hover:bg-ws-hover',
};

const SIZES = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-[15px] gap-2',
};

const Button = forwardRef(function Button(
  {
    as: Comp = 'button',
    variant = 'primary',
    size = 'md',
    pill = true,
    loading = false,
    disabled,
    className,
    children,
    type,
    ...props
  },
  ref,
) {
  const isButton = Comp === 'button';
  return (
    <Comp
      ref={ref}
      type={isButton ? type || 'button' : undefined}
      disabled={isButton ? disabled || loading : undefined}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap font-medium',
        'transition-[background-color,border-color,color,box-shadow,filter,transform] duration-micro ease-synq',
        'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
        pill ? 'rounded-full' : 'rounded-chrome',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading && <Spinner size={14} />}
      {children}
    </Comp>
  );
});

export default Button;
