import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { Toaster } from 'sonner';
import ErrorBoundary from '@/components/layout/ErrorBoundary';
import DesktopOnlyGate from '@/components/layout/DesktopOnlyGate';
import PageTransition from '@/components/layout/PageTransition';
import RouteFallback from '@/components/layout/RouteFallback';
import RequireAuth from '@/components/layout/RequireAuth';
import AccountSwitched from '@/components/layout/AccountSwitched';
import { useAuthStore } from '@/store/authStore';
import { useApplyTheme } from '@/hooks/useApplyTheme';

const LandingPage = lazy(() => import('@/features/landing/LandingPage'));
const JoinPage = lazy(() => import('@/features/join/JoinPage'));
const AuthPage = lazy(() => import('@/features/auth/AuthPage'));
const AccountPage = lazy(() => import('@/features/auth/AccountPage'));
const RoomPage = lazy(() => import('@/features/room/RoomPage'));

// Reloading a room: download the room and editor code while the login is being checked,
// instead of after it.
if (window.location.pathname.startsWith('/room/')) {
  import('@/features/room/RoomPage');
  import('@/features/editor/CodeEditor');
}
const NotFoundPage = lazy(() => import('@/features/notfound/NotFoundPage'));

/** First path segment: "/room/a" and "/room/b" share the key "room", so no wipe replays. */
function routeKey(pathname) {
  const seg = pathname.split('/').filter(Boolean)[0];
  if (seg === 'login' || seg === 'signup') return 'auth'; // switching tabs stays smooth
  return seg || 'home';
}

function AnimatedRoutes() {
  const location = useLocation();
  const key = routeKey(location.pathname);

  return (
    <AnimatePresence mode="wait" initial={false}>
      <PageTransition key={key} className={key === 'room' ? 'h-full' : undefined}>
        <Suspense fallback={<RouteFallback />}>
          <Routes location={location}>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<AuthPage mode="login" />} />
            <Route path="/signup" element={<AuthPage mode="signup" />} />
            <Route
              path="/account"
              element={
                <RequireAuth>
                  <AccountPage />
                </RequireAuth>
              }
            />
            <Route
              path="/join"
              element={
                <RequireAuth>
                  <JoinPage />
                </RequireAuth>
              }
            />
            <Route
              path="/room/:id"
              element={
                <RequireAuth>
                  <RoomPage />
                </RequireAuth>
              }
            />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </PageTransition>
    </AnimatePresence>
  );
}

export default function App() {
  useApplyTheme();
  // Another tab logged in as someone else: leave the room (unmount it) and ask.
  const switched = useAuthStore((s) => !!s.switchedTo);
  useEffect(() => {
    useAuthStore.getState().init();
  }, []);

  return (
    <ErrorBoundary>
      <DesktopOnlyGate>
        {switched ? <AccountSwitched /> : <AnimatedRoutes />}
        <Toaster
          theme="dark"
          position="bottom-right"
          offset={36}
          toastOptions={{
            style: {
              background: '#202020',
              border: '1px solid #2B2B2B',
              color: '#CCCCCC',
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize: '13px',
            },
          }}
        />
      </DesktopOnlyGate>
    </ErrorBoundary>
  );
}
