import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, LayoutGrid, LogOut, UserRound } from 'lucide-react';
import Logo from '@/components/ui/Logo';
import { useAuthStore } from '@/store/authStore';
import { gsap, useGSAP, ScrollTrigger } from '../gsap';
import Magnetic from '../components/Magnetic';

const LINKS = [
  ['#features', 'Features'],
  ['#how', 'How it works'],
  ['#languages', 'Languages'],
  ['#faq', 'FAQ'],
];

/** Floating nav: glass pill once you scroll, hides on the way down, returns on the way up. */
export default function Nav() {
  const ref = useRef(null);

  useGSAP(
    () => {
      const el = ref.current;
      gsap.from(el, { yPercent: -120, opacity: 0, duration: 1.1, delay: 0.2 });
      const show = gsap.to(el, {
        yPercent: -140,
        duration: 0.45,
        ease: 'power3.out',
        paused: true,
      });
      ScrollTrigger.create({
        start: 'top -80',
        onUpdate: (self) => (self.direction === 1 ? show.play() : show.reverse()),
        onToggle: (self) => el.classList.toggle('nav--scrolled', self.isActive),
      });
    },
    { scope: ref },
  );

  return (
    <header
      ref={ref}
      className="landing-nav fixed inset-x-0 top-4 z-50 mx-auto flex h-14 w-[min(1180px,calc(100%-48px))] items-center justify-between rounded-full px-5"
    >
      <Logo />
      <nav aria-label="Sections" className="flex items-center gap-1">
        {LINKS.map(([href, label]) => (
          <a
            key={href}
            href={href}
            className="rounded-full px-3.5 py-1.5 text-[14px] text-muted transition-colors hover:bg-white/[0.06] hover:text-ink"
          >
            {label}
          </a>
        ))}
      </nav>
      <div className="flex items-center gap-2">
        <AccountLinks />
        <Magnetic>
          <Link
            to="/join?mode=create"
            className="block rounded-full bg-ink px-4 py-2 text-[14px] font-semibold text-bg transition-colors hover:bg-white"
          >
            Start coding
          </Link>
        </Magnetic>
      </div>
    </header>
  );
}

/** Top right: "Log in" when signed out, your name and a small menu when signed in. */
function AccountLinks() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) =>
      (e.type !== 'keydown' || e.key === 'Escape') &&
      !ref.current?.contains(e.target) &&
      setOpen(false);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
    };
  }, [open]);

  const linkCls = 'rounded-full px-4 py-2 text-[14px] font-medium text-ink hover:bg-white/[0.06]';
  // Shown while the login is still being checked too, so the button is always there.
  if (status !== 'authed') {
    return status === 'off' ? (
      <Link to="/join?mode=join" className={linkCls}>
        Join a room
      </Link>
    ) : (
      <Link to="/login" className={linkCls}>
        Log in
      </Link>
    );
  }
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 text-[14px] font-medium text-ink hover:bg-white/[0.06]"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-[#7C5CFF] to-[#3B82F6] text-[12px] font-semibold uppercase text-white">
          {user.name.slice(0, 1)}
        </span>
        <span className="max-w-[120px] truncate">{user.name}</span>
        <ChevronDown size={14} className="text-muted" aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="glass absolute right-0 top-12 w-60 rounded-[14px] p-1.5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8)]"
        >
          <p className="truncate px-3 pb-2 pt-1.5 text-[12px] text-muted">{user.email}</p>
          <Link
            role="menuitem"
            to="/join"
            className="flex items-center gap-2 rounded-[10px] px-3 py-2 text-[14px] text-ink hover:bg-white/[0.06]"
          >
            <LayoutGrid size={15} aria-hidden /> My rooms
          </Link>
          <Link
            role="menuitem"
            to="/account"
            className="flex items-center gap-2 rounded-[10px] px-3 py-2 text-[14px] text-ink hover:bg-white/[0.06]"
          >
            <UserRound size={15} aria-hidden /> Account
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              useAuthStore.getState().logout();
            }}
            className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left text-[14px] text-ink hover:bg-white/[0.06]"
          >
            <LogOut size={15} aria-hidden /> Log out
          </button>
        </div>
      )}
    </div>
  );
}
