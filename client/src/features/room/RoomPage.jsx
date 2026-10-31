import { useEffect, useRef } from 'react';
import { useLocation, useNavigate, useParams, Link } from 'react-router-dom';
import Button from '@/components/ui/Button';
import RouteFallback from '@/components/layout/RouteFallback';
import { motion } from 'framer-motion';
import { useUserStore } from '@/store/userStore';
import { useRoomStore } from '@/store/roomStore';
import { usePageMeta } from '@/hooks/usePageMeta';
import { EASE } from '@/lib/motion';
import { isValidRoomId } from '@/lib/roomId';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { RoomContext } from './RoomContext';
import { useCollabRoom } from './useCollabRoom';
import Workspace from './Workspace';

// Room route: validates the ID, makes sure we have a name, then connects and renders
// the collaborative workspace.
export default function RoomPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const username = useUserStore((s) => s.username);
  useDocumentTitle(id);
  usePageMeta({ noindex: true });

  // Redirect to /join when there is no username yet. A one-shot effect (not <Navigate/>):
  // during the exit animation AnimatePresence keeps rendering the old page, and a
  // <Navigate/> there would fire on every render and loop.
  const needsName = isValidRoomId(id) && !username;
  const redirected = useRef(false);
  useEffect(() => {
    if (needsName && !redirected.current) {
      redirected.current = true;
      // Keep ?role=viewer from an invite link across the name prompt.
      const role =
        new URLSearchParams(window.location.search).get('role') === 'viewer' ? '&role=viewer' : '';
      navigate(`/join?room=${id}${role}`, { replace: true });
    }
  }, [needsName, id, navigate]);

  if (!isValidRoomId(id)) {
    return (
      <main className="flex h-screen flex-col items-center justify-center gap-4 bg-bg text-center">
        <span className="hud">ERR / INVALID ROOM ID</span>
        <h1 className="display text-5xl text-ink">That room ID looks off.</h1>
        <p className="text-muted">
          Room IDs look like <code className="font-mono text-ink">synq-7f3k-92ab</code>.
        </p>
        <Button as={Link} to="/join?mode=join" variant="white">
          Enter a room ID
        </Button>
      </main>
    );
  }

  if (needsName) return null;

  return <ConnectedRoom roomId={id} />;
}

function ConnectedRoom({ roomId }) {
  const location = useLocation();
  // Sent once when you create the room, so everyone sees its name.
  const room = useCollabRoom(roomId, {
    roomName: location.state?.intent === 'create' ? location.state.roomName : null,
  });
  const status = useRoomStore((s) => s.status);
  const statusError = useRoomStore((s) => s.statusError);
  const serverName = useRoomStore((s) => s.roomName);
  const roomName =
    serverName ||
    location.state?.roomName ||
    useUserStore.getState().recentRooms.find((r) => r.roomId === roomId)?.name ||
    'Untitled room';

  if (status === 'pending') return <Waiting roomId={roomId} roomName={serverName} />;
  if (status === 'denied') return <Denied error={statusError} />;
  if (!room) return <RouteFallback label="JOINING ROOM" />;
  return (
    <RoomContext.Provider value={room}>
      <Workspace roomId={roomId} roomName={roomName} />
    </RoomContext.Provider>
  );
}

function Screen({ hud, title, children }) {
  return (
    <main className="flex h-screen flex-col items-center justify-center gap-4 bg-bg px-6 text-center">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } }}
        className="flex max-w-[480px] flex-col items-center gap-4"
      >
        <span className="hud">{hud}</span>
        <h1 className="display text-5xl text-ink">{title}</h1>
        {children}
      </motion.div>
    </main>
  );
}

/** You asked to join; the owner has not answered yet. You get in as soon as they accept. */
function Waiting({ roomId, roomName }) {
  return (
    <Screen hud="WAITING FOR THE OWNER" title="Asked to join.">
      <p className="text-muted">
        The owner of{' '}
        {roomName ? (
          <span className="text-ink">{roomName}</span>
        ) : (
          <code className="font-mono text-ink">{roomId}</code>
        )}{' '}
        has been asked to let you in. Keep this page open; it opens the room as soon as they accept.
      </p>
      <span className="relative mt-2 block h-px w-40 overflow-hidden bg-white/10">
        <span className="absolute inset-y-0 left-0 w-1/2 animate-shimmer bg-gradient-to-r from-transparent via-white/70 to-transparent" />
      </span>
      <Button as={Link} to="/join" variant="outline" className="mt-2">
        Back to your rooms
      </Button>
    </Screen>
  );
}

/** Declined, removed, or logged out. */
function Denied({ error }) {
  const loggedOut = error?.code === 'unauthorized';
  const title = loggedOut
    ? 'Log in again.'
    : error?.code === 'removed'
      ? 'You were removed.'
      : 'Not this time.';
  return (
    <Screen hud={loggedOut ? 'LOGIN EXPIRED' : 'NO ACCESS'} title={title}>
      <p className="text-muted">{error?.message}</p>
      {loggedOut ? (
        <Button
          as={Link}
          to={`/login?next=${encodeURIComponent(window.location.pathname)}`}
          variant="white"
        >
          Log in
        </Button>
      ) : (
        <Button as={Link} to="/join" variant="white">
          Back to your rooms
        </Button>
      )}
    </Screen>
  );
}
