import { useRef } from 'react';
import { Download, Eye, MessageCircle } from 'lucide-react';
import { fileIconUrl } from '@/config/fileIcons';
import { gsap, useGSAP, MOTION_OK, PALETTE } from '../gsap';

const CARDS = [
  {
    title: 'Live cursors',
    text: "See where everyone is. Each person gets a colored caret and a name label that shows when they're typing.",
    color: PALETTE.cyan,
    art: 'cursors',
  },
  {
    title: 'One shared console',
    text: 'Press Run and the whole room sees the same output, compiler errors included. One run at a time, no surprises.',
    color: PALETTE.green,
    art: 'console',
  },
  {
    title: 'Six languages',
    text: 'JavaScript, TypeScript, Python, C, C++ and Java, with real compilers and stdin for your input.',
    color: PALETTE.yellow,
    art: 'langs',
  },
  {
    title: 'Follow a teammate',
    text: "Click someone's avatar and your editor follows their cursor, even across files. Scroll to take back control.",
    color: PALETTE.violet,
    art: 'follow',
  },
  {
    title: 'Chat in the room',
    text: 'Talk next to the code instead of in another app. Messages stay with the room.',
    color: PALETTE.pink,
    art: 'chat',
  },
  {
    title: 'Saved, then downloadable',
    text: 'Rooms are saved as you type. Come back to the same link tomorrow, or download the project as a zip.',
    color: PALETTE.orange,
    art: 'save',
  },
];

