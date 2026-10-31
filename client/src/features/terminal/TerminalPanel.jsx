import { useEffect, useRef, useState } from 'react';
import { useSettingsStore, fontFamilyCss } from '@/store/settingsStore';
import { useRoomStore } from '@/store/roomStore';
import { THEME_ALIASES, THEME_LIST, terminalTheme } from '@/config/themes';
import { colorForId } from '@/config/collaborators';
import { findFileByPath, getFileText, listFiles, pathOf } from '@/services/collab/workspaceDoc';
import { getNextStdin, requestRun, setNextStdin } from '@/features/run/runActions';
import { useRoom } from '@/features/room/RoomContext';
import { CLIENT_EVENTS, canEdit, canShell } from '@/services/collab';
import Spinner from '@/components/ui/Spinner';
import { executeCommand } from './commands';
import { brightBlack, truecolor } from './ansi';
import { TerminalSession } from './TerminalSession';

const TERMINAL_FONT_SIZE = 13;

function resolveTheme(name) {
  const key = name.trim().toLowerCase();
  const id =
    THEME_ALIASES[key] || THEME_LIST.find((t) => t.id === key || t.label.toLowerCase() === key)?.id;
  return id || null;
}

/** Shared terminal (xterm.js, loaded lazily). Stays mounted while the room is open. */
export default function TerminalPanel({ visible }) {
  const { service, feed } = useRoom();
  const containerRef = useRef(null);
  const sessionRef = useRef(null);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const themeId = useSettingsStore((s) => s.themeId);
  const fontFamily = useSettingsStore((s) => s.fontFamily);

  useEffect(() => {
    let disposed = false;
    let unsubFeed = null;
    let unsubStore = null;
    let observer = null;

    Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
      import('@xterm/xterm/css/xterm.css'),
    ])
      .then(([{ Terminal }, { FitAddon }]) => {
        if (disposed) return;
        const room = () => useRoomStore.getState();
        const colorOf = (info) =>
          info.color || room().getUser(info.userId)?.color || colorForId(info.userId || '');

        const ctx = {
          print: (text) => session.print(text),
          clear: () => {
            feed.clear();
            session.clear();
          },
          run: (path) => {
            if (path == null) return requestRun({ service, feed });
            const file = findFileByPath(room().nodes, path);
            if (!file) return session.print(`run: ${path}: no such file`, 'error');
            return requestRun({ service, feed, fileId: file.id });
          },
          files: () => listFiles(room().nodes),
          readFile: (path) => {
            const file = findFileByPath(room().nodes, path);
            return file ? (getFileText(service.doc, file.id)?.toString() ?? null) : null;
          },
          users: () => {
            const { self, users, nodes } = room();
            return [self, ...Object.values(users)].filter(Boolean).map((u) => ({
              ...u,
              isSelf: u.userId === self?.userId,
              file: u.fileId && nodes[u.fileId] ? pathOf(nodes, u.fileId) : null,
            }));
          },
          whoami: () => {
            const { self, roomId } = room();
            return {
              username: self?.username || '?',
              color: self?.color,
              role: self?.role || 'connecting',
              roomId,
            };
          },
          setTheme: (name) => {
            const id = resolveTheme(name);
            const options = [...new Set(Object.keys(THEME_ALIASES))];
            if (!id) return { ok: false, options };
            useSettingsStore.getState().setSetting('themeId', id);
            return { ok: true, label: THEME_LIST.find((t) => t.id === id).label };
          },
          getStdin: getNextStdin,
          setStdin: setNextStdin,
          canShell: () => {
            const { self, settings, shell } = room();
            return canShell(self, settings, shell.enabled);
          },
          shell: (line) => service.emit(CLIENT_EVENTS.shellExec, { command: line }),
          shellHint: () => {
            const { self, settings, shell } = room();
            if (service.mode === 'mock')
              return 'real commands need the SYNQ server (offline demo).';
            if (!shell.enabled) return 'the server has terminal commands turned off.';
            if (!canEdit(self)) return "viewers can't run commands.";
            if (settings.shell === 'off') return 'the room owner turned terminal commands off.';
            return 'only the room owner can run commands here (the owner can allow editors in People).';
          },
        };

        const settings = useSettingsStore.getState();
        const session = new TerminalSession({
          Terminal,
          FitAddon,
          container: containerRef.current,
          theme: terminalTheme(settings.themeId),
          fontFamily: fontFamilyCss(settings.fontFamily),
          fontSize: TERMINAL_FONT_SIZE,
          getPrompt: () => {
            const { self, roomId, shell } = room();
            const name = self?.username || '...';
            const cwd = shell.cwd ? `:${shell.cwd}` : '';
            return `${truecolor(self?.color, name)}@${roomId}${cwd} $ `;
          },
          onCommand: (line) => executeCommand(line, ctx),
          onInterrupt: () => service.emit(CLIENT_EVENTS.shellKill),
          isSelf: (userId) => userId === room().self?.userId,
        });
        sessionRef.current = session;
        session.print(
          brightBlack(
            "SYNQ shared terminal: run commands like npm install or node app.js. Type 'help' for more. Everyone in the room sees the output.",
          ),
        );
        unsubFeed = feed.subscribe((item) => session.handleFeed(item, colorOf));
        unsubStore = useRoomStore.subscribe((state, prev) => {
          if (state.self !== prev.self || state.shell.cwd !== prev.shell.cwd)
            session.refreshPrompt();
        });
        observer = new ResizeObserver(() => session.fit());
        observer.observe(containerRef.current);
        setReady(true);
      })
      .catch((err) => {
        console.error('[synq] terminal failed to load', err);
        if (!disposed) setError('The terminal failed to load. Reload the page to retry.');
      });

    return () => {
      disposed = true;
      unsubFeed?.();
      unsubStore?.();
      observer?.disconnect();
      sessionRef.current?.dispose();
      sessionRef.current = null;
    };
  }, [service, feed]);

  useEffect(() => {
    sessionRef.current?.setAppearance({
      theme: terminalTheme(themeId),
      fontFamily: fontFamilyCss(fontFamily),
      fontSize: TERMINAL_FONT_SIZE,
    });
  }, [themeId, fontFamily, ready]);

  useEffect(() => {
    if (visible) requestAnimationFrame(() => sessionRef.current?.fit());
  }, [visible]);

  return (
    <div className="relative h-full w-full bg-ws-panel pl-5 pt-1">
      {!ready && !error && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-ws-muted">
          <Spinner size={14} /> Starting terminal...
        </div>
      )}
      {error && <p className="p-3 text-xs text-[#F14C4C]">{error}</p>}
      <div ref={containerRef} className="h-full w-full" aria-label="Shared terminal" />
    </div>
  );
}
