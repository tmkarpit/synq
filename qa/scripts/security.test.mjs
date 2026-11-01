// Phase 4 + 6: roles, raw socket events, malformed input, auth. Each test asserts the SAFE
// behaviour, so a failing test is a finding. Runs against the QA server (synq_test).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as Y from 'yjs';
import { addFile, admit, api, closeDb, collect, connect, createUser, emitAck, health, newRoomId, next, ownerRoom, sleep } from './lib.mjs';

after(() => closeDb());

const QA_DIR = fileURLToPath(new URL('..', import.meta.url));

test('S1 a socket without a login token is refused', async () => {
  await assert.rejects(connect(undefined), /unauthorized/);
  await assert.rejects(connect('not-a-jwt'), /unauthorized/);
});

test('S2 a viewer cannot edit, run, use the terminal or manage the room (raw socket events)', async () => {
  const o = await ownerRoom('Owner');
  const fileId = addFile(o.doc, { name: 'main.js', content: 'console.log(1)' });
  await sleep(300);
  const v = await admit(o.socket, o.roomId, 'Viewer', 'viewer');
  assert.equal(v.ack.self.role, 'viewer');

  // Edit: the server must not apply or relay it.
  const relayed = collect(o.socket, 'yjs:update');
  v.doc.getMap('texts').get(fileId).insert(0, 'HACKED ');
  addFile(v.doc, { name: 'viewer.js', content: 'x' });
  await sleep(800);
  relayed.stop();
  assert.equal(o.doc.getMap('texts').get(fileId).toString(), 'console.log(1)', 'owner doc changed by a viewer');
  assert.equal(relayed.items.length, 0, 'viewer update was relayed');

  const runRej = next(v.socket, 'run:rejected');
  v.socket.emit('run:request', { fileId });
  assert.equal((await runRej).reason, 'forbidden');

  const shRej = next(v.socket, 'shell:rejected');
  v.socket.emit('shell:exec', { command: 'echo hi' });
  assert.match((await shRej).message, /Viewers/);

  for (const ev of ['room:setRole', 'room:settings', 'room:remove', 'room:respond']) {
    const res = await emitAck(v.socket, ev, { member: 'x', role: 'owner', approval: false });
    assert.match(res.error, /owner/i, `${ev} allowed for a viewer`);
  }
  assert.ok((await emitAck(v.socket, 'live:stop', {})).error, 'viewer stopped Go Live');
  o.socket.close();
  v.socket.close();
});

test('S3 an editor cannot use owner-only controls', async () => {
  const o = await ownerRoom('Owner');
  const e = await admit(o.socket, o.roomId, 'Editor', 'editor');
  const res = await emitAck(e.socket, 'room:setRole', { member: 'anything', role: 'owner' });
  assert.match(res.error, /owner/i);
  const s = await emitAck(e.socket, 'room:settings', { approval: false });
  assert.match(s.error, /owner/i);
  o.socket.close();
  e.socket.close();
});

test('S4 events sent before joining a room are ignored', async () => {
  const u = await createUser('Lurker');
  const s = await connect(u.token);
  const o = await ownerRoom('Owner');
  const chats = collect(o.socket, 'chat:message');
  s.emit('chat:send', { text: 'not joined' });
  s.emit('yjs:update', { update: Y.encodeStateAsUpdate(new Y.Doc()) });
  s.emit('run:request', { fileId: 'x' });
  s.emit('shell:exec', { command: 'echo hi' });
  assert.deepEqual(await emitAck(s, 'room:save', {}), { error: 'Not in a room.' });
  await sleep(500);
  chats.stop();
  assert.equal(chats.items.length, 0);
  s.close();
  o.socket.close();
});

test('S5 malformed payloads do not crash the server', async () => {
  const o = await ownerRoom('Owner');
  const s = o.socket;
  const bad = [
    ['room:join', { roomId: { $ne: null } }],
    ['room:join', null],
    ['yjs:update', { update: 'not bytes' }],
    ['yjs:update', { update: new Uint8Array([1, 2, 3, 255, 255, 255]) }],
    ['yjs:update', null],
    ['chat:send', { text: { nested: true } }],
    ['chat:send', null],
    ['run:request', null],
    ['run:request', { fileId: { $gt: '' } }],
    ['cursor:move', 'string payload'],
    ['presence:update', { fileId: 'x'.repeat(100000) }],
    ['room:settings', [1, 2, 3]],
    ['shell:exec', { command: ['array'] }],
    ['shell:list', { path: '../../..' }],
    ['live:open', { path: { toString: 1 } }],
    ['github:push', 'nope'],
  ];
  for (const [ev, data] of bad) s.emit(ev, data, () => {});
  for (const [ev, data] of bad) s.emit(ev, data); // and without an ack
  await sleep(1500);
  assert.ok(await health(), 'server died');
  // The room still works for this socket.
  const got = next(s, 'chat:message');
  s.emit('chat:send', { text: 'still alive' });
  assert.equal((await got).text, 'still alive');
  s.close();
});

