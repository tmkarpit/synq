import { motion } from 'framer-motion';
import { useAuthStore } from '@/store/authStore';
import Button from '@/components/ui/Button';
import { EASE } from '@/lib/motion';

/**
 * Covers the page when another tab of this browser logged in as someone else. A browser
 * holds one login, so this tab can either continue as that account or log back in.
 */
export default function AccountSwitched() {
  const switchedTo = useAuthStore((s) => s.switchedTo);
  const user = useAuthStore((s) => s.user);
  if (!switchedTo) return null;

  const loginAgain = () => {
    useAuthStore.getState().clearSession();
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
  };

  return (
    <main
      aria-labelledby="switched-title"
      className="flex min-h-screen items-center justify-center bg-bg px-6"
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } }}
        className="glass w-full max-w-[440px] rounded-[16px] p-7 text-center"
      >
        <span className="hud">ACCOUNT CHANGED</span>
        <h2 id="switched-title" className="display mt-3 text-[30px] text-ink">
          You logged in as {switchedTo.name} in another tab.
        </h2>
        <p className="mt-3 text-sm text-muted">
          This browser can be logged in to one account at a time. To use two accounts at once, open
          the second one in a private window or another browser.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Button variant="white" onClick={() => window.location.reload()}>
            Continue as {switchedTo.name}
          </Button>
          {user && (
            <Button variant="outline" onClick={loginAgain}>
              Log in as {user.name} again
            </Button>
          )}
        </div>
      </motion.div>
    </main>
  );
}
