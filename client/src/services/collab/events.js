// Socket event contract shared by the mock and socket adapters. Payload shapes are
// documented in docs/SOCKET_EVENTS.md; keep both in sync.

/** Client -> server. */
export const CLIENT_EVENTS = Object.freeze({
  cursorMove: 'cursor:move', // { fileId, position, rel? }
  selectionChange: 'selection:change', // { fileId, range | null, rel? }
  typingStart: 'typing:start', // { fileId }
  typingStop: 'typing:stop', // { fileId }
  presenceUpdate: 'presence:update', // { fileId }
  chatSend: 'chat:send', // { text }
  runRequest: 'run:request', // { fileId, stdin? }
  setRole: 'room:setRole', // (ack) { member, role: 'owner' | 'editor' | 'viewer' }, owner only
  updateSettings: 'room:settings', // (ack) Partial<RoomSettings>, owner only
  respond: 'room:respond', // (ack) { member, accept: boolean, role? }, owner only
  removeMember: 'room:remove', // (ack) { member }, owner only
  shellExec: 'shell:exec', // { command } a real command in the room's folder
  shellKill: 'shell:kill', // stop the running command (who started it, or the owner)
  liveOpen: 'live:open', // (ack) { path } -> { url } Go Live preview address
  liveStop: 'live:stop', // (ack) stop the room's live server
  githubPush: 'github:push', // (ack) { repo, branch, isPrivate, message } -> { repo, url, commitUrl } | { error }
  shellList: 'shell:list', // (ack) { path } one level of a server-only folder (node_modules)
});

/** Server -> client (what service.on() delivers). */
export const SERVER_EVENTS = Object.freeze({
  connection: 'connection', // { status: 'connecting' | 'connected' | 'disconnected' | 'pending' | 'denied', error?, code? }
  roomJoined: 'room:joined', // { self, users }
  userJoined: 'user:joined', // User
  userUpdated: 'user:updated', // Partial<User> & { userId }
  userLeft: 'user:left', // { userId }
  cursorMove: 'cursor:move', // { userId, fileId, position, rel? }
  selectionChange: 'selection:change', // { userId, fileId, range | null, rel? }
  typingStart: 'typing:start', // { userId, fileId }
  typingStop: 'typing:stop', // { userId, fileId }
  chatMessage: 'chat:message', // { id, userId, username, color, text, at }
  runStarted: 'run:started', // { runId, userId, username, fileId, path? }
  runOutput: 'run:output', // { runId, stream: 'stdout' | 'stderr', chunk }
  runResult: 'run:result', // { runId, exitCode, durationMs, ...optional started fields, stdout?, stderr? }
  runRejected: 'run:rejected', // { reason: 'busy' | 'forbidden' | 'not-found', message, activeRun? }
  roomSaved: 'room:saved', // { savedAt, userId?, username? } (userId/username only for a manual save)
  roomSettings: 'room:settings', // RoomSettings, after the owner changed them
  roomAccess: 'room:access', // { members, requests }, to the owner only
  liveState: 'live:state', // { live, by } the room's live server started or stopped
  githubState: 'github:state', // { repo, branch, url, commitUrl, pushedAt, by, files } after a push
  shellStarted: 'shell:started', // { id, command, userId, username, color, cwd }
  shellOutput: 'shell:output', // { id, stream, chunk }
  shellExit: 'shell:exit', // { id, exitCode, durationMs, timedOut?, cancelled?, cwd, changes? }
  shellRejected: 'shell:rejected', // { message }, to the sender only
  updateRejected: 'update:rejected', // { message } when the server refused your change
});

/** Events relayed peer-to-peer as-is (the sender's userId is attached). */
export const RELAYED_EVENTS = Object.freeze([
  CLIENT_EVENTS.cursorMove,
  CLIENT_EVENTS.selectionChange,
  CLIENT_EVENTS.typingStart,
  CLIENT_EVENTS.typingStop,
]);

export const ROLES = Object.freeze({ owner: 'owner', editor: 'editor', viewer: 'viewer' });

/** What the owner allows in a room (set in the People panel). */
export const DEFAULT_ROOM_SETTINGS = Object.freeze({
  approval: true,
  newMembers: 'editor',
  ownerOnlyFiles: false,
  ownerOnlyRun: false,
  shell: 'owner', // who may run terminal commands: 'owner' | 'editors' | 'off'
});

export const isOwner = (user) => user?.role === ROLES.owner;
export const canEdit = (user) => !!user && user.role !== ROLES.viewer;
export const canManageFiles = (user, settings) =>
  canEdit(user) && (isOwner(user) || !settings?.ownerOnlyFiles);
/** May this user run real terminal commands (the server has a shell, and the owner allows it)? */
export const canShell = (user, settings, enabled) =>
  !!enabled &&
  canEdit(user) &&
  settings?.shell !== 'off' &&
  (isOwner(user) || settings?.shell === 'editors');
export const canRun = (user, settings) =>
  canEdit(user) && (isOwner(user) || !settings?.ownerOnlyRun);