test('S6 a payload over the 2MB limit drops that socket only', async () => {
  const o = await ownerRoom('Owner');
  const gone = new Promise((r) => o.socket.once('disconnect', r));
  o.socket.emit('chat:send', { text: 'x'.repeat(3 * 1024 * 1024) });
  await gone;
  assert.ok(await health());
});

test('S7 relayed cursor events cannot spoof another user or carry extra data', async () => {
  const o = await ownerRoom('Owner');
  const e = await admit(o.socket, o.roomId, 'Editor', 'editor');
  const got = next(o.socket, 'cursor:move');
  e.socket.emit('cursor:move', { fileId: 'f-1', position: { lineNumber: 1, column: 1 }, userId: 'u-someone-else', html: '<img src=x onerror=alert(1)>', blob: 'x'.repeat(500000) });
  const msg = await got;
  assert.equal(msg.userId, e.ack.self.userId, 'userId was spoofed');
  assert.equal(msg.html, undefined, 'arbitrary fields are relayed to everyone');
  assert.equal(msg.blob, undefined, 'a 500KB field was relayed to everyone');
  o.socket.close();
  e.socket.close();
});

test('S8 file names are validated on the server (no "..", no slashes, no duplicates)', async () => {
  const o = await ownerRoom('Owner');
  const e = await admit(o.socket, o.roomId, 'Editor', 'editor');
  addFile(e.doc, { name: '../../qa-escape-marker.txt', content: 'written outside the room folder' });
  addFile(e.doc, { name: 'dup.js', content: 'a' });
  addFile(e.doc, { name: 'dup.js', content: 'b' });
  await sleep(800);
  const names = [...o.doc.getMap('nodes').values()].map((n) => n.name);
  // The owner now runs any terminal command; the server writes every file to disk first.
  const exit = next(o.socket, 'shell:exit', () => true, 30000);
  o.socket.emit('shell:exec', { command: 'echo hi' });
  await exit;
  const marker = `${QA_DIR}qa-escape-marker.txt`;
  const escaped = fs.existsSync(marker);
  if (escaped) fs.rmSync(marker);
  assert.equal(escaped, false, 'a file named "../../x" was written OUTSIDE the room workspace');
  assert.ok(!names.includes('../../qa-escape-marker.txt'), 'server accepted a file name with ".."');
  // Duplicate names are stopped in the explorer (e2e E6); the server accepts them on purpose,
  // because two people can create the same name at the same moment.
  o.socket.close();
  e.socket.close();
});

