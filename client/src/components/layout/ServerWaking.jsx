import { Loader2 } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { ENV } from '@/config/app';

/**
 * Shown while the SYNQ server does not answer yet. A free host puts the server to sleep
 * when nobody uses it, and the first visit wakes it (up to about a minute); the app keeps
 * retrying by itself (authStore.init) and this disappears when the server answers.
 */
export default function ServerWaking() {
  const waking = useAuthStore((s) => s.waking);
  if (!waking) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 top-4 z-[100] flex -translate-x-1/2 items-center gap-2.5 rounded-full border border-line bg-[#141418]/95 px-4 py-2 text-[13px] text-ink shadow-lg backdrop-blur"
    >
      <Loader2 size={15} className="animate-spin text-[#A78BFA]" aria-hidden />
      {ENV.isDev ? (
        <span>
          Can&apos;t reach the SYNQ server. Retrying… (start it with{' '}
          <code className="font-mono text-[12px]">npm run dev:server</code>)
        </span>
      ) : (
        <span>Waking up the server… this can take up to a minute. It reconnects by itself.</span>
      )}
    </div>
  );
}
