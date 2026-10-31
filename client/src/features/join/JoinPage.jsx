import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Check, Copy, Crown, LogOut, RefreshCw } from 'lucide-react';
import Logo from '@/components/ui/Logo';
import Button from '@/components/ui/Button';
import HudLabel from '@/components/ui/HudLabel';
import ColorPicker from '@/components/ui/ColorPicker';
import GrainOverlay from '@/components/ui/GrainOverlay';
import { useUserStore, validateUsername } from '@/store/userStore';
import { useAuthStore } from '@/store/authStore';
import { api } from '@/lib/api';
import { usePageMeta } from '@/hooks/usePageMeta';
import { generateRoomId, normalizeRoomId } from '@/lib/roomId';
import { useCopy } from '@/hooks/useCopy';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { EASE } from '@/lib/motion';
import { cn } from '@/lib/cn';

const inputCls =
  'h-11 w-full rounded-card border border-line bg-white/[0.03] px-3.5 text-sm text-ink placeholder:text-faint ' +
  'outline-none transition-colors duration-micro focus:border-blue focus:bg-white/[0.05]';

// Create or join a room. Signed in, your account name is used and your rooms are listed;
// without accounts (offline demo) you pick a name here.
export default function JoinPage() {
  useDocumentTitle('Your rooms');
  usePageMeta({ noindex: true });
  const account = useAuthStore((s) => s.user);
  const [myRooms, setMyRooms] = useState(null);
  useEffect(() => {
    if (!account) return;
    api('/api/rooms').then(
      (r) => setMyRooms(r.rooms),
      () => setMyRooms([]),
    );
  }, [account]);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { username, color, setUsername, setColor, rememberRoom } = useUserStore();

  const prefillRoom = params.get('room') || '';
  const invitedAsViewer = params.get('role') === 'viewer';
  const [mode, setMode] = useState(
    prefillRoom || params.get('mode') === 'join' ? 'join' : 'create',
  );
  const [name, setName] = useState(username);
  const [newRoomId, setNewRoomId] = useState(() => generateRoomId());
  const [roomName, setRoomName] = useState('');
  const [joinId, setJoinId] = useState(prefillRoom);
  const [touched, setTouched] = useState(false);
  const [copied, copy] = useCopy();

  const nameError = account ? null : validateUsername(name);
  const joinIdNormalized = useMemo(() => normalizeRoomId(joinId), [joinId]);
  const joinError =
    mode === 'join' && !joinIdNormalized
      ? 'Enter an ID like synq-7f3k-92ab or paste an invite link.'
      : null;
  const canSubmit = !nameError && !joinError;

  const submit = (e) => {
    e.preventDefault();
    setTouched(true);
    if (!canSubmit) return;
    if (!account) setUsername(name);
    const roomId = mode === 'create' ? newRoomId : joinIdNormalized;
    rememberRoom(roomId, mode === 'create' ? roomName.trim() : '');
    navigate(`/room/${roomId}${mode === 'join' && invitedAsViewer ? '?role=viewer' : ''}`, {
      state: { intent: mode, roomName: mode === 'create' ? roomName.trim() : undefined },
    });
  };

  return (
    <div className="relative flex min-h-screen flex-col bg-bg">
      <GrainOverlay />
      <div
        aria-hidden
        className="halftone pointer-events-none absolute inset-0 opacity-30 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]"
      />
      <header className="relative z-10 flex h-20 items-center justify-between px-10">
        <Logo />
        {account && (
          <div className="flex items-center gap-3 text-[13px] text-muted">
            <span>
              Signed in as <span className="font-medium text-ink">{account.name}</span>
            </span>
            <Link
              to="/account"
              className="rounded-full border border-line px-3 py-1.5 hover:border-line-strong hover:text-ink"
            >
              Account
            </Link>
            <button
              type="button"
              onClick={() => useAuthStore.getState().logout()}
              className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 hover:border-line-strong hover:text-ink"
            >
              <LogOut size={13} aria-hidden /> Log out
            </button>
          </div>
        )}
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-6 pb-20">
        <motion.form
          onSubmit={submit}
          noValidate
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } }}
          className="glass w-full max-w-[460px] rounded-[16px] p-8 shadow-[0_40px_120px_-40px_rgba(124,92,255,0.45)]"
          aria-labelledby="join-title"
        >
          <HudLabel index={2} accent className="mb-3">
            SHARE ID
          </HudLabel>
          <h1 id="join-title" className="display mb-6 text-[40px] text-ink">
            {mode === 'create' ? 'Start a room.' : prefillRoom ? "You're invited." : 'Join a room.'}
          </h1>
          {mode === 'join' && prefillRoom && (
            <p className="-mt-3 mb-6 text-sm text-muted">
              {account ? 'Ask to enter' : 'Pick a name and ask to enter'}{' '}
              <code className="font-mono text-ink">{prefillRoom}</code>
              {invitedAsViewer ? ' as a viewer (read-only).' : '.'} The owner lets you in.
            </p>
          )}

          <div
            role="tablist"
            aria-label="Room mode"
            className="relative mb-6 grid grid-cols-2 rounded-full border border-line p-1"
          >
            {/* One pill sliding between the tabs. Not a shared layoutId: a layout animation
                left mid-flight when this page unmounts (e.g. on log out) kept the page
                transition from finishing, and the next page never appeared. */}
            <motion.span
              aria-hidden
              className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-ink"
              initial={false}
              animate={{ x: mode === 'join' ? '100%' : '0%' }}
              transition={{ duration: 0.35, ease: EASE }}
            />
            {['create', 'join'].map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  'relative z-10 h-9 rounded-full text-sm font-medium transition-colors duration-micro',
                  mode === m ? 'text-bg' : 'text-muted hover:text-ink',
                )}
              >
                {m === 'create' ? 'Create room' : 'Join room'}
              </button>
            ))}
          </div>

          <div className="space-y-5">
            {!account && (
              <div>
                <label htmlFor="username" className="mb-2 block text-[13px] font-medium text-ink">
                  Your name
                </label>
                <input
                  id="username"
                  className={inputCls}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="ada"
                  autoComplete="nickname"
                  maxLength={24}
                  aria-invalid={touched && !!nameError}
                  aria-describedby="username-err"
                />
                {touched && nameError && (
                  <p id="username-err" className="mt-1.5 text-xs text-[#F14C4C]">
                    {nameError}
                  </p>
                )}
              </div>
            )}

            <div>
              <span className="mb-2 block text-[13px] font-medium text-ink">Cursor color</span>
              <ColorPicker value={color} onChange={setColor} />
            </div>

            {mode === 'create' ? (
              <>
                <div>
                  <span className="mb-2 block text-[13px] font-medium text-ink">Room ID</span>
                  <div className="flex items-center gap-2 rounded-card border border-line bg-black/30 px-3.5 py-2.5">
                    <code className="flex-1 font-mono text-[15px] text-ink">{newRoomId}</code>
                    <button
                      type="button"
                      onClick={() => setNewRoomId(generateRoomId())}
                      className="rounded p-1.5 text-muted hover:text-ink"
                      aria-label="Generate a new room ID"
                      title="Generate a new ID"
                    >
                      <RefreshCw size={15} aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => copy(newRoomId)}
                      className="rounded p-1.5 text-muted hover:text-ink"
                      aria-label={copied ? 'Room ID copied' : 'Copy room ID'}
                      title="Copy ID"
                    >
                      {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
                    </button>
                  </div>
                </div>
                <div>
                  <label
                    htmlFor="room-name"
                    className="mb-2 block text-[13px] font-medium text-ink"
                  >
                    Room name <span className="text-faint">(optional)</span>
                  </label>
                  <input
                    id="room-name"
                    className={inputCls}
                    value={roomName}
                    onChange={(e) => setRoomName(e.target.value)}
                    placeholder="Algorithms study group"
                    maxLength={60}
                  />
                </div>
              </>
            ) : (
              <div>
                <label htmlFor="room-id" className="mb-2 block text-[13px] font-medium text-ink">
                  Room ID or invite link
                </label>
                <input
                  id="room-id"
                  className={cn(inputCls, 'font-mono')}
                  value={joinId}
                  onChange={(e) => setJoinId(e.target.value)}
                  placeholder="synq-7f3k-92ab"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={touched && !!joinError}
                  aria-describedby="room-id-err"
                />
                {touched && joinError && (
                  <p id="room-id-err" className="mt-1.5 text-xs text-[#F14C4C]">
                    {joinError}
                  </p>
                )}
              </div>
            )}
          </div>

          <Button type="submit" size="lg" className="mt-8 w-full">
            {mode === 'create' ? 'Create room' : 'Join room'} <ArrowRight size={16} aria-hidden />
          </Button>
          {account && (
            <div className="mt-8 border-t border-line pt-5">
              <span className="mb-2 block text-[13px] font-medium text-ink">Your rooms</span>
              {myRooms === null ? (
                <p className="text-[13px] text-faint">Loading...</p>
              ) : myRooms.length === 0 ? (
                <p className="text-[13px] text-faint">
                  Rooms you create or get accepted into show up here.
                </p>
              ) : (
                <ul className="max-h-52 space-y-1 overflow-y-auto">
                  {myRooms.map((r) => (
                    <li key={r.id}>
                      <Link
                        to={`/room/${r.id}`}
                        state={{ roomName: r.name || undefined }}
                        className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-[13px] hover:bg-white/[0.04]"
                      >
                        <span className="flex min-w-0 items-center gap-1.5 truncate text-ink">
                          {r.role === 'owner' && (
                            <Crown
                              size={12}
                              className="shrink-0 text-[#FACC15]"
                              aria-label="You own this room"
                            />
                          )}
                          {r.name || 'Untitled room'}
                        </span>
                        <span className="shrink-0 font-mono text-[11px] text-faint">
                          {r.id} · {r.role}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <p className="mt-4 text-center text-xs text-faint">
            <Link to="/" className="hover:text-muted">
              Back to home
            </Link>
          </p>
        </motion.form>
      </main>
    </div>
  );
}
