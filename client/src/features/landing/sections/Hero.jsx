import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Hash } from 'lucide-react';
import { gsap, useGSAP, SplitText, MOTION_OK, PALETTE } from '../gsap';
import Magnetic from '../components/Magnetic';
import { Blob, Cross, Pill, Ring, Squiggle, Star } from '../components/Shapes';
import EditorDemo from './EditorDemo';

const WORDS = ['sync.', 'real time.', 'one room.', 'any language.'];
const SCRAMBLE_CHARS = '{}<>/;=_#*01';

// Shapes around the headline: position + parallax depth (bigger = moves more).
const SHAPES = [
  { C: Blob, props: { color: PALETTE.violet, size: 190 }, pos: 'left-[4%] top-[18%]', depth: 0.8 },
  { C: Ring, props: { color: PALETTE.cyan, size: 120 }, pos: 'right-[7%] top-[16%]', depth: 1.2 },
  {
    C: Squiggle,
    props: { color: PALETTE.green, width: 230 },
    pos: 'left-[10%] bottom-[16%]',
    depth: 0.6,
  },
  {
    C: Star,
    props: { color: PALETTE.yellow, size: 84 },
    pos: 'right-[16%] bottom-[24%]',
    depth: 1.5,
  },
  {
    C: Pill,
    props: { color: PALETTE.orange, width: 130 },
    pos: 'right-[3%] top-[48%] rotate-[-24deg]',
    depth: 0.9,
  },
  { C: Cross, props: { color: PALETTE.pink, size: 60 }, pos: 'left-[22%] top-[9%]', depth: 1.8 },
];

