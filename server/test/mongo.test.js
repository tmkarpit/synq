import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as Y from 'yjs';
import { io as connect } from 'socket.io-client';
import { createSynqServer } from '../src/app.js';
import { MongoStore } from '../src/db/mongoStore.js';

// Runs only with TEST_MONGODB_URI (a throwaway database; it is dropped first), e.g.
//   npm run test:db   (uses TEST_MONGODB_URI from .env)
const URI = process.env.TEST_MONGODB_URI;
const skip = !URI && 'set TEST_MONGODB_URI to run the MongoDB tests';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synq-mongo-test-'));
let server;
let url;
let db;
const sockets = [];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const newServer = async () => {
  server = createSynqServer({ dataDir, store: new MongoStore({ uri: URI, dataDir, compactEvery: 3 }), languages: {} });
  const { port } = await server.listen(0, '127.0.0.1');
  url = `http://127.0.0.1:${port}`;
  ({ db } = server.store);
};

before(async () => {
  if (skip) return;
  const reset = new MongoStore({ uri: URI });
  await reset.client.connect();
  await reset.db.dropDatabase();
  await reset.close();
  // An old file-storage room, to check the one-time import.
  const old = new Y.Doc();
  old.getMap('texts').set('f-old', new Y.Text('legacy code'));
  old.getMap('nodes').set('f-old', { id: 'f-old', name: 'old.js', type: 'file', parentId: null });
  fs.writeFileSync(path.join(dataDir, 'synq-oldd-0001.ybin'), Y.encodeStateAsUpdate(old));
  await newServer();
});

after(async () => {
  if (skip) return;
  sockets.forEach((s) => s.disconnect());
  await server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function client(roomId, username) {
  const socket = connect(url, { transports: ['websocket'], forceNew: true });
  sockets.push(socket);
  const doc = new Y.Doc();
  socket.on('yjs:update', ({ update }) => Y.applyUpdate(doc, new Uint8Array(update), 'remote'));
  doc.on('update', (update, origin) => origin !== 'remote' && socket.emit('yjs:update', { update }));
  await new Promise((r) => socket.on('connect', r));
  const res = await socket.emitWithAck('room:join', { roomId, username, memberKey: `${username}-member-key-test` });
  if (res.state) Y.applyUpdate(doc, new Uint8Array(res.state), 'remote');
  return { socket, doc, res };
}

function addFile(doc, id, name, content, parentId = null) {
  doc.transact(() => {
    doc.getMap('texts').set(id, new Y.Text(content));
    doc.getMap('nodes').set(id, { id, name, type: 'file', parentId });
  });
}

const files = async (roomId) =>
  (await db.collection('room_files').find({ roomId }).sort({ fileId: 1 }).toArray()).map(({ fileId, path: p, content }) => ({
    fileId,
    path: p,
    content,
  }));

test('imports old .ybin rooms once, with a readable file copy', { skip }, async () => {
  assert.equal(server.imported, 1);
  assert.deepEqual(await files('synq-oldd-0001'), [{ fileId: 'f-old', path: 'old.js', content: 'legacy code' }]);
  const b = await client('synq-oldd-0001', 'bob');
  assert.equal(b.doc.getMap('texts').get('f-old').toString(), 'legacy code');
});

test('a save adds one small update document and rewrites only the changed file', { skip }, async () => {
  const a = await client('synq-mong-0001', 'ada');
  addFile(a.doc, 'f1', 'main.js', 'one');
  addFile(a.doc, 'f2', 'util.js', 'two');
  assert.deepEqual(await a.socket.emitWithAck('room:save', {}), { ok: true });
  assert.equal((await db.collection('rooms').findOne({ _id: 'synq-mong-0001' })).updateCount, 1); // one flush, one document

  const before = (await db.collection('room_files').findOne({ _id: 'synq-mong-0001:f2' })).updatedAt;
  a.doc.getMap('texts').get('f1').insert(3, '!');
  await a.socket.emitWithAck('room:save', {});
  const after2 = (await db.collection('room_files').findOne({ _id: 'synq-mong-0001:f2' })).updatedAt;
  assert.deepEqual(after2, before); // the untouched file was not rewritten
  assert.deepEqual(
    (await files('synq-mong-0001')).map((f) => f.content),
    ['one!', 'two'],
  );
});

test('renames and deletes keep the file copy in sync', { skip }, async () => {
  const a = await client('synq-mong-0002', 'ada');
  a.doc.getMap('nodes').set('d1', { id: 'd1', name: 'src', type: 'folder', parentId: null });
  addFile(a.doc, 'f1', 'app.py', 'print(1)', 'd1');
  addFile(a.doc, 'f2', 'gone.py', 'x');
  await a.socket.emitWithAck('room:save', {});
  a.doc.transact(() => {
    a.doc.getMap('nodes').set('d1', { id: 'd1', name: 'lib', type: 'folder', parentId: null });
    a.doc.getMap('nodes').delete('f2');
    a.doc.getMap('texts').delete('f2');
  });
  await a.socket.emitWithAck('room:save', {});
  assert.deepEqual(await files('synq-mong-0002'), [{ fileId: 'f1', path: 'lib/app.py', content: 'print(1)' }]);
});

test('updates are compacted into the snapshot and the room survives a restart', { skip }, async () => {
  const a = await client('synq-mong-0003', 'ada');
  addFile(a.doc, 'f1', 'main.c', '');
  for (const ch of 'abcd') {
    a.doc.getMap('texts').get('f1').insert(a.doc.getMap('texts').get('f1').length, ch);
    await a.socket.emitWithAck('room:save', {});
  }
  const room = await db.collection('rooms').findOne({ _id: 'synq-mong-0003' });
  const left = await db.collection('room_updates').countDocuments({ roomId: 'synq-mong-0003' });
  assert.ok(room.snapshot); // compacted after 3 flushes
  assert.equal(left, room.updateCount);
  assert.ok(left < 3);

  a.socket.disconnect();
  await wait(50);
  await server.close();
  await newServer();
  const b = await client('synq-mong-0003', 'ada'); // the owner comes back
  assert.equal(b.doc.getMap('texts').get('f1').toString(), 'abcd');
});
