import GrainOverlay from '@/components/ui/GrainOverlay';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useSmoothScroll } from './useSmoothScroll';
import Nav from './sections/Nav';
import Hero from './sections/Hero';
import Marquee from './sections/Marquee';
import Statement from './sections/Statement';
import Features from './sections/Features';
import HowItWorks from './sections/HowItWorks';
import Languages from './sections/Languages';
import Stats from './sections/Stats';
import Faq from './sections/Faq';
import FinalCta from './sections/FinalCta';
import './landing.css';

// Animations: GSAP (ScrollTrigger, SplitText, ScrambleText, DrawSVG) + Lenis smooth
// scrolling. Every animation sits behind prefers-reduced-motion: no-preference, so
// reduced-motion users get the same content as a static page.
export default function LandingPage() {
  useDocumentTitle();
  useSmoothScroll();

  return (
    <div className="landing relative min-h-screen overflow-x-clip bg-bg text-ink">
      <GrainOverlay />
      <Nav />
      <main>
        <Hero />
        <Marquee />
        <Statement />
        <Features />
        <HowItWorks />
        <Languages />
        <Stats />
        <Faq />
      </main>
      <FinalCta />
    </div>
  );
}
