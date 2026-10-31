import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import * as Y from 'yjs';
import { io as connect } from 'socket.io-client';
import { createSynqServer } from '../src/app.js';
import { MongoStore } from '../src/db/mongoStore.js';
import { Accounts } from '../src/accounts.js';
import { GitHub } from '../src/github.js';
import { contentHash } from '../src/projectFiles.js';

// "Push to GitHub" against a fake GitHub API. Needs TEST_MONGODB_URI (a throwaway
// database; it is dropped first):  npm run test:db
const URI = process.env.TEST_MONGODB_URI;
const skip = !URI && 'set TEST_MONGODB_URI to run the GitHub tests';
const SECRET = 'test-secret-that-is-at-least-32-characters-long';
const TOKEN = 'ghp_faketoken000000000000000000000000';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synq-gh-test-'));
const sent = [];
const sender = { email: true, sms: false, devLog: false, sendEmail: async ({ to, text }) => sent.push({ to, code: /(\d{6})/.exec(text)[1] }) };

// A tiny GitHub: repositories with refs, trees and commits, enough for a push.
const repos = new Map();
const calls = [];
let n = 0;
const sha = () => `sha${(n += 1)}`;
const fake = http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const data = body ? JSON.parse(body) : {};
  calls.push(`${req.method} ${req.url}`);
  const reply = (status, json) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(json));
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return reply(401, { message: 'Bad credentials' });
  if (req.url === '/user') return reply(200, { login: 'octo' });
  if (req.method === 'POST' && req.url === '/user/repos') {
    const repo = { default_branch: 'main', html_url: `https://github.com/octo/${data.name}`, private: data.private, refs: {}, commits: {}, trees: {} };
    const first = sha();
    repo.trees[first] = [{ path: 'README.md', content: '# hi' }];
    repo.commits[first] = { tree: first, parents: [] };
    repo.refs.main = first;
    repos.set(`octo/${data.name}`, repo);
    return reply(201, repo);
  }
  const m = /^\/repos\/([^/]+\/[^/]+)(\/.*)?$/.exec(req.url);
  const repo = m && repos.get(m[1]);
  if (!repo) return reply(404, { message: 'Not Found' });
  const rest = m[2] || '';
  if (!rest) return reply(200, repo);
  const ref = /^\/git\/refs?\/heads\/(.+)$/.exec(rest);
  if (req.method === 'GET' && ref) return repo.refs[ref[1]] ? reply(200, { object: { sha: repo.refs[ref[1]] } }) : reply(404, { message: 'Not Found' });
  if (req.method === 'POST' && rest === '/git/trees') {
    const id = sha();
    repo.trees[id] = data.tree.map((t) => ({ path: t.path, content: t.content }));
    return reply(201, { sha: id });
  }
  if (req.method === 'POST' && rest === '/git/commits') {
    const id = sha();
    repo.commits[id] = { tree: data.tree, parents: data.parents, message: data.message };
    return reply(201, { sha: id });
  }
  if (req.method === 'PATCH' && ref) {
    repo.refs[ref[1]] = data.sha;
    return reply(200, {});
  }
  if (req.method === 'POST' && rest === '/git/refs') {
    repo.refs[data.ref.replace('refs/heads/', '')] = data.sha;
    return reply(201, {});
  }
  return reply(404, { message: 'Not Found' });
});

let server;
let url;
let users;
const sockets = [];

before(async () => {
  if (skip) return;
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const store = new MongoStore({ uri: URI, dataDir });
  await store.client.connect();
  await store.db.dropDatabase();
  users = store.db.collection('users');
  const github = new GitHub({ users, secret: SECRET, apiBase: `http://127.0.0.1:${fake.address().port}` });
  server = createSynqServer({ dataDir, store, accounts: new Accounts({ db: store.db, secret: SECRET, sender }), github, languages: {} });
  const { port } = await server.listen(0, '127.0.0.1');
  url = `http://127.0.0.1:${port}`;
});

