import { lazy, Suspense, useCallback, useEffect, useRef } from 'react';
import { WifiOff } from 'lucide-react';
import { ENV } from '@/config/app';
import { useUiStore } from '@/store/uiStore';
import { useRoomStore } from '@/store/roomStore';
import { CLIENT_EVENTS } from '@/services/collab';
import { requestRun } from '@/features/run/runActions';
import Spinner from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { useRoom } from './RoomContext';
import { saveRoom } from './saveActions';
import TitleBar from './components/TitleBar';
import ActivityBar from './components/ActivityBar';
import ExplorerView from './components/ExplorerView';
import ParticipantsView from './components/ParticipantsView';
import ChatView from './components/ChatView';
import SourceControlView from './components/SourceControlView';
import { useSourceControlTracker } from './sourceControl';
import SettingsView from './components/SettingsView';
import EditorTabs from './components/EditorTabs';
import Breadcrumbs from './components/Breadcrumbs';
import BottomPanel from './components/BottomPanel';
import StatusBar from './components/StatusBar';

const CodeEditor = lazy(() => import('@/features/editor/CodeEditor'));

const VIEWS = {
  explorer: ExplorerView,
  participants: ParticipantsView,
  scm: SourceControlView,
  chat: ChatView,
  settings: SettingsView,
};

function SideBar() {
  const view = useUiStore((s) => s.sidebarView);
  const View = VIEWS[view] || ExplorerView;
  return (
    <aside aria-label="Side bar" className="ws-card flex w-[264px] shrink-0 flex-col text-ws-text">
      <View />
    </aside>
  );
}

/** Live mode: shown while the SYNQ server is unreachable. Edits stay local and sync on reconnect. */
function OfflineBanner() {
  const status = useRoomStore((s) => s.status);
  if (ENV.useMock || status !== 'disconnected') return null;
  return (
    <div
      role="status"
      className="mx-2 mb-2 flex shrink-0 items-center gap-2 rounded-xl border border-[#5A1D1D] bg-[#2A1215] px-3 py-1.5 text-[12px] text-[#F2B8B5]"
    >
      <WifiOff size={13} aria-hidden />
      {ENV.isDev ? (
        <>
          Can&apos;t reach the SYNQ server. Your changes are kept here and will sync when it is
          back. (Start it with <code className="font-mono">npm run dev:server</code>.)
        </>
      ) : (
        <>Reconnecting to the server… your changes are kept here and sync as soon as it answers.</>
      )}
    </div>
  );
}

function PanelResizer({ columnRef }) {
  const setBottomPanelSize = useUiStore((s) => s.setBottomPanelSize);
  const onPointerDown = (e) => {
    e.preventDefault();
    const rect = columnRef.current.getBoundingClientRect();
    const move = (ev) => {
      const pct = ((rect.bottom - ev.clientY) / rect.height) * 100;
      setBottomPanelSize(Math.round(Math.min(75, Math.max(12, pct))));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize panel"
      onPointerDown={onPointerDown}
      className="group relative z-10 flex h-2 shrink-0 cursor-row-resize items-center justify-center"
    >
      <span
        aria-hidden
        className="h-[3px] w-10 rounded-full bg-ws-border transition-colors delay-100 group-hover:bg-ws-accent"
      />
    </div>
  );
}

export default function Workspace({ roomId, roomName }) {
  const room = useRoom();
  const { service } = room;
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const bottomOpen = useUiStore((s) => s.bottomPanelOpen);
  const bottomSize = useUiStore((s) => s.bottomPanelSize);
  const activeFileId = useRoomStore((s) => s.activeFileId);
  const connected = useRoomStore((s) => s.status === 'connected');
  const columnRef = useRef(null);
  useSourceControlTracker(service);

  // Presence: tell the room which file we are in.
  useEffect(() => {
    if (connected) service.emit(CLIENT_EVENTS.presenceUpdate, { fileId: activeFileId });
  }, [service, activeFileId, connected]);

  const onKeyDown = useCallback(
    (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      // Inside Monaco, Ctrl+Enter is handled by the editor command itself.
      if (e.key === 'Enter' && !e.target.closest?.('.monaco-editor')) {
        e.preventDefault();
        requestRun(room);
      } else if (e.key.toLowerCase() === 's') {
        // Never the browser's "Save page" dialog. Monaco runs its own Ctrl+S command.
        e.preventDefault();
        if (!e.target.closest?.('.monaco-editor')) saveRoom(room);
      } else if (e.key === '`') {
        e.preventDefault();
        useUiStore.getState().toggleBottomPanel();
      } else if (e.key.toLowerCase() === 'b' && !e.shiftKey) {
        e.preventDefault();
        const ui = useUiStore.getState();
        ui.setSidebarOpen(!ui.sidebarOpen);
      }
    },
    [room],
  );

  // Edits stay marked until the server confirms they are in the database. Leaving or
  // refreshing before that (e.g. while the server is unreachable) would lose them, so the
  // browser asks first.
  useEffect(() => {
    const warn = (e) => {
      if (!Object.keys(useRoomStore.getState().dirty).length) return;
      e.preventDefault();
      e.returnValue = ''; // older browsers need this to show the prompt
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);

  return (
    <div className="ws-studio flex h-screen flex-col overflow-hidden bg-ws-canvas font-sans text-ws-text">
      <TitleBar roomId={roomId} roomName={roomName} />
      <OfflineBanner />
      {/* Floating panels on the canvas: rail | side panel | editor + console */}
      <div className="flex min-h-0 flex-1 gap-2 px-2">
        <ActivityBar />
        {sidebarOpen && <SideBar />}
        <main ref={columnRef} className="flex min-w-0 flex-1 flex-col">
          <section aria-label="Editor" className="ws-card flex min-h-0 flex-1 flex-col">
            <EditorTabs />
            <Breadcrumbs />
            <div className="relative min-h-0 flex-1">
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center gap-2 text-xs text-ws-muted">
                    <Spinner size={14} /> Loading editor...
                  </div>
                }
              >
                <CodeEditor />
              </Suspense>
            </div>
          </section>
          {bottomOpen ? <PanelResizer columnRef={columnRef} /> : <div className="h-2 shrink-0" />}
          {/* Kept mounted while hidden so the shared terminal never misses output. */}
          <div
            className={cn('ws-card shrink-0', !bottomOpen && 'hidden')}
            style={{ height: `${bottomSize}%` }}
          >
            <BottomPanel />
          </div>
        </main>
      </div>
      <StatusBar />
    </div>
  );
}
