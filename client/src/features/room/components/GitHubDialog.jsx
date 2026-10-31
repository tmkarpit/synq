import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Github, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { CLIENT_EVENTS } from '@/services/collab';
import { useRoomStore } from '@/store/roomStore';
import Spinner from '@/components/ui/Spinner';

const TOKEN_PAGE = 'https://github.com/settings/tokens/new?scopes=repo&description=SYNQ';

const field =
  'h-8 w-full rounded-md border border-ws-border bg-ws-canvas px-2.5 text-[13px] text-ws-text outline-none placeholder:text-ws-muted focus:border-ws-accent';
const primary =
  'inline-flex h-8 items-center justify-center gap-2 rounded-md bg-ws-accent px-3 text-[13px] font-medium text-white hover:brightness-110 disabled:opacity-50';
const secondary =
  'inline-flex h-8 items-center justify-center rounded-md px-3 text-[13px] text-ws-muted hover:bg-ws-hover hover:text-ws-text';

/** A room name like "synq-ab12-cd34" or "My Site" as a repository name. */
const repoName = (name) =>
  String(name || '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);

/**
 * "Push to GitHub": connect a personal access token once (kept encrypted on the account),
 * then push the room's files as one commit to a repository, created if needed.
 */
export default function GitHubDialog({ service, roomId, onClose }) {
  const remembered = useRoomStore((s) => s.github);
  const roomName = useRoomStore((s) => s.roomName);
  const [status, setStatus] = useState(null); // { connected, login } | null while loading
  const [token, setToken] = useState('');
  const [repo, setRepo] = useState(remembered?.repo || repoName(roomName || roomId));
  const [branch, setBranch] = useState(remembered?.branch || '');
  const [isPrivate, setIsPrivate] = useState(true);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const panelRef = useRef(null);

  useEffect(() => {
    api('/api/github')
      .then(setStatus)
      .catch((err) => {
        setStatus({ connected: false, login: null });
        setError(err.message);
      });
  }, []);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  useEffect(() => {
    panelRef.current?.querySelector('input')?.focus();
  }, [status?.connected]);

  const connect = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { login } = await api('/api/github/token', { method: 'POST', body: { token } });
      setToken('');
      setStatus({ connected: true, login });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError('');
    try {
      await api('/api/github/token', { method: 'DELETE' });
      setStatus({ connected: false, login: null });
      setResult(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const push = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setResult(null);
    const res = await service.request(CLIENT_EVENTS.githubPush, {
      repo: repo.trim(),
      branch: branch.trim(),
      isPrivate,
      message: message.trim(),
    });
    setBusy(false);
    if (res.error) {
      setError(res.error);
      if (/Connect (your )?GitHub/.test(res.error)) setStatus({ connected: false, login: null });
      return;
    }
    setResult(res); // the server tells the room (github:state), which updates Source Control
    toast.success(`Pushed to ${res.repo}`, {
      description: `${res.files} file${res.files === 1 ? '' : 's'} on ${res.branch}`,
    });
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/50 px-4 pt-[12vh]"
      onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gh-title"
        className="w-full max-w-md rounded-chrome border border-ws-border bg-ws-widget p-5 text-ws-text shadow-[0_16px_48px_rgba(0,0,0,0.6)]"
      >
        <div className="mb-4 flex items-center gap-2">
          <Github size={18} aria-hidden />
          <h2 id="gh-title" className="flex-1 text-[15px] font-semibold">
            Push to GitHub
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-ws-muted hover:bg-ws-hover hover:text-ws-text"
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        {!status && (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        )}

        {status && !status.connected && (
          <form onSubmit={connect} className="space-y-3">
            <p className="text-[13px] leading-relaxed text-ws-muted">
              Connect your GitHub account once with a personal access token.{' '}
              <a
                href={TOKEN_PAGE}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-ws-accent hover:underline"
              >
                Create a token <ExternalLink size={12} aria-hidden />
              </a>{' '}
              with the <b className="text-ws-text">repo</b> permission and paste it here. It is
              kept encrypted on your account and never shown again.
            </p>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ghp_..."
              autoComplete="off"
              spellCheck={false}
              aria-label="GitHub personal access token"
              className={`${field} font-mono`}
            />
            {error && <p className="text-[12.5px] text-red-400">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className={secondary}>
                Cancel
              </button>
              <button type="submit" disabled={busy || !token.trim()} className={primary}>
                {busy && <Spinner size={14} />} Connect
              </button>
            </div>
          </form>
        )}

        {status?.connected && (
          <form onSubmit={push} className="space-y-3">
            <div className="flex items-center justify-between rounded-md bg-ws-canvas px-3 py-2 text-[12.5px]">
              <span className="text-ws-muted">
                Connected as <b className="text-ws-text">@{status.login}</b>
              </span>
              <button
                type="button"
                onClick={disconnect}
                disabled={busy}
                className="text-ws-muted hover:text-red-400"
              >
                Disconnect
              </button>
            </div>

            <label className="block space-y-1">
              <span className="text-[12px] text-ws-muted">Repository</span>
              <input
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="my-project or owner/my-project"
                spellCheck={false}
                required
                className={field}
              />
            </label>
            <div className="flex gap-3">
              <label className="block flex-1 space-y-1">
                <span className="text-[12px] text-ws-muted">Branch</span>
                <input
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="default branch"
                  spellCheck={false}
                  className={field}
                />
              </label>
              <label className="flex items-end gap-2 pb-2 text-[12.5px] text-ws-muted">
                <input
                  type="checkbox"
                  checked={isPrivate}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                  className="accent-[var(--ws-accent)]"
                />
                Private if new
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-[12px] text-ws-muted">Commit message</span>
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Update from SYNQ"
                className={field}
              />
            </label>
            <p className="text-[12px] leading-relaxed text-ws-muted">
              Pushes the room&apos;s files as they are now in one commit. A repository that
              doesn&apos;t exist yet is created. Files deleted here are deleted on GitHub too.
            </p>

            {error && <p className="text-[12.5px] text-red-400">{error}</p>}
            {result && (
              <div className="space-y-1 rounded-md border border-ws-accent-line bg-ws-accent-soft px-3 py-2 text-[12.5px]">
                <p>
                  {result.created ? 'Created and pushed' : 'Pushed'} {result.files} file
                  {result.files === 1 ? '' : 's'} to <b>{result.repo}</b> ({result.branch}).
                </p>
                <p className="flex gap-4">
                  <a
                    href={result.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-ws-text hover:underline"
                  >
                    Open repository <ExternalLink size={12} aria-hidden />
                  </a>
                  <a
                    href={result.commitUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-ws-text hover:underline"
                  >
                    View commit <ExternalLink size={12} aria-hidden />
                  </a>
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} disabled={busy} className={secondary}>
                {result ? 'Done' : 'Cancel'}
              </button>
              <button type="submit" disabled={busy || !repo.trim()} className={primary}>
                {busy && <Spinner size={14} />} Push
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
