import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { gsap, useGSAP } from '../gsap';

const FAQ = [
  {
    q: 'Is SYNQ free?',
    a: 'Yes. It is open source (MIT). You run the SYNQ server yourself, so your rooms and code stay on your machine or your own server.',
  },
  {
    q: 'Do my collaborators need to install anything?',
    a: 'No. They open the invite link in a desktop browser, pick a name, and they are in the room.',
  },
  {
    q: 'Where does my code run?',
    a: 'On the machine that runs the SYNQ server. JavaScript and TypeScript run in a locked-down Node process. Python, C, C++ and Java use the compilers installed there, with a 5-second limit per run, so only invite people you trust.',
  },
  {
    q: 'What happens when everyone leaves?',
    a: 'The room is saved. Open the same link later and the final code is still there. You can also download the whole project as a zip.',
  },
  {
    q: 'Can someone watch without editing?',
    a: 'Yes. Add ?role=viewer to an invite link. Viewers see the code, cursors and console live, and can chat, but cannot edit or run.',
  },
  {
    q: 'Does it work on phones?',
    a: 'SYNQ is a full editor with panels and a terminal, so it needs a screen at least 768px wide. On smaller screens you can copy the link for later.',
  },
];

function Item({ q, a, open, onToggle, id }) {
  const bodyRef = useRef(null);
  const iconRef = useRef(null);

  useGSAP(
    () => {
      gsap.to(bodyRef.current, {
        height: open ? 'auto' : 0,
        opacity: open ? 1 : 0,
        duration: 0.6,
        ease: 'expo.out',
      });
      gsap.to(iconRef.current, { rotate: open ? 135 : 0, duration: 0.6, ease: 'back.out(2)' });
    },
    { dependencies: [open] },
  );

  return (
    <li className="border-b border-line">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`${id}-a`}
        className="group flex w-full items-center justify-between gap-6 py-7 text-left"
      >
        <span className="font-display text-[26px] font-semibold tracking-[-0.025em] text-ink transition-colors group-hover:text-[#B6A4FF]">
          {q}
        </span>
        <span
          ref={iconRef}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line-strong text-ink"
        >
          <Plus size={20} aria-hidden />
        </span>
      </button>
      <div id={`${id}-a`} ref={bodyRef} className="h-0 overflow-hidden opacity-0" role="region">
        <p className="max-w-[760px] pb-8 text-[17px] leading-relaxed text-muted">{a}</p>
      </div>
    </li>
  );
}

export default function Faq() {
  const [open, setOpen] = useState(0);
  return (
    <section id="faq" className="mx-auto w-[min(1180px,calc(100%-48px))] pb-36">
      <div className="grid grid-cols-[1fr_2fr] gap-16">
        <div>
          <p className="mb-4 font-mono text-[13px] uppercase tracking-[0.18em] text-muted">FAQ</p>
          <h2 className="font-display text-[clamp(44px,5vw,76px)] font-semibold leading-[0.95] tracking-[-0.045em] text-ink">
            Good questions.
          </h2>
        </div>
        <ul className="border-t border-line">
          {FAQ.map((item, i) => (
            <Item
              key={item.q}
              id={`faq-${i}`}
              {...item}
              open={open === i}
              onToggle={() => setOpen(open === i ? -1 : i)}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}
