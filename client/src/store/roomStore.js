import { create } from 'zustand';
import { DEFAULT_ROOM_SETTINGS } from '@/services/collab/events';

// Live room state (not persisted). High-frequency data such as remote cursor positions
// never goes through React: it flows from the collab service straight into the
// RemoteCursors manager. Only low-frequency presence lives here.

const RUN_HISTORY = 20;
const OUTPUT_CAP = 64 * 1024;

const initialState = {
  roomId: null,
  status: 'idle', // idle | connecting | connected | disconnected | pending (asked to join) | denied
  statusError: null, // { message, code } with 'denied'
  roomName: null, // from the server
  access: { members: [], requests: [] }, // owner only: who has access and who is waiting
  shell: { enabled: false, cwd: '', running: null, serverDirs: [] }, // the terminal's real shell
  live: false, // the room's Go Live server is on
  github: undefined, // the last push { repo, branch, url, commitUrl, pushedAt, by, files }; null: never; undefined: no GitHub on this server
  scmChanges: [], // Source Control: [{ path, id, status: 'M' | 'A' | 'D' }] since the last push
  settings: DEFAULT_ROOM_SETTINGS, // what the owner allows (services/collab/events.js)
  self: null,
  users: {}, // userId -> User (excluding self)
  nodes: {}, // id -> { id, name, type, parentId }
  openTabs: [],
  activeFileId: null,
  dirty: {}, // fileId -> true when you edited it since the server last saved the room
  expanded: {},
  renamingId: null, // the file or folder whose name is being edited in the explorer
  followUserId: null,
  run: { active: null, pending: false, last: null },
  runs: [], // [{ runId, username, path, output: [{ stream, text }], exitCode, durationMs }]
  chat: [],
  unreadChat: 0,
  cursor: { lineNumber: 1, column: 1, selected: 0 },
  symbol: null,
};

