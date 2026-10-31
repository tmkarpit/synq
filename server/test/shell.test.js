import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as Y from 'yjs';
import { io as connect } from 'socket.io-client';
import { createSynqServer } from '../src/app.js';
import { Shell } from '../src/shell.js';

// Real terminal commands: they run in the room's folder and their file changes come
// back into the shared document. Commands are plain `node script.js` so they work the
// same in PowerShell and sh.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'synq-shell-test-'));
const dataDir = path.join(tmp, 'data');
// The workspaces sit under a folder with its own package.json, like the real server/:
// npm must never climb out of a room into it.
const outer = path.join(tmp, 'outer');
const root = path.join(outer, 'workspaces');
fs.mkdirSync(outer, { recursive: true });
fs.writeFileSync(path.join(outer, 'package.json'), JSON.stringify({ name: 'outer', private: true }));
let server;
let url;
const sockets = [];

before(async () => {
  server = createSynqServer({ dataDir, shell: new Shell({ root }), languages: {} });
  const { port } = await server.listen(0, '127.0.0.1');
  url = `http://127.0.0.1:${port}`;
});

after(async () => {
  sockets.forEach((s) => s.disconnect());
  await server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function client(roomId, username, memberKey) {
  const socket = connect(url, { transports: ['websocket'], forceNew: true });
  sockets.push(socket);
  const doc = new Y.Doc();
  const events = [];
  socket.onAny((event, data) => events.push([event, data]));
  socket.on('yjs:update', ({ update }) => Y.applyUpdate(doc, new Uint8Array(update), 'remote'));
  doc.on('update', (update, origin) => origin !== 'remote' && socket.emit('yjs:update', { update }));
  await new Promise((r) => socket.on('connect', r));
  const res = await socket.emitWithAck('room:join', { roomId, username, memberKey });
  if (res.state) Y.applyUpdate(doc, new Uint8Array(res.state), 'remote');
  return { socket, doc, res, of: (name) => events.filter(([e]) => e === name).map(([, d]) => d) };
}

function addFile(doc, id, name, content, parentId = null) {
  doc.transact(() => {
    const t = new Y.Text();
    t.insert(0, content);
    doc.getMap('texts').set(id, t);
    doc.getMap('nodes').set(id, { id, name, type: 'file', parentId });
  });
}

const files = (doc) => {
  const nodes = doc.getMap('nodes');
  const out = {};
  nodes.forEach((n, id) => {
    if (n.type !== 'file') return;
    const parts = [n.name];
    for (let p = n.parentId; p; p = nodes.get(p)?.parentId) parts.unshift(nodes.get(p).name);
    out[parts.join('/')] = doc.getMap('texts').get(id).toString();
  });
  return out;
};

async function exec(c, command) {
  const before = c.of('shell:exit').length;
  c.socket.emit('shell:exec', { command });
  for (let i = 0; i < 600 && c.of('shell:exit').length === before; i += 1) await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 50)); // the doc update arrives with the exit
  return c.of('shell:exit').at(-1);
}

test('commands run in the room folder; created, changed and deleted files sync back', async () => {
  const a = await client('synq-shel-0001', 'ada', 'ada-member-key-shell1');
  addFile(a.doc, 'f1', 'make.js', [
    "const fs = require('fs');",
    "fs.mkdirSync('src', { recursive: true });",
    "fs.writeFileSync('src/new.txt', 'made by the shell');",
    "fs.writeFileSync('edit.txt', fs.readFileSync('edit.txt', 'utf8').toUpperCase());",
    "fs.rmSync('gone.txt');",
    "fs.mkdirSync('node_modules/pkg', { recursive: true });",
    "fs.writeFileSync('node_modules/pkg/index.js', 'module.exports = 1');",
    "console.log('done making');",
  ].join('\n'));
  addFile(a.doc, 'f2', 'edit.txt', 'shout');
  addFile(a.doc, 'f3', 'gone.txt', 'bye');
  await new Promise((r) => setTimeout(r, 50));

  const exit = await exec(a, 'node make.js');
  assert.equal(exit.exitCode, 0);
  assert.match(a.of('shell:output').map((o) => o.chunk).join(''), /done making/);
  assert.equal(a.of('shell:started')[0].command, 'node make.js');
  assert.deepEqual(exit.changes.added, ['src/new.txt']);
  assert.deepEqual(exit.changes.changed, ['edit.txt']);
  assert.deepEqual(exit.changes.removed, ['gone.txt']);
  assert.deepEqual(exit.changes.hidden, ['node_modules']);

  const now = files(a.doc);
  assert.equal(now['src/new.txt'], 'made by the shell');
  assert.equal(now['edit.txt'], 'SHOUT');
  assert.equal(now['gone.txt'], undefined);
  assert.equal(Object.keys(now).some((p) => p.startsWith('node_modules')), false); // stays on the server
  // ...but commands can still use it.
  addFile(a.doc, 'f4', 'use.js', "console.log('pkg says', require('./node_modules/pkg'))");
  await new Promise((r) => setTimeout(r, 50));
  await exec(a, 'node use.js');
  assert.match(a.of('shell:output').map((o) => o.chunk).join(''), /pkg says 1/);
});

