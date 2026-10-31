import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as Y from 'yjs';
import { io as connect } from 'socket.io-client';
import { createSynqServer } from '../src/app.js';
import { runJavaScript } from '../src/runner.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synq-test-'));
let server;
let url;
const sockets = [];

before(async () => {
  server = createSynqServer({ dataDir });
  const { port } = await server.listen(0, '127.0.0.1');
  url = `http://127.0.0.1:${port}`;
});

after(async () => {
  sockets.forEach((s) => s.disconnect());
  await server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** A minimal client: joins, mirrors the doc, records every event. */
async function client(roomId, username, extra = {}) {
  const socket = connect(url, { transports: ['websocket'], forceNew: true });
  sockets.push(socket);
  const doc = new Y.Doc();
  const events = [];
  socket.onAny((event, data) => events.push([event, data]));
  socket.on('yjs:update', ({ update }) => Y.applyUpdate(doc, new Uint8Array(update), 'remote'));
  doc.on('update', (update, origin) => origin !== 'remote' && socket.emit('yjs:update', { update }));
  await new Promise((r) => socket.on('connect', r));
  const res = await socket.emitWithAck('room:join', { roomId, username, color: '#22D3EE', ...extra });
  if (res.state) Y.applyUpdate(doc, new Uint8Array(res.state), 'remote');
  return { socket, doc, res, of: (name) => events.filter(([e]) => e === name).map(([, d]) => d) };
}

/** Lets anyone with the link in without asking the owner (most tests). */
const openRoom = (owner) => owner.socket.emitWithAck('room:settings', { approval: false });

/** The member and request lists the owner got last. */
const accessOf = (owner) => owner.of('room:access').at(-1);
const memberOf = (owner, name) => accessOf(owner).members.find((m) => m.name === name)?.member;

function seed(doc, files) {
  doc.transact(() => {
    for (const [id, name, content] of files) {
      const t = new Y.Text();
      t.insert(0, content);
      doc.getMap('texts').set(id, t);
      doc.getMap('nodes').set(id, { id, name, type: 'file', parentId: null });
    }
  });
}

test('invited users join the same room, get roles and see each other', async () => {
  const a = await client('synq-aaaa-0001', 'ada');
  await openRoom(a);
  const b = await client('synq-aaaa-0001', 'bob');
  assert.equal(a.res.self.role, 'owner');
  assert.equal(b.res.self.role, 'editor');
  assert.notEqual(a.res.self.color, b.res.self.color);
  assert.deepEqual(b.res.users.map((u) => u.username), ['ada']);
  await wait(50);
  assert.equal(a.of('user:joined')[0].username, 'bob');
});

test('code typed by one collaborator reaches the others', async () => {
  const a = await client('synq-aaaa-0002', 'ada');
  await openRoom(a);
  seed(a.doc, [['f1', 'index.js', 'console.log(1);\n']]);
  await wait(50);
  const b = await client('synq-aaaa-0002', 'bob');
  assert.equal(b.doc.getMap('texts').get('f1').toString(), 'console.log(1);\n', 'late joiner gets the current code');
  b.doc.getMap('texts').get('f1').insert(0, '// bob\n');
  await wait(50);
  assert.equal(a.doc.getMap('texts').get('f1').toString(), '// bob\nconsole.log(1);\n');
});

test('rejects bad room ids and names', async () => {
  const s = connect(url, { transports: ['websocket'], forceNew: true });
  sockets.push(s);
  assert.equal((await s.emitWithAck('room:join', { roomId: '../etc', username: 'ada' })).error, 'Invalid room ID.');
  assert.equal((await s.emitWithAck('room:join', { roomId: 'synq-aaaa-0003', username: 'x' })).error, 'Invalid username.');
});

test('relays cursors with the sender id, not back to the sender', async () => {
  const a = await client('synq-aaaa-0004', 'ada');
  await openRoom(a);
  const b = await client('synq-aaaa-0004', 'bob');
  b.socket.emit('cursor:move', { fileId: 'f1', position: { lineNumber: 2, column: 3 } });
  await wait(50);
  assert.deepEqual(a.of('cursor:move')[0], { fileId: 'f1', position: { lineNumber: 2, column: 3 }, userId: b.res.self.userId });
  assert.equal(b.of('cursor:move').length, 0);
});

test('a run is shared with the room; a second one is refused; viewers cannot run or edit', async () => {
  const a = await client('synq-aaaa-0005', 'ada');
  await openRoom(a);
  seed(a.doc, [['f1', 'index.js', 'console.log("hi", readline());\nawait new Promise((r) => setTimeout(r, 300));\n']]);
  await wait(50);
  const b = await client('synq-aaaa-0005', 'bob');
  const v = await client('synq-aaaa-0005', 'vic', { role: 'viewer' });
  assert.equal(v.res.self.role, 'viewer');

  a.socket.emit('run:request', { fileId: 'f1', stdin: 'there' });
  await wait(100);
  b.socket.emit('run:request', { fileId: 'f1' });
  v.socket.emit('run:request', { fileId: 'f1' });
  await wait(2000);

  for (const c of [a, b, v]) {
    assert.equal(c.of('run:started').length, 1);
    assert.match(c.of('run:output').map((o) => o.chunk).join(''), /hi there/);
    assert.equal(c.of('run:result')[0].exitCode, 0);
  }
  assert.equal(b.of('run:rejected')[0].reason, 'busy');
  assert.equal(v.of('run:rejected')[0].reason, 'forbidden');

  v.doc.getMap('texts').get('f1').insert(0, 'evil');
  await wait(50);
  assert.ok(!a.doc.getMap('texts').get('f1').toString().startsWith('evil'), 'viewer edits are ignored');
});

test('the runner sandbox blocks files and stops endless loops', async () => {
  const out = [];
  const files = await runJavaScript({
    code: 'import fs from "node:fs"; try { fs.readFileSync("package.json"); console.log("READ"); } catch (e) { console.log(e.code); }',
    onOutput: (_, c) => out.push(c),
  }).promise;
  assert.equal(files.exitCode, 0);
  assert.match(out.join(''), /ERR_ACCESS_DENIED/);

  const loop = await runJavaScript({ code: 'while (true) {}', timeoutMs: 800, onOutput: (_, c) => out.push(c) }).promise;
  assert.equal(loop.exitCode, 124);
  assert.equal(loop.timedOut, true);
});

test('the final code survives everyone leaving and a server restart', async () => {
  const a = await client('synq-aaaa-0006', 'ada', { memberKey: 'ada-member-key-0006' });
  seed(a.doc, [['f1', 'final.js', 'const done = true;\n']]);
  await wait(50);
  a.socket.disconnect();
  await wait(50);
  await server.close();

  server = createSynqServer({ dataDir });
  const { port } = await server.listen(0, '127.0.0.1');
  url = `http://127.0.0.1:${port}`;
  const b = await client('synq-aaaa-0006', 'ada again', { memberKey: 'ada-member-key-0006' });
  assert.equal(b.doc.getMap('texts').get('f1').toString(), 'const done = true;\n');
  assert.equal(b.res.self.role, 'owner'); // ownership is remembered across restarts
});

test('the owner stays owner after a refresh; nobody else takes over', async () => {
  const a = await client('synq-ownr-0001', 'ada', { memberKey: 'ada-member-key-0001' });
  await openRoom(a);
  const b = await client('synq-ownr-0001', 'bob', { memberKey: 'bob-member-key-0001' });
  assert.equal(a.res.self.role, 'owner');
  a.socket.disconnect();
  await wait(80);
  assert.equal(b.of('user:updated').length, 0);
  const again = await client('synq-ownr-0001', 'ada', { memberKey: 'ada-member-key-0001' });
  assert.equal(again.res.self.role, 'owner');
});

test('new people ask to join; the owner accepts or declines', async () => {
  const a = await client('synq-ownr-0004', 'ada', { memberKey: 'ada-member-key-0004' });
  assert.equal(a.res.self.role, 'owner');
  const b = await client('synq-ownr-0004', 'bob', { memberKey: 'bob-member-key-0004' });
  assert.deepEqual(b.res, { pending: true, room: { name: null } });
  await wait(50);
  const request = accessOf(a).requests[0];
  assert.equal(request.name, 'bob');

  // Only the owner can answer.
  const c = await client('synq-ownr-0004', 'cat', { memberKey: 'cat-member-key-0004' });
  assert.equal(c.res.pending, true);
  assert.match((await c.socket.emitWithAck('room:respond', { member: request.member, accept: true })).error, /Not in a room/);

  assert.equal((await a.socket.emitWithAck('room:respond', { member: request.member, accept: true })).ok, true);
  await wait(50);
  assert.equal(b.of('room:admitted').length, 1);
  const bIn = await b.socket.emitWithAck('room:join', { roomId: 'synq-ownr-0004', username: 'bob', memberKey: 'bob-member-key-0004' });
  assert.equal(bIn.self.role, 'editor');

  const catRequest = accessOf(a).requests.find((r) => r.name === 'cat');
  await a.socket.emitWithAck('room:respond', { member: catRequest.member, accept: false });
  await wait(50);
  assert.match(c.of('room:declined')[0].message, /declined/);
  assert.deepEqual(accessOf(a).requests, []);
});

test('the owner can remove someone; their tab is disconnected', async () => {
  const a = await client('synq-ownr-0005', 'ada', { memberKey: 'ada-member-key-0005' });
  await openRoom(a);
  const b = await client('synq-ownr-0005', 'bob', { memberKey: 'bob-member-key-0005' });
  await wait(50);
  assert.match((await b.socket.emitWithAck('room:remove', { member: memberOf(a, 'ada') })).error, /Only the room owner/);
  assert.equal((await a.socket.emitWithAck('room:remove', { member: memberOf(a, 'bob') })).ok, true);
  await wait(80);
  assert.match(b.of('room:removed')[0].message, /removed you/);
  assert.equal(b.socket.connected, false);
  assert.equal(accessOf(a).members.some((m) => m.name === 'bob'), false);
});

test('only the owner changes roles; roles stick; ownership can be handed over', async () => {
  const a = await client('synq-ownr-0002', 'ada', { memberKey: 'ada-member-key-0002' });
  await openRoom(a);
  const b = await client('synq-ownr-0002', 'bob', { memberKey: 'bob-member-key-0002' });
  await wait(50);
  const bob = memberOf(a, 'bob');
  const denied = await b.socket.emitWithAck('room:setRole', { member: memberOf(a, 'ada'), role: 'viewer' });
  assert.match(denied.error, /Only the room owner/);

  assert.equal((await a.socket.emitWithAck('room:setRole', { member: bob, role: 'viewer' })).ok, true);
  await wait(50);
  assert.equal(a.of('user:updated').at(-1).role, 'viewer');
  // A viewer's edits are ignored.
  seed(b.doc, [['f1', 'x.js', 'nope']]);
  await wait(50);
  assert.equal(a.doc.getMap('texts').get('f1'), undefined);

  b.socket.disconnect();
  const b2 = await client('synq-ownr-0002', 'bob', { memberKey: 'bob-member-key-0002' });
  assert.equal(b2.res.self.role, 'viewer'); // remembered

  assert.equal((await a.socket.emitWithAck('room:setRole', { member: bob, role: 'owner' })).ok, true);
  await wait(50);
  const roles = Object.fromEntries(a.of('user:updated').map((u) => [u.userId, u.role]));
  assert.equal(roles[b2.res.self.userId], 'owner');
  assert.equal(roles[a.res.self.userId], 'editor');
  assert.equal(accessOf(b2).members[0].name, 'bob'); // the new owner gets the lists
});

test('owner-only files and runs are enforced by the server', async () => {
  const a = await client('synq-ownr-0003', 'ada', { memberKey: 'ada-member-key-0003' });
  await openRoom(a);
  seed(a.doc, [['f1', 'main.js', 'let a = 1;']]);
  const b = await client('synq-ownr-0003', 'bob', { memberKey: 'bob-member-key-0003' });
  assert.deepEqual(b.res.settings, { approval: false, newMembers: 'editor', ownerOnlyFiles: false, ownerOnlyRun: false, shell: 'owner' });
  assert.match((await b.socket.emitWithAck('room:settings', { ownerOnlyFiles: true })).error, /Only the room owner/);

  const res = await a.socket.emitWithAck('room:settings', { ownerOnlyFiles: true, ownerOnlyRun: true, junk: 1 });
  assert.deepEqual(res.settings, { approval: false, newMembers: 'editor', ownerOnlyFiles: true, ownerOnlyRun: true, shell: 'owner' });
  await wait(50);
  assert.equal(b.of('room:settings').at(-1).ownerOnlyRun, true);

  // Editing code is still fine, creating a file is refused.
  b.doc.getMap('texts').get('f1').insert(0, '// ok\n');
  seed(b.doc, [['f2', 'new.js', 'refused']]);
  await wait(80);
  assert.equal(a.doc.getMap('texts').get('f1').toString(), '// ok\nlet a = 1;');
  assert.equal(a.doc.getMap('nodes').get('f2'), undefined);
  assert.match(b.of('update:rejected')[0].message, /create or delete files/);

  b.socket.emit('run:request', { fileId: 'f1' });
  await wait(80);
  assert.equal(b.of('run:rejected')[0].reason, 'forbidden');
});

test('room:save writes the room to disk now and tells everyone who saved', async () => {
  const a = await client('synq-save-0001', 'ada');
  await openRoom(a);
  const b = await client('synq-save-0001', 'bob');
  seed(a.doc, [['f1', 'main.js', 'saved now']]);
  const res = await a.socket.emitWithAck('room:save', {});
  assert.deepEqual(res, { ok: true });
  // Written before the 1s autosave debounce would have fired.
  const disk = new Y.Doc();
  Y.applyUpdate(disk, fs.readFileSync(path.join(dataDir, 'synq-save-0001.ybin')));
  assert.equal(disk.getMap('texts').get('f1').toString(), 'saved now');
  await wait(100);
  const saved = b.of('room:saved').at(-1);
  assert.equal(saved.username, 'ada');
  assert.equal(typeof saved.savedAt, 'number');
});
