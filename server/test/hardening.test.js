import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as Y from 'yjs';
import { io as connect } from 'socket.io-client';
import { createSynqServer } from '../src/app.js';

// Input that a well-behaved client never sends: the server must survive all of it.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synq-hard-'));
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

async function client(roomId, username) {
  const socket = connect(url, { transports: ['websocket'], forceNew: true });
  sockets.push(socket);
  const doc = new Y.Doc();
  const events = [];
  socket.onAny((event, data) => events.push([event, data]));
  socket.on('yjs:update', ({ update }) => Y.applyUpdate(doc, new Uint8Array(update), 'remote'));
  doc.on('update', (update, origin) => origin !== 'remote' && socket.emit('yjs:update', { update }));
  await new Promise((r) => socket.on('connect', r));
  const res = await socket.emitWithAck('room:join', { roomId, username });
  if (res.state) Y.applyUpdate(doc, new Uint8Array(res.state), 'remote');
  return { socket, doc, res, of: (name) => events.filter(([e]) => e === name).map(([, d]) => d) };
}

const EVENTS = [
  'room:join', 'yjs:update', 'presence:update', 'cursor:move', 'selection:change', 'typing:start', 'typing:stop',
  'chat:send', 'room:save', 'room:setRole', 'room:respond', 'room:remove', 'room:settings', 'run:request',
  'shell:exec', 'shell:list', 'shell:kill', 'live:open', 'live:stop', 'github:push',
];
const JUNK = [null, [], ['a'], 'text', 42, true, { fileId: { $gt: '' } }];

test('null, arrays, strings and numbers sent to every event never crash the server', async () => {
  const a = await client('synq-hard-0001', 'alice');
  for (const event of EVENTS) {
    for (const junk of JUNK) {
      a.socket.emit(event, junk);
      a.socket.emit(event, junk, () => {});
    }
  }
  await wait(800);
  const health = await fetch(`${url}/api/health`);
  assert.equal(health.status, 200);
  // The room still works for the same socket.
  a.socket.emit('chat:send', { text: 'still here' });
  await wait(300);
  assert.equal(a.of('chat:message').at(-1)?.text, 'still here');
});

test('file names with "..", slashes or a missing folder are refused and never reach the others', async () => {
  const a = await client('synq-hard-0002', 'alice');
  await a.socket.emitWithAck('room:settings', { approval: false });
  const b = await client('synq-hard-0002', 'bobby');
  const add = (id, node) =>
    a.doc.transact(() => {
      a.doc.getMap('texts').set(id, new Y.Text('x'));
      a.doc.getMap('nodes').set(id, { id, type: 'file', parentId: null, ...node });
    });
  add('f-bad1', { name: '../../escape.txt' });
  add('f-bad2', { name: 'a\b.js' });
  add('f-bad3', { name: 'ok.js', parentId: 'no-such-folder' });
  add('f-good', { name: 'fine.js' });
  await wait(500);
  const names = [...b.doc.getMap('nodes').values()].map((n) => n.name);
  assert.deepEqual(names, ['fine.js']);
  assert.equal(a.of('update:rejected').length, 3);
});