test('cd stays inside the project; secrets are not in the environment', async () => {
  const a = await client('synq-shel-0002', 'ada', 'ada-member-key-shell2');
  addFile(a.doc, 'f1', 'env.js', "console.log('secret=' + (process.env.JWT_SECRET || 'none') + ' db=' + (process.env.DATABASE_URL || 'none'))");
  await new Promise((r) => setTimeout(r, 50));
  process.env.JWT_SECRET = 'do-not-leak-this-secret';
  process.env.DATABASE_URL = 'postgres://do-not-leak';
  try {
    await exec(a, 'node env.js');
  } finally {
    delete process.env.JWT_SECRET;
    delete process.env.DATABASE_URL;
  }
  assert.match(a.of('shell:output').map((o) => o.chunk).join(''), /secret=none db=none/);

  assert.equal((await exec(a, 'cd ..')).exitCode, 1);
  assert.match(a.of('shell:output').at(-1).chunk, /outside this project/);
  assert.equal((await exec(a, 'mkdir sub')).exitCode, 0);
  const into = await exec(a, 'cd sub');
  assert.equal(into.cwd, 'sub');
  addFile(a.doc, 'f2', 'here.js', "require('fs').writeFileSync('inside.txt', process.cwd())");
  await new Promise((r) => setTimeout(r, 50));
  await exec(a, 'node ../here.js');
  assert.ok(files(a.doc)['sub/inside.txt']);
});

test('only the owner by default; one command at a time; Ctrl+C stops it', async () => {
  const a = await client('synq-shel-0003', 'ada', 'ada-member-key-shell3');
  await a.socket.emitWithAck('room:settings', { approval: false });
  const b = await client('synq-shel-0003', 'bob', 'bob-member-key-shell3');
  b.socket.emit('shell:exec', { command: 'node -v' });
  await new Promise((r) => setTimeout(r, 100));
  assert.match(b.of('shell:rejected')[0].message, /Only the room owner/);

  await a.socket.emitWithAck('room:settings', { shell: 'editors' });
  addFile(a.doc, 'f1', 'wait.js', 'setTimeout(() => {}, 60000)');
  await new Promise((r) => setTimeout(r, 50));
  b.socket.emit('shell:exec', { command: 'node wait.js' });
  await new Promise((r) => setTimeout(r, 1500));
  a.socket.emit('shell:exec', { command: 'node -v' });
  await new Promise((r) => setTimeout(r, 100));
  assert.match(a.of('shell:rejected').at(-1).message, /bob is running "node wait.js"/);

  a.socket.emit('shell:kill'); // the owner may stop anyone's command
  for (let i = 0; i < 100 && !b.of('shell:exit').length; i += 1) await new Promise((r) => setTimeout(r, 50));
  assert.equal(b.of('shell:exit')[0].cancelled, true);

  await a.socket.emitWithAck('room:settings', { shell: 'off' });
  a.socket.emit('shell:exec', { command: 'node -v' });
  await new Promise((r) => setTimeout(r, 100));
  assert.match(a.of('shell:rejected').at(-1).message, /turned off terminal commands/);
});

