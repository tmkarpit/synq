import { cn } from '@/lib/cn';

/**
 * RGB-split glitch text built from two offset, clipped copies.
 * Pure CSS (transform only), disabled automatically by prefers-reduced-motion.
 */
export default function GlitchText({ text, className, as: Comp = 'span' }) {
  return (
    <Comp className={cn('relative inline-block', className)} aria-label={text}>
      <span aria-hidden>{text}</span>
      <span
        aria-hidden
        className="absolute inset-0 animate-glitch-x text-[#ff3b6b] mix-blend-screen"
        style={{ clipPath: 'inset(10% 0 55% 0)', animationDelay: '-0.2s' }}
      >
        {text}
      </span>
      <span
        aria-hidden
        className="absolute inset-0 animate-glitch-x text-[#22d3ee] mix-blend-screen"
        style={{ clipPath: 'inset(58% 0 8% 0)', animationDirection: 'reverse' }}
      >
        {text}
      </span>
    </Comp>
  );
}