after(async () => {
  sockets.forEach((s) => s.disconnect());
  await server?.close();
  fake.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const api = (method, route, token, body) =>
  fetch(`${url}${route}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

async function signup(email) {
  const start = await (await fetch(`${url}/api/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Ada', email, password: 'correct horse' }) })).json();
  const code = [...sent].reverse().find((s) => s.to === email).code;
  const res = await fetch(`${url}/api/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: start.verify.id, code }) });
  return (await res.json()).accessToken;
}

async function roomWith(token, roomId, files) {
  const socket = connect(url, { transports: ['websocket'], forceNew: true, auth: { token } });
  sockets.push(socket);
  await new Promise((r) => socket.on('connect', r));
  const res = await socket.emitWithAck('room:join', { roomId, username: 'ada' });
  const doc = new Y.Doc();
  if (res.state) Y.applyUpdate(doc, new Uint8Array(res.state), 'remote');
  doc.on('update', (update, origin) => origin !== 'remote' && socket.emit('yjs:update', { update }));
  doc.transact(() => {
    files.forEach(([id, name, content, parentId = null, type = 'file']) => {
      if (type === 'file') doc.getMap('texts').set(id, new Y.Text(content));
      doc.getMap('nodes').set(id, { id, name, type, parentId });
    });
  });
  await new Promise((r) => setTimeout(r, 80));
  return { socket, doc, res };
}

test('connect a token: checked with GitHub, stored encrypted, never sent back', { skip }, async () => {
  const token = await signup('ada@example.com');
  assert.deepEqual(await (await api('GET', '/api/github', token)).json(), { connected: false, login: null });
  const bad = await api('POST', '/api/github/token', token, { token: 'ghp_wrongwrongwrongwrongwrong' });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /did not accept/);
  assert.deepEqual(await (await api('POST', '/api/github/token', token, { token: TOKEN })).json(), { login: 'octo' });
  assert.deepEqual(await (await api('GET', '/api/github', token)).json(), { connected: true, login: 'octo' });
  const stored = await users.findOne({ emailLower: 'ada@example.com' });
  assert.doesNotMatch(JSON.stringify(stored), new RegExp(TOKEN)); // encrypted at rest
  assert.equal((await api('GET', '/api/github', 'not-a-jwt')).status, 401);
});

test('push creates the repository, commits the room as a snapshot, and remembers it', { skip }, async () => {
  const token = await signup('bo@example.com');
  await api('POST', '/api/github/token', token, { token: TOKEN });
  const { socket, doc } = await roomWith(token, 'synq-ghub-0001', [
    ['f1', 'index.html', '<h1>Hi</h1>'],
    ['d1', 'src', '', null, 'folder'],
    ['f2', 'app.js', 'console.log(1)', 'd1'],
  ]);

  const first = await socket.emitWithAck('github:push', { repo: 'my-site', message: 'First push' });
  assert.equal(first.error, undefined);
  assert.equal(first.repo, 'octo/my-site');
  assert.equal(first.created, true);
  assert.equal(first.branch, 'main');
  assert.equal(first.url, 'https://github.com/octo/my-site');
  const repo = repos.get('octo/my-site');
  assert.equal(repo.private, true);
  const head = repo.commits[repo.refs.main];
  assert.equal(head.message, 'First push');
  assert.deepEqual(repo.trees[head.tree].map((f) => f.path).sort(), ['index.html', 'src/app.js']); // README replaced: a snapshot

  // Delete a file in the room and push again: it is gone on GitHub too.
  doc.transact(() => {
    doc.getMap('nodes').delete('f1');
    doc.getMap('texts').delete('f1');
  });
  await new Promise((r) => setTimeout(r, 80));
  const second = await socket.emitWithAck('github:push', { repo: 'my-site', branch: 'dev' });
  assert.equal(second.created, false);
  assert.equal(second.url, 'https://github.com/octo/my-site/tree/dev');
  const dev = repo.commits[repo.refs.dev];
  assert.deepEqual(repo.trees[dev.tree].map((f) => f.path), ['src/app.js']);
  assert.equal(dev.parents[0], repo.refs.main); // a new branch starts from the default branch
  assert.equal(dev.message, 'Update from SYNQ');

  // Joining again offers the same repository, with each pushed file's fingerprint
  // (Source Control compares with them).
  const again = await roomWith(token, 'synq-ghub-0001', []);
  assert.equal(again.res.github.repo, 'octo/my-site');
  assert.equal(again.res.github.branch, 'dev');
  assert.equal(again.res.github.by, 'Ada');
  assert.match(again.res.github.commitUrl, /\/commit\/sha\d+$/);
  assert.deepEqual(again.res.github.files, [['src/app.js', contentHash('console.log(1)')]]);

  // A push tells everyone in the room.
  const state = new Promise((r) => again.socket.once('github:state', r));
  await socket.emitWithAck('github:push', { repo: 'my-site', branch: 'dev', message: 'Again' });
  assert.equal((await state).files.length, 1);
});

test('push errors are clear', { skip }, async () => {
  const token = await signup('cy@example.com');
  const { socket } = await roomWith(token, 'synq-ghub-0002', [['f1', 'a.txt', 'a']]);
  assert.match((await socket.emitWithAck('github:push', { repo: 'x' })).error, /Connect your GitHub/);
  await api('POST', '/api/github/token', token, { token: TOKEN });
  assert.match((await socket.emitWithAck('github:push', { repo: 'bad name!' })).error, /repository name/);
  assert.match((await socket.emitWithAck('github:push', { repo: 'x', branch: 'a..b' })).error, /branch/);
  assert.match((await socket.emitWithAck('github:push', { repo: 'someone/else' })).error, /not found/);

  const empty = await roomWith(token, 'synq-ghub-0003', []);
  assert.match((await empty.socket.emitWithAck('github:push', { repo: 'x' })).error, /no files/);

  // Disconnecting removes the token.
  assert.equal((await api('DELETE', '/api/github/token', token)).status, 200);
  assert.match((await socket.emitWithAck('github:push', { repo: 'x' })).error, /Connect your GitHub/);
  assert.ok(calls.length > 0);
});
