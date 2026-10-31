import { APP } from '@/config/app';

/** Shown while a lazy route chunk downloads. Matches the dark shell to avoid a flash. */
export default function RouteFallback({ label = 'LOADING' }) {
  return (
    <div
      className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-bg"
      role="status"
      aria-live="polite"
    >
      <span className="font-display text-2xl font-semibold tracking-[-0.03em] text-ink">
        {APP.name}
      </span>
      <span className="relative block h-px w-40 overflow-hidden bg-white/10">
        <span className="absolute inset-y-0 left-0 w-1/2 animate-shimmer bg-gradient-to-r from-transparent via-white/70 to-transparent" />
      </span>
      <span className="hud">{label}</span>
    </div>
  );
}
