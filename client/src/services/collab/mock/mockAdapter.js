import * as Y from 'yjs';
import { nanoid } from 'nanoid';
import { LIMITS, STORAGE_KEYS } from '@/config/app';
import { pickFreeColor } from '@/config/collaborators';
import { LANGUAGE_LABELS, MOCK_RUNNABLE, languageForName } from '@/config/languages';
import { local } from '@/lib/storage';
import { CLIENT_EVENTS, RELAYED_EVENTS, ROLES, SERVER_EVENTS } from '../events';
import { getFileText, getNodes, pathOf } from '../workspaceDoc';
import { createBotHost } from './bots';
import { runJavaScript } from './jsRunner';

// Mock "server" that runs inside every tab. Tabs of the same room talk over a
// BroadcastChannel, so two tabs on one machine behave exactly like two collaborators:
// Yjs document sync, presence, cursors, chat and shared run output.
//
// Envelope on the channel: { type, from, payload }
//   hello / here / presence   upsert a user (here = reply to hello, carries doc state)
//   heartbeat / bye           liveness
//   yjs                       incremental Yjs update
//   event                     { event, data } relayed collab event (cursor, chat, run:*)

const REMOTE = Symbol('mock-remote');
const docKey = (roomId) => `${STORAGE_KEYS.mockPrefix}doc:${roomId}`;

const toBase64 = (bytes) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const fromBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** Restore a room saved by a previous session in this browser. */
export function loadPersistedDoc(roomId, doc) {
  const saved = local.get(docKey(roomId));
  if (typeof saved !== 'string') return false;
  try {
    Y.applyUpdate(doc, fromBase64(saved), REMOTE);
    return true;
  } catch {
    local.remove(docKey(roomId));
    return false;
  }
}

const defaultChannel = (name) => new BroadcastChannel(name);

