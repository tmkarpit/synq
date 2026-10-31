import { useRef } from 'react';
import { Link2, Play, Plus } from 'lucide-react';
import { gsap, useGSAP, MOTION_OK, PALETTE } from '../gsap';

const STEPS = [
  {
    icon: Plus,
    color: PALETTE.violet,
    title: 'Start a room',
    text: 'Pick a name and you get a room with a ready-made project: JavaScript, Python, C, C++ and Java samples included.',
    detail: 'synq-7f3k-92ab',
  },
  {
    icon: Link2,
    color: PALETTE.cyan,
    title: 'Send the invite',
    text: 'One click copies a link. Whoever opens it picks a name and lands in your room, as an editor or a read-only viewer.',
    detail: 'http://192.168.1.5:5173/room/synq-7f3k-92ab',
  },
  {
    icon: Play,
    color: PALETTE.green,
    title: 'Code and run together',
    text: 'Edit the same files at the same time. Press Run and the whole room sees the compile, the output and the exit code.',
    detail: '✔ exited with code 0 in 412ms',
  },
];

export default function HowItWorks() {
  const ref = useRef(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.from('[data-draw-path]', {
          drawSVG: '0%',
          ease: 'none',
          scrollTrigger: {
            trigger: '[data-steps]',
            start: 'top 70%',
            end: 'bottom 60%',
            scrub: true,
          },
        });
        gsap.utils.toArray('[data-step]').forEach((step) => {
          const tl = gsap.timeline({ scrollTrigger: { trigger: step, start: 'top 72%' } });
          tl.from(step.querySelector('[data-step-dot]'), {
            scale: 0,
            rotate: -180,
            duration: 1,
            ease: 'elastic.out(1, 0.5)',
          })
            .from(
              step.querySelectorAll('[data-step-text]'),
              { x: 40, opacity: 0, stagger: 0.08, duration: 0.9 },
              '-=0.75',
            )
            .to(
              step.querySelector('[data-step-detail]'),
              {
                scrambleText: {
                  text: step.querySelector('[data-step-detail]').textContent,
                  chars: '01{}<>/#',
                  speed: 0.5,
                },
                duration: 1.1,
                ease: 'none',
              },
              '-=0.5',
            );
        });
      });
    },
    { scope: ref },
  );

  return (
    <section id="how" ref={ref} className="relative mx-auto w-[min(1180px,calc(100%-48px))] py-36">
      <p className="mb-4 font-mono text-[13px] uppercase tracking-[0.18em] text-muted">
        How it works
      </p>
      <h2 className="mb-20 max-w-[760px] font-display text-[clamp(44px,5.4vw,84px)] font-semibold leading-[0.95] tracking-[-0.045em] text-ink">
        From zero to coding together in three steps.
      </h2>
      <div data-steps className="relative">
        <svg
          aria-hidden
          className="absolute left-[38px] top-[40px] h-[calc(100%-80px)] w-[120px]"
          viewBox="0 0 120 600"
          preserveAspectRatio="none"
        >
          <path
            d="M2 0 C 2 120, 110 160, 60 300 S 2 480, 2 600"
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="3"
            vectorEffect="non-scaling-stroke"
          />
          <path
            data-draw-path
            d="M2 0 C 2 120, 110 160, 60 300 S 2 480, 2 600"
            fill="none"
            stroke="url(#how-gradient)"
            strokeWidth="4"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          <defs>
            <linearGradient id="how-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={PALETTE.violet} />
              <stop offset="0.5" stopColor={PALETTE.cyan} />
              <stop offset="1" stopColor={PALETTE.green} />
            </linearGradient>
          </defs>
        </svg>
        <ol className="relative space-y-24">
          {STEPS.map(({ icon: Icon, color, title, text, detail }, i) => (
            <li key={title} data-step className="flex items-start gap-10">
              <span
                data-step-dot
                className="relative flex h-20 w-20 shrink-0 items-center justify-center rounded-[26px] text-[#0B0B0C] shadow-[0_20px_50px_-20px_currentColor]"
                style={{ background: color, color }}
              >
                <Icon size={30} strokeWidth={2.4} className="text-[#0B0B0C]" aria-hidden />
                <span className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-ink font-mono text-[12px] font-bold text-bg">
                  {i + 1}
                </span>
              </span>
              <div className="pt-2">
                <h3
                  data-step-text
                  className="mb-3 font-display text-[36px] font-semibold tracking-[-0.03em] text-ink"
                >
                  {title}
                </h3>
                <p data-step-text className="max-w-[540px] text-[17px] leading-relaxed text-muted">
                  {text}
                </p>
                <code
                  data-step-detail
                  className="mt-5 inline-block rounded-full border border-line bg-white/[0.03] px-4 py-1.5 font-mono text-[13px] text-ink"
                >
                  {detail}
                </code>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
