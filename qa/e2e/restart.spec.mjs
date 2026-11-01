// Phase 3: restart the QA server while a browser has the room open.
import { test } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { connect, emitAck, mirror, api } from '../scripts/lib.mjs';
import { closeDb, editorText, enterRoom, expect, loggedIn, openRoom, sleep, typeAt } from './helpers.mjs';

test.afterAll(() => closeDb());
const qa = fileURLToPath(new URL('..', import.meta.url));

/** Stops only the QA server (start-server.mjs and its plain `node src/index.js` child). */
function stopQaServer() {
  execFileSync('powershell', ['-NoProfile', '-Command',
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'start-server.mjs' -or $_.CommandLine -match '^\"?[^\"]*node(\.exe)?\"? +src/index.js$' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"]);
}
function startQaServer() {
  const log = fs.openSync(`${qa}logs/server.log`, 'a');
  const child = spawn(process.execPath, ['--env-file=../server/.env', 'scripts/start-server.mjs'], { cwd: qa, detached: true, stdio: ['ignore', log, log] });
  child.unref();
}

test('E9 the server restarts while a room is open: the code persists and the browser recovers', async ({ browser }) => {
  const room = await openRoom();
  const a = await loggedIn(browser, 'Alice');
  await enterRoom(a.page, room.roomId);
  await typeAt(a.page, 'before restart');
  await sleep(1800); // autosave
  room.socket.close();
  stopQaServer();
  await sleep(3000);
  startQaServer();
  for (let i = 0; i < 40 && !(await fetch('http://127.0.0.1:4100/api/health').then((r) => r.ok).catch(() => false)); i += 1) await sleep(500);
  await sleep(4000); // the client reconnects with backoff
  await typeAt(a.page, ' + after restart');
  await sleep(2500);
  // A brand-new connection must see both edits (saved on the server).
  const l = await api('/api/auth/login', { email: room.owner.email, password: room.owner.password });
  const s = await connect(l.data.accessToken);
  const ack = await emitAck(s, 'room:join', { roomId: room.roomId });
  const doc = mirror(s, ack);
  const saved = doc.getMap('texts').get(room.fileIds[0]).toString();
  s.close();
  expect(await editorText(a.page)).toBe('before restart + after restart');
  expect(saved).toBe('before restart + after restart');
});
