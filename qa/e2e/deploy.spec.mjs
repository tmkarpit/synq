// Deployment check: the website (QA_BASE, like Vercel) and the server (QA_URL, like Render)
// on different origins. Run with QA_URL=http://127.0.0.1:4300 QA_BASE=http://127.0.0.1:4173.
import fs from 'node:fs';
import { test } from '@playwright/test';
import { closeDb, editorText, enterRoom, expect, fileText, loggedIn, openRoom, sleep, typeAt } from './helpers.mjs';

test.afterAll(() => closeDb());
const SERVER = process.env.QA_URL || 'http://127.0.0.1:4300';
const STATE = new URL('../logs/deploy-room.json', import.meta.url);

/** Records console errors, failed requests and WebSocket connections of a page. */
function watch(page) {
  const seen = { errors: [], failed: [], sockets: [] };
  page.on('console', (m) => m.type() === 'error' && !/GSI_LOGGER|accounts\.google|identity provider|accounts list/i.test(m.text()) && seen.errors.push(m.text()));
  page.on('pageerror', (e) => seen.errors.push(e.message));
  page.on('requestfailed', (r) => !/accounts\.google|gstatic/.test(r.url()) && seen.failed.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on('websocket', (ws) => seen.sockets.push(ws.url()));
  return seen;
}

test('D1 two users on the Vercel-like site: join, edit both ways, chat, refresh a room URL', async ({ browser }) => {
  const room = await openRoom({ files: [{ name: 'main.js', content: '' }] });
  const a = await loggedIn(browser, 'Alice');
  const b = await loggedIn(browser, 'Bob');
  const seenA = watch(a.page);
  const seenB = watch(b.page);
  await enterRoom(a.page, room.roomId);
  await enterRoom(b.page, room.roomId);

  await typeAt(a.page, 'from-alice ');
  await expect.poll(() => editorText(b.page), { timeout: 20_000 }).toContain('from-alice');
  await typeAt(b.page, 'from-bob');
  await expect.poll(() => editorText(a.page), { timeout: 20_000 }).toContain('from-bob');

  await a.page.getByRole('button', { name: 'Chat' }).click();
  await b.page.getByRole('button', { name: 'Chat' }).click();
  await a.page.getByRole('textbox', { name: 'Chat message' }).fill('hello from production mode');
  await a.page.getByRole('button', { name: 'Send' }).click();
  await expect(b.page.getByText('hello from production mode')).toBeVisible();

  await b.page.reload();
  // The sidebar remembers the open panel (Chat): go back to Files.
  await b.page.getByRole('button', { name: 'Files' }).click({ timeout: 60_000 });
  await b.page.getByRole('button', { name: /^main\.js/ }).first().click({ timeout: 60_000 });
  await expect.poll(() => editorText(b.page), { timeout: 20_000 }).toContain('from-bob');

  await sleep(1800); // autosave
  fs.writeFileSync(STATE, JSON.stringify({ roomId: room.roomId, fileId: room.fileIds[0], email: room.owner.email, password: room.owner.password, text: fileText(room.doc, room.fileIds[0]) }));

  for (const [who, seen] of [['Alice', seenA], ['Bob', seenB]]) {
    expect(seen.errors.filter((e) => /CORS|Access-Control/i.test(e)), `${who}: CORS errors`).toEqual([]);
    expect(seen.errors, `${who}: console errors`).toEqual([]);
    expect(seen.failed, `${who}: failed requests`).toEqual([]);
    expect(seen.sockets.some((u) => u.startsWith(SERVER.replace('http', 'ws'))), `${who}: WebSocket to the server (${seen.sockets.join(', ')})`).toBe(true);
  }
});

test('D2 after a server restart the room content comes back from MongoDB', async ({ browser }) => {
  test.skip(!fs.existsSync(STATE), 'run D1 first, then restart the server');
  const saved = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  const c = await loggedIn(browser, 'Carol');
  await c.page.goto(`/room/${saved.roomId}`);
  // Carol is new: the room lets anyone in (approval off), as set up by D1.
  await c.page.getByRole('button', { name: /^main\.js/ }).first().click({ timeout: 60_000 });
  await expect.poll(() => editorText(c.page), { timeout: 20_000 }).toBe(saved.text);
});
