// Motion system (section 6b). Shared by Framer Motion and GSAP code.

export const EASE = [0.22, 1, 0.36, 1];
export const EASE_CSS = 'cubic-bezier(0.22, 1, 0.36, 1)';
export const GSAP_EASE = 'expo.out'; // closest built-in curve to EASE

export const DURATION = Object.freeze({
  micro: 0.18,
  ui: 0.38,
  reveal: 0.85,
});

export const fadeUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: DURATION.ui, ease: EASE } },
  exit: { opacity: 0, y: 8, transition: { duration: DURATION.micro, ease: EASE } },
};

export const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: DURATION.ui, ease: EASE } },
  exit: { opacity: 0, transition: { duration: DURATION.micro, ease: EASE } },
};
