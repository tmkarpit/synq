// Shared helpers for the QA scripts. Everything talks to the isolated QA server
// (QA_URL, default http://127.0.0.1:4100, database synq_test).
import fs from 'node:fs';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { io } from 'socket.io-client';
import * as Y from 'yjs';

export const BASE = process.env.QA_URL || 'http://127.0.0.1:4100';
const LOG = new URL('../logs/server.log', import.meta.url);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = () => randomBytes(4).toString('hex');

export async function api(path, body, { cookie, token, method = 'POST' } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: res.status, data, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}

/** The newest code the QA server printed for an address (OTP_DEV_LOG). */
async function codeFor(target) {
  for (let i = 0; i < 40; i += 1) {
    const log = fs.readFileSync(LOG, 'utf8');
    const line = log.split('\n').filter((l) => l.includes(`to ${target}:`)).at(-1);
    const code = line?.match(/(\d{6})\s*$/)?.[1];
    if (code) return code;
    await sleep(250);
  }
  throw new Error(`no code in the log for ${target}`);
}

let mongo = null;
const testDb = async () => {
  mongo ??= await MongoClient.connect('mongodb://127.0.0.1:27017');
  return mongo.db('synq_test');
};
export const closeDb = async () => {
  const client = mongo;
  mongo = null; // the next test file opens a fresh client
  await client?.close();
};

/**
 * A fresh account: inserted straight into synq_test (hashed exactly like accounts.js) and
 * logged in through the real /api/auth/login, so the signup rate limit (10 per address
 * per 10 minutes) does not get in the way. signupUser() goes through the real signup.
 */
export async function createUser(name = 'Tester') {
  const email = `qa-${name.toLowerCase()}-${rand()}@example.com`;
  const password = `Qa-pass-${rand()}`;
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  const db = await testDb();
  await db.collection('users').insertOne({
    _id: randomUUID(), email, emailLower: email, name, passwordHash: `scrypt$16384$8$1$${salt.toString('base64')}$${key.toString('base64')}`,
    emailVerifiedAt: new Date(), phone: null, phoneVerifiedAt: null, googleSub: null, createdAt: new Date(),
  });
  const l = await api('/api/auth/login', { email, password });
  if (l.status !== 200) throw new Error(`login failed: ${l.status} ${JSON.stringify(l.data)}`);
  return { email, password, name, token: l.data.accessToken, cookie: l.cookie, user: l.data.user };
}

/** Signs up through the real flow (email code from the QA server log). */
export async function signupUser(name = 'Tester') {
  const email = `qa-${name.toLowerCase()}-${rand()}@example.com`;
  const password = `Qa-pass-${rand()}`;
  const s = await api('/api/auth/signup', { name, email, password });
  if (s.status !== 200) throw new Error(`signup failed: ${s.status} ${JSON.stringify(s.data)}`);
  const v = await api('/api/auth/verify', { id: s.data.verify.id, code: await codeFor(email) });
  if (v.status !== 200) throw new Error(`verify failed: ${v.status} ${JSON.stringify(v.data)}`);
  return { email, password, name, token: v.data.accessToken, cookie: v.cookie, user: v.data.user };
}

export const newRoomId = () => {
  const a = '23456789abcdefghjkmnpqrstuvwxyz';
  const part = () => Array.from(randomBytes(4), (b) => a[b % a.length]).join('');
  return `synq-${part()}-${part()}`;
};

export function connect(token) {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { auth: token === undefined ? {} : { token }, transports: ['websocket'], reconnection: false, forceNew: true });
    s.once('connect', () => resolve(s));
    s.once('connect_error', (e) => { s.close(); reject(e); });
  });
}

export const emitAck = (socket, event, data, ms = 5000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no ack for ${event}`)), ms);
    socket.emit(event, data, (res) => { clearTimeout(t); resolve(res); });
  });

/** Waits for one event (optionally matching a predicate). */
export const next = (socket, event, pred = () => true, ms = 8000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => { socket.off(event, h); reject(new Error(`timeout waiting for ${event}`)); }, ms);
    const h = (d) => { if (pred(d)) { clearTimeout(t); socket.off(event, h); resolve(d); } };
    socket.on(event, h);
  });

/** Collects every payload of an event until stop() is called. */
export function collect(socket, event) {
  const items = [];
  const h = (d) => items.push(d);
  socket.on(event, h);
  return { items, stop: () => socket.off(event, h) };
}

/** A local Y.Doc mirror of the room, kept in sync over the socket. */
export function mirror(socket, joinAck) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(joinAck.state), 'remote');
  socket.on('yjs:update', ({ update }) => Y.applyUpdate(doc, new Uint8Array(update), 'remote'));
  doc.on('update', (u, origin) => { if (origin !== 'remote') socket.emit('yjs:update', { update: u }); });
  return doc;
}

/** Adds a file node the way the client does (workspaceDoc.createNode, without validation). */
export function addFile(doc, { name, content = '', parentId = null }) {
  const id = `f-${rand()}${rand()}`;
  doc.transact(() => {
    const text = new Y.Text();
    text.insert(0, content);
    doc.getMap('texts').set(id, text);
    doc.getMap('nodes').set(id, { id, name, type: 'file', parentId });
  });
  return id;
}

/** Owner + room: creates a user, a room, and joins it. */
export async function ownerRoom(name = 'Owner') {
  const owner = await createUser(name);
  const socket = await connect(owner.token);
  const roomId = newRoomId();
  const ack = await emitAck(socket, 'room:join', { roomId });
  if (ack.error) throw new Error(ack.error);
  return { owner, socket, roomId, ack, doc: mirror(socket, ack) };
}

/** A second member admitted into the room with a role. */
export async function admit(ownerSocket, roomId, name, role = 'editor') {
  const u = await createUser(name);
  const s = await connect(u.token);
  const admitted = next(s, 'room:admitted', () => true, 15000);
  const asked = next(ownerSocket, 'room:access', (a) => a.requests.length > 0);
  const first = await emitAck(s, 'room:join', { roomId, role }, 15000);
  let ack = first;
  if (first.pending) {
    const req = (await asked).requests.at(-1);
    await emitAck(ownerSocket, 'room:respond', { member: req.member, accept: true, role });
    await admitted;
    ack = await emitAck(s, 'room:join', { roomId });
  }
  if (ack.error) throw new Error(ack.error);
  return { user: u, socket: s, ack, doc: mirror(s, ack) };
}

export async function health() {
  try { return (await fetch(`${BASE}/api/health`)).ok; } catch { return false; }
}
