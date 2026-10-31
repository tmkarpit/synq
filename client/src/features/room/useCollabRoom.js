import { useEffect, useState } from 'react';
import { STORAGE_KEYS } from '@/config/app';
import { local } from '@/lib/storage';
import { nanoid } from 'nanoid';
import { toast } from 'sonner';
import { useUserStore } from '@/store/userStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useRoomStore } from '@/store/roomStore';
import { useUiStore } from '@/store/uiStore';
import { createCollabService, SERVER_EVENTS } from '@/services/collab';
import { getNodes, listFiles, nodesMap } from '@/services/collab/workspaceDoc';
import { createTerminalFeed } from '@/features/terminal/terminalFeed';
import { resetRunActions } from '@/features/run/runActions';
import { useAuthStore } from '@/store/authStore';
import { CLIENT_EVENTS } from '@/services/collab/events';
import { markAllSaved } from './saveActions';

/**
 * Connects to a room for the lifetime of the component and mirrors low-frequency
 * collab state into the room store. Returns { service, feed } once created.
 *
 * ?role=viewer joins as a read-only viewer (invite links can carry it).
 */
export function useCollabRoom(roomId, { roomName = null } = {}) {
  const [room, setRoom] = useState(null);

  useEffect(() => {
    const store = useRoomStore.getState();
    const tabsKey = `${STORAGE_KEYS.tabsPrefix}${roomId}`;
    store.reset(roomId);

    const { username, color } = useUserStore.getState();
    const memberKey = local.get(STORAGE_KEYS.memberKey) || nanoid(24);
    local.set(STORAGE_KEYS.memberKey, memberKey);
    const query = new URLSearchParams(window.location.search);
    const role = query.get('role') === 'viewer' ? 'viewer' : null;
    // A fresh id per page load: two tabs (even duplicated ones) are two collaborators.
    const service = createCollabService({
      roomId,
      user: { userId: `u-${nanoid(10)}`, username, color, memberKey },
      role,
      roomName,
      simulateBots: useSettingsStore.getState().simulateCollaborators,
    });
    const feed = createTerminalFeed();
    const s = () => useRoomStore.getState();

    const offs = [
      service.on(SERVER_EVENTS.connection, ({ status, error, code, room }) => {
        s().setStatus(status, status === 'denied' ? { message: error, code } : null);
        if (room?.name) s().setRoomName(room.name);
        if (code === 'unauthorized') useAuthStore.getState().clearSession();
      }),
      service.on(SERVER_EVENTS.roomJoined, ({ self, users, settings, room, shell, live, github }) => {
        s().setSelf(self);
        s().setLive(!!live);
        s().setGithub(github === undefined ? undefined : github || null);
        if (shell) {
          s().setShell({
            enabled: shell.enabled,
            cwd: shell.cwd || '',
            running: shell.running || null,
            serverDirs: shell.serverDirs || [],
          });
          if (shell.running) feed.push('shell:started', shell.running);
        }
        s().setSettings(settings);
        if (room?.name) s().setRoomName(room.name);
        s().setUsers(users.filter((u) => u.userId !== self.userId));
        if (!s().activeFileId) {
          // Reopen the tabs this browser had in this room (refresh), else the first file.
          const nodes = s().nodes;
          const saved = local.get(tabsKey, null);
          const tabs = (saved?.openTabs || []).filter((id) => nodes[id]?.type === 'file');
          tabs.forEach((id) => s().openFile(id));
          if (tabs.length)
            s().openFile(
              tabs.includes(saved.activeFileId) ? saved.activeFileId : tabs[tabs.length - 1],
            );
          else if (listFiles(nodes).length) s().openFile(listFiles(nodes)[0].id);
        }
      }),
      service.on(SERVER_EVENTS.userJoined, (u) => s().upsertUser(u)),
      service.on(SERVER_EVENTS.userUpdated, (u) => s().upsertUser(u)),
      service.on(SERVER_EVENTS.userLeft, ({ userId }) => s().removeUser(userId)),
      service.on(SERVER_EVENTS.runStarted, (info) => {
        s().runStarted(info);
        feed.push('run:started', info);
      }),
      service.on(SERVER_EVENTS.runOutput, (data) => {
        s().runOutput(data);
        feed.push('run:output', data);
      }),
      service.on(SERVER_EVENTS.runResult, (result) => {
        s().runFinished(result);
        feed.push('run:result', result);
      }),
      service.on(SERVER_EVENTS.runRejected, ({ message }) => {
        s().setRunPending(false);
        feed.push('notice', { text: message || 'The run was refused.', tone: 'warn' });
      }),
      service.on(SERVER_EVENTS.roomSaved, () => markAllSaved()),
      service.on(SERVER_EVENTS.roomSettings, (settings) => s().setSettings(settings)),
      service.on(SERVER_EVENTS.updateRejected, ({ message }) => toast.error(message)),
      service.on(SERVER_EVENTS.shellStarted, (info) => {
        s().setShell({ running: info });
        feed.push('shell:started', info);
      }),
      service.on(SERVER_EVENTS.liveState, ({ live }) => s().setLive(!!live)),
      service.on(SERVER_EVENTS.githubState, (github) => s().setGithub(github)),
      service.on(SERVER_EVENTS.shellOutput, (data) => feed.push('shell:output', data)),
      service.on(SERVER_EVENTS.shellExit, (result) => {
        s().setShell({
          running: null,
          cwd: result.cwd ?? s().shell.cwd,
          serverDirs: result.changes?.hidden ?? s().shell.serverDirs,
        });
        feed.push('shell:exit', result);
      }),
      service.on(SERVER_EVENTS.shellRejected, ({ message }) =>
        feed.push('notice', { text: message, tone: 'warn' }),
      ),
      service.on(SERVER_EVENTS.roomAccess, (access) => {
        // A toast for each new request, so the owner can answer from anywhere.
        const known = new Set(s().access.requests.map((r) => r.member));
        access.requests
          .filter((r) => !known.has(r.member))
          .forEach((r) => {
            const answer = (accept) =>
              service
                .request(CLIENT_EVENTS.respond, { member: r.member, accept })
                .then((res) => res.error && toast.error(res.error));
            toast(`${r.name} wants to join`, {
              id: `request-${r.member}`,
              description: r.email || `As ${r.role === 'viewer' ? 'a viewer' : 'an editor'}`,
              duration: 30000,
              action: { label: 'Accept', onClick: () => answer(true) },
              cancel: { label: 'Decline', onClick: () => answer(false) },
            });
          });
        // Requests answered elsewhere (another owner tab) close their toast.
        const waiting = new Set(access.requests.map((r) => r.member));
        known.forEach((member) => !waiting.has(member) && toast.dismiss(`request-${member}`));
        s().setAccess(access);
      }),
      service.on(SERVER_EVENTS.chatMessage, (msg) => {
        const { sidebarOpen, sidebarView } = useUiStore.getState();
        const unread = msg.userId !== s().self?.userId && !(sidebarOpen && sidebarView === 'chat');
        s().addChat(msg, { unread });
      }),
    ];

    const nodes = nodesMap(service.doc);
    const syncNodes = () => s().setNodes(getNodes(service.doc));
    nodes.observe(syncNodes);

    const offTabs = useRoomStore.subscribe((next, prev) => {
      if (
        !next.self ||
        (next.openTabs === prev.openTabs && next.activeFileId === prev.activeFileId)
      )
        return;
      local.set(tabsKey, { openTabs: next.openTabs, activeFileId: next.activeFileId });
    });

    const offSettings = useSettingsStore.subscribe((next, prev) => {
      if (next.simulateCollaborators !== prev.simulateCollaborators)
        service.setBotsEnabled(next.simulateCollaborators);
    });

    let disposed = false;
    service.connect().then(
      () => !disposed && syncNodes(),
      (err) => {
        console.error('[synq] could not connect', err);
        if (!disposed) s().setStatus('disconnected');
      },
    );
    setRoom({ service, feed });

    return () => {
      disposed = true;
      offs.forEach((off) => off());
      offSettings();
      offTabs();
      nodes.unobserve(syncNodes);
      service.disconnect();
      // Join-request pop-ups belong to this room.
      useRoomStore.getState().access.requests.forEach((r) => toast.dismiss(`request-${r.member}`));
      resetRunActions();
      useRoomStore.getState().reset();
      setRoom(null);
    };
    // roomName only matters for the first join of a new room, so it does not reconnect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  return room;
}
