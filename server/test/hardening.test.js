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
