import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { io as connect } from 'socket.io-client';
import { createSynqServer } from '../src/app.js';
import { MongoStore } from '../src/db/mongoStore.js';
import { Accounts } from '../src/accounts.js';

// Runs only with TEST_MONGODB_URI (a throwaway database; it is dropped first):
//   npm run test:db
const URI = process.env.TEST_MONGODB_URI;
const skip = !URI && 'set TEST_MONGODB_URI to run the account tests';
const SECRET = 'test-secret-that-is-at-least-32-characters-long';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synq-acct-test-'));

// Codes are captured instead of sent; Google tokens are "google:<sub>:<email>:<verified>".
const sent = [];
const sender = {
  email: true,
  sms: true,
  devLog: false,
  sendEmail: async ({ to, text }) => sent.push({ to, code: /(\d{6})/.exec(text)[1] }),
  sendSms: async ({ to, body }) => sent.push({ to, code: /(\d{6})/.exec(body)[1] }),
};
const lastCode = (to) => [...sent].reverse().find((m) => m.to === to)?.code;
const verifyGoogle = async (credential) => {
  const [kind, sub, email, verified] = credential.split(':');
  if (kind !== 'google') throw new Error('bad token');
  return { sub, email, email_verified: verified === 'yes', name: 'Gina Google' };
};
let server;
let url;
const sockets = [];

before(async () => {
  if (skip) return;
  const store = new MongoStore({ uri: URI, dataDir });
  await store.client.connect();
  await store.db.dropDatabase();
  server = createSynqServer({ dataDir, store, accounts: new Accounts({ db: store.db, secret: SECRET, sender, googleClientId: 'test-client', verifyGoogle }), languages: {} });
  const { port } = await server.listen(0, '127.0.0.1');
  url = `http://127.0.0.1:${port}`;
});

