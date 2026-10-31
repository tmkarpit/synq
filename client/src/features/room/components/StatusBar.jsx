import { useShallow } from 'zustand/react/shallow';
import { CircleStop, Eye, Radio, X } from 'lucide-react';
import { toast } from 'sonner';
import { ENV } from '@/config/app';
import { LANGUAGE_LABELS, languageForName } from '@/config/languages';
import { useRoomStore } from '@/store/roomStore';
import { useSettingsStore } from '@/store/settingsStore';
import { cn } from '@/lib/cn';
import { useRoom } from '@/features/room/RoomContext';
import { goLiveTarget, openLive, stopLive } from '@/features/room/liveActions';

const STATUS_LABEL = {
  idle: 'Offline',
  connecting: 'Connecting',
  connected: ENV.useMock ? 'Mock' : 'Live',
  disconnected: 'Disconnected',
};
const MAX_CHIPS = 4;

const Sep = () => (
  <span aria-hidden className="text-ws-border">
    ·
  </span>
);

/** Quiet status line on the canvas: who is here on the left, cursor and file info on the right. */
export default function StatusBar() {
  const roomId = useRoomStore((s) => s.roomId);
  const status = useRoomStore((s) => s.status);
  const self = useRoomStore((s) => s.self);
  const users = useRoomStore(useShallow((s) => Object.values(s.users)));
  const cursor = useRoomStore((s) => s.cursor);
  const activeName = useRoomStore((s) => s.nodes[s.activeFileId]?.name);
  const { service } = useRoom();
  const followUserId = useRoomStore((s) => s.followUserId);
  const followName = useRoomStore((s) => s.users[s.followUserId]?.username);
  const stopFollowing = useRoomStore((s) => s.stopFollowing);
  const tabSize = useSettingsStore((s) => s.tabSize);
  const language = activeName ? LANGUAGE_LABELS[languageForName(activeName)] : null;
  const everyone = [self, ...users].filter(Boolean);

  return (
    <footer className="flex h-8 shrink-0 items-center gap-3 px-4 text-[11.5px] text-ws-muted">
      <span className="flex items-center gap-1.5" title={`Room ${roomId}`}>
        <span
          aria-hidden
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            status === 'connected'
              ? 'bg-[#4ADE80]'
              : status === 'connecting'
                ? 'bg-[#FACC15]'
                : 'bg-[#F14C4C]',
          )}
        />
        {STATUS_LABEL[status]}
      </span>
      <Sep />
      <div className="flex min-w-0 items-center gap-2" aria-label={`${everyone.length} in room`}>
        {everyone.slice(0, MAX_CHIPS).map((u) => (
          <span
            key={u.userId}
            className="flex items-center gap-1"
            title={`${u.username} (${u.role})`}
          >
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: u.color }}
            />
            <span
              className={cn('max-w-[90px] truncate', u.userId === self?.userId && 'text-ws-text')}
            >
              {u.userId === self?.userId ? `${u.username} (you)` : u.username}
            </span>
          </span>
        ))}
        {everyone.length > MAX_CHIPS && <span>+{everyone.length - MAX_CHIPS}</span>}
      </div>
      {self?.role === 'viewer' && (
        <span
          className="flex items-center gap-1 rounded-full bg-[#FACC15]/10 px-2 py-px text-[#F5D565]"
          title="You can watch and chat, but not edit or run"
        >
          <Eye size={12} aria-hidden /> Viewing only
        </span>
      )}

      <div className="flex-1" />

      {followUserId && (
        <button
          type="button"
          onClick={stopFollowing}
          title="Stop following"
          className="flex items-center gap-1 rounded-full bg-ws-accent-soft px-2 py-px text-[#B6A4FF] hover:bg-ws-accent-strong"
        >
          <Eye size={12} aria-hidden /> Following {followName} <X size={11} aria-hidden />
        </button>
      )}
      {activeName && (
        <>
          <span>
            Ln {cursor.lineNumber}, Col {cursor.column}
            {cursor.selected > 0 && ` (${cursor.selected} selected)`}
          </span>
          <Sep />
          <span>Spaces: {tabSize}</span>
          <Sep />
          <span>UTF-8 · LF</span>
          <span className="rounded-md border border-ws-border px-1.5 py-px text-ws-text">
            {language}
          </span>
        </>
      )}
      {service.mode === 'live' && <GoLiveItem service={service} />}
    </footer>
  );
}

/**
 * VS Code's "Go Live" status bar item. Off: "Go Live" starts the live server and opens the
 * page. On: "Port : 5173" (the port the preview is served on); click it to stop.
 */
function GoLiveItem({ service }) {
  const live = useRoomStore((s) => s.live);
  const viewer = useRoomStore((s) => s.self?.role === 'viewer');
  const port = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');

  const start = () => {
    const fileId = goLiveTarget();
    if (fileId) openLive(service, fileId);
    else
      toast('No HTML file to open', { description: 'Create an index.html, then click Go Live.' });
  };

  if (live) {
    return (
      <button
        type="button"
        onClick={() => (viewer ? start() : stopLive(service))}
        title={
          viewer
            ? 'The room is live. Click to open the page.'
            : 'Live server is running. Click to stop it.'
        }
        className="flex items-center gap-1.5 rounded-md px-1.5 py-px text-[#93C5FD] hover:bg-[#3B82F6]/15"
      >
        <CircleStop size={12} aria-hidden /> Port : {port}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={start}
      title="Go Live: open the page in a new tab; it reloads on every change"
      className="flex items-center gap-1.5 rounded-md px-1.5 py-px text-ws-text hover:bg-ws-hover"
    >
      <Radio size={12} aria-hidden /> Go Live
    </button>
  );
}