export const useRoomStore = create((set, get) => ({
  ...initialState,

  reset: (roomId = null) => set({ ...initialState, roomId }),

  setStatus: (status, statusError = null) => set({ status, statusError }),
  setRoomName: (roomName) => set({ roomName }),
  setAccess: (access) => set({ access }),
  setShell: (patch) => set((s) => ({ shell: { ...s.shell, ...patch } })),
  setLive: (live) => set({ live }),
  setGithub: (github) => set({ github }),
  setScmChanges: (scmChanges) => set({ scmChanges }),
  setSettings: (settings) => set({ settings: { ...DEFAULT_ROOM_SETTINGS, ...settings } }),
  setSelf: (self) => set({ self }),
  patchSelf: (patch) => set((s) => (s.self ? { self: { ...s.self, ...patch } } : {})),

  setUsers: (list) => set({ users: Object.fromEntries(list.map((u) => [u.userId, u])) }),
  upsertUser: (user) =>
    set((s) => {
      if (s.self && user.userId === s.self.userId) return { self: { ...s.self, ...user } };
      return { users: { ...s.users, [user.userId]: { ...(s.users[user.userId] || {}), ...user } } };
    }),
  removeUser: (userId) =>
    set((s) => {
      if (!s.users[userId]) return {};
      const users = { ...s.users };
      delete users[userId];
      return { users, followUserId: s.followUserId === userId ? null : s.followUserId };
    }),

  setNodes: (nodes) =>
    set((s) => {
      const openTabs = s.openTabs.filter((id) => nodes[id]);
      const activeFileId = nodes[s.activeFileId]
        ? s.activeFileId
        : openTabs[openTabs.length - 1] || null;
      const dirty = Object.fromEntries(Object.entries(s.dirty).filter(([id]) => nodes[id]));
      return { nodes, openTabs, activeFileId, dirty };
    }),

  openFile: (fileId) =>
    set((s) => {
      if (!s.nodes[fileId] || s.nodes[fileId].type !== 'file') return {};
      // Reveal the file in the tree.
      const expanded = { ...s.expanded };
      let parent = s.nodes[fileId].parentId;
      while (parent) {
        expanded[parent] = true;
        parent = s.nodes[parent]?.parentId;
      }
      return {
        activeFileId: fileId,
        openTabs: s.openTabs.includes(fileId) ? s.openTabs : [...s.openTabs, fileId],
        expanded,
      };
    }),
  closeTab: (fileId) =>
    set((s) => {
      const idx = s.openTabs.indexOf(fileId);
      if (idx === -1) return {};
      const openTabs = s.openTabs.filter((id) => id !== fileId);
      const activeFileId =
        s.activeFileId === fileId
          ? openTabs[Math.min(idx, openTabs.length - 1)] || null
          : s.activeFileId;
      return { openTabs, activeFileId };
    }),
  setDirty: (fileId, dirty) =>
    set((s) => {
      const next = { ...s.dirty };
      if (dirty) next[fileId] = true;
      else delete next[fileId];
      return { dirty: next };
    }),
  clearDirty: () => set((s) => (Object.keys(s.dirty).length ? { dirty: {} } : {})),
  toggleFolder: (id) => set((s) => ({ expanded: { ...s.expanded, [id]: !s.expanded[id] } })),
  collapseAll: () => set({ expanded: {} }),
  setRenaming: (renamingId) => set({ renamingId }),

  toggleFollow: (userId) =>
    set((s) => ({ followUserId: s.followUserId === userId ? null : userId })),
  stopFollowing: () => set((s) => (s.followUserId ? { followUserId: null } : {})),

  setCursor: (cursor, symbol) => set({ cursor, symbol }),

  /* -------------------------------------------------------------- runs */

  setRunPending: (pending) => set((s) => ({ run: { ...s.run, pending } })),
  runStarted: (info) =>
    set((s) => ({
      run: { ...s.run, active: info, pending: false },
      runs: [
        ...s.runs.filter((r) => r.runId !== info.runId),
        { ...info, output: [], size: 0, exitCode: undefined },
      ].slice(-RUN_HISTORY),
    })),
  runOutput: ({ runId, stream, chunk }) =>
    set((s) => ({
      runs: s.runs.map((r) => {
        if (r.runId !== runId || r.size >= OUTPUT_CAP) return r;
        const text = String(chunk).slice(0, OUTPUT_CAP - r.size);
        return { ...r, size: r.size + text.length, output: [...r.output, { stream, text }] };
      }),
    })),
  runFinished: (result) =>
    set((s) => {
      const known = s.runs.find((r) => r.runId === result.runId);
      const info = {
        ...(s.run.active?.runId === result.runId ? s.run.active : {}),
        ...(known || {}),
        ...result,
      };
      const runs = known
        ? s.runs.map((r) => (r.runId === result.runId ? { ...r, ...result } : r))
        : [
            ...s.runs,
            {
              ...info,
              size: 0,
              output: [
                ...(result.stdout ? [{ stream: 'stdout', text: result.stdout }] : []),
                ...(result.stderr ? [{ stream: 'stderr', text: result.stderr }] : []),
              ],
            },
          ].slice(-RUN_HISTORY);
      const active = s.run.active && s.run.active.runId !== result.runId ? s.run.active : null;
      return {
        run: {
          active,
          pending: false,
          last: { username: info.username, userId: info.userId, exitCode: result.exitCode },
        },
        runs,
      };
    }),

  /* -------------------------------------------------------------- chat */

  addChat: (msg, { unread }) =>
    set((s) => ({
      chat: [...s.chat, msg].slice(-200),
      unreadChat: unread ? s.unreadChat + 1 : s.unreadChat,
    })),
  markChatRead: () => set({ unreadChat: 0 }),

  getUser: (userId) => {
    const s = get();
    return s.self?.userId === userId ? s.self : s.users[userId] || null;
  },
}));

/** Users currently inside `fileId`, excluding self, in join order. */
export function usersInFile(users, fileId) {
  return Object.values(users).filter((u) => u.fileId === fileId);
}
