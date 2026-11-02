import http from 'node:http';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import * as Y from 'yjs';
import { RoomRegistry } from './rooms.js';
import { FileStore } from './db/fileStore.js';
import { allFileRows, contentHash, pathOf } from './projectFiles.js';
import { runFile } from './runner.js';
import { detectLanguages, languageLabel, languageOfFile } from './languages.js';
import { accessList, accountMember, applySettings, changesStructure, cleanRoomName, isAccountMember, memberHash, roleFor } from './permissions.js';
import { createAccountRoutes } from './accounts.js';
import { LiveServer } from './live.js';
import { GitHubError } from './github.js';
import { restoreTree, snapshotTree, treeUpdateError } from './tree.js';
import { createStaticHandler } from './static.js';
import { Buckets, NEW_ROOM_LIMIT } from './limits.js';

// Implements docs/SOCKET_EVENTS.md. One Socket.IO room per SYNQ room.

const PALETTE = ['#22D3EE', '#A78BFA', '#FB923C', '#4ADE80', '#F472B6', '#FACC15'];
const RELAYED = ['cursor:move', 'selection:change', 'typing:start', 'typing:stop'];
const MAX_CHAT = 2000;
const MAX_UPDATE_BYTES = 2 * 1024 * 1024;
const NAME_PATTERN = /^[\p{L}\p{N} _.-]{2,24}$/u;

/** Event payloads come from clients: anything that is not a plain object reads as {}. */
const asObject = (data) => (data && typeof data === 'object' && !Array.isArray(data) ? data : {});

const lineOrColumn = (v) => (Number.isInteger(v) && v > 0 && v < 10_000_000 ? v : null);
const position = (lineNumber, column) => (lineOrColumn(lineNumber) && lineOrColumn(column) ? { lineNumber, column } : null);
/** Y.encodeRelativePosition() bytes, as sent by the client (docs/SOCKET_EVENTS.md). */
const relBytes = (r) => (Array.isArray(r) && r.length <= 64 && r.every((b) => Number.isInteger(b) && b >= 0 && b < 256) ? r : null);

/**
 * Cursor, selection and typing events are relayed to the whole room, so only the
 * documented fields go out, checked and small; anything else a client adds is dropped.
 */
function relayPayload(event, data) {
  if (typeof data.fileId !== 'string' || !data.fileId || data.fileId.length > 64) return null;
  const { fileId } = data;
  if (event === 'cursor:move') {
    const p = position(data.position?.lineNumber, data.position?.column);
    if (!p) return null;
    const rel = relBytes(data.rel);
    return { fileId, position: p, ...(rel ? { rel } : {}) };
  }
  if (event === 'selection:change') {
    if (data.range == null) return { fileId, range: null };
    const r = data.range;
    const start = position(r.startLineNumber, r.startColumn);
    const end = position(r.endLineNumber, r.endColumn);
    if (!start || !end) return null;
    const range = { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column };
    const relStart = relBytes(data.rel?.start);
    const relEnd = relBytes(data.rel?.end);
    return { fileId, range, ...(relStart && relEnd ? { rel: { start: relStart, end: relEnd } } : {}) };
  }
  return { fileId }; // typing:start / typing:stop
}

function pickColor(used, preferred) {
  const taken = new Set(used.map((c) => c?.toUpperCase()));
  if (preferred && PALETTE.includes(preferred.toUpperCase()) && !taken.has(preferred.toUpperCase())) return preferred.toUpperCase();
  return PALETTE.find((c) => !taken.has(c)) || PALETTE[taken.size % PALETTE.length];
}

/** Non-internal IPv4 addresses, so the client can build an invite link that works on the LAN. */
export function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

/**
 * store: db/mongoStore.js or db/fileStore.js (default: files in dataDir). It is
 * initialized by listen().
 * accounts: accounts.js. When set, every socket must be signed in and members are
 * accounts; without it a member is a browser (memberKey).
 * languages: map from languages.js (detected toolchains). Pass a subset to restrict.
 * shell: shell.js. When set, terminal commands run in a folder per room (who may is a
 * room setting); without it the terminal only has its built-in commands.
 * staticDir: the built client to serve (one origin for site, API and sockets).
 * trustProxy: proxies in front of the server (config.js clientIp).
 * production: hides details (open rooms, LAN addresses) from public endpoints.
 */
