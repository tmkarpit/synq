import { useSyncExternalStore } from 'react';

/** Subscribe to a CSS media query. SSR-safe default of false. */
export function useMediaQuery(query) {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export function usePrefersReducedMotion() {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

export function useIsTouch() {
  return useMediaQuery('(hover: none), (pointer: coarse)');
}
