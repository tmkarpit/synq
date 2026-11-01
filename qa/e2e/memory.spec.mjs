// Phase 7: memory and listener leaks (Chromium only, via the DevTools protocol).
import { test } from '@playwright/test';
import { closeDb, enterRoom, expect, loggedIn, openRoom } from './helpers.mjs';

test.afterAll(() => closeDb());

async function metrics(page, cdp) {
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(500);
  await cdp.send('HeapProfiler.collectGarbage');
  const { metrics: m } = await cdp.send('Performance.getMetrics');
  const get = (n) => m.find((x) => x.name === n)?.value;
  return { heapMB: +(get('JSHeapUsedSize') / 1048576).toFixed(1), listeners: get('JSEventListeners'), nodes: get('Nodes') };
}

test('M1 open and leave a room 20 times, then switch files 50 times: memory and listeners stay flat', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'uses the Chrome DevTools protocol');
  const files = Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.js`, content: `// file ${i}\n`.repeat(200) }));
  const room = await openRoom({ files });
  const a = await loggedIn(browser, 'Leak');
  const cdp = await a.context.newCDPSession(a.page);
  await cdp.send('Performance.enable');

  await enterRoom(a.page, room.roomId, 'f0.js');
  await a.page.goto('/');
  const base = await metrics(a.page, cdp);
  for (let i = 0; i < 20; i += 1) {
    await enterRoom(a.page, room.roomId, 'f0.js');
    await a.page.goto('/');
    await a.page.waitForLoadState('networkidle');
  }
  const afterRooms = await metrics(a.page, cdp);

  await enterRoom(a.page, room.roomId, 'f0.js');
  // Open every file once first: the first visit sets up editor features (not a leak).
  for (let i = 0; i < 5; i += 1) await a.page.getByRole('button', { name: new RegExp(`^f${i}\.js`) }).first().click();
  await a.page.waitForTimeout(1000);
  const inRoom = await metrics(a.page, cdp);
  for (let i = 0; i < 50; i += 1) await a.page.getByRole('button', { name: new RegExp(`^f${i % 5}\.js`) }).first().click();
  await a.page.waitForTimeout(1000);
  const afterSwitch = await metrics(a.page, cdp);

  console.log(JSON.stringify({ base, afterRooms, inRoom, afterSwitch }));
  expect(afterRooms.heapMB - base.heapMB, 'heap grew after 20 room visits').toBeLessThan(25);
  expect(afterRooms.listeners - base.listeners, 'event listeners grew after 20 room visits').toBeLessThan(200);
  expect(afterSwitch.heapMB - inRoom.heapMB, 'heap grew after 50 file switches').toBeLessThan(15);
  expect(afterSwitch.listeners - inRoom.listeners, 'listeners grew after 50 file switches').toBeLessThan(100);
});