export function createSynqServer({ dataDir, store = new FileStore({ dataDir }), accounts = null, github = null, shell = null, corsOrigin = true, runEnabled = true, languages = detectLanguages(), runner = runFile, staticDir = null, trustProxy = 0, production = false } = {}) {
  let io = null;
  // Every save (debounced autosave or a manual room:save) tells the room, so clients can
  // clear their "unsaved" markers.
  const rooms = new RoomRegistry({
    store,
    onSaved: (room, by) => io?.to(room.id).emit('room:saved', { savedAt: Date.now(), ...(by || {}) }),
    onChange: (room) => live.changed(room),
  });
  // "Go Live": previews of the room's HTML at /live/<token>/... that reload on every change.
  const live = new LiveServer({ getRoom: (id) => rooms.get(id), releaseRoom: (room) => rooms.release(room), shell });

  // corsOrigin: true (any), false (same origin only), a list, or a function (config.js).
  const isAllowed = (origin) =>
    typeof corsOrigin === 'function' ? corsOrigin(origin) : Array.isArray(corsOrigin) ? corsOrigin.includes(origin) : corsOrigin === true;
  const allowOrigin = (origin, callback) => callback(null, !origin || isAllowed(origin));

  const accountRoutes = accounts ? createAccountRoutes(accounts, github, { trustProxy }) : null;
  const site = staticDir ? createStaticHandler(staticDir, { hsts: production }) : null;
  if (staticDir && !site) console.warn(`[synq] STATIC_DIR has no index.html (${staticDir}); run "npm run build" in client/.`);

  const httpServer = http.createServer(async (req, res) => {
    // CORS for the API when the site is on another origin (CLIENT_ORIGINS, config.js).
    const origin = req.headers.origin;
    if (origin && req.url.startsWith('/api/') && isAllowed(origin)) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('access-control-allow-credentials', 'true');
      res.setHeader('vary', 'Origin');
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
          'access-control-allow-headers': 'content-type, authorization',
          'access-control-max-age': '600',
        });
        res.end();
        return;
      }
    }
    if (await live.handle(req, res)) return;
    if (accountRoutes && (await accountRoutes(req, res))) return;
    // /health: the process is up (Render's health check; never waits for the database, so a
    // slow database does not get the service restarted). /health/ready: the database answers.
    const route = req.url.split('?')[0];
    if (req.method === 'GET' && (route === '/api/health' || route === '/health')) {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(production ? { ok: true } : { ok: true, rooms: rooms.rooms.size }));
      return;
    }
    if (req.method === 'GET' && route === '/health/ready') {
      const ready = await Promise.race([
        store.ping().then(() => true, () => false),
        new Promise((r) => setTimeout(() => r(false), 3000).unref()),
      ]);
      res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: ready, database: ready ? 'up' : 'down' }));
      return;
    }
    if (req.method === 'GET' && req.url === '/api/lan') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ addresses: production ? [] : lanAddresses() }));
      return;
    }
    if (req.method === 'GET' && req.url === '/api/runtimes') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          enabled: runEnabled,
          languages: Object.entries(languages).map(([id, l]) => ({ id, label: l.label, tool: l.tool, sandboxed: l.kind !== 'native' })),
        }),
      );
      return;
    }
    if (site && site(req, res)) return;
    res.writeHead(404).end();
  });

  io = new Server(httpServer, {
    cors: { origin: allowOrigin, credentials: true },
    maxHttpBufferSize: MAX_UPDATE_BYTES,
  });

  const publicUser = (u) => ({
    userId: u.userId,
    username: u.username,
    color: u.color,
    role: u.role,
    fileId: u.fileId,
    joinedAt: u.joinedAt,
  });

  // member -> Buckets: how many new rooms each person may create (limits.js).
  const roomCreators = new Map();
  const mayCreateRoom = (member) => {
    if (!roomCreators.has(member)) roomCreators.set(member, new Buckets(NEW_ROOM_LIMIT));
    if (roomCreators.size > 50_000) roomCreators.clear(); // a bound on memory, not a security limit
    return roomCreators.get(member).take('newRoom');
  };

  // Sockets waiting for the owner to answer a join request: "roomId|member" -> Set<socket>.
  const waiting = new Map();
  const waitKey = (roomId, member) => `${roomId}|${member}`;
  const notifyWaiting = (roomId, member, event, data) => {
    waiting.get(waitKey(roomId, member))?.forEach((s) => s.emit(event, data));
    waiting.delete(waitKey(roomId, member));
  };

  /** Sends the member and request lists to every owner tab in the room. */
  const sendAccess = (room) => {
    const online = new Set([...room.users.values()].map((u) => u.member));
    const list = accessList(room.meta, online);
    room.users.forEach((u) => u.role === 'owner' && io.to(u.socketId).emit('room:access', list));
  };

  /** Re-reads the roles of one member's tabs after the owner changed something. */
  const refreshRoles = (room, member) => {
    room.users.forEach((u) => {
      if (u.member !== member) return;
      const next = roleFor(room.meta, member);
      if (!next) {
        // Removed: tell that tab, then drop the connection.
        io.to(u.socketId).emit('room:removed', { message: 'The owner removed you from this room.' });
        io.in(u.socketId).disconnectSockets(true);
      } else if (u.role !== next) {
        u.role = next;
        io.to(room.id).emit('user:updated', publicUser(u));
      }
    });
  };

  /** Why this user may not run terminal commands in this room, or null when they may. */
  const shellDenied = (room, user) => {
    if (!shell) return 'Terminal commands are turned off on this server (SHELL_ENABLED=false).';
    if (user.role === 'viewer') return "Viewers can't run terminal commands.";
    const who = room.meta.settings.shell;
    if (who === 'off') return 'The room owner turned off terminal commands.';
    if (who === 'owner' && user.role !== 'owner') return 'Only the room owner can run terminal commands here. The owner can allow editors in People.';
    return null;
  };

  /** Runs one terminal command for the room and syncs the files it changed. */
  const runShell = async (room, user, command) => {
    const id = `sh-${randomUUID().slice(0, 8)}`;
    const info = { id, command, userId: user.userId, username: user.username, color: user.color, cwd: room.shellCwd, startedAt: Date.now() };
    const emitOutput = (stream, chunk) => io.to(room.id).emit('shell:output', { id, stream, chunk });
    room.shellJob = { ...info, job: null };
    io.to(room.id).emit('shell:started', info);
    try {
      const before = await shell.materialize(room.id, room.doc);
      const cd = /^cd(?:\s+(.+))?$/i.exec(command);
      if (cd) {
        // Each command is its own process, so the server keeps the current folder.
        const target = (cd[1] || '').trim().replace(/^["']|["']$/g, '');
        const next = target ? shell.resolveCd(room.id, room.shellCwd, target) : '';
        if (next === null) emitOutput('stderr', 'cd: that folder is outside this project\n');
        else if (next === undefined) emitOutput('stderr', `cd: ${target}: no such folder\n`);
        else room.shellCwd = next;
        io.to(room.id).emit('shell:exit', { id, exitCode: next == null ? 1 : 0, durationMs: 0, cwd: room.shellCwd });
        return;
      }
      if (room.shellCwd && shell.resolveCd(room.id, '', room.shellCwd) !== room.shellCwd) room.shellCwd = ''; // folder is gone
      // A bare `npm install` in a project without package.json: set one up first, like
      // starting a new project, instead of failing with npm's ENOENT error.
      let toRun = command;
      if (/^npm\s+(i|install)\s*$/i.test(command) && !shell.hasFile(room.id, room.shellCwd, 'package.json')) {
        emitOutput('stdout', 'No package.json here yet, so SYNQ is creating one first (npm init -y).\n');
        toRun = `npm init -y --silent; ${command}`;
      }
      const job = shell.exec({ roomId: room.id, cwd: room.shellCwd, command: toRun, onOutput: emitOutput });
      room.shellJob.job = job;
      // Everyone left while the files were being written: stop it right away.
      if (!room.users.size) job.cancel();
      const result = await job.promise;
      if (result.exitCode !== 0 && /^npm\s+ci\s*$/i.test(command) && !shell.hasFile(room.id, room.shellCwd, 'package.json')) {
        // npm leaves an empty package-lock.json behind; it would only confuse.
        shell.removeFile(room.id, room.shellCwd, 'package-lock.json');
        emitOutput(
          'stderr',
          '\nThere is no package.json in this folder, so npm has nothing to install.\n' +
            'Run "npm install" (SYNQ creates one for you), or install a package by name, e.g. "npm install express".\n',
        );
      }
      const stateVector = Y.encodeStateVector(room.doc);
      const changes = await shell.importChanges(room.id, room.doc, before);
      room.serverDirs = changes.hidden;
      const update = Y.encodeStateAsUpdate(room.doc, stateVector);
      if (update.length > 2) io.to(room.id).emit('yjs:update', { update });
      io.to(room.id).emit('shell:exit', { id, ...result, cwd: room.shellCwd, changes });
    } catch (err) {
      console.error(`[synq] shell command failed in ${room.id}:`, err.message);
      emitOutput('stderr', `The command could not run: ${err.message}\n`);
      io.to(room.id).emit('shell:exit', { id, exitCode: 1, durationMs: Date.now() - info.startedAt, cwd: room.shellCwd });
    } finally {
      room.shellJob = null;
    }
  };

  const startRun = (room, user, { fileId, stdin = '' } = {}) => {
    const reject = (reason, message) => io.to(user.socketId).emit('run:rejected', { reason, message, activeRun: room.activeRun || undefined });
    if (user.role === 'viewer') return reject('forbidden', "Viewers can't run code.");
    if (room.meta.settings.ownerOnlyRun && user.role !== 'owner') return reject('forbidden', 'Only the room owner can run code in this room.');
    if (room.activeRun) return reject('busy', `${room.activeRun.username} is already running ${room.activeRun.path}.`);
    const nodes = room.doc.getMap('nodes');
    const node = nodes.get(fileId);
    const text = room.doc.getMap('texts').get(fileId);
    if (!node || node.type !== 'file' || !text) return reject('not-found', 'That file no longer exists.');

    const path = pathOf(nodes, fileId);
    const langId = languageOfFile(node.name);
    const lang = langId ? languages[langId] : null;
    const run = {
      runId: `run-${randomUUID().slice(0, 8)}`,
      userId: user.userId,
      username: user.username,
      color: user.color,
      fileId,
      path,
      startedAt: Date.now(),
    };
    room.activeRun = run;
    io.to(room.id).emit('run:started', run);

    const finish = (result) => {
      room.activeRun = null;
      room.job = null;
      io.to(room.id).emit('run:result', { runId: run.runId, ...result });
    };

    if (!runEnabled || !lang) {
      const runnable = Object.values(languages).map((l) => l.label).join(', ');
      const why = !runEnabled
        ? 'Running code is turned off on this deployment.'
        : langId
          ? `${languageLabel(langId)} is not available on this server (its compiler/runtime is not installed or not enabled). Runnable here: ${runnable}.`
          : `Files like ${node.name} can't be run. Runnable here: ${runnable}.`;
      io.to(room.id).emit('run:output', { runId: run.runId, stream: 'stdout', chunk: `${why}\n` });
      finish({ exitCode: null, durationMs: 0, skipped: true });
      return undefined;
    }

    room.job = runner({
      lang,
      name: node.name,
      code: text.toString(),
      stdin: String(stdin),
      onOutput: (stream, chunk) => io.to(room.id).emit('run:output', { runId: run.runId, stream, chunk }),
    });
    room.job.promise.then(finish);
    return undefined;
  };

  // With accounts, the handshake carries the JWT access token: { auth: { token } }. When
  // it is missing or expired this fails with "unauthorized"; the client refreshes the
  // token and reconnects.
  if (accounts) {
    io.use((socket, next) => {
      const account = accounts.verifyAccess(socket.handshake.auth?.token);
      if (!account) return next(Object.assign(new Error('unauthorized'), { data: { code: 'unauthorized' } }));
      socket.data.account = account;
      return next();
    });
  }

  io.on('connection', (socket) => {
    let room = null;
    let user = null;
    const limits = new Buckets(); // per connection (limits.js)

    socket.on('room:join', async (raw, ack = () => {}) => {
      if (typeof ack !== 'function') return;
      if (!limits.take('join')) return ack({ error: 'Too many attempts. Wait a minute and try again.' });
      const payload = asObject(raw);
      const roomId = String(payload.roomId || '');
      const account = socket.data.account;
      const username = account ? account.name : String(payload.username || '').trim();
      if (!NAME_PATTERN.test(username)) return ack({ error: 'Invalid username.' });
      let target;
      try {
        target = await rooms.get(roomId); // may load from the database
      } catch (err) {
        console.error(`[synq] could not load ${roomId}:`, err.message);
        return ack({ error: 'The server could not load this room. Try again.' });
      }
      if (!target) return ack({ error: 'Invalid room ID.' });
      if (shell && !target.serverDirs) target.serverDirs = await shell.serverDirs(target.id);
      const { meta } = target;
      const member = account ? accountMember(account.id) : memberHash(payload.memberKey);

      // The first person in a room without an owner becomes its owner (with accounts, a
      // room owned by a browser from before accounts is claimed by the first account).
      if (!meta.owner || (accounts && !isAccountMember(meta.owner))) {
        if (!meta.owner && !mayCreateRoom(member)) {
          rooms.release(target);
          return ack({ error: "You've created a lot of rooms in the last hour. Try again later, or open one of your rooms." });
        }
        meta.owner = member;
        meta.name ??= cleanRoomName(payload.roomName);
        meta.members[member] = { name: username, role: 'editor' };
        delete meta.requests[member];
        await rooms.saveMeta(target);
      }

      let role = roleFor(meta, member);
      if (!role && !meta.settings.approval) {
        role = payload.role === 'viewer' ? 'viewer' : meta.settings.newMembers;
        meta.members[member] = { name: username, role };
        await rooms.saveMeta(target);
      }
      if (!role) {
        // Ask the owner. This socket waits for room:admitted or room:declined.
        meta.requests[member] = {
          name: username,
          email: account?.email ?? null,
          role: payload.role === 'viewer' ? 'viewer' : meta.settings.newMembers,
          at: meta.requests[member]?.at || Date.now(),
        };
        await rooms.saveMeta(target);
        const key = waitKey(target.id, member);
        if (!waiting.has(key)) waiting.set(key, new Set());
        waiting.get(key).add(socket);
        socket.data.waiting = key;
        sendAccess(target);
        rooms.release(target);
        return ack({ pending: true, room: { name: meta.name } });
      }
      // Keep the member list current (owners of older rooms may be missing from it).
      if (meta.members[member]?.name !== username) {
        meta.members[member] = { name: username, role: meta.members[member]?.role ?? 'editor' };
        await rooms.saveMeta(target);
      }
      if (!socket.connected) return rooms.release(target);
      if (room) leave(); // re-join (e.g. after reconnect on the same socket)

      room = target;
      const others = [...room.users.values()];
      user = {
        userId: `u-${randomUUID().slice(0, 10)}`,
        socketId: socket.id,
        username,
        color: pickColor(others.map((u) => u.color), payload.color),
        member,
        role,
        fileId: null,
        joinedAt: Date.now(),
      };
      room.users.set(user.userId, user);
      socket.join(room.id);
      socket.to(room.id).emit('user:joined', publicUser(user));

      ack({
        self: publicUser(user),
        users: others.map(publicUser),
        state: Y.encodeStateAsUpdate(room.doc),
        stateVector: Y.encodeStateVector(room.doc),
        activeRun: room.activeRun || undefined,
        settings: room.meta.settings,
        room: { name: room.meta.name },
        shell: {
          enabled: !!shell,
          cwd: room.shellCwd,
          running: room.shellJob ? { ...room.shellJob, job: undefined } : undefined,
          serverDirs: room.serverDirs,
        },
        live: live.isLive(room.id),
        github: github ? room.meta.github : undefined,
      });
      sendAccess(room);
      return undefined;
    });

    socket.on('yjs:update', (data) => {
      const { update } = asObject(data);
      if (!room || !user || user.role === 'viewer' || !update) return;
      try {
        const bytes = new Uint8Array(update);
        if (!limits.take('updateBytes', bytes.length)) {
          console.warn(`[synq] ${user.username} sent too much data; disconnecting`);
          socket.disconnect(true);
          return;
        }
        const refused =
          treeUpdateError(room.doc, bytes) ||
          (room.meta.settings.ownerOnlyFiles && user.role !== 'owner' && changesStructure(room.doc, bytes)
            ? 'Only the room owner can create or delete files in this room.'
            : null);
        if (refused) {
          // Apply, then undo the tree part, and send the result to everyone (see snapshotTree).
          const snapshot = snapshotTree(room.doc);
          const stateVector = Y.encodeStateVector(room.doc);
          Y.applyUpdate(room.doc, bytes, socket.id);
          restoreTree(room.doc, snapshot);
          io.to(room.id).emit('yjs:update', { update: Y.encodeStateAsUpdate(room.doc, stateVector) });
          socket.emit('update:rejected', { message: refused });
          return;
        }
        Y.applyUpdate(room.doc, bytes, socket.id);
        socket.to(room.id).emit('yjs:update', { update: bytes });
      } catch (err) {
        console.warn(`[synq] bad update from ${user.username}:`, err.message);
      }
    });

    socket.on('presence:update', (data) => {
      const { fileId = null } = asObject(data);
      if (!room || !user || !limits.take('relay')) return;
      user.fileId = typeof fileId === 'string' ? fileId.slice(0, 64) : null;
      io.to(room.id).emit('user:updated', publicUser(user));
    });

    RELAYED.forEach((event) =>
      socket.on(event, (raw) => {
        if (!room || !user || !limits.take('relay')) return;
        const data = relayPayload(event, asObject(raw));
        if (!data) return;
        if (event === 'cursor:move' && data.fileId !== user.fileId) {
          user.fileId = data.fileId;
          socket.to(room.id).emit('user:updated', publicUser(user));
        }
        socket.to(room.id).emit(event, { ...data, userId: user.userId });
      }),
    );

    socket.on('chat:send', (data) => {
      const { text } = asObject(data);
      if (!room || !user || !limits.take('chat')) return;
      const clean = String(text || '').trim().slice(0, MAX_CHAT);
      if (!clean) return;
      io.to(room.id).emit('chat:message', {
        id: `msg-${randomUUID().slice(0, 8)}`,
        userId: user.userId,
        username: user.username,
        color: user.color,
        text: clean,
        at: Date.now(),
      });
    });

    // Save now instead of waiting for the debounce. Socket.IO keeps per-socket order, so
    // every yjs:update this client sent before is already applied.
    socket.on('room:save', async (_payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (!room || !user) return reply({ error: 'Not in a room.' });
      const ok = await rooms.save(room, { userId: user.userId, username: user.username });
      return reply(ok ? { ok: true } : { error: 'The server could not save the room.' });
    });

    // Owner only. Each handler checks the role first; members are addressed by the
    // `member` ids from room:access.
    const ownerOnly = (handler) => async (data, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (!room || !user) return reply({ error: 'Not in a room.' });
      if (user.role !== 'owner') return reply({ error: 'Only the room owner can do that.' });
      const error = await handler(asObject(data));
      if (error) return reply({ error });
      if (!(await rooms.saveMeta(room))) return reply({ error: 'The server could not save the change.' });
      sendAccess(room);
      return reply({ ok: true, settings: room.meta.settings });
    };

    // Set someone's role ('editor' | 'viewer'), or hand over ownership ('owner').
    socket.on(
      'room:setRole',
      ownerOnly(({ member, role }) => {
        const { meta } = room;
        if (!meta.members[member]) return 'That person is not a member of this room.';
        if (!['owner', 'editor', 'viewer'].includes(role)) return 'Unknown role.';
        if (member === meta.owner) return 'Hand over ownership to someone else first.';
        const previousOwner = meta.owner;
        if (role === 'owner') {
          meta.owner = member;
          meta.members[previousOwner] = { name: meta.members[previousOwner]?.name || user.username, role: 'editor' };
        } else {
          meta.members[member].role = role;
        }
        refreshRoles(room, member);
        refreshRoles(room, previousOwner);
        return null;
      }),
    );

    // Accept or decline a join request.
    socket.on(
      'room:respond',
      ownerOnly(({ member, accept, role }) => {
        const { meta } = room;
        const request = meta.requests[member];
        if (!request) return 'That request is no longer waiting.';
        delete meta.requests[member];
        if (accept) {
          meta.members[member] = { name: request.name, role: role === 'viewer' || role === 'editor' ? role : request.role };
          notifyWaiting(room.id, member, 'room:admitted', {});
        } else {
          notifyWaiting(room.id, member, 'room:declined', { message: 'The owner declined your request to join this room.' });
        }
        return null;
      }),
    );

    // Take away someone's access. Their open tabs are disconnected; they can ask again.
    socket.on(
      'room:remove',
      ownerOnly(({ member }) => {
        const { meta } = room;
        if (member === meta.owner) return "The owner can't be removed.";
        if (!meta.members[member]) return 'That person is not a member of this room.';
        delete meta.members[member];
        refreshRoles(room, member);
        return null;
      }),
    );

    // Owner only: change the room's permissions. Everyone gets the new settings.
    socket.on(
      'room:settings',
      ownerOnly((patch) => {
        room.meta.settings = applySettings(room.meta.settings, patch);
        io.to(room.id).emit('room:settings', room.meta.settings);
        return null;
      }),
    );

    socket.on('run:request', (data) => {
      if (!room || !user) return;
      // A run refused as "busy" (startRun) costs nothing; only runs that would start count.
      if (!room.activeRun && !limits.take('run')) {
        socket.emit('run:rejected', { reason: 'busy', message: 'Too many runs in a row. Wait a few seconds.' });
        return;
      }
      startRun(room, user, asObject(data));
    });

    socket.on('shell:exec', (data) => {
      const { command } = asObject(data);
      if (!room || !user) return;
      const line = String(command || '').trim().slice(0, 4000);
      if (!line) return;
      if (!limits.take('shell')) return socket.emit('shell:rejected', { message: 'Too many commands in a row. Wait a few seconds.' });
      const denied = shellDenied(room, user);
      if (denied) return socket.emit('shell:rejected', { message: denied });
      if (room.shellJob) {
        return socket.emit('shell:rejected', {
          message: `${room.shellJob.username} is running "${room.shellJob.command}". Wait for it to finish, or stop it with Ctrl+C.`,
        });
      }
      runShell(room, user, line);
    });

    // Go Live: the preview address of a file (anyone in the room may open it).
    socket.on('live:open', (data, ack) => {
      const { path: filePath } = asObject(data);
      const reply = typeof ack === 'function' ? ack : () => {};
      if (!room || !user) return reply({ error: 'Not in a room.' });
      const nodes = room.doc.getMap('nodes');
      let found = null;
      nodes.forEach((node, id) => {
        if (node.type === 'file' && pathOf(nodes, id) === String(filePath || '')) found = pathOf(nodes, id);
      });
      if (!found) return reply({ error: 'That file no longer exists.' });
      const wasLive = live.isLive(room.id);
      const url = live.urlFor(room.id, found);
      if (!wasLive) io.to(room.id).emit('live:state', { live: true, by: user.username });
      return reply({ url });
    });

    // Stop the room's live server (like clicking "Port : 5500" in VS Code).
    socket.on('live:stop', (_data, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (!room || !user) return reply({ error: 'Not in a room.' });
      if (user.role === 'viewer') return reply({ error: "Viewers can't stop the live server." });
      if (live.stop(room.id)) io.to(room.id).emit('live:state', { live: false, by: user.username });
      return reply({ ok: true });
    });

    // Push to GitHub: the room's files as one commit to the user's own repository (the
    // token is on their account, never in the room). The room remembers the repository.
    socket.on('github:push', async (data, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (!room || !user) return reply({ error: 'Not in a room.' });
      if (!github || !socket.data.account) return reply({ error: 'Log in to push to GitHub.' });
      const { repo, isPrivate, branch, message } = asObject(data);
      const files = allFileRows(room.doc)
        .filter((f) => f.path && !f.path.split('/').includes('node_modules'))
        .map(({ path: p, content }) => ({ path: p, content }));
      try {
        const result = await github.push(socket.data.account.id, { repo, isPrivate: isPrivate !== false, branch, message, files });
        if (user.role !== 'viewer') {
          room.meta.github = {
            repo: result.repo,
            branch: result.branch,
            url: result.url,
            commitUrl: result.commitUrl,
            pushedAt: Date.now(),
            by: user.username,
            files: files.map((f) => [f.path, contentHash(f.content)]),
          };
          await rooms.saveMeta(room);
          // Everyone's Source Control view now compares with this push.
          io.to(room.id).emit('github:state', room.meta.github);
        }
        return reply(result);
      } catch (err) {
        if (!(err instanceof GitHubError)) console.error('[synq] GitHub push failed:', err.message);
        return reply({ error: err instanceof GitHubError ? err.message : 'The push failed. Try again.' });
      }
    });

    // The file tree lists server-only folders (node_modules) one level at a time.
    socket.on('shell:list', async (data, ack) => {
      const { path: rel } = asObject(data);
      const reply = typeof ack === 'function' ? ack : () => {};
      if (!room || !user || !shell) return reply({ error: 'Not available.' });
      return reply(await shell.listServerDir(room.id, rel));
    });

    // Ctrl+C: the person who started the command, or the owner, can stop it.
    socket.on('shell:kill', () => {
      const job = room?.shellJob;
      if (!job || !user) return;
      if (user.role !== 'owner' && job.userId !== user.userId) {
        socket.emit('shell:rejected', { message: `Only ${job.username} or the room owner can stop this command.` });
        return;
      }
      job.job?.cancel();
    });

    function leave() {
      if (!room || !user) return;
      room.users.delete(user.userId);
      if (!room.users.size) {
        // Nobody is left to see the output: stop the terminal command and the run.
        room.shellJob?.job?.cancel();
        room.job?.cancel();
      }
      socket.leave(room.id);
      io.to(room.id).emit('user:left', { userId: user.userId });
      sendAccess(room);
      rooms.release(room);
      room = null;
      user = null;
    }
    socket.on('disconnect', () => {
      leave();
      const key = socket.data.waiting;
      waiting.get(key)?.delete(socket);
      if (waiting.get(key)?.size === 0) waiting.delete(key);
    });
  });

  return {
    io,
    httpServer,
    rooms,
    store,
    /** Prepares the store (tables, import), then listens. Resolves the address. */
    async listen(port, host) {
      this.imported = await store.init();
      return new Promise((resolve) => httpServer.listen(port, host, () => resolve(httpServer.address())));
    },
    async close() {
      live.close();
      rooms.rooms.forEach((r) => r.job?.cancel());
      await new Promise((resolve) => io.close(() => resolve()));
      await rooms.flushAll();
      await store.close();
    },
  };
}
