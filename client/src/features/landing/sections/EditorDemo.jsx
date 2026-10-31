import { useRef } from 'react';
import { Play } from 'lucide-react';
import { fileIconUrl } from '@/config/fileIcons';
import { gsap, useGSAP, MOTION_OK, PALETTE } from '../gsap';

// A looping, scripted mini SYNQ room: two collaborators type, one presses Run, and the
// shared console prints the result. Colors follow the editor's Dark Modern tokens.

const C = {
  kw: '#569CD6',
  ctl: '#C586C0',
  fn: '#DCDCAA',
  str: '#CE9178',
  num: '#B5CEA8',
  var: '#9CDCFE',
  type: '#4EC9B0',
  com: '#6A9955',
  txt: '#D4D6DD',
};

const LINES = [
  [
    ['#include', C.ctl],
    [' <iostream>', C.str],
  ],
  [
    ['#include', C.ctl],
    [' <vector>', C.str],
  ],
  [],
  [
    ['int', C.kw],
    [' ', C.txt],
    ['main', C.fn],
    ['() {', C.txt],
  ],
  [
    ['    std', C.type],
    ['::', C.txt],
    ['vector', C.type],
    ['<', C.txt],
    ['int', C.kw],
    ['> ', C.txt],
    ['scores', C.var],
    ['{', C.txt],
    ['90', C.num],
    [', ', C.txt],
    ['72', C.num],
    [', ', C.txt],
    ['88', C.num],
    ['};', C.txt],
  ],
  { typing: 'ada', text: '    int total = 0;', color: C.txt },
  { typing: 'bob', text: '    for (int s : scores) total += s;', color: C.txt },
  [
    ['    std', C.type],
    ['::', C.txt],
    ['cout', C.var],
    [' << ', C.txt],
    ['"Average: "', C.str],
    [' << total / ', C.txt],
    ['3', C.num],
    [';', C.txt],
  ],
  [['}', C.txt]],
];

const OUTPUT = [
  { text: '▶ bob ran main.cpp', color: PALETTE.pink },
  { text: '$ g++ -std=c++17 -O2 main.cpp -o main', color: '#8A8F98' },
  { text: 'Average: 83', color: '#E6E6E6' },
  { text: '✔ exited with code 0 in 412ms', color: '#4ADE80' },
];

const PEOPLE = {
  ada: { color: PALETTE.cyan, text: '#06222A' },
  bob: { color: PALETTE.pink, text: '#2A0717' },
};

function Flag({ who }) {
  const p = PEOPLE[who];
  return (
    <span className="relative inline-block h-[1.35em] w-0 align-text-bottom" data-caret={who}>
      <span className="absolute left-0 top-0 h-full w-[2px]" style={{ background: p.color }} />
      <span
        data-flag={who}
        className="absolute left-2 top-1/2 flex -translate-y-1/2 items-center gap-1 whitespace-nowrap rounded-[5px] rounded-l-[1px] px-1.5 font-sans text-[10.5px] font-semibold leading-[16px]"
        style={{ background: p.color, color: p.text }}
      >
        {who}
        <span data-typing={who} className="font-medium opacity-80">
          typing...
        </span>
      </span>
    </span>
  );
}

