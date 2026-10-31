import { useRef } from 'react';
import { gsap, useGSAP, MOTION_OK, PALETTE } from '../gsap';

// Numbers that are true for SYNQ today (see the server and client limits).
const STATS = [
  { value: 6, suffix: '', label: 'languages you can run', color: PALETTE.yellow },
  { value: 20, suffix: '', label: 'collaborators per room', color: PALETTE.cyan },
  { value: 50, suffix: 'ms', prefix: '<', label: 'cursor update interval', color: PALETTE.pink },
  { value: 0, suffix: '', label: 'things to install', color: PALETTE.green },
];

export default function Stats() {
  const ref = useRef(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.utils.toArray('[data-count]').forEach((el) => {
          const target = Number(el.dataset.count);
          const obj = { v: target === 0 ? 99 : 0 };
          gsap.to(obj, {
            v: target,
            duration: 2,
            ease: 'power3.out',
            scrollTrigger: { trigger: el, start: 'top 85%' },
            onUpdate: () => (el.textContent = Math.round(obj.v)),
          });
        });
        gsap.from('[data-stat]', {
          y: 60,
          opacity: 0,
          stagger: 0.1,
          duration: 1.1,
          scrollTrigger: { trigger: ref.current, start: 'top 80%' },
        });
      });
    },
    { scope: ref },
  );

  return (
    <section
      ref={ref}
      aria-label="SYNQ in numbers"
      className="mx-auto grid w-[min(1180px,calc(100%-48px))] grid-cols-4 gap-4 pb-36"
    >
      {STATS.map((s) => (
        <div
          key={s.label}
          data-stat
          className="relative overflow-hidden rounded-[24px] border border-line bg-white/[0.02] p-7"
        >
          <span
            aria-hidden
            className="absolute -right-8 -top-8 h-28 w-28 rounded-full opacity-25 blur-2xl"
            style={{ background: s.color }}
          />
          <p
            className="font-display text-[64px] font-semibold leading-none tracking-[-0.05em]"
            style={{ color: s.color }}
          >
            {s.prefix}
            <span data-count={s.value}>{s.value}</span>
            <span className="text-[32px]">{s.suffix}</span>
          </p>
          <p className="mt-3 text-[15px] text-muted">{s.label}</p>
        </div>
      ))}
    </section>
  );
}
