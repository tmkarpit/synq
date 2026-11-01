// Phase 3 in real browsers: Monaco + Yjs + Socket.IO end to end (Chromium).
import { test } from '@playwright/test';
import { closeDb, editorText, enterRoom, expect, fileText, loggedIn, openRoom, sleep, typeAt } from './helpers.mjs';

test.afterAll(() => closeDb());

test('E1 two browsers typing at once end with identical text and nothing lost', async ({ browser }) => {
  const room = await openRoom();
  const a = await loggedIn(browser, 'Alice');
  const b = await loggedIn(browser, 'Bob');
  await enterRoom(a.page, room.roomId);
  await enterRoom(b.page, room.roomId);
  await Promise.all([typeAt(a.page, 'AAAAAAAAAAAAAAAAAAAA'), typeAt(b.page, 'BBBBBBBBBBBBBBBBBBBB')]);
  // Wait until both editors show all 40 characters (no fixed delay: slow machines vary).
  for (const page of [a.page, b.page]) await expect.poll(async () => (await editorText(page)).length, { timeout: 30_000 }).toBe(40);
  const ta = await editorText(a.page);
  const tb = await editorText(b.page);
  expect(ta).toBe(tb);
  expect(ta).toBe(fileText(room.doc, room.fileIds[0]));
  expect((ta.match(/A/g) || []).length).toBe(20);
  expect((ta.match(/B/g) || []).length).toBe(20);
  expect([...a.errors, ...b.errors]).toEqual([]);
});

test('E2 remote cursor, name flag and typing indicator appear, then disappear when the user leaves', async ({ browser }) => {
  const room = await openRoom({ files: [{ name: 'main.js', content: 'line one\nline two\n' }] });
  const a = await loggedIn(browser, 'Alice');
  const b = await loggedIn(browser, 'Bob');
  await enterRoom(a.page, room.roomId);
  await enterRoom(b.page, room.roomId);
  await b.page.locator('.monaco-editor .view-lines').first().click();
  await b.page.keyboard.press('Control+End');
  await b.page.keyboard.type('typed by bob', { delay: 60 });
  const flag = a.page.locator('.rc-flag', { hasText: 'Bob' });
  await expect(flag).toBeVisible();
  await expect(a.page.locator('.rc-flag--typing')).toHaveCount(1, { timeout: 5000 });
  await expect(a.page.locator('.rc-flag--typing')).toHaveCount(0, { timeout: 10_000 });
  await b.context.close();
  await expect(flag).toHaveCount(0, { timeout: 10_000 });
});

test('E3 clicking a collaborator avatar follows them to their file', async ({ browser }) => {
  const room = await openRoom({ files: [{ name: 'main.js', content: 'main' }, { name: 'other.js', content: 'other file' }] });
  const a = await loggedIn(browser, 'Alice');
  const b = await loggedIn(browser, 'Bob');
  await enterRoom(a.page, room.roomId, 'main.js');
  await enterRoom(b.page, room.roomId, 'other.js');
  await typeAt(b.page, ' edited');
  const avatar = a.page.getByRole('button', { name: /Bob/ }).first();
  await avatar.click();
  await expect(avatar).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => editorText(a.page)).toContain('other file');
});

test('E4 offline for 20 seconds, then back online: edits from both sides merge', async ({ browser }) => {
  const room = await openRoom();
  const a = await loggedIn(browser, 'Alice');
  const b = await loggedIn(browser, 'Bob');
  await enterRoom(a.page, room.roomId);
  await enterRoom(b.page, room.roomId);
  await b.context.setOffline(true);
  await typeAt(b.page, 'offline-edit ');
  await typeAt(a.page, 'online-edit ');
  await sleep(20_000);
  await b.context.setOffline(false);
  await expect.poll(() => editorText(b.page), { timeout: 30_000 }).toContain('online-edit');
  await expect.poll(() => editorText(a.page), { timeout: 30_000 }).toContain('offline-edit');
  expect(await editorText(a.page)).toBe(await editorText(b.page));
});

test('E5 refreshing a tab right after typing keeps the text and does not duplicate it', async ({ browser }) => {
  const room = await openRoom();
  const a = await loggedIn(browser, 'Alice');
  await enterRoom(a.page, room.roomId);
  await typeAt(a.page, 'before refresh');
  await a.page.reload();
  await a.page.getByRole('button', { name: /^main\.js/ }).first().click({ timeout: 60_000 });
  await expect.poll(() => editorText(a.page)).toBe('before refresh');
  expect(fileText(room.doc, room.fileIds[0])).toBe('before refresh');
});

test('E6 file explorer: create a file, reject duplicates and invalid names', async ({ browser }) => {
  const room = await openRoom();
  const a = await loggedIn(browser, 'Alice');
  await enterRoom(a.page, room.roomId);
  const create = async (name) => {
    await a.page.getByRole('button', { name: 'Explorer actions' }).click();
    await a.page.getByRole('menuitem', { name: /New File/ }).click();
    await a.page.keyboard.type(name);
    await a.page.keyboard.press('Enter');
  };
  await create('util.js');
  await expect.poll(() => [...room.doc.getMap('nodes').values()].map((n) => n.name)).toContain('util.js');
  await create('main.js');
  await expect(a.page.getByText('already exists')).toBeVisible();
  await a.page.keyboard.press('Escape');
  await create('a/b.js');
  await expect(a.page.getByText('cannot contain slashes')).toBeVisible();
  await a.page.keyboard.press('Escape');
  expect([...room.doc.getMap('nodes').values()].filter((n) => n.name === 'main.js')).toHaveLength(1);
});

test('E7 chat shows HTML and script text as plain text (no XSS) and keeps order', async ({ browser }) => {
  const room = await openRoom();
  const a = await loggedIn(browser, 'Alice');
  const b = await loggedIn(browser, 'Bob');
  await enterRoom(a.page, room.roomId);
  await enterRoom(b.page, room.roomId);
  const payload = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
  await a.page.getByRole('button', { name: 'Chat' }).click();
  await b.page.getByRole('button', { name: 'Chat' }).click();
  const box = a.page.getByRole('textbox', { name: 'Chat message' });
  for (const text of ['first', payload, 'third']) {
    await box.fill(text);
    await a.page.getByRole('button', { name: 'Send' }).click();
  }
  await expect(b.page.getByText(payload, { exact: true })).toBeVisible();
  const order = await b.page.getByText(/^(first|third)$/).allInnerTexts();
  expect(order).toEqual(['first', 'third']);
  expect(await b.page.evaluate(() => window.__xss)).toBeUndefined();
});

test('E8 a viewer sees edits live but cannot type', async ({ browser }) => {
  const room = await openRoom({ files: [{ name: 'main.js', content: 'read only for viewers' }] });
  const v = await loggedIn(browser, 'Viewer');
  await v.page.goto(`/room/${room.roomId}?role=viewer`);
  await v.page.getByRole('button', { name: /^main\.js/ }).first().click({ timeout: 60_000 });
  await v.page.locator('.monaco-editor .view-lines').first().click();
  await v.page.keyboard.type('viewer typing');
  await sleep(800);
  expect(fileText(room.doc, room.fileIds[0])).toBe('read only for viewers');
  room.doc.getMap('texts').get(room.fileIds[0]).insert(0, 'LIVE ');
  await expect.poll(() => editorText(v.page)).toContain('LIVE read only');
});
