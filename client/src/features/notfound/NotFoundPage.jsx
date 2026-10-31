import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import GlitchText from '@/components/ui/GlitchText';
import HudLabel from '@/components/ui/HudLabel';
import CornerBrackets from '@/components/ui/CornerBrackets';
import GrainOverlay from '@/components/ui/GrainOverlay';
import Button from '@/components/ui/Button';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { usePageMeta } from '@/hooks/usePageMeta';

export default function NotFoundPage() {
  const { pathname } = useLocation();
  useDocumentTitle('Page not found');
  usePageMeta({ noindex: true });

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-bg px-6">
      <GrainOverlay />
      <div aria-hidden className="scanlines absolute inset-0 opacity-60" />
      <div
        aria-hidden
        className="absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-line"
      />
      <div
        aria-hidden
        className="absolute left-1/2 top-1/2 h-[340px] w-[340px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-line"
      />

      <div className="relative flex flex-col items-center px-14 py-12 text-center">
        <CornerBrackets size={16} />
        <HudLabel accent className="mb-6">
          ERR / 404 / SIGNAL LOST
        </HudLabel>
        <h1 className="display text-[160px] leading-none text-ink">
          <GlitchText text="404" />
        </h1>
        <p className="mt-6 max-w-md text-muted">
          Nothing is synced at{' '}
          <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[13px] text-ink">
            {pathname}
          </code>
          . The room may have expired or the link is mistyped.
        </p>
        <div className="mt-8 flex gap-3">
          <Button as={Link} to="/" variant="white">
            <ArrowLeft size={16} aria-hidden /> Back home
          </Button>
          <Button as={Link} to="/join" variant="outline">
            Join a room
          </Button>
        </div>
      </div>
    </main>
  );
}
