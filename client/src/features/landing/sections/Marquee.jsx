import { useRef } from 'react';
import { gsap, useGSAP, ScrollTrigger, MOTION_OK, PALETTE } from '../gsap';
import { Star } from '../components/Shapes';

const ROW_A = [
  'Live cursors',
  'Shared terminal',
  'One invite link',
  'Follow mode',
  'Room chat',
  'Saved forever',
];
const ROW_B = ['JavaScript', 'TypeScript', 'Python', 'C', 'C++', 'Java'];
const STAR_COLORS = Object.values(PALETTE);

function Row({ items, reverse, big }) {
  // Content is doubled so a -50% shift loops seamlessly.
  const all = [...items, ...items];
  return (
    <div className="flex overflow-hidden" aria-hidden>
      <div
        data-marquee
        data-reverse={reverse ? '1' : '0'}
        className="flex shrink-0 items-center gap-10 pr-10 will-change-transform"
      >
        {all.map((t, i) => (
          <span key={i} className="flex shrink-0 items-center gap-10">
            <span
              className={
                big
                  ? 'font-display text-[clamp(48px,6vw,88px)] font-semibold tracking-[-0.04em] text-ink'
                  : 'text-outline font-display text-[clamp(48px,6vw,88px)] font-semibold tracking-[-0.04em]'
              }
            >
              {t}
            </span>
            <Star size={40} color={STAR_COLORS[i % STAR_COLORS.length]} />
          </span>
        ))}
      </div>
    </div>
  );
}

/** Two marquee rows; scrolling speeds them up and flips their direction. */
export default function Marquee() {
  const ref = useRef(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const tweens = gsap.utils
          .toArray('[data-marquee]')
          .map((el) =>
            gsap.fromTo(
              el,
              { xPercent: el.dataset.reverse === '1' ? -50 : 0 },
              {
                xPercent: el.dataset.reverse === '1' ? 0 : -50,
                duration: 28,
                ease: 'none',
                repeat: -1,
              },
            ),
          );
        let direction = 1;
        ScrollTrigger.create({
          trigger: ref.current,
          start: 'top bottom',
          end: 'bottom top',
          onUpdate: (self) => {
            direction = self.direction;
            const boost = 1 + Math.min(Math.abs(self.getVelocity()) / 220, 6);
            tweens.forEach((t) => {
              gsap.to(t, { timeScale: boost * direction, duration: 0.2, overwrite: true });
              gsap.to(t, { timeScale: direction, duration: 1.2, delay: 0.2, overwrite: false });
            });
          },
        });
        gsap.utils
          .toArray('[data-shape]', ref.current)
          .forEach((s) => gsap.to(s, { rotate: 360, duration: 6, ease: 'none', repeat: -1 }));
      });
    },
    { scope: ref },
  );

  return (
    <section
      ref={ref}
      aria-label="What SYNQ does"
      className="relative -rotate-2 space-y-6 border-y border-line bg-[#0A0A0D] py-10"
    >
      <p className="sr-only">
        Live cursors, a shared terminal, one invite link, follow mode, room chat and saved rooms,
        for JavaScript, TypeScript, Python, C, C++ and Java.
      </p>
      <Row items={ROW_A} big />
      <Row items={ROW_B} reverse />
    </section>
  );
}