export default function Hero() {
  const ref = useRef(null);
  const wordRef = useRef(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const split = SplitText.create('[data-split]', { type: 'chars' });
        const intro = gsap.timeline({ delay: 0.35 });
        intro
          .from(split.chars, { yPercent: 115, rotate: 10, duration: 1.2, stagger: 0.028 })
          .from(wordRef.current, { yPercent: 115, rotate: 6, duration: 1.2 }, '-=0.9')
          .from('[data-hero-fade]', { y: 26, opacity: 0, stagger: 0.08, duration: 1 }, '-=0.9')
          .from(
            '[data-shape-wrap]',
            {
              scale: 0,
              rotate: -120,
              opacity: 0,
              duration: 1.4,
              ease: 'elastic.out(1, 0.55)',
              stagger: 0.07,
            },
            0.2,
          );

        // Idle float, each shape on its own rhythm.
        gsap.utils.toArray('[data-shape-float]').forEach((el, i) => {
          gsap.to(el, {
            y: i % 2 ? 16 : -18,
            rotate: i % 2 ? 8 : -10,
            duration: 2.6 + i * 0.35,
            ease: 'sine.inOut',
            yoyo: true,
            repeat: -1,
          });
        });

        // Rotating last word, decoded like a terminal.
        let index = 0;
        let call = null;
        const cycle = () => {
          index = (index + 1) % WORDS.length;
          gsap.to(wordRef.current, {
            duration: 1.1,
            ease: 'none',
            scrambleText: {
              text: WORDS[index],
              chars: SCRAMBLE_CHARS,
              speed: 0.6,
              revealDelay: 0.25,
            },
          });
          call = gsap.delayedCall(3, cycle);
        };
        call = gsap.delayedCall(3.4, cycle);

        // Mouse parallax on the shapes.
        const movers = gsap.utils.toArray('[data-shape-wrap]').map((el) => ({
          depth: Number(el.dataset.depth),
          x: gsap.quickTo(el, 'x', { duration: 1.2, ease: 'power3.out' }),
          y: gsap.quickTo(el, 'y', { duration: 1.2, ease: 'power3.out' }),
        }));
        const onMove = (e) => {
          const nx = e.clientX / window.innerWidth - 0.5;
          const ny = e.clientY / window.innerHeight - 0.5;
          movers.forEach((m) => {
            m.x(nx * 60 * m.depth);
            m.y(ny * 60 * m.depth);
          });
        };
        window.addEventListener('pointermove', onMove);

        // Scrolling away: headline drifts and fades, shapes fly apart.
        gsap.to('[data-hero-copy]', {
          yPercent: -18,
          opacity: 0.2,
          ease: 'none',
          scrollTrigger: { trigger: ref.current, start: 'top top', end: 'bottom top', scrub: true },
        });
        gsap.utils.toArray('[data-shape-float]').forEach((el, i) => {
          gsap.to(el.parentElement.parentElement, {
            yPercent: -60 - i * 25,
            ease: 'none',
            scrollTrigger: {
              trigger: ref.current,
              start: 'top top',
              end: 'bottom top',
              scrub: true,
            },
          });
        });

        return () => {
          call.kill();
          window.removeEventListener('pointermove', onMove);
          split.revert();
        };
      });
    },
    { scope: ref },
  );

  return (
    <section ref={ref} className="relative overflow-hidden pt-40">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {SHAPES.map(({ C, props, pos, depth }, i) => (
          <div key={i} className={`absolute ${pos}`}>
            <div data-shape-wrap data-depth={depth}>
              <div data-shape-float>
                <C {...props} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div
        data-hero-copy
        className="relative z-10 mx-auto flex max-w-[1180px] flex-col items-center px-6 text-center"
      >
        <span
          data-hero-fade
          className="mb-8 inline-flex items-center gap-2 rounded-full border border-line bg-white/[0.03] px-4 py-1.5 text-[13px] text-muted backdrop-blur"
        >
          <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-[#4ADE80]" aria-hidden />
          Real-time rooms · run JS, Python, C, C++ & Java together
        </span>
        {/* The page heading is the plain sentence, for search engines and screen readers.
            The big animated title is decoration: its letters are split into spans. */}
        <h1 className="sr-only">Code together, in sync.</h1>
        <div aria-hidden className="hero-title font-display font-semibold text-ink">
          <span className="block overflow-hidden pb-[0.06em]">
            <span data-split className="inline-block">
              Code together,
            </span>
          </span>
          <span className="block overflow-hidden pb-[0.12em]">
            {/* margin, not a space: SplitText drops trailing whitespace */}
            <span data-split className="mr-[0.24em] inline-block">
              in
            </span>
            <span ref={wordRef} className="hero-word inline-block">
              {WORDS[0]}
            </span>
          </span>
        </div>
        <p data-hero-fade className="mt-8 max-w-[620px] text-[19px] leading-relaxed text-muted">
          Open a room, send the link, and write code with your team in the same file. Everyone sees
          every cursor, and when someone presses Run, everyone sees the output.
        </p>
        <div data-hero-fade className="mt-10 flex items-center gap-3">
          <Magnetic>
            <Link
              to="/join?mode=create"
              className="group flex h-14 items-center gap-2 rounded-full bg-[#7C5CFF] px-7 text-[16px] font-semibold text-white shadow-[0_18px_50px_-14px_rgba(124,92,255,0.9)] transition-colors hover:bg-[#8B6DFF]"
            >
              Start a room
              <ArrowRight
                size={18}
                className="transition-transform duration-300 group-hover:translate-x-1"
                aria-hidden
              />
            </Link>
          </Magnetic>
          <Link
            to="/join?mode=join"
            className="flex h-14 items-center gap-2 rounded-full border border-line-strong px-7 text-[16px] font-medium text-ink transition-colors hover:bg-white/[0.05]"
          >
            <Hash size={17} aria-hidden /> Join with an ID
          </Link>
        </div>
        <p data-hero-fade className="mt-5 text-[13px] text-faint">
          Free · Nothing to install · Works in your browser
        </p>
      </div>

      <EditorDemo />
    </section>
  );
}
