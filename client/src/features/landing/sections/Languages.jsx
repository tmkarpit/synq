import { useRef } from 'react';
import { fileIconUrl } from '@/config/fileIcons';
import { gsap, useGSAP, MOTION_OK } from '../gsap';

const LANGS = [
  { name: 'JavaScript', file: 'index.js', tool: 'Node, sandboxed' },
  { name: 'TypeScript', file: 'app.ts', tool: 'Node type stripping' },
  { name: 'Python', file: 'main.py', tool: 'Python 3' },
  { name: 'C', file: 'main.c', tool: 'gcc' },
  { name: 'C++', file: 'main.cpp', tool: 'g++ -std=c++17' },
  { name: 'Java', file: 'Main.java', tool: 'Java source launcher' },
];

const SESSION = [
  ['$ run main.py', '#8A8F98'],
  ['fib: [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]', '#E6E6E6'],
  ['✔ exited with code 0 in 96ms', '#4ADE80'],
  ['$ run Main.java', '#8A8F98'],
  ['Hello from Java in SYNQ', '#E6E6E6'],
  ['✔ exited with code 0 in 640ms', '#4ADE80'],
  ['$ run broken.cpp', '#8A8F98'],
  ["main.cpp:1: error: 'missing_name' was not declared", '#F14C4C'],
  ['✖ compilation failed (exit 1)', '#F14C4C'],
];

export default function Languages() {
  const ref = useRef(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        // fromTo, not from: a from() re-created while a card is still rotated (StrictMode,
        // HMR) would take -90deg as the end value and leave the card edge-on.
        gsap.fromTo(
          '[data-lang]',
          { rotateY: -90, opacity: 0 },
          {
            rotateY: 0,
            opacity: 1,
            transformOrigin: 'left center',
            stagger: 0.09,
            duration: 1.1,
            scrollTrigger: { trigger: '[data-lang-grid]', start: 'top 75%' },
          },
        );
        const lines = gsap.utils.toArray('[data-session] p');
        const texts = lines.map((l) => l.textContent);
        gsap.set(lines, { text: '' });
        const tl = gsap.timeline({
          scrollTrigger: { trigger: '[data-session]', start: 'top 75%' },
        });
        lines.forEach((l, i) => {
          const isCmd = texts[i].startsWith('$');
          tl.to(
            l,
            { text: texts[i], duration: isCmd ? texts[i].length * 0.04 : 0.01, ease: 'none' },
            isCmd ? '+=0.35' : '+=0.15',
          );
        });
        return () => lines.forEach((l, i) => (l.textContent = texts[i]));
      });
    },
    { scope: ref },
  );

  return (
    <section
      id="languages"
      ref={ref}
      className="mx-auto grid w-[min(1180px,calc(100%-48px))] grid-cols-[1.1fr_1fr] items-center gap-16 py-36"
    >
      <div>
        <p className="mb-4 font-mono text-[13px] uppercase tracking-[0.18em] text-muted">
          Languages
        </p>
        <h2 className="mb-6 font-display text-[clamp(44px,5vw,76px)] font-semibold leading-[0.95] tracking-[-0.045em] text-ink">
          Write it here. Run it here.
        </h2>
        <p className="mb-10 max-w-[480px] text-[17px] leading-relaxed text-muted">
          Real compilers and interpreters, not a toy. Read input with{' '}
          <code className="font-mono text-ink">stdin</code>, see compiler errors in the console, and
          stop runaway loops automatically after 5 seconds.
        </p>
        <div data-lang-grid className="grid grid-cols-3 gap-3 [perspective:900px]">
          {LANGS.map((l) => (
            // GSAP owns the outer transform; the CSS hover lift lives on the inner card so
            // a transform transition never fights the flip-in.
            <div key={l.name} data-lang className="h-full">
              <div className="group h-full rounded-2xl border border-line bg-white/[0.025] p-4 transition-[transform,border-color,background-color] duration-300 hover:-translate-y-1 hover:border-line-strong hover:bg-white/[0.05]">
                <img
                  src={fileIconUrl(l.file)}
                  alt=""
                  width={30}
                  height={30}
                  className="mb-3 transition-transform duration-300 group-hover:rotate-[-8deg] group-hover:scale-110"
                />
                <p className="font-display text-[18px] font-semibold text-ink">{l.name}</p>
                <p className="text-[12.5px] text-muted">{l.tool}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="overflow-hidden rounded-[22px] border border-white/10 bg-[#0D0E13] shadow-[0_40px_100px_-40px_rgba(124,92,255,0.6)]">
        <div className="flex h-11 items-center gap-2 border-b border-white/[0.06] px-4 text-[12px] text-muted">
          <span className="h-2 w-2 rounded-full bg-[#4ADE80]" aria-hidden /> Shared console · 3
          people watching
        </div>
        <div
          data-session
          className="min-h-[300px] space-y-1 p-5 font-code text-[13px] leading-[22px]"
        >
          {SESSION.map(([t, c], i) => (
            <p key={i} style={{ color: c }} className="min-h-[22px] whitespace-pre-wrap">
              {t}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}
