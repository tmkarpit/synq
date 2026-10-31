import { useCallback, useEffect, useState } from 'react';
import { Check, ExternalLink, Github, MoreHorizontal, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { CLIENT_EVENTS } from '@/services/collab';
import { useRoomStore } from '@/store/roomStore';
import { useRoom } from '@/features/room/RoomContext';
import Spinner from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { FileIcon } from './FileIcon';
import GitHubDialog from './GitHubDialog';

const STATUS = {
  M: { label: 'Modified', className: 'text-[#E2C08D]' },
  A: { label: 'Added', className: 'text-[#73C991]' },
  D: { label: 'Deleted', className: 'text-[#F14C4C]' },
};

const ago = (at) => {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(at).toLocaleDateString();
};

/**
 * Source Control, like VS Code's: the files changed since the last push to GitHub, a
 * commit message and "Commit & Push". The comparison is with the last push from this room
 * (by anyone), so everyone sees the same changes.
 */
export default function SourceControlView() {
  const { service } = useRoom();
  const roomId = useRoomStore((s) => s.roomId);
  const github = useRoomStore((s) => s.github);
  const changes = useRoomStore((s) => s.scmChanges);
  const viewer = useRoomStore((s) => s.self?.role === 'viewer');
  const [account, setAccount] = useState(null); // { connected, login } | null while loading
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(false);
  const [menu, setMenu] = useState(false);

  const loadAccount = useCallback(
    () =>
      api('/api/github')
        .then(setAccount)
        .catch(() => setAccount({ connected: false, login: null })),
    [],
  );
  useEffect(() => {
    loadAccount();
  }, [loadAccount]);

  const push = async () => {
    if (!account?.connected) return setDialog(true);
    setBusy(true);
    setError('');
    const res = await service.request(CLIENT_EVENTS.githubPush, {
      repo: github.repo,
      branch: github.branch,
      message: message.trim(),
    });
    setBusy(false);
    if (res.error) {
      setError(res.error);
      if (/Connect (your )?GitHub/.test(res.error)) setAccount({ connected: false, login: null });
      return undefined;
    }
    setMessage('');
    toast.success(`Pushed to ${res.repo}`, {
      description: `${res.files} file${res.files === 1 ? '' : 's'} on ${res.branch}`,
      action: {
        label: 'View commit',
        onClick: () => window.open(res.commitUrl, '_blank', 'noopener,noreferrer'),
      },
    });
    return undefined;
  };

  const openFile = (id) => id && useRoomStore.getState().openFile(id);
  const canPush = !viewer && changes.length > 0 && !busy;

  return (
    <div className="flex h-full flex-col">
      {dialog && (
        <GitHubDialog
          service={service}
          roomId={roomId}
          onClose={() => {
            setDialog(false);
            loadAccount();
          }}
        />
      )}
      <div className="ws-section-title justify-between pr-2">
        <h2>Source Control</h2>
        <div className="relative flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => loadAccount()}
            aria-label="Refresh"
            title="Refresh"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ws-muted hover:bg-ws-hover hover:text-ws-text"
          >
            <RefreshCw size={14} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setMenu((v) => !v)}
            onBlur={() => setTimeout(() => setMenu(false), 150)}
            aria-haspopup="menu"
            aria-expanded={menu}
            aria-label="Source Control actions"
            title="More actions..."
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ws-muted hover:bg-ws-hover hover:text-ws-text"
          >
            <MoreHorizontal size={16} aria-hidden />
          </button>
          {menu && (
            <ul
              role="menu"
              className="absolute right-0 top-7 z-30 w-60 rounded-chrome border border-ws-border bg-ws-widget py-1 shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
            >
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    setDialog(true);
                  }}
                  className="flex h-[26px] w-full items-center gap-2 px-3 text-left text-[13px] text-ws-text hover:bg-ws-accent hover:text-white"
                >
                  <Github size={14} aria-hidden />
                  {github ? 'Push to Another Repository...' : 'Publish to GitHub...'}
                </button>
              </li>
              {github?.url && (
                <li role="none">
                  <a
                    role="menuitem"
                    href={github.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setMenu(false)}
                    className="flex h-[26px] w-full items-center gap-2 px-3 text-left text-[13px] text-ws-text hover:bg-ws-accent hover:text-white"
                  >
                    <ExternalLink size={14} aria-hidden /> Open Repository on GitHub
                  </a>
                </li>
              )}
            </ul>
          )}
        </div>
      </div>

      {!github && (
        <div className="space-y-3 px-4 py-2 text-[12.5px] leading-relaxed text-ws-muted">
          <p>
            This room isn&apos;t on GitHub yet. Publish it to a new or existing repository; after
            that, every change shows up here, ready to commit and push.
          </p>
          <button
            type="button"
            onClick={() => setDialog(true)}
            className="inline-flex h-8 w-full items-center justify-center gap-2 rounded-md bg-ws-accent text-[13px] font-medium text-white hover:brightness-110"
          >
            <Github size={15} aria-hidden /> Publish to GitHub
          </button>
        </div>
      )}

      {github && (
        <>
          <div className="space-y-2 px-3 pb-2">
            <a
              href={github.url || `https://github.com/${github.repo}`}
              target="_blank"
              rel="noopener noreferrer"
              title="Open on GitHub"
              className="flex items-center gap-1.5 truncate rounded-md px-1 text-[12px] text-ws-muted hover:text-ws-text"
            >
              <Github size={13} className="shrink-0" aria-hidden />
              <span className="truncate">{github.repo}</span>
              <span className="shrink-0 rounded bg-ws-hover px-1.5 font-mono text-[11px]">
                {github.branch}
              </span>
            </a>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canPush) {
                  e.preventDefault();
                  push();
                }
              }}
              rows={2}
              disabled={viewer}
              placeholder="Message (Ctrl+Enter to commit)"
              aria-label="Commit message"
              className="w-full resize-y rounded-md border border-ws-border bg-ws-canvas px-2.5 py-1.5 text-[13px] text-ws-text outline-none placeholder:text-ws-muted focus:border-ws-accent disabled:opacity-50"
            />
            {account && !account.connected && !viewer ? (
              <button
                type="button"
                onClick={() => setDialog(true)}
                className="inline-flex h-8 w-full items-center justify-center gap-2 rounded-md bg-ws-accent text-[13px] font-medium text-white hover:brightness-110"
              >
                <Github size={15} aria-hidden /> Connect GitHub to Push
              </button>
            ) : (
              <button
                type="button"
                onClick={push}
                disabled={!canPush}
                title={
                  viewer
                    ? "Viewers can't push"
                    : changes.length
                      ? undefined
                      : 'Nothing changed since the last push'
                }
                className="inline-flex h-8 w-full items-center justify-center gap-2 rounded-md bg-ws-accent text-[13px] font-medium text-white hover:brightness-110 disabled:opacity-50"
              >
                {busy ? <Spinner size={14} /> : <Check size={15} aria-hidden />}
                {busy ? 'Pushing...' : 'Commit & Push'}
              </button>
            )}
            {error && <p className="text-[12px] text-red-400">{error}</p>}
          </div>

          <div className="flex h-6 shrink-0 items-center justify-between px-3 text-[11px] font-semibold uppercase tracking-wide text-ws-muted">
            <span>Changes</span>
            {!!changes.length && (
              <span className="rounded-full bg-ws-hover px-1.5 text-[10px] font-semibold text-ws-text">
                {changes.length}
              </span>
            )}
          </div>
          <ul aria-label="Changes" className="ws-scroll min-h-0 flex-1 overflow-y-auto pb-2">
            {!changes.length && (
              <li className="px-4 py-1 text-[12px] text-ws-muted">
                No changes since the last push.
              </li>
            )}
            {changes.map(({ path, id, status }) => {
              const slash = path.lastIndexOf('/');
              const name = path.slice(slash + 1);
              const dir = slash > 0 ? path.slice(0, slash) : '';
              return (
                <li key={path}>
                  <button
                    type="button"
                    onClick={() => openFile(id)}
                    disabled={!id}
                    title={`${path} (${STATUS[status].label})`}
                    className="flex h-[24px] w-full items-center gap-1.5 px-3 text-left text-[13px] hover:bg-ws-hover disabled:cursor-default"
                  >
                    <FileIcon name={name} size={15} />
                    <span className={cn('truncate', status === 'D' && 'line-through opacity-70')}>
                      {name}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-ws-muted">
                      {dir}
                    </span>
                    <span
                      className={cn(
                        'w-3 shrink-0 text-center font-mono text-[12px] font-semibold',
                        STATUS[status].className,
                      )}
                    >
                      {status}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {github.pushedAt && (
            <p className="shrink-0 border-t border-ws-border px-3 py-1.5 text-[11.5px] text-ws-muted">
              Last push {ago(github.pushedAt)}
              {github.by ? ` by ${github.by}` : ''}
              {github.commitUrl && (
                <>
                  {' · '}
                  <a
                    href={github.commitUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-ws-text hover:underline"
                  >
                    view commit
                  </a>
                </>
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}