test('the terminal never writes a file outside the room folder, even for an old bad name', async () => {
  const { Shell } = await import('../src/shell.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synq-ws-'));
  const shell = new Shell({ root: path.join(root, 'workspaces') });
  const doc = new Y.Doc();
  doc.transact(() => {
    for (const [id, name] of [['f-1', '../../outside.txt'], ['f-2', 'inside.txt']]) {
      doc.getMap('texts').set(id, new Y.Text('data'));
      doc.getMap('nodes').set(id, { id, name, type: 'file', parentId: null });
    }
  });
  await shell.materialize('synq-hard-0003', doc);
  assert.equal(fs.existsSync(path.join(root, 'outside.txt')), false);
  assert.equal(fs.existsSync(path.join(root, 'workspaces', 'synq-hard-0003', 'inside.txt')), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('after a refused change, the same person can keep editing (owner-only files)', async () => {
  const owner = await client('synq-hard-0004', 'owner');
  await owner.socket.emitWithAck('room:settings', { approval: false, ownerOnlyFiles: true });
  owner.doc.transact(() => {
    owner.doc.getMap('texts').set('f-main', new Y.Text('hello'));
    owner.doc.getMap('nodes').set('f-main', { id: 'f-main', name: 'main.js', type: 'file', parentId: null });
  });
  const editor = await client('synq-hard-0004', 'editor');
  editor.doc.transact(() => {
    editor.doc.getMap('texts').set('f-new', new Y.Text('x'));
    editor.doc.getMap('nodes').set('f-new', { id: 'f-new', name: 'new.js', type: 'file', parentId: null });
  });
  await wait(400);
  editor.doc.getMap('texts').get('f-main').insert(5, ' world');
  await wait(400);
  assert.equal(editor.of('update:rejected').length, 1);
  assert.equal(owner.doc.getMap('nodes').get('f-new'), undefined);
  assert.equal(editor.doc.getMap('nodes').get('f-new'), undefined, 'the refused file stays on the editor screen');
  assert.equal(owner.doc.getMap('texts').get('f-main').toString(), 'hello world');
});

test('code runs cannot reach the network (import, require, getBuiltinModule, fetch, WebSocket)', async () => {
  const { runJavaScript } = await import('../src/runner.js');
  const attempts = [
    "import net from 'node:net'; console.log('OP' + 'EN')",
    "await import('node:http'); console.log('OP' + 'EN')",
    "import { createRequire } from 'node:module'; createRequire(import.meta.url)('https'); console.log('OP' + 'EN')",
    "process.getBuiltinModule('node:dgram'); console.log('OP' + 'EN')",
    "await fetch('http://127.0.0.1:1/'); console.log('OP' + 'EN')",
    "new WebSocket('ws://127.0.0.1:1/'); console.log('OP' + 'EN')",
    "process.binding('tcp_wrap'); console.log('OP' + 'EN')",
  ];
  for (const code of attempts) {
    let out = '';
    const res = await runJavaScript({ code, onOutput: (_s, chunk) => (out += chunk) }).promise;
    assert.notEqual(res.exitCode, 0, code);
    assert.doesNotMatch(out, /OPEN/, code);
  }
  let ok = '';
  await runJavaScript({ code: "import path from 'node:path'; console.log(path.posix.join('a', 'b'))", onOutput: (_s, c) => (ok += c) }).promise;
  assert.match(ok, /a\/b/);
});

test('cursor and selection events relay only the documented fields', async () => {
  const a = await client('synq-hard-0005', 'alice');
  await a.socket.emitWithAck('room:settings', { approval: false });
  const b = await client('synq-hard-0005', 'bobby');
  a.socket.emit('cursor:move', { fileId: 'f-1', position: { lineNumber: 3, column: 7 }, rel: [1, 2, 3], userId: 'spoof', html: '<img src=x onerror=alert(1)>', blob: 'x'.repeat(100000) });
  a.socket.emit('selection:change', { fileId: 'f-1', range: { startLineNumber: 1, startColumn: 1, endLineNumber: 2, endColumn: 4, extra: 1 }, rel: { start: [1], end: [2] }, more: 'x' });
  a.socket.emit('cursor:move', { fileId: 'f-1', position: { lineNumber: -1, column: 'x' } });
  a.socket.emit('typing:start', { fileId: 'f-1', junk: 'y' });
  await wait(400);
  const cursor = b.of('cursor:move');
  assert.equal(cursor.length, 1, 'an invalid position was relayed');
  assert.deepEqual(cursor[0], { fileId: 'f-1', position: { lineNumber: 3, column: 7 }, rel: [1, 2, 3], userId: a.res.self.userId });
  assert.deepEqual(b.of('selection:change')[0], {
    fileId: 'f-1',
    range: { startLineNumber: 1, startColumn: 1, endLineNumber: 2, endColumn: 4 },
    rel: { start: [1], end: [2] },
    userId: a.res.self.userId,
  });
  assert.deepEqual(b.of('typing:start')[0], { fileId: 'f-1', userId: a.res.self.userId });
});

test('chat floods and run spam are rate limited per connection; normal use is not', async () => {
  const a = await client('synq-hard-0006', 'alice');
  for (let i = 0; i < 200; i += 1) a.socket.emit('chat:send', { text: `spam ${i}` });
  await wait(600);
  const delivered = a.of('chat:message').length;
  assert.ok(delivered >= 10 && delivered <= 20, `${delivered} of 200 flood messages delivered`);
  await wait(1200);
  a.socket.emit('chat:send', { text: 'normal message' });
  await wait(300);
  assert.equal(a.of('chat:message').at(-1).text, 'normal message');
});

test('rate limit buckets refill over time', async () => {
  const { Buckets } = await import('../src/limits.js');
  let t = 0;
  const b = new Buckets({ x: { burst: 2, perSecond: 1 } }, () => t);
  assert.equal(b.take('x'), true);
  assert.equal(b.take('x'), true);
  assert.equal(b.take('x'), false);
  t = 1000;
  assert.equal(b.take('x'), true);
  assert.equal(b.take('x'), false);
  assert.equal(b.take('unknown'), true);
});

test('a run is stopped when the last person leaves the room', async () => {
  let cancelled = false;
  let finish;
  const runner = () => ({ promise: new Promise((r) => (finish = r)), cancel: () => { cancelled = true; finish({ exitCode: 130, durationMs: 1 }); } });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synq-leave-'));
  const own = createSynqServer({ dataDir: dir, runner, languages: { javascript: { label: 'JavaScript', kind: 'node', inputType: 'module' } } });
  const { port } = await own.listen(0, '127.0.0.1');
  const socket = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true });
  await new Promise((r) => socket.on('connect', r));
  const res = await socket.emitWithAck('room:join', { roomId: 'synq-hard-0007', username: 'alice' });
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(res.state));
  doc.on('update', (u) => socket.emit('yjs:update', { update: u }));
  doc.transact(() => {
    doc.getMap('texts').set('f-1', new Y.Text('while (true) {}'));
    doc.getMap('nodes').set('f-1', { id: 'f-1', name: 'loop.js', type: 'file', parentId: null });
  });
  await wait(200);
  socket.emit('run:request', { fileId: 'f-1' });
  await wait(200);
  socket.disconnect();
  await wait(300);
  const stoppedOnLeave = cancelled;
  await own.close();
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(stoppedOnLeave, true);
});