export function createMockAdapter({
  roomId,
  user,
  doc,
  dispatch,
  role: forcedRole = null,
  simulateBots = true,
  runner = runJavaScript,
  createChannel = defaultChannel,
  joinWindowMs = 300,
  heartbeatMs = 2000,
  peerTimeoutMs = 7000,
  persist = true,
}) {
  const self = {
    userId: user.userId,
    username: user.username,
    color: user.color,
    role: forcedRole,
    fileId: null,
    joinedAt: Date.now(),
    isBot: false,
  };
  const peers = new Map(); // userId -> { user, lastSeen }
  let channel = null;
  let joined = false;
  let connected = false;
  let botsEnabled = simulateBots;
  let botHost = null;
  let activeRun = null;
  let currentJob = null;
  let heartbeat = null;
  let joinTimer = null;
  let persistTimer = null;

  const post = (type, payload, from = self.userId) => {
    if (!connected || !channel) return;
    try {
      channel.postMessage({ type, from, payload });
    } catch (err) {
      console.warn('[synq mock] postMessage failed', err);
    }
  };

  const publicSelf = () => ({ ...self });
  const users = () => [...peers.values()].map((p) => p.user);

  /* ------------------------------------------------------------ peers */

  const upsertPeer = (incoming) => {
    if (!incoming?.userId || incoming.userId === self.userId) return;
    const existing = peers.get(incoming.userId);
    const merged = { ...(existing?.user || {}), ...incoming };
    peers.set(incoming.userId, { user: merged, lastSeen: Date.now() });
    if (!joined) return;
    dispatch(existing ? SERVER_EVENTS.userUpdated : SERVER_EVENTS.userJoined, merged);
    if (!existing) electBotHost();
  };

  const removePeer = (userId) => {
    const entry = peers.get(userId);
    if (!entry) return;
    peers.delete(userId);
    if (joined) dispatch(SERVER_EVENTS.userLeft, { userId });
    // Bots live in their host tab: they leave with it.
    [...peers.values()]
      .filter((p) => p.user.hostId === userId)
      .forEach((p) => removePeer(p.user.userId));
    if (activeRun?.userId === userId) {
      const run = activeRun;
      activeRun = null;
      dispatch(SERVER_EVENTS.runResult, {
        ...run,
        exitCode: null,
        aborted: true,
        durationMs: Date.now() - (run.startedAt || Date.now()),
      });
    }
    electBotHost();
  };

  const touch = (userId) => {
    const entry = peers.get(userId);
    if (entry) entry.lastSeen = Date.now();
  };

  /* ---------------------------------------------------------- bot host */

  // The earliest human in the room hosts the bots, so N tabs never spawn N sets of bots.
  const isBotLeader = () => {
    const humans = [publicSelf(), ...users().filter((u) => !u.isBot)];
    humans.sort((a, b) => a.joinedAt - b.joinedAt || a.userId.localeCompare(b.userId));
    return humans[0]?.userId === self.userId;
  };

  const electBotHost = () => {
    if (!joined) return;
    const shouldHost = connected && botsEnabled && isBotLeader();
    if (shouldHost && !botHost) {
      const used = [self.color, ...users().map((u) => u.color)];
      const c1 = pickFreeColor(used, null, 'bot-grace');
      const c2 = pickFreeColor([...used, c1], null, 'bot-linus');
      botHost = createBotHost(
        {
          doc,
          getFileId: () => self.fileId,
          join: (bot) => {
            const botUser = { ...bot, hostId: self.userId, joinedAt: bot.joinedAt ?? Date.now() };
            upsertPeer(botUser);
            post('presence', { user: botUser }, bot.userId);
          },
          leave: (botId) => {
            post('bye', {}, botId);
            removePeer(botId);
          },
          send: (botId, event, data) => {
            handleEvent(botId, event, data);
            post('event', { event, data }, botId);
          },
        },
        { colors: [c1, c2] },
      );
    } else if (!shouldHost && botHost) {
      botHost.stop();
      botHost = null;
    }
  };

  /* ------------------------------------------------------------ events */

  const handleEvent = (from, event, data = {}) => {
    if (RELAYED_EVENTS.includes(event)) {
      const entry = peers.get(from);
      if (
        entry &&
        data.fileId !== undefined &&
        entry.user.fileId !== data.fileId &&
        event === CLIENT_EVENTS.cursorMove
      ) {
        upsertPeer({ userId: from, fileId: data.fileId });
      }
      dispatch(event, { ...data, userId: from });
      return;
    }
    switch (event) {
      case SERVER_EVENTS.chatMessage:
      case SERVER_EVENTS.runOutput:
        dispatch(event, data);
        break;
      case SERVER_EVENTS.runStarted:
        activeRun = data;
        dispatch(event, data);
        break;
      case SERVER_EVENTS.runResult:
        if (!activeRun || activeRun.runId === data.runId) activeRun = null;
        dispatch(event, data);
        break;
      default:
        break;
    }
  };

  /** Deliver locally and to every other tab. */
  const emitAll = (event, data) => {
    handleEvent(self.userId, event, data);
    post('event', { event, data });
  };

  const handleMessage = ({ type, from, payload = {} } = {}) => {
    if (!from || from === self.userId) return;
    switch (type) {
      case 'hello':
        if (payload.update) Y.applyUpdate(doc, new Uint8Array(payload.update), REMOTE);
        upsertPeer(payload.user);
        post('here', { user: publicSelf(), update: Y.encodeStateAsUpdate(doc), activeRun });
        botHost
          ?.users()
          .forEach((bot) => post('here', { user: { ...bot, hostId: self.userId } }, bot.userId));
        break;
      case 'here':
        if (payload.update) Y.applyUpdate(doc, new Uint8Array(payload.update), REMOTE);
        if (payload.activeRun && !activeRun) activeRun = payload.activeRun;
        upsertPeer(payload.user);
        break;
      case 'presence':
        upsertPeer(payload.user);
        break;
      case 'heartbeat':
        touch(from);
        if (!peers.has(from) && payload.user) upsertPeer(payload.user);
        break;
      case 'bye':
        removePeer(from);
        break;
      case 'yjs':
        if (payload.update) Y.applyUpdate(doc, new Uint8Array(payload.update), REMOTE);
        touch(from);
        break;
      case 'event':
        touch(from);
        handleEvent(from, payload.event, payload.data);
        break;
      default:
        break;
    }
  };

  /* --------------------------------------------------------------- run */

  const handleRunRequest = async ({ fileId, stdin = '' } = {}) => {
    if (self.role === ROLES.viewer) {
      dispatch(SERVER_EVENTS.runRejected, {
        reason: 'forbidden',
        message: "Viewers can't run code.",
      });
      return;
    }
    if (activeRun) {
      dispatch(SERVER_EVENTS.runRejected, {
        reason: 'busy',
        message: `${activeRun.username} is already running ${activeRun.path || 'a file'}.`,
        activeRun,
      });
      return;
    }
    const nodes = getNodes(doc);
    const node = nodes[fileId];
    const ytext = getFileText(doc, fileId);
    if (!node || node.type !== 'file' || !ytext) {
      dispatch(SERVER_EVENTS.runRejected, {
        reason: 'not-found',
        message: 'That file no longer exists.',
      });
      return;
    }

    const path = pathOf(nodes, fileId);
    const language = languageForName(node.name);
    const runId = `run-${nanoid(8)}`;
    emitAll(SERVER_EVENTS.runStarted, {
      runId,
      userId: self.userId,
      username: self.username,
      color: self.color,
      fileId,
      path,
      language,
      startedAt: Date.now(),
    });
    const output = (stream, chunk) =>
      connected && emitAll(SERVER_EVENTS.runOutput, { runId, stream, chunk });

    let result;
    if (MOCK_RUNNABLE.has(language)) {
      currentJob = runner({
        code: ytext.toString(),
        stdin: String(stdin).slice(0, 64 * 1024),
        path,
        onOutput: output,
      });
      result = await currentJob.promise;
      currentJob = null;
    } else {
      const label = LANGUAGE_LABELS[language] || language;
      output(
        'stdout',
        `${label} runs once the SYNQ backend is connected. Mock mode only executes JavaScript in the browser.\n`,
      );
      result = { exitCode: null, durationMs: 0, skipped: true };
    }
    if (!connected) return;
    emitAll(SERVER_EVENTS.runResult, { runId, ...result });
  };

  /* --------------------------------------------------------- lifecycle */

  const onDocUpdate = (update, origin) => {
    if (origin !== REMOTE) post('yjs', { update });
    if (!persist) return;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => saveNow(), 400);
  };

  /** Write the doc to localStorage (the mock "server disk") and report it like room:saved. */
  const saveNow = (by = null) => {
    clearTimeout(persistTimer);
    persistTimer = null;
    if (persist) local.set(docKey(roomId), toBase64(Y.encodeStateAsUpdate(doc)));
    dispatch(SERVER_EVENTS.roomSaved, { savedAt: Date.now(), ...(by || {}) });
  };

  const onPageHide = () => post('bye', {});

  return {
    connect() {
      if (connected) return;
      connected = true;
      dispatch(SERVER_EVENTS.connection, { status: 'connecting' });
      channel = createChannel(`${STORAGE_KEYS.mockPrefix}${roomId}`);
      channel.onmessage = (e) => handleMessage(e.data);
      doc.on('update', onDocUpdate);
      if (typeof window !== 'undefined') window.addEventListener('pagehide', onPageHide);

      post('hello', { user: publicSelf(), update: Y.encodeStateAsUpdate(doc) });

      joinTimer = setTimeout(() => {
        if (!connected) return;
        const humans = users().filter((u) => !u.isBot);
        self.role = forcedRole || (humans.length === 0 ? ROLES.owner : ROLES.editor);
        self.color = pickFreeColor(
          users().map((u) => u.color),
          user.color,
          self.userId,
        );
        joined = true;
        post('presence', { user: publicSelf() });
        dispatch(SERVER_EVENTS.roomJoined, { self: publicSelf(), users: users() });
        dispatch(SERVER_EVENTS.connection, { status: 'connected' });
        if (activeRun) dispatch(SERVER_EVENTS.runStarted, activeRun);

        heartbeat = setInterval(() => {
          post('heartbeat', { user: publicSelf() });
          const now = Date.now();
          users()
            .filter((u) => !u.isBot && now - peers.get(u.userId).lastSeen > peerTimeoutMs)
            .forEach((u) => removePeer(u.userId));
        }, heartbeatMs);
        electBotHost();
      }, joinWindowMs);
    },

    send(event, payload = {}) {
      if (!connected) return;
      if (RELAYED_EVENTS.includes(event)) {
        post('event', { event, data: payload });
        return;
      }
      switch (event) {
        case CLIENT_EVENTS.presenceUpdate:
          self.fileId = payload.fileId ?? null;
          post('presence', { user: publicSelf() });
          if (joined) dispatch(SERVER_EVENTS.userUpdated, publicSelf());
          break;
        case CLIENT_EVENTS.chatSend: {
          const text = String(payload.text || '')
            .trim()
            .slice(0, LIMITS.maxChatLength);
          if (!text) return;
          emitAll(SERVER_EVENTS.chatMessage, {
            id: `msg-${nanoid(8)}`,
            userId: self.userId,
            username: self.username,
            color: self.color,
            text,
            at: Date.now(),
          });
          break;
        }
        case CLIENT_EVENTS.runRequest:
          handleRunRequest(payload);
          break;
        default:
          break;
      }
    },

    save() {
      if (!connected) return Promise.resolve({ error: 'Not connected.' });
      saveNow({ userId: self.userId, username: self.username });
      return Promise.resolve({ ok: true });
    },

    setBotsEnabled(enabled) {
      botsEnabled = !!enabled;
      electBotHost();
    },

    disconnect() {
      if (!connected) return;
      botHost?.stop();
      botHost = null;
      post('bye', {});
      connected = false;
      joined = false;
      currentJob?.cancel();
      currentJob = null;
      clearTimeout(joinTimer);
      clearInterval(heartbeat);
      if (persistTimer) {
        clearTimeout(persistTimer);
        if (persist) local.set(docKey(roomId), toBase64(Y.encodeStateAsUpdate(doc)));
      }
      doc.off('update', onDocUpdate);
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', onPageHide);
      channel?.close();
      channel = null;
      peers.clear();
      dispatch(SERVER_EVENTS.connection, { status: 'disconnected' });
    },
  };
}
