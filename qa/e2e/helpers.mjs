import { expect } from '@playwright/test';
import { addFile, closeDb, createUser, emitAck, ownerRoom, sleep } from '../scripts/lib.mjs';

export { closeDb, sleep, addFile };

/** A room owned by a script (no approval needed to join) with one file. */
export async function openRoom({ files = [{ name: 'main.js', content: '' }] } = {}) {
  const o = await ownerRoom('Host');
  await emitAck(o.socket, 'room:settings', { approval: false, newMembers: 'editor' });
  const ids = files.map((f) => addFile(o.doc, f));
  await sleep(400);
  return { ...o, fileIds: ids };
}

/** A browser context logged in as a fresh account (real refresh cookie). */
export async function loggedIn(browser, name) {
  const u = await createUser(name);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const [k, v] = u.cookie.split('=');
  await context.addCookies([{ name: k, value: v, domain: '127.0.0.1', path: '/api/auth', httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { u, context, page, errors };
}

/** Opens the room and the file; resolves when Monaco is ready. */
export async function enterRoom(page, roomId, fileName = 'main.js') {
  await page.goto(`/room/${roomId}`);
  await page.getByRole('button', { name: new RegExp(`^${fileName.replace('.', '\.')}`) }).first().click({ timeout: 60_000 });
  await page.locator('.monaco-editor .view-lines').first().waitFor({ timeout: 60_000 });
}

/** Text Monaco shows (all lines must be on screen). */
export const editorText = (page) =>
  page.locator('.monaco-editor .view-lines').first().evaluate((el) =>
    [...el.querySelectorAll('.view-line')]
      .map((l) => ({ top: parseFloat(l.style.top), t: l.textContent.replace(/ /g, ' ') }))
      .sort((a, b) => a.top - b.top)
      .map((l) => l.t)
      .join('\n'),
  );

export async function typeAt(page, text, { end = true } = {}) {
  await page.locator('.monaco-editor .view-lines').first().click();
  if (end) await page.keyboard.press('Control+End');
  await page.keyboard.type(text, { delay: 15 });
}

export const fileText = (doc, id) => doc.getMap('texts').get(id).toString();
export { expect };
