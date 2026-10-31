import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import RouteFallback from './RouteFallback';

/**
 * Signed-in users only (when the server has accounts); others log in and come back.
 *
 * The redirect is a one-shot effect, not <Navigate/>: while a page animates out,
 * AnimatePresence keeps rendering it, and a <Navigate/> there fires on every render, so
 * the next page never appeared (a blank screen after logging out).
 */
export default function RequireAuth({ children }) {
  const status = useAuthStore((s) => s.status);
  const location = useLocation();
  const navigate = useNavigate();
  const sent = useRef(false);

  useEffect(() => {
    if (status !== 'guest' || sent.current) return;
    sent.current = true;
    navigate(`/login?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`, { replace: true });
  }, [status, location.pathname, location.search, navigate]);

  if (status === 'unknown') return <RouteFallback label="CONNECTING TO SYNQ" />;
  if (status === 'guest') return null;
  return children;
}
