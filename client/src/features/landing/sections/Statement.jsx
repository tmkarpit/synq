import { useRef } from 'react';
import { gsap, useGSAP, SplitText, MOTION_OK, PALETTE } from '../gsap';
import { Blob } from '../components/Shapes';

/** A big sentence whose words light up one by one as you scroll through it. */
export default function Statement() {
  const ref = useRef(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const split = SplitText.create('[data-statement]', { type: 'words', aria: 'none' });
        gsap.fromTo(
          split.words,
          { opacity: 0.12 },
          {
            opacity: 1,
            stagger: 0.08,
            ease: 'none',
            scrollTrigger: {
              trigger: ref.current,
              start: 'top 75%',
              end: 'bottom 55%',
              scrub: true,
            },
          },
        );
        gsap.fromTo(
          '[data-statement-blob]',
          { rotate: -40, scale: 0.6 },
          {
            rotate: 80,
            scale: 1.1,
            ease: 'none',
            scrollTrigger: { trigger: ref.current, scrub: true },
          },
        );
        return () => split.revert();
      });
    },
    { scope: ref },
  );

  return (
    <section ref={ref} className="relative mx-auto max-w-[1180px] px-6 py-40">
      <div
        data-statement-blob
        aria-hidden
        className="pointer-events-none absolute -right-16 top-16 opacity-80"
      >
        <Blob color={PALETTE.orange} size={220} />
      </div>
      <p className="mb-8 font-mono text-[13px] uppercase tracking-[0.18em] text-muted">Why SYNQ</p>
      <p
        data-statement
        className="relative font-display text-[clamp(36px,4.6vw,68px)] font-semibold leading-[1.08] tracking-[-0.035em] text-ink"
      >
        One link puts everyone in the same file. You see each other&apos;s cursors as you type, and
        when anyone presses Run, the whole room sees the same output. No installs, no screen
        sharing, no &ldquo;can you send me that file?&rdquo;
      </p>
    </section>
  );
}
