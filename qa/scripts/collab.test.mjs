// Phase 3 (protocol level): concurrent editing through the real server with 2-3 sockets.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { addFile, admit, closeDb, connect, emitAck, mirror, ownerRoom, sleep } from './lib.mjs';

after(() => closeDb());
const text = (doc, id) => doc.getMap('texts').get(id).toString();

test('C1 two users typing in the same file at the same time converge, nothing lost or doubled', async () => {
  const o = await ownerRoom('Alice');
  const fileId = addFile(o.doc, { name: 'race.js', content: '' });
  const b = await admit(o.socket, o.roomId, 'Bob', 'editor');
  await sleep(300);
  const ta = o.doc.getMap('texts').get(fileId);
  const tb = b.doc.getMap('texts').get(fileId);
  for (let i = 0; i < 200; i += 1) {
    ta.insert(ta.length, 'a');
    tb.insert(0, 'b');
    if (i % 20 === 0) await sleep(5);
  }
  await sleep(1500);
  assert.equal(text(o.doc, fileId), text(b.doc, fileId), 'the two users see different text');
  const t = text(o.doc, fileId);
  assert.equal([...t].filter((c) => c === 'a').length, 200);
  assert.equal([...t].filter((c) => c === 'b').length, 200);
  o.socket.close();
  b.socket.close();
});

test('C2 typing on the same line at the same time: both edits survive in order', async () => {
  const o = await ownerRoom('Alice');
  const fileId = addFile(o.doc, { name: 'line.js', content: 'const x = ;' });
  const b = await admit(o.socket, o.roomId, 'Bob', 'editor');
  await sleep(300);
  o.doc.getMap('texts').get(fileId).insert(10, '1');
  b.doc.getMap('texts').get(fileId).insert(10, '2');
  await sleep(800);
  const t = text(o.doc, fileId);
  assert.equal(t, text(b.doc, fileId));
  assert.ok(t === 'const x = 12;' || t === 'const x = 21;', t);
  o.socket.close();
  b.socket.close();
});

test('C3 a user who joins later gets the full content exactly once', async () => {
  const o = await ownerRoom('Alice');
  const fileId = addFile(o.doc, { name: 'early.js', content: 'line 1\nline 2\nline 3\n' });
  await sleep(300);
  const b = await admit(o.socket, o.roomId, 'Bob', 'editor');
  assert.equal(text(b.doc, fileId), 'line 1\nline 2\nline 3\n');
  // Rejoin on the same socket (like a reconnect) must not duplicate anything.
  const again = await emitAck(b.socket, 'room:join', { roomId: o.roomId });
  const fresh = new Y.Doc();
  Y.applyUpdate(fresh, new Uint8Array(again.state));
  Y.applyUpdate(b.doc, new Uint8Array(again.state), 'remote');
  assert.equal(text(fresh, fileId), 'line 1\nline 2\nline 3\n');
  assert.equal(text(b.doc, fileId), 'line 1\nline 2\nline 3\n');
  o.socket.close();
  b.socket.close();
});

test('C4 three users at once, plus a 5,000-line paste', async () => {
  const o = await ownerRoom('Alice');
  const fileId = addFile(o.doc, { name: 'big.js', content: '' });
  const b = await admit(o.socket, o.roomId, 'Bob', 'editor');
  const c = await admit(o.socket, o.roomId, 'Carol', 'editor');
  await sleep(300);
  const big = Array.from({ length: 5000 }, (_, i) => `const v${i} = ${i}; // line ${i}`).join('\n');
  const t0 = Date.now();
  c.doc.getMap('texts').get(fileId).insert(0, big);
  o.doc.getMap('texts').get(fileId).insert(0, '// alice\n');
  b.doc.getMap('texts').get(fileId).insert(0, '// bob\n');
  for (let i = 0; i < 50; i += 1) {
    if (text(o.doc, fileId).length > big.length && text(o.doc, fileId) === text(b.doc, fileId) && text(b.doc, fileId) === text(c.doc, fileId)) break;
    await sleep(100);
  }
  const ms = Date.now() - t0;
  const t = text(o.doc, fileId);
  assert.equal(t, text(b.doc, fileId));
  assert.equal(t, text(c.doc, fileId));
  assert.equal(t.split('\n').length, 5002);
  assert.ok(ms < 5000, `took ${ms}ms to converge`);
  o.socket.close();
  b.socket.close();
  c.socket.close();
});

test('C5 file create / rename / delete / move reach everyone', async () => {
  const o = await ownerRoom('Alice');
  const b = await admit(o.socket, o.roomId, 'Bob', 'editor');
  const folder = 'd-qa-folder';
  o.doc.getMap('nodes').set(folder, { id: folder, name: 'src', type: 'folder', parentId: null });
  const f = addFile(o.doc, { name: 'a.js', content: 'x' });
  await sleep(500);
  assert.ok(b.doc.getMap('nodes').get(f));
  o.doc.getMap('nodes').set(f, { ...o.doc.getMap('nodes').get(f), name: 'b.js' });
  await sleep(300);
  assert.equal(b.doc.getMap('nodes').get(f).name, 'b.js');
  o.doc.getMap('nodes').set(f, { ...o.doc.getMap('nodes').get(f), parentId: folder });
  await sleep(300);
  assert.equal(b.doc.getMap('nodes').get(f).parentId, folder);
  o.doc.transact(() => {
    o.doc.getMap('nodes').delete(f);
    o.doc.getMap('texts').delete(f);
  });
  await sleep(300);
  assert.equal(b.doc.getMap('nodes').get(f), undefined);
  o.socket.close();
  b.socket.close();
});

test('C6 edits are saved: a fresh connection after everyone left sees them', async () => {
  const o = await ownerRoom('Alice');
  const fileId = addFile(o.doc, { name: 'saved.js', content: 'persist me' });
  await sleep(1800); // autosave runs at most once a second
  o.socket.close();
  await sleep(500);
  const s = await connect(o.owner.token);
  const ack = await emitAck(s, 'room:join', { roomId: o.roomId });
  const doc = mirror(s, ack);
  assert.equal(text(doc, fileId), 'persist me');
  s.close();
  console.log(`ROOM_FOR_RESTART=${o.roomId} FILE=${fileId} TOKEN_USER=${o.owner.email} PASSWORD=${o.owner.password}`);
});
