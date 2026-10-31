import { Play } from 'lucide-react';
import Spinner from '@/components/ui/Spinner';
import { MOD_KEY } from '@/components/ui/Kbd';
import { useRoomStore } from '@/store/roomStore';
import { canEdit, canRun } from '@/services/collab';
import { requestRun } from '@/features/run/runActions';
import { useRoom } from '@/features/room/RoomContext';
import { cn } from '@/lib/cn';

/**
 * Run pill in the editor header. While anyone's run is active it shows who is running;
 * pressing it then prints a polite "already in progress" line instead of sending.
 */
export default function RunButton() {
  const room = useRoom();
  const active = useRoomStore((s) => s.run.active);
  const pending = useRoomStore((s) => s.run.pending);
  const viewer = useRoomStore((s) => !!s.self && !canEdit(s.self));
  const ownerOnly = useRoomStore((s) => !!s.self && canEdit(s.self) && !canRun(s.self, s.settings));
  const hasFile = useRoomStore((s) => !!s.activeFileId);
  const busy = !!active || pending;

  const label = viewer
    ? "Viewers can't run code"
    : ownerOnly
      ? 'Only the room owner can run code here'
      : active
        ? `${active.username} is running...`
        : pending
          ? 'Starting run...'
          : `Run file (${MOD_KEY}+Enter)`;

  return (
    <button
      type="button"
      onClick={() => requestRun(room)}
      disabled={viewer || ownerOnly || !hasFile}
      aria-label={label}
      aria-busy={busy}
      title={label}
      className={cn(
        'flex h-8 items-center gap-2 rounded-full pl-2.5 pr-3.5 text-[12.5px] font-semibold transition duration-micro',
        'disabled:cursor-not-allowed disabled:opacity-40',
        busy
          ? 'bg-ws-hover text-ws-text'
          : 'bg-[#22C55E]/15 text-[#6EE7A0] hover:bg-[#22C55E]/25 active:scale-[0.98]',
      )}
    >
      {busy ? (
        <>
          <Spinner size={13} className="text-[#6EE7A0]" />
          <span className="max-w-[120px] truncate">
            {active ? `${active.username} running` : 'Starting'}
          </span>
        </>
      ) : (
        <>
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#22C55E] text-[#06210F]">
            <Play size={11} strokeWidth={2.6} className="ml-px fill-current" aria-hidden />
          </span>
          Run
        </>
      )}
    </button>
  );
}
