import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Github, Linkedin } from 'lucide-react';
import { APP } from '@/config/app';
import { LogoMark } from '@/components/ui/Logo';
import { gsap, useGSAP, SplitText, MOTION_OK, PALETTE } from '../gsap';
import Magnetic from '../components/Magnetic';
import { Blob, Ring, Squiggle, Star } from '../components/Shapes';

/** Closing call to action plus footer with a giant wordmark. */
const SOCIAL = [
  { href: APP.author.github, label: 'GitHub', Icon: Github },
  { href: APP.author.linkedin, label: 'LinkedIn', Icon: Linkedin },
].filter((link) => link.href);

export default function FinalCta() {
  const ref = useRef(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        // No mask here: it would clip descenders ("g").
        const split = SplitText.create('[data-cta-title]', { type: 'chars,words' });
        const tl = gsap.timeline({ scrollTrigger: { trigger: '[data-cta]', start: 'top 70%' } });
        tl.from(split.chars, { yPercent: 80, opacity: 0, rotate: 8, stagger: 0.02, duration: 1.1 })
          .from(
            '[data-cta] [data-shape]',
            { scale: 0, rotate: 90, stagger: 0.1, duration: 1.4, ease: 'elastic.out(1, 0.5)' },
            0.1,
          )
          .from(
            '[data-cta] [data-draw]',
            { drawSVG: '0%', duration: 1.6, ease: 'power2.inOut' },
            0.3,
          )
          .from('[data-cta-fade]', { y: 30, opacity: 0, stagger: 0.1 }, 0.5);

        gsap.from('[data-wordmark] span', {
          yPercent: 100,
          stagger: 0.06,
          ease: 'none',
          scrollTrigger: {
            trigger: '[data-wordmark]',
            start: 'top bottom',
            end: 'bottom bottom',
            scrub: true,
          },
        });
        return () => split.revert();
      });
    },
    { scope: ref },
  );

  return (
    <div ref={ref}>
      <section
        data-cta
        className="relative mx-auto mb-24 w-[min(1180px,calc(100%-48px))] overflow-hidden rounded-[40px] bg-[#7C5CFF] px-16 py-28 text-center"
      >
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <Blob color={PALETTE.pink} size={240} className="absolute -left-16 -top-16" />
          <Ring color={PALETTE.yellow} size={150} className="absolute -bottom-10 left-[18%]" />
          <Star color={PALETTE.green} size={110} className="absolute right-[8%] top-[14%]" />
          <Squiggle color={PALETTE.cyan} width={300} className="absolute -right-10 bottom-10" />
        </div>
        <h2
          data-cta-title
          className="relative font-display text-[clamp(56px,8vw,128px)] font-semibold leading-[0.92] tracking-[-0.05em] text-white"
        >
          Your room is waiting.
        </h2>
        <p data-cta-fade className="relative mx-auto mt-6 max-w-[520px] text-[19px] text-white/80">
          Start one in seconds, send the link, and write your next program together.
        </p>
        <div data-cta-fade className="relative mt-10 flex justify-center">
          <Magnetic strength={0.5}>
            <Link
              to="/join?mode=create"
              className="group flex h-16 items-center gap-3 rounded-full bg-[#0B0B0C] px-9 text-[18px] font-semibold text-white shadow-[0_20px_60px_-15px_rgba(0,0,0,0.7)]"
            >
              Start a room
              <ArrowRight
                size={20}
                className="transition-transform duration-300 group-hover:translate-x-1"
                aria-hidden
              />
            </Link>
          </Magnetic>
        </div>
      </section>

      <footer className="mx-auto w-[min(1180px,calc(100%-48px))] pb-10">
        <div className="flex items-start justify-between border-t border-line py-8 text-[16px] text-muted">
          <span className="flex items-center gap-2 text-ink">
            <LogoMark size={18} /> {APP.name}
            <span className="text-muted">· {APP.tagline}</span>
          </span>
          <nav aria-label="Footer" className="flex items-start gap-8">
            <a href="#features" className="hover:text-ink">
              Features
            </a>
            {/* The GitHub and LinkedIn logos sit centred under "How it works". */}
            <div className="flex flex-col items-center gap-3">
              <a href="#how" className="hover:text-ink">
                How it works
              </a>
              <div className="flex items-center gap-3">
                {SOCIAL.map(({ href, label, Icon }) => (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${APP.author.name} on ${label}`}
                    title={`${APP.author.name} on ${label}`}
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-white/[0.03] text-muted transition-colors hover:border-[#7C5CFF]/60 hover:bg-[#7C5CFF]/10 hover:text-ink"
                  >
                    <Icon size={18} aria-hidden />
                  </a>
                ))}
              </div>
            </div>
            <a href="#faq" className="hover:text-ink">
              FAQ
            </a>
          </nav>
        </div>
        <div className="flex flex-col items-center gap-2 pb-10 pt-4 text-center">
          <span className="hud text-[11px]">Created by</span>
          <a
            href={APP.author.github}
            target="_blank"
            rel="noopener noreferrer author"
            className="creator-name font-display text-[32px] font-semibold leading-tight tracking-[-0.03em]"
          >
            {APP.author.name}
          </a>
          <p className="mt-2 text-[13px] text-muted">
            {APP.license} licensed ·{' '}
            <Link to="/privacy" className="hover:text-ink">
              Privacy
            </Link>{' '}
            ·{' '}
            <Link to="/terms" className="hover:text-ink">
              Terms
            </Link>
          </p>
        </div>
        <p
          data-wordmark
          aria-hidden
          className="flex select-none justify-between overflow-hidden font-display text-[clamp(120px,24vw,360px)] font-semibold leading-[0.8] tracking-[-0.06em] text-white/[0.06]"
        >
          {'SYNQ'.split('').map((c) => (
            <span key={c} className="inline-block">
              {c}
            </span>
          ))}
        </p>
      </footer>
    </div>
  );
}
