import { motion } from 'framer-motion';
import { usePrefersReducedMotion } from '@/hooks/useMediaQuery';
import { EASE } from '@/lib/motion';
import { cn } from '@/lib/cn';

/**
 * Quick scanline wipe between routes. Only transform and opacity are animated.
 * On enter, a scanline shutter retracts upward; on exit, it drops back down.
 */
export default function PageTransition({ children, className }) {
  const reduced = usePrefersReducedMotion();

  if (reduced) {
    return (
      <motion.div
        className={cn('relative min-h-full', className)}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: 0.2 } }}
        exit={{ opacity: 0, transition: { duration: 0.15 } }}
      >
        {children}
      </motion.div>
    );
  }

  return (
    <motion.div
      className={cn('relative min-h-full', className)}
      initial={{ opacity: 0.6 }}
      animate={{ opacity: 1, transition: { duration: 0.3, ease: EASE } }}
      exit={{ opacity: 1, transition: { duration: 0.32 } }}
    >
      {children}
      <motion.div
        aria-hidden
        className="scanlines pointer-events-none fixed inset-0 z-[90] bg-bg"
        style={{ transformOrigin: 'top' }}
        initial={{ scaleY: 1 }}
        animate={{ scaleY: 0, transition: { duration: 0.42, ease: EASE, delay: 0.04 } }}
        exit={{
          scaleY: 1,
          transformOrigin: 'bottom',
          transition: { duration: 0.3, ease: EASE },
        }}
      >
        <span className="absolute inset-x-0 bottom-0 h-px bg-white/40" />
      </motion.div>
    </motion.div>
  );
}