function Art({ kind }) {
  const box = 'relative flex h-44 items-center justify-center rounded-2xl bg-black/15';
  switch (kind) {
    case 'cursors':
      return (
        <div
          className={`${box} flex-col items-start gap-3 px-6 font-code text-[14px] text-black/80`}
        >
          <p data-pop>
            const room = join()
            <span className="relative ml-0.5 inline-block h-5 w-[2px] translate-y-1 bg-[#7C3AED]">
              <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-[#7C3AED] px-1.5 font-sans text-[10px] font-semibold text-white">
                ada
              </span>
            </span>
          </p>
          <p data-pop>
            room.run(
            <span className="relative ml-0.5 inline-block h-5 w-[2px] translate-y-1 bg-[#BE185D]">
              <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-[#BE185D] px-1.5 font-sans text-[10px] font-semibold text-white">
                bob typing...
              </span>
            </span>
          </p>
        </div>
      );
    case 'console':
      return (
        <div
          className={`${box} flex-col items-start justify-center gap-1 bg-black/80 px-6 font-code text-[13px]`}
        >
          <p data-pop className="text-[#F472B6]">
            ▶ ada ran main.py
          </p>
          <p data-pop className="text-white/90">
            fib: [0, 1, 1, 2, 3, 5, 8]
          </p>
          <p data-pop className="text-[#4ADE80]">
            ✔ exited with code 0
          </p>
        </div>
      );
    case 'langs':
      return (
        <div className={`${box} grid grid-cols-3 gap-3 p-5`}>
          {['index.js', 'app.ts', 'main.py', 'main.c', 'main.cpp', 'Main.java'].map((f) => (
            <span
              data-pop
              key={f}
              className="flex h-full items-center justify-center rounded-xl bg-black/20"
            >
              <img src={fileIconUrl(f)} alt="" width={30} height={30} />
            </span>
          ))}
        </div>
      );
    case 'follow':
      return (
        <div className={`${box} gap-4`}>
          <span
            data-pop
            className="flex h-16 w-16 items-center justify-center rounded-full bg-black/80 text-[20px] font-bold text-[#C4B5FD]"
          >
            AD
          </span>
          <span
            data-pop
            className="flex items-center gap-2 rounded-full bg-black/80 px-4 py-2 text-[14px] font-semibold text-white"
          >
            <Eye size={16} aria-hidden /> Following ada
          </span>
        </div>
      );
    case 'chat':
      return (
        <div className={`${box} flex-col items-stretch justify-center gap-2 px-6 text-[13px]`}>
          <p
            data-pop
            className="self-start rounded-2xl rounded-bl-sm bg-black/80 px-3 py-1.5 text-white"
          >
            line 12 has an off-by-one
          </p>
          <p
            data-pop
            className="self-end rounded-2xl rounded-br-sm bg-white/90 px-3 py-1.5 text-black"
          >
            fixing it now 👀
          </p>
          <MessageCircle data-pop size={22} className="self-center text-black/60" aria-hidden />
        </div>
      );
    default:
      return (
        <div className={`${box} gap-3`}>
          <span
            data-pop
            className="flex h-20 w-20 items-center justify-center rounded-3xl bg-black/80 text-white"
          >
            <Download size={32} aria-hidden />
          </span>
          <span
            data-pop
            className="rounded-full bg-black/80 px-3 py-1.5 font-mono text-[12px] text-white"
          >
            synq-7f3k-92ab.zip
          </span>
        </div>
      );
  }
}

/** Pinned section: the cards scroll sideways while the page scrolls down. */
export default function Features() {
  const ref = useRef(null);
  const trackRef = useRef(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const track = trackRef.current;
        const distance = () => track.scrollWidth - window.innerWidth + 48;
        const slide = gsap.to(track, {
          x: () => -distance(),
          ease: 'none',
          scrollTrigger: {
            trigger: ref.current,
            start: 'top top',
            end: () => `+=${distance()}`,
            pin: true,
            scrub: 1,
            invalidateOnRefresh: true,
          },
        });
        gsap.utils.toArray('[data-card]', track).forEach((card) => {
          // Cards already on screen before the slide starts would sit right at the pin
          // start, which a jump (e.g. the nav link) can skip, leaving the art invisible.
          // Pop those in as the section arrives instead.
          const visibleAtRest = card.getBoundingClientRect().left < window.innerWidth;
          gsap.from(card.querySelectorAll('[data-pop]'), {
            scale: 0.4,
            opacity: 0,
            stagger: 0.08,
            duration: 0.8,
            ease: 'back.out(2)',
            scrollTrigger: visibleAtRest
              ? { trigger: ref.current, start: 'top 60%' }
              : { trigger: card, containerAnimation: slide, start: 'left 85%' },
          });
          // Straighten by 40% of the viewport, or by wherever the card stops when the slide
          // ends (the last cards never reach 40%, and would stay tilted).
          const restLeft = () =>
            track.getBoundingClientRect().left -
            gsap.getProperty(track, 'x') +
            card.offsetLeft -
            track.offsetLeft;
          gsap.from(card, {
            rotate: 6,
            yPercent: 8,
            ease: 'none',
            scrollTrigger: {
              trigger: card,
              containerAnimation: slide,
              start: 'left right',
              end: () => `left ${Math.max(window.innerWidth * 0.4, restLeft() - distance() + 1)}px`,
              scrub: true,
            },
          });
        });
        gsap.to('[data-progress]', {
          scaleX: 1,
          ease: 'none',
          scrollTrigger: {
            trigger: ref.current,
            start: 'top top',
            end: () => `+=${distance()}`,
            scrub: true,
          },
        });
      });
    },
    { scope: ref },
  );

  return (
    <section
      id="features"
      ref={ref}
      className="relative flex min-h-screen flex-col justify-center overflow-hidden py-16"
    >
      <div className="mx-auto mb-12 flex w-[min(1180px,calc(100%-48px))] items-end justify-between gap-8">
        <h2 className="font-display text-[clamp(44px,5.4vw,84px)] font-semibold leading-[0.95] tracking-[-0.045em] text-ink">
          Everything a pair
          <br />
          programming session needs.
        </h2>
        <p className="max-w-[300px] pb-2 text-[15px] text-muted">
          Built for study groups, interviews, hackathons and teams who just want to code together.
        </p>
      </div>
      <div
        ref={trackRef}
        data-track
        className="flex w-max gap-6 pl-[max(24px,calc((100vw-1180px)/2))] pr-6"
      >
        {CARDS.map((c, i) => (
          <article
            key={c.title}
            data-card
            className="flex w-[400px] shrink-0 flex-col gap-6 rounded-[28px] p-7 text-[#0B0B0C]"
            style={{ background: c.color }}
          >
            <span className="font-mono text-[13px] font-semibold opacity-60">0{i + 1}</span>
            <Art kind={c.art} />
            <div>
              <h3 className="mb-2 font-display text-[28px] font-semibold leading-tight tracking-[-0.03em]">
                {c.title}
              </h3>
              <p className="text-[15px] leading-relaxed opacity-75">{c.text}</p>
            </div>
          </article>
        ))}
      </div>
      <div
        className="mx-auto mt-12 h-[3px] w-[min(1180px,calc(100%-48px))] overflow-hidden rounded-full bg-white/10"
        aria-hidden
      >
        <div
          data-progress
          className="h-full origin-left scale-x-0 rounded-full bg-ink motion-reduce:scale-x-100"
        />
      </div>
    </section>
  );
}