export default function EditorDemo() {
  const ref = useRef(null);

  useGSAP(
    () => {
      const typeAda = ref.current.querySelector('[data-type="ada"]');
      const typeBob = ref.current.querySelector('[data-type="bob"]');
      const fullAda = typeAda.dataset.text;
      const fullBob = typeBob.dataset.text;

      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        typeAda.textContent = '';
        typeBob.textContent = '';
        const out = gsap.utils.toArray('[data-out]', ref.current);
        gsap.set(out, { opacity: 0, x: -10 });
        gsap.set('[data-typing]', { display: 'none' });

        const typing = (who, on) =>
          gsap.set(`[data-typing="${who}"]`, { display: on ? 'inline' : 'none' });
        const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.6, defaults: { ease: 'none' } });
        tl.add(() => typing('ada', true))
          .to(typeAda, { text: fullAda, duration: fullAda.length * 0.055 }, 0.6)
          .add(() => typing('ada', false))
          .add(() => typing('bob', true), '-=0.4')
          .to(typeBob, { text: fullBob, duration: fullBob.length * 0.05 }, '<')
          .add(() => typing('bob', false))
          .to(
            '[data-run]',
            { scale: 0.9, duration: 0.12, yoyo: true, repeat: 1, ease: 'power2.inOut' },
            '+=0.35',
          )
          .to(out, { opacity: 1, x: 0, duration: 0.4, stagger: 0.45, ease: 'power3.out' }, '+=0.1')
          .to({}, { duration: 2.4 })
          .to(out, { opacity: 0, duration: 0.3 })
          .to([typeAda, typeBob], { text: '', duration: 0.5 }, '<');

        // The window tilts upright as it scrolls into view.
        gsap.fromTo(
          '[data-demo-window]',
          { rotateX: 26, scale: 0.88, y: 60 },
          {
            rotateX: 0,
            scale: 1,
            y: 0,
            ease: 'none',
            scrollTrigger: { trigger: ref.current, start: 'top 95%', end: 'top 25%', scrub: true },
          },
        );
        return () => {
          typeAda.textContent = fullAda;
          typeBob.textContent = fullBob;
        };
      });
    },
    { scope: ref },
  );

  return (
    <div
      ref={ref}
      className="relative z-10 mx-auto mt-20 w-[min(1080px,calc(100%-48px))] pb-28 [perspective:1400px]"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-20 top-10 h-[70%] rounded-full bg-[radial-gradient(closest-side,rgba(124,92,255,0.35),transparent)] blur-3xl"
      />
      <figure
        data-demo-window
        className="relative overflow-hidden rounded-[22px] border border-white/10 bg-[#0D0E13] shadow-[0_60px_120px_-40px_rgba(0,0,0,0.9)] [transform-origin:50%_0%]"
        aria-label="Animated preview: two people editing main.cpp together and running it"
      >
        <div className="flex h-12 items-center gap-3 border-b border-white/[0.06] px-4">
          <span className="flex gap-1.5" aria-hidden>
            <i className="h-3 w-3 rounded-full bg-[#FF5F57]" />
            <i className="h-3 w-3 rounded-full bg-[#FEBC2E]" />
            <i className="h-3 w-3 rounded-full bg-[#28C840]" />
          </span>
          <span className="flex items-center gap-1.5 rounded-lg bg-white/[0.05] px-2.5 py-1 text-[12px] text-ink">
            <img src={fileIconUrl('main.cpp')} alt="" width={14} height={14} /> main.cpp
          </span>
          <span className="flex-1" />
          <span className="flex -space-x-1.5" aria-hidden>
            {Object.entries(PEOPLE).map(([name, p]) => (
              <span
                key={name}
                className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ring-2 ring-[#0D0E13]"
                style={{ background: p.color, color: p.text }}
              >
                {name.slice(0, 2).toUpperCase()}
              </span>
            ))}
          </span>
          <span
            data-run
            className="flex h-7 items-center gap-1.5 rounded-full bg-[#22C55E]/15 pl-1.5 pr-3 text-[12px] font-semibold text-[#6EE7A0]"
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#22C55E] text-[#06210F]">
              <Play size={9} strokeWidth={3} className="ml-px fill-current" aria-hidden />
            </span>
            Run
          </span>
        </div>

        <div className="grid grid-cols-[1fr_340px]">
          <pre className="m-0 overflow-hidden py-5 font-code text-[14px] leading-[26px]">
            {LINES.map((line, i) => (
              <div key={i} className="flex">
                <span className="w-12 shrink-0 select-none pr-4 text-right text-[#4D5161]">
                  {i + 1}
                </span>
                <span className="whitespace-pre">
                  {Array.isArray(line) ? (
                    line.map(([t, c], j) => (
                      <span key={j} style={{ color: c }}>
                        {t}
                      </span>
                    ))
                  ) : (
                    <>
                      <span
                        data-type={line.typing}
                        data-text={line.text}
                        style={{ color: line.color }}
                      >
                        {line.text}
                      </span>
                      <Flag who={line.typing} />
                    </>
                  )}
                </span>
              </div>
            ))}
          </pre>
          <div className="border-l border-white/[0.06] bg-black/30 p-5 font-code text-[12.5px] leading-[22px]">
            <p className="mb-3 font-sans text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">
              Shared console
            </p>
            {OUTPUT.map((o) => (
              <p key={o.text} data-out style={{ color: o.color }}>
                {o.text}
              </p>
            ))}
          </div>
        </div>
      </figure>
    </div>
  );
}