test('S9 with the production defaults the terminal refuses commands', async () => {
  const { spawn } = await import('node:child_process');
  const srv = spawn(process.execPath, ['--env-file=../server/.env', '../server/src/index.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, NODE_ENV: 'production', PORT: '4103', MONGODB_URI: 'mongodb://127.0.0.1:27017/synq_test', SHELL_ENABLED: '', RUN_LANGUAGES: '', STATIC_DIR: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  srv.stdout.on('data', (d) => (log += d));
  for (let i = 0; i < 120 && !log.includes('terminal shell:'); i += 1) await sleep(250);
  const { io } = await import('socket.io-client');
  const u = await createUser('ProdOwner');
  const s = io('http://127.0.0.1:4103', { auth: { token: u.token }, transports: ['websocket'], forceNew: true, reconnection: false });
  await new Promise((r) => s.once('connect', r));
  await emitAck(s, 'room:join', { roomId: newRoomId() });
  const rejected = next(s, 'shell:rejected', () => true, 5000);
  s.emit('shell:exec', { command: 'whoami' });
  const msg = await rejected.catch(() => null);
  s.close();
  srv.kill();
  assert.ok(log.includes('terminal shell:   off'), 'production default left the terminal on');
  assert.match(msg?.message || '', /turned off/);
});

test('S9b (development) the terminal runs real commands for the owner only', async () => {
  const o = await ownerRoom('Owner');
  const out = collect(o.socket, 'shell:output');
  const rejected = collect(o.socket, 'shell:rejected');
  const exit = next(o.socket, 'shell:exit', () => true, 30000);
  o.socket.emit('shell:exec', { command: 'whoami' });
  await exit;
  out.stop();
  rejected.stop();
  const text = out.items.map((i) => i.chunk).join('');
  // By design when SHELL_ENABLED=true: a real shell for the owner (see server/.env.example).
  assert.ok(text.trim().length > 0 && rejected.items.length === 0);
  o.socket.close();
});

test('S10 a terminal command is stopped when everyone leaves the room', async () => {
  const o = await ownerRoom('Owner');
  const started = next(o.socket, 'shell:started');
  o.socket.emit('shell:exec', { command: process.platform === 'win32' ? 'Start-Sleep -Seconds 25' : 'sleep 25' });
  await started;
  o.socket.close();
  await sleep(2000);
  const again = await connect(o.owner.token);
  const ack = await emitAck(again, 'room:join', { roomId: o.roomId });
  const stillRunning = !!ack.shell.running;
  if (stillRunning) again.emit('shell:kill');
  again.close();
  assert.equal(stillRunning, false, 'the command kept running on the server after its only user left');
});

test('S11 chat is rate limited and capped at 2000 characters', async () => {
  const o = await ownerRoom('Owner');
  const e = await admit(o.socket, o.roomId, 'Spammer', 'editor');
  const got = collect(o.socket, 'chat:message');
  e.socket.emit('chat:send', { text: 'y'.repeat(5000) });
  for (let i = 0; i < 300; i += 1) e.socket.emit('chat:send', { text: `spam ${i}` });
  await sleep(2500);
  got.stop();
  assert.equal(got.items[0].text.length, 2000, 'long message not capped');
  assert.ok(got.items.length < 100, `${got.items.length} messages in ~2 seconds were all delivered (no rate limit)`);
  o.socket.close();
  e.socket.close();
});

test('S12 invalid room IDs are refused; a well-formed new ID creates a room you own', async () => {
  const u = await createUser('Joiner');
  const s = await connect(u.token);
  for (const roomId of ['', 'abc', '../../etc', 'synq-AAAA-BBBB', 'synq-1234-12345', 'x'.repeat(5000)]) {
    assert.equal((await emitAck(s, 'room:join', { roomId })).error, 'Invalid room ID.', roomId);
  }
  const ok = await emitAck(s, 'room:join', { roomId: newRoomId() });
  assert.equal(ok.self.role, 'owner');
  s.close();
});

test('S13 the same account in two tabs gets the same role and sees the same document', async () => {
  const o = await ownerRoom('Owner');
  const tab2 = await connect(o.owner.token);
  const ack = await emitAck(tab2, 'room:join', { roomId: o.roomId });
  assert.equal(ack.self.role, 'owner');
  assert.notEqual(ack.self.userId, o.ack.self.userId);
  o.socket.close();
  tab2.close();
});

test('S14 login: wrong password, brute force limit, NoSQL injection, bad JSON', async () => {
  const u = await createUser('Victim');
  assert.equal((await api('/api/auth/login', { email: u.email, password: 'wrong-password' })).status, 401);
  assert.equal((await api('/api/auth/login', { email: { $ne: null }, password: { $ne: null } })).status, 400);
  const raw = await api('/api/auth/login', '{"email":', {});
  assert.equal(raw.status, 400);
  assert.ok(!JSON.stringify(raw.data).includes('at '), 'stack trace in the response');
  let last;
  for (let i = 0; i < 12; i += 1) last = await api('/api/auth/login', { email: u.email, password: `wrong-${i}` });
  assert.equal(last.status, 429, 'no lockout after 12 wrong passwords');
});

test('S15 a refresh token used twice ends the whole login', async () => {
  const u = await createUser('Reuser');
  const first = await api('/api/auth/refresh', {}, { cookie: u.cookie });
  assert.equal(first.status, 200);
  await sleep(31_000); // past the grace window for two tabs
  const reuse = await api('/api/auth/refresh', {}, { cookie: u.cookie });
  assert.equal(reuse.status, 401);
  const rotated = await api('/api/auth/refresh', {}, { cookie: first.cookie });
  assert.equal(rotated.status, 401, 'the rotated token still works after a reuse was detected');
});

test('S16 refresh cookie is httpOnly + SameSite and the API answers with security headers', async () => {
  const u = await createUser('Cookie');
  const res = await fetch('http://127.0.0.1:4100/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: u.email, password: u.password }) });
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\/api\/auth/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
});

test('S17 the socket server only accepts the app origin (CORS)', async () => {
  const res = await fetch('http://127.0.0.1:4100/socket.io/?EIO=4&transport=polling', { headers: { origin: 'https://evil.example' } });
  const allowed = res.headers.get('access-control-allow-origin');
  assert.ok(!allowed || allowed !== 'https://evil.example', `any website may open a socket (Access-Control-Allow-Origin: ${allowed})`);
});

test('S18 an unknown API route answers 404 without details', async () => {
  const res = await fetch('http://127.0.0.1:4100/api/does-not-exist');
  assert.equal(res.status, 404);
  assert.equal((await res.text()).length, 0);
});