test('one person can create at most 20 new rooms an hour', async () => {
  const socket = connect(url, { transports: ['websocket'], forceNew: true });
  sockets.push(socket);
  await new Promise((r) => socket.on('connect', r));
  const memberKey = 'qa-member-key-0123456789';
  const results = [];
  for (let i = 0; i < 21; i += 1) {
    const id = `synq-new${String.fromCharCode(97 + Math.floor(i / 10))}-r${String(i % 10).padStart(3, '0')}`;
    // A new connection per room, like opening rooms in new tabs (the join limit is per connection).
    const s = connect(url, { transports: ['websocket'], forceNew: true });
    sockets.push(s);
    await new Promise((r) => s.on('connect', r));
    results.push(await s.emitWithAck('room:join', { roomId: id, username: 'maker', memberKey }));
    s.disconnect();
  }
  assert.equal(results.slice(0, 20).filter((r) => r.self?.role === 'owner').length, 20);
  assert.match(results[20].error, /a lot of rooms/);
});

test('C and C++ compile errors name the file the user wrote, with the line number', async (t) => {
  const { detectLanguages } = await import('../src/languages.js');
  const { runFile } = await import('../src/runner.js');
  const c = detectLanguages().c;
  if (!c) return t.skip('no C compiler on this machine');
  let out = '';
  const res = await runFile({ lang: c, name: 'bad.c', code: 'int main() {\n  int x = ;\n}\n', onOutput: (_s, chunk) => (out += chunk) }).promise;
  assert.equal(res.phase, 'compile');
  assert.match(out, /bad\.c:2/);
  assert.doesNotMatch(out, /main\.c/);
});
