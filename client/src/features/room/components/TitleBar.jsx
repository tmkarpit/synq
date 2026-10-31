import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Check, Copy, LogOut, UserPlus } from 'lucide-react';
import { LogoMark } from '@/components/ui/Logo';
import IconButton from '@/components/ui/IconButton';
import { ENV } from '@/config/app';
import { useCopy } from '@/hooks/useCopy';
import { inviteLink } from '@/lib/invite';
import { useRoomStore } from '@/store/roomStore';
import { cn } from '@/lib/cn';
import AvatarStack from './AvatarStack';

export default function TitleBar({ roomId, roomName }) {
  const navigate = useNavigate();
  const [copied, copy] = useCopy();
  const [inviteCopied, copyInvite] = useCopy();

  const invite = async (role = 'editor') => {
    let link;
    try {
      link = await inviteLink(roomId, role);
    } catch (err) {
      toast.error('Could not create an invite', { description: err.message });
      return;
    }
    const ok = await copyInvite(link);
    const who = role === 'viewer' ? 'Viewer link' : 'Invite link';
    const hint = ENV.useMock
      ? 'Mock mode: this link only works in other tabs of this browser. Start the SYNQ server for real invites.'
      : /\/\/(localhost|127\.0\.0\.1)/.test(link)
        ? 'This link points to localhost, so it only works on this computer. Start the client with "npm run dev:lan".'
        : useRoomStore.getState().settings.approval
          ? 'People who open it log in and ask to join. Accept or decline them in People.'
          : role === 'viewer'
            ? 'People who open it log in and join read-only.'
            : 'People who open it log in and join right away.';
    const description = (
      <span className="block">
        <span className="block break-all font-mono text-[11px]">{link}</span>
        <span className="mt-1 block">{hint}</span>
      </span>
    );
    const action =
      role === 'editor' ? { label: 'Viewer link', onClick: () => invite('viewer') } : undefined;
    if (ok) toast.success(`${who} copied`, { description, duration: 10000, action });
    else toast(link, { description: 'Copy this invite link and send it to your collaborators.' });
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 px-3 text-[13px]">
      <Link
        to="/"
        aria-label="SYNQ home"
        className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-ws-text hover:bg-white/[0.04]"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#7C5CFF] to-[#3B82F6] text-white shadow-[0_4px_14px_-4px_rgba(124,92,255,0.7)]">
          <LogoMark size={14} />
        </span>
        <span className="font-display text-[15px] font-semibold tracking-[-0.02em]">SYNQ</span>
      </Link>
      <span aria-hidden className="h-5 w-px bg-ws-border" />
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate font-medium text-ws-text">{roomName}</span>
        <button
          type="button"
          onClick={() => copy(roomId)}
          className="flex items-center gap-1.5 rounded-full border border-ws-border bg-ws-panel px-2.5 py-0.5 font-mono text-[11px] text-ws-muted transition-colors hover:border-ws-accent-line hover:text-ws-text"
          title="Copy room ID"
          aria-label={copied ? 'Room ID copied' : `Copy room ID ${roomId}`}
        >
          {copied ? <Check size={11} aria-hidden /> : <Copy size={11} aria-hidden />}
          {copied ? 'copied' : roomId}
        </button>
        <LiveBadge />
      </div>
      <div className="flex flex-1 items-center justify-end gap-3">
        <AvatarStack />
        <button
          type="button"
          onClick={() => invite('editor')}
          className="flex h-8 items-center gap-1.5 rounded-full bg-gradient-to-r from-[#7C5CFF] to-[#5B7CFF] px-3.5 text-[12.5px] font-semibold text-white shadow-[0_6px_20px_-8px_rgba(124,92,255,0.9)] transition hover:brightness-110 active:scale-[0.98]"
          title="Copy an invite link for this room"
        >
          {inviteCopied ? <Check size={14} aria-hidden /> : <UserPlus size={14} aria-hidden />}
          {inviteCopied ? 'Link copied' : 'Invite'}
        </button>
        <IconButton
          label="Leave room"
          size="sm"
          className="rounded-full"
          onClick={() => navigate('/')}
        >
          <LogOut size={14} className="text-[#F47174]" aria-hidden />
        </IconButton>
      </div>
    </header>
  );
}

/** Connection state as a pill next to the room name. */
function LiveBadge() {
  const status = useRoomStore((s) => s.status);
  const peers = useRoomStore((s) => Object.keys(s.users).length);
  const live = status === 'connected';
  const label = live
    ? ENV.useMock
      ? 'Local demo'
      : 'Live'
    : status === 'connecting'
      ? 'Connecting'
      : 'Offline';
  return (
    <span
      className={cn(
        'flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
        live
          ? 'bg-[#4ADE80]/10 text-[#7EE2A0]'
          : status === 'connecting'
            ? 'bg-[#FACC15]/10 text-[#F5D565]'
            : 'bg-[#F14C4C]/10 text-[#F47174]',
      )}
    >
      <span
        aria-hidden
        className={cn('h-1.5 w-1.5 rounded-full bg-current', live && 'animate-pulse-dot')}
      />
      {label}
      {live && peers > 0 && <span className="text-ws-muted">· {peers + 1} here</span>}
    </span>
  );
}
