// For each socket event: start a fresh QA server (port 4101, synq_test), join a room,
// send the event with a null payload, and see whether the whole server process dies.
//   node --env-file=../server/.env scripts/crash-probe.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';
import { closeDb, createUser, newRoomId, sleep } from './lib.mjs';

process.env.QA_URL = 'http://127.0.0.1:4101';
const qa = fileURLToPath(new URL('..', import.meta.url));
const EVENTS = ['room:join', 'yjs:update', 'presence:update', 'cursor:move', 'chat:send', 'room:save', 'room:setRole', 'room:respond', 'room:remove', 'room:settings', 'run:request', 'shell:exec', 'live:open', 'live:stop', 'github:push', 'shell:list', 'shell:kill'];

function startServer() {
  const child = spawn(process.execPath, ['scripts/start-server.mjs'], {
    cwd: qa,
    env: { ...process.env, QA_PORT: '4101' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const ready = new Promise((resolve) => {
    const t = setInterval(() => out.includes('listening') && (clearInterval(t), resolve()), 100);
  });
  return { child, ready, log: () => out };
}

const results = [];
for (const event of EVENTS) {
  const srv = startServer();
  await srv.ready;
  const u = await createUser('Crash');
  const s = io('http://127.0.0.1:4101', { auth: { token: u.token }, transports: ['websocket'], reconnection: false, forceNew: true });
  await new Promise((r) => s.once('connect', r));
  await new Promise((r) => s.emit('room:join', { roomId: newRoomId() }, r));
  s.emit(event, null);
  await sleep(1200);
  const alive = srv.child.exitCode === null;
  const where = srv.log().match(/at Socket\.<anonymous> \(file:\/\/\/.*?(src\/[\w.]+:\d+)/)?.[1] ?? '';
  results.push({ event, payload: 'null', serverAlive: alive, crashAt: alive ? '' : where });
  s.close();
  srv.child.kill();
  await new Promise((r) => (srv.child.exitCode !== null ? r() : srv.child.once('exit', r)));
}
console.table(results);
await closeDb();
process.exit(0);
