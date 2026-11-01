// Phase 7 load test: N sockets in one room for D seconds against the QA server.
// Each client: cursor:move 5x/s, one text edit per second. Latency = chat round trip.
//   node scripts/load.mjs [clients=30] [seconds=120]
import { addFile, closeDb, connect, createUser, emitAck, mirror, ownerRoom, sleep } from './lib.mjs';

const N = Number(process.argv[2] || 30);
const SECONDS = Number(process.argv[3] || 120);
const host = await ownerRoom('LoadHost');
await emitAck(host.socket, 'room:settings', { approval: false });
const fileId = addFile(host.doc, { name: 'load.js', content: '' });
await sleep(500);

const clients = [];
let errors = 0;
for (let i = 0; i < N; i += 1) {
  const u = await createUser(`Load${i}`);
  const s = await connect(u.token);
  s.on('connect_error', () => (errors += 1));
  s.on('disconnect', (r) => r !== 'io client disconnect' && (errors += 1));
  const ack = await emitAck(s, 'room:join', { roomId: host.roomId });
  if (ack.error) throw new Error(ack.error);
  clients.push({ s, doc: mirror(s, ack), i });
}
const memBefore = await fetch('http://127.0.0.1:4100/api/health').then((r) => r.json());
console.log(`${N} clients joined room ${host.roomId}; running ${SECONDS}s`);

const latencies = [];
const pending = new Map();
host.socket.on('chat:message', (m) => {
  const t = pending.get(m.text);
  if (t) { latencies.push(Date.now() - t); pending.delete(m.text); }
});
const timers = clients.flatMap(({ s, doc, i }) => [
  setInterval(() => s.emit('cursor:move', { fileId, position: { lineNumber: 1, column: i } }), 200),
  setInterval(() => { const t = doc.getMap('texts').get(fileId); t.insert(Math.floor(Math.random() * (t.length + 1)), String(i % 10)); }, 1000),
]);
const probe = setInterval(() => {
  const c = clients[Math.floor(Math.random() * clients.length)];
  const text = `ping-${Date.now()}-${Math.random()}`;
  pending.set(text, Date.now());
  c.s.emit('chat:send', { text });
}, 500);

await sleep(SECONDS * 1000);
timers.forEach(clearInterval);
clearInterval(probe);
await sleep(3000);
const texts = clients.map(({ doc }) => doc.getMap('texts').get(fileId).toString());
const converged = texts.every((t) => t === texts[0]) && texts[0] === host.doc.getMap('texts').get(fileId).toString();
latencies.sort((a, b) => a - b);
const pct = (p) => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))];
console.log(JSON.stringify({
  clients: N, seconds: SECONDS, edits: texts[0].length, converged, errors,
  chatProbes: latencies.length, lost: pending.size,
  latencyMs: { p50: pct(50), p95: pct(95), p99: pct(99), max: latencies.at(-1) },
  health: memBefore,
}, null, 1));
clients.forEach(({ s }) => s.close());
host.socket.close();
await closeDb();
process.exit(0);