test('server-only folders are listed on demand; real exit codes; a clear npm hint', async () => {
  const a = await client('synq-shel-0004', 'ada', 'ada-member-key-shell4');
  addFile(a.doc, 'f1', 'deps.js', [
    "const fs = require('fs');",
    "fs.mkdirSync('node_modules/left-pad/lib', { recursive: true });",
    "fs.writeFileSync('node_modules/left-pad/package.json', '{}');",
  ].join('\n'));
  addFile(a.doc, 'f2', 'fail.js', 'process.exit(3)');
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual((await exec(a, 'node deps.js')).changes.hidden, ['node_modules']);

  const list = (p) => a.socket.emitWithAck('shell:list', { path: p });
  assert.deepEqual((await list('node_modules')).entries, [{ name: 'left-pad', type: 'folder' }]);
  assert.deepEqual((await list('node_modules/left-pad')).entries, [
    { name: 'lib', type: 'folder' },
    { name: 'package.json', type: 'file' },
  ]);
  for (const bad of ['', '.', 'deps.js', 'node_modules/../..', '../synq-shel-0001/node_modules']) {
    assert.ok((await list(bad)).error, `refused: ${bad}`);
  }
  // A late joiner learns where the server folders are.
  const b = await client('synq-shel-0004', 'ada', 'ada-member-key-shell4');
  assert.deepEqual(b.res.shell.serverDirs, ['node_modules']);

  assert.equal((await exec(a, 'node fail.js')).exitCode, 3);
  // npm ci without a package.json fails with a clear hint...
  const ci = await exec(a, 'npm ci');
  assert.notEqual(ci.exitCode, 0);
  assert.match(a.of('shell:output').map((o) => o.chunk).join(''), /no package\.json in this folder/);
  // ...and a bare npm install sets one up first and succeeds.
  const npm = await exec(a, 'npm install');
  assert.equal(npm.exitCode, 0);
  assert.match(a.of('shell:output').map((o) => o.chunk).join(''), /creating one first/);
  assert.ok(npm.changes.added.includes('package.json'));
  assert.equal(JSON.parse(files(a.doc)['package.json']).name, 'synq-shel-0004');
});

test('npm stays inside the room, even with a package.json in a folder above', async () => {
  const a = await client('synq-shel-0005', 'ada', 'ada-member-key-shell5');
  await exec(a, 'npm prefix');
  const printed = a.of('shell:output').map((o) => o.chunk).join('').trim();
  assert.equal(path.resolve(printed), path.resolve(root, 'synq-shel-0005'));
  await exec(a, 'npm install');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outer, 'package.json'), 'utf8')), { name: 'outer', private: true });
  assert.equal(fs.existsSync(path.join(outer, 'package-lock.json')), false);
  assert.equal(fs.existsSync(path.join(outer, 'node_modules')), false);
  // The empty node_modules that keeps npm in the room is not shown in Files.
  const b = await client('synq-shel-0005', 'ada', 'ada-member-key-shell5');
  assert.deepEqual(b.res.shell.serverDirs, []);
  // The project got its own package.json (created inside the room, not above it).
  assert.equal(JSON.parse(files(a.doc)['package.json']).name, 'synq-shel-0005');
});

test('renamed and deleted folders do not come back after a command', async () => {
  const a = await client('synq-shel-0006', 'ada', 'ada-member-key-shell6');
  a.doc.transact(() => a.doc.getMap('nodes').set('d1', { id: 'd1', name: 'old', type: 'folder', parentId: null }));
  addFile(a.doc, 'f1', 'a.txt', 'inside', 'd1');
  await new Promise((r) => setTimeout(r, 50));
  await exec(a, 'node -v'); // writes old/a.txt to disk
  // Rename the folder and the file in the explorer.
  a.doc.transact(() => {
    a.doc.getMap('nodes').set('d1', { id: 'd1', name: 'new', type: 'folder', parentId: null });
    a.doc.getMap('nodes').set('f1', { id: 'f1', name: 'b.txt', type: 'file', parentId: 'd1' });
  });
  await new Promise((r) => setTimeout(r, 50));
  const exit = await exec(a, 'node -v');
  assert.deepEqual(exit.changes.added, []);
  assert.deepEqual(Object.keys(files(a.doc)), ['new/b.txt']);
  const folders = [...a.doc.getMap('nodes').values()].filter((n) => n.type === 'folder').map((n) => n.name);
  assert.deepEqual(folders, ['new']);
  assert.equal(fs.existsSync(path.join(root, 'synq-shel-0006', 'old')), false);
});
