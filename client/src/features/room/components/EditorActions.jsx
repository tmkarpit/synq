import { useState } from 'react';
import { Check, Radio, Save, SquareTerminal } from 'lucide-react';
import Spinner from '@/components/ui/Spinner';
import { MOD_KEY } from '@/components/ui/Kbd';
import { useRoomStore } from '@/store/roomStore';
import { useUiStore } from '@/store/uiStore';
import { useRoom } from '@/features/room/RoomContext';
import { saveRoom } from '@/features/room/saveActions';
import { isHtml, openLive } from '@/features/room/liveActions';
import { cn } from '@/lib/cn';

const pill =
  'relative flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition duration-micro active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40';

/** Save the room on the server now (same as Ctrl/Cmd+S). */
export function SaveButton() {
  const room = useRoom();
  const [saving, setSaving] = useState(false);
  const connected = useRoomStore((s) => s.status === 'connected');
  const dirty = useRoomStore((s) => Object.keys(s.dirty).length > 0);
  const label = !connected
    ? 'Not connected: changes are saved when the connection is back'
    : dirty
      ? `Save changes (${MOD_KEY}+S)`
      : `All changes saved (${MOD_KEY}+S to save again)`;

  const save = async () => {
    setSaving(true);
    await saveRoom(room);
    setSaving(false);
  };

  return (
    <button
      type="button"
      onClick={save}
      disabled={!connected || saving}
      aria-label={label}
      title={label}
      className={cn(pill, 'bg-ws-hover text-ws-text hover:bg-white/10')}
    >
      {saving ? (
        <Spinner size={13} />
      ) : dirty ? (
        <Save size={14} aria-hidden />
      ) : (
        <Check size={14} aria-hidden />
      )}
      {dirty || saving ? 'Save' : 'Saved'}
      {dirty && (
        <span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-ws-panel bg-ws-accent"
        />
      )}
    </button>
  );
}

/** Show or hide the shared terminal (same as Ctrl/Cmd+`). */
export function TerminalButton() {
  const open = useUiStore((s) => s.bottomPanelOpen && s.bottomTab === 'terminal');
  const toggle = () => {
    const ui = useUiStore.getState();
    if (open) ui.setBottomPanelOpen(false);
    else ui.setBottomTab('terminal'); // also opens the panel
  };
  const label = `${open ? 'Hide' : 'Open'} terminal (${MOD_KEY}+\`)`;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      aria-pressed={open}
      title={label}
      className={cn(
        pill,
        open
          ? 'bg-[#7C5CFF]/20 text-ws-text'
          : 'bg-ws-hover text-ws-muted hover:bg-white/10 hover:text-ws-text',
      )}
    >
      <SquareTerminal size={14} aria-hidden />
      Terminal
    </button>
  );
}

/** "Go Live" for the open HTML file: a preview in a new tab that reloads on every edit. */
export function GoLiveButton() {
  const { service } = useRoom();
  const fileId = useRoomStore((s) => s.activeFileId);
  const html = useRoomStore((s) => isHtml(s.nodes[s.activeFileId]?.name));
  if (!html) return null;
  return (
    <button
      type="button"
      onClick={() => openLive(service, fileId)}
      aria-label="Go Live: open this page in a new tab (reloads on every change)"
      title="Go Live: open this page in a new tab (reloads on every change)"
      className={cn(pill, 'bg-[#3B82F6]/15 text-[#93C5FD] hover:bg-[#3B82F6]/25')}
    >
      <Radio size={14} aria-hidden />
      Go Live
    </button>
  );
}