after(async () => {
  sockets.forEach((s) => s.disconnect());
  await server?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const post = (route, body, cookie) =>
  fetch(`${url}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
const get = (route, token) => fetch(`${url}${route}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
const cookieOf = (res) => res.headers.get('set-cookie')?.split(';')[0];

/** Sign-up is two steps now: the form, then the code from the email. */
async function signup(body) {
  const start = await (await post('/api/auth/signup', body)).json();
  return post('/api/auth/verify', { id: start.verify.id, code: lastCode(body.email.toLowerCase()) });
}

function socketWith(token) {
  const socket = connect(url, { transports: ['websocket'], forceNew: true, auth: token ? { token } : {} });
  sockets.push(socket);
  return socket;
}

test('sign up returns a JWT and sets an httpOnly refresh cookie for /api/auth only', { skip }, async () => {
  const res = await signup({ name: 'Ada', email: 'Ada@Example.com', password: 'correct horse' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.user.email, 'ada@example.com');
  assert.match(res.headers.get('set-cookie'), /^synq_refresh=[\w-]+; Path=\/api\/auth; HttpOnly; SameSite=Lax/);

  const claims = jwt.verify(body.accessToken, SECRET, { algorithms: ['HS256'], issuer: 'synq', audience: 'synq' });
  assert.equal(claims.sub, body.user.id);
  assert.equal(claims.name, 'Ada');
  assert.ok(claims.exp - claims.iat <= 15 * 60);

  assert.equal((await (await get('/api/auth/me', body.accessToken)).json()).user.name, 'Ada');
  assert.equal((await get('/api/auth/me')).status, 401);

  assert.equal((await post('/api/auth/signup', { name: 'Ada 2', email: 'ada@example.com', password: 'whatever123' })).status, 409);
  assert.equal((await post('/api/auth/signup', { name: 'Ada', email: 'x@example.com', password: 'short' })).status, 400);
  assert.equal((await post('/api/auth/login', { email: 'ada@example.com', password: 'wrong password' })).status, 401);
  // JSON only: a plain form post from another site is refused.
  assert.equal((await fetch(`${url}/api/auth/login`, { method: 'POST', body: 'email=a' })).status, 415);
});

test('forged, tampered and expired access tokens are refused', { skip }, async () => {
  const { user, accessToken } = await (await post('/api/auth/login', { email: 'ada@example.com', password: 'correct horse' })).json();
  const forged = jwt.sign({ name: 'Ada', typ: 'access' }, 'some-other-secret-of-sufficient-length!!', { subject: user.id, issuer: 'synq', audience: 'synq' });
  const [h, , s] = accessToken.split('.');
  const tampered = `${h}.${Buffer.from(JSON.stringify({ sub: 'someone-else', typ: 'access' })).toString('base64url')}.${s}`;
  const expired = jwt.sign({ name: 'Ada', typ: 'access' }, SECRET, { subject: user.id, issuer: 'synq', audience: 'synq', expiresIn: -10 });
  const none = jwt.sign({ name: 'Ada', typ: 'access' }, null, { algorithm: 'none', subject: user.id, issuer: 'synq', audience: 'synq' });
  for (const token of [forged, tampered, expired, none]) assert.equal((await get('/api/auth/me', token)).status, 401);
});

test('refresh rotates the token; a reused old token ends the whole login', { skip }, async () => {
  const login = await post('/api/auth/login', { email: 'ada@example.com', password: 'correct horse' });
  const first = cookieOf(login);

  const r1 = await post('/api/auth/refresh', {}, first);
  assert.equal(r1.status, 200);
  const second = cookieOf(r1);
  assert.notEqual(second, first);
  assert.ok((await r1.json()).accessToken);

  // Within the grace window the old token still works once more (two tabs at once)...
  assert.equal((await post('/api/auth/refresh', {}, first)).status, 200);
  // ...but after it, reusing it means it was copied: the family is revoked.
  await server.store.db
    .collection('refresh_tokens')
    .updateMany({ revokedReason: 'rotated' }, { $set: { revokedAt: new Date(Date.now() - 60_000) } });
  assert.equal((await post('/api/auth/refresh', {}, first)).status, 401);
  assert.equal((await post('/api/auth/refresh', {}, second)).status, 401); // the newer one died too

  // Logout ends the login.
  const again = cookieOf(await post('/api/auth/login', { email: 'ada@example.com', password: 'correct horse' }));
  await post('/api/auth/logout', {}, again);
  assert.equal((await post('/api/auth/refresh', {}, again)).status, 401);
  assert.deepEqual(await (await post('/api/auth/refresh', {})).json(), { user: null });
});

test('rooms need a JWT; the account name is used; my rooms are listed', { skip }, async () => {
  const anon = socketWith(null);
  assert.equal((await new Promise((resolve) => anon.on('connect_error', resolve))).message, 'unauthorized');

  const { accessToken } = await (await signup({ name: 'Grace', email: 'grace@example.com', password: 'hopper1906' })).json();
  const socket = socketWith(accessToken);
  await new Promise((r) => socket.on('connect', r));
  const res = await socket.emitWithAck('room:join', { roomId: 'synq-acct-0001', username: 'ignored', roomName: 'Compilers' });
  assert.equal(res.self.username, 'Grace');
  assert.equal(res.self.role, 'owner');
  assert.equal(res.room.name, 'Compilers');

  const rooms = await (await get('/api/rooms', accessToken)).json();
  assert.deepEqual(rooms.rooms.map((r) => [r.id, r.name, r.role]), [['synq-acct-0001', 'Compilers', 'owner']]);
  assert.equal((await get('/api/rooms')).status, 401);
});

test('hardening: example secret refused, email as password refused, security headers sent', { skip }, async () => {
  assert.throws(() => new Accounts({ db: null, secret: 'change-me-to-a-long-random-string-of-32-plus-characters' }), /example value/);
  assert.throws(() => new Accounts({ db: null, secret: 'short' }), /at least 32/);
  const res = await post('/api/auth/signup', { name: 'Eve', email: 'eve@example.com', password: 'EVE@example.com' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /email address as the password/);
  const me = await get('/api/auth/me');
  assert.equal(me.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(me.headers.get('x-frame-options'), 'DENY');
  assert.equal(me.headers.get('cache-control'), 'no-store');
});

test('sign-up only creates the account after the emailed code; wrong codes run out', { skip }, async () => {
  const start = await (await post('/api/auth/signup', { name: 'Neo', email: 'neo@example.com', password: 'there-is-no-spoon' })).json();
  assert.equal(start.verify.channel, 'email');
  assert.equal(start.verify.to, 'n**@example.com');
  assert.equal(start.verify.code, undefined); // never sent to the browser
  assert.equal(await server.store.db.collection('users').countDocuments({ emailLower: 'neo@example.com' }), 0);
  const stored = await server.store.db.collection('otp_codes').findOne({ _id: start.verify.id });
  assert.notEqual(stored.codeHash, lastCode('neo@example.com')); // only an HMAC is kept
  assert.equal(JSON.stringify(stored).includes(lastCode('neo@example.com')), false);

  const code = lastCode('neo@example.com');
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 4; i += 1) assert.match((await (await post('/api/auth/verify', { id: start.verify.id, code: wrong })).json()).error, /not right/);
  assert.equal((await post('/api/auth/verify', { id: start.verify.id, code: wrong })).status, 400); // 5th
  assert.equal((await post('/api/auth/verify', { id: start.verify.id, code })).status, 429); // locked now

  // Resend: not before 60 seconds, then a fresh code with fresh tries.
  assert.equal((await post('/api/auth/resend', { id: start.verify.id })).status, 429);
  await server.store.db.collection('otp_codes').updateOne({ _id: start.verify.id }, { $set: { lastSentAt: new Date(Date.now() - 120_000) } });
  assert.equal((await post('/api/auth/resend', { id: start.verify.id })).status, 200);
  const ok = await post('/api/auth/verify', { id: start.verify.id, code: lastCode('neo@example.com') });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).user.name, 'Neo');
  assert.equal((await post('/api/auth/verify', { id: start.verify.id, code: lastCode('neo@example.com') })).status, 400); // used up
});

test('log in with a code by email or phone; unknown addresses look the same', { skip }, async () => {
  const neo = await (await post('/api/auth/login', { email: 'neo@example.com', password: 'there-is-no-spoon' })).json();
  // Add and verify a phone (signed in).
  const phoneStart = await (await fetch(`${url}/api/auth/phone`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${neo.accessToken}` },
    body: JSON.stringify({ phone: '98765 43210' }),
  })).json();
  assert.equal(phoneStart.verify.channel, 'sms');
  assert.equal(phoneStart.verify.to, '+91******3210');
  // The code only works for the account that asked.
  assert.equal((await post('/api/auth/verify', { id: phoneStart.verify.id, code: lastCode('+919876543210') })).status, 403);
  const again = await post('/api/auth/resend', { id: phoneStart.verify.id });
  assert.equal(again.status, 429); // still inside the 60s window
  await server.store.db.collection('otp_codes').updateOne({ _id: phoneStart.verify.id }, { $set: { lastSentAt: new Date(Date.now() - 120_000) } });
  await post('/api/auth/resend', { id: phoneStart.verify.id });
  const saved = await (await fetch(`${url}/api/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${neo.accessToken}` },
    body: JSON.stringify({ id: phoneStart.verify.id, code: lastCode('+919876543210') }),
  })).json();
  assert.equal(saved.account.phone, '+919876543210');

  for (const identifier of ['neo@example.com', '+91 98765 43210']) {
    const { verify } = await (await post('/api/auth/code', { identifier })).json();
    const target = identifier.includes('@') ? identifier : '+919876543210';
    const res = await post('/api/auth/verify', { id: verify.id, code: lastCode(target) });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).user.email, 'neo@example.com');
    assert.match(res.headers.get('set-cookie'), /synq_refresh=/);
  }
  // Unknown email: same answer, but nothing is sent and no code works.
  const count = sent.length;
  const ghost = await post('/api/auth/code', { identifier: 'nobody@example.com' });
  assert.equal(ghost.status, 200);
  assert.equal(sent.length, count);
  assert.equal((await post('/api/auth/verify', { id: (await ghost.json()).verify.id, code: '123456' })).status, 400);
});

test('Continue with Google creates, links and signs in accounts', { skip }, async () => {
  const fresh = await post('/api/auth/google', { credential: 'google:g-1:gina@gmail.com:yes' });
  assert.equal(fresh.status, 200);
  const gina = await fresh.json();
  assert.equal(gina.user.email, 'gina@gmail.com');
  assert.equal(gina.user.name, 'Gina Google');
  // The same Google account again: the same user.
  assert.equal((await (await post('/api/auth/google', { credential: 'google:g-1:gina@gmail.com:yes' })).json()).user.id, gina.user.id);
  // A Google account with the email of a password account links to it.
  const neo = await (await post('/api/auth/google', { credential: 'google:g-2:neo@example.com:yes' })).json();
  assert.equal(neo.user.name, 'Neo');
  // Unverified email or a bad token: refused. A Google-only account has no password.
  assert.equal((await post('/api/auth/google', { credential: 'google:g-3:x@gmail.com:no' })).status, 401);
  assert.equal((await post('/api/auth/google', { credential: 'forged' })).status, 401);
  assert.equal((await post('/api/auth/login', { email: 'gina@gmail.com', password: 'anything-at-all' })).status, 401);
  const config = await (await fetch(`${url}/api/auth/config`)).json();
  assert.deepEqual(config, { google: 'test-client', email: true, sms: true, devCodes: false });
});
