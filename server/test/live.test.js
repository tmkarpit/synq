import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import * as Y from 'yjs';
import { io as connect } from 'socket.io-client';
import { createSynqServer } from '../src/app.js';
import { Shell } from '../src/shell.js';
import { syntaxError } from '../src/live.js';

// Go Live: a room's HTML served at /live/<token>/..., sandboxed, reloading on changes.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'synq-live-test-'));
let server;
let url;
const sockets = [];

before(async () => {
  server = createSynqServer({ dataDir: path.join(tmp, 'data'), shell: new Shell({ root: path.join(tmp, 'ws') }), languages: {} });
  const { port } = await server.listen(0, '127.0.0.1');
  url = `http://127.0.0.1:${port}`;
});

after(async () => {
  sockets.forEach((s) => s.disconnect());
  await server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function client(roomId) {
  const socket = connect(url, { transports: ['websocket'], forceNew: true });
  sockets.push(socket);
  const doc = new Y.Doc();
  socket.on('yjs:update', ({ update }) => Y.applyUpdate(doc, new Uint8Array(update), 'remote'));
  doc.on('update', (update, origin) => origin !== 'remote' && socket.emit('yjs:update', { update }));
  await new Promise((r) => socket.on('connect', r));
  const res = await socket.emitWithAck('room:join', { roomId, username: 'ada', memberKey: 'ada-member-key-live01' });
  if (res.state) Y.applyUpdate(doc, new Uint8Array(res.state), 'remote');
  return { socket, doc };
}

function add(doc, id, name, content, parentId = null, type = 'file') {
  doc.transact(() => {
    if (type === 'file') doc.getMap('texts').set(id, new Y.Text(content));
    doc.getMap('nodes').set(id, { id, name, type, parentId });
  });
}

const get = async (p) => {
  const res = await fetch(`${url}${p}`);
  return { status: res.status, type: res.headers.get('content-type'), csp: res.headers.get('content-security-policy'), body: await res.text() };
};

test('serves the room as a sandboxed site, with live reload on edits', async () => {
  const a = await client('synq-live-0001');
  add(a.doc, 'f1', 'index.html', '<html><head><link rel="stylesheet" href="css/site.css"></head><body><h1>Hi</h1></body></html>');
  a.doc.getMap('nodes').set('d1', { id: 'd1', name: 'css', type: 'folder', parentId: null });
  add(a.doc, 'f2', 'site.css', 'h1 { color: red }', 'd1');
  add(a.doc, 'f3', 'app.js', 'console.log(1)');
  await new Promise((r) => setTimeout(r, 80));

  const { url: link } = await a.socket.emitWithAck('live:open', { path: 'index.html' });
  assert.match(link, /^\/live\/[\w-]{20,}\/index\.html$/);
  assert.match((await a.socket.emitWithAck('live:open', { path: 'nope.html' })).error, /no longer exists/);

  const page = await get(link);
  assert.equal(page.status, 200);
  assert.match(page.type, /text\/html/);
  assert.match(page.csp, /^sandbox allow-scripts/);
  assert.doesNotMatch(page.csp, /allow-same-origin/); // cannot reach SYNQ's cookies or storage
  // The live script goes first in <head> (it also catches errors from the page's scripts).
  assert.match(page.body, /^<html><head><script data-synq-live>[\s\S]*EventSource[\s\S]*<\/script><link rel="stylesheet"[\s\S]*<h1>Hi<\/h1><\/body><\/html>$/);

  const base = link.replace(/index\.html$/, '');
  assert.equal((await get(base)).status, 200); // a folder address serves index.html
  const css = await get(`${base}css/site.css`);
  assert.equal(css.body, 'h1 { color: red }');
  assert.match(css.type, /text\/css/);
  assert.match((await get(`${base}app.js`)).type, /text\/javascript/);
  assert.equal((await get(`${base}missing.png`)).status, 404);
  assert.equal((await get(`${base}..%2F..%2Fpackage.json`)).status, 400);
  assert.equal((await get('/live/not-a-real-token/index.html')).status, 404);

  // A file only on disk (e.g. an image the terminal downloaded) is served too.
  fs.mkdirSync(path.join(tmp, 'ws', 'synq-live-0001'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'ws', 'synq-live-0001', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const png = await fetch(`${url}${base}logo.png`);
  assert.equal(png.headers.get('content-type'), 'image/png');
  assert.equal((await png.arrayBuffer()).byteLength, 4);

  // The event stream says which page changed after an edit (the page patches itself).
  const events = await new Promise((resolve) => {
    const req = http.get(`${url}${base}__live`, (res) => {
      let text = '';
      res.on('data', (c) => {
        text += c;
        if (text.includes('"update"')) {
          req.destroy();
          resolve(text);
        }
      });
      setTimeout(() => a.doc.getMap('texts').get('f1').insert(0, '<!-- edited -->'), 100);
    });
  });
  assert.deepEqual(JSON.parse(/data: (\{.*\})/.exec(events)[1]), { type: 'update', css: [], html: ['index.html'], reload: false });
  assert.match((await get(link)).body, /^<!-- edited --><html><head><script data-synq-live>/);
});

test('the live server can be stopped (like "Port : 5500" in VS Code); the room is told', async () => {
  const a = await client('synq-live-0002');
  add(a.doc, 'f1', 'index.html', '<h1>x</h1>');
  await new Promise((r) => setTimeout(r, 80));
  const states = [];
  a.socket.on('live:state', (s) => states.push(s.live));
  const { url: link } = await a.socket.emitWithAck('live:open', { path: 'index.html' });
  assert.equal((await get(link)).status, 200);

  // Someone joining now sees that the room is live.
  const late = connect(url, { transports: ['websocket'], forceNew: true });
  sockets.push(late);
  await new Promise((r) => late.on('connect', r));
  assert.equal((await late.emitWithAck('room:join', { roomId: 'synq-live-0002', username: 'ada', memberKey: 'ada-member-key-live01' })).live, true);

  const stream = new Promise((resolve) => {
    http.get(`${url}${link.replace(/index\.html$/, '__live')}`, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve(text));
    });
  });
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(await a.socket.emitWithAck('live:stop', {}), { ok: true });
  assert.match(await stream, /data: stopped/);
  assert.equal((await get(link)).status, 404); // the address no longer works
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(states, [true, false]);

  // Opening again gives a new address.
  const again = await a.socket.emitWithAck('live:open', { path: 'index.html' });
  assert.notEqual(again.url, link);
  assert.equal((await get(again.url)).status, 200);

  // Viewers cannot stop it.
  await a.socket.emitWithAck('room:settings', { approval: false });
  const v = connect(url, { transports: ['websocket'], forceNew: true });
  sockets.push(v);
  await new Promise((r) => v.on('connect', r));
  await v.emitWithAck('room:join', { roomId: 'synq-live-0002', username: 'vic', memberKey: 'vic-member-key-live02', role: 'viewer' });
  assert.match((await v.emitWithAck('live:stop', {})).error, /Viewers/);
});

/** Collects the JSON messages of a preview's event stream. */
function listen(eventsUrl) {
  const messages = [];
  let req;
  const ready = new Promise((resolve) => {
    req = http.get(eventsUrl, (res) => {
      let buffer = '';
      res.on('data', (c) => {
        buffer += c;
        const parts = buffer.split('\n\n');
        buffer = parts.pop();
        parts.forEach((p) => p.startsWith('data: {') && messages.push(JSON.parse(p.slice(6))));
      });
      resolve();
    });
  });
  return { messages, ready, close: () => req.destroy() };
}
const settle = () => new Promise((r) => setTimeout(r, 450));

test('hot updates: CSS swaps in place, JS reloads, broken JS waits with an error overlay', async () => {
  const a = await client('synq-live-0003');
  add(a.doc, 'f1', 'index.html', '<!doctype html><html><head><link rel="stylesheet" href="site.css"></head><body><script src="app.js"></script></body></html>');
  add(a.doc, 'f2', 'site.css', 'h1 { color: red }');
  add(a.doc, 'f3', 'app.js', 'console.log(1)');
  add(a.doc, 'f4', 'notes.md', '# notes');
  await new Promise((r) => setTimeout(r, 80));
  const { url: link } = await a.socket.emitWithAck('live:open', { path: 'index.html' });
  const page = (await get(link)).body;
  assert.match(page, /^<!doctype html><html><head><script data-synq-live>/); // never before the doctype
  assert.match(page, /<script crossorigin="anonymous" src="app.js">/); // so its errors have details
  const live = listen(`${url}${link.replace(/index\.html$/, '__live')}`);
  await live.ready;
  await settle();
  const texts = a.doc.getMap('texts');

  texts.get('f2').insert(0, 'body { margin: 0 } ');
  await settle();
  assert.deepEqual(live.messages.pop(), { type: 'update', css: ['site.css'], html: [], reload: false });

  texts.get('f4').insert(0, 'more ');
  await settle();
  assert.equal(live.messages.length, 0); // notes do not touch the page

  // Half-typed code: no reload, the error instead.
  texts.get('f3').insert(texts.get('f3').length, '\nfunction (');
  await settle();
  assert.deepEqual(live.messages.pop(), { type: 'error', file: 'app.js', line: 2, column: 10, message: 'Unexpected token' });
  // Styles still update meanwhile; the page change waits.
  texts.get('f2').insert(0, 'p { } ');
  texts.get('f1').insert(0, '<!-- x -->');
  await settle();
  assert.deepEqual(live.messages.splice(0), [
    { type: 'update', css: ['site.css'], html: [], reload: false },
    { type: 'error', file: 'app.js', line: 2, column: 10, message: 'Unexpected token' },
  ]);

  // Fixed: the overlay goes and everything held back arrives.
  a.doc.transact(() => {
    const code = texts.get('f3');
    code.delete(0, code.length);
    code.insert(0, 'console.log(1)\nfunction a() {}');
  });
  await settle();
  assert.deepEqual(live.messages.splice(0), [{ type: 'ok' }, { type: 'update', css: [], html: ['index.html'], reload: true }]);
  live.close();
});

test('syntax checks cover JS files and inline scripts, with the right line', () => {
  assert.equal(syntaxError('a.js', 'import x from "./x.js"; export const y = await x;'), null);
  assert.equal(syntaxError('a.js', 'with (o) { a = 010 }'), null); // classic-only script
  assert.equal(syntaxError('a.css', 'not { js'), null);
  assert.equal(syntaxError('a.html', '<script type="application/json">{ nope</script><script src="x.js">bad (</script>'), null);
  assert.deepEqual(syntaxError('a.html', '<p>\n</p>\n<script>\nlet a = ;\n</script>'), { line: 4, column: 9, message: 'Unexpected token' });
  assert.deepEqual(syntaxError('a.js', 'let = = 1').line, 1);
});
