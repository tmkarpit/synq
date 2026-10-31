import { useLocation } from 'react-router-dom';
import { Monitor, Copy, Check } from 'lucide-react';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useCopy } from '@/hooks/useCopy';
import { LIMITS, APP } from '@/config/app';
import { LogoMark } from '@/components/ui/Logo';
import HudLabel from '@/components/ui/HudLabel';
import CornerBrackets from '@/components/ui/CornerBrackets';
import GrainOverlay from '@/components/ui/GrainOverlay';

// The join form fits any width, so creating or joining a room is never blocked.
const ALWAYS_ALLOWED = ['/join'];

/** Below LIMITS.desktopMinWidth, show a polished "Best experienced on desktop" screen instead of the app. */
export default function DesktopOnlyGate({ children }) {
  const { pathname } = useLocation();
  const isDesktop = useMediaQuery(`(min-width: ${LIMITS.desktopMinWidth}px)`);
  const [copied, copy] = useCopy();

  if (isDesktop || ALWAYS_ALLOWED.includes(pathname)) return children;

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-bg px-6 text-center">
      <GrainOverlay />
      <div
        aria-hidden
        className="halftone absolute inset-x-0 top-0 h-1/2 opacity-40 [mask-image:linear-gradient(to_bottom,black,transparent)]"
      />
      <div className="relative w-full max-w-sm px-8 py-10">
        <CornerBrackets size={14} />
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-card border border-line bg-surface text-ink">
          <Monitor size={24} aria-hidden />
        </div>
        <HudLabel accent className="mb-4 justify-center">
          VIEWPORT / &lt; {LIMITS.desktopMinWidth}PX
        </HudLabel>
        <h1 className="display mb-3 text-4xl text-ink">
          Best experienced on <span className="text-gradient">desktop.</span>
        </h1>
        <p className="mb-8 text-sm leading-relaxed text-muted">
          {APP.name} is a full code editor with panels, a terminal and live cursors. Open this link
          on a screen at least {LIMITS.desktopMinWidth}px wide.
        </p>
        <button
          type="button"
          onClick={() => copy(window.location.href)}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-ink text-sm font-medium text-bg"
        >
          {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
          {copied ? 'Link copied' : 'Copy link for later'}
        </button>
      </div>
      <div className="absolute bottom-6 flex items-center gap-2 text-muted">
        <LogoMark size={16} />
        <span className="hud">{APP.tagline}</span>
      </div>
    </main>
  );
}
