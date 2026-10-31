// One place that registers GSAP plugins for the landing page (lazy route chunk only).
// GSAP and all of its plugins are free under the GSAP "no charge" standard license.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin';
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin';
import { TextPlugin } from 'gsap/TextPlugin';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(
  ScrollTrigger,
  SplitText,
  ScrambleTextPlugin,
  DrawSVGPlugin,
  TextPlugin,
  useGSAP,
);
gsap.defaults({ ease: 'expo.out', duration: 1 });

/** Every animation is wrapped in this media query so reduced-motion users get a static page. */
export const MOTION_OK = '(prefers-reduced-motion: no-preference)';

/** Collaborator palette, reused as the landing page's shape colors. */
export const PALETTE = {
  violet: '#7C5CFF',
  cyan: '#22D3EE',
  orange: '#FB923C',
  green: '#4ADE80',
  pink: '#F472B6',
  yellow: '#FACC15',
};

export { gsap, ScrollTrigger, SplitText, useGSAP };
